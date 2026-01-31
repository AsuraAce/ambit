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

    let migration22 = Migration {
        version: 22,
        description: "optimize_strict_and_stored",
        sql: "
            PRAGMA foreign_keys = OFF;

            -- 1. IMAGES (Strict + Stored Columns)
            CREATE TABLE images_new (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                width INTEGER,
                height INTEGER,
                file_size INTEGER,
                timestamp INTEGER,
                metadata_json TEXT,
                thumbnail_path TEXT,
                is_favorite INTEGER DEFAULT 0 NOT NULL,
                is_pinned INTEGER DEFAULT 0 NOT NULL,
                is_deleted INTEGER DEFAULT 0 NOT NULL,
                is_missing INTEGER DEFAULT 0 NOT NULL,
                user_masked INTEGER DEFAULT 0 NOT NULL,
                group_id TEXT,
                notes TEXT,
                original_metadata_json TEXT,
                board_id TEXT,
                model_hash TEXT,
                model_name TEXT,
                tool TEXT,
                resolved_model_name TEXT,
                
                -- Generated Columns (Now STORED for performance)
                is_intermediate_gen INTEGER GENERATED ALWAYS AS (cast(json_extract(metadata_json, '$.isIntermediate') as INTEGER)) STORED,
                is_grid_gen INTEGER GENERATED ALWAYS AS (cast(json_extract(metadata_json, '$.isGrid') as INTEGER)) STORED
            ) STRICT;

            INSERT INTO images_new (
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, notes,
                original_metadata_json, board_id, model_hash, model_name, tool, resolved_model_name
            )
            SELECT 
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                COALESCE(is_favorite, 0), COALESCE(is_pinned, 0), COALESCE(is_deleted, 0), COALESCE(is_missing, 0), COALESCE(user_masked, 0), group_id, notes,
                original_metadata_json, board_id, model_hash, model_name, tool, resolved_model_name
            FROM images;

            DROP TABLE images;
            ALTER TABLE images_new RENAME TO images;

            -- 2. COLLECTIONS (Strict)
            CREATE TABLE collections_new (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT,
                is_archived INTEGER DEFAULT 0 NOT NULL,
                is_pinned INTEGER DEFAULT 0 NOT NULL,
                created_at INTEGER,
                filter_state TEXT,
                manual_exclusions TEXT,
                custom_thumbnail TEXT,
                source TEXT DEFAULT 'ambit'
            ) STRICT;

            INSERT INTO collections_new SELECT 
                id, name, color, COALESCE(is_archived, 0), COALESCE(is_pinned, 0), created_at, filter_state, manual_exclusions, custom_thumbnail, source 
            FROM collections;

            DROP TABLE collections;
            ALTER TABLE collections_new RENAME TO collections;

            -- 3. MODELS (Strict)
            CREATE TABLE models_new (
                hash TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                filename TEXT,
                lookup_source TEXT,
                civitai_version_id INTEGER,
                scanned_at INTEGER,
                thumbnail_path TEXT,
                preview_url TEXT,
                resource_type TEXT
            ) STRICT;

            INSERT INTO models_new SELECT * FROM models;

            DROP TABLE models;
            ALTER TABLE models_new RENAME TO models;

            -- 4. JUNCTION TABLES (Strict)
            CREATE TABLE collection_images_new (
                collection_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                PRIMARY KEY (collection_id, image_id),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT INTO collection_images_new SELECT collection_id, image_id FROM collection_images;
            DROP TABLE collection_images;
            ALTER TABLE collection_images_new RENAME TO collection_images;

            CREATE TABLE image_loras_new (
                image_id TEXT NOT NULL,
                lora_name TEXT NOT NULL,
                PRIMARY KEY (image_id, lora_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT INTO image_loras_new SELECT image_id, lora_name FROM image_loras;
            DROP TABLE image_loras;
            ALTER TABLE image_loras_new RENAME TO image_loras;

            CREATE TABLE image_embeddings_new (
                image_id TEXT NOT NULL,
                embedding_name TEXT NOT NULL,
                PRIMARY KEY (image_id, embedding_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT INTO image_embeddings_new SELECT image_id, embedding_name FROM image_embeddings;
            DROP TABLE image_embeddings;
            ALTER TABLE image_embeddings_new RENAME TO image_embeddings;

            CREATE TABLE image_hypernetworks_new (
                image_id TEXT NOT NULL,
                hypernetwork_name TEXT NOT NULL,
                PRIMARY KEY (image_id, hypernetwork_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT INTO image_hypernetworks_new SELECT image_id, hypernetwork_name FROM image_hypernetworks;
            DROP TABLE image_hypernetworks;
            ALTER TABLE image_hypernetworks_new RENAME TO image_hypernetworks;

            -- 5. FACET CACHE (Strict)
            CREATE TABLE facet_cache_new (
                facet_type TEXT NOT NULL,
                resource_name TEXT NOT NULL,
                resource_hash TEXT,
                count INTEGER DEFAULT 0,
                thumbnail_path TEXT,
                preview_url TEXT,
                last_used_at INTEGER,
                created_at INTEGER,
                PRIMARY KEY (facet_type, resource_name)
            ) STRICT;
            INSERT INTO facet_cache_new SELECT * FROM facet_cache;
            DROP TABLE facet_cache;
            ALTER TABLE facet_cache_new RENAME TO facet_cache;

            -- 6. INDEXES (Recreate)
            CREATE INDEX idx_images_path ON images(path);
            CREATE INDEX idx_images_is_deleted ON images(is_deleted);
            CREATE INDEX idx_images_is_pinned ON images(is_pinned);
            CREATE INDEX idx_images_timestamp ON images(timestamp);
            CREATE INDEX idx_images_is_intermediate_gen ON images(is_intermediate_gen);
            CREATE INDEX idx_images_is_grid_gen ON images(is_grid_gen);
            
            CREATE INDEX idx_images_model_hash_denorm ON images(model_hash);
            CREATE INDEX idx_images_tool_denorm ON images(tool);
            CREATE INDEX idx_images_resolved_model ON images(resolved_model_name);
            
            -- Composite indexes
            CREATE INDEX idx_images_filter_covering ON images(is_deleted, is_intermediate_gen, is_grid_gen, timestamp DESC);
            CREATE INDEX idx_images_filter_model ON images(is_deleted, resolved_model_name, timestamp DESC);
            CREATE INDEX idx_images_filter_tool ON images(is_deleted, tool, timestamp DESC);

            CREATE INDEX idx_models_name ON models(name);
            CREATE INDEX idx_models_filename ON models(filename);
            CREATE INDEX idx_models_resource_type ON models(resource_type);

            CREATE INDEX idx_collection_images_lookup ON collection_images(image_id, collection_id);
            CREATE INDEX idx_collection_images_by_collection ON collection_images(collection_id, image_id);

            CREATE INDEX idx_lora_by_name ON image_loras(lora_name);
            CREATE INDEX idx_embedding_by_name ON image_embeddings(embedding_name);
            CREATE INDEX idx_hypernetwork_by_name ON image_hypernetworks(hypernetwork_name);
            
            CREATE INDEX idx_facet_cache_type ON facet_cache(facet_type);
            
            -- NOTE: images_fts matches by rowid (which is synced via id). 
            -- We don't need to rebuild images_fts table itself, BUT we MUST recreate the triggers 
            -- because they were dropped when we dropped the 'images' table!

            DROP TRIGGER IF EXISTS trg_images_ai;
            DROP TRIGGER IF EXISTS trg_images_ad;
            DROP TRIGGER IF EXISTS trg_images_au;

            CREATE TRIGGER trg_images_ai AFTER INSERT ON images BEGIN
                INSERT INTO images_fts(id, positive_prompt, negative_prompt)
                VALUES (new.id, json_extract(new.metadata_json, '$.positivePrompt'), json_extract(new.metadata_json, '$.negativePrompt'));
            END;

            CREATE TRIGGER trg_images_ad AFTER DELETE ON images BEGIN
                DELETE FROM images_fts WHERE id = old.id;
            END;

            CREATE TRIGGER trg_images_au AFTER UPDATE ON images BEGIN
                UPDATE images_fts SET 
                    positive_prompt = json_extract(new.metadata_json, '$.positivePrompt'),
                    negative_prompt = json_extract(new.metadata_json, '$.negativePrompt')
                WHERE id = old.id;
            END;
            
            -- Verify FKs
            PRAGMA foreign_key_check;
            PRAGMA foreign_keys = ON;
        ",
        kind: MigrationKind::Up,
    };

    let migration23 = Migration {
        version: 23,
        description: "restore_missing_collections",
        sql: "
            -- Re-populate collection_images from images.board_id (Source of Truth for InvokeAI boards)
            -- This fixes any data loss from the strict mode migration for board-based collections
            INSERT OR IGNORE INTO collection_images (collection_id, image_id)
            SELECT board_id, id
            FROM images
            WHERE board_id IS NOT NULL
              AND board_id IN (SELECT id FROM collections); -- Safety check: ensure collection exists
        ",
        kind: MigrationKind::Up,
    };

    let migration24 = Migration {
        version: 24,
        description: "fix_boolean_generation",
        sql: "
            PRAGMA foreign_keys = OFF;

            CREATE TABLE images_v24 (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                width INTEGER,
                height INTEGER,
                file_size INTEGER,
                timestamp INTEGER,
                metadata_json TEXT,
                thumbnail_path TEXT,
                is_favorite INTEGER DEFAULT 0 NOT NULL,
                is_pinned INTEGER DEFAULT 0 NOT NULL,
                is_deleted INTEGER DEFAULT 0 NOT NULL,
                is_missing INTEGER DEFAULT 0 NOT NULL,
                user_masked INTEGER DEFAULT 0,
                group_id TEXT,
                notes TEXT,
                original_metadata_json TEXT,
                board_id TEXT,
                model_hash TEXT,
                model_name TEXT,
                tool TEXT,
                resolved_model_name TEXT,
                
                -- Improved Boolean Generation (Handles 'true' string vs 1/true boolean)
                is_intermediate_gen INTEGER GENERATED ALWAYS AS (
                    CASE 
                        WHEN json_extract(metadata_json, '$.isIntermediate') = 1 THEN 1 
                        WHEN json_extract(metadata_json, '$.isIntermediate') = 'true' THEN 1 
                        ELSE 0 
                    END
                ) STORED,
                is_grid_gen INTEGER GENERATED ALWAYS AS (
                    CASE 
                        WHEN json_extract(metadata_json, '$.isGrid') = 1 THEN 1 
                        WHEN json_extract(metadata_json, '$.isGrid') = 'true' THEN 1 
                        WHEN json_extract(metadata_json, '$.generationType') = 'grid' THEN 1 
                        ELSE 0 
                    END
                ) STORED
            ) STRICT;

            INSERT INTO images_v24 (
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, notes,
                original_metadata_json, board_id, model_hash, model_name, tool, resolved_model_name
            )
            SELECT 
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, notes,
                original_metadata_json, board_id, model_hash, model_name, tool, resolved_model_name
            FROM images;

            DROP TABLE images;
            ALTER TABLE images_v24 RENAME TO images;
            
            -- Recreate Indexes
            CREATE INDEX idx_images_path ON images(path);
            CREATE INDEX idx_images_is_deleted ON images(is_deleted);
            CREATE INDEX idx_images_is_pinned ON images(is_pinned);
            CREATE INDEX idx_images_timestamp ON images(timestamp);
            CREATE INDEX idx_images_is_intermediate_gen ON images(is_intermediate_gen);
            CREATE INDEX idx_images_is_grid_gen ON images(is_grid_gen);
            
            CREATE INDEX idx_images_model_hash_denorm ON images(model_hash);
            CREATE INDEX idx_images_tool_denorm ON images(tool);
            CREATE INDEX idx_images_resolved_model ON images(resolved_model_name);
            
            CREATE INDEX idx_images_filter_covering ON images(is_deleted, is_intermediate_gen, is_grid_gen, timestamp DESC);
            CREATE INDEX idx_images_filter_model ON images(is_deleted, resolved_model_name, timestamp DESC);
            CREATE INDEX idx_images_filter_tool ON images(is_deleted, tool, timestamp DESC);
            
            -- Recreate Triggers
            DROP TRIGGER IF EXISTS trg_images_ai;
            DROP TRIGGER IF EXISTS trg_images_ad;
            DROP TRIGGER IF EXISTS trg_images_au;

            CREATE TRIGGER trg_images_ai AFTER INSERT ON images BEGIN
                INSERT INTO images_fts(id, positive_prompt, negative_prompt)
                VALUES (new.id, json_extract(new.metadata_json, '$.positivePrompt'), json_extract(new.metadata_json, '$.negativePrompt'));
            END;

            CREATE TRIGGER trg_images_ad AFTER DELETE ON images BEGIN
                DELETE FROM images_fts WHERE id = old.id;
            END;

            CREATE TRIGGER trg_images_au AFTER UPDATE ON images BEGIN
                UPDATE images_fts SET 
                    positive_prompt = json_extract(new.metadata_json, '$.positivePrompt'),
                    negative_prompt = json_extract(new.metadata_json, '$.negativePrompt')
                WHERE id = old.id;
            END;
            
            -- Healing: Ensure Collection Links are preserved/restored if lost during swap
            INSERT OR IGNORE INTO collection_images (collection_id, image_id)
            SELECT board_id, id
            FROM images
            WHERE board_id IS NOT NULL;
            
            PRAGMA foreign_key_check;
            PRAGMA foreign_keys = ON;
        ",
        kind: MigrationKind::Up,
    };

    let migration25 = Migration {
        version: 25,
        description: "fix_schema_robust_v2",
        sql: "
            PRAGMA foreign_keys = OFF;

            CREATE TABLE images_v25 (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                width INTEGER,
                height INTEGER,
                file_size INTEGER,
                timestamp INTEGER,
                metadata_json TEXT,
                thumbnail_path TEXT,
                is_favorite INTEGER DEFAULT 0 NOT NULL,
                is_pinned INTEGER DEFAULT 0 NOT NULL,
                is_deleted INTEGER DEFAULT 0 NOT NULL,
                is_missing INTEGER DEFAULT 0 NOT NULL,
                user_masked INTEGER DEFAULT 0, -- Fixed: Nullable for tri-state
                group_id TEXT,
                notes TEXT,
                original_metadata_json TEXT,
                board_id TEXT,
                model_hash TEXT,
                model_name TEXT,
                tool TEXT,
                resolved_model_name TEXT,
                
                -- Global Search Columns (Robust Checks)
                is_intermediate_gen INTEGER GENERATED ALWAYS AS (
                    CASE 
                        WHEN json_extract(metadata_json, '$.isIntermediate') = 1 THEN 1 
                        WHEN json_extract(metadata_json, '$.isIntermediate') = 'true' THEN 1 
                        WHEN json_extract(metadata_json, '$.is_intermediate') = 1 THEN 1 
                        WHEN json_extract(metadata_json, '$.is_intermediate') = 'true' THEN 1 
                        ELSE 0 
                    END
                ) STORED,
                is_grid_gen INTEGER GENERATED ALWAYS AS (
                    CASE 
                        WHEN json_extract(metadata_json, '$.isGrid') = 1 THEN 1 
                        WHEN json_extract(metadata_json, '$.isGrid') = 'true' THEN 1 
                        WHEN json_extract(metadata_json, '$.is_grid') = 1 THEN 1 
                        WHEN json_extract(metadata_json, '$.is_grid') = 'true' THEN 1 
                        WHEN json_extract(metadata_json, '$.generationType') = 'grid' THEN 1 
                        WHEN json_extract(metadata_json, '$.generation_type') = 'grid' THEN 1 
                        ELSE 0 
                    END
                ) STORED
            ) STRICT;

            INSERT INTO images_v25 (
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, notes,
                original_metadata_json, board_id, model_hash, model_name, tool, resolved_model_name
            )
            SELECT 
                id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path,
                is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, notes,
                original_metadata_json, board_id, model_hash, model_name, tool, resolved_model_name
            FROM images;

            DROP TABLE images;
            ALTER TABLE images_v25 RENAME TO images;
            
            -- Recreate Indexes
            CREATE INDEX idx_images_path ON images(path);
            CREATE INDEX idx_images_is_deleted ON images(is_deleted);
            CREATE INDEX idx_images_is_pinned ON images(is_pinned);
            CREATE INDEX idx_images_timestamp ON images(timestamp);
            CREATE INDEX idx_images_is_intermediate_gen ON images(is_intermediate_gen);
            CREATE INDEX idx_images_is_grid_gen ON images(is_grid_gen);
            
            CREATE INDEX idx_images_model_hash_denorm ON images(model_hash);
            CREATE INDEX idx_images_tool_denorm ON images(tool);
            CREATE INDEX idx_images_resolved_model ON images(resolved_model_name);
            
            CREATE INDEX idx_images_filter_covering ON images(is_deleted, is_intermediate_gen, is_grid_gen, timestamp DESC);
            CREATE INDEX idx_images_filter_model ON images(is_deleted, resolved_model_name, timestamp DESC);
            CREATE INDEX idx_images_filter_tool ON images(is_deleted, tool, timestamp DESC);
            
            -- Recreate Triggers (Crucial for FTS)
            DROP TRIGGER IF EXISTS trg_images_ai;
            DROP TRIGGER IF EXISTS trg_images_ad;
            DROP TRIGGER IF EXISTS trg_images_au;

            CREATE TRIGGER trg_images_ai AFTER INSERT ON images BEGIN
                INSERT INTO images_fts(id, positive_prompt, negative_prompt)
                VALUES (new.id, json_extract(new.metadata_json, '$.positivePrompt'), json_extract(new.metadata_json, '$.negativePrompt'));
            END;

            CREATE TRIGGER trg_images_ad AFTER DELETE ON images BEGIN
                DELETE FROM images_fts WHERE id = old.id;
            END;

            CREATE TRIGGER trg_images_au AFTER UPDATE ON images BEGIN
                UPDATE images_fts SET 
                    positive_prompt = json_extract(new.metadata_json, '$.positivePrompt'),
                    negative_prompt = json_extract(new.metadata_json, '$.negativePrompt')
                WHERE id = old.id;
            END;
            
            -- Healing: Ensure Collection Links are preserved/restored if lost during swap
            INSERT OR IGNORE INTO collection_images (collection_id, image_id)
            SELECT board_id, id
            FROM images
            WHERE board_id IS NOT NULL;
            
            PRAGMA foreign_key_check;
            PRAGMA foreign_keys = ON;
        ",
        kind: MigrationKind::Up,
    };

    let migration26 = Migration {
        version: 26,
        description: "add_is_manual_to_facet_cache_v2",
        sql: "
            ALTER TABLE facet_cache ADD COLUMN is_manual INTEGER DEFAULT 0;
        ",
        kind: MigrationKind::Up,
    };

    let migration27 = Migration {
        version: 27,
        description: "backfill_is_manual_flag",
        sql: "
            UPDATE facet_cache 
            SET is_manual = 1 
            WHERE resource_hash IN (SELECT hash FROM models WHERE thumbnail_path IS NOT NULL)
               OR resource_name IN (SELECT name FROM models WHERE thumbnail_path IS NOT NULL);
        ",
        kind: MigrationKind::Up,
    };

    // Separate sidecar vs user override for thumbnail management
    let migration28 = Migration {
        version: 28,
        description: "add_sidecar_thumbnail_path",
        sql: "
            -- Add new column for sidecar thumbnails (discovered from disk)
            ALTER TABLE models ADD COLUMN sidecar_thumbnail_path TEXT;
            
            -- Backfill: Move disk_scan thumbnails to sidecar slot, clear user override slot
            -- This ensures existing sidecar data is preserved in the correct column
            UPDATE models 
            SET sidecar_thumbnail_path = thumbnail_path, thumbnail_path = NULL
            WHERE thumbnail_path IS NOT NULL 
              AND lookup_source = 'disk_scan';
              
            -- Also handle manual_thumbnail source (these were explicitly set by user, keep in thumbnail_path)
            -- No action needed - they are already in thumbnail_path which is correct.
        ",
        kind: MigrationKind::Up,
    };

    // Add thumbnail_mode to preserve user preference without destroying sidecar data
    let migration29 = Migration {
        version: 29,
        description: "add_thumbnail_mode",
        sql: "
            -- thumbnail_mode: NULL/'auto' = use priority chain, 'dynamic' = force dynamic, 'manual' = use thumbnail_path
            ALTER TABLE models ADD COLUMN thumbnail_mode TEXT;
        ",
        kind: MigrationKind::Up,
    };

    // Add has_sidecar flag to facet_cache for improved UX in context menus
    let migration30 = Migration {
        version: 30,
        description: "add_has_sidecar_to_facet_cache",
        sql: "
            ALTER TABLE facet_cache ADD COLUMN has_sidecar INTEGER DEFAULT 0;
        ",
        kind: MigrationKind::Up,
    };

    // Backfill has_sidecar from models table
    let migration31 = Migration {
        version: 31,
        description: "backfill_has_sidecar",
        sql: "
            UPDATE facet_cache 
            SET has_sidecar = 1 
            WHERE resource_hash IN (SELECT hash FROM models WHERE sidecar_thumbnail_path IS NOT NULL AND sidecar_thumbnail_path != '')
               OR resource_name IN (SELECT name FROM models WHERE sidecar_thumbnail_path IS NOT NULL AND sidecar_thumbnail_path != '');
        ",
        kind: MigrationKind::Up,
    };

    // Add is_user_override to distinguish between Sidecar and User Manual assignment
    let migration32 = Migration {
        version: 32,
        description: "add_is_user_override",
        sql: "
            ALTER TABLE facet_cache ADD COLUMN is_user_override INTEGER DEFAULT 0;
            
            -- Backfill
            UPDATE facet_cache 
            SET is_user_override = 1 
            WHERE resource_hash IN (SELECT hash FROM models WHERE thumbnail_path IS NOT NULL AND thumbnail_path != '')
               OR resource_name IN (SELECT name FROM models WHERE thumbnail_path IS NOT NULL AND thumbnail_path != '');
        ",
        kind: MigrationKind::Up,
    };

    vec![
        migration,
        migration2,
        migration3,
        migration4,
        migration5,
        migration6,
        migration7,
        migration8,
        migration9,
        migration10,
        migration11,
        migration12,
        migration13,
        migration14,
        migration15,
        migration16,
        migration17,
        migration18,
        migration19,
        migration20,
        migration21,
        migration22,
        migration23,
        migration24,
        migration25,
        migration26,
        migration27,
        migration28,
        migration29,
        migration30,
        migration31,
        migration32,
        migration33(),
        migration34(),
        migration35(),
        // Migration 37 (Retry of 36): Add is_corrupt column
        // We bump version to ensure it runs even if 36 failed/partial
        Migration {
            version: 37,
            description: "add_is_corrupt_column_v2",
            // We use safe check (just ADD) - if it implies failure, user might need to purge DB
            // But realistically 36 failed due to Strict Mode, so column shouldn't exist.
            sql: "ALTER TABLE images ADD COLUMN is_corrupt INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        migration38(),
        migration39(),
        migration40(),
        migration41(),
    ]
}

/// Migration 39: Fix ControlNet backfill key and consolidate resource names (strip weights/extensions)
fn migration39() -> Migration {
    Migration {
        version: 39,
        description: "fix_guidance_backfill_and_clean_names",
        sql: "
            -- 1. Correct ControlNet backfill (wrong key used in migration 38)
            DELETE FROM image_controlnets;
            INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name)
            SELECT i.id, 
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END
            FROM images i, json_each(i.metadata_json, '$.controlNets') j
            WHERE j.value IS NOT NULL AND j.value != '';

            -- 2. Clean names in image_ipadapters (strip weights/extensions)
            CREATE TABLE image_ipadapters_new (
                image_id TEXT NOT NULL,
                ipadapter_name TEXT NOT NULL,
                PRIMARY KEY (image_id, ipadapter_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT OR IGNORE INTO image_ipadapters_new (image_id, ipadapter_name)
            SELECT image_id,
                CASE 
                    WHEN instr(ipadapter_name, ' (') > 0 THEN substr(ipadapter_name, 1, instr(ipadapter_name, ' (') - 1)
                    WHEN instr(ipadapter_name, ':') > 0 THEN substr(ipadapter_name, 1, instr(ipadapter_name, ':') - 1)
                    ELSE ipadapter_name 
                END
            FROM image_ipadapters;
            DROP TABLE image_ipadapters;
            ALTER TABLE image_ipadapters_new RENAME TO image_ipadapters;
            CREATE INDEX IF NOT EXISTS idx_ipadapter_by_name ON image_ipadapters(ipadapter_name);

            -- 3. Consolidate image_loras (just in case some were saved with weights)
            CREATE TABLE image_loras_new (
                image_id TEXT NOT NULL,
                lora_name TEXT NOT NULL,
                PRIMARY KEY (image_id, lora_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT OR IGNORE INTO image_loras_new (image_id, lora_name)
            SELECT image_id,
                CASE 
                    WHEN instr(lora_name, ' (') > 0 THEN substr(lora_name, 1, instr(lora_name, ' (') - 1)
                    WHEN instr(lora_name, ':') > 0 THEN substr(lora_name, 1, instr(lora_name, ':') - 1)
                    ELSE lora_name 
                END
            FROM image_loras;
            DROP TABLE image_loras;
            ALTER TABLE image_loras_new RENAME TO image_loras;
            CREATE INDEX IF NOT EXISTS idx_lora_by_name ON image_loras(lora_name);

            -- Update ANALYZE
            ANALYZE image_controlnets;
            ANALYZE image_ipadapters;
            ANALYZE image_loras;
        ",
        kind: MigrationKind::Up,
    }
}

/// Migration 35: Add thumbnail source tracking and micro-thumbnails for progressive loading
/// - thumbnail_source: Track where the thumbnail came from ('ambit', 'invokeai', etc.)
/// - micro_thumbnail: Base64 encoded 32px WebP for instant previews
fn migration35() -> Migration {
    Migration {
        version: 35,
        description: "add_thumbnail_source_and_micro_thumbnail",
        sql: "
            -- Track thumbnail origin for intelligent upgrades
            ALTER TABLE images ADD COLUMN thumbnail_source TEXT;
            
            -- Base64 encoded micro-thumbnail (32px WebP) for instant previews
            -- Stored in DB to eliminate HTTP round-trip latency
            ALTER TABLE images ADD COLUMN micro_thumbnail TEXT;
            
            -- Index for finding images that need thumbnail upgrades
            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_source ON images(thumbnail_source);
        ",
        kind: MigrationKind::Up,
    }
}

/// Migration 33: Denormalize parameter columns for faster filtering
/// Adds steps, cfg, sampler, and generation_type columns with indexes
///
/// NOTE: Backfill is done via TRIGGER on insert and via a separate background command
/// to avoid blocking app startup on large databases.
fn migration33() -> Migration {
    Migration {
        version: 33,
        description: "denormalize_parameter_columns",
        sql: "
            -- Add new columns for fast parameter filtering (instant, no row scan)
            ALTER TABLE images ADD COLUMN steps INTEGER;
            ALTER TABLE images ADD COLUMN cfg REAL;
            ALTER TABLE images ADD COLUMN sampler TEXT;
            ALTER TABLE images ADD COLUMN generation_type TEXT;
            
            -- Create indexes (will be populated as data is backfilled)
            CREATE INDEX IF NOT EXISTS idx_images_steps ON images(steps);
            CREATE INDEX IF NOT EXISTS idx_images_cfg ON images(cfg);
            CREATE INDEX IF NOT EXISTS idx_images_sampler ON images(sampler);
            CREATE INDEX IF NOT EXISTS idx_images_generation_type ON images(generation_type);
            
            -- Composite indexes for common filter patterns
            CREATE INDEX IF NOT EXISTS idx_images_filter_steps ON images(is_deleted, steps);
            CREATE INDEX IF NOT EXISTS idx_images_filter_cfg ON images(is_deleted, cfg);
            CREATE INDEX IF NOT EXISTS idx_images_filter_sampler ON images(is_deleted, sampler, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_images_filter_gen_type ON images(is_deleted, generation_type, timestamp DESC);
        ",
        kind: MigrationKind::Up,
    }
}

/// Migration 34: Add original_state_json column for sync conflict resolution
/// Stores the original import-time values of isFavorite, isPinned, and boardId
/// so the sync service can detect user modifications and preserve them.
fn migration34() -> Migration {
    Migration {
        version: 34,
        description: "add_original_state_column",
        sql: "ALTER TABLE images ADD COLUMN original_state_json TEXT;",
        kind: MigrationKind::Up,
    }
}

/// Migration 38: Add junction tables for ControlNet and IP-Adapter filtering
fn migration38() -> Migration {
    Migration {
        version: 38,
        description: "add_guidance_junction_tables",
        sql: "
            -- Junction table for ControlNets
            CREATE TABLE IF NOT EXISTS image_controlnets (
                image_id TEXT NOT NULL,
                controlnet_name TEXT NOT NULL,
                PRIMARY KEY (image_id, controlnet_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_controlnet_by_name ON image_controlnets(controlnet_name);

            -- Junction table for IP-Adapters
            CREATE TABLE IF NOT EXISTS image_ipadapters (
                image_id TEXT NOT NULL,
                ipadapter_name TEXT NOT NULL,
                PRIMARY KEY (image_id, ipadapter_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_ipadapter_by_name ON image_ipadapters(ipadapter_name);

            -- Backfill ControlNets from existing JSON
            INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name)
            SELECT i.id, j.value
            FROM images i, json_each(i.metadata_json, '$.control_nets') j
            WHERE j.value IS NOT NULL AND j.value != '';

            -- Backfill IP-Adapters from existing JSON
            INSERT OR IGNORE INTO image_ipadapters (image_id, ipadapter_name)
            SELECT i.id, j.value
            FROM images i, json_each(i.metadata_json, '$.ipAdapters') j
            WHERE j.value IS NOT NULL AND j.value != '';

            -- Update ANALYZE for new tables
            ANALYZE image_controlnets;
            ANALYZE image_ipadapters;
        ",
        kind: MigrationKind::Up,
    }
}
/// Migration 40: Add guidance classification columns to support robust filtering
fn migration40() -> Migration {
    Migration {
        version: 40,
        description: "add_guidance_classification_columns",
        sql: "
            -- Classification fields for models (ControlNet, IP-Adapter, etc.)
            ALTER TABLE models ADD COLUMN guidance_category TEXT;
            ALTER TABLE models ADD COLUMN guidance_subtype TEXT;
            
            -- Indices for fast classification lookups
            CREATE INDEX IF NOT EXISTS idx_models_guidance_category ON models(guidance_category);
            CREATE INDEX IF NOT EXISTS idx_models_guidance_subtype ON models(guidance_subtype);

            -- Subtype in facet cache to drive UI icons
            ALTER TABLE facet_cache ADD COLUMN guidance_subtype TEXT;
        ",
        kind: MigrationKind::Up,
    }
}

/// Migration 41: Create scanned_files cache for fast discovery
/// Maps path + size + modified -> hash to skip expensive SHA256 calc
fn migration41() -> Migration {
    Migration {
        version: 41,
        description: "create_scanned_files_cache",
        sql: "CREATE TABLE IF NOT EXISTS scanned_files (
            path TEXT PRIMARY KEY,
            size INTEGER,
            modified INTEGER,
            hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_scanned_files_lookup ON scanned_files(path, size, modified);",
        kind: MigrationKind::Up,
    }
}
