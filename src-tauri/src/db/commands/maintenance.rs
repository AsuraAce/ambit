use super::run_blocking;
use crate::db::{resolve_db_path, resolve_db_path_info, resolve_main_database_url};
use rusqlite::{params, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
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

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExactDuplicateResolution {
    pub keep_id: String,
    pub remove_ids: Vec<String>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExactDuplicateKeeperState {
    pub id: String,
    pub is_favorite: bool,
    pub is_pinned: bool,
    pub user_masked: Option<bool>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExactDuplicateResolutionResult {
    pub resolved_groups: usize,
    pub removed_ids: Vec<String>,
    pub keepers: Vec<ExactDuplicateKeeperState>,
}

#[derive(Debug, Clone)]
struct DuplicateRecordState {
    id: String,
    file_hash: String,
    is_favorite: bool,
    is_pinned: bool,
    user_masked: Option<bool>,
}

#[derive(Debug)]
struct ValidatedDuplicateResolution {
    keeper: DuplicateRecordState,
    removed: Vec<DuplicateRecordState>,
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

fn load_eligible_duplicate_record(
    tx: &Transaction<'_>,
    id: &str,
) -> Result<Option<DuplicateRecordState>, String> {
    tx.query_row(
        "SELECT id, file_hash, is_favorite, is_pinned, user_masked
         FROM images
         WHERE id = ?1
           AND is_deleted = 0
           AND is_missing = 0
           AND group_id IS NULL
           AND IFNULL(is_intermediate_gen, 0) = 0",
        [id],
        |row| {
            Ok(DuplicateRecordState {
                id: row.get(0)?,
                file_hash: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                is_favorite: row.get::<_, i64>(2)? != 0,
                is_pinned: row.get::<_, i64>(3)? != 0,
                user_masked: row.get::<_, Option<i64>>(4)?.map(|value| value != 0),
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn merge_user_mask(keeper_mask: Option<bool>, removed: &[DuplicateRecordState]) -> Option<bool> {
    if keeper_mask.is_some() {
        return keeper_mask;
    }

    let mut explicit_masks = removed.iter().filter_map(|record| record.user_masked);
    let first = explicit_masks.next()?;
    explicit_masks.all(|value| value == first).then_some(first)
}

fn validate_duplicate_resolutions(
    tx: &Transaction<'_>,
    resolutions: &[ExactDuplicateResolution],
) -> Result<Vec<ValidatedDuplicateResolution>, String> {
    let mut seen_ids = HashSet::new();
    let mut validated = Vec::with_capacity(resolutions.len());

    for resolution in resolutions {
        if resolution.keep_id.is_empty() {
            return Err("Duplicate keeper ID cannot be empty".to_string());
        }
        if resolution.remove_ids.is_empty() {
            return Err(format!(
                "Duplicate resolution for '{}' has no records to remove",
                resolution.keep_id
            ));
        }
        if !seen_ids.insert(resolution.keep_id.clone()) {
            return Err(format!(
                "Image '{}' appears in more than one duplicate resolution",
                resolution.keep_id
            ));
        }

        let keeper = load_eligible_duplicate_record(tx, &resolution.keep_id)?.ok_or_else(|| {
            format!(
                "Duplicate keeper '{}' is no longer available",
                resolution.keep_id
            )
        })?;
        if keeper.file_hash.trim().is_empty() {
            return Err(format!(
                "Duplicate keeper '{}' does not have a content hash",
                resolution.keep_id
            ));
        }

        let mut removed = Vec::with_capacity(resolution.remove_ids.len());
        for remove_id in &resolution.remove_ids {
            if remove_id.is_empty() || remove_id == &resolution.keep_id {
                return Err(format!(
                    "Invalid duplicate removal ID for keeper '{}'",
                    resolution.keep_id
                ));
            }
            if !seen_ids.insert(remove_id.clone()) {
                return Err(format!(
                    "Image '{}' appears in more than one duplicate resolution",
                    remove_id
                ));
            }

            let record = load_eligible_duplicate_record(tx, remove_id)?.ok_or_else(|| {
                format!("Duplicate record '{}' is no longer available", remove_id)
            })?;
            if record.file_hash != keeper.file_hash {
                return Err(format!(
                    "Duplicate group for '{}' changed; run the scan again",
                    resolution.keep_id
                ));
            }
            removed.push(record);
        }

        validated.push(ValidatedDuplicateResolution { keeper, removed });
    }

    Ok(validated)
}

fn persist_removed_duplicate(
    tx: &Transaction<'_>,
    image_id: &str,
    removed_at: i64,
) -> Result<(), String> {
    let inserted = tx
        .execute(
            "INSERT OR REPLACE INTO removed_images (
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                micro_thumbnail, thumbnail_source, is_favorite, is_pinned, is_missing,
                user_masked, group_id, board_id, notes, original_metadata_json,
                original_parsed_json, original_state_json, is_corrupt, removed_at,
                collection_ids_json
             )
             SELECT
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                micro_thumbnail, thumbnail_source, is_favorite, is_pinned, is_missing,
                user_masked, group_id, board_id, notes, original_metadata_json,
                original_parsed_json, original_state_json, is_corrupt, ?2,
                CASE
                    WHEN EXISTS (SELECT 1 FROM collection_images WHERE image_id = ?1)
                    THEN (
                        SELECT json_group_array(collection_id)
                        FROM (
                            SELECT collection_id
                            FROM collection_images
                            WHERE image_id = ?1
                            ORDER BY collection_id
                        )
                    )
                    ELSE NULL
                END
             FROM images
             WHERE id = ?1",
            params![image_id, removed_at],
        )
        .map_err(|error| error.to_string())?;

    if inserted != 1 {
        return Err(format!(
            "Failed to preserve removed duplicate record '{}'",
            image_id
        ));
    }

    Ok(())
}

fn delete_duplicate_record(tx: &Transaction<'_>, image_id: &str) -> Result<(), String> {
    for table in [
        "collection_images",
        "image_loras",
        "image_embeddings",
        "image_hypernetworks",
        "image_controlnets",
        "image_ipadapters",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE image_id = ?1"),
            [image_id],
        )
        .map_err(|error| error.to_string())?;
    }

    let deleted = tx
        .execute("DELETE FROM images WHERE id = ?1", [image_id])
        .map_err(|error| error.to_string())?;
    if deleted != 1 {
        return Err(format!("Failed to remove duplicate record '{}'", image_id));
    }

    Ok(())
}

fn resolve_exact_duplicate_groups_inner(
    conn: &rusqlite::Connection,
    resolutions: &[ExactDuplicateResolution],
) -> Result<ExactDuplicateResolutionResult, String> {
    if resolutions.is_empty() {
        return Ok(ExactDuplicateResolutionResult {
            resolved_groups: 0,
            removed_ids: Vec::new(),
            keepers: Vec::new(),
        });
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let validated = validate_duplicate_resolutions(&tx, resolutions)?;
    let removed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let mut removed_ids = Vec::new();
    let mut keepers = Vec::with_capacity(validated.len());

    for resolution in validated {
        let mut affected_collection_ids = BTreeSet::new();
        for record in std::iter::once(&resolution.keeper).chain(resolution.removed.iter()) {
            let mut statement = tx
                .prepare_cached("SELECT collection_id FROM collection_images WHERE image_id = ?1")
                .map_err(|error| error.to_string())?;
            let collection_ids = statement
                .query_map([&record.id], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
                .map_err(|error| error.to_string())?;
            affected_collection_ids.extend(collection_ids);
        }

        for record in &resolution.removed {
            persist_removed_duplicate(&tx, &record.id, removed_at)?;
        }

        let is_favorite = resolution.keeper.is_favorite
            || resolution.removed.iter().any(|record| record.is_favorite);
        let is_pinned =
            resolution.keeper.is_pinned || resolution.removed.iter().any(|record| record.is_pinned);
        let user_masked = merge_user_mask(resolution.keeper.user_masked, &resolution.removed);
        let user_masked_value = user_masked.map(i64::from);

        tx.execute(
            "UPDATE images
             SET is_favorite = ?1, is_pinned = ?2, user_masked = ?3
             WHERE id = ?4",
            params![
                i64::from(is_favorite),
                i64::from(is_pinned),
                user_masked_value,
                resolution.keeper.id
            ],
        )
        .map_err(|error| error.to_string())?;

        for record in &resolution.removed {
            tx.execute(
                "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
                 SELECT collection_id, ?1
                 FROM collection_images
                 WHERE image_id = ?2",
                params![resolution.keeper.id, record.id],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "UPDATE collections
                 SET custom_thumbnail = ?1
                 WHERE custom_thumbnail = ?2",
                params![resolution.keeper.id, record.id],
            )
            .map_err(|error| error.to_string())?;
        }

        for collection_id in affected_collection_ids {
            tx.execute(
                "UPDATE collections
                 SET dynamic_thumbnail_path = NULL,
                     dynamic_safe_thumbnail_path = NULL,
                     dynamic_thumbnail_is_sensitive = NULL,
                     dynamic_thumbnail_cached_at = NULL
                 WHERE id = ?1
                   AND (custom_thumbnail IS NULL OR custom_thumbnail = '')",
                [collection_id],
            )
            .map_err(|error| error.to_string())?;
        }

        for record in &resolution.removed {
            delete_duplicate_record(&tx, &record.id)?;
            removed_ids.push(record.id.clone());
        }

        keepers.push(ExactDuplicateKeeperState {
            id: resolution.keeper.id,
            is_favorite,
            is_pinned,
            user_masked,
        });
    }

    tx.commit().map_err(|error| error.to_string())?;

    Ok(ExactDuplicateResolutionResult {
        resolved_groups: keepers.len(),
        removed_ids,
        keepers,
    })
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
pub async fn resolve_exact_duplicate_groups(
    app: AppHandle,
    resolutions: Vec<ExactDuplicateResolution>,
) -> Result<ExactDuplicateResolutionResult, String> {
    run_blocking(app, move |conn| {
        resolve_exact_duplicate_groups_inner(conn, &resolutions)
    })
    .await
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
                      AND group_id IS NULL
                      AND IFNULL(is_intermediate_gen, 0) = 0
                      AND (file_hash IS NULL OR file_hash = '')
                      AND path NOT LIKE 'blob:%'
                      AND path NOT LIKE 'data:%'
                      AND file_size IN (
                        SELECT file_size
                        FROM images
                        WHERE is_deleted = 0
                          AND is_missing = 0
                          AND group_id IS NULL
                          AND IFNULL(is_intermediate_gen, 0) = 0
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
                  AND group_id IS NULL
                  AND IFNULL(is_intermediate_gen, 0) = 0
                  AND (file_hash IS NULL OR file_hash = '')
                  AND path NOT LIKE 'blob:%'
                  AND path NOT LIKE 'data:%'
                  AND file_size IN (
                    SELECT file_size
                    FROM images
                    WHERE is_deleted = 0
                      AND is_missing = 0
                      AND group_id IS NULL
                      AND IFNULL(is_intermediate_gen, 0) = 0
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
pub async fn schedule_purge_transaction(
    app: AppHandle,
    transaction_id: String,
    journal_json: String,
) -> Result<String, String> {
    let journal_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let db_path = resolve_db_path(&app)?;
    let marker_dir = db_path
        .parent()
        .ok_or("Failed to get DB parent directory")?;
    crate::app_data_migration::schedule_purge_artifacts(
        &journal_dir,
        marker_dir,
        &transaction_id,
        &journal_json,
    )?;

    #[cfg(not(debug_assertions))]
    {
        app.restart();
    }

    #[cfg(debug_assertions)]
    {
        app.exit(0);
        Ok("Factory reset committed. Ambit is closing to finish recovery.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_log_directory, hash_file_sha256, resolve_app_log_path,
        resolve_exact_duplicate_groups_inner, ExactDuplicateResolution,
    };
    use crate::db::migrations::init_db;
    use rusqlite::{params, Connection};
    use std::fs::File;
    use std::io::Write;

    fn apply_all_migrations(conn: &Connection) {
        for migration in init_db() {
            conn.execute_batch(&migration.sql)
                .expect("apply migrations");
        }
    }

    fn seed_image(
        conn: &Connection,
        id: &str,
        hash: &str,
        favorite: bool,
        pinned: bool,
        user_masked: Option<bool>,
        metadata_json: &str,
        board_id: Option<&str>,
        notes: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO images (
                id, path, width, height, file_size, file_hash, timestamp, metadata_json,
                is_favorite, is_pinned, is_deleted, is_missing, user_masked, board_id,
                notes, is_corrupt
             ) VALUES (?1, ?1, 1024, 1024, 100, ?2, 1000, ?3, ?4, ?5, 0, 0, ?6, ?7, ?8, 0)",
            params![
                id,
                hash,
                metadata_json,
                i64::from(favorite),
                i64::from(pinned),
                user_masked.map(i64::from),
                board_id,
                notes,
            ],
        )
        .expect("seed image");
    }

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

    #[test]
    fn exact_duplicate_resolution_preserves_removed_state_and_merges_safe_keeper_state() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(
            &conn,
            "keeper",
            "same-hash",
            false,
            false,
            None,
            r#"{"positivePrompt":"keeper metadata"}"#,
            Some("keeper-board"),
            Some("keeper notes"),
        );
        seed_image(
            &conn,
            "favorite-copy",
            "same-hash",
            true,
            false,
            Some(true),
            r#"{"positivePrompt":"removed metadata"}"#,
            Some("removed-board"),
            Some("removed notes"),
        );
        seed_image(
            &conn,
            "pinned-copy",
            "same-hash",
            false,
            true,
            Some(true),
            "{}",
            None,
            None,
        );
        conn.execute(
            "INSERT INTO collections (id, name, created_at, custom_thumbnail)
             VALUES ('keeper-collection', 'Keeper', 1, NULL),
                    ('favorite-collection', 'Favorite', 1, 'favorite-copy'),
                    ('pinned-collection', 'Pinned', 1, NULL)",
            [],
        )
        .expect("seed collections");
        for (collection_id, image_id) in [
            ("keeper-collection", "keeper"),
            ("favorite-collection", "favorite-copy"),
            ("pinned-collection", "pinned-copy"),
        ] {
            conn.execute(
                "INSERT INTO collection_images (collection_id, image_id) VALUES (?1, ?2)",
                params![collection_id, image_id],
            )
            .expect("seed membership");
        }

        let result = resolve_exact_duplicate_groups_inner(
            &conn,
            &[ExactDuplicateResolution {
                keep_id: "keeper".to_string(),
                remove_ids: vec!["favorite-copy".to_string(), "pinned-copy".to_string()],
            }],
        )
        .expect("resolve duplicates");

        assert_eq!(result.resolved_groups, 1);
        assert_eq!(result.removed_ids, ["favorite-copy", "pinned-copy"]);
        assert_eq!(result.keepers[0].id, "keeper");
        assert!(result.keepers[0].is_favorite);
        assert!(result.keepers[0].is_pinned);
        assert_eq!(result.keepers[0].user_masked, Some(true));

        let keeper: (
            i64,
            i64,
            Option<i64>,
            String,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT is_favorite, is_pinned, user_masked, metadata_json, board_id, notes
                 FROM images WHERE id = 'keeper'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("keeper state");
        assert_eq!(keeper.0, 1);
        assert_eq!(keeper.1, 1);
        assert_eq!(keeper.2, Some(1));
        assert_eq!(keeper.3, r#"{"positivePrompt":"keeper metadata"}"#);
        assert_eq!(keeper.4.as_deref(), Some("keeper-board"));
        assert_eq!(keeper.5.as_deref(), Some("keeper notes"));

        let memberships = conn
            .prepare("SELECT collection_id FROM collection_images WHERE image_id = 'keeper' ORDER BY collection_id")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            memberships,
            [
                "favorite-collection",
                "keeper-collection",
                "pinned-collection"
            ]
        );
        let custom_thumbnail: String = conn
            .query_row(
                "SELECT custom_thumbnail FROM collections WHERE id = 'favorite-collection'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(custom_thumbnail, "keeper");

        let removed: (String, Option<String>, Option<String>, String) = conn
            .query_row(
                "SELECT metadata_json, board_id, notes, collection_ids_json
                 FROM removed_images WHERE id = 'favorite-copy'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("removed state");
        assert_eq!(removed.0, r#"{"positivePrompt":"removed metadata"}"#);
        assert_eq!(removed.1.as_deref(), Some("removed-board"));
        assert_eq!(removed.2.as_deref(), Some("removed notes"));
        assert_eq!(removed.3, r#"["favorite-collection"]"#);
        let active_removed_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM images WHERE id IN ('favorite-copy', 'pinned-copy')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_removed_count, 0);
    }

    #[test]
    fn exact_duplicate_resolution_keeps_automatic_mask_when_removed_overrides_conflict() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(
            &conn, "keeper", "hash", false, false, None, "{}", None, None,
        );
        seed_image(
            &conn,
            "masked",
            "hash",
            false,
            false,
            Some(true),
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "unmasked",
            "hash",
            false,
            false,
            Some(false),
            "{}",
            None,
            None,
        );

        let result = resolve_exact_duplicate_groups_inner(
            &conn,
            &[ExactDuplicateResolution {
                keep_id: "keeper".to_string(),
                remove_ids: vec!["masked".to_string(), "unmasked".to_string()],
            }],
        )
        .unwrap();

        assert_eq!(result.keepers[0].user_masked, None);
    }

    #[test]
    fn exact_duplicate_resolution_rolls_back_the_batch_when_any_group_is_stale() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(
            &conn, "keep-a", "hash-a", false, false, None, "{}", None, None,
        );
        seed_image(
            &conn, "remove-a", "hash-a", false, false, None, "{}", None, None,
        );
        seed_image(
            &conn, "keep-b", "hash-b", false, false, None, "{}", None, None,
        );
        seed_image(
            &conn,
            "remove-b",
            "changed-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );

        let error = resolve_exact_duplicate_groups_inner(
            &conn,
            &[
                ExactDuplicateResolution {
                    keep_id: "keep-a".to_string(),
                    remove_ids: vec!["remove-a".to_string()],
                },
                ExactDuplicateResolution {
                    keep_id: "keep-b".to_string(),
                    remove_ids: vec!["remove-b".to_string()],
                },
            ],
        )
        .expect_err("stale group must fail");

        assert!(error.contains("changed; run the scan again"));
        let active_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
            .unwrap();
        let removed_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM removed_images", [], |row| row.get(0))
            .unwrap();
        assert_eq!(active_count, 4);
        assert_eq!(removed_count, 0);
    }
}
