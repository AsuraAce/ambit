use super::{configure_connection, resolve_db_path, ProgressPayload};
use regex::Regex;
use rusqlite::{params, types::Value, OptionalExtension};
use std::collections::BTreeSet;
use tauri::Emitter;

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_facet_cache(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        println!("[FacetCache] Starting rebuild...");
        let _ = app.emit(
            "facet_cache_progress",
            ProgressPayload {
                current: 0,
                total: 8,
                message: "Starting facet cache build...".into(),
            },
        );

        // --- PHASE 1: HARVEST ---
        {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            println!("[FacetCache] Harvesting models from images...");
            let start_harvest = std::time::Instant::now();
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 1,
                    total: 8,
                    message: "Harvesting models from library...".into(),
                },
            );

            harvest_models(&tx)?;

            tx.commit().map_err(|e| e.to_string())?;
            println!(
                "[FacetCache] Harvest completed in {:?}.",
                start_harvest.elapsed()
            );
        }

        // --- PHASE 2: BUILD CACHE ---
        let count_result = {
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            // Clear existing cache
            tx.execute("DELETE FROM facet_cache", [])
                .map_err(|e| e.to_string())?;

            // 1. Checkpoints
            println!("[FacetCache] Building checkpoints...");
            let start_cp = std::time::Instant::now();
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 2,
                    total: 8,
                    message: "Building checkpoints cache...".into(),
                },
            );
            build_checkpoint_facets(&tx)?;
            println!(
                "[FacetCache] Checkpoints built in {:?}.",
                start_cp.elapsed()
            );

            // 2. LoRAs
            println!("[FacetCache] Building LoRAs...");
            let start_lora = std::time::Instant::now();
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 3,
                    total: 8,
                    message: "Building LoRAs cache...".into(),
                },
            );
            build_resource_facets(&tx, "loras", "loras")?;
            println!("[FacetCache] LoRAs built in {:?}.", start_lora.elapsed());

            // 3. Embeddings
            println!("[FacetCache] Building Embeddings...");
            let start_emb = std::time::Instant::now();
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 4,
                    total: 8,
                    message: "Building Embeddings cache...".into(),
                },
            );
            build_resource_facets(&tx, "embeddings", "embeddings")?;
            println!(
                "[FacetCache] Embeddings built in {:?}.",
                start_emb.elapsed()
            );

            // 4. Hypernetworks
            println!("[FacetCache] Building Hypernetworks...");
            let start_hyper = std::time::Instant::now();
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 5,
                    total: 8,
                    message: "Building Hypernetworks cache...".into(),
                },
            );
            build_resource_facets(&tx, "hypernetworks", "hypernetworks")?;
            println!(
                "[FacetCache] Hypernetworks built in {:?}.",
                start_hyper.elapsed()
            );

            // 5. Tools
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 6,
                    total: 8,
                    message: "Building tools cache...".into(),
                },
            );
            build_tool_facets(&tx)?;

            // 6. ControlNets
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 7,
                    total: 8,
                    message: "Building ControlNet cache...".into(),
                },
            );
            build_resource_facets(&tx, "control_nets", "control_nets")?;

            // 7. IP-Adapters
            let _ = app.emit(
                "facet_cache_progress",
                ProgressPayload {
                    current: 8,
                    total: 8,
                    message: "Building IP-Adapter cache...".into(),
                },
            );
            build_resource_facets(&tx, "ip_adapters", "ip_adapters")?;

            tx.commit().map_err(|e| e.to_string())?;

            // Return total cache entries
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row.get(0))
                .map_err(|e| e.to_string())?;

            // Update stats after rebuild
            let _ = conn.execute("ANALYZE facet_cache", []);
            let _ = conn.execute("ANALYZE models", []);

            count
        };

        println!(
            "[FacetCache] Rebuild complete in {:?}. Total entries: {}",
            start_total.elapsed(),
            count_result
        );
        let _ = app.emit(
            "facet_cache_progress",
            ProgressPayload {
                current: 8,
                total: 8,
                message: "Cache rebuild complete.".into(),
            },
        );

        Ok(count_result as usize)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_facet_cache_incremental(
    app: tauri::AppHandle,
    facet_type: String,
) -> Result<usize, String> {
    rebuild_facet_cache_incremental_batch(app, vec![facet_type]).await
}

fn normalize_facet_type(facet_type: &str) -> Result<&'static str, String> {
    match facet_type {
        "checkpoints" => Ok("checkpoints"),
        "tools" => Ok("tools"),
        "loras" => Ok("loras"),
        "embeddings" => Ok("embeddings"),
        "hypernetworks" => Ok("hypernetworks"),
        "controlNets" | "control_nets" => Ok("control_nets"),
        "ipAdapters" | "ip_adapters" => Ok("ip_adapters"),
        _ => Err(format!(
            "Unknown facet type for incremental build: {}",
            facet_type
        )),
    }
}

#[derive(Debug, Clone, Default, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FacetResourceTouches {
    pub checkpoints: Vec<String>,
    pub loras: Vec<String>,
    pub embeddings: Vec<String>,
    pub hypernetworks: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone)]
