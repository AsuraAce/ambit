//! Metadata Re-parsing Module
//!
//! Re-parses image metadata from stored `original_metadata_json` without file I/O.
//! Used when parser logic improves to extract better data from existing images.

use super::{extract_a1111_metadata, extract_invokeai_metadata, ImageMetadata};
use std::collections::HashMap;

/// Result of re-parsing metadata from stored JSON.
#[derive(Debug)]
pub struct ReparseResult {
    pub metadata: ImageMetadata,
    pub metadata_json: String,
}

/// Re-parse metadata from the stored original_metadata_json.
///
/// The tool type is used to determine which parser to invoke.
/// Returns the new ImageMetadata and its JSON serialization.
pub fn reparse_from_json(original_json: &str, tool: &str) -> Option<ReparseResult> {
    let tool_lower = tool.to_lowercase();

    let metadata = if tool_lower.contains("comfy") {
        reparse_comfyui(original_json)?
    } else if tool_lower.contains("invoke") {
        reparse_invokeai(original_json)?
    } else {
        // A1111, SD.Next, Forge, Anapnoe, etc. all use A1111-style text format
        reparse_a1111(original_json, Some(tool.to_string()))?
    };

    // Serialize the new metadata to JSON
    let metadata_json = serde_json::to_string(&metadata).ok()?;

    Some(ReparseResult {
        metadata,
        metadata_json,
    })
}

/// Re-parse ComfyUI metadata from stored JSON.
/// The stored format is typically the "prompt" or "workflow" JSON.
fn reparse_comfyui(original_json: &str) -> Option<ImageMetadata> {
    let mut chunks = HashMap::new();

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(original_json) {
        if let Some(envelope) = parsed.as_object().filter(|object| {
            [
                "parameters",
                "Parameters",
                "PARAMETERS",
                "prompt",
                "workflow",
            ]
            .iter()
            .any(|key| object.contains_key(*key))
        }) {
            let parameters = ["parameters", "Parameters", "PARAMETERS"]
                .iter()
                .find_map(|key| envelope.get(*key).and_then(|value| value.as_str()));
            let mut metadata = parameters
                .map(|text| extract_a1111_metadata(text, Some("ComfyUI".to_string())))
                .unwrap_or_else(|| ImageMetadata {
                    tool: "ComfyUI".to_string(),
                    ..ImageMetadata::default()
                });

            for key in ["prompt", "workflow"] {
                if let Some(value) = envelope.get(key) {
                    let chunk = value
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| value.to_string());
                    chunks.insert(key.to_string(), chunk);
                }
            }

            if !chunks.is_empty() {
                super::comfyui::merge_comfyui_metadata(&mut metadata, &chunks);
            }

            metadata.tool = "ComfyUI".to_string();
            return Some(metadata);
        }

        // Preserve legacy rows that stored a raw or double-encoded graph instead
        // of the normal chunk envelope.
        if let Some(graph) = parsed.as_str() {
            chunks.insert("prompt".to_string(), graph.to_string());
        } else {
            chunks.insert("prompt".to_string(), original_json.to_string());
        }
    } else {
        // If it's not valid JSON, treat it as a raw workflow/prompt string
        chunks.insert("prompt".to_string(), original_json.to_string());
    }

    let mut metadata = ImageMetadata::default();
    super::comfyui::merge_comfyui_metadata(&mut metadata, &chunks);
    metadata.tool = "ComfyUI".to_string();
    Some(metadata)
}

fn reparse_invokeai(original_json: &str) -> Option<ImageMetadata> {
    let parsed: serde_json::Value = serde_json::from_str(original_json).ok()?;
    Some(extract_invokeai_metadata(&parsed))
}

