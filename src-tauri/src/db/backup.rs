use std::path::{Path, PathBuf};

use crate::db::{configure_connection, resolve_db_path};
use chrono::{DateTime, Local};
use rusqlite::params;
use std::fs;
use std::io::ErrorKind;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const BACKUP_RETENTION_COUNT: usize = 3;
/// A copy in progress is written under this extension and renamed to `.db` only once it is
/// complete, so an interrupted copy is never listed as a backup (#587).
const PARTIAL_EXTENSION: &str = "partial";
/// Virtual-machine steps between checks of a backup's stop flag.
const STOP_CHECK_STEPS: i32 = 10_000;

/// Why a backup copy produced no backup.
#[derive(Debug)]
pub(crate) enum BackupFailure {
    /// The caller's stop flag ended the copy. Its partial file was deleted.
    Stopped,
    Failed(String),
}

impl From<String> for BackupFailure {
    fn from(message: String) -> Self {
        BackupFailure::Failed(message)
    }
}

/// What the automatic backup did.
#[derive(Debug)]
pub(crate) enum AutoBackupOutcome {
    Created(BackupInfo),
    NotDue,
    Stopped,
}

#[derive(serde::Serialize, specta::Type, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub size_bytes: u64,
}

/// Helper to get the backups directory.
/// Ensures the directory exists.
fn resolve_backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let db_path = resolve_db_path(app)?;
    let parent = db_path
        .parent()
        .ok_or("Failed to get DB parent directory")?;
    let backup_dir = parent.join("backups");

    if !backup_dir.exists() {
        fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    }

    Ok(backup_dir)
}

/// Helper to list backups sorted by date (newest first).
fn list_backups_internal(backup_dir: &PathBuf) -> Result<Vec<BackupInfo>, String> {
    let mut backups = Vec::new();

    let entries = fs::read_dir(backup_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_file() && path.extension().is_some_and(|ext| ext == "db") {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let created = metadata.created().unwrap_or(std::time::SystemTime::now());
            let created_datetime: DateTime<Local> = created.into();

            backups.push(BackupInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.to_string_lossy().to_string(),
                created_at: created_datetime.to_rfc3339(),
                size_bytes: metadata.len(),
            });
        }
    }

    // Sort by created date descending
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(backups)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn get_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let backup_dir = resolve_backup_dir(&app)?;
        list_backups_internal(&backup_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn backup_database(app: tauri::AppHandle) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let backup_dir = resolve_backup_dir(&app)?;
        create_backup_internal(&db_path, &backup_dir, Local::now())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Check if we need to run an auto-backup (first run of the day).
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn check_and_run_autobackup(app: tauri::AppHandle) -> Result<Option<BackupInfo>, String> {
    match run_automatic_backup(app, None).await? {
        AutoBackupOutcome::Created(info) => Ok(Some(info)),
        AutoBackupOutcome::NotDue | AutoBackupOutcome::Stopped => Ok(None),
    }
}

/// The automatic backup: makes a backup if the newest one is at least 24 h old. While `stop`
/// is given and set, the copy ends at its next database step and its partial file is deleted.
pub(crate) async fn run_automatic_backup(
    app: tauri::AppHandle,
    stop: Option<Arc<AtomicBool>>,
) -> Result<AutoBackupOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = resolve_db_path(&app)?;
        let backup_dir = resolve_backup_dir(&app)?;
        run_automatic_backup_in(&db_path, &backup_dir, Local::now(), stop)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn run_automatic_backup_in(
    db_path: &Path,
    backup_dir: &Path,
    now: DateTime<Local>,
    stop: Option<Arc<AtomicBool>>,
) -> Result<AutoBackupOutcome, String> {
    sweep_stale_partials(backup_dir);
    let backups = list_backups_internal(&backup_dir.to_path_buf())?;
    if !backup_is_due(&backups, &now) {
        return Ok(AutoBackupOutcome::NotDue);
    }
    match create_backup(db_path, backup_dir, now, stop) {
        Ok(info) => Ok(AutoBackupOutcome::Created(info)),
        Err(BackupFailure::Stopped) => Ok(AutoBackupOutcome::Stopped),
        Err(BackupFailure::Failed(message)) => Err(message),
    }
}

/// Due when there is no backup, or the newest one is at least 24 h old.
fn backup_is_due(backups: &[BackupInfo], now: &DateTime<Local>) -> bool {
    let Some(latest) = backups.first() else {
        return true;
    };
    match DateTime::parse_from_rfc3339(&latest.created_at) {
        Ok(created) => now.signed_duration_since(created).num_hours() >= 24,
        // Parse error: make a new backup to be safe.
        Err(_) => true,
    }
}

fn create_backup_internal(
    db_path: &Path,
    backup_dir: &Path,
    now: DateTime<Local>,
) -> Result<BackupInfo, String> {
    create_backup(db_path, backup_dir, now, None).map_err(|failure| match failure {
        BackupFailure::Stopped => "Backup stopped".to_string(),
        BackupFailure::Failed(message) => message,
    })
}

/// Copies the database to `<name>.<pid>.partial`, then renames it to its `.db` name. Any
/// failure deletes the partial file, so only a complete copy is ever listed or pruned.
fn create_backup(
    db_path: &Path,
    backup_dir: &Path,
    now: DateTime<Local>,
    stop: Option<Arc<AtomicBool>>,
) -> Result<BackupInfo, BackupFailure> {
    let (filename, backup_path) = resolve_unique_backup_path(backup_dir, &now)?;
    ensure_backup_path_stays_in_dir(backup_dir, &backup_path)?;
    let partial_path = backup_dir.join(partial_file_name(&filename));

    let copied = vacuum_database_into(db_path, &partial_path, stop).and_then(|()| {
        fs::rename(&partial_path, &backup_path)
            .map_err(|e| BackupFailure::Failed(format!("Failed to finish the backup file: {e}")))
    });
    if let Err(failure) = copied {
        let _ = fs::remove_file(&partial_path);
        return Err(failure);
    }
    prune_old_backups(backup_dir);

    let metadata = fs::metadata(&backup_path).map_err(|e| e.to_string())?;

    Ok(BackupInfo {
        name: filename,
        path: backup_path.to_string_lossy().to_string(),
        created_at: now.to_rfc3339(),
        size_bytes: metadata.len(),
    })
}

fn resolve_unique_backup_path(
    backup_dir: &Path,
    now: &DateTime<Local>,
) -> Result<(String, PathBuf), String> {
    let timestamp = now.format("%Y-%m-%d_%H-%M-%S");

    for suffix in 0..10_000 {
        let filename = if suffix == 0 {
            format!("images_{}.db", timestamp)
        } else {
            format!("images_{}_{}.db", timestamp, suffix)
        };
        let backup_path = backup_dir.join(&filename);
        // A copy to this name may still be running in this process.
        if fs::symlink_metadata(backup_dir.join(partial_file_name(&filename))).is_ok() {
            continue;
        }

        match fs::symlink_metadata(&backup_path) {
            Ok(_) => continue,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok((filename, backup_path))
            }
            Err(error) => {
                return Err(format!(
                    "Failed to inspect candidate backup path {}: {}",
                    backup_path.to_string_lossy(),
                    error
                ));
            }
        }
    }

    Err("Failed to find a unique backup filename".to_string())
}

