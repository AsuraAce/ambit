pub mod models;
pub mod utils;
pub mod traversal;
pub mod core;

use crate::metadata;
use models::{FolderStats, ScanResult};
use rayon::prelude::*;
use std::path::Path;
use once_cell::sync::Lazy;

// Custom Rayon pool with larger stack size (8MB) to prevent overflows in deep recursions
// or deep JSON/PNG structures.
static SCAN_POOL: Lazy<rayon::ThreadPool> = Lazy::new(|| {
    rayon::ThreadPoolBuilder::new()
        .num_threads(4) // Conservative thread count
        .stack_size(8 * 1024 * 1024) 
        .build()
        .unwrap()
});

// Re-export ScanResult so Specta can see it if needed via scanner::ScanResult
pub use models::ScanResult as PublicScanResult; 

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_image(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
) -> Result<ScanResult, String> {
    core::scan_image_internal(path, thumbnail_dir, skip_thumbnail, extract_workflow, default_tool)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_images_bulk(
    paths: Vec<String>,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
) -> Result<Vec<ScanResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        SCAN_POOL.install(|| {
            let results: Vec<ScanResult> = paths
                .par_iter()
                .map(|path| {
                    println!("[Bulk] About to scan: {}", path);
                    core::scan_image_internal(
                        path.clone(),
                        thumbnail_dir.clone(),
                        skip_thumbnail,
                        extract_workflow,
                        default_tool.clone(),
                    )
                    // Use a default error result if scan fails
                    .unwrap_or_else(|_| ScanResult {
                        width: 0,
                        height: 0,
                        size: 0,
                        modified: 0,
                        thumbnail: String::new(),
                        chunks: std::collections::HashMap::new(),
                        metadata: None,
                    })
                })
                .collect();
            Ok(results)
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_image_workflow(path: String) -> Result<Option<String>, String> {
   core::scan_image_workflow(path)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn read_image_metadata(path: String, default_tool: Option<String>) -> Result<metadata::ImageMetadata, String> {
    core::read_image_metadata(path, default_tool)
}

#[tauri::command]
#[specta::specta]
pub async fn get_file_sizes_bulk(paths: Vec<String>) -> Result<Vec<u64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(utils::get_file_sizes_bulk_impl(paths))
    }).await.map_err(|e| e.to_string())?
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
    }).await.map_err(|e| e.to_string())?
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
    }).await.map_err(|e| e.to_string())?
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
    }).await.map_err(|e| e.to_string())?
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
