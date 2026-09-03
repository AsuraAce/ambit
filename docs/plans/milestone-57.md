# Milestone 57: ComfyUI Active-Target Fixture Closure

Status: Complete

## Outcome

Give every pinned v0.11.18 active target dedicated fixture evidence. Promote
directly supported workflows from representative pattern claims while keeping
intentionally inactive starter workflows fail-closed.

## Acceptance Criteria

- Vendor exact workflow-only fixtures for `default`, `gsc_creator_2_1`, and
  `gsc_starter_1` from the pinned v0.11.18 catalog commit.
- Promote `default`, `gsc_creator_2_1`, and `image_lens_turbo_t2i` to golden
  using exact metadata and provenance contracts.
- Prove that disconnected `gsc_starter_1` has no selected output root and never
  receives `SamplerTraversal` authority.
- Retain bypassed `gsl_starter_1_3` as pattern-covered with its existing direct
  fail-closed contract.
- Require dedicated fixture evidence for all 93 active catalog targets.
- Reach 86 golden, 2 pattern-covered, 5 partial, 0 unassessed, and 485 excluded
  entries without changing parser behavior or parser version 43.

## Non-Goals

- Do not execute generated text or redesign multi-output metadata.
- Do not change parser behavior, public interfaces, storage, bindings, or UI.
- Do not merge, rebase, push, or publish the accumulated ComfyUI stack.

## Verification

- `cargo test metadata::comfyui::tests::official_catalog`: 93 passed.
- `cargo test metadata::comfyui::tests::catalog_intake`: 24 passed.
- `cargo test metadata::comfyui::tests::catalog_patterns`: 2 passed.
- `cargo test metadata::comfyui::tests::template_coverage`: 4 passed.
- `cargo test metadata::comfyui::tests::catalog_path_parity`: 2 passed.
- `cargo test metadata::comfyui`: 396 passed, 1 intentionally ignored.
- `cargo test metadata::reparse`: 10 passed.
- `node --test scripts/audit-comfyui-catalog.node-test.mjs`: 12 passed.
- `pnpm run audit:comfyui-catalog -- --catalog-root
  C:\\tmp\\comfyui-workflow-templates-v0.11.18-ambit --mode verify`: verified
  all 578 source blobs and 93 dedicated fixtures against the pinned catalog.
- `cargo fmt --check` and `git diff --check`: passed.
