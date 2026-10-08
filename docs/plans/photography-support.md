# Photography Support Roadmap

Status: Milestone 1 complete and product-owner accepted (2026-07-29)
Base: `origin/main` at `a6ee3ec` (`0.9.1`)
Delivery posture: Assure
Proposed: 2026-07-28
Approved: 2026-07-29

## Outcome

Make Ambit a trustworthy local library for hybrid creators who keep generated
images, source photographs, references, and edited outputs together. The first
release must catalog camera-originated stills correctly without turning Ambit
into a RAW developer or presenting photographs as AI images with missing data.

The first user-acceptance journey is:

1. Add a folder containing generated images and camera JPEGs.
2. See each image classified as Generated, Photo, or Other.
3. Open a rotated camera JPEG upright and with the correct displayed dimensions.
4. See its capture date, camera, lens, and exposure data instead of generator
   prompts and parameters.
5. Browse it on its capture date while existing generated-image workflows remain
   unchanged.

## Selected Product Defaults

- Target hybrid creators first. Do not position Ambit as a general Lightroom,
  Capture One, or darktable replacement.
- Keep generation metadata and photography metadata as separate domains. A
  camera is not a `GeneratorTool`.
- Preserve source files. The foundation milestone reads metadata but does not
  rewrite images or sidecars.
- Keep current `AIImage` naming for compatibility during the first milestone;
  do not combine photography support with a broad frontend-domain rename.
- Treat camera JPEG as the minimum shippable format. Admit TIFF only if the
  native feasibility package proves bounded decoding, metadata extraction,
  orientation, and thumbnail behavior on supported platforms.
- Defer HEIC/HEIF, AVIF, camera RAW, XMP sidecar writeback, ratings, and reject
  workflows until later acceptance gates.
- Do not run a full-library photo rescan during startup. Existing libraries use
  an explicit, resumable metadata refresh path.
- Extract GPS only into the local catalog, keep it collapsed in the UI, and
  never include it in Gemini or other network requests. Revisit a user-level
  import toggle only if product acceptance shows that local extraction is still
  too surprising.

## Architecture Direction

### Catalog identity

Introduce an effective source kind with these values:

- `generated`: recognized generator metadata, workflow, integration provenance,
  or other strong existing Ambit evidence;
- `photograph`: camera EXIF evidence such as capture time plus camera/exposure
  fields, when generated-image evidence is absent;
- `other`: screenshots, references, exports, and unclassified still images.

Generated-image evidence wins over incidental camera-style EXIF. Store detected
kind separately from an optional user override so metadata refresh cannot erase
a correction. The database representation must support an indexed equality
predicate for effective source kind; do not ship a `COALESCE` full scan on large
libraries without a matching expression index or materialized effective value.

### Photography metadata

Add a separate Rust/Specta `PhotoMetadata` contract rather than extending
`ImageMetadata`. The initial read-only contract should cover:

- original capture date and optional offset;
- camera make and model;
- lens make and model;
- focal length and 35mm equivalent when available;
- aperture, exposure time, and ISO;
- orientation;
- artist/copyright;
- GPS coordinates when present.

Persist the complete normalized photo payload separately from
`metadata_json`. Denormalize and index only fields required for milestone-one
queries: effective source kind and effective display date. Camera, lens, rating,
and range-filter indexes belong to the milestone that actually ships those
filters.

### Date semantics

Do not silently change the meaning of the existing `timestamp`, which currently
tracks filesystem modification time and participates in established queries.
The native contract spike must define a separate capture-time representation
that:

- preserves EXIF wall time and an optional timezone offset separately;
- does not invent a timezone when EXIF omitted one;
- provides a stable indexed display/sort value using capture time when present
  and file modification time otherwise;
- keeps raw capture text available for diagnosis when parsing is ambiguous.

The database migration and query plan must be agreed only after that contract is
covered by fixtures.

### Upgrade and cache behavior

- New imports receive photo metadata immediately.
- Existing rows retain current behavior after migration and are reclassified by
  an explicit folder metadata refresh or selected-image refresh.
- Known generated rows may be backfilled as Generated from existing strong
  metadata without rereading files; ambiguous rows remain Other until refreshed.
