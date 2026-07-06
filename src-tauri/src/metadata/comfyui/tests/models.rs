use crate::metadata::comfyui::*;
use std::collections::HashMap;

#[test]
fn test_extract_comfyui_unet_loader() {
    // A graph using UNETLoader
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["5", 0]
            }
        },
        "5": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "flux_dev.safetensors"
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);
    assert_eq!(meta.model, "flux_dev");
}

#[test]
fn test_extract_comfyui_easy_loader() {
    // A graph using EasyLoader (Flux)
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["10", 0]
            }
        },
        "10": {
            "class_type": "EasyLoader",
            "inputs": {
                "ckpt_name": "flux1-dev-fp8.safetensors"
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);
    assert_eq!(meta.model, "flux1_dev_fp8");
}

#[test]
fn test_extract_comfyui_qwen() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["10", 0],
                "model": ["20", 0]
            }
        },
        "10": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": {
                "0": "A realistic portrait of a cat",
                "model": ["20", 0]
            }
        },
        "20": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "base.safetensors" }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.model, "base");
}

#[test]
fn test_extract_comfyui_workflow_hypernetwork_loader_strength() {
    let workflow = r#"{
        "last_node_id": 10,
        "last_link_id": 22,
        "nodes": [
            {
                "id": 4,
                "type": "CheckpointLoaderSimple",
                "outputs": [
                    { "name": "MODEL", "type": "MODEL", "links": [10], "slot_index": 0 }
                ],
                "widgets_values": ["BaseModel.safetensors"]
            },
            {
                "id": 10,
                "type": "HypernetworkLoader",
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 10 }
                ],
                "outputs": [
                    { "name": "MODEL", "type": "MODEL", "links": [22], "slot_index": 0 }
                ],
                "widgets_values": ["StyleFoo.pt", 0.8]
            },
            {
                "id": 3,
                "type": "KSampler",
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": 22 }
                ],
                "outputs": [
                    { "name": "LATENT", "type": "LATENT", "links": [7], "slot_index": 0 }
                ],
                "widgets_values": [123456789, "randomize", 20, 7, "euler", "normal", 1]
            },
            {
                "id": 8,
                "type": "VAEDecode",
                "inputs": [
                    { "name": "samples", "type": "LATENT", "link": 7 }
                ],
                "outputs": [
                    { "name": "IMAGE", "type": "IMAGE", "links": [9], "slot_index": 0 }
                ]
            },
            {
                "id": 9,
                "type": "SaveImage",
                "inputs": [
                    { "name": "images", "type": "IMAGE", "link": 9 }
                ],
                "widgets_values": ["ComfyUI"]
            }
        ],
        "links": [
            [10, 4, 0, 10, 0, "MODEL"],
            [22, 10, 0, 3, 0, "MODEL"],
            [7, 3, 0, 8, 0, "LATENT"],
            [9, 8, 0, 9, 0, "IMAGE"]
        ]
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.model, "basemodel");
    assert_eq!(meta.hypernetworks, ["stylefoo (0.80)"]);
}

#[test]
fn test_extract_comfyui_supir_conflict() {
    // User reported case where "SUPIR" (refine ckpt) is detected instead of "novaAnimeXL" (main ckpt)
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": { 
                "model": ["144", 0]
            }
        },
        "144": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { 
                "ckpt_name": ["438", 1]
            }
        },
        "435": {
            "class_type": "Save Image with Metadata JK",
            "inputs": {
                "ckpt_name": ["438", 1],
                "refine_ckpt_name": "SUPIR\\SUPIR-v0F.ckpt"
            }
        },
        "438": {
            "class_type": "Ckpt Loader JK",
            "inputs": { "checkpoint": "novaAnimeXL_ilV30HappyNewYear.safetensors" }
        },
        "output": {
            "class_type": "SaveImage",
            "inputs": { "images": ["435", 0] }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    // Should find the actual KSampler model (novaAnimeXL), NOT SUPIR
    assert_eq!(meta.model, "novaanimexl_ilv30happynewyear");
}
