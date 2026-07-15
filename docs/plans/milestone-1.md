# Milestone 1 — Integrate and Simplify Privacy Persistence Hardening

Status: Complete; milestone integration gate passed
Approved: 2026-07-15
Safety snapshot: `fix/privacy-persistence-hardening-snapshot` at `3a1d15a`

## Goal

Make privacy keyword persistence durable without merging the existing 91-file
hardening snapshot as one architectural change. Preserve the validated work,
extract the required core fix, and integrate the broader purge and privacy-index
guarantees as independently reviewable packages.

## Work Package 1 — Core Privacy Keyword Persistence

Primary invariant: once a settings mutation reports success, no older save,
startup default, quick shutdown, or interrupted write can replace it.

Implementation:

- Serialize repository `load`, `save`, and `update` operations.
- Recover `library.json` through pending, commit-marker, main, and backup files.
- Convert settings, recent-search, sync-snapshot, onboarding, and reset writes to
  atomic repository updates.
- Gate settings persistence until initialization completes and flush on close.
- Confirm Privacy edits only after persistence; roll back only the affected field.
- Preserve or seed onboarding keywords and reset factory defaults explicitly.
- Restore the exact previous persistence-admission state if window close fails.

Non-goals:

- No Rust commands, generated bindings, or Cargo dependency changes.
- No crash-atomic transaction spanning `library.json` and SQLite.
- No fail-closed privacy-index rendering changes.
- No application-wide database mutation registry.

Verification:

- Focused repository, settings-store, Settings/Search context, Privacy,
  onboarding, and purge-reset tests.
- `pnpm run test:run`, `pnpm run typecheck`, `pnpm run lint`, and
  `git diff --check`.

Completion criteria:

- The package passes independently from the original base commit.
- The change retains the existing `maskedKeywords` key and `AppSettings` shape.
- The package is committed as `fix: harden privacy keyword persistence`.

Completion record (2026-07-15):

- Focused repository/Search/provider tests: 112 passed, 1 skipped.
- Focused settings/close/Privacy/onboarding/app tests: 85 passed.
- Full frontend suite: 2,633 passed, 1 skipped across 231 files.
- `pnpm run typecheck` and `pnpm run lint` passed.
- No Rust commands, generated bindings, or persisted settings keys changed.

## Work Package 2 — Simplified Crash-Recoverable Factory Purge

Primary invariant: before the native commit marker neither JSON nor SQLite reset
is committed; after the marker startup completes both or retains recovery
evidence for retry.

Implementation:

- Replace the two-step prepare/accept/cancel protocol with one native
  `schedulePurgeTransaction(transactionId, journalJson)` command.
- Commit an immutable purge journal and matching restart marker atomically in one
  native operation.
- Recover and delete SQLite before SQL initialization, then materialize the JSON
  reset through the normal `library.json` commit protocol.
- Relaunch packaged builds and exit development builds immediately after commit.
- Keep only localized watcher/sync/import cancellation; remove the global
  mutation registry and peripheral wrappers.
- Scope storage locking to the relevant profile group so development and
  installed builds can run concurrently.

Non-goals:

- No owner IDs, leases, or native cancellation-result types.
- No process-wide registry of every UI, cache, or database mutation.
- No privacy-index presentation changes.

Verification:

- Rust and TypeScript recovery tests for every journal/marker/restart boundary.
- Packaged Windows kill/restart checks and dev/release concurrency checks.
- Bindings drift, Cargo formatting/check, Rust tests, and focused frontend purge
  tests.

Completion criteria:

- Factory purge is crash-recoverable without the broad mutation sweep.
- The package is committed as `fix: make factory purge crash-recoverable`.

Completion record (2026-07-15):

- Native recovery suite: 31 profile/migration tests passed; full Rust suite:
  397 passed, 1 ignored.
- Focused repository/watcher/purge/bindings suite: 84 passed, 1 skipped.
- Full frontend suite: 2,638 passed, 1 skipped across 231 files.
- Bindings drift, Cargo formatting/check, TypeScript, lint, and diff checks
  passed.
