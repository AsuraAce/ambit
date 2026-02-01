use crate::db::resolve_db_path;
use crate::metadata::guidance::GuidanceClassifier;
use rusqlite::{params, Connection};
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
    let mut stmt = conn.prepare(
        "SELECT hash, name, resource_type FROM models 
         WHERE guidance_subtype IS NULL 
         AND resource_type IN ('checkpoint', 'control_nets', 'ip_adapters')"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    }).map_err(|e| e.to_string())?;

    let mut updates = Vec::new();
    for row in rows {
        if let Ok((hash, name, r_type)) = row {
            let should_classify = r_type != "checkpoint" || name.to_lowercase().contains("control") || name.to_lowercase().contains("ip-adapter");
            
            if should_classify {
                let h_param = if hash.starts_with("file:") || hash.starts_with("cnet_") || hash.starts_with("ipad_") { None } else { Some(hash.as_str()) };
                if let Some((cat, sub)) = GuidanceClassifier::classify(&name, h_param) {
                    updates.push((hash, cat.as_str().to_string(), sub));
                } else if r_type != "checkpoint" {
                    updates.push((hash, if r_type == "ip_adapters" { "IP-Adapter" } else { "ControlNet" }.to_string(), "other".to_string()));
                }
            }
        }
    }

    if !updates.is_empty() {
        let mut update_stmt = conn.prepare(
            "UPDATE models SET guidance_category = ?1, guidance_subtype = ?2 WHERE hash = ?3"
        ).map_err(|e| e.to_string())?;

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
    let name_val = model_name.clone().unwrap_or_else(|| "Unknown Model".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, thumbnail_path, resource_type) 
             VALUES (?1, ?5, 'manual_thumbnail', ?2, ?3, ?4)
             ON CONFLICT(hash) DO UPDATE SET thumbnail_path = ?3, resource_type = ?4, name = COALESCE(EXCLUDED.name, models.name)",
            params![
                model_hash, 
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(), 
                image_path,
                r_type,
                name_val
            ]
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE facet_cache SET thumbnail_path = ?1, is_manual = 1, is_user_override = 1 WHERE resource_hash = ?2",
            params![image_path, model_hash]
        ).map_err(|e| e.to_string())?;

        let name_to_use = if let Some(n) = model_name { Some(n) } else {
            conn.query_row("SELECT name FROM models WHERE hash = ?1", params![model_hash], |row| row.get(0)).ok()
        };

        if let Some(name) = name_to_use {
             conn.execute(
                "UPDATE facet_cache SET thumbnail_path = ?1, is_manual = 1, is_user_override = 1 WHERE resource_name = ?2",
                params![image_path, name]
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
) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        
        conn.execute("UPDATE models SET thumbnail_path = NULL, thumbnail_mode = NULL WHERE hash = ?1", params![model_hash]).map_err(|e| e.to_string())?;

        let (nm_opt, sidecar_path): (Option<String>, Option<String>) = conn.query_row(
            "SELECT name, sidecar_thumbnail_path FROM models WHERE hash = ?1", 
            params![model_hash], 
            |r| Ok((r.get(0).ok(), r.get(1).ok()))
        ).unwrap_or((model_name.clone(), None));

        let nm = nm_opt.or(model_name);

        if let Some(nm) = nm {
            let has_sidecar = sidecar_path.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
            let best_thumb = if has_sidecar { sidecar_path } else {
                conn.query_row(
                    "SELECT i.thumbnail_path FROM images i
                     LEFT JOIN image_loras il ON il.image_id = i.id
                     WHERE (i.model_hash = ?2 OR i.model_name = ?1 OR i.resolved_model_name = ?1 OR il.lora_name = ?1)
                     AND i.is_deleted = 0
                     ORDER BY i.is_pinned DESC, i.timestamp DESC LIMIT 1",
                    params![nm, model_hash], |r| r.get(0)
                ).ok()
            };

            let new_path = best_thumb.unwrap_or_default();
            let is_manual = if has_sidecar { 1 } else { 0 };
            
            conn.execute("UPDATE facet_cache SET thumbnail_path = ?1, is_manual = ?3, is_user_override = 0 WHERE resource_name = ?2", params![new_path.clone(), nm, is_manual]).map_err(|e| e.to_string())?;
            conn.execute("UPDATE facet_cache SET thumbnail_path = ?1, is_manual = ?3, is_user_override = 0 WHERE resource_hash = ?2", params![new_path, model_hash, is_manual]).map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        
        conn.execute("UPDATE models SET thumbnail_path = NULL, thumbnail_mode = 'dynamic' WHERE hash = ?1", params![model_hash]).map_err(|e| e.to_string())?;

        let nm_opt: Option<String> = model_name.clone().or_else(|| {
            conn.query_row("SELECT name FROM models WHERE hash = ?1", params![model_hash], |r| r.get(0)).ok()
        });

        if let Some(nm) = nm_opt {
            let dynamic_thumb: Option<String> = conn.query_row(
                "SELECT i.thumbnail_path FROM images i
                 LEFT JOIN image_loras il ON il.image_id = i.id
                 WHERE (i.model_hash = ?2 OR i.model_name = ?1 OR i.resolved_model_name = ?1 OR il.lora_name = ?1)
                 AND i.is_deleted = 0
                 ORDER BY i.is_pinned DESC, i.timestamp DESC LIMIT 1",
                params![nm, model_hash], |r| r.get(0)
            ).ok();

            let new_path = dynamic_thumb.unwrap_or_default();
            conn.execute("UPDATE facet_cache SET thumbnail_path = ?1, is_manual = 0, is_user_override = 0 WHERE resource_name = ?2", params![new_path.clone(), nm]).map_err(|e| e.to_string())?;
            conn.execute("UPDATE facet_cache SET thumbnail_path = ?1, is_manual = 0, is_user_override = 0 WHERE resource_hash = ?2", params![new_path, model_hash]).map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
