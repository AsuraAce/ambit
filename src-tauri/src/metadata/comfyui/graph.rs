use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use super::workflow_normalizer::normalize_workflow;

/// Normalizes ComfyUI metadata into a graph representation.
pub struct ComfyGraph {
    pub(crate) nodes: HashMap<String, Value>,
    pub(crate) broadcasters: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum InputConnection {
    Connected(String),
    DeclaredUnresolved,
    Unconnected,
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
                        let mut node_obj = node.clone();
                        if let Some(n_obj) = node_obj.as_object_mut() {
                            n_obj.insert("id".to_string(), Value::String(id.clone()));
                        }
                        nodes_map.insert(id.clone(), node_obj);
                    }
                }
            }
        }

        // 2. Fallback to "workflow" chunk (UI format)
        if nodes_map.is_empty() {
            if let Some(workflow_json) = chunks.get("workflow") {
                if let Ok(json) = serde_json::from_str::<Value>(workflow_json) {
                    if let Some(normalized) = normalize_workflow(&json) {
                        let mut incoming = HashMap::new();
                        let mut incoming_by_link = HashMap::new();
                        for edge in &normalized.edges {
                            incoming.insert(
                                (edge.target_id.clone(), edge.target_slot),
                                (edge.source_id.clone(), edge.link_type.clone()),
                            );
                            if let Some(link_id) = &edge.link_id {
                                incoming_by_link.insert(
                                    (edge.target_id.clone(), link_id.clone()),
                                    (edge.source_id.clone(), edge.link_type.clone()),
                                );
                            }
                        }

                        let mut var_map = HashMap::new();
                        for node in &normalized.nodes {
                            if get_node_type(node) != "SetNode" {
                                continue;
                            }
                            let Some(id) = node.get("id").and_then(value_as_id) else {
                                continue;
                            };
                            let Some(var_name) = node
                                .get("widgets_values")
                                .and_then(|value| value.get(0))
                                .and_then(Value::as_str)
                            else {
                                continue;
                            };
                            if let Some((source_id, link_type)) = incoming.get(&(id, 0)) {
                                var_map.insert(
                                    var_name.to_string(),
                                    (source_id.clone(), link_type.clone()),
                                );
                            }
                        }

                        for mut node in normalized.nodes {
                            let Some(id) = node.get("id").and_then(value_as_id) else {
                                continue;
                            };
                            let node_type = get_node_type(&node).to_string();
                            let mut resolved = serde_json::Map::new();

                            if let Some(inputs) = node.get("inputs").and_then(Value::as_array) {
                                for (slot, input) in inputs.iter().enumerate() {
                                    let Some(name) = input.get("name").and_then(Value::as_str)
                                    else {
                                        continue;
                                    };
                                    let linked_source = input
                                        .get("link")
                                        .and_then(value_as_id)
                                        .and_then(|link_id| {
                                            incoming_by_link.get(&(id.clone(), link_id))
                                        })
                                        .or_else(|| incoming.get(&(id.clone(), slot)));
                                    if let Some((source_id, _)) = linked_source {
                                        let value = resolved
                                            .entry(name.to_string())
                                            .or_insert(Value::Array(Vec::new()));
                                        if let Some(values) = value.as_array_mut() {
                                            values.push(Value::String(source_id.clone()));
                                        }
                                    }
                                }
                            }

                            if node_type == "GetNode" {
                                if let Some(var_name) = node
                                    .get("widgets_values")
                                    .and_then(|value| value.get(0))
                                    .and_then(Value::as_str)
                                {
                                    if let Some((source_id, link_type)) = var_map.get(var_name) {
                                        resolved.insert(
                                            var_name.to_string(),
                                            Value::String(source_id.clone()),
                                        );
                                        resolved.insert(
                                            "source".to_string(),
                                            Value::String(source_id.clone()),
                                        );
                                        if !link_type.is_empty() && link_type != "*" {
                                            resolved.insert(
                                                link_type.clone(),
                                                Value::String(source_id.clone()),
                                            );
                                        }
                                    }
                                }
                            }

                            if let Some(object) = node.as_object_mut() {
                                object.insert(
                                    "_resolved_inputs".to_string(),
                                    Value::Object(resolved),
                                );
                            }
                            nodes_map.insert(id, node);
                        }
                    }
                }
            }
        }

        let mut broadcasters = Vec::new();
        for (id, node) in &nodes_map {
            let t = get_node_type(node);
            if t.contains("Everywhere") || t.contains("Wireless") || t.contains("Broadcast") {
                broadcasters.push(id.clone());
            }
        }

        Self {
            nodes: nodes_map,
            broadcasters,
        }
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
pub(crate) fn compare_node_ids(left_id: &str, right_id: &str) -> Ordering {
    match (left_id.parse::<u64>(), right_id.parse::<u64>()) {
        (Ok(left), Ok(right)) => left.cmp(&right).then_with(|| left_id.cmp(right_id)),
        (Ok(_), Err(_)) => Ordering::Less,
        (Err(_), Ok(_)) => Ordering::Greater,
        (Err(_), Err(_)) => left_id.cmp(right_id),
    }
}