/// Re-parse A1111-style metadata from stored text.
fn reparse_a1111(original_json: &str, tool: Option<String>) -> Option<ImageMetadata> {
    // A1111 stores raw text parameters, not JSON
    // The original_metadata_json might be:
    // 1. Raw text (if stored directly)
    // 2. JSON-escaped text (if stored as JSON string)

    let text = if original_json.starts_with('"') {
        // Try to unescape JSON string
        serde_json::from_str::<String>(original_json).unwrap_or_else(|_| original_json.to_string())
    } else if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(original_json) {
        // If it's a JSON object with a "parameters" field
        if let Some(params) = parsed.get("parameters").and_then(|p| p.as_str()) {
            params.to_string()
        } else if parsed.as_object().is_some_and(|object| object.is_empty()) {
            return Some(ImageMetadata {
                tool: tool.unwrap_or_else(|| "Automatic1111".to_string()),
                ..ImageMetadata::default()
            });
        } else {
            original_json.to_string()
        }
    } else {
        original_json.to_string()
    };

    let metadata = extract_a1111_metadata(&text, tool);
    Some(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_reparse_invokeai() {
        let original = r#"{"positive_prompt": "a cat", "steps": 20, "cfg_scale": 7.5}"#;
        let result = reparse_from_json(original, "InvokeAI").unwrap();

        assert_eq!(result.metadata.tool, "InvokeAI");
        assert_eq!(result.metadata.positive_prompt, "a cat");
        assert_eq!(result.metadata.steps, 20);
    }

    #[test]
    fn test_reparse_invokeai_mapped() {
        // Test handling of our internal format (camelCase) accidentally stored as raw
        let original = r#"{"positivePrompt": "a dog", "steps": 30, "cfg": 8.0}"#;
        let result = reparse_from_json(original, "InvokeAI").unwrap();

        assert_eq!(result.metadata.tool, "InvokeAI");
        assert_eq!(result.metadata.positive_prompt, "a dog");
        assert_eq!(result.metadata.steps, 30);
        assert_eq!(result.metadata.cfg, 8.0);
    }

    #[test]
    fn test_reparse_a1111() {
        let original =
            "a beautiful cat\nNegative prompt: ugly\nSteps: 30, CFG scale: 7, Seed: 12345";
        let result = reparse_from_json(original, "Automatic1111").unwrap();

        assert_eq!(result.metadata.tool, "Automatic1111");
        assert_eq!(result.metadata.positive_prompt, "a beautiful cat");
        assert_eq!(result.metadata.negative_prompt, "ugly");
        assert_eq!(result.metadata.steps, 30);
    }

    #[test]
    fn test_reparse_empty_chunk_map_is_not_a_prompt() {
        let result = reparse_from_json("{}", "Unknown").expect("reparse empty metadata");

        assert_eq!(result.metadata.tool, "Unknown");
        assert_eq!(result.metadata.model, "Unknown");
        assert!(result.metadata.positive_prompt.is_empty());
        assert!(result.metadata.negative_prompt.is_empty());
        assert!(result.metadata.raw_parameters.is_none());
        assert!(result.metadata.workflow_json.is_none());
        assert!(!result.metadata.has_workflow_hint);
    }

    #[test]
    fn test_reparse_restores_explicit_zero_seed() {
        let result = reparse_from_json("a cat\nSteps: 20, CFG scale: 7, Seed: 0", "Automatic1111")
            .expect("reparse metadata");

        assert_eq!(result.metadata.seed, Some(0));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result.metadata_json)
                .expect("metadata JSON")["seed"],
            0
        );
    }

    #[test]
    fn test_reparse_comfyui_both_chunks() {
        let original = r#"{"workflow": "workflow_content", "prompt": "prompt_content"}"#;
        let result = reparse_from_json(original, "ComfyUI").unwrap();

        assert_eq!(result.metadata.tool, "ComfyUI");
        // Verify that workflow_json is populated from the actual workflow chunk
        assert_eq!(
            result.metadata.workflow_json,
            Some("workflow_content".to_string())
        );
    }

    #[test]
    fn test_reparse_comfyui_prompt_only() {
        let original = r#"{"prompt": "prompt_content"}"#;
        let result = reparse_from_json(original, "ComfyUI").unwrap();

        assert_eq!(result.metadata.tool, "ComfyUI");
        // Fallback to prompt if workflow is missing
        assert_eq!(
            result.metadata.workflow_json,
            Some("prompt_content".to_string())
        );
    }

    #[test]
    fn test_reparse_comfyui_parameters_only_preserves_flat_generation_data() {
        let original =
            include_str!("comfyui/tests/fixtures/real_world/format_parity_webp_flat.chunks.json");
        let result = reparse_from_json(original, "ComfyUI").expect("reparse metadata");

        assert_eq!(result.metadata.tool, "ComfyUI");
        assert_eq!(result.metadata.model, "ArrogantBastard_ponyV33SS");
        assert_eq!(result.metadata.model_hash.as_deref(), Some("ed5932e68b"));
        assert_eq!(result.metadata.steps, 20);
        assert_eq!(result.metadata.cfg, 8.0);
        assert_eq!(result.metadata.sampler, "euler_simple");
        assert_eq!(result.metadata.seed, Some(0));
        assert!(result.metadata.positive_prompt.is_empty());
        assert!(result.metadata.negative_prompt.is_empty());
        assert!(result.metadata.workflow_json.is_none());
        assert!(!result.metadata.has_workflow_hint);
    }

    #[test]
    fn test_reparse_comfyui_mixed_chunks_uses_scanner_merge_precedence() {
        let prompt = serde_json::json!({
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": { "ckpt_name": "graph-model.safetensors" }
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": { "text": "graph positive", "clip": ["1", 1] }
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": { "text": "graph negative", "clip": ["1", 1] }
            },
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": { "width": 512, "height": 512, "batch_size": 1 }
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                    "seed": 123,
                    "steps": 8,
                    "cfg": 1.5,
                    "sampler_name": "euler",
                    "scheduler": "simple",
                    "denoise": 1.0
                }
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": { "samples": ["5", 0], "vae": ["1", 2] }
            },
            "7": {
                "class_type": "SaveImage",
                "inputs": { "images": ["6", 0], "filename_prefix": "test" }
            }
        });
        let prompt_json = prompt.to_string();
        let original = serde_json::json!({
            "parameters": "unknown\nNegative prompt: unknown\nSteps: 20, Sampler: stale_sampler, CFG scale: 8.0, Seed: 0, Model: stale-model.safetensors, Version: ComfyUI",
            "prompt": prompt_json
        })
        .to_string();

        let result = reparse_from_json(&original, "ComfyUI").expect("reparse metadata");

        assert_eq!(result.metadata.model, "graph_model");
        assert_eq!(result.metadata.steps, 8);
        assert_eq!(result.metadata.cfg, 1.5);
        assert_eq!(result.metadata.seed, Some(123));
        assert_eq!(result.metadata.sampler, "euler (simple)");
        assert_eq!(result.metadata.positive_prompt, "graph positive");
        assert_eq!(result.metadata.negative_prompt, "graph negative");
        assert_eq!(
            result.metadata.workflow_json.as_deref(),
            Some(prompt_json.as_str())
        );
        assert!(result.metadata.has_workflow_hint);
    }

    #[test]
    fn test_reparse_comfyui_preserves_raw_and_double_encoded_graphs() {
        let graph = serde_json::json!({
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": { "ckpt_name": "legacy-model.safetensors" }
            }
        })
        .to_string();
        let encoded = serde_json::to_string(&graph).expect("encode graph");

        for original in [&graph, &encoded] {
            let result = reparse_from_json(original, "ComfyUI").expect("reparse metadata");
            assert_eq!(result.metadata.tool, "ComfyUI");
            assert_eq!(result.metadata.model, "legacy_model");
            assert_eq!(
                result.metadata.workflow_json.as_deref(),
                Some(graph.as_str())
            );
            assert!(result.metadata.has_workflow_hint);
        }
    }
}
