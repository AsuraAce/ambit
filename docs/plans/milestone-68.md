# Milestone 68: GenAI Video Library Support

Status: In progress - WP1 and WP2 accepted; WP3 is next
Delivery posture: Assure
Baseline: `origin/main` at `a6ee3ec7b9f33bba070d98dc481722f4dac10957`
(`chore(main): release 0.9.1 (#261)`, fetched 2026-07-29)

## Outcome

Ambit can catalog, inspect, play, search, and manage finished local GenAI video
files alongside images without weakening image behavior, local-first guarantees,
filesystem scope safety, or large-library performance.

The first supported journey is intentionally narrow:

1. A user manually imports a supported video.
2. Ambit probes it without modifying the source, generates a static poster, and
   persists an explicit video record.
3. The mixed library shows that poster with duration and media-type cues without
   instantiating background video players.
4. The viewer plays a supported file or explains why it requires an external
   player.
5. The user can inspect technical and recovered GenAI metadata, add the video to
   collections, favorite it, annotate it, export it, remove it, and restore it.
6. Folder sync and Live Watch provide the same behavior after the manual path is
   accepted.

The repository's pinned ComfyUI catalog contains 549 templates, including 140
video templates that are all currently excluded as `non_image_output`. Twenty-six
of those video templates are open-source and use no listed custom nodes. This is
the initial evidence pool for representative metadata coverage, not a commitment
to promote every video template in this milestone.

## Product Acceptance Criteria

- A fresh library and a database upgraded from 0.9.1 preserve all existing image
  records and behavior while supporting explicit image/video discrimination.
- On the packaged Windows app, an admitted H.264/AAC MP4 can be imported, shown
  with a poster and duration, opened, played, paused, muted, and seeked.
- WebM VP9 with Opus is admitted for in-app playback based on the packaged
  feasibility matrix. MOV, M4V, and MKV may be cataloged
  when probing succeeds, but playback remains codec-capability dependent.
- A valid but unsupported video remains manageable and offers `Open externally`;
  a corrupt or incomplete file produces a stable diagnostic and does not abort a
  broader import or watch batch.
- Generic library operations work for videos: search, media filter, collections,
  favorites, pinning, notes, missing-file audit, exact duplicate detection,
  export, Removed, restore, and permanent-record cleanup.
- Image-only actions such as image comparison, stacking/version semantics,
  slideshow behavior, and Gemini image recovery reject or exclude videos
  explicitly instead of failing at runtime.
- At least one pinned representative fixture is accepted for each admitted GenAI
  video mode. Extracted values identify their evidence source and conflicting
  evidence is preserved rather than blended.
- Browsing remains virtualized. Grid and timeline cells render static posters,
  never autoplay, and never create one `<video>` element per result.
- Privacy masking covers the poster and prevents playback or audio until the user
  reveals the item.
- Existing image-focused tests remain green, targeted video tests pass, the
  release verification gate passes, and the packaged Windows journey is owner
  smoke-tested.

## Approved Direction and Assumptions

Approval of this plan approves the following direction. Reopen the plan before
implementation if any assumption is wrong because each would materially change
scope or architecture.

- **One mixed library:** videos live beside images and use the existing
  collection, search, maintenance, and viewer entry points. Ambit does not create
  a separate video library.
- **Finished assets, not authoring:** Ambit manages generated outputs and their
  provenance. It does not become a generator, editor, compositor, or general
  transcoder.
- **Windows-first acceptance:** Windows is the shipping release target. macOS and
  Linux remain experimental and receive a documented capability matrix rather
  than blocking the first accepted Windows slice.
- **Manage beyond playable:** container and codec are separate. Successfully
  probed files remain catalogable even when the current webview cannot decode
  them.
- **No source mutation:** Ambit stores previews and normalized metadata in app
  data or SQLite and preserves raw evidence. It never rewrites a source video to
  add metadata or improve playback.
- **Native work stays Rust-owned:** the frontend receives narrow Specta-generated
  commands and result types. It cannot invoke a general media binary or supply
  arbitrary arguments.
