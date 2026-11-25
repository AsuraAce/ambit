# Tiles Empty Until Hovered

Status: Approved 2026-11-25 (option A), implemented; owner smoke pending.

Approval conditions (planner): no `decode()` contingency in this change; if the smoke still shows a stall, report before building anything. The idle-repair ordering goes to its own issue. The #599 question goes to the owner through the planner.

Issue: [#621](https://github.com/AsuraAce/ambit/issues/621). Follows #590, #596 and #598. The thumbnail timing questions go to #599.
Posture: Assure. The change touches the gallery's render path (`VirtualGrid` → `GridItem` → `ImageCard` → `SmartImage`).

## Contents

1. Root cause
2. Fix options and recommendation
3. Thumbnail timing
4. Acceptance criteria
5. Risks and files

## 1. Root cause

### What a hover can change

Nothing in React. `ImageCard` handles only `mouseleave`, and `GridItem` and `VirtualGrid` have no hover handlers (checked with a search for `mouseenter`, `mouseover`, `pointerenter` and `mousemove` in `src/features/library`). A hover changes only CSS: `hover:-translate-y-1 hover:scale-[1.02]` on the card and `group-hover:scale-110 group-hover:opacity-100` on the image wrapper (`ImageCard.tsx:70`, `:113-114`). So when a hover makes a tile appear, the browser did it. Either it started a deferred lazy fetch, or it repainted an image that had already loaded.

### The evidence across the three reports

| Report             | Tile image                | `loading` | Stalls?          |
| ------------------ | ------------------------- | --------- | ---------------- |
| #590 (before #596) | own thumbnail, small      | `lazy`    | yes, some tiles  |
| after #596         | own thumbnail, small      | `eager`   | no reports since |
| #621 (after #598)  | original file, 3–6 MB PNG | `lazy`    | yes, some tiles  |

Small images stalled while they were lazy and stopped stalling once they were eager, so a large decode is not needed for the stall. Today the only tiles that are still lazy are the ones without their own thumbnail (`ImageCard.tsx:111`). Those are the tiles that stall. The one case nobody has seen is a large original loaded eagerly, and the fix below tests exactly that.

### Why only some tiles, and why the same session

- **Same session, same thumbnail condition.** On the test profile, almost every older row has a thumbnail: 157,832 of 157,833 rows without an owner (#596's table). The 75 images imported on 2026-11-25 had none. So on 2026-11-25 the session's new images were practically the only lazy tiles in the gallery. "Same session" and "no thumbnail" describe the same set of tiles, and that set matches the one part of the code where tiles still load lazily.
- **Only some of them.** The stall is intermittent. #590 had the same pattern before any thumbnail work: one tile in a row showed and three stayed grey. A lazy image starts loading only after Chromium's own visibility check for lazy images runs. That check runs as part of a rendering update, not when the element is inserted. Gallery tiles are positioned and moved by composited transforms: the 260 ms layout transition with `will-change: transform` and the `gallery-grid-settle` animation. Those can play without the main-thread update that runs the check. Whether a given tile gets that check depends on timing, so some tiles do and some don't. A hover forces a style and layout update, the check runs, and the local file loads at once.
- **Older tiles without a thumbnail that show directly** fit the same picture. Being lazy makes a stall possible, but it doesn't make one certain.

### Candidates from the brief

| Candidate                                                      | Verdict                                                                           | Evidence                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loading="lazy"` in `VirtualGrid` not starting until a repaint | **Most likely**                                                                   | The loading-mode table above, and a hover changes only CSS                                                                                                               |
| Decode cost of large originals                                 | Not needed for the stall; can't be fully ruled out as an extra factor in WebView2 | Small lazy thumbnails stalled in #590. The fix's smoke settles it: an eager large original that still stalls would point here.                                           |
| Tile position (first rows, mounted hidden or scrolled)         | Part of the timing, not a separate cause                                          | Tiles are mounted only within ±1500 px of the viewport (`VirtualGrid.tsx` `buffer`), and every one of them goes through the same lazy check                              |
| Error or retry path in `SmartImage`                            | Ruled out                                                                         | Retries end within about 3.5 s (500, 1000 and 2000 ms) in the visible "Failed to load" state, never an empty box. A hover causes no render, so it can't advance a retry. |
| `micro_thumbnail` placeholder                                  | Ruled out as a cause                                                              | No row has a micro thumbnail (#596's table, and the 75 new rows per the brief). The empty box is the shimmer on `bg-white/5`, or the card's own background.              |

### Reproduction attempts

- **Plain Chromium.** I built a standalone page in the built-in browser pane (Electron Chromium) with the gallery's tile CSS: a nested scroller, `translate3d` tiles, the clip path, the opacity and scale fade, and `decoding="async"`. It used 48 generated 1872×1248, 1536×1536 and 1248×1872 PNGs of about 6 MB each. Lazy tiles loaded and painted in every run, including when `src` changed on an already-visible lazy tile (60–300 ms) and when lazy images were inserted after load (about 60 ms). **The stall did not reproduce outside WebView2.** The trigger depends on WebView2's frame scheduling inside the app, which this environment can't host.
- **jsdom** doesn't model lazy loading, so a unit test can pin only the loading mode, not the stall. #596 had the same limit.
- **Useful measurement from the same page.** In a nested scroller with a 776 px viewport, lazy loading fetched every tile within about 1300 px below the viewport: 59–61 of 120 or 600 tiles in 211 px rows. `VirtualGrid` mounts tiles within 1500 px on each side. So lazy loading already fetches nearly every tile that `VirtualGrid` mounts, and it saves very little. This is the cost figure for option A.

## 2. Fix options and recommendation

### A. Load every grid tile eagerly (recommended)

`ImageCard` passes `loading="eager"` whether or not the tile has its own thumbnail. `VirtualGrid` is already the visibility check, as #596 argued for thumbnail tiles.

- **Cost.** Compared with today's lazy originals, eager also fetches the tiles mounted in the last ~200 px of the buffer below the viewport, and in the buffer above it when the grid is scrolled. Chromium's lazy margin covers about 1300 px, and `VirtualGrid`'s buffer is 1500 px. For a 6-column grid with about 250 px tiles, that is roughly 6–12 more requests in the worst case, when every tile on screen is a no-thumbnail original. Each fetch holds the encoded file, 3–6 MB, while the tile is mounted. Chromium decodes only what it rasterises near the viewport, scaled to the tile size, so loading an off-screen image doesn't decode it. Lazy already fetches about 90% of the same set, so the memory is about what lazy costs today.
- **Fast scroll.** Tiles that mount and unmount quickly start fetches that unmounting cancels. That is the same as for thumbnail tiles since #596, but with larger files. The smoke includes a fast scroll.
- **Fix size.** One line in `ImageCard.tsx` and its comment, plus the test.

### B. Fix the lazy trigger itself

For example, force a style update or `requestAnimationFrame` nudge after mount. **Rejected.** It is a guess at WebView2 internals I could not reproduce, it can't be tested, and it keeps a dependency that A removes.

### C. Show a micro thumbnail placeholder

**Rejected as the fix.** No row has a micro thumbnail. Making them at import is the same thumbnail work that §3 is about. A placeholder would turn an empty box into a blurred one, and a stalled tile would stay blurred.

### Contingency (not in this change)

If the smoke still shows tiles that need a hover once every tile is eager, the paint path is next: a large original that loaded but wasn't painted. The follow-up would be to wait for `img.decode()` before the fade-in in `SmartImage`. It will only be planned if the smoke shows it is needed.

## 3. Thumbnail timing

### Why the 2026-11-25 images got no thumbnail

1. **Imports never make thumbnails for new files.** Live Watch and the startup catch-up call `processTargetedFiles` (`SyncContext.tsx:2980`). It goes through `processFoldersUnified`, where `skipThumbnail` defaults to `true` (`importService.ts:247`, since 865c5752 "optimize import speed"). Only folder imports pass `false` (`importService.ts:1159`). Every new file therefore waits for the Smart healer.
2. **The healer waits on almost all background work.** `useThumbnailQueue.ts` starts 30 s after the app is ready (`STARTUP_DELAY_MS`). It is hard-blocked while any of these is true: importing, startup catch-up pending, owner-cache repairing, metadata refresh pending or running, sync, model resolution, scans, or thumbnail maintenance (`useThumbnailQueue.ts:103-117`). It resumes 5 s after the last block clears (`RESUME_DELAY_MS`).
3. **Owner-cache repairs hold it for their whole run.** `holdThumbnailsForRepair` (`SyncContext.tsx:363`) sets `isOwnerCacheRepairing` for every repair after the library is shown: startup, idle, switch and deferred switch. The hold lasts through every facet-lock wait inside the repair. The reason is in the comment at `SyncContext.tsx:355`: a thumbnail write dirties the cache a repair is building, and the repair's commit is then rejected.
4. **The idle repair runs before thumbnails exist.** The idle repair runs 30 s after writes stop (`OWNER_CACHE_IDLE_REPAIR_DELAY_MS`). It counts healing as "busy" only while healing is active or paused (`SyncContext.tsx:766-767`). A healer that was blocked before it ever started is neither, so the repair goes first and holds thumbnails for its whole run.

### Timeline (test profile, launch `32f8121e`, UTC)

| Time         | Event                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| 18:25:03     | Start                                                                                          |
| 18:25:37     | First Live Watch import stops the startup repair ("the idle repair redoes it")                 |
| 18:25–18:28  | 12 Live Watch batches; catch-up and imports block the healer                                   |
| 18:27:06     | Thumbnail hold (per the brief)                                                                 |
| 18:28:53     | Idle repair: full facet rebuild, after waiting 71 s for the facet build lock                   |
| 18:33:25     | Full rebuild done (271 s); the resource refresh had waited 271 s for the lock                  |
| 18:35:37     | Incremental rebuild gets the lock after 403 s                                                  |
| **18:55:03** | Startup `facets` phase completes (1,570 s, started 18:28:53); `facets.swap_staged_types` write |
| 18:57:50     | Last summary line of that launch                                                               |

So thumbnails were held for longer than 10 minutes. Background facet and owner-cache work ran until **18:55:03**, about 30 minutes after start. I have not confirmed which hold covered 18:35–18:55, because the queue's own logs go to the webview console and not to `Ambit.log`. Either way, the healer never had a free window before the owner closed the app.

### What can change without an owner decision

- **This plan's fix.** The wait stops being visible as a broken gallery, because tiles without thumbnails show their original. That needs no decision.
- **The idle-repair ordering (item 4).** Treating "new images waiting for thumbnails, healer not yet started" as busy would let thumbnails go before the idle repair. Both are internal ordering. But it touches `SyncContext` repair scheduling, a risky area with the #530 and #539 history, and it is a timing change in its own right. I propose it as **a separate follow-up issue**, not part of this change.

### What needs the owner (#599, point 2)

Making Live Watch and catch-up imports create thumbnails while they import changes when thumbnails are made. That is #599's option A or D. It costs about 0.2–0.4 s per large PNG at import, and in return those tiles never wait on repairs. Draft question for the planner to put on #599:

> New images from Live Watch and startup catch-up get no thumbnail while they import. They wait for background work, and on 2026-11-25 that wait lasted the whole 30-minute session. Should Live Watch and catch-up make each new image's thumbnail as part of its import (a fraction of a second more per image, in the background), so new images never wait behind library maintenance? (yes / no / only for Live Watch)

## 4. Acceptance criteria

1. **Test that fails on today's code.** In `ImageCard.test.tsx`, `chooses the loading mode by thumbnail kind` becomes "loads every tile eagerly, because VirtualGrid already limits mounted tiles", with both kinds expecting `'eager'`. On main it fails with `expected 'lazy' to be 'eager'` for the tile without a thumbnail. It encodes the rule that no grid tile depends on the browser's lazy trigger.
2. **Checks.** The narrow vitest files (`ImageCard`, `ImageCard.accessibility`, `GridItem`, `SmartImage`), `pnpm run typecheck`, `pnpm run lint`, then `pnpm run test:run`. No Rust change.
3. **Owner smoke on the test profile** (`com.ambit.p378.test`, PR build). Before the smoke I copy a handful of PNGs of 3–6 MB into `D:\ambit-test\livewatch-drop` and check in SQL that their rows have `privacy_hidden = 0` and `thumbnail_path = ''`. I also check what the gallery's own query shows first. Steps:
    1. Start Ambit test, wait for the gallery, and don't hover the new tiles.
    2. Pass: every tile on screen shows its picture without a hover, including the new ones without thumbnails.
    3. Scroll fast to the bottom and back. Pass: no tile stays empty, and scrolling feels as it did before.
4. **Stated timings.** A no-thumbnail tile on screen shows its picture within about 1 s of being mounted, as fast as the file loads, with no hover. The thumbnail wait itself is not changed by this PR, and the PR body says so with the 2026-11-25 timeline.

## 5. Risks and files

- `src/features/library/components/ImageCard.tsx`: `loading` becomes `'eager'` for every tile; the comment is updated.
- `src/features/library/components/__tests__/ImageCard.test.tsx`: the loading-mode test is updated.
- `VirtualGrid.tsx` and `SmartImage.tsx` are unchanged.

Risks:

- **Memory and I/O on a screen full of large originals.** These rise slightly, as estimated in §2A. The fast-scroll smoke step covers this. Reverting is one line.
- **Root cause not reproduced outside WebView2.** If the smoke still shows a stall, see the contingency in §2.
- Out of scope: #620, facet rebuild speed, the idle-repair ordering follow-up and #599's decision.
