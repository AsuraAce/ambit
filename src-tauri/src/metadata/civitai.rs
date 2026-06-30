use crate::db::resolve_db_path;
use crate::metadata::models::{
    ModelCacheEntry, ModelResolutionState, ProgressPayload, ResolutionResult,
};
use reqwest::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[derive(Deserialize)]
pub struct CivitAiVersion {
    #[serde(rename = "model")]
    pub model: CivitAiModel,
    pub name: String,
    pub id: i64,
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

const LOCAL_HASH_PREFIXES: [&str; 7] = [
    "name:", "file:", "lora_", "emb_", "hyper_", "cnet_", "ipad_",
];

fn is_online_resolvable_hash(hash: &str) -> bool {
    let trimmed = hash.trim();
    let normalized = trimmed.to_ascii_lowercase();
    !trimmed.is_empty()
        && !LOCAL_HASH_PREFIXES
            .iter()
            .any(|prefix| normalized.starts_with(prefix))
}

fn collect_hashes_to_resolve(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT hash FROM (
                SELECT DISTINCT i.model_hash as hash
                FROM images i
                WHERE i.model_hash IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM models m
                    WHERE m.hash = i.model_hash
                )

                UNION

                SELECT DISTINCT json_extract(i.metadata_json, '$.modelHash') as hash
                FROM images i
                WHERE json_extract(i.metadata_json, '$.modelHash') IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM models m
                    WHERE m.hash = json_extract(i.metadata_json, '$.modelHash')
                )

                UNION

                SELECT hash FROM models
                WHERE civitai_version_id IS NULL
                AND (
                    lookup_source IS NULL
                    OR lookup_source != 'civitai_failed'
                    OR (
                        lookup_source = 'civitai_failed'
                        AND (
                            scanned_at IS NULL
                            OR scanned_at < unixepoch('now', '-1 day')
                        )
                    )
                )
            )
            WHERE hash IS NOT NULL AND hash != ''",
        )
        .map_err(|e| e.to_string())?;

    let mut hashes = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|hash| hash.trim().to_string())
        .filter(|hash| is_online_resolvable_hash(hash))
        .collect::<Vec<_>>();

    hashes.sort();
    hashes.dedup();
    Ok(hashes)
}

fn count_unresolved_hashes(conn: &Connection) -> Result<(usize, usize), String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT i.model_hash, i.model_name
             FROM images i
             LEFT JOIN models m ON m.hash = i.model_hash
             WHERE i.model_hash IS NOT NULL
             AND i.model_hash != ''
             AND (m.hash IS NULL OR m.lookup_source = 'civitai_failed')",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut named_fallback = HashSet::new();
    let mut unknown = HashSet::new();

    for row in rows {
        let (hash, model_name) = row.map_err(|e| e.to_string())?;
        if !is_online_resolvable_hash(&hash) {
            continue;
        }

        if model_name
            .as_deref()
            .map(|name| !name.trim().is_empty())
            .unwrap_or(false)
        {
            named_fallback.insert(hash);
        } else {
            unknown.insert(hash);
        }
    }

    unknown.retain(|hash| !named_fallback.contains(hash));

    Ok((named_fallback.len(), unknown.len()))
}

fn open_configured_connection(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn normalize_sha256_hash(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.len() != 64 || !trimmed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }

    Some(trimmed.to_ascii_lowercase())
}

fn warn_malformed_sha256(name: &str) {
    log::warn!("[CivitAI] Skipping malformed SHA-256 cache hash for {name}");
}

fn model_cache_entry(
    hash: String,
    name: String,
    filename: Option<String>,
    lookup_source: &str,
    scanned_at: u64,
) -> ModelCacheEntry {
    ModelCacheEntry {
        hash,
        name,
        filename,
        lookup_source: lookup_source.to_string(),
        scanned_at,
        thumbnail_path: None,
        preview_url: None,
        resource_type: Some("checkpoint".to_string()),
    }
}

