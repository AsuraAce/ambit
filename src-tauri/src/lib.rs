mod metadata;
mod db;
mod scanner;
mod watcher;

use watcher::WatcherState;
use metadata::models::ModelResolutionState;

/// Create the Specta builder with all commands registered.
/// This is shared between the app runtime and the export test.
pub fn create_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            // db commands
            db::commands::save_images_batch,
            db::commands::get_db_diagnostics,
            db::commands::refresh_boards_native,
            db::commands::reset_migration_18,
            db::commands::optimize_database,
            db::facets::rebuild_facet_cache,
            // scanner commands
            scanner::scan_image,
            scanner::scan_images_bulk,
            scanner::scan_image_workflow,
            scanner::read_image_metadata,
            scanner::get_file_sizes_bulk,
            scanner::verify_image_paths,
            scanner::audit_invokeai_folder,
            scanner::list_invokeai_images,
            scanner::scan_directory_recursive,
            scanner::open_file,
            scanner::show_in_folder,
            // watcher commands
            watcher::start_native_folder_watcher,
            // metadata commands
            metadata::models::import_a1111_cache,
            metadata::models::resolve_hashes_online,
            metadata::models::clear_model_cache,
            metadata::models::cancel_model_resolution,
            metadata::models::scan_model_thumbnails,
        ])
}

// Force Rebuild
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = create_builder();

    // Export generated bindings on every dev run
    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number),
            "../src/bindings.ts",
        )
        .expect("Failed to export TypeScript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:images.db", db::migrations::init_db()).build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(WatcherState::default())
        .manage(ModelResolutionState::default())
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_bindings() {
        let builder = create_builder();
        builder
            .export(
                specta_typescript::Typescript::default()
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                "../src/bindings.ts",
            )
            .expect("Failed to export TypeScript bindings");
    }
}
