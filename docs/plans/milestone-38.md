# Milestone 38: ComfyUI v0.11.15 Anima Revalidation

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Replace the historical Anima Base and Preview fixtures with their exact
published-catalog workflows and give each selected path independent golden
coverage.

## Acceptance Criteria

- Both workflow strings match their pinned upstream Git blob identities.
- Anima Base follows the disabled-turbo branch and reports the base model,
  30-step sampler settings, authored prompts, and no LoRA.
- Anima Preview retains exact model, sampler, prompt, output, and provenance
  assertions without claiming structural equivalence to Anima Base.
- Coverage totals are 50 golden, 5 pattern-covered, 1 partial, 28 unassessed,
  and 494 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior or reinterpret other v0.11.15 workflows.
- Do not change public interfaces, storage, bindings, or frontend behavior.

## Verification

- Exact pinned Git blob identities and workflow-string preservation passed for
  both Anima workflows.
- `cargo test metadata::comfyui::tests::official_catalog`: 77 passed.
- `cargo test metadata::comfyui::tests::catalog_patterns`: 2 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: passed.
- `cargo test metadata::comfyui::tests::template_coverage`: passed.
- `cargo test metadata::comfyui`: 338 tests; the existing Ollama-chain test
  remains ignored and all executed tests passed.
- `cargo test metadata::reparse`: 10 passed.
- `cargo fmt --check` and `git diff --check`: passed.
- Parser version remains 37 and `Cargo.lock` is unchanged.
