use super::super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer};
use crate::metadata::comfyui::{
    build_comfyui_diagnostics_report, extract_comfyui_metadata,
    extract_comfyui_metadata_with_diagnostics, ComfyParserDiagnosticsReport,
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
    assert!(diagnostics.field_source_node_ids.is_empty());
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
        assert_eq!(
            diagnostics.field_source_node_ids.get(&field),
            Some(&vec!["1".to_string()])
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
    assert_eq!(
        diagnostics
            .field_source_node_ids
            .get(&ComfyMetadataField::Model),
        Some(&vec!["4".to_string()])
    );
    for field in [
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_eq!(
            diagnostics.field_source_node_ids.get(&field),
            Some(&vec!["3".to_string()]),
            "{field:?}"
        );
    }
    assert_eq!(
        diagnostics
            .field_source_node_ids
            .get(&ComfyMetadataField::PositivePrompt),
        Some(&vec!["6".to_string()])
    );
    assert_eq!(
        diagnostics
            .field_source_node_ids
            .get(&ComfyMetadataField::NegativePrompt),
        Some(&vec!["7".to_string()])
    );
}

#[test]
fn test_diagnostics_records_item_level_resource_sources() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "model": ["30", 0],
                "positive": ["20", 0],
                "negative": ["7", 0],
                "seed": 12345,
                "steps": 25,
                "sampler_name": "euler",
                "scheduler": "normal"
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "resource-model.safetensors" }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "scene <lora:prompt-style:0.5> embedding:detail <hypernet:prompt-hn:0.7>"
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "bad quality" }
        },
        "10": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": { "model": ["11", 0], "lora_name": "loader-style.safetensors" }
        },
        "11": {
            "class_type": "HypernetworkLoader",
            "inputs": {
                "model": ["4", 0],
                "hypernetwork_name": "loader-hn.pt",
                "strength": 0.8
            }
        },
        "20": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["6", 0],
                "negative": ["7", 0],
                "control_net": ["21", 0]
            }
        },
        "21": {
            "class_type": "ControlNetLoader",
            "inputs": { "control_net_name": "control-depth.safetensors" }
        },
        "30": {
            "class_type": "IPAdapterApply",
            "inputs": { "model": ["10", 0], "ipadapter": ["31", 0] }
        },
        "31": {
            "class_type": "IPAdapterModelLoader",
            "inputs": { "ipadapter_file": "ip-adapter-plus.safetensors" }
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": { "images": ["3", 0] }
        }
    }"#;
    let chunks = chunks_with_prompt(prompt);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    let expected = [
        (ComfyMetadataField::Loras, "loader_style", "10"),
        (ComfyMetadataField::Loras, "prompt_style (0.50)", "6"),
        (ComfyMetadataField::ControlNets, "control_depth", "21"),
        (ComfyMetadataField::IpAdapters, "ip_adapter_plus", "31"),
        (ComfyMetadataField::Embeddings, "detail", "6"),
        (ComfyMetadataField::Hypernetworks, "loader_hn (0.80)", "11"),
        (ComfyMetadataField::Hypernetworks, "prompt_hn (0.70)", "6"),
    ];
    for (field, value, node_id) in expected {
        assert!(
            super::super::diagnostics::metadata_resource_values(&meta, field)
                .contains(&value.to_string())
        );
        let source = diagnostics
            .resource_sources
            .get(&field)
            .and_then(|resources| resources.get(value))
            .unwrap_or_else(|| panic!("missing resource source for {value}"));
        assert_eq!(source.layer, ComfyParseLayer::SamplerTraversal);
        assert_eq!(source.node_ids, [node_id]);
    }

    let report = build_comfyui_diagnostics_report(&chunks);
    assert_eq!(report.resource_sources.len(), expected.len());
    for (field, value, node_id) in expected {
        let field = super::super::metadata_field_label(field);
        let source = report
            .resource_sources
            .iter()
            .find(|source| source.field == field && source.value == value)
            .unwrap_or_else(|| panic!("missing public resource source for {value}"));
        assert_eq!(source.layer.as_deref(), Some("sampler_traversal"));
        assert_eq!(source.node_ids, [node_id]);
    }
}