struct FacetStats {
    count: i64,
    last_used_at: Option<i64>,
    created_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct FacetThumb {
    image_id: String,
    thumbnail_path: String,
    privacy_hidden: i64,
}

#[derive(Debug, Clone)]
struct FacetModelSource {
    name: String,
    hash: Option<String>,
    thumbnail_path: Option<String>,
    sidecar_thumbnail_path: Option<String>,
    preview_url: Option<String>,
    thumbnail_mode: Option<String>,
    guidance_subtype: Option<String>,
    thumbnail_sensitivity_override: Option<i64>,
}

#[derive(Debug, Clone, Copy)]
struct ResourceFacetConfig {
    facet_type: &'static str,
    resource_type: &'static str,
    junction_table: &'static str,
    name_col: &'static str,
    hash_prefix: &'static str,
    harvest_source: &'static str,
}

fn clean_live_resource_name(raw: &str) -> Option<String> {
    let mut name = raw.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let weighted_index = name.find(" (");
    let colon_index = name.find(':');
    let cut_index = [weighted_index, colon_index]
        .into_iter()
        .flatten()
        .filter(|index| *index > 0)
        .min();

    if let Some(index) = cut_index {
        name.truncate(index);
        name = name.trim().to_string();
    }

    let lower = name.to_lowercase();
    for suffix in [".safetensors", ".ckpt", ".pt", ".bin", ".pth"] {
        if lower.ends_with(suffix) {
            let new_len = name.len().saturating_sub(suffix.len());
            name.truncate(new_len);
            name = name.trim().to_string();
            break;
        }
    }

    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn normalize_live_names(names: &[String], fallback: Option<&str>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();

    if names.is_empty() {
        return normalized;
    }

    for name in names {
        if let Some(cleaned) = clean_live_resource_name(name) {
            let key = cleaned.to_lowercase();
            if seen.insert(key) {
                normalized.push(cleaned);
            }
        }
    }

    if normalized.is_empty() {
        if let Some(fallback) = fallback {
            normalized.push(fallback.to_string());
        }
    }

    normalized
}

fn resource_config(facet_type: &str) -> Result<ResourceFacetConfig, String> {
    match facet_type {
        "loras" => Ok(ResourceFacetConfig {
            facet_type: "loras",
            resource_type: "loras",
            junction_table: "image_loras",
            name_col: "lora_name",
            hash_prefix: "lora_",
            harvest_source: "harvest_lora",
        }),
        "embeddings" => Ok(ResourceFacetConfig {
            facet_type: "embeddings",
            resource_type: "embeddings",
            junction_table: "image_embeddings",
            name_col: "embedding_name",
            hash_prefix: "emb_",
            harvest_source: "harvest_embedding",
        }),
        "hypernetworks" => Ok(ResourceFacetConfig {
            facet_type: "hypernetworks",
            resource_type: "hypernetworks",
            junction_table: "image_hypernetworks",
            name_col: "hypernetwork_name",
            hash_prefix: "hyper_",
            harvest_source: "harvest_hypernet",
        }),
        "control_nets" => Ok(ResourceFacetConfig {
            facet_type: "control_nets",
            resource_type: "control_nets",
            junction_table: "image_controlnets",
            name_col: "controlnet_name",
            hash_prefix: "cnet_",
            harvest_source: "harvest_controlnet",
        }),
        "ip_adapters" => Ok(ResourceFacetConfig {
            facet_type: "ip_adapters",
            resource_type: "ip_adapters",
            junction_table: "image_ipadapters",
            name_col: "ipadapter_name",
            hash_prefix: "ipad_",
            harvest_source: "harvest_ip_adapter",
        }),
        _ => Err(format!("Unsupported resource facet type: {}", facet_type)),
    }
}

fn privacy_keyword_matches(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let matches: i64 = conn
        .query_row(
            "SELECT EXISTS (
                SELECT 1 FROM privacy_mask_keywords k
                WHERE LOWER(?1) LIKE '%' || k.keyword || '%'
            )",
            [name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(matches != 0)
}

fn manual_thumbnail_image(
    conn: &rusqlite::Connection,
    thumbnail_path: &str,
) -> Result<Option<(String, i64)>, String> {
    conn.query_row(
        "SELECT id, COALESCE(privacy_hidden, 0)
         FROM images
         WHERE id = ?1 OR path = ?1 OR thumbnail_path = ?1
         LIMIT 1",
        [thumbnail_path],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn compute_thumbnail_fields(
    conn: &rusqlite::Connection,
    model: &FacetModelSource,
    dynamic_thumb: Option<&FacetThumb>,
    safe_thumb: Option<&FacetThumb>,
) -> Result<(Option<String>, Option<String>, Option<String>, i64), String> {
    let manual_thumb = model
        .thumbnail_path
        .as_deref()
        .filter(|value| !value.is_empty());
    let sidecar_thumb = model
        .sidecar_thumbnail_path
        .as_deref()
        .filter(|value| !value.is_empty());
    let preview_url = model
        .preview_url
        .as_deref()
        .filter(|value| !value.is_empty());
    let dynamic_path = dynamic_thumb.map(|thumb| thumb.thumbnail_path.as_str());
    let thumbnail_mode = model.thumbnail_mode.as_deref();

    let thumbnail_path = if let Some(path) = manual_thumb {
        Some(path.to_string())
    } else if thumbnail_mode == Some("dynamic") {
        dynamic_path.or(preview_url).map(str::to_string)
    } else {
        sidecar_thumb
            .or(dynamic_path)
            .or(preview_url)
            .map(str::to_string)
    };

    let manual_image = match manual_thumb {
        Some(path) => manual_thumbnail_image(conn, path)?,
        None => None,
    };
    let thumbnail_image_id = if manual_thumb.is_some() {
        manual_image.as_ref().map(|(id, _)| id.clone())
    } else {
        dynamic_thumb.map(|thumb| thumb.image_id.clone())
    };

    let sensitive = if model.thumbnail_sensitivity_override == Some(0) {
        0
    } else if model.thumbnail_sensitivity_override == Some(1) {
        1
    } else if privacy_keyword_matches(conn, &model.name)? {
        1
    } else if manual_thumb.is_some() {
        manual_image.map(|(_, hidden)| hidden).unwrap_or(1)
    } else if thumbnail_mode == Some("dynamic") {
        dynamic_thumb.map(|thumb| thumb.privacy_hidden).unwrap_or(0)
    } else if sidecar_thumb.is_some() || preview_url.is_some() {
        1
    } else {
        dynamic_thumb.map(|thumb| thumb.privacy_hidden).unwrap_or(0)
    };

    Ok((
        thumbnail_path,
        safe_thumb.map(|thumb| thumb.thumbnail_path.clone()),
        thumbnail_image_id,
        sensitive,
    ))
}

fn insert_facet_row(
    conn: &rusqlite::Connection,
    facet_type: &str,
    model: &FacetModelSource,
    stats: &FacetStats,
    dynamic_thumb: Option<&FacetThumb>,
    safe_thumb: Option<&FacetThumb>,
) -> Result<(), String> {
    let (thumbnail_path, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive) =
        compute_thumbnail_fields(conn, model, dynamic_thumb, safe_thumb)?;
    let has_sidecar = model
        .sidecar_thumbnail_path
        .as_ref()
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    let is_user_override = model
        .thumbnail_path
        .as_ref()
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    let is_manual = is_user_override || (has_sidecar && model.thumbnail_mode.is_none());

    conn.execute(
        "INSERT INTO facet_cache (
            facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url,
            last_used_at, created_at, is_manual, has_sidecar, is_user_override,
            guidance_subtype, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive,
            thumbnail_sensitivity_override
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            facet_type,
            &model.name,
            &model.hash,
            stats.count,
            &thumbnail_path,
            &model.preview_url,
            stats.last_used_at,
            stats.created_at,
            if is_manual { 1 } else { 0 },
            if has_sidecar { 1 } else { 0 },
            if is_user_override { 1 } else { 0 },
            &model.guidance_subtype,
            &safe_thumbnail_path,
            &thumbnail_image_id,
            thumbnail_is_sensitive,
            model.thumbnail_sensitivity_override
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn select_model_source(
    conn: &rusqlite::Connection,
    resource_type: &str,
    name: &str,
) -> Result<Option<FacetModelSource>, String> {
    conn.query_row(
        "SELECT name, hash, thumbnail_path, sidecar_thumbnail_path, preview_url,
                thumbnail_mode, guidance_subtype, thumbnail_sensitivity_override
         FROM models
         WHERE resource_type = ?1 AND LOWER(name) = LOWER(?2)
         ORDER BY CASE WHEN name = ?2 THEN 0 ELSE 1 END
         LIMIT 1",
        params![resource_type, name],
        |row| {
            Ok(FacetModelSource {
                name: row.get(0)?,
                hash: row.get(1)?,
                thumbnail_path: row.get(2)?,
                sidecar_thumbnail_path: row.get(3)?,
                preview_url: row.get(4)?,
                thumbnail_mode: row.get(5)?,
                guidance_subtype: row.get(6)?,
                thumbnail_sensitivity_override: row.get(7)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn fallback_model_source(
    name: &str,
    hash: Option<String>,
    guidance_subtype: Option<String>,
) -> FacetModelSource {
    FacetModelSource {
        name: name.to_string(),
        hash,
        thumbnail_path: None,
        sidecar_thumbnail_path: None,
        preview_url: None,
        thumbnail_mode: None,
        guidance_subtype,
        thumbnail_sensitivity_override: None,
    }
}

fn query_checkpoint_stats(
    conn: &rusqlite::Connection,
    name: &str,
    is_unknown: bool,
) -> Result<FacetStats, String> {
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(FacetStats {
            count: row.get(0)?,
            last_used_at: row.get(1)?,
            created_at: row.get(2)?,
        })
    };

    if is_unknown {
        conn.query_row(
            "SELECT COUNT(*), MAX(timestamp), MIN(timestamp)
             FROM images
             WHERE is_deleted = 0
             AND COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') = 'Unknown'",
            [],
            map_row,
        )
    } else {
        conn.query_row(
            "SELECT COUNT(*), MAX(timestamp), MIN(timestamp)
             FROM images
             WHERE is_deleted = 0
             AND resolved_model_name = ?1",
            params![name],
            map_row,
        )
    }
    .map_err(|e| e.to_string())
}

fn query_checkpoint_thumb(
    conn: &rusqlite::Connection,
    name: &str,
    is_unknown: bool,
    safe_only: bool,
) -> Result<Option<FacetThumb>, String> {
    let privacy_filter = if safe_only {
        "AND privacy_hidden = 0"
    } else {
        ""
    };
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(FacetThumb {
            image_id: row.get(0)?,
            thumbnail_path: row.get(1)?,
            privacy_hidden: row.get(2)?,
        })
    };

    if is_unknown {
        conn.query_row(
            &format!(
                "SELECT id, thumbnail_path, COALESCE(privacy_hidden, 0)
                 FROM images
                 WHERE is_deleted = 0
                 {privacy_filter}
                 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
                 AND COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') = 'Unknown'
                 ORDER BY is_pinned DESC, timestamp DESC
                 LIMIT 1"
            ),
            [],
            map_row,
        )
    } else {
        conn.query_row(
            &format!(
                "SELECT id, thumbnail_path, COALESCE(privacy_hidden, 0)
                 FROM images
                 WHERE is_deleted = 0
                 {privacy_filter}
                 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
                 AND resolved_model_name = ?1
                 ORDER BY is_pinned DESC, timestamp DESC
                 LIMIT 1"
            ),
            params![name],
            map_row,
        )
    }
    .optional()
    .map_err(|e| e.to_string())
}

fn query_checkpoint_hash(
    conn: &rusqlite::Connection,
    name: &str,
    is_unknown: bool,
) -> Result<Option<String>, String> {
    if is_unknown {
        conn.query_row(
            "SELECT model_hash
             FROM images
             WHERE is_deleted = 0
             AND model_hash IS NOT NULL AND model_hash != ''
             AND COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') = 'Unknown'
             ORDER BY timestamp DESC
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
    } else {
        conn.query_row(
            "SELECT model_hash
             FROM images
             WHERE is_deleted = 0
             AND model_hash IS NOT NULL AND model_hash != ''
             AND resolved_model_name = ?1
             ORDER BY timestamp DESC
             LIMIT 1",
            params![name],
            |row| row.get::<_, String>(0),
        )
    }
    .optional()
    .map_err(|e| e.to_string())
}

fn refresh_checkpoint_facet(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let started_at = std::time::Instant::now();
    conn.execute(
        "DELETE FROM facet_cache WHERE facet_type = 'checkpoints' AND LOWER(resource_name) = LOWER(?1)",
        [name],
    )
    .map_err(|e| e.to_string())?;

    let is_unknown = name == "Unknown";
    let stats = query_checkpoint_stats(conn, name, is_unknown)?;

    let model = select_model_source(conn, "checkpoint", name)?;
    if stats.count == 0 && model.is_none() {
        println!(
            "[FacetCache] Resource refresh checkpoints:{} removed in {:?}.",
            name,
            started_at.elapsed()
        );
        return Ok(false);
    }

    let dynamic_thumb = query_checkpoint_thumb(conn, name, is_unknown, false)?;
    let safe_thumb = query_checkpoint_thumb(conn, name, is_unknown, true)?;
    let model_hash = query_checkpoint_hash(conn, name, is_unknown)?;

    let source = model.unwrap_or_else(|| fallback_model_source(name, model_hash, None));
    insert_facet_row(
        conn,
        "checkpoints",
        &source,
        &stats,
        dynamic_thumb.as_ref(),
        safe_thumb.as_ref(),
    )?;

    println!(
        "[FacetCache] Resource refresh checkpoints:{} completed in {:?}.",
        source.name,
        started_at.elapsed()
    );
    Ok(true)
}

fn refresh_tool_facet(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    let started_at = std::time::Instant::now();
    conn.execute(
        "DELETE FROM facet_cache WHERE facet_type = 'tools' AND resource_name = ?1",
        [name],
    )
    .map_err(|e| e.to_string())?;

    let stats = conn
        .query_row(
            "SELECT COUNT(*), MAX(timestamp), MIN(timestamp)
             FROM images
             WHERE is_deleted = 0 AND COALESCE(tool, 'Unknown') = ?1",
            [name],
            |row| {
                Ok(FacetStats {
                    count: row.get(0)?,
                    last_used_at: row.get(1)?,
                    created_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    if stats.count == 0 {
        println!(
            "[FacetCache] Resource refresh tools:{} removed in {:?}.",
            name,
            started_at.elapsed()
        );
        return Ok(false);
    }

    let source = fallback_model_source(name, None, None);
    insert_facet_row(conn, "tools", &source, &stats, None, None)?;

    println!(
        "[FacetCache] Resource refresh tools:{} completed in {:?}.",
        name,
        started_at.elapsed()
    );
    Ok(true)
}

fn refresh_resource_facet(
    conn: &rusqlite::Connection,
    config: ResourceFacetConfig,
    name: &str,
    now: u64,
) -> Result<bool, String> {
    let started_at = std::time::Instant::now();

    conn.execute(
        "DELETE FROM facet_cache WHERE facet_type = ?1 AND LOWER(resource_name) = LOWER(?2)",
        params![config.facet_type, name],
    )
    .map_err(|e| e.to_string())?;

    let match_started_at = std::time::Instant::now();
    conn.execute("DROP TABLE IF EXISTS live_resource_matches", [])
        .map_err(|e| e.to_string())?;
    let matches_sql = format!(
        "CREATE TEMP TABLE live_resource_matches AS
         SELECT
            i.id,
            i.timestamp,
            COALESCE(i.is_pinned, 0) AS is_pinned,
            i.thumbnail_path,
            COALESCE(i.privacy_hidden, 0) AS privacy_hidden
         FROM {} jt
         JOIN images i ON i.id = jt.image_id
         WHERE i.is_deleted = 0 AND jt.{} = ?1",
        config.junction_table, config.name_col
    );
    conn.execute(&matches_sql, [name])
        .map_err(|e| e.to_string())?;
    let match_ms = match_started_at.elapsed();

    let stats_started_at = std::time::Instant::now();
    let stats = conn
        .query_row(
            "SELECT COUNT(DISTINCT id), MAX(timestamp), MIN(timestamp)
             FROM live_resource_matches",
            [],
            |row| {
                Ok(FacetStats {
                    count: row.get(0)?,
                    last_used_at: row.get(1)?,
                    created_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    let stats_ms = stats_started_at.elapsed();

    let model_started_at = std::time::Instant::now();
    if stats.count > 0 {
        conn.execute(
            "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                format!("{}{}", config.hash_prefix, name),
                name,
                config.harvest_source,
                now as i64,
                config.resource_type
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let model = select_model_source(conn, config.resource_type, name)?;
    let model_ms = model_started_at.elapsed();
    if stats.count == 0 && model.is_none() {
        conn.execute("DROP TABLE IF EXISTS live_resource_matches", [])
            .ok();
        println!(
            "[FacetCache] Resource refresh {}:{} removed in {:?}. Timings: match={:?}, stats={:?}, model={:?}.",
            config.facet_type,
            name,
            started_at.elapsed(),
            match_ms,
            stats_ms,
            model_ms
        );
        return Ok(false);
    }

    let thumb_started_at = std::time::Instant::now();
    let dynamic_thumb = conn
        .query_row(
            "SELECT i.id, i.thumbnail_path, COALESCE(i.privacy_hidden, 0)
         FROM live_resource_matches i
         WHERE i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
         ORDER BY i.is_pinned DESC, i.timestamp DESC
         LIMIT 1",
            [],
            |row| {
                Ok(FacetThumb {
                    image_id: row.get(0)?,
                    thumbnail_path: row.get(1)?,
                    privacy_hidden: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let safe_thumb = conn
        .query_row(
            "SELECT i.id, i.thumbnail_path, COALESCE(i.privacy_hidden, 0)
         FROM live_resource_matches i
         WHERE i.privacy_hidden = 0
         AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
         ORDER BY i.is_pinned DESC, i.timestamp DESC
         LIMIT 1",
            [],
            |row| {
                Ok(FacetThumb {
                    image_id: row.get(0)?,
                    thumbnail_path: row.get(1)?,
                    privacy_hidden: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let thumb_ms = thumb_started_at.elapsed();

    let source = model.unwrap_or_else(|| {
        fallback_model_source(name, Some(format!("{}{}", config.hash_prefix, name)), None)
    });
    let insert_started_at = std::time::Instant::now();
    insert_facet_row(
        conn,
        config.facet_type,
        &source,
        &stats,
        dynamic_thumb.as_ref(),
        safe_thumb.as_ref(),
    )?;
    let insert_ms = insert_started_at.elapsed();
    conn.execute("DROP TABLE IF EXISTS live_resource_matches", [])
        .ok();

    println!(
        "[FacetCache] Resource refresh {}:{} completed in {:?}. Timings: match={:?}, stats={:?}, model={:?}, thumbs={:?}, insert={:?}.",
        config.facet_type,
        source.name,
        started_at.elapsed(),
        match_ms,
        stats_ms,
        model_ms,
        thumb_ms,
        insert_ms
    );
    Ok(true)
}

fn refresh_resource_names(
    conn: &rusqlite::Connection,
    facet_type: &str,
    names: &[String],
    now: u64,
) -> Result<usize, String> {
    let normalized_names = normalize_live_names(names, None);
    if normalized_names.is_empty() {
        return Ok(0);
    }

    let config = resource_config(facet_type)?;
    let mut refreshed = 0;
    for name in normalized_names {
        if refresh_resource_facet(conn, config, &name, now)? {
            refreshed += 1;
        }
    }

    Ok(refreshed)
}

fn refresh_live_facet_resources(
    conn: &mut rusqlite::Connection,
    touches: &FacetResourceTouches,
) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut refreshed = 0;

    for name in normalize_live_names(&touches.checkpoints, Some("Unknown")) {
        if refresh_checkpoint_facet(&tx, &name)? {
            refreshed += 1;
        }
    }
    refreshed += refresh_resource_names(&tx, "loras", &touches.loras, now)?;
    refreshed += refresh_resource_names(&tx, "embeddings", &touches.embeddings, now)?;
    refreshed += refresh_resource_names(&tx, "hypernetworks", &touches.hypernetworks, now)?;
    refreshed += refresh_resource_names(&tx, "control_nets", &touches.control_nets, now)?;
    refreshed += refresh_resource_names(&tx, "ip_adapters", &touches.ip_adapters, now)?;
    for name in normalize_live_names(&touches.tools, Some("Unknown")) {
        if refresh_tool_facet(&tx, &name)? {
            refreshed += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(refreshed)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn refresh_facet_cache_for_resources(
    app: tauri::AppHandle,
    touches: FacetResourceTouches,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        let refreshed = refresh_live_facet_resources(&mut conn, &touches)?;
        println!(
            "[FacetCache] Resource incremental refresh complete in {:?}. Rows refreshed: {}",
            start_total.elapsed(),
            refreshed
        );

        Ok(refreshed)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn rebuild_incremental_facet_types(
    conn: &mut rusqlite::Connection,
    facet_types: &[String],
) -> Result<Vec<String>, String> {
    let mut normalized_types: Vec<String> = Vec::new();

    for facet_type in facet_types {
        let db_facet_type = normalize_facet_type(facet_type)?.to_string();
        if !normalized_types.contains(&db_facet_type) {
            normalized_types.push(db_facet_type);
        }
    }

    if normalized_types.is_empty() {
        return Ok(Vec::new());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Modeling harvesting ensures any new models from recent image imports/edits are in 'models' table
    harvest_models(&tx)?;

    for db_facet_type in &normalized_types {
        let facet_started_at = std::time::Instant::now();

        tx.execute(
            "DELETE FROM facet_cache WHERE facet_type = ?1",
            [db_facet_type],
        )
        .map_err(|e| e.to_string())?;

        match db_facet_type.as_str() {
            "checkpoints" => build_checkpoint_facets(&tx)?,
            "tools" => build_tool_facets(&tx)?,
            "loras" => build_resource_facets(&tx, "loras", "loras")?,
            "embeddings" => build_resource_facets(&tx, "embeddings", "embeddings")?,
            "hypernetworks" => build_resource_facets(&tx, "hypernetworks", "hypernetworks")?,
            "control_nets" => build_resource_facets(&tx, "control_nets", "control_nets")?,
            "ip_adapters" => build_resource_facets(&tx, "ip_adapters", "ip_adapters")?,
            _ => unreachable!("facet types are normalized before rebuild"),
        }

        println!(
            "[FacetCache] Incremental rebuild for {} completed in {:?}.",
            db_facet_type,
            facet_started_at.elapsed()
        );
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(normalized_types)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_facet_cache_incremental_batch(
    app: tauri::AppHandle,
    facet_types: Vec<String>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        let normalized_types = rebuild_incremental_facet_types(&mut conn, &facet_types)?;

        let mut total_count = 0_i64;
        for db_facet_type in &normalized_types {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM facet_cache WHERE facet_type = ?1",
                    [db_facet_type],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            total_count += count;
        }

        println!(
            "[FacetCache] Incremental rebuild complete in {:?}. Facets: {:?}. Total entries: {}",
            start_total.elapsed(),
            normalized_types,
            total_count
        );

        Ok(total_count as usize)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Valid facet names result - used for drill-down filtering
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ValidFacetNames {
    pub checkpoints: Vec<String>,
    pub loras: Vec<String>,
    pub embeddings: Vec<String>,
    pub hypernetworks: Vec<String>,
    pub tools: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
}

/// Get distinct facet names that exist in the current filtered result set.
/// This is used for drill-down filtering - hiding facets that have no images
/// in the current filter context.
///
/// OPTIMIZATION: Uses a single UNION ALL query instead of 5 separate queries
/// to reduce database round-trips and allow SQLite to share table scans.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_valid_facet_names(
    app: tauri::AppHandle,
    where_clause: String,
    params_json: String,
    collection_id: Option<String>,
    lora_name: Option<String>,
) -> Result<ValidFacetNames, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        let sql_params = parse_facet_params_json(&params_json)?;
        get_valid_facet_names_for_query(
            &conn,
            &where_clause,
            sql_params,
            collection_id.as_deref(),
            lora_name.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parse_facet_params_json(params_json: &str) -> Result<Vec<Value>, String> {
    let params: Vec<serde_json::Value> = serde_json::from_str(params_json)
        .map_err(|e| format!("Invalid valid-facet params JSON: {}", e))?;

    Ok(params
        .into_iter()
        .map(|p| match p {
            serde_json::Value::String(s) => Value::Text(s),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Value::Integer(i)
                } else if let Some(f) = n.as_f64() {
                    Value::Real(f)
                } else {
                    Value::Null
                }
            }
            serde_json::Value::Bool(b) => Value::Integer(if b { 1 } else { 0 }),
            serde_json::Value::Null => Value::Null,
            other => Value::Text(other.to_string()),
        })
        .collect())
}

fn prefix_valid_facet_where_columns(clause: &str) -> String {
    if clause.is_empty() {
        return String::new();
    }

    let columns = [
        "is_deleted",
        "is_intermediate_gen",
        "is_grid_gen",
        "resolved_model_name",
        "model_hash",
        "model_name",
        "tool",
        "timestamp",
        "is_favorite",
        "is_pinned",
        "metadata_json",
        "privacy_hidden",
        "path",
        "id",
        "width",
        "height",
        "file_size",
        "steps",
        "cfg",
        "sampler",
        "generation_type",
        "positive_prompt",
        "negative_prompt",
        "control_nets",
        "ip_adapters",
    ];

    let pattern_str = format!(r"(?i)(i\.)?\b({})\b", columns.join("|"));
    let re = Regex::new(&pattern_str).unwrap();

    re.replace_all(clause, |caps: &regex::Captures| {
        if caps.get(1).is_some() {
            caps[0].to_string()
        } else {
            format!("i.{}", &caps[2])
        }
    })
    .to_string()
}

fn push_valid_facet_branch_params(
    all_params: &mut Vec<Value>,
    collection_id: Option<&str>,
    lora_name: Option<&str>,
    sql_params: &[Value],
) {
    if let Some(cid) = collection_id {
        all_params.push(Value::Text(cid.to_string()));
    }
    if let Some(lora) = lora_name {
        all_params.push(Value::Text(lora.to_string()));
    }
    all_params.extend(sql_params.iter().cloned());
}

fn resource_clean_ref_sql(column: &str) -> String {
    format!(
        "CASE
            WHEN instr({0}, ' (') > 0 THEN substr({0}, 1, instr({0}, ' (') - 1)
            WHEN instr({0}, ':') > 0 THEN substr({0}, 1, instr({0}, ':') - 1)
            ELSE {0}
        END",
        column
    )
}

fn resource_lookup_sql(column: &str) -> String {
    let clean_ref = resource_clean_ref_sql(column);
    format!(
        "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({clean_ref}, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''))"
    )
}

fn resource_facet_cache_join_sql(facet_type: &str, column: &str) -> String {
    let clean_ref = resource_clean_ref_sql(column);
    let lookup = resource_lookup_sql(column);
    format!(
        "JOIN facet_cache fc ON fc.facet_type = '{facet_type}'
            AND fc.resource_name IS NOT NULL
            AND fc.resource_name != ''
            AND (
                LOWER(fc.resource_name) = {lookup}
                OR LOWER(fc.resource_name) = LOWER({clean_ref})
            )"
    )
}

fn get_valid_facet_names_for_query(
    conn: &rusqlite::Connection,
    where_clause: &str,
    sql_params: Vec<Value>,
    collection_id: Option<&str>,
    lora_name: Option<&str>,
) -> Result<ValidFacetNames, String> {
    let base_where = if where_clause.trim().is_empty() {
        "WHERE is_deleted = 0".to_string()
    } else {
        where_clause.to_string()
    };

    let collection_join = collection_id
        .map(|_| "JOIN collection_images ci_filter ON ci_filter.image_id = i.id AND ci_filter.collection_id = ?")
        .unwrap_or("");
    let lora_join = lora_name
        .map(|_| {
            "JOIN image_loras il_filter ON il_filter.image_id = i.id AND il_filter.lora_name = ?"
        })
        .unwrap_or("");
    let prefixed = prefix_valid_facet_where_columns(&base_where);
    let checkpoint_cache_join =
        "JOIN facet_cache fc ON fc.facet_type = 'checkpoints'
            AND fc.resource_name IS NOT NULL
            AND fc.resource_name != ''
            AND (
                (i.model_hash IS NOT NULL AND fc.resource_hash = i.model_hash)
                OR LOWER(fc.resource_name) = LOWER(COALESCE(NULLIF(i.resolved_model_name, ''), 'Unknown'))
            )";
    let lora_cache_join = resource_facet_cache_join_sql("loras", "il.lora_name");
    let embedding_cache_join = resource_facet_cache_join_sql("embeddings", "ie.embedding_name");
    let hypernetwork_cache_join =
        resource_facet_cache_join_sql("hypernetworks", "ih.hypernetwork_name");
    let controlnet_cache_join = resource_facet_cache_join_sql("control_nets", "cn.controlnet_name");
    let ipadapter_cache_join = resource_facet_cache_join_sql("ip_adapters", "ip.ipadapter_name");

    let combined_query = format!(
        "SELECT 'checkpoints' as facet_type, fc.resource_name as name FROM images i {coll} {lora} {checkpoint_cache} {where}
         UNION ALL
         SELECT 'loras', fc.resource_name FROM image_loras il JOIN images i ON i.id = il.image_id {coll} {lora} {lora_cache} {where}
         UNION ALL
         SELECT 'embeddings', fc.resource_name FROM image_embeddings ie JOIN images i ON i.id = ie.image_id {coll} {lora} {embedding_cache} {where}
         UNION ALL
         SELECT 'hypernetworks', fc.resource_name FROM image_hypernetworks ih JOIN images i ON i.id = ih.image_id {coll} {lora} {hypernetwork_cache} {where}
         UNION ALL
         SELECT 'tools', fc.resource_name FROM images i {coll} {lora} JOIN facet_cache fc ON fc.facet_type = 'tools' AND fc.resource_name = COALESCE(i.tool, 'Unknown') {where}
         UNION ALL
         SELECT 'control_nets', fc.resource_name FROM image_controlnets cn JOIN images i ON i.id = cn.image_id {coll} {lora} {controlnet_cache} {where}
         UNION ALL
         SELECT 'ip_adapters', fc.resource_name FROM image_ipadapters ip JOIN images i ON i.id = ip.image_id {coll} {lora} {ipadapter_cache} {where}",
        coll = collection_join,
        lora = lora_join,
        checkpoint_cache = checkpoint_cache_join,
        lora_cache = lora_cache_join,
        embedding_cache = embedding_cache_join,
        hypernetwork_cache = hypernetwork_cache_join,
        controlnet_cache = controlnet_cache_join,
        ipadapter_cache = ipadapter_cache_join,
        where = prefixed
    );

    let mut all_params: Vec<Value> = Vec::new();
    for _ in 0..7 {
        push_valid_facet_branch_params(&mut all_params, collection_id, lora_name, &sql_params);
    }

    let mut checkpoints: Vec<String> = Vec::new();
    let mut loras: Vec<String> = Vec::new();
    let mut embeddings: Vec<String> = Vec::new();
    let mut hypernetworks: Vec<String> = Vec::new();
    let mut tools: Vec<String> = Vec::new();
    let mut control_nets: Vec<String> = Vec::new();
    let mut ip_adapters: Vec<String> = Vec::new();

    use std::collections::HashSet;
    let mut cp_set: HashSet<String> = HashSet::new();
    let mut lora_set: HashSet<String> = HashSet::new();
    let mut emb_set: HashSet<String> = HashSet::new();
    let mut hyper_set: HashSet<String> = HashSet::new();
    let mut tool_set: HashSet<String> = HashSet::new();
    let mut cn_set: HashSet<String> = HashSet::new();
    let mut ip_set: HashSet<String> = HashSet::new();

    let mut stmt = conn
        .prepare(&combined_query)
        .map_err(|e| format!("Combined facet query failed: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(&all_params), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| format!("Combined facet query execution failed: {}", e))?;

    for row in rows {
        let (facet_type, name) = row.map_err(|e| format!("Combined facet row failed: {}", e))?;
        let Some(name) = name else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }

        match facet_type.as_str() {
            "checkpoints" => {
                if cp_set.insert(name.clone()) {
                    checkpoints.push(name);
                }
            }
            "loras" => {
                if lora_set.insert(name.clone()) {
                    loras.push(name);
                }
            }
            "embeddings" => {
                if emb_set.insert(name.clone()) {
                    embeddings.push(name);
                }
            }
            "hypernetworks" => {
                if hyper_set.insert(name.clone()) {
                    hypernetworks.push(name);
                }
            }
            "tools" => {
                if tool_set.insert(name.clone()) {
                    tools.push(name);
                }
            }
            "control_nets" => {
                if cn_set.insert(name.clone()) {
                    control_nets.push(name);
                }
            }
            "ip_adapters" => {
                if ip_set.insert(name.clone()) {
                    ip_adapters.push(name);
                }
            }
            _ => {}
        }
    }

    Ok(ValidFacetNames {
        checkpoints,
        loras,
        embeddings,
        hypernetworks,
        tools,
        control_nets,
        ip_adapters,
    })
}

fn harvest_models(conn: &rusqlite::Connection) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Harvest Checkpoints
    // OPTIMIZATION: Use the `model_hash` and `resolved_model_name` columns directly
    // instead of parsing metadata_json.
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type)
            SELECT DISTINCT
            model_hash,
            resolved_model_name,
            'harvest_checkpoint',
            ?1,
            'checkpoint'
            FROM images
            WHERE model_hash IS NOT NULL
            AND resolved_model_name IS NOT NULL",
        params![now],
    )
    .map_err(|e| format!("Harvest Checkpoints failed: {}", e))?;

    // Helper for generic harvests (LoRAs, Embeddings, Hypernetworks)
    // OPTIMIZATION: Use Junction Tables which are already populated
    let types = [
        ("loras", "harvest_lora", "image_loras", "lora_name"),
        (
            "embeddings",
            "harvest_embedding",
            "image_embeddings",
            "embedding_name",
        ),
        (
            "hypernetworks",
            "harvest_hypernet",
            "image_hypernetworks",
            "hypernetwork_name",
        ),
        (
            "control_nets",
            "harvest_controlnet",
            "image_controlnets",
            "controlnet_name",
        ),
        (
            "ip_adapters",
            "harvest_ip_adapter",
            "image_ipadapters",
            "ipadapter_name",
        ),
    ];

    for (json_key, source, table, col) in types {
        let prefix = match json_key {
            "loras" => "lora_",
            "embeddings" => "emb_",
            "hypernetworks" => "hyper_",
            "control_nets" => "cnet_",
            "ip_adapters" => "ipad_",
            _ => "",
        };

        // Note: 'clean_name' logic (removing version/suffix) is duplicated here.
        // Ideally the junction tables would store cleaned names, or we handle it here.
        // The junction creation in `save_images_batch` ALREADY cleans the name!
        // "CASE WHEN instr(value, ...)..." is used in save_images_batch.
        // So the values in `image_loras` ARE ALREADY CLEANED.
        // We can just select them directly.

        conn.execute(
            &format!(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type)
                SELECT DISTINCT
                '{}' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({}, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''),
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE({}, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''),
                '{}',
                ?1,
                '{}'
                FROM {}
                WHERE {} IS NOT NULL AND {} != ''",
                prefix, col,
                col,
                source,
                json_key,
                table,
                col, col
            ),
            params![now]
        ).map_err(|e| format!("Harvest {} failed: {}", json_key, e))?;
    }

    Ok(())
}

fn build_checkpoint_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    // 1. Calculate Counts and Usage Stats
    // COALESCE(NULLIF(..., ''), 'Unknown') aligns with frontend filter logic
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS cp_counts AS
            SELECT
                model_hash as mh,
                COALESCE(NULLIF(resolved_model_name, ''), 'Unknown') as mn,
                LOWER(COALESCE(NULLIF(resolved_model_name, ''), 'Unknown')) as lmn,
                COUNT(DISTINCT id) as cnt,
                MAX(timestamp) as last_used,
                MIN(timestamp) as first_used
            FROM images
            WHERE is_deleted = 0
            GROUP BY mh, lmn",
        [],
    )
    .map_err(|e| format!("Failed to create cp_counts temp table: {}", e))?;

    // 2. Calculate Best Dynamic Thumbnails (Pinned > Recent), including a safe candidate.
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS cp_thumbs AS
            SELECT lmn, image_id, thumbnail_path, privacy_hidden FROM (
                SELECT
                    LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, json_extract(metadata_json, '$.model'), 'Unknown')) as lmn,
                    id as image_id,
                    thumbnail_path,
                    privacy_hidden,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, json_extract(metadata_json, '$.model'), 'Unknown'))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM images i
                WHERE is_deleted = 0 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
            ) WHERE lmn IS NOT NULL AND lmn != '' AND rn = 1",
        []
    ).map_err(|e| format!("Failed to create cp_thumbs temp table: {}", e))?;

    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS cp_safe_thumbs AS
            SELECT lmn, image_id, thumbnail_path FROM (
                SELECT
                    LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, json_extract(metadata_json, '$.model'), 'Unknown')) as lmn,
                    id as image_id,
                    thumbnail_path,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(COALESCE(NULLIF(resolved_model_name, ''), model_name, json_extract(metadata_json, '$.model'), 'Unknown'))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM images i
                WHERE is_deleted = 0 AND privacy_hidden = 0 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
            ) WHERE lmn IS NOT NULL AND lmn != '' AND rn = 1",
        []
    ).map_err(|e| format!("Failed to create cp_safe_thumbs temp table: {}", e))?;

    // 3. Insert into Cache (Priority: User Override > Sidecar > Dynamic > Preview URL)
    // thumbnail_mode = 'dynamic' forces skip of sidecar
    conn.execute(
        "INSERT INTO facet_cache (
                facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url,
                last_used_at, created_at, is_manual, has_sidecar, is_user_override,
                safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive, thumbnail_sensitivity_override
            )
            SELECT 'checkpoints', m.name, m.hash,
                COALESCE(cc.total_cnt, 0),
                CASE
                    WHEN m.thumbnail_path IS NOT NULL THEN m.thumbnail_path
                    WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(ct.thumbnail_path, m.preview_url)
                    ELSE COALESCE(m.sidecar_thumbnail_path, ct.thumbnail_path, m.preview_url)
                END,
                m.preview_url,
                cc.max_last_used,
                cc.min_first_used,
                CASE WHEN m.thumbnail_path IS NOT NULL OR (m.sidecar_thumbnail_path IS NOT NULL AND m.thumbnail_mode IS NULL) THEN 1 ELSE 0 END,
                CASE WHEN m.sidecar_thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                CASE WHEN m.thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                st.thumbnail_path,
                CASE
                    WHEN m.thumbnail_path IS NOT NULL THEN ui.id
                    ELSE ct.image_id
                END,
                CASE
                    WHEN m.thumbnail_sensitivity_override = 0 THEN 0
                    WHEN m.thumbnail_sensitivity_override = 1 THEN 1
                    WHEN EXISTS (
                        SELECT 1 FROM privacy_mask_keywords k
                        WHERE LOWER(m.name) LIKE '%' || k.keyword || '%'
                    ) THEN 1
                    WHEN m.thumbnail_path IS NOT NULL THEN COALESCE(ui.privacy_hidden, 1)
                    WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(ct.privacy_hidden, 0)
                    WHEN m.sidecar_thumbnail_path IS NOT NULL AND m.sidecar_thumbnail_path != '' THEN 1
                    WHEN m.preview_url IS NOT NULL AND m.preview_url != '' THEN 1
                    ELSE COALESCE(ct.privacy_hidden, 0)
                END,
                m.thumbnail_sensitivity_override
            FROM (
                SELECT MIN(name) as name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(sidecar_thumbnail_path) as sidecar_thumbnail_path, MAX(preview_url) as preview_url, MAX(thumbnail_mode) as thumbnail_mode, MAX(thumbnail_sensitivity_override) as thumbnail_sensitivity_override
                FROM models
                WHERE resource_type = 'checkpoint'
                GROUP BY LOWER(name)
            ) m
            LEFT JOIN (
                SELECT lmn, SUM(cnt) as total_cnt, MAX(last_used) as max_last_used, MIN(first_used) as min_first_used
                FROM cp_counts
                GROUP BY lmn
            ) cc ON cc.lmn = LOWER(m.name)
            LEFT JOIN cp_thumbs ct ON ct.lmn = LOWER(m.name)
            LEFT JOIN cp_safe_thumbs st ON st.lmn = LOWER(m.name)
            LEFT JOIN images ui ON (ui.id = m.thumbnail_path OR ui.path = m.thumbnail_path OR ui.thumbnail_path = m.thumbnail_path)",
        []
    ).map_err(|e| format!("Failed to insert checkpoints into facet_cache: {}", e))?;

    // 4. Insert Orphans (Dynamic Thumbnail Only)
    conn.execute(
        "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, last_used_at, created_at, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive)
            SELECT 'checkpoints', cc.mn, COALESCE(cc.mh, 'orphan_' || cc.mn), SUM(cc.cnt), MAX(ct.thumbnail_path), MAX(cc.last_used), MIN(cc.first_used), MAX(st.thumbnail_path), MAX(ct.image_id), MAX(COALESCE(ct.privacy_hidden, 0))
            FROM cp_counts cc
            LEFT JOIN cp_thumbs ct ON ct.lmn = cc.lmn
            LEFT JOIN cp_safe_thumbs st ON st.lmn = cc.lmn
            WHERE NOT EXISTS (
                SELECT 1 FROM facet_cache fc
                WHERE fc.facet_type = 'checkpoints'
                AND (fc.resource_hash = cc.mh OR fc.resource_name = cc.mn OR LOWER(fc.resource_name) = cc.lmn)
            )
            AND cc.mn IS NOT NULL AND cc.mn != ''
            GROUP BY cc.lmn",
        []
    ).map_err(|e| format!("Failed to insert orphan checkpoints: {}", e))?;

    conn.execute("DROP TABLE IF EXISTS cp_counts", []).ok();
    conn.execute("DROP TABLE IF EXISTS cp_thumbs", []).ok();
    conn.execute("DROP TABLE IF EXISTS cp_safe_thumbs", []).ok();
    Ok(())
}

fn build_resource_facets(
    conn: &rusqlite::Connection,
    facet_type: &str,
    json_key: &str,
) -> Result<(), String> {
    // Optimization: Use JUNCTION TABLES instead of JSON extraction

    // Determine the junction table and ID column based on the facet type/json_key
    let (junction_table, name_col, image_id_col) = match json_key {
        "loras" => ("image_loras", "lora_name", "image_id"),
        "embeddings" => ("image_embeddings", "embedding_name", "image_id"),
        "hypernetworks" => ("image_hypernetworks", "hypernetwork_name", "image_id"),
        "control_nets" => ("image_controlnets", "controlnet_name", "image_id"),
        "ip_adapters" => ("image_ipadapters", "ipadapter_name", "image_id"),
        _ => {
            return Err(format!(
                "Unsupported resource type for optimization: {}",
                json_key
            ))
        }
    };
    let temp_table = format!("{}_counts", facet_type);
    let temp_thumbs = format!("{}_thumbs", facet_type);
    let temp_safe_thumbs = format!("{}_safe_thumbs", facet_type);

    // Step 1: Pre-aggregate Counts from Junction Table (No JSON Parsing!)
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {0} AS
                SELECT
                    MAX(jt.{1}) AS ref_name,
                    -- Clean the name (remove version/suffix) effectively
                    CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END AS clean_ref,
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')) AS lclean_ref,
                    COUNT(DISTINCT i.id) AS cnt,
                    MAX(i.timestamp) as last_used,
                    MIN(i.timestamp) as first_used
                FROM {2} jt
                JOIN images i ON i.id = jt.{3}
                WHERE i.is_deleted = 0
                GROUP BY lclean_ref",
            temp_table,
            name_col,
            junction_table,
            image_id_col
        ),
        [],
    )
    .map_err(|e| format!("Failed to create optimized {} table: {}", temp_table, e))?;

    // Step 2: Calculate Best Dynamic Thumbnails (Pinned > Recent) for these Resources
    // We need to group by the CLEANED reference name to match models
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {0} AS
             SELECT lclean_ref, image_id, thumbnail_path, privacy_hidden FROM (
                SELECT
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')) AS lclean_ref,
                    i.id AS image_id,
                    i.thumbnail_path,
                    i.privacy_hidden,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                            WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                            WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                            ELSE jt.{1}
                        END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM {2} jt
                JOIN images i ON i.id = jt.{3}
                WHERE i.is_deleted = 0 AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
             ) WHERE rn = 1",
            temp_thumbs,
            name_col,
            junction_table,
            image_id_col
        ),
        []
    ).map_err(|e| format!("Failed to create {} table: {}", temp_thumbs, e))?;

    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {0} AS
             SELECT lclean_ref, image_id, thumbnail_path FROM (
                SELECT
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                        WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                        WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                        ELSE jt.{1}
                    END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', '')) AS lclean_ref,
                    i.id AS image_id,
                    i.thumbnail_path,
                    ROW_NUMBER() OVER (
                        PARTITION BY LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(CASE
                            WHEN instr(jt.{1}, ' (') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ' (') - 1)
                            WHEN instr(jt.{1}, ':') > 0 THEN substr(jt.{1}, 1, instr(jt.{1}, ':') - 1)
                            ELSE jt.{1}
                        END, '.safetensors', ''), '.ckpt', ''), '.pt', ''), '.bin', ''), '.pth', ''))
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM {2} jt
                JOIN images i ON i.id = jt.{3}
                WHERE i.is_deleted = 0 AND i.privacy_hidden = 0 AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
             ) WHERE rn = 1",
            temp_safe_thumbs,
            name_col,
            junction_table,
            image_id_col
        ),
        []
    ).map_err(|e| format!("Failed to create {} table: {}", temp_safe_thumbs, e))?;

    // Step 3: Insert matched facets (Priority: User Override > Sidecar > Dynamic > Preview URL)
    // thumbnail_mode = 'dynamic' forces skip of sidecar
    conn.execute(
        &format!(
            "INSERT INTO facet_cache (
                    facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url,
                    last_used_at, created_at, is_manual, has_sidecar, is_user_override, guidance_subtype,
                    safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive, thumbnail_sensitivity_override
                )
                SELECT '{}', m.name, m.hash,
                    COALESCE(rc.cnt, 0),
                    CASE
                        WHEN m.thumbnail_path IS NOT NULL THEN m.thumbnail_path
                        WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(rt.thumbnail_path, m.preview_url)
                        ELSE COALESCE(m.sidecar_thumbnail_path, rt.thumbnail_path, m.preview_url)
                    END,
                    m.preview_url,
                    rc.last_used,
                    rc.first_used,
                    CASE WHEN m.thumbnail_path IS NOT NULL OR (m.sidecar_thumbnail_path IS NOT NULL AND m.thumbnail_mode IS NULL) THEN 1 ELSE 0 END,
                    CASE WHEN m.sidecar_thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                    CASE WHEN m.thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                    m.guidance_subtype,
                    rst.thumbnail_path,
                    CASE
                        WHEN m.thumbnail_path IS NOT NULL THEN ui.id
                        ELSE rt.image_id
                    END,
                    CASE
                        WHEN m.thumbnail_sensitivity_override = 0 THEN 0
                        WHEN m.thumbnail_sensitivity_override = 1 THEN 1
                        WHEN EXISTS (
                            SELECT 1 FROM privacy_mask_keywords k
                            WHERE LOWER(m.name) LIKE '%' || k.keyword || '%'
                        ) THEN 1
                        WHEN m.thumbnail_path IS NOT NULL THEN COALESCE(ui.privacy_hidden, 1)
                        WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(rt.privacy_hidden, 0)
                        WHEN m.sidecar_thumbnail_path IS NOT NULL AND m.sidecar_thumbnail_path != '' THEN 1
                        WHEN m.preview_url IS NOT NULL AND m.preview_url != '' THEN 1
                        ELSE COALESCE(rt.privacy_hidden, 0)
                    END,
                    m.thumbnail_sensitivity_override
                FROM (
                    SELECT MIN(name) as name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(sidecar_thumbnail_path) as sidecar_thumbnail_path, MAX(preview_url) as preview_url, MAX(thumbnail_mode) as thumbnail_mode, MAX(guidance_subtype) as guidance_subtype, MAX(thumbnail_sensitivity_override) as thumbnail_sensitivity_override
                    FROM models
                    WHERE resource_type = '{}'
                    GROUP BY LOWER(name)
                ) m
                LEFT JOIN {} rc ON rc.lclean_ref = LOWER(m.name)
                LEFT JOIN {} rt ON rt.lclean_ref = LOWER(m.name)
                LEFT JOIN {} rst ON rst.lclean_ref = LOWER(m.name)
                LEFT JOIN images ui ON (ui.id = m.thumbnail_path OR ui.path = m.thumbnail_path OR ui.thumbnail_path = m.thumbnail_path)
                GROUP BY LOWER(m.name)",
            facet_type, facet_type, temp_table, temp_thumbs, temp_safe_thumbs
        ),
        []
    ).map_err(|e| format!("Failed to insert {} into facet_cache: {}", facet_type, e))?;

    // Step 4: Insert orphans
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO facet_cache (
                    facet_type, resource_name, resource_hash, count, thumbnail_path,
                    last_used_at, created_at, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive
                )
                SELECT '{}', rc.clean_ref, 'orphan_' || rc.clean_ref, rc.cnt, rt.thumbnail_path, rc.last_used, rc.first_used, rst.thumbnail_path, rt.image_id, COALESCE(rt.privacy_hidden, 0)
                FROM {} rc
                LEFT JOIN {} rt ON rt.lclean_ref = rc.lclean_ref
                LEFT JOIN {} rst ON rst.lclean_ref = rc.lclean_ref
                WHERE NOT EXISTS (
                    SELECT 1 FROM facet_cache fc
                    WHERE fc.facet_type = '{}'
                    AND (fc.resource_name = rc.clean_ref OR fc.resource_name = rc.ref_name OR LOWER(fc.resource_name) = rc.lclean_ref)
                )
                AND rc.clean_ref IS NOT NULL AND rc.clean_ref != ''
                GROUP BY rc.lclean_ref",
            facet_type, temp_table, temp_thumbs, temp_safe_thumbs, facet_type
        ),
        []
    ).map_err(|e| format!("Failed to insert orphan {} into facet_cache: {}", facet_type, e))?;

    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_table), [])
        .ok();
    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_thumbs), [])
        .ok();
    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_safe_thumbs), [])
        .ok();
    Ok(())
}

