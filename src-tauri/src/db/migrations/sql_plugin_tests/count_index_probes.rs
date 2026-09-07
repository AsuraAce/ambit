//! One fixed, opt-in probe campaign. All tuning is confined to generated held connections.
use super::super::super as plugin;
use super::super::*;
use sqlx::{Column, Row};
use std::time::Duration;

#[path = "connection_policy.rs"]
mod connection_policy;

const CASES: [&str; 8] = [
    "ipc-maintenance",
    "ipc-pair",
    "ipc-light",
    "held-alone-default",
    "held-alone-legacy",
    "held-default",
    "held-maintenance-legacy",
    "held-collection-legacy",
];

fn probe_schedule() -> Vec<Value> {
    let mut keys = Vec::new();
    for round in 0..6 {
        let order: Vec<_> = if round % 2 == 0 {
            (0..CASES.len()).collect()
        } else {
            (0..CASES.len()).rev().collect()
        };
        for i in order {
            for indexed in if round % 2 == 0 {
                [false, true]
            } else {
                [true, false]
            } {
                for read in 0..6 {
                    for q in 0..2 {
                        if q == 0
                            && (CASES[i] == "ipc-maintenance" || CASES[i].starts_with("held-alone"))
                        {
                            continue;
                        }
                        keys.push(json!([CASES[i], indexed, round, read, q]));
                    }
                }
            }
        }
    }
    keys
}

fn validate_probe_samples(records: &[Value]) -> bool {
    let keys = probe_schedule();
    records.len() == keys.len()
        && records.iter().zip(keys).all(|(v, key)| {
            if json!([v["case"], v["indexed"], v["round"], v["read"], v["query"]]) != key {
                return false;
            }
            let t = &v["timing"];
            if v["case"].as_str().unwrap().starts_with("ipc-") {
                match (
                    t["dispatch_ms"].as_f64(),
                    t["dispatch_return_ms"].as_f64(),
                    t["callback_ms"].as_f64(),
                    t["caller_ms"].as_f64(),
                ) {
                    (Some(d), Some(r), Some(c), Some(e)) => valid_timing(d, r, c, e),
                    _ => false,
                }
            } else {
                t["held_execution_and_decode_ms"]
                    .as_f64()
                    .is_some_and(|n| n.is_finite() && n >= 0.)
            }
        })
}

fn expected_settings(case: &str, slot: usize) -> Value {
    let tuned = match case {
        "held-alone-legacy" | "held-maintenance-legacy" => Some(1),
        "held-collection-legacy" => Some(0),
        _ => None,
    };
    if tuned == Some(slot) {
        json!({"journal_mode":"wal","busy_timeout":60000,"cache_size":-64000,"mmap_size":268435456,"synchronous":1,"temp_store":2})
    } else {
        json!({"journal_mode":"wal","busy_timeout":5000,"cache_size":-2000,"mmap_size":0,"synchronous":2,"temp_store":0})
    }
}

fn valid_held_record(v: &Value, kind: &str) -> bool {
    let Some(case) = v["case"].as_str() else {
        return false;
    };
    let Some(slot) = v["slot"].as_u64() else {
        return false;
    };
    if !CASES[3..].contains(&case)
        || slot > 1
        || !v["indexed"].is_boolean()
        || !v["round"].as_u64().is_some_and(|n| n < 6)
    {
        return false;
    }
    if kind == "count-diag-held-settings" {
        v["settings"] == expected_settings(case, slot as usize)
    } else {
        v["ms"].as_f64().is_some_and(|n| n.is_finite() && n >= 0.)
    }
}

