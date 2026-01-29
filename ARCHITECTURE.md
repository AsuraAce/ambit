# Ambit Project Architecture

> **Note for AI Agents**: This document is the source of truth for the project's technical structure. Read this first to understand the system.

## 1. System Overview
**Ambit** is a high-performance local AI Image Manager built on the **Tauri v2** framework. It is designed to catalog, search, and manage massive libraries (100k+ images) of AI-generated content (Stable Diffusion, Midjourney, etc.) with a "Local-First" philosophy.

The application uses a **Hybrid Architecture**:
*   **Performance-Critical Data** (Images, Search Index): Stored in **SQLite** for speed and querying power.
*   **Configuration & User Preferences**: Stored in **JSON** files for portability and simplicity.
*   **Type Safety**: Full end-to-end type safety using **Specta** to bridge Rust structs and TypeScript interfaces.

## 2. Technology Stack

### Frontend (UI)
*   **Framework**: [React 19](https://react.dev/)
*   **State Management**: 
    *   [Zustand](https://github.com/pmndrs/zustand) (Global client state)
    *   [TanStack React Query v5](https://tanstack.com/query/latest) (Server/Async state & caching)
*   **Language**: TypeScript
*   **Build Tool**: Vite
*   **Styling**: 
    *   [Tailwind CSS](https://tailwindcss.com/) (Utility-first styling)
    *   `clsx` + `tailwind-merge` (Class composition)
*   **Routing**: React Router v7
*   **Testing**: [Vitest](https://vitest.dev/) + React Testing Library

### Backend (System Integration)
*   **Core**: [Tauri v2](https://v2.tauri.app/) (Rust)
*   **Database**: `@tauri-apps/plugin-sql` (SQLite) + `rusqlite` (Native Rust access)
*   **Validation**: [Zod](https://zod.dev/) (Schema validation for external data)
*   **Error Handling**: `thiserror` (Rust error enums in `src-tauri/src/db/error.rs`)
*   **Type Safety**: `specta` + `tauri-specta` (Rust ↔ TypeScript type generation)
*   **Filesystem**: `@tauri-apps/plugin-fs` (including native watcher)
*   **Security & Hashing**: `sha2` + `hex` (Model file identification)

## 3. Data Architecture (The Hybrid Model)

The application splits its state persistence into two distinct layers based on data characteristics.

### A. The SQLite Layer (`images.db`)
*   **Purpose**: Heavy lifting. Handles relational data, massive datasets, and complex search queries.
*   **Table Structure**:
    *   `images`: usage metadata, paths, dimensions, hashes.
    *   `images_fts`: Virtual table for Full-Text Search (FTS5) functionality.
    *   `models`: Hash resolution for Checkpoints, LoRAs, and Guidance (ControlNet/IP-Adapter).
        *   Multi-layered Resolution: Local DB -> Hardcoded Signatures -> Civitai (Online) -> Heuristics.
    *   `facet_cache`: Pre-aggregated counts and metadata for fast filtering.
*   **Location**: Managed by `src/services/db`.
*   **Configuration** (PRAGMAs):
    *   `journal_mode=WAL`: Write-Ahead Logging for concurrent reads during writes.
    *   `cache_size=-64000`: 64MB cache for large libraries.
    *   `mmap_size=268435456`: 256MB memory-mapped I/O.
*   **Key Files**:
    *   `src/services/db/connection.ts`: Database connection, PRAGMAs, and concurrency mutex.
    *   `src/services/db/searchRepo.ts`: Complex SQL query generation for filtering.
    *   `src-tauri/src/db/mod.rs`: Rust-side connection helper and repository split.

### B. The JSON Layer (`library.json`)
*   **Purpose**: Lightweight, portable state.
*   **Content**: 
    *   `AppSettings`: Theme context, API keys, monitored folder paths.
    *   `Collections`: Definitions of user collections (names, IDs, filter rules).
*   **Location**: `src/services/TauriFsRepository.ts`.
*   **Storage Path**: Operating System's `AppLocalData` directory.

## 4. Key Directory Structure

```text
src/
├── components/          # Generic UI Components (Atoms/Molecules)
│   └── ui/              # Shadcn-like reusable components
├── features/            # Feature-based domain logic
│   ├── library/         # Image grid, loading logic
│   ├── filters/         # Search sidebar, facet management
│   ├── collections/     # Smart/Static collection management
│   └── viewer/          # Fullscreen image inspection
├── stores/               # Zustand store definitions
├── hooks/               # Domain-agnostic custom React Hooks
├── services/            # Business Logic & Data Access (Repos)
│   ├── db/              # SQLite repositories
│   └── api/             # External integration services
├── bindings.ts          # Specta-generated Rust types
└── types.ts             # Global TypeScript interfaces
```

## 5. Coding Standards

### React & State
*   **Zustand for UI State**: Use stores for complex UI state (e.g., active filters, collection sidebar).
*   **React Query for Data**: Favor React Query for all database/async operations. Use `useQuery` and `useMutation`.
*   **Feature-Based**: Everything related to a feature (components, hooks, types) should live in its `src/features/` folder unless it's strictly shared.

### Data Safety
*   **Validation**: All external data (File System or API) must be validated with Zod.
*   **Concurrency**: SQLite writes are wrapped in a Mutex (`src/services/db/connection.ts`) to prevent `SQLITE_BUSY` errors during massive batch imports.

### Type Safety
*   **Specta**: Never manually define types that exist in Rust. Update the Rust struct and let Specta generate `bindings.ts`.
*   **Strict Mode**: Always enabled. No `any`.
