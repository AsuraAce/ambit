# Milestone 49: Role-Aware ComfyUI Wireless Prompts

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Preserve duplicate workflow input slots and apply the documented positive and
negative routing semantics of the legacy `Prompts Everywhere` node without
attempting to simulate the full Use Everywhere restriction engine.

## Acceptance Criteria

- The first `Prompts Everywhere` input supplies positive conditioning and the
  second supplies negative conditioning.
- Missing, unresolved, disabled, or conflicting broadcasters do not leak one
  prompt role into the other or select a nondeterministic source.
- Direct sampler links remain authoritative, while explicit API role names are
  supported.
- A disconnected generic broadcaster loop remains prompt-free and terminates.
- All 89 official and 15 real-world fixtures retain parity across direct
  extraction, scanner-style merging, reparse, and developer diagnostics.
- Parser version is 39 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not implement generic Use Everywhere regex, priority, group, color, or
  cross-subgraph restriction evaluation.
- Do not change the official catalog manifest, public interfaces, storage,
  bindings, or frontend behavior.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Focused UI-format, Prompts Everywhere, and broadcaster-loop regressions
  passed.
- Corpus path-parity tests passed for 104 fixtures.
- The full ComfyUI and metadata reparse suites passed.
- `cargo fmt --check` and `git diff --check` passed.