- **Compatibility before naming cleanup:** add a media discriminator to the
  existing `images` and `removed_images` persistence boundary for the MVP. Do not
  rename every table, command, repository, and historical image type before the
  feature is proven. Record the remaining naming debt in `docs/refactor.md` when
  it becomes real.
- **Probe before trust:** extensions identify candidates only. Probe results, not
  filenames, determine media type, technical properties, and playback status.

## Target Design

```text
scoped candidate path
        |
        v
bounded native probe -----> corrupt / unsupported diagnostic
        |
        +-----> technical metadata + playback capability
        |
        +-----> static WebP poster in app-local data
        |
        v
SQLite media record -----> virtualized poster card -----> media viewer
        |
        +-----> embedded tags / validated sidecar evidence
                          |
                          v
                  generator parser + provenance
```

### Persistence and Types

- Introduce a discriminated frontend library type, conceptually
  `LibraryAsset = ImageAsset | VideoAsset`. Keep `AIImage` at image-only
  boundaries until a caller genuinely accepts both kinds.
- Add `media_type TEXT NOT NULL DEFAULT 'image'` to current and Removed records.
  Add only probe fields required by accepted behavior: container/MIME, duration,
  video codec/profile, audio presence/codec, frame-rate numerator and denominator,
  rotation, and probe/playback status.
- Keep prompt, model, seed, workflow, resources, favorites, collections, notes,
  timestamps, file size, file hash, and privacy state common where their semantics
  are genuinely shared.
- Do not require exact frame count. It can be expensive to derive and is
  unreliable for variable-frame-rate media; add it later only for an accepted
  user journey.
- Index `media_type` through equality-friendly query paths. Replace the current
  `count * 2.4 MB` library-size estimate with actual stored file sizes and report
  image/video counts separately.

### Probe, Poster, and Playback

- Bundle the pinned MediaInfo CLI as the sole MVP media sidecar. It returns
  bounded JSON for format, streams, and selected tags. FFmpeg remains a
  development-only fixture generator and is rejected as a shipping dependency.
- Use fixed Rust-owned arguments, canonical scoped paths, a 15-second timeout,
  256 KiB stdout and 32 KiB stderr limits, cancellation with child kill/reap,
  and low concurrency. A zero exit code is not success without a sane Video
  track.
- Pin the archive and extracted executable checksums separately, include the
  MediaInfo BSD-style notice, omit its optional network DLL, and assign update
  ownership.
- Generate one WebP poster in a single background WebView queue by seeking a
  playable file and drawing it to canvas with `crossOrigin = "anonymous"`.
  Use a generic poster when runtime decoding is unavailable and version the
  strategy so maintenance can regenerate old posters.
- Add the asset protocol to `media-src` in CSP only after a packaged test proves
  local playback and seeking. Loading a video must still require the existing
  dynamic path-scope registration.
- The viewer uses a dedicated video presentation inside the shared viewer entry
  point. Unsupported playback shows the poster, technical reason, and existing
  OS-level external-open action instead of a blank player.

### Metadata Evidence

Preserve candidates independently and resolve their display value with explicit
precedence:

1. user override;
2. validated sibling workflow sidecar;
3. embedded container or stream tags;
4. generator defaults only when supported by exact workflow evidence.

Never discard a lower-priority conflicting value. Store its source and raw
evidence so a future parser can re-evaluate it.

The first admitted generation modes are:

- text-to-video;
- image-to-video;
- first/last-frame-to-video;
- video-to-video or video editing;
- audio-to-video or lip sync;
- guided video such as ControlNet, inpainting, or motion control;
- unknown.

Begin with core ComfyUI `SaveVideo` output selection and pinned official
workflows. Custom save nodes are accepted only after a real fixture proves their
output edge and metadata representation; node names alone are not evidence.

## Dependency-Ordered Work Packages

### WP0 — Packaged Media Feasibility and Decision Gate

Primary invariant: Ambit has a measured, distributable, path-safe way to probe
and poster supported videos, and the packaged Windows webview can play and seek
the admitted baseline profile.

Scope:

- Build a checked-in fixture manifest referencing a local test corpus. Do not
  commit copyrighted or very large media unless its license and size are suitable.
