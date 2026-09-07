//! Exercises the installed SQL plugin over mock IPC. Never constructs Ambit's app/profile.

mod count_index_benchmark;
mod count_read_only_probe;
mod narrow_count_experiment;
#[cfg(feature = "startup-sql-trace")]
mod startup_trace_tests;

// MockRuntime still links Tauri's Windows menu support. Unlike the desktop binary,
// the Rust lib-test executable does not receive Tauri's Common Controls v6 manifest.
#[cfg(all(windows, target_env = "msvc"))]
const TEST_MANIFEST_DEPENDENCY: &[u8; 168] = b" /MANIFESTDEPENDENCY:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\" ";
#[cfg(all(windows, target_env = "msvc"))]
#[used]
#[link_section = ".drectve"]
static TEST_MANIFEST: [u8; TEST_MANIFEST_DEPENDENCY.len()] = *TEST_MANIFEST_DEPENDENCY;

use super::tests::GeneratedBenchmarkDir;
use serde_json::{json, Value};
use sqlx::{Sqlite, SqlitePool};
use std::{
    path::Path,
    sync::{Arc, Barrier},
    time::{Duration, Instant},
};
use tauri::{test::MockRuntime, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

pub(super) struct MockSql {
    pub(super) app: tauri::App<MockRuntime>,
    pub(super) webview: tauri::WebviewWindow<MockRuntime>,
}

impl MockSql {
    pub(super) fn new(directory: &Path) -> Self {
        Self::with_builder(directory, tauri_plugin_sql::Builder::default(), &[])
    }

    pub(super) fn with_builder(
        directory: &Path,
        builder: tauri_plugin_sql::Builder,
        preload: &[String],
    ) -> Self {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        // Mock-only absolute identifier confines even the plugin's app-config mkdir to this fixture.
        let identifier = directory.to_str().unwrap();
        #[cfg(windows)]
        let identifier = identifier.strip_prefix(r"\\?\").unwrap_or(identifier);
        context.config_mut().identifier = identifier.to_owned();
        context
            .config_mut()
            .plugins
            .0
            .insert("sql".into(), json!({"preload":preload}));
        for command in ["load", "select", "execute", "close"] {
            context.runtime_authority_mut().__allow_command(
                format!("plugin:sql|{command}"),
                tauri::utils::acl::ExecutionContext::Local,
            );
        }
        let app = tauri::test::mock_builder()
            .plugin(builder.build())
            .build(context)
            .unwrap();
        assert_eq!(
            app.path().app_config_dir().unwrap().canonicalize().unwrap(),
            directory.canonicalize().unwrap()
        );
        let webview = tauri::WebviewWindowBuilder::new(&app, "sql-test", Default::default())
            .build()
            .unwrap();
        Self { app, webview }
    }

    pub(super) fn load(&self, path: &Path) -> String {
        let db = fixture_url(path);
        assert_eq!(ipc(&self.webview, "load", json!({"db":db})), json!(db));
        db
    }

    pub(super) fn pool(&self, db: &str) -> SqlitePool {
        tauri::async_runtime::block_on(async {
            let state = self.app.state::<DbInstances>();
            let instances = state.0.read().await;
            match instances.get(db).unwrap() {
                DbPool::Sqlite(pool) => pool.clone(),
            }
        })
    }
}

pub(super) fn fixture_url(path: &Path) -> String {
    let text = path.to_str().unwrap();
    #[cfg(windows)]
    let text = text
        .strip_prefix(r"\\?\")
        .unwrap_or(text)
        .replace('\\', "/");
    format!("sqlite:{text}")
}

impl Drop for MockSql {
    fn drop(&mut self) {
        tauri::async_runtime::block_on(async {
            let state = self.app.state::<DbInstances>();
            let pools: Vec<_> = state
                .0
                .read()
                .await
                .values()
                .map(|pool| match pool {
                    DbPool::Sqlite(pool) => pool.clone(),
                })
                .collect();
            for pool in pools {
                // Explicit connection close waits for each SQLite worker to release file handles.
                // Pool-close racing a just-returned connection can otherwise outlive fixture cleanup.
                let mut connections = Vec::new();
                for _ in 0..pool.size() {
                    match pool.acquire().await {
                        Ok(connection) => connections.push(connection),
                        Err(_) => break,
                    }
                }
                for connection in connections {
                    if let Err(error) = connection.close().await {
                        eprintln!("generated SQL-plugin connection cleanup failed: {error}");
                    }
                }
                pool.close().await;
            }
        });
    }
}

pub(super) fn ipc(
    webview: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: Value,
) -> Value {
    ipc_result(webview, command, body).unwrap()
}

pub(super) fn ipc_result(
    webview: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: format!("plugin:sql|{command}"),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(any(windows, target_os = "android")) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize().unwrap())
}

#[test]
fn sql_plugin_ipc_uses_only_the_generated_database() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("generated-ipc.db");
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT 7 AS value","values":[]})
        ),
        json!([{"value":7}])
    );
    assert!(sql.pool(&db).size() >= 1);
    assert!(path.is_file());
}

