use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const EXIT_OK: u8 = 0;
const EXIT_ERROR: u8 = 1;
const EXIT_MISMATCH: u8 = 2;
const SUPPORT_REPLAY_BATCH_SUMMARY_VERSION: u32 = 2;
const MAX_BATCH_JSON_FILES: usize = 256;

#[derive(Debug)]
enum ParsedArgs {
    Help,
    Inspect {
        path: PathBuf,
        verify: bool,
        summary: bool,
    },
    InspectBatch {
        directory: PathBuf,
        verify: bool,
    },
    Prepare {
        path: PathBuf,
        output: PathBuf,
    },
    InspectFixture {
        path: PathBuf,
        compare_support: Option<PathBuf>,
        verify: bool,
    },
}

fn main() -> ExitCode {
    let args: Vec<OsString> = env::args_os().skip(1).collect();
    let stdout = std::io::stdout();
    let stderr = std::io::stderr();
    let code = run(
        args,
        &mut stdout.lock(),
        &mut stderr.lock(),
        app_lib::COMFY_SUPPORT_BUNDLE_MAX_BYTES,
        |input, summary| {
            if summary {
                app_lib::summarize_comfyui_support_bundle_replay(input)
            } else {
                app_lib::replay_comfyui_support_bundle(input)
            }
        },
        app_lib::prepare_comfyui_fixture_candidate,
        app_lib::inspect_comfyui_fixture_candidate,
    );
    ExitCode::from(code)
}

fn run<F, G, H>(
    args: Vec<OsString>,
    stdout: &mut impl Write,
    stderr: &mut impl Write,
    max_bytes: usize,
    replay: F,
    prepare: G,
    inspect_fixture: H,
) -> u8
where
    F: Fn(&[u8], bool) -> Result<(String, bool), String>,
    G: Fn(&[u8]) -> Result<Vec<u8>, String>,
    H: Fn(&[u8], Option<&[u8]>) -> Result<(String, bool), String>,
{
    let parsed = match parse_args(args) {
        Ok(parsed) => parsed,
        Err(error) => {
            let _ = writeln!(stderr, "error: {error}");
            let _ = writeln!(stderr, "{}", usage());
            return EXIT_ERROR;
        }
    };

    let (path, mode) = match parsed {
        ParsedArgs::Help => {
            let _ = writeln!(stdout, "{}", usage());
            return EXIT_OK;
        }
        ParsedArgs::InspectBatch { directory, verify } => {
            return run_batch(&directory, verify, stdout, stderr, max_bytes, &replay);
        }
        ParsedArgs::Inspect {
            path,
            verify,
            summary,
        } => (path, RunMode::Inspect { verify, summary }),
        ParsedArgs::Prepare { path, output } => (path, RunMode::Prepare { output }),
        ParsedArgs::InspectFixture {
            path,
            compare_support,
            verify,
        } => (
            path,
            RunMode::InspectFixture {
                compare_support,
                verify,
            },
        ),
    };

    let input_kind = match &mode {
        RunMode::InspectFixture { .. } => "fixture candidate",
        _ => "support bundle",
    };
    let input = match read_bounded(&path, max_bytes, input_kind) {
        Ok(input) => input,
        Err(error) => {
            let _ = writeln!(stderr, "error: {error}");
            return EXIT_ERROR;
        }
    };
    match mode {
        RunMode::Inspect { verify, summary } => {
            let (report, matches) = match replay(&input, summary) {
                Ok(result) => result,
                Err(error) => {
                    let _ = writeln!(stderr, "error: {error}");
                    return EXIT_ERROR;
                }
            };

            if writeln!(stdout, "{report}").is_err() {
                let _ = writeln!(stderr, "error: failed to write replay report");
                return EXIT_ERROR;
            }
            if verify && !matches {
                let _ = writeln!(
                    stderr,
                    "error: parser output does not match the recorded diagnostics"
                );
                return EXIT_MISMATCH;
            }
        }
        RunMode::Prepare { output } => {
            let candidate = match prepare(&input) {
                Ok(candidate) => candidate,
                Err(error) => {
                    let _ = writeln!(stderr, "error: {error}");
                    return EXIT_ERROR;
                }
            };
            if let Err(error) = write_candidate(&output, &candidate) {
                let _ = writeln!(stderr, "error: {error}");
                return EXIT_ERROR;
            }
            if writeln!(stdout, "Fixture candidate written to {}", output.display()).is_err() {
                let _ = writeln!(stderr, "error: failed to write success message");
                return EXIT_ERROR;
            }
        }
        RunMode::InspectFixture {
            compare_support,
            verify,
        } => {
            let support_input = match compare_support {
                Some(path) => match read_bounded(&path, max_bytes, "support bundle") {
                    Ok(input) => Some(input),
                    Err(error) => {
                        let _ = writeln!(stderr, "error: {error}");
                        return EXIT_ERROR;
                    }
                },
                None => None,
            };
            let (report, matches) = match inspect_fixture(&input, support_input.as_deref()) {
                Ok(result) => result,
                Err(error) => {
                    let _ = writeln!(stderr, "error: {error}");
                    return EXIT_ERROR;
                }
            };
            if writeln!(stdout, "{report}").is_err() {
                let _ = writeln!(stderr, "error: failed to write fixture candidate report");
                return EXIT_ERROR;
            }
            if verify && !matches {
                let _ = writeln!(
                    stderr,
                    "error: fixture candidate output does not match the support bundle"
                );
                return EXIT_MISMATCH;
            }
        }
    }

    EXIT_OK
}

