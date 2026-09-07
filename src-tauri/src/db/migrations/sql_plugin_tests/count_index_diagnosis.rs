//! Opt-in, generated-only diagnosis. These results never qualify the candidate.
use super::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[path = "count_index_probes.rs"]
mod probes;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Series {
    block: u8,
    control: String,
    arm: u8,
    column: usize,
    first: Vec<f64>,
    warm: Vec<f64>,
}

fn parse_series(lines: &[String]) -> Result<Vec<Series>, String> {
    let mut seen = BTreeSet::new();
    let mut records = Vec::new();
    for line in lines {
        let envelope: Value = serde_json::from_str(line).map_err(|_| "invalid envelope")?;
        if envelope["kind"] != "count-diag-series" {
            return Err("invalid kind".into());
        }
        let record: Series =
            serde_json::from_value(envelope["series"].clone()).map_err(|_| "invalid series")?;
        if record.block > 1
            || !["aa", "ab"].contains(&record.control.as_str())
            || record.arm > 1
            || record.column > 3
            || record.first.len() != 6
            || record.warm.len() != 30
            || record
                .first
                .iter()
                .chain(&record.warm)
                .any(|n| !n.is_finite() || *n < 0.)
            || !seen.insert((record.control.clone(), record.arm, record.column))
        {
            return Err("incomplete, duplicate or invalid series".into());
        }
        if records
            .first()
            .is_some_and(|r: &Series| r.block != record.block)
        {
            return Err("mixed blocks".into());
        }
        records.push(record);
    }
    if records.len() != 16 {
        return Err("missing series".into());
    }
    Ok(records)
}

fn series_line(record: &Series) -> String {
    json!({"kind":"count-diag-series","series":record}).to_string()
}

// Retained stdout uses ordered boundary headers around the unchanged benchmark's samples.
// Check every header/sample and its exact aggregate position, not just the aggregate lengths.
fn validate_log(log: &str) -> Result<(), String> {
    let values: Vec<Value> = log
        .lines()
        .filter_map(|line| line.find('{').map(|i| &line[i..]))
        .filter(|line| line.contains("\"kind\""))
        .map(|line| serde_json::from_str(line).map_err(|_| "invalid JSON".to_owned()))
        .collect::<Result<_, _>>()?;
    let lines: Vec<_> = values
        .iter()
        .filter(|v| v["kind"] == "count-diag-series")
        .map(Value::to_string)
        .collect();
    let records = parse_series(&lines)?;
    let block = records[0].block;
    let mut schedule = Vec::new();
    for control in if block == 0 {
        ["ab", "aa"]
    } else {
        ["aa", "ab"]
    } {
        for round in 0..6 {
            for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                for concurrent in [false, true] {
                    schedule.push(json!({"kind":"count-diag-boundary","block":block,"control":control,"round":round,"arm":arm,"concurrent":concurrent}));
                }
            }
        }
    }
    let mut boundary: Option<&Value> = None;
    let mut boundary_count = 0;
    let mut seen = BTreeSet::new();
    let mut within = 0;
    let mut complete = 0;
    for value in &values {
        match value["kind"].as_str().unwrap_or("") {
            "count-diag-boundary" => {
                if boundary.is_some() && within != 12 {
                    return Err("incomplete boundary".into());
                }
                if schedule.get(boundary_count) != Some(value) {
                    return Err("invalid paired schedule".into());
                }
                boundary_count += 1;
                boundary = Some(value);
                within = 0;
            }
            "count-index-sample" => {
                let b = boundary.ok_or("sample without boundary")?;
                let round = b["round"].as_u64().unwrap() as usize;
                let arm = b["arm"].as_u64().unwrap() as u8;
                let control = b["control"].as_str().unwrap();
                let concurrent = b["concurrent"].as_bool().unwrap();
                let q = value["query"].as_u64().ok_or("missing query")? as usize;
                let read = value["read"].as_u64().ok_or("missing read")? as usize;
                let ms = value["ms"].as_f64().ok_or("missing timing")?;
                if q > 1
                    || read > 5
                    || !ms.is_finite()
                    || ms < 0.
                    || value["round"] != b["round"]
                    || value["concurrent"] != b["concurrent"]
                    || value["scope"] != "all"
                    || value["indexed"] != json!(control == "ab" && arm == 1)
                    || !seen.insert((control.to_owned(), arm, round, concurrent, q, read))
                {
                    return Err("invalid or duplicate sample".into());
                }
                let column = q + if concurrent { 2 } else { 0 };
                let series = records
                    .iter()
                    .find(|r| r.control == control && r.arm == arm && r.column == column)
                    .unwrap();
                let expected = if read == 0 {
                    series.first[round]
                } else {
                    series.warm[round * 5 + read - 1]
                };
                if (ms - expected).abs() > 0.0000001 {
                    return Err("sample/series mismatch".into());
                }
                within += 1;
            }
            "count-diag-complete" => {
                if value["block"] != json!(block)
                    || value["samples"] != 576
                    || value["qualification"] != false
                    || seen.len() != 576
                    || boundary_count != 48
                    || within != 12
                {
                    return Err("premature completion".into());
                }
                complete += 1;
            }
            _ => {}
        }
    }
    if seen.len() != 576 || boundary_count != 48 || within != 12 || complete != 1 {
        return Err("incomplete campaign".into());
    }
    Ok(())
}

