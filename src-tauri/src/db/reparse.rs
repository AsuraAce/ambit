//! Metadata Re-parsing Commands
//!
//! Single-pass backend-driven re-parsing of image metadata.
//! Replaces the inefficient two-phase approach (reset → process).

use crate::db::{configure_connection, resolve_db_path};
use crate::metadata::reparse::reparse_from_json;
use crate::metadata::CURRENT_PARSER_VERSION;
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use rayon::prelude::*;

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
/// 2. Streams all images needing reparse (parser_version < CURRENT)
/// 3. Parses metadata in memory and batches updates
/// 4. Emits progress events for UI updates
/// 
/// NOTE: Uses batch fetching to avoid memory exhaustion on large libraries.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn start_reparse_job(
    app: tauri::AppHandle,
    state: tauri::State<'_, ReparseState>,
    force_reparse: bool,
    filter_root: Option<String>,
) -> Result<ReparseJobResult, String> {
    // Reset cancellation flag at start
    state.is_cancelled.store(false, Ordering::SeqCst);
    let is_cancelled = state.is_cancelled.clone();
    
    tauri::async_runtime::spawn_blocking(move || {
        let start_time = std::time::Instant::now();
        log::info!("[Reparse] Starting optimized reparse job. Force: {}, Filter: {:?}", force_reparse, filter_root);
        
        log::info!("[Reparse] Thread started, opening connection...");
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        
        // Use shared configuration
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA synchronous = NORMAL;").map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(60)).map_err(|e| e.to_string())?; // Longer timeout
        
        log::info!("[Reparse] Connection ready, counting total images...");
        // Signal FE that we are actually in the backend
        let _ = app.emit("reparse-progress", ReparseProgress {
            current: 0,
            total: 0,
            phase: "counting".to_string(),
            message: "Calculating total images...".to_string(),
        });

        // Helper to build WHERE clause and params
        let build_filters = |force: bool, root: Option<&String>| -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
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
                let normalized = r.trim_end_matches(['/', '\\']);
                clauses.push("(path = ? OR path LIKE ? || '/%' OR path LIKE ? || '\\%')".to_string());
                params.push(Box::new(normalized.to_string()));
                params.push(Box::new(normalized.to_string()));
                params.push(Box::new(normalized.to_string()));
            }

            (clauses.join(" AND "), params)
        };

        log::info!("[Reparse] Connection ready, counting total images...");
        // Signal FE that we are actually in the backend
        let _ = app.emit("reparse-progress", ReparseProgress {
            current: 0,
            total: 0,
            phase: "counting".to_string(),
            message: "Calculating total images...".to_string(),
        });

        // Count total work upfront
        let (where_sql, count_params) = build_filters(force_reparse, filter_root.as_ref());
        log::info!("[Reparse] Query Filters: {}", where_sql);
        let count_query = format!("SELECT COUNT(*) FROM images WHERE {}", where_sql);

        let total: usize = conn.query_row(
            &count_query,
            rusqlite::params_from_iter(count_params.iter()),
            |r| r.get::<_, i64>(0)
        ).unwrap_or(0) as usize;
        
        log::info!("[Reparse] Total query complete: {}", total);
        
        if total == 0 {
            log::info!("[Reparse] No images need re-parsing");
            let _ = app.emit("reparse-complete", ReparseJobResult {
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
        
        log::info!("[Reparse] Found {} images to process", total);
        let _ = app.emit("reparse-progress", ReparseProgress {
            current: 0,
            total,
            phase: "starting".to_string(),
            message: format!("Found {} images to re-parse", total),
        });
        
        let mut processed = 0;
        let mut updated = 0;
        let mut errors = 0;
        let mut skipped_no_metadata = 0;
        let batch_size = 2000; // Efficient batch size (increased from 100)
        let progress_interval = 50; // Check interval (increased from 10)
        let mut last_emit_time = std::time::Instant::now();
        let min_emit_interval = std::time::Duration::from_millis(100); // Max ~10 updates/sec
        let mut was_cancelled = false;

        // Log legacy count for user awareness
        let legacy_count: usize = conn.query_row(
            "SELECT COUNT(*) FROM images WHERE original_metadata_json IS NULL OR original_metadata_json = ''",
            [],
            |r| r.get(0)
        ).unwrap_or(0);
        if legacy_count > 0 {
            log::info!("[Reparse] {} legacy images will be skipped (no raw metadata available)", legacy_count);
        }
        
        log::info!("[Reparse] Starting processing loop...");
        loop {
            if is_cancelled.load(Ordering::SeqCst) {
                log::info!("[Reparse] Job cancelled by user");
                was_cancelled = true;
                break;
            }

            // SERIAL PHASE: Fetch batch
            let batch: Vec<(String, String, String, String)> = {
                let (where_sql, fetch_params) = build_filters(force_reparse, filter_root.as_ref());
                
                let query = format!(
                    "SELECT id, COALESCE(tool, 'Unknown'), original_metadata_json, COALESCE(metadata_json, '') 
                     FROM images 
                     WHERE {}
                     ORDER BY id ASC
                     LIMIT {} OFFSET {}",
                    where_sql, batch_size, processed
                );

                let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
                
                let rows = stmt.query_map(rusqlite::params_from_iter(fetch_params.iter()), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                }).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
                .map_err(|e| e.to_string())?;
                
                rows
            };
            
            if batch.is_empty() {
                break;
            }

            // PARALLEL PHASE: Parse metadata on all cores
            let batch_results: Vec<(String, String, Option<crate::metadata::reparse::ReparseResult>)> = batch
                .par_iter()
                .map(|(id, tool, original_json, old_meta_json)| {
                    let result = reparse_from_json(original_json, tool);
                    (id.clone(), old_meta_json.clone(), result)
                })
                .collect();
            
            // SERIAL PHASE: Update database in a single transaction
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            {
                let mut update_stmt = tx.prepare_cached(
                    "UPDATE images SET 
                        metadata_json = ?1,
                        model_hash = ?2,
                        model_name = ?3,
                        tool = ?4,
                        resolved_model_name = ?3,
                        steps = ?5,
                        cfg = ?6,
                        sampler = ?7,
                        generation_type = ?8,
                        parser_version = ?9
                     WHERE id = ?10"
                ).map_err(|e| e.to_string())?;
                
                let mut skip_stmt = tx.prepare_cached(
                    "UPDATE images SET parser_version = ?1 WHERE id = ?2"
                ).map_err(|e| e.to_string())?;

                // Prepare junction table statements
                let mut lora_del = tx.prepare_cached("DELETE FROM image_loras WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut lora_stmt = tx.prepare_cached("
                    INSERT OR IGNORE INTO image_loras (image_id, lora_name)
                    SELECT ?1, 
                        CASE 
                            WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                            WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                            ELSE value 
                        END
                    FROM json_each(?2, '$.loras')
                    WHERE value IS NOT NULL AND value != ''
                ").map_err(|e| e.to_string())?;

                let mut emb_del = tx.prepare_cached("DELETE FROM image_embeddings WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut emb_stmt = tx.prepare_cached("
                    INSERT OR IGNORE INTO image_embeddings (image_id, embedding_name)
                    SELECT ?1, 
                        CASE 
                            WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                            WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                            ELSE value 
                        END
                    FROM json_each(?2, '$.embeddings')
                    WHERE value IS NOT NULL AND value != ''
                ").map_err(|e| e.to_string())?;

                let mut hn_del = tx.prepare_cached("DELETE FROM image_hypernetworks WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut hn_stmt = tx.prepare_cached("
                    INSERT OR IGNORE INTO image_hypernetworks (image_id, hypernetwork_name)
                    SELECT ?1, 
                        CASE 
                            WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                            WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                            ELSE value 
                        END
                    FROM json_each(?2, '$.hypernetworks')
                    WHERE value IS NOT NULL AND value != ''
                ").map_err(|e| e.to_string())?;

                let mut cn_del = tx.prepare_cached("DELETE FROM image_controlnets WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut cn_stmt = tx.prepare_cached("
                    INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name)
                    SELECT ?1, 
                        CASE 
                            WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                            WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                            ELSE value 
                        END
                    FROM json_each(?2, '$.controlNets')
                    WHERE value IS NOT NULL AND value != ''
                ").map_err(|e| e.to_string())?;

                let mut ip_del = tx.prepare_cached("DELETE FROM image_ipadapters WHERE image_id = ?1").map_err(|e| e.to_string())?;
                let mut ip_stmt = tx.prepare_cached("
                    INSERT OR IGNORE INTO image_ipadapters (image_id, ipadapter_name)
                    SELECT ?1, 
                        CASE 
                            WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                            WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                            ELSE value 
                        END
                    FROM json_each(?2, '$.ipAdapters')
                    WHERE value IS NOT NULL AND value != ''
                ").map_err(|e| e.to_string())?;
                
                for (id, old_meta_json, parse_result) in batch_results {
                    processed += 1;
                    
                    match parse_result {
                        Some(result) => {
                            // OPTIMIZATION: If metadata haven't changed, only update parser_version
                            // This skips expensive triggers and junction table updates
                            if result.metadata_json == old_meta_json {
                                let _ = skip_stmt.execute(params![CURRENT_PARSER_VERSION, id]);
                            } else {
                                let meta = &result.metadata;
                                let sampler_normalized = meta.sampler
                                    .to_lowercase()
                                    .replace('_', " ")
                                    .replace('-', " ");
                                
                                match update_stmt.execute(params![
                                    result.metadata_json,
                                    meta.model_hash,
                                    meta.model,
                                    meta.tool,
                                    meta.steps,
                                    meta.cfg,
                                    sampler_normalized,
                                    meta.generation_type,
                                    CURRENT_PARSER_VERSION,
                                    id
                                ]) {
                                    Ok(_) => {
                                        updated += 1;
                                        // Update junction tables
                                        let _ = lora_del.execute(params![id]);
                                        let _ = lora_stmt.execute(params![id, result.metadata_json]);
                                        let _ = emb_del.execute(params![id]);
                                        let _ = emb_stmt.execute(params![id, result.metadata_json]);
                                        let _ = hn_del.execute(params![id]);
                                        let _ = hn_stmt.execute(params![id, result.metadata_json]);
                                        let _ = cn_del.execute(params![id]);
                                        let _ = cn_stmt.execute(params![id, result.metadata_json]);
                                        let _ = ip_del.execute(params![id]);
                                        let _ = ip_stmt.execute(params![id, result.metadata_json]);
                                    },
                                    Err(e) => {
                                        log::warn!("[Reparse] Failed to update image {}: {}", id, e);
                                        errors += 1;
                                    }
                                }
                            }
                        }
                        None => {
                            let _ = skip_stmt.execute(params![CURRENT_PARSER_VERSION, id]);
                            errors += 1;
                        }
                    }

                    // Emit progress periodically (max 10/sec)
                    if processed % progress_interval == 0 && last_emit_time.elapsed() >= min_emit_interval {
                        let _ = app.emit("reparse-progress", ReparseProgress {
                            current: processed,
                            total,
                            phase: "processing".to_string(),
                            message: format!("Processed {} / {} images", processed, total),
                        });
                        last_emit_time = std::time::Instant::now();
                    }

                    if is_cancelled.load(Ordering::SeqCst) {
                        was_cancelled = true;
                        break;
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
            
            if was_cancelled {
                break;
            }
        }
        
        // Final progress update
        let _ = app.emit("reparse-progress", ReparseProgress {
            current: processed,
            total,
            phase: "complete".to_string(),
            message: format!("Completed {} / {} images", processed, total),
        });
        
        let duration = start_time.elapsed();
        log::info!(
            "[Reparse] Job complete in {:.2}s: {} processed, {} updated, {} errors, cancelled: {}",
            duration.as_secs_f64(), processed, updated, errors, was_cancelled
        );
        
        let result = ReparseJobResult {
            processed,
            updated,
            errors,
            was_cancelled,
        };
        
        let _ = app.emit("reparse-complete", result.clone());
        
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cancel the currently running reparse job.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_reparse_job(state: tauri::State<'_, ReparseState>) {
    log::info!("[Reparse] Cancellation requested");
    state.is_cancelled.store(true, Ordering::SeqCst);
}

