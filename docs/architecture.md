# Architecture
Status: Canonical
Last reviewed: 2026-08-09

## System Overview
Ambit is a Tauri v2 desktop app with a React/TypeScript frontend and a Rust backend exposed through Tauri commands. Library assets and heavy metadata live in SQLite under Local AppData, lightweight app state lives in `library.json` under app-local data, and sensitive secrets such as the Gemini API key live in the OS keyring. Images remain the default asset type; manually imported videos use an explicit discriminator and bounded native probe.

## Major Subsystems

### Desktop Shell and Command Surface
Purpose: boot the Tauri app, register plugins, manage app-scoped state, and export Specta bindings.
Code: `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src/bindings.ts`
Interacts with: frontend services that call `commands.*`, Tauri plugins for SQL, filesystem, dialog, shell, and window state
Risks: command signature changes can break TypeScript callers; use `pnpm run bindings:generate` to regenerate `src/bindings.ts` and `pnpm run bindings:check` to detect drift
Related docs: `docs/progress.md#current-constraints`

### SQLite Data, Migrations, and Maintenance
Purpose: store image records, parsed metadata, facet caches, backups, reparsing state, and database maintenance behavior.
Code: `src-tauri/src/db/`
Interacts with: Rust scanner and metadata modules, TypeScript repo modules under `src/services/db/`, settings-backed folder sync
Risks: PRAGMA or migration changes affect startup, large-library performance, and data integrity
Related docs: `docs/refactor.md#persistence-boundary-cleanup`

### Metadata Extraction, Scanning, and Watcher Flows
Purpose: scan image files, extract metadata and workflows, resolve models, and watch library folders.
Code: `src-tauri/src/scanner/`, `src-tauri/src/metadata/`, `src-tauri/src/media.rs`, `src-tauri/src/watcher.rs`, `src-tauri/src/fs_commands.rs`, `src-tauri/src/security.rs`
Interacts with: frontend import, settings, maintenance, and viewer flows
Risks: parser heuristics and watcher behavior can create wrong metadata or miss library changes; external path handling must stay scoped and local
Related docs: `docs/manual/adding-folders.md`, `docs/manual/generator-integrations.md`, `docs/comfyui-support-workflow.md`

### Thumbnail Generation and Optimization
Purpose: generate cached WebP thumbnails, repair or upgrade thumbnail records in the background, expose maintenance controls, and throttle or cancel native work around foreground activity.
Code: `src-tauri/src/thumb/`, `src/services/thumbnailService.ts`, `src/hooks/useThumbnailQueue.ts`, `src/hooks/useThumbnailOps.ts`
Interacts with: SQLite image rows, app-local thumbnail storage, Activity Dock state, maintenance UI, collection thumbnail refresh, and generated Tauri bindings
Risks: background jobs write in batches and coordinate cancellation, retry backoff, cache-loss recovery, and foreground throttling; changes can create heavy disk or database work on large libraries
Related docs: `docs/manual/maintenance.md`, `docs/refactor.md#smart-thumbnail-optimization-and-thumbnail-maintenance-ownership`

### Frontend App Shell and Feature Surfaces
Purpose: render the desktop UI, modals, viewer, filter panel, grid/timeline/statistics views, maintenance screens, and settings flows.
Code: `src/index.tsx`, `src/App.tsx`, `src/components/`, `src/features/`
Interacts with: contexts, stores, hooks, `src/services/`, generated bindings, and Tauri plugins
Risks: `src/App.tsx` coordinates many cross-feature concerns, so changes can regress areas outside the touched feature. Gallery and Maintenance both render the shared `src/features/viewer/components/ImageViewer.tsx`, but each owns context-specific session navigation and action wiring; viewer feature changes must verify both entry points.
Related docs: `docs/refactor.md#frontend-state-and-shell-coordination`, `docs/refactor.md#shared-image-viewer-integration-boundary`

### Query, State, and Persistence Adapters
Purpose: own frontend query flows, transient UI state, JSON-backed settings and recent-search persistence, thumbnail services, and database helper modules.
Code: `src/contexts/`, `src/stores/`, `src/hooks/`, `src/services/`
Interacts with: `src/features/`, `src/bindings.ts`, `src-tauri/src/db/`, app-local `library.json`
Risks: state ownership is split across React Query, contexts, Zustand, and repository adapters, which makes duplicate sources of truth easy to introduce
Related docs: `docs/progress.md#current-constraints`, `docs/refactor.md#frontend-state-and-shell-coordination`

### Network Surface
Purpose: keep the core app local-first while supporting explicit public-beta network paths.
Code: `src/hooks/useAppUpdater.ts`, `src/services/geminiService.ts`, `src-tauri/src/metadata/civitai.rs`, `src/features/settings/`
Interacts with: GitHub Releases updater feed, optional Gemini API requests, optional CivitAI hash resolution, and user-clicked external support/project links
Risks: passive third-party assets or unclear copy can make local-first behavior hard to audit
Related docs: `README.md#privacy-and-network-behavior`, `SECURITY.md`

