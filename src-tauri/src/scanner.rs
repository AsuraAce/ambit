use rayon::prelude::*;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::io::BufReader;
use crate::metadata;

#[derive(serde::Serialize, Default, specta::Type)]
pub struct FolderStats {
    #[serde(rename = "totalFiles")]
    pub total_files: usize,
    #[serde(rename = "imageFiles")]
    pub image_files: usize,
    #[serde(rename = "thumbnailFiles")]
    pub thumbnail_files: usize,
    #[serde(rename = "otherFiles")]
    pub other_files: usize,
    #[serde(rename = "directoryChecked")]
    pub directory_checked: String,
    #[serde(rename = "subfolders")]
    pub subfolders: std::collections::HashMap<String, usize>,
}

#[derive(serde::Serialize, specta::Type)]
pub struct ScanResult {
    pub width: u32,
    pub height: u32,
    pub size: u64,
    pub modified: u64,
    pub thumbnail: String,
    pub chunks: std::collections::HashMap<String, String>,
    pub metadata: Option<metadata::ImageMetadata>,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn scan_image(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
) -> Result<ScanResult, String> {
    scan_image_internal(path, thumbnail_dir, skip_thumbnail, extract_workflow, default_tool)
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
        let results: Vec<ScanResult> = paths
            .par_iter()
            .map(|path| {
                scan_image_internal(
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
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn scan_image_workflow(path: String) -> Result<Option<String>, String> {
    let path_obj = std::path::Path::new(&path);
    if !path_obj.exists() {
        return Ok(None);
    }

    let file = File::open(path_obj).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    
    // We use the robust parser which handles headers, decompression, and key-value splitting
    let chunks = match metadata::extract_png_chunks(&mut reader) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    // 1. Prioritize Dedicated Workflow Chunks
    if let Some(workflow) = chunks.get("invokeai_workflow")
        .or_else(|| chunks.get("workflow"))
        .or_else(|| chunks.get("invokeai_graph"))
        .or_else(|| chunks.get("graph"))
    {
        return Ok(Some(workflow.clone()));
    }

    // 2. Fallback to Metadata Chunks
    if let Some(content) = chunks.get("invokeai_metadata")
        .or_else(|| chunks.get("sd-metadata"))
        .or_else(|| chunks.get("dream_metadata"))
    {
        return Ok(Some(content.clone()));
    }

    Ok(None)
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn read_image_metadata(path: String, default_tool: Option<String>) -> Result<metadata::ImageMetadata, String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    let file = File::open(path_obj).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let chunks = metadata::extract_png_chunks(&mut reader)?;

    let mut parsed_metadata = metadata::ImageMetadata::default();
    
    // 1. A1111/Forge (Compatibility)
    if let Some(params) = chunks.get("parameters").or_else(|| chunks.get("Parameters")) {
        parsed_metadata = metadata::extract_a1111_metadata(params, default_tool);
    }

    // 2. InvokeAI (Cumulative Merge)
    if let Some(content) = chunks
        .get("invokeai_metadata")
        .or_else(|| chunks.get("sd-metadata"))
        .or_else(|| chunks.get("dream_metadata"))
    {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
            let invoke_meta = metadata::extract_invokeai_metadata(&json);
            metadata::merge_metadata(&mut parsed_metadata, invoke_meta);
        }
    }

    // 3. ComfyUI (Cumulative Merge & Tool Finalization)
    if chunks.contains_key("prompt") || chunks.contains_key("workflow") {
        let comfy_meta = metadata::extract_comfyui_metadata(&chunks);
        metadata::merge_metadata(&mut parsed_metadata, comfy_meta);
        
        // Finalize tool label: ComfyUI chunks exist, so it's a ComfyUI generation
        parsed_metadata.tool = "ComfyUI".to_string();
    }

    Ok(parsed_metadata)
}

#[tauri::command]
#[specta::specta]
pub async fn get_file_sizes_bulk(paths: Vec<String>) -> Result<Vec<u64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut sizes = Vec::with_capacity(paths.len());
        for path in paths {
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            sizes.push(size);
        }
        Ok(sizes)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn verify_image_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    let missing_paths: Vec<String> = paths
        .par_iter()
        .filter(|path| !std::path::Path::new(path).exists())
        .map(|path| path.clone())
        .collect();
    Ok(missing_paths)
}

#[tauri::command]
#[specta::specta]
pub async fn audit_invokeai_folder(path: String) -> Result<FolderStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut stats = FolderStats::default();
        let images_path = Path::new(&path).join("outputs").join("images");
        stats.directory_checked = images_path.to_string_lossy().to_string();

        if images_path.exists() && images_path.is_dir() {
            scan_dir_recursive(&path.as_ref(), &images_path, &mut stats);
        }
        Ok(stats)
    }).await.map_err(|e| e.to_string())?
}

