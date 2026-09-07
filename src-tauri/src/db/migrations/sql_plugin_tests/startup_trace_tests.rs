//! Generated-only diagnostic feature parity and synchronization through real plugin IPC.
use super::{
    acquire_connections, fixture_url, ipc, ipc_result, wait_until, GeneratedBenchmarkDir, MockSql,
};
use serde_json::{json, Value};
use std::{sync::Arc, time::Instant};
use tauri::Manager;
use tauri_plugin_sql::{
    startup_trace::{Collector, Label, Operation, Role, Stage, Status},
    DbInstances, Migration, MigrationKind,
};

const LAUNCH: &str = "00000000-0000-4000-8000-000000000000";

#[test]
fn maintenance_m80_upgrade_and_reload_preserve_counts_with_optional_tracing() {
    for enabled in [false, true] {
        let directory = GeneratedBenchmarkDir::new();
        let path = directory.path.join("maintenance-upgrade.db");
        let db = fixture_url(&path);
        let collector = Collector::new(LAUNCH.into(), vec![db.clone()], Instant::now());
        let old = MockSql::with_builder(
            &directory.path,
            tauri_plugin_sql::Builder::new().add_migrations(
                &db,
                crate::db::migrations::get_migrations()
                    .into_iter()
                    .filter(|migration| migration.version <= 79)
                    .collect(),
            ),
            &[],
        );
        old.load(&path);
        ipc(
            &old.webview,
            "execute",
            json!({"db":db,"query":
            "INSERT INTO images(id, path, positive_prompt) VALUES ('generated', 'generated.png', '')",
            "values":[]}),
        );
        let history_query =
            "SELECT version, hex(checksum) AS checksum FROM _sqlx_migrations ORDER BY version";
        let history = ipc(
            &old.webview,
            "select",
            json!({"db":db,"query":history_query,"values":[]}),
        );
        ipc(&old.webview, "close", json!({"db":db}));
        drop(old);

        let builder = tauri_plugin_sql::Builder::new()
            .add_migrations(&db, crate::db::migrations::get_migrations());
        let builder = if enabled {
            builder.startup_trace(collector.clone())
        } else {
            builder
        };
        let sql = MockSql::with_builder(&directory.path, builder, &[]);
        sql.load(&path);
        let query = super::maintenance_count_sql();
        let expected = json!([{"untagged":1,"missing":0,"intermediates":0,"trash":0}]);
        for trace in [
            json!(null),
            json!({"launchId":LAUNCH,"callId":1,"label":"maintenance"}),
            json!({"launchId":"unavailable","callId":2,"label":"maintenance"}),
        ] {
            assert_eq!(
                ipc(
                    &sql.webview,
                    "select",
                    json!({"db":db,"query":query,
                "values":[],"startupTrace":trace})
                ),
                expected
            );
        }
        let upgraded = ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":history_query,"values":[]}),
        );
        assert_eq!(
            &upgraded.as_array().unwrap()[..history.as_array().unwrap().len()],
            history.as_array().unwrap()
        );
        assert_eq!(upgraded.as_array().unwrap().last().unwrap()["version"], 80);
        ipc(&sql.webview, "close", json!({"db":db}));
        sql.load(&path);
        assert_eq!(
            ipc(
                &sql.webview,
                "select",
                json!({"db":db,"query":history_query,"values":[]})
            ),
            upgraded
        );
        assert_eq!(
            ipc(
                &sql.webview,
                "select",
                json!({"db":db,"query":query,"values":[]})
            ),
            expected
        );
        let batch = collector.drain().unwrap();
        assert_eq!(batch.details.len(), usize::from(enabled));
        if enabled {
            assert_eq!(batch.details[0].label, Some(Label::Maintenance));
            assert_eq!(batch.details[0].status, Status::Completed);
        }
        ipc(&sql.webview, "close", json!({"db":db}));
    }
}

