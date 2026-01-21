use super::*;
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
    assert_eq!(meta.model, "v1-5-pruned"); // Should skip LoraLoader and find Checkpoint
    assert_eq!(meta.positive_prompt, "beautiful scenery");
    assert_eq!(meta.negative_prompt, "bad quality");
}

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
    assert_eq!(meta.model, "realvis-v3"); // Should be found by linear scan
    assert_eq!(meta.steps, 30);           // Should be found by linear scan
    assert_eq!(meta.sampler, "dpmpp_2m"); // Should be found by linear scan
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
    assert_eq!(meta.steps, 30);              // Found from widgets_values
    assert_eq!(meta.sampler, "euler (normal)"); // Found from widgets_values
}

#[test]
fn test_extract_comfyui_complex_user_case() {
    // Based on user report: KSampler -> ApplyFBCache -> LoraManager -> UNETLoader
    let prompt = r#"{
        "870": {
            "class_type": "KSampler",
            "inputs": {
                "seed": ["932", 0],
                "steps": ["932", 1],
                "model": ["854", 0]
            }
        },
        "932": {
            "class_type": "Input Parameters (Image Saver)",
            "inputs": {
                "seed": 445941582371850,
                "steps": 20
            }
        },
        "854": {
            "class_type": "ApplyFBCacheOnModel",
            "inputs": {
                "model": ["944", 0]
            }
        },
        "944": {
            "class_type": "Lora Loader (LoraManager)",
            "inputs": {
                "model": ["940", 0]
            }
        },
        "940": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "flux/flux1KreaDevFP8_fp8E4m3fn.safetensors"
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    // This is necessary to test detection from chunks
    let meta = extract_comfyui_metadata(&chunks);

    // NOTE: The `trace_model_source` should traverse 870 -> 854 -> 944 -> 940
    // 854 (ApplyFBCache) handled by generic "model" passthrough
    // 944 (Lora Loader (LoraManager)) handled by specific LoraManager matching
    assert_eq!(meta.tool, "ComfyUI");
    assert_eq!(meta.model, "flux/flux1KreaDevFP8_fp8E4m3fn"); 
    
    // Steps/Seed come from 932 via link in 870
    // NOTE: My current parser doesn't trace numeric inputs like 'steps' or 'seed', it only reads direct values.
    // The user's KSampler uses linked inputs for steps/seed. 
    // My parser will likely yield 0 for steps unless we implement numeric tracing or use the wireless fallback.
    // BUT, the wireless fallback (Linear Scan) should find node 932 if it has "steps".
    // Node 932 has "steps": 20.
    // Fallback scan looks for "KSampler" in class name.
    // Node 932 class is "Input Parameters (Image Saver)". It DOES NOT contain "KSampler".
    // So steps might be 0. This is a potential separate issue.
    assert_eq!(meta.model, "flux/flux1KreaDevFP8_fp8E4m3fn"); 
    
    // Steps/Seed come from 932 via link in 870
    // ... (existing comments)
}

#[test]
fn test_extract_comfyui_complex_prompt() {
    // User report: CLIPTextEncode text input linked to JoinStringMulti -> ImpactWildcardProcessor
    let prompt = r#"{
        "870": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["877", 0],
                "model": ["854", 0]
            }
        },
        "877": {
            "class_type": "FluxGuidance",
            "inputs": {
                "conditioning": ["855", 0]
            }
        },
        "855": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": ["942", 0]
            }
        },
        "942": {
            "class_type": "JoinStringMulti",
            "inputs": {
                "string_1": ["943", 0],
                "string_2": ["941", 0],
                "delimiter": ", "
            }
        },
        "943": {
            "class_type": "TriggerWord Toggle (LoraManager)",
            "inputs": {
                "trigger_words": "trigger_abc" 
            }
        },
        "941": {
            "class_type": "ImpactWildcardProcessor",
            "inputs": {
                "populated_text": "A battle-hardened mercenary captain..."
            }
        },
        "854": { "class_type": "ApplyFBCacheOnModel", "inputs": { "model": ["1",0] } },
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "flux.safetensors" } }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);
    
    // Current implementation fails here because it doesn't follow the 'text' link in CLIPTextEncode
    // nor does it handle JoinStringMulti or ImpactWildcardProcessor
    assert_eq!(meta.positive_prompt, "trigger_abc, A battle-hardened mercenary captain...");
}

