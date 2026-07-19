# InvokeAI Image Assets and Metadata Roadmap

Status: In Progress

## Reconciliation

- This is a standalone InvokeAI feature workstream, not a numbered milestone.
- Existing numbered milestones, including the ComfyUI-specific Milestone 23,
  are unchanged and do not gate this work.
- SQLite remains the source of truth for Ambit image records. InvokeAI source
  facts are stored separately from parsed generation metadata so user edits and
  parser upgrades cannot erase them.
- InvokeAI `image_category` is authoritative for known image-asset detection:
  `general` is a gallery/output image; `user`, `control`, `mask`, and `other`
  are InvokeAI image assets. Missing or unknown categories remain visible and
  unclassified.
- `image_origin` is supplementary provenance, and `is_intermediate` is an
  independent visibility dimension.
- The product remains local-first. No cloud data flow is introduced.

## Objective

Make InvokeAI image assets detectable and hidden by default without losing
them, improve high-value metadata parity, expose reference provenance, and add
explicit multi-user database scoping.

The roadmap is staged so each stage is independently useful:

1. source classification, default asset visibility, sync reconciliation, and
   high-value metadata parity;
2. reference-image provenance and navigation;
3. InvokeAI multi-user ownership and isolation.

## Locked Product Decisions

- Known InvokeAI image assets are hidden from ordinary browsing by default.
- A persisted View toggle reveals them; cards show category badges and the
  viewer shows source details. There is no dedicated asset page or subtype
  filter in this workstream.
- Existing records receive a one-time automatic classification reconciliation.
- Known assets are excluded from Untagged maintenance, but remain eligible for
  missing-file, duplicate, thumbnail, and Removed workflows.
- Reference provenance supports both forward links and backlinks.
- In a multi-user InvokeAI database, Ambit auto-selects the sole owner, blocks
  import when multiple owners exist until one is chosen, and offers an explicit
  warned All users mode.
- Rows outside the chosen owner scope remain stored but hidden and recoverable;
  they are not deleted. Orphan recovery is disabled in owner mode.

## Work Package 1: Source Contract and Database Persistence

Status: Complete (`codex/invokeai-image-assets`, `2026-07-18`)

Evidence:

- migration 63 adds nullable InvokeAI image name/category/origin columns to
  active and Removed records;
- the generated classifier maps `general` to output, maps
  `user`/`control`/`mask`/`other` to asset, and leaves unknown or missing values
  unclassified;
- the default-visible fast-sort query uses the new index in SQLite's
  query plan;
- native batch upserts accept authoritative source snapshots, including a
  nullable category/origin, while preserving source facts during generic
  metadata rescans;
- source facts survive path-identity repair and the TypeScript Removed
  lifecycle;
- 64 focused repository tests, 11 image-command tests, 4 migration registry
  tests, and 3 migration-63 tests pass;
- the release-gate version, binding, lint, type, build-size, coverage, Rust-test,
  and Tauri production-build checks pass; the Rust steps used an isolated Cargo
  target because an unrelated process held the default target lock;
- Rust formatting and diff checks pass.

Primary invariant: InvokeAI source classification survives save, update,
removal, restoration, and path-identity repair independently of generation
metadata.

Scope:

- Add optional InvokeAI image name, category, and origin fields to the image
  domain and native persistence contract.
- Add the source columns to active and removed image records.
- Add an indexed generated known-asset classification and a compatible
  large-library sort index.
- Carry the fields through lightweight/full row mapping and Removed lifecycle
  operations.
- Regenerate Specta TypeScript bindings from Rust.

Non-goals:

- No InvokeAI source database query changes or automatic backfill yet.
- No gallery toggle, badges, viewer UI, parser changes, references, or owner
  selection.

Targeted verification:

- migration classification and schema tests;
- native batch upsert tests;
- TypeScript row-mapping and Removed lifecycle tests;
- binding drift check, typecheck, Rust formatting, and diff checks.

Completion criteria:

- the source fields round-trip through active and removed records;
- known categories classify deterministically while unknown/missing categories
  remain unclassified;
