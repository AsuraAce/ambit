# InvokeAI Owner-Scope Correctness and Switching

Status: Complete (`2026-08-09`)

## Outcome

- Repair existing InvokeAI board collections whose owner was never persisted.
- Treat one owner with no unassigned images or boards as an automatic
  single-user setup.
- Preserve independent synchronization state per owner scope so returning to a
  prepared scope does not restart full preparation.
- Keep a blocking preparation gate only when a target scope has not been
  prepared or genuinely requires catch-up.

## Invariants

- Owner-scoped images and boards remain fail-closed until their authoritative
  owner is known.
- Scope changes never delete images, collections, memberships, or references.
- Existing `library.json` state remains readable and seeds the new per-scope
  snapshot list when possible.
- A failed runtime scope change restores the previously coherent view.

## Work packages

1. Backfill authoritative owners for existing InvokeAI board collections,
   reconcile empty boards during the import-schema upgrade, and keep the owner
   repair independently versioned from image-source reconciliation.
2. Replace the redundant one-owner selector with an automatic owner summary.
3. Persist per-scope snapshots and make selection own its required catch-up,
   visibility application, cache refresh, and rollback.
4. Add focused regression coverage, update routed documentation, and run the
   release-proportional verification gate.
5. Persist precise cache invalidation reasons and repair only the affected
   resources or collection summaries on later activation.

## Acceptance

- The real System-only data shape exposes all InvokeAI boards after repair
  and does not offer an equivalent All users choice.
- A current cached scope performs no source reconciliation or full sync.
- A stale cached scope resumes incrementally from its own cursor.
- A first uncached multi-user scope remains gated until its coherent view is
  ready, and later switches back reuse the saved state.
- A runtime switch that completes inside 400 ms does not flash the preparation
  gate; sustained work names the target and reports elapsed time.

## Verification

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test:run` - 3,122 passed, 1 skipped
- `pnpm run test:rust` - 758 passed, 1 ignored
- Real-data checks - 370 of 370 boards persisted as System-owned; optimized
  LoRA matched-row phase measured about 1 ms instead of the supplied 378-second
  trace
