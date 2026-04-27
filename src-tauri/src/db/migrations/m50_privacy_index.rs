use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 50: Materialize hide-mode privacy filtering.
///
/// Version 49 exists in some installed databases but is not present in this
/// branch, so this migration intentionally skips to 50.
pub fn migration50() -> Migration {
    Migration {
        version: 50,
        description: "materialize_privacy_mask_index",
        sql: r#"
            -- Hide-mode filtering must not scan metadata_json for every query.
            ALTER TABLE images ADD COLUMN privacy_hidden INTEGER NOT NULL DEFAULT 0;

            CREATE TABLE IF NOT EXISTS privacy_mask_keywords (
                keyword TEXT PRIMARY KEY
            ) STRICT;

            CREATE TABLE IF NOT EXISTS privacy_mask_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) STRICT;

            -- Avoid doing per-row FTS maintenance while repairing prompt columns.
            DROP TRIGGER IF EXISTS trg_images_ai;
            DROP TRIGGER IF EXISTS trg_images_ad;
            DROP TRIGGER IF EXISTS trg_images_au;

            UPDATE images
            SET
                positive_prompt = COALESCE(
                    NULLIF(json_extract(metadata_json, '$.positivePrompt'), ''),
                    NULLIF(json_extract(metadata_json, '$.positive_prompt'), ''),
                    NULLIF(json_extract(original_parsed_json, '$.positivePrompt'), ''),
                    NULLIF(json_extract(original_parsed_json, '$.positive_prompt'), ''),
                    positive_prompt
                ),
                negative_prompt = COALESCE(
                    NULLIF(json_extract(metadata_json, '$.negativePrompt'), ''),
                    NULLIF(json_extract(metadata_json, '$.negative_prompt'), ''),
                    NULLIF(json_extract(original_parsed_json, '$.negativePrompt'), ''),
                    NULLIF(json_extract(original_parsed_json, '$.negative_prompt'), ''),
                    negative_prompt
                )
            WHERE metadata_json IS NOT NULL OR original_parsed_json IS NOT NULL;

            -- Keyword state is populated from app settings after startup. Until
            -- then, preserve explicit manual masks and keep all auto rows visible.
            UPDATE images
            SET privacy_hidden = CASE WHEN user_masked = 1 THEN 1 ELSE 0 END;

            DROP TABLE IF EXISTS images_fts;
            CREATE VIRTUAL TABLE images_fts USING fts5(
                positive_prompt,
                negative_prompt,
                content='images',
                content_rowid='rowid'
            );

            INSERT INTO images_fts(rowid, positive_prompt, negative_prompt)
            SELECT rowid, positive_prompt, negative_prompt FROM images;

            CREATE TRIGGER trg_images_ai AFTER INSERT ON images BEGIN
                INSERT INTO images_fts(rowid, positive_prompt, negative_prompt)
                VALUES (new.rowid, new.positive_prompt, new.negative_prompt);
            END;

            CREATE TRIGGER trg_images_ad AFTER DELETE ON images BEGIN
                INSERT INTO images_fts(images_fts, rowid, positive_prompt, negative_prompt)
                VALUES('delete', old.rowid, old.positive_prompt, old.negative_prompt);
            END;

            CREATE TRIGGER trg_images_au AFTER UPDATE OF positive_prompt, negative_prompt ON images BEGIN
                INSERT INTO images_fts(images_fts, rowid, positive_prompt, negative_prompt)
                VALUES('delete', old.rowid, old.positive_prompt, old.negative_prompt);

                INSERT INTO images_fts(rowid, positive_prompt, negative_prompt)
                VALUES (new.rowid, new.positive_prompt, new.negative_prompt);
            END;

            CREATE TRIGGER trg_images_privacy_ai AFTER INSERT ON images BEGIN
                UPDATE images
                SET privacy_hidden = CASE
                    WHEN new.user_masked = 1 THEN 1
                    WHEN new.user_masked = 0 THEN 0
                    WHEN EXISTS (
                        SELECT 1
                        FROM privacy_mask_keywords k
                        WHERE LOWER(COALESCE(new.positive_prompt, '')) LIKE '%' || k.keyword || '%'
                    ) THEN 1
                    ELSE 0
                END
                WHERE rowid = new.rowid;
            END;

            CREATE TRIGGER trg_images_privacy_au AFTER UPDATE OF user_masked, positive_prompt ON images BEGIN
                UPDATE images
                SET privacy_hidden = CASE
                    WHEN new.user_masked = 1 THEN 1
                    WHEN new.user_masked = 0 THEN 0
                    WHEN EXISTS (
                        SELECT 1
                        FROM privacy_mask_keywords k
                        WHERE LOWER(COALESCE(new.positive_prompt, '')) LIKE '%' || k.keyword || '%'
                    ) THEN 1
                    ELSE 0
                END
                WHERE rowid = new.rowid;
            END;

            CREATE INDEX IF NOT EXISTS idx_images_privacy_fast_sort_v1
                ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, timestamp DESC, id DESC);

            CREATE INDEX IF NOT EXISTS idx_images_privacy_model_stats_v1
                ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, resolved_model_name, model_name);

            CREATE INDEX IF NOT EXISTS idx_images_name_sort_v1
                ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), path ASC, id ASC);

            CREATE INDEX IF NOT EXISTS idx_images_size_sort_v1
                ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), file_size DESC, id DESC);

            ANALYZE images;
        "#,
        kind: MigrationKind::Up,
    }
}
