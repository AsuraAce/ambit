use std::collections::HashMap;
use rusqlite::params;
use super::{resolve_db_path, configure_connection, ImageRecord};

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DbDiagnostics {
    pub db_path: String,
    pub image_count: i64,
    pub deleted_count: i64,
    pub model_count: i64,
    pub cache_count: i64,
    pub tool_null_count: i64,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_db_diagnostics(app: tauri::AppHandle) -> Result<DbDiagnostics, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        
        let image_count: i64 = conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0)).unwrap_or(0);
        let deleted_count: i64 = conn.query_row("SELECT COUNT(*) FROM images WHERE is_deleted = 1", [], |r| r.get(0)).unwrap_or(0);
        let model_count: i64 = conn.query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0)).unwrap_or(0);
        let cache_count: i64 = conn.query_row("SELECT COUNT(*) FROM facet_cache", [], |r| r.get(0)).unwrap_or(0);
        let tool_null_count: i64 = conn.query_row("SELECT COUNT(*) FROM images WHERE json_extract(metadata_json, '$.tool') IS NULL", [], |r| r.get(0)).unwrap_or(0);

        Ok(DbDiagnostics {
            db_path: db_path.to_string_lossy().to_string(),
            image_count,
            deleted_count,
            model_count,
            cache_count,
            tool_null_count,
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn save_images_batch(app: tauri::AppHandle, images: Vec<ImageRecord>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        
        // Retry loop for database lock issues
        let max_retries = 5;
        let mut retry_delay_ms = 100;
        
        for attempt in 0..max_retries {
            let result = (|| -> Result<usize, String> {
                let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
                configure_connection(&conn).map_err(|e| e.to_string())?;

                let tx = conn.transaction().map_err(|e| e.to_string())?;

                {
                    let mut stmt = tx.prepare_cached(
                        "INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json, model_hash, model_name, tool, resolved_model_name, steps, cfg, sampler, generation_type)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                             json_extract(?7, '$.modelHash'),
                             json_extract(?7, '$.model'),
                             json_extract(?7, '$.tool'),
                             COALESCE((SELECT m.name FROM models m WHERE m.hash = json_extract(?7, '$.modelHash')), json_extract(?7, '$.model')),
                             CAST(json_extract(?7, '$.steps') AS INTEGER),
                             CAST(json_extract(?7, '$.cfg') AS REAL),
                             REPLACE(REPLACE(LOWER(json_extract(?7, '$.sampler')), '_', ' '), '-', ' '),
                             json_extract(?7, '$.generationType')
                         )
                         ON CONFLICT(id) DO UPDATE SET 
                            path=excluded.path,
                            timestamp=excluded.timestamp, 
                            file_size=excluded.file_size,
                            metadata_json=excluded.metadata_json,
                            thumbnail_path=excluded.thumbnail_path,
                            is_favorite=excluded.is_favorite,
                            is_pinned=excluded.is_pinned,
                            group_id=excluded.group_id,
                            board_id=excluded.board_id,
                            notes=excluded.notes,
                            original_metadata_json=excluded.original_metadata_json,
                            model_hash=excluded.model_hash,
                            model_name=excluded.model_name,
                            tool=excluded.tool,
                            resolved_model_name=excluded.resolved_model_name,
                            steps=excluded.steps,
                            cfg=excluded.cfg,
                            sampler=excluded.sampler,
                            generation_type=excluded.generation_type"
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
                        stmt.execute(params![
                            img.id,
                            img.path,
                            img.width,
                            img.height,
                            img.file_size as i64,
                            img.timestamp as i64,
                            img.metadata_json,
                            img.thumbnail_path,
                            img.is_favorite,
                            img.is_pinned,
                            img.is_deleted,
                            img.is_missing,
                            img.user_masked,
                            img.group_id,
                            img.board_id,
                            img.notes,
                            img.original_metadata_json
                        ])
                        .map_err(|e| e.to_string())?;

                        // Populate junction tables
                        lora_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                        emb_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                        hn_stmt.execute(params![img.id, img.metadata_json]).map_err(|e| e.to_string())?;
                    }
                }

                tx.commit().map_err(|e| e.to_string())?;
                Ok(images.len())
            })();
            
            match result {
                Ok(count) => return Ok(count),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2; // Exponential backoff
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
        
        Err("Failed to save images after max retries".to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_boards_native(
    app: tauri::AppHandle,
    board_mapping: HashMap<String, String>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        let images_to_check: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, path FROM images WHERE board_id IS NULL")
                .map_err(|e| e.to_string())?;
            let items = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            items
        };

        if images_to_check.is_empty() {
            return Ok(0);
        }

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;

        {
            let mut update_stmt = tx
                .prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2")
                .map_err(|e| e.to_string())?;

            for (id, path) in images_to_check {
                let filename = path
                    .split('/')
                    .last()
                    .or_else(|| path.split('\\').last())
                    .unwrap_or(&path);

                if let Some(board_name) = board_mapping.get(filename) {
                    update_stmt
                        .execute(params![board_name, id])
                        .map_err(|e| e.to_string())?;
                    updated_count += 1;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    }).await.map_err(|e| e.to_string())?

}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn optimize_database(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        let start = std::time::Instant::now();
        
        // ANALYZE gathers statistics about indices and stores them in sqlite_stat1
        // This helps the query planner make better decisions
        conn.execute("ANALYZE", []).map_err(|e| e.to_string())?;
        
        // PRAGMA optimize is also good practice - it runs ANALYZE only if needed
        // but explicit ANALYZE is better for user-triggered optimization
        conn.execute("PRAGMA optimize", []).map_err(|e| e.to_string())?;

        // VACUUM is too heavy/locking to run generally, so we skip it here
        
        let duration = start.elapsed();
        Ok(format!("Database optimized in {:.2}s", duration.as_secs_f64()))
    }).await.map_err(|e| e.to_string())?
}

/// Reset migration 18 if it failed partially. This deletes the migration record
/// and allows it to run again on next app launch.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reset_migration_18(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        
        // Check if migration 18 exists in the migrations table
        let has_migration: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM _sqlx_migrations WHERE version = 18",
            [],
            |r| r.get(0)
        ).unwrap_or(false);
        
        if !has_migration {
            return Ok("Migration 18 not found in database - nothing to reset".to_string());
        }
        
        // Delete the migration record
        conn.execute("DELETE FROM _sqlx_migrations WHERE version = 18", [])
            .map_err(|e| format!("Failed to delete migration record: {}", e))?;
        
        // Try to drop columns that may have been partially created
        // SQLite doesn't support DROP COLUMN directly in older versions, 
        // but newer versions (3.35+) do. We'll try and ignore errors.
        let columns_to_check = ["model_hash", "model_name", "tool", "resolved_model_name"];
        for col in &columns_to_check {
            // Check if column exists
            let col_exists: bool = conn.query_row(
                &format!("SELECT COUNT(*) > 0 FROM pragma_table_info('images') WHERE name = '{}'", col),
                [],
                |r| r.get(0)
            ).unwrap_or(false);
            
            if col_exists {
                // Try to drop it (may fail on older SQLite)
                let _ = conn.execute(&format!("ALTER TABLE images DROP COLUMN {}", col), []);
            }
        }
        
        // Also try to drop any indexes that may have been created
        let indexes = [
            "idx_images_model_hash_denorm",
            "idx_images_tool_denorm", 
            "idx_images_resolved_model",
            "idx_images_filter_model",
            "idx_images_filter_tool",
            "idx_collection_images_by_collection"
        ];
        for idx in &indexes {
            let _ = conn.execute(&format!("DROP INDEX IF EXISTS {}", idx), []);
        }
        
        Ok("Migration 18 reset successfully. Please restart the app to re-run the migration.".to_string())
    }).await.map_err(|e| e.to_string())?
}

