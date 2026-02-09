use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 48: Add original_parsed_json column for reliable modification detection
/// This column stores the parsed metadata baseline, eliminating parser drift issues
/// when comparing current metadata against original values.
pub fn migration48() -> Migration {
    Migration {
        version: 48,
        description: "add_original_parsed_json",
        sql: "
            -- Add the new column for storing parsed baseline
            ALTER TABLE images ADD COLUMN original_parsed_json TEXT;
            
            -- Backfill from existing metadata_json (establishes baseline for existing images)
            UPDATE images SET original_parsed_json = metadata_json 
            WHERE original_parsed_json IS NULL AND metadata_json IS NOT NULL;
        ",
        kind: MigrationKind::Up,
    }
}