- Manual source-kind overrides survive rescans.
- Photo fields survive Remove from Library and Restore flows.
- Orientation-aware thumbnail generation must also correct stored width/height
  when axes are swapped. Bump or otherwise invalidate the applicable thumbnail
  version, then repair incrementally through existing thumbnail ownership rather
  than blocking startup with a global regeneration.

## Milestone 1: Truthful Camera-Photo Support

### Acceptance criteria

- A camera JPEG imports upright for EXIF orientations 1, 3, 6, and 8.
- Its displayed dimensions match the oriented image.
- Capture date, camera, lens, focal length, aperture, shutter speed, ISO, and
  copyright appear when present, with graceful omission when absent.
- A photograph never shows fake Unknown generator/model data, prompt editors,
  generation parameters, Workflow, or Creative Assistant actions.
- Generated JPEG, PNG, and WebP behavior remains unchanged, including ComfyUI,
  InvokeAI, and A1111 metadata extraction.
- All/Generated/Photos/Other filtering agrees with the grid, timeline, smart
  collections, pagination, and displayed counts.
- Existing libraries migrate without source-file mutation or an automatic
  full-library scan.
- An explicit metadata refresh reclassifies previously imported photographs and
  reports progress, cancellation, and failures.
- Gallery and Maintenance entry points render the same origin-aware shared
  viewer behavior.
- Large-library browsing remains virtualized and source/date predicates use
  verified indexes.

### Non-goals

- No RAW or HEIC/HEIF support.
- No RAW development, color management pipeline, tethering, face recognition,
  map view, video support, or cloud photography analysis.
- No ratings, reject state, auto-advance culling, XMP sidecar import/writeback,
  caption/keyword writeback, or original-file metadata edits.
- No broad rename of `AIImage`, metadata subsystem refactor, filter taxonomy
  rewrite, or thumbnail ownership rewrite.

### Work Package 1: Native Photo Contract Feasibility

Status: Complete (2026-07-29)

Primary invariant: Ambit can extract and render bounded, deterministic camera
metadata and orientation without weakening existing untrusted-file handling.

Scope:

- Add a tiny, redistributable fixture matrix covering JPEG orientations 1/3/6/8,
  capture time with and without offset, camera/lens/exposure fields, GPS,
  malformed EXIF, no EXIF, and an AI-generated JPEG containing incidental EXIF.
- Time-box evaluation of a maintained Rust EXIF parser, preferring an existing
  library over extending Ambit's AI-specific EXIF normalization by hand.
- Prove orientation-aware decode and thumbnail output, oriented dimensions,
  metadata size limits, malformed-input handling, and cancellation behavior.
- Define the source-kind precedence and capture-time contract from fixture
  evidence.
- Run the same feasibility matrix for TIFF. Record Include or Deferred; do not
  make TIFF a milestone blocker if the result is uncertain.

Non-goals:

- No database migration, generated binding change, production UI, watcher
  extension change, or public photography claim.

Verification:

- Focused Rust parser/scanner/thumbnail tests over every fixture.
- Assertions that generated metadata wins over incidental photographic EXIF.
- Bounded malformed and oversized metadata tests.
- `cargo fmt --check` and `git diff --check`.

Completion criteria:

- The parser dependency, timestamp representation, source-kind rules, and TIFF
  disposition are recorded in this plan.
- No unresolved platform assumption remains that would materially change the
  milestone-one schema.

Decision record (2026-07-29):

- Use `kamadak-exif` `0.6.1` for the native reader. It is a small, pure-Rust,
  BSD-2-Clause dependency and keeps camera EXIF separate from Ambit's existing
  AI-specific EXIF normalization.
- Treat JPEG as Included for Milestone 1. Its EXIF payload is segment-bounded;
  individual text fields are additionally capped at 4 KiB, partial metadata is
  accepted, and malformed metadata is a non-fatal per-file scan failure.
- Preserve `DateTimeOriginal` as bounded raw text plus a validated local wall
  time, optional `OffsetTimeOriginal`, and optional subseconds. Do not invent or
  infer an offset. For indexed browsing, derive a wall-time sort surrogate by
  encoding the local components as UTC-shaped milliseconds without claiming it
  is a UTC instant; use the existing file-modified timestamp when capture time
  is absent. Display and timeline grouping use the local capture components, so
  a real offset never shifts the photograph onto a different local date.
