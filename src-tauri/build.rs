fn main() {
    if std::env::var("SKIP_TAURI_BUILD").is_err() {
        tauri_build::build()
    } else {
        println!("cargo:rerun-if-env-changed=SKIP_TAURI_BUILD");
        println!("cargo:warning=Skipping tauri_build::build() because SKIP_TAURI_BUILD is set");
    }
}
