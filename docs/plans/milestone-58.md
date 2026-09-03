# Milestone 58: ComfyUI Extended Official Image Coverage

Status: Complete

## Outcome

Measure official image workflows beyond the original core-node target without
changing that target's definition. Add exact selected-path contracts for four
v0.11.18 utility and custom-node workflows.

## Acceptance Criteria

- Vendor exact workflow-only fixtures for Qwen crop-and-stitch fusion, Flux 2
  Klein image extension, Qwen 360 HDR generation, and Z-Image 2K upscaling.
- Assert exact metadata, resources, output selection, workflow preservation,
  and `SamplerTraversal` provenance for all four workflows.
- Add a distinct `target_extended_image` manifest scope while preserving the
  93-workflow core target.
- Validate core, extended, and excluded scope counts independently in Rust and
  in the offline catalog audit.
- Reach 90 golden, 2 pattern-covered, 5 partial, 0 unassessed, and 481 excluded
  entries without changing parser behavior or parser version 43.

## Non-Goals

- Do not broaden the core target definition or infer coverage by model family.
- Do not change parser behavior, public interfaces, storage, bindings, or UI.
- Do not merge, rebase, push, or publish the accumulated ComfyUI stack.

## Verification

- `cargo test metadata::comfyui::tests::official_catalog`: 97 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 25 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 4 passed.
- `cargo test metadata::comfyui::tests::catalog_path_parity`: 2 passed.
- `cargo test metadata::comfyui`: 401 passed, 1 intentionally ignored.
- `cargo test metadata::reparse`: 10 passed.
- `node --test scripts/audit-comfyui-catalog.node-test.mjs`: 13 passed.
- `pnpm run audit:comfyui-catalog -- --catalog-root
  C:\\tmp\\comfyui-workflow-templates-v0.11.18-ambit --mode verify`: verified
  all 578 source blobs and 97 dedicated fixtures against the pinned catalog.
- `cargo fmt --check` and `git diff --check`: passed.
