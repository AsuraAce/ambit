use super::conditioning::evaluate_string_node;
use super::diagnostics::{ComfyFieldSourceNodeIds, ComfyMetadataField};
use super::graph::{compare_node_ids, get_node_param, get_node_title, get_node_type, ComfyGraph};
use super::parse_helper::parse_a1111_parameters;
use crate::metadata::guidance::GuidanceClassifier;
use crate::metadata::{is_missing_prompt_value, ImageMetadata};
use serde_json::Value;
use std::collections::HashSet;

/// Layer 2: Explicit Metadata Nodes
/// Scans for nodes specifically designed to embed metadata.
pub fn scan_explicit_nodes(graph: &ComfyGraph) -> Option<(ImageMetadata, ComfyFieldSourceNodeIds)> {
    let mut meta = ImageMetadata::default();
    let mut source_node_ids = ComfyFieldSourceNodeIds::new();
    let mut found = false;

    let mut nodes: Vec<(&String, &Value)> = graph.nodes().iter().collect();
    nodes.sort_by(|(left_id, _), (right_id, _)| compare_node_ids(left_id, right_id));

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
                record_core_source(&mut source_node_ids, ComfyMetadataField::Steps, id);
                found = true;
            }
            if let Some(v) = get_node_param(node, "cfg").and_then(|v| v.as_f64()) {
                meta.cfg = v as f32;
                record_core_source(&mut source_node_ids, ComfyMetadataField::Cfg, id);
                found = true;
            }
            if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) {
                meta.seed = Some(v);
                record_core_source(&mut source_node_ids, ComfyMetadataField::Seed, id);
                found = true;
            }
            if let Some(v) = get_node_param(node, "sampler")
                .or_else(|| get_node_param(node, "sampler_name"))
                .and_then(|v| v.as_str())
            {
                meta.sampler = v.to_string();
                record_core_source(&mut source_node_ids, ComfyMetadataField::Sampler, id);
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
                    record_core_source(&mut source_node_ids, ComfyMetadataField::Model, id);
                    found = true;
                }
            }
        }

        // ShowText / ShowAnything (Specific labels)
        // If user labeled a node "Positive", trust it?
        // Standard conditioning encoders describe graph data, not intentional
        // metadata overrides, even when their UI title says Positive/Negative.
        if !t_lower.contains("textencode") {
            let Some(title) = get_node_title(node) else {
                continue;
            };
            let title_lower = title.to_lowercase();

            if title_lower.contains("positive") {
                let mut visited = HashSet::new();
                if let Some(text) = evaluate_string_node(graph, id, &mut visited, 0) {
                    // Check for A1111 parameter blob first
                    if text.contains("Steps:") && text.contains("Model:") {
                        // This is a parameter dump, NOT a positive prompt!
                        // Parse it for fallback metadata
                        let before = CoreFieldPresence::from_metadata(&meta);
                        let params = parse_a1111_parameters(&text);
                        meta.merge_if_missing(params);
                        record_filled_core_sources(&before, &meta, id, &mut source_node_ids);

                        // Try to rescue negative prompt from it
                        if let Some(neg_part) = text.split("Negative prompt:").nth(1) {
                            if let Some(end) = neg_part.find("Steps:") {
                                let neg_clean = neg_part[..end].trim();
                                if !is_missing_prompt_value(neg_clean)
                                    && meta.negative_prompt.is_empty()
                                {
                                    meta.negative_prompt = neg_clean.to_string();
                                    record_core_source(
                                        &mut source_node_ids,
                                        ComfyMetadataField::NegativePrompt,
                                        id,
                                    );
                                }
                            }
                        }
                    } else if !text.to_lowercase().starts_with("negative prompt:") {
                        if !is_missing_prompt_value(&text) {
                            meta.positive_prompt = text;
                            record_core_source(
                                &mut source_node_ids,
                                ComfyMetadataField::PositivePrompt,
                                id,
                            );
                            found = true;
                        }
                    }
                }
            } else if title_lower.contains("negative") {
                let mut visited = HashSet::new();
                if let Some(text) = evaluate_string_node(graph, id, &mut visited, 0) {
                    if !is_missing_prompt_value(&text) {
                        meta.negative_prompt = text;
                        record_core_source(
                            &mut source_node_ids,
                            ComfyMetadataField::NegativePrompt,
                            id,
                        );
                        found = true;
                    }
                }
            }
        }
    }

    if found {
        Some((meta, source_node_ids))
    } else {
        None
    }
}