## Invariants
- SQLite is the source of truth for image records and heavy metadata. On Windows, the main library database lives in Local AppData, with Roaming AppData retained only as a legacy fallback during the public-beta transition. `library.json` should not become a second image store.
- Rust-exposed command and type changes should flow through Specta into `src/bindings.ts`; do not hand-maintain Rust-backed TypeScript mirrors.
- Generated binding updates are explicit: run `pnpm run bindings:generate`, then verify with `pnpm run bindings:check` or a broader gate that includes it.
- Filesystem access must remain local-only and within Tauri-registered or scoped paths.
- API keys are stored via Rust keyring commands, not persisted in `library.json`.
- Passive visual assets must be bundled locally. Network calls should be limited to the documented updater, Gemini, CivitAI, and user-clicked external-link paths.
- Large library browsing paths must remain virtualized and performance-conscious.
- Gallery and timeline results for videos render static posters or a generic placeholder; they must not instantiate background video players.
- The bundled MediaInfo sidecar is invoked only by Rust-owned fixed arguments against canonical picker-scoped regular files, with bounded output, timeout, cancellation, and single-process concurrency.
- Gallery and Maintenance should reuse the shared `ImageViewer` presentation instead of developing separate viewer implementations. Their navigation, deletion, recovery, and other context-dependent policies remain owned by their respective controllers.
- Removal is a recoverable database lifecycle: active images are transactionally tombstoned in `removed_images`, including their file hash and parser version, and restore reconstructs the active row plus supported memberships/resources in one transaction. Remove, restore, duplicate tombstoning, and final deletion share a process-wide coordinator so restore cannot race a source-file trash operation. Final deletion clears the tombstone only after OS-trash success (or when the source is already missing). Collection membership moves are likewise native transactions rather than frontend SQL sequences.
- Full facet rebuilds populate a temporary staging table and swap into the live cache in a short transaction. Full and incremental refreshes share one coordinator so a queued targeted refresh cannot be overwritten by an older full-build snapshot.
- InvokeAI owner scope is a logical projection over one canonical Ambit database, not a separate database per user. Active images, Removed images, Invoke boards, and owner-aware Ambit collections carry an Invoke source identity; user-facing reads go through indexed scoped views driven by the atomic current-scope record. Ambit collections created in an owner view belong to that owner, collections created in `All users` are aggregate-only, and legacy unscoped collections remain shared until explicitly reassigned. Changing owners does not rewrite visibility across image rows. InvokeAI administrator status does not widen an owner projection; `All users` is the only aggregate scope. The reserved `system` owner is an ordinary owner projection, while discovery presents standard and intermediate image counts separately.
- Facet and collection-derived caches have persistent per-scope snapshots. Mutations invalidate only scopes that can observe the changed Invoke owner (plus aggregate scopes), while local-library and global model changes invalidate every scope. A persisted dirty ledger distinguishes exact facet resources, whole facet types, collection summaries, and unknown full-rebuild causes. Dirty-ledger trigger writes use an explicit UPSERT conflict target because SQLite propagates a containing statement's conflict policy into trigger programs; shorthand `INSERT OR IGNORE` is not safe inside Ambit's image and board UPSERTs. A current snapshot activates immediately; a precisely dirty snapshot activates and repairs only its ledger entries; missing, legacy-dirty, or otherwise uncertain state falls back to a full rebuild. Cache builds use a generation handshake, so mutations during preparation prevent a partial projection from being committed as ready.
- An InvokeAI owner transition reserves synchronization until its target catch-up either succeeds or rolls back. Duplicate startup requests coalesce with the selected scope, same-scope startup callers share one active result, and Live Watch drains only after both the active run and owner transition have settled; unrelated callers cannot overwrite the selector's success decision. Enabled owner application refreshes the authoritative board catalog even for a current schema marker, so an owner-owned board remains visible with zero scoped members when all source members belong to other owners. A changed catch-up invalidates the image query; privacy-gated queries fetch after the target scope becomes ready instead of requiring a page reload. A required collection refresh that loses a normal newest-result-wins race retries until it applies a current scoped snapshot; genuine query failures still fail closed. Background Live Watch refreshes preserve the current settings and collection presentation: foreground preparation controls stay hidden, and collection summaries update without replacing established thumbnails or counts with pending placeholders.

## High-Risk Areas
- `src/App.tsx`: app shell integration point for selection, viewer, import, shortcuts, modals, and layout state.
- `src/contexts/SearchContext.tsx`: bridges React Query, SQL filter construction, collection refresh, and legacy store synchronization.
- `src-tauri/src/db/migrations/`: schema changes and backfills affect existing user libraries.
- `src-tauri/src/metadata/comfyui/`: parser heuristics are subtle and guarded by many Rust tests.
- `src-tauri/src/thumb/` and `src/hooks/useThumbnailQueue.ts`: native background work, SQLite updates, cancellation, and foreground throttling must stay coordinated.
- `src/services/TauriFsRepository.ts` and `src/stores/settingsStore.ts`: persistence behavior, settings migration, and folder scope registration.
