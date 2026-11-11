//! Restricts `tauri-plugin-sql` to Ambit's own library database.
//!
//! The plugin's `load` command opens any `sqlite:` URL it is given, and an
//! absolute path replaces its app-config base. Its permissions cannot scope the
//! URL, so this wrapper refuses every `load` whose `db` is not the URL that
//! `get_main_database_url` hands the frontend.
//!
//! SQL sent through `select` and `execute` runs on the loaded pool, where
//! `ATTACH` can open and write any existing database and `VACUUM INTO` can
//! create a file. Before the plugin sees such a call, every statement in the
//! query is compiled — never run — on a separate read-only guard connection to
//! the library: SQLite's own parser splits the statements, an authorizer refuses
//! `ATTACH`, `DETACH`, `load_extension()` and the directory pragmas, and a
//! statement whose program contains the `Vacuum` opcode is refused (compiling
//! `VACUUM` never reaches the authorizer). Any statement that fails to compile
//! is refused too, so an `ATTACH` whose expression only resolves on the pool
//! cannot slip past the authorizer.
//!
//! Compiling is not running, so a later statement in one query that depends on
//! an earlier statement's schema change (or on a TEMP object, which lives only
//! on a pool connection) is refused. The frontend sends one statement per call.
//! A schema change made by an earlier call is seen: SQLite reloads the guard's
//! schema when a statement fails against a stale copy.

use rusqlite::{
    ffi,
    hooks::{AuthAction, AuthContext, Authorization},
    limits::Limit,
    Connection, OpenFlags,
};
use serde_json::Value as JsonValue;
use std::{
    ffi::{c_char, c_int, CStr},
    path::{Path, PathBuf},
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{
    ipc::{Invoke, InvokeBody},
    plugin::Plugin,
    webview::PageLoadPayload,
    AppHandle, Manager, RunEvent, Runtime, Url, Webview, Window,
};

const LOAD_REFUSED: &str = "The SQL plugin may open only Ambit's library database.";
const LOAD_UNRESOLVED: &str = "Ambit's library database location could not be resolved.";
const STATEMENT_REFUSED: &str = "The SQL plugin refused this statement.";
const STATEMENT_UNCHECKED: &str = "The SQL plugin could not check this statement.";
/// Validation runs on the IPC thread, so a busy library fails fast and the
/// frontend's existing "database is locked" retries take over.
const GUARD_BUSY_TIMEOUT: Duration = Duration::from_secs(1);

/// The library database the frontend may use: the `load` URL and the file it maps to.
pub struct LibraryDb {
    pub url: String,
    pub path: PathBuf,
}

/// The production library: the URL `get_main_database_url` returns and the
/// file the plugin opens for it.
pub fn library_db(app: &AppHandle) -> Result<LibraryDb, String> {
    let url = crate::db::resolve_main_database_url(app)?;
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = plugin_database_path(&config_dir, &url)?;
    Ok(LibraryDb { url, path })
}

/// The file `tauri-plugin-sql` opens for `url`: the text after the scheme,
/// pushed onto the app config directory (an absolute path replaces it).
fn plugin_database_path(config_dir: &Path, url: &str) -> Result<PathBuf, String> {
    let (_, file) = url
        .split_once(':')
        .ok_or_else(|| format!("not a database URL: {url}"))?;
    Ok(config_dir.join(file))
}

type ResolveLibrary<R> = Box<dyn Fn(&AppHandle<R>) -> Result<LibraryDb, String> + Send + Sync>;

/// Wraps the built SQL plugin: `load` only for the library URL, and `select` /
/// `execute` only for SQL that passes [`StatementGuard::check`].
///
/// Every `Plugin` method except `extend_api` forwards to the inner plugin:
/// `name`, `initialize`, `initialization_script`, `window_created`,
/// `webview_created`, `on_navigation`, `on_page_load` and `on_event`.
/// `initialization_script_2` keeps its default, which wraps the forwarded
/// `initialization_script` (its return type is not re-exported by `tauri`, and
/// the SQL plugin sets no initialization script).
///
/// A method that a future Tauri release adds with a default implementation is
/// not forwarded until it is added here, so recheck the `Plugin` trait on each
/// Tauri minor bump.
pub struct SqlPluginGuard<R: Runtime> {
    inner: Box<dyn Plugin<R>>,
    library: ResolveLibrary<R>,
    statements: Option<StatementGuard>,
}

impl<R: Runtime> SqlPluginGuard<R> {
    pub fn new<P, F>(inner: P, library: F) -> Self
    where
        P: Plugin<R> + 'static,
        F: Fn(&AppHandle<R>) -> Result<LibraryDb, String> + Send + Sync + 'static,
    {
        Self {
            inner: Box::new(inner),
            library: Box::new(library),
            statements: None,
        }
    }

    fn check_load(&self, app: &AppHandle<R>, payload: &InvokeBody) -> Result<(), &'static str> {
        match (self.library)(app) {
            Ok(library) if sql_load_allowed(payload, &library.url) => Ok(()),
            Ok(_) => Err(LOAD_REFUSED),
            Err(error) => {
                log::error!("[SQL] Failed to resolve the library database: {error}");
                Err(LOAD_UNRESOLVED)
            }
        }
    }

    fn check_query(&mut self, app: &AppHandle<R>, payload: &InvokeBody) -> Result<(), String> {
        let Some(query) = query_text(payload) else {
            return Err(STATEMENT_REFUSED.to_string());
        };
        if self.statements.is_none() {
            let opened =
                (self.library)(app).and_then(|library| StatementGuard::open(&library.path));
            match opened {
                Ok(guard) => self.statements = Some(guard),
                Err(error) => {
                    log::error!("[SQL] Failed to open the statement guard: {error}");
                    return Err(STATEMENT_UNCHECKED.to_string());
                }
            }
        }
        let guard = self
            .statements
            .as_ref()
            .expect("statement guard opened above");
        guard.check(query).map_err(Refusal::into_message)
    }
}

