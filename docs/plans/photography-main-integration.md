# Photography / main integration

Status: In progress
Baseline: origin/main 20cd2390 (0.13.0), photography checkpoint 09fb319f. The initial cbbd3ffd integration is preserved as 08dfb72d; main's thumbnail-repair follow-up arrived during verification and is included in this acceptance gate.

## Outcome

Bring the accepted photography slice onto current main without losing the current metadata viewer, video support, InvokeAI owner scoping, or existing photo catalog state. Preserve the compact Image Kind dropdown, All initial default, and saved user preference.

## Scope and invariants

- Keep released migrations 63–79 unchanged. Recognize only the exact legacy photography migration checksums and relocate their history to 80–81 transactionally before applying main migrations; reject ambiguous histories without modifying them. No real catalog was opened on the temporary 79–80 integration numbering.
- Retain camera metadata, classification overrides, display dates, and orientation-aware thumbnails through scan, refresh, removal, and restoration.
- Use main's shared native repair pipeline and canonical candidate views, with the photo thumbnail version-2 threshold supplied by a new migration rather than changing released migration 79.
- Respect current owner-scoped reads and mutations. Photo refresh and manual photo classification apply to images, not videos.
- Use the current viewer shell and editing conventions while retaining neutral photo details.
- No production catalog launch, source-file writes, publishing, or new feature work in this integration.

## Acceptance

1. Resolve overlapping changes, regenerate bindings, and verify fresh/main/legacy-photo synthetic database upgrade paths.
2. Pass targeted regressions, frontend typecheck/lint/build and frontend/Rust suites; review the combined change and resolve blocking findings.
3. Run an isolated browser or QA journey for source selection, photo details, and mixed-library browsing. Record any desktop-only checks still requiring owner acceptance.

## Risk

The branch and main reused migration numbers 63–64 for different schemas. A version-only migration repair would be unsafe; compatibility must be verified by checksum and fail closed. Existing owner-scope cache triggers also need to observe the added photo fields.
