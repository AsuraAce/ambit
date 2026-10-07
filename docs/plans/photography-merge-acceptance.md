# Photography merge acceptance

Status: Draft PR prepared; local remediation verified; hosted rerun and owner acceptance pending

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

## Final finding ledger

| Finding | Disposition | Verification |
| --- | --- | --- |
| Hosted Rust audit: [RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html) in rustls 0.23.37 | Updated to patched rustls 0.23.45 and its required webpki 0.103.15; no audit exception | Local audit passes with zero unignored vulnerabilities. Both crates declare Rust 1.71, within Ambit's 1.88 minimum. Bindings, 1,037 library/18 utility tests and updated release build pass. Independent Standards/release-safety and Specification reviews are clean; hosted rerun pending. |
| QA camera label repeats a make already included in the model | Display-only correction preserves stored EXIF; handles equal/prefixed makes case-insensitively without stripping partial word matches | Three new cases failed before correction; five label cases and shared viewer checks pass (13 tests). Full frontend rerun passes 3,644 tests plus one intentional skip; types, lint and guarded bundle pass. |
| Final owner smoke | Tentative response: “maybe its fine”; screenshots confirm populated photo metadata | Tab/scope persistence and native Live Watch confirmation remain unverified rather than inferred from static screenshots. |

[Draft PR #324](https://github.com/AsuraAce/ambit/pull/324) owns hosted checks and maintainer review. Native startup reached its recorded ready milestone at 16.143s renderer elapsed; this is one observed launch, not a speedup or proof of displayed pixels. Read-only post-launch catalog counts, migration and organization match the baseline, and all three source-photo hashes/modification times are unchanged.

The initial full local release gate preceded these two final changes. Affected verification was rerun afterward: complete frontend regressions, types/lint, guarded frontend output, advisory audit, bindings, native tests and the release-profile desktop build. Initial 96.73% coverage remains baseline evidence; final hosted coverage is tracked on the PR. The QA launch preceded the TLS lock update, while its running frontend received the display correction through hot reload.