fn push_sha256_cache_entries(
    entries: &mut Vec<ModelCacheEntry>,
    sha256: &str,
    name: &str,
    filename: Option<&str>,
    lookup_source: &str,
    now: u64,
) -> bool {
    let Some(full_hash) = normalize_sha256_hash(sha256) else {
        warn_malformed_sha256(name);
        return false;
    };

    let short_hash = full_hash
        .get(..10)
        .expect("validated SHA-256 hash has a 10-character ASCII prefix")
        .to_string();
    let filename = filename.map(str::to_string);

    entries.push(model_cache_entry(
        short_hash,
        name.to_string(),
        filename.clone(),
        lookup_source,
        now,
    ));
    entries.push(model_cache_entry(
        full_hash,
        name.to_string(),
        filename,
        lookup_source,
        now,
    ));

    true
}

fn malformed_hash_note(skipped_malformed_hashes: usize) -> String {
    if skipped_malformed_hashes == 0 {
        String::new()
    } else if skipped_malformed_hashes == 1 {
        " Skipped 1 malformed SHA-256 hash entry.".to_string()
    } else {
        format!(" Skipped {skipped_malformed_hashes} malformed SHA-256 hash entries.")
    }
}

fn extract_a1111_cache_entries(
    json: &serde_json::Value,
    now: u64,
) -> (Vec<ModelCacheEntry>, String, usize) {
    let mut entries = Vec::new();
    let mut debug_info = String::new();
    let mut skipped_malformed_hashes = 0;

    if let Some(hashes) = json.get("hashes") {
        if let Some(obj) = hashes.as_object() {
            for (key, val) in obj {
                if let Some(inner_obj) = val.as_object() {
                    let mut used_flat_entry = false;
                    if let Some(sha256_value) = inner_obj.get("sha256") {
                        let name = key.split(&['/', '\\'][..]).last().unwrap_or(key);
                        if let Some(sha256) = sha256_value.as_str() {
                            if push_sha256_cache_entries(
                                &mut entries,
                                sha256,
                                name,
                                Some(name),
                                "local_cache_flat",
                                now,
                            ) {
                                used_flat_entry = true;
                            } else {
                                skipped_malformed_hashes += 1;
                            }
                        } else {
                            warn_malformed_sha256(name);
                            skipped_malformed_hashes += 1;
                        }
                    }

                    if !used_flat_entry {
                        for (filename, data) in inner_obj {
                            if filename == "sha256" {
                                continue;
                            }
                            if let Some(sha256_value) = data.get("sha256") {
                                if let Some(sha256) = sha256_value.as_str() {
                                    if !push_sha256_cache_entries(
                                        &mut entries,
                                        sha256,
                                        filename,
                                        Some(filename),
                                        "local_cache_nested",
                                        now,
                                    ) {
                                        skipped_malformed_hashes += 1;
                                    }
                                } else {
                                    warn_malformed_sha256(filename);
                                    skipped_malformed_hashes += 1;
                                }
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
                    entries.push(model_cache_entry(
                        key.clone(),
                        v_str.to_string(),
                        None,
                        "local_cache_simple",
                        now,
                    ));
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

    (entries, debug_info, skipped_malformed_hashes)
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
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let (entries, debug_info, skipped_malformed_hashes) =
        extract_a1111_cache_entries(&json, now);

    if entries.is_empty() {
        return Ok(ImportResult {
            added: 0,
            total_found: 0,
            message: format!(
                "No models found. {}{}",
                debug_info,
                malformed_hash_note(skipped_malformed_hashes)
            ),
        });
    }

    let db_path = resolve_db_path(&app)?;
    let mut conn = open_configured_connection(&db_path)?;
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
    let total_unique = if entries
        .first()
        .map(|e| e.lookup_source.starts_with("local_cache"))
        .unwrap_or(false)
    {
        entries.len() / 2
    } else {
        entries.len()
    };

    // CRITICAL FIX: Update the 'images' table to reflect the new resolved names immediately
    // models table has been updated, now sync images
    let conn = open_configured_connection(&db_path)?;
    let _ = update_images_with_resolved_names(&conn);

    Ok(ImportResult {
        added: added_unique,
        total_found: total_unique,
        message: format!(
            "Imported {} new models ({} found in file).{}",
            added_unique,
            total_unique,
            malformed_hash_note(skipped_malformed_hashes)
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
        let conn = open_configured_connection(&db_path)?;

        if !skip_harvest {
            let _ = app.emit(
                "model_resolution_progress",
                ProgressPayload {
                    current: 0,
                    total: 100,
                    message: "Harvesting existing local metadata...".to_string(),
                },
            );

            harvest_count += conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 SELECT DISTINCT 
                    'lora_' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(clean_name, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(clean_name, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    'harvest_lora', 
                    ?1,
                    'loras'
                 FROM (
                     SELECT 
                        CASE 
                            WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                            WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                            ELSE j.value 
                        END as clean_name
                     FROM images, json_each(metadata_json, '$.loras') j
                 ) 
                 WHERE clean_name IS NOT NULL AND clean_name != ''",
                params![now],
            )
            .map_err(|e| e.to_string())?;

            harvest_count += conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 SELECT DISTINCT 
                    'emb_' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    'harvest_embedding', 
                    ?1,
                    'embeddings'
                 FROM images, json_each(metadata_json, '$.embeddings') j
                 WHERE j.value IS NOT NULL AND j.value != ''",
                params![now],
            )
            .map_err(|e| e.to_string())?;

            harvest_count += conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 SELECT DISTINCT 
                    'hyper_' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    'harvest_hypernet', 
                    ?1,
                    'hypernetworks'
                 FROM images, json_each(metadata_json, '$.hypernetworks') j
                 WHERE j.value IS NOT NULL AND j.value != ''",
                params![now],
            )
            .map_err(|e| e.to_string())?;

            harvest_count += conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 SELECT DISTINCT 
                    COALESCE(json_extract(metadata_json, '$.modelHash'), 'name:' || json_extract(metadata_json, '$.model')), 
                    json_extract(metadata_json, '$.model'), 
                    'harvest_checkpoint', 
                    ?1,
                    'checkpoint'
                 FROM images
                 WHERE (json_extract(metadata_json, '$.modelHash') IS NOT NULL OR json_extract(metadata_json, '$.model') IS NOT NULL)
                 AND json_extract(metadata_json, '$.model') IS NOT NULL",
                params![now],
            )
            .map_err(|e| e.to_string())?;

            harvest_count += conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 SELECT DISTINCT 
                    'cnet_' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    'harvest_controlnet', 
                    ?1,
                    'control_nets'
                 FROM images, json_each(metadata_json, '$.controlNets') j
                 WHERE j.value IS NOT NULL AND j.value != ''",
                params![now],
            )
            .map_err(|e| e.to_string())?;

            harvest_count += conn.execute(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                 SELECT DISTINCT 
                    'ipad_' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(j.value, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''), 
                    'harvest_ipadapter', 
                    ?1,
                    'ip_adapters'
                 FROM images, json_each(metadata_json, '$.ipAdapters') j
                 WHERE j.value IS NOT NULL AND j.value != ''",
                params![now],
            )
            .map_err(|e| e.to_string())?;
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

        let _ = app.emit(
            "model_resolution_progress",
            ProgressPayload {
                current: 15,
                total: 100,
                message: "Collecting unresolved online hashes...".to_string(),
            },
        );

        collect_hashes_to_resolve(&conn)?
    };

    let total = hashes_to_resolve.len();

    // CRITICAL: Always sync images table, even if no NEW hashes to resolve.
    // This handles cases where models table is populated but images table is stale.
    let conn = open_configured_connection(&db_path)?;
    let _ = update_images_with_resolved_names(&conn);

    if total == 0 {
        let _ = app.emit(
            "model_resolution_progress",
            ProgressPayload {
                current: 100,
                total: 100,
                message: "No unresolved online hashes found.".to_string(),
            },
        );
        let (named_fallback_count, unknown_count) =
            count_unresolved_hashes(&conn).unwrap_or((0, 0));
        return Ok(ResolutionResult {
            resolved_count: 0,
            harvested_count: harvest_count,
            failed_count: 0,
            named_fallback_count,
            unknown_count,
        });
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resolved_items = Vec::new();
    let mut failed_items = Vec::new();

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
                        failed_items.push(hash);
                    }
                } else {
                    failed_items.push(hash);
                }
            }
            Err(_) => {
                failed_items.push(hash);
            }
        }
    }

    let newly_resolved = resolved_items.len();
    let newly_failed = failed_items.len();

    if newly_resolved > 0 || newly_failed > 0 {
        let mut conn = open_configured_connection(&db_path)?;
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
                 VALUES (
                    ?1,
                    COALESCE(
                        (
                            SELECT model_name
                            FROM images
                            WHERE model_hash = ?1
                            AND model_name IS NOT NULL
                            AND model_name != ''
                            ORDER BY timestamp DESC
                            LIMIT 1
                        ),
                        'Unknown Model'
                    ),
                    'civitai_failed',
                    ?2,
                    'checkpoint'
                 )
                 ON CONFLICT(hash) DO UPDATE SET 
                    lookup_source = 'civitai_failed',
                    scanned_at = excluded.scanned_at,
                    name = CASE
                        WHEN models.name IS NULL OR models.name = '' OR models.name = 'Unknown Model'
                        THEN excluded.name
                        ELSE models.name
                    END",
                params![hash, now]
            );
        }

        let _ = crate::metadata::models::classify_unlabeled_models(&tx);

        tx.commit().map_err(|e| e.to_string())?;

        // CRITICAL FIX: Update the 'images' table to reflect the new resolved names immediately
        // This ensures the UI updates without requiring a full re-scan
        let conn = open_configured_connection(&db_path)?;
        let _ = update_images_with_resolved_names(&conn);
    }

    let conn = open_configured_connection(&db_path)?;
    let (named_fallback, truly_unknown) = count_unresolved_hashes(&conn)?;

    Ok(ResolutionResult {
        resolved_count: newly_resolved,
        harvested_count: harvest_count,
        failed_count: newly_failed,
        named_fallback_count: named_fallback,
        unknown_count: truly_unknown,
    })
}

/// Helper to sync the 'images.resolved_model_name' column with the 'models' table.
/// This fixes the issue where resolved hashes wouldn't show up in the UI until a re-scan.
fn update_images_with_resolved_names(conn: &Connection) -> Result<usize, rusqlite::Error> {
    log::info!("[CivitAI] Syncing resolved model names to images table...");

    let fallback_count = conn.execute(
        "UPDATE images
         SET resolved_model_name = model_name
         WHERE model_name IS NOT NULL
         AND model_name != ''
         AND (
            resolved_model_name IS NULL
            OR resolved_model_name = ''
            OR resolved_model_name = 'Unknown'
            OR resolved_model_name = 'Unknown Model'
         )",
        [],
    )?;

    // We update any image where the model_hash matches a known non-failed model,
    // and the current resolved_name is either missing or outdated.
    let resolved_count = conn.execute(
        "UPDATE images 
         SET resolved_model_name = (
            SELECT m.name
            FROM models m
            WHERE m.hash = images.model_hash
            AND COALESCE(m.lookup_source, '') != 'civitai_failed'
            AND m.name != 'Unknown Model'
            LIMIT 1
         )
         WHERE model_hash IS NOT NULL 
         AND EXISTS (
            SELECT 1
            FROM models m
            WHERE m.hash = images.model_hash
            AND COALESCE(m.lookup_source, '') != 'civitai_failed'
            AND m.name != 'Unknown Model'
         )
         AND (
            resolved_model_name IS NULL 
            OR resolved_model_name = ''
            OR resolved_model_name = 'Unknown' 
            OR resolved_model_name = 'Unknown Model'
            OR resolved_model_name != (
                SELECT m.name
                FROM models m
                WHERE m.hash = images.model_hash
                AND COALESCE(m.lookup_source, '') != 'civitai_failed'
                AND m.name != 'Unknown Model'
                LIMIT 1
            )
         )",
        [],
    )?;

    let count = fallback_count + resolved_count;

    log::info!("[CivitAI] Synced {} images with new model names.", count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::init_db;
    use serde_json::json;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        for migration in init_db() {
            conn.execute_batch(&migration.sql).expect("apply migration");
        }
        conn
    }

    fn insert_image(
        conn: &Connection,
        id: &str,
        model_hash: &str,
        model_name: Option<&str>,
        resolved_model_name: Option<&str>,
    ) {
        let metadata_json = match model_name {
            Some(name) => json!({ "modelHash": model_hash, "model": name }).to_string(),
            None => json!({ "modelHash": model_hash }).to_string(),
        };

        conn.execute(
            "INSERT INTO images (
                id, path, timestamp, metadata_json, model_hash, model_name, resolved_model_name
             )
             VALUES (?1, ?2, 100, ?3, ?4, ?5, ?6)",
            params![
                id,
                format!("{id}.png"),
                metadata_json,
                model_hash,
                model_name,
                resolved_model_name
            ],
        )
        .expect("insert image");
    }

    fn repeated_hash(byte: char) -> String {
        std::iter::repeat(byte).take(64).collect()
    }

    #[test]
    fn valid_flat_cache_hash_creates_short_and_full_entries() {
        let full_hash = repeated_hash('a');
        let cache = json!({
            "hashes": {
                "C:\\models\\Dream.safetensors": {
                    "sha256": full_hash
                }
            }
        });

        let (entries, debug_info, skipped) = extract_a1111_cache_entries(&cache, 123);

        assert_eq!(debug_info, "");
        assert_eq!(skipped, 0);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].hash, "aaaaaaaaaa");
        assert_eq!(entries[1].hash, repeated_hash('a'));
        assert_eq!(entries[0].name, "Dream.safetensors");
        assert_eq!(entries[0].filename.as_deref(), Some("Dream.safetensors"));
        assert_eq!(entries[0].lookup_source, "local_cache_flat");
    }

    #[test]
    fn valid_nested_cache_hash_creates_short_and_full_entries() {
        let full_hash = repeated_hash('b');
        let cache = json!({
            "hashes": {
                "checkpoints": {
                    "Nested.safetensors": {
                        "sha256": full_hash
                    }
                }
            }
        });

        let (entries, debug_info, skipped) = extract_a1111_cache_entries(&cache, 456);

        assert_eq!(debug_info, "");
        assert_eq!(skipped, 0);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].hash, "bbbbbbbbbb");
        assert_eq!(entries[1].hash, repeated_hash('b'));
        assert_eq!(entries[0].name, "Nested.safetensors");
        assert_eq!(entries[0].filename.as_deref(), Some("Nested.safetensors"));
        assert_eq!(entries[0].lookup_source, "local_cache_nested");
    }

    #[test]
    fn uppercase_valid_cache_hash_is_normalized() {
        let full_hash = "ABCDEF0123456789".repeat(4);
        let cache = json!({
            "hashes": {
                "Upper.safetensors": {
                    "sha256": full_hash
                }
            }
        });

        let (entries, _debug_info, skipped) = extract_a1111_cache_entries(&cache, 789);

        assert_eq!(skipped, 0);
        assert_eq!(entries[0].hash, "abcdef0123");
        assert_eq!(entries[1].hash, "abcdef0123456789".repeat(4));
    }

    #[test]
    fn malformed_cache_hashes_are_skipped_without_panic() {
        let short = "a".repeat(63);
        let non_hex = "z".repeat(64);
        let unicode = "\u{00e9}".repeat(64);
        let cache = json!({
            "hashes": {
                "short.safetensors": { "sha256": short },
                "empty.safetensors": { "sha256": "" },
                "nonhex.safetensors": { "sha256": non_hex },
                "unicode.safetensors": { "sha256": unicode },
                "numeric.safetensors": { "sha256": 123 },
                "nested": {
                    "boolean.safetensors": { "sha256": false }
                }
            }
        });

        let (entries, debug_info, skipped) = extract_a1111_cache_entries(&cache, 123);

        assert_eq!(debug_info, "");
        assert_eq!(skipped, 6);
        assert!(
            entries.is_empty(),
            "malformed hashes should not produce model cache entries"
        );
    }

    #[test]
    fn malformed_flat_cache_hash_does_not_suppress_valid_nested_entries() {
        let valid = repeated_hash('d');
        let cache = json!({
            "hashes": {
                "mixed": {
                    "sha256": "not-a-sha256",
                    "ValidNested.safetensors": {
                        "sha256": valid
                    }
                }
            }
        });

        let (entries, debug_info, skipped) = extract_a1111_cache_entries(&cache, 123);

        assert_eq!(debug_info, "");
        assert_eq!(skipped, 1);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].hash, "dddddddddd");
        assert_eq!(entries[1].hash, repeated_hash('d'));
        assert_eq!(entries[0].name, "ValidNested.safetensors");
        assert_eq!(entries[0].lookup_source, "local_cache_nested");
    }

    #[test]
    fn mixed_cache_import_entries_keep_valid_hashes_and_report_skips() {
        let valid = repeated_hash('c');
        let invalid = "not-a-sha256";
        let cache = json!({
            "hashes": {
                "Valid.safetensors": {
                    "sha256": valid
                },
                "Invalid.safetensors": {
                    "sha256": invalid
                }
            }
        });

        let (entries, _debug_info, skipped) = extract_a1111_cache_entries(&cache, 123);
        let message = format!(
            "Imported {} new models ({} found in file).{}",
            entries.len() / 2,
            entries.len() / 2,
            malformed_hash_note(skipped)
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].hash, "cccccccccc");
        assert_eq!(entries[1].hash, repeated_hash('c'));
        assert_eq!(skipped, 1);
        assert!(message.contains("Skipped 1 malformed SHA-256 hash entry."));
    }

    #[test]
    fn simple_top_level_cache_format_is_unchanged() {
        let cache = json!({
            "abc123": "Simple Model"
        });

        let (entries, debug_info, skipped) = extract_a1111_cache_entries(&cache, 321);

        assert_eq!(debug_info, "No 'hashes' key. ");
        assert_eq!(skipped, 0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hash, "abc123");
        assert_eq!(entries[0].name, "Simple Model");
        assert_eq!(entries[0].lookup_source, "local_cache_simple");
    }

    #[test]
    fn pseudo_and_local_hashes_are_excluded_from_online_candidates() {
        let conn = setup_conn();
        for hash in [
            "abc123",
            "name:ParsedModel",
            "Name:UpperParsedModel",
            "file:C:/models/foo.safetensors",
            "lora_style",
            "LORA_upper",
            "emb_negative",
            "hyper_old",
            "cnet_pose",
            "ipad_face",
        ] {
            insert_image(&conn, hash, hash, Some("ParsedModel"), Some("ParsedModel"));
        }

        let hashes = collect_hashes_to_resolve(&conn).expect("collect hashes");

        assert_eq!(hashes, vec!["abc123".to_string()]);
    }

    #[test]
    fn failed_lookup_retry_uses_unix_second_cutoff() {
        let conn = setup_conn();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type)
             VALUES
                ('oldfailed', 'Old Failed', 'civitai_failed', ?1, 'checkpoint'),
                ('recentfailed', 'Recent Failed', 'civitai_failed', ?2, 'checkpoint'),
                ('nullfailed', 'Missing Timestamp Failed', 'civitai_failed', NULL, 'checkpoint'),
                ('name:oldfailed', 'Pseudo Failed', 'civitai_failed', ?1, 'checkpoint')",
            params![now - (2 * 24 * 60 * 60), now],
        )
        .expect("insert failed models");

        let hashes = collect_hashes_to_resolve(&conn).expect("collect hashes");

        assert_eq!(
            hashes,
            vec!["nullfailed".to_string(), "oldfailed".to_string()]
        );
    }

    #[test]
    fn civitai_failed_rows_do_not_overwrite_parsed_model_names() {
        let conn = setup_conn();
        insert_image(
            &conn,
            "img1",
            "failedhash",
            Some("Parsed Model"),
            Some("Parsed Model"),
        );
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type)
             VALUES ('failedhash', 'Unknown Model', 'civitai_failed', 1, 'checkpoint')",
            [],
        )
        .expect("insert failed model");

        update_images_with_resolved_names(&conn).expect("sync names");

        let resolved: String = conn
            .query_row(
                "SELECT resolved_model_name FROM images WHERE id = 'img1'",
                [],
                |row| row.get(0),
            )
            .expect("query resolved name");
        assert_eq!(resolved, "Parsed Model");
    }

    #[test]
    fn unknown_model_damage_is_repaired_to_parsed_model_name() {
        let conn = setup_conn();
        insert_image(
            &conn,
            "img1",
            "failedhash",
            Some("Parsed Model"),
            Some("Unknown Model"),
        );
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type)
             VALUES ('failedhash', 'Unknown Model', 'civitai_failed', 1, 'checkpoint')",
            [],
        )
        .expect("insert failed model");

        update_images_with_resolved_names(&conn).expect("sync names");

        let resolved: String = conn
            .query_row(
                "SELECT resolved_model_name FROM images WHERE id = 'img1'",
                [],
                |row| row.get(0),
            )
            .expect("query resolved name");
        assert_eq!(resolved, "Parsed Model");
    }
}
