use super::{extract_a1111_metadata, is_missing_prompt_value, ImageMetadata};
use std::collections::{BTreeMap, HashMap};

mod conditioning;
mod diagnostics;
mod eval_core;
mod eval_utils;
mod evaluator;
mod graph;
mod heuristics;
mod parse_helper;
mod strategies;

#[cfg(test)]
mod tests;

use self::diagnostics::{
    ComfyMetadataField, ComfyMetadataSnapshot, ComfyParseDiagnostics, ComfyParseLayer,
};
use self::evaluator::ComfyEvaluator;
use self::graph::ComfyGraph;
use self::strategies::{global_scan, scan_explicit_nodes};

pub fn extract_comfyui_metadata(chunks: &HashMap<String, String>) -> ImageMetadata {
    extract_comfyui_metadata_with_diagnostics(chunks).0
}

pub(crate) fn merge_comfyui_metadata(
    base: &mut ImageMetadata,
    chunks: &HashMap<String, String>,
) -> ComfyParseDiagnostics {
    let mut diagnostics = ComfyParseDiagnostics::default();

    if let Some(parameters) = flat_parameters_chunk(chunks) {
        diagnostics.attempt(ComfyParseLayer::FlatParameters);
        let flat_meta = extract_a1111_metadata(parameters, Some("ComfyUI".to_string()));
        merge_flat_parameters(base, &flat_meta);
        record_flat_parameter_sources(&mut diagnostics, base, &flat_meta);
    }

    let (mut graph_meta, graph_diagnostics) = extract_comfyui_graph_with_diagnostics(chunks);
    diagnostics.graph_node_count = graph_diagnostics.graph_node_count;
    for layer in &graph_diagnostics.attempted_layers {
        diagnostics.attempt(*layer);
    }

    merge_graph_metadata(base, &mut graph_meta, &graph_diagnostics, &mut diagnostics);
    base.tool = "ComfyUI".to_string();

    diagnostics
}

fn is_known_model(model: &str) -> bool {
    !model.is_empty() && model != "Unknown" && model != "None"
}

fn has_same_model_identity(left: &str, right: &str) -> bool {
    let left = crate::metadata::guidance::GuidanceClassifier::clean_name(left);
    let right = crate::metadata::guidance::GuidanceClassifier::clean_name(right);
    !left.is_empty() && left == right
}

fn is_known_sampler(sampler: &str) -> bool {
    !sampler.is_empty()
        && sampler != "Unknown"
        && sampler != "_"
        && !sampler.starts_with("Unknown (")
        && !sampler.starts_with("_ (")
}

fn flat_parameters_chunk(chunks: &HashMap<String, String>) -> Option<&str> {
    chunks
        .get("parameters")
        .or_else(|| chunks.get("Parameters"))
        .or_else(|| chunks.get("PARAMETERS"))
        .map(String::as_str)
}

