use super::super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer};
use crate::metadata::comfyui::*;
use crate::metadata::ImageMetadata;
use serde_json::{json, Value};
use std::collections::HashMap;

fn extract_transform_prompt(nodes: Vec<(&str, Value)>) -> (ImageMetadata, ComfyParseDiagnostics) {
    let mut graph = json!({
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": ["3", 0] } },
        "90": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "seed": 1,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "91": { "class_type": "VAEDecode", "inputs": { "samples": ["90", 0] } },
        "92": { "class_type": "SaveImage", "inputs": { "images": ["91", 0] } }
    })
    .as_object()
    .expect("test graph should be an object")
    .clone();
    for (node_id, node) in nodes {
        graph.insert(node_id.to_string(), node);
    }

    let chunks = HashMap::from([("prompt".to_string(), Value::Object(graph).to_string())]);
    extract_comfyui_metadata_with_diagnostics(&chunks)
}

fn extract_workflow_transform_prompt(
    transform_nodes: Vec<Value>,
    transform_links: Vec<Value>,
) -> (ImageMetadata, ComfyParseDiagnostics) {
    let mut nodes = vec![
        json!({
            "id": 1,
            "type": "UNETLoader",
            "inputs": [],
            "outputs": [{ "name": "MODEL", "type": "MODEL", "links": [1] }],
            "widgets_values": ["model.safetensors"]
        }),
        json!({
            "id": 2,
            "type": "CLIPTextEncode",
            "inputs": [{ "name": "text", "type": "STRING", "link": 2 }],
            "outputs": [{ "name": "CONDITIONING", "type": "CONDITIONING", "links": [3] }],
            "widgets_values": ["stale encoded prompt"]
        }),
        json!({
            "id": 90,
            "type": "KSampler",
            "inputs": [
                { "name": "model", "type": "MODEL", "link": 1 },
                { "name": "positive", "type": "CONDITIONING", "link": 3 }
            ],
            "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [4] }],
            "widgets_values": [1, "fixed", 4, 1.0, "euler", "simple", 1.0]
        }),
        json!({
            "id": 91,
            "type": "VAEDecode",
            "inputs": [{ "name": "samples", "type": "LATENT", "link": 4 }],
            "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [5] }]
        }),
        json!({
            "id": 92,
            "type": "SaveImage",
            "inputs": [{ "name": "images", "type": "IMAGE", "link": 5 }]
        }),
    ];
    nodes.extend(transform_nodes);

    let mut links = vec![
        json!([1, 1, 0, 90, 0, "MODEL"]),
        json!([2, 3, 0, 2, 0, "STRING"]),
        json!([3, 2, 0, 90, 1, "CONDITIONING"]),
        json!([4, 90, 0, 91, 0, "LATENT"]),
        json!([5, 91, 0, 92, 0, "IMAGE"]),
    ];
    links.extend(transform_links);

    let workflow = json!({ "nodes": nodes, "links": links });
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);
    extract_comfyui_metadata_with_diagnostics(&chunks)
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
    assert_eq!(
        meta.positive_prompt,
        "trigger_abc, A battle-hardened mercenary captain..."
    );
    assert_eq!(meta.embeddings.len(), 0);
}

#[test]
fn test_extract_comfyui_switch_string_concatenate_and_preview() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["10", 0],
                "model": ["20", 0]
            }
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": ["11", 0] }
        },
        "11": {
            "class_type": "ComfySwitchNode",
            "inputs": {
                "switch": ["12", 0],
                "on_false": ["13", 0],
                "on_true": ["14", 0]
            }
        },
        "12": {
            "class_type": "PrimitiveBoolean",
            "inputs": { "value": false }
        },
        "13": {
            "class_type": "PreviewAny",
            "inputs": { "source": ["15", 0] }
        },
        "15": {
            "class_type": "StringConcatenate",
            "inputs": {
                "string_a": ["16", 0],
                "string_b": "beta",
                "delimiter": ", "
            }
        },
        "16": {
            "class_type": "PrimitiveStringMultiline",
            "inputs": { "value": "alpha" }
        },
        "14": {
            "class_type": "PrimitiveStringMultiline",
            "inputs": { "value": "wrong branch" }
        },
        "20": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "krea2_turbo_fp8_scaled.safetensors" }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "alpha, beta");
}

