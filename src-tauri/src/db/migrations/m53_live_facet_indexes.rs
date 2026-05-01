use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 53: Add indexes used by resource-row Live Watch facet refreshes.
pub fn migration53() -> Migration {
    Migration {
        version: 53,
        description: "add_live_facet_refresh_indexes",
        sql: r#"
            CREATE INDEX IF NOT EXISTS idx_images_live_checkpoint_thumb_v1
                ON images(is_deleted, resolved_model_name, is_pinned DESC, timestamp DESC)
                WHERE thumbnail_path IS NOT NULL AND thumbnail_path != '';

            CREATE INDEX IF NOT EXISTS idx_images_live_checkpoint_safe_thumb_v1
                ON images(is_deleted, resolved_model_name, privacy_hidden, is_pinned DESC, timestamp DESC)
                WHERE thumbnail_path IS NOT NULL AND thumbnail_path != '';
        "#,
        kind: MigrationKind::Up,
    }
}
