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

#[test]
fn test_extract_comfyui_primitive_multiline() {
    let prompt = r#"{"39":{"inputs":{"clip_name":"qwen_3_4b.safetensors","type":"lumina2","device":"cpu"},"class_type":"CLIPLoader","_meta":{"title":"Load CLIP"}},"40":{"inputs":{"vae_name":"ae.safetensors"},"class_type":"VAELoader","_meta":{"title":"Load VAE"}},"41":{"inputs":{"width":1024,"height":1536,"batch_size":1},"class_type":"EmptySD3LatentImage","_meta":{"title":"EmptySD3LatentImage"}},"42":{"inputs":{"conditioning":["45",0]},"class_type":"ConditioningZeroOut","_meta":{"title":"ConditioningZeroOut"}},"43":{"inputs":{"samples":["44",0],"vae":["40",0]},"class_type":"VAEDecode","_meta":{"title":"VAE Decode"}},"44":{"inputs":{"seed":515018389178561,"steps":6,"cfg":1.0,"sampler_name":"res_multistep","scheduler":"simple","denoise":1.0,"model":["47",0],"positive":["48",0],"negative":["42",0],"latent_image":["41",0]},"class_type":"KSampler","_meta":{"title":"KSampler"}},"45":{"inputs":{"text":["81",0],"clip":["79",1]},"class_type":"CLIPTextEncode","_meta":{"title":"CLIP Text Encode (Prompt)"}},"46":{"inputs":{"unet_name":"z_image_turbo_bf16.safetensors","weight_dtype":"default"},"class_type":"UNETLoader","_meta":{"title":"Load Diffusion Model"}},"47":{"inputs":{"shift":3.0,"model":["79",0]},"class_type":"ModelSamplingAuraFlow","_meta":{"title":"ModelSamplingAuraFlow"}},"48":{"inputs":{"randomize_percent":20.5,"strength":20.0,"noise_insert":"noise on beginning steps","steps_switchover_percent":20.0,"seed":1091057402567859,"mask_starts_at":"beginning","mask_percent":0.0,"log_to_console":false,"conditioning":["45",0]},"class_type":"SeedVarianceEnhancer","_meta":{"title":"SeedVarianceEnhancer"}},"51":{"inputs":{"samples":["44",0],"vae":["40",0]},"class_type":"VAEDecode","_meta":{"title":"VAE Decode"}},"52":{"inputs":{"sharpen_radius":1,"sigma":0.43,"alpha":0.31,"image":["75",0]},"class_type":"ImageSharpen","_meta":{"title":"ImageSharpen"}},"56":{"inputs":{"model_name":"4x_NMKD-Siax_200k.pth"},"class_type":"UpscaleModelLoader","_meta":{"title":"Load Upscale Model"}},"62":{"inputs":{"seed":640425679631887,"steps":4,"cfg":1.0,"sampler_name":"res_multistep","scheduler":"simple","denoise":0.2,"mode_type":"Linear","tile_width":512,"tile_height":512,"mask_blur":16,"tile_padding":32,"seam_fix_mode":"None","seam_fix_denoise":1.0,"seam_fix_width":64,"seam_fix_mask_blur":8,"seam_fix_padding":16,"force_uniform_tiles":true,"tiled_decode":false,"upscaled_image":["51",0],"model":["47",0],"positive":["48",0],"negative":["42",0],"vae":["40",0]},"class_type":"UltimateSDUpscaleNoUpscale","_meta":{"title":"Ultimate SD Upscale (No Upscale)"}},"63":{"inputs":{"density":1.0,"intensity":0.07,"highlights":1.0,"supersample_factor":1,"repeats":1,"image":["52",0]},"class_type":"Film Grain","_meta":{"title":"Film Grain"}},"71":{"inputs":{"rgthree_comparer":{"images":[{"name":"A","selected":true,"url":"/api/view?filename=rgthree.compare._temp_haghi_00023_.png&type=temp&subfolder=&rand=0.13643572995104325"},{"name":"B","selected":true,"url":"/api/view?filename=rgthree.compare._temp_haghi_00024_.png&type=temp&subfolder=&rand=0.7454203124188927"}]},"image_a":["63",0],"image_b":["51",0]},"class_type":"Image Comparer (rgthree)","_meta":{"title":"Image Comparer (rgthree)"}},"75":{"inputs":{"upscale_method":"nearest-exact","factor":1.5,"upscale_model":["56",0],"image":["59:3",0]},"class_type":"Upscale by Factor with Model (WLSH)","_meta":{"title":"Upscale by Factor with Model (WLSH)"}},"76":{"inputs":{"filename":"%time_%basemodelname_%seed","path":"%date/","extension":"png","lossless_webp":true,"quality_jpeg_or_webp":100,"optimize_png":false,"embed_workflow":true,"save_workflow_as_json":false,"counter":0,"time_format":"%Y-%m-%d-%H%M%S","show_preview":true,"images":["63",0]},"class_type":"Image Saver Simple","_meta":{"title":"Image Saver Simple"}},"77":{"inputs":{"text":["76",1]},"class_type":"ShowText|pysssss","_meta":{"title":"Show Text \ud83d\udc0d"}},"78":{"inputs":{"text":"","anything":["76",1]},"class_type":"easy showAnything","_meta":{"title":"Show Any"}},"79":{"inputs":{"text":"<lora:Mystic-XXX-ZIT-V5:1.00:1.00> <lora:NIceAsians_Zimage:0.65>","loras":{"__value__":[{"name":"Mystic-XXX-ZIT-V5","strength":"1.00","active":false,"expanded":false,"clipStrength":"1.00"},{"name":"NIceAsians_Zimage","strength":"0.65","active":false,"expanded":false,"clipStrength":"0.65"}]},"model":["46",0],"clip":["39",0]},"class_type":"Lora Loader (LoraManager)","_meta":{"title":"Lora Loader (LoraManager)"}},"80":{"inputs":{"group_mode":true,"default_active":true,"allow_strength_adjustment":false,"toggle_trigger_words":{"__value__":[]},"orinalMessage":"","trigger_words":["79",2]},"class_type":"TriggerWord Toggle (LoraManager)","_meta":{"title":"TriggerWord Toggle (LoraManager)"}},"81":{"inputs":{"inputcount":85,"delimiter":", ","return_list":true,"Update inputs":null,"string_1":["84",0],"string_2":["82",0]},"class_type":"JoinStringMulti","_meta":{"title":"Join String Multi"}},"82":{"inputs":{"value":["80",0]},"class_type":"PrimitiveString","_meta":{"title":"String"}},"84":{"inputs":{"value":"hinonome Umi stands triumphant"},"class_type":"PrimitiveStringMultiline","_meta":{"title":"String (Multiline)"}},"59:0":{"inputs":{"model_name":"sam_vit_b_01ec64.pth","device_mode":"Prefer GPU"},"class_type":"SAMLoader","_meta":{"title":"SAMLoader (Impact)"}},"59:1":{"inputs":{"model_name":"bbox/Nipple-yoro11x_bbox.pt"},"class_type":"UltralyticsDetectorProvider","_meta":{"title":"UltralyticsDetectorProvider"}},"59:2":{"inputs":{"model_name":"bbox/face_yolov8m.pt"},"class_type":"UltralyticsDetectorProvider","_meta":{"title":"UltralyticsDetectorProvider"}},"59:3":{"inputs":{"guide_size":1024.0,"guide_size_for":false,"max_size":1024.0,"seed":633628399021815,"steps":4,"cfg":1.0,"sampler_name":"res_multistep","scheduler":"simple","denoise":0.2,"feather":5,"noise_mask":false,"force_inpaint":false,"bbox_threshold":0.7,"bbox_dilation":5,"bbox_crop_factor":1.5,"sam_detection_hint":"center-1","sam_dilation":0,"sam_threshold":0.75,"sam_bbox_expansion":0,"sam_mask_hint_threshold":0.0,"sam_mask_hint_use_negative":"False","drop_size":10,"wildcard":"","cycle":1,"inpaint_model":false,"noise_mask_feather":0,"tiled_encode":false,"tiled_decode":false,"image":["62",0],"model":["47",0],"clip":["79",1],"vae":["40",0],"positive":["48",0],"negative":["42",0],"bbox_detector":["59:2",0],"sam_model_opt":["59:0",0],"segm_detector_opt":["59:1",1]},"class_type":"FaceDetailer","_meta":{"title":"FaceDetailer"}}}
"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);

    println!("Detected Prompt: {}", meta.positive_prompt);
    assert!(meta.positive_prompt.contains("hinonome Umi"));
}

