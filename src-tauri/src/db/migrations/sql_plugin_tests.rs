//! Exercises the installed SQL plugin over mock IPC. Never constructs Ambit's app/profile.

mod count_index_benchmark;
mod count_read_only_probe;
mod narrow_count_experiment;

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
        Self::with_plugin(directory, builder.build(), preload)
    }

    fn with_plugin(
        directory: &Path,
        plugin: impl tauri::plugin::Plugin<MockRuntime> + 'static,
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
            .plugin(plugin)
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

fn guarded_sql(directory: &Path, library: &Path) -> MockSql {
    guarded_sql_with(directory, Ok(library.to_path_buf()))
}

fn guarded_sql_with(directory: &Path, library: Result<std::path::PathBuf, String>) -> MockSql {
    let guard = crate::sql_guard::SqlPluginGuard::new(
        tauri_plugin_sql::Builder::default().build(),
        move |_: &tauri::AppHandle<MockRuntime>| {
            library.clone().map(|path| crate::sql_guard::LibraryDb {
                url: fixture_url(&path),
                path,
            })
        },
    );
    MockSql::with_plugin(directory, guard, &[])
}

#[test]
fn sql_load_guard_opens_the_library_database_and_forwards_queries() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("library.db");
    let sql = guarded_sql(&directory.path, &path);

    let db = sql.load(&path);
    ipc(
        &sql.webview,
        "execute",
        json!({"db":db,"query":"CREATE TABLE t (v INTEGER)","values":[]}),
    );
    ipc(
        &sql.webview,
        "execute",
        json!({"db":db,"query":"INSERT INTO t VALUES (?)","values":[7]}),
    );
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT v FROM t","values":[]})
        ),
        json!([{"v":7}])
    );
    assert!(path.is_file());
}

#[test]
fn sql_load_guard_refuses_other_paths_without_creating_them() {
    // A compromised renderer must not be able to create or open another SQLite
    // file through the plugin, and the refusal must not reveal the library URL.
    let directory = GeneratedBenchmarkDir::new();
    let library = directory.path.join("library.db");
    let sql = guarded_sql(&directory.path, &library);

    let other = directory.path.join("other.db");
    let refusal = ipc_result(&sql.webview, "load", json!({"db":fixture_url(&other)}))
        .expect_err("a path other than the library database must be refused");
    assert_eq!(
        refusal,
        json!("The SQL plugin may open only Ambit's library database.")
    );
    assert!(!refusal.to_string().contains("library.db"));
    assert!(!other.exists(), "the refused database must not be created");
    assert!(
        !library.exists(),
        "a refused load must not open the library either"
    );
}

#[test]
fn sql_load_guard_refuses_an_existing_foreign_database_and_leaves_it_untouched() {
    let directory = GeneratedBenchmarkDir::new();
    let foreign = directory.path.join("invokeai.db");
    {
        let conn = rusqlite::Connection::open(&foreign).unwrap();
        conn.execute_batch("CREATE TABLE images (name TEXT); INSERT INTO images VALUES ('a.png');")
            .unwrap();
    }
    let sql = guarded_sql(&directory.path, &directory.path.join("library.db"));

    let foreign_url = fixture_url(&foreign);
    assert!(ipc_result(&sql.webview, "load", json!({"db":foreign_url})).is_err());
    assert!(
        ipc_result(
            &sql.webview,
            "execute",
            json!({"db":foreign_url,"query":"DELETE FROM images","values":[]})
        )
        .is_err(),
        "a refused database must never become a loaded pool"
    );
    let conn = rusqlite::Connection::open(&foreign).unwrap();
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn sql_load_guard_refuses_every_load_when_the_library_url_cannot_be_resolved() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("library.db");
    let sql = guarded_sql_with(&directory.path, Err("no app data dir".into()));

    let refusal = ipc_result(&sql.webview, "load", json!({"db":fixture_url(&path)}))
        .expect_err("an unresolved library URL must refuse the load");
    assert!(!refusal.to_string().contains("no app data dir"));
    assert!(!path.exists());
}

const STATEMENT_REFUSED: &str = "The SQL plugin refused this statement.";

/// The path as SQL text, the way a renderer would write it into a statement.
fn sql_path(path: &Path) -> String {
    fixture_url(path)["sqlite:".len()..].to_owned()
}

