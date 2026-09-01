mod app_data_migration;
mod comfy_support_replay;
mod db;
mod fs_commands;
mod media;
mod metadata;
mod scanner;
mod security;
mod thumb;
mod watcher;

#[doc(hidden)]
pub use comfy_support_replay::{
    inspect_comfyui_fixture_candidate, prepare_comfyui_fixture_candidate,
    summarize_comfyui_support_bundle_replay, SUPPORT_REPLAY_SUMMARY_VERSION,
};
#[doc(hidden)]
pub use comfy_support_replay::{replay_comfyui_support_bundle, COMFY_SUPPORT_BUNDLE_MAX_BYTES};

#[cfg(not(test))]
use db::commands::maintenance::FileHashBackfillState;
#[cfg(not(test))]
use db::reparse::ReparseState;
#[cfg(not(test))]
use media::VideoImportState;
#[cfg(not(test))]
use metadata::models::{ModelDiscoveryState, ModelResolutionState};
#[cfg(not(test))]
use tauri::Manager;
#[cfg(not(test))]
use watcher::WatcherState;

/// Create the Specta builder with all commands registered.
/// This is shared between the app runtime and the export test.
#[cfg(not(test))]
pub fn create_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            // security commands
            security::save_api_key,
            security::load_api_key,
            security::delete_api_key,
            // db commands
            db::commands::image_commands::save_images_batch,
            db::commands::image_commands::reconcile_invoke_owner_inventory,
            db::commands::image_commands::reconcile_invoke_image_sources,
            db::commands::image_commands::replace_invoke_image_references,
            db::commands::image_commands::move_image_path_identities,
            db::commands::image_commands::mark_image_path_identities_missing,
            db::commands::maintenance::get_main_database_url,
            db::commands::maintenance::get_db_diagnostics,
            db::commands::maintenance::show_app_log_folder,
            db::commands::maintenance::resolve_exact_duplicate_groups,
            db::commands::maintenance::remove_images_from_library,
            db::commands::maintenance::restore_removed_images,
            db::commands::maintenance::mutate_collection_membership,
            db::commands::maintenance::update_invoke_collection_ownership,
            db::commands::maintenance::migrate_legacy_collections,
            db::commands::maintenance::update_ambit_collection_scope,
            db::commands::maintenance::set_collection_custom_thumbnail,
            db::commands::maintenance::backfill_image_file_hashes,
            db::commands::maintenance::cancel_image_file_hash_backfill,
            db::commands::image_commands::refresh_boards_native,
            db::commands::image_commands::get_image_count_for_path_prefix,
            db::commands::image_commands::refresh_privacy_mask_index,
            db::commands::image_commands::refresh_invoke_owner_scope,
            db::commands::image_commands::set_invoke_board_verification,
            db::commands::image_commands::begin_active_invoke_scope_cache_build,
            db::commands::image_commands::abort_active_invoke_scope_cache_build,
            db::commands::image_commands::commit_active_invoke_scope_cache,
            db::commands::image_commands::reconcile_invoke_board_snapshot,
            db::commands::maintenance::optimize_database,
            db::commands::maintenance::schedule_purge_transaction,
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
            scanner::probe_file_metadata_bulk,
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
            metadata::comfyui::inspect_comfyui_metadata_chunks,
            metadata::comfyui::workflow_inspector::inspect_comfyui_workflow_graph,
            metadata::models::clear_model_cache,
            metadata::models::cancel_model_resolution,
            metadata::models::cancel_model_discovery,
            metadata::thumbs_scan::scan_model_thumbnails,
            metadata::thumbs_scan::purge_resource_folder_assets,
            metadata::models::set_model_thumbnail,
            metadata::models::unset_model_thumbnail,
            metadata::models::clear_all_thumbnails,
            metadata::models::set_resource_thumbnail_sensitivity,
            // video media commands
            media::import_video_asset,
            media::refresh_video_metadata,
            media::cancel_video_import,
            media::store_video_poster,
            media::prepare_video_playback,
            media::export_asset_original,
            // fs commands
            fs_commands::move_to_trash,
            fs_commands::delete_removed_images_from_disk,
            fs_commands::delete_thumbnail,
            fs_commands::register_library_path,
            fs_commands::get_invoke_db_snapshot,
        ])
        .events(tauri_specta::collect_events![watcher::FolderChangeEvent])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    let builder = create_builder();
    let context = tauri::generate_context!();
    let active_identifier = context.config().identifier.clone();

    // Move legacy production app-data before the SQL plugin resolves images.db.
    if !cfg!(debug_assertions) {
        app_data_migration::migrate_legacy_identifier_data();
    }

    // Check for deferred purge request BEFORE initializing the database.
    if let Err(error) = app_data_migration::check_and_execute_deferred_purge(&active_identifier) {
        eprintln!("[Purge] {error}");
        return;
    }

    // Move the production SQLite catalog from Roaming AppData to Local AppData
    // before tauri-plugin-sql can open images.db.
    if cfg!(all(windows, not(debug_assertions))) {
        app_data_migration::migrate_current_database_to_local_app_data();
    }

    if let Err(error) = repair_known_migration_metadata(&active_identifier) {
        eprintln!("[DB] {error}");
        return;
    }

    let sql_builder = db::main_database_migration_urls()
        .into_iter()
        .fold(tauri_plugin_sql::Builder::default(), |builder, db_url| {
            builder.add_migrations(&db_url, db::migrations::init_db())
        });

    let log_level = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "info".to_string())
        .parse()
        .unwrap_or(log::LevelFilter::Info);

    let mut app_builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // Development and installed builds have different identifiers, so this
        // blocks only another process that could mutate the same profile.
        app_builder = app_builder.plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ));
    }

    app_builder
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log_level)
                .build(),
        )
        .plugin(sql_builder.build())
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
        .manage(VideoImportState::new())
        .manage(thumb::optimizer::ThumbnailOptimizationState::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
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
        .build(context)
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Err(e) = db::optimize_on_shutdown(app_handle) {
                    log::error!("[DB] Failed to run shutdown optimization: {}", e);
                }
            }
        });
}

