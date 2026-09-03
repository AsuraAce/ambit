# Progress
Status: Current
Last reviewed: 2026-07-29

## Current Baseline
- The current checkout and release manifests are version `0.9.1`: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.dev.json`, `src-tauri/Cargo.toml`, and `.github/.release-please-manifest.json` agree. The checkout is based on the `0.9.1` main release commit; hosted tag and release state still belong to GitHub rather than this file.
- Release builds remain Windows-only. Linux and macOS packages are manual, unsigned or non-updater experimental artifacts as documented in `docs/experimental-unix-builds.md`.
- Production packaging runs `verify:release` before Tauri builds. The gate checks version consistency, generated binding drift, lint, TypeScript, guarded frontend output, coverage, Rust tests, and a no-bundle Tauri compatibility build.
- ComfyUI metadata milestones 22 through 26 are complete. Their files under `docs/plans/` are historical verification records, not active work.
- The search-transition, prompt-masking, setup-guide replay, and tooltip-dismissal packages recorded in `docs/plans/release-0.9.0-ux-readiness.md` landed before the `v0.9.0` release.

## Current Constraints
- Specta binding generation is explicit. Do not expect a debug Tauri launch to update `src/bindings.ts`; run `pnpm run bindings:generate`, then `pnpm run bindings:check`.
- Desktop persistence is intentionally split: SQLite stores image records and heavy metadata under Local AppData, `library.json` stores lightweight app settings and recent searches, and the OS keyring stores sensitive API keys.
- `src/services/repository.ts` is not the shipping desktop persistence path. Treat its LocalStorage/mock behavior as an ambiguous fallback until a dedicated task either validates or retires it.
- Exact duplicate detection is a global SHA-256 scan. Cleanup merges safe keeper state and collection memberships, moves redundant records through the Removed flow, and does not delete files by default.
- The `io.github.asuraace.ambit` identifier is current. Startup migration and reset/repair paths still account for legacy `com.ambit.app` Local and Roaming AppData during the public-beta transition.

## Active Follow-Ups
- Photography support Milestone 1 is engineering-complete in
  `docs/plans/photography-support.md` from the `0.9.1` main baseline. Work
  Package 1 established the bounded JPEG photo contract and deferred TIFF;
  Work Package 2 completed the persisted camera-JPEG slice: source/photo
  contracts, migration 63, scan and persistence integration, Remove/Restore
  parity, orientation-aware thumbnail versioning, indexed source/display dates,
  and the minimum neutral viewer. Work Package 3 implementation is complete:
  mixed-library filters and scoped counts, effective-date browsing,
  transactional single/bulk
  kind correction, restart-safe photo refresh checkpointing, format-neutral
  import copy/counts, accessibility, and mixed browser fixtures are implemented.
  Focused regression, rendered mixed-library QA, the isolated Windows Tauri
  journey, and the final integration review pass are complete. Native acceptance covered a
  1,056-image catalog, orientation/details, manual and automatic kind changes,
  cancel/restart/resume, Remove/Restore, virtualized tail browsing, keyboard
  navigation, source hashes, and separation from production/development
  profiles. A closure review resolved six persistence, refresh, thumbnail, and
  local-state findings with no blocking item left open. The post-remediation
  gate passed 87 focused frontend tests, all 546 Rust tests, TypeScript, Cargo
  formatting, diff checks, the release gate's frontend/coverage stages, and the
  optimized no-bundle Tauri build. The product owner accepted the rendered
  experience on 2026-07-29, completing Milestone 1. The plan records five UX and
  positioning observations as follow-up work for a future planning phase.
- `docs/plans/release-0.9.0-ux-readiness.md` was overtaken by the `v0.9.0` release and is no longer a live release gate. Its Work Package 3 (initial Smart Collection thumbnail hydration) and Work Package 4 (discoverable duplicate-group navigation) remain unversioned product follow-ups.
- Add browser smoke coverage for lazy-loaded app surfaces, including settings, statistics, maintenance, command palette, export, viewer, compare, recovery, slideshow, and collection editing.
- Add coverage thresholds after the public-beta baseline is intentionally reviewed.
- Add a small Tauri desktop launch smoke test using a temporary app-data/profile directory; keep installer and updater validation in the release-candidate workflow.
- Decide whether `src/services/repository.ts` remains a supported non-desktop/mock fallback or should be retired in dedicated cleanup.
- Keep structural follow-ups in `docs/refactor.md`; notably Live Watch pending-completion UX and facet-semantics centralization remain deferred there.

## Status Routing
- Use this file for moving repository state and near-term follow-ups.
- Use `docs/release-candidate-validation.md` for release-asset, updater, and installed-app evidence.
- Treat plans marked `Complete` or `Superseded` as historical. Do not infer active work from a pending item inside a superseded plan without reconciling it here.
- Use `docs/refactor.md` for actionable deferred structural work, not release status or session notes.
