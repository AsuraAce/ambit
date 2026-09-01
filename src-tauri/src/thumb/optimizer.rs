use rayon::prelude::*;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

const CURRENT_THUMBNAIL_VERSION: i64 = 1;
const FAILURE_BACKOFF_MS: i64 = 60 * 60 * 1000;
const DB_FLUSH_LIMIT: usize = 100;
const DB_FLUSH_INTERVAL: Duration = Duration::from_secs(5);
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_secs(1);
const THROTTLED_WORKER_CHUNK_SIZE: usize = 4;
const THROTTLED_CHUNK_SLEEP: Duration = Duration::from_millis(250);
const MAX_FAILURE_DIAGNOSTIC_LIMIT: usize = 50;

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ThumbnailOptimizationProfile {
    Quiet,
    Balanced,
    Fast,
}

impl ThumbnailOptimizationProfile {
    fn worker_count(self) -> usize {
        let available = std::thread::available_parallelism()
            .map(|threads| threads.get())
            .unwrap_or(2);

        match self {
            Self::Quiet => 1,
            Self::Balanced => std::cmp::max(1, std::cmp::min(6, available / 2)),
            Self::Fast => std::cmp::max(1, std::cmp::min(12, available.saturating_sub(1))),
        }
    }

    fn fetch_limit(self) -> usize {
        match self {
            Self::Quiet => 100,
            Self::Balanced => 500,
            Self::Fast => 1000,
        }
    }

    fn worker_chunk_size(self) -> usize {
        match self {
            Self::Quiet => 8,
            Self::Balanced => 24,
            Self::Fast => 48,
        }
    }

