//! Metadata Re-parsing Module
//!
//! Re-parses image metadata from stored `original_metadata_json` without file I/O.
//! Used when parser logic improves to extract better data from existing images.

use super::{
    extract_a1111_metadata, extract_comfyui_metadata, extract_invokeai_metadata, ImageMetadata,
};
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
    // ComfyUI stores its workflow/prompt as JSON
    // We need to reconstruct the chunks HashMap that the parser expects
    let mut chunks = HashMap::new();

    // Try to parse as JSON to see if it's a workflow or prompt structure
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(original_json) {
        let mut found_any = false;
        // Collect both if present
        if let Some(wf) = parsed.get("workflow") {
            let val = if let Some(s) = wf.as_str() {
                s.to_string()
            } else {
                wf.to_string()
            };
            chunks.insert("workflow".to_string(), val);
            found_any = true;
        }
        if let Some(prompt) = parsed.get("prompt") {
            let val = if let Some(s) = prompt.as_str() {
                s.to_string()
            } else {
                prompt.to_string()
            };
            chunks.insert("prompt".to_string(), val);
            found_any = true;
        }

        // Fallback: If neither was found, assume the whole thing is the JSON
        if !found_any {
            // Check if it's a string type (double encoded)
            if let Some(s) = parsed.as_str() {
                chunks.insert("prompt".to_string(), s.to_string());
            } else {
                chunks.insert("prompt".to_string(), original_json.to_string());
            }
        }
    } else {
        // If it's not valid JSON, treat it as a raw workflow/prompt string
        chunks.insert("prompt".to_string(), original_json.to_string());
    }

    let metadata = extract_comfyui_metadata(&chunks);
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
}
