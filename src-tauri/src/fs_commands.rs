use crate::db::commands::maintenance::lock_removed_lifecycle;
use crate::db::{configure_connection, resolve_db_path};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{Manager, Wry};

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

#[derive(serde::Serialize, specta::Type, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRemovedImagesResult {
    pub cleared_ids: Vec<String>,
    pub trashed_ids: Vec<String>,
    pub already_missing_ids: Vec<String>,
    pub failed_ids: Vec<String>,
    pub cleanup_pending_ids: Vec<String>,
    pub thumbnail_warning_ids: Vec<String>,
    pub not_found_ids: Vec<String>,
}

fn app_local_data_dir(app: &tauri::AppHandle<Wry>) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data directory: {}", e))
}

/// Refuses a library-file deletion inside AppLocalData. No library file lives
/// there, only Ambit's own state, such as the grant registry, which a forged
/// database row must not be able to delete (#392).
fn refuse_app_data_file(canonical_file: &Path, app_local_data: &Path) -> Result<(), String> {
    let own = fs::canonicalize(app_local_data).unwrap_or_else(|_| app_local_data.to_path_buf());
    if canonical_file.starts_with(&own) {
        return Err("Refusing to move Ambit's own data to trash".to_string());
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn move_to_trash(app: tauri::AppHandle<Wry>, path: String) -> Result<(), String> {
    let canonical_file = resolve_existing_regular_file(&path)?;
    refuse_app_data_file(&canonical_file, &app_local_data_dir(&app)?)?;
    let conn = open_configured_app_db(&app)?;

    if !path_is_known_media_file(&conn, &path, &canonical_file)? {
        return Err("Refusing to move an untracked file to trash".to_string());
    }

    trash::delete(&canonical_file).map_err(|e| format!("Failed to move to trash: {}", e))
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn delete_removed_images_from_disk(
    app: tauri::AppHandle<Wry>,
    ids: Vec<String>,
) -> Result<DeleteRemovedImagesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_configured_app_db(&app)?;
        let app_local_data = app_local_data_dir(&app)?;
        let thumbnail_dir = app_local_data.join(".thumbnails");

        delete_removed_images_with(&mut conn, &thumbnail_dir, &app_local_data, &ids, |path| {
            trash::delete(path).map_err(|error| format!("Failed to move to trash: {}", error))
        })
    })
    .await
    .map_err(|error| format!("Removed-file deletion task failed: {}", error))?
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

/// Makes a folder the webview names readable, but only when the user already
/// granted it or a folder around it, and records nothing (#392). Any other
/// folder is refused.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn register_library_path(app: tauri::AppHandle<Wry>, path: String) -> Result<(), String> {
    crate::library_grants::grant_folder_inside_grants(app, path).await
}

/// Adds an existing, non-root folder and everything inside it to the
/// asset-protocol scope, and returns the folder resolved.
pub(crate) fn grant_library_directory(
    app: &tauri::AppHandle<Wry>,
    path: &str,
) -> Result<PathBuf, String> {
    let path_buf = validate_library_scope_directory(path)?;
    grant_directory_scope(app, &path_buf)?;
    Ok(path_buf)
}

/// Adds a folder already resolved and checked by the caller, and everything
/// inside it, to the asset-protocol scope, so the webview can display it.
///
/// Never the fs plugin's scope (#415): the plugin admits a webview call when either
/// that scope or the capability allows the path, so a library folder there would
/// be writable and removable by the webview. Backend commands check the grant
/// registry instead ([`crate::library_grants::LibraryAccess`]).
pub(crate) fn grant_directory_scope<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    folder: &Path,
) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(folder, true)
        .map_err(|e| format!("Failed to add to Asset Protocol scope: {}", e))?;
    Ok(())
}

