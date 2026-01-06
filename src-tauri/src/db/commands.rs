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
                        "INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
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
                            original_metadata_json=excluded.original_metadata_json"
                    ).map_err(|e| e.to_string())?;

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
