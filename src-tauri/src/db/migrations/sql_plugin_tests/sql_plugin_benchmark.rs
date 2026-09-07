//! A/B IPC benchmark for the SQL-plugin registry and per-connection tuning.
//! It creates only deterministic, generated databases under the system temp directory.

use super::{
    acquire_connections, ipc, maintenance_count_sql, pragma_snapshots, sorted_rows, MockSql,
};
use crate::db::migrations::{
    collection_stats_query_tests::{seed_catalog, set_scope, Shape, SHAPES},
    tests::GeneratedBenchmarkDir,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{Arc, Barrier},
    time::Instant,
};

const MODE_ENV: &str = "AMBIT_SQL_PLUGIN_BENCHMARK_MODE";
const PROFILE_ENV: &str = "AMBIT_SQL_PLUGIN_BENCHMARK_PROFILE";
const PROBE_IMAGES_ENV: &str = "AMBIT_SQL_PLUGIN_BENCHMARK_PROBE_IMAGES";
const BASELINE_PRAGMAS: [&str; 6] = [
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = NORMAL",
    "PRAGMA busy_timeout = 60000",
    "PRAGMA cache_size = -64000",
    "PRAGMA temp_store = MEMORY",
    "PRAGMA mmap_size = 268435456",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BenchmarkMode {
    Baseline,
    Candidate,
}

impl BenchmarkMode {
    fn from_environment() -> Self {
        match std::env::var(MODE_ENV).as_deref() {
            Ok("baseline") | Err(_) => Self::Baseline,
            Ok("candidate") => Self::Candidate,
            Ok(other) => panic!("{MODE_ENV} must be baseline or candidate, received {other:?}"),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Baseline => "baseline",
            Self::Candidate => "candidate",
        }
    }
}

fn benchmark_profile(mode: BenchmarkMode) -> &'static str {
    let configured = std::env::var(PROFILE_ENV).ok();
    match (mode, configured.as_deref()) {
        (BenchmarkMode::Baseline, None | Some("legacy")) => "legacy",
        (BenchmarkMode::Candidate, None | Some("lock-only")) => "lock-only",
        (_, Some(other)) => panic!("unsupported {PROFILE_ENV} value {other:?}"),
    }
}

#[derive(Clone, Copy)]
struct Cell {
    name: &'static str,
    shape: Shape,
    scope: &'static str,
    owner: &'static str,
    local_only: bool,
}

const CELLS: [Cell; 6] = [
    Cell {
        name: "representative/all-users",
        shape: SHAPES[0],
        scope: "all",
        owner: "",
        local_only: false,
    },
    Cell {
        name: "representative/selected-owner",
        shape: SHAPES[0],
        scope: "owner",
        owner: "a",
        local_only: false,
    },
    Cell {
        name: "representative/non-invoke",
        shape: SHAPES[0],
        scope: "none",
        owner: "",
        local_only: true,
    },
    Cell {
        name: "small/all-users",
        shape: SHAPES[3],
        scope: "all",
        owner: "",
        local_only: false,
    },
    Cell {
        name: "small/selected-owner",
        shape: SHAPES[3],
        scope: "owner",
        owner: "a",
        local_only: false,
    },
    Cell {
        name: "small/non-invoke",
        shape: SHAPES[3],
        scope: "none",
        owner: "",
        local_only: true,
    },
];

fn queries() -> [&'static str; 2] {
    [
        crate::db::migrations::tests::production_collection_stats_query(),
        maintenance_count_sql(),
    ]
}

fn configure_baseline_via_ipc(sql: &MockSql, db: &str) {
    for query in BASELINE_PRAGMAS {
        ipc(
            &sql.webview,
            "execute",
            json!({"db":db,"query":query,"values":[]}),
        );
    }
}

fn direct_rows(path: &Path, cell: &Cell) -> ([Vec<Value>; 2], i64) {
    let direct =
        rusqlite::Connection::open(path).expect("open generated catalog for expected rows");
    set_scope(&direct, cell.scope, cell.owner, true);
    let catalog_collections = direct
        .query_row("SELECT COUNT(*) FROM collections", [], |row| row.get(0))
        .expect("count generated collections");
    let rows = queries().map(|query| {
        let mut statement = direct
            .prepare(query)
            .expect("prepare unchanged production query");
        let names: Vec<String> = statement
            .column_names()
            .iter()
            .map(|name| (*name).to_owned())
            .collect();
        let rows: Vec<Value> = statement
            .query_map([], |row| {
                let mut value = json!({});
                for (index, name) in names.iter().enumerate() {
                    value[name] = if name == "collection_id" {
                        json!(row.get::<_, String>(index)?)
                    } else {
                        json!(row.get::<_, i64>(index)?)
                    };
                }
                Ok(value)
            })
            .expect("execute unchanged production query")
            .collect::<Result<_, _>>()
            .expect("collect unchanged production query rows");
        sorted_rows(json!(rows))
    });
    (rows, catalog_collections)
}

