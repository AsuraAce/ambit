# Photography merge acceptance

Status: Local publication review and release gate passed; draft PR update authorized; native interaction acceptance pending

## Outcome

Prepare the photography branch for an owner-approved main merge with current-main integration, release verification, and a final QA journey. Main merge and release publication remain separate decisions.

## Baseline and boundaries

- Latest reviewed implementation: `0e446a11`; the five-commit publication review is pinned to `d2cbf30c...0e446a11`. Freshly fetched `origin/main` remains `ec9e5747` (0.13.3) and is already an ancestor; no integration merge is required.
- Photography, toolbar, and optional-count implementation and review evidence are routed through `photography-premerge-polish.md` and `photography-startup-counts.md`.
- Preserve the existing isolated QA catalog and source photos. Do not run QA preparation, legacy marking, or cleanup/reset commands.
- No new photography fields, sorting/filter features, schema changes, or release version/tag changes.

## Acceptance gates

1. Current-main integration: confirmed by fetch and ancestry check; inspect any subsequent drift before PR handoff.
2. Run `pnpm run verify:release`. Resolve demonstrated in-scope regressions, obtain focused independent review for any resulting code changes, and rerun affected gates.
3. Use `pnpm run app:qa` against the existing profile for remaining native owner smoke: Photos → Videos → All Images must show every image within surrounding filters, with exactly one checkmark; direct Photos selection and restart retain the chosen scope, dropdown counts settle, and Live Watch refreshes them. Retain photo metadata, Modified/Captured dates and viewer-tab behavior in the smoke checklist; record unverified checks explicitly. This supersedes the old remembered-kind restoration journey.
4. Commit verification evidence and update existing draft PR #324 after owner authorization. Report hosted CI and owner acceptance separately from local verification; do not merge or release automatically.

## Risks and remaining evidence

- Full `verify:release` passed on 2026-10-08 at `0e446a11`: version/MediaInfo/bindings, lint, TypeScript, guarded frontend build, 3,684 frontend tests plus one intentional skip, 96.74% line coverage, 1,037 Rust library tests plus 18 utility tests (28 opt-in ignores), and the release-profile Tauri no-bundle build. All 43 release-automation script tests pass. Production dependency audit reports no known vulnerabilities; Rust audit reports zero unignored vulnerabilities across 807 dependencies under the unchanged compiled-graph exception policy. Existing permitted advisory warnings, Rust dead-code, jsdom navigation and Vite timing notices remain non-failing.
- Both independent reviews of the five recent commits are CLEAN; no code remediation was needed. The owner accepts the final menu visuals. Updated native scope/restart and Live Watch checks remain unconfirmed; automated provider tests prove dependency and revision safety, not a measured startup speedup.
- Ambit (QA) launched successfully from this worktree with `app:qa --no-watch`; the owner confirmed no viewer flicker and reported a misleading remembered Photos highlight under All Media. Startup logs confirm optional scope-count queries completed after the first gallery queries. Existing development icon/scan notices and slow-query warnings are observations, not a measured regression or owner visual acceptance.
- Read-only QA baseline: 146,064 generated, 617 Other, and three Photos in the active visible scope; migration 84; 380 collections and 131,743 memberships. All three source photos exist and their hashes/modification times were recorded for comparison after launch.
- A clean review does not replace owner acceptance or the release gate.

## Final finding ledger

| Finding | Disposition | Verification |
| --- | --- | --- |
| Hosted Rust audit: [RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html) in rustls 0.23.37 | Updated to patched rustls 0.23.45 and its required webpki 0.103.15; no audit exception | Local audit passes with zero unignored vulnerabilities. Both crates declare Rust 1.71, within Ambit's 1.88 minimum. Bindings, 1,037 library/18 utility tests and updated release build pass. Independent Standards/release-safety and Specification reviews are clean; all required hosted checks passed on d2cbf30c. |
| QA camera label repeats a make already included in the model | Display-only correction preserves stored EXIF; handles equal/prefixed makes case-insensitively without stripping partial word matches | Three new cases failed before correction; five label cases and shared viewer checks pass (13 tests). Full frontend rerun passes 3,644 tests plus one intentional skip; types, lint and guarded bundle pass. |
| Remembered Photos highlighted as active under All Media or Videos | Superseded by the explicit single-choice scope design in `library-scope-single-choice.md`; no dormant kind preference or overlapping checks | Single-choice, hydration, collection, keyboard and independent-count regressions pass in the full 3,684-test suite; both publication reviews are clean. |
| Final owner smoke | Screenshots confirm populated photo metadata; owner confirms no viewer flicker and now accepts final dropdown visuals | Updated native Photos → Videos → All Images, restart and Live Watch confirmation remain outstanding; visual approval is not a claim that these journeys were exercised. |

[Draft PR #324](https://github.com/AsuraAce/ambit/pull/324) owns hosted checks and maintainer review. Native startup reached its recorded ready milestone at 16.143s renderer elapsed; this is one observed launch, not a speedup or proof of displayed pixels. Read-only post-launch catalog counts, migration and organization match the baseline, and all three source-photo hashes/modification times are unchanged.

The new full release gate supersedes the earlier local verification baseline. It did not launch the native app or access the QA catalog/source photos. The following evidence commit is documentation-only; implementation review and all executable verification apply to `0e446a11`.

The owner explicitly authorized pushing and updating the existing draft PR after these local checks, acknowledging that publishing triggers hosted Actions despite the quota warning. Keep the PR draft and inspect its new head/checks after publication. Previous hosted green checks and 96.73% line coverage apply only to `d2cbf30c`; they must not be presented as validation of the newly published head. Main merge and release remain separate decisions.
