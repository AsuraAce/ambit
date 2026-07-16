use super::super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
use serde_json::{json, Value};
use std::collections::HashMap;

fn chunks_with_prompt(prompt: &str) -> HashMap<String, String> {
    let mut chunks = HashMap::new();
    chunks.insert("prompt".to_string(), prompt.to_string());
    chunks
}

fn assert_field_source(
    diagnostics: &ComfyParseDiagnostics,
    field: ComfyMetadataField,
    layer: ComfyParseLayer,
) {
    assert_eq!(diagnostics.field_sources.get(&field), Some(&layer));
}

#[test]
fn connected_sampler_chain_uses_root_sampler_as_primary_metadata() {
    // Multi-stage workflows can end at a refiner/upscale sampler, but the current
    // single-field metadata model treats the root/base sampler as authoritative.
    let prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "refiner-model.safetensors" }
        },
        "2": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "base-model.safetensors" }
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "base positive prompt" }
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "base negative prompt" }
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }
        },
        "10": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 111,
                "steps": 30,
                "cfg": 7.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "model": ["2", 0],
                "positive": ["3", 0],
                "negative": ["4", 0],
                "latent_image": ["5", 0]
            }
        },
        "11": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 222,
                "steps": 8,
                "cfg": 4.0,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "model": ["1", 0],
                "positive": ["12", 0],
                "negative": ["13", 0],
                "latent_image": ["10", 0]
            }
        },
        "12": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "refiner positive prompt" }
        },
        "13": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "refiner negative prompt" }
        },
        "14": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["11", 0] }
        },
        "15": {
            "class_type": "SaveImage",
            "inputs": { "images": ["14", 0] }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "base_model");
    assert_eq!(meta.seed, Some(111));
    assert_eq!(meta.steps, 30);
    assert_eq!(meta.cfg, 7.5);
    assert_eq!(meta.sampler, "euler (normal)");
    assert_eq!(meta.positive_prompt, "base positive prompt");
    assert_eq!(meta.negative_prompt, "base negative prompt");

    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
        ComfyMetadataField::NegativePrompt,
    ] {
        assert_field_source(&diagnostics, field, ComfyParseLayer::SamplerTraversal);
    }
}

#[test]
fn unconnected_sampler_custom_core_sockets_do_not_use_wireless_candidates() {
    // A selected SamplerCustom owns absence on its typed sockets. Disconnected
    // singleton loaders and titled prompt nodes are not runtime connections.
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "wireless.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "_meta": { "title": "Positive Prompt" }, "inputs": { "text": "wireless positive" } },
        "3": { "class_type": "SamplerCustom", "inputs": { "noise_seed": 42, "cfg": 5.5 } },
        "4": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0] } },
        "5": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
    }"#;

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "Unknown");
    assert_eq!(meta.positive_prompt, "");
    assert_eq!(meta.negative_prompt, "");
}

#[test]
fn saved_output_reroute_reaches_sampler_custom() {
    // API Reroute uses the empty input name. It is transparent on the bounded
    // saved-output walk, so the connected SamplerCustom remains authoritative.
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "routed.safetensors" } },
        "2": { "class_type": "SamplerCustom", "inputs": { "model": ["1", 0], "noise_seed": 42, "cfg": 5.5 } },
        "3": { "class_type": "VAEDecode", "inputs": { "samples": ["2", 0] } },
        "4": { "class_type": "Reroute", "inputs": { "": ["3", 0] } },
        "5": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert_eq!(meta.model, "routed");
    assert_eq!(meta.seed, Some(42));
}

#[test]
fn sampler_custom_model_and_conditioning_follow_reroute_aliases() {
    // Typed paths accept the aliases emitted by core and custom reroute nodes.
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "aliased.safetensors" } },
        "2": { "class_type": "Reroute", "inputs": { "value": ["1", 0] } },
        "3": { "class_type": "CLIPTextEncode", "inputs": { "text": "aliased positive" } },
        "4": { "class_type": "Reroute", "inputs": { "input": ["3", 0] } },
        "5": { "class_type": "CLIPTextEncode", "inputs": { "text": "aliased negative" } },
        "6": { "class_type": "Reroute", "inputs": { "any": ["5", 0] } },
        "7": { "class_type": "SamplerCustom", "inputs": {
            "model": ["2", 0], "positive": ["4", 0], "negative": ["6", 0],
            "noise_seed": 42, "cfg": 5.5
        } },
        "8": { "class_type": "VAEDecode", "inputs": { "samples": ["7", 0] } },
        "9": { "class_type": "SaveImage", "inputs": { "images": ["8", 0] } }
    }"#;

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "aliased");
    assert_eq!(meta.positive_prompt, "aliased positive");
    assert_eq!(meta.negative_prompt, "aliased negative");
}

#[test]
fn authoritative_loader_name_absence_stops_model_traversal() {
    // Recognized loaders with broken or cyclic filename inputs terminate. Only
    // a wrapper that has no filename input may pass through its model socket.
    let extract_model = |loader: Value| {
        let prompt = json!({
            "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "upstream.safetensors" } },
            "2": loader,
            "3": { "class_type": "SamplerCustom", "inputs": { "model": ["2", 0], "noise_seed": 42, "cfg": 5.5 } },
            "4": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0] } },
            "5": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
        });
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(&prompt.to_string()))
            .0
            .model
    };

    assert_eq!(
        extract_model(json!({
            "class_type": "CheckpointLoaderWrapper",
            "inputs": { "ckpt_name": ["99", 0], "model": ["1", 0] }
        })),
        "Unknown"
    );
    assert_eq!(
        extract_model(json!({
            "class_type": "CheckpointLoaderWrapper",
            "inputs": { "ckpt_name": ["2", 0], "model": ["1", 0] }
        })),
        "Unknown"
    );
    assert_eq!(
        extract_model(json!({
            "class_type": "CheckpointLoaderWrapper",
            "inputs": { "model": ["1", 0] }
        })),
        "upstream"
    );
}

#[test]
fn disconnected_sampler_does_not_override_saved_output_traversal() {
    let prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "saved-output-model.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "saved output prompt" }
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 333,
                "steps": 18,
                "cfg": 6.0,
                "sampler_name": "euler_a",
                "scheduler": "normal",
                "model": ["1", 0],
                "positive": ["2", 0]
            }
        },
        "4": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["3", 0] }
        },
        "5": {
            "class_type": "SaveImage",
            "inputs": { "images": ["4", 0] }
        },
        "20": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "unrelated-model.safetensors" }
        },
        "21": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "unrelated prompt" }
        },
        "22": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 999,
                "steps": 99,
                "cfg": 1.0,
                "sampler_name": "uni_pc",
                "scheduler": "simple",
                "model": ["20", 0],
                "positive": ["21", 0]
            }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "saved_output_model");
    assert_eq!(meta.seed, Some(333));
    assert_eq!(meta.steps, 18);
    assert_eq!(meta.cfg, 6.0);
    assert_eq!(meta.sampler, "euler_a (normal)");
    assert_eq!(meta.positive_prompt, "saved output prompt");
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::SamplerFallback));
    assert!(!diagnostics
        .attempted_layers
        .contains(&ComfyParseLayer::GlobalScan));
}

#[test]
fn sampler_fallback_fills_only_fields_missing_after_traversal() {
    let prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "traversed-model.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "traversed prompt" }
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0]
            }
        },
        "4": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["3", 0] }
        },
        "5": {
            "class_type": "SaveImage",
            "inputs": { "images": ["4", 0] }
        },
        "20": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "fallback-model.safetensors" }
        },
        "21": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "fallback prompt must not replace traversal" }
        },
        "22": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 444,
                "steps": 24,
                "cfg": 5.5,
                "sampler_name": "dpmpp_sde",
                "scheduler": "karras",
                "model": ["20", 0],
                "positive": ["21", 0]
            }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "traversed_model");
    assert_eq!(meta.positive_prompt, "traversed prompt");
    assert_eq!(meta.seed, Some(444));
    assert_eq!(meta.steps, 24);
    assert_eq!(meta.cfg, 5.5);
    assert_eq!(meta.sampler, "dpmpp_sde (karras)");

    assert_field_source(
        &diagnostics,
        ComfyMetadataField::PositivePrompt,
        ComfyParseLayer::SamplerTraversal,
    );
    for field in [
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_field_source(&diagnostics, field, ComfyParseLayer::SamplerFallback);
    }
}

#[test]
fn global_scan_fills_only_remaining_blanks_after_sampler_layers() {
    let prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "global-scan-base.safetensors" }
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 555,
                "steps": 16,
                "cfg": 4.5,
                "sampler_name": "heun",
                "scheduler": "normal",
                "model": ["1", 0]
            }
        },
        "4": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["3", 0] }
        },
        "5": {
            "class_type": "SaveImage",
            "inputs": { "images": ["4", 0] }
        },
        "30": {
            "class_type": "String",
            "inputs": { "value": "rescued global prompt" }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "global_scan_base");
    assert_eq!(meta.seed, Some(555));
    assert_eq!(meta.steps, 16);
    assert_eq!(meta.cfg, 4.5);
    assert_eq!(meta.sampler, "heun (normal)");
    assert_eq!(meta.positive_prompt, "rescued global prompt");

    for field in [
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
    ] {
        assert_field_source(&diagnostics, field, ComfyParseLayer::SamplerTraversal);
    }
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::PositivePrompt,
        ComfyParseLayer::GlobalScan,
    );
}

#[test]
fn global_scan_text_metadata_wins_over_generic_loader_fallback() {
    // Embedded A1111-style text is more intentional fallback metadata than an
    // arbitrary disconnected loader, even after another text node filled the prompt.
    let prompt = r#"{
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "wrong-loader.safetensors" }
        },
        "2": {
            "class_type": "String",
            "inputs": { "value": "earlier ordinary prompt" }
        },
        "3": {
            "class_type": "String",
            "inputs": {
                "value": "blob prompt\nNegative prompt: bad anatomy\nSteps: 28, Sampler: dpmpp_2m, CFG scale: 6.5, Seed: 777, Model: intended_model.safetensors"
            }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "intended_model");
    assert!(!meta.model.contains("wrong_loader"));
    assert_eq!(meta.steps, 28);
    assert_eq!(meta.cfg, 6.5);
    assert_eq!(meta.seed, Some(777));
    assert_eq!(meta.sampler, "dpmpp_2m");
    assert_eq!(meta.positive_prompt, "earlier ordinary prompt");
    assert_eq!(meta.negative_prompt, "bad anatomy");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Model,
        ComfyParseLayer::GlobalScan,
    );
}

