use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 76: Separate InvokeAI's authoritative board facts from Ambit's
/// local presentation, visibility, and effective membership overrides.
pub fn migration76() -> Migration {
    Migration {
        version: 76,
        description: "add_invoke_collection_ownership",
        sql: r#"
            ALTER TABLE collections ADD COLUMN invoke_source_name TEXT;
            ALTER TABLE collections
                ADD COLUMN invoke_source_present INTEGER NOT NULL DEFAULT 1
                CHECK (invoke_source_present IN (0, 1));
            ALTER TABLE collections
                ADD COLUMN invoke_suppressed INTEGER NOT NULL DEFAULT 0
                CHECK (invoke_suppressed IN (0, 1));

            CREATE TABLE invoke_board_membership_snapshot (
                collection_id TEXT NOT NULL,
                invoke_image_name TEXT NOT NULL,
                PRIMARY KEY (collection_id, invoke_image_name),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
            ) STRICT, WITHOUT ROWID;

            CREATE TABLE invoke_board_membership_exclusions (
                collection_id TEXT NOT NULL,
                invoke_image_name TEXT NOT NULL,
                PRIMARY KEY (collection_id, invoke_image_name),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
            ) STRICT, WITHOUT ROWID;

            CREATE TABLE invoke_board_membership_additions (
                collection_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                PRIMARY KEY (collection_id, image_id),
                FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
            ) STRICT, WITHOUT ROWID;

            CREATE INDEX idx_collections_invoke_recovery
                ON collections(source, invoke_source_id, invoke_owner_id, invoke_suppressed);
            CREATE INDEX idx_invoke_board_snapshot_image
                ON invoke_board_membership_snapshot(invoke_image_name, collection_id);
            CREATE INDEX idx_invoke_board_exclusions_image
                ON invoke_board_membership_exclusions(invoke_image_name, collection_id);
            CREATE INDEX idx_invoke_board_additions_image
                ON invoke_board_membership_additions(image_id, collection_id);

            INSERT OR IGNORE INTO invoke_board_membership_snapshot (
                collection_id, invoke_image_name
            )
            SELECT collections.id, images.invoke_image_name
            FROM collections
            JOIN images ON images.board_id = collections.id
            WHERE COALESCE(collections.source, 'ambit') = 'invoke'
              AND images.invoke_image_name IS NOT NULL;

            INSERT OR IGNORE INTO invoke_board_membership_snapshot (
                collection_id, invoke_image_name
            )
            SELECT collections.id, removed_images.invoke_image_name
            FROM collections
            JOIN removed_images ON removed_images.board_id = collections.id
            WHERE COALESCE(collections.source, 'ambit') = 'invoke'
              AND removed_images.invoke_image_name IS NOT NULL;

            INSERT OR IGNORE INTO invoke_board_membership_exclusions (
                collection_id, invoke_image_name
            )
            SELECT snapshot.collection_id, snapshot.invoke_image_name
            FROM invoke_board_membership_snapshot snapshot
            WHERE NOT EXISTS (
                SELECT 1
                FROM collection_images
                JOIN images ON images.id = collection_images.image_id
                WHERE collection_images.collection_id = snapshot.collection_id
                  AND images.invoke_image_name = snapshot.invoke_image_name
            )
              AND NOT EXISTS (
                SELECT 1
                FROM removed_images
                JOIN json_each(CASE
                    WHEN json_valid(removed_images.collection_ids_json)
                     AND json_type(removed_images.collection_ids_json) = 'array'
                    THEN removed_images.collection_ids_json
                    ELSE '[]'
                END) membership
                  ON CAST(membership.value AS TEXT) = snapshot.collection_id
                 AND membership.type = 'text'
                WHERE removed_images.invoke_image_name = snapshot.invoke_image_name
            );

            INSERT OR IGNORE INTO invoke_board_membership_additions (
                collection_id, image_id
            )
            SELECT collection_images.collection_id, collection_images.image_id
            FROM collection_images
            JOIN collections ON collections.id = collection_images.collection_id
            LEFT JOIN images ON images.id = collection_images.image_id
            WHERE COALESCE(collections.source, 'ambit') = 'invoke'
              AND NOT EXISTS (
                  SELECT 1
                  FROM invoke_board_membership_snapshot snapshot
                  WHERE snapshot.collection_id = collection_images.collection_id
                    AND snapshot.invoke_image_name = images.invoke_image_name
              );

            INSERT OR IGNORE INTO invoke_board_membership_additions (
                collection_id, image_id
            )
            SELECT collections.id, removed_images.id
            FROM collections
            JOIN removed_images
            JOIN json_each(CASE
                WHEN json_valid(removed_images.collection_ids_json)
                 AND json_type(removed_images.collection_ids_json) = 'array'
                THEN removed_images.collection_ids_json
                ELSE '[]'
            END) membership
              ON CAST(membership.value AS TEXT) = collections.id
             AND membership.type = 'text'
            WHERE COALESCE(collections.source, 'ambit') = 'invoke'
              AND NOT EXISTS (
                  SELECT 1
                  FROM invoke_board_membership_snapshot snapshot
                  WHERE snapshot.collection_id = collections.id
                    AND snapshot.invoke_image_name = removed_images.invoke_image_name
              );

            DROP VIEW IF EXISTS scoped_collections;
            CREATE VIEW scoped_collections AS
            SELECT c.rowid AS rowid, c.*
            FROM collections c
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE c.invoke_suppressed = 0
              AND (
                   c.invoke_source_id IS NULL
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
                   )
              );
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration76;
    use rusqlite::Connection;

    fn source_schema() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                board_id TEXT,
                invoke_image_name TEXT
            );
            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                board_id TEXT,
                invoke_image_name TEXT,
                collection_ids_json TEXT
            );
            CREATE TABLE collections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'ambit',
                invoke_source_id TEXT,
                invoke_owner_id TEXT,
                invoke_board_verified INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE collection_images (
                collection_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                PRIMARY KEY (collection_id, image_id)
            );
            CREATE TABLE invoke_owner_scope_state (
                state_key TEXT PRIMARY KEY,
                db_path TEXT NOT NULL,
                scope_mode TEXT NOT NULL,
                owner_id TEXT,
                boards_verified INTEGER NOT NULL DEFAULT 1
            );
            INSERT INTO invoke_owner_scope_state (
                state_key, db_path, scope_mode, owner_id, boards_verified
            ) VALUES ('current', 'invoke.db', 'owner', 'owner-a', 1);
            CREATE VIEW scoped_collections AS SELECT rowid, * FROM collections;
            "#,
        )
        .expect("source schema");
        conn
    }

    #[test]
    fn preserves_effective_membership_while_backfilling_source_facts_and_local_overrides() {
        let conn = source_schema();
        conn.execute_batch(
            r#"
            INSERT INTO collections (
                id, name, source, invoke_source_id, invoke_owner_id
            ) VALUES
                ('board-a', 'My Local Name', 'invoke', 'invoke.db', 'owner-a'),
                ('ambit-a', 'Ambit', 'ambit', NULL, NULL);

            INSERT INTO images (id, board_id, invoke_image_name) VALUES
                ('source-kept', 'board-a', 'kept.png'),
                ('source-excluded', 'board-a', 'excluded.png'),
                ('local-added', NULL, NULL);
            INSERT INTO collection_images (collection_id, image_id) VALUES
                ('board-a', 'source-kept'),
                ('board-a', 'local-added');

            INSERT INTO removed_images (
                id, board_id, invoke_image_name, collection_ids_json
            ) VALUES
                ('removed-source', 'board-a', 'removed-source.png', '["board-a"]'),
                ('removed-local', NULL, NULL, '["board-a"]'),
                ('malformed', 'board-a', 'malformed.png', '["board-a"');
            "#,
        )
        .expect("seed pre-ownership state");

        let effective_before: Vec<(String, String)> = conn
            .prepare(
                "SELECT collection_id, image_id
                 FROM collection_images
                 ORDER BY collection_id, image_id",
            )
            .expect("prepare memberships")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query memberships")
            .collect::<Result<_, _>>()
            .expect("collect memberships");

        conn.execute_batch(migration76().sql).expect("migration 76");

        let collection_state: (String, Option<String>, i64, i64) = conn
            .query_row(
                "SELECT name, invoke_source_name, invoke_source_present, invoke_suppressed
                 FROM collections WHERE id = 'board-a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("upgraded collection");
        assert_eq!(
            collection_state,
            ("My Local Name".to_string(), None, 1, 0),
            "the first authoritative sync, not the migration, decides whether the legacy name is local"
        );

        let source_names: Vec<String> = conn
            .prepare(
                "SELECT invoke_image_name FROM invoke_board_membership_snapshot
                 WHERE collection_id = 'board-a' ORDER BY invoke_image_name",
            )
            .expect("prepare source facts")
            .query_map([], |row| row.get(0))
            .expect("query source facts")
            .collect::<Result<_, _>>()
            .expect("collect source facts");
        assert_eq!(
            source_names,
            vec![
                "excluded.png".to_string(),
                "kept.png".to_string(),
                "malformed.png".to_string(),
                "removed-source.png".to_string(),
            ]
        );

        let exclusions: Vec<String> = conn
            .prepare(
                "SELECT invoke_image_name FROM invoke_board_membership_exclusions
                 WHERE collection_id = 'board-a' ORDER BY invoke_image_name",
            )
            .expect("prepare exclusions")
            .query_map([], |row| row.get(0))
            .expect("query exclusions")
            .collect::<Result<_, _>>()
            .expect("collect exclusions");
        assert_eq!(
            exclusions,
            vec!["excluded.png".to_string(), "malformed.png".to_string()]
        );

        let additions: Vec<String> = conn
            .prepare(
                "SELECT image_id FROM invoke_board_membership_additions
                 WHERE collection_id = 'board-a' ORDER BY image_id",
            )
            .expect("prepare additions")
            .query_map([], |row| row.get(0))
            .expect("query additions")
            .collect::<Result<_, _>>()
            .expect("collect additions");
        assert_eq!(
            additions,
            vec!["local-added".to_string(), "removed-local".to_string()]
        );

        let effective_after: Vec<(String, String)> = conn
            .prepare(
                "SELECT collection_id, image_id
                 FROM collection_images
                 ORDER BY collection_id, image_id",
            )
            .expect("prepare memberships after")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query memberships after")
            .collect::<Result<_, _>>()
            .expect("collect memberships after");
        assert_eq!(effective_after, effective_before);
    }

    #[test]
    fn suppressed_invoke_collections_are_recoverable_but_hidden_from_normal_scope() {
        let conn = source_schema();
        conn.execute_batch(
            r#"
            INSERT INTO collections (
                id, name, source, invoke_source_id, invoke_owner_id
            ) VALUES
                ('board-a', 'Board A', 'invoke', 'invoke.db', 'owner-a'),
                ('ambit-a', 'Ambit', 'ambit', NULL, NULL);
            "#,
        )
        .expect("seed collections");

        conn.execute_batch(migration76().sql).expect("migration 76");
        conn.execute(
            "UPDATE collections SET invoke_suppressed = 1 WHERE id = 'board-a'",
            [],
        )
        .expect("suppress board");

        let visible: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scoped_collections WHERE id = 'board-a'",
                [],
                |row| row.get(0),
            )
            .expect("normal visibility");
        let recoverable: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM collections
                 WHERE id = 'board-a' AND invoke_suppressed = 1",
                [],
                |row| row.get(0),
            )
            .expect("recovery visibility");
        assert_eq!(visible, 0);
        assert_eq!(recoverable, 1);
    }
}