#[test]
fn test_same_layer_resource_sources_union_node_ids_in_numeric_order() {
    let mut diagnostics = ComfyParseDiagnostics::default();
    diagnostics.record_resource_source(
        ComfyMetadataField::Loras,
        "shared_style",
        ComfyParseLayer::SamplerTraversal,
        &["30:10".to_string(), "30:2".to_string()],
    );
    diagnostics.record_resource_source(
        ComfyMetadataField::Loras,
        "shared_style",
        ComfyParseLayer::SamplerTraversal,
        &["30:2".to_string(), "7".to_string()],
    );

    let source = diagnostics
        .resource_sources
        .get(&ComfyMetadataField::Loras)
        .and_then(|resources| resources.get("shared_style"))
        .expect("shared LoRA provenance");
    assert_eq!(source.layer, ComfyParseLayer::SamplerTraversal);
    assert_eq!(source.node_ids, ["7", "30:10", "30:2"]);
}

#[test]
fn test_diagnostics_records_linked_and_composed_sampler_traversal_sources() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": ["11", 0],
                "model": ["4", 0],
                "positive": ["15", 0],
                "negative": ["8", 0],
                "seed": ["12", 0],
                "steps": ["10", 0],
                "sampler_name": ["13", 0],
                "scheduler": ["14", 0]
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "linked-model.safetensors" }
        },
        "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "first" } },
        "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "second" } },
        "8": { "class_type": "CLIPTextEncode", "inputs": { "text": "negative" } },
        "10": { "class_type": "PrimitiveNode", "inputs": { "value": 24 } },
        "11": { "class_type": "PrimitiveNode", "inputs": { "value": 6.5 } },
        "12": { "class_type": "PrimitiveNode", "inputs": { "value": 99 } },
        "13": { "class_type": "String", "inputs": { "value": "euler" } },
        "14": { "class_type": "String", "inputs": { "value": "simple" } },
        "15": {
            "class_type": "ConditioningCombine",
            "inputs": { "conditioning_1": ["6", 0], "conditioning_2": ["7", 0] }
        },
        "20": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0] } },
        "21": { "class_type": "SaveImage", "inputs": { "images": ["20", 0] } }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.positive_prompt, "first, second");
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(
        diagnostics
            .field_source_node_ids
            .get(&ComfyMetadataField::PositivePrompt),
        Some(&vec!["6".to_string(), "7".to_string()])
    );
    assert_eq!(
        diagnostics
            .field_source_node_ids
            .get(&ComfyMetadataField::Sampler),
        Some(&vec!["13".to_string(), "14".to_string()])
    );
    for (field, node_id) in [
        (ComfyMetadataField::Steps, "10"),
        (ComfyMetadataField::Cfg, "11"),
        (ComfyMetadataField::Seed, "12"),
    ] {
        assert_eq!(
            diagnostics.field_source_node_ids.get(&field),
            Some(&vec![node_id.to_string()]),
            "{field:?}"
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
    for field in [
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_eq!(
            diagnostics.field_source_node_ids.get(&field),
            Some(&vec!["3".to_string()]),
            "{field:?}"
        );
    }
    assert_eq!(
        diagnostics
            .field_source_node_ids
            .get(&ComfyMetadataField::PositivePrompt),
        Some(&vec!["6".to_string()])
    );
    assert_eq!(
        diagnostics
            .field_source_node_ids
            .get(&ComfyMetadataField::Model),
        Some(&vec!["4".to_string()])
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

#[test]
fn test_diagnostics_report_serializes_chunk_summary_and_field_sources() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "seed": 12345,
                "steps": 25,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "diagnostic-model.safetensors" }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "diagnostic prompt" }
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
    let workflow = r#"{"nodes":[]}"#;
    let mut chunks = chunks_with_prompt(prompt);
    chunks.insert("workflow".to_string(), workflow.to_string());

    let report = build_comfyui_diagnostics_report(&chunks);

    assert_eq!(report.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(
        report.parser_version,
        super::super::super::CURRENT_PARSER_VERSION
    );
    assert_eq!(report.chunk_keys, vec!["prompt", "workflow"]);
    assert!(report.has_prompt_chunk);
    assert!(report.has_workflow_chunk);
    assert_eq!(report.graph_node_count, 5);
    assert_eq!(report.selected_output_candidate_count, 1);
    assert_eq!(report.unique_output_root_sampler_count, 1);
    assert!(!report.output_ambiguous);
    assert!(report.traversal_issues.is_empty());
    assert!(!report.traversal_issues_truncated);
    assert_eq!(report.metadata.model, "diagnostic_model");
    assert_eq!(report.metadata.seed, Some(12345));
    assert_eq!(report.metadata.steps, 25);
    assert_eq!(report.metadata.cfg, 7.0);
    assert_eq!(report.metadata.sampler, "euler (simple)");
    assert_eq!(report.metadata.positive_prompt, "diagnostic prompt");
    assert!(report.metadata.has_workflow_json);
    assert!(report.metadata.has_workflow_hint);
    assert_eq!(
        report.attempted_layers,
        vec!["workflow_chunk", "explicit_node", "sampler_traversal"]
    );
    assert_eq!(
        report
            .field_sources
            .get("workflow_json")
            .map(String::as_str),
        Some("workflow_chunk")
    );
    assert_eq!(
        report.field_sources.get("model").map(String::as_str),
        Some("sampler_traversal")
    );
    assert_eq!(
        report
            .field_sources
            .get("positive_prompt")
            .map(String::as_str),
        Some("sampler_traversal")
    );
    assert_eq!(
        report.field_source_node_ids.get("model"),
        Some(&vec!["4".to_string()])
    );
    assert_eq!(
        report.field_source_node_ids.get("positive_prompt"),
        Some(&vec!["6".to_string()])
    );
    assert_eq!(
        report.field_source_node_ids.get("sampler"),
        Some(&vec!["3".to_string()])
    );

    let mut legacy = serde_json::to_value(&report).expect("serialize diagnostics report");
    legacy
        .as_object_mut()
        .expect("diagnostics report should be an object")
        .remove("fieldSourceNodeIds");
    legacy
        .as_object_mut()
        .expect("diagnostics report should be an object")
        .remove("resourceSources");
    let legacy: ComfyParserDiagnosticsReport =
        serde_json::from_value(legacy).expect("deserialize legacy diagnostics report");
    assert!(legacy.field_source_node_ids.is_empty());
    assert!(legacy.resource_sources.is_empty());
}

#[test]
fn test_diagnostics_report_includes_flat_parameters_without_graph_chunks() {
    let mut chunks = HashMap::new();
    chunks.insert(
        "parameters".to_string(),
        "flat prompt\nSteps: 12, CFG scale: 5.0, Seed: 0, Model: flat_model, Version: ComfyUI"
            .to_string(),
    );

    let report = build_comfyui_diagnostics_report(&chunks);

    assert_eq!(report.chunk_keys, vec!["parameters"]);
    assert!(!report.has_prompt_chunk);
    assert!(!report.has_workflow_chunk);
    assert_eq!(report.graph_node_count, 0);
    assert_eq!(report.attempted_layers, vec!["flat_parameters"]);
    assert_eq!(
        report.field_sources.get("model").map(String::as_str),
        Some("flat_parameters")
    );
    assert_eq!(
        report
            .field_sources
            .get("positive_prompt")
            .map(String::as_str),
        Some("flat_parameters")
    );
    assert_eq!(report.metadata.tool, "ComfyUI");
    assert_eq!(report.metadata.model, "flat_model");
    assert_eq!(report.metadata.seed, Some(0));
    assert!(report.field_source_node_ids.is_empty());
    assert_eq!(report.metadata.steps, 12);
    assert_eq!(report.metadata.cfg, 5.0);
    assert_eq!(report.metadata.positive_prompt, "flat prompt");
    assert!(!report.metadata.has_workflow_json);
}

#[test]
fn test_diagnostics_report_identifies_unsupported_model_on_selected_output_path() {
    let prompt = r#"{
        "1": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "model": ["2", 0],
                "positive": ["3", 0],
                "negative": ["4", 0],
                "seed": 123,
                "steps": 20,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "2": { "class_type": "UnknownModelWrapper", "inputs": {} },
        "3": { "class_type": "CLIPTextEncode", "inputs": { "text": "prompt" } },
        "4": { "class_type": "ConditioningZeroOut", "inputs": {} },
        "5": { "class_type": "VAEDecode", "inputs": { "samples": ["1", 0] } },
        "6": { "class_type": "SaveImage", "inputs": { "images": ["5", 0] } }
    }"#;

    let report = build_comfyui_diagnostics_report(&chunks_with_prompt(prompt));

    assert_eq!(report.selected_output_candidate_count, 1);
    assert_eq!(report.unique_output_root_sampler_count, 1);
    assert!(!report.output_ambiguous);
    assert_eq!(report.traversal_issues.len(), 1);
    let issue = &report.traversal_issues[0];
    assert_eq!(issue.field, "model");
    assert_eq!(issue.node_id, "2");
    assert_eq!(issue.node_type, "UnknownModelWrapper");
    assert_eq!(issue.input_name.as_deref(), Some("model"));
    assert_eq!(issue.reason, "unsupported_node");
}

