# Architecture Rules

- **Frontend-Backend Divide**: The React frontend must never read raw files or manage heavy algorithms. All file IO, JSON parsing, and metadata extraction *must* happen in Rust.
- **Frontend Layering**: React Components (`src/features/`, `src/components/`) manage presentation. They read from Zustand (`src/stores/`) or React Query. They dispatch actions to Tauri via wrapper functions in `src/services/db/`.
- **Database Access**: SQLite access happens exclusively in Rust. Frontend queries via Tauri commands.
- **Metadata Abstraction**: ComfyUI metadata is extracted in Rust behind a 4-layer fallback system (see `docs/COMFYUI_EXTRACTION.md`). The frontend only sees clean, evaluated parameters (Model, Prompt, Sampler).
