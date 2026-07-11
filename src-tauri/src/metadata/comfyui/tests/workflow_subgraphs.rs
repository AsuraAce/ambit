use super::super::diagnostics::{ComfyMetadataField, ComfyParseLayer};
use super::super::workflow_normalizer::{normalize_workflow_with_test_limits, normalized_node_ids};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use serde_json::{json, Value};
use std::collections::HashMap;

const KREA_FIXTURE: &str =
    include_str!("fixtures/real_world/krea2_turbo_official_template.chunks.json");

fn chunks_from_workflow(workflow: Value) -> HashMap<String, String> {
    HashMap::from([("workflow".to_string(), workflow.to_string())])
}

fn basic_definition(id: &str, model: &str, seed: i64) -> Value {
    json!({
        "id": id,
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [{ "name": "seed", "type": "INT" }],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [
            {
                "id": 1,
                "type": "CheckpointLoaderSimple",
                "inputs": [],
                "widgets_values": [format!("{model}.safetensors")]
            },
            {
                "id": 2,
                "type": "CLIPTextEncode",
                "inputs": [],
                "widgets_values": ["subgraph positive"]
            },
            {
                "id": 3,
                "type": "CLIPTextEncode",
                "inputs": [],
                "widgets_values": ["subgraph negative"]
            },
            {
                "id": 4,
                "type": "KSampler",
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 1 },
                    { "name": "positive", "type": "CONDITIONING", "link": 2 },
                    { "name": "negative", "type": "CONDITIONING", "link": 3 },
                    { "name": "latent_image", "type": "LATENT", "link": null },
                    { "name": "seed", "type": "INT", "widget": { "name": "seed" }, "link": 4 }
                ],
                "widgets_values": [seed, "fixed", 8, 1.0, "euler", "simple", 1.0]
            },
            {
                "id": 5,
                "type": "VAEDecode",
                "inputs": [{ "name": "samples", "type": "LATENT", "link": 5 }],
                "widgets_values": []
            }
        ],
        "links": [
            { "id": 1, "origin_id": 1, "origin_slot": 0, "target_id": 4, "target_slot": 0, "type": "MODEL" },
            { "id": 2, "origin_id": 2, "origin_slot": 0, "target_id": 4, "target_slot": 1, "type": "CONDITIONING" },
            { "id": 3, "origin_id": 3, "origin_slot": 0, "target_id": 4, "target_slot": 2, "type": "CONDITIONING" },
            { "id": 4, "origin_id": -10, "origin_slot": 0, "target_id": 4, "target_slot": 4, "type": "INT" },
            { "id": 5, "origin_id": 4, "origin_slot": 0, "target_id": 5, "target_slot": 0, "type": "LATENT" },
            { "id": 6, "origin_id": 5, "origin_slot": 0, "target_id": -20, "target_slot": 0, "type": "IMAGE" }
        ]
    })
}

fn instance(id: i64, definition: &str, seed_override: Option<i64>, mode: i64) -> Value {
    json!({
        "id": id,
        "type": definition,
        "mode": mode,
        "inputs": [
            { "name": "seed", "type": "INT", "widget": { "name": "seed" }, "link": null }
        ],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [] }],
        "properties": { "proxyWidgets": [["4", "seed"]] },
        "widgets_values": seed_override.into_iter().collect::<Vec<_>>()
    })
}

fn save_node(id: i64, link: i64) -> Value {
    json!({
        "id": id,
        "type": "SaveImage",
        "mode": 0,
        "inputs": [{ "name": "images", "type": "IMAGE", "link": link }],
        "outputs": [],
        "widgets_values": ["subgraph"]
    })
}

fn single_instance_workflow(seed_override: Option<i64>, external_seed: Option<i64>) -> Value {
    let mut nodes = vec![instance(30, "basic", seed_override, 0), save_node(40, 1)];
    let mut links = vec![json!([1, 30, 0, 40, 0, "IMAGE"])];
    if let Some(seed) = external_seed {
        nodes.push(json!({
            "id": 20,
            "type": "PrimitiveInt",
            "inputs": [],
            "outputs": [{ "name": "INT", "type": "INT", "links": [2] }],
            "widgets_values": [seed]
        }));
        nodes[0]["inputs"][0]["link"] = json!(2);
        links.push(json!([2, 20, 0, 30, 0, "INT"]));
    }

    json!({
        "nodes": nodes,
        "links": links,
        "definitions": { "subgraphs": [basic_definition("basic", "subgraph-model", 11)] },
        "version": 0.4
    })
}

