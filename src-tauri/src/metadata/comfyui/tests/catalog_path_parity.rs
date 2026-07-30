use super::{official_catalog::catalog_fixture_cases, real_world::real_world_fixture_cases};
use crate::metadata::comfyui::{
    build_comfyui_diagnostics_report, extract_comfyui_metadata_with_diagnostics,
    merge_comfyui_metadata, metadata_field_label, parse_layer_label, ComfyMetadataPreview,
};
use crate::metadata::{extract_a1111_metadata, reparse::reparse_from_json, ImageMetadata};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

const OFFICIAL_CATALOG_FIXTURE_COUNT: usize = 89;
const REAL_WORLD_FIXTURE_COUNT: usize = 21;

#[test]
fn official_catalog_entry_points_remain_in_parity() {
    let mut count = 0;
    for (name, chunks_json) in catalog_fixture_cases() {
        assert_entry_point_parity(name, chunks_json);
        count += 1;
    }

    assert_eq!(count, OFFICIAL_CATALOG_FIXTURE_COUNT);
}

#[test]
fn real_world_entry_points_remain_in_parity() {
    let mut count = 0;
    for (name, chunks_json) in real_world_fixture_cases() {
        assert_entry_point_parity(name, chunks_json);
        count += 1;
    }

    assert_eq!(count, REAL_WORLD_FIXTURE_COUNT);
}

fn assert_entry_point_parity(name: &str, chunks_json: &str) {
    let chunks = load_chunks(chunks_json);
    let (direct_metadata, direct_diagnostics) = extract_comfyui_metadata_with_diagnostics(&chunks);

    assert_eq!(
        scanner_style_metadata(&chunks),
        direct_metadata,
        "{name}: scanner-style metadata should match direct extraction"
    );

    let reparsed = reparse_from_json(chunks_json, "ComfyUI")
        .unwrap_or_else(|| panic!("{name}: ComfyUI reparse should succeed"));
    assert_eq!(
        reparsed.metadata, direct_metadata,
        "{name}: reparsed metadata should match direct extraction"
    );
    let serialized_reparse: Value = serde_json::from_str(&reparsed.metadata_json)
        .unwrap_or_else(|error| panic!("{name}: reparsed metadata JSON should decode: {error}"));
    assert_eq!(
        serialized_reparse,
        serde_json::to_value(&direct_metadata)
            .unwrap_or_else(|error| panic!("{name}: direct metadata should serialize: {error}")),
        "{name}: reparsed metadata JSON should preserve every field"
    );

    let report = build_comfyui_diagnostics_report(&chunks);
    assert_eq!(
        report.metadata,
        ComfyMetadataPreview::from_metadata(&direct_metadata),
        "{name}: diagnostics preview should match direct extraction"
    );
    assert_eq!(
        report.graph_node_count, direct_diagnostics.graph_node_count,
        "{name}: diagnostics graph node count"
    );
    assert_eq!(
        report.attempted_layers,
        direct_diagnostics
            .attempted_layers
            .iter()
            .map(|layer| parse_layer_label(*layer).to_string())
            .collect::<Vec<_>>(),
        "{name}: diagnostics attempted layers"
    );
    assert_eq!(
        report.field_sources,
        direct_diagnostics
            .field_sources
            .iter()
            .map(|(field, layer)| {
                (
                    metadata_field_label(*field).to_string(),
                    parse_layer_label(*layer).to_string(),
                )
            })
            .collect::<BTreeMap<_, _>>(),
        "{name}: diagnostics field provenance"
    );

    let mut expected_chunk_keys = chunks.keys().cloned().collect::<Vec<_>>();
    expected_chunk_keys.sort();
    assert_eq!(report.chunk_keys, expected_chunk_keys, "{name}: chunk keys");
    assert_eq!(
        report.has_prompt_chunk,
        chunks.contains_key("prompt"),
        "{name}: prompt chunk presence"
    );
    assert_eq!(
        report.has_workflow_chunk,
        chunks.contains_key("workflow"),
        "{name}: workflow chunk presence"
    );
}

fn scanner_style_metadata(chunks: &HashMap<String, String>) -> ImageMetadata {
    let mut metadata = chunks
        .get("parameters")
        .or_else(|| chunks.get("Parameters"))
        .or_else(|| chunks.get("PARAMETERS"))
        .map(|parameters| extract_a1111_metadata(parameters, None))
        .unwrap_or_default();

    if chunks.contains_key("prompt") || chunks.contains_key("workflow") {
        merge_comfyui_metadata(&mut metadata, chunks);
        metadata.tool = "ComfyUI".to_string();
    }

    metadata
}

fn load_chunks(chunks_json: &str) -> HashMap<String, String> {
    let raw: HashMap<String, Value> =
        serde_json::from_str(chunks_json).expect("fixture chunks should be valid JSON");

    raw.into_iter()
        .map(|(key, value)| {
            let chunk = value.as_str().map(ToOwned::to_owned).unwrap_or_else(|| {
                serde_json::to_string(&value).expect("fixture chunk value should serialize")
            });
            (key, chunk)
        })
        .collect()
}