/// Adds one existing regular file to the asset-protocol scope, and not the fs
/// plugin's scope; see [`grant_directory_scope`]. Returns the file as resolved.
pub(crate) fn grant_library_file<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
) -> Result<PathBuf, String> {
    let file = resolve_existing_regular_file(path)?;
    app.asset_protocol_scope()
        .allow_file(&file)
        .map_err(|e| format!("Failed to add to Asset Protocol scope: {}", e))?;
    Ok(file)
}

pub(crate) fn validate_library_scope_directory(path: &str) -> Result<PathBuf, String> {
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

/// A library file's bytes, sent to the webview as an `ArrayBuffer` rather than as
/// a JSON array of numbers. The bindings type it `unknown`; the frontend wrapper
/// reads it as an `ArrayBuffer`.
pub struct LibraryFileBytes(Vec<u8>);

impl tauri::ipc::IpcResponse for LibraryFileBytes {
    fn body(self) -> tauri::Result<tauri::ipc::InvokeResponseBody> {
        Ok(tauri::ipc::InvokeResponseBody::Raw(self.0))
    }
}

impl specta::Type for LibraryFileBytes {
    fn inline(_: &mut specta::TypeCollection, _: specta::Generics) -> specta::DataType {
        specta::DataType::Unknown
    }
}

/// Reads a library original for the webview, for ZIP export and prompt recovery.
/// The webview cannot read library folders through the fs plugin (#415), so this
/// reads a regular file only when the user granted it or a folder around it:
/// what the asset protocol already shows.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn read_library_file(
    app: tauri::AppHandle<Wry>,
    path: String,
) -> Result<LibraryFileBytes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_library_file_in_scope(&path, crate::library_grants::LibraryAccess::checker(&app))
            .map(LibraryFileBytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_library_file_in_scope(
    path: &str,
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<Vec<u8>, String> {
    let file = resolve_existing_regular_file(path)?;
    if !is_allowed(&file) {
        return Err("The file is outside the folders and files granted to Ambit".to_string());
    }
    fs::read(&file).map_err(|e| format!("Failed to read file: {e}"))
}

/// Whether each path exists, for the webview's checks on library files (video
/// sidecars, InvokeAI's own thumbnails). A path outside the grants, or empty,
/// reports `None`: unknown, so a caller does not treat it as missing and, for
/// example, reset the thumbnail of every image in a folder it may not read.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn library_paths_exist(
    app: tauri::AppHandle<Wry>,
    paths: Vec<String>,
) -> Result<Vec<Option<bool>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(library_paths_exist_in_scope(
            &paths,
            crate::library_grants::LibraryAccess::checker(&app),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn library_paths_exist_in_scope(
    paths: &[String],
    is_allowed: impl Fn(&Path) -> bool,
) -> Vec<Option<bool>> {
    paths
        .iter()
        .map(|path| {
            let path = Path::new(path.trim());
            (!path.as_os_str().is_empty() && is_allowed(path)).then(|| path.exists())
        })
        .collect()
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
                SELECT 1 FROM scoped_images
                WHERE invoke_scope_hidden = 0
                  AND (id IN (?1, ?2) OR path IN (?1, ?2))
                UNION ALL
                SELECT 1 FROM scoped_removed_images
                WHERE invoke_scope_hidden = 0
                  AND (id IN (?1, ?2) OR path IN (?1, ?2))
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
pub fn get_invoke_db_snapshot(
    app: tauri::AppHandle<Wry>,
    root_path: String,
) -> Result<InvokeDbSnapshot, String> {
    invoke_db_snapshot_in_scope(
        &root_path,
        crate::library_grants::LibraryAccess::checker(&app),
    )
}

/// Reports InvokeAI's database files only when the resolved `invokeai.db` is
/// inside the registered filesystem scope, as `select_invoke_source` requires.
fn invoke_db_snapshot_in_scope<F>(
    root_path: &str,
    mut is_allowed: F,
) -> Result<InvokeDbSnapshot, String>
where
    F: FnMut(&Path) -> bool,
{
    let db_path = resolve_invoke_db_path(root_path);
    if root_path.trim().is_empty() || !db_path.is_absolute() || !is_allowed(&db_path) {
        return Err(format!(
            "InvokeAI database is outside the allowed filesystem scope: {}",
            db_path.to_string_lossy()
        ));
    }
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

pub(crate) fn resolve_invoke_db_path(root_path: &str) -> PathBuf {
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

fn delete_removed_images_with<F>(
    conn: &mut Connection,
    thumbnail_dir: &Path,
    app_local_data: &Path,
    ids: &[String],
    mut trash_file: F,
) -> Result<DeleteRemovedImagesResult, String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    // Keep the tombstone stable while its source is inspected, trashed, and cleared.
    // Otherwise a concurrent restore could recreate an active row before this finishes.
    let _lifecycle_guard = lock_removed_lifecycle();
    let normalized_ids = ids
        .iter()
        .map(|id| normalize_path_string(id))
        .filter(|id| !id.is_empty())
        .fold(
            (Vec::new(), HashSet::new()),
            |(mut ordered, mut seen), id| {
                if seen.insert(id.clone()) {
                    ordered.push(id);
                }
                (ordered, seen)
            },
        )
        .0;
    if normalized_ids.is_empty() {
        return Ok(DeleteRemovedImagesResult::default());
    }

    let mut rows = Vec::new();
    {
        let mut statement = conn
            .prepare(
                "SELECT id, path, thumbnail_path
                 FROM scoped_removed_images
                 WHERE invoke_scope_hidden = 0 AND id = ?1",
            )
            .map_err(|error| error.to_string())?;
        for id in &normalized_ids {
            let row = statement.query_row([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            });
            match row {
                Ok(row) => rows.push(row),
                Err(rusqlite::Error::QueryReturnedNoRows) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    let found_ids = rows
        .iter()
        .map(|(id, _, _)| id.as_str())
        .collect::<HashSet<_>>();
    let mut result = DeleteRemovedImagesResult {
        not_found_ids: normalized_ids
            .iter()
            .filter(|id| !found_ids.contains(id.as_str()))
            .cloned()
            .collect(),
        ..DeleteRemovedImagesResult::default()
    };

    for (id, source_path, thumbnail_path) in rows {
        let source = PathBuf::from(&source_path);
        match fs::symlink_metadata(&source) {
            Ok(metadata) if metadata.is_file() => {
                let canonical_source = match fs::canonicalize(&source) {
                    Ok(path) => path,
                    Err(error) => {
                        log::error!(
                            "[Removed] Failed to resolve source before trashing {}: {}",
                            source_path,
                            error
                        );
                        result.failed_ids.push(id);
                        continue;
                    }
                };
                if let Err(error) = refuse_app_data_file(&canonical_source, app_local_data) {
                    log::error!("[Removed] {}: {}", error, source_path);
                    result.failed_ids.push(id);
                    continue;
                }
                if let Err(error) = trash_file(&canonical_source) {
                    log::error!(
                        "[Removed] Failed to move source to trash {}: {}",
                        source_path,
                        error
                    );
                    result.failed_ids.push(id);
                    continue;
                }
                result.trashed_ids.push(id.clone());
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                result.already_missing_ids.push(id.clone());
            }
            Ok(_) => {
                log::error!("[Removed] Source is not a regular file: {}", source_path);
                result.failed_ids.push(id);
                continue;
            }
            Err(error) => {
                log::error!(
                    "[Removed] Failed to inspect source {}: {}",
                    source_path,
                    error
                );
                result.failed_ids.push(id);
                continue;
            }
        }

        if let Some(thumbnail_path) = thumbnail_path {
            match resolve_eligible_thumbnail_file(&thumbnail_path, thumbnail_dir) {
                Ok(Some(thumbnail)) => {
                    if let Err(error) = trash_file(&thumbnail) {
                        log::warn!(
                            "[Removed] Failed to move thumbnail to trash {}: {}",
                            thumbnail_path,
                            error
                        );
                        result.thumbnail_warning_ids.push(id.clone());
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!(
                        "[Removed] Failed to inspect thumbnail {}: {}",
                        thumbnail_path,
                        error
                    );
                    result.thumbnail_warning_ids.push(id.clone());
                }
            }
        }

        let cleanup = (|| -> Result<(), String> {
            let tx = conn.transaction().map_err(|error| error.to_string())?;
            tx.execute(
                "UPDATE collections
                 SET custom_thumbnail = NULL,
                     dynamic_thumbnail_path = NULL,
                     dynamic_safe_thumbnail_path = NULL,
                     dynamic_thumbnail_is_sensitive = NULL,
                     dynamic_thumbnail_cached_at = NULL
                 WHERE custom_thumbnail = ?1 OR custom_thumbnail = ?2",
                params![id, source_path],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM invoke_board_membership_additions WHERE image_id = ?1",
                [&id],
            )
            .map_err(|error| error.to_string())?;
            let deleted = tx
                .execute(
                    "DELETE FROM removed_images
                     WHERE id IN (
                         SELECT id FROM scoped_removed_images
                         WHERE id = ?1 AND invoke_scope_hidden = 0
                     )",
                    [&id],
                )
                .map_err(|error| error.to_string())?;
            if deleted != 1 {
                return Err("Removed entry changed before cleanup completed".to_string());
            }
            tx.commit().map_err(|error| error.to_string())
        })();
        match cleanup {
            Ok(()) => result.cleared_ids.push(id),
            Err(error) => {
                log::error!(
                    "[Removed] Database cleanup remains pending for {}: {}",
                    id,
                    error
                );
                result.cleanup_pending_ids.push(id);
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{
        delete_removed_images_with, invoke_db_snapshot_in_scope, library_paths_exist_in_scope,
        path_is_known_media_file, read_library_file_in_scope, refuse_app_data_file,
        resolve_eligible_thumbnail_file, resolve_invoke_db_path, validate_library_scope_directory,
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

        let snapshot = invoke_db_snapshot_in_scope(&temp_root.to_string_lossy(), |_| true).unwrap();

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

    // #384: the snapshot reports a database's size and modification time, so it
    // must not describe a database the user never put in scope.
    #[test]
    fn snapshot_refuses_a_database_outside_the_registered_scope() {
        let temp_root = temp_dir("invoke_snapshot_scope");
        let databases_dir = temp_root.join("databases");
        fs::create_dir_all(&databases_dir).unwrap();
        let db_path = databases_dir.join("invokeai.db");
        fs::write(&db_path, b"test").unwrap();
        let mut checked = Vec::new();

        let refused = invoke_db_snapshot_in_scope(&temp_root.to_string_lossy(), |path| {
            checked.push(path.to_path_buf());
            false
        });

        assert!(refused
            .unwrap_err()
            .starts_with("InvokeAI database is outside the allowed filesystem scope"));
        assert_eq!(checked, vec![db_path]);
        assert!(invoke_db_snapshot_in_scope("  ", |_| true).is_err());
        assert!(invoke_db_snapshot_in_scope("relative/invoke", |_| true).is_err());
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
        conn.execute(
            "CREATE TABLE images (id TEXT, path TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0)",
            [],
        )
            .unwrap();
        conn.execute(
            "CREATE TABLE removed_images (id TEXT, path TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0)",
            [],
        )
            .unwrap();
        conn.execute_batch(
            "CREATE VIEW scoped_images AS
                 SELECT * FROM images WHERE invoke_scope_hidden = 0;
             CREATE VIEW scoped_removed_images AS
                 SELECT * FROM removed_images WHERE invoke_scope_hidden = 0;",
        )
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
        conn.execute(
            "INSERT INTO images (id, path, invoke_scope_hidden) VALUES (?1, ?1, 1)",
            ["C:/library/owner-hidden.png"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path, invoke_scope_hidden) VALUES (?1, ?1, 1)",
            ["C:/library/removed-owner-hidden.png"],
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
        assert!(!path_is_known_media_file(
            &conn,
            "C:/library/owner-hidden.png",
            Path::new("C:/library/owner-hidden.png")
        )
        .unwrap());
        assert!(!path_is_known_media_file(
            &conn,
            "C:/library/removed-owner-hidden.png",
            Path::new("C:/library/removed-owner-hidden.png")
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

    #[test]
    fn removed_delete_trashes_files_and_clears_visible_tombstones() {
        let root = temp_dir("removed_delete_success");
        let thumbnail_dir = root.join(".thumbnails");
        fs::create_dir_all(&thumbnail_dir).unwrap();
        let source = root.join("source.png");
        let thumbnail = thumbnail_dir.join("source.webp");
        fs::write(&source, b"source").unwrap();
        fs::write(&thumbnail, b"thumbnail").unwrap();
        let mut conn = removed_images_connection();
        insert_removed_image(
            &conn,
            "C:/normalized/source.png",
            &source,
            Some(&thumbnail),
            false,
        );
        conn.execute(
            "INSERT INTO invoke_board_membership_additions (collection_id, image_id)
             VALUES ('invoke-board', 'C:/normalized/source.png')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collections (
                id, custom_thumbnail, dynamic_thumbnail_path,
                dynamic_safe_thumbnail_path, dynamic_thumbnail_is_sensitive,
                dynamic_thumbnail_cached_at
             ) VALUES ('custom', 'C:/normalized/source.png', 'stale.webp', 'safe.webp', 1, 123)",
            [],
        )
        .unwrap();

        let result = delete_removed_images_with(
            &mut conn,
            &thumbnail_dir,
            Path::new("/no-app-local-data"),
            &["C:\\normalized\\source.png".to_string()],
            |path| fs::remove_file(path).map_err(|error| error.to_string()),
        )
        .unwrap();

        assert_eq!(result.cleared_ids, ["C:/normalized/source.png"]);
        assert_eq!(result.trashed_ids, ["C:/normalized/source.png"]);
        assert!(result.failed_ids.is_empty());
        assert!(!source.exists());
        assert!(!thumbnail.exists());
        assert_eq!(removed_image_count(&conn), 0);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM invoke_board_membership_additions",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
        let collection_thumbnail = conn
            .query_row(
                "SELECT custom_thumbnail, dynamic_thumbnail_path
                 FROM collections WHERE id = 'custom'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(collection_thumbnail, (None, None));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removed_delete_clears_an_explicit_tombstone_when_source_is_already_missing() {
        let root = temp_dir("removed_delete_missing");
        let mut conn = removed_images_connection();
        let missing = root.join("already-gone.png");
        insert_removed_image(&conn, "missing", &missing, None, false);

        let result = delete_removed_images_with(
            &mut conn,
            &root.join(".thumbnails"),
            Path::new("/no-app-local-data"),
            &["missing".to_string()],
            |_| panic!("missing files must not be sent to trash"),
        )
        .unwrap();

        assert_eq!(result.cleared_ids, ["missing"]);
        assert_eq!(result.already_missing_ids, ["missing"]);
        assert_eq!(removed_image_count(&conn), 0);
    }

    // #392: the webview can insert database rows, so a row naming the grant registry
    // must not let it delete the registry and have it reseeded from settings.
    #[test]
    fn removed_delete_and_trash_refuse_files_inside_app_local_data() {
        let root = temp_dir("removed_delete_app_data");
        let app_local_data = root.join("AppLocalData");
        fs::create_dir_all(&app_local_data).unwrap();
        let registry = app_local_data.join(crate::library_grants::REGISTRY_FILE_NAME);
        fs::write(&registry, "{}").unwrap();
        let mut conn = removed_images_connection();
        insert_removed_image(&conn, "registry", &registry, None, false);

        let result = delete_removed_images_with(
            &mut conn,
            &root.join(".thumbnails"),
            &app_local_data,
            &["registry".to_string()],
            |_| panic!("a file inside AppLocalData must not be sent to trash"),
        )
        .unwrap();

        assert_eq!(result.failed_ids, ["registry"]);
        assert!(registry.exists());
        let canonical = fs::canonicalize(&registry).unwrap();
        assert!(refuse_app_data_file(&canonical, &app_local_data).is_err());
        let library_file = root.join("image.png");
        fs::write(&library_file, b"image").unwrap();
        assert!(
            refuse_app_data_file(&fs::canonicalize(&library_file).unwrap(), &app_local_data)
                .is_ok()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removed_delete_preserves_tombstone_when_source_trash_fails() {
        let root = temp_dir("removed_delete_trash_failure");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        fs::write(&source, b"source").unwrap();
        let mut conn = removed_images_connection();
        insert_removed_image(&conn, "source", &source, None, false);
        conn.execute(
            "INSERT INTO invoke_board_membership_additions (collection_id, image_id)
             VALUES ('invoke-board', 'source')",
            [],
        )
        .unwrap();

        let result = delete_removed_images_with(
            &mut conn,
            &root.join(".thumbnails"),
            Path::new("/no-app-local-data"),
            &["source".to_string()],
            |_| Err("trash unavailable".to_string()),
        )
        .unwrap();

        assert_eq!(result.failed_ids, ["source"]);
        assert!(result.cleared_ids.is_empty());
        assert_eq!(removed_image_count(&conn), 1);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM invoke_board_membership_additions",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
        assert!(source.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removed_delete_reports_cleanup_pending_and_succeeds_on_missing_file_retry() {
        let root = temp_dir("removed_delete_cleanup_retry");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        fs::write(&source, b"source").unwrap();
        let mut conn = removed_images_connection();
        insert_removed_image(&conn, "source", &source, None, false);
        conn.execute(
            "INSERT INTO invoke_board_membership_additions (collection_id, image_id)
             VALUES ('invoke-board', 'source')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collections (id, custom_thumbnail) VALUES ('custom', 'source')",
            [],
        )
        .unwrap();
        conn.execute_batch(
            "CREATE TRIGGER block_removed_delete BEFORE DELETE ON removed_images
             BEGIN SELECT RAISE(ABORT, 'cleanup blocked'); END;",
        )
        .unwrap();

        let first = delete_removed_images_with(
            &mut conn,
            &root.join(".thumbnails"),
            Path::new("/no-app-local-data"),
            &["source".to_string()],
            |path| fs::remove_file(path).map_err(|error| error.to_string()),
        )
        .unwrap();
        assert_eq!(first.cleanup_pending_ids, ["source"]);
        assert_eq!(removed_image_count(&conn), 1);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM invoke_board_membership_additions",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row(
                "SELECT custom_thumbnail FROM collections WHERE id = 'custom'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap(),
            Some("source".to_string())
        );
        assert!(!source.exists());

        conn.execute_batch("DROP TRIGGER block_removed_delete;")
            .unwrap();
        let retry = delete_removed_images_with(
            &mut conn,
            &root.join(".thumbnails"),
            Path::new("/no-app-local-data"),
            &["source".to_string()],
            |_| panic!("the retry source is already missing"),
        )
        .unwrap();
        assert_eq!(retry.already_missing_ids, ["source"]);
        assert_eq!(retry.cleared_ids, ["source"]);
        assert_eq!(removed_image_count(&conn), 0);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM invoke_board_membership_additions",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row(
                "SELECT custom_thumbnail FROM collections WHERE id = 'custom'",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap(),
            None
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removed_delete_rejects_hidden_and_unknown_rows() {
        let root = temp_dir("removed_delete_visibility");
        let mut conn = removed_images_connection();
        insert_removed_image(&conn, "hidden", &root.join("hidden.png"), None, true);

        let result = delete_removed_images_with(
            &mut conn,
            &root.join(".thumbnails"),
            Path::new("/no-app-local-data"),
            &["hidden".to_string(), "unknown".to_string()],
            |_| panic!("invisible rows must never reach filesystem deletion"),
        )
        .unwrap();

        assert_eq!(result.not_found_ids, ["hidden", "unknown"]);
        assert_eq!(removed_image_count(&conn), 1);
    }

    fn removed_images_connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                thumbnail_path TEXT,
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE collections (
                id TEXT PRIMARY KEY,
                custom_thumbnail TEXT,
                dynamic_thumbnail_path TEXT,
                dynamic_safe_thumbnail_path TEXT,
                dynamic_thumbnail_is_sensitive INTEGER,
                dynamic_thumbnail_cached_at INTEGER
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE invoke_board_membership_additions (
                collection_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                PRIMARY KEY (collection_id, image_id)
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE VIEW scoped_removed_images AS
                 SELECT * FROM removed_images WHERE invoke_scope_hidden = 0",
            [],
        )
        .unwrap();
        conn
    }

    fn insert_removed_image(
        conn: &Connection,
        id: &str,
        path: &Path,
        thumbnail_path: Option<&Path>,
        hidden: bool,
    ) {
        conn.execute(
            "INSERT INTO removed_images (id, path, thumbnail_path, invoke_scope_hidden)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                id,
                path.to_string_lossy(),
                thumbnail_path.map(|path| path.to_string_lossy().to_string()),
                i64::from(hidden)
            ],
        )
        .unwrap();
    }

    fn removed_image_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM removed_images", [], |row| row.get(0))
            .unwrap()
    }

    fn normalize(path: PathBuf) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    // #415: the webview reads library originals (ZIP export, prompt recovery)
    // through this instead of the fs plugin. It must read only what was granted.
    #[test]
    fn read_library_file_reads_only_granted_regular_files() {
        let root = temp_dir("read_library_file");
        let granted = root.join("granted");
        let outside = root.join("outside");
        fs::create_dir_all(&granted).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(granted.join("image.png"), b"inside").unwrap();
        fs::write(outside.join("secret.png"), b"outside").unwrap();
        let granted_key = fs::canonicalize(&granted).unwrap();
        let is_allowed = |path: &Path| path.starts_with(&granted_key);
        let spelled = |path: PathBuf| path.to_string_lossy().into_owned();

        assert_eq!(
            read_library_file_in_scope(&spelled(granted.join("image.png")), is_allowed),
            Ok(b"inside".to_vec())
        );
        assert!(
            read_library_file_in_scope(&spelled(outside.join("secret.png")), is_allowed).is_err()
        );
        assert!(read_library_file_in_scope(
            &spelled(granted.join("..").join("outside").join("secret.png")),
            is_allowed
        )
        .is_err());
        assert!(read_library_file_in_scope(&spelled(granted.clone()), is_allowed).is_err());

        let _ = fs::remove_dir_all(root);
    }

    // #415: the webview's existence checks on library files (video sidecars,
    // InvokeAI's own thumbnails). Outside the grants the answer is unknown, never
    // "missing", so nothing is reset for a file Ambit may not read.
    #[test]
    fn library_paths_exist_reports_nothing_outside_the_grants() {
        let root = temp_dir("library_paths_exist");
        let granted = root.join("granted");
        let outside = root.join("outside");
        fs::create_dir_all(&granted).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(granted.join("clip.json"), b"{}").unwrap();
        fs::write(outside.join("clip.json"), b"{}").unwrap();
        let is_allowed = |path: &Path| path.starts_with(&granted);
        let paths = [
            granted.join("clip.json"),
            granted.join("missing.json"),
            outside.join("clip.json"),
        ]
        .map(|path| path.to_string_lossy().into_owned());

        assert_eq!(
            library_paths_exist_in_scope(&paths, is_allowed),
            vec![Some(true), Some(false), None]
        );
        assert_eq!(
            library_paths_exist_in_scope(&[" ".to_string()], |_| true),
            vec![None]
        );

        let _ = fs::remove_dir_all(root);
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
