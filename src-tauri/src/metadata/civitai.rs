use crate::db::resolve_db_path;
use crate::metadata::models::{ModelCacheEntry, ModelResolutionState, ProgressPayload, ResolutionResult};
use reqwest::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Deserialize)]
pub struct CivitAiVersion {
    #[serde(rename = "model")]
    pub model: CivitAiModel,
    pub name: String,
    pub id: i64,
    #[serde(rename = "baseModel")]
    pub base_model: Option<String>,
    #[serde(rename = "trainedWords", default)]
    pub trained_words: Vec<String>,
}

#[derive(Deserialize)]
pub struct CivitAiModel {
    pub name: String,
    #[serde(rename = "type")]
    pub model_type: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub added: usize,
    pub total_found: usize,
    pub message: String,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn import_a1111_cache(
    app: tauri::AppHandle,
    cache_path: String,
) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(&cache_path).map_err(|e| e.to_string())?;

    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;
    let mut entries = Vec::new();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let mut debug_info = String::new();

    if let Some(hashes) = json.get("hashes") {
        if let Some(obj) = hashes.as_object() {
            for (key, val) in obj {
                if let Some(inner_obj) = val.as_object() {
                    if let Some(sha256) = inner_obj.get("sha256").and_then(|s| s.as_str()) {
                        let name = key.split(&['/', '\\'][..]).last().unwrap_or(key);
                        let short_hash = &sha256[..10];

                        entries.push(ModelCacheEntry {
                            hash: short_hash.to_string(),
                            name: name.to_string(),
                            filename: Some(name.to_string()),
                            lookup_source: "local_cache_flat".to_string(),
                            scanned_at: now,
                            thumbnail_path: None,
                            preview_url: None,
                            resource_type: Some("checkpoint".to_string()),
                        });
                        entries.push(ModelCacheEntry {
                            hash: sha256.to_string(),
                            name: name.to_string(),
                            filename: Some(name.to_string()),
                            lookup_source: "local_cache_flat".to_string(),
                            scanned_at: now,
                            thumbnail_path: None,
                            preview_url: None,
                            resource_type: Some("checkpoint".to_string()),
                        });
                    } else {
                        for (filename, data) in inner_obj {
                            if let Some(sha256) = data.get("sha256").and_then(|h| h.as_str()) {
                                let short_hash = &sha256[..10];
                                entries.push(ModelCacheEntry {
                                    hash: short_hash.to_string(),
                                    name: filename.clone(),
                                    filename: Some(filename.clone()),
                                    lookup_source: "local_cache_nested".to_string(),
                                    scanned_at: now,
                                    thumbnail_path: None,
                                    preview_url: None,
                                    resource_type: Some("checkpoint".to_string()),
                                });
                                entries.push(ModelCacheEntry {
                                    hash: sha256.to_string(),
                                    name: filename.clone(),
                                    filename: Some(filename.clone()),
                                    lookup_source: "local_cache_nested".to_string(),
                                    scanned_at: now,
                                    thumbnail_path: None,
                                    preview_url: None,
                                    resource_type: Some("checkpoint".to_string()),
                                });
                            }
                        }
                    }
                }
            }
        } else {
            debug_info.push_str("'hashes' is not an object. ");
        }
    } else {
        debug_info.push_str("No 'hashes' key. ");
        if let Some(obj) = json.as_object() {
            let mut added = 0;
            for (key, val) in obj {
                if let Some(v_str) = val.as_str() {
                    entries.push(ModelCacheEntry {
                        hash: key.clone(),
                        name: v_str.to_string(),
                        filename: None,
                        lookup_source: "local_cache_simple".to_string(),
                        scanned_at: now,
                        thumbnail_path: None,
                        preview_url: None,
                        resource_type: Some("checkpoint".to_string()),
                    });
                    added += 1;
                }
            }
            if added == 0 {
                debug_info.push_str("Fallback: top-level object was empty or had non-string values. ");
            }
        } else {
            debug_info.push_str("Root is not an object. ");
        }
    }

    if entries.is_empty() {
        return Ok(ImportResult {
            added: 0,
            total_found: 0,
            message: format!("No models found. {}", debug_info),
        });
    }

    let db_path = resolve_db_path(&app)?;
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut added_count = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO models (hash, name, filename, lookup_source, scanned_at, thumbnail_path, preview_url, resource_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
        ).map_err(|e| e.to_string())?;