- Cover H.264/AAC MP4, VP9/Opus WebM, representative MOV/M4V/MKV containers,
  HEVC or AV1 capability-dependent samples, audio/no-audio, rotation, variable
  frame rate, embedded tags, sidecar JSON, corrupt/truncated input, and a large
  seekable file.
- Compare the expected bundled FFmpeg toolchain with any materially simpler
  native alternative. Record the selected build, distribution obligations,
  attack surface, update process, binary-size impact, and rejected alternatives.
- Prototype a bounded Rust-owned probe and WebView poster capture without
  production schema writes or frontend API expansion.
- Verify asset protocol scope, `media-src` CSP, load, seek, replay, and external
  fallback in a packaged Windows build rather than relying on browser mocks.

Non-goals:

- No production migration, import allowlist, library card, persistent video
  record, parser promotion, or user-facing promise.
- No automatic transcoding and no system-installed FFmpeg dependency.

Targeted verification:

- Deterministic probe snapshots for every corpus case.
- Timeout, cancellation, invalid-path, corrupt-file, oversized-output, and
  unsupported-codec tests.
- Packaged owner smoke test recording playback/seek result and installer delta.
- License and binary provenance checklist reviewed before committing binaries.

Completion criteria:

- The plan records `accepted`, `accepted with constraints`, or `rejected` for the
  probe/poster toolchain and every candidate playback profile.
- Security, distribution, performance, and packaging unknowns are bounded enough
  to design the persistent slice.
- If the expected toolchain is rejected, stop and revise WP1 rather than hiding
  the gap behind extension-only support.

Approval gate: review the WP0 decision record before WP1 because changing the
toolchain after schema and command work would materially increase cost.

Plan direction and the WP0 decision were accepted on `2026-07-29`. WP1 is the
active package. Folder and Live Watch discovery remain deferred to WP2.

#### WP0 Decision Record — 2026-07-29

**Probe and packaging: accepted with constraints.** Use MediaInfo CLI 26.05 from
the official Windows x64 archive. The archive SHA-256 is
`f7f80620ce6d14f4995f0de6f98e3ef18ad29496db01899571152ee3311229f9`;
the extracted 9,293,720-byte `MediaInfo.exe` SHA-256 is
`30f2828a45a1895b033c3cd7784581033327e7b393033c55f4a03bb15cab0d89`.
The executable works without the optional `LIBCURL.DLL`.

The disposable Tauri packages measured:

| Package | Baseline | With sidecar | Delta |
| --- | ---: | ---: | ---: |
| NSIS | 1,934,817 B | 4,691,572 B | 2,756,755 B / 2.629 MiB |
| MSI | 2,957,312 B | 6,729,728 B | 3,772,416 B / 3.598 MiB |

Both the installed NSIS application and administratively extracted MSI contained
the exact approved executable checksum. The compressed delta is below the 15 MiB
gate. A signed production updater delta remains a WP4 artifact check.

The bounded Rust prototype passed nine focused tests: valid parsing, malformed
JSON, zero-exit output without a Video track, canonical in-scope regular-file
validation, timeout, cancellation, stdout limit, stderr limit, and child-process
cleanup. MediaInfo returns exit code zero for missing and truncated inputs, so
Ambit must retain the wrapper's semantic validation rather than trust process
status.

**Packaged Windows playback matrix:** five NSIS-installed runs used WebView2
Edge 150 at `http://tauri.localhost`. Every admitted case loaded metadata,
seeked, played, replayed, and captured a WebP poster through the asset protocol.

| Profile | Installed result | Decision |
| --- | ---: | --- |
| H.264/AAC MP4 | 5/5, including 18-second seek in a 26 MB file | Accepted baseline |
| H.264 M4V, no-audio, true VFR, and 270° display matrix | 5/5 each | Accepted container/technical cases |
| VP9/Opus WebM | 5/5 | Accepted baseline |
| AV1/Opus MKV | 5/5 locally despite empty `canPlayType()` | Capability-dependent; manage with fallback |
| HEVC/AAC MOV | 4/5; one `MEDIA_ERR_DECODE` | Capability-dependent; manage with fallback |
| Truncated MP4 | Rejected 5/5 as `invalidMedia`; WebView `MEDIA_ERR_SRC_NOT_SUPPORTED` | Stable corrupt diagnostic |
| Missing path | Rejected 5/5 before process launch as `invalidPath` | Stable path diagnostic |

