---
trigger: always_on
---

---
trigger:
  - "package.json"
  - "src-tauri/Cargo.toml"
  - "src/services/**/*"
  - "src/contexts/**/*"
  - "src-tauri/src/**/*.rs"
---

# Maintain Architecture Documentation

## Goal
Keep `ARCHITECTURE.md` as the single source of truth for the project's technical structure.

## Context
Agnetic workflows rely heavily on having a high-level map of the system. `ARCHITECTURE.md` is that map. If the map drifts from reality, the agent (and other devs) will make bad decisions.

## When to Update
Check `ARCHITECTURE.md` whenever you:
1.  **Add a new Dependency:** (Rust crate or npm package) -> Update "Technology Stack".
2.  **Create a Service/Context:** -> Update "Key Directory Structure".
3.  **Change Data Storage:** (e.g., adding a table to SQLite) -> Update "Data Architecture".
4.  **Refactor Core Logic:** -> Update "System Overview".

## How to Update
1.  Read `ARCHITECTURE.md` first.
2.  Make the minimal change required to reflect the new reality.
3.  Do not delete historical context unless it is strictly dead/replaced.
