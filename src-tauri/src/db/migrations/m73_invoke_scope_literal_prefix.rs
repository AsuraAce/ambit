use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 73: Correct Invoke root classification and ambiguous Ambit collection scopes.
pub fn migration73() -> Migration {
    Migration {
        version: 73,
        description: "repair_invoke_scope_literal_prefixes",
        sql: r#"
            DROP TABLE IF EXISTS temp.invoke_scope_m73_changed;
            DROP TABLE IF EXISTS temp.invoke_scope_m73_control;
            DROP TABLE IF EXISTS temp.invoke_scope_m73_collection_repair;

            CREATE TEMP TABLE invoke_scope_m73_changed (
                changed INTEGER NOT NULL
            );
            CREATE TEMP TABLE invoke_scope_m73_control AS
            SELECT suppress_invalidation
            FROM invoke_scope_cache_control
            WHERE state_key = 'current';

            UPDATE invoke_scope_cache_control
            SET suppress_invalidation = 1
            WHERE state_key = 'current';

            WITH roots AS (
                SELECT db_path, images_root FROM invoke_scope_cache_state
                UNION
                SELECT db_path, images_root FROM invoke_owner_scope_state
            )
            UPDATE images
            SET invoke_source_id = NULL,
                invoke_owner_id = NULL,
                invoke_scope_hidden = 0
            WHERE invoke_source_id IS NOT NULL
              AND invoke_image_name IS NULL
              AND EXISTS (
                  SELECT 1 FROM roots
                  WHERE roots.db_path = images.invoke_source_id
                    AND LOWER(REPLACE(images.path, '\', '/')) LIKE
                        LOWER(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/%')
              )
              AND NOT EXISTS (
                  SELECT 1 FROM roots
                  WHERE roots.db_path = images.invoke_source_id
                    AND CASE
                        WHEN REPLACE(roots.images_root, '\', '/') GLOB '[A-Za-z]:/*'
                          OR REPLACE(roots.images_root, '\', '/') GLOB '//*'
                        THEN LOWER(SUBSTR(
                            REPLACE(images.path, '\', '/'),
                            1,
                            LENGTH(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/')
                        )) = LOWER(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/')
                        ELSE SUBSTR(
                            REPLACE(images.path, '\', '/'),
                            1,
                            LENGTH(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/')
                        ) = RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/'
                    END
              );
            INSERT INTO invoke_scope_m73_changed SELECT 1 WHERE changes() > 0;

            WITH roots AS (
                SELECT db_path, images_root FROM invoke_scope_cache_state
                UNION
                SELECT db_path, images_root FROM invoke_owner_scope_state
            )
            UPDATE removed_images
            SET invoke_source_id = NULL,
                invoke_owner_id = NULL,
                invoke_scope_hidden = 0
            WHERE invoke_source_id IS NOT NULL
              AND invoke_image_name IS NULL
              AND EXISTS (
                  SELECT 1 FROM roots
                  WHERE roots.db_path = removed_images.invoke_source_id
                    AND LOWER(REPLACE(removed_images.path, '\', '/')) LIKE
                        LOWER(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/%')
              )
              AND NOT EXISTS (
                  SELECT 1 FROM roots
                  WHERE roots.db_path = removed_images.invoke_source_id
                    AND CASE
                        WHEN REPLACE(roots.images_root, '\', '/') GLOB '[A-Za-z]:/*'
                          OR REPLACE(roots.images_root, '\', '/') GLOB '//*'
                        THEN LOWER(SUBSTR(
                            REPLACE(removed_images.path, '\', '/'),
                            1,
                            LENGTH(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/')
                        )) = LOWER(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/')
                        ELSE SUBSTR(
                            REPLACE(removed_images.path, '\', '/'),
                            1,
                            LENGTH(RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/')
                        ) = RTRIM(REPLACE(roots.images_root, '\', '/'), '/') || '/outputs/images/'
                    END
              );
            INSERT INTO invoke_scope_m73_changed SELECT 1 WHERE changes() > 0;

            CREATE TEMP TABLE invoke_scope_m73_collection_repair AS
            WITH candidates AS (
                SELECT id, custom_thumbnail
                FROM collections
                WHERE COALESCE(source, 'ambit') != 'invoke'
                  AND invoke_source_id IS NOT NULL
            ),
            evidence AS (
                SELECT candidates.id AS collection_id,
                       images.invoke_source_id AS source_id,
                       images.invoke_owner_id AS owner_id,
                       CASE
                           WHEN images.id IS NULL OR images.invoke_source_id IS NULL THEN 1
                           ELSE 0
                       END AS is_local_or_unknown
                FROM candidates
                JOIN collection_images ON collection_images.collection_id = candidates.id
                LEFT JOIN images ON images.id = collection_images.image_id

                UNION ALL

                SELECT candidates.id AS collection_id,
                       images.invoke_source_id AS source_id,
                       images.invoke_owner_id AS owner_id,
                       CASE
                           WHEN images.id IS NULL OR images.invoke_source_id IS NULL THEN 1
                           ELSE 0
                       END AS is_local_or_unknown
                FROM candidates
                LEFT JOIN images ON images.id = COALESCE(
                    (
                        SELECT by_id.id FROM images by_id
                        WHERE by_id.id = candidates.custom_thumbnail
                    ),
                    (
                        SELECT by_path.id FROM images by_path
                        WHERE by_path.path = candidates.custom_thumbnail
                    )
                )
                WHERE NULLIF(candidates.custom_thumbnail, '') IS NOT NULL
            ),
            inferred AS (
                SELECT candidates.id,
                       COUNT(evidence.collection_id) AS evidence_count,
                       COALESCE(MAX(evidence.is_local_or_unknown), 0) AS has_local_or_unknown,
                       COUNT(DISTINCT evidence.source_id) AS source_count,
                       MIN(evidence.source_id) AS source_id,
                       COUNT(DISTINCT CASE
                           WHEN evidence.source_id IS NOT NULL THEN evidence.owner_id
                       END) AS owner_count,
                       MIN(CASE
                           WHEN evidence.source_id IS NOT NULL THEN evidence.owner_id
                       END) AS owner_id,
                       COALESCE(MAX(CASE
                           WHEN evidence.source_id IS NOT NULL AND evidence.owner_id IS NULL THEN 1
                           ELSE 0
                       END), 0) AS has_unassigned
                FROM candidates
                LEFT JOIN evidence ON evidence.collection_id = candidates.id
                GROUP BY candidates.id
            )
            SELECT id AS collection_id,
                   CASE
                       WHEN evidence_count > 0
                        AND has_local_or_unknown = 0
                        AND source_count = 1
                       THEN source_id
                       ELSE NULL
                   END AS new_source_id,
                   CASE
                       WHEN evidence_count > 0
                        AND has_local_or_unknown = 0
                        AND source_count = 1
                        AND owner_count = 1
                        AND has_unassigned = 0
                       THEN owner_id
                       ELSE NULL
                   END AS new_owner_id
            FROM inferred;

            UPDATE collections
            SET invoke_source_id = (
                    SELECT repair.new_source_id
                    FROM invoke_scope_m73_collection_repair repair
                    WHERE repair.collection_id = collections.id
                ),
                invoke_owner_id = (
                    SELECT repair.new_owner_id
                    FROM invoke_scope_m73_collection_repair repair
                    WHERE repair.collection_id = collections.id
                ),
                dynamic_count = NULL,
                dynamic_thumbnail_path = NULL,
                dynamic_safe_thumbnail_path = NULL,
                dynamic_thumbnail_is_sensitive = NULL,
                dynamic_thumbnail_cached_at = NULL
            WHERE id IN (
                SELECT repair.collection_id
                FROM invoke_scope_m73_collection_repair repair
                WHERE collections.invoke_source_id IS NOT repair.new_source_id
                   OR collections.invoke_owner_id IS NOT repair.new_owner_id
            );
            INSERT INTO invoke_scope_m73_changed SELECT 1 WHERE changes() > 0;

            DROP TRIGGER IF EXISTS images_assign_invoke_source_after_insert;
            DROP TRIGGER IF EXISTS images_assign_invoke_source_after_update;
            DROP TRIGGER IF EXISTS removed_images_assign_invoke_source_after_insert;

            CREATE TRIGGER images_assign_invoke_source_after_insert
            AFTER INSERT ON images
            WHEN EXISTS (
                 SELECT 1 FROM invoke_owner_scope_state scope
                 WHERE scope.state_key = 'current'
                   AND CASE
                       WHEN REPLACE(scope.images_root, '\', '/') GLOB '[A-Za-z]:/*'
                         OR REPLACE(scope.images_root, '\', '/') GLOB '//*'
                       THEN LOWER(SUBSTR(
                           REPLACE(NEW.path, '\', '/'),
                           1,
                           LENGTH(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       )) = LOWER(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       ELSE SUBSTR(
                           REPLACE(NEW.path, '\', '/'),
                           1,
                           LENGTH(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       ) = RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/'
                   END
             )
            BEGIN
                UPDATE images
                SET invoke_source_id = COALESCE(NEW.invoke_source_id, (
                        SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                    )),
                    invoke_scope_hidden = 0
                WHERE id = NEW.id;
            END;

            CREATE TRIGGER images_assign_invoke_source_after_update
            AFTER UPDATE OF path, invoke_image_name ON images
            WHEN EXISTS (
                 SELECT 1 FROM invoke_owner_scope_state scope
                 WHERE scope.state_key = 'current'
                   AND CASE
                       WHEN REPLACE(scope.images_root, '\', '/') GLOB '[A-Za-z]:/*'
                         OR REPLACE(scope.images_root, '\', '/') GLOB '//*'
                       THEN LOWER(SUBSTR(
                           REPLACE(NEW.path, '\', '/'),
                           1,
                           LENGTH(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       )) = LOWER(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       ELSE SUBSTR(
                           REPLACE(NEW.path, '\', '/'),
                           1,
                           LENGTH(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       ) = RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/'
                   END
             )
            BEGIN
                UPDATE images
                SET invoke_source_id = COALESCE(NEW.invoke_source_id, (
                        SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                    )),
                    invoke_scope_hidden = 0
                WHERE id = NEW.id;
            END;

            CREATE TRIGGER removed_images_assign_invoke_source_after_insert
            AFTER INSERT ON removed_images
            WHEN EXISTS (
                 SELECT 1 FROM invoke_owner_scope_state scope
                 WHERE scope.state_key = 'current'
                   AND CASE
                       WHEN REPLACE(scope.images_root, '\', '/') GLOB '[A-Za-z]:/*'
                         OR REPLACE(scope.images_root, '\', '/') GLOB '//*'
                       THEN LOWER(SUBSTR(
                           REPLACE(NEW.path, '\', '/'),
                           1,
                           LENGTH(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       )) = LOWER(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       ELSE SUBSTR(
                           REPLACE(NEW.path, '\', '/'),
                           1,
                           LENGTH(RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/')
                       ) = RTRIM(REPLACE(scope.images_root, '\', '/'), '/') || '/outputs/images/'
                   END
             )
            BEGIN
                UPDATE removed_images
                SET invoke_source_id = COALESCE(NEW.invoke_source_id, (
                        SELECT db_path FROM invoke_owner_scope_state WHERE state_key = 'current'
                    )),
                    invoke_scope_hidden = 0
                WHERE id = NEW.id;
            END;

            UPDATE invoke_scope_cache_state
            SET status = 'dirty',
                generation = generation + 1,
                updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
            WHERE EXISTS (SELECT 1 FROM invoke_scope_m73_changed)
              AND status IN ('ready', 'building');

            INSERT OR IGNORE INTO invoke_scope_cache_dirty_items (
                scope_key, domain, facet_type, resource_name
            )
            SELECT scope_key, 'full', '', ''
            FROM invoke_scope_cache_state
            WHERE EXISTS (SELECT 1 FROM invoke_scope_m73_changed);

            UPDATE invoke_scope_cache_control
            SET suppress_invalidation = COALESCE((
                    SELECT suppress_invalidation FROM invoke_scope_m73_control LIMIT 1
                ), 0)
            WHERE state_key = 'current';

            DROP TABLE invoke_scope_m73_collection_repair;
            DROP TABLE invoke_scope_m73_control;
            DROP TABLE invoke_scope_m73_changed;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration73;
    use crate::db::migrations::init_db;
    use rusqlite::Connection;

    fn apply_through_72(conn: &Connection) {
        for migration in init_db()
            .into_iter()
            .filter(|migration| migration.version <= 72)
        {
            conn.execute_batch(migration.sql)
                .expect("apply migrations through 72");
        }
    }

    fn scope(conn: &Connection, id: &str) -> (Option<String>, Option<String>) {
        conn.query_row(
            "SELECT invoke_source_id, invoke_owner_id FROM collections WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("collection scope")
    }

    #[test]
    fn repairs_upgraded_ambit_scopes_and_replaces_wildcard_source_trigger() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        apply_through_72(&conn);
        conn.execute_batch(
            "
            INSERT INTO invoke_owner_scope_state (
                state_key, db_path, images_root, scope_mode, owner_id, updated_at
            ) VALUES ('current', 'invoke.db', 'C:/Invoke%Root', 'owner', 'owner-a', 1);
            INSERT INTO invoke_scope_cache_state (
                scope_key, db_path, images_root, scope_mode, owner_id,
                status, generation, built_generation, updated_at
            ) VALUES (
                'owner-a', 'invoke.db', 'C:/Invoke%Root', 'owner', 'owner-a',
                'ready', 0, 0, 1
            );
            INSERT INTO images (
                id, path, timestamp, invoke_image_name, invoke_source_id, invoke_owner_id
            ) VALUES
                ('owned', 'C:/library/owned.png', 1, 'owned.png', 'invoke.db', 'owner-a'),
                ('unassigned', 'C:/library/unassigned.png', 2, 'unassigned.png', 'invoke.db', NULL),
                ('other', 'C:/library/other.png', 3, 'other.png', 'other.db', 'owner-b'),
                ('local', 'C:/library/local.png', 4, NULL, NULL, NULL),
                ('false-source', 'C:/InvokeXRoot/outputs/images/false.png', 5, NULL, 'invoke.db', NULL);
            INSERT INTO removed_images (
                id, path, timestamp, removed_at, invoke_source_id
            ) VALUES ('false-removed', 'C:/InvokeXRoot/outputs/images/removed.png', 6, 7, 'invoke.db');

            INSERT INTO collections (
                id, name, created_at, source, custom_thumbnail, invoke_source_id, invoke_owner_id
            ) VALUES
                ('mixed-local', 'Mixed local', 1, 'ambit', NULL, 'invoke.db', NULL),
                ('mixed-unassigned', 'Mixed unassigned', 2, 'ambit', NULL, 'invoke.db', 'owner-a'),
                ('single-owner', 'Single owner', 3, 'ambit', NULL, 'invoke.db', NULL),
                ('multi-source', 'Multi source', 4, 'ambit', NULL, 'invoke.db', NULL),
                ('local-thumbnail', 'Local thumbnail', 5, 'ambit', 'local', 'invoke.db', 'owner-a'),
                ('missing-thumbnail', 'Missing thumbnail', 6, 'ambit', 'missing', 'invoke.db', 'owner-a'),
                ('path-thumbnail', 'Path thumbnail', 7, 'ambit', 'C:/library/owned.png', 'invoke.db', NULL),
                ('invoke-board', 'Invoke board', 8, 'invoke', NULL, 'invoke.db', 'owner-a');
            INSERT INTO collection_images (collection_id, image_id) VALUES
                ('mixed-local', 'owned'), ('mixed-local', 'local'),
                ('mixed-unassigned', 'owned'), ('mixed-unassigned', 'unassigned'),
                ('single-owner', 'owned'),
                ('multi-source', 'owned'), ('multi-source', 'other'),
                ('local-thumbnail', 'owned'), ('missing-thumbnail', 'owned');
            ",
        )
        .expect("seed upgrade state");

        conn.execute_batch(migration73().sql)
            .expect("apply migration 73");

        assert_eq!(scope(&conn, "mixed-local"), (None, None));
        assert_eq!(
            scope(&conn, "mixed-unassigned"),
            (Some("invoke.db".into()), None)
        );
        assert_eq!(
            scope(&conn, "single-owner"),
            (Some("invoke.db".into()), Some("owner-a".into()))
        );
        assert_eq!(scope(&conn, "multi-source"), (None, None));
        assert_eq!(scope(&conn, "local-thumbnail"), (None, None));
        assert_eq!(
            scope(&conn, "path-thumbnail"),
            (Some("invoke.db".into()), Some("owner-a".into()))
        );
        assert_eq!(scope(&conn, "missing-thumbnail"), (None, None));
        assert_eq!(
            scope(&conn, "invoke-board"),
            (Some("invoke.db".into()), Some("owner-a".into()))
        );
        let membership_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collection_images WHERE collection_id = 'mixed-local'",
                [],
                |row| row.get(0),
            )
            .expect("memberships remain");
        assert_eq!(membership_count, 2);
        let false_source: Option<String> = conn
            .query_row(
                "SELECT invoke_source_id FROM images WHERE id = 'false-source'",
                [],
                |row| row.get(0),
            )
            .expect("false source repair");
        assert_eq!(false_source, None);

        let false_removed_source: Option<String> = conn
            .query_row(
                "SELECT invoke_source_id FROM removed_images WHERE id = 'false-removed'",
                [],
                |row| row.get(0),
            )
            .expect("false removed source repair");
        assert_eq!(false_removed_source, None);

        conn.execute(
            "UPDATE collections
             SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-b'
             WHERE id = 'mixed-local'",
            [],
        )
        .expect("reset metadata remains user-reassignable");
        assert_eq!(
            scope(&conn, "mixed-local"),
            (Some("invoke.db".into()), Some("owner-b".into()))
        );

        conn.execute(
            "INSERT INTO images (id, path, timestamp) VALUES
                ('literal', 'C:/Invoke%Root/outputs/images/literal.png', 6),
                ('wildcard', 'C:/InvokeXRoot/outputs/images/wildcard.png', 7)",
            [],
        )
        .expect("exercise replacement trigger");
        let sources: Vec<(String, Option<String>)> = conn
            .prepare(
                "SELECT id, invoke_source_id
                 FROM images WHERE id IN ('literal', 'wildcard') ORDER BY id",
            )
            .expect("source query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("source rows")
            .collect::<Result<_, _>>()
            .expect("collect sources");
        assert_eq!(
            sources,
            vec![
                ("literal".into(), Some("invoke.db".into())),
                ("wildcard".into(), None)
            ]
        );
    }
}
