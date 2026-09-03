# Milestone 46: Official ComfyUI Image Use-Case Closure

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Finish the measurable official image-use-case target with exact workflow-only
fixtures and honest multi-output classification.

## Acceptance Criteria

- Six pinned workflows match their upstream Git blob identities and preserve
  exact workflow JSON.
- Five single-root workflows assert exact metadata, resources, output
  diagnostics, and `SamplerTraversal` provenance.
- The eight-root multiple-angle workflow is partial and asserts deterministic
  `SamplerFallback` metadata without claiming one branch as authoritative.
- All 93 targeted workflows are assessed: 80 golden, 5 pattern-covered, 8
  partial, and 0 unassessed.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not add a multi-output metadata shape or select an arbitrary saved branch.
- Do not change parser behavior, public interfaces, storage, bindings, or
  frontend behavior.

## Verification

- Pinned intake verification passed: 23 tests, including exact Git blob
  identity, workflow preservation, graph shape, and output selection.
- Official-catalog tests passed: 89 tests.
- Coverage-manifest tests passed: 3 tests.
- Workflow-subgraph tests passed: 17 tests.
- Output-selection tests passed: 15 tests.
- Full ComfyUI metadata suite passed: 357 passed, 1 ignored.
- Metadata reparse tests passed: 10 tests.
- `cargo fmt --check` and `git diff --check` passed.
