//! Generated-only, post-migration-80 qualification. No shipping migration is registered.
use super::*;
use std::io::Read;

const BUDGET: Duration = Duration::from_secs(30 * 60);
const CELLS: [(usize, usize, &str, &str); 4] = [
    (10_000, 1_000, "all", ""),
    (10_000, 1_000, "owner", "a"),
    (10_000, 1_000, "none", ""),
    (146_182, 131_741, "all", ""),
];
const INDEX: &str = super::super::super::narrow_count_experiment::INDEX;
const WRITES: [&str; 3] = [
    "INSERT INTO images(id,path,timestamp,invoke_source_id,invoke_owner_id,invoke_scope_hidden,
        original_metadata_json,original_parsed_json,metadata_json,positive_prompt,negative_prompt)
     SELECT 'new-'||substr(id,5),'new-'||path,timestamp,invoke_source_id,invoke_owner_id,invoke_scope_hidden,
        original_metadata_json,original_parsed_json,metadata_json,positive_prompt,negative_prompt
     FROM images ORDER BY id LIMIT 200",
    "UPDATE images SET invoke_owner_id='cost-owner' WHERE id IN (SELECT id FROM images ORDER BY id LIMIT 200)",
    "DELETE FROM images WHERE id IN (SELECT id FROM images ORDER BY id LIMIT 200)",
];

// Delegate deletion policy to the existing guard, retaining outcomes on early unwind.
struct PreparedDirectory {
    inner: GeneratedBenchmarkDir,
    events: std::rc::Rc<std::cell::RefCell<Vec<Value>>>,
    identity: Value,
    outcome: Option<crate::db::migrations::tests::GeneratedCleanupOutcome>,
}
impl std::ops::Deref for PreparedDirectory {
    type Target = GeneratedBenchmarkDir;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}
impl PreparedDirectory {
    fn new(
        events: &std::rc::Rc<std::cell::RefCell<Vec<Value>>>,
        cell: usize,
        arm: Option<usize>,
        candidate: bool,
    ) -> Self {
        Self {
            inner: GeneratedBenchmarkDir::new(),
            events: events.clone(),
            identity: json!({"kind":"cleanup","cell":cell,"arm":arm,"candidate":candidate}),
            outcome: None,
        }
    }
    fn cleanup(&mut self) -> crate::db::migrations::tests::GeneratedCleanupOutcome {
        if let Some(outcome) = self.outcome {
            return outcome;
        }
        let outcome = self.inner.cleanup();
        self.outcome = Some(outcome);
        let mut row = self.identity.clone();
        row["outcome"] = json!(cleanup_label(outcome));
        self.events.borrow_mut().push(row);
        outcome
    }
}
impl Drop for PreparedDirectory {
    fn drop(&mut self) {
        self.cleanup();
    }
}

fn drain_cleanup(
    events: &std::rc::Rc<std::cell::RefCell<Vec<Value>>>,
    report: &mut OwnershipReport,
) -> bool {
    let mut safe = true;
    for row in events.borrow_mut().drain(..) {
        safe &= matches!(row["outcome"].as_str(), Some("removed" | "already-absent"));
        report.record(row);
    }
    safe
}

fn artifact(id: uuid::Uuid, suffix: &str) -> std::path::PathBuf {
    let prefix = if std::env::var("AMBIT_POST_M80_SMOKE").as_deref() == Ok("1") {
        "post-m80-index-smoke"
    } else {
        "post-m80-index"
    };
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join(format!("startup-sql-{prefix}-{id}{suffix}.jsonl"))
}

fn report(id: uuid::Uuid, suffix: &str) -> OwnershipReport {
    OwnershipReport::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(artifact(id, suffix))
            .expect("create-new qualification report"),
    )
}

fn fresh_m80() {
    assert_eq!(
        crate::db::migrations::get_migrations()
            .last()
            .unwrap()
            .version,
        80,
        "qualification is pinned to migration 80; reconcile newer migrations first"
    );
}

// Only a controller-created pipe carries generated reference values and paths; neither
// is persisted in the redacted journal. The parent owns cleanup until child completion.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: uuid::Uuid,
    arm: usize,
    cell: usize,
    pair: usize,
    candidate: bool,
    directory: std::path::PathBuf,
    expected: Vec<Vec<Value>>,
}

fn valid_request(request: &Request) -> bool {
    request.cell < 4
        && request.pair < 6
        && request.arm < 48
        && request.arm / 12 == request.cell
        && request.arm % 12 / 2 == request.pair
        && request.candidate == ((request.arm % 2 == 1) != (request.pair % 2 == 1))
        && request.expected.len() == 4
        && request
            .directory
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.starts_with("ambit-collection-index-benchmark-"))
        && ownership_generated_path(&request.directory, &request.directory.join("overlap.db"))
}

