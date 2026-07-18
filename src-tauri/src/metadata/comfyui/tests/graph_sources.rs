use super::super::graph::{
    get_input_connection, get_input_source, ComfyGraph, InputConnection, InputSource,
    InputSourceConnection,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn graph_from_chunk(key: &str, value: Value) -> ComfyGraph {
    ComfyGraph::from_chunks(&HashMap::from([(key.to_string(), value.to_string())]))
}

fn assert_source(
    graph: &ComfyGraph,
    node_id: &str,
    input_name: &str,
    expected_id: &str,
    expected_slot: usize,
) {
    let node = graph.get_node(node_id).expect("connected target node");
    assert_eq!(
        get_input_source(node, input_name),
        InputSourceConnection::Connected(InputSource {
            node_id: expected_id.to_string(),
            output_slot: Some(expected_slot),
        })
    );
    assert_eq!(
        get_input_connection(node, input_name),
        InputConnection::Connected(expected_id.to_string()),
        "the existing ID-only connection projection must remain unchanged"
    );
}

#[test]
fn api_connections_preserve_source_output_slots() {
    let graph = graph_from_chunk(
        "prompt",
        json!({
            "7": { "class_type": "Source", "inputs": {} },
            "9": {
                "class_type": "Target",
                "inputs": { "value": ["7", 3] }
            },
            "10": {
                "class_type": "LegacyTarget",
                "inputs": { "value": ["7", -1] }
            }
        }),
    );

    assert_source(&graph, "9", "value", "7", 3);
    let legacy_node = graph.get_node("10").expect("legacy target node");
    assert_eq!(
        get_input_source(legacy_node, "value"),
        InputSourceConnection::Connected(InputSource {
            node_id: "7".to_string(),
            output_slot: None,
        })
    );
    assert_eq!(
        get_input_connection(legacy_node, "value"),
        InputConnection::Connected("7".to_string()),
        "invalid legacy slot values must not change ID-only connection behavior"
    );
}

#[test]
fn workflow_array_and_object_edges_preserve_source_output_slots() {
    let graph = graph_from_chunk(
        "workflow",
        json!({
            "nodes": [
                {
                    "id": 1,
                    "type": "Source",
                    "inputs": [],
                    "outputs": [
                        { "name": "A", "type": "STRING", "links": [] },
                        { "name": "B", "type": "STRING", "links": [11] },
                        { "name": "C", "type": "STRING", "links": [10] }
                    ]
                },
                {
                    "id": 2,
                    "type": "Target",
                    "inputs": [{ "name": "array_value", "type": "STRING", "link": 10 }],
                    "outputs": []
                },
                {
                    "id": 3,
                    "type": "Target",
                    "inputs": [{ "name": "object_value", "type": "STRING", "link": 11 }],
                    "outputs": []
                }
            ],
            "links": [
                [10, 1, 2, 2, 0, "STRING"],
                {
                    "id": 11,
                    "origin_id": 1,
                    "origin_slot": 1,
                    "target_id": 3,
                    "target_slot": 0,
                    "type": "STRING"
                }
            ],
            "version": 0.4
        }),
    );

    assert_source(&graph, "2", "array_value", "1", 2);
    assert_source(&graph, "3", "object_value", "1", 1);
}

#[test]
fn nested_subgraph_outputs_keep_the_internal_source_slot() {
    let graph = graph_from_chunk(
        "workflow",
        json!({
            "nodes": [
                {
                    "id": 30,
                    "type": "outer_definition",
                    "mode": 0,
                    "inputs": [],
                    "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [20] }]
                },
                {
                    "id": 40,
                    "type": "SaveImage",
                    "mode": 0,
                    "inputs": [{ "name": "images", "type": "IMAGE", "link": 20 }],
                    "outputs": []
                }
            ],
            "links": [[20, 30, 0, 40, 0, "IMAGE"]],
            "definitions": {
                "subgraphs": [{
                    "id": "inner_definition",
                    "inputNode": { "id": -10 },
                    "outputNode": { "id": -20 },
                    "inputs": [],
                    "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
                    "nodes": [{
                        "id": 7,
                        "type": "MultiOutputSource",
                        "inputs": [],
                        "outputs": [
                            { "name": "A", "type": "IMAGE", "links": [] },
                            { "name": "B", "type": "IMAGE", "links": [] },
                            { "name": "C", "type": "IMAGE", "links": [21] }
                        ]
                    }],
                    "links": [[21, 7, 2, -20, 0, "IMAGE"]]
                }, {
                    "id": "outer_definition",
                    "inputNode": { "id": -10 },
                    "outputNode": { "id": -20 },
                    "inputs": [],
                    "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
                    "nodes": [{
                        "id": 8,
                        "type": "inner_definition",
                        "mode": 0,
                        "inputs": [],
                        "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [22] }]
                    }],
                    "links": [[22, 8, 0, -20, 0, "IMAGE"]]
                }]
            },
            "version": 0.4
        }),
    );

    assert_source(&graph, "40", "images", "30:8:7", 2);
}

#[test]
fn declared_unresolved_workflow_links_have_no_source_or_slot() {
    let graph = graph_from_chunk(
        "workflow",
        json!({
            "nodes": [{
                "id": 2,
                "type": "Target",
                "inputs": [{ "name": "value", "type": "STRING", "link": 999 }],
                "outputs": []
            }],
            "links": [],
            "version": 0.4
        }),
    );
    let node = graph.get_node("2").expect("unresolved target node");

    assert_eq!(
        get_input_source(node, "value"),
        InputSourceConnection::DeclaredUnresolved
    );
    assert_eq!(
        get_input_connection(node, "value"),
        InputConnection::DeclaredUnresolved
    );
}
