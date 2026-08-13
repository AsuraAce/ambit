# InvokeAI Owner-Scope Architecture

Status: Implementation and database smoke complete; desktop restart acceptance pending (`2026-08-09`)

## Outcome

Make changing a prepared InvokeAI owner scope feel like changing a filter, while
keeping first-time and stale scopes fail-closed until their derived data is safe.

## Decisions

- Keep one canonical Ambit SQLite database. Separate databases per owner would
  duplicate local content, complicate cross-owner administration, and create
  migration and recovery risks without improving the privacy boundary.
- Package 1 keeps the existing `facet_cache` and collection cache columns as the
  active compatibility projection, backed by persistent per-scope snapshots.
- Package 2 replaces `invoke_scope_hidden` row rewrites in user-facing reads with
  logical scoped views and an atomic active-scope pointer.
- Package 3 records why a snapshot became dirty and repairs exact resources,
  facet types, or collection summaries before falling back to a full rebuild.
- Installed model inventory remains global. Image usage, collection summaries,
  thumbnails, and other owner-derived results remain scoped.
- InvokeAI remains read-only. Ambit never writes owner or board changes back to
  the InvokeAI database.

## Package 1 - Persistent derived caches

Acceptance:

- A ready scope switch restores cached facets and collection summaries instead
  of running the full facet or collection-thumbnail rebuild.
- Content, metadata, privacy, collection, and membership mutations invalidate
  only scopes that can observe the change; local and global inventory changes
  invalidate every stored scope.
- Missing or dirty scopes remain gated, rebuild normally, and become ready only
  after both facet and collection caches are coherent.
- Cache preparation records a `building` generation before derived work starts;
  a content mutation invalidates that generation and prevents a stale commit.
- Failed preparation restores the previous coherent scope.
- Owner-specific source fingerprints avoid source catch-up when another owner
  changed in the shared InvokeAI database.

## Package 2 - Logical scoped views

Acceptance:

- Active and removed Invoke images and Invoke collections carry an authoritative
  source identity.
- User-facing reads use indexed scoped views driven by the current owner state.
- Switching a ready scope performs no operation proportional to the total image
  count and is click-to-ready in under two seconds on the maintainer library.
- `invoke_scope_hidden` remains for one compatibility cycle but is no longer
  authoritative or rewritten during scope changes.

## Package 3 - Selective cache repair

Acceptance:

- Ready scopes restore without beginning a build.
- Precisely dirty scopes restore their last coherent snapshot and repair only
  named facet resources, affected facet types, or collection summaries.
- Missing scopes and dirty state without a trustworthy cause still rebuild in
  full and remain fail-closed until commit.
- Model harvesting during a build does not invalidate the active building
  scope, but it does invalidate other prepared scopes because model inventory
  is shared.
- Runtime switches keep the previous view visible but inert for a 400 ms grace
  period; sustained work names the target owner and reports elapsed time.

## Verification

- Migration tests cover upgrade preservation, cache isolation, targeted
  invalidation, rowid preservation, and query plans.
- Multi-owner fixtures cover owner, All users, legacy, and unselected privacy.
- Frontend tests cover warm activation, cold preparation, cancellation,
  rollback, duplicate-startup coalescing, and Live Watch deferral across an
  owner transition.
- Generated Specta bindings, frontend checks, Rust tests, and the Tauri
  compatibility build pass at the final integration gate.
- The maintainer InvokeAI database contains 370 System boards and three image
  owners: System with 154,719 images plus two new owners with 36 and 4 images.
  Ambit's dev database stores all 370 boards with `invoke_owner_id = system`;
  a non-System owner therefore sees zero boards, while System sees all 370.
- The real 1.4 GB dev catalog upgraded through migration 69. Its initial dirty
  All-users cache completed the one-time cold build and committed generation 1
  as ready; the desktop window remained responsive.
- The supplied trace spent 378.374 seconds in the LoRA matched-row insert. The
  equivalent matched phase on the 1.4 GB dev catalog is about 1 millisecond
  after replacing the correlated per-model scan with preaggregated matches.
- A transactionally consistent copy of the real 1.4 GB dev catalog upgraded
  through migration 70 in 64 milliseconds and passed SQLite integrity and
  foreign-key checks. Restoring prepared owner snapshots through the exact
  backend switch transaction took 328 milliseconds for the first measured
  restore and 55 milliseconds warm; neither path rebuilt facets.
- Regression coverage protects legacy weighted resource names during selective
  repair and rejects a scope-cache commit when an external model mutation races
  a build. Internal model harvesting suppresses invalidation only for its active
  build transaction, while other prepared scopes remain dirty as required.
- Final checks: 3,126 frontend tests passed (1 skipped), 761 Rust tests passed
  (1 ignored), and typecheck, lint, bindings drift, frontend build, Rust format,
  Git whitespace, and Tauri compatibility checks passed.
- Click-to-ready UI timing for restored and selectively repaired scopes after an
  actual desktop restart remains an owner-acceptance check. Port 1422 was owned
  by another worktree during final verification, so that process was not
  interrupted for this smoke test.

## Non-goals

- Archive status synchronization or transfer.
- Creating or administering InvokeAI users from Ambit.
- Writing any state to the InvokeAI database.
