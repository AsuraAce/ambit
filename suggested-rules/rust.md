---
trigger:
  - "src-tauri/**/*.rs"
---

# Rust & Tauri Engineering Standards

## 1. Code Style & Safety
*   **Clippy:** Ensure all code passes `cargo clippy` without warnings. Treat warnings as errors.
*   **Error Handling:**
    *   Prefer `Result<T, E>` over `unwrap()` or `expect()`.
    *   Use `?` operator for error propagation.
    *   Create custom error enums (using `thiserror`) for module-specific errors.
*   **Naming:**
    *   `snake_case` for variables, functions, and modules.
    *   `PascalCase` for structs, enums, and traits.
    *   `SCREAMING_SNAKE_CASE` for constants.

## 2. Tauri Commands
*   **Async:** All Tauri commands should be `async` unless doing trivial computation.
*   **Return Types:** Commands should return `Result<T, String>` or `Result<T, CommandError>` to properly handle failures in the frontend.
*   **State:** Use `tauri::State` for accessing shared application state (database pools, configuration).

## 3. Architecture
*   **Module Separation:** Keep `main.rs` clean. Register commands there, but implement logic in separate modules within `src-tauri/src/`.
*   **Types:** Share types with frontend via `specta` or manual interface matching. Ensure changes in Rust structs are reflected in TypeScript interfaces.
