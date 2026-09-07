//! Opt-in, direct read-only SQLite investigation. Never loaded by the application.
use rusqlite::{types::Value, Connection, OpenFlags};
use serde_json::{json, Value as Json};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Barrier,
    },
    time::{Duration, Instant, SystemTime},
};

const DEV_PATH: &str = "C:/Users/Artemis/AppData/Roaming/com.ambit.dev/images.db";
const BUDGET: Duration = Duration::from_secs(15 * 60);
const QUERY_LIMIT: Duration = Duration::from_secs(60);
const REPORT_LIMIT: usize = 256 * 1024;
const TERMINAL_RESERVE: usize = 8 * 1024;
const SIDECAR_POLICY_VERSION: u8 = 2;
const LABELS: [&str; 4] = [
    "collection",
    "maintenance",
    "default-visible-gallery",
    "global-gallery",
];
const SEARCH: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/services/db/searchRepo.ts"
));
const COLLECTION: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/services/db/collectionRepo.ts"
));
const MAINTENANCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/services/db/maintenanceRepo.ts"
));

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Failure {
    InvalidTarget,
    AppRunning,
    ProcessUnavailable,
    UnsupportedLayout,
    Open,
    Query,
    Timeout,
    Changed,
    Mismatch,
    Storage,
    Drift,
    Provenance,
    Worker,
}
impl Failure {
    fn label(self) -> &'static str {
        match self {
            Self::InvalidTarget => "invalid-target",
            Self::AppRunning => "app-running",
            Self::ProcessUnavailable => "process-check-unavailable",
            Self::UnsupportedLayout => "unsupported-read-only-layout",
            Self::Open => "read-only-open-failed",
            Self::Query => "query-failed",
            Self::Timeout => "timed-out",
            Self::Changed => "catalog-changed",
            Self::Mismatch => "result-mismatch",
            Self::Storage => "storage-unavailable",
            Self::Drift => "query-drift",
            Self::Provenance => "provenance-unavailable",
            Self::Worker => "worker-failed",
        }
    }
}
type ProbeResult<T> = Result<T, Failure>;

fn digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn between<'a>(source: &'a str, prefix: &str, end: char) -> ProbeResult<&'a str> {
    source
        .split_once(prefix)
        .and_then(|(_, value)| value.split_once(end).map(|(part, _)| part))
        .ok_or(Failure::Drift)
}

fn queries() -> ProbeResult<[String; 4]> {
    let count_source = SEARCH
        .split_once("export const countImages =")
        .and_then(|(_, source)| {
            source
                .split_once("export const countGlobalImages =")
                .map(|(body, _)| body)
        })
        .ok_or(Failure::Drift)?;
    let base = between(SEARCH, "const BASE_VISIBLE_WHERE = \"", '"')?;
    let default = between(SEARCH, "const DEFAULT_VISIBLE_WHERE = `", '`')?;
    if default.matches("${BASE_VISIBLE_WHERE}").count() != 1
        || !count_source.contains("const fromClause = 'FROM scoped_images AS images';")
        || !count_source
            .contains("const query = `SELECT count(*) as count ${fromClause} ${finalWhere}`;")
        || !count_source
            .contains("const finalWhere = whereClause ? whereClause : DEFAULT_VISIBLE_WHERE;")
    {
        return Err(Failure::Drift);
    }
    let predicate = default.replace("${BASE_VISIBLE_WHERE}", base);
    if predicate.contains("${") {
        return Err(Failure::Drift);
    }
    let global_scope = SEARCH
        .split_once("export const countGlobalImages =")
        .ok_or(Failure::Drift)?
        .1;
    let global = between(global_scope, "`", '`')?;
    let collection = super::super::super::tests::production_collection_stats_query();
    let maintenance = super::super::maintenance_count_sql();
    if [collection, maintenance, global]
        .iter()
        .any(|query| query.contains("${"))
    {
        return Err(Failure::Drift);
    }
    Ok([
        collection.to_owned(),
        maintenance.to_owned(),
        format!("SELECT count(*) as count FROM scoped_images AS images {predicate}"),
        global.to_owned(),
    ])
}

#[cfg(feature = "startup-sql-trace")]
pub(super) fn generated_trace_queries() -> [String; 4] {
    queries().expect("unchanged shipping count query definitions")
}

fn reject_redirection(path: &Path) -> ProbeResult<()> {
    for ancestor in path.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor).map_err(|_| Failure::InvalidTarget)?;
        if metadata.file_type().is_symlink() {
            return Err(Failure::InvalidTarget);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(Failure::InvalidTarget);
            }
        }
    }
    Ok(())
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn lexical_target(path: &Path) -> bool {
    path.to_str()
        .is_some_and(|value| value.replace('\\', "/").eq_ignore_ascii_case(DEV_PATH))
}

fn validate_target(path: &Path) -> ProbeResult<PathBuf> {
    if !cfg!(windows) || !lexical_target(path) {
        return Err(Failure::InvalidTarget);
    }
    reject_redirection(path)?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let candidate = sidecar(path, suffix);
        match std::fs::symlink_metadata(&candidate) {
            Ok(_) => reject_redirection(&candidate)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(Failure::InvalidTarget),
        }
    }
    let resolved = path.canonicalize().map_err(|_| Failure::InvalidTarget)?;
    let physical = resolved
        .to_str()
        .ok_or(Failure::InvalidTarget)?
        .strip_prefix("\\\\?\\")
        .unwrap_or("");
    if !lexical_target(Path::new(physical)) || !resolved.is_file() {
        return Err(Failure::InvalidTarget);
    }
    Ok(resolved)
}

