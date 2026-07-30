use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use std::collections::HashMap;

struct IntakeFixture {
    name: &'static str,
    source_blob: &'static str,
    chunks_json: &'static str,
    graph_node_count: usize,
    output_candidates: usize,
    output_roots: usize,
    output_ambiguous: bool,
}

const FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_anima_base_v1",
        source_blob: "f572962bfa4aaecd0ee7721df58b03d684c11c9d",
        chunks_json: include_str!("fixtures/official_catalog/image_anima_base_v1.chunks.json"),
        graph_node_count: 20,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_newbieimage_exp0_1-t2i",
        source_blob: "04bd4bae0d85c4860b65e603f3b5020391123210",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_newbieimage_exp0_1-t2i.chunks.json"
        ),
        graph_node_count: 17,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_lens_t2i",
        source_blob: "e12d2d791d212cc8aed8ee00d9999d25206a866b",
        chunks_json: include_str!("fixtures/official_catalog/image_lens_t2i.chunks.json"),
        graph_node_count: 19,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_boogu_image_0_1_edit",
        source_blob: "c452dc0e1c831de8ea738b4e11a59dc7525d8238",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_edit.chunks.json"
        ),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "video_bernini_r_image_editing",
        source_blob: "ca3d1c2a1981faa2322ae98ee0bfa85995b379c2",
        chunks_json: include_str!(
            "fixtures/official_catalog/video_bernini_r_image_editing.chunks.json"
        ),
        graph_node_count: 45,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const RELATED_VARIANTS: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_anima_preview",
        source_blob: "f0bf84c0e8e9c0b2dc4634371626d8ae288fb289",
        chunks_json: include_str!("fixtures/official_catalog/image_anima_preview.chunks.json"),
        graph_node_count: 10,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_lens_turbo_t2i",
        source_blob: "604a4ba02cd10dc7d00703cf1975151ee6787c45",
        chunks_json: include_str!("fixtures/official_catalog/image_lens_turbo_t2i.chunks.json"),
        graph_node_count: 20,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const PHASE23_RESOURCE_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "flux_depth_lora_example",
        source_blob: "2044353656ee2f44c49fae2547bb75d1590523d4",
        chunks_json: include_str!("fixtures/official_catalog/flux_depth_lora_example.chunks.json"),
        graph_node_count: 28,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_z_image_turbo_fun_union_controlnet",
        source_blob: "c01186242bc8e7a918c275c904be231bc8018504",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_z_image_turbo_fun_union_controlnet.chunks.json"
        ),
        graph_node_count: 19,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE25_IDEOGRAM_FIXTURES: &[IntakeFixture] = &[IntakeFixture {
    name: "image_ideogram4_t2i",
    source_blob: "9c016c249246439ccc08ccffbab31d04e54673cb",
    chunks_json: include_str!("fixtures/official_catalog/image_ideogram4_t2i.chunks.json"),
    graph_node_count: 42,
    output_candidates: 1,
    output_roots: 1,
    output_ambiguous: false,
}];

