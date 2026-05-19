# Refactor Notes
Status: Deferred
Last reviewed: 2026-05-03

## How to Use This File
Use this file to record deferred structural cleanup that changes how contributors should edit the repo safely. Keep active workstreams and short-lived blockers in `docs/progress.md`.

## Collection and Smart Count Performance
Status: Deferred

### Why Cleanup Is Needed
- Startup/sidebar work can still issue expensive collection queries even when no image filter is active.
- Smart collection counts can block SQLite on `positive_prompt LIKE '%term%'` scans.
- Collection thumbnail hydration runs multiple correlated ordered subqueries per collection.

### Suggested Future Direction
- Handle this in a separate performance worktree from asset discovery.
- Evaluate cached or materialized smart collection membership before changing prompt-search semantics.
- Replace collection thumbnail hydration with a batched query shape that avoids repeated per-collection ordered subqueries.

### Related Code
- `src/services/db/collectionRepo.ts`
- `src/stores/collectionStore.ts`
- `src/utils/sqlHelpers.ts`

## Privacy Hide Asset Facet Loading Performance
Status: Deferred

### Why Cleanup Is Needed
- Privacy masking mode `Hide` currently makes the Assets tab behave as if a user filter is active, even when no explicit filter is selected.
- `useLibraryStatsQuery.shouldFetchValidFacets(...)` returns true for `privacyEnabled && maskingMode === 'hide'`, so the app calls `getValidFacetNames(...)` on normal Assets tab load.
- `getValidFacetNames(...)` builds a seven-branch `UNION ALL` over checkpoints, LoRAs, embeddings, hypernetworks, tools, ControlNet, and IP-Adapter with `privacy_hidden = 0` applied to each branch.
- On the 2026-05-10 dev DB, a read-only query-plan check showed roughly 87k visible non-hidden images, 175k LoRA junction rows, 14k ControlNet rows, and 4.7k IP-Adapter rows. SQLite uses the privacy image index, but it still repeats broad image-driven work per branch and joins `facet_cache` through normalized `LOWER(...)` expressions that cannot use exact resource-name lookup cleanly.
- Asset catalog loading is now split from summary/valid-name loading, so switching asset scope should not repeat the expensive valid-facet query.

### Current Pain Points
- Asset facet catalog loading itself can be fast, but hide-mode privacy validation can dominate the perceived load time by minutes on large libraries.
- The expensive query is invisible to the user as a privacy-validity pass; it looks like normal asset loading is broken.
- The remaining performance risk is the hide-mode privacy-validity query itself, especially on initial `Used in Library` loads and after facet-cache changes.

### Safe-Change Warning
- Do not simply remove hide-mode valid-facet filtering without a product decision. If asset names used only by hidden images are considered private, `Used in Library` must not reveal them while privacy hide is enabled.
- Keep thumbnail safety separate from asset-name visibility. Safe thumbnails do not by themselves answer whether a hidden-only resource name should appear.
- Avoid broad `UNION ALL` scans and normalized string joins in startup or scope-switch paths; they scale with library size rather than with the cached asset catalog.

### Suggested Future Direction
- Preserve the split between cheap asset catalog loading and privacy-valid asset-name computation.
- Keep `assetScope` changes from invalidating privacy-valid names when the selected scope does not consume them.
- For `All`, decide whether hidden-only used assets should be shown; if yes, avoid valid-name work. If no, compute privacy-valid used aliases through a cached/materialized path rather than on every scope load.
- For `Used in Library`, prefer a privacy-aware facet cache or materialized visible-resource membership keyed by resource type and canonical asset identity, refreshed when `privacy_hidden` changes.
- If query-time validation remains necessary, add indexed normalized resource identity columns or lookup tables so facet matching does not rely on `LOWER(REPLACE(...))` joins against `facet_cache`.
- Ensure future privacy-validity optimizations still refresh when `facet_cache` changes, because valid facet names depend on cached asset rows.