#[test]
fn test_extract_comfyui_switch_string_true_branch() {
    let prompt = r#"{
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["10", 0],
                "model": ["20", 0]
            }
        },
        "10": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": ["11", 0] }
        },
        "11": {
            "class_type": "ComfySwitchNode",
            "inputs": {
                "switch": ["12", 0],
                "on_false": ["13", 0],
                "on_true": ["14", 0]
            }
        },
        "12": {
            "class_type": "PrimitiveBoolean",
            "inputs": { "value": true }
        },
        "13": {
            "class_type": "PrimitiveStringMultiline",
            "inputs": { "value": "wrong branch" }
        },
        "14": {
            "class_type": "PrimitiveStringMultiline",
            "inputs": { "value": "chosen prompt" }
        },
        "20": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "krea2_turbo_fp8_scaled.safetensors" }
        }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "chosen prompt");
}

#[test]
fn test_extract_comfyui_workflow_clip_text_widget_prompts() {
    let workflow = r#"{
        "nodes": [
            {"id": 1, "type": "UNETLoader", "widgets_values": ["model.safetensors"]},
            {"id": 2, "type": "CLIPTextEncode", "widgets_values": ["literal positive"]},
            {"id": 3, "type": "CLIPTextEncode", "widgets_values": ["literal negative"]},
            {
                "id": 4,
                "type": "KSampler",
                "inputs": [
                    {"name": "model", "type": "MODEL", "link": 1},
                    {"name": "positive", "type": "CONDITIONING", "link": 6},
                    {"name": "negative", "type": "CONDITIONING", "link": 7}
                ],
                "outputs": [{"name": "LATENT", "type": "LATENT", "links": [4]}],
                "widgets_values": [1, "fixed", 4, 1, "euler", "simple", 1]
            },
            {
                "id": 5,
                "type": "VAEDecode",
                "inputs": [{"name": "samples", "type": "LATENT", "link": 4}],
                "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [5]}]
            },
            {
                "id": 6,
                "type": "SaveImage",
                "inputs": [{"name": "images", "type": "IMAGE", "link": 5}]
            },
            {
                "id": 7,
                "type": "ControlNetApplyAdvanced",
                "inputs": [
                    {"name": "positive", "type": "CONDITIONING", "link": 2},
                    {"name": "negative", "type": "CONDITIONING", "link": 3}
                ],
                "outputs": [
                    {"name": "positive", "type": "CONDITIONING", "links": [6]},
                    {"name": "negative", "type": "CONDITIONING", "links": [7]}
                ]
            }
        ],
        "links": [
            [1, 1, 0, 4, 0, "MODEL"],
            [2, 2, 0, 7, 0, "CONDITIONING"],
            [3, 3, 0, 7, 1, "CONDITIONING"],
            [4, 4, 0, 5, 0, "LATENT"],
            [5, 5, 0, 6, 0, "IMAGE"],
            [6, 7, 0, 4, 1, "CONDITIONING"],
            [7, 7, 1, 4, 2, "CONDITIONING"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "literal positive");
    assert_eq!(meta.negative_prompt, "literal negative");
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
        "Aiyana Lumiere Nyoka..., <lora:Mystic-XXX:1> <lora:Asians:0.65>"
    );
}

