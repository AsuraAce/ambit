use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 49: Add persisted tombstones for library-removed images.
/// These records keep files out of future rescans until the user explicitly restores them.
pub fn migration49() -> Migration {
    Migration {
        version: 49,
        description: "add_removed_images_tombstones",
        sql: "
            CREATE TABLE IF NOT EXISTS removed_images (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                width INTEGER,
                height INTEGER,
                file_size INTEGER,
                timestamp INTEGER NOT NULL,
                metadata_json TEXT,
                thumbnail_path TEXT,
                micro_thumbnail TEXT,
                thumbnail_source TEXT,
                is_favorite INTEGER DEFAULT 0,
                is_pinned INTEGER DEFAULT 0,
                is_missing INTEGER DEFAULT 0,
                user_masked INTEGER,
                group_id TEXT,
                board_id TEXT,
                notes TEXT,
                original_metadata_json TEXT,
                original_parsed_json TEXT,
                original_state_json TEXT,
                is_corrupt INTEGER NOT NULL DEFAULT 0,
                removed_at INTEGER NOT NULL,
                collection_ids_json TEXT
            ) STRICT;

            CREATE INDEX IF NOT EXISTS idx_removed_images_removed_at
                ON removed_images(removed_at DESC);

            INSERT OR IGNORE INTO removed_images (
                id,
                path,
                width,
                height,
                file_size,
                timestamp,
                metadata_json,
                thumbnail_path,
                micro_thumbnail,
                thumbnail_source,
                is_favorite,
                is_pinned,
                is_missing,
                user_masked,
                group_id,
                board_id,
                notes,
                original_metadata_json,
                original_parsed_json,
                original_state_json,
                is_corrupt,
                removed_at,
                collection_ids_json
            )
            SELECT
                id,
                path,
                width,
                height,
                file_size,
                timestamp,
                metadata_json,
                thumbnail_path,
                micro_thumbnail,
                thumbnail_source,
                is_favorite,
                is_pinned,
                is_missing,
                user_masked,
                group_id,
                board_id,
                notes,
                original_metadata_json,
                original_parsed_json,
                original_state_json,
                is_corrupt,
                (strftime('%s', 'now') * 1000),
                NULL
            FROM images
            WHERE is_deleted = 1;

            DELETE FROM images WHERE is_deleted = 1;
        ",
        kind: MigrationKind::Up,
    }
}
