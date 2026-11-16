/// The only identifiers a `perf-harness` build may carry: disposable ones under `com.ambit.p378.`.
/// Anything else (the production id above all) fails the build, so harness-only behavior cannot
/// ship under, or touch the data of, the production app.
fn is_disposable_perf_identifier(identifier: &str) -> bool {
    const PREFIX: &str = "com.ambit.p378.";
    identifier.strip_prefix(PREFIX).is_some_and(|label| {
        !label.is_empty()
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    })
}

fn main() {
    println!("cargo:rustc-check-cfg=cfg(mobile)");
    println!("cargo:rerun-if-env-changed=AMBIT_PERF_HARNESS_ID");

    if std::env::var_os("CARGO_FEATURE_PERF_HARNESS").is_some() {
        let identifier = std::env::var("AMBIT_PERF_HARNESS_ID").unwrap_or_default();
        assert!(
            is_disposable_perf_identifier(&identifier),
            "the perf-harness feature needs AMBIT_PERF_HARNESS_ID set to a disposable \
             com.ambit.p378.<label> identifier (lowercase letters, digits, hyphens), got {identifier:?}"
        );
    }

    if std::env::var("SKIP_TAURI_BUILD").is_err() {
        tauri_build::build()
    } else {
        println!("cargo:rerun-if-env-changed=SKIP_TAURI_BUILD");
        println!("cargo:warning=Skipping tauri_build::build() because SKIP_TAURI_BUILD is set");
    }
}
