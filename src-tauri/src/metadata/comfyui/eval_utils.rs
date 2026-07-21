use super::graph::{
    get_input_connection, get_input_source, get_node_id, get_node_param, get_node_type,
    get_switch_branch_input_strict, get_switch_branch_source, ComfyGraph, InputConnection,
    InputSource, InputSourceConnection,
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

fn first_declared_source(node: &Value, keys: &[&str]) -> InputSourceConnection {
    for key in keys {
        match get_input_source(node, key) {
            InputSourceConnection::Unconnected => {}
            connection => return connection,
        }
    }
    InputSourceConnection::Unconnected
}

enum NumericScalar {
    Boolean(bool),
    Integer(i64),
    Unsigned(u64),
    Float(f64),
    String(String),
}

fn numeric_scalar_from_value(value: &Value) -> Option<NumericScalar> {
    if let Some(value) = value.as_bool() {
        return Some(NumericScalar::Boolean(value));
    }
    if let Some(value) = value.as_i64() {
        return Some(NumericScalar::Integer(value));
    }
    if let Some(value) = value.as_u64() {
        return Some(NumericScalar::Unsigned(value));
    }
    if let Some(value) = value.as_f64() {
        return value.is_finite().then_some(NumericScalar::Float(value));
    }
    value
        .as_str()
        .map(|value| NumericScalar::String(value.to_string()))
}

fn numeric_scalar_as_i64(value: NumericScalar) -> Option<i64> {
    match value {
        NumericScalar::Boolean(value) => Some(i64::from(value)),
        NumericScalar::Integer(value) => Some(value),
        NumericScalar::Unsigned(value) => i64::try_from(value).ok(),
        NumericScalar::Float(value) => finite_float_as_i64(value),
        NumericScalar::String(value) => {
            let value = value.trim();
            if value.is_empty() {
                return None;
            }
            value
                .parse::<i64>()
                .ok()
                .or_else(|| {
                    value
                        .parse::<u64>()
                        .ok()
                        .and_then(|value| i64::try_from(value).ok())
                })
                .or_else(|| value.parse::<f64>().ok().and_then(finite_float_as_i64))
        }
    }
}

fn numeric_scalar_as_f64(value: NumericScalar) -> Option<f64> {
    let value = match value {
        NumericScalar::Boolean(value) => {
            if value {
                1.0
            } else {
                0.0
            }
        }
        NumericScalar::Integer(value) => value as f64,
        NumericScalar::Unsigned(value) => value as f64,
        NumericScalar::Float(value) => value,
        NumericScalar::String(value) => value.trim().parse::<f64>().ok()?,
    };
    value.is_finite().then_some(value)
}

fn finite_float_as_i64(value: f64) -> Option<i64> {
    const I64_UPPER_EXCLUSIVE: f64 = 9_223_372_036_854_775_808.0;

    if !value.is_finite() {
        return None;
    }
    let value = value.trunc();
    if value < i64::MIN as f64 || value >= I64_UPPER_EXCLUSIVE {
        return None;
    }
    Some(value as i64)
}

fn evaluate_numeric_scalar_source(
    graph: &ComfyGraph,
    source: &InputSource,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<NumericScalar> {
    if depth > 16 || !visited.insert(source.node_id.clone()) {
        return None;
    }
    let node = graph.get_node(&source.node_id)?;
    let node_type = get_node_type(node);

    if node_type == "ComfySwitchNode" {
        let branch = get_switch_branch_input_strict(graph, node)?;
        return match get_input_source(node, branch) {
            InputSourceConnection::Connected(source) => {
                evaluate_numeric_scalar_source(graph, &source, visited, depth + 1)
            }
            InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => None,
        };
    }

    if node_type == "Reroute" {
        return match first_declared_source(node, &["", "value", "input", "any"]) {
            InputSourceConnection::Connected(source) => {
                evaluate_numeric_scalar_source(graph, &source, visited, depth + 1)
            }
            InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => None,
        };
    }

    if node_type == "ComfyNumberConvert" {
        return evaluate_comfy_number_convert(graph, node, source.output_slot, visited, depth);
    }

    match first_declared_source(node, &["value", "int", "float"]) {
        InputSourceConnection::Connected(source) => {
            return evaluate_numeric_scalar_source(graph, &source, visited, depth + 1);
        }
        InputSourceConnection::DeclaredUnresolved => return None,
        InputSourceConnection::Unconnected => {}
    }

    for key in ["value", "int", "float"] {
        if let Some(value) = get_node_param(node, key).and_then(numeric_scalar_from_value) {
            return Some(value);
        }
    }

    if let Some(value) =
        super::conditioning::evaluate_string_source_strict(graph, source, &mut HashSet::new(), 0)
    {
        return Some(NumericScalar::String(value));
    }

    if let Some(value) = node
        .get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(numeric_scalar_from_value)
    {
        return Some(value);
    }

    None
}

fn evaluate_comfy_number_convert(
    graph: &ComfyGraph,
    node: &Value,
    output_slot: Option<usize>,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<NumericScalar> {
    let value = match get_input_source(node, "value") {
        InputSourceConnection::Connected(source) => {
            evaluate_numeric_scalar_source(graph, &source, visited, depth + 1)?
        }
        InputSourceConnection::DeclaredUnresolved => return None,
        InputSourceConnection::Unconnected => {
            get_node_param(node, "value").and_then(numeric_scalar_from_value)?
        }
    };

    match output_slot {
        Some(0) => numeric_scalar_as_f64(value).map(NumericScalar::Float),
        Some(1) => numeric_scalar_as_i64(value).map(NumericScalar::Integer),
        _ => None,
    }
}

fn evaluate_linked_number_strict(
    graph: &ComfyGraph,
    source: &InputSource,
    param: &str,
    max_limit: i64,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<i64> {
    if depth > 16 || !visited.insert(source.node_id.clone()) {
        return None;
    }
    let node = graph.get_node(&source.node_id)?;
    let node_type = get_node_type(node);
    if node_type == "ComfyNumberConvert" {
        let value = evaluate_comfy_number_convert(graph, node, source.output_slot, visited, depth)?;
        return numeric_scalar_as_i64(value).filter(|value| *value < max_limit);
    }
    if node_type == "ComfySwitchNode" {
        let branch = get_switch_branch_input_strict(graph, node)?;
        return match get_input_source(node, branch) {
            InputSourceConnection::Connected(source) => {
                evaluate_linked_number_strict(graph, &source, param, max_limit, visited, depth + 1)
            }
            InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => None,
        };
    }

    let input_keys: &[&str] = if node_type == "Reroute" {
        &["", "value", "input", "any"]
    } else {
        &["value", "int", param]
    };
    match first_declared_source(node, input_keys) {
        InputSourceConnection::Connected(source) => {
            return evaluate_linked_number_strict(
                graph,
                &source,
                param,
                max_limit,
                visited,
                depth + 1,
            );
        }
        InputSourceConnection::DeclaredUnresolved => return None,
        InputSourceConnection::Unconnected if node_type == "Reroute" => return None,
        InputSourceConnection::Unconnected => {}
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
    source: &InputSource,
    param: &str,
    max_limit: f64,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<f64> {
    if depth > 16 || !visited.insert(source.node_id.clone()) {
        return None;
    }
    let node = graph.get_node(&source.node_id)?;
    let node_type = get_node_type(node);
    if node_type == "ComfyNumberConvert" {
        let value = evaluate_comfy_number_convert(graph, node, source.output_slot, visited, depth)?;
        return numeric_scalar_as_f64(value).filter(|value| *value < max_limit);
    }
    if node_type == "ComfySwitchNode" {
        let branch = get_switch_branch_input_strict(graph, node)?;
        return match get_input_source(node, branch) {
            InputSourceConnection::Connected(source) => {
                evaluate_linked_float_strict(graph, &source, param, max_limit, visited, depth + 1)
            }
            InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => None,
        };
    }

    let input_keys: &[&str] = if node_type == "Reroute" {
        &["", "value", "input", "any"]
    } else {
        &["value", "float", param]
    };
    match first_declared_source(node, input_keys) {
        InputSourceConnection::Connected(source) => {
            return evaluate_linked_float_strict(
                graph,
                &source,
                param,
                max_limit,
                visited,
                depth + 1,
            );
        }
        InputSourceConnection::DeclaredUnresolved => return None,
        InputSourceConnection::Unconnected if node_type == "Reroute" => return None,
        InputSourceConnection::Unconnected => {}
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
    match get_input_source(node, param) {
        InputSourceConnection::Connected(source) => {
            evaluate_linked_number_strict(graph, &source, param, max_limit, &mut HashSet::new(), 0)
        }
        InputSourceConnection::DeclaredUnresolved => None,
        InputSourceConnection::Unconnected => get_node_param(node, param)
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
    match get_input_source(node, param) {
        InputSourceConnection::Connected(source) => {
            evaluate_linked_float_strict(graph, &source, param, max_limit, &mut HashSet::new(), 0)
        }
        InputSourceConnection::DeclaredUnresolved => None,
        InputSourceConnection::Unconnected => get_node_param(node, param)
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