fn foreign_database(path: &Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.execute_batch("CREATE TABLE images (name TEXT); INSERT INTO images VALUES ('a.png');")
        .unwrap();
}

fn foreign_rows(path: &Path) -> i64 {
    rusqlite::Connection::open(path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
        .unwrap()
}

/// Statements that reach a file other than the library through the loaded pool.
fn foreign_write_attacks(foreign: &Path) -> Vec<String> {
    let foreign = sql_path(foreign);
    vec![
        format!("ATTACH DATABASE '{foreign}' AS inv; DELETE FROM inv.images; DETACH DATABASE inv;"),
        format!("SELECT 1; /*x*/ aTtAcH '{foreign}' AS inv; DELETE FROM inv.images; DETACH inv;"),
        // The ATTACH filename comes from a TEMP table that exists only on the pool connection.
        format!(
            "CREATE TEMP TABLE paths AS SELECT '{foreign}' AS p; \
             ATTACH (SELECT p FROM paths) AS inv; DELETE FROM inv.images; DETACH inv;"
        ),
    ]
}

fn vacuum_attacks(target: &Path) -> Vec<String> {
    let target = sql_path(target);
    vec![
        format!("VACUUM INTO '{target}'"),
        format!("/*x*/vAcUuM/**/INTO '{target}'"),
        format!("SELECT 1; VACUUM INTO '{target}'"),
        format!("VACUUM main INTO (SELECT '{target}')"),
    ]
}

#[test]
fn sql_guard_refuses_attach_through_execute_and_select() {
    let directory = GeneratedBenchmarkDir::new();
    let foreign = directory.path.join("invokeai.db");
    foreign_database(&foreign);
    let sql = guarded_sql(&directory.path, &directory.path.join("library.db"));
    let db = sql.load(&directory.path.join("library.db"));

    for command in ["execute", "select"] {
        for query in foreign_write_attacks(&foreign) {
            let refusal = ipc_result(
                &sql.webview,
                command,
                json!({"db":db,"query":query,"values":[]}),
            )
            .expect_err("ATTACH must be refused");
            // The TEMP-table form fails to compile on the guard ("no such
            // table"), which refuses it with SQLite's message instead.
            assert!(
                refusal == json!(STATEMENT_REFUSED)
                    || refusal
                        .as_str()
                        .is_some_and(|text| text.starts_with("SQL refused before execution:")),
                "{command} {query}: {refusal}"
            );
            assert_eq!(foreign_rows(&foreign), 1, "{command} {query}");
        }
    }
    assert_eq!(
        ipc_result(
            &sql.webview,
            "execute",
            json!({"db":db,"query":"DETACH DATABASE main","values":[]})
        ),
        Err(json!(STATEMENT_REFUSED))
    );
}

#[test]
fn bare_sql_plugin_lets_the_same_attach_rewrite_a_foreign_database() {
    // Negative proof for the test above: without the guard, the pool runs it.
    let directory = GeneratedBenchmarkDir::new();
    let foreign = directory.path.join("invokeai.db");
    foreign_database(&foreign);
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&directory.path.join("library.db"));
    let query = &foreign_write_attacks(&foreign)[0];
    ipc(
        &sql.webview,
        "execute",
        json!({"db":db,"query":query,"values":[]}),
    );
    assert_eq!(foreign_rows(&foreign), 0);
}

#[test]
fn sql_guard_refuses_vacuum_into_through_execute_and_select() {
    let directory = GeneratedBenchmarkDir::new();
    let library = directory.path.join("library.db");
    let sql = guarded_sql(&directory.path, &library);
    let db = sql.load(&library);
    let target = directory.path.join("copy.db");

    for command in ["execute", "select"] {
        for query in vacuum_attacks(&target) {
            assert_eq!(
                ipc_result(
                    &sql.webview,
                    command,
                    json!({"db":db,"query":query,"values":[]})
                ),
                Err(json!(STATEMENT_REFUSED)),
                "{command} {query}"
            );
            assert!(!target.exists(), "{command} {query} created the file");
        }
    }
}

#[test]
fn bare_sql_plugin_lets_the_same_vacuum_into_create_a_file() {
    // Negative proof for the test above.
    let directory = GeneratedBenchmarkDir::new();
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&directory.path.join("library.db"));
    let target = directory.path.join("copy.db");
    let query = &vacuum_attacks(&target)[0];
    ipc(
        &sql.webview,
        "execute",
        json!({"db":db,"query":query,"values":[]}),
    );
    assert!(target.is_file());
}

