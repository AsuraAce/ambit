use crate::metadata::comfyui::*;
use std::collections::HashMap;

use super::super::graph::{get_source_id, ComfyGraph, InputSourceConnection};
use super::super::heuristics::get_prompts_everywhere_source;

#[test]
fn prompts_everywhere_keeps_duplicate_ui_inputs_in_role_slots() {
    let workflow = r#"{
        "nodes": [
            {
                "id": 30,
                "type": "Prompts Everywhere",
                "inputs": [
                    {"name": "CONDITIONING", "type": "*", "link": null},
                    {"name": "CONDITIONING", "type": "*", "link": 202}
                ]
            },
            {"id": 20, "type": "CLIPTextEncode", "widgets_values": ["negative only"]}
        ],
        "links": [[202, 20, 0, 30, 1, "CONDITIONING"]]
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let graph = ComfyGraph::from_chunks(&chunks);
    let broadcaster = graph.get_node("30").expect("broadcaster should exist");

    assert_eq!(
        get_prompts_everywhere_source(broadcaster, "positive"),
        InputSourceConnection::Unconnected
    );
    assert!(matches!(
        get_prompts_everywhere_source(broadcaster, "negative"),
        InputSourceConnection::Connected(source) if source.node_id == "20" && source.output_slot == Some(0)
    ));
}

#[test]
fn prompts_everywhere_supports_named_api_role_inputs() {
    let prompt = r#"{
        "10": {"class_type": "CLIPTextEncode", "inputs": {"text": "api positive"}},
        "11": {"class_type": "CLIPTextEncode", "inputs": {"text": "api negative"}},
        "30": {
            "class_type": "Prompts Everywhere",
            "inputs": {"positive": ["10", 0], "negative": ["11", 0]}
        },
        "40": {
            "class_type": "KSampler",
            "inputs": {"positive": ["30", 0], "negative": ["30", 1]}
        }
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "api positive");
    assert_eq!(meta.negative_prompt, "api negative");
}

#[test]
fn direct_sampler_conditioning_beats_prompts_everywhere() {
    let workflow = r#"{
        "nodes": [
            {
                "id": 1,
                "type": "KSampler",
                "inputs": [
                    {"name": "positive", "type": "CONDITIONING", "link": 100},
                    {"name": "negative", "type": "CONDITIONING", "link": null}
                ]
            },
            {"id": 10, "type": "CLIPTextEncode", "widgets_values": ["direct positive"]},
            {
                "id": 30,
                "type": "Prompts Everywhere",
                "inputs": [
                    {"name": "CONDITIONING", "type": "*", "link": 101},
                    {"name": "CONDITIONING", "type": "*", "link": 102}
                ]
            },
            {"id": 11, "type": "CLIPTextEncode", "widgets_values": ["wireless positive"]},
            {"id": 12, "type": "CLIPTextEncode", "widgets_values": ["wireless negative"]}
        ],
        "links": [
            [100, 10, 0, 1, 0, "CONDITIONING"],
            [101, 11, 0, 30, 0, "CONDITIONING"],
            [102, 12, 0, 30, 1, "CONDITIONING"]
        ]
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "direct positive");
    assert_eq!(meta.negative_prompt, "wireless negative");
}

#[test]
fn unresolved_sampler_link_blocks_prompts_everywhere_fallback() {
    let workflow = r#"{
        "nodes": [
            {"id": 1, "type": "KSampler", "inputs": [{"name": "positive", "type": "CONDITIONING", "link": 999}]},
            {"id": 10, "type": "CLIPTextEncode", "widgets_values": ["wireless positive"]},
            {"id": 20, "type": "Prompts Everywhere", "inputs": [{"name": "CONDITIONING", "type": "*", "link": 100}]}
        ],
        "links": [[100, 10, 0, 20, 0, "CONDITIONING"]]
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let graph = ComfyGraph::from_chunks(&chunks);

    assert_eq!(get_source_id(&graph, "1", "positive"), None);
}