/// Whether a `load` request names exactly the allowed connection URL.
/// Anything other than a JSON body with a string `db` equal to `allowed` is refused.
fn sql_load_allowed(payload: &InvokeBody, allowed: &str) -> bool {
    match payload {
        InvokeBody::Json(body) => body.get("db").and_then(JsonValue::as_str) == Some(allowed),
        InvokeBody::Raw(_) => false,
    }
}

fn query_text(payload: &InvokeBody) -> Option<&str> {
    match payload {
        InvokeBody::Json(body) => body.get("query").and_then(JsonValue::as_str),
        InvokeBody::Raw(_) => None,
    }
}

impl<R: Runtime> Plugin<R> for SqlPluginGuard<R> {
    fn name(&self) -> &'static str {
        self.inner.name()
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: JsonValue,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.inner.initialize(app, config)
    }

    fn initialization_script(&self) -> Option<String> {
        self.inner.initialization_script()
    }

    fn window_created(&mut self, window: Window<R>) {
        self.inner.window_created(window)
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.inner.webview_created(webview)
    }

    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.inner.on_navigation(webview, url)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.inner.on_page_load(webview, payload)
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.inner.on_event(app, event)
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        let app = invoke.message.webview().app_handle().clone();
        let refusal = match invoke.message.command() {
            "load" => self
                .check_load(&app, invoke.message.payload())
                .err()
                .map(str::to_string),
            "select" | "execute" => self.check_query(&app, invoke.message.payload()).err(),
            _ => None,
        };
        if let Some(message) = refusal {
            invoke.resolver.reject(message);
            return true;
        }
        self.inner.extend_api(invoke)
    }
}

/// Why a query was refused.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// A guard rule refused it; the reply is generic and echoes nothing.
    Denied,
    /// SQLite could not compile it; its own message is passed on, as the plugin
    /// would have, because frontend code matches some of these messages
    /// (for example "duplicate column" and "no such column").
    Sqlite(String),
}