#[test]
fn connected_flux_guidance_supplies_cfg_for_sampler_custom_advanced() {
    // Flux-style samplers do not expose CFG directly; the connected guider's
    // FluxGuidance node is the sampler-traversal source for the same scalar.
    let prompt = r#"{
        "1": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "flux-primary.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "connected flux prompt" }
        },
        "3": {
            "class_type": "FluxGuidance",
            "inputs": {
                "conditioning": ["2", 0],
                "guidance": 3.5
            }
        },
        "4": {
            "class_type": "BasicGuider",
            "inputs": {
                "model": ["1", 0],
                "conditioning": ["3", 0]
            }
        },
        "5": {
            "class_type": "RandomNoise",
            "inputs": { "noise_seed": 888 }
        },
        "6": {
            "class_type": "KSamplerSelect",
            "inputs": { "sampler_name": "euler" }
        },
        "7": {
            "class_type": "BasicScheduler",
            "inputs": {
                "scheduler": "simple",
                "steps": 20,
                "model": ["1", 0]
            }
        },
        "8": {
            "class_type": "EmptyLatentImage",
            "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }
        },
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
        "10": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["9", 0] }
        },
        "11": {
            "class_type": "SaveImage",
            "inputs": { "images": ["10", 0] }
        },
        "20": {
            "class_type": "FluxGuidance",
            "inputs": {
                "conditioning": ["2", 0],
                "guidance": 9.9
            }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "flux_primary");
    assert_eq!(meta.seed, Some(888));
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 3.5);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "connected flux prompt");
    assert_ne!(meta.cfg, 9.9);
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Cfg,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn linked_flux_guidance_supplies_cfg_for_sampler_custom_advanced() {
    // ComfyUI can convert FluxGuidance.guidance into a linked widget input; it
    // should still count as sampler-traversal evidence when the guider is connected.
    let prompt = r#"{
        "1": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "linked-flux.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "linked flux guidance prompt" }
        },
        "3": {
            "class_type": "PrimitiveFloat",
            "inputs": { "value": 4.75 }
        },
        "4": {
            "class_type": "FluxGuidance",
            "inputs": {
                "conditioning": ["2", 0],
                "guidance": ["3", 0]
            }
        },
        "5": {
            "class_type": "BasicGuider",
            "inputs": {
                "model": ["1", 0],
                "conditioning": ["4", 0]
            }
        },
        "6": {
            "class_type": "RandomNoise",
            "inputs": { "noise_seed": 999 }
        },
        "7": {
            "class_type": "KSamplerSelect",
            "inputs": { "sampler_name": "euler" }
        },
        "8": {
            "class_type": "BasicScheduler",
            "inputs": {
                "scheduler": "simple",
                "steps": 24,
                "model": ["1", 0]
            }
        },
        "9": {
            "class_type": "EmptyLatentImage",
            "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }
        },
        "10": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["6", 0],
                "guider": ["5", 0],
                "sampler": ["7", 0],
                "sigmas": ["8", 0],
                "latent_image": ["9", 0]
            }
        },
        "11": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["10", 0] }
        },
        "12": {
            "class_type": "SaveImage",
            "inputs": { "images": ["11", 0] }
        },
        "20": {
            "class_type": "FluxGuidance",
            "inputs": {
                "conditioning": ["2", 0],
                "guidance": 9.9
            }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "linked_flux");
    assert_eq!(meta.seed, Some(999));
    assert_eq!(meta.steps, 24);
    assert_eq!(meta.cfg, 4.75);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "linked flux guidance prompt");
    assert_ne!(meta.cfg, 9.9);
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Cfg,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn workflow_flux_guidance_widget_value_supplies_cfg() {
    // Workflow-only imports rely on FluxGuidance.widgets_values[0] because API
    // input names are not available in the UI-format node body.
    let workflow = r#"{
        "nodes": [
            {
                "id": 1,
                "type": "UNETLoader",
                "widgets_values": ["flux-ui.safetensors"]
            },
            {
                "id": 2,
                "type": "CLIPTextEncode",
                "widgets_values": ["workflow flux prompt"],
                "outputs": [{ "name": "CONDITIONING", "links": [2] }]
            },
            {
                "id": 3,
                "type": "FluxGuidance",
                "inputs": [{ "name": "conditioning", "link": 2 }],
                "widgets_values": [4.25],
                "outputs": [{ "name": "CONDITIONING", "links": [3] }]
            },
            {
                "id": 4,
                "type": "BasicGuider",
                "inputs": [
                    { "name": "model", "link": 1 },
                    { "name": "conditioning", "link": 3 }
                ]
            },
            {
                "id": 5,
                "type": "RandomNoise",
                "widgets_values": [123456789]
            },
            {
                "id": 6,
                "type": "KSamplerSelect",
                "widgets_values": ["euler"]
            },
            {
                "id": 7,
                "type": "BasicScheduler",
                "widgets_values": ["simple", 12, 1.0]
            },
            {
                "id": 8,
                "type": "EmptyLatentImage",
                "widgets_values": [1024, 1024, 1]
            },
            {
                "id": 9,
                "type": "SamplerCustomAdvanced",
                "inputs": [
                    { "name": "noise", "link": 5 },
                    { "name": "guider", "link": 4 },
                    { "name": "sampler", "link": 6 },
                    { "name": "sigmas", "link": 7 },
                    { "name": "latent_image", "link": 8 }
                ]
            },
            {
                "id": 10,
                "type": "VAEDecode",
                "inputs": [{ "name": "samples", "link": 9 }]
            },
            {
                "id": 11,
                "type": "SaveImage",
                "inputs": [{ "name": "images", "link": 10 }]
            }
        ],
        "links": [
            [1, 1, 0, 4, 0, "MODEL"],
            [2, 2, 0, 3, 0, "CONDITIONING"],
            [3, 3, 0, 4, 1, "CONDITIONING"],
            [4, 4, 0, 9, 1, "GUIDER"],
            [5, 5, 0, 9, 0, "NOISE"],
            [6, 6, 0, 9, 2, "SAMPLER"],
            [7, 7, 0, 9, 3, "SIGMAS"],
            [8, 8, 0, 9, 4, "LATENT"],
            [9, 9, 0, 10, 0, "LATENT"],
            [10, 10, 0, 11, 0, "IMAGE"]
        ]
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "flux_ui");
    assert_eq!(meta.steps, 12);
    assert_eq!(meta.cfg, 4.25);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "workflow flux prompt");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Cfg,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn workflow_linked_flux_guidance_input_wins_over_stale_widget_value() {
    // Converted FluxGuidance widgets can keep an old widgets_values[0]; the
    // connected guidance input is the live sampler-traversal value.
    let workflow = r#"{
        "nodes": [
            {
                "id": 1,
                "type": "UNETLoader",
                "widgets_values": ["flux-ui-linked.safetensors"]
            },
            {
                "id": 2,
                "type": "CLIPTextEncode",
                "widgets_values": ["workflow linked flux prompt"],
                "outputs": [{ "name": "CONDITIONING", "links": [2] }]
            },
            {
                "id": 3,
                "type": "PrimitiveFloat",
                "widgets_values": [4.75],
                "outputs": [{ "name": "FLOAT", "links": [3] }]
            },
            {
                "id": 4,
                "type": "FluxGuidance",
                "inputs": [
                    { "name": "conditioning", "link": 2 },
                    { "name": "guidance", "link": 3 }
                ],
                "widgets_values": [1.0],
                "outputs": [{ "name": "CONDITIONING", "links": [4] }]
            },
            {
                "id": 5,
                "type": "BasicGuider",
                "inputs": [
                    { "name": "model", "link": 1 },
                    { "name": "conditioning", "link": 4 }
                ]
            },
            {
                "id": 6,
                "type": "RandomNoise",
                "widgets_values": [444444444]
            },
            {
                "id": 7,
                "type": "KSamplerSelect",
                "widgets_values": ["euler"]
            },
            {
                "id": 8,
                "type": "BasicScheduler",
                "widgets_values": ["simple", 18, 1.0]
            },
            {
                "id": 9,
                "type": "EmptyLatentImage",
                "widgets_values": [1024, 1024, 1]
            },
            {
                "id": 10,
                "type": "SamplerCustomAdvanced",
                "inputs": [
                    { "name": "noise", "link": 6 },
                    { "name": "guider", "link": 5 },
                    { "name": "sampler", "link": 7 },
                    { "name": "sigmas", "link": 8 },
                    { "name": "latent_image", "link": 9 }
                ]
            },
            {
                "id": 11,
                "type": "VAEDecode",
                "inputs": [{ "name": "samples", "link": 10 }]
            },
            {
                "id": 12,
                "type": "SaveImage",
                "inputs": [{ "name": "images", "link": 11 }]
            }
        ],
        "links": [
            [1, 1, 0, 5, 0, "MODEL"],
            [2, 2, 0, 4, 0, "CONDITIONING"],
            [3, 3, 0, 4, 1, "FLOAT"],
            [4, 4, 0, 5, 1, "CONDITIONING"],
            [5, 5, 0, 10, 1, "GUIDER"],
            [6, 6, 0, 10, 0, "NOISE"],
            [7, 7, 0, 10, 2, "SAMPLER"],
            [8, 8, 0, 10, 3, "SIGMAS"],
            [9, 9, 0, 10, 4, "LATENT"],
            [10, 10, 0, 11, 0, "LATENT"],
            [11, 11, 0, 12, 0, "IMAGE"]
        ]
    }"#;
    let mut chunks = HashMap::new();
    chunks.insert("workflow".to_string(), workflow.to_string());

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "flux_ui_linked");
    assert_eq!(meta.steps, 18);
    assert_eq!(meta.cfg, 4.75);
    assert_ne!(meta.cfg, 1.0);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "workflow linked flux prompt");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Cfg,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn auxiliary_model_loaders_do_not_replace_primary_checkpoint() {
    let prompt = r#"{
        "1": {
            "class_type": "UpscaleModelLoader",
            "inputs": { "model_name": "RealESRGAN_x4.pth" }
        },
        "2": {
            "class_type": "VAELoader",
            "inputs": { "vae_name": "auxiliary-vae.safetensors" }
        },
        "10": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": "primary-checkpoint.safetensors" }
        },
        "11": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "primary prompt" }
        },
        "12": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 666,
                "steps": 12,
                "cfg": 3.5,
                "sampler_name": "euler",
                "scheduler": "simple",
                "model": ["10", 0],
                "positive": ["11", 0]
            }
        },
        "13": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["12", 0],
                "vae": ["2", 0]
            }
        },
        "14": {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {
                "upscale_model": ["1", 0],
                "image": ["13", 0]
            }
        },
        "15": {
            "class_type": "SaveImage",
            "inputs": { "images": ["14", 0] }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "primary_checkpoint");
    assert!(!meta.model.contains("realesrgan"));
    assert!(!meta.model.contains("auxiliary_vae"));
    assert_eq!(meta.positive_prompt, "primary prompt");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::PositivePrompt,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn connected_cfg_guider_supplies_custom_sampler_metadata() {
    // SamplerCustomAdvanced stores CFG and both prompt branches on its connected
    // guider, so those values are still saved-output traversal evidence.
    let prompt = r#"{
        "1": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "cfg-guider-model.safetensors" }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "cfg guider positive" }
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": "cfg guider negative" }
        },
        "4": {
            "class_type": "CFGGuider",
            "inputs": {
                "model": ["1", 0],
                "positive": ["13", 0],
                "negative": ["3", 0],
                "cfg": 2.5
            }
        },
        "5": {
            "class_type": "RandomNoise",
            "inputs": { "noise_seed": 123456789 }
        },
        "6": {
            "class_type": "KSamplerSelect",
            "inputs": { "sampler_name": "euler" }
        },
        "7": {
            "class_type": "BasicScheduler",
            "inputs": { "scheduler": "simple", "steps": 12 }
        },
        "8": {
            "class_type": "EmptyLatentImage",
            "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }
        },
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
        "10": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["9", 0] }
        },
        "11": {
            "class_type": "SaveImage",
            "inputs": { "images": ["10", 0] }
        },
        "12": {
            "class_type": "CLIPTextEncode",
            "_meta": { "title": "Positive Prompt" },
            "inputs": { "text": "unrelated wireless prompt" }
        },
        "13": {
            "class_type": "ConditioningZeroOut",
            "inputs": { "conditioning": ["2", 0] }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "cfg_guider_model");
    assert_eq!(meta.seed, Some(123456789));
    assert_eq!(meta.steps, 12);
    assert_eq!(meta.cfg, 2.5);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "");
    assert_eq!(meta.negative_prompt, "cfg guider negative");
    for field in [ComfyMetadataField::Cfg, ComfyMetadataField::NegativePrompt] {
        assert_field_source(&diagnostics, field, ComfyParseLayer::SamplerTraversal);
    }
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        None
    );
}

