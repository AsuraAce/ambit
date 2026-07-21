use super::graph::{
    get_input_connection, get_input_source, get_node_input_link, get_node_param, get_node_type,
    get_reroute_source_id, get_source_id, get_strict_source_id, get_switch_branch_input,
    get_switch_branch_input_strict, ComfyGraph, InputConnection, InputSource,
    InputSourceConnection,
};
use super::parse_helper::parse_a1111_parameters;
use crate::metadata::{is_missing_prompt_value, is_placeholder_prompt_value};
use regex::Regex;
use serde_json::Value;
use std::collections::{HashSet, VecDeque};

const MAX_TRANSFORM_STRING_BYTES: usize = 64 * 1024;
const MAX_TRANSFORM_PATTERN_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum StringEvaluationMode {
    Prompt,
    TransformOperand,
}

/// Finds all prompts reachable from the given start node (usually KSampler) by traversing
/// upstream "conditioning" inputs using Breadth-First Search (BFS).
///
/// This resolves complex graphs where prompts are effectively hidden behind:
/// - Branching (ConditioningCombine)
/// - Pass-through nodes (ControlNet, SetArea)
/// - Unknown custom nodes (by heuristically following 'conditioning' inputs)
pub fn find_reachable_prompts(
    graph: &ComfyGraph,
    start_node_id: &str,
    input_name: &str,
    strict_connections: bool,
) -> String {
    let prompt_role = match input_name {
        "cond1" | "conditioning" => "positive",
        _ => input_name,
    };
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    let mut prompts = Vec::new();

    // Initial push: Get source of the KSampler's conditioning input
    let source_id = graph.get_node(start_node_id).and_then(|node| {
        get_conditioning_source_id(graph, start_node_id, node, input_name, strict_connections)
    });
    if let Some(source_id) = source_id {
        queue.push_back((source_id, strict_connections));
    }

    while let Some((current_id, branch_strict_connections)) = queue.pop_front() {
        if !visited.insert((current_id.clone(), branch_strict_connections)) {
            continue;
        }

        if let Some(node) = graph.get_node(&current_id) {
            let t = get_node_type(node);
            let t_lower = t.to_lowercase();

            if t == "Reroute" {
                let source_id = if branch_strict_connections {
                    get_reroute_source_id(node)
                } else {
                    ["", "value", "input", "any"]
                        .into_iter()
                        .find_map(|key| get_source_id(graph, &current_id, key))
                };
                if let Some(source_id) = source_id {
                    queue.push_back((source_id, branch_strict_connections));
                }
                continue;
            }

            // 1. Found a Text Encode Node? Extract and Stop branch.
            // Nodes that directly contain or produce the final text
            if t_lower.contains("cliptextencode")
                || t_lower.contains("textencode")
                || t == "Text to Conditioning"
                || t == "PrimitiveNode"
                || t == "String"
                || t == "Text String"
                || t == "Text Multiline"
                || t == "PrimitiveString"
                || t == "PrimitiveStringMultiline"
                || t == "ImpactWildcardProcessor"
                || t.contains("Qwen")
                || t.contains("LLM")
            {
                if let Some(text) = extract_text_from_node(
                    graph,
                    &current_id,
                    node,
                    prompt_role,
                    branch_strict_connections,
                ) {
                    if !is_missing_prompt_value(&text) {
                        // Filter out A1111 parameter blobs (containing Steps/Model)
                        if text.contains("Steps:")
                            && (text.contains("Model:") || text.contains("Sampler:"))
                        {
                            // Try to rescue the positive prompt part if it exists before the blob
                            let parsed = parse_a1111_parameters(&text);
                            if !is_missing_prompt_value(&parsed.positive_prompt) {
                                prompts.push(parsed.positive_prompt);
                            }
                            continue;
                        }
                        // Filter out explicit separate labels if misplaced
                        if prompt_role == "positive"
                            && text.trim().to_lowercase().starts_with("negative prompt:")
                        {
                            continue;
                        }

                        prompts.push(text);
                    }
                }
                // Usually a leaf for text/conditioning, but for some nodes we might want to continue.
                // For standard encoders, we stop here.
                continue;
            }

            // 2. Traversal Logic (Push upstream sources)

            // A. Known Splitters/Combiners
            if t == "ConditioningCombine" || t == "ConditioningAverage" {
                // Check conditioning_1, conditioning_2, etc. (often just 1 and 2)
                for branch in ["conditioning_1", "conditioning_2"] {
                    if branch_strict_connections {
                        match get_input_connection(node, branch) {
                            InputConnection::Connected(source_id) => {
                                queue.push_back((source_id, branch_strict_connections))
                            }
                            InputConnection::DeclaredUnresolved | InputConnection::Unconnected => {
                                return String::new()
                            }
                        }
                    } else if let Some(source_id) = get_source_id(graph, &current_id, branch) {
                        queue.push_back((source_id, branch_strict_connections));
                    }
                }
                continue;
            }

            // C. ConditioningConcat
            if t == "ConditioningConcat" {
                if branch_strict_connections {
                    for branch in ["conditioning_to", "conditioning_from"] {
                        match get_input_connection(node, branch) {
                            InputConnection::Connected(source_id) => {
                                queue.push_back((source_id, branch_strict_connections))
                            }
                            InputConnection::DeclaredUnresolved | InputConnection::Unconnected => {
                                return String::new()
                            }
                        }
                    }
                    continue;
                }
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "conditioning_to",
                    branch_strict_connections,
                ) {
                    queue.push_back((s, branch_strict_connections));
                }
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "conditioning_from",
                    branch_strict_connections,
                ) {
                    queue.push_back((s, branch_strict_connections));
                }
                continue;
            }

            // D. Terminators
            if t == "ConditioningZeroOut" {
                continue;
            }

            if t == "BerniniConditioning" {
                let selected_input = match prompt_role {
                    "positive" => "positive",
                    "negative" => "negative",
                    _ => continue,
                };
                match get_input_connection(node, selected_input) {
                    InputConnection::Connected(source_id) => queue.push_back((source_id, true)),
                    InputConnection::DeclaredUnresolved | InputConnection::Unconnected => {
                        return String::new();
                    }
                }
                continue;
            }

            // B. Generic / Pass-through
            // We look for common input names that likely carry the conditioning signal upstream.
            // "Text to Conditioning" nodes take 'text' and 'clip' => output conditioning.
            // So we MUST follow 'text'.
            if t == "Text to Conditioning" {
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "text",
                    branch_strict_connections,
                ) {
                    queue.push_back((s, branch_strict_connections));
                }
                continue;
            }

            // Trace upstream
            let relevant_prefixes = [
                "conditioning",
                "positive",
                "negative",
                "cond",
                "c",
                "clip",
                "text_g",
                "text_l",
                "text",
            ];

            // 1. Check pre-resolved inputs (preferred, covers both API and UI format)
            if let Some(resolved) = node.get("_resolved_inputs").and_then(|v| v.as_object()) {
                for (key, val) in resolved {
                    let input_lower = key.to_lowercase();
                    let is_broadcaster = t.contains("Everywhere")
                        || t.contains("Wireless")
                        || t.contains("Broadcast");
                    if is_broadcaster || relevant_prefixes.iter().any(|&r| input_lower.contains(r))
                    {
                        if !is_broadcaster
                            && prompt_role == "positive"
                            && input_lower.contains("negative")
                        {
                            continue;
                        }
                        if !is_broadcaster
                            && prompt_role == "negative"
                            && input_lower.contains("positive")
                        {
                            continue;
                        }

                        // Handle both single string and array of strings (multiple inputs with same name)
                        if let Some(source_id) = val.as_str() {
                            queue.push_back((source_id.to_string(), branch_strict_connections));
                        } else if let Some(arr) = val.as_array() {
                            for item in arr {
                                if let Some(source_id) = item.as_str() {
                                    queue.push_back((
                                        source_id.to_string(),
                                        branch_strict_connections,
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            // 2. Fallback to raw inputs (API format object)
            else if let Some(inputs_obj) = node.get("inputs").and_then(|v| v.as_object()) {
                for (input_key, _input_val) in inputs_obj {
                    let input_lower = input_key.to_lowercase();
                    let is_relevant_prefix =
                        relevant_prefixes.iter().any(|&r| input_lower.contains(r));
                    let is_negative_input = input_lower.contains("negative");
                    let is_positive_input = input_lower.contains("positive");

                    if is_relevant_prefix {
                        if prompt_role == "positive" && is_negative_input {
                            continue;
                        }
                        if prompt_role == "negative" && is_positive_input {
                            continue;
                        }
                        if let Some(s) = get_conditioning_source_id(
                            graph,
                            &current_id,
                            node,
                            input_key,
                            branch_strict_connections,
                        ) {
                            queue.push_back((s, branch_strict_connections));
                        }
                    }
                }
            }
            // 3. Fallback to raw inputs (UI format array)
            else if let Some(inputs_arr) = node.get("inputs").and_then(|v| v.as_array()) {
                for input in inputs_arr {
                    if let Some(name) = input.get("name").and_then(|v| v.as_str()) {
                        let input_lower = name.to_lowercase();
                        if relevant_prefixes.iter().any(|&r| input_lower.contains(r)) {
                            if prompt_role == "positive" && input_lower.contains("negative") {
                                continue;
                            }
                            if prompt_role == "negative" && input_lower.contains("positive") {
                                continue;
                            }
                            if input.get("link").and_then(|v| v.as_i64()).is_some() {
                                // Link ID found but resolving it to Node ID requires more context or _resolved_inputs.
                            }
                        }
                    }
                }
            }
        }
    }

    // Dedup globally while preserving traversal order.
    let mut seen = HashSet::new();
    prompts.retain(|prompt| seen.insert(prompt.clone()));
    prompts.join(", ")
}

pub fn find_connected_controlnets(
    graph: &ComfyGraph,
    start_node_id: &str,
    input_name: &str,
    ip_adapters: &mut Vec<String>,
) -> Vec<String> {
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    let mut controlnets = Vec::new();
    let strict_connections = graph
        .get_node(start_node_id)
        .is_some_and(|node| get_node_type(node) == "SamplerCustom");

    let source_id = graph.get_node(start_node_id).and_then(|node| {
        get_conditioning_source_id(graph, start_node_id, node, input_name, strict_connections)
    });
    if let Some(source_id) = source_id {
        queue.push_back(source_id);
    }

    while let Some(current_id) = queue.pop_front() {
        if !visited.insert(current_id.clone()) {
            continue;
        }

        if let Some(node) = graph.get_node(&current_id) {
            let t = get_node_type(node);

            // ControlNet Apply Logic
            if t.contains("ControlNetApply") {
                // Extract the ControlNet name
                if let Some(cn_source) = get_source_id(graph, &current_id, "control_net") {
                    if let Some(cn_name) = trace_controlnet_name_valid(graph, &cn_source) {
                        let (category, _) =
                            crate::metadata::guidance::GuidanceClassifier::classify(&cn_name, None)
                                .unwrap_or((
                                    crate::metadata::guidance::GuidanceCategory::ControlNet,
                                    "other".to_string(),
                                ));

                        match category {
                            crate::metadata::guidance::GuidanceCategory::IPAdapter => {
                                if !ip_adapters.contains(&cn_name) {
                                    ip_adapters.push(cn_name);
                                }
                            }
                            _ => {
                                if !controlnets.contains(&cn_name) {
                                    controlnets.push(cn_name);
                                }
                            }
                        }
                    }
                }
                // Continue upstream via conditioning
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "positive",
                    strict_connections,
                ) {
                    queue.push_back(s);
                } else if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "conditioning",
                    strict_connections,
                ) {
                    queue.push_back(s);
                }
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "negative",
                    strict_connections,
                ) {
                    queue.push_back(s);
                }
                continue;
            }

            // combiners/splitters
            if t == "ConditioningCombine" || t == "ConditioningAverage" {
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "conditioning_1",
                    strict_connections,
                ) {
                    queue.push_back(s);
                }
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "conditioning_2",
                    strict_connections,
                ) {
                    queue.push_back(s);
                }
                continue;
            }
            if t == "ConditioningConcat" {
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "conditioning_to",
                    strict_connections,
                ) {
                    queue.push_back(s);
                }
                if let Some(s) = get_conditioning_source_id(
                    graph,
                    &current_id,
                    node,
                    "conditioning_from",
                    strict_connections,
                ) {
                    queue.push_back(s);
                }
                continue;
            }

            // General Pass-through
            let relevant_prefixes = ["conditioning", "positive", "cond", "c"];
            if let Some(resolved) = node.get("_resolved_inputs").and_then(|v| v.as_object()) {
                for (key, val) in resolved {
                    let input_lower = key.to_lowercase();
                    if relevant_prefixes.iter().any(|&r| input_lower.contains(r)) {
                        if input_name == "positive" && input_lower.contains("negative") {
                            continue;
                        }

                        if let Some(source_id) = val.as_str() {
                            queue.push_back(source_id.to_string());
                        } else if let Some(arr) = val.as_array() {
                            for item in arr {
                                if let Some(source_id) = item.as_str() {
                                    queue.push_back(source_id.to_string());
                                }
                            }
                        }
                    }
                }
            } else if let Some(inputs_obj) = node.get("inputs").and_then(|v| v.as_object()) {
                for (input_key, _input_val) in inputs_obj {
                    let input_lower = input_key.to_lowercase();
                    if relevant_prefixes.iter().any(|&r| input_lower.contains(r)) {
                        if input_name == "positive" && input_lower.contains("negative") {
                            continue;
                        }
                        if let Some(s) = get_conditioning_source_id(
                            graph,
                            &current_id,
                            node,
                            input_key,
                            strict_connections,
                        ) {
                            queue.push_back(s);
                        }
                    }
                }
            }
        }
    }
    controlnets
}

