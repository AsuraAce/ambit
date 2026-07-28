# InvokeAI Owner-Scope Startup Remediation

Status: Implementation complete and release-verified (`2026-07-28`; Work Package 2 owner acceptance pending)

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
- focused recovery coverage passes 139 tests with one existing skip across the
  trusted-state service, Sync context, startup gate, Settings, and App
  orchestration;
- rendered Browser QA confirms the normal shell is interactive, console-clean,
  and free of horizontal overflow at an approximately 398 CSS-pixel viewport;
  native source-failure states are verified deterministically in component and
  integration tests because browser mock mode cannot open a real InvokeAI DB;
- `pnpm run verify:release` passes version and binding checks, lint, TypeScript,
  the 445 kB startup-bundle guard, all 3,036 frontend tests with one existing
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