/// Backfill the denormalized parameter columns (steps, cfg, sampler, generation_type).
/// This runs in batches to avoid blocking the database and can be called after app startup.
/// Returns the number of rows updated.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn backfill_parameter_columns(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        
        let start = std::time::Instant::now();
        
        // Diagnostic: Check actual column population status
        let total_images: i64 = conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0)).unwrap_or(0);
        let with_steps: i64 = conn.query_row("SELECT COUNT(*) FROM images WHERE steps IS NOT NULL", [], |r| r.get(0)).unwrap_or(0);
        let with_metadata: i64 = conn.query_row("SELECT COUNT(*) FROM images WHERE metadata_json IS NOT NULL", [], |r| r.get(0)).unwrap_or(0);
        
        println!("[Backfill] Diagnostics: {} total images, {} with steps column, {} with metadata_json", 
            total_images, with_steps, with_metadata);
        
        // Check how many rows need backfilling
        let needs_backfill: i64 = conn.query_row(
            "SELECT COUNT(*) FROM images WHERE steps IS NULL AND metadata_json IS NOT NULL",
            [],
            |r| r.get(0)
        ).unwrap_or(0);
        
        if needs_backfill == 0 {
            println!("[Backfill] No rows need backfilling.");
            return Ok(0);
        }
        
        // Diagnostic: Sample one row to see if it has steps in the JSON
        let sample_result: Result<(String, String), _> = conn.query_row(
            "SELECT COALESCE(CAST(json_extract(metadata_json, '$.steps') AS TEXT), 'NULL'), substr(metadata_json, 1, 200) 
             FROM images WHERE steps IS NULL AND metadata_json IS NOT NULL LIMIT 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        );
        
        if let Ok((steps_in_json, sample_json)) = &sample_result {
            println!("[Backfill] Sample NULL row - steps in JSON: {}, JSON preview: {}", steps_in_json, sample_json);
            
            // If sample shows NULL in JSON, these images don't have generation metadata
            if steps_in_json == "NULL" {
                println!("[Backfill] These {} images don't have generation metadata in JSON - skipping backfill.", needs_backfill);
                println!("[Backfill] Running ANALYZE to optimize future queries...");
                let _ = conn.execute("ANALYZE images", []);
                let duration = start.elapsed();
                println!("[Backfill] Completed in {:.2}s (0 rows needed actual update)", duration.as_secs_f64());
                return Ok(0);
            }
        }
        
        // Check how many rows actually have data to backfill
        let with_data: i64 = conn.query_row(
            "SELECT COUNT(*) FROM images WHERE steps IS NULL AND json_extract(metadata_json, '$.steps') IS NOT NULL",
            [],
            |r| r.get(0)
        ).unwrap_or(0);
        
        println!("[Backfill] Starting backfill of {} rows ({} have source data)...", needs_backfill, with_data);
        
        // Run ANALYZE first to help the query planner use the index on steps
        println!("[Backfill] Running ANALYZE to optimize query plan...");
        let _ = conn.execute("ANALYZE images", []);
        
        if with_data == 0 {
            println!("[Backfill] No rows have source data - nothing to update.");
            let duration = start.elapsed();
            println!("[Backfill] Completed in {:.2}s", duration.as_secs_f64());
            return Ok(0);
        }
        
        // Only update rows that actually have steps data in JSON
        let updated = conn.execute(
            "UPDATE images SET 
                steps = CAST(json_extract(metadata_json, '$.steps') AS INTEGER),
                cfg = CAST(json_extract(metadata_json, '$.cfg') AS REAL),
                sampler = REPLACE(REPLACE(LOWER(json_extract(metadata_json, '$.sampler')), '_', ' '), '-', ' '),
                generation_type = json_extract(metadata_json, '$.generationType')
             WHERE steps IS NULL 
               AND json_extract(metadata_json, '$.steps') IS NOT NULL",
            []
        ).map_err(|e| e.to_string())?;
        
        let duration = start.elapsed();
        println!("[Backfill] Completed {} rows in {:.2}s", updated, duration.as_secs_f64());
        
        // Run ANALYZE again after the update
        let _ = conn.execute("ANALYZE images", []);
        
        Ok(updated)
    }).await.map_err(|e| e.to_string())?
}