pub(super) fn wait_until(label: &str, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {label}");
        std::thread::sleep(Duration::from_millis(1));
    }
}

pub(super) fn acquire_connections(
    pool: &SqlitePool,
    count: u32,
) -> Vec<sqlx::pool::PoolConnection<Sqlite>> {
    tauri::async_runtime::block_on(async {
        let mut held = Vec::new();
        for _ in 0..count {
            held.push(pool.acquire().await.unwrap());
        }
        held
    })
}

#[test]
#[ignore = "candidate acceptance only: upstream 2.4.0 retains the registry guard during operations"]
fn sql_plugin_registry_registration_progresses_during_active_pooled_operations() {
    super::sql_plugin_runtime_tests::pending_select_and_execute_do_not_block_unrelated_registration_or_query();
}

// Frozen previous frontend setup for the retained, opt-in baseline benchmark.
fn frontend_pragmas() -> Vec<&'static str> {
    vec![
        "PRAGMA journal_mode=WAL",
        "PRAGMA synchronous=NORMAL",
        "PRAGMA busy_timeout=60000",
        "PRAGMA cache_size=-64000",
        "PRAGMA temp_store=MEMORY",
        "PRAGMA mmap_size=268435456",
    ]
}

fn configure_via_ipc(sql: &MockSql, db: &str) {
    for query in frontend_pragmas() {
        ipc(
            &sql.webview,
            "execute",
            json!({"db":db,"query":query,"values":[]}),
        );
    }
}

pub(super) fn pragma_snapshots(held: &mut [sqlx::pool::PoolConnection<Sqlite>]) -> Vec<Value> {
    tauri::async_runtime::block_on(async {
        let mut result = Vec::new();
        for (slot, conn) in held.iter_mut().enumerate() {
            let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
                .fetch_one(&mut **conn)
                .await
                .unwrap();
            let mut values = json!({"connection_slot":slot,"journal_mode":journal});
            for pragma in [
                "synchronous",
                "busy_timeout",
                "cache_size",
                "temp_store",
                "mmap_size",
            ] {
                let value: i64 = sqlx::query_scalar(&format!("PRAGMA {pragma}"))
                    .fetch_one(&mut **conn)
                    .await
                    .unwrap();
                values[pragma] = json!(value);
            }
            result.push(values);
        }
        result
    })
}

const MAINTENANCE_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/services/db/maintenanceRepo.ts"
));

// Historical campaigns assumed the pre-m80 schema and metadata-heavy count.
// Keep their evidence, but require a separately approved protocol before new runs.
pub(super) const PRE_M80_MAINTENANCE_SHA256: &str =
    "35504c2bf7e8a653249709dc1fea683088fa9d9172322b2b841c9b0f919a0118";

pub(super) fn require_pre_m80_campaign() {
    assert!(
        super::get_migrations()
            .iter()
            .all(|migration| migration.version < 80),
        "historical count campaign is incompatible with migration 80; separate approval required"
    );
}

#[test]
#[should_panic(expected = "historical count campaign is incompatible with migration 80")]
fn historical_campaign_rejects_current_schema_before_preparation() {
    require_pre_m80_campaign();
}

pub(super) fn maintenance_count_sql() -> &'static str {
    MAINTENANCE_SOURCE
        .split("startupTracedSelect<MaintenanceCountRow[]>(db, 'maintenance', `")
        .nth(1)
        .expect("actual maintenance count query")
        .split('`')
        .next()
        .unwrap()
}

pub(super) fn sorted_rows(value: Value) -> Vec<Value> {
    let mut rows = value.as_array().unwrap().clone();
    rows.sort_by_key(|row| {
        row.get("collection_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned()
    });
    rows
}

fn direct_count_rows(conn: &rusqlite::Connection, query: &str) -> Vec<Value> {
    direct_count_rows_checked(conn, query).expect("generated count rows")
}

fn direct_count_rows_checked(
    conn: &rusqlite::Connection,
    query: &str,
) -> rusqlite::Result<Vec<Value>> {
    let mut statement = conn.prepare(query)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| (*name).into())
        .collect();
    let rows = statement
        .query_map([], |row| {
            let mut value = json!({});
            for (index, name) in names.iter().enumerate() {
                value[name] = if name == "collection_id" {
                    json!(row.get::<_, String>(index)?)
                } else {
                    json!(row.get::<_, i64>(index)?)
                };
            }
            Ok(value)
        })?
        .collect::<Result<_, _>>();
    rows
}

