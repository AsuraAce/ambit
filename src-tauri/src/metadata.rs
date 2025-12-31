use regex::Regex;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use flate2::read::ZlibDecoder;

// -- Metadata Structures --

#[derive(serde::Serialize, Clone)]
pub struct ImageMetadata {
    pub tool: String,
    pub model: String,
    #[serde(rename = "rawParameters", skip_serializing_if = "Option::is_none")]
    pub raw_parameters: Option<String>,
    pub steps: u32,
    pub cfg: f32,
    pub seed: i64,
    pub sampler: String,
    #[serde(rename = "positivePrompt")]
    pub positive_prompt: String,
    #[serde(rename = "negativePrompt")]
    pub negative_prompt: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub loras: Vec<String>,
    #[serde(rename = "controlNets", skip_serializing_if = "Vec::is_empty")]
    pub control_nets: Vec<String>,
    #[serde(rename = "variationId", skip_serializing_if = "Option::is_none")]
    pub variation_id: Option<String>,
    #[serde(rename = "isIntermediate", default)]
    pub is_intermediate: bool,
    #[serde(rename = "workflowJson", skip_serializing_if = "Option::is_none")]
    pub workflow_json: Option<String>,
    // New fields for deeper extraction
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vae: Option<String>,
    #[serde(rename = "clipSkip", skip_serializing_if = "Option::is_none")]
    pub clip_skip: Option<u32>,
    #[serde(rename = "denoisingStrength", skip_serializing_if = "Option::is_none")]
    pub denoising_strength: Option<f32>,
    #[serde(rename = "hiresUpscale", skip_serializing_if = "Option::is_none")]
    pub hires_upscale: Option<f32>,
    #[serde(rename = "hiresSteps", skip_serializing_if = "Option::is_none")]
    pub hires_steps: Option<u32>,
    #[serde(rename = "hiresUpscaler", skip_serializing_if = "Option::is_none")]
    pub hires_upscaler: Option<String>,
    #[serde(rename = "modelHash", skip_serializing_if = "Option::is_none")]
    pub model_hash: Option<String>,
    #[serde(rename = "generationType")]
    pub generation_type: String,
}

impl Default for ImageMetadata {
    fn default() -> Self {
        Self {
            tool: "Unknown".to_string(),
            model: "Unknown".to_string(),
            raw_parameters: None,
            steps: 0,
            cfg: 0.0,
            seed: 0,
            sampler: "Unknown".to_string(),
            positive_prompt: String::new(),
            negative_prompt: String::new(),
            loras: Vec::new(),
            control_nets: Vec::new(),
            variation_id: None,
            is_intermediate: false,
            workflow_json: None,
            vae: None,
            clip_skip: None,
            denoising_strength: None,
            hires_upscale: None,
            hires_steps: None,
            hires_upscaler: None,
            model_hash: None,
            generation_type: "unknown".to_string(),
        }
    }
}

// -- Public Logic --

pub fn detect_generation_type(path: &std::path::Path) -> String {
    let lower_path = path.to_string_lossy().to_lowercase().replace('\\', "/");
    if lower_path.contains("/txt2img-images") || lower_path.contains("/outputs/txt2img") || lower_path.contains("/txt2img/") || lower_path.contains("/text/") {
        "txt2img".to_string()
    } else if lower_path.contains("/img2img-images") || lower_path.contains("/outputs/img2img") || lower_path.contains("/img2img/") || lower_path.contains("/image/") {
        "img2img".to_string()
    } else if lower_path.contains("/extras-images") || lower_path.contains("/outputs/extras") || lower_path.contains("/extras/") || lower_path.contains("/save") || lower_path.contains("/saved") {
        "extras".to_string()
    } else if lower_path.contains("-grids") || lower_path.contains("/grids/") {
        "grid".to_string()
    } else {
        "unknown".to_string()
    }
}

