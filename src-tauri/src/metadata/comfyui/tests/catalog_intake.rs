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
        source_blob: "2b8eb6b61006a4e95a92f9e9b10fb23df44f3868",
        chunks_json: include_str!("fixtures/official_catalog/image_anima_base_v1.chunks.json"),
        graph_node_count: 10,
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
        source_blob: "8784096ee565f02e20c13c07a0f582cfa9d0692d",
        chunks_json: include_str!("fixtures/official_catalog/image_lens_t2i.chunks.json"),
        graph_node_count: 19,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_boogu_image_0_1_edit",
        source_blob: "35750c20d300a25e6e1f8231c664392accee8abe",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_boogu_image_0_1_edit.chunks.json"
        ),
        graph_node_count: 17,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "video_bernini_r_image_editing",
        source_blob: "8d6b8327865c9421a0f20244f1f314d8c2818e67",
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
        source_blob: "80c7cca83a3fed582d4fd1fe20971b60d68336ac",
        chunks_json: include_str!("fixtures/official_catalog/image_anima_preview.chunks.json"),
        graph_node_count: 10,
        output_candidates: 1,
        output_roots: 1,
        output_ambiguous: false,
    },
    IntakeFixture {
        name: "image_lens_turbo_t2i",
        source_blob: "697cbf0bb04eff2d70750dd9d2f01cc920d76ca5",
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
    source_blob: "c04018493c60d8d4275f0bdc54acb385f59e7ea5",
    chunks_json: include_str!("fixtures/official_catalog/image_ideogram4_t2i.chunks.json"),
    graph_node_count: 42,
    output_candidates: 1,
    output_roots: 1,
    output_ambiguous: false,
}];

const MILESTONE26_NEW_FAMILY_FIXTURES: &[IntakeFixture] = &[
    IntakeFixture {
        name: "image_longcat_text_to_image",
        source_blob: "134b4ef684a862eb5d6a579d0e38e15589b6fa79",
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
        source_blob: "66593d57b3d14b42e137be9d53cf2f90820e7bee",
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
fn pinned_ideogram_source_expectations_are_stable() {
    let chunks: HashMap<String, String> =
        serde_json::from_str(MILESTONE25_IDEOGRAM_FIXTURES[0].chunks_json)
            .expect("Ideogram chunks should be valid JSON");
    let workflow = chunks
        .get("workflow")
        .expect("Ideogram fixture should include a workflow chunk");
    assert_eq!(workflow.len(), 119_270, "pinned workflow byte length");

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
