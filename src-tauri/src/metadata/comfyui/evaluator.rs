use super::graph::{get_node_input_link, get_node_type, get_source_id, ComfyGraph};
use crate::metadata::ImageMetadata;
use serde_json::Value;
use std::collections::HashSet;

pub struct ComfyEvaluator<'a> {
    pub graph: &'a ComfyGraph,
}

impl<'a> ComfyEvaluator<'a> {
    pub fn new(graph: &'a ComfyGraph) -> Self {
        Self { graph }
    }

    /// Primary entry point: Evaluate the graph from likely output nodes
    pub fn extract(&self) -> ImageMetadata {
        let mut meta = ImageMetadata::default();
        let mut visited_samplers = HashSet::new();

        let output_nodes = self.find_output_nodes();

        for output_id in output_nodes {
            if let Some(node) = self.graph.get_node(&output_id) {
                if self.is_muted(node) {
                    continue;
                }

                let mut visited = HashSet::new();
                if let Some(sampler_id) = self.find_upstream_sampler(&output_id, &mut visited, 0) {
                    if visited_samplers.contains(&sampler_id) {
                        continue;
                    }
                    visited_samplers.insert(sampler_id.clone());

                    let root_sampler_id = self.find_root_sampler_id(&sampler_id);

                    if let Some(root_node) = self.graph.get_node(&root_sampler_id) {
                        let mut loras = Vec::new();
                        let mut ip_adapters = Vec::new();
                        let mut hypernetworks = Vec::new();
                        let partial = super::eval_core::extract_from_sampler(
                            self.graph,
                            &root_sampler_id,
                            root_node,
                            &mut loras,
                            &mut ip_adapters,
                            &mut hypernetworks,
                        );
                        meta.merge(partial);
                    }
                }
            }
        }

        meta
    }

    pub fn extract_from_all_samplers(&self) -> ImageMetadata {
        let mut meta = ImageMetadata::default();

        for (id, node) in self.graph.nodes() {
            let t = get_node_type(node);
            if (t.contains("KSampler") && !t.contains("Select") && !t.contains("Provider"))
                || t == "SamplerCustomAdvanced"
            {
                if !self.is_muted(node) {
                    let mut loras = Vec::new();
                    let mut ip_adapters = Vec::new();
                    let mut hypernetworks = Vec::new();
                    let partial = super::eval_core::extract_from_sampler(
                        self.graph,
                        id,
                        node,
                        &mut loras,
                        &mut ip_adapters,
                        &mut hypernetworks,
                    );
                    if partial.steps > 0 || !partial.model.is_empty() {
                        meta.merge(partial);
                        if meta.steps > 0 && !meta.model.is_empty() {
                            return meta;
                        }
                    }
                }
            }
        }
        meta
    }

    fn find_output_nodes(&self) -> Vec<String> {
        let mut nodes = Vec::new();
        for (id, node) in self.graph.nodes() {
            let t = get_node_type(node);
            if t == "SaveImage"
                || t == "PreviewImage"
                || t == "ImageSave"
                || t == "SDPromptSaver"
                || t.contains("SaveImage")
            {
                nodes.push(id.clone());
            }
        }
        nodes.sort();
        nodes
    }

    pub fn is_muted(&self, node: &Value) -> bool {
        if let Some(mode) = node.get("mode").and_then(|v| v.as_i64()) {
            return mode == 2;
        }
        false
    }

    fn find_upstream_sampler(
        &self,
        start_id: &str,
        visited: &mut HashSet<String>,
        depth: u32,
    ) -> Option<String> {
        if depth > 50 || !visited.insert(start_id.to_string()) {
            return None;
        }

        let node = self.graph.get_node(start_id)?;

        let t = get_node_type(node);
        if t.contains("KSampler")
            || t == "SamplerCustomAdvanced"
            || t == "SamplerCustom"
            || t.contains("StyleAlignedReferenceSampler")
        {
            return Some(start_id.to_string());
        }

        let image_inputs = ["images", "image", "samples"];
        for input_name in image_inputs {
            if let Some(source_id) = get_source_id(self.graph, start_id, input_name) {
                if let Some(found) = self.find_upstream_sampler(&source_id, visited, depth + 1) {
                    return Some(found);
                }
            }
        }

        None
    }

    fn find_root_sampler_id(&self, start_sampler_id: &str) -> String {
        let mut current_id = start_sampler_id.to_string();
        let mut depth = 0;

        while depth < 10 {
            if self.graph.get_node(&current_id).is_some() {
                if let Some(source_id) = get_source_id(self.graph, &current_id, "latent_image") {
                    if let Some(source_node) = self.graph.get_node(&source_id) {
                        let t = get_node_type(source_node);
                        if t.contains("KSampler")
                            || t == "SamplerCustomAdvanced"
                            || t == "SamplerCustom"
                            || t.contains("StyleAlignedReferenceSampler")
                        {
                            current_id = source_id;
                            depth += 1;
                            continue;
                        }
                    }
                }
            }
            break;
        }
        current_id
    }

    pub fn get_any_input_link(node: &Value) -> Option<String> {
        if let Some(inputs) = node.get("inputs").and_then(|v| v.as_object()) {
            for key in inputs.keys() {
                if let Some(link) = get_node_input_link(node, key) {
                    return Some(link);
                }
            }
        }
        None
    }
}