#[cfg(windows)]
const PROCESS_CHECK_SCRIPT: &str = r#"$ErrorActionPreference='Stop';
$running=$false; $unavailable=$false;
foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
    if ($process.ProcessId -eq $PID) { continue }
    if ($process.Name -eq 'app.exe' -or $process.Name -like '*ambit*.exe') { $running=$true; break }
    if ($process.Name -in @('node.exe','cargo.exe','cargo-tauri.exe','tauri.exe','pnpm.exe','cmd.exe','powershell.exe','pwsh.exe')) {
        if ([string]::IsNullOrWhiteSpace($process.CommandLine)) { $unavailable=$true; continue }
        if ($process.CommandLine -match '(?i)(app:dev|tauri(?:\.exe|\.js)?["\s]+dev(?:["\s]|$))') { $running=$true; break }
    }
}
if ($running) { [Console]::Write('running') } elseif ($unavailable) { [Console]::Write('unavailable') } else { [Console]::Write('clear') }"#;

#[cfg(windows)]
fn require_app_closed(deadline: Instant) -> ProbeResult<()> {
    if Instant::now() >= deadline {
        return Err(Failure::Timeout);
    }
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    // Fixed CIM inspection: neither raw command lines nor process identities leave this helper.
    let mut child = Command::new("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            PROCESS_CHECK_SCRIPT,
        ])
        .creation_flags(0x08000000)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| Failure::ProcessUnavailable)?;
    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|_| Failure::ProcessUnavailable)?
            .is_some()
        {
            break;
        }
        if started.elapsed() >= Duration::from_secs(10) || Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if Instant::now() >= deadline {
                Failure::Timeout
            } else {
                Failure::ProcessUnavailable
            });
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = child
        .wait_with_output()
        .map_err(|_| Failure::ProcessUnavailable)?;
    if !output.status.success() {
        return Err(Failure::ProcessUnavailable);
    }
    match output.stdout.as_slice() {
        b"clear" => Ok(()),
        b"running" => Err(Failure::AppRunning),
        _ => Err(Failure::ProcessUnavailable),
    }
}
#[cfg(not(windows))]
fn require_app_closed(_deadline: Instant) -> ProbeResult<()> {
    Err(Failure::ProcessUnavailable)
}

fn open(path: &Path) -> ProbeResult<(Connection, f64)> {
    let started = Instant::now();
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| Failure::Open)?;
    conn.execute_batch("PRAGMA query_only=ON; PRAGMA busy_timeout=2000;")
        .map_err(|_| Failure::Open)?;
    Ok((conn, started.elapsed().as_secs_f64() * 1000.0))
}

fn require_read_only_layout(path: &Path) -> ProbeResult<()> {
    // The owner permits SQLite-managed empty WAL / SHM creation, not writes to
    // the main catalog or an existing WAL. Never substitute immutable mode.
    reject_redirection(path)?;
    let mut header = [0_u8; 20];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| Failure::Open)?;
    if &header[..16] != b"SQLite format 3\0" {
        return Err(Failure::Open);
    }
    // SQLite must not be allowed to recover or create a rollback journal.
    if stamp(&sidecar(path, "-journal"))?.is_some() {
        return Err(Failure::UnsupportedLayout);
    }
    let _ = snapshot(path)?;
    Ok(())
}

