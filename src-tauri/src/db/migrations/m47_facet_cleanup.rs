use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 47: Standardize facet names in the cache
/// Fixes ghosting by ensuring singular 'tool' entries are merged into 'tools'
pub fn migration47() -> Migration {
    Migration {
        version: 47,
        description: "standardize_facet_names",
        sql: "
            -- Standardize tool naming to match build_tool_facets logic
            UPDATE facet_cache SET facet_type = 'tools' WHERE facet_type = 'tool';
            
            -- Ensure checkpoints are consistent (using singular 'checkpoint' as DB standard)
            UPDATE facet_cache SET facet_type = 'checkpoint' WHERE facet_type = 'checkpoints';
            
            -- Remove any duplicates that might have been created by previous inconsistencies
            DELETE FROM facet_cache 
            WHERE rowid NOT IN (
                SELECT MIN(rowid) 
                FROM facet_cache 
                GROUP BY facet_type, resource_name
            );
        ",
        kind: MigrationKind::Up,
    }
}
