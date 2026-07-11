use flate2::read::ZlibDecoder;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

const MAX_PNG_METADATA_CHUNK_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PNG_DECOMPRESSED_TEXT_BYTES: u64 = 10 * 1024 * 1024;
const MAX_PNG_METADATA_TOTAL_CHUNK_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PNG_DECODED_TEXT_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_WEBP_METADATA_CHUNK_BYTES: u32 = 16 * 1024 * 1024;
const EXIF_HEADER: &[u8; 6] = b"Exif\0\0";
const TAG_EXIF_IFD: u16 = 0x8769;
const TAG_USER_COMMENT: u16 = 0x9286;
const TAG_IMAGE_DESCRIPTION: u16 = 0x010E;
const TAG_MAKE: u16 = 0x010F;
const TAG_MODEL: u16 = 0x0110;
const TAG_SOFTWARE: u16 = 0x0131;

pub fn scan_jpeg_metadata(path: &std::path::Path) -> Result<HashMap<String, String>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut buffer = [0; 2];
    if file.read_exact(&mut buffer).is_err() {
        return Ok(HashMap::new());
    }
    if buffer != [0xFF, 0xD8] {
        return Ok(HashMap::new());
    } // SOI

    let mut chunks = HashMap::new();

    loop {
        let mut marker = [0; 2];
        if file.read_exact(&mut marker).is_err() {
            break;
        }
        if marker[0] != 0xFF {
            break;
        }

        let m_type = marker[1];
        if m_type == 0xD9 || m_type == 0xDA {
            break;
        } // EOI or SOS

        // Length
        let mut len_bytes = [0; 2];
        if file.read_exact(&mut len_bytes).is_err() {
            break;
        }
        let raw_len = u16::from_be_bytes(len_bytes);
        if raw_len < 2 {
            break;
        }
        let len = (raw_len - 2) as usize;

        if m_type == 0xE1 {
            // APP1 - EXIF
            let mut app1_data = vec![0; len];
            if file.read_exact(&mut app1_data).is_ok() {
                if app1_data.starts_with(EXIF_HEADER) {
                    merge_missing_chunks(&mut chunks, extract_exif_chunks(&app1_data[6..]));
                }
            }
        } else {
            if file.seek(SeekFrom::Current(len as i64)).is_err() {
                break;
            }
        }
    }

    Ok(chunks)
}

pub fn scan_webp_metadata(path: &std::path::Path) -> Result<HashMap<String, String>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut header = [0; 12];
    if file.read_exact(&mut header).is_err() {
        return Ok(HashMap::new());
    }
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WEBP" {
        return Ok(HashMap::new());
    }

    let mut chunks = HashMap::new();

    loop {
        let mut chunk_header = [0; 8];
        if file.read_exact(&mut chunk_header).is_err() {
            break;
        }

        let chunk_type = &chunk_header[0..4];
        let length = u32::from_le_bytes(
            chunk_header[4..8]
                .try_into()
                .map_err(|_| "Invalid WebP chunk length".to_string())?,
        );

        if chunk_type == b"EXIF" {
            if length > MAX_WEBP_METADATA_CHUNK_BYTES {
                let skip = length as i64 + (length % 2) as i64;
                if file.seek(SeekFrom::Current(skip)).is_err() {
                    break;
                }
                continue;
            }

            let mut data = vec![0; length as usize];
            if file.read_exact(&mut data).is_err() {
                break;
            }
            let exif_data = if data.starts_with(EXIF_HEADER) {
                &data[6..]
            } else {
                &data
            };
            merge_missing_chunks(&mut chunks, extract_exif_chunks(exif_data));

            if length % 2 == 1 && file.seek(SeekFrom::Current(1)).is_err() {
                break;
            }
        } else {
            let skip = length as i64 + (length % 2) as i64;
            if file.seek(SeekFrom::Current(skip)).is_err() {
                break;
            }
        }
    }

    Ok(chunks)
}

fn merge_missing_chunks(base: &mut HashMap<String, String>, incoming: HashMap<String, String>) {
    for (key, value) in incoming {
        base.entry(key).or_insert(value);
    }
}

fn insert_chunk_if_missing(chunks: &mut HashMap<String, String>, key: &str, value: String) {
    if !value.trim().is_empty() {
        chunks.entry(key.to_string()).or_insert(value);
    }
}

fn json_value_to_chunk_string(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn normalize_metadata_text(
    chunks: &mut HashMap<String, String>,
    text: &str,
    fallback_key: Option<&str>,
) {
    let text = text.trim_matches('\0').trim();
    if text.is_empty() {
        return;
    }

    let lower = text.to_ascii_lowercase();
    for (prefix, key) in [
        ("workflow:", "workflow"),
        ("prompt:", "prompt"),
        ("parameters:", "parameters"),
    ] {
        if lower.starts_with(prefix) {
            insert_chunk_if_missing(chunks, key, text[prefix.len()..].trim().to_string());
            return;
        }
    }

    if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(text) {
        let mut inserted = false;

        if let Some(workflow) = obj.get("workflow") {
            insert_chunk_if_missing(chunks, "workflow", json_value_to_chunk_string(workflow));
            inserted = true;
        }
        if let Some(prompt) = obj.get("prompt") {
            insert_chunk_if_missing(chunks, "prompt", json_value_to_chunk_string(prompt));
            inserted = true;
        }

        if inserted {
            return;
        }

        if obj.contains_key("nodes") {
            insert_chunk_if_missing(chunks, "workflow", text.to_string());
            return;
        }

        if obj.keys().any(|key| key.parse::<u64>().is_ok()) {
            insert_chunk_if_missing(chunks, "prompt", text.to_string());
            return;
        }
    }

    if let Some(key) = fallback_key {
        insert_chunk_if_missing(chunks, key, text.to_string());
    }
}

fn normalize_exif_entry(chunks: &mut HashMap<String, String>, tag: u16, text: &str) {
    match tag {
        TAG_USER_COMMENT => normalize_metadata_text(chunks, text, Some("parameters")),
        TAG_IMAGE_DESCRIPTION | TAG_MAKE | TAG_MODEL | TAG_SOFTWARE => {
            normalize_metadata_text(chunks, text, None)
        }
        _ => {}
    }
}

fn skip_chunk_data_and_crc<R: Seek>(reader: &mut R, length: u64) -> Result<(), String> {
    reader
        .seek(SeekFrom::Current((length + 4) as i64))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Default)]
struct PngMetadataBudget {
    raw_chunk_bytes: u64,
    decoded_text_bytes: u64,
    raw_exhausted: bool,
    decoded_exhausted: bool,
    logged_limit: bool,
}