#[test]
fn sql_guard_refuses_load_extension_and_nul_before_the_plugin() {
    let directory = GeneratedBenchmarkDir::new();
    let library = directory.path.join("library.db");
    let target = directory.path.join("copy.db");
    let extension = sql_path(&directory.path.join("evil.dll"));
    let load_extension = format!("SELECT load_extension('{extension}')");

    // The bare plugin refuses it too (sqlx never enables extension loading),
    // so this proves only that the guard answers first, with its own message.
    let bare = MockSql::new(&directory.path);
    let db = bare.load(&library);
    let bare_error = ipc_result(
        &bare.webview,
        "select",
        json!({"db":db,"query":load_extension,"values":[]}),
    )
    .expect_err("sqlx keeps extension loading off");
    assert_ne!(bare_error, json!(STATEMENT_REFUSED));
    drop(bare);

    let sql = guarded_sql(&directory.path, &library);
    let db = sql.load(&library);
    for query in [
        load_extension,
        format!("SELECT 1\u{0}; VACUUM INTO '{}'", sql_path(&target)),
    ] {
        assert_eq!(
            ipc_result(
                &sql.webview,
                "select",
                json!({"db":db,"query":query,"values":[]})
            ),
            Err(json!(STATEMENT_REFUSED)),
            "{query:?}"
        );
    }
    assert!(!target.exists());
    for body in [json!({"db":db,"values":[]}), json!({"db":db,"query":7})] {
        assert_eq!(
            ipc_result(&sql.webview, "execute", body),
            Err(json!(STATEMENT_REFUSED))
        );
    }
}

#[test]
fn sql_guard_allows_the_frontends_statement_shapes() {
    let directory = GeneratedBenchmarkDir::new();
    let library = directory.path.join("library.db");
    let sql = guarded_sql(&directory.path, &library);
    let db = sql.load(&library);
    let run = |command: &str, query: &str, values: Value| {
        ipc_result(
            &sql.webview,
            command,
            json!({"db":db,"query":query,"values":values}),
        )
        .unwrap_or_else(|error| panic!("{query}: {error}"))
    };

    run("execute", "PRAGMA journal_mode=WAL", json!([]));
    run("execute", "PRAGMA busy_timeout=60000", json!([]));
    // One statement per call, as the frontend sends them: a later statement in
    // the same string that needs an earlier one's DDL fails on the guard.
    run(
        "execute",
        "CREATE TABLE images (id TEXT PRIMARY KEY, path TEXT)",
        json!([]),
    );
    run("execute", "CREATE TABLE image_log (id TEXT)", json!([]));
    run(
        "execute",
        "CREATE TRIGGER images_ai AFTER INSERT ON images BEGIN \
           INSERT INTO image_log VALUES (new.id); END;",
        json!([]),
    );
    run(
        "execute",
        "CREATE INDEX IF NOT EXISTS idx_images_path ON images(path)",
        json!([]),
    );
    run(
        "execute",
        "INSERT INTO images (id, path) VALUES (?, ?)",
        json!(["a", "a.png"]),
    );
    assert_eq!(
        run(
            "select",
            "SELECT i.id, l.id AS logged FROM images i JOIN image_log l ON l.id = i.id \
             WHERE i.id IN (SELECT value FROM json_each(?))",
            json!([r#"["a","b"]"#]),
        ),
        json!([{"id":"a","logged":"a"}])
    );

    // Schema changed through execute must be visible to the guard's next check.
    run(
        "execute",
        "ALTER TABLE images ADD COLUMN is_pinned INTEGER DEFAULT 0",
        json!([]),
    );
    run(
        "execute",
        "CREATE INDEX idx_images_pinned ON images(is_pinned)",
        json!([]),
    );
    assert_eq!(
        run(
            "select",
            "SELECT is_pinned FROM images WHERE id = ?",
            json!(["a"])
        ),
        json!([{"is_pinned":0}])
    );
    run("execute", "DROP TABLE image_log", json!([]));
}

#[test]
fn sql_guard_passes_on_sqlites_compile_errors_that_the_frontend_matches() {
    let directory = GeneratedBenchmarkDir::new();
    let library = directory.path.join("library.db");
    let sql = guarded_sql(&directory.path, &library);
    let db = sql.load(&library);
    ipc(
        &sql.webview,
        "execute",
        json!({"db":db,"query":"CREATE TABLE images (id TEXT, is_pinned INTEGER);             CREATE TABLE keyed (k TEXT PRIMARY KEY) WITHOUT ROWID","values":[]}),
    );
    // collectionRepo.ts matches "duplicate column"; sourceReconciliation.ts matches
    // /no such column:\s*rowid/.
    for (query, expected) in [
        (
            "ALTER TABLE images ADD COLUMN is_pinned INTEGER",
            "duplicate column",
        ),
        ("SELECT rowid FROM keyed", "no such column: rowid"),
        ("SELECT missing FROM images", "no such column: missing"),
    ] {
        let error = ipc_result(
            &sql.webview,
            "execute",
            json!({"db":db,"query":query,"values":[]}),
        )
        .expect_err(query);
        assert!(
            error.as_str().is_some_and(|text| text.contains(expected)),
            "{query}: {error}"
        );
    }
}

fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * fraction).round() as usize]
}

