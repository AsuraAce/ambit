use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use super::super::graph::{get_source_id, ComfyGraph};
use super::super::workflow_normalizer::normalize_workflow_with_test_limits;
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use serde_json::{json, Value};
use std::collections::HashMap;

fn chunks_from_workflow(workflow: Value) -> HashMap<String, String> {
    HashMap::from([(
        "workflow".to_string(),
        serde_json::to_string(&workflow).expect("workflow should serialize"),
    )])
}

fn loader(id: i64, name: &str, link: i64) -> Value {
    json!({
        "id": id,
        "type": "CheckpointLoaderSimple",
        "mode": 0,
        "inputs": [],
        "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [link] }],
        "widgets_values": [name]
    })
}

fn controller(id: i64, link: i64) -> Value {
    json!({
        "id": id,
        "type": "Anything Everywhere",
        "mode": 0,
        "inputs": [{ "name": "anything", "type": "MODEL", "link": link }],
        "outputs": []
    })
}

fn sampler(id: i64, model_link: i64) -> Value {
    json!({
        "id": id,
        "type": "KSampler",
        "mode": 0,
        "inputs": [{ "name": "model", "type": "MODEL", "link": model_link }],
        "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [20] }],
        "widgets_values": [42, "fixed", 4, 1.0, "euler", "simple", 1.0]
    })
}

fn ue_link(upstream: i64, controller: i64) -> Value {
    json!({
        "downstream": 30,
        "downstream_slot": 0,
        "upstream": upstream,
        "upstream_slot": 0,
        "controller": controller,
        "type": "MODEL"
    })
}

#[test]
fn persisted_ue_link_becomes_a_direct_workflow_source() {
    let workflow = json!({
        "nodes": [loader(1, "wireless.safetensors", 1), controller(10, 1), sampler(30, 100)],
        "links": [[1, 1, 0, 10, 0, "MODEL"]],
        "extra": { "ue_links": [ue_link(1, 10)], "links_added_by_ue": [100] }
    });

    let graph = ComfyGraph::from_chunks(&chunks_from_workflow(workflow));
    assert_eq!(get_source_id(&graph, "30", "model").as_deref(), Some("1"));
}

#[test]
fn real_edge_wins_over_conflicting_persisted_ue_link() {
    let workflow = json!({
        "nodes": [
            loader(1, "direct.safetensors", 1),
            loader(2, "wireless.safetensors", 2),
            controller(10, 2),
            sampler(30, 3)
        ],
        "links": [[2, 2, 0, 10, 0, "MODEL"], [3, 1, 0, 30, 0, "MODEL"]],
        "extra": { "ue_links": [ue_link(2, 10)] }
    });

    let graph = ComfyGraph::from_chunks(&chunks_from_workflow(workflow));
    assert_eq!(get_source_id(&graph, "30", "model").as_deref(), Some("1"));
}

#[test]
fn identical_virtual_links_deduplicate_but_conflicting_sources_fail_closed() {
    let base_nodes = vec![
        loader(1, "first.safetensors", 1),
        loader(2, "second.safetensors", 2),
        controller(10, 1),
        controller(11, 2),
        sampler(30, 100),
    ];
    let base_links = json!([[1, 1, 0, 10, 0, "MODEL"], [2, 2, 0, 11, 0, "MODEL"]]);

    let duplicate_workflow = json!({
        "nodes": base_nodes.clone(),
        "links": base_links.clone(),
        "extra": { "ue_links": [ue_link(1, 10), ue_link(1, 10)] }
    });
    let duplicate_graph = ComfyGraph::from_chunks(&chunks_from_workflow(duplicate_workflow));
    assert_eq!(
        get_source_id(&duplicate_graph, "30", "model").as_deref(),
        Some("1")
    );

    let conflicting_workflow = json!({
        "nodes": base_nodes,
        "links": base_links,
        "extra": { "ue_links": [ue_link(1, 10), ue_link(2, 11)] }
    });
    let chunks = chunks_from_workflow(conflicting_workflow);
    let graph = ComfyGraph::from_chunks(&chunks);
    assert_eq!(get_source_id(&graph, "30", "model"), None);

    let (_, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
    assert_ne!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&ComfyParseLayer::SamplerTraversal),
        "ambiguous persisted UE sources must not gain traversal authority"
    );
}

