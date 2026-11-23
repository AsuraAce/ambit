//! Stops long background database work that no page is waiting for any more.
//!
//! A page reload (F5) leaves the previous page's Rust commands running, and an
//! owner-cache repair can hold the facet build lock for minutes. The new page's
//! startup gate then waits for it (#430 smoke). Closing the app has the same
//! problem: the exit path waits for the database while the repair runs.
//!
//! Each start of a top-level page load and each exit request advance a stop
//! epoch. A long job opts in with [`stop_when_epoch_changes`] on its own
//! connection. A SQLite progress handler then fails the job's current and later
//! statements once the epoch moves on. The job's open transaction rolls back, so the cache
//! keeps its last committed state.
//!
//! A progress handler is used rather than `sqlite3_interrupt`. An interrupt sent
//! while no statement is running is cleared by the connection's next statement,
//! so a job between two statements would carry on. The handler is checked by
//! every statement and belongs to one connection, so it cannot stop anything
//! else, and it goes away when that connection closes.

//!
//! One job can also be stopped on its own: the page gives it an id, and
//! [`stop_job`] sets the flag that [`stop_when_epoch_changes_or_job_stopped`]
//! checks alongside the epoch. An owner switch uses this to stop the previous
//! scope's facet build instead of waiting for it (#533).

use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Virtual-machine steps between checks: frequent enough to stop within
/// milliseconds, rare enough to cost nothing measurable.
const PROGRESS_CHECK_STEPS: i32 = 10_000;

static STOP_EPOCH: AtomicU64 = AtomicU64::new(0);
static PAGE: AtomicU64 = AtomicU64::new(0);

/// The epoch a command started in. Read it before the command's blocking work,
/// so work queued by a page that has since gone is already stale.
pub fn current_epoch() -> u64 {
    STOP_EPOCH.load(Ordering::SeqCst)
}

/// Counts top-level page loads in this process. Claims carry it, so a reloaded
/// page can take over a repair claim the previous page never finished (#432).
pub fn current_page() -> u64 {
    PAGE.load(Ordering::SeqCst)
}

/// A new top-level page load started: the previous page's jobs stop.
pub fn begin_page() {
    let page = PAGE.fetch_add(1, Ordering::SeqCst) + 1;
    if page > 1 {
        log::info!("[DB] Page load {page}: stopping the previous page's background work");
    }
    stop_earlier_work();
    // The epoch stops every job of the previous page, so none of its stop ids matter any more.
    if let Ok(mut jobs) = jobs().lock() {
        jobs.clear();
    }
}

/// A stop that arrives before its job registers is kept this long, then dropped.
/// The page stops only a call it is still waiting for, so a registration that
/// never comes means the call failed before it reached Rust.
const UNCLAIMED_STOP_TTL: Duration = Duration::from_secs(60);

struct JobEntry {
    stopped: Arc<AtomicBool>,
    registered: bool,
    created: Instant,
}

fn jobs() -> &'static Mutex<HashMap<String, JobEntry>> {
    static JOBS: OnceLock<Mutex<HashMap<String, JobEntry>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_unclaimed_stops(jobs: &mut HashMap<String, JobEntry>) {
    prune_unclaimed_stops_older_than(jobs, UNCLAIMED_STOP_TTL);
}

fn prune_unclaimed_stops_older_than(jobs: &mut HashMap<String, JobEntry>, ttl: Duration) {
    jobs.retain(|_, entry| entry.registered || entry.created.elapsed() < ttl);
}

/// A registered job. Dropping it forgets the id.
pub struct JobGuard {
    id: String,
    stopped: Arc<AtomicBool>,
}

impl JobGuard {
    pub fn flag(&self) -> Arc<AtomicBool> {
        self.stopped.clone()
    }
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = jobs().lock() {
            jobs.remove(&self.id);
        }
    }
}

/// Registers a stoppable job under `id`. A stop sent before this is honoured.
pub fn register_job(id: &str) -> JobGuard {
    let mut jobs = jobs()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    prune_unclaimed_stops(&mut jobs);
    let entry = jobs.entry(id.to_string()).or_insert_with(|| JobEntry {
        stopped: Arc::new(AtomicBool::new(false)),
        registered: false,
        created: Instant::now(),
    });
    entry.registered = true;
    JobGuard {
        id: id.to_string(),
        stopped: entry.stopped.clone(),
    }
}

