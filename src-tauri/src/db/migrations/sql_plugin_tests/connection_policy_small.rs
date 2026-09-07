//! Fixed mmap ladder, entered only after the retained attribution gate passes.
use super::*;

#[path = "connection_policy_screen.rs"]
mod screen;
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};

const LEVELS: [i64; 3] = [16 * 1024 * 1024, 32 * 1024 * 1024, 64 * 1024 * 1024];
const WORKER: &str="db::migrations::sql_plugin_tests::count_index_benchmark::diagnosis::probes::connection_policy::small::connection_policy_small_worker";
const MEMORY_ALLOWANCE: u64 = 128 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SmallArm {
    round: usize,
    level: usize,
    arm: usize,
    settings: [[i64; 5]; 2],
    acquisition_ms: [f64; 2],
    reads_ms: [[f64; 6]; 2],
    peak_working_set_bytes: u64,
    peak_private_commit_bytes: u64,
}

fn small_schedule() -> Vec<(usize, usize, usize)> {
    let mut result = Vec::new();
    for round in 0..6 {
        for level in if round % 2 == 0 { [0, 1, 2] } else { [2, 1, 0] } {
            for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                result.push((round, level, arm));
            }
        }
    }
    result
}

fn small_configuration(level: usize, arm: usize) -> [i64; 5] {
    let mut values = DEFAULTS;
    if arm == 1 {
        values[1] = LEVELS[level];
    }
    values
}

fn valid_small(arms: &[SmallArm]) -> bool {
    arms.len() == 36
        && arms.iter().zip(small_schedule()).all(|(a, key)| {
            (a.round, a.level, a.arm) == key
                && a.settings == [small_configuration(a.level, a.arm); 2]
                && a.acquisition_ms
                    .iter()
                    .chain(a.reads_ms.iter().flatten())
                    .all(|v| v.is_finite() && *v >= 0.)
                && a.peak_working_set_bytes > 0
                && a.peak_private_commit_bytes > 0
        })
}

fn small_result(arms: &[SmallArm], level: usize) -> Value {
    let group = |arm| {
        arms.iter()
            .filter(|a| a.level == level && a.arm == arm)
            .collect::<Vec<_>>()
    };
    let a = group(0);
    let b = group(1);
    let first = |group: &[&SmallArm], q: usize| {
        median(&group.iter().map(|a| a.reads_ms[q][0]).collect::<Vec<_>>())
    };
    let warm = |group: &[&SmallArm], q: usize| {
        median(
            &group
                .iter()
                .flat_map(|a| a.reads_ms[q][1..].iter().copied())
                .collect::<Vec<_>>(),
        )
    };
    let memory = |group: &[&SmallArm], working: bool| {
        median(
            &group
                .iter()
                .map(|a| {
                    if working {
                        a.peak_working_set_bytes as f64
                    } else {
                        a.peak_private_commit_bytes as f64
                    }
                })
                .collect::<Vec<_>>(),
        )
    };
    let improved = a
        .iter()
        .zip(&b)
        .filter(|(a, b)| median(&b.reads_ms[1][1..]) < median(&a.reads_ms[1][1..]))
        .count();
    let eligible = warm(&b, 1) <= warm(&a, 1) * 0.8
        && improved >= 5
        && qualifies(first(&a, 0), first(&b, 0), false)
        && qualifies(warm(&a, 0), warm(&b, 0), false)
        && [true, false]
            .iter()
            .all(|working| memory(&b, *working) <= memory(&a, *working) + MEMORY_ALLOWANCE as f64);
    json!({"level":level,"mmap_bytes":LEVELS[level],"eligible":eligible,"improved_pairs":improved,
        "first_baseline_ms":[first(&a,0),first(&a,1)],"first_treatment_ms":[first(&b,0),first(&b,1)],
        "warm_baseline_ms":[warm(&a,0),warm(&a,1)],"warm_treatment_ms":[warm(&b,0),warm(&b,1)],
        "baseline_peak_working_set_median":memory(&a,true),"treatment_peak_working_set_median":memory(&b,true),
        "baseline_peak_private_commit_median":memory(&a,false),"treatment_peak_private_commit_median":memory(&b,false)})
}

