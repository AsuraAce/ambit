//! One read-only statement on the library database that a reload or exit stops.
//!
//! The long count reads (collection and smart-collection counts and thumbnails,
//! filter statistics, scope counts) used to run on the SQL plugin's pool. Closing
//! the pool waits for every query it still has checked out, and a reload leaves
//! the old page's reads running, so a burst of slow reads released after a
//! repair kept the window from closing (#431 D notes).
//!
//! [`select_readonly`] runs the statement on its own connection with the
//! [`background_work`] stop epoch, so a page load or an exit request ends it at
//! its next few thousand VM steps. The connection is the SQL plugin guard's own
//! [`StatementGuard`] connection, opened only on the library file the plugin
//! uses: read-only flags, `query_only`, no attached databases, the same
//! authorizer and compile checks as the plugin path, and one statement only.
//! rusqlite never enables extension loading, and the authorizer refuses
//! `load_extension()` as well.

use super::background_work;
use crate::sql_guard::{self, StatementGuard};
use rusqlite::{
    types::{ToSqlOutput, ValueRef},
    ErrorCode, ToSql,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{collections::HashMap, path::Path};

/// The reply when a page load or exit stopped the read. The page that asked has
/// gone or is closing, so nothing shows this to the user.
pub const READ_STOPPED: &str = "Read stopped: the page reloaded or Ambit is closing.";
const BLOB_REFUSED: &str = "select_readonly does not return blob columns.";

/// A bound parameter or a result value: the SQLite types the count reads use.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum SqlValue {
    Null,
    Bool(bool),
    Integer(i64),
    Real(f64),
    Text(String),
}

impl ToSql for SqlValue {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            Self::Null => ToSqlOutput::Borrowed(ValueRef::Null),
            Self::Bool(value) => ToSqlOutput::Borrowed(ValueRef::Integer(i64::from(*value))),
            Self::Integer(value) => ToSqlOutput::Borrowed(ValueRef::Integer(*value)),
            Self::Real(value) => ToSqlOutput::Borrowed(ValueRef::Real(*value)),
            Self::Text(value) => ToSqlOutput::Borrowed(ValueRef::Text(value.as_bytes())),
        })
    }
}

pub type SqlRow = HashMap<String, SqlValue>;

/// Runs one read-only statement on the library database and returns its rows,
/// keyed by column name. A page load or exit after the call started stops it
/// with [`READ_STOPPED`].
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn select_readonly(
    app: tauri::AppHandle,
    sql: String,
    params: Vec<SqlValue>,
) -> Result<Vec<SqlRow>, String> {
    let epoch = background_work::current_epoch();
    let library = sql_guard::library_db(&app)?;
    tauri::async_runtime::spawn_blocking(move || select(&library.path, &sql, &params, epoch))
        .await
        .map_err(|error| error.to_string())?
}

fn select(path: &Path, sql: &str, params: &[SqlValue], epoch: u64) -> Result<Vec<SqlRow>, String> {
    // Work queued by a page that has already gone never opens a connection.
    if background_work::current_epoch() != epoch {
        return Err(READ_STOPPED.to_string());
    }
    run(path, sql, params, epoch)
}

fn run(path: &Path, sql: &str, params: &[SqlValue], epoch: u64) -> Result<Vec<SqlRow>, String> {
    let guard = StatementGuard::open(path)?;
    let conn = guard.connection();
    background_work::stop_when_epoch_changes(conn, epoch);
    guard
        .check_single(sql)
        .map_err(|refusal| refusal.into_message())?;

    let mut statement = conn.prepare(sql).map_err(read_error)?;
    let expected = statement.parameter_count();
    if params.len() != expected {
        return Err(format!(
            "select_readonly expected {expected} parameters, got {}.",
            params.len()
        ));
    }
    for (index, value) in params.iter().enumerate() {
        statement
            .raw_bind_parameter(index + 1, value)
            .map_err(read_error)?;
    }
    let names: Vec<String> = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    let mut rows = statement.raw_query();
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(read_error)? {
        let mut record = SqlRow::with_capacity(names.len());
        for (index, name) in names.iter().enumerate() {
            let value = match row.get_ref(index).map_err(read_error)? {
                ValueRef::Null => SqlValue::Null,
                ValueRef::Integer(value) => SqlValue::Integer(value),
                ValueRef::Real(value) => SqlValue::Real(value),
                ValueRef::Text(text) => SqlValue::Text(String::from_utf8_lossy(text).into_owned()),
                ValueRef::Blob(_) => return Err(BLOB_REFUSED.to_string()),
            };
            record.insert(name.clone(), value);
        }
        out.push(record);
    }
    Ok(out)
}

