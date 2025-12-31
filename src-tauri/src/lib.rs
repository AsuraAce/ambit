use flate2::read::ZlibDecoder;
use regex::Regex;
use rayon::prelude::*;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::path::Path;
use std::io::BufReader;
use tauri::Manager;
// use image::GenericImageView; // Needed for resize algo
use rusqlite::params;
use std::collections::HashMap;

mod metadata;
use metadata::{ImageMetadata, parse_exif, extract_a1111_metadata, extract_invokeai_metadata, detect_generation_type};

#[derive(serde::Deserialize)]
struct ImageRecord {
    id: String,
    path: String,
    width: u32,
    height: u32,
    #[serde(rename = "fileSize")]
    file_size: u64,
    timestamp: u64,
    #[serde(rename = "metadataJson")]
    metadata_json: String,
    #[serde(rename = "thumbnailPath")]
    thumbnail_path: String,
    #[serde(rename = "isFavorite")]
    is_favorite: bool,
    #[serde(rename = "isPinned")]
    is_pinned: bool,
    #[serde(rename = "isDeleted")]
    is_deleted: bool,
    #[serde(rename = "isMissing")]
    is_missing: bool,
    #[serde(rename = "userMasked")]
    user_masked: Option<bool>,
    #[serde(rename = "groupId")]
    group_id: Option<String>,
    #[serde(rename = "boardId")]
    board_id: Option<String>,
    notes: Option<String>,
    #[serde(rename = "originalMetadataJson")]
    original_metadata_json: Option<String>,
}

// Helper to resolve the correct DB path used by tauri-plugin-sql
fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // tauri-plugin-sql typically uses AppData (Roaming) or AppConfig
    // but sometimes LocalData. We check which one exists.

    // 1. Check AppData / Roaming (Most likely for plugin defaults)
    if let Ok(mut path) = app.path().app_config_dir() {
        path.push("images.db");
        if path.exists() {
            println!("[Rust Native] Found DB in Config Dir: {:?}", path);
            return Ok(path);
        }
    }

    // 2. Check AppData / Local
    if let Ok(mut path) = app.path().app_local_data_dir() {
        path.push("images.db");
        if path.exists() {
            println!("[Rust Native] Found DB in Local Data Dir: {:?}", path);
            return Ok(path);
        }

        // If neither exists, we must decide where to create it (or default to one)
        // Since plugin initializes it, we expect it to exist.
        // But if this is a fresh run and plugin hasn't run yet? (Unlikely due to frontend flow)
        // Fallback to Roaming/Config as it matches typical Tauri behavior
    }

    // Fallback: Return Config Dir + images.db
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push("images.db");
    println!("[Rust Native] Defaulting to Config Dir: {:?}", path);
    Ok(path)
}

