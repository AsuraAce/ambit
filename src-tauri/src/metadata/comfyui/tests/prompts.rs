use crate::metadata::comfyui::*;
use std::collections::HashMap;

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
    assert_eq!(
        meta.positive_prompt,
        "trigger_abc, A battle-hardened mercenary captain..."
    );
    assert_eq!(meta.embeddings.len(), 0);
}

#[test]
fn test_extract_comfyui_embeddings() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["10", 0],
                "negative": ["11", 0]
            }
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "a cute cat, (embedding:very_cute:1.2), <embedding:cat_style>" }
        },
        "11": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "embedding:bad_quality, lowres" }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.embeddings.len(), 3);
    assert!(meta.embeddings.contains(&"very_cute".to_string()));
    assert!(meta.embeddings.contains(&"cat_style".to_string()));
    assert!(meta.embeddings.contains(&"bad_quality".to_string()));
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

    assert!(meta
        .positive_prompt
        .contains("hentai, female anime character"));
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
fn test_extract_comfyui_text_concatenate() {
    // User report: Text to Conditioning -> Text Concatenate
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["183", 0],
                "negative": ["114", 0],
                "model": ["32", 0]
            }
        },
        "183": {
            "class_type": "Text to Conditioning",
            "inputs": {
                "text": ["179", 0],
                "clip": ["32", 1]
            }
        },
        "179": {
            "class_type": "Text Concatenate",
            "inputs": {
                "text_a": ["134", 0],
                "text_b": ["136", 0],
                "linebreak_addition": "true"
            }
        },
        "134": {
            "class_type": "Text String",
            "inputs": { "text": "Part A" }
        },
        "136": {
            "class_type": "Text Multiline",
            "inputs": { "text": "Part B" }
        },
        "114": { "class_type": "CLIPTextEncode", "inputs": { "text": "negative" } },
        "32": { "class_type": "LoraLoader", "inputs": { "model": ["53",0], "clip": ["53",1] } },
        "53": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "base.safetensors" } }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert!(meta.positive_prompt.contains("Part A"));
    assert!(meta.positive_prompt.contains("Part B"));
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

#[test]
fn test_missing_prompt_extraction() {
    // This test replicates the specific workflow provided by the user where prompt extraction fails.
    // It involves PrimitiveString, JoinStringMulti, TriggerWord Toggle (LoraManager), and recursive inputs.
    let prompt = r#"{
        "44": {
            "inputs": {
                "positive": ["48", 0],
                "model": ["47", 0]
            },
            "class_type": "KSampler"
        },
        "48": {
            "inputs": {
                "conditioning": ["45", 0]
            },
            "class_type": "SeedVarianceEnhancer"
        },
        "45": {
            "inputs": {
                "text": ["81", 0],
                "clip": ["79", 1]
            },
            "class_type": "CLIPTextEncode"
        },
        "81": {
            "inputs": {
                "string_1": ["84", 0],
                "string_2": ["82", 0],
                "delimiter": ", "
            },
            "class_type": "JoinStringMulti"
        },
        "82": {
            "inputs": {
                "value": ["80", 0]
            },
            "class_type": "PrimitiveString"
        },
        "84": {
            "inputs": {
                "value": "Aiyana Lumiere Nyoka..."
            },
            "class_type": "PrimitiveStringMultiline"
        },
        "80": {
            "inputs": {
                "trigger_words": ["79", 2]
            },
            "class_type": "TriggerWord Toggle (LoraManager)"
        },
        "79": {
            "inputs": {
                "text": "<lora:Mystic-XXX:1.0> <lora:Asians:0.65>",
                "loras": {
                     "__value__": [
                         { "name": "Mystic-XXX", "strength": 1.0 },
                         { "name": "Asians", "strength": 0.65 }
                     ]
                }
            },
            "class_type": "Lora Loader (LoraManager)"
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    println!("Extracted Positive Prompt: '{}'", meta.positive_prompt);

    // Debug assertion
    assert_eq!(
        meta.positive_prompt,
        "Aiyana Lumiere Nyoka..., <lora:Mystic-XXX:1.0> <lora:Asians:0.65>"
    );
}
