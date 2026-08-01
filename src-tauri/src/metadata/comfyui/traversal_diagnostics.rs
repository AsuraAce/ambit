use super::diagnostics::{ComfyMetadataField, ComfyTraversalIssue, ComfyTraversalIssueReason};
use super::graph::{
    get_input_source, get_node_param, get_node_type, ComfyGraph, InputSource, InputSourceConnection,
};
use super::heuristics::is_primary_model_loader_type;
use crate::metadata::{is_missing_prompt_value, ImageMetadata};
use serde_json::Value;
use std::collections::HashSet;

const MAX_TRAVERSAL_ISSUES: usize = 32;
const MAX_MODEL_TRACE_DEPTH: usize = 20;
const MAX_PROMPT_TRACE_DEPTH: usize = 10;

pub(crate) struct TraversalIssueCollection {
    pub(crate) issues: Vec<ComfyTraversalIssue>,
    pub(crate) truncated: bool,
}

struct IssueCollector {
    issues: Vec<ComfyTraversalIssue>,
}

pub(crate) fn collect_traversal_issues(
    graph: &ComfyGraph,
    root_sampler_id: &str,
    root_sampler: &Value,
    metadata: &ImageMetadata,
) -> TraversalIssueCollection {
    let mut collector = IssueCollector { issues: Vec::new() };
    let sampler_type = get_node_type(root_sampler);

    if !is_known_model(&metadata.model) {
        collector.trace_model_input(
            graph,
            root_sampler_id,
            root_sampler,
            "model",
            &mut HashSet::new(),
            0,
        );
    }

    if metadata.seed.is_none() {
        let seed_input = if sampler_type == "SamplerCustom" {
            "noise_seed"
        } else {
            "seed"
        };
        collector.trace_scalar_input(
            graph,
            root_sampler_id,
            root_sampler,
            seed_input,
            ComfyMetadataField::Seed,
        );
    }

    if metadata.steps == 0 {
        collector.trace_sampler_steps(graph, root_sampler_id, root_sampler);
    }

    if metadata.cfg == 0.0 {
        collector.trace_sampler_cfg(graph, root_sampler_id, root_sampler);
    }

    if metadata.sampler.is_empty() || metadata.sampler == "Unknown" {
        collector.trace_sampler_name(graph, root_sampler_id, root_sampler);
    }

    if is_missing_prompt_value(&metadata.positive_prompt) {
        collector.trace_sampler_prompt(
            graph,
            root_sampler_id,
            root_sampler,
            "positive",
            ComfyMetadataField::PositivePrompt,
        );
    }
    if is_missing_prompt_value(&metadata.negative_prompt) {
        collector.trace_sampler_prompt(
            graph,
            root_sampler_id,
            root_sampler,
            "negative",
            ComfyMetadataField::NegativePrompt,
        );
    }

    collector.finish()
}

impl IssueCollector {
    fn finish(mut self) -> TraversalIssueCollection {
        self.issues.sort();
        self.issues.dedup();
        let truncated = self.issues.len() > MAX_TRAVERSAL_ISSUES;
        self.issues.truncate(MAX_TRAVERSAL_ISSUES);
        TraversalIssueCollection {
            issues: self.issues,
            truncated,
        }
    }

    fn push(
        &mut self,
        field: ComfyMetadataField,
        node_id: impl Into<String>,
        node_type: impl Into<String>,
        input_name: Option<&str>,
        reason: ComfyTraversalIssueReason,
    ) {
        self.issues.push(ComfyTraversalIssue {
            field,
            node_id: node_id.into(),
            node_type: node_type.into(),
            input_name: input_name.map(str::to_string),
            reason,
        });
    }

    fn trace_scalar_input(
        &mut self,
        graph: &ComfyGraph,
        owner_id: &str,
        owner: &Value,
        input_name: &str,
        field: ComfyMetadataField,
    ) {
        match get_input_source(owner, input_name) {
            InputSourceConnection::DeclaredUnresolved => self.push(
                field,
                owner_id,
                get_node_type(owner),
                Some(input_name),
                ComfyTraversalIssueReason::DeclaredLinkUnresolved,
            ),
            InputSourceConnection::Connected(source) => {
                self.report_connected_failure(graph, input_name, &source, field)
            }
            InputSourceConnection::Unconnected => {}
        }
    }

    fn report_connected_failure(
        &mut self,
        graph: &ComfyGraph,
        input_name: &str,
        source: &InputSource,
        field: ComfyMetadataField,
    ) {
        if let Some(source_node) = graph.get_node(&source.node_id) {
            self.push(
                field,
                &source.node_id,
                get_node_type(source_node),
                Some(input_name),
                ComfyTraversalIssueReason::UnsupportedNode,
            );
        } else {
            self.push(
                field,
                &source.node_id,
                "Unknown",
                Some(input_name),
                ComfyTraversalIssueReason::MissingSourceNode,
            );
        }
    }

