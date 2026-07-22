# Milestone 25: Ambit 0.9.0 UX Release Readiness

Status: In Progress

## Reconciliation

- Search transitions must preserve the manual's promise that current results remain visible while a valid search is applied.
- Prompt keyword masking configuration is lightweight persisted state in `library.json`; session Privacy Mode remains fail-closed and enabled at startup.
- Smart Collections use dynamic thumbnails selected from matching library images; custom thumbnails retain precedence.
- Exact-duplicate groups remain virtualized cards and keep their existing conservative resolution behavior.
- Release Please remains responsible for the eventual 0.9.0 version and changelog update.

## Objective

Remove the confirmed release-smoke trust failures without broadening search semantics, privacy scope, Smart Collection behavior, or duplicate resolution policy.

The milestone is accepted when search never reports a false empty state, prompt masking can be disabled without deleting keywords, replaying the setup guide cannot overwrite untouched privacy settings, action tooltips dismiss after activation, new Smart Collections hydrate a matching thumbnail, every duplicate copy is discoverably reachable, and the full release gate passes.

## Work Package 1: Stable Search Transitions

Status: Complete (`fix/search-pending-state`, manual-smoke amendment, 2026-07-19)

Primary invariant: Empty Library and No Matches appear only after the latest search has settled.

Scope:

- Retain previous query data through every search-key transition, including previously empty results.
- Treat draft debounce, first-page fetching, and placeholder data as one pending lifecycle.
- Preserve existing images while searching and use a neutral skeleton only when no previous images are available.
- Show an explicit non-blocking spinner and subtle search-field glow while retained results remain interactive.
- Keep an open viewer bound to the result session it was opened from while replacement results arrive.
- Verify the same retained-results and zero-result skeleton behavior inside collections.
- Keep the known global library count stable until the latest query settles.
- Add regressions for nonempty and empty previous results, cached refetches, rapid typing, and settled empty results.

Non-goals:

- No search syntax, SQL matching, debounce-duration, sort, or pagination redesign.
- No modal or blocking overlay while existing results remain available.

Targeted verification:

- SearchBar, AppLayout, SearchContext, and useImagesQuery tests;
- manual search smoke against a populated library;
- `pnpm run typecheck` and `git diff --check`.

Completion criteria:

- no pending frame can display Empty Library, No Matches, Import Images, or `0 Library`;
- existing results remain visible until their replacement is ready;
- settled zero-result and truly empty-library states remain correct.

Verification evidence:

- privacy-compatible placeholder pages now survive ordinary search, sort, and collection transitions, including zero-result pages;
- privacy-setting changes reject placeholder pages, and masking-mode transitions clear stored results until current-scope data arrives;
- first-page refetches report a continuous searching state while pagination remains independent;
- 147 focused SearchBar, AppLayout, App viewer-session, useAppActions, SearchContext, and useImagesQuery tests passed;
- `pnpm run typecheck`, `pnpm run lint`, and `git diff --check` passed;
- browser-mock QA confirmed retained gallery and collection results stay interactive with an accessible spinner, subtle search-field glow, and `SEARCHING...` count state;
- a viewer opened from retained collection results stayed bound to its original image and navigation session after the replacement query settled with no matches;
- Settings lazy-loaded successfully from `http://localhost:1422` with no console errors while Yomikata retained its 1421 extension bridge;
- the populated desktop-library smoke is reserved for the combined Work Package 5 gate so this package does not launch against the user's live profile.
- Ambit development uses port 1422 so it can run alongside Yomikata's fixed 1421 extension bridge.

## Work Package 2: Non-Destructive Prompt Keyword Masking

Depends on: Work Package 1.

Status: Complete (`fix/prompt-masking-toggle`, 2026-07-19)

Primary invariant: disabling prompt-keyword masking never deletes the configured keyword list.

Scope:

- Add a persisted `promptMaskingEnabled` setting with backward-compatible legacy inference.
- Expose the same switch in onboarding and Settings > Privacy.
- Use an empty effective keyword set while disabled while retaining stored keywords.
- Preserve manual image masks and the immediate session Privacy Mode protection gate.

Non-goals:

- No changes to blur-versus-hide behavior, session Privacy Mode defaults, or Rust command signatures.

Targeted verification:

- settings persistence, onboarding, Privacy tab, search privacy-index, and masking utility tests.