### Related Code
- `src/hooks/useLibraryStatsQuery.ts`
- `src/features/filters/components/FilterPanel.tsx`
- `src/features/filters/components/ResourceSection.tsx`
- `src/services/db/searchRepo.ts`
- `src-tauri/src/db/facets.rs`
- `src-tauri/src/db/migrations/m50_privacy_index.rs`

## Live Watch Pending Completion State
Status: Deferred

### Why Cleanup Is Needed
- Live Watch currently uses the `watching` phase for both passive idle display and real pending work after filesystem or InvokeAI DB activity is detected.
- InvokeAI Live Watch observes SQLite DB/WAL changes, not a final image file write. Several no-op DB events can arrive while generation is still in progress before the completed image row becomes importable.
- The toggle-off UX can therefore feel too eager: if the dock says "Watching for completed images...", the user may reasonably expect Ambit to finish evaluating the already-detected activity before closing.

### Current Pain Points
- The Activity Dock copy does not distinguish "detected activity, waiting for completion" from "idle and ready for future events."
- Store-level stop behavior can only reason about the current phase, not whether WatcherContext still has a pending Invoke debounce or final evaluation to drain.
- Generic folder Live Watch is less ambiguous because targeted imports wait for stable files; InvokeAI remains harder because the event source is DB activity.

### Safe-Change Warning
- Do not mix this UX follow-up with InvokeAI no-op candidate-check optimization, Tauri path-scope warning cleanup, favicon noise, or generic SQL cleanup.
- Stopping Live Watch should stop accepting new watcher events immediately, but it can still drain one bounded already-detected activity window if the UI is in a pending-completion state.
- Avoid an unbounded background poll after toggle-off. The final drain needs a short timeout and explicit logs so it cannot look like Live Watch remained enabled.

### Suggested Future Direction
- Split Live Watch phases so pending work is explicit, for example `detected` or `pending_completion`, separate from passive `watching` and `summary`.
- For InvokeAI, when toggled off during pending completion, stop the watcher and run one bounded final evaluation loop until a completed image imports, a no-op settles, or a short timeout expires.
- Add Live Watch perf logs for the state transitions: detected, debounce scheduled, final drain started, completed image imported, no-op settled, and timeout.
- Keep the current incremental facet refresh path unchanged; this follow-up is about session state and stop UX, not facet-cache behavior.

### Not Part of the Current Task
- Do not change manual imports or manual sync behavior.
- Do not replace the full rebuild fallback.
- Do not add broader InvokeAI no-op scan optimization unless it is planned as its own performance pass.

### Related Code
- `src/stores/libraryStore.ts`
- `src/contexts/WatcherContext.tsx`
- `src/contexts/SyncContext.tsx`
- `src/services/invoke/syncService.ts`
- `src/utils/liveWatchPerf.ts`

## Rust-Side Cancellation For Integration Imports
Status: Deferred
Priority: P2

### Why Cleanup Is Needed
- Frontend-managed integration imports now use cooperative `AbortController` cancellation and return explicit `wasCancelled` state, so cancelled imports should not advance folder cursors.
- The remaining cancellation gap is inside active Rust IPC work. Once a frontend import has entered a backend command such as directory traversal or bulk metadata extraction, the current call can continue until it returns.
- This is mostly a responsiveness and resource-use issue after the frontend cancellation fix, but it can still make very large folder imports feel slow to stop.

### Current Pain Points
- `scanDirectoryWithStats` can keep walking a large directory after the user clicks Cancel.
- Bulk metadata scan work can continue through the current native batch before the frontend observes cancellation.
- The Activity Dock can hide cancelled import state promptly, but backend CPU/disk work may still be active briefly or for a long scan.