#[test]
#[ignore = "read-only validation of the two retained diagnostic blocks; does not rerun measurements"]
fn count_diagnostic_validate_retained_logs() {
    for block in 0..2 {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("target/count-diag-reproduction-{block}.log"));
        let log = std::fs::read_to_string(path).unwrap();
        validate_log(&log).unwrap();
        // Regression: recorded evidence must fail when a sample is missing, duplicated or altered.
        let sample = log
            .lines()
            .find(|l| l.starts_with('{') && l.contains("\"kind\":\"count-index-sample\""))
            .unwrap();
        assert!(validate_log(&log.replacen(sample, "", 1)).is_err());
        assert!(validate_log(&log.replacen(sample, &format!("{sample}\n{sample}"), 1)).is_err());
        assert!(validate_log(&log.replace("\"samples\":576", "\"samples\":575")).is_err());
    }
}

fn report_series(lines: &[String]) {
    let records = parse_series(lines).expect("complete paired diagnostic evidence");
    for control in ["aa", "ab"] {
        for column in 0..4 {
            let arms: Vec<_> = (0..2)
                .map(|arm| {
                    records
                        .iter()
                        .find(|r| r.control == control && r.column == column && r.arm == arm)
                        .unwrap()
                })
                .collect();
            let deltas: Vec<_> = (0..6)
                .map(|pair| {
                    median(&arms[1].warm[pair * 5..pair * 5 + 5])
                        - median(&arms[0].warm[pair * 5..pair * 5 + 5])
                })
                .collect();
            for first in [true, false] {
                let values = |arm: usize| {
                    if first {
                        &arms[arm].first
                    } else {
                        &arms[arm].warm
                    }
                };
                let baseline = median(values(0));
                let candidate = median(values(1));
                println!(
                    "{}",
                    json!({"kind":"count-diag-comparison","block":arms[0].block,
                    "control":control,"column":column,"first":first,"baseline_ms":baseline,
                    "candidate_ms":candidate,"within_original_allowance":qualifies(baseline,candidate,false),
                    "warm_pair_deltas_ms":deltas,"warm_median_pair_delta_ms":median(&deltas),
                    "qualification":false})
                );
            }
        }
    }
}

