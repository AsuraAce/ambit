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

use rusqlite::Connection;
use std::sync::atomic::{AtomicU64, Ordering};

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
    PAGE.fetch_add(1, Ordering::SeqCst);
    stop_earlier_work();
}

/// The app is exiting, or a new page started: jobs from earlier epochs stop at
/// their next database step.
pub fn stop_earlier_work() {
    STOP_EPOCH.fetch_add(1, Ordering::SeqCst);
}

/// Makes every statement on `conn` fail once the epoch is no longer `epoch`.
/// Only use this on a connection that the job opened for itself.
pub fn stop_when_epoch_changes(conn: &Connection, epoch: u64) {
    conn.progress_handler(
        PROGRESS_CHECK_STEPS,
        Some(move || STOP_EPOCH.load(Ordering::SeqCst) != epoch),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    const LONG_QUERY: &str = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n)
                              SELECT count(*) FROM n";

    // The stop epoch is process-wide, so these checks run in one test to keep
    // parallel test threads from advancing it under each other. No other test
    // reads it, and it never changes the page count that claims use.
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
    }
}