enum RunMode {
    Inspect {
        verify: bool,
        summary: bool,
    },
    Prepare {
        output: PathBuf,
    },
    InspectFixture {
        compare_support: Option<PathBuf>,
        verify: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum BatchCaseStatus {
    Matching,
    MetadataDrift,
    DiagnosticsDrift,
    MixedDrift,
    Invalid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchReplayCase {
    bundle_sha256: String,
    status: BatchCaseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    drift_signature_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<Value>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum BatchDifferenceKind {
    Added,
    Removed,
    Changed,
}

impl BatchDifferenceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Removed => "removed",
            Self::Changed => "changed",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchDifferenceSummary {
    path: String,
    kind: BatchDifferenceKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchSourceSummary {
    support_replay_summary_version: u32,
    bundle_sha256: String,
    metadata_output_matches: bool,
    diagnostics_match: bool,
    parser_output_matches: bool,
    differences: Vec<BatchDifferenceSummary>,
    comparison_ignored_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchDriftSignatureInput<'a> {
    status: BatchCaseStatus,
    differences: &'a [BatchDifferenceSummary],
    comparison_ignored_paths: &'a [String],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchDriftGroup {
    drift_signature_sha256: String,
    status: BatchCaseStatus,
    case_count: usize,
    bundle_sha256s: Vec<String>,
    differences: Vec<BatchDifferenceSummary>,
    comparison_ignored_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchReplaySummary {
    support_replay_batch_summary_version: u32,
    support_replay_summary_version: u32,
    discovered_json_file_count: usize,
    ignored_entry_count: usize,
    readable_case_count: usize,
    unreadable_file_count: usize,
    oversized_file_count: usize,
    valid_case_count: usize,
    invalid_case_count: usize,
    matching_case_count: usize,
    metadata_drift_case_count: usize,
    diagnostics_drift_case_count: usize,
    mixed_drift_case_count: usize,
    all_inputs_valid: bool,
    parser_output_matches: bool,
    drift_group_count: usize,
    drift_groups: Vec<BatchDriftGroup>,
    cases: Vec<BatchReplayCase>,
}

struct BatchDirectoryEntries {
    paths: Vec<PathBuf>,
    ignored_entry_count: usize,
}

enum BatchReadFailure {
    Unreadable,
    Oversized,
}

fn parse_args(args: Vec<OsString>) -> Result<ParsedArgs, String> {
    let mut paths = Vec::new();
    let mut verify = false;
    let mut summary = false;
    let mut batch = false;
    let mut prepare = false;
    let mut inspect_fixture = false;
    let mut acknowledged = false;
    let mut compare_support = None;
    let mut args = args.into_iter();

    while let Some(arg) = args.next() {
        // pnpm forwards the documented script separator to the child command.
        if arg == "--" {
            continue;
        }
        if arg == "--help" || arg == "-h" {
            return Ok(ParsedArgs::Help);
        }
        if arg == "--verify" {
            if verify {
                return Err("--verify may only be supplied once".to_string());
            }
            verify = true;
            continue;
        }
        if arg == "--summary" {
            if summary {
                return Err("--summary may only be supplied once".to_string());
            }
            summary = true;
            continue;
        }
        if arg == "--batch" {
            if batch {
                return Err("--batch may only be supplied once".to_string());
            }
            batch = true;
            continue;
        }
        if arg == "--prepare-fixture" {
            if prepare {
                return Err("--prepare-fixture may only be supplied once".to_string());
            }
            prepare = true;
            continue;
        }
        if arg == "--inspect-fixture" {
            if inspect_fixture {
                return Err("--inspect-fixture may only be supplied once".to_string());
            }
            inspect_fixture = true;
            continue;
        }
        if arg == "--compare-support" {
            if compare_support.is_some() {
                return Err("--compare-support may only be supplied once".to_string());
            }
            let path = args
                .next()
                .filter(|value| {
                    !value
                        .to_str()
                        .map(|value| value.starts_with('-'))
                        .unwrap_or(false)
                })
                .ok_or_else(|| "--compare-support requires a bundle path".to_string())?;
            compare_support = Some(PathBuf::from(path));
            continue;
        }
        if arg == "--acknowledge-sensitive-data" {
            if acknowledged {
                return Err("--acknowledge-sensitive-data may only be supplied once".to_string());
            }
            acknowledged = true;
            continue;
        }
        if arg
            .to_str()
            .map(|value| value.starts_with('-'))
            .unwrap_or(false)
        {
            return Err("unknown option".to_string());
        }
        paths.push(PathBuf::from(arg));
    }

    if prepare && inspect_fixture {
        return Err("--prepare-fixture cannot be combined with --inspect-fixture".to_string());
    }
    if batch {
        if prepare || inspect_fixture {
            return Err("--batch cannot be combined with fixture modes".to_string());
        }
        if summary {
            return Err("--summary cannot be combined with --batch".to_string());
        }
        if acknowledged {
            return Err("--acknowledge-sensitive-data cannot be combined with --batch".to_string());
        }
        if compare_support.is_some() {
            return Err("--compare-support cannot be combined with --batch".to_string());
        }
        if paths.len() != 1 {
            return Err("batch inspection requires exactly one directory path".to_string());
        }
        return Ok(ParsedArgs::InspectBatch {
            directory: paths.pop().unwrap(),
            verify,
        });
    }
    if prepare {
        if summary {
            return Err("--summary cannot be combined with --prepare-fixture".to_string());
        }
        if verify {
            return Err("--verify cannot be combined with --prepare-fixture".to_string());
        }
        if compare_support.is_some() {
            return Err("--compare-support cannot be combined with --prepare-fixture".to_string());
        }
        if !acknowledged {
            return Err("--prepare-fixture requires --acknowledge-sensitive-data".to_string());
        }
        if paths.len() != 2 {
            return Err("fixture preparation requires input and output paths".to_string());
        }
        let output = paths.pop().unwrap();
        let path = paths.pop().unwrap();
        if !has_chunks_json_suffix(&output) {
            return Err("fixture output must end with .chunks.json".to_string());
        }
        return Ok(ParsedArgs::Prepare { path, output });
    }

    if inspect_fixture {
        if summary {
            return Err("--summary cannot be combined with --inspect-fixture".to_string());
        }
        if acknowledged {
            return Err(
                "--acknowledge-sensitive-data cannot be combined with --inspect-fixture"
                    .to_string(),
            );
        }
        if verify && compare_support.is_none() {
            return Err("fixture --verify requires --compare-support".to_string());
        }
        if paths.len() != 1 {
            return Err("fixture inspection requires exactly one candidate path".to_string());
        }
        let path = paths.pop().unwrap();
        if !has_chunks_json_suffix(&path) {
            return Err("fixture candidate must end with .chunks.json".to_string());
        }
        return Ok(ParsedArgs::InspectFixture {
            path,
            compare_support,
            verify,
        });
    }

    if acknowledged {
        return Err("--acknowledge-sensitive-data requires --prepare-fixture".to_string());
    }
    if compare_support.is_some() {
        return Err("--compare-support requires --inspect-fixture".to_string());
    }
    if paths.len() != 1 {
        return Err("exactly one support bundle path is required".to_string());
    }
    Ok(ParsedArgs::Inspect {
        path: paths.pop().unwrap(),
        verify,
        summary,
    })
}

fn has_chunks_json_suffix(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".chunks.json"))
        .unwrap_or(false)
}

fn has_json_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
}

fn run_batch<F>(
    directory: &Path,
    verify: bool,
    stdout: &mut impl Write,
    stderr: &mut impl Write,
    max_bytes: usize,
    replay: &F,
) -> u8
where
    F: Fn(&[u8], bool) -> Result<(String, bool), String>,
{
    let entries = match discover_batch_entries(directory) {
        Ok(entries) => entries,
        Err(error) => {
            let _ = writeln!(stderr, "error: {error}");
            return EXIT_ERROR;
        }
    };

    let mut cases = Vec::with_capacity(entries.paths.len());
    let mut drift_groups = BTreeMap::new();
    let mut readable_case_count = 0;
    let mut unreadable_file_count = 0;
    let mut oversized_file_count = 0;
    let mut valid_case_count = 0;
    let mut invalid_case_count = 0;
    let mut matching_case_count = 0;
    let mut metadata_drift_case_count = 0;
    let mut diagnostics_drift_case_count = 0;
    let mut mixed_drift_case_count = 0;

    for path in &entries.paths {
        let input = match read_batch_bundle(path, max_bytes) {
            Ok(input) => input,
            Err(BatchReadFailure::Unreadable) => {
                unreadable_file_count += 1;
                continue;
            }
            Err(BatchReadFailure::Oversized) => {
                oversized_file_count += 1;
                continue;
            }
        };
        readable_case_count += 1;
        let bundle_sha256 = hex::encode(Sha256::digest(&input));

        let (serialized, matches) = match replay(&input, true) {
            Ok(result) => result,
            Err(_) => {
                invalid_case_count += 1;
                cases.push(BatchReplayCase {
                    bundle_sha256,
                    status: BatchCaseStatus::Invalid,
                    drift_signature_sha256: None,
                    summary: None,
                });
                continue;
            }
        };
        let summary: Value = match serde_json::from_str(&serialized) {
            Ok(summary) => summary,
            Err(_) => {
                let _ = writeln!(stderr, "error: failed to decode internal replay summary");
                return EXIT_ERROR;
            }
        };
        let source_summary: BatchSourceSummary = match serde_json::from_value(summary.clone()) {
            Ok(summary) => summary,
            Err(_) => {
                let _ = writeln!(stderr, "error: internal replay summary is incomplete");
                return EXIT_ERROR;
            }
        };
        if source_summary.support_replay_summary_version != app_lib::SUPPORT_REPLAY_SUMMARY_VERSION
        {
            let _ = writeln!(stderr, "error: replay summary version mismatch");
            return EXIT_ERROR;
        }
        if source_summary.bundle_sha256 != bundle_sha256 {
            let _ = writeln!(stderr, "error: replay summary identity mismatch");
            return EXIT_ERROR;
        }
        let metadata_matches = source_summary.metadata_output_matches;
        let diagnostics_match = source_summary.diagnostics_match;
        let combined_matches = source_summary.parser_output_matches;
        if combined_matches != matches
            || combined_matches != (metadata_matches && diagnostics_match)
        {
            let _ = writeln!(stderr, "error: replay summary verdicts are inconsistent");
            return EXIT_ERROR;
        }

        valid_case_count += 1;
        let status = match (metadata_matches, diagnostics_match) {
            (true, true) => {
                matching_case_count += 1;
                BatchCaseStatus::Matching
            }
            (false, true) => {
                metadata_drift_case_count += 1;
                BatchCaseStatus::MetadataDrift
            }
            (true, false) => {
                diagnostics_drift_case_count += 1;
                BatchCaseStatus::DiagnosticsDrift
            }
            (false, false) => {
                mixed_drift_case_count += 1;
                BatchCaseStatus::MixedDrift
            }
        };
        let drift_signature_sha256 = if combined_matches {
            None
        } else {
            let mut differences = source_summary.differences;
            differences.sort_by(|left, right| {
                left.path
                    .cmp(&right.path)
                    .then_with(|| left.kind.as_str().cmp(right.kind.as_str()))
            });
            let mut comparison_ignored_paths = source_summary.comparison_ignored_paths;
            comparison_ignored_paths.sort();
            comparison_ignored_paths.dedup();
            let signature = drift_signature(status, &differences, &comparison_ignored_paths);
            let group = drift_groups
                .entry(signature.clone())
                .or_insert_with(|| BatchDriftGroup {
                    drift_signature_sha256: signature.clone(),
                    status,
                    case_count: 0,
                    bundle_sha256s: Vec::new(),
                    differences,
                    comparison_ignored_paths,
                });
            group.case_count += 1;
            group.bundle_sha256s.push(bundle_sha256.clone());
            Some(signature)
        };
        cases.push(BatchReplayCase {
            bundle_sha256,
            status,
            drift_signature_sha256,
            summary: Some(summary),
        });
    }

    cases.sort_by(|left, right| left.bundle_sha256.cmp(&right.bundle_sha256));
    let mut drift_groups: Vec<_> = drift_groups.into_values().collect();
    for group in &mut drift_groups {
        group.bundle_sha256s.sort();
    }
    let all_inputs_valid =
        unreadable_file_count == 0 && oversized_file_count == 0 && invalid_case_count == 0;
    let parser_output_matches = all_inputs_valid
        && metadata_drift_case_count == 0
        && diagnostics_drift_case_count == 0
        && mixed_drift_case_count == 0;
    let report = BatchReplaySummary {
        support_replay_batch_summary_version: SUPPORT_REPLAY_BATCH_SUMMARY_VERSION,
        support_replay_summary_version: app_lib::SUPPORT_REPLAY_SUMMARY_VERSION,
        discovered_json_file_count: entries.paths.len(),
        ignored_entry_count: entries.ignored_entry_count,
        readable_case_count,
        unreadable_file_count,
        oversized_file_count,
        valid_case_count,
        invalid_case_count,
        matching_case_count,
        metadata_drift_case_count,
        diagnostics_drift_case_count,
        mixed_drift_case_count,
        all_inputs_valid,
        parser_output_matches,
        drift_group_count: drift_groups.len(),
        drift_groups,
        cases,
    };
    let serialized = match serde_json::to_string(&report) {
        Ok(serialized) => serialized,
        Err(_) => {
            let _ = writeln!(stderr, "error: failed to serialize batch replay summary");
            return EXIT_ERROR;
        }
    };
    if writeln!(stdout, "{serialized}").is_err() {
        let _ = writeln!(stderr, "error: failed to write batch replay summary");
        return EXIT_ERROR;
    }

    if !all_inputs_valid {
        let _ = writeln!(
            stderr,
            "error: batch contains unreadable, oversized, or invalid support bundles"
        );
        return EXIT_ERROR;
    }
    if verify && !parser_output_matches {
        let _ = writeln!(
            stderr,
            "error: one or more parser outputs do not match the recorded diagnostics"
        );
        return EXIT_MISMATCH;
    }
    EXIT_OK
}

fn discover_batch_entries(directory: &Path) -> Result<BatchDirectoryEntries, String> {
    let directory_metadata = fs::symlink_metadata(directory)
        .map_err(|_| "batch input must be an existing directory".to_string())?;
    if !directory_metadata.file_type().is_dir() {
        return Err("batch input must be an existing directory".to_string());
    }
    let entries = fs::read_dir(directory)
        .map_err(|_| "unable to enumerate support bundle directory".to_string())?;
    let mut paths = Vec::new();
    let mut ignored_entry_count = 0;
    for entry in entries {
        let entry =
            entry.map_err(|_| "unable to enumerate support bundle directory".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "unable to inspect support bundle directory entry".to_string())?;
        let path = entry.path();
        if file_type.is_file() && has_json_extension(&path) {
            paths.push(path);
        } else {
            ignored_entry_count += 1;
        }
    }
    if paths.is_empty() {
        return Err("batch directory contains no regular JSON files".to_string());
    }
    if paths.len() > MAX_BATCH_JSON_FILES {
        return Err(format!(
            "batch directory exceeds the {MAX_BATCH_JSON_FILES}-file limit"
        ));
    }
    paths.sort();
    Ok(BatchDirectoryEntries {
        paths,
        ignored_entry_count,
    })
}

fn read_batch_bundle(path: &Path, max_bytes: usize) -> Result<Vec<u8>, BatchReadFailure> {
    let metadata = fs::symlink_metadata(path).map_err(|_| BatchReadFailure::Unreadable)?;
    if !metadata.file_type().is_file() {
        return Err(BatchReadFailure::Unreadable);
    }
    if metadata.len() > max_bytes as u64 {
        return Err(BatchReadFailure::Oversized);
    }
    let file = File::open(path).map_err(|_| BatchReadFailure::Unreadable)?;
    let mut input = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut input)
        .map_err(|_| BatchReadFailure::Unreadable)?;
    if input.len() > max_bytes {
        return Err(BatchReadFailure::Oversized);
    }
    Ok(input)
}

fn drift_signature(
    status: BatchCaseStatus,
    differences: &[BatchDifferenceSummary],
    comparison_ignored_paths: &[String],
) -> String {
    let input = BatchDriftSignatureInput {
        status,
        differences,
        comparison_ignored_paths,
    };
    let canonical = serde_json::to_vec(&input).expect("drift signature input should serialize");
    hex::encode(Sha256::digest(canonical))
}

fn read_bounded(path: &Path, max_bytes: usize, input_kind: &str) -> Result<Vec<u8>, String> {
    let metadata = path
        .metadata()
        .map_err(|_| format!("unable to read {input_kind} metadata"))?;
    if metadata.len() > max_bytes as u64 {
        return Err(size_limit_message(max_bytes, input_kind));
    }

    let file = File::open(path).map_err(|_| format!("unable to open {input_kind}"))?;
    let mut input = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut input)
        .map_err(|_| format!("unable to read {input_kind}"))?;
    if input.len() > max_bytes {
        return Err(size_limit_message(max_bytes, input_kind));
    }

    Ok(input)
}

fn size_limit_message(max_bytes: usize, input_kind: &str) -> String {
    format!(
        "{input_kind} exceeds the {} MiB size limit",
        max_bytes / (1024 * 1024)
    )
}

fn write_candidate(path: &Path, contents: &[u8]) -> Result<(), String> {
    write_candidate_with(path, contents, |file, contents| {
        file.write_all(contents)?;
        file.sync_all()
    })
}

fn write_candidate_with<F>(path: &Path, contents: &[u8], write: F) -> Result<(), String>
where
    F: FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
{
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err("fixture output directory does not exist".to_string());
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "fixture output already exists or cannot be created".to_string())?;
    if write(&mut file, contents).is_err() {
        drop(file);
        let _ = fs::remove_file(path);
        return Err("failed to write fixture candidate".to_string());
    }
    Ok(())
}