The existing Windows `explorer.exe <path>` mechanism successfully handed the
HEVC/MOV fixture to the configured OS application. Actual media events, not
`canPlayType()`, are normative for playback because AV1 played with an empty
capability string. Canvas export requires `crossOrigin = "anonymous"` even for
the scoped Tauri asset protocol.

**Rejected alternative:** the tested BtbN FFmpeg 8.1 LGPL static build placed
`ffmpeg.exe` and `ffprobe.exe` at approximately 226.9 MB uncompressed and added a
substantially larger codec, licensing, security-update, and distribution surface.
Do not ship it in the MVP and do not depend on a system installation.

The reproducible corpus inventory and exact hashes live in
`docs/plans/milestone-68-wp0-corpus.json`; the synthetic media remains local and
uncommitted. WP1 may begin only after this decision is accepted.

### WP1 — Manual Import-to-Viewer Vertical Slice

Primary invariant: one admitted video can be manually imported, persisted,
displayed as a static card, reopened after restart, and played or explained in
the shared viewer while existing image behavior remains unchanged.

Scope:

- Add the next migration after mainline migration 62 for the discriminator and
  minimum technical video fields in both active and Removed records.
- Add narrow Rust probe/poster result types and commands, regenerate Specta
  bindings, and adapt the manual picker/import pipeline.
- Introduce discriminated library types at the query/card/viewer boundaries that
  accept video; keep image-only helpers and actions narrowed.
- Dispatch the shared viewer entry point to the existing image presentation or a
  new accessible video presentation with play/pause, seek, mute/volume, time,
  playback rate, fullscreen/theater compatibility, and external fallback.
- Add poster, video icon, duration, audio, unsupported, corrupt, missing, and
  privacy states to the existing card without weakening virtualization.
- Support favorite, collection membership, notes, raw export, remove, and restore
  for the manually imported item.

Non-goals:

- No folder scan, Live Watch, broad generator parsing, hover scrub, animated
  previews, video comparison, mixed slideshow, or perceptual duplicates.
- No broad rename of `images`, `ImageRecord`, or every `AIImage` caller.

Targeted verification:

- Fresh and upgraded migration tests, including Removed round-trip.
- Rust probe/poster command tests and generated-binding drift check.
- Import failure isolation and restart-persistence tests.
- Card/viewer accessibility and capability-fallback frontend tests.
- Existing image import, card, shared viewer, export, and Removed regression tests.
- Packaged Windows manual journey for import, play/seek, collection, export,
  remove, restore, restart, and unsupported fallback.

Completion criteria:

- The full manual journey is demonstrable with no known blocking defect.
- No grid or timeline result creates a video decoder before the viewer opens.
- Existing image acceptance remains green.

Implementation checkpoint (2026-07-29): the WP1 code slice and automated gates
are complete. Frontend coverage passed 2,894 tests with one intentional skip;
the Rust library passed 532 tests with one intentional ignore; generated bindings,
MediaInfo checksum/provenance, lint, strict type checking, production build, and
the Tauri release-profile no-bundle build passed. The package remains open until
an owner completes the installed Windows import/play/seek/export/remove/restore/
restart and unsupported-codec journey.

Owner smoke tests can double-click `Start Ambit Video Smoke.cmd` at the repository
root, or use `pnpm run app:video-smoke`. Both launch the dedicated
`com.ambit.dev.video-smoke` profile instead of the shared `com.ambit.dev`
profile used by other worktrees. On Windows, its development SQLite catalog is
`%APPDATA%\com.ambit.dev.video-smoke\images.db`; its settings, posters, logs,
and WebView state are under `%LOCALAPPDATA%\com.ambit.dev.video-smoke`. Startup
purge recovery resolves the runtime identifier and is regression-tested not to
touch the shared development profile.