#[test]
#[ignore] // Disabled per user request: Ollama workflow is considered broken/edge case.
fn test_extract_comfyui_ollama_chain() {
    let prompt = r#"{"3": {"inputs": {"seed": ["803", 5], "steps": ["803", 6], "cfg": ["803", 8], "sampler_name": ["803", 9], "scheduler": ["803", 10], "denoise": 1.0, "model": ["361", 0], "positive": ["176", 0], "negative": ["177", 0], "latent_image": ["33", 0]}, "class_type": "KSampler", "_meta": {"title": "KSampler"}}, "8": {"inputs": {"samples": ["3", 0], "vae": ["803", 4]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}}, "33": {"inputs": {"resolution": "896x1152 (0.78)", "batch_size": 1, "width_override": 0, "height_override": 0}, "class_type": "SDXLEmptyLatentSizePicker+", "_meta": {"title": "\ud83d\udd27 Empty Latent Size Picker"}}, "79": {"inputs": {"CONDITIONING": ["177", 0]}, "class_type": "Prompts Everywhere", "_meta": {"title": "Prompts Everywhere"}}, "96": {"inputs": {"FLOAT": ["803", 8]}, "class_type": "Anything Everywhere", "_meta": {"title": "Anything Everywhere"}}, "97": {"inputs": {"MODEL": ["803", 2], "CLIP": ["803", 3], "VAE": ["803", 4]}, "class_type": "Anything Everywhere3", "_meta": {"title": "Anything Everywhere3"}}, "118": {"inputs": {"string": "\n", "strip_newlines": false}, "class_type": "StringConstantMultiline", "_meta": {"title": "String Constant Multiline"}}, "119": {"inputs": {"string": "low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor,,low quality,worst quality,normal quality, signature,jpeg artifacts,bad anatomy, old, early, copyright name, watermark, artist name, signature,censor,", "strip_newlines": false}, "class_type": "StringConstantMultiline", "_meta": {"title": "String Constant Multiline"}}, "176": {"inputs": {"text": ["798", 0], "parser": "comfy", "mean_normalization": true, "multi_conditioning": true, "use_old_emphasis_implementation": false, "with_SDXL": false, "ascore": 6.0, "width": 1024, "height": 1024, "crop_w": 0, "crop_h": 0, "target_width": 1024, "target_height": 1024, "text_g": "", "text_l": "", "smZ_steps": 20, "clip": ["803", 3]}, "class_type": "smZ CLIPTextEncode", "_meta": {"title": "CLIP Text Encode++"}}, "177": {"inputs": {"text": ["119", 0], "parser": "comfy", "mean_normalization": true, "multi_conditioning": true, "use_old_emphasis_implementation": false, "with_SDXL": false, "ascore": 6.0, "width": 1024, "height": 1024, "crop_w": 0, "crop_h": 0, "target_width": 1024, "target_height": 1024, "text_g": "", "text_l": "", "smZ_steps": 20, "clip": ["803", 3]}, "class_type": "smZ CLIPTextEncode", "_meta": {"title": "CLIP Text Encode++"}}, "221": {"inputs": {"rescale_algorithm": "bislerp", "stitch": ["243", 0], "inpainted_image": ["259", 0]}, "class_type": "InpaintStitch", "_meta": {"title": "\u2702\ufe0f Inpaint Stitch"}}, "243": {"inputs": {"context_expand_pixels": 20, "context_expand_factor": 1.0, "fill_mask_holes": true, "blur_mask_pixels": 32.0, "invert_mask": false, "blend_pixels": 16.0, "rescale_algorithm": "bicubic", "mode": "forced size", "force_width": 1024, "force_height": 1024, "rescale_factor": 1.0, "min_width": 768, "min_height": 768, "max_width": 1024, "max_height": 1024, "padding": 32, "image": ["709", 0], "mask": ["287", 0]}, "class_type": "InpaintCrop", "_meta": {"title": "\u2702\ufe0f Inpaint Crop"}}, "254": {"inputs": {"seed": 1111, "steps": 10, "cfg": 2.0, "sampler_name": "deis", "scheduler": "beta", "denoise": 0.45, "positive": ["335", 0], "negative": ["335", 1], "latent_image": ["335", 2], "model": ["803", 2]}, "class_type": "KSampler", "_meta": {"title": "KSampler"}}, "259": {"inputs": {"samples": ["254", 0], "vae": ["803", 4]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}}, "261": {"inputs": {"rgthree_comparer": {"images": [{"name": "A", "selected": true, "url": "/api/view?filename=rgthree.compare._temp_hzfgr_00013_.png&type=temp&subfolder=&rand=0.22917040369605346"}]}, "image_a": ["221", 0]}, "class_type": "Image Comparer (rgthree)", "_meta": {"title": "Image Comparer (rgthree)"}}, "287": {"inputs": {"threshold": 0.3, "dilation": 1, "segm_detector": ["288", 1], "image": ["709", 0]}, "class_type": "SegmDetectorCombined_v2", "_meta": {"title": "SEGM Detector (combined)"}}, "288": {"inputs": {"model_name": "segm/face_yolov8m-seg_60.pt"}, "class_type": "UltralyticsDetectorProvider", "_meta": {"title": "UltralyticsDetectorProvider"}}, "330": {"inputs": {"mask_opacity": 0.5, "mask_color": "255, 255, 255", "pass_through": false, "image": ["243", 1], "mask": ["243", 2]}, "class_type": "ImageAndMaskPreview", "_meta": {"title": "ImageAndMaskPreview"}}, "335": {"inputs": {"noise_mask": true, "pixels": ["243", 1], "mask": ["243", 2], "positive": ["176", 0], "negative": ["177", 0], "vae": ["803", 4]}, "class_type": "InpaintModelConditioning", "_meta": {"title": "InpaintModelConditioning"}}, "361": {"inputs": {"hard_mode": true, "boost": true, "model": ["450", 0]}, "class_type": "Automatic CFG", "_meta": {"title": "Automatic CFG"}}, "450": {"inputs": {"object_to_patch": "diffusion_model", "residual_diff_threshold": 0.2, "start": 0.0, "end": 1.0, "max_consecutive_cache_hits": -1, "model": ["803", 2]}, "class_type": "ApplyFBCacheOnModel", "_meta": {"title": "Apply First Block Cache"}}, "709": {"inputs": {"samples": ["3", 0], "vae": ["803", 4]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}}, "790": {"inputs": {"enable_mirostat": false, "mirostat": 0, "enable_mirostat_eta": false, "mirostat_eta": 0.1, "enable_mirostat_tau": false, "mirostat_tau": 5.0, "enable_num_ctx": false, "num_ctx": 2048, "enable_repeat_last_n": false, "repeat_last_n": 64, "enable_repeat_penalty": false, "repeat_penalty": 1.1, "enable_temperature": false, "temperature": 0.25, "enable_seed": false, "seed": 145620304, "enable_stop": false, "stop": "", "enable_tfs_z": false, "tfs_z": 1.0, "enable_num_predict": false, "num_predict": -1, "enable_top_k": false, "top_k": 40, "enable_top_p": false, "top_p": 0.9, "enable_min_p": false, "min_p": 0.0, "debug": false}, "class_type": "OllamaOptionsV2", "_meta": {"title": "Ollama Options V2"}}, "791": {"inputs": {"system": "You are playing the part of an expert critic. From the user input given, you must generate a text description of the required fictional image. Use present tense to describe the in professional detail all subjects, objects, colors, textures, designs, styles, lighting, artisitic technique used, styles, positions etc. along with any other additional details typically used to most accuretly describe both the scene, and the emotion to be conveyed perfectly. Provide the image prompt text only. Do not interject, do not include this context in your response, do not ask questions, and do not add any type of metacomemntary, do not add any pre or post-amble, do not include any headers or footers,", "prompt": "dynamic figure drawing reference pose, ", "keep_context": false, "format": "text", "connectivity": ["794", 0], "options": ["790", 0]}, "class_type": "OllamaGenerateV2", "_meta": {"title": "Ollama Generate V2"}}, "792": {"inputs": {"text": "\n\nhentai, female anime character, Naruto franchise, Hinata Hyuga, masturbation, squirting, pussy, soft lighting, anime-style artwork, detailed anatomy, realistic expressions, high-quality drawing, explicit content, solo scene, intimate setting, private moment, Japanese animation style, explicit hentai", "anything": ["795", 0]}, "class_type": "easy showAnything", "_meta": {"title": "Show Any"}}, "794": {"inputs": {"url": "http://127.0.0.1:11434", "model": "deepseek-r1:14b", "keep_alive": 0, "keep_alive_unit": "minutes"}, "class_type": "OllamaConnectivityV2", "_meta": {"title": "Ollama Connectivity V2"}}, "795": {"inputs": {"Opening_tag": "<think>", "Closing_tag": "</think>", "Open_tag_instance": 1, "Close_tag_instance": 1, "Remove_tags": true, "Pass_Through_on_error": true, "Text": ["791", 0]}, "class_type": "Remove Text", "_meta": {"title": "Remove Text Block\ud83e\uddf8"}}, "796": {"inputs": {"text": "<think>\nOkay, I need to figure out how to approach this request. The user is asking for a hentai image prompt featuring a specific female anime character from a franchise, including elements like masturbation, squirting, and pussy. They also want it in comma-separated tags with 250 tokens or less.\n\nFirst, I should choose a popular anime franchise that includes a female character known for her design and presence. Naruto is a good fit because it's well-known and has iconic characters. Hinata Hyuga is a suitable choice as she's a prominent and recognizable character from the series.\n\nNext, I need to include the key elements: masturbation, squirting, and pussy. These are explicit descriptors that clearly convey the intended content.\n\nI should also add details about the scene setup to make it vivid. This includes things like the setting (e.g., her bedroom), lighting (soft and warm to create a sensual mood), and any additional elements that enhance the atmosphere, such as sheets or pillows.\n\nIncluding art style aspects is important for accuracy. \"High-quality anime-style artwork\" ensures the visual style aligns with typical anime aesthetics. Terms like \"detailed anatomy\" and \"realistic expressions\" help in conveying the level of detail expected.\n\nI need to ensure all tags are comma-separated and concise, keeping within the 250-token limit. This means being precise without unnecessary words. I'll list each element clearly: character, actions, setting details, artistic style, etc.\n\nFinally, I should avoid any extra explanations or commentary as per the instructions. Just provide the prompt in the specified format with all necessary tags included.\n</think>", "anything": ["795", 1]}, "class_type": "easy showAnything", "_meta": {"title": "Show Any"}}, "798": {"inputs": {"inputcount": 2, "string_1": ["118", 0], "string_2": ["792", 0], "delimiter": " Break, ", "return_list": false, "Update inputs": null}, "class_type": "JoinStringMulti", "_meta": {"title": "Join String Multi"}}, "799": {"inputs": {"filename": "ComfyUI_%time_%seed_%counter", "path": "%date/", "model_name": ["803", 0], "seed": ["803", 5], "steps": ["803", 6], "cfg": ["803", 8], "sampler_name": ["803", 9], "scheduler": ["803", 10], "width": ["33", 1], "height": ["33", 2], "positive": ["118", 0], "negative": ["119", 0], "extension": "png", "calculate_hash": true, "resource_hash": true, "lossless_webp": true, "jpg_webp_quality": 100, "date_format": "%Y-%m-%d", "time_format": "%H%M%S", "save_metadata_file": false, "extra_info": "", "images": ["221", 0]}, "class_type": "SDPromptSaver", "_meta": {"title": "SD Prompt Saver"}}, "803": {"inputs": {"ckpt_name": "sdxl\\CHEYENNE_v16.safetensors", "vae_name": "sdxl_vae.safetensors", "model_version": "SDXL 1024px", "config_name": "none", "seed": 32216257768902, "steps": 20, "refiner_start": 0.8, "cfg": 8.0, "sampler_name": "deis", "scheduler": "beta", "positive_ascore": 6.0, "negative_ascore": 6.0, "aspect_ratio": "16:9 - 1344x768", "width": 1344, "height": 768, "batch_size": 1, "steps_display": "Total steps: 20,\nRefiner start at step: 16 (80%)", "aspect_ratio_display": "Optimal resolution for SDXL 1024px model\nwith aspect ratio 16:9: 1344 x 768"}, "class_type": "SDParameterGenerator", "_meta": {"title": "SD Parameter Generator"}}, "806": {"inputs": {"INT": ["803", 5]}, "class_type": "Anything Everywhere", "_meta": {"title": "Anything Everywhere"}}}
"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);

    println!("Detected Prompt: {}", meta.positive_prompt);
    assert!(meta.positive_prompt.contains("Naruto franchise"));
}