#[test]
#[ignore = "opt-in measurement of the SQL guard's per-call cost on a generated 50k-row library"]
fn measure_sql_guard_overhead_on_a_50k_library() {
    const ROWS: usize = 50_000;
    const SAMPLES: usize = 300;
    let directory = GeneratedBenchmarkDir::new();
    let library = directory.path.join("library.db");
    let db = fixture_url(&library);
    {
        let migrated = MockSql::with_builder(
            &directory.path,
            tauri_plugin_sql::Builder::new()
                .add_migrations(&db, crate::db::migrations::get_migrations()),
            &[],
        );
        migrated.load(&library);
        configure_via_ipc(&migrated, &db);
        ipc(&migrated.webview, "close", json!({"db":db}));
    }
    {
        let mut conn = rusqlite::Connection::open(&library).unwrap();
        let tx = conn.transaction().unwrap();
        {
            let mut insert = tx
                .prepare(
                    "INSERT INTO images (id, path, timestamp, positive_prompt) VALUES (?1, ?2, ?3, ?4)",
                )
                .unwrap();
            for index in 0..ROWS {
                insert
                    .execute(rusqlite::params![
                        format!("generated-{index:06}"),
                        format!("C:/library/generated-{index:06}.png"),
                        index as i64,
                        format!("generated prompt {index}"),
                    ])
                    .unwrap();
            }
        }
        tx.commit().unwrap();
    }

    // imageRepo.ts getAllImages: the grid page query with default filters.
    let fields = "images.id, images.path, images.width, images.height, images.file_size, images.timestamp,
        images.thumbnail_path, images.micro_thumbnail, images.thumbnail_source, images.thumbnail_version,
        images.detected_source_kind, images.source_kind_override, images.source_kind,
        images.capture_wall_time_ms, images.display_timestamp,
        images.is_favorite, images.is_pinned, images.is_deleted, images.is_missing, images.is_corrupt,
        images.user_masked, images.group_id, images.board_id, images.notes,
        images.invoke_image_name, images.invoke_image_category, images.invoke_image_origin, images.invoke_owner_id,
        images.is_intermediate_gen, images.is_grid_gen,
        images.model_name, images.model_hash, images.tool, images.resolved_model_name, images.file_hash,
        images.steps, images.seed, images.cfg, images.sampler, images.generation_type,
        images.positive_prompt, images.negative_prompt
        , images.media_type, images.media_container, images.media_mime_type,
        images.duration_ms, images.video_codec, images.video_profile,
        images.audio_present, images.audio_codec, images.frame_rate_num, images.frame_rate_den,
        images.rotation_degrees, images.probe_status, images.playback_status";
    let query = format!(
        "SELECT {fields} FROM scoped_images AS images WHERE invoke_scope_hidden = 0 AND is_deleted = 0 \
         AND IFNULL(is_intermediate_gen, 0) = 0 AND IFNULL(is_grid_gen, 0) = 0 \
         AND IFNULL(is_invoke_asset_gen, 0) = 0 ORDER BY timestamp DESC LIMIT 100 OFFSET 25000"
    );

    let opened = Instant::now();
    let guard = crate::sql_guard::StatementGuard::open(&library).unwrap();
    guard.check(&query).unwrap();
    let first_check_ms = opened.elapsed().as_secs_f64() * 1000.0;
    let mut check_ms: Vec<f64> = (0..SAMPLES)
        .map(|_| {
            let started = Instant::now();
            guard.check(&query).unwrap();
            started.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    drop(guard);

    let measure_selects = |sql: &MockSql| -> Vec<f64> {
        let body = json!({"db":db,"query":query,"values":[]});
        let rows = ipc(&sql.webview, "select", body.clone());
        assert_eq!(rows.as_array().unwrap().len(), 100);
        let mut samples: Vec<f64> = (0..SAMPLES)
            .map(|_| {
                let started = Instant::now();
                ipc(&sql.webview, "select", body.clone());
                started.elapsed().as_secs_f64() * 1000.0
            })
            .collect();
        samples.sort_by(f64::total_cmp);
        samples
    };
    let bare_ms = {
        let bare = MockSql::new(&directory.path);
        bare.load(&library);
        configure_via_ipc(&bare, &db);
        measure_selects(&bare)
    };
    let guarded_ms = {
        let guarded = guarded_sql(&directory.path, &library);
        guarded.load(&library);
        configure_via_ipc(&guarded, &db);
        measure_selects(&guarded)
    };
    check_ms.sort_by(f64::total_cmp);
    println!(
        "SQL_GUARD_OVERHEAD {}",
        json!({
            "rows": ROWS, "samples": SAMPLES, "debug_assertions": cfg!(debug_assertions),
            "query": "imageRepo getAllImages grid page, LIMIT 100 OFFSET 25000",
            "first_check_including_open_ms": first_check_ms,
            "guard_check_ms": {"median": percentile(&check_ms, 0.5), "p95": percentile(&check_ms, 0.95)},
            "bare_select_ipc_ms": {"median": percentile(&bare_ms, 0.5), "p95": percentile(&bare_ms, 0.95)},
            "guarded_select_ipc_ms": {"median": percentile(&guarded_ms, 0.5), "p95": percentile(&guarded_ms, 0.95)},
        })
    );
}

#[test]
fn sql_plugin_bound_json_name_set_preserves_invoke_path_repair_scope() {
    let directory = GeneratedBenchmarkDir::new();
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&directory.path.join("generated-invoke-path-names.db"));
    ipc(
        &sql.webview,
        "execute",
        json!({"db":db,"query":"CREATE TABLE images (image_name TEXT PRIMARY KEY, image_subfolder TEXT, thumbnail_name TEXT, created_at TEXT NOT NULL, user_id TEXT NOT NULL, is_intermediate INTEGER NOT NULL)","values":[]}),
    );
    for (name, owner, intermediate) in [
        ("IMAGE-0000.PNG", "selected", 0),
        ("image-0749.png", "other", 0),
        ("image-1499.png", "selected", 1),
        ("folder\\Mixed.PNG", "selected", 0),
        ("quote'\"name.png", "selected", 0),
        ("not-requested.png", "selected", 0),
    ] {
        ipc(
            &sql.webview,
            "execute",
            json!({"db":db,"query":"INSERT INTO images VALUES (?, NULL, NULL, '2026-01-01', ?, ?)","values":[name,owner,intermediate]}),
        );
    }
    // One JSON bind replaces the former 500-name batches. Names remain data,
    // including quotes and normalized separators, and cannot widen owner scope.
    let mut names: Vec<String> = (0..1500)
        .map(|index| format!("image-{index:04}.png"))
        .collect();
    names.extend(["folder/mixed.png".into(), "quote'\"name.png".into()]);
    let query = r"
        SELECT i.image_name, i.image_subfolder, i.thumbnail_name
        FROM images i
        WHERE LOWER(REPLACE(i.image_name, '\', '/')) IN (SELECT value FROM json_each(?))
          AND i.user_id = ? AND i.is_intermediate = 0
        ORDER BY i.created_at ASC, i.image_name ASC
    ";
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":query,"values":[serde_json::to_string(&names).unwrap(),"selected"]}),
        ),
        json!([
            {"image_name":"IMAGE-0000.PNG","image_subfolder":null,"thumbnail_name":null},
            {"image_name":"folder\\Mixed.PNG","image_subfolder":null,"thumbnail_name":null},
            {"image_name":"quote'\"name.png","image_subfolder":null,"thumbnail_name":null}
        ])
    );
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
        .split("db.select<MaintenanceCountRow[]>(`")
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

// Business regressions retained from the retired diagnostic-only suite.
#[test]
fn maintenance_m80_upgrade_and_reload_preserve_counts() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("maintenance-upgrade.db");
    let db = fixture_url(&path);
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
            "INSERT INTO images(id, path, timestamp, positive_prompt)
             VALUES ('generated', 'generated.png', 1, '')",
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
    let sql = MockSql::with_builder(&directory.path, builder, &[]);
    sql.load(&path);
    let query = maintenance_count_sql();
    let expected = json!([{"untagged":1,"missing":0,"intermediates":0,"trash":0}]);
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":query,
                "values":[]})
        ),
        expected
    );
    let upgraded = ipc(
        &sql.webview,
        "select",
        json!({"db":db,"query":history_query,"values":[]}),
    );
    assert_eq!(
        &upgraded.as_array().unwrap()[..history.as_array().unwrap().len()],
        history.as_array().unwrap()
    );
    assert_eq!(upgraded.as_array().unwrap().last().unwrap()["version"], 85);
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
    ipc(&sql.webview, "close", json!({"db":db}));
}

