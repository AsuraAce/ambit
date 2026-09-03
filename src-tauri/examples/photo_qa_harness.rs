use exif::experimental::Writer;
use exif::{Field, In, Rational, Tag, Value};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ExtendedColorType, ImageBuffer, ImageFormat, Rgb, Rgba};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

const MANIFEST_NAME: &str = "manifest.json";
const CURRENT_PHOTO_REFRESH_VERSION: i64 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    entries: Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    relative_path: String,
    expected_kind: String,
    expected_import: bool,
    width: u32,
    height: u32,
    display_width: u32,
    display_height: u32,
    sha256: String,
}

fn main() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("generate") => {
            let root = required_path(args.next(), "corpus root")?;
            ensure_corpus_root(&root)?;
            generate(&root)
        }
        Some("mark-legacy") => {
            let db = required_path(args.next(), "QA database")?;
            let root = required_path(args.next(), "corpus root")?;
            ensure_qa_database(&db)?;
            mark_legacy(&db, &root)
        }
        Some("verify") => {
            let db = required_path(args.next(), "QA database")?;
            let root = required_path(args.next(), "corpus root")?;
            let phase = args.next().unwrap_or_else(|| "report".to_string());
            ensure_qa_database(&db)?;
            verify(&db, &root, &phase)
        }
        _ => Err(
            "usage: photo_qa_harness <generate ROOT|mark-legacy DB ROOT|verify DB ROOT [PHASE]>"
                .to_string(),
        ),
    }
}

fn required_path(value: Option<String>, label: &str) -> Result<PathBuf, String> {
    value
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing {label}"))
}

fn ensure_corpus_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute()
        || root.file_name().and_then(|name| name.to_str()) != Some("ambit-photo-qa")
    {
        return Err(format!(
            "refusing corpus operation outside an absolute ambit-photo-qa directory: {}",
            root.display()
        ));
    }
    Ok(())
}

fn ensure_qa_database(db: &Path) -> Result<(), String> {
    let is_images_db = db.file_name().and_then(|name| name.to_str()) == Some("images.db");
    let is_qa_profile = db
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        == Some("com.ambit.qa");
    if !db.is_absolute() || !is_images_db || !is_qa_profile {
        return Err(format!(
            "refusing database operation outside the exact com.ambit.qa/images.db profile: {}",
            db.display()
        ));
    }
    Ok(())
}

fn ascii(tag: Tag, value: &str) -> Field {
    let mut bytes = value.as_bytes().to_vec();
    bytes.push(0);
    Field {
        tag,
        ifd_num: In::PRIMARY,
        value: Value::Ascii(vec![bytes]),
    }
}

fn short(tag: Tag, value: u16) -> Field {
    Field {
        tag,
        ifd_num: In::PRIMARY,
        value: Value::Short(vec![value]),
    }
}

fn rational(tag: Tag, numerator: u32, denominator: u32) -> Field {
    Field {
        tag,
        ifd_num: In::PRIMARY,
        value: Value::Rational(vec![Rational {
            num: numerator,
            denom: denominator,
        }]),
    }
}

fn rationals(tag: Tag, values: &[(u32, u32)]) -> Field {
    Field {
        tag,
        ifd_num: In::PRIMARY,
        value: Value::Rational(
            values
                .iter()
                .map(|(num, denom)| Rational {
                    num: *num,
                    denom: *denom,
                })
                .collect(),
        ),
    }
}

fn jpeg_with_exif(fields: &[Field]) -> Result<Vec<u8>, String> {
    let pixels = [
        255, 30, 30, 30, 255, 30, 30, 30, 255, 255, 255, 30, 30, 255, 255, 255, 30, 255,
    ];
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, 95)
        .encode(&pixels, 3, 2, ExtendedColorType::Rgb8)
        .map_err(|error| error.to_string())?;

    let mut writer = Writer::new();
    for field in fields {
        writer.push_field(field);
    }
    let mut exif = Cursor::new(Vec::new());
    writer
        .write(&mut exif, true)
        .map_err(|error| error.to_string())?;

    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend_from_slice(&exif.into_inner());
    let segment_length = u16::try_from(app1.len() + 2)
        .map_err(|_| "generated EXIF segment is too large".to_string())?;
    let mut result = Vec::with_capacity(jpeg.len() + app1.len() + 4);
    result.extend_from_slice(&jpeg[..2]);
    result.extend_from_slice(&[0xff, 0xe1]);
    result.extend_from_slice(&segment_length.to_be_bytes());
    result.extend_from_slice(&app1);
    result.extend_from_slice(&jpeg[2..]);
    Ok(result)
}

