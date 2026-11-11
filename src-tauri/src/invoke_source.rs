//! Read-only access to InvokeAI's own `invokeai.db`.
//!
//! Ambit only reads from InvokeAI, so this path never writes InvokeAI's files:
//! not the database, not its `-wal`, and not its `-shm`. One race remains: if
//! InvokeAI shuts down between the mode check and a `WalLive` read, SQLite opens
//! the `-wal` with create and leaves an empty one; that query fails, and the next
//! one reads the empty WAL as a snapshot. The webview supplies the
//! SQL, so the connection is also locked down to one plain `SELECT` (or
//! `PRAGMA table_info`) over the InvokeAI database itself.

use crate::fs_commands::resolve_invoke_db_path;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::limits::Limit;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Batch, Connection, OpenFlags};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

const INVOKE_DB_FILE_NAME: &str = "invokeai.db";

/// A value read from, or bound into, an InvokeAI query.
#[derive(serde::Serialize, serde::Deserialize, specta::Type, Debug, Clone, PartialEq)]
#[serde(untagged)]
pub enum InvokeSourceValue {
    Integer(i64),
    Real(f64),
    Text(String),
}

#[derive(serde::Serialize, specta::Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvokeSourceRows {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<InvokeSourceValue>>>,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn select_invoke_source(
    app: tauri::AppHandle,
    root_path: String,
    sql: String,
    params: Vec<Option<InvokeSourceValue>>,
) -> Result<InvokeSourceRows, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_scoped_invoke_db(&root_path, |path| app.fs_scope().is_allowed(path))?;
        select_read_only(&db_path, &sql, &params)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Resolves the configured InvokeAI path to its `invokeai.db`. The caller can only
/// name an InvokeAI folder (or its `invokeai.db`), never another database file.
fn resolve_scoped_invoke_db<F>(root_path: &str, mut is_allowed: F) -> Result<PathBuf, String>
where
    F: FnMut(&Path) -> bool,
{
    if root_path.trim().is_empty() {
        return Err("No InvokeAI path provided.".to_string());
    }
    let db_path = resolve_invoke_db_path(root_path);
    if is_at_filesystem_root(&db_path) {
        return Err(
            "InvokeAI at the root of a drive is not supported. Move it into a subfolder, or point Ambit at a subfolder that contains InvokeAI's databases folder."
                .to_string(),
        );
    }
    let is_invoke_db = db_path.file_name().is_some_and(|name| {
        name.to_string_lossy()
            .eq_ignore_ascii_case(INVOKE_DB_FILE_NAME)
    });
    if !is_invoke_db || !db_path.is_absolute() {
        return Err("InvokeAI path must name an InvokeAI folder or its invokeai.db.".to_string());
    }
    if !is_allowed(&db_path) {
        return Err(format!(
            "InvokeAI database is outside the allowed filesystem scope: {}",
            db_path.to_string_lossy()
        ));
    }
    let metadata = fs::symlink_metadata(&db_path)
        .map_err(|_| "Could not find an existing InvokeAI database at this path.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("InvokeAI database must be an existing regular file.".to_string());
    }
    Ok(db_path)
}

/// True when the InvokeAI folder is a filesystem root such as `E:\`. Ambit never
/// adds a filesystem root to its scope, so such a folder can never be read.
fn is_at_filesystem_root(db_path: &Path) -> bool {
    let Some(mut root) = db_path.parent() else {
        return true;
    };
    if root
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("databases"))
    {
        let Some(parent) = root.parent() else {
            return true;
        };
        root = parent;
    }
    // An empty root is a relative path, which is refused later with its own error.
    !root.as_os_str().is_empty() && root.parent().is_none()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceOpenMode {
    /// Rollback-journal database: a read-only connection only takes shared locks.
    RollbackReadOnly,
    /// WAL database with no `-wal` file, or an empty one and no `-shm`: no WAL
    /// connection is open and every commit is in the main file, so it is read as
    /// an immutable snapshot.
    WalSnapshot,
    /// WAL database with `-wal` and `-shm`: InvokeAI is running or exited without
    /// cleanup. `readonly_shm` reads the WAL without writing the wal-index.
    WalLive,
}

impl SourceOpenMode {
    fn uri_query(self) -> &'static str {
        match self {
            Self::RollbackReadOnly => "mode=ro",
            Self::WalSnapshot => "mode=ro&immutable=1",
            Self::WalLive => "mode=ro&readonly_shm=1",
        }
    }
}

