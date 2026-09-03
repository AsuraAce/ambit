# Milestone 28: ComfyUI Reference And Modifier Golden Batch

Status: Complete
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Outcome

Add exact workflow-only golden coverage for Flux.1 USO reference generation,
Flux.1 Fill OneReward, Flux.2 Klein KV image editing, and Qwen Image Edit 2511
inflation LoRA workflows.

Acceptance requires exact pinned workflow preservation, selected-path metadata
from `SamplerTraversal`, exact resource vectors, deterministic output
diagnostics, and manifest totals of 36 `golden`, 9 `pattern_covered`, 3
`partial`, 27 `unassessed`, and 474 `excluded`.

## Work Package

Primary invariant: auxiliary reference and modifier nodes may contribute only
their represented resources; they cannot replace the connected primary model
or manufacture strong traversal evidence.

Scope:

- Vendor the four pinned workflow-only chunk fixtures and verify their Git blob
  identities.
- Assert exact model, sampler settings, prompts, resources, normalized graph
  counts, output candidates and roots, ambiguity, and provenance.
- Treat a mode-4 workflow subgraph as a passthrough only when every used output
  has exactly one connected input with the same declared type.
- Promote only the four verified catalog entries and increment parser version
  from 32 to 33.

Non-goals:

- No execution of reference encoders, broader resource inference, frontend,
  database, Tauri command, binding, diagnostics DTO, or metadata-shape changes.
- No merge or release of the accumulated parser branch after this package.

## Acceptance Gate

Run catalog intake, official catalog, template coverage, model, workflow
subgraph, output-selection, full ComfyUI, and reparse tests. Run
`cargo fmt --check` and `git diff --check`. Confirm no `Cargo.lock` churn and no
public interface changes.

## Compatibility Decision

Mode 2 remains muted and opaque. Mode 4 may forward a connected value only when
the workflow declares a unique type-compatible input for each used output. A
missing or ambiguous mapping fails closed, blocks incoming traversal, and
leaves the instance opaque. The successful USO normalization contains 26 nodes;
the other fixtures contain 18, 27, and 20 nodes respectively.