#[test]
fn diagnostic_probe_evidence_requires_complete_ordered_pairs() {
    let held = json!({"case":"held-maintenance-legacy","slot":1,"round":0,"indexed":false,
        "settings":expected_settings("held-maintenance-legacy",1)});
    assert!(valid_held_record(&held, "count-diag-held-settings"));
    let mut changed = held.clone();
    changed["settings"]["cache_size"] = json!(-2000);
    assert!(!valid_held_record(&changed, "count-diag-held-settings"));
    let mut changed = held;
    changed["slot"] = json!(0);
    assert!(!valid_held_record(&changed, "count-diag-held-settings"));
    let records:Vec<_>=probe_schedule().into_iter().map(|k|json!({"case":k[0],"indexed":k[1],"round":k[2],"read":k[3],"query":k[4],
        "timing":{"dispatch_ms":0.,"dispatch_return_ms":1.,"callback_ms":2.,"caller_ms":3.,"held_execution_and_decode_ms":1.}})).collect();
    assert_eq!(records.len(), 936);
    assert!(validate_probe_samples(&records));
    assert!(!validate_probe_samples(&records[1..]));
    let mut changed = records.clone();
    changed[1] = changed[0].clone();
    assert!(!validate_probe_samples(&changed));
    let mut changed = records.clone();
    changed.swap(0, 2);
    assert!(!validate_probe_samples(&changed));
    let mut changed = records;
    changed[0]["timing"] = json!({});
    assert!(!validate_probe_samples(&changed));
}

#[test]
#[ignore = "read-only validation of retained probe evidence; no measurements"]
fn count_diagnostic_validate_probe_log() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/count-diag-probes.log");
    let log = std::fs::read_to_string(path).unwrap();
    let values: Vec<Value> = log
        .lines()
        .filter_map(|l| l.find('{').map(|i| &l[i..]))
        .filter(|l| l.contains("\"kind\""))
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let samples: Vec<_> = values
        .iter()
        .filter(|v| v["kind"] == "count-diag-probe")
        .cloned()
        .collect();
    assert!(validate_probe_samples(&samples));
    let complete: Vec<_> = values
        .iter()
        .filter(|v| v["kind"] == "count-diag-probes-complete")
        .collect();
    assert_eq!(complete.len(), 1);
    assert_eq!(complete[0]["samples"], 936);
    assert_eq!(complete[0]["qualification"], false);
    assert_eq!(values.last().unwrap()["kind"], "count-diag-probes-complete");
    assert_eq!(
        values
            .iter()
            .filter(|v| v["kind"] == "count-diag-plan")
            .count(),
        4
    );
    for kind in ["count-diag-held-settings", "count-diag-acquire"] {
        let selected: Vec<_> = values.iter().filter(|v| v["kind"] == kind).collect();
        assert_eq!(selected.len(), 120);
        assert!(selected.iter().all(|v| valid_held_record(v, kind)));
        let keys: std::collections::BTreeSet<_> = selected
            .iter()
            .map(|v| json!([v["case"], v["indexed"], v["round"], v["slot"]]).to_string())
            .collect();
        assert_eq!(keys.len(), 120);
    }
}

fn valid_timing(dispatch: f64, returned: f64, callback: f64, caller: f64) -> bool {
    [dispatch, returned, callback, caller]
        .iter()
        .all(|n| n.is_finite() && *n >= 0.)
        && dispatch <= returned
        && dispatch <= callback
        && returned <= caller
        && callback <= caller
}

fn traced_ipc(
    view: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    db: &str,
    query: &str,
) -> (Vec<Value>, Value) {
    let start = Instant::now();
    let request = tauri::webview::InvokeRequest {
        cmd: "plugin:sql|select".into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: tauri::ipc::InvokeBody::Json(json!({"db":db,"query":query,"values":[]})),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.into(),
    };
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let dispatch = start.elapsed().as_secs_f64() * 1000.;
    view.as_ref().clone().on_message(
        request,
        Box::new(move |_, _, response, _, _| {
            let callback = start.elapsed().as_secs_f64() * 1000.;
            let _ = tx.send((response, callback));
        }),
    );
    let returned = start.elapsed().as_secs_f64() * 1000.;
    let (response, callback) = rx
        .recv_timeout(Duration::from_secs(60))
        .expect("probe callback timeout");
    let value: Value = match response {
        tauri::ipc::InvokeResponse::Ok(body) => body.deserialize().unwrap(),
        tauri::ipc::InvokeResponse::Err(_) => panic!("generated probe query failed"),
    };
    let caller = start.elapsed().as_secs_f64() * 1000.;
    assert!(valid_timing(dispatch, returned, callback, caller));
    (
        sorted_rows(value),
        json!({"dispatch_ms":dispatch,"dispatch_return_ms":returned,
        "callback_ms":callback,"caller_ms":caller,"callback_to_caller_ms":caller-callback}),
    )
}

