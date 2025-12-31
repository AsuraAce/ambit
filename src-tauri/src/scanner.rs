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
            
            if content.contains("invokeai_metadata") || content.contains("sd-metadata") {
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
        reader.seek(SeekFrom::Start(8)).map_err(|e| e.to_string())?;
        if let Ok(c) = metadata::extract_png_chunks(&mut reader) {
            chunks.extend(c);
        }
    }

    let mut parsed_metadata = metadata::ImageMetadata::default();
    let mut found_metadata = false;

    if let Some(params) = chunks.get("parameters").or_else(|| chunks.get("Parameters")) {
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
