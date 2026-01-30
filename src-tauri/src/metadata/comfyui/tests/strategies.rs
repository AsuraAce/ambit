use crate::metadata::comfyui::*;
use std::collections::HashMap;

#[test]
fn test_extract_comfyui_traversal() {
    // A graph where KSampler -> LoraLoader -> CheckpointLoader
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 8.0,
                "model": ["10", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "seed": 12345,
                "steps": 25,
                "sampler_name": "euler"
            }
        },
        "10": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["4", 0],
                "lora_name": "add_detail.safetensors"
            }
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "v1-5-pruned.safetensors"
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "beautiful scenery"
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "bad quality"
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.tool, "ComfyUI");
    assert_eq!(meta.steps, 25);
    assert_eq!(meta.model, "v1_5_pruned"); // Should skip LoraLoader and find Checkpoint
    assert_eq!(meta.positive_prompt, "beautiful scenery");
    assert_eq!(meta.negative_prompt, "bad quality");
}

#[test]
fn test_extract_comfyui_wireless_fallback() {
    // A graph where KSampler is NOT linked to the loader (wireless/Use Everywhere)
    // Traversal will fail, so Fallback Scan must catch it.
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "cfg": 7.0,
                "steps": 30,
                "sampler_name": "dpmpp_2m"
            }
        },
        "10": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": "realvis-v3.safetensors"
            }
        },
        "20": {
            "class_type": "PreviewImage",
            "inputs": { "images": [] } 
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.tool, "ComfyUI");
    assert_eq!(meta.model, "realvis_v3"); // Should be found by linear scan
    assert_eq!(meta.steps, 30); // Should be found by linear scan
    assert_eq!(meta.sampler, "dpmpp_2m"); // Should be found by linear scan
}

#[test]
fn test_extract_comfyui_wireless_titled_nodes() {
    // Disconnected KSampler + Prompt nodes with titles
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": { "seed": 1234 }
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "_meta": { "title": "Positive Prompt" },
            "inputs": { "text": ["12", 0] }
        },
        "11": {
            "class_type": "CLIPTextEncode",
            "_meta": { "title": "Negative Prompt" },
            "inputs": { "text": "ugly hands" }
        },
        "12": {
            "class_type": "String",
            "inputs": { "STRING": "landscape, sunset" }
        },
        "20": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "base.safetensors" }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    // Fallback should find model and prompts by labels/types
    assert_eq!(meta.model, "base");
    assert_eq!(meta.positive_prompt, "landscape, sunset");
    assert_eq!(meta.negative_prompt, "ugly hands");
}
