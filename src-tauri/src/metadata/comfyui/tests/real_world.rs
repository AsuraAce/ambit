use super::super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer};
use crate::metadata::comfyui::{extract_comfyui_metadata_with_diagnostics, merge_comfyui_metadata};
use crate::metadata::{extract_a1111_metadata, ImageMetadata};
use serde_json::Value;
use std::collections::HashMap;

struct RealWorldFixture {
    name: &'static str,
    chunks_json: &'static str,
}

const REAL_WORLD_FIXTURES: &[RealWorldFixture] = &[
    RealWorldFixture {
        name: "sdprompt_saver_setnode",
        chunks_json: include_str!("fixtures/real_world/sdprompt_saver_setnode.chunks.json"),
    },
    RealWorldFixture {
        name: "stylealigned_ui",
        chunks_json: include_str!("fixtures/real_world/stylealigned_ui.chunks.json"),
    },
    RealWorldFixture {
        name: "nsp_controlnet",
        chunks_json: include_str!("fixtures/real_world/nsp_controlnet.chunks.json"),
    },
    RealWorldFixture {
        name: "dual_ip_adapter",
        chunks_json: include_str!("fixtures/real_world/dual_ip_adapter.chunks.json"),
    },
    RealWorldFixture {
        name: "prompt_composition",
        chunks_json: include_str!("fixtures/real_world/prompt_composition.chunks.json"),
    },
    RealWorldFixture {
        name: "krea2_turbo_official_template",
        chunks_json: include_str!("fixtures/real_world/krea2_turbo_official_template.chunks.json"),
    },
    RealWorldFixture {
        name: "format_parity_webp_flat",
        chunks_json: include_str!("fixtures/real_world/format_parity_webp_flat.chunks.json"),
    },
    RealWorldFixture {
        name: "format_parity_jpeg_flat",
        chunks_json: include_str!("fixtures/real_world/format_parity_jpeg_flat.chunks.json"),
    },
    RealWorldFixture {
        name: "format_parity_png_save_metadata",
        chunks_json: include_str!(
            "fixtures/real_world/format_parity_png_save_metadata.chunks.json"
        ),
    },
    RealWorldFixture {
        name: "krea2_turbo_regular_saveimage",
        chunks_json: include_str!("fixtures/real_world/krea2_turbo_regular_saveimage.chunks.json"),
    },
];

