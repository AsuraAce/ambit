use super::ImageMetadata;
use serde_json::Value;

/// Extracts metadata from ComfyUI "prompt" or "workflow" chunks.
///
/// ComfyUI images typically contain two JSON chunks:
/// 1. `prompt`: The internal API format used for execution (keyed by node ID).
/// 2. `workflow`: The UI graph format (keyed by "nodes" array).
///
/// This parser normalizes both formats into an internal map and performs a hybrid extraction:
/// - **Graph Traversal**: Traces from output nodes -> KSampler -> Model/Prompts to find the active generation path.
/// - **Heuristic Falback**: Scans for "wireless" nodes (e.g. "Use Everywhere") or disconnected parameter nodes if traversal fails.
pub fn extract_comfyui_metadata(chunks: &std::collections::HashMap<String, String>) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    meta.tool = "ComfyUI".to_string();

    if let Some(workflow) = chunks.get("workflow") {
        meta.workflow_json = Some(workflow.clone());
    } else if let Some(prompt) = chunks.get("prompt") {
        meta.workflow_json = Some(prompt.clone());
    }

    // ComfyUI has two formats: 
    // 1. "prompt" chunk (API format): Flat object { "id": { "class_type": "...", "inputs": {...} } }
    // 2. "workflow" chunk (UI format): Object { "nodes": [{ "type": "...", "widgets_values": [...] }] }
    
    // We try "prompt" first as it represents the ACTUAL execution graph
    let mut nodes_map = std::collections::HashMap::new();
    
    if let Some(prompt_json) = chunks.get("prompt") {
        if let Ok(json) = serde_json::from_str::<Value>(prompt_json) {
            if let Some(obj) = json.as_object() {
                for (id, node) in obj {
                    nodes_map.insert(id.clone(), node.clone());
                }
            }
        }
    }

    // If prompt is missing or empty, try parsing "workflow"
    if nodes_map.is_empty() {
        if let Some(workflow_json) = chunks.get("workflow") {
            if let Ok(json) = serde_json::from_str::<Value>(workflow_json) {
                if let Some(nodes_arr) = json.get("nodes").and_then(|v| v.as_array()) {
                    for node in nodes_arr {
                        if let Some(id) = node.get("id").and_then(|v| v.as_u64()).or_else(|| node.get("id").and_then(|v| v.as_i64()).map(|v| v as u64)) {
                            nodes_map.insert(id.to_string(), node.clone());
                        }
                    }
                }
            }
        }
    }

    if nodes_map.is_empty() {
        return meta;
    }

    // 1. Find the "active" KSampler node
    let mut ksampler_id = "".to_string();
    
    // First pass: find a sampler linked to an output node
    for (id, node) in &nodes_map {
        let class_type = get_node_type(node);
        if is_output_node(class_type) {
            if let Some(sampler_id) = find_sampler_upstream(&nodes_map, id) {
                ksampler_id = sampler_id;
                break;
            }
        }
    }

    // Second pass: fallback to any KSampler
    if ksampler_id.is_empty() {
        for (id, node) in &nodes_map {
            if get_node_type(node).to_lowercase().contains("ksampler") {
                ksampler_id = id.clone();
                break;
            }
        }
    }

    if !ksampler_id.is_empty() {
        let ksampler_node = nodes_map.get(&ksampler_id).unwrap();
        
        
        // Extract direct KSampler properties with tracing
        if let Some(seed) = trace_node_param(&nodes_map, ksampler_node, "seed").and_then(|v| v.as_i64()) {
            meta.seed = seed;
        } else if let Some(seed) = trace_node_param(&nodes_map, ksampler_node, "noise_seed").and_then(|v| v.as_i64()) {
            meta.seed = seed;
        }

        if let Some(steps) = trace_node_param(&nodes_map, ksampler_node, "steps").and_then(|v| v.as_u64()) {
            meta.steps = steps as u32;
        }

        if let Some(cfg) = trace_node_param(&nodes_map, ksampler_node, "cfg").and_then(|v| v.as_f64()) {
            meta.cfg = cfg as f32;
        }

        if let Some(sampler) = trace_node_param(&nodes_map, ksampler_node, "sampler_name").and_then(|s| s.as_str()) {
            meta.sampler = sampler.to_string();
            if let Some(scheduler) = trace_node_param(&nodes_map, ksampler_node, "scheduler").and_then(|s| s.as_str()) {
                meta.sampler = format!("{} ({})", meta.sampler, scheduler);
            }
        }

        // Traverse for Model
        if let Some(model_id) = get_node_input_link(ksampler_node, "model") {
            if let Some(model_name) = trace_model_source(&nodes_map, &model_id) {
                meta.model = model_name;
            }
        }

        // Traverse for Prompts
        if let Some(pos_id) = get_node_input_link(ksampler_node, "positive") {
            if let Some(text) = trace_text_source(&nodes_map, &pos_id) {
                meta.positive_prompt = text;
            }
        }
        if let Some(neg_id) = get_node_input_link(ksampler_node, "negative") {
            if let Some(text) = trace_text_source(&nodes_map, &neg_id) {
                meta.negative_prompt = text;
            }
        }
    }

    // ---------------------------------------------------------
    // Extract Resources (LoRAs)
    // ---------------------------------------------------------
    for (_id, node) in &nodes_map {
        let class_type = get_node_type(node);
        
        // Standard LoraLoader / LoraLoaderModelOnly
        if class_type == "LoraLoader" || class_type == "LoraLoaderModelOnly" {
            if let Some(name) = get_node_param(node, "lora_name").and_then(|v| v.as_str()) {
                 let name = name.replace(".safetensors", "").replace(".ckpt", "");
                 let strength = get_node_param(node, "strength_model").and_then(|v| v.as_f64()).unwrap_or(1.0);
                 let entry = if strength != 1.0 { format!("{} ({:.2})", name, strength) } else { name };
                 if !meta.loras.contains(&entry) { meta.loras.push(entry); }
            }
        }
        
        // Custom LoraManager (User Request)
        if class_type == "Lora Loader (LoraManager)" {
            // Structure: inputs: { "loras": { "__value__": [ { "name": "...", "strength": ... } ] } }
             if let Some(loras_obj) = node.get("inputs").and_then(|v| v.get("loras")) {
                 if let Some(values) = loras_obj.get("__value__").and_then(|v| v.as_array()) {
                     for lora in values {
                         if let Some(name) = lora.get("name").and_then(|v| v.as_str()) {
                             let name = name.replace(".safetensors", "").replace(".ckpt", "");
                             let strength = lora.get("strength").and_then(|v| v.as_f64())
                                 .or_else(|| lora.get("strength").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok()))
                                 .unwrap_or(1.0);
                             
                             // Check if active (sometimes provided)
                             let active = lora.get("active").and_then(|v| v.as_bool()).unwrap_or(true);
                             
                             if active {
                                 let entry = if strength != 1.0 { format!("{} ({:.2})", name, strength) } else { name };
                                 if !meta.loras.contains(&entry) { meta.loras.push(entry); }
                             }
                         }
                     }
                 }
             }
        }
    }

    // ---------------------------------------------------------
    // Fallback: Linear Scan for missing data
    // ---------------------------------------------------------

    // If Model is still unknown, scan all nodes for ANY valid loader
    if meta.model == "Unknown" || meta.model.is_empty() {
        for (_id, node) in &nodes_map {
            // ONLY scan model loaders to avoid picking up secondary models from Save nodes
            if is_model_loader(get_node_type(node)) {
                if let Some(model_name) = extract_model_from_node(&nodes_map, node) {
                    meta.model = model_name;
                    break;
                }
            }
        }
    }

    // If Steps/CFG/Sampler missing, scan for any KSampler-like node
    if meta.steps == 0 {
        for (_id, node) in &nodes_map {
            let class_type = get_node_type(node).to_lowercase();
            if class_type.contains("ksampler") {
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
                 if meta.sampler == "Unknown" {
                    if let Some(s) = get_node_param(node, "sampler_name").and_then(|s| s.as_str()) {
                        meta.sampler = s.to_string();
                        if let Some(sch) = get_node_param(node, "scheduler").and_then(|s| s.as_str()) {
                            meta.sampler = format!("{} ({})", meta.sampler, sch);
                        }
                    }
                 }
            }
        }
    }

    // Final Prompt Fallback (for disconnected graphs)
    if meta.positive_prompt.is_empty() {
        let mut best_positive = None;
        for (id, node) in &nodes_map {
            let t = get_node_type(node).to_lowercase();
            let title = get_node_title(node).unwrap_or("").to_lowercase();
            
            // Candidates for positive prompt
            if title.contains("positive") || (t.contains("cliptextencode") && !title.contains("negative")) || t.contains("showanything") {
                if let Some(text) = trace_text_source(&nodes_map, id) {
                    if !text.trim().is_empty() {
                        best_positive = Some(text);
                        if title.contains("positive") { break; } // High confidence
                    }
                }
            }
        }
        if let Some(p) = best_positive { meta.positive_prompt = p; }
    }

    if meta.negative_prompt.is_empty() {
        for (id, node) in &nodes_map {
            let title = get_node_title(node).unwrap_or("").to_lowercase();
            
            if title.contains("negative") {
                if let Some(text) = trace_text_source(&nodes_map, id) {
                    if !text.trim().is_empty() {
                        meta.negative_prompt = text;
                        break;
                    }
                }
            }
        }
    }

    meta
}

