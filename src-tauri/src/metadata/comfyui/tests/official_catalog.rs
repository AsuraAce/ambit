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
    CatalogFixture {
        name: "01_get_started_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/01_get_started_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "02_qwen_Image_edit_subgraphed",
        chunks_json: include_str!(
            "fixtures/official_catalog/02_qwen_Image_edit_subgraphed.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_flux2_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_qwen_Image_2512_controlnet",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_Image_2512_controlnet.chunks.json"
        ),
    },
    CatalogFixture {
        name: "gsc_creator_2_2",
        chunks_json: include_str!("fixtures/official_catalog/gsc_creator_2_2.chunks.json"),
    },
    CatalogFixture {
        name: "gsc_creator_2_3",
        chunks_json: include_str!("fixtures/official_catalog/gsc_creator_2_3.chunks.json"),
    },
    CatalogFixture {
        name: "image_flux2_klein_image_edit_4b_distilled",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_image_edit_4b_distilled.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_qwen_image_union_control_lora",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_union_control_lora.chunks.json"
        ),
    },
    CatalogFixture {
        name: "Image_capybara_v0_1_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/Image_capybara_v0_1_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_kandinsky5_t2i",
        chunks_json: include_str!("fixtures/official_catalog/image_kandinsky5_t2i.chunks.json"),
    },
    CatalogFixture {
        name: "image_omnigen2_t2i",
        chunks_json: include_str!("fixtures/official_catalog/image_omnigen2_t2i.chunks.json"),
    },
    CatalogFixture {
        name: "image_chroma1_radiance_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_chroma1_radiance_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_firered_image_edit1_1",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_firered_image_edit1_1.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_ernie_image",
        chunks_json: include_str!("fixtures/official_catalog/image_ernie_image.chunks.json"),
    },
    CatalogFixture {
        name: "image_ernie_image_turbo",
        chunks_json: include_str!("fixtures/official_catalog/image_ernie_image_turbo.chunks.json"),
    },
    CatalogFixture {
        name: "image_anima_base_v1",
        chunks_json: include_str!("fixtures/official_catalog/image_anima_base_v1.chunks.json"),
    },
    CatalogFixture {
        name: "image_newbieimage_exp0_1-t2i",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_newbieimage_exp0_1-t2i.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_lens_t2i",
        chunks_json: include_str!("fixtures/official_catalog/image_lens_t2i.chunks.json"),
    },
    CatalogFixture {
        name: "image_boogu_image_0_1_edit",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_edit.chunks.json"
        ),
    },
    CatalogFixture {
        name: "flux_depth_lora_example",
        chunks_json: include_str!("fixtures/official_catalog/flux_depth_lora_example.chunks.json"),
    },
    CatalogFixture {
        name: "image_z_image_turbo_fun_union_controlnet",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_z_image_turbo_fun_union_controlnet.chunks.json"
        ),
    },
    CatalogFixture {
        name: "video_bernini_r_image_editing",
        chunks_json: include_str!(
            "fixtures/official_catalog/video_bernini_r_image_editing.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_ideogram4_t2i",
        chunks_json: include_str!("fixtures/official_catalog/image_ideogram4_t2i.chunks.json"),
    },
    CatalogFixture {
        name: "image_longcat_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_longcat_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_pixeldit_t2i",
        chunks_json: include_str!("fixtures/official_catalog/image_pixeldit_t2i.chunks.json"),
    },
    CatalogFixture {
        name: "image_chrono_edit_14B",
        chunks_json: include_str!("fixtures/official_catalog/image_chrono_edit_14B.chunks.json"),
    },
    CatalogFixture {
        name: "image_netayume_lumina_t2i",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_netayume_lumina_t2i.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_longcat_image_edit",
        chunks_json: include_str!("fixtures/official_catalog/image_longcat_image_edit.chunks.json"),
    },
    CatalogFixture {
        name: "Image_capybara_v0_1_image_edit",
        chunks_json: include_str!(
            "fixtures/official_catalog/Image_capybara_v0_1_image_edit.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_omnigen2_image_edit",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_omnigen2_image_edit.chunks.json"
        ),
    },
    CatalogFixture {
        name: "hidream_e1_1",
        chunks_json: include_str!("fixtures/official_catalog/hidream_e1_1.chunks.json"),
    },
    CatalogFixture {
        name: "flux1_dev_uso_reference_image_gen",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux1_dev_uso_reference_image_gen.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_flux.1_fill_dev_OneReward",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux.1_fill_dev_OneReward.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_flux2_klein_9b_kv_image_edit",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_9b_kv_image_edit.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image-qwen_image_edit_2511_lora_inflation",
        chunks_json: include_str!(
            "fixtures/official_catalog/image-qwen_image_edit_2511_lora_inflation.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_qwen_Image_2512",
        chunks_json: include_str!("fixtures/official_catalog/image_qwen_Image_2512.chunks.json"),
    },
    CatalogFixture {
        name: "image_qwen_image_2512_with_2steps_lora",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_2512_with_2steps_lora.chunks.json"
        ),
    },
    CatalogFixture {
        name: "hidream_i1_dev",
        chunks_json: include_str!("fixtures/official_catalog/hidream_i1_dev.chunks.json"),
    },
    CatalogFixture {
        name: "hidream_i1_fast",
        chunks_json: include_str!("fixtures/official_catalog/hidream_i1_fast.chunks.json"),
    },
    CatalogFixture {
        name: "image_krea2_turbo_t2i_int8",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_krea2_turbo_t2i_int8.chunks.json"
        ),
    },
    CatalogFixture {
        name: "flux_dev_checkpoint_example",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux_dev_checkpoint_example.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_boogu_image_0_1_turbo_t2i",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_turbo_t2i.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_chroma_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_chroma_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_qwen_image",
        chunks_json: include_str!("fixtures/official_catalog/image_qwen_image.chunks.json"),
    },
    CatalogFixture {
        name: "image_z_image_turbo",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image_turbo.chunks.json"),
    },
    CatalogFixture {
        name: "flux_dev_full_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux_dev_full_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "flux1_krea_dev",
        chunks_json: include_str!("fixtures/official_catalog/flux1_krea_dev.chunks.json"),
    },
    CatalogFixture {
        name: "image_qwen_image_edit",
        chunks_json: include_str!("fixtures/official_catalog/image_qwen_image_edit.chunks.json"),
    },
    CatalogFixture {
        name: "image_z_image",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image.chunks.json"),
    },
    CatalogFixture {
        name: "image_z_image_turbo_int8",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image_turbo_int8.chunks.json"),
    },
    CatalogFixture {
        name: "image_flux2",
        chunks_json: include_str!("fixtures/official_catalog/image_flux2.chunks.json"),
    },
    CatalogFixture {
        name: "image_flux2_fp8",
        chunks_json: include_str!("fixtures/official_catalog/image_flux2_fp8.chunks.json"),
    },
    CatalogFixture {
        name: "image_flux2_klein_image_edit_4b_base",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_image_edit_4b_base.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_flux2_klein_image_edit_9b_base",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_image_edit_9b_base.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_flux2_klein_image_edit_9b_distilled",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_image_edit_9b_distilled.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_flux2_klein_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_flux2_text_to_image_9b",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_text_to_image_9b.chunks.json"
        ),
    },
    CatalogFixture {
        name: "flux_schnell_full_text_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux_schnell_full_text_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "hidream_e1_full",
        chunks_json: include_str!("fixtures/official_catalog/hidream_e1_full.chunks.json"),
    },
    CatalogFixture {
        name: "image_hidream_o1",
        chunks_json: include_str!("fixtures/official_catalog/image_hidream_o1.chunks.json"),
    },
    CatalogFixture {
        name: "image_hidream_o1_dev",
        chunks_json: include_str!("fixtures/official_catalog/image_hidream_o1_dev.chunks.json"),
    },
    CatalogFixture {
        name: "image_qwen_image_edit_2511",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_edit_2511.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_krea2_turbo_int8_image_style_reference",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_krea2_turbo_int8_image_style_reference.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_qwen_image_edit_2511_int8",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_edit_2511_int8.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_ideogram4_t2i_int8",
        chunks_json: include_str!("fixtures/official_catalog/image_ideogram4_t2i_int8.chunks.json"),
    },
    CatalogFixture {
        name: "image_anima_lllite_any_control_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_anima_lllite_any_control_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_anima_lllite_image_inpainting",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_anima_lllite_image_inpainting.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_anima_lllite_depth_control_to_image",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_anima_lllite_depth_control_to_image.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_boogu_image_0_1_edit_int8",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_edit_int8.chunks.json"
        ),
    },
    CatalogFixture {
        name: "image_z_image_int8",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image_int8.chunks.json"),
    },
    CatalogFixture {
        name: "image_joyai_image_edit",
        chunks_json: include_str!("fixtures/official_catalog/image_joyai_image_edit.chunks.json"),
    },
];