pub fn get_node_input_link(node: &Value, key: &str) -> Option<String> {
    get_node_input_links(node, key).into_iter().next()
}

pub(crate) fn get_input_connection(node: &Value, key: &str) -> InputConnection {
    if let Some(value) = node
        .get("_resolved_inputs")
        .and_then(|inputs| inputs.get(key))
    {
        if let Some(source_id) = value.as_str() {
            return InputConnection::Connected(source_id.to_string());
        }
        if let Some(source_id) = value
            .as_array()
            .and_then(|sources| sources.first())
            .and_then(Value::as_str)
        {
            return InputConnection::Connected(source_id.to_string());
        }
        return InputConnection::DeclaredUnresolved;
    }

    if let Some(value) = node
        .get("inputs")
        .and_then(Value::as_object)
        .and_then(|inputs| inputs.get(key))
    {
        if let Some(link) = value.as_array() {
            if link.len() >= 2 && link[1].is_number() {
                if let Some(source_id) = link[0]
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| link[0].as_i64().map(|source_id| source_id.to_string()))
                    .or_else(|| link[0].as_u64().map(|source_id| source_id.to_string()))
                {
                    return InputConnection::Connected(source_id);
                }
                return InputConnection::DeclaredUnresolved;
            }
        }
    }

    if node
        .get("inputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|input| {
            input.get("name").and_then(Value::as_str) == Some(key)
                && input.get("link").is_some_and(|link| !link.is_null())
        })
    {
        return InputConnection::DeclaredUnresolved;
    }

    InputConnection::Unconnected
}

pub(crate) fn get_strict_source_id(node: &Value, key: &str) -> Option<String> {
    match get_input_connection(node, key) {
        InputConnection::Connected(source_id) => Some(source_id),
        InputConnection::DeclaredUnresolved | InputConnection::Unconnected => None,
    }
}

pub(crate) fn get_reroute_source_id(node: &Value) -> Option<String> {
    for key in ["", "value", "input", "any"] {
        match get_input_connection(node, key) {
            InputConnection::Connected(source_id) => return Some(source_id),
            InputConnection::DeclaredUnresolved => return None,
            InputConnection::Unconnected => {}
        }
    }
    None
}

pub(crate) fn get_node_input_links(node: &Value, key: &str) -> Vec<String> {
    // 0. Check pre-resolved check inputs
    if let Some(val) = node.get("_resolved_inputs").and_then(|m| m.get(key)) {
        if let Some(id) = val.as_str() {
            return vec![id.to_string()];
        }
        if let Some(arr) = val.as_array() {
            let ids: Vec<String> = arr
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect();
            if !ids.is_empty() {
                return ids;
            }
        }
    }

    if let Some(inputs) = node.get("inputs").and_then(|v| v.as_object()) {
        if let Some(link) = inputs.get(key) {
            if let Some(arr) = link.as_array() {
                if !arr.is_empty() {
                    if let Some(s) = arr[0].as_str() {
                        return vec![s.to_string()];
                    }
                    if let Some(n) = arr[0].as_u64() {
                        return vec![n.to_string()];
                    }
                }
            }
            if let Some(s) = link.as_str() {
                return vec![s.to_string()];
            }
        }
    }
    Vec::new()
}

/// Helper to resolve links (including wireless)
pub fn get_source_id(graph: &ComfyGraph, node_id: &str, input_name: &str) -> Option<String> {
    if let Some(node) = graph.get_node(node_id) {
        if let Some(link) = get_node_input_link(node, input_name) {
            return Some(link);
        }
        // Wireless fallback
        if let Some(wireless) =
            crate::metadata::comfyui::heuristics::find_wireless_node(graph, node, input_name)
        {
            // CRITICAL: Prevent self-reference loops
            if wireless != node_id {
                return Some(wireless);
            }
        }
    }
    None
}

pub fn get_node_id(node: &Value) -> String {
    node.get("id")
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_u64().map(|n| n.to_string()))
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        })
        .unwrap_or_default()
}

fn value_as_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|id| id.to_string()))
        .or_else(|| value.as_u64().map(|id| id.to_string()))
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

pub fn get_switch_branch_input(
    graph: &ComfyGraph,
    node_id: &str,
    node: &Value,
) -> Option<&'static str> {
    resolve_bool_input(graph, node_id, node, "switch").map(|enabled| {
        if enabled {
            "on_true"
        } else {
            "on_false"
        }
    })
}

