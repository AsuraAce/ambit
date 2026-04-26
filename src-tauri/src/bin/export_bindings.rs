use std::{env, fs, path::PathBuf};

fn main() {
    let output_path = env::args_os().nth(1).map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("src")
            .join("bindings.ts")
    });

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).expect("Failed to create bindings output directory");
    }

    app_lib::create_builder()
        .export(
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number),
            &output_path,
        )
        .expect("Failed to export TypeScript bindings");

    println!("Exported TypeScript bindings to {}", output_path.display());
}