impl PngMetadataBudget {
    fn allow_raw_chunk(&mut self, length: u64) -> bool {
        if self.raw_exhausted {
            return false;
        }

        if self.raw_chunk_bytes.saturating_add(length) > MAX_PNG_METADATA_TOTAL_CHUNK_BYTES {
            self.raw_exhausted = true;
            self.note_limit("maximum aggregate PNG metadata chunk bytes reached");
            return false;
        }

        self.raw_chunk_bytes += length;
        true
    }

    fn remaining_decoded_text_bytes(&self) -> u64 {
        if self.decoded_exhausted {
            return 0;
        }
        MAX_PNG_DECODED_TEXT_TOTAL_BYTES.saturating_sub(self.decoded_text_bytes)
    }

    fn accept_decoded_text(&mut self, value: String) -> Option<String> {
        if self.decoded_exhausted {
            return None;
        }

        let byte_len = value.len() as u64;
        if byte_len > self.remaining_decoded_text_bytes() {
            self.exhaust_decoded_text();
            return None;
        }

        self.decoded_text_bytes += byte_len;
        Some(value)
    }

    fn exhaust_decoded_text(&mut self) {
        if !self.decoded_exhausted {
            self.decoded_exhausted = true;
            self.note_limit("maximum aggregate decoded PNG text bytes reached");
        }
    }

    fn note_limit(&mut self, reason: &str) {
        if !self.logged_limit {
            log::debug!("[PNG] Metadata budget reached: {reason}");
            self.logged_limit = true;
        }
    }
}

enum LimitedZlibText {
    Text(String),
    ExceededLimit,
    Invalid,
}

fn read_limited_zlib_text(data: &[u8], max_decoded_bytes: u64) -> LimitedZlibText {
    if max_decoded_bytes == 0 {
        return LimitedZlibText::ExceededLimit;
    }

    let decoder = ZlibDecoder::new(data);
    let limit = MAX_PNG_DECOMPRESSED_TEXT_BYTES.min(max_decoded_bytes);
    let mut limited = decoder.take(limit + 1);
    let mut bytes = Vec::new();

    match limited.read_to_end(&mut bytes) {
        Ok(_) if bytes.len() as u64 > limit => LimitedZlibText::ExceededLimit,
        Ok(_) => match String::from_utf8(bytes) {
            Ok(s) => LimitedZlibText::Text(s),
            Err(_) => LimitedZlibText::Invalid,
        },
        Err(_) => LimitedZlibText::Invalid,
    }
}