### Safe-Change Warning
- Do not mix this with the frontend cooperative cancellation pass. Backend cancellation likely needs Tauri command contract changes, shared cancellation state, and Rust tests.
- If command signatures change, regenerate Specta bindings instead of editing `src/bindings.ts` manually.
- Preserve path-scope checks and local-first filesystem safety while threading cancellation through recursive traversal.
- Cancellation should be best-effort and explicit: partial imports must remain distinguishable from complete imports, and folder cursors must not advance after cancellation.

### Suggested Future Direction
- Add a backend import or scan session id that the frontend can associate with its `AbortController`.
- Store cancellation tokens in Rust for active import/session work and expose a Tauri cancel command for that session.
- Check the token inside directory traversal loops, bulk metadata extraction loops, and between filesystem/database batches.
- Keep existing frontend `wasCancelled` handling as the UI and cursor-safety contract, and bridge it to Rust cancellation for faster stop behavior.
- Add Rust tests or command-level integration tests for cancelled traversal and cancelled bulk metadata scanning.

### Not Part of the Current Task
- Do not block the current cooperative frontend cancellation fix on Rust interruption support.
- Do not treat this as a data-correctness blocker unless a new path is found that still advances cursors after cancellation.

### Related Code
- `src/services/importService.ts`
- `src/hooks/useImportOps.ts`
- `src/hooks/useFolderMonitor.ts`
- `src/features/settings/hooks/useFoldersTabLogic.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/scanner/`
- `src-tauri/src/metadata/`

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

## Backend-Supported Timeline Buckets
Status: Deferred

### Why Cleanup Is Needed
- Timeline now progressively loads older image pages as the user scrolls, matching Grid behavior without fetching the full library up front.
- For very large libraries, the Timeline can still only build month/day headers from image cards that have already been fetched.
- Deep-history navigation would be faster and more accurate with a backend-supported date bucket index that is independent from loaded card pages.

### Current Pain Points
- Timeline headers are derived client-side from the current paginated `images` array.
- Users cannot see the full historical span until enough pages have been loaded.
- Jumping directly to an older month would require loading every intervening page under the current implementation.

### Safe-Change Warning
- Do not replace the current progressive pagination with eager full-library loading.
- A bucket-level Timeline needs new query contracts and acceptance testing against large libraries before it should become the default.

### Suggested Future Direction
- Add a SQLite-backed Timeline aggregate query that returns day/month buckets with counts for the active filters.
- Use those buckets to render the full Timeline structure independently from loaded image cards.
- Page image cards per bucket, or around scroll position, so deep history can be reached without loading all newer images first.

### Not Part of the Current Task
- Do not add Rust commands, Specta bindings, or SQLite migrations for the immediate Timeline loading fix.
- Do not change existing search result cursor pagination semantics.

### Related Code
- `src/features/library/components/TimelineView.tsx`
- `src/features/library/hooks/useTimelineLayout.ts`
- `src/hooks/useImagesQuery.ts`
- `src/services/db/searchRepo.ts`

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
- Fresh-profile or reset instructions must mention both the current `io.github.asuraace.ambit` directories and the legacy `com.ambit.app` directories while the public-beta identifier migration remains in the transition window.
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

## Tauri Bundle Identifier Migration
Status: In transition

### Current State
- Production config now uses `io.github.asuraace.ambit` as the bundle identifier.
- Development config remains on `com.ambit.dev`.
- Release builds run a one-time startup migration before SQL initialization:
  - Roaming AppData moves from `com.ambit.app` to `io.github.asuraace.ambit` when the new profile has no `images.db`.
  - Local AppData moves from `com.ambit.app` to `io.github.asuraace.ambit` when the new profile has no `library.json` or `.thumbnails`.
  - Existing new-profile data is never overwritten.
- Reset/purge and historical migration repair code check both the current and legacy production identifiers during this transition.

