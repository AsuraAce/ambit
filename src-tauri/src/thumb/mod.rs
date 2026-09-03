use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageReader};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

pub mod optimizer;

pub const CURRENT_THUMBNAIL_VERSION: u32 = 2;

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

fn inactive_thumbnail_path(canonical_path: &Path) -> PathBuf {
    let mut file_name = canonical_path
        .file_stem()
        .unwrap_or_default()
        .to_os_string();
    file_name.push(".replacement.webp");
    canonical_path.with_file_name(file_name)
}

fn same_thumbnail_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .replace('\\', "/")
            .eq_ignore_ascii_case(&right.to_string_lossy().replace('\\', "/"))
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn managed_thumbnail_path(
    canonical_path: &Path,
    current_thumbnail_path: Option<&str>,
) -> Option<PathBuf> {
    let current_path = Path::new(current_thumbnail_path?);
    let inactive_path = inactive_thumbnail_path(canonical_path);
    (same_thumbnail_path(current_path, canonical_path)
        || same_thumbnail_path(current_path, &inactive_path))
    .then(|| current_path.to_path_buf())
}

fn thumbnail_write_path(
    canonical_path: &Path,
    current_thumbnail_path: Option<&Path>,
    force: bool,
) -> PathBuf {
    if force
        && current_thumbnail_path
            .is_some_and(|current| same_thumbnail_path(current, canonical_path))
    {
        inactive_thumbnail_path(canonical_path)
    } else {
        canonical_path.to_path_buf()
    }
}
pub fn generate_thumbnail(path: &str, thumbnail_dir: &str) -> Result<ThumbnailResult, String> {
    generate_thumbnail_for_repair(path, thumbnail_dir, false, None)
}

