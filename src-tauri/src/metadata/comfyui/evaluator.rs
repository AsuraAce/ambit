use super::diagnostics::{
    metadata_resource_values, resource_fields, ComfyFieldSourceNodeIds, ComfyMetadataField,
    ComfyResourceSourceNodeIds, ComfyTraversalIssue,
};
use super::graph::{
    compare_node_ids, get_input_connection, get_input_source_by_slot, get_node_input_link,
    get_node_input_links, get_node_type, get_source_id, get_switch_branch_input_strict, ComfyGraph,
    InputConnection, InputSourceConnection,
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
    pub(crate) authoritative_sampler_custom_path: bool,
    pub(crate) authoritative_model: bool,
    pub(crate) authoritative_cfg: bool,
    pub(crate) authoritative_positive_prompt: bool,
    pub(crate) authoritative_negative_prompt: bool,
    pub(crate) traversal_issues: Vec<ComfyTraversalIssue>,
    pub(crate) traversal_issues_truncated: bool,
    pub(crate) field_source_node_ids: ComfyFieldSourceNodeIds,
    pub(crate) resource_source_node_ids: ComfyResourceSourceNodeIds,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct OutputSelection {
    pub(crate) selected_output_node_ids: Vec<String>,
    pub(crate) root_sampler_node_ids: Vec<String>,
    pub(crate) ambiguous: bool,
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
        self.extract_with_output_diagnostics_internal(false)
    }

    pub(crate) fn extract_with_traversal_diagnostics(
        &self,
    ) -> (ImageMetadata, OutputTraversalDiagnostics) {
        self.extract_with_output_diagnostics_internal(true)
    }

    fn extract_with_output_diagnostics_internal(
        &self,
        collect_traversal_issues: bool,
    ) -> (ImageMetadata, OutputTraversalDiagnostics) {
        let output_selection = self.output_selection();
        let mut diagnostics = OutputTraversalDiagnostics {
            selected_output_candidate_count: output_selection.selected_output_node_ids.len(),
            unique_root_sampler_count: output_selection.root_sampler_node_ids.len(),
            ambiguous: output_selection.ambiguous,
            ..OutputTraversalDiagnostics::default()
        };

        if diagnostics.ambiguous {
            return (ImageMetadata::default(), diagnostics);
        }

        let Some(root_sampler_id) = output_selection.root_sampler_node_ids.first() else {
            return (ImageMetadata::default(), diagnostics);
        };
        let Some(root_node) = self.graph.get_node(root_sampler_id) else {
            return (ImageMetadata::default(), diagnostics);
        };

        diagnostics.authoritative_sampler_custom_path = get_node_type(root_node) == "SamplerCustom";
        diagnostics.authoritative_positive_prompt =
            get_node_input_link(root_node, "positive").is_some();
        diagnostics.authoritative_negative_prompt =
            get_node_input_link(root_node, "negative").is_some();

        if let Some(guider_id) = get_source_id(self.graph, root_sampler_id, "guider") {
            if let Some(guider_node) = self.graph.get_node(&guider_id) {
                if let Some((_, positive_input, negative_input)) =
                    super::eval_core::cfg_guider_params(guider_node)
                {
                    if super::eval_core::cfg_guider_requires_strict_inputs(guider_node) {
                        diagnostics.authoritative_model = true;
                        diagnostics.authoritative_cfg = true;
                    }
                    diagnostics.authoritative_positive_prompt =
                        get_node_input_link(guider_node, positive_input).is_some();
                    diagnostics.authoritative_negative_prompt =
                        get_node_input_link(guider_node, negative_input).is_some();
                } else if get_node_type(guider_node) == "BasicGuider"
                    && get_node_input_link(guider_node, "conditioning").is_some()
                {
                    diagnostics.authoritative_positive_prompt = true;
                }
            }
        }

        let mut loras = Vec::new();
        let mut ip_adapters = Vec::new();
        let mut hypernetworks = Vec::new();
        let (metadata, field_source_node_ids, resource_source_node_ids) =
            super::eval_core::extract_from_sampler(
                self.graph,
                root_sampler_id,
                root_node,
                &mut loras,
                &mut ip_adapters,
                &mut hypernetworks,
            );
        diagnostics.field_source_node_ids = field_source_node_ids;
        diagnostics.resource_source_node_ids = resource_source_node_ids;

        if collect_traversal_issues {
            let issue_collection = super::traversal_diagnostics::collect_traversal_issues(
                self.graph,
                root_sampler_id,
                root_node,
                &metadata,
            );
            diagnostics.traversal_issues = issue_collection.issues;
            diagnostics.traversal_issues_truncated = issue_collection.truncated;
        }

        (metadata, diagnostics)
    }

    pub(crate) fn output_selection(&self) -> OutputSelection {
        let selected_output_node_ids = self.find_output_nodes();
        let mut root_sampler_node_ids = Vec::new();

        for output_id in &selected_output_node_ids {
            let mut visited = HashSet::new();
            let mut sampler_ids = Vec::new();
            self.find_upstream_samplers(output_id, &mut visited, 0, &mut sampler_ids);

            for sampler_id in sampler_ids {
                for root_sampler_id in self.find_root_sampler_ids(&sampler_id) {
                    if !root_sampler_node_ids.contains(&root_sampler_id) {
                        root_sampler_node_ids.push(root_sampler_id);
                    }
                }
            }
        }

        root_sampler_node_ids.sort_by(|left, right| compare_node_ids(left, right));
        OutputSelection {
            selected_output_node_ids,
            ambiguous: root_sampler_node_ids.len() > 1,
            root_sampler_node_ids,
        }
    }

    pub(crate) fn selected_branch_node_ids(
        &self,
        output_selection: &OutputSelection,
    ) -> Vec<String> {
        if output_selection.ambiguous
            || output_selection.selected_output_node_ids.is_empty()
            || output_selection.root_sampler_node_ids.len() != 1
        {
            return Vec::new();
        }

        let root_sampler_id = &output_selection.root_sampler_node_ids[0];
        let mut branch = HashSet::new();
        let mut pending = Vec::new();

        for output_id in &output_selection.selected_output_node_ids {
            let Some(output_node) = self.graph.get_node(output_id) else {
                return Vec::new();
            };
            branch.insert(output_id.clone());
            pending.extend(self.direct_image_like_source_ids(output_id, output_node));
        }

        while let Some(node_id) = pending.pop() {
            if !branch.insert(node_id.clone()) {
                continue;
            }

            let Some(node) = self.graph.get_node(&node_id) else {
                return Vec::new();
            };

            if get_node_type(node) == "ComfySwitchNode" {
                let Some(branch_input) = get_switch_branch_input_strict(self.graph, node) else {
                    return Vec::new();
                };

                match get_input_connection(node, branch_input) {
                    InputConnection::Connected(source_id) => pending.push(source_id),
                    InputConnection::DeclaredUnresolved => return Vec::new(),
                    InputConnection::Unconnected => {}
                }
                match get_input_connection(node, "switch") {
                    InputConnection::Connected(source_id) => pending.push(source_id),
                    InputConnection::DeclaredUnresolved => return Vec::new(),
                    InputConnection::Unconnected => {}
                }
                continue;
            }

            pending.extend(self.direct_connected_source_ids(&node_id, node));
        }

        if !branch.contains(root_sampler_id) {
            return Vec::new();
        }

        let mut branch_node_ids = branch.into_iter().collect::<Vec<_>>();
        branch_node_ids.sort_by(|left, right| compare_node_ids(left, right));
        branch_node_ids
    }

    pub fn extract_from_all_samplers(
        &self,
    ) -> (
        ImageMetadata,
        ComfyFieldSourceNodeIds,
        ComfyResourceSourceNodeIds,
    ) {
        let mut meta = ImageMetadata::default();
        let mut field_source_node_ids = ComfyFieldSourceNodeIds::new();
        let mut resource_source_node_ids = ComfyResourceSourceNodeIds::new();

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
                    let (partial, partial_sources, partial_resource_sources) =
                        super::eval_core::extract_from_sampler(
                            self.graph,
                            id,
                            node,
                            &mut loras,
                            &mut ip_adapters,
                            &mut hypernetworks,
                        );
                    if partial.steps > 0 || !partial.model.is_empty() {
                        let before = meta.clone();
                        meta.merge(partial);
                        copy_changed_core_sources(
                            &before,
                            &meta,
                            &partial_sources,
                            &mut field_source_node_ids,
                        );
                        copy_changed_resource_sources(
                            &before,
                            &meta,
                            &partial_resource_sources,
                            &mut resource_source_node_ids,
                        );
                        if meta.steps > 0 && !meta.model.is_empty() {
                            return (meta, field_source_node_ids, resource_source_node_ids);
                        }
                    }
                }
            }
        }
        (meta, field_source_node_ids, resource_source_node_ids)
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

    fn find_upstream_latent_samplers(
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

        if get_node_type(node).starts_with("VAEEncode") {
            for source_id in self.image_like_source_ids(start_id, node) {
                self.find_upstream_samplers(&source_id, visited, depth + 1, sampler_ids);
            }
        }

        for source_id in self.latent_source_ids(start_id, node) {
            self.find_upstream_latent_samplers(&source_id, visited, depth + 1, sampler_ids);
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

        if get_node_type(node) == "Reroute" {
            if let Some(source_id) = self.reroute_image_like_source_id(node) {
                self.push_existing_source(&mut sources, source_id);
            }
            return sources;
        }

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

    fn reroute_image_like_source_id(&self, node: &Value) -> Option<String> {
        for input_name in ["", "value", "input", "any"]
            .into_iter()
            .chain(IMAGE_LIKE_INPUT_NAMES)
        {
            match get_input_connection(node, input_name) {
                InputConnection::Connected(source_id) => return Some(source_id),
                InputConnection::DeclaredUnresolved => return None,
                InputConnection::Unconnected => {}
            }
        }

        for input in node.get("inputs").and_then(Value::as_array)? {
            let input_type = input.get("type").and_then(Value::as_str).unwrap_or("");
            if !input_type.eq_ignore_ascii_case("IMAGE")
                && !input_type.eq_ignore_ascii_case("LATENT")
            {
                continue;
            }
            let Some(input_name) = input.get("name").and_then(Value::as_str) else {
                continue;
            };
            match get_input_connection(node, input_name) {
                InputConnection::Connected(source_id) => return Some(source_id),
                InputConnection::DeclaredUnresolved => return None,
                InputConnection::Unconnected => {}
            }
        }

        None
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

    fn direct_connected_source_ids(&self, node_id: &str, node: &Value) -> Vec<String> {
        let mut sources = Vec::new();

        match node.get("inputs") {
            Some(Value::Object(inputs)) => {
                for input_name in inputs.keys() {
                    if let InputConnection::Connected(source_id) =
                        get_input_connection(node, input_name)
                    {
                        self.push_existing_source(&mut sources, source_id);
                    }
                }
            }
            Some(Value::Array(inputs)) => {
                for input_slot in 0..inputs.len() {
                    if let InputSourceConnection::Connected(source) =
                        get_input_source_by_slot(node, input_slot)
                    {
                        self.push_existing_source(&mut sources, source.node_id);
                    }
                }
            }
            _ => {}
        }

        if get_node_type(node) == "GetNode" {
            if let Some(source_id) = get_source_id(self.graph, node_id, "source") {
                self.push_existing_source(&mut sources, source_id);
            }
        }

        sources.sort_by(|left, right| compare_node_ids(left, right));
        sources
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
            self.find_upstream_latent_samplers(
                &source_id,
                &mut visited,
                0,
                &mut upstream_sampler_ids,
            );
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
        self.latent_source_ids(sampler_id, node)
    }

    fn latent_source_ids(&self, node_id: &str, node: &Value) -> Vec<String> {
        let mut sources = Vec::new();

        if get_node_type(node) == "Reroute" {
            if let Some(source_id) = self.reroute_image_like_source_id(node) {
                self.push_existing_source(&mut sources, source_id);
            }
            return sources;
        }

        for input_name in SAMPLER_LATENT_INPUT_NAMES {
            for source_id in self.input_source_ids(node_id, node, input_name, true) {
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
                    for source_id in self.input_source_ids(node_id, node, input_name, true) {
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

fn copy_changed_core_sources(
    before: &ImageMetadata,
    after: &ImageMetadata,
    additions: &ComfyFieldSourceNodeIds,
    selected: &mut ComfyFieldSourceNodeIds,
) {
    for (field, changed) in [
        (ComfyMetadataField::Model, before.model != after.model),
        (ComfyMetadataField::Seed, before.seed != after.seed),
        (ComfyMetadataField::Steps, before.steps != after.steps),
        (ComfyMetadataField::Cfg, before.cfg != after.cfg),
        (ComfyMetadataField::Sampler, before.sampler != after.sampler),
        (
            ComfyMetadataField::PositivePrompt,
            before.positive_prompt != after.positive_prompt,
        ),
        (
            ComfyMetadataField::NegativePrompt,
            before.negative_prompt != after.negative_prompt,
        ),
    ] {
        if changed {
            if let Some(node_ids) = additions.get(&field) {
                selected.insert(field, node_ids.clone());
            } else {
                selected.remove(&field);
            }
        }
    }
}

fn copy_changed_resource_sources(
    before: &ImageMetadata,
    after: &ImageMetadata,
    additions: &ComfyResourceSourceNodeIds,
    selected: &mut ComfyResourceSourceNodeIds,
) {
    for field in resource_fields() {
        let before_values = metadata_resource_values(before, field);
        for value in metadata_resource_values(after, field)
            .iter()
            .filter(|value| !before_values.contains(value))
        {
            if let Some(node_ids) = additions
                .get(&field)
                .and_then(|resources| resources.get(value))
            {
                selected
                    .entry(field)
                    .or_default()
                    .insert(value.clone(), node_ids.clone());
            }
        }
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

pub(crate) fn is_sampler_node(node: &Value) -> bool {
    let node_type = get_node_type(node);
    (node_type.contains("KSampler")
        && !node_type.contains("Select")
        && !node_type.contains("Provider"))
        || node_type == "SamplerCustomAdvanced"
        || node_type == "SamplerCustom"
        || node_type.contains("StyleAlignedReferenceSampler")
}