fn small_completion(arms: &[SmallArm], elapsed: f64) -> Value {
    let results: Vec<_> = (0..3).map(|level| small_result(arms, level)).collect();
    let selected = results
        .iter()
        .filter(|v| v["eligible"] == true)
        .min_by(|a, b| {
            for key in [
                "treatment_peak_working_set_median",
                "treatment_peak_private_commit_median",
            ] {
                let order = a[key]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&b[key].as_f64().unwrap());
                if !order.is_eq() {
                    return order;
                }
            }
            a["warm_treatment_ms"][1]
                .as_f64()
                .unwrap()
                .total_cmp(&b["warm_treatment_ms"][1].as_f64().unwrap())
                .then_with(|| a["level"].as_u64().cmp(&b["level"].as_u64()))
        })
        .map(|v| v["level"].clone());
    json!({"kind":"connection-policy-small-complete","arms":36,"samples":432,"elapsed_ms":elapsed,
        "selected_level":selected,"results":results,"qualification":false})
}

fn retained_small(log: &str) -> Option<Vec<SmallArm>> {
    let records: Vec<Value> = log
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .ok()?;
    if records.len() != 38 {
        return None;
    }
    let header = &records[0];
    if header.as_object()?.len() != 8
        || header["kind"] != "connection-policy-small-start"
        || header["fixture"] != "wide-80-char-skew-v1"
        || header["images"] != 10000
        || header["memberships"] != 1000
        || header["levels"] != json!(LEVELS)
        || header["memory_allowance_bytes"] != MEMORY_ALLOWANCE
        || header["query_sha256"]
            != json!([
                digest(production_collection_stats_query().as_bytes()),
                crate::db::migrations::sql_plugin_tests::PRE_M80_MAINTENANCE_SHA256
            ])
    {
        return None;
    }
    let mut arms = Vec::new();
    for record in &records[1..37] {
        if record.as_object()?.len() != 2 || record["kind"] != "connection-policy-small-arm" {
            return None;
        }
        arms.push(serde_json::from_value(record["data"].clone()).ok()?);
    }
    if !valid_small(&arms) {
        return None;
    }
    let elapsed = records[37]["elapsed_ms"].as_f64()?;
    let prior = header["prior_elapsed_ms"].as_f64()?;
    if !elapsed.is_finite()
        || !prior.is_finite()
        || elapsed < 0.
        || prior < 0.
        || elapsed + prior > 3_600_000.
        || !approximately(&records[37], &small_completion(&arms, elapsed))
    {
        return None;
    }
    Some(arms)
}