#[test]
fn test_extract_comfyui_flux_zero_out_negative() {
    // Reproduction of the issue where ConditioningZeroOut is ignored,
    // causing the positive prompt to be extracted as negative.
    let prompt = r#"{
        "31": {
            "class_type": "KSampler",
            "inputs": {
                "positive": ["35", 0],
                "negative": ["135", 0],
                "model": ["37", 0],
                "latent_image": ["124", 0]
            }
        },
        "35": {
            "class_type": "FluxGuidance",
            "inputs": {
                "conditioning": ["177", 0]
            }
        },
        "135": {
            "class_type": "ConditioningZeroOut",
            "inputs": {
                "conditioning": ["6", 0]
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "color the androids hair green, only the hair not the eyes or the explosion"
            }
        },
        "177": {
            "class_type": "ReferenceLatent",
            "inputs": {
                "conditioning": ["6", 0],
                "latent": ["124", 0]
            }
        },
        "124": { "class_type": "VAEEncode", "inputs": { "pixels": ["42", 0], "vae": ["39", 0] } },
        "37": { "class_type": "UNETLoader", "inputs": { "unet_name": "flux1.safetensors" } },
        "39": { "class_type": "VAELoader", "inputs": { "vae_name": "ae.safetensors" } },
        "42": { "class_type": "FluxKontextImageScale", "inputs": { "image": ["146", 0] } },
        "146": { "class_type": "ImageStitch", "inputs": { "image1": ["190", 0], "image2": ["191", 0] } },
        "190": { "class_type": "LoadImage", "inputs": { "image": "img1.png" } },
        "191": { "class_type": "LoadImage", "inputs": { "image": "img2.png" } }
    }"#;

    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(
        meta.positive_prompt,
        "color the androids hair green, only the hair not the eyes or the explosion"
    );
    // This is the critical part: it should NOT be the same as positive_prompt
    assert_eq!(meta.negative_prompt, "");
}

#[test]
fn linked_clip_text_is_authoritative_over_stale_direct_value() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "stale widget prompt" },
            "_resolved_inputs": { "text": "3" }
        },
        "3": { "class_type": "PrimitiveStringMultiline", "inputs": { "value": "linked prompt" } },
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "seed": 1,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "5": { "class_type": "VAEDecode", "inputs": { "samples": ["4", 0] } },
        "6": { "class_type": "SaveImage", "inputs": { "images": ["5", 0] } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "linked prompt");
}

#[test]
fn authoritative_unresolved_sampler_prompt_blocks_disconnected_global_fallback() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "stale widget prompt" },
            "_resolved_inputs": { "text": "3" }
        },
        "3": { "class_type": "TextGenerate", "inputs": { "prompt": "generator instruction" } },
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "seed": 1,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "5": { "class_type": "VAEDecode", "inputs": { "samples": ["4", 0] } },
        "6": { "class_type": "SaveImage", "inputs": { "images": ["5", 0] } },
        "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "disconnected stale prompt" } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.positive_prompt, "");
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        None
    );
}

#[test]
fn basic_guider_linked_conditioning_blocks_disconnected_global_prompt_fallback() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": { "class_type": "TextGenerate", "inputs": { "prompt": "generator instruction" } },
        "3": { "class_type": "CLIPTextEncode", "inputs": { "text": ["2", 0] } },
        "4": {
            "class_type": "BasicGuider",
            "inputs": {
                "model": ["1", 0],
                "conditioning": ["3", 0]
            }
        },
        "5": { "class_type": "RandomNoise", "inputs": { "noise_seed": 1 } },
        "6": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "7": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": ["1", 0],
                "scheduler": "simple",
                "steps": 4,
                "denoise": 1.0
            }
        },
        "8": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512 } },
        "9": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["5", 0],
                "guider": ["4", 0],
                "sampler": ["6", 0],
                "sigmas": ["7", 0],
                "latent_image": ["8", 0]
            }
        },
        "10": { "class_type": "VAEDecode", "inputs": { "samples": ["9", 0] } },
        "11": { "class_type": "SaveImage", "inputs": { "images": ["10", 0] } },
        "12": { "class_type": "CLIPTextEncode", "inputs": { "text": "disconnected stale prompt" } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.positive_prompt, "");
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        None
    );
}