impl Refusal {
    fn into_message(self) -> String {
        match self {
            Self::Denied => STATEMENT_REFUSED.to_string(),
            Self::Sqlite(message) => format!("SQL refused before execution: {message}"),
        }
    }
}

/// A read-only connection that compiles SQL without running it.
pub(crate) struct StatementGuard {
    conn: Connection,
    /// Set by the authorizer whenever it denies something. SQLite reports some
    /// denials (such as a denied function) as a plain error, not `SQLITE_AUTH`.
    denied: Arc<AtomicBool>,
}

impl StatementGuard {
    pub(crate) fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| error.to_string())?;
        Self::from_connection(conn)
    }

    /// Locks down an open connection. The limit, `query_only` and the
    /// authorizer also stop anything that is ever stepped on this connection.
    pub(crate) fn from_connection(conn: Connection) -> Result<Self, String> {
        conn.busy_timeout(GUARD_BUSY_TIMEOUT)
            .map_err(|error| error.to_string())?;
        // Set before the authorizer, which leaves PRAGMA allowed anyway.
        conn.pragma_update(None, "query_only", true)
            .map_err(|error| error.to_string())?;
        conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0);
        let denied = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&denied);
        conn.authorizer(Some(move |context: AuthContext<'_>| {
            let decision = authorize(context);
            if decision == Authorization::Deny {
                flag.store(true, Ordering::Relaxed);
            }
            decision
        }));
        Ok(Self { conn, denied })
    }

    /// Compiles every statement in `sql`, as SQLite splits them, and refuses the
    /// whole query if any statement fails to compile, trips the authorizer, or
    /// compiles to a program containing the `Vacuum` opcode.
    pub(crate) fn check(&self, sql: &str) -> Result<(), Refusal> {
        self.denied.store(false, Ordering::Relaxed);
        let bytes = sql.as_bytes();
        // SAFETY: the handle stays valid while `self.conn` is borrowed, and this
        // function never closes it.
        let db = unsafe { self.conn.handle() };
        let mut offset = 0;
        while offset < bytes.len() {
            let rest = &bytes[offset..];
            let rest_len = c_int::try_from(rest.len()).map_err(|_| Refusal::Denied)?;
            let mut raw: *mut ffi::sqlite3_stmt = ptr::null_mut();
            let mut tail: *const c_char = ptr::null();
            // SAFETY: `rest` is a live byte slice of `rest_len` bytes; SQLite
            // reads no further and sets `raw` and `tail` before returning.
            let rc = unsafe {
                ffi::sqlite3_prepare_v3(db, rest.as_ptr().cast(), rest_len, 0, &mut raw, &mut tail)
            };
            let statement = PreparedStatement(raw);
            if self.denied.load(Ordering::Relaxed) {
                return Err(Refusal::Denied);
            }
            if rc != ffi::SQLITE_OK {
                return Err(compile_refusal(db, rc));
            }
            let consumed = if tail.is_null() {
                rest.len()
            } else {
                (tail as usize).wrapping_sub(rest.as_ptr() as usize)
            };
            // SQLite stops reading at a NUL, so the loop reaches any interior NUL
            // and consumes nothing there: refusing that also refuses the NUL, the
            // spot where this split and the plugin's could disagree.
            if consumed == 0 || consumed > rest.len() {
                return Err(Refusal::Denied);
            }
            if !statement.0.is_null() {
                reject_vacuum(&statement)?;
            }
            offset += consumed;
        }
        Ok(())
    }
}

/// Finalizes a prepared statement when dropped. Finalizing null is a no-op.
struct PreparedStatement(*mut ffi::sqlite3_stmt);

impl Drop for PreparedStatement {
    fn drop(&mut self) {
        // SAFETY: the pointer came from sqlite3_prepare_v3 and is finalized once.
        unsafe {
            ffi::sqlite3_finalize(self.0);
        }
    }
}

