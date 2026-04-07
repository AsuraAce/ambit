# Implemented Systems
Log of completed systems and features. Prevents the AI from rebuilding what exists.
Updated via the `pre-commit` skill. Loaded at every session start.

**When a phase completes:**
Move that phase's entries to `IMPLEMENTED-archive.md` to keep this file lean.
Active file should only contain the current and previous phase.

---

<!-- EXAMPLE ENTRY — delete this when adding first real entry

## [System or Feature Name]
**Phase:** 1
**Completed:** YYYY-MM-DD
**What it does:** One sentence description.
**Key files:**
- `src/path/to/main-file.ts` — what it contains
- `src/path/to/other-file.ts` — what it contains
**Notes:** Anything non-obvious about the implementation worth knowing.
**Depends on:** Other systems this one relies on, if any.

-->

---

## Phase 1

## Core Image Import and DB Indexing
**Phase:** 1
**Completed:** 2026-03-18 (Found in Audit)
**What it does:** Scans, imports, and indexes images into SQLite.
**Key files:**
- `src-tauri/src/db/facets.rs`
- `src/services/importService.ts`
- `src/services/WatcherService.ts`

## Metadata Extraction Engine
**Phase:** 1
**Completed:** 2026-03-18 (Found in Audit)
**What it does:** Extracts model, prompt, and sampler parameters from A1111, InvokeAI, and ComfyUI.
**Key files:**
- `src-tauri/src/metadata/comfyui/`
- `src-tauri/src/metadata/a1111.rs`
- `src-tauri/src/metadata/invokeai.rs`

## Virtualized Library UI
**Phase:** 1
**Completed:** 2026-03-18 (Found in Audit)
**What it does:** Highly performant grid system for browsing thousands of images.
**Key files:**
- `src/features/library/`
- `src/services/layoutEngine.ts`

## Console Log Toggle
**Phase:** 1
**Completed:** 2026-04-06
**What it does:** Allows toggling console log severity via settings.
**Key files:**
- `src/utils/logger.ts` — Global proxy wrapper for window.console
- `src/components/AppLayout.tsx` — Installs the logger
- `src-tauri/src/lib.rs` — Rust backend log filtering (default Info)
**Notes:** The backend uses `RUST_LOG` and defaults to Info, while the frontend dynamically uses the persisted interface dropdown.

---

## Archive Notice
<!-- [YYYY-MM-DD] Phase N archived to IMPLEMENTED-archive.md -->
