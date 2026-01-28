use serde_json::Value;
use std::collections::HashMap;

/// Normalizes ComfyUI metadata into a graph representation.
pub struct ComfyGraph {
    pub(crate) nodes: HashMap<String, Value>,
}

impl ComfyGraph {
    pub fn from_chunks(chunks: &HashMap<String, String>) -> Self {
        let mut nodes_map = HashMap::new();

        // 1. Try "prompt" chunk (API format)
        if let Some(prompt_json) = chunks.get("prompt") {
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

        // 2. Fallback to "workflow" chunk (UI format)
        if nodes_map.is_empty() {
            if let Some(workflow_json) = chunks.get("workflow") {
                if let Ok(json) = serde_json::from_str::<Value>(workflow_json) {
                    // Link Map: Link ID -> (Source Node ID, Type)
                    let mut link_source_map = HashMap::new();
                    if let Some(links) = json.get("links").and_then(|v| v.as_array()) {
                        for link in links {
                            if let Some(arr) = link.as_array() {
                                if arr.len() >= 2 {
                                    if let (Some(link_id), Some(source_id)) =
                                        (arr[0].as_i64(), arr[1].as_i64())
                                    {
                                        let link_type = if arr.len() > 5 {
                                            arr[5].as_str().unwrap_or("*").to_string()
                                        } else {
                                            "*".to_string()
                                        };
                                        link_source_map
                                            .insert(link_id, (source_id.to_string(), link_type));
                                    }
                                }
                            }
                        }
                    }

                    // Pre-pass: Find SetNode variables (Name -> Source Node ID, Type)
                    let mut var_map = HashMap::new();
                    if let Some(nodes_arr) = json.get("nodes").and_then(|v| v.as_array()) {
                        for node in nodes_arr {
                            if let Some(t) = node.get("type").and_then(|v| v.as_str()) {
                                if t == "SetNode" {
                                    if let Some(var_name) = node
                                        .get("widgets_values")
                                        .and_then(|v| v.get(0))
                                        .and_then(|v| v.as_str())
                                    {
                                        // Link is in inputs[0] usually
                                        if let Some(inputs) =
                                            node.get("inputs").and_then(|v| v.as_array())
                                        {
                                            for input in inputs {
                                                if let Some(link_id) =
                                                    input.get("link").and_then(|v| v.as_i64())
                                                {
                                                    if let Some((source_id, link_type)) =
                                                        link_source_map.get(&link_id)
                                                    {
                                                        var_map.insert(
                                                            var_name.to_string(),
                                                            (source_id.clone(), link_type.clone()),
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Process Nodes
                    if let Some(nodes_arr) = json.get("nodes").and_then(|v| v.as_array()) {
                        for node in nodes_arr {
                            if let Some(id) =
                                node.get("id").and_then(|v| v.as_u64()).or_else(|| {
                                    node.get("id").and_then(|v| v.as_i64()).map(|v| v as u64)
                                })
                            {
                                let mut node_obj = node.clone();
                                let t = node.get("type").and_then(|v| v.as_str()).unwrap_or("");

                                let mut resolved = serde_json::Map::new();

                                // Resolve Links
                                if let Some(inputs) = node.get("inputs").and_then(|v| v.as_array())
                                {
                                    for input in inputs {
                                        if let Some(name) =
                                            input.get("name").and_then(|v| v.as_str())
                                        {
                                            if let Some(link_id) =
                                                input.get("link").and_then(|v| v.as_i64())
                                            {
                                                if let Some((source_node_id, _)) =
                                                    link_source_map.get(&link_id)
                                                {
                                                    resolved.insert(
                                                        name.to_string(),
                                                        Value::String(source_node_id.clone()),
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }

                                // Virtual Inputs for GetNode
                                if t == "GetNode" {
                                    if let Some(var_name) = node
                                        .get("widgets_values")
                                        .and_then(|v| v.get(0))
                                        .and_then(|v| v.as_str())
                                    {
                                        if let Some((source_id, link_type)) = var_map.get(var_name)
                                        {
                                            resolved.insert(
                                                var_name.to_string(),
                                                Value::String(source_id.clone()),
                                            );
                                            resolved.insert(
                                                "source".to_string(),
                                                Value::String(source_id.clone()),
                                            );
                                            // Inject type as key for robust type-based traversal (e.g. "CONDITIONING")
                                            if !link_type.is_empty() && link_type != "*" {
                                                resolved.insert(
                                                    link_type.clone(),
                                                    Value::String(source_id.clone()),
                                                );
                                            }
                                        }
                                    }
                                }

                                if let Some(obj) = node_obj.as_object_mut() {
                                    obj.insert(
                                        "_resolved_inputs".to_string(),
                                        Value::Object(resolved),
                                    );
                                }

                                nodes_map.insert(id.to_string(), node_obj);
                            }
                        }
                    }

                    // Post-Process: Flatten GetNode chains (Optional, but helps if evaluator checks type)
                    // If a node points to a GetNode, we can replace the link with the GetNode's source.
                    // (Logic omitted for simplicity, relying on evaluator traversing "source" input of GetNode)
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
    if let Some(id) = node
        .get("_resolved_inputs")
        .and_then(|m| m.get(key))
        .and_then(|v| v.as_str())
    {
        return Some(id.to_string());
    }

    if let Some(link) = node
        .get("inputs")
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_array())
    {
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

pub fn get_node_title(node: &Value) -> Option<&str> {
    node.get("_meta")
        .and_then(|m| m.get("title"))
        .or_else(|| node.get("title"))
        .and_then(|v| v.as_str())
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
                "seed" => {
                    if let Some(v) = arr.get(4) {
                        return Some(v);
                    }
                }
                "steps" => {
                    if let Some(v) = arr.get(5) {
                        return Some(v);
                    }
                }
                "cfg" => {
                    if let Some(v) = arr.get(7) {
                        return Some(v);
                    }
                }
                "sampler_name" => {
                    if let Some(v) = arr.get(8) {
                        return Some(v);
                    }
                }
                "scheduler" => {
                    if let Some(v) = arr.get(9) {
                        return Some(v);
                    }
                }
                "ckpt_name" => {
                    if let Some(v) = arr.first() {
                        if let Some(s) = v.as_str() {
                            if s.ends_with(".safetensors")
                                || s.ends_with(".ckpt")
                                || s.ends_with(".gguf")
                            {
                                return Some(v);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        if t == "SDPromptSaver" {
            match key {
                "seed" => {
                    if let Some(v) = arr.get(3) {
                        return Some(v);
                    }
                }
                "steps" => {
                    if let Some(v) = arr.get(5) {
                        return Some(v);
                    }
                }
                "cfg" => {
                    if let Some(v) = arr.get(6) {
                        return Some(v);
                    }
                }
                "sampler_name" => {
                    if let Some(v) = arr.get(7) {
                        return Some(v);
                    }
                }
                "scheduler" => {
                    if let Some(v) = arr.get(8) {
                        return Some(v);
                    }
                }
                "model_name" | "ckpt_name" => {
                    if let Some(v) = arr.get(2) {
                        return Some(v);
                    }
                }
                _ => {}
            }
        }

        // Heuristic mapping for UI format
        match key {
            "steps" => {
                for val in arr {
                    if let Some(v) = val.as_u64() {
                        if v > 0 && v < 200 {
                            return Some(val);
                        }
                    }
                }
            }
            "seed" | "noise_seed" => {
                for val in arr {
                    if let Some(v) = val.as_i64() {
                        if !(-1..=100000).contains(&v) {
                            return Some(val);
                        }
                    }
                }
            }
            "cfg" => {
                for val in arr {
                    if let Some(v) = val.as_f64() {
                        if (0.1..=30.0).contains(&v) {
                            return Some(val);
                        }
                    }
                }
            }
            "ckpt_name" | "unet_name" | "model_name" | "checkpoint" | "files" => {
                for val in arr {
                    if let Some(s) = val.as_str() {
                        if s.ends_with(".safetensors")
                            || s.ends_with(".ckpt")
                            || s.ends_with(".gguf")
                        {
                            return Some(val);
                        }
                    }
                }
            }
            "sampler_name" => {
                for val in arr {
                    if let Some(s) = val.as_str() {
                        let common = [
                            "euler",
                            "dpmpp",
                            "uni_pc",
                            "heun",
                            "ddim",
                            "ancestral",
                            "2m",
                            "sde",
                            "ddpm",
                            "lcm",
                            "ipndm",
                        ];
                        let lower = s.to_lowercase();
                        if common.iter().any(|&c| lower.contains(c)) {
                            return Some(val);
                        }
                        let exclusions = ["fixed", "increment", "decrement", "random"];
                        if !s.contains(' ') && s.len() < 20 && !exclusions.contains(&lower.as_str())
                        {
                            return Some(val);
                        }
                    }
                }
            }
            "scheduler" => {
                for val in arr {
                    if let Some(s) = val.as_str() {
                        let common = [
                            "normal",
                            "karras",
                            "exponential",
                            "sgm_uniform",
                            "simple",
                            "ddim_uniform",
                            "beta",
                        ];
                        let lower = s.to_lowercase();
                        if common.iter().any(|&c| lower.contains(c)) {
                            return Some(val);
                        }
                    }
                }
            }
            "lora_name" => {
                for val in arr {
                    if let Some(s) = val.as_str() {
                        if s.ends_with(".safetensors") || s.ends_with(".ckpt") || s.ends_with(".pt")
                        {
                            return Some(val);
                        }
                    }
                }
            }
            "text" => {
                for val in arr {
                    if let Some(s) = val.as_str() {
                        if s.len() > 5 {
                            return Some(val);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    None
}