fn timed_select(sql: &MockSql, db: &str, query: &str) -> (Vec<Value>, f64) {
    let started = Instant::now();
    let value = ipc(
        &sql.webview,
        "select",
        json!({"db":db,"query":query,"values":[]}),
    );
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    (sorted_rows(value), elapsed)
}

#[test]
#[ignore = "opt-in installed SQL-plugin IPC/pool measurement on a generated 150k-row catalog"]
fn benchmark_sql_plugin_representative_generated_catalog() {
    require_pre_m80_campaign();
    use super::collection_stats_query_tests::{seed_catalog, set_scope, SHAPES};
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("representative.db");
    seed_catalog(&path, SHAPES[0], false);
    let direct = rusqlite::Connection::open(&path).unwrap();
    set_scope(&direct, "all", "", true);
    for pragma in frontend_pragmas() {
        direct.execute_batch(pragma).unwrap();
    }
    let sql = MockSql::new(&directory.path);
    let load_started = Instant::now();
    let db = sql.load(&path);
    let load_ms = load_started.elapsed().as_secs_f64() * 1000.0;
    let pool = sql.pool(&db);
    let runtime = tauri::async_runtime::handle();
    let _runtime_context = runtime.inner().enter();
    configure_via_ipc(&sql, &db);
    let mut held = acquire_connections(&pool, 3);
    let pragmas = pragma_snapshots(&mut held);
    drop(held);
    println!(
        "SQL_PLUGIN_ENV {}",
        json!({"debug_assertions":cfg!(debug_assertions),"sqlite":rusqlite::version(),
        "plugin_version":"2.4.0","sqlx_version":"0.8.6","images":150000,"memberships":132000,"collections":379,
        "load_ipc_total_ms":load_ms,"pool_max":pool.options().get_max_connections(),"held_connection_pragmas":pragmas,
        "limitations":"MockRuntime IPC, not real WebView rendering or OS-cold app startup. IPC totals include registry/pool/query/decode; no subtraction-based attribution."})
    );
    let queries = [
        super::tests::production_collection_stats_query(),
        maintenance_count_sql(),
    ];
    for scope_name in ["all", "owner"] {
        set_scope(
            &direct,
            scope_name,
            if scope_name == "owner" { "a" } else { "" },
            true,
        );
        let expected = [
            sorted_rows(json!(direct_count_rows(&direct, queries[0]))),
            sorted_rows(json!(direct_count_rows(&direct, queries[1]))),
        ];
        for round in 0..6 {
            let mut direct_ms = Vec::new();
            let mut ipc_ms = Vec::new();
            for index in 0..2 {
                let started = Instant::now();
                let rows = direct_count_rows(&direct, queries[index]);
                direct_ms.push(started.elapsed().as_secs_f64() * 1000.0);
                assert_eq!(sorted_rows(json!(rows)), expected[index]);
                let (rows, elapsed) = timed_select(&sql, &db, queries[index]);
                assert_eq!(rows, expected[index]);
                ipc_ms.push(elapsed);
            }
            let concurrent = std::thread::scope(|threads| {
                let barrier = Arc::new(Barrier::new(3));
                let handles: Vec<_> = queries
                    .iter()
                    .map(|query| {
                        let barrier = Arc::clone(&barrier);
                        let view = sql.webview.clone();
                        let db = db.clone();
                        threads.spawn(move || {
                            barrier.wait();
                            let started = Instant::now();
                            let value =
                                ipc(&view, "select", json!({"db":db,"query":query,"values":[]}));
                            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
                            (sorted_rows(value), elapsed)
                        })
                    })
                    .collect();
                barrier.wait();
                handles
                    .into_iter()
                    .map(|handle| handle.join().unwrap())
                    .collect::<Vec<_>>()
            });
            for index in 0..2 {
                assert_eq!(concurrent[index].0, expected[index]);
            }
            println!(
                "SQL_PLUGIN_SAMPLE {}",
                json!({"scope":scope_name,"round":round,
                "query_order":["collection-count","maintenance-count"],"direct_connection_query_ms":direct_ms,
                "sequential_ipc_total_ms":ipc_ms,"concurrent_ipc_total_ms":[concurrent[0].1,concurrent[1].1]})
            );
        }
    }
    let mut held = acquire_connections(&pool, 3);
    println!(
        "SQL_PLUGIN_FINAL_PRAGMAS {}",
        json!({"observed":pragma_snapshots(&mut held)})
    );
    drop(held);
}

#[cfg(test)]
mod sql_plugin_benchmark;