pub fn scan_jpeg_metadata(path: &std::path::Path) -> Result<HashMap<String, String>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut buffer = [0; 2];
    if file.read_exact(&mut buffer).is_err() { return Ok(HashMap::new()); }
    if buffer != [0xFF, 0xD8] { return Ok(HashMap::new()); } // SOI

    let mut chunks = HashMap::new();

    loop {
        let mut marker = [0; 2];
        if file.read_exact(&mut marker).is_err() { break; }
        if marker[0] != 0xFF { break; }

        let m_type = marker[1];
        if m_type == 0xD9 { break; } // EOI

        // Length
        let mut len_bytes = [0; 2];
        if file.read_exact(&mut len_bytes).is_err() { break; }
        let len = (u16::from_be_bytes(len_bytes) as usize) - 2;

        if m_type == 0xE1 { // APP1 - EXIF
            let mut app1_data = vec![0; len];
            if file.read_exact(&mut app1_data).is_ok() {
                if app1_data.starts_with(b"Exif\0\0") {
                    if let Some(comment) = parse_exif(&app1_data[6..]) {
                        chunks.insert("parameters".to_string(), comment);
                    }
                }
            }
        } else {
            if file.seek(SeekFrom::Current(len as i64)).is_err() { break; }
        }
    }

    Ok(chunks)
}

pub fn extract_png_chunks<R: Read>(reader: &mut R) -> Result<HashMap<String, String>, String> {
    let mut buffer = [0; 8];
    if reader.read_exact(&mut buffer).is_err() {
        return Err("Failed to read header".to_string());
    }

    // Verify PNG header
    if buffer != [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Err("Not a PNG file".to_string());
    }

    let mut chunks = HashMap::new();
    let mut loop_count = 0;

    loop {
        if loop_count > 10000 { break; }
        loop_count += 1;

        let mut length_bytes = [0; 4];
        if reader.read_exact(&mut length_bytes).is_err() { break; }
        let length = u32::from_be_bytes(length_bytes) as u64;

        let mut type_bytes = [0; 4];
        if reader.read_exact(&mut type_bytes).is_err() { break; }
        let chunk_type = String::from_utf8_lossy(&type_bytes).to_string();

        if chunk_type == "tEXt" || chunk_type == "iTXt" || chunk_type == "zTXt" || chunk_type == "eXIf" {
            let mut chunk_data = vec![0; length as usize];
            if reader.read_exact(&mut chunk_data).is_err() { break; }

            if chunk_type == "eXIf" {
                if let Some(comment) = parse_exif(&chunk_data) {
                    chunks.insert("parameters".to_string(), comment);
                }
            } else if let Some(pos) = chunk_data.iter().position(|&x| x == 0) {
                 let key = String::from_utf8_lossy(&chunk_data[0..pos]).to_string();
                 
                 if chunk_type == "zTXt" {
                     if pos + 2 < chunk_data.len() && chunk_data[pos+1] == 0 {
                         let compressed = &chunk_data[pos+2..];
                         let mut decoder = ZlibDecoder::new(compressed);
                         let mut s = String::new();
                         if decoder.read_to_string(&mut s).is_ok() {
                             chunks.insert(key, s);
                         }
                     }
                 } else if chunk_type == "tEXt" {
                     if pos + 1 < chunk_data.len() {
                         let val = String::from_utf8_lossy(&chunk_data[pos+1..]).to_string();
                         chunks.insert(key, val);
                     }
                 } else if chunk_type == "iTXt" {
                     // Simplified iTXt parsing
                     if pos + 2 < chunk_data.len() {
                         let is_compressed = chunk_data[pos+1] == 1;
                         // Skip compression method (pos+2)
                         // Skip lang tags etc - find next nulls
                         let mut curr = pos + 3;
                         // Skip lang tag
                         while curr < chunk_data.len() && chunk_data[curr] != 0 { curr += 1; }
                         curr += 1;
                         // Skip trans key
                         while curr < chunk_data.len() && chunk_data[curr] != 0 { curr += 1; }
                         curr += 1;
                         
                         if curr < chunk_data.len() {
                            let data_slice = &chunk_data[curr..];
                            if is_compressed {
                                let mut decoder = ZlibDecoder::new(data_slice);
                                let mut s = String::new();
                                if decoder.read_to_string(&mut s).is_ok() {
                                    chunks.insert(key, s);
                                }
                            } else {
                                chunks.insert(key, String::from_utf8_lossy(data_slice).to_string());
                            }
                         }
                     }
                 }
            }
            
            // Read CRC (4 bytes)
            let mut crc = [0; 4];
            let _ = reader.read_exact(&mut crc);
        } else if chunk_type == "IEND" {
            break;
        } else {
            // Efficiently skip data + CRC
            let skip_len = length + 4;
            std::io::copy(&mut reader.by_ref().take(skip_len), &mut std::io::sink()).map_err(|e| e.to_string())?;
        }
    }

    Ok(chunks)
}

