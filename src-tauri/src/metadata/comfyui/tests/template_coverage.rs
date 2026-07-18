use serde::Deserialize;
use std::collections::{BTreeSet, HashSet};

const MANIFEST_JSON: &str = include_str!("fixtures/official_catalog/coverage_manifest.json");
const CATALOG_COMMIT: &str = "c3bf8342318a3c2bfcbf6d0ac020155745417f29";
const GETTING_STARTED_TARGET_IDS: [&str; 10] = [
    "01_get_started_text_to_image",
    "02_qwen_Image_edit_subgraphed",
    "default",
    "gsc_creator_2_1",
    "gsc_creator_2_2",
    "gsc_creator_2_3",
    "gsc_starter_1",
    "gsl_creator_2",
    "gsl_starter_1_1",
    "gsl_starter_1_3",
];

#[derive(Deserialize)]
struct CoverageManifest {
    schema_version: u32,
    source: CatalogSource,
    counts: CatalogCounts,
    coverage_states: Vec<String>,
    legacy_examples: LegacyCoverage,
    entries: Vec<CatalogEntry>,
}

#[derive(Deserialize)]
struct CatalogSource {
    repository: String,
    commit: String,
    index_path: String,
    captured_on: String,
}

#[derive(Deserialize)]
struct CatalogCounts {
    catalog_entries: usize,
    image_category_entries: usize,
    image_core_entries: usize,
    getting_started_image_entries: usize,
    target_entries: usize,
    excluded_entries: usize,
    legacy_golden_families: usize,
}

#[derive(Deserialize)]
struct LegacyCoverage {
    repository: String,
    commit: String,
    golden_families: Vec<String>,
}

#[derive(Deserialize)]
struct CatalogEntry {
    id: String,
    category: String,
    media_type: Option<String>,
    models: Vec<String>,
    tags: Vec<String>,
    open_source: Option<bool>,
    custom_nodes: Vec<String>,
    scope: String,
    coverage: String,
    exclusion_reason: Option<String>,
    evidence: Vec<String>,
}

fn load_manifest() -> CoverageManifest {
    serde_json::from_str(MANIFEST_JSON).expect("coverage manifest should be valid JSON")
}

#[test]
fn manifest_covers_the_pinned_catalog_with_valid_classifications() {
    let manifest = load_manifest();
    let allowed_states = BTreeSet::from([
        "excluded",
        "golden",
        "partial",
        "pattern_covered",
        "unassessed",
        "unsupported",
    ]);
    let actual_states = manifest
        .coverage_states
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();

    assert_eq!(manifest.schema_version, 1);
    assert_eq!(
        manifest.source.repository,
        "https://github.com/Comfy-Org/workflow_templates"
    );
    assert_eq!(manifest.source.commit, CATALOG_COMMIT);
    assert_eq!(manifest.source.index_path, "templates/index.json");
    assert_eq!(manifest.source.captured_on, "2026-07-11");
    assert_eq!(actual_states, allowed_states);
    assert_eq!(manifest.entries.len(), 549);

    let mut ids = HashSet::new();
    let mut previous_id: Option<&str> = None;
    let getting_started_targets = GETTING_STARTED_TARGET_IDS
        .into_iter()
        .collect::<HashSet<_>>();
    for entry in &manifest.entries {
        assert!(ids.insert(entry.id.as_str()), "duplicate id: {}", entry.id);
        if let Some(previous) = previous_id {
            assert!(previous < entry.id.as_str(), "manifest ids must be sorted");
        }
        previous_id = Some(&entry.id);

        assert!(allowed_states.contains(entry.coverage.as_str()));
        assert!(
            entry.media_type.is_some(),
            "{} should retain media type",
            entry.id
        );
        let _catalog_fields_are_present = (
            &entry.models,
            &entry.tags,
            entry.open_source,
            &entry.custom_nodes,
        );

        let is_target = entry.scope == "target_core_image";
        match entry.category.as_str() {
            "Image" => assert_eq!(
                is_target,
                entry.open_source == Some(true) && entry.custom_nodes.is_empty(),
                "{} Image scope must follow the open-source core-node rule",
                entry.id
            ),
            "Getting Started" => assert_eq!(
                is_target,
                getting_started_targets.contains(entry.id.as_str()),
                "{} Getting Started scope must match the pinned target set",
                entry.id
            ),
            _ => assert!(
                !is_target,
                "{} category is outside the active target",
                entry.id
            ),
        }

        match entry.scope.as_str() {
            "target_core_image" => {
                assert_eq!(
                    entry.open_source,
                    Some(true),
                    "{} must be open source",
                    entry.id
                );
                assert!(
                    entry.custom_nodes.is_empty(),
                    "{} must use only core nodes",
                    entry.id
                );
                assert_ne!(entry.coverage, "excluded", "{} is targeted", entry.id);
                assert!(entry.exclusion_reason.is_none(), "{} is targeted", entry.id);
            }
            "excluded" => {
                assert_eq!(entry.coverage, "excluded", "{} is excluded", entry.id);
                assert!(
                    entry
                        .exclusion_reason
                        .as_deref()
                        .is_some_and(|reason| !reason.is_empty()),
                    "{} needs an exclusion reason",
                    entry.id
                );
            }
            other => panic!("unknown scope {other} for {}", entry.id),
        }

        if matches!(
            entry.coverage.as_str(),
            "golden" | "pattern_covered" | "partial" | "unsupported"
        ) {
            assert!(!entry.evidence.is_empty(), "{} needs evidence", entry.id);
        }
    }
}

