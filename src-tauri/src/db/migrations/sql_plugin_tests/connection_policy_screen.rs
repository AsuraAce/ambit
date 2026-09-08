//! One selected setting, upstream IPC; no plugin patch or shipping connection policy.
use super::*;
const WORKER: &str="db::migrations::sql_plugin_tests::count_index_benchmark::diagnosis::probes::connection_policy::small::screen::connection_policy_screen_worker";
const MMAP: i64 = 64 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ScreenArm {
    cell: usize,
    round: usize,
    arm: usize,
    before: Vec<[i64; 5]>,
    after: Vec<[i64; 5]>,
    slots: Vec<usize>,
    acquisition_ms: Vec<f64>,
    reads_ms: [[f64; 6]; 2],
}

fn sorted_settings(values: &[[i64; 5]]) -> Vec<[i64; 5]> {
    let mut values = values.to_vec();
    values.sort();
    values
}

fn valid_cell(arms: &[ScreenArm], cell: usize) -> bool {
    if arms.len() != 12 || cell >= 4 {
        return false;
    }
    let mut index = 0;
    for round in 0..6 {
        for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
            let a = &arms[index];
            index += 1;
            if (a.cell, a.round, a.arm) != (cell, round, arm)
                || a.before.len() != 10
                || a.after.len() != 10
                || a.slots != (0..10).collect::<Vec<_>>()
                || a.acquisition_ms.len() != 20
                || !a
                    .acquisition_ms
                    .iter()
                    .chain(a.reads_ms.iter().flatten())
                    .all(|v| v.is_finite() && *v >= 0.)
            {
                return false;
            }
            for (before, after) in a.before.iter().zip(&a.after) {
                if !before
                    .iter()
                    .enumerate()
                    .all(|(i, v)| *v == DEFAULTS[i] || *v == LEGACY[i])
                {
                    return false;
                }
                let mut expected = *before;
                if arm == 1 {
                    expected[1] = MMAP;
                }
                if *after != expected {
                    return false;
                }
            }
        }
        if sorted_settings(&arms[index - 2].before) != sorted_settings(&arms[index - 1].before) {
            return false;
        }
    }
    true
}

fn cell_result(arms: &[ScreenArm], cell: usize) -> Value {
    let group = |arm| arms.iter().filter(|a| a.arm == arm).collect::<Vec<_>>();
    let a = group(0);
    let b = group(1);
    let first = |g: &[&ScreenArm], q: usize| {
        median(&g.iter().map(|a| a.reads_ms[q][0]).collect::<Vec<_>>())
    };
    let warm = |g: &[&ScreenArm], q: usize| {
        median(
            &g.iter()
                .flat_map(|a| a.reads_ms[q][1..].iter().copied())
                .collect::<Vec<_>>(),
        )
    };
    let passed = (0..2).all(|q| {
        qualifies(first(&a, q), first(&b, q), false)
            && qualifies(warm(&a, q), warm(&b, q), cell % 2 == 1 && q == 1)
    });
    json!({"cell":cell,"images":if cell<2 {10000} else {146182},"concurrent":cell%2==1,"passed":passed,
        "first_baseline_ms":[first(&a,0),first(&a,1)],"first_treatment_ms":[first(&b,0),first(&b,1)],
        "warm_baseline_ms":[warm(&a,0),warm(&a,1)],"warm_treatment_ms":[warm(&b,0),warm(&b,1)]})
}

fn screen_completion(arms: &[ScreenArm], elapsed: f64) -> Value {
    let results: Vec<_> = arms
        .chunks_exact(12)
        .enumerate()
        .map(|(cell, a)| cell_result(a, cell))
        .collect();
    let passed = results.len() == 4 && results.iter().all(|v| v["passed"] == true);
    json!({"kind":"connection-policy-screen-complete","arms":arms.len(),"samples":arms.len()*12,
        "elapsed_ms":elapsed,"passed":passed,"results":results,"qualification":false})
}

