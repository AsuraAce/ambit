# Photography merge acceptance

Status: Release gate passed; final owner QA and PR preparation in progress

## Outcome

Prepare the photography branch for an owner-approved main merge with current-main integration, release verification, and a final QA journey. Main merge and release publication remain separate decisions.

## Baseline and boundaries

- Feature baseline: `9c2b6808`; freshly fetched `origin/main`: `ec9e5747` (0.13.3). Main is already an ancestor; no integration merge is required.
- Photography, toolbar, and optional-count implementation and review evidence are routed through `photography-premerge-polish.md` and `photography-startup-counts.md`.
- Preserve the existing isolated QA catalog and source photos. Do not run QA preparation, legacy marking, or cleanup/reset commands.
- No new photography fields, sorting/filter features, schema changes, or release version/tag changes.

## Acceptance gates

1. Current-main integration: confirmed by fetch and ancestry check; inspect any subsequent drift before PR handoff.
2. Run `pnpm run verify:release`. Resolve demonstrated in-scope regressions, obtain focused independent review for any resulting code changes, and rerun affected gates.
3. Launch `pnpm run app:qa` against the existing profile. Owner smoke: photo metadata and Modified/Captured dates, remembered viewer tab, Photos → Videos/All Media → Images restoration, settled dropdown counts, and Live Watch refresh. Record unverified checks explicitly.
4. Final diff and acceptance review, then commit the evidence and prepare a PR into main. Report hosted CI and owner acceptance separately from local verification.

## Risks and remaining evidence

- Full `verify:release` passed on 2026-10-07: version/MediaInfo/bindings, lint, TypeScript, guarded frontend build, 3,639 frontend tests plus one intentional skip, 96.73% line coverage, 1,037 Rust library tests plus 18 utility tests (28 opt-in ignores), and the release-profile Tauri no-bundle build. Existing Rust dead-code and Vite timing notices are non-failing.
- Final native owner QA is pending. Automated provider tests prove dependency and revision safety, not a measured startup speedup.
- Ambit (QA) launched successfully from this worktree with `app:qa --no-watch`; the owner smoke question is outstanding. Startup logs confirm optional scope-count queries completed after the first gallery queries. Existing development icon/scan notices and slow-query warnings are observations, not a measured regression or owner visual acceptance.
- Read-only QA baseline: 146,064 generated, 617 Other, and three Photos in the active visible scope; migration 84; 380 collections and 131,743 memberships. All three source photos exist and their hashes/modification times were recorded for comparison after launch.
- A clean review does not replace owner acceptance or the release gate.
