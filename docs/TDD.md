# Technical Design Document — Ambit
**Version:** 0.2
**Last Updated:** 2026-03-18
**AI Dev Note:** Paste relevant sections alongside the PDD for implementation sessions.
You do not need the full document every session — load the sections relevant to the task.

---

## 1. System Overview

Ambit is a high-performance local AI Image Manager built on the Tauri v2 framework. It is designed to catalog, search, and manage massive libraries (100k+ images) of AI-generated content (Stable Diffusion, Midjourney, etc.) with a strict "Local-First" philosophy.

```text
┌─────────────────────────────────────────────────────┐
│                    Tauri Window                     │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              React UI Layer                   │  │
│  │  /src/features/ — components, viewers, grids  │  │
│  │  Reads from Zustand store / React Query       │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │ actions / hooks        │
│  ┌──────────────────────▼────────────────────────┐  │
│  │             State & Services                  │  │
│  │  /src/stores/ — UI state                      │  │
│  │  /src/services/ — API calls, DB wrappers      │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │ IPC Commands           │
│  ┌──────────────────────▼────────────────────────┐  │
│  │                 Tauri Core                    │  │
│  │  /src-tauri/src/ — Rust logic                 │  │
│  │  /metadata/ — ComfyUI evaluator, strategies   │  │
│  └──────────────────────┬────────────────────────┘  │
│                         │ SQL                    │
│  ┌──────────────────────▼────────────────────────┐  │
│  │                SQLite                         │  │
│  │  rusqlite + tauri-plugin-sql                  │  │
│  │  /src-tauri/src/db/ — migrations, schema      │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

The application uses a **Hybrid Architecture**:
*   **Performance-Critical Data** (Images, Search Index): Stored in SQLite for speed and querying power.
*   **Configuration & User Preferences**: Stored in JSON files for portability and simplicity.
*   **Type Safety**: Full end-to-end type safety using Specta to bridge Rust structs and TypeScript interfaces.

---

## 2. Tech Stack — Locked

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | React + Tauri | 19 / v2 | Desktop app format with web UI |
| Frontend Lang | TypeScript | 5.8 | Strict typing |
| Backend Lang | Rust | 1.77+ | High-performance OS operations |
| State | Zustand | latest | Global client UI state |
| Data Fetch | React Query | v5 | Server/Async state & caching |
| Build | Vite | 6 | Frontend bundler |
| Styling | Tailwind CSS | v3/v4 | Utility-first styling with `clsx` + `tailwind-merge` |
| Routing | React Router | v7 | SPA routing |
| Database | SQLite | latest | Native rust access via `rusqlite` + `@tauri-apps/plugin-sql` |
| Validation | Zod | latest | Schema validation for external data |
| Types API | Specta | latest | `specta` + `tauri-specta` for auto-generated TS bindings |

---

## 3. Architecture Boundaries & File Ownership

### Frontend calls Backend via IPC
- Frontend `/src/services/db/` wraps Tauri invoke calls.
- `src/bindings.ts` (Specta-generated) defines the type boundaries between Rust and TypeScript.

### Rust Backend owns heavy lifting
- File System operations (using native watcher `@tauri-apps/plugin-fs`).
- Security Hashing (`sha2` + `hex`).
- Rust connects directly to SQLite (`rusqlite`) for performance. React never parses massive JSON DB files directly.

### File Ownership Map

| Directory | Owns | May import from |
|---|---|---|
| `/src/features/` | React components categorized by feature (e.g. `library`, `filters`, `viewer`) | `/src/components/`, `/src/hooks/`, `/src/stores/` |
| `/src/components/ui/` | Generic Shadcn-like reusable UI components | `/src/utils` |
| `/src/services/` | Business Logic / Data Access Repos (wrappers for Tauri IPC/GenAI) | `/src/types.ts`, `/src/bindings.ts` |
| `/src/stores/` | Zustand stores for UI state | `/src/types.ts` |
| `/src-tauri/src/metadata/` | Metadata extraction logic, ComfyUI evaluator | `serde`, backend utils |
| `/src-tauri/src/db/` | Database repositories, SQL migrations (`rusqlite`) | `thiserror` (`src-tauri/src/db/error.rs`) |

---

## 4. State Management

React Query handles async backend state (e.g., fetching images, searching).
Zustand holds the UI-relevant data cache (e.g., selected items, active collection sidebar, filter toggles).

**Frontend Pattern:**
Everything related to a feature should live in its `src/features/` folder. Filter components dispatch queries via React Query for data, and read from Zustand for layout preference.

---

## 5. Data Architecture (The Hybrid Model)

The application splits persistence into two layers based on data characteristics.

### A. The SQLite Layer (`images.db`)
*   **Purpose**: Heavy lifting. Handles relational data, massive datasets, and complex search queries.
*   **Table Structure**:
    *   `images`: Usage metadata, paths, dimensions, hashes.
    *   `images_fts`: Virtual table for Full-Text Search (FTS5) functionality.
    *   `models`: Hash resolution for Checkpoints, LoRAs, and Guidance (Multi-layered resolution: Local DB -> Signatures -> Civitai -> Heuristics).
    *   `facet_cache`: Pre-aggregated counts and metadata for fast filtering.
*   **Database Configuration** (PRAGMAs):
    *   `journal_mode=WAL`: Write-Ahead Logging for concurrent reads during writes.
    *   `cache_size=-64000`: 64MB cache for large libraries.
    *   `mmap_size=268435456`: 256MB memory-mapped I/O.
*   **Concurrency**: SQLite writes are wrapped in a Mutex (`src/services/db/connection.ts`) to prevent `SQLITE_BUSY` errors during massive batch imports.

### B. The JSON Layer (`library.json`)
*   **Purpose**: Lightweight, portable state.
*   **Location**: Managed via `src/services/TauriFsRepository.ts` in the OS `AppLocalData` directory.
*   **Content**: `AppSettings` (Theme context, API keys, monitored folders) and `Collections` (Definitions of user collections, IDs, filter rules).

---

## 6. ComfyUI Metadata Extraction System

*Detailed comprehensively in `docs/COMFYUI_EXTRACTION.md`*
- **Layer 1:** Archival (Workflow JSON)
- **Layer 2:** Explicit Metadata Nodes (User Override/Prompt savers)
- **Layer 3:** Graph Evaluator (Backwards static analysis traversal from Output -> Sampler -> Model/Prompt)
- **Layer 4:** Global Scan (Fallback heuristics)

---

## 7. Coding Standards & Validation

*   **Validation**: All external data (File System or API) must be validated with Zod.
*   **Type Safety**: Never manually define types that exist in Rust. Update the Rust struct, derive `Type`, and let Specta generate `src/bindings.ts`. Strict mode is always enabled.
*   **Testing Approach**:
    *   **Frontend**: Vitest + React Testing Library for utility logic.
    *   **Backend**: `cargo test` for Rust db repositories and metadata extraction heuristics.
