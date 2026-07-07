use super::super::diagnostics::{
    ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer,
};
use crate::metadata::comfyui::extract_comfyui_metadata_with_diagnostics;
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
    assert!(
        !diagnostics
            .attempted_layers
            .contains(&ComfyParseLayer::SamplerFallback)
    );
    assert!(
        !diagnostics
            .attempted_layers
            .contains(&ComfyParseLayer::GlobalScan)
    );
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

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

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

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

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

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

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

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

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

    let (meta, diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks_with_prompt(prompt));

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
