# AGENTS.md
Agent doc system: agent-doc-system v1.2.0

## Purpose
Ambit is a local-first desktop image manager for large AI-generated image libraries. The repo is a Tauri v2 app with a React/TypeScript frontend and a Rust/SQLite backend. Most agent tasks here touch feature UI, Tauri commands, metadata parsing, or library/query performance.

## Priorities
When working in this repository, optimize for:
1. Correctness of local-only library management and metadata handling
2. Minimal, localized changes that preserve current workflows
3. Rust-to-TypeScript type sync through Specta-generated bindings
4. Performance for large libraries and virtualized views
5. Security and path-scope safety for filesystem access

Avoid broad refactors unless the task explicitly calls for them.

## Repository Map
- `src/`: React app shell, feature UI, contexts, Zustand stores, hooks, workers, and TypeScript service adapters.
- `src/features/`: domain UI for collections, filters, library, maintenance, settings, and viewer flows.
- `src/components/`: shared layout, modals, and reusable UI primitives.
- `src/services/`: persistence adapters, Tauri-facing services, and DB helper modules.
- `src-tauri/src/`: Rust backend for Tauri commands, SQLite, metadata parsing, scanning, watcher, and security.
- `.github/workflows/`: release automation.
- `docs/`: agent docs and release workflow notes.

Start here for common tasks:
- App shell and cross-feature UI orchestration: `src/App.tsx`, `src/components/`, `src/features/`
- Search, query, and persisted UI state: `src/contexts/`, `src/stores/`, `src/hooks/`, `src/services/`
- Rust commands, DB migrations, and metadata extraction: `src-tauri/src/lib.rs`, `src-tauri/src/db/`, `src-tauri/src/metadata/`, `src-tauri/src/scanner/`
- Release automation and versioning: `docs/WORKFLOW_SETUP.md`, `.github/workflows/`

## Commands
- Install dependencies: `pnpm install`
- Web dev server: `pnpm run dev`
- Desktop dev app: `pnpm run app:dev`
- Frontend build: `pnpm run build`
- Desktop build: `pnpm run app:build`
- TypeScript check: `pnpm run typecheck`
- Frontend tests: `pnpm run test` for watch mode, `pnpm run test:run` for CI-style one-shot runs
- Coverage: `pnpm run coverage`
- Rust tests: `pnpm run test:rust`
- Release verification gate: `pnpm run verify:release`

No dedicated lint script is defined in `package.json`. Production app builds now run `verify:release` before `tauri build --ci`.

## Change Policy
- No `any`. Keep TypeScript strict.
- Do not manually edit `src/bindings.ts`. Change Rust structs or commands and regenerate bindings.
- Use React Query for async backend data and Zustand for transient UI state.
- Keep business logic in hooks or feature modules rather than growing component bodies when practical.
- Preserve virtualization for large library views; do not replace `VirtualGrid`-style flows with eager full renders.
- Keep the product local-first. Do not add cloud data flows except the user-configured Gemini analysis path.
- Respect Tauri filesystem scope registration and `APPLOCALDATA` or resource-safe access patterns.
- For SQLite filters and sorts, prefer equality-friendly predicates when semantics allow.
- Use feature branches (`feat/` or `fix/`) and conventional commits; release automation depends on that history.
- If you discover recurring structural debt that should survive the current task, record it in `docs/refactor.md`.

## Verification
- Run the narrowest relevant script from `package.json` for the area you touched.
- If you change Rust command signatures or Rust-backed types, make sure `src/bindings.ts` is regenerated or explain why not.
- If you touch search, filtering, or library rendering, verify that virtualized browsing still works for large result sets.
- If you cannot run checks, say so explicitly.

## Risky Areas
- `src/App.tsx` and `src/contexts/SearchContext.tsx`: cross-feature coordination and mixed state ownership.
- `src/features/library/components/VirtualGrid.tsx`: performance-sensitive rendering path for large libraries.
- `src/stores/settingsStore.ts` and `src/services/TauriFsRepository.ts`: settings persistence, keyring migration, and path scope registration.
- `src-tauri/src/db/`: migrations, PRAGMAs, and query behavior affect data integrity and large-library performance.
- `src-tauri/src/metadata/comfyui/`: heuristic parsing with a broad regression-test surface.

## Doc Routing
Use this file as the entry point. Do not bulk-read `docs/` unless one of the routes below is relevant.

- For current system shape and subsystem boundaries, read `docs/architecture.md`.
- For active work, constraints, and maintainer-review notes, read `docs/progress.md`.
- For release automation details, read `docs/WORKFLOW_SETUP.md`.
- For deferred structural cleanup, read `docs/refactor.md` if present.

## Completion Checklist
Before finishing, confirm:
- the change is scoped to the request
- relevant checks passed or are explicitly listed as unrun
- docs or generated bindings were updated if behavior or Rust-backed types changed
- follow-up risks or refactor candidates are called out when relevant
