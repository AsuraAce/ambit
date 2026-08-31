use super::run_blocking;
use crate::db::facets::FacetResourceTouches;
use crate::db::ImageRecord;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeSet;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const PRIVACY_KEYWORDS_FINGERPRINT_KEY: &str = "masked_keywords_fingerprint";
const PRIVACY_HIDDEN_CASE_SQL: &str = "CASE
    WHEN user_masked = 1 THEN 1
    WHEN user_masked = 0 THEN 0
    WHEN EXISTS (
        SELECT 1
        FROM privacy_mask_keywords k
        WHERE LOWER(COALESCE(positive_prompt, '')) LIKE '%' || k.keyword || '%'
    ) THEN 1
    ELSE 0
END";

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyMaskRefreshResult {
    pub changed: bool,
    pub updated: usize,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImagePathIdentityMove {
    pub old_id: String,
    pub new_id: String,
    pub thumbnail_path: Option<String>,
    pub thumbnail_source: Option<String>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImagePathIdentityMoveResult {
    pub moved: usize,
    pub skipped_target_exists: usize,
    pub skipped_source_missing: usize,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeImageSourceUpdate {
    pub id: String,
    pub invoke_image_name: String,
    pub invoke_image_category: Option<String>,
    pub invoke_image_origin: Option<String>,
    pub invoke_owner_id: Option<String>,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeImageOwnerInventoryItem {
    pub id: String,
    pub invoke_owner_id: Option<String>,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeImageOwnerInventoryInput {
    pub db_path: String,
    pub images: Vec<InvokeImageOwnerInventoryItem>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvokeImageSourceReconcileResult {
    pub active_updated: usize,
    pub removed_updated: usize,
}

#[derive(serde::Deserialize, serde::Serialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InvokeOwnerScopeMode {
    Legacy,
    Unselected,
    Owner,
    All,
}

impl InvokeOwnerScopeMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Legacy => "legacy",
            Self::Unselected => "unselected",
            Self::Owner => "owner",
            Self::All => "all",
        }
    }
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeOwnerScopeInput {
    pub db_path: String,
    pub images_root: String,
    pub mode: InvokeOwnerScopeMode,
    pub owner_id: Option<String>,
    pub force_refresh: bool,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeBoardSnapshotBoard {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub owner_id: Option<String>,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeBoardSnapshotMembership {
    pub image_name: String,
    pub board_id: String,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeBoardSnapshotInput {
    pub db_path: String,
    pub mode: InvokeOwnerScopeMode,
    pub owner_id: Option<String>,
    pub boards: Vec<InvokeBoardSnapshotBoard>,
    pub memberships: Vec<InvokeBoardSnapshotMembership>,
    pub reconcile_memberships: bool,
    pub delete_missing_collections: bool,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeBoardSnapshotResult {
    pub collections_updated: usize,
    pub collections_deleted: usize,
    pub images_updated: usize,
    pub memberships_deleted: usize,
    pub memberships_inserted: usize,
}

#[cfg(test)]
impl InvokeBoardSnapshotResult {
    pub fn changed_count(&self) -> usize {
        self.collections_updated
            + self.collections_deleted
            + self.images_updated
            + self.memberships_deleted
            + self.memberships_inserted
    }
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvokeOwnerScopeRefreshResult {
    pub changed: bool,
    pub active_updated: usize,
    pub removed_updated: usize,
    pub cache_status: FacetScopeCacheStatus,
    pub cache_repair: InvokeScopeCacheRepairPlan,
}

#[derive(
    serde::Deserialize, serde::Serialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq, Default,
)]
#[serde(rename_all = "snake_case")]
pub enum InvokeScopeCacheAction {
    Restored,
    Selective,
    #[default]
    Full,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvokeScopeCacheRepairPlan {
    pub action: InvokeScopeCacheAction,
    pub resources: FacetResourceTouches,
    pub facet_types: Vec<String>,
    pub collections_dirty: bool,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeScopeCacheBuildClaim {
    pub scope_key: String,
    pub generation: i64,
    pub cache_status: FacetScopeCacheStatus,
    pub cache_repair: InvokeScopeCacheRepairPlan,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeScopeCacheBuildTicket {
    pub scope_key: String,
    pub generation: i64,
}

#[cfg(test)]
impl InvokeScopeCacheBuildClaim {
    fn ticket(&self) -> InvokeScopeCacheBuildTicket {
        InvokeScopeCacheBuildTicket {
            scope_key: self.scope_key.clone(),
            generation: self.generation,
        }
    }
}

#[derive(
    serde::Deserialize, serde::Serialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq, Default,
)]
#[serde(rename_all = "snake_case")]
pub enum FacetScopeCacheState {
    #[default]
    Missing,
    Dirty,
    Building,
    Ready,
}

impl FacetScopeCacheState {
    fn from_str(value: &str) -> Self {
        match value {
            "dirty" => Self::Dirty,
            "building" => Self::Building,
            "ready" => Self::Ready,
            _ => Self::Missing,
        }
    }
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FacetScopeCacheStatus {
    pub state: FacetScopeCacheState,
    pub generation: i64,
    pub built_generation: Option<i64>,
    pub facet_count: usize,
    pub collection_count: usize,
}

#[derive(serde::Deserialize, serde::Serialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InvokeImageReferenceRole {
    InitImage,
    ControlnetImage,
    ControlnetProcessedImage,
    IpAdapterImage,
    #[serde(rename = "t2i_adapter_image")]
    T2iAdapterImage,
    #[serde(rename = "t2i_adapter_processed_image")]
    T2iAdapterProcessedImage,
}

impl InvokeImageReferenceRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::InitImage => "init_image",
            Self::ControlnetImage => "controlnet_image",
            Self::ControlnetProcessedImage => "controlnet_processed_image",
            Self::IpAdapterImage => "ip_adapter_image",
            Self::T2iAdapterImage => "t2i_adapter_image",
            Self::T2iAdapterProcessedImage => "t2i_adapter_processed_image",
        }
    }
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeImageReferenceInput {
    pub role: InvokeImageReferenceRole,
    pub target_invoke_image_name: String,
}

#[derive(serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeImageReferenceSet {
    pub source_image_id: String,
    pub references: Vec<InvokeImageReferenceInput>,
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvokeImageReferenceReplaceResult {
    pub sources_replaced: usize,
    pub references_written: usize,
    pub skipped_missing_sources: usize,
}

fn normalize_privacy_keywords(masked_keywords: &[String]) -> Vec<String> {
    masked_keywords
        .iter()
        .map(|keyword| keyword.trim().to_lowercase())
        .filter(|keyword| !keyword.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn refresh_privacy_mask_index_for_conn(
    conn: &Connection,
    masked_keywords: &[String],
) -> Result<PrivacyMaskRefreshResult, String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS privacy_mask_keywords (
            keyword TEXT PRIMARY KEY
        ) STRICT;

        CREATE TABLE IF NOT EXISTS privacy_mask_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) STRICT;
        ",
    )
    .map_err(|e| e.to_string())?;

    let keywords = normalize_privacy_keywords(masked_keywords);
    let fingerprint = keywords.join("\u{1f}");
    let current_fingerprint: Option<String> = conn
        .query_row(
            "SELECT value FROM privacy_mask_state WHERE key = ?1",
            [PRIVACY_KEYWORDS_FINGERPRINT_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if current_fingerprint.as_deref() == Some(fingerprint.as_str()) {
        return Ok(PrivacyMaskRefreshResult {
            changed: false,
            updated: 0,
        });
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM privacy_mask_keywords", [])
        .map_err(|e| e.to_string())?;

    {
        let mut insert_keyword = tx
            .prepare_cached("INSERT INTO privacy_mask_keywords(keyword) VALUES (?1)")
            .map_err(|e| e.to_string())?;
        for keyword in &keywords {
            insert_keyword
                .execute([keyword])
                .map_err(|e| e.to_string())?;
        }
    }

    let update_sql = format!(
        "UPDATE images
         SET privacy_hidden = {case_sql}
         WHERE privacy_hidden IS NOT ({case_sql})",
        case_sql = PRIVACY_HIDDEN_CASE_SQL
    );
    let updated = tx.execute(&update_sql, []).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO privacy_mask_state(key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![PRIVACY_KEYWORDS_FINGERPRINT_KEY, fingerprint],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(PrivacyMaskRefreshResult {
        changed: true,
        updated,
    })
}

fn save_images_batch_inner(
    conn: &rusqlite::Connection,
    images: &[ImageRecord],
) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    {
        use crate::metadata::CURRENT_PARSER_VERSION;

        let invoke_source_path_matches_scope =
            literal_invoke_images_prefix_sql("?2", "scope.images_root");
        let save_sql =
            "INSERT INTO images (id, path, width, height, file_size, file_hash, timestamp, metadata_json, thumbnail_path, micro_thumbnail, thumbnail_source, thumbnail_version, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json, original_state_json, is_corrupt, invoke_image_name, invoke_image_category, invoke_image_origin, invoke_owner_id, invoke_scope_hidden, invoke_source_id, model_hash, model_name, tool, resolved_model_name, steps, seed, cfg, sampler, generation_type, parser_version, original_parsed_json, positive_prompt, negative_prompt)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    CASE WHEN ?11 = 'ambit' AND ?9 IS NOT NULL AND ?9 != '' AND ?2 != ?9 THEN 1 ELSE 0 END,
                    ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26,
                    0,
                    (SELECT scope.db_path FROM invoke_owner_scope_state scope
                     WHERE __INVOKE_SOURCE_PATH_MATCHES_SCOPE__
                     LIMIT 1),
                    json_extract(?8, '$.modelHash'),
                    json_extract(?8, '$.model'),
                    json_extract(?8, '$.tool'),
                    COALESCE((SELECT m.name FROM models m WHERE m.hash = json_extract(?8, '$.modelHash')), json_extract(?8, '$.model')),
                    CAST(json_extract(?8, '$.steps') AS INTEGER),
                    CAST(json_extract(?8, '$.seed') AS INTEGER),
                    CAST(json_extract(?8, '$.cfg') AS REAL),
                    REPLACE(REPLACE(LOWER(json_extract(?8, '$.sampler')), '_', ' '), '-', ' '),
                    json_extract(?8, '$.generationType'),
                    ?27,
                    ?8,
                    COALESCE(NULLIF(json_extract(?8, '$.positivePrompt'), ''), NULLIF(json_extract(?8, '$.positive_prompt'), '')),
                    COALESCE(NULLIF(json_extract(?8, '$.negativePrompt'), ''), NULLIF(json_extract(?8, '$.negative_prompt'), ''))
                )
                ON CONFLICT(id) DO UPDATE SET
                    path=excluded.path,
                    timestamp=excluded.timestamp,
                    file_size=excluded.file_size,
                    file_hash=excluded.file_hash,
                    metadata_json=excluded.metadata_json,
                    thumbnail_path=COALESCE(NULLIF(excluded.thumbnail_path, ''), images.thumbnail_path),
                    micro_thumbnail=COALESCE(excluded.micro_thumbnail, images.micro_thumbnail),
                    thumbnail_source=CASE
                        WHEN NULLIF(excluded.thumbnail_path, '') IS NOT NULL
                             AND images.thumbnail_path IS NOT excluded.thumbnail_path THEN excluded.thumbnail_source
                        ELSE images.thumbnail_source
                    END,
                    thumbnail_version=CASE
                        WHEN NULLIF(excluded.thumbnail_path, '') IS NOT NULL
                             AND images.thumbnail_path IS NOT excluded.thumbnail_path
                             AND excluded.thumbnail_source = 'ambit' THEN excluded.thumbnail_version
                        WHEN NULLIF(excluded.thumbnail_path, '') IS NOT NULL
                             AND images.thumbnail_path IS NOT excluded.thumbnail_path THEN 0
                        ELSE images.thumbnail_version
                    END,
                    thumbnail_failure_count=CASE
                        WHEN NULLIF(excluded.thumbnail_path, '') IS NOT NULL
                             AND images.thumbnail_path IS NOT excluded.thumbnail_path THEN 0
                        ELSE images.thumbnail_failure_count
                    END,
                    thumbnail_last_error=CASE
                        WHEN NULLIF(excluded.thumbnail_path, '') IS NOT NULL
                             AND images.thumbnail_path IS NOT excluded.thumbnail_path THEN NULL
                        ELSE images.thumbnail_last_error
                    END,
                    thumbnail_last_attempt_at=CASE
                        WHEN NULLIF(excluded.thumbnail_path, '') IS NOT NULL
                             AND images.thumbnail_path IS NOT excluded.thumbnail_path THEN NULL
                        ELSE images.thumbnail_last_attempt_at
                    END,
                    is_favorite=excluded.is_favorite,
                    is_pinned=excluded.is_pinned,
                    group_id=COALESCE(images.group_id, excluded.group_id),
                    board_id=excluded.board_id,
                    notes=COALESCE(images.notes, excluded.notes),
                    original_metadata_json=excluded.original_metadata_json,
                    original_state_json=COALESCE(images.original_state_json, excluded.original_state_json),
                    is_corrupt=excluded.is_corrupt,
                    invoke_image_name=COALESCE(excluded.invoke_image_name, images.invoke_image_name),
                    invoke_image_category=CASE
                        WHEN excluded.invoke_image_name IS NOT NULL THEN excluded.invoke_image_category
                        ELSE images.invoke_image_category
                    END,
                    invoke_image_origin=CASE
                        WHEN excluded.invoke_image_name IS NOT NULL THEN excluded.invoke_image_origin
                        ELSE images.invoke_image_origin
                    END,
                    invoke_owner_id=CASE
                        WHEN excluded.invoke_image_name IS NOT NULL THEN excluded.invoke_owner_id
                        ELSE images.invoke_owner_id
                    END,
                    invoke_scope_hidden=CASE
                        WHEN excluded.invoke_source_id IS NOT NULL
                          OR images.invoke_source_id IS NOT NULL THEN 0
                        ELSE images.invoke_scope_hidden
                    END,
                    invoke_source_id=COALESCE(excluded.invoke_source_id, images.invoke_source_id),
                    model_hash=excluded.model_hash,
                    model_name=excluded.model_name,
                    tool=excluded.tool,
                    resolved_model_name=excluded.resolved_model_name,
                    steps=excluded.steps,
                    seed=excluded.seed,
                    cfg=excluded.cfg,
                    sampler=excluded.sampler,
                    generation_type=excluded.generation_type,
                    parser_version=excluded.parser_version,
                    original_parsed_json=COALESCE(images.original_parsed_json, excluded.original_parsed_json),
                    positive_prompt=excluded.positive_prompt,
                    negative_prompt=excluded.negative_prompt
                WHERE images.metadata_json != excluded.metadata_json
                    OR images.timestamp != excluded.timestamp
                    OR images.file_size != excluded.file_size
                    OR images.file_hash IS NOT excluded.file_hash
                    OR (NULLIF(excluded.thumbnail_path, '') IS NOT NULL AND images.thumbnail_path IS NOT excluded.thumbnail_path)
                    OR images.is_favorite IS NOT excluded.is_favorite
                    OR images.is_pinned IS NOT excluded.is_pinned
                    OR images.board_id IS NOT excluded.board_id
                    OR (excluded.invoke_image_name IS NOT NULL AND images.invoke_image_name IS NOT excluded.invoke_image_name)
                    OR (excluded.invoke_image_name IS NOT NULL AND images.invoke_image_category IS NOT excluded.invoke_image_category)
                    OR (excluded.invoke_image_name IS NOT NULL AND images.invoke_image_origin IS NOT excluded.invoke_image_origin)
                    OR (excluded.invoke_image_name IS NOT NULL AND images.invoke_owner_id IS NOT excluded.invoke_owner_id)
                    OR (images.invoke_scope_hidden != 0
                        AND (excluded.invoke_source_id IS NOT NULL
                             OR images.invoke_source_id IS NOT NULL))
                    OR (excluded.invoke_source_id IS NOT NULL AND images.invoke_source_id IS NOT excluded.invoke_source_id)
                    OR images.original_metadata_json IS NULL
                    OR images.original_metadata_json != excluded.original_metadata_json"
        .replace("__INVOKE_SOURCE_PATH_MATCHES_SCOPE__", &invoke_source_path_matches_scope);
        let mut stmt = tx.prepare_cached(&save_sql).map_err(|e| e.to_string())?;

        let mut delete_loras = tx
            .prepare_cached("DELETE FROM image_loras WHERE image_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut delete_controlnets = tx
            .prepare_cached("DELETE FROM image_controlnets WHERE image_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut delete_ipadapters = tx
            .prepare_cached("DELETE FROM image_ipadapters WHERE image_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut delete_embeddings = tx
            .prepare_cached("DELETE FROM image_embeddings WHERE image_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut delete_hypernetworks = tx
            .prepare_cached("DELETE FROM image_hypernetworks WHERE image_id = ?1")
            .map_err(|e| e.to_string())?;

        let mut lora_stmt = tx
            .prepare_cached(
                "
            INSERT OR IGNORE INTO image_loras (image_id, lora_name)
            SELECT ?1,
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    CASE
                        WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                        WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                        ELSE value
                    END,
                '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
            FROM json_each(?2, '$.loras')
            WHERE value IS NOT NULL AND value != ''
        ",
            )
            .map_err(|e| e.to_string())?;

        let mut cn_stmt = tx
            .prepare_cached(
                "
            INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name)
            SELECT ?1,
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    CASE
                        WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                        WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                        ELSE value
                    END,
                '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
            FROM json_each(?2, '$.controlNets')
            WHERE value IS NOT NULL AND value != ''
        ",
            )
            .map_err(|e| e.to_string())?;

        let mut ip_stmt = tx
            .prepare_cached(
                "
            INSERT OR IGNORE INTO image_ipadapters (image_id, ipadapter_name)
            SELECT ?1,
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    CASE
                        WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                        WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                        ELSE value
                    END,
                '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
            FROM json_each(?2, '$.ipAdapters')
            WHERE value IS NOT NULL AND value != ''
        ",
            )
            .map_err(|e| e.to_string())?;

        let mut emb_stmt = tx
            .prepare_cached(
                "
            INSERT OR IGNORE INTO image_embeddings (image_id, embedding_name)
            SELECT ?1,
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    CASE
                        WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                        WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                        ELSE value
                    END,
                '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
            FROM json_each(?2, '$.embeddings')
            WHERE value IS NOT NULL AND value != ''
        ",
            )
            .map_err(|e| e.to_string())?;

        let mut hn_stmt = tx
            .prepare_cached(
                "
            INSERT OR IGNORE INTO image_hypernetworks (image_id, hypernetwork_name)
            SELECT ?1,
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    CASE
                        WHEN instr(value, ' (') > 0 THEN substr(value, 1, instr(value, ' (') - 1)
                        WHEN instr(value, ':') > 0 THEN substr(value, 1, instr(value, ':') - 1)
                        ELSE value
                    END,
                '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')
            FROM json_each(?2, '$.hypernetworks')
            WHERE value IS NOT NULL AND value != ''
        ",
            )
            .map_err(|e| e.to_string())?;

        for img in images {
            let rows_affected = stmt
                .execute(params![
                    img.id,
                    img.path,
                    img.width,
                    img.height,
                    img.file_size as i64,
                    img.file_hash,
                    img.timestamp as i64,
                    img.metadata_json,
                    img.thumbnail_path,
                    img.micro_thumbnail,
                    img.thumbnail_source,
                    img.is_favorite,
                    img.is_pinned,
                    img.is_deleted,
                    img.is_missing,
                    img.user_masked,
                    img.group_id,
                    img.board_id,
                    img.notes,
                    img.original_metadata_json,
                    img.original_state_json,
                    img.is_corrupt,
                    img.invoke_image_name,
                    img.invoke_image_category,
                    img.invoke_image_origin,
                    img.invoke_owner_id,
                    CURRENT_PARSER_VERSION
                ])
                .map_err(|e| e.to_string())?;

            if rows_affected > 0 {
                delete_loras
                    .execute(params![img.id])
                    .map_err(|e| e.to_string())?;
                delete_controlnets
                    .execute(params![img.id])
                    .map_err(|e| e.to_string())?;
                delete_ipadapters
                    .execute(params![img.id])
                    .map_err(|e| e.to_string())?;
                delete_embeddings
                    .execute(params![img.id])
                    .map_err(|e| e.to_string())?;
                delete_hypernetworks
                    .execute(params![img.id])
                    .map_err(|e| e.to_string())?;

                lora_stmt
                    .execute(params![img.id, img.metadata_json])
                    .map_err(|e| e.to_string())?;
                emb_stmt
                    .execute(params![img.id, img.metadata_json])
                    .map_err(|e| e.to_string())?;
                hn_stmt
                    .execute(params![img.id, img.metadata_json])
                    .map_err(|e| e.to_string())?;
                cn_stmt
                    .execute(params![img.id, img.metadata_json])
                    .map_err(|e| e.to_string())?;
                ip_stmt
                    .execute(params![img.id, img.metadata_json])
                    .map_err(|e| e.to_string())?;
            }
        }

        drop(stmt);
        drop(delete_loras);
        drop(delete_controlnets);
        drop(delete_ipadapters);
        drop(delete_embeddings);
        drop(delete_hypernetworks);
        drop(lora_stmt);
        drop(cn_stmt);
        drop(ip_stmt);
        drop(emb_stmt);
        drop(hn_stmt);
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(images.len())
}

fn reconcile_invoke_image_sources_inner(
    conn: &rusqlite::Connection,
    updates: &[InvokeImageSourceUpdate],
) -> Result<InvokeImageSourceReconcileResult, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut result = InvokeImageSourceReconcileResult::default();

    {
        let update_sql = "SET invoke_image_name = ?1,
                              invoke_image_category = ?2,
                              invoke_image_origin = ?3,
                              invoke_owner_id = ?4
                          WHERE id = ?5
                            AND (invoke_image_name IS NOT ?1
                                 OR invoke_image_category IS NOT ?2
                                 OR invoke_image_origin IS NOT ?3
                                 OR invoke_owner_id IS NOT ?4)";
        let mut update_active = tx
            .prepare_cached(&format!("UPDATE images {update_sql}"))
            .map_err(|e| e.to_string())?;
        let mut update_removed = tx
            .prepare_cached(&format!("UPDATE removed_images {update_sql}"))
            .map_err(|e| e.to_string())?;

        for update in updates {
            result.active_updated += update_active
                .execute(params![
                    update.invoke_image_name,
                    update.invoke_image_category,
                    update.invoke_image_origin,
                    update.invoke_owner_id,
                    update.id
                ])
                .map_err(|e| e.to_string())?;
            result.removed_updated += update_removed
                .execute(params![
                    update.invoke_image_name,
                    update.invoke_image_category,
                    update.invoke_image_origin,
                    update.invoke_owner_id,
                    update.id
                ])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

fn reconcile_invoke_owner_inventory_inner(
    conn: &rusqlite::Connection,
    input: &InvokeImageOwnerInventoryInput,
) -> Result<InvokeImageSourceReconcileResult, String> {
    let db_path = normalize_invoke_root(&input.db_path);
    if db_path.is_empty() {
        return Err("InvokeAI database path is required".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS temp_invoke_owner_inventory (
             id TEXT PRIMARY KEY,
             owner_id TEXT
         );
         DELETE FROM temp_invoke_owner_inventory;",
    )
    .map_err(|error| error.to_string())?;

    {
        let mut insert = tx
            .prepare_cached(
                "INSERT INTO temp_invoke_owner_inventory (id, owner_id)
                 VALUES (?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET
                     owner_id = CASE
                         WHEN temp_invoke_owner_inventory.owner_id IS excluded.owner_id
                         THEN excluded.owner_id
                         ELSE NULL
                     END",
            )
            .map_err(|error| error.to_string())?;
        for item in &input.images {
            let id = item.id.trim();
            if id.is_empty() {
                return Err("InvokeAI owner inventory paths cannot be empty".to_string());
            }
            insert
                .execute(params![
                    id,
                    item.invoke_owner_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                ])
                .map_err(|error| error.to_string())?;
        }
    }

    let source_match = if cfg!(windows) {
        "LOWER(RTRIM(REPLACE(invoke_source_id, '\\', '/'), '/')) = LOWER(?1)"
    } else {
        "invoke_source_id = ?1"
    };
    let mut result = InvokeImageSourceReconcileResult::default();
    for (table, count) in [
        ("images", &mut result.active_updated),
        ("removed_images", &mut result.removed_updated),
    ] {
        *count = tx
            .execute(
                &format!(
                    "UPDATE {table}
                     SET invoke_owner_id = (
                         SELECT inventory.owner_id
                         FROM temp_invoke_owner_inventory inventory
                         WHERE inventory.id = {table}.id
                     )
                     WHERE {source_match}
                       AND invoke_owner_id IS NOT (
                           SELECT inventory.owner_id
                           FROM temp_invoke_owner_inventory inventory
                           WHERE inventory.id = {table}.id
                       )"
                ),
                [&db_path],
            )
            .map_err(|error| error.to_string())?;
    }

    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

fn normalize_invoke_root(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn literal_invoke_images_prefix_sql(path_expression: &str, root_expression: &str) -> String {
    let normalized_path = format!("REPLACE({path_expression}, '\\', '/')");
    let normalized_root = format!("RTRIM(REPLACE({root_expression}, '\\', '/'), '/')");
    let prefix = format!("({normalized_root} || '/outputs/images/')");
    let windows_root = format!(
        "REPLACE({root_expression}, '\\', '/') GLOB '[A-Za-z]:/*' \
         OR REPLACE({root_expression}, '\\', '/') GLOB '//*'"
    );

    format!(
        "CASE WHEN ({windows_root}) \
         THEN LOWER(SUBSTR({normalized_path}, 1, LENGTH({prefix}))) = LOWER({prefix}) \
         ELSE SUBSTR({normalized_path}, 1, LENGTH({prefix})) = {prefix} END"
    )
}
fn invoke_scope_cache_key(
    db_path: &str,
    mode: InvokeOwnerScopeMode,
    owner_id: Option<&str>,
) -> String {
    format!(
        "{db_path}\u{1f}{}\u{1f}{}",
        mode.as_str(),
        owner_id.unwrap_or("")
    )
}

#[cfg(windows)]
fn canonicalize_windows_invoke_identity(
    tx: &rusqlite::Transaction<'_>,
    db_path: &str,
    images_root: &str,
) -> Result<(), String> {
    let aliases = {
        let mut statement = tx
            .prepare(
                "SELECT scope_key, scope_mode, owner_id
                 FROM invoke_scope_cache_state
                 WHERE LOWER(RTRIM(REPLACE(db_path, '\\', '/'), '/')) = LOWER(?1)",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([db_path], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };

    for (alias_key, scope_mode, owner_id) in aliases {
        let canonical_key = format!(
            "{db_path}\u{1f}{scope_mode}\u{1f}{}",
            owner_id.as_deref().unwrap_or("")
        );
        if alias_key == canonical_key {
            tx.execute(
                "UPDATE invoke_scope_cache_state
                 SET db_path = ?1, images_root = ?2
                 WHERE scope_key = ?3",
                params![db_path, images_root, canonical_key],
            )
            .map_err(|error| error.to_string())?;
            continue;
        }

        let canonical_exists = tx
            .query_row(
                "SELECT 1 FROM invoke_scope_cache_state WHERE scope_key = ?1",
                [&canonical_key],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .is_some();

        if canonical_exists {
            // Two differently-cased identities may both have been prepared before
            // Windows path canonicalization was introduced. Their derived rows
            // cannot be merged safely entry-by-entry, so retain the requested
            // identity and require one selective full rebuild.
            tx.execute(
                "UPDATE invoke_scope_cache_state
                 SET db_path = ?1, images_root = ?2, status = 'dirty',
                     generation = MAX(
                         generation,
                         COALESCE((SELECT generation FROM invoke_scope_cache_state WHERE scope_key = ?3), 0)
                     ) + 1,
                     built_generation = NULL,
                     updated_at = MAX(
                         updated_at,
                         COALESCE((SELECT updated_at FROM invoke_scope_cache_state WHERE scope_key = ?3), 0)
                     )
                 WHERE scope_key = ?4",
                params![db_path, images_root, alias_key, canonical_key],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM invoke_scope_facet_cache WHERE scope_key = ?1",
                [&canonical_key],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM invoke_scope_collection_cache WHERE scope_key = ?1",
                [&canonical_key],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM invoke_scope_cache_dirty_items WHERE scope_key = ?1",
                [&canonical_key],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT INTO invoke_scope_cache_dirty_items (
                     scope_key, domain, facet_type, resource_name
                 ) VALUES (?1, 'full', '', '')",
                [&canonical_key],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "UPDATE invoke_scope_cache_control
                 SET active_scope_key = ?1
                 WHERE state_key = 'current' AND active_scope_key = ?2",
                params![canonical_key, alias_key],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "DELETE FROM invoke_scope_cache_state WHERE scope_key = ?1",
                [&alias_key],
            )
            .map_err(|error| error.to_string())?;
            continue;
        }

        tx.execute(
            "INSERT INTO invoke_scope_cache_state (
                 scope_key, db_path, images_root, scope_mode, owner_id,
                 status, generation, built_generation, updated_at
             )
             SELECT ?1, ?2, ?3, scope_mode, owner_id,
                    status, generation, built_generation, updated_at
             FROM invoke_scope_cache_state
             WHERE scope_key = ?4
             ",
            params![canonical_key, db_path, images_root, alias_key],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO invoke_scope_facet_cache (
                 scope_key, facet_type, resource_name, resource_hash, count,
                 thumbnail_path, preview_url, last_used_at, created_at, is_manual,
                 has_sidecar, is_user_override, guidance_subtype,
                 safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive,
                 thumbnail_sensitivity_override
             )
             SELECT ?1, facet_type, resource_name, resource_hash, count,
                    thumbnail_path, preview_url, last_used_at, created_at, is_manual,
                    has_sidecar, is_user_override, guidance_subtype,
                    safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive,
                    thumbnail_sensitivity_override
             FROM invoke_scope_facet_cache WHERE scope_key = ?2",
            params![canonical_key, alias_key],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO invoke_scope_collection_cache (
                 scope_key, collection_id, dynamic_thumbnail_path,
                 dynamic_safe_thumbnail_path, dynamic_thumbnail_is_sensitive,
                 dynamic_thumbnail_cached_at, dynamic_count
             )
             SELECT ?1, collection_id, dynamic_thumbnail_path,
                    dynamic_safe_thumbnail_path, dynamic_thumbnail_is_sensitive,
                    dynamic_thumbnail_cached_at, dynamic_count
             FROM invoke_scope_collection_cache WHERE scope_key = ?2",
            params![canonical_key, alias_key],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT OR IGNORE INTO invoke_scope_cache_dirty_items (
                 scope_key, domain, facet_type, resource_name
             )
             SELECT ?1, domain, facet_type, resource_name
             FROM invoke_scope_cache_dirty_items WHERE scope_key = ?2",
            params![canonical_key, alias_key],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE invoke_scope_cache_control
             SET active_scope_key = ?1
             WHERE state_key = 'current' AND active_scope_key = ?2",
            params![canonical_key, alias_key],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM invoke_scope_cache_state WHERE scope_key = ?1",
            [&alias_key],
        )
        .map_err(|error| error.to_string())?;
    }

    for table in ["images", "removed_images", "collections"] {
        tx.execute(
            &format!(
                "UPDATE {table}
                 SET invoke_source_id = ?1
                 WHERE invoke_source_id IS NOT NULL
                   AND LOWER(RTRIM(REPLACE(invoke_source_id, '\\', '/'), '/')) = LOWER(?1)"
            ),
            [db_path],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.execute(
        "UPDATE invoke_owner_scope_state
         SET db_path = ?1, images_root = ?2
         WHERE state_key = 'current'
           AND LOWER(RTRIM(REPLACE(db_path, '\\', '/'), '/')) = LOWER(?1)",
        params![db_path, images_root],
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[cfg(not(windows))]
fn canonicalize_windows_invoke_identity(
    _tx: &rusqlite::Transaction<'_>,
    _db_path: &str,
    _images_root: &str,
) -> Result<(), String> {
    Ok(())
}

fn read_scope_cache_status(
    conn: &Connection,
    scope_key: &str,
) -> Result<FacetScopeCacheStatus, String> {
    let state = conn
        .query_row(
            "SELECT status, generation, built_generation,
                    (SELECT COUNT(*) FROM invoke_scope_facet_cache f WHERE f.scope_key = s.scope_key),
                    (SELECT COUNT(*) FROM invoke_scope_collection_cache c WHERE c.scope_key = s.scope_key)
             FROM invoke_scope_cache_state s
             WHERE scope_key = ?1",
            [scope_key],
            |row| {
                let status: String = row.get(0)?;
                Ok(FacetScopeCacheStatus {
                    state: FacetScopeCacheState::from_str(&status),
                    generation: row.get(1)?,
                    built_generation: row.get(2)?,
                    facet_count: row.get(3)?,
                    collection_count: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(state.unwrap_or_default())
}

fn read_scope_cache_repair_plan(
    conn: &Connection,
    scope_key: &str,
    status: &FacetScopeCacheStatus,
) -> Result<InvokeScopeCacheRepairPlan, String> {
    if status.state == FacetScopeCacheState::Ready
        && status.built_generation == Some(status.generation)
    {
        return Ok(InvokeScopeCacheRepairPlan {
            action: InvokeScopeCacheAction::Restored,
            ..Default::default()
        });
    }
    if status.state != FacetScopeCacheState::Dirty || status.built_generation.is_none() {
        return Ok(InvokeScopeCacheRepairPlan::default());
    }

    let mut statement = conn
        .prepare(
            "SELECT domain, facet_type, resource_name
             FROM invoke_scope_cache_dirty_items
             WHERE scope_key = ?1
             ORDER BY domain, facet_type, resource_name",
        )
        .map_err(|error| error.to_string())?;
    let rows: Vec<(String, String, String)> = statement
        .query_map([scope_key], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?;

    if rows.is_empty() || rows.iter().any(|(domain, _, _)| domain == "full") {
        return Ok(InvokeScopeCacheRepairPlan::default());
    }

    let mut resources = FacetResourceTouches::default();
    let mut facet_types = BTreeSet::new();
    let mut collections_dirty = false;
    for (domain, facet_type, resource_name) in rows {
        match domain.as_str() {
            "collections" => collections_dirty = true,
            "facet_type" if !facet_type.is_empty() => {
                facet_types.insert(facet_type);
            }
            "facet_resource" if !resource_name.trim().is_empty() => match facet_type.as_str() {
                "checkpoints" => resources.checkpoints.push(resource_name),
                "loras" => resources.loras.push(resource_name),
                "embeddings" => resources.embeddings.push(resource_name),
                "hypernetworks" => resources.hypernetworks.push(resource_name),
                "control_nets" => resources.control_nets.push(resource_name),
                "ip_adapters" => resources.ip_adapters.push(resource_name),
                "tools" => resources.tools.push(resource_name),
                _ => return Ok(InvokeScopeCacheRepairPlan::default()),
            },
            _ => return Ok(InvokeScopeCacheRepairPlan::default()),
        }
    }

    Ok(InvokeScopeCacheRepairPlan {
        action: InvokeScopeCacheAction::Selective,
        resources,
        facet_types: facet_types.into_iter().collect(),
        collections_dirty,
    })
}

fn snapshot_active_scope_cache_if_ready(conn: &Connection) -> Result<(), String> {
    let active: Option<(String, String, i64, Option<i64>)> = conn
        .query_row(
            "SELECT s.scope_key, s.status, s.generation, s.built_generation
             FROM invoke_scope_cache_control control
             JOIN invoke_scope_cache_state s ON s.scope_key = control.active_scope_key
             WHERE control.state_key = 'current'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((scope_key, status, generation, built_generation)) = active else {
        return Ok(());
    };
    if status != "ready" || built_generation != Some(generation) {
        return Ok(());
    }

    conn.execute(
        "DELETE FROM invoke_scope_facet_cache WHERE scope_key = ?1",
        [&scope_key],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO invoke_scope_facet_cache (
             scope_key, facet_type, resource_name, resource_hash, count,
             thumbnail_path, preview_url, last_used_at, created_at, is_manual,
             has_sidecar, is_user_override, guidance_subtype,
             safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive,
             thumbnail_sensitivity_override
         )
         SELECT ?1, facet_type, resource_name, resource_hash, count,
                thumbnail_path, preview_url, last_used_at, created_at, is_manual,
                has_sidecar, is_user_override, guidance_subtype,
                safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive,
                thumbnail_sensitivity_override
         FROM facet_cache",
        [&scope_key],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM invoke_scope_collection_cache WHERE scope_key = ?1",
        [&scope_key],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO invoke_scope_collection_cache (
             scope_key, collection_id, dynamic_thumbnail_path,
             dynamic_safe_thumbnail_path, dynamic_thumbnail_is_sensitive,
             dynamic_thumbnail_cached_at, dynamic_count
         )
         SELECT ?1, id, dynamic_thumbnail_path, dynamic_safe_thumbnail_path,
                dynamic_thumbnail_is_sensitive, dynamic_thumbnail_cached_at, dynamic_count
         FROM collections",
        [&scope_key],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn restore_scope_cache(conn: &Connection, scope_key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM facet_cache", [])
        .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO facet_cache (
             facet_type, resource_name, resource_hash, count, thumbnail_path,
             preview_url, last_used_at, created_at, is_manual, has_sidecar,
             is_user_override, guidance_subtype, safe_thumbnail_path,
             thumbnail_image_id, thumbnail_is_sensitive,
             thumbnail_sensitivity_override
         )
         SELECT facet_type, resource_name, resource_hash, count, thumbnail_path,
                preview_url, last_used_at, created_at, is_manual, has_sidecar,
                is_user_override, guidance_subtype, safe_thumbnail_path,
                thumbnail_image_id, thumbnail_is_sensitive,
                thumbnail_sensitivity_override
         FROM invoke_scope_facet_cache
         WHERE scope_key = ?1",
        [scope_key],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "UPDATE collections
         SET dynamic_thumbnail_path = (
                 SELECT cache.dynamic_thumbnail_path
                 FROM invoke_scope_collection_cache cache
                 WHERE cache.scope_key = ?1 AND cache.collection_id = collections.id
             ),
             dynamic_safe_thumbnail_path = (
                 SELECT cache.dynamic_safe_thumbnail_path
                 FROM invoke_scope_collection_cache cache
                 WHERE cache.scope_key = ?1 AND cache.collection_id = collections.id
             ),
             dynamic_thumbnail_is_sensitive = (
                 SELECT cache.dynamic_thumbnail_is_sensitive
                 FROM invoke_scope_collection_cache cache
                 WHERE cache.scope_key = ?1 AND cache.collection_id = collections.id
             ),
             dynamic_thumbnail_cached_at = (
                 SELECT cache.dynamic_thumbnail_cached_at
                 FROM invoke_scope_collection_cache cache
                 WHERE cache.scope_key = ?1 AND cache.collection_id = collections.id
             ),
             dynamic_count = (
                 SELECT cache.dynamic_count
                 FROM invoke_scope_collection_cache cache
                 WHERE cache.scope_key = ?1 AND cache.collection_id = collections.id
             )",
        [scope_key],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn invoke_scope_cache_build_session_id() -> &'static str {
    static SESSION_ID: OnceLock<String> = OnceLock::new();
    SESSION_ID.get_or_init(|| {
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("{}-{started_at}", std::process::id())
    })
}

fn begin_active_scope_cache_build_inner(
    conn: &Connection,
) -> Result<InvokeScopeCacheBuildClaim, String> {
    begin_active_scope_cache_build_for_session_inner(conn, invoke_scope_cache_build_session_id())
}

fn begin_active_scope_cache_build_for_session_inner(
    conn: &Connection,
    session_id: &str,
) -> Result<InvokeScopeCacheBuildClaim, String> {
    let scope_key: String = conn
        .query_row(
            "SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let initial_status = read_scope_cache_status(conn, &scope_key)?;
    let cache_repair = read_scope_cache_repair_plan(conn, &scope_key, &initial_status)?;
    let cache_status = if cache_repair.action == InvokeScopeCacheAction::Restored {
        initial_status
    } else {
        let updated = conn
            .execute(
                "UPDATE invoke_scope_cache_state
                 SET status = 'building',
                     build_session_id = ?3,
                     updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                 WHERE scope_key = ?1
                   AND generation = ?2
                   AND (
                       status IN ('missing', 'dirty')
                       OR (status = 'building' AND COALESCE(build_session_id, '') <> ?3)
                   )",
                params![&scope_key, initial_status.generation, session_id],
            )
            .map_err(|error| error.to_string())?;
        if updated != 1 {
            return Err(
                "Invoke owner cache changed before its repair could be claimed.".to_string(),
            );
        }
        read_scope_cache_status(conn, &scope_key)?
    };

    Ok(InvokeScopeCacheBuildClaim {
        scope_key,
        generation: cache_status.generation,
        cache_status,
        cache_repair,
    })
}

fn commit_active_scope_cache_inner(
    conn: &Connection,
    ticket: &InvokeScopeCacheBuildTicket,
) -> Result<FacetScopeCacheStatus, String> {
    commit_active_scope_cache_for_session_inner(conn, ticket, invoke_scope_cache_build_session_id())
}

fn commit_active_scope_cache_for_session_inner(
    conn: &Connection,
    ticket: &InvokeScopeCacheBuildTicket,
    session_id: &str,
) -> Result<FacetScopeCacheStatus, String> {
    let active_scope_key: String = conn
        .query_row(
            "SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if active_scope_key != ticket.scope_key {
        return Err("Invoke owner cache scope changed while it was being prepared.".to_string());
    }

    let promoted = conn
        .execute(
            "UPDATE invoke_scope_cache_state
             SET status = 'ready', built_generation = ?2,
                 build_session_id = NULL,
                 updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
             WHERE scope_key = ?1
               AND status = 'building'
               AND generation = ?2
               AND build_session_id = ?3",
            params![&ticket.scope_key, ticket.generation, session_id],
        )
        .map_err(|error| error.to_string())?;
    if promoted != 1 {
        let status = read_scope_cache_status(conn, &ticket.scope_key)?;
        return Err(format!(
            "Invoke owner cache changed while it was being prepared (state: {:?}, generation: {}).",
            status.state, status.generation
        ));
    }

    conn.execute(
        "UPDATE invoke_scope_cache_control SET suppress_invalidation = 1 WHERE state_key = 'current'",
        [],
    )
    .map_err(|error| error.to_string())?;
    snapshot_active_scope_cache_if_ready(conn)?;
    conn.execute(
        "DELETE FROM invoke_scope_cache_dirty_items WHERE scope_key = ?1",
        [&ticket.scope_key],
    )
    .map_err(|error| error.to_string())?;
    conn.execute(
        "UPDATE invoke_scope_cache_control SET suppress_invalidation = 0 WHERE state_key = 'current'",
        [],
    )
    .map_err(|error| error.to_string())?;
    read_scope_cache_status(conn, &ticket.scope_key)
}

fn abort_active_scope_cache_build_inner(
    conn: &Connection,
    ticket: &InvokeScopeCacheBuildTicket,
) -> Result<FacetScopeCacheStatus, String> {
    abort_active_scope_cache_build_for_session_inner(
        conn,
        ticket,
        invoke_scope_cache_build_session_id(),
    )
}

fn abort_active_scope_cache_build_for_session_inner(
    conn: &Connection,
    ticket: &InvokeScopeCacheBuildTicket,
    session_id: &str,
) -> Result<FacetScopeCacheStatus, String> {
    conn.execute(
        "UPDATE invoke_scope_cache_state
         SET status = 'dirty',
             build_session_id = NULL,
             updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
         WHERE scope_key = ?1
           AND status = 'building'
           AND generation = ?2
           AND build_session_id = ?3",
        params![&ticket.scope_key, ticket.generation, session_id],
    )
    .map_err(|error| error.to_string())?;
    read_scope_cache_status(conn, &ticket.scope_key)
}

fn refresh_invoke_owner_scope_inner(
    conn: &rusqlite::Connection,
    input: &InvokeOwnerScopeInput,
) -> Result<InvokeOwnerScopeRefreshResult, String> {
    let db_path = normalize_invoke_root(&input.db_path);
    let images_root = normalize_invoke_root(&input.images_root);
    if db_path.is_empty() || images_root.is_empty() {
        return Err("InvokeAI database path and images root are required".to_string());
    }

    let owner_id = input
        .owner_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if input.mode == InvokeOwnerScopeMode::Owner && owner_id.is_none() {
        return Err("Owner scope requires a non-empty owner ID".to_string());
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    snapshot_active_scope_cache_if_ready(&tx)?;
    tx.execute(
        "UPDATE invoke_scope_cache_control SET suppress_invalidation = 1 WHERE state_key = 'current'",
        [],
    )
    .map_err(|error| error.to_string())?;
    canonicalize_windows_invoke_identity(&tx, &db_path, &images_root)?;
    let previous: Option<(String, String, String, Option<String>)> = tx
        .query_row(
            "SELECT db_path, images_root, scope_mode, owner_id
             FROM invoke_owner_scope_state
             WHERE state_key = 'current'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let next = (
        db_path.clone(),
        images_root.clone(),
        input.mode.as_str().to_string(),
        owner_id.map(str::to_string),
    );
    let scope_key = invoke_scope_cache_key(&db_path, input.mode, owner_id);
    tx.execute(
        "INSERT INTO invoke_scope_cache_state (
             scope_key, db_path, images_root, scope_mode, owner_id,
             status, generation, built_generation, updated_at
         ) VALUES (
             ?1, ?2, ?3, ?4, ?5, 'missing', 0, NULL,
             CAST(strftime('%s', 'now') AS INTEGER) * 1000
         )
         ON CONFLICT(scope_key) DO UPDATE SET
             db_path = excluded.db_path,
             images_root = excluded.images_root,
             scope_mode = excluded.scope_mode,
             owner_id = excluded.owner_id",
        params![
            scope_key,
            db_path,
            images_root,
            input.mode.as_str(),
            owner_id
        ],
    )
    .map_err(|error| error.to_string())?;
    if !input.force_refresh && previous.as_ref() == Some(&next) {
        let status = read_scope_cache_status(&tx, &scope_key)?;
        let cache_repair = read_scope_cache_repair_plan(&tx, &scope_key, &status)?;
        if cache_repair.action != InvokeScopeCacheAction::Full {
            restore_scope_cache(&tx, &scope_key)?;
        }
        tx.execute(
            "UPDATE invoke_scope_cache_control
             SET active_scope_key = ?1, suppress_invalidation = 0
             WHERE state_key = 'current'",
            [&scope_key],
        )
        .map_err(|error| error.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(InvokeOwnerScopeRefreshResult {
            cache_repair,
            cache_status: status,
            ..Default::default()
        });
    }

    let source_changed = previous
        .as_ref()
        .is_none_or(|(previous_db, previous_root, _, _)| {
            previous_db != &db_path || previous_root != &images_root
        });
    let mut source_assignments = 0;
    if source_changed {
        let invoke_source_path_matches_root = literal_invoke_images_prefix_sql("path", "?2");
        for table in ["images", "removed_images"] {
            source_assignments += tx
                .execute(
                    &format!(
                        "UPDATE {table}
                     SET invoke_source_id = ?1,
                         invoke_scope_hidden = 0
                     WHERE invoke_source_id IS NULL
                       AND {invoke_source_path_matches_root}"
                    ),
                    params![&db_path, &images_root],
                )
                .map_err(|error| error.to_string())?;
        }
        source_assignments += tx
            .execute(
                "UPDATE collections
             SET invoke_source_id = ?1
             WHERE source = 'invoke' AND invoke_source_id IS NULL",
                [&db_path],
            )
            .map_err(|error| error.to_string())?;
        if source_assignments > 0 {
            // Reclassifying rows changes which logical sources can see them. Any
            // previously prepared projection may therefore be stale, including a
            // target scope that was prepared before this source became active.
            tx.execute(
                "UPDATE invoke_scope_cache_state
                 SET status = 'dirty', generation = generation + 1,
                     updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                 WHERE status IN ('ready', 'building')",
                [],
            )
            .map_err(|error| error.to_string())?;
            tx.execute(
                "INSERT OR IGNORE INTO invoke_scope_cache_dirty_items (
                     scope_key, domain, facet_type, resource_name
                 )
                 SELECT scope_key, 'full', '', '' FROM invoke_scope_cache_state",
                [],
            )
            .map_err(|error| error.to_string())?;
        }
    }

    let active_updated = 0;
    let removed_updated = 0;
    tx.execute(
        "INSERT INTO invoke_owner_scope_state (
             state_key, db_path, images_root, scope_mode, owner_id, boards_verified, updated_at
         ) VALUES (
             'current', ?1, ?2, ?3, ?4,
             CASE WHEN ?3 = 'owner' THEN 0 ELSE 1 END,
             CAST(strftime('%s', 'now') AS INTEGER) * 1000
         )
         ON CONFLICT(state_key) DO UPDATE SET
             boards_verified = CASE
                 WHEN excluded.scope_mode != 'owner' THEN 1
                 WHEN invoke_owner_scope_state.db_path = excluded.db_path
                  AND invoke_owner_scope_state.scope_mode = excluded.scope_mode
                  AND invoke_owner_scope_state.owner_id IS excluded.owner_id
                 THEN invoke_owner_scope_state.boards_verified
                 ELSE 0
             END,
             db_path = excluded.db_path,
             images_root = excluded.images_root,
             scope_mode = excluded.scope_mode,
             owner_id = excluded.owner_id,
             updated_at = excluded.updated_at",
        params![db_path, images_root, input.mode.as_str(), owner_id],
    )
    .map_err(|e| e.to_string())?;

    let cache_status = read_scope_cache_status(&tx, &scope_key)?;
    let cache_repair = read_scope_cache_repair_plan(&tx, &scope_key, &cache_status)?;
    if cache_repair.action != InvokeScopeCacheAction::Full {
        restore_scope_cache(&tx, &scope_key)?;
    }
    tx.execute(
        "UPDATE invoke_scope_cache_control
         SET active_scope_key = ?1, suppress_invalidation = 0
         WHERE state_key = 'current'",
        [&scope_key],
    )
    .map_err(|error| error.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(InvokeOwnerScopeRefreshResult {
        changed: previous.as_ref() != Some(&next),
        active_updated,
        removed_updated,
        cache_status,
        cache_repair,
    })
}

fn replace_invoke_image_references_inner(
    conn: &rusqlite::Connection,
    reference_sets: &[InvokeImageReferenceSet],
) -> Result<InvokeImageReferenceReplaceResult, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut result = InvokeImageReferenceReplaceResult::default();

    {
        let mut source_exists = tx
            .prepare_cached(
                "SELECT 1 FROM images WHERE id = ?1
                 UNION ALL
                 SELECT 1 FROM removed_images WHERE id = ?1
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut delete_existing = tx
            .prepare_cached("DELETE FROM invoke_image_references WHERE source_image_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut insert_reference = tx
            .prepare_cached(
                "INSERT OR IGNORE INTO invoke_image_references (
                    source_image_id,
                    role,
                    target_invoke_image_name,
                    target_image_id
                 ) VALUES (
                    ?1,
                    ?2,
                    ?3,
                    (
                        SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) ELSE NULL END
                        FROM images
                        WHERE invoke_image_name = ?3
                    )
                 )",
            )
            .map_err(|e| e.to_string())?;

        for reference_set in reference_sets {
            let source_image_id = normalize_image_identity_path(&reference_set.source_image_id);
            if !source_exists
                .exists(params![&source_image_id])
                .map_err(|e| e.to_string())?
            {
                result.skipped_missing_sources += 1;
                continue;
            }

            delete_existing
                .execute(params![&source_image_id])
                .map_err(|e| e.to_string())?;

            for reference in &reference_set.references {
                if reference.target_invoke_image_name.trim().is_empty() {
                    return Err("InvokeAI reference image names cannot be blank".to_string());
                }

                result.references_written += insert_reference
                    .execute(params![
                        &source_image_id,
                        reference.role.as_str(),
                        &reference.target_invoke_image_name,
                    ])
                    .map_err(|e| e.to_string())?;
            }

            result.sources_replaced += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

fn normalize_image_identity_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn alternate_windows_identity_path(path: &str) -> String {
    let normalized = normalize_image_identity_path(path);
    if let Some(rest) = normalized.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }
    if let Some(rest) = normalized.strip_prefix("//?/") {
        return rest.to_string();
    }
    if let Some(rest) = normalized.strip_prefix("//") {
        return format!("//?/UNC/{rest}");
    }
    if normalized.as_bytes().get(1) == Some(&b':') {
        return format!("//?/{normalized}");
    }
    normalized
}

fn preserve_source_identity_prefix(source_id: &str, requested_target: &str) -> String {
    let source_id = normalize_image_identity_path(source_id);
    let requested_target = normalize_image_identity_path(requested_target);

    if source_id.starts_with("//?/UNC/") && !requested_target.starts_with("//?/UNC/") {
        if let Some(rest) = requested_target.strip_prefix("//") {
            return format!("//?/UNC/{rest}");
        }
    }
    if source_id.starts_with("//?/") && !requested_target.starts_with("//?/") {
        return format!("//?/{requested_target}");
    }

    requested_target
}

fn move_image_path_identities_inner(
    conn: &rusqlite::Connection,
    moves: &[ImagePathIdentityMove],
) -> Result<ImagePathIdentityMoveResult, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(|e| e.to_string())?;

    let mut result = ImagePathIdentityMoveResult {
        moved: 0,
        skipped_target_exists: 0,
        skipped_source_missing: 0,
    };

    {
        let mut target_exists = tx
            .prepare_cached(
                "SELECT 1 FROM images
                 WHERE id = ?1 OR id = ?2 OR path = ?1 OR path = ?2
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut source_identity = tx
            .prepare_cached(
                "SELECT id, path, thumbnail_path FROM images
                 WHERE id = ?1 OR id = ?2 OR path = ?1 OR path = ?2
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut update_image = tx
            .prepare_cached(
                "UPDATE images
                 SET id = ?1,
                     path = ?1,
                     thumbnail_path = COALESCE(NULLIF(?2, ''), thumbnail_path),
                     thumbnail_source = CASE
                         WHEN NULLIF(?2, '') IS NULL THEN thumbnail_source
                         ELSE ?3
                     END,
                     is_missing = 0
                 WHERE id = ?4",
            )
            .map_err(|e| e.to_string())?;
        let mut update_collections = tx
            .prepare_cached("UPDATE collection_images SET image_id = ?1 WHERE image_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_loras = tx
            .prepare_cached("UPDATE image_loras SET image_id = ?1 WHERE image_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_embeddings = tx
            .prepare_cached("UPDATE image_embeddings SET image_id = ?1 WHERE image_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_hypernetworks = tx
            .prepare_cached("UPDATE image_hypernetworks SET image_id = ?1 WHERE image_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_controlnets = tx
            .prepare_cached("UPDATE image_controlnets SET image_id = ?1 WHERE image_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_ipadapters = tx
            .prepare_cached("UPDATE image_ipadapters SET image_id = ?1 WHERE image_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_facet_thumbnail_image = tx
            .prepare_cached(
                "UPDATE facet_cache SET thumbnail_image_id = ?1 WHERE thumbnail_image_id = ?2",
            )
            .map_err(|e| e.to_string())?;
        let mut update_facet_thumbnail_path = tx
            .prepare_cached(
                "UPDATE facet_cache
                 SET thumbnail_path = ?1
                 WHERE thumbnail_path = ?2
                    OR thumbnail_path = ?3
                    OR (?4 IS NOT NULL AND thumbnail_path = ?4)",
            )
            .map_err(|e| e.to_string())?;
        let mut update_facet_safe_thumbnail_path = tx
            .prepare_cached(
                "UPDATE facet_cache
                 SET safe_thumbnail_path = ?1
                 WHERE safe_thumbnail_path = ?2
                    OR safe_thumbnail_path = ?3
                    OR (?4 IS NOT NULL AND safe_thumbnail_path = ?4)",
            )
            .map_err(|e| e.to_string())?;
        let mut update_collection_dynamic_thumbnail_path = tx
            .prepare_cached(
                "UPDATE collections
                 SET dynamic_thumbnail_path = ?1
                 WHERE dynamic_thumbnail_path = ?2
                    OR dynamic_thumbnail_path = ?3
                    OR (?4 IS NOT NULL AND dynamic_thumbnail_path = ?4)",
            )
            .map_err(|e| e.to_string())?;
        let mut update_collection_dynamic_safe_thumbnail_path = tx
            .prepare_cached(
                "UPDATE collections
                 SET dynamic_safe_thumbnail_path = ?1
                 WHERE dynamic_safe_thumbnail_path = ?2
                    OR dynamic_safe_thumbnail_path = ?3
                    OR (?4 IS NOT NULL AND dynamic_safe_thumbnail_path = ?4)",
            )
            .map_err(|e| e.to_string())?;
        let mut update_model_thumbnail_path = tx
            .prepare_cached(
                "UPDATE models
                 SET thumbnail_path = ?1
                 WHERE thumbnail_path = ?2
                    OR thumbnail_path = ?3
                    OR (?4 IS NOT NULL AND thumbnail_path = ?4)",
            )
            .map_err(|e| e.to_string())?;

        for item in moves {
            let requested_old_id = normalize_image_identity_path(&item.old_id);
            let requested_new_id = normalize_image_identity_path(&item.new_id);
            if requested_old_id == requested_new_id {
                continue;
            }

            let alternate_old_id = alternate_windows_identity_path(&requested_old_id);

            let source_row = source_identity
                .query_row(params![&requested_old_id, &alternate_old_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .optional()
                .map_err(|e| e.to_string())?;
            let Some((old_id, source_path, source_thumbnail_path)) = source_row else {
                result.skipped_source_missing += 1;
                continue;
            };
            let new_id = preserve_source_identity_prefix(&old_id, &requested_new_id);
            let alternate_new_id = alternate_windows_identity_path(&new_id);
            let has_target = target_exists
                .exists(params![&new_id, &alternate_new_id])
                .map_err(|e| e.to_string())?;
            if has_target {
                result.skipped_target_exists += 1;
                continue;
            }
            let old_path = normalize_image_identity_path(&source_path);
            let old_thumbnail_path = source_thumbnail_path
                .as_deref()
                .map(normalize_image_identity_path);

            let thumbnail_path = item
                .thumbnail_path
                .as_deref()
                .map(normalize_image_identity_path);

            update_image
                .execute(params![
                    &new_id,
                    thumbnail_path,
                    item.thumbnail_source.as_deref(),
                    &old_id
                ])
                .map_err(|e| e.to_string())?;
            update_collections
                .execute(params![&new_id, &old_id])
                .map_err(|e| e.to_string())?;
            update_loras
                .execute(params![&new_id, &old_id])
                .map_err(|e| e.to_string())?;
            update_embeddings
                .execute(params![&new_id, &old_id])
                .map_err(|e| e.to_string())?;
            update_hypernetworks
                .execute(params![&new_id, &old_id])
                .map_err(|e| e.to_string())?;
            update_controlnets
                .execute(params![&new_id, &old_id])
                .map_err(|e| e.to_string())?;
            update_ipadapters
                .execute(params![&new_id, &old_id])
                .map_err(|e| e.to_string())?;
            update_facet_thumbnail_image
                .execute(params![&new_id, &old_id])
                .map_err(|e| e.to_string())?;

            if let Some(new_thumbnail_path) = thumbnail_path.as_deref() {
                update_model_thumbnail_path
                    .execute(params![
                        new_thumbnail_path,
                        &old_id,
                        &old_path,
                        old_thumbnail_path.as_deref()
                    ])
                    .map_err(|e| e.to_string())?;
                update_facet_thumbnail_path
                    .execute(params![
                        new_thumbnail_path,
                        &old_id,
                        &old_path,
                        old_thumbnail_path.as_deref()
                    ])
                    .map_err(|e| e.to_string())?;
                update_facet_safe_thumbnail_path
                    .execute(params![
                        new_thumbnail_path,
                        &old_id,
                        &old_path,
                        old_thumbnail_path.as_deref()
                    ])
                    .map_err(|e| e.to_string())?;
                update_collection_dynamic_thumbnail_path
                    .execute(params![
                        new_thumbnail_path,
                        &old_id,
                        &old_path,
                        old_thumbnail_path.as_deref()
                    ])
                    .map_err(|e| e.to_string())?;
                update_collection_dynamic_safe_thumbnail_path
                    .execute(params![
                        new_thumbnail_path,
                        &old_id,
                        &old_path,
                        old_thumbnail_path.as_deref()
                    ])
                    .map_err(|e| e.to_string())?;
            }

            result.moved += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

fn mark_image_path_identities_missing_inner(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut marked = 0;
    let mut seen = BTreeSet::new();

    {
        let mut mark_missing = tx
            .prepare_cached(
                "UPDATE images
                 SET is_missing = 1
                 WHERE is_missing = 0
                   AND (id = ?1 OR id = ?2 OR path = ?1 OR path = ?2)",
            )
            .map_err(|e| e.to_string())?;

        for id in ids {
            let normalized = normalize_image_identity_path(id);
            let alternate = alternate_windows_identity_path(&normalized);
            let identity_key = if normalized.starts_with("//?/") {
                alternate.clone()
            } else {
                normalized.clone()
            };
            if !seen.insert(identity_key) {
                continue;
            }

            marked += mark_missing
                .execute(params![&normalized, &alternate])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(marked)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_privacy_mask_index(
    app: AppHandle,
    masked_keywords: Vec<String>,
) -> Result<PrivacyMaskRefreshResult, String> {
    run_blocking(app, move |conn| {
        refresh_privacy_mask_index_for_conn(conn, &masked_keywords)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_invoke_owner_scope(
    app: AppHandle,
    input: InvokeOwnerScopeInput,
) -> Result<InvokeOwnerScopeRefreshResult, String> {
    run_blocking(app, move |conn| {
        let _coordinator = crate::db::facets::lock_facet_builds()?;
        refresh_invoke_owner_scope_inner(conn, &input)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn set_invoke_board_verification(
    app: AppHandle,
    db_path: String,
    owner_id: String,
    verified: bool,
) -> Result<(), String> {
    run_blocking(app, move |conn| {
        let db_path = normalize_invoke_root(&db_path);
        let owner_id = owner_id.trim();
        if db_path.is_empty() || owner_id.is_empty() {
            return Err("InvokeAI database path and owner ID are required".to_string());
        }
        let updated = conn
            .execute(
                "UPDATE invoke_owner_scope_state
                 SET boards_verified = ?3,
                     updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                 WHERE state_key = 'current'
                   AND scope_mode = 'owner'
                   AND owner_id = ?2
                   AND (
                       db_path = ?1
                       OR LOWER(RTRIM(REPLACE(db_path, '\\', '/'), '/'))
                          = LOWER(RTRIM(REPLACE(?1, '\\', '/'), '/'))
                   )",
                params![db_path, owner_id, verified],
            )
            .map_err(|error| error.to_string())?;
        if updated != 1 {
            return Err(
                "InvokeAI board verification no longer matches the active owner scope".to_string(),
            );
        }
        Ok(())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn begin_active_invoke_scope_cache_build(
    app: AppHandle,
) -> Result<InvokeScopeCacheBuildClaim, String> {
    run_blocking(app, move |conn| {
        let _coordinator = crate::db::facets::lock_facet_builds()?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let claim = begin_active_scope_cache_build_inner(&tx)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(claim)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn abort_active_invoke_scope_cache_build(
    app: AppHandle,
    ticket: InvokeScopeCacheBuildTicket,
) -> Result<FacetScopeCacheStatus, String> {
    run_blocking(app, move |conn| {
        let _coordinator = crate::db::facets::lock_facet_builds()?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let status = abort_active_scope_cache_build_inner(&tx, &ticket)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(status)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn commit_active_invoke_scope_cache(
    app: AppHandle,
    ticket: InvokeScopeCacheBuildTicket,
) -> Result<FacetScopeCacheStatus, String> {
    run_blocking(app, move |conn| {
        let _coordinator = crate::db::facets::lock_facet_builds()?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        let status = commit_active_scope_cache_inner(&tx, &ticket)?;
        tx.commit().map_err(|error| error.to_string())?;
        Ok(status)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn save_images_batch(app: AppHandle, images: Vec<ImageRecord>) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        // Retry loop for database lock issues
        let max_retries = 5;
        let mut retry_delay_ms = 100;

        for attempt in 0..max_retries {
            let result = save_images_batch_inner(conn, &images);

            match result {
                Ok(count) => return Ok(count),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
        Err("Failed to save images after max retries".to_string())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reconcile_invoke_owner_inventory(
    app: AppHandle,
    input: InvokeImageOwnerInventoryInput,
) -> Result<InvokeImageSourceReconcileResult, String> {
    run_blocking(app, move |conn| {
        let _coordinator = crate::db::facets::lock_facet_builds()?;
        reconcile_invoke_owner_inventory_inner(conn, &input)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reconcile_invoke_image_sources(
    app: AppHandle,
    updates: Vec<InvokeImageSourceUpdate>,
) -> Result<InvokeImageSourceReconcileResult, String> {
    run_blocking(app, move |conn| {
        let max_retries = 5;
        let mut retry_delay_ms = 100;

        for attempt in 0..max_retries {
            let result = reconcile_invoke_image_sources_inner(conn, &updates);

            match result {
                Ok(result) => return Ok(result),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err("Failed to reconcile InvokeAI image sources after max retries".to_string())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn replace_invoke_image_references(
    app: AppHandle,
    reference_sets: Vec<InvokeImageReferenceSet>,
) -> Result<InvokeImageReferenceReplaceResult, String> {
    run_blocking(app, move |conn| {
        let max_retries = 5;
        let mut retry_delay_ms = 100;

        for attempt in 0..max_retries {
            let result = replace_invoke_image_references_inner(conn, &reference_sets);

            match result {
                Ok(result) => return Ok(result),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err("Failed to replace InvokeAI image references after max retries".to_string())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn move_image_path_identities(
    app: AppHandle,
    moves: Vec<ImagePathIdentityMove>,
) -> Result<ImagePathIdentityMoveResult, String> {
    run_blocking(app, move |conn| {
        let max_retries = 5;
        let mut retry_delay_ms = 100;

        for attempt in 0..max_retries {
            let result = move_image_path_identities_inner(conn, &moves);

            match result {
                Ok(result) => return Ok(result),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err("Failed to move image paths after max retries".to_string())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn mark_image_path_identities_missing(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let max_retries = 5;
        let mut retry_delay_ms = 100;

        for attempt in 0..max_retries {
            let result = mark_image_path_identities_missing_inner(conn, &ids);

            match result {
                Ok(marked) => return Ok(marked),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err("Failed to mark missing image paths after max retries".to_string())
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_image_count_for_path_prefix(app: AppHandle, path: String) -> Result<i64, String> {
    run_blocking(app, move |conn| {
        let normalized = path.trim_end_matches(['/', '\\']);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_images
                 WHERE invoke_scope_hidden = 0 AND (path LIKE ? OR path LIKE ?)",
                params![format!("{}/%", normalized), format!("{}\\%", normalized)],
                |r| r.get(0),
            )
            .unwrap_or(0);
        Ok(count)
    })
    .await
}

fn reconcile_invoke_board_snapshot_inner(
    conn: &rusqlite::Connection,
    input: &InvokeBoardSnapshotInput,
) -> Result<InvokeBoardSnapshotResult, String> {
    let db_path = normalize_invoke_root(input.db_path.trim());
    if db_path.is_empty() {
        return Err("InvokeAI database path is required".to_string());
    }
    let owner_id = input
        .owner_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if input.mode == InvokeOwnerScopeMode::Owner && owner_id.is_none() {
        return Err("Owner board reconciliation requires an owner ID".to_string());
    }
    if matches!(input.mode, InvokeOwnerScopeMode::Unselected) {
        return Err("Boards cannot be reconciled before an owner scope is selected".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS temp_invoke_board_snapshot (
             board_id TEXT PRIMARY KEY,
             board_name TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             owner_id TEXT
         ) WITHOUT ROWID;
         CREATE TEMP TABLE IF NOT EXISTS temp_invoke_board_membership_snapshot (
             image_name TEXT PRIMARY KEY,
             board_id TEXT NOT NULL
         ) WITHOUT ROWID;
         DELETE FROM temp_invoke_board_snapshot;
         DELETE FROM temp_invoke_board_membership_snapshot;",
    )
    .map_err(|error| error.to_string())?;

    {
        let mut insert_board = tx
            .prepare_cached(
                "INSERT INTO temp_invoke_board_snapshot (
                     board_id, board_name, created_at, owner_id
                 ) VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(|error| error.to_string())?;
        for board in &input.boards {
            let board_id = board.id.trim();
            if board_id.is_empty() {
                return Err("InvokeAI board IDs cannot be empty".to_string());
            }
            insert_board
                .execute(params![
                    board_id,
                    board.name,
                    board.created_at,
                    board
                        .owner_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    if input.reconcile_memberships {
        let mut insert_membership = tx
            .prepare_cached(
                "INSERT INTO temp_invoke_board_membership_snapshot (image_name, board_id)
                 VALUES (?1, ?2)",
            )
            .map_err(|error| error.to_string())?;
        for membership in &input.memberships {
            let image_name = membership.image_name.trim();
            let board_id = membership.board_id.trim();
            if image_name.is_empty() || board_id.is_empty() {
                return Err("InvokeAI board memberships cannot contain empty IDs".to_string());
            }
            insert_membership
                .execute(params![image_name, board_id])
                .map_err(|error| error.to_string())?;
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let has_collection_updated_at = {
        let mut statement = tx
            .prepare("PRAGMA table_info(collections)")
            .map_err(|error| error.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        columns.iter().any(|column| column == "updated_at")
    };
    let upsert_boards_sql = if has_collection_updated_at {
        "INSERT INTO collections (
             id, name, is_archived, is_pinned, created_at, source,
             invoke_owner_id, invoke_source_id, invoke_board_verified,
             invoke_source_name, invoke_source_present, updated_at
         )
         SELECT board_id, board_name, 0, 0, created_at, 'invoke', owner_id, ?1, 1,
                board_name, 1, ?2
         FROM temp_invoke_board_snapshot
         WHERE 1 = 1
         ON CONFLICT(id) DO UPDATE SET
             name = CASE
                 WHEN collections.invoke_source_name IS NOT NULL
                  AND collections.name = collections.invoke_source_name
                 THEN excluded.name
                 ELSE collections.name
             END,
             source = 'invoke',
             invoke_owner_id = excluded.invoke_owner_id,
             invoke_source_id = excluded.invoke_source_id,
             invoke_board_verified = 1,
             invoke_source_name = excluded.invoke_source_name,
             invoke_source_present = 1,
             updated_at = MAX(COALESCE(collections.updated_at, 0) + 1, excluded.updated_at)
         WHERE (
                collections.invoke_source_name IS NOT NULL
                AND collections.name = collections.invoke_source_name
                AND collections.name IS NOT excluded.name
             )
            OR collections.source IS NOT 'invoke'
            OR collections.invoke_owner_id IS NOT excluded.invoke_owner_id
            OR collections.invoke_source_id IS NOT excluded.invoke_source_id
            OR collections.invoke_board_verified IS NOT 1
            OR collections.invoke_source_name IS NOT excluded.invoke_source_name
            OR collections.invoke_source_present IS NOT 1"
    } else {
        "INSERT INTO collections (
             id, name, is_archived, is_pinned, created_at, source,
             invoke_owner_id, invoke_source_id, invoke_board_verified,
             invoke_source_name, invoke_source_present
         )
         SELECT board_id, board_name, 0, 0, created_at, 'invoke', owner_id, ?1, 1,
                board_name, 1
         FROM temp_invoke_board_snapshot
         WHERE 1 = 1
         ON CONFLICT(id) DO UPDATE SET
             name = CASE
                 WHEN collections.invoke_source_name IS NOT NULL
                  AND collections.name = collections.invoke_source_name
                 THEN excluded.name
                 ELSE collections.name
             END,
             source = 'invoke',
             invoke_owner_id = excluded.invoke_owner_id,
             invoke_source_id = excluded.invoke_source_id,
             invoke_board_verified = 1,
             invoke_source_name = excluded.invoke_source_name,
             invoke_source_present = 1
         WHERE (
                collections.invoke_source_name IS NOT NULL
                AND collections.name = collections.invoke_source_name
                AND collections.name IS NOT excluded.name
             )
            OR collections.source IS NOT 'invoke'
            OR collections.invoke_owner_id IS NOT excluded.invoke_owner_id
            OR collections.invoke_source_id IS NOT excluded.invoke_source_id
            OR collections.invoke_board_verified IS NOT 1
            OR collections.invoke_source_name IS NOT excluded.invoke_source_name
            OR collections.invoke_source_present IS NOT 1"
    };
    let mut collections_updated = if has_collection_updated_at {
        tx.execute(upsert_boards_sql, params![db_path, now])
    } else {
        tx.execute(upsert_boards_sql, params![db_path])
    }
    .map_err(|error| error.to_string())?;

    let source_match = if cfg!(windows) {
        "LOWER(RTRIM(REPLACE(invoke_source_id, '\\', '/'), '/')) = LOWER(?1)"
    } else {
        "invoke_source_id = ?1"
    };
    // Keep one parameter shape for every mode. All-user and legacy snapshots
    // bind NULL so the predicate includes every owner; owner snapshots bind
    // the selected ID. This avoids dynamically producing one-parameter SQL
    // while still passing the two-parameter owner binding.
    let owner_match = "(?2 IS NULL OR invoke_owner_id = ?2)";
    let owner_param = match input.mode {
        InvokeOwnerScopeMode::Owner => owner_id,
        InvokeOwnerScopeMode::Legacy | InvokeOwnerScopeMode::All => None,
        InvokeOwnerScopeMode::Unselected => unreachable!(),
    };

    let missing_collections_updated = if input.delete_missing_collections {
        tx.execute(
            &format!(
                "UPDATE collections
                 SET invoke_source_present = 0
                 WHERE source = 'invoke'
                   AND {source_match}
                   AND {owner_match}
                   AND invoke_source_present IS NOT 0
                   AND NOT EXISTS (
                       SELECT 1 FROM temp_invoke_board_snapshot snapshot
                       WHERE snapshot.board_id = collections.id
                   )"
            ),
            params![db_path, owner_param],
        )
        .map_err(|error| error.to_string())?
    } else {
        0
    };

    if !input.delete_missing_collections
        && matches!(
            input.mode,
            InvokeOwnerScopeMode::All | InvokeOwnerScopeMode::Legacy
        )
    {
        // An authoritative catalog can prove that a previously synchronized board
        // is currently absent, but absence alone does not invalidate its last
        // verified owner. Preserve that verification so the retained local
        // collection remains recoverable and visible as source-unavailable.
        collections_updated += tx
            .execute(
                &format!(
                    "UPDATE collections
                     SET invoke_source_present = 0
                     WHERE source = 'invoke'
                       AND {source_match}
                       AND invoke_source_present IS NOT 0
                       AND NOT EXISTS (
                           SELECT 1 FROM temp_invoke_board_snapshot snapshot
                           WHERE snapshot.board_id = collections.id
                       )"
                ),
                [&db_path],
            )
            .map_err(|error| error.to_string())?;
    }

    let mut result = InvokeBoardSnapshotResult {
        collections_updated: collections_updated + missing_collections_updated,
        collections_deleted: 0,
        ..Default::default()
    };

    if input.reconcile_memberships {
        let image_source_match =
            source_match.replace("invoke_source_id", "images.invoke_source_id");
        let image_owner_match = owner_match.replace("invoke_owner_id", "images.invoke_owner_id");
        let removed_source_match =
            source_match.replace("invoke_source_id", "removed_images.invoke_source_id");
        let removed_owner_match =
            owner_match.replace("invoke_owner_id", "removed_images.invoke_owner_id");
        result.images_updated = tx
            .execute(
                &format!(
                    "UPDATE images
                     SET board_id = (
                         SELECT snapshot.board_id
                         FROM temp_invoke_board_membership_snapshot snapshot
                         WHERE snapshot.image_name = images.invoke_image_name
                     )
                     WHERE {image_source_match}
                       AND {image_owner_match}
                       AND board_id IS NOT (
                           SELECT snapshot.board_id
                           FROM temp_invoke_board_membership_snapshot snapshot
                           WHERE snapshot.image_name = images.invoke_image_name
                       )"
                ),
                params![db_path, owner_param],
            )
            .map_err(|error| error.to_string())?;

        result.images_updated += tx
            .execute(
                &format!(
                    "UPDATE removed_images
                     SET board_id = (
                         SELECT snapshot.board_id
                         FROM temp_invoke_board_membership_snapshot snapshot
                         WHERE snapshot.image_name = removed_images.invoke_image_name
                     )
                     WHERE {removed_source_match}
                       AND {removed_owner_match}
                       AND board_id IS NOT (
                           SELECT snapshot.board_id
                           FROM temp_invoke_board_membership_snapshot snapshot
                           WHERE snapshot.image_name = removed_images.invoke_image_name
                       )"
                ),
                params![db_path, owner_param],
            )
            .map_err(|error| error.to_string())?;

        tx.execute(
            "DELETE FROM invoke_board_membership_snapshot
             WHERE collection_id IN (
                 SELECT board_id FROM temp_invoke_board_snapshot
             )",
            [],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO invoke_board_membership_snapshot (
                 collection_id, invoke_image_name
             )
             SELECT membership.board_id, membership.image_name
             FROM temp_invoke_board_membership_snapshot membership
             INNER JOIN temp_invoke_board_snapshot board
                ON board.board_id = membership.board_id",
            [],
        )
        .map_err(|error| error.to_string())?;

        result.memberships_deleted = tx
            .execute(
                "DELETE FROM collection_images AS membership
                 WHERE membership.collection_id IN (
                     SELECT board_id FROM temp_invoke_board_snapshot
                 )
                   AND NOT EXISTS (
                       SELECT 1
                       FROM invoke_board_membership_additions additions
                       WHERE additions.collection_id = membership.collection_id
                         AND additions.image_id = membership.image_id
                   )
                   AND NOT EXISTS (
                       SELECT 1
                       FROM images
                       INNER JOIN invoke_board_membership_snapshot snapshot
                          ON snapshot.invoke_image_name = images.invoke_image_name
                         AND snapshot.collection_id = membership.collection_id
                       WHERE images.id = membership.image_id
                         AND NOT EXISTS (
                             SELECT 1
                             FROM invoke_board_membership_exclusions exclusions
                             WHERE exclusions.collection_id = snapshot.collection_id
                               AND exclusions.invoke_image_name = snapshot.invoke_image_name
                         )
                   )",
                [],
            )
            .map_err(|error| error.to_string())?;
        result.memberships_inserted = tx
            .execute(
                &format!(
                    "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
                     SELECT snapshot.collection_id, images.id
                     FROM invoke_board_membership_snapshot snapshot
                     INNER JOIN temp_invoke_board_snapshot board
                        ON board.board_id = snapshot.collection_id
                     INNER JOIN images
                        ON images.invoke_image_name = snapshot.invoke_image_name
                     WHERE {image_source_match}
                       AND {image_owner_match}
                       AND NOT EXISTS (
                           SELECT 1
                           FROM invoke_board_membership_exclusions exclusions
                           WHERE exclusions.collection_id = snapshot.collection_id
                             AND exclusions.invoke_image_name = snapshot.invoke_image_name
                       )"
                ),
                params![db_path, owner_param],
            )
            .map_err(|error| error.to_string())?;
        result.memberships_inserted += tx
            .execute(
                "INSERT OR IGNORE INTO collection_images (collection_id, image_id)
                 SELECT additions.collection_id, additions.image_id
                 FROM invoke_board_membership_additions additions
                 INNER JOIN temp_invoke_board_snapshot board
                    ON board.board_id = additions.collection_id
                 INNER JOIN images ON images.id = additions.image_id",
                [],
            )
            .map_err(|error| error.to_string())?;
        tx.execute(
            "UPDATE collections
             SET dynamic_thumbnail_path = NULL,
                 dynamic_safe_thumbnail_path = NULL,
                 dynamic_thumbnail_is_sensitive = NULL,
                 dynamic_thumbnail_cached_at = NULL,
                 dynamic_count = NULL
             WHERE id IN (SELECT board_id FROM temp_invoke_board_snapshot)",
            [],
        )
        .map_err(|error| error.to_string())?;
    }

    tx.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn reconcile_invoke_board_snapshot(
    app: AppHandle,
    input: InvokeBoardSnapshotInput,
) -> Result<InvokeBoardSnapshotResult, String> {
    run_blocking(app, move |conn| {
        reconcile_invoke_board_snapshot_inner(conn, &input)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_boards_native(
    app: AppHandle,
    board_mapping: std::collections::HashMap<String, String>,
) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let images_to_check: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, path FROM scoped_images WHERE board_id IS NULL")
                .map_err(|e| e.to_string())?;
            let items = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, rusqlite::Error>>()
                .map_err(|e| e.to_string())?;
            drop(stmt);
            items
        };

        if images_to_check.is_empty() {
            return Ok(0);
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;
        {
            let mut update_stmt = tx
                .prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2")
                .map_err(|e| e.to_string())?;
            for (id, path) in images_to_check {
                let filename = path
                    .split('/')
                    .last()
                    .or_else(|| path.split('\\').last())
                    .unwrap_or(&path);
                if let Some(board_name) = board_mapping.get(filename) {
                    update_stmt
                        .execute(params![board_name, id])
                        .map_err(|e| e.to_string())?;
                    updated_count += 1;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn mark_images_corrupt(app: AppHandle, ids: Vec<String>) -> Result<usize, String> {
    run_blocking(app, move |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;
        {
            let mut stmt = tx.prepare_cached("UPDATE images SET is_corrupt = 1, thumbnail_path = '', micro_thumbnail = NULL WHERE id = ?1").map_err(|e| e.to_string())?;
            for id in ids {
                updated_count += stmt.execute(params![id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    }).await
}

#[derive(serde::Serialize, specta::Type)]
pub struct IntegrityResult {
    pub missing: usize,
    pub recovered: usize,
    pub broken_thumbs: usize,
}

fn load_visible_integrity_images(
    conn: &Connection,
) -> Result<Vec<(String, String, Option<String>)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, path, thumbnail_path
             FROM scoped_images
             WHERE invoke_scope_hidden = 0",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, rusqlite::Error>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn verify_library_integrity(app: AppHandle) -> Result<IntegrityResult, String> {
    run_blocking(app, move |conn| {
        let images = load_visible_integrity_images(conn)?;

        if images.is_empty() {
            return Ok(IntegrityResult {
                missing: 0,
                recovered: 0,
                broken_thumbs: 0,
            });
        }

        let mut ids_to_mark_missing = Vec::new();
        let mut ids_to_mark_found = Vec::new();
        let mut ids_to_clear_thumb = Vec::new();

        for (id, path, thumb_path) in images {
            let path_exists = std::path::Path::new(&path).exists();
            if !path_exists {
                ids_to_mark_missing.push(id.clone());
            } else {
                ids_to_mark_found.push(id.clone());
                if let Some(t_path) = thumb_path {
                    if !t_path.is_empty() && !std::path::Path::new(&t_path).exists() {
                        ids_to_clear_thumb.push(id);
                    }
                }
            }
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut missing_count = 0;
        let mut thumb_count = 0;
        {
            let mut missing_stmt = tx
                .prepare_cached("UPDATE images SET is_missing = 1 WHERE id = ?")
                .map_err(|e| e.to_string())?;
            for id in &ids_to_mark_missing {
                missing_count += missing_stmt
                    .execute(params![id])
                    .map_err(|e| e.to_string())?;
            }

            let mut found_stmt = tx
                .prepare_cached("UPDATE images SET is_missing = 0 WHERE id = ?")
                .map_err(|e| e.to_string())?;
            for id in &ids_to_mark_found {
                found_stmt.execute(params![id]).map_err(|e| e.to_string())?;
            }

            let mut clear_stmt = tx
                .prepare_cached(
                    "UPDATE images SET thumbnail_path = '', micro_thumbnail = NULL WHERE id = ?",
                )
                .map_err(|e| e.to_string())?;
            for id in ids_to_clear_thumb {
                thumb_count += clear_stmt.execute(params![id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(IntegrityResult {
            missing: missing_count,
            recovered: ids_to_mark_found.len(),
            broken_thumbs: thumb_count,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use crate::db::{migrations::init_db, ImageRecord};
    use rusqlite::{params, Connection};

    fn create_image_record(
        id: &str,
        timestamp: u64,
        file_size: u64,
        metadata_json: &str,
    ) -> ImageRecord {
        ImageRecord {
            id: id.to_string(),
            path: format!("C:/library/{}.png", id),
            width: 1024,
            height: 1024,
            file_size,
            file_hash: Some(format!("hash-{}", id)),
            timestamp,
            metadata_json: metadata_json.to_string(),
            thumbnail_path: format!("C:/thumbs/{}.webp", id),
            micro_thumbnail: None,
            thumbnail_source: Some("ambit".to_string()),
            is_favorite: false,
            is_pinned: false,
            is_deleted: false,
            is_missing: false,
            is_corrupt: false,
            user_masked: None,
            group_id: None,
            board_id: None,
            notes: None,
            original_metadata_json: Some(metadata_json.to_string()),
            original_state_json: None,
            invoke_image_name: None,
            invoke_image_category: None,
            invoke_image_origin: None,
            invoke_owner_id: None,
        }
    }

    fn apply_all_migrations(conn: &Connection) {
        for migration in init_db() {
            conn.execute_batch(&migration.sql)
                .expect("apply migrations");
        }
    }

    #[test]
    fn invoke_root_classification_uses_literal_prefixes_for_save_and_refresh() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        for (root, matched, unmatched) in [
            (
                "/InvokeRoot",
                "/InvokeRoot/outputs/images/exact.png",
                "/invokeroot/outputs/images/case-only.png",
            ),
            (
                "C:/Invoke%Root",
                "c:/invoke%root/outputs/images/case.png",
                "C:/InvokeXRoot/outputs/images/percent.png",
            ),
            (
                "C:/Invoke_Root",
                "c:/invoke_root/outputs/images/underscore.png",
                "C:/InvokeXRoot/outputs/images/underscore-miss.png",
            ),
            (
                "//Server/Share",
                "//server/share/outputs/images/unc.png",
                "//ServerXShare/outputs/images/unc-miss.png",
            ),
        ] {
            let db_path = format!("{root}/invokeai.db");
            super::refresh_invoke_owner_scope_inner(
                &conn,
                &super::InvokeOwnerScopeInput {
                    db_path: db_path.clone(),
                    images_root: root.into(),
                    mode: super::InvokeOwnerScopeMode::All,
                    owner_id: None,
                    force_refresh: false,
                },
            )
            .expect("activate root");
            let mut save_match = create_image_record(&format!("save-match-{root}"), 1, 1, "{}");
            save_match.path = matched.into();
            let mut save_miss = create_image_record(&format!("save-miss-{root}"), 2, 1, "{}");
            save_miss.path = unmatched.into();
            super::save_images_batch_inner(&conn, &[save_match, save_miss]).expect("save rows");
            let saved: Vec<(String, Option<String>)> = conn.prepare(
                "SELECT path, invoke_source_id FROM images WHERE path IN (?1, ?2) ORDER BY path"
            ).expect("saved query").query_map([matched, unmatched], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("saved rows").collect::<Result<_, _>>().expect("collect saved");
            assert!(saved.iter().any(
                |(path, source)| path == matched && source.as_deref() == Some(db_path.as_str())
            ));
            assert!(saved
                .iter()
                .any(|(path, source)| path == unmatched && source.is_none()));

            let refresh_match_id = format!("refresh-match-{root}");
            conn.execute(
                "DELETE FROM images WHERE path IN (?1, ?2)",
                [matched, unmatched],
            )
            .expect("clear saved rows before refresh fixture");
            let refresh_miss_id = format!("refresh-miss-{root}");
            conn.execute(
                "INSERT INTO images (id, path, timestamp) VALUES (?1, ?2, 3), (?3, ?4, 4)",
                [
                    refresh_match_id.as_str(),
                    matched,
                    refresh_miss_id.as_str(),
                    unmatched,
                ],
            )
            .expect("seed refresh rows");
            super::refresh_invoke_owner_scope_inner(
                &conn,
                &super::InvokeOwnerScopeInput {
                    db_path: db_path.clone(),
                    images_root: root.into(),
                    mode: super::InvokeOwnerScopeMode::Owner,
                    owner_id: Some("owner".into()),
                    force_refresh: false,
                },
            )
            .expect("refresh root");
            let refreshed: Vec<(String, Option<String>)> = conn
                .prepare(
                    "SELECT path, invoke_source_id FROM images WHERE id IN (?1, ?2) ORDER BY path",
                )
                .expect("refreshed query")
                .query_map(
                    [refresh_match_id.as_str(), refresh_miss_id.as_str()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("refreshed rows")
                .collect::<Result<_, _>>()
                .expect("collect refreshed");
            assert!(refreshed.iter().any(
                |(path, source)| path == matched && source.as_deref() == Some(db_path.as_str())
            ));
            assert!(refreshed
                .iter()
                .any(|(path, source)| path == unmatched && source.is_none()));
        }
    }
    #[test]
    fn dirty_ledger_survives_upgrade_and_remains_idempotent_inside_upserts() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        for migration in init_db()
            .into_iter()
            .filter(|migration| migration.version <= 71)
        {
            conn.execute_batch(&migration.sql)
                .expect("apply migrations through dirty ledger v71");
        }
        conn.execute(
            "INSERT INTO invoke_scope_cache_state (
                 scope_key, db_path, images_root, scope_mode, owner_id,
                 status, generation, built_generation, updated_at
             ) VALUES ('all', 'C:/Invoke/databases/invokeai.db', 'C:/Invoke',
                       'all', NULL, 'ready', 0, 0, 1)",
            [],
        )
        .expect("seed all-users cache state");
        conn.execute(
            "UPDATE invoke_scope_cache_control
             SET active_scope_key = 'all' WHERE state_key = 'current'",
            [],
        )
        .expect("activate all-users cache state");
        conn.execute(
            "INSERT INTO collections (
                 id, name, created_at, source, invoke_owner_id, invoke_source_id
             ) VALUES ('board', 'Before', 1, 'invoke', 'owner-a',
                       'C:/Invoke/databases/invokeai.db')",
            [],
        )
        .expect("seed board and its dirty-ledger entry");

        let state_before: (String, i64, Option<i64>) = conn
            .query_row(
                "SELECT status, generation, built_generation
                 FROM invoke_scope_cache_state WHERE scope_key = 'all'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("cache state before migration 72");
        let dirty_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE scope_key = 'all'",
                [],
                |row| row.get(0),
            )
            .expect("dirty entries before migration 72");

        conn.execute_batch(
            &crate::db::migrations::m72_invoke_scope_dirty_conflicts::migration72().sql,
        )
        .expect("apply dirty-ledger conflict repair");

        let repaired_trigger_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'trigger'
                   AND name LIKE 'invoke_scope_cache_%_detail'
                   AND sql LIKE '%ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING%'
                   AND sql NOT LIKE '%INSERT OR IGNORE INTO invoke_scope_cache_dirty_items%'",
                [],
                |row| row.get(0),
            )
            .expect("repaired trigger count");
        assert_eq!(repaired_trigger_count, 26);

        let state_after: (String, i64, Option<i64>) = conn
            .query_row(
                "SELECT status, generation, built_generation
                 FROM invoke_scope_cache_state WHERE scope_key = 'all'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("cache state after migration 72");
        let dirty_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE scope_key = 'all'",
                [],
                |row| row.get(0),
            )
            .expect("dirty entries after migration 72");
        assert_eq!(
            state_after, state_before,
            "trigger repair must not rebuild cache state"
        );
        assert_eq!(
            dirty_after, dirty_before,
            "trigger repair must preserve pending work"
        );

        conn.execute(
            "INSERT INTO collections (
                 id, name, created_at, source, invoke_owner_id, invoke_source_id
             ) VALUES ('board', 'After', 1, 'invoke', 'owner-a',
                       'C:/Invoke/databases/invokeai.db')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            [],
        )
        .expect("board UPSERT must tolerate the existing collections dirty key");

        let mut initial =
            create_image_record("image", 100, 10, r#"{"model":"OldModel","tool":"OldTool"}"#);
        initial.path = "C:/Invoke/outputs/images/image.png".to_string();
        super::save_images_batch_inner(&conn, &[initial]).expect("insert image");

        let mut updated =
            create_image_record("image", 101, 10, r#"{"model":"NewModel","tool":"NewTool"}"#);
        updated.path = "C:/Invoke/outputs/images/image.png".to_string();
        super::save_images_batch_inner(&conn, &[updated])
            .expect("image UPSERT must tolerate old dirty keys and record new ones");

        let checkpoint_resources: Vec<String> = conn
            .prepare(
                "SELECT resource_name FROM invoke_scope_cache_dirty_items
                 WHERE scope_key = 'all' AND domain = 'facet_resource'
                   AND facet_type = 'checkpoints'
                 ORDER BY resource_name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(checkpoint_resources, vec!["NewModel", "OldModel"]);
    }

    #[test]
    fn integrity_scan_excludes_images_outside_the_active_owner_scope() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        conn.execute(
            "INSERT INTO images (id, path, timestamp, invoke_scope_hidden)
             VALUES
                ('visible', 'visible.png', 1, 0),
                ('owner-hidden', 'hidden.png', 2, 1)",
            [],
        )
        .expect("insert images");

        let rows = super::load_visible_integrity_images(&conn).expect("load integrity rows");

        assert_eq!(
            rows,
            vec![("visible".to_string(), "visible.png".to_string(), None)]
        );
    }

    fn fetch_thumbnail_state(
        conn: &Connection,
        id: &str,
    ) -> (
        String,
        Option<String>,
        i64,
        i64,
        Option<String>,
        Option<i64>,
    ) {
        conn.query_row(
            "SELECT thumbnail_path,
                    thumbnail_source,
                    thumbnail_version,
                    thumbnail_failure_count,
                    thumbnail_last_error,
                    thumbnail_last_attempt_at
             FROM images
             WHERE id = ?1",
            params![id],
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
        .expect("thumbnail state")
    }

    #[test]
    fn reconcile_invoke_sources_updates_only_source_facts_for_active_and_removed_rows() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let mut active = create_image_record(
            "invoke-active",
            100,
            200,
            r#"{"positivePrompt":"user edited"}"#,
        );
        active.is_favorite = true;
        active.is_pinned = true;
        active.board_id = Some("keep-active-board".to_string());
        active.notes = Some("keep active note".to_string());
        active.invoke_image_name = Some("old-active.png".to_string());
        active.invoke_image_category = Some("control".to_string());
        active.invoke_image_origin = Some("internal".to_string());
        super::save_images_batch_inner(&conn, &[active]).expect("insert active row");

        conn.execute(
            "INSERT INTO removed_images (
                id, path, timestamp, metadata_json, is_favorite, is_pinned, board_id,
                notes, removed_at,
                invoke_image_name, invoke_image_category, invoke_image_origin
             ) VALUES (
                'invoke-removed', 'C:/library/invoke-removed.png', 101,
                '{\"positivePrompt\":\"removed edit\"}', 1, 1, 'keep-removed-board',
                'keep removed note', 999,
                'old-removed.png', 'general', 'internal'
             )",
            [],
        )
        .expect("insert removed row");
        let updates = vec![
            super::InvokeImageSourceUpdate {
                id: "invoke-active".to_string(),
                invoke_image_name: "active.png".to_string(),
                invoke_image_category: None,
                invoke_image_origin: None,
                invoke_owner_id: Some("owner-active".to_string()),
            },
            super::InvokeImageSourceUpdate {
                id: "invoke-removed".to_string(),
                invoke_image_name: "removed.png".to_string(),
                invoke_image_category: Some("mask".to_string()),
                invoke_image_origin: Some("external".to_string()),
                invoke_owner_id: Some("owner-removed".to_string()),
            },
            super::InvokeImageSourceUpdate {
                id: "missing".to_string(),
                invoke_image_name: "missing.png".to_string(),
                invoke_image_category: Some("user".to_string()),
                invoke_image_origin: None,
                invoke_owner_id: None,
            },
        ];

        let result = super::reconcile_invoke_image_sources_inner(&conn, &updates)
            .expect("reconcile source facts");
        assert_eq!(result.active_updated, 1);
        assert_eq!(result.removed_updated, 1);

        let active_state: (
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
            String,
            i64,
            i64,
            String,
            String,
        ) = conn
            .query_row(
                "SELECT invoke_image_name, invoke_image_category, invoke_image_origin,
                        is_invoke_asset_gen, metadata_json, is_favorite, is_pinned,
                        board_id, notes
                 FROM images WHERE id = 'invoke-active'",
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
                        row.get(8)?,
                    ))
                },
            )
            .expect("active source state");
        assert_eq!(
            active_state,
            (
                "active.png".to_string(),
                None,
                None,
                None,
                r#"{"positivePrompt":"user edited"}"#.to_string(),
                1,
                1,
                "keep-active-board".to_string(),
                "keep active note".to_string(),
            )
        );

        let removed_state: (
            String,
            String,
            String,
            Option<i64>,
            String,
            i64,
            i64,
            String,
            String,
            i64,
        ) = conn
            .query_row(
                "SELECT invoke_image_name, invoke_image_category, invoke_image_origin,
                        is_invoke_asset_gen, metadata_json, is_favorite, is_pinned,
                        board_id, notes, removed_at
                 FROM removed_images WHERE id = 'invoke-removed'",
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
                        row.get(8)?,
                        row.get(9)?,
                    ))
                },
            )
            .expect("removed source state");
        assert_eq!(
            removed_state,
            (
                "removed.png".to_string(),
                "mask".to_string(),
                "external".to_string(),
                Some(1),
                r#"{"positivePrompt":"removed edit"}"#.to_string(),
                1,
                1,
                "keep-removed-board".to_string(),
                "keep removed note".to_string(),
                999,
            )
        );

        let repeated = super::reconcile_invoke_image_sources_inner(&conn, &updates)
            .expect("repeat reconciliation");
        assert_eq!(repeated.active_updated, 0);
        assert_eq!(repeated.removed_updated, 0);
    }

    #[test]
    fn authoritative_owner_inventory_reassigns_transfers_and_unassigns_missing_rows() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        conn.execute_batch(
            "INSERT INTO images (
                 id, path, timestamp, invoke_source_id, invoke_owner_id
             ) VALUES
                 ('active-moved', 'C:/Invoke/outputs/images/moved.png', 1, 'invoke.db', 'owner-a'),
                 ('other-source', 'C:/Other/outputs/images/other.png', 2, 'other.db', 'owner-a');
             INSERT INTO removed_images (
                 id, path, timestamp, removed_at, invoke_source_id, invoke_owner_id
             ) VALUES
                 ('removed-missing', 'C:/Invoke/outputs/images/missing.png', 3, 4, 'invoke.db', 'owner-a');",
        )
        .expect("seed ownership rows");

        let result = super::reconcile_invoke_owner_inventory_inner(
            &conn,
            &super::InvokeImageOwnerInventoryInput {
                db_path: "invoke.db".to_string(),
                images: vec![super::InvokeImageOwnerInventoryItem {
                    id: "active-moved".to_string(),
                    invoke_owner_id: Some("owner-b".to_string()),
                }],
            },
        )
        .expect("reconcile complete inventory");

        assert_eq!(result.active_updated, 1);
        assert_eq!(result.removed_updated, 1);
        let active_owner: Option<String> = conn
            .query_row(
                "SELECT invoke_owner_id FROM images WHERE id = 'active-moved'",
                [],
                |row| row.get(0),
            )
            .expect("active owner");
        let removed_owner: Option<String> = conn
            .query_row(
                "SELECT invoke_owner_id FROM removed_images WHERE id = 'removed-missing'",
                [],
                |row| row.get(0),
            )
            .expect("removed owner");
        let other_owner: Option<String> = conn
            .query_row(
                "SELECT invoke_owner_id FROM images WHERE id = 'other-source'",
                [],
                |row| row.get(0),
            )
            .expect("other source owner");
        assert_eq!(active_owner.as_deref(), Some("owner-b"));
        assert_eq!(removed_owner, None);
        assert_eq!(other_owner.as_deref(), Some("owner-a"));

        let repeated = super::reconcile_invoke_owner_inventory_inner(
            &conn,
            &super::InvokeImageOwnerInventoryInput {
                db_path: "invoke.db".to_string(),
                images: vec![super::InvokeImageOwnerInventoryItem {
                    id: "active-moved".to_string(),
                    invoke_owner_id: Some("owner-b".to_string()),
                }],
            },
        )
        .expect("repeat inventory");
        assert_eq!(repeated, super::InvokeImageSourceReconcileResult::default());
    }

    #[test]
    fn owner_scope_reconciles_active_and_removed_rows_without_deleting_or_touching_other_roots() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        for (id, owner) in [("owner-a", "a"), ("owner-b", "b")] {
            let mut image = create_image_record(id, 100, 10, "{}");
            image.path = format!("C:/Invoke/outputs/images/{id}.png");
            image.invoke_image_name = Some(format!("{id}.png"));
            image.invoke_owner_id = Some(owner.to_string());
            super::save_images_batch_inner(&conn, &[image]).expect("insert Invoke row");
        }
        let mut outside = create_image_record("outside", 100, 10, "{}");
        outside.path = "C:/Other/outputs/images/outside.png".to_string();
        outside.invoke_image_name = Some("outside.png".to_string());
        outside.invoke_owner_id = Some("b".to_string());
        super::save_images_batch_inner(&conn, &[outside]).expect("insert outside row");
        conn.execute(
            "INSERT INTO removed_images (
                id, path, timestamp, metadata_json, removed_at,
                invoke_image_name, invoke_owner_id
             ) VALUES (
                'removed-a', 'C:/Invoke/outputs/images/removed-a.png', 100, '{}', 200,
                'removed-a.png', 'a'
             )",
            [],
        )
        .expect("insert removed row");
        conn.execute(
            "INSERT INTO invoke_scope_cache_state (
                scope_key, db_path, images_root, scope_mode, owner_id,
                status, generation, built_generation, updated_at
             ) VALUES ('old-ready', 'C:/Old/invokeai.db', 'C:/Old', 'all', NULL,
                       'ready', 0, 0, 1)",
            [],
        )
        .expect("insert previously prepared source cache");

        let owner_result = super::refresh_invoke_owner_scope_inner(
            &conn,
            &super::InvokeOwnerScopeInput {
                db_path: "C:/Invoke/databases/invokeai.db".to_string(),
                images_root: "c:/invoke".to_string(),
                mode: super::InvokeOwnerScopeMode::Owner,
                owner_id: Some("a".to_string()),
                force_refresh: false,
            },
        )
        .expect("apply owner scope");
        assert!(owner_result.changed);
        assert_eq!(owner_result.active_updated, 0);
        let old_cache: (String, i64) = conn
            .query_row(
                "SELECT status, generation FROM invoke_scope_cache_state
                 WHERE scope_key = 'old-ready'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("old cache state");
        assert_eq!(
            old_cache,
            ("dirty".to_string(), 1),
            "source classification must invalidate projections that previously treated rows as local"
        );

        let active: Vec<String> = conn
            .prepare("SELECT id FROM scoped_images ORDER BY id")
            .expect("prepare active visibility")
            .query_map([], |row| row.get(0))
            .expect("query active visibility")
            .collect::<Result<_, _>>()
            .expect("collect active visibility");
        assert_eq!(active, vec!["outside".to_string(), "owner-a".to_string()]);
        let removed_visible: i64 = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM scoped_removed_images WHERE id = 'removed-a')",
                [],
                |row| row.get(0),
            )
            .expect("removed visibility");
        assert_eq!(removed_visible, 1);

        conn.execute(
            "UPDATE images SET invoke_scope_hidden = 0 WHERE id = 'owner-b'",
            [],
        )
        .expect("introduce visibility drift");
        let no_op_result = super::refresh_invoke_owner_scope_inner(
            &conn,
            &super::InvokeOwnerScopeInput {
                db_path: "C:/Invoke/databases/invokeai.db".to_string(),
                images_root: "c:/invoke".to_string(),
                mode: super::InvokeOwnerScopeMode::Owner,
                owner_id: Some("a".to_string()),
                force_refresh: false,
            },
        )
        .expect("validate unchanged owner scope");
        assert_eq!(
            no_op_result,
            super::InvokeOwnerScopeRefreshResult::default()
        );
        let drifted_visibility: i64 = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM scoped_images WHERE id = 'owner-b')",
                [],
                |row| row.get(0),
            )
            .expect("drifted visibility");
        assert_eq!(
            drifted_visibility, 0,
            "logical scope must ignore drift in the retired compatibility column"
        );

        let forced_result = super::refresh_invoke_owner_scope_inner(
            &conn,
            &super::InvokeOwnerScopeInput {
                db_path: "C:/Invoke/databases/invokeai.db".to_string(),
                images_root: "c:/invoke".to_string(),
                mode: super::InvokeOwnerScopeMode::Owner,
                owner_id: Some("a".to_string()),
                force_refresh: true,
            },
        )
        .expect("force owner visibility repair");
        assert_eq!(forced_result.active_updated, 0);

        let mut generic_late = create_image_record("generic-late", 101, 10, "{}");
        generic_late.path = "C:/Invoke/outputs/images/generic-late.png".to_string();
        let mut owner_late = create_image_record("owner-late", 102, 10, "{}");
        owner_late.path = "C:/Invoke/outputs/images/owner-late.png".to_string();
        owner_late.invoke_image_name = Some("owner-late.png".to_string());
        owner_late.invoke_owner_id = Some("a".to_string());
        super::save_images_batch_inner(&conn, &[generic_late, owner_late])
            .expect("insert rows while owner scope is active");
        let late_visibility: Vec<String> = conn
            .prepare(
                "SELECT id FROM scoped_images
                 WHERE id IN ('generic-late', 'owner-late') ORDER BY id",
            )
            .expect("prepare late visibility")
            .query_map([], |row| row.get(0))
            .expect("query late visibility")
            .collect::<Result<_, _>>()
            .expect("collect late visibility");
        assert_eq!(
            late_visibility,
            vec!["owner-late".to_string()],
            "generic rescans must fail closed while authoritative owner imports may match"
        );

        let stale_result = super::refresh_invoke_owner_scope_inner(
            &conn,
            &super::InvokeOwnerScopeInput {
                db_path: "C:/Invoke/databases/invokeai.db".to_string(),
                images_root: "C:/Invoke".to_string(),
                mode: super::InvokeOwnerScopeMode::Owner,
                owner_id: Some("stale".to_string()),
                force_refresh: false,
            },
        )
        .expect("apply stale owner scope");
        assert_eq!(stale_result.active_updated, 0);
        let visible_in_root: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_images
                 WHERE path LIKE 'C:/Invoke/outputs/images/%'",
                [],
                |row| row.get(0),
            )
            .expect("visible owner rows");
        assert_eq!(visible_in_root, 0);

        let all_result = super::refresh_invoke_owner_scope_inner(
            &conn,
            &super::InvokeOwnerScopeInput {
                db_path: "C:/Invoke/databases/invokeai.db".to_string(),
                images_root: "C:/Invoke".to_string(),
                mode: super::InvokeOwnerScopeMode::All,
                owner_id: None,
                force_refresh: false,
            },
        )
        .expect("apply all-owner scope");
        assert_eq!(all_result.active_updated, 0);
        assert_eq!(all_result.removed_updated, 0);
        let total_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
            .expect("active row count");
        assert_eq!(total_rows, 5, "scope changes must never delete stored rows");
        let visible_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM scoped_images", [], |row| row.get(0))
            .expect("visible active row count");
        assert_eq!(visible_rows, 5);
    }

    #[test]
    fn prepared_owner_scope_restores_isolated_facet_and_collection_caches() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        for (id, owner) in [("owner-a", "a"), ("owner-b", "b")] {
            let mut image = create_image_record(id, 100, 10, "{}");
            image.path = format!("C:/Invoke/outputs/images/{id}.png");
            image.invoke_image_name = Some(format!("{id}.png"));
            image.invoke_owner_id = Some(owner.to_string());
            super::save_images_batch_inner(&conn, &[image]).expect("insert owner row");
        }
        conn.execute(
            "INSERT INTO collections (id, name, created_at, source)
             VALUES ('shared', 'Shared', 1, 'ambit')",
            [],
        )
        .expect("insert collection");

        let scope = |owner: &str| super::InvokeOwnerScopeInput {
            db_path: "C:/Invoke/databases/invokeai.db".to_string(),
            images_root: "C:/Invoke".to_string(),
            mode: super::InvokeOwnerScopeMode::Owner,
            owner_id: Some(owner.to_string()),
            force_refresh: false,
        };

        let first_a = super::refresh_invoke_owner_scope_inner(&conn, &scope("a"))
            .expect("activate cold owner a");
        assert_eq!(
            first_a.cache_status.state,
            super::FacetScopeCacheState::Missing
        );
        let claim_a =
            super::begin_active_scope_cache_build_inner(&conn).expect("begin owner a cache");
        conn.execute("DELETE FROM facet_cache", []).unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'Owner A', 11)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE collections SET dynamic_count = 11 WHERE id = 'shared'",
            [],
        )
        .unwrap();
        super::commit_active_scope_cache_inner(&conn, &claim_a.ticket())
            .expect("commit owner a cache");

        let first_b = super::refresh_invoke_owner_scope_inner(&conn, &scope("b"))
            .expect("activate cold owner b");
        assert_eq!(
            first_b.cache_repair.action,
            super::InvokeScopeCacheAction::Full
        );
        let claim_b =
            super::begin_active_scope_cache_build_inner(&conn).expect("begin owner b cache");
        conn.execute("DELETE FROM facet_cache", []).unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'Owner B', 22)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE collections SET dynamic_count = 22 WHERE id = 'shared'",
            [],
        )
        .unwrap();
        super::commit_active_scope_cache_inner(&conn, &claim_b.ticket())
            .expect("commit owner b cache");

        let warm_a = super::refresh_invoke_owner_scope_inner(&conn, &scope("a"))
            .expect("restore owner a cache");
        assert_eq!(
            warm_a.cache_repair.action,
            super::InvokeScopeCacheAction::Restored
        );
        assert_eq!(
            warm_a.cache_status.state,
            super::FacetScopeCacheState::Ready
        );
        let restored_facet: (String, i64) = conn
            .query_row(
                "SELECT resource_name, count FROM facet_cache WHERE facet_type = 'tools'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(restored_facet, ("Owner A".into(), 11));
        let restored_count: i64 = conn
            .query_row(
                "SELECT dynamic_count FROM collections WHERE id = 'shared'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restored_count, 11);

        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('owner-a', 'NewDetailer')",
            [],
        )
        .expect("mutate one owner-a resource");
        let selective_a = super::refresh_invoke_owner_scope_inner(&conn, &scope("a"))
            .expect("restore owner a for selective repair");
        assert_eq!(
            selective_a.cache_repair.action,
            super::InvokeScopeCacheAction::Selective
        );
        assert_eq!(
            selective_a.cache_repair.resources.loras,
            vec!["NewDetailer".to_string()]
        );
        assert!(selective_a.cache_repair.facet_types.is_empty());
        assert!(!selective_a.cache_repair.collections_dirty);
        let stale_but_isolated_facet: (String, i64) = conn
            .query_row(
                "SELECT resource_name, count FROM facet_cache WHERE facet_type = 'tools'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(stale_but_isolated_facet, ("Owner A".into(), 11));

        let selective_claim = super::begin_active_scope_cache_build_inner(&conn)
            .expect("begin selective owner-a repair");
        assert_eq!(
            selective_claim.cache_repair.resources.loras,
            vec!["NewDetailer".to_string()],
            "dirty reasons added before the claim must be part of the claimed plan"
        );
        let touches = crate::db::facets::FacetResourceTouches {
            loras: vec!["NewDetailer".to_string()],
            ..Default::default()
        };
        crate::db::facets::refresh_live_facet_resources_in_transaction(&conn, &touches)
            .expect("repair exact owner-a resource");
        let committed_a = super::commit_active_scope_cache_inner(&conn, &selective_claim.ticket())
            .expect("commit selective owner-a repair");
        assert_eq!(committed_a.state, super::FacetScopeCacheState::Ready);
        assert_eq!(committed_a.generation, selective_claim.generation);
        assert_eq!(
            committed_a.built_generation,
            Some(selective_claim.generation)
        );
        let owner_a_dirty_items: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items
                 WHERE scope_key = ?1",
                [super::invoke_scope_cache_key(
                    "C:/Invoke/databases/invokeai.db",
                    super::InvokeOwnerScopeMode::Owner,
                    Some("a"),
                )],
                |row| row.get(0),
            )
            .expect("owner-a dirty ledger count");
        assert_eq!(owner_a_dirty_items, 0);

        let shared_model_dirty_b = super::refresh_invoke_owner_scope_inner(&conn, &scope("b"))
            .expect("activate owner b after shared model inventory changed");
        assert_eq!(
            shared_model_dirty_b.cache_repair.action,
            super::InvokeScopeCacheAction::Selective
        );
        assert_eq!(
            shared_model_dirty_b.cache_repair.resources.loras,
            vec!["NewDetailer".to_string()]
        );
    }

    #[cfg(windows)]
    #[test]
    fn owner_scope_reuses_cache_when_windows_path_casing_changes() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let old_db_path = "c:/invoke/databases/invokeai.db";
        let old_scope_key = format!("{old_db_path}\u{1f}owner\u{1f}owner-a");

        let mut image = create_image_record("owner-a-image", 100, 10, "{}");
        image.path = "C:/Invoke/outputs/images/owner-a-image.png".to_string();
        image.invoke_image_name = Some("owner-a-image.png".to_string());
        image.invoke_owner_id = Some("owner-a".to_string());
        super::save_images_batch_inner(&conn, &[image]).expect("insert owner image");
        conn.execute(
            "UPDATE images SET invoke_source_id = ?1 WHERE id = 'owner-a-image'",
            [old_db_path],
        )
        .expect("seed source identity");
        conn.execute(
            "INSERT INTO invoke_owner_scope_state (
                 state_key, db_path, images_root, scope_mode, owner_id, updated_at
             ) VALUES ('current', ?1, 'C:/Invoke', 'owner', 'owner-a', 1)",
            [old_db_path],
        )
        .expect("seed previous owner scope");
        conn.execute(
            "INSERT INTO invoke_scope_cache_state (
                 scope_key, db_path, images_root, scope_mode, owner_id,
                 status, generation, built_generation, updated_at
             ) VALUES (?1, ?2, 'C:/Invoke', 'owner', 'owner-a', 'ready', 3, 3, 1)",
            params![old_scope_key, old_db_path],
        )
        .expect("seed prepared mixed-case cache");
        conn.execute(
            "INSERT INTO invoke_scope_facet_cache (
                 scope_key, facet_type, resource_name, count
             ) VALUES (?1, 'tools', 'Cached Tool', 1)",
            [&old_scope_key],
        )
        .expect("seed prepared facet");
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, count)
             VALUES ('tools', 'Cached Tool', 1)",
            [],
        )
        .expect("seed active facet projection");
        conn.execute(
            "UPDATE invoke_scope_cache_control
             SET active_scope_key = ?1 WHERE state_key = 'current'",
            [&old_scope_key],
        )
        .expect("activate mixed-case cache");

        let result = super::refresh_invoke_owner_scope_inner(
            &conn,
            &super::InvokeOwnerScopeInput {
                db_path: "C:/Invoke/databases/invokeai.db".to_string(),
                images_root: "C:/Invoke".to_string(),
                mode: super::InvokeOwnerScopeMode::Owner,
                owner_id: Some("owner-a".to_string()),
                force_refresh: false,
            },
        )
        .expect("reuse mixed-case Windows cache");

        assert_eq!(
            result.cache_repair.action,
            super::InvokeScopeCacheAction::Restored
        );
        assert_eq!(
            result.cache_status.state,
            super::FacetScopeCacheState::Ready
        );
        let canonical_db_path = "C:/Invoke/databases/invokeai.db";
        let canonical_scope_key = format!("{canonical_db_path}\u{1f}owner\u{1f}owner-a");
        let state: (String, String, String) = conn
            .query_row(
                "SELECT scope_key, db_path, images_root
                 FROM invoke_scope_cache_state WHERE scope_key = ?1",
                [&canonical_scope_key],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("canonical cache state");
        assert_eq!(
            state,
            (
                canonical_scope_key.clone(),
                canonical_db_path.to_string(),
                "C:/Invoke".to_string()
            )
        );
        let old_state_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_state WHERE scope_key = ?1",
                [&old_scope_key],
                |row| row.get(0),
            )
            .expect("old cache count");
        assert_eq!(old_state_count, 0);
        let source_id: String = conn
            .query_row(
                "SELECT invoke_source_id FROM images WHERE id = 'owner-a-image'",
                [],
                |row| row.get(0),
            )
            .expect("canonical image source");
        assert_eq!(source_id, canonical_db_path);

        let mut newly_synced = create_image_record("new-owner-a-image", 101, 10, "{}");
        newly_synced.path = "C:/Invoke/outputs/images/new-owner-a-image.png".to_string();
        newly_synced.invoke_image_name = Some("new-owner-a-image.png".to_string());
        newly_synced.invoke_owner_id = Some("owner-a".to_string());
        super::save_images_batch_inner(&conn, &[newly_synced])
            .expect("insert using configured path casing");
        conn.execute(
            "UPDATE images SET invoke_source_id = ?1 WHERE id = 'new-owner-a-image'",
            [canonical_db_path],
        )
        .expect("assign configured source identity");
        let visible_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_images
                 WHERE id = 'new-owner-a-image'",
                [],
                |row| row.get(0),
            )
            .expect("visible newly synced image");
        assert_eq!(visible_count, 1);
    }

    #[cfg(windows)]
    #[test]
    fn owner_scope_marks_conflicting_windows_path_aliases_dirty() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let canonical_db_path = "C:/Invoke/databases/invokeai.db";
        let alias_db_path = "c:/invoke/databases/invokeai.db";
        let canonical_key = format!("{canonical_db_path}\u{1f}owner\u{1f}owner-a");
        let alias_key = format!("{alias_db_path}\u{1f}owner\u{1f}owner-a");
        for (key, path, updated_at) in [
            (&canonical_key, canonical_db_path, 1),
            (&alias_key, alias_db_path, 2),
        ] {
            conn.execute(
                "INSERT INTO invoke_scope_cache_state (
                     scope_key, db_path, images_root, scope_mode, owner_id,
                     status, generation, built_generation, updated_at
                 ) VALUES (?1, ?2, 'C:/Invoke', 'owner', 'owner-a', 'ready', 3, 3, ?3)",
                params![key, path, updated_at],
            )
            .expect("seed conflicting cache identity");
            conn.execute(
                "INSERT INTO invoke_scope_facet_cache (
                     scope_key, facet_type, resource_name, count
                 ) VALUES (?1, 'tools', ?2, 1)",
                params![key, path],
            )
            .expect("seed conflicting facet");
        }
        conn.execute(
            "UPDATE invoke_scope_cache_control SET active_scope_key = ?1 WHERE state_key = 'current'",
            [&alias_key],
        )
        .expect("activate alias cache");

        let tx = conn.unchecked_transaction().expect("identity transaction");
        super::canonicalize_windows_invoke_identity(&tx, canonical_db_path, "C:/Invoke")
            .expect("canonicalize conflicting aliases");
        tx.commit().expect("commit canonical identity");

        let status =
            super::read_scope_cache_status(&conn, &canonical_key).expect("canonical cache status");
        assert_eq!(status.state, super::FacetScopeCacheState::Dirty);
        let cached_facets: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_facet_cache WHERE scope_key = ?1",
                [&canonical_key],
                |row| row.get(0),
            )
            .expect("canonical facet count");
        assert_eq!(cached_facets, 0);
        let full_dirty: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items
                 WHERE scope_key = ?1 AND domain = 'full'",
                [&canonical_key],
                |row| row.get(0),
            )
            .expect("full dirty marker");
        assert_eq!(full_dirty, 1);
    }

    #[test]
    fn scope_cache_abort_releases_exact_build_for_retry_and_retains_dirty_ledger() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let input = super::InvokeOwnerScopeInput {
            db_path: "C:/Invoke/databases/invokeai.db".to_string(),
            images_root: "C:/Invoke".to_string(),
            mode: super::InvokeOwnerScopeMode::Owner,
            owner_id: Some("a".to_string()),
            force_refresh: false,
        };
        super::refresh_invoke_owner_scope_inner(&conn, &input).expect("activate owner");
        let claim = super::begin_active_scope_cache_build_inner(&conn).expect("begin cache build");
        conn.execute(
            "INSERT OR IGNORE INTO invoke_scope_cache_dirty_items
             (scope_key, domain, facet_type, resource_name)
             VALUES (?1, 'full', '', '')",
            [&claim.scope_key],
        )
        .expect("seed dirty reason");

        let aborted = super::abort_active_scope_cache_build_inner(&conn, &claim.ticket())
            .expect("abort cache build");
        assert_eq!(aborted.state, super::FacetScopeCacheState::Dirty);
        let retained: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE scope_key = ?1",
                [&claim.scope_key],
                |row| row.get(0),
            )
            .expect("retained dirty reasons");
        assert_eq!(retained, 1);

        let retry =
            super::begin_active_scope_cache_build_inner(&conn).expect("retry released cache build");
        assert_eq!(retry.scope_key, claim.scope_key);
        assert_eq!(retry.generation, claim.generation);
        assert_eq!(
            retry.cache_status.state,
            super::FacetScopeCacheState::Building
        );
    }

    #[test]
    fn scope_cache_claim_reclaims_a_prior_session_build_after_restart() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let db_path = std::env::temp_dir().join(format!(
            "ambit-scope-claim-restart-{}-{unique}.db",
            std::process::id()
        ));
        let (scope_key, generation) = {
            let conn = Connection::open(&db_path).expect("open first session db");
            apply_all_migrations(&conn);
            let input = super::InvokeOwnerScopeInput {
                db_path: "C:/Invoke/databases/invokeai.db".to_string(),
                images_root: "C:/Invoke".to_string(),
                mode: super::InvokeOwnerScopeMode::Owner,
                owner_id: Some("a".to_string()),
                force_refresh: false,
            };
            super::refresh_invoke_owner_scope_inner(&conn, &input).expect("activate owner");
            let claim = super::begin_active_scope_cache_build_for_session_inner(
                &conn,
                "session-before-restart",
            )
            .expect("claim before restart");
            conn.execute(
                "INSERT INTO invoke_scope_cache_dirty_items
                 (scope_key, domain, facet_type, resource_name)
                 VALUES (?1, 'full', '', '')",
                [&claim.scope_key],
            )
            .expect("record invalidation during abandoned build");
            let duplicate = super::begin_active_scope_cache_build_for_session_inner(
                &conn,
                "session-before-restart",
            )
            .expect_err("same session must not steal an active claim");
            assert!(duplicate.contains("changed before its repair could be claimed"));
            (claim.scope_key, claim.generation)
        };

        {
            let conn = Connection::open(&db_path).expect("reopen db after restart");
            let reclaimed = super::begin_active_scope_cache_build_for_session_inner(
                &conn,
                "session-after-restart",
            )
            .expect("reclaim prior-session build");
            assert_eq!(reclaimed.scope_key, scope_key);
            assert_eq!(reclaimed.generation, generation);
            assert_eq!(
                reclaimed.cache_status.state,
                super::FacetScopeCacheState::Building
            );
            let build_session_id: String = conn
                .query_row(
                    "SELECT build_session_id FROM invoke_scope_cache_state WHERE scope_key = ?1",
                    [&scope_key],
                    |row| row.get(0),
                )
                .expect("reclaimed build session");
            assert_eq!(build_session_id, "session-after-restart");
            let retained: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE scope_key = ?1",
                    [&scope_key],
                    |row| row.get(0),
                )
                .expect("retained repair ledger");
            assert!(retained > 0);
            super::abort_active_scope_cache_build_for_session_inner(
                &conn,
                &reclaimed.ticket(),
                "session-after-restart",
            )
            .expect("release reclaimed build");
        }
        std::fs::remove_file(&db_path).expect("remove restart fixture db");
    }

    #[test]
    fn owner_scope_activation_preserves_only_matching_board_verification() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let owner_a = super::InvokeOwnerScopeInput {
            db_path: "C:/Invoke/databases/invokeai.db".to_string(),
            images_root: "C:/Invoke".to_string(),
            mode: super::InvokeOwnerScopeMode::Owner,
            owner_id: Some("a".to_string()),
            force_refresh: false,
        };

        super::refresh_invoke_owner_scope_inner(&conn, &owner_a).expect("activate owner A");
        conn.execute(
            "UPDATE invoke_owner_scope_state SET boards_verified = 1 WHERE state_key = 'current'",
            [],
        )
        .expect("verify owner A boards");
        super::refresh_invoke_owner_scope_inner(&conn, &owner_a).expect("reactivate owner A");
        let same_owner_verified: i64 = conn
            .query_row(
                "SELECT boards_verified FROM invoke_owner_scope_state WHERE state_key = 'current'",
                [],
                |row| row.get(0),
            )
            .expect("same-owner verification");
        assert_eq!(same_owner_verified, 1);

        let mut owner_b = owner_a.clone();
        owner_b.owner_id = Some("b".to_string());
        super::refresh_invoke_owner_scope_inner(&conn, &owner_b).expect("activate owner B");
        let changed_owner_verified: i64 = conn
            .query_row(
                "SELECT boards_verified FROM invoke_owner_scope_state WHERE state_key = 'current'",
                [],
                |row| row.get(0),
            )
            .expect("changed-owner verification");
        assert_eq!(changed_owner_verified, 0);

        let mut all_users = owner_a;
        all_users.mode = super::InvokeOwnerScopeMode::All;
        all_users.owner_id = None;
        super::refresh_invoke_owner_scope_inner(&conn, &all_users).expect("activate All users");
        let all_users_verified: i64 = conn
            .query_row(
                "SELECT boards_verified FROM invoke_owner_scope_state WHERE state_key = 'current'",
                [],
                |row| row.get(0),
            )
            .expect("All users verification");
        assert_eq!(all_users_verified, 1);
    }

    #[test]
    fn scope_cache_commit_rejects_content_changes_during_build() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let input = super::InvokeOwnerScopeInput {
            db_path: "C:/Invoke/databases/invokeai.db".to_string(),
            images_root: "C:/Invoke".to_string(),
            mode: super::InvokeOwnerScopeMode::Owner,
            owner_id: Some("a".to_string()),
            force_refresh: false,
        };
        super::refresh_invoke_owner_scope_inner(&conn, &input).expect("activate owner");
        let claim = super::begin_active_scope_cache_build_inner(&conn).expect("begin cache build");

        let mut image = create_image_record("late", 100, 10, "{}");
        image.path = "C:/Invoke/outputs/images/late.png".to_string();
        image.invoke_image_name = Some("late.png".to_string());
        image.invoke_owner_id = Some("a".to_string());
        super::save_images_batch_inner(&conn, &[image]).expect("mutate active scope");

        let error = super::commit_active_scope_cache_inner(&conn, &claim.ticket())
            .expect_err("dirty build must not be promoted");
        assert!(error.contains("changed while it was being prepared"));
        let status = super::read_scope_cache_status(
            &conn,
            &super::invoke_scope_cache_key(
                &super::normalize_invoke_root(&input.db_path),
                super::InvokeOwnerScopeMode::Owner,
                Some("a"),
            ),
        )
        .expect("cache status");
        assert_eq!(status.state, super::FacetScopeCacheState::Dirty);
        assert!(status.generation > claim.generation);
        let retained_dirty_reasons: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE scope_key = ?1",
                [&claim.scope_key],
                |row| row.get(0),
            )
            .expect("retained dirty ledger");
        assert!(
            retained_dirty_reasons > 0,
            "a rejected commit must retain dirty reasons"
        );
    }

    #[test]
    fn scope_cache_commit_rejects_external_model_changes_during_build() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        let input = super::InvokeOwnerScopeInput {
            db_path: "C:/Invoke/databases/invokeai.db".to_string(),
            images_root: "C:/Invoke".to_string(),
            mode: super::InvokeOwnerScopeMode::Owner,
            owner_id: Some("a".to_string()),
            force_refresh: false,
        };
        super::refresh_invoke_owner_scope_inner(&conn, &input).expect("activate owner");
        let claim = super::begin_active_scope_cache_build_inner(&conn).expect("begin cache build");

        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type)
             VALUES ('external-model', 'External Model', 'disk_scan', 1, 'checkpoint')",
            [],
        )
        .expect("mutate shared model inventory");

        let error = super::commit_active_scope_cache_inner(&conn, &claim.ticket())
            .expect_err("a model mutation must invalidate the active build");
        assert!(error.contains("changed while it was being prepared"));
        let status = super::read_scope_cache_status(
            &conn,
            &super::invoke_scope_cache_key(
                &super::normalize_invoke_root(&input.db_path),
                super::InvokeOwnerScopeMode::Owner,
                Some("a"),
            ),
        )
        .expect("cache status");
        assert_eq!(status.state, super::FacetScopeCacheState::Dirty);
    }

    #[test]
    fn replace_invoke_references_is_atomic_exact_and_resolution_safe() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let mut source = create_image_record("source", 100, 200, r#"{"tool":"InvokeAI"}"#);
        source.invoke_image_name = Some("source.png".to_string());
        let mut target = create_image_record("target-a", 101, 200, r#"{"tool":"InvokeAI"}"#);
        target.invoke_image_name = Some("Target.PNG".to_string());
        super::save_images_batch_inner(&conn, &[source, target]).expect("insert source and target");

        let reference = super::InvokeImageReferenceInput {
            role: super::InvokeImageReferenceRole::ControlnetImage,
            target_invoke_image_name: "Target.PNG".to_string(),
        };
        let result = super::replace_invoke_image_references_inner(
            &conn,
            &[super::InvokeImageReferenceSet {
                source_image_id: "source".to_string(),
                references: vec![reference.clone(), reference],
            }],
        )
        .expect("replace references");
        assert_eq!(result.sources_replaced, 1);
        assert_eq!(result.references_written, 1);
        assert_eq!(result.skipped_missing_sources, 0);

        let stored: (String, String, String, Option<String>) = conn
            .query_row(
                "SELECT source_image_id, role, target_invoke_image_name, target_image_id
                 FROM invoke_image_references",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("stored reference");
        assert_eq!(
            stored,
            (
                "source".to_string(),
                "controlnet_image".to_string(),
                "Target.PNG".to_string(),
                Some("target-a".to_string()),
            )
        );

        let blank = super::replace_invoke_image_references_inner(
            &conn,
            &[super::InvokeImageReferenceSet {
                source_image_id: "source".to_string(),
                references: vec![super::InvokeImageReferenceInput {
                    role: super::InvokeImageReferenceRole::InitImage,
                    target_invoke_image_name: "   ".to_string(),
                }],
            }],
        );
        assert!(blank.is_err());
        let preserved_after_rollback: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoke_image_references", [], |row| {
                row.get(0)
            })
            .expect("reference preserved after rollback");
        assert_eq!(preserved_after_rollback, 1);

        let mut duplicate = create_image_record("target-b", 102, 200, r#"{"tool":"InvokeAI"}"#);
        duplicate.invoke_image_name = Some("Target.PNG".to_string());
        super::save_images_batch_inner(&conn, &[duplicate]).expect("insert ambiguous target");
        let ambiguous: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("ambiguous target");
        assert_eq!(ambiguous, None);

        conn.execute("DELETE FROM images WHERE id = 'target-b'", [])
            .expect("delete duplicate target");
        let resolved_again: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("resolved target");
        assert_eq!(resolved_again.as_deref(), Some("target-a"));

        let cleared = super::replace_invoke_image_references_inner(
            &conn,
            &[
                super::InvokeImageReferenceSet {
                    source_image_id: "missing".to_string(),
                    references: vec![],
                },
                super::InvokeImageReferenceSet {
                    source_image_id: "source".to_string(),
                    references: vec![],
                },
            ],
        )
        .expect("clear references");
        assert_eq!(cleared.sources_replaced, 1);
        assert_eq!(cleared.references_written, 0);
        assert_eq!(cleared.skipped_missing_sources, 1);
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoke_image_references", [], |row| {
                row.get(0)
            })
            .expect("cleared references");
        assert_eq!(remaining, 0);
    }

    #[test]
    fn upsert_updates_live_sync_controlled_fields_even_when_metadata_is_unchanged() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                metadata_json TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                is_favorite INTEGER,
                is_pinned INTEGER,
                board_id TEXT,
                original_metadata_json TEXT
            );
            ",
        )
        .expect("schema");

        let upsert_sql = "
            INSERT INTO images (id, metadata_json, timestamp, file_size, is_favorite, is_pinned, board_id, original_metadata_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                metadata_json = excluded.metadata_json,
                timestamp = excluded.timestamp,
                file_size = excluded.file_size,
                is_favorite = excluded.is_favorite,
                is_pinned = excluded.is_pinned,
                board_id = excluded.board_id,
                original_metadata_json = excluded.original_metadata_json
            WHERE images.metadata_json != excluded.metadata_json
                OR images.timestamp != excluded.timestamp
                OR images.file_size != excluded.file_size
                OR images.is_favorite IS NOT excluded.is_favorite
                OR images.is_pinned IS NOT excluded.is_pinned
                OR images.board_id IS NOT excluded.board_id
                OR images.original_metadata_json IS NULL
                OR images.original_metadata_json != excluded.original_metadata_json
        ";

        conn.execute(
            upsert_sql,
            params![
                "img-1",
                "{}",
                123_i64,
                456_i64,
                0_i64,
                0_i64,
                Option::<String>::None,
                "{}"
            ],
        )
        .expect("initial insert");

        conn.execute(
            upsert_sql,
            params![
                "img-1",
                "{}",
                123_i64,
                456_i64,
                1_i64,
                1_i64,
                Some("board-1"),
                "{}"
            ],
        )
        .expect("conflict update");

        let updated = conn
            .query_row(
                "SELECT is_favorite, is_pinned, board_id FROM images WHERE id = ?1",
                ["img-1"],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("fetch row");

        assert_eq!(updated.0, 1);
        assert_eq!(updated.1, 1);
        assert_eq!(updated.2.as_deref(), Some("board-1"));
    }

    #[test]
    fn refresh_privacy_mask_index_respects_manual_overrides() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                positive_prompt TEXT,
                user_masked INTEGER,
                privacy_hidden INTEGER NOT NULL DEFAULT 0
            ) STRICT;

            INSERT INTO images(id, positive_prompt, user_masked) VALUES
                ('auto-match', 'a secret landscape', NULL),
                ('manual-hidden', 'a public landscape', 1),
                ('manual-visible', 'a secret portrait', 0),
                ('auto-visible', 'a public portrait', NULL);
            ",
        )
        .expect("schema");

        let result = super::refresh_privacy_mask_index_for_conn(
            &conn,
            &["Secret".to_string(), "secret".to_string()],
        )
        .expect("refresh privacy index");

        assert!(result.changed);
        assert_eq!(result.updated, 2);

        let rows = conn
            .prepare("SELECT id, privacy_hidden FROM images ORDER BY id")
            .expect("prepare")
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows");

        assert_eq!(
            rows,
            vec![
                ("auto-match".to_string(), 1),
                ("auto-visible".to_string(), 0),
                ("manual-hidden".to_string(), 1),
                ("manual-visible".to_string(), 0),
            ]
        );

        let second = super::refresh_privacy_mask_index_for_conn(&conn, &["secret".to_string()])
            .expect("second refresh");

        assert!(!second.changed);
        assert_eq!(second.updated, 0);
    }

    #[test]
    fn save_images_batch_resets_stale_ambit_source_when_external_thumbnail_replaces_path() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let initial = create_image_record("img-source", 100, 200, "{}");
        super::save_images_batch_inner(&conn, &[initial]).expect("initial save");

        let mut external = create_image_record("img-source", 101, 201, "{}");
        external.thumbnail_path = "C:/invoke/img-source.webp".to_string();
        external.thumbnail_source = None;

        super::save_images_batch_inner(&conn, &[external]).expect("external update");

        let row = fetch_thumbnail_state(&conn, "img-source");
        assert_eq!(row.0, "C:/invoke/img-source.webp");
        assert_eq!(row.1, None);
        assert_eq!(row.2, 0);
    }

    #[test]
    fn save_images_batch_updates_invoke_source_without_generation_metadata_ownership() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let mut invoke_asset = create_image_record("invoke-source", 100, 200, "{}");
        invoke_asset.invoke_image_name = Some("source.png".to_string());
        invoke_asset.invoke_image_category = Some("control".to_string());
        invoke_asset.invoke_image_origin = Some("internal".to_string());
        super::save_images_batch_inner(&conn, &[invoke_asset]).expect("initial source save");

        let generic_rescan = create_image_record(
            "invoke-source",
            101,
            201,
            r#"{"positivePrompt":"user edited"}"#,
        );
        super::save_images_batch_inner(&conn, &[generic_rescan]).expect("generic metadata rescan");

        let preserved: (String, String, String, Option<i64>, String) = conn
            .query_row(
                "SELECT invoke_image_name, invoke_image_category, invoke_image_origin,
                        is_invoke_asset_gen, metadata_json
                 FROM images WHERE id = 'invoke-source'",
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
            .expect("preserved source fields");
        assert_eq!(preserved.0, "source.png");
        assert_eq!(preserved.1, "control");
        assert_eq!(preserved.2, "internal");
        assert_eq!(preserved.3, Some(1));
        assert_eq!(preserved.4, r#"{"positivePrompt":"user edited"}"#);

        let mut unclassified = create_image_record(
            "invoke-source",
            101,
            201,
            r#"{"positivePrompt":"user edited"}"#,
        );
        unclassified.invoke_image_name = Some("source.png".to_string());
        super::save_images_batch_inner(&conn, &[unclassified])
            .expect("authoritative source clearing");

        let unclassified: (Option<String>, Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT invoke_image_category, invoke_image_origin, is_invoke_asset_gen
                 FROM images WHERE id = 'invoke-source'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("unclassified source fields");
        assert_eq!(unclassified, (None, None, None));

        let mut reclassified = create_image_record(
            "invoke-source",
            101,
            201,
            r#"{"positivePrompt":"user edited"}"#,
        );
        reclassified.invoke_image_name = Some("source.png".to_string());
        reclassified.invoke_image_category = Some("general".to_string());
        super::save_images_batch_inner(&conn, &[reclassified]).expect("source reclassification");

        let reclassified: (String, Option<i64>) = conn
            .query_row(
                "SELECT invoke_image_category, is_invoke_asset_gen
                 FROM images WHERE id = 'invoke-source'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("reclassified source fields");
        assert_eq!(reclassified, ("general".into(), Some(0)));
    }

    #[test]
    fn generic_rescan_does_not_reveal_an_unbound_legacy_owner_row() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let initial = create_image_record("legacy-owner", 100, 200, "{}");
        super::save_images_batch_inner(&conn, &[initial]).expect("initial save");
        conn.execute(
            "UPDATE images
             SET invoke_scope_hidden = 1, invoke_source_id = NULL
             WHERE id = 'legacy-owner'",
            [],
        )
        .expect("mark legacy owner row");

        let rescanned = create_image_record(
            "legacy-owner",
            101,
            201,
            r#"{"positivePrompt":"rescanned"}"#,
        );
        super::save_images_batch_inner(&conn, &[rescanned]).expect("generic rescan");

        let hidden: i64 = conn
            .query_row(
                "SELECT invoke_scope_hidden FROM images WHERE id = 'legacy-owner'",
                [],
                |row| row.get(0),
            )
            .expect("legacy visibility");
        assert_eq!(hidden, 1);
    }

    #[test]
    fn save_images_batch_preserves_thumbnail_source_when_path_is_unchanged() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let initial = create_image_record("img-same", 100, 200, "{}");
        let unchanged_path = initial.thumbnail_path.clone();
        super::save_images_batch_inner(&conn, &[initial]).expect("initial save");

        let mut update = create_image_record("img-same", 101, 201, "{}");
        update.thumbnail_path = unchanged_path;
        update.thumbnail_source = None;

        super::save_images_batch_inner(&conn, &[update]).expect("same path update");

        let row = fetch_thumbnail_state(&conn, "img-same");
        assert_eq!(row.1.as_deref(), Some("ambit"));
        assert_eq!(row.2, 1);
    }

    #[test]
    fn save_images_batch_marks_ambit_replacement_current_and_clears_failure_metadata() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let mut initial = create_image_record("img-fixed", 100, 200, "{}");
        initial.thumbnail_path = "C:/invoke/img-fixed.webp".to_string();
        initial.thumbnail_source = Some("invokeai".to_string());
        super::save_images_batch_inner(&conn, &[initial]).expect("initial external save");

        conn.execute(
            "UPDATE images
             SET thumbnail_version = 0,
                 thumbnail_failure_count = 2,
                 thumbnail_last_error = 'decode failed',
                 thumbnail_last_attempt_at = 42
             WHERE id = 'img-fixed'",
            [],
        )
        .expect("mark failure");

        let mut repaired = create_image_record("img-fixed", 101, 201, "{}");
        repaired.thumbnail_path = "C:/thumbs/img-fixed-repaired.webp".to_string();
        repaired.thumbnail_source = Some("ambit".to_string());

        super::save_images_batch_inner(&conn, &[repaired]).expect("ambit repair");

        let row = fetch_thumbnail_state(&conn, "img-fixed");
        assert_eq!(row.0, "C:/thumbs/img-fixed-repaired.webp");
        assert_eq!(row.1.as_deref(), Some("ambit"));
        assert_eq!(row.2, 1);
        assert_eq!(row.3, 0);
        assert_eq!(row.4, None);
        assert_eq!(row.5, None);
    }

    #[test]
    fn move_image_path_identities_moves_image_and_preserves_relationships() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let old_id = "D:/Invoke/outputs/images/old.png";
        let old_path = "D:/Invoke/outputs/images/legacy/old.png";
        let old_thumbnail_path = "D:/Invoke/outputs/images/thumbnails/old.webp";
        let new_id = "D:/Invoke/outputs/images/2026/05/old.png";
        let mut image = create_image_record(old_id, 100, 200, "{}");
        image.path = old_path.to_string();
        image.thumbnail_path = old_thumbnail_path.to_string();
        image.thumbnail_source = Some("invokeai".to_string());
        image.invoke_image_name = Some("old.png".to_string());
        image.invoke_image_category = Some("control".to_string());
        image.invoke_image_origin = Some("internal".to_string());
        super::save_images_batch_inner(&conn, &[image]).expect("initial save");

        conn.execute(
            "INSERT INTO collections (id, name, created_at, source) VALUES ('board-1', 'Board', 1, 'invoke')",
            [],
        )
        .expect("collection");
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id) VALUES ('board-1', ?1)",
            params![old_id],
        )
        .expect("collection image");
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES (?1, 'DetailBoost')",
            params![old_id],
        )
        .expect("lora");
        conn.execute(
            "INSERT INTO image_embeddings (image_id, embedding_name) VALUES (?1, 'EasyNegative')",
            params![old_id],
        )
        .expect("embedding");
        conn.execute(
            "INSERT INTO image_hypernetworks (image_id, hypernetwork_name) VALUES (?1, 'Hyper')",
            params![old_id],
        )
        .expect("hypernetwork");
        conn.execute(
            "INSERT INTO image_controlnets (image_id, controlnet_name) VALUES (?1, 'Depth')",
            params![old_id],
        )
        .expect("controlnet");
        conn.execute(
            "INSERT INTO image_ipadapters (image_id, ipadapter_name) VALUES (?1, 'Face')",
            params![old_id],
        )
        .expect("ipadapter");
        conn.execute(
            "INSERT INTO facet_cache (
                facet_type,
                resource_name,
                thumbnail_path,
                safe_thumbnail_path,
                thumbnail_image_id
             ) VALUES (
                'checkpoints',
                'Model A',
                ?1,
                ?2,
                ?3
             )",
            params![old_path, old_thumbnail_path, old_id],
        )
        .expect("facet cache");
        conn.execute(
            "UPDATE collections
             SET dynamic_thumbnail_path = ?1,
                 dynamic_safe_thumbnail_path = ?2,
                 dynamic_thumbnail_is_sensitive = 0,
                 dynamic_thumbnail_cached_at = 123
             WHERE id = 'board-1'",
            params![old_path, old_thumbnail_path],
        )
        .expect("collection thumbnail cache");
        for (hash, name, thumbnail_path) in [
            ("model-old-id", "Model Old Id", old_id),
            ("model-old-path", "Model Old Path", old_path),
            (
                "model-old-thumbnail",
                "Model Old Thumbnail",
                old_thumbnail_path,
            ),
        ] {
            conn.execute(
                "INSERT INTO models (
                    hash,
                    name,
                    lookup_source,
                    scanned_at,
                    thumbnail_path,
                    resource_type
                 ) VALUES (?1, ?2, 'manual_thumbnail', 1, ?3, 'checkpoint')",
                params![hash, name, thumbnail_path],
            )
            .expect("manual model thumbnail");
        }

        let result = super::move_image_path_identities_inner(
            &conn,
            &[super::ImagePathIdentityMove {
                old_id: old_id.to_string(),
                new_id: new_id.to_string(),
                thumbnail_path: Some(new_id.to_string()),
                thumbnail_source: None,
            }],
        )
        .expect("move paths");

        assert_eq!(result.moved, 1);
        assert_eq!(result.skipped_target_exists, 0);
        assert_eq!(result.skipped_source_missing, 0);

        let row = conn
            .query_row(
                "SELECT id, path, thumbnail_path, thumbnail_source, is_missing,
                        invoke_image_name, invoke_image_category, invoke_image_origin,
                        is_invoke_asset_gen
                 FROM images WHERE id = ?1",
                params![new_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, Option<i64>>(8)?,
                    ))
                },
            )
            .expect("moved image");
        assert_eq!(row.0, new_id);
        assert_eq!(row.1, new_id);
        assert_eq!(row.2, new_id);
        assert_eq!(row.3, None);
        assert_eq!(row.4, 0);
        assert_eq!(row.5, "old.png");
        assert_eq!(row.6, "control");
        assert_eq!(row.7, "internal");
        assert_eq!(row.8, Some(1));

        let relation_tables = [
            ("collection_images", "image_id"),
            ("image_loras", "image_id"),
            ("image_embeddings", "image_id"),
            ("image_hypernetworks", "image_id"),
            ("image_controlnets", "image_id"),
            ("image_ipadapters", "image_id"),
        ];
        for (table, column) in relation_tables {
            let count: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?1"),
                    params![new_id],
                    |row| row.get(0),
                )
                .expect("relation count");
            assert_eq!(count, 1, "{table} should point at moved image id");
        }

        let facet_row = conn
            .query_row(
                "SELECT thumbnail_path, safe_thumbnail_path, thumbnail_image_id
                 FROM facet_cache
                 WHERE facet_type = 'checkpoints' AND resource_name = 'Model A'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("facet cache row");
        assert_eq!(facet_row.0.as_deref(), Some(new_id));
        assert_eq!(facet_row.1.as_deref(), Some(new_id));
        assert_eq!(facet_row.2.as_deref(), Some(new_id));

        let collection_thumb_row = conn
            .query_row(
                "SELECT dynamic_thumbnail_path,
                        dynamic_safe_thumbnail_path,
                        dynamic_thumbnail_is_sensitive,
                        dynamic_thumbnail_cached_at
                 FROM collections
                 WHERE id = 'board-1'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .expect("collection thumbnail cache row");
        assert_eq!(collection_thumb_row.0.as_deref(), Some(new_id));
        assert_eq!(collection_thumb_row.1.as_deref(), Some(new_id));
        assert_eq!(collection_thumb_row.2, Some(0));
        assert_eq!(collection_thumb_row.3, Some(123));

        let repaired_model_thumbnails: i64 = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM models
                 WHERE hash IN ('model-old-id', 'model-old-path', 'model-old-thumbnail')
                   AND thumbnail_path = ?1",
                params![new_id],
                |row| row.get(0),
            )
            .expect("repaired model thumbnails");
        assert_eq!(
            repaired_model_thumbnails, 3,
            "manual model thumbnail sources should follow moved image identities"
        );
    }

    #[test]
    fn move_image_path_identities_matches_windows_verbatim_source_identity() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let stored_old_id = "//?/C:/library/old.webm";
        let watcher_old_id = "C:/library/old.webm";
        let watcher_new_id = "C:/library/renamed.webm";
        let stored_new_id = "//?/C:/library/renamed.webm";
        let old_thumbnail_path = "C:/thumbs/old.webp";
        let mut image = create_image_record(stored_old_id, 100, 200, "{}");
        image.path = stored_old_id.to_string();
        image.thumbnail_path = old_thumbnail_path.to_string();
        image.thumbnail_source = Some("ambit-video-v1".to_string());
        image.is_favorite = true;
        image.is_pinned = true;
        super::save_images_batch_inner(&conn, &[image]).expect("initial save");

        conn.execute(
            "INSERT INTO collections (id, name, created_at, source) VALUES ('favorites', 'Favorites', 1, 'manual')",
            [],
        )
        .expect("collection");
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id) VALUES ('favorites', ?1)",
            params![stored_old_id],
        )
        .expect("collection image");

        let result = super::move_image_path_identities_inner(
            &conn,
            &[super::ImagePathIdentityMove {
                old_id: watcher_old_id.to_string(),
                new_id: watcher_new_id.to_string(),
                thumbnail_path: None,
                thumbnail_source: None,
            }],
        )
        .expect("move verbatim identity");

        assert_eq!(result.moved, 1);
        assert_eq!(result.skipped_target_exists, 0);
        assert_eq!(result.skipped_source_missing, 0);

        let moved = conn
            .query_row(
                "SELECT path, is_favorite, is_pinned, thumbnail_path, thumbnail_source
                 FROM images WHERE id = ?1",
                params![stored_new_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .expect("moved verbatim row");
        assert_eq!(moved.0, stored_new_id);
        assert_eq!(moved.1, 1);
        assert_eq!(moved.2, 1);
        assert_eq!(moved.3, old_thumbnail_path);
        assert_eq!(moved.4.as_deref(), Some("ambit-video-v1"));

        let membership_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collection_images WHERE image_id = ?1",
                params![stored_new_id],
                |row| row.get(0),
            )
            .expect("moved collection membership");
        assert_eq!(membership_count, 1);
    }

    #[test]
    fn move_image_path_identities_does_not_double_prefix_verbatim_unc_target() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let old_id = "//?/UNC/server/library/old.webm";
        let new_id = "//?/UNC/server/library/renamed.webm";
        let mut image = create_image_record(old_id, 100, 200, "{}");
        image.path = old_id.to_string();
        super::save_images_batch_inner(&conn, &[image]).expect("initial save");

        let result = super::move_image_path_identities_inner(
            &conn,
            &[super::ImagePathIdentityMove {
                old_id: old_id.to_string(),
                new_id: new_id.to_string(),
                thumbnail_path: None,
                thumbnail_source: None,
            }],
        )
        .expect("move verbatim UNC identity");

        assert_eq!(result.moved, 1);
        let stored_path: String = conn
            .query_row(
                "SELECT path FROM images WHERE id = ?1",
                params![new_id],
                |row| row.get(0),
            )
            .expect("moved verbatim UNC row");
        assert_eq!(stored_path, new_id);
    }

    #[test]
    fn mark_image_path_identities_missing_matches_windows_verbatim_identity() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let stored_id = "//?/C:/library/removed.webm";
        let watcher_id = "C:/library/removed.webm";
        let mut image = create_image_record(stored_id, 100, 200, "{}");
        image.path = stored_id.to_string();
        image.is_favorite = true;
        image.is_pinned = true;
        super::save_images_batch_inner(&conn, &[image]).expect("initial save");

        let marked = super::mark_image_path_identities_missing_inner(
            &conn,
            &[watcher_id.to_string(), stored_id.to_string()],
        )
        .expect("mark missing through either identity form");

        assert_eq!(marked, 1, "equivalent identities must only update once");
        let state = conn
            .query_row(
                "SELECT is_missing, is_favorite, is_pinned FROM images WHERE id = ?1",
                params![stored_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("missing row");
        assert_eq!(state, (1, 1, 1));
    }

    #[test]
    fn move_image_path_identities_skips_existing_target() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let old_id = "D:/Invoke/outputs/images/old.png";
        let new_id = "D:/Invoke/outputs/images/2026/05/old.png";
        let old_thumbnail_path = "D:/Invoke/outputs/images/thumbnails/old.webp";
        let mut old_image = create_image_record(old_id, 100, 200, "{}");
        old_image.path = old_id.to_string();
        old_image.thumbnail_path = old_thumbnail_path.to_string();
        let mut new_image = create_image_record(new_id, 101, 201, "{}");
        new_image.path = new_id.to_string();
        super::save_images_batch_inner(&conn, &[old_image, new_image]).expect("initial save");
        conn.execute(
            "INSERT INTO facet_cache (
                facet_type,
                resource_name,
                thumbnail_path,
                safe_thumbnail_path,
                thumbnail_image_id
             ) VALUES (
                'checkpoints',
                'Model A',
                ?1,
                ?2,
                ?3
             )",
            params![old_id, old_thumbnail_path, old_id],
        )
        .expect("facet cache");
        conn.execute(
            "INSERT INTO models (
                hash,
                name,
                lookup_source,
                scanned_at,
                thumbnail_path,
                resource_type
             ) VALUES ('model-skip-target', 'Model A', 'manual_thumbnail', 1, ?1, 'checkpoint')",
            params![old_id],
        )
        .expect("manual model thumbnail");

        let result = super::move_image_path_identities_inner(
            &conn,
            &[super::ImagePathIdentityMove {
                old_id: old_id.to_string(),
                new_id: new_id.to_string(),
                thumbnail_path: Some(new_id.to_string()),
                thumbnail_source: None,
            }],
        )
        .expect("skip target");

        assert_eq!(result.moved, 0);
        assert_eq!(result.skipped_target_exists, 1);
        assert_eq!(result.skipped_source_missing, 0);

        let facet_row = conn
            .query_row(
                "SELECT thumbnail_path, safe_thumbnail_path, thumbnail_image_id
                 FROM facet_cache
                 WHERE facet_type = 'checkpoints' AND resource_name = 'Model A'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("facet cache row");
        assert_eq!(facet_row.0.as_deref(), Some(old_id));
        assert_eq!(facet_row.1.as_deref(), Some(old_thumbnail_path));
        assert_eq!(facet_row.2.as_deref(), Some(old_id));

        let model_thumbnail_path: Option<String> = conn
            .query_row(
                "SELECT thumbnail_path FROM models WHERE hash = 'model-skip-target'",
                [],
                |row| row.get(0),
            )
            .expect("model thumbnail");
        assert_eq!(model_thumbnail_path.as_deref(), Some(old_id));
    }

    #[test]
    fn move_image_path_identities_skips_missing_source_without_repairing_caches() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let old_id = "D:/Invoke/outputs/images/missing.png";
        let old_thumbnail_path = "D:/Invoke/outputs/images/thumbnails/missing.webp";
        let new_id = "D:/Invoke/outputs/images/2026/05/missing.png";
        conn.execute(
            "INSERT INTO facet_cache (
                facet_type,
                resource_name,
                thumbnail_path,
                safe_thumbnail_path,
                thumbnail_image_id
             ) VALUES (
                'checkpoints',
                'Model A',
                ?1,
                ?2,
                ?3
             )",
            params![old_id, old_thumbnail_path, old_id],
        )
        .expect("facet cache");
        conn.execute(
            "INSERT INTO models (
                hash,
                name,
                lookup_source,
                scanned_at,
                thumbnail_path,
                resource_type
             ) VALUES ('model-missing-source', 'Model A', 'manual_thumbnail', 1, ?1, 'checkpoint')",
            params![old_id],
        )
        .expect("manual model thumbnail");

        let result = super::move_image_path_identities_inner(
            &conn,
            &[super::ImagePathIdentityMove {
                old_id: old_id.to_string(),
                new_id: new_id.to_string(),
                thumbnail_path: Some(new_id.to_string()),
                thumbnail_source: None,
            }],
        )
        .expect("skip missing source");

        assert_eq!(result.moved, 0);
        assert_eq!(result.skipped_target_exists, 0);
        assert_eq!(result.skipped_source_missing, 1);

        let facet_row = conn
            .query_row(
                "SELECT thumbnail_path, safe_thumbnail_path, thumbnail_image_id
                 FROM facet_cache
                 WHERE facet_type = 'checkpoints' AND resource_name = 'Model A'",
                [],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .expect("facet cache row");
        assert_eq!(facet_row.0.as_deref(), Some(old_id));
        assert_eq!(facet_row.1.as_deref(), Some(old_thumbnail_path));
        assert_eq!(facet_row.2.as_deref(), Some(old_id));

        let model_thumbnail_path: Option<String> = conn
            .query_row(
                "SELECT thumbnail_path FROM models WHERE hash = 'model-missing-source'",
                [],
                |row| row.get(0),
            )
            .expect("model thumbnail");
        assert_eq!(model_thumbnail_path.as_deref(), Some(old_id));
    }

    #[test]
    fn save_images_batch_routes_reparsed_invoke_t2i_adapters_to_controlnet_junction() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        let original = r#"{
            "t2iAdapters": [
                { "model": { "name": "t2iadapter_depth_sd15v2.pth" } },
                "T2I-Adapter-Canny-SDXL-1.0.safetensors"
            ]
        }"#;
        let reparsed = crate::metadata::reparse::reparse_from_json(original, "InvokeAI")
            .expect("reparse InvokeAI metadata");

        super::save_images_batch_inner(
            &conn,
            &[create_image_record(
                "invoke-t2i",
                100,
                200,
                &reparsed.metadata_json,
            )],
        )
        .expect("save reparsed image");

        let controlnet_rows: Vec<String> = {
            let mut stmt = conn
                .prepare(
                    "SELECT controlnet_name FROM image_controlnets
                     WHERE image_id = 'invoke-t2i' ORDER BY controlnet_name",
                )
                .expect("prepare controlnet query");
            stmt.query_map([], |row| row.get(0))
                .expect("query controlnets")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect controlnets")
        };
        let ipadapter_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM image_ipadapters WHERE image_id = 'invoke-t2i'",
                [],
                |row| row.get(0),
            )
            .expect("ip-adapter count");

        assert_eq!(
            controlnet_rows,
            vec![
                "t2i_adapter_canny_sdxl_1.0".to_string(),
                "t2iadapter_depth_sd15v2".to_string(),
            ]
        );
        assert_eq!(ipadapter_count, 0);
    }

    #[test]
    fn save_images_batch_replaces_existing_junction_rows_when_metadata_changes() {
        let conn = Connection::open_in_memory().expect("in-memory db");

        apply_all_migrations(&conn);

        let initial_metadata = r#"{
            "model": "Base Model",
            "modelHash": "hash-1",
            "tool": "ComfyUI",
            "loras": ["OldLora:1.0"],
            "embeddings": ["OldEmbedding"],
            "controlNets": ["OldControl"]
        }"#;
        let updated_metadata = r#"{
            "model": "Base Model",
            "modelHash": "hash-1",
            "tool": "ComfyUI",
            "loras": ["NewLora:1.0"],
            "ipAdapters": ["Face Adapter"]
        }"#;

        super::save_images_batch_inner(
            &conn,
            &[create_image_record("img-1", 100, 200, initial_metadata)],
        )
        .expect("initial save");

        super::save_images_batch_inner(
            &conn,
            &[create_image_record("img-1", 200, 300, updated_metadata)],
        )
        .expect("updated save");

        let lora_rows: Vec<String> = {
            let mut stmt = conn
                .prepare(
                    "SELECT lora_name FROM image_loras WHERE image_id = 'img-1' ORDER BY lora_name",
                )
                .expect("prepare lora query");
            stmt.query_map([], |row| row.get(0))
                .expect("query loras")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect loras")
        };
        let embedding_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM image_embeddings WHERE image_id = 'img-1'",
                [],
                |row| row.get(0),
            )
            .expect("embedding count");
        let controlnet_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM image_controlnets WHERE image_id = 'img-1'",
                [],
                |row| row.get(0),
            )
            .expect("controlnet count");
        let ipadapter_rows: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT ipadapter_name FROM image_ipadapters WHERE image_id = 'img-1' ORDER BY ipadapter_name")
                .expect("prepare ipadapter query");
            stmt.query_map([], |row| row.get(0))
                .expect("query ipadapters")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect ipadapters")
        };

        assert_eq!(lora_rows, vec!["NewLora".to_string()]);
        assert_eq!(embedding_count, 0);
        assert_eq!(controlnet_count, 0);
        assert_eq!(ipadapter_rows, vec!["Face Adapter".to_string()]);
    }

    #[test]
    fn save_images_batch_synchronizes_zero_and_unknown_seed_values() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);

        super::save_images_batch_inner(
            &conn,
            &[create_image_record(
                "seed-image",
                100,
                200,
                r#"{"tool":"ComfyUI","model":"Model","seed":0}"#,
            )],
        )
        .expect("save zero seed");

        let zero_seed: Option<i64> = conn
            .query_row(
                "SELECT seed FROM images WHERE id = 'seed-image'",
                [],
                |row| row.get(0),
            )
            .expect("zero seed");
        assert_eq!(zero_seed, Some(0));

        super::save_images_batch_inner(
            &conn,
            &[create_image_record(
                "seed-image",
                101,
                201,
                r#"{"tool":"ComfyUI","model":"Model"}"#,
            )],
        )
        .expect("save unknown seed");

        let unknown_seed: Option<i64> = conn
            .query_row(
                "SELECT seed FROM images WHERE id = 'seed-image'",
                [],
                |row| row.get(0),
            )
            .expect("unknown seed");
        assert_eq!(unknown_seed, None);
    }

    #[test]
    fn authoritative_board_snapshot_preserves_local_collection_organization() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        super::save_images_batch_inner(
            &conn,
            &[
                create_image_record("source-kept", 100, 10, "{}"),
                create_image_record("source-excluded", 101, 11, "{}"),
                create_image_record("local-added", 102, 12, "{}"),
                create_image_record("absent-source", 103, 13, "{}"),
            ],
        )
        .expect("seed images");
        conn.execute_batch(
            "UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'kept.png', board_id = 'board-a'
             WHERE id = 'source-kept';
             UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'excluded.png', board_id = 'board-a'
             WHERE id = 'source-excluded';
             UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'absent.png', board_id = 'board-absent'
             WHERE id = 'absent-source';
             INSERT INTO collections (
                 id, name, created_at, source, invoke_source_id, invoke_owner_id,
                 invoke_source_name
             ) VALUES
                 (
                     'board-a', 'Local label', 1, 'invoke', 'invoke.db', 'owner-a',
                     'Old upstream label'
                 ),
                 (
                     'board-absent', 'Offline board', 1, 'invoke', 'invoke.db', 'owner-a',
                     'Offline board'
                 );
             INSERT INTO invoke_board_membership_snapshot VALUES
                 ('board-a', 'kept.png'),
                 ('board-a', 'excluded.png'),
                 ('board-absent', 'absent.png');
             INSERT INTO invoke_board_membership_exclusions VALUES
                 ('board-a', 'excluded.png');
             INSERT INTO invoke_board_membership_additions VALUES
                 ('board-a', 'local-added');
             INSERT INTO collection_images VALUES
                 ('board-a', 'source-kept'),
                 ('board-a', 'local-added'),
                 ('board-absent', 'absent-source');",
        )
        .expect("seed local organization");

        let snapshot = super::InvokeBoardSnapshotInput {
            db_path: "invoke.db".to_string(),
            mode: super::InvokeOwnerScopeMode::Owner,
            owner_id: Some("owner-a".to_string()),
            boards: vec![super::InvokeBoardSnapshotBoard {
                id: "board-a".to_string(),
                name: "New upstream label".to_string(),
                created_at: 2,
                owner_id: Some("owner-a".to_string()),
            }],
            memberships: vec![
                super::InvokeBoardSnapshotMembership {
                    image_name: "kept.png".to_string(),
                    board_id: "board-a".to_string(),
                },
                super::InvokeBoardSnapshotMembership {
                    image_name: "excluded.png".to_string(),
                    board_id: "board-a".to_string(),
                },
            ],
            reconcile_memberships: true,
            delete_missing_collections: true,
        };

        super::reconcile_invoke_board_snapshot_inner(&conn, &snapshot)
            .expect("apply authoritative snapshot");

        let board_state: (String, Option<String>, i64) = conn
            .query_row(
                "SELECT name, invoke_source_name, invoke_source_present
                 FROM collections WHERE id = 'board-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("current board");
        assert_eq!(
            board_state,
            (
                "Local label".to_string(),
                Some("New upstream label".to_string()),
                1
            )
        );

        let absent_state: (i64, i64) = conn
            .query_row(
                "SELECT invoke_source_present, COUNT(*)
                 FROM collections WHERE id = 'board-absent'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("absent board remains recoverable");
        assert_eq!(absent_state, (0, 1));

        let memberships: Vec<String> = conn
            .prepare(
                "SELECT image_id FROM collection_images
                 WHERE collection_id = 'board-a' ORDER BY image_id",
            )
            .expect("prepare effective membership")
            .query_map([], |row| row.get(0))
            .expect("query effective membership")
            .collect::<Result<_, _>>()
            .expect("collect effective membership");
        assert_eq!(
            memberships,
            vec!["local-added".to_string(), "source-kept".to_string()]
        );
    }

    #[test]
    fn authoritative_owner_board_snapshot_reconciles_source_facts_without_deleting_boards() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_all_migrations(&conn);
        super::save_images_batch_inner(
            &conn,
            &[
                create_image_record("owner-a-moved", 100, 10, "{}"),
                create_image_record("owner-a-removed", 101, 11, "{}"),
                create_image_record("owner-b-image", 102, 12, "{}"),
            ],
        )
        .expect("seed images");
        conn.execute_batch(
            "UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'moved.png', board_id = 'old-board'
             WHERE id = 'owner-a-moved';
             UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                 invoke_image_name = 'removed.png', board_id = 'kept-board'
             WHERE id = 'owner-a-removed';
             UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-b',
                 invoke_image_name = 'owner-b.png', board_id = 'owner-b-board'
             WHERE id = 'owner-b-image';
             INSERT INTO collections (
                 id, name, created_at, source, invoke_source_id, invoke_owner_id,
                 invoke_source_name
             ) VALUES
                 (
                     'old-board', 'Transferred away', 1, 'invoke', 'invoke.db', 'owner-a',
                     'Transferred away'
                 ),
                 (
                     'kept-board', 'Old name', 1, 'invoke', 'invoke.db', 'owner-a',
                     'Old name'
                 ),
                 (
                     'owner-b-board', 'Owner B', 1, 'invoke', 'invoke.db', 'owner-b',
                     'Owner B'
                 );
             INSERT INTO collection_images VALUES
                 ('old-board', 'owner-a-moved'),
                 ('kept-board', 'owner-a-removed'),
                 ('owner-b-board', 'owner-b-image');
             INSERT INTO invoke_owner_scope_state (
                 state_key, db_path, images_root, scope_mode, owner_id, boards_verified, updated_at
             ) VALUES ('current', 'invoke.db', 'images', 'owner', 'owner-a', 1, 1);",
        )
        .expect("seed stale boards");

        let snapshot = super::InvokeBoardSnapshotInput {
            db_path: "invoke.db".to_string(),
            mode: super::InvokeOwnerScopeMode::Owner,
            owner_id: Some("owner-a".to_string()),
            boards: vec![super::InvokeBoardSnapshotBoard {
                id: "kept-board".to_string(),
                name: "Current name".to_string(),
                created_at: 2,
                owner_id: Some("owner-a".to_string()),
            }],
            memberships: vec![super::InvokeBoardSnapshotMembership {
                image_name: "moved.png".to_string(),
                board_id: "kept-board".to_string(),
            }],
            reconcile_memberships: true,
            delete_missing_collections: true,
        };
        let mut catalog_snapshot = snapshot.clone();
        catalog_snapshot.mode = super::InvokeOwnerScopeMode::All;
        catalog_snapshot.owner_id = None;
        catalog_snapshot
            .boards
            .push(super::InvokeBoardSnapshotBoard {
                id: "owner-b-board".to_string(),
                name: "Owner B".to_string(),
                created_at: 1,
                owner_id: Some("owner-b".to_string()),
            });
        catalog_snapshot.reconcile_memberships = false;
        catalog_snapshot.delete_missing_collections = false;
        let catalog_result = super::reconcile_invoke_board_snapshot_inner(&conn, &catalog_snapshot)
            .expect("apply non-destructive owner catalog");
        assert_eq!(catalog_result.collections_deleted, 0);
        let transferred_board: (Option<String>, i64, i64) = conn
            .query_row(
                "SELECT invoke_owner_id, invoke_board_verified, invoke_source_present
                 FROM collections WHERE id = 'old-board'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("old board remains");
        assert_eq!(transferred_board, (Some("owner-a".to_string()), 1, 0));
        let scoped_unavailable_board: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_collections WHERE id = 'old-board'",
                [],
                |row| row.get(0),
            )
            .expect("source-unavailable board remains visible in its verified owner scope");
        assert_eq!(scoped_unavailable_board, 1);
        let retained_membership: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collection_images WHERE collection_id = 'old-board'",
                [],
                |row| row.get(0),
            )
            .expect("retained old-board membership");
        assert_eq!(retained_membership, 1);

        let result = super::reconcile_invoke_board_snapshot_inner(&conn, &snapshot)
            .expect("replace owner A board snapshot");

        assert!(result.changed_count() > 0);
        let owner_a_boards: Vec<(String, String, i64)> = conn
            .prepare(
                "SELECT id, name, invoke_source_present FROM collections
                 WHERE source = 'invoke' AND invoke_owner_id = 'owner-a' ORDER BY id",
            )
            .expect("owner A boards query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("owner A boards")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect owner A boards");
        assert_eq!(
            owner_a_boards,
            vec![
                ("kept-board".to_string(), "Current name".to_string(), 1),
                ("old-board".to_string(), "Transferred away".to_string(), 0),
            ]
        );
        let board_ids: Vec<(String, Option<String>)> = conn
            .prepare("SELECT id, board_id FROM images ORDER BY id")
            .expect("image boards query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("image boards")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect image boards");
        assert_eq!(
            board_ids,
            vec![
                ("owner-a-moved".to_string(), Some("kept-board".to_string())),
                ("owner-a-removed".to_string(), None),
                (
                    "owner-b-image".to_string(),
                    Some("owner-b-board".to_string())
                ),
            ]
        );
        let memberships: Vec<(String, String)> = conn
            .prepare(
                "SELECT collection_id, image_id FROM collection_images
                 ORDER BY image_id, collection_id",
            )
            .expect("memberships query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("memberships")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect memberships");
        assert_eq!(
            memberships,
            vec![
                ("kept-board".to_string(), "owner-a-moved".to_string()),
                ("old-board".to_string(), "owner-a-moved".to_string()),
                ("owner-b-board".to_string(), "owner-b-image".to_string()),
            ]
        );
        let unchanged = super::reconcile_invoke_board_snapshot_inner(&conn, &snapshot)
            .expect("repeat authoritative snapshot");
        assert_eq!(unchanged.changed_count(), 0);
    }

    #[test]
    fn authoritative_unscoped_board_snapshots_reconcile_every_owner() {
        for mode in [
            super::InvokeOwnerScopeMode::All,
            super::InvokeOwnerScopeMode::Legacy,
        ] {
            let conn = Connection::open_in_memory().expect("in-memory db");
            apply_all_migrations(&conn);
            super::save_images_batch_inner(
                &conn,
                &[
                    create_image_record("owner-a-image", 100, 10, "{}"),
                    create_image_record("owner-b-image", 101, 11, "{}"),
                ],
            )
            .expect("seed images");
            conn.execute_batch(
                "UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a',
                     invoke_image_name = 'owner-a.png', board_id = 'stale-a'
                 WHERE id = 'owner-a-image';
                 UPDATE images SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-b',
                     invoke_image_name = 'owner-b.png', board_id = 'stale-b'
                 WHERE id = 'owner-b-image';
                 INSERT INTO collections (
                     id, name, created_at, source, invoke_source_id, invoke_owner_id
                 ) VALUES
                     ('stale-a', 'Stale A', 1, 'invoke', 'invoke.db', 'owner-a'),
                     ('stale-b', 'Stale B', 1, 'invoke', 'invoke.db', 'owner-b');
                 INSERT INTO collection_images VALUES
                     ('stale-a', 'owner-a-image'),
                     ('stale-b', 'owner-b-image');",
            )
            .expect("seed stale boards");

            let snapshot = super::InvokeBoardSnapshotInput {
                db_path: "invoke.db".to_string(),
                mode,
                owner_id: Some("must-not-restrict-unscoped-mode".to_string()),
                boards: vec![
                    super::InvokeBoardSnapshotBoard {
                        id: "current-a".to_string(),
                        name: "Current A".to_string(),
                        created_at: 2,
                        owner_id: Some("owner-a".to_string()),
                    },
                    super::InvokeBoardSnapshotBoard {
                        id: "current-b".to_string(),
                        name: "Current B".to_string(),
                        created_at: 3,
                        owner_id: Some("owner-b".to_string()),
                    },
                ],
                memberships: vec![
                    super::InvokeBoardSnapshotMembership {
                        image_name: "owner-a.png".to_string(),
                        board_id: "current-a".to_string(),
                    },
                    super::InvokeBoardSnapshotMembership {
                        image_name: "owner-b.png".to_string(),
                        board_id: "current-b".to_string(),
                    },
                ],
                reconcile_memberships: true,
                delete_missing_collections: true,
            };

            let result = super::reconcile_invoke_board_snapshot_inner(&conn, &snapshot)
                .expect("replace unscoped board snapshot");
            assert!(result.changed_count() > 0);

            let boards: Vec<(String, Option<String>, i64)> = conn
                .prepare(
                    "SELECT id, invoke_owner_id, invoke_source_present FROM collections
                     WHERE source = 'invoke' ORDER BY id",
                )
                .expect("board query")
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .expect("boards")
                .collect::<Result<_, _>>()
                .expect("collect boards");
            assert_eq!(
                boards,
                vec![
                    ("current-a".to_string(), Some("owner-a".to_string()), 1),
                    ("current-b".to_string(), Some("owner-b".to_string()), 1),
                    ("stale-a".to_string(), Some("owner-a".to_string()), 0),
                    ("stale-b".to_string(), Some("owner-b".to_string()), 0),
                ]
            );
            let image_boards: Vec<(String, Option<String>)> = conn
                .prepare("SELECT id, board_id FROM images ORDER BY id")
                .expect("image board query")
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("image boards")
                .collect::<Result<_, _>>()
                .expect("collect image boards");
            assert_eq!(
                image_boards,
                vec![
                    ("owner-a-image".to_string(), Some("current-a".to_string())),
                    ("owner-b-image".to_string(), Some("current-b".to_string())),
                ]
            );
        }
    }
}