#[test]
fn inactive_or_missing_ue_controllers_fail_closed() {
    for controller_node in [
        json!({
            "id": 10,
            "type": "Anything Everywhere",
            "mode": 4,
            "inputs": [{ "name": "anything", "type": "MODEL", "link": 1 }],
            "outputs": []
        }),
        json!({
            "id": 11,
            "type": "Anything Everywhere",
            "mode": 0,
            "inputs": [],
            "outputs": []
        }),
    ] {
        let controller_id = controller_node["id"].as_i64().expect("controller id");
        let persisted_controller = if controller_id == 10 { 10 } else { 999 };
        let workflow = json!({
            "nodes": [loader(1, "wireless.safetensors", 1), controller_node, sampler(30, 100)],
            "links": [[1, 1, 0, controller_id, 0, "MODEL"]],
            "extra": { "ue_links": [ue_link(1, persisted_controller)] }
        });
        let graph = ComfyGraph::from_chunks(&chunks_from_workflow(workflow));
        assert_eq!(get_source_id(&graph, "30", "model"), None);
    }
}

#[test]
fn resolved_link_metadata_disables_legacy_guessing_for_unlisted_inputs() {
    let workflow = json!({
        "nodes": [loader(1, "wireless.safetensors", 1), controller(10, 1), sampler(30, 100)],
        "links": [[1, 1, 0, 10, 0, "MODEL"]],
        "extra": { "ue_links": [{}] }
    });

    let graph = ComfyGraph::from_chunks(&chunks_from_workflow(workflow));
    assert_eq!(get_source_id(&graph, "30", "model"), None);
}

#[test]
fn resolved_ue_links_remain_scoped_inside_expanded_subgraphs() {
    let definition = json!({
        "id": "wireless-subgraph",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [],
        "outputs": [{ "name": "LATENT", "type": "LATENT" }],
        "nodes": [loader(1, "nested.safetensors", 1), controller(10, 1), sampler(30, 100)],
        "links": [
            [1, 1, 0, 10, 0, "MODEL"],
            [20, 30, 0, -20, 0, "LATENT"]
        ],
        "extra": { "ue_links": [ue_link(1, 10)] }
    });
    let workflow = json!({
        "nodes": [{
            "id": 50,
            "type": "wireless-subgraph",
            "mode": 0,
            "inputs": [],
            "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [] }]
        }],
        "links": [],
        "definitions": { "subgraphs": [definition] }
    });

    let graph = ComfyGraph::from_chunks(&chunks_from_workflow(workflow));
    assert_eq!(
        get_source_id(&graph, "50:30", "model").as_deref(),
        Some("50:1")
    );
}

#[test]
fn api_prompt_graph_remains_authoritative_over_workflow_ue_links() {
    let workflow = json!({
        "nodes": [loader(1, "workflow.safetensors", 1), controller(10, 1), sampler(30, 100)],
        "links": [[1, 1, 0, 10, 0, "MODEL"]],
        "extra": { "ue_links": [ue_link(1, 10)] }
    });
    let prompt = json!({
        "2": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "prompt.safetensors" } },
        "30": { "class_type": "KSampler", "inputs": { "model": ["2", 0] } }
    });
    let chunks = HashMap::from([
        ("prompt".to_string(), prompt.to_string()),
        ("workflow".to_string(), workflow.to_string()),
    ]);

    let graph = ComfyGraph::from_chunks(&chunks);
    assert_eq!(get_source_id(&graph, "30", "model").as_deref(), Some("2"));
}

#[test]
fn oversized_ue_link_metadata_respects_the_shared_clone_budget() {
    let workflow = json!({
        "nodes": [loader(1, "wireless.safetensors", 1), controller(10, 1), sampler(30, 100)],
        "links": [[1, 1, 0, 10, 0, "MODEL"]],
        "extra": { "ue_links": [{
            "downstream": 30,
            "downstream_slot": 0,
            "upstream": 1,
            "upstream_slot": 0,
            "controller": 10,
            "type": "x".repeat(8_192)
        }] }
    });

    assert!(normalize_workflow_with_test_limits(&workflow, 100, 100, 4_096).is_none());

    let malformed = json!({
        "nodes": [],
        "links": [],
        "extra": { "ue_links": [{}, {}, {}] }
    });
    assert!(normalize_workflow_with_test_limits(&malformed, 100, 2, 4_096).is_none());
}
