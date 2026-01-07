use tauri_plugin_sql::{Migration, MigrationKind};

pub fn init_db() -> Vec<Migration> {
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

    let migration12 = Migration {
        version: 12,
        description: "add_sorting_fields_to_facet_cache",
        sql: "ALTER TABLE facet_cache ADD COLUMN last_used_at INTEGER;
              ALTER TABLE facet_cache ADD COLUMN created_at INTEGER;",
        kind: MigrationKind::Up,
    };

    let migration13 = Migration {
        version: 13,
        description: "add_model_name_index",
        sql: "CREATE INDEX IF NOT EXISTS idx_images_model_name ON images(json_extract(metadata_json, '$.model'));",
        kind: MigrationKind::Up,
    };

    let migration14 = Migration {
        version: 14,
        description: "add_tool_name_index",
        sql: "CREATE INDEX IF NOT EXISTS idx_images_tool_name ON images(json_extract(metadata_json, '$.tool'));",
        kind: MigrationKind::Up,
    };

    let migration15 = Migration {
        version: 15,
        description: "add_sorting_indices",
        sql: "CREATE INDEX IF NOT EXISTS idx_images_is_pinned ON images(is_pinned);
              CREATE INDEX IF NOT EXISTS idx_images_timestamp ON images(timestamp);",
        kind: MigrationKind::Up,
    };

    let migration16 = Migration {
        version: 16,
        description: "add_generated_columns",
        sql: "ALTER TABLE images ADD COLUMN is_intermediate_gen INTEGER GENERATED ALWAYS AS (json_extract(metadata_json, '$.isIntermediate')) VIRTUAL;
              ALTER TABLE images ADD COLUMN is_grid_gen INTEGER GENERATED ALWAYS AS (json_extract(metadata_json, '$.isGrid')) VIRTUAL;
              CREATE INDEX IF NOT EXISTS idx_images_is_intermediate_gen ON images(is_intermediate_gen);
              CREATE INDEX IF NOT EXISTS idx_images_is_grid_gen ON images(is_grid_gen);",
        kind: MigrationKind::Up,
    };

    // Performance optimization: compound covering index for common filter pattern
    let migration17 = Migration {
        version: 17,
        description: "add_compound_covering_index",
        sql: "CREATE INDEX IF NOT EXISTS idx_images_filter_covering ON images(is_deleted, is_intermediate_gen, is_grid_gen, timestamp DESC);
              CREATE INDEX IF NOT EXISTS idx_collection_images_lookup ON collection_images(image_id, collection_id);",
        kind: MigrationKind::Up,
    };

    // Major performance optimization: denormalize frequently-queried JSON fields
    // Note: SQLite doesn't allow STORED generated columns via ALTER TABLE, so we use
    // regular columns populated via UPDATE statements
    let migration18 = Migration {
        version: 18,
        description: "denormalize_metadata_for_performance",
        sql: "
            -- Add regular columns for denormalized data (not generated columns due to SQLite limitation)
            ALTER TABLE images ADD COLUMN model_hash TEXT;
            ALTER TABLE images ADD COLUMN model_name TEXT;
            ALTER TABLE images ADD COLUMN tool TEXT;
            ALTER TABLE images ADD COLUMN resolved_model_name TEXT;
            
            -- Populate model_hash from JSON
            UPDATE images SET model_hash = json_extract(metadata_json, '$.modelHash') 
                WHERE model_hash IS NULL AND metadata_json IS NOT NULL;
            
            -- Populate model_name from JSON
            UPDATE images SET model_name = json_extract(metadata_json, '$.model') 
                WHERE model_name IS NULL AND metadata_json IS NOT NULL;
            
            -- Populate tool from JSON
            UPDATE images SET tool = json_extract(metadata_json, '$.tool') 
                WHERE tool IS NULL AND metadata_json IS NOT NULL;
            
            -- Populate resolved_model_name from models table first
            UPDATE images SET resolved_model_name = (
                SELECT m.name FROM models m 
                WHERE m.hash = json_extract(images.metadata_json, '$.modelHash')
            ) WHERE resolved_model_name IS NULL;
            
            -- Fall back to model_name if no match in models table
            UPDATE images SET resolved_model_name = model_name 
                WHERE resolved_model_name IS NULL AND model_name IS NOT NULL;
            
            -- Indexes for fast filtering on denormalized columns
            CREATE INDEX IF NOT EXISTS idx_images_model_hash_denorm ON images(model_hash);
            CREATE INDEX IF NOT EXISTS idx_images_tool_denorm ON images(tool);
            CREATE INDEX IF NOT EXISTS idx_images_resolved_model ON images(resolved_model_name);
            
            -- Composite index for common filter patterns
            CREATE INDEX IF NOT EXISTS idx_images_filter_model ON images(is_deleted, resolved_model_name, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_images_filter_tool ON images(is_deleted, tool, timestamp DESC);
            
            -- Optimized collection lookup
            CREATE INDEX IF NOT EXISTS idx_collection_images_by_collection ON collection_images(collection_id, image_id);
        ",
        kind: MigrationKind::Up,
    };

    // Run ANALYZE to update query planner statistics - critical for large databases
    let migration19 = Migration {
        version: 19,
        description: "run_analyze_for_query_planner",
        sql: "
            -- Update statistics for query planner to choose optimal indexes
            ANALYZE images;
            ANALYZE collection_images;
            ANALYZE models;
            ANALYZE facet_cache;
        ",
        kind: MigrationKind::Up,
    };

    // Denormalize LoRAs, Embeddings, Hypernetworks into junction tables for fast filtering
    let migration20 = Migration {
        version: 20,
        description: "denormalize_resources_junction_tables",
        sql: "
            -- Junction table for LoRAs (many-to-many: images <-> loras)
            CREATE TABLE IF NOT EXISTS image_loras (
                image_id TEXT NOT NULL,
                lora_name TEXT NOT NULL,
                PRIMARY KEY (image_id, lora_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_lora_by_name ON image_loras(lora_name);
            
            -- Junction table for Embeddings
            CREATE TABLE IF NOT EXISTS image_embeddings (
                image_id TEXT NOT NULL,
                embedding_name TEXT NOT NULL,
                PRIMARY KEY (image_id, embedding_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_embedding_by_name ON image_embeddings(embedding_name);
            
            -- Junction table for Hypernetworks
            CREATE TABLE IF NOT EXISTS image_hypernetworks (
                image_id TEXT NOT NULL,
                hypernetwork_name TEXT NOT NULL,
                PRIMARY KEY (image_id, hypernetwork_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_hypernetwork_by_name ON image_hypernetworks(hypernetwork_name);
            
            -- Populate LoRAs from existing JSON (strip version suffixes for matching)
            INSERT OR IGNORE INTO image_loras (image_id, lora_name)
            SELECT i.id, 
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END
            FROM images i, json_each(i.metadata_json, '$.loras') j
            WHERE j.value IS NOT NULL AND j.value != '';
            
            -- Populate Embeddings from existing JSON
            INSERT OR IGNORE INTO image_embeddings (image_id, embedding_name)
            SELECT i.id, 
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END
            FROM images i, json_each(i.metadata_json, '$.embeddings') j
            WHERE j.value IS NOT NULL AND j.value != '';
            
            -- Populate Hypernetworks from existing JSON
            INSERT OR IGNORE INTO image_hypernetworks (image_id, hypernetwork_name)
            SELECT i.id, 
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END
            FROM images i, json_each(i.metadata_json, '$.hypernetworks') j
            WHERE j.value IS NOT NULL AND j.value != '';
            
            -- Update ANALYZE for new tables
            ANALYZE image_loras;
            ANALYZE image_embeddings;
            ANALYZE image_hypernetworks;
        ",
        kind: MigrationKind::Up,
    };

    let migration21 = Migration {
        version: 21,
        description: "create_fts_and_cleanup",
        sql: "
            -- 1. Safety Fix: Clean up orphans before enabling Foreign Keys
            DELETE FROM collection_images WHERE image_id NOT IN (SELECT id FROM images);
            DELETE FROM collection_images WHERE collection_id NOT IN (SELECT id FROM collections);
            DELETE FROM image_loras WHERE image_id NOT IN (SELECT id FROM images);
            DELETE FROM image_embeddings WHERE image_id NOT IN (SELECT id FROM images);
            DELETE FROM image_hypernetworks WHERE image_id NOT IN (SELECT id FROM images);

            -- 1.5. Clean State: Drop existing FTS table if it exists (fixes schema mismatch)
            DROP TABLE IF EXISTS images_fts;

            -- 2. Create FTS5 Table for Text Search
            CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
                id,
                positive_prompt, 
                negative_prompt
            );

            -- 3. Backfill FTS Data
            INSERT INTO images_fts(id, positive_prompt, negative_prompt)
            SELECT id, 
                   json_extract(metadata_json, '$.positivePrompt'),
                   json_extract(metadata_json, '$.negativePrompt')
            FROM images;

            -- 4. Triggers to Keep FTS Sync using standard triggers
            CREATE TRIGGER IF NOT EXISTS trg_images_ai AFTER INSERT ON images BEGIN
                INSERT INTO images_fts(id, positive_prompt, negative_prompt)
                VALUES (new.id, json_extract(new.metadata_json, '$.positivePrompt'), json_extract(new.metadata_json, '$.negativePrompt'));
            END;

            CREATE TRIGGER IF NOT EXISTS trg_images_ad AFTER DELETE ON images BEGIN
                DELETE FROM images_fts WHERE id = old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_images_au AFTER UPDATE ON images BEGIN
                UPDATE images_fts SET 
                    positive_prompt = json_extract(new.metadata_json, '$.positivePrompt'),
                    negative_prompt = json_extract(new.metadata_json, '$.negativePrompt')
                WHERE id = old.id;
            END;
        ",
        kind: MigrationKind::Up,
    };

    vec![migration, migration2, migration3, migration4, migration5, migration6, migration7, migration8, migration9, migration10, migration11, migration12, migration13, migration14, migration15, migration16, migration17, migration18, migration19, migration20, migration21]
}
