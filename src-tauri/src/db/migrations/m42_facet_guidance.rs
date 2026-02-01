use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 42: Add guidance_subtype to facet_cache
/// Required for rebuild_facet_cache to support guidance model filtering
pub fn migration42() -> Migration {
    Migration {
        version: 42,
        description: "add_facet_guidance_subtype",
        sql: "ALTER TABLE facet_cache ADD COLUMN guidance_subtype TEXT;",
        kind: MigrationKind::Up,
    }
}
