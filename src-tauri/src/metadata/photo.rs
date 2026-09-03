#![cfg_attr(not(test), allow(dead_code))]

use chrono::NaiveDateTime;
use exif::{Exif, In, Reader, Tag, Value};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

const MAX_TEXT_FIELD_BYTES: usize = 4 * 1024;
const MAX_TIFF_PROBE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTimeMetadata {
    // EXIF wall time exactly as recorded by the camera, without an invented timezone.
    pub local: String,
    pub offset: Option<String>,
    pub subsecond: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PhotoMetadata {
    pub captured_at: Option<CaptureTimeMetadata>,
    // Bounded DateTimeOriginal text, retained even when it is invalid.
    pub capture_time_raw: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub focal_length_mm: Option<f64>,
    pub focal_length_35mm: Option<u32>,
    pub aperture_f_number: Option<f64>,
    pub exposure_time_seconds: Option<f64>,
    pub iso: Option<u32>,
    pub orientation: Option<u8>,
    pub artist: Option<String>,
    pub copyright: Option<String>,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
}

impl PhotoMetadata {
    fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    fn has_photo_evidence(&self) -> bool {
        let has_camera_identity = self.camera_make.is_some() || self.camera_model.is_some();
        let has_lens_identity = self.lens_make.is_some() || self.lens_model.is_some();
        let has_exposure_signature = self.focal_length_mm.is_some()
            || self.focal_length_35mm.is_some()
            || self.aperture_f_number.is_some()
            || self.exposure_time_seconds.is_some()
            || self.iso.is_some();

        (has_camera_identity
            && (self.captured_at.is_some() || has_lens_identity || has_exposure_signature))
            || (self.captured_at.is_some() && has_exposure_signature)
    }

    /// Stable wall-time surrogate used for local-date sorting. The EXIF offset
    /// is deliberately not applied because capture dates are displayed and
    /// grouped using the camera's recorded local components.
    pub fn capture_wall_time_ms(&self) -> Option<i64> {
        let captured_at = self.captured_at.as_ref()?;
        let local = NaiveDateTime::parse_from_str(&captured_at.local, "%Y:%m:%d %H:%M:%S").ok()?;
        let milliseconds = captured_at
            .subsecond
            .as_deref()
            .map(|value| {
                let mut digits = value.chars().take(3).collect::<String>();
                while digits.len() < 3 {
                    digits.push('0');
                }
                digits.parse::<i64>().ok()
            })
            .flatten()
            .unwrap_or(0);

        Some(local.and_utc().timestamp_millis() + milliseconds)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Generated,
    Photograph,
    #[default]
    Other,
}

impl SourceKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Generated => "generated",
            Self::Photograph => "photograph",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum PhotoProbeError {
    Io(String),
    Parse(String),
    TiffTooLarge { bytes: u64, limit: u64 },
}

impl std::fmt::Display for PhotoProbeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(message) => write!(f, "I/O error while reading photo metadata: {message}"),
            Self::Parse(message) => write!(f, "Invalid photo metadata: {message}"),
            Self::TiffTooLarge { bytes, limit } => write!(
                f,
                "TIFF metadata probe would read the full {bytes}-byte file (limit: {limit} bytes)"
            ),
        }
    }
}

impl std::error::Error for PhotoProbeError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ContainerKind {
    Jpeg,
    Tiff,
    Other,
}

/// Classifies only strong catalog evidence. Generator evidence always wins over
/// camera-style EXIF because AI tools and post-processing software may preserve
/// or add photographic tags.
pub fn classify_source_kind(
    has_generated_evidence: bool,
    photo_metadata: Option<&PhotoMetadata>,
) -> SourceKind {
    if has_generated_evidence {
        SourceKind::Generated
    } else if photo_metadata.is_some_and(PhotoMetadata::has_photo_evidence) {
        SourceKind::Photograph
    } else {
        SourceKind::Other
    }
}