- generation metadata changes cannot alter source classification;
- focused checks pass and the package is independently review-clean.

## Work Package 2: InvokeAI Sync and One-Time Reconciliation

Depends on: Work Package 1.

Status: Complete (`codex/invokeai-image-assets`, `2026-07-18`)

Evidence:

- normal InvokeAI imports now persist source image name, category, and origin;
  schemas without category/origin explicitly clear those optional source facts,
  and null generation metadata remains a valid import case;
- a collision-safe two-pass reconciliation resolves canonical image paths and
  only emits a legacy flat-path alias when it belongs to one unambiguous source
  row, its canonical file exists, and the legacy path does not; it scans every
  InvokeAI image row independently of timestamps and the intermediate import
  preference;
- the native reconciliation command updates active and Removed source columns
  atomically without touching metadata, notes, favorite/pin, board, removal,
  or generated-classifier state directly;
- import-schema version 1 makes unchanged legacy snapshots reconcile once on
  startup or manual sync, persists only after the complete sync succeeds, and
  retries after cancellation or failure; Live Watch never starts the broad
  pass;
- the Settings/manual rescan route now uses the same managed Sync context as
  startup and Live Watch, and the Invoke sync service is loaded as a separate
  production chunk;
- 8 source-reconciliation tests, 35 Invoke sync-service tests, 47 Sync-context
  integration tests, the generated-command contract, snapshot tests, and App
  orchestration tests pass;
- the complete release gate passes: 2,795 frontend tests (one skipped), 485
  Rust tests, generated-binding drift, lint, typecheck, coverage, build guard,
  and the no-bundle Tauri release build; the guarded initial bundle is 431 kB
  with a separate 25.16 kB Invoke sync chunk and no ineffective dynamic import.

Primary invariant: InvokeAI database facts are reconciled without overwriting
Ambit user edits or importing newly excluded intermediates.

Scope:

- Select `image_category`, `image_origin`, and source `image_name` when present.
- Treat null generation metadata as a normal import case rather than an
  intermediate heuristic.
- Keep `is_intermediate` orthogonal to image-asset classification.
- Add an import-schema version to the InvokeAI snapshot state.
- On version mismatch, reconcile source classification across all matching
  existing InvokeAI rows, including already stored intermediates, while normal
  new-image imports continue to respect import settings.
- Mark the version current only after a successful reconciliation.

Non-goals:

- No asset UI or reference extraction.
- No destructive cleanup of legacy rows.

Targeted verification:

- category/origin compatibility matrix;
- missing metadata and unknown category cases;
- cancelled/failed reconciliation retry behavior;
- preservation of edited metadata, notes, favorite/pin, and board state.

Completion criteria:

- existing and new InvokeAI records receive correct source facts;
- legacy classifications backfill once and retry safely after interruption;
- excluded intermediates are not newly imported by reconciliation.

## Work Package 3: Gallery Visibility and Source Labels

Depends on: Work Packages 1 and 2.

Status: Complete (`codex/invokeai-image-assets`, `2026-07-18`)

Evidence:

- known `user`, `control`, `mask`, and `other` InvokeAI image assets are hidden
  by default across normal result queries, while missing and unknown categories
  remain visible;
- a persisted View control reveals image assets without changing collection
  sidebar counts or cached/custom collection thumbnails;
- revealed cards show known category badges, and the viewer presents every
  available InvokeAI source fact independently of generation metadata;
- known assets are excluded only from Untagged maintenance; direct viewer access
  and missing-file, duplicate, thumbnail, and Removed workflows remain intact;
- 385 focused tests across 16 frontend files pass, including store/settings
  persistence, SQL scopes, browser mocks, maintenance behavior, cards, viewer
  source labels, and a 10,000-item virtual-grid bound;
- the migration-63 query-plan regression confirms SQLite uses
  `idx_images_invoke_asset_fast_sort_v1` for the default asset-hidden sort;
- the complete release gate passes: version and generated-binding checks, lint,
  typecheck, build guard, 2,814 frontend tests with one skipped, 485 Rust tests,
  coverage, and the no-bundle Tauri production build; the guarded initial bundle
  is 433 kB.