pub fn parse_exif(data: &[u8]) -> Option<String> {
    // Check for TIFF header
    let is_little_endian = if data.len() < 8 {
        return None;
    } else if data[0] == 0x49 && data[1] == 0x49 {
        true
    } else if data[0] == 0x4D && data[1] == 0x4D {
        false
    } else {
        return None;
    };

    let get_u16 = |offset: usize| -> Option<u16> {
        if offset + 2 > data.len() { return None; }
        let slice = &data[offset..offset+2];
        let arr: [u8; 2] = slice.try_into().ok()?;
        Some(if is_little_endian { u16::from_le_bytes(arr) } else { u16::from_be_bytes(arr) })
    };

    let get_u32 = |offset: usize| -> Option<u32> {
        if offset + 4 > data.len() { return None; }
        let slice = &data[offset..offset+4];
        let arr: [u8; 4] = slice.try_into().ok()?;
        Some(if is_little_endian { u32::from_le_bytes(arr) } else { u32::from_be_bytes(arr) })
    };

    if get_u16(2)? != 0x002A { return None; }

    let first_ifd_offset = get_u32(4)? as usize;
    if first_ifd_offset < 8 || first_ifd_offset >= data.len() { return None; }

    // Helper to read IFD
    fn read_ifd_internal(data: &[u8], offset: usize, is_le: bool) -> Option<String> {
        if offset + 2 > data.len() { return None; }
        
        // Helper closures again inside logic to capture is_le
        let get_u16_inner = |o: usize| -> Option<u16> {
            if o + 2 > data.len() { return None; }
            let s = &data[o..o+2];
            let a: [u8; 2] = s.try_into().ok()?;
            Some(if is_le { u16::from_le_bytes(a) } else { u16::from_be_bytes(a) })
        };
        let get_u32_inner = |o: usize| -> Option<u32> {
            if o + 4 > data.len() { return None; }
            let s = &data[o..o+4];
            let a: [u8; 4] = s.try_into().ok()?;
            Some(if is_le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) })
        };

        let entry_count = get_u16_inner(offset)?;
        let entries_start = offset + 2;

        let mut exif_ifd_offset = 0;

        for i in 0..entry_count {
            let entry_offset = entries_start + (i as usize * 12);
            if entry_offset + 12 > data.len() { break; }

            let tag = get_u16_inner(entry_offset)?;
            let count = get_u32_inner(entry_offset + 4)?;
            let value_offset_or_data = get_u32_inner(entry_offset + 8)?;

            if tag == 0x8769 {
                exif_ifd_offset = value_offset_or_data as usize;
            }

            if tag == 0x9286 {
                let data_offset = value_offset_or_data as usize;
                // Safety check
                if data_offset + 8 < data.len() {
                     // Check specific headers
                     // "UNICODE\0"
                    let header_slice = &data[data_offset..data_offset+8];
                    if header_slice.starts_with(b"UNICODE\0") {
                        // UTF-16
                         let payload_start = data_offset + 8;
                         let payload_len = (count as usize).saturating_sub(8);
                         let payload_end = payload_start + payload_len;
                         
                         if payload_end <= data.len() {
                             let payload = &data[payload_start..payload_end];
                             // Convert [u8] to [u16]
                             let u16_vec: Vec<u16> = payload
                                 .chunks_exact(2)
                                 .map(|c| if is_le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
                                 .collect();
                             
                             if let Ok(s) = String::from_utf16(&u16_vec) {
                                 let clean = s.trim_end_matches('\0').trim().to_string();
                                 // Further sanitization of null bytes inside
                                 return Some(clean.replace('\0', ""));
                             }
                        }
                    } else if header_slice.starts_with(b"ASCII\0\0\0") {
                        let payload_start = data_offset + 8;
                        let payload_len = (count as usize).saturating_sub(8);
                         if payload_start + payload_len <= data.len() {
                            let s = String::from_utf8_lossy(&data[payload_start..payload_start+payload_len]);
                            return Some(s.trim_matches('\0').trim().to_string());
                         }
                    } else if data[data_offset] == 0 {
                         // Some writers use no header, just 0 pad if undefined type
                         // Try to read as UTF8/ASCII skipping leading nulls?
                         // Or standard reading
                         // Often it's just raw utf8
                         let payload_len = count as usize;
                         if data_offset + payload_len <= data.len() {
                             let s = String::from_utf8_lossy(&data[data_offset..data_offset+payload_len]);
                             return Some(s.trim_matches('\0').trim().to_string());
                         }
                    } else {
                         // Try raw
                         let payload_len = count as usize;
                         if data_offset + payload_len <= data.len() {
                             let s = String::from_utf8_lossy(&data[data_offset..data_offset+payload_len]);
                             return Some(s.trim_matches('\0').trim().to_string());
                         }
                    }
                }
            }
        }

        if exif_ifd_offset > 0 {
            // simplified recursion prevention: we only call this once from root
            // but here we are inside the closure. 
            // In Rust closures, recursion is tricky.
            // We return None here and let the parent handle it potentially, 
            // OR we just duplicate the logic since we only support 1 level of Exif IFD pointer usually.
            // But let's cheat: we returned the offset in `parse_exif` logic? No, we need to return the string.
             
            // To properly recurse we need the function to be separate or passed to itself.
            // We'll refactor slightly: 
            // The outer function calls `read_ifd_internal`. If it finds 0x9286, it returns.
            // If it finds 0x8769, it returns the OFFSET.
            // Then the outer loop calls it again.
            // This closure returns `Option<String>` so it returns the comment directly.
            // If it finds offset, it should probably call itself? 
            // Since we can't easily recurse a closure, we'll just check the offset found in this pass
            // and perform one more pass manually below the loop? 
            // Actually, `parse_exif` structure in `lib.rs` was using a separate function `read_ifd_internal` 
            // that took `data` and `offset`. Let's restore that structure.
            return None;
        }

        None
    }

    // Pass 1: Root IFD (IFD0)
    let res = read_ifd_internal(data, first_ifd_offset, is_little_endian);
    if res.is_some() { return res; }

    // If we didn't find UserComment in IFD0, check if we found an Exif Pointer.
    // We need to parse IFD0 again to find the pointer? Or modify read_ifd_internal to return the pointer?
    // Let's modify the logic to be robust.
    
    // Scan IFD0 for Exif Offset tag manually here to avoid complex return types
    let entry_count = get_u16(first_ifd_offset)?;
    let entries_start = first_ifd_offset + 2;
    for i in 0..entry_count {
        let entry_offset = entries_start + (i as usize * 12);
        if entry_offset + 12 > data.len() { break; }
        
        let tag = get_u16(entry_offset)?;
        if tag == 0x8769 {
             let value_offset = get_u32(entry_offset + 8)?;
             // Call reader on Exif IFD
             return read_ifd_internal(data, value_offset as usize, is_little_endian);
        }
    }

    None
}