/// Feasibility contract for reading ordinary photo EXIF without changing the
/// existing AI metadata parser. JPEG EXIF is segment-bounded by the container.
/// TIFF is capped because kamadak-exif 0.6.1 reads the complete TIFF container.
pub fn probe_photo_metadata(path: &Path) -> Result<Option<PhotoMetadata>, PhotoProbeError> {
    let kind = detect_container(path)?;
    if kind == ContainerKind::Other {
        return Ok(None);
    }

    if kind == ContainerKind::Tiff {
        let bytes = std::fs::metadata(path)
            .map_err(|error| PhotoProbeError::Io(error.to_string()))?
            .len();
        if bytes > MAX_TIFF_PROBE_BYTES {
            return Err(PhotoProbeError::TiffTooLarge {
                bytes,
                limit: MAX_TIFF_PROBE_BYTES,
            });
        }
    }

    let file = File::open(path).map_err(|error| PhotoProbeError::Io(error.to_string()))?;
    let mut reader = BufReader::new(file);
    let mut exif_reader = Reader::new();
    exif_reader.continue_on_error(true);
    let parsed = exif_reader
        .read_from_container(&mut reader)
        .or_else(|error| error.distill_partial_result(|_| {}));

    let exif = match parsed {
        Ok(exif) => exif,
        Err(exif::Error::NotFound(_)) => return Ok(None),
        Err(error) => return Err(PhotoProbeError::Parse(error.to_string())),
    };

    let metadata = metadata_from_exif(&exif);
    Ok((!metadata.is_empty()).then_some(metadata))
}

fn detect_container(path: &Path) -> Result<ContainerKind, PhotoProbeError> {
    let mut file = File::open(path).map_err(|error| PhotoProbeError::Io(error.to_string()))?;
    let mut header = [0_u8; 4];
    let bytes_read = file
        .read(&mut header)
        .map_err(|error| PhotoProbeError::Io(error.to_string()))?;

    if bytes_read >= 2 && header[..2] == [0xff, 0xd8] {
        return Ok(ContainerKind::Jpeg);
    }
    if bytes_read == 4 && (header == *b"II*\0" || header == *b"MM\0*") {
        return Ok(ContainerKind::Tiff);
    }
    Ok(ContainerKind::Other)
}

fn metadata_from_exif(exif: &Exif) -> PhotoMetadata {
    let capture_time_raw = ascii_field(exif, Tag::DateTimeOriginal);
    PhotoMetadata {
        captured_at: capture_time(exif, capture_time_raw.as_deref()),
        capture_time_raw,
        camera_make: ascii_field(exif, Tag::Make),
        camera_model: ascii_field(exif, Tag::Model),
        lens_make: ascii_field(exif, Tag::LensMake),
        lens_model: ascii_field(exif, Tag::LensModel),
        focal_length_mm: rational_field(exif, Tag::FocalLength),
        focal_length_35mm: uint_field(exif, Tag::FocalLengthIn35mmFilm).filter(|value| *value > 0),
        aperture_f_number: rational_field(exif, Tag::FNumber),
        exposure_time_seconds: rational_field(exif, Tag::ExposureTime),
        iso: first_uint_field(
            exif,
            &[
                Tag::PhotographicSensitivity,
                Tag::ISOSpeed,
                Tag::StandardOutputSensitivity,
                Tag::RecommendedExposureIndex,
            ],
        )
        .filter(|value| *value > 0),
        orientation: uint_field(exif, Tag::Orientation)
            .and_then(|value| u8::try_from(value).ok())
            .filter(|value| (1..=8).contains(value)),
        artist: ascii_field(exif, Tag::Artist),
        copyright: ascii_field(exif, Tag::Copyright),
        gps_latitude: gps_coordinate(exif, Tag::GPSLatitude, Tag::GPSLatitudeRef),
        gps_longitude: gps_coordinate(exif, Tag::GPSLongitude, Tag::GPSLongitudeRef),
    }
}

fn capture_time(exif: &Exif, local: Option<&str>) -> Option<CaptureTimeMetadata> {
    let local = local?;
    if exif::DateTime::from_ascii(local.as_bytes()).is_err() {
        return None;
    }

    Some(CaptureTimeMetadata {
        local: local.to_string(),
        offset: ascii_field(exif, Tag::OffsetTimeOriginal).filter(|value| is_valid_offset(value)),
        subsecond: ascii_field(exif, Tag::SubSecTimeOriginal)
            .filter(|value| !value.is_empty() && value.len() <= 9)
            .filter(|value| value.bytes().all(|byte| byte.is_ascii_digit())),
    })
}

