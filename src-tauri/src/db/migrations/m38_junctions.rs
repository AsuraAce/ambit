use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 38: Add junction tables for ControlNet and IP-Adapter filtering
pub fn migration38() -> Migration {
    Migration {
        version: 38,
        description: "add_guidance_junction_tables",
        sql: "
            -- Junction table for ControlNets
            CREATE TABLE IF NOT EXISTS image_controlnets (
                image_id TEXT NOT NULL,
                controlnet_name TEXT NOT NULL,
                PRIMARY KEY (image_id, controlnet_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_controlnet_by_name ON image_controlnets(controlnet_name);

            -- Junction table for IP-Adapters
            CREATE TABLE IF NOT EXISTS image_ipadapters (
                image_id TEXT NOT NULL,
                ipadapter_name TEXT NOT NULL,
                PRIMARY KEY (image_id, ipadapter_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX IF NOT EXISTS idx_ipadapter_by_name ON image_ipadapters(ipadapter_name);

            -- Backfill ControlNets from existing JSON
            INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name)
            SELECT i.id, j.value
            FROM images i, json_each(i.metadata_json, '$.control_nets') j
            WHERE j.value IS NOT NULL AND j.value != '';

            -- Backfill IP-Adapters from existing JSON
            INSERT OR IGNORE INTO image_ipadapters (image_id, ipadapter_name)
            SELECT i.id, j.value
            FROM images i, json_each(i.metadata_json, '$.ipAdapters') j
            WHERE j.value IS NOT NULL AND j.value != '';

            -- Update ANALYZE for new tables
            ANALYZE image_controlnets;
            ANALYZE image_ipadapters;
        ",
        kind: MigrationKind::Up,
    }
}