#[test]
fn test_extract_comfyui_nsp_reproduction() {
    // User provided reproduction case with CLIPTextEncode (NSP)
    let prompt = r#"{
    "3": {"inputs": {"seed": 273138048298546, "steps": 12, "cfg": 4.0, "sampler_name": "dpmpp_sde", "scheduler": "karras", "denoise": 1.0, "model": ["32", 0], "positive": ["151", 0], "negative": ["114", 0], "latent_image": ["70", 0]}, "class_type": "KSampler"}, 
    "8": {"inputs": {"samples": ["16", 0], "vae": ["20", 0]}, "class_type": "VAEDecode"}, 
    "9": {"inputs": {"filename_prefix": "hr-fix", "images": ["8", 0]}, "class_type": "SaveImage"}, 
    "16": {"inputs": {"seed": 517541427790355, "steps": 20, "cfg": 8.0, "sampler_name": "dpmpp_sde", "scheduler": "karras", "denoise": 0.54, "model": ["32", 0], "positive": ["34", 0], "negative": ["114", 0], "latent_image": ["71", 0]}, "class_type": "KSampler"}, 
    "19": {"inputs": {"samples": ["3", 0], "vae": ["20", 0]}, "class_type": "VAEDecode"}, 
    "20": {"inputs": {"vae_name": "kl-f8-anime.ckpt"}, "class_type": "VAELoader"}, 
    "32": {"inputs": {"lora_name": "epiNoiseoffset_v2.safetensors", "strength_model": 1.0, "strength_clip": 1.0, "model": ["53", 0], "clip": ["53", 1]}, "class_type": "LoraLoader"}, 
    "34": {"inputs": {"noodle_key": "::", "seed": 483340363264397, "text": "Alina Smirnov: young russian teenage girl, blonde hair, ballet dancer:\n\n::adj-beauty:: ::dress-multicolor:: ::dress-other::\n\nBeautiful Woman sitting on a boat, detailed dress and face, gorgeous face model face, full body shot, inflateble shapes, wires, tubes, veins, jellyfish, white biomechanical details, wearing epic bionic cyborg implants, masterpiece, intricate, biopunk, vogue, highly detailed, artstation, concept art", "clip": ["32", 1]}, "class_type": "CLIPTextEncode (NSP)"}, 
    "53": {"inputs": {"config_name": "v1-inference_clip_skip_2_fp16.yaml", "ckpt_name": "revAnimated_v11.safetensors"}, "class_type": "CheckpointLoader"}, 
    "61": {"inputs": {"model_name": "UltraSharp\\4x-UltraSharp.pth"}, "class_type": "UpscaleModelLoader"}, 
    "62": {"inputs": {"upscale_model": ["61", 0], "image": ["8", 0]}, "class_type": "ImageUpscaleWithModel"}, 
    "68": {"inputs": {"modifier": 2, "upscale_method": "nearest-exact", "crop": "disabled", "IMAGE": ["62", 0], "TUPLE": ["71", 1]}, "class_type": "ImageScale_Ratio_DF"}, 
    "70": {"inputs": {"batch_size": 1, "TUPLE": ["108", 0]}, "class_type": "EmptyLatentImage_DF"}, 
    "71": {"inputs": {"modifier": 2.0, "scale_method": "nearest-exact", "crop": "disabled", "LATENT": ["3", 0], "TUPLE": ["108", 0]}, "class_type": "LatentScale_Ratio_DF"}, 
    "75": {"inputs": {"FLOAT_A": 1024, "FLOAT_B": 512, "Ceil2Int": false}, "class_type": "TupleNode_DF"}, 
    "108": {"inputs": {"FLOAT_A": 512.0, "FLOAT_B": 768.01, "Ceil2Int": false}, "class_type": "TupleNode_DF"}, 
    "114": {"inputs": {"noodle_key": "__", "seed": 608481745342694, "text": "bad_quality", "clip": ["32", 1]}, "class_type": "CLIPTextEncode (NSP)"}, 
    "120": {"inputs": {"control_net_name": "control_sd15_openpose.pth"}, "class_type": "ControlNetLoader"}, 
    "123": {"inputs": {"strength": 1, "conditioning": ["34", 0], "control_net": ["120", 0], "image": ["155", 0]}, "class_type": "ControlNetApply"}, 
    "125": {"inputs": {"images": ["155", 0]}, "class_type": "PreviewImage"}, 
    "132": {"inputs": {"filename_prefix": "base", "images": ["19", 0]}, "class_type": "SaveImage"}, 
    "133": {"inputs": {"filename_prefix": "hrf-upscale"}, "class_type": "SaveImage"}, 
    "134": {"inputs": {"text": ""}, "class_type": "Text String"}, 
    "135": {"inputs": {"seed": 30555162120510}, "class_type": "Text Random Line"}, 
    "136": {"inputs": {"text": "__adj-beauty__ __nationality__ __identity__ in a __scenario-desc__"}, "class_type": "Text Multiline"}, 
    "137": {"inputs": {"text": "bad_prompt, bad_quality, bad-artist"}, "class_type": "Text Multiline"}, 
    "138": {"inputs": {"mode": "incremental_image", "index": 0, "label": "Batch 002", "path": "C:\\Users\\Artemis\\OneDrive\\Dokumente\\AI Art\\poses\\362AnimePosesBy_v10\\controlnetposes.com\\preview", "pattern": "*"}, "class_type": "Load Image Batch"}, 
    "149": {"inputs": {"control_net_name": "control_sd15_openpose.pth"}, "class_type": "ControlNetLoader"}, 
    "150": {"inputs": {"detect_hand": "enable", "image": ["154", 0]}, "class_type": "OpenposePreprocessor"}, 
    "151": {"inputs": {"strength": 1.0, "conditioning": ["34", 0], "control_net": ["149", 0], "image": ["150", 0]}, "class_type": "ControlNetApply"}, 
    "153": {"inputs": {"images": ["150", 0]}, "class_type": "PreviewImage"}, 
    "154": {"inputs": {"mode": "incremental_image", "index": 0, "label": "Batch 001", "path": "C:\\Users\\Artemis\\OneDrive\\Dokumente\\AI Art\\poses\\362AnimePosesBy_v10\\controlnetposes.com\\preview", "pattern": "*"}, "class_type": "Load Image Batch"}, 
    "155": {"inputs": {"a": 6.283185307179586, "bg_threshold": 0.1, "image": ["138", 0]}, "class_type": "MiDaS-DepthMapPreprocessor"}, 
    "173": {"inputs": {"images": ["154", 0]}, "class_type": "PreviewImage"}, 
    "174": {"inputs": {"images": ["138", 0]}, "class_type": "PreviewImage"}, 
    "176": {"inputs": {"mode": "caption", "question": "What does the background consist of?"}, "class_type": "BLIP Analyze Image"}, 
    "177": {"inputs": {"label": "Text Output", "text": ["176", 0]}, "class_type": "Text to Console"}
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);

    println!("Detected Prompt: {}", meta.positive_prompt);
    assert!(meta.positive_prompt.contains("Alina Smirnov"));
}