#[test]
fn external_sqlite_lock_delays_fetch_not_registry_or_pool_acquisition() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("fetch-lock.db");
    let blocker = rusqlite::Connection::open(&path).unwrap();
    blocker.execute_batch("PRAGMA journal_mode=DELETE; CREATE TABLE sentinel(value INTEGER); INSERT INTO sentinel VALUES(23);").unwrap();
    let db = fixture_url(&path);
    let collector = Collector::new(LAUNCH.into(), vec![db.clone()], Instant::now());
    let sql = MockSql::with_builder(
        &directory.path,
        tauri_plugin_sql::Builder::new().startup_trace(collector.clone()),
        &[],
    );
    sql.load(&path);
    let pool = sql.pool(&db);
    let mut held = acquire_connections(&pool, 10);
    assert_eq!(
        blocker
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "delete"
    );
    blocker.execute_batch("BEGIN EXCLUSIVE").unwrap();
    // Only the already-open released connection is available; acquisition need not open a database.
    drop(held.pop());
    let view = sql.webview.clone();
    let worker = std::thread::spawn(move || {
        ipc_result(
            &view,
            "select",
            json!({"db":db,
        "query":"SELECT value FROM sentinel","values":[],"startupTrace":metadata(1)}),
        )
    });
    wait_until("SQLite-locked read reached fetch", || {
        collector.snapshot().is_some_and(|batch| {
            batch
                .details
                .iter()
                .any(|record| record.stage == Stage::Fetch && record.status == Status::Pending)
        })
    });
    assert!(!worker.is_finished());
    blocker.execute_batch("ROLLBACK").unwrap();
    assert_eq!(worker.join().unwrap().unwrap(), json!([{"value":23}]));
    drop(held);
    let batch = collector.drain().unwrap();
    let record = &batch.details[0];
    assert_eq!(record.status, Status::Completed);
    assert!(record.timings.registry_wait_ms.is_some());
    assert!(record.timings.acquire_ms.is_some());
    assert!(record.timings.fetch_ms.is_some_and(|ms| ms > 0.0));
    assert!(record.timings.decode_ms.is_some());
}

#[test]
fn failing_migration_preserves_ipc_error_and_does_not_register_database() {
    let mut baseline = None;
    for tracing in [false, true] {
        let directory = GeneratedBenchmarkDir::new();
        let path = directory.path.join("failed-migration.db");
        let db = fixture_url(&path);
        let collector = Collector::new(LAUNCH.into(), vec![db.clone()], Instant::now());
        let builder = tauri_plugin_sql::Builder::new().add_migrations(
            &db,
            vec![Migration {
                version: 1,
                description: "generated failure",
                sql: "INSERT INTO deliberately_absent VALUES(1);",
                kind: MigrationKind::Up,
            }],
        );
        let builder = if tracing {
            builder.startup_trace(collector.clone())
        } else {
            builder
        };
        let sql = MockSql::with_builder(&directory.path, builder, &[]);
        let error = ipc_result(&sql.webview, "load", json!({"db":db})).unwrap_err();
        if let Some(expected) = &baseline {
            assert_eq!(&error, expected);
        } else {
            baseline = Some(error);
        }
        assert!(tauri::async_runtime::block_on(async {
            !sql.app
                .state::<DbInstances>()
                .0
                .read()
                .await
                .contains_key(&db)
        }));
        if tracing {
            let batch = collector.drain().unwrap();
            let record = batch
                .coarse
                .iter()
                .find(|record| record.operation == Operation::Load)
                .unwrap();
            assert_eq!(record.status, Status::Failed);
            assert_eq!(record.stage, Stage::Migrate);
            assert!(record.timings.migrate_ms.is_some());
            assert!(record.timings.registry_write_ms.is_none());
        }
    }
}

fn metadata(call_id: u32) -> Value {
    json!({"launchId":LAUNCH,"callId":call_id,"label":"collection"})
}
fn fixture() -> (GeneratedBenchmarkDir, MockSql, String, Arc<Collector>) {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("trace.db");
    let db = fixture_url(&path);
    let collector = Collector::new(LAUNCH.into(), vec![db.clone()], Instant::now());
    let sql = MockSql::with_builder(
        &directory.path,
        tauri_plugin_sql::Builder::default().startup_trace(collector.clone()),
        &[],
    );
    sql.load(&path);
    (directory, sql, db, collector)
}