fn get_conditioning_source_id(
    graph: &ComfyGraph,
    node_id: &str,
    node: &Value,
    input_name: &str,
    strict_connections: bool,
) -> Option<String> {
    if strict_connections {
        get_strict_source_id(node, input_name)
    } else {
        get_source_id(graph, node_id, input_name)
    }
}

fn trace_controlnet_name_valid(graph: &ComfyGraph, node_id: &str) -> Option<String> {
    let mut current_id = node_id.to_string();
    for _ in 0..10 {
        if let Some(node) = graph.get_node(&current_id) {
            let t = get_node_type(node);
            if t == "ControlNetLoader" || t.contains("ControlNet Loader") {
                if let Some(name) =
                    get_node_param(node, "control_net_name").and_then(|v| v.as_str())
                {
                    return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(
                        name,
                    ));
                }
                if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
                    if let Some(s) = arr.first().and_then(|v| v.as_str()) {
                        return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(s));
                    }
                }
            }
            if let Some(s) = get_node_input_link(node, "control_net") {
                current_id = s;
                continue;
            }
        }
        break;
    }
    None
}

/// Extracts text from a node, executing simple string graph traversal if needed.
fn extract_text_from_node(
    graph: &ComfyGraph,
    node_id: &str,
    node: &Value,
    requested_input: &str,
    strict_connections: bool,
) -> Option<String> {
    let t = get_node_type(node);

    if t == "TextEncodeBooguEdit" {
        return (requested_input == "positive")
            .then(|| trace_text_input(graph, node_id, "prompt", true))
            .flatten();
    }

    // SDXL specific (if we want to combine them specifically)
    if t == "CLIPTextEncodeSDXL" {
        let mut parts = Vec::new();
        for input_name in ["text_g", "text_l"] {
            let text = trace_text_input(graph, node_id, input_name, strict_connections);
            if strict_connections
                && get_input_connection(node, input_name) != InputConnection::Unconnected
                && text.is_none()
            {
                return None;
            }
            if let Some(text) = text {
                parts.push(text);
            }
        }
        if !parts.is_empty() {
            return Some(parts.join(" . "));
        }
    }

    let mut visited = HashSet::new();
    evaluate_string_node_with_mode(
        graph,
        node_id,
        None,
        &mut visited,
        0,
        StringEvaluationMode::Prompt,
        strict_connections,
    )
}

