use std::path::PathBuf;

use crate::db::{resolve_db_path, configure_connection};
use std::fs;
use chrono::{DateTime, Local};

const BACKUP_RETENTION_COUNT: usize = 5;

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
    let parent = db_path.parent().ok_or("Failed to get DB parent directory")?;
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
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn backup_database(app: tauri::AppHandle) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let backup_dir = resolve_backup_dir(&app)?;
        
        let now = Local::now();
        let filename = format!("images_{}.db", now.format("%Y-%m-%d_%H-%M-%S"));
        let backup_path = backup_dir.join(&filename);
        
        // Use Rusqlite to perform VACUUM INTO
        {
            let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
            configure_connection(&conn).map_err(|e| e.to_string())?;
            
            // VACUUM INTO 'path/to/backup.db'
            // Only works in SQLite 3.27.0+ (Rusqlite bundled is usually newer)
            let sql = format!("VACUUM INTO '{}'", backup_path.to_string_lossy());
            conn.execute(&sql, []).map_err(|e| e.to_string())?;
        }
        
        // Prune old backups after successful creation
        if let Ok(backups) = list_backups_internal(&backup_dir) {
            if backups.len() > BACKUP_RETENTION_COUNT {
                let to_remove = &backups[BACKUP_RETENTION_COUNT..];
                for backup in to_remove {
                    let _ = fs::remove_file(&backup.path);
                }
            }
        }
        
        // Return info about the new backup
        let metadata = fs::metadata(&backup_path).map_err(|e| e.to_string())?;
        
        Ok(BackupInfo {
            name: filename,
            path: backup_path.to_string_lossy().to_string(),
            created_at: now.to_rfc3339(),
            size_bytes: metadata.len(),
        })
    }).await.map_err(|e| e.to_string())?
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
             let now = Local::now();
             let filename = format!("images_{}.db", now.format("%Y-%m-%d_%H-%M-%S"));
             let backup_path = backup_dir.join(&filename);
             
             {
                let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
                configure_connection(&conn).map_err(|e| e.to_string())?;
                let sql = format!("VACUUM INTO '{}'", backup_path.to_string_lossy());
                conn.execute(&sql, []).map_err(|e| e.to_string())?;
             }
             
             // Prune
             // Re-list to include new one and sort
             if let Ok(updated_backups) = list_backups_internal(&backup_dir) {
                 if updated_backups.len() > BACKUP_RETENTION_COUNT {
                    for backup in &updated_backups[BACKUP_RETENTION_COUNT..] {
                        let _ = fs::remove_file(&backup.path);
                    }
                 }
             }
             
             let metadata = fs::metadata(&backup_path).map_err(|e| e.to_string())?;
             Ok(Some(BackupInfo {
                name: filename,
                path: backup_path.to_string_lossy().to_string(),
                created_at: now.to_rfc3339(),
                size_bytes: metadata.len(),
            }))
        } else {
            Ok(None)
        }
   }).await.map_err(|e| e.to_string())?
}
