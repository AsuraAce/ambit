use super::image_scope_sql::image_scope_view_sql;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Keep gallery, scope and filter-statistics counts on compact index records.
///
/// An `images` row carries large metadata text before every column these counts
/// filter or group by, so each counted row walked its overflow pages: minutes on
/// a library of several gigabytes. The index holds the visible-row terms the
/// query builders write, the scope view's columns and the grouped columns.
///
/// As in m80, the counts read it through a view that names the index. With the
/// library's statistics SQLite otherwise ties this index with the gallery sort
/// index and picks the sort index for the scope counts, which reads every row.
/// `searchRepo.ts` uses the view only when every WHERE term is one the index
/// holds, so filtered counts keep their own plans.
pub fn migration86() -> Migration {
    Migration {
        version: 86,
        description: "add_scope_count_indexes",
        sql: concat!(
            r#"
            CREATE INDEX idx_images_scope_counts_v1
                ON images(
                    invoke_scope_hidden, is_deleted, IFNULL(is_intermediate_gen, 0),
                    IFNULL(is_grid_gen, 0), IFNULL(is_invoke_asset_gen, 0), privacy_hidden,
                    invoke_source_id, invoke_owner_id, source_kind, media_type,
                    resolved_model_name, model_name, tool
                );
        "#,
            image_scope_view_sql!(
                "scoped_count_images",
                r#"i.rowid AS rowid, i.id, i.invoke_scope_hidden, i.is_deleted,
                i.is_intermediate_gen, i.is_grid_gen, i.is_invoke_asset_gen, i.privacy_hidden,
                i.source_kind, i.media_type, i.resolved_model_name, i.model_name, i.tool"#,
                "images i INDEXED BY idx_images_scope_counts_v1"
            )
        ),
        kind: MigrationKind::Up,
    }
}

#[cfg(test)]
mod tests {
    use super::migration86;
    use crate::db::migrations::get_migrations;
    use rusqlite::Connection;

    const INDEX: &str = "idx_images_scope_counts_v1";
    const VIEW: &str = "scoped_count_images";
    const SEARCH_REPO: &str = include_str!("../../../../src/services/db/searchRepo.ts");
    const SQL_HELPERS: &str = include_str!("../../../../src/utils/sqlHelpers.ts");

    fn schema(conn: &Connection, through: i64) {
        for migration in get_migrations()
            .into_iter()
            .filter(|m| m.version <= through)
        {
            conn.execute_batch(migration.sql)
                .unwrap_or_else(|e| panic!("migration {}: {e}", migration.version));
        }
    }

    /// The WHERE terms searchRepo.ts sends to the count view.
    fn count_index_terms() -> Vec<String> {
        SEARCH_REPO
            .split("const COUNT_INDEX_TERMS = new Set([")
            .nth(1)
            .and_then(|rest| rest.split("]);").next())
            .expect("COUNT_INDEX_TERMS in searchRepo.ts")
            .split('\'')
            .skip(1)
            .step_by(2)
            .map(str::to_string)
            .collect()
    }

    /// The visible-row WHERE clause searchRepo.ts uses when no filter is set.
    fn base_visible_where() -> String {
        SEARCH_REPO
            .split("const BASE_VISIBLE_WHERE =")
            .nth(1)
            .and_then(|rest| rest.split('\'').nth(1))
            .expect("BASE_VISIBLE_WHERE in searchRepo.ts")
            .to_string()
    }

    /// The WHERE shapes the gallery and filter counts send for the unfiltered
    /// library (with and without the asset rule and privacy hiding), then with
    /// the media and kind scopes. Only the first four bind no parameters.
    fn where_shapes() -> Vec<String> {
        let base = base_visible_where();
        let asset = format!("{base} AND IFNULL(is_invoke_asset_gen, 0) = 0");
        vec![
            base.clone(),
            asset.clone(),
            format!("{base} AND privacy_hidden = 0"),
            format!("{asset} AND privacy_hidden = 0"),
            format!("{asset} AND (media_type = ? OR media_type IS NULL) AND source_kind = ?"),
            format!("{base} AND media_type = ? AND privacy_hidden = 0"),
        ]
    }

    /// The count statements as searchRepo.ts builds them on `source`.
    fn count_queries(source: &str, finalwhere: &str) -> Vec<String> {
        let facet_cte = format!(
            "WITH filtered_images AS (SELECT images.id AS id, images.resolved_model_name AS resolved_model_name, images.model_name AS model_name, images.tool AS tool FROM {source} AS images {finalwhere})"
        );
        vec![
            format!("SELECT count(*) as count FROM {source} AS images {finalwhere}"),
            format!("SELECT images.source_kind, images.media_type, count(*) as count FROM {source} AS images {finalwhere} GROUP BY images.source_kind, images.media_type"),
            format!("{facet_cte} SELECT COALESCE(resolved_model_name, model_name, 'Unknown') AS name, count(*) AS count FROM filtered_images GROUP BY name"),
            format!("{facet_cte} SELECT COALESCE(tool, 'Unknown') AS name, count(*) AS count FROM filtered_images GROUP BY name"),
        ]
    }

