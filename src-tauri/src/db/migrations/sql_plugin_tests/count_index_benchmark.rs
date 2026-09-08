//! Index-only qualification approved after the four-configuration access experiment.
//! All database writes and copies are of disposable generated catalogs, never user data.
use super::{
    configure_via_ipc, direct_count_rows, ipc, maintenance_count_sql, sorted_rows, timed_select,
    MockSql,
};
use crate::db::migrations::{
    collection_stats_query_tests::{seed_catalog, set_scope, Shape},
    tests::{production_collection_stats_query, GeneratedBenchmarkDir},
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{path::Path, time::Instant};

#[path = "count_index_diagnosis.rs"]
mod diagnosis;

fn seed_wide(path: &Path, images: usize, memberships: usize) {
    seed_catalog(
        path,
        Shape {
            name: "count-index",
            images,
            memberships,
        },
        false,
    );
    let conn = Connection::open(path).unwrap();
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
    // IDs retain their numeric prefix for deterministic membership skew, but are 80 characters.
    conn.execute_batch("DELETE FROM collection_images;")
        .unwrap();
    conn.execute("UPDATE images SET id = id || ?1", ["x".repeat(68)])
        .unwrap();
    conn.execute("INSERT INTO collection_images(collection_id,image_id)
        SELECT CASE WHEN n<?2 THEN 'collection-000' ELSE printf('collection-%03d',1+(n-?2)%376) END,id
        FROM (SELECT id,CAST(substr(id,7) AS INTEGER) n FROM images) WHERE n<?1",
        rusqlite::params![memberships as i64, (memberships * 15858 / 131741).max(1) as i64]).unwrap();
    conn.execute_batch(
        "UPDATE collections SET invoke_source_id=NULL,invoke_owner_id=NULL;
        ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);",
    )
    .unwrap();
    let lengths: (i64, i64) = conn
        .query_row(
            "SELECT MIN(LENGTH(id)),MAX(LENGTH(id)) FROM images",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(lengths, (80, 80));
    let nonempty: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT collection_id) FROM collection_images",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        nonempty, 377,
        "both representative fixtures exercise many populated collections"
    );
}

#[derive(Default)]
struct Samples {
    first: [Vec<f64>; 4],
    warm: [Vec<f64>; 4],
}

fn median(values: &[f64]) -> f64 {
    assert!(!values.is_empty());
    let mut values = values.to_vec();
    values.sort_by(f64::total_cmp);
    (values[(values.len() - 1) / 2] + values[values.len() / 2]) / 2.0
}

fn qualifies(baseline: f64, candidate: f64, primary: bool) -> bool {
    candidate
        <= if primary {
            baseline * 0.8
        } else if baseline < 200.0 {
            baseline + 20.0
        } else {
            baseline * 1.1
        }
}

#[test]
fn count_index_gate_requires_gain_and_rejects_regression() {
    assert!(qualifies(1000., 800., true));
    assert!(!qualifies(1000., 801., true));
    assert!(qualifies(1000., 1100., false));
    assert!(!qualifies(1000., 1101., false));
    assert!(qualifies(100., 120., false));
    assert!(!qualifies(100., 121., false));
}

fn pair(sql: &MockSql, db: &str, queries: [&str; 2]) -> [(Vec<Value>, f64); 2] {
    let barrier = std::sync::Barrier::new(2);
    std::thread::scope(|scope| {
        let handles: Vec<_> = queries
            .iter()
            .map(|query| {
                let barrier = &barrier;
                let view = sql.webview.clone();
                scope.spawn(move || {
                    barrier.wait();
                    let start = Instant::now();
                    let result = ipc(&view, "select", json!({"db":db,"query":query,"values":[]}));
                    let elapsed = start.elapsed().as_secs_f64() * 1000.;
                    (sorted_rows(result), elapsed)
                })
            })
            .collect();
        let mut results = handles.into_iter().map(|h| h.join().unwrap());
        [results.next().unwrap(), results.next().unwrap()]
    })
}

