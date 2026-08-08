use std::env;
use std::ffi::OsString;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const EXIT_OK: u8 = 0;
const EXIT_ERROR: u8 = 1;
const EXIT_MISMATCH: u8 = 2;

enum ParsedArgs {
    Help,
    Inspect { path: PathBuf, verify: bool },
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
    );
    ExitCode::from(code)
}

fn run<F>(
    args: Vec<OsString>,
    stdout: &mut impl Write,
    stderr: &mut impl Write,
    max_bytes: usize,
    replay: F,
) -> u8
where
    F: Fn(&[u8]) -> Result<(String, bool), String>,
{
    let parsed = match parse_args(args) {
        Ok(parsed) => parsed,
        Err(error) => {
            let _ = writeln!(stderr, "error: {error}");
            let _ = writeln!(stderr, "{}", usage());
            return EXIT_ERROR;
        }
    };

    let ParsedArgs::Inspect { path, verify } = parsed else {
        let _ = writeln!(stdout, "{}", usage());
        return EXIT_OK;
    };

    let input = match read_bounded(&path, max_bytes) {
        Ok(input) => input,
        Err(error) => {
            let _ = writeln!(stderr, "error: {error}");
            return EXIT_ERROR;
        }
    };
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

    EXIT_OK
}

fn parse_args(args: Vec<OsString>) -> Result<ParsedArgs, String> {
    let mut path = None;
    let mut verify = false;

    for arg in args {
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
        if arg
            .to_str()
            .map(|value| value.starts_with('-'))
            .unwrap_or(false)
        {
            return Err("unknown option".to_string());
        }
        if path.replace(PathBuf::from(arg)).is_some() {
            return Err("exactly one support bundle path is required".to_string());
        }
    }

    let path = path.ok_or_else(|| "a support bundle path is required".to_string())?;
    Ok(ParsedArgs::Inspect { path, verify })
}

fn read_bounded(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    let metadata = path
        .metadata()
        .map_err(|_| "unable to read support bundle metadata".to_string())?;
    if metadata.len() > max_bytes as u64 {
        return Err(size_limit_message(max_bytes));
    }

    let file = File::open(path).map_err(|_| "unable to open support bundle".to_string())?;
    let mut input = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut input)
        .map_err(|_| "unable to read support bundle".to_string())?;
    if input.len() > max_bytes {
        return Err(size_limit_message(max_bytes));
    }

    Ok(input)
}

fn size_limit_message(max_bytes: usize) -> String {
    format!(
        "support bundle exceeds the {} MiB size limit",
        max_bytes / (1024 * 1024)
    )
}

fn usage() -> &'static str {
    "Usage: pnpm run inspect:comfyui-support -- <bundle-path> [--verify]"
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

    fn fake_replay(matches: bool) -> impl Fn(&[u8]) -> Result<(String, bool), String> {
        move |_| Ok((format!(r#"{{"parserOutputMatches":{matches}}}"#), matches))
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
            fake_replay(false),
        );

        assert_eq!(code, EXIT_OK);
        assert!(String::from_utf8(stdout)
            .unwrap()
            .contains(r#""parserOutputMatches":false"#));
        assert!(stderr.is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn verify_mode_uses_exit_two_for_drift() {
        let path = temp_file("verify_mismatch", b"{}");
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();

        let code = run(
            vec![path.clone().into_os_string(), "--verify".into()],
            &mut stdout,
            &mut stderr,
            1024,
            fake_replay(false),
        );

        assert_eq!(code, EXIT_MISMATCH);
        assert!(String::from_utf8(stdout)
            .unwrap()
            .contains(r#""parserOutputMatches":false"#));
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
            fake_replay(true),
        );

        assert_eq!(code, EXIT_OK);
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
                fake_replay(true)
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
                fake_replay(true)
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
                fake_replay(true)
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
                fake_replay(true)
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
}
