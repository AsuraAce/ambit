# Milestone 42: ComfyUI v0.11.15 Getting Started Revalidation

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Promote the final two unassessed Getting Started workflows to exact goldens and
close that category's active-target assessment without changing parser output.

## Acceptance Criteria

- Both workflow strings match their pinned upstream Git blob identities.
- `gsl_creator_2` reports its selected Z-Image inpaint path, literal prompt,
  model-patch ControlNet, and sampler settings.
- `gsl_starter_1_1` reports its selected SD1.5 checkpoint, exact positive and
  negative prompts, and sampler settings.
- Both workflows have one saved output, one root sampler, no ambiguity, and
  `SamplerTraversal` provenance for populated metadata fields.
- No active Getting Started workflow remains unassessed.
- Coverage totals are 64 golden, 5 pattern-covered, 1 partial, 14 unassessed,
  and 494 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior or reinterpret other v0.11.15 workflows.
- Do not change public interfaces, storage, bindings, or frontend behavior.

## Verification

- Exact pinned Git blob identities and workflow-string preservation passed for
  both Getting Started workflows.
- `cargo test metadata::comfyui::tests::official_catalog`: 79 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 19 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 3 passed.
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 17 passed.
- `cargo test metadata::comfyui::tests::output_selection`: 15 passed.
- `cargo test metadata::comfyui`: 343 passed; the existing Ollama-chain test
  remains ignored.
- `cargo test metadata::reparse`: 10 passed.
- Parser version remains 37 and `Cargo.lock` is unchanged.
