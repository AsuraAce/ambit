use serde_json::Value;
use std::collections::HashMap;

use super::graph::compare_node_ids;

const MAX_SUBGRAPH_DEPTH: usize = 16;
const MAX_EXPANDED_NODES: usize = 10_000;
const MAX_EXPANDED_EDGES: usize = 50_000;
const MAX_EXPANDED_CLONED_BYTES: usize = 32 * 1024 * 1024;
const INPUT_BOUNDARY: &str = "\u{0}subgraph_input";
const OUTPUT_BOUNDARY: &str = "\u{0}subgraph_output";

#[derive(Clone, Copy)]
struct ExpansionLimits {
    nodes: usize,
    edges: usize,
    cloned_bytes: usize,
}

impl Default for ExpansionLimits {
    fn default() -> Self {
        Self {
            nodes: MAX_EXPANDED_NODES,
            edges: MAX_EXPANDED_EDGES,
            cloned_bytes: MAX_EXPANDED_CLONED_BYTES,
        }
    }
}

struct ExpansionBudget {
    limits: ExpansionLimits,
    nodes: usize,
    edges: usize,
    cloned_bytes: usize,
    exhausted: bool,
}

impl ExpansionBudget {
    fn new(limits: ExpansionLimits) -> Self {
        Self {
            limits,
            nodes: 0,
            edges: 0,
            cloned_bytes: 0,
            exhausted: false,
        }
    }

    fn reserve_node(&mut self, node: &Value, extra_bytes: usize) -> bool {
        let Some(bytes) = self.value_clone_bytes(node, extra_bytes) else {
            return false;
        };
        self.reserve(1, 0, bytes)
    }

    fn reserve_edge(&mut self, edge: &WorkflowEdge) -> bool {
        let bytes = edge.link_id.as_ref().map_or(0, String::len)
            + edge.source_id.len()
            + edge.target_id.len()
            + edge.link_type.len();
        self.reserve(0, 1, bytes)
    }

    fn reserve_raw_edge(&mut self, edge: &BorrowedWorkflowEdge<'_>) -> bool {
        let bytes = edge.link_id.as_ref().map_or(0, BorrowedId::owned_len)
            + edge.source_id.owned_len()
            + edge.target_id.owned_len()
            + edge.link_type.len();
        self.reserve(0, 1, bytes)
    }

    fn reserve_value_clone(&mut self, value: &Value, extra_bytes: usize) -> bool {
        let Some(bytes) = self.value_clone_bytes(value, extra_bytes) else {
            return false;
        };
        self.reserve(0, 0, bytes)
    }

    fn reserve_auxiliary_clone(&mut self, bytes: usize) -> bool {
        self.reserve(0, 0, bytes)
    }

    fn value_clone_bytes(&mut self, value: &Value, extra_bytes: usize) -> Option<usize> {
        if self.exhausted {
            return None;
        }
        let remaining = self.limits.cloned_bytes.saturating_sub(self.cloned_bytes);
        let Some(available) = remaining.checked_sub(extra_bytes) else {
            self.exhausted = true;
            return None;
        };
        let Some(bytes) = estimate_clone_bytes(value, available) else {
            self.exhausted = true;
            return None;
        };
        match bytes.checked_add(extra_bytes) {
            Some(total) => Some(total),
            None => {
                self.exhausted = true;
                None
            }
        }
    }

    fn reserve(&mut self, nodes: usize, edges: usize, cloned_bytes: usize) -> bool {
        if self.exhausted {
            return false;
        }
        let Some(next_nodes) = self.nodes.checked_add(nodes) else {
            self.exhausted = true;
            return false;
        };
        let Some(next_edges) = self.edges.checked_add(edges) else {
            self.exhausted = true;
            return false;
        };
        let Some(next_bytes) = self.cloned_bytes.checked_add(cloned_bytes) else {
            self.exhausted = true;
            return false;
        };
        if next_nodes > self.limits.nodes
            || next_edges > self.limits.edges
            || next_bytes > self.limits.cloned_bytes
        {
            self.exhausted = true;
            return false;
        }
        self.nodes = next_nodes;
        self.edges = next_edges;
        self.cloned_bytes = next_bytes;
        true
    }
}