fn merge_flat_parameters(base: &mut ImageMetadata, flat: &ImageMetadata) {
    if base.tool == "Unknown" && flat.tool != "Unknown" {
        base.tool = flat.tool.clone();
    }
    if !is_known_model(&base.model) && is_known_model(&flat.model) {
        base.model = flat.model.clone();
    }
    if base.steps == 0 && flat.steps > 0 {
        base.steps = flat.steps;
    }
    if base.cfg == 0.0 && flat.cfg > 0.0 {
        base.cfg = flat.cfg;
    }
    if base.seed.is_none() {
        base.seed = flat.seed;
    }
    if !is_known_sampler(&base.sampler) && is_known_sampler(&flat.sampler) {
        base.sampler = flat.sampler.clone();
    }
    if is_missing_prompt_value(&base.positive_prompt)
        && !is_missing_prompt_value(&flat.positive_prompt)
    {
        base.positive_prompt = flat.positive_prompt.clone();
    }
    if is_missing_prompt_value(&base.negative_prompt)
        && !is_missing_prompt_value(&flat.negative_prompt)
    {
        base.negative_prompt = flat.negative_prompt.clone();
    }
    if base.raw_parameters.is_none() {
        base.raw_parameters = flat.raw_parameters.clone();
    }
    if base.model_hash.is_none() {
        base.model_hash = flat.model_hash.clone();
    }
    if base.vae.is_none() {
        base.vae = flat.vae.clone();
    }
    if base.clip_skip.is_none() {
        base.clip_skip = flat.clip_skip;
    }
    if base.denoising_strength.is_none() {
        base.denoising_strength = flat.denoising_strength;
    }
    if base.hires_upscale.is_none() {
        base.hires_upscale = flat.hires_upscale;
    }
    if base.hires_steps.is_none() {
        base.hires_steps = flat.hires_steps;
    }
    if base.hires_upscaler.is_none() {
        base.hires_upscaler = flat.hires_upscaler.clone();
    }
    if (base.generation_type.is_empty() || base.generation_type == "unknown")
        && !flat.generation_type.is_empty()
        && flat.generation_type != "unknown"
    {
        base.generation_type = flat.generation_type.clone();
    }
    base.is_favorite |= flat.is_favorite;

    merge_unique(&mut base.loras, flat.loras.iter().cloned());
    merge_unique(&mut base.control_nets, flat.control_nets.iter().cloned());
    merge_unique(&mut base.ip_adapters, flat.ip_adapters.iter().cloned());
    merge_unique(&mut base.embeddings, flat.embeddings.iter().cloned());
    merge_unique(&mut base.hypernetworks, flat.hypernetworks.iter().cloned());
}

fn record_flat_parameter_sources(
    diagnostics: &mut ComfyParseDiagnostics,
    selected: &ImageMetadata,
    flat: &ImageMetadata,
) {
    let layer = ComfyParseLayer::FlatParameters;
    if is_known_model(&flat.model) && selected.model == flat.model {
        diagnostics
            .field_sources
            .insert(ComfyMetadataField::Model, layer);
    }
    if flat.seed.is_some() && selected.seed == flat.seed {
        diagnostics
            .field_sources
            .insert(ComfyMetadataField::Seed, layer);
    }
    if flat.steps > 0 && selected.steps == flat.steps {
        diagnostics
            .field_sources
            .insert(ComfyMetadataField::Steps, layer);
    }
    if flat.cfg > 0.0 && selected.cfg == flat.cfg {
        diagnostics
            .field_sources
            .insert(ComfyMetadataField::Cfg, layer);
    }
    if is_known_sampler(&flat.sampler) && selected.sampler == flat.sampler {
        diagnostics
            .field_sources
            .insert(ComfyMetadataField::Sampler, layer);
    }
    if !is_missing_prompt_value(&flat.positive_prompt)
        && selected.positive_prompt == flat.positive_prompt
    {
        diagnostics
            .field_sources
            .insert(ComfyMetadataField::PositivePrompt, layer);
    }
    if !is_missing_prompt_value(&flat.negative_prompt)
        && selected.negative_prompt == flat.negative_prompt
    {
        diagnostics
            .field_sources
            .insert(ComfyMetadataField::NegativePrompt, layer);
    }

    for (field, contributes) in [
        (
            ComfyMetadataField::Loras,
            flat.loras
                .iter()
                .any(|value| selected.loras.contains(value)),
        ),
        (
            ComfyMetadataField::ControlNets,
            flat.control_nets
                .iter()
                .any(|value| selected.control_nets.contains(value)),
        ),
        (
            ComfyMetadataField::IpAdapters,
            flat.ip_adapters
                .iter()
                .any(|value| selected.ip_adapters.contains(value)),
        ),
        (
            ComfyMetadataField::Embeddings,
            flat.embeddings
                .iter()
                .any(|value| selected.embeddings.contains(value)),
        ),
        (
            ComfyMetadataField::Hypernetworks,
            flat.hypernetworks
                .iter()
                .any(|value| selected.hypernetworks.contains(value)),
        ),
    ] {
        if contributes {
            diagnostics.field_sources.insert(field, layer);
        }
    }
}

