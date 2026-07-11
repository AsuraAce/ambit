use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use crate::metadata::ImageMetadata;
use serde_json::json;
use std::collections::HashMap;

struct CatalogFixture {
    name: &'static str,
    chunks_json: &'static str,
}

const FIXTURES: &[CatalogFixture] = &[
    CatalogFixture {
        name: "image_qwen_image_edit_2509",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_edit_2509.chunks.json"
        ),
    },
    CatalogFixture {
        name: "flux_fill_inpaint_example",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux_fill_inpaint_example.chunks.json"
        ),
    },
    CatalogFixture {
        name: "flux_kontext_dev_basic",
        chunks_json: include_str!("fixtures/official_catalog/flux_kontext_dev_basic.chunks.json"),
    },
    CatalogFixture {
        name: "hidream_i1_full",
        chunks_json: include_str!("fixtures/official_catalog/hidream_i1_full.chunks.json"),
    },
];

struct ExpectedMetadata<'a> {
    model: &'a str,
    seed: Option<i64>,
    steps: u32,
    cfg: f32,
    sampler: &'a str,
    positive_prompt: &'a str,
    negative_prompt: &'a str,
    loras: &'a [&'a str],
    source: ComfyParseLayer,
    graph_node_count: usize,
    output_candidates: usize,
    output_roots: usize,
    output_ambiguous: bool,
}

fn load_chunks(name: &str) -> HashMap<String, String> {
    let fixture = FIXTURES
        .iter()
        .find(|fixture| fixture.name == name)
        .unwrap_or_else(|| panic!("missing fixture {name}"));
    serde_json::from_str(fixture.chunks_json).expect("catalog chunks should be valid JSON")
}

fn assert_fixture(name: &str, expected: ExpectedMetadata<'_>) {
    let chunks = load_chunks(name);
    let workflow = chunks
        .get("workflow")
        .expect("catalog fixture should include workflow chunk");
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
    assert_metadata(name, &meta, &expected);
    assert_eq!(meta.workflow_json.as_deref(), Some(workflow.as_str()));
    assert!(meta.has_workflow_hint);
    assert_eq!(diagnostics.graph_node_count, expected.graph_node_count);
    assert_eq!(
        diagnostics.selected_output_candidate_count,
        expected.output_candidates
    );
    assert_eq!(
        diagnostics.unique_output_root_sampler_count,
        expected.output_roots
    );
    assert_eq!(diagnostics.output_ambiguous, expected.output_ambiguous);
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
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&expected.source),
            "{name} {field:?} provenance"
        );
    }
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::NegativePrompt),
        (!expected.negative_prompt.is_empty()).then_some(&expected.source),
        "{name} negative prompt provenance"
    );
    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Loras),
        (!expected.loras.is_empty()).then_some(&expected.source),
        "{name} LoRA provenance"
    );
}

fn assert_metadata(name: &str, meta: &ImageMetadata, expected: &ExpectedMetadata<'_>) {
    assert_eq!(meta.tool, "ComfyUI", "{name} tool");
    assert_eq!(meta.model, expected.model, "{name} model");
    assert_eq!(meta.seed, expected.seed, "{name} seed");
    assert_eq!(meta.steps, expected.steps, "{name} steps");
    assert_eq!(meta.cfg, expected.cfg, "{name} cfg");
    assert_eq!(meta.sampler, expected.sampler, "{name} sampler");
    assert_eq!(
        meta.positive_prompt, expected.positive_prompt,
        "{name} positive prompt"
    );
    assert_eq!(
        meta.negative_prompt, expected.negative_prompt,
        "{name} negative prompt"
    );
    assert_eq!(meta.loras, expected.loras, "{name} LoRAs");
    assert!(meta.control_nets.is_empty(), "{name} ControlNets");
    assert!(meta.ip_adapters.is_empty(), "{name} IP-Adapters");
    assert!(meta.embeddings.is_empty(), "{name} embeddings");
    assert!(meta.hypernetworks.is_empty(), "{name} hypernetworks");
}