#[test]
fn optional_metadata_preserves_typed_results_errors_and_source_isolation() {
    let (_directory, sql, db, collector) = fixture();
    let query =
        "SELECT ? AS empty, ? AS name, ? AS amount, ? AS flag, ? AS document, X'0102' AS bytes";
    let values = json!([null,"private fixture value",42,true,{"private":"fixture"}]);
    let plain = ipc(
        &sql.webview,
        "select",
        json!({"db":db,"query":query,"values":values}),
    );
    let traced = ipc(
        &sql.webview,
        "select",
        json!({"db":db,"query":query,"values":values,"startupTrace":metadata(1)}),
    );
    assert_eq!(plain, traced);
    for malformed in [
        json!(false),
        json!({"launchId":"foreign","callId":2,"label":"collection"}),
        json!({"launchId":LAUNCH,"callId":2,"label":"unknown"}),
        json!({"launchId":LAUNCH,"callId":2,"label":"collection","private":"do-not-record"}),
    ] {
        assert_eq!(
            ipc(
                &sql.webview,
                "select",
                json!({"db":db,"query":query,"values":values,"startupTrace":malformed})
            ),
            plain
        );
    }
    let error_body = json!({"db":db,"query":"SELECT absent_private_column","values":[]});
    let plain_error = ipc_result(&sql.webview, "select", error_body.clone());
    let mut traced_error = error_body;
    traced_error["startupTrace"] = metadata(2);
    assert_eq!(
        ipc_result(&sql.webview, "select", traced_error),
        plain_error
    );
    let missing = "sqlite:never-loaded-private.db";
    let absent_plain = ipc_result(
        &sql.webview,
        "select",
        json!({"db":missing,"query":"SELECT 1","values":[]}),
    );
    assert_eq!(
        ipc_result(
            &sql.webview,
            "select",
            json!({"db":missing,"query":"SELECT 1","values":[],"startupTrace":metadata(3)})
        ),
        absent_plain
    );
    let batch = collector.drain().unwrap();
    assert_eq!(batch.details.len(), 2);
    assert_eq!(batch.details[0].label, Some(Label::Collection));
    assert_eq!(batch.details[0].role, Role::Main);
    assert_eq!(batch.details[0].status, Status::Completed);
    assert_eq!(batch.details[1].status, Status::Failed);
    for duration in [
        batch.details[0].timings.registry_wait_ms,
        batch.details[0].timings.bind_ms,
        batch.details[0].timings.acquire_ms,
        batch.details[0].timings.fetch_ms,
        batch.details[0].timings.decode_ms,
    ] {
        assert!(duration.is_some_and(|ms| ms.is_finite() && ms >= 0.0));
    }
    assert!(!serde_json::to_string(&batch).unwrap().contains("private"));
    assert!(batch.coarse.iter().any(|record| record.role == Role::Other));
}

#[test]
fn registry_wait_is_observed_without_changing_guard_ownership() {
    let (_directory, sql, db, collector) = fixture();
    let state = sql.app.state::<DbInstances>();
    let registry = tauri::async_runtime::block_on(state.0.write());
    let view = sql.webview.clone();
    let worker = std::thread::spawn(move || {
        ipc(
            &view,
            "select",
            json!({"db":db,"query":"SELECT 7 AS n","values":[],"startupTrace":metadata(1)}),
        )
    });
    wait_until("trace waiting on registry", || {
        collector.snapshot().is_some_and(|batch| {
            batch
                .details
                .iter()
                .any(|record| record.stage == Stage::RegistryWait)
        })
    });
    assert!(!worker.is_finished());
    drop(registry);
    assert_eq!(worker.join().unwrap(), json!([{"n":7}]));
    let batch = collector.drain().unwrap();
    let record = &batch.details[0];
    assert_eq!(record.status, Status::Completed);
    assert!(record.timings.registry_wait_ms.unwrap() > 0.0);
    assert!(record.timings.acquire_ms.is_some());
}

#[test]
fn pool_wait_still_retains_registry_and_blocks_registration() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let (directory, sql, db, collector) = fixture();
    let pool = sql.pool(&db);
    let held = acquire_connections(&pool, 10);
    let view = sql.webview.clone();
    let select = std::thread::spawn(move || {
        ipc(
            &view,
            "select",
            json!({"db":db,"query":"SELECT 9 AS n","values":[],"startupTrace":metadata(1)}),
        )
    });
    wait_until("trace waiting for physical connection", || {
        collector.snapshot().is_some_and(|batch| {
            batch
                .details
                .iter()
                .any(|record| record.stage == Stage::Acquire)
        })
    });
    let state = sql.app.state::<DbInstances>();
    assert!(state.0.try_write().is_err());
    let second = fixture_url(&directory.path.join("second.db"));
    let view = sql.webview.clone();
    let load = std::thread::spawn(move || ipc(&view, "load", json!({"db":second})));
    wait_until("registration waiting behind upstream read guard", || {
        collector.snapshot().is_some_and(|batch| {
            batch.coarse.iter().any(|record| {
                record.operation == Operation::Load && record.stage == Stage::RegistryWrite
            })
        })
    });
    assert!(!load.is_finished());
    assert!(!select.is_finished());
    drop(held);
    assert_eq!(select.join().unwrap(), json!([{"n":9}]));
    let _ = load.join().unwrap();
    let batch = collector.drain().unwrap();
    assert_eq!(batch.details[0].status, Status::Completed);
    assert!(batch.details[0].timings.acquire_ms.unwrap() > 0.0);
    assert!(batch
        .coarse
        .iter()
        .any(|record| record.operation == Operation::Load
            && record.timings.registry_write_ms.is_some()));
}