// -- Helpers for Resources --

#[derive(Default)]
struct Resources {
    loras: Vec<String>,
    control_nets: Vec<String>,
}

fn extract_loras(val: &serde_json::Value, res: &mut Resources) {
    if let Some(arr) = val.as_array() {
        for l in arr {
            let name = l
                .get("lora_name")
                .and_then(|v| v.as_str())
                .or_else(|| l.get("model_name").and_then(|v| v.as_str()))
                .or_else(|| {
                    l.get("model").and_then(|m| {
                        m.as_str()
                            .or_else(|| m.get("model_name").and_then(|v| v.as_str()))
                    })
                });

            if let Some(n) = name {
                let weight = l.get("weight").and_then(|w| w.as_f64()).unwrap_or(0.0);
                let entry = if weight != 0.0 && weight != 1.0 {
                    format!("{} ({:.2})", n, weight)
                } else {
                    n.to_string()
                };
                if !res.loras.contains(&entry) {
                    res.loras.push(entry);
                }
            }
        }
    }
}

fn extract_controlnets(val: &serde_json::Value, res: &mut Resources) {
    if let Some(arr) = val.as_array() {
        for c in arr {
            let name = c
                .get("control_model")
                .and_then(|v| v.as_str())
                .or_else(|| c.get("model_name").and_then(|v| v.as_str()))
                .or_else(|| {
                    c.get("model")
                        .and_then(|m| m.get("model_name").and_then(|v| v.as_str()))
                });

            if let Some(n) = name {
                if !res.control_nets.contains(&n.to_string()) {
                    res.control_nets.push(n.to_string());
                }
            }
        }
    }
}