#[test]
fn workflow_linked_cfg_guider_input_wins_over_stale_widget_value() {
    // Converted CFGGuider widgets retain their old widgets_values entry. The
    // connected cfg input is the live value and must remain authoritative.
    let workflow = r#"{
        "nodes": [
            {
                "id": 1,
                "type": "UNETLoader",
                "widgets_values": ["cfg-ui-linked.safetensors"]
            },
            {
                "id": 2,
                "type": "CLIPTextEncode",
                "widgets_values": ["linked cfg positive"]
            },
            {
                "id": 3,
                "type": "CLIPTextEncode",
                "widgets_values": ["linked cfg negative"]
            },
            {
                "id": 4,
                "type": "PrimitiveFloat",
                "widgets_values": [4.75]
            },
            {
                "id": 5,
                "type": "CFGGuider",
                "inputs": [
                    { "name": "model", "link": 1 },
                    { "name": "positive", "link": 2 },
                    { "name": "negative", "link": 3 },
                    { "name": "cfg", "link": 4 }
                ],
                "widgets_values": [1.0]
            },
            {
                "id": 6,
                "type": "RandomNoise",
                "widgets_values": [555555555]
            },
            {
                "id": 7,
                "type": "KSamplerSelect",
                "widgets_values": ["euler"]
            },
            {
                "id": 8,
                "type": "BasicScheduler",
                "widgets_values": ["simple", 16, 1.0]
            },
            {
                "id": 9,
                "type": "EmptyLatentImage",
                "widgets_values": [1024, 1024, 1]
            },
            {
                "id": 10,
                "type": "SamplerCustomAdvanced",
                "inputs": [
                    { "name": "noise", "link": 6 },
                    { "name": "guider", "link": 5 },
                    { "name": "sampler", "link": 7 },
                    { "name": "sigmas", "link": 8 },
                    { "name": "latent_image", "link": 9 }
                ]
            },
            {
                "id": 11,
                "type": "VAEDecode",
                "inputs": [{ "name": "samples", "link": 10 }]
            },
            {
                "id": 12,
                "type": "SaveImage",
                "inputs": [{ "name": "images", "link": 11 }]
            }
        ],
        "links": [
            [1, 1, 0, 5, 0, "MODEL"],
            [2, 2, 0, 5, 1, "CONDITIONING"],
            [3, 3, 0, 5, 2, "CONDITIONING"],
            [4, 4, 0, 5, 3, "FLOAT"],
            [5, 5, 0, 10, 1, "GUIDER"],
            [6, 6, 0, 10, 0, "NOISE"],
            [7, 7, 0, 10, 2, "SAMPLER"],
            [8, 8, 0, 10, 3, "SIGMAS"],
            [9, 9, 0, 10, 4, "LATENT"],
            [10, 10, 0, 11, 0, "LATENT"],
            [11, 11, 0, 12, 0, "IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "cfg_ui_linked");
    assert_eq!(meta.steps, 16);
    assert_eq!(meta.cfg, 4.75);
    assert_ne!(meta.cfg, 1.0);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "linked cfg positive");
    assert_eq!(meta.negative_prompt, "linked cfg negative");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Cfg,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn connected_dual_cfg_guider_uses_primary_conditioning_and_ignores_disconnected_guider() {
    // DualCFGGuider has a second conditioning branch that the current metadata
    // shape cannot represent. Only cond1 is the primary positive prompt.
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "dual-cfg-model.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "dual primary prompt" } },
        "3": { "class_type": "CLIPTextEncode", "inputs": { "text": "dual secondary prompt" } },
        "4": { "class_type": "CLIPTextEncode", "inputs": { "text": "dual negative prompt" } },
        "5": {
            "class_type": "DualCFGGuider",
            "inputs": {
                "model": ["1", 0],
                "cond1": ["2", 0],
                "cond2": ["3", 0],
                "negative": ["4", 0],
                "cfg_conds": 5.0,
                "cfg_cond2_negative": 2.0
            }
        },
        "6": { "class_type": "RandomNoise", "inputs": { "noise_seed": 4242 } },
        "7": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "8": { "class_type": "BasicScheduler", "inputs": { "scheduler": "simple", "steps": 20 } },
        "9": { "class_type": "EmptyLatentImage", "inputs": { "width": 1024, "height": 1024 } },
        "10": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["6", 0],
                "guider": ["5", 0],
                "sampler": ["7", 0],
                "sigmas": ["8", 0],
                "latent_image": ["9", 0]
            }
        },
        "11": { "class_type": "VAEDecode", "inputs": { "samples": ["10", 0] } },
        "12": { "class_type": "SaveImage", "inputs": { "images": ["11", 0] } },
        "30": {
            "class_type": "DualCFGGuider",
            "inputs": {
                "model": ["1", 0],
                "cond1": ["3", 0],
                "negative": ["4", 0],
                "cfg_conds": 99.0
            }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "dual_cfg_model");
    assert_eq!(meta.seed, Some(4242));
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 5.0);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "dual primary prompt");
    assert_eq!(meta.negative_prompt, "dual negative prompt");
    assert!(!meta.positive_prompt.contains("secondary"));
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::PositivePrompt,
        ComfyMetadataField::NegativePrompt,
    ] {
        assert_field_source(&diagnostics, field, ComfyParseLayer::SamplerTraversal);
    }
}

#[test]
fn connected_dual_cfg_empty_primary_prompt_blocks_disconnected_fallback() {
    // A linked ConditioningZeroOut is intentional absence, not an invitation
    // to substitute an unrelated prompt found elsewhere in the graph.
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "dual-empty-model.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "prompt to zero" } },
        "3": { "class_type": "ConditioningZeroOut", "inputs": { "conditioning": ["2", 0] } },
        "4": { "class_type": "CLIPTextEncode", "inputs": { "text": "secondary only" } },
        "5": { "class_type": "CLIPTextEncode", "inputs": { "text": "dual negative" } },
        "6": {
            "class_type": "DualCFGGuider",
            "inputs": {
                "model": ["1", 0], "cond1": ["3", 0], "cond2": ["4", 0],
                "negative": ["5", 0], "cfg_conds": 5.0
            }
        },
        "7": { "class_type": "RandomNoise", "inputs": { "noise_seed": 7 } },
        "8": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "9": { "class_type": "BasicScheduler", "inputs": { "scheduler": "simple", "steps": 4 } },
        "10": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["7", 0], "guider": ["6", 0], "sampler": ["8", 0], "sigmas": ["9", 0]
            }
        },
        "11": { "class_type": "VAEDecode", "inputs": { "samples": ["10", 0] } },
        "12": { "class_type": "SaveImage", "inputs": { "images": ["11", 0] } },
        "20": {
            "class_type": "CLIPTextEncode",
            "_meta": { "title": "Positive Prompt" },
            "inputs": { "text": "disconnected fallback prompt" }
        }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.positive_prompt, "");
    assert_eq!(meta.negative_prompt, "dual negative");
    assert_eq!(
        diagnostics
            .field_sources
            .get(&ComfyMetadataField::PositivePrompt),
        None
    );
}

