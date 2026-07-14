use crate::metadata::{is_missing_prompt_value, ImageMetadata};
use std::collections::BTreeMap;

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

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct ComfyParseDiagnostics {
    pub(crate) graph_node_count: usize,
    pub(crate) selected_output_candidate_count: usize,
    pub(crate) unique_output_root_sampler_count: usize,
    pub(crate) output_ambiguous: bool,
    pub(crate) authoritative_sampler_custom_path: bool,
    pub(crate) attempted_layers: Vec<ComfyParseLayer>,
    pub(crate) field_sources: BTreeMap<ComfyMetadataField, ComfyParseLayer>,
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
        self.record_field(
            ComfyMetadataField::Model,
            before.model != after.model,
            is_known_string(&after.model),
            layer,
        );
        self.record_field(
            ComfyMetadataField::Seed,
            before.seed != after.seed,
            after.seed.is_some(),
            layer,
        );
        self.record_field(
            ComfyMetadataField::Steps,
            before.steps != after.steps,
            after.steps > 0,
            layer,
        );
        self.record_field(
            ComfyMetadataField::Cfg,
            before.cfg != after.cfg,
            after.cfg > 0.0,
            layer,
        );
        self.record_field(
            ComfyMetadataField::Sampler,
            before.sampler != after.sampler,
            is_known_string(&after.sampler),
            layer,
        );
        self.record_field(
            ComfyMetadataField::PositivePrompt,
            before.positive_prompt != after.positive_prompt,
            !is_missing_prompt_value(&after.positive_prompt),
            layer,
        );
        self.record_field(
            ComfyMetadataField::NegativePrompt,
            before.negative_prompt != after.negative_prompt,
            !is_missing_prompt_value(&after.negative_prompt),
            layer,
        );
        self.record_field(
            ComfyMetadataField::Loras,
            before.loras != after.loras,
            !after.loras.is_empty(),
            layer,
        );
        self.record_field(
            ComfyMetadataField::ControlNets,
            before.control_nets != after.control_nets,
            !after.control_nets.is_empty(),
            layer,
        );
        self.record_field(
            ComfyMetadataField::IpAdapters,
            before.ip_adapters != after.ip_adapters,
            !after.ip_adapters.is_empty(),
            layer,
        );
        self.record_field(
            ComfyMetadataField::Embeddings,
            before.embeddings != after.embeddings,
            !after.embeddings.is_empty(),
            layer,
        );
        self.record_field(
            ComfyMetadataField::Hypernetworks,
            before.hypernetworks != after.hypernetworks,
            !after.hypernetworks.is_empty(),
            layer,
        );
        self.record_field(
            ComfyMetadataField::WorkflowJson,
            before.has_workflow_json != after.workflow_json.is_some(),
            after.workflow_json.is_some(),
            layer,
        );
        self.record_field(
            ComfyMetadataField::WorkflowHint,
            before.has_workflow_hint != after.has_workflow_hint,
            after.has_workflow_hint,
            layer,
        );
    }

    fn record_field(
        &mut self,
        field: ComfyMetadataField,
        changed: bool,
        has_value: bool,
        layer: ComfyParseLayer,
    ) {
        let is_stronger_source = self
            .field_sources
            .get(&field)
            .is_none_or(|current| layer.precedence() > current.precedence());
        if changed && has_value && is_stronger_source {
            self.field_sources.insert(field, layer);
        }
    }
}

fn is_known_string(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed != "Unknown" && trimmed != "None"
}
