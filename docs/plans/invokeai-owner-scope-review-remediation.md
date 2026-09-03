# InvokeAI Owner-Scope Review Remediation

Status: Complete (`2026-08-27`)

## Outcome

Keep Ambit's shared SQLite database and per-scope derived caches while making owner
admission authoritative, non-destructive, fail-closed, and fast on warm paths. A
separate database per InvokeAI user is intentionally not introduced.

## Invariants

- Owner scope changes never delete library rows, collections, memberships, or thumbnails.
- Individual owners see only rows and verified Invoke boards admitted for that owner.
- All users may include unassigned Invoke rows.
- Cache builds commit only the scope and generation they claimed.
- Raw tables remain synchronization, migration, and maintenance surfaces; user-facing
  writes validate against scoped views.

## Remediation ledger

| Finding | Severity | Disposition | Verification |
| --- | --- | --- | --- |
| Upgrade inference omitted removed memberships, wildcard-like roots could mis-scope copied rows, and malformed or non-array tombstone membership JSON could abort startup or invent ownership | Blocking | Migration 75 uses active and removed evidence, literal prefixes, accepts only JSON arrays of text IDs, repairs directly affected collections, and limits new inference to removed-only collections so deliberate global collections remain global | Migration 75 Rust fixtures, including malformed, scalar, and object JSON |
| Legacy JSON migration could replay, partially clear, overwrite collection identity, or retry forever when rows were hidden by the active owner scope | Blocking | A stable SQLite import receipt is committed atomically with one scope-independent native transaction; retries no-op before mutations; JSON cleanup remains retryable; conflict updates preserve source/owner identity and memberships include hidden active rows | Native replay-after-edit test plus collection store and repository retry tests |
| Activation returned a repair plan that could be stale before cache build, and an interrupted process could strand a persisted build | Blocking | Atomic, session-owned build claims return the current scope, generation, status, and freshly read repair plan; a later process session can reclaim an abandoned build while same-session concurrency is rejected | Native cache claim, restart-recovery, and binding contract tests |
| A handled post-facet sync failure could leave the cache claim in `building` | Blocking | Sync completion unconditionally aborts any uncommitted claim while successful commits clear the local claim first | Library integration abort-and-retry regression |
| Authoritative collection refresh retained unreachable duplicate branches | Non-blocking | Removed the dead branches without changing the authoritative refresh contract | Collection store suite and lint |
| Owner transfers and source deletions could remain visible under the previous owner | Blocking | Complete-source authoritative owner inventory reassigns active and removed rows before admission and unassigns missing rows | Native inventory and source-reconciliation tests |
| Owner selection could delete boards absent from a scoped snapshot | Blocking | Board reconciliation has an explicit authoritative-deletion flag; owner selection disables it | Native board and Invoke service tests |
| Failed owner-board verification could expose stale Invoke boards | Blocking | Persisted verification state hides only Invoke boards until a successful verification | Migration view and owner-scope tests |
| User and asynchronous maintenance mutations could act on stale hidden IDs | Blocking | Image, video, membership, thumbnail, collection, and lifecycle writes validate scoped rows at mutation time; destructive multi-step paths remain native transactions | DB repository, maintenance, media, and mid-operation thumbnail scope-switch tests |
| Runtime switching immediately replaced the library with a blocking gate | Non-blocking | Prior view remains visible and inert for 400 ms; only sustained work reveals the gate; startup keeps the static initialization presentation | App fake-timer tests |
| Collection refresh used paired flags and duplicate superseding lifecycles | Non-blocking | One authoritative consistency mode and one local superseding debounce helper | Collection store, hook, and integration tests |

## Verification completed

- Generated binding drift check
- TypeScript check
- Lint with zero warnings
- Full frontend suite: 3,290 passed, 1 skipped
- Full Rust suite: 870 passed, 1 ignored
- Production frontend build
- Tauri no-bundle compatibility build
- Rust formatting check
- Patch whitespace check

## Closure

Independent review confirmed the final strict membership-shape guard and atomic
legacy-import receipt as clean. Full automated gates, production build, and Tauri
compatibility build passed on `2026-08-27`.
