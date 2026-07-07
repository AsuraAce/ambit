use super::conditioning::{find_connected_controlnets, find_reachable_prompts};
use super::eval_utils::{evaluate_float, evaluate_number, evaluate_string, get_source_id};
use super::graph::{get_node_param, get_node_type, ComfyGraph};
use crate::metadata::utils::{
    extract_embeddings_from_prompt, extract_hypernets_from_prompt, extract_loras_from_prompt,
};
use crate::metadata::ImageMetadata;
use serde_json::Value;

pub fn extract_from_sampler(
    graph: &ComfyGraph,
    node_id: &str,
    node: &Value,
    loras: &mut Vec<String>,
    ip_adapters: &mut Vec<String>,
    hypernetworks: &mut Vec<String>,
) -> ImageMetadata {
    let mut meta = ImageMetadata::default();

    if let Some(v) = evaluate_number(graph, node, "steps", 500) {
        meta.steps = v as u32;
    }
    if let Some(v) = evaluate_float(graph, node, "cfg", 200.0) {
        meta.cfg = v as f32;
    } else if let Some(v) = extract_connected_flux_guidance(graph, node) {
        meta.cfg = v as f32;
    }
    if let Some(v) = evaluate_number(graph, node, "seed", i64::MAX) {
        meta.seed = Some(v);
    } else if let Some(v) = evaluate_number(graph, node, "noise_seed", i64::MAX) {
        meta.seed = Some(v);
    } else if let Some(noise_id) = get_source_id(graph, node, "noise") {
        if let Some(noise_node) = graph.get_node(&noise_id) {
            if let Some(v) = evaluate_number(graph, noise_node, "noise_seed", i64::MAX)
                .or_else(|| evaluate_number(graph, noise_node, "seed", i64::MAX))
            {
                meta.seed = Some(v);
            }
        }
    }

    let mut sampler = String::new();
    let mut scheduler = String::new();

    if let Some(s) = evaluate_string(graph, node, "sampler_name") {
        sampler = s;
    }
    if let Some(s) = evaluate_string(graph, node, "scheduler") {
        scheduler = s;
    }

    if meta.steps == 0 || sampler.is_empty() {
        if let Some(sigmas_id) = get_source_id(graph, node, "sigmas") {
            if let Some(sigmas_node) = graph.get_node(&sigmas_id) {
                if let Some(v) = evaluate_number(graph, sigmas_node, "steps", 500) {
                    meta.steps = v as u32;
                }
                if let Some(s) = evaluate_string(graph, sigmas_node, "scheduler") {
                    scheduler = s;
                }
            }
        }
        if let Some(samp_id) = get_source_id(graph, node, "sampler") {
            if let Some(samp_node) = graph.get_node(&samp_id) {
                if let Some(s) = evaluate_string(graph, samp_node, "sampler_name") {
                    sampler = s;
                }
            }
        }
    }

    if !sampler.is_empty() {
        meta.sampler = if !scheduler.is_empty() {
            format!("{} ({})", sampler, scheduler)
        } else {
            sampler
        };
    }

    if let Some(model_name) =
        trace_model_chain(graph, node, "model", loras, ip_adapters, hypernetworks)
    {
        meta.model = model_name;
    } else if let Some(guider_id) = get_source_id(graph, node, "guider") {
        if let Some(guider_node) = graph.get_node(&guider_id) {
            if let Some(model_name) = trace_model_chain(
                graph,
                guider_node,
                "model",
                loras,
                ip_adapters,
                hypernetworks,
            )
            {
                meta.model = model_name;
            }
        }
    }

    let pos = find_reachable_prompts(graph, node_id, "positive");
    if !pos.is_empty() {
        let lower = pos.to_lowercase();
        if lower != "undefined" && lower != "null" && lower != "none" {
            meta.positive_prompt = pos;
        }
    }

    let neg = find_reachable_prompts(graph, node_id, "negative");
    if !neg.is_empty() {
        meta.negative_prompt = neg;
    }

    for emb in extract_embeddings_from_prompt(&meta.positive_prompt) {
        if !meta.embeddings.contains(&emb) {
            meta.embeddings.push(emb);
        }
    }
    for emb in extract_embeddings_from_prompt(&meta.negative_prompt) {
        if !meta.embeddings.contains(&emb) {
            meta.embeddings.push(emb);
        }
    }

    for lora in extract_loras_from_prompt(&meta.positive_prompt) {
        if !meta.loras.contains(&lora) {
            meta.loras.push(lora);
        }
    }
    for lora in extract_loras_from_prompt(&meta.negative_prompt) {
        if !meta.loras.contains(&lora) {
            meta.loras.push(lora);
        }
    }

    for hn in extract_hypernets_from_prompt(&meta.positive_prompt) {
        if !meta.hypernetworks.contains(&hn) {
            meta.hypernetworks.push(hn);
        }
    }
    for hn in extract_hypernets_from_prompt(&meta.negative_prompt) {
        if !meta.hypernetworks.contains(&hn) {
            meta.hypernetworks.push(hn);
        }
    }

    if meta.positive_prompt.is_empty() {
        if let Some(guider_id) = get_source_id(graph, node, "guider") {
            let pos_guider = find_reachable_prompts(graph, &guider_id, "conditioning");
            if !pos_guider.is_empty() {
                let lower = pos_guider.to_lowercase();
                if lower != "undefined" && lower != "null" && lower != "none" {
                    meta.positive_prompt = pos_guider;
                }
            }
        }
    }

    let cnets = find_connected_controlnets(graph, node_id, "positive", ip_adapters);
    for cn in cnets {
        if !meta.control_nets.contains(&cn) {
            meta.control_nets.push(cn);
        }
    }

    meta.loras.extend(loras.clone());
    meta.loras.dedup();
    meta.ip_adapters.extend(ip_adapters.clone());
    meta.ip_adapters.dedup();
    meta.hypernetworks.extend(hypernetworks.clone());
    meta.hypernetworks.dedup();

    meta
}