fn estimate_clone_bytes(value: &Value, available: usize) -> Option<usize> {
    fn add(total: &mut usize, amount: usize, available: usize) -> Option<()> {
        *total = total.checked_add(amount)?;
        (*total <= available).then_some(())
    }

    fn visit(value: &Value, total: &mut usize, available: usize) -> Option<()> {
        match value {
            Value::Null => add(total, 1, available),
            Value::Bool(_) => add(total, std::mem::size_of::<bool>(), available),
            Value::Number(_) => add(total, std::mem::size_of::<serde_json::Number>(), available),
            Value::String(value) => add(total, value.len(), available),
            Value::Array(values) => {
                add(
                    total,
                    values.len().saturating_mul(std::mem::size_of::<Value>()),
                    available,
                )?;
                for value in values {
                    visit(value, total, available)?;
                }
                Some(())
            }
            Value::Object(values) => {
                add(
                    total,
                    values.len().saturating_mul(
                        std::mem::size_of::<String>() + std::mem::size_of::<Value>(),
                    ),
                    available,
                )?;
                for (key, value) in values {
                    add(total, key.len(), available)?;
                    visit(value, total, available)?;
                }
                Some(())
            }
        }
    }

    let mut total = 0;
    visit(value, &mut total, available)?;
    Some(total)
}

#[derive(Clone, Debug)]
pub(crate) struct WorkflowEdge {
    pub link_id: Option<String>,
    pub source_id: String,
    pub source_slot: usize,
    pub target_id: String,
    pub target_slot: usize,
    pub link_type: String,
}

#[derive(Clone, Copy)]
enum BorrowedId<'a> {
    String(&'a str),
    Signed(i64),
    Unsigned(u64),
}

impl BorrowedId<'_> {
    fn owned_len(&self) -> usize {
        match self {
            Self::String(value) => value.len(),
            Self::Signed(value) => {
                usize::from(value.is_negative()) + decimal_len(value.unsigned_abs())
            }
            Self::Unsigned(value) => decimal_len(*value),
        }
    }

    fn into_owned(self) -> String {
        match self {
            Self::String(value) => value.to_string(),
            Self::Signed(value) => value.to_string(),
            Self::Unsigned(value) => value.to_string(),
        }
    }
}

struct BorrowedWorkflowEdge<'a> {
    link_id: Option<BorrowedId<'a>>,
    source_id: BorrowedId<'a>,
    source_slot: usize,
    target_id: BorrowedId<'a>,
    target_slot: usize,
    link_type: &'a str,
}

impl BorrowedWorkflowEdge<'_> {
    fn into_owned(self) -> WorkflowEdge {
        WorkflowEdge {
            link_id: self.link_id.map(BorrowedId::into_owned),
            source_id: self.source_id.into_owned(),
            source_slot: self.source_slot,
            target_id: self.target_id.into_owned(),
            target_slot: self.target_slot,
            link_type: self.link_type.to_string(),
        }
    }
}

pub(crate) struct NormalizedWorkflow {
    pub nodes: Vec<Value>,
    pub edges: Vec<WorkflowEdge>,
}

#[derive(Clone)]
struct BoundaryTarget {
    link_id: Option<String>,
    node_id: String,
    slot: usize,
    link_type: String,
}

#[derive(Clone)]
struct BoundarySource {
    node_id: String,
    slot: usize,
    link_type: String,
}

struct WorkflowFragment {
    nodes: HashMap<String, Value>,
    edges: Vec<WorkflowEdge>,
    input_targets: HashMap<usize, Vec<BoundaryTarget>>,
    output_sources: HashMap<usize, Vec<BoundarySource>>,
}

pub(crate) fn normalize_workflow(workflow: &Value) -> Option<NormalizedWorkflow> {
    normalize_workflow_with_limits(workflow, ExpansionLimits::default())
}

