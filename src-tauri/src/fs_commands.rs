use std::path::Path;
use tauri::{Manager, Wry};
use tauri_plugin_fs::FsExt;

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("Failed to move to trash: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn delete_thumbnail(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        trash::delete(p).map_err(|e| format!("Failed to move thumbnail to trash: {}", e))
    } else {
        Ok(()) // If it doesn't exist, we consider it "handled"
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn register_library_path(app: tauri::AppHandle<Wry>, path: String) -> Result<(), String> {
    let path_buf = Path::new(&path).to_path_buf();
    
    // Add to FS scope
    app.fs_scope().allow_directory(&path_buf, true)
        .map_err(|e| format!("Failed to add to FS scope: {}", e))?;
    
    // Add to Asset Protocol scope
    app.asset_protocol_scope().allow_directory(&path_buf, true)
        .map_err(|e| format!("Failed to add to Asset Protocol scope: {}", e))?;
    
    Ok(())
}
