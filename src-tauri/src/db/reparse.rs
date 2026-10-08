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

/// State for tracking reparse job cancellation.
pub struct ReparseState {
    pub is_cancelled: Arc<AtomicBool>,
}

impl Default for ReparseState {
    fn default() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
        }
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

    tauri::async_runtime::spawn_blocking(move || {
        let start_time = std::time::Instant::now();
        log::info!("[Refresh] Starting optimized refresh job. Force: {}, Filter: {:?}, Tool: {:?}", force_reparse, filter_root, filter_tool);

        log::info!("[Reparse] Thread started, opening connection...");
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

        // Normalize filter_root to forward slashes for consistency with frontend/DB
        let normalized_filter_root = filter_root.as_ref().map(|r| r.replace('\\', "/"));

        // Use shared configuration
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA synchronous = NORMAL;").map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(60)).map_err(|e| e.to_string())?; // Longer timeout

        log::info!("[Reparse] Connection ready, counting total images...");
        // Signal FE that we are actually in the backend
        let _ = app.emit("refresh-progress", ReparseProgress {
            current: 0,
            total: 0,
            updated: 0,
            errors: 0,
            phase: "counting".to_string(),
            message: "Calculating total images...".to_string(),
        });

        // Helper to build WHERE clause
        let build_filters = |force: bool, root: Option<&String>, tool: Option<&String>| -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
            let mut clauses = vec![
                "invoke_scope_hidden = 0".to_string(),
                "is_deleted = 0".to_string(),
                "COALESCE(media_type, 'image') != 'video'".to_string(),
                "original_metadata_json IS NOT NULL".to_string(),
                "original_metadata_json != ''".to_string()
            ];
            let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

            if !force {
                clauses.push(format!("(parser_version IS NULL OR parser_version < {})", CURRENT_PARSER_VERSION));
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
        let (where_sql, count_params) = build_filters(force_reparse, normalized_filter_root.as_ref(), filter_tool.as_ref());
        let count_query = format!("SELECT COUNT(*) FROM scoped_images WHERE {}", where_sql);

        let generated_total: usize = conn.query_row(
            &count_query,
            rusqlite::params_from_iter(count_params.iter()),
            |r| r.get::<_, i64>(0)
        ).unwrap_or(0) as usize;

        let photo_total = if refresh_photo_metadata && filter_tool.is_none() {
            let (photo_where, photo_params) =
                build_photo_filters(force_reparse, normalized_filter_root.as_deref());
            conn.query_row(
                &format!("SELECT COUNT(*) FROM scoped_images WHERE {}", photo_where),
                rusqlite::params_from_iter(photo_params.iter()),
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize
        } else {
            0
        };
        let total = generated_total + photo_total;

        log::info!("[Reparse] Total query complete: {} generated + {} photo candidates", generated_total, photo_total);

        if total == 0 {
            log::info!("[Reparse] No images need refreshing");
            let _ = app.emit("refresh-complete", ReparseJobResult {
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
        let _ = app.emit("refresh-progress", ReparseProgress {
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

        // SHARED UPDATE LOGIC CLOSURE
        // We define this locally to avoid borrowing issues or duplicating complex update code.
        // It takes a batch of rows, processes them, and updates the DB.
        let mut process_and_update_batch = |conn: &mut rusqlite::Connection, batch: Vec<(String, String, String, String)>, fetch_ms: u128| -> Result<(), String> {
            let parse_start = std::time::Instant::now();

            // PARALLEL PHASE: Parse structure on all cores
            let batch_results: Vec<(String, String, String, String, Option<crate::metadata::reparse::ReparseResult>)> = batch
                .par_iter()
                .map(|(id, tool, original_json, old_meta_json,)| {
                    let result = reparse_from_json(original_json, tool);
                    (id.clone(), tool.clone(), original_json.clone(), old_meta_json.clone(), result)
                })
                .collect();

            let parse_duration = parse_start.elapsed();
            let update_start = std::time::Instant::now();

            // SERIAL PHASE: Update database in a single transaction
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            {
                let mut update_stmt = tx.prepare_cached(
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
                     WHERE id = ?13"
                ).map_err(|e| e.to_string())?;

                let mut skip_stmt = tx.prepare_cached(
                    "UPDATE images SET parser_version = ?1 WHERE id = ?2"
                ).map_err(|e| e.to_string())?;

                // Helpers for diffing lists
                fn lists_changed(old: &[String], new: &[String]) -> bool {
                    if old.len() != new.len() { return true; }
                    old != new
                }

                // Prepare junction table statements
                let mut lora_del = tx.prepare_cached("DELETE FROM image_loras WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut lora_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_loras (image_id, lora_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

                let mut emb_del = tx.prepare_cached("DELETE FROM image_embeddings WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut emb_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_embeddings (image_id, embedding_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

                let mut hn_del = tx.prepare_cached("DELETE FROM image_hypernetworks WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut hn_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_hypernetworks (image_id, hypernetwork_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

                let mut cn_del = tx.prepare_cached("DELETE FROM image_controlnets WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut cn_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

                let mut ip_del = tx.prepare_cached("DELETE FROM image_ipadapters WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut ip_ins = tx.prepare_cached("INSERT OR IGNORE INTO image_ipadapters (image_id, ipadapter_name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;

                for (id, _tool, _original_json, old_meta_json, parse_result) in batch_results {
                    processed += 1;

                    match parse_result {
                        Some(result) => {
                            // Smart Diffing: skip updates if metadata is identical
                            // BUT: if filter_root and force_reparse are both set, we bypass this to force update
                            let mut meta_changed = force_reparse || result.metadata_json != *old_meta_json;

                            // Deep Object Diffing (only if not forced)
                            if meta_changed && !force_reparse {
                                if let Ok(old_meta) = serde_json::from_str::<ImageMetadata>(&old_meta_json) {
                                    if old_meta == result.metadata {
                                        meta_changed = false;
                                    }
                                }
                            }

                            if !meta_changed {
                                let _ = skip_stmt.execute(params![CURRENT_PARSER_VERSION, id]);
                            } else {
                                let old_meta: Option<ImageMetadata> = serde_json::from_str(&old_meta_json).ok();
                                updated += 1;
                                let meta = &result.metadata;
                                let sampler_normalized = meta.sampler
                                    .to_lowercase()
                                    .replace('_', " ")
                                    .replace('-', " ");

                                update_stmt.execute(params![
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
                                ]).map_err(|e| e.to_string())?;

                                // Smart Sidecar Diffing
                                let mut update_loras = true;
                                let mut update_embs = true;
                                let mut update_hns = true;
                                let mut update_cns = true;
                                let mut update_ips = true;

                                if !force_reparse {
                                    if let Some(old) = &old_meta {
                                        if !lists_changed(&old.loras, &meta.loras) { update_loras = false; }
                                        if !lists_changed(&old.embeddings, &meta.embeddings) { update_embs = false; }
                                        if !lists_changed(&old.hypernetworks, &meta.hypernetworks) { update_hns = false; }
                                        if !lists_changed(&old.control_nets, &meta.control_nets) { update_cns = false; }
                                        if !lists_changed(&old.ip_adapters, &meta.ip_adapters) { update_ips = false; }
                                    }
                                }

                                if update_loras {
                                    lora_del.execute(params![id]).ok();
                                    for item in &meta.loras { lora_ins.execute(params![id, item]).ok(); }
                                }
                                if update_embs {
                                    emb_del.execute(params![id]).ok();
                                    for item in &meta.embeddings { emb_ins.execute(params![id, item]).ok(); }
                                }
                                if update_hns {
                                    hn_del.execute(params![id]).ok();
                                    for item in &meta.hypernetworks { hn_ins.execute(params![id, item]).ok(); }
                                }
                                if update_cns {
                                    cn_del.execute(params![id]).ok();
                                    for item in &meta.control_nets { cn_ins.execute(params![id, item]).ok(); }
                                }
                                if update_ips {
                                    ip_del.execute(params![id]).ok();
                                    for item in &meta.ip_adapters { ip_ins.execute(params![id, item]).ok(); }
                                }
                            }
                        }
                        None => {
                            let _ = skip_stmt.execute(params![CURRENT_PARSER_VERSION, id]);
                            errors += 1;
                        }
                    }

                    // Emit progress periodically
                    if processed % progress_interval == 0 && last_emit_time.elapsed() >= min_emit_interval {
                        let update_ms = update_start.elapsed().as_millis();
                        let _ = app.emit("refresh-progress", ReparseProgress {
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
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        };

        if should_use_prefetch {
            // === STRATEGY 1: ID PRE-FETCHING (Filtered) ===
            log::info!("[Reparse] Strategy: ID Pre-fetching (Targeted)");
            let prefetch_start = std::time::Instant::now();

            // 1. Pre-fetch all IDs (Fast O(Folder Size) using Path Index)
            let (where_sql, params_vec) = build_filters(force_reparse, normalized_filter_root.as_ref(), filter_tool.as_ref());

             let query = format!("SELECT id FROM scoped_images WHERE {}", where_sql);

             let ids: Vec<String> = {
                 let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
                 let rows = stmt.query_map(rusqlite::params_from_iter(params_vec.iter()), |row| row.get(0))
                     .map_err(|e| e.to_string())?;
                 rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
             };

             let prefetch_duration = prefetch_start.elapsed();
             log::info!("[Reparse] Pre-fetched {} IDs in {:.2}ms. Starting batched processing...",
                ids.len(), prefetch_duration.as_millis());

             // 2. Loop through chunks
             for chunk in ids.chunks(batch_size) {
                 if is_cancelled.load(Ordering::SeqCst) {
                     break;
                 }

                 let fetch_start = std::time::Instant::now();
                 let placeholders = std::iter::repeat("?").take(chunk.len()).collect::<Vec<_>>().join(",");
                 let batch_query = format!(
                    "SELECT id, COALESCE(json_extract(original_parsed_json, '$.tool'), tool, 'Unknown'), original_metadata_json, COALESCE(metadata_json, '')
                     FROM scoped_images
                     WHERE id IN ({})",
                    placeholders
                 );

                 let batch: Vec<(String, String, String, String)> = {
                     let mut stmt = conn.prepare(&batch_query).map_err(|e| e.to_string())?;
                     let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                        ))
                     }).map_err(|e| e.to_string())?
                     .collect::<Result<Vec<_>, rusqlite::Error>>()
                     .map_err(|e| e.to_string())?;
                     rows
                 };
                 let fetch_duration = fetch_start.elapsed();

                 process_and_update_batch(&mut conn, batch, fetch_duration.as_millis())?;
             }

        } else {
            // === STRATEGY 2: KEYSET PAGINATION (Global) ===
            log::info!("[Refresh] Strategy: Keyset Pagination (Global)");
            let mut last_seen_id: String = String::new();

            loop {
                if is_cancelled.load(Ordering::SeqCst) {
                    break;
                }

                let fetch_start = std::time::Instant::now();
                let batch: Vec<(String, String, String, String)> = {
                    let (base_filters, mut params) = build_filters(force_reparse, filter_root.as_ref(), filter_tool.as_ref());
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
                     let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                        ))
                    }).map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, rusqlite::Error>>()
                    .map_err(|e| e.to_string())?;

                    rows
                };
                let fetch_duration = fetch_start.elapsed();

                if batch.is_empty() { break; }
                if let Some(last) = batch.last() { last_seen_id = last.0.clone(); }

                process_and_update_batch(&mut conn, batch, fetch_duration.as_millis())?;
            }
        }

        if photo_total > 0 && !is_cancelled.load(Ordering::SeqCst) {
            log::info!("[Refresh] Starting restart-safe photo metadata phase");
            let mut last_photo_id = String::new();
            let photo_batch_size = 100;

            loop {
                if is_cancelled.load(Ordering::SeqCst) {
                    break;
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

                let tx = conn.transaction().map_err(|e| e.to_string())?;
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
                                        let original_metadata_json = serde_json::to_string(&scan.chunks)
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
                                                meta.sampler.to_lowercase().replace('_', " ").replace('-', " "),
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
                                if !can_checkpoint_photo_refresh(
                                    scan.photo_metadata_error.as_deref(),
                                ) {
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
                                log::warn!("[Refresh] Photo metadata scan failed for {}: {}", id, error);
                            }
                        }
                    }
                }
                tx.commit().map_err(|e| e.to_string())?;

                let _ = app.emit("refresh-progress", ReparseProgress {
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
        let _ = app.emit("refresh-progress", ReparseProgress {
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
            duration.as_secs_f64(), processed, updated, errors, was_cancelled
        );

        let result = ReparseJobResult {
            processed,
            updated,
            errors,
            was_cancelled,
        };

        let _ = app.emit("refresh-complete", result.clone());

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cancel the currently running reparse job.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_reparse_job(state: tauri::State<'_, ReparseState>) {
    log::info!("[Refresh] Cancellation requested");
    state.is_cancelled.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};

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