    fn trace_sampler_steps(&mut self, graph: &ComfyGraph, sampler_id: &str, sampler: &Value) {
        if get_input_source(sampler, "steps") != InputSourceConnection::Unconnected {
            self.trace_scalar_input(
                graph,
                sampler_id,
                sampler,
                "steps",
                ComfyMetadataField::Steps,
            );
            return;
        }
        self.trace_nested_input(
            graph,
            sampler_id,
            sampler,
            "sigmas",
            "steps",
            ComfyMetadataField::Steps,
        );
    }

    fn trace_sampler_cfg(&mut self, graph: &ComfyGraph, sampler_id: &str, sampler: &Value) {
        if get_input_source(sampler, "cfg") != InputSourceConnection::Unconnected {
            self.trace_scalar_input(graph, sampler_id, sampler, "cfg", ComfyMetadataField::Cfg);
            return;
        }
        match get_input_source(sampler, "guider") {
            InputSourceConnection::DeclaredUnresolved => self.push(
                ComfyMetadataField::Cfg,
                sampler_id,
                get_node_type(sampler),
                Some("guider"),
                ComfyTraversalIssueReason::DeclaredLinkUnresolved,
            ),
            InputSourceConnection::Connected(source) => {
                let Some(guider) = graph.get_node(&source.node_id) else {
                    self.push(
                        ComfyMetadataField::Cfg,
                        &source.node_id,
                        "Unknown",
                        Some("guider"),
                        ComfyTraversalIssueReason::MissingSourceNode,
                    );
                    return;
                };
                if let Some((cfg_input, _, _)) = super::eval_core::cfg_guider_params(guider) {
                    self.trace_scalar_input(
                        graph,
                        &source.node_id,
                        guider,
                        cfg_input,
                        ComfyMetadataField::Cfg,
                    );
                } else if get_node_type(guider) != "BasicGuider" {
                    self.push(
                        ComfyMetadataField::Cfg,
                        &source.node_id,
                        get_node_type(guider),
                        Some("guider"),
                        ComfyTraversalIssueReason::UnsupportedNode,
                    );
                }
            }
            InputSourceConnection::Unconnected => {}
        }
    }

    fn trace_sampler_name(&mut self, graph: &ComfyGraph, sampler_id: &str, sampler: &Value) {
        if get_input_source(sampler, "sampler_name") != InputSourceConnection::Unconnected {
            self.trace_scalar_input(
                graph,
                sampler_id,
                sampler,
                "sampler_name",
                ComfyMetadataField::Sampler,
            );
            return;
        }
        self.trace_nested_input(
            graph,
            sampler_id,
            sampler,
            "sampler",
            "sampler_name",
            ComfyMetadataField::Sampler,
        );
    }

    fn trace_nested_input(
        &mut self,
        graph: &ComfyGraph,
        owner_id: &str,
        owner: &Value,
        outer_input: &str,
        inner_input: &str,
        field: ComfyMetadataField,
    ) {
        match get_input_source(owner, outer_input) {
            InputSourceConnection::DeclaredUnresolved => self.push(
                field,
                owner_id,
                get_node_type(owner),
                Some(outer_input),
                ComfyTraversalIssueReason::DeclaredLinkUnresolved,
            ),
            InputSourceConnection::Connected(source) => {
                let Some(source_node) = graph.get_node(&source.node_id) else {
                    self.push(
                        field,
                        &source.node_id,
                        "Unknown",
                        Some(outer_input),
                        ComfyTraversalIssueReason::MissingSourceNode,
                    );
                    return;
                };
                match get_input_source(source_node, inner_input) {
                    InputSourceConnection::Unconnected => self.push(
                        field,
                        &source.node_id,
                        get_node_type(source_node),
                        Some(inner_input),
                        ComfyTraversalIssueReason::UnsupportedNode,
                    ),
                    InputSourceConnection::DeclaredUnresolved => self.push(
                        field,
                        &source.node_id,
                        get_node_type(source_node),
                        Some(inner_input),
                        ComfyTraversalIssueReason::DeclaredLinkUnresolved,
                    ),
                    InputSourceConnection::Connected(inner_source) => {
                        self.report_connected_failure(graph, inner_input, &inner_source, field)
                    }
                }
            }
            InputSourceConnection::Unconnected => {}
        }
    }

