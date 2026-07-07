use super::run_blocking;
use crate::metadata::CURRENT_PARSER_VERSION;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageToReparse {
    pub id: String,
    pub tool: String,
    pub original_metadata_json: String,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_images_needing_reparse(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<Vec<ImageToReparse>, String> {
    run_blocking(app, move |conn| {
        let limit = limit.unwrap_or(1000);
        let mut stmt = conn.prepare(&format!(
            "SELECT id, COALESCE(tool, 'Unknown'), original_metadata_json FROM images WHERE (parser_version IS NULL OR parser_version < {}) AND is_deleted = 0 AND original_metadata_json IS NOT NULL AND original_metadata_json != '' LIMIT {}",
            CURRENT_PARSER_VERSION, limit
        )).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(ImageToReparse {
                id: row.get(0)?,
                tool: row.get(1)?,
                original_metadata_json: row.get(2)?,
            })
        }).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

        Ok(rows)
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_reparse_count(app: AppHandle) -> Result<i64, String> {
    run_blocking(app, move |conn| {
        let count: i64 = conn.query_row(&format!(
            "SELECT COUNT(*) FROM images WHERE (parser_version IS NULL OR parser_version < {}) AND is_deleted = 0 AND original_metadata_json IS NOT NULL AND original_metadata_json != ''",
            CURRENT_PARSER_VERSION
        ), [], |r| r.get(0)).unwrap_or(0);
        Ok(count)
    }).await
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReparseBatchResult {
    pub processed: usize,
    pub updated: usize,
    pub errors: usize,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reparse_metadata_batch(
    app: AppHandle,
    images: Vec<ImageToReparse>,
) -> Result<ReparseBatchResult, String> {
    run_blocking(app, move |conn| {
        use crate::metadata::reparse::reparse_from_json;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut processed = 0;
        let mut updated = 0;
        let mut errors = 0;
        {
            let mut update_stmt = tx.prepare_cached(
                "UPDATE images SET metadata_json = ?1, model_hash = json_extract(?1, '$.modelHash'), model_name = json_extract(?1, '$.model'), tool = json_extract(?1, '$.tool'), resolved_model_name = COALESCE((SELECT m.name FROM models m WHERE m.hash = json_extract(?1, '$.modelHash')), json_extract(?1, '$.model')), steps = CAST(json_extract(?1, '$.steps') AS INTEGER), seed = CAST(json_extract(?1, '$.seed') AS INTEGER), cfg = CAST(json_extract(?1, '$.cfg') AS REAL), sampler = REPLACE(REPLACE(LOWER(json_extract(?1, '$.sampler')), '_', ' '), '-', ' '), generation_type = json_extract(?1, '$.generationType'), parser_version = ?2 WHERE id = ?3"
            ).map_err(|e| e.to_string())?;

            for img in &images {
                processed += 1;
                match reparse_from_json(&img.original_metadata_json, &img.tool) {
                    Some(result) => {
                        if update_stmt.execute(rusqlite::params![result.metadata_json, CURRENT_PARSER_VERSION, img.id]).is_ok() { updated += 1; } else { errors += 1; }
                    }
                    None => {
                        let _ = tx.execute("UPDATE images SET parser_version = ?1 WHERE id = ?2", rusqlite::params![CURRENT_PARSER_VERSION, img.id]);
                        errors += 1;
                    }
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ReparseBatchResult { processed, updated, errors })
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reset_parser_versions(app: AppHandle) -> Result<usize, String> {
    let app_for_emit = app.clone();
    run_blocking(app, move |conn| {
        let total_to_reset: i64 = conn.query_row("SELECT COUNT(*) FROM images WHERE is_deleted = 0 AND (parser_version != 0 OR parser_version IS NULL)", [], |r| r.get(0)).unwrap_or(0);
        let _ = app_for_emit.emit("reset-progress", format!("Found {} images to reset...", total_to_reset));

        let mut total_updated = 0;
        let batch_size = 1000;
        loop {
            let _ = app_for_emit.emit("reset-progress", format!("Resetting... {} / {}", total_updated, total_to_reset));
            let updated = conn.execute("UPDATE images SET parser_version = 0 WHERE id IN (SELECT id FROM images WHERE is_deleted = 0 AND (parser_version != 0 OR parser_version IS NULL) LIMIT ?)", [batch_size]).map_err(|e| e.to_string())?;
            total_updated += updated;
            if updated == 0 { break; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = app_for_emit.emit("reset-progress", "Reset complete. Starting re-parse...".to_string());
        Ok(total_updated)
    }).await
}
