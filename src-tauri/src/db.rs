use tauri_plugin_sql::{Migration, MigrationKind};
use std::path::PathBuf;
use std::collections::HashMap;
use rusqlite::params;
use tauri::Manager;

#[derive(serde::Deserialize)]
pub struct ImageRecord {
    pub id: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
    pub timestamp: u64,
    #[serde(rename = "metadataJson")]
    pub metadata_json: String,
    #[serde(rename = "thumbnailPath")]
    pub thumbnail_path: String,
    #[serde(rename = "isFavorite")]
    pub is_favorite: bool,
    #[serde(rename = "isPinned")]
    pub is_pinned: bool,
    #[serde(rename = "isDeleted")]
    pub is_deleted: bool,
    #[serde(rename = "isMissing")]
    pub is_missing: bool,
    #[serde(rename = "userMasked")]
    pub user_masked: Option<bool>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "boardId")]
    pub board_id: Option<String>,
    pub notes: Option<String>,
    #[serde(rename = "originalMetadataJson")]
    pub original_metadata_json: Option<String>,
}

pub fn init_db() -> Vec<Migration> {
    // ... migration definitions ...
    let migration = Migration {
        version: 1,
        description: "create_images_table",
        sql: "CREATE TABLE IF NOT EXISTS images (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            width INTEGER,
            height INTEGER,
            file_size INTEGER,
            timestamp INTEGER,
            metadata_json TEXT,
            thumbnail_path TEXT,
            is_favorite INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            is_deleted INTEGER DEFAULT 0,
            is_missing INTEGER DEFAULT 0,
            user_masked INTEGER DEFAULT 0,
            group_id TEXT,
            notes TEXT,
            original_metadata_json TEXT
        );",
        kind: MigrationKind::Up,
    };

    let migration2 = Migration {
        version: 2,
        description: "add_board_id_column",
        sql: "ALTER TABLE images ADD COLUMN board_id TEXT;",
        kind: MigrationKind::Up,
    };

    let migration3 = Migration {
        version: 3,
        description: "migrate_groups_to_boards",
        sql: "UPDATE images SET board_id = group_id, group_id = NULL WHERE group_id IS NOT NULL;",
        kind: MigrationKind::Up,
    };

    let migration4 = Migration {
        version: 4,
        description: "create_collections_and_junction",
        sql: "
            CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                is_archived INTEGER DEFAULT 0,
                is_pinned INTEGER DEFAULT 0,
                created_at INTEGER,
                filter_state TEXT,
                manual_exclusions TEXT,
                custom_thumbnail TEXT,
                source TEXT DEFAULT 'ambit'
            );
            CREATE TABLE IF NOT EXISTS collection_images (
                collection_id TEXT,
                image_id TEXT,
                PRIMARY KEY (collection_id, image_id),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
            );
            INSERT OR IGNORE INTO collections (id, name, created_at, source)
            SELECT DISTINCT board_id, board_id, (strftime('%s', 'now') * 1000), 'invoke'
            FROM images 
            WHERE board_id IS NOT NULL;
            
            INSERT OR IGNORE INTO collection_images (collection_id, image_id)
            SELECT board_id, id 
            FROM images 
            WHERE board_id IS NOT NULL;
        ",
        kind: MigrationKind::Up,
    };

    let migration5 = Migration {
        version: 5,
        description: "fix_timestamp_units",
        sql: "UPDATE images SET timestamp = timestamp * 1000 WHERE timestamp > 1000000000 AND timestamp < 10000000000;",
        kind: MigrationKind::Up,
    };

    let migration6 = Migration {
        version: 6,
        description: "create_models_table",
        sql: "CREATE TABLE IF NOT EXISTS models (
            hash TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            filename TEXT,
            lookup_source TEXT,
            civitai_version_id INTEGER,
            scanned_at INTEGER
        );",
        kind: MigrationKind::Up,
    };

    let migration7 = Migration {
        version: 7,
        description: "add_model_thumbnails",
        sql: "ALTER TABLE models ADD COLUMN thumbnail_path TEXT;
              ALTER TABLE models ADD COLUMN preview_url TEXT;",
        kind: MigrationKind::Up,
    };

    let migration8 = Migration {
        version: 8,
        description: "add_indices_to_models",
        sql: "CREATE INDEX IF NOT EXISTS idx_models_name ON models(name);
              CREATE INDEX IF NOT EXISTS idx_models_filename ON models(filename);",
        kind: MigrationKind::Up,
    };

    let migration9 = Migration {
        version: 9,
        description: "add_resource_type_to_models",
        sql: "ALTER TABLE models ADD COLUMN resource_type TEXT;
              CREATE INDEX IF NOT EXISTS idx_models_resource_type ON models(resource_type);
              UPDATE models SET resource_type = 'checkpoint' WHERE resource_type IS NULL OR resource_type = '';",
        kind: MigrationKind::Up,
    };

    let migration10 = Migration {
        version: 10,
        description: "create_facet_cache_table",
        sql: "CREATE TABLE IF NOT EXISTS facet_cache (
            facet_type TEXT NOT NULL,
            resource_name TEXT NOT NULL,
            resource_hash TEXT,
            count INTEGER DEFAULT 0,
            thumbnail_path TEXT,
            preview_url TEXT,
            PRIMARY KEY (facet_type, resource_name)
        );
        CREATE INDEX IF NOT EXISTS idx_facet_cache_type ON facet_cache(facet_type);
        CREATE INDEX IF NOT EXISTS idx_images_is_deleted ON images(is_deleted);",
        kind: MigrationKind::Up,
    };

    let migration11 = Migration {
        version: 11,
        description: "add_model_hash_index",
        sql: "CREATE INDEX IF NOT EXISTS idx_images_model_hash ON images(json_extract(metadata_json, '$.modelHash'));",
        kind: MigrationKind::Up,
    };

    vec![migration, migration2, migration3, migration4, migration5, migration6, migration7, migration8, migration9, migration10, migration11]
}

