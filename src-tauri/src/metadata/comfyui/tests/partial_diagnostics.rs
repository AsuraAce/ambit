use crate::metadata::comfyui::{build_comfyui_diagnostics_report, ComfyParserDiagnosticsReport};
use std::collections::HashMap;

struct GeneratedPromptFixture {
    name: &'static str,
    chunks_json: &'static str,
    node_id: &'static str,
    model: &'static str,
    seed: i64,
    steps: u32,
    cfg: f32,
    sampler: &'static str,
}

const GENERATED_PROMPT_FIXTURES: &[GeneratedPromptFixture] = &[
    GeneratedPromptFixture {
        name: "image_ernie_image",
        chunks_json: include_str!("fixtures/official_catalog/image_ernie_image.chunks.json"),
        node_id: "88:74",
        model: "ernie_image",
        seed: 182_596_410_725_960,
        steps: 20,
        cfg: 4.0,
        sampler: "euler (simple)",
    },
    GeneratedPromptFixture {
        name: "image_ernie_image_turbo",
        chunks_json: include_str!("fixtures/official_catalog/image_ernie_image_turbo.chunks.json"),
        node_id: "88:95",
        model: "ernie_image_turbo",
        seed: 423_299_999_918_804,
        steps: 8,
        cfg: 1.0,
        sampler: "euler (simple)",
    },
    GeneratedPromptFixture {
        name: "image_krea2_turbo_t2i",
        chunks_json: include_str!("fixtures/official_catalog/image_krea2_turbo_t2i.chunks.json"),
        node_id: "30:16",
        model: "krea2_turbo_fp8_scaled",
        seed: 735_915_477_938_686,
        steps: 8,
        cfg: 1.0,
        sampler: "euler (simple)",
    },
    GeneratedPromptFixture {
        name: "image_krea2_turbo_t2i_int8",
        chunks_json: include_str!(
            "fixtures/official_catalog/image_krea2_turbo_t2i_int8.chunks.json"
        ),
        node_id: "30:16",
        model: "krea2_turbo_int8_convrot",
        seed: 45_862_206_397_178,
        steps: 8,
        cfg: 1.0,
        sampler: "euler (simple)",
    },
];

fn load_chunks(name: &str, chunks_json: &str) -> HashMap<String, String> {
    serde_json::from_str(chunks_json)
        .unwrap_or_else(|error| panic!("{name} chunks should be valid JSON: {error}"))
}

fn assert_workflow_preview_common(name: &str, report: &ComfyParserDiagnosticsReport) {
    assert_eq!(report.metadata.tool, "ComfyUI", "{name} tool");
    assert!(report.metadata.ip_adapters.is_empty(), "{name} IP-Adapters");
    assert!(report.metadata.embeddings.is_empty(), "{name} embeddings");
    assert!(
        report.metadata.hypernetworks.is_empty(),
        "{name} hypernetworks"
    );
    assert_eq!(
        report.metadata.generation_type, "unknown",
        "{name} generation type"
    );
    assert!(report.metadata.has_workflow_hint, "{name} workflow hint");
    assert!(report.metadata.has_workflow_json, "{name} workflow JSON");
}

fn assert_resources(
    name: &str,
    report: &ComfyParserDiagnosticsReport,
    loras: &[&str],
    control_nets: &[&str],
) {
    assert_eq!(report.metadata.loras, loras, "{name} LoRAs");
    assert_eq!(
        report.metadata.control_nets, control_nets,
        "{name} ControlNets"
    );
}

fn assert_field_sources(
    name: &str,
    report: &ComfyParserDiagnosticsReport,
    fields: &[&str],
    expected: &str,
) {
    for field in fields {
        assert_eq!(
            report.field_sources.get(*field).map(String::as_str),
            Some(expected),
            "{name} {field} provenance"
        );
    }
}