fn timed_select(sql: &MockSql, db: &str, query: &str) -> (Vec<Value>, f64) {
    let started = Instant::now();
    let rows = ipc(
        &sql.webview,
        "select",
        json!({"db":db,"query":query,"values":[]}),
    );
    let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
    (sorted_rows(rows), elapsed)
}

fn row_hashes(rows: &[Vec<Value>; 2]) -> [String; 2] {
    rows.each_ref().map(|query_rows| {
        let bytes = serde_json::to_vec(query_rows).expect("serialize generated expected rows");
        hex::encode(Sha256::digest(bytes))
    })
}

fn median(values: &[f64]) -> f64 {
    assert!(!values.is_empty(), "median needs at least one value");
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

fn regression_threshold(baseline_median_ms: f64) -> f64 {
    if baseline_median_ms < 200.0 {
        baseline_median_ms + 20.0
    } else {
        baseline_median_ms * 1.1
    }
}

#[test]
fn benchmark_median_and_regression_gate_preserve_approved_thresholds() {
    assert_eq!(median(&[5.0, 1.0, 3.0]), 3.0);
    assert_eq!(median(&[1.0, 7.0, 3.0, 5.0]), 4.0);
    assert_eq!(regression_threshold(100.0), 120.0);
    assert_eq!(regression_threshold(200.0), 220.00000000000003);
}

fn timed_concurrent(sql: &MockSql, db: &str) -> ([(Vec<Value>, f64); 2], f64) {
    let started = Instant::now();
    let results = std::thread::scope(|threads| {
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = queries()
            .into_iter()
            .map(|query| {
                let barrier = Arc::clone(&barrier);
                let view = sql.webview.clone();
                let db = db.to_owned();
                threads.spawn(move || {
                    barrier.wait();
                    let started = Instant::now();
                    let rows = ipc(&view, "select", json!({"db":db,"query":query,"values":[]}));
                    let elapsed = started.elapsed().as_secs_f64() * 1_000.0;
                    (sorted_rows(rows), elapsed)
                })
            })
            .collect();
        barrier.wait();
        let mut results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().expect("join concurrent plugin request"))
            .collect();
        [results.remove(0), results.remove(0)]
    });
    (results, started.elapsed().as_secs_f64() * 1_000.0)
}

fn measure_cell(directory: &GeneratedBenchmarkDir, cell: Cell) -> Value {
    let path = directory
        .path
        .join(format!("{}.db", cell.name.replace('/', "-")));
    seed_catalog(&path, cell.shape, cell.local_only);
    let (expected, catalog_collections) = direct_rows(&path, &cell);
    let expected_row_hashes = row_hashes(&expected);
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    configure_baseline_via_ipc(&sql, &db);
    let pool = sql.pool(&db);
    let runtime = tauri::async_runtime::handle();
    let _runtime_context = runtime.inner().enter();
    let query_sql = queries();

    let mut sequential_first = [0.0; 2];
    for index in [0, 1] {
        let (rows, elapsed) = timed_select(&sql, &db, query_sql[index]);
        assert_eq!(
            rows, expected[index],
            "{} sequential first query {index}",
            cell.name
        );
        sequential_first[index] = elapsed;
    }
    let (concurrent_first, concurrent_first_makespan) = timed_concurrent(&sql, &db);
    for index in 0..2 {
        assert_eq!(
            concurrent_first[index].0, expected[index],
            "{} concurrent first query {index}",
            cell.name
        );
    }
    let mut sequential_warm = [Vec::new(), Vec::new()];
    let mut concurrent_warm = [Vec::new(), Vec::new()];
    let mut concurrent_warm_makespan = Vec::new();
    for round in 0..5 {
        let order = if round % 2 == 0 { [1, 0] } else { [0, 1] };
        for index in order {
            let (rows, elapsed) = timed_select(&sql, &db, query_sql[index]);
            assert_eq!(
                rows, expected[index],
                "{} sequential warm query {index}",
                cell.name
            );
            sequential_warm[index].push(elapsed);
        }
        let (concurrent, concurrent_makespan) = timed_concurrent(&sql, &db);
        concurrent_warm_makespan.push(concurrent_makespan);
        for index in 0..2 {
            assert_eq!(
                concurrent[index].0, expected[index],
                "{} concurrent warm query {index}",
                cell.name
            );
            concurrent_warm[index].push(concurrent[index].1);
        }
    }
    let mut held = acquire_connections(&pool, pool.options().get_max_connections());
    let pragmas = pragma_snapshots(&mut held);
    drop(held);
    json!({
        "cell":cell.name,
        "images":cell.shape.images,
        "memberships":cell.shape.memberships,
        "catalog_collections":catalog_collections,
        "scope":cell.scope,
        "local_only":cell.local_only,
        "pool_max_connections":pool.options().get_max_connections(),
        "pool_pragmas":pragmas,
        "expected_row_counts":expected.map(|rows| rows.len()),
        "expected_row_hashes":expected_row_hashes,
        "first_ipc_after_expected_rows_ms":{"sequential":sequential_first,"concurrent":[concurrent_first[0].1, concurrent_first[1].1]},
        "warm_ipc_total_ms":{"sequential":sequential_warm,"concurrent":concurrent_warm},
        "concurrent_makespan_ms":{"first":concurrent_first_makespan,"warm":concurrent_warm_makespan},
    })
}