- Packaged kill/restart testing was not run against the shared installed user
  profile; every journal/marker/receipt interruption boundary and dev/installed
  profile isolation were exercised with deterministic filesystem tests.

## Work Package 3 — Fail-Closed Privacy Index With Recovery UX

Primary invariant: while Privacy Mode is enabled, content derived from a stale
privacy index is never rendered.

Implementation:

- Keep latest-request-wins privacy-index refresh coordination without purge
  coupling.
- Track `pending`, `ready`, and `failed` readiness with an error message.
- Block privacy-sensitive queries and surfaces until ready.
- Show a persistent failure state with an explicit retry action.
- Keep Settings accessible; explicitly disabling session Privacy Mode unblocks
  content and re-enabling it starts a fresh refresh.

Non-goals:

- No stale-data fallback while Privacy Mode is active.
- No persisted settings-schema changes.
- No global database mutation coordination.

Verification:

- Pending, failure, retry, latest-keyword-wins, explicit-disable, and rendered
  exposure tests across search, thumbnails, maintenance, ranges, and comparison.

Completion criteria:

- Failure is safe and recoverable without restarting Ambit.
- The package is committed as `fix: fail closed during privacy index refresh`.

Completion record (2026-07-15):

- Latest-request-wins refreshes keep the shared state `pending` until the native
  index, thumbnail/facet caches, query invalidations, and collection refresh are
  complete; failures remain `failed` with an explicit retry.
- Search queries/results, parameter ranges, thumbnails, gallery/dashboard,
  maintenance, viewer, comparison, and bulk-selection surfaces fail closed while
  Privacy Mode is enabled and the index is not ready.
- Explicitly disabling session Privacy Mode unblocks content; re-enabling it
  returns to `pending` and schedules a fresh refresh.
- Focused store, coordinator, Search, range, thumbnail, Privacy, layout,
  comparison, and viewer suite: 118 tests passed across 10 files.
- Full frontend suite: 2,648 passed, 1 skipped across 232 files.
- `pnpm run typecheck`, `pnpm run lint`, and `git diff --check` passed.

## Milestone Integration Gate

After all three packages are independently review-clean:

- Perform a separate integration review against the safety snapshot so every
  retained guarantee and intentionally removed mechanism is accounted for.
- Run full frontend tests, Rust tests, typecheck, lint, binding checks, Cargo
  formatting/check, release verification, and `git diff --check`.
- Run the rendered Settings → Privacy → add/remove keyword → close/reopen smoke
  test with no console errors.
- Retain the safety branch until the integrated result is accepted.

Completion record (2026-07-15):

- Reconciled the integrated branch against safety snapshot `3a1d15a`. Retained
  serialized/journaled settings persistence, close-time flushing, simplified
  purge recovery, and fail-closed privacy-index readiness. Confirmed the broad
  owner leases, global mutation registry, storage lock, and prepare/accept/cancel
  purge protocol were intentionally removed.
- Closed three integration gaps: same-profile processes are excluded before SQL
  opens while development and installed profiles remain independent; Missing
  maintenance thumbnails receive the active masked keywords; and Privacy saves
  finish correctly after React Strict Mode replays their lifecycle effect.
- Full frontend suite: 2,650 passed, 1 skipped across 232 files. Focused Privacy
  regression suite: 9 passed. Full Rust suite, release Tauri build, production
  frontend build, binding drift check, typecheck, lint, Cargo formatting/check,
  and diff checks passed.
- The combined `verify:release` wrapper exceeded its execution window, so its
  constituent gates were run independently; all completed successfully.
- Rendered browser verification passed for Settings -> Privacy -> add/remove
  keyword -> confirmed persistence toast -> close/reopen. The saved state was
  correct after reopening, no QA keywords remained, and no browser warnings,
  errors, or framework overlay were present.

## Selected Defaults

- Simplify before merging rather than merge the current architecture unchanged.
- Keep privacy fail-closed and add visible retry.
- Allow development and installed builds to run concurrently.
- Preserve the existing persisted settings shape; no migration is introduced.