#[test]
fn generated_prompt_partials_report_the_exact_selected_path_blocker() {
    for fixture in GENERATED_PROMPT_FIXTURES {
        let report =
            build_comfyui_diagnostics_report(&load_chunks(fixture.name, fixture.chunks_json));

        assert_eq!(
            report.selected_output_candidate_count, 1,
            "{} outputs",
            fixture.name
        );
        assert_eq!(
            report.unique_output_root_sampler_count, 1,
            "{} roots",
            fixture.name
        );
        assert!(!report.output_ambiguous, "{} ambiguity", fixture.name);
        assert!(
            !report.traversal_issues_truncated,
            "{} truncation",
            fixture.name
        );
        assert_eq!(
            report.traversal_issues.len(),
            1,
            "{} blockers",
            fixture.name
        );

        let issue = &report.traversal_issues[0];
        assert_eq!(
            issue.field, "positive_prompt",
            "{} blocker field",
            fixture.name
        );
        assert_eq!(
            issue.node_id, fixture.node_id,
            "{} blocker node",
            fixture.name
        );
        assert_eq!(
            issue.node_type, "TextGenerate",
            "{} blocker type",
            fixture.name
        );
        assert_eq!(
            issue.input_name.as_deref(),
            Some("text"),
            "{} blocker input",
            fixture.name
        );
        assert_eq!(
            issue.reason, "generated_value_unavailable",
            "{} blocker reason",
            fixture.name
        );
        assert!(
            !report
                .traversal_issues
                .iter()
                .any(|issue| issue.field == "negative_prompt"),
            "{} negative prompt",
            fixture.name
        );

        assert_eq!(
            report.metadata.model, fixture.model,
            "{} model",
            fixture.name
        );
        assert_eq!(
            report.metadata.seed,
            Some(fixture.seed),
            "{} seed",
            fixture.name
        );
        assert_eq!(
            report.metadata.steps, fixture.steps,
            "{} steps",
            fixture.name
        );
        assert_eq!(report.metadata.cfg, fixture.cfg, "{} cfg", fixture.name);
        assert_eq!(
            report.metadata.sampler, fixture.sampler,
            "{} sampler",
            fixture.name
        );
        assert!(
            report.metadata.positive_prompt.is_empty(),
            "{} positive prompt",
            fixture.name
        );
        assert!(
            report.metadata.negative_prompt.is_empty(),
            "{} negative prompt",
            fixture.name
        );
        assert_workflow_preview_common(fixture.name, &report);
        assert_resources(fixture.name, &report, &[], &[]);
        assert_field_sources(
            fixture.name,
            &report,
            &["model", "seed", "steps", "cfg", "sampler"],
            "sampler_traversal",
        );
        assert!(!report.field_sources.contains_key("positive_prompt"));
        assert!(!report.field_sources.contains_key("negative_prompt"));
    }
}

#[test]
fn hidream_o1_selected_literal_prompts_have_no_generated_blocker() {
    let cases = [
        (
            "image_hidream_o1",
            include_str!("fixtures/official_catalog/image_hidream_o1.chunks.json"),
            "Graceful female skincare shot, light nude makeup, holding essence bottle, warm ivory backdrop, soft diffused light",
        ),
        (
            "image_hidream_o1_dev",
            include_str!("fixtures/official_catalog/image_hidream_o1_dev.chunks.json"),
            "Transform the background into a rainy neon city street at night, with wet asphalt reflections, blurred neon signs",
        ),
    ];

    for (name, chunks_json, positive_prompt) in cases {
        let report = build_comfyui_diagnostics_report(&load_chunks(name, chunks_json));

        assert_eq!(report.selected_output_candidate_count, 1, "{name} outputs");
        assert_eq!(report.unique_output_root_sampler_count, 1, "{name} roots");
        assert!(!report.output_ambiguous, "{name} ambiguity");
        assert!(report.traversal_issues.is_empty(), "{name} blockers");
        assert!(!report.traversal_issues_truncated, "{name} truncation");
        assert_eq!(
            report.metadata.positive_prompt, positive_prompt,
            "{name} positive prompt"
        );
        assert!(
            report.metadata.negative_prompt.is_empty(),
            "{name} negative prompt"
        );
        assert_eq!(
            report
                .field_sources
                .get("positive_prompt")
                .map(String::as_str),
            Some("sampler_traversal"),
            "{name} prompt provenance"
        );
        assert_workflow_preview_common(name, &report);
        assert_resources(name, &report, &[], &[]);
        assert_field_sources(
            name,
            &report,
            &["model", "seed", "steps", "cfg", "sampler"],
            "sampler_traversal",
        );
    }
}