// Helper to resolve the correct DB path used by tauri-plugin-sql
pub fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. Prioritize Roaming (app_config_dir/app_data_dir) - This is where 6GB db lives
    if let Ok(mut path) = app.path().app_config_dir() {
        path.push("images.db");
        if path.exists() {
            return Ok(path);
        }
    }

    // 2. Fallback to Local (app_local_data_dir)
    if let Ok(mut path) = app.path().app_local_data_dir() {
        path.push("images.db");
        if path.exists() {
            return Ok(path);
        }
    }

    // 3. Absolute default
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push("images.db");
    Ok(path)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_db_diagnostics(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        
        let image_count: i64 = conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0)).unwrap_or(0);
        let deleted_count: i64 = conn.query_row("SELECT COUNT(*) FROM images WHERE is_deleted = 1", [], |r| r.get(0)).unwrap_or(0);
        let model_count: i64 = conn.query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0)).unwrap_or(0);
        let cache_count: i64 = conn.query_row("SELECT COUNT(*) FROM facet_cache", [], |r| r.get(0)).unwrap_or(0);
        let tool_null_count: i64 = conn.query_row("SELECT COUNT(*) FROM images WHERE json_extract(metadata_json, '$.tool') IS NULL", [], |r| r.get(0)).unwrap_or(0);

        Ok(serde_json::json!({
            "dbPath": db_path.to_string_lossy(),
            "imageCount": image_count,
            "deletedCount": deleted_count,
            "modelCount": model_count,
            "cacheCount": cache_count,
            "toolNullCount": tool_null_count,
        }))
    }).await.map_err(|e| e.to_string())?
}