fn normalize_workflow_with_limits(
    workflow: &Value,
    limits: ExpansionLimits,
) -> Option<NormalizedWorkflow> {
    let definitions = workflow
        .get("definitions")
        .and_then(|value| value.get("subgraphs"))
        .and_then(Value::as_array)
        .map(|subgraphs| {
            subgraphs
                .iter()
                .filter_map(|definition| value_id(definition.get("id")?).map(|id| (id, definition)))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();

    let mut stack = Vec::new();
    let mut budget = ExpansionBudget::new(limits);
    let fragment = flatten_container(workflow, &definitions, "", None, &mut stack, 0, &mut budget)?;
    Some(NormalizedWorkflow {
        nodes: fragment.nodes.into_values().collect(),
        edges: fragment.edges,
    })
}

fn flatten_container<'a>(
    container: &Value,
    definitions: &HashMap<String, &'a Value>,
    prefix: &str,
    boundary_ids: Option<(String, String)>,
    stack: &mut Vec<String>,
    depth: usize,
    budget: &mut ExpansionBudget,
) -> Option<WorkflowFragment> {
    let source_nodes = container.get("nodes")?.as_array()?;
    let mut local_ids = HashMap::new();
    let mut nodes = HashMap::new();

    for source_node in source_nodes {
        let Some(local_id) = source_node.get("id").and_then(value_id) else {
            continue;
        };
        let namespaced_id = namespace_id(prefix, &local_id);
        if !budget.reserve_node(source_node, namespaced_id.len()) {
            return None;
        }
        let mut node = source_node.clone();
        let Some(object) = node.as_object_mut() else {
            continue;
        };
        object.insert("id".to_string(), Value::String(namespaced_id.clone()));
        local_ids.insert(local_id, namespaced_id.clone());
        nodes.insert(namespaced_id, node);
    }

    let (input_id, output_id) = boundary_ids
        .map(|(input, output)| (Some(input), Some(output)))
        .unwrap_or((None, None));
    let mut edges = Vec::new();
    if let Some(raw_edges) = container.get("links").and_then(Value::as_array) {
        for raw_edge in raw_edges {
            let Some(raw_edge) = parse_borrowed_edge(raw_edge) else {
                continue;
            };
            if !budget.reserve_raw_edge(&raw_edge) {
                return None;
            }
            let mut edge = raw_edge.into_owned();
            let mapped_source = map_endpoint(
                &edge.source_id,
                &local_ids,
                input_id.as_deref(),
                output_id.as_deref(),
            );
            let mapped_target = map_endpoint(
                &edge.target_id,
                &local_ids,
                input_id.as_deref(),
                output_id.as_deref(),
            );
            let source_changed = mapped_source != edge.source_id;
            let target_changed = mapped_target != edge.target_id;
            let replacement_bytes = usize::from(source_changed) * mapped_source.len()
                + usize::from(target_changed) * mapped_target.len();
            if !budget.reserve_auxiliary_clone(replacement_bytes) {
                return None;
            }
            let source_replacement = source_changed.then(|| mapped_source.to_string());
            let target_replacement = target_changed.then(|| mapped_target.to_string());
            if let Some(source) = source_replacement {
                edge.source_id = source;
            }
            if let Some(target) = target_replacement {
                edge.target_id = target;
            }
            edges.push(edge);
        }
    }

    let mut instance_ids = nodes
        .iter()
        .filter_map(|(id, node)| {
            let definition_id = node.get("type")?.as_str()?;
            definitions.contains_key(definition_id).then(|| id.clone())
        })
        .collect::<Vec<_>>();
    instance_ids.sort_by(|left, right| compare_node_ids(left, right));

    for instance_id in instance_ids {
        let Some(instance) = nodes.get(&instance_id) else {
            continue;
        };
        if is_inactive(&instance) || depth >= MAX_SUBGRAPH_DEPTH {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        }

        let Some(definition_id) = instance.get("type").and_then(Value::as_str) else {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        };
        if stack.iter().any(|id| id == definition_id) {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        }
        let Some(definition) = definitions.get(definition_id) else {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        };
        let Some(definition_input_id) = definition
            .get("inputNode")
            .and_then(|value| value.get("id"))
            .and_then(value_id)
        else {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        };
        let Some(definition_output_id) = definition
            .get("outputNode")
            .and_then(|value| value.get("id"))
            .and_then(value_id)
        else {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        };

        stack.push(definition_id.to_string());
        let child = flatten_container(
            definition,
            definitions,
            &instance_id,
            Some((definition_input_id, definition_output_id)),
            stack,
            depth + 1,
            budget,
        );
        stack.pop();
        let Some(mut child) = child else {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        };

        if !apply_proxy_widget_overrides(instance, &instance_id, &mut child.nodes, budget) {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        }

        let incoming = edges
            .iter()
            .filter(|edge| edge.target_id == instance_id)
            .collect::<Vec<_>>();
        let outgoing = edges
            .iter()
            .filter(|edge| edge.source_id == instance_id)
            .collect::<Vec<_>>();

        let Some(input_bindings) =
            bind_instance_inputs(instance, definition, &incoming, &child, budget)
        else {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        };
        let Some(output_bindings) =
            bind_instance_outputs(instance, definition, &outgoing, &child, budget)
        else {
            block_instance_inputs(&mut edges, &instance_id);
            continue;
        };

        edges.retain(|edge| edge.source_id != instance_id && edge.target_id != instance_id);
        edges.extend(child.edges);
        edges.extend(input_bindings);
        edges.extend(output_bindings);
        nodes.remove(&instance_id);
        nodes.extend(child.nodes);
    }

    let mut input_targets: HashMap<usize, Vec<BoundaryTarget>> = HashMap::new();
    let mut output_sources: HashMap<usize, Vec<BoundarySource>> = HashMap::new();
    let mut retained_edges = Vec::with_capacity(edges.len());
    for edge in edges {
        if edge.source_id == INPUT_BOUNDARY {
            let cloned_bytes = edge.link_id.as_ref().map_or(0, String::len)
                + edge.target_id.len()
                + edge.link_type.len();
            if !budget.reserve_auxiliary_clone(cloned_bytes) {
                return None;
            }
            input_targets
                .entry(edge.source_slot)
                .or_default()
                .push(BoundaryTarget {
                    link_id: edge.link_id.clone(),
                    node_id: edge.target_id.clone(),
                    slot: edge.target_slot,
                    link_type: edge.link_type.clone(),
                });
            continue;
        }
        if edge.target_id == OUTPUT_BOUNDARY {
            let cloned_bytes = edge.source_id.len() + edge.link_type.len();
            if !budget.reserve_auxiliary_clone(cloned_bytes) {
                return None;
            }
            output_sources
                .entry(edge.target_slot)
                .or_default()
                .push(BoundarySource {
                    node_id: edge.source_id.clone(),
                    slot: edge.source_slot,
                    link_type: edge.link_type.clone(),
                });
            continue;
        }
        if edge.source_id != OUTPUT_BOUNDARY && edge.target_id != INPUT_BOUNDARY {
            retained_edges.push(edge);
        }
    }

    Some(WorkflowFragment {
        nodes,
        edges: retained_edges,
        input_targets,
        output_sources,
    })
}

fn block_instance_inputs(edges: &mut Vec<WorkflowEdge>, instance_id: &str) {
    edges.retain(|edge| edge.target_id != instance_id);
}

fn bind_instance_inputs(
    instance: &Value,
    definition: &Value,
    incoming: &[&WorkflowEdge],
    child: &WorkflowFragment,
    budget: &mut ExpansionBudget,
) -> Option<Vec<WorkflowEdge>> {
    let instance_inputs = instance.get("inputs").and_then(Value::as_array);
    let definition_inputs = definition.get("inputs").and_then(Value::as_array)?;
    let mut bindings = Vec::new();

    for edge in incoming {
        let input_name = instance_inputs
            .and_then(|inputs| inputs.get(edge.target_slot))
            .and_then(|input| input.get("name"))
            .and_then(Value::as_str)?;
        let definition_slot = definition_inputs
            .iter()
            .position(|input| input.get("name").and_then(Value::as_str) == Some(input_name))?;
        let targets = child.input_targets.get(&definition_slot)?;
        if targets.is_empty() {
            return None;
        }
        for target in targets {
            let binding = WorkflowEdge {
                link_id: target.link_id.clone(),
                source_id: edge.source_id.clone(),
                source_slot: edge.source_slot,
                target_id: target.node_id.clone(),
                target_slot: target.slot,
                link_type: stronger_link_type(&edge.link_type, &target.link_type),
            };
            if !budget.reserve_edge(&binding) {
                return None;
            }
            bindings.push(binding);
        }
    }

    Some(bindings)
}

fn bind_instance_outputs(
    instance: &Value,
    definition: &Value,
    outgoing: &[&WorkflowEdge],
    child: &WorkflowFragment,
    budget: &mut ExpansionBudget,
) -> Option<Vec<WorkflowEdge>> {
    let instance_outputs = instance.get("outputs").and_then(Value::as_array);
    let definition_outputs = definition.get("outputs").and_then(Value::as_array)?;
    let mut bindings = Vec::new();

    for edge in outgoing {
        let output_name = instance_outputs
            .and_then(|outputs| outputs.get(edge.source_slot))
            .and_then(|output| output.get("name"))
            .and_then(Value::as_str);
        let definition_slot = output_name
            .and_then(|name| {
                definition_outputs
                    .iter()
                    .position(|output| output.get("name").and_then(Value::as_str) == Some(name))
            })
            .unwrap_or(edge.source_slot);
        if definition_slot >= definition_outputs.len() {
            return None;
        }
        let sources = child.output_sources.get(&definition_slot)?;
        if sources.is_empty() {
            return None;
        }
        for source in sources {
            let binding = WorkflowEdge {
                link_id: edge.link_id.clone(),
                source_id: source.node_id.clone(),
                source_slot: source.slot,
                target_id: edge.target_id.clone(),
                target_slot: edge.target_slot,
                link_type: stronger_link_type(&edge.link_type, &source.link_type),
            };
            if !budget.reserve_edge(&binding) {
                return None;
            }
            bindings.push(binding);
        }
    }

    Some(bindings)
}

fn apply_proxy_widget_overrides(
    instance: &Value,
    instance_id: &str,
    nodes: &mut HashMap<String, Value>,
    budget: &mut ExpansionBudget,
) -> bool {
    let Some(proxy_widgets) = instance
        .get("properties")
        .and_then(|value| value.get("proxyWidgets"))
        .and_then(Value::as_array)
    else {
        return true;
    };
    let Some(values) = instance.get("widgets_values").and_then(Value::as_array) else {
        return true;
    };

    for (proxy, value) in proxy_widgets.iter().zip(values) {
        let Some(proxy) = proxy.as_array() else {
            continue;
        };
        let (Some(node_id), Some(widget_name)) = (
            proxy.first().and_then(value_id),
            proxy.get(1).and_then(Value::as_str),
        ) else {
            continue;
        };
        let target_id = namespace_id(instance_id, &node_id);
        if !nodes.contains_key(&target_id) {
            continue;
        }
        if !budget.reserve_value_clone(value, widget_name.len()) {
            return false;
        }
        let target = nodes
            .get_mut(&target_id)
            .and_then(Value::as_object_mut)
            .expect("checked subgraph proxy target should remain an object");
        let overrides = target
            .entry("_widget_overrides".to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Some(overrides) = overrides.as_object_mut() {
            overrides.insert(widget_name.to_string(), value.clone());
        }
    }
    true
}

fn parse_borrowed_edge(value: &Value) -> Option<BorrowedWorkflowEdge<'_>> {
    if let Some(edge) = value.as_array() {
        return Some(BorrowedWorkflowEdge {
            link_id: edge.first().and_then(borrowed_id),
            source_id: borrowed_id(edge.get(1)?)?,
            source_slot: value_usize(edge.get(2)?)?,
            target_id: borrowed_id(edge.get(3)?)?,
            target_slot: value_usize(edge.get(4)?)?,
            link_type: edge.get(5).and_then(Value::as_str).unwrap_or("*"),
        });
    }

    Some(BorrowedWorkflowEdge {
        link_id: value.get("id").and_then(borrowed_id),
        source_id: borrowed_id(value.get("origin_id")?)?,
        source_slot: value_usize(value.get("origin_slot")?)?,
        target_id: borrowed_id(value.get("target_id")?)?,
        target_slot: value_usize(value.get("target_slot")?)?,
        link_type: value.get("type").and_then(Value::as_str).unwrap_or("*"),
    })
}

fn map_endpoint<'a>(
    id: &'a str,
    local_ids: &'a HashMap<String, String>,
    input_id: Option<&'a str>,
    output_id: Option<&'a str>,
) -> &'a str {
    if input_id == Some(id) {
        return INPUT_BOUNDARY;
    }
    if output_id == Some(id) {
        return OUTPUT_BOUNDARY;
    }
    local_ids.get(id).map(String::as_str).unwrap_or(id)
}

