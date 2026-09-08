use super::image_scope_sql::image_scope_view_sql;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Keep exact maintenance counts on compact index records instead of metadata-heavy rows.
pub fn migration80() -> Migration {
    Migration {
        version: 80,
        description: "add_maintenance_count_indexes",
        sql: concat!(
            r#"
            CREATE INDEX idx_images_maintenance_counts_v1
                ON images(
                    invoke_scope_hidden, is_deleted, invoke_source_id, invoke_owner_id,
                    media_type, is_missing, IFNULL(is_intermediate_gen, 0),
                    IFNULL(is_invoke_asset_gen, 0), (positive_prompt IS NULL OR positive_prompt = '')
                );
            CREATE INDEX idx_removed_images_maintenance_counts_v1
                ON removed_images(invoke_scope_hidden, invoke_source_id, invoke_owner_id);
            DROP VIEW scoped_images;
            DROP VIEW scoped_removed_images;
        "#,
            image_scope_view_sql!("scoped_images", r#"i.rowid AS rowid, i.*"#, "images i"),
            image_scope_view_sql!(
                "scoped_removed_images",
                r#"i.rowid AS rowid, i.*"#,
                "removed_images i"
            ),
            image_scope_view_sql!(
                "scoped_maintenance_images",
                r#"i.invoke_scope_hidden, i.is_deleted, i.media_type, i.is_missing,
                IFNULL(i.is_intermediate_gen, 0) AS is_intermediate,
                IFNULL(i.is_invoke_asset_gen, 0) AS is_invoke_asset,
                (i.positive_prompt IS NULL OR i.positive_prompt = '') AS positive_prompt_empty"#,
                "images i INDEXED BY idx_images_maintenance_counts_v1"
            ),
            image_scope_view_sql!(
                "scoped_maintenance_removed_images",
                r#"i.invoke_scope_hidden"#,
                "removed_images i INDEXED BY idx_removed_images_maintenance_counts_v1"
            )
        ),
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration80;
    use crate::db::migrations::get_migrations;
    use rusqlite::Connection;

    // Exercise the actual frontend statement with the bundled desktop SQLite engine.
    fn count_sql() -> &'static str {
        include_str!("../../../../src/services/db/maintenanceRepo.ts")
            .split("db.select<MaintenanceCountRow[]>(`")
            .nth(1)
            .expect("maintenance query")
            .split("`);")
            .next()
            .expect("end of maintenance query")
    }

    fn schema(conn: &Connection, through: i64) {
        for migration in get_migrations()
            .into_iter()
            .filter(|m| m.version <= through)
        {
            conn.execute_batch(&migration.sql)
                .unwrap_or_else(|e| panic!("migration {}: {e}", migration.version));
        }
    }

    fn old_count_sql() -> &'static str {
        include_str!("../../../../src/services/db/__tests__/maintenanceCounts.integration.test.ts")
            .split("const oldQuery = `")
            .nth(1)
            .unwrap()
            .split('`')
            .next()
            .unwrap()
    }

    fn counts_with(conn: &Connection, sql: &str) -> (i64, i64, i64, i64) {
        conn.query_row(sql, [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .expect("maintenance counts")
    }

    fn counts(conn: &Connection) -> (i64, i64, i64, i64) {
        counts_with(conn, count_sql())
    }

    fn assert_index_reads(conn: &Connection) {
        let plan: Vec<String> = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {}", count_sql()))
            .unwrap()
            .query_map([], |r| r.get(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(
            plan.iter()
                .any(|p| p.contains("idx_images_maintenance_counts_v1")),
            "{plan:?}"
        );
        assert!(
            plan.iter()
                .any(|p| p.contains("idx_removed_images_maintenance_counts_v1")),
            "{plan:?}"
        );
        let roots: Vec<i64> = conn
            .prepare(
                "SELECT rootpage FROM sqlite_schema WHERE name IN ('images', 'removed_images')",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let ops: Vec<(String, i64, i64)> = conn
            .prepare(&format!("EXPLAIN {}", count_sql()))
            .unwrap()
            .query_map([], |r| Ok((r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let cursors: Vec<i64> = ops
            .iter()
            .filter(|(op, _, root)| op == "OpenRead" && roots.contains(root))
            .map(|(_, cursor, _)| *cursor)
            .collect();
        assert!(
            !ops.iter()
                .any(|(op, cursor, _)| op == "Column" && cursors.contains(cursor)),
            "counts must not read metadata-heavy table records: {ops:?}"
        );
    }

    #[test]
    fn fresh_schema_counts_use_indexes_on_bundled_sqlite() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 80);
        assert_eq!(counts(&conn), (0, 0, 0, 0));
        assert_index_reads(&conn);
    }

    #[test]
    fn populated_upgrade_preserves_metadata_and_tracks_generated_classification() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 79);
        conn.execute_batch(r#"
            INSERT INTO images(id, path, positive_prompt, metadata_json)
                VALUES ('active', 'active.png', '', '{"isIntermediate":false,"workflow":"keep"}');
            INSERT INTO removed_images(id, path, timestamp, removed_at, metadata_json, original_metadata_json)
                VALUES ('removed', 'removed.png', 1, 2, '{"workflow":"keep"}', '{"original":"keep"}');
        "#).unwrap();
        let before = counts_with(&conn, old_count_sql());
        conn.execute_batch(&migration80().sql).unwrap();
        assert_eq!(before, (1, 0, 0, 1));
        assert_eq!(counts(&conn), before);
        assert_index_reads(&conn);
        conn.execute_batch(
            r#"UPDATE images SET metadata_json = '{"isIntermediate":true,"workflow":"keep"}'"#,
        )
        .unwrap();
        assert_eq!(counts(&conn), (0, 0, 1, 1));
        conn.execute_batch(r#"UPDATE images SET metadata_json = '{"isIntermediate":false}', invoke_image_category = 'control'"#).unwrap();
        assert_eq!(counts(&conn), (0, 0, 0, 1));
        conn.execute_batch("UPDATE images SET invoke_image_category = 'general', is_missing = 1")
            .unwrap();
        assert_eq!(counts(&conn), (1, 1, 0, 1));
        let original: String = conn
            .query_row(
                "SELECT original_metadata_json FROM removed_images",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(original, r#"{"original":"keep"}"#);
        let integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
    }
    #[test]
    fn count_indexes_remain_usable_after_statistics_refresh() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 80);
        conn.execute_batch(r#"
            WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 2000)
            INSERT INTO images(id, path, positive_prompt, metadata_json)
                SELECT CAST(value AS TEXT), CAST(value AS TEXT), '', '{}' FROM n;
            INSERT INTO removed_images(id, path, timestamp, removed_at)
                SELECT id, path, 1, 1 FROM images;
            ANALYZE;
        "#).unwrap();
        assert_eq!(counts(&conn), (2000, 0, 0, 2000));
        assert_index_reads(&conn);
    }

    fn view_definitions(conn: &Connection) -> Vec<(String, String)> {
        conn.prepare("SELECT name, sql FROM sqlite_schema WHERE name IN ('scoped_images', 'scoped_removed_images') ORDER BY name")
            .unwrap().query_map([], |r| {
                let sql: String = r.get(1)?;
                Ok((r.get(0)?, sql.split_whitespace().collect::<Vec<_>>().join(" ")))
            }).unwrap().collect::<Result<_, _>>().unwrap()
    }

    fn columns(conn: &Connection, view: &str) -> Vec<(String, String)> {
        conn.prepare(&format!("PRAGMA table_info({view})"))
            .unwrap()
            .query_map([], |r| Ok((r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn visible_ids(conn: &Connection, view: &str) -> Vec<(i64, String)> {
        conn.prepare(&format!("SELECT rowid, id FROM {view} ORDER BY id"))
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn set_scope(conn: &Connection, mode: &str, owner: &str) {
        conn.execute("DELETE FROM invoke_owner_scope_state", [])
            .unwrap();
        if mode != "absent" {
            conn.execute("INSERT INTO invoke_owner_scope_state(state_key,db_path,images_root,scope_mode,owner_id,updated_at) VALUES ('current','source','C:/invoke',?1,?2,1)",
                [mode, owner]).unwrap();
        }
    }

    #[test]
    fn scope_views_and_counts_survive_upgrade_and_statistics_in_every_mode() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 79);
        // Mixed eligibility and owner distributions, including imported and unbound local rows.
        conn.execute_batch(r#"
            WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v+1 FROM n WHERE v<2000)
            INSERT INTO images(id,path,positive_prompt,metadata_json,media_type,is_missing,is_deleted,
                invoke_scope_hidden,invoke_source_id,invoke_owner_id,invoke_image_category)
            SELECT CAST(v AS TEXT), CAST(v AS TEXT), CASE v%3 WHEN 0 THEN NULL WHEN 1 THEN '' ELSE 'prompt' END,
                CASE WHEN v%7=0 THEN '{"isIntermediate":true}' ELSE '{}' END,
                CASE WHEN v%11=0 THEN 'video' ELSE 'image' END, v%2, v%5=0, v%13=0,
                CASE v%4 WHEN 0 THEN NULL WHEN 1 THEN 'other' ELSE 'source' END,
                CASE v%3 WHEN 0 THEN NULL WHEN 1 THEN 'a' ELSE 'b' END,
                CASE WHEN v%17=0 THEN 'control' ELSE 'general' END FROM n;
            INSERT INTO removed_images(id,path,timestamp,removed_at,invoke_scope_hidden,invoke_source_id,invoke_owner_id)
                SELECT id,path,1,1,invoke_scope_hidden,invoke_source_id,invoke_owner_id FROM images;
        "#).unwrap();
        let definitions = view_definitions(&conn);
        let image_columns = columns(&conn, "scoped_images");
        let removed_columns = columns(&conn, "scoped_removed_images");
        let modes = [
            ("absent", ""),
            ("unselected", ""),
            ("legacy", ""),
            ("all", ""),
            ("owner", "a"),
            ("owner", "b"),
        ];
        let snapshots: Vec<_> = modes
            .iter()
            .map(|(mode, owner)| {
                set_scope(&conn, mode, owner);
                (
                    counts_with(&conn, old_count_sql()),
                    visible_ids(&conn, "scoped_images"),
                    visible_ids(&conn, "scoped_removed_images"),
                )
            })
            .collect();
        conn.execute_batch("SAVEPOINT migration_check").unwrap();
        conn.execute_batch(migration80().sql).unwrap();
        assert_eq!(view_definitions(&conn), definitions);
        assert_eq!(columns(&conn, "scoped_images"), image_columns);
        assert_eq!(columns(&conn, "scoped_removed_images"), removed_columns);
        for statistics in ["SELECT 1", "ANALYZE", "PRAGMA optimize(0x10002)"] {
            conn.execute_batch(statistics).unwrap();
            for ((mode, owner), expected) in modes.iter().zip(&snapshots) {
                set_scope(&conn, mode, owner);
                assert_eq!(counts(&conn), expected.0);
                assert_eq!(visible_ids(&conn, "scoped_images"), expected.1);
                assert_eq!(visible_ids(&conn, "scoped_removed_images"), expected.2);
                assert_index_reads(&conn);
            }
        }
        conn.execute_batch("ROLLBACK TO migration_check; RELEASE migration_check")
            .unwrap();
        assert_eq!(view_definitions(&conn), definitions);
        assert!(conn.prepare(count_sql()).is_err());
        conn.execute_batch(migration80().sql).unwrap();
        assert_index_reads(&conn);
    }

    #[test]
    fn regular_gallery_keeps_its_sort_index_after_upgrade() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 79);
        let query = "EXPLAIN QUERY PLAN SELECT id, path FROM scoped_images
            WHERE invoke_scope_hidden = 0 AND is_deleted = 0
              AND IFNULL(is_intermediate_gen, 0) = 0 AND IFNULL(is_grid_gen, 0) = 0
              AND IFNULL(is_invoke_asset_gen, 0) = 0
            ORDER BY timestamp DESC, id DESC LIMIT 100";
        let plan = |conn: &Connection| -> Vec<String> {
            conn.prepare(query)
                .unwrap()
                .query_map([], |r| r.get(3))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        let before = plan(&conn);
        conn.execute_batch(migration80().sql).unwrap();
        let after = plan(&conn);
        assert_eq!(after, before);
        assert!(
            after
                .iter()
                .any(|p| p.contains("idx_images_invoke_scope_fast_sort_v1")),
            "{after:?}"
        );
    }

    #[test]
    fn missing_required_index_fails_instead_of_fetching_heavy_rows() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 80);
        conn.execute_batch("DROP INDEX idx_images_maintenance_counts_v1")
            .unwrap();
        assert!(conn
            .prepare(count_sql())
            .unwrap_err()
            .to_string()
            .contains("idx_images_maintenance_counts_v1"));
    }

    #[test]
    #[ignore = "disposable on-disk performance benchmark; run explicitly with --ignored --nocapture"]
    fn benchmark_metadata_heavy_counts() {
        use std::time::{Instant, SystemTime, UNIX_EPOCH};
        fn time_query(conn: &Connection, sql: &str) -> u128 {
            let mut samples = Vec::new();
            for _ in 0..7 {
                let start = Instant::now();
                conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
                samples.push(start.elapsed().as_micros());
            }
            samples.sort_unstable();
            samples[3]
        }
        fn time_writes(conn: &Connection, metadata: &str) -> u128 {
            let start = Instant::now();
            conn.execute_batch("SAVEPOINT benchmark_writes").unwrap();
            for n in 0..200 {
                let id = format!("write-{n}");
                conn.execute("INSERT INTO images(id,path,positive_prompt,metadata_json) VALUES (?1,?1,'',?2)",
                    rusqlite::params![id, metadata]).unwrap();
            }
            conn.execute_batch("ROLLBACK TO benchmark_writes; RELEASE benchmark_writes")
                .unwrap();
            start.elapsed().as_micros()
        }
        let old = old_count_sql();
        let trash = "SELECT COUNT(*) FROM scoped_removed_images WHERE invoke_scope_hidden = 0";
        let old_active = old.replace(&format!("({trash}) AS trash"), "0 AS trash");
        let new_trash_sql =
            "SELECT COUNT(*) FROM scoped_maintenance_removed_images WHERE invoke_scope_hidden = 0";
        let new_active = count_sql().replace(&format!("({new_trash_sql}) as trash"), "0 as trash");
        for bytes in [1024, 24 * 1024] {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("ambit-count-{stamp}.sqlite"));
            let conn = Connection::open(&path).unwrap();
            schema(&conn, 79);
            conn.execute_batch("PRAGMA journal_mode = MEMORY; PRAGMA cache_size = -8192; BEGIN")
                .unwrap();
            let metadata =
                serde_json::json!({"workflow": "x".repeat(bytes), "isIntermediate": false})
                    .to_string();
            for n in 0..20000 {
                let id = format!("active-{n}");
                conn.execute("INSERT INTO images(id,path,positive_prompt,metadata_json) VALUES (?1,?1,?2,?3)",
                    rusqlite::params![id, if n % 2 == 0 { "" } else { "tagged" }, metadata]).unwrap();
            }
            for n in 0..10571 {
                let id = format!("removed-{n}");
                conn.execute("INSERT INTO removed_images(id,path,timestamp,removed_at,metadata_json,original_metadata_json,original_parsed_json) VALUES (?1,?1,1,1,?2,?2,?2)",
                    rusqlite::params![id, metadata]).unwrap();
            }
            conn.execute_batch("COMMIT; ANALYZE").unwrap();
            let expected = counts_with(&conn, old_count_sql());
            assert_eq!(expected, (10000, 0, 0, 10571));
            let old_total = time_query(&conn, old);
            let old_active_us = time_query(&conn, &old_active);
            let old_trash = time_query(&conn, trash);
            let mut writes_before: Vec<_> = (0..7).map(|_| time_writes(&conn, &metadata)).collect();
            writes_before.sort_unstable();
            let write_before = writes_before[3];
            let pages_before: i64 = conn
                .query_row("PRAGMA page_count", [], |r| r.get(0))
                .unwrap();
            let free_before: i64 = conn
                .query_row("PRAGMA freelist_count", [], |r| r.get(0))
                .unwrap();
            let build = Instant::now();
            conn.execute_batch(&migration80().sql).unwrap();
            let build_ms = build.elapsed().as_millis();
            let pages_after: i64 = conn
                .query_row("PRAGMA page_count", [], |r| r.get(0))
                .unwrap();
            let free_after: i64 = conn
                .query_row("PRAGMA freelist_count", [], |r| r.get(0))
                .unwrap();
            let page_size: i64 = conn
                .query_row("PRAGMA page_size", [], |r| r.get(0))
                .unwrap();
            assert_eq!(counts(&conn), expected);
            assert_index_reads(&conn);
            conn.execute_batch("ANALYZE; PRAGMA optimize(0x10002)")
                .unwrap();
            assert_index_reads(&conn);
            let new_total = time_query(&conn, count_sql());
            let new_active_us = time_query(&conn, &new_active);
            let new_trash = time_query(&conn, new_trash_sql);
            let mut writes_after: Vec<_> = (0..7).map(|_| time_writes(&conn, &metadata)).collect();
            writes_after.sort_unstable();
            let write_after = writes_after[3];
            println!(
                "BENCHMARK {}",
                serde_json::json!({"metadata_bytes":bytes,"active_rows":20000,"removed_rows":10571,
                "old_total_us":old_total,"new_total_us":new_total,"old_active_us":old_active_us,"new_active_us":new_active_us,
                "old_removed_us":old_trash,"new_removed_us":new_trash,"index_build_ms":build_ms,
                "file_growth_bytes":(pages_after-pages_before)*page_size,
                "index_bytes":(pages_after-free_after-pages_before+free_before)*page_size,"write_200_before_us":write_before,"write_200_after_us":write_after})
            );
            drop(conn);
            std::fs::remove_file(path).unwrap();
        }
    }
}
