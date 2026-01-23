use std::collections::HashMap;
use serde_json::Value;
use super::graph::{get_node_type, get_node_input_link, get_node_param, is_model_loader};

pub enum WalkResult {
    Found(String),
    Continue(String),
    Stop,
}

/// Generic upstream graph walker.
/// Visits nodes starting from `start_id`.
/// - If `visitor` returns `Found(val)`, returns `Some(val)`.
/// - If `visitor` returns `Continue(next_id)`, moves to `next_id`.
/// - If `visitor` returns `Stop`, breaks and returns `None`.
#[allow(dead_code)]
pub fn walk_upstream<F>(
    nodes: &HashMap<String, Value>,
    start_id: &str,
    mut visitor: F,
    depth: usize,
) -> Option<String>
where
    F: FnMut(&Value) -> WalkResult,
{
    if depth > 100 {
        return None;
    }
    let mut current_id = start_id.to_string();
    let mut loop_safety = 0;

    while loop_safety < 50 {
        loop_safety += 1;
        if let Some(node) = nodes.get(&current_id) {
             match visitor(node) {
                 WalkResult::Found(val) => return Some(val),
                 WalkResult::Continue(next_id) => current_id = next_id,
                 WalkResult::Stop => break,
             }
        } else {
            break;
        }
    }
    None
}

/// Traces upstream from an output node (like SaveImage) to find the responsible KSampler.
pub fn find_sampler_upstream(nodes: &HashMap<String, Value>, start_id: &str) -> Option<String> {
    // We capture the current_id to return it, BUT walk_upstream manages iteration.
    // The trick here is that find_sampler_upstream returns the ID of the KSampler.
    // So if we find it, we return Found(current_node_id).
    // However, the visitor only sees &Value. It doesn't know its own ID unless we pass it or track it working?
    // Actually, `nodes` is a Map. We are looking up by ID.
    // Wait, walk_upstream abstracts the ID. 
    // `find_sampler_upstream` needs to return the ID of the node it found.
    // My generic walker returns `Option<String>`. So if I yield `Found(id)`, it returns `Some(id)`.
    // But inside the closure, I don't have the ID of `node`.
    // I might need to change `walk_upstream` to pass `(id, node)` to visitor.
    
    // let mut current_id_tracker = start_id.to_string(); // REMOVED unused
    
    // VARIATION: Let's just implement specific walker for this one or adjust generic.
    // Adjusting generic is better.
    // Adjusting generic is better.
    walk_upstream_with_id(nodes, start_id, |id, node| {
        let class_type = get_node_type(node).to_lowercase();
        if class_type.contains("ksampler") {
            return WalkResult::Found(id.to_string());
        }

        // Trace back through 'samples' or 'latent' or 'image' inputs
        if let Some(next_id) = get_node_input_link(node, "samples")
            .or_else(|| get_node_input_link(node, "latent"))
            .or_else(|| get_node_input_link(node, "image"))
            .or_else(|| get_node_input_link(node, "images"))
            .or_else(|| get_node_input_link(node, "inpainted_image")) // InpaintStitch
            .or_else(|| get_node_input_link(node, "stitch"))          // InpaintStitch
            .or_else(|| get_node_input_link(node, "image_a"))         // Image Comparer
            .or_else(|| get_node_input_link(node, "image_b"))
            .or_else(|| get_node_input_link(node, "pipe"))            // Reactor/Impact Pack 
        {
            return WalkResult::Continue(next_id);
        }
        WalkResult::Stop
    }, 0)
}

// Updated walker with ID
pub fn walk_upstream_with_id<F>(
    nodes: &HashMap<String, Value>,
    start_id: &str,
    mut visitor: F,
    depth: usize,
) -> Option<String>
where
    F: FnMut(&str, &Value) -> WalkResult,
{
    if depth > 100 {
        return None;
    }
    let mut current_id = start_id.to_string();
    let mut loop_safety = 0;

    while loop_safety < 50 {
        loop_safety += 1;
        if let Some(node) = nodes.get(&current_id) {
             match visitor(&current_id, node) {
                 WalkResult::Found(val) => return Some(val),
                 WalkResult::Continue(next_id) => current_id = next_id,
                 WalkResult::Stop => break,
             }
        } else {
            break;
        }
    }
    None
}

