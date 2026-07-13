use super::super::diagnostics::{ComfyMetadataField, ComfyParseDiagnostics, ComfyParseLayer};
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