fn retained_screen(log: &str) -> Option<Vec<ScreenArm>> {
    let records: Vec<Value> = log
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .ok()?;
    if records.len() < 14 || records.len() > 50 || (records.len() - 2) % 12 != 0 {
        return None;
    }
    let h = &records[0];
    if h.as_object()?.len() != 5
        || h["kind"] != "connection-policy-screen-start"
        || h["mmap_bytes"] != MMAP
        || h["fixture"] != "wide-80-char-skew-v1"
        || h["query_sha256"]
            != json!([
                digest(production_collection_stats_query().as_bytes()),
                crate::db::migrations::sql_plugin_tests::PRE_M80_MAINTENANCE_SHA256
            ])
    {
        return None;
    }
    let prior = h["prior_elapsed_ms"].as_f64()?;
    let mut arms = Vec::new();
    for r in &records[1..records.len() - 1] {
        if r.as_object()?.len() != 2 || r["kind"] != "connection-policy-screen-arm" {
            return None;
        }
        arms.push(serde_json::from_value(r["data"].clone()).ok()?);
    }
    for (cell, group) in arms.chunks_exact(12).enumerate() {
        if !valid_cell(group, cell)
            || (cell + 1 < arms.len() / 12 && cell_result(group, cell)["passed"] != true)
        {
            return None;
        }
    }
    let end = records.last()?;
    let elapsed = end["elapsed_ms"].as_f64()?;
    if !prior.is_finite()
        || prior < 0.
        || !elapsed.is_finite()
        || elapsed < 0.
        || prior + elapsed > 3_600_000.
        || !approximately(end, &screen_completion(&arms, elapsed))
    {
        return None;
    }
    if arms.len() < 48
        && cell_result(&arms[arms.len() - 12..], arms.len() / 12 - 1)["passed"] == true
    {
        return None;
    }
    Some(arms)
}

#[test]
#[ignore = "controller-only upstream IPC generated screen worker"]
fn connection_policy_screen_worker() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let root = worker_root();
    let input: Value = serde_json::from_slice(&fs::read(root.join("input.json")).unwrap()).unwrap();
    assert_eq!(
        input["token"],
        std::env::var("AMBIT_POLICY_WORKER_TOKEN").unwrap()
    );
    assert_eq!(input["kind"], "connection-policy-screen-input");
    let (cell, round, arm) = (
        input["cell"].as_u64().unwrap() as usize,
        input["round"].as_u64().unwrap() as usize,
        input["arm"].as_u64().unwrap() as usize,
    );
    assert!(cell < 4 && round < 6 && arm < 2);
    let expected: [Vec<Value>; 2] = serde_json::from_value(input["reference"].clone()).unwrap();
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let sql = MockSql::new(&root);
    let db = sql.load(&root.join("sample.db"));
    configure_via_ipc(&sql, &db);
    let pool = sql.pool(&db);
    let mut acquisition_ms = Vec::new();
    let before = tauri::async_runtime::block_on(async {
        let mut held = Vec::new();
        for _ in 0..10 {
            let start = Instant::now();
            held.push(pool.acquire().await.unwrap());
            acquisition_ms.push(start.elapsed().as_secs_f64() * 1000.);
        }
        let mut before = Vec::new();
        for (slot, conn) in held.iter_mut().enumerate() {
            before.push(settings(conn).await);
            // TEMP marker belongs to this physical generated connection, never a library migration.
            sqlx::query("CREATE TEMP TABLE ambit_policy_connection_marker(slot INTEGER NOT NULL)")
                .execute(&mut **conn)
                .await
                .unwrap();
            sqlx::query("INSERT INTO temp.ambit_policy_connection_marker VALUES (?)")
                .bind(slot as i64)
                .execute(&mut **conn)
                .await
                .unwrap();
            if arm == 1 {
                sqlx::query("PRAGMA mmap_size=67108864")
                    .execute(&mut **conn)
                    .await
                    .unwrap();
            }
            let mut expected = before[slot];
            if arm == 1 {
                expected[1] = MMAP;
            }
            assert_eq!(settings(conn).await, expected);
        }
        before
    });
    let queries = [production_collection_stats_query(), maintenance_count_sql()];
    let mut reads_ms = [[0.; 6]; 2];
    for read in 0..6 {
        if cell % 2 == 1 {
            let values = pair(&sql, &db, queries);
            for (q, (rows, ms)) in values.into_iter().enumerate() {
                assert_eq!(rows, expected[q]);
                reads_ms[q][read] = ms;
            }
        } else {
            for q in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                let (rows, ms) = timed_select(&sql, &db, queries[q]);
                assert_eq!(rows, expected[q]);
                reads_ms[q][read] = ms;
            }
        }
    }
    let (after, slots) = tauri::async_runtime::block_on(async {
        let mut held = Vec::new();
        for _ in 0..10 {
            let start = Instant::now();
            held.push(pool.acquire().await.unwrap());
            acquisition_ms.push(start.elapsed().as_secs_f64() * 1000.);
        }
        let mut snapshots = Vec::new();
        for conn in &mut held {
            let slot: i64 =
                sqlx::query_scalar("SELECT slot FROM temp.ambit_policy_connection_marker")
                    .fetch_one(&mut **conn)
                    .await
                    .expect("replacement connection invalidates screen");
            snapshots.push((slot as usize, settings(conn).await));
        }
        snapshots.sort_by_key(|v| v.0);
        assert_eq!(
            snapshots.iter().map(|v| v.0).collect::<Vec<_>>(),
            (0..10).collect::<Vec<_>>()
        );
        (
            snapshots.iter().map(|v| v.1).collect::<Vec<_>>(),
            snapshots.iter().map(|v| v.0).collect::<Vec<_>>(),
        )
    });
    let result = ScreenArm {
        cell,
        round,
        arm,
        before,
        after,
        slots,
        acquisition_ms,
        reads_ms,
    };
    println!(
        "{}",
        json!({"kind":"connection-policy-screen-arm","data":result})
    );
}

