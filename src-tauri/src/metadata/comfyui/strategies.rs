use super::conditioning::evaluate_string_node;
use super::graph::{get_node_param, get_node_title, get_node_type, ComfyGraph};
use super::parse_helper::parse_a1111_parameters;
use crate::metadata::guidance::GuidanceClassifier;
use crate::metadata::ImageMetadata;
use serde_json::Value;
use std::collections::HashSet;

/// Layer 2: Explicit Metadata Nodes
/// Scans for nodes specifically designed to embed metadata.
pub fn scan_explicit_nodes(graph: &ComfyGraph) -> Option<ImageMetadata> {
    let mut meta = ImageMetadata::default();
    let mut found = false;

    let mut nodes: Vec<(&String, &Value)> = graph.nodes().iter().collect();
    nodes.sort_by(|(left_id, _), (right_id, _)| {
        match (left_id.parse::<u64>(), right_id.parse::<u64>()) {
            (Ok(left), Ok(right)) => left.cmp(&right),
            _ => left_id.cmp(right_id),
        }
    });

    for (id, node) in nodes {
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
                meta.seed = Some(v);
                found = true;
            }
            if let Some(v) = get_node_param(node, "sampler")
                .or_else(|| get_node_param(node, "sampler_name"))
                .and_then(|v| v.as_str())
            {
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
                    meta.model = GuidanceClassifier::clean_name(v);
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
                let mut visited = HashSet::new();
                if let Some(text) = evaluate_string_node(graph, id, &mut visited, 0) {
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
                        let lower = text.to_lowercase();
                        if lower != "undefined" && lower != "null" && lower != "none" {
                            meta.positive_prompt = text;
                            found = true;
                        }
                    }
                }
            } else if title_lower.contains("negative") {
                let mut visited = HashSet::new();
                if let Some(text) = evaluate_string_node(graph, id, &mut visited, 0) {
                    meta.negative_prompt = text;
                    found = true;
                }
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
            if meta.seed.is_none() {
                if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) {
                    meta.seed = Some(v);
                } else if let Some(v) = get_node_param(node, "noise_seed").and_then(|v| v.as_i64())
                {
                    meta.seed = Some(v);
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
            let mut visited = HashSet::new();
            if let Some(text) = evaluate_string_node(graph, id, &mut visited, 0) {
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

                if is_negative {
                    if meta.negative_prompt.trim().is_empty() && text.trim().len() > 2 {
                        meta.negative_prompt = text;
                    }
                } else if meta.positive_prompt.trim().is_empty() {
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
                        let lower = text.to_lowercase();
                        if lower != "undefined" && lower != "null" && lower != "none" {
                            meta.positive_prompt = text;
                        }
                    }
                }
            }
        }
    }

    // Generic model discovery is fallback evidence only. Text metadata can be
    // more intentional than an arbitrary disconnected loader node.
    let mut model_nodes: Vec<(&String, &Value)> = graph.nodes().iter().collect();
    model_nodes.sort_by(|(left_id, _), (right_id, _)| {
        match (left_id.parse::<u64>(), right_id.parse::<u64>()) {
            (Ok(left), Ok(right)) => left.cmp(&right),
            _ => left_id.cmp(right_id),
        }
    });

    for (_id, node) in model_nodes {
        if meta.model != "Unknown" && !meta.model.is_empty() && meta.model != "None" {
            break;
        }

        let t_lower = get_node_type(node).to_lowercase();
        if is_auxiliary_model_node(&t_lower) {
            continue;
        }

        if let Some(model_name) = extract_model_from_node(node) {
            meta.model = model_name;
        }
    }

    meta
}

fn is_auxiliary_model_node(t_lower: &str) -> bool {
    // LoRAs, upscalers, detectors, and detailers often carry model-like filenames
    // but are not the primary checkpoint/diffusion model for the image.
    t_lower.contains("lora")
        || t_lower.contains("upscale")
        || t_lower.contains("detector")
        || t_lower.contains("segment")
        || t_lower.contains("samloader")
        || t_lower.contains("detailer")
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
            return Some(GuidanceClassifier::clean_name(n));
        }
    }
    None
}