const MILESTONE26_NEW_FAMILY_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_longcat_text_to_image",
        source_blob: "68749b8b2f45c580fd2f019d49ae2313fc655b14",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_longcat_text_to_image.chunks.json"
        ),
        graph_node_count: 15,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_pixeldit_t2i",
        source_blob: "61d7236d058ddbcf921b544ffdfcf6afe7108cda",
        chunks_json: include_str!("fixtures/official_catalog/image_pixeldit_t2i.chunks.json"),
        graph_node_count: 12,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_chrono_edit_14B",
        source_blob: "e354fb1ab91240f81458da367216b3ccd544fa03",
        chunks_json: include_str!("fixtures/official_catalog/image_chrono_edit_14B.chunks.json"),
        graph_node_count: 25,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_netayume_lumina_t2i",
        source_blob: "8d7426f8ca3ada611df2b785ff1cac952a06aa1b",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_netayume_lumina_t2i.chunks.json"
        ),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE27_IMAGE_EDIT_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_longcat_image_edit",
        source_blob: "e15d90ae587724f429a6c223194f1b21404922a6",
        chunks_json: include_str!("fixtures/official_catalog/image_longcat_image_edit.chunks.json"),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "Image_capybara_v0_1_image_edit",
        source_blob: "7c47ad4cd0ed3613c4a0ed04c669c485a2b82b21",
        chunks_json: include_str!(
            "fixtures/official_catalog/Image_capybara_v0_1_image_edit.chunks.json"
        ),
        graph_node_count: 22,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_omnigen2_image_edit",
        source_blob: "c14f55f4797cf66a0980a5dedf51919f91865942",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_omnigen2_image_edit.chunks.json"
        ),
        graph_node_count: 27,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "hidream_e1_1",
        source_blob: "b43bcca048e888b5f7f9d1b713a3465052924736",
        chunks_json: include_str!("fixtures/official_catalog/hidream_e1_1.chunks.json"),
        graph_node_count: 20,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE28_REFERENCE_MODIFIER_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "flux1_dev_uso_reference_image_gen",
        source_blob: "f03156d29ad4afb6c1f81f552076c793404f62ed",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux1_dev_uso_reference_image_gen.chunks.json"
        ),
        graph_node_count: 26,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux.1_fill_dev_OneReward",
        source_blob: "ae89238cf5e0bebca38ca224c75645c89800fd5d",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux.1_fill_dev_OneReward.chunks.json"
        ),
        graph_node_count: 18,
        output_candidates: 2,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux2_klein_9b_kv_image_edit",
        source_blob: "5a67a1cce4b06a69f97c20eaa56a800f9cf2cd18",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_9b_kv_image_edit.chunks.json"
        ),
        graph_node_count: 27,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE29_CORE_VARIANT_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "hidream_i1_dev",
        source_blob: "7ae5db47050e8c47124525d7fc37f9ddb43e6a7f",
        chunks_json: include_str!("fixtures/official_catalog/hidream_i1_dev.chunks.json"),
        graph_node_count: 12,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "hidream_i1_fast",
        source_blob: "60a6efb63511ac851359451dbd8641c4d71cccd9",
        chunks_json: include_str!("fixtures/official_catalog/hidream_i1_fast.chunks.json"),
        graph_node_count: 12,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_krea2_turbo_t2i_int8",
        source_blob: "a4fb56cfcf541204aa87cc02462fd78ce3090eb8",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_krea2_turbo_t2i_int8.chunks.json"
        ),
        graph_node_count: 25,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE30_BASELINE_VARIANT_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "flux_dev_checkpoint_example",
        source_blob: "c59a204c9ad1c454cdbb2b416f97a3bd8fba0082",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux_dev_checkpoint_example.chunks.json"
        ),
        graph_node_count: 10,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_boogu_image_0_1_turbo_t2i",
        source_blob: "0386a9fccd5075d20de37c972bb29fcaeea95f8a",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_turbo_t2i.chunks.json"
        ),
        graph_node_count: 11,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_chroma_text_to_image",
        source_blob: "1b9525f95e3b80c3e6b07835bd869854aba1d182",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_chroma_text_to_image.chunks.json"
        ),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_qwen_image",
        source_blob: "2a8e9aee5c43a30e95274b2a59dbbc10a218a083",
        chunks_json: include_str!("fixtures/official_catalog/image_qwen_image.chunks.json"),
        graph_node_count: 23,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_z_image_turbo",
        source_blob: "4a98c03bf882a1d4d3a9ebd70ba280f08bc14dde",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image_turbo.chunks.json"),
        graph_node_count: 11,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE31_BASELINE_EDIT_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "flux_dev_full_text_to_image",
        source_blob: "cfbee2b5bcc18720521cd895ab939c5b8ba76723",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux_dev_full_text_to_image.chunks.json"
        ),
        graph_node_count: 10,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "flux1_krea_dev",
        source_blob: "017543a6a0fcf55faa5391a0a2ee34df2aeb845b",
        chunks_json: include_str!("fixtures/official_catalog/flux1_krea_dev.chunks.json"),
        graph_node_count: 10,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_qwen_image_edit",
        source_blob: "8da6b49269c84e01c75a3664090dabd7996d0041",
        chunks_json: include_str!("fixtures/official_catalog/image_qwen_image_edit.chunks.json"),
        graph_node_count: 25,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_z_image",
        source_blob: "97cfc42585f59bbe43139e2fea4c5a6530240592",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image.chunks.json"),
        graph_node_count: 14,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_z_image_turbo_int8",
        source_blob: "61bb66e258200a92db5626bb519d317e047807f4",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image_turbo_int8.chunks.json"),
        graph_node_count: 11,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE32_FLUX2_VARIANT_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_flux2_fp8",
        source_blob: "f7782e43ffb3a61798c8bc4b6e2b046c6e568b3c",
        chunks_json: include_str!("fixtures/official_catalog/image_flux2_fp8.chunks.json"),
        graph_node_count: 29,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux2_klein_text_to_image",
        source_blob: "951d58ac7945845aa6d0d4bb7544d26fdc96c22c",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_text_to_image.chunks.json"
        ),
        graph_node_count: 19,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE33_TARGET_CLOSURE_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "flux_schnell_full_text_to_image",
        source_blob: "99099e105eb26ec695c53590e5dff7606c8e3b1a",
        chunks_json: include_str!(
            "fixtures/official_catalog/flux_schnell_full_text_to_image.chunks.json"
        ),
        graph_node_count: 10,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "hidream_e1_full",
        source_blob: "057d62066a57cfa9639e81912c348743d8c6fcd9",
        chunks_json: include_str!("fixtures/official_catalog/hidream_e1_full.chunks.json"),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_hidream_o1",
        source_blob: "3f64d3feb9b39c301be81e5e5d7ddc7d7f267042",
        chunks_json: include_str!("fixtures/official_catalog/image_hidream_o1.chunks.json"),
        graph_node_count: 41,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_hidream_o1_dev",
        source_blob: "cdd77698d6cb5dafb6e43c3fbb2e12375809a9dc",
        chunks_json: include_str!("fixtures/official_catalog/image_hidream_o1_dev.chunks.json"),
        graph_node_count: 40,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE34_CATALOG_REFRESH_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_krea2_turbo_int8_image_style_reference",
        source_blob: "9b56eb3fef84084b0fc94d7cb76242fa144fa4ae",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_krea2_turbo_int8_image_style_reference.chunks.json"
        ),
        graph_node_count: 28,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_qwen_image_edit_2511_int8",
        source_blob: "251ffb5115cf8e6ab27b2ebc1038423737f22e72",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_edit_2511_int8.chunks.json"
        ),
        graph_node_count: 27,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_ideogram4_t2i_int8",
        source_blob: "4e9a71db38bc0c6e09aafba658adb5b06d10c8fa",
        chunks_json: include_str!("fixtures/official_catalog/image_ideogram4_t2i_int8.chunks.json"),
        graph_node_count: 46,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_anima_lllite_any_control_to_image",
        source_blob: "ef59950bec26fc85e8ad7e2f6cdd2718b830bcc0",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_anima_lllite_any_control_to_image.chunks.json"
        ),
        graph_node_count: 29,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_anima_lllite_image_inpainting",
        source_blob: "0fef38f42235bf9a6133f502a3f9611a8a4fdd3e",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_anima_lllite_image_inpainting.chunks.json"
        ),
        graph_node_count: 28,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_anima_lllite_depth_control_to_image",
        source_blob: "a05af628646ad83c3378fcf5acfa4330dd3647c4",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_anima_lllite_depth_control_to_image.chunks.json"
        ),
        graph_node_count: 29,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_boogu_image_0_1_edit_int8",
        source_blob: "1d9cd1a0f28c76c74ad972c6ffd823aef11e84ea",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_edit_int8.chunks.json"
        ),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_z_image_int8",
        source_blob: "2dd3f57d9d01e83b10caa16cddba37d356d50e23",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image_int8.chunks.json"),
        graph_node_count: 14,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_joyai_image_edit",
        source_blob: "3d92ffa74ffffa81de5654134fd8afbeb1611e56",
        chunks_json: include_str!("fixtures/official_catalog/image_joyai_image_edit.chunks.json"),
        graph_node_count: 15,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE37_REVALIDATED_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "Image_capybara_v0_1_text_to_image",
        source_blob: "adffcf2fac68599ca2495f0b60557d03327c8d49",
        chunks_json: include_str!(
            "fixtures/official_catalog/Image_capybara_v0_1_text_to_image.chunks.json"
        ),
        graph_node_count: 17,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "Image_capybara_v0_1_image_edit",
        source_blob: "7c47ad4cd0ed3613c4a0ed04c669c485a2b82b21",
        chunks_json: include_str!(
            "fixtures/official_catalog/Image_capybara_v0_1_image_edit.chunks.json"
        ),
        graph_node_count: 22,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_boogu_image_0_1_edit",
        source_blob: "c452dc0e1c831de8ea738b4e11a59dc7525d8238",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_edit.chunks.json"
        ),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_boogu_image_0_1_turbo_t2i",
        source_blob: "0386a9fccd5075d20de37c972bb29fcaeea95f8a",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_turbo_t2i.chunks.json"
        ),
        graph_node_count: 11,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_lens_t2i",
        source_blob: "e12d2d791d212cc8aed8ee00d9999d25206a866b",
        chunks_json: include_str!("fixtures/official_catalog/image_lens_t2i.chunks.json"),
        graph_node_count: 19,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_lens_turbo_t2i",
        source_blob: "604a4ba02cd10dc7d00703cf1975151ee6787c45",
        chunks_json: include_str!("fixtures/official_catalog/image_lens_turbo_t2i.chunks.json"),
        graph_node_count: 20,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE39_REVALIDATED_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_flux2",
        source_blob: "9a287d49f685916349fff6bae6bc685f322f23ef",
        chunks_json: include_str!("fixtures/official_catalog/image_flux2.chunks.json"),
        graph_node_count: 25,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux2_klein_image_edit_4b_base",
        source_blob: "39e7de94ac24e08dc153248f36dc91cbc9bc26a1",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_image_edit_4b_base.chunks.json"
        ),
        graph_node_count: 24,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux2_klein_image_edit_9b_base",
        source_blob: "af8f73e22d92467d11ac8ed609b8ada906b9bfdf",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_image_edit_9b_base.chunks.json"
        ),
        graph_node_count: 24,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux2_klein_image_edit_9b_distilled",
        source_blob: "0b2a11b1f2f8218897fcfe91d48f786a00b7ef93",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_klein_image_edit_9b_distilled.chunks.json"
        ),
        graph_node_count: 24,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux2_text_to_image",
        source_blob: "bb7d4e5be6f379834e7c6ee563dd58687fc78dad",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_text_to_image.chunks.json"
        ),
        graph_node_count: 20,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_flux2_text_to_image_9b",
        source_blob: "cc97272e7f37e2102eb8157416f39adaf63fc838",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_flux2_text_to_image_9b.chunks.json"
        ),
        graph_node_count: 17,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE40_REVALIDATED_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_qwen_Image_2512",
        source_blob: "4e46879b51bd266d513fdb5429bb9b52448e0bb1",
        chunks_json: include_str!("fixtures/official_catalog/image_qwen_Image_2512.chunks.json"),
        graph_node_count: 21,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_qwen_Image_2512_controlnet",
        source_blob: "689d1a76fc42f37db926af1055860617a08bebf4",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_Image_2512_controlnet.chunks.json"
        ),
        graph_node_count: 30,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_qwen_image_2512_with_2steps_lora",
        source_blob: "c4214781ab66852199b88bbfe98e5f564004b4fa",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_2512_with_2steps_lora.chunks.json"
        ),
        graph_node_count: 13,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image-qwen_image_edit_2511_lora_inflation",
        source_blob: "4cb616f9532b188bf15134808ff6e29c8bc8ace9",
        chunks_json: include_str!(
            "fixtures/official_catalog/image-qwen_image_edit_2511_lora_inflation.chunks.json"
        ),
        graph_node_count: 20,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE41_REVALIDATED_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_qwen_image_edit_2509",
        source_blob: "522c66b253bc74333b8791e02296407a510c2295",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_edit_2509.chunks.json"
        ),
        graph_node_count: 24,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_qwen_image_edit_2511",
        source_blob: "f439d8f10c247ae856d1aa4c4e7e37e55c6d2f94",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_qwen_image_edit_2511.chunks.json"
        ),
        graph_node_count: 28,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE42_REVALIDATED_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "gsl_creator_2",
        source_blob: "f7f46f0e04d0c2c3d58ad4b094525dce898d4ca0",
        chunks_json: include_str!("fixtures/official_catalog/gsl_creator_2.chunks.json"),
        graph_node_count: 26,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "gsl_starter_1_1",
        source_blob: "68e7933294af216c41c1218f5e6303f80f81ccd4",
        chunks_json: include_str!("fixtures/official_catalog/gsl_starter_1_1.chunks.json"),
        graph_node_count: 15,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE43_REVALIDATED_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_ernie_image",
        source_blob: "4b841c64cd1742dced75614e4b51747ee13adcaf",
        chunks_json: include_str!("fixtures/official_catalog/image_ernie_image.chunks.json"),
        graph_node_count: 22,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_firered_image_edit1_1",
        source_blob: "19e4e5ea3489a781be917056dd33d07942bd7e09",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_firered_image_edit1_1.chunks.json"
        ),
        graph_node_count: 23,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_hidream_o1",
        source_blob: "3f64d3feb9b39c301be81e5e5d7ddc7d7f267042",
        chunks_json: include_str!("fixtures/official_catalog/image_hidream_o1.chunks.json"),
        graph_node_count: 41,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_hidream_o1_dev",
        source_blob: "cdd77698d6cb5dafb6e43c3fbb2e12375809a9dc",
        chunks_json: include_str!("fixtures/official_catalog/image_hidream_o1_dev.chunks.json"),
        graph_node_count: 40,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_ideogram4_t2i",
        source_blob: "9c016c249246439ccc08ccffbab31d04e54673cb",
        chunks_json: include_str!("fixtures/official_catalog/image_ideogram4_t2i.chunks.json"),
        graph_node_count: 42,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_longcat_image_edit",
        source_blob: "e15d90ae587724f429a6c223194f1b21404922a6",
        chunks_json: include_str!("fixtures/official_catalog/image_longcat_image_edit.chunks.json"),
        graph_node_count: 18,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_longcat_text_to_image",
        source_blob: "68749b8b2f45c580fd2f019d49ae2313fc655b14",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_longcat_text_to_image.chunks.json"
        ),
        graph_node_count: 15,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_pixeldit_t2i",
        source_blob: "61d7236d058ddbcf921b544ffdfcf6afe7108cda",
        chunks_json: include_str!("fixtures/official_catalog/image_pixeldit_t2i.chunks.json"),
        graph_node_count: 12,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_z_image_turbo_int8",
        source_blob: "61bb66e258200a92db5626bb519d317e047807f4",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image_turbo_int8.chunks.json"),
        graph_node_count: 11,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "video_bernini_r_image_editing",
        source_blob: "ca3d1c2a1981faa2322ae98ee0bfa85995b379c2",
        chunks_json: include_str!(
            "fixtures/official_catalog/video_bernini_r_image_editing.chunks.json"
        ),
        graph_node_count: 45,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const MILESTONE44_REVALIDATED_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_ernie_image_turbo",
        source_blob: "07b3e3bb3a7ef9ba9ce012fe8a83b1175e70f2ac",
        chunks_json: include_str!("fixtures/official_catalog/image_ernie_image_turbo.chunks.json"),
        graph_node_count: 21,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_krea2_turbo_t2i",
        source_blob: "b63db4754f99c506b66263750498cf633789ee48",
        chunks_json: include_str!("fixtures/official_catalog/image_krea2_turbo_t2i.chunks.json"),
        graph_node_count: 25,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_krea2_turbo_t2i_int8",
        source_blob: "a4fb56cfcf541204aa87cc02462fd78ce3090eb8",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_krea2_turbo_t2i_int8.chunks.json"
        ),
        graph_node_count: 25,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_z_image",
        source_blob: "97cfc42585f59bbe43139e2fea4c5a6530240592",
        chunks_json: include_str!("fixtures/official_catalog/image_z_image.chunks.json"),
        graph_node_count: 14,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
];

