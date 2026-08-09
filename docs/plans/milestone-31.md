# Milestone 31: ComfyUI Baseline And Edit Golden Batch

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Add exact workflow-only golden coverage for Flux Dev full, Flux.1 Krea Dev,
Qwen Image Edit base, Z-Image base, and Z-Image Turbo INT8 without changing
parser behavior.

Acceptance requires exact pinned workflow preservation, deterministic output
diagnostics, selected-path metadata from `SamplerTraversal`, exact empty
resource vectors, and manifest totals of 50 `golden`, 9 `pattern_covered`, 4
`partial`, 12 `unassessed`, and 474 `excluded` while parser version remains 34.

## Work Package

Primary invariant: baseline and edit variants must preserve the metadata of the
selected saved-output path while inactive optional resources remain omitted.

Scope:

- Vendor and verify the five pinned workflow-only fixtures.
- Assert exact model, sampler settings, prompts, resources, normalized graph
  counts, output roots, ambiguity, workflow preservation, and provenance.
- Store the independently captured Z-Image prompt separately.
- Promote only the five verified catalog entries.

Non-goals:

- No parser behavior, parser-version, frontend, database, Tauri command,
  binding, diagnostics DTO, or metadata-shape changes.
- `flux_schnell_full_text_to_image` remains deferred because its separate
  CLIP-L and T5 prompt lanes need an explicit policy for the single positive
  prompt field.
- No push, merge, or rebase of the accumulated parser branch.

## Acceptance Gate

Run catalog-intake, official-catalog, template-coverage, workflow-subgraph,
output-selection, full ComfyUI, and reparse tests. Run `cargo fmt --check` and
`git diff --check`. Confirm parser version 34, no `Cargo.lock` churn, and no
public interface changes.

## Verification

- Pinned fixture intake: passed, including exact upstream blob identities.
- Official catalog goldens: 55 passed.
- Coverage manifest validation: 3 passed.
- Workflow subgraphs: 17 passed.
- Output selection: 15 passed.
- Full ComfyUI suite: 301 passed, 1 intentionally ignored.
- Metadata reparse suite: 10 passed.
- Parser version remains 34; no parser behavior or public interface changed.
