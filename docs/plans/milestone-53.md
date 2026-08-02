# Milestone 53: ComfyUI v0.11.18 Delta Revalidation

Status: Complete
Catalog release: `v0.11.18`
Catalog commit: `8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`

## Outcome

Refresh the pinned official catalog from v0.11.15 to v0.11.18, revalidate every
changed targeted workflow, and preserve complete assessment of the 93-workflow
active target.

## Acceptance Criteria

- The manifest contains the same 578 catalog IDs and 93 active targets.
- All eleven changed golden workflows use exact v0.11.18 workflow bytes and
  retain their golden metadata expectations.
- `gsl_starter_1_3` has direct fixture evidence for its bypassed-generator
  pattern without gaining false traversal authority.
- Modern subgraph instance widgets without `proxyWidgets` override definition
  defaults, while connected external inputs remain authoritative.
- The Qwen Getting Started workflow extracts its selected v0.11.18 seed from
  `SamplerTraversal`.
- Path parity covers 90 official fixtures and 21 real-world fixtures.
- Parser version is 42 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not execute generated text or inactive subgraphs.
- Do not change public interfaces, storage, bindings, diagnostics DTOs, or
  frontend behavior.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Official catalog goldens passed: 90 tests.
- Manifest validation passed: 3 tests.
- Catalog intake passed: 23 tests.
- Workflow-subgraph policy passed: 18 tests.
- Corpus path parity passed for 111 fixtures: 90 official and 21 real-world.
- The full ComfyUI suite passed: 379 passed and 1 intentionally ignored.
- Metadata reparse passed: 10 tests.
- All 12 refreshed fixture bodies and Git blob identities match the pinned
  v0.11.18 checkout exactly.
- `cargo fmt --check` and `git diff --check` passed.
