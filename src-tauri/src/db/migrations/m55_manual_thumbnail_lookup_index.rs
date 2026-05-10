use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 55: Add index for manual thumbnail lookup during facet rebuilds.
pub fn migration55() -> Migration {
    Migration {
        version: 55,
        description: "add_manual_thumbnail_lookup_index",
        sql: r#"
            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_path_lookup_v1
                ON images(thumbnail_path)
                WHERE thumbnail_path IS NOT NULL AND thumbnail_path != '';
        "#,
        kind: MigrationKind::Up,
    }
}
