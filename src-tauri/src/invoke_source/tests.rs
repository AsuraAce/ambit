//! #364: Ambit must read InvokeAI's database without ever writing InvokeAI's files.
//! Fixtures are generated in temp folders; no real InvokeAI data is touched.

use super::*;
use rusqlite::params;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const WRITER_ENV: &str = "AMBIT_INVOKE_SOURCE_TEST_WRITER_DB";

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    /// An InvokeAI-shaped WAL database, closed cleanly (no -wal or -shm left).
    fn new(name: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "ambit-invoke-source-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("databases")).unwrap();
        let fixture = Self { root };
        let conn = Connection::open(fixture.db()).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE images (
                image_name TEXT PRIMARY KEY,
                image_subfolder TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                width INTEGER, height INTEGER,
                is_intermediate BOOLEAN DEFAULT FALSE,
                starred BOOLEAN DEFAULT FALSE,
                user_id TEXT,
                metadata TEXT,
                thumbnail BLOB
             );
             CREATE TABLE boards (board_id TEXT PRIMARY KEY, board_name TEXT, created_at DATETIME, user_id TEXT);
             CREATE TABLE board_images (board_id TEXT, image_name TEXT);
             INSERT INTO boards VALUES ('b1', 'Board', '2026-01-01 00:00:00.000', 'alice');
             INSERT INTO board_images VALUES ('b1', 'a.png');",
        )
        .unwrap();
        for (index, name) in ["a.png", "b.png", "c.png"].iter().enumerate() {
            conn.execute(
                "INSERT INTO images VALUES (?1, NULL, ?2, ?2, 512, 768, ?3, 0, 'alice', ?4, x'00ff')",
                params![
                    name,
                    format!("2026-01-0{} 00:00:00.000", index + 1),
                    (index == 2) as i64,
                    r#"{"positive_prompt":"a cat"}"#
                ],
            )
            .unwrap();
        }
        drop(conn);
        assert!(!path_exists(&fixture.wal()) && !path_exists(&fixture.shm()));
        fixture
    }

    fn db(&self) -> PathBuf {
        self.root.join("databases").join(INVOKE_DB_FILE_NAME)
    }
    fn wal(&self) -> PathBuf {
        sibling(&self.db(), "-wal")
    }
    fn shm(&self) -> PathBuf {
        sibling(&self.db(), "-shm")
    }

    fn snapshot(&self) -> Vec<Option<(Vec<u8>, SystemTime)>> {
        [self.db(), self.wal(), self.shm()]
            .iter()
            .map(|path| {
                fs::metadata(path)
                    .ok()
                    .map(|metadata| (fs::read(path).unwrap(), metadata.modified().unwrap()))
            })
            .collect()
    }

    fn select(
        &self,
        sql: &str,
        params: &[Option<InvokeSourceValue>],
    ) -> Result<InvokeSourceRows, String> {
        let db = resolve_scoped_invoke_db(&self.root.to_string_lossy(), |path| {
            path.starts_with(&self.root)
        })?;
        select_read_only(&db, sql, params)
    }

    fn image_names(&self) -> Vec<String> {
        self.select("SELECT image_name FROM images ORDER BY image_name", &[])
            .unwrap()
            .rows
            .into_iter()
            .map(|row| match &row[0] {
                Some(InvokeSourceValue::Text(name)) => name.clone(),
                other => panic!("unexpected image name {other:?}"),
            })
            .collect()
    }

    /// The source reads one sync pass makes: discovery, fingerprint, boards and images.
    fn read_like_sync(&self) {
        let owner = [Some(InvokeSourceValue::Text("alice".to_string()))];
        let reads: [(&str, &[Option<InvokeSourceValue>]); 8] = [
            ("SELECT name FROM sqlite_master WHERE type='table'", &[]),
            ("PRAGMA table_info(images)", &[]),
            ("SELECT CAST(user_id AS TEXT) AS owner_id, count(*) AS count FROM images GROUP BY user_id", &[]),
            ("SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM images WHERE user_id = ?", &owner),
            ("SELECT b.board_id, b.board_name, b.created_at, b.user_id FROM boards b WHERE b.user_id = ?", &owner),
            ("SELECT bi.image_name, bi.board_id FROM board_images bi INNER JOIN boards b ON b.board_id = bi.board_id AND b.user_id = ?", &owner),
            ("SELECT i.image_name, i.metadata AS metadata_blob, i.created_at, i.width, i.height, i.is_intermediate FROM images i ORDER BY i.created_at ASC LIMIT 500 OFFSET 0", &[]),
            ("SELECT image_name FROM images WHERE is_intermediate = 1", &[]),
        ];
        for (sql, params) in reads {
            self.select(sql, params)
                .unwrap_or_else(|error| panic!("{sql}: {error}"));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Generated temp folder only; it contains no links.
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A second process standing in for a running InvokeAI. SQLite shares
/// shared-memory nodes inside one process, so an in-process writer would not
/// exercise `readonly_shm` the way a real InvokeAI does.
struct Writer {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Writer {
    fn spawn(db: &Path, mode: &str) -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "invoke_source::tests::writer_process",
                "--exact",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(WRITER_ENV, db)
            .env("AMBIT_INVOKE_SOURCE_TEST_WRITER_MODE", mode)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut writer = Self {
            child,
            stdin,
            stdout,
        };
        writer.wait_for("WRITER_READY");
        writer
    }

    fn wait_for(&mut self, marker: &str) {
        let mut line = String::new();
        loop {
            line.clear();
            assert!(
                self.stdout.read_line(&mut line).unwrap() > 0,
                "writer exited before {marker}"
            );
            // libtest prints "test <name> ... " without a newline before the test body runs.
            if line.contains(marker) {
                return;
            }
        }
    }

    fn send(&mut self, command: &str, marker: &str) {
        writeln!(self.stdin, "{command}").unwrap();
        self.stdin.flush().unwrap();
        self.wait_for(marker);
    }

    fn finish(mut self) {
        let _ = writeln!(self.stdin, "exit");
        let _ = self.stdin.flush();
        assert!(self.child.wait().unwrap().success());
    }
}

#[test]
#[ignore = "child process for the live-writer tests"]
fn writer_process() {
    let Ok(db) = std::env::var(WRITER_ENV) else {
        return;
    };
    let mode = std::env::var("AMBIT_INVOKE_SOURCE_TEST_WRITER_MODE").unwrap_or_default();
    let conn = Connection::open(&db).unwrap();
    // Keep commits in the WAL so a reader that ignored it would miss them.
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    let insert = |name: &str| {
        conn.execute(
            "INSERT INTO images VALUES (?1, NULL, '2026-02-01 00:00:00.000', '2026-02-01 00:00:00.000', 1, 1, 0, 0, 'alice', NULL, NULL)",
            [name],
        )
        .unwrap();
    };
    insert("live-1.png");
    if mode == "crash" {
        // Leave -wal and -shm behind, as a crashed InvokeAI does.
        println!("WRITER_READY");
        std::mem::forget(conn);
        std::process::exit(0);
    }
    println!("WRITER_READY");
    for line in std::io::stdin().lock().lines() {
        match line.unwrap().trim() {
            "commit" => {
                insert("live-2.png");
                println!("WRITER_COMMITTED");
            }
            _ => break,
        }
    }
}

#[test]
fn clean_closed_source_is_read_without_creating_or_changing_files() {
    let fixture = Fixture::new("clean");
    let before = fixture.snapshot();

    fixture.read_like_sync();

    assert_eq!(fixture.image_names(), ["a.png", "b.png", "c.png"]);
    assert_eq!(fixture.snapshot(), before);
    assert!(!path_exists(&fixture.wal()) && !path_exists(&fixture.shm()));
}

#[test]
fn live_writer_is_read_fresh_without_changing_db_wal_or_shm() {
    let fixture = Fixture::new("live");
    let mut writer = Writer::spawn(&fixture.db(), "live");
    assert!(path_exists(&fixture.wal()) && path_exists(&fixture.shm()));

    let before = fixture.snapshot();
    fixture.read_like_sync();
    // live-1 exists only in the WAL: the reader follows the running writer.
    assert_eq!(
        fixture.image_names(),
        ["a.png", "b.png", "c.png", "live-1.png"]
    );
    assert_eq!(fixture.snapshot(), before);

    writer.send("commit", "WRITER_COMMITTED");
    let after_commit = fixture.snapshot();
    assert_eq!(
        fixture.image_names(),
        ["a.png", "b.png", "c.png", "live-1.png", "live-2.png"]
    );
    fixture.read_like_sync();
    assert_eq!(fixture.snapshot(), after_commit);

    writer.finish();
}

#[test]
fn crash_leftovers_are_read_without_changing_db_wal_or_shm() {
    let fixture = Fixture::new("crash");
    Writer::spawn(&fixture.db(), "crash").finish();
    assert!(path_exists(&fixture.wal()) && path_exists(&fixture.shm()));
    let before = fixture.snapshot();

    fixture.read_like_sync();

    assert_eq!(
        fixture.image_names(),
        ["a.png", "b.png", "c.png", "live-1.png"]
    );
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn wal_without_shm_is_refused_without_creating_shm() {
    let fixture = Fixture::new("wal-no-shm");
    Writer::spawn(&fixture.db(), "crash").finish();
    fs::remove_file(fixture.shm()).unwrap();
    let before = fixture.snapshot();

    let error = fixture.select("SELECT 1", &[]).unwrap_err();

    assert!(error.contains("no shared-memory file"), "{error}");
    assert_eq!(fixture.snapshot(), before);
    assert!(!path_exists(&fixture.shm()));
}

// An InvokeAI shutdown racing a WalLive open can leave an empty -wal; it must not
// block later reads, and reading it must change nothing.
#[test]
fn empty_wal_without_shm_is_read_as_a_snapshot() {
    let fixture = Fixture::new("empty-wal");
    fs::write(fixture.wal(), b"").unwrap();
    let before = fixture.snapshot();

    fixture.read_like_sync();

    assert_eq!(fixture.image_names(), ["a.png", "b.png", "c.png"]);
    assert_eq!(fixture.snapshot(), before);
    assert!(!path_exists(&fixture.shm()));
}

// Each statement below passes the read-only open and `readonly()`, so only the
// named layer refuses it.
#[test]
fn authorizer_tail_check_and_attach_limit_each_refuse_on_their_own() {
    let fixture = Fixture::new("layers");
    let before = fixture.snapshot();
    for sql in [
        "SELECT * FROM pragma_journal_mode()",
        "SELECT * FROM pragma_database_list",
        "PRAGMA user_version",
        "PRAGMA query_only=0",
    ] {
        let error = fixture.select(sql, &[]).unwrap_err();
        assert!(error.contains("not authorized"), "{sql:?}: {error}");
    }
    let error = fixture.select("SELECT 1; SELECT 2", &[]).unwrap_err();
    assert!(error.contains("exactly one statement"), "{error}");

    let attach_target = fixture.root.join("other.db");
    let conn = open_read_only(&fixture.db()).unwrap();
    conn.authorizer(Some(|_: AuthContext<'_>| Authorization::Allow));
    let attach = format!("ATTACH '{}' AS other", attach_target.to_string_lossy());
    let error = run_select(&conn, &attach, &[]).unwrap_err();
    assert!(error.contains("too many attached databases"), "{error}");
    drop(conn);

    assert_eq!(fixture.snapshot(), before);
    assert!(!path_exists(&attach_target));
}

#[test]
fn writes_attaches_pragmas_and_extra_statements_are_rejected() {
    let fixture = Fixture::new("reject");
    let before = fixture.snapshot();
    let attach_target = fixture.root.join("other.db");
    let attach = format!("ATTACH '{}' AS other", attach_target.to_string_lossy());
    let rejected = [
        "INSERT INTO images (image_name, created_at, updated_at) VALUES ('x', '', '')",
        "UPDATE images SET width = 1",
        "DELETE FROM images",
        "CREATE TABLE ambit (x)",
        "PRAGMA journal_mode=DELETE",
        "PRAGMA wal_checkpoint(TRUNCATE)",
        "PRAGMA query_only=0",
        "BEGIN IMMEDIATE",
        "VACUUM",
        "ANALYZE",
        attach.as_str(),
        "SELECT 1; DELETE FROM images",
        "SELECT 1; SELECT 2",
        "",
    ];
    for sql in rejected {
        assert!(fixture.select(sql, &[]).is_err(), "{sql:?} was accepted");
    }

    assert_eq!(fixture.snapshot(), before);
    assert!(!path_exists(&attach_target));
    assert!(!path_exists(&fixture.wal()) && !path_exists(&fixture.shm()));
    // A trailing semicolon or whitespace is still one statement.
    assert!(fixture.select("SELECT 1; \n", &[]).is_ok());
}

#[test]
fn writes_are_rejected_while_a_writer_is_live() {
    let fixture = Fixture::new("reject-live");
    let writer = Writer::spawn(&fixture.db(), "live");
    let before = fixture.snapshot();

    for sql in [
        "DELETE FROM images",
        "PRAGMA wal_checkpoint(TRUNCATE)",
        "PRAGMA journal_mode=DELETE",
    ] {
        assert!(fixture.select(sql, &[]).is_err(), "{sql:?} was accepted");
    }

    assert_eq!(fixture.snapshot(), before);
    writer.finish();
}

#[test]
fn only_an_invokeai_database_inside_the_scope_is_opened() {
    let fixture = Fixture::new("scope");
    let root = fixture.root.to_string_lossy().to_string();

    let outside = resolve_scoped_invoke_db(&root, |_| false).unwrap_err();
    assert!(
        outside.contains("outside the allowed filesystem scope"),
        "{outside}"
    );

    fs::write(fixture.root.join("other.db"), b"").unwrap();
    let other_db = fixture.root.join("other.db").to_string_lossy().to_string();
    assert!(resolve_scoped_invoke_db(&other_db, |_| true).is_err());
    assert!(resolve_scoped_invoke_db("databases/invokeai.db", |_| true).is_err());
    assert!(resolve_scoped_invoke_db(" ", |_| true).is_err());

    assert_eq!(
        resolve_scoped_invoke_db(&root, |_| true).unwrap(),
        fixture.db()
    );
    let db_path = fixture.db().to_string_lossy().to_string();
    assert_eq!(
        resolve_scoped_invoke_db(&db_path, |_| true).unwrap(),
        fixture.db()
    );
}

#[test]
fn a_linked_invokeai_database_is_refused_even_inside_the_scope() {
    // A link named invokeai.db could redirect reads to another database, so only a
    // regular file is opened.
    let fixture = Fixture::new("link");
    let folder_root = fixture.root.join("folder");
    fs::create_dir_all(folder_root.join("databases").join(INVOKE_DB_FILE_NAME)).unwrap();
    let refused = resolve_scoped_invoke_db(&folder_root.to_string_lossy(), |_| true).unwrap_err();
    assert!(refused.contains("regular file"), "{refused}");

    let linked_root = fixture.root.join("linked");
    fs::create_dir_all(linked_root.join("databases")).unwrap();
    let link = linked_root.join("databases").join(INVOKE_DB_FILE_NAME);
    #[cfg(unix)]
    let created = std::os::unix::fs::symlink(fixture.db(), &link);
    #[cfg(windows)]
    let created = std::os::windows::fs::symlink_file(fixture.db(), &link);
    if let Err(error) = created {
        eprintln!(
            "Skipping linked invokeai.db coverage because file link creation failed: {error}"
        );
        return;
    }

    let refused = resolve_scoped_invoke_db(&linked_root.to_string_lossy(), |_| true).unwrap_err();
    assert!(refused.contains("regular file"), "{refused}");
}

#[test]
fn an_invokeai_folder_at_a_drive_root_gets_a_clear_error() {
    // Ambit never adds a filesystem root to its scope, so say why instead of
    // reporting a scope failure.
    let fs_root = std::env::temp_dir()
        .ancestors()
        .last()
        .unwrap()
        .to_path_buf();
    let root = fs_root.to_string_lossy().to_string();
    let candidates = [
        root.clone(),
        fs_root.join("databases").to_string_lossy().to_string(),
        fs_root
            .join("databases")
            .join(INVOKE_DB_FILE_NAME)
            .to_string_lossy()
            .to_string(),
        "/".to_string(),
        "\\".to_string(),
        "/databases".to_string(),
        "E:\\".to_string(),
    ];
    for candidate in candidates {
        let refused = resolve_scoped_invoke_db(&candidate, |_| true).unwrap_err();
        assert!(
            refused.contains("root of a drive is not supported"),
            "{candidate}: {refused}"
        );
    }

    // A drive-relative path is relative, not a drive root.
    let relative = resolve_scoped_invoke_db("E:databases", |_| true).unwrap_err();
    assert!(
        relative.contains("must name an InvokeAI folder"),
        "{relative}"
    );

    let fixture = Fixture::new("not-root");
    assert!(resolve_scoped_invoke_db(&fixture.root.to_string_lossy(), |_| true).is_ok());
}

#[test]
fn values_keep_their_types_and_binary_data_is_not_returned() {
    let fixture = Fixture::new("values");
    let rows = fixture
        .select(
            "SELECT width, 1.5 AS ratio, image_name, image_subfolder, thumbnail, is_intermediate FROM images WHERE image_name = ?",
            &[Some(InvokeSourceValue::Text("c.png".to_string()))],
        )
        .unwrap();

    assert_eq!(
        rows.columns,
        [
            "width",
            "ratio",
            "image_name",
            "image_subfolder",
            "thumbnail",
            "is_intermediate"
        ]
    );
    assert_eq!(
        rows.rows,
        [vec![
            Some(InvokeSourceValue::Integer(512)),
            Some(InvokeSourceValue::Real(1.5)),
            Some(InvokeSourceValue::Text("c.png".to_string())),
            None,
            None,
            Some(InvokeSourceValue::Integer(1)),
        ]]
    );
}

#[test]
fn rollback_journal_source_is_read_without_creating_files() {
    let fixture = Fixture::new("rollback");
    Connection::open(fixture.db())
        .unwrap()
        .execute_batch("PRAGMA journal_mode=DELETE;")
        .unwrap();
    let before = fixture.snapshot();

    fixture.read_like_sync();

    assert_eq!(fixture.snapshot(), before);
    assert!(!path_exists(&sibling(&fixture.db(), "-journal")));
}

#[test]
fn file_uri_escapes_query_characters_and_windows_prefixes() {
    assert_eq!(
        sqlite_file_uri(Path::new(r"\\?\D:\A b\x?#%\invokeai.db"), "mode=ro"),
        "file:///D:/A b/x%3F%23%25/invokeai.db?mode=ro"
    );
    assert_eq!(
        sqlite_file_uri(Path::new(r"\\?\UNC\server\share\invokeai.db"), "mode=ro"),
        "file:////server/share/invokeai.db?mode=ro"
    );
    assert_eq!(
        sqlite_file_uri(Path::new("/home/u/invokeai.db"), "mode=ro"),
        "file:///home/u/invokeai.db?mode=ro"
    );
}

/// Measures the cost of a fresh connection per query on a large source.
/// Run with `cargo test --lib invoke_source_per_query_open_cost -- --ignored --nocapture`.
#[test]
#[ignore = "timing measurement, not a correctness check"]
fn invoke_source_per_query_open_cost() {
    let fixture = Fixture::new("cost");
    {
        let conn = Connection::open(fixture.db()).unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        for index in 0..150_000 {
            tx.execute(
                "INSERT INTO images VALUES (?1, NULL, '2026-03-01 00:00:00.000', '2026-03-01 00:00:00.000', 1, 1, 0, 0, 'alice', ?2, NULL)",
                params![format!("bulk-{index:06}.png"), "x".repeat(2_000)],
            )
            .unwrap();
        }
        tx.commit().unwrap();
    }
    let db = fixture.db();
    let page = |offset: usize| {
        format!("SELECT image_name, metadata AS metadata_blob, created_at FROM images ORDER BY created_at, image_name LIMIT 500 OFFSET {offset}")
    };
    // A full sync of this source pages 301 times; the page query itself costs the
    // same either way, so sample a few pages and time every open separately.
    let pages = 150_003usize.div_ceil(500);
    let sample = [0, 150, 300];

    let started = Instant::now();
    for index in sample {
        select_read_only(&db, &page(index * 500), &[]).unwrap();
    }
    let per_query = started.elapsed();

    let conn = open_read_only(&db).unwrap();
    let started = Instant::now();
    for index in sample {
        run_select(&conn, &page(index * 500), &[]).unwrap();
    }
    let one_connection = started.elapsed();
    drop(conn);

    let time_opens = || {
        let started = Instant::now();
        for _ in 0..pages {
            drop(open_read_only(&db).unwrap());
        }
        started.elapsed()
    };
    let snapshot_opens = time_opens();
    let writer = Writer::spawn(&db, "live");
    let live_opens = time_opens();
    writer.finish();

    println!(
        "pages={pages} sampled_pages(per_query_open={per_query:?} one_connection={one_connection:?}) opens_for_full_sync(snapshot={snapshot_opens:?} live={live_opens:?})"
    );
}
