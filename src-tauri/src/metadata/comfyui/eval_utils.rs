use super::graph::{get_node_id, get_node_param, ComfyGraph};
use serde_json::Value;
use std::collections::HashSet;

pub fn get_source_id(graph: &ComfyGraph, node: &Value, input_name: &str) -> Option<String> {
    super::graph::get_source_id(graph, &get_node_id(node), input_name)
}

pub fn evaluate_number(
    graph: &ComfyGraph,
    node: &Value,
    param: &str,
    max_limit: i64,
) -> Option<i64> {
    if let Some(val) = get_node_param(node, param) {
        if let Some(i) = val.as_i64() {
            if i < max_limit {
                return Some(i);
            }
        }
        if let Some(u) = val.as_u64() {
            if u < (max_limit as u64) {
                return Some(u as i64);
            }
        }
    }

    if let Some(source_id) = get_source_id(graph, node, param) {
        let source = graph.get_node(&source_id)?;
        if let Some(v) = get_node_param(source, "value").and_then(|v| v.as_i64()) {
            return Some(v);
        }
        if let Some(v) = get_node_param(source, "int").and_then(|v| v.as_i64()) {
            return Some(v);
        }
        if let Some(v) = get_node_param(source, param).and_then(|v| v.as_i64()) {
            return Some(v);
        }
        if let Some(arr) = source.get("widgets_values").and_then(|v| v.as_array()) {
            if let Some(v) = arr.get(0).and_then(|v| v.as_i64()) {
                return Some(v);
            }
        }
    }
    None
}

pub fn evaluate_float(
    graph: &ComfyGraph,
    node: &Value,
    param: &str,
    max_limit: f64,
) -> Option<f64> {
    if let Some(val) = get_node_param(node, param) {
        if let Some(f) = val.as_f64() {
            if f < max_limit {
                return Some(f);
            }
        }
    }
    if let Some(source_id) = get_source_id(graph, node, param) {
        let source = graph.get_node(&source_id)?;
        if let Some(v) = get_node_param(source, "value").and_then(|v| v.as_f64()) {
            return Some(v);
        }
        if let Some(v) = get_node_param(source, "float").and_then(|v| v.as_f64()) {
            return Some(v);
        }
        if let Some(v) = get_node_param(source, param).and_then(|v| v.as_f64()) {
            return Some(v);
        }
        if let Some(arr) = source.get("widgets_values").and_then(|v| v.as_array()) {
            if let Some(v) = arr.get(0).and_then(|v| v.as_f64()) {
                return Some(v);
            }
        }
    }
    None
}

pub fn evaluate_string(graph: &ComfyGraph, node: &Value, param: &str) -> Option<String> {
    if let Some(val) = get_node_param(node, param) {
        if let Some(s) = val.as_str() {
            return Some(s.to_string());
        }
    }
    if let Some(source_id) = get_source_id(graph, node, param) {
        let mut visited = HashSet::new();
        return super::conditioning::evaluate_string_node(graph, &source_id, &mut visited, 0);
    }
    None
}