#[test]
fn direct_sampler_cfg_wins_over_connected_dual_cfg_guider() {
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "direct-cfg-model.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "direct cfg prompt" } },
        "3": {
            "class_type": "DualCFGGuider",
            "inputs": {
                "model": ["1", 0], "cond1": ["2", 0], "negative": ["2", 0], "cfg_conds": 7.0
            }
        },
        "4": { "class_type": "RandomNoise", "inputs": { "noise_seed": 1 } },
        "5": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "6": { "class_type": "BasicScheduler", "inputs": { "scheduler": "simple", "steps": 4 } },
        "7": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["4", 0], "guider": ["3", 0], "sampler": ["5", 0],
                "sigmas": ["6", 0], "cfg": 1.25
            }
        },
        "8": { "class_type": "VAEDecode", "inputs": { "samples": ["7", 0] } },
        "9": { "class_type": "SaveImage", "inputs": { "images": ["8", 0] } }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.cfg, 1.25);
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Cfg,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn workflow_linked_dual_cfg_and_basic_scheduler_widgets_are_authoritative() {
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["dual-ui-model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "widgets_values": ["linked dual primary"] },
            { "id": 3, "type": "CLIPTextEncode", "widgets_values": ["linked dual secondary"] },
            { "id": 4, "type": "CLIPTextEncode", "widgets_values": ["linked dual negative"] },
            { "id": 5, "type": "PrimitiveFloat", "widgets_values": [4.75] },
            {
                "id": 6,
                "type": "DualCFGGuider",
                "inputs": [
                    { "name": "model", "link": 1 },
                    { "name": "cond1", "link": 2 },
                    { "name": "cond2", "link": 3 },
                    { "name": "negative", "link": 4 },
                    { "name": "cfg_conds", "link": 5 }
                ],
                "widgets_values": [1.0, 2.0, "regular"]
            },
            { "id": 7, "type": "RandomNoise", "widgets_values": [777] },
            { "id": 8, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            { "id": 9, "type": "BasicScheduler", "widgets_values": ["simple", 16, 1.0] },
            { "id": 10, "type": "EmptyLatentImage", "widgets_values": [1024, 1024, 1] },
            {
                "id": 11,
                "type": "SamplerCustomAdvanced",
                "inputs": [
                    { "name": "noise", "link": 6 },
                    { "name": "guider", "link": 7 },
                    { "name": "sampler", "link": 8 },
                    { "name": "sigmas", "link": 9 },
                    { "name": "latent_image", "link": 10 }
                ]
            },
            { "id": 12, "type": "VAEDecode", "inputs": [{ "name": "samples", "link": 11 }] },
            { "id": 13, "type": "SaveImage", "inputs": [{ "name": "images", "link": 12 }] }
        ],
        "links": [
            [1, 1, 0, 6, 0, "MODEL"], [2, 2, 0, 6, 1, "CONDITIONING"],
            [3, 3, 0, 6, 2, "CONDITIONING"], [4, 4, 0, 6, 3, "CONDITIONING"],
            [5, 5, 0, 6, 4, "FLOAT"], [6, 7, 0, 11, 0, "NOISE"],
            [7, 6, 0, 11, 1, "GUIDER"], [8, 8, 0, 11, 2, "SAMPLER"],
            [9, 9, 0, 11, 3, "SIGMAS"], [10, 10, 0, 11, 4, "LATENT"],
            [11, 11, 0, 12, 0, "LATENT"], [12, 12, 0, 13, 0, "IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "dual_ui_model");
    assert_eq!(meta.steps, 16);
    assert_eq!(meta.cfg, 4.75);
    assert_ne!(meta.cfg, 1.0);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "linked dual primary");
    assert_eq!(meta.negative_prompt, "linked dual negative");
    assert!(!meta.positive_prompt.contains("secondary"));
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Cfg,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn workflow_beta_scheduler_widgets_supply_steps_and_stable_label() {
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["beta-model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "widgets_values": ["beta positive"] },
            { "id": 3, "type": "CLIPTextEncode", "widgets_values": ["beta negative"] },
            {
                "id": 4,
                "type": "CFGGuider",
                "inputs": [
                    { "name": "model", "link": 1 },
                    { "name": "positive", "link": 2 },
                    { "name": "negative", "link": 3 }
                ],
                "widgets_values": [3.5]
            },
            { "id": 5, "type": "RandomNoise", "widgets_values": [888] },
            { "id": 6, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            { "id": 7, "type": "BetaSamplingScheduler", "widgets_values": [30, 0.4, 0.4] },
            {
                "id": 8,
                "type": "SamplerCustomAdvanced",
                "inputs": [
                    { "name": "noise", "link": 5 },
                    { "name": "guider", "link": 4 },
                    { "name": "sampler", "link": 6 },
                    { "name": "sigmas", "link": 7 }
                ]
            },
            { "id": 9, "type": "VAEDecode", "inputs": [{ "name": "samples", "link": 8 }] },
            { "id": 10, "type": "SaveImage", "inputs": [{ "name": "images", "link": 9 }] }
        ],
        "links": [
            [1, 1, 0, 4, 0, "MODEL"], [2, 2, 0, 4, 1, "CONDITIONING"],
            [3, 3, 0, 4, 2, "CONDITIONING"], [4, 4, 0, 8, 1, "GUIDER"],
            [5, 5, 0, 8, 0, "NOISE"], [6, 6, 0, 8, 2, "SAMPLER"],
            [7, 7, 0, 8, 3, "SIGMAS"], [8, 8, 0, 9, 0, "LATENT"],
            [9, 9, 0, 10, 0, "IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 30);
    assert_eq!(meta.sampler, "euler (beta)");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Steps,
        ComfyParseLayer::SamplerTraversal,
    );
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Sampler,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn sampler_custom_beta_scheduler_unresolved_steps_fail_closed() {
    // The selected scheduler socket is strict for every scheduler type. Beta's
    // stable label survives, but a broken steps edge cannot reopen its stale widget.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["beta-model.safetensors"] },
            { "id": 2, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            {
                "id": 3, "type": "BetaSamplingScheduler",
                "inputs": [{"name":"steps","link":90}],
                "widgets_values": [30,0.4,0.4]
            },
            { "id": 4, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
            {
                "id": 5, "type": "SamplerCustom",
                "inputs": [
                    {"name":"model","link":1},{"name":"sampler","link":2},
                    {"name":"sigmas","link":3},{"name":"latent_image","link":4}
                ],
                "widgets_values": [true,42,"fixed",5.5]
            },
            { "id": 6, "type": "VAEDecode", "inputs": [{"name":"samples","link":5}] },
            { "id": 7, "type": "SaveImage", "inputs": [{"name":"images","link":6}] }
        ],
        "links": [
            [1,1,0,5,0,"MODEL"], [2,2,0,5,3,"SAMPLER"],
            [3,3,0,5,4,"SIGMAS"], [4,4,0,5,5,"LATENT"],
            [5,5,0,6,0,"LATENT"], [6,6,0,7,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 0);
    assert_eq!(meta.sampler, "euler (beta)");
}

#[test]
fn connected_sampler_custom_api_path_is_authoritative() {
    // SamplerCustom metadata belongs to the saved-output branch. A lower-ID
    // disconnected custom stack must not become fallback evidence.
    let prompt = r#"{
        "0": { "class_type": "SamplerCustom", "inputs": { "noise_seed": 1, "cfg": 99 } },
        "00": { "class_type": "UNETLoader", "inputs": { "unet_name": "wrong.safetensors" } },
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "connected.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "connected positive" } },
        "3": { "class_type": "CLIPTextEncode", "inputs": { "text": "" } },
        "4": { "class_type": "CFGNorm", "inputs": { "model": ["1", 0], "strength": 77 } },
        "5": { "class_type": "BasicScheduler", "inputs": { "scheduler": "simple", "steps": 20 } },
        "6": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "7": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512 } },
        "8": {
            "class_type": "SamplerCustom",
            "inputs": {
                "model": ["4", 0], "positive": ["2", 0], "negative": ["3", 0],
                "sampler": ["6", 0], "sigmas": ["5", 0], "latent_image": ["7", 0],
                "noise_seed": 42, "cfg": 5.5
            }
        },
        "9": { "class_type": "VAEDecode", "inputs": { "samples": ["8", 0] } },
        "10": { "class_type": "SaveImage", "inputs": { "images": ["9", 0] } },
        "11": { "class_type": "CLIPTextEncode", "inputs": { "text": "disconnected fallback prompt" } }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "connected");
    assert_eq!(meta.seed, Some(42));
    assert_eq!(meta.steps, 20);
    assert_eq!(meta.cfg, 5.5);
    assert_eq!(meta.sampler, "euler (simple)");
    assert_eq!(meta.positive_prompt, "connected positive");
    assert_eq!(meta.negative_prompt, "");
    for field in [
        ComfyMetadataField::Model,
        ComfyMetadataField::Seed,
        ComfyMetadataField::Steps,
        ComfyMetadataField::Cfg,
        ComfyMetadataField::Sampler,
        ComfyMetadataField::PositivePrompt,
    ] {
        assert_field_source(&diagnostics, field, ComfyParseLayer::SamplerTraversal);
    }
    assert!(!diagnostics
        .field_sources
        .contains_key(&ComfyMetadataField::NegativePrompt));
}

#[test]
fn sampler_custom_workflow_links_override_stale_widgets() {
    // Every linked scalar deliberately conflicts with its widget. This locks the
    // workflow contract and prevents add_noise/control widgets becoming metadata.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["linked-model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "widgets_values": ["linked positive"] },
            { "id": 3, "type": "CLIPTextEncode", "widgets_values": [""] },
            { "id": 4, "type": "CFGNorm", "inputs": [{"name":"model","link":1}], "widgets_values": [88] },
            { "id": 5, "type": "PrimitiveInt", "widgets_values": [222] },
            { "id": 6, "type": "PrimitiveFloat", "widgets_values": [6.5] },
            { "id": 7, "type": "String", "widgets_values": ["normal"] },
            { "id": 8, "type": "PrimitiveInt", "widgets_values": [24] },
            { "id": 9, "type": "String", "widgets_values": ["dpmpp_2m"] },
            {
                "id": 10, "type": "BasicScheduler",
                "inputs": [{"name":"scheduler","link":7},{"name":"steps","link":8}],
                "widgets_values": ["stale", 99, 1]
            },
            {
                "id": 11, "type": "KSamplerSelect",
                "inputs": [{"name":"sampler_name","link":9}],
                "widgets_values": ["stale_sampler"]
            },
            { "id": 12, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
            {
                "id": 13, "type": "SamplerCustom",
                "inputs": [
                    {"name":"model","link":2},{"name":"positive","link":3},
                    {"name":"negative","link":4},{"name":"sampler","link":8},
                    {"name":"sigmas","link":9},{"name":"latent_image","link":10},
                    {"name":"noise_seed","link":5},{"name":"cfg","link":6}
                ],
                "widgets_values": [true, 111, "randomize", 1]
            },
            { "id": 14, "type": "VAEDecode", "inputs": [{"name":"samples","link":11}] },
            { "id": 15, "type": "SaveImage", "inputs": [{"name":"images","link":12}] }
        ],
        "links": [
            [1,1,0,4,0,"MODEL"], [2,4,0,13,0,"MODEL"], [3,2,0,13,1,"CONDITIONING"],
            [4,3,0,13,2,"CONDITIONING"], [5,5,0,13,6,"INT"], [6,6,0,13,7,"FLOAT"],
            [7,7,0,10,0,"STRING"], [8,9,0,11,0,"STRING"], [9,10,0,13,4,"SIGMAS"],
            [10,12,0,13,5,"LATENT"], [11,13,0,14,0,"LATENT"], [12,14,0,15,0,"IMAGE"],
            [13,8,0,10,1,"INT"], [14,11,0,13,3,"SAMPLER"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.seed, Some(222));
    assert_eq!(meta.cfg, 6.5);
    assert_eq!(meta.steps, 24);
    assert_eq!(meta.sampler, "dpmpp_2m (normal)");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Sampler,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn unresolved_sampler_custom_links_fail_closed() {
    // Broken declared links are stronger evidence than stale widgets: absence is
    // safer than silently reporting values that were not used by generation.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "widgets_values": [""] },
            { "id": 3, "type": "BasicScheduler", "inputs": [{"name":"scheduler","link":90},{"name":"steps","link":91}], "widgets_values": ["simple",20,1] },
            { "id": 4, "type": "KSamplerSelect", "inputs": [{"name":"sampler_name","link":92}], "widgets_values": ["euler"] },
            { "id": 5, "type": "SamplerCustom", "inputs": [
                {"name":"model","link":1},{"name":"positive","link":2},{"name":"negative","link":3},
                {"name":"sampler","link":4},{"name":"sigmas","link":5},
                {"name":"noise_seed","link":93},{"name":"cfg","link":94}
            ], "widgets_values": [true,999,"fixed",9] },
            { "id": 6, "type": "VAEDecode", "inputs": [{"name":"samples","link":6}] },
            { "id": 7, "type": "SaveImage", "inputs": [{"name":"images","link":7}] }
        ],
        "links": [
            [1,1,0,5,0,"MODEL"], [2,2,0,5,1,"CONDITIONING"], [3,2,0,5,2,"CONDITIONING"],
            [4,4,0,5,3,"SAMPLER"], [5,3,0,5,4,"SIGMAS"], [6,5,0,6,0,"LATENT"],
            [7,6,0,7,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.seed, None);
    assert_eq!(meta.cfg, 0.0);
    assert_eq!(meta.steps, 0);
    assert_eq!(meta.sampler, "Unknown");
}

#[test]
fn sampler_custom_scalars_follow_core_reroutes() {
    // Core Reroute nodes are transparent parts of the selected runtime path;
    // their upstream values remain authoritative for every WP3 scalar.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "widgets_values": ["positive"] },
            { "id": 3, "type": "CLIPTextEncode", "widgets_values": [""] },
            { "id": 4, "type": "PrimitiveInt", "widgets_values": [222] },
            { "id": 5, "type": "Reroute", "inputs": [{"name":"","link":4}] },
            { "id": 6, "type": "PrimitiveFloat", "widgets_values": [6.5] },
            { "id": 7, "type": "Reroute", "inputs": [{"name":"","link":6}] },
            { "id": 8, "type": "String", "widgets_values": ["normal"] },
            { "id": 9, "type": "Reroute", "inputs": [{"name":"","link":8}] },
            { "id": 10, "type": "PrimitiveInt", "widgets_values": [24] },
            { "id": 11, "type": "Reroute", "inputs": [{"name":"","link":10}] },
            {
                "id": 12, "type": "BasicScheduler",
                "inputs": [{"name":"scheduler","link":9},{"name":"steps","link":11}],
                "widgets_values": ["stale",99,1]
            },
            { "id": 13, "type": "String", "widgets_values": ["dpmpp_2m"] },
            { "id": 14, "type": "Reroute", "inputs": [{"name":"","link":13}] },
            {
                "id": 15, "type": "KSamplerSelect",
                "inputs": [{"name":"sampler_name","link":14}],
                "widgets_values": ["stale_sampler"]
            },
            { "id": 16, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
            {
                "id": 17, "type": "SamplerCustom",
                "inputs": [
                    {"name":"model","link":1},{"name":"positive","link":2},
                    {"name":"negative","link":3},{"name":"sampler","link":15},
                    {"name":"sigmas","link":12},{"name":"latent_image","link":16},
                    {"name":"noise_seed","link":5},{"name":"cfg","link":7}
                ],
                "widgets_values": [true,111,"randomize",1]
            },
            { "id": 18, "type": "VAEDecode", "inputs": [{"name":"samples","link":17}] },
            { "id": 19, "type": "SaveImage", "inputs": [{"name":"images","link":18}] }
        ],
        "links": [
            [1,1,0,17,0,"MODEL"], [2,2,0,17,1,"CONDITIONING"],
            [3,3,0,17,2,"CONDITIONING"], [4,4,0,5,0,"INT"],
            [5,5,0,17,6,"INT"], [6,6,0,7,0,"FLOAT"],
            [7,7,0,17,7,"FLOAT"], [8,8,0,9,0,"STRING"],
            [9,9,0,12,0,"STRING"], [10,10,0,11,0,"INT"],
            [11,11,0,12,1,"INT"], [12,12,0,17,4,"SIGMAS"],
            [13,13,0,14,0,"STRING"], [14,14,0,15,0,"STRING"],
            [15,15,0,17,3,"SAMPLER"], [16,16,0,17,5,"LATENT"],
            [17,17,0,18,0,"LATENT"], [18,18,0,19,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.seed, Some(222));
    assert_eq!(meta.cfg, 6.5);
    assert_eq!(meta.steps, 24);
    assert_eq!(meta.sampler, "dpmpp_2m (normal)");
}

#[test]
fn sampler_custom_scheduler_and_sampler_sockets_follow_direct_reroutes() {
    // Reroutes on the typed sockets are transparent before node dispatch, so
    // the selected scheduler and sampler nodes still own their values.
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": { "class_type": "BasicScheduler", "inputs": { "scheduler": "simple", "steps": 20 } },
        "3": { "class_type": "Reroute", "inputs": { "": ["2",0] } },
        "4": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "5": { "class_type": "Reroute", "inputs": { "": ["4",0] } },
        "6": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512 } },
        "7": { "class_type": "SamplerCustom", "inputs": {
            "model": ["1",0], "sampler": ["5",0], "sigmas": ["3",0],
            "latent_image": ["6",0], "noise_seed": 42, "cfg": 5.5
        } },
        "8": { "class_type": "VAEDecode", "inputs": { "samples": ["7",0] } },
        "9": { "class_type": "SaveImage", "inputs": { "images": ["8",0] } }
    }"#;

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.steps, 20);
    assert_eq!(meta.sampler, "euler (simple)");
}

#[test]
fn sampler_custom_scheduler_and_sampler_reroute_cycles_fail_closed() {
    // Cyclic transparent sockets are invalid runtime paths. Traversal must stop
    // at its bound and report absence instead of guessing from another node.
    let prompt = r#"{
        "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "model.safetensors" } },
        "2": { "class_type": "Reroute", "inputs": { "": ["3",0] } },
        "3": { "class_type": "Reroute", "inputs": { "": ["2",0] } },
        "4": { "class_type": "Reroute", "inputs": { "": ["5",0] } },
        "5": { "class_type": "Reroute", "inputs": { "": ["4",0] } },
        "6": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512 } },
        "7": { "class_type": "SamplerCustom", "inputs": {
            "model": ["1",0], "sampler": ["4",0], "sigmas": ["2",0],
            "latent_image": ["6",0], "noise_seed": 42, "cfg": 5.5
        } },
        "8": { "class_type": "VAEDecode", "inputs": { "samples": ["7",0] } },
        "9": { "class_type": "SaveImage", "inputs": { "images": ["8",0] } }
    }"#;

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.steps, 0);
    assert_eq!(meta.sampler, "Unknown");
}

