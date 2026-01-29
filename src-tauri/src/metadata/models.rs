use crate::db::resolve_db_path;
use crate::metadata::guidance::{GuidanceCategory, GuidanceClassifier};
use reqwest::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

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

#[derive(Deserialize)]
struct CivitAiVersion {
    #[serde(rename = "model")]
    model: CivitAiModel,
    name: String,
    id: i64,
    #[serde(rename = "baseModel")]
    base_model: Option<String>,
    #[serde(rename = "trainedWords", default)]
    trained_words: Vec<String>,
}

#[derive(Deserialize)]
struct CivitAiModel {
    name: String,
    #[serde(rename = "type")]
    model_type: String,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    added: usize,
    total_found: usize,
    message: String,
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
                        thumbnail_path: None,
                        preview_url: None,
                        resource_type: Some("checkpoint".to_string()),
                    });
                    added += 1;
                }
            }
            if added == 0 {
                debug_info
                    .push_str("Fallback: top-level object was empty or had non-string values. ");
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
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
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

    // Divide by 2 because we insert 2 entries per model (short hash + long hash)
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

    Ok(ImportResult {
        added: added_unique,
        total_found: total_unique,
        message: format!(
            "Imported {} new models ({} found in file).",
            added_unique, total_unique
        ),
    })
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionResult {
    resolved_count: usize,
    failed_count: usize,
    named_fallback_count: usize,
    unknown_count: usize,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    current: usize,
    total: usize,
    message: String,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn resolve_hashes_online(
    app: tauri::AppHandle,
    skip_harvest: bool,
    state: tauri::State<'_, ModelResolutionState>,
) -> Result<ResolutionResult, String> {
    use tauri::Emitter;

    // Reset cancellation state
    state.is_cancelled.store(false, Ordering::SeqCst);

    let db_path = resolve_db_path(&app)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let mut harvest_count = 0;

    // 1. Collect hashes and do initial harvest
    let hashes_to_resolve = {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        if !skip_harvest {
            // 0. HARVEST: Populate model table from existing image metadata (Layer 0)
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
                 SELECT DISTINCT json_extract(metadata_json, '$.modelHash'), json_extract(metadata_json, '$.model'), 'local_metadata', ?1, 'checkpoint'
                 FROM images 
                 WHERE json_extract(metadata_json, '$.modelHash') IS NOT NULL 
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

        // Find all hashes in models table that haven't been resolved yet
        // OR hashes found in images that aren't in models at all
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT hash FROM (
                    -- Hashes in images but not in models
                    SELECT DISTINCT json_extract(metadata_json, '$.modelHash') as hash 
                    FROM images 
                    WHERE hash IS NOT NULL 
                    AND hash NOT IN (SELECT hash FROM models)
                    
                    UNION
                    
                    -- Hashes in models that haven't been resolved online (and aren't local-only pseudo-hashes)
                    SELECT hash FROM models 
                    WHERE civitai_version_id IS NULL 
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
    let mut failed = 0;

    for (i, hash) in hashes_to_resolve.into_iter().enumerate() {
        // Check for cancellation
        if state.is_cancelled.load(Ordering::SeqCst) {
            return Err("Resolution cancelled by user".to_string());
        }

        // Rate limit kindness
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
                        
                        // Map Civitai type to our resource_type
                        let r_type = match version.model.model_type.to_lowercase().as_str() {
                            "checkpoint" => "checkpoint",
                            "lora" | "lycoris" => "loras",
                            "textualinversion" => "embeddings",
                            "hypernetwork" => "hypernetworks",
                            "controlnet" => "control_nets",
                            _ => "checkpoint", // Default
                        };

                        resolved_items.push((hash, full_name, version.id, r_type.to_string()));
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

    // 2. Save results and classify
    let newly_resolved = resolved_items.len();
    if newly_resolved > 0 {
        let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

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
        
        // Run classification on these new models
        let _ = classify_unlabeled_models(&tx);
        
        tx.commit().map_err(|e| e.to_string())?;
    }

    // 3. Post-Analysis: How many "failed" hashes actually have a name in the DB?
    let mut named_fallback = 0;
    let mut truly_unknown = 0;

    // Only analyze if we had failures
    if failed > 0 {
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        // Find hashes that are NOT in models table (failed lookups)
        // And check if they have a 'model' name in images table
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
        // Total Failures - Named Fallbacks = Truly Unknown (No hash match AND No name match)
        // We calculate truly_unknown based on total active failures in the library, not just this session's failures
        // But for this return value, 'failed' tracks session failures.
        // Let's rely on the DB query for truth.

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

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn clear_model_cache(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = resolve_db_path(&app)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM models", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub fn cancel_model_resolution(state: tauri::State<'_, ModelResolutionState>) {
    state.is_cancelled.store(true, Ordering::SeqCst);
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailScanResult {
    found: usize,
    updated: usize,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_model_thumbnails(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<ThumbnailScanResult, String> {
    let mut models_found = Vec::new();
    let mut images_map = std::collections::HashSet::new();

    for root_path in paths {
        let path_buf = std::path::PathBuf::from(root_path);
        if path_buf.exists() && path_buf.is_dir() {
            scan_dir_for_resources(&path_buf, &mut models_found, &mut images_map);
        }
    }

    if models_found.is_empty() {
        return Ok(ThumbnailScanResult {
            found: 0,
            updated: 0,
        });
    }

    let db_path = resolve_db_path(&app)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // 1. Harvest resource names from library if not already in models table
    harvest_resource_names(&mut conn, now)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut updated_count = 0;

    {
        // 2. Full Discovery: Upsert all found models into the database
        let mut upsert_stmt = tx.prepare_cached(
            "INSERT INTO models (hash, name, filename, lookup_source, scanned_at, resource_type) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(hash) DO UPDATE SET filename = excluded.filename, resource_type = excluded.resource_type WHERE filename IS NULL OR filename = ''"
        ).map_err(|e| e.to_string())?;

        for model_path in &models_found {
            let model_path_buf = std::path::PathBuf::from(model_path);
            let filename = model_path_buf
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let stem = model_path_buf
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");

            // Infer type from path
            let path_lower = model_path.to_lowercase();
            let r_type = if path_lower.contains("lora") {
                "loras"
            } else if path_lower.contains("embedding") {
                "embeddings"
            } else if path_lower.contains("hypernetwork") {
                "hypernetworks"
            } else if path_lower.contains("controlnet") || path_lower.contains("control_") {
                "control_nets"
            } else if path_lower.contains("ipadapter") || path_lower.contains("ip-adapter") {
                "ip_adapters"
            } else {
                "checkpoint"
            };

            // For full discovery, we try to use the real SHA256 hash if possible
            // This allows online resolution to work for local files.
            let hash = match calculate_sha256(&model_path_buf) {
                Ok(h) => h,
                Err(_) => format!("file:{}", model_path),
            };

            let _ = upsert_stmt.execute(params![
                hash,
                stem,
                filename,
                "disk_scan",
                now,
                r_type
            ]);
        }

        // 3. Match Thumbnails - write to sidecar slot (disk scan is never a user override)
        let mut update_stmt = tx.prepare_cached(
            "UPDATE models SET sidecar_thumbnail_path = ?1 WHERE (filename = ?2 COLLATE NOCASE OR name = ?3 COLLATE NOCASE OR name = ?4 COLLATE NOCASE) AND (sidecar_thumbnail_path IS NULL OR sidecar_thumbnail_path = '')"
        ).map_err(|e| e.to_string())?;

        for model_path in &models_found {
            let model_path_buf = std::path::PathBuf::from(&model_path);

            let parent = match model_path_buf.parent() {
                Some(p) => p,
                None => continue,
            };

            let stem = match model_path_buf.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s,
                None => continue,
            };

            let filename = match model_path_buf.file_name().and_then(|s| s.to_str()) {
                Some(n) => n,
                None => continue,
            };

            let candidates = [
                format!("{}.preview.png", stem),
                format!("{}.png", stem),
                format!("{}.jpg", stem),
                format!("{}.webp", stem),
                format!("{}.jpeg", stem),
            ];

            let mut best_thumb: Option<String> = None;

            for cand_name in candidates {
                let candidate_path = parent.join(&cand_name).to_string_lossy().to_string();
                if images_map.contains(&candidate_path) {
                    best_thumb = Some(candidate_path);
                    break;
                }
            }

            if let Some(thumb_path) = best_thumb {
                if let Ok(rows) = update_stmt.execute(params![thumb_path, filename, stem, filename])
                {
                    if rows > 0 {
                        updated_count += 1;
                    }
                }
            }
        }
    }

    // Classify any newly discovered guidance models
    let _ = classify_unlabeled_models(&tx);

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ThumbnailScanResult {
        found: models_found.len(),
        updated: updated_count,
    })
}

// Helper function override
fn scan_dir_for_resources(
    dir: &std::path::Path,
    models: &mut Vec<String>,
    images: &mut std::collections::HashSet<String>,
) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                scan_dir_for_resources(&p, models, images);
            } else if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["safetensors", "ckpt", "pt", "bin", "pth"].contains(&ext.as_str()) {
                    models.push(p.to_string_lossy().to_string());
                } else if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    images.insert(p.to_string_lossy().to_string());
                }
            }
        }
    }
}

fn harvest_resource_names(conn: &mut Connection, now: u64) -> Result<(), String> {
    // 1. Loras
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
         SELECT DISTINCT 
            'lora_' || clean_name, 
            clean_name, 
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

    // 2. Embeddings
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
         SELECT DISTINCT 
            'emb_' || j.value, 
            j.value, 
            'harvest_embedding', 
            ?1,
            'embeddings'
         FROM images, json_each(metadata_json, '$.embeddings') j
         WHERE j.value IS NOT NULL AND j.value != ''",
        params![now],
    )
    .map_err(|e| e.to_string())?;

    // 3. Hypernetworks
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
         SELECT DISTINCT 
            'hyper_' || j.value, 
            j.value, 
            'harvest_hypernet', 
            ?1,
            'hypernetworks'
         FROM images, json_each(metadata_json, '$.hypernetworks') j
         WHERE j.value IS NOT NULL AND j.value != ''",
        params![now],
    )
    .map_err(|e| e.to_string())?;

    // 4. Checkpoints
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
         SELECT DISTINCT 
            json_extract(metadata_json, '$.modelHash'), 
            json_extract(metadata_json, '$.model'), 
            'harvest_checkpoint', 
            ?1,
            'checkpoint'
         FROM images
         WHERE json_extract(metadata_json, '$.modelHash') IS NOT NULL 
         AND json_extract(metadata_json, '$.model') IS NOT NULL",
        params![now],
    )
    .map_err(|e| e.to_string())?;
    
    // 5. ControlNets
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
         SELECT DISTINCT 
            'cnet_' || j.value, 
            j.value, 
            'harvest_controlnet', 
            ?1,
            'control_nets'
         FROM images, json_each(metadata_json, '$.controlNets') j
         WHERE j.value IS NOT NULL AND j.value != ''",
        params![now],
    )
    .map_err(|e| e.to_string())?;

    // 6. IP-Adapters
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
         SELECT DISTINCT 
            'ipad_' || j.value, 
            j.value, 
            'harvest_ipadapter', 
            ?1,
            'ip_adapters'
         FROM images, json_each(metadata_json, '$.ipAdapters') j
         WHERE j.value IS NOT NULL AND j.value != ''",
        params![now],
    )
    .map_err(|e| e.to_string())?;

    // 7. CLASSIFY: Run guidance classifier on un-classified items
    classify_unlabeled_models(conn)?;

    Ok(())
}