fn assert_traversal_source(
    diagnostics: &super::super::diagnostics::ComfyParseDiagnostics,
    field: ComfyMetadataField,
) {
    assert_eq!(
        diagnostics.field_sources.get(&field),
        Some(&ComfyParseLayer::SamplerTraversal)
    );
}

#[test]
fn krea_workflow_only_expands_official_subgraph_metadata() {
    let raw: HashMap<String, Value> =
        serde_json::from_str(KREA_FIXTURE).expect("Krea chunk fixture");
    let workflow = raw
        .get("workflow")
        .and_then(Value::as_str)
        .expect("Krea workflow chunk");
    let workflow_json: Value = serde_json::from_str(workflow).expect("Krea workflow JSON");
    let expected_prompt = workflow_json["definitions"]["subgraphs"][0]["nodes"]
        .as_array()
        .and_then(|nodes| nodes.iter().find(|node| node["id"] == 19))
        .and_then(|node| node["widgets_values"][0].as_str())
        .expect("Krea user prompt")
        .to_string();
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
    let normalized_ids = normalized_node_ids(&workflow_json);

    assert_eq!(meta.model, "krea2_turbo_fp8_scaled");
    assert_eq!(meta.seed, Some(552_211_234_818_773));
    assert_eq!(meta.steps, 8);
    assert_eq!(meta.cfg, 1.0);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, expected_prompt);
    assert_eq!(meta.negative_prompt, "");
    assert_eq!(meta.workflow_json.as_deref(), Some(workflow));
    assert!(meta.has_workflow_hint);
    assert!(normalized_ids.len() > 5);
    assert!(normalized_ids.contains("30:3"));
    assert!(normalized_ids.contains("30:19"));
    assert!(normalized_ids.contains("29"));
    assert!(!normalized_ids.contains("30"));
    assert_eq!(diagnostics.graph_node_count, normalized_ids.len());
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_traversal_source(&diagnostics, field);
    }
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::WorkflowJson),
        Some(&ComfyParseLayer::WorkflowChunk)
    );
}

#[test]
fn subgraph_inputs_use_defaults_then_proxy_then_external_link() {
    for (workflow, expected_seed) in [
        (single_instance_workflow(None, None), 11),
        (single_instance_workflow(Some(77), None), 77),
        (single_instance_workflow(Some(77), Some(99)), 99),
    ] {
        let (meta, diagnostics) =
            extract_comfyui_metadata_with_diagnostics(&chunks_from_workflow(workflow));
        assert_eq!(meta.model, "subgraph_model");
        assert_eq!(meta.seed, Some(expected_seed));
        assert_traversal_source(&diagnostics, ComfyMetadataField::Seed);
    }
}

#[test]
fn repeated_subgraph_instances_keep_namespaced_nodes_distinct() {
    let workflow = json!({
        "nodes": [
            instance(30, "basic", Some(30), 0),
            instance(31, "basic", Some(31), 0),
            save_node(40, 1),
            save_node(41, 2)
        ],
        "links": [
            [1, 30, 0, 40, 0, "IMAGE"],
            [2, 31, 0, 41, 0, "IMAGE"]
        ],
        "definitions": { "subgraphs": [basic_definition("basic", "subgraph-model", 11)] }
    });
    let ids = normalized_node_ids(&workflow);
    assert!(ids.contains("30:4"));
    assert!(ids.contains("31:4"));

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_from_workflow(workflow));
    assert!(diagnostics.output_ambiguous);
    assert_eq!(diagnostics.unique_output_root_sampler_count, 2);
    assert_eq!(meta.seed, Some(30));
    assert_eq!(
        diagnostics.field_sources.get(&ComfyMetadataField::Seed),
        Some(&ComfyParseLayer::SamplerFallback)
    );
}

