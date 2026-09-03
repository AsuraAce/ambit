use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 83: The released thumbnail repair candidate view predates the
/// photography thumbnail format upgrade. Keep its canonical candidate policy,
/// but require regeneration for Ambit thumbnails below the current version.
pub fn migration83() -> Migration {
    Migration {
        version: 83,
        description: "repair_thumbnail_candidate_version_threshold",
        sql: r#"
            DROP VIEW IF EXISTS thumbnail_repair_required;
            DROP INDEX IF EXISTS idx_images_thumbnail_outdated_queue_v3;

            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_outdated_queue_v3
                ON images(timestamp DESC, id DESC)
                WHERE media_type = 'image'
                  AND is_deleted = 0
                  AND is_missing = 0
                  AND invoke_scope_hidden = 0
                  AND thumbnail_source = 'ambit'
                  AND COALESCE(thumbnail_version, 0) < 2
                  AND thumbnail_path IS NOT NULL
                  AND thumbnail_path != ''
                  AND path != thumbnail_path;

            CREATE VIEW thumbnail_repair_required AS
                SELECT images.*, 'missing' AS thumbnail_repair_reason
                FROM images INDEXED BY idx_images_thumbnail_missing_queue_v3
                WHERE images.invoke_scope_hidden = 0
                  AND EXISTS (SELECT 1 FROM scoped_images scoped WHERE scoped.id = images.id)
                  AND images.is_deleted = 0
                  AND images.media_type = 'image'
                  AND images.is_missing = 0
                  AND IFNULL(images.is_intermediate_gen, 0) = 0
                  AND (images.is_corrupt = 0 OR images.is_corrupt IS NULL)
                  AND images.path NOT LIKE 'blob:%'
                  AND images.path NOT LIKE 'data:%'
                  AND (images.thumbnail_path IS NULL OR images.thumbnail_path = '' OR images.path = images.thumbnail_path)
                UNION ALL
                SELECT images.*, 'outdated' AS thumbnail_repair_reason
                FROM images INDEXED BY idx_images_thumbnail_outdated_queue_v3
                WHERE images.invoke_scope_hidden = 0
                  AND EXISTS (SELECT 1 FROM scoped_images scoped WHERE scoped.id = images.id)
                  AND images.is_deleted = 0
                  AND images.media_type = 'image'
                  AND images.is_missing = 0
                  AND IFNULL(images.is_intermediate_gen, 0) = 0
                  AND (images.is_corrupt = 0 OR images.is_corrupt IS NULL)
                  AND images.path NOT LIKE 'blob:%'
                  AND images.path NOT LIKE 'data:%'
                  AND images.thumbnail_source = 'ambit'
                  AND COALESCE(images.thumbnail_version, 0) < 2
                  AND images.thumbnail_path IS NOT NULL
                  AND images.thumbnail_path != ''
                  AND images.path != images.thumbnail_path;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration83;
    use rusqlite::Connection;

    #[test]
    fn migration_marks_v1_ambit_thumbnails_outdated_and_uses_the_partial_index() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                media_type TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                is_missing INTEGER NOT NULL DEFAULT 0,
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0,
                is_intermediate_gen INTEGER NOT NULL DEFAULT 0,
                is_corrupt INTEGER,
                path TEXT NOT NULL,
                thumbnail_path TEXT,
                thumbnail_source TEXT,
                thumbnail_version INTEGER
            );
            CREATE VIEW scoped_images AS SELECT id FROM images;
            ",
        )
        .expect("base schema");
        conn.execute_batch(
            crate::db::migrations::m79_thumbnail_repair_candidates::migration79().sql,
        )
        .expect("apply released migration 79");
        conn.execute_batch(migration83().sql)
            .expect("apply thumbnail version correction");
        conn.execute_batch(
            "
            INSERT INTO images (
                id, timestamp, media_type, path, thumbnail_path, thumbnail_source, thumbnail_version
            ) VALUES
                ('outdated-v1', 2, 'image', 'source-v1.png', 'thumb-v1.png', 'ambit', 1),
                ('current-v2', 1, 'image', 'source-v2.png', 'thumb-v2.png', 'ambit', 2);
            ",
        )
        .expect("thumbnail rows");

        let candidates = conn
            .prepare(
                "SELECT id, thumbnail_repair_reason
                 FROM thumbnail_repair_required
                 ORDER BY id",
            )
            .expect("candidate query")
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .expect("candidate rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect candidates");
        assert_eq!(
            candidates,
            vec![("outdated-v1".to_string(), "outdated".to_string())]
        );

        let plan = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM thumbnail_repair_required
                 WHERE thumbnail_repair_reason = 'outdated'",
            )
            .expect("candidate plan")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("plan rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect plan");
        assert!(
            plan.iter()
                .any(|detail| detail.contains("idx_images_thumbnail_outdated_queue_v3")),
            "outdated candidate query should use the version-aware partial index: {plan:?}"
        );
    }
}
