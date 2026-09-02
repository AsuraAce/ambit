use rayon::prelude::*;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri_specta::Event as SpectaEvent;

const CURRENT_THUMBNAIL_VERSION: i64 = 1;
const FAILURE_BACKOFF_MS: i64 = 60 * 60 * 1000;
const DB_FLUSH_LIMIT: usize = 100;
const DB_FLUSH_INTERVAL: Duration = Duration::from_secs(5);
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_secs(1);
const SOURCE_ROOT_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const SOURCE_ROOT_CANCEL_POLL: Duration = Duration::from_millis(50);
const MAX_SOURCE_ROOT_PROBE_WORKERS: usize = 4;
static SOURCE_ROOT_PROBE_REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
const THROTTLED_WORKER_CHUNK_SIZE: usize = 4;
const THROTTLED_CHUNK_SLEEP: Duration = Duration::from_millis(250);
const MAX_FAILURE_DIAGNOSTIC_LIMIT: usize = 50;
const MAX_REPAIR_BATCH_SIZE: usize = 1000;
const MANUAL_OPERATION_ACQUIRE_TIMEOUT: Duration = Duration::from_secs(60);
const MANUAL_OPERATION_ACQUIRE_POLL: Duration = Duration::from_millis(25);

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ThumbnailOptimizationPhase {
    Discovering,
    Processing,
    Persisting,
    Throttled,
    Complete,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailOptimizationProgress {
    pub checked: usize,
    pub total: Option<usize>,
    pub optimized: usize,
    pub reused: usize,
    pub missing: usize,
    pub failed: usize,
    pub skipped: usize,
    pub images_per_second: f64,
    pub batch_ms: u64,
    pub db_ms: u64,
    pub encode_ms: u64,
    pub candidate_fetch_ms: u64,
    pub profile: ThumbnailOptimizationProfile,
    pub phase: ThumbnailOptimizationPhase,
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

#[derive(Clone, Debug, serde::Serialize, specta::Type, tauri_specta::Event)]
pub struct ThumbnailOptimizationComplete(pub ThumbnailOptimizationResult);

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

#[derive(Clone, Debug, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailRepairBatchInput {
    pub operation_id: u64,
    pub ids: Vec<String>,
    pub thumbnail_dir: String,
    #[serde(default)]
    pub source_roots: Vec<String>,
    pub force: bool,
    pub respect_backoff: bool,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailRepairUpdate {
    pub id: String,
    pub thumbnail_path: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailRepairBatchResult {
    pub requested: usize,
    pub checked: usize,
    pub optimized: usize,
    pub reused: usize,
    pub missing: usize,
    pub failed: usize,
    pub skipped: usize,
    pub was_cancelled: bool,
    pub duration_ms: u64,
    pub candidate_fetch_ms: u64,
    pub db_ms: u64,
    pub encode_ms: u64,
    pub updates: Vec<ThumbnailRepairUpdate>,
}

pub struct ThumbnailOptimizationState {
    pub is_cancelled: Arc<AtomicBool>,
    pub is_running: Arc<AtomicBool>,
    pub is_throttled: Arc<AtomicBool>,
    manual_operation: Arc<Mutex<Option<ManualThumbnailOperation>>>,
    next_operation_id: Arc<AtomicU64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ManualThumbnailOperation {
    id: u64,
    batch_active: bool,
}

struct ThumbnailJobLease {
    is_running: Arc<AtomicBool>,
}

impl Drop for ThumbnailJobLease {
    fn drop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}

fn acquire_thumbnail_job(is_running: Arc<AtomicBool>) -> Result<ThumbnailJobLease, String> {
    if is_running.swap(true, Ordering::SeqCst) {
        return Err("Another thumbnail repair job is already running".to_string());
    }
    Ok(ThumbnailJobLease { is_running })
}

impl Default for ThumbnailOptimizationState {
    fn default() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
            is_running: Arc::new(AtomicBool::new(false)),
            is_throttled: Arc::new(AtomicBool::new(false)),
            manual_operation: Arc::new(Mutex::new(None)),
            next_operation_id: Arc::new(AtomicU64::new(1)),
        }
    }
}

struct ManualThumbnailBatchLease {
    operation_id: u64,
    manual_operation: Arc<Mutex<Option<ManualThumbnailOperation>>>,
}

impl Drop for ManualThumbnailBatchLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.manual_operation.lock() {
            if let Some(operation) = active.as_mut() {
                if operation.id == self.operation_id {
                    operation.batch_active = false;
                }
            }
        }
    }
}

fn begin_manual_thumbnail_operation(
    is_cancelled: &AtomicBool,
    is_running: &AtomicBool,
    manual_operation: &Mutex<Option<ManualThumbnailOperation>>,
    next_operation_id: &AtomicU64,
) -> Result<u64, String> {
    let started_at = Instant::now();
    loop {
        {
            let mut active = manual_operation
                .lock()
                .map_err(|_| "Thumbnail operation state is unavailable".to_string())?;
            if active.is_some() {
                return Err(
                    "Another manual thumbnail repair operation is already running".to_string(),
                );
            }
            if is_running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                let operation_id = next_operation_id.fetch_add(1, Ordering::SeqCst);
                *active = Some(ManualThumbnailOperation {
                    id: operation_id,
                    batch_active: false,
                });
                is_cancelled.store(false, Ordering::SeqCst);
                return Ok(operation_id);
            }
        }

        is_cancelled.store(true, Ordering::SeqCst);
        if started_at.elapsed() >= MANUAL_OPERATION_ACQUIRE_TIMEOUT {
            return Err("Timed out waiting for Smart Thumbnails to stop".to_string());
        }
        std::thread::sleep(MANUAL_OPERATION_ACQUIRE_POLL);
    }
}

fn claim_manual_thumbnail_batch(
    manual_operation: Arc<Mutex<Option<ManualThumbnailOperation>>>,
    operation_id: u64,
) -> Result<ManualThumbnailBatchLease, String> {
    {
        let mut active = manual_operation
            .lock()
            .map_err(|_| "Thumbnail operation state is unavailable".to_string())?;
        let operation = active
            .as_mut()
            .filter(|operation| operation.id == operation_id)
            .ok_or_else(|| "Thumbnail repair operation is no longer active".to_string())?;
        if operation.batch_active {
            return Err(
                "Another batch is already running for this thumbnail repair operation".to_string(),
            );
        }
        operation.batch_active = true;
    }
    Ok(ManualThumbnailBatchLease {
        operation_id,
        manual_operation,
    })
}