Owner-smoke remediation checkpoint (2026-07-29): the first native smoke found
three WP1 blockers and one separate application-lifecycle defect. Windows
verbatim video IDs were collapsed by frontend path normalization, so favorite,
pin, collection, notes, playback-status, remove, and restore writes could match
no database row while optimistic UI reported success. The shared normalizer now
preserves verbatim and UNC prefixes, user-facing mutations reject unmatched IDs,
and notes roll back on persistence failure. The video viewer now exposes visible
10-second seek controls and J/L seeking while Left/Right remains gallery
navigation. Window close now drains and flushes settings before using Tauri's
process exit API, avoiding the re-entrant `window.close()` request that could
leave the process open.

The remediation release gate passed 2,901 frontend tests with one intentional
skip and 534 Rust tests, plus version, MediaInfo, binding-drift, lint, strict
TypeScript, guarded production build, and Tauri release-profile no-bundle checks.
The earlier Maintenance lazy-load error was an orphaned dev window after its
Vite server stopped and is not a product-runtime blocker.

WP1 closure checkpoint (2026-07-30): the owner re-smoke accepted the remediated
import, playback, persistence, collection, removal, and close behavior. A final
review then fixed four boundary defects: native command failures now isolate one
video instead of aborting the batch; the video viewer reloads persisted collection
membership; changed-file reimports reset stale playback/poster state while exact
duplicates preserve it; and Maintenance thumbnail sync excludes videos from the
image scanner. Focused closure tests passed, followed by the complete release
gate: 2,905 frontend tests passed with one intentional skip, all 535 Rust tests
passed, and version, MediaInfo checksum/provenance, generated bindings, lint,
strict TypeScript, guarded production output, and the Tauri release-profile
no-bundle build were green. No blocking WP1 finding remains; WP2 may begin.

### WP2 — Folder, Live Watch, and Mixed-Library Operations

Primary invariant: candidate videos discovered through configured folders and
Live Watch converge to the same records and behavior as manual import without
creating unbounded probe, poster, hash, or database work.

Scope:

- Generalize candidate discovery, folder statistics, initial sync, background
  sync, Live Watch filtering, cancellation, and progress language.
- Admit the extension set proven by WP0, initially considering MP4, WebM, MOV,
  M4V, and MKV; require probe confirmation before persistence.
- Apply missing audit, exact duplicate hashing, Removed, restore, permanent record
  removal, raw export, collections, favorites, pinning, notes, and privacy policy
  to both media types.
- Add All/Images/Videos filtering, media-aware counts and actual storage totals.
- Bound probe and poster concurrency, prioritize foreground import/viewer work,
  and reuse the current activity/cancellation model.
- Keep image-only stacking, compare, slideshow, intermediate/grid heuristics, and
  Gemini recovery explicitly image-scoped.

Non-goals:

- No frame-by-frame indexing, perceptual video duplicate detection, automatic
  codec conversion, autoplay, or default animated thumbnails.
- No macOS/Linux release promise; record observed experimental results only.

Targeted verification:

- Equivalent manual/folder/watch ingestion results for the same source file.
- Watch create, modify, rename, remove, burst, cancellation, and corrupt-file
  isolation tests.
- Mixed collection, Removed, export, hash, missing-audit, filter, sort, pagination,
  and storage-stat tests.
- A representative large mixed-library test proving bounded concurrency, light
  query fields, stable virtualization, and no background video decoders.
- Privacy test proving masked video cannot reveal poster, motion, or audio before
  an explicit reveal.

Completion criteria:

- Manual, sync, and watcher paths converge without duplicates or divergent
  metadata.
- Large-library browsing remains responsive under the existing performance
  expectations and no new unbounded startup scan is introduced.