/// Diagnostic command to analyze LoRA distribution by tool.
/// Helps debug the facet cache LoRA count discrepancy.
#[tauri::command(rename_all = "camelCase")]
pub async fn diagnose_lora_counts(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

        // 1. Count images with LoRAs by tool
        let mut stmt = conn.prepare(
            "SELECT json_extract(metadata_json, '$.tool') as tool, 
                    COUNT(*) as total,
                    SUM(CASE WHEN json_array_length(metadata_json, '$.loras') > 0 THEN 1 ELSE 0 END) as with_loras
             FROM images 
             WHERE is_deleted = 0 
             GROUP BY tool"
        ).map_err(|e| e.to_string())?;

        let tool_stats: Vec<serde_json::Value> = stmt.query_map([], |row| {
            let tool: Option<String> = row.get(0)?;
            let total: i64 = row.get(1)?;
            let with_loras: i64 = row.get(2)?;
            Ok(serde_json::json!({
                "tool": tool.unwrap_or_else(|| "NULL".to_string()),
                "total": total,
                "withLoras": with_loras
            }))
        }).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

        // 2. Get facet cache summary for loras
        let facet_lora_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM facet_cache WHERE facet_type = 'loras'",
            [], |r| r.get(0)
        ).unwrap_or(0);

        let facet_lora_total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(count), 0) FROM facet_cache WHERE facet_type = 'loras'",
            [], |r| r.get(0)
        ).unwrap_or(0);

        // 3. Get unique lora references from images (sample top 10)
        let mut lora_stmt = conn.prepare(
            "SELECT j.value, COUNT(DISTINCT i.id) as cnt
             FROM images i, json_each(i.metadata_json, '$.loras') j
             WHERE i.is_deleted = 0
             GROUP BY j.value
             ORDER BY cnt DESC
             LIMIT 10"
        ).map_err(|e| e.to_string())?;

        let top_loras: Vec<serde_json::Value> = lora_stmt.query_map([], |row| {
            let name: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok(serde_json::json!({ "name": name, "imageCount": count }))
        }).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

        // 4. Get models table lora count
        let models_lora_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM models WHERE resource_type = 'loras'",
            [], |r| r.get(0)
        ).unwrap_or(0);

        // 5. Check for LoRAs in images but not in models (potential harvest failure)
        let orphan_count: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT j.value) 
             FROM images i, json_each(i.metadata_json, '$.loras') j
             WHERE i.is_deleted = 0 
             AND NOT EXISTS (
                 SELECT 1 FROM models m 
                 WHERE m.resource_type = 'loras' 
                 AND (j.value = m.name OR j.value LIKE m.name || ' (%' OR j.value LIKE m.name || ':%')
             )",
            [], |r| r.get(0)
        ).unwrap_or(-1);

        Ok(serde_json::json!({
            "toolStats": tool_stats,
            "facetCache": {
                "loraTypes": facet_lora_count,
                "loraImageTotal": facet_lora_total
            },
            "modelsTable": {
                "loraCount": models_lora_count
            },
            "topLoras": top_loras,
            "orphanLoraRefCount": orphan_count
        }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_images_batch(app: tauri::AppHandle, images: Vec<ImageRecord>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        
        // Retry loop for database lock issues
        let max_retries = 5;
        let mut retry_delay_ms = 100;
        
        for attempt in 0..max_retries {
            let result = (|| -> Result<usize, String> {
                let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

                let _ = conn.execute("PRAGMA journal_mode=WAL", []);
                let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
                let _ = conn.execute("PRAGMA busy_timeout=60000", []); // Increased to 60s

                let tx = conn.transaction().map_err(|e| e.to_string())?;

                {
                    let mut stmt = tx.prepare_cached(
                        "INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                         ON CONFLICT(id) DO UPDATE SET 
                            path=excluded.path,
                            timestamp=excluded.timestamp, 
                            file_size=excluded.file_size,
                            metadata_json=excluded.metadata_json,
                            thumbnail_path=excluded.thumbnail_path,
                            is_favorite=excluded.is_favorite,
                            is_pinned=excluded.is_pinned,
                            group_id=excluded.group_id,
                            board_id=excluded.board_id,
                            notes=excluded.notes,
                            original_metadata_json=excluded.original_metadata_json"
                    ).map_err(|e| e.to_string())?;

                    for img in &images {
                        stmt.execute(params![
                            img.id,
                            img.path,
                            img.width,
                            img.height,
                            img.file_size as i64,
                            img.timestamp as i64,
                            img.metadata_json,
                            img.thumbnail_path,
                            img.is_favorite,
                            img.is_pinned,
                            img.is_deleted,
                            img.is_missing,
                            img.user_masked,
                            img.group_id,
                            img.board_id,
                            img.notes,
                            img.original_metadata_json
                        ])
                        .map_err(|e| e.to_string())?;
                    }
                }

                tx.commit().map_err(|e| e.to_string())?;
                Ok(images.len())
            })();
            
            match result {
                Ok(count) => return Ok(count),
                Err(e) if e.contains("database is locked") && attempt < max_retries - 1 => {
                    std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                    retry_delay_ms *= 2; // Exponential backoff
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
        
        Err("Failed to save images after max retries".to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn refresh_boards_native(
    app: tauri::AppHandle,
    board_mapping: HashMap<String, String>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

        let _ = conn.execute("PRAGMA journal_mode=WAL", []);
        let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
        let _ = conn.execute("PRAGMA busy_timeout=60000", []);

        let images_to_check: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, path FROM images WHERE board_id IS NULL")
                .map_err(|e| e.to_string())?;
            let items = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            items
        };

        if images_to_check.is_empty() {
            return Ok(0);
        }

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut updated_count = 0;

        {
            let mut update_stmt = tx
                .prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2")
                .map_err(|e| e.to_string())?;

            for (id, path) in images_to_check {
                let filename = path
                    .split('/')
                    .last()
                    .or_else(|| path.split('\\').last())
                    .unwrap_or(&path);

                if let Some(board_name) = board_mapping.get(filename) {
                    update_stmt
                        .execute(params![board_name, id])
                        .map_err(|e| e.to_string())?;
                    updated_count += 1;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(updated_count)
    }).await.map_err(|e| e.to_string())?
}

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    current: usize,
    total: usize,
    message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rebuild_facet_cache(app: tauri::AppHandle) -> Result<usize, String> {
    use tauri::Emitter;

    tauri::async_runtime::spawn_blocking(move || {
        let start_total = std::time::Instant::now();
        let db_path = resolve_db_path(&app)?;
        let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

        let _ = conn.execute("PRAGMA journal_mode=WAL", []);
        let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
        let _ = conn.execute("PRAGMA busy_timeout=60000", []);

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
            build_lora_facets(&tx)?;
            println!("[FacetCache] LoRAs built in {:?}.", start_lora.elapsed());

            // 3. Embeddings
            println!("[FacetCache] Building Embeddings...");
            let start_emb = std::time::Instant::now();
            let _ = app.emit("facet_cache_progress", ProgressPayload { current: 4, total: 6, message: "Building Embeddings cache...".into() });
            build_embedding_facets(&tx)?;
            println!("[FacetCache] Embeddings built in {:?}.", start_emb.elapsed());

            // 4. Hypernetworks
            println!("[FacetCache] Building Hypernetworks...");
            let start_hyper = std::time::Instant::now();
            let _ = app.emit("facet_cache_progress", ProgressPayload { current: 5, total: 6, message: "Building Hypernetworks cache...".into() });
            build_hypernetwork_facets(&tx)?;
            println!("[FacetCache] Hypernetworks built in {:?}.", start_hyper.elapsed());

            // 5. Tools
            build_tool_facets(&tx)?;

            tx.commit().map_err(|e| e.to_string())?;

            // Return total cache entries
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            count
        };

        println!("[FacetCache] Rebuild complete in {:?}. Total entries: {}", start_total.elapsed(), count_result);
        let _ = app.emit("facet_cache_progress", ProgressPayload { current: 6, total: 6, message: "Cache rebuild complete.".into() });

        Ok(count_result as usize)
    }).await.map_err(|e| e.to_string())?
}

/// Populates the `models` table from metadata found in the `images` table.
/// This ensures that even if we haven't scanned model files on disk, we know about the models referenced by images.
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

    // Harvest LoRAs
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
            params![now]
    ).map_err(|e| format!("Harvest LoRAs failed: {}", e))?;

    // Harvest Embeddings
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
            SELECT DISTINCT 
            'emb_' || clean_name, 
            clean_name, 
            'harvest_embedding', 
            ?1,
            'embeddings'
            FROM (
                SELECT 
                    CASE 
                        WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                        WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                        ELSE j.value 
                    END as clean_name
                FROM images, json_each(metadata_json, '$.embeddings') j
            )
            WHERE clean_name IS NOT NULL AND clean_name != ''",
            params![now]
    ).map_err(|e| format!("Harvest Embeddings failed: {}", e))?;

    // Harvest Hypernetworks
    conn.execute(
        "INSERT OR IGNORE INTO models (hash, name, lookup_source, scanned_at, resource_type) 
            SELECT DISTINCT 
            'hyper_' || clean_name, 
            clean_name, 
            'harvest_hypernet', 
            ?1,
            'hypernetworks'
            FROM (
                SELECT 
                    CASE 
                        WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                        WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                        ELSE j.value 
                    END as clean_name
                FROM images, json_each(metadata_json, '$.hypernetworks') j
            )
            WHERE clean_name IS NOT NULL AND clean_name != ''",
            params![now]
    ).map_err(|e| format!("Harvest Hypernetworks failed: {}", e))?;

    Ok(())
}

/// Optimization Note:
/// We use a Pre-Aggregation pattern (Temp Table) instead of correlated subqueries.
/// 
/// OLD (Slow): O(N*M)
/// SELECT ..., (SELECT COUNT(*) FROM images WHERE json_extract(...) = m.hash) FROM models m
/// This ran a full table scan + JSON parse on `images` for every single model row.
/// 
/// NEW (Fast): O(N + M)
/// 1. Create a TEMP table `counts` by scanning `images` ONCE.
/// 2. Simple JOIN `models` with `counts`.
/// This scales linearly with library size and is practically instant.

fn build_checkpoint_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    // Step 1: Pre-aggregate checkboxes
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS cp_counts AS
            SELECT json_extract(metadata_json, '$.modelHash') as mh, COUNT(DISTINCT id) as cnt
            FROM images 
            WHERE is_deleted = 0 AND mh IS NOT NULL
            GROUP BY mh",
        []
    ).map_err(|e| format!("Failed to create cp_counts temp table: {}", e))?;

    // Step 2: Join
    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url)
            SELECT 'checkpoint', m.name, MIN(m.hash), 
                COALESCE(SUM(cc.cnt), 0), 
                MAX(m.thumbnail_path), MAX(m.preview_url)
            FROM models m
            LEFT JOIN cp_counts cc ON cc.mh = m.hash
            WHERE m.resource_type = 'checkpoint'
            GROUP BY m.name",
        []
    ).map_err(|e| format!("Failed to insert checkpoints: {}", e))?;

    conn.execute("DROP TABLE IF EXISTS cp_counts", []).ok();
    Ok(())
}