/// The stop epoch's progress handler fails the statement as interrupted.
fn read_error(error: rusqlite::Error) -> String {
    if error.sqlite_error_code() == Some(ErrorCode::OperationInterrupted) {
        READ_STOPPED.to_string()
    } else {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{run, select, SqlRow, SqlValue, READ_STOPPED};
    use crate::db::background_work::current_epoch;
    use crate::sql_guard::{refused, StatementGuard};
    use rusqlite::Connection;
    use std::path::{Path, PathBuf};

    const LONG_QUERY: &str = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n)
                              SELECT count(*) AS c FROM n";

    /// A WAL library file like the plugin's, removed when dropped.
    struct Library(PathBuf);

    impl Library {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ambit-readonly-{name}-{}-{:?}.db",
                std::process::id(),
                std::thread::current().id()
            ));
            Self::remove(&path);
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 CREATE TABLE images (id TEXT PRIMARY KEY, path TEXT, is_deleted INTEGER, score REAL);
                 CREATE TABLE boards (name TEXT);
                 CREATE VIEW scoped_images AS SELECT * FROM images;
                 INSERT INTO images VALUES ('a', 'C:/a.png', 0, 1.5), ('b', 'C:/b.png', 1, NULL);",
            )
            .unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn rows(&self) -> i64 {
            Connection::open(&self.0)
                .unwrap()
                .query_row("SELECT count(*) FROM images", [], |r| r.get(0))
                .unwrap()
        }

        fn remove(path: &Path) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
            }
        }
    }

    impl Drop for Library {
        fn drop(&mut self) {
            Self::remove(&self.0);
        }
    }

    /// Reads with the current epoch. Another test may move the process-wide
    /// epoch at any moment, which stops this read too, so a stop that coincides
    /// with an epoch change is retried.
    fn read(library: &Library, sql: &str, params: &[SqlValue]) -> Result<Vec<SqlRow>, String> {
        loop {
            let epoch = current_epoch();
            match select(library.path(), sql, params, epoch) {
                Err(error) if error == READ_STOPPED && current_epoch() != epoch => continue,
                result => return result,
            }
        }
    }

    #[test]
    fn returns_typed_rows_keyed_by_column_with_bound_parameters() {
        let library = Library::new("rows");
        let rows = read(
            &library,
            "SELECT id, is_deleted, score, ? AS flag, ? AS missing, ? AS label
             FROM scoped_images WHERE is_deleted = ? ORDER BY id",
            &[
                SqlValue::Bool(true),
                SqlValue::Null,
                SqlValue::Text("x".into()),
                SqlValue::Integer(0),
            ],
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row["id"], SqlValue::Text("a".into()));
        assert_eq!(row["is_deleted"], SqlValue::Integer(0));
        assert_eq!(row["score"], SqlValue::Real(1.5));
        assert_eq!(row["flag"], SqlValue::Integer(1));
        assert_eq!(row["missing"], SqlValue::Null);
        assert_eq!(row["label"], SqlValue::Text("x".into()));
        // A trailing semicolon or comment is still one statement.
        assert!(read(&library, "SELECT 1 AS one; -- done", &[]).is_ok());
    }

    #[test]
    fn runs_the_query_shapes_the_routed_reads_use() {
        // The guard's authorizer must allow what the counts, stats and thumbnail
        // reads need: CTEs, window functions, JSON functions and the FTS5 table.
        let library = Library::new("shapes");
        Connection::open(library.path())
            .unwrap()
            .execute_batch(
                "CREATE VIRTUAL TABLE images_fts USING fts5(positive_prompt);
                 INSERT INTO images_fts(rowid, positive_prompt) VALUES (1, 'a red cat'), (2, 'a dog');",
            )
            .unwrap();
        let rows = read(
            &library,
            "WITH filtered_images AS (SELECT rowid, id FROM images WHERE is_deleted = ?)
             SELECT si.id, images_fts.positive_prompt,
                    ROW_NUMBER() OVER (ORDER BY si.id) AS rank,
                    json_extract('{\"k\": 2}', '$.k') AS k
             FROM filtered_images si
             JOIN images_fts ON images_fts.rowid = si.rowid
             WHERE images_fts.positive_prompt LIKE ?",
            &[SqlValue::Integer(0), SqlValue::Text("%cat%".into())],
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0]["positive_prompt"],
            SqlValue::Text("a red cat".into())
        );
        assert_eq!(rows[0]["rank"], SqlValue::Integer(1));
        assert_eq!(rows[0]["k"], SqlValue::Integer(2));
    }

    #[test]
    fn runs_the_one_pass_smart_summary_shape() {
        // #565: smart collection counts and covers read from one MATERIALIZED CTE that
        // flags each collection's matches with a CASE carrying bound parameters. The
        // guard's authorizer sees a CTE materialization on the read connection; it must
        // not refuse it, and the bound values must reach the flags in order.
        let library = Library::new("one-pass");
        let rows = read(
            &library,
            "WITH hits AS MATERIALIZED (
               SELECT * FROM (
                 SELECT id, score,
                 CASE WHEN (is_deleted = ?) THEN 1 ELSE 0 END AS c0,
                 CASE WHEN (id = ?) THEN 1 ELSE 0 END AS c1
                 FROM scoped_images AS images
               ) WHERE c0 = 1 OR c1 = 1
             )
             SELECT 0 AS k, 'count' AS kind, COUNT(*) AS n, NULL AS score FROM hits WHERE c0 = 1
             UNION ALL
             SELECT * FROM (SELECT 0, 'cover', NULL, score FROM hits WHERE c0 = 1 ORDER BY id DESC LIMIT 1)
             UNION ALL
             SELECT 1 AS k, 'count' AS kind, COUNT(*) AS n, NULL AS score FROM hits WHERE c1 = 1",
            &[SqlValue::Integer(1), SqlValue::Text("a".into())],
        )
        .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["n"], SqlValue::Integer(1));
        assert_eq!(rows[1]["kind"], SqlValue::Text("cover".into()));
        assert_eq!(rows[1]["score"], SqlValue::Null);
        assert_eq!(rows[2]["k"], SqlValue::Integer(1));
        assert_eq!(rows[2]["n"], SqlValue::Integer(1));
        // The read left the library untouched.
        assert_eq!(library.rows(), 2);
    }

    #[test]
    fn values_cross_ipc_as_plain_json() {
        let row: SqlRow = [
            ("n".to_string(), SqlValue::Integer(3)),
            ("t".to_string(), SqlValue::Text("x".into())),
            ("z".to_string(), SqlValue::Null),
        ]
        .into();
        let json = serde_json::to_value(&row).unwrap();
        assert_eq!(json, serde_json::json!({ "n": 3, "t": "x", "z": null }));
        let params: Vec<SqlValue> =
            serde_json::from_value(serde_json::json!([null, true, 7, 2.5, "s"])).unwrap();
        assert_eq!(
            params,
            [
                SqlValue::Null,
                SqlValue::Bool(true),
                SqlValue::Integer(7),
                SqlValue::Real(2.5),
                SqlValue::Text("s".into())
            ]
        );
    }

    /// What the plugin guard itself answers for `sql`.
    fn guard_refusal(library: &Library, sql: &str) -> String {
        StatementGuard::open(library.path())
            .unwrap()
            .check_single(sql)
            .expect_err(sql)
            .into_message()
    }

    #[test]
    fn refuses_everything_the_plugin_guard_refuses() {
        // The error must be the guard's own refusal. ATTACH, TEMP writes and
        // multiple statements would also fail later without the guard (on the
        // ATTACH limit, query_only or rusqlite), which would hide a missing check.
        let library = Library::new("guard");
        // A folder that exists, so only the guard can stop this copy.
        let copy = library.path().with_extension("copy.db");
        let _ = std::fs::remove_file(&copy);
        let extra = [
            format!("VACUUM INTO '{}'", copy.display()),
            "SELECT 1; SELECT 2".to_string(),
        ];
        let listed = refused::REACH_OTHER_FILES
            .iter()
            .chain(refused::ATTACH_FORMS)
            .chain(refused::TEMP_OBJECTS)
            .map(|sql| sql.to_string());
        for sql in listed.chain(extra) {
            let params = vec![SqlValue::Text("C:/x/invokeai.db".into()); sql.matches('?').count()];
            let error = read(&library, &sql, &params).expect_err(&sql);
            assert_eq!(error, guard_refusal(&library, &sql), "{sql:?}");
        }
        assert_eq!(library.rows(), 2, "no refused statement may write");
        let copied = copy.exists();
        let _ = std::fs::remove_file(&copy);
        assert!(!copied, "VACUUM INTO must not copy the library");
        assert!(!Path::new("C:/x/copy.db").exists());
    }

    #[test]
    fn refuses_writes_and_more_than_one_statement() {
        let library = Library::new("writes");
        for sql in [
            "INSERT INTO images (id, path) VALUES ('c', 'C:/c.png')",
            "UPDATE images SET is_deleted = 1",
            "DELETE FROM images",
            "REPLACE INTO images (id) VALUES ('a')",
            "CREATE TABLE extra (v)",
            "DROP TABLE boards",
            "CREATE INDEX idx_path ON images(path)",
            "SELECT 1; SELECT 2",
            "SELECT 1; DELETE FROM images",
            "SELECT id FROM images; DROP TABLE images",
            "",
            "-- only a comment",
        ] {
            assert!(read(&library, sql, &[]).is_err(), "{sql:?} must be refused");
        }
        assert_eq!(library.rows(), 2);
        assert!(read(&library, "SELECT name FROM extra", &[]).is_err());
    }

    #[test]
    fn pragmas_are_no_ops_as_on_the_plugin_guard() {
        // The guard's authorizer skips every pragma (and refuses the directory
        // pragmas), so none can turn query_only off or report settings.
        let library = Library::new("pragmas");
        assert_eq!(read(&library, "PRAGMA query_only", &[]), Ok(vec![]));
        assert_eq!(read(&library, "PRAGMA query_only = 0", &[]), Ok(vec![]));
        assert_eq!(read(&library, "PRAGMA table_info(images)", &[]), Ok(vec![]));
        assert!(read(&library, "PRAGMA temp_store_directory = 'C:/x'", &[]).is_err());
    }

    #[test]
    fn refuses_a_parameter_count_that_does_not_match() {
        let library = Library::new("params");
        let sql = "SELECT id FROM images WHERE is_deleted = ?";
        assert!(read(&library, sql, &[]).is_err());
        assert!(read(&library, sql, &[SqlValue::Integer(0), SqlValue::Integer(1)]).is_err());
    }

    #[test]
    fn never_creates_a_missing_library() {
        let missing =
            std::env::temp_dir().join(format!("ambit-readonly-missing-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&missing);
        assert!(select(&missing, "SELECT 1", &[], current_epoch()).is_err());
        assert!(!missing.exists());
    }

    #[test]
    fn a_read_from_an_earlier_epoch_is_stopped_and_reported_as_stopped() {
        // A stale epoch stands in for a page load or exit after the call began,
        // without moving the process-wide epoch under other tests. The epoch
        // test in background_work covers a change in the middle of a statement.
        let library = Library::new("stopped");
        let stale = current_epoch().wrapping_sub(1);
        assert_eq!(
            select(library.path(), "SELECT 1", &[], stale),
            Err(READ_STOPPED.to_string())
        );
        // Past the early check, the guard connection's progress handler stops
        // the running statement.
        let started = std::time::Instant::now();
        assert_eq!(
            run(library.path(), LONG_QUERY, &[], stale),
            Err(READ_STOPPED.to_string())
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }
}
