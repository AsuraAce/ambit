use super::run_blocking;
use crate::db::{resolve_db_path, resolve_db_path_info, resolve_main_database_url};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub struct FileHashBackfillState {
    pub is_cancelled: Arc<AtomicBool>,
}

impl Default for FileHashBackfillState {
    fn default() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DbDiagnostics {
    pub db_path: String,
    pub active_db_path: String,
    pub local_db_path: String,
    pub roaming_db_path: String,
    pub app_log_dir: String,
    pub app_log_path: String,
    pub is_using_roaming_fallback: bool,
    pub image_count: i64,
    pub deleted_count: i64,
    pub model_count: i64,
    pub cache_count: i64,
    pub tool_null_count: i64,
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FileHashBackfillResult {
    pub scanned: usize,
    pub updated: usize,
    pub missing: usize,
    pub errors: usize,
    pub remaining: usize,
    pub was_cancelled: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileHashBackfillProgress {
    current: usize,
    total: usize,
    message: String,
}

fn hash_file_sha256(path: &str) -> Result<String, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];

    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

fn resolve_app_log_path(log_dir: &Path, app_name: &str) -> PathBuf {
    log_dir.join(app_name).with_extension("log")
}

fn ensure_log_directory(log_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(log_dir).map_err(|e| format!("Failed to prepare app log folder: {}", e))
}

fn open_folder_path(path: &Path) -> Result<(), String> {
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

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn get_main_database_url(app: AppHandle) -> Result<String, String> {
    resolve_main_database_url(&app)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_db_diagnostics(app: AppHandle) -> Result<DbDiagnostics, String> {
    let app_clone = app.clone();
    run_blocking(app, move |conn| {
        let path_info = resolve_db_path_info(&app_clone)?;
        let db_path = path_info.active_path.clone();
        let app_log_dir = app_clone.path().app_log_dir().map_err(|e| e.to_string())?;
        let app_log_path = resolve_app_log_path(&app_log_dir, &app_clone.package_info().name);
        let image_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap_or(0);
        let deleted_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM images WHERE is_deleted = 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0))
            .unwrap_or(0);
        let cache_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM facet_cache", [], |r| r.get(0))
            .unwrap_or(0);
        let tool_null_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM images WHERE json_extract(metadata_json, '$.tool') IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        Ok(DbDiagnostics {
            db_path: db_path.to_string_lossy().to_string(),
            active_db_path: path_info.active_path.to_string_lossy().to_string(),
            local_db_path: path_info.local_path.to_string_lossy().to_string(),
            roaming_db_path: path_info.roaming_path.to_string_lossy().to_string(),
            app_log_dir: app_log_dir.to_string_lossy().to_string(),
            app_log_path: app_log_path.to_string_lossy().to_string(),
            is_using_roaming_fallback: path_info.is_using_roaming_fallback,
            image_count,
            deleted_count,
            model_count,
            cache_count,
            tool_null_count,
        })
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn show_app_log_folder(app: AppHandle) -> Result<(), String> {
    let app_log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    ensure_log_directory(&app_log_dir)?;
    open_folder_path(&app_log_dir)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn backfill_image_file_hashes(
    app: AppHandle,
    state: tauri::State<'_, FileHashBackfillState>,
    limit: Option<u32>,
) -> Result<FileHashBackfillResult, String> {
    let app_for_emit = app.clone();
    state.is_cancelled.store(false, Ordering::SeqCst);
    let is_cancelled = state.is_cancelled.clone();
    run_blocking(app, move |conn| {
        let requested_limit = limit.unwrap_or(u32::MAX) as i64;
        let rows: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "
                    SELECT id, path
                    FROM images
                    WHERE is_deleted = 0
                      AND is_missing = 0
                      AND (file_hash IS NULL OR file_hash = '')
                      AND path NOT LIKE 'blob:%'
                      AND path NOT LIKE 'data:%'
                      AND file_size IN (
                        SELECT file_size
                        FROM images
                        WHERE is_deleted = 0
                          AND is_missing = 0
                          AND path NOT LIKE 'blob:%'
                          AND path NOT LIKE 'data:%'
                        GROUP BY file_size
                        HAVING COUNT(*) > 1
                      )
                    ORDER BY file_size DESC, timestamp DESC
                    LIMIT ?1
                    ",
                )
                .map_err(|e| e.to_string())?;

            let mapped = stmt
                .query_map([requested_limit], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
                .map_err(|e| e.to_string())?;
            mapped
        };

        let total = rows.len();
        let mut scanned = 0;
        let mut updated = 0;
        let mut missing = 0;
        let mut errors = 0;
        let mut was_cancelled = false;
        let mut last_emit = std::time::Instant::now();

        let mut update_hash = conn
            .prepare_cached("UPDATE images SET file_hash = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        let mut mark_missing = conn
            .prepare_cached("UPDATE images SET is_missing = 1 WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        for (index, (id, path)) in rows.iter().enumerate() {
            if is_cancelled.load(Ordering::SeqCst) {
                was_cancelled = true;
                break;
            }

            scanned += 1;

            if !std::path::Path::new(path).exists() {
                mark_missing
                    .execute(params![id])
                    .map_err(|e| e.to_string())?;
                missing += 1;
            } else {
                match hash_file_sha256(path) {
                    Ok(hash) => {
                        update_hash
                            .execute(params![hash, id])
                            .map_err(|e| e.to_string())?;
                        updated += 1;
                    }
                    Err(e) => {
                        log::warn!("[Maintenance] Failed to hash image {}: {}", path, e);
                        errors += 1;
                    }
                }
            }

            if last_emit.elapsed().as_millis() > 250 || index + 1 == total {
                use tauri::Emitter;
                let _ = app_for_emit.emit(
                    "file_hash_backfill_progress",
                    FileHashBackfillProgress {
                        current: index + 1,
                        total,
                        message: "Hashing images for exact duplicate detection...".to_string(),
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }

        drop(update_hash);
        drop(mark_missing);

        let remaining = conn
            .query_row(
                "
                SELECT COUNT(*)
                FROM images
                WHERE is_deleted = 0
                  AND is_missing = 0
                  AND (file_hash IS NULL OR file_hash = '')
                  AND path NOT LIKE 'blob:%'
                  AND path NOT LIKE 'data:%'
                  AND file_size IN (
                    SELECT file_size
                    FROM images
                    WHERE is_deleted = 0
                      AND is_missing = 0
                      AND path NOT LIKE 'blob:%'
                      AND path NOT LIKE 'data:%'
                    GROUP BY file_size
                    HAVING COUNT(*) > 1
                  )
                ",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize;

        Ok(FileHashBackfillResult {
            scanned,
            updated,
            missing,
            errors,
            remaining,
            was_cancelled,
        })
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_image_file_hash_backfill(state: tauri::State<'_, FileHashBackfillState>) {
    log::info!("[Maintenance] File hash backfill cancellation requested");
    state.is_cancelled.store(true, Ordering::SeqCst);
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn optimize_database(app: AppHandle) -> Result<String, String> {
    run_blocking(app, move |conn| {
        let start = std::time::Instant::now();
        conn.execute("ANALYZE", []).map_err(|e| e.to_string())?;
        conn.execute("PRAGMA optimize", [])
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "Database optimized in {:.2}s",
            start.elapsed().as_secs_f64()
        ))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn purge_database(app: AppHandle) -> Result<String, String> {
    let db_path = resolve_db_path(&app)?;
    let marker_path = db_path
        .parent()
        .ok_or("Failed to get DB parent directory")?
        .join(".purge_on_restart");
    std::fs::write(&marker_path, "purge requested")
        .map_err(|e| format!("Failed to create purge marker: {}", e))?;

    #[cfg(not(debug_assertions))]
    {
        app.restart();
    }

    #[cfg(debug_assertions)]
    {
        Ok("Purge scheduled. Please restart 'npm run tauri dev' to complete.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{ensure_log_directory, hash_file_sha256, resolve_app_log_path};
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn hashes_same_bytes_independent_of_path() {
        let first = std::env::temp_dir().join("ambit_hash_test_a.bin");
        let second = std::env::temp_dir().join("ambit_hash_test_b.bin");
        let bytes = b"same image bytes";

        File::create(&first).unwrap().write_all(bytes).unwrap();
        File::create(&second).unwrap().write_all(bytes).unwrap();

        let first_hash = hash_file_sha256(&first.to_string_lossy()).unwrap();
        let second_hash = hash_file_sha256(&second.to_string_lossy()).unwrap();

        let _ = std::fs::remove_file(first);
        let _ = std::fs::remove_file(second);

        assert_eq!(first_hash, second_hash);
        assert_eq!(
            first_hash,
            "f10266197016b8e8842aeba6800100997ce04f35a45a3bff974711e9615ea597"
        );
    }

    #[test]
    fn app_log_path_matches_tauri_plugin_log_default_name() {
        let log_dir =
            std::path::Path::new("C:/Users/Ambit/AppData/Roaming/io.github.asuraace.ambit/logs");

        let log_path = resolve_app_log_path(log_dir, "Ambit");

        assert_eq!(
            log_path.to_string_lossy().replace('\\', "/"),
            "C:/Users/Ambit/AppData/Roaming/io.github.asuraace.ambit/logs/Ambit.log"
        );
    }

    #[test]
    fn log_folder_reveal_prepares_only_a_directory_target() {
        let root = std::env::temp_dir().join("ambit_log_reveal_test");
        let log_dir = root.join("logs");
        let _ = std::fs::remove_dir_all(&root);

        ensure_log_directory(&log_dir).unwrap();

        assert!(log_dir.is_dir());
        let _ = std::fs::remove_dir_all(root);
    }
}