fn build_lora_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    // Step 1: Pre-aggregate all lora references from images (O(N) scan once)
    // Also extract the "clean" name for better matching.
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS lora_counts AS
            SELECT 
                j.value AS lora_ref,
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END AS clean_ref,
                COUNT(DISTINCT i.id) AS cnt
            FROM images i, json_each(i.metadata_json, '$.loras') j
            WHERE i.is_deleted = 0
            GROUP BY j.value",
        []
    ).map_err(|e| format!("Failed to create lora_counts temp table: {}", e))?;

    // Step 2: Insert facets for LoRAs that exist in models table with fuzzy matching
    // This handles LoRAs that we've scanned from disk or resolved from CivitAI
    // NOTE: We deduplicate models by name using a subquery to prevent "double counting"
    // if multiple model entries (different hashes) share the same name.
    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url)
            SELECT 'loras', m.name, m.hash,
                COALESCE(SUM(lc.cnt), 0),
                m.thumbnail_path, m.preview_url
            FROM (
                SELECT name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(preview_url) as preview_url
                FROM models 
                WHERE resource_type = 'loras'
                GROUP BY name
            ) m
            LEFT JOIN lora_counts lc ON (
                lc.lora_ref = m.name OR 
                lc.clean_ref = m.name OR
                lc.lora_ref LIKE m.name || ' (%' OR
                lc.lora_ref LIKE m.name || ':%' OR
                m.name LIKE lc.clean_ref || '%'
            )
            GROUP BY m.name",
        []
    ).map_err(|e| format!("Failed to insert loras into facet_cache: {}", e))?;

    // Step 3: Insert "orphan" LoRAs that are referenced in images but not in models table.
    // This ensures we don't miss any LoRAs just because they weren't scanned from disk.
    conn.execute(
        "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count)
            SELECT 'loras', lc.clean_ref, 'orphan_' || lc.clean_ref, SUM(lc.cnt)
            FROM lora_counts lc
            WHERE NOT EXISTS (
                SELECT 1 FROM facet_cache fc 
                WHERE fc.facet_type = 'loras' 
                AND (fc.resource_name = lc.clean_ref OR fc.resource_name = lc.lora_ref)
            )
            AND lc.clean_ref IS NOT NULL AND lc.clean_ref != ''
            GROUP BY lc.clean_ref",
        []
    ).map_err(|e| format!("Failed to insert orphan loras into facet_cache: {}", e))?;

    conn.execute("DROP TABLE IF EXISTS lora_counts", []).ok();
    Ok(())
}