// Each sequential/concurrent boundary gets its own fresh database registration and pool.
// Reference reads use a separate connection. OS cache state is deliberately not called cold.
fn sample(
    template: &Path,
    owner_mode: &str,
    indexed: bool,
    concurrent: bool,
    round: usize,
    measurements: &mut Samples,
    expected: &[Vec<Value>; 2],
) {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("sample.db");
    std::fs::copy(template, &path).unwrap();
    let queries = [production_collection_stats_query(), maintenance_count_sql()];
    {
        let conn = Connection::open(&path).unwrap();
        set_scope(
            &conn,
            owner_mode,
            if owner_mode == "owner" { "a" } else { "" },
            true,
        );
        if indexed {
            conn.execute_batch(super::narrow_count_experiment::INDEX)
                .unwrap();
        }
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
    }
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    configure_via_ipc(&sql, &db);
    for repetition in 0..6 {
        let results = if concurrent {
            pair(&sql, &db, queries)
        } else {
            // Counterbalance query ordering too, without changing query text.
            let mut results = [(Vec::new(), 0.), (Vec::new(), 0.)];
            for q in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                results[q] = timed_select(&sql, &db, queries[q]);
            }
            results
        };
        for (q, (result, ms)) in results.into_iter().enumerate() {
            assert_eq!(result, expected[q], "exact generated IPC result");
            let column = q + if concurrent { 2 } else { 0 };
            if repetition == 0 {
                measurements.first[column].push(ms);
            } else {
                measurements.warm[column].push(ms);
            }
            println!(
                "{}",
                json!({"kind":"count-index-sample","scope":owner_mode,
                "indexed":indexed,"concurrent":concurrent,"round":round,"read":repetition,
                "query":q,"ms":ms})
            );
        }
    }
    let pool = sql.pool(&db);
    let mut held = super::acquire_connections(&pool, 10);
    println!(
        "{}",
        json!({"kind":"count-index-pool","scope":owner_mode,"indexed":indexed,
        "round":round,"concurrent":concurrent,"settings":super::pragma_snapshots(&mut held)})
    );
    // Held pool connections must be returned before MockSql's blocking cleanup.
    drop(held);
    drop(pool);
}

#[test]
#[ignore = "six paired actual IPC comparisons on generated wide catalogs; no app launch"]
fn count_index_primary_qualification() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let runtime = tauri::async_runtime::handle();
    let _runtime_context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let template = directory.path.join("template.db");
    seed_wide(&template, 146_182, 131_741);
    println!(
        "{}",
        json!({"kind":"count-index-environment","sqlite":rusqlite::version(),
        "bytes":std::fs::metadata(&template).unwrap().len(),"images":146182,"memberships":131741,
        "identifier_characters":80,"boundary":"actual IPC totals; first reads are not OS-cold; synthetic data only"})
    );
    for mode in ["all", "owner"] {
        qualify_scope(&template, mode, true);
    }
}

fn qualify_scope(template: &Path, mode: &str, primary_gate: bool) {
    // One immutable, unindexed reference shared by every A/B sample in this scope.
    let expected = {
        let conn = Connection::open(&template).unwrap();
        set_scope(&conn, mode, if mode == "owner" { "a" } else { "" }, true);
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        [production_collection_stats_query(), maintenance_count_sql()]
            .map(|query| sorted_rows(json!(direct_count_rows(&conn, query))))
    };
    let mut passed = true;
    let mut samples: [Samples; 2] = Default::default();
    for round in 0..6 {
        for variant in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
            for concurrent in [false, true] {
                sample(
                    &template,
                    mode,
                    variant == 1,
                    concurrent,
                    round,
                    &mut samples[variant],
                    &expected,
                );
            }
        }
    }
    for column in 0..4 {
        for first in [true, false] {
            let values = |variant: usize| {
                if first {
                    &samples[variant].first[column]
                } else {
                    &samples[variant].warm[column]
                }
            };
            let baseline = median(values(0));
            let candidate = median(values(1));
            let primary = primary_gate && !first && column == 2;
            let cell_passed = qualifies(baseline, candidate, primary);
            passed &= cell_passed;
            println!(
                "{}",
                json!({"kind":"count-index-gate","scope":mode,"column":column,
                    "first":first,"primary":primary,"baseline_ms":baseline,"candidate_ms":candidate,
                    "passed":cell_passed})
            );
        }
    }
    assert!(
        passed,
        "STOP: index-only timing qualification failed; remaining qualification cells unrun"
    );
}

#[test]
#[ignore = "rejected index: small All-users maintenance gate failed; no automatic retry"]
fn count_index_secondary_qualification() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let runtime = tauri::async_runtime::handle();
    let _runtime_context = runtime.inner().enter();
    for small in [true, false] {
        let directory = GeneratedBenchmarkDir::new();
        let template = directory.path.join("template.db");
        let (images, memberships) = if small {
            (10_000, 1_000)
        } else {
            (146_182, 131_741)
        };
        seed_wide(&template, images, memberships);
        for mode in if small {
            vec!["all", "owner", "none"]
        } else {
            vec!["none"]
        } {
            if mode == "none" {
                let conn = Connection::open(&template).unwrap();
                conn.execute_batch("UPDATE images SET invoke_source_id=NULL,invoke_owner_id=NULL,invoke_scope_hidden=0;
                    DELETE FROM invoke_owner_scope_state;
                    ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
                assert_eq!(
                    conn.query_row(
                        "SELECT COUNT(*) FROM images WHERE invoke_source_id IS NOT NULL",
                        [],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                    0
                );
            }
            println!(
                "{}",
                json!({"kind":"count-index-secondary-cell","images":images,"memberships":memberships,"scope":mode})
            );
            qualify_scope(&template, mode, false);
        }
    }
}
