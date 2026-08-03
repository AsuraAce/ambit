# Milestone 37: ComfyUI v0.11.15 Selected-Path Revalidation

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Replace six historical Capybara, Boogu, and Lens fixtures with their exact
published-catalog workflows and restore coverage only after their selected
metadata paths pass exact extraction and provenance assertions.

## Acceptance Criteria

- The six workflow strings match their pinned upstream Git blob identities.
- Capybara text-to-image and edit, Boogu edit and turbo, and Lens base retain
  exact model, sampler, prompt, resource, output, and provenance assertions.
- Lens Turbo remains pattern-covered by an exact selected-path comparison with
  Lens base.
- Coverage totals are 48 golden, 5 pattern-covered, 1 partial, 30 unassessed,
  and 494 excluded.
- Parser version remains 37 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not change parser behavior or reinterpret newly changed Anima workflows.
- Do not change public interfaces, storage, bindings, or frontend behavior.

## Verification

Completed on `2026-07-29`:

- all six workflows passed exact upstream Git-blob, workflow-preservation,
  graph-shape, output-selection, metadata, resource, and provenance checks;
- official-catalog, catalog-pattern, catalog-intake, template-coverage, full
  ComfyUI, and metadata-reparse test suites passed;
- `cargo fmt --check` and `git diff --check` passed;
- parser version remained 37 and incidental `Cargo.lock` churn was removed.