#[test]
fn preload_migrations_and_replacement_loading_keep_existing_pools_usable() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("preload.db");
    let db = fixture_url(&path);
    let builder = tauri_plugin_sql::Builder::new().add_migrations(
        &db,
        vec![tauri_plugin_sql::Migration {
            version: 1,
            description: "generated sentinel",
            sql: "CREATE TABLE sentinel(value INTEGER); INSERT INTO sentinel VALUES(11);",
            kind: tauri_plugin_sql::MigrationKind::Up,
        }],
    );
    let sql = MockSql::with_builder(&directory.path, builder, &[db.clone()]);
    let old_pool = sql.pool(&db);
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT value FROM sentinel","values":[]})
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
            json!({"db":db,"query":"SELECT version, success FROM _sqlx_migrations","values":[]})
        ),
        json!([{"version":1,"success":1}])
    );
    tauri::async_runtime::block_on(old_pool.close());
    ipc(&sql.webview, "close", json!({"db":db}));
}

#[test]
fn upstream_select_preserves_typed_results_and_errors() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("typed-results.db");
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    assert_eq!(
        ipc(
            &sql.webview,
            "select",
            json!({"db":db,
            "query":"SELECT ? AS empty, ? AS name, ? AS amount, ? AS fraction, 43 AS integer_literal, X'0102' AS bytes",
            "values":[null,"generated",42,1.25]})
        ),
        // The upstream plugin binds JSON numbers as f64, while SQLite integer literals
        // retain INTEGER decoding. Preserve both representations, not just numeric equality.
        json!([{"empty":null,"name":"generated","amount":42.0,"fraction":1.25,"integer_literal":43,"bytes":[1,2]}])
    );
    assert!(ipc_result(
        &sql.webview,
        "select",
        json!({"db":db,"query":"SELECT absent_column","values":[]})
    )
    .is_err());
    ipc(&sql.webview, "close", json!({"db":db}));
}