#[test]
fn unresolved_linked_string_intermediaries_do_not_reopen_stale_literals() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": {
            "class_type": "CLIPTextEncode",
            "_resolved_inputs": { "text": "3" }
        },
        "3": {
            "class_type": "PrimitiveStringMultiline",
            "inputs": { "value": "stale direct prompt" },
            "_resolved_inputs": { "value": "7" }
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "_resolved_inputs": { "text": "5" }
        },
        "5": {
            "class_type": "PrimitiveStringMultiline",
            "widgets_values": ["stale widget prompt"],
            "_resolved_inputs": { "value": "8" }
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["4", 0],
                "seed": 1,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "7": { "class_type": "TextGenerate", "inputs": { "prompt": "positive instruction" } },
        "8": { "class_type": "TextGenerate", "inputs": { "prompt": "negative instruction" } },
        "9": { "class_type": "VAEDecode", "inputs": { "samples": ["6", 0] } },
        "10": { "class_type": "SaveImage", "inputs": { "images": ["9", 0] } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.positive_prompt, "");
    assert_eq!(meta.negative_prompt, "");
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        None
    );
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::NegativePrompt),
        None
    );
}

#[test]
fn linked_qwen_prompt_is_authoritative_over_stale_direct_value() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": { "prompt": "stale widget prompt" },
            "_resolved_inputs": { "prompt": "3" }
        },
        "3": { "class_type": "PrimitiveStringMultiline", "inputs": { "value": "linked qwen prompt" } },
        "4": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "seed": 1,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "5": { "class_type": "VAEDecode", "inputs": { "samples": ["4", 0] } },
        "6": { "class_type": "SaveImage", "inputs": { "images": ["5", 0] } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "linked qwen prompt");
}

#[test]
fn unlinked_qwen_prompt_remains_available() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": { "prompt": "direct qwen prompt" }
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "seed": 1,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "4": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0] } },
        "5": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "direct qwen prompt");
}

#[test]
fn unlinked_qwen_workflow_widget_remains_available() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "widgets_values": ["workflow qwen prompt"]
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "seed": 1,
                "steps": 4,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple"
            }
        },
        "4": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0] } },
        "5": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
    }"#;
    let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

    let meta = extract_comfyui_metadata(&chunks);

    assert_eq!(meta.positive_prompt, "workflow qwen prompt");
}

#[test]
fn string_replace_prefers_links_and_replaces_every_occurrence() {
    let (meta, diagnostics) = extract_transform_prompt(vec![
        (
            "3",
            json!({
                "class_type": "StringReplace",
                "inputs": {
                    "string": "stale {name}",
                    "find": "{name}",
                    "replace": "stale replacement"
                },
                "_resolved_inputs": { "string": "4", "replace": "5" }
            }),
        ),
        (
            "4",
            json!({ "class_type": "PrimitiveStringMultiline", "inputs": { "value": "hello {name}, {name}" } }),
        ),
        (
            "5",
            json!({ "class_type": "PrimitiveStringMultiline", "inputs": { "value": "Ada" } }),
        ),
    ]);

    assert_eq!(meta.positive_prompt, "hello Ada, Ada");
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        Some(&ComfyParseLayer::SamplerTraversal)
    );
}

#[test]
fn string_replace_supports_unlinked_workflow_widgets() {
    let (meta, _) = extract_transform_prompt(vec![(
        "3",
        json!({
            "class_type": "StringReplace",
            "widgets_values": ["alpha beta beta", "beta", "gamma"]
        }),
    )]);

    assert_eq!(meta.positive_prompt, "alpha gamma gamma");
}

#[test]
fn unresolved_or_cyclic_string_replace_does_not_reopen_stale_prompts() {
    let cases = [
        vec![
            (
                "3",
                json!({
                    "class_type": "StringReplace",
                    "widgets_values": ["stale prompt", "prompt", "result"],
                    "_resolved_inputs": { "string": "4" }
                }),
            ),
            (
                "4",
                json!({ "class_type": "TextGenerate", "inputs": { "prompt": "instruction" } }),
            ),
            (
                "99",
                json!({ "class_type": "CLIPTextEncode", "inputs": { "text": "disconnected prompt" } }),
            ),
        ],
        vec![
            (
                "3",
                json!({
                    "class_type": "StringReplace",
                    "inputs": { "find": "a", "replace": "b" },
                    "_resolved_inputs": { "string": "4" }
                }),
            ),
            (
                "4",
                json!({
                    "class_type": "StringReplace",
                    "inputs": { "find": "b", "replace": "a" },
                    "_resolved_inputs": { "string": "3" }
                }),
            ),
        ],
    ];

    for nodes in cases {
        let (meta, diagnostics) = extract_transform_prompt(nodes);
        assert_eq!(meta.positive_prompt, "");
        assert_eq!(
            diagnostics
                .field_sources
                .get(&ComfyMetadataField::PositivePrompt),
            None
        );
    }
}

