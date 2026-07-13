use super::graph::{
    compare_node_ids, get_node_input_link, get_node_input_links, get_node_type, get_source_id,
    ComfyGraph,
};
use crate::metadata::ImageMetadata;
use serde_json::Value;
use std::collections::HashSet;

const IMAGE_LIKE_INPUT_NAMES: [&str; 6] =
    ["images", "image", "pixels", "samples", "latent", "latents"];
const SAMPLER_LATENT_INPUT_NAMES: [&str; 4] = ["latent_image", "samples", "latent", "latents"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputCandidateKind {
    PersistedSave,
    Preview,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct OutputTraversalDiagnostics {
    pub(crate) selected_output_candidate_count: usize,
    pub(crate) unique_root_sampler_count: usize,
    pub(crate) ambiguous: bool,
    pub(crate) authoritative_positive_prompt: bool,
    pub(crate) authoritative_negative_prompt: bool,
}

pub struct ComfyEvaluator<'a> {
    pub graph: &'a ComfyGraph,
}

impl<'a> ComfyEvaluator<'a> {
    pub fn new(graph: &'a ComfyGraph) -> Self {
        Self { graph }
    }

    pub(crate) fn extract_with_output_diagnostics(
        &self,
    ) -> (ImageMetadata, OutputTraversalDiagnostics) {
        let output_nodes = self.find_output_nodes();
        let mut diagnostics = OutputTraversalDiagnostics {
            selected_output_candidate_count: output_nodes.len(),
            ..OutputTraversalDiagnostics::default()
        };
        let mut root_sampler_ids = Vec::new();

        for output_id in output_nodes {
            let mut visited = HashSet::new();
            let mut sampler_ids = Vec::new();
            self.find_upstream_samplers(&output_id, &mut visited, 0, &mut sampler_ids);

            for sampler_id in sampler_ids {
                for root_sampler_id in self.find_root_sampler_ids(&sampler_id) {
                    if !root_sampler_ids.contains(&root_sampler_id) {
                        root_sampler_ids.push(root_sampler_id);
                    }
                }
            }
        }

        root_sampler_ids.sort_by(|left, right| compare_node_ids(left, right));
        diagnostics.unique_root_sampler_count = root_sampler_ids.len();
        diagnostics.ambiguous = root_sampler_ids.len() > 1;

        if diagnostics.ambiguous {
            return (ImageMetadata::default(), diagnostics);
        }

        let Some(root_sampler_id) = root_sampler_ids.first() else {
            return (ImageMetadata::default(), diagnostics);
        };
        let Some(root_node) = self.graph.get_node(root_sampler_id) else {
            return (ImageMetadata::default(), diagnostics);
        };

        if let Some(guider_id) = get_source_id(self.graph, root_sampler_id, "guider") {
            if let Some(guider_node) = self.graph.get_node(&guider_id) {
                if get_node_type(guider_node) == "CFGGuider" {
                    diagnostics.authoritative_positive_prompt =
                        get_node_input_link(guider_node, "positive").is_some();
                    diagnostics.authoritative_negative_prompt =
                        get_node_input_link(guider_node, "negative").is_some();
                }
            }
        }

        let mut loras = Vec::new();
        let mut ip_adapters = Vec::new();
        let mut hypernetworks = Vec::new();
        let metadata = super::eval_core::extract_from_sampler(
            self.graph,
            root_sampler_id,
            root_node,
            &mut loras,
            &mut ip_adapters,
            &mut hypernetworks,
        );

        (metadata, diagnostics)
    }

    pub fn extract_from_all_samplers(&self) -> ImageMetadata {
        let mut meta = ImageMetadata::default();

        let mut sampler_nodes: Vec<(&String, &Value)> = self
            .graph
            .nodes()
            .iter()
            .filter(|(_, node)| is_sampler_node(node))
            .collect();
        sampler_nodes.sort_by(|(left_id, _), (right_id, _)| compare_node_ids(left_id, right_id));

        for (id, node) in sampler_nodes {
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
        let mut persisted = Vec::new();
        let mut previews = Vec::new();

        for (id, node) in self.graph.nodes() {
            if self.is_disabled_output(node)
                || self.direct_image_like_source_ids(id, node).is_empty()
            {
                continue;
            }

            match classify_output_candidate(get_node_type(node)) {
                Some(OutputCandidateKind::PersistedSave) => persisted.push(id.clone()),
                Some(OutputCandidateKind::Preview) => previews.push(id.clone()),
                None => {}
            }
        }

        persisted.sort_by(|left, right| compare_node_ids(left, right));
        previews.sort_by(|left, right| compare_node_ids(left, right));

        if persisted.is_empty() {
            previews
        } else {
            persisted
        }
    }

    pub fn is_muted(&self, node: &Value) -> bool {
        if let Some(mode) = node.get("mode").and_then(|v| v.as_i64()) {
            return mode == 2;
        }
        false
    }

    fn is_disabled_output(&self, node: &Value) -> bool {
        matches!(node.get("mode").and_then(Value::as_i64), Some(2 | 4))
    }

    fn find_upstream_samplers(
        &self,
        start_id: &str,
        visited: &mut HashSet<String>,
        depth: u32,
        sampler_ids: &mut Vec<String>,
    ) {
        if depth > 50 || !visited.insert(start_id.to_string()) {
            return;
        }

        let Some(node) = self.graph.get_node(start_id) else {
            return;
        };

        if is_sampler_node(node) {
            if !sampler_ids.iter().any(|id| id == start_id) {
                sampler_ids.push(start_id.to_string());
            }
            return;
        }

        for source_id in self.image_like_source_ids(start_id, node) {
            self.find_upstream_samplers(&source_id, visited, depth + 1, sampler_ids);
        }
    }

    fn image_like_source_ids(&self, node_id: &str, node: &Value) -> Vec<String> {
        self.image_like_source_ids_with_wireless(node_id, node, true)
    }

    fn direct_image_like_source_ids(&self, node_id: &str, node: &Value) -> Vec<String> {
        self.image_like_source_ids_with_wireless(node_id, node, false)
    }

    fn image_like_source_ids_with_wireless(
        &self,
        node_id: &str,
        node: &Value,
        allow_wireless: bool,
    ) -> Vec<String> {
        let mut sources = Vec::new();

        for input_name in IMAGE_LIKE_INPUT_NAMES {
            for source_id in self.input_source_ids(node_id, node, input_name, allow_wireless) {
                self.push_existing_source(&mut sources, source_id);
            }
        }

        if let Some(inputs) = node.get("inputs").and_then(Value::as_array) {
            for input in inputs {
                let input_type = input.get("type").and_then(Value::as_str).unwrap_or("");
                if !input_type.eq_ignore_ascii_case("IMAGE")
                    && !input_type.eq_ignore_ascii_case("LATENT")
                {
                    continue;
                }

                if let Some(input_name) = input.get("name").and_then(Value::as_str) {
                    for source_id in
                        self.input_source_ids(node_id, node, input_name, allow_wireless)
                    {
                        self.push_existing_source(&mut sources, source_id);
                    }
                }
            }
        }

        sources.sort_by(|left, right| compare_node_ids(left, right));
        sources
    }

    fn input_source_ids(
        &self,
        node_id: &str,
        node: &Value,
        input_name: &str,
        allow_wireless: bool,
    ) -> Vec<String> {
        let direct = get_node_input_links(node, input_name);
        if !direct.is_empty() || !allow_wireless {
            return direct;
        }

        get_source_id(self.graph, node_id, input_name)
            .into_iter()
            .collect()
    }

    fn push_existing_source(&self, sources: &mut Vec<String>, source_id: String) {
        if self.graph.get_node(&source_id).is_some() && !sources.contains(&source_id) {
            sources.push(source_id);
        }
    }

    fn find_root_sampler_ids(&self, start_sampler_id: &str) -> Vec<String> {
        let mut roots = Vec::new();
        let mut visited = HashSet::new();
        self.collect_root_sampler_ids(start_sampler_id, &mut visited, 0, &mut roots);

        if roots.is_empty() {
            roots.push(start_sampler_id.to_string());
        }
        roots.sort_by(|left, right| compare_node_ids(left, right));
        roots.dedup();
        roots
    }

    fn collect_root_sampler_ids(
        &self,
        sampler_id: &str,
        visited: &mut HashSet<String>,
        depth: u32,
        roots: &mut Vec<String>,
    ) {
        if depth > 20 || !visited.insert(sampler_id.to_string()) {
            return;
        }

        let upstream = self.find_upstream_sampler_ids_for_sampler(sampler_id);
        if upstream.is_empty() {
            if !roots.iter().any(|root| root == sampler_id) {
                roots.push(sampler_id.to_string());
            }
            return;
        }

        for upstream_id in upstream {
            self.collect_root_sampler_ids(&upstream_id, visited, depth + 1, roots);
        }
    }

    fn find_upstream_sampler_ids_for_sampler(&self, sampler_id: &str) -> Vec<String> {
        let Some(node) = self.graph.get_node(sampler_id) else {
            return Vec::new();
        };
        let source_ids = self.sampler_latent_source_ids(sampler_id, node);

        let mut upstream_sampler_ids = Vec::new();
        for source_id in source_ids {
            let mut visited = HashSet::new();
            self.find_upstream_samplers(&source_id, &mut visited, 0, &mut upstream_sampler_ids);
        }

        if let Some(conditioning_id) = get_source_id(self.graph, sampler_id, "positive") {
            if let Some(conditioning_node) = self.graph.get_node(&conditioning_id) {
                if get_node_type(conditioning_node) == "StableCascade_StageB_Conditioning" {
                    if let Some(stage_c_id) = get_source_id(self.graph, &conditioning_id, "stage_c")
                    {
                        if self
                            .graph
                            .get_node(&stage_c_id)
                            .is_some_and(is_sampler_node)
                            && !upstream_sampler_ids.contains(&stage_c_id)
                        {
                            upstream_sampler_ids.push(stage_c_id);
                        }
                    }
                }
            }
        }

        upstream_sampler_ids.sort_by(|left, right| compare_node_ids(left, right));
        upstream_sampler_ids.dedup();
        upstream_sampler_ids
    }

    fn sampler_latent_source_ids(&self, sampler_id: &str, node: &Value) -> Vec<String> {
        let mut sources = Vec::new();

        for input_name in SAMPLER_LATENT_INPUT_NAMES {
            for source_id in self.input_source_ids(sampler_id, node, input_name, true) {
                self.push_existing_source(&mut sources, source_id);
            }
        }

        if let Some(inputs) = node.get("inputs").and_then(Value::as_array) {
            for input in inputs {
                if !input
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|input_type| input_type.eq_ignore_ascii_case("LATENT"))
                {
                    continue;
                }

                if let Some(input_name) = input.get("name").and_then(Value::as_str) {
                    for source_id in self.input_source_ids(sampler_id, node, input_name, true) {
                        self.push_existing_source(&mut sources, source_id);
                    }
                }
            }
        }

        sources.sort_by(|left, right| compare_node_ids(left, right));
        sources
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

fn classify_output_candidate(node_type: &str) -> Option<OutputCandidateKind> {
    let normalized: String = node_type
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();

    if normalized.contains("preview")
        && normalized.contains("image")
        && !normalized.contains("save")
    {
        return Some(OutputCandidateKind::Preview);
    }

    if normalized == "sdpromptsaver"
        || normalized == "saveimage"
        || normalized == "imagesave"
        || (normalized.contains("save") && normalized.contains("image"))
    {
        return Some(OutputCandidateKind::PersistedSave);
    }

    None
}

fn is_sampler_node(node: &Value) -> bool {
    let node_type = get_node_type(node);
    (node_type.contains("KSampler")
        && !node_type.contains("Select")
        && !node_type.contains("Provider"))
        || node_type == "SamplerCustomAdvanced"
        || node_type == "SamplerCustom"
        || node_type.contains("StyleAlignedReferenceSampler")
}
