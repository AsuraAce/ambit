# Milestone 69: ComfyUI Workflow Connection Inspector

Status: Complete

## Outcome

The Image Viewer exposes deterministic incoming and outgoing connections from
the same Rust-normalized ComfyUI graph used for workflow display. A connection
can focus and expand its related node across top-level, subgraph, and resolved
virtual-link boundaries without introducing a separate graph canvas.

## Acceptance

- The workflow inspection report includes deterministic, deduplicated edges
  with source node/output and target node/input identities.
- API prompt, expanded workflow, subgraph-boundary, and resolved GetNode links
  use the normalized `ComfyGraph`; unresolved or missing endpoints are omitted.
- Frontend fallback parsing remains node-only and cannot invent connections.
- A memoized linear adjacency index supplies compact Incoming and Outgoing
  sections for nodes that have connections.
- Following a connection clears node search, expands and focuses the related
  node, scrolls it into view, and retains a visible highlight until another
  connection is followed or the image/source changes.
- Copy and download continue to use the exact preserved workflow JSON.
- No metadata extraction, storage, schema, parser-version, or diagnostics DTO
  behavior changes. Parser version remains `46`.

## Non-Goals

- A canvas, pan/zoom controls, edge routing, or visual subgraph reconstruction.
- Persisting normalized nodes or connections.
- Guessing unresolved workflow links in TypeScript.
- Adding parser rules or catalog fixtures.

## Verification

- Rust report tests cover deterministic API edges, workflow-only subgraph
  boundaries, resolved GetNode links, and missing-endpoint omission.
- Workflow helper and inspector tests cover edge mapping, linear indexing,
  fallback isolation, filtered navigation, expansion, focus, and scrolling.
- Binding generation and drift checks, TypeScript, lint, focused frontend
  tests, ComfyUI Rust tests, reparse tests, formatting, and diff hygiene form
  the completion gate.
