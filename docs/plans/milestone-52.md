# Milestone 52: ComfyUI Resolved Use Everywhere Links

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Consume persisted cg-use-everywhere `extra.ue_links` as bounded workflow edges
so modern saved workflows recover their authored model and conditioning paths
without reimplementing the plugin's matching engine.

## Acceptance Criteria

- Persisted resolved links restore model, VAE, CLIP, and conditioning paths.
- Real workflow edges take precedence over virtual links.
- Identical virtual duplicates deduplicate; conflicting sources for one target
  fail closed and cannot reopen legacy wireless guessing.
- Missing, muted, bypassed, malformed, or over-budget virtual links fail closed.
- Resolved links remain scoped to their workflow container and expanded
  subgraph namespace.
- API prompt graphs remain authoritative when present.
- Legacy wireless heuristics remain available only where no resolved-link
  target provides stronger evidence.
- The exact upstream Use Everywhere 7.0.1 example extracts all core fields from
  `SamplerTraversal`.
- Parser version is 41 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not simulate Use Everywhere regex, group, color, priority, or controller
  matching rules.
- Do not execute generated text or arbitrary custom-node behavior.
- Do not change public interfaces, storage, bindings, diagnostics DTOs, or
  frontend behavior.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Resolved-link policy passed: 8 tests.
- Real-world fixture coverage passed: 8 tests.
- Corpus path parity passed for 110 fixtures: 89 official and 21 real-world.
- The full ComfyUI suite passed: 377 passed and 1 intentionally ignored.
- Metadata reparse passed: 10 tests.
- `cargo fmt --check` and `git diff --check` passed.