fn build_embedding_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS embedding_counts AS
            SELECT 
                j.value AS embed_name,
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END AS clean_ref,
                COUNT(DISTINCT i.id) AS cnt
            FROM images i, json_each(i.metadata_json, '$.embeddings') j
            WHERE i.is_deleted = 0
            GROUP BY j.value",
        []
    ).map_err(|e| format!("Failed to create embedding_counts temp table: {}", e))?;

    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url)
            SELECT 'embeddings', m.name, m.hash,
                COALESCE(SUM(ec.cnt), 0),
                m.thumbnail_path, m.preview_url
            FROM (
                SELECT name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(preview_url) as preview_url
                FROM models 
                WHERE resource_type = 'embeddings'
                GROUP BY name
            ) m
            LEFT JOIN embedding_counts ec ON (
                ec.embed_name = m.name OR
                ec.clean_ref = m.name OR
                ec.embed_name LIKE m.name || ' (%' OR
                ec.embed_name LIKE m.name || ':%' OR
                m.name LIKE ec.clean_ref || '%'
            )
            GROUP BY m.name",
        []
    ).map_err(|e| format!("Failed to insert embeddings into facet_cache: {}", e))?;

    // Insert orphan embeddings not matched to models
    conn.execute(
        "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count)
            SELECT 'embeddings', ec.clean_ref, 'orphan_' || ec.clean_ref, SUM(ec.cnt)
            FROM embedding_counts ec
            WHERE NOT EXISTS (
                SELECT 1 FROM facet_cache fc 
                WHERE fc.facet_type = 'embeddings' 
                AND (fc.resource_name = ec.clean_ref OR fc.resource_name = ec.embed_name)
            )
            AND ec.clean_ref IS NOT NULL AND ec.clean_ref != ''
            GROUP BY ec.clean_ref",
        []
    ).map_err(|e| format!("Failed to insert orphan embeddings: {}", e))?;

    conn.execute("DROP TABLE IF EXISTS embedding_counts", []).ok();
    Ok(())
}