fn scan_dir_recursive(root: &std::path::Path, current: &std::path::Path, stats: &mut FolderStats) {
    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
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
                    let is_thumbnail = p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                        .unwrap_or(false);

                    if is_thumbnail {
                        stats.thumbnail_files += 1;
                    } else {
                        stats.image_files += 1;

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
                    }
                } else {
                    stats.other_files += 1;
                }
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn list_invokeai_images(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let images_path = Path::new(&path).join("outputs").join("images");
        if images_path.exists() {
            collect_images_recursive(&path.as_ref(), &images_path, &mut files);
        }
        Ok(files)
    }).await.map_err(|e| e.to_string())?
}

fn collect_images_recursive(
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
                    collect_images_recursive(root, &p, files);
                }
            } else if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
                    let is_thumbnail = p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                        .unwrap_or(false);

                    if !is_thumbnail {
                        if let Ok(rel) = p.strip_prefix(root) {
                            files.push(rel.to_string_lossy().replace("\\", "/"));
                        }
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
                    let is_thumbnail = p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.to_lowercase().ends_with("thumbnail.png"))
                        .unwrap_or(false);

                    if !is_thumbnail {
                        files.push(p.to_string_lossy().replace("\\", "/"));
                    }
                }
            }
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn scan_directory_recursive(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let root = Path::new(&path);
        if root.exists() {
            collect_images_recursive_absolute(&root, &root, &mut files);
        }
        Ok(files)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
#[specta::specta]
pub async fn open_file(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace("/", "\\");
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &windows_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace("/", "\\");
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", windows_path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent = path_obj.parent().ok_or("No parent directory")?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn scan_image_internal(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
) -> Result<ScanResult, String> {
    let path_buf = PathBuf::from(&path);
    if path_buf.is_dir() {
        return Err("Path is a directory".to_string());
    }

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

    let img_reader = image::io::Reader::open(&path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;

    let dimensions = img_reader.into_dimensions().map_err(|e| e.to_string())?;

    let mut generated_thumbnail_path = String::new();

    if let Some(dir) = &thumbnail_dir {
        if !skip_thumbnail {
            use base64::{engine::general_purpose, Engine as _};
            let safe_name = general_purpose::STANDARD_NO_PAD.encode(path.as_bytes());
            let thumb_filename = format!("{}.webp", safe_name);
            let thumb_path = PathBuf::from(dir).join(thumb_filename);

            generated_thumbnail_path = thumb_path.to_string_lossy().to_string();

            if !thumb_path.exists() {
                match image::open(&path) {
                    Ok(img) => {
                        let thumb = img.resize(400, 400, image::imageops::FilterType::CatmullRom);
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

    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let mut buffer = [0; 8];
    let _ = file.read_exact(&mut buffer);

    let is_png = buffer == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    let is_jpg = buffer[0..2] == [0xFF, 0xD8];
    let mut chunks = std::collections::HashMap::new();

    if is_jpg {
        if let Ok(c) = metadata::scan_jpeg_metadata(&path_buf) {
            chunks = c;
        }
    }

    if is_png && extract_workflow {
        let mut reader = BufReader::new(file);
        // IMPORTANT: metadata::extract_png_chunks expects the reader at the start of the file
        // to verify the 8-byte PNG signature. Do not seek past the header here.
        reader.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        if let Ok(c) = metadata::extract_png_chunks(&mut reader) {
            chunks.extend(c);
        }
    }

    let mut parsed_metadata = metadata::ImageMetadata::default();
    let mut found_metadata = false;

    // 1. A1111/Forge (Compatibility)
    if let Some(params) = chunks.get("parameters")
        .or_else(|| chunks.get("Parameters"))
        .or_else(|| chunks.get("PARAMETERS")) 
    {
        parsed_metadata = metadata::extract_a1111_metadata(params, default_tool.clone());
        found_metadata = true;
    }

    // 2. InvokeAI (Cumulative Merge)
    if let Some(content) = chunks
        .get("invokeai_metadata")
        .or_else(|| chunks.get("sd-metadata"))
        .or_else(|| chunks.get("dream_metadata"))
    {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
            let invoke_meta = metadata::extract_invokeai_metadata(&json);
            metadata::merge_metadata(&mut parsed_metadata, invoke_meta);
            found_metadata = true;
        }
    }

    // 3. ComfyUI (Cumulative Merge & Tool Finalization)
    if chunks.contains_key("prompt") || chunks.contains_key("workflow") {
        let comfy_meta = metadata::extract_comfyui_metadata(&chunks);
        metadata::merge_metadata(&mut parsed_metadata, comfy_meta);
        
        // Finalize tool label
        parsed_metadata.tool = "ComfyUI".to_string();
        found_metadata = true;
    }

    if let Some(workflow) = chunks.get("graph")
        .or_else(|| chunks.get("invokeai_workflow"))
        .or_else(|| chunks.get("invokeai_graph")) 
    {
        parsed_metadata.workflow_json = Some(workflow.clone());
        found_metadata = true;
    }

    if parsed_metadata.generation_type == "unknown" {
        parsed_metadata.generation_type = metadata::detect_generation_type(&path_buf);
    }

    if parsed_metadata.generation_type == "grid" {
        parsed_metadata.is_grid = true;
    }

    if parsed_metadata.generation_type != "unknown" {
        found_metadata = true;
    }

    let chunks_to_return = if parsed_metadata.workflow_json.is_some() {
        std::collections::HashMap::new()
    } else {
        chunks
    };

    let metadata_obj = if found_metadata {
        Some(parsed_metadata)
    } else {
        None
    };

    Ok(ScanResult {
        width: dimensions.0,
        height: dimensions.1,
        size,
        modified,
        thumbnail: if generated_thumbnail_path.is_empty() { String::new() } else { generated_thumbnail_path },
        chunks: chunks_to_return,
        metadata: metadata_obj
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFFFFFFu32;
        for &b in data {
            crc ^= b as u32;
            for _ in 0..8 {
                if crc & 1 != 0 {
                    crc = (crc >> 1) ^ 0xEDB88320;
                } else {
                    crc >>= 1;
                }
            }
        }
        !crc
    }

    #[test]
    fn test_scan_image_internal_png_metadata() {
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // Header
        
        // IHDR
        let mut ihdr_data = Vec::new();
        ihdr_data.extend_from_slice(b"IHDR");
        ihdr_data.extend_from_slice(&1u32.to_be_bytes()); // width
        ihdr_data.extend_from_slice(&1u32.to_be_bytes()); // height
        ihdr_data.extend_from_slice(&[1, 0, 0, 0, 0]); // bit depth 1, color type 0 (greyscale)
        
        png.extend_from_slice(&13u32.to_be_bytes());
        let crc = crc32(&ihdr_data);
        png.extend_from_slice(&ihdr_data);
        png.extend_from_slice(&crc.to_be_bytes());

        // tEXt chunk
        let mut text_data = Vec::new();
        text_data.extend_from_slice(b"tEXt");
        text_data.extend_from_slice(b"parameters\0");
        text_data.extend_from_slice(b"Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: test-model");
        
        png.extend_from_slice(&((text_data.len() - 4) as u32).to_be_bytes());
        let text_crc = crc32(&text_data);
        png.extend_from_slice(&text_data);
        png.extend_from_slice(&text_crc.to_be_bytes());

        // IDAT (empty or minimal)
        let mut idat_data = Vec::new();
        idat_data.extend_from_slice(b"IDAT");
        // For a 1x1 1-bit greyscale, we need at least some zlib data.
        // Easiest is to just use a valid minimal IDAT if we want image crate to load it.
        // Actually, we don't strictly need it to be LOADABLE by image crate for THIS test 
        // IF we only care about metadata, BUT scan_image_internal calls into_dimensions().
        // into_dimensions() only needs IHDR!
        
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IDAT");
        png.extend_from_slice(&crc32(b"IDAT").to_be_bytes());

        // IEND
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&0xAE426082u32.to_be_bytes());

        let test_path = "test_metadata_fix.png";
        let mut f = File::create(test_path).unwrap();
        f.write_all(&png).unwrap();

        let result = scan_image_internal(test_path.to_string(), None, true, true, None).unwrap();
        let _ = std::fs::remove_file(test_path);

        let metadata = result.metadata.expect("Metadata should exist");
        assert_eq!(metadata.steps, 20);
        assert_eq!(metadata.model, "test-model");
    }
}