fn finish_manual_thumbnail_operation(
    is_cancelled: &AtomicBool,
    is_running: &AtomicBool,
    manual_operation: &Mutex<Option<ManualThumbnailOperation>>,
    operation_id: u64,
) -> Result<(), String> {
    let mut active = manual_operation
        .lock()
        .map_err(|_| "Thumbnail operation state is unavailable".to_string())?;
    let operation = active
        .as_ref()
        .filter(|operation| operation.id == operation_id)
        .ok_or_else(|| "Thumbnail repair operation is no longer active".to_string())?;
    if operation.batch_active {
        return Err(
            "Cannot finish a thumbnail repair operation while a batch is running".to_string(),
        );
    }
    *active = None;
    is_cancelled.store(false, Ordering::SeqCst);
    is_running.store(false, Ordering::SeqCst);
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ThumbnailCandidate {
    id: String,
    path: String,
    timestamp: i64,
    thumbnail_path: Option<String>,
    invoke_images_root: Option<String>,
    source_root: Option<String>,
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
        source_root: Option<String>,
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
    encode_ms: u128,
    updates: Vec<ThumbnailRepairUpdate>,
}

struct SourceRootProbeGuard {
    registry: &'static OnceLock<Mutex<HashSet<String>>>,
    key: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SourceRootProbeResult {
    Available,
    Unavailable,
    Busy,
    Cancelled,
}

impl Drop for SourceRootProbeGuard {
    fn drop(&mut self) {
        if let Ok(mut in_flight) = self
            .registry
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
        {
            in_flight.remove(&self.key);
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn start_thumbnail_optimization_job(
    app: tauri::AppHandle,
    state: tauri::State<'_, ThumbnailOptimizationState>,
    config: ThumbnailOptimizationConfig,
) -> Result<ThumbnailOptimizationResult, String> {
    let job_lease = acquire_thumbnail_job(state.is_running.clone())?;

    state.is_cancelled.store(false, Ordering::SeqCst);
    state.is_throttled.store(false, Ordering::SeqCst);
    let is_cancelled = state.is_cancelled.clone();
    let is_throttled = state.is_throttled.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let _job_lease = job_lease;
        run_thumbnail_optimization_job(app, is_cancelled, is_throttled, config)
    })
    .await
    .map_err(|e| e.to_string())?;

    result
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn begin_thumbnail_repair_operation(
    state: tauri::State<'_, ThumbnailOptimizationState>,
) -> Result<u64, String> {
    let is_cancelled = state.is_cancelled.clone();
    let is_running = state.is_running.clone();
    let manual_operation = state.manual_operation.clone();
    let next_operation_id = state.next_operation_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        begin_manual_thumbnail_operation(
            is_cancelled.as_ref(),
            is_running.as_ref(),
            manual_operation.as_ref(),
            next_operation_id.as_ref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn finish_thumbnail_repair_operation(
    state: tauri::State<'_, ThumbnailOptimizationState>,
    operation_id: u64,
) -> Result<(), String> {
    finish_manual_thumbnail_operation(
        state.is_cancelled.as_ref(),
        state.is_running.as_ref(),
        state.manual_operation.as_ref(),
        operation_id,
    )
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn repair_thumbnail_batch(
    app: tauri::AppHandle,
    state: tauri::State<'_, ThumbnailOptimizationState>,
    input: ThumbnailRepairBatchInput,
) -> Result<ThumbnailRepairBatchResult, String> {
    if input.ids.len() > MAX_REPAIR_BATCH_SIZE {
        return Err(format!(
            "Thumbnail repair batch exceeds the {MAX_REPAIR_BATCH_SIZE}-image limit"
        ));
    }

    let batch_lease =
        claim_manual_thumbnail_batch(state.manual_operation.clone(), input.operation_id)?;
    let is_cancelled = state.is_cancelled.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _batch_lease = batch_lease;
        run_thumbnail_repair_batch(app, is_cancelled, input)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_thumbnail_optimization_job(
    state: tauri::State<'_, ThumbnailOptimizationState>,
    operation_id: Option<u64>,
) {
    let should_cancel =
        state
            .manual_operation
            .lock()
            .ok()
            .is_some_and(|active| match active.as_ref() {
                Some(operation) => operation_id == Some(operation.id),
                None => operation_id.is_none() && state.is_running.load(Ordering::SeqCst),
            });
    if should_cancel && request_thumbnail_cancellation(state.is_cancelled.as_ref()) {
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
        &build_progress_payload(
            &result,
            started_at,
            config.profile,
            0,
            0,
            0,
            0,
            ThumbnailOptimizationPhase::Discovering,
            false,
        ),
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

    let mut cursor: Option<ThumbnailCursor> = None;
    let mut pending_results: Vec<ThumbnailItemResult> = Vec::with_capacity(DB_FLUSH_LIMIT);
    let mut last_progress_at = Instant::now();
    let mut last_flush_at = Instant::now();
    let mut last_batch_ms = 0;
    let mut last_db_ms = 0;
    let mut last_candidate_fetch_ms = 0;
    let mut encode_ms_since_progress = 0_u128;
    let mut source_root_availability = HashMap::new();

    while !is_cancelled.load(Ordering::SeqCst) {
        let candidate_fetch_started_at = Instant::now();
        let mut candidates = fetch_thumbnail_candidates(
            &conn,
            config.include_upgradeable,
            cursor.as_ref(),
            fetch_limit,
            unix_time_ms(),
        )?;
        last_candidate_fetch_ms = elapsed_ms(candidate_fetch_started_at);

        if candidates.is_empty() {
            break;
        }

        if !resolve_candidate_source_roots(
            &mut candidates,
            &config.source_roots,
            &mut source_root_availability,
            is_cancelled.as_ref(),
            probe_source_root_availability,
        ) {
            break;
        }

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

            let mut chunk_results = Vec::with_capacity(end - index);
            process_candidate_chunk(
                &pool,
                &candidates[index..end],
                &config.thumbnail_dir,
                false,
                is_cancelled.as_ref(),
                |item| {
                    chunk_results.push(item);
                    Ok(())
                },
            )?;
            revalidate_missing_source_roots(
                &mut chunk_results,
                &mut source_root_availability,
                is_cancelled.as_ref(),
                probe_source_root_availability,
            );

            for item in chunk_results {
                encode_ms_since_progress += accumulate_thumbnail_result(&mut result, &item);

                if !matches!(item, ThumbnailItemResult::Skipped) {
                    pending_results.push(item);
                }

                if pending_results.len() >= DB_FLUSH_LIMIT
                    || last_flush_at.elapsed() >= DB_FLUSH_INTERVAL
                {
                    emit_progress(
                        &app,
                        &build_progress_payload(
                            &result,
                            started_at,
                            config.profile,
                            last_batch_ms,
                            last_db_ms,
                            millis_to_u64(encode_ms_since_progress),
                            last_candidate_fetch_ms,
                            ThumbnailOptimizationPhase::Persisting,
                            is_throttled.load(Ordering::SeqCst),
                        ),
                    );
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
                            last_candidate_fetch_ms,
                            if is_throttled.load(Ordering::SeqCst) {
                                ThumbnailOptimizationPhase::Throttled
                            } else {
                                ThumbnailOptimizationPhase::Processing
                            },
                            is_throttled.load(Ordering::SeqCst),
                        ),
                    );
                    encode_ms_since_progress = 0;
                    last_progress_at = Instant::now();
                }
            }

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
            last_candidate_fetch_ms,
            ThumbnailOptimizationPhase::Complete,
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

fn run_thumbnail_repair_batch(
    app: tauri::AppHandle,
    is_cancelled: Arc<AtomicBool>,
    input: ThumbnailRepairBatchInput,
) -> Result<ThumbnailRepairBatchResult, String> {
    let started_at = Instant::now();
    let requested = input.ids.iter().collect::<HashSet<_>>().len();
    if requested == 0 {
        return Ok(ThumbnailRepairBatchResult::default());
    }

    let db_path = crate::db::resolve_db_path(&app)?;
    let mut conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    crate::db::configure_connection(&conn).map_err(|error| error.to_string())?;
    conn.busy_timeout(Duration::from_secs(60))
        .map_err(|error| error.to_string())?;

    let candidate_fetch_started_at = Instant::now();
    let mut candidates = load_thumbnail_candidates_for_ids(
        &conn,
        &input.ids,
        input.force,
        input.respect_backoff,
        unix_time_ms(),
    )?;
    let candidate_fetch_ms = elapsed_ms(candidate_fetch_started_at);
    let mut source_root_availability = HashMap::new();
    if !resolve_candidate_source_roots(
        &mut candidates,
        &input.source_roots,
        &mut source_root_availability,
        is_cancelled.as_ref(),
        probe_source_root_availability,
    ) {
        return Ok(ThumbnailRepairBatchResult {
            requested,
            was_cancelled: true,
            duration_ms: elapsed_ms(started_at),
            candidate_fetch_ms,
            ..ThumbnailRepairBatchResult::default()
        });
    }

    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(ThumbnailOptimizationProfile::Fast.worker_count())
        .stack_size(8 * 1024 * 1024)
        .build()
        .map_err(|error| error.to_string())?;
    let mut outcomes = Vec::with_capacity(candidates.len());
    process_candidate_chunk(
        &pool,
        &candidates,
        &input.thumbnail_dir,
        input.force,
        is_cancelled.as_ref(),
        |item| {
            outcomes.push(item);
            Ok(())
        },
    )?;
    revalidate_missing_source_roots(
        &mut outcomes,
        &mut source_root_availability,
        is_cancelled.as_ref(),
        probe_source_root_availability,
    );

    let mut result = ThumbnailOptimizationResult::default();
    let mut encode_ms = 0_u128;
    for outcome in &outcomes {
        encode_ms += accumulate_thumbnail_result(&mut result, outcome);
    }

    let db_started_at = Instant::now();
    let persisted = persist_thumbnail_results(&mut conn, &outcomes, unix_time_ms())?;
    let db_ms = elapsed_ms(db_started_at);
    let duration_ms = elapsed_ms(started_at);
    let batch_result = ThumbnailRepairBatchResult {
        requested,
        checked: persisted.checked + result.skipped,
        optimized: persisted.optimized,
        reused: persisted.reused,
        missing: persisted.missing,
        failed: persisted.failed,
        skipped: result.skipped,
        was_cancelled: is_cancelled.load(Ordering::SeqCst),
        duration_ms,
        candidate_fetch_ms,
        db_ms,
        encode_ms: millis_to_u64(encode_ms),
        updates: persisted.updates,
    };

    log::info!(
        "[ThumbnailRepair] Batch complete. requested={}, checked={}, optimized={}, reused={}, missing={}, failed={}, skipped={}, force={}, respect_backoff={}, candidate_fetch_ms={}, encode_ms={}, db_ms={}, duration_ms={}",
        batch_result.requested,
        batch_result.checked,
        batch_result.optimized,
        batch_result.reused,
        batch_result.missing,
        batch_result.failed,
        batch_result.skipped,
        input.force,
        input.respect_backoff,
        batch_result.candidate_fetch_ms,
        batch_result.encode_ms,
        batch_result.db_ms,
        batch_result.duration_ms,
    );

    Ok(batch_result)
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

fn process_candidate_chunk<F>(
    pool: &rayon::ThreadPool,
    candidates: &[ThumbnailCandidate],
    thumbnail_dir: &str,
    force: bool,
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
                        let item = optimize_thumbnail_candidate(
                            candidate,
                            thumbnail_dir,
                            force,
                            is_cancelled,
                        );
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
    candidate_fetch_ms: u64,
    phase: ThumbnailOptimizationPhase,
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
        total: None,
        optimized: result.optimized,
        reused: result.reused,
        missing: result.missing,
        failed: result.failed,
        skipped: result.skipped,
        images_per_second,
        batch_ms,
        db_ms,
        encode_ms,
        candidate_fetch_ms,
        profile,
        phase,
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
    force: bool,
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
                source_root: candidate.source_root.clone(),
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

    match super::generate_thumbnail_for_repair(
        &candidate.path,
        thumbnail_dir,
        force,
        candidate.thumbnail_path.as_deref(),
    ) {
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
    is_cancelled: &AtomicBool,
    mut probe: F,
) -> bool
where
    F: FnMut(&Path, &AtomicBool) -> SourceRootProbeResult,
{
    for candidate in candidates {
        if is_cancelled.load(Ordering::SeqCst) {
            return false;
        }
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
            candidate.source_root = None;
            candidate.source_root_available = None;
            continue;
        };
        candidate.source_root = Some(source_root.clone());
        let key = normalize_source_root_identity(&source_root);
        let is_root_available = match availability.get(&key) {
            Some(is_available) => *is_available,
            None => {
                let is_root_available = match probe(Path::new(&source_root), is_cancelled) {
                    SourceRootProbeResult::Available => true,
                    SourceRootProbeResult::Unavailable => false,
                    SourceRootProbeResult::Busy => {
                        candidate.source_root_available = Some(false);
                        continue;
                    }
                    SourceRootProbeResult::Cancelled => return false,
                };
                availability.insert(key, is_root_available);
                is_root_available
            }
        };
        candidate.source_root_available = Some(is_root_available);
    }
    true
}

fn probe_source_root_availability(path: &Path, is_cancelled: &AtomicBool) -> SourceRootProbeResult {
    let path = path.to_path_buf();
    let key = normalize_source_root_identity(&path.to_string_lossy());
    run_cancellable_probe(
        &SOURCE_ROOT_PROBE_REGISTRY,
        key,
        is_cancelled,
        SOURCE_ROOT_PROBE_TIMEOUT,
        move || path.is_dir(),
    )
}

fn run_cancellable_probe<F>(
    registry: &'static OnceLock<Mutex<HashSet<String>>>,
    key: String,
    is_cancelled: &AtomicBool,
    timeout: Duration,
    probe: F,
) -> SourceRootProbeResult
where
    F: FnOnce() -> bool + Send + 'static,
{
    if is_cancelled.load(Ordering::SeqCst) {
        return SourceRootProbeResult::Cancelled;
    }
    {
        let Ok(mut in_flight) = registry.get_or_init(|| Mutex::new(HashSet::new())).lock() else {
            return SourceRootProbeResult::Busy;
        };
        if in_flight.contains(&key) || in_flight.len() >= MAX_SOURCE_ROOT_PROBE_WORKERS {
            return SourceRootProbeResult::Busy;
        }
        in_flight.insert(key.clone());
    }
    let guard = SourceRootProbeGuard { registry, key };
    let (sender, receiver) = mpsc::sync_channel(1);
    if std::thread::Builder::new()
        .name("thumbnail-source-root-probe".to_string())
        .spawn(move || {
            let _guard = guard;
            let _ = sender.send(probe());
        })
        .is_err()
    {
        return SourceRootProbeResult::Unavailable;
    }
    let started_at = Instant::now();
    loop {
        if is_cancelled.load(Ordering::SeqCst) {
            return SourceRootProbeResult::Cancelled;
        }
        let remaining = timeout.saturating_sub(started_at.elapsed());
        if remaining.is_zero() {
            return SourceRootProbeResult::Unavailable;
        }
        match receiver.recv_timeout(std::cmp::min(SOURCE_ROOT_CANCEL_POLL, remaining)) {
            Ok(true) => return SourceRootProbeResult::Available,
            Ok(false) => return SourceRootProbeResult::Unavailable,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return SourceRootProbeResult::Unavailable;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

fn revalidate_missing_source_roots<F>(
    results: &mut [ThumbnailItemResult],
    availability: &mut HashMap<String, bool>,
    is_cancelled: &AtomicBool,
    mut probe: F,
) where
    F: FnMut(&Path, &AtomicBool) -> SourceRootProbeResult,
{
    let mut roots = HashMap::new();
    let mut deferred_roots = HashMap::new();
    for result in results.iter() {
        if let ThumbnailItemResult::MissingSource {
            source_root: Some(root),
            ..
        } = result
        {
            roots
                .entry(normalize_source_root_identity(root))
                .or_insert_with(|| root.clone());
        }
    }

    for (key, root) in roots {
        if availability.get(&key) == Some(&false) {
            continue;
        }
        match probe(Path::new(&root), is_cancelled) {
            SourceRootProbeResult::Available => {
                availability.insert(key, true);
            }
            SourceRootProbeResult::Unavailable => {
                availability.insert(key, false);
            }
            SourceRootProbeResult::Busy => {
                deferred_roots.insert(key, ());
            }
            SourceRootProbeResult::Cancelled => {
                for result in results.iter_mut() {
                    if matches!(result, ThumbnailItemResult::MissingSource { .. }) {
                        *result = ThumbnailItemResult::Skipped;
                    }
                }
                return;
            }
        }
    }

    for result in results.iter_mut() {
        let should_defer = match result {
            ThumbnailItemResult::MissingSource {
                source_root: Some(root),
                ..
            } => {
                let key = normalize_source_root_identity(root);
                availability.get(&key) == Some(&false) || deferred_roots.contains_key(&key)
            }
            _ => false,
        };
        if should_defer {
            *result = ThumbnailItemResult::Skipped;
        }
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

fn persist_thumbnail_results(
    conn: &mut Connection,
    results: &[ThumbnailItemResult],
    attempted_at_ms: i64,
) -> Result<BatchStats, String> {
    let mut stats = BatchStats::default();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS thumbnail_optimizer_results (
             id TEXT PRIMARY KEY,
             outcome TEXT NOT NULL,
             thumbnail_path TEXT,
             micro_thumbnail TEXT,
             error TEXT,
             reused INTEGER NOT NULL DEFAULT 0,
             processing_ms INTEGER NOT NULL DEFAULT 0
         ) WITHOUT ROWID;
         CREATE TEMP TABLE IF NOT EXISTS thumbnail_optimizer_affected_scopes (
             scope_key TEXT PRIMARY KEY
         ) WITHOUT ROWID;
         DELETE FROM thumbnail_optimizer_results;
         DELETE FROM thumbnail_optimizer_affected_scopes;",
    )
    .map_err(|e| e.to_string())?;

    {
        let mut insert = tx
            .prepare_cached(
                "INSERT OR REPLACE INTO thumbnail_optimizer_results (
                     id, outcome, thumbnail_path, micro_thumbnail, error, reused, processing_ms
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;
        for item in results {
            match item {
                ThumbnailItemResult::Success {
                    id,
                    thumbnail_path,
                    micro_thumbnail,
                    reused,
                    processing_ms,
                } => insert.execute(params![
                    id,
                    "success",
                    thumbnail_path,
                    micro_thumbnail,
                    Option::<String>::None,
                    i64::from(*reused),
                    (*processing_ms).min(i64::MAX as u128) as i64,
                ]),
                ThumbnailItemResult::Failed { id, error } => insert.execute(params![
                    id,
                    "failure",
                    Option::<String>::None,
                    Option::<String>::None,
                    error,
                    0,
                    0,
                ]),
                ThumbnailItemResult::MissingSource { id, .. } => insert.execute(params![
                    id,
                    "missing",
                    Option::<String>::None,
                    Option::<String>::None,
                    Option::<String>::None,
                    0,
                    0,
                ]),
                ThumbnailItemResult::Skipped => continue,
            }
            .map_err(|e| e.to_string())?;
        }
    }

    tx.execute(
        "DELETE FROM thumbnail_optimizer_results
         WHERE NOT EXISTS (
             SELECT 1
             FROM scoped_images scoped
             WHERE scoped.invoke_scope_hidden = 0
               AND scoped.id = thumbnail_optimizer_results.id
         )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let (checked, optimized, reused, missing, failed, encode_ms): (i64, i64, i64, i64, i64, i64) =
        tx.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(outcome = 'success'), 0),
                    COALESCE(SUM(CASE WHEN outcome = 'success' THEN reused ELSE 0 END), 0),
                    COALESCE(SUM(outcome = 'missing'), 0),
                    COALESCE(SUM(outcome = 'failure'), 0),
                    COALESCE(SUM(CASE WHEN outcome = 'success' THEN processing_ms ELSE 0 END), 0)
             FROM thumbnail_optimizer_results",
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
        .map_err(|e| e.to_string())?;
    stats.checked = checked as usize;
    stats.optimized = optimized as usize;
    stats.reused = reused as usize;
    stats.missing = missing as usize;
    stats.failed = failed as usize;
    stats.encode_ms = encode_ms as u128;
    stats.updates = {
        let mut stmt = tx
            .prepare(
                "SELECT id, thumbnail_path
                 FROM thumbnail_optimizer_results
                 WHERE outcome = 'success'
                 ORDER BY id",
            )
            .map_err(|error| error.to_string())?;
        let updates = stmt
            .query_map([], |row| {
                Ok(ThumbnailRepairUpdate {
                    id: row.get(0)?,
                    thumbnail_path: row.get(1)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .map_err(|error| error.to_string())?;
        updates
    };

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
    let previous_suppression = if has_scope_cache == 4 {
        let value = tx
            .query_row(
                "SELECT suppress_invalidation FROM invoke_scope_cache_control
                 WHERE state_key = 'current'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO thumbnail_optimizer_affected_scopes (scope_key)
             SELECT DISTINCT visible.scope_key
             FROM thumbnail_optimizer_results result
             CROSS JOIN invoke_scope_cache_visible_image_scopes visible
             WHERE result.outcome IN ('success', 'missing')
               AND visible.image_id = result.id",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE invoke_scope_cache_control SET suppress_invalidation = 1
             WHERE state_key = 'current'",
            [],
        )
        .map_err(|e| e.to_string())?;
        Some(value)
    } else {
        None
    };

    tx.execute_batch(&format!(
        "UPDATE images
         SET thumbnail_path = (SELECT result.thumbnail_path FROM thumbnail_optimizer_results result WHERE result.id = images.id),
             micro_thumbnail = COALESCE((SELECT result.micro_thumbnail FROM thumbnail_optimizer_results result WHERE result.id = images.id), micro_thumbnail),
             thumbnail_source = 'ambit',
             thumbnail_version = {CURRENT_THUMBNAIL_VERSION},
             thumbnail_failure_count = 0,
             thumbnail_last_error = NULL,
             thumbnail_last_attempt_at = NULL
         WHERE id IN (SELECT id FROM thumbnail_optimizer_results WHERE outcome = 'success');

         UPDATE images
         SET is_missing = 1,
             thumbnail_failure_count = 0,
             thumbnail_last_error = NULL,
             thumbnail_last_attempt_at = NULL
         WHERE id IN (SELECT id FROM thumbnail_optimizer_results WHERE outcome = 'missing');

         UPDATE images
         SET thumbnail_failure_count = COALESCE(thumbnail_failure_count, 0) + 1,
             thumbnail_last_error = (SELECT result.error FROM thumbnail_optimizer_results result WHERE result.id = images.id),
             thumbnail_last_attempt_at = {attempted_at_ms}
         WHERE id IN (SELECT id FROM thumbnail_optimizer_results WHERE outcome = 'failure');"
    ))
    .map_err(|e| e.to_string())?;

    if let Some(previous_suppression) = previous_suppression {
        tx.execute_batch(
            "INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
                 (scope_key, domain, facet_type, resource_name)
             SELECT scope_key, 'full', '', ''
             FROM thumbnail_optimizer_affected_scopes;

             UPDATE invoke_scope_cache_state
             SET status = 'dirty',
                 generation = generation + 1,
                 updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
             WHERE status != 'dirty'
               AND scope_key IN (SELECT scope_key FROM thumbnail_optimizer_affected_scopes);",
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE invoke_scope_cache_control SET suppress_invalidation = ?1
             WHERE state_key = 'current'",
            [previous_suppression],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute_batch(
        "DELETE FROM thumbnail_optimizer_results;
         DELETE FROM thumbnail_optimizer_affected_scopes;",
    )
    .map_err(|e| e.to_string())?;

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
    let candidate_source = if include_upgradeable {
        "(SELECT * FROM thumbnail_repair_required
          UNION ALL
          SELECT * FROM thumbnail_repair_upgradeable)"
    } else {
        "thumbnail_repair_required"
    };
    let retry_cutoff_ms = now_ms - FAILURE_BACKOFF_MS;
    let mut query = format!(
        "SELECT i.id, i.path, COALESCE(i.timestamp, 0) AS timestamp,
                i.thumbnail_path,
                (
                    SELECT scope.images_root
                    FROM invoke_owner_scope_state scope
                    WHERE i.invoke_source_id IS NOT NULL
                      AND LOWER(RTRIM(REPLACE(scope.db_path, '\\', '/'), '/')) =
                          LOWER(RTRIM(REPLACE(i.invoke_source_id, '\\', '/'), '/'))
                    LIMIT 1
                ) AS invoke_images_root
         FROM {candidate_source} i
         WHERE (
             COALESCE(i.thumbnail_failure_count, 0) = 0
             OR i.thumbnail_last_attempt_at IS NULL
             OR i.thumbnail_last_attempt_at <= ?1
         )"
    );

    if cursor.is_some() {
        query.push_str(" AND (timestamp < ?2 OR (timestamp = ?2 AND id < ?3))");
        query.push_str(" ORDER BY timestamp DESC, id DESC LIMIT ?4");
    } else {
        query.push_str(" ORDER BY timestamp DESC, id DESC LIMIT ?2");
    }

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let rows = if let Some(cursor) = cursor {
        stmt.query_map(
            params![retry_cutoff_ms, cursor.timestamp, cursor.id, limit as i64],
            |row| {
                Ok(ThumbnailCandidate {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    timestamp: row.get(2)?,
                    thumbnail_path: row.get(3)?,
                    invoke_images_root: row.get(4)?,
                    source_root: None,
                    source_root_available: None,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![retry_cutoff_ms, limit as i64], |row| {
            Ok(ThumbnailCandidate {
                id: row.get(0)?,
                path: row.get(1)?,
                timestamp: row.get(2)?,
                thumbnail_path: row.get(3)?,
                invoke_images_root: row.get(4)?,
                source_root: None,
                source_root_available: None,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| e.to_string())?
    };

    Ok(rows)
}

fn load_thumbnail_candidates_for_ids(
    conn: &Connection,
    ids: &[String],
    force: bool,
    respect_backoff: bool,
    now_ms: i64,
) -> Result<Vec<ThumbnailCandidate>, String> {
    conn.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS thumbnail_repair_requested_ids (
             id TEXT PRIMARY KEY
         ) WITHOUT ROWID;
         DELETE FROM thumbnail_repair_requested_ids;",
    )
    .map_err(|error| error.to_string())?;
    {
        let mut insert = conn
            .prepare_cached("INSERT OR IGNORE INTO thumbnail_repair_requested_ids (id) VALUES (?1)")
            .map_err(|error| error.to_string())?;
        for id in ids {
            insert.execute([id]).map_err(|error| error.to_string())?;
        }
    }

    let candidate_source = if force {
        "images"
    } else {
        "(SELECT * FROM thumbnail_repair_required
          UNION ALL
          SELECT * FROM thumbnail_repair_upgradeable)"
    };
    let retry_condition = if respect_backoff {
        "AND (
             COALESCE(i.thumbnail_failure_count, 0) = 0
             OR i.thumbnail_last_attempt_at IS NULL
             OR i.thumbnail_last_attempt_at <= ?1
         )"
    } else {
        ""
    };
    let force_condition = if force {
        "AND i.is_deleted = 0
         AND i.media_type = 'image'
         AND i.is_missing = 0
         AND IFNULL(i.is_intermediate_gen, 0) = 0
         AND (i.is_corrupt = 0 OR i.is_corrupt IS NULL)
         AND i.path NOT LIKE 'blob:%'
         AND i.path NOT LIKE 'data:%'"
    } else {
        ""
    };
    let query = format!(
        "SELECT i.id, i.path, COALESCE(i.timestamp, 0) AS timestamp,
                i.thumbnail_path,
                (
                    SELECT scope.images_root
                    FROM invoke_owner_scope_state scope
                    WHERE i.invoke_source_id IS NOT NULL
                      AND LOWER(RTRIM(REPLACE(scope.db_path, '\\', '/'), '/')) =
                          LOWER(RTRIM(REPLACE(i.invoke_source_id, '\\', '/'), '/'))
                    LIMIT 1
                ) AS invoke_images_root
         FROM {candidate_source} i
         JOIN thumbnail_repair_requested_ids requested ON requested.id = i.id
         WHERE EXISTS (
             SELECT 1 FROM scoped_images scoped
             WHERE scoped.invoke_scope_hidden = 0 AND scoped.id = i.id
         )
         {force_condition}
         {retry_condition}
         ORDER BY timestamp DESC, i.id DESC"
    );
    let retry_cutoff_ms = now_ms - FAILURE_BACKOFF_MS;
    let mut stmt = conn.prepare(&query).map_err(|error| error.to_string())?;
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(ThumbnailCandidate {
            id: row.get(0)?,
            path: row.get(1)?,
            timestamp: row.get(2)?,
            thumbnail_path: row.get(3)?,
            invoke_images_root: row.get(4)?,
            source_root: None,
            source_root_available: None,
        })
    };
    let candidates = if respect_backoff {
        stmt.query_map([retry_cutoff_ms], map_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .map_err(|error| error.to_string())?
    } else {
        stmt.query_map([], map_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .map_err(|error| error.to_string())?
    };

    Ok(candidates)
}

fn emit_progress(app: &tauri::AppHandle, progress: &ThumbnailOptimizationProgress) {
    let _ = progress.clone().emit(app);
}

fn emit_complete(app: &tauri::AppHandle, result: &ThumbnailOptimizationResult) {
    let _ = ThumbnailOptimizationComplete(result.clone()).emit(app);
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
            CREATE VIEW thumbnail_repair_required AS
                SELECT images.*, 'missing' AS thumbnail_repair_reason
                FROM images
                WHERE images.invoke_scope_hidden = 0
                  AND EXISTS (SELECT 1 FROM scoped_images scoped WHERE scoped.id = images.id)
                  AND images.is_deleted = 0
                  AND images.media_type = 'image'
                  AND images.is_missing = 0
                  AND IFNULL(images.is_intermediate_gen, 0) = 0
                  AND (images.is_corrupt = 0 OR images.is_corrupt IS NULL)
                  AND images.path NOT LIKE 'blob:%'
                  AND images.path NOT LIKE 'data:%'
                  AND (images.thumbnail_path IS NULL OR images.thumbnail_path = '' OR images.path = images.thumbnail_path)
                UNION ALL
                SELECT images.*, 'outdated' AS thumbnail_repair_reason
                FROM images
                WHERE images.invoke_scope_hidden = 0
                  AND EXISTS (SELECT 1 FROM scoped_images scoped WHERE scoped.id = images.id)
                  AND images.is_deleted = 0
                  AND images.media_type = 'image'
                  AND images.is_missing = 0
                  AND IFNULL(images.is_intermediate_gen, 0) = 0
                  AND (images.is_corrupt = 0 OR images.is_corrupt IS NULL)
                  AND images.path NOT LIKE 'blob:%'
                  AND images.path NOT LIKE 'data:%'
                  AND images.thumbnail_source = 'ambit'
                  AND COALESCE(images.thumbnail_version, 0) < 1
                  AND images.thumbnail_path IS NOT NULL
                  AND images.thumbnail_path != ''
                  AND images.path != images.thumbnail_path;
            CREATE VIEW thumbnail_repair_upgradeable AS
                SELECT images.*, 'upgradeable' AS thumbnail_repair_reason
                FROM images
                WHERE images.invoke_scope_hidden = 0
                  AND EXISTS (SELECT 1 FROM scoped_images scoped WHERE scoped.id = images.id)
                  AND images.is_deleted = 0
                  AND images.media_type = 'image'
                  AND images.is_missing = 0
                  AND IFNULL(images.is_intermediate_gen, 0) = 0
                  AND (images.is_corrupt = 0 OR images.is_corrupt IS NULL)
                  AND images.path NOT LIKE 'blob:%'
                  AND images.path NOT LIKE 'data:%'
                  AND images.thumbnail_path IS NOT NULL
                  AND images.thumbnail_path != ''
                  AND images.path != images.thumbnail_path
                  AND (images.thumbnail_source IS NULL OR images.thumbnail_source != 'ambit');
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
    fn one_native_job_lock_excludes_smart_and_maintenance_until_release() {
        let is_running = Arc::new(AtomicBool::new(false));
        let first = acquire_thumbnail_job(is_running.clone()).expect("first job");

        assert!(acquire_thumbnail_job(is_running.clone()).is_err());
        drop(first);
        assert!(acquire_thumbnail_job(is_running).is_ok());
    }

    #[test]
    fn manual_operation_keeps_the_native_lock_between_batches() {
        let state = ThumbnailOptimizationState::default();
        let operation_id = begin_manual_thumbnail_operation(
            state.is_cancelled.as_ref(),
            state.is_running.as_ref(),
            state.manual_operation.as_ref(),
            state.next_operation_id.as_ref(),
        )
        .expect("begin manual operation");

        let batch = claim_manual_thumbnail_batch(state.manual_operation.clone(), operation_id)
            .expect("claim first batch");
        assert!(acquire_thumbnail_job(state.is_running.clone()).is_err());
        assert!(finish_manual_thumbnail_operation(
            state.is_cancelled.as_ref(),
            state.is_running.as_ref(),
            state.manual_operation.as_ref(),
            operation_id,
        )
        .is_err());

        drop(batch);
        assert!(acquire_thumbnail_job(state.is_running.clone()).is_err());
        finish_manual_thumbnail_operation(
            state.is_cancelled.as_ref(),
            state.is_running.as_ref(),
            state.manual_operation.as_ref(),
            operation_id,
        )
        .expect("finish manual operation");
        assert!(acquire_thumbnail_job(state.is_running).is_ok());
    }

    #[test]
    fn manual_batch_retries_immediately_while_smart_respects_backoff() {
        let conn = setup_queue_db();
        insert_image(&conn, "recent-failure", None, None, 0, 10);
        conn.execute(
            "UPDATE images
             SET thumbnail_failure_count = 1,
                 thumbnail_last_attempt_at = 100000
             WHERE id = 'recent-failure'",
            [],
        )
        .expect("recent failure");
        let ids = vec!["recent-failure".to_string()];

        let smart = load_thumbnail_candidates_for_ids(&conn, &ids, false, true, 100001)
            .expect("backoff-aware candidates");
        let manual = load_thumbnail_candidates_for_ids(&conn, &ids, false, false, 100001)
            .expect("manual candidates");

        assert!(smart.is_empty());
        assert_eq!(
            manual
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["recent-failure"]
        );
    }

    #[test]
    fn selected_force_mode_includes_current_thumbnails_but_keeps_structural_safeguards() {
        let conn = setup_queue_db();
        insert_image(
            &conn,
            "current",
            Some("C:/thumbs/current.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            20,
        );
        insert_image(
            &conn,
            "corrupt",
            Some("C:/thumbs/corrupt.webp"),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            10,
        );
        conn.execute("UPDATE images SET is_corrupt = 1 WHERE id = 'corrupt'", [])
            .expect("mark corrupt");
        let ids = vec!["current".to_string(), "corrupt".to_string()];

        let eligible = load_thumbnail_candidates_for_ids(&conn, &ids, false, false, 0)
            .expect("eligible candidates");
        let forced = load_thumbnail_candidates_for_ids(&conn, &ids, true, false, 0)
            .expect("forced candidates");

        assert!(eligible.is_empty());
        assert_eq!(
            forced
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["current"]
        );
        assert_eq!(
            forced[0].thumbnail_path.as_deref(),
            Some("C:/thumbs/current.webp")
        );
    }

    #[test]
    fn smart_and_manual_batches_share_canonical_structural_eligibility() {
        let conn = setup_queue_db();
        insert_image(&conn, "missing", None, None, 0, 30);
        insert_image(
            &conn,
            "outdated",
            Some("C:/thumbs/outdated.webp"),
            Some("ambit"),
            0,
            20,
        );
        insert_image(
            &conn,
            "external",
            Some("C:/library/external.png"),
            Some("external"),
            0,
            10,
        );
        let smart = fetch_thumbnail_candidates(&conn, true, None, 10, 0).expect("smart candidates");
        let requested = smart.iter().map(|item| item.id.clone()).collect::<Vec<_>>();
        let manual = load_thumbnail_candidates_for_ids(&conn, &requested, false, false, 0)
            .expect("manual candidates");

        assert_eq!(
            smart
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            manual
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>()
        );
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
            7,
            ThumbnailOptimizationPhase::Throttled,
            true,
        );

        assert_eq!(progress.checked, 1);
        assert_eq!(progress.optimized, 1);
        assert_eq!(progress.total, None);
        assert_eq!(progress.encode_ms, 15);
        assert_eq!(progress.candidate_fetch_ms, 7);
        assert!(progress.is_throttled);
        assert_eq!(progress.phase, ThumbnailOptimizationPhase::Throttled);
    }

    #[test]
    fn initial_progress_is_a_truthful_discovery_event() {
        let progress = build_progress_payload(
            &ThumbnailOptimizationResult::default(),
            Instant::now(),
            ThumbnailOptimizationProfile::Balanced,
            0,
            0,
            0,
            0,
            ThumbnailOptimizationPhase::Discovering,
            false,
        );

        assert_eq!(progress.checked, 0);
        assert_eq!(progress.total, None);
        assert_eq!(progress.phase, ThumbnailOptimizationPhase::Discovering);
        assert_eq!(progress.message, "Checking library thumbnails...");
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
    fn keyset_pages_remain_complete_when_repaired_rows_leave_the_views() {
        let mut conn = setup_queue_db();
        for (id, timestamp) in [("a", 30), ("b", 30), ("c", 20), ("d", 20), ("e", 10)] {
            insert_image(&conn, id, None, None, 0, timestamp);
        }

        let mut cursor: Option<ThumbnailCursor> = None;
        let mut visited = Vec::new();
        loop {
            let page = fetch_thumbnail_candidates(&conn, false, cursor.as_ref(), 2, 10_000)
                .expect("fetch keyset page");
            if page.is_empty() {
                break;
            }
            let last = page.last().expect("last page row");
            cursor = Some(ThumbnailCursor {
                timestamp: last.timestamp,
                id: last.id.clone(),
            });
            let outcomes = page
                .iter()
                .map(|candidate| {
                    visited.push(candidate.id.clone());
                    ThumbnailItemResult::Success {
                        id: candidate.id.clone(),
                        thumbnail_path: format!("C:/thumbs/{}.webp", candidate.id),
                        micro_thumbnail: None,
                        reused: false,
                        processing_ms: 0,
                    }
                })
                .collect::<Vec<_>>();
            persist_thumbnail_results(&mut conn, &outcomes, 100).expect("repair page");
        }

        assert_eq!(visited, vec!["b", "a", "d", "c", "e"]);
        let unique = visited.iter().collect::<HashSet<_>>();
        assert_eq!(unique.len(), visited.len());
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
    fn forced_repair_persistence_failure_preserves_active_thumbnail_and_bounded_slots() {
        let temp_root = temp_thumbnail_dir("persistence-failure");
        let _ = fs::remove_dir_all(&temp_root);
        let thumbnail_dir = temp_root.join("thumbs");
        fs::create_dir_all(&thumbnail_dir).expect("thumbnail directory");
        let source_path = temp_root.join("source.png");
        image::ImageBuffer::from_pixel(8, 8, image::Rgba([0_u8, 0, 255, 255]))
            .save(&source_path)
            .expect("source image");
        let canonical_path = crate::thumb::get_thumbnail_path(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail directory"),
        );
        fs::write(&canonical_path, b"known-good-thumbnail").expect("active thumbnail fixture");

        let mut conn = setup_queue_db();
        insert_image(
            &conn,
            "persistence-failure",
            canonical_path.to_str(),
            Some("ambit"),
            CURRENT_THUMBNAIL_VERSION,
            20,
        );
        conn.execute(
            "UPDATE images SET path = ?1 WHERE id = 'persistence-failure'",
            [source_path.to_string_lossy().as_ref()],
        )
        .expect("set source path");
        let candidate = load_thumbnail_candidates_for_ids(
            &conn,
            &["persistence-failure".to_string()],
            true,
            false,
            0,
        )
        .expect("load forced candidate")
        .pop()
        .expect("forced candidate");

        let outcome = optimize_thumbnail_candidate(
            &candidate,
            thumbnail_dir.to_str().expect("thumbnail directory"),
            true,
            &AtomicBool::new(false),
        );
        let replacement_path = match &outcome {
            ThumbnailItemResult::Success { thumbnail_path, .. } => thumbnail_path.clone(),
            other => panic!("expected successful generation, got {other:?}"),
        };
        assert_ne!(replacement_path, canonical_path.to_string_lossy());
        assert_eq!(
            fs::read(&canonical_path).expect("active thumbnail bytes"),
            b"known-good-thumbnail"
        );

        conn.execute_batch(
            "CREATE TEMP TRIGGER fail_thumbnail_path_update
             BEFORE UPDATE OF thumbnail_path ON images
             WHEN OLD.id = 'persistence-failure'
             BEGIN
                 SELECT RAISE(ABORT, 'forced persistence failure');
             END;",
        )
        .expect("failure trigger");
        let error = match persist_thumbnail_results(&mut conn, &[outcome], 100) {
            Ok(_) => panic!("persistence must fail"),
            Err(error) => error,
        };
        assert!(error.contains("forced persistence failure"));

        let stored_path: String = conn
            .query_row(
                "SELECT thumbnail_path FROM images WHERE id = 'persistence-failure'",
                [],
                |row| row.get(0),
            )
            .expect("stored active path");
        assert_eq!(stored_path, canonical_path.to_string_lossy());
        assert_eq!(
            fs::read(&canonical_path).expect("preserved active bytes"),
            b"known-good-thumbnail"
        );

        let retry = optimize_thumbnail_candidate(
            &candidate,
            thumbnail_dir.to_str().expect("thumbnail directory"),
            true,
            &AtomicBool::new(false),
        );
        assert!(matches!(retry, ThumbnailItemResult::Success { .. }));
        let slot_count = fs::read_dir(&thumbnail_dir)
            .expect("thumbnail slots")
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "webp"))
            .count();
        assert_eq!(slot_count, 2);

        fs::remove_dir_all(temp_root).expect("clean up test directory");
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
            false,
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
    fn mixed_batch_invalidates_each_scope_once_without_row_trigger_work() {
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
            CREATE TRIGGER audit_thumbnail_row_update
            AFTER UPDATE OF is_missing, thumbnail_path, thumbnail_failure_count ON images
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
        insert_image(&conn, "broken-c", None, None, 0, 5);

        persist_thumbnail_results(
            &mut conn,
            &[
                ThumbnailItemResult::MissingSource {
                    id: "gone-a".to_string(),
                    source_root: None,
                },
                ThumbnailItemResult::Success {
                    id: "gone-b".to_string(),
                    thumbnail_path: "C:/thumbs/gone-b.webp".to_string(),
                    micro_thumbnail: Some("micro".to_string()),
                    reused: false,
                    processing_ms: 9,
                },
                ThumbnailItemResult::Failed {
                    id: "broken-c".to_string(),
                    error: "decode failed".to_string(),
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
    fn migrated_schema_scales_missing_reconciliation_per_scope_and_uses_disjoint_queue_indexes() {
        const IMAGE_COUNT: usize = 2_000;
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        for migration in crate::db::migrations::init_db() {
            conn.execute_batch(&migration.sql)
                .expect("apply production migration");
        }
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

        let required_plan = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id, path, COALESCE(timestamp, 0)
                 FROM thumbnail_repair_required
                 ORDER BY timestamp DESC, id DESC
                 LIMIT 100",
            )
            .expect("required plan statement")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("required query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("required plan details");
        assert!(
            required_plan
                .iter()
                .any(|detail| { detail.contains("idx_images_thumbnail_missing_queue_v3") }),
            "missing branch must use its partial index: {required_plan:?}"
        );
        assert!(
            required_plan
                .iter()
                .any(|detail| { detail.contains("idx_images_thumbnail_outdated_queue_v3") }),
            "outdated branch must use its partial index: {required_plan:?}"
        );

        let upgradeable_plan = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id, path, COALESCE(timestamp, 0)
                 FROM thumbnail_repair_upgradeable
                 ORDER BY timestamp DESC, id DESC
                 LIMIT 100",
            )
            .expect("upgradeable plan statement")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("upgradeable query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("upgradeable plan details");
        assert!(
            upgradeable_plan
                .iter()
                .any(|detail| { detail.contains("idx_images_thumbnail_upgradeable_queue_v3") }),
            "upgradeable branch must use its partial index: {upgradeable_plan:?}"
        );

        let results = (0..IMAGE_COUNT)
            .map(|index| ThumbnailItemResult::MissingSource {
                id: format!("missing-{index:04}"),
                source_root: None,
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
    #[ignore = "release benchmark: seeds a 300,000-row production schema"]
    fn sparse_300k_production_schema_keeps_candidate_pages_complete_and_indexed() {
        const ROW_COUNT: usize = 300_000;
        const REPAIR_COUNT: usize = 4_500;
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        for migration in crate::db::migrations::init_db() {
            conn.execute_batch(&migration.sql)
                .expect("apply production migration");
        }

        {
            let tx = conn.transaction().expect("seed transaction");
            {
                let mut insert = tx
                    .prepare(
                        "INSERT INTO images (
                             id, path, timestamp, thumbnail_path,
                             thumbnail_source, thumbnail_version
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    )
                    .expect("seed statement");
                for index in 0..ROW_COUNT {
                    let id = format!("image-{index:06}");
                    let path = format!("D:/library/{index:06}.png");
                    let (thumbnail_path, thumbnail_source, thumbnail_version) =
                        if index < REPAIR_COUNT / 3 {
                            (None, None, 0)
                        } else if index < (REPAIR_COUNT * 2) / 3 {
                            (Some(format!("D:/thumbs/{index:06}.webp")), Some("ambit"), 0)
                        } else if index < REPAIR_COUNT {
                            (
                                Some(format!("D:/external/{index:06}.webp")),
                                Some("external"),
                                1,
                            )
                        } else {
                            (Some(format!("D:/thumbs/{index:06}.webp")), Some("ambit"), 1)
                        };
                    insert
                        .execute(params![
                            id,
                            path,
                            index as i64,
                            thumbnail_path,
                            thumbnail_source,
                            thumbnail_version,
                        ])
                        .expect("seed image");
                }
            }
            tx.commit().expect("commit sparse catalog");
        }

        let started_at = Instant::now();
        let mut cursor = None;
        let mut ids = Vec::with_capacity(REPAIR_COUNT);
        loop {
            let page = fetch_thumbnail_candidates(&conn, true, cursor.as_ref(), 500, 0)
                .expect("fetch sparse candidate page");
            if page.is_empty() {
                break;
            }
            let last = page.last().expect("non-empty page");
            cursor = Some(ThumbnailCursor {
                timestamp: last.timestamp,
                id: last.id.clone(),
            });
            ids.extend(page.into_iter().map(|candidate| candidate.id));
        }
        let discovery_elapsed = started_at.elapsed();
        let unique = ids.iter().collect::<HashSet<_>>();

        assert_eq!(ids.len(), REPAIR_COUNT);
        assert_eq!(unique.len(), REPAIR_COUNT);
        assert!(
            discovery_elapsed < Duration::from_secs(5),
            "sparse 300k discovery took {discovery_elapsed:?}"
        );
    }

    fn benchmark_thumbnail_throughput(
        conn: &mut Connection,
        candidates: &[ThumbnailCandidate],
        thumbnail_dir: &str,
        throttled: bool,
    ) -> Vec<(usize, Duration)> {
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(ThumbnailOptimizationProfile::Fast.worker_count())
            .stack_size(8 * 1024 * 1024)
            .build()
            .expect("benchmark pool");
        let checkpoints = [100, 500, 1_000, 3_500];
        let chunk_size = if throttled {
            THROTTLED_WORKER_CHUNK_SIZE
        } else {
            ThumbnailOptimizationProfile::Fast.worker_chunk_size()
        };
        let started_at = Instant::now();
        let is_cancelled = AtomicBool::new(false);
        let mut processed = 0;
        let mut pending = Vec::with_capacity(DB_FLUSH_LIMIT + chunk_size);
        let mut timings = Vec::with_capacity(checkpoints.len());

        for checkpoint in checkpoints {
            while processed < checkpoint {
                let end = std::cmp::min(processed + chunk_size, checkpoint);
                process_candidate_chunk(
                    &pool,
                    &candidates[processed..end],
                    thumbnail_dir,
                    true,
                    &is_cancelled,
                    |item| {
                        if !matches!(item, ThumbnailItemResult::Skipped) {
                            pending.push(item);
                        }
                        Ok(())
                    },
                )
                .expect("benchmark candidate chunk");
                processed = end;
                if pending.len() >= DB_FLUSH_LIMIT {
                    flush_pending_thumbnail_results(conn, &mut pending, unix_time_ms())
                        .expect("benchmark persistence");
                }
                if throttled {
                    std::thread::sleep(THROTTLED_CHUNK_SLEEP);
                }
            }
            flush_pending_thumbnail_results(conn, &mut pending, unix_time_ms())
                .expect("checkpoint persistence");
            timings.push((checkpoint, started_at.elapsed()));
        }
        timings
    }

    #[test]
    #[ignore = "requires AMBIT_THUMBNAIL_BENCHMARK_DB pointing at a disposable production-catalog copy"]
    fn production_catalog_meets_discovery_and_persistence_gates() {
        let db_path = std::env::var("AMBIT_THUMBNAIL_BENCHMARK_DB")
            .expect("set AMBIT_THUMBNAIL_BENCHMARK_DB to a disposable catalog copy");
        let mut conn = Connection::open(db_path).expect("open benchmark catalog");
        crate::db::configure_connection(&conn).expect("configure benchmark connection");
        let has_candidate_views: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'view' AND name = 'thumbnail_repair_required'",
                [],
                |row| row.get(0),
            )
            .expect("inspect benchmark schema");
        if has_candidate_views == 0 {
            conn.execute_batch(
                &crate::db::migrations::m79_thumbnail_repair_candidates::migration79().sql,
            )
            .expect("apply migration 79 to benchmark copy");
        }

        let fetch_started = Instant::now();
        let candidates = fetch_thumbnail_candidates(&conn, true, None, 500, unix_time_ms())
            .expect("fetch production candidates");
        let fetch_elapsed = fetch_started.elapsed();
        assert!(
            fetch_elapsed < Duration::from_secs(5),
            "cold candidate discovery took {fetch_elapsed:?}"
        );

        let candidate_ids = candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<Vec<_>>();
        let maintenance_fetch_started = Instant::now();
        let maintenance_candidates =
            load_thumbnail_candidates_for_ids(&conn, &candidate_ids, false, false, unix_time_ms())
                .expect("fetch production Maintenance candidates");
        let maintenance_fetch_elapsed = maintenance_fetch_started.elapsed();
        assert_eq!(maintenance_candidates.len(), candidates.len());
        assert!(
            maintenance_fetch_elapsed < Duration::from_secs(5),
            "Maintenance candidate validation took {maintenance_fetch_elapsed:?}"
        );

        let outcomes = candidates
            .iter()
            .take(100)
            .map(|candidate| ThumbnailItemResult::Success {
                id: candidate.id.clone(),
                thumbnail_path: format!("D:/codex-thumbnail-benchmark/{}.webp", candidate.id),
                micro_thumbnail: None,
                reused: false,
                processing_ms: 0,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            outcomes.len(),
            100,
            "benchmark copy needs at least 100 candidates"
        );

        let persist_started = Instant::now();
        persist_thumbnail_results(&mut conn, &outcomes, unix_time_ms())
            .expect("persist production outcomes");
        let persist_elapsed = persist_started.elapsed();
        assert!(
            persist_elapsed < Duration::from_secs(2),
            "100-outcome persistence took {persist_elapsed:?}"
        );

        eprintln!(
            "thumbnail benchmark: smart_fetch_500={fetch_elapsed:?}, maintenance_fetch_500={maintenance_fetch_elapsed:?}, persist_100={persist_elapsed:?}"
        );
    }

    #[test]
    #[ignore = "requires a production catalog and writable disposable thumbnail directory"]
    fn production_catalog_meets_fast_and_throttled_end_to_end_gates() {
        let db_path = std::env::var("AMBIT_THUMBNAIL_BENCHMARK_DB")
            .expect("set AMBIT_THUMBNAIL_BENCHMARK_DB to a production catalog");
        let thumbnail_dir = std::env::var("AMBIT_THUMBNAIL_BENCHMARK_DIR")
            .expect("set AMBIT_THUMBNAIL_BENCHMARK_DIR to a writable disposable directory");
        let source_conn = Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .expect("open production catalog read-only");
        let mut candidates = source_conn
            .prepare(
                "SELECT images.id, images.path, COALESCE(images.timestamp, 0)
                 FROM scoped_images AS images
                 WHERE images.invoke_scope_hidden = 0
                   AND images.is_deleted = 0
                   AND images.media_type = 'image'
                   AND images.is_missing = 0
                   AND IFNULL(images.is_intermediate_gen, 0) = 0
                   AND (images.is_corrupt = 0 OR images.is_corrupt IS NULL)
                   AND images.path NOT LIKE 'blob:%'
                   AND images.path NOT LIKE 'data:%'
                 ORDER BY images.timestamp DESC, images.id DESC
                 LIMIT 5000",
            )
            .expect("production candidate statement")
            .query_map([], |row| {
                Ok(ThumbnailCandidate {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    timestamp: row.get(2)?,
                    thumbnail_path: None,
                    invoke_images_root: None,
                    source_root: None,
                    source_root_available: None,
                })
            })
            .expect("production candidates")
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .expect("collect production candidates");
        candidates.retain(|candidate| {
            fs::metadata(&candidate.path).is_ok_and(|metadata| metadata.is_file())
        });
        assert!(
            candidates.len() >= 3_500,
            "production catalog supplied only {} of the 3,500 online images required",
            candidates.len()
        );
        candidates.truncate(3_500);
        for candidate in &mut candidates {
            let active_path = crate::thumb::get_thumbnail_path(&candidate.path, &thumbnail_dir);
            candidate.thumbnail_path = Some(active_path.to_string_lossy().to_string());
        }
        let mut benchmark_conn = setup_queue_db();
        for candidate in &candidates {
            insert_image(
                &benchmark_conn,
                &candidate.id,
                None,
                None,
                0,
                candidate.timestamp,
            );
        }

        let fast =
            benchmark_thumbnail_throughput(&mut benchmark_conn, &candidates, &thumbnail_dir, false);
        let fast_limits = [
            (100, Duration::from_secs(5)),
            (500, Duration::from_secs(10)),
            (1_000, Duration::from_secs(20)),
            (3_500, Duration::from_secs(60)),
        ];
        for ((count, elapsed), (expected_count, limit)) in fast.iter().zip(fast_limits) {
            assert_eq!(*count, expected_count);
            assert!(*elapsed < limit, "fast {count} took {elapsed:?}");
        }

        let throttled =
            benchmark_thumbnail_throughput(&mut benchmark_conn, &candidates, &thumbnail_dir, true);
        assert!(
            throttled[0].1 < Duration::from_secs(15),
            "throttled 100 took {:?}",
            throttled[0].1
        );
        assert!(
            throttled[3].1 >= Duration::from_secs(4 * 60)
                && throttled[3].1 <= Duration::from_secs(7 * 60),
            "throttled 3,500 took {:?}",
            throttled[3].1
        );
        eprintln!("thumbnail throughput benchmark: fast={fast:?}, throttled={throttled:?}");
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
            thumbnail_path: None,
            invoke_images_root: Some(invoke_root.to_string_lossy().to_string()),
            source_root: None,
            source_root_available: Some(false),
        };

        let item = optimize_thumbnail_candidate(
            &candidate,
            &temp_thumbnail_dir("offline-thumbs").to_string_lossy(),
            false,
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
                thumbnail_path: None,
                invoke_images_root: None,
                source_root: None,
                source_root_available: None,
            },
            ThumbnailCandidate {
                id: "offline-b".to_string(),
                path: "D:/Offline Library/nested/b.png".to_string(),
                timestamp: 1,
                thumbnail_path: None,
                invoke_images_root: None,
                source_root: None,
                source_root_available: None,
            },
        ];
        let mut availability = HashMap::new();
        let mut probe_count = 0;

        assert!(resolve_candidate_source_roots(
            &mut candidates,
            &[root],
            &mut availability,
            &AtomicBool::new(false),
            |_, _| {
                probe_count += 1;
                SourceRootProbeResult::Unavailable
            },
        ));

        assert_eq!(probe_count, 1);
        assert!(candidates
            .iter()
            .all(|candidate| candidate.source_root_available == Some(false)));
        assert!(candidates.iter().all(|candidate| matches!(
            optimize_thumbnail_candidate(
                candidate,
                &temp_thumbnail_dir("offline-managed-thumbs").to_string_lossy(),
                false,
                &AtomicBool::new(false),
            ),
            ThumbnailItemResult::Skipped
        )));
    }

    #[test]
    fn busy_probe_defers_a_root_without_caching_it_unavailable() {
        let roots = vec!["Z:/Stalled".to_string(), "D:/Healthy".to_string()];
        let mut candidates = vec![
            ThumbnailCandidate {
                id: "stalled".to_string(),
                path: "Z:/Stalled/a.png".to_string(),
                timestamp: 2,
                thumbnail_path: None,
                invoke_images_root: None,
                source_root: None,
                source_root_available: None,
            },
            ThumbnailCandidate {
                id: "healthy".to_string(),
                path: "D:/Healthy/b.png".to_string(),
                timestamp: 1,
                thumbnail_path: None,
                invoke_images_root: None,
                source_root: None,
                source_root_available: None,
            },
        ];
        let mut availability = HashMap::new();
        let mut probe_count = 0;

        assert!(resolve_candidate_source_roots(
            &mut candidates,
            &roots,
            &mut availability,
            &AtomicBool::new(false),
            |_, _| {
                probe_count += 1;
                if probe_count == 1 {
                    SourceRootProbeResult::Unavailable
                } else {
                    SourceRootProbeResult::Busy
                }
            },
        ));

        assert_eq!(candidates[0].source_root_available, Some(false));
        assert_eq!(candidates[1].source_root_available, Some(false));
        assert!(!availability.contains_key(&normalize_source_root_identity(&roots[1])));
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
    fn cancellation_stops_waiting_for_a_blocked_root_probe() {
        static PROBE_REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
        let is_cancelled = Arc::new(AtomicBool::new(false));
        let cancellation = is_cancelled.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            cancellation.store(true, Ordering::SeqCst);
        });
        let started_at = Instant::now();

        let result = run_cancellable_probe(
            &PROBE_REGISTRY,
            "blocked".to_string(),
            is_cancelled.as_ref(),
            Duration::from_secs(1),
            || {
                std::thread::sleep(Duration::from_secs(1));
                true
            },
        );

        assert_eq!(result, SourceRootProbeResult::Cancelled);
        assert!(started_at.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn repeated_timeouts_do_not_spawn_additional_root_probe_workers() {
        static PROBE_REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
        let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let first_starts = starts.clone();

        let first = run_cancellable_probe(
            &PROBE_REGISTRY,
            "stalled".to_string(),
            &AtomicBool::new(false),
            Duration::from_millis(20),
            move || {
                first_starts.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(200));
                true
            },
        );
        let second_starts = starts.clone();
        let second = run_cancellable_probe(
            &PROBE_REGISTRY,
            "stalled".to_string(),
            &AtomicBool::new(false),
            Duration::from_millis(20),
            move || {
                second_starts.fetch_add(1, Ordering::SeqCst);
                true
            },
        );

        assert_eq!(first, SourceRootProbeResult::Unavailable);
        assert_eq!(second, SourceRootProbeResult::Busy);
        assert_eq!(starts.load(Ordering::SeqCst), 1);

        let healthy = run_cancellable_probe(
            &PROBE_REGISTRY,
            "healthy".to_string(),
            &AtomicBool::new(false),
            Duration::from_millis(20),
            || true,
        );
        assert_eq!(healthy, SourceRootProbeResult::Available);
    }

    #[test]
    fn missing_results_are_deferred_when_a_root_disconnects_after_preflight() {
        let root = "D:/Library".to_string();
        let mut results = vec![
            ThumbnailItemResult::MissingSource {
                id: "missing-a".to_string(),
                source_root: Some(root.clone()),
            },
            ThumbnailItemResult::MissingSource {
                id: "missing-b".to_string(),
                source_root: Some(root.clone()),
            },
        ];
        let mut availability = HashMap::from([(normalize_source_root_identity(&root), true)]);
        let mut probe_count = 0;

        revalidate_missing_source_roots(
            &mut results,
            &mut availability,
            &AtomicBool::new(false),
            |_, _| {
                probe_count += 1;
                SourceRootProbeResult::Unavailable
            },
        );

        assert_eq!(probe_count, 1);
        assert!(results
            .iter()
            .all(|result| matches!(result, ThumbnailItemResult::Skipped)));
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
            thumbnail_path: None,
            invoke_images_root: None,
            source_root: None,
            source_root_available: None,
        };

        let item = optimize_thumbnail_candidate(
            &candidate,
            &temp_thumbnail_dir("unused-thumb-output").to_string_lossy(),
            false,
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

        let stats = persist_thumbnail_results(
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
        assert_eq!(stats.checked, 0);
        assert!(stats.updates.is_empty());

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

        let result = optimize_thumbnail_candidate(&rows[0], "C:/thumbs", false, &is_cancelled);

        assert!(matches!(result, ThumbnailItemResult::Skipped));
    }
}