#[test]
fn string_replace_rejects_empty_find_and_transform_budget_overflows() {
    let over_limit = "a".repeat(64 * 1024 + 1);
    let expansion_source = "a".repeat(32 * 1024 + 1);
    let oversized_pattern = "a".repeat(4 * 1024 + 1);
    let cases = [
        json!({ "class_type": "StringReplace", "inputs": { "string": "prompt", "find": "", "replace": "x" } }),
        json!({ "class_type": "StringReplace", "inputs": { "string": over_limit, "find": "a", "replace": "b" } }),
        json!({ "class_type": "StringReplace", "inputs": { "string": expansion_source, "find": "a", "replace": "aa" } }),
        json!({ "class_type": "StringReplace", "inputs": { "string": "prompt", "find": oversized_pattern, "replace": "x" } }),
    ];

    for transform in cases {
        let (meta, diagnostics) = extract_transform_prompt(vec![("3", transform)]);
        assert_eq!(meta.positive_prompt, "");
        assert_eq!(
            diagnostics
                .field_sources
                .get(&ComfyMetadataField::PositivePrompt),
            None
        );
    }
}

#[test]
fn regex_extract_supports_only_bounded_first_group_literals() {
    let (meta, diagnostics) = extract_transform_prompt(vec![
        (
            "3",
            json!({
                "class_type": "RegexExtract",
                "widgets_values": ["stale source", "(", "First Group", false, false, false, 1],
                "_resolved_inputs": { "string": "4", "regex_pattern": "5" }
            }),
        ),
        (
            "4",
            json!({ "class_type": "PrimitiveStringMultiline", "inputs": { "value": "zero\nselected\ntwo" } }),
        ),
        (
            "5",
            json!({ "class_type": "PrimitiveStringMultiline", "inputs": { "value": "^(?:[^\\n]*\\n){1}([^\\n]*)(?:\\n|$)" } }),
        ),
    ]);

    assert_eq!(meta.positive_prompt, "selected");
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        Some(&ComfyParseLayer::SamplerTraversal)
    );
}

#[test]
fn regex_extract_rejects_unsupported_or_invalid_configurations() {
    let oversized_pattern = "a".repeat(4 * 1024 + 1);
    let cases = [
        json!({ "class_type": "RegexExtract", "widgets_values": ["prompt", "(", "First Group", false, false, false, 1] }),
        json!({ "class_type": "RegexExtract", "widgets_values": ["prompt", "(prompt)", "First Match", false, false, false, 1] }),
        json!({ "class_type": "RegexExtract", "widgets_values": ["PROMPT", "(prompt)", "First Group", true, false, false, 1] }),
        json!({ "class_type": "RegexExtract", "widgets_values": ["prompt", "(prompt)", "First Group", false, true, false, 1] }),
        json!({ "class_type": "RegexExtract", "widgets_values": ["prompt", "(prompt)", "First Group", false, false, true, 1] }),
        json!({ "class_type": "RegexExtract", "widgets_values": ["prompt", "(prompt)", "First Group", false, false, false, 0] }),
        json!({ "class_type": "RegexExtract", "widgets_values": ["prompt", oversized_pattern, "First Group", false, false, false, 1] }),
    ];

    for transform in cases {
        let (meta, diagnostics) = extract_transform_prompt(vec![("3", transform)]);
        assert_eq!(meta.positive_prompt, "");
        assert_eq!(
            diagnostics
                .field_sources
                .get(&ComfyMetadataField::PositivePrompt),
            None
        );
    }
}