pub(crate) fn get_switch_branch_input_strict(
    graph: &ComfyGraph,
    node: &Value,
) -> Option<&'static str> {
    resolve_bool_input_strict(graph, node, "switch").map(|enabled| {
        if enabled {
            "on_true"
        } else {
            "on_false"
        }
    })
}

pub fn get_switch_branch_source(graph: &ComfyGraph, node_id: &str, node: &Value) -> Option<String> {
    let branch = get_switch_branch_input(graph, node_id, node)?;
    get_source_id(graph, node_id, branch)
}

fn resolve_bool_input(graph: &ComfyGraph, node_id: &str, node: &Value, key: &str) -> Option<bool> {
    if let Some(value) = get_node_param(node, key).and_then(value_as_bool) {
        return Some(value);
    }

    let source_id = get_source_id(graph, node_id, key)?;
    resolve_linked_bool(graph, &source_id, &mut HashSet::new(), 0)
}

fn resolve_bool_input_strict(graph: &ComfyGraph, node: &Value, key: &str) -> Option<bool> {
    match get_input_connection(node, key) {
        InputConnection::Connected(source_id) => {
            resolve_linked_bool_strict(graph, &source_id, &mut HashSet::new(), 0)
        }
        InputConnection::DeclaredUnresolved => None,
        InputConnection::Unconnected => get_node_param(node, key).and_then(value_as_bool),
    }
}

