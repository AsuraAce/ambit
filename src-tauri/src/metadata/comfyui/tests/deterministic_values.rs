use super::super::conditioning::evaluate_string_node_strict;
use super::super::eval_utils::{evaluate_float_link_first, evaluate_number_link_first};
use super::super::graph::{get_node_type, ComfyGraph};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

fn prompt_graph(nodes: Value) -> ComfyGraph {
    let chunks = HashMap::from([("prompt".to_string(), nodes.to_string())]);
    ComfyGraph::from_chunks(&chunks)
}

fn workflow_graph(nodes: Value, links: Value) -> ComfyGraph {
    let workflow = json!({ "nodes": nodes, "links": links });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);
    ComfyGraph::from_chunks(&chunks)
}

fn evaluate_string_node(graph: &ComfyGraph, node_id: &str) -> Option<String> {
    evaluate_string_node_strict(graph, node_id, &mut HashSet::new(), 0)
}

fn converter_graph(value: Value, output_slot: usize) -> ComfyGraph {
    prompt_graph(json!({
        "1": { "class_type": "ComfyNumberConvert", "inputs": { "value": value } },
        "2": { "class_type": "Consumer", "inputs": { "number": ["1", output_slot] } }
    }))
}

#[test]
fn json_extract_uses_connected_inputs_and_compact_json_values() {
    let graph = prompt_graph(json!({
        "1": {
            "class_type": "String",
            "inputs": { "value": "{\"Default\":{\"steps\":20,\"enabled\":true}}" }
        },
        "2": { "class_type": "String", "inputs": { "value": "Default" } },
        "3": {
            "class_type": "JsonExtractString",
            "inputs": { "json_string": ["1", 0], "key": ["2", 0] },
            "widgets_values": ["{\"stale\":true}", "stale"]
        }
    }));

    assert_eq!(
        evaluate_string_node(&graph, "3").as_deref(),
        Some("{\"enabled\":true,\"steps\":20}")
    );
}

#[test]
fn json_extract_supports_unlinked_workflow_widgets_and_authoritative_empty_values() {
    let graph = workflow_graph(
        json!([
            {
                "id": 1,
                "type": "JsonExtractString",
                "inputs": [],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": null }],
                "widgets_values": ["{\"prompt\":\"literal\",\"empty\":null}", "prompt"]
            },
            {
                "id": 2,
                "type": "JsonExtractString",
                "inputs": [],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": null }],
                "widgets_values": ["{\"prompt\":\"literal\",\"empty\":null}", "empty"]
            },
            {
                "id": 3,
                "type": "JsonExtractString",
                "inputs": [],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": null }],
                "widgets_values": ["{\"prompt\":\"literal\"}", "missing"]
            }
        ]),
        json!([]),
    );

    assert_eq!(
        evaluate_string_node(&graph, "1").as_deref(),
        Some("literal")
    );
    assert_eq!(evaluate_string_node(&graph, "2").as_deref(), Some(""));
    assert_eq!(evaluate_string_node(&graph, "3").as_deref(), Some(""));
}

#[test]
fn json_extract_failures_do_not_reopen_stale_widgets() {
    let oversized_key = "k".repeat(4 * 1024 + 1);
    let oversized_json = format!("{{\"key\":\"{}\"}}", "x".repeat(64 * 1024));
    let graph = prompt_graph(json!({
        "1": {
            "class_type": "JsonExtractString",
            "inputs": { "json_string": ["missing", 0], "key": "key" },
            "widgets_values": ["{\"key\":\"stale\"}", "key"]
        },
        "2": { "class_type": "JsonExtractString", "inputs": { "json_string": "[]", "key": "key" } },
        "3": { "class_type": "JsonExtractString", "inputs": { "json_string": "not json", "key": "key" } },
        "4": { "class_type": "JsonExtractString", "inputs": { "json_string": "{}", "key": oversized_key } },
        "5": { "class_type": "JsonExtractString", "inputs": { "json_string": oversized_json, "key": "key" } },
        "6": { "class_type": "PreviewAny", "inputs": { "source": ["7", 1] } },
        "7": { "class_type": "JsonExtractString", "inputs": { "json_string": "{\"key\":\"value\"}", "key": "key" } },
        "8": { "class_type": "JsonExtractString", "inputs": { "json_string": ["9", 0], "key": "key" } },
        "9": { "class_type": "StringConcatenate", "inputs": { "string_a": ["8", 0], "string_b": "", "delimiter": "" } }
    }));

    for node_id in ["1", "2", "3", "4", "5", "6", "8"] {
        assert_eq!(
            evaluate_string_node(&graph, node_id),
            None,
            "node {node_id}"
        );
    }
}

#[test]
fn comfy_number_convert_honors_output_slots_and_scalar_types() {
    let cases = [
        (json!(true), 1, Some(1), None),
        (json!(false), 0, None, Some(0.0)),
        (json!(-7), 1, Some(-7), None),
        (json!(3.9), 1, Some(3), None),
        (json!(" 12.75 "), 0, None, Some(12.75)),
        (json!(" -12.75 "), 1, Some(-12), None),
        (
            json!("9007199254740991"),
            1,
            Some(9_007_199_254_740_991),
            None,
        ),
    ];

    for (value, slot, expected_integer, expected_float) in cases {
        let graph = converter_graph(value, slot);
        let consumer = graph.get_node("2").expect("consumer node");
        if let Some(expected) = expected_integer {
            assert_eq!(
                evaluate_number_link_first(&graph, consumer, "number", i64::MAX),
                Some(expected)
            );
        }
        if let Some(expected) = expected_float {
            assert_eq!(
                evaluate_float_link_first(&graph, consumer, "number", f64::MAX),
                Some(expected)
            );
        }
    }
}

