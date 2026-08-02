use super::graph::{
    get_input_source, get_input_source_by_slot, get_node_type, ComfyGraph, InputSourceConnection,
};
use serde_json::Value;

pub(crate) fn is_primary_model_loader_type(node_type: &str) -> bool {
    let node_type = node_type.to_ascii_lowercase();
    node_type.contains("checkpointloader")
        || node_type.contains("unetloader")
        || node_type.contains("ckpt loader")
        || node_type.contains("easyloader")
}

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

    if needed_type == "CONDITIONING" {
        let prompt_everywhere: Vec<&Value> = graph
            .broadcasters
            .iter()
            .filter_map(|id| graph.get_node(id))
            .filter(|node| get_node_type(node) == "Prompts Everywhere")
            .filter(|node| !is_disabled(node))
            .collect();
        if !prompt_everywhere.is_empty() {
            let mut sources = Vec::new();
            for node in prompt_everywhere {
                let InputSourceConnection::Connected(source) =
                    get_prompts_everywhere_source(node, input_name)
                else {
                    return None;
                };
                if !sources.contains(&source.node_id) {
                    sources.push(source.node_id);
                }
            }
            return (sources.len() == 1).then(|| sources.remove(0));
        }
    }

    // Heuristic: Scan for "Sender" nodes that output this type
    for id in &graph.broadcasters {
        let node = match graph.get_node(id) {
            Some(n) => n,
            None => continue,
        };
        let t = get_node_type(node);
        if is_disabled(node) {
            continue;
        }

        if (needed_type == "MODEL" || needed_type == "VAE" || needed_type == "CLIP")
            && t.contains("Checkpoints")
        {
            return Some(id.clone());
        }
        if needed_type != "CONDITIONING"
            && (t.contains("Everything") || t.contains("Anything Everywhere"))
        {
            return Some(id.clone());
        }
    }

    // Specific Case: Model/VAE missing -> Find the main CheckpointLoader
    // If there is exactly ONE checkpoint loader, assume it's the wireless source.
    if needed_type == "MODEL" || needed_type == "VAE" || needed_type == "CLIP" {
        let mut candidates = Vec::new();
        for (id, node) in graph.nodes() {
            let t = get_node_type(node);
            let is_candidate = if needed_type == "MODEL" {
                is_primary_model_loader_type(t)
            } else {
                t == "CheckpointLoaderSimple" || t == "CheckpointLoader" || t == "UNETLoader"
            };
            if !is_disabled(node) && is_candidate {
                candidates.push(id.clone());
            }
        }
        if candidates.len() == 1 {
            return Some(candidates[0].clone());
        }
        if needed_type == "MODEL" {
            return None;
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
        let mut titled_matches = Vec::new();
        for (id, node) in graph.nodes() {
            if is_disabled(node) {
                continue;
            }
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
                    titled_matches.push(id.clone());
                }
            }
            if input_name == "negative" && title_lower.contains("negative") {
                if t.contains("CLIPTextEncode") {
                    titled_matches.push(id.clone());
                }
            }
        }
        titled_matches.sort();
        titled_matches.dedup();
        if titled_matches.len() == 1 {
            return titled_matches.pop();
        }
        if titled_matches.len() > 1 {
            return None;
        }

        let mut generic_matches: Vec<String> = graph
            .broadcasters
            .iter()
            .filter_map(|id| graph.get_node(id).map(|node| (id, node)))
            .filter(|(_, node)| !is_disabled(node))
            .filter(|(_, node)| {
                let node_type = get_node_type(node);
                node_type.contains("Anything Everywhere")
                    || node_type.contains("Everything Everywhere")
            })
            .map(|(id, _)| id.clone())
            .collect();
        generic_matches.dedup();
        if generic_matches.len() == 1 {
            return generic_matches.pop();
        }
    }

    None
}

pub(crate) fn get_prompts_everywhere_source(
    node: &Value,
    prompt_role: &str,
) -> InputSourceConnection {
    if get_node_type(node) != "Prompts Everywhere" || is_disabled(node) {
        return InputSourceConnection::Unconnected;
    }

    if node.get("inputs").is_some_and(Value::is_array) {
        return match prompt_role {
            "positive" | "conditioning" => get_input_source_by_slot(node, 0),
            "negative" => get_input_source_by_slot(node, 1),
            _ => InputSourceConnection::Unconnected,
        };
    }

    let names: &[&str] = match prompt_role {
        "positive" | "conditioning" => &["positive", "prompt"],
        "negative" => &["negative", "neg"],
        _ => return InputSourceConnection::Unconnected,
    };
    for name in names {
        match get_input_source(node, name) {
            InputSourceConnection::Unconnected => {}
            connection => return connection,
        }
    }
    InputSourceConnection::Unconnected
}

fn is_disabled(node: &Value) -> bool {
    matches!(node.get("mode").and_then(Value::as_i64), Some(2 | 4))
}
