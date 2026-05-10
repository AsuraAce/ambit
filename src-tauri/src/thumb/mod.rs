use image::imageops::FilterType;
use image::io::Reader;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

pub mod optimizer;

#[derive(Debug, Clone)]
pub struct ThumbnailResult {
    pub thumbnail_path: String,
    pub micro_thumbnail: Option<String>,
    /// Original image dimensions (width, height).
    /// Only available when thumbnail was freshly generated (not cached).
    pub original_dimensions: Option<(u32, u32)>,
    /// Whether the destination thumbnail file already existed.
    pub was_cached: bool,
    /// Time spent generating the thumbnail file. Cached hits report 0.
    pub processing_ms: u128,
}

pub fn get_thumbnail_path(path: &str, thumbnail_dir: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    let thumb_filename = format!("{:016x}.webp", hasher.finish());
    PathBuf::from(thumbnail_dir).join(&thumb_filename)
}

pub fn generate_thumbnail(path: &str, thumbnail_dir: &str) -> Result<ThumbnailResult, String> {
    let thumb_path = get_thumbnail_path(path, thumbnail_dir);
    let mut original_dimensions: Option<(u32, u32)> = None;

    // Ensure directory exists
    // Optimization: Check if exists first to avoid syscall/locking on every file in parallel loop
    if !Path::new(thumbnail_dir).exists() {
        if let Err(e) = fs::create_dir_all(thumbnail_dir) {
            return Err(format!("Failed to create thumbnail dir: {}", e));
        }
    }

    let mut was_cached = false;
    let mut processing_ms = 0;

    let generated_thumbnail_path = if thumb_path.exists() {
        // Thumbnail cached - dimensions not available without reading original file
        // Scanner will handle this case with a separate dimension read
        was_cached = true;
        thumb_path.to_string_lossy().to_string()
    } else {
        let generation_started_at = std::time::Instant::now();

        // Need to generate - we'll capture dimensions from the decoded image
        let reader = Reader::open(path)
            .map_err(|e| format!("Failed to open image: {}", e))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess format: {}", e))?;

        let img = reader
            .decode()
            .map_err(|e| format!("Failed to decode image: {}", e))?;

        // Capture original dimensions before resizing
        original_dimensions = Some((img.width(), img.height()));

        // 1. Main Thumbnail (512px)
        // Optimization: Use Triangle (Bilinear) instead of CatmullRom (Bicubic/Lanczos) for speed.
        // For downscaling 4K -> 512px, the visual difference is minimal but performance difference is large.
        let thumb = img.resize(512, 512, FilterType::Triangle);
        let rgba = thumb.to_rgba8();
        let (width, height) = rgba.dimensions();

        let encoder = webp::Encoder::from_rgba(rgba.as_raw(), width, height);
        let webp_data = encoder.encode(85.0);

        fs::write(&thumb_path, &*webp_data)
            .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

        processing_ms = generation_started_at.elapsed().as_millis();

        thumb_path.to_string_lossy().to_string()
    };

    // 2. Micro Thumbnail (Disabled)
    // We no longer generate base64 micro-thumbnails to save DB space (~200MB/100k images)
    // generated_micro_thumbnail = Some(...);

    Ok(ThumbnailResult {
        thumbnail_path: generated_thumbnail_path,
        micro_thumbnail: None, // Always returning None now
        original_dimensions,
        was_cached,
        processing_ms,
    })
}