#[test]
#[ignore = "post-m80 controller-owned generated arm; never launch an app"]
fn post_m80_index_worker() {
    fresh_m80();
    let mut input = String::new();
    std::io::stdin()
        .take(65537)
        .read_to_string(&mut input)
        .unwrap();
    assert!(input.len() <= 65536);
    let request: Request = serde_json::from_str(&input).expect("fixed worker request");
    assert!(valid_request(&request), "confined generated worker request");
    assert_eq!(
        std::env::var("AMBIT_POST_M80_ID").unwrap(),
        request.id.to_string()
    );
    let mut report = report(request.id, &format!("-arm-{}", request.arm));
    report.record(
        json!({"kind":"header","protocol":"post-m80-index-v1","evidenceId":request.id,
        "arm":request.arm,"cell":request.cell,"pair":request.pair,"candidate":request.candidate}),
    );
    let start = Instant::now();
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || -> Result<(), &'static str> {
            let queries = super::super::super::count_read_only_probe::generated_trace_queries();
            let mut round = request.arm * 4;
            let measured = overlap_arm_at(
                &request.directory,
                &queries,
                &request.expected,
                request.cell,
                request.pair,
                true,
                &mut round,
                start,
                BUDGET,
                &mut report,
                None,
                true,
            )?;
            for read in 0..4 {
                report.record(json!({"kind":"native-group-span","read":read,"ms":ownership_span(&measured,read)}));
            }
            // Large-catalog write samples use the same prepared copy after read work and
            // always roll back. No fixture generation or copying occurs in this process.
            if request.cell == 3 {
                let conn =
                    Connection::open(request.directory.join("overlap.db")).map_err(|_| "failed")?;
                conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
                PRAGMA synchronous=2; PRAGMA cache_size=-2000; PRAGMA temp_store=0; PRAGMA mmap_size=0;").map_err(|_|"failed")?;
                for (operation, sql) in WRITES.into_iter().enumerate() {
                    let timer = Instant::now();
                    conn.execute_batch("BEGIN").map_err(|_| "failed")?;
                    let changed = conn.execute(sql, []).map_err(|_| "failed")?;
                    conn.execute_batch("ROLLBACK").map_err(|_| "failed")?;
                    if changed != 200 {
                        return Err("result-mismatch");
                    }
                    report.record(
                        json!({"kind":"write-cost","operation":operation,"rows":changed,
                    "ms":timer.elapsed().as_secs_f64()*1000.0,"rolledBack":true}),
                    );
                }
                for (q, query) in queries.iter().enumerate() {
                    if direct_count_rows(&conn, query) != request.expected[q] {
                        return Err("result-mismatch");
                    }
                }
            }
            let memory = super::super::super::sql_plugin_benchmark::peak_process_memory_bytes();
            let working = memory["peak_working_set_bytes"]
                .as_u64()
                .ok_or("incomplete-trace")?;
            let commit = memory["peak_pagefile_bytes"]
                .as_u64()
                .ok_or("incomplete-trace")?;
            if working == 0 || commit == 0 {
                return Err("incomplete-trace");
            }
            report.record(json!({"kind":"memory","peakWorkingSetBytes":working,"peakPrivateCommitBytes":commit,
            "scope":"fresh whole worker process, including count and rollback write work"}));
            Ok(())
        },
    ));
    let status = match outcome {
        Ok(Ok(())) => "completed",
        Ok(Err(s)) => s,
        Err(_) => "failed",
    };
    let status = report.finish(status, start.elapsed(), None);
    assert_eq!(status, "completed", "qualification worker did not complete");
}

fn read_arm(id: uuid::Uuid, arm: usize) -> Result<Vec<Value>, &'static str> {
    let path = artifact(id, &format!("-arm-{arm}"));
    if std::fs::metadata(&path)
        .map_err(|_| "incomplete-trace")?
        .len()
        > 1024 * 1024
    {
        return Err("incomplete-trace");
    }
    let text = std::fs::read_to_string(path).map_err(|_| "incomplete-trace")?;
    let rows: Vec<Value> = text
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .map_err(|_| "incomplete-trace")?;
    if !valid_arm_rows(&rows, id, arm) {
        return Err("incomplete-trace");
    }
    Ok(rows)
}

