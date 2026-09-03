# Milestone 48: Real-World ComfyUI Custom-Node Coverage

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Extend the real-world fixture corpus with four existing user/repro workflows and
correct the exact workflow-widget mapping for `KSampler //Inspire` without
generalizing to unverified Inspire variants.

## Acceptance Criteria

- The SDPromptSaver issue-1024 repro, Inspire FaceID resource fragment, smZ
  SetNode/GetNode workflow, and Prompts Everywhere broadcaster are vendored as
  minimized chunk fixtures with exact metadata, graph, resource, and provenance
  assertions.
- `KSampler //Inspire` maps seed, steps, CFG, sampler, scheduler, and denoise
  from its verified workflow widget positions.
- Named API inputs remain supported and linked workflow values override stale
  widgets.
- All 89 official and 14 real-world fixtures retain parity across direct
  extraction, scanner-style merging, reparse, and developer diagnostics.
- Parser version is 38 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not broaden support to unverified Inspire node variants or alter broadcast
  prompt semantics.
- Do not change the official catalog manifest, public interfaces, storage,
  bindings, or frontend behavior.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Focused Inspire mapping and four-fixture real-world regressions passed.
- Corpus path-parity tests passed: 2 tests covering 103 fixtures.
- The full ComfyUI suite passed: 363 tests passed and 1 intentionally ignored.
- Metadata reparse passed: 10 tests.
- `cargo fmt --check` and `git diff --check` passed.
