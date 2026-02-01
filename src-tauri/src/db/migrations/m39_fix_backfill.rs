use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 39: Fix ControlNet backfill key and consolidate resource names (strip weights/extensions)
pub fn migration39() -> Migration {
    Migration {
        version: 39,
        description: "fix_guidance_backfill_and_clean_names",
        sql: "
            -- 1. Correct ControlNet backfill (wrong key used in migration 38)
            DELETE FROM image_controlnets;
            INSERT OR IGNORE INTO image_controlnets (image_id, controlnet_name)
            SELECT i.id, 
                CASE 
                    WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                    WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                    ELSE j.value 
                END
            FROM images i, json_each(i.metadata_json, '$.controlNets') j
            WHERE j.value IS NOT NULL AND j.value != '';

            -- 2. Clean names in image_ipadapters (strip weights/extensions)
            CREATE TABLE image_ipadapters_new (
                image_id TEXT NOT NULL,
                ipadapter_name TEXT NOT NULL,
                PRIMARY KEY (image_id, ipadapter_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT OR IGNORE INTO image_ipadapters_new (image_id, ipadapter_name)
            SELECT image_id,
                CASE 
                    WHEN instr(ipadapter_name, ' (') > 0 THEN substr(ipadapter_name, 1, instr(ipadapter_name, ' (') - 1)
                    WHEN instr(ipadapter_name, ':') > 0 THEN substr(ipadapter_name, 1, instr(ipadapter_name, ':') - 1)
                    ELSE ipadapter_name 
                END
            FROM image_ipadapters;
            DROP TABLE image_ipadapters;
            ALTER TABLE image_ipadapters_new RENAME TO image_ipadapters;
            CREATE INDEX IF NOT EXISTS idx_ipadapter_by_name ON image_ipadapters(ipadapter_name);

            -- 3. Consolidate image_loras (just in case some were saved with weights)
            CREATE TABLE image_loras_new (
                image_id TEXT NOT NULL,
                lora_name TEXT NOT NULL,
                PRIMARY KEY (image_id, lora_name),
                FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
            ) STRICT;
            INSERT OR IGNORE INTO image_loras_new (image_id, lora_name)
            SELECT image_id,
                CASE 
                    WHEN instr(lora_name, ' (') > 0 THEN substr(lora_name, 1, instr(lora_name, ' (') - 1)
                    WHEN instr(lora_name, ':') > 0 THEN substr(lora_name, 1, instr(lora_name, ':') - 1)
                    ELSE lora_name 
                END
            FROM image_loras;
            DROP TABLE image_loras;
            ALTER TABLE image_loras_new RENAME TO image_loras;
            CREATE INDEX IF NOT EXISTS idx_lora_by_name ON image_loras(lora_name);

            -- Update ANALYZE
            ANALYZE image_controlnets;
            ANALYZE image_ipadapters;
            ANALYZE image_loras;
        ",
        kind: MigrationKind::Up,
    }
}