- Classify as Generated whenever current Ambit generator/workflow provenance is
  strong. Otherwise classify as Photograph only for paired evidence: camera
  identity plus capture, lens, or exposure data; or capture time plus exposure
  data. Orientation, artist, copyright, GPS, or one camera-style field alone is
  insufficient. Everything else remains Other, subject to the later persisted
  user override.
- Apply decoder-reported orientation before reading display dimensions or
  resizing thumbnails. Orientations 1, 3, 6, and 8 are covered; 6 and 8 swap
  width and height.
- Keep the probe synchronous inside the existing bounded per-file scan unit and
  honor cancellation between files/batches. JPEG metadata does not justify a
  second cancellation channel inside the parser.
- Defer TIFF. Small TIFF metadata, orientation, decode, and thumbnail sizing are
  feasible, but `kamadak-exif` reads the complete TIFF container. An arbitrary
  file-size cap would not be an honest public format guarantee and a long TIFF
  read would not meet Ambit's cancellation boundary. Do not add TIFF to scanner,
  watcher, dialog, or product copy in Milestone 1.
- The matrix uses generated redistributable JPEG/TIFF fixtures and covers no
  EXIF, invalid EXIF, oversized text, offset/no-offset capture time, camera/lens/
  exposure/GPS fields, AI precedence, and orientation-aware thumbnail sizing.
  No database, binding, scanner, watcher, thumbnail pipeline, or UI behavior was
  changed in this package.

### Work Package 2: Persisted End-to-End Camera JPEG Slice

Status: Complete (2026-07-29)

Primary invariant: a correctly scanned photo survives import, restart, query,
Remove/Restore, and metadata refresh without entering the AI metadata domain.

Scope:

- Add generated Rust/Specta source-kind and photo-metadata result types while
  leaving `ImageMetadata` generation-specific.
- Add the next SQLite migration for detected kind, manual override, photo
  metadata, capture/display date, and required indexes. Extend `removed_images`
  and restore paths where needed.
- Extend native batch persistence, frontend domain mapping, light/full row
  projections, and browser mock records without hand-editing `src/bindings.ts`.
- Preserve manual kind overrides during rescan and keep legacy generated images
  stable.
- Apply orientation before thumbnail resizing, return oriented dimensions, and
  integrate versioned incremental repair.
- Render the minimum origin-aware viewer slice: photo header, Photo Details,
  existing Collections/Notes editing, and no generation-only tabs or actions.

Non-goals:

- No photo facets beyond source kind, no culling controls, and no editable EXIF.
- No automatic startup reclassification of ambiguous existing rows.

Verification:

- Migration and backward-data-compatibility tests on empty, existing generated,
  ambiguous, removed, and manually overridden records.
- Focused Rust save/scan/thumbnail tests and frontend repo-mapping tests.
- Binding generation and drift check.
- Gallery and Maintenance viewer component tests proving origin-aware content.
- Query-plan checks for effective source kind and display date on a large
  synthetic library.

Completion criteria:

- The camera JPEG acceptance fixture passes through the actual scan, save, load,
  and viewer path.
- No existing generation metadata or thumbnail regression is known.

Completion record (2026-07-29):

- Added generated `SourceKind`, `PhotoMetadata`, and scan/save contracts while
  retaining generation metadata in its existing domain.
- Migration 63 materializes detected/effective source kind and display date,
  persists photo metadata separately, preserves Remove/Restore state, and uses
  both source/date indexes on a 10,000-row synthetic-library query-plan check.
- Camera JPEG scans now classify conservative photo evidence, preserve generated
  precedence, carry capture wall time, and apply EXIF orientation before stored
  dimensions and thumbnail sizing. Ambit thumbnail version 2 repairs only rows
  whose photo classification or oriented output makes their cache stale.
- The shared viewer presents Photo Details and Library controls for photographs
  and Other images without generator/model placeholders, prompt editing, or a
  Workflow tab. GPS stays collapsed and local with no map or network request.