        for entry in &entries {
            if let Ok(rows) = stmt.execute(params![
                entry.hash,
                entry.name,
                entry.filename,
                entry.lookup_source,
                entry.scanned_at,
                entry.thumbnail_path,
                entry.preview_url,
                entry.resource_type
            ]) {
                added_count += rows;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let added_unique = added_count / 2;
    let total_unique = if entries.first().map(|e| e.lookup_source.starts_with("local_cache")).unwrap_or(false) {
        entries.len() / 2
    } else {
        entries.len()
    };

    // CRITICAL FIX: Update the 'images' table to reflect the new resolved names immediately
    // models table has been updated, now sync images
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let _ = update_images_with_resolved_names(&conn);

    Ok(ImportResult {
        added: added_unique,
        total_found: total_unique,
        message: format!(
            "Imported {} new models ({} found in file).",
            added_unique, total_unique
        ),
    })
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn resolve_hashes_online(
    app: tauri::AppHandle,
    skip_harvest: bool,
    state: tauri::State<'_, ModelResolutionState>,
) -> Result<ResolutionResult, String> {
    state.is_cancelled.store(false, Ordering::SeqCst);

    let db_path = resolve_db_path(&app)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let mut harvest_count = 0;

    let hashes_to_resolve = {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;

        if !skip_harvest {
            let _ = app.emit(
                "model_resolution_progress",
                ProgressPayload {
                    current: 0,
                    total: 100,
                    message: "Harvesting existing local metadata...".to_string(),
                },
            );

            harvest_count = conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 SELECT DISTINCT 
                    COALESCE(json_extract(metadata_json, '$.modelHash'), 'name:' || json_extract(metadata_json, '$.model')), 
                    json_extract(metadata_json, '$.model'), 
                    'local_metadata', ?1, 'checkpoint'
                 FROM images 
                 WHERE (json_extract(metadata_json, '$.modelHash') IS NOT NULL OR json_extract(metadata_json, '$.model') IS NOT NULL)
                 AND json_extract(metadata_json, '$.model') IS NOT NULL",
                 params![now]
            ).unwrap_or(0);
        } else {
            let _ = app.emit(
                "model_resolution_progress",
                ProgressPayload {
                    current: 0,
                    total: 100,
                    message: "Skipping harvest, searching unknown hashes...".to_string(),
                },
            );
        }

        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT hash FROM (
                    SELECT DISTINCT json_extract(metadata_json, '$.modelHash') as hash 
                    FROM images 
                    WHERE hash IS NOT NULL 
                    AND hash NOT IN (SELECT hash FROM models)
                    
                    UNION
                    
                    SELECT hash FROM models 
                    WHERE civitai_version_id IS NULL 
                    AND (lookup_source != 'civitai_failed' OR (lookup_source = 'civitai_failed' AND scanned_at < datetime('now', '-1 day')))
                    AND hash NOT LIKE 'file:%'
                    AND hash NOT LIKE 'lora_%'
                    AND hash NOT LIKE 'emb_%'
                    AND hash NOT LIKE 'hyper_%'
                    AND hash NOT LIKE 'cnet_%'
                    AND hash NOT LIKE 'ipad_%'
                )",
            )
            .map_err(|e| e.to_string())?;

        let res = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|e| e.to_string())?;
        res
    };

    let total = hashes_to_resolve.len();

    // CRITICAL: Always sync images table, even if no NEW hashes to resolve.
    // This handles cases where models table is populated but images table is stale.
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let _ = update_images_with_resolved_names(&conn);

    if total == 0 {
        return Ok(ResolutionResult {
            resolved_count: harvest_count,
            failed_count: 0,
            named_fallback_count: 0,
            unknown_count: 0,
        });
    }

    let client = Client::new();
    let mut resolved_items = Vec::new();
    let mut failed_items = Vec::new();
    let mut failed = 0;

