use super::graph::{
    get_input_connection, get_node_id, get_node_param, get_node_type,
    get_switch_branch_input_strict, get_switch_branch_source, ComfyGraph, InputConnection,
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

fn first_declared_connection(node: &Value, keys: &[&str]) -> InputConnection {
    for key in keys {
        match get_input_connection(node, key) {
            InputConnection::Unconnected => {}
            connection => return connection,
        }
    }
    InputConnection::Unconnected
}

fn evaluate_linked_number_strict(
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
        let branch = get_switch_branch_input_strict(graph, node)?;
        return match get_input_connection(node, branch) {
            InputConnection::Connected(source_id) => evaluate_linked_number_strict(
                graph,
                &source_id,
                param,
                max_limit,
                visited,
                depth + 1,
            ),
            InputConnection::DeclaredUnresolved | InputConnection::Unconnected => None,
        };
    }

    let input_keys: &[&str] = if get_node_type(node) == "Reroute" {
        &["", "value", "input", "any"]
    } else {
        &["value", "int", param]
    };
    match first_declared_connection(node, input_keys) {
        InputConnection::Connected(source_id) => {
            return evaluate_linked_number_strict(
                graph,
                &source_id,
                param,
                max_limit,
                visited,
                depth + 1,
            );
        }
        InputConnection::DeclaredUnresolved => return None,
        InputConnection::Unconnected if get_node_type(node) == "Reroute" => return None,
        InputConnection::Unconnected => {}
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

fn evaluate_linked_float_strict(
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
        let branch = get_switch_branch_input_strict(graph, node)?;
        return match get_input_connection(node, branch) {
            InputConnection::Connected(source_id) => evaluate_linked_float_strict(
                graph,
                &source_id,
                param,
                max_limit,
                visited,
                depth + 1,
            ),
            InputConnection::DeclaredUnresolved | InputConnection::Unconnected => None,
        };
    }

    let input_keys: &[&str] = if get_node_type(node) == "Reroute" {
        &["", "value", "input", "any"]
    } else {
        &["value", "float", param]
    };
    match first_declared_connection(node, input_keys) {
        InputConnection::Connected(source_id) => {
            return evaluate_linked_float_strict(
                graph,
                &source_id,
                param,
                max_limit,
                visited,
                depth + 1,
            );
        }
        InputConnection::DeclaredUnresolved => return None,
        InputConnection::Unconnected if get_node_type(node) == "Reroute" => return None,
        InputConnection::Unconnected => {}
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

fn evaluate_linked_string(
    graph: &ComfyGraph,
    node_id: &str,
    param: &str,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<String> {
    if depth > 16 || !visited.insert(node_id.to_string()) {
        return None;
    }
    let node = graph.get_node(node_id)?;
    let node_type = get_node_type(node);

    if node_type == "ComfySwitchNode" {
        let branch = get_switch_branch_input_strict(graph, node)?;
        return match get_input_connection(node, branch) {
            InputConnection::Connected(source_id) => {
                evaluate_linked_string(graph, &source_id, param, visited, depth + 1)
            }
            InputConnection::DeclaredUnresolved | InputConnection::Unconnected => None,
        };
    }

    if node_type == "Reroute" || is_string_literal_node(node_type) {
        let input_keys: &[&str] = if node_type == "Reroute" {
            &["", "value", "input", "any"]
        } else {
            &[
                "value", "string", "String", "STRING", "VALUE", "text", param,
            ]
        };
        match first_declared_connection(node, input_keys) {
            InputConnection::Connected(source_id) => {
                return evaluate_linked_string(graph, &source_id, param, visited, depth + 1);
            }
            InputConnection::DeclaredUnresolved => return None,
            InputConnection::Unconnected if node_type == "Reroute" => return None,
            InputConnection::Unconnected => {}
        }
    }

    super::conditioning::evaluate_string_node_strict(graph, node_id, &mut HashSet::new(), 0)
}

fn is_string_literal_node(node_type: &str) -> bool {
    node_type == "PrimitiveNode"
        || node_type == "String"
        || node_type.contains("StringLiteral")
        || node_type == "Text String"
        || node_type == "Text Multiline"
        || node_type == "PrimitiveString"
        || node_type == "PrimitiveStringMultiline"
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

pub(crate) fn evaluate_number_link_first(
    graph: &ComfyGraph,
    node: &Value,
    param: &str,
    max_limit: i64,
) -> Option<i64> {
    match get_input_connection(node, param) {
        InputConnection::Connected(source_id) => evaluate_linked_number_strict(
            graph,
            &source_id,
            param,
            max_limit,
            &mut HashSet::new(),
            0,
        ),
        InputConnection::DeclaredUnresolved => None,
        InputConnection::Unconnected => get_node_param(node, param)
            .and_then(value_as_i64)
            .filter(|value| *value < max_limit),
    }
}

pub(crate) fn evaluate_float_link_first(
    graph: &ComfyGraph,
    node: &Value,
    param: &str,
    max_limit: f64,
) -> Option<f64> {
    match get_input_connection(node, param) {
        InputConnection::Connected(source_id) => evaluate_linked_float_strict(
            graph,
            &source_id,
            param,
            max_limit,
            &mut HashSet::new(),
            0,
        ),
        InputConnection::DeclaredUnresolved => None,
        InputConnection::Unconnected => get_node_param(node, param)
            .and_then(value_as_f64)
            .filter(|value| *value < max_limit),
    }
}

pub(crate) fn evaluate_string_link_first(
    graph: &ComfyGraph,
    node: &Value,
    param: &str,
) -> Option<String> {
    match get_input_connection(node, param) {
        InputConnection::Connected(source_id) => {
            evaluate_linked_string(graph, &source_id, param, &mut HashSet::new(), 0)
        }
        InputConnection::DeclaredUnresolved => None,
        InputConnection::Unconnected => get_node_param(node, param)
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}