fn resolve_linked_bool(
    graph: &ComfyGraph,
    node_id: &str,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<bool> {
    if depth > 16 || !visited.insert(node_id.to_string()) {
        return None;
    }

    let node = graph.get_node(node_id)?;
    for key in ["value", "bool", "BOOLEAN", "switch"] {
        if let Some(value) = get_node_param(node, key).and_then(value_as_bool) {
            return Some(value);
        }
    }

    if let Some(value) = node
        .get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(value_as_bool)
    {
        return Some(value);
    }

    if get_node_type(node) == "Reroute" {
        let source_id = ["", "value", "input", "any"]
            .into_iter()
            .find_map(|key| get_source_id(graph, node_id, key))?;
        return resolve_linked_bool(graph, &source_id, visited, depth + 1);
    }

    None
}

fn resolve_linked_bool_strict(
    graph: &ComfyGraph,
    node_id: &str,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<bool> {
    if depth > 16 || !visited.insert(node_id.to_string()) {
        return None;
    }

    let node = graph.get_node(node_id)?;
    let is_reroute = get_node_type(node) == "Reroute";
    let input_keys: &[&str] = if is_reroute {
        &["", "value", "input", "any"]
    } else {
        &["value", "bool", "BOOLEAN", "switch"]
    };
    for key in input_keys {
        match get_input_connection(node, key) {
            InputConnection::Connected(source_id) => {
                return resolve_linked_bool_strict(graph, &source_id, visited, depth + 1);
            }
            InputConnection::DeclaredUnresolved => return None,
            InputConnection::Unconnected => {}
        }
    }
    if is_reroute {
        return None;
    }

    for key in ["value", "bool", "BOOLEAN", "switch"] {
        if let Some(value) = get_node_param(node, key).and_then(value_as_bool) {
            return Some(value);
        }
    }

    node.get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(value_as_bool)
}

fn value_as_bool(value: &Value) -> Option<bool> {
    value.as_bool().or_else(|| {
        value
            .as_i64()
            .map(|number| number != 0)
            .or_else(|| value.as_u64().map(|number| number != 0))
            .or_else(|| {
                value
                    .as_str()
                    .and_then(|text| match text.trim().to_ascii_lowercase().as_str() {
                        "true" | "1" | "yes" | "on" | "enable" | "enabled" => Some(true),
                        "false" | "0" | "no" | "off" | "disable" | "disabled" => Some(false),
                        _ => None,
                    })
            })
    })
}

pub fn get_node_param<'a>(node: &'a Value, key: &str) -> Option<&'a Value> {
    // 1. Check in API format "inputs"
    if let Some(val) = node.get("inputs").and_then(|v| v.get(key)) {
        return Some(val);
    }

    // UI workflows retain widget defaults even when the input is linked. The
    // link is authoritative, so evaluators must follow `_resolved_inputs`.
    if node
        .get("_resolved_inputs")
        .and_then(|inputs| inputs.get(key))
        .is_some()
    {
        return None;
    }

    if let Some(value) = node
        .get("_widget_overrides")
        .and_then(|overrides| overrides.get(key))
    {
        return Some(value);
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
                "positive" => {
                    if let Some(v) = arr.get(11) {
                        return Some(v);
                    }
                }
                "negative" => {
                    if let Some(v) = arr.get(12) {
                        return Some(v);
                    }
                }
                "extra_info" => {
                    if let Some(v) = arr.get(20) {
                        return Some(v);
                    }
                }
                _ => {}
            }
        }

        if t == "smZ CLIPTextEncode" {
            match key {
                "text" | "string" | "value" => {
                    if let Some(v) = arr.first() {
                        return Some(v);
                    }
                }
                _ => {}
            }
        }

        if t == "CLIPTextEncode" && key == "text" {
            return arr.first();
        }

        if t == "StringReplace" {
            match key {
                "string" => return arr.first(),
                "find" => return arr.get(1),
                "replace" => return arr.get(2),
                _ => {}
            }
        }

        if t == "RegexExtract" {
            match key {
                "string" => return arr.first(),
                "regex_pattern" => return arr.get(1),
                "mode" => return arr.get(2),
                "case_insensitive" => return arr.get(3),
                "multiline" => return arr.get(4),
                "dotall" => return arr.get(5),
                "group_index" => return arr.get(6),
                _ => {}
            }
        }

        if t == "StringConcatenate" {
            match key {
                "string_a" => return arr.first(),
                "string_b" => return arr.get(1),
                "delimiter" => return arr.get(2),
                _ => {}
            }
        }

        if t == "KSampler" {
            match key {
                "seed" | "noise_seed" => return arr.get(0),
                "steps" => return arr.get(2),
                "cfg" => return arr.get(3),
                "sampler_name" => return arr.get(4),
                "scheduler" => return arr.get(5),
                "denoise" => return arr.get(6),
                _ => {}
            }
        }

        if t == "KSamplerAdvanced" {
            match key {
                "noise_seed" | "seed" => return arr.get(1),
                "steps" => return arr.get(3),
                "cfg" => return arr.get(6),
                "sampler_name" => return arr.get(7),
                "scheduler" => return arr.get(8),
                "start_at_step" => return arr.get(4),
                "end_at_step" => return arr.get(5),
                _ => {}
            }
        }

        if t == "HypernetworkLoader" {
            match key {
                "hypernetwork_name" => return arr.first(),
                "strength" => return arr.get(1),
                _ => {}
            }
        }

        if t == "FluxGuidance" {
            match key {
                "guidance" => return arr.first(),
                _ => {}
            }
        }

        if t == "CFGGuider" && key == "cfg" {
            return arr.first();
        }

        if t == "DualCFGGuider" && key == "cfg_conds" {
            return arr.first();
        }

        if t == "BasicScheduler" {
            match key {
                "scheduler" => return arr.first(),
                "steps" => return arr.get(1),
                "denoise" => return arr.get(2),
                _ => {}
            }
        }

        if t == "KSamplerSelect" && key == "sampler_name" {
            return arr.first();
        }

        if t == "SamplerCustom" {
            match key {
                "noise_seed" => return arr.get(1),
                "cfg" => return arr.get(3),
                _ => {}
            }
        }

        if t == "BetaSamplingScheduler" && key == "steps" {
            return arr.first();
        }

        if t == "SDPromptSaver" {
            match key {
                "ckpt_name" | "model_name" => return arr.get(2),
                "seed" | "noise_seed" => return arr.get(3),
                "steps" => return arr.get(5),
                "cfg" => return arr.get(6),
                "sampler_name" => return arr.get(7),
                "scheduler" => return arr.get(8),
                "positive" => return arr.get(11),
                "negative" => return arr.get(12),
                _ => {}
            }
        }

        if t == "ImpactWildcardProcessor" {
            match key {
                "wildcard_text" => return arr.get(0),
                "populated_text" => return arr.get(1),
                "seed" => return arr.get(3),
                _ => {
                    // Default to populated_text if asking for "text" or "string"
                    if key == "text" || key == "string" {
                        return arr.get(1);
                    }
                }
            }
        }

        if t == "Concat Text _O" {
            match key {
                "text1" => return arr.get(0),
                "text2" => return arr.get(1),
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
                        let exclusions = [
                            "fixed",
                            "increment",
                            "decrement",
                            "random",
                            "randomize",
                            "enable",
                            "disable",
                            "none",
                            "null",
                            "undefined",
                        ];
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
                        let exclusions = [
                            "fixed",
                            "increment",
                            "decrement",
                            "random",
                            "randomize",
                            "enable",
                            "disable",
                            "none",
                            "null",
                            "undefined",
                        ];
                        if !s.contains(' ') && s.len() < 20 && !exclusions.contains(&lower.as_str())
                        {
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
                        let lower = s.to_lowercase();
                        let exclusions =
                            ["undefined", "null", "none", "unknown", "negative prompt:"];
                        if s.len() > 5 && !exclusions.contains(&lower.as_str()) {
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
