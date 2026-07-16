use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};

struct PatternFixture {
    name: &'static str,
    chunks_json: &'static str,
}

struct ExpectedVariantMetadata {
    model: &'static str,
    seed: i64,
    steps: u32,
    cfg: f32,
    sampler: &'static str,
    positive_prompt: &'static str,
    negative_prompt: &'static str,
    graph_node_count: usize,
}

#[derive(Debug, Eq, PartialEq)]
struct SelectedInternalPathSignature {
    node_types: BTreeMap<String, usize>,
    edges: BTreeMap<(String, usize, String, usize, String), usize>,
}

const ANIMA_BASE: PatternFixture = PatternFixture {
    name: "image_anima_base_v1",
    chunks_json: include_str!("fixtures/official_catalog/image_anima_base_v1.chunks.json"),
};
const ANIMA_PREVIEW: PatternFixture = PatternFixture {
    name: "image_anima_preview",
    chunks_json: include_str!("fixtures/official_catalog/image_anima_preview.chunks.json"),
};
const LENS: PatternFixture = PatternFixture {
    name: "image_lens_t2i",
    chunks_json: include_str!("fixtures/official_catalog/image_lens_t2i.chunks.json"),
};
const LENS_TURBO: PatternFixture = PatternFixture {
    name: "image_lens_turbo_t2i",
    chunks_json: include_str!("fixtures/official_catalog/image_lens_turbo_t2i.chunks.json"),
};

fn load_chunks(fixture: &PatternFixture) -> HashMap<String, String> {
    serde_json::from_str(fixture.chunks_json)
        .unwrap_or_else(|error| panic!("{} chunks should be valid JSON: {error}", fixture.name))
}

fn load_workflow(fixture: &PatternFixture) -> Value {
    let chunks = load_chunks(fixture);
    serde_json::from_str(
        chunks
            .get("workflow")
            .unwrap_or_else(|| panic!("{} should include workflow", fixture.name)),
    )
    .unwrap_or_else(|error| panic!("{} workflow should be valid JSON: {error}", fixture.name))
}

fn assert_supported_selected_path(fixture: &PatternFixture, expected: ExpectedVariantMetadata) {
    let chunks = load_chunks(fixture);
    let workflow = chunks
        .get("workflow")
        .expect("pattern fixture should include workflow");
    let (metadata, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(metadata.workflow_json.as_deref(), Some(workflow.as_str()));
    assert!(metadata.has_workflow_hint);
    assert_eq!(metadata.model, expected.model);
    assert_eq!(metadata.seed, Some(expected.seed));
    assert_eq!(metadata.steps, expected.steps);
    assert_eq!(metadata.cfg, expected.cfg);
    assert_eq!(metadata.sampler, expected.sampler);
    assert_eq!(metadata.positive_prompt, expected.positive_prompt);
    assert_eq!(metadata.negative_prompt, expected.negative_prompt);
    assert!(metadata.loras.is_empty());
    assert!(metadata.control_nets.is_empty());
    assert!(metadata.ip_adapters.is_empty());
    assert!(metadata.embeddings.is_empty());
    assert!(metadata.hypernetworks.is_empty());
    assert_eq!(diagnostics.graph_node_count, expected.graph_node_count);
    assert_eq!(diagnostics.selected_output_candidate_count, 1);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert!(!diagnostics.output_ambiguous);

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
            Some(&ComfyParseLayer::SamplerTraversal),
            "{} {field:?} provenance",
            fixture.name
        );
    }
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::NegativePrompt),
        (!expected.negative_prompt.is_empty()).then_some(&ComfyParseLayer::SamplerTraversal)
    );
}