fn settings(conn: &Connection) -> ProbeResult<Json> {
    let mut values = serde_json::Map::new();
    for (label, sql) in [
        ("query_only", "PRAGMA query_only"),
        ("busy_timeout", "PRAGMA busy_timeout"),
        ("synchronous", "PRAGMA synchronous"),
        ("cache_size", "PRAGMA cache_size"),
        ("temp_store", "PRAGMA temp_store"),
        ("mmap_size", "PRAGMA mmap_size"),
        ("page_size", "PRAGMA page_size"),
    ] {
        let value: i64 = conn
            .query_row(sql, [], |row| row.get(0))
            .map_err(|_| Failure::Query)?;
        values.insert(label.into(), json!(value));
    }
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(|_| Failure::Query)?;
    values.insert(
        "journal_mode".into(),
        json!(match journal.as_str() {
            "wal" => "wal",
            "delete" => "delete",
            "truncate" => "truncate",
            "persist" => "persist",
            "memory" => "memory",
            "off" => "off",
            _ => "unknown",
        }),
    );
    Ok(Json::Object(values))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Stamp {
    bytes: u64,
    modified: SystemTime,
    created: SystemTime,
}
fn stamp(path: &Path) -> ProbeResult<Option<Stamp>> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            reject_redirection(path)?;
            if !meta.is_file() {
                return Err(Failure::InvalidTarget);
            }
            Ok(Some(Stamp {
                bytes: meta.len(),
                modified: meta.modified().map_err(|_| Failure::Changed)?,
                created: meta.created().map_err(|_| Failure::Changed)?,
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(Failure::Changed),
    }
}
#[derive(Clone, Debug)]
struct Snapshot {
    main: Stamp,
    wal: Option<Stamp>,
    shm_present: bool,
}
fn snapshot(path: &Path) -> ProbeResult<Snapshot> {
    if stamp(&sidecar(path, "-journal"))?.is_some() {
        return Err(Failure::UnsupportedLayout);
    }
    Ok(Snapshot {
        main: stamp(path)?.ok_or(Failure::Changed)?,
        wal: stamp(&sidecar(path, "-wal"))?,
        // Only presence matters for SHM; stamp still enforces a regular, nonredirected file.
        shm_present: stamp(&sidecar(path, "-shm"))?.is_some(),
    })
}
fn allowed_transition(before: &Snapshot, after: &Snapshot) -> ProbeResult<()> {
    if after.main != before.main {
        return Err(Failure::Changed);
    }
    match &before.wal {
        Some(wal) if after.wal.as_ref() != Some(wal) => Err(Failure::Changed),
        None if after.wal.as_ref().is_some_and(|wal| wal.bytes != 0) => Err(Failure::Changed),
        _ => Ok(()),
    }
}
fn presence_transition(before: bool, after: bool) -> &'static str {
    match (before, after) {
        (false, true) => "appeared",
        (true, false) => "disappeared",
        _ => "unchanged",
    }
}
fn record_sidecars(
    report: &mut Report,
    stage: &'static str,
    previous: &Snapshot,
    current: &Snapshot,
) -> ProbeResult<()> {
    report.write(json!({"kind":"sidecars","sidecar_policy_version":SIDECAR_POLICY_VERSION,"stage":stage,
        "wal": match &current.wal { None => "absent", Some(wal) if wal.bytes == 0 => "empty", Some(_) => "nonempty" },
        "shm":if current.shm_present { "present" } else { "absent" },
        "wal_transition":presence_transition(previous.wal.is_some(), current.wal.is_some()),
        "shm_transition":presence_transition(previous.shm_present, current.shm_present)}), false)
}
fn version(conn: &Connection) -> ProbeResult<i64> {
    conn.query_row("PRAGMA data_version", [], |row| row.get(0))
        .map_err(|_| Failure::Changed)
}
fn unchanged(
    path: &Path,
    before: &Snapshot,
    connections: &[Connection],
    versions: &[i64],
) -> ProbeResult<()> {
    allowed_transition(before, &snapshot(path)?)?;
    if connections
        .iter()
        .map(version)
        .collect::<ProbeResult<Vec<_>>>()?
        != versions
    {
        return Err(Failure::Changed);
    }
    Ok(())
}

fn read_rows(
    conn: &Connection,
    sql: &str,
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
) -> ProbeResult<(Vec<Vec<Value>>, f64)> {
    read_rows_after_watchdog(conn, sql, deadline, cancelled, || {})
}

fn read_rows_after_watchdog(
    conn: &Connection,
    sql: &str,
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
    before_query: impl FnOnce(),
) -> ProbeResult<(Vec<Vec<Value>>, f64)> {
    if Instant::now() >= deadline {
        return Err(Failure::Timeout);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(Failure::Worker);
    }
    let query_deadline = deadline.min(Instant::now() + QUERY_LIMIT);
    let interrupt = conn.get_interrupt_handle();
    let (done, receiver) = mpsc::channel();
    let timed_out = AtomicBool::new(false);
    let result = std::thread::scope(|scope| {
        let cancelled = &cancelled;
        let timed_out = &timed_out;
        scope.spawn(move || loop {
            if cancelled.load(Ordering::Relaxed) {
                interrupt.interrupt();
            }
            let remaining = query_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                timed_out.store(true, Ordering::Relaxed);
                interrupt.interrupt();
            }
            // Interrupting an idle connection is a no-op: continue until the query
            // acknowledges completion, covering cancellation before prepare begins.
            match receiver.recv_timeout(Duration::from_millis(10)) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => (),
            }
        });
        before_query();
        let started = Instant::now();
        let values = (|| -> rusqlite::Result<Vec<Vec<Value>>> {
            let mut statement = conn.prepare(sql)?;
            let columns = statement.column_count();
            let mapped = statement.query_map([], |row| {
                (0..columns).map(|column| row.get(column)).collect()
            })?;
            mapped.collect()
        })();
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        let _ = done.send(());
        (values, ms)
    });
    if timed_out.load(Ordering::Relaxed) || Instant::now() >= query_deadline {
        return Err(Failure::Timeout);
    }
    let mut values = result.0.map_err(|_| Failure::Query)?;
    values.sort_by_key(|row| format!("{row:?}"));
    if Instant::now() >= deadline {
        return Err(Failure::Timeout);
    }
    Ok((values, result.1))
}

struct Report {
    file: File,
    bytes: usize,
    sequence: usize,
    terminal: bool,
}
impl Report {
    fn create(path: &Path) -> ProbeResult<Self> {
        Ok(Self {
            file: OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .map_err(|_| Failure::Storage)?,
            bytes: 0,
            sequence: 0,
            terminal: false,
        })
    }
    fn write(&mut self, mut record: Json, terminal: bool) -> ProbeResult<()> {
        record["sequence"] = json!(self.sequence);
        let mut bytes = serde_json::to_vec(&record).map_err(|_| Failure::Storage)?;
        bytes.push(b'\n');
        let limit = if terminal {
            REPORT_LIMIT
        } else {
            REPORT_LIMIT - TERMINAL_RESERVE
        };
        if self.bytes + bytes.len() > limit {
            return Err(Failure::Storage);
        }
        self.file
            .write_all(&bytes)
            .and_then(|_| self.file.flush())
            .map_err(|_| Failure::Storage)?;
        self.bytes += bytes.len();
        self.sequence += 1;
        Ok(())
    }
    fn finish(&mut self, result: ProbeResult<()>) -> ProbeResult<()> {
        self.write(json!({"kind":"terminal", "status": match result { Ok(()) => "completed", Err(Failure::Timeout) => "timed-out", Err(_) => "failed" }, "reason": result.err().map(Failure::label)}), true)?;
        self.terminal = true;
        Ok(())
    }
}
impl Drop for Report {
    fn drop(&mut self) {
        if !self.terminal {
            let _ = self.write(json!({"kind":"terminal", "status":"interrupted", "reason":"scope-ended-without-completion"}), true);
        }
    }
}

