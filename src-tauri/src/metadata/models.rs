use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use reqwest::blocking::Client;
use crate::db::resolve_db_path;
use serde_json;

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelCacheEntry {
    pub hash: String,
    pub name: String,
    pub filename: Option<String>,
    pub lookup_source: String,
    pub scanned_at: u64,
}

#[derive(Deserialize)]
struct CivitAiVersion {
    #[serde(rename = "model")]
    model: CivitAiModel,
    name: String,
    id: i64,
}

#[derive(Deserialize)]
struct CivitAiModel {
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    added: usize,
    total_found: usize,
    message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn import_a1111_cache(app: tauri::AppHandle, cache_path: String) -> Result<ImportResult, String> {
    let content = fs::read_to_string(&cache_path).map_err(|e| e.to_string())?;
    
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {}", e))?;
    let mut entries = Vec::new();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();

    let mut debug_info = String::new();

    if let Some(hashes) = json.get("hashes") {
        if let Some(obj) = hashes.as_object() {
            for (key, val) in obj {
                if let Some(inner_obj) = val.as_object() {
                    // Check if Flat structure: "checkpoint/foo": { "sha256": "..." }
                    if let Some(sha256) = inner_obj.get("sha256").and_then(|s| s.as_str()) {
                         let name = key.split(&['/', '\\'][..]).last().unwrap_or(key);
                         let short_hash = &sha256[..10];
                         
                         entries.push(ModelCacheEntry {
                            hash: short_hash.to_string(),
                            name: name.to_string(),
                            filename: Some(name.to_string()),
                            lookup_source: "local_cache_flat".to_string(),
                            scanned_at: now,
                        });
                        entries.push(ModelCacheEntry {
                            hash: sha256.to_string(),
                            name: name.to_string(),
                            filename: Some(name.to_string()),
                            lookup_source: "local_cache_flat".to_string(),
                            scanned_at: now,
                        });
                    } else {
                        // Check if Nested structure: "checkpoint": { "foo": { "sha256": "..." } }
                        for (filename, data) in inner_obj {
                            if let Some(sha256) = data.get("sha256").and_then(|h| h.as_str()) {
                                let short_hash = &sha256[..10];
                                entries.push(ModelCacheEntry {
                                    hash: short_hash.to_string(),
                                    name: filename.clone(),
                                    filename: Some(filename.clone()),
                                    lookup_source: "local_cache_nested".to_string(),
                                    scanned_at: now,
                                });
                                entries.push(ModelCacheEntry {
                                    hash: sha256.to_string(),
                                    name: filename.clone(),
                                    filename: Some(filename.clone()),
                                    lookup_source: "local_cache_nested".to_string(),
                                    scanned_at: now,
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
        // Fallback
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
        return Ok(ImportResult { added: 0, total_found: 0, message: format!("No models found. {}", debug_info) });
    }

    let db_path = resolve_db_path(&app)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut added_count = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO models (hash, name, filename, lookup_source, scanned_at) VALUES (?1, ?2, ?3, ?4, ?5)"
        ).map_err(|e| e.to_string())?;

        for entry in &entries {
             if let Ok(rows) = stmt.execute(params![entry.hash, entry.name, entry.filename, entry.lookup_source, entry.scanned_at]) {
                 added_count += rows;
             }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    
    // Divide by 2 because we insert 2 entries per model (short hash + long hash)
    let added_unique = added_count / 2;
    let total_unique = if entries.first().map(|e| e.lookup_source.starts_with("local_cache")).unwrap_or(false) {
        entries.len() / 2 
    } else {
        entries.len()
    };

    Ok(ImportResult { 
        added: added_unique, 
        total_found: total_unique,
        message: format!("Imported {} new models ({} found in file).", added_unique, total_unique) 
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionResult {
    resolved_count: usize,
    failed_count: usize,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    current: usize,
    total: usize,
    message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn resolve_hashes_online(app: tauri::AppHandle) -> Result<ResolutionResult, String> {
    use tauri::Emitter;

    let db_path = resolve_db_path(&app)?;
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();

    // 0. HARVEST: Populate model table from existing image metadata (Layer 0)
    let _ = app.emit("model_resolution_progress", ProgressPayload {
        current: 0,
        total: 100,
        message: "Harvesting existing local metadata...".to_string()
    });
    
    let harvest_count = conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at) 
         SELECT DISTINCT json_extract(metadata_json, '$.modelHash'), json_extract(metadata_json, '$.model'), 'local_metadata', ?1
         FROM images 
         WHERE json_extract(metadata_json, '$.modelHash') IS NOT NULL 
         AND json_extract(metadata_json, '$.model') IS NOT NULL",
         params![now]
    ).unwrap_or(0);
    
    // 1. Find all images with missing model names or hash-like model names
    // And where we don't have a resolution in the models table
    let mut stmt = conn.prepare(
        "SELECT DISTINCT json_extract(metadata_json, '$.modelHash') as hash 
         FROM images 
         WHERE hash IS NOT NULL 
         AND hash NOT IN (SELECT hash FROM models)"
    ).map_err(|e| e.to_string())?;

    let hashes_to_resolve: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    drop(stmt);

    let total = hashes_to_resolve.len();
    if total == 0 {
        return Ok(ResolutionResult { resolved_count: harvest_count, failed_count: 0 });
    }

    let client = Client::new();
    let mut resolved = harvest_count;
    let mut failed = 0;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (i, hash) in hashes_to_resolve.iter().enumerate() {
        // Rate limit kindness
        if i > 0 && i % 5 == 0 {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

        let _ = app.emit("model_resolution_progress", ProgressPayload {
            current: i + 1,
            total,
            message: format!("Resolving online {}/{}", i + 1, total)
        });

        let url = format!("https://civitai.com/api/v1/model-versions/by-hash/{}", hash);
        match client.get(&url).send() {
            Ok(resp) => {
                if resp.status().is_success() {
                    if let Ok(version) = resp.json::<CivitAiVersion>() {
                        let full_name = format!("{} {}", version.model.name, version.name);
                        tx.execute(
                            "INSERT OR IGNORE INTO models (hash, name, lookup_source, civitai_version_id, scanned_at) VALUES (?1, ?2, 'civitai', ?3, ?4)",
                            params![hash, full_name, version.id, now]
                        ).unwrap_or(0);
                        resolved += 1;
                    } else {
                        failed += 1;
                    }
                } else {
                    failed += 1; 
                }
            }
            Err(_) => {
                failed += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ResolutionResult { resolved_count: resolved, failed_count: failed })
}
