use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 51: Store content hashes for exact duplicate detection.
pub fn migration51() -> Migration {
    Migration {
        version: 51,
        description: "add_image_file_hash",
        sql: r#"
            ALTER TABLE images ADD COLUMN file_hash TEXT;

            CREATE INDEX IF NOT EXISTS idx_images_file_hash
                ON images(file_hash)
                WHERE file_hash IS NOT NULL AND file_hash != '';
        "#,
        kind: MigrationKind::Up,
    }
}
