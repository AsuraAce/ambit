use crate::metadata;
use serde::Serialize;
use specta::Type;
use std::collections::HashMap;

#[derive(Serialize, Default, Type)]
pub struct FolderStats {
    #[serde(rename = "totalFiles")]
    pub total_files: usize,
    #[serde(rename = "imageFiles")]
    pub image_files: usize,
    #[serde(rename = "thumbnailFiles")]
    pub thumbnail_files: usize,
    #[serde(rename = "otherFiles")]
    pub other_files: usize,
    #[serde(rename = "directoryChecked")]
    pub directory_checked: String,
    #[serde(rename = "subfolders")]
    pub subfolders: HashMap<String, usize>,
}

#[derive(Serialize, Type)]
pub struct ScanResult {
    pub width: u32,
    pub height: u32,
    pub size: u64,
    pub modified: u64,
    pub thumbnail: String,
    /// Base64 encoded 32px WebP micro-thumbnail for instant previews
    #[serde(rename = "microThumbnail")]
    pub micro_thumbnail: Option<String>,
    /// Source of the thumbnail: 'ambit', 'invokeai', etc.
    #[serde(rename = "thumbnailSource")]
    pub thumbnail_source: Option<String>,
    pub chunks: HashMap<String, String>,
    pub metadata: Option<metadata::ImageMetadata>,
    /// Error message if scan failed or resulted in a partial result
    pub error: Option<String>,
    #[serde(rename = "thumbnailVersion")]
    pub thumbnail_version: u32,
    #[serde(rename = "detectedSourceKind")]
    pub detected_source_kind: metadata::photo::SourceKind,
    #[serde(rename = "photoMetadata")]
    pub photo_metadata: Option<metadata::photo::PhotoMetadata>,
    #[serde(rename = "photoMetadataError")]
    pub photo_metadata_error: Option<String>,
    #[serde(rename = "captureWallTimeMs")]
    pub capture_wall_time_ms: Option<i64>,
}

#[derive(Serialize, Type)]
pub struct FileEntry {
    pub path: String,
    pub modified: u64,
    pub size: u64,
}