fn benchmark_cells() -> Vec<Cell> {
    match std::env::var(PROBE_IMAGES_ENV) {
        Err(_) => CELLS.to_vec(),
        Ok(value) => {
            let images: usize = value
                .parse()
                .unwrap_or_else(|_| panic!("{PROBE_IMAGES_ENV} must be a positive integer"));
            assert!(images > 0, "{PROBE_IMAGES_ENV} must be positive");
            vec![Cell {
                name: "probe/non-invoke",
                shape: Shape {
                    name: "probe",
                    images,
                    memberships: images * 88 / 100,
                },
                scope: "none",
                owner: "",
                local_only: true,
            }]
        }
    }
}

#[cfg(windows)]
pub(super) fn peak_process_memory_bytes() -> Value {
    #[repr(C)]
    struct ProcessMemoryCountersEx {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_usage: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut std::ffi::c_void;
    }
    #[link(name = "psapi")]
    unsafe extern "system" {
        fn GetProcessMemoryInfo(
            process: *mut std::ffi::c_void,
            counters: *mut ProcessMemoryCountersEx,
            size: u32,
        ) -> i32;
    }
    let mut counters = ProcessMemoryCountersEx {
        cb: std::mem::size_of::<ProcessMemoryCountersEx>() as u32,
        page_fault_count: 0,
        peak_working_set_size: 0,
        working_set_size: 0,
        quota_peak_paged_pool_usage: 0,
        quota_paged_pool_usage: 0,
        quota_peak_non_paged_pool_usage: 0,
        quota_non_paged_pool_usage: 0,
        pagefile_usage: 0,
        peak_pagefile_usage: 0,
        private_usage: 0,
    };
    // The documented current-process pseudo-handle and a fully initialized
    // PROCESS_MEMORY_COUNTERS_EX-compatible buffer remain valid for this call.
    let succeeded = unsafe {
        GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters,
            std::mem::size_of::<ProcessMemoryCountersEx>() as u32,
        )
    } != 0;
    if succeeded {
        json!({"peak_working_set_bytes":counters.peak_working_set_size, "peak_pagefile_bytes":counters.peak_pagefile_usage, "private_bytes":counters.private_usage, "scope":"whole benchmark test process; allowance is not a memory ceiling"})
    } else {
        Value::Null
    }
}

#[cfg(not(windows))]
pub(super) fn peak_process_memory_bytes() -> Value {
    Value::Null
}

#[test]
#[ignore = "opt-in A/B SQL-plugin IPC measurement; generated data only, not OS-cold startup"]
fn benchmark_sql_plugin_connection_candidate() {
    let mode = BenchmarkMode::from_environment();
    let profile = benchmark_profile(mode);
    let directory = GeneratedBenchmarkDir::new();
    let cells: Vec<_> = benchmark_cells()
        .into_iter()
        .map(|cell| measure_cell(&directory, cell))
        .collect();
    println!(
        "SQL_PLUGIN_AB_RESULT {}",
        json!({
            "mode":mode.as_str(),
            "profile":profile,
            "plugin_version":"2.4.0",
            "sqlx_version":"0.8.6",
            "queries":["collection-count","maintenance-count"],
            "samples":{"first_ipc_after_expected_rows_per_cell":1,"warm_per_cell":5},
            "cells":cells,
            "peak_process_memory":peak_process_memory_bytes(),
            "limitations":"MockRuntime IPC totals include plugin lookup, registry/pool waiting, query execution and decode. They are not pure SQLite execution or OS-cold startup measurements. Generated fixtures are deterministic but recreated for each executable run."
        })
    );
}
