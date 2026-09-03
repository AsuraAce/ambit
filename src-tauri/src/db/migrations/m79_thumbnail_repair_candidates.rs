use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 79: keep thumbnail repair eligibility in database-owned views and
/// give each disjoint repair reason an order-preserving partial index.
pub fn migration79() -> Migration {
    Migration {
        version: 79,
        description: "add_thumbnail_repair_candidate_views",
        sql: r#"
            DROP INDEX IF EXISTS idx_images_thumbnail_optimization_queue_v1;
            DROP INDEX IF EXISTS idx_images_thumbnail_optimization_queue_v2;

            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_missing_queue_v3
                ON images(timestamp DESC, id DESC)
                WHERE media_type = 'image'
                  AND is_deleted = 0
                  AND is_missing = 0
                  AND invoke_scope_hidden = 0
                  AND (thumbnail_path IS NULL OR thumbnail_path = '' OR path = thumbnail_path);

            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_outdated_queue_v3
                ON images(timestamp DESC, id DESC)
                WHERE media_type = 'image'
                  AND is_deleted = 0
                  AND is_missing = 0
                  AND invoke_scope_hidden = 0
                  AND thumbnail_source = 'ambit'
                  AND COALESCE(thumbnail_version, 0) < 1
                  AND thumbnail_path IS NOT NULL
                  AND thumbnail_path != ''
                  AND path != thumbnail_path;

            CREATE INDEX IF NOT EXISTS idx_images_thumbnail_upgradeable_queue_v3
                ON images(timestamp DESC, id DESC)
                WHERE media_type = 'image'
                  AND is_deleted = 0
                  AND is_missing = 0
                  AND invoke_scope_hidden = 0
                  AND thumbnail_path IS NOT NULL
                  AND thumbnail_path != ''
                  AND path != thumbnail_path
                  AND (thumbnail_source IS NULL OR thumbnail_source != 'ambit');

            DROP VIEW IF EXISTS thumbnail_repair_required;
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
                  AND COALESCE(images.thumbnail_version, 0) < 1
                  AND images.thumbnail_path IS NOT NULL
                  AND images.thumbnail_path != ''
                  AND images.path != images.thumbnail_path;

            DROP VIEW IF EXISTS thumbnail_repair_upgradeable;
            CREATE VIEW thumbnail_repair_upgradeable AS
                SELECT images.*, 'upgradeable' AS thumbnail_repair_reason
                FROM images INDEXED BY idx_images_thumbnail_upgradeable_queue_v3
                WHERE images.invoke_scope_hidden = 0
                  AND EXISTS (SELECT 1 FROM scoped_images scoped WHERE scoped.id = images.id)
                  AND images.is_deleted = 0
                  AND images.media_type = 'image'
                  AND images.is_missing = 0
                  AND IFNULL(images.is_intermediate_gen, 0) = 0
                  AND (images.is_corrupt = 0 OR images.is_corrupt IS NULL)
                  AND images.path NOT LIKE 'blob:%'
                  AND images.path NOT LIKE 'data:%'
                  AND images.thumbnail_path IS NOT NULL
                  AND images.thumbnail_path != ''
                  AND images.path != images.thumbnail_path
                  AND (images.thumbnail_source IS NULL OR images.thumbnail_source != 'ambit');
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration79;
    use rusqlite::Connection;

    #[test]
    fn migration_replaces_the_broad_queue_index_with_canonical_candidate_views() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        for migration in crate::db::migrations::get_migrations()
            .into_iter()
            .filter(|migration| migration.version < 79)
        {
            conn.execute_batch(&migration.sql)
                .expect("apply preceding migration");
        }

        conn.execute_batch(
            "CREATE INDEX idx_images_thumbnail_optimization_queue_v2 ON images(timestamp DESC, id DESC);",
        )
        .expect("legacy queue index");
        conn.execute_batch(migration79().sql)
            .expect("apply migration 79");

        let objects = conn
            .prepare(
                "SELECT name FROM sqlite_master
                 WHERE name LIKE 'idx_images_thumbnail_%_queue_v3'
                    OR name IN ('thumbnail_repair_required', 'thumbnail_repair_upgradeable')
                 ORDER BY name",
            )
            .expect("object query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("objects")
            .collect::<Result<Vec<_>, _>>()
            .expect("object names");

        assert_eq!(
            objects,
            vec![
                "idx_images_thumbnail_missing_queue_v3",
                "idx_images_thumbnail_outdated_queue_v3",
                "idx_images_thumbnail_upgradeable_queue_v3",
                "thumbnail_repair_required",
                "thumbnail_repair_upgradeable",
            ]
        );
        let old_index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE name = 'idx_images_thumbnail_optimization_queue_v2'",
                [],
                |row| row.get(0),
            )
            .expect("old index count");
        assert_eq!(old_index_count, 0);
    }
}