fn is_valid_offset(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 6
        || !matches!(bytes[0], b'+' | b'-')
        || bytes[3] != b':'
        || !bytes[1..3].iter().all(u8::is_ascii_digit)
        || !bytes[4..6].iter().all(u8::is_ascii_digit)
    {
        return false;
    }

    let hours = (bytes[1] - b'0') * 10 + (bytes[2] - b'0');
    let minutes = (bytes[4] - b'0') * 10 + (bytes[5] - b'0');
    hours <= 23 && minutes <= 59
}

fn ascii_field(exif: &Exif, tag: Tag) -> Option<String> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    let Value::Ascii(values) = &field.value else {
        return None;
    };
    let value = values.first()?;
    if value.len() > MAX_TEXT_FIELD_BYTES {
        return None;
    }

    let text = String::from_utf8_lossy(value)
        .trim_matches(|character: char| character == '\0' || character.is_whitespace())
        .to_string();
    (!text.is_empty()).then_some(text)
}

fn uint_field(exif: &Exif, tag: Tag) -> Option<u32> {
    exif.get_field(tag, In::PRIMARY)?.value.get_uint(0)
}

fn first_uint_field(exif: &Exif, tags: &[Tag]) -> Option<u32> {
    tags.iter().find_map(|tag| uint_field(exif, *tag))
}

fn rational_field(exif: &Exif, tag: Tag) -> Option<f64> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    let Value::Rational(values) = &field.value else {
        return None;
    };
    let value = values.first()?.to_f64();
    (value.is_finite() && value > 0.0).then_some(value)
}

