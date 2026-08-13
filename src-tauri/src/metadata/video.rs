use super::{extract_comfyui_metadata, ImageMetadata, VIDEO_PARSER_VERSION};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

const SIDECAR_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(serde::Serialize, serde::Deserialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VideoGenerationMode {
    TextToVideo,
    ImageToVideo,
    FirstLastFrameToVideo,
    VideoEditing,
    AudioLipSync,
    GuidedVideo,
    Unknown,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetadataEvidenceSource {
    UserOverride,
    TrustedSidecar,
    Embedded,
    WorkflowDefault,
    Unknown,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadataConflict {
    pub field: String,
    pub selected_value: String,
    pub ignored_value: String,
    pub ignored_source: MetadataEvidenceSource,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadataDiagnostic {
    pub code: String,
    pub message: String,
}

#[derive(serde::Serialize, serde::Deserialize, specta::Type, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenerationMetadata {
    pub tool: String,
    pub model: String,
    pub seed: Option<i64>,
    pub steps: u32,
    pub cfg: f32,
    pub sampler: String,
    pub positive_prompt: String,
    pub negative_prompt: String,
    pub loras: Vec<String>,
    pub control_nets: Vec<String>,
    pub ip_adapters: Vec<String>,
    pub generation_type: String,
    pub generation_mode: VideoGenerationMode,
    pub workflow_json: Option<String>,
    pub field_sources: BTreeMap<String, MetadataEvidenceSource>,
    pub conflicts: Vec<VideoMetadataConflict>,
    pub diagnostics: Vec<VideoMetadataDiagnostic>,
    pub parser_version: u32,
}

impl Default for VideoGenerationMetadata {
    fn default() -> Self {
        Self {
            tool: "Unknown".into(),
            model: "Unknown".into(),
            seed: None,
            steps: 0,
            cfg: 0.0,
            sampler: "Unknown".into(),
            positive_prompt: String::new(),
            negative_prompt: String::new(),
            loras: Vec::new(),
            control_nets: Vec::new(),
            ip_adapters: Vec::new(),
            generation_type: "unknown".into(),
            generation_mode: VideoGenerationMode::Unknown,
            workflow_json: None,
            field_sources: BTreeMap::new(),
            conflicts: Vec::new(),
            diagnostics: Vec::new(),
            parser_version: VIDEO_PARSER_VERSION,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VideoMetadataEvidence {
    pub metadata: VideoGenerationMetadata,
    pub original_metadata_json: String,
}

#[derive(Debug)]
struct Candidate {
    metadata: VideoGenerationMetadata,
    raw_json: String,
    source: MetadataEvidenceSource,
}

pub fn extract_video_metadata(video_path: &Path, mediainfo: &Value) -> VideoMetadataEvidence {
    let mut diagnostics = Vec::new();
    let embedded = embedded_candidate(mediainfo, &mut diagnostics);
    let sidecar = sidecar_candidate(video_path, &mut diagnostics);
    evidence_from_candidates(sidecar, embedded, diagnostics)
}

pub fn reparse_video_metadata(original_evidence_json: &str) -> Option<VideoGenerationMetadata> {
    let evidence: Value = serde_json::from_str(original_evidence_json).ok()?;
    if !evidence.is_object()
        || (!evidence.get("sidecar").is_some() && !evidence.get("embedded").is_some())
    {
        return None;
    }
    let mut diagnostics = Vec::new();
    let sidecar = evidence
        .get("sidecar")
        .and_then(Value::as_str)
        .and_then(|raw| stored_sidecar_candidate(raw, &mut diagnostics));
    let embedded = evidence
        .get("embedded")
        .and_then(Value::as_str)
        .and_then(|raw| stored_embedded_candidate(raw, &mut diagnostics));
    Some(evidence_from_candidates(sidecar, embedded, diagnostics).metadata)
}

pub fn refresh_video_metadata_evidence(
    video_path: &Path,
    original_evidence_json: &str,
) -> Option<VideoMetadataEvidence> {
    let evidence: Value = serde_json::from_str(original_evidence_json).ok()?;
    if !evidence.is_object()
        || (!evidence.get("sidecar").is_some() && !evidence.get("embedded").is_some())
    {
        return None;
    }

    let mut diagnostics = Vec::new();
    let embedded = evidence
        .get("embedded")
        .and_then(Value::as_str)
        .and_then(|raw| stored_embedded_candidate(raw, &mut diagnostics));
    let sidecar = sidecar_candidate(video_path, &mut diagnostics);
    Some(evidence_from_candidates(sidecar, embedded, diagnostics))
}

fn evidence_from_candidates(
    sidecar: Option<Candidate>,
    embedded: Option<Candidate>,
    diagnostics: Vec<VideoMetadataDiagnostic>,
) -> VideoMetadataEvidence {
    let selected = sidecar.as_ref().or(embedded.as_ref());

    let mut metadata = selected
        .map(|candidate| candidate.metadata.clone())
        .unwrap_or_default();
    metadata.diagnostics.extend(diagnostics);

    if let (Some(sidecar), Some(embedded)) = (&sidecar, &embedded) {
        record_conflicts(&mut metadata, sidecar, embedded);
    }

    let original_metadata_json = serde_json::json!({
        "sidecar": sidecar.as_ref().map(|candidate| &candidate.raw_json),
        "embedded": embedded.as_ref().map(|candidate| &candidate.raw_json),
    })
    .to_string();

    VideoMetadataEvidence {
        metadata,
        original_metadata_json,
    }
}

fn stored_sidecar_candidate(
    raw_json: &str,
    diagnostics: &mut Vec<VideoMetadataDiagnostic>,
) -> Option<Candidate> {
    let wrapper: Value = serde_json::from_str(raw_json).ok()?;
    let workflow = wrapper.get("workflow")?;
    candidate_from_workflow(
        workflow,
        raw_json.to_string(),
        MetadataEvidenceSource::TrustedSidecar,
    )
    .map_err(|(code, message)| diagnostic(diagnostics, code, message))
    .ok()
}

fn stored_embedded_candidate(
    raw_json: &str,
    diagnostics: &mut Vec<VideoMetadataDiagnostic>,
) -> Option<Candidate> {
    let chunks = serde_json::from_str::<HashMap<String, String>>(raw_json).ok()?;
    let workflow = chunks
        .get("workflow")
        .or_else(|| chunks.get("prompt"))
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())?;
    candidate_from_chunks(
        &chunks,
        &workflow,
        raw_json.to_string(),
        MetadataEvidenceSource::Embedded,
    )
    .map_err(|(code, message)| diagnostic(diagnostics, code, message))
    .ok()
}

fn sidecar_candidate(
    video_path: &Path,
    diagnostics: &mut Vec<VideoMetadataDiagnostic>,
) -> Option<Candidate> {
    let sidecar_path = sidecar_path(video_path)?;
    let metadata = match fs::symlink_metadata(&sidecar_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            diagnostic(diagnostics, "sidecar_unreadable", error.to_string());
            return None;
        }
    };
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        diagnostic(
            diagnostics,
            "sidecar_not_regular_file",
            "Sidecar evidence must be a regular, non-symlink file",
        );
        return None;
    }
    if metadata.len() > SIDECAR_LIMIT {
        diagnostic(
            diagnostics,
            "sidecar_too_large",
            "Sidecar evidence exceeds the 2 MiB limit",
        );
        return None;
    }

    let raw_json = match fs::read_to_string(&sidecar_path) {
        Ok(raw) => raw,
        Err(error) => {
            diagnostic(diagnostics, "sidecar_invalid_utf8", error.to_string());
            return None;
        }
    };
    let wrapper: Value = match serde_json::from_str(&raw_json) {
        Ok(value) => value,
        Err(error) => {
            diagnostic(diagnostics, "sidecar_invalid_json", error.to_string());
            return None;
        }
    };
    let expected_media = video_path.file_name()?.to_string_lossy();
    if wrapper.get("media").and_then(Value::as_str) != Some(expected_media.as_ref()) {
        diagnostic(
            diagnostics,
            "sidecar_media_mismatch",
            "Sidecar media must exactly match the sibling video filename",
        );
        return None;
    }
    let workflow = match wrapper.get("workflow") {
        Some(workflow) => workflow,
        None => {
            diagnostic(
                diagnostics,
                "sidecar_workflow_missing",
                "Sidecar has no workflow object",
            );
            return None;
        }
    };
    candidate_from_workflow(workflow, raw_json, MetadataEvidenceSource::TrustedSidecar)
        .map_err(|(code, message)| diagnostic(diagnostics, code, message))
        .ok()
}

fn embedded_candidate(
    mediainfo: &Value,
    diagnostics: &mut Vec<VideoMetadataDiagnostic>,
) -> Option<Candidate> {
    let mut chunks = HashMap::new();
    collect_embedded_chunks(mediainfo, &mut chunks);
    if chunks.is_empty() {
        return None;
    }

    let workflow = chunks
        .get("workflow")
        .or_else(|| chunks.get("prompt"))
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let Some(workflow) = workflow else {
        diagnostic(
            diagnostics,
            "embedded_workflow_invalid",
            "Embedded ComfyUI workflow evidence is not valid JSON",
        );
        return None;
    };
    let raw_json = serde_json::to_string(&chunks).unwrap_or_else(|_| "{}".into());
    candidate_from_chunks(
        &chunks,
        &workflow,
        raw_json,
        MetadataEvidenceSource::Embedded,
    )
    .map_err(|(code, message)| diagnostic(diagnostics, code, message))
    .ok()
}

fn candidate_from_workflow(
    workflow: &Value,
    raw_json: String,
    source: MetadataEvidenceSource,
) -> Result<Candidate, (&'static str, String)> {
    let mut chunks = HashMap::new();
    chunks.insert(
        "workflow".into(),
        serde_json::to_string(workflow).map_err(|error| {
            (
                "workflow_invalid",
                format!("Workflow could not be serialized: {error}"),
            )
        })?,
    );
    candidate_from_chunks(&chunks, workflow, raw_json, source)
}

fn candidate_from_chunks(
    chunks: &HashMap<String, String>,
    workflow: &Value,
    raw_json: String,
    source: MetadataEvidenceSource,
) -> Result<Candidate, (&'static str, String)> {
    validate_workflow(workflow)?;
    let selected_workflow = selected_video_workflow(workflow)?;
    let selected_key = if workflow.get("nodes").and_then(Value::as_array).is_some() {
        "workflow"
    } else {
        "prompt"
    };
    let mut selected_chunks = HashMap::from([(
        selected_key.to_string(),
        serde_json::to_string(&selected_workflow).map_err(|error| {
            (
                "workflow_invalid",
                format!("Selected workflow could not be serialized: {error}"),
            )
        })?,
    )]);
    if selected_key == "workflow" {
        if let Some(selected_prompt) = chunks
            .get("prompt")
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .filter(|prompt| is_linked_video_graph(prompt))
            .and_then(|prompt| selected_video_workflow(&prompt).ok())
            .and_then(|prompt| serde_json::to_string(&prompt).ok())
        {
            selected_chunks.insert("prompt".into(), selected_prompt);
        }
    }
    let mut image_metadata = extract_comfyui_metadata(&selected_chunks);
    image_metadata.workflow_json = chunks
        .get(selected_key)
        .cloned()
        .or_else(|| serde_json::to_string(workflow).ok());
    let mode = classify_generation_mode(workflow);
    let mut metadata = from_image_metadata(image_metadata, mode);
    for field in [
        "tool",
        "model",
        "seed",
        "steps",
        "cfg",
        "sampler",
        "loras",
        "controlNets",
        "ipAdapters",
        "positivePrompt",
        "negativePrompt",
        "generationType",
        "generationMode",
        "workflowJson",
    ] {
        metadata.field_sources.insert(field.into(), source);
    }
    Ok(Candidate {
        metadata,
        raw_json,
        source,
    })
}

fn selected_video_workflow(workflow: &Value) -> Result<Value, (&'static str, String)> {
    if let Some(nodes) = workflow.get("nodes").and_then(Value::as_array) {
        let reachable = reachable_ui_node_ids(workflow, nodes);
        let mut selected = workflow.clone();
        selected["nodes"] = Value::Array(
            nodes
                .iter()
                .filter(|node| {
                    node_is_active(node) && node.get("id").is_some_and(|id| reachable.contains(id))
                })
                .cloned()
                .collect(),
        );
        selected["links"] = Value::Array(
            workflow
                .get("links")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|link| {
                    link.as_array().is_some_and(|link| {
                        link.get(1).is_some_and(|id| reachable.contains(id))
                            && link.get(3).is_some_and(|id| reachable.contains(id))
                    })
                })
                .cloned()
                .collect(),
        );
        return Ok(selected);
    }

    let Some(nodes) = workflow.as_object() else {
        return Err(("workflow_invalid", "Workflow has no node map".into()));
    };
    let reachable = reachable_prompt_node_ids(nodes);
    Ok(Value::Object(
        nodes
            .iter()
            .filter(|(id, node)| reachable.contains(*id) && node_is_active(node))
            .map(|(id, node)| (id.clone(), node.clone()))
            .collect(),
    ))
}

fn reachable_ui_node_ids(workflow: &Value, nodes: &[Value]) -> Vec<Value> {
    let Some(save_id) = nodes
        .iter()
        .find(|node| node_type(node) == Some("SaveVideo") && node_is_active(node))
        .and_then(|node| node.get("id"))
        .cloned()
    else {
        return Vec::new();
    };
    let mut reachable = vec![save_id];
    let links = workflow
        .get("links")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    loop {
        let mut changed = false;
        for link in links.iter().filter_map(Value::as_array) {
            let (Some(source_id), Some(target_id)) = (link.get(1), link.get(3)) else {
                continue;
            };
            if reachable.contains(target_id)
                && !reachable.contains(source_id)
                && nodes
                    .iter()
                    .any(|node| node.get("id") == Some(source_id) && node_is_active(node))
            {
                reachable.push(source_id.clone());
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    reachable
}

fn reachable_prompt_node_ids(nodes: &serde_json::Map<String, Value>) -> Vec<String> {
    let Some(save_id) = nodes.iter().find_map(|(id, node)| {
        (node_type(node) == Some("SaveVideo") && node_is_active(node)).then(|| id.clone())
    }) else {
        return Vec::new();
    };
    let mut reachable = vec![save_id];
    loop {
        let mut changed = false;
        for target_id in reachable.clone() {
            let Some(inputs) = nodes.get(&target_id).and_then(|node| node.get("inputs")) else {
                continue;
            };
            let mut source_ids = Vec::new();
            collect_prompt_source_ids(inputs, nodes, &mut source_ids);
            for source_id in source_ids {
                if !reachable.contains(&source_id)
                    && nodes.get(&source_id).is_some_and(node_is_active)
                {
                    reachable.push(source_id);
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    reachable
}

fn validate_workflow(workflow: &Value) -> Result<(), (&'static str, String)> {
    let nodes = workflow_nodes(workflow);
    if nodes.is_empty() {
        return Err(("workflow_invalid", "Workflow has no nodes".into()));
    }
    if all_workflow_nodes(workflow).iter().any(|node| {
        node.pointer("/properties/cnr_id")
            .and_then(Value::as_str)
            .is_some_and(|id| id != "comfy-core")
    }) {
        return Err((
            "workflow_custom_nodes",
            "Workflow contains custom-node evidence".into(),
        ));
    }
    let save_video: Vec<&Value> = nodes
        .iter()
        .copied()
        .filter(|node| node_type(node) == Some("SaveVideo") && node_is_active(node))
        .collect();
    if save_video.len() != 1 {
        return Err((
            "workflow_save_video_ambiguous",
            format!(
                "Workflow must contain one active core SaveVideo node; found {}",
                save_video.len()
            ),
        ));
    }
    let save = save_video[0];
    if save.pointer("/properties/cnr_id").and_then(Value::as_str) != Some("comfy-core") {
        return Err((
            "workflow_save_video_not_core",
            "SaveVideo must be a Comfy core node".into(),
        ));
    }
    let connected = save_video_has_active_source(workflow, &nodes, save);
    if !connected {
        return Err((
            "workflow_save_video_disconnected",
            "SaveVideo is not connected to a video source".into(),
        ));
    }
    Ok(())
}

fn is_linked_video_graph(workflow: &Value) -> bool {
    let nodes = workflow_nodes(workflow);
    if nodes.is_empty()
        || all_workflow_nodes(workflow).iter().any(|node| {
            node.pointer("/properties/cnr_id")
                .and_then(Value::as_str)
                .is_some_and(|id| id != "comfy-core")
        })
    {
        return false;
    }
    let save_video: Vec<&Value> = nodes
        .iter()
        .copied()
        .filter(|node| node_type(node) == Some("SaveVideo") && node_is_active(node))
        .collect();
    save_video.len() == 1 && save_video_has_active_source(workflow, &nodes, save_video[0])
}

fn workflow_nodes(workflow: &Value) -> Vec<&Value> {
    if let Some(nodes) = workflow.get("nodes").and_then(Value::as_array) {
        return nodes.iter().collect();
    }
    workflow
        .as_object()
        .map(|nodes| nodes.values().collect())
        .unwrap_or_default()
}

fn all_workflow_nodes(workflow: &Value) -> Vec<&Value> {
    let mut nodes = workflow_nodes(workflow);
    if let Some(subgraphs) = workflow
        .pointer("/definitions/subgraphs")
        .and_then(Value::as_array)
    {
        for subgraph in subgraphs {
            if let Some(subgraph_nodes) = subgraph.get("nodes").and_then(Value::as_array) {
                nodes.extend(subgraph_nodes);
            }
        }
    }
    nodes
}

fn node_type(node: &Value) -> Option<&str> {
    node.get("type")
        .or_else(|| node.get("class_type"))
        .and_then(Value::as_str)
}

fn node_is_active(node: &Value) -> bool {
    !matches!(node.get("mode").and_then(Value::as_i64), Some(mode) if mode != 0)
}

fn save_video_has_active_source(workflow: &Value, nodes: &[&Value], save: &Value) -> bool {
    if let Some(source_id) = save
        .pointer("/inputs/video")
        .and_then(Value::as_array)
        .and_then(|link| link.first())
        .and_then(Value::as_str)
    {
        return workflow.get(source_id).is_some_and(node_is_active);
    }

    let Some(save_id) = save.get("id") else {
        return false;
    };
    let Some(video_link) = save
        .get("inputs")
        .and_then(Value::as_array)
        .and_then(|inputs| {
            inputs.iter().find(|input| {
                input.get("name").and_then(Value::as_str) == Some("video")
                    && input.get("type").and_then(Value::as_str) == Some("VIDEO")
            })
        })
        .and_then(|input| input.get("link"))
    else {
        return false;
    };

    workflow
        .get("links")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
        .any(|link| {
            let Some(source_id) = link.get(1) else {
                return false;
            };
            link.first() == Some(video_link)
                && link.get(3) == Some(save_id)
                && link.get(5).and_then(Value::as_str) == Some("VIDEO")
                && nodes
                    .iter()
                    .any(|node| node.get("id") == Some(source_id) && node_is_active(node))
        })
}

fn classify_generation_mode(workflow: &Value) -> VideoGenerationMode {
    let active_nodes = active_output_nodes(workflow);
    let mut evidence = active_nodes
        .iter()
        .flat_map(|node| {
            [
                node_type(node),
                node.get("title").and_then(Value::as_str),
                node.pointer("/_meta/title").and_then(Value::as_str),
            ]
        })
        .flatten()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if let Some(subgraphs) = workflow
        .pointer("/definitions/subgraphs")
        .and_then(Value::as_array)
    {
        evidence.extend(
            subgraphs
                .iter()
                .filter(|subgraph| {
                    let Some(id) = subgraph.get("id").and_then(Value::as_str) else {
                        return false;
                    };
                    active_nodes.iter().any(|node| node_type(node) == Some(id))
                })
                .filter_map(|subgraph| subgraph.get("name").and_then(Value::as_str))
                .map(str::to_owned),
        );
    }
    let haystack = evidence.join(" ").to_ascii_lowercase();

    if contains_any(&haystack, &["lip", "audio", "ia2v", "audio2video"]) {
        VideoGenerationMode::AudioLipSync
    } else if contains_any(&haystack, &["canny", "depth", "controlnet", "guided"]) {
        VideoGenerationMode::GuidedVideo
    } else if contains_any(
        &haystack,
        &["bernini", "video edit", "videoedit", "editing"],
    ) {
        VideoGenerationMode::VideoEditing
    } else if contains_any(
        &haystack,
        &[
            "first last",
            "first-last",
            "firstlastframe",
            "flf2v",
            "start frame",
            "end frame",
        ],
    ) {
        VideoGenerationMode::FirstLastFrameToVideo
    } else if contains_any(
        &haystack,
        &[
            "i2v",
            "image to video",
            "image2video",
            "imagetovideo",
            "loadimage",
        ],
    ) {
        VideoGenerationMode::ImageToVideo
    } else if contains_any(
        &haystack,
        &["t2v", "text to video", "text2video", "texttovideo"],
    ) {
        VideoGenerationMode::TextToVideo
    } else {
        VideoGenerationMode::Unknown
    }
}

fn active_output_nodes(workflow: &Value) -> Vec<&Value> {
    if let Some(nodes) = workflow.get("nodes").and_then(Value::as_array) {
        let reachable = reachable_ui_node_ids(workflow, nodes);
        return nodes
            .iter()
            .filter(|node| {
                node_is_active(node) && node.get("id").is_some_and(|id| reachable.contains(id))
            })
            .collect();
    }

    let Some(nodes) = workflow.as_object() else {
        return Vec::new();
    };
    let reachable = reachable_prompt_node_ids(nodes);
    reachable
        .iter()
        .filter_map(|id| nodes.get(id))
        .filter(|node| node_is_active(node))
        .collect()
}

fn collect_prompt_source_ids(
    value: &Value,
    nodes: &serde_json::Map<String, Value>,
    source_ids: &mut Vec<String>,
) {
    match value {
        Value::Array(values) => {
            if values.len() == 2 && values.get(1).is_some_and(Value::is_number) {
                if let Some(source_id) = values.first().and_then(Value::as_str) {
                    if nodes.contains_key(source_id) {
                        source_ids.push(source_id.to_string());
                        return;
                    }
                }
            }
            for value in values {
                collect_prompt_source_ids(value, nodes, source_ids);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                collect_prompt_source_ids(value, nodes, source_ids);
            }
        }
        _ => {}
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn from_image_metadata(
    metadata: ImageMetadata,
    mode: VideoGenerationMode,
) -> VideoGenerationMetadata {
    VideoGenerationMetadata {
        tool: metadata.tool,
        model: metadata.model,
        seed: metadata.seed,
        steps: metadata.steps,
        cfg: metadata.cfg,
        sampler: metadata.sampler,
        positive_prompt: metadata.positive_prompt,
        negative_prompt: metadata.negative_prompt,
        loras: metadata.loras,
        control_nets: metadata.control_nets,
        ip_adapters: metadata.ip_adapters,
        generation_type: generation_type(mode).into(),
        generation_mode: mode,
        workflow_json: metadata.workflow_json,
        ..VideoGenerationMetadata::default()
    }
}

fn generation_type(mode: VideoGenerationMode) -> &'static str {
    match mode {
        VideoGenerationMode::TextToVideo => "text_to_video",
        VideoGenerationMode::ImageToVideo => "image_to_video",
        VideoGenerationMode::FirstLastFrameToVideo => "first_last_frame_to_video",
        VideoGenerationMode::VideoEditing => "video_editing",
        VideoGenerationMode::AudioLipSync => "audio_lip_sync",
        VideoGenerationMode::GuidedVideo => "guided_video",
        VideoGenerationMode::Unknown => "unknown",
    }
}

fn collect_embedded_chunks(value: &Value, chunks: &mut HashMap<String, String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                let normalized = key.to_ascii_lowercase();
                if matches!(normalized.as_str(), "prompt" | "workflow") {
                    if let Some(raw) = value
                        .as_str()
                        .map(str::to_owned)
                        .or_else(|| serde_json::to_string(value).ok())
                    {
                        chunks.entry(normalized).or_insert(raw);
                    }
                }
                collect_embedded_chunks(value, chunks);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_embedded_chunks(value, chunks);
            }
        }
        _ => {}
    }
}

fn record_conflicts(
    selected: &mut VideoGenerationMetadata,
    primary: &Candidate,
    secondary: &Candidate,
) {
    for (field, selected_value, ignored_value) in [
        ("tool", &primary.metadata.tool, &secondary.metadata.tool),
        (
            "positivePrompt",
            &primary.metadata.positive_prompt,
            &secondary.metadata.positive_prompt,
        ),
        (
            "negativePrompt",
            &primary.metadata.negative_prompt,
            &secondary.metadata.negative_prompt,
        ),
        (
            "sampler",
            &primary.metadata.sampler,
            &secondary.metadata.sampler,
        ),
        ("model", &primary.metadata.model, &secondary.metadata.model),
        (
            "generationType",
            &primary.metadata.generation_type,
            &secondary.metadata.generation_type,
        ),
    ] {
        push_conflict(
            selected,
            secondary.source,
            field,
            selected_value,
            ignored_value,
        );
    }
    for (field, selected_value, ignored_value) in [
        (
            "seed",
            primary.metadata.seed.map(|value| value.to_string()),
            secondary.metadata.seed.map(|value| value.to_string()),
        ),
        (
            "steps",
            (primary.metadata.steps > 0).then(|| primary.metadata.steps.to_string()),
            (secondary.metadata.steps > 0).then(|| secondary.metadata.steps.to_string()),
        ),
        (
            "cfg",
            (primary.metadata.cfg > 0.0).then(|| primary.metadata.cfg.to_string()),
            (secondary.metadata.cfg > 0.0).then(|| secondary.metadata.cfg.to_string()),
        ),
        (
            "generationMode",
            (primary.metadata.generation_mode != VideoGenerationMode::Unknown)
                .then(|| generation_type(primary.metadata.generation_mode).to_string()),
            (secondary.metadata.generation_mode != VideoGenerationMode::Unknown)
                .then(|| generation_type(secondary.metadata.generation_mode).to_string()),
        ),
        (
            "loras",
            (!primary.metadata.loras.is_empty()).then(|| primary.metadata.loras.join(", ")),
            (!secondary.metadata.loras.is_empty()).then(|| secondary.metadata.loras.join(", ")),
        ),
        (
            "controlNets",
            (!primary.metadata.control_nets.is_empty())
                .then(|| primary.metadata.control_nets.join(", ")),
            (!secondary.metadata.control_nets.is_empty())
                .then(|| secondary.metadata.control_nets.join(", ")),
        ),
        (
            "ipAdapters",
            (!primary.metadata.ip_adapters.is_empty())
                .then(|| primary.metadata.ip_adapters.join(", ")),
            (!secondary.metadata.ip_adapters.is_empty())
                .then(|| secondary.metadata.ip_adapters.join(", ")),
        ),
    ] {
        if let (Some(selected_value), Some(ignored_value)) = (selected_value, ignored_value) {
            push_conflict(
                selected,
                secondary.source,
                field,
                &selected_value,
                &ignored_value,
            );
        }
    }
}

fn push_conflict(
    selected: &mut VideoGenerationMetadata,
    ignored_source: MetadataEvidenceSource,
    field: &str,
    selected_value: &str,
    ignored_value: &str,
) {
    if !ignored_value.is_empty()
        && ignored_value != "Unknown"
        && !selected_value.is_empty()
        && selected_value != "Unknown"
        && selected_value != ignored_value
    {
        selected.conflicts.push(VideoMetadataConflict {
            field: field.into(),
            selected_value: selected_value.into(),
            ignored_value: ignored_value.into(),
            ignored_source,
        });
    }
}

fn sidecar_path(video_path: &Path) -> Option<PathBuf> {
    let stem = video_path.file_stem()?.to_string_lossy();
    Some(video_path.with_file_name(format!("{stem}.workflow.json")))
}

fn diagnostic(
    diagnostics: &mut Vec<VideoMetadataDiagnostic>,
    code: impl Into<String>,
    message: impl Into<String>,
) {
    diagnostics.push(VideoMetadataDiagnostic {
        code: code.into(),
        message: message.into(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn workflow(node_type: &str) -> Value {
        serde_json::json!({
            "nodes": [
                {"id": 1, "type": node_type, "mode": 0, "properties": {"cnr_id": "comfy-core"}},
                {"id": 2, "type": "SaveVideo", "mode": 0, "inputs": [{"name": "video", "type": "VIDEO", "link": 10}], "properties": {"cnr_id": "comfy-core"}}
            ],
            "links": [[10, 1, 0, 2, 0, "VIDEO"]]
        })
    }

    fn official_fixture(raw: &str) -> Value {
        serde_json::from_str::<Value>(raw).unwrap()["workflow"].clone()
    }

    #[test]
    fn pinned_official_workflows_cover_the_six_wp3_modes() {
        for (raw, expected) in [
            (
                include_str!("comfyui/tests/fixtures/official_video/video_ltx2_3_t2v.json"),
                VideoGenerationMode::TextToVideo,
            ),
            (
                include_str!("comfyui/tests/fixtures/official_video/video_wan2_2_14B_i2v.json"),
                VideoGenerationMode::ImageToVideo,
            ),
            (
                include_str!("comfyui/tests/fixtures/official_video/video_ltx2_3_flf2v.json"),
                VideoGenerationMode::FirstLastFrameToVideo,
            ),
            (
                include_str!(
                    "comfyui/tests/fixtures/official_video/video_bernini_r_video_editing.json"
                ),
                VideoGenerationMode::VideoEditing,
            ),
            (
                include_str!("comfyui/tests/fixtures/official_video/video_ltx2_3_ia2v.json"),
                VideoGenerationMode::AudioLipSync,
            ),
            (
                include_str!(
                    "comfyui/tests/fixtures/official_video/video_ltx2_canny_to_video.json"
                ),
                VideoGenerationMode::GuidedVideo,
            ),
        ] {
            let workflow = official_fixture(raw);
            validate_workflow(&workflow).expect("pinned workflow must be trusted");
            assert_eq!(classify_generation_mode(&workflow), expected);
            let candidate = candidate_from_workflow(
                &workflow,
                raw.to_string(),
                MetadataEvidenceSource::TrustedSidecar,
            )
            .expect("pinned workflow should parse");
            assert_eq!(candidate.metadata.tool, "ComfyUI");
            assert!(candidate.metadata.workflow_json.is_some());
            assert!(
                !candidate.metadata.positive_prompt.trim().is_empty()
                    || candidate.metadata.model != "Unknown",
                "pinned workflow should yield a prompt or model"
            );
        }
    }

    #[test]
    fn generation_mode_priority_covers_the_six_wp3_families() {
        for (node, expected) in [
            ("TextToVideo", VideoGenerationMode::TextToVideo),
            ("WanImageToVideo", VideoGenerationMode::ImageToVideo),
            (
                "LTXVFirstLastFrame",
                VideoGenerationMode::FirstLastFrameToVideo,
            ),
            ("BerniniVideoEditing", VideoGenerationMode::VideoEditing),
            ("LTXVAudioToVideo", VideoGenerationMode::AudioLipSync),
            ("CannyControlNet", VideoGenerationMode::GuidedVideo),
        ] {
            assert_eq!(
                classify_generation_mode(&workflow(node)),
                expected,
                "{node}"
            );
        }
        assert_eq!(
            classify_generation_mode(&workflow("VideoModel")),
            VideoGenerationMode::Unknown
        );
    }

    #[test]
    fn generation_mode_ignores_inactive_and_disconnected_nodes() {
        let mut graph = workflow("TextToVideo");
        graph["nodes"].as_array_mut().unwrap().extend([
            serde_json::json!({"id": 3, "type": "Canny", "mode": 4}),
            serde_json::json!({"id": 4, "type": "LoadAudio", "mode": 0}),
        ]);

        assert_eq!(
            classify_generation_mode(&graph),
            VideoGenerationMode::TextToVideo
        );

        let prompt = serde_json::json!({
            "1": {"class_type": "TextToVideo", "inputs": {}},
            "2": {"class_type": "SaveVideo", "inputs": {"video": ["1", 0]}},
            "3": {"class_type": "Canny", "inputs": {}}
        });
        assert_eq!(
            classify_generation_mode(&prompt),
            VideoGenerationMode::TextToVideo
        );
    }

    #[test]
    fn generation_metadata_ignores_disconnected_parameter_nodes() {
        let prompt = serde_json::json!({
            "1": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": 42,
                    "steps": 24,
                    "cfg": 7.0,
                    "sampler_name": "euler",
                    "literal_values": ["0", "not-an-output-index"]
                },
                "properties": {"cnr_id": "comfy-core"}
            },
            "2": {
                "class_type": "SaveVideo",
                "inputs": {"video": ["1", 0]},
                "properties": {"cnr_id": "comfy-core"}
            },
            "0": {
                "class_type": "SDParameterGenerator",
                "inputs": {
                    "seed": 999,
                    "steps": 999,
                    "cfg": 99.0,
                    "sampler": "disconnected_sampler",
                    "ckpt_name": "disconnected_model.safetensors"
                },
                "properties": {"cnr_id": "comfy-core"}
            }
        });
        let chunks = HashMap::from([("prompt".to_string(), prompt.to_string())]);

        let candidate = candidate_from_chunks(
            &chunks,
            &prompt,
            "raw evidence".into(),
            MetadataEvidenceSource::Embedded,
        )
        .expect("connected SaveVideo ancestry should parse");

        assert_eq!(candidate.metadata.seed, Some(42));
        assert_eq!(candidate.metadata.steps, 24);
        assert_eq!(candidate.metadata.cfg, 7.0);
        assert_eq!(candidate.metadata.sampler, "euler");
        assert_ne!(candidate.metadata.model, "disconnected_model");
        assert!(
            candidate
                .metadata
                .workflow_json
                .as_deref()
                .is_some_and(|raw| raw.contains("disconnected_model")),
            "the full workflow remains available for inspection"
        );

        let mut api_prompt = prompt.clone();
        api_prompt["2"]
            .as_object_mut()
            .unwrap()
            .remove("properties");
        let ui_workflow = workflow("TextToVideo");
        let chunks = HashMap::from([
            ("workflow".to_string(), ui_workflow.to_string()),
            ("prompt".to_string(), api_prompt.to_string()),
        ]);
        let candidate = candidate_from_chunks(
            &chunks,
            &ui_workflow,
            "raw evidence".into(),
            MetadataEvidenceSource::Embedded,
        )
        .expect("validated UI workflow should safely use its linked API prompt");
        assert_eq!(candidate.metadata.steps, 24);
        assert_ne!(candidate.metadata.model, "disconnected_model");
    }

    #[test]
    fn rejects_ambiguous_and_custom_save_video_evidence() {
        let mut ambiguous = workflow("LTXVConditioning");
        ambiguous["nodes"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"id":3,"type":"SaveVideo","inputs":[{"link":11}]}));
        assert_eq!(
            validate_workflow(&ambiguous).unwrap_err().0,
            "workflow_save_video_ambiguous"
        );

        let mut custom = workflow("LTXVConditioning");
        custom["nodes"][0]["properties"]["cnr_id"] = Value::String("custom-pack".into());
        assert_eq!(
            validate_workflow(&custom).unwrap_err().0,
            "workflow_custom_nodes"
        );

        let mut unverified_save = workflow("TextToVideo");
        unverified_save["nodes"][1]["properties"] = serde_json::json!({});
        assert_eq!(
            validate_workflow(&unverified_save).unwrap_err().0,
            "workflow_save_video_not_core"
        );

        let mut nested_custom = workflow("TextToVideo");
        nested_custom["definitions"] = serde_json::json!({
            "subgraphs": [{
                "name": "Nested",
                "nodes": [{"id": 9, "type": "CustomNode", "properties": {"cnr_id": "custom-pack"}}]
            }]
        });
        assert_eq!(
            validate_workflow(&nested_custom).unwrap_err().0,
            "workflow_custom_nodes"
        );

        let mut disconnected = workflow("TextToVideo");
        disconnected["links"] = serde_json::json!([]);
        assert_eq!(
            validate_workflow(&disconnected).unwrap_err().0,
            "workflow_save_video_disconnected"
        );

        let mut inactive_source = workflow("TextToVideo");
        inactive_source["nodes"][0]["mode"] = Value::from(4);
        assert_eq!(
            validate_workflow(&inactive_source).unwrap_err().0,
            "workflow_save_video_disconnected"
        );
    }

    #[test]
    fn exact_sibling_sidecar_wins_and_mismatch_is_only_diagnostic() {
        let root = std::env::temp_dir().join(format!(
            "ambit_video_metadata_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let video = root.join("clip.mp4");
        fs::write(&video, b"video").unwrap();
        fs::write(
            root.join("clip.workflow.json"),
            serde_json::json!({"media":"wrong.mp4","workflow":workflow("LTXVConditioning")})
                .to_string(),
        )
        .unwrap();

        let evidence = extract_video_metadata(&video, &serde_json::json!({}));
        assert_eq!(
            evidence.metadata.generation_mode,
            VideoGenerationMode::Unknown
        );
        assert_eq!(
            evidence.metadata.diagnostics[0].code,
            "sidecar_media_mismatch"
        );

        fs::write(
            root.join("clip.workflow.json"),
            serde_json::json!({"media":"clip.mp4","workflow":workflow("CannyControlNet")})
                .to_string(),
        )
        .unwrap();
        let evidence = extract_video_metadata(&video, &serde_json::json!({}));
        assert_eq!(
            evidence.metadata.generation_mode,
            VideoGenerationMode::GuidedVideo,
            "{:?}",
            evidence.metadata.diagnostics
        );
        assert_eq!(
            evidence.metadata.field_sources["generationMode"],
            MetadataEvidenceSource::TrustedSidecar
        );
        let reparsed = reparse_video_metadata(&evidence.original_metadata_json)
            .expect("preserved evidence should remain reparsable");
        assert_eq!(reparsed.generation_mode, VideoGenerationMode::GuidedVideo);
        assert_eq!(reparsed.workflow_json, evidence.metadata.workflow_json);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn explicit_refresh_reconciles_offline_sidecar_changes() {
        let root = std::env::temp_dir().join(format!(
            "ambit_video_metadata_refresh_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let video = root.join("clip.mp4");
        let sidecar = root.join("clip.workflow.json");
        fs::write(&video, b"video").unwrap();
        let empty_evidence = serde_json::json!({"sidecar": null, "embedded": null}).to_string();

        fs::write(
            &sidecar,
            serde_json::json!({"media":"clip.mp4","workflow":workflow("TextToVideo")}).to_string(),
        )
        .unwrap();
        let added = refresh_video_metadata_evidence(&video, &empty_evidence).unwrap();
        assert_eq!(
            added.metadata.generation_mode,
            VideoGenerationMode::TextToVideo
        );

        fs::write(
            &sidecar,
            serde_json::json!({"media":"clip.mp4","workflow":workflow("CannyControlNet")})
                .to_string(),
        )
        .unwrap();
        let changed =
            refresh_video_metadata_evidence(&video, &added.original_metadata_json).unwrap();
        assert_eq!(
            changed.metadata.generation_mode,
            VideoGenerationMode::GuidedVideo
        );

        fs::remove_file(&sidecar).unwrap();
        let removed =
            refresh_video_metadata_evidence(&video, &changed.original_metadata_json).unwrap();
        assert_eq!(
            removed.metadata.generation_mode,
            VideoGenerationMode::Unknown
        );
        let refreshed_evidence: Value =
            serde_json::from_str(&removed.original_metadata_json).unwrap();
        assert!(refreshed_evidence["sidecar"].is_null());

        let _ = fs::remove_dir_all(root);
    }
}