fn extract_connected_flux_guidance(graph: &ComfyGraph, sampler_node: &Value) -> Option<f64> {
    let guider_id = get_source_id(graph, sampler_node, "guider")?;
    let guider_node = graph.get_node(&guider_id)?;
    let conditioning_id = get_source_id(graph, guider_node, "conditioning")?;
    trace_flux_guidance(graph, &conditioning_id, 0)
}

fn trace_flux_guidance(graph: &ComfyGraph, node_id: &str, depth: u32) -> Option<f64> {
    if depth > 10 {
        return None;
    }

    let node = graph.get_node(node_id)?;
    if get_node_type(node) == "FluxGuidance" {
        if let Some(source_id) = get_source_id(graph, node, "guidance") {
            return graph
                .get_node(&source_id)
                .and_then(linked_flux_guidance_value);
        }

        return evaluate_float(graph, node, "guidance", 200.0)
            .or_else(|| get_node_param(node, "guidance").and_then(value_as_f64));
    }

    for input_name in ["conditioning", "CONDITIONING"] {
        if let Some(next_id) = get_source_id(graph, node, input_name) {
            if let Some(guidance) = trace_flux_guidance(graph, &next_id, depth + 1) {
                return Some(guidance);
            }
        }
    }

    None
}

fn linked_flux_guidance_value(source: &Value) -> Option<f64> {
    ["value", "float", "guidance"]
        .iter()
        .find_map(|key| {
            get_node_param(source, key).and_then(|value| value_as_bounded_f64(value, 200.0))
        })
        .or_else(|| {
            source
                .get("widgets_values")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|value| value_as_bounded_f64(value, 200.0))
        })
}

fn value_as_bounded_f64(value: &Value, max_limit: f64) -> Option<f64> {
    value_as_f64(value).filter(|value| *value < max_limit)
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|v| v as f64))
        .or_else(|| value.as_u64().map(|v| v as f64))
        .or_else(|| value.as_str().and_then(|v| v.parse::<f64>().ok()))
}