fn compile_refusal(db: *mut ffi::sqlite3, rc: c_int) -> Refusal {
    if rc & 0xff == ffi::SQLITE_AUTH {
        return Refusal::Denied;
    }
    // SAFETY: sqlite3_errmsg returns a NUL-terminated string owned by `db`,
    // copied here before any other call on the connection.
    let message = unsafe { CStr::from_ptr(ffi::sqlite3_errmsg(db)) }
        .to_string_lossy()
        .into_owned();
    Refusal::Sqlite(message)
}

/// Lists the statement's compiled program (EXPLAIN mode, which never runs it)
/// and refuses a `Vacuum` opcode.
fn reject_vacuum(statement: &PreparedStatement) -> Result<(), Refusal> {
    // SAFETY: `statement.0` is a valid, unstepped statement. Stepping happens
    // only after EXPLAIN mode is confirmed, so it yields the opcode listing.
    unsafe {
        if ffi::sqlite3_stmt_explain(statement.0, 1) != ffi::SQLITE_OK {
            return Err(Refusal::Denied);
        }
        loop {
            match ffi::sqlite3_step(statement.0) {
                ffi::SQLITE_ROW => {
                    let opcode = ffi::sqlite3_column_text(statement.0, 1);
                    if !opcode.is_null() && CStr::from_ptr(opcode.cast()).to_bytes() == b"Vacuum" {
                        return Err(Refusal::Denied);
                    }
                }
                ffi::SQLITE_DONE => return Ok(()),
                _ => return Err(Refusal::Denied),
            }
        }
    }
}

fn authorize(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Attach { .. } | AuthAction::Detach { .. } => Authorization::Deny,
        AuthAction::Function { function_name }
            if function_name.eq_ignore_ascii_case("load_extension") =>
        {
            Authorization::Deny
        }
        AuthAction::Pragma { pragma_name, .. }
            if pragma_name.eq_ignore_ascii_case("temp_store_directory")
                || pragma_name.eq_ignore_ascii_case("data_store_directory") =>
        {
            Authorization::Deny
        }
        _ => Authorization::Allow,
    }
}

#[cfg(test)]
mod tests {
    use super::{sql_load_allowed, Refusal, StatementGuard};
    use rusqlite::Connection;
    use serde_json::json;
    use tauri::ipc::InvokeBody;

    const ALLOWED: &str = "sqlite:C:/Users/me/AppData/Local/com.ambit/images.db";

    #[test]
    fn exact_library_url_is_allowed() {
        assert!(sql_load_allowed(
            &InvokeBody::Json(json!({ "db": ALLOWED })),
            ALLOWED
        ));
        assert!(sql_load_allowed(
            &InvokeBody::Json(json!({ "db": ALLOWED, "options": { "autoCreate": false } })),
            ALLOWED
        ));
    }

    #[test]
    fn other_or_malformed_requests_are_refused() {
        let refused = [
            InvokeBody::Json(json!({})),
            InvokeBody::Json(json!({ "db": null })),
            InvokeBody::Json(json!({ "db": 7 })),
            InvokeBody::Json(json!({ "db": [ALLOWED] })),
            InvokeBody::Json(json!(ALLOWED)),
            InvokeBody::Json(json!({ "db": "sqlite:C:/InvokeAI/databases/invokeai.db" })),
            // Spelling variants of the same file are refused too: the plugin keys
            // its pools by the exact string, so only the frontend's URL is needed.
            InvokeBody::Json(json!({ "db": ALLOWED.to_uppercase() })),
            InvokeBody::Json(json!({ "db": ALLOWED.replace('/', "\\") })),
            InvokeBody::Json(json!({ "db": format!("{ALLOWED}?mode=rwc") })),
            InvokeBody::Raw(ALLOWED.as_bytes().to_vec()),
        ];
        for body in refused {
            assert!(
                !sql_load_allowed(&body, ALLOWED),
                "{body:?} must be refused"
            );
        }
    }