fn plan_classes(rows: Vec<Vec<Value>>) -> Json {
    let mut scans = 0;
    let mut searches = 0;
    let mut covering = 0;
    let mut sorts = 0;
    let mut other = 0;
    for row in rows {
        let detail = match row.get(3) {
            Some(Value::Text(value)) => value.as_str(),
            _ => "",
        };
        if detail.starts_with("SCAN ") {
            scans += 1;
        } else if detail.starts_with("SEARCH ") {
            searches += 1;
        } else if detail.starts_with("USE TEMP B-TREE") {
            sorts += 1;
        } else {
            other += 1;
        }
        if detail.contains("COVERING INDEX") {
            covering += 1;
        }
    }
    json!({"scan":scans,"indexed_search":searches,"covering_index":covering,"temporary_sort":sorts,"other":other})
}

fn equal(actual: &[Vec<Value>], expected: &[Vec<Value>]) -> ProbeResult<()> {
    if actual == expected {
        Ok(())
    } else {
        Err(Failure::Mismatch)
    }
}
fn record_read(
    report: &mut Report,
    kind: &'static str,
    round: usize,
    index: usize,
    ms: f64,
    row_count: usize,
) -> ProbeResult<()> {
    if !ms.is_finite() || ms < 0.0 {
        return Err(Failure::Query);
    }
    report.write(json!({"kind":kind,"round":round,"query":LABELS[index],"ms":ms,"row_count":row_count,"exact_result_equal":if kind == "first-read" {None} else {Some(true)},"reference_established":kind == "first-read"}), false)
}

fn campaign(
    path: &Path,
    queries: &[String; 4],
    report: &mut Report,
    deadline: Instant,
    process_check: bool,
) -> ProbeResult<()> {
    let before = snapshot(path)?;
    let result = campaign_work(path, queries, report, deadline, process_check);
    if result.is_err() {
        // campaign_work's retained connections have dropped, including on early ?.
        // Preserve the original failure while retaining safe teardown observations.
        record_failed_teardown(report, &before, snapshot(path));
    }
    result
}

fn record_failed_teardown(report: &mut Report, before: &Snapshot, after: ProbeResult<Snapshot>) {
    match after {
        Ok(after) => {
            let _ = record_sidecars(report, "after-failed-teardown", before, &after);
            let _ = report.write(json!({"kind":"sidecar-guard","sidecar_policy_version":SIDECAR_POLICY_VERSION,"stage":"after-failed-teardown","unchanged_catalog_and_allowed_sidecars":allowed_transition(before, &after).is_ok()}), false);
        }
        Err(error) => {
            let _ = report.write(json!({"kind":"sidecars","sidecar_policy_version":SIDECAR_POLICY_VERSION,"stage":"after-failed-teardown","observation":"unavailable","reason":error.label()}), false);
        }
    }
}