Completion criteria:

- disabling, restarting, and re-enabling restores the same custom keywords and masking behavior.

Verification evidence:

- fresh installs and factory resets enable prompt-keyword masking with the default keyword list;
- legacy settings infer the independent toggle from whether the saved keyword list is empty, while an explicit saved toggle always wins;
- disabling uses an empty effective keyword set without mutating the stored list, and the list remains editable while inactive;
- re-enabling an empty list keeps it empty instead of silently restoring defaults, while manual image masks remain effective;
- privacy-index rebuilds occur only when the effective keyword set changes;
- 339 focused settings, onboarding, persistence, search, query, layout, context-menu, collection-operation, and masking tests passed;
- `pnpm run typecheck`, `pnpm run lint`, and `git diff --check` passed;
- rendered browser QA remains a manual check because the in-app browser kernel failed before it could open Ambit; no user-owned development server was stopped or replaced.

## Work Package 2A: Privacy Clarity and Safe Setup-Guide Replay

Depends on: Work Package 2.

Status: Complete (`fix/prompt-masking-toggle`, 2026-07-21)

Primary invariant: reopening setup changes only controls the user explicitly changes and never resets saved keywords, masking behavior, or unrelated settings.

Scope:

- Present Privacy Mode as the session master over manual masks and the optional prompt-keyword source.
- Keep prompt keywords editable while disabled and explain that Blur/Hide applies to both masking sources.
- Add a dismissible setup-guide replay under Help & Guide without changing `hasCompletedOnboarding`.
- Persist only guide controls explicitly touched; retain immediate saves from linked Settings pages and API-key verification.
- Remove the public onboarding reset and place the true first-run reset behind development-only Dev Tools confirmation.
- Preserve fail-closed gallery and collection-thumbnail gates whenever effective privacy rules change.

Non-goals:

- No search, privacy-motion, Smart Collection thumbnail, duplicate-navigation, Rust, SQLite, or persisted-settings schema changes.

Targeted verification:

- onboarding, App persistence, Help, Advanced/Dev settings, Privacy tab, privacy-index, gallery, and collection-thumbnail tests;
- focused manual replay and masking smoke;
- `pnpm run test:run`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check`.

Completion criteria:

- replay is dismissible through Close or Escape, ignores backdrop clicks, and preserves every untouched setting;
- first-run remains non-dismissible and owns the completion flag;
- the public UI clearly distinguishes the Privacy Mode master, manual masks, prompt-keyword matching, and shared Blur/Hide behavior;
- the package is independently review-clean before Work Package 3 begins.

Verification evidence:

- replay Close, Escape, backdrop, focus restoration, untouched-control, latest-settings merge, failure rollback, and first-run completion behavior are covered by focused component and App orchestration tests;
- Help & Guide routing, development-only reset confirmation, public reset removal, Privacy hierarchy copy, and sidebar accessibility are covered by focused tests;
- the complete frontend suite passed: 256 files, 2,875 tests passed, 1 skipped;
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check` passed;
- the full suite exposed and repaired a stale `countGlobalImages` mock in `LibraryIntegration.test.tsx`; no production library-query behavior changed;
- screenshot follow-up aligned both Privacy switches to fixed track geometry, represented manual masks as a non-toggle source that follows Privacy Mode, and compacted onboarding Step 4 without removing its small-window overflow fallback;
- the follow-up's 41 focused Privacy/onboarding tests, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check` passed;
- desktop smoke against the user's live library was not run to avoid mutating their development profile; the package's interaction paths were exercised through the focused UI tests.

## Work Package 2B: Context-Aware Tooltip Dismissal

Depends on: Work Package 2A.

Status: Complete (`fix/prompt-masking-toggle`, focus-restoration follow-up, 2026-07-22)

Primary invariant: activating an ordinary action never leaves its tooltip obscuring the resulting interface state.

Scope:

- Make click persistence opt-in for the shared tooltip button.
- Dismiss ordinary action tooltips after pointer or keyboard activation, even while the trigger retains focus.
- Keep an activated action tooltip dismissed when a modal restores focus to its trigger; allow a later deliberate hover or keyboard visit to show it again.
- Keep dedicated information tooltips click-persistent until blur, outside click, or Escape.
- Preserve hover, focus, positioning, accessibility association, event propagation, and modal focus behavior.