#[tauri::command(rename_all = "camelCase")]
fn save_images_batch(app: tauri::AppHandle, images: Vec<ImageRecord>) -> Result<usize, String> {
    let db_path = resolve_db_path(&app)?;

    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Performance PRAGMAs for this connection
    let _ = conn.execute("PRAGMA journal_mode=WAL", []);
    let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
    let _ = conn.execute("PRAGMA busy_timeout=30000", []);

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(id) DO UPDATE SET 
                path=excluded.path,
                timestamp=excluded.timestamp, 
                file_size=excluded.file_size,
                metadata_json=excluded.metadata_json,
                thumbnail_path=excluded.thumbnail_path,
                is_favorite=excluded.is_favorite,
                is_pinned=excluded.is_pinned,
                group_id=excluded.group_id,
                board_id=excluded.board_id,
                notes=excluded.notes,
                original_metadata_json=excluded.original_metadata_json"
        ).map_err(|e| e.to_string())?;

        for img in &images {
            stmt.execute(params![
                img.id,
                img.path,
                img.width,
                img.height,
                img.file_size as i64,
                img.timestamp as i64,
                img.metadata_json,
                img.thumbnail_path,
                img.is_favorite,
                img.is_pinned,
                img.is_deleted,
                img.is_missing,
                img.user_masked,
                img.group_id,
                img.board_id,
                img.notes,
                img.original_metadata_json
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(images.len())
}

#[tauri::command(rename_all = "camelCase")]
async fn scan_image(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
) -> Result<serde_json::Value, String> {
    // Wrapper for single image scan
    scan_image_internal(path, thumbnail_dir, skip_thumbnail, extract_workflow)
}

#[tauri::command(rename_all = "camelCase")]
async fn scan_images_bulk(
    paths: Vec<String>,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
) -> Result<Vec<serde_json::Value>, String> {
    // Process in parallel using Rayon
    let results: Vec<serde_json::Value> = paths
        .par_iter()
        .map(|path| {
            match scan_image_internal(path.clone(), thumbnail_dir.clone(), skip_thumbnail, extract_workflow) {
                Ok(json) => json,
                Err(e) => serde_json::json!({
                    "id": path,
                    "error": e,
                    "failed": true
                }),
            }
        })
        .collect();

    Ok(results)
}

#[tauri::command]
async fn scan_image_workflow(path: String) -> Result<Option<String>, String> {
    // Specialized fast-scan for JUST the workflow chunk
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let mut buffer = [0; 8];
    if file.read_exact(&mut buffer).is_err() { return Ok(None); }
    if buffer != [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] { return Ok(None); }

    loop {
        let mut length_bytes = [0; 4];
        if file.read_exact(&mut length_bytes).is_err() { break; }
        let length = u32::from_be_bytes(length_bytes) as u64;

        let mut type_bytes = [0; 4];
        if file.read_exact(&mut type_bytes).is_err() { break; }
        let chunk_type = String::from_utf8_lossy(&type_bytes).to_string();

        if chunk_type == "workflow" || chunk_type == "graph" || chunk_type == "invokeai_workflow" || chunk_type == "invokeai_graph" {
            let mut chunk_data = vec![0; length as usize];
            file.read_exact(&mut chunk_data).map_err(|e| e.to_string())?;
            return Ok(Some(String::from_utf8_lossy(&chunk_data).to_string()));
        } else if chunk_type == "zTXt" || chunk_type == "tEXt" || chunk_type == "iTXt" {
            let mut chunk_data = vec![0; length as usize];
            file.read_exact(&mut chunk_data).map_err(|e| e.to_string())?;
            let content = String::from_utf8_lossy(&chunk_data).to_string();
            
            // Check for InvokeAI metadata blob which often contains the workflow/graph
            if content.contains("invokeai_metadata") || content.contains("sd-metadata") {
                // Return raw chunk for worker/frontend to parse
                return Ok(Some(content));
            }
        } else if chunk_type == "IEND" {
            break;
        }

        if file.seek(SeekFrom::Current((length + 4) as i64)).is_err() { break; }
    }
    Ok(None)
}
 
#[tauri::command(rename_all = "camelCase")]
async fn read_image_metadata(path: String) -> Result<metadata::ImageMetadata, String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    let file = File::open(path_obj).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let chunks = metadata::extract_png_chunks(&mut reader)?;

    // Parse metadata using our standard logic
    let mut parsed_metadata = metadata::ImageMetadata::default();
    let mut found_metadata = false;

    // A1111 (Higher precedence)
    if let Some(params) = chunks.get("parameters") {
        parsed_metadata = metadata::extract_a1111_metadata(params);
        found_metadata = true;
    }

    // InvokeAI (Fallback)
    if !found_metadata {
         if let Some(content) = chunks
            .get("invokeai_metadata")
            .or_else(|| chunks.get("sd-metadata"))
            .or_else(|| chunks.get("dream_metadata"))
        {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
                parsed_metadata = metadata::extract_invokeai_metadata(&json);
                found_metadata = true;
            }
        }
    }

    // Workflow
    if let Some(workflow) = chunks.get("workflow")
        .or_else(|| chunks.get("graph"))
        .or_else(|| chunks.get("invokeai_workflow"))
        .or_else(|| chunks.get("invokeai_graph")) 
    {
        parsed_metadata.workflow_json = Some(workflow.clone());
    }

    Ok(parsed_metadata)
}

#[tauri::command]
async fn get_file_sizes_bulk(paths: Vec<String>) -> Result<Vec<u64>, String> {
    let sizes: Vec<u64> = paths
        .par_iter()
        .map(|path| {
            std::fs::metadata(path)
                .map(|m| m.len())
                .unwrap_or(0)
        })
        .collect();
    Ok(sizes)
}

#[tauri::command]
async fn verify_image_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    // Returns a list of paths that check out as "not existing"
    let missing_paths: Vec<String> = paths
        .par_iter()
        .filter(|path| !std::path::Path::new(path).exists())
        .map(|path| path.clone())
        .collect();
    Ok(missing_paths)
}

#[tauri::command]
async fn audit_invokeai_folder(path: String) -> Result<serde_json::Value, String> {
    let path_buf = PathBuf::from(&path);
    let images_path = path_buf.join("outputs").join("images");

    let mut stats = FolderStats::default();
    stats.directory_checked = images_path.to_string_lossy().to_string();

    if images_path.exists() && images_path.is_dir() {
        scan_dir_recursive(&images_path, &images_path, &mut stats);
    }

    Ok(serde_json::to_value(stats)
        .unwrap_or(serde_json::json!({"error": "Failed to serialize stats"})))
}