fn campaign_work(
    path: &Path,
    queries: &[String; 4],
    report: &mut Report,
    deadline: Instant,
    process_check: bool,
) -> ProbeResult<()> {
    require_read_only_layout(path)?;
    let before_open = snapshot(path)?;
    record_sidecars(report, "before-open", &before_open, &before_open)?;
    let mut connections = Vec::new();
    for index in 0..4 {
        let (conn, ms) = open(path)?;
        report.write(json!({"kind":"connection","connection":index,"opening_and_read_only_policy_ms":ms,"settings":settings(&conn)?}), false)?;
        connections.push(conn);
    }
    let after_open = snapshot(path)?;
    allowed_transition(&before_open, &after_open)?;
    record_sidecars(report, "after-open", &before_open, &after_open)?;
    let versions = connections
        .iter()
        .map(version)
        .collect::<ProbeResult<Vec<_>>>()?;
    let mut expected = Vec::new();
    for index in 0..4 {
        if process_check {
            require_app_closed(deadline)?;
        }
        unchanged(path, &before_open, &connections, &versions)?;
        let (values, ms) = read_rows(
            &connections[index],
            &queries[index],
            deadline,
            Arc::new(AtomicBool::new(false)),
        )?;
        unchanged(path, &before_open, &connections, &versions)?;
        record_read(report, "first-read", 0, index, ms, values.len())?;
        expected.push(values);
    }
    let mut timings = vec![vec![Vec::<f64>::new(); 4]; 2];
    for round in 0..3 {
        if process_check {
            require_app_closed(deadline)?;
        }
        for index in if round % 2 == 0 {
            [0, 1, 2, 3]
        } else {
            [3, 2, 1, 0]
        } {
            unchanged(path, &before_open, &connections, &versions)?;
            let (values, ms) = read_rows(
                &connections[index],
                &queries[index],
                deadline,
                Arc::new(AtomicBool::new(false)),
            )?;
            unchanged(path, &before_open, &connections, &versions)?;
            equal(&values, &expected[index])?;
            record_read(report, "sequential", round, index, ms, values.len())?;
            timings[0][index].push(ms);
        }
        if process_check {
            require_app_closed(deadline)?;
        }
        unchanged(path, &before_open, &connections, &versions)?;
        let barrier = Barrier::new(4);
        let cancelled = Arc::new(AtomicBool::new(false));
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = connections
                .iter_mut()
                .enumerate()
                .map(|(index, conn)| {
                    let barrier = &barrier;
                    let cancelled = cancelled.clone();
                    let expected = &expected[index];
                    let sql = &queries[index];
                    scope.spawn(move || {
                        barrier.wait();
                        let result = read_rows(conn, sql, deadline, cancelled.clone()).and_then(
                            |(values, ms)| {
                                equal(&values, expected)?;
                                Ok((values.len(), ms))
                            },
                        );
                        if result.is_err() {
                            cancelled.store(true, Ordering::Relaxed);
                        }
                        result
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap_or(Err(Failure::Worker)))
                .collect::<Vec<_>>()
        });
        unchanged(path, &before_open, &connections, &versions)?;
        // Preserve the timeout classification even if another worker was interrupted first.
        if results.contains(&Err(Failure::Timeout)) {
            return Err(Failure::Timeout);
        }
        for (index, result) in results.into_iter().enumerate() {
            let (count, ms) = result?;
            record_read(report, "concurrent", round, index, ms, count)?;
            timings[1][index].push(ms);
        }
    }
    for index in 0..4 {
        let (plan, _) = read_rows(
            &connections[index],
            &format!("EXPLAIN QUERY PLAN {}", queries[index]),
            deadline,
            Arc::new(AtomicBool::new(false)),
        )?;
        report.write(
            json!({"kind":"query-plan","query":LABELS[index],"classifications":plan_classes(plan)}),
            false,
        )?;
        for arm in 0..2 {
            timings[arm][index].sort_by(f64::total_cmp);
            report.write(json!({"kind":"summary","query":LABELS[index],"arm":if arm == 0 {"sequential"} else {"concurrent"},"reads":3,"median_ms":timings[arm][index][1],"slowest_ms":timings[arm][index][2]}), false)?;
        }
    }
    unchanged(path, &before_open, &connections, &versions)?;
    if process_check {
        require_app_closed(deadline)?;
    }
    if Instant::now() >= deadline {
        return Err(Failure::Timeout);
    }
    drop(connections);
    let after_teardown = snapshot(path)?;
    allowed_transition(&before_open, &after_teardown)?;
    record_sidecars(report, "after-teardown", &after_open, &after_teardown)?;
    Ok(())
}

fn provenance(queries: &[String; 4]) -> ProbeResult<Json> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .map_err(|_| Failure::Provenance)?;
    let revision = String::from_utf8(output.stdout).map_err(|_| Failure::Provenance)?;
    let revision = revision.trim();
    if !output.status.success()
        || revision.len() != 40
        || !revision.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(Failure::Provenance);
    }
    Ok(
        json!({"kind":"header","schema":1,"revision":revision,"sqlite":rusqlite::version(),
        "source_sha256":{"search":digest(SEARCH.as_bytes()),"collection":digest(COLLECTION.as_bytes()),"maintenance":digest(MAINTENANCE.as_bytes()),"probe":digest(include_str!("campaign.rs").as_bytes())},
        "query_sha256":queries.iter().map(|query| digest(query.as_bytes())).collect::<Vec<_>>(),"queries":LABELS,
        "boundary":"direct read-only bundled SQLite; opening measured separately; prepare/execution/decoding combined; no IPC or OS-cold claim; default-visible query is not the owner's exact filter",
        "busy_timeout_ms":2000,"shipping_busy_timeout_ms":60000,"budget_ms":900000,"per_query_limit_ms":60000,"sidecar_policy_version":SIDECAR_POLICY_VERSION,
        "limitations":"No terminal record means incomplete/interrupted evidence, not zero work. SQLite-managed empty WAL and SHM creation/removal are permitted; the main catalog and preexisting WAL metadata must remain unchanged. SHM bookkeeping is excluded from modification comparisons. File metadata and data_version checks detect observed catalog changes, not all possible external filesystem races."}),
    )
}

#[test]
#[ignore = "one explicit regular-dev read-only campaign via AMBIT_COUNT_PROBE_DB; close Ambit first"]
fn measure_regular_dev_counts_read_only() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let artifact_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    reject_redirection(&artifact_dir).expect("probe artifact directory must be physical");
    let filename = format!("count-read-only-{}.jsonl", uuid::Uuid::new_v4());
    let mut report =
        Report::create(&artifact_dir.join(&filename)).expect("create-new bounded probe report");
    println!("count probe report: {filename}");
    let deadline = Instant::now() + BUDGET;
    let outcome = (|| {
        let queries = queries()?;
        report.write(provenance(&queries)?, false)?;
        let supplied = std::env::var_os("AMBIT_COUNT_PROBE_DB").ok_or(Failure::InvalidTarget)?;
        let path = validate_target(Path::new(&supplied))?;
        require_app_closed(deadline)?;
        campaign(&path, &queries, &mut report, deadline, true)
    })();
    report.finish(outcome).expect("probe terminal record");
    if let Err(error) = outcome {
        panic!("count probe stopped: {}", error.label());
    }
}

#[test]
fn four_queries_follow_shipping_definitions_and_keep_distinct_visibility() {
    let values = queries().unwrap();
    assert!(COLLECTION.contains(&values[0]));
    assert!(MAINTENANCE.contains(&values[1]));
    assert!(values[2].contains("IFNULL(is_grid_gen, 0) = 0"));
    assert!(values[2].contains("IFNULL(is_invoke_asset_gen, 0) = 0"));
    assert!(!values[3].contains("IFNULL"));
    assert!(SEARCH.contains(&values[3]));
}

