use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use rayon::prelude::*;
use flate2::read::ZlibDecoder;
// use image::GenericImageView; // Not needed if we only use Reader for dimensions

#[tauri::command]
async fn scan_image(path: String, thumbnail_dir: Option<String>) -> Result<serde_json::Value, String> {
   // Wrapper for single image scan
   scan_image_internal(path, thumbnail_dir)
}

#[tauri::command]
async fn scan_images_bulk(paths: Vec<String>, thumbnail_dir: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    // Process in parallel using Rayon
    let results: Vec<serde_json::Value> = paths.par_iter().map(|path| {
        match scan_image_internal(path.clone(), thumbnail_dir.clone()) {
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

fn scan_image_internal(path: String, thumbnail_dir: Option<String>) -> Result<serde_json::Value, String> {
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

mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().add_migrations("sqlite:images.db", db::init_db()).build())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![scan_image, scan_images_bulk])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
