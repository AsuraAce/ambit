use super::ImageMetadata;
use std::collections::HashMap;

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

use self::diagnostics::{ComfyMetadataSnapshot, ComfyParseDiagnostics, ComfyParseLayer};
use self::evaluator::ComfyEvaluator;
use self::graph::ComfyGraph;
use self::strategies::{global_scan, scan_explicit_nodes};

pub fn extract_comfyui_metadata(chunks: &HashMap<String, String>) -> ImageMetadata {
    extract_comfyui_metadata_with_diagnostics(chunks).0
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