#[test]
fn string_concatenate_preserves_empty_sides_but_not_stale_link_fallbacks() {
    let (meta, _) = extract_transform_prompt(vec![(
        "3",
        json!({ "class_type": "StringConcatenate", "widgets_values": ["", "literal", ", "] }),
    )]);
    assert_eq!(meta.positive_prompt, "literal");

    let (meta, diagnostics) = extract_transform_prompt(vec![
        (
            "3",
            json!({
                "class_type": "StringConcatenate",
                "widgets_values": ["stale", "literal", ", "],
                "_resolved_inputs": { "string_a": "4" }
            }),
        ),
        (
            "4",
            json!({ "class_type": "TextGenerate", "inputs": { "prompt": "instruction" } }),
        ),
    ]);
    assert_eq!(meta.positive_prompt, "");
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        None
    );
}

#[test]
fn transform_cycles_through_preview_or_selected_switch_branch_return_no_prompt() {
    let cases = [
        vec![
            (
                "3",
                json!({
                    "class_type": "StringReplace",
                    "inputs": { "string": ["4", 0], "find": "a", "replace": "b" }
                }),
            ),
            (
                "4",
                json!({ "class_type": "PreviewAny", "inputs": { "source": ["3", 0] } }),
            ),
        ],
        vec![
            (
                "3",
                json!({
                    "class_type": "StringReplace",
                    "inputs": { "string": ["4", 0], "find": "a", "replace": "b" }
                }),
            ),
            (
                "4",
                json!({
                    "class_type": "ComfySwitchNode",
                    "inputs": {
                        "on_false": ["3", 0],
                        "on_true": ["5", 0],
                        "switch": false
                    }
                }),
            ),
            (
                "5",
                json!({ "class_type": "PrimitiveStringMultiline", "inputs": { "value": "unused" } }),
            ),
        ],
    ];

    for nodes in cases {
        let (meta, diagnostics) = extract_transform_prompt(nodes);
        assert_eq!(meta.positive_prompt, "");
        assert_eq!(
            diagnostics
                .field_sources
                .get(&ComfyMetadataField::PositivePrompt),
            None
        );
    }
}

#[test]
fn unresolved_workflow_transform_links_do_not_reopen_stale_widgets() {
    let transforms = [
        json!({
            "id": 3,
            "type": "StringReplace",
            "inputs": [
                { "name": "string", "type": "STRING", "link": 123 },
                { "name": "find", "type": "STRING", "link": null },
                { "name": "replace", "type": "STRING", "link": null }
            ],
            "outputs": [{ "name": "STRING", "type": "STRING", "links": [2] }],
            "widgets_values": ["stale prompt", "prompt", "result"]
        }),
        json!({
            "id": 3,
            "type": "RegexExtract",
            "inputs": [
                { "name": "string", "type": "STRING", "link": 123 },
                { "name": "regex_pattern", "type": "STRING", "link": null }
            ],
            "outputs": [{ "name": "STRING", "type": "STRING", "links": [2] }],
            "widgets_values": ["stale prompt", "(stale prompt)", "First Group", false, false, false, 1]
        }),
        json!({
            "id": 3,
            "type": "StringConcatenate",
            "inputs": [
                { "name": "string_a", "type": "STRING", "link": 123 },
                { "name": "string_b", "type": "STRING", "link": null },
                { "name": "delimiter", "type": "STRING", "link": null }
            ],
            "outputs": [{ "name": "STRING", "type": "STRING", "links": [2] }],
            "widgets_values": ["stale", "prompt", " "]
        }),
    ];

    for transform in transforms {
        let (meta, diagnostics) = extract_workflow_transform_prompt(vec![transform], vec![]);
        assert_eq!(meta.positive_prompt, "");
        assert_eq!(
            diagnostics
                .field_sources
                .get(&ComfyMetadataField::PositivePrompt),
            None
        );
    }
}

