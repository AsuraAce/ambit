use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn add_sampler_branch(nodes: &mut Map<String, Value>, sampler_id: &str, label: &str) {
    let base = sampler_id.parse::<u64>().expect("numeric sampler id");
    let loader_id = format!("{}01", sampler_id);
    let positive_id = format!("{}02", sampler_id);
    let negative_id = format!("{}03", sampler_id);

    nodes.insert(
        loader_id.clone(),
        json!({
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": format!("{label}.safetensors") }
        }),
    );
    nodes.insert(
        positive_id.clone(),
        json!({
            "class_type": "CLIPTextEncode",
            "inputs": { "text": format!("{label} positive") }
        }),
    );
    nodes.insert(
        negative_id.clone(),
        json!({
            "class_type": "CLIPTextEncode",
            "inputs": { "text": format!("{label} negative") }
        }),
    );
    nodes.insert(
        sampler_id.to_string(),
        json!({
            "class_type": "KSampler",
            "inputs": {
                "model": [loader_id, 0],
                "positive": [positive_id, 0],
                "negative": [negative_id, 0],
                "seed": base * 100,
                "steps": base as u32,
                "cfg": base as f64 / 2.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        }),
    );
}

fn add_output(
    nodes: &mut Map<String, Value>,
    output_id: &str,
    node_type: &str,
    sampler_id: Option<&str>,
    mode: Option<i64>,
) {
    let mut node = json!({
        "class_type": node_type,
        "inputs": {}
    });
    if let Some(sampler_id) = sampler_id {
        node["inputs"]["images"] = json!([sampler_id, 0]);
    }
    if let Some(mode) = mode {
        node["mode"] = json!(mode);
    }
    nodes.insert(output_id.to_string(), node);
}

fn chunks(nodes: Map<String, Value>, parameters: Option<&str>) -> HashMap<String, String> {
    let mut chunks = HashMap::from([(
        "prompt".to_string(),
        serde_json::to_string(&Value::Object(nodes)).expect("serialize prompt graph"),
    )]);
    if let Some(parameters) = parameters {
        chunks.insert("parameters".to_string(), parameters.to_string());
    }
    chunks
}

fn assert_sampler_source(
    diagnostics: &super::super::diagnostics::ComfyParseDiagnostics,
    expected: ComfyParseLayer,
) {
    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&expected)
    );
    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Steps),
        Some(&expected)
    );
}

