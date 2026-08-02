# Milestone 27: ComfyUI Image-Edit Golden Batch

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Add exact workflow-only golden coverage for LongCat, Capybara, OmniGen2, and
HiDream image-edit workflows, including the narrow output-slot-aware
conditioning policy needed by HiDream E1.1.

Acceptance requires all four pinned workflows to preserve their source bytes,
extract exact selected-path metadata through `SamplerTraversal`, retain one
unambiguous saved-output root, and report no resources. Catalog totals must
reach 32 `golden`, 9 `pattern_covered`, 3 `partial`, 31 `unassessed`, and 474
`excluded` with parser version 32.

## Work Package: Image-Edit Goldens

Primary invariant: image inputs and auxiliary vision models never become
primary generation metadata; coverage is granted only from exact connected
workflow evidence.

Scope:

- Vendor workflow-only chunks for `image_longcat_image_edit`,
  `Image_capybara_v0_1_image_edit`, `image_omnigen2_image_edit`, and
  `hidream_e1_1`.
- Verify Git blob identity, workflow preservation, normalized graph counts,
  output diagnostics, metadata, resources, and field provenance.
- Treat output slot 1 of connected core `InstructPixToPixConditioning` as the
  authoritative negative branch when it feeds `DualCFGGuider.cond2`.
- Promote only the four verified entries and update manifest totals.

Non-goals:

- No general `DualCFGGuider.cond2` reinterpretation, related-variant promotion,
  frontend, database, Tauri command, binding, diagnostics DTO, or
  metadata-shape changes.

## Acceptance Gate

Run catalog-intake, official-catalog, template-coverage, prompt, multi-stage,
workflow-subgraph, output-selection, full ComfyUI, and reparse tests. Run
`cargo fmt --check` and `git diff --check`. Confirm parser version 32, final
manifest totals, exact fixture identities, no `Cargo.lock` churn, and no public
interface changes.

## Compatibility Decision

Ordinary `DualCFGGuider` behavior remains unchanged: `cond1` is the primary
positive prompt, generic `cond2` is unrepresented, and `negative` supplies the
negative prompt. The only exception is a connected
`InstructPixToPixConditioning` slot-1 source, which is explicit core-node
evidence for the negative edit-conditioning branch. Once selected, unresolved
input fails closed rather than reopening the guider's duplicated positive
branch.
