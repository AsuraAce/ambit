# Product Design Document — Ambit
**Version:** 0.1
**Phase:** 1 — Private GitHub Release
**Last Updated:** 2026-03-18
**AI Dev Note:** This document is written for an AI coding assistant.
Paste at session start when working on features, flows, or data design.
Paste the TDD alongside this for implementation sessions.

---

## What This Is
Ambit is a high-performance, local-first image manager specifically designed to catalog, search, and manage massive libraries of AI-generated content (Stable Diffusion, Midjourney, ComfyUI, etc.). It automates the extraction and parsing of complex generation metadata (like ComfyUI workflows) and presents the library in a beautiful, highly filterable UI.

---

## Who It's For
Users looking for a privacy-respecting, native-feeling tool to organize large collections of AI-generated images without relying on cloud services. The immediate target is a private GitHub release for early testing, followed by a public open-source release.

---

## Core Value
- **Local-first architecture**: All data stays on the user's machine.
- **Intelligent Extraction**: Simulates ComfyUI graphs and parses metadata effectively.
- **High Performance**: Designed to handle 100k+ images using SQLite and virtualized UI grids.
- **AI-Enhanced Features**: Uses local Google GenAI exclusively for prompt analysis, prompt recovery, and natural language search—not for simple tagging.

---

## Key Features — Phase 1 Only

### Import & Metadata Extraction
- Folder scanning and image ingestion.
- 4-Layer ComfyUI Extraction Strategy (Archival, Explicit Nodes, Graph Evaluator, Global Scan).
- Fallback strategies for broken workflows and custom nodes.

### Library UI & Visualization
- High-performance Virtualized Grid for thousands of items.
- Timeline View for chronological browsing.
- Detailed Metadata Edit Tab and Inspector.

### Search & Filtering
- Filter by model, sampler, prompt keywords, dimension, and date.
- Natural language search capabilities leveraging Google GenAI.

---

## User Flows

### Flow 1 — Image Ingestion
1. User selects a local directory to watch or import.
2. Backend (Rust) processes files, reads metadata chunks (e.g., PNG tEXt/iTXt), and executes the ComfyUI metadata extraction heuristics.
3. Relevant parameters (prompt, model, sampler) are extracted and saved to local SQLite db.
4. UI updates immediately to reflect newly imported items.

### Flow 2 — Natural Language Search
1. User enters a conceptual query (e.g., "dark fantasy landscapes with castles").
2. Query is analyzed (via GenAI integration) to map to likely prompts/metadata.
3. System filters the SQLite database and updates the UI grid instantly.

### Flow 3 — Prompt Recovery
1. User clicks an image in the grid.
2. Metadata inspector opens, displaying the exact generation parameters.
3. User can one-click copy the prompt or entire workflow JSON to clipboard for reuse in ComfyUI.

---

## Scope and Phases

### Phase 1 — Private Release (Current focus)
- [x] Core image import and SQLite indexing.
- [x] ComfyUI extraction engine (graph traversal).
- [x] Virtualized grid and basic UI layout.
- [ ] Polish, bug fixes, and preparation for private GitHub deployment.

### Phase 2 — Public Release
- Open source public launch.
- Comprehensive user documentation.

### Phase 3 — Extended
- Broader support for niche custom ComfyUI nodes.
- Ongoing improvements to GenAI prompt analysis.

---

## Out of Scope — Permanent
- **Cloud sync or web storage** — local only by design.
- **Built-in Image Generation** — Ambit is an organizer, not an SD/ComfyUI runner.
- **Simple Tagging** — Relies on prompt analysis/natural language search instead of manual boolean tags.

---

## Open Questions
The AI must not guess at these — ask the user.
- Which specific ComfyUI custom nodes are currently failing extraction and need immediate support?
- What are the precise performance targets for image ingestion (e.g., 1000 images / second)?
