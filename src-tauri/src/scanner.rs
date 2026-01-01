use rayon::prelude::*;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::io::BufReader;
use crate::metadata;

#[derive(serde::Serialize, Default)]
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

#[tauri::command(rename_all = "camelCase")]
pub async fn scan_image(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
) -> Result<serde_json::Value, String> {
    scan_image_internal(path, thumbnail_dir, skip_thumbnail, extract_workflow)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scan_images_bulk(
    paths: Vec<String>,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
) -> Result<Vec<serde_json::Value>, String> {
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
pub async fn read_image_metadata(path: String) -> Result<metadata::ImageMetadata, String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    let file = File::open(path_obj).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let chunks = metadata::extract_png_chunks(&mut reader)?;

    let mut parsed_metadata = metadata::ImageMetadata::default();
    if let Some(params) = chunks.get("parameters").or_else(|| chunks.get("Parameters")) {
        parsed_metadata = metadata::extract_a1111_metadata(params);
    }

    // InvokeAI (Fallback)
    if parsed_metadata.tool == "Unknown" {
         if let Some(content) = chunks
            .get("invokeai_metadata")
            .or_else(|| chunks.get("sd-metadata"))
            .or_else(|| chunks.get("dream_metadata"))
        {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
                parsed_metadata = metadata::extract_invokeai_metadata(&json);
            }
        }
    }

    // ComfyUI (Fallback)
    if parsed_metadata.tool == "Unknown" {
        if chunks.contains_key("prompt") || chunks.contains_key("workflow") {
            parsed_metadata = metadata::extract_comfyui_metadata(&chunks);
        }
    }

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
pub async fn get_file_sizes_bulk(paths: Vec<String>) -> Result<Vec<u64>, String> {
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
pub async fn verify_image_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    let missing_paths: Vec<String> = paths
        .par_iter()
        .filter(|path| !std::path::Path::new(path).exists())
        .map(|path| path.clone())
        .collect();
    Ok(missing_paths)
}

#[tauri::command]
pub async fn audit_invokeai_folder(path: String) -> Result<serde_json::Value, String> {
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
                } else {
                    stats.other_files += 1;
                }
            }
        }
    }
}

#[tauri::command]
pub async fn list_invokeai_images(path: String) -> Result<Vec<String>, String> {
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
pub async fn scan_directory_recursive(path: String) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(&path);
    let mut files = Vec::new();

    if root_path.exists() && root_path.is_dir() {
        collect_images_recursive_absolute(&root_path, &root_path, &mut files);
    }

    Ok(files)
}

#[tauri::command]
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

    if let Some(params) = chunks.get("parameters")
        .or_else(|| chunks.get("Parameters"))
        .or_else(|| chunks.get("PARAMETERS")) 
    {
        parsed_metadata = metadata::extract_a1111_metadata(params);
        found_metadata = true;
    }

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

    if !found_metadata {
        if chunks.contains_key("prompt") || chunks.contains_key("workflow") {
            parsed_metadata = metadata::extract_comfyui_metadata(&chunks);
            found_metadata = true;
        }
    }

    if let Some(workflow) = chunks.get("workflow")
        .or_else(|| chunks.get("graph"))
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

    let metadata_value = if found_metadata {
        serde_json::to_value(&parsed_metadata).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

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

        let result = scan_image_internal(test_path.to_string(), None, true, true).unwrap();
        let _ = std::fs::remove_file(test_path);

        let metadata = result.get("metadata").expect("Metadata should exist");
        assert!(!metadata.is_null(), "Metadata should not be null");
        assert_eq!(metadata["steps"], 20);
        assert_eq!(metadata["model"], "test-model");
    }
}