#[test]
fn test_real_world_fixtures_extract_expected_metadata() {
    assert_real_world_fixture(
        "sdprompt_saver_setnode",
        ExpectedMetadata {
            model: "dreamshaper_8",
            seed: Some(501574468386073),
            steps: 20,
            cfg: 5.0,
            sampler: "dpmpp_2m (karras)",
            positive_prompt: "avatar themed portrait with blue skin and leaf clothing",
            negative_prompt: "low quality, watermark",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
            (ComfyMetadataField::Seed, ComfyParseLayer::ExplicitNode),
            (ComfyMetadataField::Steps, ComfyParseLayer::ExplicitNode),
            (ComfyMetadataField::Cfg, ComfyParseLayer::ExplicitNode),
            (ComfyMetadataField::Sampler, ComfyParseLayer::ExplicitNode),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::NegativePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_real_world_fixture(
        "stylealigned_ui",
        ExpectedMetadata {
            model: "stylealigned_base",
            seed: Some(24680013579),
            steps: 28,
            cfg: 6.5,
            sampler: "euler (normal)",
            positive_prompt: "Low poly crystal pine tree, flat background",
            negative_prompt: "text, watermark",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::Sampler,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::NegativePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_real_world_fixture(
        "nsp_controlnet",
        ExpectedMetadata {
            model: "revanimated_v11",
            seed: Some(273138048298546),
            steps: 12,
            cfg: 4.0,
            sampler: "dpmpp_sde (karras)",
            positive_prompt: "Alina Smirnov: young dancer on a boat, detailed dress and face",
            negative_prompt: "bad_quality",
            loras: &["epinoiseoffset_v2"],
            control_nets: &["control_sd15_openpose"],
            ip_adapters: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::Sampler,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::NegativePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
            (ComfyMetadataField::Loras, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::ControlNets,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_real_world_fixture(
        "dual_ip_adapter",
        ExpectedMetadata {
            model: "portrait_base",
            seed: Some(123),
            steps: 20,
            cfg: 8.0,
            sampler: "euler (normal)",
            positive_prompt: "reference portrait prompt",
            negative_prompt: "reference portrait prompt",
            loras: &["ip_adapter_faceid_plusv2_sd15_lora"],
            control_nets: &[],
            ip_adapters: &["ip_adapter_full_face_sd15", "ip_adapter_faceid_plusv2_sd15"],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::Sampler,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::NegativePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
            (ComfyMetadataField::Loras, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::IpAdapters,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_real_world_fixture(
        "prompt_composition",
        ExpectedMetadata {
            model: "z_image_turbo_bf16",
            seed: Some(515018389178561),
            steps: 6,
            cfg: 1.0,
            sampler: "res_multistep (simple)",
            positive_prompt: "Aiyana Lumiere Nyoka..., <lora:Mystic-XXX:1> <lora:Asians:0.65>",
            negative_prompt: "",
            loras: &["mystic_xxx", "asians (0.65)"],
            control_nets: &[],
            ip_adapters: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::SamplerFallback),
            (ComfyMetadataField::Seed, ComfyParseLayer::SamplerFallback),
            (ComfyMetadataField::Steps, ComfyParseLayer::SamplerFallback),
            (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerFallback),
            (
                ComfyMetadataField::Sampler,
                ComfyParseLayer::SamplerFallback,
            ),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::SamplerFallback,
            ),
            (ComfyMetadataField::Loras, ComfyParseLayer::SamplerFallback),
        ],
    );
}

#[test]
fn test_krea2_turbo_official_template_extracts_expected_metadata() {
    let fixture = get_fixture("krea2_turbo_official_template");
    let chunks = load_chunks(fixture);
    let expected_workflow = chunks
        .get("workflow")
        .expect("Krea fixture should preserve the workflow chunk");
    let expected_prompt = prompt_node_string(&chunks, "30:19", "value");

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_metadata(
        "krea2_turbo_official_template",
        &meta,
        ExpectedMetadata {
            model: "krea2_turbo_fp8_scaled",
            seed: Some(552211234818773),
            steps: 8,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: &expected_prompt,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
        },
    );
    assert!(
        expected_prompt.contains("A lone astronaut standing in a dark, dilapidated spaceship"),
        "Krea expected prompt should come from the user prompt node"
    );
    assert_archival_chunk_preserved(
        "krea2_turbo_official_template",
        &meta,
        &diagnostics,
        expected_workflow,
    );
    for (field, layer) in [
        (ComfyMetadataField::Model, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
        (
            ComfyMetadataField::Sampler,
            ComfyParseLayer::SamplerTraversal,
        ),
        (
            ComfyMetadataField::PositivePrompt,
            ComfyParseLayer::SamplerTraversal,
        ),
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&layer),
            "krea2_turbo_official_template should record {field:?} from {layer:?}"
        );
    }
}

#[test]
fn test_format_parity_flat_jpeg_webp_parameters_parse_cfg_and_unknown_prompts() {
    for fixture_name in ["format_parity_jpeg_flat", "format_parity_webp_flat"] {
        let fixture = get_fixture(fixture_name);
        let chunks = load_chunks(fixture);
        let parameters = chunks
            .get("parameters")
            .expect("flat image fixture should include parameters");
        let meta = extract_a1111_metadata(parameters, None);

        assert_eq!(meta.tool, "ComfyUI", "{fixture_name} tool");
        assert_eq!(
            meta.model, "ArrogantBastard_ponyV33SS",
            "{fixture_name} model"
        );
        assert_eq!(meta.steps, 20, "{fixture_name} steps");
        assert_eq!(meta.cfg, 8.0, "{fixture_name} cfg");
        assert_eq!(meta.seed, Some(0), "{fixture_name} seed");
        assert_eq!(meta.sampler, "euler_simple", "{fixture_name} sampler");
        assert_eq!(
            meta.positive_prompt, "",
            "{fixture_name} should treat literal unknown as missing positive prompt"
        );
        assert_eq!(
            meta.negative_prompt, "",
            "{fixture_name} should treat literal unknown as missing negative prompt"
        );
    }
}

#[test]
fn test_format_parity_png_graph_overrides_stale_flat_save_metadata() {
    let fixture = get_fixture("format_parity_png_save_metadata");
    let chunks = load_chunks(fixture);
    let expected_workflow = chunks
        .get("workflow")
        .expect("format parity PNG should include workflow chunk");
    let expected_prompt = prompt_node_string(&chunks, "30:19", "value");
    let parameters = chunks
        .get("parameters")
        .expect("format parity PNG should include flat parameters");

    let mut merged = extract_a1111_metadata(parameters, None);
    let diagnostics = merge_comfyui_metadata(&mut merged, &chunks);

    assert_metadata(
        "format_parity_png_save_metadata",
        &merged,
        ExpectedMetadata {
            model: "krea2_turbo_fp8_scaled",
            seed: Some(582731718186426),
            steps: 8,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: &expected_prompt,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
        },
    );
    assert!(
        !merged.positive_prompt.eq_ignore_ascii_case("unknown"),
        "format parity PNG should not preserve the stale saver prompt sentinel"
    );
    assert_eq!(
        merged.model_hash, None,
        "format parity PNG should not retain the stale flat hash after graph model override"
    );
    assert_eq!(
        merged.workflow_json.as_deref(),
        Some(expected_workflow.as_str()),
        "format parity PNG should preserve exact workflow JSON"
    );
    for (field, layer) in [
        (ComfyMetadataField::Model, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
        (
            ComfyMetadataField::Sampler,
            ComfyParseLayer::SamplerTraversal,
        ),
        (
            ComfyMetadataField::PositivePrompt,
            ComfyParseLayer::SamplerTraversal,
        ),
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&layer),
            "format parity PNG should record {field:?} from {layer:?}"
        );
    }
}

#[test]
fn test_trusted_graph_model_preserves_flat_hash_when_model_matches() {
    let parameters =
        "Steps: 12, Model: explicit_model, Model hash: matching_hash, Version: ComfyUI";
    let prompt = r#"{
        "1": {
            "class_type": "SDParameterGenerator",
            "inputs": {
                "ckpt_name": "explicit_model.safetensors"
            }
        }
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let mut merged = extract_a1111_metadata(parameters, None);
    let diagnostics = merge_comfyui_metadata(&mut merged, &chunks);

    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&ComfyParseLayer::ExplicitNode)
    );
    assert_eq!(merged.model, "explicit_model");
    assert_eq!(merged.model_hash.as_deref(), Some("matching_hash"));
}

#[test]
fn test_global_scan_model_does_not_override_known_flat_model() {
    let parameters = "flat prompt\nNegative prompt: flat negative\nSteps: 12, Sampler: euler, CFG Scale: 7.0, Seed: 42, Model: trusted_flat_model, Version: ComfyUI";
    let prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "wrong_disconnected_loader.safetensors"
            }
        },
        "2": {
            "class_type": "String",
            "inputs": {
                "value": "disconnected prompt"
            }
        }
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let mut merged = extract_a1111_metadata(parameters, None);
    let diagnostics = merge_comfyui_metadata(&mut merged, &chunks);

    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&ComfyParseLayer::GlobalScan),
        "synthetic graph should only provide model through weak global scan"
    );
    assert_eq!(
        merged.model, "trusted_flat_model",
        "weak ComfyUI global scan should not replace a known flat model"
    );
    assert!(
        !merged.model.contains("wrong_disconnected_loader"),
        "disconnected loader model should not win merge precedence"
    );
}

