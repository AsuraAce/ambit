# Milestone 79: ComfyUI Batch Drift Grouping

Status: Complete

## Outcome

Value-redacted ComfyUI batch replay groups bundles that exhibit the same parser
difference shape, allowing maintainers to triage repeated drift as one cohort.

## Acceptance

- Batch summary schema version `2` adds drift signatures and groups without
  changing the single-replay summary schema.
- Only valid metadata, diagnostics, or mixed drift cases receive signatures.
  Matching and invalid cases remain ungrouped.
- Signature input is canonical minified JSON containing the drift status,
  sorted difference paths and kinds, and sorted unique compatibility-excluded
  paths. Its SHA-256 excludes bundle identity and all compared values.
- Every group reports its signature, status, case count, sorted bundle hashes,
  canonical difference descriptors, and compatibility exclusions.
- Duplicate bundle contents remain duplicate cases and group members. Cases
  remain sorted by bundle hash and groups are sorted by signature.
- Existing batch intake, limits, privacy boundaries, continuation behavior, and
  exit codes are unchanged.
- Parser output and parser version remain unchanged at `46`.

## Non-Goals

- Deciding whether grouped drift is a regression, improvement, or expected
  compatibility change.
- Grouping matching or invalid bundles.
- Exposing filenames, paths, raw chunks, compared values, or private bundle
  contents.
- New CLI flags, frontend, binding, database, parser, or metadata-shape changes.

## Verification

- CLI tests cover exact signature hashes, same-pattern grouping, separation by
  path, kind, status, and compatibility scope, duplicate retention, stable
  ordering, and matching/invalid exclusions.
- Existing privacy, intake-limit, continuation, determinism, and exit-code tests
  remain green.
- Replay, ComfyUI diagnostics, parser, reparse, formatting, diff hygiene,
  parser-version stability, and lockfile stability form the completion gate.
