use super::ImageMetadata;
use std::collections::HashMap;

mod graph;
mod evaluator;
mod heuristics;
mod conditioning;
mod strategies;

#[cfg(test)]
mod tests;

use self::graph::ComfyGraph;
use self::evaluator::ComfyEvaluator;
use self::strategies::{scan_explicit_nodes, global_scan};

pub fn extract_comfyui_metadata(chunks: &HashMap<String, String>) -> ImageMetadata {
    // Breadcrumb for ComfyUI parsing
    println!("[ComfyUI] Parsing metadata...");
    
    let mut meta = ImageMetadata {
        tool: "ComfyUI".to_string(),
        ..ImageMetadata::default()
    };

    // Layer 1: Archival (Workflow JSON)
    if let Some(workflow) = chunks.get("workflow") {
        meta.workflow_json = Some(workflow.clone());
    } else if let Some(prompt) = chunks.get("prompt") {
        meta.workflow_json = Some(prompt.clone());
    }

    // Normalize graph
    let graph = ComfyGraph::from_chunks(chunks);
    if graph.nodes.is_empty() {
        return meta;
    }
    
    // Layer 2: Explicit Metadata Nodes (User Override)
    if let Some(explicit) = scan_explicit_nodes(&graph) {
        meta.merge(explicit);
    }

    // Layer 3: Graph Evaluator (Smart Backtracking)
    // Only run if we are missing critical info, OR if we want to fill in gaps.
    let evaluator = ComfyEvaluator::new(&graph);
    let traversal_meta = evaluator.extract();
    meta.merge_if_missing(traversal_meta);

    // Layer 3.5: Sampler Scan (Fragment Fallback)
    // If output traversal didn't find specific generation data (common in fragments or tests),
    // scan specifically for standard KSamplers using the smart evaluator logic.
    if meta.steps == 0 || meta.model.is_empty() || meta.model == "Unknown" || meta.positive_prompt.is_empty() {
        let sampler_meta = evaluator.extract_from_all_samplers();
        meta.merge_if_missing(sampler_meta);
    }

    // Layer 4: Global Scan (Last Resort / Cleanup)
    // If we still found nothing (e.g. graph is totally disconnected or custom nodes unknown to evaluator)
    if meta.is_incomplete() {
        let scan_meta = global_scan(&graph);
        meta.merge_if_missing(scan_meta);
    }

    meta
}