fn build_tool_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    // Optimization: Use DENORMALIZED tool column
    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, last_used_at, created_at)
            SELECT 'tools',
                COALESCE(tool, 'Unknown'),
                NULL,
                COUNT(*),
                MAX(timestamp),
                MIN(timestamp)
            FROM images
            WHERE is_deleted = 0
            GROUP BY 2",
        []
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::init_db;

    fn create_valid_facet_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO collections (id, name, created_at) VALUES ('col-a', 'Collection A', 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt, tool)
             VALUES
             ('img-a', 'a.png', 100, 'CollectionModel', 'portrait cat', 'Automatic1111'),
             ('img-b', 'b.png', 200, 'OutsideModel', 'landscape dog', 'InvokeAI')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id) VALUES ('col-a', 'img-a')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('img-a', 'CollectionLora'), ('img-b', 'OutsideLora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_embeddings (image_id, embedding_name)
             VALUES ('img-a', 'CollectionEmbedding'), ('img-b', 'OutsideEmbedding')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES
             ('checkpoints', 'CollectionModel', NULL, 1),
             ('checkpoints', 'OutsideModel', NULL, 1),
             ('loras', 'CollectionLora', NULL, 1),
             ('loras', 'OutsideLora', NULL, 1),
             ('embeddings', 'CollectionEmbedding', NULL, 1),
             ('embeddings', 'OutsideEmbedding', NULL, 1),
             ('tools', 'Automatic1111', NULL, 1),
             ('tools', 'InvokeAI', NULL, 1)",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_valid_facet_names_respect_manual_collection_join() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0",
            vec![],
            Some("col-a"),
            None,
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["CollectionModel"]);
        assert_eq!(result.loras, vec!["CollectionLora"]);
        assert_eq!(result.embeddings, vec!["CollectionEmbedding"]);
        assert!(!result.loras.contains(&"OutsideLora".to_string()));
    }

    #[test]
    fn test_valid_facet_names_respect_plain_search_terms() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%portrait%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["CollectionModel"]);
        assert_eq!(result.loras, vec!["CollectionLora"]);
        assert!(!result.loras.contains(&"OutsideLora".to_string()));
    }

    #[test]
    fn test_valid_facet_names_respect_single_lora_optimized_join() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0",
            vec![],
            None,
            Some("CollectionLora"),
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["CollectionModel"]);
        assert_eq!(result.embeddings, vec!["CollectionEmbedding"]);
        assert!(!result.embeddings.contains(&"OutsideEmbedding".to_string()));
    }

    #[test]
    fn test_valid_facet_names_surface_query_errors() {
        let conn = create_valid_facet_conn();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE missing_column = ?",
            vec![Value::Integer(1)],
            None,
            None,
        );

        assert!(result.is_err());
    }

    #[test]
    fn test_valid_facet_names_return_cache_normalized_lora_names() {
        let conn = create_valid_facet_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt)
             VALUES ('img-raw-lora', 'raw-lora.png', 300, 'CollectionModel', 'raw lora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('img-raw-lora', 'MyLora.safetensors')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES ('loras', 'MyLora', 'lora_MyLora', 1)",
            [],
        )
        .unwrap();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%raw lora%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.loras, vec!["MyLora"]);
    }

    #[test]
    fn test_valid_facet_names_return_cache_casing_for_resources() {
        let conn = create_valid_facet_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt)
             VALUES ('img-case-lora', 'case-lora.png', 300, 'CollectionModel', 'case lora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('img-case-lora', 'caselora')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES ('loras', 'CaseLora', 'lora_CaseLora', 1)",
            [],
        )
        .unwrap();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%case lora%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.loras, vec!["CaseLora"]);
    }

    #[test]
    fn test_valid_facet_names_return_unknown_checkpoint_for_missing_names() {
        let conn = create_valid_facet_conn();

        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, positive_prompt)
             VALUES ('img-unknown-model', 'unknown-model.png', 300, NULL, 'unknown model')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count)
             VALUES ('checkpoints', 'Unknown', 'orphan_Unknown', 1)",
            [],
        )
        .unwrap();

        let result = get_valid_facet_names_for_query(
            &conn,
            "WHERE is_deleted = 0 AND positive_prompt LIKE ?",
            vec![Value::Text("%unknown model%".to_string())],
            None,
            None,
        )
        .unwrap();

        assert_eq!(result.checkpoints, vec!["Unknown"]);
    }

    #[test]
    fn test_rebuild_facet_cache() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        println!("DEBUG: DB Opened");

        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }
        println!("DEBUG: Migrations applied");

        let metadata = r#"{
            "model": "SDXL Base",
            "modelHash": "12345",
            "loras": ["DetailedEyes:1.0", "PixelArt"],
            "embeddings": ["EasyNegative"],
            "tool": "Automatic1111"
        }"#;

        // Image 1: Old, Unpinned
        conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, is_pinned, thumbnail_path, resolved_model_name, model_hash) VALUES (?1, ?2, ?3, 100, 0, 'thumb1.png', 'SDXL Base', '12345')",
            params!["img1", "test.png", metadata],
        ).unwrap();
        println!("DEBUG: Image 1 inserted");

        let metadata2 = r#"{
            "model": "SDXL Base",
            "modelHash": "12345",
            "loras": ["DetailedEyes:1.0"],
            "embeddings": ["EasyNegative:v2"],
            "hypernetworks": ["MyHyper:1.0"],
            "tool": "Automatic1111"
        }"#;

        // Image 2: New, Pinned, DIFFERENT HASH but same name
        conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, is_pinned, thumbnail_path, resolved_model_name, model_hash) VALUES (?1, ?2, ?3, 200, 1, 'thumb2.png', 'SDXL Base', '67890')",
            params!["img2", "test2.png", metadata2],
        ).unwrap();

        // Image 3: Different CASE to trigger multiplier
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash, thumbnail_path) VALUES ('img3', 'test3.png', 300, 'sdxl base', 'hash3', 'thumb3.png')",
            [],
        ).unwrap();

        // Image 4: NULL model name (should become Unknown)
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash) VALUES ('img4', 'test4.png', 400, NULL, 'hash4')",
            [],
        ).unwrap();

        // Image 5: Empty model name (should become Unknown)
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash) VALUES ('img5', 'test5.png', 500, '', 'hash5')",
            [],
        ).unwrap();

        // Image 6: Literal 'Unknown'
        conn.execute(
            "INSERT INTO images (id, path, timestamp, resolved_model_name, model_hash) VALUES ('img6', 'test6.png', 600, 'Unknown', 'hash6')",
            [],
        ).unwrap();

        // Populate Junction Tables (Simulating Scanner behavior)
        conn.execute("INSERT INTO image_loras (image_id, lora_name) VALUES ('img1', 'DetailedEyes'), ('img1', 'PixelArt')", []).unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img2', 'DetailedEyes')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO image_embeddings (image_id, embedding_name) VALUES ('img1', 'EasyNegative')", []).unwrap();
        conn.execute("INSERT INTO image_embeddings (image_id, embedding_name) VALUES ('img2', 'EasyNegative')", []).unwrap();
        conn.execute("INSERT INTO image_hypernetworks (image_id, hypernetwork_name) VALUES ('img2', 'MyHyper')", []).unwrap();

        harvest_models(&conn).unwrap();

        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0))
            .unwrap();
        assert!(model_count > 0, "Models should be populated from harvest");

        build_checkpoint_facets(&conn).unwrap();
        build_resource_facets(&conn, "loras", "loras").unwrap();
        build_resource_facets(&conn, "embeddings", "embeddings").unwrap();
        build_resource_facets(&conn, "hypernetworks", "hypernetworks").unwrap();
        build_tool_facets(&conn).unwrap();

        // --- Regression Check: Collections ---
        // Verify that rebuilding cache does NOT wipe collections
        // 1. Create a collection
        conn.execute(
            "INSERT INTO collections (id, name, created_at) VALUES ('col1', 'Test Col', 100)",
            [],
        )
        .unwrap();
        // 2. Add image to collection
        conn.execute(
            "INSERT INTO collection_images (collection_id, image_id) VALUES ('col1', 'img1')",
            [],
        )
        .unwrap();

        // Re-run rebuild to ensure it doesn't touch collections
        // (We already ran parts of it above, this simulates a full run)
        // But wait, the test calls `build_checkpoint_facets` etc individually.
        // Let's verify collections exist now.
        let col_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            col_count, 1,
            "Collection should persist after manual insertions"
        );

        // Now run the full rebuild helper if possible?
        // No, `rebuild_facet_cache` takes AppHandle. We can't call it here easily.
        // But we can call the internal functions again.
        conn.execute("DELETE FROM facet_cache", []).unwrap(); // Clear cache first
        build_checkpoint_facets(&conn).unwrap();
        build_resource_facets(&conn, "loras", "loras").unwrap();

        let col_count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM collections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            col_count_after, 1,
            "Collection should persist after facet rebuild"
        );

        // Checkpoint Check: Expected thumb2.png (Pinned)
        let (cp_count, cp_thumb): (i64, String) = conn.query_row(
            "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type='checkpoints' AND resource_name='SDXL Base'",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(
            cp_count, 3,
            "Multiplier bug! Should count exactly 3 images for SDXL Base (not doubled/tripled)"
        );
        assert_eq!(
            cp_thumb, "thumb2.png",
            "Checkpoint thumbnail should be from pinned image (thumb2)"
        );

        // LoRA Check: Expected thumb2.png (Pinned)
        let (lora_count, lora_thumb): (i64, String) = conn.query_row(
            "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type='loras' AND resource_name='DetailedEyes'",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(lora_count, 2, "Should count 2 images for DetailedEyes lora");
        assert_eq!(
            lora_thumb, "thumb2.png",
            "LoRA thumbnail should be from pinned image (thumb2)"
        );

        // Manual Override Check
        // Set manual thumbnail for SDXL Base
        conn.execute(
            "UPDATE models SET thumbnail_path = 'manual_override.png' WHERE hash = '12345'",
            [],
        )
        .unwrap();

        // Rebuild Only Checkpoints - MUST CLEAR CACHE FIRST or handle upsert
        conn.execute("DELETE FROM facet_cache WHERE facet_type='checkpoints'", [])
            .unwrap();
        build_checkpoint_facets(&conn).unwrap();

        let cp_thumb_manual: String = conn.query_row(
            "SELECT thumbnail_path FROM facet_cache WHERE facet_type='checkpoints' AND resource_name='SDXL Base'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(
            cp_thumb_manual, "manual_override.png",
            "Manual thumbnail should take precedence"
        );

        // Verification for 'Unknown' facet (img4, img5, img6)
        let unknown_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='checkpoints' AND resource_name='Unknown'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(
            unknown_count, 3,
            "Unknown facet should count NULL, Empty, and 'Unknown' (3 total)"
        );
    }

    #[test]
    fn test_facet_extension_mismatch() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        // 1. Simulate a disk scan for a LoRA (clean name)
        conn.execute(
            "INSERT INTO models (hash, name, filename, lookup_source, resource_type, sidecar_thumbnail_path)
             VALUES ('lora_MyLora', 'MyLora', 'MyLora.safetensors', 'disk_scan', 'loras', 'C:/thumbs/MyLora.webp')",
            [],
        ).unwrap();

        // 2. Simulate an image ingestion with a LoRA path (including extension)
        conn.execute(
            "INSERT INTO images (id, path, timestamp) VALUES ('img1', 'test.png', 100)",
            [],
        )
        .unwrap();

        // This is what happens currently: LoRA name stored WITH extension in junction table
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img1', 'MyLora.safetensors')",
            [],
        )
        .unwrap();

        // 3. Build LoRA facets
        build_resource_facets(&conn, "loras", "loras").unwrap();

        // 4. Check if the facet has the thumbnail
        let (name, thumb): (String, Option<String>) = conn
            .query_row(
                "SELECT resource_name, thumbnail_path FROM facet_cache WHERE facet_type='loras'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();

        assert_eq!(
            name, "MyLora",
            "Facet name should be 'MyLora' (normalized from the model name)"
        );
        assert!(
            thumb.is_some(),
            "Facet should have a thumbnail path linked from the model"
        );
        assert_eq!(thumb.unwrap(), "C:/thumbs/MyLora.webp");
    }

    #[test]
    fn resource_facets_track_safe_thumbnail_and_backing_image() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, thumbnail_path, user_masked)
             VALUES ('unsafe-img', 'unsafe.png', 100, 1, 'unsafe.webp', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, thumbnail_path, user_masked)
             VALUES ('safe-img', 'safe.png', 300, 0, 'safe.webp', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('unsafe-img', 'RiskyLora'), ('safe-img', 'RiskyLora')",
            [],
        )
        .unwrap();

        harvest_models(&conn).unwrap();
        build_resource_facets(&conn, "loras", "loras").unwrap();

        let (thumb, safe_thumb, image_id, sensitive): (String, String, String, i64) = conn
            .query_row(
                "SELECT thumbnail_path, safe_thumbnail_path, thumbnail_image_id, thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'RiskyLora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(thumb, "unsafe.webp");
        assert_eq!(safe_thumb, "safe.webp");
        assert_eq!(image_id, "unsafe-img");
        assert_eq!(sensitive, 1);
    }

    #[test]
    fn test_rebuild_incremental_facet_types_rebuilds_only_requested_types() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        let metadata = r#"{
            "model": "Flux Base",
            "modelHash": "flux-hash",
            "tool": "InvokeAI"
        }"#;

        conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, tool, thumbnail_path, resolved_model_name, model_hash)
             VALUES ('img1', 'test.png', ?1, 100, 'InvokeAI', 'thumb1.png', 'Flux Base', 'flux-hash')",
            params![metadata],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img1', 'CinematicDetail')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_embeddings (image_id, embedding_name) VALUES ('img1', 'UnusedEmbedding')",
            [],
        )
        .unwrap();

        let rebuilt = rebuild_incremental_facet_types(
            &mut conn,
            &[
                "checkpoints".to_string(),
                "loras".to_string(),
                "tools".to_string(),
                "checkpoints".to_string(),
            ],
        )
        .unwrap();

        let facet_types: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT DISTINCT facet_type FROM facet_cache ORDER BY facet_type")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };

        assert_eq!(
            rebuilt,
            vec![
                "checkpoints".to_string(),
                "loras".to_string(),
                "tools".to_string()
            ]
        );
        assert_eq!(
            facet_types,
            vec![
                "checkpoints".to_string(),
                "loras".to_string(),
                "tools".to_string()
            ]
        );

        let embedding_facets: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM facet_cache WHERE facet_type = 'embeddings'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(embedding_facets, 0);
    }

    #[test]
    fn live_resource_refresh_updates_only_touched_rows() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, tool, thumbnail_path, resolved_model_name, model_hash)
             VALUES ('img-live', 'live.png', 100, 'InvokeAI', 'old.webp', 'OldModel', 'old-hash')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img-live', 'OldLora')",
            [],
        )
        .unwrap();

        harvest_models(&conn).unwrap();
        build_checkpoint_facets(&conn).unwrap();
        build_resource_facets(&conn, "loras", "loras").unwrap();
        build_tool_facets(&conn).unwrap();

        conn.execute(
            "UPDATE images
             SET timestamp = 200,
                 thumbnail_path = 'new.webp',
                 resolved_model_name = 'NewModel',
                 model_hash = 'new-hash'
             WHERE id = 'img-live'",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM image_loras WHERE image_id = 'img-live'", [])
            .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name) VALUES ('img-live', 'NewLora')",
            [],
        )
        .unwrap();

        let touches = FacetResourceTouches {
            checkpoints: vec!["OldModel".to_string(), "NewModel".to_string()],
            loras: vec!["OldLora".to_string(), "NewLora".to_string()],
            embeddings: vec![],
            hypernetworks: vec![],
            control_nets: vec![],
            ip_adapters: vec![],
            tools: vec!["InvokeAI".to_string()],
        };

        let refreshed = refresh_live_facet_resources(&mut conn, &touches).unwrap();
        assert_eq!(refreshed, 5);

        let old_lora_count: i64 = conn
            .query_row(
                "SELECT count FROM facet_cache WHERE facet_type = 'loras' AND resource_name = 'OldLora'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let new_lora_count: i64 = conn
            .query_row(
                "SELECT count FROM facet_cache WHERE facet_type = 'loras' AND resource_name = 'NewLora'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let old_model_count: i64 = conn
            .query_row(
                "SELECT count FROM facet_cache WHERE facet_type = 'checkpoints' AND resource_name = 'OldModel'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let (new_model_count, new_model_thumb): (i64, String) = conn
            .query_row(
                "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type = 'checkpoints' AND resource_name = 'NewModel'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(old_lora_count, 0);
        assert_eq!(new_lora_count, 1);
        assert_eq!(old_model_count, 0);
        assert_eq!(new_model_count, 1);
        assert_eq!(new_model_thumb, "new.webp");
    }

    #[test]
    fn live_resource_refresh_updates_lora_thumbnails_from_matched_rows() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, is_pinned, user_masked, thumbnail_path)
             VALUES
                ('unsafe-img', 'unsafe.png', 300, 1, 1, 'unsafe.webp'),
                ('safe-img', 'safe.png', 200, 0, 0, 'safe.webp')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO image_loras (image_id, lora_name)
             VALUES ('unsafe-img', 'SharedLora'), ('safe-img', 'SharedLora')",
            [],
        )
        .unwrap();

        let touches = FacetResourceTouches {
            loras: vec!["SharedLora".to_string()],
            ..FacetResourceTouches::default()
        };

        let refreshed = refresh_live_facet_resources(&mut conn, &touches).unwrap();
        assert_eq!(refreshed, 1);

        let (count, dynamic_thumb, safe_thumb, sensitive): (i64, String, String, i64) = conn
            .query_row(
                "SELECT count, thumbnail_path, safe_thumbnail_path, thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'SharedLora'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();

        assert_eq!(count, 2);
        assert_eq!(dynamic_thumb, "unsafe.webp");
        assert_eq!(safe_thumb, "safe.webp");
        assert_eq!(sensitive, 1);
    }

    #[test]
    fn sidecar_resource_thumbnails_are_sensitive_in_auto_mode() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        conn.execute(
            "INSERT INTO privacy_mask_keywords (keyword) VALUES ('nsfw')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO models (hash, name, lookup_source, scanned_at, resource_type, sidecar_thumbnail_path)
             VALUES ('lora_NsfwStyle', 'NsfwStyle', 'disk_scan', 1, 'loras', 'sidecar.webp')",
            [],
        )
        .unwrap();

        build_resource_facets(&conn, "loras", "loras").unwrap();

        let sensitive: i64 = conn
            .query_row(
                "SELECT thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'NsfwStyle'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sensitive, 1);

        conn.execute(
            "UPDATE models SET thumbnail_sensitivity_override = 0 WHERE hash = 'lora_NsfwStyle'",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM facet_cache", []).unwrap();
        build_resource_facets(&conn, "loras", "loras").unwrap();

        let override_sensitive: i64 = conn
            .query_row(
                "SELECT thumbnail_is_sensitive
                 FROM facet_cache
                 WHERE facet_type = 'loras' AND resource_name = 'NsfwStyle'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(override_sensitive, 0);
    }
}
