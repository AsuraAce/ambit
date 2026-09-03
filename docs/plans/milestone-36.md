# Milestone 36: ComfyUI Anima LLLite Model Patches

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Represent model patches selected through `AnimaLLLiteApply` as ControlNet
resources while continuing traversal to the primary Anima model. Promote the
three pinned Anima LLLite workflows to exact workflow-only goldens.

## Acceptance Criteria

- Active Anima LLLite patches are normalized, deduplicated, and sourced from
  `SamplerTraversal` without replacing the primary model.
- Linked patch names are authoritative; unresolved, disconnected, muted, and
  bypassed patches are omitted.
- Any-control, inpainting, and depth workflows assert exact models, sampler
  fields, prompts, resources, output diagnostics, and provenance.
- Coverage totals are 43 golden, 4 pattern-covered, 1 partial, 36 unassessed,
  and 494 excluded.
- Parser version is 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not classify arbitrary `ModelPatchLoader` nodes.
- Do not add a generic model-patch metadata field or change public interfaces.

## Verification

Completed on `2026-07-29`:

- focused Anima model-patch and official-catalog goldens passed;
- official-catalog, template-coverage, intake, workflow-subgraph, full ComfyUI,
  and metadata-reparse suites passed;
- `cargo fmt --check` and `git diff --check` passed;
- incidental `Cargo.lock` app-version churn was removed.