#[test]
fn gsc_upscale_uses_its_literal_selected_prompt_without_blockers() {
    let chunks_json = include_str!("fixtures/official_catalog/gsc_creator_2_3.chunks.json");
    let report = build_comfyui_diagnostics_report(&load_chunks("gsc_creator_2_3", chunks_json));

    assert_eq!(report.selected_output_candidate_count, 1);
    assert_eq!(report.unique_output_root_sampler_count, 1);
    assert!(!report.output_ambiguous);
    assert!(report.traversal_issues.is_empty());
    assert!(!report.traversal_issues_truncated);
    assert_eq!(report.metadata.model, "z_image_turbo_bf16");
    assert_eq!(report.metadata.seed, Some(344_777_149_081_245));
    assert_eq!(report.metadata.steps, 5);
    assert_eq!(report.metadata.cfg, 1.0);
    assert_eq!(report.metadata.sampler, "dpmpp_2m_sde (beta)");
    assert_eq!(report.metadata.positive_prompt, "masterpiece, 8k");
    assert!(report.metadata.negative_prompt.is_empty());
    assert_workflow_preview_common("gsc_creator_2_3", &report);
    assert_resources("gsc_creator_2_3", &report, &[], &[]);
    assert_field_sources(
        "gsc_creator_2_3",
        &report,
        &[
            "model",
            "seed",
            "steps",
            "cfg",
            "sampler",
            "positive_prompt",
        ],
        "sampler_traversal",
    );
}

#[test]
fn multiple_character_angles_reports_ambiguity_without_speculative_blockers() {
    let chunks_json = include_str!(
        "fixtures/official_catalog/templates-1_click_multiple_character_angles-v1.0.chunks.json"
    );
    let report = build_comfyui_diagnostics_report(&load_chunks(
        "templates-1_click_multiple_character_angles-v1.0",
        chunks_json,
    ));

    assert_eq!(report.selected_output_candidate_count, 8);
    assert_eq!(report.unique_output_root_sampler_count, 8);
    assert!(report.output_ambiguous);
    assert!(report.traversal_issues.is_empty());
    assert!(!report.traversal_issues_truncated);
    assert_eq!(report.metadata.model, "qwen_image_edit_2511_bf16");
    assert_eq!(report.metadata.seed, Some(345_666_571_704_709));
    assert_eq!(report.metadata.steps, 4);
    assert_eq!(report.metadata.cfg, 1.0);
    assert_eq!(report.metadata.sampler, "euler (simple)");
    assert_eq!(
        report.metadata.positive_prompt,
        " Turn the camera to a close-up."
    );
    assert!(report.metadata.negative_prompt.is_empty());
    assert_workflow_preview_common("templates-1_click_multiple_character_angles-v1.0", &report);
    assert_resources(
        "templates-1_click_multiple_character_angles-v1.0",
        &report,
        &[
            "qwen_image_edit_2511_lightning_4steps_v1.0_bf16",
            "qwen_image_edit_2511_multiple_angles_lora",
        ],
        &[],
    );
    assert_field_sources(
        "templates-1_click_multiple_character_angles-v1.0",
        &report,
        &[
            "model",
            "seed",
            "steps",
            "cfg",
            "sampler",
            "positive_prompt",
        ],
        "sampler_fallback",
    );
    assert_field_sources(
        "templates-1_click_multiple_character_angles-v1.0",
        &report,
        &["loras"],
        "sampler_fallback",
    );
}
