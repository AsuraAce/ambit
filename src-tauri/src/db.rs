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
        // Move existing group_ids (which were incorrectly used for boards) to board_id
        // and clear group_id to fix the 'stacking' issue.
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
            -- Migrate existing board_ids to collections
            INSERT INTO collections (id, name, created_at, source)
            SELECT DISTINCT board_id, board_id, (strftime('%s', 'now') * 1000), 'invoke'
            FROM images 
            WHERE board_id IS NOT NULL;
            
            INSERT INTO collection_images (collection_id, image_id)
            SELECT board_id, id 
            FROM images 
            WHERE board_id IS NOT NULL;
        ",
        kind: MigrationKind::Up,
    };

    let migration5 = Migration {
        version: 5,
        description: "fix_timestamp_units",
        // Convert any timestamps that look like seconds (10 digits: ~1 billion to ~10 billion) 
        // to milliseconds. This covers years 2001 to 2286.
        sql: "UPDATE images SET timestamp = timestamp * 1000 WHERE timestamp > 1000000000 AND timestamp < 10000000000;",
        kind: MigrationKind::Up,
    };

    vec![migration, migration2, migration3, migration4, migration5]
}