fn build_hypernetwork_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TEMP TABLE IF NOT EXISTS hypernet_counts AS
            SELECT 
                j.value AS hypernet_name,
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END AS clean_ref,
                COUNT(DISTINCT i.id) AS cnt
            FROM images i, json_each(i.metadata_json, '$.hypernetworks') j
            WHERE i.is_deleted = 0
            GROUP BY j.value",
        []
    ).map_err(|e| format!("Failed to create hypernet_counts temp table: {}", e))?;

    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url)
            SELECT 'hypernetworks', m.name, m.hash,
                COALESCE(SUM(hc.cnt), 0),
                m.thumbnail_path, m.preview_url
            FROM (
                SELECT name, MIN(hash) as hash, MAX(thumbnail_path) as thumbnail_path, MAX(preview_url) as preview_url
                FROM models 
                WHERE resource_type = 'hypernetworks'
                GROUP BY name
            ) m
            LEFT JOIN hypernet_counts hc ON (
                hc.hypernet_name = m.name OR
                hc.clean_ref = m.name OR
                hc.hypernet_name LIKE m.name || ' (%' OR
                hc.hypernet_name LIKE m.name || ':%' OR
                m.name LIKE hc.clean_ref || '%'
            )
            GROUP BY m.name",
        []
    ).map_err(|e| format!("Failed to insert hypernetworks into facet_cache: {}", e))?;

    // Insert orphan hypernetworks not matched to models
    conn.execute(
        "INSERT OR IGNORE INTO facet_cache (facet_type, resource_name, resource_hash, count)
            SELECT 'hypernetworks', hc.clean_ref, 'orphan_' || hc.clean_ref, SUM(hc.cnt)
            FROM hypernet_counts hc
            WHERE NOT EXISTS (
                SELECT 1 FROM facet_cache fc 
                WHERE fc.facet_type = 'hypernetworks' 
                AND (fc.resource_name = hc.clean_ref OR fc.resource_name = hc.hypernet_name)
            )
            AND hc.clean_ref IS NOT NULL AND hc.clean_ref != ''
            GROUP BY hc.clean_ref",
        []
    ).map_err(|e| format!("Failed to insert orphan hypernetworks: {}", e))?;

    conn.execute("DROP TABLE IF EXISTS hypernet_counts", []).ok();
    Ok(())
}


