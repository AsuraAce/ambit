# Photography optional-count startup isolation

Status: Implementation verified; native QA owner confirmation pending

## Outcome

Dropdown counts must never delay or fail gallery readiness. Keep existing result totals, pagination, owner/privacy admission, and the approved toolbar design unchanged.

## Bounded change

- Move contextual scope counts out of native and browser-mock page retrieval into a separate React Query hook.
- Start contextual counts and library-wide availability only after a settled safe first page, including an empty page.
- Isolate cache identity by effective filters, smart-collection rules, library revision, and owner/privacy scope. Unknown counts remain unknown; stale-scope replies cannot populate the current scope.
- Offer dropdown-only count error/retry presentation without retrying image retrieval or successful counts.

No SQL, indexes, parsers, migrations, settings, or specialist metadata expansion. The pre-existing asset helper and experimental smart-collection migration remain outside this fix. No automatic main merge or release.

## Acceptance

- Permanent slow/rejected-count regressions; background-query admission, retry, stale-response, invalidation, and privacy/owner coverage.
- Browser/native semantics, keyboard operation, scope restoration, and virtualized browsing remain intact.
- Frontend tests, TypeScript, lint, build, and independent lifecycle/privacy review.
- Existing isolated QA-profile smoke without resetting its catalog or modifying source photos. Timings are observations, not a claimed speedup without a comparable baseline.

## Finding ledger

| Finding | Disposition | Evidence |
| --- | --- | --- |
| Optional contextual counts block/fail the first page | Fixed and verified | Pending and rejected count regressions failed before the change and pass after separation. |
| Availability starts before a safe page | Deferred with contextual counts | Provider admission regression failed before the change and passes after gating. No measured performance attribution. |
| Duplicate asset helper | Out of scope | Present on main before photography changes. |
| Forced gallery refresh leaves separated counts fresh | Fixed; independent closure clean | Both count families are invalidated without eager refetch/await. Regression failed before the fix and passes after. |
| Live Watch leaves counts fresh when no facets change | Fixed; independent closure clean | Invoke and generic Live Watch mark both count families stale. Four provider-stack regressions cover delayed and immediate gallery responses; the safe-page completion effect also handles batched loading transitions without blocking the gallery or cancelling running counts. |

## Verification and remaining acceptance

- Frontend after Live Watch closure: 298 files, 3,632 tests passed, one intentional skip. Lint, TypeScript, and production frontend build pass. Existing jsdom navigation notice and Vite plugin-timing notices remain non-failing.
- Independent Standards/lifecycle/privacy review and Specification review are clean after focused closure of the forced-refresh finding.
- The subsequent Live Watch finding and fast-page timing edge both reproduced before their fixes. Focused provider checks pass 143 tests with one intentional skip, and independent Standards and Specification closure reviews are clean. No native smoke or startup measurement was performed for this follow-up; the owner confirmation below remains pending.
- Browser-only smoke: Photos → Videos → Images restores Photos, reload preserves the scope, zero-result searches retain available categories, and dark/light 1600px plus compact 1050px toolbar checks pass. Captures are local under `output/playwright/count-isolation-*`. The final isolated browser session has no console errors. An earlier shared-server hot-reload run hit duplicate-root errors; fresh isolated-server runs did not reproduce them.
- The existing QA app/server stopped during verification. The native owner smoke question is outstanding; no native relaunch or startup-time comparison is claimed. A read-only QA catalog query reported 146,218 generated, 617 Other, and three photo records, so the historical 618-item library is not a comparable timing baseline. No QA reset, source-photo write, or catalog mutation was performed by this work.
- Rust, generated bindings, and the full release gate were not rerun for this frontend-only fix. The release gate remains required before proposing main merge. No merge or release is authorized here.