#[test]
fn test_diagnostics_report_marks_generated_prompt_without_flagging_zeroed_negative() {
    let prompt = r#"{
        "1": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "model": ["2", 0],
                "positive": ["3", 0],
                "negative": ["5", 0],
                "seed": 123,
                "steps": 20,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "2": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "diagnostic-model.safetensors" }
        },
        "3": { "class_type": "CLIPTextEncode", "inputs": { "text": ["4", 0] } },
        "4": { "class_type": "TextGenerate", "inputs": { "prompt": "generator input" } },
        "5": { "class_type": "ConditioningZeroOut", "inputs": {} },
        "6": { "class_type": "VAEDecode", "inputs": { "samples": ["1", 0] } },
        "7": { "class_type": "SaveImage", "inputs": { "images": ["6", 0] } }
    }"#;

    let report = build_comfyui_diagnostics_report(&chunks_with_prompt(prompt));

    assert_eq!(report.traversal_issues.len(), 1);
    let issue = &report.traversal_issues[0];
    assert_eq!(issue.field, "positive_prompt");
    assert_eq!(issue.node_id, "4");
    assert_eq!(issue.node_type, "TextGenerate");
    assert_eq!(issue.input_name.as_deref(), Some("text"));
    assert_eq!(issue.reason, "generated_value_unavailable");
    assert!(!report
        .traversal_issues
        .iter()
        .any(|issue| issue.field == "negative_prompt"));
}

