use rusqlite::params;
use tauri::Emitter;
use super::{resolve_db_path, configure_connection, ProgressPayload};

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn rebuild_facet_cache(app: tauri::AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        println!("[FacetCache] Starting rebuild...");
        let _ = app.emit("facet_cache_progress", ProgressPayload { current: 0, total: 6, message: "Starting facet cache build...".into() });

        // --- PHASE 1: HARVEST ---
        {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            println!("[FacetCache] Harvesting models from images...");
            let start_harvest = std::time::Instant::now();
            let _ = app.emit("facet_cache_progress", ProgressPayload { current: 1, total: 6, message: "Harvesting models from library...".into() });
            
            harvest_models(&tx)?;

            tx.commit().map_err(|e| e.to_string())?;
            println!("[FacetCache] Harvest completed in {:?}.", start_harvest.elapsed());
        }

        // --- PHASE 2: BUILD CACHE ---
        let count_result = {
            let tx = conn.transaction().map_err(|e| e.to_string())?;

            // Clear existing cache
            tx.execute("DELETE FROM facet_cache", []).map_err(|e| e.to_string())?;

            // 1. Checkpoints
            println!("[FacetCache] Building checkpoints...");
            let start_cp = std::time::Instant::now();
            let _ = app.emit("facet_cache_progress", ProgressPayload { current: 2, total: 6, message: "Building checkpoints cache...".into() });
            build_checkpoint_facets(&tx)?;
            println!("[FacetCache] Checkpoints built in {:?}.", start_cp.elapsed());

            // 2. LoRAs
            println!("[FacetCache] Building LoRAs...");
            let start_lora = std::time::Instant::now();
            let _ = app.emit("facet_cache_progress", ProgressPayload { current: 3, total: 6, message: "Building LoRAs cache...".into() });
            build_resource_facets(&tx, "loras", "loras")?;
            println!("[FacetCache] LoRAs built in {:?}.", start_lora.elapsed());

            // 3. Embeddings
            println!("[FacetCache] Building Embeddings...");
            let start_emb = std::time::Instant::now();
            let _ = app.emit("facet_cache_progress", ProgressPayload { current: 4, total: 6, message: "Building Embeddings cache...".into() });
            build_resource_facets(&tx, "embeddings", "embeddings")?;
            println!("[FacetCache] Embeddings built in {:?}.", start_emb.elapsed());

            // 4. Hypernetworks
            println!("[FacetCache] Building Hypernetworks...");
            let start_hyper = std::time::Instant::now();
            let _ = app.emit("facet_cache_progress", ProgressPayload { current: 5, total: 6, message: "Building Hypernetworks cache...".into() });
            build_resource_facets(&tx, "hypernetworks", "hypernetworks")?;
            println!("[FacetCache] Hypernetworks built in {:?}.", start_hyper.elapsed());

            // 5. Tools
            build_tool_facets(&tx)?;

            tx.commit().map_err(|e| e.to_string())?;

            // Return total cache entries
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row.get(0))
                .map_err(|e| e.to_string())?;
                
            // Update stats after rebuild
            let _ = conn.execute("ANALYZE facet_cache", []);
            let _ = conn.execute("ANALYZE models", []);
            
            count
        };

        println!("[FacetCache] Rebuild complete in {:?}. Total entries: {}", start_total.elapsed(), count_result);
        let _ = app.emit("facet_cache_progress", ProgressPayload { current: 6, total: 6, message: "Cache rebuild complete.".into() });

        Ok(count_result as usize)
    }).await.map_err(|e| e.to_string())?
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
}

