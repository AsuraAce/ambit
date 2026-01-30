use super::graph::{get_node_type, ComfyGraph};
use serde_json::Value;

/// Scans the graph for nodes that might be broadcasting a value of `input_type`
/// to the `target_node`.
///
/// This handles:
/// 1. "Use Everywhere" nodes (UE)
/// 2. "Set Node" / "Get Node" pairs (broken links)
/// 3. "Wireless" pipe nodes
pub fn find_wireless_node(
    graph: &ComfyGraph,
    _target_node: &Value,
    input_name: &str,
) -> Option<String> {
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
    for id in &graph.broadcasters {
        let node = match graph.get_node(id) {
            Some(n) => n,
            None => continue,
        };
        let t = get_node_type(node);

        if (needed_type == "MODEL" || needed_type == "VAE" || needed_type == "CLIP")
            && t.contains("Checkpoints")
        {
            return Some(id.clone());
        }
        if t.contains("Everything") || t.contains("Anything Everywhere") {
            return Some(id.clone());
        }
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
                    if let Some(title) = node
                        .get("_meta")
                        .and_then(|m| m.get("title"))
                        .and_then(|s| s.as_str())
                    {
                        if title.to_lowercase().contains("base")
                            || title.to_lowercase().contains("main")
                        {
                            return Some(cand_id.clone());
                        }
                    }
                }
            }
        }
    }

    // Wireless Prompts (By Title or Broadcaster)
    if needed_type == "CONDITIONING" {
        let mut best_match = None;
        for (id, node) in graph.nodes() {
            let t = get_node_type(node);
            let title = node
                .get("_meta")
                .and_then(|m| m.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title_lower = title.to_lowercase();

            // 1. Explicitly Titled Prompt Node (Strongest Match)
            if (input_name == "positive" || input_name == "conditioning")
                && title_lower.contains("positive")
            {
                if t.contains("CLIPTextEncode") {
                    return Some(id.clone());
                }
            }
            if input_name == "negative" && title_lower.contains("negative") {
                if t.contains("CLIPTextEncode") {
                    return Some(id.clone());
                }
            }

            // 2. Broadcaster Nodes (Fallback)
            if t == "Prompts Everywhere" || t.contains("Anything Everywhere") || t.contains("Everything Everywhere") {
                best_match = Some(id.clone());
            }
        }

        // Also check broadcasters for best_match fallback if not found by title
        if best_match.is_none() {
            for id in &graph.broadcasters {
                if let Some(node) = graph.get_node(id) {
                    let t = get_node_type(node);
                    if t == "Prompts Everywhere" || t.contains("Anything Everywhere") || t.contains("Everything Everywhere") {
                        best_match = Some(id.clone());
                    }
                }
            }
        }
        if best_match.is_some() {
            return best_match;
        }
    }

    None
}