#[test]
fn test_extract_comfyui_recursive_params_and_loras() {
    // Test 1: Recursive Parameters (KSampler -> Input Parameters)
    // Test 2: Custom Lora Manager extraction
    let prompt = r#"{
        "870": {
            "class_type": "KSampler",
            "inputs": {
                "steps": ["932", 1], 
                "cfg": ["932", 2],
                "model": ["10", 0]
            }
        },
        "932": {
            "class_type": "Input Parameters (Image Saver)",
            "inputs": {
                "steps": 20,
                "cfg": 7.5
            }
        },
        "10": {
            "class_type": "Lora Loader (LoraManager)",
            "inputs": {
                "model": ["4", 0],
                "loras": {
                    "__value__": [
                        { "name": "Detailer.safetensors", "strength": 0.8, "active": true },
                        { "name": "Style.safetensors", "strength": 0.5, "active": false }
                    ]
                }
            }
        },
        "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "base.safetensors" } }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);
    
    // Assert recursive params
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 7.5);
    
    // Assert LoRAs
    assert_eq!(meta.loras.len(), 1); // Only active one
    assert_eq!(meta.loras[0], "Detailer (0.80)");
}

#[test]
fn test_extract_comfyui_show_anything() {
    // User provided case with "easy showAnything" and "JoinStringMulti"
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["176", 0],
                "negative": ["177", 0],
                "model": ["803", 2],
                "steps": 20,
                "cfg": 8.0,
                "sampler_name": "deis",
                "scheduler": "beta",
                "seed": 12345
            }
        },
        "176": {
            "class_type": "smZ CLIPTextEncode",
            "inputs": {
                "text": ["798", 0],
                "clip": ["803", 3]
            }
        },
        "798": {
            "class_type": "JoinStringMulti",
            "inputs": {
                "string_1": ["118", 0],
                "string_2": ["792", 0],
                "delimiter": " Break, "
            }
        },
        "118": {
            "class_type": "StringConstantMultiline",
            "inputs": { "string": "\n" }
        },
        "792": {
            "class_type": "easy showAnything",
            "inputs": {
                "text": "hentai, female anime character, Naruto franchise",
                "anything": ["795", 0]
            }
        },
        "177": { "class_type": "CLIPTextEncode", "inputs": { "text": "negative prompt text" } },
        "803": { "class_type": "SDParameterGenerator", "inputs": { "model": "test.safetensors" } }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);

    assert!(meta.positive_prompt.contains("hentai, female anime character"));
}

#[test]
fn test_extract_comfyui_failed_case_2() {
    // User provided failure case #2 (JoinStringMulti + smZ CLIPTextEncode + easy showAnything)
    // This validates if the mix of these specific nodes causes issues.
    let prompt = r#"{
        "3": {
            "inputs": {
                "seed": ["803", 5], "steps": ["803", 6], "cfg": ["803", 8], "sampler_name": ["803", 9], "scheduler": ["803", 10], "denoise": 1.0, "model": ["361", 0], "positive": ["176", 0], "negative": ["177", 0], "latent_image": ["33", 0]
            },
            "class_type": "KSampler", "_meta": {"title": "KSampler"}
        },
        "176": {
            "inputs": {"text": ["798", 0], "clip": ["803", 3]}, 
            "class_type": "smZ CLIPTextEncode", "_meta": {"title": "CLIP Text Encode++"}
        },
        "798": {
            "inputs": {"inputcount": 2, "string_1": ["118", 0], "string_2": ["792", 0], "delimiter": " Break, "},
            "class_type": "JoinStringMulti", "_meta": {"title": "Join String Multi"}
        },
        "118": {
            "inputs": {"string": "\n"}, "class_type": "StringConstantMultiline"
        },
        "792": {
            "inputs": {"text": "A highly detailed and dynamic figure drawing reference pose..."},
            "class_type": "easy showAnything", "_meta": {"title": "Show Any"}
        },
        "177": { "inputs": { "text": "negative..." }, "class_type": "smZ CLIPTextEncode" },
        "803": { "inputs": { "seed": 123456 }, "class_type": "SDParameterGenerator" },
        "361": { "inputs": { "model": ["803", 2] }, "class_type": "Automatic CFG" }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);

    assert!(meta.positive_prompt.contains("A highly detailed"));
    assert!(meta.positive_prompt.contains("Break"));
}