/// Get distinct facet names that exist in the current filtered result set.
/// This is used for drill-down filtering - hiding facets that have no images
/// in the current filter context.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_valid_facet_names(
    app: tauri::AppHandle,
    where_clause: String,
    params_json: String,
    collection_id: Option<String>,
    lora_name: Option<String>
) -> Result<ValidFacetNames, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        configure_connection(&conn).map_err(|e| e.to_string())?;

        // Parse JSON params
        let params: Vec<serde_json::Value> = serde_json::from_str(&params_json)
            .unwrap_or_else(|_| Vec::new());

        // Convert JSON params to rusqlite params
        let sql_params: Vec<rusqlite::types::Value> = params.iter().map(|p| {
            match p {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        rusqlite::types::Value::Integer(i)
                    } else if let Some(f) = n.as_f64() {
                        rusqlite::types::Value::Real(f)
                    } else {
                        rusqlite::types::Value::Null
                    }
                }
                serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
                serde_json::Value::Null => rusqlite::types::Value::Null,
                _ => rusqlite::types::Value::Text(p.to_string()),
            }
        }).collect();

        // Build base WHERE clause, ensuring it starts with WHERE
        let base_where = if where_clause.is_empty() {
            "WHERE is_deleted = 0".to_string()
        } else {
            where_clause.clone()
        };

        // Helper to create prefixed WHERE clause for queries that JOIN with images table aliased as 'i'
        let prefix_columns = |clause: &str| -> String {
            let mut result = clause.to_string();
            let columns = [
                "is_deleted", "is_intermediate_gen", "is_grid_gen", "resolved_model_name", 
                "model_hash", "tool", "timestamp", "is_favorite", "is_pinned", 
                "metadata_json", "path", "id", "width", "height", "file_size"
            ];
            
            for col in columns {
                let patterns = vec![
                    (format!("WHERE {} ", col), format!("WHERE i.{} ", col)),
                    (format!("WHERE {}=", col), format!("WHERE i.{}=", col)),
                    (format!(" {} ", col), format!(" i.{} ", col)),
                    (format!(" {}=", col), format!(" i.{}=", col)),
                    (format!("({}", col), format!("(i.{}", col)),
                ];
                for (from, to) in patterns {
                    result = result.replace(&from, &to);
                }
            }
            result
        };

        println!("[ValidFacets] WHERE: {}, CollectionId: {:?}, LoraName: {:?}", base_where, collection_id, lora_name);

        // Build query parts for collection and LoRA JOINs
        let collection_join = collection_id.as_ref().map(|_| 
            "JOIN collection_images ci ON ci.image_id = i.id AND ci.collection_id = ?"
        ).unwrap_or("");
        
        let lora_join = lora_name.as_ref().map(|_| 
            "JOIN image_loras il_filter ON il_filter.image_id = i.id AND il_filter.lora_name = ?"
        ).unwrap_or("");

        // Build params for each query (base params + collection_id + lora_name as needed)
        let build_params = |include_collection: bool, include_lora: bool| -> Vec<rusqlite::types::Value> {
            let mut p = Vec::new();
            
            // JOIN params come first in the SQL string
            if include_collection {
                if let Some(ref cid) = collection_id {
                    p.push(rusqlite::types::Value::Text(cid.clone()));
                }
            }
            if include_lora {
                if let Some(ref ln) = lora_name {
                    p.push(rusqlite::types::Value::Text(ln.clone()));
                }
            }
            
            // WHERE params come last
            p.extend(sql_params.clone());
            p
        };

        // 1. Checkpoints - query images with optional collection/lora JOINs
        let checkpoints = {
            let prefixed = prefix_columns(&base_where);
            let query = format!(
                "SELECT DISTINCT i.resolved_model_name FROM images i {} {} {} AND i.resolved_model_name IS NOT NULL AND i.resolved_model_name != ''",
                collection_join, lora_join, prefixed
            );
            println!("[ValidFacets] Checkpoint query: {}", query);
            let params = build_params(collection_id.is_some(), lora_name.is_some());
            let mut stmt = conn.prepare(&query).map_err(|e| format!("Checkpoint query failed: {}", e))?;
            let rows = stmt.query_map(rusqlite::params_from_iter(&params), |row| row.get::<_, String>(0))
                .map_err(|e| format!("Checkpoint query execution failed: {}", e))?;
            let result: Vec<_> = rows.filter_map(|r| r.ok()).collect();
            println!("[ValidFacets] Checkpoints found: {}", result.len());
            result
        };

        // 2. LoRAs - use junction table with optional collection JOIN
        let loras = {
            let prefixed = prefix_columns(&base_where);
            // For LoRAs, we add a JOIN for image_loras to get DISTINCT lora names
            // If filtering by lora_name, we still want to show OTHER loras used with those images
            let query = format!(
                "SELECT DISTINCT il.lora_name FROM image_loras il JOIN images i ON i.id = il.image_id {} {} {}",
                collection_join, lora_join, prefixed
            );
            println!("[ValidFacets] LoRA query: {}", query);
            let params = build_params(collection_id.is_some(), lora_name.is_some());
            let mut stmt = conn.prepare(&query).map_err(|e| format!("LoRA query failed: {}", e))?;
            let rows = stmt.query_map(rusqlite::params_from_iter(&params), |row| row.get::<_, String>(0))
                .map_err(|e| format!("LoRA query execution failed: {}", e))?;
            let result: Vec<_> = rows.filter_map(|r| r.ok()).collect();
            println!("[ValidFacets] LoRAs found: {}", result.len());
            result
        };

        // 3. Embeddings - use junction table
        let embeddings = {
            let prefixed = prefix_columns(&base_where);
            let query = format!(
                "SELECT DISTINCT ie.embedding_name FROM image_embeddings ie JOIN images i ON i.id = ie.image_id {} {} {}",
                collection_join, lora_join, prefixed
            );
            let params = build_params(collection_id.is_some(), lora_name.is_some());
            let mut stmt = conn.prepare(&query).map_err(|e| format!("Embedding query failed: {}", e))?;
            let rows = stmt.query_map(rusqlite::params_from_iter(&params), |row| row.get::<_, String>(0))
                .map_err(|e| format!("Embedding query execution failed: {}", e))?;
            rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
        };

        // 4. Hypernetworks - use junction table
        let hypernetworks = {
            let prefixed = prefix_columns(&base_where);
            let query = format!(
                "SELECT DISTINCT ih.hypernetwork_name FROM image_hypernetworks ih JOIN images i ON i.id = ih.image_id {} {} {}",
                collection_join, lora_join, prefixed
            );
            let params = build_params(collection_id.is_some(), lora_name.is_some());
            let mut stmt = conn.prepare(&query).map_err(|e| format!("Hypernetwork query failed: {}", e))?;
            let rows = stmt.query_map(rusqlite::params_from_iter(&params), |row| row.get::<_, String>(0))
                .map_err(|e| format!("Hypernetwork query execution failed: {}", e))?;
            rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
        };

        // 5. Tools - use denormalized column with optional collection/lora JOINs
        let tools = {
            let prefixed = prefix_columns(&base_where);
            let query = format!(
                "SELECT DISTINCT i.tool FROM images i {} {} {} AND i.tool IS NOT NULL AND i.tool != ''",
                collection_join, lora_join, prefixed
            );
            let params = build_params(collection_id.is_some(), lora_name.is_some());
            let mut stmt = conn.prepare(&query).map_err(|e| format!("Tool query failed: {}", e))?;
            let rows = stmt.query_map(rusqlite::params_from_iter(&params), |row| row.get::<_, String>(0))
                .map_err(|e| format!("Tool query execution failed: {}", e))?;
            rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
        };

        println!("[ValidFacets] Results - CP:{} LoRAs:{} Emb:{} Hyper:{} Tools:{}", 
            checkpoints.len(), loras.len(), embeddings.len(), hypernetworks.len(), tools.len());

        Ok(ValidFacetNames {
            checkpoints,
            loras,
            embeddings,
            hypernetworks,
            tools,
        })
    }).await.map_err(|e| e.to_string())?
}

