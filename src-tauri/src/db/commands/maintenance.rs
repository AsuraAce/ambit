use super::run_blocking;
use crate::db::facets::FacetResourceTouches;
use crate::db::{resolve_db_path, resolve_db_path_info, resolve_main_database_url};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
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

#[derive(serde::Serialize, specta::Type, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemovedLifecycleMutationResult {
    pub affected_ids: Vec<String>,
    pub not_found_ids: Vec<String>,
    pub membership_warning_ids: Vec<String>,
    pub touched_resources: FacetResourceTouches,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollectionMembershipOperation {
    Add,
    Remove,
    Move,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InvokeCollectionOwnershipAction {
    Suppress,
    Restore,
    Reset,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMembershipMutationInput {
    pub operation: CollectionMembershipOperation,
    pub image_ids: Vec<String>,
    pub source_collection_id: Option<String>,
    pub target_collection_id: Option<String>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMembershipMutationResult {
    pub affected_ids: Vec<String>,
    pub source_collection_id: Option<String>,
    pub target_collection_id: Option<String>,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCollectionMigrationItem {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub is_archived: bool,
    pub is_pinned: bool,
    pub created_at: i64,
    pub updated_at: Option<i64>,
    pub filter_state: Option<String>,
    pub manual_exclusions: Option<String>,
    pub custom_thumbnail: Option<String>,
    pub image_ids: Vec<String>,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCollectionMigrationInput {
    pub import_key: String,
    pub collections: Vec<LegacyCollectionMigrationItem>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCollectionMigrationResult {
    pub already_applied: bool,
    pub collections_upserted: usize,
    pub memberships_inserted: usize,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AmbitCollectionScopeMode {
    Global,
    All,
    Owner,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAmbitCollectionScopeInput {
    pub collection_id: String,
    pub mode: AmbitCollectionScopeMode,
    pub db_path: Option<String>,
    pub owner_id: Option<String>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAmbitCollectionScopeResult {
    pub collection_id: String,
    pub invoke_source_id: Option<String>,
    pub invoke_owner_id: Option<String>,
}

static REMOVED_LIFECYCLE_COORDINATOR: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn lock_removed_lifecycle() -> MutexGuard<'static, ()> {
    REMOVED_LIFECYCLE_COORDINATOR
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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

#[cfg(test)]
fn hash_file_sha256(path: &str) -> Result<String, String> {
    let is_cancelled = AtomicBool::new(false);
    hash_file_sha256_cancellable(path, &is_cancelled)?
        .ok_or_else(|| "File hashing was cancelled".to_string())
}

fn hash_file_sha256_cancellable(
    path: &str,
    is_cancelled: &AtomicBool,
) -> Result<Option<String>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];

    loop {
        if is_cancelled.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(Some(hex::encode(hasher.finalize())))
}

fn load_file_hash_candidates(
    conn: &Connection,
    requested_limit: i64,
) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT id, path
            FROM scoped_images
            WHERE invoke_scope_hidden = 0
              AND is_deleted = 0
              AND is_missing = 0
              AND group_id IS NULL
              AND IFNULL(is_intermediate_gen, 0) = 0
              AND (file_hash IS NULL OR file_hash = '')
              AND path NOT LIKE 'blob:%'
              AND path NOT LIKE 'data:%'
              AND file_size IN (
                SELECT file_size
                FROM scoped_images
                WHERE invoke_scope_hidden = 0
                  AND is_deleted = 0
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

    let rows = stmt
        .query_map([requested_limit], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn count_remaining_file_hash_candidates(conn: &Connection) -> usize {
    conn.query_row(
        "
        SELECT COUNT(*)
        FROM scoped_images
        WHERE invoke_scope_hidden = 0
          AND is_deleted = 0
          AND is_missing = 0
          AND group_id IS NULL
          AND IFNULL(is_intermediate_gen, 0) = 0
          AND (file_hash IS NULL OR file_hash = '')
          AND path NOT LIKE 'blob:%'
          AND path NOT LIKE 'data:%'
          AND file_size IN (
            SELECT file_size
            FROM scoped_images
            WHERE invoke_scope_hidden = 0
              AND is_deleted = 0
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
    .unwrap_or(0) as usize
}

fn load_eligible_duplicate_record(
    tx: &Transaction<'_>,
    id: &str,
) -> Result<Option<DuplicateRecordState>, String> {
    tx.query_row(
        "SELECT id, file_hash, is_favorite, is_pinned, user_masked
         FROM scoped_images
         WHERE id = ?1
           AND invoke_scope_hidden = 0
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
                id, path, width, height, file_size, file_hash, timestamp, metadata_json, thumbnail_path,
                micro_thumbnail, thumbnail_source, is_favorite, is_pinned, is_missing,
                user_masked, group_id, board_id, notes, original_metadata_json,
                original_parsed_json, original_state_json, is_corrupt, removed_at,
                collection_ids_json, media_type, media_container, media_mime_type,
                duration_ms, video_codec, video_profile, audio_present, audio_codec,
                frame_rate_num, frame_rate_den, rotation_degrees, probe_status,
                playback_status, invoke_image_name, invoke_image_category,
                invoke_image_origin, invoke_owner_id, invoke_scope_hidden, parser_version,
                invoke_source_id
             )
             SELECT
                id, path, width, height, file_size, file_hash, timestamp, metadata_json, thumbnail_path,
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
                END,
                media_type, media_container, media_mime_type, duration_ms, video_codec,
                video_profile, audio_present, audio_codec, frame_rate_num, frame_rate_den,
                rotation_degrees, probe_status, playback_status,
                invoke_image_name, invoke_image_category, invoke_image_origin,
                invoke_owner_id, invoke_scope_hidden, parser_version, invoke_source_id
             FROM scoped_images
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

fn normalize_requested_ids(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .map(|id| id.trim().replace('\\', "/"))
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect()
}

fn add_touched_resource(values: &mut Vec<String>, value: Option<&str>, fallback: Option<&str>) {
    let Some(value) = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(fallback)
    else {
        return;
    };
    let weighted_index = value.find(" (");
    let colon_index = value.find(':');
    let cut_index = [weighted_index, colon_index]
        .into_iter()
        .flatten()
        .filter(|index| *index > 0)
        .min();
    let value = cut_index.map_or(value, |index| &value[..index]).trim();
    let lower = value.to_ascii_lowercase();
    let value = [".safetensors", ".ckpt", ".pt", ".bin", ".pth"]
        .into_iter()
        .find(|extension| lower.ends_with(extension))
        .map_or(value, |extension| &value[..value.len() - extension.len()])
        .trim();
    if !value.is_empty() && !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
}

fn collect_touched_resources(metadata_json: Option<&str>, touches: &mut FacetResourceTouches) {
    let Some(metadata_json) = metadata_json else {
        return;
    };
    let Ok(metadata) = serde_json::from_str::<serde_json::Value>(metadata_json) else {
        return;
    };

    add_touched_resource(
        &mut touches.checkpoints,
        metadata
            .get("overrideModel")
            .and_then(|value| value.as_str())
            .or_else(|| metadata.get("model").and_then(|value| value.as_str())),
        Some("Unknown"),
    );
    add_touched_resource(
        &mut touches.tools,
        metadata.get("tool").and_then(|value| value.as_str()),
        Some("Unknown"),
    );

    for (json_key, values) in [
        ("loras", &mut touches.loras),
        ("embeddings", &mut touches.embeddings),
        ("hypernetworks", &mut touches.hypernetworks),
        ("controlNets", &mut touches.control_nets),
        ("ipAdapters", &mut touches.ip_adapters),
    ] {
        if let Some(resources) = metadata.get(json_key).and_then(|value| value.as_array()) {
            for resource in resources {
                add_touched_resource(values, resource.as_str(), None);
            }
        }
    }
}

fn load_collection_ids(tx: &Transaction<'_>, image_id: &str) -> Result<Vec<String>, String> {
    tx.prepare_cached("SELECT collection_id FROM collection_images WHERE image_id = ?1")
        .map_err(|error| error.to_string())?
        .query_map([image_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn clear_collection_thumbnail_caches(
    tx: &Transaction<'_>,
    collection_ids: impl IntoIterator<Item = String>,
) -> Result<(), String> {
    for collection_id in collection_ids.into_iter().collect::<BTreeSet<_>>() {
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
    Ok(())
}

fn remove_images_from_library_inner(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<RemovedLifecycleMutationResult, String> {
    let _lifecycle_guard = lock_removed_lifecycle();
    let normalized_ids = normalize_requested_ids(ids);
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let removed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let mut result = RemovedLifecycleMutationResult::default();
    let mut affected_collection_ids = Vec::new();

    for id in normalized_ids {
        let metadata_json = tx
            .query_row(
                "SELECT metadata_json FROM scoped_images WHERE id = ?1 AND invoke_scope_hidden = 0",
                [&id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(metadata_json) = metadata_json else {
            result.not_found_ids.push(id);
            continue;
        };

        collect_touched_resources(metadata_json.as_deref(), &mut result.touched_resources);
        affected_collection_ids.extend(load_collection_ids(&tx, &id)?);
        persist_removed_duplicate(&tx, &id, removed_at)?;
        delete_duplicate_record(&tx, &id)?;
        result.affected_ids.push(id);
    }

    clear_collection_thumbnail_caches(&tx, affected_collection_ids)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

fn restore_resource_junctions(tx: &Transaction<'_>, image_id: &str) -> Result<(), String> {
    for (table, column, json_key) in [
        ("image_loras", "lora_name", "loras"),
        ("image_embeddings", "embedding_name", "embeddings"),
        ("image_hypernetworks", "hypernetwork_name", "hypernetworks"),
        ("image_controlnets", "controlnet_name", "controlNets"),
        ("image_ipadapters", "ipadapter_name", "ipAdapters"),
    ] {
        let sql = format!(
            "INSERT OR IGNORE INTO {table} (image_id, {column})
             SELECT ?1,
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    CASE
                        WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                        WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                        ELSE value
                    END,
                '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
             FROM json_each((SELECT metadata_json FROM images WHERE id = ?1), '$.{json_key}')
             WHERE value IS NOT NULL AND value != ''"
        );
        tx.execute(&sql, [image_id])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn stored_filesystem_path(path: &str) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(rest) = path.strip_prefix("//?/UNC/") {
            return PathBuf::from(format!(r"\\?\UNC\{}", rest.replace('/', "\\")));
        }
        if let Some(rest) = path.strip_prefix("//?/") {
            return PathBuf::from(format!(r"\\?\{}", rest.replace('/', "\\")));
        }
    }
    PathBuf::from(path)
}

fn is_missing_filesystem_source(path: &str, invoke_image_name: Option<&str>) -> bool {
    if invoke_image_name.is_some() || path.starts_with("blob:") || path.starts_with("data:") {
        return false;
    }
    !stored_filesystem_path(path).is_file()
}

fn restore_removed_record(
    tx: &Transaction<'_>,
    image_id: &str,
    is_missing: bool,
) -> Result<(), String> {
    let inserted = tx
        .execute(
            "INSERT INTO images (
                id, path, width, height, file_size, file_hash, timestamp, metadata_json, thumbnail_path,
                micro_thumbnail, thumbnail_source, thumbnail_version, is_favorite, is_pinned,
                is_deleted, is_missing, user_masked, group_id, board_id, notes,
                original_metadata_json, original_parsed_json, original_state_json, is_corrupt,
                invoke_image_name, invoke_image_category, invoke_image_origin, invoke_owner_id,
                invoke_scope_hidden, model_hash, model_name, tool, resolved_model_name, steps, seed,
                cfg, sampler, generation_type, parser_version, positive_prompt, negative_prompt,
                invoke_source_id, media_type, media_container, media_mime_type, duration_ms,
                video_codec, video_profile, audio_present, audio_codec, frame_rate_num,
                frame_rate_den, rotation_degrees, probe_status, playback_status
             )
             SELECT
                id, path, width, height, file_size, file_hash, timestamp, metadata_json, thumbnail_path,
                micro_thumbnail, thumbnail_source,
                CASE WHEN thumbnail_source = 'ambit' AND thumbnail_path IS NOT NULL
                           AND thumbnail_path != '' AND path != thumbnail_path THEN 1 ELSE 0 END,
                is_favorite, is_pinned, 0, ?2, user_masked, group_id, board_id, notes,
                original_metadata_json, original_parsed_json, original_state_json, is_corrupt,
                invoke_image_name, invoke_image_category, invoke_image_origin, invoke_owner_id,
                invoke_scope_hidden,
                json_extract(metadata_json, '$.modelHash'),
                json_extract(metadata_json, '$.model'),
                json_extract(metadata_json, '$.tool'),
                COALESCE(
                    (SELECT name FROM models WHERE hash = json_extract(metadata_json, '$.modelHash')),
                    json_extract(metadata_json, '$.model')
                ),
                CAST(json_extract(metadata_json, '$.steps') AS INTEGER),
                CAST(json_extract(metadata_json, '$.seed') AS INTEGER),
                CAST(json_extract(metadata_json, '$.cfg') AS REAL),
                REPLACE(REPLACE(LOWER(json_extract(metadata_json, '$.sampler')), '_', ' '), '-', ' '),
                json_extract(metadata_json, '$.generationType'), COALESCE(parser_version, 0),
                COALESCE(NULLIF(json_extract(metadata_json, '$.positivePrompt'), ''),
                         NULLIF(json_extract(metadata_json, '$.positive_prompt'), '')),
                COALESCE(NULLIF(json_extract(metadata_json, '$.negativePrompt'), ''),
                         NULLIF(json_extract(metadata_json, '$.negative_prompt'), '')),
                invoke_source_id, media_type, media_container, media_mime_type, duration_ms,
                video_codec, video_profile, audio_present, audio_codec, frame_rate_num,
                frame_rate_den, rotation_degrees, probe_status, playback_status
             FROM scoped_removed_images
             WHERE id = ?1 AND invoke_scope_hidden = 0",
            params![image_id, i64::from(is_missing)],
        )
        .map_err(|error| error.to_string())?;
    if inserted != 1 {
        return Err(format!("Failed to restore removed record '{}'", image_id));
    }
    restore_resource_junctions(tx, image_id)
}

fn reproject_restored_invoke_memberships(
    tx: &Transaction<'_>,
    image_id: &str,
) -> Result<Vec<String>, String> {
    let prior_collection_ids = {
        let mut statement = tx
            .prepare(
                "SELECT collection_images.collection_id
                 FROM collection_images
                 INNER JOIN collections ON collections.id = collection_images.collection_id
                 WHERE collection_images.image_id = ?1
                   AND COALESCE(collections.source, 'ambit') = 'invoke'",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([image_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };

    tx.execute(
        "DELETE FROM collection_images
         WHERE image_id = ?1
           AND collection_id IN (
               SELECT id FROM collections WHERE COALESCE(source, 'ambit') = 'invoke'
           )",
        [image_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
         SELECT snapshot.collection_id, images.id
         FROM images
         INNER JOIN invoke_board_membership_snapshot snapshot
            ON snapshot.invoke_image_name = images.invoke_image_name
         INNER JOIN collections ON collections.id = snapshot.collection_id
         WHERE images.id = ?1
           AND COALESCE(collections.source, 'ambit') = 'invoke'
           AND collections.invoke_source_id IS images.invoke_source_id
           AND (
               collections.invoke_owner_id IS NULL
               OR collections.invoke_owner_id IS images.invoke_owner_id
           )
           AND NOT EXISTS (
               SELECT 1 FROM invoke_board_membership_exclusions exclusions
               WHERE exclusions.collection_id = snapshot.collection_id
                 AND exclusions.invoke_image_name = snapshot.invoke_image_name
           )",
        [image_id],
    )
    .map_err(|error| error.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
         SELECT additions.collection_id, additions.image_id
         FROM invoke_board_membership_additions additions
         INNER JOIN collections ON collections.id = additions.collection_id
         INNER JOIN images ON images.id = additions.image_id
         WHERE additions.image_id = ?1
           AND COALESCE(collections.source, 'ambit') = 'invoke'
           AND (
               images.invoke_source_id IS NULL
               OR (
                   collections.invoke_source_id IS images.invoke_source_id
                   AND (
                       collections.invoke_owner_id IS NULL
                       OR collections.invoke_owner_id IS images.invoke_owner_id
                   )
               )
           )",
        [image_id],
    )
    .map_err(|error| error.to_string())?;

    let current_collection_ids = {
        let mut statement = tx
            .prepare(
                "SELECT collection_images.collection_id
                 FROM collection_images
                 INNER JOIN collections ON collections.id = collection_images.collection_id
                 WHERE collection_images.image_id = ?1
                   AND COALESCE(collections.source, 'ambit') = 'invoke'",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([image_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };

    Ok(prior_collection_ids
        .into_iter()
        .chain(current_collection_ids)
        .collect())
}

fn restore_removed_images_inner(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<RemovedLifecycleMutationResult, String> {
    let _lifecycle_guard = lock_removed_lifecycle();
    let normalized_ids = normalize_requested_ids(ids);
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut result = RemovedLifecycleMutationResult::default();
    let mut restored_collection_ids = Vec::new();

    for id in normalized_ids {
        let removed = tx
            .query_row(
                "SELECT metadata_json, collection_ids_json, path, invoke_image_name
                 FROM scoped_removed_images WHERE id = ?1 AND invoke_scope_hidden = 0",
                [&id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some((metadata_json, collection_ids_json, path, invoke_image_name)) = removed else {
            result.not_found_ids.push(id);
            continue;
        };

        collect_touched_resources(metadata_json.as_deref(), &mut result.touched_resources);
        let is_missing = is_missing_filesystem_source(&path, invoke_image_name.as_deref());
        restore_removed_record(&tx, &id, is_missing)?;

        if let Some(collection_ids_json) = collection_ids_json {
            match serde_json::from_str::<Vec<String>>(&collection_ids_json) {
                Ok(collection_ids) => {
                    for collection_id in collection_ids {
                        let inserted = tx
                            .execute(
                                "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
                                 SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM scoped_collections WHERE id = ?1)",
                                params![collection_id, id],
                            )
                            .map_err(|error| error.to_string())?;
                        if inserted > 0 {
                            restored_collection_ids.push(collection_id);
                        }
                    }
                }
                Err(error) => {
                    log::warn!(
                        "[Removed] Invalid collection membership JSON for {}: {}",
                        id,
                        error
                    );
                    result.membership_warning_ids.push(id.clone());
                }
            }
        }
        restored_collection_ids.extend(reproject_restored_invoke_memberships(&tx, &id)?);

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
            return Err(format!("Failed to clear restored tombstone '{}'", id));
        }
        result.affected_ids.push(id);
    }

    clear_collection_thumbnail_caches(&tx, restored_collection_ids)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

#[derive(Debug)]
struct MembershipCollectionState {
    id: String,
    filter_state: Option<String>,
    manual_exclusions: Option<String>,
    source: String,
    invoke_source_id: Option<String>,
    invoke_owner_id: Option<String>,
}

fn load_membership_collection(
    tx: &Transaction<'_>,
    collection_id: &str,
) -> Result<MembershipCollectionState, String> {
    tx.query_row(
        "SELECT id, filter_state, manual_exclusions, COALESCE(source, 'ambit'), invoke_source_id, invoke_owner_id
         FROM scoped_collections WHERE id = ?1",
        [collection_id],
        |row| {
            Ok(MembershipCollectionState {
                id: row.get(0)?,
                filter_state: row.get(1)?,
                manual_exclusions: row.get(2)?,
                source: row.get(3)?,
                invoke_source_id: row.get(4)?,
                invoke_owner_id: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("Collection '{}' is no longer available", collection_id))
}

fn validate_image_for_collection_scope(
    tx: &Transaction<'_>,
    collection: &MembershipCollectionState,
    image_id: &str,
) -> Result<(), String> {
    let image_scope = tx
        .query_row(
            "SELECT invoke_source_id, invoke_owner_id FROM images WHERE id = ?1",
            [image_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Image '{}' is no longer available", image_id))?;

    let Some(image_source_id) = image_scope.0 else {
        return Ok(());
    };
    let Some(collection_source_id) = collection.invoke_source_id.as_deref() else {
        return Err(format!(
            "Collection '{}' uses legacy shared visibility. Assign it to All Users or an owner before adding InvokeAI images.",
            collection.id
        ));
    };
    if image_source_id != collection_source_id {
        return Err(format!(
            "Image '{}' belongs to a different InvokeAI database than collection '{}'.",
            image_id, collection.id
        ));
    }
    if let Some(collection_owner_id) = collection.invoke_owner_id.as_deref() {
        if image_scope.1.as_deref() != Some(collection_owner_id) {
            return Err(format!(
                "Image '{}' belongs to a different InvokeAI owner than collection '{}'.",
                image_id, collection.id
            ));
        }
    }

    Ok(())
}

fn persist_invoke_membership_removals(
    tx: &Transaction<'_>,
    collection: &MembershipCollectionState,
    image_ids: &[String],
) -> Result<(), String> {
    if collection.source != "invoke" {
        return Ok(());
    }

    for image_id in image_ids {
        let invoke_image_name = tx
            .query_row(
                "SELECT invoke_image_name FROM images WHERE id = ?1",
                [image_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM invoke_board_membership_additions
             WHERE collection_id = ?1 AND image_id = ?2",
            params![collection.id, image_id],
        )
        .map_err(|error| error.to_string())?;

        if let Some(invoke_image_name) = invoke_image_name {
            tx.execute(
                "INSERT OR IGNORE INTO invoke_board_membership_exclusions (
                     collection_id, invoke_image_name
                 )
                 SELECT ?1, ?2
                 WHERE EXISTS (
                     SELECT 1 FROM invoke_board_membership_snapshot
                     WHERE collection_id = ?1 AND invoke_image_name = ?2
                 )",
                params![collection.id, invoke_image_name],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn persist_invoke_membership_additions(
    tx: &Transaction<'_>,
    collection: &MembershipCollectionState,
    image_ids: &[String],
) -> Result<(), String> {
    if collection.source != "invoke" {
        return Ok(());
    }

    for image_id in image_ids {
        let invoke_image_name = tx
            .query_row(
                "SELECT invoke_image_name FROM images WHERE id = ?1",
                [image_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .map_err(|error| error.to_string())?;
        let is_source_member = if let Some(invoke_image_name) = invoke_image_name.as_deref() {
            tx.query_row(
                "SELECT EXISTS (
                     SELECT 1 FROM invoke_board_membership_snapshot
                     WHERE collection_id = ?1 AND invoke_image_name = ?2
                 )",
                params![collection.id, invoke_image_name],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| error.to_string())?
        } else {
            false
        };

        if let Some(invoke_image_name) = invoke_image_name {
            tx.execute(
                "DELETE FROM invoke_board_membership_exclusions
                 WHERE collection_id = ?1 AND invoke_image_name = ?2",
                params![collection.id, invoke_image_name],
            )
            .map_err(|error| error.to_string())?;
        }
        if is_source_member {
            tx.execute(
                "DELETE FROM invoke_board_membership_additions
                 WHERE collection_id = ?1 AND image_id = ?2",
                params![collection.id, image_id],
            )
            .map_err(|error| error.to_string())?;
        } else {
            tx.execute(
                "INSERT OR IGNORE INTO invoke_board_membership_additions (
                     collection_id, image_id
                 ) VALUES (?1, ?2)",
                params![collection.id, image_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn add_manual_exclusions(
    tx: &Transaction<'_>,
    collection: &MembershipCollectionState,
    image_ids: &[String],
) -> Result<(), String> {
    if collection.filter_state.is_none() {
        return Ok(());
    }
    let mut exclusions = match collection.manual_exclusions.as_deref() {
        Some(json) if !json.trim().is_empty() => serde_json::from_str::<Vec<String>>(json)
            .map_err(|error| {
                format!(
                    "Invalid manual exclusions for '{}': {}",
                    collection.id, error
                )
            })?,
        _ => Vec::new(),
    };
    for image_id in image_ids {
        if !exclusions.contains(image_id) {
            exclusions.push(image_id.clone());
        }
    }
    tx.execute(
        "UPDATE collections SET manual_exclusions = ?1 WHERE id = ?2",
        params![
            serde_json::to_string(&exclusions).map_err(|error| error.to_string())?,
            collection.id
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn remove_manual_exclusions(
    tx: &Transaction<'_>,
    collection: &MembershipCollectionState,
    image_ids: &[String],
) -> Result<(), String> {
    if collection.filter_state.is_none() {
        return Ok(());
    }
    let Some(exclusions_json) = collection
        .manual_exclusions
        .as_deref()
        .filter(|json| !json.trim().is_empty())
    else {
        return Ok(());
    };
    let mut exclusions = serde_json::from_str::<Vec<String>>(exclusions_json).map_err(|error| {
        format!(
            "Invalid manual exclusions for '{}': {}",
            collection.id, error
        )
    })?;
    let restored_ids = image_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    exclusions.retain(|excluded_id| !restored_ids.contains(excluded_id.as_str()));
    tx.execute(
        "UPDATE collections SET manual_exclusions = ?1 WHERE id = ?2",
        params![
            serde_json::to_string(&exclusions).map_err(|error| error.to_string())?,
            collection.id
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn touch_membership_collection(
    tx: &Transaction<'_>,
    collection_id: &str,
    now: i64,
) -> Result<(), String> {
    let has_updated_at = tx
        .query_row(
            "SELECT EXISTS (
                SELECT 1 FROM pragma_table_info('collections') WHERE name = 'updated_at'
             )",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    let sql = if has_updated_at {
        "UPDATE collections
         SET updated_at = ?1,
             dynamic_count = CASE WHEN filter_state IS NOT NULL THEN NULL ELSE dynamic_count END,
             dynamic_thumbnail_path = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_thumbnail_path END,
             dynamic_safe_thumbnail_path = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_safe_thumbnail_path END,
             dynamic_thumbnail_is_sensitive = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_thumbnail_is_sensitive END,
             dynamic_thumbnail_cached_at = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_thumbnail_cached_at END
         WHERE id = ?2"
    } else {
        "UPDATE collections
         SET dynamic_count = CASE WHEN filter_state IS NOT NULL THEN NULL ELSE dynamic_count END,
             dynamic_thumbnail_path = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_thumbnail_path END,
             dynamic_safe_thumbnail_path = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_safe_thumbnail_path END,
             dynamic_thumbnail_is_sensitive = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_thumbnail_is_sensitive END,
             dynamic_thumbnail_cached_at = CASE WHEN custom_thumbnail IS NULL OR custom_thumbnail = '' THEN NULL ELSE dynamic_thumbnail_cached_at END
         WHERE id = ?2"
    };
    tx.execute(sql, params![now, collection_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_invoke_collection_ownership_inner(
    conn: &Connection,
    collection_id: &str,
    action: InvokeCollectionOwnershipAction,
) -> Result<(), String> {
    let collection_id = collection_id.trim();
    if collection_id.is_empty() {
        return Err("Collection ID is required".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let source_state = tx
        .query_row(
            "SELECT c.invoke_source_present, c.invoke_source_name
             FROM collections c
             JOIN invoke_owner_scope_state s ON s.state_key = 'current'
             WHERE c.id = ?1
               AND COALESCE(c.source, 'ambit') = 'invoke'
               AND c.invoke_source_id = s.db_path
               AND (
                    s.scope_mode IN ('legacy', 'all')
                    OR (
                        s.scope_mode = 'owner'
                        AND c.invoke_owner_id IS NOT NULL
                        AND c.invoke_owner_id = s.owner_id
                        AND s.boards_verified = 1
                        AND c.invoke_board_verified = 1
                    )
               )",
            [collection_id],
            |row| Ok((row.get::<_, i64>(0)? != 0, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "InvokeAI collection is unavailable in the active owner scope".to_string()
        })?;

    match action {
        InvokeCollectionOwnershipAction::Suppress => {
            tx.execute(
                "UPDATE collections SET invoke_suppressed = 1 WHERE id = ?1",
                [collection_id],
            )
            .map_err(|error| error.to_string())?;
        }
        InvokeCollectionOwnershipAction::Restore => {
            tx.execute(
                "UPDATE collections SET invoke_suppressed = 0 WHERE id = ?1",
                [collection_id],
            )
            .map_err(|error| error.to_string())?;
        }
        InvokeCollectionOwnershipAction::Reset => {
            let source_name = source_state
                .1
                .filter(|name| !name.trim().is_empty())
                .ok_or_else(|| "InvokeAI collection has no source name to restore".to_string())?;
            if !source_state.0 {
                return Err(
                    "Cannot reset while the InvokeAI source collection is unavailable".to_string(),
                );
            }

            tx.execute(
                "UPDATE collections SET name = ?2 WHERE id = ?1",
                params![collection_id, source_name],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM invoke_board_membership_exclusions WHERE collection_id = ?1",
                [collection_id],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM invoke_board_membership_additions WHERE collection_id = ?1",
                [collection_id],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM collection_images WHERE collection_id = ?1",
                [collection_id],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
                 SELECT snapshot.collection_id, images.id
                 FROM invoke_board_membership_snapshot snapshot
                 JOIN collections c ON c.id = snapshot.collection_id
                 JOIN invoke_owner_scope_state s ON s.state_key = 'current'
                 JOIN images
                   ON images.invoke_image_name = snapshot.invoke_image_name
                   AND images.invoke_source_id IS c.invoke_source_id
                   AND (
                       s.scope_mode IN ('legacy', 'all')
                       OR (
                           s.scope_mode = 'owner'
                           AND images.invoke_owner_id IS s.owner_id
                       )
                   )
                 WHERE snapshot.collection_id = ?1",
                [collection_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    touch_membership_collection(&tx, collection_id, now)?;
    tx.commit().map_err(|error| error.to_string())
}

fn mutate_collection_membership_inner(
    conn: &rusqlite::Connection,
    input: &CollectionMembershipMutationInput,
) -> Result<CollectionMembershipMutationResult, String> {
    let image_ids = normalize_requested_ids(&input.image_ids);
    if image_ids.is_empty() {
        return Err("At least one image is required".to_string());
    }

    let source_id = input
        .source_collection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let target_id = input
        .target_collection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    match input.operation {
        CollectionMembershipOperation::Add if target_id.is_none() => {
            return Err("Adding images requires a target collection".to_string())
        }
        CollectionMembershipOperation::Remove if source_id.is_none() => {
            return Err("Removing images requires a source collection".to_string())
        }
        CollectionMembershipOperation::Move if source_id.is_none() || target_id.is_none() => {
            return Err("Moving images requires source and target collections".to_string())
        }
        CollectionMembershipOperation::Move if source_id == target_id => {
            return Err("Source and target collections must be different".to_string())
        }
        _ => {}
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let source = source_id
        .map(|id| load_membership_collection(&tx, id))
        .transpose()?;
    let target = target_id
        .map(|id| load_membership_collection(&tx, id))
        .transpose()?;

    for image_id in &image_ids {
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM scoped_images WHERE id = ?1 AND invoke_scope_hidden = 0)",
                [image_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !exists {
            return Err(format!("Image '{}' is no longer available", image_id));
        }
    }

    if matches!(
        input.operation,
        CollectionMembershipOperation::Remove | CollectionMembershipOperation::Move
    ) {
        let source = source.as_ref().expect("source validated above");
        add_manual_exclusions(&tx, source, &image_ids)?;
        persist_invoke_membership_removals(&tx, source, &image_ids)?;
        for image_id in &image_ids {
            tx.execute(
                "DELETE FROM collection_images WHERE collection_id = ?1 AND image_id = ?2",
                params![source.id, image_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }

    if matches!(
        input.operation,
        CollectionMembershipOperation::Add | CollectionMembershipOperation::Move
    ) {
        let target = target.as_ref().expect("target validated above");
        for image_id in &image_ids {
            validate_image_for_collection_scope(&tx, target, image_id)?;
        }
        remove_manual_exclusions(&tx, target, &image_ids)?;
        persist_invoke_membership_additions(&tx, target, &image_ids)?;
        for image_id in &image_ids {
            tx.execute(
                "INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?1, ?2)",
                params![target.id, image_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    if let Some(source) = &source {
        touch_membership_collection(&tx, &source.id, now)?;
    }
    if let Some(target) = &target {
        touch_membership_collection(&tx, &target.id, now)?;
    }
    tx.commit().map_err(|error| error.to_string())?;

    Ok(CollectionMembershipMutationResult {
        affected_ids: image_ids,
        source_collection_id: source.map(|collection| collection.id),
        target_collection_id: target.map(|collection| collection.id),
    })
}

fn migrate_legacy_collections_inner(
    conn: &rusqlite::Connection,
    input: &LegacyCollectionMigrationInput,
) -> Result<LegacyCollectionMigrationResult, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut result = LegacyCollectionMigrationResult::default();

    let import_key = input.import_key.trim();
    if import_key.is_empty() {
        return Err("Legacy collection migration requires an import key".to_string());
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS legacy_collection_import_receipts (
            import_key TEXT PRIMARY KEY,
            completed_at INTEGER NOT NULL
        );",
    )
    .map_err(|error| error.to_string())?;
    if tx
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM legacy_collection_import_receipts WHERE import_key = ?1
            )",
            [import_key],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?
    {
        result.already_applied = true;
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(result);
    }

    for collection in &input.collections {
        let id = collection.id.trim();
        let name = collection.name.trim();
        if id.is_empty() || name.is_empty() {
            return Err("Legacy collections require a non-empty ID and name".to_string());
        }

        let updated_at = collection.updated_at.unwrap_or(collection.created_at);
        tx.execute(
            "INSERT INTO collections (
                id, name, color, is_archived, is_pinned, created_at, filter_state,
                manual_exclusions, custom_thumbnail, source, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'ambit', ?10)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                color = excluded.color,
                is_archived = excluded.is_archived,
                is_pinned = excluded.is_pinned,
                created_at = excluded.created_at,
                filter_state = excluded.filter_state,
                manual_exclusions = excluded.manual_exclusions,
                custom_thumbnail = excluded.custom_thumbnail,
                updated_at = excluded.updated_at",
            params![
                id,
                name,
                collection.color,
                i64::from(collection.is_archived),
                i64::from(collection.is_pinned),
                collection.created_at,
                collection.filter_state,
                collection.manual_exclusions,
                collection.custom_thumbnail,
                updated_at,
            ],
        )
        .map_err(|error| error.to_string())?;
        result.collections_upserted += 1;

        for image_id in normalize_requested_ids(&collection.image_ids) {
            result.memberships_inserted += tx
                .execute(
                    "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
                     SELECT ?1, id FROM images WHERE id = ?2",
                    params![id, image_id],
                )
                .map_err(|error| error.to_string())?;
        }
    }

    let completed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    tx.execute(
        "INSERT INTO legacy_collection_import_receipts (import_key, completed_at)
         VALUES (?1, ?2)",
        params![import_key, completed_at],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

fn update_ambit_collection_scope_inner(
    conn: &rusqlite::Connection,
    input: &UpdateAmbitCollectionScopeInput,
) -> Result<UpdateAmbitCollectionScopeResult, String> {
    let collection_id = input.collection_id.trim();
    if collection_id.is_empty() {
        return Err("Collection ID is required".to_string());
    }

    let db_path = input
        .db_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let owner_id = input
        .owner_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let (target_source_id, target_owner_id) = match input.mode {
        AmbitCollectionScopeMode::Global => (None, None),
        AmbitCollectionScopeMode::All => {
            (
                Some(db_path.ok_or_else(|| {
                    "All Users visibility requires an InvokeAI database".to_string()
                })?),
                None,
            )
        }
        AmbitCollectionScopeMode::Owner => (
            Some(
                db_path
                    .ok_or_else(|| "Owner visibility requires an InvokeAI database".to_string())?,
            ),
            Some(owner_id.ok_or_else(|| "Owner visibility requires an owner".to_string())?),
        ),
    };

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut validation_state = load_membership_collection(&tx, collection_id)?;
    if validation_state.source == "invoke" {
        return Err("InvokeAI board ownership is managed by InvokeAI".to_string());
    }
    validation_state.invoke_source_id = target_source_id.map(str::to_string);
    validation_state.invoke_owner_id = target_owner_id.map(str::to_string);

    let candidate_ids = {
        let mut statement = tx
            .prepare(
                "SELECT image_id FROM collection_images WHERE collection_id = ?1
                 UNION
                 SELECT COALESCE(
                     (SELECT by_id.id FROM images by_id
                      WHERE by_id.id = collections.custom_thumbnail),
                     (SELECT by_path.id FROM images by_path
                      WHERE by_path.path = collections.custom_thumbnail),
                     collections.custom_thumbnail
                 )
                 FROM collections
                 WHERE id = ?1 AND custom_thumbnail IS NOT NULL AND custom_thumbnail != ''",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([collection_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };

    for image_id in &candidate_ids {
        validate_image_for_collection_scope(&tx, &validation_state, image_id)?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let has_updated_at = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM pragma_table_info('collections') WHERE name = 'updated_at')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    let update_sql = if has_updated_at {
        "UPDATE collections
         SET invoke_source_id = ?1, invoke_owner_id = ?2, updated_at = ?3,
             dynamic_count = NULL, dynamic_thumbnail_path = NULL,
             dynamic_safe_thumbnail_path = NULL, dynamic_thumbnail_is_sensitive = NULL,
             dynamic_thumbnail_cached_at = NULL
         WHERE id = ?4"
    } else {
        "UPDATE collections
         SET invoke_source_id = ?1, invoke_owner_id = ?2,
             dynamic_count = NULL, dynamic_thumbnail_path = NULL,
             dynamic_safe_thumbnail_path = NULL, dynamic_thumbnail_is_sensitive = NULL,
             dynamic_thumbnail_cached_at = NULL
         WHERE id = ?4"
    };
    tx.execute(
        update_sql,
        params![target_source_id, target_owner_id, now, collection_id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;

    Ok(UpdateAmbitCollectionScopeResult {
        collection_id: collection_id.to_string(),
        invoke_source_id: target_source_id.map(str::to_string),
        invoke_owner_id: target_owner_id.map(str::to_string),
    })
}

fn set_collection_custom_thumbnail_inner(
    conn: &rusqlite::Connection,
    collection_id: &str,
    image_id: Option<&str>,
) -> Result<(), String> {
    let collection_id = collection_id.trim();
    if collection_id.is_empty() {
        return Err("Collection ID is required".to_string());
    }
    let image_id = image_id.map(str::trim).filter(|value| !value.is_empty());
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let collection = load_membership_collection(&tx, collection_id)?;
    if let Some(image_id) = image_id {
        let visible: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM scoped_images WHERE id = ?1 AND invoke_scope_hidden = 0)",
                [image_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !visible {
            return Err(format!("Image '{}' is no longer available", image_id));
        }
        validate_image_for_collection_scope(&tx, &collection, image_id)?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let has_updated_at = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM pragma_table_info('collections') WHERE name = 'updated_at')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if has_updated_at {
        tx.execute(
            "UPDATE collections SET custom_thumbnail = ?1, updated_at = ?2 WHERE id = ?3",
            params![image_id, now, collection_id],
        )
        .map_err(|error| error.to_string())?;
    } else {
        tx.execute(
            "UPDATE collections SET custom_thumbnail = ?1 WHERE id = ?2",
            params![image_id, collection_id],
        )
        .map_err(|error| error.to_string())?;
    }
    if image_id.is_none() {
        tx.execute(
            "UPDATE collections SET dynamic_thumbnail_path = NULL,
                 dynamic_safe_thumbnail_path = NULL, dynamic_thumbnail_is_sensitive = NULL,
                 dynamic_thumbnail_cached_at = NULL WHERE id = ?1",
            [collection_id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn resolve_exact_duplicate_groups_inner(
    conn: &rusqlite::Connection,
    resolutions: &[ExactDuplicateResolution],
) -> Result<ExactDuplicateResolutionResult, String> {
    let _lifecycle_guard = lock_removed_lifecycle();
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
            .query_row(
                "SELECT COUNT(*) FROM scoped_images WHERE invoke_scope_hidden = 0",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let deleted_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_images WHERE invoke_scope_hidden = 0 AND is_deleted = 1",
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
                "SELECT COUNT(*) FROM scoped_images WHERE invoke_scope_hidden = 0 AND json_extract(metadata_json, '$.tool') IS NULL",
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
pub async fn remove_images_from_library(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<RemovedLifecycleMutationResult, String> {
    run_blocking(app, move |conn| {
        remove_images_from_library_inner(conn, &ids)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn restore_removed_images(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<RemovedLifecycleMutationResult, String> {
    run_blocking(app, move |conn| restore_removed_images_inner(conn, &ids)).await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn mutate_collection_membership(
    app: AppHandle,
    input: CollectionMembershipMutationInput,
) -> Result<CollectionMembershipMutationResult, String> {
    run_blocking(app, move |conn| {
        mutate_collection_membership_inner(conn, &input)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn update_invoke_collection_ownership(
    app: AppHandle,
    collection_id: String,
    action: InvokeCollectionOwnershipAction,
) -> Result<(), String> {
    run_blocking(app, move |conn| {
        update_invoke_collection_ownership_inner(conn, &collection_id, action)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn migrate_legacy_collections(
    app: AppHandle,
    input: LegacyCollectionMigrationInput,
) -> Result<LegacyCollectionMigrationResult, String> {
    run_blocking(app, move |conn| {
        migrate_legacy_collections_inner(conn, &input)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn update_ambit_collection_scope(
    app: AppHandle,
    input: UpdateAmbitCollectionScopeInput,
) -> Result<UpdateAmbitCollectionScopeResult, String> {
    run_blocking(app, move |conn| {
        update_ambit_collection_scope_inner(conn, &input)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn set_collection_custom_thumbnail(
    app: AppHandle,
    collection_id: String,
    image_id: Option<String>,
) -> Result<(), String> {
    run_blocking(app, move |conn| {
        set_collection_custom_thumbnail_inner(conn, &collection_id, image_id.as_deref())
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
        let rows = load_file_hash_candidates(conn, requested_limit)?;

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
                match hash_file_sha256_cancellable(path, &is_cancelled) {
                    Ok(Some(hash)) => {
                        update_hash
                            .execute(params![hash, id])
                            .map_err(|e| e.to_string())?;
                        updated += 1;
                    }
                    Ok(None) => {
                        was_cancelled = true;
                        break;
                    }
                    Err(e) => {
                        log::warn!("[Maintenance] Failed to hash media file {}: {}", path, e);
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
                        message: "Hashing media for exact duplicate detection...".to_string(),
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }

        drop(update_hash);
        drop(mark_missing);

        let remaining = count_remaining_file_hash_candidates(conn);

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
        ensure_log_directory, hash_file_sha256, hash_file_sha256_cancellable,
        load_file_hash_candidates, migrate_legacy_collections_inner,
        mutate_collection_membership_inner, remove_images_from_library_inner, resolve_app_log_path,
        resolve_exact_duplicate_groups_inner, restore_removed_images_inner,
        update_ambit_collection_scope_inner, update_invoke_collection_ownership_inner,
        AmbitCollectionScopeMode, CollectionMembershipMutationInput, CollectionMembershipOperation,
        ExactDuplicateResolution, InvokeCollectionOwnershipAction, LegacyCollectionMigrationInput,
        LegacyCollectionMigrationItem, UpdateAmbitCollectionScopeInput,
    };
    use crate::db::migrations::init_db;
    use rusqlite::{params, Connection};
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::AtomicBool;

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

    fn activate_test_owner_scope(conn: &Connection, mode: &str, owner_id: Option<&str>) {
        conn.execute(
            "INSERT INTO invoke_owner_scope_state
                (state_key, db_path, images_root, scope_mode, owner_id, updated_at)
             VALUES ('current', 'invoke.db', 'C:/Invoke', ?1, ?2, 1)
             ON CONFLICT(state_key) DO UPDATE SET scope_mode = excluded.scope_mode,
                 owner_id = excluded.owner_id",
            params![mode, owner_id],
        )
        .expect("activate test scope");
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
    fn file_hashing_honors_cancellation_before_reading_the_next_chunk() {
        let path = std::env::temp_dir().join("ambit_hash_cancel_test.bin");
        File::create(&path)
            .unwrap()
            .write_all(b"bytes that must remain unhashed")
            .unwrap();
        let is_cancelled = AtomicBool::new(true);

        let result = hash_file_sha256_cancellable(&path.to_string_lossy(), &is_cancelled).unwrap();

        let _ = std::fs::remove_file(path);
        assert_eq!(result, None);
    }

    #[test]
    fn file_hash_candidates_include_images_and_videos_with_matching_sizes() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(&conn, "image", "", false, false, None, "{}", None, None);
        seed_image(&conn, "video", "", false, false, None, "{}", None, None);
        seed_image(&conn, "unique", "", false, false, None, "{}", None, None);
        conn.execute(
            "UPDATE images
             SET media_type = 'video', duration_ms = 1000, video_codec = 'h264',
                 audio_present = 0, rotation_degrees = 0, probe_status = 'ready',
                 playback_status = 'playable'
             WHERE id = 'video'",
            [],
        )
        .unwrap();
        conn.execute("UPDATE images SET file_size = 200 WHERE id = 'unique'", [])
            .unwrap();

        let candidates = load_file_hash_candidates(&conn, i64::MAX).unwrap();
        let mut ids = candidates.into_iter().map(|(id, _)| id).collect::<Vec<_>>();
        ids.sort();

        assert_eq!(ids, ["image", "video"]);
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
    fn removed_lifecycle_is_transactional_and_restores_memberships_and_resources() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let metadata = r#"{
            "tool":"ComfyUI","model":"model.safetensors","steps":20,"seed":42,
            "cfg":7.5,"sampler":"euler_a","positivePrompt":"prompt",
            "loras":["detail.safetensors (0.8)"],"embeddings":["style.pt"],
            "hypernetworks":["hyper.ckpt"],"controlNets":["control.safetensors"],
            "ipAdapters":["adapter.bin"]
        }"#;
        seed_image(
            &conn,
            "C:/library/image.png",
            "hash",
            true,
            true,
            Some(false),
            metadata,
            Some("board-a"),
            Some("notes"),
        );
        conn.execute(
            "UPDATE images SET parser_version = 17 WHERE id = 'C:/library/image.png'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collections (
                id, name, created_at, dynamic_thumbnail_path, dynamic_thumbnail_cached_at
             ) VALUES ('collection-a', 'Collection', 1, 'cached.webp', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id)
             VALUES ('collection-a', 'C:/library/image.png')",
            [],
        )
        .unwrap();

        let removed = remove_images_from_library_inner(
            &conn,
            &["C:\\library\\image.png".to_string(), "unknown".to_string()],
        )
        .expect("remove image transactionally");

        assert_eq!(removed.affected_ids, ["C:/library/image.png"]);
        assert_eq!(removed.not_found_ids, ["unknown"]);
        assert_eq!(removed.touched_resources.checkpoints, ["model"]);
        assert_eq!(removed.touched_resources.loras, ["detail"]);
        assert_eq!(removed.touched_resources.tools, ["ComfyUI"]);
        assert_eq!(table_count(&conn, "images"), 0);
        assert_eq!(table_count(&conn, "removed_images"), 1);
        assert_eq!(table_count(&conn, "collection_images"), 0);
        let cached_path: Option<String> = conn
            .query_row(
                "SELECT dynamic_thumbnail_path FROM collections WHERE id = 'collection-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cached_path, None);

        let restored = restore_removed_images_inner(&conn, &["C:/library/image.png".to_string()])
            .expect("restore image transactionally");

        assert_eq!(restored.affected_ids, ["C:/library/image.png"]);
        assert!(restored.membership_warning_ids.is_empty());
        assert_eq!(table_count(&conn, "images"), 1);
        assert_eq!(table_count(&conn, "removed_images"), 0);
        assert_eq!(table_count(&conn, "collection_images"), 1);
        for table in [
            "image_loras",
            "image_embeddings",
            "image_hypernetworks",
            "image_controlnets",
            "image_ipadapters",
        ] {
            assert_eq!(table_count(&conn, table), 1, "restored {table}");
        }
        let restored_state: (
            i64,
            i64,
            Option<i64>,
            String,
            i64,
            Option<i64>,
            Option<String>,
            i64,
        ) = conn
            .query_row(
                "SELECT is_favorite, is_pinned, user_masked, model_name, steps, seed,
                        file_hash, parser_version
                 FROM images WHERE id = 'C:/library/image.png'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            restored_state,
            (
                1,
                1,
                Some(0),
                "model.safetensors".to_string(),
                20,
                Some(42),
                Some("hash".to_string()),
                17,
            )
        );
    }

    #[test]
    fn restore_preserves_video_state_and_rechecks_local_source_presence() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let root = std::env::temp_dir().join(format!(
            "ambit_removed_video_restore_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let present_path = root.join("present.webm");
        let missing_path = root.join("missing.webm");
        std::fs::write(&present_path, b"present").unwrap();
        std::fs::write(&missing_path, b"removed later").unwrap();
        let present_id = present_path.to_string_lossy().replace('\\', "/");
        let missing_id = missing_path.to_string_lossy().replace('\\', "/");

        for id in [&present_id, &missing_id] {
            seed_image(
                &conn,
                id,
                "video-hash",
                true,
                true,
                Some(true),
                "{}",
                None,
                Some("video notes"),
            );
            conn.execute(
                "UPDATE images
                 SET timestamp = 4242, media_type = 'video', media_container = 'webm',
                     media_mime_type = 'video/webm', duration_ms = 2000,
                     video_codec = 'vp9', video_profile = '0', audio_present = 1,
                     audio_codec = 'opus', frame_rate_num = 30, frame_rate_den = 1,
                     rotation_degrees = 0, probe_status = 'ready', playback_status = 'playable'
                 WHERE id = ?1",
                [id],
            )
            .unwrap();
        }

        remove_images_from_library_inner(&conn, &[present_id.clone(), missing_id.clone()]).unwrap();
        std::fs::remove_file(&missing_path).unwrap();
        restore_removed_images_inner(&conn, &[present_id.clone(), missing_id.clone()]).unwrap();

        let restored = |id: &str| {
            conn.query_row(
                "SELECT timestamp, is_missing, media_type, media_container, media_mime_type,
                        duration_ms, video_codec, video_profile, audio_present, audio_codec,
                        frame_rate_num, frame_rate_den, rotation_degrees, probe_status,
                        playback_status, is_favorite, is_pinned, user_masked, notes
                 FROM images WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        (
                            (
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, String>(4)?,
                                row.get::<_, i64>(5)?,
                                row.get::<_, String>(6)?,
                                row.get::<_, String>(7)?,
                                row.get::<_, i64>(8)?,
                                row.get::<_, String>(9)?,
                            ),
                            (
                                row.get::<_, i64>(10)?,
                                row.get::<_, i64>(11)?,
                                row.get::<_, i64>(12)?,
                                row.get::<_, String>(13)?,
                                row.get::<_, String>(14)?,
                                row.get::<_, i64>(15)?,
                                row.get::<_, i64>(16)?,
                                row.get::<_, Option<i64>>(17)?,
                                row.get::<_, String>(18)?,
                            ),
                        ),
                    ))
                },
            )
            .unwrap()
        };
        let expected_state = (
            (
                "video".to_string(),
                "webm".to_string(),
                "video/webm".to_string(),
                2000,
                "vp9".to_string(),
                "0".to_string(),
                1,
                "opus".to_string(),
            ),
            (
                30,
                1,
                0,
                "ready".to_string(),
                "playable".to_string(),
                1,
                1,
                Some(1),
                "video notes".to_string(),
            ),
        );
        let present = restored(&present_id);
        let missing = restored(&missing_id);
        assert_eq!(
            present.0, 4242,
            "restore must preserve the original library timestamp"
        );
        assert_eq!(
            missing.0, 4242,
            "restore must preserve the original library timestamp"
        );
        assert_eq!(
            present.1, 0,
            "an existing source must remain available after restore"
        );
        assert_eq!(
            missing.1, 1,
            "a removed source must restore as missing instead of playable"
        );
        assert_eq!(present.2, expected_state);
        assert_eq!(missing.2, expected_state);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_removed_rows_restore_as_needing_reparse() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(&conn, "image", "hash", false, false, None, "{}", None, None);
        remove_images_from_library_inner(&conn, &["image".to_string()]).unwrap();
        conn.execute(
            "UPDATE removed_images SET file_hash = NULL, parser_version = NULL WHERE id = 'image'",
            [],
        )
        .unwrap();

        restore_removed_images_inner(&conn, &["image".to_string()]).unwrap();

        let restored: (Option<String>, i64) = conn
            .query_row(
                "SELECT file_hash, parser_version FROM images WHERE id = 'image'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(restored, (None, 0));
    }

    #[test]
    fn removed_lifecycle_rolls_back_tombstone_when_active_delete_fails() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(&conn, "image", "hash", false, false, None, "{}", None, None);
        conn.execute_batch(
            "CREATE TRIGGER block_image_delete BEFORE DELETE ON images
             BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        )
        .unwrap();

        let error = remove_images_from_library_inner(&conn, &["image".to_string()])
            .expect_err("failed delete must roll back the tombstone");

        assert!(error.contains("blocked"));
        assert_eq!(table_count(&conn, "images"), 1);
        assert_eq!(table_count(&conn, "removed_images"), 0);
    }

    #[test]
    fn restore_keeps_image_when_legacy_membership_json_is_malformed() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(&conn, "image", "hash", false, false, None, "{}", None, None);
        remove_images_from_library_inner(&conn, &["image".to_string()]).unwrap();
        conn.execute(
            "UPDATE removed_images SET collection_ids_json = '{' WHERE id = 'image'",
            [],
        )
        .unwrap();

        let restored = restore_removed_images_inner(&conn, &["image".to_string()])
            .expect("bad legacy membership data must not block image restore");

        assert_eq!(restored.affected_ids, ["image"]);
        assert_eq!(restored.membership_warning_ids, ["image"]);
        assert_eq!(table_count(&conn, "images"), 1);
        assert_eq!(table_count(&conn, "removed_images"), 0);
    }

    #[test]
    fn restore_reprojects_invoke_membership_from_current_source_and_local_overrides() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "owner", Some("owner-a"));
        seed_image(
            &conn,
            "source-image",
            "source-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "added-image",
            "added-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute_batch(
            "UPDATE images
             SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'source.png', board_id = 'board'
             WHERE id = 'source-image';
             INSERT INTO collections (
                 id, name, created_at, source, invoke_source_id, invoke_owner_id,
                 invoke_source_name
             ) VALUES ('board', 'Board', 1, 'invoke', 'invoke.db', 'owner-a', 'Board');
             INSERT INTO invoke_board_membership_snapshot VALUES ('board', 'source.png');
             INSERT INTO invoke_board_membership_additions VALUES ('board', 'added-image');
             INSERT INTO collection_images VALUES
                 ('board', 'source-image'),
                 ('board', 'added-image');",
        )
        .expect("seed Invoke membership state");

        remove_images_from_library_inner(
            &conn,
            &["source-image".to_string(), "added-image".to_string()],
        )
        .expect("remove images");
        conn.execute_batch(
            "INSERT INTO invoke_board_membership_exclusions VALUES ('board', 'source.png');
             UPDATE removed_images SET collection_ids_json = '[]' WHERE id = 'added-image';",
        )
        .expect("change effective organization while removed");

        restore_removed_images_inner(
            &conn,
            &["source-image".to_string(), "added-image".to_string()],
        )
        .expect("restore images");

        let memberships: Vec<(String, String)> = conn
            .prepare(
                "SELECT collection_id, image_id FROM collection_images
                 ORDER BY collection_id, image_id",
            )
            .expect("prepare memberships")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query memberships")
            .collect::<Result<_, _>>()
            .expect("collect memberships");
        assert_eq!(
            memberships,
            vec![("board".to_string(), "added-image".to_string())]
        );
    }

    #[test]
    fn collection_move_is_atomic_and_preserves_hybrid_exclusion_semantics() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(&conn, "image", "hash", false, false, None, "{}", None, None);
        conn.execute(
            r#"INSERT INTO collections (
                id, name, created_at, filter_state, manual_exclusions,
                dynamic_thumbnail_path, dynamic_thumbnail_cached_at
             ) VALUES
                ('smart-source', 'Smart', 1, '{}', '["existing"]', 'source.webp', 1),
                ('target', 'Target', 1, '{}', '["image","target-existing"]', 'target.webp', 1)"#,
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id)
             VALUES ('smart-source', 'image')",
            [],
        )
        .unwrap();

        let result = mutate_collection_membership_inner(
            &conn,
            &CollectionMembershipMutationInput {
                operation: CollectionMembershipOperation::Move,
                image_ids: vec!["image".to_string(), "image".to_string()],
                source_collection_id: Some("smart-source".to_string()),
                target_collection_id: Some("target".to_string()),
            },
        )
        .expect("move membership transactionally");

        assert_eq!(result.affected_ids, ["image"]);
        let memberships = conn
            .prepare("SELECT collection_id FROM collection_images WHERE image_id = 'image'")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(memberships, ["target"]);
        let exclusions: String = conn
            .query_row(
                "SELECT manual_exclusions FROM collections WHERE id = 'smart-source'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exclusions, r#"["existing","image"]"#);
        let target_exclusions: String = conn
            .query_row(
                "SELECT manual_exclusions FROM collections WHERE id = 'target'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(target_exclusions, r#"["target-existing"]"#);
        for collection_id in ["smart-source", "target"] {
            let cached: Option<String> = conn
                .query_row(
                    "SELECT dynamic_thumbnail_path FROM collections WHERE id = ?1",
                    [collection_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(cached, None);
        }
    }

    #[test]
    fn invoke_collection_move_persists_source_exclusion_and_target_addition() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "owner", Some("owner-a"));
        seed_image(&conn, "image", "hash", false, false, None, "{}", None, None);
        conn.execute_batch(
            "UPDATE images
             SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'image.png', board_id = 'source'
             WHERE id = 'image';
             INSERT INTO collections (
                 id, name, created_at, source, invoke_source_id, invoke_owner_id,
                 invoke_source_name
             ) VALUES
                 ('source', 'Source', 1, 'invoke', 'invoke.db', 'owner-a', 'Source'),
                 ('target', 'Target', 1, 'invoke', 'invoke.db', 'owner-a', 'Target');
             INSERT INTO invoke_board_membership_snapshot VALUES ('source', 'image.png');
             INSERT INTO collection_images VALUES ('source', 'image');",
        )
        .expect("seed Invoke collections");

        mutate_collection_membership_inner(
            &conn,
            &CollectionMembershipMutationInput {
                operation: CollectionMembershipOperation::Move,
                image_ids: vec!["image".to_string()],
                source_collection_id: Some("source".to_string()),
                target_collection_id: Some("target".to_string()),
            },
        )
        .expect("move Invoke membership");

        let exclusion: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_board_membership_exclusions
                 WHERE collection_id = 'source' AND invoke_image_name = 'image.png'",
                [],
                |row| row.get(0),
            )
            .expect("source exclusion");
        let addition: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_board_membership_additions
                 WHERE collection_id = 'target' AND image_id = 'image'",
                [],
                |row| row.get(0),
            )
            .expect("target addition");
        assert_eq!(exclusion, 1);
        assert_eq!(addition, 1);
    }

    #[test]
    fn invoke_collection_lifecycle_suppresses_restores_and_resets_local_overrides() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "owner", Some("owner-a"));
        seed_image(
            &conn,
            "source-image",
            "source",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "local-image",
            "local",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute_batch(
            "UPDATE images
             SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'source.png', board_id = 'board'
             WHERE id = 'source-image';
             UPDATE images
             SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'local.png', board_id = NULL
             WHERE id = 'local-image';
             INSERT INTO collections (
                 id, name, created_at, source, invoke_source_id, invoke_owner_id,
                 invoke_source_name
             ) VALUES (
                 'board', 'Local label', 1, 'invoke', 'invoke.db', 'owner-a',
                 'Upstream label'
             );
             INSERT INTO invoke_board_membership_snapshot VALUES ('board', 'source.png');
             INSERT INTO invoke_board_membership_exclusions VALUES ('board', 'source.png');
             INSERT INTO invoke_board_membership_additions VALUES ('board', 'local-image');
             INSERT INTO collection_images VALUES ('board', 'local-image');",
        )
        .expect("seed local overrides");

        update_invoke_collection_ownership_inner(
            &conn,
            "board",
            InvokeCollectionOwnershipAction::Reset,
        )
        .expect("reset local overrides");
        let reset_state: (String, i64, i64, String) = conn
            .query_row(
                "SELECT collections.name,
                        (SELECT COUNT(*) FROM invoke_board_membership_exclusions),
                        (SELECT COUNT(*) FROM invoke_board_membership_additions),
                        collection_images.image_id
                 FROM collections
                 JOIN collection_images ON collection_images.collection_id = collections.id
                 WHERE collections.id = 'board'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("reset state");
        assert_eq!(
            reset_state,
            (
                "Upstream label".to_string(),
                0,
                0,
                "source-image".to_string()
            )
        );

        update_invoke_collection_ownership_inner(
            &conn,
            "board",
            InvokeCollectionOwnershipAction::Suppress,
        )
        .expect("suppress collection");
        let visible_while_suppressed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_collections WHERE id = 'board'",
                [],
                |row| row.get(0),
            )
            .expect("suppressed visibility");
        assert_eq!(visible_while_suppressed, 0);

        update_invoke_collection_ownership_inner(
            &conn,
            "board",
            InvokeCollectionOwnershipAction::Restore,
        )
        .expect("restore collection");
        let visible_after_restore: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_collections WHERE id = 'board'",
                [],
                |row| row.get(0),
            )
            .expect("restored visibility");
        assert_eq!(visible_after_restore, 1);
    }

    #[test]
    fn invoke_collection_reset_restores_owned_images_in_unowned_boards_for_all_users() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "all", None);
        seed_image(
            &conn,
            "owned-image",
            "source",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute_batch(
            "UPDATE images
             SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'owned.png', board_id = 'unowned-board'
             WHERE id = 'owned-image';
             INSERT INTO collections (
                 id, name, created_at, source, invoke_source_id, invoke_owner_id,
                 invoke_source_name
             ) VALUES (
                 'unowned-board', 'Local label', 1, 'invoke', 'invoke.db', NULL,
                 'Source label'
             );
             INSERT INTO invoke_board_membership_snapshot
             VALUES ('unowned-board', 'owned.png');",
        )
        .expect("seed unowned source board");

        update_invoke_collection_ownership_inner(
            &conn,
            "unowned-board",
            InvokeCollectionOwnershipAction::Reset,
        )
        .expect("reset unowned source board");

        let memberships: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collection_images
                 WHERE collection_id = 'unowned-board' AND image_id = 'owned-image'",
                [],
                |row| row.get(0),
            )
            .expect("reset membership count");
        assert_eq!(
            memberships, 1,
            "All Users must materialize the authoritative relationship even when the board has no owner"
        );
    }

    #[test]
    fn collection_move_rolls_back_source_changes_when_target_insert_fails() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(&conn, "image", "hash", false, false, None, "{}", None, None);
        conn.execute(
            r#"INSERT INTO collections (id, name, created_at, filter_state, manual_exclusions)
             VALUES ('source', 'Source', 1, NULL, NULL),
                    ('target', 'Target', 1, '{}', '["image"]')"#,
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id) VALUES ('source', 'image')",
            [],
        )
        .unwrap();
        conn.execute_batch(
            "CREATE TRIGGER block_target_membership BEFORE INSERT ON collection_images
             WHEN NEW.collection_id = 'target'
             BEGIN SELECT RAISE(ABORT, 'target blocked'); END;",
        )
        .unwrap();

        let error = mutate_collection_membership_inner(
            &conn,
            &CollectionMembershipMutationInput {
                operation: CollectionMembershipOperation::Move,
                image_ids: vec!["image".to_string()],
                source_collection_id: Some("source".to_string()),
                target_collection_id: Some("target".to_string()),
            },
        )
        .expect_err("target failure must roll back the source removal");

        assert!(error.contains("target blocked"));
        let source_membership: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collection_images
                 WHERE collection_id = 'source' AND image_id = 'image'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_membership, 1);
        assert_eq!(table_count(&conn, "collection_images"), 1);
        let target_exclusions: String = conn
            .query_row(
                "SELECT manual_exclusions FROM collections WHERE id = 'target'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(target_exclusions, r#"["image"]"#);
    }

    fn table_count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
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
    fn exact_duplicate_resolution_preserves_invoke_source_facts_in_removed_state() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(
            &conn,
            "keeper",
            "same-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "invoke-copy",
            "same-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute(
            "UPDATE images
             SET invoke_image_name = 'control.png',
                 invoke_image_category = 'control',
                 invoke_image_origin = 'internal',
                 invoke_owner_id = 'owner-a'
             WHERE id = 'invoke-copy'",
            [],
        )
        .expect("seed InvokeAI source facts");

        resolve_exact_duplicate_groups_inner(
            &conn,
            &[ExactDuplicateResolution {
                keep_id: "keeper".to_string(),
                remove_ids: vec!["invoke-copy".to_string()],
            }],
        )
        .expect("resolve InvokeAI duplicate");

        let source_facts: (String, String, String, String, i64) = conn
            .query_row(
                "SELECT invoke_image_name, invoke_image_category, invoke_image_origin,
                        invoke_owner_id, invoke_scope_hidden
                 FROM removed_images WHERE id = 'invoke-copy'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("load removed InvokeAI source facts");
        assert_eq!(
            source_facts,
            (
                "control.png".to_string(),
                "control".to_string(),
                "internal".to_string(),
                "owner-a".to_string(),
                0,
            )
        );
    }

    #[test]
    fn exact_duplicate_resolution_rejects_owner_hidden_rows() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        seed_image(
            &conn,
            "keeper",
            "same-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "hidden-copy",
            "same-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute(
            "UPDATE images SET invoke_scope_hidden = 1 WHERE id = 'hidden-copy'",
            [],
        )
        .expect("hide out-of-scope duplicate");

        let error = resolve_exact_duplicate_groups_inner(
            &conn,
            &[ExactDuplicateResolution {
                keep_id: "keeper".to_string(),
                remove_ids: vec!["hidden-copy".to_string()],
            }],
        )
        .expect_err("owner-hidden duplicate must be rejected");

        assert!(error.contains("no longer available"));
        let active_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
            .expect("count active images");
        let removed_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM removed_images", [], |row| row.get(0))
            .expect("count removed images");
        assert_eq!(active_count, 2);
        assert_eq!(removed_count, 0);
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

    #[test]
    fn all_users_cannot_add_another_owners_image_to_an_owner_scoped_ambit_collection() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "all", None);
        seed_image(
            &conn,
            "owner-a-image",
            "a",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "owner-b-image",
            "b",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute_batch(
            "UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a'
             WHERE id = 'owner-a-image';
             UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-b'
             WHERE id = 'owner-b-image';
             INSERT INTO collections (id, name, created_at, source, invoke_source_id, invoke_owner_id)
             VALUES ('owner-a-collection', 'Owner A', 1, 'ambit', 'invoke.db', 'owner-a');",
        )
        .expect("seed scoped rows");

        let error = mutate_collection_membership_inner(
            &conn,
            &CollectionMembershipMutationInput {
                operation: CollectionMembershipOperation::Add,
                image_ids: vec!["owner-b-image".to_string()],
                source_collection_id: None,
                target_collection_id: Some("owner-a-collection".to_string()),
            },
        )
        .expect_err("cross-owner membership must fail");

        assert!(error.contains("different InvokeAI owner"));
        assert_eq!(table_count(&conn, "collection_images"), 0);
    }

    #[test]
    fn collection_scope_reassignment_is_atomic_and_accepts_mixed_owners_only_for_all_users() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "all", None);
        seed_image(
            &conn,
            "owner-a-image",
            "a",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "owner-b-image",
            "b",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute_batch(
            "UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a'
             WHERE id = 'owner-a-image';
             UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-b'
             WHERE id = 'owner-b-image';
             INSERT INTO collections (id, name, created_at, source)
             VALUES ('mixed', 'Mixed', 1, 'ambit');
             INSERT INTO collection_images VALUES ('mixed', 'owner-a-image');
             INSERT INTO collection_images VALUES ('mixed', 'owner-b-image');",
        )
        .expect("seed mixed collection");

        let owner_error = update_ambit_collection_scope_inner(
            &conn,
            &UpdateAmbitCollectionScopeInput {
                collection_id: "mixed".to_string(),
                mode: AmbitCollectionScopeMode::Owner,
                db_path: Some("invoke.db".to_string()),
                owner_id: Some("owner-a".to_string()),
            },
        )
        .expect_err("mixed collection cannot become owner scoped");
        assert!(owner_error.contains("different InvokeAI owner"));
        let unchanged: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id FROM collections WHERE id = 'mixed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("unchanged scope");
        assert_eq!(unchanged, (None, None));

        let result = update_ambit_collection_scope_inner(
            &conn,
            &UpdateAmbitCollectionScopeInput {
                collection_id: "mixed".to_string(),
                mode: AmbitCollectionScopeMode::All,
                db_path: Some("invoke.db".to_string()),
                owner_id: None,
            },
        )
        .expect("All Users accepts mixed owners");
        assert_eq!(result.invoke_source_id.as_deref(), Some("invoke.db"));
        assert_eq!(result.invoke_owner_id, None);
    }

    #[test]
    fn collection_scope_reassignment_cannot_mutate_a_hidden_owner_collection() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "owner", Some("owner-a"));
        conn.execute(
            "INSERT INTO collections (
                id, name, created_at, source, invoke_source_id, invoke_owner_id
             ) VALUES ('owner-b-collection', 'Owner B', 1, 'ambit', 'invoke.db', 'owner-b')",
            [],
        )
        .expect("seed hidden collection");

        let error = update_ambit_collection_scope_inner(
            &conn,
            &UpdateAmbitCollectionScopeInput {
                collection_id: "owner-b-collection".to_string(),
                mode: AmbitCollectionScopeMode::Global,
                db_path: None,
                owner_id: None,
            },
        )
        .expect_err("a hidden collection must not be reassigned");

        assert!(error.contains("no longer available"));
        let unchanged: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id
                 FROM collections WHERE id = 'owner-b-collection'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("hidden collection remains");
        assert_eq!(
            unchanged,
            (Some("invoke.db".to_string()), Some("owner-b".to_string()))
        );
    }

    #[test]
    fn collection_scope_reassignment_accepts_a_path_form_custom_thumbnail() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        activate_test_owner_scope(&conn, "owner", Some("owner-a"));
        seed_image(
            &conn,
            "thumbnail-image",
            "thumbnail-hash",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute_batch(
            "UPDATE images
             SET path = 'C:/Invoke/images/thumbnail.png',
                 invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a'
             WHERE id = 'thumbnail-image';
             INSERT INTO collections (id, name, created_at, source, custom_thumbnail)
             VALUES (
                 'path-thumbnail-collection', 'Path thumbnail', 1, 'ambit',
                 'C:/Invoke/images/thumbnail.png'
             );",
        )
        .expect("seed path-form thumbnail collection");

        let result = update_ambit_collection_scope_inner(
            &conn,
            &UpdateAmbitCollectionScopeInput {
                collection_id: "path-thumbnail-collection".to_string(),
                mode: AmbitCollectionScopeMode::Owner,
                db_path: Some("invoke.db".to_string()),
                owner_id: Some("owner-a".to_string()),
            },
        )
        .expect("an exact image path should resolve for scope validation");

        assert_eq!(result.invoke_source_id.as_deref(), Some("invoke.db"));
        assert_eq!(result.invoke_owner_id.as_deref(), Some("owner-a"));
    }

    #[test]
    fn legacy_collection_migration_ignores_active_scope_and_preserves_existing_identity() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        conn.execute("ALTER TABLE collections ADD COLUMN updated_at INTEGER", [])
            .expect("add runtime collection timestamp");
        activate_test_owner_scope(&conn, "owner", Some("owner-a"));
        seed_image(
            &conn,
            "existing-member",
            "existing",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        seed_image(
            &conn,
            "hidden-member",
            "hidden",
            false,
            false,
            None,
            "{}",
            None,
            None,
        );
        conn.execute_batch(
            "UPDATE images
             SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-b'
             WHERE id IN ('existing-member', 'hidden-member');
             INSERT INTO collections (
                 id, name, created_at, source, invoke_source_id, invoke_owner_id, updated_at
             ) VALUES (
                 'hidden-collection', 'Existing name', 1, 'invoke',
                 'invoke.db', 'owner-b', 1
             );
             INSERT INTO collection_images (collection_id, image_id)
             VALUES ('hidden-collection', 'existing-member');",
        )
        .expect("seed hidden collection and images");

        let input = LegacyCollectionMigrationInput {
            import_key: "library-json-collections-v1".to_string(),
            collections: vec![LegacyCollectionMigrationItem {
                id: "hidden-collection".to_string(),
                name: "Legacy name".to_string(),
                color: Some("#abcdef".to_string()),
                is_archived: false,
                is_pinned: true,
                created_at: 10,
                updated_at: Some(20),
                filter_state: None,
                manual_exclusions: None,
                custom_thumbnail: None,
                image_ids: vec!["hidden-member".to_string()],
            }],
        };

        let first = migrate_legacy_collections_inner(&conn, &input)
            .expect("hidden legacy data should migrate");
        conn.execute(
            "UPDATE collections SET name = 'User edit' WHERE id = 'hidden-collection'",
            [],
        )
        .expect("edit migrated collection");
        conn.execute(
            "DELETE FROM collection_images
             WHERE collection_id = 'hidden-collection' AND image_id = 'hidden-member'",
            [],
        )
        .expect("remove migrated membership");
        let second = migrate_legacy_collections_inner(&conn, &input)
            .expect("receipt should make repeated migration a no-op");

        assert!(!first.already_applied);
        assert_eq!(first.collections_upserted, 1);
        assert_eq!(first.memberships_inserted, 1);
        assert!(second.already_applied);
        assert_eq!(second.collections_upserted, 0);
        assert_eq!(second.memberships_inserted, 0);
        let identity: (String, Option<String>, Option<String>, String) = conn
            .query_row(
                "SELECT source, invoke_source_id, invoke_owner_id, name
                 FROM collections WHERE id = 'hidden-collection'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("migrated collection");
        assert_eq!(
            identity,
            (
                "invoke".to_string(),
                Some("invoke.db".to_string()),
                Some("owner-b".to_string()),
                "User edit".to_string(),
            )
        );
        let membership_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collection_images
                 WHERE collection_id = 'hidden-collection'",
                [],
                |row| row.get(0),
            )
            .expect("membership count");
        assert_eq!(membership_count, 1);
    }

    #[test]
    fn legacy_collection_migration_rolls_back_the_batch_on_failure() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        conn.execute("ALTER TABLE collections ADD COLUMN updated_at INTEGER", [])
            .expect("add runtime collection timestamp");
        let item = |id: &str, name: &str| LegacyCollectionMigrationItem {
            id: id.to_string(),
            name: name.to_string(),
            color: None,
            is_archived: false,
            is_pinned: false,
            created_at: 1,
            updated_at: None,
            filter_state: None,
            manual_exclusions: None,
            custom_thumbnail: None,
            image_ids: Vec::new(),
        };

        let error = migrate_legacy_collections_inner(
            &conn,
            &LegacyCollectionMigrationInput {
                import_key: "library-json-collections-v1".to_string(),
                collections: vec![item("valid-first", "Valid"), item("", "Invalid")],
            },
        )
        .expect_err("invalid batch must fail");

        assert!(error.contains("non-empty ID and name"));
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collections WHERE id = 'valid-first'",
                [],
                |row| row.get(0),
            )
            .expect("collection count");
        assert_eq!(count, 0);
    }
}
