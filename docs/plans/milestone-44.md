# Milestone 44: ComfyUI v0.11.15 Catalog Closure

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Revalidate the final four changed catalog workflows against their selected
execution paths and remove the remaining active-target `unassessed` entries.

## Acceptance Criteria

- All four workflow strings match their pinned upstream Git blob identities.
- ERNIE Turbo and both Krea Turbo variants are classified as partial because
  their selected `TextGenerate` results are not embedded; visible generator
  inputs are not reported as final image prompts.
- Z-Image traverses `SaveImageAdvanced` to its single root sampler.
- Exact model, sampler, prompt, resource, output, workflow, and provenance
  expectations pass for all four fixtures.
- Coverage totals are 72 golden, 5 pattern-covered, 7 partial, 0 unassessed,
  and 494 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not execute `TextGenerate` or infer generated prompt output.
- Do not change parser behavior, public interfaces, storage, bindings, or
  frontend behavior.

## Verification

- Exact Git blob identities and normalized workflow shapes are pinned by the
  catalog intake tests.
- Exact available metadata, output selection, workflow preservation, and
  provenance are covered by the official catalog tests.
- The full ComfyUI and reparse suites pass without parser changes.