fn harvest_models(conn: &rusqlite::Connection) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

    // Harvest Checkpoints
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
            params![now]
    ).map_err(|e| format!("Harvest Checkpoints failed: {}", e))?;

    // Helper for generic harvests (LoRAs, Embeddings, Hypernetworks)
    let types = [("loras", "harvest_lora"), ("embeddings", "harvest_embedding"), ("hypernetworks", "harvest_hypernet")];
    for (json_key, source) in types {
        let prefix = match json_key {
            "loras" => "lora_",
            "embeddings" => "emb_",
            "hypernetworks" => "hyper_",
            _ => "",
        };

        conn.execute(
            &format!(
                "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
                SELECT DISTINCT 
                '{}' || clean_name, 
                clean_name, 
                '{}', 
                ?1,
                '{}'
                FROM (
                    SELECT 
                        CASE 
                            WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                            WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                            ELSE j.value 
                        END as clean_name
                    FROM images, json_each(metadata_json, '$.{}') j
                ) 
                WHERE clean_name IS NOT NULL AND clean_name != ''",
                prefix, source, json_key, json_key
            ),
            params![now]
        ).map_err(|e| format!("Harvest {} failed: {}", json_key, e))?;
    }

    Ok(())
}

fn build_checkpoint_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    // 1. Calculate Counts and Usage Stats
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS cp_counts AS
            SELECT 
                model_hash as mh, 
                resolved_model_name as mn,
                COUNT(DISTINCT id) as cnt,
                MAX(timestamp) as last_used,
                MIN(timestamp) as first_used
            FROM images 
            WHERE is_deleted = 0
            GROUP BY mh, mn",
        []
    ).map_err(|e| format!("Failed to create cp_counts temp table: {}", e))?;

    // 2. Calculate Best Dynamic Thumbnail (Pinned > Recent)
    // We use model_name (or json_extract) to ensure it matches what harvest_models uses
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS cp_thumbs AS
            SELECT mn, thumbnail_path FROM (
                SELECT 
                    COALESCE(model_name, json_extract(metadata_json, '$.model')) as mn, 
                    thumbnail_path,
                    ROW_NUMBER() OVER (PARTITION BY COALESCE(model_name, json_extract(metadata_json, '$.model')) ORDER BY is_pinned DESC, timestamp DESC) as rn
                FROM images
                WHERE is_deleted = 0 AND thumbnail_path IS NOT NULL AND thumbnail_path != ''
            ) WHERE mn IS NOT NULL AND mn != '' AND rn = 1",
        []
    ).map_err(|e| format!("Failed to create cp_thumbs temp table: {}", e))?;

    // 3. Insert into Cache (Priority: User Override > Sidecar > Dynamic > Preview URL)
    // thumbnail_mode = 'dynamic' forces skip of sidecar
    // 3. Insert into Cache (Priority: User Override > Sidecar > Dynamic > Preview URL)
    // thumbnail_mode = 'dynamic' forces skip of sidecar
    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url, last_used_at, created_at, is_manual, has_sidecar, is_user_override)
            SELECT 'checkpoint', m.name, m.hash, 
                COALESCE(SUM(cc.cnt), 0), 
                CASE 
                    WHEN m.thumbnail_path IS NOT NULL THEN m.thumbnail_path
                    WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(MAX(ct.thumbnail_path), m.preview_url)
                    ELSE COALESCE(m.sidecar_thumbnail_path, MAX(ct.thumbnail_path), m.preview_url)
                END,
                m.preview_url,
                MAX(cc.last_used),
                MIN(cc.first_used),
                CASE WHEN m.thumbnail_path IS NOT NULL OR (m.sidecar_thumbnail_path IS NOT NULL AND m.thumbnail_mode IS NULL) THEN 1 ELSE 0 END,
                CASE WHEN m.sidecar_thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                CASE WHEN m.thumbnail_path IS NOT NULL THEN 1 ELSE 0 END
            FROM (
                SELECT name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(sidecar_thumbnail_path) as sidecar_thumbnail_path, MAX(preview_url) as preview_url, MAX(thumbnail_mode) as thumbnail_mode
                FROM models 
                WHERE resource_type = 'checkpoint'
                GROUP BY name
            ) m
            LEFT JOIN cp_counts cc ON (
                cc.mh = m.hash OR
                cc.mn = m.name
            )
            LEFT JOIN cp_thumbs ct ON (
                ct.mn = m.name
            )
            GROUP BY m.name",
        []
    ).map_err(|e| format!("Failed to insert checkpoints into facet_cache: {}", e))?;

    // 4. Insert Orphans (Dynamic Thumbnail Only)
    conn.execute(
        "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, last_used_at, created_at)
            SELECT 'checkpoint', cc.mn, COALESCE(cc.mh, 'orphan_' || cc.mn), SUM(cc.cnt), MAX(ct.thumbnail_path), MAX(cc.last_used), MIN(cc.first_used)
            FROM cp_counts cc
            LEFT JOIN cp_thumbs ct ON ct.mn = cc.mn
            WHERE NOT EXISTS (
                SELECT 1 FROM facet_cache fc 
                WHERE fc.facet_type = 'checkpoint' 
                AND (fc.resource_hash = cc.mh OR fc.resource_name = cc.mn)
            )
            AND cc.mn IS NOT NULL AND cc.mn != ''
            GROUP BY cc.mn",
        []
    ).map_err(|e| format!("Failed to insert orphan checkpoints: {}", e))?;

    conn.execute("DROP TABLE IF EXISTS cp_counts", []).ok();
    conn.execute("DROP TABLE IF EXISTS cp_thumbs", []).ok();
    Ok(())
}

