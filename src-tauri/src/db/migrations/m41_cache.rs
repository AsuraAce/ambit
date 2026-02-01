use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 41: Create scanned_files cache for fast discovery
/// Maps path + size + modified -> hash to skip expensive SHA256 calc
pub fn migration41() -> Migration {
    Migration {
        version: 41,
        description: "create_scanned_files_cache",
        sql: "CREATE TABLE IF NOT EXISTS scanned_files (
            path TEXT NOT NULL,
            size INTEGER NOT NULL,
            modified INTEGER NOT NULL,
            hash TEXT NOT NULL,
            PRIMARY KEY (path, size, modified)
        );
        CREATE INDEX IF NOT EXISTS idx_scanned_files_hash ON scanned_files(hash);",
        kind: MigrationKind::Up,
    }
}