### Safe-Change Warning
- Do not remove the legacy `com.ambit.app` fallback checks until the public-beta upgrade window is intentionally closed.
- Changing identifier behavior can affect installer identity, update continuity, app data locations, and OS-level permissions.
- This migration is Windows-first; macOS and Linux remain unshipped until identifier, data-path, and updater behavior are explicitly validated there.

### Suggested Future Direction
- Validate fresh-profile, legacy-profile, and conflict-profile startup behavior on packaged Windows builds.
- Keep release notes explicit that existing alpha data under `com.ambit.app` is migrated once into `io.github.asuraace.ambit`.
- After the transition window, decide whether to keep legacy purge/repair checks as harmless compatibility or remove them in a dedicated cleanup.

### Not Part of the Current Task
- Do not change the dev identifier.
- Do not move the SQLite database from Roaming to Local AppData as part of this identifier-only migration.

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

## Resource Discovery Taxonomy Phase 2
Status: Deferred

### Why Cleanup Is Needed
- Resource folder discovery can recurse through a broad root such as a ComfyUI `models` directory, but current disk-scan classification is heuristic.
- The scanner recognizes common supported assets from path text: LoRA, embedding, hypernetwork, ControlNet, and IP-Adapter; anything else with a model-like extension currently falls back to checkpoint.
- This makes standard folders such as `models/loras`, `models/checkpoints`, `models/controlnet`, and `models/ipadapter` mostly usable, but broad roots can misclassify unsupported model folders such as VAE, CLIP/text encoders, upscale models, detectors, or custom extension folders as checkpoints.

### Current Pain Points
- Adding each supported resource folder separately gives cleaner inventory today, but it is tedious for users with normal ComfyUI or A1111-style directory trees.
- Adding a full model root is convenient, but noisy misclassification can make the Assets tab look less trustworthy.
- Unknown or unsupported local model files do not have a neutral inventory bucket, so the fallback checkpoint behavior carries too much meaning.
- Local disk discovery and image-metadata harvesting meet through `models` and `facet_cache`, with a lightweight query-layer match key for obvious filename or display-name aliases.
- The lightweight match key is not a durable asset identity. Disk-scanned rows still use a file-path-derived hash, while image-harvested rows can use metadata hashes, parser-cleaned names, or CivitAI-resolved display names.

### Safe-Change Warning
- Do not treat every unknown `.safetensors`, `.ckpt`, `.pt`, `.bin`, or `.pth` file under a model root as a checkpoint in a future taxonomy pass.
- Filtering semantics must remain tied to image metadata usage. Unused disk-scanned assets can be shown as inventory, but they should not become active image filters until Ambit has at least one matching image usage.
- Keep resource discovery opt-in and path-scoped; do not add automatic filesystem-wide model scanning.

### Suggested Future Direction
- Add taxonomy-aware folder classification for known layouts, especially ComfyUI `models/`, A1111/Forge `models/`, and other common local AI image app structures.
- Map supported folders explicitly, for example checkpoints, LoRAs, embeddings or textual inversion, hypernetworks, ControlNet, and IP-Adapter.
- Route unsupported folders such as VAE, CLIP, text encoders, upscale models, detectors, and unknown/custom categories to `ignored` or `other` instead of checkpoint.
- Add a resource-folder type override in Settings: `Auto`, explicit supported asset types, `Other`, and `Ignore`.
- Show a scan preview or summary with counts by inferred type plus warnings for unknown or ignored folders before users trust a broad model-root scan.
- Store enough scan-source metadata to support stable rescans, stale `disk_scan` cleanup when folders are removed, and future per-folder classification overrides.
- Introduce a durable canonical asset identity or alias layer so local disk files and image-used assets can merge beyond the current conservative query-layer match key.
- Treat `Local` as a property of an asset row, not as a competing row. The intended UI remains: one used asset row with an image count and a `Local` marker when it exists on disk; one unused inventory row only when there is no image usage yet.
- Keep display names separate from identity keys, and avoid relying on UI-only dedupe for filtering semantics.
- For checkpoints, evaluate cached local file hashing or metadata-derived hashes so disk files can match image `model_hash` or CivitAI records by hash instead of filename only.
- Make filters resolve through the canonical identity or its aliases so selecting an asset can match all known equivalent names rather than only the clicked display name.

