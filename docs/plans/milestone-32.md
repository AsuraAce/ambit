# Milestone 32: ComfyUI Flux.2 Variant Closure

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Add exact workflow-only golden coverage for the seven remaining Flux.2 Dev and
Flux.2 Klein target variants. The intake exposed a missing exact workflow
mapping for zero-valued `RandomNoise` seeds, so the milestone also includes
that narrow parser correction.

Acceptance requires exact pinned workflow preservation, deterministic output
diagnostics, selected-path metadata from `SamplerTraversal`, disabled resource
branches omitted, and manifest totals of 57 `golden`, 9 `pattern_covered`, 4
`partial`, 5 `unassessed`, and 474 `excluded`. Parser version 35 reparses
workflow-only images whose selected `RandomNoise` seed is a small integer.

## Work Package

Primary invariant: only the active saved-output branch may supply Flux.2
metadata; bypassed alternative subgraphs, save nodes, and Turbo LoRAs remain
inactive evidence.

Scope:

- Vendor and verify the seven pinned workflow-only fixtures.
- Assert exact model, sampler settings, prompts, resources, normalized graph
  counts, output roots, ambiguity, workflow preservation, and provenance.
- Map workflow-format `RandomNoise.widgets_values[0]` explicitly so zero remains
  a valid seed instead of being discarded by generic heuristics.
- Promote only the seven verified Flux.2 catalog entries.

Non-goals:

- No frontend, database, Tauri command, binding, diagnostics DTO, or
  metadata-shape changes.
- Flux Schnell dual prompt lanes, HiDream O1 generated prompts, HiDream E1,
  and Qwen 2511 remain later work.
- No push, merge, or rebase of the accumulated parser branch.

## Acceptance Gate

Run catalog-intake, official-catalog, template-coverage, workflow-subgraph,
output-selection, full ComfyUI, and reparse tests. Run `cargo fmt --check` and
`git diff --check`. Confirm parser version 35, no `Cargo.lock` churn, and no
public interface changes.

## Verification

- Pinned fixture intake passed, including exact upstream blob identities and
  canonical UTF-8 byte counts for all seven workflows.
- All seven Flux.2 variant goldens passed with exact selected-path metadata,
  output diagnostics, workflow preservation, and provenance.
- The zero-valued workflow `RandomNoise` regression passed with seed provenance
  from `SamplerTraversal`.
- Coverage-manifest, workflow-subgraph, output-selection, full ComfyUI, and
  metadata-reparse suites passed.
- `cargo fmt --check` and `git diff --check` passed.
- Parser version is 35; no public interface or metadata shape changed, and
  `Cargo.lock` remains unchanged.
