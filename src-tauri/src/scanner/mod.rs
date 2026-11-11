pub mod a1111;
pub mod core;
pub mod models;
pub mod traversal;
pub mod utils;

use crate::metadata;
use models::{FileMetadataProbe, FolderStats, ScanResult};
use once_cell::sync::Lazy;
use rayon::prelude::*;
use tauri_plugin_fs::FsExt;

// Custom Rayon pool with larger stack size (8MB) to prevent overflows in deep recursions
// or deep JSON/PNG structures.
static SCAN_POOL: Lazy<rayon::ThreadPool> = Lazy::new(|| {
    let available_threads = std::thread::available_parallelism()
        .map(|threads| threads.get())
        .unwrap_or(2);
    let scan_threads = if available_threads <= 2 {
        1
    } else {
        std::cmp::min(4, available_threads.saturating_sub(1))
    };

    rayon::ThreadPoolBuilder::new()
        .num_threads(scan_threads)
        .stack_size(8 * 1024 * 1024)
        .build()
        .unwrap()
});

// Re-export ScanResult so Specta can see it if needed via scanner::ScanResult

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgressPayload {
    current: usize,
    total: usize,
    message: String,
    progress_run_id: String,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_image(
    app: tauri::AppHandle,
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
) -> Result<ScanResult, String> {
    let app_thumbnail_dir = utils::app_thumbnail_dir(&app)?;
    let mut known_media = utils::KnownMediaLookup::new(&app);
    utils::scan_image_in_scope(
        path,
        thumbnail_dir,
        skip_thumbnail,
        extract_workflow,
        default_tool,
        &app_thumbnail_dir,
        |candidate| utils::fs_scope_allows(&app, candidate),
        |candidate| known_media.contains(candidate),
    )
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_images_bulk(
    app: tauri::AppHandle,
    paths: Vec<String>,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
    progress_run_id: Option<String>,
) -> Result<Vec<ScanResult>, String> {
    let app_thumbnail_dir = utils::app_thumbnail_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut known_media = utils::KnownMediaLookup::new(&app);
        utils::validate_bulk_scan_request(
            &paths,
            thumbnail_dir.as_deref(),
            &app_thumbnail_dir,
            |candidate| utils::fs_scope_allows(&app, candidate),
            |candidate| known_media.contains(candidate),
        )?;
        drop(known_media);
        let app_clone = app.clone();
        SCAN_POOL.install(move || {
            let total = paths.len();
            let parsed_count = std::sync::atomic::AtomicUsize::new(0);

            // Use par_iter for bounded parallel processing.
            let results: Vec<ScanResult> = paths
                .par_iter()
                .map(|path| {
                    // println!("[Bulk] About to scan: {}", path); // Comment out to reduce log spam
                    let res = core::scan_image_internal(
                        path.clone(),
                        thumbnail_dir.clone(),
                        skip_thumbnail,
                        extract_workflow,
                        default_tool.clone(),
                    )
                    // Capture the error in the result instead of swallowing it
                    .unwrap_or_else(|e| ScanResult {
                        width: 0,
                        height: 0,
                        size: 0,
                        modified: 0,
                        thumbnail: String::new(),
                        micro_thumbnail: None,
                        thumbnail_source: None,
                        thumbnail_version: 0,
                        detected_source_kind: metadata::photo::SourceKind::Other,
                        photo_metadata: None,
                        photo_metadata_error: None,
                        capture_wall_time_ms: None,
                        chunks: std::collections::HashMap::new(),
                        metadata: None,
                        error: Some(e),
                    });

                    let current =
                        parsed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    if progress_run_id.is_some() && (current.is_multiple_of(10) || current == total)
                    {
                        use tauri::Emitter;
                        let _ = app_clone.emit(
                            "import_progress",
                            ImportProgressPayload {
                                current,
                                total,
                                message: "Extracting metadata...".to_string(),
                                progress_run_id: progress_run_id.clone().unwrap_or_default(),
                            },
                        );
                    }

                    res
                })
                .collect();
            Ok(results)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_image_workflow(
    app: tauri::AppHandle,
    path: String,
) -> Result<Option<String>, String> {
    let mut known_media = utils::KnownMediaLookup::new(&app);
    utils::scan_image_workflow_in_scope(
        path,
        |candidate| utils::fs_scope_allows(&app, candidate),
        |candidate| known_media.contains(candidate),
    )
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn read_image_metadata(
    app: tauri::AppHandle,
    path: String,
    default_tool: Option<String>,
) -> Result<metadata::ImageMetadata, String> {
    let mut known_media = utils::KnownMediaLookup::new(&app);
    utils::read_image_metadata_in_scope(
        path,
        default_tool,
        |candidate| utils::fs_scope_allows(&app, candidate),
        |candidate| known_media.contains(candidate),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn get_file_sizes_bulk(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<u64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut known_media = utils::KnownMediaLookup::new(&app);
        utils::get_file_sizes_in_scope(
            paths,
            |candidate| utils::fs_scope_allows(&app, candidate),
            |candidate| known_media.contains(candidate),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn probe_file_metadata_bulk(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<FileMetadataProbe>, String> {
    utils::validate_metadata_probe_paths(&paths, |path| app.fs_scope().is_allowed(path))?;
    tauri::async_runtime::spawn_blocking(move || Ok(utils::probe_file_metadata_bulk_impl(paths)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn verify_image_paths(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut known_media = utils::KnownMediaLookup::new(&app);
        utils::verify_image_paths_in_scope(
            paths,
            |candidate| utils::fs_scope_allows(&app, candidate),
            |candidate| known_media.contains(candidate),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn audit_invokeai_folder(
    app: tauri::AppHandle,
    path: String,
) -> Result<FolderStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        utils::audit_invokeai_folder_in_scope(&path, |candidate| {
            utils::fs_scope_allows(&app, candidate)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn list_invokeai_images(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        utils::list_invokeai_images_in_scope(&path, |candidate| {
            app.fs_scope().is_allowed(candidate)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_directory_recursive(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        utils::scan_directory_recursive_in_scope(&path, |candidate| {
            utils::fs_scope_allows(&app, candidate)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn open_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || utils::open_file_impl(&app, path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn show_in_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || utils::show_in_folder_impl(&app, path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_directory_with_stats(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<models::FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        utils::scan_directory_with_stats_in_scope(&path, |candidate| {
            utils::fs_scope_allows(&app, candidate)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_directory_since(
    app: tauri::AppHandle,
    path: String,
    since: u64,
) -> Result<Vec<models::FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        utils::scan_directory_since_in_scope(&path, since, |candidate| {
            utils::fs_scope_allows(&app, candidate)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod scope_source_tests {
    //! #384: the checks live in pure helpers with their own tests. These tests make
    //! sure each command still routes through its check before it touches a path,
    //! since a command that skipped its helper would pass every helper test.

    const SCANNER: &str = include_str!("mod.rs");
    const FS_COMMANDS: &str = include_str!("../fs_commands.rs");
    const A1111: &str = include_str!("a1111.rs");
    const CIVITAI: &str = include_str!("../metadata/civitai.rs");
    const THUMBS_SCAN: &str = include_str!("../metadata/thumbs_scan.rs");
    const WATCHER: &str = include_str!("../watcher.rs");

    /// The text of `fn name(` up to the next `#[tauri::command`.
    fn command_body<'a>(source: &'a str, name: &str) -> &'a str {
        let start = source
            .find(&format!("pub async fn {name}("))
            .or_else(|| source.find(&format!("pub fn {name}(")))
            .unwrap_or_else(|| panic!("command {name} not found"));
        let rest = &source[start..];
        let end = rest.find("#[tauri::command").unwrap_or(rest.len());
        &rest[..end]
    }

    fn assert_checked_before(source: &str, name: &str, check: &str, first_use: &str) {
        let body = command_body(source, name);
        let check_at = body
            .find(check)
            .unwrap_or_else(|| panic!("{name} must call {check}"));
        let use_at = body
            .find(first_use)
            .unwrap_or_else(|| panic!("{name} no longer contains {first_use}"));
        assert!(
            check_at < use_at,
            "{name} must call {check} before {first_use}"
        );
        // A check whose error is dropped refuses nothing.
        let call = &body[check_at..];
        let call = &call[..call.find(';').unwrap_or(call.len())];
        assert!(
            call.trim_end().ends_with(")?"),
            "{name} must return the error from {check}"
        );
    }

    #[test]
    fn every_path_taking_command_routes_through_a_scope_check() {
        let routed = [
            (SCANNER, "scan_image", "utils::scan_image_in_scope("),
            (
                SCANNER,
                "scan_image_workflow",
                "utils::scan_image_workflow_in_scope(",
            ),
            (
                SCANNER,
                "read_image_metadata",
                "utils::read_image_metadata_in_scope(",
            ),
            (
                SCANNER,
                "get_file_sizes_bulk",
                "utils::get_file_sizes_in_scope(",
            ),
            (
                SCANNER,
                "verify_image_paths",
                "utils::verify_image_paths_in_scope(",
            ),
            (
                SCANNER,
                "audit_invokeai_folder",
                "utils::audit_invokeai_folder_in_scope(",
            ),
            (
                SCANNER,
                "scan_directory_recursive",
                "utils::scan_directory_recursive_in_scope(",
            ),
            (
                SCANNER,
                "scan_directory_with_stats",
                "utils::scan_directory_with_stats_in_scope(",
            ),
            (
                SCANNER,
                "scan_directory_since",
                "utils::scan_directory_since_in_scope(",
            ),
            (
                FS_COMMANDS,
                "get_invoke_db_snapshot",
                "invoke_db_snapshot_in_scope(",
            ),
            (
                A1111,
                "discover_a1111_folders",
                "discover_a1111_folders_in_scope(",
            ),
            (CIVITAI, "import_a1111_cache", "read_a1111_cache_in_scope("),
        ];
        for (source, name, check) in routed {
            assert!(
                command_body(source, name).contains(check),
                "{name} must route through {check}"
            );
        }

        // These three keep their work inline, so the check must come first.
        assert_checked_before(
            SCANNER,
            "scan_images_bulk",
            "utils::validate_bulk_scan_request(",
            "SCAN_POOL.install(",
        );
        assert_checked_before(
            THUMBS_SCAN,
            "scan_model_thumbnails",
            "validate_scoped_roots(",
            "for (i, root_path) in paths.iter().enumerate()",
        );
        // A refused call must leave the running watcher in place.
        assert_checked_before(
            WATCHER,
            "start_native_folder_watcher",
            "validate_scoped_roots(",
            "Restarting watcher with new paths",
        );

        // The raw scope check refuses a missing file under a junction or mapped
        // drive; `fs_scope_allows` reports it missing instead.
        let inline = [
            (SCANNER, "scan_images_bulk"),
            (THUMBS_SCAN, "scan_model_thumbnails"),
            (WATCHER, "start_native_folder_watcher"),
        ];
        for (source, name) in routed
            .iter()
            .map(|(source, name, _)| (*source, *name))
            .chain(inline)
        {
            let body = command_body(source, name);
            assert!(
                body.contains("fs_scope_allows(&app,") && !body.contains("fs_scope().is_allowed("),
                "{name} must check the scope through fs_scope_allows"
            );
        }
    }
}
