use crate::db::{configure_connection, resolve_db_path};
use rayon::prelude::*;
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};

pub fn verify_image_paths_impl(paths: Vec<String>) -> Vec<String> {
    paths
        .par_iter()
        .filter(|path| !Path::new(path).exists())
        .map(|path| path.clone())
        .collect()
}

pub fn get_file_sizes_bulk_impl(paths: Vec<String>) -> Vec<u64> {
    let mut sizes = Vec::with_capacity(paths.len());
    for path in paths {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        sizes.push(size);
    }
    sizes
}

pub fn open_file_impl(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    let conn = open_configured_app_db(app)?;
    let target = resolve_known_media_file_target(&conn, &path)?;
    open_file_path(&target)
}

pub fn show_in_folder_impl(app: &tauri::AppHandle, path: String) -> Result<(), String> {
    let backup_dir = resolve_backup_dir_path(app)?;
    let (canonical_file, is_backup_file) = resolve_existing_show_target(&path, &backup_dir)?;
    if is_backup_file {
        return show_path_in_folder(&canonical_file);
    }

    let conn = open_configured_app_db(app)?;
    let target = resolve_known_media_show_target(&conn, &path, canonical_file)?;
    show_path_in_folder(&target)
}

fn open_file_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn show_path_in_folder(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().ok_or("No parent directory")?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn resolve_known_media_file_target(conn: &Connection, path: &str) -> Result<PathBuf, String> {
    let canonical_file = resolve_existing_regular_file(path)?;
    if !path_is_known_media_file(conn, path, &canonical_file)? {
        return Err("Refusing to open an untracked file".to_string());
    }

    Ok(canonical_file)
}

fn resolve_existing_regular_file(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".to_string());
    }

    let candidate = PathBuf::from(trimmed);
    if is_filesystem_root(&candidate) {
        return Err("Refusing to open a filesystem root".to_string());
    }

    let metadata =
        fs::symlink_metadata(&candidate).map_err(|e| format!("Failed to inspect path: {}", e))?;
    if !metadata.is_file() {
        return Err("Path must be an existing regular file".to_string());
    }

    fs::canonicalize(candidate).map_err(|e| format!("Failed to resolve file path: {}", e))
}

fn is_filesystem_root(path: &Path) -> bool {
    path.parent().is_none()
}

fn open_configured_app_db(app: &tauri::AppHandle) -> Result<Connection, String> {
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

fn resolve_backup_dir_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let db_path = resolve_db_path(app)?;
    let parent = db_path
        .parent()
        .ok_or_else(|| "Failed to get DB parent directory".to_string())?;

    Ok(parent.join("backups"))
}

fn is_app_backup_file(path: &Path, backup_dir: &Path) -> Result<bool, String> {
    if !path
        .extension()
        .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("db"))
    {
        return Ok(false);
    }

    let canonical_file =
        fs::canonicalize(path).map_err(|e| format!("Failed to resolve backup path: {}", e))?;
    let canonical_dir = match fs::canonicalize(backup_dir) {
        Ok(dir) => dir,
        Err(_) => return Ok(false),
    };

    Ok(canonical_file.parent() == Some(canonical_dir.as_path()))
}

fn resolve_existing_show_target(path: &str, backup_dir: &Path) -> Result<(PathBuf, bool), String> {
    let canonical_file = resolve_existing_regular_file(path)?;
    let is_backup_file = is_app_backup_file(&canonical_file, backup_dir)?;

    Ok((canonical_file, is_backup_file))
}

fn resolve_known_media_show_target(
    conn: &Connection,
    path: &str,
    canonical_file: PathBuf,
) -> Result<PathBuf, String> {
    if path_is_known_media_file(conn, path, &canonical_file)? {
        return Ok(canonical_file);
    }

    Err("Refusing to reveal an untracked file".to_string())
}

