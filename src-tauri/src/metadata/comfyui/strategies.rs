use super::conditioning::evaluate_string_node;
use super::graph::{get_node_param, get_node_title, get_node_type, ComfyGraph};
use super::parse_helper::parse_a1111_parameters;
use crate::metadata::ImageMetadata;
use serde_json::Value;

/// Layer 2: Explicit Metadata Nodes
/// Scans for nodes specifically designed to embed metadata.
pub fn scan_explicit_nodes(graph: &ComfyGraph) -> Option<ImageMetadata> {
    let mut meta = ImageMetadata::default();
    let mut found = false;

    for (id, node) in graph.nodes() {
        let t = get_node_type(node);
        let t_lower = t.to_lowercase();

        // Skip routing nodes
        if t_lower == "setnode"
            || t_lower == "getnode"
            || t_lower == "reroute"
            || t_lower == "node reroute"
        {
            continue;
        }

        // SDParameterGenerator / Crystools
        if t == "SDParameterGenerator" || t.contains("Crystools") {
            // These nodes usually have widgets matching the standard keys
            if let Some(v) = get_node_param(node, "steps").and_then(|v| v.as_u64()) {
                meta.steps = v as u32;
                found = true;
            }
            if let Some(v) = get_node_param(node, "cfg").and_then(|v| v.as_f64()) {
                meta.cfg = v as f32;
                found = true;
            }
            if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) {
                meta.seed = v;
                found = true;
            }
            if let Some(v) = get_node_param(node, "sampler").and_then(|v| v.as_str()) {
                meta.sampler = v.to_string();
                found = true;
            }
            if let Some(v) = get_node_param(node, "scheduler").and_then(|v| v.as_str()) {
                if !meta.sampler.is_empty() {
                    meta.sampler = format!("{} ({})", meta.sampler, v);
                }
            }
            if let Some(v) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) {
                if v != "None" {
                    meta.model = v
                        .replace(".safetensors", "")
                        .replace(".ckpt", "")
                        .replace(".gguf", "");
                    found = true;
                }
            }
        }

        // ShowText / ShowAnything (Specific labels)
        // If user labeled a node "Positive", trust it?
        if let Some(title) = get_node_title(node) {
            let title_lower = title.to_lowercase();
            // let t_lower = t.to_lowercase(); // Already defined above

            if title_lower.contains("positive") {
                if let Some(text) = evaluate_string_node(graph, id, 0) {
                    // Check for A1111 parameter blob first
                    if text.contains("Steps:") && text.contains("Model:") {
                        // This is a parameter dump, NOT a positive prompt!
                        // Parse it for fallback metadata
                        let params = parse_a1111_parameters(&text);
                        meta.merge_if_missing(params);

                        // Try to rescue negative prompt from it
                        if let Some(neg_part) = text.split("Negative prompt:").nth(1) {
                            if let Some(end) = neg_part.find("Steps:") {
                                let neg_clean = neg_part[..end].trim();
                                if !neg_clean.is_empty() && meta.negative_prompt.is_empty() {
                                    meta.negative_prompt = neg_clean.to_string();
                                }
                            }
                        }
                    } else if !text.to_lowercase().starts_with("negative prompt:") {
                        meta.positive_prompt = text;
                        found = true;
                    }
                }
            } else if title_lower.contains("negative") {
                if let Some(text) = evaluate_string_node(graph, id, 0) {
                    meta.negative_prompt = text;
                    found = true;
                }
            }
        }

        // Try to extract model from any node that might have it
        if meta.model.is_empty() || meta.model == "Unknown" {
            // Skip LoRA nodes and other auxiliary models (upscalers, detectors, etc)
            // as they often contain "model-like" filenames but are not the main checkpoint
            if t_lower.contains("lora") 
                || t_lower.contains("upscale") 
                || t_lower.contains("detector")
                || t_lower.contains("segment")
                || t_lower.contains("samloader") // Specific to avoid ignoring "Sampler" which contains "sam"
                || t_lower.contains("detailer")
            {
                continue;
            }

            if let Some(model_name) = extract_model_from_node(node) {
                meta.model = model_name;
                found = true;
            }
        }
    }

    if found {
        Some(meta)
    } else {
        None
    }
}

