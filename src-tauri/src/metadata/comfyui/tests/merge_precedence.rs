use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use crate::metadata::comfyui::{
    build_comfyui_diagnostics_report, extract_comfyui_metadata_with_diagnostics,
    merge_comfyui_metadata,
};
use crate::metadata::reparse::reparse_from_json;
use crate::metadata::{extract_a1111_metadata, ImageMetadata};
use std::collections::HashMap;

const FLAT_COMPLETE: &str = "flat positive <lora:flat-style:0.5> <lora:graph-style:1>\nNegative prompt: flat negative\nSteps: 20, Sampler: flat_sampler, CFG scale: 7.0, Seed: 42, Model hash: flat_hash, Model: flat_model, Version: ComfyUI";

const TRAVERSAL_PROMPT: &str = r#"{
    "1": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": { "ckpt_name": "graph-model.safetensors" }
    },
    "2": {
        "class_type": "LoraLoader",
        "inputs": {
            "model": ["1", 0],
            "clip": ["1", 1],
            "lora_name": "graph-style.safetensors",
            "strength_model": 1.0,
            "strength_clip": 1.0
        }
    },
    "3": {
        "class_type": "CLIPTextEncode",
        "inputs": { "text": "graph positive", "clip": ["2", 1] }
    },
    "4": {
        "class_type": "CLIPTextEncode",
        "inputs": { "text": "graph negative", "clip": ["2", 1] }
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": { "width": 512, "height": 512, "batch_size": 1 }
    },
    "6": {
        "class_type": "KSampler",
        "inputs": {
            "model": ["2", 0],
            "positive": ["3", 0],
            "negative": ["4", 0],
            "latent_image": ["5", 0],
            "seed": 999,
            "steps": 8,
            "cfg": 1.5,
            "sampler_name": "euler",
            "scheduler": "simple",
            "denoise": 1.0
        }
    },
    "7": {
        "class_type": "VAEDecode",
        "inputs": { "samples": ["6", 0], "vae": ["1", 2] }
    },
    "8": {
        "class_type": "SaveImage",
        "inputs": { "images": ["7", 0], "filename_prefix": "test" }
    }
}"#;

fn mixed_chunks(parameters: &str, prompt: &str) -> HashMap<String, String> {
    HashMap::from([
        ("parameters".to_string(), parameters.to_string()),
        ("prompt".to_string(), prompt.to_string()),
    ])
}

fn assert_source(
    diagnostics: &super::super::diagnostics::ComfyParseDiagnostics,
    field: ComfyMetadataField,
    expected: ComfyParseLayer,
) {
    assert_eq!(diagnostics.field_sources.get(&field), Some(&expected));
}

#[test]
fn strong_sampler_traversal_overrides_flat_core_fields_and_unions_resources() {
    let chunks = mixed_chunks(FLAT_COMPLETE, TRAVERSAL_PROMPT);
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "graph_model");
    assert_eq!(meta.model_hash, None);
    assert_eq!(meta.seed, Some(999));
    assert_eq!(meta.steps, 8);
    assert_eq!(meta.cfg, 1.5);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "graph positive");
    assert_eq!(meta.negative_prompt, "graph negative");
    assert_eq!(meta.loras, ["flat_style (0.50)", "graph_style"]);
    assert_eq!(
        diagnostics.attempted_layers.first(),
        Some(&ComfyParseLayer::FlatParameters)
    );
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
        ComfyMetadataField::NegativePrompt,
        ComfyMetadataField::Loras,
    ] {
        assert_source(&diagnostics, field, ComfyParseLayer::SamplerTraversal);
    }
}