#[test]
fn diagnostic_series_rejects_missing_invalid_and_unpaired_evidence() {
    let records: Vec<_> = ["aa", "ab"]
        .into_iter()
        .flat_map(|control| {
            (0..2).flat_map(move |arm| {
                (0..4).map(move |column| Series {
                    block: 0,
                    control: control.into(),
                    arm,
                    column,
                    first: vec![0.; 6],
                    warm: vec![1.; 30],
                })
            })
        })
        .collect();
    let lines: Vec<_> = records.iter().map(series_line).collect();
    assert_eq!(parse_series(&lines).unwrap().len(), 16);
    assert!(parse_series(&lines[1..]).is_err());
    for mutation in 0..6 {
        let mut changed = records.clone();
        match mutation {
            0 => {
                changed[0].warm.pop();
            }
            1 => changed[0].first[0] = -1.,
            2 => changed[0].first[0] = f64::INFINITY,
            3 => changed[0] = changed[1].clone(),
            4 => changed[0].block = 1,
            _ => changed[0].column = 4,
        }
        let changed: Vec<_> = changed.iter().map(series_line).collect();
        assert!(parse_series(&changed).is_err());
    }
    assert!(parse_series(&["{}".into()]).is_err());
    assert_eq!(median(&[5., 1., 3.]), 3.);
    assert_eq!(median(&[1., 3., 5., 7.]), 4.);
    let mut captured = Vec::new();
    for control in ["ab", "aa"] {
        for round in 0..6 {
            for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                for concurrent in [false, true] {
                    captured.push(json!({"kind":"count-diag-boundary","block":0,"control":control,"round":round,"arm":arm,"concurrent":concurrent}).to_string());
                    for read in 0..6 {
                        for q in 0..2 {
                            captured.push(json!({"kind":"count-index-sample","round":round,"indexed":control=="ab" && arm==1,"concurrent":concurrent,"query":q,"read":read,"ms":if read==0 {0.}else{1.},"scope":"all"}).to_string());
                        }
                    }
                }
            }
        }
    }
    captured.extend(lines);
    captured.push(
        json!({"kind":"count-diag-complete","block":0,"samples":576,"qualification":false})
            .to_string(),
    );
    assert!(validate_log(&captured.join("\n")).is_ok());
    let mut missing = captured.clone();
    missing.remove(1);
    assert!(validate_log(&missing.join("\n")).is_err());
    let mut duplicate = captured.clone();
    duplicate.insert(1, duplicate[1].clone());
    assert!(validate_log(&duplicate.join("\n")).is_err());
    let mut unpaired = captured.clone();
    unpaired.swap(0, 13);
    assert!(validate_log(&unpaired.join("\n")).is_err());
    captured.pop();
    assert!(validate_log(&captured.join("\n")).is_err());
}

#[test]
#[ignore = "fixed diagnosis campaign only; COUNT_DIAG_BLOCK must be 0 or 1; not qualification"]
fn count_diagnostic_reproduction_block() {
    crate::db::migrations::sql_plugin_tests::require_pre_m80_campaign();
    let block: u8 = std::env::var("COUNT_DIAG_BLOCK")
        .expect("explicit block identifier")
        .parse()
        .unwrap();
    assert!(block <= 1);
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
            .map(|query| sorted_rows(json!(direct_count_rows(&conn, query))))
    };
    let start = Instant::now();
    let mut lines = Vec::new();
    // Invert control-group order in the second process. Within each group, six AB/BA pairs.
    for control in if block == 0 {
        ["ab", "aa"]
    } else {
        ["aa", "ab"]
    } {
        let mut arms: [Samples; 2] = Default::default();
        for round in 0..6 {
            for arm in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                for concurrent in [false, true] {
                    assert!(
                        start.elapsed().as_secs() < 900,
                        "diagnostic block budget exhausted"
                    );
                    println!(
                        "{}",
                        json!({"kind":"count-diag-boundary","block":block,
                        "control":control,"round":round,"arm":arm,"concurrent":concurrent})
                    );
                    sample(
                        &template,
                        "all",
                        control == "ab" && arm == 1,
                        concurrent,
                        round,
                        &mut arms[arm],
                        &expected,
                    );
                }
            }
        }
        for (arm, samples) in arms.into_iter().enumerate() {
            for column in 0..4 {
                let record = Series {
                    block,
                    control: control.into(),
                    arm: arm as u8,
                    column,
                    first: samples.first[column].clone(),
                    warm: samples.warm[column].clone(),
                };
                let line = series_line(&record);
                println!("{line}");
                lines.push(line);
            }
        }
    }
    report_series(&lines);
    println!(
        "{}",
        json!({"kind":"count-diag-complete","block":block,"samples":576,
        "qualification":false,"elapsed_ms":start.elapsed().as_secs_f64()*1000.})
    );
}
