# Refactor Notes
Status: Deferred
Last reviewed: 2026-04-30

## How to Use This File
Use this file to record deferred structural cleanup that changes how contributors should edit the repo safely. Keep active workstreams and short-lived blockers in `docs/progress.md`.

## Evaluate FTS-Backed Search
Status: Deferred

### Why Cleanup Is Needed
- Prompt search still primarily uses `LIKE '%term%'` against denormalized prompt columns, which is simple but can scan heavily on large libraries.
- SQLite FTS tables already exist for prompt text, but the app has not committed to using FTS for normal search semantics.

### Current Pain Points
- Boolean search, phrase search, relevance ranking, and highlighting are hard to grow cleanly on top of ad hoc `LIKE` clauses.
- AI prompts contain punctuation-heavy syntax, weights, underscores, LoRA tags, and comma-separated fragments that may tokenize differently under FTS than under substring search.

### Safe-Change Warning
- Do not replace prompt `LIKE` search with FTS as an incidental optimization. FTS changes matching semantics and can affect saved searches, smart collections, privacy masking expectations, and user trust in result counts.
- Any FTS rollout needs compatibility tests and a fallback path for substring-style edge cases.

### Suggested Future Direction
- Evaluate routing prompt-only searches through `images_fts MATCH` for speed, boolean syntax, phrase support, and optional relevance ranking.
- Define the intended tokenizer behavior for common AI prompt patterns before switching defaults.
- Keep exact substring or `LIKE` fallback behavior available for terms that FTS cannot represent safely.

### Not Part of the Current Task
- The explicit `OR` prompt-search feature should stay on the existing SQL path and should not introduce a migration or FTS behavior change.

### Related Code
- `src/utils/sqlHelpers.ts`
- `src/services/db/searchRepo.ts`
- `src-tauri/src/db/migrations/m46_optimize_fts.rs`

## Frontend State and Shell Coordination
Status: Deferred

### Why Cleanup Is Needed
- `src/App.tsx` is a 487-line integration shell that coordinates view mode, selection, import and export, modals, viewer state, drag and drop, shortcuts, and maintenance hooks.
- `src/contexts/SearchContext.tsx` is a 287-line bridge between React Query, persisted settings, SQL clause generation, and a mirrored Zustand store.

### Current Pain Points
- Images, filters, and recent-search state are shared across contexts, hooks, and stores.
- Small library or filter changes can require touching the app shell, context, and store together.

### Safe-Change Warning
- It is easy to break query invalidation, optimistic updates, or selection behavior when changing only one layer of the current state stack.

### Suggested Future Direction
- Keep React Query as the async data owner and reduce overlap between context and store state.
- Move more cross-feature coordination out of `src/App.tsx` into focused feature controllers or domain-specific hooks.

### Not Part of the Current Task
- Do not combine routine UI work with a full state-management rewrite.

### Related Code
- `src/App.tsx`
- `src/contexts/SearchContext.tsx`
- `src/stores/searchStore.ts`
- `src/hooks/`

### Related Docs
- `docs/architecture.md#frontend-app-shell-and-feature-surfaces`
- `docs/architecture.md#query-state-and-persistence-adapters`

## Persistence Boundary Cleanup
Status: Deferred

### Why Cleanup Is Needed
- `src/services/repository.ts` still carries a `LocalStorageRepository` and mock-image defaults, but the live desktop app uses `TauriFsRepository` plus SQLite.
- `src/services/TauriFsRepository.ts`, `src/stores/settingsStore.ts`, and Rust keyring or database code split persistence across JSON, SQLite, and secure OS storage.
- Windows app data is currently split across Local and Roaming AppData. This is valid Tauri/Windows behavior, but Ambit's large, local-first SQLite library is better suited to Local AppData than Roaming.

### Current Classification
- `src/services/repository.ts` is not the canonical desktop persistence path today; it exports `TauriFsRepository` for the shipping app while still carrying a LocalStorage or mock fallback.
- Treat that fallback path as ambiguous legacy surface unless a dedicated task explicitly keeps, validates, or removes non-Tauri mode.
- `src/services/TauriFsRepository.ts` writes `library.json` to `BaseDirectory.AppLocalData`; `src/services/thumbnailService.ts` stores generated thumbnails under `appLocalDataDir()/.thumbnails`; Tauri fs and asset scopes are centered on `$APPLOCALDATA`.
- `src-tauri/src/db/mod.rs` currently resolves `images.db` by checking `app_config_dir()` first, then `app_local_data_dir()`, and defaults new databases to `app_config_dir()`. On Windows, Tauri's local path APIs map config/data to Roaming AppData and local-data to Local AppData.
- `src-tauri/src/lib.rs` and `src-tauri/src/db/commands/maintenance.rs` already contain reset/purge behavior that accounts for both possible database locations.

### Current Pain Points
- It is easy to modify the wrong persistence layer or leave migrations half-finished.
- Startup, onboarding, folder scope registration, and secure key handling all depend on coordinated changes across TypeScript and Rust.
- Fresh-profile or reset instructions must mention both `AppData\Local\com.ambit.app` and `AppData\Roaming\com.ambit.app` while this split remains.
- A naive switch from Roaming to Local would look like data loss for existing users if `images.db`, `images.db-wal`, and `images.db-shm` are not migrated before the SQL plugin opens the database.

