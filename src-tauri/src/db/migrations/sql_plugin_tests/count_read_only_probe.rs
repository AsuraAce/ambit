//! Real catalogs are read-only; SQL-plugin IPC uses generated fixtures only.
use rusqlite::{types::Value, Connection, OpenFlags};
use serde_json::json;
use std::{path::Path, time::Instant};

#[test]
#[ignore = "generated aggregate-shaped catalog through upstream MockRuntime IPC; not app acceptance"]
fn measure_aggregate_shaped_catalog_ipc() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    // Returning SQLx pool connections on drop requires the runtime to stay entered.
    let runtime = tauri::async_runtime::handle();
    let _runtime_context = runtime.inner().enter();
    use super::{acquire_connections, ipc, pragma_snapshots, MockSql};
    use crate::db::migrations::{
        collection_stats_query_tests::{seed_catalog, set_scope, Shape},
        tests::GeneratedBenchmarkDir,
    };
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("aggregate-shaped.db");
    seed_catalog(
        &path,
        Shape {
            name: "aggregate-shaped",
            images: 146_182,
            memberships: 131_741,
        },
        false,
    );
    let conn = Connection::open(&path).expect("generated catalog");
    // Fixed synthetic payloads approximate aggregate lengths, never copy actual metadata.
    conn.execute("UPDATE images SET original_metadata_json=?1, original_parsed_json=?2,
        metadata_json=?2, positive_prompt=?3, negative_prompt=?4,
        invoke_source_id=CASE WHEN CAST(substr(id,7) AS INTEGER)<135468 THEN 'fixture.db' ELSE NULL END,
        invoke_owner_id=CASE WHEN CAST(substr(id,7) AS INTEGER)<135468 THEN 'a' ELSE NULL END",
        rusqlite::params![json!({"padding":"x".repeat(5326)}).to_string(), json!({"padding":"x".repeat(3929)}).to_string(), "x".repeat(517), "x".repeat(101)]).expect("generated payloads");
    conn.execute_batch("DELETE FROM collection_images;
        INSERT INTO collection_images(collection_id,image_id)
        SELECT CASE WHEN n<15858 THEN 'collection-000' ELSE printf('collection-%03d',1+(n-15858)%376) END,id
        FROM (SELECT id,CAST(substr(id,7) AS INTEGER) n FROM images) WHERE n<131741;
        UPDATE collections SET invoke_source_id=NULL,invoke_owner_id=NULL;
        ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);").expect("generated membership distribution");
    set_scope(&conn, "all", "", true);
    let queries = [
        super::super::tests::production_collection_stats_query(),
        super::maintenance_count_sql(),
    ];
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    super::configure_via_ipc(&sql, &db);
    let expected: Vec<_> = queries
        .iter()
        .map(|query| super::sorted_rows(serde_json::json!(super::direct_count_rows(&conn, query))))
        .collect();
    for round in 0..3 {
        for index in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
            let (result, ms) = super::timed_select(&sql, &db, queries[index]);
            assert!(
                result == expected[index],
                "generated sequential exact counts"
            );
            println!(
                "{}",
                json!({"kind":"generated-sequential","round":round,"query":index,"ms":ms})
            );
        }
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..2)
                .map(|index| {
                    let barrier = &barrier;
                    let view = sql.webview.clone();
                    let db = db.clone();
                    scope.spawn(move || {
                        barrier.wait();
                        let started = Instant::now();
                        let result = ipc(
                            &view,
                            "select",
                            json!({"db":db,"query":queries[index],"values":[]}),
                        );
                        let ms = started.elapsed().as_secs_f64() * 1000.0;
                        (super::sorted_rows(result), ms)
                    })
                })
                .collect();
            for (index, handle) in handles.into_iter().enumerate() {
                let (result, ms) = handle.join().expect("generated IPC worker");
                assert!(
                    result == expected[index],
                    "generated concurrent exact counts"
                );
                println!(
                    "{}",
                    json!({"kind":"generated-concurrent","round":round,"query":index,"ms":ms})
                );
            }
        });
    }
    let pool = sql.pool(&db);
    let mut held = acquire_connections(&pool, 10);
    println!(
        "{}",
        json!({"kind":"generated-environment","pool":pragma_snapshots(&mut held),"memory":super::sql_plugin_benchmark::peak_process_memory_bytes(),"database_bytes":std::fs::metadata(&path).unwrap().len(),"limitations":"Approximate average payload lengths and membership skew only; uniform payloads omit outliers, IDs and physical layout differ; IPC totals after fixture creation/reference reads are not OS-cold."})
    );
}

fn open(path: &Path) -> Connection {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .unwrap_or_else(|_| panic!("read-only probe open failed"));
    conn.execute_batch("PRAGMA query_only=ON; PRAGMA busy_timeout=2000;")
        .expect("read-only connection policy");
    conn
}

fn rows(conn: &Connection, sql: &str) -> (Vec<Vec<Value>>, f64) {
    let interrupt = conn.get_interrupt_handle();
    let (cancel, cancelled) = std::sync::mpsc::channel();
    let (result, elapsed) = std::thread::scope(|scope| {
        scope.spawn(move || {
            if matches!(
                cancelled.recv_timeout(std::time::Duration::from_secs(60)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ) {
                interrupt.interrupt();
            }
        });
        let started = Instant::now();
        let result = (|| -> rusqlite::Result<Vec<Vec<Value>>> {
            let mut statement = conn.prepare(sql)?;
            let columns = statement.column_count();
            let values = statement.query_map([], |row| {
                (0..columns).map(|column| row.get(column)).collect()
            })?;
            values.collect()
        })();
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let _ = cancel.send(());
        (result, elapsed)
    });
    let mut result = result.unwrap_or_else(|_| {
        panic!("fixed read-only probe failed or exceeded its execution deadline")
    });
    result.sort_by_key(|row| format!("{row:?}"));
    (result, elapsed)
}

#[test]
fn probe_connection_cannot_change_a_catalog() {
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let path = directory.path.join("readonly.db");
    let writer = Connection::open(&path).unwrap();
    writer
        .execute_batch("CREATE TABLE sentinel(value INTEGER); INSERT INTO sentinel VALUES(7);")
        .unwrap();
    drop(writer);
    let before = std::fs::read(&path).unwrap();
    let reader = open(&path);
    assert!(reader.execute("UPDATE sentinel SET value=8", []).is_err());
    assert_eq!(
        rows(&reader, "SELECT value FROM sentinel").0,
        vec![vec![Value::Integer(7)]]
    );
    drop(reader);
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

mod campaign;
