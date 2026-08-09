use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 63: Persist InvokeAI image source facts separately from generation metadata.
pub fn migration63() -> Migration {
    Migration {
        version: 63,
        description: "add_invoke_image_source_classification",
        sql: r#"
            ALTER TABLE images ADD COLUMN invoke_image_name TEXT;
            ALTER TABLE images ADD COLUMN invoke_image_category TEXT;
            ALTER TABLE images ADD COLUMN invoke_image_origin TEXT;
            ALTER TABLE images ADD COLUMN is_invoke_asset_gen INTEGER GENERATED ALWAYS AS (
                CASE LOWER(TRIM(invoke_image_category))
                    WHEN 'general' THEN 0
                    WHEN 'user' THEN 1
                    WHEN 'control' THEN 1
                    WHEN 'mask' THEN 1
                    WHEN 'other' THEN 1
                    ELSE NULL
                END
            ) VIRTUAL;

            ALTER TABLE removed_images ADD COLUMN invoke_image_name TEXT;
            ALTER TABLE removed_images ADD COLUMN invoke_image_category TEXT;
            ALTER TABLE removed_images ADD COLUMN invoke_image_origin TEXT;
            ALTER TABLE removed_images ADD COLUMN is_invoke_asset_gen INTEGER GENERATED ALWAYS AS (
                CASE LOWER(TRIM(invoke_image_category))
                    WHEN 'general' THEN 0
                    WHEN 'user' THEN 1
                    WHEN 'control' THEN 1
                    WHEN 'mask' THEN 1
                    WHEN 'other' THEN 1
                    ELSE NULL
                END
            ) VIRTUAL;

            CREATE INDEX idx_images_is_invoke_asset_gen
                ON images(is_invoke_asset_gen);
            CREATE INDEX idx_images_invoke_asset_fast_sort_v1
                ON images(
                    is_deleted,
                    IFNULL(is_intermediate_gen, 0),
                    IFNULL(is_grid_gen, 0),
                    IFNULL(is_invoke_asset_gen, 0),
                    timestamp DESC,
                    id DESC
                );
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration63;
    use rusqlite::{params, Connection};

    fn source_schema() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                timestamp INTEGER NOT NULL,
                metadata_json TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                is_intermediate_gen INTEGER NOT NULL DEFAULT 0,
                is_grid_gen INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                timestamp INTEGER NOT NULL
            );
            ",
        )
        .expect("source schema");
        conn
    }

    #[test]
    fn classifies_only_known_invoke_image_asset_categories() {
        let conn = source_schema();
        conn.execute_batch(migration63().sql)
            .expect("apply migration");

        let cases = [
            ("general", Some(0_i64)),
            ("user", Some(1_i64)),
            ("control", Some(1_i64)),
            ("mask", Some(1_i64)),
            ("other", Some(1_i64)),
            (" USER ", Some(1_i64)),
            ("future-category", None),
        ];

        for (index, (category, expected)) in cases.into_iter().enumerate() {
            conn.execute(
                "INSERT INTO images (
                    id, path, timestamp, metadata_json, invoke_image_category
                 ) VALUES (?1, ?2, 1, '{}', ?3)",
                params![
                    format!("image-{index}"),
                    format!("C:/image-{index}.png"),
                    category
                ],
            )
            .expect("insert classified image");

            let actual: Option<i64> = conn
                .query_row(
                    "SELECT is_invoke_asset_gen FROM images WHERE id = ?1",
                    [format!("image-{index}")],
                    |row| row.get(0),
                )
                .expect("classification");
            assert_eq!(actual, expected, "category {category}");
        }

        conn.execute(
            "INSERT INTO images (id, path, timestamp, metadata_json)
             VALUES ('missing', 'C:/missing.png', 1, '{}')",
            [],
        )
        .expect("insert unclassified image");
        let missing: Option<i64> = conn
            .query_row(
                "SELECT is_invoke_asset_gen FROM images WHERE id = 'missing'",
                [],
                |row| row.get(0),
            )
            .expect("missing classification");
        assert_eq!(missing, None);
    }

    #[test]
    fn source_classification_is_independent_of_generation_metadata_and_survives_tombstones() {
        let conn = source_schema();
        conn.execute_batch(migration63().sql)
            .expect("apply migration");

        conn.execute(
            "INSERT INTO images (
                id, path, timestamp, metadata_json,
                invoke_image_name, invoke_image_category, invoke_image_origin
             ) VALUES ('active', 'C:/active.png', 1, '{}', 'active.png', 'control', 'internal')",
            [],
        )
        .expect("insert active image");
        conn.execute(
            "UPDATE images SET metadata_json = '{\"tool\":\"edited\"}' WHERE id = 'active'",
            [],
        )
        .expect("edit generation metadata");

        let active: (String, String, String, Option<i64>) = conn
            .query_row(
                "SELECT invoke_image_name, invoke_image_category, invoke_image_origin,
                        is_invoke_asset_gen
                 FROM images WHERE id = 'active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("active source fields");
        assert_eq!(
            active,
            (
                "active.png".into(),
                "control".into(),
                "internal".into(),
                Some(1)
            )
        );

        conn.execute(
            "INSERT INTO removed_images (
                id, path, timestamp,
                invoke_image_name, invoke_image_category, invoke_image_origin
             ) VALUES ('removed', 'C:/removed.png', 1, 'removed.png', 'general', 'internal')",
            [],
        )
        .expect("insert removed image");
        let removed: (String, String, String, Option<i64>) = conn
            .query_row(
                "SELECT invoke_image_name, invoke_image_category, invoke_image_origin,
                        is_invoke_asset_gen
                 FROM removed_images WHERE id = 'removed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("removed source fields");
        assert_eq!(
            removed,
            (
                "removed.png".into(),
                "general".into(),
                "internal".into(),
                Some(0)
            )
        );
    }

    #[test]
    fn creates_asset_lookup_and_fast_sort_indexes() {
        let conn = source_schema();
        conn.execute_batch(migration63().sql)
            .expect("apply migration");

        let indexes: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'index' AND tbl_name = 'images'
                 ORDER BY name",
            )
            .expect("prepare index query")
            .query_map([], |row| row.get(0))
            .expect("query indexes")
            .collect::<Result<_, _>>()
            .expect("collect indexes");

        assert!(indexes.contains(&"idx_images_is_invoke_asset_gen".to_string()));
        assert!(indexes.contains(&"idx_images_invoke_asset_fast_sort_v1".to_string()));

        let plan: Vec<String> = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM images
                 WHERE is_deleted = 0
                   AND IFNULL(is_intermediate_gen, 0) = 0
                   AND IFNULL(is_grid_gen, 0) = 0
                   AND IFNULL(is_invoke_asset_gen, 0) = 0
                 ORDER BY timestamp DESC, id DESC",
            )
            .expect("prepare query plan")
            .query_map([], |row| row.get(3))
            .expect("query plan")
            .collect::<Result<_, _>>()
            .expect("collect query plan");

        assert!(
            plan.iter()
                .any(|detail| detail.contains("idx_images_invoke_asset_fast_sort_v1")),
            "expected InvokeAI asset fast-sort index, got {plan:?}"
        );
    }
}
