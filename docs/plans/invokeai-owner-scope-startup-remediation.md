# InvokeAI Owner-Scope Startup Remediation

Status: Work Packages 1 through 3 release-verified (`2026-07-28`); Work Packages 2 and 3 owner acceptance pending

## Context

This is a UX and performance remediation workstream for the completed InvokeAI
owner-scope capability. It is separate from the completed eight-package
InvokeAI image-assets roadmap and from the numbered ComfyUI milestones.

An InvokeAI owner-schema upgrade could previously let the library render while
visibility reconciliation was still running. During that interval, counts,
boards, filters, and asset lists could appear empty or contradictory, while the
only progress indication lived in Settings and used implementation language.

## Outcome and acceptance criteria

- Never present a partially owner-scoped library as ready.
- Explain upgrade work in user language and explicitly state that no images or
  collections are being deleted.
- Show real progress when a bounded reconciliation is running.
- Avoid broad source and visibility reconciliation on ordinary unchanged
  startups.
- Use one authoritative visible-image count in the library header.
- Keep recovery deterministic when owner selection, source access, or
  persistence fails.

## Locked product decisions

- Discovery and application of an already resolvable owner scope use a blocking
  library preparation gate. The normal library is mounted only after the scope
  is ready.
- A required owner choice is a separate blocking decision state.
- Previously trusted local data may remain available when the InvokeAI source
  is temporarily offline, with a clear warning. Ambit must not silently replace
  the trusted scope with another one.
- An error must offer an explicit recovery path; indefinite spinners and
  partially filtered library state are not acceptable.
- Scope changes remain non-destructive. Hidden records and collections stay in
  Ambit's database and return when their scope becomes visible again.

## Work Package 1: Trustworthy automatic startup

Status: Accepted

Primary invariant: Ambit either shows a coherent library for the active owner
scope or shows a truthful preparation gate, never a mixture of both.

Scope:

- add a native same-scope no-op before image-table visibility work;
- discover owner counts with one grouped source query;
- reconcile broad source facts only when the saved import schema/scope snapshot
  requires it;
- expose real discovery, reconciliation, and cache-refresh progress;
- gate the library during automatic discovery/application;
- use the authoritative query count in the library header;
- confirm successful one-time upgrade work without implying deletion.

Non-goals:

- no owner-selection redesign;
- no offline trusted-data recovery UI;
- no change to owner-scope semantics or InvokeAI authentication;
- no Figma deliverable.

Targeted verification:

- unchanged-scope and forced native reconciliation tests;
- owner discovery and source-reconciliation service tests;
- Sync context admission, progress, snapshot, and orphan-recovery tests;
- gate, settings status, App orchestration, and count-source tests;
- rendered startup journey, TypeScript, bindings, Rust formatting, and release
  regression gates.

Completion criteria:

- unchanged restarts do not perform the broad owner visibility/source pass;
- upgrade startup keeps library surfaces hidden until reconciliation and cache
  refresh complete;
- the visible progress and completion copy are accurate and non-destructive;
- focused and integration checks pass.

Evidence:

- focused frontend coverage passes 163 tests with one existing skip across
  discovery, owner application, startup admission, the library gate, settings,
  App orchestration, counts, snapshots, and orphan recovery;
- the targeted native regression proves unchanged scope returns before the
  image-table repair pass while an explicit forced refresh repairs drift;
- generated bindings, Rust formatting, and whitespace validation pass;
- rendered Browser QA verifies the gate replaces the library, reports 640 of
  2,000 items through an accessible progressbar, has no console warnings or
  errors, fits a 394 CSS-pixel viewport without horizontal overflow, and
  returns to an interactive Assets view after readiness;
- `pnpm run verify:release` passes version and binding checks, lint, TypeScript,
  the 434 kB startup-bundle guard, all 3,018 frontend tests with one existing
  skip at 98.43% statement coverage, all 557 Rust tests with one ignored, and
  the optimized no-bundle Tauri build.

### Review closure (`2026-07-28`)

The Assure review/remediation loop is closed with no remaining Work Package 1
blocking findings. The explicit Work Package 2 selection, offline, and error
recovery scope remains planned rather than being silently absorbed here.

