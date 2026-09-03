# Milestone 30: ComfyUI Baseline Variant Closure

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Add exact workflow-only golden coverage for Flux Dev checkpoint, Boogu Turbo,
direct Chroma, Qwen Image base, and Z-Image Turbo workflows without changing
parser behavior.

Acceptance requires exact pinned workflow preservation, deterministic output
diagnostics, selected-path metadata from `SamplerTraversal`, exact empty
resource vectors, and manifest totals of 45 `golden`, 9 `pattern_covered`, 4
`partial`, 17 `unassessed`, and 474 `excluded` while parser version remains 34.

## Work Package

Primary invariant: linked and selected workflow values remain authoritative
over stale widgets and inactive optional resources.

Scope:

- Vendor and verify the five pinned workflow-only fixtures.
- Assert exact model, sampler settings, prompts, resources, normalized graph
  counts, output roots, ambiguity, workflow preservation, and provenance.
- Store the independently captured Qwen prompt separately and prove its
  disabled turbo branch does not report the Lightning LoRA.
- Promote only the five verified catalog entries.

Non-goals:

- No parser behavior, parser-version, frontend, database, Tauri command,
  binding, diagnostics DTO, or metadata-shape changes.
- A failing exact fixture remains unassessed and triggers a separate parser-gap
  plan instead of an opportunistic behavior change.
- No commit, push, merge, or rebase of the accumulated parser branch.

## Acceptance Gate

Run catalog-intake, official-catalog, template-coverage, workflow-subgraph,
output-selection, full ComfyUI, and reparse tests. Run `cargo fmt --check` and
`git diff --check`. Confirm parser version 34, no `Cargo.lock` churn, and no
public interface changes.

## Verification

- Pinned fixture intake: passed, including exact upstream blob identities.
- Official catalog goldens: 50 passed.
- Coverage manifest validation: 3 passed.
- Workflow subgraphs: 17 passed.
- Output selection: 15 passed.
- Full ComfyUI suite: 295 passed, 1 intentionally ignored.
- Metadata reparse suite: passed.
- Parser version remains 34; no parser behavior or public interface changed.
