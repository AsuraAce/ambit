mod app_data_migration;
mod db;
mod fs_commands;
mod metadata;
mod scanner;
mod security;
mod thumb;
mod watcher;

#[cfg(not(test))]
use db::commands::maintenance::FileHashBackfillState;
#[cfg(not(test))]
use db::reparse::ReparseState;
#[cfg(not(test))]
use metadata::models::{ModelDiscoveryState, ModelResolutionState};
#[cfg(not(test))]
use watcher::WatcherState;

/// Create the Specta builder with all commands registered.
/// This is shared between the app runtime and the export test.
#[cfg(not(test))]
pub fn create_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        // security commands
        security::save_api_key,
        security::load_api_key,
        security::delete_api_key,
        // db commands
        db::commands::image_commands::save_images_batch,
        db::commands::image_commands::move_image_path_identities,
        db::commands::maintenance::get_db_diagnostics,
        db::commands::maintenance::backfill_image_file_hashes,
        db::commands::maintenance::cancel_image_file_hash_backfill,
        db::commands::image_commands::refresh_boards_native,
        db::commands::image_commands::get_image_count_for_path_prefix,
        db::commands::image_commands::refresh_privacy_mask_index,
        db::commands::maintenance::optimize_database,
        db::commands::maintenance::purge_database,
        db::commands::filter_commands::get_parameter_ranges,
        db::commands::filter_commands::backfill_parameter_columns,
        db::facets::rebuild_facet_cache,
        db::facets::rebuild_facet_cache_incremental,
        db::facets::rebuild_facet_cache_incremental_batch,
        db::facets::refresh_facet_cache_for_resources,
        db::facets::get_valid_facet_names,
        db::commands::image_commands::mark_images_corrupt,
        db::commands::image_commands::verify_library_integrity,
        // db reparse commands
        db::reparse::start_reparse_job,
        db::reparse::cancel_reparse_job,
        db::commands::reparse_commands::get_images_needing_reparse,
        db::commands::reparse_commands::get_reparse_count,
        db::commands::reparse_commands::reparse_metadata_batch,
        db::commands::reparse_commands::reset_parser_versions,
        db::commands::filter_commands::get_metadata_stats,
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
        scanner::scan_directory_since,
        scanner::a1111::discover_a1111_folders,
        thumb::optimizer::start_thumbnail_optimization_job,
        thumb::optimizer::cancel_thumbnail_optimization_job,
        thumb::optimizer::set_thumbnail_optimization_throttled,
        thumb::optimizer::get_thumbnail_optimization_failures,
        thumb::optimizer::retry_failed_thumbnail_optimizations,
        // watcher commands
        watcher::start_native_folder_watcher,
        // metadata commands
        metadata::civitai::import_a1111_cache,
        metadata::civitai::resolve_hashes_online,
        metadata::models::clear_model_cache,
        metadata::models::cancel_model_resolution,
        metadata::models::cancel_model_discovery,
        metadata::thumbs_scan::scan_model_thumbnails,
        metadata::models::set_model_thumbnail,
        metadata::models::unset_model_thumbnail,
        metadata::models::clear_all_thumbnails,
        metadata::models::set_resource_thumbnail_sensitivity,
        // fs commands
        fs_commands::move_to_trash,
        fs_commands::delete_thumbnail,
        fs_commands::register_library_path,
        fs_commands::get_invoke_db_snapshot,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    let builder = create_builder();

    // Move legacy production app-data before the SQL plugin resolves images.db.
    if !cfg!(debug_assertions) {
        app_data_migration::migrate_legacy_identifier_data();
    }

    // Check for deferred purge request BEFORE initializing the database.
    check_and_execute_deferred_purge();
    repair_known_migration_metadata();

    let log_level = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info".to_string())
        .parse()
        .unwrap_or(log::LevelFilter::Info);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log_level)
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:images.db", db::migrations::init_db())
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(WatcherState::default())
        .manage(ModelResolutionState::default())
        .manage(ModelDiscoveryState::default())
        .manage(ReparseState::default())
        .manage(FileHashBackfillState::default())
        .manage(thumb::optimizer::ThumbnailOptimizationState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // 1. Initialize DB settings (WAL mode, etc.)
            let handle_for_db = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = db::init_db_connection(&handle_for_db) {
                    log::error!("[DB] Failed to initialize database settings: {}", e);
                } else {
                    log::info!("[DB] Database initialized and optimized (WAL=ON)");
                }
            });

            // 2. Run auto-backup check in background for production builds only,
            // after startup has settled. Large production libraries can spend
            // the first minute catching up sync state and warming query caches;
            // VACUUM INTO during that window competes for SQLite I/O.
            if cfg!(debug_assertions) {
                log::info!("[Backup] Auto-backup skipped in development build");
            } else {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(120)).await;
                    match db::backup::check_and_run_autobackup(handle).await {
                        Ok(Some(info)) => log::info!("[Backup] Auto-backup created: {}", info.name),
                        Ok(None) => {
                            log::info!("[Backup] Auto-backup skipped (recent backup exists)")
                        }
                        Err(e) => log::error!("[Backup] Auto-backup failed: {}", e),
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Err(e) = db::optimize_on_shutdown(app_handle) {
                    log::error!("[DB] Failed to run shutdown optimization: {}", e);
                }
            }
        });
}

