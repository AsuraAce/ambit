use std::collections::HashMap;
use serde_json::Value;

/// Normalizes ComfyUI metadata into a graph representation.
pub struct ComfyGraph {
    pub(crate) nodes: HashMap<String, Value>,
}

impl ComfyGraph {
    pub fn from_chunks(chunks: &HashMap<String, String>) -> Self {
        let mut nodes_map = HashMap::new();

        // 1. Try "prompt" chunk (API format)
        if let Some(prompt_json) = chunks.get("prompt") {
            // ComfyUI metadata occasionally contains NaN or Infinity which is invalid JSON.
            // We sanitize these to null to allow parsing.
            let sanitized = if prompt_json.contains("NaN") || prompt_json.contains("Infinity") {
                let re = regex::Regex::new(r":\s*(NaN|Infinity|-Infinity)\b").unwrap();
                re.replace_all(prompt_json, ": null").to_string()
            } else {
                prompt_json.clone()
            };

            if let Ok(json) = serde_json::from_str::<Value>(&sanitized) {
                if let Some(obj) = json.as_object() {
                    for (id, node) in obj {
                        nodes_map.insert(id.clone(), node.clone());
                    }
                }
            }
        }

        // 2. Fallback to "workflow" chunk (UI format) if prompt failed or is empty
        if nodes_map.is_empty() {
             if let Some(workflow_json) = chunks.get("workflow") {
                if let Ok(json) = serde_json::from_str::<Value>(workflow_json) {
                    // Build Link Map: Link ID -> Source Node ID
                    let mut link_source_map = HashMap::new();
                    if let Some(links) = json.get("links").and_then(|v| v.as_array()) {
                        for link in links {
                            if let Some(arr) = link.as_array() {
                                // Format: [id, source_id, source_slot, target_id, target_slot, type]
                                if arr.len() >= 2 {
                                    if let (Some(link_id), Some(source_id)) = (arr[0].as_i64(), arr[1].as_i64()) {
                                        link_source_map.insert(link_id, source_id);
                                    }
                                }
                            }
                        }
                    }

                    // Process Nodes
                    if let Some(nodes_arr) = json.get("nodes").and_then(|v| v.as_array()) {
                        for node in nodes_arr {
                            if let Some(id) = node.get("id").and_then(|v| v.as_u64()).or_else(|| node.get("id").and_then(|v| v.as_i64()).map(|v| v as u64)) {
                                let mut node_obj = node.clone();
                                
                                // Pre-resolve inputs: Look for links in "inputs" array and resolve to source node IDs
                                if let Some(inputs) = node.get("inputs").and_then(|v| v.as_array()) {
                                    if let Some(obj) = node_obj.as_object_mut() {
                                        let mut resolved = serde_json::Map::new();
                                        for input in inputs {
                                            if let Some(name) = input.get("name").and_then(|v| v.as_str()) {
                                                if let Some(link_id) = input.get("link").and_then(|v| v.as_i64()) {
                                                    if let Some(source_node_id) = link_source_map.get(&link_id) {
                                                        // Store as string to match standard API format behavior
                                                        resolved.insert(name.to_string(), Value::String(source_node_id.to_string()));
                                                    }
                                                }
                                            }
                                        }
                                        obj.insert("_resolved_inputs".to_string(), Value::Object(resolved));
                                    }
                                }
                                
                                nodes_map.insert(id.to_string(), node_obj);
                            }
                        }
                    }
                }
            }
        }

        Self { nodes: nodes_map }
    }

    #[allow(dead_code)]
    pub fn get_node(&self, id: &str) -> Option<&Value> {
        self.nodes.get(id)
    }

    #[allow(dead_code)]
    pub fn nodes(&self) -> &HashMap<String, Value> {
        &self.nodes
    }
}

// Helpers
pub fn get_node_input_link(node: &Value, key: &str) -> Option<String> {
    // 0. Check pre-resolved check inputs
    if let Some(id) = node.get("_resolved_inputs").and_then(|m| m.get(key)).and_then(|v| v.as_str()) {
        return Some(id.to_string());
    }

    if let Some(link) = node.get("inputs").and_then(|v| v.get(key)).and_then(|v| v.as_array()) {
        if !link.is_empty() {
             // Handle both string IDs ("123") and numeric IDs (123)
            if let Some(s) = link[0].as_str() {
                return Some(s.to_string());
            }
            if let Some(n) = link[0].as_i64() {
                return Some(n.to_string());
            }
            if let Some(n) = link[0].as_u64() {
                return Some(n.to_string());
            }
        }
    }
    None
}

pub fn get_node_type(node: &Value) -> &str {
    node.get("class_type")
        .or_else(|| node.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

pub fn is_output_node(t: &str) -> bool {
    t == "SaveImage" || t == "PreviewImage" || t == "ImageSave" || t.contains("SaveImage")
}

pub fn get_node_title(node: &Value) -> Option<&str> {
    node.get("_meta").and_then(|m| m.get("title"))
        .or_else(|| node.get("title"))
        .and_then(|v| v.as_str())
}

pub fn is_model_loader(t: &str) -> bool {
    t == "CheckpointLoaderSimple" || t == "CheckpointLoader" || t == "CheckpointLoader|Lib" || 
    t == "CheckpointSelector" || t == "UNETLoader" || t == "LoadDiffusionModel" || 
    t == "DiffusionLoader" || t == "DualCLIPLoader" || t.contains("EasyLoader") ||
    t.contains("ParameterGenerator") || t.contains("Ckpt Loader") // Support SDParameterGenerator, Ckpt Loader JK, etc
}

pub fn get_node_param<'a>(node: &'a Value, key: &str) -> Option<&'a Value> {
    // 1. Check in API format "inputs"
    if let Some(val) = node.get("inputs").and_then(|v| v.get(key)) {
        return Some(val);
    }
    
    // 2. Check in UI format "widgets_values"
    if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
        let t = get_node_type(node);
        
        // Specialized mapping for common complex nodes
        if t == "SDParameterGenerator" {
            match key {
                "seed" => return arr.get(4),
                "steps" => return arr.get(5),
                "cfg" => return arr.get(7),
                "sampler_name" => return arr.get(8),
                "scheduler" => return arr.get(9),
                "ckpt_name" => return arr.get(0),
                _ => {}
            }
        }

        // Heuristic mapping for UI format
        for val in arr {
            match key {
                "steps" => {
                    if let Some(v) = val.as_u64() {
                        if v > 0 && v < 200 { return Some(val); } // Lowered limit for steps to avoid seed conflict
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
                        // Fallback
                        let exclusions = ["fixed", "increment", "decrement", "random"];
                        if !s.contains(" ") && s.len() < 20 && !exclusions.contains(&lower.as_str()) { return Some(val); }
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