#[derive(serde::Serialize, Default)]
struct FolderStats {
    #[serde(rename = "totalFiles")]
    total_files: usize,
    #[serde(rename = "imageFiles")]
    image_files: usize,
    #[serde(rename = "thumbnailFiles")]
    thumbnail_files: usize,
    #[serde(rename = "otherFiles")]
    other_files: usize,
    #[serde(rename = "directoryChecked")]
    directory_checked: String,
    #[serde(rename = "subfolders")]
    subfolders: std::collections::HashMap<String, usize>,
}

fn scan_dir_recursive(root: &std::path::Path, current: &std::path::Path, stats: &mut FolderStats) {
    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                // If it's the thumbnails folder, we count specifically but don't recurse for "images"
                if p.ends_with("thumbnails") {
                    if let Ok(sub_entries) = std::fs::read_dir(&p) {
                        for sub_entry in sub_entries.flatten() {
                            if sub_entry.path().is_file() {
                                stats.thumbnail_files += 1;
                            }
                        }
                    }
                } else {
                    scan_dir_recursive(root, &p, stats);
                }
            } else if p.is_file() {
                stats.total_files += 1;
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    stats.image_files += 1;

                    // Track relative subfolder
                    if let Ok(rel) = p.strip_prefix(root) {
                        if let Some(parent) = rel.parent() {
                            let path_str = parent.to_string_lossy().to_string();
                            if !path_str.is_empty() {
                                *stats.subfolders.entry(path_str).or_insert(0) += 1;
                            } else {
                                *stats.subfolders.entry("root".to_string()).or_insert(0) += 1;
                            }
                        }
                    }
                } else {
                    stats.other_files += 1;
                }
            }
        }
    }
}

#[tauri::command]
async fn list_invokeai_images(path: String) -> Result<Vec<String>, String> {
    let path_buf = PathBuf::from(&path);
    let images_path = path_buf.join("outputs").join("images");
    let mut files = Vec::new();

    if images_path.exists() && images_path.is_dir() {
        collect_images_recursive(&images_path, &images_path, &mut files);
    }

    Ok(files)
}

fn collect_images_recursive(
    root: &std::path::Path,
    current: &std::path::Path,
    files: &mut Vec<String>,
) {
    // Limit to prevent OOM on massive folders (optional safety)
    if files.len() > 300_000 {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if !p.ends_with("thumbnails") {
                    collect_images_recursive(root, &p, files);
                }
            } else if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    // Get relative path from outputs/images ROOT
                    if let Ok(rel) = p.strip_prefix(root) {
                        files.push(rel.to_string_lossy().replace("\\", "/"));
                    }
                }
            }
        }
    }
}

fn collect_images_recursive_absolute(
    root: &std::path::Path,
    current: &std::path::Path,
    files: &mut Vec<String>,
) {
    if files.len() > 300_000 {
        return;
    }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if !p.ends_with("thumbnails") {
                    collect_images_recursive_absolute(root, &p, files);
                }
            } else if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    files.push(p.to_string_lossy().replace("\\", "/"));
                }
            }
        }
    }
}

#[tauri::command]
async fn scan_directory_recursive(path: String) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(&path);
    let mut files = Vec::new();

    if root_path.exists() && root_path.is_dir() {
        collect_images_recursive_absolute(&root_path, &root_path, &mut files);
    }

    Ok(files)
}

