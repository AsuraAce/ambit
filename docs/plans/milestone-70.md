# Milestone 70: ComfyUI Saved-Output Anchors

Status: Complete

## Outcome

The Image Viewer identifies and navigates to the exact saved outputs and root
samplers selected by the Rust ComfyUI parser. These anchors reuse the parser's
existing output-selection policy instead of deriving authority from frontend
graph reachability.

## Acceptance

- Metadata extraction and workflow inspection share one deterministic output
  selection analysis.
- The workflow report includes selected output IDs, root sampler IDs, and the
  parser's ambiguity result for API and expanded workflow graphs.
- Selected outputs and root samplers have visible node-card roles and compact
  controls that clear search, expand, focus, scroll to, and highlight a node.
- Multiple outputs sharing one root remain authoritative; conflicting roots
  are labeled candidates and show an ambiguity warning.
- Samplerless outputs remain visible without fabricating a root, while local
  frontend fallback graphs cannot invent anchors.
- Metadata extraction, workflow storage, and archival copy/download behavior
  remain unchanged. Parser version remains `46`.

## Non-Goals

- Filtering the list to an inferred generation or dependency path.
- A canvas, pan/zoom controls, edge routing, or visual subgraph reconstruction.
- Persisting normalized nodes, connections, or output selection.
- Parser rules, catalog fixtures, metadata refreshes, or diagnostics DTO changes.

## Verification

- Rust report tests cover shared roots, conflicting roots, preview-only graphs,
  samplerless saves, no-output graphs, and expanded subgraph IDs.
- Workflow helper and inspector tests cover report mapping, role badges, anchor
  navigation, ambiguity wording, samplerless behavior, and fallback isolation.
- Binding generation and drift checks, TypeScript, lint, focused frontend
  tests, ComfyUI Rust tests, reparse tests, formatting, and diff hygiene form
  the completion gate.
