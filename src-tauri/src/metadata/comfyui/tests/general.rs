use crate::metadata::comfyui::*;
use std::collections::HashMap;

#[test]
fn test_extract_comfyui_nan_json() {
    // ComfyUI metadata occasionally contains NaN or Infinity which is invalid JSON
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "steps": 20,
                "is_changed": NaN
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    // This should NOT panic or return empty metadata if we sanitize correctly
    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.steps, 20);
}

#[test]
fn test_extract_comfyui_preserves_zero_seed() {
    let prompt = r#"{
        "1": {
            "class_type": "SDParameterGenerator",
            "inputs": {
                "seed": 0
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.seed, Some(0));
}
