# Milestone 50: Legacy ComfyUI Repro Parity Closure

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Bring the remaining placeholder-prompt and loader-only legacy repro shapes into
the exact real-world fixture and four-entry-point parity corpus without changing
parser behavior.

## Acceptance Criteria

- Four minimized fixtures preserve stale saver placeholders, role-correct
  placeholder recovery, competing UNET/GGUF fallback, and GGUF-only recovery.
- Exact metadata and provenance distinguish `FlatParameters`,
  `SamplerFallback`, and `GlobalScan` evidence.
- Legacy loader tests assert complete scalar/model output and provenance rather
  than permissive substring or non-empty checks.
- All 89 official and 19 real-world fixtures retain parity across direct
  extraction, scanner-style merging, reparse, and developer diagnostics.
- Parser version remains 39 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change GGUF model-name cleanup; the current fallback output retains the
  `.gguf` suffix and requires a separate parser-versioned policy correction.
- Do not implement generated text, multi-output metadata, or generic Use
  Everywhere restriction evaluation.
- Do not change public interfaces, storage, bindings, or frontend behavior.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Real-world fixture tests passed: 8 tests.
- Exact loader repro tests passed: 2 tests.
- Corpus path-parity tests passed for 108 fixtures.
- The full ComfyUI suite passed: 367 passed and 1 intentionally ignored.
- Metadata reparse passed: 10 tests.
- `cargo fmt --check` and `git diff --check` passed.