#[test]
fn nested_unresolved_sampler_custom_scalars_do_not_reopen_widgets() {
    // The outer links resolve, but each scalar source has its own broken declared
    // link. Stale source widgets must not become generation metadata.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "widgets_values": [""] },
            { "id": 3, "type": "PrimitiveInt", "inputs": [{"name":"value","link":90}], "widgets_values": [999] },
            { "id": 4, "type": "PrimitiveFloat", "inputs": [{"name":"value","link":91}], "widgets_values": [9.0] },
            { "id": 5, "type": "String", "inputs": [{"name":"value","link":92}], "widgets_values": ["stale_scheduler"] },
            { "id": 6, "type": "PrimitiveInt", "inputs": [{"name":"value","link":93}], "widgets_values": [99] },
            {
                "id": 7, "type": "BasicScheduler",
                "inputs": [{"name":"scheduler","link":5},{"name":"steps","link":6}],
                "widgets_values": ["stale",88,1]
            },
            { "id": 8, "type": "String", "inputs": [{"name":"value","link":94}], "widgets_values": ["stale_sampler"] },
            { "id": 9, "type": "KSamplerSelect", "inputs": [{"name":"sampler_name","link":8}], "widgets_values": ["euler"] },
            { "id": 10, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
            {
                "id": 11, "type": "SamplerCustom",
                "inputs": [
                    {"name":"model","link":1},{"name":"positive","link":2},
                    {"name":"negative","link":2},{"name":"sampler","link":9},
                    {"name":"sigmas","link":7},{"name":"latent_image","link":10},
                    {"name":"noise_seed","link":3},{"name":"cfg","link":4}
                ],
                "widgets_values": [true,111,"randomize",1]
            },
            { "id": 12, "type": "VAEDecode", "inputs": [{"name":"samples","link":11}] },
            { "id": 13, "type": "SaveImage", "inputs": [{"name":"images","link":12}] }
        ],
        "links": [
            [1,1,0,11,0,"MODEL"], [2,2,0,11,1,"CONDITIONING"],
            [3,3,0,11,6,"INT"], [4,4,0,11,7,"FLOAT"],
            [5,5,0,7,0,"STRING"], [6,6,0,7,1,"INT"],
            [7,7,0,11,4,"SIGMAS"], [8,8,0,9,0,"STRING"],
            [9,9,0,11,3,"SAMPLER"], [10,10,0,11,5,"LATENT"],
            [11,11,0,12,0,"LATENT"], [12,12,0,13,0,"IMAGE"],
            [13,2,0,11,2,"CONDITIONING"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.seed, None);
    assert_eq!(meta.cfg, 0.0);
    assert_eq!(meta.steps, 0);
    assert_eq!(meta.sampler, "Unknown");
}

#[test]
fn incomplete_selected_sampler_custom_blocks_disconnected_custom_stack() {
    // Once saved-output traversal uniquely selects SamplerCustom, absence is
    // authoritative. A complete disconnected custom stack is not fallback data.
    let prompt = r#"{
        "1": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512 } },
        "2": { "class_type": "SamplerCustom", "inputs": {
            "model": ["90", 0], "positive": ["91", 0], "negative": ["92", 0],
            "sampler": ["93", 0], "sigmas": ["94", 0], "latent_image": ["1", 0],
            "noise_seed": ["95", 0], "cfg": ["96", 0]
        } },
        "3": { "class_type": "VAEDecode", "inputs": { "samples": ["2", 0] } },
        "4": { "class_type": "SaveImage", "inputs": { "images": ["3", 0] } },

        "20": { "class_type": "UNETLoader", "inputs": { "unet_name": "disconnected.safetensors" } },
        "21": { "class_type": "CLIPTextEncode", "inputs": { "text": "disconnected positive" } },
        "22": { "class_type": "CLIPTextEncode", "inputs": { "text": "disconnected negative" } },
        "23": { "class_type": "CFGGuider", "inputs": { "model": ["20", 0], "positive": ["21", 0], "negative": ["22", 0], "cfg": 9.0 } },
        "24": { "class_type": "RandomNoise", "inputs": { "noise_seed": 999 } },
        "25": { "class_type": "BasicScheduler", "inputs": { "model": ["20", 0], "scheduler": "normal", "steps": 99 } },
        "26": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
        "27": { "class_type": "EmptyLatentImage", "inputs": { "width": 1024, "height": 1024 } },
        "28": { "class_type": "SamplerCustomAdvanced", "inputs": { "noise": ["24", 0], "guider": ["23", 0], "sampler": ["26", 0], "sigmas": ["25", 0], "latent_image": ["27", 0] } }
    }"#;

    let (meta, diagnostics) =
        extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(diagnostics.unique_output_root_sampler_count, 1);
    assert_eq!(meta.model, "Unknown");
    assert_eq!(meta.seed, None);
    assert_eq!(meta.steps, 0);
    assert_eq!(meta.cfg, 0.0);
    assert_eq!(meta.sampler, "Unknown");
    assert_eq!(meta.positive_prompt, "");
    assert_eq!(meta.negative_prompt, "");
}

