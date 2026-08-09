# Progress
Status: Current
Last reviewed: 2026-08-09

## Current Baseline
- The current release manifests are version `0.10.0`: `package.json`, both Tauri configuration files, `src-tauri/Cargo.toml`, the local `app` package in `src-tauri/Cargo.lock`, and `.github/.release-please-manifest.json` agree. Hosted release state still belongs to GitHub rather than this file.
- Release builds remain Windows-only. Linux and macOS packages are manual, unsigned or non-updater experimental artifacts as documented in `docs/experimental-unix-builds.md`.
- Production packaging runs `verify:release` before Tauri builds. The gate checks version consistency, generated binding drift, lint, TypeScript, guarded frontend output, coverage, Rust tests, and a no-bundle Tauri compatibility build.
- ComfyUI metadata milestones 22 through 61 shipped in `v0.10.0`. The pinned v0.11.18 core target remains all 93 workflows: 86 golden, 2 pattern-covered, 5 partial, and 0 unassessed. The separate 16-workflow extended image scope contains 15 golden and 1 partial, bringing the whole manifest to 101 golden, 2 pattern-covered, 6 partial, and 469 excluded. The SUPIR partial retains exact sampler metadata but cannot recover its selected generated caption because the `TextGenerate` result is not embedded. The two remaining pattern-covered entries are intentionally disconnected or bypassed starter workflows. Non-generative utility outputs suppress weak sampler/global fallback when the authored workflow contains no sampler definition, preventing utility checkpoints and selector text from becoming generation metadata. The path-parity gate covers 109 official catalog fixtures and 21 real-world fixtures across direct extraction, scanner-style merging, reparse, and developer diagnostics. Parser version remains 46. Milestones 62 through 66 provide the local support-bundle export, offline replay and differences, and guarded fixture-candidate preparation and inspection workflow. Milestone 67 documents its privacy boundary and protects default support-bundle filenames from accidental Git inclusion. Milestones 68 through 70 make the Image Viewer consume the same Rust-normalized ComfyUI graph for API prompts and workflow-only subgraphs, group namespaced internal nodes, navigate deterministic incoming/outgoing connections, and identify the parser-selected outputs and root samplers while preserving the exact archival workflow for copy and download. See `docs/comfyui-support-workflow.md` and `docs/plans/milestone-68.md` through `docs/plans/milestone-70.md`. These observability and display milestones do not change parser output or trigger metadata refresh.
- The search-transition, prompt-masking, setup-guide replay, and tooltip-dismissal packages recorded in `docs/plans/release-0.9.0-ux-readiness.md` landed before the `v0.9.0` release.
- Removal and deletion now use coordinated native lifecycle commands. Removing or restoring preserves a retryable tombstone boundary, file hash, parser version, memberships, and resource links; final deletion retains records when OS trash fails; already-missing files can be safely reconciled on retry; collection membership moves are atomic; and facet rebuilds swap from staging under a shared full/incremental coordinator.
- InvokeAI synchronization now applies one durable legacy, All users, or selected-owner scope across manual, startup, and Live Watch queries. Selected-owner mode includes owned boards and collections, disables filesystem-only orphan recovery without erasing its preference, and preserves hidden rows for later scope changes.
- InvokeAI image source classification, asset visibility, high-value metadata extraction, reference provenance/navigation, and owner-scope startup remediation are implementation-complete and release-verified. Brief database, owner, and privacy checks remain behind the branded splash; sustained preparation is delayed, progress is stable, and the handoff into background catch-up is explicit. The real-data desktop restart is owner-accepted; multi-owner selection and temporary-offline retry remain recovery acceptance. See `docs/plans/invokeai-image-assets-and-metadata.md` and `docs/plans/invokeai-owner-scope-startup-remediation.md`.

## Current Constraints
- Specta binding generation is explicit. Do not expect a debug Tauri launch to update `src/bindings.ts`; run `pnpm run bindings:generate`, then `pnpm run bindings:check`.
- Desktop persistence is intentionally split: SQLite stores image records and heavy metadata under Local AppData, `library.json` stores lightweight app settings and recent searches, and the OS keyring stores sensitive API keys.
- `src/services/repository.ts` is not the shipping desktop persistence path. Treat its LocalStorage/mock behavior as an ambiguous fallback until a dedicated task either validates or retires it.
- Exact duplicate detection is a global SHA-256 scan. Cleanup merges safe keeper state and collection memberships, moves redundant records through the Removed flow, and does not delete files by default.
- The `io.github.asuraace.ambit` identifier is current. Startup migration and reset/repair paths still account for legacy `com.ambit.app` Local and Roaming AppData during the public-beta transition.

## Active Follow-Ups
- Complete the remaining owner-acceptance recovery journey for InvokeAI owner scope: multi-owner selection, temporary offline startup, retry, and scope changes without missing or deleted Ambit records. The normal-restart presentation is accepted.
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
