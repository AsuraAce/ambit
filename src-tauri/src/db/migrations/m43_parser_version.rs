use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 43: Add parser_version column for metadata re-parsing tracking.
/// When parser logic improves, we increment CURRENT_PARSER_VERSION and 
/// re-parse images with outdated versions from stored original_metadata_json.
pub fn migration43() -> Migration {
    Migration {
        version: 43,
        description: "add parser_version column for metadata re-parsing",
        sql: r#"
            ALTER TABLE images ADD COLUMN parser_version INTEGER DEFAULT 0;
            CREATE INDEX IF NOT EXISTS idx_parser_version 
                ON images(parser_version) 
                WHERE is_deleted = 0;
        "#,
        kind: MigrationKind::Up,
    }
}
