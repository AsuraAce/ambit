# Milestone 73: ComfyUI Traversal Blocker Navigation

Status: Complete

## Outcome

Developer diagnostics expose every returned ComfyUI traversal blocker on
demand and navigate directly to blocker nodes available in the normalized
Workflow Inspector graph.

## Acceptance

- The first four traversal blockers remain visible by default.
- Show-all and show-less controls expose or collapse the complete bounded
  blocker report returned by Rust.
- Truncated diagnostics state that additional blockers were omitted without
  inventing a total.
- Available blocker node IDs reuse existing workflow focus navigation,
  including clearing search and leaving Selected Branch mode when needed.
- Missing blocker node IDs remain visible as noninteractive diagnostic
  evidence.
- Expanded state resets when the inspected image or raw chunks change.
- Parser output, diagnostics payloads, support bundles, and parser version
  remain unchanged at `46`.

## Non-Goals

- Item-level provenance for LoRAs, ControlNets, IP-Adapters, embeddings, or
  hypernetworks.
- Rust parser, diagnostics DTO, generated binding, database, or schema changes.
- A workflow canvas, edge routing, or visual subgraph-boundary reconstruction.
- Increasing the Rust traversal-issue limit.

## Verification

- Workflow Inspector tests cover blocker expansion, collapse, truncation,
  reset behavior, available-node navigation, and missing-node evidence.
- TypeScript, lint, focused frontend tests, diff hygiene, parser-version
  stability, and lockfile stability form the completion gate.
