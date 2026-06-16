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
            phase: "counting".to_string(),
            message: "Calculating total images...".to_string(),
        });

        // Helper to build WHERE clause
        let build_filters = |force: bool, root: Option<&String>, tool: Option<&String>| -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
            let mut clauses = vec![
                "is_deleted = 0".to_string(),
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
        let count_query = format!("SELECT COUNT(*) FROM images WHERE {}", where_sql);

        let total: usize = conn.query_row(
            &count_query,
            rusqlite::params_from_iter(count_params.iter()),
            |r| r.get::<_, i64>(0)
        ).unwrap_or(0) as usize;
        
        log::info!("[Reparse] Total query complete: {}", total);
        
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

             let query = format!("SELECT id FROM images WHERE {}", where_sql);
             
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
                     FROM images 
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
                         FROM images 
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
        
        if is_cancelled.load(Ordering::SeqCst) {
            log::info!("[Refresh] Job cancelled by user");
            was_cancelled = true;
        }

        // Final progress update
        let _ = app.emit("refresh-progress", ReparseProgress {
            current: processed,
            total,
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