fn sibling(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn choose_open_mode(db_path: &Path) -> Result<SourceOpenMode, String> {
    let mut header = [0u8; 20];
    File::open(db_path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|error| format!("Could not read the InvokeAI database: {error}"))?;
    if &header[..16] != b"SQLite format 3\0" {
        return Err("This file is not a SQLite database.".to_string());
    }
    // Bytes 18 and 19 are the file-format write and read versions; 2 means WAL.
    if header[18] != 2 || header[19] != 2 {
        return Ok(SourceOpenMode::RollbackReadOnly);
    }
    let wal_len = fs::symlink_metadata(sibling(db_path, "-wal")).map(|metadata| metadata.len());
    match (wal_len, path_exists(&sibling(db_path, "-shm"))) {
        (Err(_), _) => Ok(SourceOpenMode::WalSnapshot),
        (Ok(_), true) => Ok(SourceOpenMode::WalLive),
        // An empty WAL holds no commits. It can be left by an InvokeAI shutdown
        // that races a read opening in WalLive mode.
        (Ok(0), false) => Ok(SourceOpenMode::WalSnapshot),
        // Reading would either create -shm or ignore committed rows in the WAL.
        // InvokeAI also passes through this state briefly while it shuts down.
        (Ok(_), false) => Err(
            "InvokeAI's database has a write-ahead log but no shared-memory file. Try again; if this persists, open and close InvokeAI once."
                .to_string(),
        ),
    }
}

fn sqlite_file_uri(path: &Path, query: &str) -> String {
    let mut text = path.to_string_lossy().replace('\\', "/");
    if let Some(rest) = text.strip_prefix("//?/UNC/") {
        text = format!("//{rest}");
    } else if let Some(rest) = text.strip_prefix("//?/") {
        text = rest.to_string();
    }
    let mut encoded = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '%' => encoded.push_str("%25"),
            '?' => encoded.push_str("%3F"),
            '#' => encoded.push_str("%23"),
            _ => encoded.push(character),
        }
    }
    let prefix = if encoded.starts_with('/') {
        "file://"
    } else {
        "file:///"
    };
    format!("{prefix}{encoded}?{query}")
}

fn authorize(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Select | AuthAction::Read { .. } | AuthAction::Function { .. } => {
            Authorization::Allow
        }
        // Schema discovery; table_info has no form that changes anything.
        AuthAction::Pragma { pragma_name, .. }
            if pragma_name.eq_ignore_ascii_case("table_info") =>
        {
            Authorization::Allow
        }
        _ => Authorization::Deny,
    }
}

fn open_read_only(db_path: &Path) -> Result<Connection, String> {
    let mode = choose_open_mode(db_path)?;
    let conn = Connection::open_with_flags(
        sqlite_file_uri(db_path, mode.uri_query()),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Could not open the InvokeAI database read-only: {error}"))?;
    // Belt and braces over the read-only open; set before the authorizer denies PRAGMA.
    conn.pragma_update(None, "query_only", true)
        .map_err(|error| error.to_string())?;
    conn.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0);
    conn.authorizer(Some(authorize));
    Ok(conn)
}

fn to_source_value(value: ValueRef<'_>) -> Option<InvokeSourceValue> {
    match value {
        ValueRef::Null => None,
        ValueRef::Integer(number) => Some(InvokeSourceValue::Integer(number)),
        ValueRef::Real(number) => Some(InvokeSourceValue::Real(number)),
        ValueRef::Text(bytes) => std::str::from_utf8(bytes)
            .ok()
            .map(|text| InvokeSourceValue::Text(text.to_owned())),
        // No current InvokeAI read needs binary data.
        ValueRef::Blob(_) => None,
    }
}

fn to_sql_value(param: &Option<InvokeSourceValue>) -> Value {
    match param {
        None => Value::Null,
        Some(InvokeSourceValue::Integer(number)) => Value::Integer(*number),
        Some(InvokeSourceValue::Real(number)) => Value::Real(*number),
        Some(InvokeSourceValue::Text(text)) => Value::Text(text.clone()),
    }
}

fn run_select(
    conn: &Connection,
    sql: &str,
    params: &[Option<InvokeSourceValue>],
) -> Result<InvokeSourceRows, String> {
    let mut batch = Batch::new(conn, sql);
    let mut statement = batch
        .next()
        .map_err(|error| format!("InvokeAI query was rejected: {error}"))?
        .ok_or_else(|| "InvokeAI query is empty.".to_string())?;
    if !matches!(batch.next(), Ok(None)) {
        return Err("InvokeAI query must be exactly one statement.".to_string());
    }
    if !statement.readonly() {
        return Err("InvokeAI query must only read.".to_string());
    }

    let columns: Vec<String> = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect();
    let mut query = statement
        .query(rusqlite::params_from_iter(params.iter().map(to_sql_value)))
        .map_err(|error| error.to_string())?;
    let mut rows = Vec::new();
    while let Some(row) = query.next().map_err(|error| error.to_string())? {
        let mut values = Vec::with_capacity(columns.len());
        for index in 0..columns.len() {
            values.push(to_source_value(
                row.get_ref(index).map_err(|error| error.to_string())?,
            ));
        }
        rows.push(values);
    }
    Ok(InvokeSourceRows { columns, rows })
}

/// Opens a fresh read-only connection for each query, so the open mode always
/// follows InvokeAI's current state and no handle outlives the read.
fn select_read_only(
    db_path: &Path,
    sql: &str,
    params: &[Option<InvokeSourceValue>],
) -> Result<InvokeSourceRows, String> {
    let conn = open_read_only(db_path)?;
    run_select(&conn, sql, params)
}

#[cfg(test)]
mod tests;
