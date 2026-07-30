# Milestone 51: ComfyUI GGUF Model Traversal and Normalization

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Normalize GGUF model filenames consistently and recognize GGUF UNET loaders in
both connected saved-output traversal and conservative wireless fallback.

## Acceptance Criteria

- Supported model extensions are removed case-insensitively, including
  `.gguf`.
- Connected `UnetLoaderGGUF` model paths report suffix-free model names from
  `SamplerTraversal` in API and workflow formats.
- A sole disconnected GGUF loader may provide weak `SamplerFallback` model
  evidence.
- Competing disconnected primary model loaders remain ambiguous; sampler
  scalars stay `SamplerFallback` while deterministic model recovery remains
  `GlobalScan`.
- All 89 official and 20 real-world fixtures retain parity across direct
  extraction, scanner-style merging, reparse, and developer diagnostics.
- Parser version is 40 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not broaden auxiliary loader or resource classification.
- Do not change generated-text, multi-output, or generic restriction policy.
- Do not change public interfaces, storage, bindings, or frontend behavior.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Shared guidance cleanup passed: 6 tests.
- A1111 compatibility passed: 14 tests.
- Focused API, workflow, wireless, and ambiguity regressions passed.
- Real-world fixture tests passed: 8 tests.
- Corpus path parity passed for 109 fixtures.
- The full ComfyUI suite passed: 369 passed and 1 intentionally ignored.
- Metadata reparse passed: 10 tests.
- `cargo fmt --check` and `git diff --check` passed.
