# Milestone 59: ComfyUI Core Transform Coverage

Status: Complete

## Outcome

Extend the pinned v0.11.18 official image corpus with Lotus depth, Qwen
Layered, Qwen Layered Control, and PiD latent upscaling while preserving exact
saved-output authority.

## Acceptance Criteria

- Vendor exact workflow-only fixtures with pinned Git blob identities.
- Assert exact selected-stage metadata, resources, output diagnostics,
  workflow preservation, and field provenance for all four workflows.
- Treat `SetFirstSigma` as a transparent connected sigma wrapper without
  global or disconnected discovery.
- Reach 94 golden, 2 pattern-covered, 5 partial, 0 unassessed, and 477 excluded
  manifest entries, including 8 extended image targets.
- Increment parser version to 44 because Lotus extraction behavior improves.

## Non-Goals

- Do not execute custom nodes or infer metadata from disconnected branches.
- Do not change public interfaces, storage, bindings, frontend behavior, or
  `ImageMetadata`.
- Do not merge, rebase, push, or publish the accumulated ComfyUI stack.

## Verification

- `cargo test metadata::comfyui::tests::official_catalog`: 101 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 26 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 4 passed.
- `cargo test metadata::comfyui::tests::catalog_path_parity`: 2 passed.
- `cargo test metadata::comfyui::tests::multi_stage`: 61 passed.
- `cargo test metadata::comfyui`: 407 passed, 1 intentionally ignored.
- `cargo test metadata::reparse`: 10 passed.
- `node --test scripts/audit-comfyui-catalog.node-test.mjs`: 13 passed.
- `pnpm run audit:comfyui-catalog -- --catalog-root
  C:\\tmp\\comfyui-workflow-templates-v0.11.18-ambit --mode verify`: verified
  all 578 source blobs and 101 dedicated fixtures against the pinned catalog.
- `cargo fmt --check` and `git diff --check`: passed.
