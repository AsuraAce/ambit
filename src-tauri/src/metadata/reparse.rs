//! Metadata Re-parsing Module
//! 
//! Re-parses image metadata from stored `original_metadata_json` without file I/O.
//! Used when parser logic improves to extract better data from existing images.

use super::{extract_a1111_metadata, extract_comfyui_metadata, extract_invokeai_metadata, ImageMetadata};
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
        // If it has "workflow" key, it's already structured correctly
        if parsed.get("workflow").is_some() {
            chunks.insert("workflow".to_string(), parsed["workflow"].to_string());
        } else if parsed.get("prompt").is_some() {
            chunks.insert("prompt".to_string(), parsed["prompt"].to_string());
        } else {
            // Assume the whole thing is the prompt/workflow
            chunks.insert("prompt".to_string(), original_json.to_string());
        }
    } else {
        // If it's not valid JSON, treat it as a raw workflow string
        chunks.insert("prompt".to_string(), original_json.to_string());
    }
    
    let metadata = extract_comfyui_metadata(&chunks);
    Some(metadata)
}

fn reparse_invokeai(original_json: &str) -> Option<ImageMetadata> {
    let parsed: serde_json::Value = serde_json::from_str(original_json).ok()?;

    // Check if the JSON is a "chunks" map containing the metadata as a string
    if let Some(inner) = parsed
        .get("invokeai_metadata")
        .or_else(|| parsed.get("sd-metadata"))
        .or_else(|| parsed.get("dream_metadata"))
    {
        if let Some(inner_str) = inner.as_str() {
            if let Ok(inner_parsed) = serde_json::from_str::<serde_json::Value>(inner_str) {
                return Some(extract_invokeai_metadata(&inner_parsed));
            }
        }
    }

    // Fallback: Assume the JSON is the metadata itself (legacy/direct support)
    let metadata = extract_invokeai_metadata(&parsed);
    Some(metadata)
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
    fn test_reparse_a1111() {
        let original = "a beautiful cat\nNegative prompt: ugly\nSteps: 30, CFG scale: 7, Seed: 12345";
        let result = reparse_from_json(original, "Automatic1111").unwrap();
        
        assert_eq!(result.metadata.tool, "Automatic1111");
        assert_eq!(result.metadata.positive_prompt, "a beautiful cat");
        assert_eq!(result.metadata.negative_prompt, "ugly");
        assert_eq!(result.metadata.steps, 30);
    }
    
    #[test]
    fn test_reparse_comfyui() {
        // Minimal ComfyUI prompt structure
        let original = r#"{"1": {"class_type": "KSampler", "inputs": {"seed": 42, "steps": 25}}}"#;
        let result = reparse_from_json(original, "ComfyUI").unwrap();
        
        assert_eq!(result.metadata.tool, "ComfyUI");
        // ComfyUI parsing is complex, just verify it doesn't panic
    }
}