| Finding | Severity | Disposition | Verification |
| --- | --- | --- | --- |
| A configured library could render once while owner discovery was still `idle`, or while ready state belonged to a previous InvokeAI root. | Blocking | Fixed by treating configured idle and root mismatch as guarded startup states. | App orchestration covers idle, stale-root, ready-root, and case-sensitive POSIX roots. |
| A crash after durable scope selection but before cache refresh could leave stale counts, facets, or collections on the next no-op startup. | Blocking | Fixed by refreshing derived library caches whenever the saved scope snapshot requires reconciliation, even if no rows changed. | Sync integration verifies a zero-row reconciliation still rebuilds derived caches before readiness. |
| A crash after source facts were committed but before visibility was applied could make the next same-scope startup skip visibility repair. | Blocking | Fixed by forcing visibility validation whenever source reconciliation is requested; trusted unchanged startups retain the native fast path. | Owner-scope service coverage verifies forced validation after a zero-update reconciliation; the native fast-path/forced-repair test passes. |
| First-time configuration could show an inaccurate upgrade-complete toast, and progress exposed implementation language. | Non-blocking UX | Fixed by limiting the completion toast to pre-existing synchronized libraries and mapping progress to user-facing copy. | Sync, gate, settings, and service tests cover fresh setup, legacy upgrade, counts, and copy. |
| Lowercasing configured roots could treat distinct case-sensitive filesystem paths as one installation. | Non-blocking portability | Fixed with normalized exact root comparison; discovery preserves configured casing. | App orchestration covers differently cased POSIX roots. |

Closure evidence: the focused review suite passes 115 tests with one existing
skip; TypeScript, lint, native owner-scope regression, and whitespace checks
pass; the repeated release gate passes 3,018 frontend tests with one existing
skip, 98.43% statement coverage, all 557 Rust tests with one ignored, binding
and version checks, the 434 kB startup-bundle guard, and the optimized Tauri
build.

## Work Package 2: Selection, offline, and error recovery

Status: Implemented and release-verified; owner acceptance pending

Primary invariant: every non-ready admission state gives the user a clear,
safe next action without exposing an ambiguous library.

Scope:

- replace the settings-only multi-owner dead end with an in-context owner
  decision flow;
- distinguish first-time setup, owner change, source unavailable, and failed
  reconciliation;
- allow trusted local data to remain usable during temporary source outages
  with a persistent warning and retry path;
- add explicit retry/open-settings recovery for blocking failures;
- verify focus, keyboard, restart, and large-library behavior.

Non-goals:

- no automatic owner guessing when multiple owners exist;
- no destructive cleanup or cross-owner data merging;
- no expansion of the completed InvokeAI metadata roadmap.

Final acceptance is a desktop journey covering first upgrade, normal restart,
multi-owner selection, temporary offline startup, retry after failure, and
scope change without missing or deleted Ambit records.

Evidence:

- trusted offline admission requires an exact configured root, current import
  and path-repair versions, a matching saved legacy/All users/owner scope, and
  the same native visibility-state row;
- source discovery failures may open that verified view, while failures after
  visibility, persistence, or cache work begins remain blocking and never fall
  back to potentially ambiguous data;
- owner selection is available in the startup gate and Settings through one
  shared selector; an owner applies immediately, while All users explicitly
  confirms that unassigned rows are included;
- blocking failures use plain-language copy with Retry, Open Settings, and
  collapsed technical details; verified offline mode keeps the authoritative
  library mounted under a persistent non-dismissible warning while Sync and
  Live Watch remain paused;
- recovery success starts startup catch-up automatically, and same-event
  coverage proves a newly persisted owner cannot be re-read as a stale
  unselected setting;
- focused recovery coverage passes 165 tests with one existing skip across the
  trusted-state service, Sync context, startup gate, Settings, and App
  orchestration, including path normalization and synchronization controls;
- rendered Browser QA confirms the normal shell is interactive, console-clean,
  and free of horizontal overflow at approximately 398 and 431 CSS-pixel
  viewports;
  native source-failure states are verified deterministically in component and
  integration tests because browser mock mode cannot open a real InvokeAI DB;
