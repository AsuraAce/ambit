use rusqlite::params;
use tauri::AppHandle;
use super::run_blocking;
use crate::db::ImageRecord;

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn save_images_batch(
    app: AppHandle,
    images: Vec<ImageRecord>,
) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        // Retry loop for database lock issues
        let max_retries = 5;
        let mut retry_delay_ms = 100;
        
        for attempt in 0..max_retries {
            let result = (|| -> Result<usize, String> {
                let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

                {
                    use crate::metadata::CURRENT_PARSER_VERSION;
                    
                    let mut stmt = tx.prepare_cached(
                        "INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, micro_thumbnail, thumbnail_source, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json, original_state_json, is_corrupt, model_hash, model_name, tool, resolved_model_name, steps, cfg, sampler, generation_type, parser_version)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
                             json_extract(?7, '$.modelHash'),
                             json_extract(?7, '$.model'),
                             json_extract(?7, '$.tool'),
                             COALESCE((SELECT m.name FROM models m WHERE m.hash = json_extract(?7, '$.modelHash')), json_extract(?7, '$.model')),
                             CAST(json_extract(?7, '$.steps') AS INTEGER),
                             CAST(json_extract(?7, '$.cfg') AS REAL),
                             REPLACE(REPLACE(LOWER(json_extract(?7, '$.sampler')), '_', ' '), '-', ' '),
                             json_extract(?7, '$.generationType'),
                             ?22
                         )
                         ON CONFLICT(id) DO UPDATE SET 
                            path=excluded.path,
                            timestamp=excluded.timestamp, 
                            file_size=excluded.file_size,
                            metadata_json=excluded.metadata_json,
                            thumbnail_path=COALESCE(NULLIF(excluded.thumbnail_path, ''), images.thumbnail_path),
                            micro_thumbnail=COALESCE(excluded.micro_thumbnail, images.micro_thumbnail),
                            thumbnail_source=COALESCE(excluded.thumbnail_source, images.thumbnail_source),
                            is_favorite=COALESCE(images.is_favorite, excluded.is_favorite),
                            is_pinned=COALESCE(images.is_pinned, excluded.is_pinned),
                            group_id=COALESCE(images.group_id, excluded.group_id),
                            board_id=COALESCE(images.board_id, excluded.board_id),
                            notes=COALESCE(images.notes, excluded.notes),
                            original_metadata_json=excluded.original_metadata_json,
                            original_state_json=COALESCE(images.original_state_json, excluded.original_state_json),
                            is_corrupt=excluded.is_corrupt,
                            model_hash=excluded.model_hash,
                            model_name=excluded.model_name,
                            tool=excluded.tool,
                            resolved_model_name=excluded.resolved_model_name,
                            steps=excluded.steps,
                            cfg=excluded.cfg,
                            sampler=excluded.sampler,
                            generation_type=excluded.generation_type,
                            parser_version=excluded.parser_version
                         WHERE images.metadata_json != excluded.metadata_json 
                            OR images.timestamp != excluded.timestamp 
                            OR images.file_size != excluded.file_size
                            OR images.original_metadata_json IS NULL
                            OR images.original_metadata_json != excluded.original_metadata_json"
                    ).map_err(|e| e.to_string())?;

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

                    for img in &images {
                        let rows_affected = stmt.execute(params![
                            img.id, img.path, img.width, img.height, img.file_size as i64, img.timestamp as i64,
                            img.metadata_json, img.thumbnail_path, img.micro_thumbnail, img.thumbnail_source,
                            img.is_favorite, img.is_pinned, img.is_deleted, img.is_missing, img.user_masked,
                            img.group_id, img.board_id, img.notes, img.original_metadata_json, img.original_state_json,
                            img.is_corrupt, CURRENT_PARSER_VERSION
                        ]).map_err(|e| e.to_string())?;

                        if rows_affected > 0 {
                            lora_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            emb_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            hn_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            cn_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                            ip_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                        }
                    }
                    // Explicitly drop statements before transaction commit
                    drop(stmt);
                    drop(lora_stmt);
                    drop(cn_stmt);
                    drop(ip_stmt);
                    drop(emb_stmt);
                    drop(hn_stmt);
                }

                tx.commit().map_err(|e| e.to_string())?;
                Ok(images.len())
            })();
            
            match result {
                Ok(count) => return Ok(count),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
        Err("Failed to save images after max retries".to_string())
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_image_count_for_path_prefix(
    app: AppHandle,
    path: String,
) -> Result<i64, String> {
    run_blocking(app, move |conn| {
        let normalized = path.trim_end_matches(['/', '\\']);
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM images WHERE path LIKE ? OR path LIKE ?",
            params![format!("{}/%", normalized), format!("{}\\%", normalized)],
            |r| r.get(0),
        ).unwrap_or(0);
        Ok(count)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_boards_native(
    app: AppHandle,
    board_mapping: std::collections::HashMap<String, String>,
) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let images_to_check: Vec<(String, String)> = {
            let mut stmt = conn.prepare("SELECT id, path FROM images WHERE board_id IS NULL").map_err(|e| e.to_string())?;
            let items = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, rusqlite::Error>>()
            .map_err(|e| e.to_string())?;
            drop(stmt);
            items
        };

        if images_to_check.is_empty() { return Ok(0); }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;
        {
            let mut update_stmt = tx.prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2").map_err(|e| e.to_string())?;
            for (id, path) in images_to_check {
                let filename = path.split('/').last().or_else(|| path.split('\\').last()).unwrap_or(&path);
                if let Some(board_name) = board_mapping.get(filename) {
                    update_stmt.execute(params![board_name, id]).map_err(|e| e.to_string())?;
                    updated_count += 1;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn mark_images_corrupt(app: AppHandle, ids: Vec<String>) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;
        {
            let mut stmt = tx.prepare_cached("UPDATE images SET is_corrupt = 1, thumbnail_path = '', micro_thumbnail = NULL WHERE id = ?1").map_err(|e| e.to_string())?;
            for id in ids {
                updated_count += stmt.execute(params![id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    }).await
}

#[derive(serde::Serialize, specta::Type)]
pub struct IntegrityResult {
    pub missing: usize,
    pub recovered: usize,
    pub broken_thumbs: usize,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn verify_library_integrity(app: AppHandle) -> Result<IntegrityResult, String> {
    run_blocking(app, move |conn| {
        let images: Vec<(String, String, Option<String>)> = {
            let mut stmt = conn.prepare("SELECT id, path, thumbnail_path FROM images").map_err(|e| e.to_string())?;
            let items = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            items
        };

        if images.is_empty() { return Ok(IntegrityResult { missing: 0, recovered: 0, broken_thumbs: 0 }); }

        let mut ids_to_mark_missing = Vec::new();
        let mut ids_to_mark_found = Vec::new();
        let mut ids_to_clear_thumb = Vec::new();

        for (id, path, thumb_path) in images {
            let path_exists = std::path::Path::new(&path).exists();
            if !path_exists {
                ids_to_mark_missing.push(id.clone());
            } else {
                ids_to_mark_found.push(id.clone());
                if let Some(t_path) = thumb_path {
                    if !t_path.is_empty() && !std::path::Path::new(&t_path).exists() {
                        ids_to_clear_thumb.push(id);
                    }
                }
            }
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut missing_count = 0;
        let mut thumb_count = 0;
        {
            let mut missing_stmt = tx.prepare_cached("UPDATE images SET is_missing = 1 WHERE id = ?").map_err(|e| e.to_string())?;
            for id in &ids_to_mark_missing { missing_count += missing_stmt.execute(params![id]).map_err(|e| e.to_string())?; }
            
            let mut found_stmt = tx.prepare_cached("UPDATE images SET is_missing = 0 WHERE id = ?").map_err(|e| e.to_string())?;
            for id in &ids_to_mark_found { found_stmt.execute(params![id]).map_err(|e| e.to_string())?; }
            
            let mut clear_stmt = tx.prepare_cached("UPDATE images SET thumbnail_path = '', micro_thumbnail = NULL WHERE id = ?").map_err(|e| e.to_string())?;
            for id in ids_to_clear_thumb { thumb_count += clear_stmt.execute(params![id]).map_err(|e| e.to_string())?; }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(IntegrityResult { missing: missing_count, recovered: ids_to_mark_found.len(), broken_thumbs: thumb_count })
    }).await
}