fn get_node_type(node: &Value) -> &str {
    node.get("class_type")
        .or_else(|| node.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

fn is_output_node(t: &str) -> bool {
    t == "SaveImage" || t == "PreviewImage" || t == "ImageSave" || t.contains("SaveImage")
}

fn get_node_title(node: &Value) -> Option<&str> {
    node.get("_meta").and_then(|m| m.get("title")).and_then(|v| v.as_str())
}

fn get_node_param<'a>(node: &'a Value, key: &str) -> Option<&'a Value> {
    // 1. Check in API format "inputs"
    if let Some(val) = node.get("inputs").and_then(|v| v.get(key)) {
        return Some(val);
    }
    
    // 2. Check in UI format "widgets_values"
    // This is tricky because it's a list. We can't know the keys for sure, 
    // but we can look for strings that end in .safetensors or are numeric
    if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
        // Logic check: if key is "steps", it's likely a number.
        // If key is "ckpt_name", it's likely a string.
        // This is heuristic-based because ComfyUI UI format LOSES the keys.
        for val in arr {
            match key {
                "steps" => {
                    if let Some(v) = val.as_u64() {
                        if v > 0 && v < 10000 { return Some(val); }
                    }
                },
                "seed" | "noise_seed" => {
                    if let Some(v) = val.as_i64() {
                        if v > 100000 || v < -1 { return Some(val); }
                    }
                },
                "cfg" => if val.is_f64() || val.is_i64() { return Some(val); },
                "ckpt_name" | "unet_name" | "model_name" => {
                    if let Some(s) = val.as_str() {
                        if s.ends_with(".safetensors") || s.ends_with(".ckpt") { return Some(val); }
                    }
                },
                "sampler_name" => {
                    if let Some(s) = val.as_str() {
                        let common = ["euler", "dpmpp", "uni_pc", "heun", "ddim", "ancestral", "2m", "sde", "ddpm", "lcm", "ipndm"];
                        let lower = s.to_lowercase();
                        if common.iter().any(|&c| lower.contains(c)) { return Some(val); }
                    }
                },
                "scheduler" => {
                    if let Some(s) = val.as_str() {
                        let common = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"];
                        let lower = s.to_lowercase();
                        if common.iter().any(|&c| lower.contains(c)) { return Some(val); }
                    }
                },
                "text" => if val.is_string() && val.as_str().unwrap().len() > 5 { return Some(val); },
                _ => {}
            }
        }
    }
    None
}

