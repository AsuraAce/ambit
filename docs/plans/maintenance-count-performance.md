# Maintenance count performance follow-up

Status: Implementation and automated verification complete; desktop acceptance pending.
Issue: https://github.com/AsuraAce/ambit/issues/310 (follow-up to #308).
Branch: `fix/maintenance-count-performance`, based on merged #309.

## Outcome and boundaries

Preserve exact counts, existing image-scope visibility, one SQL statement/snapshot and the public return shape while avoiding metadata-heavy table reads. No count cache, pagination, refresh-scheduling change, prompt copies, archival JSON in indexes, command changes or generated binding changes.

## Decision

Planner-selected indexes were insufficient: after ANALYZE, SQLite selected the gallery sort index and read image-table columns. Migration 80 now generates normal and narrow count views from one compile-time scope definition. Normal views preserve their previous SQL, columns, rowids and planner freedom. Only count views require the compact indexes with INDEXED BY. Missing required indexes fail through existing query error handling rather than silently reverting to heavy reads. Historical migrations are unchanged.

The approved migration pays a one-time index build and ongoing index maintenance on relevant writes. Previous candidate benchmark numbers are superseded by the refreshed-statistics measurements below.

## Acceptance gates

- Exact old/new count parity, unchanged normal views, row visibility and rowids across all scope modes.
- No image-table column reads before/after ANALYZE and shutdown-style optimization, including mixed owner/hidden/deleted populations.
- Fresh/populated upgrade, transactional rollback, generated-field edits, restore/removal/deletion and missing-index behavior.
- Full frontend/Rust regression checks, TypeScript, lint, build and independent migration/scope review.
- Repeated metadata-size benchmark with refreshed statistics, index allocation/build cost and write overhead.
- Disposable-library desktop badge/update journey. Native UI initialization currently fails because the trusted Node process exits; no user library was accessed. Keep the PR draft while this acceptance gate remains unverified.

Run migration tests using `cargo test --manifest-path src-tauri/Cargo.toml --lib db::migrations`. Run the explicit disposable benchmark with `cargo test --manifest-path src-tauri/Cargo.toml --lib benchmark_metadata_heavy_counts -- --ignored --nocapture`. Use normal Tauri build setup; the existing `pnpm run test:rust` wrapper can fail capability generation when SKIP_TAURI_BUILD is set.

## Verification results

- 3,381 frontend tests passed, 1 skipped; 901 Rust library and 18 binary tests passed, 5 ignored. The subsequently added gallery-plan regression and the explicit benchmark also passed.
- Migration suite: 51 passed before the additional gallery-plan test. Scope/view compatibility, transactional rollback and post-ANALYZE index-only reads passed. Independent standards and scope/migration reviews were clean.
- TypeScript, lint, frontend build and diff whitespace checks passed. The build emits its existing large-chunk advisory. Installer/release gates were not run.
- Native UI initialization failed again; the desktop badge/update journey remains unverified and the PR must stay draft.

Synthetic on-disk databases used 20,000 active and 10,571 Removed rows, local scope, an 8 MiB SQLite cache and memory journaling. Timings are medians of seven runs with refreshed statistics, not desktop responsiveness measurements. Write samples insert 200 rows and roll back.

| Workflow payload | Old count | New count | Index allocation | Migration | Write sample before / after |
| --- | --- | --- | --- | --- | --- |
| 1 KiB | 112.869 ms | 13.276 ms | 528 KiB | 215 ms | 394.747 / 421.112 ms |
| 24 KiB | 342.989 ms | 6.437 ms | 528 KiB | 360 ms | 215.852 / 220.889 ms |
