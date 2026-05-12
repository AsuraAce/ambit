use flate2::read::ZlibDecoder;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

const MAX_PNG_METADATA_CHUNK_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PNG_DECOMPRESSED_TEXT_BYTES: u64 = 10 * 1024 * 1024;

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
        if m_type == 0xD9 {
            break;
        } // EOI

        // Length
        let mut len_bytes = [0; 2];
        if file.read_exact(&mut len_bytes).is_err() {
            break;
        }
        let len = (u16::from_be_bytes(len_bytes) as usize) - 2;

        if m_type == 0xE1 {
            // APP1 - EXIF
            let mut app1_data = vec![0; len];
            if file.read_exact(&mut app1_data).is_ok() {
                if app1_data.starts_with(b"Exif\0\0") {
                    if let Some(comment) = parse_exif(&app1_data[6..]) {
                        chunks.insert("parameters".to_string(), comment);
                    }
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

fn skip_chunk_data_and_crc<R: Seek>(reader: &mut R, length: u64) -> Result<(), String> {
    reader
        .seek(SeekFrom::Current((length + 4) as i64))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn read_limited_zlib_text(data: &[u8]) -> Option<String> {
    let decoder = ZlibDecoder::new(data);
    let mut limited = decoder.take(MAX_PNG_DECOMPRESSED_TEXT_BYTES + 1);
    let mut s = String::new();

    if limited.read_to_string(&mut s).is_ok() && s.len() as u64 <= MAX_PNG_DECOMPRESSED_TEXT_BYTES {
        Some(s)
    } else {
        None
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

                if let Some(comment) = parse_exif(data_slice) {
                    chunks.insert("parameters".to_string(), comment);
                }
            } else if let Some(pos) = chunk_data.iter().position(|&x| x == 0) {
                let key = String::from_utf8_lossy(&chunk_data[0..pos]).to_string();

                if chunk_type == "zTXt" {
                    if pos + 2 < chunk_data.len() && chunk_data[pos + 1] == 0 {
                        let compressed = &chunk_data[pos + 2..];
                        if let Some(s) = read_limited_zlib_text(compressed) {
                            chunks.insert(key, s);
                        }
                    }
                } else if chunk_type == "tEXt" {
                    if pos + 1 < chunk_data.len() {
                        let val = String::from_utf8_lossy(&chunk_data[pos + 1..]).to_string();
                        chunks.insert(key, val);
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
                                if let Some(s) = read_limited_zlib_text(data_slice) {
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
            // Efficiently skip data + CRC O(1) without thrashing OS disk I/O
            skip_chunk_data_and_crc(reader, length)?;
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
        if offset + 2 > data.len() {
            return None;
        }
        let slice = &data[offset..offset + 2];
        let arr: [u8; 2] = slice.try_into().ok()?;
        Some(if is_little_endian {
            u16::from_le_bytes(arr)
        } else {
            u16::from_be_bytes(arr)
        })
    };

    let get_u32 = |offset: usize| -> Option<u32> {
        if offset + 4 > data.len() {
            return None;
        }
        let slice = &data[offset..offset + 4];
        let arr: [u8; 4] = slice.try_into().ok()?;
        Some(if is_little_endian {
            u32::from_le_bytes(arr)
        } else {
            u32::from_be_bytes(arr)
        })
    };

    if get_u16(2)? != 0x002A {
        return None;
    }

    let first_ifd_offset = get_u32(4)? as usize;
    if first_ifd_offset < 8 || first_ifd_offset >= data.len() {
        return None;
    }

    // Helper to read IFD
    fn read_ifd_internal(data: &[u8], offset: usize, is_le: bool) -> Option<String> {
        if offset + 2 > data.len() {
            return None;
        }

        // Helper closures again inside logic to capture is_le
        let get_u16_inner = |o: usize| -> Option<u16> {
            if o + 2 > data.len() {
                return None;
            }
            let s = &data[o..o + 2];
            let a: [u8; 2] = s.try_into().ok()?;
            Some(if is_le {
                u16::from_le_bytes(a)
            } else {
                u16::from_be_bytes(a)
            })
        };
        let get_u32_inner = |o: usize| -> Option<u32> {
            if o + 4 > data.len() {
                return None;
            }
            let s = &data[o..o + 4];
            let a: [u8; 4] = s.try_into().ok()?;
            Some(if is_le {
                u32::from_le_bytes(a)
            } else {
                u32::from_be_bytes(a)
            })
        };

        let entry_count = get_u16_inner(offset)?;
        let entries_start = offset + 2;

        let mut exif_ifd_offset = 0;

        for i in 0..entry_count {
            let entry_offset = entries_start + (i as usize * 12);
            if entry_offset + 12 > data.len() {
                break;
            }

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
                    let header_slice = &data[data_offset..data_offset + 8];
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
                                .map(|c| {
                                    if is_le {
                                        u16::from_le_bytes([c[0], c[1]])
                                    } else {
                                        u16::from_be_bytes([c[0], c[1]])
                                    }
                                })
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
                            let s = String::from_utf8_lossy(
                                &data[payload_start..payload_start + payload_len],
                            );
                            return Some(s.trim_matches('\0').trim().to_string());
                        }
                    } else if data[data_offset] == 0 {
                        // Some writers use no header, just 0 pad if undefined type
                        let payload_len = count as usize;
                        if data_offset + payload_len <= data.len() {
                            let s = String::from_utf8_lossy(
                                &data[data_offset..data_offset + payload_len],
                            );
                            return Some(s.trim_matches('\0').trim().to_string());
                        }
                    } else {
                        // Try raw
                        let payload_len = count as usize;
                        if data_offset + payload_len <= data.len() {
                            let s = String::from_utf8_lossy(
                                &data[data_offset..data_offset + payload_len],
                            );
                            return Some(s.trim_matches('\0').trim().to_string());
                        }
                    }
                }
            }
        }

        if exif_ifd_offset > 0 {
            return None;
        }

        None
    }

    // Pass 1: Root IFD (IFD0)
    let res = read_ifd_internal(data, first_ifd_offset, is_little_endian);
    if res.is_some() {
        return res;
    }

    // If we didn't find UserComment in IFD0, check if we found an Exif Pointer.
    let entry_count = get_u16(first_ifd_offset)?;
    let entries_start = first_ifd_offset + 2;
    for i in 0..entry_count {
        let entry_offset = entries_start + (i as usize * 12);
        if entry_offset + 12 > data.len() {
            break;
        }

        let tag = get_u16(entry_offset)?;
        if tag == 0x8769 {
            let value_offset = get_u32(entry_offset + 8)?;
            // Call reader on Exif IFD
            return read_ifd_internal(data, value_offset as usize, is_little_endian);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

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