#[test]
fn diagnostic_transport_timing_rejects_invalid_boundaries() {
    assert!(valid_timing(0., 1., 2., 3.));
    assert!(valid_timing(0., 2., 1., 3.)); // Synchronous callback can precede dispatch return.
    assert!(!valid_timing(1., 0., 2., 3.));
    assert!(!valid_timing(0., 1., 3., 2.));
    assert!(!valid_timing(0., f64::NAN, 2., 3.));
}

#[test]
fn diagnostic_transport_preserves_actual_plugin_response() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&directory.path.join("transport.db"));
    assert_eq!(
        traced_ipc(&sql.webview, &db, "SELECT 1 AS value").0,
        sorted_rows(ipc(
            &sql.webview,
            "select",
            json!({"db":db,"query":"SELECT 1 AS value","values":[]})
        ))
    );
}

async fn held_query(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    query: &str,
) -> (Vec<Value>, Value) {
    let start = Instant::now();
    let rows = sqlx::query(query).fetch_all(&mut **conn).await.unwrap();
    let values: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut value = json!({});
            for column in row.columns() {
                value[column.name()] = if column.name() == "collection_id" {
                    json!(row.get::<String, _>(column.ordinal()))
                } else {
                    json!(row.get::<i64, _>(column.ordinal()))
                };
            }
            value
        })
        .collect();
    let ms = start.elapsed().as_secs_f64() * 1000.;
    (
        sorted_rows(json!(values)),
        json!({"held_execution_and_decode_ms":ms}),
    )
}

fn probe_sample(
    template: &Path,
    expected: &[Vec<Value>; 2],
    indexed: bool,
    round: usize,
    case: &str,
) {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("probe.db");
    std::fs::copy(template, &path).unwrap();
    {
        let conn = Connection::open(&path).unwrap();
        if indexed {
            conn.execute_batch(plugin::narrow_count_experiment::INDEX)
                .unwrap();
        }
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
    }
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    let queries = [production_collection_stats_query(), maintenance_count_sql()];
    let light = "SELECT 1 AS value";
    let emit = |read: usize, q: usize, result: (Vec<Value>, Value)| {
        assert_eq!(
            result.0,
            if case == "ipc-light" {
                vec![json!({"value":1})]
            } else {
                expected[q].clone()
            }
        );
        println!(
            "{}",
            json!({"kind":"count-diag-probe","case":case,"indexed":indexed,
            "round":round,"read":read,"query":q,"timing":result.1})
        );
    };
    if case.starts_with("ipc-") {
        configure_via_ipc(&sql, &db);
        for read in 0..6 {
            if case == "ipc-maintenance" {
                emit(read, 1, traced_ipc(&sql.webview, &db, queries[1]));
            } else {
                let barrier = std::sync::Barrier::new(2);
                std::thread::scope(|scope| {
                    let handles: Vec<_> = (0..2)
                        .map(|q| {
                            let view = &sql.webview;
                            let db = &db;
                            let barrier = &barrier;
                            let query = if case == "ipc-light" {
                                light
                            } else {
                                queries[q]
                            };
                            scope.spawn(move || {
                                barrier.wait();
                                traced_ipc(view, db, query)
                            })
                        })
                        .collect();
                    for (q, h) in handles.into_iter().enumerate() {
                        emit(read, q, h.join().unwrap());
                    }
                });
            }
        }
    } else {
        let pool = sql.pool(&db);
        tauri::async_runtime::block_on(async {
            let mut held = Vec::new();
            for slot in 0..2 {
                let start = Instant::now();
                held.push(pool.acquire().await.unwrap());
                println!(
                    "{}",
                    json!({"kind":"count-diag-acquire","case":case,"indexed":indexed,"round":round,"slot":slot,"ms":start.elapsed().as_secs_f64()*1000.})
                );
            }
            let tuned = match case {
                "held-alone-legacy" | "held-maintenance-legacy" => Some(1),
                "held-collection-legacy" => Some(0),
                _ => None,
            };
            if let Some(slot) = tuned {
                // WAL is already shared by the generated catalog; swap only local settings.
                for pragma in plugin::frontend_pragmas().into_iter().skip(1) {
                    sqlx::query(pragma).execute(&mut *held[slot]).await.unwrap();
                }
            }
            // Snapshot these same retained physical connections; do not infer IPC assignments.
            for (slot, conn) in held.iter_mut().enumerate() {
                let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
                    .fetch_one(&mut **conn)
                    .await
                    .unwrap();
                assert_eq!(journal, "wal");
                let mut settings = json!({"journal_mode":journal});
                for key in [
                    "busy_timeout",
                    "cache_size",
                    "mmap_size",
                    "synchronous",
                    "temp_store",
                ] {
                    let value: i64 = sqlx::query_scalar(&format!("PRAGMA {key}"))
                        .fetch_one(&mut **conn)
                        .await
                        .unwrap();
                    settings[key] = json!(value);
                }
                assert_eq!(
                    settings,
                    expected_settings(case, slot),
                    "actual retained connection matches the experimental condition"
                );
                println!(
                    "{}",
                    json!({"kind":"count-diag-held-settings","case":case,"indexed":indexed,"round":round,"slot":slot,"settings":settings})
                );
            }
            for read in 0..6 {
                if case.starts_with("held-alone") {
                    emit(read, 1, held_query(&mut held[1], queries[1]).await);
                } else {
                    let (left, right) = held.split_at_mut(1);
                    let barrier = std::sync::Barrier::new(2);
                    let (a, b) = std::thread::scope(|scope| {
                        let a = scope.spawn(|| {
                            barrier.wait();
                            tauri::async_runtime::block_on(held_query(&mut left[0], queries[0]))
                        });
                        let b = scope.spawn(|| {
                            barrier.wait();
                            tauri::async_runtime::block_on(held_query(&mut right[0], queries[1]))
                        });
                        (a.join().unwrap(), b.join().unwrap())
                    });
                    emit(read, 0, a);
                    emit(read, 1, b);
                }
            }
            drop(held);
        });
        drop(pool);
    }
}