#[test]
fn disabled_or_conflicting_prompts_everywhere_nodes_do_not_guess() {
    let workflow = r#"{
        "nodes": [
            {"id": 1, "type": "KSampler", "inputs": [{"name": "positive", "type": "CONDITIONING", "link": null}]},
            {"id": 10, "type": "CLIPTextEncode", "widgets_values": ["first"]},
            {"id": 11, "type": "CLIPTextEncode", "widgets_values": ["second"]},
            {"id": 12, "type": "CLIPTextEncode", "widgets_values": ["disabled"]},
            {"id": 20, "type": "Prompts Everywhere", "inputs": [{"name": "CONDITIONING", "type": "*", "link": 100}]},
            {"id": 21, "type": "Prompts Everywhere", "inputs": [{"name": "CONDITIONING", "type": "*", "link": 101}]},
            {"id": 22, "type": "Prompts Everywhere", "mode": 4, "inputs": [{"name": "CONDITIONING", "type": "*", "link": 102}]}
        ],
        "links": [
            [100, 10, 0, 20, 0, "CONDITIONING"],
            [101, 11, 0, 21, 0, "CONDITIONING"],
            [102, 12, 0, 22, 0, "CONDITIONING"]
        ]
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let graph = ComfyGraph::from_chunks(&chunks);
    let sampler = graph.get_node("1").expect("sampler should exist");

    assert_eq!(
        super::super::heuristics::find_wireless_node(&graph, sampler, "positive"),
        None
    );
}

#[test]
fn inspire_ksampler_supports_api_inputs_and_exact_workflow_widgets() {
    let prompt = r#"{
        "1": {
            "class_type": "KSampler //Inspire",
            "inputs": {
                "seed": 12345,
                "steps": 24,
                "cfg": 6.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 0.75
            }
        }
    }"#;
    let workflow = r#"{
        "nodes": [
            {
                "id": 1,
                "type": "KSampler //Inspire",
                "widgets_values": [54321, "fixed", 18, 7.25, "euler", "normal", 0.8, "GPU(=A1111)", "incremental", 0, 0]
            }
        ]
    }"#;

    let mut prompt_chunks = HashMap::new();
    prompt_chunks.insert("prompt".to_string(), prompt.to_string());
    let prompt_meta = extract_comfyui_metadata(&prompt_chunks);
    assert_eq!(prompt_meta.seed, Some(12345));
    assert_eq!(prompt_meta.steps, 24);
    assert_eq!(prompt_meta.cfg, 6.5);
    assert_eq!(prompt_meta.sampler, "dpmpp_2m (karras)");

    let mut workflow_chunks = HashMap::new();
    workflow_chunks.insert("workflow".to_string(), workflow.to_string());
    let workflow_meta = extract_comfyui_metadata(&workflow_chunks);
    assert_eq!(workflow_meta.seed, Some(54321));
    assert_eq!(workflow_meta.steps, 18);
    assert_eq!(workflow_meta.cfg, 7.25);
    assert_eq!(workflow_meta.sampler, "euler (normal)");
}

#[test]
fn inspire_ksampler_linked_ui_values_override_stale_widgets() {
    let workflow = r#"{
        "nodes": [
            {
                "id": 10,
                "type": "KSampler //Inspire",
                "inputs": [
                    {"name": "seed", "type": "INT", "link": 101},
                    {"name": "cfg", "type": "FLOAT", "link": 102},
                    {"name": "sampler_name", "type": "COMBO", "link": 103},
                    {"name": "scheduler", "type": "COMBO", "link": 104}
                ],
                "widgets_values": [1, "fixed", 20, 1.0, "euler", "simple", 1.0, "GPU(=A1111)", "incremental", 0, 0]
            },
            {"id": 20, "type": "PrimitiveInt", "widgets_values": [987654321]},
            {"id": 21, "type": "PrimitiveFloat", "widgets_values": [8.5]},
            {"id": 22, "type": "PrimitiveString", "widgets_values": ["dpmpp_sde"]},
            {"id": 23, "type": "PrimitiveString", "widgets_values": ["karras"]}
        ],
        "links": [
            [101, 20, 0, 10, 0, "INT"],
            [102, 21, 0, 10, 1, "FLOAT"],
            [103, 22, 0, 10, 2, "STRING"],
            [104, 23, 0, 10, 3, "STRING"]
        ]
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.seed, Some(987654321));
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 8.5);
    assert_eq!(meta.sampler, "dpmpp_sde (karras)");
}

