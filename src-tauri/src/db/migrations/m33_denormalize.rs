use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 33: Denormalize parameter columns for faster filtering
pub fn migration33() -> Migration {
    Migration {
        version: 33,
        description: "denormalize_parameter_columns",
        sql: "
            -- Add new columns for fast parameter filtering (instant, no row scan)
            ALTER TABLE images ADD COLUMN steps INTEGER;
            ALTER TABLE images ADD COLUMN cfg REAL;
            ALTER TABLE images ADD COLUMN sampler TEXT;
            ALTER TABLE images ADD COLUMN generation_type TEXT;
            
            -- Create indexes (will be populated as data is backfilled)
            CREATE INDEX IF NOT EXISTS idx_images_steps ON images(steps);
            CREATE INDEX IF NOT EXISTS idx_images_cfg ON images(cfg);
            CREATE INDEX IF NOT EXISTS idx_images_sampler ON images(sampler);
            CREATE INDEX IF NOT EXISTS idx_images_generation_type ON images(generation_type);
            
            -- Composite indexes for common filter patterns
            CREATE INDEX IF NOT EXISTS idx_images_filter_steps ON images(is_deleted, steps);
            CREATE INDEX IF NOT EXISTS idx_images_filter_cfg ON images(is_deleted, cfg);
            CREATE INDEX IF NOT EXISTS idx_images_filter_sampler ON images(is_deleted, sampler, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_images_filter_gen_type ON images(is_deleted, generation_type, timestamp DESC);
        ",
        kind: MigrationKind::Up,
    }
}
