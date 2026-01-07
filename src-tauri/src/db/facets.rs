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
    // Optimization: Use DENORMALIZED columns (model_hash, resolved_model_name) instead of JSON extract
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

    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url, last_used_at, created_at)
            SELECT 'checkpoint', m.name, m.hash, 
                COALESCE(SUM(cc.cnt), 0), 
                m.thumbnail_path, m.preview_url,
                MAX(cc.last_used),
                MIN(cc.first_used)
            FROM (
                SELECT name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(preview_url) as preview_url
                FROM models 
                WHERE resource_type = 'checkpoint'
                GROUP BY name
            ) m
            LEFT JOIN cp_counts cc ON (
                cc.mh = m.hash OR
                cc.mn = m.name
            )
            GROUP BY m.name",
        []
    ).map_err(|e| format!("Failed to insert checkpoints into facet_cache: {}", e))?;

    conn.execute(
        "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count, last_used_at, created_at)
            SELECT 'checkpoint', cc.mn, COALESCE(cc.mh, 'orphan_' || cc.mn), SUM(cc.cnt), MAX(cc.last_used), MIN(cc.first_used)
            FROM cp_counts cc
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
    
    // Step 1: Pre-aggregate from Junction Table (No JSON Parsing!)
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

    // Step 2: Insert matched facets (Join against generic `models` table)
    conn.execute(
        &format!(
            "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url, last_used_at, created_at)
                SELECT '{}', m.name, m.hash,
                    COALESCE(SUM(rc.cnt), 0),
                    m.thumbnail_path, m.preview_url,
                    MAX(rc.last_used),
                    MIN(rc.first_used)
                FROM (
                    SELECT name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(preview_url) as preview_url
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
                GROUP BY m.name",
            facet_type, facet_type, temp_table
        ),
        []
    ).map_err(|e| format!("Failed to insert {} into facet_cache: {}", facet_type, e))?;

    // Step 3: Insert orphans
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count, last_used_at, created_at)
                SELECT '{}', rc.clean_ref, 'orphan_' || rc.clean_ref, SUM(rc.cnt), MAX(rc.last_used), MIN(rc.first_used)
                FROM {} rc
                WHERE NOT EXISTS (
                    SELECT 1 FROM facet_cache fc 
                    WHERE fc.facet_type = '{}' 
                    AND (fc.resource_name = rc.clean_ref OR fc.resource_name = rc.ref_name)
                )
                AND rc.clean_ref IS NOT NULL AND rc.clean_ref != ''
                GROUP BY rc.clean_ref",
            facet_type, temp_table, facet_type
        ),
        []
    ).map_err(|e| format!("Failed to insert orphan {} into facet_cache: {}", facet_type, e))?;

    conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_table), []).ok();
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

        conn.execute(
            "INSERT INTO images (id, path, metadata_json) VALUES (?1, ?2, ?3)",
            params!["img1", "test.png", metadata],
        ).unwrap();

        let metadata2 = r#"{
            "model": "SDXL Base",
            "modelHash": "123456", 
            "loras": [],
            "embeddings": ["EasyNegative:v2"],
            "hypernetworks": ["MyHyper:1.0"],
            "tool": "Automatic1111"
        }"#;

         conn.execute(
            "INSERT INTO images (id, path, metadata_json) VALUES (?1, ?2, ?3)",
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

        let cp_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='checkpoint' AND resource_name='SDXL Base'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(cp_count, 2, "Should count 2 images for SDXL Base");

        let lora_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='loras' AND resource_name='DetailedEyes'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(lora_count, 1, "Should count 1 image for DetailedEyes lora");
        
        let emb_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='embeddings' AND resource_name='EasyNegative'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(emb_count, 2, "Should count 2 images for EasyNegative (Base + v2)");

        let hyper_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='hypernetworks' AND resource_name='MyHyper'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(hyper_count, 1, "Should count 1 image for MyHyper");
    }
}
