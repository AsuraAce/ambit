# Milestone 45: Official ComfyUI Image Use-Case Coverage

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Expand measurable ComfyUI coverage beyond the completed core catalog into the
official open-source, core-node image workflows under `Use Cases`, beginning
with three exact Qwen LoRA goldens.

## Acceptance Criteria

- The new use-case scope selects exactly nine image workflows and excludes
  video-oriented entries even when their catalog media type says `image`.
- Three workflow-only fixtures match their pinned upstream Git blob identities.
- Panorama, action-edit, and illustration metadata and resources are asserted
  exactly with one saved output, one root sampler, and no ambiguity.
- Coverage totals are 75 golden, 5 pattern-covered, 7 partial, 6 unassessed,
  and 485 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not infer coverage for the six deferred use-case workflows.
- Do not change parser behavior, public interfaces, storage, bindings, or
  frontend behavior.

## Verification

- Pinned intake verification passed for all three workflows, including exact
  Git blob identity, workflow preservation, graph shape, and output selection.
- Official-catalog tests passed: 83 tests.
- Coverage-manifest tests passed: 3 tests.
- Workflow-subgraph tests passed: 17 tests.
- Full ComfyUI metadata suite passed: 350 passed, 1 ignored.
- Metadata reparse tests passed: 10 tests.
- `cargo fmt --check` and `git diff --check` passed.
