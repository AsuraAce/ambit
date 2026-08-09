# Milestone 75: ComfyUI Support Diagnostics Compatibility

Status: Complete

## Outcome

Offline support-bundle replay distinguishes diagnostics that were absent from an
older schema-1 recording from diagnostics that were explicitly recorded as
empty. Older bundles remain useful after observability-only diagnostics grow,
without hiding parser metadata drift.

## Acceptance

- Replay remembers which top-level diagnostics fields existed in the source
  bundle before Serde applies backward-compatible defaults.
- Missing `fieldSourceNodeIds` and `resourceSources` are excluded from both sides
  of recorded-versus-current comparison.
- Explicitly present fields, including empty collections, remain authoritative
  comparison inputs.
- `comparisonIgnoredPaths` reports every compatibility exclusion in stable order.
- Metadata and all non-allowlisted diagnostics still fail `--verify` when they
  differ.
- Fixture-candidate comparison remains a strict fresh-diagnostics comparison.
- Support bundle schema remains `1`; parser output and parser version remain
  unchanged at `46`.

## Non-Goals

- Ignoring arbitrary future diagnostics fields.
- Changing support-bundle generation, fixture candidates, parser behavior, or
  metadata persistence.
- Frontend, binding, database, or `ImageMetadata` changes.

## Verification

- Replay tests cover current bundles, both optional fields absent, one field
  absent, explicitly empty recorded provenance, and unrelated metadata drift.
- CLI verification tests confirm a compatibility match still exits successfully.
- ComfyUI diagnostics and parser regression suites, formatting, diff hygiene,
  parser-version stability, and lockfile stability form the completion gate.