fn merge_graph_metadata(
    base: &mut ImageMetadata,
    graph: &mut ImageMetadata,
    graph_diagnostics: &ComfyParseDiagnostics,
    diagnostics: &mut ComfyParseDiagnostics,
) {
    if is_known_model(&graph.model) {
        if let Some(layer) = selected_graph_layer(
            graph_diagnostics,
            ComfyMetadataField::Model,
            !is_known_model(&base.model),
        ) {
            let previous_model = base.model.clone();
            base.model = std::mem::take(&mut graph.model);
            if graph.model_hash.is_some() {
                base.model_hash = graph.model_hash.take();
            } else if is_strong_graph_layer(layer)
                && !has_same_model_identity(&previous_model, &base.model)
            {
                base.model_hash = None;
            }
            diagnostics
                .field_sources
                .insert(ComfyMetadataField::Model, layer);
        }
    }

    if graph.seed.is_some() {
        if let Some(layer) = selected_graph_layer(
            graph_diagnostics,
            ComfyMetadataField::Seed,
            base.seed.is_none(),
        ) {
            base.seed = graph.seed;
            diagnostics
                .field_sources
                .insert(ComfyMetadataField::Seed, layer);
        }
    }
    if graph.steps > 0 {
        if let Some(layer) = selected_graph_layer(
            graph_diagnostics,
            ComfyMetadataField::Steps,
            base.steps == 0,
        ) {
            base.steps = graph.steps;
            diagnostics
                .field_sources
                .insert(ComfyMetadataField::Steps, layer);
        }
    }
    if graph.cfg > 0.0 {
        if let Some(layer) =
            selected_graph_layer(graph_diagnostics, ComfyMetadataField::Cfg, base.cfg == 0.0)
        {
            base.cfg = graph.cfg;
            diagnostics
                .field_sources
                .insert(ComfyMetadataField::Cfg, layer);
        }
    }
    if is_known_sampler(&graph.sampler) {
        if let Some(layer) = selected_graph_layer(
            graph_diagnostics,
            ComfyMetadataField::Sampler,
            !is_known_sampler(&base.sampler),
        ) {
            base.sampler = std::mem::take(&mut graph.sampler);
            diagnostics
                .field_sources
                .insert(ComfyMetadataField::Sampler, layer);
        }
    }
    if !is_missing_prompt_value(&graph.positive_prompt) {
        if let Some(layer) = selected_graph_layer(
            graph_diagnostics,
            ComfyMetadataField::PositivePrompt,
            is_missing_prompt_value(&base.positive_prompt),
        ) {
            base.positive_prompt = std::mem::take(&mut graph.positive_prompt);
            diagnostics
                .field_sources
                .insert(ComfyMetadataField::PositivePrompt, layer);
        }
    }
    if !is_missing_prompt_value(&graph.negative_prompt) {
        if let Some(layer) = selected_graph_layer(
            graph_diagnostics,
            ComfyMetadataField::NegativePrompt,
            is_missing_prompt_value(&base.negative_prompt),
        ) {
            base.negative_prompt = std::mem::take(&mut graph.negative_prompt);
            diagnostics
                .field_sources
                .insert(ComfyMetadataField::NegativePrompt, layer);
        }
    }

    if graph.workflow_json.is_some() {
        base.workflow_json = graph.workflow_json.take();
        copy_graph_source(
            diagnostics,
            graph_diagnostics,
            ComfyMetadataField::WorkflowJson,
        );
    }
    if graph.has_workflow_hint {
        base.has_workflow_hint = true;
        copy_graph_source(
            diagnostics,
            graph_diagnostics,
            ComfyMetadataField::WorkflowHint,
        );
    }

    if base.vae.is_none() {
        base.vae = graph.vae.take();
    }
    if base.clip_skip.is_none() {
        base.clip_skip = graph.clip_skip;
    }
    if base.denoising_strength.is_none() {
        base.denoising_strength = graph.denoising_strength;
    }
    if base.hires_upscale.is_none() {
        base.hires_upscale = graph.hires_upscale;
    }
    if base.hires_steps.is_none() {
        base.hires_steps = graph.hires_steps;
    }
    if base.hires_upscaler.is_none() {
        base.hires_upscaler = graph.hires_upscaler.take();
    }
    if (base.generation_type.is_empty() || base.generation_type == "unknown")
        && !graph.generation_type.is_empty()
        && graph.generation_type != "unknown"
    {
        base.generation_type = std::mem::take(&mut graph.generation_type);
    }
    base.is_favorite |= graph.is_favorite;

    merge_graph_resources(
        &mut base.loras,
        std::mem::take(&mut graph.loras),
        ComfyMetadataField::Loras,
        graph_diagnostics,
        diagnostics,
    );
    merge_graph_resources(
        &mut base.control_nets,
        std::mem::take(&mut graph.control_nets),
        ComfyMetadataField::ControlNets,
        graph_diagnostics,
        diagnostics,
    );
    merge_graph_resources(
        &mut base.ip_adapters,
        std::mem::take(&mut graph.ip_adapters),
        ComfyMetadataField::IpAdapters,
        graph_diagnostics,
        diagnostics,
    );
    merge_graph_resources(
        &mut base.embeddings,
        std::mem::take(&mut graph.embeddings),
        ComfyMetadataField::Embeddings,
        graph_diagnostics,
        diagnostics,
    );
    merge_graph_resources(
        &mut base.hypernetworks,
        std::mem::take(&mut graph.hypernetworks),
        ComfyMetadataField::Hypernetworks,
        graph_diagnostics,
        diagnostics,
    );
}