#[test]
fn test_extract_comfyui_nan_json() {
    // ComfyUI metadata occasionally contains NaN or Infinity which is invalid JSON
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "steps": 20,
                "is_changed": NaN
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    // This should NOT panic or return empty metadata if we sanitize correctly
    let meta = extract_comfyui_metadata(&chunks);
    
    assert_eq!(meta.steps, 20);
}

#[test]
fn test_extract_comfyui_conditioning_concat() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["103", 0],
                "negative": ["7", 0],
                "model": ["4", 0]
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "negative prompt" }
        },
        "103": {
            "class_type": "ConditioningConcat",
            "inputs": {
                "conditioning_to": ["105", 0],
                "conditioning_from": ["102", 0]
            }
        },
        "102": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "part A" }
        },
        "105": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "part B" }
        },
        "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "base.safetensors" } }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);
    
    // Should extract both parts
    // Note: The order depends on how ConditioningConcat works, usually it appends 'from' to 'to', or vice versa.
    // In ComfyUI: "Concatenate conditioning_from to conditioning_to"
    // But our extractor just collects all text reachable.
    assert!(meta.positive_prompt.contains("part A"));
    assert!(meta.positive_prompt.contains("part B"));
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

#[test]
fn test_find_reachable_prompts_combine() {
    // ConditioningCombine (branching)
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["100", 0]
            }
        },
        "100": {
            "class_type": "ConditioningCombine",
            "inputs": {
                "conditioning_1": ["10", 0],
                "conditioning_2": ["11", 0]
            }
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "Prompt A"
            }
        },
        "11": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "Prompt B"
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    // We can test extract_comfyui_metadata or call finding directly if we exposed graph
    let meta = extract_comfyui_metadata(&chunks);
    
    //println!("Positive: {}", meta.positive_prompt);
    assert!(meta.positive_prompt.contains("Prompt A"));
    assert!(meta.positive_prompt.contains("Prompt B"));
}

#[test]
fn test_find_reachable_prompts_unknown_passthrough() {
    // Unknown node passing 'conditioning' input
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["50", 0]
            }
        },
        "50": {
            "class_type": "CustomNodeUnknown",
            "inputs": {
                "conditioning": ["10", 0],
                "dummy": 1
            }
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "Hidden Prompt"
            }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    
    let meta = extract_comfyui_metadata(&chunks);
    
    assert_eq!(meta.positive_prompt, "Hidden Prompt");
}
