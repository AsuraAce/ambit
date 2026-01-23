use image::io::Reader;
use image::imageops::FilterType;
use std::path::{Path, PathBuf};
use std::fs;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use base64::{Engine as _, engine::general_purpose::STANDARD};

#[derive(Debug, Clone)]
pub struct ThumbnailResult {
    pub thumbnail_path: String,
    pub micro_thumbnail: Option<String>,
    /// Original image dimensions (width, height).
    /// Only available when thumbnail was freshly generated (not cached).
    pub original_dimensions: Option<(u32, u32)>,
}

pub fn get_thumbnail_path(path: &str, thumbnail_dir: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let thumb_filename = format!("{:016x}.webp", hasher.finish());
    PathBuf::from(thumbnail_dir).join(&thumb_filename)
}

pub fn generate_thumbnail(
    path: &str,
    thumbnail_dir: &str,
) -> Result<ThumbnailResult, String> {
    let thumb_path = get_thumbnail_path(path, thumbnail_dir);
    let mut generated_thumbnail_path = String::new();
    let mut generated_micro_thumbnail: Option<String> = None;
    let mut original_dimensions: Option<(u32, u32)> = None;

    // Ensure directory exists
    if let Err(e) = fs::create_dir_all(thumbnail_dir) {
        return Err(format!("Failed to create thumbnail dir: {}", e));
    }

    if thumb_path.exists() {
        generated_thumbnail_path = thumb_path.to_string_lossy().to_string();
        // Thumbnail cached - dimensions not available without reading original file
        // Scanner will handle this case with a separate dimension read
    } else {
        // Need to generate - we'll capture dimensions from the decoded image
        let reader = Reader::open(path)
            .map_err(|e| format!("Failed to open image: {}", e))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess format: {}", e))?;

        let img = reader.decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?;

        // Capture original dimensions before resizing
        original_dimensions = Some((img.width(), img.height()));

        // 1. Main Thumbnail (512px)
        // Optimization: Use Triangle (Bilinear) instead of CatmullRom (Bicubic/Lanczos) for speed.
        // For downscaling 4K -> 512px, the visual difference is minimal but performance difference is large.
        let thumb = img.resize(512, 512, FilterType::Triangle);
        let rgba = thumb.to_rgba8();
        let (width, height) = rgba.dimensions();
        
        let encoder = webp::Encoder::from_rgba(
            rgba.as_raw(),
            width,
            height
        );
        let webp_data = encoder.encode(85.0);
        
        fs::write(&thumb_path, &*webp_data)
            .map_err(|e| format!("Failed to save thumbnail: {}", e))?;
            
        generated_thumbnail_path = thumb_path.to_string_lossy().to_string();

        // 2. Micro Thumbnail (Disabled)
        // We no longer generate base64 micro-thumbnails to save DB space (~200MB/100k images)
        // generated_micro_thumbnail = Some(...);
    }

    Ok(ThumbnailResult {
        thumbnail_path: generated_thumbnail_path,
        micro_thumbnail: None, // Always returning None now
        original_dimensions,
    })
}

// Special function to generate ONLY micro-thumbnail if needed (e.g. for backfilling)
pub fn generate_micro_thumbnail_only(path: &str) -> Result<String, String> {
    let reader = Reader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess format: {}", e))?;

    let img = reader.decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let micro = img.resize(32, 32, FilterType::Triangle);
    let micro_rgba = micro.to_rgba8();
    let (micro_w, micro_h) = micro_rgba.dimensions();
    
    let micro_encoder = webp::Encoder::from_rgba(
        micro_rgba.as_raw(),
        micro_w,
        micro_h
    );
    let micro_webp = micro_encoder.encode(70.0);
    let micro_b64 = STANDARD.encode(&*micro_webp);
    
    Ok(format!("data:image/webp;base64,{}", micro_b64))
}