Primary invariant: known InvokeAI image assets are hidden from ordinary library
queries by default and remain directly recoverable.

Scope:

- Add a persisted `Show InvokeAI Image Assets` View control.
- Apply it consistently to gallery, collections, pinned results, statistics,
  slideshow, browser mocks, and default image queries.
- Add category badges to cards and a Source section to the viewer.
- Exclude known assets from Untagged maintenance only.
- Preserve direct viewer navigation and all other maintenance access.
- Verify the indexed query shape on a large virtualized library.

Non-goals:

- No subtype filters, dedicated asset surface, or graph navigation.

Targeted verification:

- SQL/filter/store persistence tests;
- card/viewer component tests;
- maintenance-count and query-plan regressions;
- virtualized large-library smoke coverage.

Completion criteria:

- asset visibility is consistent across normal browsing surfaces;
- unknown categories stay visible;
- assets can be revealed, inspected, and maintained without data loss.

## Work Package 4: High-Value InvokeAI Metadata Parity

Depends on: Work Package 2.

Status: Complete (`codex/invokeai-image-assets`, `2026-07-19`)

Evidence:

- the Rust parser and TypeScript mapper now agree on VAE descriptors, open
  generation-mode strings, numeric-string values, zero-preserving CFG
  precedence (`cfg_scale`, `guidance`, `cfg`), and denoising precedence
  (`denoising_strength`, `denoisingStrength`, `hrf_strength`);
- the metadata worker now reuses the shared InvokeAI mapper and preserves an
  explicit generation mode instead of replacing it with path inference;
- camelCase, snake_case, and legacy T2I adapter keys accept string, descriptor,
  and nested-model forms, normalize and deduplicate their model names, and
  enter the established control-resource taxonomy without accidental
  IP-Adapter routing;
- parser version 26 reparses existing InvokeAI records, and a native database
  regression confirms reparsed T2I resources populate `image_controlnets` but
  not `image_ipadapters`;
- 78 focused frontend mapper/worker tests and focused Rust parser, resource,
  reparse, guidance, and resource-junction tests pass;
- the complete release gate passes: version and generated-binding checks,
  lint, typecheck, build guard, 2,827 frontend tests with one skipped, 492 Rust
  tests, coverage, and the no-bundle Tauri production build; the guarded
  initial bundle is 434 kB and the metadata worker is 18.09 kB.

Primary invariant: the Rust parser, frontend mapper, and worker fallback agree
on high-value InvokeAI generation fields.

Scope:

- Add VAE extraction.
- Resolve CFG with `cfg_scale`, then `guidance`, then legacy `cfg` precedence.
- Normalize denoising strength from `denoising_strength` or `hrf_strength`.
- Accept current InvokeAI generation-mode strings without a closed TypeScript
  union silently discarding them.
- Parse camelCase and snake_case T2I adapters and route their models through the
  existing guidance/control-resource facet with a T2I subtype.
- Reuse the shared mapper in the worker and avoid path inference overwriting an
  explicit generation mode.
- Increment the shared parser version once from the branch-current value.

Non-goals:

- No broad raw-field mirroring, style-prompt UI, refiner UI, or node/session
  graph import.

Targeted verification:

- Rust, mapper, and worker parity fixtures;
- precedence and normalization boundary cases;
- reparse and resource-junction regressions.

Completion criteria:

- all three parser paths produce equivalent high-value metadata;
- established facets receive T2I adapter resources without a new top-level
  taxonomy.

## Work Package 5: Reference Extraction and Resolution

Depends on: Work Packages 1, 2, and 4.

Status: Pending

Primary invariant: every supported reference keeps its source InvokeAI image
name even when its Ambit target cannot yet be resolved.

Scope:

- Extract `init_image`, ControlNet image/processed-image, IP-Adapter image, and
  T2I-Adapter image/processed-image references.
- Accept string and object forms containing `image_name` and deduplicate exact
  role/name pairs.
- Persist references transactionally in a junction table.
- Resolve targets by persisted InvokeAI image name after sync; retain and retry
  unresolved references.
