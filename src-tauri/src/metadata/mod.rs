pub mod a1111;
pub mod invokeai;
pub mod comfyui;
pub mod parsers;
pub mod resources;

pub use a1111::extract_a1111_metadata;
pub use invokeai::extract_invokeai_metadata;
pub use comfyui::extract_comfyui_metadata;
pub use parsers::{extract_png_chunks, scan_jpeg_metadata};

#[derive(serde::Serialize, Clone)]
pub struct ImageMetadata {
    pub tool: String,
    pub model: String,
    #[serde(rename = "rawParameters", skip_serializing_if = "Option::is_none")]
    pub raw_parameters: Option<String>,
    pub steps: u32,
    pub cfg: f32,
    pub seed: i64,
    pub sampler: String,
    #[serde(rename = "positivePrompt")]
    pub positive_prompt: String,
    #[serde(rename = "negativePrompt")]
    pub negative_prompt: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub loras: Vec<String>,
    #[serde(rename = "controlNets", skip_serializing_if = "Vec::is_empty")]
    pub control_nets: Vec<String>,
    #[serde(rename = "variationId", skip_serializing_if = "Option::is_none")]
    pub variation_id: Option<String>,
    #[serde(rename = "isIntermediate", default)]
    pub is_intermediate: bool,
    #[serde(rename = "isGrid", default)]
    pub is_grid: bool,
    #[serde(rename = "workflowJson", skip_serializing_if = "Option::is_none")]
    pub workflow_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vae: Option<String>,
    #[serde(rename = "clipSkip", skip_serializing_if = "Option::is_none")]
    pub clip_skip: Option<u32>,
    #[serde(rename = "denoisingStrength", skip_serializing_if = "Option::is_none")]
    pub denoising_strength: Option<f32>,
    #[serde(rename = "hiresUpscale", skip_serializing_if = "Option::is_none")]
    pub hires_upscale: Option<f32>,
    #[serde(rename = "hiresSteps", skip_serializing_if = "Option::is_none")]
    pub hires_steps: Option<u32>,
    #[serde(rename = "hiresUpscaler", skip_serializing_if = "Option::is_none")]
    pub hires_upscaler: Option<String>,
    #[serde(rename = "modelHash", skip_serializing_if = "Option::is_none")]
    pub model_hash: Option<String>,
    #[serde(rename = "generationType")]
    pub generation_type: String,
}

impl Default for ImageMetadata {
    fn default() -> Self {
        Self {
            tool: "Unknown".to_string(),
            model: "Unknown".to_string(),
            raw_parameters: None,
            steps: 0,
            cfg: 0.0,
            seed: 0,
            sampler: "Unknown".to_string(),
            positive_prompt: String::new(),
            negative_prompt: String::new(),
            loras: Vec::new(),
            control_nets: Vec::new(),
            variation_id: None,
            is_intermediate: false,
            is_grid: false,
            workflow_json: None,
            vae: None,
            clip_skip: None,
            denoising_strength: None,
            hires_upscale: None,
            hires_steps: None,
            hires_upscaler: None,
            model_hash: None,
            generation_type: "unknown".to_string(),
        }
    }
}

pub fn detect_generation_type(path: &std::path::Path) -> String {
    let lower_path = path.to_string_lossy().to_lowercase().replace('\\', "/");
    if lower_path.contains("/txt2img-images") || lower_path.contains("/outputs/txt2img") || lower_path.contains("/txt2img/") || lower_path.contains("/text/") {
        "txt2img".to_string()
    } else if lower_path.contains("/img2img-images") || lower_path.contains("/outputs/img2img") || lower_path.contains("/img2img/") || lower_path.contains("/image/") {
        "img2img".to_string()
    } else if lower_path.contains("/extras-images") || lower_path.contains("/outputs/extras") || lower_path.contains("/extras/") || lower_path.contains("/save") || lower_path.contains("/saved") {
        "extras".to_string()
    } else if lower_path.contains("-grids") || lower_path.contains("/grids/") {
        "grid".to_string()
    } else {
        "unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_detect_generation_type() {
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/txt2img-images/image.png")), "txt2img");
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/img2img-images/image.png")), "img2img");
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/extras-images/image.png")), "extras");
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/txt2img-grids/image.png")), "grid");
        assert_eq!(detect_generation_type(&PathBuf::from("D:/SDNext/outputs/txt2img/2023-10-01/image.png")), "txt2img");
        assert_eq!(detect_generation_type(&PathBuf::from("D:\\SDNext\\outputs\\txt2img\\image.png")), "txt2img");
        assert_eq!(detect_generation_type(&PathBuf::from("/path/to/random/image.png")), "unknown");
    }
}
