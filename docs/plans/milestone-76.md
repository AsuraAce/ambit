# Milestone 76: ComfyUI Support Replay Contract

Status: Complete

## Outcome

Offline support-bundle replay has an explicit evolution contract for every
top-level diagnostics field and reports extracted-metadata drift separately
from observability-only drift without weakening strict verification.

## Acceptance

- Every serialized diagnostics field declares whether it is compared, always
  ignored, or ignored only when absent from an older recording.
- A contract test fails when diagnostics gain a field without an explicit
  replay policy.
- Unknown recorded diagnostics fields fail closed instead of being silently
  discarded.
- `metadataOutputMatches` and `metadataDifferenceCount` cover `/metadata`
  differences.
- `diagnosticsMatch` and `diagnosticsDifferenceCount` cover all other compared
  diagnostics paths.
- `parserOutputMatches` and CLI `--verify` remain strict across both classes.
- Legacy compatibility exclusions remain visible in `comparisonIgnoredPaths`.
- Support bundle schema remains `1`; parser output and parser version remain
  unchanged at `46`.

## Non-Goals

- Relaxing verification for provenance or graph-analysis drift.
- Changing fixture-candidate comparison, support-bundle generation, or parser
  extraction.
- Frontend, binding, database, Tauri command, or `ImageMetadata` changes.

## Verification

- Replay tests cover contract completeness, legacy exclusions, explicit empty
  fields, metadata-only drift, diagnostics-only drift, mixed drift, ignored
  versions, and unknown fields.
- CLI tests cover successful compatibility replay and strict diagnostics-only
  verification failure.
- ComfyUI diagnostics and parser regression suites, formatting, diff hygiene,
  parser-version stability, and lockfile stability form the completion gate.
