//! Generated-only access-path gate. No migration is registered by this experiment.
use crate::db::migrations::{
    collection_stats_query_tests::{seed_catalog, set_scope, Shape},
    tests::{production_collection_stats_query, GeneratedBenchmarkDir},
};
use rusqlite::Connection;
use serde_json::json;

const BASELINE: &str = "SELECT ci.collection_id, COUNT(*) as count
         FROM scoped_collections c
         JOIN collection_images ci ON ci.collection_id = c.id
         JOIN scoped_images i ON i.id = ci.image_id
         WHERE i.invoke_scope_hidden = 0
         GROUP BY ci.collection_id";
const VIEW: &str = "CREATE VIEW scoped_image_count_inputs AS
    SELECT i.id, i.invoke_scope_hidden FROM images i
    LEFT JOIN invoke_owner_scope_state s ON s.state_key = 'current'
    WHERE (i.invoke_source_id IS NULL AND i.invoke_scope_hidden = 0)
       OR (i.invoke_source_id = s.db_path AND
           (s.scope_mode IN ('legacy', 'all') OR
            (s.scope_mode = 'owner' AND i.invoke_owner_id = s.owner_id)));";
pub(super) const INDEX: &str = "CREATE INDEX idx_images_collection_count_inputs
    ON images(id, invoke_source_id, invoke_owner_id, invoke_scope_hidden);
    ANALYZE idx_images_collection_count_inputs;";

fn candidate() -> String {
    BASELINE.replace("JOIN scoped_images i", "JOIN scoped_image_count_inputs i")
}

fn counts(conn: &Connection, query: &str) -> Vec<(String, i64)> {
    let mut rows = conn
        .prepare(query)
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    rows.sort_unstable();
    rows
}

// EXPLAIN is version-specific test evidence, never a runtime routing mechanism.
// Resolve table cursors from their root page, rather than assuming cursor numbers.
fn image_table_column_reads(conn: &Connection, query: &str) -> Vec<i64> {
    let root: i64 = conn
        .query_row(
            "SELECT rootpage FROM sqlite_schema WHERE type='table' AND name='images'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let operations = conn
        .prepare(&format!("EXPLAIN {query}"))
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let cursors: Vec<_> = operations
        .iter()
        .filter(|(op, _, page, database)| op == "OpenRead" && *page == root && *database == 0)
        .map(|(_, cursor, _, _)| *cursor)
        .collect();
    operations
        .iter()
        .filter(|(op, cursor, _, _)| op == "Column" && cursors.contains(cursor))
        .map(|(_, _, column, _)| *column)
        .collect()
}

#[test]
fn narrow_count_baseline_and_table_read_detector_are_grounded() {
    assert_eq!(
        BASELINE.split_whitespace().collect::<Vec<_>>(),
        production_collection_stats_query()
            .split_whitespace()
            .collect::<Vec<_>>()
    );
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE images(id TEXT PRIMARY KEY, payload TEXT);
        INSERT INTO images VALUES ('a','payload');",
    )
    .unwrap();
    assert!(!image_table_column_reads(&conn, "SELECT payload FROM images").is_empty());
    assert!(image_table_column_reads(&conn, "SELECT id FROM images").is_empty());
}

#[test]
fn narrow_count_projection_preserves_scope_results() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("scope.db");
    seed_catalog(
        &path,
        Shape {
            name: "scope",
            images: 100,
            memberships: 180,
        },
        false,
    );
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(VIEW).unwrap();
    conn.execute_batch(INDEX).unwrap();
    for (mode, owner) in [
        ("none", ""),
        ("legacy", ""),
        ("all", ""),
        ("owner", "a"),
        ("owner", "b"),
    ] {
        for verified in [false, true] {
            set_scope(&conn, mode, owner, verified);
            assert_eq!(counts(&conn, BASELINE), counts(&conn, &candidate()));
            let expected: Vec<(String, i64)> =
                counts(&conn, "SELECT id, invoke_scope_hidden FROM scoped_images");
            assert_eq!(
                expected,
                counts(
                    &conn,
                    "SELECT id, invoke_scope_hidden FROM scoped_image_count_inputs"
                )
            );
        }
    }
}