fn edge_parts(edge: &Value) -> Option<(String, usize, String, usize, String)> {
    if let Some(values) = edge.as_array() {
        return Some((
            values.get(1)?.as_i64()?.to_string(),
            values.get(2)?.as_u64()? as usize,
            values.get(3)?.as_i64()?.to_string(),
            values.get(4)?.as_u64()? as usize,
            values.get(5)?.as_str()?.to_string(),
        ));
    }

    Some((
        edge.get("origin_id")?.as_i64()?.to_string(),
        edge.get("origin_slot")?.as_u64()? as usize,
        edge.get("target_id")?.as_i64()?.to_string(),
        edge.get("target_slot")?.as_u64()? as usize,
        edge.get("type")?.as_str()?.to_string(),
    ))
}

// Definition input bindings are intentionally excluded; exact variant assertions below cover them.
fn selected_internal_path_signature(fixture: &PatternFixture) -> SelectedInternalPathSignature {
    let workflow = load_workflow(fixture);
    let nodes = workflow["nodes"]
        .as_array()
        .expect("workflow nodes should be an array");
    let save = nodes
        .iter()
        .find(|node| node["type"] == "SaveImage" && node["mode"].as_i64().unwrap_or(0) == 0)
        .expect("fixture should have an active SaveImage");
    let save_id = save["id"].as_i64().expect("save id should be numeric");
    let instance_id = workflow["links"]
        .as_array()
        .expect("workflow links should be an array")
        .iter()
        .find_map(|edge| {
            let values = edge.as_array()?;
            if values.get(3)?.as_i64()? != save_id {
                return None;
            }
            Some(values.get(1)?.as_i64()?.to_string())
        })
        .expect("SaveImage should be connected to a subgraph instance");
    let instance = nodes
        .iter()
        .find(|node| {
            node["id"]
                .as_i64()
                .is_some_and(|id| id.to_string() == instance_id)
        })
        .expect("subgraph instance should exist");
    let definition_id = instance["type"]
        .as_str()
        .expect("subgraph instance type should be its definition id");
    let definition = workflow["definitions"]["subgraphs"]
        .as_array()
        .expect("subgraph definitions should be an array")
        .iter()
        .find(|definition| definition["id"] == definition_id)
        .expect("subgraph definition should exist");

    let definition_nodes = definition["nodes"]
        .as_array()
        .expect("definition nodes should be an array");
    let types = definition_nodes
        .iter()
        .map(|node| {
            (
                node["id"]
                    .as_i64()
                    .expect("node id should be numeric")
                    .to_string(),
                node["type"]
                    .as_str()
                    .expect("node type should be a string")
                    .to_string(),
            )
        })
        .collect::<HashMap<_, _>>();
    let edges = definition["links"]
        .as_array()
        .expect("definition links should be an array")
        .iter()
        .filter_map(edge_parts)
        .collect::<Vec<_>>();

    let mut reachable = BTreeSet::new();
    let mut stack = edges
        .iter()
        .filter(|(_, _, target, _, _)| target == "-20")
        .map(|(source, _, _, _, _)| source.clone())
        .collect::<Vec<_>>();
    while let Some(node_id) = stack.pop() {
        if !reachable.insert(node_id.clone()) {
            continue;
        }
        for (source, _, target, _, _) in &edges {
            if target == &node_id && source != "-10" {
                stack.push(source.clone());
            }
        }
    }

    let mut node_types = BTreeMap::new();
    for node_id in &reachable {
        let node_type = types
            .get(node_id)
            .unwrap_or_else(|| panic!("missing type for reachable node {node_id}"));
        *node_types.entry(node_type.clone()).or_insert(0) += 1;
    }

    let mut edge_types = BTreeMap::new();
    for (source, source_slot, target, target_slot, link_type) in edges {
        if !reachable.contains(&source) || !reachable.contains(&target) {
            continue;
        }
        let key = (
            types[&source].clone(),
            source_slot,
            types[&target].clone(),
            target_slot,
            link_type,
        );
        *edge_types.entry(key).or_insert(0) += 1;
    }

    SelectedInternalPathSignature {
        node_types,
        edges: edge_types,
    }
}

fn assert_no_internal_resource_paths(signature: &SelectedInternalPathSignature) {
    assert!(signature
        .node_types
        .keys()
        .all(|node_type| !node_type.contains("Lora") && !node_type.contains("ControlNet")));
}

