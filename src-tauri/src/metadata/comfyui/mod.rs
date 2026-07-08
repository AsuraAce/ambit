use super::ImageMetadata;
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