fn generate(root: &Path) -> Result<(), String> {
    if root.exists() {
        return Err(format!(
            "corpus root already exists; run the guarded cleanup first: {}",
            root.display()
        ));
    }
    fs::create_dir_all(root).map_err(|error| error.to_string())?;

    write(
        root,
        "photo-rich-orientation-6.jpg",
        &jpeg_with_exif(&[
            ascii(Tag::DateTimeOriginal, "2026:07:29 14:15:16"),
            ascii(Tag::OffsetTimeOriginal, "+02:00"),
            ascii(Tag::Make, "Ambit Camera Co"),
            ascii(Tag::Model, "QA One"),
            ascii(Tag::LensModel, "Ambit 50mm"),
            rational(Tag::FNumber, 14, 10),
            rational(Tag::ExposureTime, 1, 125),
            short(Tag::PhotographicSensitivity, 800),
            short(Tag::FocalLengthIn35mmFilm, 50),
            short(Tag::Orientation, 6),
            ascii(Tag::Artist, "Ambit QA"),
            ascii(Tag::Copyright, "Local fixture"),
            ascii(Tag::GPSLatitudeRef, "N"),
            rationals(Tag::GPSLatitude, &[(52, 1), (30, 1), (0, 1)]),
            ascii(Tag::GPSLongitudeRef, "E"),
            rationals(Tag::GPSLongitude, &[(13, 1), (24, 1), (0, 1)]),
        ])?,
    )?;
    write(
        root,
        "photo-no-offset.jpg",
        &jpeg_with_exif(&[
            ascii(Tag::DateTimeOriginal, "2026:07:28 09:10:11"),
            ascii(Tag::Make, "Ambit Camera Co"),
            ascii(Tag::Model, "QA Two"),
            short(Tag::Orientation, 1),
        ])?,
    )?;
    write(
        root,
        "photo-gps-orientation-1.jpg",
        &jpeg_with_exif(&[
            ascii(Tag::DateTimeOriginal, "2026:07:27 08:00:00"),
            ascii(Tag::OffsetTimeOriginal, "+02:00"),
            ascii(Tag::Make, "Ambit Camera Co"),
            ascii(Tag::Model, "QA Three"),
            short(Tag::Orientation, 1),
            ascii(Tag::GPSLatitudeRef, "S"),
            rationals(Tag::GPSLatitude, &[(33, 1), (52, 1), (0, 1)]),
            ascii(Tag::GPSLongitudeRef, "E"),
            rationals(Tag::GPSLongitude, &[(151, 1), (12, 1), (0, 1)]),
        ])?,
    )?;
    write(
        root,
        "generated-with-camera-exif.jpg",
        &jpeg_with_exif(&[
            ascii(Tag::Make, "Ambit Camera Co"),
            ascii(Tag::Model, "QA Synthetic"),
            ascii(
                Tag::ImageDescription,
                "parameters: QA generated image\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42, Model: qa-model",
            ),
        ])?,
    )?;

    let png = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(3, 2, Rgba([30, 80, 160, 255])));
    png.save_with_format(root.join("metadata-free.png"), ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    png.save_with_format(root.join("metadata-free.webp"), ImageFormat::WebP)
        .map_err(|error| error.to_string())?;
    fs::write(root.join("malformed.jpg"), b"not a valid JPEG")
        .map_err(|error| error.to_string())?;

    let reference = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([18, 18, 24])));
    for index in 0..1_050 {
        reference
            .save_with_format(
                root.join(format!("reference-{index:04}.png")),
                ImageFormat::Png,
            )
            .map_err(|error| error.to_string())?;
    }

    let mut entries = Vec::with_capacity(1_057);
    for (name, kind, imported, width, height, display_width, display_height) in [
        (
            "photo-rich-orientation-6.jpg",
            "photograph",
            true,
            3,
            2,
            2,
            3,
        ),
        ("photo-no-offset.jpg", "photograph", true, 3, 2, 3, 2),
        (
            "photo-gps-orientation-1.jpg",
            "photograph",
            true,
            3,
            2,
            3,
            2,
        ),
        (
            "generated-with-camera-exif.jpg",
            "generated",
            true,
            3,
            2,
            3,
            2,
        ),
        ("metadata-free.png", "other", true, 3, 2, 3, 2),
        ("metadata-free.webp", "other", true, 3, 2, 3, 2),
        ("malformed.jpg", "other", false, 0, 0, 0, 0),
    ] {
        entries.push(manifest_entry(
            root,
            name,
            kind,
            imported,
            (width, height),
            (display_width, display_height),
        )?);
    }
    for index in 0..1_050 {
        entries.push(manifest_entry(
            root,
            &format!("reference-{index:04}.png"),
            "other",
            true,
            (2, 2),
            (2, 2),
        )?);
    }
    let manifest = Manifest {
        format: "ambit-photo-qa/v1".to_string(),
        entries,
    };
    fs::write(
        root.join(MANIFEST_NAME),
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    println!(
        "Generated {} corpus entries at {}",
        manifest.entries.len(),
        root.display()
    );
    Ok(())
}

