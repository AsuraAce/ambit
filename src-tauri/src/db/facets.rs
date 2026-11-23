use super::{configure_connection, resolve_db_path, ProgressPayload};
use regex::Regex;
use rusqlite::{params, types::Value, OptionalExtension};
use std::collections::BTreeSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, TryLockError};
use std::time::Instant;
use tauri::Emitter;

const SLOW_RESOURCE_REFRESH_LOG_THRESHOLD_MS: u128 = 100;
const RESOURCE_INDEX_PROGRESS_INTERVAL_MS: u128 = 250;

static FACET_BUILD_COORDINATOR: OnceLock<Mutex<()>> = OnceLock::new();
// The last caller to take the facet build lock, and when. It is never cleared, and it is
// written just after the lock is taken, so a reader can see the previous holder for a moment
// after a new one took the lock. A waiter reads it when its try_lock fails (usually the
// caller holding the lock then) and again once it holds the lock (the caller that released
// it last). The lock is not FIFO, so a long wait can span several holders (#578).
static FACET_BUILD_HOLDER: Mutex<Option<(&'static str, Instant)>> = Mutex::new(None);

/// Runs tests that take the facet build lock one at a time, so one test's holder label never
/// lands in another's assertions.
#[cfg(test)]
pub(crate) fn serialize_facet_lock_test() -> MutexGuard<'static, ()> {
    static SERIAL: Mutex<()> = Mutex::new(());
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Counts observed waiters that found the lock busy, so a test can release a holder only once
/// its waiter is queued instead of guessing with a sleep.
#[cfg(test)]
static BLOCKED_FACET_WAITERS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// What a caller of the facet build lock waited on, when the lock was busy.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FacetLockWait {
    pub waited_ms: u64,
    /// The fixed label of the caller seen holding the lock when the wait began.
    pub holder: Option<&'static str>,
    /// How long that caller had held it when the wait began.
    pub holder_age_ms: Option<u64>,
    /// The fixed label of the caller that held the lock last before this one took it.
    pub released_by: Option<&'static str>,
    /// How long that caller had held it when this one took it.
    pub released_by_held_ms: Option<u64>,
}

impl FacetLockWait {
    /// Completes a wait that began at `started`. A blocked wait reads the holder record once
    /// more: it still names the caller that released the lock, until this caller records itself.
    fn finish(started: Instant, first_seen: Option<(&'static str, u64)>, blocked: bool) -> Self {
        let released = if blocked {
            current_facet_build_holder()
        } else {
            None
        };
        Self {
            waited_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            holder: first_seen.map(|(label, _)| label),
            holder_age_ms: first_seen.map(|(_, age)| age),
            released_by: released.map(|(label, _)| label),
            released_by_held_ms: released.map(|(_, age)| age),
        }
    }
}

fn facet_build_coordinator() -> &'static Mutex<()> {
    FACET_BUILD_COORDINATOR.get_or_init(|| Mutex::new(()))
}

fn record_facet_build_holder(label: &'static str) {
    *FACET_BUILD_HOLDER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((label, Instant::now()));
}

fn current_facet_build_holder() -> Option<(&'static str, u64)> {
    FACET_BUILD_HOLDER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .map(|(label, since)| {
            (
                label,
                since.elapsed().as_millis().min(u64::MAX as u128) as u64,
            )
        })
}

/// Takes the facet build lock, blocking, and reports the wait and who held the lock. The wait
/// is reported whether or not the lock was taken.
pub(crate) fn lock_facet_builds_observed(
    label: &'static str,
) -> (Result<MutexGuard<'static, ()>, String>, FacetLockWait) {
    const UNAVAILABLE: &str = "Facet build coordinator is unavailable";
    let started = Instant::now();
    let coordinator = facet_build_coordinator();
    let (guard, first_seen, blocked) = match coordinator.try_lock() {
        Ok(guard) => (Ok(guard), None, false),
        Err(TryLockError::WouldBlock) => {
            let first_seen = current_facet_build_holder();
            #[cfg(test)]
            BLOCKED_FACET_WAITERS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let guard = coordinator.lock().map_err(|_| UNAVAILABLE.to_string());
            (guard, first_seen, true)
        }
        Err(TryLockError::Poisoned(_)) => (Err(UNAVAILABLE.to_string()), None, false),
    };
    let wait = FacetLockWait::finish(started, first_seen, blocked);
    if guard.is_ok() {
        record_facet_build_holder(label);
    }
    (guard, wait)
}

/// The holder fields of a wait, for a log line: fixed labels and numbers only.
pub(crate) fn facet_lock_wait_log_fields(wait: &FacetLockWait) -> String {
    let age = |ms: Option<u64>| ms.map_or_else(|| "none".to_string(), |ms| ms.to_string());
    format!(
        "holder={} holder_age_ms={} released_by={} released_by_held_ms={}",
        wait.holder.unwrap_or("none"),
        age(wait.holder_age_ms),
        wait.released_by.unwrap_or("none"),
        age(wait.released_by_held_ms)
    )
}

pub(crate) fn lock_facet_builds(label: &'static str) -> Result<MutexGuard<'static, ()>, String> {
    lock_facet_builds_observed(label).0
}

fn create_facet_staging_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.facet_cache;
         CREATE TEMP TABLE facet_cache (
            facet_type TEXT NOT NULL,
            resource_name TEXT NOT NULL,
            resource_hash TEXT,
            count INTEGER DEFAULT 0,
            thumbnail_path TEXT,
            preview_url TEXT,
            last_used_at INTEGER,
            created_at INTEGER,
            is_manual INTEGER DEFAULT 0,
            has_sidecar INTEGER DEFAULT 0,
            is_user_override INTEGER DEFAULT 0,
            guidance_subtype TEXT,
            safe_thumbnail_path TEXT,
            thumbnail_image_id TEXT,
            thumbnail_is_sensitive INTEGER DEFAULT 0,
            thumbnail_sensitivity_override INTEGER,
            PRIMARY KEY (facet_type, resource_name)
         );",
    )
    .map_err(|error| error.to_string())
}

fn swap_staged_facet_cache(conn: &mut rusqlite::Connection) -> Result<usize, String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM temp.facet_cache", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let _hold = super::write_hold::WriteHold::begin("facets.swap_staged_cache");
    tx.execute("DELETE FROM main.facet_cache", [])
        .map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT INTO main.facet_cache
         SELECT * FROM temp.facet_cache",
        [],
    )
    .map_err(|error| error.to_string())?;
    tx.execute("DROP TABLE temp.facet_cache", [])
        .map_err(|error| error.to_string())?;
    // The staged rows come from an older snapshot; mask them against the live images.
    apply_live_privacy_to_facet_cache(&tx)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(count as usize)
}

fn should_log_resource_refresh(elapsed: std::time::Duration) -> bool {
    elapsed.as_millis() >= SLOW_RESOURCE_REFRESH_LOG_THRESHOLD_MS
}

fn with_active_scope_model_invalidation_suppressed<T>(
    conn: &rusqlite::Connection,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let updated = conn
        .execute(
            "UPDATE invoke_scope_cache_control
             SET suppress_active_model_invalidation = 1
             WHERE state_key = 'current'",
            [],
        )
        .map_err(|error| error.to_string())?;
    if updated != 1 {
        return Err("Invoke scope cache control row is missing".to_string());
    }

    let result = operation();
    let reset_result = conn
        .execute(
            "UPDATE invoke_scope_cache_control
             SET suppress_active_model_invalidation = 0
             WHERE state_key = 'current'",
            [],
        )
        .map_err(|error| error.to_string());

    match (result, reset_result) {
        (Ok(value), Ok(_)) => Ok(value),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_facet_cache(
    app: tauri::AppHandle,
    build_id: Option<String>,
) -> Result<usize, String> {
    let epoch = super::background_work::current_epoch();
    tauri::async_runtime::spawn_blocking(move || {
        let job = build_id
            .as_deref()
            .map(super::background_work::register_job);
        let stop = job.as_ref().map(|job| job.flag());
        let _coordinator = lock_facet_builds_unless_stopped("full rebuild", stop.as_ref())?;
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        // A reload, exit or stop request ends this rebuild; its open transaction rolls back.
        super::background_work::stop_when_epoch_changes_or_job_stopped(&conn, epoch, stop.clone());

        let count_result = build_full_facet_cache(&mut conn, stop.as_ref(), |payload| {
            let _ = app.emit("facet_cache_progress", payload);
        })
        .map_err(|error| {
            super::background_work::clean_up_stopped_connection(&conn, STAGING_TABLES);
            stopped_error(stop.as_ref(), error)
        })?;

        log::info!(
            "[FacetCache] Rebuild complete in {:?}. Total entries: {}",
            start_total.elapsed(),
            count_result
        );
        let _ = app.emit(
            "facet_cache_progress",
            ProgressPayload {
                current: 8,
                total: 8,
                message: "Cache rebuild complete.".into(),
            },
        );

        Ok(count_result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the facet build started with `build_id`, or the one about to start with it.
/// The page sends this only for a build it is still waiting for. The build rolls
/// back, so the live facet cache keeps its last state.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn stop_facet_build(build_id: String) {
    super::background_work::stop_job(&build_id);
}

/// TEMP tables a facet build stages into; a stopped build drops them.
const STAGING_TABLES: &[&str] = &["facet_cache", "harvested_models", "facet_source"];

/// Where a facet build reads image rows from.
///
/// A full build reads `scoped_images` once into `temp.facet_source`. An image row is
/// about 40 KB, and every scan of the view walks each row's overflow pages to reach
/// late columns such as `thumbnail_path` and `tool`. The extraction holds only the
/// columns the facet builders read, so the builders scan it cheaply (#565).
/// An incremental repair reads `scoped_images` as it always did.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum FacetSource {
    Scoped,
    Extract,
}

impl FacetSource {
    /// A compile-time constant, never user input.
    fn table(self) -> &'static str {
        match self {
            FacetSource::Scoped => "scoped_images",
            FacetSource::Extract => "temp.facet_source",
        }
    }

    /// The model name in `metadata_json`, the last fallback for a checkpoint name.
    fn metadata_model(self) -> &'static str {
        match self {
            FacetSource::Scoped => "json_extract(metadata_json, '$.model')",
            FacetSource::Extract => "metadata_model",
        }
    }
}

/// Reads the visible rows of `scoped_images` once, with the columns the facet builders need.
/// Every builder filters `is_deleted = 0`, so deleted rows are left out.
/// `metadata_model` is filled only for the rows the checkpoint thumbnail statements read
/// (`cp_thumbs`, `cp_safe_thumbs`) and only where the first two name columns are empty, so a
/// malformed `metadata_json` on any other row cannot fail the build, as before.
fn create_facet_source(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.facet_source;
         CREATE TEMP TABLE facet_source AS
         SELECT id, timestamp, is_pinned, is_deleted, invoke_scope_hidden, is_invoke_asset_gen,
                privacy_hidden, thumbnail_path, model_hash, resolved_model_name, model_name, tool,
                CASE WHEN NULLIF(resolved_model_name, '') IS NULL AND model_name IS NULL
                          AND is_deleted = 0 AND IFNULL(is_invoke_asset_gen, 0) = 0
                          AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
                     THEN json_extract(metadata_json, '$.model') END AS metadata_model
         FROM scoped_images
         WHERE invoke_scope_hidden = 0 AND is_deleted = 0;
         CREATE INDEX temp.facet_source_id ON facet_source(id);",
    )
    .map_err(|error| format!("Failed to extract the facet source rows: {}", error))
}

/// The message a facet build fails with when it was asked to stop.
pub(crate) const FACET_BUILD_STOPPED: &str = "Facet build was stopped.";

fn is_stop_requested(stop: Option<&Arc<AtomicBool>>) -> bool {
    stop.is_some_and(|stopped| stopped.load(Ordering::SeqCst))
}

fn ensure_not_stopped(stop: Option<&Arc<AtomicBool>>) -> Result<(), String> {
    if is_stop_requested(stop) {
        Err(FACET_BUILD_STOPPED.to_string())
    } else {
        Ok(())
    }
}

/// A statement interrupted by the stop handler reports SQLite's own message; say why instead.
fn stopped_error(stop: Option<&Arc<AtomicBool>>, error: String) -> String {
    if is_stop_requested(stop) {
        FACET_BUILD_STOPPED.to_string()
    } else {
        error
    }
}

/// Takes the facet build lock. A build with a stop flag gives up waiting once it is
/// stopped, so a stopped build queued behind another holder returns at once (#533).
/// A wait longer than a second is logged with `label`, to show what a slow step waited for.
pub(crate) fn lock_facet_builds_unless_stopped(
    label: &'static str,
    stop: Option<&Arc<AtomicBool>>,
) -> Result<MutexGuard<'static, ()>, String> {
    let (guard, wait) = match stop {
        None => {
            let (guard, wait) = lock_facet_builds_observed(label);
            (guard?, wait)
        }
        Some(_) => {
            let started = Instant::now();
            let coordinator = facet_build_coordinator();
            let mut first_seen = None;
            let mut blocked = false;
            let guard = loop {
                ensure_not_stopped(stop)?;
                match coordinator.try_lock() {
                    Ok(guard) => break guard,
                    Err(TryLockError::WouldBlock) => {
                        if !blocked {
                            blocked = true;
                            first_seen = current_facet_build_holder();
                        }
                        std::thread::sleep(std::time::Duration::from_millis(50))
                    }
                    Err(TryLockError::Poisoned(_)) => {
                        return Err("Facet build coordinator is unavailable".to_string())
                    }
                }
            };
            let wait = FacetLockWait::finish(started, first_seen, blocked);
            record_facet_build_holder(label);
            (guard, wait)
        }
    };
    if wait.waited_ms >= 1_000 {
        log::info!(
            "[FacetCache] {label} waited {} ms for the facet build lock {}",
            wait.waited_ms,
            facet_lock_wait_log_fields(&wait)
        );
    }
    Ok(guard)
}

fn build_full_facet_cache(
    conn: &mut rusqlite::Connection,
    stop: Option<&Arc<AtomicBool>>,
    mut emit: impl FnMut(ProgressPayload),
) -> Result<usize, String> {
    ensure_not_stopped(stop)?;
    log::debug!("[FacetCache] Starting rebuild...");
    emit(ProgressPayload {
        current: 0,
        total: 8,
        message: "Starting facet cache build...".into(),
    });

    // --- PHASE 1: HARVEST ---
    {
        log::debug!("[FacetCache] Harvesting models from images...");
        let start_harvest = std::time::Instant::now();
        emit(ProgressPayload {
            current: 1,
            total: 8,
            message: "Harvesting models from library...".into(),
        });

        harvest_models_staged(conn)?;
        log::info!(
            "[FacetCache] Harvest completed in {:?}.",
            start_harvest.elapsed()
        );
    }
    ensure_not_stopped(stop)?;

    // --- PHASE 2: BUILD CACHE ---
    // A TEMP table shadows the live cache on this connection. The expensive build
    // therefore keeps only a WAL read snapshot; normal library writes remain available.
    create_facet_staging_table(conn)?;
    let count_result = {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Clear existing cache
        tx.execute("DELETE FROM facet_cache", [])
            .map_err(|e| e.to_string())?;

        // One read of the library rows for every statement below (#565).
        let start_source = std::time::Instant::now();
        create_facet_source(&tx)?;
        log::info!(
            "[FacetCache] Source rows extracted in {:?}.",
            start_source.elapsed()
        );
        ensure_not_stopped(stop)?;
        let source = FacetSource::Extract;

        // 1. Checkpoints
        log::debug!("[FacetCache] Building checkpoints...");
        let start_cp = std::time::Instant::now();
        emit(ProgressPayload {
            current: 2,
            total: 8,
            message: "Building checkpoints cache...".into(),
        });
        build_checkpoint_facets(&tx, source)?;
        log::info!(
            "[FacetCache] Checkpoints built in {:?}.",
            start_cp.elapsed()
        );

        // 2. LoRAs
        log::debug!("[FacetCache] Building LoRAs...");
        let start_lora = std::time::Instant::now();
        emit(ProgressPayload {
            current: 3,
            total: 8,
            message: "Building LoRAs cache...".into(),
        });
        build_resource_facets(&tx, "loras", "loras", source)?;
        log::info!("[FacetCache] LoRAs built in {:?}.", start_lora.elapsed());

        // 3. Embeddings
        log::debug!("[FacetCache] Building Embeddings...");
        let start_emb = std::time::Instant::now();
        emit(ProgressPayload {
            current: 4,
            total: 8,
            message: "Building Embeddings cache...".into(),
        });
        build_resource_facets(&tx, "embeddings", "embeddings", source)?;
        log::info!(
            "[FacetCache] Embeddings built in {:?}.",
            start_emb.elapsed()
        );

        // 4. Hypernetworks
        log::debug!("[FacetCache] Building Hypernetworks...");
        let start_hyper = std::time::Instant::now();
        emit(ProgressPayload {
            current: 5,
            total: 8,
            message: "Building Hypernetworks cache...".into(),
        });
        build_resource_facets(&tx, "hypernetworks", "hypernetworks", source)?;
        log::info!(
            "[FacetCache] Hypernetworks built in {:?}.",
            start_hyper.elapsed()
        );

        // 5. Tools
        let start_tools = std::time::Instant::now();
        emit(ProgressPayload {
            current: 6,
            total: 8,
            message: "Building tools cache...".into(),
        });
        build_tool_facets(&tx, source)?;
        log::info!("[FacetCache] Tools built in {:?}.", start_tools.elapsed());

        // 6. ControlNets
        let start_cn = std::time::Instant::now();
        emit(ProgressPayload {
            current: 7,
            total: 8,
            message: "Building ControlNet cache...".into(),
        });
        build_resource_facets(&tx, "control_nets", "control_nets", source)?;
        log::info!(
            "[FacetCache] ControlNets built in {:?}.",
            start_cn.elapsed()
        );

        // 7. IP-Adapters
        let start_ip = std::time::Instant::now();
        emit(ProgressPayload {
            current: 8,
            total: 8,
            message: "Building IP-Adapter cache...".into(),
        });
        build_resource_facets(&tx, "ip_adapters", "ip_adapters", source)?;
        log::info!(
            "[FacetCache] IP-Adapters built in {:?}.",
            start_ip.elapsed()
        );

        sanitize_owner_hidden_facet_thumbnails(&tx)?;

        tx.execute("DROP TABLE IF EXISTS temp.facet_source", [])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        ensure_not_stopped(stop)?;

        // Replace the live cache in one short transaction after the staged build.
        let count = swap_staged_facet_cache(conn)?;

        // Update stats after rebuild
        let _ = conn.execute("ANALYZE facet_cache", []);
        let _ = conn.execute("ANALYZE models", []);

        count
    };

    Ok(count_result)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_facet_cache_incremental(
    app: tauri::AppHandle,
    facet_type: String,
) -> Result<usize, String> {
    rebuild_facet_cache_incremental_batch(app, vec![facet_type], None).await
}

fn normalize_facet_type(facet_type: &str) -> Result<&'static str, String> {
    match facet_type {
        "checkpoints" => Ok("checkpoints"),
        "tools" => Ok("tools"),
        "loras" => Ok("loras"),
        "embeddings" => Ok("embeddings"),
        "hypernetworks" => Ok("hypernetworks"),
        "controlNets" | "control_nets" => Ok("control_nets"),
        "ipAdapters" | "ip_adapters" => Ok("ip_adapters"),
        _ => Err(format!(
            "Unknown facet type for incremental build: {}",
            facet_type
        )),
    }
}

