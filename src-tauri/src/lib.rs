use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use rayon::prelude::*;
use flate2::read::ZlibDecoder;
use tauri::Manager;
// use image::GenericImageView; // Needed for resize algo
use rusqlite::params;
use std::collections::HashMap;

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
    user_masked: bool,
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

#[tauri::command]
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
                group_id=excluded.group_id,
                board_id=excluded.board_id"
        ).map_err(|e| e.to_string())?;

        for img in &images {
             stmt.execute(params![
                img.id, img.path, img.width, img.height, img.file_size as i64, img.timestamp as i64, 
                img.metadata_json, img.thumbnail_path, 
                img.is_favorite, img.is_pinned, img.is_deleted, img.is_missing, img.user_masked,
                img.group_id, img.board_id, img.notes, img.original_metadata_json
             ]).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(images.len())
}


#[tauri::command]
async fn scan_image(path: String, thumbnail_dir: Option<String>, skip_thumbnail: bool) -> Result<serde_json::Value, String> {
   // Wrapper for single image scan
   scan_image_internal(path, thumbnail_dir, skip_thumbnail)
}

#[tauri::command]
async fn scan_images_bulk(paths: Vec<String>, thumbnail_dir: Option<String>, skip_thumbnail: bool) -> Result<Vec<serde_json::Value>, String> {
    // Process in parallel using Rayon
    let results: Vec<serde_json::Value> = paths.par_iter().map(|path| {
        match scan_image_internal(path.clone(), thumbnail_dir.clone(), skip_thumbnail) {
            Ok(json) => json,
            Err(e) => serde_json::json!({
                "id": path,
                "error": e,
                "failed": true
            })
        }
    }).collect();

    Ok(results)
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

    Ok(serde_json::to_value(stats).unwrap_or(serde_json::json!({"error": "Failed to serialize stats"})))
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
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
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

fn collect_images_recursive(root: &std::path::Path, current: &std::path::Path, files: &mut Vec<String>) {
    // Limit to prevent OOM on massive folders (optional safety)
    if files.len() > 300_000 { return; }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if !p.ends_with("thumbnails") {
                    collect_images_recursive(root, &p, files);
                }
            } else if p.is_file() {
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
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

fn collect_images_recursive_absolute(root: &std::path::Path, current: &std::path::Path, files: &mut Vec<String>) {
    if files.len() > 300_000 { return; }

    if let Ok(entries) = std::fs::read_dir(current) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                collect_images_recursive_absolute(root, &p, files);
            } else if p.is_file() {
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
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

fn scan_image_internal(path: String, thumbnail_dir: Option<String>, skip_thumbnail: bool) -> Result<serde_json::Value, String> {
    let path_buf = PathBuf::from(&path);
    
    // 1. Basic File Info
    let metadata = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    let size = metadata.len();
    let modified = metadata.modified()
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
        .unwrap_or(0);

    // 2. Open Image Reader (Dimensions & Thumbnail)
    let img_reader = image::io::Reader::open(&path).map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
        
    let dimensions = img_reader.into_dimensions().map_err(|e| e.to_string())?;

    // 3. Thumbnail Generation
    let mut generated_thumbnail_path = String::new();
    
    if let Some(dir) = &thumbnail_dir {
        if !skip_thumbnail {
            // Generate safe filename: base64 encode the full path to avoid collisions and invalid chars
            // Using standard alphabet
            use base64::{Engine as _, engine::general_purpose};
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
                        let thumb = img.resize(400, 400, image::imageops::FilterType::Lanczos3);
                        
                        // Create dir if missing
                        let _ = std::fs::create_dir_all(dir);
                        
                        if let Err(e) = thumb.save(&thumb_path) {
                            println!("Failed to save thumbnail: {}", e);
                            generated_thumbnail_path = String::new(); 
                        }
                    },
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
    let mut chunks = std::collections::HashMap::new();

    if is_png {
        let mut loop_count = 0;
        loop {
            // Safety break
            if loop_count > 10000 { break; }
            loop_count += 1;

            let mut length_bytes = [0; 4];
            if file.read_exact(&mut length_bytes).is_err() { break; }
            let length = u32::from_be_bytes(length_bytes) as u64;

            let mut type_bytes = [0; 4];
            if file.read_exact(&mut type_bytes).is_err() { break; }
            let chunk_type = String::from_utf8_lossy(&type_bytes).to_string();

            if chunk_type == "tEXt" || chunk_type == "iTXt" || chunk_type == "zTXt" {
                let mut chunk_data = vec![0; length as usize];
                if file.read_exact(&mut chunk_data).is_err() { break; }
                
                let null_pos = chunk_data.iter().position(|&x| x == 0);
                if let Some(pos) = null_pos {
                    let key = String::from_utf8_lossy(&chunk_data[0..pos]).to_string();
                    
                    if chunk_type == "zTXt" {
                        // zTXt: Keyword (null) Method (0) CompressedData
                        if pos + 2 < chunk_data.len() {
                            let method = chunk_data[pos + 1];
                            if method == 0 {
                                let compressed_data = &chunk_data[pos + 2..];
                                let mut decoder = ZlibDecoder::new(compressed_data);
                                let mut s = String::new();
                                if decoder.read_to_string(&mut s).is_ok() {
                                    chunks.insert(key, s);
                                }
                            }
                        }
                    } else {
                        // tEXt or iTXt
                        let mut text_start = pos + 1;
                        let mut is_compressed = false;
                        
                        if chunk_type == "iTXt" {
                            // Keyword (null)
                            // CompFlag (1 byte) [pos+1]
                            // CompMethod (1 byte) [pos+2]
                            // LangTag (null term)
                            // TransKeyword (null term)
                            
                            if pos + 2 < chunk_data.len() {
                                is_compressed = chunk_data[pos+1] == 1;
                                
                                let mut current = pos + 3;
                                // Find end of lang
                                while current < chunk_data.len() && chunk_data[current] != 0 { current += 1; }
                                current += 1;
                                // Find end of trans
                                while current < chunk_data.len() && chunk_data[current] != 0 { current += 1; }
                                current += 1;
                                text_start = current;
                            }
                        }

                        if text_start < chunk_data.len() {
                            if is_compressed {
                                let compressed_data = &chunk_data[text_start..];
                                let mut decoder = ZlibDecoder::new(compressed_data);
                                let mut s = String::new();
                                if decoder.read_to_string(&mut s).is_ok() {
                                    chunks.insert(key, s);
                                } 
                            } else {
                                let val = String::from_utf8_lossy(&chunk_data[text_start..]).to_string();
                                chunks.insert(key, val);
                            }
                        }
                    }
                }
            } else {
                 if chunk_type == "IEND" { break; }
                 // Skip data
                 if file.seek(SeekFrom::Current(length as i64)).is_err() { break; }
            }
            
            // Skip CRC
            if file.seek(SeekFrom::Current(4)).is_err() { break; }
        }
    }
    
    
    // 5. Parse Metadata (Native Rust)
    let mut parsed_metadata = ImageMetadata::default();
    let mut found_metadata = false;

    // Check for InvokeAI
    if let Some(content) = chunks.get("invokeai_metadata")
        .or_else(|| chunks.get("sd-metadata"))
        .or_else(|| chunks.get("dream_metadata")) 
    {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
            parsed_metadata = extract_invokeai_metadata(&json);
            found_metadata = true;
        }
    }
    
    // Helper to serialize metadata if found, or null
    let metadata_value = if found_metadata {
        serde_json::to_value(&parsed_metadata).unwrap_or(serde_json::Value::Null)
    } else {
        serde_json::Value::Null
    };

    Ok(serde_json::json!({
        "width": dimensions.0,
        "height": dimensions.1,
        "size": size,
        "modified": modified,
        "thumbnail": if generated_thumbnail_path.is_empty() { String::new() } else { generated_thumbnail_path },
        "chunks": chunks,
        "metadata": metadata_value
    }))
}

// -- Metadata Structures & Parsers --

#[derive(serde::Serialize, Default, Clone)]
struct ImageMetadata {
    tool: String,
    model: String,
    steps: u32,
    cfg: f32,
    seed: i64,
    sampler: String,
    #[serde(rename = "positivePrompt")]
    positive_prompt: String,
    #[serde(rename = "negativePrompt")]
    negative_prompt: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    loras: Vec<String>,
    #[serde(rename = "controlNets", skip_serializing_if = "Vec::is_empty")]
    control_nets: Vec<String>,
    #[serde(rename = "variationId", skip_serializing_if = "Option::is_none")]
    variation_id: Option<String>,
    #[serde(rename = "isIntermediate", default)]
    is_intermediate: bool,
}

fn extract_invokeai_metadata(json: &serde_json::Value) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    meta.tool = "InvokeAI".to_string();

    // Handle root vs image wrapped
    let root = json.get("image").unwrap_or(json);

    // Check optional is_intermediate flag
    if let Some(val) = root.get("is_intermediate") {
        if val.as_bool() == Some(true) {
            meta.is_intermediate = true;
        }
    }

    if let Some(s) = root.get("positive_prompt").and_then(|v| v.as_str()) { meta.positive_prompt = s.to_string(); }
    else if let Some(p) = root.get("prompt") {
        if let Some(arr) = p.as_array() {
            let prompts: Vec<&str> = arr.iter().filter_map(|x| x.get("prompt").and_then(|y| y.as_str())).collect();
            meta.positive_prompt = prompts.join(" ");
        } else if let Some(s) = p.as_str() {
            meta.positive_prompt = s.to_string();
        }
    }

    if let Some(s) = root.get("negative_prompt").and_then(|v| v.as_str()) { meta.negative_prompt = s.to_string(); }
    if let Some(v) = root.get("steps").and_then(|v| v.as_u64()) { meta.steps = v as u32; }
    if let Some(v) = root.get("cfg_scale").and_then(|v| v.as_f64()) { meta.cfg = v as f32; }
    if let Some(v) = root.get("seed").and_then(|v| v.as_i64()) { meta.seed = v; }
    if let Some(s) = root.get("scheduler").and_then(|v| v.as_str()) { meta.sampler = s.to_string(); }

    // Model
    if let Some(model) = root.get("model") {
        if let Some(s) = model.as_str() { meta.model = s.to_string(); }
        else if let Some(s) = model.get("model_name").and_then(|v| v.as_str()) { meta.model = s.to_string(); }
        else if let Some(s) = model.get("name").and_then(|v| v.as_str()) { meta.model = s.to_string(); }
    }

    // Resources Scan (LoRAs, ControlNets)
    let mut resources = Resources::default();
    scan_for_resources(json, &mut resources);
    
    meta.loras = resources.loras;
    meta.control_nets = resources.control_nets;

    meta
}

#[derive(Default)]
struct Resources {
    loras: Vec<String>,
    control_nets: Vec<String>,
}

fn scan_for_resources(val: &serde_json::Value, res: &mut Resources) {
    match val {
        serde_json::Value::Object(map) => {
            // Check for specific resource keys in this object
            if let Some(loras) = map.get("loras") { extract_loras(loras, res); }
            if let Some(cns) = map.get("controlnets").or(map.get("control_adapters")) { extract_controlnets(cns, res); }

            // Recurse
            for (_, v) in map {
                // If value is string that looks like JSON, try to parse it (nested configs)
                if let Some(s) = v.as_str() {
                    if s.trim_start().starts_with('{') {
                         if let Ok(nested) = serde_json::from_str(s) {
                             scan_for_resources(&nested, res);
                         }
                    }
                } else {
                    scan_for_resources(v, res);
                }
            }
        },
        serde_json::Value::Array(arr) => {
            for v in arr { scan_for_resources(v, res); }
        },
        _ => {}
    }
}

fn extract_loras(val: &serde_json::Value, res: &mut Resources) {
    if let Some(arr) = val.as_array() {
        for l in arr {
            let name = l.get("lora_name").and_then(|v| v.as_str())
                .or_else(|| l.get("model_name").and_then(|v| v.as_str()))
                .or_else(|| l.get("model").and_then(|m| {
                     m.as_str().or_else(|| m.get("model_name").and_then(|v| v.as_str()))
                }));
            
            if let Some(n) = name {
                let weight = l.get("weight").and_then(|w| w.as_f64()).unwrap_or(0.0);
                let entry = if weight != 0.0 && weight != 1.0 { format!("{} ({:.2})", n, weight) } else { n.to_string() };
                if !res.loras.contains(&entry) { res.loras.push(entry); }
            }
        }
    }
}

fn extract_controlnets(val: &serde_json::Value, res: &mut Resources) {
    if let Some(arr) = val.as_array() {
        for c in arr {
             let name = c.get("control_model").and_then(|v| v.as_str())
                .or_else(|| c.get("model_name").and_then(|v| v.as_str()))
                .or_else(|| c.get("model").and_then(|m| m.get("model_name").and_then(|v| v.as_str())));
             
             if let Some(n) = name {
                 if !res.control_nets.contains(&n.to_string()) { res.control_nets.push(n.to_string()); }
             }
        }
    }
}


#[tauri::command]
fn refresh_boards_native(app: tauri::AppHandle, board_mapping: HashMap<String, String>) -> Result<usize, String> {
    let db_path = resolve_db_path(&app)?;
    
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    
    // Performance PRAGMAs
    let _ = conn.execute("PRAGMA journal_mode=WAL", []); 
    let _ = conn.execute("PRAGMA synchronous=NORMAL", []);
    let _ = conn.execute("PRAGMA busy_timeout=30000", []);

    // 1. Get all images that lack a board
    let images_to_check: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, path FROM images WHERE board_id IS NULL").map_err(|e| e.to_string())?;
        let items = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?
          .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        items
    };

    if images_to_check.is_empty() {
        return Ok(0);
    }

    // 2. Start Transaction
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut updated_count = 0;

    {
        let mut update_stmt = tx.prepare_cached("UPDATE images SET board_id = ?1 WHERE id = ?2").map_err(|e| e.to_string())?;

        for (id, path) in images_to_check {
            // Extract filename from path (cross-platform)
            let filename = path.split('/').last().or_else(|| path.split('\\').last()).unwrap_or(&path);
            
            if let Some(board_name) = board_mapping.get(filename) {
                update_stmt.execute(params![board_name, id]).map_err(|e| e.to_string())?;
                updated_count += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated_count)
}

mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:images.db", db::init_db()).build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![scan_image, scan_images_bulk, audit_invokeai_folder, list_invokeai_images, save_images_batch, refresh_boards_native, scan_directory_recursive])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