fn classify_unlabeled_models(conn: &Connection) -> Result<(), String> {
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
            // Only try to classify if it's not a checkpoint, OR if it has a suspicious name
            let should_classify = r_type != "checkpoint" || name.to_lowercase().contains("control") || name.to_lowercase().contains("ip-adapter");
            
            if should_classify {
                let h_param = if hash.starts_with("file:") || hash.starts_with("cnet_") || hash.starts_with("ipad_") { None } else { Some(hash.as_str()) };
                if let Some((cat, sub)) = GuidanceClassifier::classify(&name, h_param) {
                    updates.push((hash, cat.as_str().to_string(), sub));
                } else if r_type != "checkpoint" {
                    // It's a guidance resource but we couldn't sub-classify it
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

fn calculate_sha256(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::fs::File;
    use std::io::{BufReader, Read};

    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536];

    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Ok(hex::encode(hasher.finalize()))
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

    // Default to checkpoint if not provided, but sanitize just in case
    let r_type = resource_type.unwrap_or_else(|| "checkpoint".to_string());

    // Default name if missing
    let name_val = model_name
        .clone()
        .unwrap_or_else(|| "Unknown Model".to_string());

    // Perform blocking DB operations on a thread
    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        // 1. Update Models Table (Source of Truth for Manual Thumbnails)
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, thumbnail_path, resource_type) 
             VALUES (?1, ?5, 'manual_thumbnail', ?2, ?3, ?4)
             ON CONFLICT(hash) DO UPDATE SET thumbnail_path = ?3, resource_type = ?4, name = COALESCE(EXCLUDED.name, models.name)",
            params![
                model_hash, 
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(), 
                image_path,
                r_type,
                name_val
            ]
        ).map_err(|e| e.to_string())?;

        // 2. Immediate Feedback: Update Facet Cache
        // Update by hash (primary match)
        conn.execute(
            "UPDATE facet_cache SET thumbnail_path = ?1, is_manual = 1, is_user_override = 1 WHERE resource_hash = ?2",
            params![image_path, model_hash]
        ).map_err(|e| e.to_string())?;

        // Update by name (fallback and for merging fake-hash rows)
        let name_to_use = if let Some(n) = model_name {
            Some(n)
        } else {
            conn.query_row(
                "SELECT name FROM models WHERE hash = ?1",
                params![model_hash],
                |row| row.get(0)
            ).ok()
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
    // "Use Sidecar / Reset" - clears user override, falls back to sidecar > dynamic > preview_url
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        
        // 1. Clear user override (thumbnail_path) AND reset thumbnail_mode to auto
        // This allows sidecar to be used again
        conn.execute(
            "UPDATE models SET thumbnail_path = NULL, thumbnail_mode = NULL WHERE hash = ?1",
            params![model_hash]
        ).map_err(|e| e.to_string())?;

        // 2. Resolve Name and get sidecar path
        let (nm_opt, sidecar_path): (Option<String>, Option<String>) = conn.query_row(
            "SELECT name, sidecar_thumbnail_path FROM models WHERE hash = ?1", 
            params![model_hash], 
            |r| Ok((r.get(0).ok(), r.get(1).ok()))
        ).unwrap_or((model_name.clone(), None));

        let nm = nm_opt.or(model_name);

        if let Some(nm) = nm {
            // 3. Determine best thumbnail: Sidecar > Dynamic
            let has_sidecar = sidecar_path.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
            let best_thumb = if has_sidecar {
                sidecar_path // Use sidecar if available (moved here)
            } else {
                // Fall back to dynamic (Pinned > Recent)
                conn.query_row(
                    "SELECT i.thumbnail_path 
                     FROM images i
                     LEFT JOIN image_loras il ON il.image_id = i.id
                     WHERE (i.model_hash = ?2 OR i.model_name = ?1 OR i.resolved_model_name = ?1 OR il.lora_name = ?1)
                     AND i.is_deleted = 0
                     ORDER BY i.is_pinned DESC, i.timestamp DESC
                     LIMIT 1",
                    params![nm, model_hash],
                    |r| r.get(0)
                ).ok()
            };

            let new_path = best_thumb.unwrap_or_default();
            
            // 4. Update Facet Cache - is_manual = 1 if sidecar, 0 if dynamic
            let is_manual = if has_sidecar { 1 } else { 0 };
            
            conn.execute(
                "UPDATE facet_cache SET thumbnail_path = ?1, is_manual = ?3, is_user_override = 0 WHERE resource_name = ?2",
                params![new_path.clone(), nm, is_manual]
            ).map_err(|e| e.to_string())?;
            
            conn.execute(
                "UPDATE facet_cache SET thumbnail_path = ?1, is_manual = ?3, is_user_override = 0 WHERE resource_hash = ?2",
                params![new_path, model_hash, is_manual]
            ).map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

/// "Use Dynamic" - forces dynamic thumbnail selection without destroying sidecar data
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
        
        // 1. Set thumbnail_mode to 'dynamic' - this tells the system to skip sidecar
        // We DON'T clear sidecar_thumbnail_path so it can be recovered later
        conn.execute(
            "UPDATE models SET thumbnail_path = NULL, thumbnail_mode = 'dynamic' WHERE hash = ?1",
            params![model_hash]
        ).map_err(|e| e.to_string())?;

        // 2. Resolve Name
        let nm_opt: Option<String> = model_name.clone().or_else(|| {
            conn.query_row("SELECT name FROM models WHERE hash = ?1", params![model_hash], |r| r.get(0)).ok()
        });

        if let Some(nm) = nm_opt {
            // 3. Find best dynamic thumbnail (Pinned > Recent)
            let dynamic_thumb: Option<String> = conn.query_row(
                "SELECT i.thumbnail_path 
                 FROM images i
                 LEFT JOIN image_loras il ON il.image_id = i.id
                 WHERE (i.model_hash = ?2 OR i.model_name = ?1 OR i.resolved_model_name = ?1 OR il.lora_name = ?1)
                 AND i.is_deleted = 0
                 ORDER BY i.is_pinned DESC, i.timestamp DESC
                 LIMIT 1",
                params![nm, model_hash],
                |r| r.get(0)
            ).ok();

            let new_path = dynamic_thumb.unwrap_or_default();
            
            // 4. Update Facet Cache - is_manual = 0 (dynamic)
            conn.execute(
                "UPDATE facet_cache SET thumbnail_path = ?1, is_manual = 0, is_user_override = 0 WHERE resource_name = ?2",
                params![new_path.clone(), nm]
            ).map_err(|e| e.to_string())?;
            
            conn.execute(
                "UPDATE facet_cache SET thumbnail_path = ?1, is_manual = 0, is_user_override = 0 WHERE resource_hash = ?2",
                params![new_path, model_hash]
            ).map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
