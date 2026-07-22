use super::super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer};
use super::super::extract_comfyui_metadata_with_diagnostics;
use serde_json::{json, Value};
use std::collections::HashMap;

const IDEOGRAM_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_ideogram4_t2i.expected-positive.txt");

fn extract_prompt_graph(nodes: Value) -> (crate::metadata::ImageMetadata, ComfyParseDiagnostics) {
    let chunks = HashMap::from([("prompt".to_string(), nodes.to_string())]);
    extract_comfyui_metadata_with_diagnostics(&chunks)
}

fn connected_api_graph() -> Value {
    json!({
        "1": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "unconditional-model.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "selected positive" }
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "selected negative" }
        },
        "4": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "primary-model.safetensors" }
        },
        "5": {
            "class_type": "CFGOverride",
            "inputs": { "model": ["4", 0] },
            "widgets_values": [3.0, 0.7, 1.0]
        },
        "6": {
            "class_type": "DualModelGuider",
            "inputs": {
                "model": ["5", 0],
                "positive": ["2", 0],
                "model_negative": ["1", 0],
                "negative": ["3", 0],
                "cfg": 7.0
            }
        },
        "7": { "class_type": "RandomNoise", "inputs": { "noise_seed": 12345 } },
        "8": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "9": {
            "class_type": "BasicScheduler",
            "inputs": { "scheduler": "simple", "steps": 20, "denoise": 1.0 }
        },
        "10": { "class_type": "EmptyLatentImage", "inputs": {} },
        "11": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["7", 0],
                "guider": ["6", 0],
                "sampler": ["8", 0],
                "sigmas": ["9", 0],
                "latent_image": ["10", 0]
            }
        },
        "12": { "class_type": "VAEDecode", "inputs": { "samples": ["11", 0] } },
        "13": { "class_type": "SaveImage", "inputs": { "images": ["12", 0] } }
    })
}

fn assert_traversal_source(diagnostics: &ComfyParseDiagnostics, field: ComfyMetadataField) {
    assert_eq!(
        diagnostics.field_sources.get(&field),
        Some(&ComfyParseLayer::SamplerTraversal),
        "field {field:?}"
    );
}

#[test]
fn connected_dual_model_guider_uses_only_primary_metadata() {
    let (meta, diagnostics) = extract_prompt_graph(connected_api_graph());

    assert_eq!(meta.model, "primary_model");
    assert!(!meta.model.contains("unconditional"));
    assert_eq!(meta.seed, Some(12345));
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 7.0);
    assert_ne!(meta.cfg, 3.0, "CFGOverride is not the base CFG value");
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "selected positive");
    assert_eq!(meta.negative_prompt, "selected negative");

    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
        ComfyMetadataField::NegativePrompt,
    ] {
        assert_traversal_source(&diagnostics, field);
    }
}

