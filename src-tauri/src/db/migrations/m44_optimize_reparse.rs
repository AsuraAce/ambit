use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 44: Add optimized index for metadata re-parsing.
/// This strictly targets the query used by the reparse command to avoid full table scans.
pub fn migration44() -> Migration {
    Migration {
        version: 44,
        description: "add optimized index for metadata re-parsing queue",
        sql: r#"
            CREATE INDEX IF NOT EXISTS idx_reparse_queue 
                ON images(is_deleted, parser_version);
        "#,
        kind: MigrationKind::Up,
    }
}