/// Stops the job registered under `id`, or the one about to register under it.
pub fn stop_job(id: &str) {
    let mut jobs = jobs()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    prune_unclaimed_stops(&mut jobs);
    let entry = jobs.entry(id.to_string()).or_insert_with(|| JobEntry {
        stopped: Arc::new(AtomicBool::new(false)),
        registered: false,
        created: Instant::now(),
    });
    entry.stopped.store(true, Ordering::SeqCst);
    log::info!("[DB] Stop requested for background job {id}");
}

/// The app is exiting, or a new page started: jobs from earlier epochs stop at
/// their next database step.
pub fn stop_earlier_work() {
    STOP_EPOCH.fetch_add(1, Ordering::SeqCst);
}

/// Makes every statement on `conn` fail once the epoch is no longer `epoch`.
/// Only use this on a connection that the job opened for itself.
pub fn stop_when_epoch_changes(conn: &Connection, epoch: u64) {
    stop_when_epoch_changes_or_job_stopped(conn, epoch, None);
}

/// Like [`stop_when_epoch_changes`], and also stops once `job` is stopped.
pub fn stop_when_epoch_changes_or_job_stopped(
    conn: &Connection,
    epoch: u64,
    job: Option<Arc<AtomicBool>>,
) {
    let reported = AtomicBool::new(false);
    conn.progress_handler(
        PROGRESS_CHECK_STEPS,
        Some(move || {
            let epoch_moved = STOP_EPOCH.load(Ordering::SeqCst) != epoch;
            let job_stopped = job
                .as_ref()
                .is_some_and(|stopped| stopped.load(Ordering::SeqCst));
            let stop = epoch_moved || job_stopped;
            if stop && !reported.swap(true, Ordering::Relaxed) {
                if epoch_moved {
                    log::info!("[DB] Stopped background work from an earlier page or before exit");
                } else {
                    log::info!("[DB] Stopped a background job on request");
                }
            }
            stop
        }),
    );
}