fn selected_graph_layer(
    diagnostics: &ComfyParseDiagnostics,
    field: ComfyMetadataField,
    base_is_missing: bool,
) -> Option<ComfyParseLayer> {
    let layer = *diagnostics.field_sources.get(&field)?;
    (is_strong_graph_layer(layer) || base_is_missing).then_some(layer)
}

fn is_strong_graph_layer(layer: ComfyParseLayer) -> bool {
    matches!(
        layer,
        ComfyParseLayer::ExplicitNode | ComfyParseLayer::SamplerTraversal
    )
}

fn copy_graph_source(
    diagnostics: &mut ComfyParseDiagnostics,
    graph_diagnostics: &ComfyParseDiagnostics,
    field: ComfyMetadataField,
) {
    if let Some(layer) = graph_diagnostics.field_sources.get(&field) {
        diagnostics.field_sources.insert(field, *layer);
    }
}

fn merge_graph_resources(
    selected: &mut Vec<String>,
    graph_values: Vec<String>,
    field: ComfyMetadataField,
    graph_diagnostics: &ComfyParseDiagnostics,
    diagnostics: &mut ComfyParseDiagnostics,
) {
    let contributed = !graph_values.is_empty();
    merge_unique(selected, graph_values);
    if !contributed {
        return;
    }

    if let Some(graph_layer) = graph_diagnostics.field_sources.get(&field) {
        let selected_layer = diagnostics.field_sources.get(&field).copied();
        if selected_layer
            .map(|layer| graph_layer.precedence() > layer.precedence())
            .unwrap_or(true)
        {
            diagnostics.field_sources.insert(field, *graph_layer);
        }
    }
}

