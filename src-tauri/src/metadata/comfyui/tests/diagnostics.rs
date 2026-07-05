use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use crate::metadata::comfyui::{
    extract_comfyui_metadata, extract_comfyui_metadata_with_diagnostics,
};
use std::collections::HashMap;

fn chunks_with_prompt(prompt: &str) -> HashMap<String, String> {
    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    chunks
}

fn chunks_with_workflow(workflow: &str) -> HashMap<String, String> {
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());
    chunks
}

#[test]
fn test_diagnostics_records_workflow_chunk_only() {
    let workflow = r#"{"nodes":[]}"#;
    let chunks = chunks_with_workflow(workflow);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.tool, "ComfyUI");
    assert_eq!(meta.workflow_json.as_deref(), Some(workflow));
    assert!(meta.has_workflow_hint);
    assert_eq!(diagnostics.graph_node_count, 0);
    assert_eq!(
        diagnostics.attempted_layers,
        vec![ComfyParseLayer::WorkflowChunk]
    );
    assert_eq!(diagnostics.field_sources.len(), 2);
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

#[test]
fn test_diagnostics_records_explicit_node_fields() {
    let prompt = r#"{
        "1": {
            "class_type": "SDParameterGenerator",
            "inputs": {
                "ckpt_name": "explicit-model.safetensors",
                "seed": 42,
                "steps": 28,
                "cfg": 6.5,
                "sampler_name": "euler",
                "scheduler": "karras"
            }
        }
    }"#;
    let chunks = chunks_with_prompt(prompt);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "explicit_model");
    assert_eq!(meta.seed, Some(42));
    assert_eq!(meta.steps, 28);
    assert_eq!(meta.cfg, 6.5);
    assert_eq!(meta.sampler, "euler (karras)");
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
}

#[test]
fn test_diagnostics_records_sampler_traversal_fields() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "seed": 12345,
                "steps": 25,
                "sampler_name": "dpmpp_2m",
                "scheduler": "normal"
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "traversal-model.safetensors" }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "beautiful scenery" }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "bad quality" }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["3", 0] }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": { "images": ["8", 0] }
        }
    }"#;
    let chunks = chunks_with_prompt(prompt);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 25);
    assert_eq!(meta.cfg, 7.0);
    assert_eq!(meta.seed, Some(12345));
    assert_eq!(meta.sampler, "dpmpp_2m (normal)");
    assert_eq!(meta.positive_prompt, "beautiful scenery");
    assert_eq!(meta.negative_prompt, "bad quality");
    for field in [
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
        ComfyMetadataField::NegativePrompt,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::SamplerTraversal)
        );
    }
}

#[test]
fn test_diagnostics_records_sampler_fallback_and_global_scan_fields() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 5.5,
                "seed": 9876,
                "steps": 18,
                "sampler_name": "euler_a"
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "fallback-model.safetensors" }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "fallback prompt" }
        }
    }"#;
    let chunks = chunks_with_prompt(prompt);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "fallback_model");
    assert_eq!(meta.steps, 18);
    assert_eq!(meta.cfg, 5.5);
    assert_eq!(meta.seed, Some(9876));
    assert_eq!(meta.sampler, "euler_a");
    assert_eq!(meta.positive_prompt, "fallback prompt");
    for field in [
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::SamplerFallback)
        );
    }
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        Some(&ComfyParseLayer::GlobalScan)
    );
}

#[test]
fn test_public_extractor_matches_diagnostic_helper_metadata() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 8.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "seed": 123,
                "steps": 20,
                "sampler_name": "euler"
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "same-output.safetensors" }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "same output prompt" }
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["3", 0] }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": { "images": ["8", 0] }
        }
    }"#;
    let chunks = chunks_with_prompt(prompt);

    let public_meta = extract_comfyui_metadata(&chunks);
    let (diagnostic_meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(diagnostic_meta, public_meta);
    assert!(diagnostics.graph_node_count > 0);
}
