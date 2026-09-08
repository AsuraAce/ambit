# Photography pre-merge reliability and UI polish

Status: Active — implementation verified; owner QA acceptance pending
Approved: 2026-09-08

## Outcome and boundaries

Deliver reliable JPEG/PNG/WebP photo EXIF, shared persisted viewer-tab preference,
clear metadata/file-date presentation, and a compact media-aware library toolbar.
Keep local-first behaviour and the approved Details / Metadata sidebar alignment.
No main merge, release publication, QA reset, or source-photo modification.

## Packages and acceptance

1. **Integration baseline (verified):** checkpoint existing UI work (`5e03071c`),
   merged fetched main `ec9e5747` (v0.13.3) in `d2f736b6`, preserve released-main and photography
   migration histories, regenerate bindings, and establish passing baseline checks.
2. **Photo reliability (implemented, independently reviewed):** admit PNG/WebP via existing EXIF library;
   bounded 64 MiB probes, no whole-image buffering, missing EXIF is not an error,
   malformed/over-budget probes remain retryable. Advance photo-refresh version;
   preserve generator precedence, manual overrides, organisation, and orientation.
3. **Viewer polish (implemented, browser verified):** persisted `viewerPreferredTab` defaults to Details;
   explicit keyboard/pointer selections update it globally across image/video and
   restart. Unavailable preference temporarily falls back to Metadata then Details
   without saving the fallback. Respect settings hydration. Shared inline empty
   card: “No supported metadata found” / “File information is available in Details.”
   Rename image Date to Modified with filesystem date/time; Captured stays separate.
4. **Toolbar (implemented, browser verified):** one scope dropdown beside search, Media type (All media,
   Images, Videos) and Image kind (All images, Generated, Photos, Other). Selecting
   kind activates Images; All media/Videos ignore remembered kind; Images restores
   it. Persist media type, infer Images for legacy non-All kind; explicit Clear
   filters resets both. Hide library-absent categories, never search-zero ones;
   retain selected/remembered options and privacy/owner-safe availability.
   Move layout/size/slideshow into existing View menu, preserving visibility
   controls. Normal row: search/AI, scope, Import/Watch, Sort, View, compact count.
   Workspace below 900 px: Import/Watch in overflow, retaining watch indicator;
   below 700 px: Sort also in overflow. No permanent second row.
5. **Integration acceptance (in progress):** independent parser/refresh and combined
   reviews are clean after remediation. Full frontend coverage and Rust suites
   pass, including release-profile desktop compilation. Owner QA acceptance remains.

## Interfaces and compatibility

- Extend existing settings types/defaults/validation/persistence; no separate storage.
- Keep effective media scope distinct from remembered image kind. Extend query
  availability/count contracts only as required; mirror native and browser mock.
- No new photo-field schema or metadata dependency planned. Existing refresh
  checkpoint tracks coverage updates and must not advance on failed probes.
- Integration resolved migration 80: released main's maintenance-count indexes
  remain unchanged; photography uses 81–84 with exact-history, active-profile-only,
  fail-closed relocation and restart protection.

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

- PHOTO-1 (closed): strict EXIF parsing keeps malformed partial directories
  retryable. JPEG/PNG/WebP regression demonstrated red then green; independent
  safety closure clean; photo tests 33/33.
- UI-1 (closed): menus no longer clip; only the dedicated background/progress
  layer clips. Browser interaction and independent closure pass.
- UI-2 (closed): closed narrow-workspace actions retain a visible watch-status
  dot and accessible state. Browser and keyboard focus checks pass.
- VIEW-1 (closed): hydrated preference derives from shared settings; tests cover
  pre-hydration selection, saved preference recovery, and cross-viewer changes.
- VIS-1 (closed): constrain search wrapper so scope stays beside search at wide
  widths; empty metadata card remains top-flow content with centered copy.
- VIEW-2 (owner retest pending): photo metadata no longer renders the empty card
  while its full record is loading. Null/failed requests settle, and superseded
  callbacks cannot clear the next image's loading state. Targeted viewer tests
  pass (28); independent closure and the complete release recheck pass.

## Acceptance evidence

- Full frontend coverage: 297 files, 3611 passed, 1 intentional skip; 96.73% lines.
- Full Rust: 1037 library tests passed, 28 opt-in ignores; 18 utility tests passed.
- Binding drift, lint, TypeScript and guarded production frontend build pass.
- Full `verify:release` passed, including coverage, Rust suites, and the optimized
  Tauri no-bundle build. The complete gate was rerun successfully after VIEW-2;
  the desktop gate built the final frontend.
- Browser mock: both themes at 1280/1600/2048; narrow Actions/Sort thresholds;
  unclipped Scope/View/Actions; Escape/focus; Photos → Videos → Images; empty
  search retains Photos; Clear filters and debounced settings restart; initial
  Details, saved Metadata across image/video/reload, Workflow → photo Metadata
  fallback → video Workflow without preference loss. Screenshot artifacts are
  local-only under `output/playwright/`.
- Browser limitation: synthetic video playback invokes native-only preparation
  and reports unavailable playback; tab/scope behavior was verified, not playback.
- Read-only QA baseline: 618 scoped records, 3 Photos, 6 missing, no manual kinds
  or collections/memberships; integrity and foreign-key checks pass. No reset,
  legacy marking, or source-photo changes. Owner desktop smoke remains required.
- Isolated Ambit (QA) launched successfully on 2026-09-08 using its existing QA
  frontend and `--no-watch`; no profile reset or automatic main merge. Owner was
  asked to verify Metadata persistence and Photos → All media → Images restoration.
- Owner confirmed persistence, then reported a brief metadata-content flash.
  VIEW-2 addresses premature empty-state rendering; owner retest is outstanding.
- Post-launch read-only QA comparison matches baseline counts, organization,
  manual-note state and migrations; SQLite integrity remains clean.
- Release gate environment: nested `pnpm` initially selected a global v12 shim.
  Re-running with Corepack's shim directory first uses pinned pnpm 11.5.3 without
  repository dependency or package-manager changes.

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