#[test]
fn close_during_checkout_preserves_upstream_failure_and_completion() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("close-checkout.db");
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    let pool = sql.pool(&db);
    let held = acquire_connections(&pool, 10);
    let view = sql.webview.clone();
    let select_db = db.clone();
    let select = std::thread::spawn(move || {
        ipc_result(
            &view,
            "select",
            json!({"db":select_db,"query":"SELECT 1","values":[]}),
        )
    });
    // With the pool exhausted, the sole registry reader is the pending SELECT.
    // Capture synchronization failures so held leases are released before unwinding.
    let reached_checkout = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        wait_until("select holds registry while awaiting checkout", || {
            sql.app
                .state::<tauri_plugin_sql::DbInstances>()
                .0
                .try_write()
                .is_err()
        });
    }));
    let view = sql.webview.clone();
    let close = std::thread::spawn(move || ipc_result(&view, "close", json!({"db":db})));
    let close_started = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        wait_until("upstream pool close started", || pool.is_closed());
    }));
    let close_waited_for_leases = !close.is_finished();
    drop(held);
    let select_result = select.join().unwrap();
    let close_result = close.join().unwrap();
    assert!(reached_checkout.is_ok());
    assert!(close_started.is_ok());
    assert!(close_waited_for_leases);
    assert!(select_result.is_err());
    assert!(close_result.is_ok());
}
