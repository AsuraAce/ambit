use super::conditioning::{find_connected_controlnets, find_reachable_prompts};
use super::eval_utils::{
    evaluate_float, evaluate_float_link_first, evaluate_number, evaluate_number_link_first,
    evaluate_string, evaluate_string_link_first, get_source_id,
};
use super::graph::{
    get_input_connection, get_node_input_link, get_node_param, get_node_type,
    get_reroute_source_id, get_strict_source_id, get_switch_branch_input_strict,
    get_switch_branch_source, ComfyGraph, InputConnection,
};
use crate::metadata::utils::{
    extract_explicit_embeddings_from_prompt, extract_hypernets_from_prompt,
    extract_loras_from_prompt,
};
use crate::metadata::{is_missing_prompt_value, ImageMetadata};
use serde_json::Value;
use std::collections::HashSet;

pub fn extract_from_sampler(
    graph: &ComfyGraph,
    node_id: &str,
    node: &Value,
    loras: &mut Vec<String>,
    ip_adapters: &mut Vec<String>,
    hypernetworks: &mut Vec<String>,
) -> ImageMetadata {
    let mut meta = ImageMetadata::default();
    let is_sampler_custom = get_node_type(node) == "SamplerCustom";

    if !is_sampler_custom {
        if let Some(v) = evaluate_number(graph, node, "steps", 500) {
            meta.steps = v as u32;
        }
    }
    let sampler_cfg = if is_sampler_custom {
        evaluate_float_link_first(graph, node, "cfg", 200.0)
    } else {
        evaluate_float(graph, node, "cfg", 200.0)
    };
    if let Some(v) = sampler_cfg {
        meta.cfg = v as f32;
    } else if !is_sampler_custom {
        if let Some(v) = extract_connected_cfg_guider(graph, node)
            .or_else(|| extract_connected_flux_guidance(graph, node))
        {
            meta.cfg = v as f32;
        }
    }
    if is_sampler_custom {
        if let Some(v) = evaluate_number_link_first(graph, node, "noise_seed", i64::MAX) {
            meta.seed = Some(v);
        }
    } else if let Some(v) = evaluate_number(graph, node, "seed", i64::MAX) {
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

    if !is_sampler_custom {
        if let Some(s) = evaluate_string(graph, node, "sampler_name") {
            sampler = s;
        }
        if let Some(s) = evaluate_string(graph, node, "scheduler") {
            scheduler = s;
        }
    }

    if meta.steps == 0 || sampler.is_empty() || scheduler.is_empty() {
        let sigmas_id = if is_sampler_custom {
            get_strict_source_id(node, "sigmas")
        } else {
            get_source_id(graph, node, "sigmas")
        };
        if let Some(sigmas_id) = sigmas_id {
            let sigmas_node = if is_sampler_custom {
                resolve_transparent_reroutes(graph, &sigmas_id)
            } else {
                graph.get_node(&sigmas_id)
            };
            if let Some(sigmas_node) = sigmas_node {
                let supports_scheduler_metadata = get_node_type(sigmas_node) != "SplitSigmas";
                if meta.steps == 0 && supports_scheduler_metadata {
                    let steps = if is_sampler_custom {
                        evaluate_number_link_first(graph, sigmas_node, "steps", 500)
                    } else {
                        evaluate_number(graph, sigmas_node, "steps", 500)
                    };
                    if let Some(v) = steps {
                        meta.steps = v as u32;
                    }
                }
                if scheduler.is_empty() && supports_scheduler_metadata {
                    let scheduler_value = if is_sampler_custom {
                        evaluate_string_link_first(graph, sigmas_node, "scheduler")
                    } else {
                        evaluate_string(graph, sigmas_node, "scheduler")
                    };
                    if let Some(s) = scheduler_value {
                        scheduler = s;
                    } else if get_node_type(sigmas_node) == "BetaSamplingScheduler" {
                        scheduler = "beta".to_string();
                    }
                }
            }
        }
        if sampler.is_empty() {
            let samp_id = if is_sampler_custom {
                get_strict_source_id(node, "sampler")
            } else {
                get_source_id(graph, node, "sampler")
            };
            if let Some(samp_id) = samp_id {
                let samp_node = if is_sampler_custom {
                    resolve_transparent_reroutes(graph, &samp_id)
                } else {
                    graph.get_node(&samp_id)
                };
                if let Some(samp_node) = samp_node {
                    let sampler_value = if is_sampler_custom {
                        evaluate_string_link_first(graph, samp_node, "sampler_name")
                    } else {
                        evaluate_string(graph, samp_node, "sampler_name")
                    };
                    if let Some(s) = sampler_value {
                        sampler = s;
                    }
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

    let mut model_control_nets = Vec::new();
    let direct_model_unconnected =
        is_sampler_custom && get_input_connection(node, "model") == InputConnection::Unconnected;
    if let Some(model_name) = trace_model_chain(
        graph,
        node,
        "model",
        loras,
        ip_adapters,
        hypernetworks,
        &mut model_control_nets,
    ) {
        meta.model = model_name;
    } else if direct_model_unconnected {
        if let Some((_, guider_node)) = connected_cfg_guider(graph, node) {
            if let Some(model_name) = trace_model_chain_with_mode(
                graph,
                guider_node,
                "model",
                loras,
                ip_adapters,
                hypernetworks,
                &mut model_control_nets,
                true,
            ) {
                meta.model = model_name;
            }
        }
    } else if !is_sampler_custom {
        if let Some(guider_id) = get_source_id(graph, node, "guider") {
            if let Some(guider_node) = graph.get_node(&guider_id) {
                if let Some(model_name) = trace_model_chain(
                    graph,
                    guider_node,
                    "model",
                    loras,
                    ip_adapters,
                    hypernetworks,
                    &mut model_control_nets,
                ) {
                    meta.model = model_name;
                }
            }
        }
    }

    let cfg_guider = connected_cfg_guider(graph, node);
    let (pos, neg) = if let Some((guider_id, guider_node)) = cfg_guider.as_ref() {
        let (_, positive_input, negative_input) =
            cfg_guider_params(guider_node).expect("connected guider should be supported");
        let prompt = |input_name| {
            get_node_input_link(guider_node, input_name)
                .map(|_| find_reachable_prompts(graph, &guider_id, input_name, is_sampler_custom))
                .unwrap_or_default()
        };
        (prompt(positive_input), prompt(negative_input))
    } else {
        (
            find_reachable_prompts(graph, node_id, "positive", is_sampler_custom),
            find_reachable_prompts(graph, node_id, "negative", is_sampler_custom),
        )
    };
    if !is_missing_prompt_value(&pos) {
        meta.positive_prompt = pos;
    }
    if !is_missing_prompt_value(&neg) {
        meta.negative_prompt = neg;
    }

    for emb in extract_explicit_embeddings_from_prompt(&meta.positive_prompt) {
        if !meta.embeddings.contains(&emb) {
            meta.embeddings.push(emb);
        }
    }
    for emb in extract_explicit_embeddings_from_prompt(&meta.negative_prompt) {
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

    if !is_sampler_custom && meta.positive_prompt.is_empty() && cfg_guider.is_none() {
        if let Some(guider_id) = get_source_id(graph, node, "guider") {
            let pos_guider = find_reachable_prompts(graph, &guider_id, "conditioning", false);
            if !is_missing_prompt_value(&pos_guider) {
                meta.positive_prompt = pos_guider;
            }
        }
    }

    meta.control_nets.extend(model_control_nets);
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

fn resolve_transparent_reroutes<'a>(graph: &'a ComfyGraph, source_id: &str) -> Option<&'a Value> {
    let source_id = resolve_transparent_reroute_id(graph, source_id)?;
    graph.get_node(&source_id)
}

fn resolve_transparent_reroute_id(graph: &ComfyGraph, source_id: &str) -> Option<String> {
    let mut current_id = source_id.to_string();
    let mut visited = HashSet::new();

    for _ in 0..=16 {
        if !visited.insert(current_id.clone()) {
            return None;
        }
        let node = graph.get_node(&current_id)?;
        if get_node_type(node) != "Reroute" {
            return Some(current_id);
        }
        current_id = get_reroute_source_id(node)?;
    }

    None
}

fn connected_cfg_guider<'a>(
    graph: &'a ComfyGraph,
    sampler_node: &Value,
) -> Option<(String, &'a Value)> {
    let guider_id = if get_node_type(sampler_node) == "SamplerCustom" {
        get_strict_source_id(sampler_node, "guider")?
    } else {
        get_source_id(graph, sampler_node, "guider")?
    };
    let guider_id = if get_node_type(sampler_node) == "SamplerCustom" {
        resolve_transparent_reroute_id(graph, &guider_id)?
    } else {
        guider_id
    };
    let guider_node = graph.get_node(&guider_id)?;
    cfg_guider_params(guider_node).map(|_| (guider_id, guider_node))
}

fn extract_connected_cfg_guider(graph: &ComfyGraph, sampler_node: &Value) -> Option<f64> {
    let (_, guider_node) = connected_cfg_guider(graph, sampler_node)?;
    let (cfg_input, _, _) = cfg_guider_params(guider_node)?;
    evaluate_float(graph, guider_node, cfg_input, 200.0)
}

pub(crate) fn cfg_guider_params(
    guider_node: &Value,
) -> Option<(&'static str, &'static str, &'static str)> {
    match get_node_type(guider_node) {
        "CFGGuider" => Some(("cfg", "positive", "negative")),
        "DualCFGGuider" => Some(("cfg_conds", "cond1", "negative")),
        _ => None,
    }
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
    control_nets: &mut Vec<String>,
) -> Option<String> {
    let strict_connections = get_node_type(start_node) == "SamplerCustom";
    trace_model_chain_with_mode(
        graph,
        start_node,
        input_name,
        loras,
        ip_adapters,
        hypernetworks,
        control_nets,
        strict_connections,
    )
}

#[allow(clippy::too_many_arguments)]
fn trace_model_chain_with_mode(
    graph: &ComfyGraph,
    start_node: &Value,
    input_name: &str,
    loras: &mut Vec<String>,
    ip_adapters: &mut Vec<String>,
    hypernetworks: &mut Vec<String>,
    control_nets: &mut Vec<String>,
    strict_connections: bool,
) -> Option<String> {
    let mut current_id =
        get_model_chain_source_id(graph, start_node, input_name, strict_connections)?;
    let mut visited = HashSet::new();

    for _ in 0..20 {
        if !visited.insert(current_id.clone()) {
            return None;
        }
        let node = graph.get_node(&current_id)?;
        let t = get_node_type(node);

        if t == "Reroute" {
            current_id = if strict_connections {
                get_reroute_source_id(node)
            } else {
                ["", "value", "input", "any"]
                    .into_iter()
                    .find_map(|key| get_model_chain_source_id(graph, node, key, false))
            }?;
            continue;
        } else if t == "ComfySwitchNode" {
            let next = if strict_connections {
                get_switch_branch_input_strict(graph, node)
                    .and_then(|branch| get_strict_source_id(node, branch))
            } else {
                get_switch_branch_source(graph, &current_id, node)
            };
            if let Some(next) = next {
                current_id = next;
                continue;
            }
            break;
        } else if t == "LoraLoader" || t == "LoraLoaderModelOnly" {
            if let Some(name) = get_node_param(node, "lora_name").and_then(|v| v.as_str()) {
                let name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                if !loras.contains(&name) {
                    loras.push(name);
                }
            }
            if let Some(next) = get_model_chain_source_id(graph, node, "model", strict_connections)
            {
                current_id = next;
                continue;
            }
            break;
        } else if t == "Lora Loader (LoraManager)" {
            extract_lora_manager(node, loras);
            if let Some(next) = get_model_chain_source_id(graph, node, "model", strict_connections)
            {
                current_id = next;
                continue;
            }
            break;
        } else if t == "HypernetworkLoader" {
            extract_hypernetwork_loader(node, hypernetworks);
            if let Some(next) = get_model_chain_source_id(graph, node, "model", strict_connections)
            {
                current_id = next;
                continue;
            }
            break;
        } else if t == "ZImageFunControlnet" || t == "QwenImageDiffsynthControlnet" {
            if let Some(patch_id) =
                get_model_chain_source_id(graph, node, "model_patch", strict_connections)
            {
                if let Some(patch_node) = graph.get_node(&patch_id) {
                    if get_node_type(patch_node) == "ModelPatchLoader" {
                        if let Some(name) = extract_model_patch_name(graph, patch_node) {
                            if !control_nets.contains(&name) {
                                control_nets.push(name);
                            }
                        }
                    }
                }
            }
            if let Some(next) = get_model_chain_source_id(graph, node, "model", strict_connections)
            {
                current_id = next;
                continue;
            }
            break;
        } else if get_node_type(node).contains("CheckpointLoader")
            || get_node_type(node).contains("UNETLoader")
            || get_node_type(node).contains("Ckpt Loader")
            || get_node_type(node).contains("EasyLoader")
        {
            match evaluate_loader_model_name(graph, node, strict_connections) {
                LoaderModelName::Resolved(name) => {
                    return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(
                        &name,
                    ));
                }
                LoaderModelName::AuthoritativeAbsent => return None,
                LoaderModelName::Wrapper => {}
            }
        } else if get_node_type(node) == "SDParameterGenerator" {
            let model_name = if strict_connections {
                evaluate_string_link_first(graph, node, "ckpt_name")
            } else {
                get_node_param(node, "ckpt_name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            };
            if let Some(n) = model_name.as_deref() {
                if n != "None" {
                    return Some(crate::metadata::guidance::GuidanceClassifier::clean_name(n));
                }
            }
        }

        if get_node_type(node).contains("IPAdapterApply") {
            if let Some(ip_source) =
                get_model_chain_source_id(graph, node, "ipadapter", strict_connections)
            {
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
                if let Some(s) = get_model_chain_source_id(graph, node, k, strict_connections) {
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
                if strict_connections {
                    match get_input_connection(node, input_key) {
                        InputConnection::Connected(next) => {
                            current_id = next;
                            found_next = true;
                            break;
                        }
                        InputConnection::DeclaredUnresolved => return None,
                        InputConnection::Unconnected => {}
                    }
                } else if let Some(next) =
                    get_model_chain_source_id(graph, node, input_key, strict_connections)
                {
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

fn get_model_chain_source_id(
    graph: &ComfyGraph,
    node: &Value,
    input_name: &str,
    strict_connections: bool,
) -> Option<String> {
    if strict_connections {
        get_strict_source_id(node, input_name)
    } else {
        get_source_id(graph, node, input_name)
    }
}

enum LoaderModelName {
    Resolved(String),
    AuthoritativeAbsent,
    Wrapper,
}

fn evaluate_loader_model_name(
    graph: &ComfyGraph,
    node: &Value,
    strict_connections: bool,
) -> LoaderModelName {
    if !strict_connections {
        return ["ckpt_name", "unet_name", "checkpoint"]
            .into_iter()
            .find_map(|key| get_node_param(node, key).and_then(Value::as_str))
            .filter(|name| !name.is_empty() && *name != "None")
            .map(|name| LoaderModelName::Resolved(name.to_string()))
            .unwrap_or(LoaderModelName::Wrapper);
    }

    let input_names: &[&str] = if get_node_type(node).contains("UNETLoader") {
        &["unet_name"]
    } else {
        &["ckpt_name", "checkpoint"]
    };

    let mut has_name_input = false;
    for input_name in input_names {
        has_name_input |= node
            .get("inputs")
            .and_then(Value::as_object)
            .is_some_and(|inputs| inputs.contains_key(*input_name))
            || node
                .get("inputs")
                .and_then(Value::as_array)
                .is_some_and(|inputs| {
                    inputs
                        .iter()
                        .any(|input| input.get("name").and_then(Value::as_str) == Some(*input_name))
                })
            || node
                .get("_resolved_inputs")
                .and_then(Value::as_object)
                .is_some_and(|inputs| inputs.contains_key(*input_name));
        match get_input_connection(node, input_name) {
            InputConnection::Connected(_) => {
                return evaluate_string_link_first(graph, node, input_name)
                    .filter(|name| !name.is_empty() && name != "None")
                    .map(LoaderModelName::Resolved)
                    .unwrap_or(LoaderModelName::AuthoritativeAbsent);
            }
            InputConnection::DeclaredUnresolved => return LoaderModelName::AuthoritativeAbsent,
            InputConnection::Unconnected => {}
        }
        if let Some(name) = evaluate_string_link_first(graph, node, input_name) {
            return if name.is_empty() || name == "None" {
                LoaderModelName::AuthoritativeAbsent
            } else {
                LoaderModelName::Resolved(name)
            };
        }
    }

    if has_name_input {
        LoaderModelName::AuthoritativeAbsent
    } else {
        LoaderModelName::Wrapper
    }
}

fn extract_model_patch_name(graph: &ComfyGraph, node: &Value) -> Option<String> {
    for key in ["name", "model_patch_name", "patch_name", "model_name"] {
        match get_input_connection(node, key) {
            InputConnection::Connected(_) | InputConnection::DeclaredUnresolved => {
                let name = evaluate_string_link_first(graph, node, key)?;
                let name = crate::metadata::guidance::GuidanceClassifier::clean_name(&name);
                return (!name.is_empty()).then_some(name);
            }
            InputConnection::Unconnected => {
                if let Some(name) = get_node_param(node, key).and_then(Value::as_str) {
                    let name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                    if !name.is_empty() {
                        return Some(name);
                    }
                }
            }
        }
    }

    let name = node
        .get("widgets_values")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(Value::as_str)?;

    let name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
    (!name.is_empty()).then_some(name)
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