Implementation checkpoint (2026-07-30): configured-folder discovery and the
shared import queue now admit the WP0 video extension set with the same duplicate,
stability, cancellation, progress, and failure-isolation behavior as images. Live
Watch emits typed create/modify/rename/remove changes; rename preserves record
identity and user state, and removal converges through the existing missing-link
path. Mixed-library exact hashing, Removed preservation, ZIP export, collections,
flags, notes, privacy, and missing audit accept videos while comparison,
intermediate/grid maintenance, thumbnail work, slideshow, and Gemini recovery
remain image-only. The gallery adds All/Images/Videos filtering, smart collections
can preserve the media rule, and statistics report distinct item/image/video
counts plus stored file bytes instead of the old per-item estimate. ZIP source
reads are bounded to four concurrent files and include video technical fields in
the manifest.

Automated evidence at this checkpoint: 321 focused frontend regressions passed;
the complete frontend suite reached 2,916 passing tests with one intentional skip
after its single task-related expectation was updated; all 541 Rust tests passed
with one existing ignored parser test; lint, strict TypeScript, generated binding
drift, frontend production build, and the Tauri release-profile no-bundle build
passed. The all-repository single-worker coverage command exceeded the local
six-minute tool limit and briefly reported eight order-sensitive UI failures; all
83 affected tests, including the changed statistics surface, passed together both
normally and under coverage instrumentation. Owner smoke and the final closure
review remain the WP2 acceptance gates.

Owner-smoke remediation checkpoint (2026-08-09): adding the first monitored
folder after an empty startup imported its image and video successfully but could
also emit a false "completed with import errors" warning. The startup catch-up
effect was still eligible to claim that newly queued folder, competing with the
Settings-owned initial scan. Startup eligibility now closes after the first
loaded pass even when no folders are configured, leaving later queued folders to
their owning scan. The exact empty-startup-to-queued-folder regression and the
adjacent folder/integration suites pass; owner smoke remains in progress.

A second owner-smoke failure showed that native create, modify, and rename
notifications were logged but did not update the library. The typed Specta event
was declared but never mounted during Tauri setup, so the first background emit
terminated the forwarding task. Tauri now mounts the event registry before any
watcher can start. Windows `RenameMode::From`/`RenameMode::To` fragments are also
coalesced into one typed rename so record identity and user state can move with
the path. Five focused Rust watcher tests, two startup-order tests, generated
binding drift, and 81 frontend watcher/integration tests pass. A full app restart
and owner re-smoke of create, modify, rename, and remove remain required.

The restarted owner smoke then accepted create and modify but exposed a Windows
rename identity mismatch: imported videos used canonical `//?/C:/...` IDs while
watcher payloads used `C:/...`, so the move missed the source and the subsequent
import created a second row without the source favorite or pin state. Native
identity moves now match normal, verbatim-drive, and verbatim-UNC forms while
retaining the stored identity style, thumbnail provenance, flags, and
relationships; the restarted owner re-smoke accepted rename with one preserved
record.

The following remove smoke confirmed that the watcher event reached the app but
the frontend missing-link update did not match the stored verbatim identity, so
the absent video remained `is_missing = 0` and appeared playable until viewer
preparation failed. Watcher removals now use a native identity-aware command that
marks the matching record missing while preserving favorite and pin state. The
video viewer now identifies this state as a missing source and does not offer
playback, external-open, or original-export actions for the absent file. The
focused Rust identity regression, 112 frontend repository/watcher/integration
tests with one intentional skip, strict TypeScript, formatting, and generated
binding drift pass. The restarted owner smoke accepted removal with exactly one
missing record, no watched source file, and preserved favorite and pin state.
The remaining mixed-library owner smoke accepted media filtering, mixed
collections, favorite and pin persistence, Removed and restore, original and ZIP
export, and the shared privacy policy. Masked images and videos now follow one
explicit rule: hover never reveals, card reveal expires on mouse leave, an
already-revealed card can open its viewer without a second prompt, direct or
keyboard viewer entry remains gated, and no full media or video playback is
initialized before viewer reveal. The momentary protection frame shown while
`Shift+H` rebuilds the privacy-filtered query remains intentionally fail-closed;
its split-second duration can read as a visual flicker but does not expose media.