#[test]
fn test_krea2_regular_saveimage_remains_sampler_traversal() {
    let fixture = get_fixture("krea2_turbo_regular_saveimage");
    let chunks = load_chunks(fixture);
    let expected_workflow = chunks
        .get("workflow")
        .expect("Krea regular fixture should include workflow chunk");
    let expected_prompt = prompt_node_string(&chunks, "30:19", "value");

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_metadata(
        "krea2_turbo_regular_saveimage",
        &meta,
        ExpectedMetadata {
            model: "krea2_turbo_fp8_scaled",
            seed: Some(784968955782057),
            steps: 8,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: &expected_prompt,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
        },
    );
    assert_archival_chunk_preserved(
        "krea2_turbo_regular_saveimage",
        &meta,
        &diagnostics,
        expected_workflow,
    );
    for (field, layer) in [
        (ComfyMetadataField::Model, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
        (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
        (
            ComfyMetadataField::Sampler,
            ComfyParseLayer::SamplerTraversal,
        ),
        (
            ComfyMetadataField::PositivePrompt,
            ComfyParseLayer::SamplerTraversal,
        ),
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&layer),
            "regular Krea SaveImage should record {field:?} from {layer:?}"
        );
    }
}

struct ExpectedMetadata<'a> {
    model: &'a str,
    seed: Option<i64>,
    steps: u32,
    cfg: f32,
    sampler: &'a str,
    positive_prompt: &'a str,
    negative_prompt: &'a str,
    loras: &'a [&'a str],
    control_nets: &'a [&'a str],
    ip_adapters: &'a [&'a str],
}

