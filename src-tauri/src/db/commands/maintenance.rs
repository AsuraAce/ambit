use tauri::AppHandle;
use super::run_blocking;
use crate::db::resolve_db_path;

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
pub async fn get_db_diagnostics(app: AppHandle) -> Result<DbDiagnostics, String> {
    let app_clone = app.clone();
    run_blocking(app, move |conn| {
        let db_path = resolve_db_path(&app_clone)?;
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
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn optimize_database(app: AppHandle) -> Result<String, String> {
    run_blocking(app, move |conn| {
        let start = std::time::Instant::now();
        conn.execute("ANALYZE", []).map_err(|e| e.to_string())?;
        conn.execute("PRAGMA optimize", []).map_err(|e| e.to_string())?;
        Ok(format!("Database optimized in {:.2}s", start.elapsed().as_secs_f64()))
    }).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn purge_database(app: AppHandle) -> Result<String, String> {
    let db_path = resolve_db_path(&app)?;
    let marker_path = db_path.parent().ok_or("Failed to get DB parent directory")?.join(".purge_on_restart");
    std::fs::write(&marker_path, "purge requested").map_err(|e| format!("Failed to create purge marker: {}", e))?;

    #[cfg(not(debug_assertions))]
    { app.restart(); }

    #[cfg(debug_assertions)]
    { Ok("Purge scheduled. Please restart 'npm run tauri dev' to complete.".to_string()) }
}