#[derive(
    Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct FacetResourceTouches {
    pub checkpoints: Vec<String>,
    pub loras: Vec<String>,
    pub embeddings: Vec<String>,
    pub hypernetworks: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceIndexProgressPayload {
    current: usize,
    total: usize,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResourceIndexKind {
    Checkpoints,
    Loras,
    Embeddings,
    Hypernetworks,
    ControlNets,
    IpAdapters,
    Tools,
}

impl ResourceIndexKind {
    fn facet_type(self) -> &'static str {
        match self {
            ResourceIndexKind::Checkpoints => "checkpoints",
            ResourceIndexKind::Loras => "loras",
            ResourceIndexKind::Embeddings => "embeddings",
            ResourceIndexKind::Hypernetworks => "hypernetworks",
            ResourceIndexKind::ControlNets => "control_nets",
            ResourceIndexKind::IpAdapters => "ip_adapters",
            ResourceIndexKind::Tools => "tools",
        }
    }

    fn index_message(self) -> &'static str {
        match self {
            ResourceIndexKind::Checkpoints => "Updating checkpoint index...",
            ResourceIndexKind::Loras => "Updating LoRA index...",
            ResourceIndexKind::Embeddings => "Updating embedding index...",
            ResourceIndexKind::Hypernetworks => "Updating hypernetwork index...",
            ResourceIndexKind::ControlNets => "Updating ControlNet index...",
            ResourceIndexKind::IpAdapters => "Updating IP-Adapter index...",
            ResourceIndexKind::Tools => "Updating tool index...",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResourceRefreshItem {
    kind: ResourceIndexKind,
    name: String,
}

fn push_resource_refresh_items(
    items: &mut Vec<ResourceRefreshItem>,
    kind: ResourceIndexKind,
    names: &[String],
    fallback: Option<&str>,
) {
    for name in normalize_live_names(names, fallback) {
        items.push(ResourceRefreshItem { kind, name });
    }
}

fn collect_resource_refresh_items(touches: &FacetResourceTouches) -> Vec<ResourceRefreshItem> {
    let mut items = Vec::new();

    push_resource_refresh_items(
        &mut items,
        ResourceIndexKind::Checkpoints,
        &touches.checkpoints,
        Some("Unknown"),
    );
    push_resource_refresh_items(&mut items, ResourceIndexKind::Loras, &touches.loras, None);
    push_resource_refresh_items(
        &mut items,
        ResourceIndexKind::Embeddings,
        &touches.embeddings,
        None,
    );
    push_resource_refresh_items(
        &mut items,
        ResourceIndexKind::Hypernetworks,
        &touches.hypernetworks,
        None,
    );
    push_resource_refresh_items(
        &mut items,
        ResourceIndexKind::ControlNets,
        &touches.control_nets,
        None,
    );
    push_resource_refresh_items(
        &mut items,
        ResourceIndexKind::IpAdapters,
        &touches.ip_adapters,
        None,
    );
    push_resource_refresh_items(
        &mut items,
        ResourceIndexKind::Tools,
        &touches.tools,
        Some("Unknown"),
    );

    items
}

fn resource_index_message(items: &[ResourceRefreshItem]) -> &'static str {
    let Some(first) = items.first() else {
        return "Updating local asset index...";
    };

    if items.iter().all(|item| item.kind == first.kind) {
        first.kind.index_message()
    } else {
        "Updating local asset index..."
    }
}

fn resource_index_progress_payload(
    current: usize,
    total: usize,
    message: &str,
    indexed_rows: usize,
) -> ResourceIndexProgressPayload {
    ResourceIndexProgressPayload {
        current,
        total,
        message: message.to_string(),
        phase: Some(message.trim_end_matches("...").to_string()),
        mode: Some("determinate".to_string()),
        detail: Some(format!("{} indexed", indexed_rows)),
    }
}

#[derive(Debug, Clone)]
struct FacetStats {
    count: i64,
    last_used_at: Option<i64>,
    created_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct FacetThumb {
    image_id: String,
    thumbnail_path: String,
    privacy_hidden: i64,
}

#[derive(Debug, Clone)]
struct FacetModelSource {
    name: String,
    hash: Option<String>,
    thumbnail_path: Option<String>,
    sidecar_thumbnail_path: Option<String>,
    preview_url: Option<String>,
    thumbnail_mode: Option<String>,
    guidance_subtype: Option<String>,
    thumbnail_sensitivity_override: Option<i64>,
}

#[derive(Debug, Clone, Copy)]
struct ResourceFacetConfig {
    facet_type: &'static str,
    resource_type: &'static str,
    junction_table: &'static str,
    name_col: &'static str,
    hash_prefix: &'static str,
    harvest_source: &'static str,
}

fn clean_live_resource_name(raw: &str) -> Option<String> {
    let mut name = raw.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let weighted_index = name.find(" (");
    let colon_index = name.find(':');
    let cut_index = [weighted_index, colon_index]
        .into_iter()
        .flatten()
        .filter(|index| *index > 0)
        .min();

    if let Some(index) = cut_index {
        name.truncate(index);
        name = name.trim().to_string();
    }

    let lower = name.to_lowercase();
    for suffix in [".safetensors", ".ckpt", ".pt", ".bin", ".pth"] {
        if lower.ends_with(suffix) {
            let new_len = name.len().saturating_sub(suffix.len());
            name.truncate(new_len);
            name = name.trim().to_string();
            break;
        }
    }

    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn normalize_live_names(names: &[String], fallback: Option<&str>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();

    if names.is_empty() {
        return normalized;
    }

    for name in names {
        if let Some(cleaned) = clean_live_resource_name(name) {
            let key = cleaned.to_lowercase();
            if seen.insert(key) {
                normalized.push(cleaned);
            }
        }
    }

    if normalized.is_empty() {
        if let Some(fallback) = fallback {
            normalized.push(fallback.to_string());
        }
    }

    normalized
}

fn resource_config(facet_type: &str) -> Result<ResourceFacetConfig, String> {
    match facet_type {
        "loras" => Ok(ResourceFacetConfig {
            facet_type: "loras",
            resource_type: "loras",
            junction_table: "image_loras",
            name_col: "lora_name",
            hash_prefix: "lora_",
            harvest_source: "harvest_lora",
        }),
        "embeddings" => Ok(ResourceFacetConfig {
            facet_type: "embeddings",
            resource_type: "embeddings",
            junction_table: "image_embeddings",
            name_col: "embedding_name",
            hash_prefix: "emb_",
            harvest_source: "harvest_embedding",
        }),
        "hypernetworks" => Ok(ResourceFacetConfig {
            facet_type: "hypernetworks",
            resource_type: "hypernetworks",
            junction_table: "image_hypernetworks",
            name_col: "hypernetwork_name",
            hash_prefix: "hyper_",
            harvest_source: "harvest_hypernet",
        }),
        "control_nets" => Ok(ResourceFacetConfig {
            facet_type: "control_nets",
            resource_type: "control_nets",
            junction_table: "image_controlnets",
            name_col: "controlnet_name",
            hash_prefix: "cnet_",
            harvest_source: "harvest_controlnet",
        }),
        "ip_adapters" => Ok(ResourceFacetConfig {
            facet_type: "ip_adapters",
            resource_type: "ip_adapters",
            junction_table: "image_ipadapters",
            name_col: "ipadapter_name",
            hash_prefix: "ipad_",
            harvest_source: "harvest_ip_adapter",
        }),
        _ => Err(format!("Unsupported resource facet type: {}", facet_type)),
    }
}

fn privacy_keyword_matches(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let matches: i64 = conn
        .query_row(
            "SELECT EXISTS (
                SELECT 1 FROM privacy_mask_keywords k
                WHERE LOWER(?1) LIKE '%' || k.keyword || '%'
            )",
            [name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(matches != 0)
}

fn manual_thumbnail_image(
    conn: &rusqlite::Connection,
    thumbnail_path: &str,
) -> Result<Option<(String, i64, i64)>, String> {
    for column in ["id", "path", "thumbnail_path"] {
        let query = if column == "thumbnail_path" {
            "SELECT i.id, COALESCE(i.privacy_hidden, 0),
                    NOT EXISTS (SELECT 1 FROM scoped_images visible WHERE visible.id = i.id) AS owner_hidden
             FROM images i
             WHERE i.thumbnail_path = ?1
             AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
             ORDER BY owner_hidden ASC
             LIMIT 1"
                .to_string()
        } else {
            format!(
                "SELECT i.id, COALESCE(i.privacy_hidden, 0),
                        NOT EXISTS (SELECT 1 FROM scoped_images visible WHERE visible.id = i.id)
                 FROM images i
                 WHERE i.{column} = ?1
                 LIMIT 1"
            )
        };
        let result = conn
            .query_row(&query, [thumbnail_path], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;

        if result.is_some() {
            return Ok(result);
        }
    }

    Ok(None)
}

struct FacetThumbnailFields {
    thumbnail_path: Option<String>,
    safe_thumbnail_path: Option<String>,
    thumbnail_image_id: Option<String>,
    thumbnail_is_sensitive: i64,
}

fn compute_thumbnail_fields(
    conn: &rusqlite::Connection,
    model: &FacetModelSource,
    dynamic_thumb: Option<&FacetThumb>,
    safe_thumb: Option<&FacetThumb>,
) -> Result<FacetThumbnailFields, String> {
    let manual_thumb = model
        .thumbnail_path
        .as_deref()
        .filter(|value| !value.is_empty());
    let sidecar_thumb = model
        .sidecar_thumbnail_path
        .as_deref()
        .filter(|value| !value.is_empty());
    let preview_url = model
        .preview_url
        .as_deref()
        .filter(|value| !value.is_empty());
    let dynamic_path = dynamic_thumb.map(|thumb| thumb.thumbnail_path.as_str());
    let thumbnail_mode = model.thumbnail_mode.as_deref();

    let manual_image = match manual_thumb {
        Some(path) => manual_thumbnail_image(conn, path)?,
        None => None,
    };
    let usable_manual_thumb = manual_thumb.filter(
        |_| !matches!(manual_image.as_ref(), Some((_, _, owner_hidden)) if *owner_hidden != 0),
    );
    let thumbnail_path = if let Some(path) = usable_manual_thumb {
        Some(path.to_string())
    } else if thumbnail_mode == Some("dynamic") {
        dynamic_path.or(preview_url).map(str::to_string)
    } else {
        sidecar_thumb
            .or(dynamic_path)
            .or(preview_url)
            .map(str::to_string)
    };
    let thumbnail_image_id = if usable_manual_thumb.is_some() {
        manual_image.as_ref().map(|(id, _, _)| id.clone())
    } else {
        dynamic_thumb.map(|thumb| thumb.image_id.clone())
    };

    let sensitive = if model.thumbnail_sensitivity_override == Some(0) {
        0
    } else if model.thumbnail_sensitivity_override == Some(1)
        || privacy_keyword_matches(conn, &model.name)?
    {
        1
    } else if usable_manual_thumb.is_some() {
        manual_image.map(|(_, hidden, _)| hidden).unwrap_or(1)
    } else if thumbnail_mode == Some("dynamic") {
        dynamic_thumb.map(|thumb| thumb.privacy_hidden).unwrap_or(0)
    } else if sidecar_thumb.is_some() || preview_url.is_some() {
        1
    } else {
        dynamic_thumb.map(|thumb| thumb.privacy_hidden).unwrap_or(0)
    };

    Ok(FacetThumbnailFields {
        thumbnail_path,
        safe_thumbnail_path: safe_thumb.map(|thumb| thumb.thumbnail_path.clone()),
        thumbnail_image_id,
        thumbnail_is_sensitive: sensitive,
    })
}

fn sanitize_owner_hidden_facet_thumbnails(conn: &rusqlite::Connection) -> Result<usize, String> {
    conn.execute(
        "UPDATE facet_cache
         SET thumbnail_path = safe_thumbnail_path,
             thumbnail_image_id = NULL,
             thumbnail_is_sensitive = CASE
                 WHEN safe_thumbnail_path IS NOT NULL AND safe_thumbnail_path != '' THEN 0
                 ELSE 1
             END
         WHERE EXISTS (
             SELECT 1
             FROM images owner_hidden
             WHERE NOT EXISTS (
                       SELECT 1 FROM scoped_images visible
                       WHERE visible.id = owner_hidden.id
                   )
               AND (
                   owner_hidden.id = facet_cache.thumbnail_image_id
                   OR owner_hidden.id = facet_cache.thumbnail_path
                   OR owner_hidden.path = facet_cache.thumbnail_path
                   OR (
                       owner_hidden.thumbnail_path IS NOT NULL
                       AND owner_hidden.thumbnail_path != ''
                       AND owner_hidden.thumbnail_path = facet_cache.thumbnail_path
                   )
               )
         )",
        [],
    )
    .map_err(|e| e.to_string())
}

fn insert_facet_row(
    conn: &rusqlite::Connection,
    facet_type: &str,
    model: &FacetModelSource,
    stats: &FacetStats,
    dynamic_thumb: Option<&FacetThumb>,
    safe_thumb: Option<&FacetThumb>,
) -> Result<(), String> {
    let FacetThumbnailFields {
        thumbnail_path,
        safe_thumbnail_path,
        thumbnail_image_id,
        thumbnail_is_sensitive,
    } = compute_thumbnail_fields(conn, model, dynamic_thumb, safe_thumb)?;
    let has_sidecar = model
        .sidecar_thumbnail_path
        .as_ref()
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    let is_user_override = model
        .thumbnail_path
        .as_ref()
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    let is_manual = is_user_override || (has_sidecar && model.thumbnail_mode.is_none());

    conn.execute(
        "INSERT INTO facet_cache (
            facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url,
            last_used_at, created_at, is_manual, has_sidecar, is_user_override,
            guidance_subtype, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive,
            thumbnail_sensitivity_override
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            facet_type,
            &model.name,
            &model.hash,
            stats.count,
            &thumbnail_path,
            &model.preview_url,
            stats.last_used_at,
            stats.created_at,
            if is_manual { 1 } else { 0 },
            if has_sidecar { 1 } else { 0 },
            if is_user_override { 1 } else { 0 },
            &model.guidance_subtype,
            &safe_thumbnail_path,
            &thumbnail_image_id,
            thumbnail_is_sensitive,
            model.thumbnail_sensitivity_override
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn select_model_source(
    conn: &rusqlite::Connection,
    resource_type: &str,
    name: &str,
) -> Result<Option<FacetModelSource>, String> {
    conn.query_row(
        "SELECT name, hash, thumbnail_path, sidecar_thumbnail_path, preview_url,
                thumbnail_mode, guidance_subtype, thumbnail_sensitivity_override
         FROM models
         WHERE resource_type = ?1 AND LOWER(name) = LOWER(?2)
         ORDER BY CASE WHEN name = ?2 THEN 0 ELSE 1 END
         LIMIT 1",
        params![resource_type, name],
        |row| {
            Ok(FacetModelSource {
                name: row.get(0)?,
                hash: row.get(1)?,
                thumbnail_path: row.get(2)?,
                sidecar_thumbnail_path: row.get(3)?,
                preview_url: row.get(4)?,
                thumbnail_mode: row.get(5)?,
                guidance_subtype: row.get(6)?,
                thumbnail_sensitivity_override: row.get(7)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn fallback_model_source(
    name: &str,
    hash: Option<String>,
    guidance_subtype: Option<String>,
) -> FacetModelSource {
    FacetModelSource {
        name: name.to_string(),
        hash,
        thumbnail_path: None,
        sidecar_thumbnail_path: None,
        preview_url: None,
        thumbnail_mode: None,
        guidance_subtype,
        thumbnail_sensitivity_override: None,
    }
}

fn query_checkpoint_stats(
    conn: &rusqlite::Connection,
    name: &str,
    is_unknown: bool,
) -> Result<FacetStats, String> {
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(FacetStats {
            count: row.get(0)?,
            last_used_at: row.get(1)?,
            created_at: row.get(2)?,
        })
    };

    if is_unknown {
        conn.query_row(
            "SELECT COUNT(*), MAX(timestamp), MIN(timestamp)
             FROM scoped_images
             WHERE invoke_scope_hidden = 0 AND is_deleted = 0
             AND IFNULL(is_invoke_asset_gen, 0) = 0
             AND COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') = 'Unknown'",
            [],
            map_row,
        )
    } else {
        conn.query_row(
            "SELECT COUNT(*), MAX(timestamp), MIN(timestamp)
             FROM scoped_images
             WHERE invoke_scope_hidden = 0 AND is_deleted = 0
             AND IFNULL(is_invoke_asset_gen, 0) = 0
             AND resolved_model_name = ?1",
            params![name],
            map_row,
        )
    }
    .map_err(|e| e.to_string())
}

fn query_checkpoint_thumb(
    conn: &rusqlite::Connection,
    name: &str,
    is_unknown: bool,
    safe_only: bool,
) -> Result<Option<FacetThumb>, String> {
    let privacy_filter = if safe_only {
        "AND privacy_hidden = 0"
    } else {
        ""
    };
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(FacetThumb {
            image_id: row.get(0)?,
            thumbnail_path: row.get(1)?,
            privacy_hidden: row.get(2)?,
        })
    };

    if is_unknown {
        conn.query_row(
            &format!(
                "SELECT id, thumbnail_path, COALESCE(privacy_hidden, 0)
                 FROM scoped_images
                 WHERE invoke_scope_hidden = 0 AND is_deleted = 0
                 AND IFNULL(is_invoke_asset_gen, 0) = 0
                 {privacy_filter}
                 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
                 AND COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') = 'Unknown'
                 ORDER BY is_pinned DESC, timestamp DESC
                 LIMIT 1"
            ),
            [],
            map_row,
        )
    } else {
        conn.query_row(
            &format!(
                "SELECT id, thumbnail_path, COALESCE(privacy_hidden, 0)
                 FROM scoped_images
                 WHERE invoke_scope_hidden = 0 AND is_deleted = 0
                 AND IFNULL(is_invoke_asset_gen, 0) = 0
                 {privacy_filter}
                 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
                 AND resolved_model_name = ?1
                 ORDER BY is_pinned DESC, timestamp DESC
                 LIMIT 1"
            ),
            params![name],
            map_row,
        )
    }
    .optional()
    .map_err(|e| e.to_string())
}

fn query_checkpoint_hash(
    conn: &rusqlite::Connection,
    name: &str,
    is_unknown: bool,
    allow_asset_hash: bool,
) -> Result<Option<String>, String> {
    if is_unknown {
        conn.query_row(
            "SELECT model_hash
             FROM scoped_images
             WHERE invoke_scope_hidden = 0 AND is_deleted = 0
             AND (?1 OR IFNULL(is_invoke_asset_gen, 0) = 0)
             AND model_hash IS NOT NULL AND model_hash != ''
             AND COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') = 'Unknown'
             ORDER BY timestamp DESC
             LIMIT 1",
            [allow_asset_hash],
            |row| row.get::<_, String>(0),
        )
    } else {
        conn.query_row(
            "SELECT model_hash
             FROM scoped_images
             WHERE invoke_scope_hidden = 0 AND is_deleted = 0
             AND (?1 OR IFNULL(is_invoke_asset_gen, 0) = 0)
             AND model_hash IS NOT NULL AND model_hash != ''
             AND resolved_model_name = ?2
             ORDER BY timestamp DESC
             LIMIT 1",
            params![allow_asset_hash, name],
            |row| row.get::<_, String>(0),
        )
    }
    .optional()
    .map_err(|e| e.to_string())
}

fn query_checkpoint_has_images(
    conn: &rusqlite::Connection,
    name: &str,
    is_unknown: bool,
) -> Result<bool, String> {
    let result = if is_unknown {
        conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM scoped_images
                WHERE invoke_scope_hidden = 0 AND is_deleted = 0
                AND COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') = 'Unknown'
            )",
            [],
            |row| row.get(0),
        )
    } else {
        conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM scoped_images
                WHERE invoke_scope_hidden = 0 AND is_deleted = 0 AND resolved_model_name = ?1
            )",
            [name],
            |row| row.get(0),
        )
    };
    result.map_err(|e| e.to_string())
}

fn refresh_checkpoint_facet(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let started_at = std::time::Instant::now();
    conn.execute(
        "DELETE FROM facet_cache WHERE facet_type = 'checkpoints' AND LOWER(resource_name) = LOWER(?1)",
        [name],
    )
    .map_err(|e| e.to_string())?;

    let is_unknown = name == "Unknown";
    let stats = query_checkpoint_stats(conn, name, is_unknown)?;

    let model = select_model_source(conn, "checkpoint", name)?;
    let has_images = query_checkpoint_has_images(conn, name, is_unknown)?;
    if !has_images && model.is_none() {
        let elapsed = started_at.elapsed();
        if should_log_resource_refresh(elapsed) {
            println!(
                "[FacetCache] Resource refresh checkpoints:{} removed in {:?}.",
                name, elapsed
            );
        }
        return Ok(false);
    }

    let dynamic_thumb = query_checkpoint_thumb(conn, name, is_unknown, false)?;
    let safe_thumb = query_checkpoint_thumb(conn, name, is_unknown, true)?;
    let model_hash = query_checkpoint_hash(conn, name, is_unknown, stats.count == 0)?;
    let fallback_hash = model_hash.or_else(|| Some(format!("orphan_{name}")));

    let mut source =
        model.unwrap_or_else(|| fallback_model_source(name, fallback_hash.clone(), None));
    if stats.count > 0 {
        source.hash = fallback_hash;
    }
    insert_facet_row(
        conn,
        "checkpoints",
        &source,
        &stats,
        dynamic_thumb.as_ref(),
        safe_thumb.as_ref(),
    )?;

    let elapsed = started_at.elapsed();
    if should_log_resource_refresh(elapsed) {
        println!(
            "[FacetCache] Resource refresh checkpoints:{} completed in {:?}.",
            source.name, elapsed
        );
    }
    Ok(true)
}

fn refresh_tool_facet(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let started_at = std::time::Instant::now();
    conn.execute(
        "DELETE FROM facet_cache WHERE facet_type = 'tools' AND resource_name = ?1",
        [name],
    )
    .map_err(|e| e.to_string())?;

    let stats = conn
        .query_row(
            "SELECT COUNT(*), MAX(timestamp), MIN(timestamp)
             FROM scoped_images
             WHERE invoke_scope_hidden = 0 AND is_deleted = 0
             AND IFNULL(is_invoke_asset_gen, 0) = 0
             AND COALESCE(tool, 'Unknown') = ?1",
            [name],
            |row| {
                Ok(FacetStats {
                    count: row.get(0)?,
                    last_used_at: row.get(1)?,
                    created_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let has_images = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM scoped_images
                WHERE invoke_scope_hidden = 0 AND is_deleted = 0 AND COALESCE(tool, 'Unknown') = ?1
            )",
            [name],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|e| e.to_string())?;

    if !has_images {
        let elapsed = started_at.elapsed();
        if should_log_resource_refresh(elapsed) {
            println!(
                "[FacetCache] Resource refresh tools:{} removed in {:?}.",
                name, elapsed
            );
        }
        return Ok(false);
    }

    let source = fallback_model_source(name, None, None);
    insert_facet_row(conn, "tools", &source, &stats, None, None)?;

    let elapsed = started_at.elapsed();
    if should_log_resource_refresh(elapsed) {
        println!(
            "[FacetCache] Resource refresh tools:{} completed in {:?}.",
            name, elapsed
        );
    }
    Ok(true)
}

fn model_hash_exists(conn: &rusqlite::Connection, hash: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM main.models WHERE hash = ?1)",
        [hash],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn refresh_resource_facet(
    conn: &rusqlite::Connection,
    config: ResourceFacetConfig,
    name: &str,
    now: u64,
    stage_models: bool,
) -> Result<bool, String> {
    let started_at = std::time::Instant::now();

    conn.execute(
        "DELETE FROM facet_cache WHERE facet_type = ?1 AND LOWER(resource_name) = LOWER(?2)",
        params![config.facet_type, name],
    )
    .map_err(|e| e.to_string())?;

    let match_started_at = std::time::Instant::now();
    conn.execute("DROP TABLE IF EXISTS live_resource_matches", [])
        .map_err(|e| e.to_string())?;
    let clean_ref = resource_clean_ref_sql(&format!("jt.{}", config.name_col));
    let matches_sql = format!(
        "CREATE TEMP TABLE live_resource_matches AS
         SELECT
            i.id,
            i.timestamp,
            COALESCE(i.is_pinned, 0) AS is_pinned,
            i.thumbnail_path,
            COALESCE(i.privacy_hidden, 0) AS privacy_hidden,
            COALESCE(i.is_invoke_asset_gen, 0) AS is_invoke_asset_gen
         FROM {} jt
         JOIN scoped_images i ON i.id = jt.image_id
         WHERE i.invoke_scope_hidden = 0 AND i.is_deleted = 0
         AND ({}) COLLATE NOCASE IN (
             ?1,
             ?1 || '.safetensors',
             ?1 || '.ckpt',
             ?1 || '.pt',
             ?1 || '.bin',
             ?1 || '.pth'
         )",
        config.junction_table, clean_ref
    );
    conn.execute(&matches_sql, [name])
        .map_err(|e| e.to_string())?;
    let match_ms = match_started_at.elapsed();

    let stats_started_at = std::time::Instant::now();
    let stats = conn
        .query_row(
            "SELECT COUNT(DISTINCT id), MAX(timestamp), MIN(timestamp)
             FROM live_resource_matches
             WHERE is_invoke_asset_gen = 0",
            [],
            |row| {
                Ok(FacetStats {
                    count: row.get(0)?,
                    last_used_at: row.get(1)?,
                    created_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    let stats_ms = stats_started_at.elapsed();

    let model_started_at = std::time::Instant::now();
    let has_images = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM live_resource_matches)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|e| e.to_string())?;

    let model_hash = format!("{}{}", config.hash_prefix, name);
    let model_params = params![
        model_hash,
        name,
        config.harvest_source,
        now as i64,
        config.resource_type
    ];
    let mut model = select_model_source(conn, config.resource_type, name)?;
    if has_images && stage_models {
        // A read snapshot cannot write `models`: queue the row for the swap, and use the
        // row the insert below would have read back (only `hash` is unique on `models`).
        if model.is_none() && !model_hash_exists(conn, &model_hash)? {
            conn.execute(
                "INSERT OR IGNORE INTO temp.staged_resource_models
                 (hash, name, lookup_source, scanned_at, resource_type)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                model_params,
            )
            .map_err(|e| e.to_string())?;
            model = Some(fallback_model_source(name, Some(model_hash.clone()), None));
        }
    } else if has_images {
        with_active_scope_model_invalidation_suppressed(conn, || {
            conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                model_params,
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        })?;
        model = select_model_source(conn, config.resource_type, name)?;
    }

    let model_ms = model_started_at.elapsed();
    if stats.count == 0 && model.is_none() {
        conn.execute("DROP TABLE IF EXISTS live_resource_matches", [])
            .ok();
        let elapsed = started_at.elapsed();
        if should_log_resource_refresh(elapsed) {
            println!(
                "[FacetCache] Resource refresh {}:{} removed in {:?}. Timings: match={:?}, stats={:?}, model={:?}.",
                config.facet_type, name, elapsed, match_ms, stats_ms, model_ms
            );
        }
        return Ok(false);
    }

    let thumb_started_at = std::time::Instant::now();
    let dynamic_thumb = conn
        .query_row(
            "SELECT i.id, i.thumbnail_path, COALESCE(i.privacy_hidden, 0)
         FROM live_resource_matches i
         WHERE i.is_invoke_asset_gen = 0
         AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
         ORDER BY i.is_pinned DESC, i.timestamp DESC
         LIMIT 1",
            [],
            |row| {
                Ok(FacetThumb {
                    image_id: row.get(0)?,
                    thumbnail_path: row.get(1)?,
                    privacy_hidden: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let safe_thumb = conn
        .query_row(
            "SELECT i.id, i.thumbnail_path, COALESCE(i.privacy_hidden, 0)
         FROM live_resource_matches i
         WHERE i.is_invoke_asset_gen = 0
         AND i.privacy_hidden = 0
         AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
         ORDER BY i.is_pinned DESC, i.timestamp DESC
         LIMIT 1",
            [],
            |row| {
                Ok(FacetThumb {
                    image_id: row.get(0)?,
                    thumbnail_path: row.get(1)?,
                    privacy_hidden: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let thumb_ms = thumb_started_at.elapsed();

    let source = model.unwrap_or_else(|| {
        fallback_model_source(name, Some(format!("{}{}", config.hash_prefix, name)), None)
    });
    let insert_started_at = std::time::Instant::now();
    insert_facet_row(
        conn,
        config.facet_type,
        &source,
        &stats,
        dynamic_thumb.as_ref(),
        safe_thumb.as_ref(),
    )?;
    let insert_ms = insert_started_at.elapsed();
    conn.execute("DROP TABLE IF EXISTS live_resource_matches", [])
        .ok();

    let elapsed = started_at.elapsed();
    if should_log_resource_refresh(elapsed) {
        println!(
            "[FacetCache] Resource refresh {}:{} completed in {:?}. Timings: match={:?}, stats={:?}, model={:?}, thumbs={:?}, insert={:?}.",
            config.facet_type,
            source.name,
            elapsed,
            match_ms,
            stats_ms,
            model_ms,
            thumb_ms,
            insert_ms
        );
    }
    Ok(true)
}

pub(crate) fn refresh_live_facet_resources(
    conn: &mut rusqlite::Connection,
    touches: &FacetResourceTouches,
) -> Result<usize, String> {
    refresh_live_facet_resources_with_progress(conn, touches, |_| {})
}

fn refresh_live_facet_resources_with_progress<F>(
    conn: &mut rusqlite::Connection,
    touches: &FacetResourceTouches,
    mut emit_progress: F,
) -> Result<usize, String>
where
    F: FnMut(ResourceIndexProgressPayload),
{
    let items = collect_resource_refresh_items(touches);
    let total = items.len();
    let message = resource_index_message(&items);

    if total > 0 {
        emit_progress(resource_index_progress_payload(0, total, message, 0));
    }

    // Same staging as the incremental rebuild: the refresh reads for most of a minute on a
    // large library, and doing it in place held the write lock all that time (#464).
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.staged_resource_models;
         CREATE TEMP TABLE staged_resource_models (
            hash TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lookup_source TEXT,
            scanned_at INTEGER,
            resource_type TEXT
         );",
    )
    .map_err(|e| e.to_string())?;
    let staged = create_facet_staging_table(conn)
        .and_then(|()| stage_live_facet_resources(conn, touches, &mut emit_progress))
        .and_then(|(refreshed, marker)| {
            swap_staged_facet_resources(conn, &items, &marker).map(|()| refreshed)
        });
    let _ = conn.execute_batch(
        "DROP TABLE IF EXISTS temp.facet_cache;
         DROP TABLE IF EXISTS temp.staged_resource_models;",
    );
    let refreshed = staged?;

    if total > 0 {
        emit_progress(resource_index_progress_payload(
            total, total, message, refreshed,
        ));
    }

    Ok(refreshed)
}

fn stage_live_facet_resources<F>(
    conn: &mut rusqlite::Connection,
    touches: &FacetResourceTouches,
    emit_progress: &mut F,
) -> Result<(usize, Option<ScopeChangeMarker>), String>
where
    F: FnMut(ResourceIndexProgressPayload),
{
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let marker = read_scope_change_marker(&tx)?;
    let refreshed = refresh_live_facet_resources_in_transaction_with_progress(
        &tx,
        touches,
        emit_progress,
        true,
    )?;
    sanitize_owner_hidden_facet_thumbnails(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok((refreshed, marker))
}

/// Replaces the refreshed resources' live rows with the staged ones in one short
/// transaction; see `swap_staged_facet_types` for why a stale snapshot still swaps.
fn swap_staged_facet_resources(
    conn: &mut rusqlite::Connection,
    items: &[ResourceRefreshItem],
    staged_marker: &Option<ScopeChangeMarker>,
) -> Result<(), String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let _hold = super::write_hold::WriteHold::begin("facets.swap_staged_resources");
    with_active_scope_model_invalidation_suppressed(&tx, || {
        tx.execute(
            "INSERT OR IGNORE INTO main.models (hash, name, lookup_source, scanned_at, resource_type)
             SELECT hash, name, lookup_source, scanned_at, resource_type
             FROM temp.staged_resource_models ORDER BY rowid",
            [],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    })?;
    for item in items {
        // The same rows each refresh function deletes before rebuilding its resource.
        let sql = match item.kind {
            ResourceIndexKind::Tools => {
                "DELETE FROM main.facet_cache WHERE facet_type = ?1 AND resource_name = ?2"
            }
            _ => {
                "DELETE FROM main.facet_cache
                 WHERE facet_type = ?1 AND LOWER(resource_name) = LOWER(?2)"
            }
        };
        tx.execute(sql, params![item.kind.facet_type(), item.name])
            .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO main.facet_cache SELECT * FROM temp.facet_cache",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DROP TABLE temp.facet_cache", [])
        .map_err(|e| e.to_string())?;
    apply_live_privacy_to_facet_cache(&tx)?;
    mark_owner_cache_dirty_if_changed(&tx, staged_marker)?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
pub(crate) fn refresh_live_facet_resources_in_transaction(
    conn: &rusqlite::Connection,
    touches: &FacetResourceTouches,
) -> Result<usize, String> {
    refresh_live_facet_resources_in_transaction_with_progress(conn, touches, &mut |_| {}, false)
}

fn refresh_live_facet_resources_in_transaction_with_progress<F>(
    conn: &rusqlite::Connection,
    touches: &FacetResourceTouches,
    emit_progress: &mut F,
    stage_models: bool,
) -> Result<usize, String>
where
    F: FnMut(ResourceIndexProgressPayload),
{
    let items = collect_resource_refresh_items(touches);
    let total = items.len();
    let message = resource_index_message(&items);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut refreshed = 0;
    let mut last_progress_emit = Instant::now();

    for (index, item) in items.iter().enumerate() {
        let did_refresh = match item.kind {
            ResourceIndexKind::Checkpoints => refresh_checkpoint_facet(conn, &item.name)?,
            ResourceIndexKind::Tools => refresh_tool_facet(conn, &item.name)?,
            _ => {
                let config = resource_config(item.kind.facet_type())?;
                refresh_resource_facet(conn, config, &item.name, now, stage_models)?
            }
        };

        if did_refresh {
            refreshed += 1;
        }

        let processed = index + 1;
        if processed < total
            && last_progress_emit.elapsed().as_millis() >= RESOURCE_INDEX_PROGRESS_INTERVAL_MS
        {
            emit_progress(resource_index_progress_payload(
                processed, total, message, refreshed,
            ));
            last_progress_emit = Instant::now();
        }
    }

    Ok(refreshed)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_facet_cache_for_resources(
    app: tauri::AppHandle,
    touches: FacetResourceTouches,
    build_id: Option<String>,
) -> Result<usize, String> {
    let epoch = super::background_work::current_epoch();
    tauri::async_runtime::spawn_blocking(move || {
        let job = build_id
            .as_deref()
            .map(super::background_work::register_job);
        let stop = job.as_ref().map(|job| job.flag());
        let _coordinator = lock_facet_builds_unless_stopped("resource refresh", stop.as_ref())?;
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        // A reload, exit or stop request ends this rebuild; its open transaction rolls back.
        super::background_work::stop_when_epoch_changes_or_job_stopped(&conn, epoch, stop.clone());

        let refreshed = ensure_not_stopped(stop.as_ref())
            .and_then(|()| {
                refresh_live_facet_resources_with_progress(&mut conn, &touches, |payload| {
                    let _ = app.emit("discovery_scan_progress", payload);
                })
            })
            .map_err(|error| {
                super::background_work::clean_up_stopped_connection(&conn, STAGING_TABLES);
                stopped_error(stop.as_ref(), error)
            })?;
        println!(
            "[FacetCache] Resource incremental refresh complete in {:?}. Rows refreshed: {}",
            start_total.elapsed(),
            refreshed
        );

        Ok(refreshed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
fn rebuild_incremental_facet_types(
    conn: &mut rusqlite::Connection,
    facet_types: &[String],
) -> Result<Vec<String>, String> {
    rebuild_incremental_facet_types_unless_stopped(conn, facet_types, None)
}

fn rebuild_incremental_facet_types_unless_stopped(
    conn: &mut rusqlite::Connection,
    facet_types: &[String],
    stop: Option<&Arc<AtomicBool>>,
) -> Result<Vec<String>, String> {
    ensure_not_stopped(stop)?;
    let mut normalized_types: Vec<String> = Vec::new();

    for facet_type in facet_types {
        let db_facet_type = normalize_facet_type(facet_type)?.to_string();
        if !normalized_types.contains(&db_facet_type) {
            normalized_types.push(db_facet_type);
        }
    }

    if normalized_types.is_empty() {
        return Ok(Vec::new());
    }

    // Modeling harvesting ensures any new models from recent image imports/edits are in 'models' table
    harvest_models_staged(conn)?;
    ensure_not_stopped(stop)?;

    // Build into a TEMP table that shadows the live cache on this connection, under a read
    // snapshot only, then swap the rows in one short write transaction. Building in place
    // held the write lock for the whole build, 30-40 s on a large library, and every user
    // write in that window failed (#464).
    create_facet_staging_table(conn)?;
    let staged = stage_incremental_facet_types(conn, &normalized_types).and_then(|marker| {
        ensure_not_stopped(stop)?;
        swap_staged_facet_types(conn, &normalized_types, &marker)
    });
    if staged.is_err() {
        let _ = conn.execute("DROP TABLE IF EXISTS temp.facet_cache", []);
    }
    staged?;

    Ok(normalized_types)
}

/// The owner scope cache's change counter as a staged build saw it. Library and resource
/// triggers advance it (m69-m85), so a swap can tell that its snapshot is out of date.
#[derive(Debug, PartialEq, Eq)]
struct ScopeChangeMarker {
    scope_key: String,
    generation: i64,
}

fn read_scope_change_marker(
    conn: &rusqlite::Connection,
) -> Result<Option<ScopeChangeMarker>, String> {
    conn.query_row(
        "SELECT s.scope_key, s.generation
         FROM invoke_scope_cache_control control
         JOIN invoke_scope_cache_state s ON s.scope_key = control.active_scope_key
         WHERE control.state_key = 'current'",
        [],
        |row| {
            Ok(ScopeChangeMarker {
                scope_key: row.get(0)?,
                generation: row.get(1)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Brings swapped-in rows up to the live library: the staged rows come from an older
/// snapshot, and an image masked or hidden since must not show as a facet thumbnail.
fn apply_live_privacy_to_facet_cache(conn: &rusqlite::Connection) -> Result<(), String> {
    sanitize_owner_hidden_facet_thumbnails(conn)?;
    crate::db::commands::image_commands::mask_facet_cache_thumbnails(conn)
}

fn stage_incremental_facet_types(
    conn: &mut rusqlite::Connection,
    normalized_types: &[String],
) -> Result<Option<ScopeChangeMarker>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // Read inside the build's snapshot, so the marker matches the rows staged.
    let marker = read_scope_change_marker(&tx)?;

    // A repair of one or two types would pay for the extraction; it reads the view.
    let source = FacetSource::Scoped;
    for db_facet_type in normalized_types {
        let facet_started_at = std::time::Instant::now();

        match db_facet_type.as_str() {
            "checkpoints" => build_checkpoint_facets(&tx, source)?,
            "tools" => build_tool_facets(&tx, source)?,
            "loras" => build_resource_facets(&tx, "loras", "loras", source)?,
            "embeddings" => build_resource_facets(&tx, "embeddings", "embeddings", source)?,
            "hypernetworks" => {
                build_resource_facets(&tx, "hypernetworks", "hypernetworks", source)?
            }
            "control_nets" => build_resource_facets(&tx, "control_nets", "control_nets", source)?,
            "ip_adapters" => build_resource_facets(&tx, "ip_adapters", "ip_adapters", source)?,
            _ => unreachable!("facet types are normalized before rebuild"),
        }

        println!(
            "[FacetCache] Incremental rebuild for {} completed in {:?}.",
            db_facet_type,
            facet_started_at.elapsed()
        );
    }

    sanitize_owner_hidden_facet_thumbnails(&tx)?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(marker)
}

/// Replaces the requested types' live rows with the staged ones in one transaction, so a
/// reader sees either the old cache or all of the rebuilt types, never part of them.
///
/// A change committed while the rows were staged is not in them. The swap still goes ahead,
/// so a busy library cannot keep the cache from ever updating, and the change converges:
/// the trigger that advanced the marker also marked the owner scope cache dirty (or, during
/// an owner-cache build, makes its commit fail and retry), so the owner repair rebuilds it.
/// Each frontend writer also queues its own facet refresh after its write. Only privacy
/// cannot wait for that, so the live mask is applied inside the swap.
fn swap_staged_facet_types(
    conn: &mut rusqlite::Connection,
    normalized_types: &[String],
    staged_marker: &Option<ScopeChangeMarker>,
) -> Result<(), String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let _hold = super::write_hold::WriteHold::begin("facets.swap_staged_types");
    let placeholders = vec!["?"; normalized_types.len()].join(", ");
    tx.execute(
        &format!("DELETE FROM main.facet_cache WHERE facet_type IN ({placeholders})"),
        rusqlite::params_from_iter(normalized_types),
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO main.facet_cache SELECT * FROM temp.facet_cache",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DROP TABLE temp.facet_cache", [])
        .map_err(|e| e.to_string())?;
    // With the staging table gone these reach the live cache, against the live images.
    apply_live_privacy_to_facet_cache(&tx)?;
    mark_owner_cache_dirty_if_changed(&tx, staged_marker)?;
    tx.commit().map_err(|e| e.to_string())
}

fn mark_owner_cache_dirty_if_changed(
    conn: &rusqlite::Connection,
    staged_marker: &Option<ScopeChangeMarker>,
) -> Result<(), String> {
    let live_marker = read_scope_change_marker(conn)?;
    if let (Some(staged), Some(live)) = (staged_marker, &live_marker) {
        if staged != live {
            // Defensive: the coordinator lock keeps an owner commit out of this window, so
            // the trigger's dirty mark is still there. Never leave it 'ready' on old rows.
            conn.execute(
                "UPDATE invoke_scope_cache_state
                 SET status = 'dirty', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                 WHERE scope_key = ?1 AND status = 'ready'",
                [&live.scope_key],
            )
            .map_err(|e| e.to_string())?;
            log::info!(
                "[FacetCache] library changed during the staged rebuild (generation {} -> {}); the owner cache stays dirty for repair",
                staged.generation,
                live.generation
            );
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_facet_cache_incremental_batch(
    app: tauri::AppHandle,
    facet_types: Vec<String>,
    build_id: Option<String>,
) -> Result<usize, String> {
    let epoch = super::background_work::current_epoch();
    tauri::async_runtime::spawn_blocking(move || {
        let job = build_id
            .as_deref()
            .map(super::background_work::register_job);
        let stop = job.as_ref().map(|job| job.flag());
        let _coordinator = lock_facet_builds_unless_stopped("incremental rebuild", stop.as_ref())?;
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        // A reload, exit or stop request ends this rebuild; its open transaction rolls back.
        super::background_work::stop_when_epoch_changes_or_job_stopped(&conn, epoch, stop.clone());

        let normalized_types =
            rebuild_incremental_facet_types_unless_stopped(&mut conn, &facet_types, stop.as_ref())
                .map_err(|error| {
                    super::background_work::clean_up_stopped_connection(&conn, STAGING_TABLES);
                    stopped_error(stop.as_ref(), error)
                })?;

        let mut total_count = 0_i64;
        for db_facet_type in &normalized_types {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM facet_cache WHERE facet_type = ?1",
                    [db_facet_type],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            total_count += count;
        }

        println!(
            "[FacetCache] Incremental rebuild complete in {:?}. Facets: {:?}. Total entries: {}",
            start_total.elapsed(),
            normalized_types,
            total_count
        );

        Ok(total_count as usize)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Valid facet names result - used for drill-down filtering
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ValidFacetNames {
    pub checkpoints: Vec<String>,
    pub loras: Vec<String>,
    pub embeddings: Vec<String>,
    pub hypernetworks: Vec<String>,
    pub tools: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
}

/// Get distinct facet names that exist in the current filtered result set.
/// This is used for drill-down filtering - hiding facets that have no images
/// in the current filter context.
///
/// OPTIMIZATION: Uses a single UNION ALL query instead of 5 separate queries
/// to reduce database round-trips and allow SQLite to share table scans.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_valid_facet_names(
    app: tauri::AppHandle,
    where_clause: String,
    params_json: String,
    collection_id: Option<String>,
    lora_name: Option<String>,
) -> Result<ValidFacetNames, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        let sql_params = parse_facet_params_json(&params_json)?;
        get_valid_facet_names_for_query(
            &conn,
            &where_clause,
            sql_params,
            collection_id.as_deref(),
            lora_name.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_facet_params_json(params_json: &str) -> Result<Vec<Value>, String> {
    let params: Vec<serde_json::Value> = serde_json::from_str(params_json)
        .map_err(|e| format!("Invalid valid-facet params JSON: {}", e))?;

    Ok(params
        .into_iter()
        .map(|p| match p {
            serde_json::Value::String(s) => Value::Text(s),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Value::Integer(i)
                } else if let Some(f) = n.as_f64() {
                    Value::Real(f)
                } else {
                    Value::Null
                }
            }
            serde_json::Value::Bool(b) => Value::Integer(if b { 1 } else { 0 }),
            serde_json::Value::Null => Value::Null,
            other => Value::Text(other.to_string()),
        })
        .collect())
}

fn prefix_valid_facet_where_columns(clause: &str) -> String {
    if clause.is_empty() {
        return String::new();
    }

    let columns = [
        "is_deleted",
        "is_intermediate_gen",
        "is_grid_gen",
        "resolved_model_name",
        "model_hash",
        "model_name",
        "tool",
        "timestamp",
        "is_favorite",
        "is_pinned",
        "metadata_json",
        "privacy_hidden",
        "path",
        "id",
        "width",
        "height",
        "file_size",
        "steps",
        "cfg",
        "sampler",
        "generation_type",
        "positive_prompt",
        "negative_prompt",
        "control_nets",
        "ip_adapters",
    ];

    let pattern_str = format!(r"(?i)(i\.)?\b({})\b", columns.join("|"));
    let re = Regex::new(&pattern_str).unwrap();

    re.replace_all(clause, |caps: &regex::Captures| {
        if caps.get(1).is_some() {
            caps[0].to_string()
        } else {
            format!("i.{}", &caps[2])
        }
    })
    .to_string()
}

fn push_valid_facet_branch_params(
    all_params: &mut Vec<Value>,
    collection_id: Option<&str>,
    lora_name: Option<&str>,
    sql_params: &[Value],
) {
    if let Some(cid) = collection_id {
        all_params.push(Value::Text(cid.to_string()));
    }
    if let Some(lora) = lora_name {
        all_params.push(Value::Text(lora.to_string()));
    }
    all_params.extend(sql_params.iter().cloned());
}

fn resource_clean_ref_sql(column: &str) -> String {
    format!(
        "CASE
            WHEN instr({0}, ' (') > 0 THEN trim(substr({0}, 1, instr({0}, ' (') - 1))
            WHEN instr({0}, ':') > 0 THEN trim(substr({0}, 1, instr({0}, ':') - 1))
            ELSE trim({0})
        END",
        column
    )
}

fn resource_lookup_sql(column: &str) -> String {
    let clean_ref = resource_clean_ref_sql(column);
    format!(
        "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({clean_ref}, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''))"
    )
}

fn resource_facet_cache_join_sql(facet_type: &str, column: &str) -> String {
    let clean_ref = resource_clean_ref_sql(column);
    let lookup = resource_lookup_sql(column);
    format!(
        "JOIN facet_cache fc ON fc.facet_type = '{facet_type}'
            AND fc.resource_name IS NOT NULL
            AND fc.resource_name != ''
            AND (
                LOWER(fc.resource_name) = {lookup}
                OR LOWER(fc.resource_name) = LOWER({clean_ref})
            )"
    )
}

fn get_valid_facet_names_for_query(
    conn: &rusqlite::Connection,
    where_clause: &str,
    sql_params: Vec<Value>,
    collection_id: Option<&str>,
    lora_name: Option<&str>,
) -> Result<ValidFacetNames, String> {
    let requested_where = where_clause.trim();
    let requested_conditions = requested_where
        .strip_prefix("WHERE ")
        .or_else(|| requested_where.strip_prefix("where "))
        .unwrap_or(requested_where);
    let base_where = if requested_conditions.is_empty() {
        "WHERE invoke_scope_hidden = 0 AND is_deleted = 0".to_string()
    } else {
        format!("WHERE invoke_scope_hidden = 0 AND ({requested_conditions})")
    };

    // A collection outside the current owner scope gives no names (#572).
    let collection_join = collection_id
        .map(|_| {
            "JOIN collection_images ci_filter ON ci_filter.image_id = i.id AND ci_filter.collection_id = ?              AND ci_filter.collection_id IN (SELECT id FROM scoped_collections)"
        })
        .unwrap_or("");
    let lora_join = if lora_name.is_some() {
        let clean_lora = resource_clean_ref_sql("il_filter.lora_name");
        format!(
            "JOIN image_loras il_filter ON il_filter.image_id = i.id AND ({clean_lora}) COLLATE NOCASE = ?"
        )
    } else {
        String::new()
    };
    let prefixed = prefix_valid_facet_where_columns(&base_where);
    let checkpoint_cache_join =
        "JOIN facet_cache fc ON fc.facet_type = 'checkpoints'
            AND fc.resource_name IS NOT NULL
            AND fc.resource_name != ''
            AND (
                (i.model_hash IS NOT NULL AND fc.resource_hash = i.model_hash)
                OR LOWER(fc.resource_name) = LOWER(COALESCE(NULLIF(i.resolved_model_name, ''), 'Unknown'))
            )";
    let lora_cache_join = resource_facet_cache_join_sql("loras", "il.lora_name");
    let embedding_cache_join = resource_facet_cache_join_sql("embeddings", "ie.embedding_name");
    let hypernetwork_cache_join =
        resource_facet_cache_join_sql("hypernetworks", "ih.hypernetwork_name");
    let controlnet_cache_join = resource_facet_cache_join_sql("control_nets", "cn.controlnet_name");
    let ipadapter_cache_join = resource_facet_cache_join_sql("ip_adapters", "ip.ipadapter_name");

    let combined_query = format!(
        "SELECT 'checkpoints' as facet_type, fc.resource_name as name FROM scoped_images i {coll} {lora} {checkpoint_cache} {where}
         UNION ALL
         SELECT 'loras', fc.resource_name FROM image_loras il JOIN scoped_images i ON i.id = il.image_id {coll} {lora} {lora_cache} {where}
         UNION ALL
         SELECT 'embeddings', fc.resource_name FROM image_embeddings ie JOIN scoped_images i ON i.id = ie.image_id {coll} {lora} {embedding_cache} {where}
         UNION ALL
         SELECT 'hypernetworks', fc.resource_name FROM image_hypernetworks ih JOIN scoped_images i ON i.id = ih.image_id {coll} {lora} {hypernetwork_cache} {where}
         UNION ALL
         SELECT 'tools', fc.resource_name FROM scoped_images i {coll} {lora} JOIN facet_cache fc ON fc.facet_type = 'tools' AND fc.resource_name = COALESCE(i.tool, 'Unknown') {where}
         UNION ALL
         SELECT 'control_nets', fc.resource_name FROM image_controlnets cn JOIN scoped_images i ON i.id = cn.image_id {coll} {lora} {controlnet_cache} {where}
         UNION ALL
         SELECT 'ip_adapters', fc.resource_name FROM image_ipadapters ip JOIN scoped_images i ON i.id = ip.image_id {coll} {lora} {ipadapter_cache} {where}",
        coll = collection_join,
        lora = lora_join.as_str(),
        checkpoint_cache = checkpoint_cache_join,
        lora_cache = lora_cache_join,
        embedding_cache = embedding_cache_join,
        hypernetwork_cache = hypernetwork_cache_join,
        controlnet_cache = controlnet_cache_join,
        ipadapter_cache = ipadapter_cache_join,
        where = prefixed
    );

    let mut all_params: Vec<Value> = Vec::new();
    for _ in 0..7 {
        push_valid_facet_branch_params(&mut all_params, collection_id, lora_name, &sql_params);
    }

    let mut checkpoints: Vec<String> = Vec::new();
    let mut loras: Vec<String> = Vec::new();
    let mut embeddings: Vec<String> = Vec::new();
    let mut hypernetworks: Vec<String> = Vec::new();
    let mut tools: Vec<String> = Vec::new();
    let mut control_nets: Vec<String> = Vec::new();
    let mut ip_adapters: Vec<String> = Vec::new();

    use std::collections::HashSet;
    let mut cp_set: HashSet<String> = HashSet::new();
    let mut lora_set: HashSet<String> = HashSet::new();
    let mut emb_set: HashSet<String> = HashSet::new();
    let mut hyper_set: HashSet<String> = HashSet::new();
    let mut tool_set: HashSet<String> = HashSet::new();
    let mut cn_set: HashSet<String> = HashSet::new();
    let mut ip_set: HashSet<String> = HashSet::new();

    let mut stmt = conn
        .prepare(&combined_query)
        .map_err(|e| format!("Combined facet query failed: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(&all_params), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| format!("Combined facet query execution failed: {}", e))?;

    for row in rows {
        let (facet_type, name) = row.map_err(|e| format!("Combined facet row failed: {}", e))?;
        let Some(name) = name else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }

        match facet_type.as_str() {
            "checkpoints" => {
                if cp_set.insert(name.clone()) {
                    checkpoints.push(name);
                }
            }
            "loras" => {
                if lora_set.insert(name.clone()) {
                    loras.push(name);
                }
            }
            "embeddings" => {
                if emb_set.insert(name.clone()) {
                    embeddings.push(name);
                }
            }
            "hypernetworks" => {
                if hyper_set.insert(name.clone()) {
                    hypernetworks.push(name);
                }
            }
            "tools" => {
                if tool_set.insert(name.clone()) {
                    tools.push(name);
                }
            }
            "control_nets" => {
                if cn_set.insert(name.clone()) {
                    control_nets.push(name);
                }
            }
            #[allow(
                clippy::collapsible_match,
                reason = "a guard with a side effect would make this arm unlike its siblings"
            )]
            "ip_adapters" => {
                if ip_set.insert(name.clone()) {
                    ip_adapters.push(name);
                }
            }
            _ => {}
        }
    }

    Ok(ValidFacetNames {
        checkpoints,
        loras,
        embeddings,
        hypernetworks,
        tools,
        control_nets,
        ip_adapters,
    })
}

#[cfg(test)]
fn harvest_models(conn: &rusqlite::Connection) -> Result<(), String> {
    with_active_scope_model_invalidation_suppressed(conn, || harvest_models_into(conn, "models"))
}

/// Harvests the library's models without holding the write lock for the scan (#464).
/// The scan of `images` fills a TEMP table under a read snapshot; only the insert of
/// its rows into `models`, almost always none new, runs in a write transaction.
fn harvest_models_staged(conn: &mut rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.harvested_models;
         CREATE TEMP TABLE harvested_models AS
         SELECT hash, name, lookup_source, scanned_at, resource_type FROM main.models WHERE 0;",
    )
    .map_err(|e| e.to_string())?;
    let result = (|| {
        let scan = conn.transaction().map_err(|e| e.to_string())?;
        harvest_models_into(&scan, "temp.harvested_models")?;
        scan.commit().map_err(|e| e.to_string())?;

        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let _hold = super::write_hold::WriteHold::begin("facets.harvest_models");
        with_active_scope_model_invalidation_suppressed(&tx, || {
            // Rowid order keeps the scan's order, so a hash seen twice keeps the same name.
            tx.execute(
                "INSERT OR IGNORE INTO main.models (hash, name, lookup_source, scanned_at, resource_type)
                 SELECT hash, name, lookup_source, scanned_at, resource_type
                 FROM temp.harvested_models ORDER BY rowid",
                [],
            )
            .map(|_| ())
            .map_err(|e| format!("Harvest insert failed: {}", e))
        })?;
        tx.commit().map_err(|e| e.to_string())
    })();
    let dropped = conn
        .execute("DROP TABLE IF EXISTS temp.harvested_models", [])
        .map_err(|e| e.to_string());
    result.and(dropped.map(|_| ()))
}

fn harvest_models_into(conn: &rusqlite::Connection, target: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Harvest Checkpoints
    // OPTIMIZATION: Use the `model_hash` and `resolved_model_name` columns directly
    // instead of parsing metadata_json.
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO {target} (hash, name, lookup_source, scanned_at, resource_type)
            SELECT DISTINCT
            model_hash,
            resolved_model_name,
            'harvest_checkpoint',
            ?1,
            'checkpoint'
            FROM scoped_images
            WHERE invoke_scope_hidden = 0
            AND model_hash IS NOT NULL
            AND resolved_model_name IS NOT NULL"
        ),
        params![now],
    )
    .map_err(|e| format!("Harvest Checkpoints failed: {}", e))?;

    // Helper for generic harvests (LoRAs, Embeddings, Hypernetworks)
    // OPTIMIZATION: Use Junction Tables which are already populated
    let types = [
        ("loras", "harvest_lora", "image_loras", "lora_name"),
        (
            "embeddings",
            "harvest_embedding",
            "image_embeddings",
            "embedding_name",
        ),
        (
            "hypernetworks",
            "harvest_hypernet",
            "image_hypernetworks",
            "hypernetwork_name",
        ),
        (
            "control_nets",
            "harvest_controlnet",
            "image_controlnets",
            "controlnet_name",
        ),
        (
            "ip_adapters",
            "harvest_ip_adapter",
            "image_ipadapters",
            "ipadapter_name",
        ),
    ];

    for (json_key, source, table, col) in types {
        let prefix = match json_key {
            "loras" => "lora_",
            "embeddings" => "emb_",
            "hypernetworks" => "hyper_",
            "control_nets" => "cnet_",
            "ip_adapters" => "ipad_",
            _ => "",
        };

        // Note: 'clean_name' logic (removing version/suffix) is duplicated here.
        // Ideally the junction tables would store cleaned names, or we handle it here.
        // The junction creation in `save_images_batch` ALREADY cleans the name!
        // "CASE WHEN instr(value, ...)..." is used in save_images_batch.
        // So the values in `image_loras` ARE ALREADY CLEANED.
        // We can just select them directly.

        conn.execute(
            &format!(
                "INSERT OR IGNORE INTO {} (hash, name, lookup_source, scanned_at, resource_type)
                SELECT DISTINCT
                '{}' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({}, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''),
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({}, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''),
                '{}',
                ?1,
                '{}'
                FROM {} jt
                INNER JOIN scoped_images i ON i.id = jt.image_id
                WHERE i.invoke_scope_hidden = 0
                AND jt.{} IS NOT NULL AND jt.{} != ''",
                target,
                prefix, col,
                col,
                source,
                json_key,
                table,
                col, col
            ),
            params![now]
        ).map_err(|e| format!("Harvest {} failed: {}", json_key, e))?;
    }

    Ok(())
}

fn build_checkpoint_facets(conn: &rusqlite::Connection, source: FacetSource) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let rows = source.table();
    let metadata_model = source.metadata_model();
    // 1. Calculate Counts and Usage Stats
    // COALESCE(NULLIF(..., ''), 'Unknown') aligns with frontend filter logic
    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS cp_counts AS
            SELECT
                model_hash as mh,
                COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') as mn,
                LOWER(COALESCE(NULLIF(resolved_model_name, ''), 'Unknown')) as lmn,
                COUNT(DISTINCT id) as cnt,
                MAX(timestamp) as last_used,
                MIN(timestamp) as first_used
            FROM {rows}
            WHERE invoke_scope_hidden = 0 AND is_deleted = 0
            AND IFNULL(is_invoke_asset_gen, 0) = 0
            GROUP BY mh, lmn"
        ),
        [],
    )
    .map_err(|e| format!("Failed to create cp_counts temp table: {}", e))?;
    println!(
        "[FacetCache] Checkpoint cp_counts built in {:?}.",
        phase_started.elapsed()
    );

    // 2. Calculate Best Dynamic Thumbnails (Pinned > Recent), including a safe candidate.
    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS cp_thumbs AS
            SELECT lmn, image_id, thumbnail_path, privacy_hidden FROM (
                SELECT
                    LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, {metadata_model}, 'Unknown')) as lmn,
                    id as image_id,
                    thumbnail_path,
                    privacy_hidden,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, {metadata_model}, 'Unknown'))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM {rows} i
                WHERE invoke_scope_hidden = 0 AND is_deleted = 0
                AND IFNULL(is_invoke_asset_gen, 0) = 0
                AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
            ) WHERE lmn IS NOT NULL AND lmn != '' AND rn = 1"
        ),
        []
    ).map_err(|e| format!("Failed to create cp_thumbs temp table: {}", e))?;
    println!(
        "[FacetCache] Checkpoint cp_thumbs built in {:?}.",
        phase_started.elapsed()
    );

    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS cp_safe_thumbs AS
            SELECT lmn, image_id, thumbnail_path FROM (
                SELECT
                    LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, {metadata_model}, 'Unknown')) as lmn,
                    id as image_id,
                    thumbnail_path,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, {metadata_model}, 'Unknown'))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM {rows} i
                WHERE invoke_scope_hidden = 0 AND is_deleted = 0
                AND IFNULL(is_invoke_asset_gen, 0) = 0
                AND privacy_hidden = 0 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
            ) WHERE lmn IS NOT NULL AND lmn != '' AND rn = 1"
        ),
        []
    ).map_err(|e| format!("Failed to create cp_safe_thumbs temp table: {}", e))?;
    println!(
        "[FacetCache] Checkpoint cp_safe_thumbs built in {:?}.",
        phase_started.elapsed()
    );

    // 3. Insert into Cache (Priority: User Override > Sidecar > Dynamic > Preview URL)
    // thumbnail_mode = 'dynamic' forces skip of sidecar
    let phase_started = std::time::Instant::now();
    conn.execute(
        "INSERT INTO facet_cache (
                facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url,
                last_used_at, created_at, is_manual, has_sidecar, is_user_override,
                safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive, thumbnail_sensitivity_override
            )
            SELECT 'checkpoints', m.name,
                CASE
                    WHEN COALESCE(cc.total_cnt, 0) > 0
                    THEN COALESCE(cc.visible_hash, 'orphan_' || m.name)
                    ELSE m.hash
                END,
                COALESCE(cc.total_cnt, 0),
                CASE
                    WHEN m.thumbnail_path IS NOT NULL THEN m.thumbnail_path
                    WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(ct.thumbnail_path, m.preview_url)
                    ELSE COALESCE(m.sidecar_thumbnail_path, ct.thumbnail_path, m.preview_url)
                END,
                m.preview_url,
                cc.max_last_used,
                cc.min_first_used,
                CASE WHEN m.thumbnail_path IS NOT NULL OR (m.sidecar_thumbnail_path IS NOT NULL AND m.thumbnail_mode IS NULL) THEN 1 ELSE 0 END,
                CASE WHEN m.sidecar_thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                CASE WHEN m.thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                st.thumbnail_path,
                CASE
                    WHEN m.thumbnail_path IS NOT NULL THEN COALESCE(
                        (SELECT ui.id FROM scoped_images ui WHERE ui.id = m.thumbnail_path LIMIT 1),
                        (SELECT ui.id FROM scoped_images ui WHERE ui.path = m.thumbnail_path LIMIT 1),
                        (SELECT ui.id FROM scoped_images ui WHERE ui.thumbnail_path = m.thumbnail_path AND ui.thumbnail_path IS NOT NULL AND ui.thumbnail_path != '' LIMIT 1)
                    )
                    ELSE ct.image_id
                END,
                CASE
                    WHEN m.thumbnail_sensitivity_override = 0 THEN 0
                    WHEN m.thumbnail_sensitivity_override = 1 THEN 1
                    WHEN EXISTS (
                        SELECT 1 FROM privacy_mask_keywords k
                        WHERE LOWER(m.name) LIKE '%' || k.keyword || '%'
                    ) THEN 1
                    WHEN m.thumbnail_path IS NOT NULL THEN COALESCE(
                        (SELECT COALESCE(ui.privacy_hidden, 0) FROM scoped_images ui WHERE ui.id = m.thumbnail_path LIMIT 1),
                        (SELECT COALESCE(ui.privacy_hidden, 0) FROM scoped_images ui WHERE ui.path = m.thumbnail_path LIMIT 1),
                        (SELECT COALESCE(ui.privacy_hidden, 0) FROM scoped_images ui WHERE ui.thumbnail_path = m.thumbnail_path AND ui.thumbnail_path IS NOT NULL AND ui.thumbnail_path != '' LIMIT 1),
                        1
                    )
                    WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(ct.privacy_hidden, 0)
                    WHEN m.sidecar_thumbnail_path IS NOT NULL AND m.sidecar_thumbnail_path != '' THEN 1
                    WHEN m.preview_url IS NOT NULL AND m.preview_url != '' THEN 1
                    ELSE COALESCE(ct.privacy_hidden, 0)
                END,
                m.thumbnail_sensitivity_override
            FROM (
                SELECT MIN(name) as name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(sidecar_thumbnail_path) as sidecar_thumbnail_path, MAX(preview_url) as preview_url, MAX(thumbnail_mode) as thumbnail_mode, MAX(thumbnail_sensitivity_override) as thumbnail_sensitivity_override,
                    MAX(CASE
                        WHEN filename IS NOT NULL AND filename != '' THEN 1
                        WHEN lookup_source = 'disk_scan' OR lookup_source LIKE 'local_cache%' THEN 1
                        ELSE 0
                    END) as has_local_inventory
                FROM models
                WHERE resource_type = 'checkpoint'
                GROUP BY LOWER(name)
            ) m
            LEFT JOIN (
                SELECT lmn, MIN(mh) as visible_hash, SUM(cnt) as total_cnt, MAX(last_used) as max_last_used, MIN(first_used) as min_first_used
                FROM cp_counts
                GROUP BY lmn
            ) cc ON cc.lmn = LOWER(m.name)
            LEFT JOIN cp_thumbs ct ON ct.lmn = LOWER(m.name)
            LEFT JOIN cp_safe_thumbs st ON st.lmn = LOWER(m.name)
            WHERE COALESCE(cc.total_cnt, 0) > 0 OR m.has_local_inventory = 1",
        []
    ).map_err(|e| format!("Failed to insert checkpoints into facet_cache: {}", e))?;
    println!(
        "[FacetCache] Checkpoint matched rows inserted in {:?}.",
        phase_started.elapsed()
    );

    // 4. Insert Orphans (Dynamic Thumbnail Only)
    let phase_started = std::time::Instant::now();
    conn.execute(
        "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, last_used_at, created_at, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive)
            SELECT 'checkpoints', cc.mn, COALESCE(cc.mh, 'orphan_' || cc.mn), SUM(cc.cnt), MAX(ct.thumbnail_path), MAX(cc.last_used), MIN(cc.first_used), MAX(st.thumbnail_path), MAX(ct.image_id), MAX(COALESCE(ct.privacy_hidden, 0))
            FROM cp_counts cc
            LEFT JOIN cp_thumbs ct ON ct.lmn = cc.lmn
            LEFT JOIN cp_safe_thumbs st ON st.lmn = cc.lmn
            WHERE NOT EXISTS (
                SELECT 1 FROM facet_cache fc
                WHERE fc.facet_type = 'checkpoints'
                AND (fc.resource_hash = cc.mh OR fc.resource_name = cc.mn OR LOWER(fc.resource_name) = cc.lmn)
            )
            AND cc.mn IS NOT NULL AND cc.mn != ''
            GROUP BY cc.lmn",
        []
    ).map_err(|e| format!("Failed to insert orphan checkpoints: {}", e))?;
    println!(
        "[FacetCache] Checkpoint orphan rows inserted in {:?}.",
        phase_started.elapsed()
    );

    // Keep asset-only checkpoint names available for the scoped reveal overlay,
    // without adding their usage or thumbnails to the default-visible cache.
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count)
            SELECT 'checkpoints', candidates.mn,
                COALESCE(candidates.mh, 'orphan_' || candidates.mn), 0
            FROM (
                SELECT
                    MIN(COALESCE(NULLIF(resolved_model_name, ''), 'Unknown')) AS mn,
                    LOWER(COALESCE(NULLIF(resolved_model_name, ''), 'Unknown')) AS lmn,
                    MIN(NULLIF(model_hash, '')) AS mh
                FROM {rows}
                WHERE invoke_scope_hidden = 0 AND is_deleted = 0
                AND IFNULL(is_invoke_asset_gen, 0) = 1
                GROUP BY lmn
            ) candidates
            WHERE NOT EXISTS (
                SELECT 1 FROM facet_cache fc
                WHERE fc.facet_type = 'checkpoints'
                AND LOWER(fc.resource_name) = candidates.lmn
            )"
        ),
        [],
    )
    .map_err(|e| format!("Failed to insert asset-only checkpoint candidates: {}", e))?;

    conn.execute("DROP TABLE IF EXISTS cp_counts", []).ok();
    conn.execute("DROP TABLE IF EXISTS cp_thumbs", []).ok();
    conn.execute("DROP TABLE IF EXISTS cp_safe_thumbs", []).ok();
    println!(
        "[FacetCache] Checkpoint facet build completed in {:?}.",
        started_at.elapsed()
    );
    Ok(())
}

fn build_resource_facets(
    conn: &rusqlite::Connection,
    facet_type: &str,
    json_key: &str,
    source: FacetSource,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let rows = source.table();
    // Optimization: Use JUNCTION TABLES instead of JSON extraction

    // Determine the junction table and ID column based on the facet type/json_key
    let (junction_table, name_col, image_id_col) = match json_key {
        "loras" => ("image_loras", "lora_name", "image_id"),
        "embeddings" => ("image_embeddings", "embedding_name", "image_id"),
        "hypernetworks" => ("image_hypernetworks", "hypernetwork_name", "image_id"),
        "control_nets" => ("image_controlnets", "controlnet_name", "image_id"),
        "ip_adapters" => ("image_ipadapters", "ipadapter_name", "image_id"),
        _ => {
            return Err(format!(
                "Unsupported resource type for optimization: {}",
                json_key
            ));
        }
    };
    let temp_table = format!("{}_counts", facet_type);
    let temp_thumbs = format!("{}_thumbs", facet_type);
    let temp_safe_thumbs = format!("{}_safe_thumbs", facet_type);

    // Step 1: Pre-aggregate Counts from Junction Table (No JSON Parsing!)
    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {0} AS
                SELECT
                    MAX(jt.{1}) AS ref_name,
                    -- Clean the name (remove version/suffix) effectively
                    CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END AS clean_ref,
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')) AS lclean_ref,
                    COUNT(DISTINCT CASE
                        WHEN IFNULL(i.is_invoke_asset_gen, 0) = 0 THEN i.id
                    END) AS cnt,
                    MAX(CASE
                        WHEN IFNULL(i.is_invoke_asset_gen, 0) = 0 THEN i.timestamp
                    END) as last_used,
                    MIN(CASE
                        WHEN IFNULL(i.is_invoke_asset_gen, 0) = 0 THEN i.timestamp
                    END) as first_used
                FROM {2} jt
                JOIN {4} i ON i.id = jt.{3}
                WHERE i.invoke_scope_hidden = 0 AND i.is_deleted = 0
                GROUP BY lclean_ref",
            temp_table,
            name_col,
            junction_table,
            image_id_col,
            rows
        ),
        [],
    )
    .map_err(|e| format!("Failed to create optimized {} table: {}", temp_table, e))?;
    println!(
        "[FacetCache] {} counts built in {:?}.",
        facet_type,
        phase_started.elapsed()
    );

    // Step 2: Calculate Best Dynamic Thumbnails (Pinned > Recent) for these Resources
    // We need to group by the CLEANED reference name to match models
    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {0} AS
             SELECT lclean_ref, image_id, thumbnail_path, privacy_hidden FROM (
                SELECT
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')) AS lclean_ref,
                    i.id AS image_id,
                    i.thumbnail_path,
                    i.privacy_hidden,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                            WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                            WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                            ELSE jt.{1}
                        END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM {2} jt
                JOIN {4} i ON i.id = jt.{3}
                WHERE i.invoke_scope_hidden = 0 AND i.is_deleted = 0
                AND IFNULL(i.is_invoke_asset_gen, 0) = 0
                AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
             ) WHERE rn = 1",
            temp_thumbs,
            name_col,
            junction_table,
            image_id_col,
            rows
        ),
        []
    ).map_err(|e| format!("Failed to create {} table: {}", temp_thumbs, e))?;
    println!(
        "[FacetCache] {} thumbnails built in {:?}.",
        facet_type,
        phase_started.elapsed()
    );

    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {0} AS
             SELECT lclean_ref, image_id, thumbnail_path FROM (
                SELECT
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')) AS lclean_ref,
                    i.id AS image_id,
                    i.thumbnail_path,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                            WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                            WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                            ELSE jt.{1}
                        END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM {2} jt
                JOIN {4} i ON i.id = jt.{3}
                WHERE i.invoke_scope_hidden = 0 AND i.is_deleted = 0
                AND IFNULL(i.is_invoke_asset_gen, 0) = 0
                AND i.privacy_hidden = 0 AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
             ) WHERE rn = 1",
            temp_safe_thumbs,
            name_col,
            junction_table,
            image_id_col,
            rows
        ),
        []
    ).map_err(|e| format!("Failed to create {} table: {}", temp_safe_thumbs, e))?;
    println!(
        "[FacetCache] {} safe thumbnails built in {:?}.",
        facet_type,
        phase_started.elapsed()
    );

    // Step 3: Insert matched facets (Priority: User Override > Sidecar > Dynamic > Preview URL)
    // thumbnail_mode = 'dynamic' forces skip of sidecar
    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "INSERT INTO facet_cache (
                    facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url,
                    last_used_at, created_at, is_manual, has_sidecar, is_user_override, guidance_subtype,
                    safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive, thumbnail_sensitivity_override
                )
                SELECT '{}', m.name, m.hash,
                    COALESCE(rc.cnt, 0),
                    CASE
                        WHEN m.thumbnail_path IS NOT NULL THEN m.thumbnail_path
                        WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(rt.thumbnail_path, m.preview_url)
                        ELSE COALESCE(m.sidecar_thumbnail_path, rt.thumbnail_path, m.preview_url)
                    END,
                    m.preview_url,
                    rc.last_used,
                    rc.first_used,
                    CASE WHEN m.thumbnail_path IS NOT NULL OR (m.sidecar_thumbnail_path IS NOT NULL AND m.thumbnail_mode IS NULL) THEN 1 ELSE 0 END,
                    CASE WHEN m.sidecar_thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                    CASE WHEN m.thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                    m.guidance_subtype,
                    rst.thumbnail_path,
                    CASE
                        WHEN m.thumbnail_path IS NOT NULL THEN COALESCE(
                            (SELECT ui.id FROM scoped_images ui WHERE ui.id = m.thumbnail_path LIMIT 1),
                            (SELECT ui.id FROM scoped_images ui WHERE ui.path = m.thumbnail_path LIMIT 1),
                            (SELECT ui.id FROM scoped_images ui WHERE ui.thumbnail_path = m.thumbnail_path AND ui.thumbnail_path IS NOT NULL AND ui.thumbnail_path != '' LIMIT 1)
                        )
                        ELSE rt.image_id
                    END,
                    CASE
                        WHEN m.thumbnail_sensitivity_override = 0 THEN 0
                        WHEN m.thumbnail_sensitivity_override = 1 THEN 1
                        WHEN EXISTS (
                            SELECT 1 FROM privacy_mask_keywords k
                            WHERE LOWER(m.name) LIKE '%' || k.keyword || '%'
                        ) THEN 1
                        WHEN m.thumbnail_path IS NOT NULL THEN COALESCE(
                            (SELECT COALESCE(ui.privacy_hidden, 0) FROM scoped_images ui WHERE ui.id = m.thumbnail_path LIMIT 1),
                            (SELECT COALESCE(ui.privacy_hidden, 0) FROM scoped_images ui WHERE ui.path = m.thumbnail_path LIMIT 1),
                            (SELECT COALESCE(ui.privacy_hidden, 0) FROM scoped_images ui WHERE ui.thumbnail_path = m.thumbnail_path AND ui.thumbnail_path IS NOT NULL AND ui.thumbnail_path != '' LIMIT 1),
                            1
                        )
                        WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(rt.privacy_hidden, 0)
                        WHEN m.sidecar_thumbnail_path IS NOT NULL AND m.sidecar_thumbnail_path != '' THEN 1
                        WHEN m.preview_url IS NOT NULL AND m.preview_url != '' THEN 1
                        ELSE COALESCE(rt.privacy_hidden, 0)
                    END,
                    m.thumbnail_sensitivity_override
                FROM (
                    SELECT MIN(name) as name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(sidecar_thumbnail_path) as sidecar_thumbnail_path, MAX(preview_url) as preview_url, MAX(thumbnail_mode) as thumbnail_mode, MAX(guidance_subtype) as guidance_subtype, MAX(thumbnail_sensitivity_override) as thumbnail_sensitivity_override,
                        MAX(CASE
                            WHEN filename IS NOT NULL AND filename != '' THEN 1
                            WHEN lookup_source = 'disk_scan' OR lookup_source LIKE 'local_cache%' THEN 1
                            ELSE 0
                        END) as has_local_inventory
                    FROM models
                    WHERE resource_type = '{}'
                    GROUP BY LOWER(name)
                ) m
                LEFT JOIN {} rc ON rc.lclean_ref = LOWER(m.name)
                LEFT JOIN {} rt ON rt.lclean_ref = LOWER(m.name)
                LEFT JOIN {} rst ON rst.lclean_ref = LOWER(m.name)
                WHERE COALESCE(rc.cnt, 0) > 0
                   OR m.has_local_inventory = 1
                   OR rc.lclean_ref IS NOT NULL
                GROUP BY LOWER(m.name)",
            facet_type, facet_type, temp_table, temp_thumbs, temp_safe_thumbs
        ),
        []
    ).map_err(|e| format!("Failed to insert {} into facet_cache: {}", facet_type, e))?;
    println!(
        "[FacetCache] {} matched rows inserted in {:?}.",
        facet_type,
        phase_started.elapsed()
    );

    // Step 4: Insert orphans
    let phase_started = std::time::Instant::now();
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO facet_cache (
                    facet_type, resource_name, resource_hash, count, thumbnail_path,
                    last_used_at, created_at, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive
                )
                SELECT '{}', rc.clean_ref, 'orphan_' || rc.clean_ref, rc.cnt, rt.thumbnail_path, rc.last_used, rc.first_used, rst.thumbnail_path, rt.image_id, COALESCE(rt.privacy_hidden, 0)
                FROM {} rc
                LEFT JOIN {} rt ON rt.lclean_ref = rc.lclean_ref
                LEFT JOIN {} rst ON rst.lclean_ref = rc.lclean_ref
                WHERE NOT EXISTS (
                    SELECT 1 FROM facet_cache fc
                    WHERE fc.facet_type = '{}'
                    AND (fc.resource_name = rc.clean_ref OR fc.resource_name = rc.ref_name OR LOWER(fc.resource_name) = rc.lclean_ref)
                )
                AND rc.clean_ref IS NOT NULL AND rc.clean_ref != ''
                GROUP BY rc.lclean_ref",
            facet_type, temp_table, temp_thumbs, temp_safe_thumbs, facet_type
        ),
        []
    ).map_err(|e| format!("Failed to insert orphan {} into facet_cache: {}", facet_type, e))?;
    println!(
        "[FacetCache] {} orphan rows inserted in {:?}.",
        facet_type,
        phase_started.elapsed()
    );

    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_table), [])
        .ok();
    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_thumbs), [])
        .ok();
    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_safe_thumbs), [])
        .ok();
    println!(
        "[FacetCache] {} facet build completed in {:?}.",
        facet_type,
        started_at.elapsed()
    );
    Ok(())
}