#[test]
fn test_diagnostics_report_follows_selected_switch_branch_to_generated_prompt() {
    let prompt = r#"{
        "1": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "model": ["2", 0],
                "positive": ["3", 0],
                "negative": ["7", 0],
                "seed": 123,
                "steps": 20,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "2": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "diagnostic-model.safetensors" }
        },
        "3": { "class_type": "CLIPTextEncode", "inputs": { "text": ["4", 0] } },
        "4": {
            "class_type": "ComfySwitchNode",
            "inputs": {
                "switch": true,
                "on_true": ["5", 0],
                "on_false": "literal fallback"
            }
        },
        "5": { "class_type": "PreviewAny", "inputs": { "source": ["6", 0] } },
        "6": { "class_type": "TextGenerate", "inputs": { "prompt": "generator input" } },
        "7": { "class_type": "ConditioningZeroOut", "inputs": {} },
        "8": { "class_type": "VAEDecode", "inputs": { "samples": ["1", 0] } },
        "9": { "class_type": "SaveImage", "inputs": { "images": ["8", 0] } }
    }"#;

    let report = build_comfyui_diagnostics_report(&chunks_with_prompt(prompt));

    assert_eq!(report.traversal_issues.len(), 1);
    let issue = &report.traversal_issues[0];
    assert_eq!(issue.field, "positive_prompt");
    assert_eq!(issue.node_id, "6");
    assert_eq!(issue.node_type, "TextGenerate");
    assert_eq!(issue.input_name.as_deref(), Some("text"));
    assert_eq!(issue.reason, "generated_value_unavailable");
}

