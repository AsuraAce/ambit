use super::models::ScanResult;
use crate::metadata;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

pub fn scan_image_internal(
    path: String,
    thumbnail_dir: Option<String>,
    skip_thumbnail: bool,
    extract_workflow: bool,
    default_tool: Option<String>,
) -> Result<ScanResult, String> {
    // println!("[Scan] Starting: {}", path);
    // println!("[Scan] Starting: {}", path);

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

    // Try to read dimensions - if this fails, we may still be able to return a cached thumbnail
    // Optimization: When generating a thumbnail, we capture dimensions from that decode,
    // avoiding a second file open.

    let mut generated_thumbnail_path = String::new();
    let mut generated_micro_thumbnail: Option<String> = None;
    let mut dimensions: (u32, u32) = (0, 0);
    let mut thumbnail_error: Option<String> = None;

    // Handle thumbnail generation/lookup
    if let Some(dir) = &thumbnail_dir {
        if !skip_thumbnail {
            // Check if thumbnail already exists
            let thumb_path = crate::thumb::get_thumbnail_path(&path, dir);

            if thumb_path.exists() {
                generated_thumbnail_path = thumb_path.to_string_lossy().to_string();
                // Thumbnail cached - will need to read dimensions separately below
            } else {
                // Need to generate - dimensions will come from the decode
                match crate::thumb::generate_thumbnail(&path, dir) {
                    Ok(result) => {
                        generated_thumbnail_path = result.thumbnail_path;
                        generated_micro_thumbnail = result.micro_thumbnail;

                        // Use dimensions from thumbnail generation (avoids second file open)
                        if let Some(dims) = result.original_dimensions {
                            dimensions = dims;
                        }
                    }
                    Err(e) => {
                        // Log failure but don't fail the scan
                        println!("[Thumb] Failed to generate thumbnail: {}", e);
                        thumbnail_error = Some(e.to_string());
                    }
                }
            }
        }
    }

    // Only read dimensions if we didn't get them from thumbnail generation
    if dimensions == (0, 0) {
        let dimensions_result = image::io::Reader::open(&path)
            .and_then(|r| r.with_guessed_format())
            .map_err(|e| e.to_string())
            .and_then(|r| r.into_dimensions().map_err(|e| e.to_string()));

        dimensions = match dimensions_result {
            Ok(dims) => dims,
            Err(e) => {
                // If we have a thumbnail, return a partial result instead of failing completely
                if !generated_thumbnail_path.is_empty() {
                    return Ok(ScanResult {
                        width: 0,
                        height: 0,
                        size,
                        modified,
                        thumbnail: generated_thumbnail_path,
                        micro_thumbnail: generated_micro_thumbnail,
                        thumbnail_source: Some("ambit".to_string()),
                        chunks: HashMap::new(),
                        metadata: None,
                        error: Some(format!("Failed to read image dimensions: {}", e)),
                    });
                }
                // No thumbnail and no dimensions - this is a real failure
                return Err(format!("Failed to read image dimensions: {}", e));
            }
        };
    }

    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let mut buffer = [0; 8];
    let _ = file.read_exact(&mut buffer);

    let is_png = buffer == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    let is_jpg = buffer[0..2] == [0xFF, 0xD8];
    let mut chunks = HashMap::new();

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
    if let Some(params) = chunks
        .get("parameters")
        .or_else(|| chunks.get("Parameters"))
        .or_else(|| chunks.get("PARAMETERS"))
    {
        parsed_metadata = metadata::extract_a1111_metadata(params, default_tool.clone());
        found_metadata = true;
    }

    // 2. InvokeAI (Cumulative Merge & Tool Finalization)
    if let Some(content) = chunks
        .get("invokeai_metadata")
        .or_else(|| chunks.get("sd-metadata"))
        .or_else(|| chunks.get("dream_metadata"))
    {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
            let invoke_meta = metadata::extract_invokeai_metadata(&json);
            metadata::merge_metadata(&mut parsed_metadata, invoke_meta);
            // Finalize tool label: InvokeAI chunks exist, so it's an InvokeAI generation
            parsed_metadata.tool = "InvokeAI".to_string();
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

    if let Some(workflow) = chunks
        .get("graph")
        .or_else(|| chunks.get("invokeai_workflow"))
        .or_else(|| chunks.get("invokeai_graph"))
    {
        parsed_metadata.workflow_json = Some(workflow.clone());
        // These chunk names are InvokeAI-specific, set tool if not already set by specific parser
        if parsed_metadata.tool.is_empty() || parsed_metadata.tool == "Automatic1111" {
            parsed_metadata.tool = "InvokeAI".to_string();
        }
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

    // 4. XMP Metadata (Subject: Favorite) - Common in older InvokeAI / other tools
    if !parsed_metadata.is_favorite {
        if let Some(xmp) = chunks.get("XML:com.adobe.xmp") {
            // Optimization: First check if "favorite" exists at all to avoid Regex overhead
            if xmp.contains("favorite") {
                // Pattern matches <rdf:li>favorite</rdf:li> with optional whitespace handling
                // This covers standard XMP Bag/Seq array items
                if let Ok(re) = regex::Regex::new(r"<\s*rdf:li\s*>\s*favorite\s*<\s*/\s*rdf:li\s*>")
                {
                    if re.is_match(xmp) {
                        parsed_metadata.is_favorite = true;
                        found_metadata = true;
                    }
                }
            }
        }
    }

    // Check for Legacy Favorite tag in generic chunks (Subject, Keywords, Description)
    // Common in XMP/IPTC or standard PNG chunks used by older managers
    if !parsed_metadata.is_favorite {
        let is_fav = chunks
            .get("Subject")
            .or_else(|| chunks.get("Keywords"))
            .or_else(|| chunks.get("Description"))
            .map(|s| s.to_lowercase().contains("favorite"))
            .unwrap_or(false);

        if is_fav {
            parsed_metadata.is_favorite = true;
            // Ensure we consider metadata found if we found a favorite tag,
            // so that the metadata object (and thus the flag) is returned.
            found_metadata = true;
        }
    }

    let chunks_to_return = if parsed_metadata.workflow_json.is_some() {
        HashMap::new()
    } else {
        chunks
    };

    let metadata_obj = if found_metadata {
        Some(parsed_metadata)
    } else {
        None
    };

    let has_thumbnail = !generated_thumbnail_path.is_empty();

    Ok(ScanResult {
        width: dimensions.0,
        height: dimensions.1,
        size,
        modified,
        thumbnail: if has_thumbnail {
            generated_thumbnail_path
        } else {
            String::new()
        },
        micro_thumbnail: generated_micro_thumbnail,
        thumbnail_source: if has_thumbnail {
            Some("ambit".to_string())
        } else {
            None
        },
        chunks: chunks_to_return,
        metadata: metadata_obj,
        error: thumbnail_error,
    })
}

pub fn scan_image_workflow(path: String) -> Result<Option<String>, String> {
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
    if let Some(workflow) = chunks
        .get("invokeai_workflow")
        .or_else(|| chunks.get("workflow"))
        .or_else(|| chunks.get("invokeai_graph"))
        .or_else(|| chunks.get("graph"))
    {
        return Ok(Some(workflow.clone()));
    }

    // 2. Fallback to Metadata Chunks
    if let Some(content) = chunks
        .get("invokeai_metadata")
        .or_else(|| chunks.get("sd-metadata"))
        .or_else(|| chunks.get("dream_metadata"))
    {
        return Ok(Some(content.clone()));
    }

    Ok(None)
}

pub fn read_image_metadata(
    path: String,
    default_tool: Option<String>,
) -> Result<metadata::ImageMetadata, String> {
    let path_obj = std::path::Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    let file = File::open(path_obj).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let chunks = metadata::extract_png_chunks(&mut reader)?;

    let mut parsed_metadata = metadata::ImageMetadata::default();

    // 1. A1111/Forge (Compatibility)
    if let Some(params) = chunks
        .get("parameters")
        .or_else(|| chunks.get("Parameters"))
    {
        parsed_metadata = metadata::extract_a1111_metadata(params, default_tool.clone());
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
        text_data.extend_from_slice(
            b"Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 12345, Model: test-model",
        );

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

    #[test]
    fn test_scan_image_internal_xmp_favorite() {
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // Header

        // IHDR
        let mut ihdr_data = Vec::new();
        ihdr_data.extend_from_slice(b"IHDR");
        ihdr_data.extend_from_slice(&1u32.to_be_bytes());
        ihdr_data.extend_from_slice(&1u32.to_be_bytes());
        ihdr_data.extend_from_slice(&[1, 0, 0, 0, 0]);

        png.extend_from_slice(&13u32.to_be_bytes());
        let crc = crc32(&ihdr_data);
        png.extend_from_slice(&ihdr_data);
        png.extend_from_slice(&crc.to_be_bytes());

        // iTXt chunk: XML:com.adobe.xmp
        let keyword = b"XML:com.adobe.xmp";
        let xmp_content = b"<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'><rdf:Description rdf:about=''><dc:subject><rdf:Bag><rdf:li>favorite</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>";

        let mut text_data = Vec::new();
        text_data.extend_from_slice(keyword);
        text_data.push(0); // null sep
        text_data.push(0); // compression flag
        text_data.push(0); // compression method
        text_data.push(0); // lang tag empty
        text_data.push(0); // trans msg empty
        text_data.extend_from_slice(xmp_content);

        png.extend_from_slice(&(text_data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"iTXt");
        png.extend_from_slice(&text_data);
        let text_crc = crc32(&text_data);
        png.extend_from_slice(&text_crc.to_be_bytes());

        // IDAT
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IDAT");
        png.extend_from_slice(&crc32(b"IDAT").to_be_bytes());

        // IEND
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&0xAE426082u32.to_be_bytes());

        let test_path = "test_xmp_fav.png";
        let mut f = File::create(test_path).unwrap();
        f.write_all(&png).unwrap();

        let result = scan_image_internal(test_path.to_string(), None, true, true, None).unwrap();
        let _ = std::fs::remove_file(test_path);

        let metadata = result.metadata.expect("Metadata should exist");
        assert!(metadata.is_favorite);
    }
}