#[test]
fn image_qwen_image_edit_2509() {
    assert_fixture(
        "image_qwen_image_edit_2509",
        ExpectedMetadata {
            model: "qwen_image_edit_2509_fp8_e4m3fn",
            seed: Some(973_414_316_252_139),
            steps: 4,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt:
                "Replace the cat with a dalmatian, keeping the environment and scene consistent",
            negative_prompt: "",
            loras: &["qwen_image_edit_2509_lightning_4steps_v1.0_bf16"],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 27,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux_fill_inpaint_example() {
    assert_fixture(
        "flux_fill_inpaint_example",
        ExpectedMetadata {
            model: "flux1_fill_dev",
            seed: Some(190_664_687_740_330),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (normal)",
            positive_prompt:
                "anime girl with massive fennec ears blonde hair blue eyes wearing a pink shirt",
            negative_prompt: "",
            loras: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 13,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux_kontext_dev_basic() {
    assert_fixture(
        "flux_kontext_dev_basic",
        ExpectedMetadata {
            model: "flux1_dev_kontext_fp8_scaled",
            seed: Some(169_405_236_028_824),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "Using this elegant style, create a portrait of a swan wearing a pearl tiara and lace collar, maintaining the same refined quality and soft color tones.",
            negative_prompt: "",
            loras: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 18,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn hidream_i1_full() {
    assert_fixture(
        "hidream_i1_full",
        ExpectedMetadata {
            model: "hidream_i1_full_fp8",
            seed: Some(647_719_102_242_276),
            steps: 50,
            cfg: 5.0,
            sampler: "uni_pc (simple)",
            positive_prompt: "A lo-fi, grungy wide shot of a ragged large red tree leaning slightly to one side Polaroid aesthetic. the tree is alone in a desolate landscape, the tree is illuminated by a red light, the background is pitch black",
            negative_prompt: "bad ugly jpeg artifacts",
            loras: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 12,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn linked_numeric_switches_and_conditioning_branches_follow_selected_inputs() {
    let prompt = json!({
        "1": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "switch-model.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "_meta": { "title": "CLIP Text Encode (Positive Prompt)" },
            "inputs": { "text": "selected positive" }
        },
        "3": {
            "class_type": "ConditioningZeroOut",
            "inputs": { "conditioning": ["2", 0] }
        },
        "4": { "class_type": "PrimitiveInt", "inputs": { "value": 4 } },
        "5": { "class_type": "PrimitiveInt", "inputs": { "value": 20 } },
        "6": { "class_type": "PrimitiveBoolean", "inputs": { "value": false } },
        "7": {
            "class_type": "ComfySwitchNode",
            "inputs": {
                "switch": ["6", 0],
                "on_false": ["4", 0],
                "on_true": ["5", 0]
            }
        },
        "8": { "class_type": "PrimitiveFloat", "inputs": { "value": 1.0 } },
        "9": { "class_type": "PrimitiveFloat", "inputs": { "value": 4.0 } },
        "10": {
            "class_type": "ComfySwitchNode",
            "inputs": {
                "switch": ["6", 0],
                "on_false": ["8", 0],
                "on_true": ["9", 0]
            }
        },
        "11": {
            "class_type": "InpaintModelConditioning",
            "inputs": {
                "positive": ["2", 0],
                "negative": ["3", 0]
            }
        },
        "12": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["11", 0],
                "negative": ["11", 1],
                "seed": 123,
                "steps": ["7", 0],
                "cfg": ["10", 0],
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "13": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["12", 0] }
        },
        "14": {
            "class_type": "SaveImage",
            "inputs": { "images": ["13", 0] }
        }
    });
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 4);
    assert_eq!(meta.cfg, 1.0);
    assert_eq!(meta.positive_prompt, "selected positive");
    assert_eq!(meta.negative_prompt, "");
    for field in [
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::SamplerTraversal)
        );
    }
}