- Scan, persistence, full/light load, Remove/Restore, failed-rescan recovery, and
  viewer seams are covered by native and frontend fixtures. Full frontend and
  Rust suites, binding drift, typecheck, lint, production frontend build, and
  the no-bundle Tauri release-mode build pass. The actual temporary-profile
  Windows owner smoke remains intentionally assigned to Work Package 3 and the
  Milestone 1 integration gate, where the mixed-library controls and explicit
  refresh journey exist.

### Work Package 3: Library Journey and Existing-Library Adoption

Status: Complete and product-owner accepted (2026-07-29)

Primary invariant: users can intentionally import, find, correct, and refresh
photographs without learning AI-specific terminology.

Scope:

- Add All/Generated/Photos/Other controls and source-kind active-filter chips.
- Use effective display date in photo cards and timeline while keeping raw file
  modified time available in technical details.
- Make grid/card secondary information origin-aware.
- Add single and bulk Set Image Kind actions for correcting classification.
- Extend the existing explicit metadata refresh flow to populate photo metadata
  in bounded, cancellable batches without clearing user overrides.
- Make Add Images and Settings > Folders copy format-neutral, report detected
  Generated/Photo/Other counts, and list supported formats honestly.
- Make grid cards keyboard-openable with visible focus and verify the new source
  controls with keyboard and screen-reader semantics.
- Update browser mock data, the user manual, and relevant onboarding/help copy.

Non-goals:

- No separate photo-only application shell or dedicated culling screen.
- No camera/lens/exposure facet panels yet.

Verification:

- Focused import, filter SQL, smart-collection persistence, grid, timeline,
  viewer, maintenance-viewer, settings, and accessibility tests.
- Rendered browser journey with mixed generated/photo/other mock data.
- Native Tauri smoke using a sanitized camera-photo corpus, including refresh,
  cancel/resume, Remove, and Restore.
- Large-result virtualization and pagination smoke.
- `pnpm run typecheck`, `pnpm run lint`, focused frontend tests, Rust tests,
  binding drift, and `git diff --check`.

Completion criteria:

- The full milestone-one acceptance journey passes and the supported-format copy
  matches actual native behavior.
- Product owner accepts the rendered mixed-library experience.

Implementation record (2026-07-29):

- Added an accessible All/Generated/Photos/Other scope bar with counts that
  remain scoped to the other active filters, plus active-filter and smart-
  collection persistence support.
- Photo cards, timeline grouping, pagination, and date filtering now use the
  effective display date while Photo Details retains the raw modified time.
- Added transactional single and bulk Image Kind correction from the viewer,
  grid context menu, and selection bar. Automatic restores the detected kind;
  manual choices survive rescans.
- Extended explicit metadata refresh with restart-safe photo checkpointing,
  bounded batches, cancellation boundaries, retryable failures, and thumbnail
  invalidation when classification or oriented dimensions change.
- Import and folder UI now name PNG/JPEG/WebP honestly, use mixed-library copy,
  and report Generated/Photos/Other results. Browser fixtures cover a mixed
  180-image library.
- The rendered browser journey passed at desktop and compact desktop sizes,
  including keyboard card opening, source counts, photo capture details, manual
  correction and restoration, and a clean warning/error console.
- Full release verification passed: version consistency, binding drift, lint,
  typecheck, guarded production build, 2,892 frontend tests plus one skip,
  98.42% statement coverage, 540 Rust tests, and the optimized no-bundle Tauri
  build.

Native acceptance record (2026-07-29):

- Ran the real Windows Tauri app under the isolated `com.ambit.qa` profile with
  a sanitized 1,057-entry corpus. Ambit imported 1,056 valid files as 1
  Generated, 3 Photos, and 1,052 Other; the deliberately malformed entry was
  rejected without destabilizing the import.
- Verified upright orientation and oriented dimensions, origin-aware cards and
  viewer details, collapsed local GPS, manual kind correction and Automatic
  restoration, Remove/Restore parity, and monitored-folder persistence across
  restart.
- Cancelled the restart-safe photo refresh with 455 rows pending, restarted the
  app, resumed exactly those 455 rows, and completed without losing the manual
  override. A final refresh restored all automatic classifications and left no
  pending rows.
- Exercised the late tail of the 1,056-item virtualized library and switched to
  Timeline using only keyboard focus and activation.
