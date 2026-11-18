//! Measures how long background facet work keeps user writes out (#464).
//!
//! Ignored by default. Point `AMBIT_464_DB` at a COPY of a large library's
//! `images.db` (never a live profile: the bench writes to it) and run:
//!
//! ```text
//! cargo test --lib lock_bench -- --ignored --nocapture
//! ```
//!
//! A writer thread makes a one-row write every 250 ms with the frontend's 5 s busy
//! timeout while each job runs, and the report gives each job's duration, the
//! writer's worst wait and how many of its writes failed.

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const USER_WRITE_INTERVAL: Duration = Duration::from_millis(250);
const PROBE_WRITE: &str = "UPDATE ambit_464_user_write SET n = n + 1 WHERE id = 1";
// A user masking and unmasking one visible image, as in the owner smoke.
const MASK_WRITE: &str =
    "UPDATE images SET user_masked = CASE WHEN user_masked = 1 THEN 0 ELSE 1 END
     WHERE id = (SELECT target_id FROM ambit_464_user_write WHERE id = 1)";
const USER_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

struct UserWrites {
    latencies_ms: Vec<u128>,
    failures: usize,
}

fn run_with_user_writes(
    db_path: &std::path::Path,
    label: &str,
    user_write: &'static str,
    job: impl FnOnce(&mut rusqlite::Connection) -> Result<String, String>,
) {
    let stop = Arc::new(AtomicBool::new(false));
    let results = Arc::new(Mutex::new(UserWrites {
        latencies_ms: Vec::new(),
        failures: 0,
    }));
    let writer = {
        let stop = stop.clone();
        let results = results.clone();
        let db_path = db_path.to_path_buf();
        std::thread::spawn(move || {
            let user = rusqlite::Connection::open(&db_path).unwrap();
            user.busy_timeout(USER_BUSY_TIMEOUT).unwrap();
            while !stop.load(Ordering::SeqCst) {
                let started = Instant::now();
                let outcome = user.execute(user_write, []);
                let mut results = results.lock().unwrap();
                results.latencies_ms.push(started.elapsed().as_millis());
                if outcome.is_err() {
                    results.failures += 1;
                }
                drop(results);
                std::thread::sleep(USER_WRITE_INTERVAL);
            }
        })
    };

    let mut conn = rusqlite::Connection::open(db_path).unwrap();
    configure_connection(&conn).unwrap();
    let started = Instant::now();
    let outcome = job(&mut conn);
    let elapsed = started.elapsed();
    stop.store(true, Ordering::SeqCst);
    writer.join().unwrap();

    let results = results.lock().unwrap();
    let mut sorted = results.latencies_ms.clone();
    sorted.sort_unstable();
    let p50 = sorted.get(sorted.len() / 2).copied().unwrap_or(0);
    let max = sorted.last().copied().unwrap_or(0);
    println!(
        "[lock-bench] job={label} job_ms={} outcome={} user_writes={} failed={} wait_p50_ms={p50} wait_max_ms={max}",
        elapsed.as_millis(),
        match &outcome {
            Ok(detail) => format!("ok({detail})"),
            Err(error) => format!("err({error})"),
        },
        sorted.len(),
        results.failures,
    );
}

