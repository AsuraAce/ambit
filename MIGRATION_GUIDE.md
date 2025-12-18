# AIGallery Migration & Status Guide

**Last Updated:** Phase 1 Complete (React Refactor & Architecture)

## Overview
AIGallery is a local-first Generative AI Image Organizer. 
**Phase 1 (Web Sandbox Refactor)** is complete. The application now uses a clean, component-based architecture with separated concerns, ready for the Tauri transition.

## Architecture Status

### 1. Data Layer (Repository Pattern)
- **Status:** ✅ Complete
- **Implementation:** `services/repository.ts`
- **Why:** We abstracted data access behind an interface (`IRepository`). 
- **Next Step:** Create `TauriFsRepository` implementing this interface to read/write directly to disk instead of `localStorage`.

### 2. State Management (Context)
- **Status:** ✅ Complete
- **Implementation:** `contexts/LibraryContext.tsx`
- **Why:** Eliminated prop drilling. Global state (Images, Collections, Settings) is now accessible via `useLibraryContext()`.

### 3. Logic Extraction (Hooks)
- **Status:** ✅ Complete
- **Key Hooks:**
  - `useFiltering`: Handles complex search and filter logic.
  - `useSelection`: Handles multi-select, shift-click, and drag selection.
  - `useFileOperations`: Handles Import/Export (currently Browser API).
  - `useSearch`: Handles AI Natural Language processing.

## Feature Status

| Feature | Status | Notes |
| :--- | :--- | :--- |
| **A1111/ComfyUI Parsing** | ✅ Done | Robust binary parsing of PNG chunks. |
| **Virtual Grid** | ✅ Done | Custom masonry layout engine (`services/layoutEngine.ts`). |
| **Smart Collections** | ✅ Done | Dynamic filtered views saved to state. |
| **Natural Language Search** | ✅ Done | Powered by Gemini Flash 2.5. |
| **Metadata Recovery** | ✅ Done | Reverse-engineering via Gemini Vision. |
| **Duplicate Finder** | ✅ Done | Logic isolated in `useDuplicateFinder`. |
| **Performance** | ✅ Done | Stats and Charts moved to `useLibraryStats`. |

## Roadmap: Phase 2 (Tauri Migration)

The React app is now "Clean". The next steps involve wrapping this code in Tauri and swapping the "Sandbox" services for "Native" services.

1.  **Initialize Tauri:**
    - Run `npm install @tauri-apps/cli @tauri-apps/api`.
    - Configure `tauri.conf.json`.

2.  **Swap Storage Engine:**
    - Create `services/TauriRepository.ts`.
    - Implement `load()` to read `library.json` from the user's AppData folder.
    - Implement `save()` to write to disk.

3.  **Native File Access:**
    - Update `useFileOperations.ts`.
    - Replace `<input type="file">` with `tauri.dialog.open()`.
    - Replace `URL.createObjectURL` with `convertFileSrc` (asset protocol).

4.  **File Watcher:**
    - Implement a Rust-side watcher (or `tauri-plugin-fs-watch`) to auto-import images when they appear in monitored folders.

---
*End of Guide*