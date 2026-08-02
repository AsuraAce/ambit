# Milestone 33: ComfyUI Active Catalog Target Closure

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Assess the final five entries in the 75-workflow active ComfyUI catalog target.
Add exact goldens for Flux Schnell, HiDream E1, and Qwen Image Edit 2511, and
record the two HiDream O1 variants as partial where their selected generated
prompt result is not embedded.

Acceptance requires exact pinned workflow preservation, deterministic output
diagnostics, selected-path metadata provenance, and final manifest totals of 60
`golden`, 9 `pattern_covered`, 6 `partial`, 0 `unassessed`, and 474 `excluded`.
Parser version 36 reparses workflows using the newly supported prompt and
sampler nodes.

## Work Package

Primary invariant: selected deterministic metadata is extracted exactly, while
unavailable generated prompts remain empty and cannot reopen stale widget or
disconnected fallback text.

Scope:

- Vendor and verify the five pinned workflow-only fixtures.
- Combine distinct `CLIPTextEncodeFlux` CLIP-L and T5 lanes in stable order,
  with connected inputs authoritative and exact duplicates removed.
- Report a connected `SamplerLCM` selected by `SamplerCustom` as `lcm` without
  interpreting its numeric widgets or scanning disconnected instances.
- Assert exact model, sampler settings, literal prompts, resources, normalized
  graph counts, output roots, ambiguity, workflow preservation, and provenance.
- Classify only the two workflows with unavailable generated output as partial.

Non-goals:

- Do not execute `TextGenerate` or treat its input as the final prompt.
- No frontend, database, Tauri command, binding, diagnostics DTO, or
  metadata-shape changes.
- No push, merge, or rebase of the accumulated parser branch.

## Acceptance Gate

Run prompt, multi-stage, fixture-intake, official-catalog, template-coverage,
workflow-subgraph, output-selection, full ComfyUI, and reparse tests. Run
`cargo fmt --check` and `git diff --check`. Confirm parser version 36, no
`Cargo.lock` churn, and no public interface changes.

## Verification

- Pinned fixture intake passed, including exact upstream Git blob identities
  and canonical UTF-8 byte counts for all five workflows.
- Three exact goldens and two explicit partial fixtures passed with selected
  output diagnostics, workflow preservation, and field provenance.
- `CLIPTextEncodeFlux` lane ordering, deduplication, widget recovery, linked
  authority, and unresolved-link fail-closed regressions passed.
- Connected `SamplerLCM` selection and disconnected-sampler isolation passed.
- Prompt, multi-stage, template-coverage, workflow-subgraph, output-selection,
  full ComfyUI, and metadata-reparse suites passed.
- `cargo fmt --check` and `git diff --check` passed.
- Parser version is 36; no public interface or metadata shape changed, and
  `Cargo.lock` remains unchanged.
