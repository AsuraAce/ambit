use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{Manager, Wry};
use tauri_plugin_fs::FsExt;

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeDbSnapshotFile {
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeDbSnapshot {
    pub db_path: String,
    pub files: Vec<InvokeDbSnapshotFile>,
}

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

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn get_invoke_db_snapshot(root_path: String) -> Result<InvokeDbSnapshot, String> {
    let db_path = resolve_invoke_db_path(&root_path);
    let db_name = db_path
        .file_name()
        .ok_or_else(|| "Invalid InvokeAI database path".to_string())?
        .to_string_lossy()
        .to_string();

    let wal_path = db_path.with_file_name(format!("{}-wal", db_name));
    let shm_path = db_path.with_file_name(format!("{}-shm", db_name));

    Ok(InvokeDbSnapshot {
        db_path: normalize_path_for_frontend(&db_path),
        files: vec![
            snapshot_file(&db_path),
            snapshot_file(&wal_path),
            snapshot_file(&shm_path),
        ],
    })
}

fn resolve_invoke_db_path(root_path: &str) -> PathBuf {
    let trimmed = root_path.trim().trim_end_matches(['\\', '/']);
    let path = PathBuf::from(trimmed);

    if path
        .extension()
        .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("db"))
    {
        return path;
    }

    if path
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("databases"))
    {
        return path.join("invokeai.db");
    }

    path.join("databases").join("invokeai.db")
}

fn snapshot_file(path: &Path) -> InvokeDbSnapshotFile {
    match std::fs::metadata(path) {
        Ok(metadata) => InvokeDbSnapshotFile {
            path: normalize_path_for_frontend(path),
            exists: true,
            size: metadata.len(),
            modified_ms: metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64),
        },
        Err(_) => InvokeDbSnapshotFile {
            path: normalize_path_for_frontend(path),
            exists: false,
            size: 0,
            modified_ms: None,
        },
    }
}

fn normalize_path_for_frontend(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{get_invoke_db_snapshot, resolve_invoke_db_path};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn resolves_root_database_folder_and_file_paths() {
        assert_eq!(
            normalize(resolve_invoke_db_path("D:/Invoke")),
            "D:/Invoke/databases/invokeai.db"
        );
        assert_eq!(
            normalize(resolve_invoke_db_path("D:/Invoke/databases")),
            "D:/Invoke/databases/invokeai.db"
        );
        assert_eq!(
            normalize(resolve_invoke_db_path("D:/Invoke/databases/invokeai.db")),
            "D:/Invoke/databases/invokeai.db"
        );
    }

    #[test]
    fn snapshot_represents_missing_wal_and_shm_consistently() {
        let temp_root = std::env::temp_dir().join(format!(
            "ambit_invoke_snapshot_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let databases_dir = temp_root.join("databases");
        fs::create_dir_all(&databases_dir).unwrap();
        fs::write(databases_dir.join("invokeai.db"), b"test").unwrap();

        let snapshot = get_invoke_db_snapshot(temp_root.to_string_lossy().to_string()).unwrap();

        assert_eq!(snapshot.files.len(), 3);
        assert!(snapshot.files[0].exists);
        assert_eq!(snapshot.files[0].size, 4);
        assert!(snapshot.files[1].path.ends_with("invokeai.db-wal"));
        assert!(!snapshot.files[1].exists);
        assert_eq!(snapshot.files[1].size, 0);
        assert_eq!(snapshot.files[1].modified_ms, None);
        assert!(snapshot.files[2].path.ends_with("invokeai.db-shm"));
        assert!(!snapshot.files[2].exists);

        let _ = fs::remove_dir_all(temp_root);
    }

    fn normalize(path: PathBuf) -> String {
        path.to_string_lossy().replace('\\', "/")
    }
}
