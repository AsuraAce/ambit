use super::conditioning::{
    find_connected_controlnets, find_reachable_prompts_with_role_and_sources,
    find_reachable_prompts_with_sources,
};
use super::diagnostics::{
    push_resource_source_node_id, ComfyFieldSourceNodeIds, ComfyMetadataField,
    ComfyResourceSourceNodeIds,
};
use super::eval_utils::{
    evaluate_float, evaluate_float_link_first, evaluate_number, evaluate_number_link_first,
    evaluate_string, evaluate_string_link_first, get_source_id,
};
use super::graph::{
    get_input_connection, get_input_source, get_node_id, get_node_input_link, get_node_param,
    get_node_type, get_reroute_source_id, get_strict_source_id, get_switch_branch_input_strict,
    get_switch_branch_source, ComfyGraph, InputConnection, InputSource, InputSourceConnection,
};
use super::heuristics::is_primary_model_loader_type;
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
) -> (
    ImageMetadata,
    ComfyFieldSourceNodeIds,
    ComfyResourceSourceNodeIds,
) {
    let mut meta = ImageMetadata::default();
    let mut source_node_ids = ComfyFieldSourceNodeIds::new();
    let mut resource_source_node_ids = ComfyResourceSourceNodeIds::new();
    let is_sampler_custom = get_node_type(node) == "SamplerCustom";

    if !is_sampler_custom {
        if let Some(v) = evaluate_number(graph, node, "steps", 500) {
            meta.steps = v as u32;
            record_value_source(
                graph,
                node_id,
                node,
                "steps",
                true,
                ComfyMetadataField::Steps,
                &mut source_node_ids,
            );
        }
    }
    let sampler_cfg = if is_sampler_custom {
        evaluate_float_link_first(graph, node, "cfg", 200.0)
    } else {
        evaluate_float(graph, node, "cfg", 200.0)
    };
    if let Some(v) = sampler_cfg {
        meta.cfg = v as f32;
        record_value_source(
            graph,
            node_id,
            node,
            "cfg",
            !is_sampler_custom,
            ComfyMetadataField::Cfg,
            &mut source_node_ids,
        );
    } else if !is_sampler_custom {
        if let Some(v) = extract_connected_cfg_guider(graph, node)
            .or_else(|| extract_connected_flux_guidance(graph, node))
        {
            meta.cfg = v as f32;
            if let Some(source_id) = connected_cfg_source_node_id(graph, node)
                .or_else(|| connected_flux_guidance_source_node_id(graph, node))
            {
                source_node_ids.insert(ComfyMetadataField::Cfg, vec![source_id]);
            }
        }
    }
    if is_sampler_custom {
        if let Some(v) = evaluate_number_link_first(graph, node, "noise_seed", i64::MAX) {
            meta.seed = Some(v);
            record_value_source(
                graph,
                node_id,
                node,
                "noise_seed",
                false,
                ComfyMetadataField::Seed,
                &mut source_node_ids,
            );
        }
    } else if let Some(v) = evaluate_number(graph, node, "seed", i64::MAX) {
        meta.seed = Some(v);
        record_value_source(
            graph,
            node_id,
            node,
            "seed",
            true,
            ComfyMetadataField::Seed,
            &mut source_node_ids,
        );
    } else if let Some(v) = evaluate_number(graph, node, "noise_seed", i64::MAX) {
        meta.seed = Some(v);
        record_value_source(
            graph,
            node_id,
            node,
            "noise_seed",
            true,
            ComfyMetadataField::Seed,
            &mut source_node_ids,
        );
    } else if let Some(noise_id) = get_source_id(graph, node, "noise") {
        if let Some(noise_node) = graph.get_node(&noise_id) {
            if let Some(v) = evaluate_number(graph, noise_node, "noise_seed", i64::MAX)
                .or_else(|| evaluate_number(graph, noise_node, "seed", i64::MAX))
            {
                meta.seed = Some(v);
                let key = if evaluate_number(graph, noise_node, "noise_seed", i64::MAX).is_some() {
                    "noise_seed"
                } else {
                    "seed"
                };
                record_value_source(
                    graph,
                    &noise_id,
                    noise_node,
                    key,
                    true,
                    ComfyMetadataField::Seed,
                    &mut source_node_ids,
                );
            }
        }
    }

    let mut sampler = String::new();
    let mut scheduler = String::new();

    if !is_sampler_custom {
        if let Some(s) = evaluate_string(graph, node, "sampler_name") {
            sampler = s;
            record_value_source(
                graph,
                node_id,
                node,
                "sampler_name",
                true,
                ComfyMetadataField::Sampler,
                &mut source_node_ids,
            );
        }
        if let Some(s) = evaluate_string(graph, node, "scheduler") {
            scheduler = s;
            record_value_source(
                graph,
                node_id,
                node,
                "scheduler",
                true,
                ComfyMetadataField::Sampler,
                &mut source_node_ids,
            );
        }
    }

    if meta.steps == 0 || sampler.is_empty() || scheduler.is_empty() {
        let sigmas_node = resolve_sampler_scheduler(graph, node, is_sampler_custom);
        if let Some(sigmas_node) = sigmas_node {
            let sigmas_type = get_node_type(sigmas_node);
            let strict_scheduler_inputs = is_sampler_custom || sigmas_type == "Ideogram4Scheduler";
            let supports_scheduler_metadata = is_sampler_custom || sigmas_type != "SplitSigmas";
            if meta.steps == 0 && supports_scheduler_metadata {
                let steps = if strict_scheduler_inputs {
                    evaluate_number_link_first(graph, sigmas_node, "steps", 500)
                } else {
                    evaluate_number(graph, sigmas_node, "steps", 500)
                };
                if let Some(v) = steps {
                    meta.steps = v as u32;
                    record_value_source(
                        graph,
                        &get_node_id(sigmas_node),
                        sigmas_node,
                        "steps",
                        !strict_scheduler_inputs,
                        ComfyMetadataField::Steps,
                        &mut source_node_ids,
                    );
                }
            }
            if scheduler.is_empty() && supports_scheduler_metadata {
                if sigmas_type == "Ideogram4Scheduler" {
                    scheduler = "ideogram4".to_string();
                } else {
                    let scheduler_value = if strict_scheduler_inputs {
                        evaluate_string_link_first(graph, sigmas_node, "scheduler")
                    } else {
                        evaluate_string(graph, sigmas_node, "scheduler")
                    };
                    if let Some(s) = scheduler_value {
                        scheduler = s;
                        record_value_source(
                            graph,
                            &get_node_id(sigmas_node),
                            sigmas_node,
                            "scheduler",
                            !strict_scheduler_inputs,
                            ComfyMetadataField::Sampler,
                            &mut source_node_ids,
                        );
                    } else if sigmas_type == "BetaSamplingScheduler" {
                        scheduler = "beta".to_string();
                        push_source_node_id(
                            &mut source_node_ids,
                            ComfyMetadataField::Sampler,
                            get_node_id(sigmas_node),
                        );
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
                    if let Some(s) = sampler_value.or_else(|| {
                        (is_sampler_custom && get_node_type(samp_node) == "SamplerLCM")
                            .then_some("lcm".into())
                    }) {
                        sampler = s;
                        record_value_source(
                            graph,
                            &get_node_id(samp_node),
                            samp_node,
                            "sampler_name",
                            !is_sampler_custom,
                            ComfyMetadataField::Sampler,
                            &mut source_node_ids,
                        );
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
    if let Some(model) = trace_model_chain(
        graph,
        node,
        "model",
        loras,
        ip_adapters,
        hypernetworks,
        &mut model_control_nets,
        &mut resource_source_node_ids,
    ) {
        meta.model = model.name;
        source_node_ids.insert(ComfyMetadataField::Model, vec![model.node_id]);
    } else if direct_model_unconnected {
        if let Some((_, guider_node)) = connected_cfg_guider(graph, node) {
            if let Some(model) = trace_model_chain_with_mode(
                graph,
                guider_node,
                "model",
                loras,
                ip_adapters,
                hypernetworks,
                &mut model_control_nets,
                &mut resource_source_node_ids,
                true,
            ) {
                meta.model = model.name;
                source_node_ids.insert(ComfyMetadataField::Model, vec![model.node_id]);
            }
        }
    } else if !is_sampler_custom {
        if let Some(guider_id) = get_source_id(graph, node, "guider") {
            if let Some(guider_node) = graph.get_node(&guider_id) {
                let strict_connections = cfg_guider_requires_strict_inputs(guider_node);
                if let Some(model) = trace_model_chain_with_mode(
                    graph,
                    guider_node,
                    "model",
                    loras,
                    ip_adapters,
                    hypernetworks,
                    &mut model_control_nets,
                    &mut resource_source_node_ids,
                    strict_connections,
                ) {
                    meta.model = model.name;
                    source_node_ids.insert(ComfyMetadataField::Model, vec![model.node_id]);
                }
            }
        }
    }

    let cfg_guider = connected_cfg_guider(graph, node);
    let (pos, neg) = if let Some((guider_id, guider_node)) = cfg_guider.as_ref() {
        let (_, positive_input, negative_input) =
            cfg_guider_params(guider_node).expect("connected guider should be supported");
        let strict_connections =
            is_sampler_custom || cfg_guider_requires_strict_inputs(guider_node);
        let prompt = |input_name| {
            get_node_input_link(guider_node, input_name)
                .map(|_| {
                    find_reachable_prompts_with_sources(
                        graph,
                        guider_id,
                        input_name,
                        strict_connections,
                    )
                })
                .unwrap_or_default()
        };
        let negative = if dual_cfg_uses_instruct_pix_to_pix_negative(graph, guider_node) {
            find_reachable_prompts_with_role_and_sources(
                graph, guider_id, "cond2", "negative", true,
            )
        } else {
            prompt(negative_input)
        };
        (prompt(positive_input), negative)
    } else {
        (
            find_reachable_prompts_with_sources(graph, node_id, "positive", is_sampler_custom),
            find_reachable_prompts_with_sources(graph, node_id, "negative", is_sampler_custom),
        )
    };
    if !is_missing_prompt_value(&pos.text) {
        meta.positive_prompt = pos.text;
        source_node_ids.insert(ComfyMetadataField::PositivePrompt, pos.source_node_ids);
    }
    if !is_missing_prompt_value(&neg.text) {
        meta.negative_prompt = neg.text;
        source_node_ids.insert(ComfyMetadataField::NegativePrompt, neg.source_node_ids);
    }

    let positive_prompt_source_ids = source_node_ids
        .get(&ComfyMetadataField::PositivePrompt)
        .cloned()
        .unwrap_or_default();
    let negative_prompt_source_ids = source_node_ids
        .get(&ComfyMetadataField::NegativePrompt)
        .cloned()
        .unwrap_or_default();

    for emb in extract_explicit_embeddings_from_prompt(&meta.positive_prompt) {
        if !meta.embeddings.contains(&emb) {
            meta.embeddings.push(emb.clone());
        }
        record_resource_source_nodes(
            &mut resource_source_node_ids,
            ComfyMetadataField::Embeddings,
            &emb,
            &positive_prompt_source_ids,
        );
    }
    for emb in extract_explicit_embeddings_from_prompt(&meta.negative_prompt) {
        if !meta.embeddings.contains(&emb) {
            meta.embeddings.push(emb.clone());
        }
        record_resource_source_nodes(
            &mut resource_source_node_ids,
            ComfyMetadataField::Embeddings,
            &emb,
            &negative_prompt_source_ids,
        );
    }

    for lora in extract_loras_from_prompt(&meta.positive_prompt) {
        if !meta.loras.contains(&lora) {
            meta.loras.push(lora.clone());
        }
        record_resource_source_nodes(
            &mut resource_source_node_ids,
            ComfyMetadataField::Loras,
            &lora,
            &positive_prompt_source_ids,
        );
    }
    for lora in extract_loras_from_prompt(&meta.negative_prompt) {
        if !meta.loras.contains(&lora) {
            meta.loras.push(lora.clone());
        }
        record_resource_source_nodes(
            &mut resource_source_node_ids,
            ComfyMetadataField::Loras,
            &lora,
            &negative_prompt_source_ids,
        );
    }

    for hn in extract_hypernets_from_prompt(&meta.positive_prompt) {
        if !meta.hypernetworks.contains(&hn) {
            meta.hypernetworks.push(hn.clone());
        }
        record_resource_source_nodes(
            &mut resource_source_node_ids,
            ComfyMetadataField::Hypernetworks,
            &hn,
            &positive_prompt_source_ids,
        );
    }
    for hn in extract_hypernets_from_prompt(&meta.negative_prompt) {
        if !meta.hypernetworks.contains(&hn) {
            meta.hypernetworks.push(hn.clone());
        }
        record_resource_source_nodes(
            &mut resource_source_node_ids,
            ComfyMetadataField::Hypernetworks,
            &hn,
            &negative_prompt_source_ids,
        );
    }

    if !is_sampler_custom && meta.positive_prompt.is_empty() && cfg_guider.is_none() {
        if let Some(guider_id) = get_source_id(graph, node, "guider") {
            let pos_guider =
                find_reachable_prompts_with_sources(graph, &guider_id, "conditioning", false);
            if !is_missing_prompt_value(&pos_guider.text) {
                meta.positive_prompt = pos_guider.text;
                source_node_ids.insert(
                    ComfyMetadataField::PositivePrompt,
                    pos_guider.source_node_ids,
                );
            }
        }
    }

    meta.control_nets.extend(model_control_nets);
    let cnets = find_connected_controlnets(
        graph,
        node_id,
        "positive",
        ip_adapters,
        &mut resource_source_node_ids,
    );
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

    for node_ids in source_node_ids.values_mut() {
        node_ids.sort_by(|left, right| super::graph::compare_node_ids(left, right));
        node_ids.dedup();
    }
    for resources in resource_source_node_ids.values_mut() {
        for node_ids in resources.values_mut() {
            node_ids.sort_by(|left, right| super::graph::compare_node_ids(left, right));
            node_ids.dedup();
        }
    }
    (meta, source_node_ids, resource_source_node_ids)
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

fn resolve_sampler_scheduler<'a>(
    graph: &'a ComfyGraph,
    sampler_node: &Value,
    trace_split_sigmas: bool,
) -> Option<&'a Value> {
    let mut source = match get_input_source(sampler_node, "sigmas") {
        InputSourceConnection::Connected(source) => source,
        InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {
            return None;
        }
    };
    let mut visited = HashSet::new();
    let mut depth = 0;

    loop {
        if depth > 16 || !visited.insert(source.node_id.clone()) {
            return None;
        }
        let node = graph.get_node(&source.node_id)?;
        match get_node_type(node) {
            "Reroute" => {
                source = get_first_connected_source(node, &["", "value", "input", "any"])?;
            }
            "SetFirstSigma" => {
                if !matches!(source.output_slot, None | Some(0)) {
                    return None;
                }
                source = get_first_connected_source(node, &["sigmas"])?;
            }
            "SplitSigmas" if trace_split_sigmas => {
                if !matches!(source.output_slot, None | Some(0 | 1)) {
                    return None;
                }
                source = get_first_connected_source(node, &["sigmas"])?;
            }
            _ => return Some(node),
        }
        depth += 1;
    }
}

fn get_first_connected_source(node: &Value, keys: &[&str]) -> Option<InputSource> {
    for key in keys {
        match get_input_source(node, key) {
            InputSourceConnection::Connected(source) => return Some(source),
            InputSourceConnection::DeclaredUnresolved => return None,
            InputSourceConnection::Unconnected => {}
        }
    }
    None
}

fn push_source_node_id(
    sources: &mut ComfyFieldSourceNodeIds,
    field: ComfyMetadataField,
    node_id: String,
) {
    let node_ids = sources.entry(field).or_default();
    if !node_ids.contains(&node_id) {
        node_ids.push(node_id);
    }
}

fn record_resource_source_nodes(
    sources: &mut ComfyResourceSourceNodeIds,
    field: ComfyMetadataField,
    value: &str,
    node_ids: &[String],
) {
    for node_id in node_ids {
        push_resource_source_node_id(sources, field, value, node_id);
    }
}

#[allow(clippy::too_many_arguments)]
fn record_value_source(
    graph: &ComfyGraph,
    owner_id: &str,
    owner: &Value,
    input_name: &str,
    direct_first: bool,
    field: ComfyMetadataField,
    sources: &mut ComfyFieldSourceNodeIds,
) {
    if let Some(node_id) = value_source_node_id(graph, owner_id, owner, input_name, direct_first) {
        push_source_node_id(sources, field, node_id);
    }
}

fn value_source_node_id(
    graph: &ComfyGraph,
    owner_id: &str,
    owner: &Value,
    input_name: &str,
    direct_first: bool,
) -> Option<String> {
    let direct_value = get_node_param(owner, input_name)
        .filter(|value| value.is_number() || value.is_string() || value.is_boolean());
    if direct_first && direct_value.is_some() {
        return Some(owner_id.to_string());
    }
    match get_input_source(owner, input_name) {
        InputSourceConnection::Connected(source) => {
            resolve_terminal_value_source_id(graph, source, &mut HashSet::new(), 0)
        }
        InputSourceConnection::DeclaredUnresolved => None,
        InputSourceConnection::Unconnected => direct_value.map(|_| owner_id.to_string()),
    }
}

fn resolve_terminal_value_source_id(
    graph: &ComfyGraph,
    source: InputSource,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Option<String> {
    if depth > 16 || !visited.insert(source.node_id.clone()) {
        return None;
    }
    let node = graph.get_node(&source.node_id)?;
    let node_type = get_node_type(node);
    let next = if node_type == "ComfySwitchNode" {
        get_switch_branch_input_strict(graph, node).and_then(|branch| {
            match get_input_source(node, branch) {
                InputSourceConnection::Connected(source) => Some(source),
                InputSourceConnection::DeclaredUnresolved | InputSourceConnection::Unconnected => {
                    None
                }
            }
        })
    } else if node_type == "Reroute" {
        get_first_connected_source(node, &["", "value", "input", "any"])
    } else if node_type == "ComfyNumberConvert" {
        get_first_connected_source(node, &["value"])
    } else if matches!(
        node_type,
        "PrimitiveNode"
            | "String"
            | "Text String"
            | "Text Multiline"
            | "PrimitiveString"
            | "PrimitiveStringMultiline"
    ) {
        get_first_connected_source(node, &["value", "int", "float", "string", "text"])
    } else {
        None
    };

    match next {
        Some(next) => resolve_terminal_value_source_id(graph, next, visited, depth + 1),
        None => Some(source.node_id),
    }
}

fn dual_cfg_uses_instruct_pix_to_pix_negative(graph: &ComfyGraph, guider_node: &Value) -> bool {
    if get_node_type(guider_node) != "DualCFGGuider" {
        return false;
    }

    let Some(source) = resolve_input_source_through_reroutes(graph, guider_node, "cond2") else {
        return false;
    };
    source.output_slot == Some(1)
        && graph
            .get_node(&source.node_id)
            .is_some_and(|node| get_node_type(node) == "InstructPixToPixConditioning")
}

fn resolve_input_source_through_reroutes(
    graph: &ComfyGraph,
    node: &Value,
    input_name: &str,
) -> Option<InputSource> {
    let InputSourceConnection::Connected(mut source) = get_input_source(node, input_name) else {
        return None;
    };
    let mut visited = HashSet::new();

    for _ in 0..=16 {
        if !visited.insert(source.node_id.clone()) {
            return None;
        }
        let source_node = graph.get_node(&source.node_id)?;
        if get_node_type(source_node) != "Reroute" {
            return Some(source);
        }
        source = get_first_connected_source(source_node, &["", "value", "input", "any"])?;
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
    if cfg_guider_requires_strict_inputs(guider_node) {
        evaluate_float_link_first(graph, guider_node, cfg_input, 200.0)
    } else {
        evaluate_float(graph, guider_node, cfg_input, 200.0)
    }
}

fn connected_cfg_source_node_id(graph: &ComfyGraph, sampler_node: &Value) -> Option<String> {
    let (guider_id, guider_node) = connected_cfg_guider(graph, sampler_node)?;
    let (cfg_input, _, _) = cfg_guider_params(guider_node)?;
    value_source_node_id(
        graph,
        &guider_id,
        guider_node,
        cfg_input,
        !cfg_guider_requires_strict_inputs(guider_node),
    )
}

pub(crate) fn cfg_guider_params(
    guider_node: &Value,
) -> Option<(&'static str, &'static str, &'static str)> {
    match get_node_type(guider_node) {
        "CFGGuider" => Some(("cfg", "positive", "negative")),
        "DualCFGGuider" => Some(("cfg_conds", "cond1", "negative")),
        "DualModelGuider" => Some(("cfg", "positive", "negative")),
        _ => None,
    }
}

pub(crate) fn cfg_guider_requires_strict_inputs(guider_node: &Value) -> bool {
    get_node_type(guider_node) == "DualModelGuider"
}

fn extract_connected_flux_guidance(graph: &ComfyGraph, sampler_node: &Value) -> Option<f64> {
    let guider_id = get_source_id(graph, sampler_node, "guider")?;
    let guider_node = graph.get_node(&guider_id)?;
    let conditioning_id = get_source_id(graph, guider_node, "conditioning")?;
    trace_flux_guidance(graph, &conditioning_id, 0)
}

fn connected_flux_guidance_source_node_id(
    graph: &ComfyGraph,
    sampler_node: &Value,
) -> Option<String> {
    let guider_id = get_source_id(graph, sampler_node, "guider")?;
    let guider_node = graph.get_node(&guider_id)?;
    let conditioning_id = get_source_id(graph, guider_node, "conditioning")?;
    trace_flux_guidance_source_node_id(graph, &conditioning_id, 0)
}

fn trace_flux_guidance_source_node_id(
    graph: &ComfyGraph,
    node_id: &str,
    depth: u32,
) -> Option<String> {
    if depth > 10 {
        return None;
    }
    let node = graph.get_node(node_id)?;
    if get_node_type(node) == "FluxGuidance" {
        return value_source_node_id(graph, node_id, node, "guidance", false);
    }
    for input_name in ["conditioning", "CONDITIONING"] {
        if let Some(next_id) = get_source_id(graph, node, input_name) {
            if let Some(source_id) = trace_flux_guidance_source_node_id(graph, &next_id, depth + 1)
            {
                return Some(source_id);
            }
        }
    }
    None
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

struct ResolvedModel {
    name: String,
    node_id: String,
}

fn trace_model_chain(
    graph: &ComfyGraph,
    start_node: &Value,
    input_name: &str,
    loras: &mut Vec<String>,
    ip_adapters: &mut Vec<String>,
    hypernetworks: &mut Vec<String>,
    control_nets: &mut Vec<String>,
    resource_source_node_ids: &mut ComfyResourceSourceNodeIds,
) -> Option<ResolvedModel> {
    let strict_connections = get_node_type(start_node) == "SamplerCustom";
    trace_model_chain_with_mode(
        graph,
        start_node,
        input_name,
        loras,
        ip_adapters,
        hypernetworks,
        control_nets,
        resource_source_node_ids,
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
    resource_source_node_ids: &mut ComfyResourceSourceNodeIds,
    strict_connections: bool,
) -> Option<ResolvedModel> {
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
        } else if t == "CFGOverride" {
            if let Some(next) = get_strict_source_id(node, "model") {
                current_id = next;
                continue;
            }
            return None;
        } else if t == "LoraLoader" || t == "LoraLoaderModelOnly" {
            if let Some(name) = get_node_param(node, "lora_name").and_then(|v| v.as_str()) {
                let name = crate::metadata::guidance::GuidanceClassifier::clean_name(name);
                if !loras.contains(&name) {
                    loras.push(name.clone());
                }
                push_resource_source_node_id(
                    resource_source_node_ids,
                    ComfyMetadataField::Loras,
                    &name,
                    &current_id,
                );
            }
            if let Some(next) = get_model_chain_source_id(graph, node, "model", strict_connections)
            {
                current_id = next;
                continue;
            }
            break;
        } else if t == "Lora Loader (LoraManager)" {
            for name in extract_lora_manager(node, loras) {
                push_resource_source_node_id(
                    resource_source_node_ids,
                    ComfyMetadataField::Loras,
                    &name,
                    &current_id,
                );
            }
            if let Some(next) = get_model_chain_source_id(graph, node, "model", strict_connections)
            {
                current_id = next;
                continue;
            }
            break;
        } else if t == "HypernetworkLoader" {
            if let Some(name) = extract_hypernetwork_loader(node, hypernetworks) {
                push_resource_source_node_id(
                    resource_source_node_ids,
                    ComfyMetadataField::Hypernetworks,
                    &name,
                    &current_id,
                );
            }
            if let Some(next) = get_model_chain_source_id(graph, node, "model", strict_connections)
            {
                current_id = next;
                continue;
            }
            break;
        } else if t == "ZImageFunControlnet"
            || t == "QwenImageDiffsynthControlnet"
            || t == "AnimaLLLiteApply"
        {
            if t == "AnimaLLLiteApply" {
                match node.get("mode").and_then(Value::as_i64) {
                    Some(2) => return None,
                    Some(4) => {
                        if let Some(next) =
                            get_model_chain_source_id(graph, node, "model", strict_connections)
                        {
                            current_id = next;
                            continue;
                        }
                        break;
                    }
                    _ => {}
                }
            }
            let patch_id = if t == "AnimaLLLiteApply" {
                get_strict_source_id(node, "model_patch")
            } else {
                get_model_chain_source_id(graph, node, "model_patch", strict_connections)
            };
            if let Some(patch_id) = patch_id {
                if let Some(patch_node) = graph.get_node(&patch_id) {
                    if get_node_type(patch_node) == "ModelPatchLoader" {
                        if let Some(name) = extract_model_patch_name(graph, patch_node) {
                            if !control_nets.contains(&name) {
                                control_nets.push(name.clone());
                            }
                            push_resource_source_node_id(
                                resource_source_node_ids,
                                ComfyMetadataField::ControlNets,
                                &name,
                                &patch_id,
                            );
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
        } else if is_primary_model_loader_type(get_node_type(node)) {
            match evaluate_loader_model_name(graph, node, strict_connections) {
                LoaderModelName::Resolved(name) => {
                    return Some(ResolvedModel {
                        name: crate::metadata::guidance::GuidanceClassifier::clean_name(&name),
                        node_id: current_id,
                    });
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
                    return Some(ResolvedModel {
                        name: crate::metadata::guidance::GuidanceClassifier::clean_name(n),
                        node_id: current_id,
                    });
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
                                ip_adapters.push(name.clone());
                            }
                            push_resource_source_node_id(
                                resource_source_node_ids,
                                ComfyMetadataField::IpAdapters,
                                &name,
                                &ip_source,
                            );
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

    let input_names: &[&str] = if get_node_type(node)
        .to_ascii_lowercase()
        .contains("unetloader")
    {
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

fn extract_hypernetwork_loader(node: &Value, hypernetworks: &mut Vec<String>) -> Option<String> {
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
            hypernetworks.push(entry.clone());
        }
        return Some(entry);
    }
    None
}

fn extract_lora_manager(node: &Value, loras: &mut Vec<String>) -> Vec<String> {
    let mut values = None;
    let mut extracted = Vec::new();

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
                        loras.push(entry.clone());
                    }
                    extracted.push(entry);
                }
            }
        }
    }
    extracted
}