#[test]
fn nested_subgraph_output_reaches_root_sampler() {
    let outer = json!({
        "id": "outer",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [{
            "id": 7,
            "type": "basic",
            "mode": 0,
            "inputs": [{ "name": "seed", "type": "INT", "widget": { "name": "seed" }, "link": null }],
            "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [1] }],
            "properties": { "proxyWidgets": [["4", "seed"]] },
            "widgets_values": [71]
        }],
        "links": [
            { "id": 1, "origin_id": 7, "origin_slot": 0, "target_id": -20, "target_slot": 0, "type": "IMAGE" }
        ]
    });
    let workflow = json!({
        "nodes": [
            { "id": 30, "type": "outer", "mode": 0, "inputs": [], "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [1] }] },
            save_node(40, 1)
        ],
        "links": [[1, 30, 0, 40, 0, "IMAGE"]],
        "definitions": { "subgraphs": [basic_definition("basic", "nested-model", 11), outer] }
    });

    let ids = normalized_node_ids(&workflow);
    assert!(ids.contains("30:7:4"));
    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_from_workflow(workflow));
    assert_eq!(meta.model, "nested_model");
    assert_eq!(meta.seed, Some(71));
    assert_traversal_source(&diagnostics, ComfyMetadataField::Model);
}

#[test]
fn inactive_cyclic_and_malformed_subgraphs_do_not_gain_traversal_authority() {
    let cyclic = json!({
        "id": "cycle",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [{ "id": 7, "type": "cycle", "mode": 0, "inputs": [], "outputs": [{ "name": "IMAGE", "type": "IMAGE" }] }],
        "links": [{ "origin_id": 7, "origin_slot": 0, "target_id": -20, "target_slot": 0, "type": "IMAGE" }]
    });
    let malformed = json!({
        "id": "malformed",
        "inputNode": { "id": -10 },
        "inputs": [],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [],
        "links": []
    });

    for (definition, node) in [
        (
            basic_definition("basic", "muted-model", 11),
            instance(30, "basic", None, 2),
        ),
        (
            basic_definition("basic", "bypassed-model", 11),
            instance(30, "basic", None, 4),
        ),
        (cyclic, instance(30, "cycle", None, 0)),
        (malformed, instance(30, "malformed", None, 0)),
    ] {
        let workflow = json!({
            "nodes": [node, save_node(40, 1)],
            "links": [[1, 30, 0, 40, 0, "IMAGE"]],
            "definitions": { "subgraphs": [definition] }
        });
        let (meta, diagnostics) =
            extract_comfyui_metadata_with_diagnostics(&chunks_from_workflow(workflow));
        assert_eq!(meta.model, "Unknown");
        assert_eq!(diagnostics.unique_output_root_sampler_count, 0);
        assert_ne!(
            diagnostics.field_sources.get(&ComfyMetadataField::Model),
            Some(&ComfyParseLayer::SamplerTraversal)
        );
    }
}

#[test]
fn inactive_subgraph_cannot_pass_an_image_source_to_saved_output_traversal() {
    let passthrough = json!({
        "id": "passthrough",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [{ "name": "image", "type": "IMAGE" }],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [],
        "links": [{ "origin_id": -10, "origin_slot": 0, "target_id": -20, "target_slot": 0, "type": "IMAGE" }]
    });
    let workflow = json!({
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "inputs": [], "widgets_values": ["weak-model.safetensors"] },
            {
                "id": 2,
                "type": "KSampler",
                "inputs": [{ "name": "model", "type": "MODEL", "link": 1 }],
                "widgets_values": [22, "fixed", 4, 1.0, "euler", "simple", 1.0]
            },
            {
                "id": 30,
                "type": "passthrough",
                "mode": 2,
                "inputs": [{ "name": "image", "type": "IMAGE", "link": 2 }],
                "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [3] }]
            },
            save_node(40, 3)
        ],
        "links": [
            [1, 1, 0, 2, 0, "MODEL"],
            [2, 2, 0, 30, 0, "IMAGE"],
            [3, 30, 0, 40, 0, "IMAGE"]
        ],
        "definitions": { "subgraphs": [passthrough] }
    });

    let (_, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_from_workflow(workflow));
    assert_eq!(diagnostics.unique_output_root_sampler_count, 0);
    assert_ne!(
        diagnostics.field_sources.get(&ComfyMetadataField::Model),
        Some(&ComfyParseLayer::SamplerTraversal)
    );
}

