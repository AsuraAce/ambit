# Milestone 40: ComfyUI v0.11.15 Qwen Revalidation

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Replace four historical Qwen fixtures with their exact published-catalog
workflows and restore golden coverage after verifying their selected metadata
paths remain unchanged.

## Acceptance Criteria

- All four workflow strings match their pinned upstream Git blob identities.
- Qwen 2512 base, ControlNet, two-step LoRA, and Qwen 2511 inflation retain
  exact model, sampler, prompt, resource, output, and provenance assertions.
- Disabled resources and unrelated branches remain outside selected metadata.
- Coverage totals are 60 golden, 5 pattern-covered, 1 partial, 18 unassessed,
  and 494 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior or reinterpret other v0.11.15 workflows.
- Keep the structurally changed Qwen Edit 2509 and 2511 workflows unassessed.
- Do not change public interfaces, storage, bindings, or frontend behavior.

## Verification

- Exact pinned Git blob identities and workflow-string preservation passed for
  all four workflows.
- `cargo test metadata::comfyui::tests::official_catalog`: 77 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 17 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 3 passed.
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 17 passed.
- `cargo test metadata::comfyui::tests::output_selection`: 15 passed.
- `cargo test metadata::comfyui`: 339 passed; the existing Ollama-chain test
  remains ignored.
- `cargo test metadata::reparse`: 10 passed.
- `cargo fmt --check` and `git diff --check`: passed.
- Parser version remains 37 and `Cargo.lock` is unchanged.