#[test]
fn workflow_linked_dual_model_cfg_overrides_stale_widget() {
    let workflow = json!({
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["workflow-primary.safetensors", "default"] },
            { "id": 2, "type": "CLIPTextEncode", "widgets_values": ["workflow positive"] },
            { "id": 3, "type": "CLIPTextEncode", "widgets_values": ["workflow negative"] },
            { "id": 4, "type": "PrimitiveFloat", "widgets_values": [6.25] },
            { "id": 5, "type": "CFGOverride", "inputs": [{ "name": "model", "link": 1 }], "widgets_values": [3.0, 0.7, 1.0] },
            {
                "id": 6,
                "type": "DualModelGuider",
                "inputs": [
                    { "name": "model", "link": 2 },
                    { "name": "positive", "link": 3 },
                    { "name": "model_negative", "link": null },
                    { "name": "negative", "link": 4 },
                    { "name": "cfg", "link": 5 }
                ],
                "widgets_values": [1.0]
            },
            { "id": 7, "type": "RandomNoise", "widgets_values": [23456] },
            { "id": 8, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            { "id": 9, "type": "BasicScheduler", "widgets_values": ["simple", 18, 1.0] },
            { "id": 10, "type": "EmptyLatentImage", "widgets_values": [1024, 1024, 1] },
            {
                "id": 11,
                "type": "SamplerCustomAdvanced",
                "inputs": [
                    { "name": "noise", "link": 6 },
                    { "name": "guider", "link": 7 },
                    { "name": "sampler", "link": 8 },
                    { "name": "sigmas", "link": 9 },
                    { "name": "latent_image", "link": 10 }
                ]
            },
            { "id": 12, "type": "VAEDecode", "inputs": [{ "name": "samples", "link": 11 }] },
            { "id": 13, "type": "SaveImage", "inputs": [{ "name": "images", "link": 12 }] }
        ],
        "links": [
            [1, 1, 0, 5, 0, "MODEL"],
            [2, 5, 0, 6, 0, "MODEL"],
            [3, 2, 0, 6, 1, "CONDITIONING"],
            [4, 3, 0, 6, 3, "CONDITIONING"],
            [5, 4, 0, 6, 4, "FLOAT"],
            [6, 7, 0, 11, 0, "NOISE"],
            [7, 6, 0, 11, 1, "GUIDER"],
            [8, 8, 0, 11, 2, "SAMPLER"],
            [9, 9, 0, 11, 3, "SIGMAS"],
            [10, 10, 0, 11, 4, "LATENT"],
            [11, 11, 0, 12, 0, "LATENT"],
            [12, 12, 0, 13, 0, "IMAGE"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "workflow_primary");
    assert_eq!(meta.cfg, 6.25);
    assert_ne!(meta.cfg, 1.0);
    assert_eq!(meta.positive_prompt, "workflow positive");
    assert_eq!(meta.negative_prompt, "workflow negative");
    assert_traversal_source(&diagnostics, ComfyMetadataField::Cfg);
}

#[test]
fn direct_sampler_cfg_wins_over_dual_model_guider_cfg() {
    let mut nodes = connected_api_graph();
    nodes["11"]["inputs"]["cfg"] = json!(9.0);

    let (meta, diagnostics) = extract_prompt_graph(nodes);

    assert_eq!(meta.cfg, 9.0);
    assert_traversal_source(&diagnostics, ComfyMetadataField::Cfg);
}

#[test]
fn unresolved_selected_guider_inputs_do_not_reopen_disconnected_fallbacks() {
    let mut nodes = connected_api_graph();
    nodes["6"]["inputs"]["model"] = json!(["missing-model", 0]);
    nodes["6"]["inputs"]["positive"] = json!(["missing-positive", 0]);
    nodes["6"]["inputs"]["cfg"] = json!(["missing-cfg", 0]);
    nodes["6"]["inputs"]["negative"] = json!(["23", 0]);
    nodes["20"] = json!({
        "class_type": "KSampler",
        "inputs": {
            "model": ["21", 0],
            "positive": ["22", 0],
            "negative": ["22", 0],
            "seed": 999,
            "steps": 99,
            "cfg": 19.0,
            "sampler_name": "dpmpp_2m",
            "scheduler": "normal"
        }
    });
    nodes["21"] = json!({
        "class_type": "UNETLoader",
        "inputs": { "unet_name": "disconnected-model.safetensors" }
    });
    nodes["22"] = json!({
        "class_type": "CLIPTextEncode",
        "inputs": { "text": "disconnected prompt" }
    });
    nodes["23"] = json!({
        "class_type": "ConditioningZeroOut",
        "inputs": { "conditioning": ["3", 0] }
    });

    let (meta, diagnostics) = extract_prompt_graph(nodes);

    assert_eq!(meta.model, "Unknown");
    assert_eq!(meta.cfg, 0.0);
    assert!(meta.positive_prompt.is_empty());
    assert!(meta.negative_prompt.is_empty());
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::Model));
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::Cfg));
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::PositivePrompt));
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::NegativePrompt));
}

#[test]
fn pinned_ideogram_dual_model_guider_uses_primary_branch() {
    let chunks: HashMap<String, String> = serde_json::from_str(include_str!(
        "fixtures/official_catalog/image_ideogram4_t2i.chunks.json"
    ))
    .expect("Ideogram chunks should be valid JSON");
    let expected_workflow = chunks
        .get("workflow")
        .expect("Ideogram fixture should include workflow");

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "ideogram4_fp8_scaled");
    assert!(!meta.model.contains("unconditional"));
    assert_eq!(meta.seed, Some(885_894_517_601_261));
    assert_eq!(meta.steps, 0);
    assert_eq!(meta.cfg, 7.0);
    assert_ne!(meta.cfg, 3.0);
    assert_eq!(meta.sampler, "euler");
    assert_eq!(meta.positive_prompt, IDEOGRAM_EXPECTED_POSITIVE);
    assert!(meta.negative_prompt.is_empty());
    assert!(meta.loras.is_empty());
    assert!(meta.control_nets.is_empty());
    assert!(meta.ip_adapters.is_empty());
    assert!(meta.embeddings.is_empty());
    assert!(meta.hypernetworks.is_empty());
    assert_eq!(
        meta.workflow_json.as_deref(),
        Some(expected_workflow.as_str())
    );
    assert!(meta.has_workflow_hint);

    assert_eq!(diagnostics.graph_node_count, 42);
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_traversal_source(&diagnostics, field);
    }
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::NegativePrompt));
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::Steps));
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::WorkflowJson),
        Some(&ComfyParseLayer::WorkflowChunk)
    );
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::WorkflowHint),
        Some(&ComfyParseLayer::WorkflowChunk)
    );
}