#[test]
fn explicit_metadata_overrides_conflicting_flat_fields() {
    let prompt = r#"{
        "1": {
            "class_type": "SDParameterGenerator",
            "inputs": {
                "ckpt_name": "explicit-model.safetensors",
                "seed": 314,
                "steps": 12,
                "cfg": 4.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras"
            }
        }
    }"#;
    let chunks = mixed_chunks(FLAT_COMPLETE, prompt);
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "explicit_model");
    assert_eq!(meta.model_hash, None);
    assert_eq!(meta.seed, Some(314));
    assert_eq!(meta.steps, 12);
    assert_eq!(meta.cfg, 4.5);
    assert_eq!(meta.sampler, "dpmpp_2m (karras)");
    assert_eq!(
        meta.positive_prompt,
        "flat positive <lora:flat-style:0.5> <lora:graph-style:1>"
    );
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_source(&diagnostics, field, ComfyParseLayer::ExplicitNode);
    }
    assert_source(
        &diagnostics,
        ComfyMetadataField::PositivePrompt,
        ComfyParseLayer::FlatParameters,
    );
}

#[test]
fn sampler_fallback_only_fills_fields_missing_from_flat_parameters() {
    let parameters = "flat positive\nSteps: 20, Sampler: flat_sampler, CFG scale: 7.0, Model hash: flat_hash, Model: flat_model, Version: ComfyUI";
    let prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "fallback-model.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "fallback positive", "clip": ["1", 1] }
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "fallback negative", "clip": ["1", 1] }
        },
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "seed": 456,
                "steps": 9,
                "cfg": 2.0,
                "sampler_name": "heun",
                "scheduler": "normal"
            }
        }
    }"#;
    let chunks = mixed_chunks(parameters, prompt);
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "flat_model");
    assert_eq!(meta.model_hash.as_deref(), Some("flat_hash"));
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 7.0);
    assert_eq!(meta.sampler, "flat_sampler");
    assert_eq!(meta.positive_prompt, "flat positive");
    assert_eq!(meta.seed, Some(456));
    assert_eq!(meta.negative_prompt, "fallback negative");
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_source(&diagnostics, field, ComfyParseLayer::FlatParameters);
    }
    for field in [ComfyMetadataField::Seed, ComfyMetadataField::NegativePrompt] {
        assert_source(&diagnostics, field, ComfyParseLayer::SamplerFallback);
    }
}

#[test]
fn global_scan_only_fills_fields_missing_from_flat_parameters() {
    let parameters = "flat positive\nSteps: 20, Sampler: flat_sampler, CFG scale: 7.0, Model hash: flat_hash, Model: flat_model, Version: ComfyUI";
    let prompt = r#"{
        "1": {
            "class_type": "String",
            "inputs": {
                "value": "global positive\nNegative prompt: global negative\nSteps: 6, Sampler: global_sampler, CFG scale: 2.5, Seed: 777, Model: global_model"
            }
        }
    }"#;
    let chunks = mixed_chunks(parameters, prompt);
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "flat_model");
    assert_eq!(meta.model_hash.as_deref(), Some("flat_hash"));
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 7.0);
    assert_eq!(meta.sampler, "flat_sampler");
    assert_eq!(meta.positive_prompt, "flat positive");
    assert_eq!(meta.seed, Some(777));
    assert_eq!(meta.negative_prompt, "global negative");
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_source(&diagnostics, field, ComfyParseLayer::FlatParameters);
    }
    for field in [ComfyMetadataField::Seed, ComfyMetadataField::NegativePrompt] {
        assert_source(&diagnostics, field, ComfyParseLayer::GlobalScan);
    }
}

#[test]
fn placeholder_flat_prompts_are_fillable_but_empty_graph_prompts_do_not_erase_text() {
    let placeholder_chunks = mixed_chunks(
        "unknown\nNegative prompt: unknown\nSteps: 20, Model: flat_model, Version: ComfyUI",
        TRAVERSAL_PROMPT,
    );
    let (placeholder_meta, _) = extract_comfyui_metadata_with_diagnostics(&placeholder_chunks);
    assert_eq!(placeholder_meta.positive_prompt, "graph positive");
    assert_eq!(placeholder_meta.negative_prompt, "graph negative");

    let zeroed_prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "graph-model.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "graph positive", "clip": ["1", 1] }
        },
        "3": {
            "class_type": "ConditioningZeroOut",
            "inputs": { "conditioning": ["2", 0] }
        },
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "seed": 1,
                "steps": 8,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "5": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["4", 0] }
        },
        "6": {
            "class_type": "SaveImage",
            "inputs": { "images": ["5", 0] }
        }
    }"#;
    let chunks = mixed_chunks(FLAT_COMPLETE, zeroed_prompt);
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
    assert_eq!(meta.negative_prompt, "flat negative");
    assert_source(
        &diagnostics,
        ComfyMetadataField::NegativePrompt,
        ComfyParseLayer::FlatParameters,
    );
}