fn ensure_backup_path_stays_in_dir(backup_dir: &Path, backup_path: &Path) -> Result<(), String> {
    let canonical_backup_dir =
        fs::canonicalize(backup_dir).map_err(|e| format!("Failed to resolve backup dir: {}", e))?;
    let backup_parent = backup_path
        .parent()
        .ok_or_else(|| "Backup path has no parent directory".to_string())?;
    let canonical_parent = fs::canonicalize(backup_parent)
        .map_err(|e| format!("Failed to resolve backup path parent: {}", e))?;

    if canonical_parent != canonical_backup_dir {
        return Err("Backup path escaped the backup directory".to_string());
    }

    Ok(())
}

/// Copies the database into `backup_path`. With `stop`, a progress handler on this copy's own
/// connection ends the `VACUUM INTO` once the flag is set. Only an end that handler caused is
/// [`BackupFailure::Stopped`]; any other error is [`BackupFailure::Failed`].
fn vacuum_database_into(
    db_path: &Path,
    backup_path: &Path,
    stop: Option<Arc<AtomicBool>>,
) -> Result<(), BackupFailure> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    configure_connection(&conn).map_err(|e| e.to_string())?;

    let stopped_copy = Arc::new(AtomicBool::new(false));
    if let Some(stop) = stop {
        let stopped_copy = stopped_copy.clone();
        conn.progress_handler(
            STOP_CHECK_STEPS,
            Some(move || {
                let stopping = stop.load(Ordering::SeqCst);
                if stopping {
                    stopped_copy.store(true, Ordering::SeqCst);
                }
                stopping
            }),
        );
    }

    let backup_path = backup_path.to_string_lossy().to_string();
    match conn.execute("VACUUM INTO ?1", params![backup_path]) {
        Ok(_) => Ok(()),
        Err(_) if stopped_copy.load(Ordering::SeqCst) => Err(BackupFailure::Stopped),
        Err(error) => Err(BackupFailure::Failed(error.to_string())),
    }
}