fn reparse(path: &Path) -> bool {
    let metadata = fs::symlink_metadata(path).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn worker_root() -> std::path::PathBuf {
    let root = std::path::PathBuf::from(
        std::env::var_os("AMBIT_POLICY_WORKER_DIR")
            .expect("controller-owned generated directory required"),
    );
    assert_eq!(root, root.canonicalize().unwrap());
    assert_eq!(
        root.parent(),
        Some(std::env::temp_dir().canonicalize().unwrap().as_path())
    );
    assert!(root
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("ambit-collection-index-benchmark-"));
    for path in [&root, &root.join("sample.db"), &root.join("input.json")] {
        assert!(!reparse(path));
    }
    root
}

#[test]
#[ignore = "controller-only generated small mmap worker"]
fn connection_policy_small_worker() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let root = worker_root();
    let input: Value = serde_json::from_slice(&fs::read(root.join("input.json")).unwrap()).unwrap();
    assert_eq!(
        input["token"],
        std::env::var("AMBIT_POLICY_WORKER_TOKEN").unwrap()
    );
    assert_eq!(input["kind"], "connection-policy-small-input");
    let (round, level, arm) = (
        input["round"].as_u64().unwrap() as usize,
        input["level"].as_u64().unwrap() as usize,
        input["arm"].as_u64().unwrap() as usize,
    );
    assert!(round < 6 && level < 3 && arm < 2);
    let expected: [Vec<Value>; 2] = serde_json::from_value(input["reference"].clone()).unwrap();
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let sql = MockSql::new(&root);
    let db = sql.load(&root.join("sample.db"));
    let pool = sql.pool(&db);
    let result = tauri::async_runtime::block_on(async {
        let mut held = Vec::new();
        let mut acquisition_ms = [0.; 2];
        for ms in &mut acquisition_ms {
            let start = Instant::now();
            held.push(pool.acquire().await.unwrap());
            *ms = start.elapsed().as_secs_f64() * 1000.;
        }
        let config = small_configuration(level, arm);
        for conn in &mut held {
            assert_eq!(settings(conn).await, DEFAULTS);
            apply(conn, config).await;
        }
        let mut reads_ms = [[0.; 6]; 2];
        let queries = [production_collection_stats_query(), maintenance_count_sql()];
        for q in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
            for ms in &mut reads_ms[q] {
                let (rows, timing) = held_query(&mut held[q], queries[q]).await;
                assert_eq!(rows, expected[q]);
                *ms = timing["held_execution_and_decode_ms"].as_f64().unwrap();
            }
        }
        for conn in &mut held {
            assert_eq!(settings(conn).await, config);
        }
        let memory = plugin::sql_plugin_benchmark::peak_process_memory_bytes();
        SmallArm {
            round,
            level,
            arm,
            settings: [config; 2],
            acquisition_ms,
            reads_ms,
            peak_working_set_bytes: memory["peak_working_set_bytes"]
                .as_u64()
                .expect("working-set measurement required"),
            peak_private_commit_bytes: memory["peak_pagefile_bytes"]
                .as_u64()
                .expect("peak private commit measurement required"),
        }
    });
    println!(
        "{}",
        json!({"kind":"connection-policy-small-arm","data":result})
    );
}

fn launch_worker(directory: &Path, token: &str, remaining: Duration) -> SmallArm {
    parse_worker_output(&worker_output(directory, token, remaining, WORKER))
        .expect("exactly one valid completed worker required")
}

fn worker_output(directory: &Path, token: &str, remaining: Duration, worker: &str) -> String {
    let log = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join("worker.log"))
        .unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--ignored", "--exact", worker, "--nocapture"])
        .env("AMBIT_POLICY_WORKER_DIR", directory)
        .env("AMBIT_POLICY_WORKER_TOKEN", token)
        .stdout(Stdio::from(log.try_clone().unwrap()))
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW: noninteractive test workers.
    }
    let mut child = command.spawn().unwrap();
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if start.elapsed() >= remaining {
            child
                .kill()
                .expect("terminate only the controller-owned generated worker");
            child.wait().unwrap();
            panic!("approved measurement budget exhausted; worker interrupted");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let output = fs::read_to_string(directory.join("worker.log")).unwrap();
    assert!(status.success(), "generated worker failed: {output}");
    output
}

fn parse_worker_output(output: &str) -> Option<SmallArm> {
    let rows: Vec<Value> = output
        .lines()
        .filter(|line| line.contains("connection-policy-small-arm"))
        .map(|line| serde_json::from_str::<Value>(&line[line.find('{').unwrap_or(0)..]))
        .collect::<Result<_, _>>()
        .ok()?;
    if rows.len() != 1
        || rows[0].as_object()?.len() != 2
        || rows[0]["kind"] != "connection-policy-small-arm"
    {
        return None;
    }
    serde_json::from_value(rows[0]["data"].clone()).ok()
}