fn valid_arm_rows(rows: &[Value], id: uuid::Uuid, arm: usize) -> bool {
    if rows.iter().any(|row| {
        row.as_object().is_none_or(|object| {
            object.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "kind"
                        | "sequence"
                        | "protocol"
                        | "evidenceId"
                        | "arm"
                        | "cell"
                        | "pair"
                        | "candidate"
                        | "catalog"
                        | "concurrent"
                        | "stage"
                        | "openingMs"
                        | "preparationMs"
                        | "untreatedDistribution"
                        | "distribution"
                        | "markerPolicy"
                        | "stable"
                        | "closedOriginals"
                        | "markerCalls"
                        | "data"
                        | "read"
                        | "ms"
                        | "nativePairOverlapMs"
                        | "pairOrder"
                        | "operation"
                        | "rows"
                        | "rolledBack"
                        | "peakWorkingSetBytes"
                        | "peakPrivateCommitBytes"
                        | "scope"
                        | "status"
                        | "elapsedMs"
                        | "droppedRecords"
                        | "storageUnavailable"
                )
            })
        })
    }) {
        return false;
    }
    let cell = arm / 12;
    let pair = arm % 12 / 2;
    let candidate = (arm % 2 == 1) != (pair % 2 == 1);
    if arm >= 48
        || rows.first().is_none_or(|r| {
            r["kind"] != "header"
                || r["arm"] != arm
                || r["cell"] != cell
                || r["pair"] != pair
                || r["candidate"] != candidate
                || r["evidenceId"] != id.to_string()
                || r["protocol"] != "post-m80-index-v1"
        })
        || rows.iter().filter(|r| r["kind"] == "header").count() != 1
        || rows.iter().enumerate().any(|(n, r)| r["sequence"] != n)
        || rows.iter().filter(|r| r["kind"] == "terminal").count() != 1
        || rows.last().is_none_or(|r| {
            r["status"] != "completed"
                || r["droppedRecords"] != 0
                || r["storageUnavailable"] != false
        })
    {
        return false;
    }
    for (kind, width) in [("ipc", 8), ("native", 13)] {
        let mut seen = [false; 16];
        for row in rows.iter().filter(|r| r["kind"] == kind) {
            let Some(data) = row["data"].as_array() else {
                return false;
            };
            if data.len() != width || data[0] != cell || data[1] != pair || data[2] != true {
                return false;
            }
            let (Some(read), Some(q), Some(call)) =
                (data[3].as_u64(), data[4].as_u64(), data[5].as_u64())
            else {
                return false;
            };
            if read >= 4 || q >= 4 || call != read * 4 + q + 1 || seen[(call - 1) as usize] {
                return false;
            }
            if kind == "ipc" {
                if nonnegative(&data[6]).is_none() || data[7] != true {
                    return false;
                }
            } else if data[6..].iter().any(|v| nonnegative(v).is_none()) {
                return false;
            }
            seen[(call - 1) as usize] = true;
        }
        if !seen.into_iter().all(|v| v) {
            return false;
        }
    }
    for kind in ["native-group-span", "overlap"] {
        let mut seen = [false; 4];
        for row in rows.iter().filter(|r| r["kind"] == kind) {
            let Some(read) = row["read"].as_u64().filter(|v| *v < 4) else {
                return false;
            };
            if seen[read as usize] {
                return false;
            }
            if kind == "native-group-span" && nonnegative(&row["ms"]).is_none() {
                return false;
            }
            if kind == "overlap"
                && (row["catalog"] != cell
                    || row["pair"] != pair
                    || row["concurrent"] != true
                    || row["pairOrder"] != "01-02-03-12-13-23"
                    || row["nativePairOverlapMs"].as_array().is_none_or(|values| {
                        values.len() != 6 || values.iter().any(|v| nonnegative(v).is_none())
                    }))
            {
                return false;
            }
            seen[read as usize] = true;
        }
        if !seen.into_iter().all(|v| v) {
            return false;
        }
    }
    let pools: Vec<_> = rows.iter().filter(|r| r["kind"] == "pool").collect();
    if pools.len() != 2
        || pools[0]["stage"] != "before"
        || pools[1]["stage"] != "after"
        || pools[1]["stable"] != true
        || pools[1]["closedOriginals"] != 0
        || pools[1]["markerCalls"] != 0
        || pools.iter().any(|r| {
            r["catalog"] != cell
                || r["pair"] != pair
                || r["concurrent"] != true
                || r["distribution"] != json!([["wal", 2, 5000, -2000, 0, 0, 10]])
        })
    {
        return false;
    }
    let memory: Vec<_> = rows.iter().filter(|r| r["kind"] == "memory").collect();
    if memory.len() != 1
        || ["peakWorkingSetBytes", "peakPrivateCommitBytes"]
            .iter()
            .any(|key| memory[0][*key].as_u64().is_none_or(|v| v == 0))
    {
        return false;
    }
    rows.iter().all(|r| {
        matches!(
            r["kind"].as_str(),
            Some(
                "header"
                    | "pool"
                    | "ipc"
                    | "native"
                    | "overlap"
                    | "native-group-span"
                    | "write-cost"
                    | "memory"
                    | "terminal"
            )
        )
    })
}

