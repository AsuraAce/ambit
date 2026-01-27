use crate::metadata::comfyui::*;
use std::collections::HashMap;

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
    assert_eq!(meta.steps, 30);              // Found from widgets_values
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
