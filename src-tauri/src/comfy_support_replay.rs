use crate::metadata::comfyui::{build_comfyui_diagnostics_report, ComfyParserDiagnosticsReport};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};

pub const COMFY_SUPPORT_BUNDLE_MAX_BYTES: usize = 64 * 1024 * 1024;
const SUPPORT_BUNDLE_SCHEMA_VERSION: u32 = 1;

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

fn replay_comfyui_support_bundle_with_limit(
    input: &[u8],
    max_bytes: usize,
) -> Result<(String, bool), String> {
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
}
