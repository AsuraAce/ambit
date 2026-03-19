# Knowledge Base
Non-obvious findings, gotchas, and solutions discovered during development.
Updated via the `pre-commit` skill. Loaded at every session start.

**Lifecycle:**
- `one-off` → stays here, archived when >15 active entries
- `candidate-rule` → pre-commit will prompt to graduate to a rules file
- `graduated` → already moved to rules/TDD, archived at next review
- `obsolete` → problem no longer exists, deleted at next review

**Active entries below. Most recent first.**

---

## [2026-03-19] — Test Environment Strategies
**Status:** candidate-rule
**Area:** #testing #react #rust
**Context:** Fixing 100+ failing UI and Rust unit tests across the Ambit project after major refactors.
**Finding:** 
1. React hooks relying on `react-query` or `zustand` fail with "No QueryClient set" or "Cannot destructure property" when tests do not provide the necessary Contexts.
2. Rust SQLite tests asserting cache behavior were panic-failing due to mismatching constraint strings (e.g. `'checkpoint'` vs `'checkpoints'`) causing constraint violations on tear-down.
**Solution:** 
1. Implement a unified `testUtils.tsx` wrapper that dynamically wraps all components and hooks under test in `QueryClientProvider`, `BrowserRouter`, `ToastProvider`, and `LibraryProvider`.
2. Strictly enforce literal typing for SQLite Enum replacements in Rust DB layers.
**Action:** → Consider graduating to `docs/testing.md`.

<!-- EXAMPLE ENTRY — delete this when adding first real entry

## [YYYY-MM-DD] — Short descriptive title
**Status:** one-off | candidate-rule | graduated | obsolete
**Area:** #tag1 #tag2
**Context:** What were you trying to do?
**Finding:** What was non-obvious, wrong, or worth knowing?
**Solution:** What fixed it or what is the correct pattern?
**Action:** → [candidate-rule: "Should move to X"] [graduated: "Moved to X on YYYY-MM-DD"]

-->

---

## Review Log
<!-- When a review happens, log it here: [YYYY-MM-DD] Review — N entries archived, N graduated -->
