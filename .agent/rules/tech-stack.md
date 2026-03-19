# Tech Stack Rules

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.8 |
| Build Tool | Vite 6 |
| Styling | Tailwind CSS v3/v4 |
| UI State | Zustand |
| Data Fetching | React Query |
| Backend Runtime | Tauri v2 (Rust 1.77+) |
| Database | SQLite (rusqlite) |
| Integrations | Google GenAI |

- Strictly enforce TypeScript and Rust types.
- Ensure Rust-to-TypeScript bindings are properly synced using `specta` / `tauri-specta`.
- Do not suggest frameworks that violate local-first architecture (e.g., Firebase, Supabase auth).
- Prefer local performance optimizations (Virtualized lists, indexed SQLite queries) over cloud offloading.