WP2 closure review (2026-08-09) found and fixed three bounded edge cases: a
verbatim UNC rename target could be prefixed twice, Maintenance always opened
videos in the image viewer, and Removed videos were excluded from playback path
preparation. Regression coverage now protects verbatim UNC identity, native
Maintenance video routing, and Removed-video playback lookup. Generic
favorite/pin/collection copy and the smart-collection media lock glyph were also
normalized. Final automated evidence is 2,924 passing frontend tests with one
intentional skip and 547 passing Rust tests with one existing ignored parser
test; lint, strict TypeScript, generated binding drift, and diff checks pass. No
blocking WP2 finding remains.

A follow-up WP2 assurance pass tightened cancellation and poster safety for large
video libraries. Cancelling an import now interrupts browser poster extraction
instead of waiting for media-event timeouts; unchanged duplicate records no
longer decode and store a redundant poster; posterless videos use generic
placeholders in Maintenance, exact-duplicate results, and collection thumbnails
instead of assigning the source video to an image element; and exact-hash
cancellation is checked at every 1 MiB read boundary rather than only between
files. The focused remediation set passed 148 frontend tests. The final gate
passed 3,150 frontend tests with one intentional skip and all 771 Rust tests,
plus lint, strict TypeScript, Rust formatting, generated binding drift, and diff
checks. The closure review found no remaining blocking WP2 issue.

Restore closure follow-up (2026-08-09): restore now preserves the original
library timestamp and lets the active query reapply its configured sort and
filters instead of prepending the restored item as newest. Native restore also
rechecks local source presence, restores missing sources with `is_missing = 1`,
and preserves video probe/playback fields, flags, notes, and collection state.
It intentionally does not merge a stale removed path into a separately renamed
asset. Latest-main integration verification passed 3,144 frontend tests with one
intentional skip and all 770 Rust tests, plus lint, strict TypeScript, Rust format,
and generated-binding drift checks. WP3 is next.

### WP3 — GenAI Video Metadata and Provenance

Primary invariant: Ambit reports only metadata supported by preserved embedded,
sidecar, or pinned workflow evidence and can explain where the displayed value
came from.

Scope:

- Preserve selected container/stream tags and validated sibling JSON without
  rewriting source files.
- Define strict sidecar matching and workflow-shape validation so an unrelated
  same-basename JSON file cannot silently become trusted metadata.
- Extend ComfyUI output selection for core `SaveVideo` and reuse existing graph
  traversal for the admitted generation modes.
- Start with a minimum representative pinned set from the 26 open-source,
  no-listed-custom-node video templates, including text-to-video,
  image-to-video, first/last-frame-to-video, editing, audio/lip-sync, and guided
  video. Add exact fixtures and expectations before changing parser behavior.
- Expose technical metadata, prompts, resources, workflow, generation mode,
  evidence source, and conflicts in the existing metadata/workflow surfaces.
- Version video parser behavior and make reparsing repeatable from preserved raw
  evidence.

Non-goals:

- No claim of all 140-template coverage, speculative custom-node rules, remote
  generator API integrations, cloud video analysis, or metadata inferred from
  model family alone.
- No source-container rewrite to embed a normalized workflow.

Targeted verification:

- Exact fixture identity, raw evidence preservation, graph/output selection,
  prompts, resources, generation mode, provenance, and conflict-precedence tests.
- Sidecar mismatch, malformed JSON, missing tags, inactive graph branch, and
  unsupported custom-save-node negative tests.
- Parser-version and reparse tests proving previously imported videos can be
  corrected without rescanning source bytes when evidence is already stored.
- Frontend tests for technical fields, workflow visibility, evidence labels, and
  conflicts.

Completion criteria:

- Each admitted mode has at least one exact pinned representative.
- No golden is weakened to make a heuristic pass and no value is fabricated when
  evidence is absent.

### WP4 — Integration, Documentation, and Release Acceptance

Primary invariant: the complete mixed-media journey is regression-clean,
recoverable, documented honestly, and ready for the Windows release channel.

Scope:

- Run a separate integration review across migration/recovery, scope safety,
  native process handling, import/sync/watch convergence, query performance,
  viewer accessibility, privacy, Removed/export, and parser evidence.
- Resolve blocking findings through a compact finding ledger and focused closure
  review; re-plan if remediation materially exceeds a package boundary.