#[test]
#[ignore = "generated 150k-row four-configuration access-path gate; no app or real catalog"]
fn narrow_count_access_path_gate() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("access.db");
    seed_catalog(
        &path,
        Shape {
            name: "access",
            images: 146_182,
            memberships: 131_741,
        },
        false,
    );
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "UPDATE images SET original_metadata_json=?1, original_parsed_json=?2,
        metadata_json=?2, positive_prompt=?3, negative_prompt=?4",
        rusqlite::params![
            json!({"padding":"x".repeat(5326)}).to_string(),
            json!({"padding":"x".repeat(3929)}).to_string(),
            "x".repeat(517),
            "x".repeat(101)
        ],
    )
    .unwrap();
    conn.execute_batch("DELETE FROM collection_images;
        INSERT INTO collection_images(collection_id,image_id)
        SELECT CASE WHEN n<15858 THEN 'collection-000' ELSE printf('collection-%03d',1+(n-15858)%376) END,id
        FROM (SELECT id,CAST(substr(id,7) AS INTEGER) n FROM images) WHERE n<131741;
        UPDATE collections SET invoke_source_id=NULL,invoke_owner_id=NULL;
        ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
    set_scope(&conn, "all", "", true);
    conn.execute_batch(VIEW).unwrap();
    let expected = counts(&conn, BASELINE);
    for indexed in [false, true] {
        if indexed {
            conn.execute_batch(INDEX).unwrap();
        }
        for narrow in [false, true] {
            let sql = if narrow {
                candidate()
            } else {
                BASELINE.to_owned()
            };
            assert_eq!(counts(&conn, &sql), expected);
            let plan = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .unwrap()
                .query_map([], |row| row.get::<_, String>(3))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            println!(
                "{}",
                json!({"kind":"access-gate", "sqlite":rusqlite::version(),
                "indexed":indexed,"narrow":narrow,"plan":plan,
                "image_table_columns":image_table_column_reads(&conn,&sql)})
            );
        }
    }
    let table_columns = image_table_column_reads(&conn, &candidate());
    println!(
        "{}",
        json!({"kind":"qualification", "access_passed":table_columns.is_empty(),
        "boundary":"Generated bundled SQLite access evidence only; not IPC or startup timing"})
    );
    assert!(table_columns.is_empty(), "STOP: combined candidate still reads image-table columns; do not integrate or expand candidate");
}

#[test]
fn post_m80_collection_index_preserves_visibility_and_membership_transitions() {
    crate::db::migrations::collection_stats_query_tests::visibility_and_membership_transitions(
        Some(INDEX),
    );
}

#[test]
fn post_m80_collection_index_access_gate() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("post-m80-access.db");
    seed_catalog(
        &path,
        Shape {
            name: "post-m80-access",
            images: 600,
            memberships: 500,
        },
        false,
    );
    let conn = Connection::open(&path).unwrap();
    set_scope(&conn, "all", "", true);
    let query = production_collection_stats_query();
    let expected = counts(&conn, query);
    let gallery = "SELECT id, path FROM scoped_images
        WHERE invoke_scope_hidden = 0 AND is_deleted = 0
          AND IFNULL(is_intermediate_gen, 0) = 0 AND IFNULL(is_grid_gen, 0) = 0
          AND IFNULL(is_invoke_asset_gen, 0) = 0
        ORDER BY timestamp DESC, id DESC LIMIT 100";
    let gallery_plan = |conn: &Connection| {
        conn.prepare(&format!("EXPLAIN QUERY PLAN {gallery}"))
            .unwrap()
            .query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    let uses_gallery_sort = |plan: Vec<String>| {
        plan.iter()
            .any(|step| step.contains("idx_images_invoke_scope_fast_sort_v1"))
            && !plan
                .iter()
                .any(|step| step.contains("TEMP B-TREE FOR ORDER BY"))
    };
    assert!(uses_gallery_sort(gallery_plan(&conn)));
    let maintenance_expected = super::direct_count_rows(&conn, super::maintenance_count_sql());
    assert!(
        !image_table_column_reads(&conn, query).is_empty(),
        "baseline must reproduce image-table access"
    );
    // The exact approved candidate; no narrow view or query substitution.
    conn.execute_batch(INDEX).unwrap();
    for refreshed in [false, true] {
        if refreshed {
            conn.execute_batch("ANALYZE; PRAGMA optimize;").unwrap();
        }
        assert_eq!(counts(&conn, query), expected);
        // Statistics may change the one-row scope-state join without changing gallery sorting.
        assert!(uses_gallery_sort(gallery_plan(&conn)));
        assert_eq!(
            super::direct_count_rows(&conn, super::maintenance_count_sql()),
            maintenance_expected
        );
        let columns = image_table_column_reads(&conn, query);
        println!(
            "{}",
            json!({"kind":"post-m80-access", "sqlite":rusqlite::version(),
            "statistics_refreshed":refreshed,"exact_results":true,
            "image_table_column_operations":columns.len()})
        );
        assert!(
            columns.is_empty(),
            "STOP: approved index still reads image-table columns after migration 80"
        );
        assert!(
            image_table_column_reads(&conn, super::maintenance_count_sql()).is_empty(),
            "m80 maintenance remains compact"
        );
    }
}
