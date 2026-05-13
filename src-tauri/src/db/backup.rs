use std::path::{Path, PathBuf};

use crate::db::{configure_connection, resolve_db_path};
use chrono::{DateTime, Local};
use rusqlite::params;
use std::fs;
use std::io::ErrorKind;

const BACKUP_RETENTION_COUNT: usize = 3;

#[derive(serde::Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub size_bytes: u64,
}

/// Helper to get the backups directory.
/// Ensures the directory exists.
fn resolve_backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let db_path = resolve_db_path(app)?;
    let parent = db_path
        .parent()
        .ok_or("Failed to get DB parent directory")?;
    let backup_dir = parent.join("backups");

    if !backup_dir.exists() {
        fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    }

    Ok(backup_dir)
}

/// Helper to list backups sorted by date (newest first).
fn list_backups_internal(backup_dir: &PathBuf) -> Result<Vec<BackupInfo>, String> {
    let mut backups = Vec::new();

    let entries = fs::read_dir(backup_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_file() && path.extension().map_or(false, |ext| ext == "db") {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let created = metadata.created().unwrap_or(std::time::SystemTime::now());
            let created_datetime: DateTime<Local> = created.into();

            backups.push(BackupInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                created_at: created_datetime.to_rfc3339(),
                size_bytes: metadata.len(),
            });
        }
    }

    // Sort by created date descending
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(backups)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let backup_dir = resolve_backup_dir(&app)?;
        list_backups_internal(&backup_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn backup_database(app: tauri::AppHandle) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let backup_dir = resolve_backup_dir(&app)?;
        create_backup_internal(&db_path, &backup_dir, Local::now())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Check if we need to run an auto-backup (first run of the day).
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn check_and_run_autobackup(app: tauri::AppHandle) -> Result<Option<BackupInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let backup_dir = resolve_backup_dir(&app)?;
        let backups = list_backups_internal(&backup_dir)?;

        let should_backup = if let Some(latest) = backups.first() {
            // Check if latest is older than 24h
            if let Ok(created) = DateTime::parse_from_rfc3339(&latest.created_at) {
                let now = Local::now();
                let diff = now.signed_duration_since(created);
                diff.num_hours() >= 24
            } else {
                true // Parse error, ensure safety with new backup
            }
        } else {
            true // No backups exist
        };

        if should_backup {
            let db_path = resolve_db_path(&app)?;
            create_backup_internal(&db_path, &backup_dir, Local::now()).map(Some)
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn create_backup_internal(
    db_path: &Path,
    backup_dir: &Path,
    now: DateTime<Local>,
) -> Result<BackupInfo, String> {
    let (filename, backup_path) = resolve_unique_backup_path(backup_dir, &now)?;
    ensure_backup_path_stays_in_dir(backup_dir, &backup_path)?;
    vacuum_database_into(db_path, &backup_path)?;
    prune_old_backups(backup_dir);

    let metadata = fs::metadata(&backup_path).map_err(|e| e.to_string())?;

    Ok(BackupInfo {
        name: filename,
        path: backup_path.to_string_lossy().to_string(),
        created_at: now.to_rfc3339(),
        size_bytes: metadata.len(),
    })
}

fn resolve_unique_backup_path(
    backup_dir: &Path,
    now: &DateTime<Local>,
) -> Result<(String, PathBuf), String> {
    let timestamp = now.format("%Y-%m-%d_%H-%M-%S");

    for suffix in 0..10_000 {
        let filename = if suffix == 0 {
            format!("images_{}.db", timestamp)
        } else {
            format!("images_{}_{}.db", timestamp, suffix)
        };
        let backup_path = backup_dir.join(&filename);

        match fs::symlink_metadata(&backup_path) {
            Ok(_) => continue,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok((filename, backup_path))
            }
            Err(error) => {
                return Err(format!(
                    "Failed to inspect candidate backup path {}: {}",
                    backup_path.to_string_lossy(),
                    error
                ));
            }
        }
    }

    Err("Failed to find a unique backup filename".to_string())
}

fn ensure_backup_path_stays_in_dir(backup_dir: &Path, backup_path: &Path) -> Result<(), String> {
    let canonical_backup_dir =
        fs::canonicalize(backup_dir).map_err(|e| format!("Failed to resolve backup dir: {}", e))?;
    let backup_parent = backup_path
        .parent()
        .ok_or_else(|| "Backup path has no parent directory".to_string())?;
    let canonical_parent = fs::canonicalize(backup_parent)
        .map_err(|e| format!("Failed to resolve backup path parent: {}", e))?;

    if canonical_parent != canonical_backup_dir {
        return Err("Backup path escaped the backup directory".to_string());
    }

    Ok(())
}

fn vacuum_database_into(db_path: &Path, backup_path: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    configure_connection(&conn).map_err(|e| e.to_string())?;

    let backup_path = backup_path.to_string_lossy().to_string();
    conn.execute("VACUUM INTO ?1", params![backup_path])
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn prune_old_backups(backup_dir: &Path) {
    let Ok(backups) = list_backups_internal(&backup_dir.to_path_buf()) else {
        return;
    };

    if backups.len() <= BACKUP_RETENTION_COUNT {
        return;
    }

    for backup in &backups[BACKUP_RETENTION_COUNT..] {
        let _ = fs::remove_file(&backup.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_unique_backup_path, vacuum_database_into};
    use chrono::Local;
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn vacuum_backup_accepts_paths_with_quotes() {
        let temp_root = temp_dir("quoted_backup");
        let backup_dir = temp_root.join("backups with ' quote");
        fs::create_dir_all(&backup_dir).unwrap();
        let db_path = temp_root.join("source.db");
        let backup_path = backup_dir.join("images_quote's.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute("CREATE TABLE sample (value TEXT)", [])
                .unwrap();
            conn.execute("INSERT INTO sample (value) VALUES ('ok')", [])
                .unwrap();
        }

        vacuum_database_into(&db_path, &backup_path).unwrap();

        let backup_conn = Connection::open(&backup_path).unwrap();
        let value: String = backup_conn
            .query_row("SELECT value FROM sample", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "ok");

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn backup_filename_uses_suffix_when_timestamp_collides() {
        let temp_root = temp_dir("backup_collision");
        fs::create_dir_all(&temp_root).unwrap();
        let now = Local::now();
        let timestamp = now.format("%Y-%m-%d_%H-%M-%S");
        fs::write(
            temp_root.join(format!("images_{}.db", timestamp)),
            b"existing",
        )
        .unwrap();
        fs::write(
            temp_root.join(format!("images_{}_1.db", timestamp)),
            b"existing",
        )
        .unwrap();

        let (filename, path) = resolve_unique_backup_path(&temp_root, &now).unwrap();

        assert_eq!(filename, format!("images_{}_2.db", timestamp));
        assert_eq!(path, temp_root.join(&filename));

        let _ = fs::remove_dir_all(temp_root);
    }

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ambit_backup_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
