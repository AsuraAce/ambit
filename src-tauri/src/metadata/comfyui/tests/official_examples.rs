use super::super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use crate::metadata::ImageMetadata;
use std::collections::HashMap;

struct OfficialExample {
    name: &'static str,
    chunks_json: &'static str,
}

const OFFICIAL_EXAMPLES: &[OfficialExample] = &[
    OfficialExample {
        name: "sdxl_simple_example",
        chunks_json: include_str!("fixtures/official_examples/sdxl/sdxl_simple_example.chunks.json"),
    },
    OfficialExample {
        name: "flux_dev_example",
        chunks_json: include_str!("fixtures/official_examples/flux/flux_dev_example.chunks.json"),
    },
    OfficialExample {
        name: "qwen_image_basic_example",
        chunks_json: include_str!(
            "fixtures/official_examples/qwen_image/qwen_image_basic_example.chunks.json"
        ),
    },
    OfficialExample {
        name: "lora_multiple",
        chunks_json: include_str!("fixtures/official_examples/lora/lora_multiple.chunks.json"),
    },
    OfficialExample {
        name: "controlnet_example",
        chunks_json: include_str!(
            "fixtures/official_examples/controlnet/controlnet_example.chunks.json"
        ),
    },
    OfficialExample {
        name: "img2img_workflow",
        chunks_json: include_str!(
            "fixtures/official_examples/img2img/img2img_workflow.chunks.json"
        ),
    },
    OfficialExample {
        name: "inpaint_example",
        chunks_json: include_str!("fixtures/official_examples/inpaint/inpaint_example.chunks.json"),
    },
    OfficialExample {
        name: "embedding_example",
        chunks_json: include_str!(
            "fixtures/official_examples/textual_inversion_embeddings/embedding_example.chunks.json"
        ),
    },
    OfficialExample {
        name: "hypernetwork_example",
        chunks_json: include_str!(
            "fixtures/official_examples/hypernetworks/hypernetwork_example.chunks.json"
        ),
    },
    OfficialExample {
        name: "esrgan_example",
        chunks_json: include_str!(
            "fixtures/official_examples/upscale_models/esrgan_example.chunks.json"
        ),
    },
    OfficialExample {
        name: "sd3_5_simple_example",
        chunks_json: include_str!(
            "fixtures/official_examples/sd3/sd3.5_simple_example.chunks.json"
        ),
    },
    OfficialExample {
        name: "z_image_turbo_example",
        chunks_json: include_str!(
            "fixtures/official_examples/z_image/z_image_turbo_example.chunks.json"
        ),
    },
];

fn load_chunks(example: &OfficialExample) -> HashMap<String, String> {
    serde_json::from_str(example.chunks_json).expect("official fixture chunks should be valid JSON")
}