#[test]
fn persisted_save_beats_conflicting_preview_branch() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "preview-model");
    add_sampler_branch(&mut nodes, "10", "saved-model");
    add_output(&mut nodes, "20", "PreviewImage", Some("2"), None);
    add_output(&mut nodes, "21", "SaveImage", Some("10"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "saved_model");
    assert_eq!(meta.seed, Some(1_000));
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn disconnected_save_is_not_connected_by_an_unrelated_wireless_broadcaster() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "preview-model");
    nodes.insert(
        "15".to_string(),
        json!({
            "class_type": "Anything Everywhere",
            "inputs": {}
        }),
    );
    add_output(&mut nodes, "20", "SaveImage", None, None);
    add_output(&mut nodes, "21", "PreviewImage", Some("2"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "preview_model");
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn multiple_persisted_saves_sharing_one_root_remain_trusted() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "shared-model");
    add_output(&mut nodes, "20", "SaveImage", Some("2"), None);
    add_output(&mut nodes, "21", "ImageSave", Some("2"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "shared_model");
    assert_eq!(diagnostics.selected_output_candidate_count, 2);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn sampler_chain_through_latent_intermediate_resolves_to_one_root() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "base-model");
    add_sampler_branch(&mut nodes, "10", "refiner-model");
    nodes.insert(
        "30".to_string(),
        json!({
            "class_type": "LatentUpscale",
            "inputs": { "samples": ["2", 0] }
        }),
    );
    nodes
        .get_mut("10")
        .expect("refiner sampler")
        .get_mut("inputs")
        .expect("sampler inputs")["latent_image"] = json!(["30", 0]);
    add_output(&mut nodes, "20", "SaveImage", Some("2"), None);
    add_output(&mut nodes, "21", "ImageSave", Some("10"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "base_model");
    assert_eq!(meta.seed, Some(200));
    assert_eq!(diagnostics.selected_output_candidate_count, 2);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn sampler_chain_through_vae_round_trip_resolves_to_base_root() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "base-model");
    add_sampler_branch(&mut nodes, "10", "refiner-model");
    nodes.insert(
        "30".to_string(),
        json!({
            "class_type": "VAEDecode",
            "inputs": { "samples": ["2", 0] }
        }),
    );
    nodes.insert(
        "40".to_string(),
        json!({
            "class_type": "VAEEncode",
            "inputs": { "pixels": ["30", 0] }
        }),
    );
    nodes
        .get_mut("10")
        .expect("refiner sampler")
        .get_mut("inputs")
        .expect("sampler inputs")["latent_image"] = json!(["40", 0]);
    add_output(&mut nodes, "20", "SaveImage", Some("10"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "base_model");
    assert_eq!(meta.seed, Some(200));
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn sampler_auxiliary_image_does_not_become_latent_ancestry() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "reference-model");
    add_sampler_branch(&mut nodes, "10", "primary-model");
    nodes.insert(
        "30".to_string(),
        json!({
            "class_type": "VAEDecode",
            "inputs": { "samples": ["2", 0] }
        }),
    );
    nodes.insert(
        "40".to_string(),
        json!({
            "class_type": "EmptyLatentImage",
            "inputs": { "width": 512, "height": 512, "batch_size": 1 }
        }),
    );
    let primary_inputs = nodes
        .get_mut("10")
        .expect("primary sampler")
        .get_mut("inputs")
        .expect("sampler inputs");
    primary_inputs["image"] = json!(["30", 0]);
    primary_inputs["latent_image"] = json!(["40", 0]);
    add_output(&mut nodes, "20", "SaveImage", Some("10"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "primary_model");
    assert_eq!(meta.seed, Some(1_000));
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn sampler_behind_image_conditioning_does_not_become_latent_ancestry() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "reference-model");
    add_sampler_branch(&mut nodes, "10", "primary-model");
    nodes.insert(
        "30".to_string(),
        json!({
            "class_type": "VAEDecode",
            "inputs": { "samples": ["2", 0] }
        }),
    );
    nodes.insert(
        "40".to_string(),
        json!({
            "class_type": "InstructPixToPixConditioning",
            "inputs": {
                "positive": ["1002", 0],
                "negative": ["1003", 0],
                "pixels": ["30", 0]
            }
        }),
    );
    nodes
        .get_mut("10")
        .expect("primary sampler")
        .get_mut("inputs")
        .expect("sampler inputs")["latent_image"] = json!(["40", 2]);
    add_output(&mut nodes, "20", "SaveImage", Some("10"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "primary_model");
    assert_eq!(meta.seed, Some(1_000));
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn conflicting_saved_roots_preserve_flat_metadata_and_report_ambiguity() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "first-graph-model");
    add_sampler_branch(&mut nodes, "10", "second-graph-model");
    add_output(&mut nodes, "20", "SaveImage", Some("2"), None);
    add_output(&mut nodes, "21", "ImageSave", Some("10"), None);
    let parameters = "flat positive\nNegative prompt: flat negative\nSteps: 30, Sampler: dpmpp_2m, CFG scale: 7.0, Seed: 42, Model: flat-model, Version: ComfyUI";

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks(nodes, Some(parameters)));

    assert_eq!(meta.model, "flat-model");
    assert_eq!(meta.seed, Some(42));
    assert_eq!(meta.steps, 30);
    assert_eq!(meta.cfg, 7.0);
    assert_eq!(meta.sampler, "dpmpp_2m");
    assert_eq!(meta.positive_prompt, "flat positive");
    assert_eq!(diagnostics.selected_output_candidate_count, 2);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 2);
    assert!(diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::FlatParameters);
}

#[test]
fn ambiguous_outputs_without_flat_data_use_numeric_sampler_fallback() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "10", "later-model");
    add_sampler_branch(&mut nodes, "2", "numeric-first-model");
    add_output(&mut nodes, "20", "SaveImage", Some("10"), None);
    add_output(&mut nodes, "21", "ImageSave", Some("2"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "numeric_first_model");
    assert_eq!(meta.seed, Some(200));
    assert_eq!(meta.steps, 2);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 2);
    assert!(diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerFallback);
}

#[test]
fn variadic_ui_save_collects_all_same_name_image_inputs() {
    let workflow = json!({
        "nodes": [
            {
                "id": 1,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["numeric-first-model.safetensors"]
            },
            {
                "id": 2,
                "type": "KSampler",
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 1 }
                ],
                "widgets_values": [200, "fixed", 2, 1.0, "euler", "simple", 1.0]
            },
            {
                "id": 4,
                "type": "VAEDecode",
                "inputs": [
                    { "name": "samples", "type": "LATENT", "link": 2 }
                ]
            },
            {
                "id": 9,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["later-model.safetensors"]
            },
            {
                "id": 10,
                "type": "KSampler",
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 3 }
                ],
                "widgets_values": [1000, "fixed", 10, 5.0, "euler", "simple", 1.0]
            },
            {
                "id": 11,
                "type": "VAEDecode",
                "inputs": [
                    { "name": "samples", "type": "LATENT", "link": 4 }
                ]
            },
            {
                "id": 20,
                "type": "Save Image Batch",
                "inputs": [
                    { "name": "images", "type": "IMAGE", "link": 5 },
                    { "name": "images", "type": "IMAGE", "link": 6 }
                ]
            }
        ],
        "links": [
            [1, 1, 0, 2, 0, "MODEL"],
            [2, 2, 0, 4, 0, "LATENT"],
            [3, 9, 0, 10, 0, "MODEL"],
            [4, 10, 0, 11, 0, "LATENT"],
            [5, 4, 0, 20, 0, "IMAGE"],
            [6, 11, 0, 20, 1, "IMAGE"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "numeric_first_model");
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 2);
    assert!(diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerFallback);
}

