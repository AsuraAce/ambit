# Progress
Status: Current
Last reviewed: 2026-05-01

## Current State
- `0.3.0` is live on GitHub and closes the CI/release normalization work that stabilized PR checks, release tags, and multi-platform publishing.
- The routed docs package is now baseline repo infrastructure: `AGENTS.md`, `docs/architecture.md`, `docs/WORKFLOW_SETUP.md`, and this file should be maintained rather than re-bootstrapped.
- `main` currently typechecks clean via `.\node_modules\.bin\tsc.cmd --noEmit`.
- Root snapshot files such as `build_errors.txt`, `build_errors_2.txt`, and `tsc_check.txt` were stale debugging artifacts and are no longer tracked as current build-status handoff files.
- The Live Watch incremental facet branch now avoids the old default idle-time full facet rebuild for normal live imports. Live Watch refreshes changed resource facets through the incremental queue, while manual recovery and non-live flows retain the full rebuild fallback.
- The latest manual InvokeAI run showed the resource incremental path working as intended: browser logs emitted `mode:"resource-incremental"`, Rust resource refresh completed in about `452ms`, and the previously slow `caradhras-mix_style` LoRA refresh was about `106ms` instead of multi-second.

## Current Constraints
- `package.json` defines dev, build, test, coverage, and Rust test scripts, but no dedicated lint or named typecheck script.
- `.github/workflows/pr-ci.yml`, `.github/workflows/release-please.yml`, and `.github/workflows/release.yml` automate PR validation, versioning, and packaging; they do not replace task-specific local verification.
- `src/bindings.ts` is generated from Rust command signatures during debug Tauri runs and should not be hand-edited.
- Desktop persistence is intentionally split: SQLite stores image records and heavy metadata, `library.json` stores lightweight app settings and recent searches, and the OS keyring stores sensitive API keys.
- `src/services/repository.ts` is not the shipping desktop persistence path; treat it as legacy or fallback code unless a dedicated cleanup task explicitly changes that contract.
- Duplicate detection now treats same SHA-256 file content as an exact duplicate regardless of filename or path, and keeps metadata/dimensions/filesize matches as lower-confidence likely duplicates.
- Duplicate maintenance scans backfill missing content hashes in the native backend as a cancellable Activity Dock task; imports are not blocked on content hashing and cancel an active duplicate hash pass.
- Duplicate cleanup remains conservative: resolving duplicates removes redundant records from the Ambit library/Removed list flow rather than deleting files by default.

## Next Work
- No product milestone is locked in-repo immediately after `0.3.0`.
- The next durable engineering follow-up is clarifying whether `src/services/repository.ts` remains a supported non-desktop or mock fallback, or should be retired in a dedicated cleanup.
- Live Watch still needs a separate pending-completion UX pass if we want toggle-off to distinguish "activity detected but output not complete yet" from passive idle or summary states. See `docs/refactor.md#live-watch-pending-completion-state`.
- Use this file for active repo state and durable near-term follow-ups. Move recurring structural debt to `docs/refactor.md`, and keep personal scratch planning out of tracked files.