#[test]
fn test_extract_comfyui_passthrough() {
    // Test case where text encoders are separated from KSampler by intermediate nodes
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["100", 0],
                "negative": ["101", 0],
                "model": ["803", 2],
                "seed": 123
            }
        },
        "100": {
            "class_type": "InpaintModelConditioning",
            "inputs": {
                "positive": ["10", 0],
                "negative": ["11", 0]
            }
        },
        "101": {
            "class_type": "ControlNetApply",
            "inputs": {
                "conditioning": ["11", 0]
            }
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "positive prompt" }
        },
        "11": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "negative prompt" }
        },
        "803": {
            "class_type": "SDParameterGenerator",
            "inputs": { "ckpt_name": "model.safetensors" }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);
    
    assert_eq!(meta.positive_prompt, "positive prompt");
    assert_eq!(meta.negative_prompt, "negative prompt");
    assert_eq!(meta.model, "model");
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

#[test]
fn test_extract_comfyui_flux_user_case() {
    // Based on user report
    let prompt = r#"{
"836": {"inputs": {"scheduler": "simple", "steps": 20, "denoise": 1.0, "model": ["847", 0]}, "class_type": "BasicScheduler", "_meta": {"title": "BasicScheduler"}}, 
"837": {"inputs": {"sampler_name": "euler"}, "class_type": "KSamplerSelect", "_meta": {"title": "KSamplerSelect"}}, 
"839": {"inputs": {"model": ["847", 0], "conditioning": ["838", 0]}, "class_type": "BasicGuider", "_meta": {"title": "BasicGuider"}}, 
"838": {"inputs": {"conditioning": ["855", 0], "guidance": 3.5}, "class_type": "FluxGuidance", "_meta": {"title": "FluxGuidance"}},
"855": {"inputs": {"text": ["865", 0], "clip": ["850", 0]}, "class_type": "CLIPTextEncode", "_meta": {"title": "CLIP Text Encode"}},
"840": {"inputs": {"noise": ["852", 0], "guider": ["839", 0], "sampler": ["837", 0], "sigmas": ["836", 0], "latent_image": ["842", 0]}, "class_type": "SamplerCustomAdvanced", "_meta": {"title": "SamplerCustomAdvanced"}}, 
"841": {"inputs": {"samples": ["840", 0], "vae": ["849", 0]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}}, 
"847": {"inputs": {"max_shift": 1.15, "base_shift": 0.5, "width": 832, "height": 1216, "model": ["854", 0]}, "class_type": "ModelSamplingFlux", "_meta": {"title": "ModelSamplingFlux"}}, 
"848": {"inputs": {"unet_name": "redcraftCADSUpdatedJan18_revealULTRAV35.safetensors", "weight_dtype": "fp8_e4m3fn_fast"}, "class_type": "UNETLoader", "_meta": {"title": "Load Diffusion Model"}}, 
"854": {"inputs": {"object_to_patch": "diffusion_model", "residual_diff_threshold": 0.12, "start": 0.0, "end": 1.0, "max_consecutive_cache_hits": -1, "model": ["848", 0]}, "class_type": "ApplyFBCacheOnModel", "_meta": {"title": "Apply First Block Cache"}}, 
"865": {"inputs": {"String": "charcoal drawing, dynamic reference pose of a young woman, lingerie, nativ-american indianer, \n\nshadow play, low key lighting, back lighting, natural lighting, "}, "class_type": "String", "_meta": {"title": "String"}}
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);
    
    assert_eq!(meta.model, "redcraftCADSUpdatedJan18_revealULTRAV35");
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.sampler, "euler (simple)"); // Scheduler is linked!
    assert_eq!(meta.positive_prompt, "charcoal drawing, dynamic reference pose of a young woman, lingerie, nativ-american indianer, \n\nshadow play, low key lighting, back lighting, natural lighting, ");
}
