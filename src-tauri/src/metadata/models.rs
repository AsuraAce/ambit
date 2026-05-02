use crate::db::resolve_db_path;
use crate::metadata::guidance::GuidanceClassifier;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct ModelResolutionState {
    pub is_cancelled: Arc<AtomicBool>,
}

impl Default for ModelResolutionState {
    fn default() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub struct ModelDiscoveryState {
    pub is_cancelled: Arc<AtomicBool>,
}

impl Default for ModelDiscoveryState {
    fn default() -> Self {
        Self {
            is_cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCacheEntry {
    pub hash: String,
    pub name: String,
    pub filename: Option<String>,
    pub lookup_source: String,
    pub scanned_at: u64,
    pub thumbnail_path: Option<String>,
    pub preview_url: Option<String>,
    pub resource_type: Option<String>,
}

#[derive(Serialize, specta::Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionResult {
    pub resolved_count: usize,
    pub harvested_count: usize,
    pub failed_count: usize,
    pub named_fallback_count: usize,
    pub unknown_count: usize,
}

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub current: usize,
    pub total: usize,
    pub message: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailScanResult {
    pub found: usize,
    pub updated: usize,
}

#[derive(Debug, Clone)]
struct ThumbnailCandidate {
    path: String,
    image_id: Option<String>,
    privacy_hidden: i64,
}

fn infer_resource_type(model_hash: &str) -> &'static str {
    if model_hash.starts_with("lora_") {
        "loras"
    } else if model_hash.starts_with("emb_") {
        "embeddings"
    } else if model_hash.starts_with("hyper_") {
        "hypernetworks"
    } else if model_hash.starts_with("cnet_") {
        "control_nets"
    } else if model_hash.starts_with("ipad_") {
        "ip_adapters"
    } else {
        "checkpoint"
    }
}

fn normalize_resource_type(resource_type: Option<&str>, model_hash: &str) -> String {
    let candidate = resource_type
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| infer_resource_type(model_hash));