#[test]
fn branching_subgraphs_stop_at_the_shared_node_budget() {
    fn branch_definition(id: &str, child: Option<&str>) -> Value {
        let nodes = child.map_or_else(Vec::new, |child| {
            (1..=4)
                .map(|node_id| {
                    json!({
                        "id": node_id,
                        "type": child,
                        "mode": 0,
                        "inputs": [],
                        "outputs": []
                    })
                })
                .collect()
        });
        json!({
            "id": id,
            "inputNode": { "id": -10 },
            "outputNode": { "id": -20 },
            "inputs": [],
            "outputs": [],
            "nodes": nodes,
            "links": []
        })
    }

    let workflow = json!({
        "nodes": [{ "id": 30, "type": "branch-a", "mode": 0, "inputs": [], "outputs": [] }],
        "links": [],
        "definitions": { "subgraphs": [
            branch_definition("branch-a", Some("branch-b")),
            branch_definition("branch-b", Some("branch-c")),
            branch_definition("branch-c", Some("branch-leaf")),
            branch_definition("branch-leaf", None)
        ] }
    });

    let normalized = normalize_workflow_with_test_limits(&workflow, 20, 1_000, 1_000_000)
        .expect("the top-level workflow should remain available");
    assert!(normalized.nodes.len() <= 20);
    assert!(normalized.nodes.iter().any(|node| {
        node.get("type")
            .and_then(Value::as_str)
            .is_some_and(|node_type| node_type.starts_with("branch-"))
    }));
}