#[test]
fn test_ambiguous_output_report_exposes_counts_without_field_blockers() {
    let prompt = r#"{
        "1": {
            "class_type": "KSampler",
            "inputs": { "seed": 1, "steps": 10, "cfg": 5, "sampler_name": "euler" }
        },
        "2": {
            "class_type": "KSampler",
            "inputs": { "seed": 2, "steps": 20, "cfg": 6, "sampler_name": "heun" }
        },
        "3": { "class_type": "VAEDecode", "inputs": { "samples": ["1", 0] } },
        "4": { "class_type": "VAEDecode", "inputs": { "samples": ["2", 0] } },
        "5": { "class_type": "SaveImage", "inputs": { "images": ["3", 0] } },
        "6": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
    }"#;

    let report = build_comfyui_diagnostics_report(&chunks_with_prompt(prompt));

    assert_eq!(report.selected_output_candidate_count, 2);
    assert_eq!(report.unique_output_root_sampler_count, 2);
    assert!(report.output_ambiguous);
    assert!(report.traversal_issues.is_empty());
}

#[test]
fn test_diagnostics_report_bounds_untrusted_graph_labels() {
    let long_node_id = "n".repeat(256);
    let prompt = serde_json::json!({
        "1": {
            "class_type": "KSampler",
            "inputs": {
                "model": [long_node_id, 0],
                "seed": 1,
                "steps": 10,
                "cfg": 5,
                "sampler_name": "euler"
            }
        },
        "2": { "class_type": "VAEDecode", "inputs": { "samples": ["1", 0] } },
        "3": { "class_type": "SaveImage", "inputs": { "images": ["2", 0] } }
    })
    .to_string();

    let report = build_comfyui_diagnostics_report(&chunks_with_prompt(&prompt));

    assert_eq!(report.traversal_issues.len(), 1);
    assert_eq!(report.traversal_issues[0].reason, "missing_source_node");
    assert_eq!(report.traversal_issues[0].node_id.chars().count(), 128);
}

#[test]
fn test_diagnostics_report_labels_declared_but_unresolved_links() {
    let prompt = r#"{
        "1": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "model": ["2", 0],
                "positive": [{}, 0],
                "negative": ["4", 0],
                "seed": 123,
                "steps": 20,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "2": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "diagnostic-model.safetensors" }
        },
        "4": { "class_type": "ConditioningZeroOut", "inputs": {} },
        "5": { "class_type": "VAEDecode", "inputs": { "samples": ["1", 0] } },
        "6": { "class_type": "SaveImage", "inputs": { "images": ["5", 0] } }
    }"#;

    let report = build_comfyui_diagnostics_report(&chunks_with_prompt(prompt));

    assert_eq!(report.traversal_issues.len(), 1);
    let issue = &report.traversal_issues[0];
    assert_eq!(issue.field, "positive_prompt");
    assert_eq!(issue.node_id, "1");
    assert_eq!(issue.node_type, "KSampler");
    assert_eq!(issue.input_name.as_deref(), Some("positive"));
    assert_eq!(issue.reason, "unresolved_link");
}
