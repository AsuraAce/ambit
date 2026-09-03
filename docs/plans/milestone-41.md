# Milestone 41: ComfyUI v0.11.15 Qwen Edit Revalidation

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Replace the structurally changed Qwen Edit 2509 and 2511 fixtures with their
exact published-catalog workflows and restore golden coverage after reviewing
their selected metadata paths independently.

## Acceptance Criteria

- Both workflow strings match their pinned upstream Git blob identities.
- Qwen Edit 2509 reports its selected four-step Lightning path, exact prompt,
  active LoRA, and current seed.
- Qwen Edit 2511 reports its selected 40-step base path, FP8-mixed model,
  exact prompt, current seed, and no disabled Lightning LoRA.
- Both workflows have one saved output, one root sampler, no ambiguity, and
  `SamplerTraversal` provenance for populated metadata fields.
- Coverage totals are 62 golden, 5 pattern-covered, 1 partial, 16 unassessed,
  and 494 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior or reinterpret other v0.11.15 workflows.
- Do not change public interfaces, storage, bindings, or frontend behavior.

## Verification

- Exact pinned Git blob identities and workflow-string preservation passed for
  both Qwen Edit workflows.
- `cargo test metadata::comfyui::tests::official_catalog`: 77 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 18 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 3 passed.
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 17 passed.
- `cargo test metadata::comfyui::tests::output_selection`: 15 passed.
- `cargo test metadata::comfyui`: 340 passed; the existing Ollama-chain test
  remains ignored.
- `cargo test metadata::reparse`: 10 passed.
- Parser version remains 37 and `Cargo.lock` is unchanged.
