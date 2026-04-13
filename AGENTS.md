# AGENTS.md - Ambit Project Instructions

This file provides the core instructions, coding standards, and project context for AI agents working on the Ambit project. It is read at the start of every session to ensure consistency and adherence to local-first, high-performance engineering standards.

## 🚀 Project Overview
**Ambit** is a high-performance, local-first AI Image Manager built on **Tauri v2 + React**. 
- **Goal:** Catalog and manage 100k+ AI-generated images (Stable Diffusion, Midjourney, Flux, etc.).
- **Philosophy:** Privacy-first, local-only data storage, and deep metadata extraction (ComfyUI graphs).

## 🛠️ Tech Stack & Architecture
- **Frontend:** React 19, TypeScript 5.8, Zustand (UI State), React Query v5 (Data), Tailwind CSS.
- **Backend:** Rust 1.77+, Tauri v2, SQLite (rusqlite).
- **Bridge:** Specta + `tauri-specta` for auto-generated TypeScript bindings in `src/bindings.ts`.
- **Database:** SQLite is the source of truth for heavy data. `PRAGMA journal_mode=WAL` is enabled.

## 📜 Core Coding Rules

### 1. Type Safety First
- **NO `any`:** Never use `any`. Use strict TypeScript types.
- **Rust-TS Sync:** Do NOT manually define TypeScript interfaces for data that exists in Rust. Update the Rust struct, derive `specta::Type`, and let the generator update `src/bindings.ts`.

### 2. Performance Standards
- **SQLite Equality:** When querying/sorting in SQLite, prefer equality checks over inequality. 
  - *Bad:* `IFNULL(col, 0) != 1` 
  - *Good:* `IFNULL(col, 0) = 0` (allows index spanning for sorts).
- **Virtualized Grids:** All large lists must use virtualization (see `VirtualGrid.tsx`).

### 3. State Management
- **Zustand:** Use for transient UI state (sidebar open, active tab).
- **React Query:** Use for all asynchronous data fetching from the Tauri/Rust backend.
- **Hooks:** Business logic should be encapsulated in custom hooks in `src/hooks/` or `src/features/X/hooks/`.

### 4. File System & Security
- **Local-Only:** Never implement features that send image data or prompts to external cloud services (except for the user-configured Gemini API for analysis).
- **Path Protection:** Always use `APPLOCALDATA` or `RESOURCE` scopes for Tauri FS operations.

## 🤖 AI Agent Workflow
- **No Cloud Agents:** Do NOT attempt to use GitHub-hosted Gemini Agents. We have disabled them to avoid API costs and privacy concerns.
- **Clever Context:** Do NOT read all `docs/*.md` files by default. Use this `AGENTS.md` file as an index to pinpoint only the relevant documentation for the current task.
- **Active Refactor (Refactor-Before-Act):** 
  - ALWAYS check `docs/REFACTOR.md` before starting a task. 
  - If a file you are about to touch is on the Refactor Log, flag it to the user and ask if we should refactor it before or after the change.
  - If you identify technical debt during a task, add it to `docs/REFACTOR.md` immediately upon completion.
- **PR Workflow:** Always use a feature branch (`feat/` or `fix/`) and provide a clear **Conventional Commit** message.
- **Release Automation:** We use `release-please`. Your commit messages (e.g., `feat:`, `fix:`) directly generate the `CHANGELOG.md`.

## 📚 Reference Documentation
For deep dives into specific subsystems, refer to:
- `docs/PDD.md`: Product Design & Goals.
- `docs/TDD.md`: Technical Architecture & Stack.
- `docs/KNOWLEDGE.md`: Non-obvious fixes and gotchas.
- `docs/COMFYUI_EXTRACTION.md`: Logic for parsing AI metadata.
- `docs/WORKFLOW_SETUP.md`: How to manage releases.
