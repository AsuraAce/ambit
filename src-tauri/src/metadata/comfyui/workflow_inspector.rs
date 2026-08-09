use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::graph::{
    compare_node_ids, get_input_source, get_input_source_by_slot, get_node_title, get_node_type,
    get_source_id, parse_prompt_chunk, ComfyGraph, ComfyGraphSource, InputSourceConnection,
};

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComfyWorkflowDisplayNode {
    pub id: String,
    pub node_type: String,
    pub title: String,
    pub inputs: BTreeMap<String, String>,
    pub subgraph_path: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComfyWorkflowDisplayEdge {
    pub source_node_id: String,
    pub source_output_slot: Option<usize>,
    pub target_node_id: String,
    pub target_input_name: String,
    pub target_input_slot: Option<usize>,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComfyWorkflowGraphReport {
    pub source: String,
    pub node_count: usize,
    pub nodes: Vec<ComfyWorkflowDisplayNode>,
    pub edges: Vec<ComfyWorkflowDisplayEdge>,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_comfyui_workflow_graph(
    chunks: HashMap<String, String>,
) -> Result<ComfyWorkflowGraphReport, String> {
    Ok(build_comfyui_workflow_graph_report(&chunks))
}

pub(crate) fn build_comfyui_workflow_graph_report(
    chunks: &HashMap<String, String>,
) -> ComfyWorkflowGraphReport {
    let graph = if chunks.contains_key("prompt") && !has_valid_api_prompt(chunks) {
        let workflow_chunks = chunks
            .get("workflow")
            .map(|workflow| HashMap::from([("workflow".to_string(), workflow.clone())]))
            .unwrap_or_default();
        ComfyGraph::from_chunks(&workflow_chunks)
    } else {
        ComfyGraph::from_chunks(chunks)
    };
    let edges = display_edges(&graph);
    let mut nodes: Vec<(&String, &Value)> = graph.nodes().iter().collect();
    nodes.sort_by(|(left_id, _), (right_id, _)| compare_node_ids(left_id, right_id));

    let nodes = nodes
        .into_iter()
        .map(|(id, node)| {
            let node_type = get_node_type(node);
            ComfyWorkflowDisplayNode {
                id: id.clone(),
                node_type: if node_type.is_empty() {
                    "Unknown".to_string()
                } else {
                    node_type.to_string()
                },
                title: get_node_title(node)
                    .filter(|title| !title.is_empty())
                    .unwrap_or_else(|| {
                        if node_type.is_empty() {
                            "Unknown"
                        } else {
                            node_type
                        }
                    })
                    .to_string(),
                inputs: display_inputs(node),
                subgraph_path: subgraph_path(id),
            }
        })
        .collect::<Vec<_>>();

    ComfyWorkflowGraphReport {
        source: match graph.source() {
            ComfyGraphSource::None => "none",
            ComfyGraphSource::ApiPrompt => "api_prompt",
            ComfyGraphSource::ExpandedWorkflow => "expanded_workflow",
        }
        .to_string(),
        node_count: nodes.len(),
        nodes,
        edges,
    }
}

fn display_edges(graph: &ComfyGraph) -> Vec<ComfyWorkflowDisplayEdge> {
    let mut edges = Vec::new();

    for (target_id, node) in graph.nodes() {
        match node.get("inputs") {
            Some(Value::Object(inputs)) => {
                for input_name in inputs.keys() {
                    push_display_edge(
                        graph,
                        &mut edges,
                        target_id,
                        input_name,
                        None,
                        get_input_source(node, input_name),
                    );
                }
            }
            Some(Value::Array(inputs)) => {
                for (input_slot, input) in inputs.iter().enumerate() {
                    let input_name = input
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("input_{input_slot}"));
                    push_display_edge(
                        graph,
                        &mut edges,
                        target_id,
                        &input_name,
                        Some(input_slot),
                        get_input_source_by_slot(node, input_slot),
                    );
                }
            }
            _ => {}
        }

        if get_node_type(node) == "GetNode" {
            push_display_edge(
                graph,
                &mut edges,
                target_id,
                "source",
                None,
                get_input_source(node, "source"),
            );
        }
    }

    edges.sort_by(compare_display_edges);
    edges.dedup();
    edges
}

fn push_display_edge(
    graph: &ComfyGraph,
    edges: &mut Vec<ComfyWorkflowDisplayEdge>,
    target_id: &str,
    target_input_name: &str,
    target_input_slot: Option<usize>,
    connection: InputSourceConnection,
) {
    let (source_node_id, source_output_slot) = match connection {
        InputSourceConnection::Connected(source) => (source.node_id, source.output_slot),
        InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {
            let Some(source_node_id) = get_source_id(graph, target_id, target_input_name) else {
                return;
            };
            (source_node_id, None)
        }
    };
    if !graph.nodes().contains_key(&source_node_id) {
        return;
    }

    edges.push(ComfyWorkflowDisplayEdge {
        source_node_id,
        source_output_slot,
        target_node_id: target_id.to_string(),
        target_input_name: target_input_name.to_string(),
        target_input_slot,
    });
}

fn compare_display_edges(
    left: &ComfyWorkflowDisplayEdge,
    right: &ComfyWorkflowDisplayEdge,
) -> Ordering {
    compare_node_ids(&left.target_node_id, &right.target_node_id)
        .then_with(|| left.target_input_slot.cmp(&right.target_input_slot))
        .then_with(|| left.target_input_name.cmp(&right.target_input_name))
        .then_with(|| compare_node_ids(&left.source_node_id, &right.source_node_id))
        .then_with(|| left.source_output_slot.cmp(&right.source_output_slot))
}

fn has_valid_api_prompt(chunks: &HashMap<String, String>) -> bool {
    let Some(prompt) = chunks.get("prompt") else {
        return false;
    };
    let Some(Value::Object(nodes)) = parse_prompt_chunk(prompt) else {
        return false;
    };
    if nodes.is_empty() {
        return false;
    }

    let node_count = nodes
        .values()
        .filter(|node| {
            node.as_object().is_some_and(|node| {
                [
                    "class_type",
                    "type",
                    "node_type",
                    "inputs",
                    "widgets_values",
                    "data",
                ]
                .iter()
                .any(|key| node.contains_key(*key))
            })
        })
        .count();

    node_count > 0 && node_count * 2 > nodes.len()
}

fn display_inputs(node: &Value) -> BTreeMap<String, String> {
    if let Some(inputs) = node.get("inputs").and_then(Value::as_object) {
        return inputs
            .iter()
            .filter_map(|(name, value)| display_value(value).map(|value| (name.clone(), value)))
            .collect();
    }

    node.get("widgets_values")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, value)| {
            display_value(value).map(|value| (format!("widget_{index}"), value))
        })
        .collect()
}

