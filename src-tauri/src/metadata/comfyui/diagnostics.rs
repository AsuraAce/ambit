use crate::metadata::{is_missing_prompt_value, ImageMetadata};
use std::collections::BTreeMap;

pub(crate) type ComfyFieldSourceNodeIds = BTreeMap<ComfyMetadataField, Vec<String>>;
pub(crate) type ComfyResourceSourceNodeIds =
    BTreeMap<ComfyMetadataField, BTreeMap<String, Vec<String>>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ComfyResourceProvenance {
    pub(crate) layer: ComfyParseLayer,
    pub(crate) node_ids: Vec<String>,
}

pub(crate) type ComfyResourceSources =
    BTreeMap<ComfyMetadataField, BTreeMap<String, ComfyResourceProvenance>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) enum ComfyParseLayer {
    FlatParameters,
    WorkflowChunk,
    ExplicitNode,
    SamplerTraversal,
    SamplerFallback,
    GlobalScan,
}

impl ComfyParseLayer {
    pub(crate) fn precedence(self) -> u8 {
        match self {
            Self::ExplicitNode => 5,
            Self::SamplerTraversal => 4,
            Self::FlatParameters => 3,
            Self::SamplerFallback => 2,
            Self::GlobalScan => 1,
            Self::WorkflowChunk => 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) enum ComfyMetadataField {
    Model,
    Seed,
    Steps,
    Cfg,
    Sampler,
    PositivePrompt,
    NegativePrompt,
    Loras,
    ControlNets,
    IpAdapters,
    Embeddings,
    Hypernetworks,
    WorkflowJson,
    WorkflowHint,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) enum ComfyTraversalIssueReason {
    DeclaredLinkUnresolved,
    MissingSourceNode,
    UnsupportedNode,
    GeneratedValueUnavailable,
    CycleDetected,
    DepthLimit,
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) struct ComfyTraversalIssue {
    pub(crate) field: ComfyMetadataField,
    pub(crate) node_id: String,
    pub(crate) node_type: String,
    pub(crate) input_name: Option<String>,
    pub(crate) reason: ComfyTraversalIssueReason,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct ComfyParseDiagnostics {
    pub(crate) graph_node_count: usize,
    pub(crate) selected_output_candidate_count: usize,
    pub(crate) unique_output_root_sampler_count: usize,
    pub(crate) output_ambiguous: bool,
    pub(crate) authoritative_sampler_custom_path: bool,
    pub(crate) traversal_issues: Vec<ComfyTraversalIssue>,
    pub(crate) traversal_issues_truncated: bool,
    pub(crate) attempted_layers: Vec<ComfyParseLayer>,
    pub(crate) field_sources: BTreeMap<ComfyMetadataField, ComfyParseLayer>,
    pub(crate) field_source_node_ids: ComfyFieldSourceNodeIds,
    pub(crate) resource_sources: ComfyResourceSources,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ComfyMetadataSnapshot {
    model: String,
    seed: Option<i64>,
    steps: u32,
    cfg: f32,
    sampler: String,
    positive_prompt: String,
    negative_prompt: String,
    loras: Vec<String>,
    control_nets: Vec<String>,
    ip_adapters: Vec<String>,
    embeddings: Vec<String>,
    hypernetworks: Vec<String>,
    has_workflow_json: bool,
    has_workflow_hint: bool,
}

impl ComfyMetadataSnapshot {
    pub(crate) fn from_metadata(meta: &ImageMetadata) -> Self {
        Self {
            model: meta.model.clone(),
            seed: meta.seed,
            steps: meta.steps,
            cfg: meta.cfg,
            sampler: meta.sampler.clone(),
            positive_prompt: meta.positive_prompt.clone(),
            negative_prompt: meta.negative_prompt.clone(),
            loras: meta.loras.clone(),
            control_nets: meta.control_nets.clone(),
            ip_adapters: meta.ip_adapters.clone(),
            embeddings: meta.embeddings.clone(),
            hypernetworks: meta.hypernetworks.clone(),
            has_workflow_json: meta.workflow_json.is_some(),
            has_workflow_hint: meta.has_workflow_hint,
        }
    }
}

impl ComfyParseDiagnostics {
    pub(crate) fn attempt(&mut self, layer: ComfyParseLayer) {
        if !self.attempted_layers.contains(&layer) {
            self.attempted_layers.push(layer);
        }
    }

    pub(crate) fn record_diff(
        &mut self,
        before: &ComfyMetadataSnapshot,
        after: &ImageMetadata,
        layer: ComfyParseLayer,
    ) {
        self.record_diff_with_sources(before, after, layer, &ComfyFieldSourceNodeIds::new());
    }

    pub(crate) fn record_diff_with_sources(
        &mut self,
        before: &ComfyMetadataSnapshot,
        after: &ImageMetadata,
        layer: ComfyParseLayer,
        source_node_ids: &ComfyFieldSourceNodeIds,
    ) {
        self.record_diff_with_all_sources(
            before,
            after,
            layer,
            source_node_ids,
            &ComfyResourceSourceNodeIds::new(),
        );
    }

    pub(crate) fn record_diff_with_all_sources(
        &mut self,
        before: &ComfyMetadataSnapshot,
        after: &ImageMetadata,
        layer: ComfyParseLayer,
        source_node_ids: &ComfyFieldSourceNodeIds,
        resource_source_node_ids: &ComfyResourceSourceNodeIds,
    ) {
        self.record_field(
            ComfyMetadataField::Model,
            before.model != after.model,
            is_known_string(&after.model),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::Seed,
            before.seed != after.seed,
            after.seed.is_some(),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::Steps,
            before.steps != after.steps,
            after.steps > 0,
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::Cfg,
            before.cfg != after.cfg,
            after.cfg > 0.0,
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::Sampler,
            before.sampler != after.sampler,
            is_known_string(&after.sampler),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::PositivePrompt,
            before.positive_prompt != after.positive_prompt,
            !is_missing_prompt_value(&after.positive_prompt),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::NegativePrompt,
            before.negative_prompt != after.negative_prompt,
            !is_missing_prompt_value(&after.negative_prompt),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::Loras,
            before.loras != after.loras,
            !after.loras.is_empty(),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::ControlNets,
            before.control_nets != after.control_nets,
            !after.control_nets.is_empty(),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::IpAdapters,
            before.ip_adapters != after.ip_adapters,
            !after.ip_adapters.is_empty(),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::Embeddings,
            before.embeddings != after.embeddings,
            !after.embeddings.is_empty(),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::Hypernetworks,
            before.hypernetworks != after.hypernetworks,
            !after.hypernetworks.is_empty(),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::WorkflowJson,
            before.has_workflow_json != after.workflow_json.is_some(),
            after.workflow_json.is_some(),
            layer,
            source_node_ids,
        );
        self.record_field(
            ComfyMetadataField::WorkflowHint,
            before.has_workflow_hint != after.has_workflow_hint,
            after.has_workflow_hint,
            layer,
            source_node_ids,
        );

        for field in resource_fields() {
            self.record_resource_diff(
                field,
                before.resource_values(field),
                metadata_resource_values(after, field),
                layer,
                resource_source_node_ids,
            );
        }
    }

    pub(crate) fn record_resource_source(
        &mut self,
        field: ComfyMetadataField,
        value: &str,
        layer: ComfyParseLayer,
        node_ids: &[String],
    ) {
        let item_sources = self.resource_sources.entry(field).or_default();
        match item_sources.get_mut(value) {
            Some(current) if layer.precedence() > current.layer.precedence() => {
                current.layer = layer;
                current.node_ids = sorted_node_ids(node_ids);
            }
            Some(current) if layer == current.layer => {
                current.node_ids.extend(node_ids.iter().cloned());
                current.node_ids = sorted_node_ids(&current.node_ids);
            }
            Some(_) => {}
            None => {
                item_sources.insert(
                    value.to_string(),
                    ComfyResourceProvenance {
                        layer,
                        node_ids: sorted_node_ids(node_ids),
                    },
                );
            }
        }
    }

    fn record_resource_diff(
        &mut self,
        field: ComfyMetadataField,
        before: &[String],
        after: &[String],
        layer: ComfyParseLayer,
        source_node_ids: &ComfyResourceSourceNodeIds,
    ) {
        for value in after.iter().filter(|value| !before.contains(value)) {
            let node_ids = source_node_ids
                .get(&field)
                .and_then(|items| items.get(value))
                .map(Vec::as_slice)
                .unwrap_or_default();
            self.record_resource_source(field, value, layer, node_ids);
        }
    }

    fn record_field(
        &mut self,
        field: ComfyMetadataField,
        changed: bool,
        has_value: bool,
        layer: ComfyParseLayer,
        source_node_ids: &ComfyFieldSourceNodeIds,
    ) {
        let is_stronger_source = self
            .field_sources
            .get(&field)
            .is_none_or(|current| layer.precedence() > current.precedence());
        if changed && has_value && is_stronger_source {
            self.field_sources.insert(field, layer);
            if let Some(node_ids) = source_node_ids.get(&field).filter(|ids| !ids.is_empty()) {
                self.field_source_node_ids.insert(field, node_ids.clone());
            } else {
                self.field_source_node_ids.remove(&field);
            }
        }
    }
}

impl ComfyMetadataSnapshot {
    fn resource_values(&self, field: ComfyMetadataField) -> &[String] {
        match field {
            ComfyMetadataField::Loras => &self.loras,
            ComfyMetadataField::ControlNets => &self.control_nets,
            ComfyMetadataField::IpAdapters => &self.ip_adapters,
            ComfyMetadataField::Embeddings => &self.embeddings,
            ComfyMetadataField::Hypernetworks => &self.hypernetworks,
            _ => &[],
        }
    }
}

pub(crate) fn push_resource_source_node_id(
    sources: &mut ComfyResourceSourceNodeIds,
    field: ComfyMetadataField,
    value: &str,
    node_id: &str,
) {
    let node_ids = sources
        .entry(field)
        .or_default()
        .entry(value.to_string())
        .or_default();
    if !node_ids.iter().any(|current| current == node_id) {
        node_ids.push(node_id.to_string());
    }
}

pub(crate) fn resource_fields() -> [ComfyMetadataField; 5] {
    [
        ComfyMetadataField::Loras,
        ComfyMetadataField::ControlNets,
        ComfyMetadataField::IpAdapters,
        ComfyMetadataField::Embeddings,
        ComfyMetadataField::Hypernetworks,
    ]
}

pub(crate) fn metadata_resource_values(
    metadata: &ImageMetadata,
    field: ComfyMetadataField,
) -> &[String] {
    match field {
        ComfyMetadataField::Loras => &metadata.loras,
        ComfyMetadataField::ControlNets => &metadata.control_nets,
        ComfyMetadataField::IpAdapters => &metadata.ip_adapters,
        ComfyMetadataField::Embeddings => &metadata.embeddings,
        ComfyMetadataField::Hypernetworks => &metadata.hypernetworks,
        _ => &[],
    }
}

fn sorted_node_ids(node_ids: &[String]) -> Vec<String> {
    let mut node_ids = node_ids.to_vec();
    node_ids.sort_by(|left, right| super::graph::compare_node_ids(left, right));
    node_ids.dedup();
    node_ids
}

fn is_known_string(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed != "Unknown" && trimmed != "None"
}