/// Layer 4: Global Fallback Scan
/// Linear scan for when traversal fails.
pub fn global_scan(graph: &ComfyGraph) -> (ImageMetadata, ComfyFieldSourceNodeIds) {
    let mut meta = ImageMetadata::default();
    let mut source_node_ids = ComfyFieldSourceNodeIds::new();

    // Find ANY KSampler (Scanning)
    for (id, node) in graph.nodes() {
        let t = get_node_type(node);
        if t.to_lowercase().contains("ksampler") {
            if meta.steps == 0 {
                if let Some(v) = get_node_param(node, "steps").and_then(|v| v.as_u64()) {
                    meta.steps = v as u32;
                    record_core_source(&mut source_node_ids, ComfyMetadataField::Steps, id);
                }
            }
            if meta.cfg == 0.0 {
                if let Some(v) = get_node_param(node, "cfg").and_then(|v| v.as_f64()) {
                    meta.cfg = v as f32;
                    record_core_source(&mut source_node_ids, ComfyMetadataField::Cfg, id);
                }
            }
            if meta.seed.is_none() {
                if let Some(v) = get_node_param(node, "seed").and_then(|v| v.as_i64()) {
                    meta.seed = Some(v);
                    record_core_source(&mut source_node_ids, ComfyMetadataField::Seed, id);
                } else if let Some(v) = get_node_param(node, "noise_seed").and_then(|v| v.as_i64())
                {
                    meta.seed = Some(v);
                    record_core_source(&mut source_node_ids, ComfyMetadataField::Seed, id);
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
                    let before = CoreFieldPresence::from_metadata(&meta);
                    let params = parse_a1111_parameters(&text);
                    meta.merge_if_missing(params);
                    record_filled_core_sources(&before, &meta, id, &mut source_node_ids);

                    // Also check if it has "Negative prompt:" prefix to set negative
                    if let Some(neg_part) = text.split("Negative prompt:").nth(1) {
                        if let Some(end) = neg_part.find("Steps:") {
                            let neg_clean = neg_part[..end].trim();
                            if !is_missing_prompt_value(neg_clean)
                                && meta.negative_prompt.is_empty()
                            {
                                meta.negative_prompt = neg_clean.to_string();
                                record_core_source(
                                    &mut source_node_ids,
                                    ComfyMetadataField::NegativePrompt,
                                    id,
                                );
                            }
                        }
                    }
                    // IMPORTANT: Do NOT set this huge blob as positive prompt
                    continue;
                }

                if is_negative {
                    if meta.negative_prompt.trim().is_empty()
                        && !is_missing_prompt_value(&text)
                        && text.trim().len() > 2
                    {
                        meta.negative_prompt = text;
                        record_core_source(
                            &mut source_node_ids,
                            ComfyMetadataField::NegativePrompt,
                            id,
                        );
                    }
                } else if meta.positive_prompt.trim().is_empty() {
                    // Heuristic: If text starts with "negative", treat as negative
                    if text.to_lowercase().starts_with("negative prompt:") {
                        if meta.negative_prompt.trim().is_empty()
                            && !is_missing_prompt_value(&text)
                            && text.trim().len() > 2
                        {
                            meta.negative_prompt = text;
                            record_core_source(
                                &mut source_node_ids,
                                ComfyMetadataField::NegativePrompt,
                                id,
                            );
                        }
                    } else if text.to_lowercase().starts_with("negative") {
                        if meta.negative_prompt.trim().is_empty()
                            && !is_missing_prompt_value(&text)
                            && text.trim().len() > 2
                        {
                            meta.negative_prompt = text;
                            record_core_source(
                                &mut source_node_ids,
                                ComfyMetadataField::NegativePrompt,
                                id,
                            );
                        }
                    } else if text.trim().len() > 2 {
                        if !is_missing_prompt_value(&text) {
                            meta.positive_prompt = text;
                            record_core_source(
                                &mut source_node_ids,
                                ComfyMetadataField::PositivePrompt,
                                id,
                            );
                        }
                    }
                }
            }
        }
    }

    // Generic model discovery is fallback evidence only. Text metadata can be
    // more intentional than an arbitrary disconnected loader node.
    let mut model_nodes: Vec<(&String, &Value)> = graph.nodes().iter().collect();
    model_nodes.sort_by(|(left_id, _), (right_id, _)| compare_node_ids(left_id, right_id));

    for (id, node) in model_nodes {
        if meta.model != "Unknown" && !meta.model.is_empty() && meta.model != "None" {
            break;
        }

        let t_lower = get_node_type(node).to_lowercase();
        if is_auxiliary_model_node(&t_lower) {
            continue;
        }

        if let Some(model_name) = extract_model_from_node(node) {
            meta.model = model_name;
            source_node_ids.insert(ComfyMetadataField::Model, vec![id.clone()]);
        }
    }

    (meta, source_node_ids)
}

