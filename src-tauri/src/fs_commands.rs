use std::path::Path;

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
