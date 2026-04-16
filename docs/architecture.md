# Architecture
Status: Canonical
Last reviewed: 2026-04-16

## System Overview
Ambit is a Tauri v2 desktop app with a React/TypeScript frontend and a Rust backend exposed through Tauri commands. Images and heavy metadata live in SQLite, lightweight app state lives in `library.json` under app-local data, and sensitive secrets such as the Gemini API key live in the OS keyring.

## Major Subsystems

### Desktop Shell and Command Surface
Purpose: boot the Tauri app, register plugins, manage app-scoped state, and export Specta bindings.
Code: `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src/bindings.ts`
Interacts with: frontend services that call `commands.*`, Tauri plugins for SQL, filesystem, dialog, shell, and window state
Risks: command signature changes can break TypeScript callers; debug Tauri runs overwrite `src/bindings.ts`
Related docs: `docs/progress.md#current-constraints`

### SQLite Data, Migrations, and Maintenance
Purpose: store image records, parsed metadata, facet caches, backups, reparsing state, and database maintenance behavior.
Code: `src-tauri/src/db/`
Interacts with: Rust scanner and metadata modules, TypeScript repo modules under `src/services/db/`, settings-backed folder sync
Risks: PRAGMA or migration changes affect startup, large-library performance, and data integrity
Related docs: `docs/refactor.md#persistence-boundary-cleanup`

### Metadata Extraction, Scanning, and Watcher Flows
Purpose: scan image files, extract metadata and workflows, resolve models, and watch library folders.
Code: `src-tauri/src/scanner/`, `src-tauri/src/metadata/`, `src-tauri/src/watcher.rs`, `src-tauri/src/fs_commands.rs`, `src-tauri/src/security.rs`
Interacts with: frontend import, settings, maintenance, and viewer flows
Risks: parser heuristics and watcher behavior can create wrong metadata or miss library changes; external path handling must stay scoped and local
Related docs: `docs/WORKFLOW_SETUP.md`

### Frontend App Shell and Feature Surfaces
Purpose: render the desktop UI, modals, viewer, filter panel, maintenance screens, and settings flows.
Code: `src/index.tsx`, `src/App.tsx`, `src/components/`, `src/features/`
Interacts with: contexts, stores, hooks, `src/services/`, generated bindings, and Tauri plugins
Risks: `src/App.tsx` coordinates many cross-feature concerns, so changes can regress areas outside the touched feature
Related docs: `docs/refactor.md#frontend-state-and-shell-coordination`

### Query, State, and Persistence Adapters
Purpose: own frontend query flows, transient UI state, JSON-backed settings and recent-search persistence, and database helper modules.
Code: `src/contexts/`, `src/stores/`, `src/hooks/`, `src/services/`
Interacts with: `src/features/`, `src/bindings.ts`, `src-tauri/src/db/`, app-local `library.json`
Risks: state ownership is split across React Query, contexts, Zustand, and repository adapters, which makes duplicate sources of truth easy to introduce
Related docs: `docs/progress.md#active-workstreams`, `docs/refactor.md#frontend-state-and-shell-coordination`

## Invariants
- SQLite is the source of truth for image records and heavy metadata. `library.json` should not become a second image store.
- Rust-exposed command and type changes should flow through Specta into `src/bindings.ts`; do not hand-maintain Rust-backed TypeScript mirrors.
- Filesystem access must remain local-only and within Tauri-registered or scoped paths.
- API keys are stored via Rust keyring commands, not persisted in `library.json`.
- Large library browsing paths must remain virtualized and performance-conscious.

## High-Risk Areas
- `src/App.tsx`: app shell integration point for selection, viewer, import, shortcuts, modals, and layout state.
- `src/contexts/SearchContext.tsx`: bridges React Query, SQL filter construction, collection refresh, and legacy store synchronization.
- `src-tauri/src/db/migrations/`: schema changes and backfills affect existing user libraries.
- `src-tauri/src/metadata/comfyui/`: parser heuristics are subtle and guarded by many Rust tests.
- `src/services/TauriFsRepository.ts` and `src/stores/settingsStore.ts`: persistence behavior, settings migration, and folder scope registration.
