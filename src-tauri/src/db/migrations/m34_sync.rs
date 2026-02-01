use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 34: Add original_state_json column for sync conflict resolution
pub fn migration34() -> Migration {
    Migration {
        version: 34,
        description: "add_original_state_column",
        sql: "ALTER TABLE images ADD COLUMN original_state_json TEXT;",
        kind: MigrationKind::Up,
    }
}
