# Progress
Status: Current
Last reviewed: 2026-06-04

## Current State
- The repo is currently on package version `0.5.0`; do not infer release publication status from this file alone.
- The routed docs package is now baseline repo infrastructure: `AGENTS.md`, `docs/architecture.md`, `docs/WORKFLOW_SETUP.md`, and this file should be maintained rather than re-bootstrapped.
- Production build hardening is in progress: `app:build` now runs `verify:release` before `tauri build --ci`, and the release gate includes a no-bundle Tauri compatibility build.
- Frontend bundle cleanup has a build-output guard: `build:guard` fails if ineffective dynamic imports return or the startup entry chunk exceeds the 500 kB warning threshold.
- The Live Watch incremental facet branch now avoids the old default idle-time full facet rebuild for normal live imports. Live Watch refreshes changed resource facets through the incremental queue, while manual recovery and non-live flows retain the full rebuild fallback.
- The latest manual InvokeAI run showed the resource incremental path working as intended: browser logs emitted `mode:"resource-incremental"`, Rust resource refresh completed in about `452ms`, and the previously slow `caradhras-mix_style` LoRA refresh was about `106ms` instead of multi-second.
- Asset drill-down now uses standard disjunctive faceting semantics: selected Match Any values keep sibling alternatives visible by counting that facet against all other active filters, while Match All keeps narrowed co-occurrence counts. Checkpoints remain multi-select but Any-only because each image has one checkpoint/model, and generator tools remain Any-only in the UI.

## Current Constraints
- `package.json` defines dev, build, lint, typecheck, one-shot frontend test, coverage, Rust test, Tauri no-bundle check, and release verification scripts.
- `verify:release` runs version consistency, binding drift check, lint, TypeScript, guarded production build, coverage-backed frontend tests, Rust tests, and the no-bundle Tauri build before production desktop packaging.
- `.github/workflows/pr-ci.yml`, `.github/workflows/release-please.yml`, and `.github/workflows/release.yml` automate PR validation, versioning, and packaging; they do not replace task-specific local verification.
- `src/bindings.ts` is generated from Rust command signatures during debug Tauri runs and should not be hand-edited.
- Desktop persistence is intentionally split: SQLite stores image records and heavy metadata, `library.json` stores lightweight app settings and recent searches, and the OS keyring stores sensitive API keys.
- `src/services/repository.ts` is not the shipping desktop persistence path; treat it as legacy or fallback code unless a dedicated cleanup task explicitly changes that contract.
- Duplicate detection now treats same SHA-256 file content as an exact duplicate regardless of filename or path, and keeps metadata/dimensions/filesize matches as lower-confidence likely duplicates.
- Duplicate maintenance scans backfill missing content hashes in the native backend as a cancellable Activity Dock task; imports are not blocked on content hashing and cancel an active duplicate hash pass.
- Duplicate cleanup remains conservative: resolving duplicates removes redundant records from the Ambit library/Removed list flow rather than deleting files by default.

## Next Work
- Add browser smoke tests for lazy-loaded app surfaces: settings, dashboard, maintenance, command palette, export, viewer, compare, recovery, slideshow, and collection editor.
- Add coverage thresholds after the public-beta baseline is reviewed.
- Add a small Tauri desktop launch smoke test later, using a temporary app data/profile directory; keep installer/update testing for release packaging work.
- Production builds now use the Tauri identifier `io.github.asuraace.ambit`. Release builds run a one-time startup migration from the legacy `com.ambit.app` Roaming and Local AppData directories before SQL initialization, and reset/repair paths still check both identifiers during the public-beta transition.
- The durable engineering follow-up from earlier work still stands: clarify whether `src/services/repository.ts` remains a supported non-desktop or mock fallback, or should be retired in a dedicated cleanup.
- Live Watch still needs a separate pending-completion UX pass if we want toggle-off to distinguish "activity detected but output not complete yet" from passive idle or summary states. See `docs/refactor.md#live-watch-pending-completion-state`.
- Future asset-filter work should centralize facet taxonomy and match-mode support so hook logic, SQL filtering, browser mocks, and UI controls cannot drift. See `docs/refactor.md#facet-semantics-centralization`.
- Use this file for active repo state and durable near-term follow-ups. Move recurring structural debt to `docs/refactor.md`, and keep personal scratch planning out of tracked files.