#[test]
fn preload_migrations_and_replacement_loading_keep_existing_pools_usable() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("preload.db");
    let db = fixture_url(&path);
    let collector = Collector::new(LAUNCH.into(), vec![db.clone()], Instant::now());
    let builder = tauri_plugin_sql::Builder::new()
        .startup_trace(collector.clone())
        .add_migrations(
            &db,
            vec![Migration {
                version: 1,
                description: "generated sentinel",
                sql: "CREATE TABLE sentinel(value INTEGER); INSERT INTO sentinel VALUES(11);",
                kind: MigrationKind::Up,
            }],
        );
    let sql = MockSql::with_builder(&directory.path, builder, &[db.clone()]);
    let old_pool = sql.pool(&db);
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT value FROM sentinel","values":[],"startupTrace":metadata(1)})
        ),
        json!([{"value":11}])
    );
    sql.load(&path);
    assert_eq!(
        tauri::async_runtime::block_on(
            sqlx::query_scalar::<_, i64>("SELECT value FROM sentinel").fetch_one(&old_pool)
        )
        .unwrap(),
        11
    );
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT version, success FROM _sqlx_migrations","values":[],"startupTrace":metadata(2)})
        ),
        json!([{"version":1,"success":1}])
    );
    tauri::async_runtime::block_on(old_pool.close());
    let batch = collector.drain().unwrap();
    assert_eq!(batch.details.len(), 2);
    assert!(batch
        .coarse
        .iter()
        .any(|record| record.operation == Operation::Load && record.status == Status::Completed));
}

#[test]
fn ordinary_load_records_migration_stages_without_changing_checksums() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("migration.db");
    let db = fixture_url(&path);
    let collector = Collector::new(LAUNCH.into(), vec![db.clone()], Instant::now());
    let sql = MockSql::with_builder(
        &directory.path,
        tauri_plugin_sql::Builder::new()
            .startup_trace(collector.clone())
            .add_migrations(
                &db,
                vec![Migration {
                    version: 1,
                    description: "generated",
                    sql: "CREATE TABLE sentinel(value INTEGER);",
                    kind: MigrationKind::Up,
                }],
            ),
        &[],
    );
    sql.load(&path);
    let body = json!({"db":db,"query":"SELECT version, checksum, success FROM _sqlx_migrations","values":[]});
    let plain = ipc(&sql.webview, "select", body.clone());
    let mut tagged = body;
    tagged["startupTrace"] = metadata(1);
    assert_eq!(ipc(&sql.webview, "select", tagged), plain);
    let batch = collector.drain().unwrap();
    let load = batch
        .coarse
        .iter()
        .find(|record| record.operation == Operation::Load)
        .unwrap();
    assert_eq!(load.status, Status::Completed);
    for duration in [
        load.timings.connect_ms,
        load.timings.migration_mutex_ms,
        load.timings.migrate_ms,
        load.timings.registry_write_ms,
    ] {
        assert!(duration.is_some_and(|ms| ms.is_finite() && ms >= 0.0));
    }
}

#[test]
fn completed_native_without_frontend_report_remains_unknown_until_teardown() {
    let directory = GeneratedBenchmarkDir::new();
    let logs = directory.path.join("logs");
    std::fs::create_dir(&logs).unwrap();
    let started = Instant::now();
    let journal = Arc::new(crate::startup_log::StartupJournal::new(
        started,
        Some(&logs),
    ));
    let path = directory.path.join("unmatched.db");
    let db = fixture_url(&path);
    let collector = Collector::new(journal.launch_id.clone(), vec![db.clone()], started);
    journal.install_sql_trace(collector.clone());
    let sql = MockSql::with_builder(
        &directory.path,
        tauri_plugin_sql::Builder::new().startup_trace(collector),
        &[],
    );
    sql.load(&path);
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT 1 AS n","values":[],
        "startupTrace":{"launchId":journal.launch_id,"callId":1,"label":"collection"}})
        ),
        json!([{"n":1}])
    );
    journal.start_observer();
    journal.request_end();
    let read = || -> Vec<Value> {
        std::fs::read_dir(&logs)
            .unwrap()
            .filter_map(Result::ok)
            .flat_map(|entry| {
                std::fs::read_to_string(entry.path())
                    .unwrap_or_default()
                    .lines()
                    .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                    .collect::<Vec<_>>()
            })
            .collect()
    };
    wait_until("journal teardown evidence", || {
        read()
            .iter()
            .any(|record| record["kind"] == "sql-trace-summary")
    });
    let records = read();
    let count = records
        .iter()
        .find(|record| record["kind"] == "sql-count")
        .unwrap();
    assert_eq!(count["native"]["status"], "completed");
    assert_eq!(count["matched"], false);
    assert!(count["frontend"].is_null());
    assert!(count["unattributedDispatchResponseMs"].is_null());
    let summary = records
        .iter()
        .find(|record| record["kind"] == "sql-trace-summary")
        .unwrap();
    assert_eq!(summary["status"], "teardown");
}

