# Testing Rules
Frameworks: Vitest (Frontend), Cargo Test (Backend)

- **Always test**: Rust metadata parser extraction heuristics, especially against new or custom ComfyUI node variations.
- **Always test**: Database query logic and parameter binding in Rust.
- **Never test**: External GenAI API uptime, raw React rendering cycles (unless complex Virtualization is involved).
- **Test File Location**: Rust tests block-scoped or in `tests/`. Frontend tests alongside implementation (`*.test.ts`).
