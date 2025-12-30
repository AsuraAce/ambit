# Ambit Project Architecture

> **Note for AI Agents**: This document is the source of truth for the project's technical structure. Read this first to understand the system.

## 1. System Overview
**Ambit** is a high-performance local AI Image Manager built on the **Tauri v2** framework. It is designed to catalog, search, and manage massive libraries (100k+ images) of AI-generated content (Stable Diffusion, Midjourney, etc.) with a "Local-First" philosophy.

The application uses a **Hybrid Architecture**:
*   **Performance-Critical Data** (Images, Search Index): Stored in **SQLite** for speed and querying power.
*   **Configuration & User Preferences**: Stored in **JSON** files for portability and simplicity.

## 2. Technology Stack

### Frontend (UI)
*   **Framework**: [React 19](https://react.dev/)
*   **Language**: TypeScript
*   **Build Tool**: Vite
*   **Styling**: 
    *   [Tailwind CSS](https://tailwindcss.com/) (Utility-first styling)
    *   `clsx` + `tailwind-merge` (Class composition)
    *   [Radix UI](https://www.radix-ui.com/) (Headless accessible primitives)
*   **Routing**: React Router v7

### Backend (System Integration)
*   **Core**: [Tauri v2](https://v2.tauri.app/) (Rust)
*   **Database**: `@tauri-apps/plugin-sql` (SQLite)
*   **Filesystem**: `@tauri-apps/plugin-fs`

## 3. Data Architecture (The Hybrid Model)

The application splits its state persistence into two distinct layers based on data characteristics.

### A. The SQLite Layer (`images.db`)
*   **Purpose**: Heavy lifting. Handles relational data, massive datasets, and complex search queries.
*   **Table Structure**:
    *   `images`: usage metadata, paths, dimensions, hashes.
    *   `images_fts`: Virtual table for Full-Text Search (FTS5) functionality.
*   **Location**: Managed by `src/services/db`.
*   **Key Files**:
    *   `src/services/db/connection.ts`: Database connection and concurrency mutex.
    *   `src/services/db/searchRepo.ts`: Complex SQL query generation for filtering.

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
├── components/          # React UI Components
│   ├── common/          # Reusable atoms (Buttons, Inputs)
│   └── feature/         # Domain specific blocks (ImageGrid, FilterPanel)
├── contexts/            # State Management (React Context)
│   ├── LibraryContext.tsx # (Legacy) Global Aggregator
│   ├── SearchContext.tsx  # Search state, results, and filtering logic
│   └── SettingsContext.tsx # User preferences
├── hooks/               # Custom React Hooks
│   ├── useFileOperations.ts # Complex file system logic
│   └── useVirtualizer.ts    # Scroll performance logic
├── services/            # Business Logic & Data Access
│   ├── repository.ts    # Interfaces for data access
│   ├── TauriFsRepository.ts # JSON persistence implementation
│   └── db/              # SQLite repositories
└── types.ts             # Global TypeScript Database/Entity Interfaces
```

## 5. Coding Standards

### React & State
*   **Context usage**: Split large contexts. Use specific contexts (`useSearch`) over global ones (`useLibrary`) where possible.
*   **Prop Drilling**: Avoid. Use Context for data needing to pass >2 layers deep.

### Data Safety
*   **Validation**: All external data (File System or API) must be validated (Zod or strict typing).
*   **Concurrency**: SQLite writes are wrapped in a Mutex (`src/services/db/connection.ts`) to prevent `SQLITE_BUSY` errors during massive batch imports.

### Type Safety
*   **Strict Mode**: Enabled.
*   **No `any`**: Use `unknown` or narrower types.
*   **Interfaces**: Prefer `interface` for Objects, `type` for Unions.
