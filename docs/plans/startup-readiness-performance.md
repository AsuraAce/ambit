# Startup readiness and performance

Status: Active — implementation and automated verification complete; isolated debug test copy ready for owner acceptance
Baseline: `20cd2390` (latest main checked 2026-09-03)

## Outcome and invariants

Keep the fully prepared opening experience and all owner/privacy gates. Routine startup must not compete with optional prompt analysis or timer-triggered maintenance. Reuse unaffected scope caches after thumbnail repairs. The historical 7.5-minute startup is not fully attributed; do not claim it fixed without a measured native journey.

User stories:
1. As a library user, I want startup to prioritize preparing my library, so background maintenance does not delay opening.
2. As a Statistics user, I want the word cloud calculated when I open Statistics, so ordinary browsing avoids prompt scans.
3. As an InvokeAI user, I want unaffected cached data reused, so thumbnail repairs do not unnecessarily slow subsequent launches.
4. As a privacy-conscious user, I want owner/privacy checks preserved during failures and transitions, so faster startup never exposes inappropriate content.
5. As a maintainer, I want attributable local startup timings, so regressions can be diagnosed.

## Work packages

1. Establish latest-main test baseline and bounded startup diagnostics: database phases, owner discovery/cache repair, facets, collections, privacy, first safe page, splash dismissal, and overlapping maintenance. Diagnostics contain fixed phase names, durations, repair actions and launch IDs, never library paths, owner identities or prompts. Benchmark only disposable, transactionally consistent catalog copies with isolated generated files.
2. Gate automatic thumbnail optimization (30-second delay), metadata checking (3-second delay), and production backup (120-second delay) on actual startup readiness. Retain manual controls and existing priority/cancellation. Readiness derives from existing gates plus a successfully loaded safe first page (including empty results), never from optional-job completion. Statistics demand is transient; cancel further prompt batches on close and reject stale scope/filter results.
3. Replace thumbnail batch `full` dirtiness with existing resource/collection selective invalidation for affected scopes. Preserve set-based writes, unrelated full markers, generation handshakes, rollback, and retry-only non-invalidation. No schema migration.

## Verification and acceptance

Use red/green tests at hook, command and migrated SQLite seams, then typecheck, lint, frontend/Rust suites, generated bindings and native compatibility build. Independently review persistence/concurrency changes.

Benchmark at least five unchanged-profile launches and three controlled dirty-cache launches; report individual timings, median, slowest, and dominant phase. Separate compilation, migrations and genuinely required full rebuilds from ordinary startup. Targets on the large catalog are under 10 seconds for an unchanged repeat launch and under 30 seconds for a normal cold launch; these are targets, not established capabilities. If the bounded changes cannot meet them, return to planning with measurements rather than widening the refactor.

Native smoke must cover opening, virtualized browsing, Statistics, owner switching and background repair. Automated correctness, review and owner/native acceptance are separate gates.

## Non-goals

No partially prepared opening, weaker privacy protection, persistent word-cloud database, thumbnail-engine rewrite, historical migration edits, production-profile mutation for tests, or raw diagnostics UI.

## Evidence / remaining gates

- Approved follow-up: isolate debug migration-history repair to its active database, preserving release compatibility. A regression reproduced an inactive production-fixture checksum update before the fix; the fixed debug path leaves its bytes and migration records unchanged. Debug and release migration suites, full frontend/Rust suites, lint and strict TypeScript pass. The additive debug test identifier is `com.ambit.startup-test`; normal dev and installed production remain separate.
- The additive debug test copy is ready: 295,113 Ambit image records, a 156,021-image InvokeAI snapshot, and 290,584 copied Ambit thumbnail files. Both SQLite quick checks pass; table row counts are preserved; the copied catalog has zero foreign-key violations and zero original operational image/thumbnail paths. Path-based IDs, references and owner cache identities were repointed only in the copy; the production external-content FTS index keeps its unchanged image rowids. Existing cached states are preserved, including ready aggregate and dirty owner snapshots. Normal dev remains in place, with an additional database/settings backup.
- The test build uses a frozen debug-native executable with bundled frontend, the additive `com.ambit.startup-test` identifier and a checksum-guarded local launcher. It was built but not launched by the agent. Full originals and externally sourced InvokeAI thumbnails are not copied; source-folder scans and automatic thumbnail repair are disabled. This is a catalog/owner/cache timing test, not full-media or optimized-release acceptance. First-launch copied-source reconciliation must be separated from repeat timing; exact startup times remain unmeasured.
- Worktree updated from release `edc439a8` to `20cd2390` on `fix/startup-readiness`.
- Latest-main frontend baseline: 278 files, 3,352 passing tests, one intentional skip.
- Implemented readiness-gated maintenance, Statistics-only analysis, selective thumbnail invalidation and bounded local startup diagnostics. Owner/privacy and splash presentation behavior is unchanged.
- Standards and spec reviews closed clean after fixing metadata duplicate/stale-retry races and preserving foreground throttling during ordinary filtering.
- Final verification: frontend suite 3,364 passed with one intentional skip across 279 files; Rust library suite 900 passed with four ignored, plus 18 support-inspection binary tests passed. Lint, strict TypeScript, generated binding drift, guarded frontend build, release-profile no-bundle Tauri compatibility build and diff whitespace checks passed. An optimizer root-probe timing test failed once during a focused run, then passed both its exact rerun and the full suite. The complete packaging/release gate and coverage were not run.
- Real-catalog startup timing and native user acceptance remain unverified. Initial read-only feasibility checks found that a custom release identifier is not sufficient isolation: release database migration/path repair still targets the production identifier, and keyring identity is shared. The later approved debug-only repair guard and repointed test copy do not solve release-profile isolation. Production and normal-dev profiles were not replaced; the installed production app was not launched by this work.
- Safe follow-up requires an isolated Windows user/profile with a transactionally consistent catalog/thumbnail clone and separate keyring, or an explicitly approved dedicated profile-isolation change. A true OS-cold timing must be distinguished from the cache warmed by making the clone. The performance targets remain open.
