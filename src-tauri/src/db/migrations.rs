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

    vec![migration, migration2, migration3, migration4, migration5, migration6, migration7, migration8, migration9, migration10, migration11, migration12, migration13, migration14, migration15, migration16]
}