fn namespace_id(prefix: &str, id: &str) -> String {
    if prefix.is_empty() {
        id.to_string()
    } else {
        format!("{prefix}:{id}")
    }
}

fn value_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|id| id.to_string()))
        .or_else(|| value.as_u64().map(|id| id.to_string()))
}

fn borrowed_id(value: &Value) -> Option<BorrowedId<'_>> {
    value
        .as_str()
        .map(BorrowedId::String)
        .or_else(|| value.as_i64().map(BorrowedId::Signed))
        .or_else(|| value.as_u64().map(BorrowedId::Unsigned))
}

fn decimal_len(mut value: u64) -> usize {
    let mut len = 1;
    while value >= 10 {
        value /= 10;
        len += 1;
    }
    len
}

fn value_usize(value: &Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .or_else(|| value.as_i64().and_then(|value| usize::try_from(value).ok()))
}

fn is_inactive(node: &Value) -> bool {
    matches!(node.get("mode").and_then(Value::as_i64), Some(2 | 4))
}

fn stronger_link_type<'a>(left: &'a str, right: &'a str) -> String {
    if left.is_empty() || left == "*" {
        right.to_string()
    } else {
        left.to_string()
    }
}

#[cfg(test)]
pub(crate) fn normalized_node_ids(workflow: &Value) -> std::collections::HashSet<String> {
    normalize_workflow(workflow)
        .map(|normalized| {
            normalized
                .nodes
                .iter()
                .filter_map(|node| node.get("id").and_then(value_id))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
pub(crate) fn normalize_workflow_with_test_limits(
    workflow: &Value,
    nodes: usize,
    edges: usize,
    cloned_bytes: usize,
) -> Option<NormalizedWorkflow> {
    normalize_workflow_with_limits(
        workflow,
        ExpansionLimits {
            nodes,
            edges,
            cloned_bytes,
        },
    )
}
