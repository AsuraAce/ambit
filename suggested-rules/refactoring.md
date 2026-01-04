---
trigger:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.rs"
---

# Refactoring Standards

## 1. Safety First
*   **Tests Required:** Never refactor without ensuring there are tests covering the code. If no tests exist, write them *before* refactoring.
*   **Small Steps:** Make small, incremental changes. Commit often (or ask the agent to verify often).

## 2. Code Quality
*   **DRY (Don't Repeat Yourself):** Extract repeated logic into functions or hooks.
*   **Single Responsibility:** Functions and components should do one thing well.
*   **Dead Code:** Aggressively remove unused variables, imports, and functions.

## 3. Human Readability
*   **Naming:** Variable names should explain *what* they contain. Function names should explain *what* they do.
*   **Comments:** Comment *why*, not *what*. Code tells you what it does; comments tell you why it was done that way.