const IDEOGRAM_EXPECTED_POSITIVE: &str =
    include_str!("fixtures/official_catalog/image_ideogram4_t2i.expected-positive.txt");

fn git_blob_sha1(bytes: &[u8]) -> String {
    let mut message = format!("blob {}\0", bytes.len()).into_bytes();
    message.extend_from_slice(bytes);
    let bit_len = (message.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());

    let mut state = [
        0x6745_2301u32,
        0xefcd_ab89,
        0x98ba_dcfe,
        0x1032_5476,
        0xc3d2_e1f0,
    ];
    for chunk in message.chunks_exact(64) {
        let mut words = [0u32; 80];
        for (index, word) in words.iter_mut().take(16).enumerate() {
            let offset = index * 4;
            *word = u32::from_be_bytes(chunk[offset..offset + 4].try_into().unwrap());
        }
        for index in 16..80 {
            words[index] =
                (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                    .rotate_left(1);
        }

        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (index, word) in words.iter().enumerate() {
            let (function, constant) = match index {
                0..=19 => ((b & c) | ((!b) & d), 0x5a82_7999),
                20..=39 => (b ^ c ^ d, 0x6ed9_eba1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8f1b_bcdc),
                _ => (b ^ c ^ d, 0xca62_c1d6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(function)
                .wrapping_add(e)
                .wrapping_add(constant)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(value);
        }
    }

    format!(
        "{:08x}{:08x}{:08x}{:08x}{:08x}",
        state[0], state[1], state[2], state[3], state[4]
    )
}

fn assert_pinned_workflows(fixtures: &[IntakeFixture]) {
    for fixture in fixtures {
        let chunks: HashMap<String, String> = serde_json::from_str(fixture.chunks_json)
            .unwrap_or_else(|error| {
                panic!("{} chunks should be valid JSON: {error}", fixture.name)
            });
        assert_eq!(chunks.len(), 1, "{} should be workflow-only", fixture.name);
        let workflow = chunks
            .get("workflow")
            .unwrap_or_else(|| panic!("{} should include a workflow chunk", fixture.name));
        assert_eq!(
            git_blob_sha1(workflow.as_bytes()),
            fixture.source_blob,
            "{} pinned Git blob identity",
            fixture.name
        );
        let _: serde_json::Value = serde_json::from_str(workflow).unwrap_or_else(|error| {
            panic!("{} workflow should be valid JSON: {error}", fixture.name)
        });

        let (metadata, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
        assert_eq!(
            metadata.workflow_json.as_deref(),
            Some(workflow.as_str()),
            "{} workflow preservation",
            fixture.name
        );
        assert!(metadata.has_workflow_hint, "{} workflow hint", fixture.name);
        assert_eq!(diagnostics.graph_node_count, fixture.graph_node_count);
        assert_eq!(
            diagnostics.selected_output_candidate_count,
            fixture.output_candidates
        );
        assert_eq!(
            diagnostics.unique_output_root_sampler_count,
            fixture.output_roots
        );
        assert_eq!(diagnostics.output_ambiguous, fixture.output_ambiguous);
        assert_eq!(
            diagnostics
                .field_sources
                .get(&ComfyMetadataField::WorkflowJson),
            Some(&ComfyParseLayer::WorkflowChunk),
            "{} workflow JSON provenance",
            fixture.name
        );
        assert_eq!(
            diagnostics
                .field_sources
                .get(&ComfyMetadataField::WorkflowHint),
            Some(&ComfyParseLayer::WorkflowChunk),
            "{} workflow hint provenance",
            fixture.name
        );
    }
}

#[test]
fn pinned_phase22_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(FIXTURES);
}

#[test]
fn pinned_phase22_related_variants_have_stable_graph_shape() {
    assert_pinned_workflows(RELATED_VARIANTS);
}

#[test]
fn pinned_phase23_resource_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(PHASE23_RESOURCE_FIXTURES);
}

#[test]
fn pinned_milestone25_ideogram_workflow_has_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE25_IDEOGRAM_FIXTURES);
}

