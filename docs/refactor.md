# Refactor Notes
Status: Deferred
Last reviewed: 2026-04-16

## How to Use This File
Use this file to record deferred structural cleanup that changes how contributors should edit the repo safely. Keep active workstreams and short-lived blockers in `docs/progress.md`.

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

### Current Classification
- `src/services/repository.ts` is not the canonical desktop persistence path today; it exports `TauriFsRepository` for the shipping app while still carrying a LocalStorage or mock fallback.
- Treat that fallback path as ambiguous legacy surface unless a dedicated task explicitly keeps, validates, or removes non-Tauri mode.

### Current Pain Points
- It is easy to modify the wrong persistence layer or leave migrations half-finished.
- Startup, onboarding, folder scope registration, and secure key handling all depend on coordinated changes across TypeScript and Rust.

### Safe-Change Warning
- Persistence changes can silently affect existing user libraries and first-run behavior.

### Suggested Future Direction
- Make the production Tauri persistence path the obvious canonical path in the frontend.
- Keep the storage split explicit and narrow: SQLite for images and metadata, `library.json` for lightweight app state, keyring for secrets.
- Resolve `src/services/repository.ts` intentionally: either document the fallback as supported, or remove it in a dedicated cleanup once the repo explicitly drops that mode.

### Not Part of the Current Task
- Do not delete web or mock fallbacks unless the repo intentionally drops that mode.

### Related Code
- `src/services/repository.ts`
- `src/services/TauriFsRepository.ts`
- `src/stores/settingsStore.ts`
- `src-tauri/src/db/`
- `src-tauri/src/security.rs`

### Related Docs
- `docs/architecture.md#sqlite-data-migrations-and-maintenance`
- `docs/architecture.md#desktop-shell-and-command-surface`

## Smart Thumbnail Optimization Startup Cost
Status: Deferred

### Why Cleanup Is Needed
- The visible Maintenance thumbnails tab was removed; `src/features/maintenance/components/MaintenanceTabs.tsx` documents that background healing now owns thumbnail regeneration.
- `src/hooks/useThumbnailQueue.ts` still starts Smart Thumbnail Optimization automatically after a short startup delay when `enableAutoThumbnailHealing` is enabled.
- The queue processes thumbnails in small batches and pauses during import or sync, but it begins by running full-library unoptimized-thumbnail count queries. On large production libraries, those count scans can still compete with normal browsing and search.
- Legacy thumbnail-maintenance UI code such as `ThumbnailsTab` and thumbnail scan paths remains in the tree even though it is no longer reachable from the visible maintenance tabs.

### Current Pain Points
- Startup can feel responsive overall while background thumbnail work still creates intermittent SQLite load shortly after launch.
- The initial `getUnoptimizedImagesCount` query answers "how many total?" before doing useful work, which is expensive for large libraries and not always necessary.
- Dead or latent thumbnail maintenance UI code makes it harder to know which thumbnail repair path is canonical.

### Safe-Change Warning
- Thumbnail work touches SQLite, filesystem scope, scanner commands, React Query image caches, and user-facing thumbnails. Avoid mixing this cleanup with unrelated maintenance UI work.
- Do not remove manual Advanced settings actions for clearing or verifying thumbnails unless a replacement workflow is explicitly designed.

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
