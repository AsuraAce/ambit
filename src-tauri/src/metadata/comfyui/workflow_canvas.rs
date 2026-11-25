//! The workflow as it was saved, level by level, for the read-only graph view.
//!
//! The Workflow tab's report (`workflow_inspector`) is the flattened evaluation
//! graph. This one mirrors the file instead: the root level and each subgraph
//! definition keep their own nodes, positions, groups, typed ports and links,
//! and bypassed or muted nodes stay visible. It only reads the chunks: nothing is
//! written back and the stored workflow is untouched.
//!
//! Files come from images anyone can make, so every part of the report is
//! capped: the caps bound the work done and the size of the result, not only
//! the node count. Anything cut sets `truncated`.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use serde_json::Value;

use super::graph::{compare_node_ids, parse_prompt_chunk};
use super::workflow_inspector::{
    build_comfyui_workflow_graph_report, display_value, has_valid_api_prompt,
};
use super::workflow_normalizer::{
    is_bypassed, is_muted, parse_workflow_edge, value_id, WorkflowEdge,
};

/// A chunk larger than this is ignored.
const MAX_CHUNK_BYTES: usize = 32 * 1024 * 1024;
/// Nodes kept in one level (the root or one subgraph definition).
const MAX_LEVEL_NODES: usize = 2_000;
/// Links kept in one level.
const MAX_LEVEL_LINKS: usize = 10_000;
/// Subgraph definitions kept. Definitions are listed once each and never
/// expanded into each other, so nesting depth cannot multiply the output.
const MAX_SUBGRAPHS: usize = 256;
/// Nodes kept across all levels together.
const MAX_TOTAL_NODES: usize = 10_000;
/// Links kept across all levels together.
const MAX_TOTAL_LINKS: usize = 50_000;
/// Inputs, and separately outputs, kept on one node. A slot index at or above
/// this is dropped with its link, so a slot number never sizes anything.
const MAX_NODE_PORTS: usize = 256;
/// Saved setting values kept on one node.
const MAX_NODE_WIDGETS: usize = 256;
/// Ports, settings and groups kept across the whole report.
const MAX_TOTAL_ITEMS: usize = 50_000;
/// A setting value longer than this is cut.
const MAX_WIDGET_VALUE_BYTES: usize = 64 * 1024;
/// Setting value text kept across the whole report.
const MAX_TOTAL_WIDGET_BYTES: usize = 16 * 1024 * 1024;
/// Names, titles and types are cut to this; a node id longer than this drops
/// the node, since a cut id would no longer match its links.
const MAX_LABEL_BYTES: usize = 256;
/// A node's raw JSON longer than this is left out.
const MAX_NODE_RAW_JSON_BYTES: usize = 256 * 1024;
/// Raw JSON kept across all nodes together.
const MAX_TOTAL_RAW_JSON_BYTES: usize = 8 * 1024 * 1024;
/// A string value longer than this, or with a line break, reads as text.
const LONG_TEXT_CHARS: usize = 48;
/// ComfyUI saves this extra value after a seed widget.
const CONTROL_AFTER_GENERATE: [&str; 4] = ["fixed", "increment", "decrement", "randomize"];
const ANY_TYPE: &str = "*";

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCanvasSource {
    None,
    Workflow,
    ApiPrompt,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCanvasNodeKind {
    Node,
    Reroute,
    Note,
    Subgraph,
    SubgraphInput,
    SubgraphOutput,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCanvasNodeMode {
    Active,
    Muted,
    Bypassed,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
pub struct WorkflowCanvasPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
pub struct WorkflowCanvasSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasPort {
    /// The index the file's links use for this port; below `MAX_NODE_PORTS`.
    pub slot: usize,
    pub name: String,
    pub label: String,
    pub data_type: String,
    pub type_inferred: bool,
    pub linked: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasWidget {
    /// None when the file does not say which setting this value belongs to.
    pub name: Option<String>,
    pub value: String,
    pub is_long_text: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasNode {
    /// The id inside its level. A full path is the breadcrumb of subgraph
    /// instance ids followed by this id.
    pub id: String,
    pub node_type: String,
    pub title: String,
    pub kind: WorkflowCanvasNodeKind,
    pub subgraph_id: Option<String>,
    pub mode: WorkflowCanvasNodeMode,
    pub collapsed: bool,
    pub pos: Option<WorkflowCanvasPoint>,
    pub size: Option<WorkflowCanvasSize>,
    pub inputs: Vec<WorkflowCanvasPort>,
    pub outputs: Vec<WorkflowCanvasPort>,
    pub widgets: Vec<WorkflowCanvasWidget>,
    /// The node as saved, for the side panel's copy; None past the byte caps.
    pub raw_json: Option<String>,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasLink {
    pub from_node: String,
    pub from_slot: usize,
    pub to_node: String,
    pub to_slot: usize,
    pub data_type: String,
    pub type_inferred: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasGroup {
    pub title: String,
    pub pos: WorkflowCanvasPoint,
    pub size: WorkflowCanvasSize,
    /// The file's colour, only when it is a plain hex colour.
    pub color: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasLevel {
    pub nodes: Vec<WorkflowCanvasNode>,
    pub links: Vec<WorkflowCanvasLink>,
    pub groups: Vec<WorkflowCanvasGroup>,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasSubgraph {
    pub id: String,
    pub name: String,
    pub level: WorkflowCanvasLevel,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCanvasReport {
    pub tool: String,
    pub source: WorkflowCanvasSource,
    pub has_saved_layout: bool,
    /// A cap was reached, so part of the file is not shown.
    pub truncated: bool,
    pub root: WorkflowCanvasLevel,
    pub subgraphs: Vec<WorkflowCanvasSubgraph>,
    /// Full paths (subgraph instance ids, then the node id). An API prompt has
    /// one level, so each of its paths is the single prompt id.
    pub selected_output_paths: Vec<Vec<String>>,
    pub selected_branch_paths: Vec<Vec<String>>,
    pub output_ambiguous: bool,
}

/// Parsing a large file is CPU work, so it runs off the async runtime's workers.
#[tauri::command(rename_all = "camelCase")]
#[specta::specta]
pub async fn inspect_workflow_canvas(
    chunks: HashMap<String, String>,
) -> Result<WorkflowCanvasReport, String> {
    tauri::async_runtime::spawn_blocking(move || build_workflow_canvas_report(&chunks))
        .await
        .map_err(|e| e.to_string())
}

struct Budget {
    nodes: usize,
    links: usize,
    items: usize,
    widget_bytes: usize,
    raw_json_bytes: usize,
    truncated: bool,
}

impl Budget {
    fn new() -> Self {
        Self {
            nodes: MAX_TOTAL_NODES,
            links: MAX_TOTAL_LINKS,
            items: MAX_TOTAL_ITEMS,
            widget_bytes: MAX_TOTAL_WIDGET_BYTES,
            raw_json_bytes: MAX_TOTAL_RAW_JSON_BYTES,
            truncated: false,
        }
    }

    /// One port, setting or group, if the report still has room for it.
    fn item(&mut self) -> bool {
        if self.items == 0 {
            self.truncated = true;
            return false;
        }
        self.items -= 1;
        true
    }

    fn link(&mut self) -> bool {
        if self.links == 0 {
            self.truncated = true;
            return false;
        }
        self.links -= 1;
        true
    }

    fn label(&mut self, text: &str) -> String {
        if text.len() > MAX_LABEL_BYTES {
            self.truncated = true;
        }
        clip(text, MAX_LABEL_BYTES).to_string()
    }

    /// The first `cap` entries, noting when more were saved.
    fn capped<'a, T>(&mut self, entries: &'a [T], cap: usize) -> &'a [T] {
        if entries.len() > cap {
            self.truncated = true;
        }
        &entries[..entries.len().min(cap)]
    }

    fn widget(&mut self, name: Option<&str>, value: &Value) -> Option<WorkflowCanvasWidget> {
        let value = display_value(value)?;
        if !self.item() {
            return None;
        }
        let cut = value.len() > MAX_WIDGET_VALUE_BYTES;
        let value = clip(&value, MAX_WIDGET_VALUE_BYTES);
        if value.len() > self.widget_bytes {
            self.truncated = true;
            return None;
        }
        self.widget_bytes -= value.len();
        self.truncated |= cut;
        Some(WorkflowCanvasWidget {
            name: name.map(|name| self.label(name)),
            is_long_text: cut || value.chars().count() > LONG_TEXT_CHARS || value.contains('\n'),
            value: value.to_string(),
        })
    }

    fn raw_json(&mut self, node: &Value) -> Option<String> {
        let json = serde_json::to_string(node).ok()?;
        if json.len() > MAX_NODE_RAW_JSON_BYTES || json.len() > self.raw_json_bytes {
            self.truncated = true;
            return None;
        }
        self.raw_json_bytes -= json.len();
        Some(json)
    }
}

/// The longest prefix of `text` within `max` bytes that ends on a character.
fn clip(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn short_id(id: String) -> Option<String> {
    (id.len() <= MAX_LABEL_BYTES).then_some(id)
}

pub(crate) fn build_workflow_canvas_report(
    chunks: &HashMap<String, String>,
) -> WorkflowCanvasReport {
    let chunks: HashMap<String, String> = chunks
        .iter()
        .filter(|(_, value)| value.len() <= MAX_CHUNK_BYTES)
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let prompt = chunks
        .get("prompt")
        .filter(|_| has_valid_api_prompt(&chunks))
        .and_then(|prompt| parse_prompt_chunk(prompt))
        .and_then(|prompt| match prompt {
            Value::Object(nodes) => Some(nodes),
            _ => None,
        });
    let workflow = chunks
        .get("workflow")
        .and_then(|workflow| parse_prompt_chunk(workflow))
        .filter(|workflow| {
            workflow
                .get("nodes")
                .and_then(Value::as_array)
                .is_some_and(|nodes| !nodes.is_empty())
        });

    let mut budget = Budget::new();
    let (source, root, subgraphs) = if let Some(workflow) = &workflow {
        let definitions = subgraph_definitions(workflow, &mut budget);
        let definition_ids = definitions
            .iter()
            .map(|(id, _)| id.clone())
            .collect::<HashSet<_>>();
        let root = workflow_level(workflow, &definition_ids, prompt.as_ref(), &mut budget);
        let mut subgraphs = Vec::with_capacity(definitions.len());
        for (id, definition) in definitions {
            let name = definition
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .unwrap_or(&id);
            let name = budget.label(name);
            // Several instances can share one definition, so no single prompt
            // node names its settings.
            let level = workflow_level(definition, &definition_ids, None, &mut budget);
            subgraphs.push(WorkflowCanvasSubgraph { id, name, level });
        }
        (WorkflowCanvasSource::Workflow, root, subgraphs)
    } else if let Some(prompt) = &prompt {
        (
            WorkflowCanvasSource::ApiPrompt,
            prompt_level(prompt, &mut budget),
            Vec::new(),
        )
    } else {
        (
            WorkflowCanvasSource::None,
            WorkflowCanvasLevel::default(),
            Vec::new(),
        )
    };

    let (selected_output_paths, selected_branch_paths, output_ambiguous) =
        if source == WorkflowCanvasSource::None {
            (Vec::new(), Vec::new(), false)
        } else {
            let report = build_comfyui_workflow_graph_report(&chunks);
            (
                node_paths(&report.selected_output_node_ids, source),
                node_paths(&report.selected_branch_node_ids, source),
                report.output_ambiguous,
            )
        };

    WorkflowCanvasReport {
        tool: "comfyui".to_string(),
        source,
        has_saved_layout: source == WorkflowCanvasSource::Workflow
            && root.nodes.iter().any(|node| node.pos.is_some()),
        truncated: budget.truncated,
        root,
        subgraphs,
        selected_output_paths,
        selected_branch_paths,
        output_ambiguous,
    }
}

/// The normalizer names a node inside a subgraph `instance:local`, so the
/// evaluator's ids split into canvas paths. An API prompt is already flat: its
/// ids, such as `30:3`, are the nodes' own ids in the one level.
fn node_paths(ids: &[String], source: WorkflowCanvasSource) -> Vec<Vec<String>> {
    ids.iter()
        .map(|id| match source {
            WorkflowCanvasSource::ApiPrompt => vec![id.clone()],
            _ => id.split(':').map(str::to_string).collect(),
        })
        .collect()
}

fn subgraph_definitions<'a>(workflow: &'a Value, budget: &mut Budget) -> Vec<(String, &'a Value)> {
    let Some(definitions) = workflow
        .get("definitions")
        .and_then(|definitions| definitions.get("subgraphs"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    let mut kept = Vec::new();
    for definition in definitions {
        let Some(id) = definition.get("id").and_then(value_id) else {
            continue;
        };
        let Some(id) = short_id(id) else {
            budget.truncated = true;
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        if kept.len() == MAX_SUBGRAPHS {
            budget.truncated = true;
            break;
        }
        kept.push((id, definition));
    }
    kept
}

fn workflow_level(
    container: &Value,
    definition_ids: &HashSet<String>,
    prompt: Option<&serde_json::Map<String, Value>>,
    budget: &mut Budget,
) -> WorkflowCanvasLevel {
    let mut source_nodes = Vec::new();
    for node in container
        .get("nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = node.get("id").and_then(value_id) else {
            continue;
        };
        match short_id(id) {
            Some(id) => source_nodes.push((id, node)),
            None => budget.truncated = true,
        }
    }
    source_nodes.sort_by(|(left, _), (right, _)| compare_node_ids(left, right));
    source_nodes.dedup_by(|(left, _), (right, _)| left == right);

    let keep = source_nodes.len().min(MAX_LEVEL_NODES).min(budget.nodes);
    if keep < source_nodes.len() {
        budget.truncated = true;
        source_nodes.truncate(keep);
    }
    budget.nodes -= keep;

    let mut nodes = Vec::with_capacity(source_nodes.len() + 2);
    for (id, node) in source_nodes {
        let prompt_node = prompt.and_then(|prompt| prompt.get(&id));
        nodes.push(workflow_node(id, node, definition_ids, prompt_node, budget));
    }

    let boundary = boundary_ids(container);
    if let Some((input_id, output_id)) = &boundary {
        nodes.extend(boundary_node(
            container,
            input_id,
            "inputNode",
            "inputs",
            WorkflowCanvasNodeKind::SubgraphInput,
            budget,
        ));
        nodes.extend(boundary_node(
            container,
            output_id,
            "outputNode",
            "outputs",
            WorkflowCanvasNodeKind::SubgraphOutput,
            budget,
        ));
    }

    let links = workflow_links(container, &nodes, boundary.as_ref(), budget);
    let mut groups = Vec::new();
    for group in container
        .get("groups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(group) = workflow_group(group, budget) else {
            continue;
        };
        if !budget.item() {
            break;
        }
        groups.push(group);
    }

    WorkflowCanvasLevel {
        nodes,
        links,
        groups,
    }
}

fn workflow_node(
    id: String,
    node: &Value,
    definition_ids: &HashSet<String>,
    prompt_node: Option<&Value>,
    budget: &mut Budget,
) -> WorkflowCanvasNode {
    let raw_type = node
        .get("type")
        .and_then(Value::as_str)
        .filter(|node_type| !node_type.is_empty())
        .unwrap_or("Unknown");
    let node_type = budget.label(raw_type);
    let subgraph_id = definition_ids
        .contains(raw_type)
        .then(|| raw_type.to_string());
    let kind = if subgraph_id.is_some() {
        WorkflowCanvasNodeKind::Subgraph
    } else {
        match raw_type {
            "Reroute" => WorkflowCanvasNodeKind::Reroute,
            "Note" | "MarkdownNote" => WorkflowCanvasNodeKind::Note,
            _ => WorkflowCanvasNodeKind::Node,
        }
    };
    let mode = if is_bypassed(node) {
        WorkflowCanvasNodeMode::Bypassed
    } else if is_muted(node) {
        WorkflowCanvasNodeMode::Muted
    } else {
        WorkflowCanvasNodeMode::Active
    };

    let saved_inputs = node
        .get("inputs")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut inputs = Vec::new();
    for (slot, input) in budget
        .capped(saved_inputs, MAX_NODE_PORTS)
        .iter()
        .enumerate()
    {
        let linked = input.get("link").is_some_and(|link| !link.is_null());
        // A setting that can take a wire is listed as an input; it is a port
        // only while a wire is attached, as ComfyUI draws it.
        if (input.get("widget").is_none() || linked) && budget.item() {
            inputs.push(saved_port(slot, input, linked, budget));
        }
    }
    let saved_outputs = node
        .get("outputs")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut outputs = Vec::new();
    for (slot, output) in budget
        .capped(saved_outputs, MAX_NODE_PORTS)
        .iter()
        .enumerate()
    {
        let linked = output
            .get("links")
            .and_then(Value::as_array)
            .is_some_and(|links| !links.is_empty());
        if budget.item() {
            outputs.push(saved_port(slot, output, linked, budget));
        }
    }

    let title = node
        .get("title")
        .and_then(Value::as_str)
        .filter(|title| !title.is_empty())
        .map(|title| budget.label(title))
        .unwrap_or_else(|| node_type.clone());
    let widgets = workflow_widgets(node, prompt_node, budget);
    WorkflowCanvasNode {
        title,
        id,
        kind,
        subgraph_id,
        mode,
        collapsed: node
            .get("flags")
            .and_then(|flags| flags.get("collapsed"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        pos: node
            .get("pos")
            .and_then(pair)
            .map(|(x, y)| WorkflowCanvasPoint { x, y }),
        size: node
            .get("size")
            .and_then(pair)
            .map(|(width, height)| WorkflowCanvasSize { width, height }),
        inputs,
        outputs,
        widgets,
        raw_json: budget.raw_json(node),
        node_type,
    }
}

fn saved_port(slot: usize, port: &Value, linked: bool, budget: &mut Budget) -> WorkflowCanvasPort {
    let name = match port.get("name").and_then(Value::as_str) {
        Some(name) => budget.label(name),
        None => format!("slot_{slot}"),
    };
    let label = match ["label", "localized_name"]
        .iter()
        .find_map(|key| port.get(*key).and_then(Value::as_str))
        .filter(|label| !label.is_empty())
    {
        Some(label) => budget.label(label),
        None => name.clone(),
    };
    let data_type = port
        .get("type")
        .and_then(Value::as_str)
        .filter(|data_type| !data_type.is_empty())
        .unwrap_or(ANY_TYPE);
    WorkflowCanvasPort {
        slot,
        label,
        name,
        data_type: budget.label(data_type),
        type_inferred: false,
        linked,
    }
}

/// A position or size saved as `[a, b]` or as `{"0": a, "1": b}`.
fn pair(value: &Value) -> Option<(f64, f64)> {
    let (first, second) = match value {
        Value::Array(values) => (values.first()?, values.get(1)?),
        Value::Object(values) => (values.get("0")?, values.get("1")?),
        _ => return None,
    };
    let (first, second) = (first.as_f64()?, second.as_f64()?);
    (first.is_finite() && second.is_finite()).then_some((first, second))
}

fn workflow_widgets(
    node: &Value,
    prompt_node: Option<&Value>,
    budget: &mut Budget,
) -> Vec<WorkflowCanvasWidget> {
    let mut widgets = Vec::new();
    match node.get("widgets_values") {
        Some(Value::Object(values)) => {
            if values.len() > MAX_NODE_WIDGETS {
                budget.truncated = true;
            }
            for (name, value) in values.iter().take(MAX_NODE_WIDGETS) {
                widgets.extend(budget.widget(Some(name), value));
            }
        }
        Some(Value::Array(values)) => {
            let values = budget.capped(values, MAX_NODE_WIDGETS);
            let names = widget_names(node, values, prompt_node);
            for (value, name) in values.iter().zip(names) {
                widgets.extend(budget.widget(name, value));
            }
        }
        _ => {}
    }
    widgets
}

/// The setting name of each saved value.
///
/// The file may name its settings in `inputs[].widget.name`, in order, with an
/// extra control value saved after a seed. Those names are used only when
/// there is exactly one for each value other than the control values: many
/// files list only the settings that can take a wire, and pairing those with
/// the first values would name the wrong ones. Otherwise a prompt node with the
/// same id names each value equal to one of its own (equal values read the same
/// either way), and a value nothing names stays unnamed.
fn widget_names<'a>(
    node: &'a Value,
    values: &[Value],
    prompt_node: Option<&'a Value>,
) -> Vec<Option<&'a str>> {
    let declared = node
        .get("inputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|input| input.get("widget")?.get("name")?.as_str())
        .collect::<Vec<_>>();
    let controls = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            index > 0
                && (values[index - 1].is_i64() || values[index - 1].is_u64())
                && value
                    .as_str()
                    .is_some_and(|value| CONTROL_AFTER_GENERATE.contains(&value))
        })
        .collect::<Vec<_>>();
    let settings = controls.iter().filter(|control| !**control).count();
    let named_by_file = !declared.is_empty() && declared.len() == settings;

    // Each prompt value, keyed so `6` and `6.0` match, with the names still
    // free to give out in the prompt's own order.
    let mut by_value: HashMap<String, VecDeque<&str>> = HashMap::new();
    if !named_by_file {
        for (name, value) in prompt_node
            .and_then(|node| node.get("inputs"))
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, value)| prompt_link(value).is_none())
        {
            by_value
                .entry(value_key(value))
                .or_default()
                .push_back(name.as_str());
        }
    }

    let mut declared = declared.into_iter();
    values
        .iter()
        .zip(controls)
        .map(|(value, control)| {
            if control {
                Some("control_after_generate")
            } else if named_by_file {
                declared.next()
            } else {
                by_value.get_mut(&value_key(value))?.pop_front()
            }
        })
        .collect()
}

/// The editor and the prompt may save one number as `6` and `6.0`.
fn value_key(value: &Value) -> String {
    match value.as_f64() {
        Some(number) => format!("#{number}"),
        None => value.to_string(),
    }
}

fn boundary_ids(container: &Value) -> Option<(String, String)> {
    Some((
        short_id(container.get("inputNode")?.get("id").and_then(value_id)?)?,
        short_id(container.get("outputNode")?.get("id").and_then(value_id)?)?,
    ))
}

/// A subgraph's own inputs show as one node whose outputs are those inputs, and
/// its outputs as one node whose inputs are those outputs, as ComfyUI draws them.
fn boundary_node(
    container: &Value,
    id: &str,
    node_key: &str,
    ports_key: &str,
    kind: WorkflowCanvasNodeKind,
    budget: &mut Budget,
) -> Option<WorkflowCanvasNode> {
    let bounding = container
        .get(node_key)?
        .get("bounding")
        .and_then(Value::as_array);
    let at = |index: usize| {
        bounding
            .and_then(|bounding| bounding.get(index))
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
    };
    let saved = container
        .get(ports_key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut ports = Vec::new();
    for (slot, port) in budget.capped(saved, MAX_NODE_PORTS).iter().enumerate() {
        let linked = port
            .get("linkIds")
            .and_then(Value::as_array)
            .is_some_and(|links| !links.is_empty());
        if budget.item() {
            ports.push(saved_port(slot, port, linked, budget));
        }
    }
    let (title, inputs, outputs) = if kind == WorkflowCanvasNodeKind::SubgraphInput {
        ("Inputs", Vec::new(), ports)
    } else {
        ("Outputs", ports, Vec::new())
    };
    Some(WorkflowCanvasNode {
        id: id.to_string(),
        node_type: title.to_string(),
        title: title.to_string(),
        kind,
        subgraph_id: None,
        mode: WorkflowCanvasNodeMode::Active,
        collapsed: false,
        pos: at(0).zip(at(1)).map(|(x, y)| WorkflowCanvasPoint { x, y }),
        size: at(2)
            .zip(at(3))
            .map(|(width, height)| WorkflowCanvasSize { width, height }),
        inputs,
        outputs,
        widgets: Vec::new(),
        raw_json: None,
    })
}

fn workflow_links(
    container: &Value,
    nodes: &[WorkflowCanvasNode],
    boundary: Option<&(String, String)>,
    budget: &mut Budget,
) -> Vec<WorkflowCanvasLink> {
    let node_ids = nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<HashSet<_>>();
    let output_slots = boundary
        .map(|_| boundary_output_slots(container))
        .unwrap_or_default();
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for raw in container
        .get("links")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(link) =
            parse_workflow_edge(raw).or_else(|| boundary_edge(raw, boundary, &output_slots))
        else {
            continue;
        };
        if !node_ids.contains(link.source_id.as_str())
            || !node_ids.contains(link.target_id.as_str())
        {
            continue;
        }
        if link.source_slot >= MAX_NODE_PORTS || link.target_slot >= MAX_NODE_PORTS {
            budget.truncated = true;
            continue;
        }
        let key = (
            link.source_id.clone(),
            link.source_slot,
            link.target_id.clone(),
            link.target_slot,
        );
        if !seen.insert(key) {
            continue;
        }
        if links.len() == MAX_LEVEL_LINKS {
            budget.truncated = true;
            break;
        }
        if !budget.link() {
            break;
        }
        let data_type = if link.link_type.is_empty() {
            ANY_TYPE.to_string()
        } else {
            budget.label(&link.link_type)
        };
        links.push(WorkflowCanvasLink {
            from_node: link.source_id,
            from_slot: link.source_slot,
            to_node: link.target_id,
            to_slot: link.target_slot,
            data_type,
            type_inferred: false,
        });
    }
    links.sort_by(|left, right| {
        compare_node_ids(&left.to_node, &right.to_node)
            .then_with(|| left.to_slot.cmp(&right.to_slot))
            .then_with(|| compare_node_ids(&left.from_node, &right.from_node))
            .then_with(|| left.from_slot.cmp(&right.from_slot))
    });
    links
}

/// Each link id a subgraph output lists in `linkIds`, with that output's slot;
/// the first output to list an id keeps it.
fn boundary_output_slots(container: &Value) -> HashMap<String, usize> {
    let mut slots = HashMap::new();
    for (slot, output) in container
        .get("outputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_NODE_PORTS)
        .enumerate()
    {
        for id in output
            .get("linkIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(value_id)
        {
            slots.entry(id).or_insert(slot);
        }
    }
    slots
}

/// Some files save a link into a subgraph's outputs with slot -1 and name the
/// slot only through that output's `linkIds`.
fn boundary_edge(
    raw: &Value,
    boundary: Option<&(String, String)>,
    output_slots: &HashMap<String, usize>,
) -> Option<WorkflowEdge> {
    let (_, output_id) = boundary?;
    let target_id = raw.get("target_id").and_then(value_id)?;
    if &target_id != output_id || raw.get("target_slot")?.as_i64() != Some(-1) {
        return None;
    }
    let link_id = raw.get("id").and_then(value_id)?;
    let target_slot = *output_slots.get(&link_id)?;
    Some(WorkflowEdge {
        link_id: Some(link_id),
        source_id: raw.get("origin_id").and_then(value_id)?,
        source_slot: usize::try_from(raw.get("origin_slot")?.as_u64()?).ok()?,
        target_id,
        target_slot,
        link_type: raw
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or(ANY_TYPE)
            .to_string(),
    })
}

fn workflow_group(group: &Value, budget: &mut Budget) -> Option<WorkflowCanvasGroup> {
    let bounding = group.get("bounding")?.as_array()?;
    let at = |index: usize| {
        bounding
            .get(index)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
    };
    let (x, y, width, height) = (at(0)?, at(1)?, at(2)?, at(3)?);
    Some(WorkflowCanvasGroup {
        title: budget.label(
            group
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        pos: WorkflowCanvasPoint { x, y },
        size: WorkflowCanvasSize { width, height },
        color: group
            .get("color")
            .and_then(Value::as_str)
            .filter(|color| is_hex_color(color))
            .map(str::to_string),
    })
}

/// `#` and 3 to 8 hex digits; anything else from the file is not a colour.
fn is_hex_color(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|digits| {
        (3..=8).contains(&digits.len()) && digits.chars().all(|c| c.is_ascii_hexdigit())
    })
}

/// `[source id, output slot]` when an API prompt input is a wire.
fn prompt_link(value: &Value) -> Option<(String, u64)> {
    let pair = value.as_array()?;
    if pair.len() != 2 {
        return None;
    }
    let source = pair[0]
        .as_str()
        .map(str::to_string)
        .or_else(|| pair[0].as_u64().map(|id| id.to_string()))?;
    Some((source, pair[1].as_u64()?))
}

/// An API prompt saves no types; these input names say what flows in.
fn inferred_input_type(input_name: &str) -> &'static str {
    match input_name {
        "model" => "MODEL",
        "clip" => "CLIP",
        "vae" => "VAE",
        "positive" | "negative" | "conditioning" => "CONDITIONING",
        "samples" | "latent_image" | "latent" => "LATENT",
        "image" | "images" | "pixels" => "IMAGE",
        "mask" => "MASK",
        "upscale_model" => "UPSCALE_MODEL",
        "control_net" => "CONTROL_NET",
        _ => ANY_TYPE,
    }
}

fn prompt_level(
    prompt: &serde_json::Map<String, Value>,
    budget: &mut Budget,
) -> WorkflowCanvasLevel {
    let mut ids = Vec::new();
    for (id, node) in prompt {
        if !node.is_object() {
            continue;
        }
        if id.len() > MAX_LABEL_BYTES {
            budget.truncated = true;
            continue;
        }
        ids.push(id.as_str());
    }
    ids.sort_by(|left, right| compare_node_ids(left, right));
    let keep = ids.len().min(MAX_LEVEL_NODES).min(budget.nodes);
    if keep < ids.len() {
        budget.truncated = true;
        ids.truncate(keep);
    }
    budget.nodes -= keep;
    let kept = ids.iter().copied().collect::<HashSet<_>>();

    let mut links = Vec::new();
    let mut nodes = Vec::new();
    for id in &ids {
        let node = &prompt[*id];
        let raw_type = node
            .get("class_type")
            .and_then(Value::as_str)
            .filter(|node_type| !node_type.is_empty())
            .unwrap_or("Unknown");
        let node_type = budget.label(raw_type);
        let mut inputs = Vec::new();
        let mut widgets = Vec::new();
        for (name, value) in node
            .get("inputs")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            match prompt_link(value).filter(|(source, _)| kept.contains(source.as_str())) {
                Some((source, from_slot)) => {
                    // A slot is an index; one this large is not a real output.
                    let Some(from_slot) = usize::try_from(from_slot)
                        .ok()
                        .filter(|slot| *slot < MAX_NODE_PORTS)
                    else {
                        budget.truncated = true;
                        continue;
                    };
                    if inputs.len() == MAX_NODE_PORTS {
                        budget.truncated = true;
                        continue;
                    }
                    if !budget.item() {
                        continue;
                    }
                    let data_type = inferred_input_type(name);
                    let slot = inputs.len();
                    let name = budget.label(name);
                    inputs.push(WorkflowCanvasPort {
                        slot,
                        label: name.clone(),
                        name,
                        data_type: data_type.to_string(),
                        type_inferred: data_type != ANY_TYPE,
                        linked: true,
                    });
                    if links.len() < MAX_LEVEL_LINKS && budget.link() {
                        links.push(WorkflowCanvasLink {
                            from_node: source,
                            from_slot,
                            to_node: (*id).to_string(),
                            to_slot: slot,
                            data_type: data_type.to_string(),
                            type_inferred: data_type != ANY_TYPE,
                        });
                    } else {
                        budget.truncated = true;
                    }
                }
                None => {
                    if widgets.len() == MAX_NODE_WIDGETS {
                        budget.truncated = true;
                    } else {
                        widgets.extend(budget.widget(Some(name), value));
                    }
                }
            }
        }
        let title = node
            .get("_meta")
            .and_then(|meta| meta.get("title"))
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
            .map(|title| budget.label(title))
            .unwrap_or_else(|| node_type.clone());
        nodes.push(WorkflowCanvasNode {
            id: (*id).to_string(),
            title,
            node_type,
            kind: WorkflowCanvasNodeKind::Node,
            subgraph_id: None,
            mode: WorkflowCanvasNodeMode::Active,
            collapsed: false,
            pos: None,
            size: None,
            inputs,
            outputs: Vec::new(),
            widgets,
            raw_json: budget.raw_json(node),
        });
    }

    // Outputs exist only as the slots that wires leave from; unused slots
    // between them are not made up.
    let index = nodes
        .iter()
        .enumerate()
        .map(|(position, node)| (node.id.clone(), position))
        .collect::<HashMap<_, _>>();
    let mut outputs: HashMap<usize, BTreeMap<usize, WorkflowCanvasPort>> = HashMap::new();
    for link in &links {
        let Some(&position) = index.get(&link.from_node) else {
            continue;
        };
        let output = match outputs.entry(position).or_default().entry(link.from_slot) {
            std::collections::btree_map::Entry::Occupied(slot) => slot.into_mut(),
            std::collections::btree_map::Entry::Vacant(slot) => {
                if !budget.item() {
                    continue;
                }
                let name = format!("output_{}", link.from_slot);
                slot.insert(WorkflowCanvasPort {
                    slot: link.from_slot,
                    label: name.clone(),
                    name,
                    data_type: ANY_TYPE.to_string(),
                    type_inferred: false,
                    linked: true,
                })
            }
        };
        if output.data_type == ANY_TYPE && link.data_type != ANY_TYPE {
            output.data_type = link.data_type.clone();
            output.name = link.data_type.clone();
            output.label = link.data_type.clone();
            output.type_inferred = true;
        }
    }
    for (position, slots) in outputs {
        nodes[position].outputs = slots.into_values().collect();
    }
    links.sort_by(|left, right| {
        compare_node_ids(&left.to_node, &right.to_node)
            .then_with(|| left.to_slot.cmp(&right.to_slot))
    });

    WorkflowCanvasLevel {
        nodes,
        links,
        groups: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;
    use std::time::{Duration, Instant};

    fn fixture(name: &str) -> HashMap<String, String> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/metadata/comfyui/tests/fixtures")
            .join(name);
        let text = std::fs::read_to_string(&path).expect("fixture should exist");
        serde_json::from_str(&text).expect("fixture should be a chunk map")
    }

    fn workflow_chunks(workflow: Value) -> HashMap<String, String> {
        HashMap::from([("workflow".to_string(), workflow.to_string())])
    }

    fn node<'a>(level: &'a WorkflowCanvasLevel, id: &str) -> &'a WorkflowCanvasNode {
        level
            .nodes
            .iter()
            .find(|node| node.id == id)
            .unwrap_or_else(|| panic!("node {id} should be drawn"))
    }

    fn widget_names(node: &WorkflowCanvasNode) -> Vec<Option<&str>> {
        node.widgets
            .iter()
            .map(|widget| widget.name.as_deref())
            .collect()
    }

    fn path(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    /// The node a selection path leads to: each segment but the last is a
    /// subgraph instance whose definition is the next level.
    fn resolve<'a>(
        report: &'a WorkflowCanvasReport,
        path: &[String],
    ) -> Option<&'a WorkflowCanvasNode> {
        let (last, instances) = path.split_last()?;
        let mut level = &report.root;
        for instance in instances {
            let definition = level
                .nodes
                .iter()
                .find(|node| &node.id == instance)?
                .subgraph_id
                .as_deref()?;
            level = &report
                .subgraphs
                .iter()
                .find(|subgraph| subgraph.id == definition)?
                .level;
        }
        level.nodes.iter().find(|node| &node.id == last)
    }

    fn timed<T>(build: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let result = build();
        let elapsed = started.elapsed();
        eprintln!("canvas build took {elapsed:?}");
        // Unoptimised test builds included; release builds are far faster.
        assert!(elapsed < Duration::from_secs(5), "took {elapsed:?}");
        result
    }

    fn json_bytes(report: &WorkflowCanvasReport) -> usize {
        serde_json::to_string(report)
            .expect("report serialises")
            .len()
    }

    // The view must show a saved workflow as ComfyUI drew it: where each node
    // was, its groups, and which nodes were switched off or folded.
    #[test]
    fn saved_workflow_keeps_layout_groups_and_switched_off_nodes() {
        let report =
            build_workflow_canvas_report(&fixture("official_catalog/gsc_creator_2_2.chunks.json"));

        assert_eq!(report.source, WorkflowCanvasSource::Workflow);
        assert!(report.has_saved_layout);
        assert!(!report.truncated);
        assert_eq!(report.root.groups.len(), 8);
        let prompt_group = &report.root.groups[0];
        assert_eq!(prompt_group.title, "Prompt");
        assert_eq!(
            prompt_group.pos,
            WorkflowCanvasPoint {
                x: 10160.0,
                y: -620.0
            }
        );
        assert_eq!(
            prompt_group.size,
            WorkflowCanvasSize {
                width: 300.0,
                height: 520.0
            }
        );
        assert_eq!(prompt_group.color.as_deref(), Some("#3f789e"));

        let preview = node(&report.root, "110");
        assert_eq!(preview.mode, WorkflowCanvasNodeMode::Bypassed);
        assert_eq!(
            preview.pos,
            Some(WorkflowCanvasPoint {
                x: 10520.0,
                y: -390.0
            })
        );
        assert_eq!(preview.inputs[0].name, "images");
        assert_eq!(preview.inputs[0].data_type, "IMAGE");
        assert!(preview.inputs[0].linked);
        assert_eq!(
            node(&report.root, "104").mode,
            WorkflowCanvasNodeMode::Bypassed
        );

        let note = node(&report.root, "115");
        assert_eq!(note.kind, WorkflowCanvasNodeKind::Note);
        assert!(note.collapsed);

        let instance = node(&report.root, "108");
        assert_eq!(instance.kind, WorkflowCanvasNodeKind::Subgraph);
        assert_eq!(
            instance.subgraph_id.as_deref(),
            Some("b2b04275-4dea-49ba-a3fd-ce0b2f1e39dc")
        );
        assert!(instance.collapsed);
        assert_eq!(report.subgraphs.len(), 1);
        assert!(node(&report.root, "122").collapsed);

        // Neither the file nor a prompt names these values; the UI numbers them.
        let preprocessor = node(&report.root, "104");
        assert_eq!(widget_names(preprocessor), [None, None]);
        assert_eq!(preprocessor.widgets[0].value, "DepthAnythingV2Preprocessor");
        assert!(preprocessor
            .raw_json
            .as_deref()
            .is_some_and(|raw| raw.contains("AIO_Preprocessor")));
    }

    #[test]
    fn reroutes_are_marked_and_keep_their_wire_types() {
        let report =
            build_workflow_canvas_report(&fixture("official_catalog/hidream_e1_1.chunks.json"));

        let reroute = node(&report.root, "48");
        assert_eq!(reroute.kind, WorkflowCanvasNodeKind::Reroute);
        assert_eq!(reroute.outputs[0].data_type, "MODEL");
        assert!(report
            .root
            .links
            .iter()
            .any(|link| link.to_node == "48" && link.to_slot == 0));
    }

    // When the file has both chunks, the saved workflow is drawn, and the prompt
    // only names the settings the file left unnamed.
    #[test]
    fn prompt_names_unnamed_settings_and_object_sizes_are_read() {
        let report = build_workflow_canvas_report(&fixture(
            "official_examples/controlnet/controlnet_example.chunks.json",
        ));

        assert_eq!(report.source, WorkflowCanvasSource::Workflow);
        assert_eq!(
            node(&report.root, "14").size,
            Some(WorkflowCanvasSize {
                width: 315.0,
                height: 98.0
            })
        );
        let sampler = node(&report.root, "3");
        assert_eq!(
            widget_names(sampler),
            [
                Some("seed"),
                Some("control_after_generate"),
                Some("steps"),
                Some("cfg"),
                Some("sampler_name"),
                Some("scheduler"),
                Some("denoise"),
            ]
        );
        assert_eq!(sampler.widgets[0].value, "1002496614778823");
    }

    #[test]
    fn settings_named_by_the_file_skip_the_seed_control_value() {
        let report = build_workflow_canvas_report(&workflow_chunks(json!({
            "nodes": [{
                "id": 1, "type": "KSampler", "mode": 0, "pos": [0, 0], "size": [300, 200],
                "inputs": [
                    { "name": "model", "type": "MODEL", "link": null },
                    { "name": "seed", "type": "INT", "widget": { "name": "seed" }, "link": null },
                    { "name": "steps", "type": "INT", "widget": { "name": "steps" }, "link": 7 }
                ],
                "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [] }],
                "widgets_values": [5, "fixed", 20]
            }],
            "links": []
        })));

        let sampler = node(&report.root, "1");
        assert_eq!(
            widget_names(sampler),
            [Some("seed"), Some("control_after_generate"), Some("steps")]
        );
        // A setting is a port only while a wire is attached to it; the slot is
        // the file's own index, which its links use.
        let ports = sampler
            .inputs
            .iter()
            .map(|port| (port.name.as_str(), port.slot, port.linked))
            .collect::<Vec<_>>();
        assert_eq!(ports, [("model", 0, false), ("steps", 2, true)]);
    }

    // ComfyUI opens a subgraph as its own level with its inputs and outputs as
    // nodes at the edges; flattening it would draw a graph nobody saved.
    #[test]
    fn subgraphs_are_their_own_level_with_boundary_ports_and_groups() {
        let report = build_workflow_canvas_report(&fixture(
            "official_catalog/02_qwen_Image_edit_subgraphed.chunks.json",
        ));
        let definition_id = "6b4b0518-e42a-4e8b-a377-f0da6dacfcac";

        assert_eq!(
            node(&report.root, "141").kind,
            WorkflowCanvasNodeKind::Subgraph
        );
        assert_eq!(
            node(&report.root, "141").subgraph_id.as_deref(),
            Some(definition_id)
        );
        assert_eq!(node(&report.root, "119").kind, WorkflowCanvasNodeKind::Note);
        assert_eq!(
            node(&report.root, "119").title,
            "Note: how to use this workflow"
        );

        let subgraph = &report.subgraphs[0];
        assert_eq!(subgraph.id, definition_id);
        assert_eq!(subgraph.name, "New Subgraph");
        assert_eq!(subgraph.level.groups.len(), 2);
        assert_eq!(subgraph.level.nodes.len(), 11 + 2);

        let inputs = node(&subgraph.level, "-10");
        assert_eq!(inputs.kind, WorkflowCanvasNodeKind::SubgraphInput);
        assert_eq!(inputs.outputs.len(), 12);
        assert_eq!(
            (
                inputs.outputs[0].name.as_str(),
                inputs.outputs[0].data_type.as_str()
            ),
            ("image", "IMAGE")
        );
        assert_eq!(
            inputs.pos,
            Some(WorkflowCanvasPoint {
                x: -1270.0,
                y: 820.0
            })
        );
        let outputs = node(&subgraph.level, "-20");
        assert_eq!(outputs.kind, WorkflowCanvasNodeKind::SubgraphOutput);
        assert_eq!(outputs.inputs[0].data_type, "IMAGE");
        assert!(subgraph
            .level
            .links
            .iter()
            .any(|link| link.from_node == "-10"));
        assert!(subgraph
            .level
            .links
            .iter()
            .any(|link| link.to_node == "-20"));
    }

    #[test]
    fn a_subgraph_output_saved_with_slot_minus_one_finds_its_slot() {
        let report = build_workflow_canvas_report(&fixture(
            "official_catalog/utility_image_upscale_supir.chunks.json",
        ));
        let subgraph = report
            .subgraphs
            .iter()
            .find(|subgraph| subgraph.id == "87b54408-f2d8-4783-bad3-67bd0641ad66")
            .expect("SUPIR subgraph");

        assert!(subgraph.level.links.contains(&WorkflowCanvasLink {
            from_node: "39".to_string(),
            from_slot: 0,
            to_node: "-20".to_string(),
            to_slot: 0,
            data_type: "IMAGE".to_string(),
            type_inferred: false,
        }));
    }

    // An API prompt saves no positions or types. The view lays it out itself,
    // and guessed types are marked as guesses.
    #[test]
    fn api_prompt_has_no_layout_and_marks_inferred_types() {
        let mut chunks = fixture("real_world/krea2_turbo_official_template.chunks.json");
        chunks.remove("workflow");
        let report = build_workflow_canvas_report(&chunks);

        assert_eq!(report.source, WorkflowCanvasSource::ApiPrompt);
        assert!(!report.has_saved_layout);
        assert!(report.root.nodes.iter().all(|node| node.pos.is_none()));
        assert!(report.subgraphs.is_empty());
        assert_eq!(report.selected_output_paths, [path(&["29"])]);
        // The prompt is one flat level whose node is `30:3` itself.
        assert!(report.selected_branch_paths.contains(&path(&["30:3"])));

        let sampler = node(&report.root, "30:3");
        let model = sampler
            .inputs
            .iter()
            .find(|port| port.name == "model")
            .expect("sampler model input");
        assert_eq!(model.data_type, "MODEL");
        assert!(model.type_inferred);
        assert!(report.root.links.iter().all(|link| {
            report
                .root
                .nodes
                .iter()
                .any(|node| node.id == link.from_node)
                && report.root.nodes[..]
                    .iter()
                    .find(|node| node.id == link.to_node)
                    .is_some_and(|node| node.inputs.iter().any(|port| port.slot == link.to_slot))
        }));
        // Every source slot a wire leaves from exists as an output.
        for link in &report.root.links {
            assert!(node(&report.root, &link.from_node)
                .outputs
                .iter()
                .any(|port| port.slot == link.from_slot));
        }
    }

    // The evaluator's flattened ids (`30:3`) become paths into the saved
    // levels, so the view can light the branch inside a subgraph.
    #[test]
    fn saved_workflow_reports_the_same_selection_as_paths() {
        let report = build_workflow_canvas_report(&fixture(
            "real_world/krea2_turbo_official_template.chunks.json",
        ));

        assert_eq!(report.source, WorkflowCanvasSource::Workflow);
        assert_eq!(
            node(&report.root, "30").kind,
            WorkflowCanvasNodeKind::Subgraph
        );
        assert_eq!(report.selected_output_paths, [path(&["29"])]);
        assert!(report.selected_branch_paths.contains(&path(&["30", "3"])));
        assert!(!report.output_ambiguous);
    }

    #[test]
    fn muted_nodes_are_marked() {
        let report = build_workflow_canvas_report(&workflow_chunks(json!({
            "nodes": [{ "id": 1, "type": "SaveImage", "mode": 2, "pos": [0, 0] }],
            "links": []
        })));

        assert_eq!(node(&report.root, "1").mode, WorkflowCanvasNodeMode::Muted);
    }

    // Workflows come from images anyone can make. A group colour reaches the
    // view only as a plain hex colour; anything else falls back to the token.
    #[test]
    fn group_colours_are_accepted_only_as_plain_hex() {
        let groups = [
            "#3f789e",
            "#abc",
            "#3f789eff",
            "#12",
            "#123456789",
            "red",
            "#3f789e; background: url(x)",
            "url(javascript:alert(1))",
            "",
        ]
        .iter()
        .map(|color| json!({ "title": "<b>x</b>", "bounding": [0, 0, 10, 10], "color": color }))
        .collect::<Vec<_>>();
        let report = build_workflow_canvas_report(&workflow_chunks(json!({
            "nodes": [{ "id": 1, "type": "SaveImage", "pos": [0, 0] }],
            "links": [],
            "groups": groups
        })));

        let colors = report
            .root
            .groups
            .iter()
            .map(|group| group.color.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(
            colors,
            [
                Some("#3f789e"),
                Some("#abc"),
                Some("#3f789eff"),
                None,
                None,
                None,
                None,
                None,
                None
            ]
        );
        // Text is passed on as it was saved; the view renders it as plain text.
        assert_eq!(report.root.groups[0].title, "<b>x</b>");
    }

    #[test]
    fn malformed_input_is_empty_or_skipped_without_panicking() {
        for chunks in [
            HashMap::new(),
            HashMap::from([("workflow".to_string(), "not json".to_string())]),
            HashMap::from([("workflow".to_string(), json!({ "nodes": {} }).to_string())]),
            HashMap::from([("prompt".to_string(), json!("text").to_string())]),
        ] {
            let report = build_workflow_canvas_report(&chunks);
            assert_eq!(report.source, WorkflowCanvasSource::None);
            assert!(report.root.nodes.is_empty());
            assert!(report.selected_output_paths.is_empty());
        }

        let report = build_workflow_canvas_report(&workflow_chunks(json!({
            "nodes": [
                { "id": 1, "type": "A", "pos": ["x", 2], "size": 5, "inputs": "bad", "outputs": [7] },
                { "type": "no id" },
                { "id": 1, "type": "Duplicate" },
                "not a node"
            ],
            "links": [[1, 1, 0, 99, 0, "IMAGE"], "junk", { "origin_id": 1 }],
            "groups": [{ "title": "no bounds" }, { "bounding": [0, "y", 1, 1] }],
            "definitions": { "subgraphs": [{ "id": "loop", "nodes": [{ "id": 1, "type": "loop" }] }] }
        })));
        assert_eq!(report.root.nodes.len(), 1);
        assert_eq!(report.root.nodes[0].pos, None);
        assert_eq!(report.root.nodes[0].size, None);
        assert!(report.root.links.is_empty());
        assert!(report.root.groups.is_empty());
        assert_eq!(report.subgraphs[0].level.nodes.len(), 1);
    }

    #[test]
    fn every_fixture_gives_a_consistent_deterministic_canvas() {
        let root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("src/metadata/comfyui/tests/fixtures");
        let mut stack = vec![root];
        let mut checked = 0;
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(dir).expect("fixture dir") {
                let path = entry.expect("fixture entry").path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if !path.to_string_lossy().ends_with(".chunks.json") {
                    continue;
                }
                let Ok(chunks) = serde_json::from_str::<HashMap<String, String>>(
                    &std::fs::read_to_string(&path).expect("fixture text"),
                ) else {
                    continue;
                };
                let report = build_workflow_canvas_report(&chunks);
                assert_eq!(report, build_workflow_canvas_report(&chunks), "{path:?}");
                assert!(!report.truncated, "{path:?}");
                // The view highlights the selection by these paths, so each one
                // must lead to a node through the subgraph levels.
                for selected in report
                    .selected_output_paths
                    .iter()
                    .chain(&report.selected_branch_paths)
                {
                    assert!(
                        resolve(&report, selected).is_some(),
                        "{path:?} {selected:?}"
                    );
                }
                let levels = std::iter::once(&report.root)
                    .chain(report.subgraphs.iter().map(|subgraph| &subgraph.level));
                for level in levels {
                    let ids = level
                        .nodes
                        .iter()
                        .map(|node| node.id.as_str())
                        .collect::<HashSet<_>>();
                    assert_eq!(ids.len(), level.nodes.len(), "{path:?}");
                    for link in &level.links {
                        assert!(ids.contains(link.from_node.as_str()), "{path:?}");
                        assert!(ids.contains(link.to_node.as_str()), "{path:?}");
                    }
                }
                checked += 1;
            }
        }
        assert!(checked > 100);
    }

    // A file anyone can make may be enormous. The caps keep the report bounded
    // and the work short.
    #[test]
    fn a_huge_workflow_is_capped_and_finishes_quickly() {
        let nodes = (0..20_000)
            .map(|id| {
                json!({
                    "id": id, "type": "KSampler", "pos": [id, 0], "size": [300, 200],
                    "inputs": [{ "name": "model", "type": "MODEL", "link": id }],
                    "outputs": [{ "name": "LATENT", "type": "LATENT", "links": [id + 1] }],
                    "widgets_values": [id, "fixed", 20, 7, "euler", "normal", 1]
                })
            })
            .collect::<Vec<_>>();
        let links = (1..20_000)
            .flat_map(|id| {
                [
                    json!([id, id - 1, 0, id, 0, "MODEL"]),
                    json!([id + 50_000, id - 1, 0, id, 0, "LATENT"]),
                ]
            })
            .collect::<Vec<_>>();
        let subgraphs = (0..300)
            .map(|id| json!({ "id": format!("sub-{id}"), "nodes": [{ "id": 1, "type": "A" }], "links": [] }))
            .collect::<Vec<_>>();
        let chunks = workflow_chunks(json!({
            "nodes": nodes,
            "links": links,
            "definitions": { "subgraphs": subgraphs }
        }));

        let started = Instant::now();
        let report = build_workflow_canvas_report(&chunks);
        let elapsed = started.elapsed();

        assert!(report.truncated);
        assert_eq!(report.root.nodes.len(), MAX_LEVEL_NODES);
        assert!(report.root.links.len() <= MAX_LEVEL_LINKS);
        assert_eq!(report.subgraphs.len(), MAX_SUBGRAPHS);
        let total = report.root.nodes.len()
            + report
                .subgraphs
                .iter()
                .map(|subgraph| subgraph.level.nodes.len())
                .sum::<usize>();
        assert!(total <= MAX_TOTAL_NODES);
        // Unoptimised test builds included; a release build takes well under 1 s.
        assert!(elapsed < Duration::from_secs(5), "took {elapsed:?}");
    }

    #[test]
    fn oversized_raw_json_is_left_out() {
        let report = build_workflow_canvas_report(&workflow_chunks(json!({
            "nodes": [
                { "id": 1, "type": "Note", "widgets_values": ["x".repeat(MAX_NODE_RAW_JSON_BYTES)] },
                { "id": 2, "type": "SaveImage" }
            ],
            "links": []
        })));

        assert!(report.truncated);
        assert_eq!(node(&report.root, "1").raw_json, None);
        assert_eq!(node(&report.root, "1").widgets.len(), 1);
        assert!(node(&report.root, "1").widgets[0].is_long_text);
        assert!(node(&report.root, "2").raw_json.is_some());
    }

    // Many files name only the settings that can take a wire. Pairing those
    // names with the first values would show a wrong label on a real value,
    // which is worse than no label.
    #[test]
    fn settings_the_file_names_only_in_part_are_named_by_the_prompt_or_not_at_all() {
        let report = build_workflow_canvas_report(&fixture(
            "official_examples/sdxl/sdxl_simple_example.chunks.json",
        ));
        let names = [
            Some("add_noise"),
            Some("noise_seed"),
            Some("control_after_generate"),
            Some("steps"),
            Some("cfg"),
            Some("sampler_name"),
            Some("scheduler"),
            Some("start_at_step"),
            Some("end_at_step"),
            Some("return_with_leftover_noise"),
        ];
        let base = node(&report.root, "10");
        assert_eq!(widget_names(base), names);
        assert_eq!(base.widgets[3].value, "25");
        assert_eq!(base.widgets[8].value, "20");
        let refiner = node(&report.root, "11");
        assert_eq!(widget_names(refiner), names);
        assert_eq!(refiner.widgets[7].value, "20");
        assert_eq!(refiner.widgets[8].value, "10000");

        // Inside a subgraph no prompt node names the values, so only the seed's
        // control value, which is recognised by itself, gets a name.
        let report = build_workflow_canvas_report(&fixture(
            "official_catalog/02_qwen_Image_edit_subgraphed.chunks.json",
        ));
        let sampler = node(&report.subgraphs[0].level, "137");
        assert_eq!(
            widget_names(sampler),
            [
                None,
                Some("control_after_generate"),
                None,
                None,
                None,
                None,
                None
            ]
        );
    }

    // A bypassed node is left out of the prompt ComfyUI runs, but it is part
    // of the saved workflow and the view shows it, dimmed.
    #[test]
    fn bypassed_nodes_missing_from_the_prompt_are_still_drawn() {
        for (fixture_name, ids) in [
            (
                "official_examples/flux2/flux2_example.chunks.json",
                &["43", "39"][..],
            ),
            (
                "official_examples/z_image/z_image_turbo_example.chunks.json",
                &["11"][..],
            ),
        ] {
            let chunks = fixture(fixture_name);
            let prompt: Value = serde_json::from_str(&chunks["prompt"]).expect("prompt");
            let report = build_workflow_canvas_report(&chunks);

            assert_eq!(report.source, WorkflowCanvasSource::Workflow);
            for id in ids {
                assert!(prompt.get(*id).is_none(), "{fixture_name} {id}");
                assert_eq!(
                    node(&report.root, id).mode,
                    WorkflowCanvasNodeMode::Bypassed,
                    "{fixture_name} {id}"
                );
            }
        }
    }

    // A slot number is an index, not a size: a tiny prompt naming slot 10^9
    // must not build a billion ports.
    #[test]
    fn a_huge_prompt_slot_is_dropped_not_padded() {
        let chunks = HashMap::from([(
            "prompt".to_string(),
            json!({
                "1": { "class_type": "A", "inputs": {} },
                "2": { "class_type": "B", "inputs": {
                    "a": ["1", 10_000_000u64],
                    "b": ["1", 1_000_000_000u64],
                    "c": ["1", u64::MAX],
                    "d": ["1", 3]
                } },
                "3": { "class_type": "SaveImage", "inputs": { "images": ["2", 0] } }
            })
            .to_string(),
        )]);

        let report = timed(|| build_workflow_canvas_report(&chunks));

        assert_eq!(report.source, WorkflowCanvasSource::ApiPrompt);
        assert!(report.truncated);
        let source = node(&report.root, "1");
        assert_eq!(
            source
                .outputs
                .iter()
                .map(|port| port.slot)
                .collect::<Vec<_>>(),
            [3]
        );
        assert_eq!(node(&report.root, "2").inputs.len(), 1);
        assert!(json_bytes(&report) < 16 * 1024);
    }

    // Naming settings must stay linear in the prompt node's size. Values the
    // prompt does not hold are the worst case for a scan: each one reads every
    // prompt input. Only the canvas level is timed, not the evaluator.
    #[test]
    fn naming_settings_against_a_huge_prompt_node_stays_fast() {
        let mut values = (0..MAX_NODE_WIDGETS - 1)
            .map(|value| json!(format!("absent_{value}")))
            .collect::<Vec<_>>();
        values.push(json!("needle"));
        let mut inputs = (0..300_000)
            .map(|value| (format!("setting_{value}"), json!(value)))
            .collect::<serde_json::Map<_, _>>();
        inputs.insert("zz_last".to_string(), json!("needle"));
        let prompt = json!({ "1": { "class_type": "A", "inputs": inputs } });
        let prompt = prompt.as_object().expect("prompt object");
        let workflow = json!({ "nodes": [{ "id": 1, "type": "A", "widgets_values": values }] });

        let level =
            timed(|| workflow_level(&workflow, &HashSet::new(), Some(prompt), &mut Budget::new()));

        let names = widget_names(node(&level, "1"));
        assert_eq!(names.len(), MAX_NODE_WIDGETS);
        assert!(names[..MAX_NODE_WIDGETS - 1].iter().all(Option::is_none));
        assert_eq!(names[MAX_NODE_WIDGETS - 1], Some("zz_last"));
    }

    // Finding a subgraph output's slot by link id is one lookup, however many
    // ids the outputs list. The links' ids sit at the end of a long list, the
    // worst case for a scan. Only the canvas level is timed, not the evaluator.
    #[test]
    fn subgraph_output_slots_are_found_in_one_pass() {
        let link_ids = (0..200_000)
            .chain(200_000..210_000)
            .map(|id| json!(id))
            .collect::<Vec<_>>();
        let links = (200_000..210_000)
            .map(|id| {
                json!({ "id": id, "origin_id": 1, "origin_slot": 0, "target_id": -20, "target_slot": -1, "type": "IMAGE" })
            })
            .collect::<Vec<_>>();
        let definition = json!({
            "id": "Sub",
            "inputNode": { "id": -10, "bounding": [0, 0, 10, 10] },
            "outputNode": { "id": -20, "bounding": [0, 0, 10, 10] },
            "inputs": [],
            "outputs": [{ "name": "image", "type": "IMAGE", "linkIds": link_ids }],
            "nodes": [{ "id": 1, "type": "A", "outputs": [{ "name": "IMAGE", "type": "IMAGE", "links": [0] }] }],
            "links": links
        });

        let level =
            timed(|| workflow_level(&definition, &HashSet::new(), None, &mut Budget::new()));

        // The 10,000 saved links are one wire once duplicates are merged.
        assert_eq!(
            level.links,
            [WorkflowCanvasLink {
                from_node: "1".to_string(),
                from_slot: 0,
                to_node: "-20".to_string(),
                to_slot: 0,
                data_type: "IMAGE".to_string(),
                type_inferred: false,
            }]
        );
    }

    // Ports, settings and their text are capped per node and across the
    // report, so a few megabytes of input cannot become hundreds of megabytes.
    #[test]
    fn ports_settings_and_text_are_capped_per_node_and_in_total() {
        let wide = |id: usize| {
            json!({
                "id": id, "type": "A",
                "inputs": (0..1_000).map(|slot| json!({ "name": format!("in{slot}"), "type": "X" })).collect::<Vec<_>>(),
                "outputs": (0..1_000).map(|slot| json!({ "name": format!("out{slot}"), "type": "X", "links": [] })).collect::<Vec<_>>(),
                "widgets_values": (0..1_000).map(|value| json!(value)).collect::<Vec<_>>()
            })
        };
        let long_text = "x".repeat(MAX_WIDGET_VALUE_BYTES * 2);
        // About 10 MB, under the chunk cap; 100 nodes of 768 kept items each
        // pass the report's total.
        let mut nodes = (1..100).map(wide).collect::<Vec<_>>();
        nodes.push(json!({ "id": 999, "type": "Note", "title": "t".repeat(10_000), "widgets_values": [long_text] }));
        let workflow = json!({ "nodes": nodes, "links": [] });

        // Only the canvas level is timed; the evaluator's selection step on
        // this input is tracked separately (#615).
        timed(|| workflow_level(&workflow, &HashSet::new(), None, &mut Budget::new()));
        let report = build_workflow_canvas_report(&workflow_chunks(workflow));

        assert!(report.truncated);
        let first = node(&report.root, "1");
        assert_eq!(first.inputs.len(), MAX_NODE_PORTS);
        assert_eq!(first.outputs.len(), MAX_NODE_PORTS);
        assert_eq!(first.widgets.len(), MAX_NODE_WIDGETS);
        let items = report
            .root
            .nodes
            .iter()
            .map(|node| node.inputs.len() + node.outputs.len() + node.widgets.len())
            .sum::<usize>();
        assert!(items <= MAX_TOTAL_ITEMS);
        let note = node(&report.root, "999");
        assert_eq!(note.title.len(), MAX_LABEL_BYTES);
        assert!(note
            .widgets
            .iter()
            .all(|widget| widget.value.len() <= MAX_WIDGET_VALUE_BYTES));
        assert!(json_bytes(&report) < 64 * 1024 * 1024);
    }
}
