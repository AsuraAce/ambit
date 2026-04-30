use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 52: Track privacy metadata for collection/resource thumbnails.
pub fn migration52() -> Migration {
    Migration {
        version: 52,
        description: "add_thumbnail_privacy_metadata",
        sql: r#"
            ALTER TABLE models ADD COLUMN thumbnail_sensitivity_override INTEGER;

            ALTER TABLE facet_cache ADD COLUMN safe_thumbnail_path TEXT;
            ALTER TABLE facet_cache ADD COLUMN thumbnail_image_id TEXT;
            ALTER TABLE facet_cache ADD COLUMN thumbnail_is_sensitive INTEGER DEFAULT 0;
            ALTER TABLE facet_cache ADD COLUMN thumbnail_sensitivity_override INTEGER;
        "#,
        kind: MigrationKind::Up,
    }
}