Non-goals:

- No dismissal timers, tooltip visual redesign, dependency changes, or individual action call-site migration.

Targeted verification:

- shared tooltip pointer, keyboard, information, modal, positioning, and accessibility tests;
- representative sidebar and action-control smoke;
- `pnpm run test:run`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check`.

Completion criteria:

- pointer, Enter, and Space activation execute an action once and close its tooltip;
- modal close restores focus to its launcher without reopening the dismissed action tooltip;
- fresh hover or a later keyboard focus can show the action tooltip again;
- information icons remain click-persistent and dismiss through the established accessible paths;
- the package is independently review-clean before Work Package 3 begins.

Verification evidence:

- click persistence is opt-in: ordinary tooltip buttons dismiss on pointer, Enter, or Space activation while dedicated information tooltips retain click persistence;
- an action that transfers focus into a modal suppresses the first restored-focus tooltip, while a later hover or keyboard visit shows it normally;
- actions that retain focus do not carry stale suppression into a later keyboard visit;
- focused shared-component, collection-toolbar, resource-toolbar, modal, and sidebar coverage passed, including retained focus, re-hover, blur, outside click, Escape, and dynamic label changes;
- the first full-suite run identified two tests that encoded the retired sticky-action behavior; both now verify dismissal followed by updated help on fresh hover or focus;
- the complete frontend suite passed: 256 files, 2,877 tests passed, 1 skipped;
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and `git diff --check` passed;
- rendered Browser smoke remains manual because the in-app browser-control runtime failed before connection with `failed to write kernel assets: The system cannot find the path specified`.

## Work Package 3: Initial Smart Collection Thumbnail Hydration

Depends on: Work Package 2B.

Status: Pending (`fix/smart-collection-initial-thumbnail`)

Primary invariant: every new Smart Collection attempts to establish a thumbnail from its own matches without first being opened or pinned.

Scope:

- Schedule one targeted summary refresh after creation, including prompt-search filters.
- Show the existing pending skeleton and retain pinned-then-newest selection, privacy-safe substitution, and custom-thumbnail precedence.
- Keep zero-match and failed lookups on the Smart Collection fallback without rolling back creation.

Non-goals:

- No generated thumbnails, arbitrary nonmatching images, or general startup-refresh redesign.

Targeted verification:

- collection operation and collection-store tests for metadata filters, prompt filters, zero matches, privacy, custom thumbnails, and failures.

Completion criteria:

- a newly created matching Smart Collection hydrates its thumbnail asynchronously without user selection.

## Work Package 4: Discoverable Duplicate-Group Navigation

Depends on: Work Package 3.

Status: Pending (`fix/duplicate-group-navigation`)

Primary invariant: every copy in an exact-duplicate group is visibly reachable and actionable.

Scope:

- Retain the compact two-preview horizontal layout.
- Add previous/next controls, endpoint states, scroll snapping, edge cues, a visible item range, and Left/Right keyboard navigation.
- Preserve native scrolling and existing View, Compare, and Keep Only This actions.

Non-goals:

- No wrapping layout, detail modal, detection changes, or resolution-policy changes.

Targeted verification:

- duplicate component tests for groups of 2, 3, 5, and larger; keyboard, buttons, range, resize, and action routing.

Completion criteria:

- all copies are discoverable and reachable without prior knowledge of horizontal scrolling.

## Work Package 5: Integration Review and 0.9.0 Release Gate

Depends on: Work Packages 1-4.

Status: Pending (`docs/release-0.9.0-readiness`)

Primary invariant: the combined fixes preserve large-library virtualization and fail-closed privacy behavior.

Scope:

- Update user documentation and reconcile `docs/progress.md` with current manifests.
- Run the combined manual smoke matrix and `pnpm run verify:release`.
- Record verification evidence and close this milestone before the Release Please version PR merges.

Non-goals:

- No manual version bump or unrelated release automation changes.

## Milestone Acceptance Gate

1. Confirm all four behavior packages are independently review-clean.
2. Repeat the search, onboarding, Smart Collection, duplicate, and Privacy Mode smoke flows.
3. Run `pnpm run verify:release` and `git diff --check`.
4. Update this plan with merged-package and verification evidence.
5. Confirm Release Please proposes 0.9.0 from the resulting conventional history.
