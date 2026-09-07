//! Approved, generated-only single-setting investigation. Never changes the shipping pool.
use super::*;
use serde::{Deserialize, Serialize};

#[path = "connection_policy_small.rs"]
mod small;

const KEYS: [&str; 5] = [
    "cache_size",
    "mmap_size",
    "temp_store",
    "synchronous",
    "busy_timeout",
];
const DEFAULTS: [i64; 5] = [-2000, 0, 0, 2, 5000];
const LEGACY: [i64; 5] = [-64000, 268435456, 2, 1, 60000];

fn configuration(contrast: usize, arm: usize) -> [i64; 5] {
    match contrast {
        0 => {
            if arm == 0 {
                DEFAULTS
            } else {
                LEGACY
            }
        }
        1 => DEFAULTS,
        2..=6 => {
            let mut values = DEFAULTS;
            if arm == 1 {
                values[contrast - 2] = LEGACY[contrast - 2];
            }
            values
        }
        7..=11 => {
            let mut values = LEGACY;
            if arm == 1 {
                values[contrast - 7] = DEFAULTS[contrast - 7];
            }
            values
        }
        _ => panic!("unknown fixed contrast"),
    }
}

fn schedule() -> Vec<(usize, usize, usize)> {
    let mut result = Vec::new();
    for round in 0..6 {
        let contrasts: Vec<_> = if round % 2 == 0 {
            (0..12).collect()
        } else {
            (0..12).rev().collect()
        };
        for contrast in contrasts {
            for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                result.push((round, contrast, arm));
            }
        }
    }
    result
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Arm {
    round: usize,
    contrast: usize,
    arm: usize,
    settings: [i64; 5],
    acquisition_ms: f64,
    // Position 0 is first read; positions 1..6 are the five warm reads.
    reads_ms: [f64; 6],
}

fn valid_arms(arms: &[Arm]) -> bool {
    let expected = schedule();
    arms.len() == expected.len()
        && arms.iter().zip(expected).all(|(a, key)| {
            (a.round, a.contrast, a.arm) == key
                && a.settings == configuration(a.contrast, a.arm)
                && std::iter::once(a.acquisition_ms)
                    .chain(a.reads_ms)
                    .all(|n| n.is_finite() && n >= 0.)
        })
}

fn contrast_result(arms: &[Arm], contrast: usize) -> Value {
    let group = |arm| {
        arms.iter()
            .filter(|a| a.contrast == contrast && a.arm == arm)
            .collect::<Vec<_>>()
    };
    let a = group(0);
    let b = group(1);
    let warm = |group: &[&Arm]| {
        median(
            &group
                .iter()
                .flat_map(|a| a.reads_ms[1..].iter().copied())
                .collect::<Vec<_>>(),
        )
    };
    let first = |group: &[&Arm]| median(&group.iter().map(|a| a.reads_ms[0]).collect::<Vec<_>>());
    let improved_pairs = a
        .iter()
        .zip(&b)
        .filter(|(a, b)| median(&b.reads_ms[1..]) < median(&a.reads_ms[1..]))
        .count();
    json!({"contrast":contrast,"first_baseline_ms":first(&a),"first_treatment_ms":first(&b),
        "warm_baseline_ms":warm(&a),"warm_treatment_ms":warm(&b),"improved_pairs":improved_pairs,
        "advances":warm(&b) <= warm(&a)*0.8 && improved_pairs >= 5,
        "non_regression":qualifies(first(&a),first(&b),false) && qualifies(warm(&a),warm(&b),false),
        "paired_warm_differences_ms":a.iter().zip(&b).map(|(a,b)|median(&b.reads_ms[1..])-median(&a.reads_ms[1..])).collect::<Vec<_>>()})
}

async fn settings(conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>) -> [i64; 5] {
    let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&mut **conn)
        .await
        .unwrap();
    assert_eq!(journal, "wal");
    let mut values = [0; 5];
    for (slot, key) in KEYS.iter().enumerate() {
        values[slot] = sqlx::query_scalar(&format!("PRAGMA {key}"))
            .fetch_one(&mut **conn)
            .await
            .unwrap();
    }
    values
}

async fn apply(conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>, values: [i64; 5]) {
    for (key, value) in KEYS.iter().zip(values) {
        sqlx::query(&format!("PRAGMA {key}={value}"))
            .execute(&mut **conn)
            .await
            .unwrap();
    }
    assert_eq!(
        settings(conn).await,
        values,
        "physical connection must match the treatment"
    );
}