#[test]
fn unresolved_sampler_custom_model_and_conditioning_do_not_guess_wireless_sources() {
    // A declared edge means the runtime value was connected. If that edge is
    // missing, disconnected singleton/title candidates are not valid substitutes.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "UNETLoader", "widgets_values": ["wireless-model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "_meta": {"title":"Positive Prompt"}, "widgets_values": ["wireless positive"] },
            { "id": 3, "type": "CLIPTextEncode", "widgets_values": [""] },
            { "id": 4, "type": "BasicScheduler", "widgets_values": ["simple",20,1] },
            { "id": 5, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            { "id": 6, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
            { "id": 7, "type": "SamplerCustom", "inputs": [
                {"name":"model","link":90},{"name":"positive","link":91},
                {"name":"negative","link":1},{"name":"sampler","link":2},
                {"name":"sigmas","link":3},{"name":"latent_image","link":4}
            ], "widgets_values": [true,42,"fixed",5.5] },
            { "id": 8, "type": "VAEDecode", "inputs": [{"name":"samples","link":5}] },
            { "id": 9, "type": "SaveImage", "inputs": [{"name":"images","link":6}] }
        ],
        "links": [
            [1,3,0,7,2,"CONDITIONING"], [2,5,0,7,3,"SAMPLER"],
            [3,4,0,7,4,"SIGMAS"], [4,6,0,7,5,"LATENT"],
            [5,7,0,8,0,"LATENT"], [6,8,0,9,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "Unknown");
    assert_eq!(meta.positive_prompt, "");
}

#[test]
fn clip_encoder_widgets_require_unconnected_text_inputs_for_both_prompt_roles() {
    // The same stale widget must be rejected on either conditioning branch,
    // while the opposite branch's genuinely unconnected widget remains valid.
    let mut workflow: Value = serde_json::from_str(
        r#"{
            "nodes": [
                { "id": 1, "type": "UNETLoader", "widgets_values": ["model.safetensors"] },
                { "id": 2, "type": "CLIPTextEncode", "inputs": [{"name":"text","link":90}], "widgets_values": ["stale positive"] },
                { "id": 3, "type": "CLIPTextEncode", "inputs": [], "widgets_values": ["literal negative"] },
                { "id": 4, "type": "BasicScheduler", "widgets_values": ["simple",20,1] },
                { "id": 5, "type": "KSamplerSelect", "widgets_values": ["euler"] },
                { "id": 6, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
                { "id": 7, "type": "SamplerCustom", "inputs": [
                    {"name":"model","link":1},{"name":"positive","link":2},
                    {"name":"negative","link":3},{"name":"sampler","link":4},
                    {"name":"sigmas","link":5},{"name":"latent_image","link":6}
                ], "widgets_values": [true,42,"fixed",5.5] },
                { "id": 8, "type": "VAEDecode", "inputs": [{"name":"samples","link":7}] },
                { "id": 9, "type": "SaveImage", "inputs": [{"name":"images","link":8}] }
            ],
            "links": [
                [1,1,0,7,0,"MODEL"], [2,2,0,7,1,"CONDITIONING"],
                [3,3,0,7,2,"CONDITIONING"], [4,5,0,7,3,"SAMPLER"],
                [5,4,0,7,4,"SIGMAS"], [6,6,0,7,5,"LATENT"],
                [7,7,0,8,0,"LATENT"], [8,8,0,9,0,"IMAGE"]
            ]
        }"#,
    )
    .expect("test workflow should be valid JSON");
    let extract = |workflow: &Value| {
        extract_comfyui_metadata_with_diagnostics(&HashMap::from([(
            "workflow".to_string(),
            workflow.to_string(),
        )]))
        .0
    };

    let positive_broken = extract(&workflow);
    assert_eq!(positive_broken.positive_prompt, "");
    assert_eq!(positive_broken.negative_prompt, "literal negative");

    workflow["nodes"][1]["inputs"] = json!([]);
    workflow["nodes"][1]["widgets_values"] = json!(["literal positive"]);
    workflow["nodes"][2]["inputs"] = json!([{"name":"text","link":91}]);
    workflow["nodes"][2]["widgets_values"] = json!(["stale negative"]);

    let negative_broken = extract(&workflow);
    assert_eq!(negative_broken.positive_prompt, "literal positive");
    assert_eq!(negative_broken.negative_prompt, "");
}

#[test]
fn sampler_custom_loader_names_are_strictly_link_first() {
    // UNET and checkpoint loaders share the same contract: connected names win,
    // broken declared links fail closed, and unconnected widgets remain defaults.
    let extract_model = |loader_type: &str,
                         input_name: &str,
                         input_link: Value,
                         include_name_edge: bool| {
        let mut links = vec![
            json!([2, 2, 0, 7, 0, "MODEL"]),
            json!([3, 5, 0, 7, 3, "SAMPLER"]),
            json!([4, 4, 0, 7, 4, "SIGMAS"]),
            json!([5, 6, 0, 7, 5, "LATENT"]),
            json!([6, 7, 0, 8, 0, "LATENT"]),
            json!([7, 8, 0, 9, 0, "IMAGE"]),
        ];
        if include_name_edge {
            links.push(json!([1, 1, 0, 2, 0, "STRING"]));
        }
        let workflow = json!({
            "nodes": [
                { "id": 1, "type": "String", "widgets_values": ["linked-model.safetensors"] },
                { "id": 2, "type": loader_type, "inputs": [{"name":input_name,"link":input_link}], "widgets_values": ["widget-model.safetensors"] },
                { "id": 4, "type": "BasicScheduler", "widgets_values": ["simple",20,1] },
                { "id": 5, "type": "KSamplerSelect", "widgets_values": ["euler"] },
                { "id": 6, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
                { "id": 7, "type": "SamplerCustom", "inputs": [
                    {"name":"model","link":2},{"name":"sampler","link":3},
                    {"name":"sigmas","link":4},{"name":"latent_image","link":5}
                ], "widgets_values": [true,42,"fixed",5.5] },
                { "id": 8, "type": "VAEDecode", "inputs": [{"name":"samples","link":6}] },
                { "id": 9, "type": "SaveImage", "inputs": [{"name":"images","link":7}] }
            ],
            "links": links
        });
        extract_comfyui_metadata_with_diagnostics(&HashMap::from([(
            "workflow".to_string(),
            workflow.to_string(),
        )]))
        .0
        .model
    };

    for (loader_type, input_name) in [
        ("UNETLoader", "unet_name"),
        ("CheckpointLoaderSimple", "ckpt_name"),
    ] {
        assert_eq!(
            extract_model(loader_type, input_name, json!(1), true),
            "linked_model"
        );
        assert_eq!(
            extract_model(loader_type, input_name, json!(99), false),
            "Unknown"
        );
        assert_eq!(
            extract_model(loader_type, input_name, Value::Null, false),
            "widget_model"
        );
    }
}

#[test]
fn sampler_custom_model_wrappers_do_not_reopen_wireless_fallback() {
    // Strictness belongs to the entire selected model path, not only the
    // SamplerCustom socket. An unlinked wrapper cannot adopt a singleton loader.
    let prompt = r#"{
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "disconnected.safetensors" } },
        "2": { "class_type": "ModelWrapper", "inputs": {} },
        "3": { "class_type": "SamplerCustom", "inputs": { "model": ["2", 0], "noise_seed": 42, "cfg": 5.5 } },
        "4": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0] } },
        "5": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
    }"#;

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.model, "Unknown");
}

