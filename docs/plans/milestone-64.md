# Milestone 64: Deterministic ComfyUI Replay Differences

Status: Complete

## Outcome

Offline ComfyUI support-bundle replay reports identify each parser diagnostic
change with a deterministic JSON Pointer path, change kind, and recorded/current
values. Maintainers no longer need to compare two complete diagnostics objects
manually.

## Acceptance

- Replay reports include additive `differenceCount` and `differences` fields.
- Object entries are compared in stable lexical order with RFC 6901 path escaping.
- Arrays are treated atomically so insertions do not create misleading index drift.
- Added and removed values omit the unavailable side of the comparison.
- App/parser version-only changes remain ignored.
- `parserOutputMatches` is derived from whether the difference list is empty.
- Existing replay, validation, privacy, and `--verify` behavior remains unchanged.
- Reports never include raw chunk bodies.
- Parser version remains `46`.

## Non-Goals

- Writing fixtures or importing support bundles into the desktop app.
- Classifying parser differences as regressions or improvements.
- Changing parser behavior, stored metadata, bindings, or database schemas.

## Verification

- Focused tests cover matching reports, changed metadata, added/removed fields,
  escaped paths, atomic arrays, deterministic output, and version normalization.
- Existing CLI exit-code and privacy tests pass.
- Full Rust, ComfyUI, reparse, formatting, and diff-hygiene gates pass.