fn parse_screen_worker(output: &str) -> Option<ScreenArm> {
    let rows: Vec<Value> = output
        .lines()
        .filter(|line| line.contains("connection-policy-screen-arm"))
        .map(|line| serde_json::from_str(&line[line.find('{').unwrap_or(0)..]))
        .collect::<Result<_, _>>()
        .ok()?;
    if rows.len() != 1
        || rows[0].as_object()?.len() != 2
        || rows[0]["kind"] != "connection-policy-screen-arm"
    {
        return None;
    }
    serde_json::from_value(rows[0]["data"].clone()).ok()
}

#[test]
fn connection_policy_screen_evidence_gates() {
    let mut arms = Vec::new();
    for cell in 0..4 {
        for round in 0..6 {
            for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                let mut after = DEFAULTS;
                if arm == 1 {
                    after[1] = MMAP;
                }
                arms.push(ScreenArm {
                    cell,
                    round,
                    arm,
                    before: vec![DEFAULTS; 10],
                    after: vec![after; 10],
                    slots: (0..10).collect(),
                    acquisition_ms: vec![0.1; 20],
                    reads_ms: [[if arm == 0 { 100. } else { 70. }; 6]; 2],
                });
            }
        }
    }
    for (cell, group) in arms.chunks_exact(12).enumerate() {
        assert!(valid_cell(group, cell));
    }
    let header = json!({"kind":"connection-policy-screen-start","mmap_bytes":MMAP,"fixture":"wide-80-char-skew-v1",
        "query_sha256":[digest(production_collection_stats_query().as_bytes()),crate::db::migrations::sql_plugin_tests::PRE_M80_MAINTENANCE_SHA256],"prior_elapsed_ms":1.});
    let records = |arms: &[ScreenArm]| {
        let mut records = vec![header.clone()];
        records.extend(
            arms.iter()
                .map(|a| json!({"kind":"connection-policy-screen-arm","data":a})),
        );
        records.push(screen_completion(arms, 1.));
        records
    };
    let log = |records: &[Value]| {
        records
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    };
    let values = records(&arms);
    assert!(retained_screen(&log(&values)).is_some());
    let mut current_query = values.clone();
    current_query[0]["query_sha256"][1] = json!(digest(maintenance_count_sql().as_bytes()));
    assert!(
        retained_screen(&log(&current_query)).is_none(),
        "m80 evidence is not historical evidence"
    );
    assert!(
        retained_screen(&log(&records(&arms[..12]))).is_none(),
        "passing prefix is incomplete, not a successful screen"
    );
    let mut changed = arms.clone();
    changed[0].before[0] = LEGACY;
    changed[0].after[0] = LEGACY;
    assert!(
        !valid_cell(&changed[..12], 0),
        "paired settings distribution must match"
    );
    let mut changed = arms.clone();
    changed[0].slots[0] = 42;
    assert!(!valid_cell(&changed[..12], 0));
    let mut changed = arms.clone();
    changed[0].reads_ms[0][0] = f64::INFINITY;
    assert!(!valid_cell(&changed[..12], 0));
    let mut failed = arms[..12].to_vec();
    for a in &mut failed {
        if a.arm == 1 {
            a.reads_ms = [[200.; 6]; 2];
        }
    }
    assert!(
        retained_screen(&log(&records(&failed))).is_some(),
        "failed complete cell is a valid stopped outcome"
    );
    let mut changed = values.clone();
    changed[0]["extra"] = json!(1);
    assert!(retained_screen(&log(&changed)).is_none());
    let mut changed = values.clone();
    changed[1]["extra"] = json!(1);
    assert!(retained_screen(&log(&changed)).is_none());
    let mut changed = values.clone();
    changed[49]["passed"] = json!(false);
    assert!(retained_screen(&log(&changed)).is_none());
    assert!(retained_screen(&(log(&values) + "\n{")).is_none());
    assert!(parse_screen_worker(&values[1].to_string()).is_some());
}