pub fn trace_model_source(nodes: &HashMap<String, Value>, start_id: &str) -> Option<String> {
    walk_upstream_with_id(nodes, start_id, |_id, node| {
        let class_type = get_node_type(node);

        // If it's a model source, extract and return
        if is_model_loader(class_type) {
            if let Some(name) = extract_model_from_node(nodes, node) {
                return WalkResult::Found(name);
            }
            // If it's a loader but linked dynamically
            if let Some(next_id) = get_node_input_link(node, "ckpt_name").or_else(|| get_node_input_link(node, "checkpoint")) {
                return WalkResult::Continue(next_id);
            }
        }

        // Passthrough for LoraLoader etc
        if class_type.contains("LoraLoader") || class_type.contains("LoraManager") {
            if let Some(next_id) = get_node_input_link(node, "model") {
                return WalkResult::Continue(next_id);
            }
        }

        // Generic passthrough (Switchers, Use Everywhere, etc)
        if let Some(next_id) = get_node_input_link(node, "model")
            .or_else(|| get_node_input_link(node, "unet"))
            .or_else(|| get_node_input_link(node, "diffusion_model"))
            .or_else(|| get_node_input_link(node, "clip"))
            .or_else(|| get_node_input_link(node, "vae"))
            .or_else(|| get_node_input_link(node, "anything")) // Use Everywhere
        {
            return WalkResult::Continue(next_id);
        }
        WalkResult::Stop
    }, 0)
}

pub fn trace_text_source(nodes: &HashMap<String, Value>, start_id: &str) -> Option<String> {
    walk_upstream_with_id(nodes, start_id, |_id, node| {
        let class_type = get_node_type(node);

        // 1. Standard CLIPTextEncode
        if class_type.contains("CLIPTextEncode") {
            // Try direct string
            if let Some(text) = get_node_param(node, "text").and_then(|s| s.as_str()) {
                return WalkResult::Found(text.to_string());
            }
            // Try linked text
            if let Some(next_id) = get_node_input_link(node, "text") {
                return WalkResult::Continue(next_id);
            }
        }
        
        // 2. Primitives / Simple Text
        if class_type == "PrimitiveNode" || class_type == "ShowText" || class_type == "String Literal" || 
           class_type == "StringConstantMultiline" || class_type == "String" || class_type == "Text" || 
           class_type.contains("showAnything") 
        {
             if let Some(val) = get_node_param(node, "value")
                .or_else(|| get_node_param(node, "text"))
                .or_else(|| get_node_param(node, "string"))
                .or_else(|| get_node_param(node, "String"))
                .or_else(|| get_node_param(node, "STRING")) 
                .and_then(|s| s.as_str()) 
             {
                 return WalkResult::Found(val.to_string());
             }
        }

        // 3. ImpactWildcardProcessor & Qwen / LLM Encoders
        if class_type == "ImpactWildcardProcessor" {
            if let Some(text) = get_node_param(node, "populated_text").and_then(|s| s.as_str()) {
                 return WalkResult::Found(text.to_string());
            }
        }
        
        if class_type.contains("Qwen") || class_type.contains("LLM") {
            if let Some(text) = get_node_param(node, "0").or_else(|| get_node_param(node, "text")).or_else(|| get_node_param(node, "prompt")).and_then(|s| s.as_str()) {
                return WalkResult::Found(text.to_string());
            }
        }

        // 4. JoinStringMulti (Recursively join inputs)
        if class_type == "JoinStringMulti" {
            let mut parts = Vec::new();
            // Check string_1 to string_10
            for i in 1..=10 {
                let key = format!("string_{}", i);
                if let Some(s) = get_node_param(node, &key).and_then(|v| v.as_str()) {
                    if !s.is_empty() { parts.push(s.to_string());}
                }
                else if let Some(link_id) = get_node_input_link(node, &key) {
                     if let Some(linked_text) = trace_text_source(nodes, &link_id) {
                         if !linked_text.is_empty() { parts.push(linked_text); }
                     }
                }
            }
            
            let delimiter = get_node_param(node, "delimiter").and_then(|s| s.as_str()).unwrap_or(" ");
            if !parts.is_empty() {
                return WalkResult::Found(parts.join(delimiter));
            }
        }
        
        // 5. TriggerWord Toggle (LoraManager)
         if class_type == "TriggerWord Toggle (LoraManager)" {
             if let Some(text) = get_node_param(node, "trigger_words").and_then(|s| s.as_str()) {
                 return WalkResult::Found(text.to_string());
             }
        }

        // Passthrough logic
        if let Some(next_id) = get_node_input_link(node, "conditioning")
            .or_else(|| get_node_input_link(node, "positive"))
            .or_else(|| get_node_input_link(node, "negative"))
            .or_else(|| get_node_input_link(node, "string"))
            .or_else(|| get_node_input_link(node, "anything"))
            .or_else(|| get_node_input_link(node, "everything"))
        {
            return WalkResult::Continue(next_id);
        }
        WalkResult::Stop
    }, 0)
}

