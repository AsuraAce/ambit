//! Metadata Re-parsing Commands
//!
//! Single-pass backend-driven re-parsing of image metadata.
//! Replaces the inefficient two-phase approach (reset → process).

use crate::db::{configure_connection, resolve_db_path};
use crate::metadata::reparse::reparse_from_json;
use crate::metadata::{ImageMetadata, CURRENT_PARSER_VERSION};
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

        // Helper to build WHERE clause
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

        // Count total work upfront
        let (where_sql, count_params) = build_filters(force_reparse, filter_root.as_ref());
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
        let batch_size = 100; // Small batch size for responsiveness and lower contention
        let progress_interval = 25; 
        let mut last_emit_time = std::time::Instant::now();
        let min_emit_interval = std::time::Duration::from_millis(50);
        let mut was_cancelled = false;
        
        // Keyset Pagination State
        let mut last_seen_id: String = String::new();

        loop {
            if is_cancelled.load(Ordering::SeqCst) {
                log::info!("[Reparse] Job cancelled by user");
                was_cancelled = true;
                break;
            }

            // SERIAL PHASE: Fetch batch using Keyset Pagination
            // WHERE (normal_filters) AND id > last_seen_id ORDER BY id ASC LIMIT N
            let batch: Vec<(String, String, String, String)> = {
                let (base_filters, mut params) = build_filters(force_reparse, filter_root.as_ref());
                
                // Add keyset condition
                params.push(Box::new(last_seen_id.clone()));
                
                let query = format!(
                    "SELECT id, COALESCE(tool, 'Unknown'), original_metadata_json, COALESCE(metadata_json, '') 
                     FROM images 
                     WHERE {} AND id > ?
                     ORDER BY id ASC
                     LIMIT {}",
                    base_filters, batch_size
                );

                let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
                
                let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
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

            // Update last_seen_id for next iteration
            if let Some(last) = batch.last() {
                last_seen_id = last.0.clone();
            }

            // PARALLEL PHASE: Parse structure on all cores
            let batch_results: Vec<(String, String, String, String, Option<crate::metadata::reparse::ReparseResult>)> = batch
                .par_iter()
                .map(|(id, tool, original_json, old_meta_json,)| {
                    let result = reparse_from_json(original_json, tool);
                    (id.clone(), tool.clone(), original_json.clone(), old_meta_json.clone(), result)
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

                // Helpers for diffing lists
                fn lists_changed(old: &[String], new: &[String]) -> bool {
                    if old.len() != new.len() { return true; }
                    // Simple check: iterate and compare. Assuming strict ordering isn't guaranteed, 
                    // but usually parses return stable order. If parser changes order, it's a change.
                    // For sidecars, let's treat order as important for simplicity.
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
                            // 1. Try to deserialize OLD metadata to perform smart diffing
                            let old_meta: Option<ImageMetadata> = serde_json::from_str(&old_meta_json).ok();
                            
                            // 2. Diffing Logic
                            let meta_changed = result.metadata_json != old_meta_json;
                            
                            if !meta_changed {
                                // Zero-cost update (thanks to smart FTS trigger in m45)
                                let _ = skip_stmt.execute(params![CURRENT_PARSER_VERSION, id]);
                            } else {
                                // Metadata changed, apply full update
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
                                    meta.cfg,
                                    sampler_normalized,
                                    meta.generation_type,
                                    CURRENT_PARSER_VERSION,
                                    id
                                ]).map_err(|e| e.to_string())?;

                                // Smart Sidecar Diffing
                                // Only touch junction tables if the specific list actually changed
                                let mut update_loras = true;
                                let mut update_embs = true;
                                let mut update_hns = true;
                                let mut update_cns = true;
                                let mut update_ips = true;

                                if let Some(old) = &old_meta {
                                    if !lists_changed(&old.loras, &meta.loras) { update_loras = false; }
                                    if !lists_changed(&old.embeddings, &meta.embeddings) { update_embs = false; }
                                    if !lists_changed(&old.hypernetworks, &meta.hypernetworks) { update_hns = false; }
                                    if !lists_changed(&old.control_nets, &meta.control_nets) { update_cns = false; }
                                    if !lists_changed(&old.ip_adapters, &meta.ip_adapters) { update_ips = false; }
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