#[test]
fn connection_policy_small_evidence_and_selection() {
    let arms: Vec<_> = small_schedule()
        .into_iter()
        .map(|(round, level, arm)| SmallArm {
            round,
            level,
            arm,
            settings: [small_configuration(level, arm); 2],
            acquisition_ms: [0.1; 2],
            reads_ms: [[10.; 6], [if arm == 0 { 100. } else { 70. }; 6]],
            peak_working_set_bytes: 1000,
            peak_private_commit_bytes: 1000,
        })
        .collect();
    assert!(valid_small(&arms));
    assert!(!valid_small(&arms[..35]));
    assert_eq!(small_completion(&arms, 1.)["selected_level"], 0);
    let worker = json!({"kind":"connection-policy-small-arm","data":arms[0]}).to_string();
    let extra_worker =
        json!({"kind":"connection-policy-small-arm","data":arms[0],"extra":1}).to_string();
    assert!(parse_worker_output(&extra_worker).is_none());
    assert!(parse_worker_output(&("test worker ... ".to_owned() + &worker)).is_some());
    assert!(parse_worker_output(&(worker.clone() + "\n" + &worker)).is_none());
    assert!(
        parse_worker_output(&(worker.clone() + "\n{\"kind\":\"connection-policy-small-arm\""))
            .is_none()
    );
    let mut priority = arms.clone();
    for a in &mut priority {
        if a.arm == 1 && a.level == 1 {
            a.peak_working_set_bytes = 999;
            a.peak_private_commit_bytes = 2000;
        }
    }
    assert_eq!(
        small_completion(&priority, 1.)["selected_level"],
        1,
        "working set precedes private commit"
    );
    let mut priority = arms.clone();
    for a in &mut priority {
        if a.arm == 1 && a.level == 2 {
            a.peak_private_commit_bytes = 999;
            a.reads_ms[1] = [80.; 6];
        }
    }
    assert_eq!(
        small_completion(&priority, 1.)["selected_level"],
        2,
        "private commit precedes latency"
    );
    let mut priority = arms.clone();
    for a in &mut priority {
        if a.arm == 1 {
            if a.level == 1 {
                a.reads_ms[1] = [60.; 6];
            }
            if a.level == 0 {
                a.reads_ms[0] = [1.; 6];
            }
        }
    }
    assert_eq!(
        small_completion(&priority, 1.)["selected_level"],
        1,
        "maintenance latency breaks memory ties, not collection latency"
    );
    let mut changed = arms.clone();
    for a in &mut changed {
        if a.arm == 1 {
            a.peak_private_commit_bytes += MEMORY_ALLOWANCE + 1;
        }
    }
    assert_eq!(
        small_completion(&changed, 1.)["selected_level"],
        Value::Null,
        "private commit allowance is independent of working set"
    );
    let mut changed = arms.clone();
    changed.swap(0, 1);
    assert!(!valid_small(&changed));
    let mut changed = arms.clone();
    changed[0].peak_private_commit_bytes = 0;
    assert!(!valid_small(&changed));
    let mut changed = arms.clone();
    changed[0].reads_ms[0][0] = f64::NAN;
    assert!(!valid_small(&changed));
    let mut changed = arms.clone();
    for a in &mut changed {
        if a.arm == 1 {
            a.peak_working_set_bytes += MEMORY_ALLOWANCE + 1;
        }
    }
    assert_eq!(
        small_completion(&changed, 1.)["selected_level"],
        Value::Null
    );
    let mut records = vec![
        json!({"kind":"connection-policy-small-start","fixture":"wide-80-char-skew-v1","images":10000,"memberships":1000,
        "query_sha256":[digest(production_collection_stats_query().as_bytes()),crate::db::migrations::sql_plugin_tests::PRE_M80_MAINTENANCE_SHA256],
        "memory_allowance_bytes":MEMORY_ALLOWANCE,"levels":LEVELS,"prior_elapsed_ms":1.}),
    ];
    records.extend(
        arms.iter()
            .map(|a| json!({"kind":"connection-policy-small-arm","data":a})),
    );
    records.push(small_completion(&arms, 1.));
    let log = |records: &[Value]| {
        records
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert!(retained_small(&log(&records)).is_some());
    let mut current_query = records.clone();
    current_query[0]["query_sha256"][1] = json!(digest(maintenance_count_sql().as_bytes()));
    assert!(
        retained_small(&log(&current_query)).is_none(),
        "m80 evidence is not historical evidence"
    );
    let mut extra = records.clone();
    extra[0]["extra"] = json!(1);
    assert!(retained_small(&log(&extra)).is_none());
    let mut extra = records.clone();
    extra[1]["extra"] = json!(1);
    assert!(retained_small(&log(&extra)).is_none());
    assert!(retained_small(&log(&records[..37])).is_none());
    assert!(retained_small(&(log(&records) + "\n{")).is_none());
    let mut changed = records.clone();
    changed[37]["selected_level"] = json!(2);
    assert!(retained_small(&log(&changed)).is_none());
    let mut changed = records.clone();
    changed[1]["data"]["peak_working_set_bytes"] = Value::Null;
    assert!(retained_small(&log(&changed)).is_none());
    let mut changed = records.clone();
    changed[1]["data"]["settings"][0][1] = json!(42);
    assert!(retained_small(&log(&changed)).is_none());
}

#[test]
#[ignore = "read-only validation of the retained small-policy evidence"]
fn connection_policy_validate_small_log() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/connection-policy-small.jsonl");
    let arms = retained_small(&fs::read_to_string(path).unwrap())
        .expect("complete ordered small-policy evidence required");
    println!(
        "{}",
        json!({"kind":"connection-policy-small-validation","valid":true,"arms":arms.len()})
    );
}