/// Extracts metadata chunks from a PNG file.
///
/// **IMPORTANT**: This function expects the reader to be positioned at the **beginning** of the file
/// (byte 0) because it verifies the 8-byte PNG header before scanning chunks.
pub fn extract_png_chunks<R: Read + Seek>(
    reader: &mut R,
) -> Result<HashMap<String, String>, String> {
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
    let mut budget = PngMetadataBudget::default();

    loop {
        if loop_count > 10000 {
            break;
        }
        loop_count += 1;

        let mut length_bytes = [0; 4];
        if reader.read_exact(&mut length_bytes).is_err() {
            break;
        }
        let length = u32::from_be_bytes(length_bytes) as u64;

        let mut type_bytes = [0; 4];
        if reader.read_exact(&mut type_bytes).is_err() {
            break;
        }
        let chunk_type = String::from_utf8_lossy(&type_bytes).to_string();

        if chunk_type == "tEXt"
            || chunk_type == "iTXt"
            || chunk_type == "zTXt"
            || chunk_type == "eXIf"
        {
            if length > MAX_PNG_METADATA_CHUNK_BYTES {
                skip_chunk_data_and_crc(reader, length)?;
                continue;
            }
            if !budget.allow_raw_chunk(length) {
                skip_chunk_data_and_crc(reader, length)?;
                continue;
            }

            let mut chunk_data = vec![0; length as usize];
            if reader.read_exact(&mut chunk_data).is_err() {
                break;
            }

            if chunk_type == "eXIf" {
                // Some writers include the "Exif\0\0" header in the chunk data
                let data_slice = if chunk_data.len() >= 6 && &chunk_data[0..6] == b"Exif\0\0" {
                    &chunk_data[6..]
                } else {
                    &chunk_data
                };

                for (key, value) in extract_exif_chunks(data_slice) {
                    if let Some(value) = budget.accept_decoded_text(value) {
                        chunks.entry(key).or_insert(value);
                    }
                }
            } else if let Some(pos) = chunk_data.iter().position(|&x| x == 0) {
                let key = String::from_utf8_lossy(&chunk_data[0..pos]).to_string();

                if chunk_type == "zTXt" {
                    if pos + 2 < chunk_data.len() && chunk_data[pos + 1] == 0 {
                        let compressed = &chunk_data[pos + 2..];
                        match read_limited_zlib_text(
                            compressed,
                            budget.remaining_decoded_text_bytes(),
                        ) {
                            LimitedZlibText::Text(s) => {
                                if let Some(s) = budget.accept_decoded_text(s) {
                                    chunks.insert(key, s);
                                }
                            }
                            LimitedZlibText::ExceededLimit => budget.exhaust_decoded_text(),
                            LimitedZlibText::Invalid => {}
                        }
                    }
                } else if chunk_type == "tEXt" {
                    if pos + 1 < chunk_data.len() {
                        let val = String::from_utf8_lossy(&chunk_data[pos + 1..]).to_string();
                        if let Some(val) = budget.accept_decoded_text(val) {
                            chunks.insert(key, val);
                        }
                    }
                } else if chunk_type == "iTXt" {
                    // Simplified iTXt parsing
                    if pos + 2 < chunk_data.len() {
                        let is_compressed = chunk_data[pos + 1] == 1;
                        // Skip compression method (pos+2)
                        // Skip lang tags etc - find next nulls
                        let mut curr = pos + 3;
                        // Skip lang tag
                        while curr < chunk_data.len() && chunk_data[curr] != 0 {
                            curr += 1;
                        }
                        curr += 1;
                        // Skip trans key
                        while curr < chunk_data.len() && chunk_data[curr] != 0 {
                            curr += 1;
                        }
                        curr += 1;

                        if curr < chunk_data.len() {
                            let data_slice = &chunk_data[curr..];
                            if is_compressed {
                                match read_limited_zlib_text(
                                    data_slice,
                                    budget.remaining_decoded_text_bytes(),
                                ) {
                                    LimitedZlibText::Text(s) => {
                                        if let Some(s) = budget.accept_decoded_text(s) {
                                            chunks.insert(key, s);
                                        }
                                    }
                                    LimitedZlibText::ExceededLimit => budget.exhaust_decoded_text(),
                                    LimitedZlibText::Invalid => {}
                                }
                            } else {
                                let val = String::from_utf8_lossy(data_slice).to_string();
                                if let Some(val) = budget.accept_decoded_text(val) {
                                    chunks.insert(key, val);
                                }
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
            // Efficiently skip data + CRC O(1) without thrashing OS disk I/O
            skip_chunk_data_and_crc(reader, length)?;
        }
    }

    Ok(chunks)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TiffEndian {
    Little,
    Big,
}

impl TiffEndian {
    fn read_u16(self, data: &[u8], offset: usize) -> Option<u16> {
        let bytes: [u8; 2] = data.get(offset..offset + 2)?.try_into().ok()?;
        Some(match self {
            Self::Little => u16::from_le_bytes(bytes),
            Self::Big => u16::from_be_bytes(bytes),
        })
    }

    fn read_u32(self, data: &[u8], offset: usize) -> Option<u32> {
        let bytes: [u8; 4] = data.get(offset..offset + 4)?.try_into().ok()?;
        Some(match self {
            Self::Little => u32::from_le_bytes(bytes),
            Self::Big => u32::from_be_bytes(bytes),
        })
    }
}

fn tiff_type_size(field_type: u16) -> Option<usize> {
    match field_type {
        1 | 2 | 6 | 7 => Some(1),
        3 | 8 => Some(2),
        4 | 9 | 11 => Some(4),
        5 | 10 | 12 => Some(8),
        _ => None,
    }
}

fn clean_user_comment_text(text: &str) -> String {
    text.trim_matches('\0').trim().replace('\0', "")
}

fn has_recognizable_metadata_shape(text: &str) -> bool {
    if text.contains("Steps: ") {
        return true;
    }

    let mut recognized_chunks = HashMap::new();
    normalize_metadata_text(&mut recognized_chunks, text, None);
    !recognized_chunks.is_empty()
}

fn decode_utf16_user_comment(payload: &[u8], endian: TiffEndian) -> Option<String> {
    if payload.len() % 2 != 0 {
        return None;
    }

    let code_units = payload.chunks_exact(2).map(|chunk| match endian {
        TiffEndian::Little => u16::from_le_bytes([chunk[0], chunk[1]]),
        TiffEndian::Big => u16::from_be_bytes([chunk[0], chunk[1]]),
    });

    String::from_utf16(&code_units.collect::<Vec<_>>())
        .ok()
        .map(|text| clean_user_comment_text(&text))
}

fn infer_utf16_endian(payload: &[u8]) -> Option<TiffEndian> {
    let mut big_endian_ascii_pairs = 0usize;
    let mut little_endian_ascii_pairs = 0usize;

    for pair in payload.chunks_exact(2).take(512) {
        match pair {
            [0, value] if matches!(*value, b'\t' | b'\n' | b'\r' | b' '..=b'~') => {
                big_endian_ascii_pairs += 1;
            }
            [value, 0] if matches!(*value, b'\t' | b'\n' | b'\r' | b' '..=b'~') => {
                little_endian_ascii_pairs += 1;
            }
            _ => {}
        }
    }

    if big_endian_ascii_pairs >= 2
        && big_endian_ascii_pairs > little_endian_ascii_pairs.saturating_mul(2)
    {
        Some(TiffEndian::Big)
    } else if little_endian_ascii_pairs >= 2
        && little_endian_ascii_pairs > big_endian_ascii_pairs.saturating_mul(2)
    {
        Some(TiffEndian::Little)
    } else {
        None
    }
}

fn decode_user_comment(raw: &[u8], endian: TiffEndian) -> Option<String> {
    if raw.starts_with(b"UNICODE\0") {
        let payload = &raw[8..];

        if let Some(bom_payload) = payload.strip_prefix(&[0xFE, 0xFF]) {
            return decode_utf16_user_comment(bom_payload, TiffEndian::Big);
        }
        if let Some(bom_payload) = payload.strip_prefix(&[0xFF, 0xFE]) {
            return decode_utf16_user_comment(bom_payload, TiffEndian::Little);
        }

        let utf8_candidate = std::str::from_utf8(payload)
            .ok()
            .map(clean_user_comment_text);
        if payload.len() % 2 != 0 {
            return utf8_candidate;
        }

        let inferred_endian = infer_utf16_endian(payload);
        let utf16_candidate = decode_utf16_user_comment(payload, endian);
        if inferred_endian == Some(endian) && utf16_candidate.is_some() {
            return utf16_candidate;
        }

        let inferred_candidate = inferred_endian
            .filter(|inferred| *inferred != endian)
            .and_then(|inferred| decode_utf16_user_comment(payload, inferred));

        if inferred_candidate
            .as_deref()
            .is_some_and(has_recognizable_metadata_shape)
        {
            return inferred_candidate;
        }
        if utf8_candidate
            .as_deref()
            .is_some_and(has_recognizable_metadata_shape)
        {
            return utf8_candidate;
        }

        return utf16_candidate.or(inferred_candidate).or(utf8_candidate);
    }

    let payload = if raw.starts_with(b"ASCII\0\0\0") {
        &raw[8..]
    } else {
        raw
    };

    Some(clean_user_comment_text(&String::from_utf8_lossy(payload)))
}

fn decode_exif_string(
    data: &[u8],
    endian: TiffEndian,
    tag: u16,
    field_type: u16,
    count: u32,
    value_offset: usize,
    inline_value: &[u8],
) -> Option<String> {
    let field_size = tiff_type_size(field_type)?;
    let total_size = field_size.checked_mul(count as usize)?;
    let raw = if total_size <= 4 {
        inline_value.get(..total_size)?
    } else {
        data.get(value_offset..value_offset.checked_add(total_size)?)?
    };

    if tag == TAG_USER_COMMENT {
        return decode_user_comment(raw, endian);
    }

    match field_type {
        2 | 7 => Some(
            String::from_utf8_lossy(raw)
                .trim_matches('\0')
                .trim()
                .replace('\0', ""),
        ),
        _ => None,
    }
}

fn read_exif_ifd(
    data: &[u8],
    offset: usize,
    endian: TiffEndian,
    chunks: &mut HashMap<String, String>,
    visited_offsets: &mut Vec<usize>,
) {
    if visited_offsets.contains(&offset) || offset + 2 > data.len() {
        return;
    }
    visited_offsets.push(offset);

    let Some(entry_count) = endian.read_u16(data, offset) else {
        return;
    };
    let entries_start = offset + 2;
    let mut exif_ifd_offset = None;

    for i in 0..entry_count {
        let entry_offset = entries_start + (i as usize * 12);
        if entry_offset + 12 > data.len() {
            break;
        }

        let Some(tag) = endian.read_u16(data, entry_offset) else {
            continue;
        };
        let Some(field_type) = endian.read_u16(data, entry_offset + 2) else {
            continue;
        };
        let Some(count) = endian.read_u32(data, entry_offset + 4) else {
            continue;
        };
        let Some(value_offset_or_data) = endian.read_u32(data, entry_offset + 8) else {
            continue;
        };

        if tag == TAG_EXIF_IFD {
            exif_ifd_offset = Some(value_offset_or_data as usize);
            continue;
        }

        if let Some(text) = decode_exif_string(
            data,
            endian,
            tag,
            field_type,
            count,
            value_offset_or_data as usize,
            &data[entry_offset + 8..entry_offset + 12],
        ) {
            normalize_exif_entry(chunks, tag, &text);
        }
    }

    if let Some(offset) = exif_ifd_offset {
        read_exif_ifd(data, offset, endian, chunks, visited_offsets);
    }
}

fn extract_exif_chunks(data: &[u8]) -> HashMap<String, String> {
    let mut chunks = HashMap::new();
    if data.len() < 8 {
        return chunks;
    }

    let endian = if &data[0..2] == b"II" {
        TiffEndian::Little
    } else if &data[0..2] == b"MM" {
        TiffEndian::Big
    } else {
        return chunks;
    };

    if endian.read_u16(data, 2) != Some(0x002A) {
        return chunks;
    }

    let Some(first_ifd_offset) = endian.read_u32(data, 4).map(|offset| offset as usize) else {
        return chunks;
    };
    if first_ifd_offset < 8 || first_ifd_offset >= data.len() {
        return chunks;
    }

    read_exif_ifd(data, first_ifd_offset, endian, &mut chunks, &mut Vec::new());

    chunks
}

#[cfg(test)]
fn parse_exif(data: &[u8]) -> Option<String> {
    let mut chunks = extract_exif_chunks(data);
    chunks.remove("parameters")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("ambit_{name}_{nanos}.jpg"))
    }

    fn scan_test_jpeg(name: &str, jpeg: &[u8]) -> Result<HashMap<String, String>, String> {
        let path = unique_test_path(name);
        fs::write(&path, jpeg).expect("test JPEG should be writable");
        let result = scan_jpeg_metadata(&path);
        let _ = fs::remove_file(&path);
        result
    }

    fn scan_test_webp(name: &str, webp: &[u8]) -> Result<HashMap<String, String>, String> {
        let path = unique_test_path(name).with_extension("webp");
        fs::write(&path, webp).expect("test WebP should be writable");
        let result = scan_webp_metadata(&path);
        let _ = fs::remove_file(&path);
        result
    }

    fn jpeg_with_segment(marker_type: u8, raw_len: u16, payload: &[u8]) -> Vec<u8> {
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, marker_type];
        jpeg.extend_from_slice(&raw_len.to_be_bytes());
        jpeg.extend_from_slice(payload);
        jpeg.extend_from_slice(&[0xFF, 0xD9]);
        jpeg
    }

    fn exif_user_comment_raw_payload(comment: &[u8]) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(b"Exif\0\0");
        payload.extend_from_slice(b"II");
        payload.extend_from_slice(&0x2Au16.to_le_bytes());
        payload.extend_from_slice(&8u32.to_le_bytes());

        payload.extend_from_slice(&1u16.to_le_bytes());
        payload.extend_from_slice(&0x9286u16.to_le_bytes());
        payload.extend_from_slice(&7u16.to_le_bytes());
        payload.extend_from_slice(&(comment.len() as u32).to_le_bytes());
        payload.extend_from_slice(&30u32.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());

        while payload.len() < 36 {
            payload.push(0);
        }

        payload.extend_from_slice(comment);
        payload
    }

    fn exif_user_comment_payload(comment: &[u8]) -> Vec<u8> {
        let mut tagged_comment = b"ASCII\0\0\0".to_vec();
        tagged_comment.extend_from_slice(comment);
        exif_user_comment_raw_payload(&tagged_comment)
    }

    fn unicode_user_comment(payload: &[u8]) -> Vec<u8> {
        let mut comment = b"UNICODE\0".to_vec();
        comment.extend_from_slice(payload);
        comment
    }

    fn utf16_bytes(text: &str, endian: TiffEndian) -> Vec<u8> {
        text.encode_utf16()
            .flat_map(|code_unit| match endian {
                TiffEndian::Little => code_unit.to_le_bytes(),
                TiffEndian::Big => code_unit.to_be_bytes(),
            })
            .collect()
    }

    fn exif_ascii_tags_payload(tags: &[(u16, &str)]) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(b"Exif\0\0");
        payload.extend_from_slice(b"II");
        payload.extend_from_slice(&0x2Au16.to_le_bytes());
        payload.extend_from_slice(&8u32.to_le_bytes());

        payload.extend_from_slice(&(tags.len() as u16).to_le_bytes());
        let data_start = 8 + 2 + (tags.len() * 12) + 4;
        let mut data_offset = data_start as u32;
        let mut data_values = Vec::new();

        for (tag, value) in tags {
            let mut bytes = value.as_bytes().to_vec();
            bytes.push(0);

            payload.extend_from_slice(&tag.to_le_bytes());
            payload.extend_from_slice(&2u16.to_le_bytes());
            payload.extend_from_slice(&(bytes.len() as u32).to_le_bytes());

            if bytes.len() <= 4 {
                let mut inline = [0; 4];
                inline[..bytes.len()].copy_from_slice(&bytes);
                payload.extend_from_slice(&inline);
            } else {
                payload.extend_from_slice(&data_offset.to_le_bytes());
                data_offset += bytes.len() as u32;
                data_values.extend_from_slice(&bytes);
            }
        }

        payload.extend_from_slice(&0u32.to_le_bytes());
        payload.extend_from_slice(&data_values);
        payload
    }

    fn webp_with_exif(exif_payload: &[u8]) -> Vec<u8> {
        let mut webp = Vec::new();
        webp.extend_from_slice(b"RIFF");
        webp.extend_from_slice(&0u32.to_le_bytes());
        webp.extend_from_slice(b"WEBP");
        webp.extend_from_slice(b"EXIF");
        webp.extend_from_slice(&(exif_payload.len() as u32).to_le_bytes());
        webp.extend_from_slice(exif_payload);
        if exif_payload.len() % 2 == 1 {
            webp.push(0);
        }

        let riff_size = (webp.len() - 8) as u32;
        webp[4..8].copy_from_slice(&riff_size.to_le_bytes());
        webp
    }

    fn png_fixture() -> Vec<u8> {
        vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    }

    fn push_png_chunk(png: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(chunk_type);
        png.extend_from_slice(data);
        png.extend_from_slice(&[0; 4]);
    }

    fn push_iend(png: &mut Vec<u8>) {
        push_png_chunk(png, b"IEND", &[]);
    }

    fn text_chunk_data(key: &str, value_len: usize, fill: u8) -> Vec<u8> {
        let mut data = Vec::with_capacity(key.len() + 1 + value_len);
        data.extend_from_slice(key.as_bytes());
        data.push(0);
        data.extend(std::iter::repeat(fill).take(value_len));
        data
    }

    fn itxt_uncompressed_data(key: &str, value_len: usize, fill: u8) -> Vec<u8> {
        let mut data = Vec::with_capacity(key.len() + 5 + value_len);
        data.extend_from_slice(key.as_bytes());
        data.push(0);
        data.push(0);
        data.push(0);
        data.push(0);
        data.push(0);
        data.extend(std::iter::repeat(fill).take(value_len));
        data
    }

    fn ztxt_chunk_data(key: &str, value: &[u8]) -> Vec<u8> {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(value).unwrap();
        let compressed_text = encoder.finish().unwrap();

        let mut data = Vec::with_capacity(key.len() + 2 + compressed_text.len());
        data.extend_from_slice(key.as_bytes());
        data.push(0);
        data.push(0);
        data.extend_from_slice(&compressed_text);
        data
    }

    fn itxt_compressed_data(key: &str, value: &[u8]) -> Vec<u8> {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(value).unwrap();
        let compressed_text = encoder.finish().unwrap();

        let mut data = Vec::with_capacity(key.len() + 5 + compressed_text.len());
        data.extend_from_slice(key.as_bytes());
        data.push(0);
        data.push(1);
        data.push(0);
        data.push(0);
        data.push(0);
        data.extend_from_slice(&compressed_text);
        data
    }

    #[test]
    fn test_decode_user_comment_infers_utf16_endian_independently_of_tiff() {
        let text = "Steps: 4, Sampler: Euler, Character: \u{4e2d}, Emoji: \u{1f680}";

        let big_endian = unicode_user_comment(&utf16_bytes(text, TiffEndian::Big));
        assert_eq!(
            decode_user_comment(&big_endian, TiffEndian::Little).as_deref(),
            Some(text),
            "CivitAI-style UTF-16BE comments must not inherit little-endian TIFF order"
        );

        let little_endian = unicode_user_comment(&utf16_bytes(text, TiffEndian::Little));
        assert_eq!(
            decode_user_comment(&little_endian, TiffEndian::Big).as_deref(),
            Some(text),
            "UTF-16LE comments must not inherit big-endian TIFF order"
        );
    }

    #[test]
    fn test_decode_user_comment_bom_overrides_tiff_endian() {
        let text = "BOM metadata \u{4e2d}";

        let mut big_endian_payload = vec![0xFE, 0xFF];
        big_endian_payload.extend_from_slice(&utf16_bytes(text, TiffEndian::Big));
        let big_endian = unicode_user_comment(&big_endian_payload);
        assert_eq!(
            decode_user_comment(&big_endian, TiffEndian::Little).as_deref(),
            Some(text)
        );

        let mut little_endian_payload = vec![0xFF, 0xFE];
        little_endian_payload.extend_from_slice(&utf16_bytes(text, TiffEndian::Little));
        let little_endian = unicode_user_comment(&little_endian_payload);
        assert_eq!(
            decode_user_comment(&little_endian, TiffEndian::Big).as_deref(),
            Some(text)
        );
    }

    #[test]
    fn test_decode_user_comment_accepts_utf8_behind_unicode_tag() {
        for (text, expected_parity) in [("odd", 1), ("Steps: 4", 0), ("caf\u{e9}\nSteps: 4", 0)] {
            assert_eq!(
                text.len() % 2,
                expected_parity,
                "the fixture must exercise its intended byte-length branch"
            );
            let comment = unicode_user_comment(text.as_bytes());
            assert_eq!(
                decode_user_comment(&comment, TiffEndian::Little).as_deref(),
                Some(text),
                "valid UTF-8 must survive a contradictory UNICODE tag"
            );
        }
    }

    #[test]
    fn test_decode_user_comment_prefers_declared_utf16_when_utf8_is_ambiguous() {
        let text = "\u{4e2d}";

        for endian in [TiffEndian::Big, TiffEndian::Little] {
            let comment = unicode_user_comment(&utf16_bytes(text, endian));
            assert_eq!(
                decode_user_comment(&comment, endian).as_deref(),
                Some(text),
                "valid standard UTF-16 must win when its bytes also form valid UTF-8"
            );
        }
    }

    #[test]
    fn test_decode_user_comment_ignores_control_bytes_as_endian_evidence() {
        let text = "\u{0100}\u{0100}";

        for endian in [TiffEndian::Big, TiffEndian::Little] {
            let comment = unicode_user_comment(&utf16_bytes(text, endian));
            assert_eq!(
                decode_user_comment(&comment, endian).as_deref(),
                Some(text),
                "non-printable bytes must not be counted as opposite-endian ASCII"
            );
        }
    }

    #[test]
    fn test_decode_user_comment_keeps_tiff_order_when_inferred_text_is_not_metadata() {
        let text = "\u{4100}\u{4100}";

        for endian in [TiffEndian::Big, TiffEndian::Little] {
            let comment = unicode_user_comment(&utf16_bytes(text, endian));
            assert_eq!(
                decode_user_comment(&comment, endian).as_deref(),
                Some(text),
                "printable NUL-lane evidence alone must not override valid TIFF-ordered UTF-16"
            );
        }
    }

    #[test]
    fn test_decode_user_comment_rejects_incomplete_invalid_unicode_payload() {
        let comment = unicode_user_comment(&[0xFF]);
        assert_eq!(decode_user_comment(&comment, TiffEndian::Little), None);
    }

    #[test]
    fn test_decode_user_comment_preserves_ascii_tag_behavior() {
        assert_eq!(
            decode_user_comment(b"ASCII\0\0\0  Safe JPEG\0", TiffEndian::Little).as_deref(),
            Some("Safe JPEG")
        );
    }

    #[test]
    fn test_parse_exif_le_ascii() {
        // Simple case: UserComment directly in IFD0
        let mut data = vec![0u8; 100];
        data[0..2].copy_from_slice(b"II");
        data[2..4].copy_from_slice(&0x2Au16.to_le_bytes());
        data[4..8].copy_from_slice(&8u32.to_le_bytes());

        // IFD0: 1 entry
        data[8..10].copy_from_slice(&1u16.to_le_bytes());

        // Entry 1: UserComment (0x9286)
        let entry_offset = 10;
        data[entry_offset..entry_offset + 2].copy_from_slice(&0x9286u16.to_le_bytes());
        data[entry_offset + 2..entry_offset + 4].copy_from_slice(&7u16.to_le_bytes()); // Undefined type
        data[entry_offset + 4..entry_offset + 8].copy_from_slice(&19u32.to_le_bytes()); // Count (8 + 11)
        data[entry_offset + 8..entry_offset + 12].copy_from_slice(&30u32.to_le_bytes()); // Offset 30

        // Data at offset 30
        let data_start = 30;
        data[data_start..data_start + 8].copy_from_slice(b"ASCII\0\0\0");
        data[data_start + 8..data_start + 19].copy_from_slice(b"Hello World");

        let result = parse_exif(&data);
        assert!(result.is_some(), "Result should be Some");
        assert_eq!(result.unwrap(), "Hello World");
    }

    #[test]
    fn test_scan_jpeg_metadata_rejects_app1_length_zero() {
        let jpeg = jpeg_with_segment(0xE1, 0, &[]);
        let chunks = scan_test_jpeg("jpeg_app1_len_zero", &jpeg).unwrap();
        assert!(
            chunks.is_empty(),
            "malformed APP1 length 0 should be treated as unreadable metadata"
        );
    }

    #[test]
    fn test_scan_jpeg_metadata_rejects_app1_length_one() {
        let jpeg = jpeg_with_segment(0xE1, 1, &[]);
        let chunks = scan_test_jpeg("jpeg_app1_len_one", &jpeg).unwrap();
        assert!(
            chunks.is_empty(),
            "malformed APP1 length 1 should be treated as unreadable metadata"
        );
    }

    #[test]
    fn test_scan_jpeg_metadata_rejects_non_app1_malformed_lengths() {
        for raw_len in [0, 1] {
            let jpeg = jpeg_with_segment(0xE0, raw_len, &[]);
            let chunks = scan_test_jpeg("jpeg_non_app1_bad_len", &jpeg).unwrap();
            assert!(
                chunks.is_empty(),
                "malformed non-APP1 length {raw_len} should stop scanning safely"
            );
        }
    }

    #[test]
    fn test_scan_jpeg_metadata_truncated_app1_segment_is_non_fatal() {
        let jpeg = jpeg_with_segment(0xE1, 10, b"Ex");
        let chunks = scan_test_jpeg("jpeg_truncated_app1", &jpeg).unwrap();
        assert!(
            chunks.is_empty(),
            "truncated APP1 data should not prevent library scanning"
        );
    }

    #[test]
    fn test_scan_jpeg_metadata_reads_valid_exif_user_comment() {
        let payload = exif_user_comment_payload(b"Safe JPEG");
        let raw_len = (payload.len() + 2) as u16;
        let jpeg = jpeg_with_segment(0xE1, raw_len, &payload);

        let chunks = scan_test_jpeg("jpeg_valid_exif", &jpeg).unwrap();

        assert_eq!(
            chunks.get("parameters").map(String::as_str),
            Some("Safe JPEG")
        );
    }

    #[test]
    fn test_scan_jpeg_metadata_reads_civitai_utf16be_user_comment() {
        let parameters = "portrait\nNegative prompt: blur\nSteps: 24, Sampler: Euler";
        let comment = unicode_user_comment(&utf16_bytes(parameters, TiffEndian::Big));
        let payload = exif_user_comment_raw_payload(&comment);
        let raw_len = (payload.len() + 2) as u16;
        let jpeg = jpeg_with_segment(0xE1, raw_len, &payload);

        let chunks = scan_test_jpeg("jpeg_civitai_utf16be", &jpeg).unwrap();

        assert_eq!(
            chunks.get("parameters").map(String::as_str),
            Some(parameters),
            "little-endian TIFF must preserve CivitAI's UTF-16BE UserComment"
        );
    }

    #[test]
    fn test_scan_webp_metadata_reads_civitai_utf16be_user_comment() {
        let parameters = "portrait\nNegative prompt: blur\nSteps: 24, Sampler: Euler";
        let comment = unicode_user_comment(&utf16_bytes(parameters, TiffEndian::Big));
        let payload = exif_user_comment_raw_payload(&comment);
        let webp = webp_with_exif(&payload);

        let chunks = scan_test_webp("webp_civitai_utf16be", &webp).unwrap();

        assert_eq!(
            chunks.get("parameters").map(String::as_str),
            Some(parameters),
            "WebP EXIF must use the same robust UserComment decoding as JPEG"
        );
    }

    #[test]
    fn test_scan_jpeg_metadata_normalizes_comfy_exif_make_model() {
        let workflow = r#"{"nodes":[]}"#;
        let prompt = r#"{"1":{"class_type":"KSampler","inputs":{"steps":20}}}"#;
        let workflow_tag = format!("workflow:{workflow}");
        let prompt_tag = format!("prompt:{prompt}");
        let payload =
            exif_ascii_tags_payload(&[(TAG_MAKE, &workflow_tag), (TAG_MODEL, &prompt_tag)]);
        let raw_len = (payload.len() + 2) as u16;
        let jpeg = jpeg_with_segment(0xE1, raw_len, &payload);

        let chunks = scan_test_jpeg("jpeg_comfy_make_model", &jpeg).unwrap();

        assert_eq!(chunks.get("workflow").map(String::as_str), Some(workflow));
        assert_eq!(chunks.get("prompt").map(String::as_str), Some(prompt));
        assert!(
            !chunks.contains_key("parameters"),
            "Comfy EXIF tags should not be misrouted as A1111 parameters"
        );
    }

    #[test]
    fn test_scan_webp_metadata_normalizes_comfy_exif_make_model() {
        let workflow = r#"{"nodes":[]}"#;
        let prompt = r#"{"1":{"class_type":"KSampler","inputs":{"steps":20}}}"#;
        let workflow_tag = format!("workflow:{workflow}");
        let prompt_tag = format!("prompt:{prompt}");
        let payload =
            exif_ascii_tags_payload(&[(TAG_MAKE, &workflow_tag), (TAG_MODEL, &prompt_tag)]);
        let webp = webp_with_exif(&payload);

        let chunks = scan_test_webp("webp_comfy_make_model", &webp).unwrap();

        assert_eq!(chunks.get("workflow").map(String::as_str), Some(workflow));
        assert_eq!(chunks.get("prompt").map(String::as_str), Some(prompt));
    }

    #[test]
    fn test_scan_jpeg_metadata_splits_comfy_json_user_comment() {
        let workflow = r#"{"nodes":[]}"#;
        let prompt = r#"{"1":{"class_type":"KSampler","inputs":{"steps":20}}}"#;
        let comment = format!(r#"{{"workflow":{workflow},"prompt":{prompt}}}"#);
        let payload = exif_user_comment_payload(comment.as_bytes());
        let raw_len = (payload.len() + 2) as u16;
        let jpeg = jpeg_with_segment(0xE1, raw_len, &payload);

        let chunks = scan_test_jpeg("jpeg_comfy_json_user_comment", &jpeg).unwrap();

        assert_eq!(chunks.get("workflow").map(String::as_str), Some(workflow));
        assert_eq!(chunks.get("prompt").map(String::as_str), Some(prompt));
        assert!(
            !chunks.contains_key("parameters"),
            "recognized Comfy JSON should bypass A1111 parameter fallback"
        );
    }

    #[test]
    fn test_extract_png_chunks_basic() {
        // Mock a minimal PNG with a tEXt chunk
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // Header

        // chunk 1: tEXt (14 bytes: Software\0Ambit)
        png.extend_from_slice(&14u32.to_be_bytes());
        png.extend_from_slice(b"tEXt");
        png.extend_from_slice(b"Software\0Ambit");
        png.extend_from_slice(&[0; 4]); // CRC

        // chunk 2: IEND
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0xAE, 0x42, 0x60, 0x82]); // IEND CRC

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();
        assert_eq!(chunks.get("Software").map(|s| s.as_str()), Some("Ambit"));
    }

    #[test]
    fn test_extract_png_chunks_caps_aggregate_text_bytes() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_a",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize,
                b'a',
            ),
        );
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_b",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2) as usize,
                b'b',
            ),
        );
        push_png_chunk(&mut png, b"tEXt", b"too_late\0nope");
        push_png_chunk(&mut png, b"tEXt", b"after_limit\0small");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert_eq!(
            chunks.get("filler_a").map(|s| s.len()),
            Some((MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize)
        );
        assert!(!chunks.contains_key("too_late"));
        assert!(!chunks.contains_key("after_limit"));
    }

    #[test]
    fn test_extract_png_chunks_caps_aggregate_raw_metadata_bytes() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");

        let filler = vec![0u8; 4 * 1024 * 1024];
        for _ in 0..8 {
            push_png_chunk(&mut png, b"eXIf", &filler);
        }

        push_png_chunk(&mut png, b"tEXt", b"too_late\0nope");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("too_late"));
    }

    #[test]
    fn test_extract_png_chunks_caps_itxt_decoded_budget() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"iTXt", b"early\0\0\0\0\0ok");
        push_png_chunk(
            &mut png,
            b"iTXt",
            &itxt_uncompressed_data(
                "filler_a",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize,
                b'a',
            ),
        );
        push_png_chunk(
            &mut png,
            b"iTXt",
            &itxt_uncompressed_data(
                "filler_b",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2) as usize,
                b'b',
            ),
        );
        push_png_chunk(&mut png, b"iTXt", b"too_late\0\0\0\0\0nope");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert_eq!(
            chunks.get("filler_b").map(|s| s.len()),
            Some((MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2) as usize)
        );
        assert!(!chunks.contains_key("too_late"));
    }

    #[test]
    fn test_extract_png_chunks_caps_compressed_text_by_remaining_budget() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_a",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize,
                b'a',
            ),
        );
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_b",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 2) as usize,
                b'b',
            ),
        );
        push_png_chunk(&mut png, b"zTXt", &ztxt_chunk_data("too_late", b"nope"));
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("too_late"));
    }

    #[test]
    fn test_extract_png_chunks_ztxt_over_limit_exhausts_decoded_budget() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_a",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize,
                b'a',
            ),
        );
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_b",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 3) as usize,
                b'b',
            ),
        );
        push_png_chunk(&mut png, b"zTXt", &ztxt_chunk_data("too_large", b"nope"));
        push_png_chunk(&mut png, b"tEXt", b"late\0x");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("too_large"));
        assert!(!chunks.contains_key("late"));
    }

    #[test]
    fn test_extract_png_chunks_compressed_itxt_over_limit_exhausts_decoded_budget() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_a",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize,
                b'a',
            ),
        );
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_b",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 3) as usize,
                b'b',
            ),
        );
        push_png_chunk(
            &mut png,
            b"iTXt",
            &itxt_compressed_data("too_large", b"nope"),
        );
        push_png_chunk(&mut png, b"tEXt", b"late\0x");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("too_large"));
        assert!(!chunks.contains_key("late"));
    }

    #[test]
    fn test_extract_png_chunks_ztxt_over_limit_invalid_utf8_exhausts_decoded_budget() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_a",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize,
                b'a',
            ),
        );
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_b",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 3) as usize,
                b'b',
            ),
        );
        push_png_chunk(
            &mut png,
            b"zTXt",
            &ztxt_chunk_data("too_large_invalid_utf8", &[0xff, 0xff]),
        );
        push_png_chunk(&mut png, b"tEXt", b"late\0x");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("too_large_invalid_utf8"));
        assert!(!chunks.contains_key("late"));
    }

    #[test]
    fn test_extract_png_chunks_compressed_itxt_over_limit_invalid_utf8_exhausts_decoded_budget() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_a",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2) as usize,
                b'a',
            ),
        );
        push_png_chunk(
            &mut png,
            b"tEXt",
            &text_chunk_data(
                "filler_b",
                (MAX_PNG_DECODED_TEXT_TOTAL_BYTES / 2 - 3) as usize,
                b'b',
            ),
        );
        push_png_chunk(
            &mut png,
            b"iTXt",
            &itxt_compressed_data("too_large_invalid_utf8", &[0xff, 0xff]),
        );
        push_png_chunk(&mut png, b"tEXt", b"late\0x");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("too_large_invalid_utf8"));
        assert!(!chunks.contains_key("late"));
    }

    #[test]
    fn test_extract_png_chunks_within_limit_invalid_utf8_skips_only_current_chunk() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(&mut png, b"zTXt", &ztxt_chunk_data("invalid_utf8", &[0xff]));
        push_png_chunk(&mut png, b"tEXt", b"late\0yes");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("invalid_utf8"));
        assert_eq!(chunks.get("late").map(|s| s.as_str()), Some("yes"));
    }

    #[test]
    fn test_extract_png_chunks_invalid_compressed_text_does_not_exhaust_budget() {
        let mut png = png_fixture();
        push_png_chunk(&mut png, b"tEXt", b"early\0ok");
        push_png_chunk(
            &mut png,
            b"zTXt",
            b"invalid_compressed\0\0not valid deflate",
        );
        push_png_chunk(&mut png, b"tEXt", b"late\0yes");
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(chunks.get("early").map(|s| s.as_str()), Some("ok"));
        assert!(!chunks.contains_key("invalid_compressed"));
        assert_eq!(chunks.get("late").map(|s| s.as_str()), Some("yes"));
    }

    #[test]
    fn test_extract_png_chunks_ztxt_compressed() {
        let mut png = png_fixture();
        push_png_chunk(
            &mut png,
            b"zTXt",
            &ztxt_chunk_data("Comment", b"CompressedValue"),
        );
        push_iend(&mut png);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();

        assert_eq!(
            chunks.get("Comment").map(|s| s.as_str()),
            Some("CompressedValue")
        );
    }

    #[test]
    fn test_extract_png_chunks_skips_oversized_metadata_chunk() {
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let oversized_len = MAX_PNG_METADATA_CHUNK_BYTES + 1;

        png.extend_from_slice(&(oversized_len as u32).to_be_bytes());
        png.extend_from_slice(b"tEXt");
        png.extend(std::iter::repeat(0u8).take(oversized_len as usize));
        png.extend_from_slice(&[0; 4]);

        png.extend_from_slice(&14u32.to_be_bytes());
        png.extend_from_slice(b"tEXt");
        png.extend_from_slice(b"Software\0Ambit");
        png.extend_from_slice(&[0; 4]);

        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0; 4]);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();
        assert!(!chunks.contains_key(""));
        assert_eq!(chunks.get("Software").map(|s| s.as_str()), Some("Ambit"));
    }

    #[test]
    fn test_extract_png_chunks_rejects_compressed_text_bomb() {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let expanded = vec![b'a'; (MAX_PNG_DECOMPRESSED_TEXT_BYTES + 1) as usize];

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&expanded).unwrap();
        let compressed_text = encoder.finish().unwrap();

        let mut data = Vec::new();
        data.extend_from_slice(b"Comment");
        data.push(0);
        data.push(0);
        data.extend_from_slice(&compressed_text);

        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"zTXt");
        png.extend_from_slice(&data);
        png.extend_from_slice(&[0; 4]);

        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0; 4]);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();
        assert!(!chunks.contains_key("Comment"));
    }

    #[test]
    fn test_extract_png_chunks_itxt_uncompressed() {
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

        // iTXt chunk: "Keyword\0(0)(0)en\0Translated\0Value"
        // Compression flag: 0
        // Compression method: 0
        // Lang tag: "en"
        // Trans keyword: "Translated"
        // Text: "Value"

        let keyword = b"Keyword";
        let lang = b"en";
        let trans = b"Translated";
        let text = b"Value";

        let mut data = Vec::new();
        data.extend_from_slice(keyword);
        data.push(0); // null separator
        data.push(0); // compression flag (uncompressed)
        data.push(0); // compression method
        data.extend_from_slice(lang);
        data.push(0); // null separator
        data.extend_from_slice(trans);
        data.push(0); // null separator
        data.extend_from_slice(text);

        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"iTXt");
        png.extend_from_slice(&data);
        png.extend_from_slice(&[0; 4]); // CRC

        png.extend_from_slice(&0u32.to_be_bytes()); // IEND
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0; 4]);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();
        assert_eq!(chunks.get("Keyword").map(|s| s.as_str()), Some("Value"));
    }

    #[test]
    fn test_extract_png_chunks_itxt_compressed() {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

        let keyword = b"Keyword";
        let text = b"CompressedValue";

        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(text).unwrap();
        let compressed_text = encoder.finish().unwrap();

        let mut data = Vec::new();
        data.extend_from_slice(keyword);
        data.push(0);
        data.push(1); // compression flag (compressed)
        data.push(0); // compression method
        data.push(0); // empty lang
        data.push(0); // empty trans
        data.extend_from_slice(&compressed_text);

        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"iTXt");
        png.extend_from_slice(&data);
        png.extend_from_slice(&[0; 4]);

        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0; 4]);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();
        assert_eq!(
            chunks.get("Keyword").map(|s| s.as_str()),
            Some("CompressedValue")
        );
    }

    #[test]
    fn test_extract_png_chunks_exif_with_header() {
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

        // Construct EXIF data with "Exif\0\0" prefix
        let mut exif_data = Vec::new();
        exif_data.extend_from_slice(b"Exif\0\0");

        // TIFF Header (II)
        exif_data.extend_from_slice(b"II");
        exif_data.extend_from_slice(&0x2Au16.to_le_bytes()); // 42
        exif_data.extend_from_slice(&8u32.to_le_bytes()); // Offset to IFD0

        // IFD0
        exif_data.extend_from_slice(&1u16.to_le_bytes()); // 1 entry
                                                          // UserComment tag
        exif_data.extend_from_slice(&0x9286u16.to_le_bytes());
        exif_data.extend_from_slice(&7u16.to_le_bytes()); // Undefined
        exif_data.extend_from_slice(&17u32.to_le_bytes()); // Count (8 + 9)
        exif_data.extend_from_slice(&30u32.to_le_bytes()); // Offset

        // Next IFD
        exif_data.extend_from_slice(&0u32.to_le_bytes());

        // Padding to offset 30
        while exif_data.len() < (30 + 6) {
            // 30 is offset relative to TIFF start (byte 6)
            exif_data.push(0);
        }

        // Value at 30+6
        exif_data.extend_from_slice(b"ASCII\0\0\0");
        exif_data.extend_from_slice(b"ExifValue");

        png.extend_from_slice(&(exif_data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"eXIf");
        png.extend_from_slice(&exif_data);
        png.extend_from_slice(&[0; 4]);

        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0; 4]);

        let mut cursor = Cursor::new(png);
        let chunks = extract_png_chunks(&mut cursor).unwrap();
        assert_eq!(
            chunks.get("parameters").map(|s| s.as_str()),
            Some("ExifValue")
        );
    }
}