#[test]
fn model_hash_follows_the_selected_model() {
    let matching_parameters = FLAT_COMPLETE.replace("flat_model", "Graph-Model.safetensors");
    let matching_chunks = mixed_chunks(&matching_parameters, TRAVERSAL_PROMPT);
    let (matching_meta, _) = extract_comfyui_metadata_with_diagnostics(&matching_chunks);
    assert_eq!(matching_meta.model, "graph_model");
    assert_eq!(
        matching_meta.model_hash.as_deref(),
        Some("flat_hash"),
        "equivalent model names should retain the flat hash after graph normalization"
    );

    let weak_chunks = mixed_chunks(
        FLAT_COMPLETE,
        r#"{
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": { "ckpt_name": "weak-model.safetensors" }
            }
        }"#,
    );
    let (weak_meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&weak_chunks);
    assert_eq!(weak_meta.model, "flat_model");
    assert_eq!(weak_meta.model_hash.as_deref(), Some("flat_hash"));
    assert_source(
        &diagnostics,
        ComfyMetadataField::Model,
        ComfyParseLayer::FlatParameters,
    );
}

#[test]
fn scanner_reparse_and_diagnostics_share_the_same_final_metadata() {
    let chunks = mixed_chunks(FLAT_COMPLETE, TRAVERSAL_PROMPT);

    let mut scanner_meta = extract_a1111_metadata(FLAT_COMPLETE, None);
    let scanner_diagnostics = merge_comfyui_metadata(&mut scanner_meta, &chunks);
    let report = build_comfyui_diagnostics_report(&chunks);
    let envelope = serde_json::json!({
        "parameters": FLAT_COMPLETE,
        "prompt": TRAVERSAL_PROMPT
    })
    .to_string();
    let reparsed = reparse_from_json(&envelope, "ComfyUI")
        .expect("mixed ComfyUI envelope should reparse")
        .metadata;

    assert_core_metadata_eq(&scanner_meta, &reparsed);
    assert_eq!(report.metadata.model, scanner_meta.model);
    assert_eq!(report.metadata.seed, scanner_meta.seed);
    assert_eq!(report.metadata.steps, scanner_meta.steps);
    assert_eq!(report.metadata.cfg, scanner_meta.cfg);
    assert_eq!(report.metadata.sampler, scanner_meta.sampler);
    assert_eq!(
        report.metadata.positive_prompt,
        scanner_meta.positive_prompt
    );
    assert_eq!(
        report.metadata.negative_prompt,
        scanner_meta.negative_prompt
    );
    assert_eq!(
        report.field_sources.get("model").map(String::as_str),
        Some("sampler_traversal")
    );
    assert_source(
        &scanner_diagnostics,
        ComfyMetadataField::Model,
        ComfyParseLayer::SamplerTraversal,
    );
}

fn assert_core_metadata_eq(left: &ImageMetadata, right: &ImageMetadata) {
    assert_eq!(left.model, right.model);
    assert_eq!(left.model_hash, right.model_hash);
    assert_eq!(left.seed, right.seed);
    assert_eq!(left.steps, right.steps);
    assert_eq!(left.cfg, right.cfg);
    assert_eq!(left.sampler, right.sampler);
    assert_eq!(left.positive_prompt, right.positive_prompt);
    assert_eq!(left.negative_prompt, right.negative_prompt);
    assert_eq!(left.loras, right.loras);
}