fn trace_text_input(
    graph: &ComfyGraph,
    node_id: &str,
    input_name: &str,
    strict_connections: bool,
) -> Option<String> {
    trace_text_input_with_state(
        graph,
        node_id,
        input_name,
        &HashSet::new(),
        0,
        StringEvaluationMode::Prompt,
        strict_connections,
    )
}

// Recursive string evaluator
pub fn evaluate_string_node(
    graph: &ComfyGraph,
    node_id: &str,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<String> {
    evaluate_string_node_with_mode(
        graph,
        node_id,
        None,
        visited,
        depth,
        StringEvaluationMode::Prompt,
        false,
    )
}

pub(crate) fn evaluate_string_node_strict(
    graph: &ComfyGraph,
    node_id: &str,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<String> {
    evaluate_string_node_with_mode(
        graph,
        node_id,
        None,
        visited,
        depth,
        StringEvaluationMode::Prompt,
        true,
    )
}

pub(crate) fn evaluate_string_source_strict(
    graph: &ComfyGraph,
    source: &InputSource,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<String> {
    evaluate_string_source_with_mode(
        graph,
        source,
        visited,
        depth,
        StringEvaluationMode::TransformOperand,
        true,
    )
}

fn evaluate_string_node_with_mode(
    graph: &ComfyGraph,
    node_id: &str,
    output_slot: Option<usize>,
    visited: &mut HashSet<String>,
    depth: usize,
    mode: StringEvaluationMode,
    strict_connections: bool,
) -> Option<String> {
    if depth > 10 || !visited.insert(node_id.to_string()) {
        return None;
    }
    let node = graph.get_node(node_id)?;
    let t = get_node_type(node);

    if t == "CustomCombo" {
        return evaluate_custom_combo(
            graph,
            node,
            output_slot.unwrap_or(0),
            visited,
            depth,
            strict_connections,
        );
    }

    if strict_connections && t == "Reroute" {
        let source = get_reroute_input_source(node)?;
        return evaluate_string_source_with_mode(
            graph,
            &source,
            visited,
            depth + 1,
            mode,
            strict_connections,
        );
    }

    // Primitives / String Literals
    // Also include ImpactWildcardProcessor (populated_text) and Qwen (0/text)
    if t == "ImpactWildcardProcessor" {
        if let Some(text) = get_node_param(node, "populated_text").and_then(|v| v.as_str()) {
            if !is_placeholder_prompt_value(text) {
                return Some(text.to_string());
            }
        }
    }

    if t.contains("Qwen") || t.contains("LLM") {
        for input_name in ["0", "text", "prompt"] {
            match get_input_source(node, input_name) {
                InputSourceConnection::Connected(source) => {
                    return evaluate_string_source_with_mode(
                        graph,
                        &source,
                        visited,
                        depth + 1,
                        mode,
                        strict_connections,
                    );
                }
                InputSourceConnection::DeclaredUnresolved if strict_connections => return None,
                InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {}
            }
        }
        for input_name in ["0", "text", "prompt"] {
            if let Some(text) = get_node_param(node, input_name).and_then(|v| v.as_str()) {
                if !is_placeholder_prompt_value(text) {
                    return Some(text.to_string());
                }
            }
        }
        if let Some(text) = node
            .get("widgets_values")
            .and_then(Value::as_array)
            .and_then(|widgets| widgets.first())
            .and_then(Value::as_str)
        {
            if !is_placeholder_prompt_value(text) {
                return Some(text.to_string());
            }
        }
    }

    if t == "CLIPTextEncode" {
        return trace_text_input_with_state(
            graph,
            node_id,
            "text",
            visited,
            depth,
            mode,
            strict_connections,
        );
    }

    if t == "PrimitiveNode"
        || t == "String"
        || t.contains("StringLiteral")
        || t == "Text String"
        || t == "Text Multiline"
        || t == "PrimitiveString"
        || t == "PrimitiveStringMultiline"
        || t == "smZ CLIPTextEncode"
    {
        for input_name in ["value", "string", "String", "STRING", "VALUE", "text"] {
            match get_input_source(node, input_name) {
                InputSourceConnection::Connected(source) => {
                    return evaluate_string_source_with_mode(
                        graph,
                        &source,
                        visited,
                        depth + 1,
                        mode,
                        strict_connections,
                    );
                }
                InputSourceConnection::DeclaredUnresolved if strict_connections => return None,
                InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {}
            }
        }

        for input_name in ["value", "string", "String", "STRING", "text"] {
            if let Some(value) = get_node_param(node, input_name).and_then(Value::as_str) {
                if mode == StringEvaluationMode::TransformOperand
                    || !is_placeholder_prompt_value(value)
                {
                    return Some(value.to_string());
                }
            }
        }

        // UI Format: widgets_values. Transform operands are typed strings, so
        // their literal value is authoritative even when short or empty.
        if let Some(s) = node
            .get("widgets_values")
            .and_then(Value::as_array)
            .and_then(|values| values.first())
            .and_then(Value::as_str)
        {
            if mode == StringEvaluationMode::TransformOperand {
                return Some(s.to_string());
            }

            let lower = s.to_lowercase();
            let exclusions = [
                "enable",
                "disable",
                "randomize",
                "fixed",
                "increment",
                "decrement",
                "true",
                "false",
                "undefined",
                "null",
                "none",
            ];
            if !exclusions.contains(&lower.as_str())
                && !is_placeholder_prompt_value(s)
                && s.len() > 2
            {
                return Some(s.to_string());
            }
        }

        // Linked input fallback (e.g. PrimitiveString linked to another PrimitiveString or logic)
        if let Some(s) = trace_text_input_with_state(
            graph,
            node_id,
            "value",
            visited,
            depth,
            mode,
            strict_connections,
        ) {
            return Some(s);
        }
    }

    // Pass-throughs
    if t == "Text to String"
        || t == "Text Parse Noodle Soup Prompts"
        || t == "GetNode"
        || t == "SetNode"
    {
        let names = ["text", "string", "value", "STRING", "VALUE"];
        for n in names {
            match get_input_source(node, n) {
                InputSourceConnection::Connected(source) => {
                    if let Some(s) = evaluate_string_source_with_mode(
                        graph,
                        &source,
                        visited,
                        depth + 1,
                        mode,
                        strict_connections,
                    ) {
                        return Some(s);
                    }
                }
                InputSourceConnection::DeclaredUnresolved if strict_connections => return None,
                InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {}
            }
        }
        if strict_connections {
            return None;
        }
        for n in names {
            if let Some(val) = get_node_param(node, n) {
                if let Some(s) = val.as_str() {
                    if !is_placeholder_prompt_value(s) {
                        return Some(s.to_string());
                    }
                }
            }
        }
        return None;
    }

    if t == "ComfySwitchNode" {
        let branch = if strict_connections {
            get_switch_branch_input_strict(graph, node)
        } else {
            get_switch_branch_input(graph, node_id, node)
        };
        if let Some(branch) = branch {
            return trace_text_input_with_state(
                graph,
                node_id,
                branch,
                visited,
                depth,
                mode,
                strict_connections,
            );
        }
        return None;
    }

    if t == "PreviewAny" {
        return trace_text_input_with_state(
            graph,
            node_id,
            "source",
            visited,
            depth,
            mode,
            strict_connections,
        );
    }

    // JoinStringMulti
    if t == "JoinStringMulti" {
        let mut parts = Vec::new();
        // Check string_1..10
        for i in 1..=10 {
            let key = format!("string_{}", i);
            if let Some(s) = trace_text_input_with_state(
                graph,
                node_id,
                &key,
                visited,
                depth,
                mode,
                strict_connections,
            ) {
                parts.push(s);
            }
        }
        let delimiter = get_node_param(node, "delimiter")
            .and_then(|v| v.as_str())
            .unwrap_or(" ");
        return Some(parts.join(delimiter));
    }

    if t == "StringReplace" {
        let source = evaluate_transform_input(
            graph,
            node,
            "string",
            visited,
            depth,
            MAX_TRANSFORM_STRING_BYTES,
            None,
            strict_connections,
        )?;
        let find = evaluate_transform_input(
            graph,
            node,
            "find",
            visited,
            depth,
            MAX_TRANSFORM_PATTERN_BYTES,
            None,
            strict_connections,
        )?;
        let replacement = evaluate_transform_input(
            graph,
            node,
            "replace",
            visited,
            depth,
            MAX_TRANSFORM_STRING_BYTES,
            None,
            strict_connections,
        )?;
        return replace_string_bounded(&source, &find, &replacement);
    }

    if t == "JsonExtractString" {
        if !matches!(output_slot, None | Some(0)) {
            return None;
        }
        let json_string = evaluate_transform_input(
            graph,
            node,
            "json_string",
            visited,
            depth,
            MAX_TRANSFORM_STRING_BYTES,
            None,
            strict_connections,
        )?;
        let key = evaluate_transform_input(
            graph,
            node,
            "key",
            visited,
            depth,
            MAX_TRANSFORM_PATTERN_BYTES,
            None,
            strict_connections,
        )?;
        let parsed: Value = serde_json::from_str(&json_string).ok()?;
        let value = parsed.as_object()?.get(&key);
        let result = match value {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(value)) => value.clone(),
            Some(value) => serde_json::to_string(value).ok()?,
        };
        return (result.len() <= MAX_TRANSFORM_STRING_BYTES).then_some(result);
    }

    if t == "RegexExtract" {
        let source = evaluate_transform_input(
            graph,
            node,
            "string",
            visited,
            depth,
            MAX_TRANSFORM_STRING_BYTES,
            None,
            strict_connections,
        )?;
        let pattern = evaluate_transform_input(
            graph,
            node,
            "regex_pattern",
            visited,
            depth,
            MAX_TRANSFORM_PATTERN_BYTES,
            None,
            strict_connections,
        )?;
        let mode = get_node_param(node, "mode").and_then(Value::as_str)?;
        let case_insensitive = get_node_param(node, "case_insensitive").and_then(Value::as_bool)?;
        let multiline = get_node_param(node, "multiline").and_then(Value::as_bool)?;
        let dotall = get_node_param(node, "dotall").and_then(Value::as_bool)?;
        let group_index = get_node_param(node, "group_index").and_then(Value::as_u64)?;
        if mode != "First Group" || case_insensitive || multiline || dotall || group_index != 1 {
            return None;
        }

        let regex = Regex::new(&pattern).ok()?;
        let capture = regex.captures(&source)?.get(1)?.as_str();
        if capture.len() > MAX_TRANSFORM_STRING_BYTES {
            return None;
        }
        return Some(capture.to_string());
    }

    if t == "StringConcatenate" {
        let string_a = evaluate_transform_input(
            graph,
            node,
            "string_a",
            visited,
            depth,
            MAX_TRANSFORM_STRING_BYTES,
            Some(""),
            strict_connections,
        )?;
        let string_b = evaluate_transform_input(
            graph,
            node,
            "string_b",
            visited,
            depth,
            MAX_TRANSFORM_STRING_BYTES,
            Some(""),
            strict_connections,
        )?;
        let delimiter = evaluate_transform_input(
            graph,
            node,
            "delimiter",
            visited,
            depth,
            MAX_TRANSFORM_STRING_BYTES,
            Some(""),
            strict_connections,
        )?;
        if string_a.is_empty() {
            return Some(string_b);
        }
        if string_b.is_empty() {
            return Some(string_a);
        }
        let output_len = string_a
            .len()
            .checked_add(delimiter.len())?
            .checked_add(string_b.len())?;
        if output_len > MAX_TRANSFORM_STRING_BYTES {
            return None;
        }
        let mut output = String::with_capacity(output_len);
        output.push_str(&string_a);
        output.push_str(&delimiter);
        output.push_str(&string_b);
        return Some(output);
    }

    // Text Concatenate (WAS Node suite)
    if t == "Text Concatenate" {
        let text_a = trace_text_input_with_state(
            graph,
            node_id,
            "text_a",
            visited,
            depth,
            mode,
            strict_connections,
        )
        .unwrap_or_default();
        let text_b = trace_text_input_with_state(
            graph,
            node_id,
            "text_b",
            visited,
            depth,
            mode,
            strict_connections,
        )
        .unwrap_or_default();
        let linebreak_val = get_node_param(node, "linebreak_addition")
            .and_then(|v| v.as_str())
            .unwrap_or("false");
        let sep = if linebreak_val == "true" { "\n" } else { "" };
        return Some(format!("{}{}{}", text_a, sep, text_b));
    }

    // Concat Text _O (Custom node)
    if t == "Concat Text _O" {
        let text_a = trace_text_input_with_state(
            graph,
            node_id,
            "text1",
            visited,
            depth,
            mode,
            strict_connections,
        )
        .unwrap_or_default();
        let text_b = trace_text_input_with_state(
            graph,
            node_id,
            "text2",
            visited,
            depth,
            mode,
            strict_connections,
        )
        .unwrap_or_default();
        // Typically these are joined with a comma or space
        if text_a.is_empty() {
            return Some(text_b);
        }
        if text_b.is_empty() {
            return Some(text_a);
        }
        return Some(format!("{}, {}", text_a, text_b));
    }

    // TriggerWord Toggle (LoraManager)
    if t == "TriggerWord Toggle (LoraManager)" {
        if let Some(text) = trace_text_input_with_state(
            graph,
            node_id,
            "trigger_words",
            visited,
            depth,
            mode,
            strict_connections,
        ) {
            return Some(text);
        }
    }

    // Lora Loader (LoraManager) - Extract text/trigger words
    if t == "Lora Loader (LoraManager)" {
        let mut potential_lists = Vec::new();

        // 1. Try UI format (widgets_values[1])
        if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
            if let Some(list) = arr.get(1).and_then(|v| v.as_array()) {
                potential_lists.push(list);
            }
        }

        // 2. Try API format (inputs.loras.__value__)
        if let Some(loras_obj) = node.get("inputs").and_then(|v| v.get("loras")) {
            if let Some(list) = loras_obj.get("__value__").and_then(|v| v.as_array()) {
                potential_lists.push(list);
            }
        }

        // Collect all active LoRAs from all sources
        let mut found_structured_data = false;
        let mut all_active_loras = Vec::new();

        for list in potential_lists {
            found_structured_data = true;
            for lora in list {
                let active = lora.get("active").and_then(|v| v.as_bool()).unwrap_or(true);
                if active {
                    if let Some(name) = lora.get("name").and_then(|v| v.as_str()) {
                        let strength = lora
                            .get("strength")
                            .and_then(|v| {
                                if let Some(f) = v.as_f64() {
                                    Some(f)
                                } else if let Some(s) = v.as_str() {
                                    s.parse::<f64>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(1.0);
                        all_active_loras.push(format!("<lora:{}:{}>", name, strength));
                    }
                }
            }
        }

        if found_structured_data {
            return Some(all_active_loras.join(" "));
        }

        // Fallback or API format (if prompt chunk has text param)
        if let Some(text) = get_node_param(node, "text").and_then(|s| s.as_str()) {
            if !is_placeholder_prompt_value(text) {
                return Some(text.to_string());
            }
        }
        // Check widgets if param didn't catch it
        if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
            if let Some(s) = arr.first().and_then(|v| v.as_str()) {
                if !is_placeholder_prompt_value(s) {
                    return Some(s.to_string());
                }
            }
        }
    }

    // Fallback: check all common inputs for links, then widgets
    let names = ["text", "string", "value", "STRING", "VALUE"];
    for n in names {
        match get_input_source(node, n) {
            InputSourceConnection::Connected(source) => {
                if let Some(s) = evaluate_string_source_with_mode(
                    graph,
                    &source,
                    visited,
                    depth + 1,
                    mode,
                    strict_connections,
                ) {
                    return Some(s);
                }
            }
            InputSourceConnection::DeclaredUnresolved if strict_connections => return None,
            InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {}
        }
    }
    if strict_connections {
        return None;
    }
    for n in names {
        if let Some(val) = get_node_param(node, n) {
            if let Some(s) = val.as_str() {
                if !is_placeholder_prompt_value(s) {
                    return Some(s.to_string());
                }
            }
        }
    }

    None
}

fn evaluate_string_source_with_mode(
    graph: &ComfyGraph,
    source: &InputSource,
    visited: &mut HashSet<String>,
    depth: usize,
    mode: StringEvaluationMode,
    strict_connections: bool,
) -> Option<String> {
    evaluate_string_node_with_mode(
        graph,
        &source.node_id,
        source.output_slot,
        visited,
        depth,
        mode,
        strict_connections,
    )
}

fn get_reroute_input_source(node: &Value) -> Option<InputSource> {
    for key in ["", "value", "input", "any"] {
        match get_input_source(node, key) {
            InputSourceConnection::Connected(source) => return Some(source),
            InputSourceConnection::DeclaredUnresolved => return None,
            InputSourceConnection::Unconnected => {}
        }
    }
    None
}

fn evaluate_custom_combo(
    graph: &ComfyGraph,
    node: &Value,
    output_slot: usize,
    visited: &HashSet<String>,
    depth: usize,
    strict_connections: bool,
) -> Option<String> {
    if output_slot > 1 {
        return None;
    }

    let widgets = node.get("widgets_values").and_then(Value::as_array);
    let connection = get_input_source(node, "choice");
    let (selected, selected_from_widgets) = match connection {
        InputSourceConnection::Connected(source) => {
            let mut branch_visited = visited.clone();
            let selected = evaluate_string_source_with_mode(
                graph,
                &source,
                &mut branch_visited,
                depth + 1,
                StringEvaluationMode::TransformOperand,
                strict_connections,
            )?;
            (selected, false)
        }
        InputSourceConnection::DeclaredUnresolved => return None,
        InputSourceConnection::Unconnected => {
            if let Some(selected) = node
                .get("inputs")
                .and_then(Value::as_object)
                .and_then(|inputs| inputs.get("choice"))
                .and_then(Value::as_str)
            {
                (selected.to_string(), false)
            } else {
                let selected = widgets?.first()?.as_str()?.to_string();
                (selected, true)
            }
        }
    };

    if selected.len() > MAX_TRANSFORM_STRING_BYTES {
        return None;
    }
    if output_slot == 0 {
        return Some(selected);
    }

    let widgets = widgets?;
    let index = if selected_from_widgets {
        let index = widgets
            .get(1)?
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())?;
        let option = widgets.get(index.checked_add(2)?)?.as_str()?;
        (option == selected).then_some(index)?
    } else {
        let mut matches = widgets
            .iter()
            .skip(2)
            .enumerate()
            .filter_map(|(index, option)| (option.as_str()? == selected).then_some(index));
        let index = matches.next()?;
        if matches.next().is_some() {
            return None;
        }
        index
    };

    Some(index.to_string())
}

fn trace_text_input_with_state(
    graph: &ComfyGraph,
    node_id: &str,
    input_name: &str,
    visited: &HashSet<String>,
    depth: usize,
    mode: StringEvaluationMode,
    strict_connections: bool,
) -> Option<String> {
    let node = graph.get_node(node_id)?;
    match get_input_source(node, input_name) {
        InputSourceConnection::Connected(source) => {
            let mut branch_visited = visited.clone();
            evaluate_string_source_with_mode(
                graph,
                &source,
                &mut branch_visited,
                depth + 1,
                mode,
                strict_connections,
            )
        }
        InputSourceConnection::DeclaredUnresolved if strict_connections => None,
        InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {
            get_node_param(node, input_name)
                .and_then(Value::as_str)
                .filter(|value| !is_placeholder_prompt_value(value))
                .map(str::to_string)
        }
    }
}

fn evaluate_transform_input(
    graph: &ComfyGraph,
    node: &Value,
    key: &str,
    visited: &HashSet<String>,
    depth: usize,
    max_bytes: usize,
    default: Option<&str>,
    strict_connections: bool,
) -> Option<String> {
    let value = match get_input_source(node, key) {
        InputSourceConnection::Connected(source) => {
            let mut branch_visited = visited.clone();
            evaluate_string_source_with_mode(
                graph,
                &source,
                &mut branch_visited,
                depth + 1,
                StringEvaluationMode::TransformOperand,
                strict_connections,
            )?
        }
        InputSourceConnection::DeclaredUnresolved => return None,
        InputSourceConnection::Unconnected => {
            if let Some(value) = get_node_param(node, key).and_then(Value::as_str) {
                value.to_string()
            } else {
                default?.to_string()
            }
        }
    };

    (value.len() <= max_bytes).then_some(value)
}

fn replace_string_bounded(source: &str, find: &str, replacement: &str) -> Option<String> {
    if find.is_empty() {
        return None;
    }

    let matches = source.match_indices(find).count();
    let removed_bytes = matches.checked_mul(find.len())?;
    let added_bytes = matches.checked_mul(replacement.len())?;
    let output_len = source
        .len()
        .checked_sub(removed_bytes)?
        .checked_add(added_bytes)?;
    if output_len > MAX_TRANSFORM_STRING_BYTES {
        return None;
    }

    Some(source.replace(find, replacement))
}