#[test]
#[ignore = "read-only validation of selected-candidate IPC screening"]
fn connection_policy_validate_screen_log() {
    let log = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("target/connection-policy-screen.jsonl"),
    )
    .unwrap();
    let arms =
        retained_screen(&log).expect("complete or explicitly failed screening evidence required");
    println!(
        "{}",
        json!({"kind":"connection-policy-screen-validation","arms":arms.len(),"valid":true})
    );
}

#[test]
#[ignore = "one selected-candidate IPC screen; stop at the first complete failed cell"]
fn connection_policy_screen_campaign() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    let log = fs::read_to_string(target.join("connection-policy-small.jsonl")).unwrap();
    let small = retained_small(&log).expect("validated small evidence required");
    assert_eq!(
        small_completion(&small, 0.)["selected_level"],
        2,
        "only the selected64MiB candidate may enter"
    );
    let rows: Vec<Value> = log
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    let prior = rows[0]["prior_elapsed_ms"].as_f64().unwrap()
        + rows.last().unwrap()["elapsed_ms"].as_f64().unwrap();
    let allowance = Duration::from_secs(3600)
        .checked_sub(Duration::from_secs_f64(prior / 1000.))
        .unwrap();
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target.join("connection-policy-screen.jsonl"))
        .unwrap();
    let mut emit = |v: Value| {
        writeln!(file, "{v}").unwrap();
        file.flush().unwrap();
        println!("{v}");
    };
    let runtime = tauri::async_runtime::handle();
    let _context = runtime.inner().enter();
    let start = Instant::now();
    emit(
        json!({"kind":"connection-policy-screen-start","mmap_bytes":MMAP,"fixture":"wide-80-char-skew-v1",
        "query_sha256":[digest(production_collection_stats_query().as_bytes()),crate::db::migrations::sql_plugin_tests::PRE_M80_MAINTENANCE_SHA256],"prior_elapsed_ms":prior}),
    );
    let mut results = Vec::new();
    for size in 0..2 {
        let directory = GeneratedBenchmarkDir::new();
        let template = directory.path.join("template.db");
        let (images, memberships) = if size == 0 {
            (10000, 1000)
        } else {
            (146182, 131741)
        };
        seed_wide(&template, images, memberships);
        let reference = {
            let conn = Connection::open(&template).unwrap();
            set_scope(&conn, "all", "", true);
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .unwrap();
            [production_collection_stats_query(), maintenance_count_sql()]
                .map(|q| sorted_rows(json!(direct_count_rows(&conn, q))))
        };
        for boundary in 0..2 {
            let cell = size * 2 + boundary;
            for round in 0..6 {
                for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                    let generated = GeneratedBenchmarkDir::new();
                    fs::copy(&template, generated.path.join("sample.db")).unwrap();
                    let token = uuid::Uuid::new_v4().to_string();
                    fs::write(generated.path.join("input.json"),serde_json::to_vec(&json!({"kind":"connection-policy-screen-input","token":token,"cell":cell,"round":round,"arm":arm,"reference":reference})).unwrap()).unwrap();
                    let remaining = allowance
                        .checked_sub(start.elapsed())
                        .expect("approved campaign budget exhausted");
                    let output = worker_output(&generated.path, &token, remaining, WORKER);
                    let result =
                        parse_screen_worker(&output).expect("complete screen worker required");
                    assert_eq!((result.cell, result.round, result.arm), (cell, round, arm));
                    emit(json!({"kind":"connection-policy-screen-arm","data":result}));
                    results.push(result);
                }
            }
            let group = &results[results.len() - 12..];
            assert!(
                valid_cell(group, cell),
                "unexpected physical settings or identities invalidate the comparison"
            );
            if cell_result(group, cell)["passed"] != true {
                emit(screen_completion(
                    &results,
                    start.elapsed().as_secs_f64() * 1000.,
                ));
                return;
            }
        }
    }
    emit(screen_completion(
        &results,
        start.elapsed().as_secs_f64() * 1000.,
    ));
}