fn scan_image_internal(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
) -> Result<serde_json::Value, String> {
    let path_buf = PathBuf::from(&path);
    if path_buf.is_dir() {
        return Ok(serde_json::json!({
            "id": path,
            "failed": true,
            "error": "path is a directory",
            "is_directory": true
        }));
    }

    // 1. Basic File Info
    let metadata = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    let size = metadata.len();
    let modified = metadata
        .modified()
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        })
        .unwrap_or(0);

    // 2. Open Image Reader (Dimensions & Thumbnail)
    let img_reader = image::io::Reader::open(&path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;

    let dimensions = img_reader.into_dimensions().map_err(|e| e.to_string())?;

    // 3. Thumbnail Generation
    let mut generated_thumbnail_path = String::new();

    if let Some(dir) = &thumbnail_dir {
        if !skip_thumbnail {
            // Generate safe filename: base64 encode the full path to avoid collisions and invalid chars
            // Using standard alphabet
            use base64::{engine::general_purpose, Engine as _};
            let safe_name = general_purpose::STANDARD_NO_PAD.encode(path.as_bytes());
            let thumb_filename = format!("{}.webp", safe_name);
            let thumb_path = PathBuf::from(dir).join(thumb_filename);

            generated_thumbnail_path = thumb_path.to_string_lossy().to_string();

            if !thumb_path.exists() {
                // Re-open explicitly for decoding (into_dimensions consumed the previous reader)
                match image::open(&path) {
                    Ok(img) => {
                        // Resize to 400px width (preserving aspect ratio)
                        // FilterType::Lanczos3 is high quality
                        let thumb = img.resize(400, 400, image::imageops::FilterType::CatmullRom);

                        // Create dir if missing
                        let _ = std::fs::create_dir_all(dir);

                        if let Err(e) = thumb.save(&thumb_path) {
                            println!("Failed to save thumbnail: {}", e);
                            generated_thumbnail_path = String::new();
                        }
                    }
                    Err(e) => {
                        println!("Failed to open image for thumbnail: {}", e);
                    }
                }
            }
        }
    }

    // 4. Metadata Extraction (Custom Logic for PNG Chunks)
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let mut buffer = [0; 8];
    // if read fails (e.g. empty file), just continue
    let _ = file.read_exact(&mut buffer);

    // Verify PNG header
    let is_png = buffer == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    let is_jpg = buffer[0..2] == [0xFF, 0xD8];
    let mut chunks = std::collections::HashMap::new();

    if is_jpg {
        if let Ok(c) = metadata::scan_jpeg_metadata(&path_buf) {
            chunks = c;
        }
    }

    // PERFORMANCE: Only scan chunks if specifically requested or if it's not a bulk import
    if is_png && extract_workflow {
        let mut reader = BufReader::new(file);
        // Skip PNG header as it's already read
        reader.seek(SeekFrom::Start(8)).map_err(|e| e.to_string())?;
        if let Ok(c) = metadata::extract_png_chunks(&mut reader) {
            chunks.extend(c);
        }
    }

    // 5. Parse Metadata (Native Rust)
    let mut parsed_metadata = metadata::ImageMetadata::default();
    let mut found_metadata = false;

    // Check for A1111 parameters chunk (Higher precedence than heuristics)
    if let Some(params) = chunks.get("parameters") {
        parsed_metadata = metadata::extract_a1111_metadata(params);
        found_metadata = true;
    }

    // Check for InvokeAI
    if !found_metadata {
        if let Some(content) = chunks
            .get("invokeai_metadata")
            .or_else(|| chunks.get("sd-metadata"))
            .or_else(|| chunks.get("dream_metadata"))
        {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
                parsed_metadata = metadata::extract_invokeai_metadata(&json);
                found_metadata = true;
            }
        }
    }

    // Check for standalone workflow/graph chunks (InvokeAI 4.x+)
    if let Some(workflow) = chunks.get("workflow")
        .or_else(|| chunks.get("graph"))
        .or_else(|| chunks.get("invokeai_workflow"))
        .or_else(|| chunks.get("invokeai_graph")) 
    {
        parsed_metadata.workflow_json = Some(workflow.clone());
        found_metadata = true;
    }

    // Final heuristics for generation type (if not already set by specific parser)
    if parsed_metadata.generation_type == "unknown" {
        parsed_metadata.generation_type = metadata::detect_generation_type(&path_buf);
    }

    if parsed_metadata.generation_type != "unknown" {
        found_metadata = true;
    }

    // Helper to serialize metadata if found, or null
    let metadata_value = if found_metadata {
        serde_json::to_value(&parsed_metadata).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

    // Optimization: If we found workflow_json, we don't need to return the raw chunks over the bridge
    // unless the frontend explicitly needs them (which it doesn't for bulk scans)
    let chunks_to_return = if parsed_metadata.workflow_json.is_some() {
        std::collections::HashMap::new()
    } else {
        chunks
    };

    Ok(serde_json::json!({
        "width": dimensions.0,
        "height": dimensions.1,
        "size": size,
        "modified": modified,
        "thumbnail": if generated_thumbnail_path.is_empty() { String::new() } else { generated_thumbnail_path },
        "chunks": chunks_to_return,
        "metadata": metadata_value
    }))
}

