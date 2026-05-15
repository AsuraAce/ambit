# Progress
Status: Current
Last reviewed: 2026-05-15

## Current State
- The repo is currently on package version `0.5.0`; do not infer release publication status from this file alone.
- The routed docs package is now baseline repo infrastructure: `AGENTS.md`, `docs/architecture.md`, `docs/WORKFLOW_SETUP.md`, and this file should be maintained rather than re-bootstrapped.
- Production build hardening is in progress: `app:build` now runs `verify:release` before `tauri build --ci`.
- The current frontend production build still has a startup chunk warning and ineffective dynamic-import warnings; keep those as public-beta release blockers until the bundle cleanup branch lands.
- The Live Watch incremental facet branch now avoids the old default idle-time full facet rebuild for normal live imports. Live Watch refreshes changed resource facets through the incremental queue, while manual recovery and non-live flows retain the full rebuild fallback.
- The latest manual InvokeAI run showed the resource incremental path working as intended: browser logs emitted `mode:"resource-incremental"`, Rust resource refresh completed in about `452ms`, and the previously slow `caradhras-mix_style` LoRA refresh was about `106ms` instead of multi-second.

## Current Constraints
- `package.json` defines dev, build, typecheck, one-shot frontend test, coverage, Rust test, and release verification scripts. There is still no dedicated lint script.
- `verify:release` runs version consistency, binding drift check, TypeScript, frontend tests, and Rust tests before production desktop builds.
- `.github/workflows/pr-ci.yml`, `.github/workflows/release-please.yml`, and `.github/workflows/release.yml` automate PR validation, versioning, and packaging; they do not replace task-specific local verification.
- `src/bindings.ts` is generated from Rust command signatures during debug Tauri runs and should not be hand-edited.
- Desktop persistence is intentionally split: SQLite stores image records and heavy metadata, `library.json` stores lightweight app settings and recent searches, and the OS keyring stores sensitive API keys.
- `src/services/repository.ts` is not the shipping desktop persistence path; treat it as legacy or fallback code unless a dedicated cleanup task explicitly changes that contract.
- Duplicate detection now treats same SHA-256 file content as an exact duplicate regardless of filename or path, and keeps metadata/dimensions/filesize matches as lower-confidence likely duplicates.
- Duplicate maintenance scans backfill missing content hashes in the native backend as a cancellable Activity Dock task; imports are not blocked on content hashing and cancel an active duplicate hash pass.
- Duplicate cleanup remains conservative: resolving duplicates removes redundant records from the Ambit library/Removed list flow rather than deleting files by default.

## Next Work
- Add browser smoke tests for lazy-loaded app surfaces: settings, dashboard, maintenance, command palette, export, viewer, compare, recovery, slideshow, and collection editor.
- Add a build-output regression guard that fails if `INEFFECTIVE_DYNAMIC_IMPORT` returns or the startup entry chunk grows past the warning threshold.
- Run coverage once to establish a baseline before adding thresholds.
- Add a small Tauri desktop launch smoke test later, using a temporary app data/profile directory; keep installer/update testing for release packaging work.
- The Tauri identifier warning is deferred intentionally. See `docs/refactor.md#tauri-bundle-identifier-migration` before changing `com.ambit.app`.
- The durable engineering follow-up from earlier work still stands: clarify whether `src/services/repository.ts` remains a supported non-desktop or mock fallback, or should be retired in a dedicated cleanup.
- Live Watch still needs a separate pending-completion UX pass if we want toggle-off to distinguish "activity detected but output not complete yet" from passive idle or summary states. See `docs/refactor.md#live-watch-pending-completion-state`.
- Use this file for active repo state and durable near-term follow-ups. Move recurring structural debt to `docs/refactor.md`, and keep personal scratch planning out of tracked files.