#[test]
fn close_during_tagged_checkout_preserves_upstream_failure_and_completion() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let (_directory, sql, db, collector) = fixture();
    let pool = sql.pool(&db);
    let held = acquire_connections(&pool, 10);
    let view = sql.webview.clone();
    let select_db = db.clone();
    let select = std::thread::spawn(move || {
        ipc_result(
            &view,
            "select",
            json!({"db":select_db,
        "query":"SELECT 1","values":[],"startupTrace":metadata(1)}),
        )
    });
    wait_until("tagged checkout awaiting connection", || {
        collector.snapshot().is_some_and(|batch| {
            batch
                .details
                .iter()
                .any(|record| record.stage == Stage::Acquire)
        })
    });
    let view = sql.webview.clone();
    let close = std::thread::spawn(move || ipc_result(&view, "close", json!({"db":db})));
    wait_until("upstream close started", || pool.is_closed());
    assert!(select.join().unwrap().is_err());
    assert!(!close.is_finished());
    drop(held);
    assert!(close.join().unwrap().is_ok());
    let batch = collector.drain().unwrap();
    assert_eq!(batch.details[0].status, Status::Failed);
    assert_eq!(batch.details[0].stage, Stage::Acquire);
    assert!(batch
        .coarse
        .iter()
        .any(|record| record.operation == Operation::Close && record.status == Status::Completed));
}

#[test]
fn readiness_does_not_finalize_native_count_without_frontend_until_deadline() {
    let directory = GeneratedBenchmarkDir::new();
    let logs = directory.path.join("deadline-logs");
    std::fs::create_dir(&logs).unwrap();
    let started = Instant::now();
    let journal = crate::startup_log::StartupJournal::new(started, Some(&logs));
    let path = directory.path.join("deadline.db");
    let db = fixture_url(&path);
    let collector = Collector::new(journal.launch_id.clone(), vec![db.clone()], started);
    journal.install_sql_trace(collector.clone());
    let sql = MockSql::with_builder(
        &directory.path,
        tauri_plugin_sql::Builder::new().startup_trace(collector),
        &[],
    );
    sql.load(&path);
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT 1 AS n","values":[],
        "startupTrace":{"launchId":journal.launch_id,"callId":1,"label":"collection"}})
        ),
        json!([{"n":1}])
    );
    journal.renderer(
        &serde_json::from_value(json!({"launchId":journal.launch_id,"phase":"ready",
        "status":"completed","elapsedMs":12,"durationMs":4,"cacheAction":null}))
        .unwrap(),
    );
    let read = || -> Vec<Value> {
        std::fs::read_dir(&logs)
            .unwrap()
            .filter_map(Result::ok)
            .flat_map(|entry| {
                std::fs::read_to_string(entry.path())
                    .unwrap()
                    .lines()
                    .map(|line| serde_json::from_str::<Value>(line).unwrap())
                    .collect::<Vec<_>>()
            })
            .collect()
    };
    journal.flush_sql_trace_at(179_999, false);
    assert!(!read().iter().any(|record| matches!(
        record["kind"].as_str(),
        Some("sql-count" | "sql-trace-summary")
    )));
    journal.flush_sql_trace_at(180_000, false);
    let records = read();
    let count = records
        .iter()
        .find(|record| record["kind"] == "sql-count")
        .unwrap();
    assert_eq!(count["native"]["status"], "completed");
    assert_eq!(count["matched"], false);
    assert!(count["frontend"].is_null());
    assert!(count["unattributedDispatchResponseMs"].is_null());
    assert_eq!(
        records
            .iter()
            .find(|record| record["kind"] == "sql-trace-summary")
            .unwrap()["status"],
        "deadline"
    );
}
