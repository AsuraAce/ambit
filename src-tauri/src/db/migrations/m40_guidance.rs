use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 40: Add guidance classification columns to support robust filtering
pub fn migration40() -> Migration {
    Migration {
        version: 40,
        description: "add_guidance_classification",
        sql: "
            -- Add columns for classification
            ALTER TABLE models ADD COLUMN guidance_category TEXT;
            ALTER TABLE models ADD COLUMN guidance_subtype TEXT;
            
            -- Add indexes for classification
            CREATE INDEX IF NOT EXISTS idx_models_guidance_category ON models(guidance_category);
            CREATE INDEX IF NOT EXISTS idx_models_guidance_subtype ON models(guidance_subtype);
        ",
        kind: MigrationKind::Up,
    }
}
