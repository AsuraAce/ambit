use crate::metadata::comfyui::*;
use std::collections::HashMap;

#[test]
fn test_repro_smz_concat_metadata() {
    let workflow = r#"{
    "nodes": [
        {
            "id": 1127,
            "type": "KSamplerAdvanced",
            "inputs": [
                {"name": "model", "type": "MODEL", "link": 2479},
                {"name": "positive", "type": "CONDITIONING", "link": 2502},
                {"name": "negative", "type": "CONDITIONING", "link": 2503}
            ]
        },
        {
            "id": 1790,
            "type": "ConditioningConcat",
            "inputs": [
                {"name": "conditioning_to", "type": "CONDITIONING", "link": 2459},
                {"name": "conditioning_from", "type": "CONDITIONING", "link": 2460}
            ]
        },
        {
            "id": 18,
            "type": "smZ CLIPTextEncode",
            "widgets_values": [
                "Positive Prompt Text",
                "comfy", true, true, false, false, 6, 1024, 1024, 0, 0, 1024, 1024, "", "", 1
            ]
        },
        {
            "id": 1789,
            "type": "smZ CLIPTextEncode",
            "widgets_values": [
                "",
                "comfy", true, true, false, false, 6, 1024, 1024, 0, 0, 1024, 1024, "", "", 1
            ]
        },
        {
            "id": 1791,
            "type": "smZ CLIPTextEncode",
            "widgets_values": [
                "Negative Prompt Text",
                "A1111", false, true, false, false, 6, 1024, 1024, 0, 0, 1024, 1024, "", "", 1
            ]
        },
        {
            "id": 1121,
            "type": "GetNode",
            "widgets_values": ["model after ipAdapter"]
        },
        {
            "id": 1358,
            "type": "SetNode",
            "widgets_values": ["model after ipAdapter"],
            "inputs": [{"name": "MODEL", "type": "MODEL", "link": 1879}]
        },
        {
            "id": 53,
            "type": "CheckpointLoaderSimple",
            "widgets_values": ["base.safetensors"]
        }
    ],
    "links": [
        [2479, 1121, 0, 1127, 0, "MODEL"],
        [2502, 1790, 0, 1127, 1, "CONDITIONING"],
        [2503, 1791, 0, 1127, 2, "CONDITIONING"],
        [2459, 18, 0, 1790, 0, "CONDITIONING"],
        [2460, 1789, 0, 1790, 1, "CONDITIONING"],
        [1879, 53, 0, 1358, 0, "MODEL"]
    ]
}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "Positive Prompt Text");
    assert_eq!(meta.negative_prompt, "Negative Prompt Text");
    assert_eq!(meta.model, "base");
}

#[test]
fn test_repro_prompts_everywhere_multiple_inputs() {
    let workflow = r#"{
    "nodes": [
        {
            "id": 3,
            "type": "KSampler",
            "inputs": [
                {"name": "positive", "type": "CONDITIONING", "link": null},
                {"name": "negative", "type": "CONDITIONING", "link": null}
            ]
        },
        {
            "id": 1735,
            "type": "Prompts Everywhere",
            "inputs": [
                {"name": "CONDITIONING", "type": "*", "link": 10},
                {"name": "CONDITIONING", "type": "*", "link": 11}
            ]
        },
        {
            "id": 10,
            "type": "CLIPTextEncode",
            "inputs": [{"name": "text", "type": "STRING", "link": null}],
            "widgets_values": ["Positive 1"]
        },
        {
            "id": 11,
            "type": "CLIPTextEncode",
            "inputs": [{"name": "text", "type": "STRING", "link": null}],
            "widgets_values": ["Positive 2"]
        }
    ],
    "links": [
        [10, 10, 0, 1735, 0, "CONDITIONING"],
        [11, 11, 0, 1735, 1, "CONDITIONING"]
    ]
}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    // If it correctly follows both links, it should have both.
    // However, prompts_everywhere broadcasts to any node that needs it.
    // Our find_wireless_node needs to handle it.

    assert!(meta.positive_prompt.contains("Positive 1"));
    assert!(meta.positive_prompt.contains("Positive 2"));
}

#[test]
fn test_repro_junk_prompt_avoidance() {
    let workflow = r#"{
    "nodes": [
        {
            "id": 1,
            "type": "KSampler",
            "inputs": [
                {"name": "positive", "type": "CONDITIONING", "link": 10}
            ]
        },
        {
            "id": 10,
            "type": "CLIPTextEncode",
            "widgets_values": ["Valid Positive Prompt"]
        },
        {
            "id": 20,
            "type": "SDPromptSaver",
            "widgets_values": [
                0, 0, "model", 0, 0, 0, 0, 0, 0, 0, 0, "undefined", "undefined"
            ]
        }
    ],
    "links": [
        [10, 10, 0, 1, 0, "CONDITIONING"]
    ]
}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());
    // Also include a junk parameters chunk
    chunks.insert(
        "parameters".to_string(),
        "Positive prompt: undefined\nNegative prompt: undefined\nSteps: 20".to_string(),
    );

    let meta = extract_comfyui_metadata(&chunks);

    // Should prioritize graph prompt over junk parameters
    assert_eq!(meta.positive_prompt, "Valid Positive Prompt");
}

#[test]
fn test_repro_broadcaster_loop() {
    let workflow = r#"{
    "nodes": [
        {
            "id": 1,
            "type": "KSampler",
            "inputs": [
                {"name": "positive", "type": "CONDITIONING", "link": null}
            ]
        },
        {
            "id": 2,
            "type": "Anything Everywhere",
            "inputs": [
                {"name": "CONDITIONING", "type": "CONDITIONING", "link": null}
            ]
        }
    ],
    "links": []
}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    // This should NOT hang.
    let meta = extract_comfyui_metadata(&chunks);
    assert_eq!(meta.positive_prompt, "");
}

#[test]
fn test_repro_undefined_positive_with_valid_negative() {
    let workflow = r#"{
    "nodes": [
        {
            "id": 1,
            "type": "KSampler",
            "inputs": [
                {"name": "positive", "type": "CONDITIONING", "link": 10},
                {"name": "negative", "type": "CONDITIONING", "link": 20}
            ]
        },
        {
            "id": 10,
            "type": "CLIPTextEncode",
            "widgets_values": ["undefined"]
        },
        {
            "id": 20,
            "type": "CLIPTextEncode",
            "widgets_values": ["Negative Prompt: Valid Negative Prompt"]
        },
        {
            "id": 30,
            "type": "CLIPTextEncode",
            "widgets_values": ["Better Positive Prompt"]
        }
    ],
    "links": [
        [10, 10, 0, 1, 0, "CONDITIONING"],
        [20, 20, 0, 1, 1, "CONDITIONING"]
    ]
}"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    // Current behavior (likely): positive_prompt == "undefined"
    // Desired behavior: should fallback or ignore "undefined" and find "Better Positive Prompt" in global scan
    assert_ne!(meta.positive_prompt, "undefined");
    assert_eq!(meta.positive_prompt, "Better Positive Prompt");
}