fn gps_coordinate(exif: &Exif, coordinate_tag: Tag, reference_tag: Tag) -> Option<f64> {
    let field = exif.get_field(coordinate_tag, In::PRIMARY)?;
    let Value::Rational(values) = &field.value else {
        return None;
    };
    if values.len() < 3 {
        return None;
    }

    let degrees = values[0].to_f64();
    let minutes = values[1].to_f64();
    let seconds = values[2].to_f64();
    let max_degrees = match coordinate_tag {
        Tag::GPSLatitude => 90.0,
        Tag::GPSLongitude => 180.0,
        _ => return None,
    };
    if !degrees.is_finite()
        || !minutes.is_finite()
        || !seconds.is_finite()
        || degrees > max_degrees
        || minutes >= 60.0
        || seconds >= 60.0
        || (degrees == max_degrees && (minutes > 0.0 || seconds > 0.0))
    {
        return None;
    }
    let coordinate = degrees + minutes / 60.0 + seconds / 3600.0;
    if !coordinate.is_finite() {
        return None;
    }

    let reference = ascii_field(exif, reference_tag)?.to_ascii_uppercase();
    match reference.as_str() {
        "N" | "E" => Some(coordinate),
        "S" | "W" => Some(-coordinate),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use exif::experimental::Writer;
    use exif::{Field, Rational};
    use image::codecs::jpeg::JpegEncoder;
    use image::metadata::Orientation;
    use image::{DynamicImage, ExtendedColorType, ImageDecoder, ImageReader};
    use std::fs;
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_path(name: &str, extension: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ambit_photo_{name}_{nanos}.{extension}"))
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

    fn long(tag: Tag, value: u32) -> Field {
        Field {
            tag,
            ifd_num: In::PRIMARY,
            value: Value::Long(vec![value]),
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

    fn write_exif(fields: &[Field]) -> Vec<u8> {
        let mut writer = Writer::new();
        for field in fields {
            writer.push_field(field);
        }
        let mut cursor = Cursor::new(Vec::new());
        writer
            .write(&mut cursor, true)
            .expect("test EXIF should be writable");
        cursor.into_inner()
    }

    fn plain_jpeg() -> Vec<u8> {
        let pixels = [
            255, 0, 0, 0, 255, 0, 0, 0, 255, // top row
            255, 255, 0, 0, 255, 255, 255, 0, 255, // bottom row
        ];
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 100)
            .encode(&pixels, 3, 2, ExtendedColorType::Rgb8)
            .expect("test JPEG should encode");
        jpeg
    }

    fn jpeg_with_exif(fields: &[Field]) -> Vec<u8> {
        let jpeg = plain_jpeg();

        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend_from_slice(&write_exif(fields));
        let segment_length = u16::try_from(app1.len() + 2).expect("test EXIF fits APP1");

        let mut result = Vec::with_capacity(jpeg.len() + app1.len() + 4);
        result.extend_from_slice(&jpeg[..2]);
        result.extend_from_slice(&[0xff, 0xe1]);
        result.extend_from_slice(&segment_length.to_be_bytes());
        result.extend_from_slice(&app1);
        result.extend_from_slice(&jpeg[2..]);
        result
    }

    fn scan_jpeg_fixture(name: &str, fields: &[Field]) -> PhotoMetadata {
        let path = unique_test_path(name, "jpg");
        fs::write(&path, jpeg_with_exif(fields)).expect("test JPEG should be writable");
        let result = probe_photo_metadata(&path)
            .expect("photo metadata probe should succeed")
            .expect("photo metadata should exist");
        let _ = fs::remove_file(path);
        result
    }

    fn decode_oriented(path: &Path) -> (Orientation, DynamicImage) {
        let mut decoder = ImageReader::open(path)
            .expect("image should open")
            .with_guessed_format()
            .expect("format should be detected")
            .into_decoder()
            .expect("decoder should be created");
        let orientation = decoder.orientation().expect("orientation should decode");
        let mut image = DynamicImage::from_decoder(decoder).expect("image should decode");
        image.apply_orientation(orientation);
        (orientation, image)
    }

    #[test]
    fn extracts_camera_fields_without_inventing_capture_timezone() {
        let fields = vec![
            ascii(Tag::DateTimeOriginal, "2026:07:29 14:15:16"),
            ascii(Tag::SubSecTimeOriginal, "125"),
            ascii(Tag::Make, "Fujifilm"),
            ascii(Tag::Model, "X-T5"),
            ascii(Tag::LensMake, "Fujifilm"),
            ascii(Tag::LensModel, "XF33mmF1.4 R LM WR"),
            rational(Tag::FocalLength, 33, 1),
            short(Tag::FocalLengthIn35mmFilm, 50),
            rational(Tag::FNumber, 14, 10),
            rational(Tag::ExposureTime, 1, 125),
            short(Tag::PhotographicSensitivity, 800),
            short(Tag::Orientation, 6),
            ascii(Tag::Artist, "Ambit Test"),
            ascii(Tag::Copyright, "Local fixture"),
            rationals(Tag::GPSLatitude, &[(52, 1), (30, 1), (0, 1)]),
            ascii(Tag::GPSLatitudeRef, "N"),
            rationals(Tag::GPSLongitude, &[(13, 1), (24, 1), (0, 1)]),
            ascii(Tag::GPSLongitudeRef, "E"),
        ];

        let metadata = scan_jpeg_fixture("camera_fields", &fields);

        assert_eq!(
            metadata.captured_at,
            Some(CaptureTimeMetadata {
                local: "2026:07:29 14:15:16".to_string(),
                offset: None,
                subsecond: Some("125".to_string()),
            }),
            "an EXIF wall time without OffsetTimeOriginal must remain unzoned"
        );
        assert_eq!(
            metadata.capture_time_raw.as_deref(),
            Some("2026:07:29 14:15:16")
        );
        assert_eq!(metadata.camera_make.as_deref(), Some("Fujifilm"));
        assert_eq!(metadata.camera_model.as_deref(), Some("X-T5"));
        assert_eq!(metadata.lens_model.as_deref(), Some("XF33mmF1.4 R LM WR"));
        assert_eq!(metadata.focal_length_mm, Some(33.0));
        assert_eq!(metadata.focal_length_35mm, Some(50));
        assert_eq!(metadata.aperture_f_number, Some(1.4));
        assert_eq!(metadata.exposure_time_seconds, Some(0.008));
        assert_eq!(metadata.iso, Some(800));
        assert_eq!(metadata.orientation, Some(6));
        assert_eq!(metadata.artist.as_deref(), Some("Ambit Test"));
        assert_eq!(metadata.copyright.as_deref(), Some("Local fixture"));
        assert_eq!(metadata.gps_latitude, Some(52.5));
        assert_eq!(metadata.gps_longitude, Some(13.4));
        let expected_wall_time =
            NaiveDateTime::parse_from_str("2026:07:29 14:15:16", "%Y:%m:%d %H:%M:%S")
                .unwrap()
                .and_utc()
                .timestamp_millis()
                + 125;
        assert_eq!(metadata.capture_wall_time_ms(), Some(expected_wall_time));
    }

    #[test]
    fn preserves_valid_capture_offset_separately() {
        let metadata = scan_jpeg_fixture(
            "capture_offset",
            &[
                ascii(Tag::DateTimeOriginal, "2026:07:29 14:15:16"),
                ascii(Tag::OffsetTimeOriginal, "+02:00"),
                ascii(Tag::Make, "Sony"),
            ],
        );

        assert_eq!(
            metadata.captured_at,
            Some(CaptureTimeMetadata {
                local: "2026:07:29 14:15:16".to_string(),
                offset: Some("+02:00".to_string()),
                subsecond: None,
            })
        );
    }

    #[test]
    fn generated_evidence_has_classification_precedence() {
        let photo = scan_jpeg_fixture(
            "generated_with_camera_exif",
            &[
                ascii(Tag::DateTimeOriginal, "2026:07:29 14:15:16"),
                ascii(Tag::Make, "Camera"),
            ],
        );

        assert_eq!(
            classify_source_kind(true, Some(&photo)),
            SourceKind::Generated,
            "recognized AI provenance must win over incidental photographic EXIF"
        );
        assert_eq!(
            classify_source_kind(false, Some(&photo)),
            SourceKind::Photograph
        );
        assert_eq!(
            classify_source_kind(
                false,
                Some(&PhotoMetadata {
                    orientation: Some(6),
                    ..PhotoMetadata::default()
                })
            ),
            SourceKind::Other,
            "orientation alone is not strong camera evidence"
        );
    }

    #[test]
    fn jpeg_without_exif_is_not_forced_into_photo_metadata() {
        let path = unique_test_path("no_exif", "jpg");
        fs::write(&path, plain_jpeg()).expect("test JPEG should be writable");
        let result = probe_photo_metadata(&path).expect("plain JPEG probe should be non-fatal");
        let _ = fs::remove_file(path);

        assert_eq!(result, None);
        assert_eq!(classify_source_kind(false, None), SourceKind::Other);
    }

    #[test]
    fn jpeg_orientation_matrix_decodes_to_oriented_dimensions() {
        for (value, expected_orientation, expected_dimensions) in [
            (1, Orientation::NoTransforms, (3, 2)),
            (3, Orientation::Rotate180, (3, 2)),
            (6, Orientation::Rotate90, (2, 3)),
            (8, Orientation::Rotate270, (2, 3)),
        ] {
            let path = unique_test_path(&format!("orientation_{value}"), "jpg");
            fs::write(&path, jpeg_with_exif(&[short(Tag::Orientation, value)]))
                .expect("test JPEG should be writable");
            let (orientation, image) = decode_oriented(&path);
            let _ = fs::remove_file(path);

            assert_eq!(orientation, expected_orientation);
            assert_eq!(
                (image.width(), image.height()),
                expected_dimensions,
                "orientation {value} must report display dimensions"
            );
            let thumbnail = image.thumbnail(2, 2);
            let expected_thumbnail_dimensions = if matches!(value, 6 | 8) {
                (1, 2)
            } else {
                (2, 1)
            };
            assert_eq!(
                (thumbnail.width(), thumbnail.height()),
                expected_thumbnail_dimensions,
                "orientation {value} must be applied before thumbnail resizing"
            );
        }
    }

    #[test]
    fn malformed_and_oversized_exif_values_are_bounded() {
        let path = unique_test_path("malformed", "jpg");
        fs::write(
            &path,
            [
                vec![0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0c],
                b"Exif\0\0bad!".to_vec(),
                vec![0xff, 0xd9],
            ]
            .concat(),
        )
        .expect("malformed fixture should be writable");
        let malformed = probe_photo_metadata(&path);
        let _ = fs::remove_file(path);
        assert!(
            matches!(malformed, Err(PhotoProbeError::Parse(_))),
            "malformed EXIF must fail without panicking or allocating from unchecked offsets"
        );

        let oversized_make = "x".repeat(MAX_TEXT_FIELD_BYTES + 1);
        let metadata = scan_jpeg_fixture(
            "oversized_text",
            &[
                ascii(Tag::Make, &oversized_make),
                short(Tag::Orientation, 1),
            ],
        );
        assert_eq!(metadata.camera_make, None);
        assert_eq!(metadata.orientation, Some(1));

        let invalid_capture = scan_jpeg_fixture(
            "invalid_capture",
            &[
                ascii(Tag::DateTimeOriginal, "not a camera timestamp"),
                short(Tag::Orientation, 1),
            ],
        );
        assert_eq!(invalid_capture.captured_at, None);
        assert_eq!(
            invalid_capture.capture_time_raw.as_deref(),
            Some("not a camera timestamp"),
            "bounded invalid capture text must remain available for diagnosis"
        );
    }

    fn tiff_with_photo_fields(fields: &[Field]) -> Vec<u8> {
        let image_fields = vec![
            long(Tag::ImageWidth, 3),
            long(Tag::ImageLength, 2),
            Field {
                tag: Tag::BitsPerSample,
                ifd_num: In::PRIMARY,
                value: Value::Short(vec![8, 8, 8]),
            },
            short(Tag::Compression, 1),
            short(Tag::PhotometricInterpretation, 2),
            short(Tag::SamplesPerPixel, 3),
            long(Tag::RowsPerStrip, 2),
            short(Tag::PlanarConfiguration, 1),
        ];
        let pixels = [
            255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255,
        ];
        let strips: [&[u8]; 1] = [&pixels];
        let mut writer = Writer::new();
        for field in image_fields.iter().chain(fields.iter()) {
            writer.push_field(field);
        }
        writer.set_strips(&strips, In::PRIMARY);
        let mut cursor = Cursor::new(Vec::new());
        writer
            .write(&mut cursor, true)
            .expect("test TIFF should encode");
        cursor.into_inner()
    }

    #[test]
    fn small_tiff_can_be_probed_and_oriented_but_large_tiff_is_rejected() {
        let path = unique_test_path("small_tiff", "tiff");
        fs::write(
            &path,
            tiff_with_photo_fields(&[
                short(Tag::Orientation, 6),
                ascii(Tag::DateTimeOriginal, "2026:07:29 14:15:16"),
                ascii(Tag::Make, "Test Camera"),
            ]),
        )
        .expect("test TIFF should be writable");

        let metadata = probe_photo_metadata(&path)
            .expect("small TIFF probe should succeed")
            .expect("small TIFF should contain metadata");
        let (orientation, image) = decode_oriented(&path);
        assert_eq!(metadata.orientation, Some(6));
        assert_eq!(orientation, Orientation::Rotate90);
        assert_eq!((image.width(), image.height()), (2, 3));
        let _ = fs::remove_file(path);

        let oversized_path = unique_test_path("oversized_tiff", "tiff");
        let oversized = fs::File::create(&oversized_path).expect("test TIFF should be creatable");
        oversized
            .set_len(MAX_TIFF_PROBE_BYTES + 1)
            .expect("sparse test TIFF should be sizable");
        drop(oversized);
        let mut bytes = fs::OpenOptions::new()
            .write(true)
            .open(&oversized_path)
            .expect("test TIFF should reopen");
        use std::io::Write;
        bytes
            .write_all(b"II*\0")
            .expect("TIFF header should be writable");
        drop(bytes);

        let result = probe_photo_metadata(&oversized_path);
        let _ = fs::remove_file(oversized_path);
        assert_eq!(
            result,
            Err(PhotoProbeError::TiffTooLarge {
                bytes: MAX_TIFF_PROBE_BYTES + 1,
                limit: MAX_TIFF_PROBE_BYTES,
            }),
            "the selected EXIF parser reads TIFF containers whole, so large TIFF must not be admitted"
        );
    }
}
