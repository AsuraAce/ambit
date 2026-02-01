use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 35: Add thumbnail source tracking and micro-thumbnails for progressive loading
pub fn migration35() -> Migration {
    Migration {
        version: 35,
        description: "add_thumbnail_source_and_micro_thumbnail",
        sql: "
            -- Track thumbnail origin for intelligent upgrades
            ALTER TABLE images ADD COLUMN thumbnail_source TEXT;
            
            -- Base64 encoded micro-thumbnail (32px WebP) for instant previews
            -- Stored in DB to eliminate HTTP round-trip latency
            ALTER TABLE images ADD COLUMN micro_thumbnail TEXT;
            
            -- Index for finding images that need thumbnail upgrades
            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_source ON images(thumbnail_source);
        ",
        kind: MigrationKind::Up,
    }
}