/// Numeric range for a parameter
#[derive(serde::Serialize, specta::Type)]
pub struct NumericRange {
    pub min: f64,
    pub max: f64,
}

/// Parameter ranges and distinct values for dynamic filters
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParameterRanges {
    pub steps: Option<NumericRange>,
    pub cfg: Option<NumericRange>,
    pub denoising_strength: Option<NumericRange>,
    pub samplers: Vec<String>,
    pub generation_types: Vec<String>,
}

/// Get parameter ranges and distinct values for dynamic filter UI.
/// Only returns non-null/non-default values to show what data actually exists.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_parameter_ranges(
    app: tauri::AppHandle,
    where_clause: Option<String>,
    params_json: Option<String>,
    collection_id: Option<String>,
    lora_name: Option<String>
) -> Result<ParameterRanges, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;
        
        // Parse params for reactive queries
        let params: Vec<serde_json::Value> = if let Some(json) = params_json {
            serde_json::from_str(&json).unwrap_or_else(|_| Vec::new())
        } else {
            Vec::new()
        };

        let sql_params: Vec<rusqlite::types::Value> = params.iter().map(|p| {
            match p {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        rusqlite::types::Value::Integer(i)
                    } else if let Some(f) = n.as_f64() {
                        rusqlite::types::Value::Real(f)
                    } else {
                        rusqlite::types::Value::Null
                    }
                }
                serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
                serde_json::Value::Null => rusqlite::types::Value::Null,
                _ => rusqlite::types::Value::Text(p.to_string()),
            }
        }).collect();
        
        // Base where clause for reactive queries with conditional JOINs
        let mut reactive_where = where_clause.unwrap_or_else(|| "WHERE is_deleted = 0".to_string());
        
        // If collection_id or lora_name provided, we need to construct a specific FROM/JOIN clause
        // Note: The main table in get_parameter_ranges is 'images'
        let mut from_clause = "FROM images".to_string();
        
        if let Some(col_id) = collection_id {
            from_clause.push_str(&format!(" JOIN collection_images ci ON ci.image_id = images.id AND ci.collection_id = '{}'", col_id));
        }
        
        if let Some(lora) = lora_name {
            from_clause.push_str(&format!(" JOIN image_loras il ON il.image_id = images.id AND il.lora_name = '{}'", lora));
        }

        // Steps range (GLOBAL: ignore filters) - Using denormalized column
        let steps: Option<NumericRange> = conn.query_row(
            "SELECT MIN(steps), MAX(steps) 
             FROM images 
             WHERE is_deleted = 0 
               AND steps > 0",
            [],
            |row| {
                let min: Option<f64> = row.get(0).ok();
                let max: Option<f64> = row.get(1).ok();
                Ok(match (min, max) {
                    (Some(min), Some(max)) if min > 0.0 => Some(NumericRange { min, max }),
                    _ => None,
                })
            }
        ).unwrap_or(None);
        
        // CFG range (GLOBAL: ignore filters) - Using denormalized column
        let cfg: Option<NumericRange> = conn.query_row(
            "SELECT MIN(cfg), MAX(cfg) 
             FROM images 
             WHERE is_deleted = 0 
               AND cfg > 0",
            [],
            |row| {
                let min: Option<f64> = row.get(0).ok();
                let max: Option<f64> = row.get(1).ok();
                Ok(match (min, max) {
                    (Some(min), Some(max)) if min > 0.0 => Some(NumericRange { min, max }),
                    _ => None,
                })
            }
        ).unwrap_or(None);
        
        // Denoising strength range (GLOBAL: ignore filters) - still uses json_extract since not denormalized
        let denoising_strength: Option<NumericRange> = conn.query_row(
            "SELECT MIN(json_extract(metadata_json, '$.denoisingStrength')), MAX(json_extract(metadata_json, '$.denoisingStrength')) 
             FROM images 
             WHERE is_deleted = 0 
               AND json_extract(metadata_json, '$.denoisingStrength') IS NOT NULL",
            [],
            |row| {
                let min: Option<f64> = row.get(0).ok();
                let max: Option<f64> = row.get(1).ok();
                Ok(match (min, max) {
                    (Some(min), Some(max)) => Some(NumericRange { min, max }),
                    _ => None,
                })
            }
        ).unwrap_or(None);
        
        // Distinct samplers (REACTIVE: respect filters) - Using denormalized column
        let samplers: Vec<String> = {
            let sql = format!(
                "SELECT DISTINCT sampler
                 {} 
                 {} 
                 AND sampler IS NOT NULL 
                 AND sampler != '' 
                 AND sampler != 'unknown'
                 ORDER BY 1",
                 from_clause, // Injects "FROM images JOIN ..."
                 reactive_where // Injects "WHERE ..."
            );

            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            
            let rows = stmt.query_map(rusqlite::params_from_iter(sql_params.iter()), |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        
        // Distinct generation types (REACTIVE: respect filters) - Using denormalized column
        let generation_types: Vec<String> = {
            let sql = format!(
                "SELECT DISTINCT generation_type
                 {} 
                 {} 
                 AND generation_type IS NOT NULL 
                 AND generation_type != '' 
                 AND generation_type != 'unknown'
                 ORDER BY 1",
                 from_clause, // Injects "FROM images JOIN ..."
                 reactive_where // Injects "WHERE ..."
            );

            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            
            let rows = stmt.query_map(rusqlite::params_from_iter(sql_params.iter()), |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        
        Ok(ParameterRanges {
            steps,
            cfg,
            denoising_strength,
            samplers,
            generation_types,
        })
    }).await.map_err(|e| e.to_string())?
}
