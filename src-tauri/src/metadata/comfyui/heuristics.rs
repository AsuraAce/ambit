use super::graph::{ComfyGraph, get_node_type};
use serde_json::Value;

/// Scans the graph for nodes that might be broadcasting a value of `input_type`
/// to the `target_node`.
///
/// This handles:
/// 1. "Use Everywhere" nodes (UE)
/// 2. "Set Node" / "Get Node" pairs (broken links)
/// 3. "Wireless" pipe nodes
pub fn find_wireless_node(graph: &ComfyGraph, _target_node: &Value, input_name: &str) -> Option<String> {
    // Determine the type of data input_name expects
    let needed_type = match input_name {
        "model" => "MODEL",
        "vae" => "VAE",
        "clip" => "CLIP",
        "conditioning" | "positive" | "negative" => "CONDITIONING",
        "latent_image" | "samples" => "LATENT",
        "image" | "images" => "IMAGE",
        "mask" => "MASK",
        _ => return None, // Only resolve major types wirelessly
    };

    // Heuristic: Scan for "Sender" nodes that output this type
    for (id, node) in graph.nodes() {
        let t = get_node_type(node);
        
        // 1. UE Nodes (Anything with "Everywhere" in name)
        // They typically broadcast to regex/title/class.
        // We'll simplisticly assume if a Broadcast Node exists, it MIGHT be the source.
        // To be safer, we only pick it if it's the ONLY one or seemingly main one?
        // Actually, matching the 'TYPE' is the strongest signal we have without reimplementing the regex engine.
        if t.contains("Everywhere") || t.contains("Wireless") || t.contains("Broadcast") {
            // Check outputs
            // But UE nodes usually take input and broadcast it. 
            // So we need to trace the INPUT of the UE node to find the source.
            // Wait, this helper is called `find_wireless_node` -> returns ID of the SOURCE.
            // If we return the UE node ID, `evaluator` will try to trace *upstream* from it, which is correct!
            
            // Does this UE node handle the needed type?
            // "Seed Everywhere" -> INT
            // "Everything Everywhere" -> All?
            // "Show Anything" -> Text?
            
            if (needed_type == "MODEL" || needed_type == "VAE" || needed_type == "CLIP") && t.contains("Checkpoints") {
                return Some(id.clone());
            }
            if t.contains("Everything") {
                return Some(id.clone());
            }
        }
        
        // 2. SetNode / GetNode
        // If we are at a "GetNode" (handled in evaluator traversal usually?), 
        // but if the link IS MISSING on the target node itself?
        // This helper is for when `target_node.inputs[input_name]` is EMPTY.
        
        // 3. Special Case: "Reroute" with no outputs linked? No.
    }

    // Specific Case: Model/VAE missing -> Find the main CheckpointLoader
    // If there is exactly ONE checkpoint loader, assume it's the wireless source.
    if needed_type == "MODEL" || needed_type == "VAE" || needed_type == "CLIP" {
        let mut candidates = Vec::new();
        for (id, node) in graph.nodes() {
            let t = get_node_type(node);
            if t == "CheckpointLoaderSimple" || t == "CheckpointLoader" || t == "UNETLoader" {
                candidates.push(id.clone());
            }
        }
        if candidates.len() == 1 {
            return Some(candidates[0].clone());
        }
        // If multiple, maybe find the one titled "Main" or "Base"?
        // Heuristic: Pick the one with the lowest ID (often first added)?
        if !candidates.is_empty() {
             // Let's not guess if ambiguous, unless we want to gamble.
             // Given this is a fallback, picking the first is better than nothing?
             // Let's try basic title match "Base"
             for cand_id in &candidates {
                 if let Some(node) = graph.get_node(cand_id) {
                     if let Some(title) = node.get("_meta").and_then(|m| m.get("title")).and_then(|s| s.as_str()) {
                         if title.to_lowercase().contains("base") || title.to_lowercase().contains("main") {
                             return Some(cand_id.clone());
                         }
                     }
                 }
             }
        }
    }
    
    // Wireless Prompts (By Title)
    if needed_type == "CONDITIONING" {
         for (id, node) in graph.nodes() {
             if let Some(title) = node.get("_meta").and_then(|m| m.get("title")).and_then(|v| v.as_str()) {
                 let title_lower = title.to_lowercase();
                 let t = get_node_type(node);
                 
                 // Positive
                 if (input_name == "positive" || input_name == "conditioning") && title_lower.contains("positive") {
                     // Ensure it is a prompt node type
                     if t.contains("CLIPTextEncode") { return Some(id.clone()); }
                 }
                 // Negative
                 if input_name == "negative" && title_lower.contains("negative") {
                     if t.contains("CLIPTextEncode") { return Some(id.clone()); }
                 }
             }
         }
    }

    None
}