#[test]
fn test_extract_comfyui_ui_format() {
    // A graph using the "workflow" (UI) format with nodes as array and widgets_values
    let workflow = r#"{
        "nodes": [
            {
                "id": 1,
                "type": "KSampler",
                "widgets_values": [
                    12345,
                    "fixed",
                    30,
                    8.0,
                    "euler",
                    "normal",
                    1.0
                ]
            },
            {
                "id": 2,
                "type": "CheckpointLoaderSimple",
                "widgets_values": [
                    "sd_xl_base_1.0.safetensors"
                ]
            }
        ]
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    // We set tool to unknown to ensure extract logic identifies it
    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.tool, "ComfyUI");
    assert_eq!(meta.model, "sd_xl_base_1.0"); // Found from widgets_values
    assert_eq!(meta.steps, 30); // Found from widgets_values
    assert_eq!(meta.sampler, "euler (normal)"); // Found from widgets_values
}

#[test]
fn test_extract_comfyui_ui_format_complex() {
    // Huge UI format workflow with Text to Conditioning, Text Concatenate, Text Multiline, Text String
    // Simplified chain based on user's JSON structure for the reproduction
    let workflow_fixed = r#"{
        "nodes": [
            { "id": 3, "type": "KSampler", "inputs": [{"name": "positive", "link": 1}] },
            { "id": 183, "type": "Text to Conditioning", "inputs": [{"name": "text", "link": 2}] },
            { "id": 179, "type": "Text Concatenate", "inputs": [{"name": "text_a", "link": 3}, {"name": "text_b", "link": 4}], "widgets_values": ["true"] },
            { "id": 134, "type": "Text String", "widgets_values": ["Part A"] },
            { "id": 177, "type": "Text Parse Noodle Soup Prompts", "inputs": [{"name": "text", "link": 5}] },
            { "id": 136, "type": "Text Multiline", "widgets_values": ["Part B"] }
        ],
        "links": [
            [1, 183, 0, 3, 0, "CONDITIONING"],
            [2, 179, 0, 183, 0, "ASCII"],
            [3, 134, 0, 179, 0, "ASCII"],
            [4, 177, 0, 179, 1, "ASCII"],
            [5, 136, 0, 177, 0, "ASCII"]
        ]
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow_fixed.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert!(meta.positive_prompt.contains("Part A"));
    assert!(meta.positive_prompt.contains("Part B"));
}