#[cfg(test)]
fn fake_arm(id: uuid::Uuid, arm: usize, collection: f64, maintenance: f64) -> Vec<Value> {
    let cell = arm / 12;
    let pair = arm % 12 / 2;
    let candidate = (arm % 2 == 1) != (pair % 2 == 1);
    let mut rows = vec![
        json!({"kind":"header","protocol":"post-m80-index-v1","evidenceId":id,
        "arm":arm,"cell":cell,"pair":pair,"candidate":candidate}),
    ];
    for stage in ["before", "after"] {
        rows.push(json!({"kind":"pool","catalog":cell,"pair":pair,
        "concurrent":true,"stage":stage,"distribution":[["wal",2,5000,-2000,0,0,10]],
        "stable":true,"closedOriginals":0,"markerCalls":0}));
    }
    for read in 0..4 {
        for q in 0..4 {
            let ms = [collection, maintenance, 10., 10.][q];
            let call = read * 4 + q + 1;
            rows.push(json!({"kind":"ipc","data":[cell,pair,true,read,q,call,ms+1.,true]}));
            rows.push(
                json!({"kind":"native","data":[cell,pair,true,read,q,call,0.,ms,0.,0.,0.,ms,0.]}),
            );
        }
        rows.push(json!({"kind":"native-group-span","read":read,"ms":collection.max(maintenance).max(10.)}));
        rows.push(
            json!({"kind":"overlap","catalog":cell,"pair":pair,"concurrent":true,"read":read,
            "nativePairOverlapMs":[10.,10.,10.,10.,10.,10.],"pairOrder":"01-02-03-12-13-23"}),
        );
    }
    if cell == 3 {
        for operation in 0..3 {
            rows.push(json!({"kind":"write-cost","operation":operation,"rows":200,"rolledBack":true,"ms":10.}));
        }
    }
    rows.push(
        json!({"kind":"memory","peakWorkingSetBytes":1000000,"peakPrivateCommitBytes":1000000}),
    );
    rows.push(json!({"kind":"terminal","status":"completed","droppedRecords":0,"storageUnavailable":false}));
    for (n, row) in rows.iter_mut().enumerate() {
        row["sequence"] = json!(n);
    }
    rows
}

#[test]
fn post_m80_evidence_rejects_missing_duplicate_foreign_nonfinite_and_private_fields() {
    let id = uuid::Uuid::new_v4();
    let rows = fake_arm(id, 0, 1000., 10.);
    assert!(valid_arm_rows(&rows, id, 0));
    assert!(!valid_arm_rows(&rows, uuid::Uuid::new_v4(), 0));
    assert!(!valid_arm_rows(&rows, id, 1));
    for field in ["catalog", "pair", "concurrent"] {
        let mut bad = rows.clone();
        let row = bad.iter_mut().find(|r| r["kind"] == "overlap").unwrap();
        row[field] = json!(99);
        assert!(!valid_arm_rows(&bad, id, 0));
    }
    let mut bad = rows.clone();
    bad.iter_mut().find(|r| r["kind"] == "ipc").unwrap()["data"][7] = json!(false);
    assert!(!valid_arm_rows(&bad, id, 0));
    let mut bad = rows.clone();
    bad.iter_mut().find(|r| r["kind"] == "native").unwrap()["data"][11] = Value::Null;
    assert!(!valid_arm_rows(&bad, id, 0));
    let mut bad = rows.clone();
    bad[0]["sql"] = json!("private");
    assert!(!valid_arm_rows(&bad, id, 0));
    let mut bad = rows.clone();
    let duplicate = bad.iter().find(|r| r["kind"] == "native").unwrap().clone();
    bad.insert(1, duplicate);
    for (n, row) in bad.iter_mut().enumerate() {
        row["sequence"] = json!(n);
    }
    assert!(!valid_arm_rows(&bad, id, 0));
    let mut bad = rows.clone();
    bad.remove(3);
    for (n, row) in bad.iter_mut().enumerate() {
        row["sequence"] = json!(n);
    }
    assert!(!valid_arm_rows(&bad, id, 0));
}

