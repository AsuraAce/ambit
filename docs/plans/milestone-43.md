# Milestone 43: ComfyUI v0.11.15 Semantic-Preserving Revalidation

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Replace ten historical fixtures with their exact published-catalog workflows
after confirming their executable graphs are unchanged. Restore seven golden
and three partial classifications without changing parser output.

## Acceptance Criteria

- All ten workflow strings match their pinned upstream Git blob identities.
- Existing exact model, sampler, prompt, resource, output, and provenance
  expectations remain unchanged.
- ERNIE Image and both HiDream O1 workflows remain partial because their final
  generated prompts are not embedded in workflow metadata.
- Coverage totals are 71 golden, 5 pattern-covered, 4 partial, 4 unassessed,
  and 494 excluded.
- Only ERNIE Turbo, both Krea Turbo variants, and Z-Image remain unassessed.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior or reinterpret the four structurally changed
  v0.11.15 workflows.
- Do not change public interfaces, storage, bindings, or frontend behavior.

## Verification

- Exact pinned Git blob identities and workflow-string preservation passed for
  all ten workflows.
- `cargo test metadata::comfyui::tests::catalog_intake`: 20 passed.
- `cargo test metadata::comfyui::tests::official_catalog`: 79 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 3 passed.
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 17 passed.
- `cargo test metadata::comfyui::tests::output_selection`: 15 passed.
- `cargo test metadata::comfyui`: 344 passed; the existing Ollama-chain test
  remains ignored.
- `cargo test metadata::reparse`: 10 passed.
- `cargo fmt --check` and `git diff --check`: passed.
- Parser version remains 37 and incidental `Cargo.lock` churn was removed.