fn partial_file_name(filename: &str) -> String {
    format!("{filename}.{}.{PARTIAL_EXTENSION}", std::process::id())
}

/// Deletes partial backup files that earlier processes left behind (a crash or exit during a
/// copy). This process's own partial files are kept: a manual backup may be copying.
fn sweep_stale_partials(backup_dir: &Path) {
    let own_suffix = format!(".{}.{PARTIAL_EXTENSION}", std::process::id());
    let Ok(entries) = fs::read_dir(backup_dir) else {
        return;
    };
    let (mut removed, mut skipped) = (0usize, 0usize);
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_partial = path.extension().is_some_and(|ext| ext == PARTIAL_EXTENSION);
        if !is_partial || name.ends_with(&own_suffix) || !path.is_file() {
            continue;
        }
        // A file another process still has open cannot be removed; leave it for a later launch.
        match fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(_) => skipped += 1,
        }
    }
    if removed + skipped > 0 {
        log::info!(
            "[Backup] Removed {removed} partial backup file(s) left by an earlier run, skipped {skipped}"
        );
    }
}

fn prune_old_backups(backup_dir: &Path) {
    let Ok(backups) = list_backups_internal(&backup_dir.to_path_buf()) else {
        return;
    };

    if backups.len() <= BACKUP_RETENTION_COUNT {
        return;
    }

    for backup in &backups[BACKUP_RETENTION_COUNT..] {
        let _ = fs::remove_file(&backup.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_backup_internal, list_backups_internal, partial_file_name,
        resolve_unique_backup_path, run_automatic_backup_in, sweep_stale_partials,
        vacuum_database_into, AutoBackupOutcome, BackupFailure,
    };
    use chrono::Local;
    use rusqlite::Connection;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    /// A source database of about `megabytes` MB, so a copy of it takes a measurable time.
    fn source_db(dir: &Path, megabytes: usize) -> PathBuf {
        let db_path = dir.join("source.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("CREATE TABLE sample (id INTEGER PRIMARY KEY, value BLOB)")
            .unwrap();
        conn.execute(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
             INSERT INTO sample (value) SELECT randomblob(1024) FROM n",
            [megabytes * 1024],
        )
        .unwrap();
        db_path
    }

    fn files_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    // An owner-cache build that starts during the automatic backup ran several times slower
    // (#587), so a pause stops the copy. The stop must come within moments of the flag, and the
    // half-written copy must never be listed as a backup: the 24 h check and pruning read that list.
    #[test]
    fn a_copy_stopped_mid_way_ends_quickly_and_leaves_no_backup_file() {
        let temp_root = temp_dir("stopped_copy");
        let backup_dir = temp_root.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();
        let db_path = source_db(&temp_root, 128);

        let stop = Arc::new(AtomicBool::new(false));
        let setter = {
            let stop = stop.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(100));
                stop.store(true, Ordering::SeqCst);
                Instant::now()
            })
        };
        let outcome = run_automatic_backup_in(&db_path, &backup_dir, Local::now(), Some(stop));
        let returned = Instant::now();
        let flag_set = setter.join().unwrap();

        assert!(
            matches!(outcome, Ok(AutoBackupOutcome::Stopped)),
            "the copy was not stopped (finished before the flag, or failed): {outcome:?}"
        );
        let stop_latency = returned.saturating_duration_since(flag_set);
        eprintln!("backup stop latency after the flag: {stop_latency:?}");
        assert!(
            stop_latency < Duration::from_secs(2),
            "the copy took {stop_latency:?} to stop"
        );
        assert!(
            list_backups_internal(&backup_dir).unwrap().is_empty(),
            "the stopped copy is listed as a backup"
        );
        assert!(
            files_in(&backup_dir).is_empty(),
            "the stopped copy left files: {:?}",
            files_in(&backup_dir)
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    // The retry after a pause clears must give the user exactly one good backup for the day.
    #[test]
    fn a_retry_after_a_stopped_copy_makes_exactly_one_good_backup() {
        let temp_root = temp_dir("retry_after_stop");
        let backup_dir = temp_root.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();
        // Large enough that the copy reaches the stop check, which runs every 10,000 steps.
        let db_path = source_db(&temp_root, 16);

        let stop = Arc::new(AtomicBool::new(true));
        let first =
            run_automatic_backup_in(&db_path, &backup_dir, Local::now(), Some(stop.clone()));
        assert!(matches!(first, Ok(AutoBackupOutcome::Stopped)), "{first:?}");

        stop.store(false, Ordering::SeqCst);
        let retry =
            run_automatic_backup_in(&db_path, &backup_dir, Local::now(), Some(stop.clone()));
        assert!(
            matches!(retry, Ok(AutoBackupOutcome::Created(_))),
            "{retry:?}"
        );
        let again = run_automatic_backup_in(&db_path, &backup_dir, Local::now(), Some(stop));
        assert!(matches!(again, Ok(AutoBackupOutcome::NotDue)), "{again:?}");

        let backups = list_backups_internal(&backup_dir).unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(files_in(&backup_dir), vec![backups[0].name.clone()]);
        let rows: i64 = Connection::open(&backups[0].path)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sample", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 16 * 1024);

        let _ = fs::remove_dir_all(temp_root);
    }

    // Only the caller's stop counts as a stop to retry; any other error is a real failure.
    #[test]
    fn a_copy_that_fails_without_a_stop_is_a_failure_not_a_stop() {
        let temp_root = temp_dir("failed_copy");
        let backup_dir = temp_root.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();
        let db_path = source_db(&temp_root, 1);
        let occupied = backup_dir.join("occupied.db");
        fs::write(&occupied, b"not empty").unwrap();

        let outcome =
            vacuum_database_into(&db_path, &occupied, Some(Arc::new(AtomicBool::new(false))));
        assert!(
            matches!(outcome, Err(BackupFailure::Failed(_))),
            "{outcome:?}"
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    // A crash or exit during a copy leaves a partial file. The next launch removes it, but must
    // not touch a copy this process is still making, nor any finished backup.
    #[test]
    fn the_sweep_removes_partials_from_earlier_runs_only() {
        let temp_root = temp_dir("sweep");
        fs::create_dir_all(&temp_root).unwrap();
        let stale = "images_2026-01-01_00-00-00.db.1.partial";
        let own = partial_file_name("images_2026-01-02_00-00-00.db");
        let finished = "images_2026-01-03_00-00-00.db";
        for name in [stale, own.as_str(), finished, "notes.txt"] {
            fs::write(temp_root.join(name), b"x").unwrap();
        }
        let listed = list_backups_internal(&temp_root).unwrap();
        assert_eq!(listed.len(), 1, "a partial file was listed as a backup");

        sweep_stale_partials(&temp_root);

        let mut expected = vec![own, finished.to_string(), "notes.txt".to_string()];
        expected.sort();
        assert_eq!(files_in(&temp_root), expected);

        let _ = fs::remove_dir_all(temp_root);
    }

    // Manual backups share the partial-then-rename path and keep producing a listed backup.
    #[test]
    fn a_manual_backup_is_renamed_into_place() {
        let temp_root = temp_dir("manual");
        let backup_dir = temp_root.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();
        let db_path = source_db(&temp_root, 1);

        let info = create_backup_internal(&db_path, &backup_dir, Local::now()).unwrap();

        assert_eq!(files_in(&backup_dir), vec![info.name.clone()]);
        assert!(info.size_bytes > 0);

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn vacuum_backup_accepts_paths_with_quotes() {
        let temp_root = temp_dir("quoted_backup");
        let backup_dir = temp_root.join("backups with ' quote");
        fs::create_dir_all(&backup_dir).unwrap();
        let db_path = temp_root.join("source.db");
        let backup_path = backup_dir.join("images_quote's.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute("CREATE TABLE sample (value TEXT)", [])
                .unwrap();
            conn.execute("INSERT INTO sample (value) VALUES ('ok')", [])
                .unwrap();
        }

        vacuum_database_into(&db_path, &backup_path, None).unwrap();

        let backup_conn = Connection::open(&backup_path).unwrap();
        let value: String = backup_conn
            .query_row("SELECT value FROM sample", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "ok");

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn backup_filename_uses_suffix_when_timestamp_collides() {
        let temp_root = temp_dir("backup_collision");
        fs::create_dir_all(&temp_root).unwrap();
        let now = Local::now();
        let timestamp = now.format("%Y-%m-%d_%H-%M-%S");
        fs::write(
            temp_root.join(format!("images_{}.db", timestamp)),
            b"existing",
        )
        .unwrap();
        fs::write(
            temp_root.join(format!("images_{}_1.db", timestamp)),
            b"existing",
        )
        .unwrap();

        let (filename, path) = resolve_unique_backup_path(&temp_root, &now).unwrap();

        assert_eq!(filename, format!("images_{}_2.db", timestamp));
        assert_eq!(path, temp_root.join(&filename));

        let _ = fs::remove_dir_all(temp_root);
    }

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ambit_backup_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