    fn trace_model_input(
        &mut self,
        graph: &ComfyGraph,
        owner_id: &str,
        owner: &Value,
        input_name: &str,
        visited: &mut HashSet<String>,
        depth: usize,
    ) {
        let field = ComfyMetadataField::Model;
        let source = match get_input_source(owner, input_name) {
            InputSourceConnection::Connected(source) => source,
            InputSourceConnection::DeclaredUnresolved => {
                self.push(
                    field,
                    owner_id,
                    get_node_type(owner),
                    Some(input_name),
                    ComfyTraversalIssueReason::DeclaredLinkUnresolved,
                );
                return;
            }
            InputSourceConnection::Unconnected => return,
        };
        self.trace_model_source(graph, &source, Some(input_name), visited, depth + 1);
    }

    fn trace_model_source(
        &mut self,
        graph: &ComfyGraph,
        source: &InputSource,
        input_name: Option<&str>,
        visited: &mut HashSet<String>,
        depth: usize,
    ) {
        let field = ComfyMetadataField::Model;
        if depth > MAX_MODEL_TRACE_DEPTH {
            self.push(
                field,
                &source.node_id,
                "Unknown",
                input_name,
                ComfyTraversalIssueReason::DepthLimit,
            );
            return;
        }
        if !visited.insert(source.node_id.clone()) {
            self.push(
                field,
                &source.node_id,
                "Unknown",
                input_name,
                ComfyTraversalIssueReason::CycleDetected,
            );
            return;
        }
        let Some(node) = graph.get_node(&source.node_id) else {
            self.push(
                field,
                &source.node_id,
                "Unknown",
                input_name,
                ComfyTraversalIssueReason::MissingSourceNode,
            );
            return;
        };
        let node_type = get_node_type(node);
        if is_primary_model_loader_type(node_type) || node_type == "SDParameterGenerator" {
            self.push(
                field,
                &source.node_id,
                node_type,
                input_name,
                ComfyTraversalIssueReason::UnsupportedNode,
            );
            return;
        }

        for candidate in ["model", "ckpt", "base_model", "MODEL", "COMBO"] {
            match get_input_source(node, candidate) {
                InputSourceConnection::Connected(next) => {
                    self.trace_model_source(graph, &next, Some(candidate), visited, depth + 1);
                    return;
                }
                InputSourceConnection::DeclaredUnresolved => {
                    self.push(
                        field,
                        &source.node_id,
                        node_type,
                        Some(candidate),
                        ComfyTraversalIssueReason::DeclaredLinkUnresolved,
                    );
                    return;
                }
                InputSourceConnection::Unconnected => {}
            }
        }

        self.push(
            field,
            &source.node_id,
            node_type,
            input_name,
            ComfyTraversalIssueReason::UnsupportedNode,
        );
    }

    fn trace_sampler_prompt(
        &mut self,
        graph: &ComfyGraph,
        sampler_id: &str,
        sampler: &Value,
        input_name: &str,
        field: ComfyMetadataField,
    ) {
        let (owner_id, owner, selected_input) = match get_input_source(sampler, "guider") {
            InputSourceConnection::Connected(source) => {
                let Some(guider) = graph.get_node(&source.node_id) else {
                    self.push(
                        field,
                        &source.node_id,
                        "Unknown",
                        Some("guider"),
                        ComfyTraversalIssueReason::MissingSourceNode,
                    );
                    return;
                };
                let selected = match (get_node_type(guider), input_name) {
                    ("BasicGuider", "positive") => Some("conditioning"),
                    ("BasicGuider", "negative") => return,
                    _ => super::eval_core::cfg_guider_params(guider).map(
                        |(_, positive, negative)| {
                            if input_name == "negative" {
                                negative
                            } else {
                                positive
                            }
                        },
                    ),
                };
                if let Some(selected) = selected {
                    (source.node_id, guider, selected)
                } else {
                    self.push(
                        field,
                        &source.node_id,
                        get_node_type(guider),
                        Some("guider"),
                        ComfyTraversalIssueReason::UnsupportedNode,
                    );
                    return;
                }
            }
            InputSourceConnection::DeclaredUnresolved => {
                self.push(
                    field,
                    sampler_id,
                    get_node_type(sampler),
                    Some("guider"),
                    ComfyTraversalIssueReason::DeclaredLinkUnresolved,
                );
                return;
            }
            InputSourceConnection::Unconnected => (sampler_id.to_string(), sampler, input_name),
        };

        let mut visited = HashSet::new();
        self.trace_prompt_input(
            graph,
            &owner_id,
            owner,
            selected_input,
            field,
            &mut visited,
            0,
        );
    }