    for (i, hash) in hashes_to_resolve.into_iter().enumerate() {
        if state.is_cancelled.load(Ordering::SeqCst) {
            return Err("Resolution cancelled by user".to_string());
        }

        if i > 0 && i % 5 == 0 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        let _ = app.emit(
            "model_resolution_progress",
            ProgressPayload {
                current: i + 1,
                total,
                message: format!("Resolving online {}/{}", i + 1, total),
            },
        );

        let url = format!("https://civitai.com/api/v1/model-versions/by-hash/{}", hash);
        match client.get(&url).send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    if let Ok(version) = resp.json::<CivitAiVersion>().await {
                        let full_name = format!("{} {}", version.model.name, version.name);
                        
                        let r_type = match version.model.model_type.to_lowercase().as_str() {
                            "checkpoint" => "checkpoint",
                            "lora" | "lycoris" => "loras",
                            "textualinversion" => "embeddings",
                            "hypernetwork" => "hypernetworks",
                            "controlnet" => "control_nets",
                            _ => "checkpoint",
                        };

                        resolved_items.push((hash, full_name, version.id, r_type.to_string()));
                    } else {
                        failed += 1;
                        failed_items.push(hash);
                    }
                } else {
                    failed += 1;
                    failed_items.push(hash);
                }
            }
            Err(_) => {
                failed += 1;
                failed_items.push(hash);
            }
        }
    }

    let newly_resolved = resolved_items.len();
    let newly_failed = failed_items.len();

    if newly_resolved > 0 || newly_failed > 0 {
        let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // 1. Insert/Update Resolved Models
        for (hash, name, version_id, r_type) in resolved_items {
            let _ = tx.execute(
                "INSERT INTO models (hash, name, lookup_source, civitai_version_id, scanned_at, resource_type) 
                 VALUES (?1, ?2, 'civitai', ?3, ?4, ?5)
                 ON CONFLICT(hash) DO UPDATE SET 
                    name = excluded.name, 
                    lookup_source = 'civitai', 
                    civitai_version_id = excluded.civitai_version_id, 
                    resource_type = excluded.resource_type",
                params![hash, name, version_id, now, r_type]
            );
        }

        // 2. Insert/Update Failed Models (to prevent infinite retry loops)
        // We mark them as 'civitai_failed' and set a timestamp. 
        // Future logic could retry these after X days if needed.
        for hash in failed_items {
             let _ = tx.execute(
                "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 VALUES (?1, 'Unknown Model', 'civitai_failed', ?2, 'checkpoint')
                 ON CONFLICT(hash) DO UPDATE SET 
                    lookup_source = 'civitai_failed', 
                    scanned_at = excluded.scanned_at",
                params![hash, now]
            );
        }
        
        let _ = crate::metadata::models::classify_unlabeled_models(&tx);
        
        tx.commit().map_err(|e| e.to_string())?;

        // CRITICAL FIX: Update the 'images' table to reflect the new resolved names immediately
        // This ensures the UI updates without requiring a full re-scan
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        let _ = update_images_with_resolved_names(&conn);
    }

    let mut named_fallback = 0;
    let mut truly_unknown = 0;

    if failed > 0 {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT COUNT(DISTINCT json_extract(metadata_json, '$.modelHash')) 
             FROM images 
             WHERE json_extract(metadata_json, '$.modelHash') IS NOT NULL 
             AND json_extract(metadata_json, '$.modelHash') NOT IN (SELECT hash FROM models)
             AND json_extract(metadata_json, '$.model') IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;

        let fallback_count: usize = stmt.query_row([], |row| row.get(0)).unwrap_or(0);

        named_fallback = fallback_count;

        let mut stmt_unknown = conn
            .prepare(
                "SELECT COUNT(DISTINCT json_extract(metadata_json, '$.modelHash')) 
             FROM images 
             WHERE json_extract(metadata_json, '$.modelHash') IS NOT NULL 
             AND json_extract(metadata_json, '$.modelHash') NOT IN (SELECT hash FROM models)
             AND json_extract(metadata_json, '$.model') IS NULL",
            )
            .map_err(|e| e.to_string())?;

        truly_unknown = stmt_unknown.query_row([], |row| row.get(0)).unwrap_or(0);
    }

    Ok(ResolutionResult {
        resolved_count: harvest_count + newly_resolved,
        failed_count: failed,
        named_fallback_count: named_fallback,
        unknown_count: truly_unknown,
    })
}

/// Helper to sync the 'images.resolved_model_name' column with the 'models' table.
/// This fixes the issue where resolved hashes wouldn't show up in the UI until a re-scan.
fn update_images_with_resolved_names(conn: &Connection) -> Result<usize, rusqlite::Error> {
    log::info!("[CivitAI] Syncing resolved model names to images table...");
    
    // We update any image where the model_hash matches a known model, 
    // AND the current resolved_name is either missing or outdated.
    let count = conn.execute(
        "UPDATE images 
         SET resolved_model_name = (SELECT name FROM models WHERE models.hash = images.model_hash)
         WHERE model_hash IS NOT NULL 
         AND model_hash IN (SELECT hash FROM models)
         AND (
            resolved_model_name IS NULL 
            OR resolved_model_name = 'Unknown' 
            OR resolved_model_name != (SELECT name FROM models WHERE models.hash = images.model_hash)
         )",
        [],
    )?;
    
    log::info!("[CivitAI] Synced {} images with new model names.", count);
    Ok(count)
}
