use crate::db::{configure_connection, resolve_db_path};
use rusqlite::{params, Connection};
use std::fs;
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
pub fn move_to_trash(app: tauri::AppHandle<Wry>, path: String) -> Result<(), String> {
    let canonical_file = resolve_existing_regular_file(&path)?;
    let conn = open_configured_app_db(&app)?;

    if !path_is_known_media_file(&conn, &path, &canonical_file)? {
        return Err("Refusing to move an untracked file to trash".to_string());
    }

    trash::delete(&canonical_file).map_err(|e| format!("Failed to move to trash: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn delete_thumbnail(app: tauri::AppHandle<Wry>, path: String) -> Result<(), String> {
    let thumbnail_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data directory: {}", e))?
        .join(".thumbnails");

    if let Some(thumbnail_file) = resolve_eligible_thumbnail_file(&path, &thumbnail_dir)? {
        trash::delete(thumbnail_file)
            .map_err(|e| format!("Failed to move thumbnail to trash: {}", e))?;
    }

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn register_library_path(app: tauri::AppHandle<Wry>, path: String) -> Result<(), String> {
    let path_buf = validate_library_scope_directory(&path)?;

    // Add to FS scope
    app.fs_scope()
        .allow_directory(&path_buf, true)
        .map_err(|e| format!("Failed to add to FS scope: {}", e))?;

    // Add to Asset Protocol scope
    app.asset_protocol_scope()
        .allow_directory(&path_buf, true)
        .map_err(|e| format!("Failed to add to Asset Protocol scope: {}", e))?;

    Ok(())
}

fn validate_library_scope_directory(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    let canonical = fs::canonicalize(Path::new(trimmed))
        .map_err(|e| format!("Failed to resolve library path: {}", e))?;
    let metadata =
        fs::metadata(&canonical).map_err(|e| format!("Failed to inspect library path: {}", e))?;

    if !metadata.is_dir() {
        return Err("Library path must be an existing directory".to_string());
    }

    if is_filesystem_root(&canonical) {
        return Err("Refusing to register a filesystem root as a library path".to_string());
    }

    Ok(canonical)
}

fn is_filesystem_root(path: &Path) -> bool {
    path.parent().is_none()
}

fn resolve_existing_regular_file(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    let candidate = PathBuf::from(trimmed);
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|e| format!("Failed to inspect file path: {}", e))?;

    if !metadata.is_file() {
        return Err("Path must be an existing regular file".to_string());
    }

    fs::canonicalize(candidate).map_err(|e| format!("Failed to resolve file path: {}", e))
}

fn open_configured_app_db(app: &tauri::AppHandle<Wry>) -> Result<Connection, String> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    configure_connection(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn path_is_known_media_file(
    conn: &Connection,
    requested_path: &str,
    canonical_path: &Path,
) -> Result<bool, String> {
    let requested = normalize_path_string(requested_path);
    let canonical = normalize_path_for_frontend(canonical_path);

    let is_known: i64 = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM images
                WHERE id IN (?1, ?2) OR path IN (?1, ?2)
                UNION ALL
                SELECT 1 FROM removed_images
                WHERE id IN (?1, ?2) OR path IN (?1, ?2)
            )",
            params![requested, canonical],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(is_known != 0)
}

fn resolve_eligible_thumbnail_file(
    path: &str,
    thumbnail_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let candidate = PathBuf::from(trimmed);
    if !candidate.exists() {
        return Ok(None);
    }

    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|e| format!("Failed to inspect thumbnail path: {}", e))?;
    if !metadata.is_file() {
        return Ok(None);
    }

    if !candidate
        .extension()
        .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("webp"))
    {
        return Ok(None);
    }

    let canonical_file =
        fs::canonicalize(&candidate).map_err(|e| format!("Failed to resolve thumbnail: {}", e))?;
    let canonical_dir = match fs::canonicalize(thumbnail_dir) {
        Ok(dir) => dir,
        Err(_) => return Ok(None),
    };

    if canonical_file.parent() == Some(canonical_dir.as_path()) {
        Ok(Some(canonical_file))
    } else {
        Ok(None)
    }
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

fn normalize_path_string(path: &str) -> String {
    path.trim().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{
        get_invoke_db_snapshot, path_is_known_media_file, resolve_eligible_thumbnail_file,
        resolve_invoke_db_path, validate_library_scope_directory,
    };
    use rusqlite::Connection;
    use std::fs;
    use std::path::{Path, PathBuf};
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

    #[test]
    fn library_scope_requires_existing_non_root_directory() {
        let temp_root = temp_dir("library_scope");
        let library_dir = temp_root.join("library");
        let file_path = temp_root.join("file.txt");
        fs::create_dir_all(&library_dir).unwrap();
        fs::write(&file_path, b"not a directory").unwrap();

        assert_eq!(
            validate_library_scope_directory(&library_dir.to_string_lossy()).unwrap(),
            fs::canonicalize(&library_dir).unwrap()
        );
        assert!(validate_library_scope_directory("").is_err());
        assert!(validate_library_scope_directory(&file_path.to_string_lossy()).is_err());
        assert!(
            validate_library_scope_directory(&temp_root.join("missing").to_string_lossy()).is_err()
        );

        let filesystem_root = temp_root.ancestors().last().unwrap();
        assert!(validate_library_scope_directory(&filesystem_root.to_string_lossy()).is_err());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn known_media_file_matches_images_and_removed_images_only() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE images (id TEXT, path TEXT)", [])
            .unwrap();
        conn.execute("CREATE TABLE removed_images (id TEXT, path TEXT)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO images (id, path) VALUES (?1, ?1)",
            ["C:/library/kept.png"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path) VALUES (?1, ?1)",
            ["C:/library/removed.png"],
        )
        .unwrap();

        assert!(path_is_known_media_file(
            &conn,
            "C:\\library\\kept.png",
            Path::new("C:/other/alias.png")
        )
        .unwrap());
        assert!(path_is_known_media_file(
            &conn,
            "C:/library/removed.png",
            Path::new("C:/other/alias.png")
        )
        .unwrap());
        assert!(!path_is_known_media_file(
            &conn,
            "C:/library/untracked.png",
            Path::new("C:/library/untracked.png")
        )
        .unwrap());
    }

    #[test]
    fn thumbnail_delete_only_allows_direct_app_webp_thumbnails() {
        let app_data = temp_dir("thumbnail_scope");
        let thumbnail_dir = app_data.join(".thumbnails");
        let nested_dir = thumbnail_dir.join("nested");
        let external_dir = app_data.join("external");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::create_dir_all(&external_dir).unwrap();

        let valid = thumbnail_dir.join("thumb.webp");
        let nested = nested_dir.join("thumb.webp");
        let wrong_ext = thumbnail_dir.join("thumb.png");
        let external = external_dir.join("thumb.webp");
        fs::write(&valid, b"webp").unwrap();
        fs::write(&nested, b"webp").unwrap();
        fs::write(&wrong_ext, b"png").unwrap();
        fs::write(&external, b"webp").unwrap();

        assert_eq!(
            resolve_eligible_thumbnail_file(&valid.to_string_lossy(), &thumbnail_dir).unwrap(),
            Some(fs::canonicalize(&valid).unwrap())
        );
        assert_eq!(
            resolve_eligible_thumbnail_file(&nested.to_string_lossy(), &thumbnail_dir).unwrap(),
            None
        );
        assert_eq!(
            resolve_eligible_thumbnail_file(&wrong_ext.to_string_lossy(), &thumbnail_dir).unwrap(),
            None
        );
        assert_eq!(
            resolve_eligible_thumbnail_file(&external.to_string_lossy(), &thumbnail_dir).unwrap(),
            None
        );
        assert_eq!(
            resolve_eligible_thumbnail_file(
                &thumbnail_dir.join("missing.webp").to_string_lossy(),
                &thumbnail_dir
            )
            .unwrap(),
            None
        );

        let _ = fs::remove_dir_all(app_data);
    }

    fn normalize(path: PathBuf) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ambit_fs_commands_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
