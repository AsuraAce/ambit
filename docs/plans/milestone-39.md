# Milestone 39: ComfyUI v0.11.15 Flux.2 Revalidation

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Replace six historical Flux.2 fixtures with their exact published-catalog
workflows and restore golden coverage after verifying their selected metadata
paths remain unchanged.

## Acceptance Criteria

- All six workflow strings match their pinned upstream Git blob identities.
- Flux.2 Dev and Klein workflows retain exact model, sampler, prompt, resource,
  output, and provenance assertions.
- Disabled Turbo LoRAs and bypassed alternatives remain outside the selected
  metadata path.
- Coverage totals are 56 golden, 5 pattern-covered, 1 partial, 22 unassessed,
  and 494 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior or reinterpret other v0.11.15 workflows.
- Do not change public interfaces, storage, bindings, or frontend behavior.

## Verification

- Exact pinned Git blob identities and workflow-string preservation passed for
  all six workflows.
- `cargo test metadata::comfyui::tests::official_catalog`: 77 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 16 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 3 passed.
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 17 passed.
- `cargo test metadata::comfyui::tests::output_selection`: 15 passed.
- `cargo test metadata::comfyui`: 338 passed; the existing Ollama-chain test
  remains ignored.
- `cargo test metadata::reparse`: 10 passed.
- `cargo fmt --check` and `git diff --check`: passed.
- Parser version remains 37 and incidental `Cargo.lock` churn was removed.
