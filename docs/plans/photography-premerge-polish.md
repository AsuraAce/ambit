# Photography pre-merge reliability and UI polish

Status: Active — integration baseline verified; final review before merge commit
Approved: 2026-09-08

## Outcome and boundaries

Deliver reliable JPEG/PNG/WebP photo EXIF, shared persisted viewer-tab preference,
clear metadata/file-date presentation, and a compact media-aware library toolbar.
Keep local-first behaviour and the approved Details / Metadata sidebar alignment.
No main merge, release publication, QA reset, or source-photo modification.

## Packages and acceptance

1. **Integration baseline (verified):** checkpoint existing UI work (`5e03071c`),
   merge fetched main `ec9e5747` (v0.13.3), preserve released-main and photography
   migration histories, regenerate bindings, and establish passing baseline checks.
2. **Photo reliability (pending):** admit PNG/WebP via existing EXIF library;
   bounded 64 MiB probes, no whole-image buffering, missing EXIF is not an error,
   malformed/over-budget probes remain retryable. Advance photo-refresh version;
   preserve generator precedence, manual overrides, organisation, and orientation.
3. **Viewer polish (pending):** persisted `viewerPreferredTab` defaults to Details;
   explicit keyboard/pointer selections update it globally across image/video and
   restart. Unavailable preference temporarily falls back to Metadata then Details
   without saving the fallback. Respect settings hydration. Shared inline empty
   card: “No supported metadata found” / “File information is available in Details.”
   Rename image Date to Modified with filesystem date/time; Captured stays separate.
4. **Toolbar (pending):** one scope dropdown beside search, Media type (All media,
   Images, Videos) and Image kind (All images, Generated, Photos, Other). Selecting
   kind activates Images; All media/Videos ignore remembered kind; Images restores
   it. Persist media type, infer Images for legacy non-All kind; explicit Clear
   filters resets both. Hide library-absent categories, never search-zero ones;
   retain selected/remembered options and privacy/owner-safe availability.
   Move layout/size/slideshow into existing View menu, preserving visibility
   controls. Normal row: search/AI, scope, Import/Watch, Sort, View, compact count.
   Workspace below 900 px: Import/Watch in overflow, retaining watch indicator;
   below 700 px: Sort also in overflow. No permanent second row.
5. **Integration acceptance (pending):** independent parser/refresh and combined
   reviews, automated gates, browser comparisons, and owner QA acceptance.

## Interfaces and compatibility

- Extend existing settings types/defaults/validation/persistence; no separate storage.
- Keep effective media scope distinct from remembered image kind. Extend query
  availability/count contracts only as required; mirror native and browser mock.
- No new photo-field schema or metadata dependency planned. Existing refresh
  checkpoint tracks coverage updates and must not advance on failed probes.
- Current integration has a collision at migration 80: main's maintenance-count
  indexes versus earlier photography migrations 80–83. Resolve with verified,
  fail-closed compatibility for both histories before feature work.

## Verification

- Parser: equal fields across JPEG/PNG/WebP; missing, malformed, truncated,
  oversized, orientation, generator-plus-camera metadata, and manual kinds.
- Refresh: existing-library coverage upgrades, failure retry, cancellation/restart,
  thumbnail invalidation, and preserved notes/collections/overrides.
- Viewer: initial Details, hydrated saved preference, explicit selection only,
  unsupported Workflow fallback, image/video transitions, empty state, dates.
- Toolbar: Photos → Videos → Images restoration, All media includes video,
  library-availability versus contextual-zero counts, reset/restart, keyboard,
  privacy boundaries, and virtualised browsing.
- Visual: light/dark at 1280/1600/2048 px, plus workspace overflow thresholds.
- Baseline and final: targeted tests, full frontend/Rust tests, typecheck/lint,
  generated-binding verification, and release-verification gate. Use isolated QA
  profile without resetting it; owner acceptance is separate from automated gates.

## Finding ledger

- INT-2 (closed): Removed-list failures were fixture drift, not a production
  schema defect. Added existing photography/thumbnail columns to the isolated
  SQLite fixture; 17/17 targeted tests pass. Full frontend rerun: 3578 passed,
  1 intentional skip across 294 files. TypeScript, lint, frontend build, Rust
  format/library checks, and generated bindings pass.
- INT-1 (closed): accept exact relocated photography prefixes on restart before
  main migration 80 runs, without mutation. History suite 17/17 and full Rust
  baseline pass (1031 library + 18 utility tests, 28 existing opt-in ignores).
  Independent Spec-axis review found no remaining migration defect.

## Deferred

Extra EXIF fields, full IPTC/XMP/MakerNotes, RAW workflows, file/sidecar writing,
and all-tags inspection. Document supported formats and selected-field coverage.
