use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 63: Persist detected and effective image origins plus normalized
/// camera-photo metadata without changing the existing generation metadata.
pub fn migration63() -> Migration {
    Migration {
        version: 63,
        description: "add_photography_catalog_fields",
        sql: r#"
            ALTER TABLE images ADD COLUMN detected_source_kind TEXT NOT NULL DEFAULT 'other'
                CHECK (detected_source_kind IN ('generated', 'photograph', 'other'));
            ALTER TABLE images ADD COLUMN source_kind_override TEXT
                CHECK (source_kind_override IS NULL OR source_kind_override IN ('generated', 'photograph', 'other'));
            ALTER TABLE images ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'other'
                CHECK (source_kind IN ('generated', 'photograph', 'other'));
            ALTER TABLE images ADD COLUMN photo_metadata_json TEXT;
            ALTER TABLE images ADD COLUMN capture_wall_time_ms INTEGER;
            ALTER TABLE images ADD COLUMN display_timestamp INTEGER NOT NULL DEFAULT 0;

            ALTER TABLE removed_images ADD COLUMN detected_source_kind TEXT NOT NULL DEFAULT 'other'
                CHECK (detected_source_kind IN ('generated', 'photograph', 'other'));
            ALTER TABLE removed_images ADD COLUMN source_kind_override TEXT
                CHECK (source_kind_override IS NULL OR source_kind_override IN ('generated', 'photograph', 'other'));
            ALTER TABLE removed_images ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'other'
                CHECK (source_kind IN ('generated', 'photograph', 'other'));
            ALTER TABLE removed_images ADD COLUMN photo_metadata_json TEXT;
            ALTER TABLE removed_images ADD COLUMN capture_wall_time_ms INTEGER;
            ALTER TABLE removed_images ADD COLUMN display_timestamp INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE removed_images ADD COLUMN thumbnail_version INTEGER NOT NULL DEFAULT 1;

            UPDATE images
            SET detected_source_kind = CASE
                    WHEN (tool IS NOT NULL AND TRIM(tool) != '' AND LOWER(tool) != 'unknown')
                         OR NULLIF(TRIM(positive_prompt), '') IS NOT NULL
                         OR (json_valid(metadata_json) AND (
                                json_type(metadata_json, '$.workflow') IS NOT NULL
                                OR json_type(metadata_json, '$.prompt') IS NOT NULL
                            ))
                    THEN 'generated'
                    ELSE 'other'
                END;

            UPDATE images
            SET source_kind = COALESCE(source_kind_override, detected_source_kind),
                display_timestamp = timestamp;

            UPDATE removed_images
            SET detected_source_kind = CASE
                    WHEN json_valid(metadata_json) AND (
                            (json_extract(metadata_json, '$.tool') IS NOT NULL
                             AND TRIM(json_extract(metadata_json, '$.tool')) != ''
                             AND LOWER(json_extract(metadata_json, '$.tool')) != 'unknown')
                            OR NULLIF(TRIM(COALESCE(
                                json_extract(metadata_json, '$.positivePrompt'),
                                json_extract(metadata_json, '$.positive_prompt')
                            )), '') IS NOT NULL
                            OR json_type(metadata_json, '$.workflow') IS NOT NULL
                            OR json_type(metadata_json, '$.workflowJson') IS NOT NULL
                        )
                    THEN 'generated'
                    ELSE 'other'
                END;

            UPDATE removed_images
            SET source_kind = detected_source_kind,
                display_timestamp = timestamp;

            UPDATE images
            SET thumbnail_version = 2
            WHERE thumbnail_source = 'ambit' AND thumbnail_version = 1;

            UPDATE removed_images
            SET thumbnail_version = 2
            WHERE thumbnail_source = 'ambit' AND thumbnail_version = 1;

            CREATE INDEX IF NOT EXISTS idx_images_display_timestamp
                ON images(display_timestamp DESC, id);
            CREATE INDEX IF NOT EXISTS idx_images_source_kind_display_timestamp
                ON images(source_kind, display_timestamp DESC, id);
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration63;

    fn setup() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                metadata_json TEXT,
                thumbnail_source TEXT,
                thumbnail_version INTEGER NOT NULL DEFAULT 1,
                tool TEXT,
                positive_prompt TEXT
            );
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                metadata_json TEXT,
                thumbnail_source TEXT
            );

            INSERT INTO images VALUES
                ('tool', 10, '{}', 'ambit', 1, 'ComfyUI', NULL),
                ('prompt', 20, '{}', 'invokeai', 1, 'Unknown', 'a lighthouse'),
                ('workflow', 30, '{"workflow":{"nodes":[]}}', NULL, 1, NULL, NULL),
                ('ambiguous', 40, '{}', 'ambit', 1, 'Unknown', '');
            INSERT INTO removed_images VALUES
                ('removed', 50, '{}', 'ambit'),
                ('removed-generated', 60, '{"tool":"InvokeAI"}', 'invokeai');
            "#,
        )
        .expect("setup schema");
        conn
    }

    #[test]
    fn backfills_only_strong_generated_evidence_and_preserves_dates() {
        let conn = setup();
        conn.execute_batch(migration63().sql)
            .expect("apply migration");

        let rows: Vec<(String, String, String, i64, i64)> = conn
            .prepare(
                "SELECT id, detected_source_kind, source_kind, display_timestamp, thumbnail_version
                 FROM images ORDER BY id",
            )
            .expect("prepare query")
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .expect("query images")
            .collect::<Result<_, _>>()
            .expect("collect images");

        for id in ["tool", "prompt", "workflow"] {
            let row = rows.iter().find(|row| row.0 == id).expect("generated row");
            assert_eq!(row.1, "generated");
            assert_eq!(row.2, "generated");
        }

        let ambiguous = rows
            .iter()
            .find(|row| row.0 == "ambiguous")
            .expect("ambiguous row");
        assert_eq!(ambiguous.1, "other");
        assert_eq!(ambiguous.2, "other");
        assert_eq!(ambiguous.3, 40);
        assert_eq!(ambiguous.4, 2, "existing Ambit thumbnails stay current");

        let removed: (String, i64, i64) = conn
            .query_row(
                "SELECT detected_source_kind, display_timestamp, thumbnail_version
                 FROM removed_images WHERE id = 'removed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("removed row");
        assert_eq!(removed, ("other".to_string(), 50, 2));

        let removed_generated: String = conn
            .query_row(
                "SELECT source_kind FROM removed_images WHERE id = 'removed-generated'",
                [],
                |row| row.get(0),
            )
            .expect("removed generated row");
        assert_eq!(removed_generated, "generated");
    }

    #[test]
    fn creates_covering_source_and_date_indexes() {
        let conn = setup();
        conn.execute_batch(migration63().sql)
            .expect("apply migration");
        conn.execute_batch(
            r#"
            WITH RECURSIVE sequence(value) AS (
                SELECT 1
                UNION ALL
                SELECT value + 1 FROM sequence WHERE value < 10000
            )
            INSERT INTO images (
                id, timestamp, metadata_json, thumbnail_version,
                detected_source_kind, source_kind, capture_wall_time_ms, display_timestamp
            )
            SELECT
                printf('synthetic-%05d', value),
                value,
                '{}',
                2,
                CASE WHEN value % 3 = 0 THEN 'photograph' ELSE 'other' END,
                CASE WHEN value % 3 = 0 THEN 'photograph' ELSE 'other' END,
                CASE WHEN value % 3 = 0 THEN value ELSE NULL END,
                value
            FROM sequence;
            ANALYZE;
            "#,
        )
        .expect("seed large synthetic library");

        let plan = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM images
                 WHERE source_kind = 'photograph'
                 ORDER BY display_timestamp DESC, id
                 LIMIT 50",
            )
            .expect("prepare query plan")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect query plan")
            .join(" ");

        assert!(
            plan.contains("idx_images_source_kind_display_timestamp"),
            "unexpected query plan: {plan}"
        );

        let date_plan = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM images
                 WHERE (source_kind = 'photograph'
                        AND capture_wall_time_ms IS NOT NULL
                        AND display_timestamp >= 2500)
                    OR ((source_kind != 'photograph' OR capture_wall_time_ms IS NULL)
                        AND display_timestamp >= 2500)
                 ORDER BY display_timestamp DESC, id
                 LIMIT 50",
            )
            .expect("prepare date query plan")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("date query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect date query plan")
            .join(" ");

        assert!(
            date_plan.contains("idx_images_display_timestamp"),
            "effective-date predicate bypassed the display-date index: {date_plan}"
        );
    }
}