/// Check for and execute any pending database purge request.
/// This runs BEFORE the SQL plugin initializes, so the DB file isn't locked yet.
#[cfg(not(test))]
fn check_and_execute_deferred_purge() {
    // Check current and transitional identifiers in both Roaming and Local AppData.
    for app_dir in app_data_migration::app_identifier_dirs_to_check() {
        let marker_path = app_dir.join(".purge_on_restart");

        if marker_path.exists() {
            println!(
                "[Purge] Found purge marker at {:?}! Proceeding to delete database...",
                marker_path
            );

            // Delete the marker first
            let _ = std::fs::remove_file(&marker_path);

            // Delete database files with retry loop for Windows file locking
            let db_path = app_dir.join("images.db");
            let wal_path = app_dir.join("images.db-wal");
            let shm_path = app_dir.join("images.db-shm");

            if db_path.exists() {
                let mut attempts = 0;
                let max_attempts = 5;
                let mut success = false;

                while attempts < max_attempts && !success {
                    match std::fs::remove_file(&db_path) {
                        Ok(_) => {
                            println!(
                                "[Purge] SUCCESS: Database deleted. Fresh DB will be created."
                            );
                            success = true;
                        }
                        Err(e) => {
                            attempts += 1;
                            eprintln!(
                                "[Purge] Attempt {}/{} failed to delete database: {}",
                                attempts, max_attempts, e
                            );
                            if attempts < max_attempts {
                                std::thread::sleep(std::time::Duration::from_millis(500));
                            }
                        }
                    }
                }

                if !success {
                    eprintln!("[Purge] FATAL: Could not delete database after {} attempts. Manual intervention may be required.", max_attempts);
                }
            }

            // Best effort cleanup for WAL/SHM files
            if wal_path.exists() {
                let _ = std::fs::remove_file(&wal_path);
            }
            if shm_path.exists() {
                let _ = std::fs::remove_file(&shm_path);
            }
        }
    }
}

/// Repair historical migration metadata for a known development/mainline collision.
///
/// Version 55 shipped as `add_manual_thumbnail_lookup_index` before this branch briefly
/// reused 55 for thumbnail optimization metadata. SQLx validates migration checksums before
/// applying new migrations, so databases with the already-applied manual lookup index must
/// keep version 55 mapped to that same semantic migration. This only updates the checksum
/// when the migration row and the index both prove that the manual lookup migration ran.
#[cfg(not(test))]
fn repair_known_migration_metadata() {
    use sha2::{Digest, Sha384};

    let migration55 = db::migrations::m55_manual_thumbnail_lookup_index::migration55();
    let expected_m55_checksum = Sha384::digest(migration55.sql.as_bytes()).to_vec();
    let migration56 = db::migrations::m56_thumbnail_optimization::migration56();
    let expected_m56_checksum = Sha384::digest(migration56.sql.as_bytes()).to_vec();

    for app_dir in app_data_migration::app_identifier_dirs_to_check() {
        let db_path = app_dir.join("images.db");
        if !db_path.exists() {
            continue;
        }

        let Ok(conn) = rusqlite::Connection::open(&db_path) else {
            continue;
        };

        let has_migrations_table = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name = '_sqlx_migrations'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);

        if has_migrations_table == 0 {
            continue;
        }

        let applied_55 = conn.query_row(
            "SELECT description, checksum
             FROM _sqlx_migrations
             WHERE version = 55",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)),
        );

        if let Ok((description, checksum)) = applied_55 {
            if description == "add_manual_thumbnail_lookup_index"
                && checksum != expected_m55_checksum
            {
                let has_manual_index = conn
                    .query_row(
                        "SELECT COUNT(*)
                         FROM sqlite_master
                         WHERE type = 'index'
                           AND name = 'idx_images_thumbnail_path_lookup_v1'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0);

                if has_manual_index > 0 {
                    match conn.execute(
                        "UPDATE _sqlx_migrations
                         SET checksum = ?1
                         WHERE version = 55
                           AND description = 'add_manual_thumbnail_lookup_index'",
                        rusqlite::params![&expected_m55_checksum],
                    ) {
                        Ok(updated) if updated > 0 => {
                            println!(
                                "[DB] Repaired checksum for migration 55 add_manual_thumbnail_lookup_index at {:?}",
                                db_path
                            );
                        }
                        Ok(_) => {}
                        Err(error) => {
                            eprintln!(
                                "[DB] Failed to repair migration 55 checksum at {:?}: {}",
                                db_path, error
                            );
                        }
                    }
                }
            }
        }

        let applied_56 = conn.query_row(
            "SELECT description, checksum
             FROM _sqlx_migrations
             WHERE version = 56",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)),
        );

        let Ok((description_56, checksum_56)) = applied_56 else {
            continue;
        };

        if description_56 != "add_thumbnail_optimization_queue_metadata"
            || checksum_56 == expected_m56_checksum
        {
            continue;
        }

        let required_columns = [
            "thumbnail_version",
            "thumbnail_failure_count",
            "thumbnail_last_error",
            "thumbnail_last_attempt_at",
        ];
        let has_thumbnail_columns = required_columns.iter().all(|column| {
            conn.query_row(
                "SELECT COUNT(*)
                 FROM pragma_table_info('images')
                 WHERE name = ?1",
                [*column],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
                > 0
        });

        if !has_thumbnail_columns {
            continue;
        }

        match conn.execute(
            "UPDATE _sqlx_migrations
             SET checksum = ?1
             WHERE version = 56
               AND description = 'add_thumbnail_optimization_queue_metadata'",
            rusqlite::params![&expected_m56_checksum],
        ) {
            Ok(updated) if updated > 0 => {
                println!(
                    "[DB] Repaired checksum for migration 56 add_thumbnail_optimization_queue_metadata at {:?}",
                    db_path
                );
            }
            Ok(_) => {}
            Err(error) => {
                eprintln!(
                    "[DB] Failed to repair migration 56 checksum at {:?}: {}",
                    db_path, error
                );
            }
        }
    }
}
