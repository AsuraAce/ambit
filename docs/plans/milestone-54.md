# Milestone 54: Offline ComfyUI Catalog Audit Tooling

Status: Complete
Catalog release: `v0.11.18`
Catalog commit: `8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`

## Outcome

Provide a deterministic, read-only audit for the pinned ComfyUI workflow
catalog so future release updates expose ID, source-blob, and fixture drift
before coverage claims are carried forward.

## Acceptance Criteria

- Verify mode requires the exact pinned checkout and checks all 578 catalog IDs
  and original-file Git blob identities.
- All 90 dedicated official-catalog fixtures match their parsed upstream
  workflows regardless of harmless JSON formatting or line-ending differences.
- Diff mode reports added, removed, targeted changes, excluded changes, and
  stale fixtures in stable ID order without rewriting tracked files.
- Offline tests cover stale manifests, stale fixtures, malformed catalogs,
  duplicate IDs, format-only changes, and cross-workflow pattern evidence.
- Parser version remains 42 and no application, storage, binding, or public API
  behavior changes.

## Findings

- The first strict audit found one stale fixture:
  `templates-image_to_real.chunks.json` still contained its earlier workflow
  while the manifest identified the v0.11.18 source blob.
- Refreshing that fixture from the pinned checkout retained its exact golden
  metadata extraction behavior.
- Existing fixtures intentionally use a mix of raw, line-ending-normalized, and
  minified JSON, so semantic workflow identity and raw upstream Git identity
  are verified separately.

## Non-Goals

- Do not update the catalog pin or coverage classifications automatically.
- Do not fetch the catalog during tests or release verification.
- Do not execute generated text, change multi-output policy, or broaden parser
  behavior.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Node audit tests passed: 12 tests.
- Pinned verification passed: 578 IDs and source blobs, 90 fixtures.
- Candidate diff against the same pin reported 578 unchanged entries and no
  added, removed, changed, or stale-fixture entries.
- `templates-image_to_real` golden extraction passed after fixture refresh.
- Manifest validation passed: 3 tests.
- `cargo fmt --check` and `git diff --check` passed.
- `Cargo.lock` remains unchanged.
