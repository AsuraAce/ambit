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
fn bernini_custom_conditioning_is_partial_without_fabricated_fields() {
    let name = "video_bernini_r_image_editing";
    let chunks = load_chunks(name);
    let workflow = chunks
        .get("workflow")
        .expect("catalog fixture should include workflow chunk");
    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
    let expected = ExpectedMetadata {
        model: "wan2.2_bernini_r_high_noise_fp8_scaled",
        seed: Some(283_365_432_432_581),
        steps: 0,
        cfg: 1.0,
        sampler: "res_multistep",
        positive_prompt: "",
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
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::NegativePrompt,
        ComfyMetadataField::Loras,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            Some(&ComfyParseLayer::SamplerTraversal),
            "{name} {field:?} provenance"
        );
    }
    for field in [
        ComfyMetadataField::Steps,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_eq!(
            diagnostics.field_sources.get(&field),
            None,
            "{name} {field:?} should remain unavailable"
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