#[test]
fn workflow_ksampler_unresolved_model_socket_keeps_wireless_recovery() {
    // Legacy workflow-only KSampler parsing treats an unresolved UI edge like a
    // missing direct edge and may recover the sole loader wirelessly.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["wireless.safetensors"] },
            { "id": 2, "type": "KSampler", "inputs": [{"name":"model","link":90}], "widgets_values": [42,"fixed",20,5.5,"euler","simple",1] },
            { "id": 3, "type": "VAEDecode", "inputs": [{"name":"samples","link":1}] },
            { "id": 4, "type": "SaveImage", "inputs": [{"name":"images","link":2}] }
        ],
        "links": [
            [1,2,0,3,0,"LATENT"], [2,3,0,4,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "wireless");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Model,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn workflow_ksampler_loader_name_keeps_widget_recovery() {
    // A broken loader-name edge historically falls back to its UI widget during
    // ordinary KSampler traversal; SamplerCustom's fail-closed rule must not leak.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "inputs": [{"name":"ckpt_name","link":90}], "widgets_values": ["widget.safetensors"] },
            { "id": 2, "type": "KSampler", "inputs": [{"name":"model","link":1}], "widgets_values": [42,"fixed",20,5.5,"euler","simple",1] },
            { "id": 3, "type": "VAEDecode", "inputs": [{"name":"samples","link":2}] },
            { "id": 4, "type": "SaveImage", "inputs": [{"name":"images","link":3}] }
        ],
        "links": [
            [1,1,0,2,0,"MODEL"], [2,2,0,3,0,"LATENT"], [3,3,0,4,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "widget");
    assert_field_source(
        &diagnostics,
        ComfyMetadataField::Model,
        ComfyParseLayer::SamplerTraversal,
    );
}

#[test]
fn workflow_ksampler_nested_unresolved_scalars_keep_widget_recovery() {
    // Ordinary KSampler historically accepts the saved primitive widget when a
    // nested UI link is stale; SamplerCustom's strict recursion must not leak.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "PrimitiveInt", "inputs": [{"name":"value","link":90}], "widgets_values": [123] },
            { "id": 3, "type": "PrimitiveInt", "inputs": [{"name":"value","link":91}], "widgets_values": [24] },
            { "id": 4, "type": "PrimitiveFloat", "inputs": [{"name":"value","link":92}], "widgets_values": [6.5] },
            {
                "id": 5, "type": "KSampler",
                "inputs": [
                    {"name":"model","link":1},{"name":"seed","link":2},
                    {"name":"steps","link":3},{"name":"cfg","link":4}
                ],
                "widgets_values": [999,"fixed",99,9.9,"euler","normal",1]
            },
            { "id": 6, "type": "VAEDecode", "inputs": [{"name":"samples","link":5}] },
            { "id": 7, "type": "SaveImage", "inputs": [{"name":"images","link":6}] }
        ],
        "links": [
            [1,1,0,5,0,"MODEL"], [2,2,0,5,4,"INT"],
            [3,3,0,5,5,"INT"], [4,4,0,5,6,"FLOAT"],
            [5,5,0,6,0,"LATENT"], [6,6,0,7,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.seed, Some(123));
    assert_eq!(meta.steps, 24);
    assert_eq!(meta.cfg, 6.5);
}

#[test]
fn workflow_ksampler_switch_boolean_source_keeps_widget_recovery() {
    // Ordinary KSampler switch traversal historically recovers a boolean source's
    // saved widget when its own UI link is stale; SamplerCustom strictness is local.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "PrimitiveInt", "widgets_values": [24] },
            { "id": 3, "type": "PrimitiveInt", "widgets_values": [48] },
            { "id": 4, "type": "PrimitiveBoolean", "inputs": [{"name":"value","link":90}], "widgets_values": [false] },
            {
                "id": 5, "type": "ComfySwitchNode",
                "inputs": [
                    {"name":"switch","link":3},{"name":"on_false","link":1},
                    {"name":"on_true","link":2}
                ]
            },
            {
                "id": 6, "type": "KSampler",
                "inputs": [{"name":"model","link":4},{"name":"steps","link":5}],
                "widgets_values": [42,"fixed",99,5.5,"euler","normal",1]
            },
            { "id": 7, "type": "VAEDecode", "inputs": [{"name":"samples","link":6}] },
            { "id": 8, "type": "SaveImage", "inputs": [{"name":"images","link":7}] }
        ],
        "links": [
            [1,2,0,5,1,"INT"], [2,3,0,5,2,"INT"], [3,4,0,5,0,"BOOLEAN"],
            [4,1,0,6,0,"MODEL"], [5,5,0,6,2,"INT"],
            [6,6,0,7,0,"LATENT"], [7,7,0,8,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 24);
}

#[test]
fn workflow_ksampler_clip_widget_keeps_unresolved_text_link_recovery() {
    // Ordinary KSampler prompt recovery remains widget-first when a saved UI
    // text edge cannot be resolved; strict text semantics belong to SamplerCustom.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "inputs": [{"name":"text","link":90}], "widgets_values": ["recovered prompt"] },
            { "id": 3, "type": "KSampler", "inputs": [{"name":"model","link":1},{"name":"positive","link":2}], "widgets_values": [42,"fixed",20,5.5,"euler","normal",1] },
            { "id": 4, "type": "VAEDecode", "inputs": [{"name":"samples","link":3}] },
            { "id": 5, "type": "SaveImage", "inputs": [{"name":"images","link":4}] }
        ],
        "links": [
            [1,1,0,3,0,"MODEL"], [2,2,0,3,1,"CONDITIONING"],
            [3,3,0,4,0,"LATENT"], [4,4,0,5,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.positive_prompt, "recovered prompt");
}

#[test]
fn sampler_custom_cfg_guider_keeps_strict_prompt_context() {
    // Strictness belongs to the selected SamplerCustom path even though model and
    // prompt traversal cross a reroute into its CFGGuider. A broken text edge must
    // not reopen the CLIP node's stale widget, while a real model and an
    // unconnected literal remain valid.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "CLIPTextEncode", "inputs": [{"name":"text","link":90}], "widgets_values": ["stale positive"] },
            { "id": 3, "type": "CLIPTextEncode", "inputs": [], "widgets_values": ["literal negative"] },
            { "id": 4, "type": "CFGGuider", "inputs": [
                {"name":"model","link":1},{"name":"positive","link":2},
                {"name":"negative","link":3}
            ], "widgets_values": [7.0] },
            { "id": 5, "type": "Reroute", "inputs": [{"name":"","link":4}] },
            { "id": 6, "type": "KSamplerSelect", "widgets_values": ["euler"] },
            { "id": 7, "type": "BasicScheduler", "inputs": [{"name":"model","link":5}], "widgets_values": ["simple",20,1] },
            { "id": 8, "type": "EmptyLatentImage", "widgets_values": [512,512,1] },
            { "id": 9, "type": "SamplerCustom", "inputs": [
                {"name":"guider","link":6},{"name":"sampler","link":7},
                {"name":"sigmas","link":8},{"name":"latent_image","link":9}
            ], "widgets_values": [true,42,"fixed",5.5] },
            { "id": 10, "type": "VAEDecode", "inputs": [{"name":"samples","link":10}] },
            { "id": 11, "type": "SaveImage", "inputs": [{"name":"images","link":11}] }
        ],
        "links": [
            [1,1,0,4,0,"MODEL"], [2,2,0,4,1,"CONDITIONING"],
            [3,3,0,4,2,"CONDITIONING"], [4,4,0,5,0,"GUIDER"],
            [5,1,0,7,0,"MODEL"], [6,5,0,9,0,"GUIDER"],
            [7,6,0,9,1,"SAMPLER"], [8,7,0,9,2,"SIGMAS"],
            [9,8,0,9,3,"LATENT"], [10,9,0,10,0,"LATENT"],
            [11,10,0,11,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "model");
    assert_eq!(meta.positive_prompt, "");
    assert_eq!(meta.negative_prompt, "literal negative");
}

#[test]
fn sampler_custom_does_not_treat_split_sigmas_index_as_total_steps() {
    // SplitSigmas exposes a split position, not the scheduler's total step count.
    // Until its upstream scheduler is traversed deliberately, that value is unavailable.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "KSamplerSelect", "widgets_values": ["res_multistep"] },
            { "id": 3, "type": "SplitSigmas", "widgets_values": [3] },
            { "id": 4, "type": "SamplerCustom", "inputs": [
                {"name":"model","link":1},{"name":"sampler","link":2},
                {"name":"sigmas","link":3}
            ], "widgets_values": [true,42,"fixed",1.0] },
            { "id": 5, "type": "VAEDecode", "inputs": [{"name":"samples","link":4}] },
            { "id": 6, "type": "SaveImage", "inputs": [{"name":"images","link":5}] }
        ],
        "links": [
            [1,1,0,4,0,"MODEL"], [2,2,0,4,1,"SAMPLER"],
            [3,3,0,4,2,"SIGMAS"], [4,4,0,5,0,"LATENT"],
            [5,5,0,6,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 0);
    assert_eq!(meta.sampler, "res_multistep");
}

#[test]
fn sampler_custom_preserves_steps_from_direct_karras_scheduler() {
    // Unlike SplitSigmas, a direct scheduler's step input is the total schedule
    // length and remains valid metadata for the selected SamplerCustom path.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "KSamplerSelect", "widgets_values": ["res_multistep"] },
            { "id": 3, "type": "KarrasScheduler", "widgets_values": [20,14.6,0.03,7.0] },
            { "id": 4, "type": "SamplerCustom", "inputs": [
                {"name":"model","link":1},{"name":"sampler","link":2},
                {"name":"sigmas","link":3}
            ], "widgets_values": [true,42,"fixed",1.0] },
            { "id": 5, "type": "VAEDecode", "inputs": [{"name":"samples","link":4}] },
            { "id": 6, "type": "SaveImage", "inputs": [{"name":"images","link":5}] }
        ],
        "links": [
            [1,1,0,4,0,"MODEL"], [2,2,0,4,1,"SAMPLER"],
            [3,3,0,4,2,"SIGMAS"], [4,4,0,5,0,"LATENT"],
            [5,5,0,6,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.steps, 20);
    assert_eq!(meta.sampler, "res_multistep");
}

#[test]
fn sampler_custom_conditioning_wrappers_remain_strict_after_first_hop() {
    // A directly connected wrapper may follow its real edge, but an unconnected
    // wrapper cannot adopt a disconnected CLIP node merely because its title matches.
    let prompt = r#"{
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "model.safetensors" } },
        "2": { "class_type": "CLIPTextEncode", "inputs": { "text": "connected positive" } },
        "3": { "class_type": "CLIPTextEncode", "_meta": { "title": "Negative Prompt" }, "inputs": { "text": "disconnected negative" } },
        "4": { "class_type": "ConditioningSetArea", "inputs": { "conditioning": ["2", 0] } },
        "5": { "class_type": "ConditioningSetArea", "inputs": { "conditioning": null } },
        "6": { "class_type": "SamplerCustom", "inputs": {
            "model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
            "noise_seed": 42, "cfg": 5.5
        } },
        "7": { "class_type": "VAEDecode", "inputs": { "samples": ["6", 0] } },
        "8": { "class_type": "SaveImage", "inputs": { "images": ["7", 0] } }
    }"#;

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.positive_prompt, "connected positive");
    assert_eq!(meta.negative_prompt, "");
}

#[test]
fn sampler_custom_conditioning_combine_fails_closed_on_unresolved_required_branch() {
    // A selected strict composite is trustworthy only when every declared
    // required branch resolves. Ordinary KSampler traversal keeps its legacy
    // best-effort partial prompt behavior for the same saved workflow.
    let mut workflow: Value = serde_json::from_str(
        r#"{
            "nodes": [
                { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
                { "id": 2, "type": "CLIPTextEncode", "inputs": [], "widgets_values": ["resolved branch"] },
                { "id": 3, "type": "ConditioningCombine", "inputs": [
                    {"name":"conditioning_1","link":1},
                    {"name":"conditioning_2","link":null}
                ] },
                { "id": 4, "type": "SamplerCustom", "inputs": [
                    {"name":"model","link":2},{"name":"positive","link":3}
                ], "widgets_values": [true,42,"fixed",5.5] },
                { "id": 5, "type": "VAEDecode", "inputs": [{"name":"samples","link":4}] },
                { "id": 6, "type": "SaveImage", "inputs": [{"name":"images","link":5}] }
            ],
            "links": [
                [1,2,0,3,0,"CONDITIONING"], [2,1,0,4,0,"MODEL"],
                [3,3,0,4,1,"CONDITIONING"], [4,4,0,5,0,"LATENT"],
                [5,5,0,6,0,"IMAGE"]
            ]
        }"#,
    )
    .expect("test workflow should be valid JSON");
    let extract = |workflow: &Value| {
        extract_comfyui_metadata_with_diagnostics(&HashMap::from([(
            "workflow".to_string(),
            workflow.to_string(),
        )]))
        .0
    };

    assert_eq!(extract(&workflow).positive_prompt, "");

    workflow["nodes"][3]["type"] = json!("KSampler");
    assert_eq!(extract(&workflow).positive_prompt, "resolved branch");
}