/// Layer 4: Global Fallback Scan
/// Linear scan for when traversal fails.
pub fn global_scan(graph: &ComfyGraph) -> ImageMetadata {
    let mut meta = ImageMetadata::default();

    // Find ANY KSampler (Scanning)
    for (_id, node) in graph.nodes() {
        let t = get_node_type(node);
        if t.to_lowercase().contains("ksampler") {
            if meta.steps == 0 {
                if let Some(v) = get_node_param(node, "steps").and_then(|v| v.as_u64()) {
                    meta.steps = v as u32;
                }
            }
            if meta.cfg == 0.0 {
                if let Some(v) = get_node_param(node, "cfg").and_then(|v| v.as_f64()) {
                    meta.cfg = v as f32;
                }
            }
            if meta.seed == 0 {
                if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) {
                    meta.seed = v;
                } else if let Some(v) = get_node_param(node, "noise_seed").and_then(|v| v.as_i64())
                {
                    meta.seed = v;
                }
            }
        }
    }

    // Deterministic Text Scan
    let mut text_nodes: Vec<(&String, &Value)> = graph.nodes().iter().collect();
    text_nodes.sort_by_key(|(k, _)| *k); // Sort by ID

    for (id, node) in text_nodes {
        let t_lower = get_node_type(node).to_lowercase();

        let mut is_negative = false;
        if let Some(title) = get_node_title(node) {
            if title.to_lowercase().contains("negative") {
                is_negative = true;
            }
        }

        if t_lower == "string"
            || t_lower == "primitivenode"
            || t_lower == "showtext"
            || t_lower == "note"
            || t_lower.contains("cliptextencode")
            || t_lower.contains("showanything")
        {
            if is_negative {
                if meta.negative_prompt.trim().is_empty() {
                    if let Some(text) = evaluate_string_node(graph, id, 0) {
                        if text.trim().len() > 2 {
                            meta.negative_prompt = text;
                        }
                    }
                }
            } else if meta.positive_prompt.trim().is_empty() {
                if let Some(text) = evaluate_string_node(graph, id, 0) {
                    // Check for A1111 parameter blob
                    if text.contains("Steps:") && text.contains("Sampler:") {
                        // Parse A1111 style parameters
                        let params = parse_a1111_parameters(&text);
                        meta.merge_if_missing(params);

                        // Also check if it has "Negative prompt:" prefix to set negative
                        if let Some(neg_part) = text.split("Negative prompt:").nth(1) {
                            if let Some(end) = neg_part.find("Steps:") {
                                let neg_clean = neg_part[..end].trim();
                                if !neg_clean.is_empty() && meta.negative_prompt.is_empty() {
                                    meta.negative_prompt = neg_clean.to_string();
                                }
                            }
                        }
                        // IMPORTANT: Do NOT set this huge blob as positive prompt
                        continue;
                    }

                    // Heuristic: If text starts with "negative", treat as negative
                    if text.to_lowercase().starts_with("negative prompt:") {
                        if meta.negative_prompt.trim().is_empty() && text.trim().len() > 2 {
                            meta.negative_prompt = text;
                        }
                    } else if text.to_lowercase().starts_with("negative") {
                        if meta.negative_prompt.trim().is_empty() && text.trim().len() > 2 {
                            meta.negative_prompt = text;
                        }
                    } else if text.trim().len() > 2 {
                        meta.positive_prompt = text;
                    }
                }
            }
        }
    }

    meta
}

fn extract_model_from_node(node: &Value) -> Option<String> {
    let mut name = None;
    if let Some(n) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) {
        name = Some(n);
    } else if let Some(n) = get_node_param(node, "unet_name").and_then(|v| v.as_str()) {
        name = Some(n);
    } else if let Some(n) = get_node_param(node, "model_name").and_then(|v| v.as_str()) {
        name = Some(n);
    } else if let Some(n) = get_node_param(node, "checkpoint").and_then(|v| v.as_str()) {
        name = Some(n);
    }

    if let Some(n) = name {
        if n != "None" && n != "null" {
            return Some(
                n.replace(".safetensors", "")
                    .replace(".ckpt", "")
                    .replace(".gguf", ""),
            );
        }
    }
    None
}