- Re-hashed every corpus source after each destructive-looking catalog action;
  no source image changed. The production and development catalogs were also
  verified byte-for-byte unchanged after the run.
- Final release verification passed with 2,890 frontend tests plus one skip,
  98.29% statement coverage, 542 Rust tests, binding drift/typecheck/lint/build
  guards, and the optimized no-bundle Tauri build.

The native journey closes the engineering gate. The product owner accepted the
rendered mixed-library experience on 2026-07-29, closing Milestone 1. Questions
and observations raised after this point are follow-up work.

Closure review record (2026-07-29):

- **F1, blocking — resolved:** exact-duplicate cleanup now carries thumbnail,
  source-kind, photo metadata, display date, and refresh-checkpoint fields into
  the Removed tombstone. The duplicate-resolution regression asserts the full
  photography state, not only legacy metadata and collection membership.
- **F2, blocking — resolved:** explicit refresh and ordinary upsert now
  invalidate Ambit thumbnails when photo metadata changes without a dimension
  or classification change, covering orientation 1 to 3 as well as axis-swapping
  rotations.
- **F3, correctness — resolved:** resetting Image Kind to Automatic updates the
  materialized local and browser-mock source kind immediately, so an already
  loaded viewer cannot retain the prior override until a later query reload.
- **F4, correctness — resolved:** photo metadata probe failures remain below the
  current refresh checkpoint and therefore retry normally instead of clearing
  prior camera data and being treated as complete.
- **F5, correctness — resolved:** explicit photo refresh includes a row that the
  user corrected to Photo even when its prior automatic detection was Generated;
  automatic Generated rows remain excluded by the generated-precedence rule.
- **F6, data integrity — resolved:** normal Remove/Restore now preserves the
  photo-refresh checkpoint as well as visible camera fields, matching the exact-
  duplicate removal path and keeping failed or stale rows eligible for retry.
- Focused closure checks cover the affected Rust SQL paths, the frontend action
  and repository seams, and the actual effective-date predicate against the
  10,000-row indexed query-plan fixture. No blocking finding remains open.
- Closure verification passed 87 focused frontend tests and all 546 Rust tests,
  plus TypeScript, Cargo formatting, and diff-whitespace checks. The sequential
  release gate completed its version, bindings, lint, typecheck, guarded build,
  coverage, and Rust stages; its ten-minute command wrapper expired during the
  final Windows release compile, which then passed authoritatively when replayed
  as the isolated no-bundle Tauri compatibility check.

Acceptance evidence audit (2026-07-29):

| Criterion | Direct evidence | Status |
| --- | --- | --- |
| JPEG orientations 1/3/6/8 and oriented dimensions | `jpeg_orientation_matrix_decodes_to_oriented_dimensions`, thumbnail decode coverage, and native screenshots 03/04 | Proven |
| Capture, camera, lens, focal, aperture, shutter, ISO, copyright, and graceful omission | `extracts_camera_fields_without_inventing_capture_timezone`, `MetadataSidebar` photo coverage, and native screenshot 04 | Proven |
| Photos exclude generator placeholders, prompts, Workflow, and Creative Assistant | `renders a photograph as Details and Library without generation controls` plus native screenshots 04/06 | Proven |
| Generated JPEG/PNG/WebP behavior remains intact | Existing JPEG Comfy EXIF, PNG chunk/A1111, WebP EXIF, InvokeAI, and reparse suites all pass inside the 546-test native and complete frontend gates | Proven |
| Source filters agree across result/count/query surfaces | Source-kind scope, image-query, SQL helper, smart-count, and integration coverage plus native screenshots 02/03/14 | Proven |
| Migration performs no source mutation or automatic photo scan | Migration 63/64 tests, startup refresh assertion `refreshPhotoMetadata: false`, and before/after corpus plus production/development catalog hashes | Proven |
| Explicit refresh reports progress, cancellation, failure, restart, and retry | Reparse checkpoint/failure tests, metadata-refresh hook coverage, and native screenshots 07–10 with the exact 455-row resume | Proven |
| Gallery and Maintenance share origin-aware viewing | Shared viewer/sidebar tests, Maintenance hydration coverage, and native Remove/Restore journey screenshots 11/12 | Proven |
| Large libraries stay virtualized and source/date predicates are indexed | Existing `VirtualGrid` path, the 1,056-item native tail/timeline journey in screenshots 13/14, and 10,000-row query-plan assertions | Proven |
| Supported-format copy matches native behavior | Settings and import copy name PNG/JPEG/WebP; native folder scan accepted those formats and rejected the deliberately malformed entry | Proven |