- `pnpm run verify:release` passes version and binding checks, lint, TypeScript,
  the 445 kB startup-bundle guard, all 3,039 frontend tests with one existing
  skip at 98.4% statement coverage, all 557 Rust tests, and the optimized
  no-bundle Tauri build.

### Review closure (`2026-07-28`)

The Assure review/remediation loop is closed with no known blocking Work
Package 2 findings. The remaining acceptance step is the owner's real-data
desktop journey described above.

| Finding | Severity | Disposition | Verification |
| --- | --- | --- | --- |
| The prior error path rendered a client-filtered current page, producing incomplete counts and an ambiguous library. | Blocking | Removed the emergency page filter. Selection and errors now gate the whole workspace; only an exact-root verified offline state may render the authoritative query result. | App orchestration covers idle, selection, error, exact-root offline, stale-root offline, counts, gallery data, and modal data. |
| A source outage needed to preserve useful local data without authorizing new InvokeAI reads or mutations. | Blocking | Added fail-closed trusted-scope verification and an `offline_ready` admission whose sync permission remains false. Discovery-only failure can use it; preparation failures cannot. | Trusted-state and Sync integration coverage exercises matching and mismatched snapshots, state rows, roots, selections, retries, and post-mutation failure. |
| Selecting an owner and immediately starting catch-up could observe the pre-selection React ref before its render committed. | Blocking race | Synchronized the mutable settings admission ref with the already-committed Zustand state before selection resolves. | Same-event integration coverage selects an owner and starts catch-up without a second discovery or unselected application. |
| Settings was the only place to understand or recover from owner admission. | Non-blocking UX | Added an in-context selection gate, persistent offline warning, actionable blocking errors, shared selection controls, focus management, and explicit All users confirmation. | Gate, Settings, and App tests cover copy, focus, confirmation, retry, catch-up, and Open Settings behavior. |
| A whitespace-only or padded configured path could be treated as configured by the App gate but unconfigured by Sync, leaving an indefinite preparation screen. | Blocking | Normalized InvokeAI roots now trim surrounding whitespace and collapse whitespace-only values to no configuration. | Path utility and App orchestration tests cover padded roots and the whitespace-only startup journey. |
| A stale `offline_ready` state that did not match the configured root could render the busy gate without an operation or recovery action. | Blocking | `offline_ready` is no longer classified as active preparation; a non-admissible offline state renders the actionable failure gate. | Gate coverage verifies the stale offline state exposes Retry instead of a status spinner. |
| Settings described an offline retry as both library preparation and verified-offline recovery at once. | Non-blocking UX | Kept retry as a control-locking state while limiting the standalone progress panel to discovery and application. | Settings coverage verifies the offline card owns retry progress without duplicate preparation copy. |
| Re-clicking the already selected owner or All users option started an unnecessary catch-up. | Non-blocking performance/UX | Selected scope controls now behave as no-ops; manual synchronization remains the explicit refresh action. | Shared-selector coverage verifies neither selection application nor startup catch-up is called for either selected option. |

Follow-up closure evidence: the focused recovery suite passes 165 tests with one
existing skip; lint, TypeScript, and whitespace validation pass; rendered QA
loads the browser-mock library, activates Assets, reports no console warnings or
errors, and has no horizontal overflow at 431 CSS pixels; the repeated release
gate passes all 3,039 frontend tests with one existing skip, 98.4% statement
coverage, all 557 Rust tests, the 445 kB startup-bundle guard, binding and
version checks, and the optimized Tauri build.

## Work Package 3: Large-library startup completion

Status: Implemented and release-verified; owner acceptance pending

Primary invariant: while a configured InvokeAI library is not admitted, Ambit
does not start library queries against an unresolved visibility state; when
preparation is required, the work scales predictably and reads as one
continuous startup journey.

Scope:

- establish one transient owner-admission state and shared root/status
  predicate for App, Sync, and Search orchestration;
- pause image, statistics, facet, parameter-range, privacy-index, and initial
  hidden-content queries until the configured root is ready or verified for
  offline use, and cancel already-running work if admission closes;
- make batched keyword statistics observe React Query cancellation;
- replace ordinary InvokeAI source reconciliation offsets with rowid keyset
  pagination while retaining a compatibility fallback for unexpected
  `WITHOUT ROWID` source tables;
