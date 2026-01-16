---
name: bootstrap_project_rules
description: Generates standard rules and agent configuration for a new or migrating project, adapting to the tech stack.
---

# Bootstrap Project Rules Skill

Use this skill when initializing the agent in a new repository or "Antigravity-ifying" an existing one.

## 1. Analyze Tech Stack
Before creating rules, check the root directory to identify the technology.

*   **React/Node**: Exists `package.json`?
*   **Rust**: Exists `Cargo.toml`?
*   **Python**: Exists `requirements.txt`, `pyproject.toml`, or `Pipfile`?
*   **Go**: Exists `go.mod`?

## 2. Generate Context-Aware Rules
Create `.agent/rules/` and populate it based on the analysis.

### Universal Rules (Always Create)
*   **`refactoring.md`**: The "Safety First" protocol (Tests required, Small steps).
*   **`tech_stack.md`**: Create a placeholder to list discovered tech (e.g., "Language: TypeScript, Framework: React").

### Stack-Specific Rules
*   **If React/Node**:
    *   Create `react.md`: Hooks usage, No Any, Functional Components.
    *   Create `testing.md`: Vitest/Jest standards.
*   **If Rust**:
    *   Create `rust.md`: Clippy strictness, Error handling (Result<T,E>), Modularity.
*   **If Python**:
    *   Create `python.md`: Type hinting (MyPy), PEP8, Virtual Envs.

## 3. Configure Agent
Ensure `.agent/config.yaml` exists if required.

## 4. Checklist
- [ ] **Analysis**: Did I check `package.json` / `Cargo.toml`?
- [ ] **Universal**: `refactoring.md` created?
- [ ] **Targeted**: Did I create `rust.md` only if it's a Rust project (or `react.md` for React)?
