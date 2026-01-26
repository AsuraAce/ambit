use super::graph::{ComfyGraph, get_node_type, get_node_param, get_node_title, get_node_input_link};
use crate::metadata::ImageMetadata;
use std::collections::HashMap;
use serde_json::Value;

/// Layer 2: Explicit Metadata Nodes
/// Scans for nodes specifically designed to embed metadata.
pub fn scan_explicit_nodes(graph: &ComfyGraph) -> Option<ImageMetadata> {
    let mut meta = ImageMetadata::default();
    let mut found = false;

    for (id, node) in graph.nodes() {
        let t = get_node_type(node);

        // SDParameterGenerator / Crystools
        if t == "SDParameterGenerator" || t.contains("Crystools") {
            // These nodes usually have widgets matching the standard keys
            if let Some(v) = get_node_param(node, "steps").and_then(|v| v.as_u64()) { meta.steps = v as u32; found = true; }
            if let Some(v) = get_node_param(node, "cfg").and_then(|v| v.as_f64()) { meta.cfg = v as f32; found = true; }
            if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) { meta.seed = v; found = true; }
            if let Some(v) = get_node_param(node, "sampler").and_then(|v| v.as_str()) { meta.sampler = v.to_string(); found = true; }
            if let Some(v) = get_node_param(node, "scheduler").and_then(|v| v.as_str()) { 
                if !meta.sampler.is_empty() { meta.sampler = format!("{} ({})", meta.sampler, v); } 
            }
            if let Some(v) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) { meta.model = v.replace(".safetensors", "").replace(".ckpt", ""); found = true; }
        }
        
        // ShowText / ShowAnything (Specific labels)
        // If user labeled a node "Positive", trust it?
        if let Some(title) = get_node_title(node) {
            let title_lower = title.to_lowercase();
            if title.contains("positive") || (t.contains("cliptextencode") && !title.contains("negative")) || t.contains("showanything") {
                if let Some(text) = trace_text_source_simple(graph, id) {
                    meta.positive_prompt = text.to_string();
                    found = true;
                }
            } else if title.contains("negative") {
                if let Some(text) = trace_text_source_simple(graph, id) {
                    meta.negative_prompt = text.to_string();
                    found = true;
                }
            }
        }

        // Try to extract model from any node that might have it
        if meta.model.is_empty() {
            if let Some(model_name) = extract_model_from_node(node) {
                meta.model = model_name;
            }
        }
    }

    if found { Some(meta) } else { None }
}

/// Layer 4: Global Fallback Scan
/// Linear scan for when traversal fails.
pub fn global_scan(graph: &ComfyGraph) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    
    // Find ANY KSampler
    for (_id, node) in graph.nodes() {
        let t = get_node_type(node);
        if t.to_lowercase().contains("ksampler") {
             if meta.steps == 0 {
                 if let Some(v) = get_node_param(node, "steps").and_then(|v| v.as_u64()) { meta.steps = v as u32; }
             }
             if meta.cfg == 0.0 {
                 if let Some(v) = get_node_param(node, "cfg").and_then(|v| v.as_f64()) { meta.cfg = v as f32; }
             }
              if meta.seed == 0 {
                 if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) { meta.seed = v; }
                 else if let Some(v) = get_node_param(node, "noise_seed").and_then(|v| v.as_i64()) { meta.seed = v; }
             }
        }
        if t == "String" || t == "PrimitiveNode" || t == "ShowText" || t == "Note" {
             if meta.positive_prompt.is_empty() {
                 if let Some(text) = get_node_param(node, "text").and_then(|v| v.as_str()) {
                     meta.positive_prompt = text.to_string();
                 } else if let Some(text) = get_node_param(node, "string").and_then(|v| v.as_str()) {
                     meta.positive_prompt = text.to_string();
                 } else if let Some(text) = get_node_param(node, "STRING").and_then(|v| v.as_str()) {
                     meta.positive_prompt = text.to_string();
                 }
             }
        }
    }
    
    meta
}

fn extract_model_from_node(node: &Value) -> Option<String> {
    if let Some(name) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) { return Some(name.replace(".safetensors", "").replace(".ckpt", "")); }
    if let Some(name) = get_node_param(node, "unet_name").and_then(|v| v.as_str()) { return Some(name.replace(".safetensors", "").replace(".ckpt", "")); }
    if let Some(name) = get_node_param(node, "model_name").and_then(|v| v.as_str()) { return Some(name.replace(".safetensors", "").replace(".ckpt", "")); }
    if let Some(name) = get_node_param(node, "checkpoint").and_then(|v| v.as_str()) { return Some(name.replace(".safetensors", "").replace(".ckpt", "")); }
    None
}

/// Simple 1-level trace for text (text widget or linked primitive)
fn trace_text_source_simple(graph: &ComfyGraph, node_id: &str) -> Option<String> {
    let node = graph.get_node(node_id)?;
    // 1. Check direct text
    if let Some(text) = get_node_param(node, "text").and_then(|v| v.as_str()) {
        if !text.trim().is_empty() { return Some(text.to_string()); }
    }
    if let Some(text) = get_node_param(node, "string").and_then(|v| v.as_str()) {
         if !text.trim().is_empty() { return Some(text.to_string()); }
    }
    
    // 2. Check input link (max 1 depth)
    // Common case: Primitive -> CLIPTextEncode
    if let Some(source_id) = get_node_input_link(node, "text") {
         let source = graph.get_node(&source_id)?;
         if let Some(text) = get_node_param(source, "value").and_then(|v| v.as_str()) { return Some(text.to_string()); }
         if let Some(text) = get_node_param(source, "string").and_then(|v| v.as_str()) { return Some(text.to_string()); }
         if let Some(arr) = source.get("widgets_values").and_then(|v| v.as_array()) {
             if let Some(s) = arr.get(0).and_then(|v| v.as_str()) { return Some(s.to_string()); }
         }
    }
    None
}
