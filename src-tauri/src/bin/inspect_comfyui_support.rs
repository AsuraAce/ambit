use std::env;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const EXIT_OK: u8 = 0;
const EXIT_ERROR: u8 = 1;
const EXIT_MISMATCH: u8 = 2;

#[derive(Debug)]
enum ParsedArgs {
    Help,
    Inspect {
        path: PathBuf,
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
        app_lib::replay_comfyui_support_bundle,
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
    F: Fn(&[u8]) -> Result<(String, bool), String>,
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
        ParsedArgs::Inspect { path, verify } => (path, RunMode::Inspect { verify }),
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
        RunMode::Inspect { verify } => {
            let (report, matches) = match replay(&input) {
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
    },
    Prepare {
        output: PathBuf,
    },
    InspectFixture {
        compare_support: Option<PathBuf>,
        verify: bool,
    },
}

fn parse_args(args: Vec<OsString>) -> Result<ParsedArgs, String> {
    let mut paths = Vec::new();
    let mut verify = false;
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
    if prepare {
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
    })
}

fn has_chunks_json_suffix(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".chunks.json"))
        .unwrap_or(false)
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
    "Usage:\n  pnpm run inspect:comfyui-support -- <bundle-path> [--verify]\n  pnpm run prepare:comfyui-fixture -- <bundle-path> <output.chunks.json> --acknowledge-sensitive-data\n  pnpm run inspect:comfyui-fixture -- <candidate.chunks.json> [--compare-support <bundle-path>] [--verify]"
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

    fn fake_replay(matches: bool) -> impl Fn(&[u8]) -> Result<(String, bool), String> {
        move |_| Ok((format!(r#"{{"parserOutputMatches":{matches}}}"#), matches))
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
            |_| {
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
    fn verify_mode_uses_exit_two_for_diagnostics_only_drift() {
        let path = temp_file("verify_mismatch", b"{}");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![path.clone().into_os_string(), "--verify".into()],
            &mut stdout,
            &mut stderr,
            1024,
            |_| {
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
            |_| {
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
            |_| Err("invalid bundle".to_string()),
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