- report truthful indexing, mapping, legacy-path, detail, visibility, and cache
  refresh phases without exposing paths, owners, prompts, or per-row details;
- present database maintenance and InvokeAI reconciliation with one shared
  `Preparing Ambit` card, including accessible determinate and indeterminate
  progress states.

Non-goals:

- no SQLite migration, native command, generated binding, persisted setting,
  owner-scope semantic, or metadata-extraction change;
- no destructive cleanup or resetting of a user's completed owner snapshot;
- no expansion of the completed InvokeAI metadata roadmap or the separate
  ComfyUI milestones;
- no Figma or new visual-concept deliverable.

Targeted verification:

- admission tests for no configured root, unresolved and stale roots, ready
  roots, verified offline roots, root changes, and active query cancellation;
- keyword-batch abort coverage and reconciliation tests for keyset pagination,
  compatibility fallback, collisions, aliases, references, cancellation, and
  retry;
- phase-message propagation and shared startup-card component coverage;
- rendered desktop and narrow startup journeys checking progress semantics,
  clipping, layout shift, overflow, interaction recovery, and console health;
- read-only real-source timing and next-restart fast-path checks where the
  existing local snapshot permits them;
- lint, TypeScript, whitespace, focused frontend coverage, release
  verification, and an Assure review/remediation closure pass.

Completion criteria:

- configured unresolved InvokeAI startup cannot launch library-derived queries
  or briefly render misleading counts and filters;
- ordinary reconciliation uses cursor pagination and exposes visible movement
  from its first materially expensive phase;
- database and InvokeAI preparation appear as successive phases of the same
  startup experience, without a detached decorative spinner;
- unchanged completed snapshots retain the ordinary fast startup path;
- no known blocking correctness, data-integrity, compatibility, or startup UX
  findings remain after closure review.

Evidence (`2026-07-28`):

- an expanded focused frontend run passes 230 tests across 11 files; the full
  library integration suite passes 67 tests with its one existing skip;
- admission, root-change cancellation, parameter-range gating, keyword-batch
  abort propagation, keyset paging, compatibility fallback, and unrelated
  source-probe error coverage all pass;
- the browser-mock journey loads at 431 CSS pixels without horizontal overflow
  or console warnings/errors, and the Assets surface remains interactive after
  startup settles;
- read-only source evaluation confirmed the existing InvokeAI `images` table is
  rowid-capable with 154,719 rows. A representative deep-page comparison during
  planning measured the former offset query at about 8.17 seconds and the rowid
  keyset query at about 48.5 milliseconds; these are feasibility timings, not an
  end-to-end startup benchmark;
- `verify:release` passes all 3,058 frontend tests with one existing skip,
  98.38% statement coverage, all 557 Rust tests, the 447 kB startup-bundle
  guard, version and generated-binding checks, and the optimized no-bundle
  Tauri build.

Closure review:

- library queries could begin before owner admission: fixed with one shared
  root/status predicate, query gating, and cancellation when admission closes;
- Search and parameter consumers initially subscribed to the full progress
  object: fixed with derived admission selectors so progress ticks do not fan
  out through query orchestration;
- initial hidden-content availability could be requested twice at admission:
  fixed by removing the pre-admission refresh and retaining the admitted catch-up;
- the first compatibility implementation could have hidden unrelated source
  errors: fixed so fallback occurs only for the specific missing-rowid error;
- the former first reconciliation pass had no visible movement and used offset
  paging: fixed with named phases and rowid keyset cursors;
- database and InvokeAI maintenance had separate visual language and a detached
  spinner: fixed with the shared `Preparing Ambit` card and accessible progress;
- closure review found that a source shrinking after its initial count could
  make the detail pass reread a short terminal batch: fixed by terminating both
  reconciliation passes consistently on a short page;
- closure review found that privacy preparation waiting for database readiness
  could start after owner admission closed: fixed with cancellation checks before
  and after database readiness. The affected closure suite passes 312 tests with
  one existing skip, plus lint and TypeScript checks.

No blocking finding remains. A real native first-upgrade/retry/fast-restart
replay remains owner acceptance because reproducing it would require resetting
or replacing the user's completed owner snapshot, which is explicitly outside
this package.
