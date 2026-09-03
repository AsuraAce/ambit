# Milestone 60: ComfyUI Upscale Utility Coverage

Status: Complete

## Outcome

Extend the pinned v0.11.18 official image corpus with SUPIR, SeedVR2 3B and
7B, and interpolation upscale workflows while preserving honest prompt and
non-generative metadata behavior.

## Acceptance Criteria

- Vendor exact workflow-only fixtures with pinned Git blob identities.
- Assert exact metadata, resources, output diagnostics, workflow preservation,
  and field provenance for all four workflows.
- Support modern singleton-object subgraph outputs without accepting malformed
  negative slots elsewhere.
- Deduplicate identical SDXL text lanes while keeping unresolved generated text
  unavailable.
- Reach 97 golden, 2 pattern-covered, 6 partial, 0 unassessed, and 473 excluded
  manifest entries, including 12 extended image targets.
- Increment parser version to 45 because affected workflow-only extraction
  improves.

## Non-Goals

- Do not execute `TextGenerate` or infer its selected output from instructions.
- Do not promote non-generative image transforms into generation metadata.
- Do not change public interfaces, storage, bindings, frontend behavior, or
  `ImageMetadata`.
- Do not merge, rebase, push, or publish the accumulated ComfyUI stack.

## Verification

- `cargo test metadata::comfyui::tests::official_catalog`: 105 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 27 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 4 passed.
- `cargo test metadata::comfyui::tests::catalog_path_parity`: 2 passed.
- `cargo test metadata::comfyui::tests::prompts`: 57 passed.
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 19 passed.
- `cargo test metadata::comfyui`: 414 passed, 1 intentionally ignored.
- `cargo test metadata::reparse`: 10 passed.
- `node --test scripts/audit-comfyui-catalog.node-test.mjs`: 13 passed.
- `pnpm run audit:comfyui-catalog -- --catalog-root
  C:\\tmp\\comfyui-workflow-templates-v0.11.18-ambit --mode verify`: verified
  all 578 source blobs and 105 dedicated fixtures against the pinned catalog.
- `cargo fmt --check` and `git diff --check`: passed.