    /// Rows of an EXPLAIN listing. The statement's parameters stay unbound,
    /// which EXPLAIN allows.
    fn explain<T>(
        conn: &Connection,
        sql: &str,
        read: impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> Vec<T> {
        let mut statement = conn.prepare(sql).unwrap();
        let mut rows = statement.raw_query();
        let mut out = Vec::new();
        while let Some(row) = rows.next().unwrap() {
            out.push(read(row).unwrap());
        }
        out
    }

    /// The query uses the count index and never reads a column from the
    /// metadata-heavy `images` record.
    fn assert_index_only(conn: &Connection, sql: &str) {
        let plan: Vec<String> = explain(conn, &format!("EXPLAIN QUERY PLAN {sql}"), |r| r.get(3));
        assert!(
            plan.iter().any(|p| p.contains(INDEX)),
            "{sql}\nmust use {INDEX}: {plan:?}"
        );
        let images_root: i64 = conn
            .query_row(
                "SELECT rootpage FROM sqlite_schema WHERE name = 'images'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let ops: Vec<(String, i64, i64)> = explain(conn, &format!("EXPLAIN {sql}"), |r| {
            Ok((r.get(1)?, r.get(2)?, r.get(3)?))
        });
        let table_cursors: Vec<i64> = ops
            .iter()
            .filter(|(op, _, root)| op == "OpenRead" && *root == images_root)
            .map(|(_, cursor, _)| *cursor)
            .collect();
        assert!(
            !ops.iter()
                .any(|(op, cursor, _)| op == "Column" && table_cursors.contains(cursor)),
            "{sql}\nmust not read metadata-heavy table records: {ops:?}"
        );
    }

    fn assert_all_counts_index_only(conn: &Connection) {
        for finalwhere in where_shapes() {
            for sql in count_queries(VIEW, &finalwhere) {
                assert_index_only(conn, &sql);
            }
        }
    }

    fn rows(conn: &Connection, sql: &str) -> Vec<String> {
        let mut statement = conn.prepare(sql).unwrap();
        let width = statement.column_count();
        let mut result: Vec<String> = statement
            .query_map([], |row| {
                (0..width)
                    .map(|i| {
                        row.get::<_, rusqlite::types::Value>(i)
                            .map(|v| format!("{v:?}"))
                    })
                    .collect::<Result<Vec<_>, _>>()
                    .map(|values| values.join("|"))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        result.sort();
        result
    }

    #[test]
    fn index_expressions_match_the_query_builders_exactly() {
        // SQLite uses an expression in an index only when the query writes the
        // same expression, so each IFNULL here must appear verbatim in the code
        // that builds the gallery WHERE clause and in the count view's terms.
        let sql = migration86().sql;
        let index_sql = sql.split("CREATE VIEW").next().unwrap();
        let expressions: Vec<&str> = index_sql
            .match_indices("IFNULL(")
            .map(|(start, _)| {
                let end = index_sql[start..].find(')').expect("closing parenthesis") + start + 1;
                &index_sql[start..end]
            })
            .collect();
        assert_eq!(
            expressions,
            [
                "IFNULL(is_intermediate_gen, 0)",
                "IFNULL(is_grid_gen, 0)",
                "IFNULL(is_invoke_asset_gen, 0)"
            ]
        );
        let terms = count_index_terms();
        for expression in expressions {
            let predicate = format!("{expression} = 0");
            assert!(
                SQL_HELPERS.contains(&format!("'{predicate}'")),
                "sqlHelpers.ts must write {predicate}"
            );
            assert!(
                terms.contains(&predicate),
                "COUNT_INDEX_TERMS must hold {predicate}: {terms:?}"
            );
        }
        for term in base_visible_where()
            .trim_start_matches("WHERE ")
            .split(" AND ")
        {
            assert!(
                terms.iter().any(|t| t == term),
                "{term} must reach the count view"
            );
        }
    }

    #[test]
    fn every_count_view_term_reads_only_the_index() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 86);
        let terms = count_index_terms();
        assert!(terms.len() >= 9, "{terms:?}");
        for term in &terms {
            for sql in count_queries(VIEW, &format!("WHERE {term}")) {
                assert_index_only(&conn, &sql);
            }
        }
        assert_index_only(
            &conn,
            &count_queries(VIEW, &format!("WHERE {}", terms.join(" AND ")))[1],
        );
    }

