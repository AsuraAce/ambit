use specta::Type;
use serde::Serialize;
use std::collections::HashMap;
use crate::metadata;

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
    pub chunks: HashMap<String, String>,
    pub metadata: Option<metadata::ImageMetadata>,
}