- Update architecture, progress, README/product description, manual, privacy and
  network disclosures, maintenance terminology, and release notes only after the
  capability is accepted.
- Record the exact supported/manage-only matrix and macOS/Linux experimental
  results. Do not advertise codecs or generators that were not tested.

Non-goals:

- No editor, transcoder, cloud upload, semantic video search, C2PA verification,
  contact-sheet analysis, hover scrub, synchronized comparison, or mixed-media
  slideshow unless separately accepted.

Targeted verification:

- Narrow checks from each package, then `pnpm run verify:release` at the milestone
  gate.
- Clean upgrade from a backed-up 0.9.1 production-shaped database and successful
  rollback/recovery exercise using the existing backup path.
- Packaged Windows owner acceptance of manual import, folder sync, Live Watch,
  poster, playback/seek, unsupported fallback, metadata/provenance, privacy,
  collection, export, missing, remove, restore, restart, and large-library browse.
- Installer/updater artifact inspection confirming the selected media binaries,
  notices, checksums, and expected size.

Completion criteria:

- All product acceptance criteria pass with no known blocking defect.
- Unverified platform, codec, generator, and custom-node combinations are listed
  explicitly rather than implied by generic `video support` wording.

## Material Risks and Promotion Triggers

| Risk | Required control or decision |
| --- | --- |
| Untrusted media parser input | Pinned maintained binaries, Rust-owned fixed arguments, scope validation, time/output limits, cancellation, corrupt-corpus tests, and an update owner. |
| MediaInfo licensing and binary provenance | Pin the official archive and extracted executable checksums separately, ship the BSD-style notice, omit the optional network DLL, and assign update ownership. |
| Webview codec variability | Separate catalogability from playability, probe container/codec, test the packaged runtime, and always provide external fallback. |
| Installer and updater growth | Measure WP0 artifacts and obtain approval if the delta materially changes distribution cost or update experience. |
| Database migration or Removed mismatch | Default existing rows to image, migrate active and tombstone records together, and exercise upgrade/recovery with a production-shaped backup. |
| Large-file and large-library I/O | Static posters, no grid decoders, bounded/backgroundable probe and hash work, light query rows, cancellation, and measured mixed-library tests. |
| False GenAI metadata | Pinned fixtures, output-edge evidence, explicit provenance/conflicts, strict sidecar validation, and no node-name-only inference. |
| Privacy leak through motion or audio | Apply privacy before player creation, block autoplay, mask posters, and require explicit reveal before media load/playback. |

Stop and revise the plan if WP0 rejects a distributable probe/poster toolchain,
packaged seeking is unreliable for the admitted baseline, the installer delta is
unacceptable, or the compatibility-first persistence approach cannot preserve
type safety without a broader migration.

## Explicit Deferred Work

- Automatic transcoding or proxy generation.
- Video editing, trimming, frame export, compositing, or generation.
- Perceptual/video-near-duplicate detection.
- Default hover playback or animated grid thumbnails.
- Synchronized video comparison and mixed-media slideshow policy.
- Keyframe/contact-sheet semantic search and cloud video analysis.
- C2PA verification or signing.
- Broad custom-node and all-template ComfyUI coverage.
- Promoting macOS or Linux artifacts to supported release status.
- Repository-wide image-to-media naming cleanup before the video capability is
  accepted.

## Normative External References

- Tauri external binaries: <https://v2.tauri.app/develop/sidecar/>
- Tauri local asset URLs: <https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc>
- MediaInfo Windows distribution: <https://mediaarea.net/en/MediaInfo/Download/Windows>
- MediaInfo license: <https://mediaarea.net/en/MediaInfo/License>
- ffprobe container, stream, tag, and JSON output: <https://ffmpeg.org/ffprobe.html>
- FFmpeg legal and redistribution guidance: <https://ffmpeg.org/legal.html>
- ComfyUI core `SaveVideo`: <https://docs.comfy.org/built-in-nodes/SaveVideo>
- ComfyUI workflow and sidecar rationale: <https://docs.comfy.org/development/core-concepts/workflow>
- Windows codec availability: <https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/supported-codecs>