- Keep removal and path-identity operations safe.
- Bump the InvokeAI import-schema version to reconcile existing rows.

Non-goals:

- No graph crawling, arbitrary custom-field inference, or automatic stacking.

Targeted verification:

- extraction-shape matrix;
- unresolved-then-resolved sync cases;
- removal/restoration/path-repair integrity tests.

Completion criteria:

- supported forward references survive partial libraries and later resolve
  deterministically.

## Work Package 6: Viewer Forward Links and Backlinks

Depends on: Work Package 5.

Status: Pending

Primary invariant: reference navigation never requires assets to be globally
visible in the gallery.

Scope:

- Show `Source Images` and `Used By` sections with role labels.
- Navigate directly to resolved images, including hidden assets.
- Display unresolved references as disabled, informative entries.
- Update backlinks incrementally as reference junctions change.

Non-goals:

- No graph visualization or reference editing.

Targeted verification:

- viewer forward/backlink component tests;
- hidden-target and unresolved-target navigation cases;
- incremental backlink query tests.

Completion criteria:

- users can traverse generation provenance in both directions without changing
  their default asset visibility.

## Work Package 7: Owner Discovery, Selection, and Reconciliation

Depends on: Work Packages 1 and 2.

Status: Pending

Primary invariant: changing owner scope never deletes out-of-scope Ambit rows.

Scope:

- Detect InvokeAI `user_id` support and provide a read-only owner summary using
  non-secret identifiers/display fields.
- Auto-select a sole owner; require a choice for multiple owners; provide an
  explicit warned All users mode.
- Persist source owner IDs on active and removed records.
- Reconcile existing records to owners without importing out-of-scope images.
- Mark other/unassigned rows with an indexed internal scope-hidden flag.
- Invalidate the saved cursor/snapshot and run a full scoped reconciliation
  when scope changes.

Non-goals:

- No InvokeAI authentication, password handling, shared/public-board semantics,
  or row deletion.

Targeted verification:

- legacy/no-user schema, sole-owner, multi-owner, All users, and scope-change
  matrices;
- preservation/recovery of mixed-owner and unassigned rows.

Completion criteria:

- owner choice is explicit and durable;
- out-of-scope data remains recoverable but cannot leak into ordinary results.

## Work Package 8: Scope-Aware InvokeAI Sync

Depends on: Work Package 7.

Status: Pending

Primary invariant: every InvokeAI-derived query observes the same selected
owner scope.

Scope:

- Scope images, favorites, boards, board mappings, counts, repair, startup
  catch-up, and live sync.
- Use owner boards in owner mode and preserve current behavior in All users
  mode.
- Disable orphan recovery in owner mode because filesystem-only files cannot be
  assigned safely.
- Refresh the equality-friendly indexed scope-hidden field transactionally.
- Include scope and schema version in snapshot validity.

Non-goals:

- No inference of owner for orphan files and no cross-owner sharing model.

Targeted verification:

- end-to-end scoped manual/startup/live sync tests;
- owner-board mapping and count tests;
- query-plan and large-library regressions.

Completion criteria:

- all InvokeAI sync paths enforce the selected scope consistently;
- switching scope is deterministic, recoverable, and does not duplicate or
  delete records.

## Stage Acceptance Gates

After the work packages in each stage are review-clean:

1. Run focused Vitest coverage for InvokeAI sync/snapshot/mapper/orphan logic,
   repository mapping, search/settings, maintenance, and viewer behavior.
2. Run focused Rust migration, image-command, metadata, resource-junction, and
   reparse tests.
3. Regenerate and check Specta bindings when Rust-backed types change.
4. Run TypeScript checking, lint, `cargo fmt --check`, and `git diff --check`.
5. Run `pnpm run verify:release` as the full integration gate.
6. Exercise a large virtualized library and inspect relevant SQLite query plans.
7. Update user/manual and integration documentation for completed behavior only.

Prefer one conventional commit per work package. Stop between packages for
review; do not advertise later-stage capabilities while they remain pending.