#[cfg(test)]
mod startup_order_tests {
    #[test]
    fn same_profile_process_guard_is_registered_before_sql() {
        let source = include_str!("lib.rs");
        let single_instance = source
            .find("tauri_plugin_single_instance::init")
            .expect("same-profile process guard should be registered");
        let sql = source
            .find(".plugin(sql_builder.build())")
            .expect("SQL plugin should be registered");

        assert!(
            single_instance < sql,
            "same-profile process exclusion must be active before SQLite opens"
        );
    }

    #[test]
    fn typed_events_are_mounted_during_setup() {
        let source = include_str!("lib.rs");
        assert!(
            source.contains("builder.mount_events(app);"),
            "typed Tauri events must be mounted before background emitters start"
        );
    }
}

#[cfg(test)]
mod migration_history_tests {
    use super::{
        relocate_development_invoke_migration_history, repair_known_migration_metadata_at_paths,
    };
    use sha2::{Digest, Sha384};

    fn create_migration_table(conn: &rusqlite::Connection) {
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            );",
        )
        .expect("migration table");
    }

    fn old_invoke_specs() -> Vec<(i64, &'static str, Vec<u8>)> {
        let migrations = [
            crate::db::migrations::m69_invoke_scope_cache::migration69(),
            crate::db::migrations::m70_invoke_scoped_views::migration70(),
            crate::db::migrations::m71_invoke_scope_dirty_items::migration71(),
            crate::db::migrations::m72_invoke_scope_dirty_conflicts::migration72(),
            crate::db::migrations::m73_ambit_collection_scope::migration73(),
            crate::db::migrations::m74_invoke_scope_literal_prefix::migration74(),
        ];
        let descriptions = [
            "add_invoke_scope_derived_cache",
            "add_invoke_logical_scoped_views",
            "add_invoke_scope_selective_dirty_items",
            "fix_invoke_scope_dirty_item_upsert_conflicts",
            "scope_ambit_collections_by_invoke_owner",
            "repair_invoke_scope_literal_prefixes",
        ];
        migrations
            .iter()
            .enumerate()
            .map(|(index, migration)| {
                (
                    68 + index as i64,
                    descriptions[index],
                    Sha384::digest(migration.sql.as_bytes()).to_vec(),
                )
            })
            .collect()
    }

    fn current_specs() -> Vec<(i64, &'static str, Vec<u8>)> {
        let video = crate::db::migrations::m68_video_library_assets::migration68();
        let mut specs = vec![(
            68,
            "add_video_library_assets",
            Sha384::digest(video.sql.as_bytes()).to_vec(),
        )];
        specs.extend(
            old_invoke_specs()
                .into_iter()
                .map(|(old_version, description, checksum)| {
                    (old_version + 1, description, checksum)
                }),
        );
        specs
    }

    fn insert_row(
        conn: &rusqlite::Connection,
        version: i64,
        description: &str,
        success: i64,
        checksum: &[u8],
    ) {
        conn.execute(
            "INSERT INTO _sqlx_migrations
             (version, description, success, checksum, execution_time)
             VALUES (?1, ?2, ?3, ?4, 0)",
            rusqlite::params![version, description, success, checksum],
        )
        .expect("migration row");
    }

    fn migration_rows(conn: &rusqlite::Connection) -> Vec<(i64, String, i64, Vec<u8>)> {
        let mut statement = conn
            .prepare(
                "SELECT version, description, success, checksum
                 FROM _sqlx_migrations ORDER BY version",
            )
            .expect("migration query");
        statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .expect("migration rows")
            .collect::<Result<_, _>>()
            .expect("collect migration rows")
    }

    #[test]
    fn relocates_every_verified_old_invoke_prefix_without_changing_checksums() {
        let specs = old_invoke_specs();
        for prefix_len in 1..=specs.len() {
            let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
            create_migration_table(&conn);
            for (version, description, checksum) in specs.iter().take(prefix_len) {
                insert_row(&conn, *version, description, 1, checksum);
            }

            assert!(relocate_development_invoke_migration_history(&conn)
                .expect("verified prefix should relocate"));

            let rows: Vec<(i64, String, Vec<u8>)> = conn
                .prepare(
                    "SELECT version, description, checksum
                     FROM _sqlx_migrations ORDER BY version",
                )
                .expect("relocated query")
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .expect("relocated rows")
                .collect::<Result<_, _>>()
                .expect("collect relocated rows");
            assert_eq!(rows.len(), prefix_len);
            for (index, (version, description, checksum)) in rows.iter().enumerate() {
                assert_eq!(*version, 69 + index as i64);
                assert_eq!(description, specs[index].1);
                assert_eq!(checksum, &specs[index].2);
            }
        }
    }

    #[test]
    fn leaves_verified_current_history_unchanged() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
        create_migration_table(&conn);
        let specs = current_specs();
        for (version, description, checksum) in &specs {
            insert_row(&conn, *version, description, 1, checksum);
        }
        let before = migration_rows(&conn);

        assert!(!relocate_development_invoke_migration_history(&conn)
            .expect("current history should be a no-op"));
        assert_eq!(migration_rows(&conn), before);
    }

    #[test]
    fn leaves_verified_relocated_owner_prefix_unchanged() {
        let specs = old_invoke_specs();
        for prefix_len in 1..=specs.len() {
            let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
            create_migration_table(&conn);
            for (old_version, description, checksum) in specs.iter().take(prefix_len) {
                insert_row(&conn, old_version + 1, description, 1, checksum);
            }
            let before = migration_rows(&conn);

            assert!(!relocate_development_invoke_migration_history(&conn)
                .expect("relocated prefix should be a no-op"));
            assert_eq!(migration_rows(&conn), before);
        }
    }

    #[test]
    fn rejects_unverified_old_history_without_mutating_it() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
        create_migration_table(&conn);
        let specs = old_invoke_specs();
        insert_row(&conn, 68, specs[0].1, 1, &specs[0].2);
        insert_row(&conn, 70, specs[2].1, 1, &specs[2].2);

        let error = relocate_development_invoke_migration_history(&conn)
            .expect_err("a gap must fail closed");
        assert!(error.contains("verified old, current, or relocated InvokeAI prefix"));
        let versions: Vec<i64> = conn
            .prepare("SELECT version FROM _sqlx_migrations ORDER BY version")
            .expect("version query")
            .query_map([], |row| row.get(0))
            .expect("version rows")
            .collect::<Result<_, _>>()
            .expect("collect versions");
        assert_eq!(versions, vec![68, 70]);
    }

    #[test]
    fn rejects_mixed_unknown_failed_and_bad_checksum_histories_without_mutating_them() {
        let old_specs = old_invoke_specs();
        let current_specs = current_specs();
        let cases: Vec<Vec<(i64, String, i64, Vec<u8>)>> = vec![
            vec![
                (
                    current_specs[0].0,
                    current_specs[0].1.to_string(),
                    1,
                    current_specs[0].2.clone(),
                ),
                (69, old_specs[1].1.to_string(), 1, old_specs[1].2.clone()),
            ],
            vec![(69, "unknown_migration".to_string(), 1, vec![0; 48])],
            vec![(74, "unknown_migration".to_string(), 1, vec![0; 48])],
            vec![(68, "add_video_library_assets".to_string(), 1, vec![0; 48])],
            vec![(
                68,
                "add_invoke_scope_derived_cache".to_string(),
                0,
                old_specs[0].2.clone(),
            )],
        ];

        for rows in cases {
            let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
            create_migration_table(&conn);
            for (version, description, success, checksum) in rows {
                insert_row(&conn, version, &description, success, &checksum);
            }
            let before = migration_rows(&conn);

            assert!(relocate_development_invoke_migration_history(&conn).is_err());
            assert_eq!(migration_rows(&conn), before);
        }
    }

    #[test]
    fn relocated_history_allows_video_schema_upgrade_without_replaying_owner_migrations() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory database");
        for migration in crate::db::migrations::init_db()
            .into_iter()
            .filter(|migration| migration.version <= 67)
        {
            conn.execute_batch(migration.sql)
                .expect("apply baseline migration");
        }

        let old_owner_migrations = [
            crate::db::migrations::m69_invoke_scope_cache::migration69(),
            crate::db::migrations::m70_invoke_scoped_views::migration70(),
            crate::db::migrations::m71_invoke_scope_dirty_items::migration71(),
            crate::db::migrations::m72_invoke_scope_dirty_conflicts::migration72(),
            crate::db::migrations::m73_ambit_collection_scope::migration73(),
            crate::db::migrations::m74_invoke_scope_literal_prefix::migration74(),
        ];
        for migration in &old_owner_migrations {
            conn.execute_batch(migration.sql)
                .expect("apply old owner migration");
        }
        create_migration_table(&conn);
        for (version, description, checksum) in old_invoke_specs() {
            insert_row(&conn, version, description, 1, &checksum);
        }

        assert!(relocate_development_invoke_migration_history(&conn)
            .expect("old owner history should relocate"));
        conn.execute_batch(crate::db::migrations::m68_video_library_assets::migration68().sql)
            .expect("apply pending video migration");

        for table in ["images", "removed_images"] {
            for column in [
                "media_type",
                "duration_ms",
                "probe_status",
                "playback_status",
            ] {
                let present: i64 = conn
                    .query_row(
                        &format!(
                            "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"
                        ),
                        [column],
                        |row| row.get(0),
                    )
                    .expect("video column query");
                assert_eq!(
                    present, 1,
                    "{table}.{column} should be added by video migration"
                );
            }
        }
        for object in [
            "invoke_scope_cache_state",
            "scoped_images",
            "scoped_removed_images",
            "scoped_collections",
        ] {
            let present: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
                    [object],
                    |row| row.get(0),
                )
                .expect("owner object query");
            assert_eq!(present, 1, "{object} must remain after history relocation");
        }
    }
    fn profile_db_path(label: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "ambit-migration-profile-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("temporary profile directory");
        let db_path = root.join(crate::db::MAIN_DB_FILE_NAME);
        (root, db_path)
    }

    #[test]
    fn invalid_inactive_profile_does_not_block_valid_active_profile() {
        let (active_root, active_path) = profile_db_path("active-valid");
        let (inactive_root, inactive_path) = profile_db_path("inactive-invalid");
        let active = rusqlite::Connection::open(&active_path).expect("active database");
        create_migration_table(&active);
        drop(active);
        let inactive = rusqlite::Connection::open(&inactive_path).expect("inactive database");
        create_migration_table(&inactive);
        insert_row(&inactive, 74, "unknown_migration", 1, &[0; 48]);
        drop(inactive);

        let result = repair_known_migration_metadata_at_paths(
            &[active_path.clone(), inactive_path.clone()],
            &active_path,
        );
        let inactive = rusqlite::Connection::open(&inactive_path).expect("reopen inactive");
        let rows = migration_rows(&inactive);
        drop(inactive);
        std::fs::remove_dir_all(active_root).expect("remove active profile");
        std::fs::remove_dir_all(inactive_root).expect("remove inactive profile");

        result.expect("inactive migration damage must not block the active profile");
        assert_eq!(rows[0].0, 74, "inactive history must remain untouched");
    }

    #[test]
    fn invalid_active_profile_still_fails_closed() {
        let (active_root, active_path) = profile_db_path("active-invalid");
        let active = rusqlite::Connection::open(&active_path).expect("active database");
        create_migration_table(&active);
        insert_row(&active, 74, "unknown_migration", 1, &[0; 48]);
        drop(active);

        let result = repair_known_migration_metadata_at_paths(
            std::slice::from_ref(&active_path),
            &active_path,
        );
        let active = rusqlite::Connection::open(&active_path).expect("reopen active");
        let rows = migration_rows(&active);
        drop(active);
        std::fs::remove_dir_all(active_root).expect("remove active profile");

        let error = result.expect_err("invalid active history must block startup");
        assert!(error.contains("Failed to reconcile development InvokeAI migration history"));
        assert_eq!(
            rows[0].0, 74,
            "active invalid history must remain untouched"
        );
    }
}
fn relocate_development_invoke_migration_history(
    conn: &rusqlite::Connection,
) -> Result<bool, String> {
    use sha2::{Digest, Sha384};

    let owner_migrations = [
        db::migrations::m69_invoke_scope_cache::migration69(),
        db::migrations::m70_invoke_scoped_views::migration70(),
        db::migrations::m71_invoke_scope_dirty_items::migration71(),
        db::migrations::m72_invoke_scope_dirty_conflicts::migration72(),
        db::migrations::m73_ambit_collection_scope::migration73(),
        db::migrations::m74_invoke_scope_literal_prefix::migration74(),
    ];
    let old_descriptions = [
        "add_invoke_scope_derived_cache",
        "add_invoke_logical_scoped_views",
        "add_invoke_scope_selective_dirty_items",
        "fix_invoke_scope_dirty_item_upsert_conflicts",
        "scope_ambit_collections_by_invoke_owner",
        "repair_invoke_scope_literal_prefixes",
    ];
    let owner_checksums: Vec<Vec<u8>> = owner_migrations
        .iter()
        .map(|migration| Sha384::digest(migration.sql.as_bytes()).to_vec())
        .collect();
    let old_history: Vec<(i64, &str, Vec<u8>)> = old_descriptions
        .iter()
        .enumerate()
        .map(|(index, description)| {
            (
                68 + index as i64,
                *description,
                owner_checksums[index].clone(),
            )
        })
        .collect();
    let video_migration = db::migrations::m68_video_library_assets::migration68();
    let mut current_history = vec![(
        68,
        video_migration.description,
        Sha384::digest(video_migration.sql.as_bytes()).to_vec(),
    )];
    current_history.extend(
        old_history
            .iter()
            .map(|(version, description, checksum)| (version + 1, *description, checksum.clone())),
    );
    let relocated_owner_history: Vec<(i64, &str, Vec<u8>)> = old_history
        .iter()
        .map(|(version, description, checksum)| (version + 1, *description, checksum.clone()))
        .collect();

    let rows: Vec<(i64, String, i64, Vec<u8>)> = conn
        .prepare(
            "SELECT version, description, success, checksum
             FROM _sqlx_migrations
             WHERE version BETWEEN 68 AND 74
             ORDER BY version",
        )
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|error| error.to_string())?;

    if rows.is_empty() {
        return Ok(false);
    }

    let is_verified_prefix = |expected: &[(i64, &str, Vec<u8>)]| {
        rows.len() <= expected.len()
            && rows.iter().zip(expected).all(
                |(
                    (version, description, success, checksum),
                    (expected_version, expected_description, expected_checksum),
                )| {
                    *version == *expected_version
                        && description == expected_description
                        && *success == 1
                        && checksum == expected_checksum
                },
            )
    };

    if is_verified_prefix(&old_history) {
        // Continue below: old version 68 must move out of the way before SQLx
        // can apply mainline's video migration at version 68.
    } else if is_verified_prefix(&current_history) || is_verified_prefix(&relocated_owner_history) {
        return Ok(false);
    } else {
        return Err(
            "migration history in versions 68 through 74 is not a verified old, current, or relocated InvokeAI prefix"
                .to_string(),
        );
    }

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| error.to_string())?;
    let relocation = (|| -> Result<(), String> {
        for (index, (_, description, _, checksum)) in rows.iter().enumerate().rev() {
            let old_version = 68 + index as i64;
            let new_version = old_version + 1;
            let updated = conn
                .execute(
                    "UPDATE _sqlx_migrations
                     SET version = ?1
                     WHERE version = ?2
                       AND description = ?3
                       AND success = 1
                       AND checksum = ?4",
                    rusqlite::params![new_version, old_version, description, checksum],
                )
                .map_err(|error| error.to_string())?;
            if updated != 1 {
                return Err(format!(
                    "expected to relocate exactly one migration row from {old_version} to {new_version}"
                ));
            }
        }

        for (index, (_, description, _, checksum)) in rows.iter().enumerate() {
            let new_version = 69 + index as i64;
            let verified = conn
                .query_row(
                    "SELECT COUNT(*) FROM _sqlx_migrations
                     WHERE version = ?1
                       AND description = ?2
                       AND success = 1
                       AND checksum = ?3",
                    rusqlite::params![new_version, description, checksum],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?;
            if verified != 1 {
                return Err(format!("relocated migration {new_version} did not verify"));
            }
        }
        Ok(())
    })();

    match relocation {
        Ok(()) => {
            conn.execute_batch("COMMIT")
                .map_err(|error| error.to_string())?;
            Ok(true)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
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
fn repair_known_migration_metadata(active_identifier: &str) -> Result<(), String> {
    let active_db_path = startup_active_database_path(active_identifier);
    let mut db_paths: Vec<std::path::PathBuf> = app_data_migration::app_identifier_dirs_to_check()
        .into_iter()
        .map(|app_dir| app_dir.join(db::MAIN_DB_FILE_NAME))
        .collect();
    if !db_paths.iter().any(|path| path == &active_db_path) {
        db_paths.push(active_db_path.clone());
    }

    repair_known_migration_metadata_at_paths(&db_paths, &active_db_path)
}

/// Mirrors `db::resolve_db_path_info` while startup still has no `AppHandle`.
fn startup_active_database_path(active_identifier: &str) -> std::path::PathBuf {
    let local_path =
        dirs::data_local_dir().map(|root| root.join(active_identifier).join(db::MAIN_DB_FILE_NAME));
    let roaming_path =
        dirs::config_dir().map(|root| root.join(active_identifier).join(db::MAIN_DB_FILE_NAME));
    let prefer_local = cfg!(all(windows, not(debug_assertions)));

    match (local_path, roaming_path) {
        (Some(local_path), Some(roaming_path)) if prefer_local => {
            if local_path.exists() {
                local_path
            } else if roaming_path.exists() {
                roaming_path
            } else {
                local_path
            }
        }
        (Some(local_path), Some(roaming_path)) => {
            if roaming_path.exists() {
                roaming_path
            } else if local_path.exists() {
                local_path
            } else {
                roaming_path
            }
        }
        (Some(local_path), None) => local_path,
        (None, Some(roaming_path)) => roaming_path,
        (None, None) => std::path::PathBuf::from(db::MAIN_DB_FILE_NAME),
    }
}

fn reconcile_invoke_history_for_profile(
    conn: &rusqlite::Connection,
    db_path: &std::path::Path,
    is_active: bool,
) -> Result<bool, String> {
    match relocate_development_invoke_migration_history(conn) {
        Ok(relocated) => Ok(relocated),
        Err(error) => {
            let message = format!(
                "Failed to reconcile development InvokeAI migration history at {:?}: {error}",
                db_path
            );
            if is_active {
                Err(message)
            } else {
                eprintln!("[DB] Skipping inactive profile: {message}");
                Ok(false)
            }
        }
    }
}
fn repair_known_migration_metadata_at_paths(
    db_paths: &[std::path::PathBuf],
    active_db_path: &std::path::Path,
) -> Result<(), String> {
    use sha2::{Digest, Sha384};

    let migration55 = db::migrations::m55_manual_thumbnail_lookup_index::migration55();
    let expected_m55_checksum = Sha384::digest(migration55.sql.as_bytes()).to_vec();
    let migration56 = db::migrations::m56_thumbnail_optimization::migration56();
    let expected_m56_checksum = Sha384::digest(migration56.sql.as_bytes()).to_vec();

    for db_path in db_paths {
        if !db_path.exists() {
            continue;
        }
        let is_active = db_path == active_db_path;

        let conn = match rusqlite::Connection::open(db_path) {
            Ok(conn) => conn,
            Err(error) if is_active => {
                return Err(format!(
                    "Failed to open active database {:?} for migration reconciliation: {error}",
                    db_path
                ));
            }
            Err(error) => {
                eprintln!(
                    "[DB] Skipping inactive profile database {:?} because it could not be opened: {error}",
                    db_path
                );
                continue;
            }
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

        if reconcile_invoke_history_for_profile(&conn, db_path, is_active)? {
            println!(
                "[DB] Relocated development InvokeAI migration history at {:?}",
                db_path
            );
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
    Ok(())
}