    #[test]
    fn fresh_schema_counts_read_only_the_index() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 86);
        assert_all_counts_index_only(&conn);
    }

    #[test]
    fn count_view_matches_scoped_images_in_every_scope_mode_and_after_statistics() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 85);
        conn.execute_batch(
            r#"
            WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 3000)
            INSERT INTO images(id, path, metadata_json, media_type, is_deleted, privacy_hidden,
                invoke_scope_hidden, invoke_source_id, invoke_owner_id, invoke_image_category,
                model_name, resolved_model_name, tool, source_kind)
            SELECT CAST(v AS TEXT), CAST(v AS TEXT),
                CASE WHEN v % 7 = 0 THEN '{"isIntermediate":true}' ELSE '{}' END,
                CASE WHEN v % 11 = 0 THEN 'video' ELSE 'image' END,
                v % 5 = 0, v % 3 = 0, v % 13 = 0,
                CASE v % 4 WHEN 0 THEN NULL WHEN 1 THEN 'other' ELSE 'source' END,
                CASE v % 3 WHEN 0 THEN NULL WHEN 1 THEN 'a' ELSE 'b' END,
                CASE WHEN v % 17 = 0 THEN 'control' ELSE 'general' END,
                'model-' || (v % 9), CASE WHEN v % 2 = 0 THEN 'resolved-' || (v % 5) END,
                'tool-' || (v % 4), CASE WHEN v % 6 = 0 THEN 'photograph' ELSE 'generated' END
            FROM n;
            "#,
        )
        .unwrap();
        let modes = [
            ("absent", ""),
            ("unselected", ""),
            ("legacy", ""),
            ("all", ""),
            ("owner", "a"),
            ("owner", "b"),
        ];
        let set_scope = |conn: &Connection, mode: &str, owner: &str| {
            conn.execute("DELETE FROM invoke_owner_scope_state", [])
                .unwrap();
            if mode != "absent" {
                conn.execute(
                    "INSERT INTO invoke_owner_scope_state(state_key, db_path, images_root, scope_mode, owner_id, updated_at)
                     VALUES ('current', 'source', 'C:/invoke', ?1, ?2, 1)",
                    [mode, owner],
                )
                .unwrap();
            }
        };
        let unbound: Vec<String> = where_shapes().into_iter().take(4).collect();
        let before: Vec<Vec<Vec<String>>> = modes
            .iter()
            .map(|(mode, owner)| {
                set_scope(&conn, mode, owner);
                unbound
                    .iter()
                    .flat_map(|w| count_queries("scoped_images", w))
                    .map(|sql| rows(&conn, &sql))
                    .collect()
            })
            .collect();
        assert!(before.iter().flatten().all(|result| !result.is_empty()));

        conn.execute_batch(migration86().sql).unwrap();
        for statistics in ["SELECT 1", "ANALYZE", "PRAGMA optimize(0x10002)"] {
            conn.execute_batch(statistics).unwrap();
            assert_all_counts_index_only(&conn);
            for ((mode, owner), expected) in modes.iter().zip(&before) {
                set_scope(&conn, mode, owner);
                let via_view: Vec<Vec<String>> = unbound
                    .iter()
                    .flat_map(|w| count_queries(VIEW, w))
                    .map(|sql| rows(&conn, &sql))
                    .collect();
                assert_eq!(&via_view, expected, "{mode} {owner} after {statistics}");
            }
        }
        let integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
    }

    #[test]
    fn gallery_page_keeps_its_sort_index() {
        // The first page must still read in timestamp order from the sort index,
        // not sort every visible row from the count index.
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 85);
        let base = base_visible_where();
        let queries = [
            format!("SELECT id, path FROM scoped_images AS images {base} AND IFNULL(is_invoke_asset_gen, 0) = 0 ORDER BY images.timestamp DESC, images.id DESC LIMIT 100"),
            format!("SELECT id, path FROM scoped_images AS images {base} ORDER BY images.timestamp DESC, images.id DESC LIMIT 100"),
        ];
        let plan = |conn: &Connection, sql: &str| -> Vec<String> {
            conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .unwrap()
                .query_map([], |r| r.get(3))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        let before: Vec<_> = queries.iter().map(|sql| plan(&conn, sql)).collect();
        conn.execute_batch(migration86().sql).unwrap();
        for (sql, expected) in queries.iter().zip(before) {
            let after = plan(&conn, sql);
            assert_eq!(after, expected, "{sql}");
            assert!(!after.iter().any(|p| p.contains(INDEX)), "{sql}: {after:?}");
        }
    }

    #[test]
    fn missing_count_index_fails_instead_of_reading_heavy_rows() {
        let conn = Connection::open_in_memory().unwrap();
        schema(&conn, 86);
        conn.execute_batch(&format!("DROP INDEX {INDEX}")).unwrap();
        let error = conn
            .prepare(&count_queries(VIEW, &base_visible_where())[0])
            .unwrap_err()
            .to_string();
        assert!(error.contains(INDEX), "{error}");
    }
}