fn assert_real_world_fixture(
    name: &str,
    expected: ExpectedMetadata<'_>,
    expected_sources: &[(ComfyMetadataField, ComfyParseLayer)],
) {
    let fixture = get_fixture(name);
    let chunks = load_chunks(fixture);
    let expected_archival_chunk = chunks
        .get("workflow")
        .or_else(|| chunks.get("prompt"))
        .expect("real-world fixture should include workflow or prompt chunk");

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_metadata(name, &meta, expected);
    assert_archival_chunk_preserved(name, &meta, &diagnostics, expected_archival_chunk);
    for (field, layer) in expected_sources {
        assert_eq!(
            diagnostics.field_sources.get(field),
            Some(layer),
            "{name} should record {field:?} from {layer:?}"
        );
    }
}

fn get_fixture(name: &str) -> &RealWorldFixture {
    REAL_WORLD_FIXTURES
        .iter()
        .find(|fixture| fixture.name == name)
        .expect("real-world fixture should be listed")
}

fn load_chunks(fixture: &RealWorldFixture) -> HashMap<String, String> {
    let raw: HashMap<String, Value> =
        serde_json::from_str(fixture.chunks_json).expect("real-world chunks should be valid JSON");

    raw.into_iter()
        .map(|(key, value)| {
            let chunk = value.as_str().map(ToOwned::to_owned).unwrap_or_else(|| {
                serde_json::to_string(&value).expect("real-world chunk value should serialize")
            });
            (key, chunk)
        })
        .collect()
}

fn prompt_node_string(chunks: &HashMap<String, String>, node_id: &str, input_name: &str) -> String {
    let prompt = chunks
        .get("prompt")
        .expect("fixture should include prompt chunk");
    let json: Value = serde_json::from_str(prompt).expect("prompt chunk should be valid JSON");
    json.get(node_id)
        .and_then(|node| node.get("inputs"))
        .and_then(|inputs| inputs.get(input_name))
        .and_then(|value| value.as_str())
        .expect("expected prompt node string should exist")
        .to_string()
}

fn assert_metadata(name: &str, meta: &ImageMetadata, expected: ExpectedMetadata<'_>) {
    assert_eq!(meta.tool, "ComfyUI", "{name} should be detected as ComfyUI");
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
    assert_eq!(
        meta.control_nets, expected.control_nets,
        "{name} ControlNets"
    );
    assert_eq!(meta.ip_adapters, expected.ip_adapters, "{name} IP-Adapters");
}

fn assert_archival_chunk_preserved(
    name: &str,
    meta: &ImageMetadata,
    diagnostics: &ComfyParseDiagnostics,
    expected_archival_chunk: &str,
) {
    assert_eq!(
        meta.workflow_json.as_deref(),
        Some(expected_archival_chunk),
        "{name} should preserve the exact loaded archival chunk"
    );
    assert!(meta.has_workflow_hint, "{name} should set workflow hint");
    assert!(
        diagnostics.graph_node_count > 0,
        "{name} should normalize graph nodes"
    );
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::WorkflowJson),
        Some(&ComfyParseLayer::WorkflowChunk),
        "{name} should source archival JSON from the workflow chunk layer"
    );
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::WorkflowHint),
        Some(&ComfyParseLayer::WorkflowChunk),
        "{name} should source workflow hint from the workflow chunk layer"
    );
}
