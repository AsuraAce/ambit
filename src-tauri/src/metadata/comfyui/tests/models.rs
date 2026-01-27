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
    assert_eq!(meta.model, "flux1-dev-fp8");
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
    assert_eq!(meta.model, "novaAnimeXL_ilV30HappyNewYear");
}