#[test]
fn post_m80_gates_preserve_old_failure_and_require_six_pairs_and_primary_gain() {
    assert_eq!(BUDGET.as_millis(), 1_800_000);
    assert_eq!(
        CELLS.iter().map(|c| (c.0, c.2)).collect::<Vec<_>>(),
        vec![
            (10000, "all"),
            (10000, "owner"),
            (10000, "none"),
            (146182, "all")
        ]
    );
    let directory = GeneratedBenchmarkDir::new();
    let mut report = OwnershipReport::new(
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(directory.path.join("evidence.jsonl"))
            .unwrap(),
    );
    let id = uuid::Uuid::new_v4();
    let pairs: Vec<_> = (0..6)
        .map(|pair| {
            let baseline = pair * 2 + usize::from(pair % 2 == 1);
            let candidate = pair * 2 + usize::from(pair % 2 == 0);
            [
                fake_arm(id, baseline, 10., 76.985),
                fake_arm(id, candidate, 4., 113.276),
            ]
        })
        .collect();
    assert_eq!(
        check_cell(0, &pairs, &mut report),
        Err("overhead-gate-failed")
    );
    assert_eq!(
        check_cell(0, &pairs[..5], &mut report),
        Err("incomplete-trace")
    );
    let pairs: Vec<_> = (0..6)
        .map(|pair| {
            let baseline = 36 + pair * 2 + usize::from(pair % 2 == 1);
            let candidate = 36 + pair * 2 + usize::from(pair % 2 == 0);
            [
                fake_arm(id, baseline, 1000., 10.),
                fake_arm(id, candidate, 700., 10.),
            ]
        })
        .collect();
    assert!(check_cell(3, &pairs, &mut report).is_ok());
    let mut no_gain = pairs.clone();
    for pair in &mut no_gain {
        for row in &mut pair[1] {
            if row["kind"] == "native" && row["data"][4] == 0 {
                row["data"][11] = json!(850.);
            }
        }
    }
    assert_eq!(
        check_cell(3, &no_gain, &mut report),
        Err("overhead-gate-failed")
    );
}

#[test]
fn post_m80_parent_ownership_records_cleanup_after_panic_and_rejects_foreign_paths() {
    let events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let directory = PreparedDirectory::new(&events, 0, Some(0), false);
        let path = directory.path.join("overlap.db");
        Connection::open(&path).unwrap();
        let mut request = Request {
            id: uuid::Uuid::new_v4(),
            arm: 0,
            cell: 0,
            pair: 0,
            candidate: false,
            directory: directory.path.clone(),
            expected: vec![vec![]; 4],
        };
        assert!(valid_request(&request));
        request.directory = std::env::temp_dir();
        assert!(!valid_request(&request));
        panic!("injected failure");
    }));
    assert!(result.is_err());
    let rows = events.borrow();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["outcome"], "removed");
    assert!(!rows[0].to_string().contains("path"));
}

#[test]
fn post_m80_cost_transactions_roll_back_wide_insert_owner_update_and_delete() {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("cost.db");
    seed_wide(&path, 600, 500);
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    set_scope(&conn, "all", "", true);
    let queries = super::super::super::count_read_only_probe::generated_trace_queries();
    let expected: Vec<_> = queries
        .iter()
        .map(|q| direct_count_rows(&conn, q))
        .collect();
    for indexed in [false, true] {
        if indexed {
            conn.execute_batch(INDEX).unwrap();
        }
        for write in WRITES {
            conn.execute_batch("BEGIN").unwrap();
            assert_eq!(conn.execute(write, []).unwrap(), 200);
            conn.execute_batch("ROLLBACK").unwrap();
            for (q, query) in queries.iter().enumerate() {
                assert_eq!(direct_count_rows(&conn, query), expected[q]);
            }
        }
    }
}

fn metric(
    rows: &[Value],
    kind: &str,
    query: usize,
    warm: bool,
    column: usize,
) -> Result<f64, &'static str> {
    let values: Vec<f64> = rows
        .iter()
        .filter(|r| r["kind"] == kind)
        .filter(|r| r["data"][4] == query && (r["data"][3].as_u64().unwrap_or(99) > 0) == warm)
        .map(|r| nonnegative(&r["data"][column]).ok_or("incomplete-trace"))
        .collect::<Result<_, _>>()?;
    if values.len() != if warm { 3 } else { 1 } {
        return Err("incomplete-trace");
    }
    Ok(median(&values))
}

