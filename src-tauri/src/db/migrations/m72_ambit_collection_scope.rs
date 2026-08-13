use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 72: Give Ambit collections the same owner-aware projection model
/// as InvokeAI boards while preserving unscoped legacy collections.
pub fn migration72() -> Migration {
    Migration {
        version: 72,
        description: "scope_ambit_collections_by_invoke_owner",
        sql: r#"
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_update_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_membership_insert_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_membership_delete_dirty;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_insert_detail;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_update_detail;
            DROP TRIGGER IF EXISTS invoke_scope_cache_collections_delete_detail;
            DROP TRIGGER IF EXISTS invoke_scope_cache_membership_insert_detail;
            DROP TRIGGER IF EXISTS invoke_scope_cache_membership_delete_detail;

            -- Infer only unambiguous existing Ambit collection scopes. Generic-only
            -- and multi-database collections remain shared legacy collections.
            WITH inferred AS (
                SELECT c.id,
                       COUNT(DISTINCT i.invoke_source_id) AS source_count,
                       MIN(i.invoke_source_id) AS source_id,
                       COUNT(DISTINCT CASE WHEN i.invoke_source_id IS NOT NULL THEN i.invoke_owner_id END) AS owner_count,
                       MIN(CASE WHEN i.invoke_source_id IS NOT NULL THEN i.invoke_owner_id END) AS owner_id,
                       MAX(CASE WHEN i.invoke_source_id IS NOT NULL AND i.invoke_owner_id IS NULL THEN 1 ELSE 0 END) AS has_unassigned
                FROM collections c
                LEFT JOIN collection_images ci ON ci.collection_id = c.id
                LEFT JOIN images i ON i.id = ci.image_id
                WHERE COALESCE(c.source, 'ambit') != 'invoke'
                  AND c.invoke_source_id IS NULL
                  AND c.invoke_owner_id IS NULL
                GROUP BY c.id
            )
            UPDATE collections
            SET invoke_source_id = (SELECT source_id FROM inferred WHERE inferred.id = collections.id),
                invoke_owner_id = CASE
                    WHEN (SELECT owner_count FROM inferred WHERE inferred.id = collections.id) = 1
                     AND (SELECT has_unassigned FROM inferred WHERE inferred.id = collections.id) = 0
                    THEN (SELECT owner_id FROM inferred WHERE inferred.id = collections.id)
                    ELSE NULL
                END,
                dynamic_count = NULL,
                dynamic_thumbnail_path = NULL,
                dynamic_safe_thumbnail_path = NULL,
                dynamic_thumbnail_is_sensitive = NULL,
                dynamic_thumbnail_cached_at = NULL
            WHERE id IN (SELECT id FROM inferred WHERE source_count = 1);

            DROP VIEW IF EXISTS scoped_collections;
            DROP VIEW IF EXISTS invoke_scope_cache_visible_collection_scopes;

            CREATE VIEW invoke_scope_cache_visible_collection_scopes AS
            SELECT c.id AS collection_id, cache.scope_key
            FROM collections c
            CROSS JOIN invoke_scope_cache_state cache
            WHERE c.invoke_source_id IS NULL
               OR (
                    cache.db_path = c.invoke_source_id
                    AND (
                        cache.scope_mode IN ('legacy', 'all')
                        OR (cache.scope_mode = 'owner' AND c.invoke_owner_id IS NOT NULL
                            AND cache.owner_id = c.invoke_owner_id)
                    )
               );

            CREATE VIEW scoped_collections AS
            SELECT c.rowid AS rowid, c.*
            FROM collections c
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE c.invoke_source_id IS NULL
               OR (
                    c.invoke_source_id = s.db_path
                    AND (
                        s.scope_mode IN ('legacy', 'all')
                        OR (s.scope_mode = 'owner' AND c.invoke_owner_id IS NOT NULL
                            AND c.invoke_owner_id = s.owner_id)
                    )
               );

            CREATE TRIGGER invoke_scope_cache_collections_insert_dirty
            AFTER INSERT ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND scope_key IN (
                      SELECT scope_key FROM invoke_scope_cache_visible_collection_scopes
                      WHERE collection_id = NEW.id
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_update_dirty
            AFTER UPDATE OF filter_state, manual_exclusions, source, invoke_owner_id, invoke_source_id
            ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (
                      scope_key IN (
                          SELECT scope_key FROM invoke_scope_cache_visible_collection_scopes
                          WHERE collection_id = NEW.id
                      )
                      OR OLD.invoke_source_id IS NULL
                      OR (db_path = OLD.invoke_source_id AND (
                          scope_mode IN ('legacy', 'all')
                          OR (scope_mode = 'owner' AND OLD.invoke_owner_id IS NOT NULL
                              AND owner_id = OLD.invoke_owner_id)
                      ))
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_delete_dirty
            AFTER DELETE ON collections
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND (
                      OLD.invoke_source_id IS NULL
                      OR (db_path = OLD.invoke_source_id AND (
                          scope_mode IN ('legacy', 'all')
                          OR (scope_mode = 'owner' AND OLD.invoke_owner_id IS NOT NULL
                              AND owner_id = OLD.invoke_owner_id)
                      ))
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_membership_insert_dirty
            AFTER INSERT ON collection_images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND scope_key IN (
                      SELECT image_scopes.scope_key
                      FROM invoke_scope_cache_visible_image_scopes image_scopes
                      INNER JOIN invoke_scope_cache_visible_collection_scopes collection_scopes
                         ON collection_scopes.scope_key = image_scopes.scope_key
                      WHERE image_scopes.image_id = NEW.image_id
                        AND collection_scopes.collection_id = NEW.collection_id
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_membership_delete_dirty
            AFTER DELETE ON collection_images
            WHEN (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
            BEGIN
                UPDATE invoke_scope_cache_state
                SET status = 'dirty', generation = generation + 1,
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                WHERE status != 'dirty'
                  AND scope_key IN (
                      SELECT image_scopes.scope_key
                      FROM invoke_scope_cache_visible_image_scopes image_scopes
                      INNER JOIN invoke_scope_cache_visible_collection_scopes collection_scopes
                         ON collection_scopes.scope_key = image_scopes.scope_key
                      WHERE image_scopes.image_id = OLD.image_id
                        AND collection_scopes.collection_id = OLD.collection_id
                  );
            END;

            CREATE TRIGGER invoke_scope_cache_collections_insert_detail AFTER INSERT ON collections BEGIN
                INSERT INTO invoke_scope_cache_dirty_items (scope_key, domain, facet_type, resource_name)
                SELECT scope_key, 'collections', '', ''
                FROM invoke_scope_cache_visible_collection_scopes
                WHERE collection_id = NEW.id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            CREATE TRIGGER invoke_scope_cache_collections_update_detail
            AFTER UPDATE OF filter_state, manual_exclusions, source, invoke_owner_id, invoke_source_id
            ON collections BEGIN
                INSERT INTO invoke_scope_cache_dirty_items (scope_key, domain, facet_type, resource_name)
                SELECT cache.scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state cache
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND (
                      cache.scope_key IN (
                          SELECT scope_key FROM invoke_scope_cache_visible_collection_scopes
                          WHERE collection_id = NEW.id
                      )
                      OR OLD.invoke_source_id IS NULL
                      OR (cache.db_path = OLD.invoke_source_id AND (
                          cache.scope_mode IN ('legacy', 'all')
                          OR (cache.scope_mode = 'owner' AND OLD.invoke_owner_id IS NOT NULL
                              AND cache.owner_id = OLD.invoke_owner_id)
                      ))
                  )
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            CREATE TRIGGER invoke_scope_cache_collections_delete_detail AFTER DELETE ON collections BEGIN
                INSERT INTO invoke_scope_cache_dirty_items (scope_key, domain, facet_type, resource_name)
                SELECT cache.scope_key, 'collections', '', ''
                FROM invoke_scope_cache_state cache
                WHERE (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                  AND (
                      OLD.invoke_source_id IS NULL
                      OR (cache.db_path = OLD.invoke_source_id AND (
                          cache.scope_mode IN ('legacy', 'all')
                          OR (cache.scope_mode = 'owner' AND OLD.invoke_owner_id IS NOT NULL
                              AND cache.owner_id = OLD.invoke_owner_id)
                      ))
                  )
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            CREATE TRIGGER invoke_scope_cache_membership_insert_detail AFTER INSERT ON collection_images BEGIN
                INSERT INTO invoke_scope_cache_dirty_items (scope_key, domain, facet_type, resource_name)
                SELECT image_scopes.scope_key, 'collections', '', ''
                FROM invoke_scope_cache_visible_image_scopes image_scopes
                INNER JOIN invoke_scope_cache_visible_collection_scopes collection_scopes
                   ON collection_scopes.scope_key = image_scopes.scope_key
                WHERE image_scopes.image_id = NEW.image_id
                  AND collection_scopes.collection_id = NEW.collection_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            CREATE TRIGGER invoke_scope_cache_membership_delete_detail AFTER DELETE ON collection_images BEGIN
                INSERT INTO invoke_scope_cache_dirty_items (scope_key, domain, facet_type, resource_name)
                SELECT image_scopes.scope_key, 'collections', '', ''
                FROM invoke_scope_cache_visible_image_scopes image_scopes
                INNER JOIN invoke_scope_cache_visible_collection_scopes collection_scopes
                   ON collection_scopes.scope_key = image_scopes.scope_key
                WHERE image_scopes.image_id = OLD.image_id
                  AND collection_scopes.collection_id = OLD.collection_id
                  AND (SELECT suppress_invalidation FROM invoke_scope_cache_control WHERE state_key = 'current') = 0
                ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;
            END;

            INSERT INTO invoke_scope_cache_dirty_items (scope_key, domain, facet_type, resource_name)
            SELECT scope_key, 'collections', '', '' FROM invoke_scope_cache_state
            WHERE 1 = 1
            ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

            UPDATE invoke_scope_cache_state
            SET status = 'dirty', generation = generation + 1,
                updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
            WHERE status != 'dirty';
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration72;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                invoke_source_id TEXT,
                invoke_owner_id TEXT,
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE collections (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL DEFAULT 'ambit',
                filter_state TEXT,
                manual_exclusions TEXT,
                custom_thumbnail TEXT,
                invoke_source_id TEXT,
                invoke_owner_id TEXT,
                dynamic_count INTEGER,
                dynamic_thumbnail_path TEXT,
                dynamic_safe_thumbnail_path TEXT,
                dynamic_thumbnail_is_sensitive INTEGER,
                dynamic_thumbnail_cached_at INTEGER
            );
            CREATE TABLE collection_images (
                collection_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                PRIMARY KEY (collection_id, image_id)
            );
            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY,
                db_path TEXT,
                scope_mode TEXT,
                owner_id TEXT
            );
            CREATE TABLE invoke_scope_cache_state (
                scope_key TEXT PRIMARY KEY,
                db_path TEXT NOT NULL,
                scope_mode TEXT NOT NULL,
                owner_id TEXT,
                status TEXT NOT NULL DEFAULT 'ready',
                generation INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE invoke_scope_cache_control (
                state_key TEXT PRIMARY KEY,
                suppress_invalidation INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE invoke_scope_cache_dirty_items (
                scope_key TEXT NOT NULL,
                domain TEXT NOT NULL,
                facet_type TEXT NOT NULL DEFAULT '',
                resource_name TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (scope_key, domain, facet_type, resource_name)
            );
            INSERT INTO invoke_scope_cache_control VALUES ('current', 0);
            INSERT INTO invoke_owner_scope_state VALUES ('current', 'invoke.db', 'owner', 'owner-a');
            INSERT INTO invoke_scope_cache_state (scope_key, db_path, scope_mode, owner_id) VALUES
                ('all', 'invoke.db', 'all', NULL),
                ('owner-a', 'invoke.db', 'owner', 'owner-a'),
                ('owner-b', 'invoke.db', 'owner', 'owner-b');
            CREATE VIEW invoke_scope_cache_visible_image_scopes AS
            SELECT i.id AS image_id, cache.scope_key
            FROM images i CROSS JOIN invoke_scope_cache_state cache
            WHERE i.invoke_source_id IS NULL
               OR (cache.db_path = i.invoke_source_id AND (
                    cache.scope_mode IN ('legacy', 'all')
                    OR (cache.scope_mode = 'owner' AND cache.owner_id = i.invoke_owner_id)
               ));
            CREATE VIEW invoke_scope_cache_visible_collection_scopes AS
            SELECT c.id AS collection_id, cache.scope_key
            FROM collections c CROSS JOIN invoke_scope_cache_state cache;
            CREATE VIEW scoped_collections AS SELECT rowid, * FROM collections;

            INSERT INTO images VALUES
                ('a1', 'invoke.db', 'owner-a', 0),
                ('a2', 'invoke.db', 'owner-a', 0),
                ('b1', 'invoke.db', 'owner-b', 0),
                ('generic', NULL, NULL, 0);
            INSERT INTO collections (id, source) VALUES
                ('single-a', 'ambit'),
                ('mixed', 'ambit'),
                ('empty', 'ambit'),
                ('invoke-a', 'invoke');
            UPDATE collections SET invoke_source_id = 'invoke.db', invoke_owner_id = 'owner-a'
            WHERE id = 'invoke-a';
            INSERT INTO collection_images VALUES
                ('single-a', 'a1'),
                ('single-a', 'a2'),
                ('mixed', 'a1'),
                ('mixed', 'b1');
            "#,
        )
        .expect("base schema");
        conn
    }

    fn collection_scope(conn: &Connection, id: &str) -> (Option<String>, Option<String>) {
        conn.query_row(
            "SELECT invoke_source_id, invoke_owner_id FROM collections WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("collection scope")
    }

    #[test]
    fn infers_existing_ambit_collection_scopes_and_projects_them_by_owner() {
        let conn = setup();
        conn.execute_batch(migration72().sql).expect("migration 72");

        assert_eq!(
            collection_scope(&conn, "single-a"),
            (Some("invoke.db".into()), Some("owner-a".into()))
        );
        assert_eq!(
            collection_scope(&conn, "mixed"),
            (Some("invoke.db".into()), None)
        );
        assert_eq!(collection_scope(&conn, "empty"), (None, None));
        assert_eq!(
            collection_scope(&conn, "invoke-a"),
            (Some("invoke.db".into()), Some("owner-a".into()))
        );

        let owner_ids = conn
            .prepare("SELECT id FROM scoped_collections ORDER BY id")
            .expect("owner query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("owner rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("owner ids");
        assert_eq!(owner_ids, vec!["empty", "invoke-a", "single-a"]);

        conn.execute(
            "UPDATE invoke_owner_scope_state SET scope_mode = 'all', owner_id = NULL",
            [],
        )
        .expect("activate all users");
        let all_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM scoped_collections", [], |row| {
                row.get(0)
            })
            .expect("all count");
        assert_eq!(all_count, 4);
    }

    #[test]
    fn migration_and_collection_triggers_record_only_idempotent_collection_repairs() {
        let conn = setup();
        conn.execute_batch(migration72().sql).expect("migration 72");

        conn.execute(
            "UPDATE collections SET filter_state = '{}' WHERE id = 'single-a'",
            [],
        )
        .expect("first update");
        conn.execute(
            "UPDATE collections SET filter_state = '{\"x\":1}' WHERE id = 'single-a'",
            [],
        )
        .expect("repeated update");

        let non_collection_rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE domain != 'collections'",
                [],
                |row| row.get(0),
            )
            .expect("dirty domain count");
        assert_eq!(non_collection_rows, 0);
    }
}