    fn guard() -> StatementGuard {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE images (id TEXT PRIMARY KEY, path TEXT, is_deleted INTEGER);
             CREATE VIEW scoped_images AS SELECT * FROM images;",
        )
        .unwrap();
        StatementGuard::from_connection(conn).unwrap()
    }

    #[test]
    fn statements_that_reach_other_files_are_refused() {
        let guard = guard();
        for sql in [
            "ATTACH DATABASE 'C:/x/invokeai.db' AS inv",
            "attach 'C:/x/invokeai.db' as inv; DELETE FROM inv.images; DETACH inv;",
            "SELECT 1; ATTACH 'C:/x/invokeai.db' AS inv",
            "DETACH DATABASE main",
            "VACUUM INTO 'C:/x/copy.db'",
            "/* a */ vAcUuM /* b */ InTo 'C:/x/copy.db'",
            "VACUUM main INTO (SELECT 'C:/x/copy.db')",
            "SELECT 1; VACUUM INTO 'C:/x/copy.db'",
            "SELECT 1;\n-- comment\nVACUUM",
            "EXPLAIN VACUUM INTO 'C:/x/copy.db'",
            "SELECT load_extension('C:/x/evil.dll')",
            "SELECT LOAD_EXTENSION('C:/x/evil.dll', 'entry')",
            "PRAGMA temp_store_directory = 'C:/x'",
            "PRAGMA data_store_directory = 'C:/x'",
            "SELECT 1\0; VACUUM INTO 'C:/x/copy.db'",
        ] {
            assert_eq!(
                guard.check(sql),
                Err(Refusal::Denied),
                "{sql:?} must be refused"
            );
        }
    }

    #[test]
    fn statements_that_fail_to_compile_are_refused_with_sqlites_message() {
        let guard = guard();
        // The ATTACH filename resolves before the authorizer runs, so a table
        // that exists only on the pool (here: nowhere) fails compilation instead.
        let Err(Refusal::Sqlite(message)) = guard.check("ATTACH (SELECT p FROM temp.paths) AS inv")
        else {
            panic!("an uncompilable ATTACH must be refused");
        };
        assert!(message.contains("no such table"), "{message}");

        let Err(Refusal::Sqlite(message)) = guard.check("ALTER TABLE images ADD COLUMN path TEXT")
        else {
            panic!("a duplicate column must be refused");
        };
        assert!(message.contains("duplicate column"), "{message}");

        assert!(matches!(guard.check("SELEC 1"), Err(Refusal::Sqlite(_))));
    }

    #[test]
    fn ordinary_library_statements_are_allowed() {
        let guard = guard();
        for sql in [
            "SELECT id FROM scoped_images AS images WHERE is_deleted = 0 ORDER BY id LIMIT 50 OFFSET 0",
            "SELECT id FROM images WHERE id IN (SELECT value FROM json_each(?))",
            "INSERT INTO images (id, path) VALUES (?, ?)",
            "UPDATE images SET is_deleted = 1 WHERE id = ?",
            "DELETE FROM images WHERE id = ?",
            "CREATE INDEX IF NOT EXISTS idx_images_path ON images(path)",
            "ALTER TABLE images ADD COLUMN is_pinned INTEGER DEFAULT 0",
            "PRAGMA journal_mode=WAL",
            "PRAGMA busy_timeout=60000",
            "SELECT name FROM sqlite_master WHERE type='table'",
            "SELECT 1; SELECT 2;",
            "  -- only a comment\n",
            "",
        ] {
            assert_eq!(guard.check(sql), Ok(()), "{sql:?} must be allowed");
        }
    }

    #[test]
    fn the_guard_connection_cannot_attach_even_if_a_statement_is_run_on_it() {
        let guard = guard();
        let error = guard
            .conn
            .execute_batch("VACUUM INTO 'should-never-exist.db'")
            .expect_err("the backstop must stop VACUUM INTO on the guard connection");
        assert!(
            !std::path::Path::new("should-never-exist.db").exists(),
            "{error}"
        );
    }
}