    fn trace_prompt_input(
        &mut self,
        graph: &ComfyGraph,
        owner_id: &str,
        owner: &Value,
        input_name: &str,
        field: ComfyMetadataField,
        visited: &mut HashSet<String>,
        depth: usize,
    ) {
        match get_input_source(owner, input_name) {
            InputSourceConnection::Connected(source) => self.trace_prompt_source(
                graph,
                &source,
                Some(input_name),
                field,
                visited,
                depth + 1,
            ),
            InputSourceConnection::DeclaredUnresolved => self.push(
                field,
                owner_id,
                get_node_type(owner),
                Some(input_name),
                ComfyTraversalIssueReason::DeclaredLinkUnresolved,
            ),
            InputSourceConnection::Unconnected => {}
        }
    }

    fn trace_prompt_source(
        &mut self,
        graph: &ComfyGraph,
        source: &InputSource,
        input_name: Option<&str>,
        field: ComfyMetadataField,
        visited: &mut HashSet<String>,
        depth: usize,
    ) {
        if depth > MAX_PROMPT_TRACE_DEPTH {
            self.push(
                field,
                &source.node_id,
                "Unknown",
                input_name,
                ComfyTraversalIssueReason::DepthLimit,
            );
            return;
        }
        if !visited.insert(source.node_id.clone()) {
            self.push(
                field,
                &source.node_id,
                "Unknown",
                input_name,
                ComfyTraversalIssueReason::CycleDetected,
            );
            return;
        }
        let Some(node) = graph.get_node(&source.node_id) else {
            self.push(
                field,
                &source.node_id,
                "Unknown",
                input_name,
                ComfyTraversalIssueReason::MissingSourceNode,
            );
            return;
        };
        let node_type = get_node_type(node);
        if node_type == "ConditioningZeroOut" {
            return;
        }
        if is_generated_text_node(node_type) {
            self.push(
                field,
                &source.node_id,
                node_type,
                input_name,
                ComfyTraversalIssueReason::GeneratedValueUnavailable,
            );
            return;
        }
        let candidates: &[&str] = match field {
            ComfyMetadataField::NegativePrompt => &[
                "negative",
                "conditioning",
                "conditioning_1",
                "conditioning_2",
                "text",
                "prompt",
                "value",
                "input",
            ],
            _ => &[
                "positive",
                "conditioning",
                "conditioning_1",
                "conditioning_2",
                "text",
                "prompt",
                "value",
                "input",
            ],
        };

        for candidate in candidates {
            match get_input_source(node, candidate) {
                InputSourceConnection::Connected(next) => {
                    self.trace_prompt_source(
                        graph,
                        &next,
                        Some(candidate),
                        field,
                        visited,
                        depth + 1,
                    );
                    return;
                }
                InputSourceConnection::DeclaredUnresolved => {
                    self.push(
                        field,
                        &source.node_id,
                        node_type,
                        Some(candidate),
                        ComfyTraversalIssueReason::DeclaredLinkUnresolved,
                    );
                    return;
                }
                InputSourceConnection::Unconnected => {}
            }
        }

        if has_direct_text_value(node) {
            return;
        }

        self.push(
            field,
            &source.node_id,
            node_type,
            input_name,
            ComfyTraversalIssueReason::UnsupportedNode,
        );
    }
}

fn is_known_model(model: &str) -> bool {
    !model.is_empty() && model != "Unknown" && model != "None"
}

fn is_generated_text_node(node_type: &str) -> bool {
    let normalized = node_type.to_ascii_lowercase();
    normalized.contains("textgenerate")
        || normalized.contains("ollamagenerate")
        || normalized.contains("florence")
}

fn has_direct_text_value(node: &Value) -> bool {
    ["text", "prompt", "value", "string", "populated_text"]
        .into_iter()
        .any(|input| {
            get_node_param(node, input)
                .and_then(Value::as_str)
                .is_some()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_collection_is_sorted_deduplicated_and_capped() {
        let mut collector = IssueCollector { issues: Vec::new() };
        for index in (0..40).rev() {
            collector.push(
                ComfyMetadataField::PositivePrompt,
                format!("node-{index:02}"),
                "UnknownTextNode",
                Some("text"),
                ComfyTraversalIssueReason::UnsupportedNode,
            );
        }
        collector.push(
            ComfyMetadataField::PositivePrompt,
            "node-00",
            "UnknownTextNode",
            Some("text"),
            ComfyTraversalIssueReason::UnsupportedNode,
        );

        let collection = collector.finish();

        assert!(collection.truncated);
        assert_eq!(collection.issues.len(), MAX_TRAVERSAL_ISSUES);
        assert_eq!(collection.issues[0].node_id, "node-00");
        assert_eq!(collection.issues[31].node_id, "node-31");
    }
}