pub fn trace_model_chain(
    graph: &ComfyGraph,
    start_node: &Value,
    input_name: &str,
    loras: &mut Vec<String>,
    ip_adapters: &mut Vec<String>,
    hypernetworks: &mut Vec<String>,
) -> Option<String> {
    let mut current_id = get_source_id(graph, start_node, input_name)?;

    for _ in 0..20 {
        let node = graph.get_node(&current_id)?;
        let t = get_node_type(node);

        if t == "LoraLoader" || t == "LoraLoaderModelOnly" {
            if let Some(name) = get_node_param(node, "lora_name").and_then(|v| v.as_str()) {
                let name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                if !loras.contains(&name) {
                    loras.push(name);
                }
            }
            if let Some(next) = get_source_id(graph, node, "model") {
                current_id = next;
                continue;
            }
            break;
        } else if t == "Lora Loader (LoraManager)" {
            extract_lora_manager(node, loras);
            if let Some(next) = get_source_id(graph, node, "model") {
                current_id = next;
                continue;
            }
            break;
        } else if t == "HypernetworkLoader" {
            extract_hypernetwork_loader(node, hypernetworks);
            if let Some(next) = get_source_id(graph, node, "model") {
                current_id = next;
                continue;
            }
            break;
        } else if get_node_type(node).contains("CheckpointLoader")
            || get_node_type(node).contains("UNETLoader")
            || get_node_type(node).contains("Ckpt Loader")
            || get_node_type(node).contains("EasyLoader")
        {
            let mut name = String::new();
            if let Some(n) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) {
                name = n.to_string();
            } else if let Some(n) = get_node_param(node, "unet_name").and_then(|v| v.as_str()) {
                name = n.to_string();
            } else if let Some(n) = get_node_param(node, "checkpoint").and_then(|v| v.as_str()) {
                name = n.to_string();
            }

            if !name.is_empty() && name != "None" {
                return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(
                    &name,
                ));
            }
        } else if get_node_type(node) == "SDParameterGenerator" {
            if let Some(n) = get_node_param(node, "ckpt_name").and_then(|v| v.as_str()) {
                if n != "None" {
                    return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(n));
                }
            }
        }

        if get_node_type(node).contains("IPAdapterApply") {
            if let Some(ip_source) = get_source_id(graph, node, "ipadapter") {
                if let Some(ip_node) = graph.get_node(&ip_source) {
                    if get_node_type(ip_node).contains("IPAdapterModelLoader") {
                        if let Some(name) =
                            get_node_param(ip_node, "ipadapter_file").and_then(|v| v.as_str())
                        {
                            let name =
                                crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                            if !ip_adapters.contains(&name) {
                                ip_adapters.push(name);
                            }
                        }
                    }
                }
            }
        }

        let model_inputs = [
            "model",
            "ckpt",
            "base_model",
            "COMBO",
            "MODEL",
            "VAE",
            "CLIP",
        ];
        let mut found_next = false;
        let is_broadcaster =
            t.contains("Everywhere") || t.contains("Wireless") || t.contains("Broadcast");

        if is_broadcaster {
            let mut next = None;
            for k in ["MODEL", "ckpt", "model", "COMBO"] {
                if let Some(s) = get_source_id(graph, node, k) {
                    next = Some(s);
                    break;
                }
            }
            if let Some(n) =
                next.or_else(|| super::evaluator::ComfyEvaluator::get_any_input_link(node))
            {
                current_id = n;
                found_next = true;
            }
        } else {
            for input_key in model_inputs {
                if let Some(next) = get_source_id(graph, node, input_key) {
                    current_id = next;
                    found_next = true;
                    break;
                }
            }
        }

        if found_next {
            continue;
        }
        break;
    }
    None
}

fn extract_hypernetwork_loader(node: &Value, hypernetworks: &mut Vec<String>) {
    if let Some(name) = get_node_param(node, "hypernetwork_name").and_then(|v| v.as_str()) {
        let cleaned_name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
        let strength = get_node_param(node, "strength").and_then(|v| {
            if let Some(f) = v.as_f64() {
                Some(f)
            } else if let Some(i) = v.as_i64() {
                Some(i as f64)
            } else if let Some(s) = v.as_str() {
                s.parse::<f64>().ok()
            } else {
                None
            }
        });

        let entry = if let Some(s) = strength {
            if (s - 1.0).abs() > 0.001 {
                format!("{} ({:.2})", cleaned_name, s)
            } else {
                cleaned_name
            }
        } else {
            cleaned_name
        };

        if !hypernetworks.contains(&entry) {
            hypernetworks.push(entry);
        }
    }
}

fn extract_lora_manager(node: &Value, loras: &mut Vec<String>) {
    let mut values = None;

    if let Some(loras_obj) = node.get("inputs").and_then(|v| v.get("loras")) {
        if let Some(v) = loras_obj.get("__value__").and_then(|v| v.as_array()) {
            values = Some(v);
        }
    } else if let Some(arr) = node.get("widgets_values").and_then(|v| v.as_array()) {
        if let Some(v) = arr.get(1).and_then(|v| v.as_array()) {
            values = Some(v);
        }
    }

    if let Some(values) = values {
        for lora in values {
            if let Some(name) = lora.get("name").and_then(|v| v.as_str()) {
                let active = lora.get("active").and_then(|v| v.as_bool()).unwrap_or(true);
                if active {
                    let cleaned_name =
                        crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                    let strength = if let Some(s) = lora.get("strength") {
                        if let Some(f) = s.as_f64() {
                            Some(f)
                        } else if let Some(s_str) = s.as_str() {
                            s_str.parse::<f64>().ok()
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let entry = if let Some(s) = strength {
                        if (s - 1.0).abs() > 0.001 {
                            format!("{} ({:.2})", cleaned_name, s)
                        } else {
                            cleaned_name
                        }
                    } else {
                        cleaned_name
                    };

                    if !loras.contains(&entry) {
                        loras.push(entry);
                    }
                }
            }
        }
    }
}
