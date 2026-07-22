use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use super::super::extract_comfyui_metadata_with_diagnostics;
use serde_json::{json, Value};
use std::collections::HashMap;

fn extract_prompt(
    nodes: Value,
) -> (
    crate::metadata::ImageMetadata,
    super::super::ComfyParseDiagnostics,
) {
    let chunks = HashMap::from([("prompt".to_string(), nodes.to_string())]);
    extract_comfyui_metadata_with_diagnostics(&chunks)
}

fn api_graph(scheduler_inputs: Value) -> Value {
    json!({
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "ideogram-test.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "scheduler test" } },
        "3": { "class_type": "ConditioningZeroOut", "inputs": { "conditioning": ["2", 0] } },
        "4": {
            "class_type": "CFGGuider",
            "inputs": { "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0], "cfg": 7.0 }
        },
        "5": { "class_type": "RandomNoise", "inputs": { "noise_seed": 123 } },
        "6": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "7": { "class_type": "Ideogram4Scheduler", "inputs": scheduler_inputs },
        "8": { "class_type": "EmptyLatentImage", "inputs": {} },
        "9": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["5", 0], "guider": ["4", 0], "sampler": ["6", 0],
                "sigmas": ["7", 0], "latent_image": ["8", 0]
            }
        },
        "10": { "class_type": "VAEDecode", "inputs": { "samples": ["9", 0] } },
        "11": { "class_type": "SaveImage", "inputs": { "images": ["10", 0] } }
    })
}

fn assert_traversal_source(
    diagnostics: &super::super::ComfyParseDiagnostics,
    field: ComfyMetadataField,
) {
    assert_eq!(
        diagnostics.field_sources.get(&field),
        Some(&ComfyParseLayer::SamplerTraversal),
        "field {field:?}"
    );
}

#[test]
fn api_scheduler_supplies_direct_steps_and_stable_identity() {
    let (meta, diagnostics) = extract_prompt(api_graph(json!({
        "steps": 20, "scheduler": "stale", "width": 1024, "height": 1024,
        "mu": 0.5, "std": 1.75
    })));

    assert_eq!(meta.steps, 20);
    assert_eq!(meta.sampler, "euler (ideogram4)");
    assert_traversal_source(&diagnostics, ComfyMetadataField::Steps);
    assert_traversal_source(&diagnostics, ComfyMetadataField::Sampler);
}

#[test]
fn workflow_scheduler_uses_exact_widget_indexes() {
    let workflow = json!({
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["ideogram-test.safetensors"] },
            { "id": 2, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            { "id": 3, "type": "Ideogram4Scheduler", "widgets_values": [17, 401, 402, 0.5, 1.75] },
            { "id": 4, "type": "EmptyLatentImage", "widgets_values": [512, 512, 1] },
            {
                "id": 5, "type": "SamplerCustom",
                "inputs": [
                    { "name": "model", "link": 1 }, { "name": "sampler", "link": 2 },
                    { "name": "sigmas", "link": 3 }, { "name": "latent_image", "link": 4 }
                ],
                "widgets_values": [true, 42, "fixed", 5.5]
            },
            { "id": 6, "type": "VAEDecode", "inputs": [{ "name": "samples", "link": 5 }] },
            { "id": 7, "type": "SaveImage", "inputs": [{ "name": "images", "link": 6 }] }
        ],
        "links": [
            [1, 1, 0, 5, 0, "MODEL"], [2, 2, 0, 5, 3, "SAMPLER"],
            [3, 3, 0, 5, 4, "SIGMAS"], [4, 4, 0, 5, 5, "LATENT"],
            [5, 5, 0, 6, 0, "LATENT"], [6, 6, 0, 7, 0, "IMAGE"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 17);
    assert_eq!(meta.sampler, "euler (ideogram4)");
}

#[test]
fn linked_steps_override_stale_workflow_widget() {
    let workflow = json!({
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["ideogram-test.safetensors"] },
            { "id": 2, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            { "id": 3, "type": "PrimitiveInt", "widgets_values": [24] },
            {
                "id": 4, "type": "Ideogram4Scheduler",
                "inputs": [{ "name": "steps", "link": 1 }],
                "widgets_values": [10, 1024, 1024, 0.5, 1.75]
            },
            { "id": 5, "type": "EmptyLatentImage", "widgets_values": [512, 512, 1] },
            {
                "id": 6, "type": "SamplerCustom",
                "inputs": [
                    { "name": "model", "link": 2 }, { "name": "sampler", "link": 3 },
                    { "name": "sigmas", "link": 4 }, { "name": "latent_image", "link": 5 }
                ],
                "widgets_values": [true, 42, "fixed", 5.5]
            },
            { "id": 7, "type": "VAEDecode", "inputs": [{ "name": "samples", "link": 6 }] },
            { "id": 8, "type": "SaveImage", "inputs": [{ "name": "images", "link": 7 }] }
        ],
        "links": [
            [1, 3, 0, 4, 0, "INT"], [2, 1, 0, 6, 0, "MODEL"],
            [3, 2, 0, 6, 3, "SAMPLER"], [4, 4, 0, 6, 4, "SIGMAS"],
            [5, 5, 0, 6, 5, "LATENT"], [6, 6, 0, 7, 0, "LATENT"],
            [7, 7, 0, 8, 0, "IMAGE"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 24);
    assert_ne!(meta.steps, 10);
}

#[test]
fn unresolved_steps_fail_closed_without_losing_scheduler_identity() {
    let workflow = json!({
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["ideogram-test.safetensors"] },
            { "id": 2, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            {
                "id": 3, "type": "Ideogram4Scheduler",
                "inputs": [{ "name": "steps", "link": 99 }],
                "widgets_values": [20, 499, 498, 0.5, 1.75]
            },
            { "id": 4, "type": "EmptyLatentImage", "widgets_values": [512, 512, 1] },
            {
                "id": 5, "type": "SamplerCustom",
                "inputs": [
                    { "name": "model", "link": 1 }, { "name": "sampler", "link": 2 },
                    { "name": "sigmas", "link": 3 }, { "name": "latent_image", "link": 4 }
                ],
                "widgets_values": [true, 42, "fixed", 5.5]
            },
            { "id": 6, "type": "VAEDecode", "inputs": [{ "name": "samples", "link": 5 }] },
            { "id": 7, "type": "SaveImage", "inputs": [{ "name": "images", "link": 6 }] }
        ],
        "links": [
            [1, 1, 0, 5, 0, "MODEL"], [2, 2, 0, 5, 3, "SAMPLER"],
            [3, 3, 0, 5, 4, "SIGMAS"], [4, 4, 0, 5, 5, "LATENT"],
            [5, 5, 0, 6, 0, "LATENT"], [6, 6, 0, 7, 0, "IMAGE"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 0);
    assert_eq!(meta.sampler, "euler (ideogram4)");
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::Steps));
    assert_traversal_source(&diagnostics, ComfyMetadataField::Sampler);
}

#[test]
fn disconnected_ideogram_scheduler_cannot_override_selected_scheduler() {
    let mut nodes = api_graph(json!({
        "scheduler": "simple", "steps": 12
    }));
    nodes["7"] =
        json!({ "class_type": "BasicScheduler", "inputs": { "scheduler": "simple", "steps": 12 } });
    nodes["20"] = json!({
        "class_type": "Ideogram4Scheduler",
        "inputs": { "steps": 77, "width": 499, "height": 498, "mu": 0.5, "std": 1.75 }
    });

    let (meta, _) = extract_prompt(nodes);

    assert_eq!(meta.steps, 12);
    assert_eq!(meta.sampler, "euler (simple)");
}