#[test]
fn pinned_milestone26_new_family_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE26_NEW_FAMILY_FIXTURES);
}

#[test]
fn pinned_milestone27_image_edit_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE27_IMAGE_EDIT_FIXTURES);
}

#[test]
fn pinned_milestone28_reference_modifier_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE28_REFERENCE_MODIFIER_FIXTURES);
}

#[test]
fn pinned_milestone29_core_variant_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE29_CORE_VARIANT_FIXTURES);
}

#[test]
fn pinned_milestone30_baseline_variant_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE30_BASELINE_VARIANT_FIXTURES);
}

#[test]
fn pinned_milestone31_baseline_edit_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE31_BASELINE_EDIT_FIXTURES);
}

#[test]
fn pinned_milestone32_flux2_variant_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE32_FLUX2_VARIANT_FIXTURES);
}

#[test]
fn pinned_milestone33_target_closure_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE33_TARGET_CLOSURE_FIXTURES);
}

#[test]
fn pinned_milestone34_catalog_refresh_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE34_CATALOG_REFRESH_FIXTURES);
}

#[test]
fn pinned_milestone37_revalidated_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE37_REVALIDATED_FIXTURES);
}

#[test]
fn pinned_milestone39_revalidated_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE39_REVALIDATED_FIXTURES);
}