fn check_cell(
    cell: usize,
    pairs: &[[Vec<Value>; 2]],
    report: &mut OwnershipReport,
) -> Result<(), &'static str> {
    if pairs.len() != 6 {
        return Err("incomplete-trace");
    }
    let mut passed = true;
    for warm in [false, true] {
        for (kind, column, boundary) in [("native", 11, "retrieval"), ("ipc", 6, "ipc")] {
            for query in 0..4 {
                let mut values: [Vec<f64>; 2] = [vec![], vec![]];
                for pair in pairs {
                    for arm in 0..2 {
                        values[arm].push(metric(&pair[arm], kind, query, warm, column)?);
                    }
                }
                let baseline = median(&values[0]);
                let candidate = median(&values[1]);
                let primary = cell == 3 && query == 0 && warm && boundary == "retrieval";
                let gate = if primary {
                    candidate <= baseline * 0.8
                        && baseline - candidate >= 200.0
                        && values[0]
                            .iter()
                            .zip(&values[1])
                            .filter(|(a, b)| b < a)
                            .count()
                            >= 5
                } else {
                    qualifies(baseline, candidate, false)
                };
                report.record(json!({"kind":"comparison","cell":cell,"query":query,"boundary":boundary,"warm":warm,
                    "baseline":values[0],"candidate":values[1],"baselineMedianMs":baseline,"candidateMedianMs":candidate,"passed":gate}));
                passed &= gate;
            }
        }
        let mut spans: [Vec<f64>; 2] = [vec![], vec![]];
        for pair in pairs {
            for arm in 0..2 {
                let values: Vec<f64> = pair[arm]
                    .iter()
                    .filter(|r| r["kind"] == "native-group-span")
                    .filter(|r| (r["read"].as_u64().unwrap_or(99) > 0) == warm)
                    .map(|r| nonnegative(&r["ms"]).ok_or("incomplete-trace"))
                    .collect::<Result<_, _>>()?;
                if values.len() != if warm { 3 } else { 1 } {
                    return Err("incomplete-trace");
                }
                spans[arm].push(median(&values));
            }
        }
        let gate = qualifies(median(&spans[0]), median(&spans[1]), false);
        report.record(json!({"kind":"span-comparison","cell":cell,"warm":warm,"baseline":spans[0],"candidate":spans[1],"passed":gate}));
        passed &= gate;
    }
    if cell == 3 {
        for operation in 0..3 {
            let mut values: [Vec<f64>; 2] = [vec![], vec![]];
            for pair in pairs {
                for arm in 0..2 {
                    let rows: Vec<_> = pair[arm]
                        .iter()
                        .filter(|r| r["kind"] == "write-cost" && r["operation"] == operation)
                        .collect();
                    if rows.len() != 1 || rows[0]["rolledBack"] != true || rows[0]["rows"] != 200 {
                        return Err("incomplete-trace");
                    }
                    values[arm].push(nonnegative(&rows[0]["ms"]).ok_or("incomplete-trace")?);
                }
            }
            let gate = qualifies(median(&values[0]), median(&values[1]), false);
            report.record(json!({"kind":"write-comparison","operation":operation,"baseline":values[0],"candidate":values[1],"passed":gate}));
            passed &= gate;
        }
        for counter in ["peakWorkingSetBytes", "peakPrivateCommitBytes"] {
            let mut values: [Vec<f64>; 2] = [vec![], vec![]];
            for pair in pairs {
                for arm in 0..2 {
                    let rows: Vec<_> = pair[arm].iter().filter(|r| r["kind"] == "memory").collect();
                    if rows.len() != 1 {
                        return Err("incomplete-trace");
                    }
                    values[arm].push(
                        nonnegative(&rows[0][counter])
                            .filter(|v| *v > 0.)
                            .ok_or("incomplete-trace")?,
                    );
                }
            }
            let gate = median(&values[1]) <= median(&values[0]) + 128. * 1024. * 1024.;
            report.record(json!({"kind":"memory-comparison","counter":counter,"baseline":values[0],"candidate":values[1],"passed":gate}));
            passed &= gate;
        }
    }
    if passed {
        Ok(())
    } else {
        Err("overhead-gate-failed")
    }
}

#[test]
#[ignore = "one approved post-m80 index campaign; external controller required"]
fn measure_post_m80_index_once() {
    assert!(std::env::var("AMBIT_POST_M80_SMOKE").is_err());
    run_post_m80(false);
}

#[test]
#[ignore = "tiny generated controller/worker protocol verification, not qualification"]
fn post_m80_index_protocol_smoke() {
    assert_eq!(std::env::var("AMBIT_POST_M80_SMOKE").as_deref(), Ok("1"));
    run_post_m80(true);
}