### Safe-Change Warning
- Persistence changes can silently affect existing user libraries and first-run behavior.
- Do not change the default database directory without a compatibility migration and rollback-aware testing on an existing Roaming database.

### Suggested Future Direction
- Make the production Tauri persistence path the obvious canonical path in the frontend.
- Keep the storage split explicit and narrow: SQLite for images and metadata, `library.json` for lightweight app state, keyring for secrets.
- Resolve `src/services/repository.ts` intentionally: either document the fallback as supported, or remove it in a dedicated cleanup once the repo explicitly drops that mode.
- Prefer Local AppData for Ambit's main SQLite library in a future migration because the DB can be large and contains machine-local absolute image paths. Keep a Roaming fallback or explicit migration path for existing installs.
- Add an in-app diagnostics/reset surface that shows the resolved Local AppData path, resolved database path, thumbnail path, and any detected legacy Roaming database.

### Not Part of the Current Task
- Do not delete web or mock fallbacks unless the repo intentionally drops that mode.
- Do not move the database as a documentation-only or opportunistic cleanup; it needs a dedicated migration and upgrade test pass.

### Related Code
- `src/services/repository.ts`
- `src/services/TauriFsRepository.ts`
- `src/services/thumbnailService.ts`
- `src/stores/settingsStore.ts`
- `src-tauri/src/db/`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/security.rs`

### Related Docs
- `docs/architecture.md#sqlite-data-migrations-and-maintenance`
- `docs/architecture.md#desktop-shell-and-command-surface`

## Smart Thumbnail Optimization and Removed Maintenance Tab
Status: Deferred

### Why Cleanup Is Needed
- Product rule: there is no current Maintenance thumbnail regeneration tab. Thumbnail regeneration is handled by import/native generation, lazy gallery healing, background Smart Thumbnail Optimization, and explicit settings/model/collection thumbnail tools.
- The visible Maintenance thumbnails tab was removed; `src/features/maintenance/components/MaintenanceTabs.tsx` documents that background healing now owns thumbnail regeneration.
- `src/hooks/useThumbnailQueue.ts` still starts Smart Thumbnail Optimization automatically after a short startup delay when `enableAutoThumbnailHealing` is enabled.
- The queue processes thumbnails in small batches and pauses during import or sync, but it begins by running full-library unoptimized-thumbnail count queries. On large production libraries, those count scans can still compete with normal browsing and search.
- Legacy thumbnail-maintenance UI code such as `ThumbnailsTab` and thumbnail scan paths remains in the tree even though it is no longer reachable from the visible maintenance tabs.
- This mismatch keeps confusing maintainers and agents because the code shape still suggests a removed feature exists.

### Current Pain Points
- Startup can feel responsive overall while background thumbnail work still creates intermittent SQLite load shortly after launch.
- The initial `getUnoptimizedImagesCount` query answers "how many total?" before doing useful work, which is expensive for large libraries and not always necessary.
- Dead or latent thumbnail maintenance UI code makes it harder to know which thumbnail repair path is canonical.

### Safe-Change Warning
- Thumbnail work touches SQLite, filesystem scope, scanner commands, React Query image caches, and user-facing thumbnails. Avoid mixing this cleanup with unrelated maintenance UI work.
- Do not remove manual Advanced settings actions for clearing or verifying thumbnails unless a replacement workflow is explicitly designed.
- Do not reintroduce a Maintenance thumbnail regeneration tab unless the product decision is explicitly reopened.

### Suggested Future Direction
- Make Smart Thumbnail Optimization more incremental: fetch and process small candidate batches first, and avoid full-library count scans on startup.
- Consider deferring background thumbnail healing until the app is idle for longer, until the user enables it explicitly, or until recent startup/import/sync work has settled.
- Add an indexed or materialized thumbnail-repair candidate path if full scans remain necessary.
- Remove or quarantine unreachable thumbnail maintenance UI code in a dedicated cleanup after confirming no hidden route still uses it.

### Not Part of the Current Task
- Do not change thumbnail behavior while stabilizing prod startup and search migration fixes.

### Related Code
- `src/hooks/useThumbnailQueue.ts`
- `src/services/db/maintenanceRepo.ts`
- `src/services/thumbnailService.ts`
- `src/features/maintenance/components/MaintenanceTabs.tsx`
- `src/features/maintenance/components/ThumbnailsTab.tsx`

## Context-Aware Facet Drill-Down Performance
Status: Deferred

### Why Cleanup Is Needed
- Manual collection drill-down is fast because `collection_images` gives SQLite a small indexed membership set.
- Search terms, asset drill-down, date filters, and smart collections currently evaluate dynamic SQL filters directly against `images` and junction tables.
- Valid facet discovery repeats the filtered image context across multiple facet branches, so prompt scans and multi-asset filters can become noticeably slower on large libraries.

