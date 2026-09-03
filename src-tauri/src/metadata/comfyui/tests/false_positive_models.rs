use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use super::super::{extract_comfyui_metadata, extract_comfyui_metadata_with_diagnostics};
use std::collections::HashMap;

fn samplerless_output_prompt(extra_nodes: &str) -> String {
    format!(
        r#"{{
            "1": {{ "class_type": "CheckpointLoaderSimple", "inputs": {{ "ckpt_name": "utility-model.safetensors" }} }},
            "2": {{ "class_type": "CLIPTextEncode", "inputs": {{ "text": "utility selector text" }} }},
            "3": {{ "class_type": "LoadImage", "inputs": {{ "image": "input.png" }} }},
            "4": {{ "class_type": "PreviewImage", "inputs": {{ "images": ["3", 0] }} }}
            {extra_nodes}
        }}"#
    )
}

#[test]
fn test_upscale_model_false_positive() {
    let workflow = r#"{"id":"9ae6082b-c7f4-433c-9971-7a8f65a3ea65","nodes":[{"id":56,"type":"UpscaleModelLoader","widgets_values":["4x_NMKD-Siax_200k.pth"]},{"id":86,"type":"CheckpointLoaderSimple","widgets_values":["zImageTurbo\\moodyPornMix_zitV6.safetensors"]},{"id":44,"type":"KSampler","widgets_values":[896062275555069,"randomize",8,1,"res_multistep","simple",1]}],"links":[]}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    println!("Extracted Model: {}", meta.model);

    // Should NOT be the upscale model
    assert!(
        !meta.model.contains("4x_NMKD"),
        "Should not extract upscale model as main model"
    );

    // Should be the actual checkpoint
    assert!(
        meta.model.contains("moodypornmix"),
        "Should extract the actual checkpoint. Got: {}",
        meta.model
    );
}

#[test]
fn test_bbox_model_false_positive() {
    let workflow = r#"{"id":"bbox_test","nodes":[{"id":100,"type":"UltralyticsDetectorProvider","widgets_values":["bbox/face_yolov8m.pt"]},{"id":86,"type":"CheckpointLoaderSimple","widgets_values":["real_model.safetensors"]}],"links":[]}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);
    assert!(
        !meta.model.contains("yolov8m"),
        "Should not extract bbox model"
    );
    assert!(
        meta.model.contains("real_model"),
        "Should extract real model"
    );
}

#[test]
fn test_controlnet_model_false_positive() {
    let workflow = r#"{"nodes":[{"id":12,"type":"ControlNetLoader","widgets_values":["qwen_controlnet.safetensors"]},{"id":86,"type":"UNETLoader","widgets_values":["qwen_image_model.safetensors"]}],"links":[]}"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(
        meta.model, "qwen_image_model",
        "generic fallback must not promote a ControlNet resource to the primary model"
    );
}

#[test]
fn selected_samplerless_output_does_not_invent_generation_metadata() {
    let prompt = samplerless_output_prompt("");
    let chunks = HashMap::from([("prompt".to_string(), prompt)]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "Unknown");
    assert_eq!(meta.seed, None);
    assert_eq!(meta.steps, 0);
    assert_eq!(meta.cfg, 0.0);
    assert_eq!(meta.sampler, "Unknown");
    assert!(meta.positive_prompt.is_empty());
    assert!(meta.negative_prompt.is_empty());
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 0);
    assert!(!diagnostics.output_ambiguous);
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::SamplerFallback));
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::GlobalScan));
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::Model));
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::PositivePrompt));
}

#[test]
fn selected_samplerless_output_preserves_flat_parameters() {
    let prompt = samplerless_output_prompt("");
    let parameters = "flat prompt\nNegative prompt: flat negative\nSteps: 12, Sampler: euler, CFG scale: 4.5, Seed: 0, Model: flat-model.safetensors";
    let chunks = HashMap::from([
        ("parameters".to_string(), parameters.to_string()),
        ("prompt".to_string(), prompt),
    ]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "flat-model.safetensors");
    assert_eq!(meta.seed, Some(0));
    assert_eq!(meta.steps, 12);
    assert_eq!(meta.cfg, 4.5);
    assert_eq!(meta.sampler, "euler");
    assert_eq!(meta.positive_prompt, "flat prompt");
    assert_eq!(meta.negative_prompt, "flat negative");
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
        ComfyMetadataField::NegativePrompt,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::FlatParameters)
        );
    }
}

#[test]
fn selected_samplerless_output_preserves_explicit_metadata() {
    let prompt = samplerless_output_prompt(
        r#",
            "5": {
                "class_type": "SDParameterGenerator",
                "inputs": {
                    "ckpt_name": "explicit-model.safetensors",
                    "seed": 42,
                    "steps": 18,
                    "cfg": 6.0,
                    "sampler_name": "heun",
                    "scheduler": "normal"
                }
            }"#,
    );
    let chunks = HashMap::from([("prompt".to_string(), prompt)]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "explicit_model");
    assert_eq!(meta.seed, Some(42));
    assert_eq!(meta.steps, 18);
    assert_eq!(meta.cfg, 6.0);
    assert_eq!(meta.sampler, "heun (normal)");
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::ExplicitNode)
        );
    }
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::GlobalScan));
}

#[test]
fn stale_extra_prompt_sampler_does_not_authorize_utility_fallback() {
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["utility-model.safetensors"] },
            { "id": 2, "type": "LoadImage", "widgets_values": ["input.png"] },
            { "id": 3, "type": "SaveImage", "inputs": [{"name":"images","link":1}], "widgets_values": ["ComfyUI"] }
        ],
        "links": [[1, 2, 0, 3, 0, "IMAGE"]],
        "extra": {
            "prompt": {
                "99": { "class_type": "SamplerCustomAdvanced", "inputs": {} }
            }
        }
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "Unknown");
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 0);
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::GlobalScan));
}

#[test]
fn sampler_shaped_json_prompt_text_does_not_authorize_utility_fallback() {
    let prompt = r#"{
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "utility-model.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "{\"class_type\":\"KSampler\",\"inputs\":{}}" } },
        "3": {
            "class_type": "LoadImage",
            "inputs": {
                "image": "input.png",
                "config": { "class_type": "KSampler", "inputs": {} }
            }
        },
        "4": { "class_type": "PreviewImage", "inputs": { "images": ["3", 0] } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "Unknown");
    assert!(meta.positive_prompt.is_empty());
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::SamplerFallback));
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::GlobalScan));
}
