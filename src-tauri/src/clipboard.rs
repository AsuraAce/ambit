//! Copies a library image to the OS clipboard as pixels.
//!
//! The webview cannot do this itself: WebView2's async clipboard accepts only
//! PNG blobs, and the asset URL fetch is outside the CSP. So the original is
//! decoded here and written through the clipboard-manager plugin's Rust API.
//! No clipboard IPC permission is granted to the webview.

use crate::scanner::utils::{
    open_configured_app_db, path_is_known_media_file, resolve_existing_regular_file,
};
use image::{DynamicImage, ImageDecoder, ImageReader, RgbaImage};
use rusqlite::Connection;
use std::path::Path;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
#[specta::specta]
pub async fn copy_image_to_clipboard(app: tauri::AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_configured_app_db(&app)?;
        let rgba = load_library_image_rgba(&conn, &path)?;
        let (width, height) = rgba.dimensions();
        let image = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
        app.clipboard()
            .write_image(&image)
            .map_err(|e| format!("Failed to write the image to the clipboard: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Decodes `path` only when it is a file the library tracks, so the webview
/// cannot make Ambit read an arbitrary file through the clipboard.
/// Shown after "Couldn't copy the image: " when the scope check refuses a file.
const NOT_IN_LIBRARY: &str = "it is no longer in your library.";

/// Decodes `path` only when it is a file the library tracks (the same rule as
/// Open in Default App), so the webview cannot make Ambit read an arbitrary
/// file through the clipboard.
fn load_library_image_rgba(conn: &Connection, path: &str) -> Result<RgbaImage, String> {
    let target = resolve_existing_regular_file(path)?;
    if !path_is_known_media_file(conn, path, &target)? {
        return Err(NOT_IN_LIBRARY.to_string());
    }
    decode_rgba(&target)
}

fn decode_rgba(path: &Path) -> Result<RgbaImage, String> {
    let mut decoder = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image format: {e}"))?
        .into_decoder()
        .map_err(|e| format!("Unsupported image format: {e}"))?;
    let orientation = decoder
        .orientation()
        .map_err(|e| format!("Failed to read image orientation: {e}"))?;
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|e| format!("Failed to decode image: {e}"))?;
    image.apply_orientation(orientation);
    Ok(image.into_rgba8())
}

#[cfg(test)]
mod tests {
    use super::{load_library_image_rgba, NOT_IN_LIBRARY};
    use image::{ImageFormat, Rgba, RgbaImage};
    use rusqlite::Connection;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn library_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        for migration in crate::db::migrations::get_migrations() {
            conn.execute_batch(migration.sql)
                .unwrap_or_else(|e| panic!("migration {}: {e}", migration.version));
        }
        conn
    }

    fn track(conn: &Connection, path: &Path) {
        let normalized = fs::canonicalize(path)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        conn.execute(
            "INSERT INTO images (id, path, timestamp) VALUES (?1, ?1, 0)",
            [&normalized],
        )
        .unwrap();
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ambit_clipboard_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample() -> RgbaImage {
        RgbaImage::from_pixel(3, 2, Rgba([200, 40, 10, 255]))
    }

    #[test]
    fn copies_pixels_of_tracked_png_jpeg_and_webp_originals() {
        let dir = temp_dir("formats");
        let conn = library_db();
        for (name, format) in [
            ("a.png", ImageFormat::Png),
            ("b.jpg", ImageFormat::Jpeg),
            ("c.webp", ImageFormat::WebP),
        ] {
            let path = dir.join(name);
            let pixels = image::DynamicImage::ImageRgba8(sample());
            let pixels = if format == ImageFormat::Jpeg {
                image::DynamicImage::ImageRgb8(pixels.to_rgb8())
            } else {
                pixels
            };
            pixels.save_with_format(&path, format).unwrap();
            track(&conn, &path);

            let rgba = load_library_image_rgba(&conn, &path.to_string_lossy())
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(rgba.dimensions(), (3, 2), "{name}");
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_an_image_the_library_does_not_track() {
        // A valid image outside the library must not be readable through the
        // clipboard command, or the webview could exfiltrate any file's pixels.
        let dir = temp_dir("untracked");
        let conn = library_db();
        let path = dir.join("outside.png");
        sample().save_with_format(&path, ImageFormat::Png).unwrap();

        assert_eq!(
            load_library_image_rgba(&conn, &path.to_string_lossy()),
            Err(NOT_IN_LIBRARY.to_string()),
            "the scope check, not decoding, must refuse the file"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reports_an_error_for_a_tracked_file_that_is_not_an_image() {
        let dir = temp_dir("not_image");
        let conn = library_db();
        let path = dir.join("clip.mp4");
        fs::write(&path, b"not an image").unwrap();
        track(&conn, &path);

        assert!(load_library_image_rgba(&conn, &path.to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