#[test]
fn constrained_expansion_uses_deterministic_numeric_instance_order() {
    let definition = json!({
        "id": "limited",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [],
        "outputs": [],
        "nodes": [
            { "id": 1, "type": "PrimitiveInt", "inputs": [], "widgets_values": [1] },
            { "id": 2, "type": "PreviewAny", "inputs": [], "widgets_values": [] }
        ],
        "links": [[1, 1, 0, 2, 0, "*"]]
    });
    let workflow = json!({
        "nodes": [
            { "id": 10, "type": "limited", "mode": 0, "inputs": [], "outputs": [] },
            { "id": 2, "type": "limited", "mode": 0, "inputs": [], "outputs": [] }
        ],
        "links": [],
        "definitions": { "subgraphs": [definition] }
    });

    let normalize = || {
        let normalized = normalize_workflow_with_test_limits(&workflow, 4, 100, 1_000_000)
            .expect("the top-level workflow should remain available");
        let mut node_ids = normalized
            .nodes
            .iter()
            .filter_map(|node| node.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>();
        node_ids.sort();
        let mut edges = normalized
            .edges
            .iter()
            .map(|edge| {
                format!(
                    "{}:{}>{}:{}:{}",
                    edge.source_id,
                    edge.source_slot,
                    edge.target_id,
                    edge.target_slot,
                    edge.link_type
                )
            })
            .collect::<Vec<_>>();
        edges.sort();
        (node_ids, edges)
    };

    let first = normalize();
    let second = normalize();
    assert_eq!(first, second);
    assert_eq!(first.0, vec!["10", "2:1", "2:2"]);
    assert_eq!(first.1, vec!["2:1:0>2:2:0:*"]);
}

#[test]
fn subgraph_edge_fanout_stops_at_the_shared_edge_budget() {
    let definition = json!({
        "id": "fanout",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [{ "id": 1, "type": "PreviewImage", "inputs": [], "outputs": [] }],
        "links": (1..=20)
            .map(|link_id| json!([link_id, 1, 0, -20, 0, "IMAGE"]))
            .collect::<Vec<_>>()
    });
    let workflow = json!({
        "nodes": [
            { "id": 30, "type": "fanout", "mode": 0, "inputs": [], "outputs": [{ "name": "IMAGE", "type": "IMAGE" }] },
            save_node(40, 1)
        ],
        "links": [[1, 30, 0, 40, 0, "IMAGE"]],
        "definitions": { "subgraphs": [definition] }
    });

    let normalized = normalize_workflow_with_test_limits(&workflow, 100, 10, 1_000_000)
        .expect("the rejected subgraph should remain opaque");
    assert!(normalized
        .nodes
        .iter()
        .any(|node| node.get("id") == Some(&json!("30"))));
    assert!(!normalized
        .nodes
        .iter()
        .any(|node| node.get("id") == Some(&json!("30:1"))));
}

#[test]
fn oversized_subgraph_payload_is_rejected_and_blocks_incoming_traversal() {
    let definition = json!({
        "id": "oversized",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [{ "name": "image", "type": "IMAGE" }],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [{
            "id": 1,
            "type": "PreviewAny",
            "inputs": [],
            "widgets_values": ["x".repeat(8_192)]
        }],
        "links": [
            [1, -10, 0, 1, 0, "IMAGE"],
            [2, 1, 0, -20, 0, "IMAGE"]
        ]
    });
    let workflow = json!({
        "nodes": [
            { "id": 2, "type": "KSampler", "inputs": [], "widgets_values": [22, "fixed", 4, 1.0, "euler", "simple", 1.0] },
            {
                "id": 30,
                "type": "oversized",
                "mode": 0,
                "inputs": [{ "name": "image", "type": "IMAGE", "link": 2 }],
                "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [3] }]
            },
            save_node(40, 3)
        ],
        "links": [
            [2, 2, 0, 30, 0, "IMAGE"],
            [3, 30, 0, 40, 0, "IMAGE"]
        ],
        "definitions": { "subgraphs": [definition] }
    });

    let normalized = normalize_workflow_with_test_limits(&workflow, 100, 100, 4_096)
        .expect("the rejected subgraph should leave the outer graph usable");
    assert!(normalized
        .nodes
        .iter()
        .any(|node| node.get("id") == Some(&json!("30"))));
    assert!(!normalized
        .nodes
        .iter()
        .any(|node| node.get("id") == Some(&json!("30:1"))));
    assert!(!normalized.edges.iter().any(|edge| edge.target_id == "30"));
}

#[test]
fn oversized_subgraph_edge_is_rejected_and_blocks_incoming_traversal() {
    let definition = json!({
        "id": "oversized-edge",
        "inputNode": { "id": -10 },
        "outputNode": { "id": -20 },
        "inputs": [{ "name": "image", "type": "IMAGE" }],
        "outputs": [{ "name": "IMAGE", "type": "IMAGE" }],
        "nodes": [{ "id": 1, "type": "PreviewAny", "inputs": [], "widgets_values": [] }],
        "links": [
            [1, -10, 0, 1, 0, "x".repeat(8_192)],
            [2, 1, 0, -20, 0, "IMAGE"]
        ]
    });
    let workflow = json!({
        "nodes": [
            { "id": 2, "type": "KSampler", "inputs": [], "widgets_values": [22, "fixed", 4, 1.0, "euler", "simple", 1.0] },
            {
                "id": 30,
                "type": "oversized-edge",
                "mode": 0,
                "inputs": [{ "name": "image", "type": "IMAGE", "link": 2 }],
                "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [3] }]
            },
            save_node(40, 3)
        ],
        "links": [
            [2, 2, 0, 30, 0, "IMAGE"],
            [3, 30, 0, 40, 0, "IMAGE"]
        ],
        "definitions": { "subgraphs": [definition] }
    });

    let normalized = normalize_workflow_with_test_limits(&workflow, 100, 100, 4_096)
        .expect("the rejected subgraph should leave the outer graph usable");
    assert!(normalized
        .nodes
        .iter()
        .any(|node| node.get("id") == Some(&json!("30"))));
    assert!(!normalized
        .nodes
        .iter()
        .any(|node| node.get("id") == Some(&json!("30:1"))));
    assert!(!normalized.edges.iter().any(|edge| edge.target_id == "30"));
}

#[test]
fn api_prompt_graph_remains_authoritative() {
    let workflow = single_instance_workflow(Some(77), None);
    let prompt = json!({
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "prompt-model.safetensors" } },
        "2": { "class_type": "KSampler", "inputs": { "model": ["1", 0], "seed": 22, "steps": 4, "cfg": 2.0, "sampler_name": "euler", "scheduler": "simple" } },
        "3": { "class_type": "SaveImage", "inputs": { "images": ["2", 0] } }
    });
    let chunks = HashMap::from([
        ("workflow".to_string(), workflow.to_string()),
        ("prompt".to_string(), prompt.to_string()),
    ]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);
    assert_eq!(meta.model, "prompt_model");
    assert_eq!(meta.seed, Some(22));
    assert_eq!(diagnostics.graph_node_count, 3);
    assert_traversal_source(&diagnostics, ComfyMetadataField::Model);
}