#[test]
fn disconnected_muted_and_bypassed_saves_are_not_candidates() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "active-model");
    add_sampler_branch(&mut nodes, "10", "ignored-model");
    add_output(&mut nodes, "20", "SaveImage", Some("2"), None);
    add_output(&mut nodes, "21", "SaveImage", None, None);
    add_output(&mut nodes, "22", "SaveImage", Some("10"), Some(2));
    add_output(&mut nodes, "23", "SaveImage", Some("10"), Some(4));
    nodes.insert(
        "24".to_string(),
        json!({
            "class_type": "SaveImage",
            "inputs": { "images": "not-a-node" }
        }),
    );

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "active_model");
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn preview_only_workflow_remains_supported() {
    let mut nodes = Map::new();
    add_sampler_branch(&mut nodes, "2", "preview-only-model");
    add_output(&mut nodes, "20", "PreviewImage", Some("2"), None);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "preview_only_model");
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn custom_spaced_save_uses_ui_image_and_latent_input_types() {
    let workflow = json!({
        "nodes": [
            {
                "id": 1,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["ui-model.safetensors"]
            },
            {
                "id": 2,
                "type": "CLIPTextEncode",
                "widgets_values": ["ui positive"]
            },
            {
                "id": 3,
                "type": "CLIPTextEncode",
                "widgets_values": ["ui negative"]
            },
            {
                "id": 4,
                "type": "KSampler",
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 1 },
                    { "name": "positive", "type": "CONDITIONING", "link": 2 },
                    { "name": "negative", "type": "CONDITIONING", "link": 3 }
                ],
                "widgets_values": [400, "fixed", 12, 3.0, "euler", "simple", 1.0]
            },
            {
                "id": 5,
                "type": "CustomDecode",
                "inputs": [
                    { "name": "latent_result", "type": "LATENT", "link": 4 }
                ]
            },
            {
                "id": 6,
                "type": "Save Rendered Image",
                "mode": 0,
                "inputs": [
                    { "name": "render", "type": "IMAGE", "link": 5 }
                ]
            }
        ],
        "links": [
            [1, 1, 0, 4, 0, "MODEL"],
            [2, 2, 0, 4, 1, "CONDITIONING"],
            [3, 3, 0, 4, 2, "CONDITIONING"],
            [4, 4, 0, 5, 0, "LATENT"],
            [5, 5, 0, 6, 0, "IMAGE"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "ui_model");
    assert_eq!(meta.seed, Some(400));
    assert_eq!(meta.steps, 12);
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}

#[test]
fn selected_sampler_custom_output_reroute_uses_samples_alias() {
    // Output reroutes retain image-like aliases so the saved-output path, rather
    // than disconnected sampler fallback, selects SamplerCustom authoritatively.
    let nodes = serde_json::from_value(json!({
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "custom-model.safetensors" }
        },
        "2": {
            "class_type": "SamplerCustom",
            "inputs": { "model": ["1", 0], "noise_seed": 42, "cfg": 5.5 }
        },
        "3": {
            "class_type": "Reroute",
            "inputs": { "samples": ["2", 0] }
        },
        "4": {
            "class_type": "SaveImage",
            "inputs": { "images": ["3", 0] }
        }
    }))
    .expect("test prompt graph should be an object");

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks(nodes, None));

    assert_eq!(meta.model, "custom_model");
    assert_eq!(meta.seed, Some(42));
    assert_eq!(meta.cfg, 5.5);
    assert!(diagnostics.authoritative_sampler_custom_path);
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Cfg,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::SamplerTraversal)
        );
    }
    for field in [ComfyMetadataField::Steps, ComfyMetadataField::Sampler] {
        assert!(!diagnostics.field_sources.contains_key(&field));
    }
}

#[test]
fn ordinary_ksampler_output_reroute_uses_typed_ui_alias() {
    // A custom reroute socket name remains traversable when its UI type declares
    // image/latent flow, preserving ordinary KSampler saved-output authority.
    let workflow = json!({
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["ui-reroute-model.safetensors"] },
            {
                "id": 2,
                "type": "KSampler",
                "inputs": [{"name":"model","type":"MODEL","link":1}],
                "widgets_values": [42,"fixed",20,5.5,"euler","simple",1.0]
            },
            {
                "id": 3,
                "type": "Reroute",
                "inputs": [{"name":"render","type":"LATENT","link":2}]
            },
            {
                "id": 4,
                "type": "SaveImage",
                "inputs": [{"name":"images","type":"IMAGE","link":3}]
            }
        ],
        "links": [
            [1,1,0,2,0,"MODEL"], [2,2,0,3,0,"LATENT"],
            [3,3,0,4,0,"IMAGE"]
        ]
    });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "ui_reroute_model");
    assert_eq!(meta.seed, Some(42));
    assert_sampler_source(&diagnostics, ComfyParseLayer::SamplerTraversal);
}
