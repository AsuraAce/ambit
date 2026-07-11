use super::graph::{
    get_node_id, get_node_param, get_node_type, get_switch_branch_source, ComfyGraph,
};
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

    let source_id = get_source_id(graph, node, param)?;
    evaluate_linked_number(graph, &source_id, param, max_limit, &mut HashSet::new(), 0)
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
    let source_id = get_source_id(graph, node, param)?;
    evaluate_linked_float(graph, &source_id, param, max_limit, &mut HashSet::new(), 0)
}

fn evaluate_linked_number(
    graph: &ComfyGraph,
    node_id: &str,
    param: &str,
    max_limit: i64,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<i64> {
    if depth > 16 || !visited.insert(node_id.to_string()) {
        return None;
    }
    let node = graph.get_node(node_id)?;
    if get_node_type(node) == "ComfySwitchNode" {
        let selected = get_switch_branch_source(graph, node_id, node)?;
        return evaluate_linked_number(graph, &selected, param, max_limit, visited, depth + 1);
    }

    for key in ["value", "int", param] {
        if let Some(value) = get_node_param(node, key).and_then(value_as_i64) {
            return (value < max_limit).then_some(value);
        }
    }
    node.get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(value_as_i64)
        .filter(|value| *value < max_limit)
}

fn evaluate_linked_float(
    graph: &ComfyGraph,
    node_id: &str,
    param: &str,
    max_limit: f64,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<f64> {
    if depth > 16 || !visited.insert(node_id.to_string()) {
        return None;
    }
    let node = graph.get_node(node_id)?;
    if get_node_type(node) == "ComfySwitchNode" {
        let selected = get_switch_branch_source(graph, node_id, node)?;
        return evaluate_linked_float(graph, &selected, param, max_limit, visited, depth + 1);
    }

    for key in ["value", "float", param] {
        if let Some(value) = get_node_param(node, key).and_then(value_as_f64) {
            return (value < max_limit).then_some(value);
        }
    }
    node.get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(value_as_f64)
        .filter(|value| *value < max_limit)
}

fn value_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
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
