use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 45: Optimize FTS triggers to only fire on prompt changes.
/// This prevents massive performance degradation on large databases when
/// non-search-critical metadata (steps, sampler, version) is updated.
pub fn migration45() -> Migration {
    Migration {
        version: 45,
        description: "optimize_fts_triggers",
        sql: r#"
            DROP TRIGGER IF EXISTS trg_images_au;

            CREATE TRIGGER trg_images_au AFTER UPDATE OF metadata_json ON images
            WHEN 
                json_extract(old.metadata_json, '$.positivePrompt') != json_extract(new.metadata_json, '$.positivePrompt') 
                OR 
                json_extract(old.metadata_json, '$.negativePrompt') != json_extract(new.metadata_json, '$.negativePrompt')
            BEGIN
                UPDATE images_fts SET 
                    positive_prompt = json_extract(new.metadata_json, '$.positivePrompt'),
                    negative_prompt = json_extract(new.metadata_json, '$.negativePrompt')
                WHERE id = old.id;
            END;
        "#,
        kind: MigrationKind::Up,
    }
}
