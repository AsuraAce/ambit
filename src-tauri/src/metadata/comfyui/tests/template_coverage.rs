use serde::Deserialize;
use std::collections::{BTreeSet, HashSet};

const MANIFEST_JSON: &str = include_str!("fixtures/official_catalog/coverage_manifest.json");
const CATALOG_RELEASE: &str = "v0.11.15";
const CATALOG_COMMIT: &str = "703fb0b082fdb76331d02232ff67e878e2a6ca6e";
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
    release_tag: String,
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
    official_use_case_image_entries: usize,
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
    source_blob: String,
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

    assert_eq!(manifest.schema_version, 3);
    assert_eq!(
        manifest.source.repository,
        "https://github.com/Comfy-Org/workflow_templates"
    );
    assert_eq!(manifest.source.release_tag, CATALOG_RELEASE);
    assert_eq!(manifest.source.commit, CATALOG_COMMIT);
    assert_eq!(manifest.source.index_path, "templates/index.json");
    assert_eq!(manifest.source.captured_on, "2026-07-28");
    assert_eq!(actual_states, allowed_states);
    assert_eq!(manifest.entries.len(), 578);

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
        assert_eq!(entry.source_blob.len(), 40, "{} source blob", entry.id);
        assert!(
            entry
                .source_blob
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit()),
            "{} source blob should be hexadecimal",
            entry.id
        );

        let is_core_target = entry.scope == "target_core_image";
        let is_use_case_target = entry.scope == "target_official_use_case_image";
        match entry.category.as_str() {
            "Image" => assert_eq!(
                is_core_target,
                entry.open_source == Some(true) && entry.custom_nodes.is_empty(),
                "{} Image scope must follow the open-source core-node rule",
                entry.id
            ),
            "Getting Started" => assert_eq!(
                is_core_target,
                getting_started_targets.contains(entry.id.as_str()),
                "{} Getting Started scope must match the pinned target set",
                entry.id
            ),
            "Use Cases" => {
                let video_tags = ["Video", "Image to Video", "Reference to Video", "FLF2V"];
                let qualifies = entry.media_type.as_deref() == Some("image")
                    && entry.open_source == Some(true)
                    && entry.custom_nodes.is_empty()
                    && !entry
                        .tags
                        .iter()
                        .any(|tag| video_tags.contains(&tag.as_str()));
                assert_eq!(
                    is_use_case_target, qualifies,
                    "{} Use Cases scope must follow the official image-use-case rule",
                    entry.id
                );
                assert!(!is_core_target, "{} cannot use the core scope", entry.id);
            }
            _ => assert!(
                !is_core_target && !is_use_case_target,
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
            "target_official_use_case_image" => {
                assert_eq!(
                    entry.category, "Use Cases",
                    "{} must be a use case",
                    entry.id
                );
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
        if entry.coverage == "unassessed" {
            assert!(
                entry
                    .evidence
                    .iter()
                    .any(|item| item.starts_with("reason:")),
                "{} needs an assessment reason",
                entry.id
            );
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

    assert_eq!(manifest.counts.catalog_entries, 578);
    assert_eq!(manifest.counts.image_category_entries, 150);
    assert_eq!(manifest.counts.image_core_entries, 74);
    assert_eq!(manifest.counts.getting_started_image_entries, 10);
    assert_eq!(manifest.counts.official_use_case_image_entries, 9);
    assert_eq!(manifest.counts.target_entries, 93);
    assert_eq!(manifest.counts.excluded_entries, 485);
    assert_eq!(count("Image", "target_core_image"), 74);
    assert_eq!(count("Getting Started", "target_core_image"), 10);
    assert_eq!(count("Use Cases", "target_official_use_case_image"), 9);
    assert_eq!(count_coverage("golden"), 80);
    assert_eq!(count_coverage("pattern_covered"), 5);
    assert_eq!(count_coverage("partial"), 8);
    assert_eq!(count_coverage("unassessed"), 0);
    assert_eq!(count_coverage("excluded"), 485);
    assert_eq!(
        manifest
            .entries
            .iter()
            .filter(|entry| entry.category == "Getting Started"
                && entry.scope == "target_core_image"
                && entry.coverage == "unassessed")
            .count(),
        0,
        "all active Getting Started workflows should be assessed"
    );
    assert_eq!(
        manifest
            .entries
            .iter()
            .filter(|entry| entry.scope == "target_official_use_case_image"
                && entry.coverage == "unassessed")
            .count(),
        0,
        "all targeted official image-use-case workflows should be assessed"
    );
}

#[test]
fn manifest_links_covered_entries_to_test_evidence() {
    let manifest = load_manifest();
    let expected = [
        ("01_get_started_text_to_image", "golden"),
        ("02_qwen_Image_edit_subgraphed", "golden"),
        ("Image_capybara_v0_1_image_edit", "golden"),
        ("Image_capybara_v0_1_text_to_image", "golden"),
        ("default", "pattern_covered"),
        ("flux_depth_lora_example", "golden"),
        ("flux_dev_checkpoint_example", "golden"),
        ("flux_dev_full_text_to_image", "golden"),
        ("flux_fill_inpaint_example", "golden"),
        ("flux_kontext_dev_basic", "golden"),
        ("flux_schnell_full_text_to_image", "golden"),
        ("flux1_dev_uso_reference_image_gen", "golden"),
        ("flux1_krea_dev", "golden"),
        ("gsc_creator_2_1", "pattern_covered"),
        ("gsc_creator_2_2", "golden"),
        ("gsc_creator_2_3", "partial"),
        ("gsc_starter_1", "pattern_covered"),
        ("gsl_creator_2", "golden"),
        ("gsl_starter_1_1", "golden"),
        ("gsl_starter_1_3", "pattern_covered"),
        ("hidream_e1_1", "golden"),
        ("hidream_e1_full", "golden"),
        ("hidream_i1_dev", "golden"),
        ("hidream_i1_fast", "golden"),
        ("hidream_i1_full", "golden"),
        ("image_anima_base_v1", "golden"),
        ("image_anima_preview", "golden"),
        ("image_chroma_text_to_image", "golden"),
        ("image_chroma1_radiance_text_to_image", "golden"),
        ("image_chrono_edit_14B", "golden"),
        ("image_boogu_image_0_1_edit", "golden"),
        ("image_boogu_image_0_1_edit_int8", "golden"),
        ("image_boogu_image_0_1_turbo_t2i", "golden"),
        ("image_flux.1_fill_dev_OneReward", "golden"),
        ("image_flux2", "golden"),
        ("image_flux2_fp8", "golden"),
        ("image_flux2_klein_9b_kv_image_edit", "golden"),
        ("image_flux2_klein_image_edit_4b_base", "golden"),
        ("image_flux2_klein_image_edit_4b_distilled", "golden"),
        ("image_flux2_klein_image_edit_9b_base", "golden"),
        ("image_flux2_klein_image_edit_9b_distilled", "golden"),
        ("image_flux2_klein_text_to_image", "golden"),
        ("image_flux2_text_to_image", "golden"),
        ("image_flux2_text_to_image_9b", "golden"),
        ("image_kandinsky5_t2i", "golden"),
        ("image_ideogram4_t2i_int8", "golden"),
        ("image_joyai_image_edit", "golden"),
        ("image_krea2_turbo_int8_image_style_reference", "golden"),
        ("image_lens_t2i", "golden"),
        ("image_lens_turbo_t2i", "pattern_covered"),
        ("image_netayume_lumina_t2i", "golden"),
        ("image_newbieimage_exp0_1-t2i", "golden"),
        ("image_omnigen2_image_edit", "golden"),
        ("image_omnigen2_t2i", "golden"),
        ("image_qwen_Image_2512", "golden"),
        ("image_qwen_Image_2512_controlnet", "golden"),
        ("image_qwen_image", "golden"),
        ("image_qwen_image_2512_with_2steps_lora", "golden"),
        ("image_qwen_image_edit", "golden"),
        ("image_qwen_image_edit_2509", "golden"),
        ("image_qwen_image_edit_2511", "golden"),
        ("image_qwen_image_edit_2511_int8", "golden"),
        ("image_qwen_image_union_control_lora", "golden"),
        ("image-qwen_image_edit_2511_lora_inflation", "golden"),
        ("image_z_image_turbo", "golden"),
        ("image_z_image_int8", "golden"),
        ("image_z_image_turbo_fun_union_controlnet", "golden"),
        ("template_sugar_coated_gummy_style_qwen", "golden"),
        (
            "templates-1_click_multiple_character_angles-v1.0",
            "partial",
        ),
        ("templates-image_to_real", "golden"),
        ("templates-portrait_light_migration", "golden"),
        ("templates_rob_image_to_real.app", "golden"),
        ("templates_rob_portrait_light_migration.app", "golden"),
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
