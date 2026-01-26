use super::graph::{ComfyGraph, get_node_type, get_node_input_link, get_node_param};
use super::heuristics::find_wireless_node;
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

            // 1. Found a Text Encode Node? Extract and Stop branch.
            if t.contains("CLIPTextEncode") || t.contains("TextEncode") { // Covers standard, SDXL, smZ, etc.
                 if let Some(text) = extract_text_from_node(graph, &current_id, node) {
                     if !text.trim().is_empty() {
                         prompts.push(text);
                     }
                 }
                 // We don't continue upstream from a TextEncode usually, it's the source.
                 continue;
            }

            // 2. Traversal Logic (Push upstream sources)
            
            // A. Known Splitters/Combiners
            if t == "ConditioningCombine" || t == "ConditioningAverage" {
                // Check conditioning_1, conditioning_2, etc. (often just 1 and 2)
                if let Some(s) = get_source_id(graph, &current_id, "conditioning_1") { queue.push_back(s); }
                if let Some(s) = get_source_id(graph, &current_id, "conditioning_2") { queue.push_back(s); }
                continue;
            }

            // B. Generic / Pass-through
            // We look for common input names that likely carry the conditioning signal upstream.
            let cond_inputs = ["conditioning", "positive", "negative", "cond", "c", "clip", "text_g", "text_l", "text"];
            
            // To be smart: only follow 'text' inputs if we are in a text-processing sub-chain?
            // Only follow 'clip' if we are in a text encoder? No, we perform that in extract_text.
            // Here we are flooding CONDITIONING.
            
            let relevant_inputs = ["conditioning", "positive", "negative"]; 
            
            for input in relevant_inputs {
                 if let Some(s) = get_source_id(graph, &current_id, input) {
                     queue.push_back(s);
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

    // SDXL specific
    if t == "CLIPTextEncodeSDXL" {
        let mut parts = Vec::new();
        if let Some(g) = trace_text_input(graph, node_id, "text_g") { parts.push(g); }
        if let Some(l) = trace_text_input(graph, node_id, "text_l") { parts.push(l); }
        if !parts.is_empty() { return Some(parts.join(" . ")); }
    }

    // Standard
    trace_text_input(graph, node_id, "text")
        .or_else(|| trace_text_input(graph, node_id, "text_g"))
        .or_else(|| trace_text_input(graph, node_id, "Text"))
}

fn trace_text_input(graph: &ComfyGraph, node_id: &str, input_name: &str) -> Option<String> {
    let node = graph.get_node(node_id)?;
    
    // 1. Direct Widget
    if let Some(val) = get_node_param(node, input_name) {
        if let Some(s) = val.as_str() { return Some(s.to_string()); }
    }
    
    // 2. Link
    if let Some(source_id) = get_source_id(graph, node_id, input_name) {
        return evaluate_string_node(graph, &source_id, 0);
    }
    None
}


// Recursive string evaluator
pub fn evaluate_string_node(graph: &ComfyGraph, node_id: &str, depth: usize) -> Option<String> {
    if depth > 10 { return None; }
    let node = graph.get_node(node_id)?;
    let t = get_node_type(node);

    // Primitives / String Literals
    if t == "PrimitiveNode" || t == "String" || t.contains("StringLiteral") {
         if let Some(v) = get_node_param(node, "value").and_then(|v| v.as_str()) { return Some(v.to_string()); }
         if let Some(v) = get_node_param(node, "string").and_then(|v| v.as_str()) { return Some(v.to_string()); }
         if let Some(v) = get_node_param(node, "String").and_then(|v| v.as_str()) { return Some(v.to_string()); }
         if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
             if let Some(s) = arr.get(0).and_then(|v| v.as_str()) { return Some(s.to_string()); }
         }
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
         let delimiter = get_node_param(node, "delimiter").and_then(|v| v.as_str()).unwrap_or(" ");
         return Some(parts.join(delimiter));
    }
    
    // Fallback: check "text" input
    trace_text_input(graph, node_id, "text")
        .or_else(|| trace_text_input(graph, node_id, "string"))
}


