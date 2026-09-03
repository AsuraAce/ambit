# Milestone 74: ComfyUI Resource Source Navigation

Status: Complete

## Outcome

Developer diagnostics identify the parser layer and normalized workflow nodes
that supplied each extracted LoRA, ControlNet, IP-Adapter, embedding, and
hypernetwork. Available source nodes can be opened directly in the Workflow
Inspector.

## Acceptance

- Resource provenance uses the exact normalized metadata value as its item key.
- Stronger parser layers replace weaker evidence for the same item; equal layers
  retain every deterministic source node ID.
- Flat-parameter resources report `flat_parameters` without inventing graph
  nodes.
- Loader resources point to their loader nodes, while prompt-derived resources
  point to resolved prompt source nodes, including namespaced subgraph IDs.
- The dev-only Resource Sources section reuses workflow focus navigation,
  clears search, and leaves Selected Branch mode when the source is elsewhere.
- Missing source nodes remain visible and noninteractive.
- Compact diagnostics and schema-version-1 support bundles include the new
  backward-compatible resource source field.
- Parser output and parser version remain unchanged at `46`.

## Non-Goals

- Persisting resource provenance in `ImageMetadata` or SQLite.
- Item-level confidence or provenance outside developer diagnostics.
- Changing resource extraction, normalization, or precedence behavior.
- Redesigning the Workflow Inspector or reconstructing visual subgraph
  boundaries.

## Verification

- Rust diagnostics tests cover direct loaders, prompt-derived resources,
  flat/graph precedence, same-layer node unions, DTO compatibility, and
  namespaced workflow-only subgraph sources.
- Workflow Inspector tests cover available, missing, and flat resource sources,
  navigation state, clipboard inclusion, and support-bundle compatibility.
- Full ComfyUI and reparse suites, generated-binding checks, frontend type and
  lint checks, formatting, diff hygiene, parser-version stability, and lockfile
  stability form the completion gate.
