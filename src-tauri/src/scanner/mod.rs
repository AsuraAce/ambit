pub mod core;
pub mod models;
pub mod traversal;
pub mod utils;

use crate::metadata;
use models::{FolderStats, ScanResult};
use once_cell::sync::Lazy;
use rayon::prelude::*;
use std::path::Path;

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

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_image(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
) -> Result<ScanResult, String> {
    core::scan_image_internal(
        path,
        thumbnail_dir,
        skip_thumbnail,
        extract_workflow,
        default_tool,
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
) -> Result<Vec<ScanResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
                        chunks: std::collections::HashMap::new(),
                        metadata: None,
                        error: Some(e),
                    });

                    let current = parsed_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    if current % 10 == 0 || current == total {
                        use tauri::Emitter;
                        let _ = app_clone.emit("import_progress", crate::db::ProgressPayload {
                            current,
                            total,
                            message: "Extracting metadata...".to_string(),
                        });
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
pub async fn scan_image_workflow(path: String) -> Result<Option<String>, String> {
    core::scan_image_workflow(path)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn read_image_metadata(
    path: String,
    default_tool: Option<String>,
) -> Result<metadata::ImageMetadata, String> {
    core::read_image_metadata(path, default_tool)
}

#[tauri::command]
#[specta::specta]
pub async fn get_file_sizes_bulk(paths: Vec<String>) -> Result<Vec<u64>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(utils::get_file_sizes_bulk_impl(paths)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn verify_image_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    Ok(utils::verify_image_paths_impl(paths))
}

#[tauri::command]
#[specta::specta]
pub async fn audit_invokeai_folder(path: String) -> Result<FolderStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut stats = FolderStats::default();
        let images_path = Path::new(&path).join("outputs").join("images");
        stats.directory_checked = images_path.to_string_lossy().to_string();

        if images_path.exists() && images_path.is_dir() {
            traversal::scan_dir_recursive(&path.as_ref(), &images_path, &mut stats);
        }
        Ok(stats)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn list_invokeai_images(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let images_path = Path::new(&path).join("outputs").join("images");
        if images_path.exists() {
            traversal::collect_images_recursive(&path.as_ref(), &images_path, &mut files);
        }
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_directory_recursive(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let root = Path::new(&path);
        if root.exists() {
            traversal::collect_images_recursive_absolute(&root, &root, &mut files);
        }
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn open_file(path: String) -> Result<(), String> {
    utils::open_file_impl(path)
}

#[tauri::command]
#[specta::specta]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    utils::show_in_folder_impl(path)
}

#[tauri::command]
#[specta::specta]
pub async fn scan_directory_with_stats(path: String) -> Result<Vec<models::FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let root = Path::new(&path);
        if root.exists() {
            traversal::collect_images_with_stats_recursive(&root, &mut files);
        }
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_directory_since(
    path: String,
    since: u64,
) -> Result<Vec<models::FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let root = Path::new(&path);
        if root.exists() {
            traversal::collect_images_with_stats_since_recursive(&root, since, &mut files);
        }
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}
