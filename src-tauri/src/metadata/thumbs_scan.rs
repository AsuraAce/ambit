use crate::db::resolve_db_path;
use crate::metadata::models::{ModelDiscoveryState, ProgressPayload, ThumbnailScanResult};
use rusqlite::{params, Connection};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_model_thumbnails(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, ModelDiscoveryState>,
) -> Result<ThumbnailScanResult, String> {
    state.is_cancelled.store(false, Ordering::SeqCst);

    let mut models_found = Vec::new();
    let mut images_map = std::collections::HashSet::new();

    let total_paths = paths.len();
    for (i, root_path) in paths.iter().enumerate() {
        if state.is_cancelled.load(Ordering::SeqCst) {
            return Err("Discovery scan cancelled by user".to_string());
        }

        let _ = app.emit(
            "discovery_scan_progress",
            ProgressPayload {
                current: i,
                total: total_paths,
                message: format!("Searching: {}", root_path),
            },
        );

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

    let _ = app.emit(
        "discovery_scan_progress",
        ProgressPayload {
            current: 0,
            total: 100,
            message: "Saving discovered models...".to_string(),
        },
    );

    let db_path = resolve_db_path(&app)?;
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    crate::db::configure_connection(&conn).map_err(|e| e.to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    harvest_resource_names(&mut conn, now)?;

    let mut updated_count = 0;

    {
        let mut upsert_stmt = conn.prepare_cached(
            "INSERT INTO models (hash, name, filename, lookup_source, scanned_at, resource_type) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(hash) DO UPDATE SET filename = excluded.filename, resource_type = excluded.resource_type WHERE filename IS NULL OR filename = ''"
        ).map_err(|e| e.to_string())?;

        let mut cache_select_stmt = conn.prepare_cached(
            "SELECT hash FROM scanned_files WHERE path = ?1 AND size = ?2 AND modified = ?3"
        ).map_err(|e| e.to_string())?;

        let mut cache_insert_stmt = conn.prepare_cached(
            "INSERT OR REPLACE INTO scanned_files (path, size, modified, hash) VALUES (?1, ?2, ?3, ?4)"
        ).map_err(|e| e.to_string())?;

        let _ = app.emit(
            "discovery_scan_progress",
            ProgressPayload {
                current: 0,
                total: models_found.len(),
                message: format!("Found {} candidates. Registering...", models_found.len()),
            },
        );

        let mut last_emit = std::time::Instant::now();

        for (i, model_path) in models_found.iter().enumerate() {
            let model_path_buf = std::path::PathBuf::from(model_path);
            let filename = model_path_buf
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let stem = model_path_buf
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");

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

            let (file_size, file_modified) = match std::fs::metadata(&model_path_buf) {
                Ok(m) => (
                    m.len() as i64,
                    m.modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0),
                ),
                Err(_) => (0, 0),
            };

            let cached_hash: Option<String> = cache_select_stmt
                .query_row(params![model_path, file_size, file_modified], |row| row.get(0))
                .ok();

            let hash = if let Some(h) = cached_hash {
                h
            } else {
                if state.is_cancelled.load(Ordering::SeqCst) {
                    return Err("Discovery scan cancelled by user".to_string());
                }
                
                let _ = app.emit(
                    "discovery_scan_progress",
                    ProgressPayload {
                        current: i + 1,
                        total: models_found.len(),
                        message: format!("Hashing: {}", filename),
                    },
                );
                last_emit = std::time::Instant::now(); 

                if state.is_cancelled.load(Ordering::SeqCst) {
                     return Err("Discovery scan cancelled by user".to_string());
                }
                let h = format!("file:{}", model_path);

                let _ = cache_insert_stmt.execute(params![model_path, file_size, file_modified, &h]);
                h
            };

            let _ = upsert_stmt.execute(params![
                hash,
                stem,
                filename,
                "disk_scan",
                now,
                r_type
            ]);

            if last_emit.elapsed().as_millis() > 200 || i == models_found.len() - 1 {
                 if state.is_cancelled.load(Ordering::SeqCst) {
                    return Err("Discovery scan cancelled by user".to_string());
                }
                let _ = app.emit(
                    "discovery_scan_progress",
                    ProgressPayload {
                        current: i + 1,
                        total: models_found.len(),
                        message: format!("Registering: {}", filename),
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }

        let _ = app.emit(
            "discovery_scan_progress",
            ProgressPayload {
                current: 0,
                total: models_found.len(),
                message: "Linking thumbnails...".to_string(),
            },
        );

        let mut update_stmt = conn.prepare_cached(
            "UPDATE models SET sidecar_thumbnail_path = ?1 WHERE (filename = ?2 COLLATE NOCASE OR name = ?3 COLLATE NOCASE OR name = ?4 COLLATE NOCASE) AND (sidecar_thumbnail_path IS NULL OR sidecar_thumbnail_path = '')"
        ).map_err(|e| e.to_string())?;

        for (i, model_path) in models_found.iter().enumerate() {
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
                format!("{}.preview.jpg", stem),
                format!("{}.preview.webp", stem),
                format!("{}.png", stem),
                format!("{}.jpg", stem),
                format!("{}.webp", stem),
                format!("{}.jpeg", stem),
                format!("{}.png", filename),
                format!("{}.jpg", filename),
                format!("{}.webp", filename),
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

            if last_emit.elapsed().as_millis() > 200 || i == models_found.len() - 1 {
                if state.is_cancelled.load(Ordering::SeqCst) {
                    return Err("Discovery scan cancelled by user".to_string());
                }
                let _ = app.emit(
                    "discovery_scan_progress",
                    ProgressPayload {
                        current: i + 1,
                        total: models_found.len(),
                        message: format!("Matching: {}", filename),
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }
    }

    let _ = crate::metadata::models::classify_unlabeled_models(&conn);
    
    let _ = refresh_facet_cache_from_models(&conn);

    Ok(ThumbnailScanResult {
        found: models_found.len(),
        updated: updated_count,
    })
}

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

pub fn harvest_resource_names(conn: &mut Connection, now: u64) -> Result<(), String> {
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

    conn.execute(
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

    crate::metadata::models::classify_unlabeled_models(conn)?;

    Ok(())
}

pub fn refresh_facet_cache_from_models(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE facet_cache 
         SET thumbnail_path = (SELECT sidecar_thumbnail_path FROM models WHERE models.hash = facet_cache.resource_hash),
             has_sidecar = 1,
             is_manual = 1
         WHERE resource_hash IN (SELECT hash FROM models WHERE sidecar_thumbnail_path IS NOT NULL AND sidecar_thumbnail_path != '')
         AND (is_user_override IS NULL OR is_user_override = 0)",
        params![],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE facet_cache 
         SET thumbnail_path = (SELECT m.sidecar_thumbnail_path 
                               FROM models m 
                               WHERE m.name = facet_cache.resource_name 
                               AND m.sidecar_thumbnail_path IS NOT NULL 
                               AND m.sidecar_thumbnail_path != ''
                               LIMIT 1),
             has_sidecar = 1,
             is_manual = 1
         WHERE resource_name IN (SELECT name FROM models WHERE sidecar_thumbnail_path IS NOT NULL AND sidecar_thumbnail_path != '')
         AND (thumbnail_path IS NULL OR thumbnail_path = '')
         AND (is_user_override IS NULL OR is_user_override = 0)",
        params![],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}