### Current Pain Points
- Smart collections do not have a materialized membership table, so they behave more like a saved query than a manual collection.
- Prompt search still depends on broad `LIKE` predicates in common paths.
- Asset drill-down can re-run expensive cross-category joins while the user is browsing or refining filters.

### Safe-Change Warning
- Keep facet visibility and image result queries semantically identical. A faster facet query that disagrees with the image grid would reintroduce confusing asset-panel regressions.
- Do not replace the global `facet_cache` catalog/count model opportunistically; filtered counts are a separate product and performance decision.

### Suggested Future Direction
- Materialize the current filtered image IDs once per filter context, then reuse that set for all valid-facet branches.
- Prefer FTS-backed prompt matching where search syntax allows it, with the current SQL predicates as a compatibility fallback.
- Cache valid facet results by normalized filter/query hash and debounce free-text driven facet refreshes separately from image browsing.
- Consider optional smart collection membership materialization, refreshed lazily or incrementally, for collections that are opened frequently.
- Review junction-table indexes for lookup patterns used by LoRA, embedding, hypernetwork, ControlNet, and IP-Adapter drill-down.

### Not Part of the Current Task
- Do not bundle this with correctness fixes for context-aware facet visibility.
- Do not introduce filtered facet counts unless the UI explicitly changes to display them.

### Related Code
- `src/hooks/useLibraryStatsQuery.ts`
- `src/hooks/useImagesQuery.ts`
- `src/utils/sqlHelpers.ts`
- `src/services/db/searchRepo.ts`
- `src-tauri/src/db/facets.rs`
- `src-tauri/src/db/migrations/`

## Privacy-Aware Thumbnail Follow-Ups
Status: Deferred

### Why Cleanup Is Needed
- The privacy-aware thumbnail work showed that startup can regress severely from one broad SQLite query even when the feature itself is small.
- Collection thumbnail hydration originally joined `collections` to `images` through multiple `OR` predicates across image id, source path, and thumbnail path. On a production-sized library this produced repeated image scans and delayed both app startup and thumbnail-update toasts.
- Thumbnail state has several related but distinct concepts: selected image identity, resolved display URL, safe fallback URL, and sensitivity metadata. When those are updated independently, UI badges and thumbnails can briefly disagree.
- Privacy mask refresh is intentionally fingerprinted, but a real masked-keyword change can still update many image rows and rebuild resource facet thumbnail metadata.

### Current Pain Points
- Startup readiness is hard to reason about because `pnpm run app:dev` includes Vite startup, Rust compile time, Tauri launch, database initialization, privacy refresh, image query readiness, and collection sidebar hydration.
- Existing console timing logs are useful for diagnosis, but there is no single internal startup timing summary that separates those phases.
- Legacy raw collection thumbnail paths or URLs are preserved for compatibility, but they cannot reliably produce image-level privacy metadata unless they resolve to a known library image.
- Thumbnail badge logic now has a shared matcher for collection grid and pinned shelf, but future thumbnail features can still regress if they compare stale resolved URLs against custom image ids.

### Safe-Change Warning
- Do not add multi-column `OR` joins against `images` in startup or thumbnail hydration paths. Prefer indexed lookups, batched follow-up queries, or explicit legacy fallbacks.
- Keep collection and resource thumbnail privacy semantics separate: image-backed thumbnails can inherit image privacy metadata, while imported sidecar or raw-path thumbnails need explicit resource or collection-level policy.
- Do not make privacy mask refresh asynchronous in a way that exposes known-hidden thumbnails after the app has declared privacy state ready.

### Suggested Future Direction
- Add a lightweight startup timing report for: command start, Vite ready, Tauri window open, privacy refresh, first image query, and collection sidebar ready.
- Keep thumbnail enrichment staged: load collections/counts first, then enrich image-backed custom thumbnails with targeted id/path lookups.
- Consider a collection-level thumbnail privacy override for legacy raw custom thumbnails, mirroring the resource thumbnail `mask/show/reset` behavior.
- Make privacy mask refresh and facet thumbnail invalidation visibly backgrounded when they need full-library work, while preserving the current fingerprint early return for unchanged keyword sets.
- Add a small helper or test fixture for thumbnail badge identity matching so future grid, shelf, modal, and sidebar thumbnail surfaces use the same rules.

### Reference Flow
```text
collections/counts -> dynamic thumbnail candidate -> targeted custom id/path lookup -> display URL + safe URL + sensitivity
```

### Not Part of the Current Task
- Do not add visual NSFW classification; current privacy depends on prompt/manual masking and resource-name heuristics.
- Do not remove raw custom thumbnail fallback without a compatibility migration.
- Do not turn startup diagnostics into user-facing UI until the internal timings are stable.

### Related Code
- `src/services/db/collectionRepo.ts`
- `src/hooks/useCollectionOperations.ts`
- `src/utils/thumbnailUtils.ts`
- `src/components/ui/PrivacyAwareThumbnail.tsx`
- `src/contexts/SearchContext.tsx`
- `src/stores/collectionStore.ts`
- `src-tauri/src/db/facets.rs`
