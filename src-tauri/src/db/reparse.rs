//! Metadata Re-parsing Commands
//!
//! Single-pass backend-driven re-parsing of image metadata.
//! Replaces the inefficient two-phase approach (reset → process).

use crate::db::resolve_db_path;
use crate::metadata::reparse::reparse_from_json;
use crate::metadata::{ImageMetadata, CURRENT_PARSER_VERSION};
use rayon::prelude::*;
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

pub(crate) const CURRENT_PHOTO_REFRESH_VERSION: i64 = 2;

const UPDATE_PHOTO_METADATA_SQL: &str = "UPDATE images
     SET detected_source_kind = ?1,
         source_kind = COALESCE(source_kind_override, ?1),
         photo_metadata_json = ?2,
         capture_wall_time_ms = ?3,
         display_timestamp = CASE
             WHEN COALESCE(source_kind_override, ?1) = 'photograph'
             THEN COALESCE(?3, timestamp)
             ELSE timestamp
         END,
         thumbnail_version = CASE
             WHEN thumbnail_source = 'ambit'
                  AND (detected_source_kind IS NOT ?1
                       OR photo_metadata_json IS NOT ?2
                       OR width != ?4
                       OR height != ?5)
             THEN 0
             ELSE thumbnail_version
         END,
         width = ?4,
         height = ?5,
         photo_refresh_version = ?6
     WHERE id = ?7";

fn build_photo_filters(
    force_reparse: bool,
    root: Option<&str>,
) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut clauses = vec![
        "is_deleted = 0".to_string(),
        "media_type = 'image'".to_string(),
        "(detected_source_kind != 'generated' OR source_kind_override = 'photograph')".to_string(),
    ];
    if !force_reparse {
        clauses.push(format!(
            "photo_refresh_version < {}",
            CURRENT_PHOTO_REFRESH_VERSION
        ));
    }
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(root) = root {
        let root_forward = root.replace('\\', "/").trim_end_matches('/').to_string();
        let root_backward = root.replace('/', "\\").trim_end_matches('\\').to_string();
        clauses.push("(path = ? OR path = ? OR path LIKE ? || '/%' OR path LIKE ? || '\\%' OR path LIKE ? || '/%' OR path LIKE ? || '\\%')".to_string());
        params.push(Box::new(root_forward.clone()));
        params.push(Box::new(root_backward.clone()));
        params.push(Box::new(root_forward.clone()));
        params.push(Box::new(root_forward));
        params.push(Box::new(root_backward.clone()));
        params.push(Box::new(root_backward));
    }
    (clauses.join(" AND "), params)
}

fn can_checkpoint_photo_refresh(photo_metadata_error: Option<&str>) -> bool {
    photo_metadata_error.is_none()
}

