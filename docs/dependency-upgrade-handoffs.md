# Dependency Upgrade Handoffs

These are deferred bot dependency upgrades that should be handled as focused engineering tasks, not blind Dependabot merges.

## Current Base

- Base branch: `origin/main`
- Base commit: `70f3bc8` (`chore(deps): bump image to 0.25.10`)
- Release PR `#62` should remain open until product work is ready for `0.5.1`.

## Branches

| Branch | Upgrade | Status | Recommended next action |
| --- | --- | --- | --- |
| `codex/upgrade-lucide-react-1` | `lucide-react` `0.554.0` -> `1.x` | Deferred: frontend typecheck failed | Replace removed `Github` icon usage, run frontend checks, and visually smoke-test icon-bearing views. |
| `codex/upgrade-typescript-6` | `typescript` `5.8.x` -> `6.x` | Deferred: many stricter type errors | Treat as a type migration. Fix nullability, callback setter, implicit-any, and test helper errors in small commits. |
| `codex/investigate-sha2-011` | `sha2` `0.10.x` -> `0.11.x` | Deferred: Rust CI failed | Investigate API or trait changes, preserve hashing behavior, and verify duplicate/file identity flows. |
| `codex/investigate-dirs-6` | `dirs` `5.x` -> `6.x` | Deferred: conflicted/path-sensitive | Review platform path behavior before upgrading; verify Windows config/data directory behavior explicitly. |

## Acceptance Criteria

- No upgrade branch should merge unless `pr-ci` passes.
- Rust dependency branches should also run `pnpm run test:rust` locally when practical.
- Frontend dependency branches should run `pnpm run typecheck`, `pnpm run test:run`, and `pnpm run build`.
- Path, filesystem, hashing, and image-related changes need targeted smoke checks, not just compile success.

## Notes

- Dependabot major versions were ignored where they were failing or noisy. Reopen or unignore only when actively working on the matching branch.
- Keep these branches separate. Combining them makes failures harder to understand and rollback risk higher.