#[test]
fn unexpected_and_production_paths_fail_before_access() {
    for path in [
        "C:/Users/Artemis/AppData/Roaming/com.ambit.app/images.db",
        "D:/images.db",
        "images.db",
        "C:/Users/Artemis/AppData/Roaming/com.ambit.dev/../com.ambit.dev/images.db",
        "C:/Users/Artemis/AppData/Roaming/com.ambit.dev/images.db:stream",
    ] {
        assert!(!lexical_target(Path::new(path)));
        assert_eq!(
            validate_target(Path::new(path)),
            Err(Failure::InvalidTarget)
        );
    }
}

#[test]
fn deadline_mismatch_and_private_plans_are_classified() {
    let conn = Connection::open_in_memory().unwrap();
    let result = read_rows(
        &conn,
        "SELECT 1",
        Instant::now() - Duration::from_secs(1),
        Arc::new(AtomicBool::new(false)),
    );
    assert_eq!(result, Err(Failure::Timeout));
    assert_eq!(
        equal(&[vec![Value::Integer(1)]], &[vec![Value::Integer(2)]]),
        Err(Failure::Mismatch)
    );
    let plan = plan_classes(vec![vec![
        Value::Null,
        Value::Null,
        Value::Null,
        Value::Text("SEARCH private-owner USING COVERING INDEX private-index (secret=?)".into()),
    ]]);
    let encoded = plan.to_string();
    assert!(!encoded.contains("private"));
    assert!(!encoded.contains("secret"));
    assert_eq!(plan["indexed_search"], 1);
}

#[test]
fn report_preserves_terminal_capacity_and_interruption() {
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let path = directory.path.join("evidence.jsonl");
    {
        let mut report = Report::create(&path).unwrap();
        while report
            .write(
                json!({"kind":"test-padding","padding":"x".repeat(1024)}),
                false,
            )
            .is_ok()
        {}
        report.finish(Err(Failure::Timeout)).unwrap();
    }
    assert!(Report::create(&path).is_err());
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.len() <= REPORT_LIMIT);
    let terminal: Json = serde_json::from_str(text.lines().last().unwrap()).unwrap();
    assert_eq!(terminal["status"], "timed-out");
    let partial = directory.path.join("partial.jsonl");
    {
        let mut report = Report::create(&partial).unwrap();
        report.write(json!({"kind":"header"}), false).unwrap();
    }
    let text = std::fs::read_to_string(partial).unwrap();
    assert!(text.contains("interrupted"));
}

#[test]
fn retained_connections_detect_external_changes_and_never_write() {
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let path = directory.path.join("readonly.db");
    let writer = Connection::open(&path).unwrap();
    writer
        .execute_batch("CREATE TABLE sentinel(value); INSERT INTO sentinel VALUES(7)")
        .unwrap();
    let (reader, _) = open(&path).unwrap();
    assert!(reader.execute("UPDATE sentinel SET value=8", []).is_err());
    let before = snapshot(&path).unwrap();
    let versions = vec![version(&reader).unwrap()];
    writer.execute("UPDATE sentinel SET value=9", []).unwrap();
    assert_eq!(
        unchanged(&path, &before, &[reader], &versions),
        Err(Failure::Changed)
    );
}

#[test]
fn active_deadline_and_cancellation_before_prepare_stop_work() {
    let conn = Connection::open_in_memory().unwrap();
    let long_query = "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n";
    let result = read_rows(
        &conn,
        long_query,
        Instant::now() + Duration::from_millis(30),
        Arc::new(AtomicBool::new(false)),
    );
    assert_eq!(result, Err(Failure::Timeout));
    let cancelled = Arc::new(AtomicBool::new(false));
    let result = read_rows_after_watchdog(
        &conn,
        long_query,
        Instant::now() + Duration::from_secs(5),
        cancelled.clone(),
        || {
            cancelled.store(true, Ordering::Relaxed);
            // Explicitly reproduce the no-op idle interrupt before statement execution.
            conn.get_interrupt_handle().interrupt();
        },
    );
    assert_eq!(result, Err(Failure::Query));
}

#[test]
fn generated_wal_campaign_is_complete_redacted_and_read_only() {
    use crate::db::migrations::collection_stats_query_tests::{seed_catalog, set_scope, Shape};
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let path = directory.path.join("generated.db");
    seed_catalog(
        &path,
        Shape {
            name: "read-only-probe",
            images: 100,
            memberships: 80,
        },
        false,
    );
    let writer = Connection::open(&path).unwrap();
    writer.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    set_scope(&writer, "all", "", true);
    let before = std::fs::read(&path).unwrap();
    let wal_before = std::fs::read(sidecar(&path, "-wal")).unwrap();
    let output = directory.path.join("campaign.jsonl");
    let mut report = Report::create(&output).unwrap();
    let outcome = campaign(
        &path,
        &queries().unwrap(),
        &mut report,
        Instant::now() + Duration::from_secs(30),
        false,
    );
    report.finish(outcome).unwrap();
    assert_eq!(outcome, Ok(()));
    drop(report);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(std::fs::read(sidecar(&path, "-wal")).unwrap(), wal_before);
    let encoded = std::fs::read_to_string(output).unwrap();
    assert!(!encoded.contains("fixture.db"));
    assert!(!encoded.contains("collection-"));
    assert!(!encoded.contains("SELECT"));
    let rows: Vec<Json> = encoded
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        rows.iter()
            .filter(|row| row["kind"] == "first-read")
            .count(),
        4
    );
    assert_eq!(
        rows.iter()
            .filter(|row| row["kind"] == "sequential")
            .count(),
        12
    );
    assert_eq!(
        rows.iter()
            .filter(|row| row["kind"] == "concurrent")
            .count(),
        12
    );
    assert_eq!(
        rows.iter().filter(|row| row["kind"] == "summary").count(),
        8
    );
    for (sequence, row) in rows.iter().enumerate() {
        assert_eq!(row["sequence"], sequence);
    }
    assert_eq!(rows.last().unwrap()["status"], "completed");
    assert!(rows
        .iter()
        .filter(|row| row["kind"] == "first-read")
        .all(|row| row["exact_result_equal"].is_null()));
}