All engineering and user-journey criteria are proven. The product owner accepted
the rendered experience on 2026-07-29, so every Milestone 1 completion criterion
is satisfied.

### Milestone 1 integration gate

After all three packages are review-clean:

- Perform one comprehensive review plus focused migration, untrusted-metadata,
  thumbnail-cache, and query-performance review.
- Run the full frontend and Rust suites, bindings check, typecheck, lint, Cargo
  formatting/check, production frontend build, and release verification gate.
- Run the actual Windows Tauri journey against a temporary app-data profile and
  the sanitized photo corpus.
- Confirm no source file changed, no GPS entered a network payload, existing AI
  fixtures still parse identically, and incomplete capabilities are not
  advertised.

Milestone status: Complete and product-owner accepted (2026-07-29). GPS is
stripped by pixel decode and metadata-free WebP re-encoding before the Gemini
request; source and profile integrity checks passed.

### Accepted follow-up observations

- Empty collection copy still says “Organize your generations,” which now
  understates mixed libraries.
- The Add Images modal needs a compact-height pass; its action row is awkward to
  reach at the default 800x600 QA window size.
- Filename fragments are not currently part of search, making a known camera
  file harder to locate without browsing.
- Resume Smart Refresh is accessible by label and tooltip but visually presents
  as an icon-only action; restart recovery deserves stronger discoverability.
- The package description still positions Ambit only around AI-generated image
  libraries. Decide whether the public wording should explicitly name hybrid
  photo/reference libraries before announcing photography support.

## Milestone 2: Photo Review and Culling

Promotion trigger: milestone one is accepted and users demonstrate a need to
review photographs inside Ambit rather than only catalog them.

Outcome:

- Add local 0-5 ratings and a separate Reject state; keep Favorite and Pin
  semantically unchanged.
- Add shortcuts `0`-`5` and `X`, optional auto-advance, and a compact photo
  review strip inside the existing viewer instead of building a second viewer.
- Add indexed Rating, Rejected, Camera, Lens, and Capture Date filters.
- Keep aperture, shutter, ISO, and focal-length data visible; add range filters
  only if user evidence justifies their query/UI cost.
- Add local caption and keywords only after their precedence relative to future
  XMP sidecars is defined.

Acceptance gate:

- A user can cull a representative folder using only the keyboard, leave and
  reopen Ambit without losing state, filter to accepted/rejected/rated images,
  and use the same viewer from Gallery and Maintenance.
- Culling does not introduce eager rendering or per-image write amplification
  that makes a large library visibly stall.

## Milestone 3: Interoperability and Additional Formats

Promotion trigger: accepted photography workflows show concrete demand for
exchange with another photo manager or for formats absent from milestone one.
Treat each item below as its own feasibility and product gate, not as one broad
commitment.

1. Read XMP sidecars for rating, reject/label, caption, keywords, copyright, and
   GPS with explicit precedence and watcher pairing rules.
2. Consider opt-in XMP writeback only after conflict handling, atomic writes,
   recovery, watcher-loop suppression, and external-editor interoperability are
   proven.
3. Spike HEIC/HEIF and AVIF decoding, metadata, packaging, licensing, and
   platform behavior.
4. Spike camera RAW through embedded previews before considering full decode;
   define RAW+JPEG pairing and stacking independently.

Permanent near-term non-goals remain RAW development, non-destructive edit
recipes, lens profiles, color grading, tethering, and cloud synchronization.

## Approval Decisions

Approval of this plan means:

- implement only Milestone 1 first;
- begin with the native contract feasibility package and stop for re-planning if
  its timestamp, parser, orientation, or platform evidence invalidates the
  proposed schema;
- include TIFF only on positive feasibility evidence;
- retain local-only, collapsed GPS handling;
- require a separate approval before starting culling, XMP, HEIC/HEIF, or RAW
  work.
