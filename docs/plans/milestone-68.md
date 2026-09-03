# Milestone 68: Subgraph-Aware ComfyUI Workflow Inspector

Status: Complete

## Outcome

The Image Viewer uses the Rust ComfyUI graph normalizer for display whenever
raw ComfyUI chunks are available. Workflow-only modern subgraphs are shown as
grouped, searchable internal nodes without changing the workflow JSON retained
for copy, download, storage, or metadata parsing.

## Acceptance

- A read-only Specta command returns deterministic display nodes from
  `ComfyGraph::from_chunks`, including source, normalized ID, type, title,
  display inputs, and derived subgraph path.
- Valid API prompt graphs remain authoritative. Workflow-only graphs use the
  existing bounded recursive subgraph expansion.
- Namespaced nodes are grouped by subgraph path and remain searchable by title,
  type, node ID, or path.
- The viewer identifies API Prompt and Expanded Workflow display sources.
- Command errors, unavailable chunks, and non-ComfyUI workflows retain the
  existing frontend parser behavior.
- Copy and download continue to use the exact preserved workflow before any
  prompt fallback.
- No metadata extraction, storage, schema, diagnostics DTO, or parser-version
  behavior changes. Parser version remains `46`.

## Non-Goals

- Reconstructing ComfyUI's canvas, links, positions, or visual subgraph boxes.
- Persisting the normalized display graph.
- Duplicating subgraph expansion in TypeScript.
- Adding parser rules or catalog fixtures without new evidence.

## Verification

- Focused Rust report tests cover Krea workflow-only expansion, prompt
  authority, deterministic nested paths and ordering, display inputs, and
  cyclic-definition safety.
- Workflow Inspector tests cover backend source selection, nested grouping and
  search, command fallback, and exact archival copy behavior.
- Binding generation and drift checks, TypeScript, lint, ComfyUI Rust tests,
  formatting, and diff hygiene form the completion gate.