fn display_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => Some("null".to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::String(value) => Some(value.clone()),
        Value::Array(values) => serde_json::to_string(values).ok(),
        Value::Object(_) => None,
    }
}

fn subgraph_path(node_id: &str) -> Vec<String> {
    let mut segments = node_id.split(':').map(str::to_string).collect::<Vec<_>>();
    if segments.len() > 1 {
        segments.pop();
        segments
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const KREA_FIXTURE: &str =
        include_str!("tests/fixtures/real_world/krea2_turbo_official_template.chunks.json");

    fn krea_chunks() -> HashMap<String, String> {
        serde_json::from_str(KREA_FIXTURE).expect("Krea fixture should be valid")
    }

    #[test]
    fn workflow_only_krea_expands_and_groups_internal_nodes() {
        let mut chunks = krea_chunks();
        chunks.remove("prompt");

        let report = build_comfyui_workflow_graph_report(&chunks);

        assert_eq!(report.source, "expanded_workflow");
        assert_eq!(report.node_count, report.nodes.len());
        assert!(report.node_count > 6);
        assert!(report
            .nodes
            .iter()
            .any(|node| { node.id == "30:19" && node.subgraph_path == ["30"] }));
        assert!(report
            .nodes
            .iter()
            .any(|node| node.id == "29" && node.subgraph_path.is_empty()));
        assert!(report
            .edges
            .iter()
            .any(|edge| { edge.source_node_id.starts_with("30:") && edge.target_node_id == "29" }));
    }

    #[test]
    fn prompt_backed_krea_prefers_the_api_graph() {
        let report = build_comfyui_workflow_graph_report(&krea_chunks());

        assert_eq!(report.source, "api_prompt");
        assert!(report.nodes.iter().any(|node| node.id == "30:19"));
    }

    #[test]
    fn unrelated_prompt_json_falls_back_to_the_workflow_graph() {
        let chunks = HashMap::from([
            (
                "prompt".to_string(),
                json!({ "text": "not an API graph" }).to_string(),
            ),
            (
                "workflow".to_string(),
                json!({
                    "nodes": [{ "id": 2, "type": "SaveImage", "inputs": [], "widgets_values": [] }],
                    "links": []
                })
                .to_string(),
            ),
        ]);

        let report = build_comfyui_workflow_graph_report(&chunks);

        assert_eq!(report.source, "expanded_workflow");
        assert_eq!(report.nodes.len(), 1);
        assert_eq!(report.nodes[0].id, "2");
    }

    #[test]
    fn report_order_paths_and_display_inputs_are_deterministic() {
        let chunks = HashMap::from([(
            "prompt".to_string(),
            json!({
                "30:7:4": { "class_type": "Nested", "inputs": { "enabled": true } },
                "10": { "class_type": "Ten", "inputs": {} },
                "2": {
                    "class_type": "Two",
                    "_meta": { "title": "Second" },
                    "inputs": { "seed": 42, "connection": [10, 0], "complex": { "skip": true } }
                },
                "30:19": { "class_type": "Prompt", "inputs": { "text": "hello" } }
            })
            .to_string(),
        )]);

        let first = build_comfyui_workflow_graph_report(&chunks);
        let second = build_comfyui_workflow_graph_report(&chunks);

        assert_eq!(first, second);
        assert_eq!(
            first
                .nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>(),
            ["2", "10", "30:19", "30:7:4"]
        );
        assert_eq!(first.nodes[0].title, "Second");
        assert_eq!(
            first.nodes[0].inputs.get("seed").map(String::as_str),
            Some("42")
        );
        assert_eq!(
            first.nodes[0].inputs.get("connection").map(String::as_str),
            Some("[10,0]")
        );
        assert!(!first.nodes[0].inputs.contains_key("complex"));
        assert_eq!(first.nodes[2].subgraph_path, ["30"]);
        assert_eq!(first.nodes[3].subgraph_path, ["30", "7"]);
        assert_eq!(
            first.edges,
            [ComfyWorkflowDisplayEdge {
                source_node_id: "10".to_string(),
                source_output_slot: Some(0),
                target_node_id: "2".to_string(),
                target_input_name: "connection".to_string(),
                target_input_slot: None,
            }]
        );
    }

    #[test]
    fn report_edges_are_deduplicated_ordered_and_require_existing_endpoints() {
        let chunks = HashMap::from([(
            "prompt".to_string(),
            json!({
                "20": { "class_type": "Target", "inputs": { "second": [10, 1], "missing": [99, 0] } },
                "3": { "class_type": "Target", "inputs": { "first": [10, 0] } },
                "10": { "class_type": "Source", "inputs": {} }
            })
            .to_string(),
        )]);

        let first = build_comfyui_workflow_graph_report(&chunks);
        let second = build_comfyui_workflow_graph_report(&chunks);

        assert_eq!(first.edges, second.edges);
        assert_eq!(
            first.edges,
            [
                ComfyWorkflowDisplayEdge {
                    source_node_id: "10".to_string(),
                    source_output_slot: Some(0),
                    target_node_id: "3".to_string(),
                    target_input_name: "first".to_string(),
                    target_input_slot: None,
                },
                ComfyWorkflowDisplayEdge {
                    source_node_id: "10".to_string(),
                    source_output_slot: Some(1),
                    target_node_id: "20".to_string(),
                    target_input_name: "second".to_string(),
                    target_input_slot: None,
                },
            ]
        );
    }

    #[test]
    fn resolved_get_node_connections_are_visible_without_inventing_input_slots() {
        let chunks = HashMap::from([(
            "workflow".to_string(),
            json!({
                "nodes": [
                    { "id": 1, "type": "CheckpointLoaderSimple", "mode": 0, "inputs": [], "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [100], "slot_index": 0 }] },
                    { "id": 2, "type": "SetNode", "mode": 0, "inputs": [{ "name": "MODEL", "type": "MODEL", "link": 100 }], "outputs": [], "widgets_values": ["model"] },
                    { "id": 3, "type": "GetNode", "mode": 0, "inputs": [], "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [] }], "widgets_values": ["model"] }
                ],
                "links": [[100, 1, 0, 2, 0, "MODEL"]]
            })
            .to_string(),
        )]);

        let report = build_comfyui_workflow_graph_report(&chunks);

        assert!(report.edges.contains(&ComfyWorkflowDisplayEdge {
            source_node_id: "1".to_string(),
            source_output_slot: Some(0),
            target_node_id: "3".to_string(),
            target_input_name: "source".to_string(),
            target_input_slot: None,
        }));
    }

    #[test]
    fn uniquely_resolved_wireless_inputs_are_visible_without_guessing_a_slot() {
        let chunks = HashMap::from([(
            "workflow".to_string(),
            json!({
                "nodes": [
                    { "id": 1, "type": "CheckpointLoaderSimple", "mode": 0, "inputs": [], "outputs": [] },
                    { "id": 4, "type": "KSampler", "mode": 0, "inputs": [{ "name": "model", "type": "MODEL", "link": null }], "outputs": [] }
                ],
                "links": []
            })
            .to_string(),
        )]);

        let report = build_comfyui_workflow_graph_report(&chunks);

        assert_eq!(
            report.edges,
            [ComfyWorkflowDisplayEdge {
                source_node_id: "1".to_string(),
                source_output_slot: None,
                target_node_id: "4".to_string(),
                target_input_name: "model".to_string(),
                target_input_slot: Some(0),
            }]
        );
    }

    #[test]
    fn malformed_and_cyclic_workflows_remain_safe_and_opaque() {
        let chunks = HashMap::from([(
            "workflow".to_string(),
            json!({
                "nodes": [
                    { "id": 30, "type": "cycle", "mode": 0, "inputs": [], "outputs": [] },
                    { "id": 40, "type": "SaveImage", "mode": 0, "inputs": [] }
                ],
                "links": [],
                "definitions": { "subgraphs": [{
                    "id": "cycle",
                    "nodes": [{ "id": 1, "type": "cycle", "mode": 0, "inputs": [], "outputs": [] }],
                    "links": [],
                    "inputs": [],
                    "outputs": []
                }] }
            })
            .to_string(),
        )]);

        let report = build_comfyui_workflow_graph_report(&chunks);

        assert_eq!(report.source, "expanded_workflow");
        assert!(report.nodes.iter().all(|node| !node.id.starts_with("30:")));
    }
}