    fn idle_yield(self) -> Duration {
        match self {
            Self::Quiet => Duration::from_millis(250),
            Self::Balanced => Duration::from_millis(50),
            Self::Fast => Duration::from_millis(0),
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailOptimizationConfig {
    pub thumbnail_dir: String,
    pub include_upgradeable: bool,
    pub profile: ThumbnailOptimizationProfile,
    #[serde(default)]
    pub source_roots: Vec<String>,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailOptimizationProgress {
    pub checked: usize,
    pub total: usize,
    pub optimized: usize,
    pub reused: usize,
    pub missing: usize,
    pub failed: usize,
    pub skipped: usize,
    pub images_per_second: f64,
    pub batch_ms: u64,
    pub db_ms: u64,
    pub encode_ms: u64,
    pub profile: ThumbnailOptimizationProfile,
    pub phase: String,
    pub message: String,
    pub is_throttled: bool,
}

#[derive(Clone, Debug, Default, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailOptimizationResult {
    pub checked: usize,
    pub optimized: usize,
    pub reused: usize,
    pub missing: usize,
    pub failed: usize,
    pub skipped: usize,
    pub was_cancelled: bool,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailOptimizationFailure {
    pub id: String,
    pub path: String,
    pub thumbnail_path: Option<String>,
    pub failure_count: i64,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailOptimizationFailureList {
    pub failures: Vec<ThumbnailOptimizationFailure>,
}

pub struct ThumbnailOptimizationState {
    pub is_cancelled: Arc<AtomicBool>,
    pub is_running: Arc<AtomicBool>,
    pub is_throttled: Arc<AtomicBool>,
}

impl Default for ThumbnailOptimizationState {
    fn default() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
            is_running: Arc::new(AtomicBool::new(false)),
            is_throttled: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ThumbnailCandidate {
    id: String,
    path: String,
    timestamp: i64,
    invoke_images_root: Option<String>,
    source_root_available: Option<bool>,
}

#[derive(Clone, Debug)]
struct ThumbnailCursor {
    timestamp: i64,
    id: String,
}

#[derive(Clone, Debug)]
enum ThumbnailItemResult {
    Success {
        id: String,
        thumbnail_path: String,
        micro_thumbnail: Option<String>,
        reused: bool,
        processing_ms: u128,
    },
    Failed {
        id: String,
        error: String,
    },
    MissingSource {
        id: String,
    },
    Skipped,
}

#[derive(Default)]
struct BatchStats {
    checked: usize,
    optimized: usize,
    reused: usize,
    missing: usize,
    failed: usize,
    skipped: usize,
    encode_ms: u128,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn start_thumbnail_optimization_job(
    app: tauri::AppHandle,
    state: tauri::State<'_, ThumbnailOptimizationState>,
    config: ThumbnailOptimizationConfig,
) -> Result<ThumbnailOptimizationResult, String> {
    if state.is_running.swap(true, Ordering::SeqCst) {
        return Err("Thumbnail optimization is already running".to_string());
    }

    state.is_cancelled.store(false, Ordering::SeqCst);
    state.is_throttled.store(false, Ordering::SeqCst);
    let is_cancelled = state.is_cancelled.clone();
    let is_running = state.is_running.clone();
    let is_throttled = state.is_throttled.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = run_thumbnail_optimization_job(app, is_cancelled, is_throttled, config);
        is_running.store(false, Ordering::SeqCst);
        result
    })
    .await
    .map_err(|e| e.to_string())?;

    result
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_thumbnail_optimization_job(state: tauri::State<'_, ThumbnailOptimizationState>) {
    if request_thumbnail_cancellation(state.is_cancelled.as_ref()) {
        log::info!("[ThumbnailOptimization] Cancellation requested");
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn set_thumbnail_optimization_throttled(
    state: tauri::State<'_, ThumbnailOptimizationState>,
    throttled: bool,
) {
    let previous = state.is_throttled.swap(throttled, Ordering::SeqCst);
    if previous != throttled {
        let status = if throttled { "enabled" } else { "disabled" };
        log::info!("[ThumbnailOptimization] Throttling {status}");
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_thumbnail_optimization_failures(
    app: tauri::AppHandle,
    limit: usize,
) -> Result<ThumbnailOptimizationFailureList, String> {
    let db_path = crate::db::resolve_db_path(&app)?;
    let capped_limit = limit.clamp(1, MAX_FAILURE_DIAGNOSTIC_LIMIT);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        get_thumbnail_optimization_failures_for_conn(&conn, capped_limit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn retry_failed_thumbnail_optimizations(app: tauri::AppHandle) -> Result<usize, String> {
    let db_path = crate::db::resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        retry_failed_thumbnail_optimizations_for_conn(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run_thumbnail_optimization_job(
    app: tauri::AppHandle,
    is_cancelled: Arc<AtomicBool>,
    is_throttled: Arc<AtomicBool>,
    config: ThumbnailOptimizationConfig,
) -> Result<ThumbnailOptimizationResult, String> {
    let started_at = Instant::now();
    let db_path = crate::db::resolve_db_path(&app)?;
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(60))
        .map_err(|e| e.to_string())?;

    let worker_count = config.profile.worker_count();
    let fetch_limit = config.profile.fetch_limit();
    let worker_chunk_size = config.profile.worker_chunk_size();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count)
        .stack_size(8 * 1024 * 1024)
        .build()
        .map_err(|e| e.to_string())?;

    log::info!(
        "[ThumbnailOptimization] Starting job. profile={:?}, workers={}, fetch_limit={}, worker_chunk_size={}, include_upgradeable={}",
        config.profile,
        worker_count,
        fetch_limit,
        worker_chunk_size,
        config.include_upgradeable
    );

    let mut result = ThumbnailOptimizationResult::default();
    emit_progress(
        &app,
        &build_progress_payload(&result, started_at, config.profile, 0, 0, 0, false),
    );

    let stale_thumbnail_count = mark_current_ambit_thumbnails_stale_if_cache_missing_or_empty(
        &conn,
        &config.thumbnail_dir,
    )?;
    if stale_thumbnail_count > 0 {
        log::info!(
            "[ThumbnailOptimization] Thumbnail cache is missing or empty; marked {} Ambit thumbnails for regeneration",
            stale_thumbnail_count
        );
    }

    ensure_thumbnail_queue_index(&conn)?;

    let mut cursor: Option<ThumbnailCursor> = None;
    let mut pending_results: Vec<ThumbnailItemResult> = Vec::with_capacity(DB_FLUSH_LIMIT);
    let mut last_progress_at = Instant::now();
    let mut last_flush_at = Instant::now();
    let mut last_batch_ms = 0;
    let mut last_db_ms = 0;
    let mut encode_ms_since_progress = 0_u128;
    let mut source_root_availability = HashMap::new();

    while !is_cancelled.load(Ordering::SeqCst) {
        let mut candidates = fetch_thumbnail_candidates(
            &conn,
            config.include_upgradeable,
            cursor.as_ref(),
            fetch_limit,
            unix_time_ms(),
        )?;

        if candidates.is_empty() {
            break;
        }

        resolve_candidate_source_roots(
            &mut candidates,
            &config.source_roots,
            &mut source_root_availability,
            Path::is_dir,
        );

        if let Some(last) = candidates.last() {
            cursor = Some(ThumbnailCursor {
                timestamp: last.timestamp,
                id: last.id.clone(),
            });
        }

        let mut index = 0;
        while index < candidates.len() && !is_cancelled.load(Ordering::SeqCst) {
            let throttled = is_throttled.load(Ordering::SeqCst);
            let chunk_size = if throttled {
                THROTTLED_WORKER_CHUNK_SIZE
            } else {
                worker_chunk_size
            };
            let end = std::cmp::min(index + chunk_size, candidates.len());
            let chunk_started_at = Instant::now();

            process_candidate_chunk(
                &pool,
                &candidates[index..end],
                &config.thumbnail_dir,
                is_cancelled.as_ref(),
                |item| {
                    encode_ms_since_progress += accumulate_thumbnail_result(&mut result, &item);

                    if !matches!(item, ThumbnailItemResult::Skipped) {
                        pending_results.push(item);
                    }

                    if pending_results.len() >= DB_FLUSH_LIMIT
                        || last_flush_at.elapsed() >= DB_FLUSH_INTERVAL
                    {
                        last_db_ms = flush_pending_thumbnail_results(
                            &mut conn,
                            &mut pending_results,
                            unix_time_ms(),
                        )?;
                        last_flush_at = Instant::now();
                    }

                    if last_progress_at.elapsed() >= PROGRESS_EMIT_INTERVAL {
                        emit_progress(
                            &app,
                            &build_progress_payload(
                                &result,
                                started_at,
                                config.profile,
                                last_batch_ms,
                                last_db_ms,
                                millis_to_u64(encode_ms_since_progress),
                                is_throttled.load(Ordering::SeqCst),
                            ),
                        );
                        encode_ms_since_progress = 0;
                        last_progress_at = Instant::now();
                    }

                    Ok(())
                },
            )?;

            last_batch_ms = elapsed_ms(chunk_started_at);
            index = end;

            if is_throttled.load(Ordering::SeqCst) {
                std::thread::sleep(THROTTLED_CHUNK_SLEEP);
            }
        }

        if pending_results.len() >= DB_FLUSH_LIMIT || last_flush_at.elapsed() >= DB_FLUSH_INTERVAL {
            last_db_ms =
                flush_pending_thumbnail_results(&mut conn, &mut pending_results, unix_time_ms())?;
            last_flush_at = Instant::now();
        }

        let yield_duration = config.profile.idle_yield();
        if !yield_duration.is_zero() && !is_throttled.load(Ordering::SeqCst) {
            std::thread::sleep(yield_duration);
        }
    }

    last_db_ms = flush_pending_thumbnail_results(&mut conn, &mut pending_results, unix_time_ms())?;
    result.was_cancelled = is_cancelled.load(Ordering::SeqCst);
    result.duration_ms = elapsed_ms(started_at);
    let completion_images_per_second = if result.duration_ms > 0 {
        result.checked as f64 / (result.duration_ms as f64 / 1000.0)
    } else {
        0.0
    };

    emit_progress(
        &app,
        &build_progress_payload(
            &result,
            started_at,
            config.profile,
            last_batch_ms,
            last_db_ms,
            millis_to_u64(encode_ms_since_progress),
            is_throttled.load(Ordering::SeqCst),
        ),
    );

    log::info!(
        "[ThumbnailOptimization] Complete. checked={}, optimized={}, reused={}, missing={}, failed={}, skipped={}, cancelled={}, duration_ms={}, images_per_second={:.2}",
        result.checked,
        result.optimized,
        result.reused,
        result.missing,
        result.failed,
        result.skipped,
        result.was_cancelled,
        result.duration_ms,
        completion_images_per_second
    );

    emit_complete(&app, &result);
    Ok(result)
}

fn request_thumbnail_cancellation(is_cancelled: &AtomicBool) -> bool {
    !is_cancelled.swap(true, Ordering::SeqCst)
}

fn get_thumbnail_optimization_failures_for_conn(
    conn: &Connection,
    limit: usize,
) -> Result<ThumbnailOptimizationFailureList, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id,
                    path,
                    thumbnail_path,
                    COALESCE(thumbnail_failure_count, 0) AS failure_count,
                    thumbnail_last_error,
                    thumbnail_last_attempt_at
             FROM scoped_images
             WHERE invoke_scope_hidden = 0
               AND is_deleted = 0
               AND media_type = 'image'
               AND is_missing = 0
               AND COALESCE(thumbnail_failure_count, 0) > 0
             ORDER BY COALESCE(thumbnail_last_attempt_at, 0) DESC, id ASC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let failures = stmt
        .query_map(params![limit as i64], |row| {
            Ok(ThumbnailOptimizationFailure {
                id: row.get(0)?,
                path: row.get(1)?,
                thumbnail_path: row.get(2)?,
                failure_count: row.get(3)?,
                last_error: row.get(4)?,
                last_attempt_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| e.to_string())?;

    Ok(ThumbnailOptimizationFailureList { failures })
}

fn retry_failed_thumbnail_optimizations_for_conn(conn: &Connection) -> Result<usize, String> {
    conn.execute(
        "UPDATE images
         SET thumbnail_failure_count = 0,
             thumbnail_last_error = NULL,
             thumbnail_last_attempt_at = NULL
         WHERE id IN (SELECT id FROM scoped_images)
           AND is_deleted = 0
           AND media_type = 'image'
           AND is_missing = 0
           AND COALESCE(thumbnail_failure_count, 0) > 0",
        [],
    )
    .map_err(|e| e.to_string())
}

fn mark_current_ambit_thumbnails_stale_if_cache_missing_or_empty(
    conn: &Connection,
    thumbnail_dir: &str,
) -> Result<usize, String> {
    if !thumbnail_cache_is_missing_or_empty(thumbnail_dir) {
        return Ok(0);
    }

    conn.execute(
        "UPDATE images
         SET thumbnail_version = 0
         WHERE thumbnail_source = 'ambit'
           AND COALESCE(thumbnail_version, 0) >= ?1
           AND thumbnail_path IS NOT NULL
           AND thumbnail_path != ''
           AND path != thumbnail_path
           AND id IN (SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0)",
        params![CURRENT_THUMBNAIL_VERSION],
    )
    .map_err(|error| error.to_string())
}

fn thumbnail_cache_is_missing_or_empty(thumbnail_dir: &str) -> bool {
    let thumbnail_dir = Path::new(thumbnail_dir);
    if !thumbnail_dir.exists() {
        return true;
    }

    let entries = match fs::read_dir(thumbnail_dir) {
        Ok(entries) => entries,
        Err(error) => {
            log::warn!(
                "[ThumbnailOptimization] Could not inspect thumbnail cache directory: {}",
                error
            );
            return false;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("webp"))
        {
            return false;
        }
    }

    true
}

fn ensure_thumbnail_queue_index(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        DROP INDEX IF EXISTS idx_images_thumbnail_optimization_queue_v1;
        CREATE INDEX IF NOT EXISTS idx_images_thumbnail_optimization_queue_v2
            ON images(
                media_type,
                is_deleted,
                is_missing,
                timestamp DESC,
                id DESC,
                thumbnail_failure_count,
                thumbnail_last_attempt_at,
                thumbnail_source,
                thumbnail_version
            );
        ",
    )
    .map_err(|error| error.to_string())
}

fn process_candidate_chunk<F>(
    pool: &rayon::ThreadPool,
    candidates: &[ThumbnailCandidate],
    thumbnail_dir: &str,
    is_cancelled: &AtomicBool,
    mut handle_result: F,
) -> Result<(), String>
where
    F: FnMut(ThumbnailItemResult) -> Result<(), String>,
{
    let (sender, receiver) = mpsc::channel();
    let mut stream_error: Option<String> = None;
    let mut worker_error: Option<String> = None;

    std::thread::scope(|scope| {
        let worker = scope.spawn(move || {
            pool.install(|| {
                candidates
                    .par_iter()
                    .for_each_with(sender, |sender, candidate| {
                        let item =
                            optimize_thumbnail_candidate(candidate, thumbnail_dir, is_cancelled);
                        let _ = sender.send(item);
                    });
            });
        });

        for item in receiver {
            if let Err(error) = handle_result(item) {
                stream_error = Some(error);
                break;
            }
        }

        if worker.join().is_err() {
            worker_error = Some("thumbnail worker panicked".to_string());
        }
    });

    if let Some(error) = stream_error {
        return Err(error);
    }

    if let Some(error) = worker_error {
        return Err(error);
    }

    Ok(())
}

fn accumulate_thumbnail_result(
    result: &mut ThumbnailOptimizationResult,
    item: &ThumbnailItemResult,
) -> u128 {
    match item {
        ThumbnailItemResult::Success {
            reused,
            processing_ms,
            ..
        } => {
            result.checked += 1;
            result.optimized += 1;
            if *reused {
                result.reused += 1;
            }
            *processing_ms
        }
        ThumbnailItemResult::Failed { .. } => {
            result.checked += 1;
            result.failed += 1;
            0
        }
        ThumbnailItemResult::MissingSource { .. } => {
            result.checked += 1;
            result.missing += 1;
            0
        }
        ThumbnailItemResult::Skipped => {
            result.checked += 1;
            result.skipped += 1;
            0
        }
    }
}

fn flush_pending_thumbnail_results(
    conn: &mut Connection,
    pending_results: &mut Vec<ThumbnailItemResult>,
    attempted_at_ms: i64,
) -> Result<u64, String> {
    if pending_results.is_empty() {
        return Ok(0);
    }

    let db_started_at = Instant::now();
    persist_thumbnail_results(conn, pending_results, attempted_at_ms)?;
    pending_results.clear();
    Ok(elapsed_ms(db_started_at))
}

fn build_progress_payload(
    result: &ThumbnailOptimizationResult,
    started_at: Instant,
    profile: ThumbnailOptimizationProfile,
    batch_ms: u64,
    db_ms: u64,
    encode_ms: u64,
    is_throttled: bool,
) -> ThumbnailOptimizationProgress {
    let elapsed_seconds = started_at.elapsed().as_secs_f64();
    let images_per_second = if elapsed_seconds > 0.0 {
        result.checked as f64 / elapsed_seconds
    } else {
        0.0
    };

    ThumbnailOptimizationProgress {
        checked: result.checked,
        total: 0,
        optimized: result.optimized,
        reused: result.reused,
        missing: result.missing,
        failed: result.failed,
        skipped: result.skipped,
        images_per_second,
        batch_ms,
        db_ms,
        encode_ms,
        profile,
        phase: if is_throttled {
            "throttled".to_string()
        } else {
            "running".to_string()
        },
        message: format_thumbnail_progress_message(result),
        is_throttled,
    }
}

fn format_thumbnail_progress_message(result: &ThumbnailOptimizationResult) -> String {
    if result.checked == 0 {
        return "Checking library thumbnails...".to_string();
    }

    if result.failed > 0 {
        return format!(
            "Optimized {} thumbnails; {} need attention",
            result.optimized, result.failed
        );
    }

    if result.missing > 0 {
        return format!(
            "Optimized {} thumbnails; marked {} files missing",
            result.optimized, result.missing
        );
    }

    format!("Optimized {} thumbnails", result.optimized)
}

fn optimize_thumbnail_candidate(
    candidate: &ThumbnailCandidate,
    thumbnail_dir: &str,
    is_cancelled: &AtomicBool,
) -> ThumbnailItemResult {
    if is_cancelled.load(Ordering::SeqCst) {
        return ThumbnailItemResult::Skipped;
    }

    if candidate.source_root_available == Some(false) {
        return ThumbnailItemResult::Skipped;
    }

    match fs::metadata(&candidate.path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return ThumbnailItemResult::MissingSource {
                id: candidate.id.clone(),
            };
        }
        Err(error) => {
            return ThumbnailItemResult::Failed {
                id: candidate.id.clone(),
                error: format!("failed_to_inspect_source: {error}"),
            };
        }
        Ok(metadata) if !metadata.is_file() => {
            return ThumbnailItemResult::Failed {
                id: candidate.id.clone(),
                error: "source_is_not_a_regular_file".to_string(),
            };
        }
        Ok(_) => {}
    }

    match super::generate_thumbnail(&candidate.path, thumbnail_dir) {
        Ok(thumbnail) => ThumbnailItemResult::Success {
            id: candidate.id.clone(),
            thumbnail_path: thumbnail.thumbnail_path,
            micro_thumbnail: thumbnail.micro_thumbnail,
            reused: thumbnail.was_cached,
            processing_ms: thumbnail.processing_ms,
        },
        Err(error) => ThumbnailItemResult::Failed {
            id: candidate.id.clone(),
            error,
        },
    }
}

fn resolve_candidate_source_roots<F>(
    candidates: &mut [ThumbnailCandidate],
    source_roots: &[String],
    availability: &mut HashMap<String, bool>,
    mut is_available: F,
) where
    F: FnMut(&Path) -> bool,
{
    for candidate in candidates {
        let source_root = candidate
            .invoke_images_root
            .as_deref()
            .map(|root| {
                Path::new(root)
                    .join("outputs")
                    .join("images")
                    .to_string_lossy()
                    .to_string()
            })
            .or_else(|| most_specific_source_root(&candidate.path, source_roots).cloned());

        let Some(source_root) = source_root else {
            candidate.source_root_available = None;
            continue;
        };
        let key = normalize_source_root_identity(&source_root);
        let is_root_available = match availability.get(&key) {
            Some(is_available) => *is_available,
            None => {
                let is_root_available = is_available(Path::new(&source_root));
                availability.insert(key, is_root_available);
                is_root_available
            }
        };
        candidate.source_root_available = Some(is_root_available);
    }
}

fn most_specific_source_root<'a>(path: &str, source_roots: &'a [String]) -> Option<&'a String> {
    let path = normalize_source_root_identity(path);
    source_roots
        .iter()
        .filter(|root| {
            let root = normalize_source_root_identity(root);
            !root.is_empty() && path_is_within_root(&path, &root)
        })
        .max_by_key(|root| normalize_source_root_identity(root).len())
}

fn normalize_source_root_identity(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() && path.trim().starts_with('/') {
        return "/".to_string();
    }
    if normalized.as_bytes().get(1) == Some(&b':') || normalized.starts_with("//") {
        normalized.to_lowercase()
    } else {
        normalized.to_string()
    }
}

fn path_is_within_root(path: &str, root: &str) -> bool {
    if root == "/" {
        return path.starts_with('/');
    }
    path == root
        || path
            .strip_prefix(root)
            .is_some_and(|remainder| remainder.starts_with('/'))
}

fn persist_missing_sources(
    tx: &rusqlite::Transaction<'_>,
    results: &[ThumbnailItemResult],
    stats: &mut BatchStats,
) -> Result<(), String> {
    let has_scope_cache: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE name IN (
                 'invoke_scope_cache_control',
                 'invoke_scope_cache_state',
                 'invoke_scope_cache_dirty_items',
                 'invoke_scope_cache_visible_image_scopes'
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if has_scope_cache == 4 {
        tx.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS thumbnail_optimizer_missing_ids (
                 id TEXT PRIMARY KEY
             ) WITHOUT ROWID;
             DELETE FROM thumbnail_optimizer_missing_ids;
             UPDATE invoke_scope_cache_control
             SET suppress_invalidation = 1
             WHERE state_key = 'current';",
        )
        .map_err(|e| e.to_string())?;
    }

    let mut missing_stmt = tx
        .prepare_cached(
            "UPDATE images
             SET is_missing = 1,
                 thumbnail_failure_count = 0,
                 thumbnail_last_error = NULL,
                 thumbnail_last_attempt_at = NULL
             WHERE id = ?1
               AND id IN (SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0)",
        )
        .map_err(|e| e.to_string())?;
    let mut remember_missing = if has_scope_cache == 4 {
        Some(
            tx.prepare_cached(
                "INSERT OR IGNORE INTO thumbnail_optimizer_missing_ids (id) VALUES (?1)",
            )
            .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };

    for item in results {
        if let ThumbnailItemResult::MissingSource { id } = item {
            let updated = missing_stmt.execute([id]).map_err(|e| e.to_string())?;
            if updated > 0 {
                if let Some(statement) = remember_missing.as_mut() {
                    statement.execute([id]).map_err(|e| e.to_string())?;
                }
            }
            stats.checked += 1;
            stats.missing += 1;
        }
    }
    drop(remember_missing);
    drop(missing_stmt);

    if has_scope_cache == 4 {
        tx.execute_batch(
            "INSERT INTO invoke_scope_cache_dirty_items
                 (scope_key, domain, facet_type, resource_name)
             SELECT DISTINCT visible.scope_key, 'full', '', ''
             FROM invoke_scope_cache_visible_image_scopes visible
             JOIN thumbnail_optimizer_missing_ids missing
               ON missing.id = visible.image_id
             ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

             UPDATE invoke_scope_cache_state
             SET status = 'dirty',
                 generation = generation + 1,
                 updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
             WHERE status != 'dirty'
               AND scope_key IN (
                   SELECT visible.scope_key
                   FROM invoke_scope_cache_visible_image_scopes visible
                   JOIN thumbnail_optimizer_missing_ids missing
                     ON missing.id = visible.image_id
               );

             DELETE FROM thumbnail_optimizer_missing_ids;
             UPDATE invoke_scope_cache_control
             SET suppress_invalidation = 0
             WHERE state_key = 'current';",
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn persist_thumbnail_results(
    conn: &mut Connection,
    results: &[ThumbnailItemResult],
    attempted_at_ms: i64,
) -> Result<BatchStats, String> {
    let mut stats = BatchStats::default();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut success_stmt = tx
            .prepare_cached(
                "UPDATE images
                 SET thumbnail_path = ?1,
                     micro_thumbnail = COALESCE(?2, micro_thumbnail),
                     thumbnail_source = 'ambit',
                     thumbnail_version = ?3,
                     thumbnail_failure_count = 0,
                     thumbnail_last_error = NULL,
                     thumbnail_last_attempt_at = NULL
                 WHERE id = ?4
                   AND id IN (SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0)",
            )
            .map_err(|e| e.to_string())?;

        let mut failure_stmt = tx
            .prepare_cached(
                "UPDATE images
                 SET thumbnail_failure_count = COALESCE(thumbnail_failure_count, 0) + 1,
                     thumbnail_last_error = ?1,
                     thumbnail_last_attempt_at = ?2
                 WHERE id = ?3
                   AND id IN (SELECT id FROM scoped_images WHERE invoke_scope_hidden = 0)",
            )
            .map_err(|e| e.to_string())?;

        persist_missing_sources(&tx, results, &mut stats)?;

        for item in results {
            match item {
                ThumbnailItemResult::Success {
                    id,
                    thumbnail_path,
                    micro_thumbnail,
                    reused,
                    processing_ms,
                } => {
                    success_stmt
                        .execute(params![
                            thumbnail_path,
                            micro_thumbnail,
                            CURRENT_THUMBNAIL_VERSION,
                            id
                        ])
                        .map_err(|e| e.to_string())?;
                    stats.checked += 1;
                    stats.optimized += 1;
                    if *reused {
                        stats.reused += 1;
                    }
                    stats.encode_ms += *processing_ms;
                }
                ThumbnailItemResult::Failed { id, error } => {
                    failure_stmt
                        .execute(params![error, attempted_at_ms, id])
                        .map_err(|e| e.to_string())?;
                    stats.checked += 1;
                    stats.failed += 1;
                }
                ThumbnailItemResult::MissingSource { .. } => {}
                ThumbnailItemResult::Skipped => {
                    stats.skipped += 1;
                }
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(stats)
}

fn fetch_thumbnail_candidates(
    conn: &Connection,
    include_upgradeable: bool,
    cursor: Option<&ThumbnailCursor>,
    limit: usize,
    now_ms: i64,
) -> Result<Vec<ThumbnailCandidate>, String> {
    let mut query = format!(
        "SELECT i.id, i.path, COALESCE(i.timestamp, 0) AS timestamp,
                (
                    SELECT scope.images_root
                    FROM invoke_owner_scope_state scope
                    WHERE i.invoke_source_id IS NOT NULL
                      AND LOWER(RTRIM(REPLACE(scope.db_path, '\\', '/'), '/')) =
                          LOWER(RTRIM(REPLACE(i.invoke_source_id, '\\', '/'), '/'))
                    LIMIT 1
                ) AS invoke_images_root
         FROM scoped_images i
         WHERE {}",
        thumbnail_queue_condition(include_upgradeable, now_ms)
    );

    if cursor.is_some() {
        query.push_str(" AND (timestamp < ?1 OR (timestamp = ?1 AND id < ?2))");
        query.push_str(" ORDER BY timestamp DESC, id DESC LIMIT ?3");
    } else {
        query.push_str(" ORDER BY timestamp DESC, id DESC LIMIT ?1");
    }

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let rows = if let Some(cursor) = cursor {
        stmt.query_map(params![cursor.timestamp, cursor.id, limit as i64], |row| {
            Ok(ThumbnailCandidate {
                id: row.get(0)?,
                path: row.get(1)?,
                timestamp: row.get(2)?,
                invoke_images_root: row.get(3)?,
                source_root_available: None,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![limit as i64], |row| {
            Ok(ThumbnailCandidate {
                id: row.get(0)?,
                path: row.get(1)?,
                timestamp: row.get(2)?,
                invoke_images_root: row.get(3)?,
                source_root_available: None,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| e.to_string())?
    };

    Ok(rows)
}

fn thumbnail_queue_condition(include_upgradeable: bool, now_ms: i64) -> String {
    let retry_cutoff_ms = now_ms - FAILURE_BACKOFF_MS;
    let missing_thumbnail =
        "(path = thumbnail_path OR thumbnail_path IS NULL OR thumbnail_path = '')";
    let outdated_ambit = format!(
        "(thumbnail_source = 'ambit' AND COALESCE(thumbnail_version, 0) < {})",
        CURRENT_THUMBNAIL_VERSION
    );
    let upgradeable = if include_upgradeable {
        " OR (
            thumbnail_path IS NOT NULL
            AND thumbnail_path != ''
            AND path != thumbnail_path
            AND (thumbnail_source IS NULL OR thumbnail_source != 'ambit')
        )"
    } else {
        ""
    };

    format!(
        "invoke_scope_hidden = 0
         AND is_deleted = 0
         AND media_type = 'image'
         AND is_missing = 0
         AND IFNULL(is_intermediate_gen, 0) = 0
         AND (is_corrupt = 0 OR is_corrupt IS NULL)
         AND path NOT LIKE 'blob:%'
         AND path NOT LIKE 'data:%'
         AND (
             COALESCE(thumbnail_failure_count, 0) = 0
             OR thumbnail_last_attempt_at IS NULL
             OR thumbnail_last_attempt_at <= {retry_cutoff_ms}
         )
         AND ({missing_thumbnail} OR {outdated_ambit}{upgradeable})"
    )
}

fn emit_progress(app: &tauri::AppHandle, progress: &ThumbnailOptimizationProgress) {
    let _ = app.emit("thumbnail-optimization-progress", progress.clone());
}

fn emit_complete(app: &tauri::AppHandle, result: &ThumbnailOptimizationResult) {
    let _ = app.emit("thumbnail-optimization-complete", result.clone());
}

fn unix_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn elapsed_ms(started_at: Instant) -> u64 {
    millis_to_u64(started_at.elapsed().as_millis())
}

fn millis_to_u64(value: u128) -> u64 {
    std::cmp::min(value, u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_queue_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                thumbnail_path TEXT,
                micro_thumbnail TEXT,
                thumbnail_source TEXT,
                thumbnail_version INTEGER NOT NULL DEFAULT 0,
                thumbnail_failure_count INTEGER NOT NULL DEFAULT 0,
                thumbnail_last_error TEXT,
                thumbnail_last_attempt_at INTEGER,
                media_type TEXT NOT NULL DEFAULT 'image',
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                is_missing INTEGER NOT NULL DEFAULT 0,
                is_intermediate_gen INTEGER NOT NULL DEFAULT 0,
                is_corrupt INTEGER DEFAULT 0,
                timestamp INTEGER NOT NULL,
                invoke_source_id TEXT
            );
            CREATE VIEW scoped_images AS
                SELECT * FROM images WHERE invoke_scope_hidden = 0;
            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY,
                db_path TEXT NOT NULL,
                images_root TEXT NOT NULL
            );
            ",
        )
        .expect("schema");
        conn
    }

    fn insert_image(
        conn: &Connection,
        id: &str,
        thumbnail_path: Option<&str>,
        thumbnail_source: Option<&str>,
        thumbnail_version: i64,
        timestamp: i64,
    ) {
        conn.execute(
            "INSERT INTO images (
                id, path, thumbnail_path, thumbnail_source, thumbnail_version, timestamp
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                format!("C:/library/{id}.png"),
                thumbnail_path,
                thumbnail_source,
                thumbnail_version,
                timestamp
            ],
        )
        .expect("insert image");
    }

    fn temp_thumbnail_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ambit-thumb-optimizer-{}-{}",
            std::process::id(),
            name
        ))
    }

    #[test]
    fn profiles_split_queue_fetch_from_worker_chunk_size() {
        assert_eq!(ThumbnailOptimizationProfile::Quiet.fetch_limit(), 100);
        assert_eq!(ThumbnailOptimizationProfile::Balanced.fetch_limit(), 500);
        assert_eq!(ThumbnailOptimizationProfile::Fast.fetch_limit(), 1000);

        assert_eq!(ThumbnailOptimizationProfile::Quiet.worker_chunk_size(), 8);
        assert_eq!(
            ThumbnailOptimizationProfile::Balanced.worker_chunk_size(),
            24
        );
        assert_eq!(ThumbnailOptimizationProfile::Fast.worker_chunk_size(), 48);
        assert_eq!(THROTTLED_WORKER_CHUNK_SIZE, 4);
    }

    #[test]
    fn progress_payload_is_unknown_total_and_can_update_before_db_flush() {
        let started_at = Instant::now();
        let mut result = ThumbnailOptimizationResult::default();
        let item = ThumbnailItemResult::Success {
            id: "early".to_string(),
            thumbnail_path: "C:/thumbs/early.webp".to_string(),
            micro_thumbnail: None,
            reused: false,
            processing_ms: 15,
        };

        let encode_ms = accumulate_thumbnail_result(&mut result, &item);
        let progress = build_progress_payload(
            &result,
            started_at,
            ThumbnailOptimizationProfile::Balanced,
            12,
            0,
            millis_to_u64(encode_ms),
            true,
        );

        assert_eq!(progress.checked, 1);
        assert_eq!(progress.optimized, 1);
        assert_eq!(progress.total, 0);
        assert_eq!(progress.encode_ms, 15);
        assert!(progress.is_throttled);
        assert_eq!(progress.phase, "throttled");
    }

    #[test]
    fn skipped_candidates_advance_visited_progress() {
        let mut result = ThumbnailOptimizationResult::default();

        accumulate_thumbnail_result(&mut result, &ThumbnailItemResult::Skipped);

        assert_eq!(result.checked, 1);
        assert_eq!(result.skipped, 1);
    }

    #[test]
    fn failure_diagnostics_return_active_failed_rows_ordered_by_recent_attempt() {
        let conn = setup_queue_db();
        insert_image(&conn, "older", None, None, 0, 10);
        insert_image(
            &conn,
            "newer",
            Some("C:/thumbs/newer.webp"),
            Some("ambit"),
            1,
            20,
        );
        insert_image(&conn, "deleted", None, None, 0, 30);
        insert_image(&conn, "missing", None, None, 0, 40);
        insert_image(&conn, "ok", None, None, 0, 50);
        insert_image(&conn, "owner-hidden", None, None, 0, 60);

        conn.execute_batch(
            "
            UPDATE images
            SET thumbnail_failure_count = 1,
                thumbnail_last_error = 'old decode failed',
                thumbnail_last_attempt_at = 100
            WHERE id = 'older';

            UPDATE images
            SET thumbnail_failure_count = 2,
                thumbnail_last_error = 'new decode failed',
                thumbnail_last_attempt_at = 200
            WHERE id = 'newer';

            UPDATE images
            SET thumbnail_failure_count = 1,
                thumbnail_last_error = 'deleted decode failed',
                thumbnail_last_attempt_at = 300,
                is_deleted = 1
            WHERE id = 'deleted';

            UPDATE images
            SET thumbnail_failure_count = 1,
                thumbnail_last_error = 'missing decode failed',
                thumbnail_last_attempt_at = 400,
                is_missing = 1
            WHERE id = 'missing';

            UPDATE images
            SET thumbnail_failure_count = 1,
                thumbnail_last_error = 'other owner decode failed',
                thumbnail_last_attempt_at = 500,
                invoke_scope_hidden = 1
            WHERE id = 'owner-hidden';
            ",
        )
        .expect("mark failures");

        let failures =
            get_thumbnail_optimization_failures_for_conn(&conn, 1).expect("failure diagnostics");

        assert_eq!(failures.failures.len(), 1);
        assert_eq!(failures.failures[0].id, "newer");
        assert_eq!(
            failures.failures[0].thumbnail_path.as_deref(),
            Some("C:/thumbs/newer.webp")
        );
        assert_eq!(failures.failures[0].failure_count, 2);
        assert_eq!(
            failures.failures[0].last_error.as_deref(),
            Some("new decode failed")
        );
        assert_eq!(failures.failures[0].last_attempt_at, Some(200));
    }

    #[test]
    fn retry_failed_thumbnail_optimizations_clears_only_failure_metadata() {
        let conn = setup_queue_db();
        insert_image(
            &conn,
            "failed",
            Some("C:/thumbs/failed.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            20,
        );
        insert_image(&conn, "ok", Some("C:/thumbs/ok.webp"), Some("ambit"), 1, 10);
        insert_image(&conn, "owner-hidden", None, None, 0, 30);

        conn.execute(
            "UPDATE images
             SET thumbnail_failure_count = 3,
                 thumbnail_last_error = 'decode failed',
                 thumbnail_last_attempt_at = 123
             WHERE id = 'failed'",
            [],
        )
        .expect("mark failed");
        conn.execute(
            "UPDATE images
             SET thumbnail_failure_count = 2,
                 thumbnail_last_error = 'other owner decode failed',
                 thumbnail_last_attempt_at = 456,
                 invoke_scope_hidden = 1
             WHERE id = 'owner-hidden'",
            [],
        )
        .expect("mark owner-hidden failure");

        let updated = retry_failed_thumbnail_optimizations_for_conn(&conn).expect("retry failures");
        assert_eq!(updated, 1);

        let row = conn
            .query_row(
                "SELECT thumbnail_path, thumbnail_source, thumbnail_version,
                        thumbnail_failure_count, thumbnail_last_error, thumbnail_last_attempt_at
                 FROM scoped_images
                 WHERE id = 'failed'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                    ))
                },
            )
            .expect("failed row");

        assert_eq!(row.0.as_deref(), Some("C:/thumbs/failed.webp"));
        assert_eq!(row.1.as_deref(), Some("ambit"));
        assert_eq!(row.2, CURRENT_THUMBNAIL_VERSION);
        assert_eq!(row.3, 0);
        assert_eq!(row.4, None);
        assert_eq!(row.5, None);

        let ok_failure_count: i64 = conn
            .query_row(
                "SELECT thumbnail_failure_count FROM scoped_images WHERE id = 'ok'",
                [],
                |row| row.get(0),
            )
            .expect("ok failure count");
        assert_eq!(ok_failure_count, 0);

        let hidden_failure_count: i64 = conn
            .query_row(
                "SELECT thumbnail_failure_count FROM images WHERE id = 'owner-hidden'",
                [],
                |row| row.get(0),
            )
            .expect("owner-hidden failure count");
        assert_eq!(
            hidden_failure_count, 2,
            "retry must not reveal or mutate another owner's maintenance state"
        );
    }

    #[test]
    fn pending_results_flush_and_clear_on_completion_or_cancel() {
        let mut conn = setup_queue_db();
        insert_image(&conn, "pending", None, None, 0, 20);
        let mut pending = vec![ThumbnailItemResult::Success {
            id: "pending".to_string(),
            thumbnail_path: "C:/thumbs/pending.webp".to_string(),
            micro_thumbnail: Some("micro".to_string()),
            reused: true,
            processing_ms: 7,
        }];

        let _db_ms =
            flush_pending_thumbnail_results(&mut conn, &mut pending, 100).expect("flush pending");

        assert!(pending.is_empty());

        let row: (String, String, i64) = conn
            .query_row(
                "SELECT thumbnail_path, thumbnail_source, thumbnail_version
                 FROM scoped_images WHERE id = 'pending'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("row");

        assert_eq!(row.0, "C:/thumbs/pending.webp");
        assert_eq!(row.1, "ambit");
        assert_eq!(row.2, CURRENT_THUMBNAIL_VERSION);
    }

    #[test]
    fn optimizer_creates_queue_index_idempotently() {
        let conn = setup_queue_db();

        ensure_thumbnail_queue_index(&conn).expect("create index");
        ensure_thumbnail_queue_index(&conn).expect("create index again");

        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM sqlite_master
                 WHERE type = 'index'
                   AND name = 'idx_images_thumbnail_optimization_queue_v2'",
                [],
                |row| row.get(0),
            )
            .expect("index count");

        assert_eq!(index_count, 1);
    }

    #[test]
    fn cancellation_transition_is_reported_once() {
        let is_cancelled = AtomicBool::new(false);

        assert!(request_thumbnail_cancellation(&is_cancelled));
        assert!(!request_thumbnail_cancellation(&is_cancelled));
    }

    #[test]
    fn empty_or_missing_thumbnail_cache_is_detected() {
        let missing_dir = temp_thumbnail_dir("missing-cache");
        let _ = fs::remove_dir_all(&missing_dir);
        assert!(thumbnail_cache_is_missing_or_empty(
            &missing_dir.to_string_lossy()
        ));

        let empty_dir = temp_thumbnail_dir("empty-cache");
        let _ = fs::remove_dir_all(&empty_dir);
        fs::create_dir_all(&empty_dir).expect("create empty cache dir");
        assert!(thumbnail_cache_is_missing_or_empty(
            &empty_dir.to_string_lossy()
        ));

        let non_empty_dir = temp_thumbnail_dir("non-empty-cache");
        let _ = fs::remove_dir_all(&non_empty_dir);
        fs::create_dir_all(&non_empty_dir).expect("create non-empty cache dir");
        fs::write(non_empty_dir.join("existing.webp"), b"not a real webp").expect("write marker");
        assert!(!thumbnail_cache_is_missing_or_empty(
            &non_empty_dir.to_string_lossy()
        ));

        let _ = fs::remove_dir_all(&empty_dir);
        let _ = fs::remove_dir_all(&non_empty_dir);
    }

    #[test]
    fn empty_cache_marks_current_ambit_rows_stale_for_rebuild() {
        let conn = setup_queue_db();
        insert_image(
            &conn,
            "current",
            Some("C:/thumbs/current.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            20,
        );
        let empty_dir = temp_thumbnail_dir("mark-stale-cache");
        insert_image(
            &conn,
            "owner-hidden",
            Some("C:/thumbs/owner-hidden.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            10,
        );
        conn.execute(
            "UPDATE images SET invoke_scope_hidden = 1 WHERE id = 'owner-hidden'",
            [],
        )
        .expect("hide other-owner row");
        let _ = fs::remove_dir_all(&empty_dir);
        fs::create_dir_all(&empty_dir).expect("create empty cache dir");

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch before mark");
        assert!(rows.is_empty());

        let marked = mark_current_ambit_thumbnails_stale_if_cache_missing_or_empty(
            &conn,
            &empty_dir.to_string_lossy(),
        )
        .expect("mark stale");
        assert_eq!(marked, 1);

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch after mark");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "current");

        let version: i64 = conn
            .query_row(
                "SELECT thumbnail_version FROM scoped_images WHERE id = 'current'",
                [],
                |row| row.get(0),
            )
            .expect("version");
        assert_eq!(version, 0);

        let hidden_version: i64 = conn
            .query_row(
                "SELECT thumbnail_version FROM images WHERE id = 'owner-hidden'",
                [],
                |row| row.get(0),
            )
            .expect("hidden version");
        assert_eq!(
            hidden_version, CURRENT_THUMBNAIL_VERSION,
            "empty-cache maintenance must not mutate another owner's thumbnail state"
        );
        let _ = fs::remove_dir_all(&empty_dir);
    }

    #[test]
    fn non_empty_cache_does_not_mark_current_ambit_rows_stale() {
        let conn = setup_queue_db();
        insert_image(
            &conn,
            "current",
            Some("C:/thumbs/current.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            20,
        );
        let non_empty_dir = temp_thumbnail_dir("skip-mark-cache");
        let _ = fs::remove_dir_all(&non_empty_dir);
        fs::create_dir_all(&non_empty_dir).expect("create cache dir");
        fs::write(non_empty_dir.join("existing.webp"), b"not a real webp").expect("write marker");

        let marked = mark_current_ambit_thumbnails_stale_if_cache_missing_or_empty(
            &conn,
            &non_empty_dir.to_string_lossy(),
        )
        .expect("mark stale");
        assert_eq!(marked, 0);

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch candidates");
        assert!(rows.is_empty());

        let version: i64 = conn
            .query_row(
                "SELECT thumbnail_version FROM scoped_images WHERE id = 'current'",
                [],
                |row| row.get(0),
            )
            .expect("version");
        assert_eq!(version, CURRENT_THUMBNAIL_VERSION);

        let _ = fs::remove_dir_all(&non_empty_dir);
    }

    #[test]
    fn interrupted_cache_rebuild_resumes_remaining_stale_rows() {
        let mut conn = setup_queue_db();
        insert_image(
            &conn,
            "first",
            Some("C:/thumbs/first.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            30,
        );
        insert_image(
            &conn,
            "second",
            Some("C:/thumbs/second.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            20,
        );
        insert_image(
            &conn,
            "third",
            Some("C:/thumbs/third.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            10,
        );
        insert_image(&conn, "owner-hidden", None, None, 0, 50);
        conn.execute(
            "UPDATE images SET invoke_scope_hidden = 1 WHERE id = 'owner-hidden'",
            [],
        )
        .expect("hide other-owner row");
        let empty_dir = temp_thumbnail_dir("resume-cache");
        let _ = fs::remove_dir_all(&empty_dir);
        fs::create_dir_all(&empty_dir).expect("create empty cache dir");

        let marked = mark_current_ambit_thumbnails_stale_if_cache_missing_or_empty(
            &conn,
            &empty_dir.to_string_lossy(),
        )
        .expect("mark stale");
        assert_eq!(marked, 3);

        persist_thumbnail_results(
            &mut conn,
            &[ThumbnailItemResult::Success {
                id: "first".to_string(),
                thumbnail_path: "C:/thumbs/first.webp".to_string(),
                micro_thumbnail: None,
                reused: false,
                processing_ms: 15,
            }],
            100,
        )
        .expect("persist first success");

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch candidates");
        let ids: Vec<String> = rows.into_iter().map(|row| row.id).collect();
        assert_eq!(ids, vec!["second", "third"]);

        let _ = fs::remove_dir_all(&empty_dir);
    }

    #[test]
    fn queue_selects_missing_and_outdated_without_external_upgrades() {
        let conn = setup_queue_db();
        insert_image(&conn, "missing", None, None, 0, 40);
        insert_image(
            &conn,
            "outdated",
            Some("C:/thumbs/outdated.webp"),
            Some("ambit"),
            0,
            30,
        );
        insert_image(
            &conn,
            "external",
            Some("C:/invoke/thumb.webp"),
            Some("invokeai"),
            0,
            20,
        );
        insert_image(
            &conn,
            "current",
            Some("C:/thumbs/current.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            10,
        );

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch candidates");
        let ids: Vec<String> = rows.into_iter().map(|row| row.id).collect();

        assert_eq!(
            ids,
            vec!["missing", "outdated"],
            "thumbnail work must not disclose another owner's queued rows"
        );
    }

    #[test]
    fn queue_carries_registered_invoke_root_from_source_identity() {
        let conn = setup_queue_db();
        insert_image(&conn, "invoke-owned", None, None, 0, 40);
        conn.execute_batch(
            "INSERT INTO invoke_owner_scope_state (state_key, db_path, images_root)
             VALUES ('current', 'D:/Invoke/databases/invokeai.db', 'D:/Invoke');
             UPDATE images
             SET invoke_source_id = 'd:/invoke/databases/invokeai.db'
             WHERE id = 'invoke-owned';",
        )
        .expect("invoke source state");

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch candidates");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].invoke_images_root.as_deref(), Some("D:/Invoke"));
    }

    #[test]
    fn queue_never_selects_video_posters_for_image_optimization() {
        let conn = setup_queue_db();
        insert_image(&conn, "video", None, None, 0, 40);
        conn.execute(
            "UPDATE images SET media_type = 'video' WHERE id = 'video'",
            [],
        )
        .expect("mark video");

        let rows =
            fetch_thumbnail_candidates(&conn, true, None, 10, 10_000).expect("fetch candidates");

        assert!(rows.is_empty());
    }

    #[test]
    fn queue_includes_external_thumbnails_when_upgrade_mode_is_enabled() {
        let conn = setup_queue_db();
        insert_image(
            &conn,
            "external",
            Some("C:/invoke/thumb.webp"),
            Some("invokeai"),
            0,
            20,
        );

        let rows =
            fetch_thumbnail_candidates(&conn, true, None, 10, 10_000).expect("fetch candidates");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "external");
    }

    #[test]
    fn queue_skips_recent_failures_until_backoff_expires() {
        let conn = setup_queue_db();
        insert_image(&conn, "failed", None, None, 0, 20);
        conn.execute(
            "UPDATE images
             SET thumbnail_failure_count = 1,
                 thumbnail_last_attempt_at = ?1
             WHERE id = 'failed'",
            params![10_000 - 10],
        )
        .expect("mark failed");

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch candidates");
        assert!(rows.is_empty());

        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000 + FAILURE_BACKOFF_MS + 1)
                .expect("fetch after backoff");
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn success_clears_failure_metadata() {
        let mut conn = setup_queue_db();
        insert_image(&conn, "fixed", None, None, 0, 20);
        conn.execute(
            "UPDATE images
             SET thumbnail_failure_count = 2,
                 thumbnail_last_error = 'decode failed',
                 thumbnail_last_attempt_at = 42
             WHERE id = 'fixed'",
            [],
        )
        .expect("mark failed");

        let stats = persist_thumbnail_results(
            &mut conn,
            &[ThumbnailItemResult::Success {
                id: "fixed".to_string(),
                thumbnail_path: "C:/thumbs/fixed.webp".to_string(),
                micro_thumbnail: None,
                reused: false,
                processing_ms: 25,
            }],
            100,
        )
        .expect("persist success");

        assert_eq!(stats.checked, 1);
        assert_eq!(stats.optimized, 1);

        let row: (String, String, i64, i64, Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT thumbnail_path, thumbnail_source, thumbnail_version,
                        thumbnail_failure_count, thumbnail_last_error, thumbnail_last_attempt_at
                 FROM scoped_images WHERE id = 'fixed'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("row");

        assert_eq!(row.0, "C:/thumbs/fixed.webp");
        assert_eq!(row.1, "ambit");
        assert_eq!(row.2, CURRENT_THUMBNAIL_VERSION);
        assert_eq!(row.3, 0);
        assert_eq!(row.4, None);
        assert_eq!(row.5, None);
    }

    #[test]
    fn absent_source_becomes_missing_without_losing_its_cached_thumbnail() {
        let mut conn = setup_queue_db();
        insert_image(
            &conn,
            "gone",
            Some("C:/invoke/thumbs/gone.webp"),
            Some("invokeai"),
            0,
            20,
        );
        let candidate = fetch_thumbnail_candidates(&conn, true, None, 10, 10_000)
            .expect("fetch candidate")
            .into_iter()
            .next()
            .expect("candidate");

        let item = optimize_thumbnail_candidate(
            &candidate,
            &temp_thumbnail_dir("missing-source").to_string_lossy(),
            &AtomicBool::new(false),
        );
        assert!(matches!(item, ThumbnailItemResult::MissingSource { .. }));

        let stats =
            persist_thumbnail_results(&mut conn, &[item], 100).expect("persist missing source");
        assert_eq!(stats.checked, 1);
        assert_eq!(stats.missing, 1);
        assert_eq!(stats.failed, 0);

        let row: (i64, String, i64, Option<String>) = conn
            .query_row(
                "SELECT is_missing, thumbnail_path, thumbnail_failure_count,
                        thumbnail_last_error
                 FROM images WHERE id = 'gone'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("missing row");
        assert_eq!(row, (1, "C:/invoke/thumbs/gone.webp".to_string(), 0, None));
    }

    #[test]
    fn missing_batch_invalidates_each_scope_once_without_row_trigger_work() {
        let mut conn = setup_queue_db();
        conn.execute_batch(
            "
            CREATE TABLE invoke_scope_cache_control (
                state_key TEXT PRIMARY KEY,
                suppress_invalidation INTEGER NOT NULL
            );
            INSERT INTO invoke_scope_cache_control VALUES ('current', 0);
            CREATE TABLE invoke_scope_cache_state (
                scope_key TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                generation INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            INSERT INTO invoke_scope_cache_state VALUES ('scope-a', 'ready', 4, 0);
            CREATE TABLE invoke_scope_cache_dirty_items (
                scope_key TEXT NOT NULL,
                domain TEXT NOT NULL,
                facet_type TEXT NOT NULL DEFAULT '',
                resource_name TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (scope_key, domain, facet_type, resource_name)
            ) WITHOUT ROWID;
            CREATE VIEW invoke_scope_cache_visible_image_scopes AS
                SELECT images.id AS image_id, invoke_scope_cache_state.scope_key
                FROM images CROSS JOIN invoke_scope_cache_state;
            CREATE TABLE row_trigger_audit (count INTEGER NOT NULL);
            INSERT INTO row_trigger_audit VALUES (0);
            CREATE TRIGGER audit_missing_row_update
            AFTER UPDATE OF is_missing ON images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control
                  WHERE state_key = 'current') = 0
            BEGIN
                UPDATE row_trigger_audit SET count = count + 1;
            END;
            ",
        )
        .expect("scope cache schema");
        insert_image(&conn, "gone-a", None, None, 0, 20);
        insert_image(&conn, "gone-b", None, None, 0, 10);

        persist_thumbnail_results(
            &mut conn,
            &[
                ThumbnailItemResult::MissingSource {
                    id: "gone-a".to_string(),
                },
                ThumbnailItemResult::MissingSource {
                    id: "gone-b".to_string(),
                },
            ],
            100,
        )
        .expect("persist missing batch");

        let row_trigger_count: i64 = conn
            .query_row("SELECT count FROM row_trigger_audit", [], |row| row.get(0))
            .expect("row trigger count");
        let scope: (String, i64) = conn
            .query_row(
                "SELECT status, generation FROM invoke_scope_cache_state WHERE scope_key = 'scope-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("scope state");
        let full_dirty_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items
                 WHERE scope_key = 'scope-a' AND domain = 'full'",
                [],
                |row| row.get(0),
            )
            .expect("dirty count");

        assert_eq!(row_trigger_count, 0);
        assert_eq!(scope, ("dirty".to_string(), 5));
        assert_eq!(full_dirty_count, 1);
    }

    #[test]
    fn migrated_schema_scales_missing_reconciliation_per_scope_and_uses_queue_index() {
        const IMAGE_COUNT: usize = 2_000;
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        for migration in crate::db::migrations::init_db() {
            conn.execute_batch(&migration.sql)
                .expect("apply production migration");
        }
        ensure_thumbnail_queue_index(&conn).expect("queue index");

        conn.execute_batch(
            "INSERT INTO invoke_owner_scope_state (
                 state_key, db_path, images_root, scope_mode, owner_id, updated_at
             ) VALUES ('current', 'D:/Invoke/databases/invokeai.db', 'D:/Invoke',
                       'legacy', NULL, 1);
             INSERT INTO invoke_scope_cache_state (
                 scope_key, db_path, images_root, scope_mode, owner_id,
                 status, generation, built_generation, updated_at
             ) VALUES ('scope-a', 'D:/Invoke/databases/invokeai.db', 'D:/Invoke',
                       'legacy', NULL, 'ready', 7, 7, 1);
             UPDATE invoke_scope_cache_control
             SET active_scope_key = 'scope-a'
             WHERE state_key = 'current';",
        )
        .expect("scope state");

        {
            let tx = conn.transaction().expect("seed transaction");
            {
                let mut insert = tx
                    .prepare(
                        "INSERT INTO images (id, path, timestamp)
                         VALUES (?1, ?2, ?3)",
                    )
                    .expect("seed statement");
                for index in 0..IMAGE_COUNT {
                    let id = format!("missing-{index:04}");
                    insert
                        .execute(params![
                            id,
                            format!("D:/library/{index:04}.png"),
                            index as i64
                        ])
                        .expect("seed image");
                }
            }
            tx.commit().expect("seed commit");
        }

        conn.execute_batch(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', generation = 7, built_generation = 7
             WHERE scope_key = 'scope-a';
             DELETE FROM invoke_scope_cache_dirty_items;",
        )
        .expect("reset scope state");

        let plan_sql = format!(
            "EXPLAIN QUERY PLAN
             SELECT i.id, i.path, COALESCE(i.timestamp, 0)
             FROM scoped_images i
             WHERE {}
             ORDER BY timestamp DESC, id DESC
             LIMIT 100",
            thumbnail_queue_condition(false, 10_000)
        );
        let plan_details = conn
            .prepare(&plan_sql)
            .expect("plan statement")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("plan details");
        assert!(
            plan_details
                .iter()
                .any(|detail| detail.contains("idx_images_thumbnail_optimization_queue_v2")),
            "candidate query must use its queue index: {plan_details:?}"
        );

        let results = (0..IMAGE_COUNT)
            .map(|index| ThumbnailItemResult::MissingSource {
                id: format!("missing-{index:04}"),
            })
            .collect::<Vec<_>>();
        let stats =
            persist_thumbnail_results(&mut conn, &results, 100).expect("persist missing batch");

        let scope_state: (String, i64) = conn
            .query_row(
                "SELECT status, generation
                 FROM invoke_scope_cache_state
                 WHERE scope_key = 'scope-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("scope result");
        let full_dirty_count: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM invoke_scope_cache_dirty_items
                 WHERE scope_key = 'scope-a' AND domain = 'full'",
                [],
                |row| row.get(0),
            )
            .expect("dirty count");
        let missing_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM images WHERE is_missing = 1",
                [],
                |row| row.get(0),
            )
            .expect("missing count");
        let suppression: i64 = conn
            .query_row(
                "SELECT suppress_invalidation
                 FROM invoke_scope_cache_control
                 WHERE state_key = 'current'",
                [],
                |row| row.get(0),
            )
            .expect("suppression state");

        assert_eq!(stats.missing, IMAGE_COUNT);
        assert_eq!(missing_count, IMAGE_COUNT as i64);
        assert_eq!(scope_state, ("dirty".to_string(), 8));
        assert_eq!(full_dirty_count, 1);
        assert_eq!(suppression, 0);
    }

    #[test]
    fn unavailable_invoke_root_is_skipped_instead_of_marking_every_image_missing() {
        let invoke_root = temp_thumbnail_dir("offline-invoke-root");
        let _ = fs::remove_dir_all(&invoke_root);
        let candidate = ThumbnailCandidate {
            id: "offline".to_string(),
            path: invoke_root
                .join("outputs")
                .join("images")
                .join("offline.png")
                .to_string_lossy()
                .to_string(),
            timestamp: 1,
            invoke_images_root: Some(invoke_root.to_string_lossy().to_string()),
            source_root_available: Some(false),
        };

        let item = optimize_thumbnail_candidate(
            &candidate,
            &temp_thumbnail_dir("offline-thumbs").to_string_lossy(),
            &AtomicBool::new(false),
        );

        assert!(matches!(item, ThumbnailItemResult::Skipped));
    }

    #[test]
    fn shared_unavailable_managed_root_is_probed_once_for_all_candidates() {
        let root = "D:/Offline Library".to_string();
        let mut candidates = vec![
            ThumbnailCandidate {
                id: "offline-a".to_string(),
                path: "D:/Offline Library/a.png".to_string(),
                timestamp: 2,
                invoke_images_root: None,
                source_root_available: None,
            },
            ThumbnailCandidate {
                id: "offline-b".to_string(),
                path: "D:/Offline Library/nested/b.png".to_string(),
                timestamp: 1,
                invoke_images_root: None,
                source_root_available: None,
            },
        ];
        let mut availability = HashMap::new();
        let mut probe_count = 0;

        resolve_candidate_source_roots(&mut candidates, &[root], &mut availability, |_| {
            probe_count += 1;
            false
        });

        assert_eq!(probe_count, 1);
        assert!(candidates
            .iter()
            .all(|candidate| candidate.source_root_available == Some(false)));
        assert!(candidates.iter().all(|candidate| matches!(
            optimize_thumbnail_candidate(
                candidate,
                &temp_thumbnail_dir("offline-managed-thumbs").to_string_lossy(),
                &AtomicBool::new(false),
            ),
            ThumbnailItemResult::Skipped
        )));
    }

    #[test]
    fn managed_root_matching_uses_path_boundaries_and_the_most_specific_root() {
        let roots = vec!["D:/Library".to_string(), "D:/Library/Nested".to_string()];

        assert_eq!(
            most_specific_source_root("d:\\library\\nested\\image.png", &roots),
            Some(&roots[1])
        );
        assert_eq!(
            most_specific_source_root("D:/Library-Archive/image.png", &roots),
            None
        );
        assert!(path_is_within_root("/library/image.png", "/"));
    }

    #[test]
    fn non_invoke_lookalike_path_is_marked_missing() {
        let library_root = temp_thumbnail_dir("non-invoke-lookalike");
        let candidate = ThumbnailCandidate {
            id: "ordinary-library-image".to_string(),
            path: library_root
                .join("outputs")
                .join("images")
                .join("missing.png")
                .to_string_lossy()
                .to_string(),
            timestamp: 1,
            invoke_images_root: None,
            source_root_available: None,
        };

        let item = optimize_thumbnail_candidate(
            &candidate,
            &temp_thumbnail_dir("unused-thumb-output").to_string_lossy(),
            &AtomicBool::new(false),
        );

        assert!(matches!(item, ThumbnailItemResult::MissingSource { .. }));
    }

    #[test]
    fn persistence_rechecks_scope_after_candidate_processing() {
        let mut conn = setup_queue_db();
        insert_image(&conn, "success", None, None, 0, 20);
        insert_image(&conn, "failure", None, None, 0, 10);

        let candidates =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch candidates");
        assert_eq!(candidates.len(), 2);
        conn.execute(
            "UPDATE images SET invoke_scope_hidden = 1 WHERE id IN ('success', 'failure')",
            [],
        )
        .expect("switch owner scope after candidate fetch");

        persist_thumbnail_results(
            &mut conn,
            &[
                ThumbnailItemResult::Success {
                    id: "success".to_string(),
                    thumbnail_path: "C:/thumbs/success.webp".to_string(),
                    micro_thumbnail: Some("micro".to_string()),
                    reused: false,
                    processing_ms: 10,
                },
                ThumbnailItemResult::Failed {
                    id: "failure".to_string(),
                    error: "decode failed".to_string(),
                },
            ],
            100,
        )
        .expect("persist processed candidates");

        let success: (Option<String>, Option<String>, i64) = conn
            .query_row(
                "SELECT thumbnail_path, thumbnail_source, thumbnail_version
                 FROM images WHERE id = 'success'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("hidden success row");
        assert_eq!(success, (None, None, 0));

        let failure: (i64, Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT thumbnail_failure_count, thumbnail_last_error, thumbnail_last_attempt_at
                 FROM images WHERE id = 'failure'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("hidden failure row");
        assert_eq!(failure, (0, None, None));
    }

    #[test]
    fn cancelled_items_are_skipped_before_processing() {
        let conn = setup_queue_db();
        insert_image(&conn, "missing", None, None, 0, 20);
        let rows =
            fetch_thumbnail_candidates(&conn, false, None, 10, 10_000).expect("fetch candidates");
        let is_cancelled = AtomicBool::new(true);

        let result = optimize_thumbnail_candidate(&rows[0], "C:/thumbs", &is_cancelled);

        assert!(matches!(result, ThumbnailItemResult::Skipped));
    }
}
