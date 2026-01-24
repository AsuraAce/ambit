mod metadata;
mod db;
mod scanner;
mod watcher;
mod thumb;


use watcher::WatcherState;
use metadata::models::ModelResolutionState;

/// Create the Specta builder with all commands registered.
/// This is shared between the app runtime and the export test.
#[cfg(not(test))]
pub fn create_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            // db commands
            db::commands::save_images_batch,
            db::commands::get_db_diagnostics,
            db::commands::refresh_boards_native,
            db::commands::get_image_count_for_path_prefix,

            db::commands::optimize_database,
            db::commands::purge_database,
            db::commands::get_parameter_ranges,
            db::commands::backfill_parameter_columns,
            db::facets::rebuild_facet_cache,
            db::facets::rebuild_facet_cache,
            db::facets::get_valid_facet_names,
            db::commands::mark_images_corrupt,
            db::commands::verify_thumbnail_files,

            // db backup commands
            db::backup::get_backups,
            db::backup::backup_database,
            db::backup::check_and_run_autobackup,

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
            scanner::scan_directory_with_stats,
            // watcher commands
            watcher::start_native_folder_watcher,
            // metadata commands
            metadata::models::import_a1111_cache,
            metadata::models::resolve_hashes_online,
            metadata::models::clear_model_cache,
            metadata::models::cancel_model_resolution,
            metadata::models::scan_model_thumbnails,
            metadata::models::set_model_thumbnail,
            metadata::models::unset_model_thumbnail,
            metadata::models::clear_all_thumbnails,
        ])
}

// Force Rebuild
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
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

    // Check for deferred purge request BEFORE initializing the database
    check_and_execute_deferred_purge();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:images.db", db::migrations::init_db()).build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(WatcherState::default())
        .manage(ModelResolutionState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            // Run auto-backup check in background
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait a bit for app to settle
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                match db::backup::check_and_run_autobackup(handle).await {
                    Ok(Some(info)) => log::info!("[Backup] Auto-backup created: {}", info.name),
                    Ok(None) => log::info!("[Backup] Auto-backup skipped (recent backup exists)"),
                    Err(e) => log::error!("[Backup] Auto-backup failed: {}", e),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Check for and execute any pending database purge request.
/// This runs BEFORE the SQL plugin initializes, so the DB file isn't locked yet.
fn check_and_execute_deferred_purge() {
    // We need to check both potential locations because Tauri might look in either
    // depending on system configuration and version.
    let mut paths_to_check = Vec::new();
    
    if let Some(config_dir) = dirs::config_dir() {
        paths_to_check.push(config_dir.join("com.ambit.app"));
        paths_to_check.push(config_dir.join("com.ambit.dev"));
        paths_to_check.push(config_dir.join("com.ambit.alpha"));
        paths_to_check.push(config_dir.join("com.tauri.dev"));
    }
    if let Some(data_local_dir) = dirs::data_local_dir() {
        paths_to_check.push(data_local_dir.join("com.ambit.app"));
        paths_to_check.push(data_local_dir.join("com.ambit.dev"));
        paths_to_check.push(data_local_dir.join("com.ambit.alpha"));
        paths_to_check.push(data_local_dir.join("com.tauri.dev"));
    }
    
    for app_dir in paths_to_check {
        let marker_path = app_dir.join(".purge_on_restart");

        if marker_path.exists() {
            println!("[Purge] Found purge marker at {:?}! Proceeding to delete database...", marker_path);
            
            // Delete the marker first
            let _ = std::fs::remove_file(&marker_path);
            
            // Delete database files
            let db_path = app_dir.join("images.db");
            let wal_path = app_dir.join("images.db-wal");
            let shm_path = app_dir.join("images.db-shm");
            
            if db_path.exists() {
                match std::fs::remove_file(&db_path) {
                    Ok(_) => println!("[Purge] SUCCESS: Database deleted. Fresh DB will be created."),
                    Err(e) => eprintln!("[Purge] FAILED to delete database: {}", e),
                }
            }
            
            if wal_path.exists() { let _ = std::fs::remove_file(&wal_path); }
            if shm_path.exists() { let _ = std::fs::remove_file(&shm_path); }
        }
    }
}

#[cfg(all(test, not(test)))] // Disabled during standard tests to avoid linking Tauri
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
