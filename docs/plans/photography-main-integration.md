# Photography / main integration

Status: Complete — engineering integration; owner desktop acceptance pending
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

## Integration review

| Finding | Status | Closure check |
| --- | --- | --- |
| R1: source-kind counts bypass owner-scoped views | Closed | All four count-query branches use scoped_images; 70 search-repository tests pass |
| R2: photo-only changes omit the smart-collection dirty ledger | Closed | Already-dirty scopes gain collection invalidation; repeated UPSERT, owner boundaries, and suppression verified |
| R3: Maintenance viewer omits Image Kind correction | Closed | Active viewer correction/Automatic restoration updates state after persistence; Removed stays read-only; 94 related tests pass |

Independent Standards and Spec closure reviews are clean. Product acceptance on the owner's desktop catalog remains separate from these engineering checks.

## Verification and handoff

- Latest remote main confirmed as 20cd2390 at handoff; it is an ancestor of this branch.
- Full frontend suite: 279 files, 3,377 passed, 1 intentional skip. Full native suite: 947 passed, 4 ignored.
- Strict TypeScript, ESLint, Rust formatting, generated binding drift, version consistency, and guarded production frontend build pass.
- Final QA-profile desktop debug/no-bundle build passes. The executable was not launched against an existing catalog.
- Isolated browser smoke passes at 2048, 1600, and 1280 widths: usable search, dropdown right of search, All initial default, Photos selection surviving reload, photo capture facts, current generated Metadata tab, and working privacy reveal. No browser console/page errors.
- Synthetic native tests cover fresh, current-main, and exact legacy-photo migration histories, fail-closed ambiguous history, owner boundaries, photo removal/restoration, and thumbnail candidate compatibility. No source files or real catalogs were modified.

Owner acceptance: run `pnpm run app:qa` from this worktree to use the existing QA profile. Check the imported photos, camera details, Image Kind correction, and persisted dropdown selection after restart. Do not run the QA prepare/cleanup commands unless intentionally resetting that profile. Real-catalog desktop startup, native media playback, signed installers, and updater behavior were not exercised in this integration; this is not release certification.

Deliberate follow-up: photo capture facts still appear in both Details and Library. Consolidating that presentation is a separate UX decision, not part of restoring compatibility with main.
