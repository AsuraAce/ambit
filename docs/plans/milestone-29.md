# Milestone 29: ComfyUI Core Variant Closure

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Add exact workflow-only golden coverage for Qwen Image 2512 base and two-step
LoRA workflows plus HiDream I1 Dev and Fast. Assess Krea 2 Turbo INT8 as
partial because its selected generated prompt is not embedded.

Acceptance requires exact pinned workflow preservation, deterministic output
diagnostics, selected-path metadata from `SamplerTraversal`, exact resource
vectors, no stale generated-prompt fallback, and manifest totals of 40
`golden`, 9 `pattern_covered`, 4 `partial`, 22 `unassessed`, and 474
`excluded`.

## Work Package

Primary invariant: a visible widget behind an active generated-text path is
not the final image prompt. Missing generated output remains unavailable and
cannot gain prompt provenance.

Scope:

- Vendor and verify the five pinned workflow-only fixtures.
- Assert exact metadata, resources, normalized graph counts, output roots,
  ambiguity, workflow preservation, and field provenance.
- Promote the four fully representable workflows to golden and record Krea 2
  INT8 as partial with its precise generated-prompt limitation.
- Remove stale competing edges from a definition input slot when an unlinked
  subgraph boundary owns that slot, then preserve the definition widget.
- Increment parser version from 33 to 34 for corrected workflow-only values.

Non-goals:

- No execution of `TextGenerate`, stale prompt fallback, new node semantics,
  frontend, database, Tauri command, binding, diagnostics DTO, or
  metadata-shape changes.
- No commit, push, or merge of the accumulated parser branch.

## Acceptance Gate

Run catalog intake, official catalog, template coverage, workflow subgraph,
output-selection, full ComfyUI, and reparse tests. Run `cargo fmt --check` and
`git diff --check`. Confirm parser version 34, no `Cargo.lock` churn, and no
public interface changes.

Verification completed on 2026-07-28: catalog intake, official catalog,
template coverage, workflow subgraph, output-selection, full ComfyUI, and
reparse tests passed. Formatting and diff hygiene passed with no lockfile
churn or public interface changes.