    match candidate {
        "checkpoints" | "checkpoint" => "checkpoint".to_string(),
        "loras" => "loras".to_string(),
        "embeddings" => "embeddings".to_string(),
        "hypernetworks" => "hypernetworks".to_string(),
        "controlNets" | "control_nets" => "control_nets".to_string(),
        "ipAdapters" | "ip_adapters" => "ip_adapters".to_string(),
        _ => infer_resource_type(model_hash).to_string(),
    }
}

fn facet_type_for_resource(resource_type: &str) -> &str {
    match resource_type {
        "checkpoint" => "checkpoints",
        other => other,
    }
}

fn resolve_thumbnail_candidate(
    conn: &Connection,
    requested_path: &str,
) -> Result<ThumbnailCandidate, String> {
    let image_match = conn
        .query_row(
            "SELECT id, COALESCE(NULLIF(thumbnail_path, ''), path), privacy_hidden
             FROM images
             WHERE id = ?1 OR path = ?1 OR thumbnail_path = ?1
             LIMIT 1",
            params![requested_path],
            |row| {
                Ok(ThumbnailCandidate {
                    image_id: Some(row.get(0)?),
                    path: row.get(1)?,
                    privacy_hidden: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(image_match.unwrap_or_else(|| ThumbnailCandidate {
        path: requested_path.to_string(),
        image_id: None,
        privacy_hidden: 1,
    }))
}

fn best_resource_thumbnail(
    conn: &Connection,
    model_name: &str,
    model_hash: &str,
    resource_type: &str,
    safe_only: bool,
) -> Option<ThumbnailCandidate> {
    let safe_clause = if safe_only {
        "AND i.privacy_hidden = 0"
    } else {
        ""
    };

    let uses_hash = resource_type == "checkpoint";
    let query = match resource_type {
        "checkpoint" => format!(
            "SELECT i.thumbnail_path, i.id, i.privacy_hidden
             FROM images i
             WHERE (
                i.model_hash = ?2
                OR i.model_name = ?1
                OR i.resolved_model_name = ?1
             )
             AND i.is_deleted = 0
             AND i.thumbnail_path IS NOT NULL
             AND i.thumbnail_path != ''
             {safe_clause}
             ORDER BY i.is_pinned DESC, i.timestamp DESC
             LIMIT 1"
        ),
        "loras" => format_resource_thumbnail_query("image_loras", "lora_name", safe_clause),
        "embeddings" => {
            format_resource_thumbnail_query("image_embeddings", "embedding_name", safe_clause)
        }
        "hypernetworks" => format_resource_thumbnail_query(
            "image_hypernetworks",
            "hypernetwork_name",
            safe_clause,
        ),
        "control_nets" => {
            format_resource_thumbnail_query("image_controlnets", "controlnet_name", safe_clause)
        }
        "ip_adapters" => {
            format_resource_thumbnail_query("image_ipadapters", "ipadapter_name", safe_clause)
        }
        _ => return None,
    };

    if uses_hash {
        conn.query_row(&query, params![model_name, model_hash], |row| {
            Ok(ThumbnailCandidate {
                path: row.get(0)?,
                image_id: Some(row.get(1)?),
                privacy_hidden: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
            })
        })
        .optional()
        .ok()
        .flatten()
    } else {
        conn.query_row(&query, params![model_name], |row| {
            Ok(ThumbnailCandidate {
                path: row.get(0)?,
                image_id: Some(row.get(1)?),
                privacy_hidden: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
            })
        })
        .optional()
        .ok()
        .flatten()
    }
}

fn format_resource_thumbnail_query(table: &str, name_col: &str, safe_clause: &str) -> String {
    format!(
        "SELECT i.thumbnail_path, i.id, i.privacy_hidden
         FROM {table} jt
         JOIN images i ON i.id = jt.image_id
         WHERE jt.{name_col} = ?1
         AND i.is_deleted = 0
         AND i.thumbnail_path IS NOT NULL
         AND i.thumbnail_path != ''
         {safe_clause}
         ORDER BY i.is_pinned DESC, i.timestamp DESC
         LIMIT 1"
    )
}

fn name_matches_mask_keywords(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS (
            SELECT 1 FROM privacy_mask_keywords
            WHERE LOWER(?1) LIKE '%' || keyword || '%'
        )",
        params![name],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v == 1)
    .unwrap_or(false)
}

fn sensitivity_with_override(override_value: Option<i64>, auto_value: i64) -> i64 {
    match override_value {
        Some(0) => 0,
        Some(1) => 1,
        _ => auto_value,
    }
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn clear_model_cache(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM models", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_model_resolution(state: tauri::State<'_, ModelResolutionState>) {
    state.is_cancelled.store(true, Ordering::SeqCst);
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_model_discovery(state: tauri::State<'_, ModelDiscoveryState>) {
    state.is_cancelled.store(true, Ordering::SeqCst);
}

pub fn classify_unlabeled_models(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT hash, name, resource_type FROM models
         WHERE guidance_subtype IS NULL
         AND resource_type IN ('checkpoint', 'control_nets', 'ip_adapters')",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut updates = Vec::new();
    for row in rows {
        if let Ok((hash, name, r_type)) = row {
            let should_classify = r_type != "checkpoint"
                || name.to_lowercase().contains("control")
                || name.to_lowercase().contains("ip-adapter");

            if should_classify {
                let h_param = if hash.starts_with("file:")
                    || hash.starts_with("cnet_")
                    || hash.starts_with("ipad_")
                {
                    None
                } else {
                    Some(hash.as_str())
                };
                if let Some((cat, sub)) = GuidanceClassifier::classify(&name, h_param) {
                    updates.push((hash, cat.as_str().to_string(), sub));
                } else if r_type != "checkpoint" {
                    updates.push((
                        hash,
                        if r_type == "ip_adapters" {
                            "IP-Adapter"
                        } else {
                            "ControlNet"
                        }
                        .to_string(),
                        "other".to_string(),
                    ));
                }
            }
        }
    }

    if !updates.is_empty() {
        let mut update_stmt = conn
            .prepare(
                "UPDATE models SET guidance_category = ?1, guidance_subtype = ?2 WHERE hash = ?3",
            )
            .map_err(|e| e.to_string())?;

        for (hash, cat, sub) in updates {
            let _ = update_stmt.execute(params![cat, sub, hash]);
        }
    }

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn set_model_thumbnail(
    app: tauri::AppHandle,
    model_hash: String,
    model_name: Option<String>,
    image_path: String,
    resource_type: Option<String>,
) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;
    let r_type = resource_type.unwrap_or_else(|| "checkpoint".to_string());
    let name_val = model_name
        .clone()
        .unwrap_or_else(|| "Unknown Model".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        let resolved = resolve_thumbnail_candidate(&conn, &image_path)?;
        let auto_sensitive = resolved.privacy_hidden;

        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, thumbnail_path, thumbnail_mode, resource_type)
             VALUES (?1, ?5, 'manual_thumbnail', ?2, ?3, NULL, ?4)
             ON CONFLICT(hash) DO UPDATE SET thumbnail_path = ?3, thumbnail_mode = NULL, resource_type = ?4, name = COALESCE(EXCLUDED.name, models.name)",
            params![
                model_hash,
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
                resolved.path.as_str(),
                r_type,
                name_val
            ]
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE facet_cache
             SET thumbnail_path = ?1,
                 thumbnail_image_id = ?2,
                 thumbnail_is_sensitive = CASE
                     WHEN thumbnail_sensitivity_override = 0 THEN 0
                     WHEN thumbnail_sensitivity_override = 1 THEN 1
                     ELSE ?3
                 END,
                 is_manual = 1,
                 is_user_override = 1
             WHERE resource_hash = ?4",
            params![
                resolved.path.as_str(),
                resolved.image_id.as_deref(),
                auto_sensitive,
                model_hash
            ]
        ).map_err(|e| e.to_string())?;

        let name_to_use = if let Some(n) = model_name { Some(n) } else {
            conn.query_row("SELECT name FROM models WHERE hash = ?1", params![model_hash], |row| row.get(0)).ok()
        };

        if let Some(name) = name_to_use {
             conn.execute(
                "UPDATE facet_cache
                 SET thumbnail_path = ?1,
                     thumbnail_image_id = ?2,
                     thumbnail_is_sensitive = CASE
                         WHEN thumbnail_sensitivity_override = 0 THEN 0
                         WHEN thumbnail_sensitivity_override = 1 THEN 1
                         ELSE ?3
                     END,
                     is_manual = 1,
                     is_user_override = 1
                 WHERE resource_name = ?4",
                params![
                    resolved.path.as_str(),
                    resolved.image_id.as_deref(),
                    auto_sensitive,
                    name
                ]
            ).map_err(|e| e.to_string())?;
        }

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn unset_model_thumbnail(
    app: tauri::AppHandle,
    model_hash: String,
    model_name: Option<String>,
    resource_type: Option<String>,
) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        let resource_type = normalize_resource_type(resource_type.as_deref(), &model_hash);
        let facet_type = facet_type_for_resource(&resource_type);

        conn.execute(
            "UPDATE models
             SET thumbnail_path = NULL, thumbnail_mode = NULL
             WHERE resource_type = ?1 AND (hash = ?2 OR name = ?3)",
            params![resource_type.as_str(), model_hash, model_name.as_deref()]
        ).map_err(|e| e.to_string())?;

        let (nm_opt, sidecar_path, sensitivity_override): (Option<String>, Option<String>, Option<i64>) = conn.query_row(
            "SELECT name, sidecar_thumbnail_path, thumbnail_sensitivity_override
             FROM models
             WHERE resource_type = ?1 AND (hash = ?2 OR name = ?3)
             LIMIT 1",
            params![resource_type.as_str(), model_hash, model_name.as_deref()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        ).unwrap_or((model_name.clone(), None, None));

        let nm = nm_opt.or(model_name);

        if let Some(nm) = nm {
            let has_sidecar = sidecar_path.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
            let safe_thumb = best_resource_thumbnail(&conn, &nm, &model_hash, &resource_type, true);
            let dynamic_thumb = best_resource_thumbnail(&conn, &nm, &model_hash, &resource_type, false);
            let fallback = if has_sidecar {
                ThumbnailCandidate {
                    path: sidecar_path.unwrap_or_default(),
                    image_id: None,
                    privacy_hidden: 1,
                }
            } else {
                dynamic_thumb.unwrap_or_else(|| ThumbnailCandidate {
                    path: String::new(),
                    image_id: None,
                    privacy_hidden: 0,
                })
            };
            let auto_sensitive = if has_sidecar || name_matches_mask_keywords(&conn, &nm) {
                1
            } else {
                fallback.privacy_hidden
            };
            let sensitive = sensitivity_with_override(sensitivity_override, auto_sensitive);
            let safe_path = safe_thumb.as_ref().map(|thumb| thumb.path.as_str());
            let is_manual = if has_sidecar { 1 } else { 0 };

            conn.execute(
                "UPDATE facet_cache
                 SET thumbnail_path = ?1,
                     safe_thumbnail_path = ?2,
                     thumbnail_image_id = ?3,
                     thumbnail_is_sensitive = ?4,
                     is_manual = ?5,
                     is_user_override = 0
                 WHERE facet_type = ?6 AND resource_name = ?7",
                params![
                    fallback.path.as_str(),
                    safe_path,
                    fallback.image_id.as_deref(),
                    sensitive,
                    is_manual,
                    facet_type,
                    nm
                ],
            ).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE facet_cache
                 SET thumbnail_path = ?1,
                     safe_thumbnail_path = ?2,
                     thumbnail_image_id = ?3,
                     thumbnail_is_sensitive = ?4,
                     is_manual = ?5,
                     is_user_override = 0
                 WHERE facet_type = ?6 AND resource_hash = ?7",
                params![
                    fallback.path.as_str(),
                    safe_path,
                    fallback.image_id.as_deref(),
                    sensitive,
                    is_manual,
                    facet_type,
                    model_hash
                ],
            ).map_err(|e| e.to_string())?;
        }

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn clear_all_thumbnails(
    app: tauri::AppHandle,
    model_hash: String,
    model_name: Option<String>,
    resource_type: Option<String>,
) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
        let resource_type = normalize_resource_type(resource_type.as_deref(), &model_hash);
        let facet_type = facet_type_for_resource(&resource_type);

        conn.execute(
            "UPDATE models
             SET thumbnail_path = NULL, thumbnail_mode = 'dynamic'
             WHERE resource_type = ?1 AND (hash = ?2 OR name = ?3)",
            params![resource_type.as_str(), model_hash, model_name.as_deref()],
        )
        .map_err(|e| e.to_string())?;

        let (nm_opt, sensitivity_override): (Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT name, thumbnail_sensitivity_override
                 FROM models
                 WHERE resource_type = ?1 AND (hash = ?2 OR name = ?3)
                 LIMIT 1",
                params![resource_type.as_str(), model_hash, model_name.as_deref()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or((model_name.clone(), None));
        let nm_opt = model_name.or(nm_opt);

        if let Some(nm) = nm_opt {
            let dynamic_thumb = best_resource_thumbnail(&conn, &nm, &model_hash, &resource_type, false);
            let safe_thumb = best_resource_thumbnail(&conn, &nm, &model_hash, &resource_type, true);
            let fallback = dynamic_thumb.unwrap_or_else(|| ThumbnailCandidate {
                path: String::new(),
                image_id: None,
                privacy_hidden: 0,
            });
            let sensitive =
                sensitivity_with_override(sensitivity_override, fallback.privacy_hidden);
            let safe_path = safe_thumb.as_ref().map(|thumb| thumb.path.as_str());

            conn.execute(
                "UPDATE facet_cache
                 SET thumbnail_path = ?1,
                     safe_thumbnail_path = ?2,
                     thumbnail_image_id = ?3,
                     thumbnail_is_sensitive = ?4,
                     is_manual = 0,
                     is_user_override = 0
                 WHERE facet_type = ?5 AND resource_name = ?6",
                params![
                    fallback.path.as_str(),
                    safe_path,
                    fallback.image_id.as_deref(),
                    sensitive,
                    facet_type,
                    nm
                ],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE facet_cache
                 SET thumbnail_path = ?1,
                     safe_thumbnail_path = ?2,
                     thumbnail_image_id = ?3,
                     thumbnail_is_sensitive = ?4,
                     is_manual = 0,
                     is_user_override = 0
                 WHERE facet_type = ?5 AND resource_hash = ?6",
                params![
                    fallback.path.as_str(),
                    safe_path,
                    fallback.image_id.as_deref(),
                    sensitive,
                    facet_type,
                    model_hash
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn set_resource_thumbnail_sensitivity(
    app: tauri::AppHandle,
    model_hash: String,
    model_name: Option<String>,
    sensitivity: Option<bool>,
    resource_type: Option<String>,
) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;

        set_resource_thumbnail_sensitivity_for_conn(
            &conn,
            &model_hash,
            model_name.as_deref(),
            sensitivity,
            resource_type.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn set_resource_thumbnail_sensitivity_for_conn(
    conn: &Connection,
    model_hash: &str,
    model_name: Option<&str>,
    sensitivity: Option<bool>,
    resource_type: Option<&str>,
) -> Result<(), String> {
    let sensitivity_value = sensitivity.map(|value| if value { 1_i64 } else { 0_i64 });
    let name_val = model_name.unwrap_or("Unknown Model");
    let resource_type = normalize_resource_type(resource_type, model_hash);
    let facet_type = facet_type_for_resource(&resource_type);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let rows = conn
        .execute(
            "UPDATE models
             SET thumbnail_sensitivity_override = ?1
             WHERE resource_type = ?2 AND (hash = ?3 OR name = ?4)",
            params![
                sensitivity_value,
                resource_type.as_str(),
                model_hash,
                model_name
            ],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type, thumbnail_sensitivity_override)
             VALUES (?1, ?2, 'manual_thumbnail_privacy', ?3, ?4, ?5)
             ON CONFLICT(hash) DO UPDATE SET
                thumbnail_sensitivity_override = excluded.thumbnail_sensitivity_override,
                name = COALESCE(excluded.name, models.name),
                resource_type = excluded.resource_type
             WHERE models.resource_type = excluded.resource_type",
            params![
                model_hash,
                name_val,
                now,
                resource_type.as_str(),
                sensitivity_value
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let sensitivity_sql = match sensitivity {
        Some(true) => "1".to_string(),
        Some(false) => "0".to_string(),
        None => "CASE
                WHEN EXISTS (
                    SELECT 1 FROM privacy_mask_keywords k
                    WHERE LOWER(facet_cache.resource_name) LIKE '%' || k.keyword || '%'
                ) THEN 1
                WHEN thumbnail_image_id IS NOT NULL THEN COALESCE((SELECT privacy_hidden FROM images WHERE id = thumbnail_image_id), 0)
                WHEN is_user_override = 1 THEN 1
                WHEN has_sidecar = 1 THEN 1
                WHEN preview_url IS NOT NULL AND preview_url != '' AND thumbnail_path = preview_url THEN 1
                ELSE COALESCE(thumbnail_is_sensitive, 0)
            END"
        .to_string(),
    };

    conn.execute(
        &format!(
            "UPDATE facet_cache
             SET thumbnail_sensitivity_override = ?1,
                 thumbnail_is_sensitive = {sensitivity_sql}
             WHERE facet_type = ?2 AND (resource_hash = ?3 OR resource_name = ?4)"
        ),
        params![sensitivity_value, facet_type, model_hash, model_name],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::init_db;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        for migration in init_db() {
            conn.execute_batch(&migration.sql).expect("apply migration");
        }
        conn
    }

    #[test]
    fn resource_thumbnail_sensitivity_is_resource_type_scoped() {
        let conn = setup_conn();

        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type)
             VALUES
                ('checkpoint_hash', 'Portrait', 'test', 1, 'checkpoint'),
                ('lora_Portrait', 'Portrait', 'test', 1, 'loras')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_is_sensitive)
             VALUES
                ('checkpoints', 'Portrait', 'checkpoint_hash', 1, 0),
                ('loras', 'Portrait', 'lora_Portrait', 1, 0)",
            [],
        )
        .unwrap();

        set_resource_thumbnail_sensitivity_for_conn(
            &conn,
            "lora_Portrait",
            Some("Portrait"),
            Some(true),
            Some("loras"),
        )
        .unwrap();

        let checkpoint_override: Option<i64> = conn
            .query_row(
                "SELECT thumbnail_sensitivity_override FROM models WHERE hash = 'checkpoint_hash'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lora_override: Option<i64> = conn
            .query_row(
                "SELECT thumbnail_sensitivity_override FROM models WHERE hash = 'lora_Portrait'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let checkpoint_sensitive: i64 = conn
            .query_row(
                "SELECT thumbnail_is_sensitive FROM facet_cache WHERE facet_type = 'checkpoints'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lora_sensitive: i64 = conn
            .query_row(
                "SELECT thumbnail_is_sensitive FROM facet_cache WHERE facet_type = 'loras'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(checkpoint_override, None);
        assert_eq!(lora_override, Some(1));
        assert_eq!(checkpoint_sensitive, 0);
        assert_eq!(lora_sensitive, 1);
    }

    #[test]
    fn dynamic_thumbnail_lookup_is_resource_type_scoped() {
        let conn = setup_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, thumbnail_path, model_hash, model_name, resolved_model_name)
             VALUES ('checkpoint-img', 'checkpoint.png', 500, 1, 'checkpoint.webp', 'checkpoint_hash', 'Portrait', 'Portrait')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, thumbnail_path)
             VALUES ('lora-img', 'lora.png', 100, 0, 'lora.webp')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('lora-img', 'Portrait')",
            [],
        )
        .unwrap();

        let lora_thumb = best_resource_thumbnail(&conn, "Portrait", "lora_Portrait", "loras", false)
            .expect("lora thumbnail");
        let checkpoint_thumb = best_resource_thumbnail(
            &conn,
            "Portrait",
            "checkpoint_hash",
            "checkpoint",
            false,
        )
        .expect("checkpoint thumbnail");

        assert_eq!(lora_thumb.path, "lora.webp");
        assert_eq!(lora_thumb.image_id.as_deref(), Some("lora-img"));
        assert_eq!(checkpoint_thumb.path, "checkpoint.webp");
        assert_eq!(checkpoint_thumb.image_id.as_deref(), Some("checkpoint-img"));
    }
}