#[test]
fn closed_wal_allows_sqlite_managed_empty_sidecars_without_catalog_writes() {
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let path = directory.path.join("closed-wal.db");
    let writer = Connection::open(&path).unwrap();
    writer
        .execute_batch(
            "PRAGMA journal_mode=WAL; CREATE TABLE sentinel(value); INSERT INTO sentinel VALUES(7)",
        )
        .unwrap();
    drop(writer);
    assert!(!sidecar(&path, "-wal").exists());
    assert!(!sidecar(&path, "-shm").exists());
    let before = snapshot(&path).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    require_read_only_layout(&path).unwrap();
    let (reader, _) = open(&path).unwrap();
    let _ = settings(&reader).unwrap();
    assert!(reader.execute("UPDATE sentinel SET value=8", []).is_err());
    let opened = snapshot(&path).unwrap();
    allowed_transition(&before, &opened).unwrap();
    assert_eq!(opened.wal.as_ref().unwrap().bytes, 0);
    assert!(opened.shm_present);
    drop(reader);
    allowed_transition(&before, &snapshot(&path).unwrap()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
}

#[test]
fn sidecar_transitions_reject_main_changes_and_every_preexisting_wal_change() {
    let fixed = Stamp {
        bytes: 4096,
        modified: SystemTime::UNIX_EPOCH,
        created: SystemTime::UNIX_EPOCH,
    };
    let original = Snapshot {
        main: fixed.clone(),
        wal: None,
        shm_present: false,
    };
    let mut after = original.clone();
    after.wal = Some(Stamp {
        bytes: 0,
        ..fixed.clone()
    });
    after.shm_present = true;
    assert_eq!(allowed_transition(&original, &after), Ok(()));
    assert_eq!(allowed_transition(&original, &original), Ok(()));
    assert_eq!(presence_transition(false, true), "appeared");
    assert_eq!(presence_transition(true, false), "disappeared");
    assert_eq!(allowed_transition(&after, &original), Err(Failure::Changed));
    after.wal.as_mut().unwrap().bytes = 1;
    assert_eq!(allowed_transition(&original, &after), Err(Failure::Changed));
    let existing = after.clone();
    after.shm_present = false;
    assert_eq!(allowed_transition(&existing, &after), Ok(()));
    after.wal.as_mut().unwrap().modified += Duration::from_secs(1);
    assert_eq!(allowed_transition(&existing, &after), Err(Failure::Changed));
    after = original.clone();
    after.main.bytes += 1;
    assert_eq!(allowed_transition(&original, &after), Err(Failure::Changed));
}

#[test]
fn generated_campaigns_cover_closed_empty_wal_and_missing_shm_layouts() {
    use crate::db::migrations::collection_stats_query_tests::{seed_catalog, set_scope, Shape};
    for layout in ["closed", "existing-empty", "missing-shm"] {
        let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
        let path = directory.path.join("catalog.db");
        seed_catalog(
            &path,
            Shape {
                name: "sidecar-probe",
                images: 20,
                memberships: 10,
            },
            false,
        );
        let writer = Connection::open(&path).unwrap();
        set_scope(&writer, "all", "", true);
        let (path, held_writer) = if layout == "missing-shm" {
            // Generated committed main+WAL fixture only: deliberately omit SHM in
            // its separate test location. No real-library or campaign sidecar handling.
            let destination = directory.path.join("missing-shm.db");
            std::fs::copy(&path, &destination).unwrap();
            std::fs::copy(sidecar(&path, "-wal"), sidecar(&destination, "-wal")).unwrap();
            assert!(!sidecar(&destination, "-shm").exists());
            (destination, Some(writer))
        } else {
            drop(writer);
            assert!(!sidecar(&path, "-wal").exists());
            if layout == "existing-empty" {
                let (reader, _) = open(&path).unwrap();
                settings(&reader).unwrap();
                drop(reader);
                assert_eq!(std::fs::metadata(sidecar(&path, "-wal")).unwrap().len(), 0);
            }
            (path, None)
        };
        let initial = snapshot(&path).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let wal_bytes = initial
            .wal
            .as_ref()
            .map(|_| std::fs::read(sidecar(&path, "-wal")).unwrap());
        let output = directory.path.join("report.jsonl");
        let mut report = Report::create(&output).unwrap();
        let result = campaign(
            &path,
            &queries().unwrap(),
            &mut report,
            Instant::now() + Duration::from_secs(30),
            false,
        );
        report.finish(result).unwrap();
        assert_eq!(result, Ok(()), "generated layout {layout}");
        drop(report);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        if let Some(bytes) = wal_bytes {
            assert_eq!(std::fs::read(sidecar(&path, "-wal")).unwrap(), bytes);
        }
        allowed_transition(&initial, &snapshot(&path).unwrap()).unwrap();
        let rows: Vec<Json> = std::fs::read_to_string(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let sidecars: Vec<_> = rows
            .iter()
            .filter(|row| row["kind"] == "sidecars")
            .collect();
        assert_eq!(sidecars.len(), 3);
        assert_eq!(sidecars[0]["stage"], "before-open");
        assert_eq!(sidecars[1]["stage"], "after-open");
        assert_eq!(sidecars[2]["stage"], "after-teardown");
        assert!(sidecars
            .iter()
            .all(|row| row["sidecar_policy_version"] == 2));
        if layout == "closed" {
            assert_eq!(sidecars[1]["wal_transition"], "appeared");
        }
        if layout == "missing-shm" {
            assert_eq!(sidecars[1]["shm_transition"], "appeared");
        }
        drop(held_writer);
    }
}

#[test]
fn rollback_journal_and_nonregular_sidecars_are_rejected_before_open() {
    for suffix in ["-journal", "-wal", "-shm"] {
        let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
        let path = directory.path.join("catalog.db");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE sentinel(value)")
            .unwrap();
        drop(writer);
        if suffix == "-journal" {
            File::create(sidecar(&path, suffix)).unwrap();
        } else {
            std::fs::create_dir(sidecar(&path, suffix)).unwrap();
        }
        assert_eq!(
            require_read_only_layout(&path),
            Err(if suffix == "-journal" {
                Failure::UnsupportedLayout
            } else {
                Failure::InvalidTarget
            })
        );
    }
}

#[test]
fn failed_campaign_retains_after_teardown_sidecar_presence() {
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let path = directory.path.join("catalog.db");
    let writer = Connection::open(&path).unwrap();
    writer
        .execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE sentinel(value)")
        .unwrap();
    drop(writer);
    let output = directory.path.join("failed.jsonl");
    let mut report = Report::create(&output).unwrap();
    let queries = [
        "SELECT value FROM absent_private_table".to_owned(),
        "SELECT 1".into(),
        "SELECT 1".into(),
        "SELECT 1".into(),
    ];
    let result = campaign(
        &path,
        &queries,
        &mut report,
        Instant::now() + Duration::from_secs(10),
        false,
    );
    assert_eq!(result, Err(Failure::Query));
    report.finish(result).unwrap();
    drop(report);
    let output = std::fs::read_to_string(output).unwrap();
    assert!(output.contains("after-failed-teardown"));
    assert!(!output.contains("private_table"));
}

#[test]
fn unavailable_teardown_snapshot_keeps_policy_version_and_fixed_failure() {
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let output = directory.path.join("unavailable.jsonl");
    let before = Snapshot {
        main: Stamp {
            bytes: 4096,
            modified: SystemTime::UNIX_EPOCH,
            created: SystemTime::UNIX_EPOCH,
        },
        wal: None,
        shm_present: false,
    };
    let mut report = Report::create(&output).unwrap();
    record_failed_teardown(&mut report, &before, Err(Failure::InvalidTarget));
    report.finish(Err(Failure::Query)).unwrap();
    drop(report);
    let encoded = std::fs::read_to_string(output).unwrap();
    let rows: Vec<Json> = encoded
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(rows[0]["sidecar_policy_version"], 2);
    assert_eq!(rows[0]["observation"], "unavailable");
    assert_eq!(rows[0]["reason"], "invalid-target");
    assert_eq!(rows[1]["reason"], "query-failed");
}

#[cfg(windows)]
#[test]
fn fixed_process_classification_blocks_runners_without_echoing_arguments_or_matching_self() {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    for (fixture, expected) in [
        ("Name='app.exe';CommandLine='private-argument'", "running"),
        (
            "Name='node.exe';CommandLine='pnpm.cjs run app:dev'",
            "running",
        ),
        (
            "Name='cmd.exe';CommandLine='cmd /c tauri dev --config private-config'",
            "running",
        ),
        (
            "Name='node.exe';CommandLine='node ordinary-test.js'",
            "clear",
        ),
        ("Name='cargo.exe';CommandLine=$null", "unavailable"),
        ("Name='cargo.exe';CommandLine=''", "unavailable"),
    ] {
        let script = format!("function Get-CimInstance {{ param($ClassName) [pscustomobject]@{{ProcessId=1;{fixture}}}; [pscustomobject]@{{ProcessId=$PID;Name='powershell.exe';CommandLine='tauri dev app:dev'}} }}\n{PROCESS_CHECK_SCRIPT}");
        let output = Command::new("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &script,
            ])
            .creation_flags(0x08000000)
            .stderr(Stdio::null())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "fixed classification fixture executes"
        );
        assert!(
            output.stdout == expected.as_bytes(),
            "only fixed process classification may be emitted"
        );
    }
}