#[test]
fn pinned_milestone40_revalidated_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE40_REVALIDATED_FIXTURES);
}

#[test]
fn pinned_milestone41_revalidated_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE41_REVALIDATED_FIXTURES);
}

#[test]
fn pinned_milestone42_revalidated_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE42_REVALIDATED_FIXTURES);
}

#[test]
fn pinned_milestone43_revalidated_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE43_REVALIDATED_FIXTURES);
}

#[test]
fn pinned_milestone44_revalidated_workflows_have_stable_graph_shape() {
    assert_pinned_workflows(MILESTONE44_REVALIDATED_FIXTURES);
}

#[test]
fn pinned_ideogram_source_expectations_are_stable() {
    let chunks: HashMap<String, String> =
        serde_json::from_str(MILESTONE25_IDEOGRAM_FIXTURES[0].chunks_json)
            .expect("Ideogram chunks should be valid JSON");
    let workflow = chunks
        .get("workflow")
        .expect("Ideogram fixture should include a workflow chunk");
    assert_eq!(workflow.len(), 119_252, "pinned workflow byte length");

    let workflow: serde_json::Value =
        serde_json::from_str(workflow).expect("Ideogram workflow should be valid JSON");
    let definition = workflow["definitions"]["subgraphs"]
        .as_array()
        .and_then(|definitions| {
            definitions.iter().find(|definition| {
                definition["id"].as_str() == Some("83e6e004-48ea-408e-9024-eb49c3d7dc14")
            })
        })
        .expect("Ideogram generation definition");
    let nodes = definition["nodes"]
        .as_array()
        .expect("Ideogram definition nodes");
    let node = |id| {
        nodes
            .iter()
            .find(|node| node["id"].as_i64() == Some(id))
            .unwrap_or_else(|| panic!("missing Ideogram node {id}"))
    };

    assert_eq!(
        node(23)["widgets_values"][0],
        "ideogram4_fp8_scaled.safetensors"
    );
    assert_eq!(
        node(154)["widgets_values"][0],
        "ideogram4_unconditional_fp8_scaled.safetensors"
    );
    assert_eq!(node(18)["widgets_values"][0], 885_894_517_601_261_i64);
    assert_eq!(node(156)["widgets_values"][0], "Default");
    assert_eq!(node(155)["widgets_values"][0], 7);
    assert_eq!(node(157)["widgets_values"], serde_json::json!([3, 0.7, 1]));
    assert_eq!(
        node(17)["widgets_values"],
        serde_json::json!([20, 1024, 1024, 0.5, 1.75])
    );
    assert_eq!(node(16)["widgets_values"][0], "euler");
    assert_eq!(node(24)["widgets_values"][0], IDEOGRAM_EXPECTED_POSITIVE);
    assert_eq!(IDEOGRAM_EXPECTED_POSITIVE.len(), 3_598);
    assert_eq!(node(10)["type"], "ConditioningZeroOut");

    assert!(
        nodes.iter().all(|node| {
            let node_type = node["type"]
                .as_str()
                .unwrap_or_default()
                .to_ascii_lowercase();
            !node_type.contains("lora")
                && !node_type.contains("controlnet")
                && !node_type.contains("ipadapter")
                && !node_type.contains("hypernetwork")
                && !node_type.contains("embedding")
        }),
        "pinned Ideogram workflow should not declare metadata resources"
    );
}