/// The owner-cache repair as the frontend runs it: claim, rebuild, commit, at most two
/// attempts. The commit fails when the scope generation moved during the build.
fn owner_cache_cycle(
    conn: &mut rusqlite::Connection,
    facet_types: &[String],
) -> Result<String, String> {
    let scope_key: String = conn
        .query_row(
            "SELECT active_scope_key FROM invoke_scope_cache_control WHERE state_key = 'current'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("no active owner scope: {e}"))?;
    let mut failures = 0;
    for attempt in 1..=2 {
        conn.execute(
            "UPDATE invoke_scope_cache_state SET status = 'building', build_session_id = 'lock-bench'
             WHERE scope_key = ?1",
            [&scope_key],
        )
        .map_err(|e| e.to_string())?;
        let generation: i64 = conn
            .query_row(
                "SELECT generation FROM invoke_scope_cache_state WHERE scope_key = ?1",
                [&scope_key],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        rebuild_incremental_facet_types(conn, facet_types)?;
        let committed = conn
            .execute(
                "UPDATE invoke_scope_cache_state
                 SET status = 'ready', built_generation = ?2, build_session_id = NULL
                 WHERE scope_key = ?1 AND status = 'building' AND generation = ?2
                   AND build_session_id = 'lock-bench'",
                rusqlite::params![&scope_key, generation],
            )
            .map_err(|e| e.to_string())?;
        if committed == 1 {
            return Ok(format!("committed on attempt {attempt}, {failures} failed"));
        }
        failures += 1;
        conn.execute(
            "UPDATE invoke_scope_cache_state SET status = 'dirty', build_session_id = NULL
             WHERE scope_key = ?1",
            [&scope_key],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(format!("not committed, {failures} attempts failed"))
}

fn top_resources(conn: &rusqlite::Connection, limit: usize) -> FacetResourceTouches {
    let mut touches = FacetResourceTouches::default();
    let mut stmt = conn
        .prepare(
            "SELECT facet_type, resource_name FROM main.facet_cache
             ORDER BY count DESC LIMIT ?1",
        )
        .unwrap();
    let rows = stmt
        .query_map([limit as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap();
    for row in rows {
        let (facet_type, name) = row.unwrap();
        match facet_type.as_str() {
            "checkpoints" => touches.checkpoints.push(name),
            "loras" => touches.loras.push(name),
            "embeddings" => touches.embeddings.push(name),
            "hypernetworks" => touches.hypernetworks.push(name),
            "control_nets" => touches.control_nets.push(name),
            "ip_adapters" => touches.ip_adapters.push(name),
            "tools" => touches.tools.push(name),
            _ => {}
        }
    }
    touches
}

struct HoldPrinter;

impl log::Log for HoldPrinter {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Debug
    }

    fn log(&self, record: &log::Record) {
        let message = record.args().to_string();
        if message.contains("write transaction held") {
            println!("[lock-bench] {message}");
        }
    }

    fn flush(&self) {}
}

#[test]
#[ignore = "needs AMBIT_464_DB pointing at a copy of a large library"]
fn lock_bench() {
    let Ok(db_path) = std::env::var("AMBIT_464_DB") else {
        panic!("set AMBIT_464_DB to a copy of images.db");
    };
    let db_path = std::path::PathBuf::from(db_path);
    let _ = log::set_logger(&HoldPrinter);
    log::set_max_level(log::LevelFilter::Debug);

    {
        let setup = rusqlite::Connection::open(&db_path).unwrap();
        configure_connection(&setup).unwrap();
        setup
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS ambit_464_user_write (
                     id INTEGER PRIMARY KEY, n INTEGER NOT NULL, target_id TEXT, target_masked INTEGER
                 );
                 INSERT OR IGNORE INTO ambit_464_user_write (id, n, target_id, target_masked)
                 SELECT 1, 0, id, user_masked FROM scoped_images
                 WHERE invoke_scope_hidden = 0 ORDER BY timestamp DESC LIMIT 1;",
            )
            .unwrap();
        let images: i64 = setup
            .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
            .unwrap();
        let facets: i64 = setup
            .query_row("SELECT COUNT(*) FROM facet_cache", [], |row| row.get(0))
            .unwrap();
        println!("[lock-bench] images={images} facet_cache_rows={facets}");
    }

    run_with_user_writes(&db_path, "idle", PROBE_WRITE, |_| {
        std::thread::sleep(Duration::from_secs(3));
        Ok(String::new())
    });

    // What every mask, the startup privacy refresh and thumbnail consumers run.
    let thumbnail_types: Vec<String> = [
        "checkpoints",
        "loras",
        "embeddings",
        "hypernetworks",
        "controlNets",
        "ipAdapters",
    ]
    .iter()
    .map(|facet_type| facet_type.to_string())
    .collect();
    run_with_user_writes(&db_path, "incremental-six-types", PROBE_WRITE, |conn| {
        rebuild_incremental_facet_types(conn, &thumbnail_types)
            .map(|types| format!("{} types", types.len()))
    });

    // AMBIT_464_SPLIT=1: the same build under each kind of user write, to tell a slow
    // build caused by the writes apart from one caused by the job before it.
    if std::env::var("AMBIT_464_SPLIT").is_ok() {
        for (label, user_write) in [
            ("split-incremental-masks", MASK_WRITE),
            ("split-incremental-probe-after-masks", PROBE_WRITE),
        ] {
            run_with_user_writes(&db_path, label, user_write, |conn| {
                rebuild_incremental_facet_types(conn, &thumbnail_types)
                    .map(|types| format!("{} types", types.len()))
            });
        }
        restore_mask_target(&db_path);
        return;
    }

    // What a selective owner-cache repair runs for up to 64 touched resources.
    let touches = {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        top_resources(&conn, 64)
    };
    run_with_user_writes(&db_path, "resource-refresh-64", PROBE_WRITE, |conn| {
        refresh_live_facet_resources_with_progress(conn, &touches, |_| {})
            .map(|refreshed| format!("{refreshed} rows"))
    });

    // The startup privacy refresh with the keywords the library already has.
    let keywords: Vec<String> = {
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let mut stmt = conn
            .prepare("SELECT keyword FROM privacy_mask_keywords ORDER BY keyword")
            .unwrap();
        let keywords = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap_or_default();
        keywords
    };
    run_with_user_writes(
        &db_path,
        "privacy-refresh-same-keywords",
        PROBE_WRITE,
        |conn| {
            crate::db::commands::image_commands::refresh_privacy_mask_index_for_conn(
                conn, &keywords,
            )
            .map(|result| format!("changed={} updated={}", result.changed, result.updated))
        },
    );

    // The owner-cache repair while the user masks: before #464 the masks failed; now they
    // get in, which moves the scope generation. Report the commit attempts either way.
    run_with_user_writes(
        &db_path,
        "owner-cache-cycle-with-masks",
        MASK_WRITE,
        |conn| owner_cache_cycle(conn, &thumbnail_types),
    );
    run_with_user_writes(&db_path, "owner-cache-cycle-quiet", PROBE_WRITE, |conn| {
        owner_cache_cycle(conn, &thumbnail_types)
    });

    restore_mask_target(&db_path);
}

/// Leaves the mask target as it was.
fn restore_mask_target(db_path: &std::path::Path) {
    let restore = rusqlite::Connection::open(db_path).unwrap();
    restore
        .execute(
            "UPDATE images SET user_masked = (SELECT target_masked FROM ambit_464_user_write WHERE id = 1)
             WHERE id = (SELECT target_id FROM ambit_464_user_write WHERE id = 1)",
            [],
        )
        .unwrap();
}