fn digest(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(data))
}

fn completion(arms: &[Arm], elapsed_ms: f64) -> Value {
    let results: Vec<_> = (0..12).map(|c| contrast_result(arms, c)).collect();
    let controls_pass = results[0]["advances"] == true && results[1]["non_regression"] == true;
    let effective: Vec<_> = (0..5)
        .filter(|i| results[i + 2]["advances"] == true)
        .map(|i| KEYS[i])
        .collect();
    let eligible: Vec<_> = (0..3)
        .filter(|i| results[i + 2]["advances"] == true)
        .map(|i| KEYS[i])
        .collect();
    json!({"kind":"connection-policy-complete","arms":arms.len(),"samples":arms.len()*6,
        "elapsed_ms":elapsed_ms,"controls_pass":controls_pass,
        "effective_single_settings":effective,"eligible_read_settings":eligible,"results":results,"qualification":false})
}

fn approximately(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            a.is_finite() && b.is_finite() && (a - b).abs() <= 1e-7
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| approximately(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| approximately(a, b)))
        }
        _ => a == b,
    }
}

fn retained_arms(log: &str) -> Option<Vec<Arm>> {
    let records: Vec<Value> = log
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .ok()?;
    if records.len() != 146 {
        return None;
    }
    let header = &records[0];
    if header.as_object()?.len() != 8
        || header["kind"] != "connection-policy-start"
        || header["images"] != 10000
        || header["memberships"] != 1000
        || header["indexed"] != false
        || header["journal_mode"] != "wal"
        || header["fixture"] != "wide-80-char-skew-v1"
        || header["query_sha256"] != digest(maintenance_count_sql().as_bytes())
        || header["database_bytes"].as_u64()? == 0
    {
        return None;
    }
    let mut arms = Vec::new();
    for record in &records[1..145] {
        if record.as_object()?.len() != 2 || record["kind"] != "connection-policy-arm" {
            return None;
        }
        arms.push(serde_json::from_value(record["data"].clone()).ok()?);
    }
    if !valid_arms(&arms) {
        return None;
    }
    let elapsed = records[145]["elapsed_ms"].as_f64()?;
    if !elapsed.is_finite()
        || !(0. ..=3_600_000.).contains(&elapsed)
        || !approximately(&records[145], &completion(&arms, elapsed))
    {
        return None;
    }
    Some(arms)
}

fn attribution_arm(
    template: &Path,
    expected: &[Value],
    round: usize,
    contrast: usize,
    arm: usize,
) -> Arm {
    let directory = GeneratedBenchmarkDir::new();
    let path = directory.path.join("attribution.db");
    std::fs::copy(template, &path).unwrap();
    let sql = MockSql::new(&directory.path);
    let db = sql.load(&path);
    let pool = sql.pool(&db);
    tauri::async_runtime::block_on(async {
        let start = Instant::now();
        let mut conn = pool.acquire().await.unwrap();
        let acquisition_ms = start.elapsed().as_secs_f64() * 1000.;
        assert_eq!(settings(&mut conn).await, DEFAULTS);
        let configuration = configuration(contrast, arm);
        apply(&mut conn, configuration).await;
        let mut reads_ms = [0.; 6];
        for ms in &mut reads_ms {
            let (rows, timing) = held_query(&mut conn, maintenance_count_sql()).await;
            assert_eq!(
                rows, expected,
                "unchanged maintenance count must equal the shared reference"
            );
            *ms = timing["held_execution_and_decode_ms"].as_f64().unwrap();
        }
        assert_eq!(settings(&mut conn).await, configuration);
        Arm {
            round,
            contrast,
            arm,
            settings: configuration,
            acquisition_ms,
            reads_ms,
        }
    })
}