#[cfg(windows)]
#[test]
fn redirected_ancestors_and_sidecars_are_rejected() {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    let directory = crate::db::migrations::tests::GeneratedBenchmarkDir::new();
    let real = directory.path.join("real");
    std::fs::create_dir(&real).unwrap();
    let path = real.join("catalog.db");
    let writer = Connection::open(&path).unwrap();
    writer
        .execute_batch("CREATE TABLE sentinel(value)")
        .unwrap();
    drop(writer);
    let ancestor = directory.path.join("redirected");
    // Both ends of these generated fixture junctions stay within the owned test directory.
    for junction in [&ancestor, &sidecar(&path, "-shm")] {
        let status = Command::new("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:AMBIT_PROBE_TEST_LINK -Target $env:AMBIT_PROBE_TEST_TARGET -ErrorAction Stop | Out-Null"])
            .env("AMBIT_PROBE_TEST_LINK", junction).env("AMBIT_PROBE_TEST_TARGET", &real)
            .creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
        assert!(status.success(), "generated in-directory junction fixture");
    }
    assert_eq!(
        require_read_only_layout(&ancestor.join("catalog.db")),
        Err(Failure::InvalidTarget)
    );
    assert!(matches!(snapshot(&path), Err(Failure::InvalidTarget)));
}