fn write(root: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    fs::write(root.join(name), bytes).map_err(|error| error.to_string())
}

fn manifest_entry(
    root: &Path,
    name: &str,
    kind: &str,
    imported: bool,
    dimensions: (u32, u32),
    display_dimensions: (u32, u32),
) -> Result<ManifestEntry, String> {
    Ok(ManifestEntry {
        relative_path: name.to_string(),
        expected_kind: kind.to_string(),
        expected_import: imported,
        width: dimensions.0,
        height: dimensions.1,
        display_width: display_dimensions.0,
        display_height: display_dimensions.1,
        sha256: sha256(&root.join(name))?,
    })
}

fn sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn mark_legacy(db: &Path, root: &Path) -> Result<(), String> {
    ensure_corpus_root(root)?;
    let conn = Connection::open(db).map_err(|error| error.to_string())?;
    let prefix = normalized_prefix(root);
    let changed = conn
        .execute(
            "UPDATE images
             SET detected_source_kind = 'other',
                 source_kind = COALESCE(source_kind_override, 'other'),
                 photo_metadata_json = NULL,
                 capture_wall_time_ms = NULL,
                 display_timestamp = timestamp,
                 photo_refresh_version = 0
             WHERE LOWER(REPLACE(path, '\\', '/')) LIKE ?1
               AND detected_source_kind != 'generated'",
            [format!("{prefix}%")],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1_055 {
        return Err(format!(
            "expected to mark 1055 non-generated QA rows legacy, changed {changed}"
        ));
    }
    println!("Marked {changed} isolated QA rows as legacy photo metadata");
    Ok(())
}

fn verify(db: &Path, root: &Path, phase: &str) -> Result<(), String> {
    ensure_corpus_root(root)?;
    let manifest: Manifest = serde_json::from_slice(
        &fs::read(root.join(MANIFEST_NAME)).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    for entry in &manifest.entries {
        let actual = sha256(&root.join(&entry.relative_path))?;
        if actual != entry.sha256 {
            return Err(format!("source hash changed: {}", entry.relative_path));
        }
    }

    let conn = Connection::open(db).map_err(|error| error.to_string())?;
    let prefix = normalized_prefix(root);
    let pattern = format!("{prefix}%");
    let mut counts = BTreeMap::<String, usize>::new();
    let mut pending = 0usize;
    {
        let mut statement = conn
            .prepare(
                "SELECT source_kind, photo_refresh_version
                 FROM images
                 WHERE is_deleted = 0
                   AND LOWER(REPLACE(path, '\\', '/')) LIKE ?1",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([&pattern], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (kind, version) = row.map_err(|error| error.to_string())?;
            *counts.entry(kind.clone()).or_default() += 1;
            if kind != "generated" && version < CURRENT_PHOTO_REFRESH_VERSION {
                pending += 1;
            }
        }
    }
    let active: usize = counts.values().sum();
    let removed: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM removed_images
             WHERE LOWER(REPLACE(path, '\\', '/')) LIKE ?1",
            [&pattern],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let expected = match phase {
        "report" => None,
        "imported" | "restored" => Some((1_056, 0, 1, 3, 1_052, 0)),
        "legacy" => Some((1_056, 0, 1, 0, 1_055, 1_055)),
        "refreshed-manual" => Some((1_056, 0, 1, 2, 1_053, 0)),
        "automatic" => Some((1_056, 0, 1, 3, 1_052, 0)),
        "removed-one" => Some((1_055, 1, 1, 2, 1_052, 0)),
        _ => return Err(format!("unknown verification phase: {phase}")),
    };
    if let Some((want_active, want_removed, generated, photograph, other, want_pending)) = expected
    {
        let actual = (
            active,
            removed,
            counts.get("generated").copied().unwrap_or_default(),
            counts.get("photograph").copied().unwrap_or_default(),
            counts.get("other").copied().unwrap_or_default(),
            pending,
        );
        let wanted = (
            want_active,
            want_removed,
            generated,
            photograph,
            other,
            want_pending,
        );
        if actual != wanted {
            return Err(format!(
                "phase {phase} mismatch: expected {wanted:?}, found {actual:?}"
            ));
        }
    }
    println!(
        "QA phase {phase}: active={active}, removed={removed}, generated={}, photograph={}, other={}, pending={pending}; all {} source hashes intact",
        counts.get("generated").copied().unwrap_or_default(),
        counts.get("photograph").copied().unwrap_or_default(),
        counts.get("other").copied().unwrap_or_default(),
        manifest.entries.len()
    );
    Ok(())
}

fn normalized_prefix(root: &Path) -> String {
    format!(
        "{}/",
        root.to_string_lossy().replace('\\', "/").to_lowercase()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn destructive_targets_require_exact_qa_leaves() {
        assert!(ensure_corpus_root(Path::new("C:/temp/not-the-corpus")).is_err());
        assert!(ensure_qa_database(Path::new(
            "C:/Users/test/AppData/Roaming/com.ambit.dev/images.db"
        ))
        .is_err());
        assert!(ensure_qa_database(Path::new(
            "C:/Users/test/AppData/Roaming/com.ambit.qa/other.db"
        ))
        .is_err());
        assert!(ensure_corpus_root(Path::new("C:/temp/ambit-photo-qa")).is_ok());
        assert!(ensure_qa_database(Path::new(
            "C:/Users/test/AppData/Roaming/com.ambit.qa/images.db"
        ))
        .is_ok());
    }

    #[test]
    fn generated_manifest_encodes_the_acceptance_corpus() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let parent = std::env::temp_dir().join(format!("ambit-photo-qa-test-{unique}"));
        let root = parent.join("ambit-photo-qa");
        generate(&root).expect("generate QA corpus");

        let manifest: Manifest =
            serde_json::from_slice(&fs::read(root.join(MANIFEST_NAME)).expect("read manifest"))
                .expect("parse manifest");
        assert_eq!(manifest.entries.len(), 1_057);
        assert_eq!(
            manifest
                .entries
                .iter()
                .filter(|entry| entry.expected_import)
                .count(),
            1_056
        );
        assert_eq!(
            manifest
                .entries
                .iter()
                .filter(|entry| entry.expected_kind == "photograph")
                .count(),
            3
        );
        let oriented = manifest
            .entries
            .iter()
            .find(|entry| entry.relative_path == "photo-rich-orientation-6.jpg")
            .expect("orientation fixture");
        assert_eq!((oriented.width, oriented.height), (3, 2));
        assert_eq!((oriented.display_width, oriented.display_height), (2, 3));
        for entry in &manifest.entries {
            assert_eq!(
                sha256(&root.join(&entry.relative_path)).expect("hash fixture"),
                entry.sha256
            );
        }

        fs::remove_dir_all(parent).expect("remove isolated test corpus");
    }
}