#[test]
fn workflow_transform_operands_preserve_short_and_empty_string_primitives() {
    let (meta, _) = extract_workflow_transform_prompt(
        vec![
            json!({
                "id": 3,
                "type": "StringReplace",
                "inputs": [
                    { "name": "string", "type": "STRING", "link": 10 },
                    { "name": "find", "type": "STRING", "link": 11 },
                    { "name": "replace", "type": "STRING", "link": 12 }
                ],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": [2] }],
                "widgets_values": ["stale", "stale", "stale"]
            }),
            json!({
                "id": 4,
                "type": "PrimitiveStringMultiline",
                "inputs": [{ "name": "value", "type": "STRING", "link": null }],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": [10] }],
                "widgets_values": ["aba"]
            }),
            json!({
                "id": 5,
                "type": "PrimitiveStringMultiline",
                "inputs": [{ "name": "value", "type": "STRING", "link": null }],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": [11] }],
                "widgets_values": ["a"]
            }),
            json!({
                "id": 6,
                "type": "PrimitiveStringMultiline",
                "inputs": [{ "name": "value", "type": "STRING", "link": null }],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": [12] }],
                "widgets_values": [""]
            }),
        ],
        vec![
            json!([10, 4, 0, 3, 0, "STRING"]),
            json!([11, 5, 0, 3, 1, "STRING"]),
            json!([12, 6, 0, 3, 2, "STRING"]),
        ],
    );
    assert_eq!(meta.positive_prompt, "b");

    let (meta, _) = extract_workflow_transform_prompt(
        vec![
            json!({
                "id": 3,
                "type": "RegexExtract",
                "inputs": [
                    { "name": "string", "type": "STRING", "link": 10 },
                    { "name": "regex_pattern", "type": "STRING", "link": 11 }
                ],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": [2] }],
                "widgets_values": ["stale", "stale", "First Group", false, false, false, 1]
            }),
            json!({
                "id": 4,
                "type": "PrimitiveStringMultiline",
                "inputs": [{ "name": "value", "type": "STRING", "link": null }],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": [10] }],
                "widgets_values": ["x"]
            }),
            json!({
                "id": 5,
                "type": "PrimitiveStringMultiline",
                "inputs": [{ "name": "value", "type": "STRING", "link": null }],
                "outputs": [{ "name": "STRING", "type": "STRING", "links": [11] }],
                "widgets_values": ["(.)"]
            }),
        ],
        vec![
            json!([10, 4, 0, 3, 0, "STRING"]),
            json!([11, 5, 0, 3, 1, "STRING"]),
        ],
    );
    assert_eq!(meta.positive_prompt, "x");

    for (left, right) in [("", "kept"), ("kept", "")] {
        let (meta, _) = extract_workflow_transform_prompt(
            vec![
                json!({
                    "id": 3,
                    "type": "StringConcatenate",
                    "inputs": [
                        { "name": "string_a", "type": "STRING", "link": 10 },
                        { "name": "string_b", "type": "STRING", "link": 11 },
                        { "name": "delimiter", "type": "STRING", "link": null }
                    ],
                    "outputs": [{ "name": "STRING", "type": "STRING", "links": [2] }],
                    "widgets_values": ["stale", "stale", ", "]
                }),
                json!({
                    "id": 4,
                    "type": "PrimitiveStringMultiline",
                    "inputs": [{ "name": "value", "type": "STRING", "link": null }],
                    "outputs": [{ "name": "STRING", "type": "STRING", "links": [10] }],
                    "widgets_values": [left]
                }),
                json!({
                    "id": 5,
                    "type": "PrimitiveStringMultiline",
                    "inputs": [{ "name": "value", "type": "STRING", "link": null }],
                    "outputs": [{ "name": "STRING", "type": "STRING", "links": [11] }],
                    "widgets_values": [right]
                }),
            ],
            vec![
                json!([10, 4, 0, 3, 0, "STRING"]),
                json!([11, 5, 0, 3, 1, "STRING"]),
            ],
        );
        assert_eq!(meta.positive_prompt, "kept");
    }
}