fn usage() -> &'static str {
    "Usage:\n  pnpm run inspect:comfyui-support -- <bundle-path> [--verify] [--summary]\n  pnpm run inspect:comfyui-support-batch -- <directory> [--verify]\n  pnpm run prepare:comfyui-fixture -- <bundle-path> <output.chunks.json> --acknowledge-sensitive-data\n  pnpm run inspect:comfyui-fixture -- <candidate.chunks.json> [--compare-support <bundle-path>] [--verify]"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str, contents: &[u8]) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "ambit_comfy_support_{name}_{}_{}.json",
            std::process::id(),
            nonce
        ));
        fs::write(&path, contents).unwrap();
        path
    }

    fn temp_chunks_file(name: &str, contents: &[u8]) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "ambit_comfy_fixture_{name}_{}_{}.chunks.json",
            std::process::id(),
            nonce
        ));
        fs::write(&path, contents).unwrap();
        path
    }

    fn temp_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "ambit_comfy_support_batch_{name}_{}_{}",
            std::process::id(),
            nonce
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    fn fake_batch_replay(input: &[u8], _: bool) -> Result<(String, bool), String> {
        let difference = |path: &str| BatchDifferenceSummary {
            path: path.to_string(),
            kind: BatchDifferenceKind::Changed,
        };
        let (metadata_matches, diagnostics_match, differences, comparison_ignored_paths) =
            match input {
                b"MATCH_PRIVATE_VALUE" => (true, true, Vec::new(), Vec::new()),
                b"METADATA_PRIVATE_VALUE" | b"METADATA_SECOND_PRIVATE_VALUE" => {
                    (false, true, vec![difference("/metadata/model")], Vec::new())
                }
                b"METADATA_STEPS_PRIVATE_VALUE" => {
                    (false, true, vec![difference("/metadata/steps")], Vec::new())
                }
                b"METADATA_LEGACY_PRIVATE_VALUE" => (
                    false,
                    true,
                    vec![difference("/metadata/model")],
                    vec![
                        "/resourceSources".to_string(),
                        "/fieldSourceNodeIds".to_string(),
                        "/resourceSources".to_string(),
                    ],
                ),
                b"DIAGNOSTICS_PRIVATE_VALUE" => (
                    true,
                    false,
                    vec![difference("/fieldSources/model")],
                    Vec::new(),
                ),
                b"MIXED_PRIVATE_VALUE" => (
                    false,
                    false,
                    vec![
                        difference("/fieldSources/model"),
                        difference("/metadata/model"),
                    ],
                    Vec::new(),
                ),
                b"INVALID_PRIVATE_VALUE" => return Err("invalid bundle".to_string()),
                _ => return Err("unexpected test bundle".to_string()),
            };
        let parser_output_matches = metadata_matches && diagnostics_match;
        let bundle_sha256 = hex::encode(Sha256::digest(input));
        Ok((
            serde_json::json!({
                "supportReplaySummaryVersion": app_lib::SUPPORT_REPLAY_SUMMARY_VERSION,
                "bundleSha256": bundle_sha256,
                "metadataOutputMatches": metadata_matches,
                "diagnosticsMatch": diagnostics_match,
                "parserOutputMatches": parser_output_matches,
                "differences": differences,
                "comparisonIgnoredPaths": comparison_ignored_paths,
            })
            .to_string(),
            parser_output_matches,
        ))
    }

    fn fake_replay(matches: bool) -> impl Fn(&[u8], bool) -> Result<(String, bool), String> {
        move |_, _| Ok((format!(r#"{{"parserOutputMatches":{matches}}}"#), matches))
    }

    fn fake_prepare(contents: &'static [u8]) -> impl Fn(&[u8]) -> Result<Vec<u8>, String> {
        move |_| Ok(contents.to_vec())
    }

    fn fake_fixture_inspect(
        matches: bool,
    ) -> impl Fn(&[u8], Option<&[u8]>) -> Result<(String, bool), String> {
        move |_, _| {
            Ok((
                format!(r#"{{"candidateOutputMatchesSupport":{matches}}}"#),
                matches,
            ))
        }
    }

    #[test]
    fn normal_mode_reports_drift_with_success_exit() {
        let path = temp_file("normal_mismatch", b"PRIVATE_RAW_BODY");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![path.clone().into_os_string()],
            &mut stdout,
            &mut stderr,
            1024,
            |_, summary| {
                assert!(!summary);
                Ok((
                    r#"{"parserOutputMatches":false,"metadataOutputMatches":false,"diagnosticsMatch":true}"#
                        .to_string(),
                    false,
                ))
            },
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_OK);
        assert!(String::from_utf8(stdout)
            .unwrap()
            .contains(r#""metadataOutputMatches":false"#));
        assert!(stderr.is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn summary_mode_emits_the_summary_report() {
        let path = temp_file("summary", b"PRIVATE_RAW_BODY");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![path.clone().into_os_string(), "--summary".into()],
            &mut stdout,
            &mut stderr,
            1024,
            |_, summary| {
                assert!(summary);
                Ok((
                    r#"{"supportReplaySummaryVersion":2,"parserOutputMatches":true}"#.to_string(),
                    true,
                ))
            },
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_OK);
        let stdout = String::from_utf8(stdout).unwrap();
        assert!(stdout.contains(r#""supportReplaySummaryVersion":2"#));
        assert!(!stdout.contains("PRIVATE_RAW_BODY"));
        assert!(stderr.is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn batch_mode_classifies_every_readable_case_without_disclosing_names_or_values() {
        let directory = temp_directory("classify");
        let private_names_and_values = [
            ("customer-alpha.json", b"MATCH_PRIVATE_VALUE".as_slice()),
            ("customer-beta.json", b"METADATA_PRIVATE_VALUE".as_slice()),
            (
                "customer-gamma.JSON",
                b"DIAGNOSTICS_PRIVATE_VALUE".as_slice(),
            ),
            ("customer-delta.json", b"MIXED_PRIVATE_VALUE".as_slice()),
            ("customer-invalid.json", b"INVALID_PRIVATE_VALUE".as_slice()),
        ];
        for (name, contents) in private_names_and_values {
            fs::write(directory.join(name), contents).unwrap();
        }
        fs::write(
            directory.join("private-notes.txt"),
            b"IGNORED_PRIVATE_VALUE",
        )
        .unwrap();
        let nested = directory.join("nested-private-folder");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("nested.json"), b"MATCH_PRIVATE_VALUE").unwrap();

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = run(
            vec!["--batch".into(), directory.clone().into_os_string()],
            &mut stdout,
            &mut stderr,
            1024,
            fake_batch_replay,
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_ERROR);
        let output = String::from_utf8(stdout).unwrap();
        let report: Value = serde_json::from_str(output.trim()).unwrap();
        assert_eq!(report["supportReplayBatchSummaryVersion"], 2);
        assert_eq!(report["supportReplaySummaryVersion"], 2);
        assert_eq!(report["discoveredJsonFileCount"], 5);
        assert_eq!(report["ignoredEntryCount"], 2);
        assert_eq!(report["readableCaseCount"], 5);
        assert_eq!(report["validCaseCount"], 4);
        assert_eq!(report["invalidCaseCount"], 1);
        assert_eq!(report["matchingCaseCount"], 1);
        assert_eq!(report["metadataDriftCaseCount"], 1);
        assert_eq!(report["diagnosticsDriftCaseCount"], 1);
        assert_eq!(report["mixedDriftCaseCount"], 1);
        assert_eq!(report["allInputsValid"], false);
        assert_eq!(report["parserOutputMatches"], false);
        assert_eq!(report["driftGroupCount"], 3);
        assert_eq!(report["driftGroups"].as_array().unwrap().len(), 3);

        let cases = report["cases"].as_array().unwrap();
        let hashes: Vec<_> = cases
            .iter()
            .map(|case| case["bundleSha256"].as_str().unwrap())
            .collect();
        assert!(hashes.windows(2).all(|pair| pair[0] <= pair[1]));
        for status in [
            "matching",
            "metadata_drift",
            "diagnostics_drift",
            "mixed_drift",
            "invalid",
        ] {
            assert_eq!(
                cases.iter().filter(|case| case["status"] == status).count(),
                1
            );
        }
        for case in cases {
            if matches!(case["status"].as_str(), Some("matching" | "invalid")) {
                assert!(case.get("driftSignatureSha256").is_none());
            } else {
                assert_eq!(case["driftSignatureSha256"].as_str().unwrap().len(), 64);
            }
        }
        for (name, contents) in private_names_and_values {
            assert!(!output.contains(name));
            assert!(!output.contains(std::str::from_utf8(contents).unwrap()));
        }
        assert!(!output.contains(directory.to_string_lossy().as_ref()));
        assert!(!output.contains("private-notes.txt"));
        assert!(!output.contains("nested-private-folder"));
        assert!(String::from_utf8(stderr)
            .unwrap()
            .contains("unreadable, oversized, or invalid"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn batch_groups_identical_redacted_drift_and_separates_scope_changes() {
        let directory = temp_directory("grouping");
        let private_names_and_values = [
            ("first-name.json", b"METADATA_PRIVATE_VALUE".as_slice()),
            ("duplicate-name.json", b"METADATA_PRIVATE_VALUE".as_slice()),
            (
                "different-bytes.json",
                b"METADATA_SECOND_PRIVATE_VALUE".as_slice(),
            ),
            (
                "different-path.json",
                b"METADATA_STEPS_PRIVATE_VALUE".as_slice(),
            ),
            (
                "legacy-scope.json",
                b"METADATA_LEGACY_PRIVATE_VALUE".as_slice(),
            ),
        ];
        for (name, contents) in private_names_and_values {
            fs::write(directory.join(name), contents).unwrap();
        }

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        assert_eq!(
            run(
                vec!["--batch".into(), directory.clone().into_os_string()],
                &mut stdout,
                &mut stderr,
                1024,
                fake_batch_replay,
                fake_prepare(b"{}\n"),
                fake_fixture_inspect(true),
            ),
            EXIT_OK
        );
        assert!(stderr.is_empty());

        let output = String::from_utf8(stdout).unwrap();
        let report: Value = serde_json::from_str(output.trim()).unwrap();
        assert_eq!(report["driftGroupCount"], 3);
        let groups = report["driftGroups"].as_array().unwrap();
        assert!(groups.windows(2).all(|pair| {
            pair[0]["driftSignatureSha256"].as_str().unwrap()
                <= pair[1]["driftSignatureSha256"].as_str().unwrap()
        }));
        let model_group = groups
            .iter()
            .find(|group| {
                group["differences"]
                    == serde_json::json!([{"path": "/metadata/model", "kind": "changed"}])
                    && group["comparisonIgnoredPaths"] == serde_json::json!([])
            })
            .unwrap();
        assert_eq!(model_group["status"], "metadata_drift");
        assert_eq!(model_group["caseCount"], 3);
        let bundle_hashes = model_group["bundleSha256s"].as_array().unwrap();
        assert!(bundle_hashes
            .windows(2)
            .all(|pair| pair[0].as_str().unwrap() <= pair[1].as_str().unwrap()));
        let duplicate_hash = hex::encode(Sha256::digest(b"METADATA_PRIVATE_VALUE"));
        assert_eq!(
            bundle_hashes
                .iter()
                .filter(|hash| hash.as_str() == Some(&duplicate_hash))
                .count(),
            2
        );

        let canonical = br#"{"status":"metadata_drift","differences":[{"path":"/metadata/model","kind":"changed"}],"comparisonIgnoredPaths":[]}"#;
        assert_eq!(
            model_group["driftSignatureSha256"],
            hex::encode(Sha256::digest(canonical))
        );
        assert_eq!(
            report["cases"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|case| {
                    case["driftSignatureSha256"] == model_group["driftSignatureSha256"]
                })
                .count(),
            3
        );
        assert!(groups.iter().any(|group| {
            group["differences"]
                == serde_json::json!([{"path": "/metadata/steps", "kind": "changed"}])
        }));
        assert!(groups.iter().any(|group| {
            group["comparisonIgnoredPaths"]
                == serde_json::json!(["/fieldSourceNodeIds", "/resourceSources"])
        }));
        for (name, contents) in private_names_and_values {
            assert!(!output.contains(name));
            assert!(!output.contains(std::str::from_utf8(contents).unwrap()));
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn drift_signature_distinguishes_status_kind_and_compatibility_scope() {
        let changed = vec![BatchDifferenceSummary {
            path: "/metadata/model".to_string(),
            kind: BatchDifferenceKind::Changed,
        }];
        let added = vec![BatchDifferenceSummary {
            path: "/metadata/model".to_string(),
            kind: BatchDifferenceKind::Added,
        }];
        let baseline = drift_signature(BatchCaseStatus::MetadataDrift, &changed, &[]);

        assert_ne!(
            baseline,
            drift_signature(BatchCaseStatus::DiagnosticsDrift, &changed, &[])
        );
        assert_ne!(
            baseline,
            drift_signature(BatchCaseStatus::MetadataDrift, &added, &[])
        );
        assert_ne!(
            baseline,
            drift_signature(
                BatchCaseStatus::MetadataDrift,
                &changed,
                &["/resourceSources".to_string()]
            )
        );
    }

    #[test]
    fn batch_exit_codes_distinguish_drift_from_invalid_input() {
        for (name, contents, verify, expected) in [
            ("clean", b"MATCH_PRIVATE_VALUE".as_slice(), false, EXIT_OK),
            (
                "drift-report",
                b"METADATA_PRIVATE_VALUE".as_slice(),
                false,
                EXIT_OK,
            ),
            (
                "drift-verify",
                b"METADATA_PRIVATE_VALUE".as_slice(),
                true,
                EXIT_MISMATCH,
            ),
            (
                "invalid-verify",
                b"INVALID_PRIVATE_VALUE".as_slice(),
                true,
                EXIT_ERROR,
            ),
        ] {
            let directory = temp_directory(name);
            fs::write(directory.join("case.json"), contents).unwrap();
            let mut args = vec!["--batch".into(), directory.clone().into_os_string()];
            if verify {
                args.push("--verify".into());
            }
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            assert_eq!(
                run(
                    args,
                    &mut stdout,
                    &mut stderr,
                    1024,
                    fake_batch_replay,
                    fake_prepare(b"{}\n"),
                    fake_fixture_inspect(true),
                ),
                expected
            );
            assert!(serde_json::from_slice::<Value>(&stdout).is_ok());
            fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn batch_output_is_stable_across_file_and_directory_renames() {
        let first = temp_directory("rename-first");
        let second = temp_directory("rename-second");
        fs::write(
            first.join("private-first-name.json"),
            b"METADATA_PRIVATE_VALUE",
        )
        .unwrap();
        fs::write(
            second.join("unrelated-second-name.json"),
            b"METADATA_PRIVATE_VALUE",
        )
        .unwrap();

        let inspect = |directory: &Path| {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            let code = run(
                vec!["--batch".into(), directory.as_os_str().into()],
                &mut stdout,
                &mut stderr,
                1024,
                fake_batch_replay,
                fake_prepare(b"{}\n"),
                fake_fixture_inspect(true),
            );
            assert_eq!(code, EXIT_OK);
            assert!(stderr.is_empty());
            stdout
        };

        let first_output = inspect(&first);
        let second_output = inspect(&second);
        assert_eq!(first_output, second_output);
        let report: Value = serde_json::from_slice(&first_output).unwrap();
        assert_eq!(report["driftGroupCount"], 1);
        assert_eq!(report["driftGroups"][0]["caseCount"], 1);
        assert_eq!(
            report["cases"][0]["bundleSha256"],
            hex::encode(Sha256::digest(b"METADATA_PRIVATE_VALUE"))
        );
        fs::remove_dir_all(first).unwrap();
        fs::remove_dir_all(second).unwrap();
    }

    #[test]
    fn batch_limits_and_arguments_fail_without_disclosing_entries() {
        assert_eq!(
            parse_args(vec!["--batch".into(), "--summary".into(), "private".into(),]).unwrap_err(),
            "--summary cannot be combined with --batch"
        );
        assert_eq!(
            parse_args(vec![
                "--batch".into(),
                "--prepare-fixture".into(),
                "private".into(),
            ])
            .unwrap_err(),
            "--batch cannot be combined with fixture modes"
        );
        assert_eq!(
            parse_args(vec![
                "--batch".into(),
                "--inspect-fixture".into(),
                "private".into(),
            ])
            .unwrap_err(),
            "--batch cannot be combined with fixture modes"
        );
        assert_eq!(
            parse_args(vec![
                "--batch".into(),
                "--acknowledge-sensitive-data".into(),
                "private".into(),
            ])
            .unwrap_err(),
            "--acknowledge-sensitive-data cannot be combined with --batch"
        );
        assert_eq!(
            parse_args(vec![
                "--batch".into(),
                "--compare-support".into(),
                "support.json".into(),
                "private".into(),
            ])
            .unwrap_err(),
            "--compare-support cannot be combined with --batch"
        );

        let empty = temp_directory("empty");
        fs::write(empty.join("ignored.txt"), b"PRIVATE").unwrap();
        assert_eq!(
            match discover_batch_entries(&empty) {
                Ok(_) => panic!("empty batch should be rejected"),
                Err(error) => error,
            },
            "batch directory contains no regular JSON files"
        );
        fs::remove_dir_all(empty).unwrap();

        let too_many = temp_directory("too-many");
        for index in 0..=MAX_BATCH_JSON_FILES {
            fs::write(too_many.join(format!("{index}.json")), b"{}").unwrap();
        }
        assert_eq!(
            match discover_batch_entries(&too_many) {
                Ok(_) => panic!("oversized batch should be rejected"),
                Err(error) => error,
            },
            "batch directory exceeds the 256-file limit"
        );
        fs::remove_dir_all(too_many).unwrap();

        let oversized = temp_directory("oversized");
        fs::write(
            oversized.join("too-private.json"),
            b"OVERSIZED_PRIVATE_VALUE_BEYOND_LIMIT",
        )
        .unwrap();
        fs::write(oversized.join("valid.json"), b"MATCH_PRIVATE_VALUE").unwrap();
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        assert_eq!(
            run(
                vec!["--batch".into(), oversized.clone().into_os_string()],
                &mut stdout,
                &mut stderr,
                b"MATCH_PRIVATE_VALUE".len(),
                fake_batch_replay,
                fake_prepare(b"{}\n"),
                fake_fixture_inspect(true),
            ),
            EXIT_ERROR
        );
        let report: Value = serde_json::from_slice(&stdout).unwrap();
        assert_eq!(report["oversizedFileCount"], 1);
        assert_eq!(report["readableCaseCount"], 1);
        assert_eq!(report["validCaseCount"], 1);
        assert!(!String::from_utf8(stdout)
            .unwrap()
            .contains("too-private.json"));
        assert!(matches!(
            read_batch_bundle(&oversized.join("missing.json"), 1024),
            Err(BatchReadFailure::Unreadable)
        ));
        fs::remove_dir_all(oversized).unwrap();
    }

    #[test]
    fn verify_mode_uses_exit_two_for_diagnostics_only_drift() {
        let path = temp_file("verify_mismatch", b"{}");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![
                path.clone().into_os_string(),
                "--summary".into(),
                "--verify".into(),
            ],
            &mut stdout,
            &mut stderr,
            1024,
            |_, summary| {
                assert!(summary);
                Ok((
                    r#"{"parserOutputMatches":false,"metadataOutputMatches":true,"diagnosticsMatch":false}"#
                        .to_string(),
                    false,
                ))
            },
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_MISMATCH);
        assert!(String::from_utf8(stdout)
            .unwrap()
            .contains(r#""diagnosticsMatch":false"#));
        assert!(String::from_utf8(stderr)
            .unwrap()
            .contains("parser output does not match"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn matching_verify_mode_succeeds() {
        let path = temp_file("verify_match", b"{}");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec!["--verify".into(), path.clone().into_os_string()],
            &mut stdout,
            &mut stderr,
            1024,
            |_, _| {
                Ok((
                    r#"{"parserOutputMatches":true,"comparisonIgnoredPaths":["/resourceSources"]}"#
                        .to_string(),
                    true,
                ))
            },
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_OK);
        assert!(String::from_utf8(stdout)
            .unwrap()
            .contains(r#""comparisonIgnoredPaths":["/resourceSources"]"#));
        assert!(stderr.is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn arguments_help_io_and_size_errors_use_documented_codes() {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        assert_eq!(
            run(
                vec!["--".into(), "--help".into()],
                &mut stdout,
                &mut stderr,
                1024,
                fake_replay(true),
                fake_prepare(b"{}\n"),
                fake_fixture_inspect(true)
            ),
            EXIT_OK
        );
        assert!(String::from_utf8(stdout).unwrap().contains("Usage:"));

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        assert_eq!(
            run(
                Vec::new(),
                &mut stdout,
                &mut stderr,
                1024,
                fake_replay(true),
                fake_prepare(b"{}\n"),
                fake_fixture_inspect(true)
            ),
            EXIT_ERROR
        );

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        assert_eq!(
            run(
                vec![env::temp_dir()
                    .join("missing_ambit_bundle.json")
                    .into_os_string()],
                &mut stdout,
                &mut stderr,
                1024,
                fake_replay(true),
                fake_prepare(b"{}\n"),
                fake_fixture_inspect(true)
            ),
            EXIT_ERROR
        );

        let path = temp_file("oversized", b"1234");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        assert_eq!(
            run(
                vec![path.clone().into_os_string()],
                &mut stdout,
                &mut stderr,
                3,
                fake_replay(true),
                fake_prepare(b"{}\n"),
                fake_fixture_inspect(true)
            ),
            EXIT_ERROR
        );
        assert!(String::from_utf8(stderr).unwrap().contains("size limit"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn replay_errors_do_not_echo_raw_file_contents() {
        let path = temp_file("private_error", b"DO_NOT_ECHO_PRIVATE_BODY");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![path.clone().into_os_string()],
            &mut stdout,
            &mut stderr,
            1024,
            |_, _| Err("invalid bundle".to_string()),
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_ERROR);
        assert!(!String::from_utf8(stdout)
            .unwrap()
            .contains("DO_NOT_ECHO_PRIVATE_BODY"));
        assert!(!String::from_utf8(stderr)
            .unwrap()
            .contains("DO_NOT_ECHO_PRIVATE_BODY"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn prepare_mode_requires_acknowledgement_and_valid_arguments() {
        assert_eq!(
            parse_args(vec![
                "--prepare-fixture".into(),
                "--summary".into(),
                "--acknowledge-sensitive-data".into(),
                "bundle.json".into(),
                "candidate.chunks.json".into(),
            ])
            .unwrap_err(),
            "--summary cannot be combined with --prepare-fixture"
        );
        assert_eq!(
            parse_args(vec![
                "--prepare-fixture".into(),
                "bundle.json".into(),
                "candidate.chunks.json".into(),
            ])
            .unwrap_err(),
            "--prepare-fixture requires --acknowledge-sensitive-data"
        );
        assert_eq!(
            parse_args(vec![
                "--prepare-fixture".into(),
                "--acknowledge-sensitive-data".into(),
                "--verify".into(),
                "bundle.json".into(),
                "candidate.chunks.json".into(),
            ])
            .unwrap_err(),
            "--verify cannot be combined with --prepare-fixture"
        );
        assert_eq!(
            parse_args(vec![
                "--prepare-fixture".into(),
                "--acknowledge-sensitive-data".into(),
                "bundle.json".into(),
                "candidate.json".into(),
            ])
            .unwrap_err(),
            "fixture output must end with .chunks.json"
        );
    }

    #[test]
    fn prepare_mode_writes_private_candidate_without_echoing_contents() {
        let input = temp_file("prepare_input", b"PRIVATE_RAW_INPUT");
        let output = env::temp_dir().join(format!(
            "ambit_comfy_support_candidate_{}_{}.chunks.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let candidate = br#"{"prompt":"PRIVATE_CANDIDATE_BODY"}
"#;
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![
                "--prepare-fixture".into(),
                input.clone().into_os_string(),
                output.clone().into_os_string(),
                "--acknowledge-sensitive-data".into(),
            ],
            &mut stdout,
            &mut stderr,
            1024,
            fake_replay(true),
            fake_prepare(candidate),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_OK);
        assert_eq!(fs::read(&output).unwrap(), candidate);
        assert!(!String::from_utf8(stdout)
            .unwrap()
            .contains("PRIVATE_CANDIDATE_BODY"));
        assert!(stderr.is_empty());
        let _ = fs::remove_file(input);
        let _ = fs::remove_file(output);
    }

    #[test]
    fn prepare_mode_refuses_overwrite_and_cleans_partial_writes() {
        let output = temp_file("existing.chunks", b"KEEP_EXISTING");
        assert_eq!(
            write_candidate(&output, b"REPLACEMENT").unwrap_err(),
            "fixture output already exists or cannot be created"
        );
        assert_eq!(fs::read(&output).unwrap(), b"KEEP_EXISTING");
        let _ = fs::remove_file(output);

        let partial = env::temp_dir().join(format!(
            "ambit_comfy_support_partial_{}_{}.chunks.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let error = write_candidate_with(&partial, b"FULL", |file, _| {
            file.write_all(b"PARTIAL")?;
            Err(std::io::Error::other("simulated failure"))
        })
        .unwrap_err();
        assert_eq!(error, "failed to write fixture candidate");
        assert!(!partial.exists());
    }

    #[test]
    fn fixture_inspection_arguments_require_a_candidate_and_comparison_for_verify() {
        assert!(matches!(
            parse_args(vec![
                "--inspect-fixture".into(),
                "candidate.chunks.json".into(),
            ])
            .unwrap(),
            ParsedArgs::InspectFixture {
                compare_support: None,
                verify: false,
                ..
            }
        ));
        assert_eq!(
            parse_args(vec![
                "--inspect-fixture".into(),
                "candidate.chunks.json".into(),
                "--verify".into(),
            ])
            .unwrap_err(),
            "fixture --verify requires --compare-support"
        );
        assert_eq!(
            parse_args(vec![
                "--inspect-fixture".into(),
                "--summary".into(),
                "candidate.chunks.json".into(),
            ])
            .unwrap_err(),
            "--summary cannot be combined with --inspect-fixture"
        );
        assert_eq!(
            parse_args(vec!["--inspect-fixture".into(), "candidate.json".into()]).unwrap_err(),
            "fixture candidate must end with .chunks.json"
        );
        assert_eq!(
            parse_args(vec![
                "--compare-support".into(),
                "bundle.json".into(),
                "candidate.chunks.json".into(),
            ])
            .unwrap_err(),
            "--compare-support requires --inspect-fixture"
        );
        assert_eq!(
            parse_args(vec![
                "bundle.json".into(),
                "--summary".into(),
                "--summary".into(),
            ])
            .unwrap_err(),
            "--summary may only be supplied once"
        );
        assert!(matches!(
            parse_args(vec![
                "--inspect-fixture".into(),
                "candidate.chunks.json".into(),
                "--compare-support".into(),
                "bundle.json".into(),
                "--verify".into(),
            ])
            .unwrap(),
            ParsedArgs::InspectFixture {
                compare_support: Some(_),
                verify: true,
                ..
            }
        ));
    }

    #[test]
    fn fixture_inspection_reports_candidate_without_writing_or_echoing_raw_input() {
        let candidate = temp_chunks_file("inspect", b"PRIVATE_RAW_CANDIDATE");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![
                "--inspect-fixture".into(),
                candidate.clone().into_os_string(),
            ],
            &mut stdout,
            &mut stderr,
            1024,
            fake_replay(true),
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(true),
        );

        assert_eq!(code, EXIT_OK);
        let stdout = String::from_utf8(stdout).unwrap();
        assert!(stdout.contains(r#""candidateOutputMatchesSupport":true"#));
        assert!(!stdout.contains("PRIVATE_RAW_CANDIDATE"));
        assert!(stderr.is_empty());
        let _ = fs::remove_file(candidate);
    }

    #[test]
    fn fixture_verify_uses_exit_two_for_support_drift() {
        let candidate = temp_chunks_file("verify", b"PRIVATE_CANDIDATE");
        let support = temp_file("fixture_support", b"PRIVATE_SUPPORT");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![
                "--inspect-fixture".into(),
                candidate.clone().into_os_string(),
                "--compare-support".into(),
                support.clone().into_os_string(),
                "--verify".into(),
            ],
            &mut stdout,
            &mut stderr,
            1024,
            fake_replay(true),
            fake_prepare(b"{}\n"),
            fake_fixture_inspect(false),
        );

        assert_eq!(code, EXIT_MISMATCH);
        assert!(String::from_utf8(stderr)
            .unwrap()
            .contains("fixture candidate output does not match"));
        let stdout = String::from_utf8(stdout).unwrap();
        assert!(!stdout.contains("PRIVATE_CANDIDATE"));
        assert!(!stdout.contains("PRIVATE_SUPPORT"));
        let _ = fs::remove_file(candidate);
        let _ = fs::remove_file(support);
    }
}