fn build_tool_facets(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "INSERT INTO facet_cache (facet_type, resource_name, resource_hash, count)
            SELECT 'tools', COALESCE(json_extract(metadata_json, '$.tool'), 'Unknown'), NULL, COUNT(*)
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

    #[test]
    fn test_rebuild_facet_cache() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();

        // 1. Setup Schema using execute_batch which supports multiple statements
        let migrations = init_db();
        for m in migrations {
            conn.execute_batch(&m.sql).unwrap();
        }

        // 2. Insert Test Data
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

        // Image 2: Variants
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

        // 3. Harvest Models (Should populate models table)
        harvest_models(&conn).unwrap();
        
        let model_count: i64 = conn.query_row("SELECT COUNT(*) FROM models", [], |r| r.get(0)).unwrap();
        assert!(model_count > 0, "Models should be populated from harvest");

        // 4. Build Facets
        build_checkpoint_facets(&conn).unwrap();
        build_lora_facets(&conn).unwrap();
        build_embedding_facets(&conn).unwrap();
        build_hypernetwork_facets(&conn).unwrap(); // Added hypernet check
        build_tool_facets(&conn).unwrap();

        // 5. Verify facet_cache
        // Checkpoint: SDXL Base (count should be 2 if modelHash is different but name same? Or 1+1. Wait, metadata2 has diff hash? No, I put 123456)
        // Checkpoint aggregation groups by NAME.
        // img1: SDXL Base (hash 12345). img2: SDXL Base (hash 123456).
        // Models table will have TWO rows (one for each hash).
        // Facet Cache groups by name. Count should be 2.
        let cp_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='checkpoint' AND resource_name='SDXL Base'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(cp_count, 2, "Should count 2 images for SDXL Base");

        let lora_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='loras' AND resource_name='DetailedEyes'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(lora_count, 1, "Should count 1 image for DetailedEyes lora");
        
        // Verify Embedding Grouping (Exact + Versioned)
        // EasyNegative (img1) + EasyNegative:v2 (img2) -> Count 2
        let emb_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='embeddings' AND resource_name='EasyNegative'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(emb_count, 2, "Should count 2 images for EasyNegative (Base + v2)");

        // Verify Hypernetwork
        let hyper_count: i64 = conn.query_row(
            "SELECT count FROM facet_cache WHERE facet_type='hypernetworks' AND resource_name='MyHyper'", 
            [], |r| r.get(0)).unwrap_or(0);
        assert_eq!(hyper_count, 1, "Should count 1 image for MyHyper");
    }
}