### Not Part of the Current Task
- Do not add new asset categories for VAE, CLIP, text encoders, upscalers, or detectors as part of the current Assets tab scope control.
- Do not persist Assets tab scope state unless a separate UX decision asks for it.

### Acceptance Direction
- A user can add a normal ComfyUI `models` root and Ambit classifies standard supported resources correctly without polluting checkpoints with unsupported model files.
- A user can override a folder type when auto-detection is wrong.
- Broad root scans report unknown or ignored files clearly enough that users know why something did or did not appear in the Assets tab.
- If a checkpoint, LoRA, ControlNet, or IP-Adapter is both used in images and present on disk, it appears once in `Used in Library` with the correct combined image count and a local marker.
- Alias variants caused by filename, parser-cleaned name, metadata display name, or CivitAI-resolved name do not create duplicate visible asset rows.

### Related Code
- `src-tauri/src/metadata/thumbs_scan.rs`
- `src/features/settings/hooks/useFoldersTabLogic.ts`
- `src/features/settings/components/ResourceDiscoverySection.tsx`
- `src/features/filters/components/FilterPanel.tsx`
- `src/features/filters/components/ResourceSection.tsx`
- `src/services/db/searchRepo.ts`

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

## Credential Storage Modernization
Status: Deferred

### Why Cleanup Is Needed
- The current Gemini API key path in `src-tauri/src/security.rs` uses the legacy `keyring` v2 client API directly and works with Ambit's existing Tauri commands.
- Dependabot PR `#92` showed that `keyring` v4 is not a drop-in replacement. The crate now acts as store-selection/sample-code glue, while the old app-facing `Entry` API moved to `keyring-core`.
- Treating this as a routine dependency bump breaks the Rust build immediately and risks turning a stable OS-keyring integration into an unplanned credential-store architecture migration.

### Current Pain Points
- Credential storage policy is implicit in the dependency choice rather than documented as a deliberate architectural decision.
- Automated dependency tooling can still propose a major `keyring` upgrade even though the repo already treats the crate as a special-case dependency.
- The current implementation is Windows-first operationally, but any move to `keyring-core` would need explicit validation of store bootstrap and behavior across Windows, macOS, and Linux.

### Safe-Change Warning
- Do not merge major `keyring` upgrades as routine dependency maintenance.
- Do not swap `keyring` for `keyring-core` without a dedicated migration that preserves the existing Tauri command contract: `save_api_key`, `load_api_key`, and `delete_api_key`.
- Do not mix credential-store migration work with unrelated frontend or Tauri upgrades; secret storage changes need isolated verification and rollback clarity.

### Suggested Future Direction
- Keep `keyring` v2 until there is a concrete product or platform reason to modernize the credential-store layer.
- If modernization becomes worthwhile, evaluate whether Ambit should:
  - stay on `keyring` v2 longer,
  - migrate to `keyring-core` with explicit native-store bootstrap,
  - or adopt another intentionally chosen credential-store integration.
- Scope that migration around Windows-first verification, then validate macOS and Linux behavior before expanding release expectations.
- Add focused tests or smoke coverage for save/load/delete key flows before and after any future migration.

### Acceptance Direction
- Dependency automation does not reopen major `keyring` upgrade PRs by default.
- Contributors can see from repo docs that credential storage is a deliberate manual-decision area, not a routine dependency refresh.
- Any future credential-store migration starts from an explicit architecture task instead of a Dependabot PR.

### Related Code
- `.github/dependabot.yml`
- `src-tauri/src/security.rs`
- `src-tauri/Cargo.toml`
- `src/bindings.ts`