#[test]
fn connection_policy_evidence_rejects_missing_mispaired_and_invalid_arms() {
    let arms: Vec<_> = schedule()
        .into_iter()
        .map(|(round, contrast, arm)| Arm {
            round,
            contrast,
            arm,
            settings: configuration(contrast, arm),
            acquisition_ms: 0.1,
            reads_ms: [100.; 6],
        })
        .collect();
    assert!(valid_arms(&arms));
    assert!(!valid_arms(&arms[..arms.len() - 1]));
    let mut changed = arms.clone();
    changed.swap(0, 1);
    assert!(!valid_arms(&changed));
    let mut changed = arms.clone();
    changed[1] = changed[0].clone();
    assert!(!valid_arms(&changed));
    let mut changed = arms.clone();
    changed[0].settings[0] = 42;
    assert!(!valid_arms(&changed));
    for invalid in [-1., f64::NAN, f64::INFINITY] {
        let mut changed = arms.clone();
        changed[0].reads_ms[4] = invalid;
        assert!(!valid_arms(&changed));
    }
    assert_eq!(contrast_result(&arms, 0)["advances"], false);
    let mut faster = arms.clone();
    for arm in &mut faster {
        if arm.arm == 1 {
            arm.reads_ms = [79.; 6];
        }
    }
    assert_eq!(contrast_result(&faster, 0)["advances"], true);
    for arm in &mut faster {
        if arm.arm == 1 && arm.round < 2 {
            arm.reads_ms = [100.; 6];
        }
    }
    assert_eq!(
        contrast_result(&faster, 0)["advances"],
        false,
        "a pooled median cannot bypass five improving pairs"
    );
    let header = json!({"kind":"connection-policy-start","images":10000,"memberships":1000,
        "query_sha256":digest(maintenance_count_sql().as_bytes()),"indexed":false,"journal_mode":"wal",
        "fixture":"wide-80-char-skew-v1","database_bytes":4096});
    let mut records = vec![header];
    records.extend(
        arms.iter()
            .map(|arm| json!({"kind":"connection-policy-arm","data":arm})),
    );
    records.push(completion(&arms, 1000.));
    let log = |records: &[Value]| {
        records
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert!(retained_arms(&log(&records)).is_some());
    let mut extra = records.clone();
    extra[0]["extra"] = json!(1);
    assert!(retained_arms(&log(&extra)).is_none());
    let mut extra = records.clone();
    extra[1]["extra"] = json!(1);
    assert!(retained_arms(&log(&extra)).is_none());
    assert!(retained_arms(&(log(&records) + "\n{\"kind\":\"connection-policy-arm\"")).is_none());
    assert!(retained_arms(&log(&records[..145])).is_none());
    let mut changed = records.clone();
    changed[145]["controls_pass"] = json!(true);
    assert!(retained_arms(&log(&changed)).is_none());
    let mut changed = records.clone();
    changed[1]["data"]["reads_ms"][0] = json!(null);
    assert!(retained_arms(&log(&changed)).is_none());
    let mut changed = records.clone();
    changed[0]["query_sha256"] = json!("wrong");
    assert!(retained_arms(&log(&changed)).is_none());
}

#[test]
#[ignore = "read-only validation of the retained one-shot attribution log"]
fn connection_policy_validate_attribution_log() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("target/connection-policy-attribution.jsonl");
    let log = std::fs::read_to_string(path).unwrap();
    let arms = retained_arms(&log).expect("complete ordered attribution evidence required");
    println!(
        "{}",
        json!({"kind":"connection-policy-validation","valid":true,"arms":arms.len()})
    );
}

#[test]
#[ignore = "one approved generated attribution campaign; no timing-driven reruns"]
fn connection_policy_attribution() {
    use std::io::Write;
    let output =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("target/connection-policy-attribution.jsonl");
    let mut evidence = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .expect("refuse to overwrite the one-shot campaign evidence");
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
        sorted_rows(json!(direct_count_rows(&conn, maintenance_count_sql())))
    };
    emit(
        json!({"kind":"connection-policy-start","images":10000,"memberships":1000,
        "query_sha256":digest(maintenance_count_sql().as_bytes()),"indexed":false,"journal_mode":"wal",
        "fixture":"wide-80-char-skew-v1","database_bytes":std::fs::metadata(&template).unwrap().len()}),
    );
    let mut arms = Vec::new();
    for (round, contrast, arm) in schedule() {
        assert!(
            start.elapsed().as_secs() < 3600,
            "approved campaign budget exhausted"
        );
        let result = attribution_arm(&template, &expected, round, contrast, arm);
        emit(json!({"kind":"connection-policy-arm","data":result}));
        arms.push(result);
    }
    assert!(valid_arms(&arms));
    emit(completion(&arms, start.elapsed().as_secs_f64() * 1000.));
}
