use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 75: Close the remaining owner-scope upgrade gaps. Recompute
/// already-scoped collections and the removed-only case migration 73 could not
/// observe, while preserving deliberate global scope for active collections.
pub fn migration75() -> Migration {
    Migration {
        version: 75,
        description: "repair_owner_scope_upgrade_gaps",
        sql: r#"
            DROP TABLE IF EXISTS temp.invoke_scope_m75_bad_images;
            DROP TABLE IF EXISTS temp.invoke_scope_m75_bad_removed;
            DROP TABLE IF EXISTS temp.invoke_scope_m75_collections;
            DROP TABLE IF EXISTS temp.invoke_scope_m75_collection_repair;
            CREATE TABLE IF NOT EXISTS legacy_collection_import_receipts (
                import_key TEXT PRIMARY KEY,
                completed_at INTEGER NOT NULL
            );


            CREATE TEMP TABLE invoke_scope_m75_bad_images (
                id TEXT PRIMARY KEY
            );
            CREATE TEMP TABLE invoke_scope_m75_bad_removed (
                id TEXT PRIMARY KEY
            );
            CREATE TEMP TABLE invoke_scope_m75_collections (
                id TEXT PRIMARY KEY
            );

            WITH roots AS (
                SELECT db_path, images_root FROM invoke_scope_cache_state
                UNION
                SELECT db_path, images_root FROM invoke_owner_scope_state
            )
            INSERT OR IGNORE INTO invoke_scope_m75_bad_images (id)
            SELECT images.id
            FROM images
            WHERE images.invoke_source_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM roots
                  WHERE roots.db_path = images.invoke_source_id
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

            WITH roots AS (
                SELECT db_path, images_root FROM invoke_scope_cache_state
                UNION
                SELECT db_path, images_root FROM invoke_owner_scope_state
            )
            INSERT OR IGNORE INTO invoke_scope_m75_bad_removed (id)
            SELECT removed_images.id
            FROM removed_images
            WHERE removed_images.invoke_source_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM roots
                  WHERE roots.db_path = removed_images.invoke_source_id
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

            INSERT OR IGNORE INTO invoke_scope_m75_collections (id)
            SELECT DISTINCT collections.id
            FROM collections
            JOIN collection_images
              ON collection_images.collection_id = collections.id
            JOIN images
              ON images.id = collection_images.image_id
            WHERE COALESCE(collections.source, 'ambit') != 'invoke'
              AND collections.invoke_source_id IS NOT NULL;
            INSERT OR IGNORE INTO invoke_scope_m75_collections (id)
            SELECT DISTINCT collections.id
            FROM collections
            JOIN removed_images
            JOIN json_each(CASE
                WHEN json_valid(removed_images.collection_ids_json)
                 AND json_type(removed_images.collection_ids_json) = 'array'
                THEN removed_images.collection_ids_json
                ELSE '[]'
            END) membership
              ON CAST(membership.value AS TEXT) = collections.id
            WHERE COALESCE(collections.source, 'ambit') != 'invoke'
              AND removed_images.invoke_source_id IS NOT NULL
              AND membership.type = 'text'
              AND (
                  collections.invoke_source_id IS NOT NULL
                  OR (
                      collections.invoke_owner_id IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM collection_images active_membership
                          WHERE active_membership.collection_id = collections.id
                      )
                  )
              );

            INSERT OR IGNORE INTO invoke_scope_m75_collections (id)
            SELECT DISTINCT collection_images.collection_id
            FROM collection_images
            JOIN invoke_scope_m75_bad_images bad
              ON bad.id = collection_images.image_id;

            INSERT OR IGNORE INTO invoke_scope_m75_collections (id)
            SELECT DISTINCT collections.id
            FROM collections
            JOIN invoke_scope_m75_bad_images bad
              ON bad.id = collections.custom_thumbnail
            WHERE COALESCE(collections.source, 'ambit') != 'invoke';

            INSERT OR IGNORE INTO invoke_scope_m75_collections (id)
            SELECT DISTINCT collections.id
            FROM collections
            JOIN invoke_scope_m75_bad_removed bad
              ON bad.id = collections.custom_thumbnail
            WHERE COALESCE(collections.source, 'ambit') != 'invoke';

            UPDATE images
            SET invoke_source_id = NULL,
                invoke_owner_id = NULL,
                invoke_scope_hidden = 0
            WHERE id IN (SELECT id FROM invoke_scope_m75_bad_images);

            UPDATE removed_images
            SET invoke_source_id = NULL,
                invoke_owner_id = NULL,
                invoke_scope_hidden = 0
            WHERE id IN (SELECT id FROM invoke_scope_m75_bad_removed);

            CREATE TEMP TABLE invoke_scope_m75_collection_repair AS
            WITH candidates AS (
                SELECT collections.id, collections.custom_thumbnail
                FROM collections
                JOIN invoke_scope_m75_collections affected
                  ON affected.id = collections.id
                WHERE COALESCE(collections.source, 'ambit') != 'invoke'
            ),
            evidence AS (
                SELECT candidates.id AS collection_id,
                       images.invoke_source_id AS source_id,
                       images.invoke_owner_id AS owner_id,
                       CASE WHEN images.id IS NULL OR images.invoke_source_id IS NULL THEN 1 ELSE 0 END
                           AS is_local_or_unknown
                FROM candidates
                JOIN collection_images ON collection_images.collection_id = candidates.id
                LEFT JOIN images ON images.id = collection_images.image_id

                UNION ALL

                SELECT candidates.id,
                       removed_images.invoke_source_id,
                       removed_images.invoke_owner_id,
                       CASE
                           WHEN removed_images.id IS NULL OR removed_images.invoke_source_id IS NULL
                           THEN 1 ELSE 0
                       END
                FROM candidates
                JOIN removed_images
                JOIN json_each(CASE
                    WHEN json_valid(removed_images.collection_ids_json)
                     AND json_type(removed_images.collection_ids_json) = 'array'
                    THEN removed_images.collection_ids_json
                    ELSE '[]'
                END) membership
                  ON CAST(membership.value AS TEXT) = candidates.id
                 AND membership.type = 'text'

                UNION ALL

                SELECT candidates.id,
                       COALESCE(images.invoke_source_id, removed_images.invoke_source_id),
                       COALESCE(images.invoke_owner_id, removed_images.invoke_owner_id),
                       CASE
                           WHEN images.id IS NULL AND removed_images.id IS NULL THEN 1
                           WHEN COALESCE(images.invoke_source_id, removed_images.invoke_source_id) IS NULL THEN 1
                           ELSE 0
                       END
                FROM candidates
                LEFT JOIN images
                  ON images.id = candidates.custom_thumbnail OR images.path = candidates.custom_thumbnail
                LEFT JOIN removed_images
                  ON removed_images.id = candidates.custom_thumbnail
                  OR removed_images.path = candidates.custom_thumbnail
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
                    FROM invoke_scope_m75_collection_repair repair
                    WHERE repair.collection_id = collections.id
                ),
                invoke_owner_id = (
                    SELECT repair.new_owner_id
                    FROM invoke_scope_m75_collection_repair repair
                    WHERE repair.collection_id = collections.id
                )
            WHERE id IN (SELECT collection_id FROM invoke_scope_m75_collection_repair)
              AND (
                  invoke_source_id IS NOT (
                      SELECT repair.new_source_id
                      FROM invoke_scope_m75_collection_repair repair
                      WHERE repair.collection_id = collections.id
                  )
                  OR invoke_owner_id IS NOT (
                      SELECT repair.new_owner_id
                      FROM invoke_scope_m75_collection_repair repair
                      WHERE repair.collection_id = collections.id
                  )
              );

            ALTER TABLE collections
                ADD COLUMN invoke_board_verified INTEGER NOT NULL DEFAULT 1
                CHECK (invoke_board_verified IN (0, 1));

            ALTER TABLE invoke_owner_scope_state
                ADD COLUMN boards_verified INTEGER NOT NULL DEFAULT 1
                CHECK (boards_verified IN (0, 1));


            ALTER TABLE invoke_scope_cache_state
                ADD COLUMN build_session_id TEXT;

            INSERT OR IGNORE INTO invoke_scope_cache_dirty_items (
                scope_key, domain, facet_type, resource_name
            )
            SELECT scope_key, 'full', '', ''
            FROM invoke_scope_cache_state
            WHERE status = 'building';
            UPDATE invoke_scope_cache_state
            SET status = 'dirty', build_session_id = NULL
            WHERE status = 'building';
            DROP VIEW IF EXISTS scoped_collections;
            CREATE VIEW scoped_collections AS
            SELECT c.rowid AS rowid, c.*
            FROM collections c
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE c.invoke_source_id IS NULL
               OR (
                    c.invoke_source_id = s.db_path
                    AND (
                        s.scope_mode IN ('legacy', 'all')
                        OR (
                            s.scope_mode = 'owner'
                            AND c.invoke_owner_id IS NOT NULL
                            AND c.invoke_owner_id = s.owner_id
                            AND (
                                COALESCE(c.source, 'ambit') != 'invoke'
                                OR (s.boards_verified = 1 AND c.invoke_board_verified = 1)
                            )
                        )
                    )
               );

            DROP TABLE invoke_scope_m75_collection_repair;
            DROP TABLE invoke_scope_m75_collections;
            DROP TABLE invoke_scope_m75_bad_removed;
            DROP TABLE invoke_scope_m75_bad_images;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration75;
    use rusqlite::Connection;

    fn source_schema() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY, path TEXT NOT NULL, invoke_image_name TEXT,
                invoke_source_id TEXT, invoke_owner_id TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY, path TEXT NOT NULL, invoke_image_name TEXT,
                invoke_source_id TEXT, invoke_owner_id TEXT, invoke_scope_hidden INTEGER NOT NULL DEFAULT 0,
                collection_ids_json TEXT
            );
            CREATE TABLE collections (
                id TEXT PRIMARY KEY, source TEXT, custom_thumbnail TEXT,
                invoke_source_id TEXT, invoke_owner_id TEXT, dynamic_count INTEGER,
                dynamic_thumbnail_path TEXT, dynamic_safe_thumbnail_path TEXT,
                dynamic_thumbnail_is_sensitive INTEGER, dynamic_thumbnail_cached_at INTEGER
            );
            CREATE TABLE collection_images (collection_id TEXT NOT NULL, image_id TEXT NOT NULL);
            CREATE TABLE invoke_scope_cache_state (
                scope_key TEXT PRIMARY KEY, db_path TEXT NOT NULL, images_root TEXT NOT NULL,
                scope_mode TEXT NOT NULL, owner_id TEXT,
                status TEXT NOT NULL DEFAULT 'ready'
            );
            CREATE TABLE invoke_scope_cache_dirty_items (
                scope_key TEXT NOT NULL, domain TEXT NOT NULL,
                facet_type TEXT NOT NULL, resource_name TEXT NOT NULL,
                PRIMARY KEY (scope_key, domain, facet_type, resource_name)
            );
            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY, db_path TEXT NOT NULL, images_root TEXT NOT NULL,
                scope_mode TEXT NOT NULL, owner_id TEXT, updated_at INTEGER NOT NULL
            );
            INSERT INTO invoke_scope_cache_state
                (scope_key, db_path, images_root, scope_mode, owner_id)
                VALUES
                    ('all', 'C:/Invoke%Root/invoke.db', 'C:/Invoke%Root', 'all', NULL),
                    ('underscore', 'D:/Invoke_Root/invoke.db', 'D:/Invoke_Root', 'all', NULL),
                    ('other', 'E:/Other/invoke.db', 'E:/Other', 'all', NULL);
            UPDATE invoke_scope_cache_state SET status = 'building'
            WHERE scope_key = 'all';
            INSERT INTO invoke_owner_scope_state
                (state_key, db_path, images_root, scope_mode, owner_id, updated_at)
                VALUES ('current', 'C:/Invoke%Root/invoke.db', 'C:/Invoke%Root', 'owner', 'owner-a', 1);
            CREATE VIEW scoped_collections AS SELECT rowid, * FROM collections;
            ",
        )
        .expect("source schema");
        conn
    }

    #[test]
    fn repairs_collection_scope_from_active_and_removed_memberships_without_data_loss() {
        let conn = source_schema();
        conn.execute_batch(
            r#"
            INSERT INTO images (
                id, path, invoke_image_name, invoke_source_id, invoke_owner_id
            ) VALUES
                (
                    'active-owner', 'C:/Invoke%Root/outputs/images/active.png', 'active.png',
                    'C:/Invoke%Root/invoke.db', 'owner-a'
                ),
                (
                    'copied-active', 'C:/InvokeXRoot/outputs/images/copied.png', 'copied.png',
                    'C:/Invoke%Root/invoke.db', 'owner-a'
                );

            INSERT INTO removed_images (
                id, path, invoke_image_name, invoke_source_id, invoke_owner_id, collection_ids_json
            ) VALUES
                (
                    'removed-owner', 'C:/Invoke%Root/outputs/images/removed.png', 'removed.png',
                    'C:/Invoke%Root/invoke.db', 'owner-a', '["removed-only","multi-source"]'
                ),
                (
                    'removed-owner-a', 'C:/Invoke%Root/outputs/images/a.png', 'a.png',
                    'C:/Invoke%Root/invoke.db', 'owner-a', '["mixed-owner"]'
                ),
                (
                    'removed-owner-b', 'C:/Invoke%Root/outputs/images/b.png', 'b.png',
                    'C:/Invoke%Root/invoke.db', 'owner-b', '["mixed-owner","migration74-mixed"]'
                ),
                (
                    'removed-other', 'E:/Other/outputs/images/other.png', 'other.png',
                    'E:/Other/invoke.db', 'owner-a', '["multi-source"]'
                ),
                (
                    'copied-removed', 'D:/InvokeXRoot/outputs/images/copied.png', 'copied.png',
                    'D:/Invoke_Root/invoke.db', 'owner-a', '[]'
                ),
                (
                    'scalar-membership', 'C:/Invoke%Root/outputs/images/scalar.png', 'scalar.png',
                    'C:/Invoke%Root/invoke.db', 'owner-a', '"scalar-collection"'
                ),
                (
                    'object-membership', 'C:/Invoke%Root/outputs/images/object.png', 'object.png',
                    'C:/Invoke%Root/invoke.db', 'owner-a', '{"key":"object-collection"}'
                );

            INSERT INTO collections (
                id, source, custom_thumbnail, invoke_source_id, invoke_owner_id,
                dynamic_count, dynamic_thumbnail_path, dynamic_safe_thumbnail_path,
                dynamic_thumbnail_is_sensitive, dynamic_thumbnail_cached_at
            ) VALUES
                (
                    'removed-only', 'ambit', 'removed-owner', NULL, NULL,
                    17, 'dynamic.webp', 'safe.webp', 1, 123
                ),
                ('active-only', 'ambit', 'active-owner', 'C:/Invoke%Root/invoke.db', 'owner-b', NULL, NULL, NULL, NULL, NULL),
                ('deliberate-global-active', 'ambit', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('mixed-owner', 'ambit', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                (
                    'migration74-mixed', 'ambit', NULL, 'C:/Invoke%Root/invoke.db', 'owner-a',
                    NULL, NULL, NULL, NULL, NULL
                ),
                ('multi-source', 'ambit', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('copied-collection', 'ambit', 'copied-active', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('unrelated', 'ambit', NULL, NULL, NULL, 5, 'unrelated.webp', NULL, 0, 456),
                (
                    'unrelated-scoped', 'ambit', NULL, 'E:/Other/invoke.db', 'owner-z',
                    NULL, NULL, NULL, NULL, NULL
                ),
                (
                    'invoke-board', 'invoke', NULL, 'C:/Invoke%Root/invoke.db', 'owner-a',
                    NULL, NULL, NULL, NULL, NULL
                ),
                (
                    'ambit-owner-board', 'ambit', NULL, 'C:/Invoke%Root/invoke.db', 'owner-a',
                    NULL, NULL, NULL, NULL, NULL
                ),
                ('scalar-collection', 'ambit', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
                ('object-collection', 'ambit', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

            INSERT INTO collection_images (collection_id, image_id) VALUES
                ('active-only', 'active-owner'),
                ('deliberate-global-active', 'active-owner'),
                ('migration74-mixed', 'active-owner'),
                ('copied-collection', 'copied-active');
            "#,
        )
        .expect("seed");

        let removed_rowid: i64 = conn
            .query_row(
                "SELECT rowid FROM collections WHERE id = 'removed-only'",
                [],
                |row| row.get(0),
            )
            .expect("removed collection rowid");
        let membership_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM collection_images", [], |row| {
                row.get(0)
            })
            .expect("membership count");

        conn.execute_batch(migration75().sql).expect("migration 75");

        let recovered_cache_state: (String, Option<String>) = conn
            .query_row(
                "SELECT status, build_session_id FROM invoke_scope_cache_state WHERE scope_key = 'all'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("recovered upgrade cache state");
        assert_eq!(recovered_cache_state, ("dirty".to_string(), None));
        let full_repair: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items
                 WHERE scope_key = 'all' AND domain = 'full'",
                [],
                |row| row.get(0),
            )
            .expect("upgrade full repair marker");
        assert_eq!(full_repair, 1);

        let removed_scope: (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id, custom_thumbnail, dynamic_count,
                        dynamic_thumbnail_path, dynamic_safe_thumbnail_path,
                        dynamic_thumbnail_is_sensitive, dynamic_thumbnail_cached_at
                 FROM collections WHERE id = 'removed-only'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .expect("removed collection");
        assert_eq!(
            removed_scope,
            (
                Some("C:/Invoke%Root/invoke.db".to_string()),
                Some("owner-a".to_string()),
                Some("removed-owner".to_string()),
                Some(17),
                Some("dynamic.webp".to_string()),
                Some("safe.webp".to_string()),
                Some(1),
                Some(123),
            )
        );

        let active_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id FROM collections WHERE id = 'active-only'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("active collection");
        assert_eq!(
            active_scope,
            (
                Some("C:/Invoke%Root/invoke.db".to_string()),
                Some("owner-a".to_string())
            )
        );

        let deliberate_global_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id
                 FROM collections WHERE id = 'deliberate-global-active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("deliberate global collection");
        assert_eq!(deliberate_global_scope, (None, None));

        for collection_id in ["scalar-collection", "object-collection"] {
            let scope: (Option<String>, Option<String>) = conn
                .query_row(
                    "SELECT invoke_source_id, invoke_owner_id FROM collections WHERE id = ?1",
                    [collection_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("non-array payload collection");
            assert_eq!(
                scope,
                (None, None),
                "non-array removed-image payload must not provide ownership evidence"
            );
        }

        let mixed_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id FROM collections WHERE id = 'mixed-owner'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("mixed owner collection");
        assert_eq!(
            mixed_scope,
            (Some("C:/Invoke%Root/invoke.db".to_string()), None)
        );

        let upgraded_mixed_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id
                 FROM collections WHERE id = 'migration74-mixed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("migration 74 mixed owner collection");
        assert_eq!(
            upgraded_mixed_scope,
            (Some("C:/Invoke%Root/invoke.db".to_string()), None)
        );

        let multi_source_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id FROM collections WHERE id = 'multi-source'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("multi source collection");
        assert_eq!(multi_source_scope, (None, None));

        let copied_active_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id FROM images WHERE id = 'copied-active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("copied active image");
        assert_eq!(copied_active_scope, (None, None));
        let copied_removed_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id
                 FROM removed_images WHERE id = 'copied-removed'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("copied removed image");
        assert_eq!(copied_removed_scope, (None, None));

        let repaired_rowid: i64 = conn
            .query_row(
                "SELECT rowid FROM collections WHERE id = 'removed-only'",
                [],
                |row| row.get(0),
            )
            .expect("repaired collection rowid");
        let repaired_membership_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM collection_images", [], |row| {
                row.get(0)
            })
            .expect("repaired membership count");
        assert_eq!(repaired_rowid, removed_rowid);
        assert_eq!(repaired_membership_count, membership_count);

        let unrelated_scope: (Option<String>, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id, dynamic_thumbnail_path
                 FROM collections WHERE id = 'unrelated-scoped'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("unrelated collection");
        assert_eq!(
            unrelated_scope,
            (
                Some("E:/Other/invoke.db".to_string()),
                Some("owner-z".to_string()),
                None,
            )
        );
    }

    #[test]
    fn hides_only_invoke_boards_when_owner_board_verification_is_stale() {
        let conn = source_schema();
        conn.execute_batch(
            r#"
            INSERT INTO collections (id, source, invoke_source_id, invoke_owner_id) VALUES
                ('invoke-board', 'invoke', 'C:/Invoke%Root/invoke.db', 'owner-a'),
                ('ambit-owner', 'ambit', 'C:/Invoke%Root/invoke.db', 'owner-a'),
                ('ambit-global', 'ambit', NULL, NULL),
                ('other-owner', 'invoke', 'C:/Invoke%Root/invoke.db', 'owner-b');
            "#,
        )
        .expect("seed");

        conn.execute_batch(migration75().sql).expect("migration 75");
        conn.execute(
            "UPDATE invoke_owner_scope_state SET boards_verified = 0 WHERE state_key = 'current'",
            [],
        )
        .expect("mark boards stale");

        let visible = |id: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM scoped_collections WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .expect("visible collection count")
        };
        assert_eq!(visible("invoke-board"), 0);
        assert_eq!(visible("ambit-owner"), 1);
        assert_eq!(visible("ambit-global"), 1);
        assert_eq!(visible("other-owner"), 0);

        conn.execute_batch(
            "UPDATE invoke_owner_scope_state SET boards_verified = 1 WHERE state_key = 'current';
             UPDATE collections SET invoke_board_verified = 0 WHERE id = 'invoke-board';",
        )
        .expect("verify catalog but revoke stale board");
        assert_eq!(visible("invoke-board"), 0);
        assert_eq!(visible("ambit-owner"), 1);

        conn.execute(
            "UPDATE invoke_owner_scope_state SET scope_mode = 'all' WHERE state_key = 'current'",
            [],
        )
        .expect("select all users");
        assert_eq!(visible("invoke-board"), 1);
        assert_eq!(visible("other-owner"), 1);
    }

    #[test]
    fn ignores_malformed_removed_image_memberships_without_aborting_upgrade() {
        let conn = source_schema();
        conn.execute_batch(
            r#"
            INSERT INTO removed_images (
                id, path, invoke_image_name, invoke_source_id, invoke_owner_id, collection_ids_json
            ) VALUES (
                'malformed-memberships',
                'C:/Invoke%Root/outputs/images/malformed.png',
                'malformed.png',
                'C:/Invoke%Root/invoke.db',
                'owner-a',
                '["global-collection"'
            );
            INSERT INTO collections (id, source, invoke_source_id, invoke_owner_id)
            VALUES
                ('global-collection', 'ambit', NULL, NULL),
                (
                    'repair-candidate', 'ambit',
                    'C:/Invoke%Root/invoke.db', 'owner-a'
                );
            INSERT INTO images (id, path)
            VALUES ('local-image', 'C:/local-image.png');
            INSERT INTO collection_images (collection_id, image_id)
            VALUES ('repair-candidate', 'local-image');
            "#,
        )
        .expect("seed malformed removed-image memberships");

        conn.execute_batch(migration75().sql).expect("migration 75");

        let collection_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id
                 FROM collections WHERE id = 'global-collection'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("global collection");
        assert_eq!(collection_scope, (None, None));

        let repaired_candidate_scope: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT invoke_source_id, invoke_owner_id
                 FROM collections WHERE id = 'repair-candidate'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("repair candidate");
        assert_eq!(repaired_candidate_scope, (None, None));

        let membership_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM collection_images", [], |row| {
                row.get(0)
            })
            .expect("membership count");
        assert_eq!(membership_count, 1);

        let malformed_json: String = conn
            .query_row(
                "SELECT collection_ids_json FROM removed_images
                 WHERE id = 'malformed-memberships'",
                [],
                |row| row.get(0),
            )
            .expect("malformed membership payload");
        assert_eq!(malformed_json, "[\"global-collection\"");
    }
}
