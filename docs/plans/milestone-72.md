# Milestone 72: ComfyUI Metadata Source Navigation

Status: Complete

## Outcome

Developer diagnostics identify the normalized workflow nodes that supplied each
core ComfyUI metadata field, and the Image Viewer can navigate directly to every
available source node.

## Acceptance

- Rust records one or more source node IDs for model, seed, steps, CFG, sampler,
  positive prompt, and negative prompt without changing extracted metadata.
- Source IDs follow the winning provenance layer, respect flat-versus-graph
  merge precedence, and use normalized namespaced IDs for expanded subgraphs.
- Diagnostic serialization is bounded and backward-compatible when older
  payloads omit source IDs.
- The Workflow Inspector renders source-node controls beside field provenance
  and reuses existing focus behavior, including leaving Selected Branch mode
  when the requested node is outside that branch.
- Missing source nodes remain visible as noninteractive diagnostic evidence.
- Copied diagnostics and support bundles include source IDs without changing
  the support-bundle schema version.
- Parser output and parser version remain unchanged at `46`.

## Non-Goals

- Item-level source navigation for LoRAs, ControlNets, IP-Adapters,
  embeddings, or hypernetworks.
- Persisting source IDs in image metadata or the database.
- Executing unsupported workflow nodes or changing extraction precedence.
- A workflow canvas, edge routing, or visual subgraph-boundary reconstruction.

## Verification

- Rust diagnostics tests cover explicit, traversal, fallback, global-scan,
  linked scalar, composed prompt, and multiple sampler source IDs.
- Merge tests ensure retained flat fields do not inherit weaker graph sources.
- Workflow-only Krea coverage verifies source IDs resolve against the normalized
  namespaced graph.
- Workflow Inspector tests cover available and unavailable source controls,
  multiple sources, search clearing, branch-mode exit, focus, and highlighting.
- Support-bundle tests verify compact diagnostics include source IDs while the
  full bundle remains schema version 1.
- Generated bindings, TypeScript, lint, Rust regression suites, formatting, and
  diff hygiene form the completion gate.