fn scan_for_resources(val: &serde_json::Value, res: &mut Resources) {
    match val {
        serde_json::Value::Object(map) => {
            if let Some(loras) = map.get("loras") {
                extract_loras(loras, res);
            }
            if let Some(cns) = map.get("controlnets").or(map.get("control_adapters")) {
                extract_controlnets(cns, res);
            }

            for (_, v) in map {
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
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                scan_for_resources(v, res);
            }
        }
        _ => {}
    }
}

// -- Main Parsers --

pub fn extract_invokeai_metadata(json: &serde_json::Value) -> ImageMetadata {
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

    if let Some(prompt) = root.get("prompt") {
        if let Some(arr) = prompt.as_array() {
            // Old format
            let mut prompt_parts = Vec::new();
            for p in arr {
                if let Some(pt) = p.get("prompt").and_then(|s| s.as_str()) {
                    prompt_parts.push(pt);
                }
            }
            meta.positive_prompt = prompt_parts.join(" ");
        }
    }

    // Try new InvokeAI Graph format / Metadata
    // Often fields are directly on root or inside 'positive_prompt' / 'negative_prompt'
    if let Some(pos) = root.get("positive_prompt").and_then(|s| s.as_str()) {
        meta.positive_prompt = pos.trim().to_string();
    } else if let Some(pos) = root.get("positive_conditioning").and_then(|s| s.as_str()) {
        meta.positive_prompt = pos.trim().to_string();
    }

    if let Some(neg) = root.get("negative_prompt").and_then(|s| s.as_str()) {
        meta.negative_prompt = neg.trim().to_string();
    } else if let Some(neg) = root.get("negative_conditioning").and_then(|s| s.as_str()) {
        meta.negative_prompt = neg.trim().to_string();
    }

    if let Some(steps) = root.get("steps").and_then(|v| v.as_u64()) {
        meta.steps = steps as u32;
    }
    if let Some(cfg) = root.get("cfg_scale").and_then(|v| v.as_f64()) {
        meta.cfg = cfg as f32;
    } else if let Some(cfg) = root.get("cfg").and_then(|v| v.as_f64()) {
        meta.cfg = cfg as f32;
    }

    if let Some(seed) = root.get("seed").and_then(|v| v.as_i64()) {
        meta.seed = seed;
    }

    if let Some(sampler) = root.get("scheduler").and_then(|s| s.as_str()) {
        meta.sampler = sampler.to_string();
    } else if let Some(sampler) = root.get("sampler_name").and_then(|s| s.as_str()) {
        meta.sampler = sampler.to_string();
    }

    if let Some(model) = root.get("model") {
        if let Some(name) = model.get("model_name").and_then(|s| s.as_str()) {
             meta.model = name.to_string();
        } else if let Some(name) = model.as_str() {
             meta.model = name.to_string();
        }
    }

    // Resources (LoRAs, ControlNets)
    let mut resources = Resources::default();
    scan_for_resources(json, &mut resources);
    
    meta.loras = resources.loras;
    meta.control_nets = resources.control_nets;

    meta
}