fn merge_unique(values: &mut Vec<String>, additions: impl IntoIterator<Item = String>) {
    for value in additions {
        if !values.contains(&value) {
            values.push(value);
        }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComfyMetadataPreview {
    pub tool: String,
    pub model: String,
    pub seed: Option<i64>,
    pub steps: u32,
    pub cfg: f32,
    pub sampler: String,
    pub positive_prompt: String,
    pub negative_prompt: String,
    pub loras: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
    pub embeddings: Vec<String>,
    pub hypernetworks: Vec<String>,
    pub generation_type: String,
    pub has_workflow_hint: bool,
    pub has_workflow_json: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComfyParserDiagnosticsReport {
    pub chunk_keys: Vec<String>,
    pub has_prompt_chunk: bool,
    pub has_workflow_chunk: bool,
    pub graph_node_count: usize,
    pub attempted_layers: Vec<String>,
    pub field_sources: BTreeMap<String, String>,
    pub metadata: ComfyMetadataPreview,
}

#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_comfyui_metadata_chunks(
    chunks: HashMap<String, String>,
) -> Result<ComfyParserDiagnosticsReport, String> {
    Ok(build_comfyui_diagnostics_report(&chunks))
}

pub(crate) fn build_comfyui_diagnostics_report(
    chunks: &HashMap<String, String>,
) -> ComfyParserDiagnosticsReport {
    let (metadata, diagnostics) = extract_comfyui_metadata_with_diagnostics(chunks);
    let mut chunk_keys: Vec<String> = chunks.keys().cloned().collect();
    chunk_keys.sort();

    ComfyParserDiagnosticsReport {
        chunk_keys,
        has_prompt_chunk: chunks.contains_key("prompt"),
        has_workflow_chunk: chunks.contains_key("workflow"),
        graph_node_count: diagnostics.graph_node_count,
        attempted_layers: diagnostics
            .attempted_layers
            .iter()
            .map(|layer| parse_layer_label(*layer).to_string())
            .collect(),
        field_sources: diagnostics
            .field_sources
            .iter()
            .map(|(field, layer)| {
                (
                    metadata_field_label(*field).to_string(),
                    parse_layer_label(*layer).to_string(),
                )
            })
            .collect(),
        metadata: ComfyMetadataPreview::from_metadata(&metadata),
    }
}

impl ComfyMetadataPreview {
    fn from_metadata(metadata: &ImageMetadata) -> Self {
        Self {
            tool: metadata.tool.clone(),
            model: metadata.model.clone(),
            seed: metadata.seed,
            steps: metadata.steps,
            cfg: metadata.cfg,
            sampler: metadata.sampler.clone(),
            positive_prompt: metadata.positive_prompt.clone(),
            negative_prompt: metadata.negative_prompt.clone(),
            loras: metadata.loras.clone(),
            control_nets: metadata.control_nets.clone(),
            ip_adapters: metadata.ip_adapters.clone(),
            embeddings: metadata.embeddings.clone(),
            hypernetworks: metadata.hypernetworks.clone(),
            generation_type: metadata.generation_type.clone(),
            has_workflow_hint: metadata.has_workflow_hint,
            has_workflow_json: metadata.workflow_json.is_some(),
        }
    }
}

fn parse_layer_label(layer: ComfyParseLayer) -> &'static str {
    match layer {
        ComfyParseLayer::FlatParameters => "flat_parameters",
        ComfyParseLayer::WorkflowChunk => "workflow_chunk",
        ComfyParseLayer::ExplicitNode => "explicit_node",
        ComfyParseLayer::SamplerTraversal => "sampler_traversal",
        ComfyParseLayer::SamplerFallback => "sampler_fallback",
        ComfyParseLayer::GlobalScan => "global_scan",
    }
}

fn metadata_field_label(field: ComfyMetadataField) -> &'static str {
    match field {
        ComfyMetadataField::Model => "model",
        ComfyMetadataField::Seed => "seed",
        ComfyMetadataField::Steps => "steps",
        ComfyMetadataField::Cfg => "cfg",
        ComfyMetadataField::Sampler => "sampler",
        ComfyMetadataField::PositivePrompt => "positive_prompt",
        ComfyMetadataField::NegativePrompt => "negative_prompt",
        ComfyMetadataField::Loras => "loras",
        ComfyMetadataField::ControlNets => "control_nets",
        ComfyMetadataField::IpAdapters => "ip_adapters",
        ComfyMetadataField::Embeddings => "embeddings",
        ComfyMetadataField::Hypernetworks => "hypernetworks",
        ComfyMetadataField::WorkflowJson => "workflow_json",
        ComfyMetadataField::WorkflowHint => "workflow_hint",
    }
}

