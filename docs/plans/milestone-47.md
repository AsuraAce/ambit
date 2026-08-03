# Milestone 47: ComfyUI Metadata Path Parity Gate

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Protect the completed ComfyUI fixture corpus against metadata drift between
direct extraction, scanner-style merging, background reparse, and developer
diagnostics.

## Acceptance Criteria

- All 89 official catalog fixtures and 10 real-world fixtures exercise the
  same four metadata entry points.
- Scanner-style and reparse metadata match direct extraction across every
  `ImageMetadata` field, including exact workflow preservation.
- Reparse serialization matches direct metadata serialization.
- Developer diagnostics match direct extraction for metadata preview, graph
  node count, attempted layers, field provenance, and chunk presence.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior, merge precedence, fixture expectations,
  public interfaces, storage, bindings, or frontend behavior.
- Do not merge or publish the unmerged ComfyUI integration stack.

## Verification

- Corpus path-parity tests passed: 2 tests covering 99 fixtures.
- Official-catalog, real-world, full ComfyUI, and metadata reparse suites
  passed.
- `cargo fmt --check` and `git diff --check` passed.
