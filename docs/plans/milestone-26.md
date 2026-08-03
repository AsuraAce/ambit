# Milestone 26: ComfyUI New Model-Family Golden Batch

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Add exact workflow-only golden coverage for LongCat, PixelDiT, ChronoEdit,
and NetaYume Lumina without changing parser behavior or public interfaces.

Acceptance requires all four workflows to preserve their pinned source bytes,
extract exact core metadata and prompts through `SamplerTraversal`, retain one
unambiguous saved-output root, and report no inactive resources. Catalog totals
must reach 28 `golden`, 9 `pattern_covered`, 3 `partial`, 35 `unassessed`, and
474 `excluded` while parser version remains 31.

## Work Package: New-Family Goldens

Primary invariant: coverage is granted only from exact pinned workflow evidence
and exact selected-path metadata.

Scope:

- Vendor workflow-only chunks for `image_longcat_text_to_image`,
  `image_pixeldit_t2i`, `image_chrono_edit_14B`, and
  `image_netayume_lumina_t2i`.
- Verify Git blob identity, UTF-8 workflow preservation, normalized graph
  counts, output diagnostics, metadata, resources, and provenance.
- Store NetaYume's independently concatenated expected prompts separately from
  the transform under test.
- Promote only the four verified entries and update manifest totals.

Non-goals:

- No parser behavior, parser version, related-variant promotion, frontend,
  database, Tauri command, binding, diagnostics DTO, or metadata-shape changes.
- If an exact expectation fails, preserve the fixture and re-plan the parser
  gap instead of weakening the golden or expanding this package.

## Acceptance Gate

Run catalog-intake, official-catalog, template-coverage, prompt,
workflow-subgraph, output-selection, full ComfyUI, and reparse tests. Run
`cargo fmt --check` and `git diff --check`. Confirm parser version 31, final
manifest totals, exact fixture identities, no `Cargo.lock` churn, and no public
interface changes.

Completed on `2026-07-22` with all four fixtures passing exact metadata,
resource, output-selection, workflow-preservation, and provenance assertions.
The catalog now reports 28 `golden`, 9 `pattern_covered`, 3 `partial`, 35
`unassessed`, and 474 `excluded`. Parser version remains 31.

Verification passed:

- `cargo test metadata::comfyui::tests::catalog_intake`
- `cargo test metadata::comfyui::tests::official_catalog`
- `cargo test metadata::comfyui::tests::template_coverage`
- `cargo test metadata::comfyui::tests::prompts`
- `cargo test metadata::comfyui::tests::workflow_subgraphs`
- `cargo test metadata::comfyui::tests::output_selection`
- `cargo test metadata::comfyui`
- `cargo test metadata::reparse`
- `cargo fmt --check`
- `git diff --check`