fn build_tool_facets(conn: &rusqlite::Connection, source: FacetSource) -> Result<(), String> {
    let rows = source.table();
    // Optimization: Use DENORMALIZED tool column
    conn.execute(
        &format!(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, last_used_at, created_at)
            SELECT 'tools',
                all_tools.tool,
                NULL,
                COUNT(visible.id),
                MAX(visible.timestamp),
                MIN(visible.timestamp)
            FROM (
                SELECT DISTINCT COALESCE(tool, 'Unknown') AS tool
                FROM {rows}
                WHERE invoke_scope_hidden = 0 AND is_deleted = 0
            ) all_tools
            LEFT JOIN {rows} visible
              ON COALESCE(visible.tool, 'Unknown') = all_tools.tool
             AND visible.invoke_scope_hidden = 0
             AND visible.is_deleted = 0
             AND IFNULL(visible.is_invoke_asset_gen, 0) = 0
            GROUP BY all_tools.tool"
        ),
        []
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
#[path = "facets_lock_bench.rs"]
mod lock_bench;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::init_db;

    fn create_valid_facet_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO collections (id, name, created_at) VALUES ('col-a', 'Collection A', 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt, tool)
             VALUES
             ('img-a', 'a.png', 100, 'CollectionModel', 'portrait cat', 'Automatic1111'),
             ('img-b', 'b.png', 200, 'OutsideModel', 'landscape dog', 'InvokeAI')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id) VALUES ('col-a', 'img-a')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('img-a', 'CollectionLora'), ('img-b', 'OutsideLora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_embeddings (image_id, embedding_name)
             VALUES ('img-a', 'CollectionEmbedding'), ('img-b', 'OutsideEmbedding')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES
             ('checkpoints', 'CollectionModel', NULL, 1),
             ('checkpoints', 'OutsideModel', NULL, 1),
             ('loras', 'CollectionLora', NULL, 1),
             ('loras', 'OutsideLora', NULL, 1),
             ('embeddings', 'CollectionEmbedding', NULL, 1),
             ('embeddings', 'OutsideEmbedding', NULL, 1),
             ('tools', 'Automatic1111', NULL, 1),
             ('tools', 'InvokeAI', NULL, 1)",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn staged_facet_build_keeps_live_cache_valid_until_atomic_swap() {
        let mut conn = create_valid_facet_conn();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'LiveBeforeBuild', 1)",
            [],
        )
        .unwrap();

        create_facet_staging_table(&conn).unwrap();
        conn.execute(
            "INSERT INTO temp.facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'StagedReplacement', 2)",
            [],
        )
        .unwrap();

        let live_before_swap: String = conn
            .query_row(
                "SELECT resource_name FROM main.facet_cache
                 WHERE facet_type = 'tools' AND resource_name = 'LiveBeforeBuild'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(live_before_swap, "LiveBeforeBuild");

        assert_eq!(swap_staged_facet_cache(&mut conn).unwrap(), 1);
        let live_after_swap: (String, i64) = conn
            .query_row(
                "SELECT resource_name, count FROM facet_cache WHERE facet_type = 'tools'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(live_after_swap, ("StagedReplacement".to_string(), 2));
    }

    fn live_facet_rows(conn: &rusqlite::Connection) -> Vec<(String, String, i64)> {
        let mut statement = conn
            .prepare(
                "SELECT facet_type, resource_name, count FROM main.facet_cache
                 ORDER BY facet_type, resource_name",
            )
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    /// Local images and two InvokeAI owners, with every column the facet builders read:
    /// pinned, privacy-hidden, deleted, hidden and asset rows, a model named only in
    /// `metadata_json`, and a junction row of each resource type for both owners.
    fn create_two_owner_conn(mode: &str, owner: Option<&str>) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for m in init_db() {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute("DELETE FROM invoke_owner_scope_state", [])
            .unwrap();
        conn.execute(
            "INSERT INTO invoke_owner_scope_state
             (state_key, db_path, images_root, scope_mode, owner_id, updated_at, boards_verified)
             VALUES ('current', 'invoke.db', 'C:/Invoke', ?1, ?2, 1, 1)",
            params![mode, owner],
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO images (
                id, path, timestamp, is_pinned, is_deleted, invoke_scope_hidden,
                invoke_image_category, privacy_hidden, thumbnail_path, model_hash,
                resolved_model_name, model_name, tool, metadata_json,
                invoke_source_id, invoke_owner_id
             ) VALUES
             ('local-1','l1.png',100,0,0,0,NULL,0,'t/local-1.webp','h-local','LocalModel',NULL,'Automatic1111','{}',NULL,NULL),
             ('local-2','l2.png',300,1,0,0,NULL,1,'t/local-2.webp','h-local','LocalModel',NULL,'Automatic1111','{}',NULL,NULL),
             ('a-1','a1.png',200,0,0,0,'general',0,'t/a-1.webp','h-shared','SharedModel',NULL,'InvokeAI','{}','invoke.db','owner-a'),
             ('a-2','a2.png',250,0,0,0,'general',0,'t/a-2.webp',NULL,NULL,'SharedModel','InvokeAI','{}','invoke.db','owner-a'),
             ('a-3','a3.png',260,0,0,0,'general',0,'t/a-3.webp',NULL,'',NULL,NULL,'{\"model\":\"LocalModel\"}','invoke.db','owner-a'),
             ('a-asset','aa.png',270,0,0,0,'user',0,'t/a-asset.webp','h-asset','AssetOnlyModel',NULL,'InvokeAI','{}','invoke.db','owner-a'),
             ('a-hidden','ah.png',280,0,0,1,'general',0,'t/a-hidden.webp','h-hidden','HiddenModel',NULL,'HiddenTool','{}','invoke.db','owner-a'),
             ('a-deleted','ad.png',290,0,1,0,'general',0,'t/a-deleted.webp','h-del','DeletedModel',NULL,'DeletedTool','{}','invoke.db','owner-a'),
             ('b-1','b1.png',999,1,0,0,'general',0,'t/b-1.webp','h-b','OwnerBModel',NULL,'BTool','{}','invoke.db','owner-b'),
             ('b-2','b2.png',998,1,0,0,'general',0,'t/b-2.webp','h-shared','SharedModel',NULL,'InvokeAI','{}','invoke.db','owner-b');
             UPDATE images SET user_masked = 1 WHERE id = 'local-2';
             INSERT INTO image_loras (image_id, lora_name) VALUES
                ('local-1','LocalLora'), ('a-1','SharedLora'), ('a-2','SharedLora (v2)'),
                ('a-hidden','HiddenLora'), ('b-1','BLora'), ('b-2','SharedLora');
             INSERT INTO image_embeddings (image_id, embedding_name) VALUES
                ('local-2','EmbLocal'), ('a-1','EmbA'), ('b-1','EmbB');
             INSERT INTO image_hypernetworks (image_id, hypernetwork_name) VALUES
                ('a-1','HyperA'), ('b-1','HyperB');
             INSERT INTO image_controlnets (image_id, controlnet_name) VALUES
                ('a-1','CnetA'), ('b-1','CnetB');
             INSERT INTO image_ipadapters (image_id, ipadapter_name) VALUES
                ('a-1','IpA'), ('b-1','IpB');",
        )
        .unwrap();
        conn
    }

    /// Every column of a schema's `facet_cache`, one line a row, in a fixed order.
    fn facet_dump(conn: &rusqlite::Connection, schema: &str) -> Vec<String> {
        let mut statement = conn
            .prepare(&format!(
                "SELECT quote(facet_type)||'|'||quote(resource_name)||'|'||quote(resource_hash)
                    ||'|'||quote(count)||'|'||quote(thumbnail_path)||'|'||quote(preview_url)
                    ||'|'||quote(last_used_at)||'|'||quote(created_at)||'|'||quote(is_manual)
                    ||'|'||quote(has_sidecar)||'|'||quote(is_user_override)
                    ||'|'||quote(guidance_subtype)||'|'||quote(safe_thumbnail_path)
                    ||'|'||quote(thumbnail_image_id)||'|'||quote(thumbnail_is_sensitive)
                    ||'|'||quote(thumbnail_sensitivity_override)
                 FROM {schema}.facet_cache ORDER BY facet_type, resource_name"
            ))
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn build_every_facet(conn: &rusqlite::Connection, source: FacetSource) {
        build_checkpoint_facets(conn, source).unwrap();
        for facet_type in ["loras", "embeddings", "hypernetworks"] {
            build_resource_facets(conn, facet_type, facet_type, source).unwrap();
        }
        build_tool_facets(conn, source).unwrap();
        for facet_type in ["control_nets", "ip_adapters"] {
            build_resource_facets(conn, facet_type, facet_type, source).unwrap();
        }
    }

    /// The staged facet rows of a build that reads `scoped_images`, as before #565.
    fn staged_dump_from_scoped_images(mode: &str, owner: Option<&str>) -> Vec<String> {
        let mut conn = create_two_owner_conn(mode, owner);
        harvest_models_staged(&mut conn).unwrap();
        create_facet_staging_table(&conn).unwrap();
        build_every_facet(&conn, FacetSource::Scoped);
        facet_dump(&conn, "temp")
    }

    /// The live rows of the full build, after the swap and the privacy mask.
    fn live_dump_from_full_build(mode: &str, owner: Option<&str>) -> Vec<String> {
        let mut conn = create_two_owner_conn(mode, owner);
        build_full_facet_cache(&mut conn, None, |_| {}).unwrap();
        facet_dump(&conn, "main")
    }

    fn temp_table_exists(conn: &rusqlite::Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_temp_master WHERE type = 'table' AND name = ?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    // The one-pass extraction must not change a single facet: counts, covers, safe covers,
    // sensitivity flags and dates, in every scope (#565).
    #[test]
    fn full_build_from_the_extraction_equals_the_build_from_scoped_images() {
        let scopes: [(&str, Option<&str>); 3] = [
            ("owner", Some("owner-a")),
            ("owner", Some("owner-b")),
            ("all", None),
        ];
        for (mode, owner) in scopes {
            let expected = staged_dump_from_scoped_images(mode, owner);
            let actual = live_dump_from_full_build(mode, owner);
            // The build ends with the privacy mask; the fixture has no keyword to mask.
            assert_eq!(actual, expected, "scope {mode}/{owner:?}");
        }
        // The fixture reaches the model names that only the thumbnail partition reads:
        // `model_name` (a-2) and `metadata_json` (a-3), the newest safe cover of LocalModel.
        let owner_a = live_dump_from_full_build("owner", Some("owner-a"));
        let row = |facet_type: &str, name: &str| {
            owner_a
                .iter()
                .find(|line| line.starts_with(&format!("'{facet_type}'|'{name}'|")))
                .unwrap_or_else(|| panic!("{facet_type} {name} is listed: {owner_a:?}"))
                .clone()
        };
        assert!(
            row("checkpoints", "SharedModel").contains("|'t/a-2.webp'|"),
            "the cover comes from the model_name fallback"
        );
        assert!(
            row("checkpoints", "LocalModel").contains("|NULL|'t/a-3.webp'|'local-2'|"),
            "the privacy-hidden cover keeps a safe alternative from the metadata_json fallback"
        );
        row("checkpoints", "AssetOnlyModel");
        row("loras", "SharedLora");
    }

    // A build for owner A must never carry owner B's names, counts or covers.
    #[test]
    fn full_build_for_one_owner_holds_nothing_of_the_other_owner() {
        let rows = live_dump_from_full_build("owner", Some("owner-a")).join("\n");
        for foreign in [
            "OwnerBModel",
            "BLora",
            "EmbB",
            "HyperB",
            "CnetB",
            "IpB",
            "BTool",
            "b-1",
            "b-2",
            "t/b-1.webp",
            "t/b-2.webp",
        ] {
            assert!(!rows.contains(foreign), "{foreign} leaked into {rows}");
        }
        // The shared name counts the owner's image only, with the owner's newest cover.
        let shared = rows
            .lines()
            .find(|line| line.starts_with("'checkpoints'|'SharedModel'"))
            .expect("SharedModel is listed");
        assert!(shared.contains("|1|'t/a-2.webp'"), "{shared}");
    }

    // Only the rows the checkpoint thumbnail statements read have their `metadata_json` parsed
    // (the schema cannot store malformed JSON, so the domain is checked by value): an asset, or
    // a row with no thumbnail, keeps `metadata_model` empty, as the old statements never read
    // it for them. A deleted row is not extracted at all: every builder skips it (#565).
    #[test]
    fn extraction_reads_the_metadata_model_only_for_the_thumbnail_rows() {
        let conn = create_two_owner_conn("owner", Some("owner-a"));
        conn.execute_batch(
            "INSERT INTO images (
                id, path, timestamp, is_deleted, invoke_scope_hidden, invoke_image_category,
                thumbnail_path, resolved_model_name, model_name, metadata_json,
                invoke_source_id, invoke_owner_id
             ) VALUES
             ('m-thumb','m1.png',10,0,0,'general','t/m1.webp',NULL,NULL,'{\"model\":\"FromJson\"}','invoke.db','owner-a'),
             ('m-asset','m2.png',11,0,0,'user','t/m2.webp',NULL,NULL,'{\"model\":\"FromJson\"}','invoke.db','owner-a'),
             ('m-no-thumb','m3.png',12,0,0,'general',NULL,NULL,NULL,'{\"model\":\"FromJson\"}','invoke.db','owner-a'),
             ('m-empty-thumb','m4.png',13,0,0,'general','',NULL,NULL,'{\"model\":\"FromJson\"}','invoke.db','owner-a'),
             ('m-deleted','m6.png',15,1,0,'general','t/m6.webp',NULL,NULL,'{\"model\":\"FromJson\"}','invoke.db','owner-a'),
             ('m-named','m5.png',14,0,0,'general','t/m5.webp',NULL,'Named','{\"model\":\"FromJson\"}','invoke.db','owner-a');",
        )
        .unwrap();
        create_facet_source(&conn).unwrap();
        let mut statement = conn
            .prepare(
                "SELECT id, metadata_model FROM temp.facet_source WHERE id LIKE 'm-%' ORDER BY id",
            )
            .unwrap();
        let rows: Vec<(String, Option<String>)> = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let expected = |model: Option<&str>| model.map(str::to_string);
        assert_eq!(
            rows,
            vec![
                ("m-asset".to_string(), expected(None)),
                ("m-empty-thumb".to_string(), expected(None)),
                ("m-named".to_string(), expected(None)),
                ("m-no-thumb".to_string(), expected(None)),
                ("m-thumb".to_string(), expected(Some("FromJson"))),
            ]
        );
    }

    // The builders read the extraction, not the library: with `scoped_images` emptied after
    // the extraction, the staged rows are the same as before.
    #[test]
    fn builders_read_the_extracted_rows_not_scoped_images() {
        let expected = staged_dump_from_scoped_images("owner", Some("owner-a"));
        assert!(expected.len() > 10, "the fixture builds facets");

        let mut conn = create_two_owner_conn("owner", Some("owner-a"));
        harvest_models_staged(&mut conn).unwrap();
        create_facet_staging_table(&conn).unwrap();
        create_facet_source(&conn).unwrap();
        conn.execute_batch("CREATE TEMP VIEW scoped_images AS SELECT * FROM main.images WHERE 0;")
            .unwrap();
        let visible: i64 = conn
            .query_row("SELECT COUNT(*) FROM scoped_images", [], |row| row.get(0))
            .unwrap();
        assert_eq!(visible, 0, "the library view is shadowed");

        build_every_facet(&conn, FacetSource::Extract);
        assert_eq!(facet_dump(&conn, "temp"), expected);
    }

    // The late columns of a large image row sit behind overflow pages, so every statement
    // that reads them from `scoped_images` costs another walk of the library (#565). Once the
    // extraction exists, the full build must not need them from the library again: with the
    // library's copy of those columns blanked from then on, the facets stay the same.
    #[test]
    fn full_build_does_not_read_the_late_image_columns_again_after_the_extraction() {
        use rusqlite::hooks::{AuthAction, AuthContext, Authorization};

        let expected = live_dump_from_full_build("owner", Some("owner-a"));
        assert!(expected.len() > 10, "the fixture builds facets");

        let mut conn = create_two_owner_conn("owner", Some("owner-a"));
        let extracted = Arc::new(AtomicBool::new(false));
        let extracted_seen = extracted.clone();
        conn.authorizer(Some(move |ctx: AuthContext<'_>| {
            match ctx.action {
                // The extraction's index is created right after its table is filled.
                AuthAction::CreateTempIndex {
                    index_name: "facet_source_id",
                    ..
                } => extracted_seen.store(true, Ordering::SeqCst),
                AuthAction::Read {
                    table_name: "images",
                    column_name:
                        "thumbnail_path" | "model_hash" | "tool" | "model_name" | "resolved_model_name",
                } if extracted_seen.load(Ordering::SeqCst) => return Authorization::Ignore,
                _ => {}
            }
            Authorization::Allow
        }));

        build_full_facet_cache(&mut conn, None, |_| {}).unwrap();
        conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>);

        assert!(
            extracted.load(Ordering::SeqCst),
            "the build extracts its rows"
        );
        assert_eq!(facet_dump(&conn, "main"), expected);
        // The finished build gives its memory back: nothing of the extraction stays on the connection.
        assert!(!temp_table_exists(&conn, "facet_source"));
    }

    // The extraction is a TEMP table of the build's own transaction: a failed build leaves
    // none behind, and neither does a stopped one.
    #[test]
    fn a_failed_build_leaves_no_extraction_behind() {
        let mut conn = create_two_owner_conn("owner", Some("owner-a"));
        // The checkpoint statement fails to prepare, after the extraction exists.
        conn.execute_batch("ALTER TABLE privacy_mask_keywords RENAME TO moved_keywords;")
            .unwrap();
        let before = facet_dump(&conn, "main");

        let error = build_full_facet_cache(&mut conn, None, |_| {}).expect_err("the build fails");
        assert!(error.contains("privacy_mask_keywords"), "{error}");
        assert!(!temp_table_exists(&conn, "facet_source"));
        assert_eq!(facet_dump(&conn, "main"), before);
    }

    #[test]
    fn a_stopped_build_leaves_no_extraction_behind_and_the_live_cache_unchanged() {
        let mut conn = create_two_owner_conn("owner", Some("owner-a"));
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'LiveBeforeStop', 5)",
            [],
        )
        .unwrap();
        let before = facet_dump(&conn, "main");

        let stop = Arc::new(AtomicBool::new(false));
        let stop_in_build = stop.clone();
        let result = build_full_facet_cache(&mut conn, Some(&stop), |payload| {
            // Stop while the checkpoints are built, after the extraction.
            if payload.current == 2 {
                stop_in_build.store(true, Ordering::SeqCst);
            }
        });
        assert_eq!(result, Err(FACET_BUILD_STOPPED.to_string()));
        assert!(!temp_table_exists(&conn, "facet_source"));
        assert_eq!(facet_dump(&conn, "main"), before);
    }

    // A connection stopped in the middle of the extraction cleans up with the staging list.
    #[test]
    fn stop_cleanup_drops_a_leftover_extraction() {
        let conn = create_two_owner_conn("owner", Some("owner-a"));
        create_facet_source(&conn).unwrap();
        assert!(temp_table_exists(&conn, "facet_source"));
        crate::db::background_work::clean_up_stopped_connection(&conn, STAGING_TABLES);
        assert!(!temp_table_exists(&conn, "facet_source"));
    }

    // A switch stops the previous scope's build (#533). The stopped build must leave the
    // live cache as it was, and its connection fit for the next build.
    #[test]
    fn stopped_full_build_keeps_the_live_cache_and_leaves_its_connection_usable() {
        let mut expected_conn = create_valid_facet_conn();
        build_full_facet_cache(&mut expected_conn, None, |_| {}).unwrap();
        let expected = live_facet_rows(&expected_conn);

        let mut conn = create_valid_facet_conn();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'StaleBeforeStop', 9)",
            [],
        )
        .unwrap();
        let before = live_facet_rows(&conn);
        assert_ne!(before, expected, "the seed differs from a fresh build");

        let stop = Arc::new(AtomicBool::new(false));
        crate::db::background_work::stop_when_epoch_changes_or_job_stopped(
            &conn,
            crate::db::background_work::current_epoch(),
            Some(stop.clone()),
        );
        // Stop partway, while the LoRAs are being staged.
        let stop_in_build = stop.clone();
        let result = build_full_facet_cache(&mut conn, Some(&stop), |payload| {
            if payload.current == 3 {
                stop_in_build.store(true, Ordering::SeqCst);
            }
        });
        assert!(result.is_err(), "a stopped build fails");
        crate::db::background_work::clean_up_stopped_connection(&conn, STAGING_TABLES);
        assert_eq!(live_facet_rows(&conn), before, "nothing was swapped in");

        assert_eq!(
            build_full_facet_cache(&mut conn, None, |_| {}).unwrap(),
            expected.len()
        );
        assert_eq!(live_facet_rows(&conn), expected);
    }

    #[test]
    fn stopped_incremental_build_keeps_the_live_cache() {
        let mut conn = create_valid_facet_conn();
        let before = live_facet_rows(&conn);
        let stop = Arc::new(AtomicBool::new(true));
        let error = rebuild_incremental_facet_types_unless_stopped(
            &mut conn,
            &["loras".to_string()],
            Some(&stop),
        )
        .expect_err("a stopped build fails");
        assert_eq!(error, FACET_BUILD_STOPPED);
        assert_eq!(live_facet_rows(&conn), before);
    }

    // Waits until an observed waiter started after `before` was read is queued on the lock.
    fn wait_for_a_blocked_facet_waiter(before: usize) {
        let deadline = Instant::now() + std::time::Duration::from_secs(5);
        while BLOCKED_FACET_WAITERS.load(std::sync::atomic::Ordering::SeqCst) == before {
            assert!(
                Instant::now() < deadline,
                "the waiter never queued on the lock"
            );
            std::thread::yield_now();
        }
    }

    // Spawns a waiter on the facet build lock and returns once it is queued behind the holder.
    fn spawn_queued_facet_waiter(
        label: &'static str,
    ) -> std::thread::JoinHandle<Result<FacetLockWait, String>> {
        let before = BLOCKED_FACET_WAITERS.load(std::sync::atomic::Ordering::SeqCst);
        let waiter = std::thread::spawn(move || {
            let (guard, wait) = lock_facet_builds_observed(label);
            guard.map(|_| wait)
        });
        wait_for_a_blocked_facet_waiter(before);
        waiter
    }

    // A waiter names the caller holding the facet build lock and how long it had held it, so a
    // slow owner switch shows which build it queued behind, not only that it waited (#578).
    #[test]
    fn a_waiter_names_the_facet_build_lock_holder() {
        let _serial = serialize_facet_lock_test();
        let (held_sender, held_receiver) = std::sync::mpsc::channel::<()>();
        let (release_sender, release_receiver) = std::sync::mpsc::channel::<()>();
        let holder = std::thread::spawn(move || {
            let _guard = lock_facet_builds("test incremental holder").unwrap();
            held_sender.send(()).unwrap();
            let _ = release_receiver.recv_timeout(std::time::Duration::from_secs(5));
        });
        held_receiver.recv().unwrap();
        let waiter = spawn_queued_facet_waiter("test waiter");
        std::thread::sleep(std::time::Duration::from_millis(50));
        release_sender.send(()).unwrap();
        holder.join().unwrap();
        let wait = waiter.join().unwrap().unwrap();

        assert_eq!(wait.holder, Some("test incremental holder"));
        assert!(wait.waited_ms >= 50, "waited {} ms", wait.waited_ms);
        assert!(wait.holder_age_ms.is_some());
    }

    // The lock is not FIFO, so a long wait can span holders: the wait names the caller that
    // released the lock to it, not only the one it first saw (#578).
    #[test]
    fn a_waiter_names_the_holder_that_released_the_lock() {
        let _serial = serialize_facet_lock_test();
        let (held_sender, held_receiver) = std::sync::mpsc::channel::<()>();
        let (release_sender, release_receiver) = std::sync::mpsc::channel::<()>();
        let first = std::thread::spawn(move || {
            let _guard = lock_facet_builds("test first holder").unwrap();
            held_sender.send(()).unwrap();
            let _ = release_receiver.recv_timeout(std::time::Duration::from_secs(5));
        });
        held_receiver.recv().unwrap();
        let waiter = spawn_queued_facet_waiter("test released waiter");
        // A second holder took the lock in turn while the waiter was queued.
        record_facet_build_holder("test second holder");
        std::thread::sleep(std::time::Duration::from_millis(50));
        release_sender.send(()).unwrap();
        first.join().unwrap();
        let wait = waiter.join().unwrap().unwrap();

        assert_eq!(wait.holder, Some("test first holder"));
        assert_eq!(wait.released_by, Some("test second holder"));
        assert!(wait.released_by_held_ms.is_some_and(|held| held >= 50));
    }

    // A build that can be stopped records itself as the holder too, so a switch queued behind
    // it can name it.
    #[test]
    fn a_stoppable_build_records_itself_as_the_holder() {
        let _serial = serialize_facet_lock_test();
        let (held_sender, held_receiver) = std::sync::mpsc::channel::<()>();
        let (release_sender, release_receiver) = std::sync::mpsc::channel::<()>();
        let holder = std::thread::spawn(move || {
            let stop = Arc::new(AtomicBool::new(false));
            let _guard =
                lock_facet_builds_unless_stopped("test stoppable holder", Some(&stop)).unwrap();
            held_sender.send(()).unwrap();
            let _ = release_receiver.recv_timeout(std::time::Duration::from_secs(5));
        });
        held_receiver.recv().unwrap();
        let waiter = spawn_queued_facet_waiter("test stoppable waiter");
        release_sender.send(()).unwrap();
        holder.join().unwrap();
        let wait = waiter.join().unwrap().unwrap();

        assert_eq!(wait.holder, Some("test stoppable holder"));
    }

    // An owner switch stops the post-reparse facet refresh (#578): the switch gets the lock at
    // once, and the stopped refresh leaves the owner caches as the reparse marked them, dirty,
    // so the next launch's owner-cache repair still rebuilds the counts.
    #[test]
    fn a_stopped_metadata_facet_refresh_hands_the_lock_to_a_switch_and_leaves_its_repair_owed() {
        let _serial = serialize_facet_lock_test();
        let conn = create_valid_facet_conn();
        conn.execute(
            "INSERT INTO invoke_scope_cache_state (
                scope_key, db_path, images_root, scope_mode, owner_id,
                status, generation, built_generation, updated_at
             ) VALUES ('all-users', 'C:/Invoke/invokeai.db', 'C:/Invoke', 'all', NULL, 'ready', 4, 4, 1)",
            [],
        )
        .unwrap();
        // A reparse write: the image triggers mark the owner caches dirty.
        conn.execute(
            "UPDATE images SET metadata_json = '{\"changed\":true}' WHERE id = 'img-a'",
            [],
        )
        .unwrap();
        let owner_cache = |conn: &rusqlite::Connection| -> (String, i64) {
            conn.query_row(
                "SELECT status, generation FROM invoke_scope_cache_state WHERE scope_key = 'all-users'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
        };
        let reparsed = owner_cache(&conn);
        assert_eq!(reparsed.0, "dirty");
        let before = live_facet_rows(&conn);

        let stop = Arc::new(AtomicBool::new(false));
        let (held_sender, held_receiver) = std::sync::mpsc::channel::<()>();
        let (go_sender, go_receiver) = std::sync::mpsc::channel::<()>();
        let build_stop = stop.clone();
        let refresh = std::thread::spawn(move || {
            let mut conn = conn;
            let guard = lock_facet_builds_unless_stopped("incremental rebuild", Some(&build_stop));
            held_sender.send(()).unwrap();
            let _ = go_receiver.recv_timeout(std::time::Duration::from_secs(5));
            let result = rebuild_incremental_facet_types_unless_stopped(
                &mut conn,
                &[
                    "checkpoints".to_string(),
                    "loras".to_string(),
                    "tools".to_string(),
                ],
                Some(&build_stop),
            );
            drop(guard);
            (conn, result)
        });
        held_receiver.recv().unwrap();
        let switch = spawn_queued_facet_waiter("owner visibility");

        let stopped_at = Instant::now();
        stop.store(true, Ordering::SeqCst);
        go_sender.send(()).unwrap();
        let wait = switch.join().unwrap().unwrap();
        let handed_over_ms = stopped_at.elapsed().as_millis();
        let (conn, result) = refresh.join().unwrap();

        assert_eq!(result, Err(FACET_BUILD_STOPPED.to_string()));
        assert!(
            handed_over_ms < 2_000,
            "the switch waited {handed_over_ms} ms after the stop"
        );
        assert_eq!(wait.released_by, Some("incremental rebuild"));
        assert_eq!(live_facet_rows(&conn), before, "nothing was swapped in");
        assert_eq!(
            owner_cache(&conn),
            reparsed,
            "the owner cache still needs its repair"
        );
    }

    // A stopped build still queued behind another lock holder returns without the lock.
    #[test]
    fn a_stopped_build_gives_up_waiting_for_the_facet_build_lock() {
        let _serial = serialize_facet_lock_test();
        let (held, release) = (
            std::sync::mpsc::channel::<()>(),
            std::sync::mpsc::channel::<()>(),
        );
        let (held_sender, held_receiver) = held;
        let (release_sender, release_receiver) = release;
        let holder = std::thread::spawn(move || {
            let _guard = lock_facet_builds("test holder").unwrap();
            held_sender.send(()).unwrap();
            let _ = release_receiver.recv_timeout(std::time::Duration::from_secs(5));
        });
        held_receiver.recv().unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let waiter_stop = stop.clone();
        let waiter = std::thread::spawn(move || {
            let started = Instant::now();
            let result = lock_facet_builds_unless_stopped("test", Some(&waiter_stop)).map(|_| ());
            (result, started.elapsed())
        });
        std::thread::sleep(std::time::Duration::from_millis(100));
        stop.store(true, Ordering::SeqCst);
        let (result, elapsed) = waiter.join().unwrap();
        release_sender.send(()).unwrap();
        holder.join().unwrap();

        assert_eq!(result, Err(FACET_BUILD_STOPPED.to_string()));
        assert!(
            elapsed < std::time::Duration::from_secs(1),
            "gave up after {elapsed:?}"
        );
    }

    #[test]
    fn interrupted_facet_swap_leaves_previous_cache_whole() {
        // Startup shows the previous facet cache while a full rebuild runs in the background
        // (#430), so a rebuild that stops partway must never leave a partial cache behind.
        let mut conn = create_valid_facet_conn();
        let previous: Vec<(String, String, i64)> = {
            let mut statement = conn
                .prepare(
                    "SELECT facet_type, resource_name, count FROM main.facet_cache
                     ORDER BY facet_type, resource_name",
                )
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };

        create_facet_staging_table(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO temp.facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'StagedFirst', 3), ('tools', 'StagedPoison', 4);
             CREATE TEMP TRIGGER stop_facet_swap BEFORE INSERT ON main.facet_cache
             WHEN NEW.resource_name = 'StagedPoison'
             BEGIN SELECT RAISE(ABORT, 'interrupted'); END;",
        )
        .unwrap();

        assert!(swap_staged_facet_cache(&mut conn).is_err());
        let after: Vec<(String, String, i64)> = {
            let mut statement = conn
                .prepare(
                    "SELECT facet_type, resource_name, count FROM main.facet_cache
                     ORDER BY facet_type, resource_name",
                )
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(after, previous);
    }

    #[test]
    fn test_valid_facet_names_respect_manual_collection_join() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0",
            vec![],
            Some("col-a"),
            None,
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["CollectionModel"]);
        assert_eq!(result.loras, vec!["CollectionLora"]);
        assert_eq!(result.embeddings, vec!["CollectionEmbedding"]);
        assert!(!result.loras.contains(&"OutsideLora".to_string()));
    }

    #[test]
    fn test_valid_facet_names_give_nothing_for_a_collection_outside_the_scope() {
        // A board an owner switch left selected must not list another owner's resources (#572).
        let conn = create_valid_facet_conn();
        conn.execute(
            "UPDATE collections SET invoke_suppressed = 1 WHERE id = 'col-a'",
            [],
        )
        .unwrap();

        for lora in [None, Some("CollectionLora")] {
            let result = get_valid_facet_names_for_query(
                &conn,
                "WHERE is_deleted = 0",
                vec![],
                Some("col-a"),
                lora,
            )
            .unwrap();

            assert!(result.checkpoints.is_empty());
            assert!(result.loras.is_empty());
            assert!(result.embeddings.is_empty());
            assert!(result.tools.is_empty());
        }
    }

    #[test]
    fn test_valid_facet_names_respect_plain_search_terms() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%portrait%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["CollectionModel"]);
        assert_eq!(result.loras, vec!["CollectionLora"]);
        assert!(!result.loras.contains(&"OutsideLora".to_string()));
    }

    #[test]
    fn test_valid_facet_names_respect_single_lora_optimized_join() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0",
            vec![],
            None,
            Some("CollectionLora"),
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["CollectionModel"]);
        assert_eq!(result.embeddings, vec!["CollectionEmbedding"]);
        assert!(!result.embeddings.contains(&"OutsideEmbedding".to_string()));
    }

    #[test]
    fn test_valid_facet_names_surface_query_errors() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE missing_column = ?",
            vec![Value::Integer(1)],
            None,
            None,
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_valid_facet_names_return_cache_normalized_lora_names() {
        let conn = create_valid_facet_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt)
             VALUES ('img-raw-lora', 'raw-lora.png', 300, 'CollectionModel', 'raw lora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('img-raw-lora', 'MyLora.safetensors')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES ('loras', 'MyLora', 'lora_MyLora', 1)",
            [],
        )
        .unwrap();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%raw lora%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.loras, vec!["MyLora"]);
    }

    #[test]
    fn test_valid_facet_names_return_cache_casing_for_resources() {
        let conn = create_valid_facet_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt)
             VALUES ('img-case-lora', 'case-lora.png', 300, 'CollectionModel', 'case lora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('img-case-lora', 'caselora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES ('loras', 'CaseLora', 'lora_CaseLora', 1)",
            [],
        )
        .unwrap();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%case lora%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.loras, vec!["CaseLora"]);
    }

    #[test]
    fn test_valid_facet_names_lora_filter_matches_weighted_resource_reference() {
        let conn = create_valid_facet_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt)
             VALUES ('img-weighted-lora', 'weighted-lora.png', 300, 'CollectionModel', 'weighted lora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('img-weighted-lora', 'detail___add_detail (0.20)')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES ('loras', 'detail___add_detail', 'lora_detail___add_detail', 1)",
            [],
        )
        .unwrap();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%weighted lora%".to_string())],
            None,
            Some("detail___add_detail"),
        )
        .unwrap();

        assert_eq!(result.loras, vec!["detail___add_detail"]);
    }

    #[test]
    fn test_valid_facet_names_return_unknown_checkpoint_for_missing_names() {
        let conn = create_valid_facet_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt)
             VALUES ('img-unknown-model', 'unknown-model.png', 300, NULL, 'unknown model')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES ('checkpoints', 'Unknown', 'orphan_Unknown', 1)",
            [],
        )
        .unwrap();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%unknown model%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["Unknown"]);
    }

    #[test]
    fn test_rebuild_facet_cache() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        println!("DEBUG: DB Opened");

        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }
        println!("DEBUG: Migrations applied");

        let metadata = r#"{
            "model": "SDXL Base",
            "modelHash": "12345",
            "loras": ["DetailedEyes:1.0", "PixelArt"],
            "embeddings": ["EasyNegative"],
            "tool": "Automatic1111"
        }"#;

        // Image 1: Old, Unpinned
        conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, is_pinned, thumbnail_path, resolved_model_name, model_hash) VALUES (?1, ?2, ?3, 100, 0, 'thumb1.png', 'SDXL Base', '12345')",
            params!["img1", "test.png", metadata],
        ).unwrap();
        println!("DEBUG: Image 1 inserted");

        let metadata2 = r#"{
            "model": "SDXL Base",
            "modelHash": "12345",
            "loras": ["DetailedEyes:1.0"],
            "embeddings": ["EasyNegative:v2"],
            "hypernetworks": ["MyHyper:1.0"],
            "tool": "Automatic1111"
        }"#;

        // Image 2: New, Pinned, DIFFERENT HASH but same name
        conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, is_pinned, thumbnail_path, resolved_model_name, model_hash) VALUES (?1, ?2, ?3, 200, 1, 'thumb2.png', 'SDXL Base', '67890')",
            params!["img2", "test2.png", metadata2],
        ).unwrap();

        // Image 3: Different CASE to trigger multiplier
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash, thumbnail_path) VALUES ('img3', 'test3.png', 300, 'sdxl base', 'hash3', 'thumb3.png')",
            [],
        ).unwrap();

        // Image 4: NULL model name (should become Unknown)
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash) VALUES ('img4', 'test4.png', 400, NULL, 'hash4')",
            [],
        ).unwrap();

        // Image 5: Empty model name (should become Unknown)
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash) VALUES ('img5', 'test5.png', 500, '', 'hash5')",
            [],
        ).unwrap();

        // Image 6: Literal 'Unknown'
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash) VALUES ('img6', 'test6.png', 600, 'Unknown', 'hash6')",
            [],
        ).unwrap();

        // Populate Junction Tables (Simulating Scanner behavior)
        conn.execute("INSERT INTO image_loras (image_id, lora_name) VALUES ('img1', 'DetailedEyes'), ('img1', 'PixelArt')", []).unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img2', 'DetailedEyes')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO image_embeddings (image_id, embedding_name) VALUES ('img1', 'EasyNegative')", []).unwrap();
        conn.execute("INSERT INTO image_embeddings (image_id, embedding_name) VALUES ('img2', 'EasyNegative')", []).unwrap();
        conn.execute("INSERT INTO image_hypernetworks (image_id, hypernetwork_name) VALUES ('img2', 'MyHyper')", []).unwrap();

        harvest_models(&conn).unwrap();

        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0))
            .unwrap();
        assert!(model_count > 0, "Models should be populated from harvest");

        build_checkpoint_facets(&conn, FacetSource::Scoped).unwrap();
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();
        build_resource_facets(&conn, "embeddings", "embeddings", FacetSource::Scoped).unwrap();
        build_resource_facets(&conn, "hypernetworks", "hypernetworks", FacetSource::Scoped)
            .unwrap();
        build_tool_facets(&conn, FacetSource::Scoped).unwrap();

        // --- Regression Check: Collections ---
        // Verify that rebuilding cache does NOT wipe collections
        // 1. Create a collection
        conn.execute(
            "INSERT INTO collections (id, name, created_at) VALUES ('col1', 'Test Col', 100)",
            [],
        )
        .unwrap();
        // 2. Add image to collection
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id) VALUES ('col1', 'img1')",
            [],
        )
        .unwrap();

        // Re-run rebuild to ensure it doesn't touch collections
        // (We already ran parts of it above, this simulates a full run)
        // But wait, the test calls `build_checkpoint_facets` etc individually.
        // Let's verify collections exist now.
        let col_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            col_count, 1,
            "Collection should persist after manual insertions"
        );

        // Now run the full rebuild helper if possible?
        // No, `rebuild_facet_cache` takes AppHandle. We can't call it here easily.
        // But we can call the internal functions again.
        conn.execute("DELETE FROM facet_cache", []).unwrap(); // Clear cache first
        build_checkpoint_facets(&conn, FacetSource::Scoped).unwrap();
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();

        let col_count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            col_count_after, 1,
            "Collection should persist after facet rebuild"
        );

        // Checkpoint Check: Expected thumb2.png (Pinned)
        let (cp_count, cp_thumb): (i64, String) = conn.query_row(
            "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type='checkpoints' AND resource_name='SDXL Base'",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(
            cp_count, 3,
            "Multiplier bug! Should count exactly 3 images for SDXL Base (not doubled/tripled)"
        );
        assert_eq!(
            cp_thumb, "thumb2.png",
            "Checkpoint thumbnail should be from pinned image (thumb2)"
        );

        // LoRA Check: Expected thumb2.png (Pinned)
        let (lora_count, lora_thumb): (i64, String) = conn.query_row(
            "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type='loras' AND resource_name='DetailedEyes'",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(lora_count, 2, "Should count 2 images for DetailedEyes lora");
        assert_eq!(
            lora_thumb, "thumb2.png",
            "LoRA thumbnail should be from pinned image (thumb2)"
        );

        // Manual Override Check
        // Set manual thumbnail for SDXL Base
        conn.execute(
            "UPDATE models SET thumbnail_path = 'manual_override.png' WHERE hash = '12345'",
            [],
        )
        .unwrap();

        // Rebuild Only Checkpoints - MUST CLEAR CACHE FIRST or handle upsert
        conn.execute("DELETE FROM facet_cache WHERE facet_type='checkpoints'", [])
            .unwrap();
        build_checkpoint_facets(&conn, FacetSource::Scoped).unwrap();

        let cp_thumb_manual: String = conn.query_row(
            "SELECT thumbnail_path FROM facet_cache WHERE facet_type='checkpoints' AND resource_name='SDXL Base'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(
            cp_thumb_manual, "manual_override.png",
            "Manual thumbnail should take precedence"
        );

        // Verification for 'Unknown' facet (img4, img5, img6)
        let unknown_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='checkpoints' AND resource_name='Unknown'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(
            unknown_count, 3,
            "Unknown facet should count NULL, Empty, and 'Unknown' (3 total)"
        );
    }

    #[test]
    fn default_facet_cache_excludes_invoke_assets() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (
                id, path, timestamp, tool, thumbnail_path, invoke_image_category,
                resolved_model_name, model_hash
             )
             VALUES
                ('visible', 'visible.png', 100, 'ComfyUI', 'visible.webp', 'general', 'SharedCheckpoint', 'shared-hash'),
                ('asset-shared', 'asset-shared.png', 200, 'AssetOnlyTool', 'asset-shared.webp', 'control', 'SharedCheckpoint', 'shared-hash'),
                ('asset-only', 'asset-only.png', 300, 'AssetOnlyTool', 'asset-only.webp', 'mask', 'AssetOnlyCheckpoint', 'asset-hash'),
                ('asset-null-hash', 'asset-null-hash.png', 400, 'AssetOnlyTool', 'asset-null-hash.webp', 'control', 'HashlessCheckpoint', NULL),
                ('asset-unknown', 'asset-unknown.png', 500, 'AssetOnlyTool', 'asset-unknown.webp', 'mask', NULL, NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES
                ('visible', 'SharedLora'),
                ('asset-shared', 'SharedLora'),
                ('asset-only', 'AssetOnlyLora')",
            [],
        )
        .unwrap();

        let touches = FacetResourceTouches {
            checkpoints: vec!["AssetOnlyCheckpoint".to_string()],
            loras: vec!["AssetOnlyLora".to_string()],
            tools: vec!["AssetOnlyTool".to_string()],
            ..FacetResourceTouches::default()
        };
        refresh_live_facet_resources(&mut conn, &touches).unwrap();
        let incremental_zero_counts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM facet_cache
                 WHERE count = 0 AND (
                    (facet_type = 'checkpoints' AND resource_name = 'AssetOnlyCheckpoint') OR
                    (facet_type = 'loras' AND resource_name = 'AssetOnlyLora') OR
                    (facet_type = 'tools' AND resource_name = 'AssetOnlyTool')
                 )",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(incremental_zero_counts, 3);

        conn.execute("DELETE FROM facet_cache", []).unwrap();
        harvest_models(&conn).unwrap();
        build_checkpoint_facets(&conn, FacetSource::Scoped).unwrap();
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();
        build_tool_facets(&conn, FacetSource::Scoped).unwrap();

        let (shared_count, shared_thumbnail): (i64, String) = conn
            .query_row(
                "SELECT count, thumbnail_path FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'SharedLora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let (asset_count, asset_thumbnail): (i64, Option<String>) = conn
            .query_row(
                "SELECT count, thumbnail_path FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'AssetOnlyLora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let asset_tool_count: i64 = conn
            .query_row(
                "SELECT count FROM facet_cache
                 WHERE facet_type = 'tools' AND resource_name = 'AssetOnlyTool'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        for checkpoint in ["AssetOnlyCheckpoint", "HashlessCheckpoint", "Unknown"] {
            let (count, thumbnail): (i64, Option<String>) = conn
                .query_row(
                    "SELECT count, thumbnail_path FROM facet_cache
                     WHERE facet_type = 'checkpoints' AND resource_name = ?1",
                    [checkpoint],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(
                count, 0,
                "asset checkpoint candidates must not affect hidden counts"
            );
            assert_eq!(
                thumbnail, None,
                "asset checkpoint candidates must not provide hidden thumbnails"
            );
        }

        let hidden = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND IFNULL(is_invoke_asset_gen, 0) = 0",
            vec![],
            None,
            None,
        )
        .unwrap();
        let revealed =
            get_valid_facet_names_for_query(&conn, "WHERE is_deleted = 0", vec![], None, None)
                .unwrap();

        assert_eq!(shared_count, 1);
        assert_eq!(shared_thumbnail, "visible.webp");
        assert_eq!(asset_count, 0);
        assert_eq!(asset_thumbnail, None);
        assert_eq!(asset_tool_count, 0);
        assert!(!hidden
            .checkpoints
            .contains(&"HashlessCheckpoint".to_string()));
        assert!(!hidden.checkpoints.contains(&"Unknown".to_string()));
        assert!(revealed
            .checkpoints
            .contains(&"HashlessCheckpoint".to_string()));
        assert!(revealed.checkpoints.contains(&"Unknown".to_string()));
    }

    #[test]
    fn checkpoint_resource_refresh_matches_full_rebuild_when_only_asset_has_hash() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (
                id, path, timestamp, thumbnail_path, invoke_image_category,
                resolved_model_name, model_hash
             )
             VALUES
                ('visible', 'visible.png', 100, 'visible.webp', 'general', 'SharedCheckpoint', NULL),
                ('asset', 'asset.png', 200, 'asset.webp', 'control', 'SharedCheckpoint', 'asset-hash')",
            [],
        )
        .unwrap();

        let touches = FacetResourceTouches {
            checkpoints: vec!["SharedCheckpoint".to_string()],
            ..FacetResourceTouches::default()
        };
        refresh_live_facet_resources(&mut conn, &touches).unwrap();
        let incremental: (Option<String>, i64, Option<String>) = conn
            .query_row(
                "SELECT resource_hash, count, thumbnail_path
                 FROM facet_cache
                 WHERE facet_type = 'checkpoints' AND resource_name = 'SharedCheckpoint'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        conn.execute("DELETE FROM facet_cache", []).unwrap();
        harvest_models(&conn).unwrap();
        build_checkpoint_facets(&conn, FacetSource::Scoped).unwrap();
        let full: (Option<String>, i64, Option<String>) = conn
            .query_row(
                "SELECT resource_hash, count, thumbnail_path
                 FROM facet_cache
                 WHERE facet_type = 'checkpoints' AND resource_name = 'SharedCheckpoint'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();

        assert_eq!(
            incremental, full,
            "a newer hidden asset must not supply identity or thumbnail data for a visible checkpoint"
        );
        assert_eq!(
            full,
            (
                Some("orphan_SharedCheckpoint".to_string()),
                1,
                Some("visible.webp".to_string())
            )
        );
    }

    #[test]
    fn test_facet_extension_mismatch() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }

        // 1. Simulate a disk scan for a LoRA (clean name)
        conn.execute(
            "INSERT INTO models (hash, name, filename, lookup_source, resource_type, sidecar_thumbnail_path)
             VALUES ('lora_MyLora', 'MyLora', 'MyLora.safetensors', 'disk_scan', 'loras', 'C:/thumbs/MyLora.webp')",
            [],
        ).unwrap();

        // 2. Simulate an image ingestion with a LoRA path (including extension)
        conn.execute(
            "INSERT INTO images (id, path, timestamp) VALUES ('img1', 'test.png', 100)",
            [],
        )
        .unwrap();

        // This is what happens currently: LoRA name stored WITH extension in junction table
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img1', 'MyLora.safetensors')",
            [],
        )
        .unwrap();

        // 3. Build LoRA facets
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();

        // 4. Check if the facet has the thumbnail
        let (name, thumb): (String, Option<String>) = conn
            .query_row(
                "SELECT resource_name, thumbnail_path FROM facet_cache WHERE facet_type='loras'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();

        assert_eq!(
            name, "MyLora",
            "Facet name should be 'MyLora' (normalized from the model name)"
        );
        assert!(
            thumb.is_some(),
            "Facet should have a thumbnail path linked from the model"
        );
        assert_eq!(thumb.unwrap(), "C:/thumbs/MyLora.webp");
    }

    #[test]
    fn resource_facets_track_safe_thumbnail_and_backing_image() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, thumbnail_path, user_masked)
             VALUES ('unsafe-img', 'unsafe.png', 100, 1, 'unsafe.webp', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, thumbnail_path, user_masked)
             VALUES ('safe-img', 'safe.png', 300, 0, 'safe.webp', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('unsafe-img', 'RiskyLora'), ('safe-img', 'RiskyLora')",
            [],
        )
        .unwrap();

        harvest_models(&conn).unwrap();
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();

        let (thumb, safe_thumb, image_id, sensitive): (String, String, String, i64) = conn
            .query_row(
                "SELECT thumbnail_path, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'RiskyLora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(thumb, "unsafe.webp");
        assert_eq!(safe_thumb, "safe.webp");
        assert_eq!(image_id, "unsafe-img");
        assert_eq!(sensitive, 1);
    }

    #[test]
    fn test_rebuild_incremental_facet_types_rebuilds_only_requested_types() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }

        let metadata = r#"{
            "model": "Flux Base",
            "modelHash": "flux-hash",
            "tool": "InvokeAI"
        }"#;

        conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, tool, thumbnail_path, resolved_model_name, model_hash)
             VALUES ('img1', 'test.png', ?1, 100, 'InvokeAI', 'thumb1.png', 'Flux Base', 'flux-hash')",
            params![metadata],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img1', 'CinematicDetail')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_embeddings (image_id, embedding_name) VALUES ('img1', 'UnusedEmbedding')",
            [],
        )
        .unwrap();

        let rebuilt = rebuild_incremental_facet_types(
            &mut conn,
            &[
                "checkpoints".to_string(),
                "loras".to_string(),
                "tools".to_string(),
                "checkpoints".to_string(),
            ],
        )
        .unwrap();

        let facet_types: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT DISTINCT facet_type FROM facet_cache ORDER BY facet_type")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };

        assert_eq!(
            rebuilt,
            vec![
                "checkpoints".to_string(),
                "loras".to_string(),
                "tools".to_string()
            ]
        );
        assert_eq!(
            facet_types,
            vec![
                "checkpoints".to_string(),
                "loras".to_string(),
                "tools".to_string()
            ]
        );

        let embedding_facets: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM facet_cache WHERE facet_type = 'embeddings'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(embedding_facets, 0);
    }

    #[test]
    fn live_resource_refresh_updates_only_touched_rows() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, tool, thumbnail_path, resolved_model_name, model_hash)
             VALUES ('img-live', 'live.png', 100, 'InvokeAI', 'old.webp', 'OldModel', 'old-hash')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img-live', 'OldLora')",
            [],
        )
        .unwrap();

        harvest_models(&conn).unwrap();
        build_checkpoint_facets(&conn, FacetSource::Scoped).unwrap();
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();
        build_tool_facets(&conn, FacetSource::Scoped).unwrap();

        conn.execute(
            "UPDATE images
             SET timestamp = 200,
                 thumbnail_path = 'new.webp',
                 resolved_model_name = 'NewModel',
                 model_hash = 'new-hash'
             WHERE id = 'img-live'",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM image_loras WHERE image_id = 'img-live'", [])
            .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img-live', 'NewLora')",
            [],
        )
        .unwrap();

        let touches = FacetResourceTouches {
            checkpoints: vec!["OldModel".to_string(), "NewModel".to_string()],
            loras: vec!["OldLora".to_string(), "NewLora".to_string()],
            embeddings: vec![],
            hypernetworks: vec![],
            control_nets: vec![],
            ip_adapters: vec![],
            tools: vec!["InvokeAI".to_string()],
        };

        let mut progress_events = Vec::new();
        let refreshed =
            refresh_live_facet_resources_with_progress(&mut conn, &touches, |payload| {
                progress_events.push(payload);
            })
            .unwrap();
        assert_eq!(refreshed, 5);
        assert!(!progress_events.is_empty());

        let first_progress = progress_events.first().unwrap();
        assert_eq!(first_progress.current, 0);
        assert_eq!(first_progress.total, 5);
        assert_eq!(first_progress.message, "Updating local asset index...");
        assert_eq!(first_progress.mode.as_deref(), Some("determinate"));
        assert_eq!(first_progress.detail.as_deref(), Some("0 indexed"));

        let final_progress = progress_events.last().unwrap();
        assert_eq!(final_progress.current, 5);
        assert_eq!(final_progress.total, 5);
        assert_eq!(final_progress.message, "Updating local asset index...");
        assert_eq!(final_progress.detail.as_deref(), Some("5 indexed"));

        let old_lora_count: i64 = conn
            .query_row(
                "SELECT count FROM facet_cache WHERE facet_type = 'loras' AND resource_name = 'OldLora'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let new_lora_count: i64 = conn
            .query_row(
                "SELECT count FROM facet_cache WHERE facet_type = 'loras' AND resource_name = 'NewLora'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let old_model_count: i64 = conn
            .query_row(
                "SELECT count FROM facet_cache WHERE facet_type = 'checkpoints' AND resource_name = 'OldModel'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let (new_model_count, new_model_thumb): (i64, String) = conn
            .query_row(
                "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type = 'checkpoints' AND resource_name = 'NewModel'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(old_lora_count, 0);
        assert_eq!(new_lora_count, 1);
        assert_eq!(old_model_count, 0);
        assert_eq!(new_model_count, 1);
        assert_eq!(new_model_thumb, "new.webp");
    }

    #[test]
    fn live_resource_refresh_matches_legacy_weighted_resource_names() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, thumbnail_path)
             VALUES ('legacy-weighted', 'legacy.png', 100, 'legacy.webp')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('legacy-weighted', 'Matched.safetensors:0.75')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type)
             VALUES ('matched', 'Matched', 'civitai', 1, 'loras')",
            [],
        )
        .unwrap();

        let canonical_name = resource_clean_ref_sql("lora_name");
        let lookup_plan: Vec<String> = conn
            .prepare(&format!(
                "EXPLAIN QUERY PLAN
                 SELECT image_id FROM image_loras
                 WHERE ({canonical_name}) COLLATE NOCASE IN (
                     ?1,
                     ?1 || '.safetensors',
                     ?1 || '.ckpt',
                     ?1 || '.pt',
                     ?1 || '.bin',
                     ?1 || '.pth'
                 )"
            ))
            .unwrap()
            .query_map(["Matched"], |row| row.get(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(
            lookup_plan
                .iter()
                .any(|detail| detail.contains("idx_lora_canonical_name_image_v1")),
            "selective repair must use the canonical resource index: {lookup_plan:?}"
        );

        let touches = FacetResourceTouches {
            loras: vec!["Matched.safetensors:0.75".to_string()],
            ..FacetResourceTouches::default()
        };
        let refreshed = refresh_live_facet_resources(&mut conn, &touches).unwrap();
        assert_eq!(refreshed, 1);

        let (resource_name, count): (String, i64) = conn
            .query_row(
                "SELECT resource_name, count
                 FROM facet_cache
                 WHERE facet_type = 'loras'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(resource_name, "Matched");
        assert_eq!(count, 1);
    }

    #[test]
    fn internal_model_harvest_suppresses_only_the_active_build() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO invoke_scope_cache_state (
                scope_key, db_path, images_root, scope_mode, owner_id,
                status, generation, built_generation, updated_at
             ) VALUES
                ('active', 'C:/Invoke/invokeai.db', 'C:/Invoke', 'owner', 'a', 'building', 1, NULL, 1),
                ('inactive', 'C:/Invoke/invokeai.db', 'C:/Invoke', 'owner', 'b', 'ready', 0, 0, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE invoke_scope_cache_control SET active_scope_key = 'active'
             WHERE state_key = 'current'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (
                id, path, timestamp, model_hash, resolved_model_name,
                invoke_scope_hidden
             ) VALUES ('harvested', 'harvested.png', 1, 'model-a', 'Model A', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE invoke_scope_cache_state
             SET status = CASE scope_key WHEN 'active' THEN 'building' ELSE 'ready' END,
                 generation = CASE scope_key WHEN 'active' THEN 1 ELSE 0 END,
                 built_generation = CASE scope_key WHEN 'active' THEN NULL ELSE 0 END
             WHERE scope_key IN ('active', 'inactive')",
            [],
        )
        .unwrap();
        conn.execute(
            "DELETE FROM invoke_scope_cache_dirty_items
             WHERE scope_key IN ('active', 'inactive')",
            [],
        )
        .unwrap();

        harvest_models(&conn).unwrap();

        let active_status: String = conn
            .query_row(
                "SELECT status FROM invoke_scope_cache_state WHERE scope_key = 'active'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let inactive_status: String = conn
            .query_row(
                "SELECT status FROM invoke_scope_cache_state WHERE scope_key = 'inactive'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let suppression: i64 = conn
            .query_row(
                "SELECT suppress_active_model_invalidation
                 FROM invoke_scope_cache_control WHERE state_key = 'current'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(active_status, "building");
        assert_eq!(inactive_status, "dirty");
        assert_eq!(suppression, 0);
    }

    #[test]
    fn resource_index_progress_message_uses_specific_or_mixed_copy() {
        let lora_touches = FacetResourceTouches {
            loras: vec!["ExampleLora".to_string()],
            ..FacetResourceTouches::default()
        };
        let lora_items = collect_resource_refresh_items(&lora_touches);
        assert_eq!(lora_items.len(), 1);
        assert_eq!(
            resource_index_message(&lora_items),
            "Updating LoRA index..."
        );

        let checkpoint_touches = FacetResourceTouches {
            checkpoints: vec!["ExampleModel".to_string()],
            ..FacetResourceTouches::default()
        };
        let checkpoint_items = collect_resource_refresh_items(&checkpoint_touches);
        assert_eq!(checkpoint_items.len(), 1);
        assert_eq!(
            resource_index_message(&checkpoint_items),
            "Updating checkpoint index..."
        );

        let mixed_touches = FacetResourceTouches {
            checkpoints: vec!["ExampleModel".to_string()],
            loras: vec!["ExampleLora".to_string()],
            ..FacetResourceTouches::default()
        };
        assert_eq!(
            resource_index_message(&collect_resource_refresh_items(&mixed_touches)),
            "Updating local asset index..."
        );
    }

    #[test]
    fn live_resource_refresh_updates_lora_thumbnails_from_matched_rows() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, user_masked, thumbnail_path)
             VALUES
                ('unsafe-img', 'unsafe.png', 300, 1, 1, 'unsafe.webp'),
                ('safe-img', 'safe.png', 200, 0, 0, 'safe.webp')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('unsafe-img', 'SharedLora'), ('safe-img', 'SharedLora')",
            [],
        )
        .unwrap();

        let touches = FacetResourceTouches {
            loras: vec!["SharedLora".to_string()],
            ..FacetResourceTouches::default()
        };

        let refreshed = refresh_live_facet_resources(&mut conn, &touches).unwrap();
        assert_eq!(refreshed, 1);

        let (count, dynamic_thumb, safe_thumb, sensitive): (i64, String, String, i64) = conn
            .query_row(
                "SELECT count, thumbnail_path, safe_thumbnail_path, thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'SharedLora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(count, 2);
        assert_eq!(dynamic_thumb, "unsafe.webp");
        assert_eq!(safe_thumb, "safe.webp");
        assert_eq!(sensitive, 1);
    }

    #[test]
    fn bulk_facets_exclude_hidden_owner_metadata_but_keep_local_inventory() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, model_hash, resolved_model_name, invoke_scope_hidden)
             VALUES ('hidden-img', 'hidden.png', 1, 'hidden-checkpoint', 'HiddenCheckpoint', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('hidden-img', 'HiddenLora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO models (hash, name, filename, lookup_source, scanned_at, resource_type)
             VALUES
                ('hidden-checkpoint', 'HiddenCheckpoint', NULL, 'civitai', 1, 'checkpoint'),
                ('lora_HiddenLora', 'HiddenLora', NULL, 'harvest_lora', 1, 'loras'),
                ('local-checkpoint', 'LocalCheckpoint', 'local.safetensors', 'disk_scan', 1, 'checkpoint'),
                ('lora_LocalLora', 'LocalLora', 'local-lora.safetensors', 'disk_scan', 1, 'loras')",
            [],
        )
        .unwrap();

        harvest_models(&conn).unwrap();
        build_checkpoint_facets(&conn, FacetSource::Scoped).unwrap();
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();

        let hidden_facet_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM facet_cache
                 WHERE resource_name IN ('HiddenCheckpoint', 'HiddenLora')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let local_facet_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM facet_cache
                 WHERE resource_name IN ('LocalCheckpoint', 'LocalLora')",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(hidden_facet_count, 0);
        assert_eq!(local_facet_count, 2);
    }

    #[test]
    fn bulk_resource_facets_use_preaggregated_visible_matches_and_preserve_orphans() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, invoke_scope_hidden)
             VALUES
                ('visible', 'visible.png', 10, 0),
                ('hidden', 'hidden.png', 20, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES
                ('visible', 'Matched.safetensors:0.75'),
                ('visible', 'VisibleOrphan (Strong)'),
                ('hidden', 'HiddenRemote')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO models (hash, name, filename, lookup_source, scanned_at, resource_type)
             VALUES
                ('matched', 'Matched', NULL, 'civitai', 1, 'loras'),
                ('hidden', 'HiddenRemote', NULL, 'civitai', 1, 'loras'),
                ('local', 'UnusedLocal', 'unused.safetensors', 'disk_scan', 1, 'loras')",
            [],
        )
        .unwrap();

        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();

        let facets: Vec<(String, i64)> = conn
            .prepare(
                "SELECT resource_name, count
                 FROM facet_cache
                 WHERE facet_type = 'loras'
                 ORDER BY resource_name",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        assert_eq!(
            facets,
            vec![
                ("Matched".to_string(), 1),
                ("UnusedLocal".to_string(), 0),
                ("VisibleOrphan".to_string(), 1),
            ]
        );
    }

    #[test]
    fn bulk_facet_rebuild_replaces_manual_thumbnails_from_hidden_owners() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, thumbnail_path, invoke_scope_hidden)
             VALUES
                ('visible-img', 'visible.png', 100, 'visible.webp', 0),
                ('hidden-img', 'hidden.png', 200, 'hidden.webp', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('visible-img', 'SharedLora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type, thumbnail_path)
             VALUES ('lora_SharedLora', 'SharedLora', 'manual_thumbnail', 1, 'loras', 'hidden-img')",
            [],
        )
        .unwrap();

        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();
        sanitize_owner_hidden_facet_thumbnails(&conn).unwrap();

        let (thumbnail_path, thumbnail_image_id): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT thumbnail_path, thumbnail_image_id
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'SharedLora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(thumbnail_path.as_deref(), Some("visible.webp"));
        assert_eq!(thumbnail_image_id, None);
    }

    #[test]
    fn sidecar_resource_thumbnails_are_sensitive_in_auto_mode() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO privacy_mask_keywords (keyword) VALUES ('nsfw')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type, sidecar_thumbnail_path)
             VALUES ('lora_NsfwStyle', 'NsfwStyle', 'disk_scan', 1, 'loras', 'sidecar.webp')",
            [],
        )
        .unwrap();

        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();

        let sensitive: i64 = conn
            .query_row(
                "SELECT thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'NsfwStyle'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sensitive, 1);

        conn.execute(
            "UPDATE models SET thumbnail_sensitivity_override = 0 WHERE hash = 'lora_NsfwStyle'",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM facet_cache", []).unwrap();
        build_resource_facets(&conn, "loras", "loras", FacetSource::Scoped).unwrap();

        let override_sensitive: i64 = conn
            .query_row(
                "SELECT thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'NsfwStyle'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(override_sensitive, 0);
    }

    /// Opens a file library in WAL mode, as the app does, with `images` rows that use
    /// every facet type. A shared in-memory database cannot show WAL lock behaviour.
    fn open_lock_test_library(
        name: &str,
        image_count: i64,
    ) -> (std::path::PathBuf, rusqlite::Connection) {
        let path = std::env::temp_dir().join(format!(
            "ambit-464-{name}-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = rusqlite::Connection::open(&path).unwrap();
        crate::db::configure_connection(&conn).unwrap();
        for migration in init_db() {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute_batch(&format!(
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < {image_count})
             INSERT INTO images (id, path, timestamp, tool, thumbnail_path, resolved_model_name, model_hash)
             SELECT 'img-' || x, 'img-' || x || '.png', x, 'Tool' || (x % 7), 'thumb-' || x || '.webp',
                    'Model' || (x % 40), 'hash-' || (x % 40)
             FROM n;
             INSERT INTO image_loras (image_id, lora_name) SELECT id, 'Lora' || (timestamp % 90) FROM images;
             INSERT INTO image_embeddings (image_id, embedding_name) SELECT id, 'Emb' || (timestamp % 30) FROM images;
             INSERT INTO image_hypernetworks (image_id, hypernetwork_name) SELECT id, 'Hyper' || (timestamp % 5) FROM images;
             INSERT INTO image_controlnets (image_id, controlnet_name) SELECT id, 'Cnet' || (timestamp % 11) FROM images;
             INSERT INTO image_ipadapters (image_id, ipadapter_name) SELECT id, 'Ipad' || (timestamp % 13) FROM images;
             CREATE TABLE user_write_probe (id INTEGER PRIMARY KEY, n INTEGER NOT NULL);
             INSERT INTO user_write_probe (id, n) VALUES (1, 0);"
        ))
        .unwrap();
        (path, conn)
    }

    fn remove_lock_test_library(path: &std::path::Path) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    // #464: the post-mask refresh rebuilt six facet types inside one write transaction,
    // so every mask, favorite or count write in the next 30-40 s on a large library
    // waited out its busy timeout and failed. A user write must get in while it builds.
    #[test]
    fn incremental_facet_rebuild_leaves_user_writes_free_while_it_builds() {
        let (path, _setup) = open_lock_test_library("incremental", 4_000);
        let mut rebuild = rusqlite::Connection::open(&path).unwrap();
        crate::db::configure_connection(&rebuild).unwrap();

        // A user write that will not wait: it fails at once while the lock is held.
        let user = rusqlite::Connection::open(&path).unwrap();
        user.busy_timeout(std::time::Duration::ZERO).unwrap();
        let user = std::panic::AssertUnwindSafe(user);
        let succeeded = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let refused = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        {
            let succeeded = succeeded.clone();
            let refused = refused.clone();
            rebuild.progress_handler(
                2_000,
                Some(move || {
                    match user.execute("UPDATE user_write_probe SET n = n + 1 WHERE id = 1", []) {
                        Ok(_) => succeeded.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                        Err(_) => refused.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                    };
                    false
                }),
            );
        }

        let facet_types: Vec<String> = [
            "checkpoints",
            "loras",
            "embeddings",
            "hypernetworks",
            "controlNets",
            "ipAdapters",
        ]
        .iter()
        .map(|facet_type| facet_type.to_string())
        .collect();
        rebuild_incremental_facet_types(&mut rebuild, &facet_types).unwrap();
        rebuild.progress_handler(0, None::<fn() -> bool>);

        let succeeded = succeeded.load(std::sync::atomic::Ordering::Relaxed);
        let refused = refused.load(std::sync::atomic::Ordering::Relaxed);
        let lora_rows: i64 = rebuild
            .query_row(
                "SELECT COUNT(*) FROM main.facet_cache WHERE facet_type = 'loras'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(rebuild);
        remove_lock_test_library(&path);

        assert!(
            succeeded + refused >= 20,
            "too few probes ran: {succeeded} + {refused}"
        );
        // Only the short swap at the end may turn a write away.
        assert!(
            refused * 10 <= succeeded + refused,
            "user writes were refused while the rebuild ran: {refused} refused, {succeeded} succeeded"
        );
        assert_eq!(
            lora_rows, 90,
            "the rebuilt LoRA facets must be in the live cache"
        );
    }

    // #464: the owner-cache repair refreshes up to 64 resources at a time; doing that in
    // one write transaction held the lock for ~49 s on the owner's library.
    #[test]
    fn resource_refresh_leaves_user_writes_free_while_it_reads() {
        let (path, _setup) = open_lock_test_library("resources", 4_000);
        let mut refresh = rusqlite::Connection::open(&path).unwrap();
        crate::db::configure_connection(&refresh).unwrap();

        let user = rusqlite::Connection::open(&path).unwrap();
        user.busy_timeout(std::time::Duration::ZERO).unwrap();
        let user = std::panic::AssertUnwindSafe(user);
        let succeeded = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let refused = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        {
            let succeeded = succeeded.clone();
            let refused = refused.clone();
            refresh.progress_handler(
                2_000,
                Some(move || {
                    match user.execute("UPDATE user_write_probe SET n = n + 1 WHERE id = 1", []) {
                        Ok(_) => succeeded.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                        Err(_) => refused.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                    };
                    false
                }),
            );
        }

        let touches = FacetResourceTouches {
            checkpoints: vec!["Model1".to_string(), "Model2".to_string()],
            loras: (0..30).map(|n| format!("Lora{n}")).collect(),
            embeddings: vec!["Emb1".to_string(), "Emb2".to_string()],
            tools: vec!["Tool1".to_string()],
            ..Default::default()
        };
        let refreshed = refresh_live_facet_resources(&mut refresh, &touches).unwrap();
        refresh.progress_handler(0, None::<fn() -> bool>);

        let succeeded = succeeded.load(std::sync::atomic::Ordering::Relaxed);
        let refused = refused.load(std::sync::atomic::Ordering::Relaxed);
        let lora_rows: i64 = refresh
            .query_row(
                "SELECT COUNT(*) FROM main.facet_cache WHERE facet_type = 'loras'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lora_models: i64 = refresh
            .query_row(
                "SELECT COUNT(*) FROM main.models WHERE resource_type = ?1",
                [resource_config("loras").unwrap().resource_type],
                |row| row.get(0),
            )
            .unwrap();
        drop(refresh);
        remove_lock_test_library(&path);

        assert_eq!(refreshed, 35);
        assert!(
            succeeded + refused >= 20,
            "too few probes ran: {succeeded} + {refused}"
        );
        assert!(
            refused * 10 <= succeeded + refused,
            "user writes were refused while the refresh ran: {refused} refused, {succeeded} succeeded"
        );
        assert_eq!(
            lora_rows, 30,
            "the refreshed rows must be in the live cache"
        );
        // The refresh registers a model for each resource it finds in use.
        assert_eq!(lora_models, 30);
    }

    fn stage_loras(conn: &mut rusqlite::Connection) -> Option<ScopeChangeMarker> {
        harvest_models_staged(conn).unwrap();
        create_facet_staging_table(conn).unwrap();
        stage_incremental_facet_types(conn, &["loras".to_string()]).unwrap()
    }

    // #464 review: the staged rows come from a snapshot taken before the swap. An image the
    // user masks in between must not come back as a visible facet thumbnail.
    #[test]
    fn image_masked_while_facets_stage_is_not_a_visible_thumbnail_after_the_swap() {
        let (path, setup) = open_lock_test_library("privacy-swap", 1);
        let mut rebuild = rusqlite::Connection::open(&path).unwrap();
        crate::db::configure_connection(&rebuild).unwrap();

        let marker = stage_loras(&mut rebuild);
        let staged: (Option<String>, i64) = rebuild
            .query_row(
                "SELECT safe_thumbnail_path, thumbnail_is_sensitive FROM temp.facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'Lora1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(staged, (Some("thumb-1.webp".to_string()), 0));

        setup
            .execute("UPDATE images SET user_masked = 1 WHERE id = 'img-1'", [])
            .unwrap();
        swap_staged_facet_types(&mut rebuild, &["loras".to_string()], &marker).unwrap();

        let live: (Option<String>, i64) = rebuild
            .query_row(
                "SELECT safe_thumbnail_path, thumbnail_is_sensitive FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'Lora1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        drop(rebuild);
        drop(setup);
        remove_lock_test_library(&path);
        assert_eq!(
            live,
            (None, 1),
            "the masked image must not be a safe or plain thumbnail"
        );
    }

    // #464 review: a swap of rows staged before a library change still goes ahead, and the
    // owner scope cache is left dirty, so its repair brings the change in.
    #[test]
    fn swap_of_a_stale_snapshot_leaves_the_owner_cache_dirty() {
        let (path, setup) = open_lock_test_library("stale-swap", 3);
        let mut rebuild = rusqlite::Connection::open(&path).unwrap();
        crate::db::configure_connection(&rebuild).unwrap();
        // The library's models are already known, as after any earlier rebuild.
        harvest_models_staged(&mut rebuild).unwrap();
        setup
            .execute_batch(
                "INSERT INTO invoke_scope_cache_state (
                     scope_key, db_path, images_root, scope_mode, owner_id,
                     status, generation, built_generation, updated_at
                 ) VALUES ('scope-a', 'db', 'root', 'all', NULL, 'ready', 4, 4, 0);
                 UPDATE invoke_scope_cache_control SET active_scope_key = 'scope-a'
                 WHERE state_key = 'current';",
            )
            .unwrap();

        let marker = stage_loras(&mut rebuild);
        assert_eq!(
            marker,
            Some(ScopeChangeMarker {
                scope_key: "scope-a".to_string(),
                generation: 4
            })
        );
        setup
            .execute("UPDATE images SET timestamp = 99 WHERE id = 'img-2'", [])
            .unwrap();
        swap_staged_facet_types(&mut rebuild, &["loras".to_string()], &marker).unwrap();

        let (status, lora_rows): (String, i64) = rebuild
            .query_row(
                "SELECT (SELECT status FROM invoke_scope_cache_state WHERE scope_key = 'scope-a'),
                        (SELECT COUNT(*) FROM facet_cache WHERE facet_type = 'loras')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let staging_left: i64 = rebuild
            .query_row(
                "SELECT COUNT(*) FROM sqlite_temp_master WHERE name = 'facet_cache'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        drop(rebuild);
        drop(setup);
        remove_lock_test_library(&path);
        assert_eq!(status, "dirty");
        assert_eq!(lora_rows, 3, "the swap still replaces the cache");
        assert_eq!(
            staging_left, 0,
            "the staging table must not outlive the swap"
        );
    }

    // A failed staged rebuild must leave the live cache as it was and drop its staging
    // table, so the connection holds no TEMP shadow or open transaction afterwards.
    #[test]
    fn failed_incremental_swap_keeps_the_live_cache_and_drops_the_staging_table() {
        let (path, setup) = open_lock_test_library("failed-swap", 3);
        setup
            .execute(
                "INSERT INTO facet_cache (facet_type, resource_name, count) VALUES ('loras', 'Before', 7)",
                [],
            )
            .unwrap();
        let mut rebuild = rusqlite::Connection::open(&path).unwrap();
        crate::db::configure_connection(&rebuild).unwrap();
        rebuild
            .execute_batch(
                "CREATE TEMP TRIGGER stop_incremental_swap BEFORE INSERT ON main.facet_cache
                 BEGIN SELECT RAISE(ABORT, 'interrupted'); END;",
            )
            .unwrap();

        assert!(rebuild_incremental_facet_types(&mut rebuild, &["loras".to_string()]).is_err());
        let (live, staging_left, autocommit): (String, i64, bool) = (
            rebuild
                .query_row(
                    "SELECT group_concat(resource_name || ':' || count) FROM main.facet_cache WHERE facet_type = 'loras'",
                    [],
                    |row| row.get(0),
                )
                .unwrap(),
            rebuild
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_temp_master WHERE type = 'table' AND name = 'facet_cache'",
                    [],
                    |row| row.get(0),
                )
                .unwrap(),
            rebuild.is_autocommit(),
        );
        drop(rebuild);
        drop(setup);
        remove_lock_test_library(&path);
        assert_eq!(live, "Before:7");
        assert_eq!(staging_left, 0);
        assert!(autocommit, "no transaction may stay open after the failure");
    }
}
