use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use super::super::extract_comfyui_metadata_with_diagnostics;
use std::collections::HashMap;

#[test]
fn test_unet_loader_extraction() {
    let workflow = r#"{
        "id": "ad18abd3-bdee-4f80-8fae-d15d4f845b9d",
        "nodes": [
            {
                "id": 12,
                "type": "UNETLoader",
                "widgets_values": ["qwen_image_edit_2511_bf16.safetensors", "default"]
            },
            {
                "id": 89,
                "type": "UnetLoaderGGUF",
                "widgets_values": ["qwen-image-edit-2511-Q4_K_M.gguf"]
            },
            {
                "id": 65,
                "type": "KSampler",
                "widgets_values": [0, "randomize", 4, 1, "euler", "simple", 1]
            }
        ],
        "links": []
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "qwen_image_edit_2511_bf16");
    assert_eq!(meta.seed, Some(0));
    assert_eq!(meta.steps, 4);
    assert_eq!(meta.cfg, 1.0);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&ComfyParseLayer::GlobalScan),
        "competing disconnected model loaders must not gain wireless authority"
    );
    for field in [
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::SamplerFallback),
            "disconnected sampler should provide {field:?} only as fallback evidence"
        );
    }
}

#[test]
fn test_gguf_loader_extraction() {
    let workflow = r#"{
        "id": "gguf_test",
        "nodes": [
            {
                "id": 89,
                "type": "UnetLoaderGGUF",
                "widgets_values": ["qwen-image-edit-2511-Q4_K_M.gguf"]
            }
        ],
        "links": []
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "qwen_image_edit_2511_q4_k_m");
    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&ComfyParseLayer::GlobalScan),
        "loader-only model recovery should remain weak global evidence"
    );
}

#[test]
fn sole_disconnected_gguf_loader_can_supply_sampler_fallback_model() {
    let workflow = r#"{
        "id": "gguf_sampler_fallback",
        "nodes": [
            {
                "id": 65,
                "type": "KSampler",
                "widgets_values": [0, "randomize", 4, 1, "euler", "simple", 1]
            },
            {
                "id": 89,
                "type": "UnetLoaderGGUF",
                "widgets_values": ["qwen-image-edit-2511-Q4_K_M.gguf"]
            }
        ],
        "links": []
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "qwen_image_edit_2511_q4_k_m");
    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&ComfyParseLayer::SamplerFallback),
        "one eligible disconnected loader may provide weak sampler fallback evidence"
    );
}
