use std::collections::HashMap;
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

#[tauri::command(rename_all = "camelCase")]
pub fn import_a1111_cache(app: tauri::AppHandle, cache_path: String) -> Result<usize, String> {
    let content = fs::read_to_string(&cache_path).map_err(|e| e.to_string())?;
    
    // A1111 cache.json structure: 
    // { "hashes": { "checkpoint": { "hash1": { "mtime": ..., "sha256": ... }, ... } } }
    // Or simpler: { "hash1": "name1", ... } depending on version?
    // Actually, A1111 often uses `cache.json` which maps path -> hash info, OR `cache.json` in root which maps hash -> name?
    // Let's assume the classic { "hashes": { ... } } or simple key-value for now, but commonly it's:
    // "checkpoint": { "hash": { "name": ..., "sha256": ... } } 
    // Wait, let's look at a typical structure. 
    // Often: { "hashes": { "model-filename": { "mtime": 123, "sha256": "..." } } }
    // This maps File -> Hash. We need Hash -> File/Name. We can invert it.
    
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();

    if let Some(hashes) = json.get("hashes") {
        if let Some(checkpoints) = hashes.get("checkpoint") {
            if let Some(map) = checkpoints.as_object() {
                for (filename, data) in map {
                    if let Some(sha256) = data.get("sha256").and_then(|h| h.as_str()) {
                        // A1111 uses first 10 chars for short hash usually
                        let short_hash = &sha256[..10]; 
                        entries.push(ModelCacheEntry {
                            hash: short_hash.to_string(),
                            name: filename.clone(), // In A1111 cache, key is usually filename
                            filename: Some(filename.clone()),
                            lookup_source: "local_cache".to_string(),
                            scanned_at: now,
                        });
                        
                        // Also Add full hash just in case
                        entries.push(ModelCacheEntry {
                            hash: sha256.to_string(),
                            name: filename.clone(),
                            filename: Some(filename.clone()),
                            lookup_source: "local_cache".to_string(),
                            scanned_at: now,
                        });
                    }
                }
            }
        }
    } else {
        // Try fallback format: simple "hash": "name" map if expected
        if let Some(obj) = json.as_object() {
             for (key, val) in obj {
                 if let Some(v_str) = val.as_str() {
                     entries.push(ModelCacheEntry {
                         hash: key.clone(),
                         name: v_str.to_string(),
                         filename: None,
                         lookup_source: "local_cache_simple".to_string(),
                         scanned_at: now,
                     });
                 }
             }
        }
    }

    if entries.is_empty() {
        return Ok(0);
    }

    let db_path = resolve_db_path(&app)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let count = entries.len();
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO models (hash, name, filename, lookup_source, scanned_at) VALUES (?1, ?2, ?3, ?4, ?5)"
        ).map_err(|e| e.to_string())?;

        for entry in &entries {
            stmt.execute(params![entry.hash, entry.name, entry.filename, entry.lookup_source, entry.scanned_at]).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(count)
}

#[derive(Serialize)]
pub struct ResolutionResult {
    resolved_count: usize,
    failed_count: usize,
}

#[tauri::command(rename_all = "camelCase")]
pub fn resolve_hashes_online(app: tauri::AppHandle) -> Result<ResolutionResult, String> {
    let db_path = resolve_db_path(&app)?;
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    
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

    let client = Client::new();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    let mut resolved = 0;
    let mut failed = 0;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for hash in hashes_to_resolve {
        // Rate limit kindness
        if resolved > 0 && resolved % 5 == 0 {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }

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