#[cfg(test)]
fn resolve_show_in_folder_target(
    conn: &Connection,
    path: &str,
    backup_dir: &Path,
) -> Result<PathBuf, String> {
    let (canonical_file, is_backup_file) = resolve_existing_show_target(path, backup_dir)?;
    if is_backup_file {
        return Ok(canonical_file);
    }

    resolve_known_media_show_target(conn, path, canonical_file)
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
        resolve_existing_regular_file, resolve_existing_show_target,
        resolve_known_media_file_target, resolve_show_in_folder_target,
    };
    use rusqlite::Connection;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn os_open_media_targets_require_known_regular_files() {
        let temp_root = temp_dir("media_targets");
        fs::create_dir_all(&temp_root).unwrap();
        let image = temp_root.join("image.png");
        let removed = temp_root.join("removed.png");
        let untracked = temp_root.join("untracked.png");
        let directory = temp_root.join("directory");
        fs::write(&image, b"image").unwrap();
        fs::write(&removed, b"removed").unwrap();
        fs::write(&untracked, b"untracked").unwrap();
        fs::create_dir_all(&directory).unwrap();

        let conn = media_db();
        let image_path = normalize(&fs::canonicalize(&image).unwrap());
        let removed_path = normalize(&fs::canonicalize(&removed).unwrap());
        conn.execute(
            "INSERT INTO images (id, path) VALUES (?1, ?1)",
            [&image_path],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path) VALUES (?1, ?1)",
            [&removed_path],
        )
        .unwrap();

        assert_eq!(
            resolve_known_media_file_target(&conn, &image.to_string_lossy()).unwrap(),
            fs::canonicalize(&image).unwrap()
        );
        assert_eq!(
            resolve_known_media_file_target(&conn, &removed.to_string_lossy()).unwrap(),
            fs::canonicalize(&removed).unwrap()
        );
        assert!(resolve_known_media_file_target(&conn, &untracked.to_string_lossy()).is_err());
        assert!(resolve_known_media_file_target(&conn, &directory.to_string_lossy()).is_err());
        assert!(resolve_known_media_file_target(&conn, "").is_err());
        assert!(resolve_known_media_file_target(
            &conn,
            &temp_root.join("missing.png").to_string_lossy()
        )
        .is_err());

        let filesystem_root = temp_root.ancestors().last().unwrap();
        assert!(resolve_existing_regular_file(&filesystem_root.to_string_lossy()).is_err());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn show_in_folder_allows_known_media_and_direct_app_backups() {
        let temp_root = temp_dir("show_targets");
        let backup_dir = temp_root.join("backups");
        let external_dir = temp_root.join("external");
        let nested_dir = backup_dir.join("nested");
        fs::create_dir_all(&backup_dir).unwrap();
        fs::create_dir_all(&external_dir).unwrap();
        fs::create_dir_all(&nested_dir).unwrap();

        let image = temp_root.join("image.png");
        let removed = temp_root.join("removed.png");
        let backup = backup_dir.join("images.db");
        let external_backup = external_dir.join("images.db");
        let nested_backup = nested_dir.join("images.db");
        let wrong_ext_backup = backup_dir.join("images.sqlite");
        fs::write(&image, b"image").unwrap();
        fs::write(&removed, b"removed").unwrap();
        fs::write(&backup, b"backup").unwrap();
        fs::write(&external_backup, b"outside").unwrap();
        fs::write(&nested_backup, b"nested").unwrap();
        fs::write(&wrong_ext_backup, b"wrong ext").unwrap();

        let conn = media_db();
        let image_path = normalize(&fs::canonicalize(&image).unwrap());
        let removed_path = normalize(&fs::canonicalize(&removed).unwrap());
        conn.execute(
            "INSERT INTO images (id, path) VALUES (?1, ?1)",
            [&image_path],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO removed_images (id, path) VALUES (?1, ?1)",
            [&removed_path],
        )
        .unwrap();

        assert_eq!(
            resolve_show_in_folder_target(&conn, &image.to_string_lossy(), &backup_dir).unwrap(),
            fs::canonicalize(&image).unwrap()
        );
        assert_eq!(
            resolve_show_in_folder_target(&conn, &removed.to_string_lossy(), &backup_dir).unwrap(),
            fs::canonicalize(&removed).unwrap()
        );
        assert_eq!(
            resolve_show_in_folder_target(&conn, &backup.to_string_lossy(), &backup_dir).unwrap(),
            fs::canonicalize(&backup).unwrap()
        );
        assert!(resolve_show_in_folder_target(
            &conn,
            &external_backup.to_string_lossy(),
            &backup_dir
        )
        .is_err());
        assert!(resolve_show_in_folder_target(
            &conn,
            &nested_backup.to_string_lossy(),
            &backup_dir
        )
        .is_err());
        assert!(resolve_show_in_folder_target(
            &conn,
            &wrong_ext_backup.to_string_lossy(),
            &backup_dir
        )
        .is_err());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn direct_backup_show_target_resolves_without_media_db() {
        let temp_root = temp_dir("backup_without_db");
        let backup_dir = temp_root.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();
        let backup = backup_dir.join("images.db");
        fs::write(&backup, b"backup").unwrap();

        let (target, is_backup_file) =
            resolve_existing_show_target(&backup.to_string_lossy(), &backup_dir).unwrap();

        assert_eq!(target, fs::canonicalize(&backup).unwrap());
        assert!(is_backup_file);

        let _ = fs::remove_dir_all(temp_root);
    }

    fn media_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE images (id TEXT, path TEXT)", [])
            .unwrap();
        conn.execute("CREATE TABLE removed_images (id TEXT, path TEXT)", [])
            .unwrap();
        conn
    }

    fn normalize(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ambit_scanner_utils_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
