# Library scope dropdown UX

Status: Complete — implementation and isolated-browser acceptance; native owner acceptance remains separate
Date: 2026-10-08

## Outcome and boundaries

One bounded follow-up to the isolated dropdown audit. Preserve the approved toolbar design, independent optional counts, owner/privacy boundaries, virtualized browsing, settings hydration, and the native QA catalog. No parser, schema, settings-field, Rust API, dependency, migration, unrelated date-precedence, or broader filter redesign. No push, hosted Actions, merge, or release.

## Approved behavior

- Global media/kind choices only narrow saved smart-collection rules. Contextual counts exclude the dropdown choices, never saved media/kind rules. Native predicates and browser mocks agree, including exclusions.
- Entering any collection clears manual refinements and activates All Media, preserving the remembered image kind and existing view/sort settings. Deselecting only removes collection scope. Images restores the remembered kind; All Images clears it. Clear filters resets media/kind while retaining collection selection.
- Dormant image-kind memory is not a saved rule or manual edit. Normalize media/kind only at explicit collection create/update boundaries. Do not migrate existing collections. Compatible quick Update clears refinements without erasing remembered kind.
- Conflicting active media/kind constraints disable header Update and guard its handler. Explain: “This scope conflicts with the collection rules. Use Edit Filters to change them.” Keep the explanation keyboard-accessible and preserve explicit Edit Filters. Detect constraint conflicts, not empty results.
- Label the Images action as Images · Photos/Generated/Other when restoring that kind, with the matching count. All Images remains the explicit reset. Preserve label-only trigger, compact counts, exact accessible values, unknown dashes, active-only selection, and scope-safe settled-page fallback.
- Use a menu button with labelled groups of menuitemradio options. Normal opening focuses effective selection; trigger Down/Up opens first/last. Arrows wrap, Home/End reach endpoints, Enter/Space selects, Escape restores trigger. Tab/Shift+Tab close and continue focus traversal. Outside pointer/focus closes without stealing focus. Retry counts is keyboard-reachable. Refreshing counts preserves focus; removal of the focused option falls back to effective selection.

## Finding ledger

| ID | Severity | Finding | Disposition / verification |
| --- | --- | --- | --- |
| UX1 | P1 | Scope overrides locked smart rules; contextual counts contradict collection | Fixed; SQL/browser regressions cover intersection, contextual counts, exclusions and privacy. Browser photo collection stays at 26; conflicting Generated yields zero. |
| UX2 | P2 | Images label/count does not describe remembered-kind restoration | Fixed; label/count and scope-safe fallback regressions pass. Browser restores Photos with the matching 26 count. |
| UX3 | P2 | Collection entry loses kind but retains media asymmetrically | Fixed; entry/save/update regressions and browser navigation pass. Conflicting Update is guarded with a keyboard-accessible explanation. |
| UX4 | P2 | Tab leaves popup open; focus semantics inconsistent | Fixed; menu/focus regressions pass. Browser Tab/Shift+Tab close and move to the next/previous control; refresh preserves focus. |
| R1 (Spec) | P2 | Handled menu keys also reach gallery shortcuts | Reproduced in browser and a real-shortcut integration test; localized propagation fix verified by both independent closure reviews. |

## Verification gate

Test-first slices: collection boundaries, memory/saving, then menu semantics. Cover legacy scopes, search/favorites, exclusions, owner/privacy, compatible/conflicting Update, reload/reset, counts loading/failure/retry, focus refresh and option removal. Run targeted checks throughout, full frontend suite, TypeScript, lint, production frontend build, isolated browser journeys in both themes at 1280/1600/2048 and compact widths, and virtualized pagination. Independent implementation review and focused finding closure are required. Native QA owner acceptance remains separate; release verification is required again before proposing main merge.

## Evidence

- Baseline: branch `feat/photography-support`, HEAD `5b7b38a9`; only existing audit artifacts were untracked. No tracked edits at start.
- Audit captures and report: `output/playwright/dropdown-ux-audit-20261007/` (local-only).
- Final frontend gate: 3,672 tests passed with one intentional skip; TypeScript, lint and production frontend build passed. Existing pagination/cursor and count-isolation regressions remain green. No Rust or binding changes; the release gate was not rerun for this bounded frontend fix.
- Independent Standards and Specification reviews and focused closure are clean. R1 is closed; no blocking findings remain in this package.
- Isolated Playwright sample-browser journeys passed: Photos → All Media/Videos → Images, collection entry/deselection, compatible/conflicting Update, zero-search category retention, Clear filters, keyboard selection/exit, and preference reload after the existing settings-save debounce. The native QA catalog and source photos were not accessed or changed.
- Visual acceptance: both themes at 1280/1600/2048 px and compact 1100 px (684 px library workspace) preserve the approved single-row toolbar and readable, unclipped menu. Console: zero warnings/errors. Virtualized scrolling reached the sample-library end with 52 cards mounted versus 143 accessible items (57 at the top). The sample does not reach the 1,000-item page boundary; automated cursor tests cover it.

## Separate limitations and handoff

- Browser sample collections disappear on reload through the pre-existing shared startup migration/JSON mock-storage mismatch. Collection restart persistence was therefore not accepted from the browser run; the persisted scope preference itself passed. Recorded in `docs/refactor.md`; no startup or migration code changed.
- At an extra-narrow 1000 px window with the sidebar open, the development-only Browser Mock badge contributes to existing search/AI/scope crowding. The 1100 px compact and requested desktop widths passed. This follow-up did not alter toolbar sizing; track the demo-only presentation separately.
- Native QA owner smoke, a fresh release-verification gate and permission to publish remain before main-merge consideration. No push, hosted Actions, merge or release was performed.