#[test]
fn comfy_number_convert_preserves_slots_through_reroutes() {
    let graph = prompt_graph(json!({
        "1": { "class_type": "String", "inputs": { "value": "20.9" } },
        "2": { "class_type": "ComfyNumberConvert", "inputs": { "value": ["1", 0] } },
        "3": { "class_type": "Reroute", "inputs": { "value": ["2", 1] } },
        "4": { "class_type": "Consumer", "inputs": { "number": ["3", 0] } }
    }));
    let consumer = graph.get_node("4").expect("consumer node");

    assert_eq!(
        evaluate_number_link_first(&graph, consumer, "number", 100),
        Some(20)
    );
}

#[test]
fn comfy_number_convert_preserves_string_source_output_slots() {
    let graph = prompt_graph(json!({
        "1": { "class_type": "CustomCombo", "widgets_values": ["B", 1, "A", "B"] },
        "2": { "class_type": "ComfyNumberConvert", "inputs": { "value": ["1", 1] } },
        "3": { "class_type": "Consumer", "inputs": { "number": ["2", 1] } }
    }));
    let consumer = graph.get_node("3").expect("consumer node");

    assert_eq!(
        evaluate_number_link_first(&graph, consumer, "number", 10),
        Some(1)
    );
}

#[test]
fn comfy_number_convert_prefers_linked_numeric_values_over_stale_widgets() {
    let graph = prompt_graph(json!({
        "1": { "class_type": "PrimitiveNode", "inputs": { "value": 7 } },
        "2": {
            "class_type": "PrimitiveNode",
            "_resolved_sources": { "value": { "node_id": "1", "output_slot": 0 } },
            "widgets_values": [99]
        },
        "3": { "class_type": "ComfyNumberConvert", "inputs": { "value": ["2", 0] } },
        "4": { "class_type": "Consumer", "inputs": { "number": ["3", 1] } }
    }));
    let consumer = graph.get_node("4").expect("consumer node");

    assert_eq!(
        evaluate_number_link_first(&graph, consumer, "number", 100),
        Some(7)
    );
}

#[test]
fn comfy_number_convert_fails_closed_for_invalid_sources_and_slots() {
    for value in [
        json!(""),
        json!("NaN"),
        json!("Infinity"),
        json!("9223372036854775808"),
    ] {
        let graph = converter_graph(value, 1);
        let consumer = graph.get_node("2").expect("consumer node");
        assert_eq!(
            evaluate_number_link_first(&graph, consumer, "number", i64::MAX),
            None
        );
    }

    let graph = prompt_graph(json!({
        "1": { "class_type": "ComfyNumberConvert", "inputs": { "value": ["missing", 0] }, "widgets_values": [42] },
        "2": { "class_type": "Consumer", "inputs": { "number": ["1", 2] } },
        "3": { "class_type": "Consumer", "_resolved_inputs": { "number": "1" } },
        "4": { "class_type": "ComfyNumberConvert", "inputs": { "value": ["5", 1] } },
        "5": { "class_type": "ComfyNumberConvert", "inputs": { "value": ["4", 1] } },
        "6": { "class_type": "Consumer", "inputs": { "number": ["4", 1] } }
    }));
    for node_id in ["2", "3", "6"] {
        let consumer = graph.get_node(node_id).expect("consumer node");
        assert_eq!(
            evaluate_number_link_first(&graph, consumer, "number", i64::MAX),
            None
        );
    }
}

#[test]
fn pinned_ideogram_profile_resolves_deterministic_scheduler_values() {
    let chunks: HashMap<String, String> = serde_json::from_str(include_str!(
        "fixtures/official_catalog/image_ideogram4_t2i.chunks.json"
    ))
    .expect("Ideogram chunks should be valid JSON");
    let graph = ComfyGraph::from_chunks(&chunks);
    let (combo_id, _) = graph
        .nodes
        .iter()
        .find(|(_, node)| {
            get_node_type(node) == "CustomCombo"
                && node
                    .get("widgets_values")
                    .and_then(Value::as_array)
                    .and_then(|values| values.first())
                    .and_then(Value::as_str)
                    == Some("Default")
        })
        .expect("selected Ideogram profile combo");
    let scheduler = graph
        .nodes
        .values()
        .find(|node| get_node_type(node) == "Ideogram4Scheduler")
        .expect("Ideogram scheduler");

    assert_eq!(
        evaluate_string_node(&graph, combo_id).as_deref(),
        Some("Default")
    );
    assert_eq!(
        evaluate_number_link_first(&graph, scheduler, "steps", 1_000),
        Some(20)
    );
    assert_eq!(
        evaluate_float_link_first(&graph, scheduler, "mu", 100.0),
        Some(0.0)
    );
    assert_eq!(
        evaluate_float_link_first(&graph, scheduler, "std", 100.0),
        Some(1.75)
    );
}