#[test]
#[ignore = "one fixed generated-only attribution campaign; not qualification"]
fn count_diagnostic_probe_campaign() {
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let directory = GeneratedBenchmarkDir::new();
    let template = directory.path.join("template.db");
    seed_wide(&template, 10_000, 1_000);
    let expected = {
        let conn = Connection::open(&template).unwrap();
        set_scope(&conn, "all", "", true);
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        [production_collection_stats_query(), maintenance_count_sql()]
            .map(|q| sorted_rows(json!(direct_count_rows(&conn, q))))
    };
    for indexed in [false, true] {
        let plan_path = directory
            .path
            .join(if indexed { "plan-b.db" } else { "plan-a.db" });
        std::fs::copy(&template, &plan_path).unwrap();
        let conn = Connection::open(&plan_path).unwrap();
        if indexed {
            conn.execute_batch(plugin::narrow_count_experiment::INDEX)
                .unwrap();
        }
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        for (q, query) in [production_collection_stats_query(), maintenance_count_sql()]
            .iter()
            .enumerate()
        {
            let mut stmt = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {query}"))
                .unwrap();
            let plan: Vec<String> = stmt
                .query_map([], |row| row.get(3))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            println!(
                "{}",
                json!({"kind":"count-diag-plan","indexed":indexed,"query":q,"plan":plan})
            );
        }
    }
    let cases = CASES;
    let start = Instant::now();
    for round in 0..6 {
        let order: Vec<_> = if round % 2 == 0 {
            (0..cases.len()).collect()
        } else {
            (0..cases.len()).rev().collect()
        };
        for i in order {
            for indexed in if round % 2 == 0 {
                [false, true]
            } else {
                [true, false]
            } {
                assert!(
                    start.elapsed().as_secs() < 1500,
                    "remaining measurement budget exhausted"
                );
                probe_sample(&template, &expected, indexed, round, cases[i]);
            }
        }
    }
    println!(
        "{}",
        json!({"kind":"count-diag-probes-complete","samples":936,"qualification":false,"elapsed_ms":start.elapsed().as_secs_f64()*1000.})
    );
}