pub fn extract_a1111_metadata(text: &str) -> ImageMetadata {
    let sanitized_text = text.replace('\0', "");
    let mut meta = ImageMetadata::default();
    meta.tool = "Automatic1111".to_string();
    meta.raw_parameters = Some(sanitized_text.clone());

    let lines: Vec<&str> = sanitized_text.lines().map(|l| l.trim()).collect();
    if lines.is_empty() {
        return meta;
    }

    let mut positive_parts = Vec::new();
    let mut negative_prompt = String::new();
    let mut params_lines = Vec::new();
    let mut state = 0; // 0: positive, 1: negative, 2: params

    for line in lines {
        if line.starts_with("Negative prompt: ") {
            state = 1;
            negative_prompt.push_str(&line[17..]);
        } else if line.starts_with("Steps: ") {
            state = 2;
            params_lines.push(line.to_string());
        } else if state == 0 {
            positive_parts.push(line);
        } else if state == 1 {
            if !negative_prompt.is_empty() {
                negative_prompt.push(' ');
            }
            negative_prompt.push_str(line);
        } else if state == 2 {
            params_lines.push(line.to_string());
        }
    }

    meta.positive_prompt = positive_parts.join("\n").trim().to_string();
    meta.negative_prompt = negative_prompt.trim().to_string();

    // Parse params (prefer the line starting with Steps:)
    let params_line = params_lines.iter().find(|l| l.starts_with("Steps: ")).cloned().unwrap_or_default();

    if params_line.starts_with("Steps: ") {
        let pairs = params_line.split(", ");
        let mut variation_seed = String::new();
        let mut variation_strength = String::new();

        for pair in pairs {
            if let Some((key, val)) = pair.split_once(": ") {
                let key = key.trim();
                let val = val.trim();
                match key {
                    "Steps" => meta.steps = val.parse().unwrap_or(0),
                    "Sampler" => meta.sampler = val.to_string(),
                    "CFG scale" => meta.cfg = val.parse().unwrap_or(0.0),
                    "Seed" => meta.seed = val.parse().unwrap_or(0),
                    "Model" | "Checkpoint" | "Model name" | "SD model" => meta.model = val.to_string(),
                    "VAE" => meta.vae = Some(val.to_string()),
                    "Clip skip" => meta.clip_skip = val.parse().ok(),
                    "Denoising strength" => meta.denoising_strength = val.parse().ok(),
                    "Hires upscale" => meta.hires_upscale = val.parse().ok(),
                    "Hires steps" => meta.hires_steps = val.parse().ok(),
                    "Hires upscaler" => meta.hires_upscaler = Some(val.to_string()),
                    "Model hash" => meta.model_hash = Some(val.to_string()),
                    "App" => {
                        let low_val = val.to_lowercase();
                        if low_val.contains("sd.next") || low_val.contains("sdnext") {
                            meta.tool = "SD.Next".to_string();
                        } else if low_val.contains("forge") {
                            meta.tool = "Forge".to_string();
                        }
                    }
                    "Version" => {
                        let low_val = val.to_lowercase();
                        if meta.tool == "Automatic1111" {
                             if low_val.contains("vlad") || low_val.contains("next") || low_val.contains("sd.next") {
                                 meta.tool = "SD.Next".to_string();
                             } else if low_val.contains("forge") {
                                 meta.tool = "Forge".to_string();
                             }
                        }
                    },
                    "sd_model_hash" => {
                        if meta.model_hash.is_none() {
                            meta.model_hash = Some(val.to_string());
                        }
                    }
                    "Variation seed" => variation_seed = val.to_string(),
                    "Variation seed strength" => variation_strength = val.to_string(),
                    _ => {
                        // Special handling for ControlNet
                        if key.starts_with("ControlNet") {
                            if let Some(start) = val.find("Model: ") {
                                let model_part = &val[start + 7..];
                                let model_name = model_part.split(',').next().unwrap_or("").trim();
                                if !model_name.is_empty() {
                                    meta.control_nets.push(model_name.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        if !variation_seed.is_empty() && !variation_strength.is_empty() {
            meta.variation_id = Some(format!("{}:{}", variation_seed, variation_strength));
        }
    }

    // Extract LoRAs from positive prompt
    // regex: <lora:([^:>]+)(?::[^>]+)?>
    if let Ok(re) = Regex::new(r"<lora:([^:>]+)(?::[^>]+)?>") {
        for cap in re.captures_iter(&meta.positive_prompt) {
            let lora_name = cap[1].to_string();
            if !meta.loras.contains(&lora_name) {
                meta.loras.push(lora_name);
            }
        }
    }

    meta
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_detect_generation_type() {
        // Standard A1111 paths
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/txt2img-images/image.png")), "txt2img");
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/img2img-images/image.png")), "img2img");
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/extras-images/image.png")), "extras");
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/txt2img-grids/image.png")), "grid");

        // SDNext paths (outputs/...)
        assert_eq!(detect_generation_type(&PathBuf::from("D:/SDNext/outputs/txt2img/2023-10-01/image.png")), "txt2img");
        assert_eq!(detect_generation_type(&PathBuf::from("D:/SDNext/outputs/img2img/2023-10-01/image.png")), "img2img");
        assert_eq!(detect_generation_type(&PathBuf::from("D:/SDNext/outputs/extras/image.png")), "extras");

        // Windows backslashes
        assert_eq!(detect_generation_type(&PathBuf::from("D:\\SDNext\\outputs\\txt2img\\image.png")), "txt2img");
        
        // Unknown
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/random/image.png")), "unknown");
    }

    #[test]
    fn test_extract_a1111_metadata_basic() {
        let raw = "Positive prompt here\nNegative prompt: Negative content\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: v1-5-pruned, Model hash: abcde";
        let meta = extract_a1111_metadata(raw);
        
        assert_eq!(meta.tool, "Automatic1111");
        assert_eq!(meta.positive_prompt, "Positive prompt here");
        assert_eq!(meta.negative_prompt, "Negative content");
        assert_eq!(meta.steps, 20);
        assert_eq!(meta.cfg, 7.0);
        assert_eq!(meta.seed, 12345);
        assert_eq!(meta.model, "v1-5-pruned");
        assert_eq!(meta.model_hash.as_deref(), Some("abcde"));
    }

    #[test]
    fn test_extract_a1111_sdnext_detection() {
        // Test "App" key
        let raw_app = "Prompt\nSteps: 20, App: SD.Next, Version: 1.0";
        let meta_app = extract_a1111_metadata(raw_app);
        assert_eq!(meta_app.tool, "SD.Next");

        // Test "Version" key with "Vlad"
        let raw_vlad = "Prompt\nSteps: 20, Version: Vlad Mandic";
        let meta_vlad = extract_a1111_metadata(raw_vlad);
        assert_eq!(meta_vlad.tool, "SD.Next");

        // Test "Version" key with "Forge"
        let raw_forge = "Prompt\nSteps: 20, Version: forge";
        let meta_forge = extract_a1111_metadata(raw_forge);
        assert_eq!(meta_forge.tool, "Forge");
    }
    
    #[test]
    fn test_extract_loras() {
        let raw = "A beautiful <lora:cool_style:0.8> painting <lora:other_one:1>";
        let meta = extract_a1111_metadata(raw);
        assert!(meta.loras.contains(&"cool_style".to_string()));
        assert!(meta.loras.contains(&"other_one".to_string()));
    }
}