pub(crate) fn generate_thumbnail_for_repair(
    path: &str,
    thumbnail_dir: &str,
    force: bool,
    current_thumbnail_path: Option<&str>,
) -> Result<ThumbnailResult, String> {
    let canonical_thumb_path = get_thumbnail_path(path, thumbnail_dir);
    let current_managed_path =
        managed_thumbnail_path(&canonical_thumb_path, current_thumbnail_path);
    let thumb_path = thumbnail_write_path(
        &canonical_thumb_path,
        current_managed_path.as_deref(),
        force,
    );
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

    let cached_thumbnail_path = current_managed_path
        .as_ref()
        .filter(|path| path.exists())
        .unwrap_or(&canonical_thumb_path);
    let generated_thumbnail_path = if cached_thumbnail_path.exists() && !force {
        // Thumbnail cached - dimensions not available without reading original file
        // Scanner will handle this case with a separate dimension read
        was_cached = true;
        cached_thumbnail_path.to_string_lossy().to_string()
    } else {
        let generation_started_at = std::time::Instant::now();

        // Need to generate - we'll capture dimensions from the decoded image
        let reader = ImageReader::open(path)
            .map_err(|e| format!("Failed to open image: {}", e))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to guess format: {}", e))?;

        let mut decoder = reader
            .into_decoder()
            .map_err(|e| format!("Failed to initialize image decoder: {}", e))?;
        let orientation = decoder
            .orientation()
            .map_err(|e| format!("Failed to read image orientation: {}", e))?;
        let mut img = DynamicImage::from_decoder(decoder)
            .map_err(|e| format!("Failed to decode image: {}", e))?;
        img.apply_orientation(orientation);

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
            .map_err(|error| format!("Failed to save thumbnail: {error}"))?;

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

pub fn oriented_dimensions(dimensions: (u32, u32), orientation: Option<u8>) -> (u32, u32) {
    if matches!(orientation, Some(5..=8)) {
        (dimensions.1, dimensions.0)
    } else {
        dimensions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, ImageBuffer, Rgba};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn orientation_exif_payload(orientation: u16) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(b"Exif\0\0II");
        payload.extend_from_slice(&0x2Au16.to_le_bytes());
        payload.extend_from_slice(&8u32.to_le_bytes());
        payload.extend_from_slice(&1u16.to_le_bytes());
        payload.extend_from_slice(&0x0112u16.to_le_bytes());
        payload.extend_from_slice(&3u16.to_le_bytes());
        payload.extend_from_slice(&1u32.to_le_bytes());
        payload.extend_from_slice(&orientation.to_le_bytes());
        payload.extend_from_slice(&[0, 0]);
        payload.extend_from_slice(&0u32.to_le_bytes());
        payload
    }

    fn jpeg_with_orientation(width: u32, height: u32, orientation: u16) -> Vec<u8> {
        let image = image::RgbImage::from_pixel(width, height, image::Rgb([8, 16, 24]));
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&image)
            .expect("encode jpeg");
        let exif = orientation_exif_payload(orientation);

        let mut result = Vec::new();
        result.extend_from_slice(&jpeg[..2]);
        result.extend_from_slice(&[0xFF, 0xE1]);
        result.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        result.extend_from_slice(&exif);
        result.extend_from_slice(&jpeg[2..]);
        result
    }

    #[test]
    fn generated_thumbnail_applies_exif_orientation_before_sizing() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ambit_thumb_orientation_{nonce}"));
        let source = root.join("source.jpg");
        let cache = root.join("cache");
        fs::create_dir_all(&root).expect("create temp root");
        fs::write(&source, jpeg_with_orientation(2, 1, 6)).expect("write source");

        let result = generate_thumbnail(
            source.to_string_lossy().as_ref(),
            cache.to_string_lossy().as_ref(),
        )
        .expect("generate thumbnail");
        let thumbnail = image::open(&result.thumbnail_path).expect("open thumbnail");

        assert_eq!(result.original_dimensions, Some((1, 2)));
        assert_eq!(thumbnail.dimensions(), (256, 512));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn force_regeneration_alternates_between_two_inactive_thumbnail_slots() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("ambit_force_thumbnail_{nonce}"));
        fs::create_dir_all(&temp_dir).expect("temp directory");
        let source_path = temp_dir.join("source.png");
        let thumbnail_dir = temp_dir.join("thumbs");
        ImageBuffer::from_pixel(8, 8, Rgba([255_u8, 0, 0, 255]))
            .save(&source_path)
            .expect("source image");

        let first = generate_thumbnail(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail path"),
        )
        .expect("initial thumbnail");
        fs::write(&first.thumbnail_path, b"stale").expect("replace thumbnail with stale bytes");

        let cached = generate_thumbnail(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail path"),
        )
        .expect("cached thumbnail");
        assert!(cached.was_cached);
        assert_eq!(
            fs::read(&cached.thumbnail_path).expect("cached bytes"),
            b"stale"
        );

        let regenerated = generate_thumbnail_for_repair(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail path"),
            true,
            Some(&first.thumbnail_path),
        )
        .expect("forced thumbnail");
        assert!(!regenerated.was_cached);
        assert_ne!(regenerated.thumbnail_path, first.thumbnail_path);
        assert_eq!(
            fs::read(&first.thumbnail_path).expect("preserved active bytes"),
            b"stale"
        );
        assert_ne!(
            fs::read(&regenerated.thumbnail_path).expect("regenerated bytes"),
            b"stale"
        );
        fs::write(&regenerated.thumbnail_path, b"active-replacement")
            .expect("replacement slot fixture");
        let cached_replacement = generate_thumbnail_for_repair(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail path"),
            false,
            Some(&regenerated.thumbnail_path),
        )
        .expect("reuse active replacement slot");
        assert!(cached_replacement.was_cached);
        assert_eq!(
            cached_replacement.thumbnail_path,
            regenerated.thumbnail_path
        );

        let regenerated_again = generate_thumbnail_for_repair(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail path"),
            true,
            Some(&regenerated.thumbnail_path),
        )
        .expect("second forced thumbnail");
        assert_eq!(regenerated_again.thumbnail_path, first.thumbnail_path);
        assert_eq!(
            fs::read(&regenerated.thumbnail_path).expect("preserved replacement bytes"),
            b"active-replacement"
        );
        fs::remove_dir_all(temp_dir).expect("clean up test directory");
    }

    #[cfg(windows)]
    #[test]
    fn force_regeneration_preserves_existing_thumbnail_when_inactive_slot_write_fails() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_SHARE_READ: u32 = 0x0000_0001;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("ambit_force_thumbnail_failure_{nonce}"));
        fs::create_dir_all(&temp_dir).expect("temp directory");
        let source_path = temp_dir.join("source.png");
        let thumbnail_dir = temp_dir.join("thumbs");
        ImageBuffer::from_pixel(8, 8, Rgba([0_u8, 255, 0, 255]))
            .save(&source_path)
            .expect("source image");

        let existing = generate_thumbnail(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail path"),
        )
        .expect("initial thumbnail");
        fs::write(&existing.thumbnail_path, b"known-good-thumbnail")
            .expect("replace thumbnail with known bytes");

        let inactive_path = inactive_thumbnail_path(Path::new(&existing.thumbnail_path));
        fs::write(&inactive_path, b"inactive-slot").expect("inactive slot fixture");
        let destination_lock = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&inactive_path)
            .expect("lock inactive slot against writing");

        let error = generate_thumbnail_for_repair(
            source_path.to_str().expect("source path"),
            thumbnail_dir.to_str().expect("thumbnail path"),
            true,
            Some(&existing.thumbnail_path),
        )
        .expect_err("locked inactive slot must reject generation");
        assert!(
            error.contains("save thumbnail"),
            "unexpected error: {error}"
        );
        assert_eq!(
            fs::read(&existing.thumbnail_path).expect("preserved thumbnail bytes"),
            b"known-good-thumbnail"
        );

        drop(destination_lock);
        fs::remove_dir_all(temp_dir).expect("clean up test directory");
    }
}
