use super::graph::{ComfyGraph, get_node_type, get_node_param, get_node_title};
use super::conditioning::evaluate_string_node;
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
        let t_lower = t.to_lowercase();
        
        // Skip routing nodes
        if t_lower == "setnode" || t_lower == "getnode" || t_lower == "reroute" || t_lower == "node reroute" {
            continue;
        }

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
            let t_lower = t.to_lowercase();
            if title_lower.contains("positive") || (t_lower.contains("cliptextencode") && !title_lower.contains("negative")) || t_lower.contains("showanything") {
                if let Some(text) = evaluate_string_node(graph, id, 0) {
                    meta.positive_prompt = text;
                    found = true;
                }
            } else if title_lower.contains("negative") {
                if let Some(text) = evaluate_string_node(graph, id, 0) {
                    meta.negative_prompt = text;
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
    for (id, node) in graph.nodes() {
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
        let t_lower = t.to_lowercase();
        
        let mut is_negative = false;
        if let Some(title) = get_node_title(node) {
            if title.to_lowercase().contains("negative") { is_negative = true; }
        }

        if t_lower == "string" || t_lower == "primitivenode" || t_lower == "showtext" || t_lower == "note" || t_lower.contains("cliptextencode") {
             if is_negative {
                 if meta.negative_prompt.trim().is_empty() {
                     if let Some(text) = evaluate_string_node(graph, id, 0) {
                         if text.trim().len() > 2 { meta.negative_prompt = text; }
                     }
                 }
             } else {
                 if meta.positive_prompt.trim().is_empty() {
                     if let Some(text) = evaluate_string_node(graph, id, 0) {
                         if text.trim().len() > 2 { meta.positive_prompt = text; }
                     }
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


