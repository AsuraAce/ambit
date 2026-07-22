use tauri_plugin_sql::{Migration, MigrationKind};

/// Migration 64: Persist InvokeAI image-to-image provenance independently of
/// editable generation metadata.
pub fn migration64() -> Migration {
    Migration {
        version: 64,
        description: "add_invoke_image_references",
        sql: r#"
            CREATE TABLE invoke_image_references (
                source_image_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN (
                    'init_image',
                    'controlnet_image',
                    'controlnet_processed_image',
                    'ip_adapter_image',
                    't2i_adapter_image',
                    't2i_adapter_processed_image'
                )),
                target_invoke_image_name TEXT NOT NULL
                    CHECK (length(trim(target_invoke_image_name)) > 0),
                target_image_id TEXT,
                PRIMARY KEY (source_image_id, role, target_invoke_image_name)
            ) STRICT;

            CREATE INDEX idx_invoke_image_references_target_name
                ON invoke_image_references(target_invoke_image_name);
            CREATE INDEX idx_invoke_image_references_target_image
                ON invoke_image_references(target_image_id, source_image_id)
                WHERE target_image_id IS NOT NULL;
            CREATE INDEX idx_images_invoke_image_name
                ON images(invoke_image_name)
                WHERE invoke_image_name IS NOT NULL;

            CREATE TRIGGER trg_invoke_image_references_image_insert
            AFTER INSERT ON images
            WHEN NEW.invoke_image_name IS NOT NULL
            BEGIN
                UPDATE invoke_image_references
                SET target_image_id = (
                    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) ELSE NULL END
                    FROM images
                    WHERE invoke_image_name = NEW.invoke_image_name
                )
                WHERE target_invoke_image_name = NEW.invoke_image_name;
            END;

            CREATE TRIGGER trg_invoke_image_references_image_name_update
            AFTER UPDATE OF invoke_image_name ON images
            WHEN OLD.invoke_image_name IS NOT NEW.invoke_image_name
            BEGIN
                UPDATE invoke_image_references
                SET target_image_id = (
                    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) ELSE NULL END
                    FROM images
                    WHERE invoke_image_name = OLD.invoke_image_name
                )
                WHERE OLD.invoke_image_name IS NOT NULL
                  AND target_invoke_image_name = OLD.invoke_image_name;

                UPDATE invoke_image_references
                SET target_image_id = (
                    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) ELSE NULL END
                    FROM images
                    WHERE invoke_image_name = NEW.invoke_image_name
                )
                WHERE NEW.invoke_image_name IS NOT NULL
                  AND target_invoke_image_name = NEW.invoke_image_name;
            END;

            CREATE TRIGGER trg_invoke_image_references_image_id_update
            AFTER UPDATE OF id ON images
            WHEN OLD.id IS NOT NEW.id
            BEGIN
                UPDATE invoke_image_references
                SET source_image_id = NEW.id
                WHERE source_image_id = OLD.id;

                UPDATE invoke_image_references
                SET target_image_id = NEW.id
                WHERE target_image_id = OLD.id;
            END;

            CREATE TRIGGER trg_invoke_image_references_image_delete
            AFTER DELETE ON images
            BEGIN
                UPDATE invoke_image_references
                SET target_image_id = (
                    SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) ELSE NULL END
                    FROM images
                    WHERE invoke_image_name = OLD.invoke_image_name
                )
                WHERE OLD.invoke_image_name IS NOT NULL
                  AND target_invoke_image_name = OLD.invoke_image_name;

                DELETE FROM invoke_image_references
                WHERE source_image_id = OLD.id
                  AND NOT EXISTS (
                      SELECT 1 FROM removed_images WHERE id = OLD.id
                  );
            END;

            CREATE TRIGGER trg_invoke_image_references_removed_id_update
            AFTER UPDATE OF id ON removed_images
            WHEN OLD.id IS NOT NEW.id
            BEGIN
                UPDATE invoke_image_references
                SET source_image_id = NEW.id
                WHERE source_image_id = OLD.id;
            END;

            CREATE TRIGGER trg_invoke_image_references_removed_delete
            AFTER DELETE ON removed_images
            WHEN NOT EXISTS (SELECT 1 FROM images WHERE id = OLD.id)
            BEGIN
                DELETE FROM invoke_image_references
                WHERE source_image_id = OLD.id;
            END;
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration64;
    use rusqlite::{params, Connection};

    fn source_schema() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "
            CREATE TABLE images (
                id TEXT PRIMARY KEY,
                invoke_image_name TEXT,
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
            ) STRICT;

            CREATE TABLE removed_images (
                id TEXT PRIMARY KEY,
                invoke_image_name TEXT,
                invoke_scope_hidden INTEGER NOT NULL DEFAULT 0
            ) STRICT;
            ",
        )
        .expect("source schema");
        conn.execute_batch(migration64().sql)
            .expect("apply migration");
        conn
    }

    fn query_plan_details(conn: &Connection, sql: &str) -> Vec<String> {
        conn.prepare(sql)
            .expect("prepare query plan")
            .query_map([], |row| row.get::<_, String>(3))
            .expect("read query plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect query plan")
    }

    #[test]
    fn stores_only_supported_exact_role_name_pairs() {
        let conn = source_schema();
        conn.execute(
            "INSERT INTO invoke_image_references (
                source_image_id, role, target_invoke_image_name
             ) VALUES ('source', 'init_image', 'Target.PNG')",
            [],
        )
        .expect("insert supported reference");

        let duplicate = conn.execute(
            "INSERT INTO invoke_image_references (
                source_image_id, role, target_invoke_image_name
             ) VALUES ('source', 'init_image', 'Target.PNG')",
            [],
        );
        assert!(duplicate.is_err());

        let unsupported = conn.execute(
            "INSERT INTO invoke_image_references (
                source_image_id, role, target_invoke_image_name
             ) VALUES ('source', 'custom_image', 'Target.PNG')",
            [],
        );
        assert!(unsupported.is_err());
    }

    #[test]
    fn resolves_only_one_exact_active_name_and_retries_later() {
        let conn = source_schema();
        conn.execute(
            "INSERT INTO images (id, invoke_image_name) VALUES ('source', 'source.png')",
            [],
        )
        .expect("insert source");
        conn.execute(
            "INSERT INTO invoke_image_references (
                source_image_id, role, target_invoke_image_name
             ) VALUES ('source', 'controlnet_image', 'Target.PNG')",
            [],
        )
        .expect("insert unresolved reference");

        conn.execute(
            "INSERT INTO images (id, invoke_image_name) VALUES ('wrong-case', 'target.png')",
            [],
        )
        .expect("insert differently cased target");
        let unresolved: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("unresolved target");
        assert_eq!(unresolved, None);

        conn.execute(
            "INSERT INTO images (id, invoke_image_name) VALUES ('target-a', 'Target.PNG')",
            [],
        )
        .expect("insert unique target");
        let resolved: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("resolved target");
        assert_eq!(resolved.as_deref(), Some("target-a"));

        conn.execute(
            "INSERT INTO images (id, invoke_image_name) VALUES ('target-b', 'Target.PNG')",
            [],
        )
        .expect("insert ambiguous target");
        let ambiguous: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("ambiguous target");
        assert_eq!(ambiguous, None);

        conn.execute("DELETE FROM images WHERE id = 'target-b'", [])
            .expect("remove duplicate");
        let resolved_again: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("resolved target after duplicate removal");
        assert_eq!(resolved_again.as_deref(), Some("target-a"));
    }

    #[test]
    fn preserves_removed_sources_unresolves_removed_targets_and_repairs_ids() {
        let conn = source_schema();
        conn.execute_batch(
            "
            INSERT INTO images (id, invoke_image_name) VALUES
                ('source', 'source.png'),
                ('target', 'target.png');
            INSERT INTO invoke_image_references (
                source_image_id, role, target_invoke_image_name, target_image_id
            ) VALUES ('source', 'init_image', 'target.png', 'target');
            ",
        )
        .expect("seed reference graph");

        conn.execute(
            "INSERT INTO removed_images (id, invoke_image_name)
             VALUES ('source', 'source.png')",
            [],
        )
        .expect("create source tombstone");
        conn.execute("DELETE FROM images WHERE id = 'source'", [])
            .expect("remove source");
        let preserved: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoke_image_references", [], |row| {
                row.get(0)
            })
            .expect("preserved outgoing reference");
        assert_eq!(preserved, 1);

        conn.execute("DELETE FROM images WHERE id = 'target'", [])
            .expect("remove target");
        let unresolved: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("unresolved removed target");
        assert_eq!(unresolved, None);

        conn.execute(
            "INSERT INTO images (id, invoke_image_name) VALUES ('target', 'target.png')",
            [],
        )
        .expect("restore target");
        conn.execute(
            "UPDATE images SET id = 'target-moved' WHERE id = 'target'",
            [],
        )
        .expect("repair target identity");
        let repaired_target: Option<String> = conn
            .query_row(
                "SELECT target_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("repaired target identity");
        assert_eq!(repaired_target.as_deref(), Some("target-moved"));

        conn.execute(
            "INSERT INTO images (id, invoke_image_name) VALUES ('source', 'source.png')",
            [],
        )
        .expect("restore source");
        conn.execute("DELETE FROM removed_images WHERE id = 'source'", [])
            .expect("remove restored tombstone");
        conn.execute(
            "UPDATE images SET id = 'source-moved' WHERE id = 'source'",
            [],
        )
        .expect("repair source identity");
        let repaired_source: String = conn
            .query_row(
                "SELECT source_image_id FROM invoke_image_references",
                [],
                |row| row.get(0),
            )
            .expect("repaired source identity");
        assert_eq!(repaired_source, "source-moved");

        conn.execute("DELETE FROM images WHERE id = 'source-moved'", [])
            .expect("permanently delete source");
        let deleted: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoke_image_references", [], |row| {
                row.get(0)
            })
            .expect("deleted outgoing reference");
        assert_eq!(deleted, 0);

        conn.execute(
            "INSERT INTO removed_images (id, invoke_image_name)
             VALUES ('removed-only', 'removed-only.png')",
            [],
        )
        .expect("insert removed source");
        conn.execute(
            "INSERT INTO invoke_image_references (
                source_image_id, role, target_invoke_image_name
             ) VALUES (?1, 'ip_adapter_image', 'missing.png')",
            params!["removed-only"],
        )
        .expect("insert removed outgoing reference");
        conn.execute("DELETE FROM removed_images WHERE id = 'removed-only'", [])
            .expect("permanently delete removed source");
        let removed_deleted: i64 = conn
            .query_row("SELECT COUNT(*) FROM invoke_image_references", [], |row| {
                row.get(0)
            })
            .expect("deleted removed outgoing reference");
        assert_eq!(removed_deleted, 0);
    }

    #[test]
    fn reference_graph_queries_use_directional_indexes() {
        let conn = source_schema();
        conn.execute_batch(
            "
            INSERT INTO images (id, invoke_image_name) VALUES
                ('source', 'source.png'),
                ('target', 'target.png');
            INSERT INTO invoke_image_references (
                source_image_id, role, target_invoke_image_name, target_image_id
            ) VALUES ('source', 'init_image', 'target.png', 'target');
            ",
        )
        .expect("seed reference graph");

        let forward = query_plan_details(
            &conn,
            "EXPLAIN QUERY PLAN
             SELECT r.role, r.target_invoke_image_name, target.id
             FROM invoke_image_references r
             INNER JOIN images visible_source
                ON visible_source.id = r.source_image_id
               AND visible_source.invoke_scope_hidden = 0
             LEFT JOIN images target
                ON target.id = r.target_image_id
               AND target.invoke_scope_hidden = 0
             WHERE r.source_image_id = 'source'",
        );
        assert!(
            forward
                .iter()
                .any(|detail| detail.contains("sqlite_autoindex_invoke_image_references_1")),
            "forward reference lookup should use the primary-key prefix: {forward:?}"
        );

        let backlinks = query_plan_details(
            &conn,
            "EXPLAIN QUERY PLAN
             SELECT r.role, r.source_image_id,
                    COALESCE(active_source.invoke_image_name, removed_source.invoke_image_name)
             FROM invoke_image_references r
             INNER JOIN images visible_target
                ON visible_target.id = r.target_image_id
               AND visible_target.invoke_scope_hidden = 0
             LEFT JOIN images active_source
                ON active_source.id = r.source_image_id
               AND active_source.invoke_scope_hidden = 0
             LEFT JOIN removed_images removed_source
                ON removed_source.id = r.source_image_id
               AND removed_source.invoke_scope_hidden = 0
             WHERE r.target_image_id = 'target'
               AND (active_source.id IS NOT NULL OR removed_source.id IS NOT NULL)",
        );
        assert!(
            backlinks
                .iter()
                .any(|detail| detail.contains("idx_invoke_image_references_target_image")),
            "backlink lookup should use the target-image index: {backlinks:?}"
        );
    }
}