#[test]
fn test_extract_comfyui_stylealigned_reproduction() {
    // User provided StyleAligned workflow (UI format)
    let workflow = r#"{
        "last_node_id": 98,
        "last_link_id": 230,
        "nodes": [
            {
                "id": 10,
                "type": "StyleAlignedBatchAlign",
                "inputs": [{"name": "model", "type": "MODEL", "link": null}],
                "outputs": [{"name": "MODEL", "type": "MODEL", "links": [11], "shape": 3, "slot_index": 0}],
                "properties": {"Node name for S&R": "StyleAlignedBatchAlign"},
                "widgets_values": ["both", "q+k+v", 1]
            },
            {
                "id": 76,
                "type": "PrimitiveNode",
                "outputs": [{"name": "STRING", "type": "STRING", "links": [94, 95], "slot_index": 0, "widget": {"name": "text_g"}}],
                "properties": {"Run widget replace on values": false},
                "widgets_values": ["text, watermark"]
            },
            {
                "id": 36,
                "type": "BatchPromptScheduleEncodeSDXL",
                "inputs": [
                    {"name": "clip", "type": "CLIP", "link": null},
                    {"name": "text_g", "type": "STRING", "link": 40, "widget": {"name": "text_g"}},
                    {"name": "pre_text_G", "type": "STRING", "link": 43, "widget": {"name": "pre_text_G"}},
                    {"name": "app_text_G", "type": "STRING", "link": 45, "widget": {"name": "app_text_G"}}
                ],
                "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": [144], "shape": 3, "slot_index": 0}],
                "properties": {"Node name for S&R": "BatchPromptScheduleEncodeSDXL"},
                "widgets_values": [4096, 4096, 0, 0, 1024, 1024, "formatted_json_omitted_for_brevity", "formatted_json_omitted_for_brevity", 4, false, "Low poly, Game asset", "Unreal Engine, Octane Render, flat background", "Low poly, Game asset", "Unreal Engine, Octane Render, flat background", 0, 0, 0, 0]
            },
            {
                "id": 38, "type": "PrimitiveNode",
                "outputs": [{"name": "STRING", "type": "STRING", "links": [40, 41], "slot_index": 0, "widget": {"name": "text_g"}}],
                "title": "Subjects",
                "widgets_values": ["\"0\": \"crystal\",\n\"1\": \"pine tree\""]
            },
            {
                "id": 41, "type": "PrimitiveNode",
                "outputs": [{"name": "STRING", "type": "STRING", "links": [43, 44], "slot_index": 0, "widget": {"name": "pre_text_G"}}],
                "title": "Pre_Subject",
                "widgets_values": ["Low poly, Game asset"]
            },
            {
                "id": 42, "type": "PrimitiveNode",
                "outputs": [{"name": "STRING", "type": "STRING", "links": [45, 46], "slot_index": 0, "widget": {"name": "app_text_G"}}],
                "title": "After_Subjects",
                "widgets_values": ["Unreal Engine, Octane Render, flat background"]
            },
            {
                "id": 90,
                "type": "StyleAlignedReferenceSampler",
                "inputs": [
                    {"name": "model", "type": "MODEL", "link": null},
                    {"name": "positive", "type": "CONDITIONING", "link": 183},
                    {"name": "negative", "type": "CONDITIONING", "link": 184},
                    {"name": "sampler", "type": "SAMPLER", "link": 192, "slot_index": 3},
                    {"name": "sigmas", "type": "SIGMAS", "link": 182, "slot_index": 4}
                ],
                "outputs": [{"name": "output", "type": "LATENT", "links": [185], "shape": 3, "slot_index": 0}],
                "properties": {"Node name for S&R": "StyleAlignedReferenceSampler"}
            },
            {
                "id": 69,
                "type": "CLIPTextEncodeSDXL",
                "inputs": [
                    {"name": "clip", "type": "CLIP", "link": null},
                    {"name": "text_g", "type": "STRING", "link": 77, "widget": {"name": "text_g"}, "slot_index": 1},
                    {"name": "text_l", "type": "STRING", "link": 78, "widget": {"name": "text_l"}}
                ],
                "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": [178, 183], "shape": 3, "slot_index": 0}],
                "properties": {"Node name for S&R": "CLIPTextEncodeSDXL"},
                "widgets_values": [4095, 4096, 0, 0, 1024, 1024, "A Japanese plastic toy of goku , flat white background", "A Japanese plastic toy of goku , flat white background"]
            },
            {
                "id": 68,
                "type": "PrimitiveNode",
                "outputs": [{"name": "STRING", "type": "STRING", "links": [77, 78], "slot_index": 0, "widget": {"name": "text_g"}}],
                "widgets_values": ["A Japanese plastic toy of goku , flat white background"]
            },
            {
                "id": 88, "type": "SaveImage",
                "inputs": [{"name": "images", "type": "IMAGE", "link": 148}]
            },
            {
                "id": 98, "type": "SaveImage",
                "inputs": [{"name": "images", "type": "IMAGE", "link": 195}]
            },
            {
                "id": 3, "type": "KSampler",
                "inputs": [{"name": "positive", "type": "CONDITIONING", "link": 151}],
                "outputs": [{"name": "LATENT", "type": "LATENT", "links": [7], "slot_index": 0}]
            }
        ],
        "links": [
            [7, 3, 0, 8, 0, "LATENT"],
            [40, 38, 0, 36, 1, "STRING"],
            [41, 38, 0, 36, 2, "STRING"],
            [43, 41, 0, 36, 3, "STRING"],
            [44, 41, 0, 36, 4, "STRING"],
            [45, 42, 0, 36, 5, "STRING"],
            [46, 42, 0, 36, 6, "STRING"],
            [77, 68, 0, 69, 1, "STRING"],
            [78, 68, 0, 69, 2, "STRING"],
            [144, 36, 0, 17, 0, "*"],
            [151, 36, 0, 3, 1, "CONDITIONING"],
            [183, 69, 0, 90, 1, "CONDITIONING"],
            [185, 90, 0, 91, 0, "LATENT"],
            [195, 91, 0, 98, 0, "IMAGE"],
            [148, 8, 0, 88, 0, "IMAGE"]
        ]
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.tool, "ComfyUI");
    assert!(meta.positive_prompt.contains("Low poly"));
    assert!(meta.positive_prompt.contains("crystal"));
}
