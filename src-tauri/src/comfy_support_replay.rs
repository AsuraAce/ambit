use crate::metadata::comfyui::{build_comfyui_diagnostics_report, ComfyParserDiagnosticsReport};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;

pub const COMFY_SUPPORT_BUNDLE_MAX_BYTES: usize = 64 * 1024 * 1024;
const SUPPORT_BUNDLE_SCHEMA_VERSION: u32 = 1;
const FIXTURE_CANDIDATE_REPORT_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupportImage {
    format: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupportBundle {
    schema_version: u32,
    created_at: String,
    app_version: String,
    parser_version: u32,
    image: SupportImage,
    diagnostics: ComfyParserDiagnosticsReport,
    chunk_lengths: BTreeMap<String, usize>,
    chunks: BTreeMap<String, String>,
}

struct FixtureChunks(BTreeMap<String, String>);

impl<'de> Deserialize<'de> for FixtureChunks {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct FixtureChunksVisitor;

        impl<'de> Visitor<'de> for FixtureChunksVisitor {
            type Value = FixtureChunks;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a JSON object containing unique string chunk values")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut chunks = BTreeMap::new();
                while let Some(key) = map.next_key::<String>()? {
                    if chunks.contains_key(&key) {
                        return Err(serde::de::Error::custom("duplicate metadata chunk key"));
                    }
                    chunks.insert(key, map.next_value::<String>()?);
                }
                Ok(FixtureChunks(chunks))
            }
        }

        deserializer.deserialize_map(FixtureChunksVisitor)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayReport {
    support_bundle_schema_version: u32,
    image: SupportImage,
    chunk_keys: Vec<String>,
    chunk_lengths: BTreeMap<String, usize>,
    recorded_diagnostics: ComfyParserDiagnosticsReport,
    current_diagnostics: ComfyParserDiagnosticsReport,
    difference_count: usize,
    differences: Vec<ReplayDifference>,
    parser_output_matches: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCandidateReport {
    fixture_candidate_report_version: u32,
    candidate_sha256: String,
    chunk_keys: Vec<String>,
    chunk_lengths: BTreeMap<String, usize>,
    current_diagnostics: ComfyParserDiagnosticsReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_comparison: Option<FixtureCandidateComparison>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCandidateComparison {
    support_bundle_schema_version: u32,
    difference_count: usize,
    differences: Vec<FixtureCandidateDifference>,
    candidate_output_matches_support: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCandidateDifference {
    path: String,
    kind: ReplayDifferenceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    support: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidate: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayDifference {
    path: String,
    kind: ReplayDifferenceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    recorded: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReplayDifferenceKind {
    Added,
    Removed,
    Changed,
}

pub fn replay_comfyui_support_bundle(input: &[u8]) -> Result<(String, bool), String> {
    replay_comfyui_support_bundle_with_limit(input, COMFY_SUPPORT_BUNDLE_MAX_BYTES)
}

pub fn prepare_comfyui_fixture_candidate(input: &[u8]) -> Result<Vec<u8>, String> {
    prepare_comfyui_fixture_candidate_with_limit(input, COMFY_SUPPORT_BUNDLE_MAX_BYTES)
}

pub fn inspect_comfyui_fixture_candidate(
    candidate: &[u8],
    support_bundle: Option<&[u8]>,
) -> Result<(String, bool), String> {
    inspect_comfyui_fixture_candidate_with_limit(
        candidate,
        support_bundle,
        COMFY_SUPPORT_BUNDLE_MAX_BYTES,
    )
}

fn replay_comfyui_support_bundle_with_limit(
    input: &[u8],
    max_bytes: usize,
) -> Result<(String, bool), String> {
    let bundle = parse_bundle_with_limit(input, max_bytes)?;

    let chunks: HashMap<String, String> = bundle
        .chunks
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let current_diagnostics = build_comfyui_diagnostics_report(&chunks);
    let differences = diagnostics_differences(&bundle.diagnostics, &current_diagnostics)?;
    let difference_count = differences.len();
    let parser_output_matches = differences.is_empty();
    let report = ReplayReport {
        support_bundle_schema_version: bundle.schema_version,
        image: bundle.image,
        chunk_keys: bundle.chunks.keys().cloned().collect(),
        chunk_lengths: bundle.chunk_lengths,
        recorded_diagnostics: bundle.diagnostics,
        current_diagnostics,
        difference_count,
        differences,
        parser_output_matches,
    };
    let output = serde_json::to_string_pretty(&report)
        .map_err(|_| "Failed to serialize support bundle replay report".to_string())?;

    Ok((output, parser_output_matches))
}

fn prepare_comfyui_fixture_candidate_with_limit(
    input: &[u8],
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let bundle = parse_bundle_with_limit(input, max_bytes)?;
    if bundle.chunks.is_empty() {
        return Err("Support bundle contains no metadata chunks".to_string());
    }

    let mut output = serde_json::to_vec(&bundle.chunks)
        .map_err(|_| "Failed to serialize fixture candidate".to_string())?;
    output.push(b'\n');
    Ok(output)
}

fn inspect_comfyui_fixture_candidate_with_limit(
    candidate: &[u8],
    support_bundle: Option<&[u8]>,
    max_bytes: usize,
) -> Result<(String, bool), String> {
    let chunks = parse_fixture_candidate_with_limit(candidate, max_bytes)?;
    let canonical = canonical_fixture_candidate(&chunks)?;
    let candidate_sha256 = hex::encode(Sha256::digest(&canonical));
    let chunk_keys = chunks.keys().cloned().collect();
    let chunk_lengths = chunks
        .iter()
        .map(|(key, value)| (key.clone(), value.encode_utf16().count()))
        .collect();
    let current_diagnostics = diagnostics_for_chunks(&chunks);

    let (source_comparison, matches) = match support_bundle {
        Some(input) => {
            let bundle = parse_bundle_with_limit(input, max_bytes)?;
            let support_diagnostics = diagnostics_for_chunks(&bundle.chunks);
            let differences = diagnostics_differences(&support_diagnostics, &current_diagnostics)?
                .into_iter()
                .map(|difference| FixtureCandidateDifference {
                    path: difference.path,
                    kind: difference.kind,
                    support: difference.recorded,
                    candidate: difference.current,
                })
                .collect::<Vec<_>>();
            let matches = differences.is_empty();
            (
                Some(FixtureCandidateComparison {
                    support_bundle_schema_version: bundle.schema_version,
                    difference_count: differences.len(),
                    differences,
                    candidate_output_matches_support: matches,
                }),
                matches,
            )
        }
        None => (None, true),
    };

    let report = FixtureCandidateReport {
        fixture_candidate_report_version: FIXTURE_CANDIDATE_REPORT_VERSION,
        candidate_sha256,
        chunk_keys,
        chunk_lengths,
        current_diagnostics,
        source_comparison,
    };
    let output = serde_json::to_string_pretty(&report)
        .map_err(|_| "Failed to serialize fixture candidate report".to_string())?;
    Ok((output, matches))
}

fn parse_fixture_candidate_with_limit(
    input: &[u8],
    max_bytes: usize,
) -> Result<BTreeMap<String, String>, String> {
    if input.len() > max_bytes {
        return Err(format!(
            "Fixture candidate exceeds the {} MiB size limit",
            max_bytes / (1024 * 1024)
        ));
    }

    let FixtureChunks(chunks) = serde_json::from_slice(input).map_err(|error| {
        format!(
            "Invalid fixture candidate JSON at line {} column {}",
            error.line(),
            error.column()
        )
    })?;
    if chunks.is_empty() {
        return Err("Fixture candidate contains no metadata chunks".to_string());
    }
    Ok(chunks)
}

fn canonical_fixture_candidate(chunks: &BTreeMap<String, String>) -> Result<Vec<u8>, String> {
    let mut canonical = serde_json::to_vec(chunks)
        .map_err(|_| "Failed to serialize fixture candidate".to_string())?;
    canonical.push(b'\n');
    Ok(canonical)
}

fn diagnostics_for_chunks(chunks: &BTreeMap<String, String>) -> ComfyParserDiagnosticsReport {
    let chunks: HashMap<String, String> = chunks
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    build_comfyui_diagnostics_report(&chunks)
}

fn parse_bundle_with_limit(input: &[u8], max_bytes: usize) -> Result<SupportBundle, String> {
    if input.len() > max_bytes {
        return Err(format!(
            "Support bundle exceeds the {} MiB size limit",
            max_bytes / (1024 * 1024)
        ));
    }

    let bundle: SupportBundle = serde_json::from_slice(input).map_err(|error| {
        format!(
            "Invalid support bundle JSON at line {} column {}",
            error.line(),
            error.column()
        )
    })?;
    validate_bundle(&bundle)?;
    Ok(bundle)
}

fn validate_bundle(bundle: &SupportBundle) -> Result<(), String> {
    if bundle.schema_version != SUPPORT_BUNDLE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported support bundle schema version: {}",
            bundle.schema_version
        ));
    }
    if bundle.created_at.trim().is_empty()
        || bundle.app_version.trim().is_empty()
        || bundle.image.format.trim().is_empty()
    {
        return Err("Support bundle contains an empty required field".to_string());
    }
    if bundle.app_version != bundle.diagnostics.app_version
        || bundle.parser_version != bundle.diagnostics.parser_version
    {
        return Err("Support bundle version fields are inconsistent".to_string());
    }

    let chunk_keys: Vec<String> = bundle.chunks.keys().cloned().collect();
    let length_keys: Vec<String> = bundle.chunk_lengths.keys().cloned().collect();
    if chunk_keys != length_keys || chunk_keys != bundle.diagnostics.chunk_keys {
        return Err("Support bundle chunk keys are inconsistent".to_string());
    }

    for (key, value) in &bundle.chunks {
        let expected_length = value.encode_utf16().count();
        if bundle.chunk_lengths.get(key) != Some(&expected_length) {
            return Err("Support bundle chunk length is inconsistent".to_string());
        }
    }

    Ok(())
}

fn diagnostics_differences(
    recorded: &ComfyParserDiagnosticsReport,
    current: &ComfyParserDiagnosticsReport,
) -> Result<Vec<ReplayDifference>, String> {
    let mut recorded = recorded.clone();
    let mut current = current.clone();
    recorded.app_version.clear();
    recorded.parser_version = 0;
    current.app_version.clear();
    current.parser_version = 0;

    let recorded = serde_json::to_value(recorded)
        .map_err(|_| "Failed to compare recorded diagnostics".to_string())?;
    let current = serde_json::to_value(current)
        .map_err(|_| "Failed to compare current diagnostics".to_string())?;
    let mut differences = Vec::new();
    collect_differences("", &recorded, &current, &mut differences);
    Ok(differences)
}

fn collect_differences(
    path: &str,
    recorded: &Value,
    current: &Value,
    differences: &mut Vec<ReplayDifference>,
) {
    if recorded == current {
        return;
    }

    if let (Value::Object(recorded), Value::Object(current)) = (recorded, current) {
        let keys: BTreeSet<&str> = recorded
            .keys()
            .chain(current.keys())
            .map(String::as_str)
            .collect();
        for key in keys {
            let child_path = format!("{path}/{}", escape_json_pointer_token(key));
            match (recorded.get(key), current.get(key)) {
                (Some(recorded), Some(current)) => {
                    collect_differences(&child_path, recorded, current, differences);
                }
                (Some(recorded), None) => differences.push(ReplayDifference {
                    path: child_path,
                    kind: ReplayDifferenceKind::Removed,
                    recorded: Some(recorded.clone()),
                    current: None,
                }),
                (None, Some(current)) => differences.push(ReplayDifference {
                    path: child_path,
                    kind: ReplayDifferenceKind::Added,
                    recorded: None,
                    current: Some(current.clone()),
                }),
                (None, None) => unreachable!(),
            }
        }
        return;
    }

    differences.push(ReplayDifference {
        path: path.to_string(),
        kind: ReplayDifferenceKind::Changed,
        recorded: Some(recorded.clone()),
        current: Some(current.clone()),
    });
}

fn escape_json_pointer_token(token: &str) -> String {
    token.replace('~', "~0").replace('/', "~1")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn bundle_value(chunks: BTreeMap<String, String>) -> Value {
        let parser_chunks: HashMap<String, String> = chunks
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        let diagnostics = build_comfyui_diagnostics_report(&parser_chunks);
        let chunk_lengths: BTreeMap<String, usize> = chunks
            .iter()
            .map(|(key, value)| (key.clone(), value.encode_utf16().count()))
            .collect();

        json!({
            "schemaVersion": SUPPORT_BUNDLE_SCHEMA_VERSION,
            "createdAt": "2026-08-08T12:00:00.000Z",
            "appVersion": diagnostics.app_version,
            "parserVersion": diagnostics.parser_version,
            "image": { "format": "png", "width": 512, "height": 512 },
            "diagnostics": diagnostics,
            "chunkLengths": chunk_lengths,
            "chunks": chunks
        })
    }

    fn minimal_chunks() -> BTreeMap<String, String> {
        BTreeMap::from([
            ("prompt".to_string(), "{}".to_string()),
            (
                "workflow".to_string(),
                r#"{"nodes":[],"links":[]}"#.to_string(),
            ),
        ])
    }

    #[test]
    fn matching_bundle_replays_deterministically_without_raw_chunks() {
        let mut chunks = minimal_chunks();
        chunks.insert(
            "privateRaw".to_string(),
            "DO_NOT_PRINT_PRIVATE_CHUNK_BODY".to_string(),
        );
        let input = serde_json::to_vec(&bundle_value(chunks)).unwrap();

        let (first, matches) = replay_comfyui_support_bundle(&input).unwrap();
        let (second, second_matches) = replay_comfyui_support_bundle(&input).unwrap();

        assert!(matches);
        assert!(second_matches);
        assert_eq!(first, second);
        assert!(!first.contains("DO_NOT_PRINT_PRIVATE_CHUNK_BODY"));
        let report: Value = serde_json::from_str(&first).unwrap();
        assert_eq!(report["parserOutputMatches"], true);
        assert_eq!(report["differenceCount"], 0);
        assert_eq!(report["differences"], json!([]));
        assert_eq!(
            report["chunkKeys"],
            json!(["privateRaw", "prompt", "workflow"])
        );
    }

    #[test]
    fn diagnostic_drift_is_reported_without_rejecting_the_bundle() {
        let mut bundle = bundle_value(minimal_chunks());
        let current_model = bundle["diagnostics"]["metadata"]["model"].clone();
        bundle["diagnostics"]["metadata"]["model"] = json!("recorded_model");
        let input = serde_json::to_vec(&bundle).unwrap();

        let (output, matches) = replay_comfyui_support_bundle(&input).unwrap();

        assert!(!matches);
        let report: Value = serde_json::from_str(&output).unwrap();
        assert_eq!(report["parserOutputMatches"], false);
        assert_eq!(report["differenceCount"], 1);
        assert_eq!(
            report["differences"],
            json!([{
                "path": "/metadata/model",
                "kind": "changed",
                "recorded": "recorded_model",
                "current": current_model
            }])
        );
        assert_eq!(
            report["recordedDiagnostics"]["metadata"]["model"],
            "recorded_model"
        );
    }

    #[test]
    fn app_and_parser_version_only_differences_still_match() {
        let mut bundle = bundle_value(minimal_chunks());
        bundle["appVersion"] = json!("0.9.0");
        bundle["parserVersion"] = json!(12);
        bundle["diagnostics"]["appVersion"] = json!("0.9.0");
        bundle["diagnostics"]["parserVersion"] = json!(12);
        let input = serde_json::to_vec(&bundle).unwrap();

        let (output, matches) = replay_comfyui_support_bundle(&input).unwrap();

        assert!(matches);
        let report: Value = serde_json::from_str(&output).unwrap();
        assert_eq!(report["differenceCount"], 0);
        assert_eq!(report["differences"], json!([]));
    }

    #[test]
    fn object_entries_use_added_removed_and_escaped_paths() {
        let recorded = json!({
            "fieldSources": {
                "removed/key~": "flat_parameters"
            }
        });
        let current = json!({
            "fieldSources": {
                "added/key~": "sampler_traversal"
            }
        });
        let mut differences = Vec::new();

        collect_differences("", &recorded, &current, &mut differences);

        assert_eq!(
            differences,
            vec![
                ReplayDifference {
                    path: "/fieldSources/added~1key~0".to_string(),
                    kind: ReplayDifferenceKind::Added,
                    recorded: None,
                    current: Some(json!("sampler_traversal")),
                },
                ReplayDifference {
                    path: "/fieldSources/removed~1key~0".to_string(),
                    kind: ReplayDifferenceKind::Removed,
                    recorded: Some(json!("flat_parameters")),
                    current: None,
                },
            ]
        );
    }

    #[test]
    fn arrays_are_reported_atomically_in_deterministic_path_order() {
        let recorded = json!({
            "metadata": { "loras": ["old"] },
            "traversalIssues": [{ "reason": "unsupported_node" }]
        });
        let current = json!({
            "metadata": { "loras": ["new"] },
            "traversalIssues": [{ "reason": "cycle_detected" }]
        });
        let mut first = Vec::new();
        let mut second = Vec::new();

        collect_differences("", &recorded, &current, &mut first);
        collect_differences("", &recorded, &current, &mut second);

        assert_eq!(first, second);
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].path, "/metadata/loras");
        assert_eq!(first[0].recorded, Some(json!(["old"])));
        assert_eq!(first[0].current, Some(json!(["new"])));
        assert_eq!(first[1].path, "/traversalIssues");
        assert_eq!(
            first[1].recorded,
            Some(json!([{ "reason": "unsupported_node" }]))
        );
        assert_eq!(
            first[1].current,
            Some(json!([{ "reason": "cycle_detected" }]))
        );
    }

    #[test]
    fn chunk_lengths_use_javascript_utf16_code_units() {
        let chunks = BTreeMap::from([("unicode".to_string(), "A😀é".to_string())]);
        let mut bundle = bundle_value(chunks);
        assert_eq!(bundle["chunkLengths"]["unicode"], 4);
        let valid = serde_json::to_vec(&bundle).unwrap();
        assert!(replay_comfyui_support_bundle(&valid).is_ok());

        bundle["chunkLengths"]["unicode"] = json!(3);
        let invalid = serde_json::to_vec(&bundle).unwrap();
        assert_eq!(
            replay_comfyui_support_bundle(&invalid).unwrap_err(),
            "Support bundle chunk length is inconsistent"
        );
    }

    #[test]
    fn malformed_schema_keys_and_versions_are_rejected() {
        let mut wrong_schema = bundle_value(minimal_chunks());
        wrong_schema["schemaVersion"] = json!(2);
        assert!(
            replay_comfyui_support_bundle(&serde_json::to_vec(&wrong_schema).unwrap())
                .unwrap_err()
                .contains("Unsupported support bundle schema version")
        );

        let mut wrong_keys = bundle_value(minimal_chunks());
        wrong_keys["chunkLengths"]
            .as_object_mut()
            .unwrap()
            .remove("prompt");
        assert_eq!(
            replay_comfyui_support_bundle(&serde_json::to_vec(&wrong_keys).unwrap()).unwrap_err(),
            "Support bundle chunk keys are inconsistent"
        );

        let mut wrong_versions = bundle_value(minimal_chunks());
        wrong_versions["parserVersion"] = json!(1);
        assert_eq!(
            replay_comfyui_support_bundle(&serde_json::to_vec(&wrong_versions).unwrap())
                .unwrap_err(),
            "Support bundle version fields are inconsistent"
        );
    }

    #[test]
    fn malformed_json_and_size_limit_fail_without_echoing_input() {
        let malformed = br#"{"chunks":{"secret":"DO_NOT_ECHO"}"#;
        let error = replay_comfyui_support_bundle(malformed).unwrap_err();
        assert!(error.starts_with("Invalid support bundle JSON at line"));
        assert!(!error.contains("DO_NOT_ECHO"));

        let input = serde_json::to_vec(&bundle_value(minimal_chunks())).unwrap();
        let error = replay_comfyui_support_bundle_with_limit(&input, input.len() - 1).unwrap_err();
        assert!(error.contains("size limit"));
        assert!(!error.contains("prompt"));
    }

    #[test]
    fn fixture_candidate_is_exact_deterministic_chunks_without_bundle_envelope() {
        let chunks = BTreeMap::from([
            (
                "privateRaw".to_string(),
                "DO_NOT_PRINT_PRIVATE_BODY".to_string(),
            ),
            (
                "prompt".to_string(),
                r#"{"1":{"class_type":"KSampler"}}"#.to_string(),
            ),
        ]);
        let input = serde_json::to_vec(&bundle_value(chunks.clone())).unwrap();

        let first = prepare_comfyui_fixture_candidate(&input).unwrap();
        let second = prepare_comfyui_fixture_candidate(&input).unwrap();

        assert_eq!(first, second);
        assert_eq!(first.last(), Some(&b'\n'));
        let candidate: BTreeMap<String, String> = serde_json::from_slice(&first).unwrap();
        assert_eq!(candidate, chunks);
        let candidate_json: Value = serde_json::from_slice(&first).unwrap();
        assert!(candidate_json.get("schemaVersion").is_none());
        assert!(candidate_json.get("createdAt").is_none());
        assert!(candidate_json.get("diagnostics").is_none());
        assert!(candidate_json.get("image").is_none());
    }

    #[test]
    fn fixture_candidate_rejects_empty_and_oversized_bundles() {
        let empty = serde_json::to_vec(&bundle_value(BTreeMap::new())).unwrap();
        assert_eq!(
            prepare_comfyui_fixture_candidate(&empty).unwrap_err(),
            "Support bundle contains no metadata chunks"
        );

        let input = serde_json::to_vec(&bundle_value(minimal_chunks())).unwrap();
        let error =
            prepare_comfyui_fixture_candidate_with_limit(&input, input.len() - 1).unwrap_err();
        assert!(error.contains("size limit"));
    }

    #[test]
    fn fixture_candidate_report_is_canonical_and_omits_raw_chunk_bodies() {
        let first = br#"{
            "workflow": "{\"nodes\":[],\"links\":[]}",
            "privateRaw": "DO_NOT_PRINT_PRIVATE_CHUNK_BODY",
            "prompt": "{}"
        }"#;
        let second = br#"{"prompt":"{}","privateRaw":"DO_NOT_PRINT_PRIVATE_CHUNK_BODY","workflow":"{\"nodes\":[],\"links\":[]}"}"#;

        let (first_report, first_matches) = inspect_comfyui_fixture_candidate(first, None).unwrap();
        let (second_report, second_matches) =
            inspect_comfyui_fixture_candidate(second, None).unwrap();

        assert!(first_matches);
        assert!(second_matches);
        assert_eq!(first_report, second_report);
        assert!(!first_report.contains("DO_NOT_PRINT_PRIVATE_CHUNK_BODY"));
        let report: Value = serde_json::from_str(&first_report).unwrap();
        assert_eq!(report["fixtureCandidateReportVersion"], 1);
        assert_eq!(report["candidateSha256"].as_str().unwrap().len(), 64);
        assert_eq!(
            report["chunkKeys"],
            json!(["privateRaw", "prompt", "workflow"])
        );
        assert_eq!(report["chunkLengths"]["prompt"], 2);
        assert!(report.get("sourceComparison").is_none());
    }

    #[test]
    fn fixture_candidate_comparison_reports_deterministic_diagnostic_drift() {
        let support_chunks = BTreeMap::from([(
            "parameters".to_string(),
            "Steps: 20, Sampler: euler, CFG scale: 5, Seed: 7, Model: support-model, Version: ComfyUI"
                .to_string(),
        )]);
        let bundle = serde_json::to_vec(&bundle_value(support_chunks)).unwrap();
        let candidate = br#"{"parameters":"Steps: 30, Sampler: euler, CFG scale: 5, Seed: 7, Model: candidate-model, Version: ComfyUI"}"#;

        let (first, matches) = inspect_comfyui_fixture_candidate(candidate, Some(&bundle)).unwrap();
        let (second, second_matches) =
            inspect_comfyui_fixture_candidate(candidate, Some(&bundle)).unwrap();

        assert!(!matches);
        assert!(!second_matches);
        assert_eq!(first, second);
        let report: Value = serde_json::from_str(&first).unwrap();
        assert_eq!(
            report["sourceComparison"]["candidateOutputMatchesSupport"],
            false
        );
        assert_eq!(report["sourceComparison"]["differenceCount"], 2);
        assert_eq!(
            report["sourceComparison"]["differences"],
            json!([
                {
                    "path": "/metadata/model",
                    "kind": "changed",
                    "support": "support-model",
                    "candidate": "candidate-model"
                },
                {
                    "path": "/metadata/steps",
                    "kind": "changed",
                    "support": 20,
                    "candidate": 30
                }
            ])
        );
    }

    #[test]
    fn fixture_candidate_comparison_uses_fresh_diagnostics_and_ignores_versions() {
        let chunks = minimal_chunks();
        let candidate = serde_json::to_vec(&chunks).unwrap();
        let mut bundle = bundle_value(chunks);
        bundle["appVersion"] = json!("0.1.0");
        bundle["parserVersion"] = json!(1);
        bundle["diagnostics"]["appVersion"] = json!("0.1.0");
        bundle["diagnostics"]["parserVersion"] = json!(1);
        bundle["diagnostics"]["metadata"]["model"] = json!("stale_recording");
        let bundle = serde_json::to_vec(&bundle).unwrap();

        let (report, matches) =
            inspect_comfyui_fixture_candidate(&candidate, Some(&bundle)).unwrap();

        assert!(matches);
        let report: Value = serde_json::from_str(&report).unwrap();
        assert_eq!(report["sourceComparison"]["differenceCount"], 0);
        assert_eq!(report["sourceComparison"]["differences"], json!([]));
    }

    #[test]
    fn fixture_candidate_validation_rejects_empty_nested_and_oversized_inputs_privately() {
        assert_eq!(
            inspect_comfyui_fixture_candidate(b"{}", None).unwrap_err(),
            "Fixture candidate contains no metadata chunks"
        );

        let nested = br#"{"prompt":{"secret":"DO_NOT_ECHO"}}"#;
        let error = inspect_comfyui_fixture_candidate(nested, None).unwrap_err();
        assert!(error.starts_with("Invalid fixture candidate JSON at line"));
        assert!(!error.contains("DO_NOT_ECHO"));

        let duplicate = br#"{"prompt":"first","prompt":"DO_NOT_ECHO_DUPLICATE"}"#;
        let error = inspect_comfyui_fixture_candidate(duplicate, None).unwrap_err();
        assert!(error.starts_with("Invalid fixture candidate JSON at line"));
        assert!(!error.contains("DO_NOT_ECHO_DUPLICATE"));

        let candidate = br#"{"prompt":"{}"}"#;
        let error =
            inspect_comfyui_fixture_candidate_with_limit(candidate, None, candidate.len() - 1)
                .unwrap_err();
        assert!(error.contains("size limit"));
        assert!(!error.contains("prompt"));
    }
}