#[test]
#[ignore = "one approved fresh-process bounded mmap campaign; no reruns"]
fn connection_policy_small_campaign() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    let prior = fs::read_to_string(target.join("connection-policy-attribution.jsonl")).unwrap();
    let arms = retained_arms(&prior).expect("complete attribution required");
    let prior_end: Value = serde_json::from_str(prior.lines().last().unwrap()).unwrap();
    let result = completion(&arms, prior_end["elapsed_ms"].as_f64().unwrap());
    assert_eq!(result["controls_pass"], true);
    assert_eq!(
        result["eligible_read_settings"],
        json!(["mmap_size"]),
        "only demonstrated mmap advances in this campaign"
    );
    let allowance = Duration::from_secs(3600)
        .checked_sub(Duration::from_secs_f64(
            prior_end["elapsed_ms"].as_f64().unwrap() / 1000.,
        ))
        .unwrap();
    let mut evidence = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target.join("connection-policy-small.jsonl"))
        .unwrap();
    let mut emit = |value: Value| {
        writeln!(evidence, "{value}").unwrap();
        evidence.flush().unwrap();
        println!("{value}");
    };
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let start = Instant::now();
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
    emit(
        json!({"kind":"connection-policy-small-start","fixture":"wide-80-char-skew-v1","images":10000,"memberships":1000,
        "query_sha256":[digest(production_collection_stats_query().as_bytes()),crate::db::migrations::sql_plugin_tests::PRE_M80_MAINTENANCE_SHA256],
        "memory_allowance_bytes":MEMORY_ALLOWANCE,"levels":LEVELS,"prior_elapsed_ms":prior_end["elapsed_ms"]}),
    );
    let mut results = Vec::new();
    for (round, level, arm) in small_schedule() {
        let generated = GeneratedBenchmarkDir::new();
        fs::copy(&template, generated.path.join("sample.db")).unwrap();
        let token = uuid::Uuid::new_v4().to_string();
        fs::write(
            generated.path.join("input.json"),
            serde_json::to_vec(
                &json!({"kind":"connection-policy-small-input","token":token,
            "round":round,"level":level,"arm":arm,"reference":expected}),
            )
            .unwrap(),
        )
        .unwrap();
        let remaining = allowance
            .checked_sub(start.elapsed())
            .expect("campaign budget exhausted before worker");
        let result = launch_worker(&generated.path, &token, remaining);
        assert_eq!(
            (result.round, result.level, result.arm),
            (round, level, arm)
        );
        emit(json!({"kind":"connection-policy-small-arm","data":result}));
        results.push(result);
    }
    assert!(valid_small(&results));
    emit(small_completion(
        &results,
        start.elapsed().as_secs_f64() * 1000.,
    ));
}