#[test]
fn test_official_examples_extract_expected_metadata() {
    assert_official_example(
        "sdxl_simple_example",
        ExpectedMetadata {
            model: "sd_xl_base_1.0",
            seed: Some(721897303308196),
            steps: 25,
            cfg: 8.0,
            sampler: "euler (normal)",
            positive_prompt: "evening sunset scenery blue sky nature, glass bottle with a galaxy in it",
            negative_prompt: "text, watermark",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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

    assert_official_example(
        "flux_dev_example",
        ExpectedMetadata {
            model: "flux1_dev",
            seed: None,
            steps: 20,
            cfg: 0.0,
            sampler: "euler (simple)",
            positive_prompt: "cute anime girl with massive fluffy fennec ears and a big fluffy tail blonde messy long hair blue eyes wearing a maid outfit with a long black gold leaf pattern dress and a white apron mouth open holding a fancy black forest cake with candles on top in the kitchen of an old dark Victorian mansion lit by candlelight with a bright window to the foggy forest and very expensive stuff everywhere",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
            (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::Sampler,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_official_example(
        "qwen_image_basic_example",
        ExpectedMetadata {
            model: "qwen_image_fp8_e4m3fn",
            seed: Some(1091359629774730),
            steps: 20,
            cfg: 2.5,
            sampler: "euler (simple)",
            positive_prompt: r#"cute anime girl with massive fennec ears and a big fluffy fox tail with long wavy blonde hair between eyes and large blue eyes blonde colored eyelashes chubby wearing oversized clothes summer uniform long blue maxi skirt muddy clothes happy sitting on the side of the road in a run down dark gritty cyberpunk city with neon and a crumbling skyscraper in the rain at night while dipping her feet in a river of water she is holding a sign that says "ComfyUI is the best" written in cursive"#,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
            (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::Sampler,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::ExplicitNode,
            ),
        ],
    );

    assert_official_example(
        "lora_multiple",
        ExpectedMetadata {
            model: "v1_5_pruned_emaonly",
            seed: Some(513173432917412),
            steps: 20,
            cfg: 8.0,
            sampler: "euler (normal)",
            positive_prompt: "masterpiece best quality girl",
            negative_prompt: "bad hands",
            loras: &["epinoiseoffset_v2", "theovercomer8scontrastfix_sd15"],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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
        ],
    );

    assert_official_example(
        "controlnet_example",
        ExpectedMetadata {
            model: "anything_v3.0",
            seed: Some(1002496614778823),
            steps: 16,
            cfg: 6.0,
            sampler: "uni_pc (normal)",
            positive_prompt: "(solo) girl (flat chest:0.9), (fennec ears:1.1)\u{a0} (fox ears:1.1), (blonde hair:1.0), messy hair, sky clouds, standing in a grass field, (chibi), blue eyes",
            negative_prompt: "(hands), text, error, cropped, (worst quality:1.2), (low quality:1.2), normal quality, (jpeg artifacts:1.3), signature, watermark, username, blurry, artist name, monochrome, sketch, censorship, censor, (copyright:1.2), extra legs, (forehead mark) (depth of field) (emotionless) (penis)",
            loras: &[],
            control_nets: &["control_scribble"],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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
            (
                ComfyMetadataField::ControlNets,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_official_example(
        "img2img_workflow",
        ExpectedMetadata {
            model: "v1_5_pruned_emaonly",
            seed: Some(280823642470253),
            steps: 20,
            cfg: 8.0,
            sampler: "dpmpp_2m (normal)",
            positive_prompt: "photograph of victorian woman with wings, sky clouds, meadow grass\n",
            negative_prompt: "watermark, text\n",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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

    assert_official_example(
        "inpaint_example",
        ExpectedMetadata {
            model: "512_inpainting_ema",
            seed: Some(1040111309094545),
            steps: 20,
            cfg: 8.0,
            sampler: "uni_pc_bh2 (normal)",
            positive_prompt:
                "closeup photograph of maine coon (cat:1.2) in the yosemite national park mountains nature",
            negative_prompt: "watermark, text\n",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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

    assert_official_example(
        "embedding_example",
        ExpectedMetadata {
            model: "v2_1_768_ema_pruned",
            seed: Some(193694018275622),
            steps: 20,
            cfg: 8.0,
            sampler: "uni_pc_bh2 (normal)",
            positive_prompt:
                "photograph in the style of embedding:SDA768.pt girl with blonde hair\nlandscape scenery view",
            negative_prompt: "bad hands",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &["sda768"],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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
            (
                ComfyMetadataField::Embeddings,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_official_example(
        "hypernetwork_example",
        ExpectedMetadata {
            model: "v1_5_pruned_emaonly",
            seed: Some(572636856966402),
            steps: 20,
            cfg: 8.0,
            sampler: "uni_pc_bh2 (normal)",
            positive_prompt: "woman (fennec ears fox ears:1.1), marble statue, museum",
            negative_prompt: "text, watermark",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &["dantionmarblestatues_10"],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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
            (
                ComfyMetadataField::Hypernetworks,
                ComfyParseLayer::SamplerTraversal,
            ),
        ],
    );

    assert_official_example(
        "esrgan_example",
        ExpectedMetadata {
            model: "v1_5_pruned_emaonly",
            seed: Some(833543590226030),
            steps: 20,
            cfg: 8.0,
            sampler: "euler (normal)",
            positive_prompt: "masterpiece best quality girl standing in victorian clothing",
            negative_prompt: "bad hands",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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

    assert_official_example(
        "sd3_5_simple_example",
        ExpectedMetadata {
            model: "sd3.5_large_fp8_scaled",
            seed: Some(585483408983215),
            steps: 20,
            cfg: 4.01,
            sampler: "euler (sgm_uniform)",
            positive_prompt: "a bottle with a pink and red galaxy inside it on top of a wooden table on a table in the middle of a modern kitchen with a window to the outdoors mountain range bright sun clouds forest",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
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
        ],
    );

    assert_official_example(
        "z_image_turbo_example",
        ExpectedMetadata {
            model: "z_image_turbo_bf16",
            seed: Some(47447417949230),
            steps: 9,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: r#"cute anime style girl with massive fluffy fennec ears and a big fluffy tail blonde messy long hair blue eyes wearing a maid outfit with a long black gold leaf pattern dress and a white apron, it is a postcard held by a hand in front of a beautiful realistic city at sunset and there is cursive writing that says "ZImage, Now in ComfyUI""#,
            negative_prompt: "blurry ugly bad",
            loras: &[],
            control_nets: &[],
            ip_adapters: &[],
            embeddings: &[],
            hypernetworks: &[],
        },
        &[
            (ComfyMetadataField::Model, ComfyParseLayer::ExplicitNode),
            (ComfyMetadataField::Seed, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Steps, ComfyParseLayer::SamplerTraversal),
            (ComfyMetadataField::Cfg, ComfyParseLayer::SamplerTraversal),
            (
                ComfyMetadataField::Sampler,
                ComfyParseLayer::SamplerTraversal,
            ),
            (
                ComfyMetadataField::PositivePrompt,
                ComfyParseLayer::ExplicitNode,
            ),
            (
                ComfyMetadataField::NegativePrompt,
                ComfyParseLayer::ExplicitNode,
            ),
        ],
    );
}

#[test]
fn test_hypernetwork_official_example_extracts_from_workflow_only() {
    let example = OFFICIAL_EXAMPLES
        .iter()
        .find(|example| example.name == "hypernetwork_example")
        .expect("official hypernetwork example should be listed");
    let mut chunks = load_chunks(example);
    let expected_workflow = chunks
        .get("workflow")
        .expect("official fixture should include workflow chunk")
        .clone();
    chunks.remove("prompt");

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "v1_5_pruned_emaonly");
    assert_eq!(meta.hypernetworks, ["dantionmarblestatues_10"]);
    assert_eq!(meta.workflow_json.as_deref(), Some(expected_workflow.as_str()));
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::Hypernetworks),
        Some(&ComfyParseLayer::SamplerTraversal)
    );
}

struct ExpectedMetadata {
    model: &'static str,
    seed: Option<i64>,
    steps: u32,
    cfg: f32,
    sampler: &'static str,
    positive_prompt: &'static str,
    negative_prompt: &'static str,
    loras: &'static [&'static str],
    control_nets: &'static [&'static str],
    ip_adapters: &'static [&'static str],
    embeddings: &'static [&'static str],
    hypernetworks: &'static [&'static str],
}

fn assert_official_example(
    name: &str,
    expected: ExpectedMetadata,
    expected_sources: &[(ComfyMetadataField, ComfyParseLayer)],
) {
    let example = OFFICIAL_EXAMPLES
        .iter()
        .find(|example| example.name == name)
        .expect("official example should be listed");
    let chunks = load_chunks(example);
    let expected_workflow = chunks
        .get("workflow")
        .expect("official fixture should include workflow chunk");

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_metadata(name, &meta, expected);
    assert_workflow_preserved(name, &meta, &diagnostics, expected_workflow);
    for (field, layer) in expected_sources {
        assert_eq!(
            diagnostics.field_sources.get(field),
            Some(layer),
            "{name} should record {field:?} from {layer:?}"
        );
    }
}

fn assert_metadata(name: &str, meta: &ImageMetadata, expected: ExpectedMetadata) {
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
    assert_eq!(
        meta.ip_adapters, expected.ip_adapters,
        "{name} IP-Adapters"
    );
    assert_eq!(meta.embeddings, expected.embeddings, "{name} embeddings");
    assert_eq!(
        meta.hypernetworks, expected.hypernetworks,
        "{name} hypernetworks"
    );
}

fn assert_workflow_preserved(
    name: &str,
    meta: &ImageMetadata,
    diagnostics: &ComfyParseDiagnostics,
    expected_workflow: &str,
) {
    assert_eq!(
        meta.workflow_json.as_deref(),
        Some(expected_workflow),
        "{name} should preserve exact workflow JSON"
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
        "{name} should source workflow JSON from the workflow chunk"
    );
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::WorkflowHint),
        Some(&ComfyParseLayer::WorkflowChunk),
        "{name} should source workflow hint from the workflow chunk"
    );
}