fn build_resource_facets(conn: &rusqlite::Connection, facet_type: &str, json_key: &str) -> Result<(), String> {
    // Optimization: Use JUNCTION TABLES instead of JSON extraction
    
    // Determine the junction table and ID column based on the facet type/json_key
    let (junction_table, name_col, image_id_col) = match json_key {
        "loras" => ("image_loras", "lora_name", "image_id"),
        "embeddings" => ("image_embeddings", "embedding_name", "image_id"),
        "hypernetworks" => ("image_hypernetworks", "hypernetwork_name", "image_id"),
        _ => return Err(format!("Unsupported resource type for optimization: {}", json_key)),
    };
    
    let temp_table = format!("{}_counts", facet_type);
    let temp_thumbs = format!("{}_thumbs", facet_type);
    
    // Step 1: Pre-aggregate Counts from Junction Table (No JSON Parsing!)
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {} AS
                SELECT 
                    jt.{} AS ref_name,
                    -- Clean the name (remove version/suffix) effectively
                    CASE 
                        WHEN instr(jt.{}, ' (') > 0 THEN substr(jt.{}, 1, instr(jt.{}, ' (') - 1)
                        WHEN instr(jt.{}, ':') > 0 THEN substr(jt.{}, 1, instr(jt.{}, ':') - 1)
                        ELSE jt.{} 
                    END AS clean_ref,
                    COUNT(DISTINCT i.id) AS cnt,
                    MAX(i.timestamp) as last_used,
                    MIN(i.timestamp) as first_used
                FROM {} jt
                JOIN images i ON i.id = jt.{}
                WHERE i.is_deleted = 0
                GROUP BY jt.{}",
            temp_table, 
            name_col, 
            name_col, name_col, name_col, // substr args
            name_col, name_col, name_col, // substr args 2
            name_col, // ELSE
            junction_table,
            image_id_col,
            name_col
        ),
        []
    ).map_err(|e| format!("Failed to create optimized {} table: {}", temp_table, e))?;

    // Step 2: Calculate Best Dynamic Thumbnails (Pinned > Recent) for these Resources
    // We need to group by the CLEANED reference name to match models
    conn.execute(
        &format!(
            "CREATE TEMP TABLE IF NOT EXISTS {} AS
             SELECT clean_ref, thumbnail_path FROM (
                SELECT 
                    CASE 
                        WHEN instr(jt.{}, ' (') > 0 THEN substr(jt.{}, 1, instr(jt.{}, ' (') - 1)
                        WHEN instr(jt.{}, ':') > 0 THEN substr(jt.{}, 1, instr(jt.{}, ':') - 1)
                        ELSE jt.{} 
                    END AS clean_ref,
                    i.thumbnail_path,
                    ROW_NUMBER() OVER (
                        PARTITION BY 
                            CASE 
                                WHEN instr(jt.{}, ' (') > 0 THEN substr(jt.{}, 1, instr(jt.{}, ' (') - 1)
                                WHEN instr(jt.{}, ':') > 0 THEN substr(jt.{}, 1, instr(jt.{}, ':') - 1)
                                ELSE jt.{} 
                            END
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as rn
                FROM {} jt
                JOIN images i ON i.id = jt.{}
                WHERE i.is_deleted = 0 AND i.thumbnail_path IS NOT NULL AND i.thumbnail_path != ''
             ) WHERE rn = 1",
            temp_thumbs,
            name_col, name_col, name_col, name_col, name_col, name_col, name_col,
            name_col, name_col, name_col, name_col, name_col, name_col, name_col, 
            junction_table, image_id_col
        ),
        []
    ).map_err(|e| format!("Failed to create {} table: {}", temp_thumbs, e))?;

    // Step 3: Insert matched facets (Priority: User Override > Sidecar > Dynamic > Preview URL)
    // thumbnail_mode = 'dynamic' forces skip of sidecar
    conn.execute(
        &format!(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url, last_used_at, created_at, is_manual, has_sidecar, is_user_override)
                SELECT '{}', m.name, m.hash,
                    COALESCE(SUM(rc.cnt), 0),
                    CASE 
                        WHEN m.thumbnail_path IS NOT NULL THEN m.thumbnail_path
                        WHEN m.thumbnail_mode = 'dynamic' THEN COALESCE(MAX(rt.thumbnail_path), m.preview_url)
                        ELSE COALESCE(m.sidecar_thumbnail_path, MAX(rt.thumbnail_path), m.preview_url)
                    END,
                    m.preview_url,
                    MAX(rc.last_used),
                    MIN(rc.first_used),
                    CASE WHEN m.thumbnail_path IS NOT NULL OR (m.sidecar_thumbnail_path IS NOT NULL AND m.thumbnail_mode IS NULL) THEN 1 ELSE 0 END,
                    CASE WHEN m.sidecar_thumbnail_path IS NOT NULL THEN 1 ELSE 0 END,
                    CASE WHEN m.thumbnail_path IS NOT NULL THEN 1 ELSE 0 END
                FROM (
                    SELECT name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(sidecar_thumbnail_path) as sidecar_thumbnail_path, MAX(preview_url) as preview_url, MAX(thumbnail_mode) as thumbnail_mode
                    FROM models 
                    WHERE resource_type = '{}'
                    GROUP BY name
                ) m
                LEFT JOIN {} rc ON (
                    rc.ref_name = m.name OR 
                    rc.clean_ref = m.name OR
                    rc.ref_name LIKE m.name || ' (%' OR
                    rc.ref_name LIKE m.name || ':%' OR
                    m.name LIKE rc.clean_ref || '%'
                )
                LEFT JOIN {} rt ON (
                    rt.clean_ref = m.name
                )
                GROUP BY m.name",
            facet_type, facet_type, temp_table, temp_thumbs
        ),
        []
    ).map_err(|e| format!("Failed to insert {} into facet_cache: {}", facet_type, e))?;

    // Step 4: Insert orphans
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, last_used_at, created_at)
                SELECT '{}', rc.clean_ref, 'orphan_' || rc.clean_ref, SUM(rc.cnt), MAX(rt.thumbnail_path), MAX(rc.last_used), MIN(rc.first_used)
                FROM {} rc
                LEFT JOIN {} rt ON rt.clean_ref = rc.clean_ref
                WHERE NOT EXISTS (
                    SELECT 1 FROM facet_cache fc 
                    WHERE fc.facet_type = '{}' 
                    AND (fc.resource_name = rc.clean_ref OR fc.resource_name = rc.ref_name)
                )
                AND rc.clean_ref IS NOT NULL AND rc.clean_ref != ''
                GROUP BY rc.clean_ref",
            facet_type, temp_table, temp_thumbs, facet_type
        ),
        []
    ).map_err(|e| format!("Failed to insert orphan {} into facet_cache: {}", facet_type, e))?;

    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_table), []).ok();
    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_thumbs), []).ok();
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

    #[test]
    fn test_rebuild_facet_cache() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();

        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        let metadata = r#"{
            "model": "SDXL Base",
            "modelHash": "12345",
            "loras": ["DetailedEyes:1.0", "PixelArt"],
            "embeddings": ["EasyNegative"],
            "tool": "Automatic1111"
        }"#;

        // Image 1: Old, Unpinned
        conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, is_pinned, thumbnail_path) VALUES (?1, ?2, ?3, 100, 0, 'thumb1.png')",
            params!["img1", "test.png", metadata],
        ).unwrap();

        let metadata2 = r#"{
            "model": "SDXL Base",
            "modelHash": "12345", 
            "loras": ["DetailedEyes:1.0"],
            "embeddings": ["EasyNegative:v2"],
            "hypernetworks": ["MyHyper:1.0"],
            "tool": "Automatic1111"
        }"#;

         // Image 2: New, Pinned (Should be preferred thumbnail for SDXL and DetailedEyes)
         conn.execute(
            "INSERT INTO images (id, path, metadata_json, timestamp, is_pinned, thumbnail_path) VALUES (?1, ?2, ?3, 200, 1, 'thumb2.png')",
            params!["img2", "test2.png", metadata2],
        ).unwrap();

        harvest_models(&conn).unwrap();
        
        let model_count: i64 = conn.query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0)).unwrap();
        assert!(model_count > 0, "Models should be populated from harvest");

        build_checkpoint_facets(&conn).unwrap();
        build_resource_facets(&conn, "loras", "loras").unwrap();
        build_resource_facets(&conn, "embeddings", "embeddings").unwrap();
        build_resource_facets(&conn, "hypernetworks", "hypernetworks").unwrap();
        build_tool_facets(&conn).unwrap();

        // Checkpoint Check: Expected thumb2.png (Pinned)
        let (cp_count, cp_thumb): (i64, String) = conn.query_row(
            "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type='checkpoint' AND resource_name='SDXL Base'", 
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(cp_count, 2, "Should count 2 images for SDXL Base");
        assert_eq!(cp_thumb, "thumb2.png", "Checkpoint thumbnail should be from pinned image (thumb2)");

        // LoRA Check: Expected thumb2.png (Pinned)
        let (lora_count, lora_thumb): (i64, String) = conn.query_row(
            "SELECT count, thumbnail_path FROM facet_cache WHERE facet_type='loras' AND resource_name='DetailedEyes'", 
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(lora_count, 2, "Should count 2 images for DetailedEyes lora");
        assert_eq!(lora_thumb, "thumb2.png", "LoRA thumbnail should be from pinned image (thumb2)");
        
        // Manual Override Check
        // Set manual thumbnail for SDXL Base
        conn.execute("UPDATE models SET thumbnail_path = 'manual_override.png' WHERE hash = '12345'", []).unwrap();
        
        // Rebuild Only Checkpoints
        build_checkpoint_facets(&conn).unwrap();
        
        let cp_thumb_manual: String = conn.query_row(
            "SELECT thumbnail_path FROM facet_cache WHERE facet_type='checkpoint' AND resource_name='SDXL Base'", 
            [], |r| r.get(0)).unwrap();
        assert_eq!(cp_thumb_manual, "manual_override.png", "Manual thumbnail should take precedence");
    }
}
