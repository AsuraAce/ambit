use super::run_blocking;
use crate::db::ImageRecord;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeSet;
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

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvokeOwnerScopeRefreshResult {
    pub changed: bool,
    pub active_updated: usize,
    pub removed_updated: usize,
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

        let mut stmt = tx.prepare_cached(
            "INSERT INTO images (id, path, width, height, file_size, file_hash, timestamp, metadata_json, thumbnail_path, micro_thumbnail, thumbnail_source, thumbnail_version, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json, original_state_json, is_corrupt, invoke_image_name, invoke_image_category, invoke_image_origin, invoke_owner_id, invoke_scope_hidden, model_hash, model_name, tool, resolved_model_name, steps, seed, cfg, sampler, generation_type, parser_version, original_parsed_json, positive_prompt, negative_prompt)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                    CASE WHEN ?11 = 'ambit' AND ?9 IS NOT NULL AND ?9 != '' AND ?2 != ?9 THEN 1 ELSE 0 END,
                    ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26,
                    CASE WHEN EXISTS (
                        SELECT 1 FROM invoke_owner_scope_state scope
                        WHERE LOWER(substr(REPLACE(?2, '\\', '/'), 1, length(scope.images_root || '/outputs/images/'))) = LOWER(scope.images_root || '/outputs/images/')
                          AND (
                            scope.scope_mode = 'unselected'
                            OR (scope.scope_mode = 'owner' AND (?26 IS NULL OR ?26 IS NOT scope.owner_id))
                          )
                    ) THEN 1 ELSE 0 END,
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
                        WHEN excluded.invoke_image_name IS NOT NULL THEN excluded.invoke_scope_hidden
                        ELSE images.invoke_scope_hidden
                    END,
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
                    OR (excluded.invoke_image_name IS NOT NULL AND images.invoke_scope_hidden IS NOT excluded.invoke_scope_hidden)
                    OR images.original_metadata_json IS NULL
                    OR images.original_metadata_json != excluded.original_metadata_json"
        ).map_err(|e| e.to_string())?;

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

fn normalize_invoke_root(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
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

    let source_prefix = format!("{images_root}/outputs/images/");
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
    if !input.force_refresh && previous.as_ref() == Some(&next) {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(InvokeOwnerScopeRefreshResult::default());
    }

    let visibility_sql = match input.mode {
        InvokeOwnerScopeMode::Legacy | InvokeOwnerScopeMode::All => "0",
        InvokeOwnerScopeMode::Unselected => "1",
        InvokeOwnerScopeMode::Owner => "CASE WHEN invoke_owner_id = ?2 THEN 0 ELSE 1 END",
    };
    let update_sql = |table: &str| {
        format!(
            "UPDATE {table}
             SET invoke_scope_hidden = {visibility_sql}
             WHERE LOWER(substr(REPLACE(path, '\\', '/'), 1, length(?1))) = LOWER(?1)
               AND invoke_scope_hidden IS NOT ({visibility_sql})"
        )
    };
    let update_table = |table: &str| -> Result<usize, String> {
        let sql = update_sql(table);
        if input.mode == InvokeOwnerScopeMode::Owner {
            tx.execute(&sql, params![source_prefix, owner_id])
                .map_err(|e| e.to_string())
        } else {
            tx.execute(&sql, params![source_prefix])
                .map_err(|e| e.to_string())
        }
    };

    let active_updated = update_table("images")?;
    let removed_updated = update_table("removed_images")?;
    tx.execute(
        "INSERT INTO invoke_owner_scope_state (
             state_key, db_path, images_root, scope_mode, owner_id, updated_at
         ) VALUES ('current', ?1, ?2, ?3, ?4, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
         ON CONFLICT(state_key) DO UPDATE SET
             db_path = excluded.db_path,
             images_root = excluded.images_root,
             scope_mode = excluded.scope_mode,
             owner_id = excluded.owner_id,
             updated_at = excluded.updated_at",
        params![db_path, images_root, input.mode.as_str(), owner_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(InvokeOwnerScopeRefreshResult {
        changed: previous.as_ref() != Some(&next) || active_updated > 0 || removed_updated > 0,
        active_updated,
        removed_updated,
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
            .prepare_cached("SELECT 1 FROM images WHERE id = ?1 LIMIT 1")
            .map_err(|e| e.to_string())?;
        let mut source_identity = tx
            .prepare_cached("SELECT path, thumbnail_path FROM images WHERE id = ?1 LIMIT 1")
            .map_err(|e| e.to_string())?;
        let mut update_image = tx
            .prepare_cached(
                "UPDATE images
                 SET id = ?1,
                     path = ?1,
                     thumbnail_path = COALESCE(NULLIF(?2, ''), thumbnail_path),
                     thumbnail_source = ?3,
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
            let old_id = normalize_image_identity_path(&item.old_id);
            let new_id = normalize_image_identity_path(&item.new_id);
            if old_id == new_id {
                continue;
            }

            let has_target = target_exists
                .exists(params![&new_id])
                .map_err(|e| e.to_string())?;
            if has_target {
                result.skipped_target_exists += 1;
                continue;
            }

            let source_row = source_identity
                .query_row(params![&old_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })
                .optional()
                .map_err(|e| e.to_string())?;
            let Some((source_path, source_thumbnail_path)) = source_row else {
                result.skipped_source_missing += 1;
                continue;
            };
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
        refresh_invoke_owner_scope_inner(conn, &input)
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
pub async fn get_image_count_for_path_prefix(app: AppHandle, path: String) -> Result<i64, String> {
    run_blocking(app, move |conn| {
        let normalized = path.trim_end_matches(['/', '\\']);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM images
                 WHERE invoke_scope_hidden = 0 AND (path LIKE ? OR path LIKE ?)",
                params![format!("{}/%", normalized), format!("{}\\%", normalized)],
                |r| r.get(0),
            )
            .unwrap_or(0);
        Ok(count)
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
                .prepare("SELECT id, path FROM images WHERE board_id IS NULL")
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
             FROM images
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
        assert_eq!(owner_result.active_updated, 1);

        let active: Vec<(String, i64)> = conn
            .prepare("SELECT id, invoke_scope_hidden FROM images ORDER BY id")
            .expect("prepare active visibility")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query active visibility")
            .collect::<Result<_, _>>()
            .expect("collect active visibility");
        assert_eq!(
            active,
            vec![
                ("outside".to_string(), 0),
                ("owner-a".to_string(), 0),
                ("owner-b".to_string(), 1),
            ]
        );
        let removed_hidden: i64 = conn
            .query_row(
                "SELECT invoke_scope_hidden FROM removed_images WHERE id = 'removed-a'",
                [],
                |row| row.get(0),
            )
            .expect("removed visibility");
        assert_eq!(removed_hidden, 0);

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
                "SELECT invoke_scope_hidden FROM images WHERE id = 'owner-b'",
                [],
                |row| row.get(0),
            )
            .expect("drifted visibility");
        assert_eq!(
            drifted_visibility, 0,
            "unchanged scope must avoid a table repair pass"
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
        assert_eq!(forced_result.active_updated, 1);

        let mut generic_late = create_image_record("generic-late", 101, 10, "{}");
        generic_late.path = "C:/Invoke/outputs/images/generic-late.png".to_string();
        let mut owner_late = create_image_record("owner-late", 102, 10, "{}");
        owner_late.path = "C:/Invoke/outputs/images/owner-late.png".to_string();
        owner_late.invoke_image_name = Some("owner-late.png".to_string());
        owner_late.invoke_owner_id = Some("a".to_string());
        super::save_images_batch_inner(&conn, &[generic_late, owner_late])
            .expect("insert rows while owner scope is active");
        let late_visibility: Vec<(String, i64)> = conn
            .prepare(
                "SELECT id, invoke_scope_hidden FROM images
                 WHERE id IN ('generic-late', 'owner-late') ORDER BY id",
            )
            .expect("prepare late visibility")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query late visibility")
            .collect::<Result<_, _>>()
            .expect("collect late visibility");
        assert_eq!(
            late_visibility,
            vec![
                ("generic-late".to_string(), 1),
                ("owner-late".to_string(), 0),
            ],
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
        assert_eq!(stale_result.active_updated, 2);
        let visible_in_root: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM images
                 WHERE path LIKE 'C:/Invoke/outputs/images/%' AND invoke_scope_hidden = 0",
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
        assert_eq!(all_result.active_updated, 4);
        assert_eq!(all_result.removed_updated, 1);
        let total_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
            .expect("active row count");
        assert_eq!(total_rows, 5, "scope changes must never delete stored rows");
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
}