fn replace_generated_resource_links(
    conn: &rusqlite::Connection,
    image_id: &str,
    metadata: &ImageMetadata,
) -> Result<(), String> {
    for (table, column, values) in [
        ("image_loras", "lora_name", metadata.loras.as_slice()),
        (
            "image_embeddings",
            "embedding_name",
            metadata.embeddings.as_slice(),
        ),
        (
            "image_hypernetworks",
            "hypernetwork_name",
            metadata.hypernetworks.as_slice(),
        ),
        (
            "image_controlnets",
            "controlnet_name",
            metadata.control_nets.as_slice(),
        ),
        (
            "image_ipadapters",
            "ipadapter_name",
            metadata.ip_adapters.as_slice(),
        ),
    ] {
        conn.execute(
            &format!("DELETE FROM {table} WHERE image_id = ?1"),
            params![image_id],
        )
        .map_err(|error| error.to_string())?;
        let mut insert = conn
            .prepare_cached(&format!(
                "INSERT OR IGNORE INTO {table} (image_id, {column}) VALUES (?1, ?2)"
            ))
            .map_err(|error| error.to_string())?;
        for value in values {
            insert
                .execute(params![image_id, value])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// State for tracking reparse job cancellation and pausing.
pub struct ReparseState {
    pub is_cancelled: Arc<AtomicBool>,
    /// Set while an InvokeAI owner switch or owner-cache repair runs (#552).
    pub is_paused: Arc<AtomicBool>,
}

impl Default for ReparseState {
    fn default() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
            is_paused: Arc::new(AtomicBool::new(false)),
        }
    }
}

const PAUSE_POLL: std::time::Duration = std::time::Duration::from_millis(100);

/// Stamps the current parser version on rows whose metadata did not change. Nothing a filter,
/// collection or statistic reads changes, so the stamp must not mark InvokeAI owner caches
/// dirty: on a re-run that would make every user's next switch recount all smart collections
/// (#530). The triggers stay off only inside this transaction, as in the thumbnail optimizer.
fn stamp_parser_version(tx: &rusqlite::Transaction, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let has_scope_cache: bool = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM sqlite_master
                            WHERE type = 'table' AND name = 'invoke_scope_cache_control')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let previous_suppression: Option<i64> = if has_scope_cache {
        let value = tx
            .query_row(
                "SELECT suppress_invalidation FROM invoke_scope_cache_control
                 WHERE state_key = 'current'",
                [],
                |row| row.get(0),
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
    {
        let mut stamp = tx
            .prepare_cached("UPDATE images SET parser_version = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for id in ids {
            // As before, a row that cannot be stamped is simply tried again by the next refresh.
            let _ = stamp.execute(params![CURRENT_PARSER_VERSION, id]);
        }
    }
    if let Some(previous) = previous_suppression {
        tx.execute(
            "UPDATE invoke_scope_cache_control SET suppress_invalidation = ?1
             WHERE state_key = 'current'",
            [previous],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Blocks between batches while metadata refresh is paused, holding no transaction.
/// Its image writes would mark the owner cache being built dirty and get that commit refused (#552).
/// Returns early when the job is cancelled, and returns whether it paused.
fn wait_while_paused(is_paused: &AtomicBool, is_cancelled: &AtomicBool) -> bool {
    let mut logged = false;
    while is_paused.load(Ordering::SeqCst) && !is_cancelled.load(Ordering::SeqCst) {
        if !logged {
            log::info!("[Refresh] Paused while an InvokeAI owner cache is prepared");
            logged = true;
        }
        std::thread::sleep(PAUSE_POLL);
    }
    logged
}

/// The async form of [`wait_while_paused`], for the video metadata refresh.
pub(crate) async fn wait_while_paused_async(is_paused: &AtomicBool, is_cancelled: &AtomicBool) {
    while is_paused.load(Ordering::SeqCst) && !is_cancelled.load(Ordering::SeqCst) {
        tokio::time::sleep(PAUSE_POLL).await;
    }
}

/// Progress event payload for reparse job.
#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReparseProgress {
    pub current: usize,
    pub total: usize,
    pub updated: usize,
    pub errors: usize,
    pub phase: String,
    pub message: String,
}

/// Result of a reparse job.
#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReparseJobResult {
    pub processed: usize,
    pub updated: usize,
    pub errors: usize,
    pub was_cancelled: bool,
}

/// Start the single-pass metadata re-parsing job.
///
/// This command:
/// 1. Opens a dedicated database connection
/// 2. Streams all images using Keyset Pagination (WHERE id > last_id)
/// 3. Parses using Rayon
/// 4. Updates DB with Smart Diffing (skipping unchanged prompts/junctions)
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn start_reparse_job(
    app: tauri::AppHandle,
    state: tauri::State<'_, ReparseState>,
    force_reparse: bool,
    filter_root: Option<String>,
    filter_tool: Option<String>,
    refresh_photo_metadata: bool,
) -> Result<ReparseJobResult, String> {
    // Reset cancellation flag at start
    state.is_cancelled.store(false, Ordering::SeqCst);
    let is_cancelled = state.is_cancelled.clone();
    let is_paused = state.is_paused.clone();

    tauri::async_runtime::spawn_blocking(move || {
        log::info!(
            "[Refresh] Starting optimized refresh job. Force: {}, Filter: {:?}, Tool: {:?}",
            force_reparse,
            filter_root,
            filter_tool
        );

        log::info!("[Reparse] Thread started, opening connection...");
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

        // Use shared configuration
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA synchronous = NORMAL;")
            .map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(60))
            .map_err(|e| e.to_string())?; // Longer timeout

        run_reparse_job(
            &mut conn,
            ReparseJobOptions {
                force_reparse,
                filter_root,
                filter_tool,
                refresh_photo_metadata,
            },
            &is_paused,
            &is_cancelled,
            &|progress| {
                let _ = app.emit("refresh-progress", progress);
            },
            &|result| {
                let _ = app.emit("refresh-complete", result);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What one reparse job refreshes.
struct ReparseJobOptions {
    force_reparse: bool,
    filter_root: Option<String>,
    filter_tool: Option<String>,
    refresh_photo_metadata: bool,
}

/// Runs one of the job's upfront counts on its own connection. The count scans the whole
/// library, so a pause set while it runs stops it, as it stops the startup count (#582). The job
/// then waits for the pause to clear and counts again. Returns `None` if the job was cancelled
/// while it waited.
fn count_unless_paused(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[Box<dyn rusqlite::ToSql>],
    is_paused: &Arc<AtomicBool>,
    is_cancelled: &AtomicBool,
) -> Option<usize> {
    use crate::db::background_work;
    loop {
        background_work::stop_when_epoch_changes_or_job_stopped(
            conn,
            background_work::current_epoch(),
            Some(is_paused.clone()),
        );
        let result = conn.query_row(sql, rusqlite::params_from_iter(params.iter()), |row| {
            row.get::<_, i64>(0)
        });
        background_work::clean_up_stopped_connection(conn, &[]);
        match result {
            // Stopped by the pause, or by a page load or exit that the job outlives as before.
            Err(error)
                if error.sqlite_error_code() == Some(rusqlite::ErrorCode::OperationInterrupted) =>
            {
                wait_while_paused(is_paused, is_cancelled);
                if is_cancelled.load(Ordering::SeqCst) {
                    return None;
                }
            }
            result => return Some(result.unwrap_or(0) as usize),
        }
    }
}

/// Runs one reparse job on `conn`, pausing between batches while `is_paused` is set (#552).
fn run_reparse_job(
    conn: &mut rusqlite::Connection,
    options: ReparseJobOptions,
    is_paused: &Arc<AtomicBool>,
    is_cancelled: &AtomicBool,
    emit_progress: &dyn Fn(ReparseProgress),
    emit_complete: &dyn Fn(ReparseJobResult),
) -> Result<ReparseJobResult, String> {
    let ReparseJobOptions {
        force_reparse,
        filter_root,
        filter_tool,
        refresh_photo_metadata,
    } = options;
    let start_time = std::time::Instant::now();
    // Normalize filter_root to forward slashes for consistency with frontend/DB
    let normalized_filter_root = filter_root.as_ref().map(|r| r.replace('\\', "/"));

    log::info!("[Reparse] Connection ready, counting total images...");
    // Signal FE that we are actually in the backend
    emit_progress(ReparseProgress {
        current: 0,
        total: 0,
        updated: 0,
        errors: 0,
        phase: "counting".to_string(),
        message: "Calculating total images...".to_string(),
    });

    // Helper to build WHERE clause
    let build_filters = |force: bool,
                         root: Option<&String>,
                         tool: Option<&String>|
     -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
        let mut clauses = vec![
            "invoke_scope_hidden = 0".to_string(),
            "is_deleted = 0".to_string(),
            "COALESCE(media_type, 'image') != 'video'".to_string(),
            "original_metadata_json IS NOT NULL".to_string(),
            "original_metadata_json != ''".to_string(),
        ];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if !force {
            clauses.push(format!(
                "(parser_version IS NULL OR parser_version < {})",
                CURRENT_PARSER_VERSION
            ));
        }

        if let Some(r) = root {
            // Already normalized to forward slashes at the start of the thread
            let r_fwd = r.replace('\\', "/").trim_end_matches('/').to_string();
            let r_back = r.replace('/', "\\").trim_end_matches('\\').to_string();

            // Match exact path OR subfolders with either slash type
            clauses.push("(path = ? OR path = ? OR path LIKE ? || '/%' OR path LIKE ? || '\\%' OR path LIKE ? || '/%' OR path LIKE ? || '\\%')".to_string());
            params.push(Box::new(r_fwd.clone()));
            params.push(Box::new(r_back.clone()));
            params.push(Box::new(r_fwd.clone()));
            params.push(Box::new(r_fwd.clone()));
            params.push(Box::new(r_back.clone()));
            params.push(Box::new(r_back.clone()));
        }

        // Filter by generator tool (e.g. "ComfyUI", "InvokeAI")
        if let Some(t) = tool {
            clauses.push("LOWER(tool) LIKE LOWER(?)".to_string());
            params.push(Box::new(format!("%{}%", t)));
        }

        (clauses.join(" AND "), params)
    };

    // Count total work upfront
    let (where_sql, count_params) = build_filters(
        force_reparse,
        normalized_filter_root.as_ref(),
        filter_tool.as_ref(),
    );
    let count_query = format!("SELECT COUNT(*) FROM scoped_images WHERE {}", where_sql);

    let cancelled_while_counting = || {
        log::info!("[Refresh] Job cancelled by user");
        emit_progress(ReparseProgress {
            current: 0,
            total: 0,
            updated: 0,
            errors: 0,
            phase: "complete".to_string(),
            message: "Completed 0 / 0 images".to_string(),
        });
        let result = ReparseJobResult {
            processed: 0,
            updated: 0,
            errors: 0,
            was_cancelled: true,
        };
        emit_complete(result.clone());
        Ok(result)
    };

    let Some(generated_total) =
        count_unless_paused(conn, &count_query, &count_params, is_paused, is_cancelled)
    else {
        return cancelled_while_counting();
    };

    let photo_total = if refresh_photo_metadata && filter_tool.is_none() {
        let (photo_where, photo_params) =
            build_photo_filters(force_reparse, normalized_filter_root.as_deref());
        let photo_query = format!("SELECT COUNT(*) FROM scoped_images WHERE {}", photo_where);
        let Some(photo_total) =
            count_unless_paused(conn, &photo_query, &photo_params, is_paused, is_cancelled)
        else {
            return cancelled_while_counting();
        };
        photo_total
    } else {
        0
    };
    let mut total = generated_total + photo_total;

    log::info!(
        "[Reparse] Total query complete: {} generated + {} photo candidates",
        generated_total,
        photo_total
    );

    if total == 0 {
        log::info!("[Reparse] No images need refreshing");
        emit_complete(ReparseJobResult {
            processed: 0,
            updated: 0,
            errors: 0,
            was_cancelled: false,
        });
        return Ok(ReparseJobResult {
            processed: 0,
            updated: 0,
            errors: 0,
            was_cancelled: false,
        });
    }

    log::info!("[Refresh] Found {} images to process", total);
    emit_progress(ReparseProgress {
        current: 0,
        total,
        updated: 0,
        errors: 0,
        phase: "starting".to_string(),
        message: format!("Found {} images to refresh", total),
    });

    let mut processed = 0;
    let mut updated = 0;
    let mut errors = 0;
    let batch_size = 500;
    let progress_interval = 50;
    let mut last_emit_time = std::time::Instant::now();
    let min_emit_interval = std::time::Duration::from_millis(50);

    #[cfg(feature = "qa-profile")]
    let qa_batch_delay = std::time::Duration::from_millis(
        std::env::var("AMBIT_QA_REFRESH_BATCH_DELAY_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(400)
            .min(10_000),
    );
    let mut was_cancelled = false;

    let should_use_prefetch = filter_root.is_some();

    // `scoped_images` follows the current InvokeAI scope, so a pause that spans a user switch
    // can change the rows left to walk. After a pause the keyset and photo phases recount what
    // remains past their position, so the total matches the rows the job walks (#558).
    let paused_in_batch = std::cell::Cell::new(false);
    let pending_total = std::cell::Cell::new(None::<usize>);
    let count_remaining =
        |conn: &rusqlite::Connection, generated_after: Option<&str>, photo_after: &str| -> usize {
            let count =
                |where_sql: String, mut params: Vec<Box<dyn rusqlite::ToSql>>, after: &str| {
                    params.push(Box::new(after.to_string()));
                    conn.query_row(
                        &format!(
                            "SELECT COUNT(*) FROM scoped_images WHERE {} AND id > ?",
                            where_sql
                        ),
                        rusqlite::params_from_iter(params.iter()),
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0) as usize
                };
            let generated = generated_after.map_or(0, |after| {
                let (where_sql, params) =
                    build_filters(force_reparse, filter_root.as_ref(), filter_tool.as_ref());
                count(where_sql, params, after)
            });
            let photos = if photo_total > 0 {
                let (where_sql, params) =
                    build_photo_filters(force_reparse, normalized_filter_root.as_deref());
                count(where_sql, params, photo_after)
            } else {
                0
            };
            generated + photos
        };

    // SHARED UPDATE LOGIC CLOSURE
    // We define this locally to avoid borrowing issues or duplicating complex update code.
    // It takes a batch of rows, processes them, and updates the DB.
    let mut process_and_update_batch = |conn: &mut rusqlite::Connection,
                                        batch: Vec<(String, String, String, String)>,
                                        fetch_ms: u128|
     -> Result<(), String> {
        if let Some(remaining) = pending_total.take() {
            total = processed + remaining;
        }
        let parse_start = std::time::Instant::now();

        // PARALLEL PHASE: Parse structure on all cores
        let batch_results: Vec<(
            String,
            String,
            String,
            String,
            Option<crate::metadata::reparse::ReparseResult>,
        )> = batch
            .par_iter()
            .map(|(id, tool, original_json, old_meta_json)| {
                let result = reparse_from_json(original_json, tool);
                (
                    id.clone(),
                    tool.clone(),
                    original_json.clone(),
                    old_meta_json.clone(),
                    result,
                )
            })
            .collect();

        let parse_duration = parse_start.elapsed();
        let update_start = std::time::Instant::now();

        // SERIAL PHASE: Update database in a single transaction
        // A pause set while this batch was parsing holds its write too (#552).
        if wait_while_paused(is_paused, is_cancelled) {
            paused_in_batch.set(true);
        }
        if is_cancelled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let _hold = crate::db::write_hold::WriteHold::begin("reparse.job_batch");
        {
            let mut update_stmt = tx
                .prepare_cached(
                    "UPDATE images SET
                    metadata_json = ?1,
                    original_parsed_json = ?1,
                    model_hash = ?2,
                    model_name = ?3,
                    tool = ?4,
                    resolved_model_name = ?3,
                    steps = ?5,
                    seed = ?6,
                    cfg = ?7,
                    sampler = ?8,
                    generation_type = ?9,
                    parser_version = ?10,
                    positive_prompt = ?11,
                    negative_prompt = ?12
                 WHERE id = ?13",
                )
                .map_err(|e| e.to_string())?;

            // Rows whose metadata did not change only get the new parser version, after the loop.
            let mut stamp_ids: Vec<String> = Vec::new();

            // Helpers for diffing lists
            fn lists_changed(old: &[String], new: &[String]) -> bool {
                if old.len() != new.len() {
                    return true;
                }
                old != new
            }

            // Prepare junction table statements
            let mut lora_del = tx
                .prepare_cached("DELETE FROM image_loras WHERE image_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut lora_ins = tx
                .prepare_cached(
                    "INSERT OR IGNORE INTO image_loras (image_id, lora_name) VALUES (?1, ?2)",
                )
                .map_err(|e| e.to_string())?;

            let mut emb_del = tx
                .prepare_cached("DELETE FROM image_embeddings WHERE image_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut emb_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_embeddings (image_id, embedding_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

            let mut hn_del = tx
                .prepare_cached("DELETE FROM image_hypernetworks WHERE image_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut hn_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_hypernetworks (image_id, hypernetwork_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

            let mut cn_del = tx
                .prepare_cached("DELETE FROM image_controlnets WHERE image_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut cn_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

            let mut ip_del = tx
                .prepare_cached("DELETE FROM image_ipadapters WHERE image_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut ip_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_ipadapters (image_id, ipadapter_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

            for (id, _tool, _original_json, old_meta_json, parse_result) in batch_results {
                processed += 1;

                match parse_result {
                    Some(result) => {
                        // Smart Diffing: skip updates if metadata is identical
                        // BUT: if filter_root and force_reparse are both set, we bypass this to force update
                        let mut meta_changed =
                            force_reparse || result.metadata_json != *old_meta_json;

                        // Deep Object Diffing (only if not forced)
                        if meta_changed && !force_reparse {
                            if let Ok(old_meta) =
                                serde_json::from_str::<ImageMetadata>(&old_meta_json)
                            {
                                if old_meta == result.metadata {
                                    meta_changed = false;
                                }
                            }
                        }

                        if !meta_changed {
                            stamp_ids.push(id);
                        } else {
                            let old_meta: Option<ImageMetadata> =
                                serde_json::from_str(&old_meta_json).ok();
                            updated += 1;
                            let meta = &result.metadata;
                            let sampler_normalized =
                                meta.sampler.to_lowercase().replace(['_', '-'], " ");

                            update_stmt
                                .execute(params![
                                    result.metadata_json,
                                    meta.model_hash,
                                    meta.model,
                                    meta.tool,
                                    meta.steps,
                                    meta.seed,
                                    meta.cfg,
                                    sampler_normalized,
                                    meta.generation_type,
                                    CURRENT_PARSER_VERSION,
                                    meta.positive_prompt,
                                    meta.negative_prompt,
                                    id
                                ])
                                .map_err(|e| e.to_string())?;

                            // Smart Sidecar Diffing
                            let mut update_loras = true;
                            let mut update_embs = true;
                            let mut update_hns = true;
                            let mut update_cns = true;
                            let mut update_ips = true;

                            if !force_reparse {
                                if let Some(old) = &old_meta {
                                    if !lists_changed(&old.loras, &meta.loras) {
                                        update_loras = false;
                                    }
                                    if !lists_changed(&old.embeddings, &meta.embeddings) {
                                        update_embs = false;
                                    }
                                    if !lists_changed(&old.hypernetworks, &meta.hypernetworks) {
                                        update_hns = false;
                                    }
                                    if !lists_changed(&old.control_nets, &meta.control_nets) {
                                        update_cns = false;
                                    }
                                    if !lists_changed(&old.ip_adapters, &meta.ip_adapters) {
                                        update_ips = false;
                                    }
                                }
                            }

                            if update_loras {
                                lora_del.execute(params![id]).ok();
                                for item in &meta.loras {
                                    lora_ins.execute(params![id, item]).ok();
                                }
                            }
                            if update_embs {
                                emb_del.execute(params![id]).ok();
                                for item in &meta.embeddings {
                                    emb_ins.execute(params![id, item]).ok();
                                }
                            }
                            if update_hns {
                                hn_del.execute(params![id]).ok();
                                for item in &meta.hypernetworks {
                                    hn_ins.execute(params![id, item]).ok();
                                }
                            }
                            if update_cns {
                                cn_del.execute(params![id]).ok();
                                for item in &meta.control_nets {
                                    cn_ins.execute(params![id, item]).ok();
                                }
                            }
                            if update_ips {
                                ip_del.execute(params![id]).ok();
                                for item in &meta.ip_adapters {
                                    ip_ins.execute(params![id, item]).ok();
                                }
                            }
                        }
                    }
                    None => {
                        stamp_ids.push(id);
                        errors += 1;
                    }
                }

                // Emit progress periodically
                if processed % progress_interval == 0
                    && last_emit_time.elapsed() >= min_emit_interval
                {
                    let update_ms = update_start.elapsed().as_millis();
                    emit_progress(ReparseProgress {
                        current: processed,
                        total,
                        updated,
                        errors,
                        phase: "processing".to_string(),
                        message: format!("Processed {}/{} (Updated: {}). Timings: Fetch {}ms, Parse {}ms, DB {}ms",
                            processed, total, updated, fetch_ms, parse_duration.as_millis(), update_ms),
                    });
                    last_emit_time = std::time::Instant::now();
                }
            }
            stamp_parser_version(&tx, &stamp_ids)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    };

    if should_use_prefetch {
        // === STRATEGY 1: ID PRE-FETCHING (Filtered) ===
        log::info!("[Reparse] Strategy: ID Pre-fetching (Targeted)");
        let prefetch_start = std::time::Instant::now();

        // 1. Pre-fetch all IDs (Fast O(Folder Size) using Path Index)
        let (where_sql, params_vec) = build_filters(
            force_reparse,
            normalized_filter_root.as_ref(),
            filter_tool.as_ref(),
        );

        let query = format!("SELECT id FROM scoped_images WHERE {}", where_sql);

        let ids: Vec<String> = {
            let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
                    row.get(0)
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        let prefetch_duration = prefetch_start.elapsed();
        log::info!(
            "[Reparse] Pre-fetched {} IDs in {:.2}ms. Starting batched processing...",
            ids.len(),
            prefetch_duration.as_millis()
        );

        // 2. Loop through chunks
        for chunk in ids.chunks(batch_size) {
            // The fixed id list needs no recount; the flag makes the photo phase recount.
            if wait_while_paused(is_paused, is_cancelled) {
                paused_in_batch.set(true);
            }
            if is_cancelled.load(Ordering::SeqCst) {
                break;
            }

            let fetch_start = std::time::Instant::now();
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let batch_query = format!(
                "SELECT id, COALESCE(json_extract(original_parsed_json, '$.tool'), tool, 'Unknown'), original_metadata_json, COALESCE(metadata_json, '')
                 FROM scoped_images
                 WHERE id IN ({})",
                placeholders
             );

            let batch: Vec<(String, String, String, String)> = {
                let mut stmt = conn.prepare(&batch_query).map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, rusqlite::Error>>()
                    .map_err(|e| e.to_string())?;
                rows
            };
            let fetch_duration = fetch_start.elapsed();

            process_and_update_batch(conn, batch, fetch_duration.as_millis())?;
        }
    } else {
        // === STRATEGY 2: KEYSET PAGINATION (Global) ===
        log::info!("[Refresh] Strategy: Keyset Pagination (Global)");
        let mut last_seen_id: String = String::new();

        loop {
            let paused = wait_while_paused(is_paused, is_cancelled);
            if is_cancelled.load(Ordering::SeqCst) {
                break;
            }
            if paused | paused_in_batch.take() {
                pending_total.set(Some(count_remaining(conn, Some(&last_seen_id), "")));
            }

            let fetch_start = std::time::Instant::now();
            let batch: Vec<(String, String, String, String)> = {
                let (base_filters, mut params) =
                    build_filters(force_reparse, filter_root.as_ref(), filter_tool.as_ref());
                params.push(Box::new(last_seen_id.clone()));

                let query = format!(
                    "SELECT id, COALESCE(json_extract(original_parsed_json, '$.tool'), tool, 'Unknown'), original_metadata_json, COALESCE(metadata_json, '')
                     FROM scoped_images
                     WHERE {} AND id > ?
                     ORDER BY id ASC
                     LIMIT {}",
                    base_filters, batch_size
                );

                let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, rusqlite::Error>>()
                    .map_err(|e| e.to_string())?;

                rows
            };
            let fetch_duration = fetch_start.elapsed();

            if batch.is_empty() {
                break;
            }
            if let Some(last) = batch.last() {
                last_seen_id = last.0.clone();
            }

            process_and_update_batch(conn, batch, fetch_duration.as_millis())?;
        }
    }

    // A recount from the last generated batch's pause applies even when no batch followed it.
    if let Some(remaining) = pending_total.take() {
        total = processed + remaining;
    }

    if photo_total > 0 && !is_cancelled.load(Ordering::SeqCst) {
        log::info!("[Refresh] Starting restart-safe photo metadata phase");
        let mut last_photo_id = String::new();
        let photo_batch_size = 100;

        loop {
            let paused = wait_while_paused(is_paused, is_cancelled);
            if is_cancelled.load(Ordering::SeqCst) {
                break;
            }
            if paused | paused_in_batch.take() {
                total = processed + count_remaining(conn, None, &last_photo_id);
            }

            let batch: Vec<(String, String)> = {
                let (photo_where, mut photo_params) =
                    build_photo_filters(force_reparse, normalized_filter_root.as_deref());
                photo_params.push(Box::new(last_photo_id.clone()));
                let query = format!(
                    "SELECT id, path
                     FROM scoped_images
                     WHERE {} AND id > ?
                     ORDER BY id ASC
                     LIMIT {}",
                    photo_where, photo_batch_size
                );
                let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(rusqlite::params_from_iter(photo_params.iter()), |row| {
                        Ok((row.get(0)?, row.get(1)?))
                    })
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, rusqlite::Error>>()
                    .map_err(|e| e.to_string())?;
                rows
            };

            if batch.is_empty() {
                break;
            }
            last_photo_id = batch.last().map(|row| row.0.clone()).unwrap_or_default();

            let scan_results: Vec<(String, Result<crate::scanner::models::ScanResult, String>)> =
                batch
                    .par_iter()
                    .map(|(id, path)| {
                        (
                            id.clone(),
                            crate::scanner::core::scan_image_internal(
                                path.clone(),
                                None,
                                true,
                                true,
                                None,
                            ),
                        )
                    })
                    .collect();

            // A pause set during the file scan holds its write too (#552).
            if wait_while_paused(is_paused, is_cancelled) {
                paused_in_batch.set(true);
            }
            if is_cancelled.load(Ordering::SeqCst) {
                break;
            }
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            let _hold = crate::db::write_hold::WriteHold::begin("reparse.photo_batch");
            {
                let mut update_photo = tx
                    .prepare_cached(UPDATE_PHOTO_METADATA_SQL)
                    .map_err(|e| e.to_string())?;
                let mut update_discovered_generated = tx
                    .prepare_cached(
                        "UPDATE images
                         SET metadata_json = ?1,
                             original_parsed_json = ?1,
                             original_metadata_json = ?2,
                             model_hash = ?3,
                             model_name = ?4,
                             tool = ?5,
                             resolved_model_name = ?4,
                             steps = ?6,
                             seed = ?7,
                             cfg = ?8,
                             sampler = ?9,
                             generation_type = ?10,
                             positive_prompt = ?11,
                             negative_prompt = ?12,
                             parser_version = 0
                         WHERE id = ?13",
                    )
                    .map_err(|e| e.to_string())?;

                for (id, scan_result) in scan_results {
                    processed += 1;
                    match scan_result {
                        Ok(scan) => {
                            let photo_json = scan
                                .photo_metadata
                                .as_ref()
                                .and_then(|photo| serde_json::to_string(photo).ok());
                            if scan.detected_source_kind
                                == crate::metadata::photo::SourceKind::Generated
                            {
                                if let Some(meta) = scan.metadata.as_ref() {
                                    let metadata_json = serde_json::to_string(meta)
                                        .map_err(|error| error.to_string())?;
                                    let original_metadata_json =
                                        serde_json::to_string(&scan.chunks)
                                            .map_err(|error| error.to_string())?;
                                    update_discovered_generated
                                        .execute(params![
                                            metadata_json,
                                            original_metadata_json,
                                            meta.model_hash,
                                            meta.model,
                                            meta.tool,
                                            meta.steps,
                                            meta.seed,
                                            meta.cfg,
                                            meta.sampler.to_lowercase().replace(['_', '-'], " "),
                                            meta.generation_type,
                                            meta.positive_prompt,
                                            meta.negative_prompt,
                                            id,
                                        ])
                                        .map_err(|error| error.to_string())?;
                                    replace_generated_resource_links(&tx, &id, meta)?;
                                }
                            }
                            if scan.error.is_some() || scan.photo_metadata_error.is_some() {
                                errors += 1;
                            }
                            if !can_checkpoint_photo_refresh(scan.photo_metadata_error.as_deref()) {
                                continue;
                            }
                            updated += update_photo
                                .execute(params![
                                    scan.detected_source_kind.as_str(),
                                    photo_json,
                                    scan.capture_wall_time_ms,
                                    i64::from(scan.width),
                                    i64::from(scan.height),
                                    CURRENT_PHOTO_REFRESH_VERSION,
                                    id,
                                ])
                                .map_err(|e| e.to_string())?;
                        }
                        Err(error) => {
                            errors += 1;
                            log::warn!(
                                "[Refresh] Photo metadata scan failed for {}: {}",
                                id,
                                error
                            );
                        }
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;

            emit_progress(ReparseProgress {
                current: processed,
                total,
                updated,
                errors,
                phase: "processing".to_string(),
                message: format!("Refreshing photo metadata {}/{}", processed, total),
            });

            #[cfg(feature = "qa-profile")]
            std::thread::sleep(qa_batch_delay);
        }
    }

    if is_cancelled.load(Ordering::SeqCst) {
        log::info!("[Refresh] Job cancelled by user");
        was_cancelled = true;
    }

    // Final progress update
    emit_progress(ReparseProgress {
        current: processed,
        total,
        updated,
        errors,
        phase: "complete".to_string(),
        message: format!("Completed {} / {} images", processed, total),
    });

    let duration = start_time.elapsed();
    log::info!(
        "[Refresh] Job complete in {:.2}s: {} processed, {} updated, {} errors, cancelled: {}",
        duration.as_secs_f64(),
        processed,
        updated,
        errors,
        was_cancelled
    );

    let result = ReparseJobResult {
        processed,
        updated,
        errors,
        was_cancelled,
    };

    emit_complete(result.clone());

    Ok(result)
}

/// Cancel the currently running reparse job.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_reparse_job(state: tauri::State<'_, ReparseState>) {
    log::info!("[Refresh] Cancellation requested");
    state.is_cancelled.store(true, Ordering::SeqCst);
}

/// Pause or resume metadata refresh between batches. The app pauses it while an InvokeAI owner
/// switch or owner-cache repair runs, so its writes cannot get that cache's commit refused (#552).
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn set_metadata_refresh_paused(state: tauri::State<'_, ReparseState>, paused: bool) {
    if state.is_paused.swap(paused, Ordering::SeqCst) != paused {
        log::info!(
            "[Refresh] Metadata refresh {}",
            if paused { "paused" } else { "resumed" }
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

    // A paused refresh must not write its next batch until the owner cache is committed (#552).
    #[test]
    fn a_paused_refresh_waits_until_resumed_or_cancelled() {
        for release_by_cancel in [false, true] {
            let state = ReparseState::default();
            state.is_paused.store(true, Ordering::SeqCst);
            let (paused, cancelled) = (state.is_paused.clone(), state.is_cancelled.clone());
            let waiter = std::thread::spawn(move || wait_while_paused(&paused, &cancelled));
            std::thread::sleep(PAUSE_POLL * 3);
            assert!(!waiter.is_finished(), "the next batch ran while paused");
            if release_by_cancel {
                state.is_cancelled.store(true, Ordering::SeqCst);
            } else {
                state.is_paused.store(false, Ordering::SeqCst);
            }
            let started = std::time::Instant::now();
            while !waiter.is_finished() {
                assert!(started.elapsed() < std::time::Duration::from_secs(5));
                std::thread::sleep(PAUSE_POLL / 4);
            }
            waiter.join().unwrap();
        }
    }

    fn reparse_test_database(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ambit-reparse-{name}-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_file(&path);
        let conn = Connection::open(&path).expect("test database");
        conn.execute_batch("PRAGMA journal_mode = WAL;")
            .expect("wal");
        for migration in crate::db::migrations::init_db() {
            conn.execute_batch(migration.sql).expect("apply migrations");
        }
        for index in 0..3 {
            conn.execute(
                "INSERT INTO images (id, path, timestamp, invoke_scope_hidden, parser_version, original_metadata_json)
                 VALUES (?1, ?2, 100, 0, 0, '{\"parameters\":\"a cat\nSteps: 20, Sampler: Euler\"}')",
                params![format!("img-{index}"), format!("D:/lib/img-{index}.png")],
            )
            .expect("image row");
        }
        path
    }

    fn stale_rows(path: &std::path::Path) -> i64 {
        Connection::open(path)
            .expect("observer")
            .query_row(
                "SELECT COUNT(*) FROM images WHERE parser_version < ?1",
                params![CURRENT_PARSER_VERSION],
                |row| row.get(0),
            )
            .expect("stale count")
    }

    fn run_unpaused_reparse(path: &std::path::Path) -> ReparseJobResult {
        let state = ReparseState::default();
        let mut conn = Connection::open(path).expect("job connection");
        run_reparse_job(
            &mut conn,
            ReparseJobOptions {
                force_reparse: false,
                filter_root: None,
                filter_tool: None,
                refresh_photo_metadata: false,
            },
            &state.is_paused,
            &state.is_cancelled,
            &|_| {},
            &|_| {},
        )
        .expect("reparse job")
    }

    // A refresh re-run mostly finds unchanged metadata and only stamps the parser version. That
    // changes nothing a filter, collection or statistic reads, so a prepared InvokeAI view must
    // stay restorable; otherwise every user's next switch recounts all smart collections (#530).
    // A row whose metadata did change must still mark the view for repair.
    #[test]
    fn a_stamp_only_refresh_leaves_prepared_owner_caches_ready() {
        let path = reparse_test_database("stamp-only");
        assert_eq!(run_unpaused_reparse(&path).updated, 3);
        let conn = Connection::open(&path).expect("setup connection");
        let set_stale = |sql: &str| {
            conn.execute_batch(&format!(
                "UPDATE invoke_scope_cache_control SET suppress_invalidation = 1 WHERE state_key = 'current';
                 {sql}
                 UPDATE invoke_scope_cache_control SET suppress_invalidation = 0 WHERE state_key = 'current';"
            ))
            .expect("stale rows");
        };
        set_stale(
            "UPDATE images SET parser_version = 0;
             INSERT INTO invoke_scope_cache_state
                 (scope_key, db_path, images_root, scope_mode, owner_id, status, generation, built_generation, updated_at)
             VALUES ('all-users', 'D:/Invoke/invokeai.db', 'D:/Invoke', 'all', NULL, 'ready', 4, 4, 0);",
        );
        let cache = || {
            conn.query_row(
                "SELECT status, generation,
                        (SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE scope_key = 'all-users'),
                        (SELECT COUNT(*) FROM invoke_scope_cache_dirty_items
                         WHERE scope_key = 'all-users' AND domain = 'collections')
                 FROM invoke_scope_cache_state WHERE scope_key = 'all-users'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
            )
            .expect("scope cache")
        };

        let stamped = run_unpaused_reparse(&path);
        assert_eq!((stamped.processed, stamped.updated), (3, 0));
        assert_eq!(
            stale_rows(&path),
            0,
            "every row carries the new parser version"
        );
        assert_eq!(
            cache(),
            ("ready".to_string(), 4, 0, 0),
            "a stamp left the view dirty"
        );

        set_stale("UPDATE images SET metadata_json = '{}', parser_version = 0 WHERE id = 'img-0';");
        assert_eq!(run_unpaused_reparse(&path).updated, 1);
        let (status, generation, _, collections) = cache();
        assert_eq!(
            status, "dirty",
            "a changed row must mark the view for repair"
        );
        assert!(generation > 4);
        assert_eq!(collections, 1);
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    // An owner switch pauses the refresh. A batch written during the switch's cache build marks
    // that cache dirty and gets its commit refused, so nothing may be written until it resumes (#552).
    #[test]
    fn a_paused_reparse_job_writes_nothing_until_resumed() {
        for filter_root in [None, Some("D:/lib".to_string())] {
            let path = reparse_test_database(if filter_root.is_some() {
                "prefetch"
            } else {
                "keyset"
            });
            let state = ReparseState::default();
            state.is_paused.store(true, Ordering::SeqCst);
            let (paused, cancelled) = (state.is_paused.clone(), state.is_cancelled.clone());
            let job_path = path.clone();
            let job = std::thread::spawn(move || {
                let mut conn = Connection::open(&job_path).expect("job connection");
                run_reparse_job(
                    &mut conn,
                    ReparseJobOptions {
                        force_reparse: false,
                        filter_root,
                        filter_tool: None,
                        refresh_photo_metadata: false,
                    },
                    &paused,
                    &cancelled,
                    &|_| {},
                    &|_| {},
                )
            });
            std::thread::sleep(PAUSE_POLL * 5);
            assert!(!job.is_finished(), "the job finished while paused");
            assert_eq!(stale_rows(&path), 3, "a batch was written while paused");

            state.is_paused.store(false, Ordering::SeqCst);
            let result = job.join().unwrap().expect("reparse job");
            assert_eq!(result.processed, 3);
            assert_eq!(stale_rows(&path), 0);
            let _ = std::fs::remove_file(&path);
        }
    }

    // The job's own count scans the whole library. An owner-cache build that starts while it runs
    // pauses refresh, and the count must stop then rather than compete with the build. The job
    // reports no rows while paused, then counts again and runs, so it never ends with 0 (#582).
    #[test]
    fn a_reparse_job_stops_its_count_while_paused_and_counts_again_once_resumed() {
        let path = reparse_test_database("count-pause");
        Connection::open(&path)
            .expect("setup connection")
            .execute_batch(
                "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
                 INSERT INTO images (id, path, timestamp, invoke_scope_hidden, parser_version, original_metadata_json)
                 SELECT 'bulk-' || i, 'D:/lib/bulk-' || i || '.png', 100, 0, 0, '{\"a\":1}' FROM n;",
            )
            .expect("rows");
        let state = ReparseState::default();
        let (paused, cancelled) = (state.is_paused.clone(), state.is_cancelled.clone());
        let phases = Arc::new(std::sync::Mutex::new(Vec::<(String, usize)>::new()));
        let job_path = path.clone();
        let job_phases = phases.clone();
        let job = std::thread::spawn(move || {
            let mut conn = Connection::open(&job_path).expect("job connection");
            run_reparse_job(
                &mut conn,
                ReparseJobOptions {
                    force_reparse: false,
                    filter_root: None,
                    filter_tool: None,
                    refresh_photo_metadata: false,
                },
                &paused.clone(),
                &cancelled,
                &|progress| {
                    // An owner-cache build starts as the job begins its count.
                    if progress.phase == "counting" {
                        paused.store(true, Ordering::SeqCst);
                    }
                    job_phases
                        .lock()
                        .unwrap()
                        .push((progress.phase, progress.total));
                },
                &|_| {},
            )
        });
        std::thread::sleep(PAUSE_POLL * 5);
        assert!(!job.is_finished(), "the job finished while paused");
        assert_eq!(
            phases.lock().unwrap().as_slice(),
            [("counting".to_string(), 0)],
            "the count finished or rows were reported while paused"
        );
        assert_eq!(stale_rows(&path), 5003, "a batch was written while paused");

        state.is_paused.store(false, Ordering::SeqCst);
        let result = job.join().unwrap().expect("reparse job");
        assert_eq!(result.processed, 5003);
        assert!(!result.was_cancelled);
        assert!(phases
            .lock()
            .unwrap()
            .contains(&("starting".to_string(), 5003)));
        assert_eq!(stale_rows(&path), 0);
        let _ = std::fs::remove_file(&path);
    }

    // A job counted in one InvokeAI user's scope often resumes in another after a switch, and
    // `scoped_images` then shows different rows. Its total must match the rows it walks (#558).
    #[test]
    fn a_reparse_job_recounts_its_total_after_a_pause_that_changes_scope() {
        let path = reparse_test_database("scope-change");
        {
            let conn = Connection::open(&path).expect("setup connection");
            conn.execute(
                "INSERT INTO invoke_owner_scope_state (state_key, db_path, images_root, scope_mode, owner_id, updated_at)
                 VALUES ('current', 'D:/Invoke/invokeai.db', 'D:/Invoke', 'owner', 'odin', 0)",
                [],
            )
            .expect("owner scope");
            for index in 0..2 {
                conn.execute(
                    "INSERT INTO images (id, path, timestamp, invoke_scope_hidden, parser_version, original_metadata_json, invoke_source_id, invoke_owner_id)
                     VALUES (?1, ?2, 100, 0, 0, '{\"parameters\":\"a cat
Steps: 20, Sampler: Euler\"}', 'D:/Invoke/invokeai.db', 'system')",
                    params![format!("inv-{index}"), format!("D:/Invoke/outputs/inv-{index}.png")],
                )
                .expect("shared InvokeAI row");
            }
        }
        let state = ReparseState::default();
        state.is_paused.store(true, Ordering::SeqCst);
        let (paused, cancelled) = (state.is_paused.clone(), state.is_cancelled.clone());
        let job_path = path.clone();
        let job = std::thread::spawn(move || {
            let mut conn = Connection::open(&job_path).expect("job connection");
            let progress = std::sync::Mutex::new(Vec::new());
            let result = run_reparse_job(
                &mut conn,
                ReparseJobOptions {
                    force_reparse: false,
                    filter_root: None,
                    filter_tool: None,
                    refresh_photo_metadata: false,
                },
                &paused,
                &cancelled,
                &|event| progress.lock().unwrap().push((event.current, event.total)),
                &|_| {},
            );
            (result, progress.into_inner().unwrap())
        });
        std::thread::sleep(PAUSE_POLL * 3);
        // The switch to All shows the shared user's rows the job did not count.
        Connection::open(&path)
            .expect("switch connection")
            .execute(
                "UPDATE invoke_owner_scope_state SET scope_mode = 'all', owner_id = NULL",
                [],
            )
            .expect("switch to All");
        state.is_paused.store(false, Ordering::SeqCst);

        let (result, progress) = job.join().unwrap();
        assert_eq!(result.expect("reparse job").processed, 5);
        // The first event is the "counting" placeholder; the second carries the up-front count.
        assert_eq!(progress.get(1), Some(&(0, 3)), "counted in Odin's scope");
        assert_eq!(
            progress.last(),
            Some(&(5, 5)),
            "total follows the rows walked"
        );
        assert!(progress.iter().all(|(current, total)| current <= total));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_reparse_job_recounts_its_total_when_a_scope_change_leaves_nothing_to_do() {
        let path = reparse_test_database("scope-shrink");
        {
            let conn = Connection::open(&path).expect("setup connection");
            conn.execute(
                "INSERT INTO invoke_owner_scope_state (state_key, db_path, images_root, scope_mode, owner_id, updated_at)
                 VALUES ('current', 'D:/Invoke/invokeai.db', 'D:/Invoke', 'all', NULL, 0)",
                [],
            )
            .expect("All scope");
            // The folder rows are current, so only the shared InvokeAI user's rows are stale.
            conn.execute(
                "UPDATE images SET parser_version = ?1",
                params![CURRENT_PARSER_VERSION],
            )
            .expect("current folder rows");
            for index in 0..2 {
                conn.execute(
                    "INSERT INTO images (id, path, timestamp, invoke_scope_hidden, parser_version, original_metadata_json, invoke_source_id, invoke_owner_id)
                     VALUES (?1, ?2, 100, 0, 0, '{\"parameters\":\"a cat
Steps: 20, Sampler: Euler\"}', 'D:/Invoke/invokeai.db', 'system')",
                    params![format!("inv-{index}"), format!("D:/Invoke/outputs/inv-{index}.png")],
                )
                .expect("shared InvokeAI row");
            }
        }
        let state = ReparseState::default();
        state.is_paused.store(true, Ordering::SeqCst);
        let (paused, cancelled) = (state.is_paused.clone(), state.is_cancelled.clone());
        let job_path = path.clone();
        let job = std::thread::spawn(move || {
            let mut conn = Connection::open(&job_path).expect("job connection");
            let progress = std::sync::Mutex::new(Vec::new());
            let result = run_reparse_job(
                &mut conn,
                ReparseJobOptions {
                    force_reparse: false,
                    filter_root: None,
                    filter_tool: None,
                    refresh_photo_metadata: false,
                },
                &paused,
                &cancelled,
                &|event| progress.lock().unwrap().push((event.current, event.total)),
                &|_| {},
            );
            (result, progress.into_inner().unwrap())
        });
        std::thread::sleep(PAUSE_POLL * 3);
        // The switch to Odin hides the shared user's rows, leaving nothing stale in scope.
        Connection::open(&path)
            .expect("switch connection")
            .execute(
                "UPDATE invoke_owner_scope_state SET scope_mode = 'owner', owner_id = 'odin'",
                [],
            )
            .expect("switch to Odin");
        state.is_paused.store(false, Ordering::SeqCst);

        let (result, progress) = job.join().unwrap();
        assert_eq!(result.expect("reparse job").processed, 0);
        assert_eq!(progress.get(1), Some(&(0, 2)), "counted in All");
        assert_eq!(
            progress.last(),
            Some(&(0, 0)),
            "total follows the rows left"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_reparse_job_cancelled_while_paused_writes_nothing() {
        for filter_root in [None, Some("D:/lib".to_string())] {
            let path = reparse_test_database(if filter_root.is_some() {
                "cancel-prefetch"
            } else {
                "cancel-keyset"
            });
            let state = ReparseState::default();
            state.is_paused.store(true, Ordering::SeqCst);
            let (paused, cancelled) = (state.is_paused.clone(), state.is_cancelled.clone());
            let job_path = path.clone();
            let job = std::thread::spawn(move || {
                let mut conn = Connection::open(&job_path).expect("job connection");
                run_reparse_job(
                    &mut conn,
                    ReparseJobOptions {
                        force_reparse: false,
                        filter_root,
                        filter_tool: None,
                        refresh_photo_metadata: false,
                    },
                    &paused,
                    &cancelled,
                    &|_| {},
                    &|_| {},
                )
            });
            std::thread::sleep(PAUSE_POLL * 3);
            state.is_cancelled.store(true, Ordering::SeqCst);
            job.join().unwrap().expect("reparse job");
            assert_eq!(stale_rows(&path), 3, "a cancelled job wrote a batch");
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn progress_payload_serializes_structured_counters() {
        let payload = ReparseProgress {
            current: 126_700,
            total: 288_222,
            updated: 123_981,
            errors: 2,
            phase: "processing".to_string(),
            message: "Processing metadata".to_string(),
        };

        let value = serde_json::to_value(payload).expect("serialize progress payload");

        assert_eq!(value["current"], 126_700);
        assert_eq!(value["total"], 288_222);
        assert_eq!(value["updated"], 123_981);
        assert_eq!(value["errors"], 2);
    }

    #[test]
    fn photo_refresh_invalidates_orientation_only_thumbnail_changes() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE images (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                thumbnail_source TEXT,
                thumbnail_version INTEGER NOT NULL,
                detected_source_kind TEXT NOT NULL,
                source_kind_override TEXT,
                source_kind TEXT NOT NULL,
                photo_metadata_json TEXT,
                capture_wall_time_ms INTEGER,
                display_timestamp INTEGER NOT NULL,
                photo_refresh_version INTEGER NOT NULL
             );
             INSERT INTO images VALUES (
                'orientation-only', 100, 4000, 3000, 'ambit', 2,
                'other', NULL, 'other', '{\"orientation\":1}', NULL, 100, 0
             );",
        )
        .expect("seed row");

        conn.execute(
            UPDATE_PHOTO_METADATA_SQL,
            params![
                "other",
                r#"{"orientation":3}"#,
                Option::<i64>::None,
                4000_i64,
                3000_i64,
                CURRENT_PHOTO_REFRESH_VERSION,
                "orientation-only",
            ],
        )
        .expect("refresh photo metadata");

        let state: (i64, i64) = conn
            .query_row(
                "SELECT thumbnail_version, photo_refresh_version
                 FROM images WHERE id = 'orientation-only'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("updated state");
        assert_eq!(state, (0, CURRENT_PHOTO_REFRESH_VERSION));
    }

    #[test]
    fn photo_refresh_includes_manual_photo_corrections_but_skips_generated_automatic_rows() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE images (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                is_deleted INTEGER NOT NULL,
                detected_source_kind TEXT NOT NULL,
                source_kind_override TEXT,
                photo_refresh_version INTEGER NOT NULL,
                media_type TEXT NOT NULL DEFAULT 'image'
             );
             INSERT INTO images VALUES
                ('generated-auto', 'C:/library/a.jpg', 0, 'generated', NULL, 0, 'image'),
                ('generated-corrected', 'C:/library/b.jpg', 0, 'generated', 'photograph', 0, 'image'),
                ('other-stale', 'C:/library/c.jpg', 0, 'other', NULL, 0, 'image'),
                ('png-v1', 'C:/library/d.png', 0, 'other', NULL, 1, 'image'),
                ('webp-v1', 'C:/library/e.webp', 0, 'other', NULL, 1, 'image'),
                ('other-current-v2', 'C:/library/f.jpg', 0, 'other', NULL, 2, 'image'),
                ('video', 'C:/library/g.mp4', 0, 'other', NULL, 0, 'video');",
        )
        .expect("seed candidates");

        let (where_sql, values) = build_photo_filters(false, None);
        let ids = conn
            .prepare(&format!(
                "SELECT id FROM images WHERE {where_sql} ORDER BY id"
            ))
            .expect("prepare candidates")
            .query_map(rusqlite::params_from_iter(values.iter()), |row| {
                row.get::<_, String>(0)
            })
            .expect("query candidates")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect candidates");

        assert_eq!(
            ids,
            ["generated-corrected", "other-stale", "png-v1", "webp-v1"]
        );
    }

    #[test]
    fn photo_metadata_failures_remain_pending_for_retry() {
        assert!(can_checkpoint_photo_refresh(None));
        assert!(!can_checkpoint_photo_refresh(Some(
            "temporary EXIF read failure"
        )));
    }

    #[test]
    fn discovered_generated_metadata_replaces_all_resource_links() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE image_loras (image_id TEXT, lora_name TEXT, UNIQUE(image_id, lora_name));
             CREATE TABLE image_embeddings (image_id TEXT, embedding_name TEXT, UNIQUE(image_id, embedding_name));
             CREATE TABLE image_hypernetworks (image_id TEXT, hypernetwork_name TEXT, UNIQUE(image_id, hypernetwork_name));
             CREATE TABLE image_controlnets (image_id TEXT, controlnet_name TEXT, UNIQUE(image_id, controlnet_name));
             CREATE TABLE image_ipadapters (image_id TEXT, ipadapter_name TEXT, UNIQUE(image_id, ipadapter_name));
             INSERT INTO image_loras VALUES ('discovered', 'stale');
             INSERT INTO image_loras VALUES ('unrelated', 'keep');",
        )
        .expect("resource schema");
        let metadata = ImageMetadata {
            loras: vec!["detail".to_string()],
            embeddings: vec!["easynegative".to_string()],
            hypernetworks: vec!["style".to_string()],
            control_nets: vec!["depth".to_string()],
            ip_adapters: vec!["reference".to_string()],
            ..ImageMetadata::default()
        };

        replace_generated_resource_links(&conn, "discovered", &metadata).expect("replace links");

        for (table, column, expected) in [
            ("image_loras", "lora_name", "detail"),
            ("image_embeddings", "embedding_name", "easynegative"),
            ("image_hypernetworks", "hypernetwork_name", "style"),
            ("image_controlnets", "controlnet_name", "depth"),
            ("image_ipadapters", "ipadapter_name", "reference"),
        ] {
            let values = conn
                .prepare(&format!(
                    "SELECT {column} FROM {table} WHERE image_id = 'discovered'"
                ))
                .expect("prepare resource query")
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query resources")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect resources");
            assert_eq!(values, [expected]);
        }
        let unrelated: String = conn
            .query_row(
                "SELECT lora_name FROM image_loras WHERE image_id = 'unrelated'",
                [],
                |row| row.get(0),
            )
            .expect("unrelated link");
        assert_eq!(unrelated, "keep");
    }
}
