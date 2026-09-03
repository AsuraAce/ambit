# Milestone 71: ComfyUI Selected Branch View

Status: Complete

## Outcome

The Image Viewer can reduce a normalized ComfyUI workflow to the connected
dependency branch of the parser-selected saved output while preserving the
existing complete node list as the default view.

## Acceptance

- Rust derives a deterministic selected branch from the same output selection
  used by metadata extraction.
- The branch begins at selected saved outputs, ignores saver metadata sockets,
  reaches the unique root sampler, and includes connected upstream
  dependencies.
- Known Comfy switches follow only their active branch; unresolved switches,
  ambiguous roots, samplerless outputs, and incomplete paths expose no branch.
- The Workflow Inspector defaults to All Nodes and offers a selected-branch
  mode only for authoritative backend-normalized reports.
- Search composes with the active mode, while navigation outside the branch
  returns to All Nodes before focusing the destination.
- Metadata extraction, parser diagnostics, workflow storage, and archival
  copy/download behavior remain unchanged. Parser version remains `46`.

## Non-Goals

- Exact per-field source-node tracing or execution of unknown custom selector
  semantics.
- A canvas, pan/zoom controls, edge routing, or visual subgraph boundaries.
- Persisting normalized nodes or selected branches.
- Parser rules, metadata refreshes, catalog fixtures, or database changes.

## Verification

- Rust report tests cover dependency inclusion, stale saver metadata exclusion,
  active and unresolved switches, shared roots, ambiguity, preview-only output,
  and samplerless output.
- Workflow helper and inspector tests cover backend mapping, fallback isolation,
  default mode, filtering, search, disabled states, and navigation outside the
  selected branch.
- Generated binding checks, TypeScript, lint, focused frontend tests, ComfyUI
  Rust tests, reparse tests, formatting, and diff hygiene form the completion
  gate.
