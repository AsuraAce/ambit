//! Native SQL-plugin regression coverage on disposable databases only.

use super::sql_plugin_tests::*;
use super::tests::GeneratedBenchmarkDir;
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_sql::{DbInstances, DbPool};

pub(super) fn pending_select_and_execute_do_not_block_unrelated_registration_or_query() {
    let directory = GeneratedBenchmarkDir::new();
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&directory.path.join("busy.db"));
    let armed = Arc::new(AtomicBool::new(false));
    let release = Arc::new(tokio::sync::Semaphore::new(0));
    let (entered_tx, entered_rx) = mpsc::channel();
    let controlled = tauri::async_runtime::block_on(async {
        let armed = armed.clone();
        let release = release.clone();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .before_acquire(move |_, _| {
                let armed = armed.clone();
                let release = release.clone();
                let entered_tx = entered_tx.clone();
                Box::pin(async move {
                    if armed.load(Ordering::SeqCst) {
                        entered_tx.send(()).unwrap();
                        release.acquire().await.unwrap().forget();
                    }
                    Ok(true)
                })
            })
            .connect(&db)
            .await
            .unwrap();
        let first = pool.acquire().await.unwrap();
        let second = pool.acquire().await.unwrap();
        drop((first, second));
        let state = sql.app.state::<DbInstances>();
        let previous = state
            .0
            .write()
            .await
            .insert(db.clone(), DbPool::Sqlite(pool.clone()));
        let Some(DbPool::Sqlite(previous)) = previous else {
            panic!("loaded pool")
        };
        previous.close().await;
        pool
    });
    wait_until("two idle controlled connections", || {
        controlled.num_idle() >= 2
    });
    armed.store(true, Ordering::SeqCst);
    let select_view = sql.webview.clone();
    let select_db = db.clone();
    let execute_view = sql.webview.clone();
    let execute_db = db.clone();
    let other_view = sql.webview.clone();
    let other = fixture_url(&directory.path.join("unrelated.db"));
    let replacing_db = db.clone();
    std::thread::scope(|scope| {
        let select = scope.spawn(move || {
            ipc(
                &select_view,
                "select",
                json!({"db":select_db,"query":"SELECT 11 AS value","values":[]}),
            )
        });
        let execute = scope.spawn(move || ipc(&execute_view, "execute", json!({"db":execute_db,"query":"CREATE TABLE executed_once (value INTEGER)","values":[]})));
        let first_entered = entered_rx.recv_timeout(Duration::from_secs(5));
        let second_entered = entered_rx.recv_timeout(Duration::from_secs(5));
        let (finished_tx, finished_rx) = mpsc::channel();
        let unrelated = scope.spawn(move || {
            ipc(&other_view, "load", json!({"db":other}));
            let value = ipc(
                &other_view,
                "select",
                json!({"db":other,"query":"SELECT 23 AS value","values":[]}),
            );
            // Replacing the registry entry must not close/replay the in-flight handles.
            ipc(&other_view, "load", json!({"db":replacing_db}));
            finished_tx.send(value).unwrap();
        });
        let completed_while_pending = finished_rx.recv_timeout(Duration::from_secs(5));
        let both_pending = !select.is_finished() && !execute.is_finished();
        // Release before assertions/join, including the failing upstream case.
        armed.store(false, Ordering::SeqCst);
        release.add_permits(2);
        assert_eq!(select.join().unwrap(), json!([{"value":11}]));
        execute.join().unwrap();
        unrelated.join().unwrap();
        assert!(
            first_entered.is_ok() && second_entered.is_ok(),
            "both IPC operations reached their pool barrier"
        );
        assert!(
            both_pending,
            "both original operations must still be pending at the comparison"
        );
        assert_eq!(
            completed_while_pending.unwrap(),
            json!([{"value":23}]),
            "unrelated work must finish without waiting for either pool operation"
        );
    });
    assert!(!controlled.is_closed());
    tauri::async_runtime::block_on(controlled.close());
}

#[test]
fn missing_closed_and_failed_loads_preserve_plugin_error_and_reload_behavior() {
    let directory = GeneratedBenchmarkDir::new();
    let main = fixture_url(&directory.path.join("lifecycle.db"));
    let failed = fixture_url(&directory.path.join("migration-failed.db"));
    let builder = tauri_plugin_sql::Builder::default().add_migrations(
        &failed,
        vec![tauri_plugin_sql::Migration {
            version: 1,
            description: "required failing migration",
            sql: "INSERT INTO missing_required_table VALUES (1);",
            kind: tauri_plugin_sql::MigrationKind::Up,
        }],
    );
    let sql = MockSql::with_builder(&directory.path, builder, &[]);
    for command in ["select", "execute"] {
        assert!(ipc_result(
            &sql.webview,
            command,
            json!({"db":"sqlite:missing.db","query":"SELECT 1","values":[]})
        )
        .is_err());
    }
    assert!(ipc_result(&sql.webview, "close", json!({"db":"sqlite:missing.db"})).is_err());
    assert!(ipc_result(
        &sql.webview,
        "load",
        json!({"db":"sqlite:missing-parent/database.db"})
    )
    .is_err());
    assert!(
        ipc_result(&sql.webview, "load", json!({"db":failed})).is_err(),
        "required migration errors must not become optional tuning errors"
    );
    tauri::async_runtime::block_on(async {
        assert!(!sql
            .app
            .state::<DbInstances>()
            .0
            .read()
            .await
            .contains_key(&failed));
    });
    ipc(&sql.webview, "load", json!({"db":main}));
    ipc(
        &sql.webview,
        "execute",
        json!({"db":main,"query":"CREATE TABLE retained (value INTEGER)","values":[]}),
    );
    assert!(ipc_result(
        &sql.webview,
        "execute",
        json!({"db":main,"query":"NOT VALID SQL","values":[]})
    )
    .is_err());
    let first_pool = sql.pool(&main);
    assert_eq!(ipc(&sql.webview, "close", json!({"db":main})), json!(true));
    assert!(first_pool.is_closed());
    for command in ["select", "execute"] {
        assert!(ipc_result(
            &sql.webview,
            command,
            json!({"db":main,"query":"SELECT 1","values":[]})
        )
        .is_err());
    }
    ipc(&sql.webview, "load", json!({"db":main}));
    assert!(!sql.pool(&main).is_closed());
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":main,"query":"SELECT COUNT(*) AS count FROM retained","values":[]})
        ),
        json!([{"count":0}])
    );
    assert_eq!(ipc(&sql.webview, "close", json!({})), json!(true));
    assert!(sql.pool(&main).is_closed());
}