#[test]
fn manifest_counts_match_the_declared_catalog_scope() {
    let manifest = load_manifest();
    let count = |category: &str, scope: &str| {
        manifest
            .entries
            .iter()
            .filter(|entry| entry.category == category && entry.scope == scope)
            .count()
    };
    let count_coverage = |coverage: &str| {
        manifest
            .entries
            .iter()
            .filter(|entry| entry.coverage == coverage)
            .count()
    };

    assert_eq!(manifest.counts.catalog_entries, 549);
    assert_eq!(manifest.counts.image_category_entries, 140);
    assert_eq!(manifest.counts.image_core_entries, 65);
    assert_eq!(manifest.counts.getting_started_image_entries, 10);
    assert_eq!(manifest.counts.target_entries, 75);
    assert_eq!(manifest.counts.excluded_entries, 474);
    assert_eq!(count("Image", "target_core_image"), 65);
    assert_eq!(count("Getting Started", "target_core_image"), 10);
    assert_eq!(count_coverage("golden"), 22);
    assert_eq!(count_coverage("pattern_covered"), 9);
    assert_eq!(count_coverage("partial"), 4);
    assert_eq!(count_coverage("unassessed"), 40);
    assert_eq!(count_coverage("excluded"), 474);
}

#[test]
fn manifest_links_covered_entries_to_test_evidence() {
    let manifest = load_manifest();
    let expected = [
        ("01_get_started_text_to_image", "golden"),
        ("02_qwen_Image_edit_subgraphed", "golden"),
        ("Image_capybara_v0_1_text_to_image", "golden"),
        ("default", "pattern_covered"),
        ("flux_fill_inpaint_example", "golden"),
        ("flux_kontext_dev_basic", "golden"),
        ("gsc_creator_2_1", "pattern_covered"),
        ("gsc_creator_2_2", "golden"),
        ("gsc_creator_2_3", "partial"),
        ("gsc_starter_1", "pattern_covered"),
        ("gsl_creator_2", "pattern_covered"),
        ("gsl_starter_1_1", "pattern_covered"),
        ("gsl_starter_1_3", "pattern_covered"),
        ("hidream_i1_full", "golden"),
        ("image_ernie_image", "partial"),
        ("image_ernie_image_turbo", "partial"),
        ("image_firered_image_edit1_1", "golden"),
        ("image_anima_base_v1", "golden"),
        ("image_anima_preview", "pattern_covered"),
        ("image_flux2_klein_image_edit_4b_distilled", "golden"),
        ("image_flux2_text_to_image", "golden"),
        ("image_chroma1_radiance_text_to_image", "golden"),
        ("image_kandinsky5_t2i", "golden"),
        ("image_krea2_turbo_t2i", "pattern_covered"),
        ("image_lens_t2i", "golden"),
        ("image_lens_turbo_t2i", "pattern_covered"),
        ("image_newbieimage_exp0_1-t2i", "golden"),
        ("image_omnigen2_t2i", "golden"),
        ("image_boogu_image_0_1_edit", "golden"),
        ("image_qwen_Image_2512_controlnet", "golden"),
        ("image_qwen_image_edit_2509", "golden"),
        ("image_qwen_image_union_control_lora", "golden"),
        ("video_bernini_r_image_editing", "partial"),
    ];

    for (id, coverage) in expected {
        let entry = manifest
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .unwrap_or_else(|| panic!("missing catalog entry {id}"));
        assert_eq!(entry.coverage, coverage);
        assert!(entry
            .evidence
            .iter()
            .any(|item| item.starts_with("fixture:")));
        assert!(entry.evidence.iter().any(|item| item.starts_with("test:")));
    }

    assert_eq!(manifest.counts.legacy_golden_families, 14);
    assert_eq!(manifest.legacy_examples.golden_families.len(), 14);
    assert_eq!(
        manifest.legacy_examples.repository,
        "https://github.com/comfyanonymous/ComfyUI_examples"
    );
    assert_eq!(
        manifest.legacy_examples.commit,
        "f9431bb000ce792094ff345446e22cac1ea6cef3"
    );
    assert_eq!(
        manifest
            .legacy_examples
            .golden_families
            .iter()
            .collect::<HashSet<_>>()
            .len(),
        14
    );
}
