use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 77: Keep Removed Invoke identity checks indexable when a source
/// image moves to a different resolved path.
pub fn migration77() -> Migration {
    Migration {
        version: 77,
        description: "index_removed_invoke_identity_lookup",
        sql: r#"
            CREATE INDEX idx_removed_images_invoke_name_scope_source_owner
                ON removed_images(
                    invoke_image_name,
                    invoke_scope_hidden,
                    invoke_source_id,
                    invoke_owner_id
                )
                WHERE invoke_source_id IS NOT NULL;
        "#,
        kind: MigrationKind::Up,
    }
}