#[tauri::command(rename_all = "camelCase")]
fn refresh_boards_native(
    app: tauri::AppHandle,
    board_mapping: HashMap<String, String>,
) -> Result<usize, String> {
    let db_path = resolve_db_path(&app)?;

    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Performance PRAGMAs
    let _ = conn.execute("PRAGMA journal_mode=WAL", []);
    let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
    let _ = conn.execute("PRAGMA busy_timeout=30000", []);

    // 1. Get all images that lack a board
    let images_to_check: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, path FROM images WHERE board_id IS NULL")
            .map_err(|e| e.to_string())?;
        let items = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        items
    };

    if images_to_check.is_empty() {
        return Ok(0);
    }

    // 2. Start Transaction
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut updated_count = 0;

    {
        let mut update_stmt = tx
            .prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;

        for (id, path) in images_to_check {
            // Extract filename from path (cross-platform)
            let filename = path
                .split('/')
                .last()
                .or_else(|| path.split('\\').last())
                .unwrap_or(&path);

            if let Some(board_name) = board_mapping.get(filename) {
                update_stmt
                    .execute(params![board_name, id])
                    .map_err(|e| e.to_string())?;
                updated_count += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated_count)
}

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    last_event: Mutex<Instant>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
            last_event: Mutex::new(Instant::now().checked_sub(Duration::from_secs(10)).unwrap()),
        }
    }
}

#[tauri::command]
fn start_native_folder_watcher(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    if paths.is_empty() {
        // Just stop if empty path list
         let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;
        if watcher_guard.is_some() {
            *watcher_guard = None;
            println!("[Rust Watcher] Stopped watcher");
        }
        return Ok(());
    }

    let mut watcher_guard = state.watcher.lock().map_err(|e| e.to_string())?;

    // Drop existing watcher to reset everything
    if watcher_guard.is_some() {
        *watcher_guard = None;
        println!("[Rust Watcher] Restarting watcher with new paths...");
    }

    let app_handle = app.clone();
    
    // Shared debounce timer state
    let last_emit_local = std::sync::Arc::new(Mutex::new(
        Instant::now().checked_sub(Duration::from_secs(10)).unwrap(),
    ));

    let event_handler = move |res: notify::Result<notify::Event>| {
        match res {
            Ok(event) => {
                // Check if relevant event
                let is_relevant = match event.kind {
                    notify::EventKind::Create(_) | notify::EventKind::Modify(_) => true,
                    _ => false,
                };

                if is_relevant {
                    // Check extension
                    let has_image = event.paths.iter().any(|p| {
                        p.extension()
                            .map(|e| {
                                let s = e.to_string_lossy().to_lowercase();
                                ["png", "jpg", "jpeg", "webp"].contains(&s.as_str())
                            })
                            .unwrap_or(false)
                    });

                    if has_image {
                        // Throttle: Max 1 emit per 2 seconds (Debounce-ish)
                        let mut last = last_emit_local.lock().unwrap();
                        if last.elapsed() > Duration::from_millis(2000) {
                            println!("[Rust Watcher] Detected change in watched folders, emitting event...");
                            let _ = app_handle.emit("folder-change-event", ());
                            *last = Instant::now();
                        }
                    }
                }
            }
            Err(e) => println!("watch error: {:?}", e),
        }
    };

    let mut watcher =
        RecommendedWatcher::new(event_handler, Config::default()).map_err(|e| e.to_string())?;

    for path_str in &paths {
        let path_buf = PathBuf::from(path_str);
        if path_buf.exists() {
             // RecursiveMode::Recursive is dangerous for root drives, but necessary for folders.
             // We rely on the user picking sensible folders. InvokeAI outputs are usually flat or shallow.
            if let Err(e) = watcher.watch(&path_buf, RecursiveMode::Recursive) {
                println!("[Rust Watcher] Failed to watch path {}: {}", path_str, e);
            } else {
                 println!("[Rust Watcher] Added path: {}", path_str);
            }
        }
    }

    *watcher_guard = Some(watcher);
    
    Ok(())
}

mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(WatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:images.db", db::init_db())
                .build(),
        )
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            scan_image,
            scan_images_bulk,
            get_file_sizes_bulk,
            verify_image_paths,
            audit_invokeai_folder,
            list_invokeai_images,
            save_images_batch,
            refresh_boards_native,
            scan_directory_recursive,
            scan_directory_recursive,
            start_native_folder_watcher,
            show_in_folder,
            open_file,
            scan_image_workflow
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("explorer")
            .arg("/select,")
            .arg(path.replace("/", "\\"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::path::Path;
        let p = Path::new(&path);
        if let Some(parent) = p.parent() {
            use std::process::Command;
            let _ = Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let _ = Command::new("cmd")
            .arg("/c")
            .arg("start")
            .arg("")
            .arg(path.replace("/", "\\"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::process::Command;
        let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        let _ = Command::new(cmd)
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
