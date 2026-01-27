use super::graph::{get_node_input_link, get_node_param, get_node_type, ComfyGraph};
use super::heuristics::find_wireless_node;
use super::parse_helper::parse_a1111_parameters;
use serde_json::Value;
use std::collections::{HashSet, VecDeque};

/// Finds all prompts reachable from the given start node (usually KSampler) by traversing
/// upstream "conditioning" inputs using Breadth-First Search (BFS).
///
/// This resolves complex graphs where prompts are effectively hidden behind:
/// - Branching (ConditioningCombine)
/// - Pass-through nodes (ControlNet, SetArea)
/// - Unknown custom nodes (by heuristically following 'conditioning' inputs)
pub fn find_reachable_prompts(graph: &ComfyGraph, start_node_id: &str, input_name: &str) -> String {
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    let mut prompts = Vec::new();

    // Initial push: Get source of the KSampler's conditioning input
    if let Some(source_id) = get_source_id(graph, start_node_id, input_name) {
        queue.push_back(source_id);
    }

    while let Some(current_id) = queue.pop_front() {
        if !visited.insert(current_id.clone()) {
            continue;
        }

        if let Some(node) = graph.get_node(&current_id) {
            let t = get_node_type(node);
            let t_lower = t.to_lowercase();

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
                if let Some(text) = extract_text_from_node(graph, &current_id, node) {
                    if !text.trim().is_empty() {
                        // Filter out A1111 parameter blobs (containing Steps/Model)
                        if text.contains("Steps:")
                            && (text.contains("Model:") || text.contains("Sampler:"))
                        {
                            // Try to rescue the positive prompt part if it exists before the blob
                            let parsed = parse_a1111_parameters(&text);
                            if !parsed.positive_prompt.trim().is_empty() {
                                prompts.push(parsed.positive_prompt);
                            }
                            continue;
                        }
                        // Filter out explicit separate labels if misplaced
                        if input_name == "positive"
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
                if let Some(s) = get_source_id(graph, &current_id, "conditioning_1") {
                    queue.push_back(s);
                }
                if let Some(s) = get_source_id(graph, &current_id, "conditioning_2") {
                    queue.push_back(s);
                }
                continue;
            }

            // C. ConditioningConcat
            if t == "ConditioningConcat" {
                if let Some(s) = get_source_id(graph, &current_id, "conditioning_to") {
                    queue.push_back(s);
                }
                if let Some(s) = get_source_id(graph, &current_id, "conditioning_from") {
                    queue.push_back(s);
                }
                continue;
            }

            // B. Generic / Pass-through
            // We look for common input names that likely carry the conditioning signal upstream.
            // "Text to Conditioning" nodes take 'text' and 'clip' => output conditioning.
            // So we MUST follow 'text'.
            if t == "Text to Conditioning" {
                if let Some(s) = get_source_id(graph, &current_id, "text") {
                    queue.push_back(s);
                }
                continue;
            }

            // Trace upstream
            let relevant_prefixes = [
                "conditioning",
                "positive",
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
                    if let Some(source_id) = val.as_str() {
                        let input_lower = key.to_lowercase();
                        if relevant_prefixes.iter().any(|&r| input_lower.contains(r)) {
                            if input_name == "positive" && input_lower.contains("negative") {
                                continue;
                            }
                            queue.push_back(source_id.to_string());
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

                    if is_relevant_prefix {
                        if input_name == "positive" && is_negative_input {
                            continue;
                        }
                        if let Some(s) = get_source_id(graph, &current_id, input_key) {
                            queue.push_back(s);
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
                            if input_name == "positive" && input_lower.contains("negative") {
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

    // Dedup and join
    prompts.dedup();
    prompts.join(", ")
}

/// Helper to resolve links (including wireless)
fn get_source_id(graph: &ComfyGraph, node_id: &str, input_name: &str) -> Option<String> {
    if let Some(node) = graph.get_node(node_id) {
        if let Some(link) = get_node_input_link(node, input_name) {
            return Some(link);
        }
        // Wireless fallback
        if let Some(wireless) = find_wireless_node(graph, node, input_name) {
            return Some(wireless);
        }
    }
    None
}

/// Extracts text from a node, executing simple string graph traversal if needed.
fn extract_text_from_node(graph: &ComfyGraph, node_id: &str, node: &Value) -> Option<String> {
    let t = get_node_type(node);

    // SDXL specific (if we want to combine them specifically)
    if t == "CLIPTextEncodeSDXL" {
        let mut parts = Vec::new();
        if let Some(g) = trace_text_input(graph, node_id, "text_g") {
            parts.push(g);
        }
        if let Some(l) = trace_text_input(graph, node_id, "text_l") {
            parts.push(l);
        }
        if !parts.is_empty() {
            return Some(parts.join(" . "));
        }
    }

    evaluate_string_node(graph, node_id, 0)
}

fn trace_text_input(graph: &ComfyGraph, node_id: &str, input_name: &str) -> Option<String> {
    let node = graph.get_node(node_id)?;

    // 1. Direct Widget
    if let Some(val) = get_node_param(node, input_name) {
        if let Some(s) = val.as_str() {
            return Some(s.to_string());
        }
    }

    // 2. Link
    if let Some(source_id) = get_source_id(graph, node_id, input_name) {
        return evaluate_string_node(graph, &source_id, 0);
    }
    None
}

// Recursive string evaluator
pub fn evaluate_string_node(graph: &ComfyGraph, node_id: &str, depth: usize) -> Option<String> {
    if depth > 10 {
        return None;
    }
    let node = graph.get_node(node_id)?;
    let t = get_node_type(node);

    // Primitives / String Literals
    // Also include ImpactWildcardProcessor (populated_text) and Qwen (0/text)
    if t == "ImpactWildcardProcessor" {
        if let Some(text) = get_node_param(node, "populated_text").and_then(|v| v.as_str()) {
            return Some(text.to_string());
        }
    }

    if t.contains("Qwen") || t.contains("LLM") {
        if let Some(text) = get_node_param(node, "0").and_then(|v| v.as_str()) {
            return Some(text.to_string());
        }
        if let Some(text) = get_node_param(node, "text").and_then(|v| v.as_str()) {
            return Some(text.to_string());
        }
        if let Some(text) = get_node_param(node, "prompt").and_then(|v| v.as_str()) {
            return Some(text.to_string());
        }
    }

    if t == "PrimitiveNode"
        || t == "String"
        || t.contains("StringLiteral")
        || t == "Text String"
        || t == "Text Multiline"
        || t == "PrimitiveString"
        || t == "PrimitiveStringMultiline"
    {
        if let Some(v) = get_node_param(node, "value").and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
        if let Some(v) = get_node_param(node, "string").and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
        if let Some(v) = get_node_param(node, "String").and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
        if let Some(v) = get_node_param(node, "STRING").and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }
        if let Some(v) = get_node_param(node, "text").and_then(|v| v.as_str()) {
            return Some(v.to_string());
        }

        // UI Format: widgets_values
        if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
            if let Some(s) = arr.first().and_then(|v| v.as_str()) {
                return Some(s.to_string());
            }
        }

        // Linked input fallback (e.g. PrimitiveString linked to another PrimitiveString or logic)
        if let Some(s) = trace_text_input(graph, node_id, "value") {
            return Some(s);
        }
    }

    // Pass-throughs
    if t == "Text to String" || t == "Text Parse Noodle Soup Prompts" {
        return trace_text_input(graph, node_id, "text");
    }

    // JoinStringMulti
    if t == "JoinStringMulti" {
        let mut parts = Vec::new();
        // Check string_1..10
        for i in 1..=10 {
            let key = format!("string_{}", i);
            if let Some(s) = trace_text_input(graph, node_id, &key) {
                parts.push(s);
            }
        }
        let delimiter = get_node_param(node, "delimiter")
            .and_then(|v| v.as_str())
            .unwrap_or(" ");
        return Some(parts.join(delimiter));
    }

    // Text Concatenate (WAS Node suite)
    if t == "Text Concatenate" {
        let text_a = trace_text_input(graph, node_id, "text_a").unwrap_or_default();
        let text_b = trace_text_input(graph, node_id, "text_b").unwrap_or_default();
        let linebreak_val = get_node_param(node, "linebreak_addition")
            .and_then(|v| v.as_str())
            .unwrap_or("false");
        let sep = if linebreak_val == "true" { "\n" } else { "" };
        return Some(format!("{}{}{}", text_a, sep, text_b));
    }

    // TriggerWord Toggle (LoraManager)
    if t == "TriggerWord Toggle (LoraManager)" {
        if let Some(text) = trace_text_input(graph, node_id, "trigger_words") {
            return Some(text);
        }
    }

    // Lora Loader (LoraManager) - Extract text/trigger words
    if t == "Lora Loader (LoraManager)" {
        if let Some(text) = get_node_param(node, "text").and_then(|s| s.as_str()) {
            return Some(text.to_string());
        }
        // Check widgets if param didn't catch it
        if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
            if let Some(s) = arr.first().and_then(|v| v.as_str()) {
                return Some(s.to_string());
            }
        }
    }

    // Fallback: check "text" input
    trace_text_input(graph, node_id, "text").or_else(|| trace_text_input(graph, node_id, "string"))
}