#[derive(Clone, Copy)]
struct CoreFieldPresence {
    model: bool,
    seed: bool,
    steps: bool,
    cfg: bool,
    sampler: bool,
    positive_prompt: bool,
    negative_prompt: bool,
}

impl CoreFieldPresence {
    fn from_metadata(meta: &ImageMetadata) -> Self {
        Self {
            model: is_known_string(&meta.model),
            seed: meta.seed.is_some(),
            steps: meta.steps > 0,
            cfg: meta.cfg > 0.0,
            sampler: is_known_string(&meta.sampler),
            positive_prompt: !is_missing_prompt_value(&meta.positive_prompt),
            negative_prompt: !is_missing_prompt_value(&meta.negative_prompt),
        }
    }
}

fn record_filled_core_sources(
    before: &CoreFieldPresence,
    after: &ImageMetadata,
    node_id: &str,
    source_node_ids: &mut ComfyFieldSourceNodeIds,
) {
    for (field, filled) in [
        (
            ComfyMetadataField::Model,
            !before.model && is_known_string(&after.model),
        ),
        (
            ComfyMetadataField::Seed,
            !before.seed && after.seed.is_some(),
        ),
        (ComfyMetadataField::Steps, !before.steps && after.steps > 0),
        (ComfyMetadataField::Cfg, !before.cfg && after.cfg > 0.0),
        (
            ComfyMetadataField::Sampler,
            !before.sampler && is_known_string(&after.sampler),
        ),
        (
            ComfyMetadataField::PositivePrompt,
            !before.positive_prompt && !is_missing_prompt_value(&after.positive_prompt),
        ),
        (
            ComfyMetadataField::NegativePrompt,
            !before.negative_prompt && !is_missing_prompt_value(&after.negative_prompt),
        ),
    ] {
        if filled {
            record_core_source(source_node_ids, field, node_id);
        }
    }
}

fn record_core_source(
    source_node_ids: &mut ComfyFieldSourceNodeIds,
    field: ComfyMetadataField,
    node_id: &str,
) {
    source_node_ids.insert(field, vec![node_id.to_string()]);
}

fn is_known_string(value: &str) -> bool {
    !value.is_empty() && value != "Unknown" && value != "None"
}

fn is_auxiliary_model_node(t_lower: &str) -> bool {
    // LoRAs, upscalers, detectors, and detailers often carry model-like filenames
    // but are not the primary checkpoint/diffusion model for the image.
    t_lower.contains("lora")
        || t_lower.contains("controlnet")
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