#[test]
fn sampler_custom_direct_model_state_blocks_conflicting_guider_model() {
    // A declared direct model socket owns model authority even when strict
    // traversal cannot extract a name. Only a genuinely absent socket may defer
    // to the connected guider model.
    let extract_model = |direct_model_link: u64, include_direct_model_edge: bool| {
        let mut links = vec![
            json!([1, 1, 0, 3, 0, "MODEL"]),
            json!([3, 3, 0, 4, 1, "GUIDER"]),
            json!([4, 4, 0, 5, 0, "LATENT"]),
            json!([5, 5, 0, 6, 0, "IMAGE"]),
        ];
        if include_direct_model_edge {
            links.push(json!([2, 2, 0, 4, 0, "MODEL"]));
        }
        let workflow = json!({
            "nodes": [
                { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["guider-model.safetensors"] },
                { "id": 2, "type": "ModelWrapper", "inputs": [] },
                { "id": 3, "type": "CFGGuider", "inputs": [{"name":"model","link":1}], "widgets_values": [7.0] },
                { "id": 4, "type": "SamplerCustom", "inputs": [
                    {"name":"model","link":direct_model_link},{"name":"guider","link":3}
                ], "widgets_values": [true,42,"fixed",5.5] },
                { "id": 5, "type": "VAEDecode", "inputs": [{"name":"samples","link":4}] },
                { "id": 6, "type": "SaveImage", "inputs": [{"name":"images","link":5}] }
            ],
            "links": links
        });

        extract_comfyui_metadata_with_diagnostics(&HashMap::from([(
            "workflow".to_string(),
            workflow.to_string(),
        )]))
        .0
        .model
    };

    assert_eq!(extract_model(2, true), "Unknown");
    assert_eq!(extract_model(90, false), "Unknown");
}

#[test]
fn sampler_custom_conditioning_concat_requires_both_branches() {
    // Concat is a mandatory composite on the selected strict path. A broken or
    // absent branch suppresses the whole prompt, while ordinary KSampler keeps
    // its historical best-effort partial extraction.
    let mut workflow: Value = serde_json::from_str(
        r#"{
            "nodes": [
                { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
                { "id": 2, "type": "CLIPTextEncode", "inputs": [], "widgets_values": ["resolved branch"] },
                { "id": 3, "type": "ConditioningConcat", "inputs": [
                    {"name":"conditioning_to","link":1},
                    {"name":"conditioning_from","link":90}
                ] },
                { "id": 4, "type": "SamplerCustom", "inputs": [
                    {"name":"model","link":2},{"name":"positive","link":3}
                ], "widgets_values": [true,42,"fixed",5.5] },
                { "id": 5, "type": "VAEDecode", "inputs": [{"name":"samples","link":4}] },
                { "id": 6, "type": "SaveImage", "inputs": [{"name":"images","link":5}] }
            ],
            "links": [
                [1,2,0,3,0,"CONDITIONING"], [2,1,0,4,0,"MODEL"],
                [3,3,0,4,1,"CONDITIONING"], [4,4,0,5,0,"LATENT"],
                [5,5,0,6,0,"IMAGE"]
            ]
        }"#,
    )
    .expect("test workflow should be valid JSON");
    let extract = |workflow: &Value| {
        extract_comfyui_metadata_with_diagnostics(&HashMap::from([(
            "workflow".to_string(),
            workflow.to_string(),
        )]))
        .0
    };

    assert_eq!(extract(&workflow).positive_prompt, "");

    workflow["nodes"][2]["inputs"][1]["link"] = Value::Null;
    assert_eq!(extract(&workflow).positive_prompt, "");

    workflow["nodes"][3]["type"] = json!("KSampler");
    assert_eq!(extract(&workflow).positive_prompt, "resolved branch");
}

#[test]
fn sampler_custom_sdxl_requires_all_declared_text_connections() {
    // A broken required SDXL text edge must not expose the other encoder half.
    // Ordinary KSampler remains best effort, and genuinely unlinked literals
    // remain valid on the strict path.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["model.safetensors"] },
            { "id": 2, "type": "PrimitiveNode", "widgets_values": ["local text"] },
            { "id": 3, "type": "CLIPTextEncodeSDXL", "inputs": [
                {"name":"text_g","link":90},{"name":"text_l","link":1}
            ] },
            { "id": 4, "type": "SamplerCustom", "inputs": [
                {"name":"model","link":2},{"name":"positive","link":3}
            ], "widgets_values": [true,42,"fixed",5.5] },
            { "id": 5, "type": "VAEDecode", "inputs": [{"name":"samples","link":4}] },
            { "id": 6, "type": "SaveImage", "inputs": [{"name":"images","link":5}] }
        ],
        "links": [
            [1,2,0,3,1,"STRING"], [2,1,0,4,0,"MODEL"],
            [3,3,0,4,1,"CONDITIONING"], [4,4,0,5,0,"LATENT"],
            [5,5,0,6,0,"IMAGE"]
        ]
    }"#;
    let mut workflow: Value =
        serde_json::from_str(workflow).expect("test workflow should be valid JSON");
    let extract_workflow = |workflow: &Value| {
        extract_comfyui_metadata_with_diagnostics(&HashMap::from([(
            "workflow".to_string(),
            workflow.to_string(),
        )]))
        .0
    };

    assert_eq!(extract_workflow(&workflow).positive_prompt, "");

    workflow["nodes"][3]["type"] = json!("KSampler");
    assert_eq!(extract_workflow(&workflow).positive_prompt, "local text");

    let prompt = r#"{
        "1": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "model.safetensors" } },
        "2": { "class_type": "CLIPTextEncodeSDXL", "inputs": { "text_g": "global text", "text_l": "local text" } },
        "3": { "class_type": "SamplerCustom", "inputs": { "model": ["1", 0], "positive": ["2", 0] } },
        "4": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0] } },
        "5": { "class_type": "SaveImage", "inputs": { "images": ["4", 0] } }
    }"#;
    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

    assert_eq!(meta.positive_prompt, "global text . local text");
}

#[test]
fn sampler_custom_model_wrapper_stops_at_first_declared_unresolved_alias() {
    // Strict wrapper aliases are ordered: a declared-broken model socket owns
    // absence and must not fall through to the later connected ckpt socket.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["wrong-model.safetensors"] },
            { "id": 2, "type": "ModelWrapper", "inputs": [
                {"name":"model","link":90},{"name":"ckpt","link":1}
            ] },
            { "id": 3, "type": "SamplerCustom", "inputs": [{"name":"model","link":2}], "widgets_values": [true,42,"fixed",5.5] },
            { "id": 4, "type": "VAEDecode", "inputs": [{"name":"samples","link":3}] },
            { "id": 5, "type": "SaveImage", "inputs": [{"name":"images","link":4}] }
        ],
        "links": [
            [1,1,0,2,1,"MODEL"], [2,2,0,3,0,"MODEL"],
            [3,3,0,4,0,"LATENT"], [4,4,0,5,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "Unknown");
}

#[test]
fn sampler_custom_reroute_stops_at_first_declared_unresolved_alias() {
    // Reroute aliases are authoritative in declaration order. A broken empty-name
    // edge must fail closed instead of falling through to a connected value alias.
    let workflow = r#"{
        "nodes": [
            { "id": 1, "type": "CheckpointLoaderSimple", "widgets_values": ["wrong-model.safetensors"] },
            { "id": 2, "type": "Reroute", "inputs": [
                {"name":"","link":90},{"name":"value","link":1}
            ] },
            { "id": 3, "type": "SamplerCustom", "inputs": [{"name":"model","link":2}], "widgets_values": [true,42,"fixed",5.5] },
            { "id": 4, "type": "VAEDecode", "inputs": [{"name":"samples","link":3}] },
            { "id": 5, "type": "SaveImage", "inputs": [{"name":"images","link":4}] }
        ],
        "links": [
            [1,1,0,2,1,"MODEL"], [2,2,0,3,0,"MODEL"],
            [3,3,0,4,0,"LATENT"], [4,4,0,5,0,"IMAGE"]
        ]
    }"#;
    let chunks = HashMap::from([("workflow".to_string(), workflow.to_string())]);

    let (meta, _) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(meta.model, "Unknown");
}

#[test]
fn sampler_custom_sd_parameter_generator_model_name_is_link_first() {
    // The selected strict model path follows a valid filename edge and treats a
    // broken declared edge as absence instead of reopening the stale widget.
    let extract_model = |name_link: u64, include_name_edge: bool| {
        let mut links = vec![
            json!([2, 2, 1, 4, 0, "MODEL"]),
            json!([3, 4, 0, 5, 0, "LATENT"]),
            json!([4, 5, 0, 6, 0, "IMAGE"]),
        ];
        if include_name_edge {
            links.push(json!([1, 1, 0, 2, 0, "STRING"]));
        }
        let workflow = json!({
            "nodes": [
                { "id": 1, "type": "String", "widgets_values": ["linked-model.safetensors"] },
                { "id": 2, "type": "SDParameterGenerator", "inputs": [{"name":"ckpt_name","link":name_link}], "widgets_values": ["widget-model.safetensors"] },
                { "id": 4, "type": "SamplerCustom", "inputs": [{"name":"model","link":2}], "widgets_values": [true,42,"fixed",5.5] },
                { "id": 5, "type": "VAEDecode", "inputs": [{"name":"samples","link":3}] },
                { "id": 6, "type": "SaveImage", "inputs": [{"name":"images","link":4}] }
            ],
            "links": links
        });
        extract_comfyui_metadata_with_diagnostics(&HashMap::from([(
            "workflow".to_string(),
            workflow.to_string(),
        )]))
        .0
        .model
    };

    assert_eq!(extract_model(1, true), "linked_model");
    assert_eq!(extract_model(99, false), "Unknown");
}