// Helper to trace back a parameter value recursively (e.g. steps linked to an input node)
pub fn trace_node_param<'a>(nodes: &'a HashMap<String, Value>, node: &'a Value, key: &str, depth: usize) -> Option<&'a Value> {
    if depth > 50 { return None; }
    
    // 1. Try linked param FIRST (priority to upstream)
    if let Some(link_id) = get_node_input_link(node, key) {
        // Find the upstream node
        if let Some(upstream_node) = nodes.get(&link_id) {
            // Recursively check the same key (or specific logic for Input Parameters nodes)
            if let Some(val) = trace_node_param(nodes, upstream_node, key, depth + 1) {
                return Some(val);
            }
            // If recursive trace with same key fails, check "value" (PrimitiveNode)
            if let Some(val) = trace_node_param(nodes, upstream_node, "value", depth + 1) {
                 return Some(val);
            }
        }
    }

    // 2. Try direct param
    get_node_param(node, key)
}


/// Extracts the model filename from a node, supporting various loader types.
pub fn extract_model_from_node(nodes: &HashMap<String, Value>, node: &Value) -> Option<String> {
    // 1. Try standard fields (prefer TRACED values)
    let found = trace_node_param(nodes, node, "ckpt_name", 0)
        .or_else(|| trace_node_param(nodes, node, "checkpoint", 0))
        .or_else(|| trace_node_param(nodes, node, "unet_name", 0))
        .or_else(|| trace_node_param(nodes, node, "model_name", 0))
        .or_else(|| trace_node_param(nodes, node, "0", 0)) // Common in some UI formats
        .and_then(|v| v.as_str());

    if let Some(name) = found {
        return Some(name.replace(".safetensors", "").replace(".ckpt", "").to_string());
    }

    // 2. Liberal Fallback: Scan all string fields in this node for something ending in .safetensors
    if let Some(inputs) = node.get("inputs").and_then(|v| v.as_object()) {
        for val in inputs.values() {
            if let Some(s) = val.as_str() {
                if s.ends_with(".safetensors") || s.ends_with(".ckpt") {
                    return Some(s.replace(".safetensors", "").replace(".ckpt", "").to_string());
                }
            }
        }
    }
    
    // Check widgets as well
    if let Some(widgets) = node.get("widgets_values").and_then(|v| v.as_array()) {
        for val in widgets {
            if let Some(s) = val.as_str() {
                if s.ends_with(".safetensors") || s.ends_with(".ckpt") {
                    return Some(s.replace(".safetensors", "").replace(".ckpt", "").to_string());
                }
            }
        }
    }

    None
}
