# Single-choice library scope

Status: Implementation verified; native owner acceptance pending
Date: 2026-10-08

## Outcome

Replace the overlapping media/kind groups with one explicit choice: All Media, All Images, Generated Images, Photos, Other Images, Videos. This supersedes the remembered-kind restoration behavior in `library-scope-dropdown-ux.md`, not its smart-collection, privacy, count-isolation, or keyboard safeguards.

## Contract

- Exactly one checked option; the trigger uses the same label without a visible count. Keep existing styles, compact menu counts and exact accessible values.
- Each selection atomically writes media/kind: all/all, image/all, image/generated, image/photograph, image/other, or video/all. No dormant image-kind memory.
- Reuse current settings and hydrate before queries/persistence. Legacy kind-only preferences infer Images; explicit All Media/Videos clear dormant kinds. No settings schema or database migration.
- Always retain All Media, All Images and the active option. Hide other categories only when accessible-library availability confirms absence; contextual zero results do not hide options.
- Preserve search and saved smart-collection constraints. Collection entry and compatible quick Update clear both manual scope values; Clear filters retains the collection; deselection only removes collection scope.
- Preserve independent optional counts, safe fallback totals, retry, focus retention and menu-key ownership. No SQL, parser, dependency, broader toolbar, startup or collection-migration changes.

## Verification and acceptance

Use test-first slices for the menu/callback, settings compatibility and collection reset boundaries. Verify all six choices, transitions, hydration/restart, counts, zero searches, smart rules, privacy and keyboard behavior. Run the full frontend suite, TypeScript, lint and production frontend build; obtain independent Standards and Specification review.

Use the authorized isolated Playwright browser (Browser plugin unavailable), both themes at 1280/1600/2048 and compact width, including longer labels and virtualized scrolling. Native QA owner confirmation remains separate; never reset the catalog or modify source photos. Update the manual and moving progress. No push, hosted Actions, main merge or release; a fresh release gate remains required before proposing merge.

## Evidence and findings

- Baseline: `0d17d8be`; only pre-existing `.playwright-cli/` and `output/` artifacts untracked.
- Test-first regressions reproduced the overlapping choices, dormant non-image kind persistence, and collection reset gaps before their fixes. The focused integration run passed 252 tests in 13 files.
- Full frontend verification: 3,682 passing tests plus one intentional skip in 298 files; TypeScript, lint, production frontend build and diff whitespace checks pass. No Rust/API/binding changes; the release gate was not rerun for this frontend slice.
- Independent Standards and Specification reviews are both CLEAN, including persistence compatibility, hydration admission, smart-rule intersections and optional-count isolation. No blocking findings remain.
- Isolated Chrome sample-data journeys pass: all six selections and exactly one checkmark; Photos (26) → Videos (8) → All Images (135); direct Photos return and reload persistence; zero-result search retains all available categories; Tab/Shift+Tab focus; collection entry, clear, deselection, compatible Update and conflicting-Update guard. All Images still returns 26 photos inside the saved photo-only collection.
- Both themes were visually inspected at 1280/1600/2048 and compact 1100 px, including the longest label. Virtualized scrolling reached the end of 143 accessible items while mounted cards changed from 57 to 52. Browser console: zero errors or warnings. The sample catalog does not cross the page-fetch boundary; pagination, late responses, retries and privacy transitions remain covered by automated regressions.
- Browser evidence is outside the repository in `C:/Users/Artemis/AppData/Local/Temp/ambit-single-scope-qa-20261008/`. Previously recorded browser-only collection-reload and extra-narrow mock-badge limitations remain out of scope; no native collection-restart claim is made.
- The owner asked for the design trade-offs rather than confirming the updated native journey. Native QA acceptance remains pending. The native catalog and source photos were not accessed or changed. No push, hosted Actions, main merge or release; the fresh release-verification gate and publication decision remain separate.