const IDEOGRAM_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_ideogram4_t2i.expected-positive.txt");
const NETAYUME_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_netayume_lumina_t2i.expected-positive.txt");
const NETAYUME_EXPECTED_NEGATIVE: &str =
    include_str!("fixtures/official_catalog/image_netayume_lumina_t2i.expected-negative.txt");
const QWEN_IMAGE_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_qwen_image.expected-positive.txt");
const Z_IMAGE_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_z_image.expected-positive.txt");
const IDEOGRAM_INT8_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_ideogram4_t2i_int8.expected-positive.txt");
const Z_IMAGE_INT8_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_z_image_int8.expected-positive.txt");
const ANIMA_LLLITE_ANY_EXPECTED_POSITIVE: &str = include_str!(
    "fixtures/official_catalog/image_anima_lllite_any_control_to_image.expected-positive.txt"
);
const ANIMA_LLLITE_DEPTH_EXPECTED_POSITIVE: &str = include_str!(
    "fixtures/official_catalog/image_anima_lllite_depth_control_to_image.expected-positive.txt"
);

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
            .get(&ComfyMetadataField::PositivePrompt),
        (!expected.positive_prompt.is_empty()).then_some(&expected.source),
        "{name} positive prompt provenance"
    );
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
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::ControlNets),
        (!expected.control_nets.is_empty()).then_some(&expected.source),
        "{name} ControlNet provenance"
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
    assert_eq!(
        meta.control_nets, expected.control_nets,
        "{name} ControlNets"
    );
    assert!(meta.ip_adapters.is_empty(), "{name} IP-Adapters");
    assert!(
        meta.embeddings.is_empty(),
        "{name} embeddings: {:?}",
        meta.embeddings
    );
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
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 26,
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
            control_nets: &[],
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
            control_nets: &[],
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
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 12,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn getting_started_z_image_text_to_image() {
    assert_fixture(
        "01_get_started_text_to_image",
        ExpectedMetadata {
            model: "z_image_turbo_bf16",
            seed: Some(0),
            steps: 4,
            cfg: 1.0,
            sampler: "res_multistep (simple)",
            positive_prompt: r#"Giant blue and purple big billboard on rooftop in san francisco city billboard says "ComfyUI is built with love" All kinds of buoildings in different shapes and colors. Some buildings have grafitti "We" "Here" "Today""#,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 11,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn getting_started_qwen_image_edit_subgraph() {
    assert_fixture(
        "02_qwen_Image_edit_subgraphed",
        ExpectedMetadata {
            model: "qwen_image_edit_2509_fp8_e4m3fn",
            seed: Some(1_118_877_715_456_453),
            steps: 4,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "Change the style of the image to a realistic style. The cloud in the background is realistic and fluffy. The balloon is yellow and reflective. ",
            negative_prompt: "",
            loras: &["qwen_image_edit_2509_lightning_4steps_v1.0_bf16"],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 22,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_text_to_image() {
    assert_fixture(
        "image_flux2_text_to_image",
        ExpectedMetadata {
            model: "flux2_dev_fp8mixed",
            seed: Some(1_027_111_520_328_378),
            steps: 20,
            cfg: 4.0,
            sampler: "euler",
            positive_prompt: "high fashion, vintage couture, street photography, luxury fashion shoot, neo brutalist architecture, pastel paints",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 20,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_2512_controlnet() {
    assert_fixture(
        "image_qwen_Image_2512_controlnet",
        ExpectedMetadata {
            model: "qwen_image_2512_fp8_e4m3fn",
            seed: Some(985_578_626_029_454),
            steps: 50,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: "A woman with curly hair, wearing orange sunglasses, a white knit sweater with orange accents, and high-waisted orange trousers, stands confidently against a vibrant, clear blue sky. The photo has a warm, sunlit filter that amplifies the rich terracotta and burnt orange tones of her outfit, while the cool, deep blue background is intensified, creating a bold, saturated contrast that feels vivid and cinematic.",
            negative_prompt: "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲",
            loras: &[],
            control_nets: &["qwen_image_2512_fun_controlnet_union_2602"],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 30,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn gsc_creator_2_2() {
    assert_fixture(
        "gsc_creator_2_2",
        ExpectedMetadata {
            model: "z_image_turbo_bf16",
            seed: Some(467_616_719_697_168),
            steps: 9,
            cfg: 1.0,
            sampler: "res_multistep (simple)",
            positive_prompt: "sunglasses.",
            negative_prompt: "",
            loras: &[],
            control_nets: &["z_image_turbo_fun_controlnet_union_2.1"],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 32,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn gsc_creator_2_3_generated_prompt_is_partial() {
    assert_fixture(
        "gsc_creator_2_3",
        ExpectedMetadata {
            model: "z_image_turbo_bf16",
            seed: Some(344_777_149_081_245),
            steps: 5,
            cfg: 1.0,
            sampler: "dpmpp_2m_sde (beta)",
            positive_prompt: "masterpiece, 8k",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 26,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_klein_image_edit_4b_distilled() {
    assert_fixture(
        "image_flux2_klein_image_edit_4b_distilled",
        ExpectedMetadata {
            model: "flux_2_klein_4b_fp8",
            seed: Some(43_301_611_940_728),
            steps: 4,
            cfg: 1.0,
            sampler: "euler",
            positive_prompt: "Change the bag color to blue.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 24,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_union_control_lora() {
    assert_fixture(
        "image_qwen_image_union_control_lora",
        ExpectedMetadata {
            model: "qwen_image_fp8_e4m3fn",
            seed: Some(761_977_315_566_722),
            steps: 20,
            cfg: 2.5,
            sampler: "euler (simple)",
            positive_prompt: "Extreme close-up shot, realistic digital illustration, close eyes, peaceful,oil painting with thick application, girl with curly hair, large black flower, black nail polish, ring details, soft light and shadow, dark green backdrop, delicate hair texture, smooth skin rendering, fine artistic details, dreamy and elegant atmosphere, dark style, grotesque. White hair, huge black flower behind her (with yellow stamens, green stems and leaves), black turtleneck clothing, green leaves and black flowers around, artistic illustration style, sharp color contrast, mysterious atmosphere, delicate brushstrokes, thick oil painting, thickly applied oil painting, the whole picture is filled with layered flowers, huge, petals spreading, beautiful composition, unexpected angle, layered background. Macro, eyes looking down, thick application, brushstrokes, splatters, mottled, old, extremely romantic, light and shadow, strong contrast, maximalist style, full-frame composition.",
            negative_prompt: "",
            loras: &["qwen_image_union_diffsynth_lora"],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 29,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn capybara_text_to_image() {
    assert_fixture(
        "Image_capybara_v0_1_text_to_image",
        ExpectedMetadata {
            model: "capybara_v0.1",
            seed: Some(902_334_010_808_173),
            steps: 20,
            cfg: 6.0,
            sampler: "euler (simple)",
            positive_prompt: "A serene portrait of a young woman, her profile framed against a soft, desaturated teal backdrop; the black habit and white coif and collar are rendered in muted, low-saturation tones, with gentle lighting casting subtle shadows on her face, creating a calm, understated visual balance.",
            negative_prompt: "blurry, low quality, distorted, ugly, watermark, text",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 17,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn kandinsky5_text_to_image() {
    assert_fixture(
        "image_kandinsky5_t2i",
        ExpectedMetadata {
            model: "kandinsky5lite_t2i",
            seed: Some(297_935_044_336_751),
            steps: 50,
            cfg: 3.5,
            sampler: "euler (simple)",
            positive_prompt: concat!(
                "A three-quarter side profile shot captured from a slightly low, stationary camera angle, this image frames a joyful hiker against the jagged, dramatic peaks of the Dolomites, where the elevated perspective emphasizes both the grandeur of the alpine landscape and the upward, hopeful tilt of his gaze. He wears a snug, mustard-yellow knit beanie that matches his chunky, textured sweater, paired with round, wire-rimmed glasses that add a thoughtful, approachable charm, while a rugged, oversized hiking backpack in weathered taupe is secured across his shoulders with gray, adjustable straps, complemented by a utility waist belt with a small, functional pouch. The scene is enhanced by a warm, vintage-inspired filter that bathes the frame in rich golden-amber tones, boosting contrast between the hiker\u{2019}s vibrant knitwear and the tawny mountain slopes, and a subtle film grain that lends a nostalgic, cinematic quality; soft, directional sunlight casts gentle shadows along his beard and sweater to add depth, with the crisp, saturated blue sky providing a striking counterpoint to the earthy foreground, creating an immersive portrait of adventure and warmth.",
                "\n"
            ),
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 11,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn omnigen2_text_to_image() {
    assert_fixture(
        "image_omnigen2_t2i",
        ExpectedMetadata {
            model: "omnigen2_fp16",
            seed: Some(375_248_071_721_913),
            steps: 20,
            cfg: 5.0,
            sampler: "euler (simple)",
            positive_prompt: "A cat with a crown lounging on a velvet throne, royal atmosphere, luxurious fabric texture, regal pose, detailed fur, ornate crown, dramatic lighting",
            negative_prompt: "blurry, low quality, distorted, ugly, bad anatomy, deformed, poorly drawn",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 14,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn chroma_radiance_text_to_image() {
    assert_fixture(
        "image_chroma1_radiance_text_to_image",
        ExpectedMetadata {
            model: "chroma_radiance_x0",
            seed: Some(883_855_055_680_159),
            steps: 30,
            cfg: 3.5,
            sampler: "euler (beta)",
            positive_prompt: "Hyperrealistic macro photograph of a team of tiny bakers\u{2014}each precisely 2 inches tall\u{2014}collaborating on an enormous, golden-brown croissant with flaky, layered textures. The bakers are engaged in dynamic, detailed actions: one uses a miniature wooden bucket to spread rich, creamy butter between the croissant\u{2019}s layers, another climbs a thin rope ladder to evenly pipe smooth, glossy chocolate filling onto the top, and a third brushes a light egg wash with a tiny pastry brush. The scene is bathed in warm, soft kitchen lighting with cinematic depth\u{2014}subtle highlights on the croissant\u{2019}s golden crust, gentle shadows that emphasize texture, and a soft glow from overhead pendant lights. Floating flour dust particles catch the light, adding a sense of movement and realism, while tiny details like the bakers\u{2019} stitched cloth aprons, smudged flour on their faces, the rough wood of the worktable, and the slight sheen of melted butter on the croissant are rendered with ultra-precision. Ultra-detailed, 8K resolution, photorealistic textures, sharp focus on the bakers and croissant, shallow depth of field to blur the background slightly, rich warm color palette, lifelike proportions, and a cozy, whimsical atmosphere that balances realism with charm.",
            negative_prompt: "This low quality greyscale unfinished sketch is inaccurate and flawed. The image is very blurred and lacks detail with excessive chromatic aberrations and artifacts. The image is overly saturated with excessive bloom.",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 21,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn firered_image_edit() {
    assert_fixture(
        "image_firered_image_edit1_1",
        ExpectedMetadata {
            model: "firered_image_edit_1.1_transformer",
            seed: Some(43),
            steps: 40,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: concat!(
                "A young woman in a layered, ethereal outfit of sheer, frosted white fabric over a matte underlayer, with delicate, glowing fiber-optic threads woven throughout, headpiece is a translucent, frosted glass halo, soft gradient background, diffused studio lighting, photorealistic, dreamlike futurism.",
                "\n"
            ),
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 23,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn ernie_image_generated_prompt_is_partial() {
    assert_fixture(
        "image_ernie_image",
        ExpectedMetadata {
            model: "ernie_image",
            seed: Some(182_596_410_725_960),
            steps: 20,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: "",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 22,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn ernie_image_turbo_generated_prompt_is_partial() {
    assert_fixture(
        "image_ernie_image_turbo",
        ExpectedMetadata {
            model: "ernie_image_turbo",
            seed: Some(423_299_999_918_804),
            steps: 8,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 21,
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

#[test]
fn anima_base_subgraph_control() {
    assert_fixture(
        "image_anima_base_v1",
        ExpectedMetadata {
            model: "anima_base_v1.0",
            seed: Some(875_817_230_929_465),
            steps: 30,
            cfg: 4.0,
            sampler: "er_sde (simple)",
            positive_prompt: "Anime monochrome cyberpunk front portrait, male figure, sleek skin with delicate mechanical lines, piercing glowing eyes, partial exposed metallic mecha components and light cables, sharp domineering cool style, textured anime brushwork, faint circuit background, high contrast chiaroscuro lighting, immersive cinematic shadows, ultra fine details, 8K high-def render, futuristic dystopian mood",
            negative_prompt: "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 10,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn newbie_deterministic_string_transforms() {
    let positive_prompt = include_str!(
        "fixtures/official_catalog/image_newbieimage_exp0_1-t2i.expected-positive.txt"
    )
    .strip_suffix('\n')
    .expect("NewBie expected prompt should end with one fixture newline");
    assert_eq!(positive_prompt.len(), 4_647);

    assert_fixture(
        "image_newbieimage_exp0_1-t2i",
        ExpectedMetadata {
            model: "newbie_image_exp0.1_bf16",
            seed: Some(27_582_042_565_232),
            steps: 20,
            cfg: 5.5,
            sampler: "res_multistep (simple)",
            positive_prompt,
            negative_prompt: "You are an assistant designed to generate low-quality images based on textual prompts. <Prompt Start>",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 17,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn lens_connected_sampler_custom_traversal() {
    assert_fixture(
        "image_lens_t2i",
        ExpectedMetadata {
            model: "lens_bf16",
            seed: Some(199_454_112_061_500),
            steps: 20,
            cfg: 5.0,
            sampler: "euler (simple)",
            positive_prompt: "A cluster of wild cosmos flowers swaying in gentle wind, crinkled soft petals and slender green stems, warm golden hour sunlight, natural field scenery, detailed floral texture, lifelike outdoor atmosphere",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 19,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn boogu_edit_custom_conditioning() {
    assert_fixture(
        "image_boogu_image_0_1_edit",
        ExpectedMetadata {
            model: "boogu_image_edit_fp8_scaled",
            seed: Some(22),
            steps: 25,
            cfg: 3.5,
            sampler: "dpmpp_2m (simple)",
            positive_prompt: "remove the hat",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 17,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux_depth_lora_uses_the_selected_generation_path() {
    assert_fixture(
        "flux_depth_lora_example",
        ExpectedMetadata {
            model: "flux1_dev_fp8",
            seed: Some(229_472_716_717_627),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (normal)",
            positive_prompt: "A cute ghost-shaped desktop ornament, softly glowing with a warm light, placed on a tidy, cozy home table, creating a gentle and sweet atmosphere.",
            negative_prompt: "",
            loras: &["flux1_depth_dev_lora"],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 28,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn z_image_union_model_patch_controlnet() {
    assert_fixture(
        "image_z_image_turbo_fun_union_controlnet",
        ExpectedMetadata {
            model: "z_image_turbo_bf16",
            seed: Some(729_703_840_979_498),
            steps: 8,
            cfg: 1.0,
            sampler: "res_multistep (simple)",
            positive_prompt: "Realistic photo, close-up of a latina model peeking through pine branches, dappled sunlight on her face, natural, moody, smooth skin, a little bit film grain.\n",
            negative_prompt: "",
            loras: &[],
            control_nets: &["z_image_turbo_fun_controlnet_union"],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 19,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn bernini_custom_conditioning_and_split_schedule_are_golden() {
    let name = "video_bernini_r_image_editing";
    let chunks = load_chunks(name);
    let workflow = chunks
        .get("workflow")
        .expect("catalog fixture should include workflow chunk");
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
    let expected = ExpectedMetadata {
        model: "wan2.2_bernini_r_high_noise_fp8_scaled",
        seed: Some(283_365_432_432_581),
        steps: 6,
        cfg: 1.0,
        sampler: "res_multistep (simple)",
        positive_prompt: "You are a helpful assistant.make it night",
        negative_prompt: "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走",
        loras: &["lightx2v_t2v_14b_cfg_step_distill_v2_lora_rank64_bf16"],
        control_nets: &[],
        source: ComfyParseLayer::SamplerTraversal,
        graph_node_count: 45,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    };

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
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::SamplerTraversal),
            "{name} {field:?} provenance"
        );
    }
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
fn ideogram4_scheduler_and_dual_model_policy_are_golden() {
    assert_fixture(
        "image_ideogram4_t2i",
        ExpectedMetadata {
            model: "ideogram4_fp8_scaled",
            seed: Some(885_894_517_601_261),
            steps: 20,
            cfg: 7.0,
            sampler: "euler (ideogram4)",
            positive_prompt: IDEOGRAM_EXPECTED_POSITIVE,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 42,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn longcat_text_to_image() {
    assert_fixture(
        "image_longcat_text_to_image",
        ExpectedMetadata {
            model: "longcat_image_bf16",
            seed: Some(284_089_112_874_294),
            steps: 20,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: "High-fashion portrait of a man with a shaved head and stubble, head tilted back and gazing upward. His skin and thick-knitted dark green turtleneck sweater are bathed in a monochromatic teal-green light, creating a uniform, matte finish. He wears round, thin-framed sunglasses with reflective amber-orange lenses that catch the light. The background is a solid, vibrant burnt orange, creating a bold, high-contrast color palette. The lighting is hard and directional, casting sharp shadows on his face. Hyper-detailed, photorealistic, sharp focus on facial features and fabric texture, editorial photography, 8K.",
            negative_prompt: "blurry, low resolution, oversaturated, harsh lighting, messy composition, distorted face, extra fingers, bad anatomy, cheap jewelry, plastic texture, cartoon, illustration, anime, watermark, text, logo",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 15,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn pixeldit_text_to_image() {
    assert_fixture(
        "image_pixeldit_t2i",
        ExpectedMetadata {
            model: "pixeldit_1300m_1024px_bf16",
            seed: Some(59_233_627_785_266),
            steps: 30,
            cfg: 4.0,
            sampler: "er_sde (simple)",
            positive_prompt: "A surreal architectural scene featuring a woman in a flowing white dress walking away from the viewer through a narrow canyon of smooth, organic beige rock formations. The architecture resembles fluid sandstone or sculpted clay with undulating curves and soft edges. Bright sunlight streams from above, casting sharp shadows on the ground and illuminating the textured surfaces of the walls. The sky is a clear, deep blue visible at the top of the frame. The composition uses leading lines formed by the canyon walls to draw the eye toward the figure in the distance. High-quality photorealistic rendering with 8k resolution, cinematic lighting, dramatic contrast between light and shadow, and a sense of scale emphasizing the grandeur of the environment.",
            negative_prompt: "low quality, worst quality, over-saturated, blurry, deformed, watermark",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 12,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn chrono_edit_selected_base_path() {
    assert_fixture(
        "image_chrono_edit_14B",
        ExpectedMetadata {
            model: "chrono_edit_14b_fp16",
            seed: Some(164_026_091_171_544),
            steps: 20,
            cfg: 4.0,
            sampler: "uni_pc (simple)",
            positive_prompt: "A bottle of facial cleansing foam and bubble shampoo, surrounded by white, round, foamy bubbles. The bubbles are very fluffy, crystal clear, giving a sense of fluffiness and comfort. There are also several bubbles floating in the air around, and the bottle is floating in the air. The background is light pink. The high-resolution picture creates a professional advertising style with high-definition images and high-quality details.",
            negative_prompt: "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 25,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn netayume_lumina_nested_prompt_composition() {
    assert_fixture(
        "image_netayume_lumina_t2i",
        ExpectedMetadata {
            model: "netayumev35_pretrained_all_in_one",
            seed: Some(0),
            steps: 30,
            cfg: 4.0,
            sampler: "res_multistep (simple)",
            positive_prompt: NETAYUME_EXPECTED_POSITIVE,
            negative_prompt: NETAYUME_EXPECTED_NEGATIVE,
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 18,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn longcat_image_edit() {
    assert_fixture(
        "image_longcat_image_edit",
        ExpectedMetadata {
            model: "longcat_image_edit_bf16",
            seed: Some(43),
            steps: 50,
            cfg: 4.5,
            sampler: "euler (simple)",
            positive_prompt: "Change the scene to a time when it is illuminated by the rising sun. The overall atmosphere is filled with the light of early morning. The tall snow-capped mountains in the background are lit up by the sunlight. The rays of the rising sun illuminate the front of the building as well as the distant snow-capped mountains. In the foreground of the photo, there is a person walking alone towards the building.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 18,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn capybara_image_edit() {
    assert_fixture(
        "Image_capybara_v0_1_image_edit",
        ExpectedMetadata {
            model: "capybara_v0.1",
            seed: Some(1_044_901_887_090_653),
            steps: 20,
            cfg: 6.0,
            sampler: "euler (simple)",
            positive_prompt: "Keep the characters and fluttering costumes unchanged, replace the indoor scene with an outdoor grassland setting",
            negative_prompt: "blurry, low quality, distorted, ugly, watermark, text",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 22,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn omnigen2_image_edit() {
    assert_fixture(
        "image_omnigen2_image_edit",
        ExpectedMetadata {
            model: "omnigen2_fp16",
            seed: Some(441_693_270_797_774),
            steps: 20,
            cfg: 5.0,
            sampler: "euler (simple)",
            positive_prompt: "Transform character into crystal material, transparent crystal texture, sparkling surface, prismatic light effects, magical appearance, elegant translucent look",
            negative_prompt: "deformed, blurry, over saturation, bad anatomy, disfigured, poorly drawn face, mutation, mutated, extra_limb, ugly, poorly drawn hands, fused fingers, messy drawing, broken legs censor, censored, censor_bar",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 27,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn hidream_e1_image_edit() {
    assert_fixture(
        "hidream_e1_1",
        ExpectedMetadata {
            model: "hidream_e1_1_bf16",
            seed: Some(567_500_569_211_369),
            steps: 20,
            cfg: 3.0,
            sampler: "euler (simple)",
            positive_prompt: "Change the image to let the girl’s hair fall loose around her shoulders, natural and flowing. Don’t change other parts",
            negative_prompt: "low quality, blurry, distorted",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 20,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux1_uso_reference_image_generation() {
    assert_fixture(
        "flux1_dev_uso_reference_image_gen",
        ExpectedMetadata {
            model: "flux1_dev_fp8",
            seed: Some(1_058_487_910_949_722),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "A European girl with a heartfelt smile. She is immersed in a vast, endless field of blooming flowers under a perfect summer sky.",
            negative_prompt: "",
            loras: &["uso_flux1_dit_lora_v1"],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 26,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux1_fill_onereward_preview_outputs_share_one_root() {
    assert_fixture(
        "image_flux.1_fill_dev_OneReward",
        ExpectedMetadata {
            model: "flux.1_fill_dev_onereward_transformer_fp8",
            seed: Some(75_154_916_226_486),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (normal)",
            positive_prompt: "Remove the girl's hat\n",
            negative_prompt: "",
            loras: &["removal_timestep_alpha_2_1740"],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 18,
            output_candidates: 2,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_klein_kv_image_edit() {
    assert_fixture(
        "image_flux2_klein_9b_kv_image_edit",
        ExpectedMetadata {
            model: "flux_2_klein_9b_kv_fp8",
            seed: Some(720_512_742_793_301),
            steps: 4,
            cfg: 1.0,
            sampler: "euler",
            positive_prompt: "Have the man in Figure 1 put on the clothes from Figure 2, wear a hat, and carry a bag. Then, change the background environment to an African savannah while keeping the man in the same posture to give a natural outdoor feel.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 27,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_edit_2511_inflation_lora() {
    assert_fixture(
        "image-qwen_image_edit_2511_lora_inflation",
        ExpectedMetadata {
            model: "qwen_image_edit_2511_bf16",
            seed: Some(1_123_448_499_955_428),
            steps: 40,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: "inflate the man",
            negative_prompt: "",
            loras: &["qwen_image_edit_2511_systms_infl8"],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 20,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_2512_base() {
    assert_fixture(
        "image_qwen_Image_2512",
        ExpectedMetadata {
            model: "qwen_image_2512_fp8_e4m3fn",
            seed: Some(464_857_551_335_368),
            steps: 50,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: "Urban alleyway at dusk. Tall, statuesque high-fashion model striding elegantly, mid distant full body shot from an angular perspective, cinematic/editorial with bold contrasts and tactile materials. They wear a rose-gold metallic trench coat with deconstructed elements over a black long-sleeved turtleneck with subtle texture; paired with forest-green pleated pants with raw hems and a soft texture. Long braided dark hair, medium complexion. They carry a vibrant yellow designer handbag with geometric details and a structured silhouette. White architectural sneakers with bold geometric cutouts. Bold, high-contrast, tactile, urban-grit meets high-fashion impact, extreme clarity, extreme layering, post-processing with transparent light-transmitting ultra-smooth high-definition film effect, removing all noise and grain, removing all blur, removing all vintage feel, removing all roughness, drawn with 32K pixel precision, unparalleled fine line drawing of every single detail, the entire image like a brand new photograph, photorealistic\n",
            negative_prompt: "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 21,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_2512_two_step_lora() {
    assert_fixture(
        "image_qwen_image_2512_with_2steps_lora",
        ExpectedMetadata {
            model: "qwen_image_2512_fp8_e4m3fn",
            seed: Some(318_036_859_179_089),
            steps: 2,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "High-contrast black and white fashion photography, extreme side profile of a rugged European male model with tousled wet-look hair and stubble, wearing an unbuttoned textured black leather jacket over a fitted white crewneck shirt. Low-angle composition, dramatic side lighting carving sharp, sculpted shadows across his angular jawline and neck, minimalist stark white background, edgy tough masculine aesthetic, hyper-realistic studio quality.\n",
            negative_prompt: "",
            loras: &["wuli_qwen_image_2512_turbo_lora_2steps_v1.0_bf16"],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 13,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn hidream_i1_dev_variant() {
    assert_fixture(
        "hidream_i1_dev",
        ExpectedMetadata {
            model: "hidream_i1_dev_fp8",
            seed: Some(426_270_906_276_990),
            steps: 28,
            cfg: 1.0,
            sampler: "lcm (normal)",
            positive_prompt: "A photograph of an albino woman with white skin and dark hair wearing black in the style of old baroque oil paintings, with soft focus, wearing a pearl necklace around her neck, with a dark background, with rosy cheeks, with a long veil covering her face, looking straight ahead",
            negative_prompt: "bad ugly jpeg artifacts",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 12,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn hidream_i1_fast_variant() {
    assert_fixture(
        "hidream_i1_fast",
        ExpectedMetadata {
            model: "hidream_i1_fast_fp8",
            seed: Some(833_271_177_511_441),
            steps: 16,
            cfg: 1.0,
            sampler: "lcm (normal)",
            positive_prompt: "A lo-fi, grungy wide shot of a ragged large red tree leaning slightly to one side Polaroid aesthetic. the tree is alone in a desolate landscape, the tree is illuminated by a red light, the background is pitch black",
            negative_prompt: "bad ugly jpeg artifacts",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 12,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn krea2_int8_generated_prompt_remains_partial() {
    assert_fixture(
        "image_krea2_turbo_t2i_int8",
        ExpectedMetadata {
            model: "krea2_turbo_int8_convrot",
            seed: Some(45_862_206_397_178),
            steps: 8,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 25,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux_dev_checkpoint_subgraph_variant() {
    assert_fixture(
        "flux_dev_checkpoint_example",
        ExpectedMetadata {
            model: "flux1_dev",
            seed: Some(53_943_644_181_156),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: concat!(
                "Beautiful photography of a gorgeous-haired female artist, natural and authentic, her hair styled in a messy casual bun, smiling joyfully and looking directly at the camera, cinematic lighting, soft natural daylight, shallow depth of field, warm gentle tones, film grain, high detail, 8K, realistic portrait",
                "\n"
            ),
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 10,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn boogu_turbo_text_to_image_variant() {
    assert_fixture(
        "image_boogu_image_0_1_turbo_t2i",
        ExpectedMetadata {
            model: "boogu_image_turbo_fp8_scaled",
            seed: Some(896_977_722_960_984),
            steps: 4,
            cfg: 1.0,
            sampler: "lcm (sgm_uniform)",
            positive_prompt: "Abstract close-up portrait of a young man wearing a cream turtleneck, captured with severe horizontal motion blur and double exposure effect that distorts his facial features, rendered in an analog film grain style with muted earthy background tones, framed tightly on his face to emphasize the blur streaks across his eyes, nose, and lips while retaining the texture of the knit collar and soft ambient lighting.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 11,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn chroma_direct_custom_sampler_variant() {
    assert_fixture(
        "image_chroma_text_to_image",
        ExpectedMetadata {
            model: "chroma1_hd_fp8mixed",
            seed: Some(68_346_347_456_896),
            steps: 26,
            cfg: 3.5,
            sampler: "euler (beta)",
            positive_prompt: "This is a nature documentary close-up photograph of the right side of the face of a tiger. The photograph is centered on it's highly detailed and speckled eye surrounded by intricately detailed fur. Overlaid at the center of the image is a title text that says \"CHROMA1-HD\" in a large white 3D letters. Amateur photography. Unfiltered. Real life. Natural light. Subtle shadows. ",
            negative_prompt: "This low quality greyscale unfinished sketch is inaccurate and flawed. The image is very blurred and lacks detail with excessive chromatic aberrations and artifacts. The image is overly saturated with excessive bloom. It has a toony aesthetic with bold outlines and flat colors. ",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 18,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_base_switches_keep_turbo_resources_disabled() {
    assert_fixture(
        "image_qwen_image",
        ExpectedMetadata {
            model: "qwen_image_fp8_e4m3fn",
            seed: Some(50_347_169_638_278),
            steps: 20,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: QWEN_IMAGE_EXPECTED_POSITIVE,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 23,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn z_image_turbo_subgraph_variant() {
    assert_fixture(
        "image_z_image_turbo",
        ExpectedMetadata {
            model: "z_image_turbo_bf16",
            seed: Some(0),
            steps: 8,
            cfg: 1.0,
            sampler: "res_multistep (simple)",
            positive_prompt: "Latina female with thick wavy hair, harbor boats and pastel houses behind. Breezy seaside light, warm tones, cinematic close-up. ",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 11,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux_dev_full_subgraph_variant() {
    assert_fixture(
        "flux_dev_full_text_to_image",
        ExpectedMetadata {
            model: "flux1_dev",
            seed: Some(0),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "A fairy tale scene of a young girl with silver curly hair wearing a delicate white dress, standing among crystal butterflies and glowing glass roses. The scene is filled with soft magical light, like a dream from a fantasy world.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 10,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux_krea_dev_subgraph_variant() {
    assert_fixture(
        "flux1_krea_dev",
        ExpectedMetadata {
            model: "flux1_krea_dev_fp8_scaled",
            seed: Some(0),
            steps: 20,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: concat!(
                "Highly realistic portrait of a Nordic woman with blonde hair and blue eyes, gaze sharp and intellectual. The lighting should reflect the unique coolness of Northern Europe. Outfit is minimalist and modern, background is blurred in cool tones. Needs to perfectly capture the characteristics of a Scandinavian woman. solo, Centered composition",
                "\n"
            ),
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 10,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_edit_base_mode_omits_lightning_lora() {
    assert_fixture(
        "image_qwen_image_edit",
        ExpectedMetadata {
            model: "qwen_image_edit_fp8_e4m3fn",
            seed: Some(344_147_753_686_358),
            steps: 20,
            cfg: 2.5,
            sampler: "euler (simple)",
            positive_prompt: "Remove all UI text elements from the image. Keep the feeling that the characters and scene are in water. Also, remove the green UI elements at the bottom.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 25,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn z_image_base_subgraph_variant() {
    assert_fixture(
        "image_z_image",
        ExpectedMetadata {
            model: "z_image_bf16",
            seed: Some(770_044_821_593_082),
            steps: 25,
            cfg: 4.0,
            sampler: "res_multistep (simple)",
            positive_prompt: Z_IMAGE_EXPECTED_POSITIVE,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 14,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn z_image_turbo_int8_subgraph_variant() {
    assert_fixture(
        "image_z_image_turbo_int8",
        ExpectedMetadata {
            model: "z_image_turbo_int8_convrot",
            seed: Some(121_725_701_057_393),
            steps: 8,
            cfg: 1.0,
            sampler: "res_multistep (simple)",
            positive_prompt: "Dramatic black and white high fashion studio portrait, close-up bust shot, pale platinum blonde woman with sleek low ponytail, head tilted upward, eyes softly closed, wearing a fitted black turtleneck top. A large translucent pale white butterfly hovers gently right at her lips, delicate detailed wing veins visible. Hard rim light creates glowing bright white halo around her hair and face, deep inky pure black minimalist background, stark high contrast chiaroscuro lighting, film grain texture, moody ethereal atmosphere, monochrome, editorial fashion photography, shot on 35mm film, soft subtle skin texture, sharp focus on butterfly and facial profile, vertical composition, minimalist dark aesthetic, artistic surreal fashion",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 11,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_image_edit_keeps_turbo_mode_disabled() {
    assert_fixture(
        "image_flux2",
        ExpectedMetadata {
            model: "flux2_dev_fp8mixed",
            seed: Some(342_971_778_941_390),
            steps: 20,
            cfg: 4.0,
            sampler: "euler",
            positive_prompt: "The woman is wearing a small pale yellow knitted beanie, with a white fabric patch on the front right, embroidered with big gray text “FLUX.2 COMFY.” Keep the face",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 25,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_fp8_image_edit_keeps_turbo_mode_disabled() {
    assert_fixture(
        "image_flux2_fp8",
        ExpectedMetadata {
            model: "flux2_dev_fp8mixed",
            seed: Some(315_616_751_694_460),
            steps: 20,
            cfg: 4.0,
            sampler: "euler",
            positive_prompt:
                "Apply the design from Reference Image 1 onto objects in Reference Image 2.\n",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 29,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_klein_4b_base_ignores_bypassed_alternative() {
    assert_fixture(
        "image_flux2_klein_image_edit_4b_base",
        ExpectedMetadata {
            model: "flux_2_klein_base_4b_fp8",
            seed: Some(1_111_443_136_920_027),
            steps: 20,
            cfg: 5.0,
            sampler: "euler",
            positive_prompt: "Change the background to a cozy, softly lit interior space with warm beige tones, soft natural window light filtering through, and a relaxed, intimate atmosphere similar to the original image's mood. Keep the person in the exact same position, scale, and pose. Maintain identical camera angle, framing, and perspective. The lighting should be soft, even, and warm - not harsh or bright. Only replace the room environment, preserving all facial features, hairstyle, expression, clothing, and pose exactly as they are.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 24,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_klein_9b_base_ignores_bypassed_alternative() {
    assert_fixture(
        "image_flux2_klein_image_edit_9b_base",
        ExpectedMetadata {
            model: "flux_2_klein_base_9b_fp8",
            seed: Some(192_774_551_144_773),
            steps: 20,
            cfg: 5.0,
            sampler: "euler",
            positive_prompt: "Change the camera angle to a first-person driver's perspective looking through the steering wheel at the dashboard and windshield, maintaining the same white minimalist interior style and lighting\n",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 24,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_klein_9b_distilled_ignores_bypassed_alternative() {
    assert_fixture(
        "image_flux2_klein_image_edit_9b_distilled",
        ExpectedMetadata {
            model: "flux_2_klein_9b_fp8",
            seed: Some(26_416_064_315_367),
            steps: 4,
            cfg: 1.0,
            sampler: "euler",
            positive_prompt: "Replace the background with a quiet coastal cliff at overcast sunset. Remove all buildings and streets. Add wind-shaped grass and a distant ocean horizon. Keep the subject’s pose and framing unchanged.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 24,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_klein_4b_base_text_to_image_ignores_distilled_branch() {
    assert_fixture(
        "image_flux2_klein_text_to_image",
        ExpectedMetadata {
            model: "flux_2_klein_base_4b",
            seed: Some(0),
            steps: 20,
            cfg: 5.0,
            sampler: "euler",
            positive_prompt: "A hedgehog wearing a tiny party hat surrounded by confetti, early digital camera style, slight noise, flash photography, candid moment, 2000s digicam aesthetic, festive birthday celebration atmosphere\n",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 19,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux2_klein_9b_base_text_to_image() {
    assert_fixture(
        "image_flux2_text_to_image_9b",
        ExpectedMetadata {
            model: "flux_2_klein_base_9b_fp8",
            seed: Some(145_965_955_694_731),
            steps: 20,
            cfg: 5.0,
            sampler: "euler",
            positive_prompt: "A vintage motorcycle parked in front of a retro diner at sunset, warm orange and pink sky, neon signs glowing, 80s vintage photo style, film grain, warm color cast",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 17,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn flux_schnell_dual_encoder_is_golden() {
    assert_fixture(
        "flux_schnell_full_text_to_image",
        ExpectedMetadata {
            model: "flux1_schnell",
            seed: Some(167_447_334_682_596),
            steps: 4,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "Cute retro mini car, pastel - colored 3D flowers overflowing from it, soft green background, minimalist and fresh style, high - precision rendering, spring - like vibrant atmosphere, delicate petal details, gentle color grading, whimsical and lovely scene\n\nCreate a 3D - styled image: A cute, retro - looking mini car with soft, pastel - colored flowers (like daisies, pink blooms) overflowing from it. Set against a gentle green background, giving a fresh, spring - vibe. Make it look whimsical and delicate, like a sweet illustration.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 10,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn hidream_e1_full_is_golden() {
    assert_fixture(
        "hidream_e1_full",
        ExpectedMetadata {
            model: "hidream_e1_full_bf16",
            seed: Some(705_826_023_365_990),
            steps: 28,
            cfg: 5.0,
            sampler: "euler (normal)",
            positive_prompt: "Let the girl put on the VR glasses full of a sense of technology, just like the scenes in Ready Player One, with CG rendering and ultra-realism.",
            negative_prompt: "low quality, blurry, distorted",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 18,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn hidream_o1_generated_prompt_is_partial() {
    assert_fixture(
        "image_hidream_o1",
        ExpectedMetadata {
            model: "hidream_o1_image_bf16",
            seed: Some(493_576_922_569_549),
            steps: 40,
            cfg: 5.0,
            sampler: "dpmpp_2m_sde_gpu (normal)",
            positive_prompt: "",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 41,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn hidream_o1_dev_generated_prompt_is_partial() {
    assert_fixture(
        "image_hidream_o1_dev",
        ExpectedMetadata {
            model: "hidream_o1_image_dev_fp8_scaled",
            seed: Some(270_186_383_729_385),
            steps: 28,
            cfg: 1.0,
            sampler: "lcm (normal)",
            positive_prompt: "",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 40,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_edit_2511_is_golden() {
    assert_fixture(
        "image_qwen_image_edit_2511",
        ExpectedMetadata {
            model: "qwen_image_edit_2511_bf16",
            seed: Some(0),
            steps: 40,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt:
                "Change the furniture leather difference in image 1 to the fur material in image 2.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 29,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn krea2_turbo_int8_style_reference_uses_the_selected_branch() {
    assert_fixture(
        "image_krea2_turbo_int8_image_style_reference",
        ExpectedMetadata {
            model: "krea2_turbo_int8_convrot",
            seed: Some(355_028_178_891_957),
            steps: 8,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "a white yeti with horns reading a book that is titled \"Ostris + Krea2 Style Reference\"",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 28,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn qwen_image_edit_2511_int8_omits_the_disabled_lightning_lora() {
    assert_fixture(
        "image_qwen_image_edit_2511_int8",
        ExpectedMetadata {
            model: "qwen_image_edit_2511_int8_convrot",
            seed: Some(1_119_496_583_977_398),
            steps: 40,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt: "Convert this image to pop art poster style",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 27,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn ideogram4_int8_uses_the_primary_model_and_exact_json_prompt() {
    let positive_prompt = IDEOGRAM_INT8_EXPECTED_POSITIVE
        .strip_suffix('\n')
        .expect("Ideogram INT8 expected prompt should end with one fixture newline");
    assert_eq!(positive_prompt.len(), 2_215);

    assert_fixture(
        "image_ideogram4_t2i_int8",
        ExpectedMetadata {
            model: "ideogram4_int8_convrot",
            seed: Some(71_584_314_815_009),
            steps: 20,
            cfg: 7.0,
            sampler: "euler (ideogram4)",
            positive_prompt,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 46,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn boogu_image_edit_int8_is_golden() {
    assert_fixture(
        "image_boogu_image_0_1_edit_int8",
        ExpectedMetadata {
            model: "boogu_image_edit_int8_convrot",
            seed: Some(22),
            steps: 25,
            cfg: 3.5,
            sampler: "dpmpp_2m (simple)",
            positive_prompt: "Keep the character unchanged, replace the desert background and scene. The model is on the dune.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 18,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn z_image_int8_preserves_the_exact_literal_prompt() {
    let positive_prompt = Z_IMAGE_INT8_EXPECTED_POSITIVE
        .strip_suffix('\n')
        .expect("Z-Image INT8 expected prompt should end with one fixture newline");
    assert_eq!(positive_prompt.len(), 633);

    assert_fixture(
        "image_z_image_int8",
        ExpectedMetadata {
            model: "z_image_int8_convrot",
            seed: Some(677_498_465_340_151),
            steps: 25,
            cfg: 4.0,
            sampler: "res_multistep (simple)",
            positive_prompt,
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 14,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn joyai_image_edit_int8_is_golden() {
    assert_fixture(
        "image_joyai_image_edit",
        ExpectedMetadata {
            model: "joyai_image_edit_int8_convrot",
            seed: Some(42),
            steps: 40,
            cfg: 4.0,
            sampler: "euler (normal)",
            positive_prompt: "Change the background to a glacial scene.",
            negative_prompt: "",
            loras: &[],
            control_nets: &[],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 15,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn anima_lllite_any_control_is_golden() {
    let positive_prompt = ANIMA_LLLITE_ANY_EXPECTED_POSITIVE
        .strip_suffix('\n')
        .expect("Anima LLLite any-control prompt should end with one fixture newline");

    assert_fixture(
        "image_anima_lllite_any_control_to_image",
        ExpectedMetadata {
            model: "anima_base_v1.0",
            seed: Some(1_986_030_987_480),
            steps: 30,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt,
            negative_prompt:
                "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia",
            loras: &[],
            control_nets: &["anima_lllite_any_test_like_v2"],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 29,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn anima_lllite_inpainting_is_golden() {
    assert_fixture(
        "image_anima_lllite_image_inpainting",
        ExpectedMetadata {
            model: "anima_base_v1.0",
            seed: Some(1_376_514_088_921),
            steps: 8,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: "girl with red eyes",
            negative_prompt:
                "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia",
            loras: &["anima_turbo_lora_v0.2"],
            control_nets: &["anima_lllite_inpainting_v2"],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 28,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}

#[test]
fn anima_lllite_depth_control_is_golden() {
    let positive_prompt = ANIMA_LLLITE_DEPTH_EXPECTED_POSITIVE
        .strip_suffix('\n')
        .expect("Anima LLLite depth prompt should end with one fixture newline");

    assert_fixture(
        "image_anima_lllite_depth_control_to_image",
        ExpectedMetadata {
            model: "anima_base_v1.0",
            seed: Some(520_254_185_749_746),
            steps: 30,
            cfg: 4.0,
            sampler: "euler (simple)",
            positive_prompt,
            negative_prompt:
                "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia",
            loras: &[],
            control_nets: &["anima_lllite_depth_1"],
            source: ComfyParseLayer::SamplerTraversal,
            graph_node_count: 29,
            output_candidates: 1,
            output_roots: 1,
            output_ambiguous: false,
        },
    );
}