fn run_post_m80(smoke: bool) {
    fresh_m80();
    let id = uuid::Uuid::parse_str(&std::env::var("AMBIT_POST_M80_ID").expect("use controller"))
        .unwrap();
    let mut report = report(id, "");
    let start = Instant::now();
    let cleanups = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let queries = super::super::super::count_read_only_probe::generated_trace_queries();
    report.record(json!({"kind":"header","protocol":"post-m80-index-v1","evidenceId":id,"budgetMs":BUDGET.as_millis(),
        "purpose":if smoke {"protocol-verification-only"} else {"qualification"},
        "pairs":if smoke {1}else{6},"cells":if smoke {1}else{4},"arms":if smoke {2}else{48},
        "rounds":if smoke {8}else{192},"calls":if smoke {32}else{768},"firstReads":1,"warmReads":3,
        "queryLabels":LABELS,
        "ipcColumns":["cell","pair","concurrent","read","query","callId","ms","exactResultEqual"],
        "nativeColumns":["cell","pair","concurrent","read","query","callId","startedMs","totalMs","registryMs","bindMs","acquireMs","retrievalMs","conversionMs"],
        "poolDistributionColumns":["journalMode","synchronous","busyTimeout","cacheSize","tempStore","mmapSize","connections"],
        "indexHash":digest(INDEX.as_bytes()),"queryHashes":queries.iter().map(|q|digest(q.as_bytes())).collect::<Vec<_>>(),
        "fixtureHash":digest(include_bytes!("count_index_benchmark.rs")),"catalogHash":digest(include_bytes!("../collection_stats_query_tests.rs")),
        "migration80Hash":digest(include_bytes!("../m80_maintenance_count_indexes.rs")),"migrationsHash":digest(include_bytes!("../mod.rs")),
        "harnessHash":digest(include_bytes!("post_m80_index.rs")),
        "measurementHash":digest(include_bytes!("startup_sql_overhead.rs")),"vendorHash":vendor_digest(),
        "boundary":"generated IPC, not OS-cold or startup; retrieval is not pure SQLite execution"}));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || -> Result<(), &'static str> {
            let cells = if smoke {
                &[(600, 500, "all", "")][..]
            } else {
                &CELLS[..]
            };
            for (cell, &(images, memberships, mode, owner)) in cells.iter().enumerate() {
                if start.elapsed() >= BUDGET {
                    return Err("timed-out");
                }
                report.record(json!({"kind":"preparation","cell":cell,"stage":"generation"}));
                let mut baseline_dir = PreparedDirectory::new(&cleanups, cell, None, false);
                let baseline = baseline_dir.path.join("template.db");
                let preparation_start = Instant::now();
                seed_wide(&baseline, images, memberships);
                let expected = {
                    let conn = Connection::open(&baseline).unwrap();
                    if mode == "none" {
                        conn.execute_batch(
                            "UPDATE images SET invoke_source_id=NULL,invoke_owner_id=NULL;
                    DELETE FROM invoke_owner_scope_state;",
                        )
                        .unwrap();
                    } else {
                        set_scope(&conn, mode, owner, true);
                    }
                    conn.execute_batch("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE)")
                        .unwrap();
                    queries
                        .iter()
                        .map(|q| direct_count_rows(&conn, q))
                        .collect::<Vec<_>>()
                };
                let mut candidate_dir = PreparedDirectory::new(&cleanups, cell, None, true);
                report.record(json!({"kind":"preparation-complete","cell":cell,"stage":"generation-and-reference",
                    "elapsedMs":preparation_start.elapsed().as_secs_f64()*1000.,"process":"preparer"}));
                let candidate = candidate_dir.path.join("template.db");
                if !ownership_generated_path(&baseline_dir.path, &baseline) {
                    return Err("invalid-generated-fixture");
                }
                report.record(json!({"kind":"preparation","cell":cell,"stage":"fixture-copy","process":"preparer"}));
                let copy_start = Instant::now();
                std::fs::copy(&baseline, &candidate).map_err(|_| "failed")?;
                report.record(
                    json!({"kind":"preparation-complete","cell":cell,"stage":"fixture-copy",
                    "elapsedMs":copy_start.elapsed().as_secs_f64()*1000.,"process":"preparer"}),
                );
                let before = std::fs::metadata(&candidate).unwrap().len();
                {
                    let conn = Connection::open(&candidate).unwrap();
                    let allocation = |conn: &Connection| {
                        let pages: u64 = conn
                            .query_row("PRAGMA page_count", [], |r| r.get(0))
                            .unwrap();
                        let free: u64 = conn
                            .query_row("PRAGMA freelist_count", [], |r| r.get(0))
                            .unwrap();
                        let size: u64 = conn
                            .query_row("PRAGMA page_size", [], |r| r.get(0))
                            .unwrap();
                        (pages - free) * size
                    };
                    let allocated_before = allocation(&conn);
                    let timer = Instant::now();
                    conn.execute_batch(INDEX).unwrap();
                    let creation_ms = timer.elapsed().as_secs_f64() * 1000.;
                    for (q, query) in queries.iter().enumerate() {
                        if direct_count_rows(&conn, query) != expected[q] {
                            return Err("result-mismatch");
                        }
                    }
                    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                        .unwrap();
                    let added = std::fs::metadata(&candidate)
                        .unwrap()
                        .len()
                        .saturating_sub(before);
                    let allocated = allocation(&conn)
                        .checked_sub(allocated_before)
                        .ok_or("invalid-comparison")?;
                    report.record(
                        json!({"kind":"index-cost","cell":cell,"creationMs":creation_ms,
                        "addedDatabaseBytes":added,"addedAllocatedBytes":allocated}),
                    );
                    if cell == 3 && allocated >= 64 * 1024 * 1024 {
                        return Err("overhead-gate-failed");
                    }
                }
                let mut pairs = Vec::new();
                for pair in 0..if smoke { 1 } else { 6 } {
                    let mut arms: [Option<Vec<Value>>; 2] = [None, None];
                    for (slot, is_candidate) in if pair % 2 == 0 {
                        [false, true]
                    } else {
                        [true, false]
                    }
                    .into_iter()
                    .enumerate()
                    {
                        if start.elapsed() >= BUDGET {
                            return Err("timed-out");
                        }
                        if report.storage_failed || report.dropped != 0 {
                            return Err("incomplete-trace");
                        }
                        let arm = cell * 12 + pair * 2 + slot;
                        let mut directory =
                            PreparedDirectory::new(&cleanups, cell, Some(arm), is_candidate);
                        let source = if is_candidate { &candidate } else { &baseline };
                        if !ownership_generated_path(source.parent().unwrap(), source) {
                            return Err("invalid-generated-fixture");
                        }
                        report.record(json!({"kind":"preparation","cell":cell,"arm":arm,"candidate":is_candidate,
                            "stage":"fixture-copy","process":"preparer"}));
                        let copy_start = Instant::now();
                        std::fs::copy(source, directory.path.join("overlap.db"))
                            .map_err(|_| "failed")?;
                        report.record(json!({"kind":"preparation-complete","cell":cell,"arm":arm,"candidate":is_candidate,
                            "stage":"fixture-copy","process":"preparer","elapsedMs":copy_start.elapsed().as_secs_f64()*1000.}));
                        if !ownership_generated_path(
                            &directory.path,
                            &directory.path.join("overlap.db"),
                        ) {
                            return Err("invalid-generated-fixture");
                        }
                        println!(
                            "AMBIT_POST_M80_ARM {}",
                            json!({"id":id,"arm":arm,"cell":cell,"pair":pair,
                        "candidate":is_candidate,"directory":directory.path,"expected":expected})
                        );
                        std::io::stdout().flush().unwrap();
                        // The external controller owns both process handles and enforces the
                        // campaign/round deadlines. Do not unwind/delete while its child lives.
                        let done = artifact(id, &format!("-arm-{arm}-done"));
                        while !done.exists() {
                            std::thread::sleep(Duration::from_millis(20));
                        }
                        let completion: Value =
                            serde_json::from_slice(&std::fs::read(done).map_err(|_| "failed")?)
                                .map_err(|_| "failed")?;
                        let result = if completion == json!({"completed":true}) {
                            read_arm(id, arm)
                        } else {
                            Err("failed")
                        };
                        let cleanup = cleanup_label(directory.cleanup());
                        drain_cleanup(&cleanups, &mut report);
                        let rows = result?;
                        if !matches!(cleanup, "removed" | "already-absent") {
                            return Err("failed");
                        }
                        for row in &rows {
                            if row["kind"] != "header" && row["kind"] != "terminal" {
                                let mut row = row.clone();
                                row["arm"] = json!(arm);
                                row["candidate"] = json!(is_candidate);
                                report.record(row);
                            }
                        }
                        arms[usize::from(is_candidate)] = Some(rows);
                    }
                    let arms = arms.map(Option::unwrap);
                    let distributions: Vec<_> = arms
                        .iter()
                        .map(|rows| {
                            rows.iter()
                                .filter(|r| r["kind"] == "pool")
                                .map(|r| r["distribution"].clone())
                                .collect::<Vec<_>>()
                        })
                        .collect();
                    if distributions[0].len() != 2 || distributions[0] != distributions[1] {
                        return Err("invalid-comparison");
                    }
                    pairs.push(arms);
                }
                let result = if smoke {
                    Ok(())
                } else {
                    check_cell(cell, &pairs, &mut report)
                };
                for (candidate, directory) in
                    [(false, &mut baseline_dir), (true, &mut candidate_dir)]
                {
                    let cleanup = cleanup_label(directory.cleanup());
                    let _ = candidate;
                    drain_cleanup(&cleanups, &mut report);
                    if !matches!(cleanup, "removed" | "already-absent") {
                        return Err(result.err().unwrap_or("failed"));
                    }
                }
                result?;
            }
            Ok(())
        },
    ));
    let status = match outcome {
        Ok(Ok(())) => "completed",
        Ok(Err(s)) => s,
        Err(_) => "failed",
    };
    let cleanup_ok = drain_cleanup(&cleanups, &mut report);
    let status = if status == "completed" && !cleanup_ok {
        "failed"
    } else {
        status
    };
    let status = report.finish(status, start.elapsed(), None);
    assert_eq!(
        status, "completed",
        "qualification stopped; no automatic rerun or integration"
    );
}
