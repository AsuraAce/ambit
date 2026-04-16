# Progress
Status: Draft
Last reviewed: 2026-04-16

## Active Workstreams

### Agent Doc System Bootstrap
Status: In progress
Goal: give agents a small routed documentation package grounded in the current repo rather than a policy-only `AGENTS.md`.
Completed:
- Existing repo guidance already captured the local-first, type-safety, and performance rules.
- `docs/WORKFLOW_SETUP.md` already documents the release-please flow and packaging workflow.
- Tier 1 docs are being added: `AGENTS.md`, `docs/architecture.md`, and this file.
Remaining:
- Maintainer review of routes, commands, and status wording.
- Keep future active work here instead of overloading `AGENTS.md`.
Next:
- Update this file when active work, blockers, or temporary constraints change materially.
- Promote recurring structural cleanup into `docs/refactor.md` only when it repeatedly affects safe edits.
Notes for agents:
- This is the only explicit active task evidenced in the repo on 2026-04-16.

### Build and Typecheck Snapshot Cleanup
Status: Draft
Goal: confirm whether the checked-in error snapshots at the repo root still reflect the current tree.
Completed:
- `build_errors.txt` and `build_errors_2.txt` both capture failures in `src/hooks/useStacking.ts`.
- `tsc_check.txt` captures a missing `./AdvancedTab` import from `src/features/settings/components/SettingsTabs.tsx`.
- `src/features/settings/components/SettingsTabs.tsx` is not present in the current tree, so `tsc_check.txt` is at least partially stale.
Remaining:
- Re-run a current typecheck command and compare the live output to those snapshots.
- Remove or refresh stale snapshots so they do not mislead future work.
Next:
- Decide whether the root-level snapshot files are temporary debugging artifacts or intended handoff notes.
Notes for agents:
- Treat the snapshot files as evidence, not as canonical current build status.

## Current Constraints
- `package.json` defines dev, build, test, coverage, and Rust test scripts, but no dedicated lint or typecheck script.
- `.github/workflows/release-please.yml` and `.github/workflows/release.yml` automate versioning and packaging; they do not replace task-specific local verification.
- `src/bindings.ts` is generated from Rust commands during debug Tauri runs and should not be hand-edited.
- Frontend persistence is intentionally split: SQLite holds images and metadata, `library.json` holds lightweight app settings and recent searches, and the OS keyring holds sensitive API keys.
- Additional active engineering work is unknown from repo evidence alone and needs maintainer input.

## Maintainer Review Needed
- Confirm whether the build snapshot files at the repo root are still useful or should be deleted.
- Confirm whether the web or mock repository path in `src/services/repository.ts` is still intentional.
- Add explicit workstreams here when there is a durable in-repo source of truth for them.
