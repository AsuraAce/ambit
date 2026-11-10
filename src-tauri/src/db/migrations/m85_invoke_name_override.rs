use tauri_plugin_sql::{Migration, MigrationKind};

/// Persist rename intent independently of future source-name convergence.
pub fn migration85() -> Migration {
    Migration {
        version: 85,
        description: "add_invoke_collection_name_override",
        sql: r#"
            ALTER TABLE collections
                ADD COLUMN invoke_name_overridden INTEGER NOT NULL DEFAULT 0
                CHECK (invoke_name_overridden IN (0, 1));
            UPDATE collections SET invoke_name_overridden = 1
            WHERE source = 'invoke'
              AND (invoke_source_name IS NULL OR name IS NOT invoke_source_name);

            DROP VIEW IF EXISTS scoped_collections;
            CREATE VIEW scoped_collections AS
            SELECT c.rowid AS rowid, c.*
            FROM collections c
            LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
            WHERE c.invoke_suppressed = 0
              AND (
                   (
                        c.invoke_source_id IS NULL
                        AND (
                            COALESCE(c.source, 'ambit') != 'invoke'
                            OR COALESCE(s.scope_mode, 'legacy') IN ('legacy', 'all')
                        )
                   )
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

            -- A cached owner projection may have admitted unbound Invoke boards.
            -- Retire both ready snapshots and in-flight builds before restoration.
            UPDATE invoke_scope_cache_state
            SET status = 'dirty', generation = generation + 1,
                built_generation = NULL, build_session_id = NULL,
                updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
            WHERE scope_mode IN ('owner', 'unselected');
            INSERT INTO invoke_scope_cache_dirty_items (
                scope_key, domain, facet_type, resource_name
            )
            SELECT scope_key, 'full', '', '' FROM invoke_scope_cache_state
            WHERE scope_mode IN ('owner', 'unselected')
            ON CONFLICT(scope_key, domain, facet_type, resource_name) DO NOTHING;

            DELETE FROM invoke_scope_collection_cache
            WHERE scope_key IN (
                SELECT scope_key FROM invoke_scope_cache_state
                WHERE scope_mode IN ('owner', 'unselected')
            );
            DELETE FROM invoke_scope_facet_cache
            WHERE scope_key IN (
                SELECT scope_key FROM invoke_scope_cache_state
                WHERE scope_mode IN ('owner', 'unselected')
            );
            -- The shared materialized projection also needs to stop claiming old
            -- summaries when the active view is affected. Presentation stays local.
            DELETE FROM facet_cache
            WHERE EXISTS (
                SELECT 1 FROM invoke_owner_scope_state
                WHERE state_key = 'current' AND scope_mode IN ('owner', 'unselected')
            );
            UPDATE collections
            SET dynamic_count = NULL,
                dynamic_thumbnail_path = NULL,
                dynamic_safe_thumbnail_path = NULL,
                dynamic_thumbnail_is_sensitive = NULL,
                dynamic_thumbnail_cached_at = NULL
            WHERE EXISTS (
                SELECT 1 FROM invoke_owner_scope_state
                WHERE state_key = 'current' AND scope_mode IN ('owner', 'unselected')
            );
        "#,
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration85;
    use rusqlite::Connection;

    #[test]
    fn migration_preserves_legacy_ambiguity_and_local_names_after_reopen() {
        let path = std::env::temp_dir().join(format!(
            "ambit-name-override-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            for migration in super::super::get_migrations()
                .into_iter()
                .filter(|m| m.version < 85)
            {
                conn.execute_batch(migration.sql).unwrap();
            }
            conn.execute_batch(
                "INSERT INTO collections (id,name,created_at,source,invoke_source_name) VALUES
                ('following','A',1,'invoke','A'),
                ('renamed','B',1,'invoke','A'),
                ('ambiguous','A',1,'invoke',NULL),
                ('local','Local',1,NULL,NULL);",
            )
            .unwrap();
            conn.execute_batch(migration85().sql).unwrap();
            assert!(conn
                .execute("UPDATE collections SET invoke_name_overridden = 2", [])
                .is_err());
        }
        {
            let conn = Connection::open(&path).unwrap();
            let rows: Vec<(String, String, i64)> = conn
                .prepare("SELECT id,name,invoke_name_overridden FROM collections ORDER BY id")
                .unwrap()
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(
                rows,
                vec![
                    ("ambiguous".into(), "A".into(), 1),
                    ("following".into(), "A".into(), 0),
                    ("local".into(), "Local".into(), 0),
                    ("renamed".into(), "B".into(), 1),
                ]
            );
            conn.execute("INSERT INTO collections (id,name,created_at,source,invoke_source_name) VALUES ('new','C',1,'invoke','C')", []).unwrap();
            let flag: i64 = conn
                .query_row(
                    "SELECT invoke_name_overridden FROM collections WHERE id='new'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                flag, 0,
                "new source collections follow their source by default"
            );
        }
        std::fs::remove_file(path).unwrap();
    }
    fn schema_before_upgrade() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        for migration in super::super::get_migrations()
            .into_iter()
            .filter(|m| m.version < 85)
        {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn
    }

    #[test]
    fn upgrade_guards_unknown_invoke_ownership_without_hiding_local_legacy_collections() {
        let conn = schema_before_upgrade();
        conn.execute_batch("INSERT INTO collections (id,name,created_at,source,invoke_source_id,invoke_owner_id,invoke_board_verified,invoke_source_present,invoke_suppressed) VALUES
            ('local','Local',1,NULL,NULL,NULL,1,1,0),
            ('ambit','Ambit',1,'ambit',NULL,NULL,1,1,0),
            ('unknown','Unknown',1,'invoke',NULL,NULL,1,1,0),
            ('misleading','Unknown source',1,'invoke',NULL,'a',1,1,0),
            ('mine','Unavailable source',1,'invoke','invoke.db','a',1,0,0),
            ('other','Other owner',1,'invoke','invoke.db','b',1,1,0),
            ('unverified','Unverified',1,'invoke','invoke.db','a',0,1,0),
            ('foreign','Foreign source',1,'invoke','other.db','a',1,1,0),
            ('suppressed','Suppressed',1,'invoke',NULL,'a',1,1,1),
            ('local-owned','Owned Ambit',1,'ambit','invoke.db','a',0,1,0);
            INSERT INTO invoke_owner_scope_state (state_key,db_path,images_root,scope_mode,owner_id,boards_verified,updated_at)
                VALUES ('current','invoke.db','C:/Invoke','owner','a',1,1);").unwrap();
        let visible = || -> Vec<String> {
            conn.prepare("SELECT id FROM scoped_collections ORDER BY id")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert!(
            visible().contains(&"unknown".into()),
            "the upgrade fixture reproduces the unsafe old view"
        );
        conn.execute_batch(migration85().sql).unwrap();
        assert_eq!(visible(), vec!["ambit", "local", "local-owned", "mine"]);
        conn.execute("UPDATE invoke_owner_scope_state SET boards_verified=0", [])
            .unwrap();
        assert_eq!(visible(), vec!["ambit", "local", "local-owned"]);
        conn.execute(
            "UPDATE invoke_owner_scope_state SET owner_id='b',boards_verified=1",
            [],
        )
        .unwrap();
        assert_eq!(visible(), vec!["ambit", "local", "other"]);
        conn.execute(
            "UPDATE invoke_owner_scope_state SET scope_mode='unselected'",
            [],
        )
        .unwrap();
        assert_eq!(visible(), vec!["ambit", "local"]);
        for mode in ["all", "legacy"] {
            conn.execute("UPDATE invoke_owner_scope_state SET scope_mode=?1", [mode])
                .unwrap();
            assert_eq!(
                visible(),
                vec![
                    "ambit",
                    "local",
                    "local-owned",
                    "mine",
                    "misleading",
                    "other",
                    "unknown",
                    "unverified"
                ],
                "aggregate recovery retains unbound boards without assigning provenance"
            );
        }
        conn.execute("DELETE FROM invoke_owner_scope_state", [])
            .unwrap();
        assert_eq!(visible(), vec!["ambit", "local", "misleading", "unknown"]);
    }

    #[test]
    fn upgrade_retires_owner_cache_snapshots_builds_and_active_summaries() {
        for active_mode in ["owner", "all"] {
            let conn = schema_before_upgrade();
            conn.execute_batch("INSERT INTO collections (id,name,created_at,custom_thumbnail,dynamic_count,dynamic_thumbnail_path)
                VALUES ('local','Local',1,'keep.png',5,'old.png');
                INSERT INTO invoke_scope_cache_state (scope_key,db_path,images_root,scope_mode,owner_id,status,generation,built_generation,build_session_id,updated_at) VALUES
                ('owner-ready','invoke.db','C:/Invoke','owner','a','ready',7,7,NULL,1),
                ('owner-building','invoke.db','C:/Invoke','owner','b','building',8,7,'old-build',1),
                ('unselected','invoke.db','C:/Invoke','unselected',NULL,'ready',9,9,NULL,1),
                ('all','invoke.db','C:/Invoke','all',NULL,'ready',10,10,NULL,1),
                ('legacy','invoke.db','C:/Invoke','legacy',NULL,'ready',11,11,NULL,1);
                INSERT INTO invoke_scope_collection_cache (scope_key,collection_id,dynamic_count,dynamic_thumbnail_path)
                    SELECT scope_key,'local',5,'old.png' FROM invoke_scope_cache_state;
                INSERT INTO invoke_scope_facet_cache (scope_key,facet_type,resource_name,count)
                    SELECT scope_key,'tools','Tool',5 FROM invoke_scope_cache_state;
                INSERT INTO facet_cache (facet_type,resource_name,count) VALUES ('tools','Tool',5);
                INSERT INTO invoke_scope_cache_dirty_items VALUES ('owner-ready','full','','');").unwrap();
            conn.execute("INSERT INTO invoke_owner_scope_state (state_key,db_path,images_root,scope_mode,owner_id,boards_verified,updated_at)
                VALUES ('current','invoke.db','C:/Invoke',?1,'a',1,1)", [active_mode]).unwrap();
            conn.execute("UPDATE invoke_scope_cache_control SET active_scope_key=?1 WHERE state_key='current'", [if active_mode=="owner" {"owner-ready"} else {"all"}]).unwrap();
            conn.execute_batch(migration85().sql).unwrap();
            for (key, generation) in [
                ("owner-ready", 8),
                ("owner-building", 9),
                ("unselected", 10),
            ] {
                let state: (String,i64,Option<i64>,Option<String>)=conn.query_row("SELECT status,generation,built_generation,build_session_id FROM invoke_scope_cache_state WHERE scope_key=?1", [key],
                    |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).unwrap();
                assert_eq!(state, ("dirty".into(), generation, None, None));
                assert_eq!(conn.query_row("SELECT COUNT(*) FROM invoke_scope_cache_dirty_items WHERE scope_key=?1 AND domain='full'", [key], |row| row.get::<_,i64>(0)).unwrap(),1);
                for table in ["invoke_scope_collection_cache", "invoke_scope_facet_cache"] {
                    assert_eq!(
                        conn.query_row(
                            &format!("SELECT COUNT(*) FROM {table} WHERE scope_key=?1"),
                            [key],
                            |row| row.get::<_, i64>(0)
                        )
                        .unwrap(),
                        0
                    );
                }
            }
            for (key, generation) in [("all", 10), ("legacy", 11)] {
                let state: (String,i64,Option<i64>)=conn.query_row("SELECT status,generation,built_generation FROM invoke_scope_cache_state WHERE scope_key=?1", [key],
                    |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
                assert_eq!(
                    state,
                    ("ready".into(), generation, Some(generation)),
                    "aggregate visibility was not changed"
                );
                assert_eq!(
                    conn.query_row(
                        "SELECT COUNT(*) FROM invoke_scope_collection_cache WHERE scope_key=?1",
                        [key],
                        |row| row.get::<_, i64>(0)
                    )
                    .unwrap(),
                    1
                );
            }
            let active: (Option<i64>,Option<String>,String)=conn.query_row("SELECT dynamic_count,dynamic_thumbnail_path,custom_thumbnail FROM collections WHERE id='local'", [],
                |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
            assert_eq!(
                active,
                if active_mode == "owner" {
                    (None, None, "keep.png".into())
                } else {
                    (Some(5), Some("old.png".into()), "keep.png".into())
                }
            );
            assert_eq!(
                conn.query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row
                    .get::<_, i64>(0))
                    .unwrap(),
                if active_mode == "owner" { 0 } else { 1 }
            );
        }
    }
}