pub(crate) fn extract_comfyui_metadata_with_diagnostics(
    chunks: &HashMap<String, String>,
) -> (ImageMetadata, ComfyParseDiagnostics) {
    let mut metadata = ImageMetadata {
        tool: "ComfyUI".to_string(),
        ..ImageMetadata::default()
    };
    let diagnostics = merge_comfyui_metadata(&mut metadata, chunks);
    (metadata, diagnostics)
}

fn extract_comfyui_graph_with_diagnostics(
    chunks: &HashMap<String, String>,
) -> (ImageMetadata, ComfyParseDiagnostics) {
    // Breadcrumb for ComfyUI parsing
    println!("[ComfyUI] Parsing metadata...");

    let mut meta = ImageMetadata {
        tool: "ComfyUI".to_string(),
        ..ImageMetadata::default()
    };
    let mut diagnostics = ComfyParseDiagnostics::default();

    // Layer 1: Archival (Workflow JSON)
    let before_workflow = ComfyMetadataSnapshot::from_metadata(&meta);
    if let Some(workflow) = chunks.get("workflow") {
        diagnostics.attempt(ComfyParseLayer::WorkflowChunk);
        meta.workflow_json = Some(workflow.clone());
        meta.has_workflow_hint = true;
    } else if let Some(prompt) = chunks.get("prompt") {
        diagnostics.attempt(ComfyParseLayer::WorkflowChunk);
        meta.workflow_json = Some(prompt.clone());
        meta.has_workflow_hint = true;
    }
    diagnostics.record_diff(&before_workflow, &meta, ComfyParseLayer::WorkflowChunk);

    // Normalize graph
    let graph = ComfyGraph::from_chunks(chunks);
    diagnostics.graph_node_count = graph.nodes().len();
    if graph.nodes.is_empty() {
        return (meta, diagnostics);
    }

    // Layer 2: Explicit Metadata Nodes (User Override)
    diagnostics.attempt(ComfyParseLayer::ExplicitNode);
    if let Some(explicit) = scan_explicit_nodes(&graph) {
        let before = ComfyMetadataSnapshot::from_metadata(&meta);
        meta.merge(explicit);
        diagnostics.record_diff(&before, &meta, ComfyParseLayer::ExplicitNode);
    }

    // Layer 3: Graph Evaluator (Smart Backtracking)
    // Only run if we are missing critical info, OR if we want to fill in gaps.
    diagnostics.attempt(ComfyParseLayer::SamplerTraversal);
    let evaluator = ComfyEvaluator::new(&graph);
    let traversal_meta = evaluator.extract();
    let before = ComfyMetadataSnapshot::from_metadata(&meta);
    meta.merge_if_missing(traversal_meta);
    diagnostics.record_diff(&before, &meta, ComfyParseLayer::SamplerTraversal);

    // Layer 3.5: Sampler Scan (Fragment Fallback)
    // If output traversal didn't find specific generation data (common in fragments or tests),
    // scan specifically for standard KSamplers using the smart evaluator logic.
    if meta.is_incomplete() {
        diagnostics.attempt(ComfyParseLayer::SamplerFallback);
        let sampler_meta = evaluator.extract_from_all_samplers();
        let before = ComfyMetadataSnapshot::from_metadata(&meta);
        meta.merge_if_missing(sampler_meta);
        diagnostics.record_diff(&before, &meta, ComfyParseLayer::SamplerFallback);
    }

    // Layer 4: Global Scan (Last Resort / Cleanup)
    // If we still found nothing (e.g. graph is totally disconnected or custom nodes unknown to evaluator)
    if meta.is_incomplete() {
        diagnostics.attempt(ComfyParseLayer::GlobalScan);
        let scan_meta = global_scan(&graph);
        let before = ComfyMetadataSnapshot::from_metadata(&meta);
        meta.merge_if_missing(scan_meta);
        diagnostics.record_diff(&before, &meta, ComfyParseLayer::GlobalScan);
    }

    (meta, diagnostics)
}