#[test]
fn selected_path_edges_preserve_source_output_slots() {
    let array_edge = serde_json::json!([1, 10, 2, 20, 3, "CONDITIONING"]);
    let object_edge = serde_json::json!({
        "origin_id": 10,
        "origin_slot": 4,
        "target_id": 20,
        "target_slot": 5,
        "type": "CONDITIONING"
    });

    assert_eq!(
        edge_parts(&array_edge),
        Some((
            "10".to_string(),
            2,
            "20".to_string(),
            3,
            "CONDITIONING".to_string(),
        ))
    );
    assert_eq!(
        edge_parts(&object_edge),
        Some((
            "10".to_string(),
            4,
            "20".to_string(),
            5,
            "CONDITIONING".to_string(),
        ))
    );
}

#[test]
fn anima_preview_matches_the_anima_base_selected_path_pattern() {
    let base = selected_internal_path_signature(&ANIMA_BASE);
    let preview = selected_internal_path_signature(&ANIMA_PREVIEW);

    assert_eq!(preview, base);
    assert_eq!(preview.node_types.get("KSampler"), Some(&1));
    assert_eq!(preview.node_types.get("UNETLoader"), Some(&1));
    assert_eq!(preview.node_types.get("CLIPTextEncode"), Some(&2));
    assert_no_internal_resource_paths(&preview);
    assert_supported_selected_path(
        &ANIMA_PREVIEW,
        ExpectedVariantMetadata {
            model: "anima_preview3_base",
            seed: 875_817_230_929_465,
            steps: 30,
            cfg: 4.0,
            sampler: "er_sde (simple)",
            positive_prompt: "masterpiece, best quality, score_7, safe, anime, a close-up of a futuristic cyberpunk robotic eye, original close-up eye composition strictly preserved, encased in weathered metallic blue and chrome plating with exposed wiring, glowing orange indicator lights, hydraulic pistons, and panel seams wrapping around the eyelid, a chrome mechanical tear duct with fine circuit details, long dark anime-style eyelashes framing the eye, soft pink sclera. The dark pupil holds a complete, glowing Earth with blue atmosphere and white clouds as a reflection, while the surrounding iris reflects a vivid cosmic scene: a fiery red shooting star, wispy cyan nebula clouds, and tiny glowing star specks. No change to the original close-up eye framing, no additional elements outside the eye structure, neon accent lighting, high contrast cyberpunk color palette, intricate mechanical engineering, sharp line art, gritty futuristic sci-fi atmosphere.",
            negative_prompt: "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia",
            graph_node_count: 10,
        },
    );
}

#[test]
fn lens_turbo_matches_the_lens_selected_path_pattern() {
    let base = selected_internal_path_signature(&LENS);
    let turbo = selected_internal_path_signature(&LENS_TURBO);

    assert_eq!(turbo, base);
    for node_type in [
        "SamplerCustom",
        "CFGNorm",
        "ModelSamplingFlux",
        "UNETLoader",
        "BasicScheduler",
        "KSamplerSelect",
    ] {
        assert_eq!(turbo.node_types.get(node_type), Some(&1), "{node_type}");
    }
    assert_eq!(turbo.node_types.get("CLIPTextEncode"), Some(&2));
    assert_no_internal_resource_paths(&turbo);
    assert_supported_selected_path(
        &LENS_TURBO,
        ExpectedVariantMetadata {
            model: "lens_turbo_bf16",
            seed: 455_122_126_103_069,
            steps: 4,
            cfg: 1.0,
            sampler: "euler (simple)",
            positive_prompt: r#"A stylish vintage Porsche driving through a rainy neon city street at night, reflections shimmering across wet pavement, wide horizontal neon sign displaying "ComfyUI", glowing horizontal shop sign reading "Lens", cinematic atmosphere, moody retro lighting, analog film grain, 1980s movie still aesthetic"#,
            negative_prompt: "",
            graph_node_count: 20,
        },
    );
}