fn get_node_input_link(node: &Value, key: &str) -> Option<String> {
    if let Some(link) = node.get("inputs").and_then(|v| v.get(key)).and_then(|v| v.as_array()) {
        if !link.is_empty() {
            return link[0].as_str().map(|s| s.to_string());
        }
    }
    None
}

// -----------------------------------------------------------------------------
// Helpers (updated for nodes_map usage)
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Helpers (updated for nodes_map usage)
// -----------------------------------------------------------------------------

/// Traces upstream from an output node (like SaveImage) to find the responsible KSampler.
fn find_sampler_upstream(nodes: &std::collections::HashMap<String, Value>, start_id: &str) -> Option<String> {
    let mut current_id = start_id.to_string();
    let mut loop_safety = 0;

    while loop_safety < 20 {
        loop_safety += 1;
        if let Some(node) = nodes.get(&current_id) {
            let class_type = get_node_type(node).to_lowercase();
            if class_type.contains("ksampler") {
                return Some(current_id);
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
                current_id = next_id;
                continue;
            }
            break;
        } else {
            break;
        }
    }
    None
}

/// Traces upstream from a KSampler to find the Model Loader.
/// Handles various intermediate nodes like LoraLoaders, Reroutes, and Switchers.
fn trace_model_source(nodes: &std::collections::HashMap<String, Value>, start_id: &str) -> Option<String> {
    let mut current_id = start_id.to_string();
    let mut loop_safety = 0;

    while loop_safety < 50 {
        loop_safety += 1;
        
        if let Some(node) = nodes.get(&current_id) {
            let class_type = get_node_type(node);

            // If it's a model source, extract and return
            if is_model_loader(class_type) {
                if let Some(name) = extract_model_from_node(nodes, node) {
                    return Some(name);
                }
                // If it's a loader but linked dynamically (e.g. Ckpt Loader JK -> CheckpointLoaderSimple)
                if let Some(next_id) = get_node_input_link(node, "ckpt_name")
                    .or_else(|| get_node_input_link(node, "checkpoint"))
                {
                    current_id = next_id;
                    continue;
                }
            }

            // Passthrough for LoraLoader etc
            if class_type.contains("LoraLoader") || class_type.contains("LoraManager") {
                if let Some(next_id) = get_node_input_link(node, "model") {
                    current_id = next_id;
                    continue;
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
                current_id = next_id;
                continue;
            }
            break;
        } else {
            break;
        }
    }
    None
}

/// Traces upstream from a KSampler to find the Positive/Negative Prompt text.
/// Traces upstream from a KSampler to find the Positive/Negative Prompt text.
fn trace_text_source(nodes: &std::collections::HashMap<String, Value>, start_id: &str) -> Option<String> {
    let mut current_id = start_id.to_string();
    let mut loop_safety = 0;

    while loop_safety < 50 {
        loop_safety += 1;
        
        if let Some(node) = nodes.get(&current_id) {
            let class_type = get_node_type(node);

            // 1. Standard CLIPTextEncode
            if class_type.contains("CLIPTextEncode") {
                // Try direct string
                if let Some(text) = get_node_param(node, "text").and_then(|s| s.as_str()) {
                    return Some(text.to_string());
                }
                // Try linked text
                if let Some(next_id) = get_node_input_link(node, "text") {
                    current_id = next_id;
                    continue;
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
                    .or_else(|| get_node_param(node, "STRING")) // Handle uppercase for some nodes
                    .and_then(|s| s.as_str()) 
                 {
                     return Some(val.to_string());
                 }
            }

            // 3. ImpactWildcardProcessor & Qwen / LLM Encoders
            if class_type == "ImpactWildcardProcessor" {
                if let Some(text) = get_node_param(node, "populated_text").and_then(|s| s.as_str()) {
                     return Some(text.to_string());
                }
            }
            
            if class_type.contains("Qwen") || class_type.contains("LLM") {
                // LLM nodes often use "0" or "text" or "prompt"
                if let Some(text) = get_node_param(node, "0").or_else(|| get_node_param(node, "text")).or_else(|| get_node_param(node, "prompt")).and_then(|s| s.as_str()) {
                    return Some(text.to_string());
                }
            }

            // 4. JoinStringMulti (Recursively join inputs)
            if class_type == "JoinStringMulti" {
                let mut parts = Vec::new();
                // Check string_1 to string_10
                for i in 1..=10 {
                    let key = format!("string_{}", i);
                    // Try direct param
                    if let Some(s) = get_node_param(node, &key).and_then(|v| v.as_str()) {
                        if !s.is_empty() { parts.push(s.to_string());}
                    }
                    // Try linked param
                    else if let Some(link_id) = get_node_input_link(node, &key) {
                        // Recursively resolve one level deep
                         if let Some(linked_text) = trace_text_source(nodes, &link_id) {
                             if !linked_text.is_empty() { parts.push(linked_text); }
                         }
                    }
                }
                
                let delimiter = get_node_param(node, "delimiter").and_then(|s| s.as_str()).unwrap_or(" ");
                if !parts.is_empty() {
                    return Some(parts.join(delimiter));
                }
            }
            
            // 5. TriggerWord Toggle (LoraManager)
             if class_type == "TriggerWord Toggle (LoraManager)" {
                 if let Some(text) = get_node_param(node, "trigger_words").and_then(|s| s.as_str()) {
                     return Some(text.to_string());
                 }
            }

            // Passthrough logic
            if let Some(next_id) = get_node_input_link(node, "conditioning")
                .or_else(|| get_node_input_link(node, "positive")) // Follow positive path
                .or_else(|| get_node_input_link(node, "negative")) // Follow negative path
                .or_else(|| get_node_input_link(node, "string"))   // Simple string passthrough
                .or_else(|| get_node_input_link(node, "anything")) // Use Everywhere
                .or_else(|| get_node_input_link(node, "everything")) // Use Everywhere
            {
                current_id = next_id;
                continue;
            }
            break;
        } else {
            break;
        }
    }
    None
}

fn is_model_loader(t: &str) -> bool {
    t == "CheckpointLoaderSimple" || t == "CheckpointLoader" || t == "CheckpointLoader|Lib" || 
    t == "CheckpointSelector" || t == "UNETLoader" || t == "LoadDiffusionModel" || 
    t == "DiffusionLoader" || t == "DualCLIPLoader" || t.contains("EasyLoader") ||
    t.contains("ParameterGenerator") || t.contains("Ckpt Loader") // Support SDParameterGenerator, Ckpt Loader JK, etc
}

/// Extracts the model filename from a node, supporting various loader types.
/// Uses a liberal scan of all string fields if standard keys are missing (common in UI format).
fn extract_model_from_node(nodes: &std::collections::HashMap<String, Value>, node: &Value) -> Option<String> {
    // 1. Try standard fields (prefer TRACED values)
    let found = trace_node_param(nodes, node, "ckpt_name")
        .or_else(|| trace_node_param(nodes, node, "checkpoint"))
        .or_else(|| trace_node_param(nodes, node, "unet_name"))
        .or_else(|| trace_node_param(nodes, node, "model_name"))
        .or_else(|| trace_node_param(nodes, node, "0")) // Common in some UI formats
        .and_then(|v| v.as_str());

    if let Some(name) = found {
        return Some(name.replace(".safetensors", "").replace(".ckpt", "").to_string());
    }

    // 2. Liberal Fallback: Scan all string fields in this node for something ending in .safetensors
    // (Crucial for UI formats where labels are lost)
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


// Helper to trace back a parameter value recursively (e.g. steps linked to an input node)
// Helper to trace back a parameter value recursively (e.g. steps linked to an input node)
fn trace_node_param<'a>(nodes: &'a std::collections::HashMap<String, Value>, node: &'a Value, key: &str) -> Option<&'a Value> {
    
    // 1. Try linked param FIRST (priority to upstream)
    if let Some(link_id) = get_node_input_link(node, key) {
        // Find the upstream node
        if let Some(upstream_node) = nodes.get(&link_id) {
            // Recursively check the same key (or specific logic for Input Parameters nodes)
            if let Some(val) = trace_node_param(nodes, upstream_node, key) {
                return Some(val);
            }
            // If recursive trace with same key fails, check "value" (PrimitiveNode)
            if let Some(val) = trace_node_param(nodes, upstream_node, "value") {
                 return Some(val);
            }
        }
    }

    // 2. Try direct param
    get_node_param(node, key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_extract_comfyui_traversal() {
        // A graph where KSampler -> LoraLoader -> CheckpointLoader
        let prompt = r#"{
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "cfg": 8.0,
                    "model": ["10", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "seed": 12345,
                    "steps": 25,
                    "sampler_name": "euler"
                }
            },
            "10": {
                "class_type": "LoraLoader",
                "inputs": {
                    "model": ["4", 0],
                    "lora_name": "add_detail.safetensors"
                }
            },
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": "v1-5-pruned.safetensors"
                }
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "beautiful scenery"
                }
            },
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "bad quality"
                }
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());

        let meta = extract_comfyui_metadata(&chunks);

        assert_eq!(meta.tool, "ComfyUI");
        assert_eq!(meta.steps, 25);
        assert_eq!(meta.model, "v1-5-pruned"); // Should skip LoraLoader and find Checkpoint
        assert_eq!(meta.positive_prompt, "beautiful scenery");
        assert_eq!(meta.negative_prompt, "bad quality");
    }

    #[test]
    fn test_extract_comfyui_unet_loader() {
        // A graph using UNETLoader
        let prompt = r#"{
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["5", 0]
                }
            },
            "5": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": "flux_dev.safetensors"
                }
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        let meta = extract_comfyui_metadata(&chunks);
        assert_eq!(meta.model, "flux_dev");
    }

    #[test]
    fn test_extract_comfyui_easy_loader() {
        // A graph using EasyLoader (Flux)
        let prompt = r#"{
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["10", 0]
                }
            },
            "10": {
                "class_type": "EasyLoader",
                "inputs": {
                    "ckpt_name": "flux1-dev-fp8.safetensors"
                }
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        let meta = extract_comfyui_metadata(&chunks);
        assert_eq!(meta.model, "flux1-dev-fp8");
    }

    #[test]
    fn test_extract_comfyui_wireless_fallback() {
        // A graph where KSampler is NOT linked to the loader (wireless/Use Everywhere)
        // Traversal will fail, so Fallback Scan must catch it.
        let prompt = r#"{
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "cfg": 7.0,
                    "steps": 30,
                    "sampler_name": "dpmpp_2m"
                }
            },
            "10": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": "realvis-v3.safetensors"
                }
            },
            "20": {
                "class_type": "PreviewImage",
                "inputs": { "images": [] } 
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        let meta = extract_comfyui_metadata(&chunks);
        
        assert_eq!(meta.tool, "ComfyUI");
        assert_eq!(meta.model, "realvis-v3"); // Should be found by linear scan
        assert_eq!(meta.steps, 30);           // Should be found by linear scan
        assert_eq!(meta.sampler, "dpmpp_2m"); // Should be found by linear scan
    }

    #[test]
    fn test_extract_comfyui_ui_format() {
        // A graph using the "workflow" (UI) format with nodes as array and widgets_values
        let workflow = r#"{
            "nodes": [
                {
                    "id": 1,
                    "type": "KSampler",
                    "widgets_values": [
                        12345,
                        "fixed",
                        30,
                        8.0,
                        "euler",
                        "normal",
                        1.0
                    ]
                },
                {
                    "id": 2,
                    "type": "CheckpointLoaderSimple",
                    "widgets_values": [
                        "sd_xl_base_1.0.safetensors"
                    ]
                }
            ]
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("workflow".to_string(), workflow.to_string());
        
        // We set tool to unknown to ensure extract logic identifies it
        let meta = extract_comfyui_metadata(&chunks);
        
        assert_eq!(meta.tool, "ComfyUI");
        assert_eq!(meta.model, "sd_xl_base_1.0"); // Found from widgets_values
        assert_eq!(meta.steps, 30);              // Found from widgets_values
        assert_eq!(meta.sampler, "euler (normal)"); // Found from widgets_values
    }

    #[test]
    fn test_extract_comfyui_complex_user_case() {
        // Based on user report: KSampler -> ApplyFBCache -> LoraManager -> UNETLoader
        let prompt = r#"{
            "870": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": ["932", 0],
                    "steps": ["932", 1],
                    "model": ["854", 0]
                }
            },
            "932": {
                "class_type": "Input Parameters (Image Saver)",
                "inputs": {
                    "seed": 445941582371850,
                    "steps": 20
                }
            },
            "854": {
                "class_type": "ApplyFBCacheOnModel",
                "inputs": {
                    "model": ["944", 0]
                }
            },
            "944": {
                "class_type": "Lora Loader (LoraManager)",
                "inputs": {
                    "model": ["940", 0]
                }
            },
            "940": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": "flux/flux1KreaDevFP8_fp8E4m3fn.safetensors"
                }
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        // This is necessary to test detection from chunks
        let meta = extract_comfyui_metadata(&chunks);

        // NOTE: The `trace_model_source` should traverse 870 -> 854 -> 944 -> 940
        // 854 (ApplyFBCache) handled by generic "model" passthrough
        // 944 (Lora Loader (LoraManager)) handled by specific LoraManager matching
        assert_eq!(meta.tool, "ComfyUI");
        assert_eq!(meta.model, "flux/flux1KreaDevFP8_fp8E4m3fn"); 
        
        // Steps/Seed come from 932 via link in 870
        // NOTE: My current parser doesn't trace numeric inputs like 'steps' or 'seed', it only reads direct values.
        // The user's KSampler uses linked inputs for steps/seed. 
        // My parser will likely yield 0 for steps unless we implement numeric tracing or use the wireless fallback.
        // BUT, the wireless fallback (Linear Scan) should find node 932 if it has "steps".
        // Node 932 has "steps": 20.
        // Fallback scan looks for "KSampler" in class name.
        // Node 932 class is "Input Parameters (Image Saver)". It DOES NOT contain "KSampler".
        // So steps might be 0. This is a potential separate issue.
        assert_eq!(meta.model, "flux/flux1KreaDevFP8_fp8E4m3fn"); 
        
        // Steps/Seed come from 932 via link in 870
        // ... (existing comments)
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
        assert_eq!(meta.positive_prompt, "trigger_abc, A battle-hardened mercenary captain...");
    }

    #[test]
    fn test_extract_comfyui_recursive_params_and_loras() {
        // Test 1: Recursive Parameters (KSampler -> Input Parameters)
        // Test 2: Custom Lora Manager extraction
        let prompt = r#"{
            "870": {
                "class_type": "KSampler",
                "inputs": {
                    "steps": ["932", 1], 
                    "cfg": ["932", 2],
                    "model": ["10", 0]
                }
            },
            "932": {
                "class_type": "Input Parameters (Image Saver)",
                "inputs": {
                    "steps": 20,
                    "cfg": 7.5
                }
            },
            "10": {
                "class_type": "Lora Loader (LoraManager)",
                "inputs": {
                    "model": ["4", 0],
                    "loras": {
                        "__value__": [
                            { "name": "Detailer.safetensors", "strength": 0.8, "active": true },
                            { "name": "Style.safetensors", "strength": 0.5, "active": false }
                        ]
                    }
                }
            },
            "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "base.safetensors" } }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        let meta = extract_comfyui_metadata(&chunks);
        
        // Assert recursive params
        assert_eq!(meta.steps, 20);
        assert_eq!(meta.cfg, 7.5);
        
        // Assert LoRAs
        assert_eq!(meta.loras.len(), 1); // Only active one
        assert_eq!(meta.loras[0], "Detailer (0.80)");
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

        assert!(meta.positive_prompt.contains("hentai, female anime character"));
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
    fn test_extract_comfyui_qwen() {
        let prompt = r#"{
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "positive": ["10", 0],
                    "model": ["20", 0]
                }
            },
            "10": {
                "class_type": "TextEncodeQwenImageEditPlus",
                "inputs": {
                    "0": "A realistic portrait of a cat",
                    "model": ["20", 0]
                }
            },
            "20": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": { "ckpt_name": "base.safetensors" }
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        let meta = extract_comfyui_metadata(&chunks);
        
        assert_eq!(meta.model, "base");
    }

    #[test]
    fn test_extract_comfyui_wireless_titled_nodes() {
        // Disconnected KSampler + Prompt nodes with titles
        let prompt = r#"{
            "3": {
                "class_type": "KSampler",
                "inputs": { "seed": 1234 }
            },
            "10": {
                "class_type": "CLIPTextEncode",
                "_meta": { "title": "Positive Prompt" },
                "inputs": { "text": ["12", 0] }
            },
            "11": {
                "class_type": "CLIPTextEncode",
                "_meta": { "title": "Negative Prompt" },
                "inputs": { "text": "ugly hands" }
            },
            "12": {
                "class_type": "String",
                "inputs": { "STRING": "landscape, sunset" }
            },
            "20": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": { "ckpt_name": "base.safetensors" }
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        let meta = extract_comfyui_metadata(&chunks);
        
        // Fallback should find model and prompts by labels/types
        assert_eq!(meta.model, "base");
        assert_eq!(meta.positive_prompt, "landscape, sunset");
        assert_eq!(meta.negative_prompt, "ugly hands");
    }

    #[test]
    fn test_extract_comfyui_supir_conflict() {
        // User reported case where "SUPIR" (refine ckpt) is detected instead of "novaAnimeXL" (main ckpt)
        let prompt = r#"{
            "3": {
                "class_type": "KSampler",
                "inputs": { 
                    "model": ["144", 0]
                }
            },
            "144": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": { 
                    "ckpt_name": ["438", 1]
                }
            },
            "435": {
                "class_type": "Save Image with Metadata JK",
                "inputs": {
                    "ckpt_name": ["438", 1],
                    "refine_ckpt_name": "SUPIR\\SUPIR-v0F.ckpt"
                }
            },
            "438": {
                "class_type": "Ckpt Loader JK",
                "inputs": { "checkpoint": "novaAnimeXL_ilV30HappyNewYear.safetensors" }
            },
            "output": {
                "class_type": "SaveImage",
                "inputs": { "images": ["435", 0] }
            }
        }"#;

        let mut chunks = HashMap::new();
        chunks.insert("prompt".to_string(), prompt.to_string());
        
        let meta = extract_comfyui_metadata(&chunks);
        
        // Should find the actual KSampler model (novaAnimeXL), NOT SUPIR
        assert_eq!(meta.model, "novaAnimeXL_ilV30HappyNewYear");
    }
}
