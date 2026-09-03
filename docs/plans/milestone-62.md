# Milestone 62: ComfyUI Support Bundle

Status: Complete

## Outcome

Developer Mode can export a local JSON support bundle for a ComfyUI image. The bundle carries exact raw metadata chunks, parser provenance, app/parser versions, chunk lengths, and a minimal image format/dimension descriptor so parser gaps can be reproduced without sharing the image itself.

## Acceptance

- Compact copied diagnostics omit path-backed image identity and raw chunk bodies.
- Full support export requires confirmation that raw chunks may contain prompts, model names, settings, and local filenames.
- Export is local-only, deterministic apart from its creation timestamp, and includes schema version `1`.
- Save cancellation is a no-op; serialization, dialog, and write failures leave workflow diagnostics usable.
- Parser version remains `46`; metadata extraction and stored metadata are unchanged.

## Non-Goals

- Uploading support data or adding network behavior.
- Exporting image pixels, thumbnails, database fields, notes, paths, URLs, or filenames outside raw metadata chunks.
- Changing parser behavior, database schema, `ImageMetadata`, or metadata refresh policy.

## Verification

- Rust diagnostics report and full ComfyUI regression tests pass.
- Deterministic bundle, compact-summary, export, cancellation, and failure-state tests pass.
- Generated binding drift, typecheck, lint, Rust formatting, and diff hygiene checks pass.
