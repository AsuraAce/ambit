use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 46: Denormalize prompts into images table and optimize FTS.
/// This fixes the O(N) scan bottleneck during metadata updates.
pub fn migration46() -> Migration {
    Migration {
        version: 46,
        description: "denormalize_prompts_and_optimize_fts",
        sql: r#"
            -- 1. Add columns to images table
            ALTER TABLE images ADD COLUMN positive_prompt TEXT;
            ALTER TABLE images ADD COLUMN negative_prompt TEXT;

            -- 2. Backfill from metadata_json
            UPDATE images SET 
                positive_prompt = json_extract(metadata_json, '$.positivePrompt'),
                negative_prompt = json_extract(metadata_json, '$.negativePrompt')
            WHERE metadata_json IS NOT NULL;

            -- 3. Re-create FTS table as external-content table
            DROP TABLE IF EXISTS images_fts;
            
            -- We use the hidden 'rowid' of images table as the sync point.
            -- This makes FTS updates O(log N) instead of O(N).
            CREATE VIRTUAL TABLE images_fts USING fts5(
                positive_prompt,
                negative_prompt,
                content='images',
                content_rowid='rowid'
            );

            -- 4. Initial FTS population
            INSERT INTO images_fts(rowid, positive_prompt, negative_prompt)
            SELECT rowid, positive_prompt, negative_prompt FROM images;

            -- 5. Optimized Triggers
            -- Note: We drop the old versions and create the new content-aware versions.
            DROP TRIGGER IF EXISTS trg_images_ai;
            DROP TRIGGER IF EXISTS trg_images_ad;
            DROP TRIGGER IF EXISTS trg_images_au;

            CREATE TRIGGER trg_images_ai AFTER INSERT ON images BEGIN
                INSERT INTO images_fts(rowid, positive_prompt, negative_prompt)
                VALUES (new.rowid, new.positive_prompt, new.negative_prompt);
            END;

            CREATE TRIGGER trg_images_ad AFTER DELETE ON images BEGIN
                INSERT INTO images_fts(images_fts, rowid, positive_prompt, negative_prompt)
                VALUES('delete', old.rowid, old.positive_prompt, old.negative_prompt);
            END;

            CREATE TRIGGER trg_images_au AFTER UPDATE OF positive_prompt, negative_prompt ON images BEGIN
                -- Delete old entry
                INSERT INTO images_fts(images_fts, rowid, positive_prompt, negative_prompt)
                VALUES('delete', old.rowid, old.positive_prompt, old.negative_prompt);
                
                -- Insert new entry
                INSERT INTO images_fts(rowid, positive_prompt, negative_prompt)
                VALUES (new.rowid, new.positive_prompt, new.negative_prompt);
            END;
        "#,
        kind: MigrationKind::Up,
    }
}
