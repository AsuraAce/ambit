# Progress
Status: Current
Last reviewed: 2026-07-22

## Current Baseline
- The current checkout and release manifests are version `0.9.0`: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.dev.json`, `src-tauri/Cargo.toml`, and `.github/.release-please-manifest.json` agree. The checkout is tagged `v0.9.0`; hosted release state still belongs to GitHub rather than this file.
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