/// Leaves a connection whose job was stopped ready for other work: the stop
/// handler is removed, any open transaction rolled back and the named TEMP
/// tables dropped. Used on every failure path of a stoppable job.
pub fn clean_up_stopped_connection(conn: &Connection, temp_tables: &[&str]) {
    conn.progress_handler(0, None::<fn() -> bool>);
    if !conn.is_autocommit() {
        let _ = conn.execute_batch("ROLLBACK");
    }
    for table in temp_tables {
        let _ = conn.execute_batch(&format!("DROP TABLE IF EXISTS temp.{table}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn job_entry(id: &str) -> Option<(bool, bool)> {
        jobs()
            .lock()
            .unwrap()
            .get(id)
            .map(|entry| (entry.registered, entry.stopped.load(Ordering::SeqCst)))
    }

    // An owner switch stops the previous scope's facet build by id (#533). The stop can
    // reach Rust before the build registers, and must still count.
    #[test]
    fn a_stop_sent_before_the_job_registers_still_stops_it() {
        let id = "test-stop-before-register";
        stop_job(id);
        let guard = register_job(id);
        assert!(guard.flag().load(Ordering::SeqCst));
        drop(guard);
        assert_eq!(job_entry(id), None, "a finished job forgets its id");
    }

    // Prunes its own map: pruning the process-wide registry with no expiry would drop
    // the early stop that a parallel test is about to claim.
    #[test]
    fn a_stop_for_a_job_that_never_registers_is_dropped_after_its_expiry() {
        let entry = |registered| JobEntry {
            stopped: Arc::new(AtomicBool::new(true)),
            registered,
            created: Instant::now(),
        };
        let mut registry = HashMap::from([
            ("unclaimed".to_string(), entry(false)),
            ("running".to_string(), entry(true)),
        ]);

        prune_unclaimed_stops_older_than(&mut registry, Duration::from_secs(60));
        assert_eq!(registry.len(), 2, "a stop younger than its expiry stays");

        prune_unclaimed_stops_older_than(&mut registry, Duration::ZERO);
        assert!(!registry.contains_key("unclaimed"));
        assert!(
            registry.contains_key("running"),
            "a running job is never pruned"
        );
    }

    // Called from the epoch test below, which owns the process-wide epoch: a parallel
    // epoch change would otherwise stop the "other" job here too.
    fn a_stopped_job_ends_its_running_statement_and_leaves_other_jobs_running() {
        let guard = register_job("test-stop-running-statement");
        let flag = guard.flag();
        let (sender, receiver) = mpsc::channel();
        let job = std::thread::spawn(move || {
            let conn = Connection::open_in_memory().expect("open job connection");
            stop_when_epoch_changes_or_job_stopped(&conn, current_epoch(), Some(flag));
            sender.send(()).expect("signal start");
            let started = Instant::now();
            let result = conn.query_row(LONG_QUERY, [], |row| row.get::<_, i64>(0));
            (result, started.elapsed())
        });
        receiver.recv().expect("job started");
        std::thread::sleep(Duration::from_millis(50));
        let other = Connection::open_in_memory().expect("open other connection");
        let other_job = register_job("test-other-job");
        stop_when_epoch_changes_or_job_stopped(&other, current_epoch(), Some(other_job.flag()));

        stop_job("test-stop-running-statement");
        let (result, elapsed) = job.join().expect("job thread");
        let error = result.expect_err("a stopped job's statement must end");
        assert_eq!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::OperationInterrupted)
        );
        assert!(
            elapsed < Duration::from_secs(1),
            "stopped after {elapsed:?}"
        );
        let bounded =
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 200000)
                       SELECT count(*) FROM n";
        assert_eq!(
            other
                .query_row(bounded, [], |row| row.get::<_, i64>(0))
                .unwrap(),
            200_000
        );
        drop(guard);
    }

    #[test]
    fn clean_up_leaves_a_stopped_connection_usable() {
        let conn = Connection::open_in_memory().unwrap();
        let stopped = Arc::new(AtomicBool::new(true));
        conn.execute_batch("BEGIN; CREATE TEMP TABLE facet_cache(x);")
            .unwrap();
        stop_when_epoch_changes_or_job_stopped(&conn, current_epoch(), Some(stopped));
        clean_up_stopped_connection(&conn, &["facet_cache"]);
        assert!(conn.is_autocommit(), "the open transaction was rolled back");
        let temp_tables: i64 = conn
            .query_row(
                "SELECT count(*) FROM temp.sqlite_master WHERE name = 'facet_cache'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(temp_tables, 0);
    }

    const LONG_QUERY: &str = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n)
                              SELECT count(*) FROM n";

    // The stop epoch is process-wide, so these checks run in one test to keep
    // parallel test threads from advancing it under each other. Other tests read
    // it through jobs that opt in (the facet build, the reparse count), and a change
    // while they run stops them. It never changes the page count
    // that claims use.
    #[test]
    fn epoch_change_stops_only_jobs_from_earlier_epochs() {
        // A running statement on an opted-in connection stops soon after the epoch moves.
        let epoch = current_epoch();
        let (sender, receiver) = mpsc::channel();
        let job = std::thread::spawn(move || {
            let conn = Connection::open_in_memory().expect("open job connection");
            stop_when_epoch_changes(&conn, epoch);
            sender.send(()).expect("signal start");
            let started = Instant::now();
            let result = conn.query_row(LONG_QUERY, [], |row| row.get::<_, i64>(0));
            (result, started.elapsed())
        });
        receiver.recv().expect("job started");
        std::thread::sleep(Duration::from_millis(50));
        stop_earlier_work();
        let (result, elapsed) = job.join().expect("job thread");
        let error = result.expect_err("an earlier epoch's statement must stop");
        assert_eq!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::OperationInterrupted)
        );
        assert!(
            elapsed < Duration::from_secs(5),
            "stopped after {elapsed:?}"
        );

        // A job that opted in after the change, and one that never opted in, keep running.
        let current = Connection::open_in_memory().expect("open current connection");
        stop_when_epoch_changes(&current, current_epoch());
        let other = Connection::open_in_memory().expect("open other connection");
        let bounded =
            "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 200000)
                       SELECT count(*) FROM n";
        assert_eq!(
            current
                .query_row(bounded, [], |row| row.get::<_, i64>(0))
                .unwrap(),
            200_000
        );
        assert_eq!(
            other
                .query_row(bounded, [], |row| row.get::<_, i64>(0))
                .unwrap(),
            200_000
        );

        // A job between statements when the epoch moves fails on its next statement,
        // which a plain sqlite3_interrupt would miss.
        let between = Connection::open_in_memory().expect("open between connection");
        stop_when_epoch_changes(&between, current_epoch());
        between
            .execute_batch("CREATE TABLE t(x)")
            .expect("first statement runs");
        stop_earlier_work();
        let error = between
            .query_row(bounded, [], |row| row.get::<_, i64>(0))
            .expect_err("the next statement must stop");
        assert_eq!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::OperationInterrupted)
        );

        // One job stopped by id ends promptly; another job in the same epoch keeps running.
        a_stopped_job_ends_its_running_statement_and_leaves_other_jobs_running();
    }
}
