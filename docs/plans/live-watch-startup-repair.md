# Live Watch waits out the startup owner-cache repair

Status: **approved** (option a), implementation in review. Approval conditions, as revised in review: Live Watch stops repairs of the current scope (the startup preparation's repair, idle repairs, and the `catch-up` repair after an InvokeAI catch-up with no owner transition); repairs that build a newly switched user's cache get kind `switch` and are still waited for (tests); the idle repair is scheduled whenever a repair was stopped; each stop writes one Ambit.log WARN line (kind and reason only). Branch `fix/live-watch-startup-repair-wait`.

Goal: Live Watch imports new files within seconds while a startup owner-cache repair runs. The cache still ends committed and correct, and the library counts end up right.

## 1. Cause

Evidence: owner's `Ambit.log` (0.16.2, launch `8d1bb35a`, 2026-11-25 17:24–17:35, lines ~4841–5223). ComfyUI wrote one PNG about every 18 s.

| Time                | Log                                                                              | Meaning                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17:24:17            | `owner-cache attempt 1 selective started`, `facets started`                      | Preparation chose `repairInBackground`; `startBackgroundOwnerCacheRepair()` (kind `'startup'`) claims the cache.                                              |
| 17:24:26 → 17:33:00 | `[LiveWatchPerf] watcher batch emitted` every ~18 s (26 batches)                 | The Rust watcher emitted every file on time.                                                                                                                  |
| 17:26:15            | `library changed during the staged rebuild (generation 107 -> 108)`              | Something wrote during the repair's facet refresh.                                                                                                            |
| 17:26:15            | `full rebuild waited 77585 ms for the facet build lock holder=resource refresh`  | A separate full facet rebuild was requested at 17:24:57 and then held the lock until 17:29:19.                                                                |
| 17:29:19            | `owner-cache attempt 1 ... durationMs 301862 status failed`, `attempt 2 started` | Commit rejected (generation moved); `refreshAfterOwnerScopeChange` retries in full.                                                                           |
| 17:31:16 / 17:33:17 | `facets completed 117260`, `collections completed 120453`                        | Attempt 2: facets ~117 s, smart-collection recount ~120 s.                                                                                                    |
| 17:33:18            | `owner-cache attempt 2 completed 238871`                                         | Repair ends; `[Refresh] Metadata refresh resumed`, `[Backup] ... released` (held 418 s).                                                                      |
| 17:33:24 → 17:33:46 | `[LiveWatch] import failed paths=27 ... reason=db_locked` ×4                     | The 27 queued files start importing; a 33 s `reconcile_invoke_board_snapshot` write hold (17:33:21–17:33:55) costs 4 retries, which absorb it (out of scope). |

Code path (`src/contexts/SyncContext.tsx`):

- `startTargetedLiveSync` (:2896) drain loop, :2928–2929: `abortIdleOwnerCacheRepair(); await waitForBackgroundOwnerCacheRepair();` before every batch.
- `abortIdleOwnerCacheRepair` (:401) aborts only `running?.kind === 'idle'`.
- `waitForBackgroundOwnerCacheRepair` (:394) loops until `backgroundOwnerCacheRepairRef` is empty, so a `'startup'` repair (default kind, :678) is waited out, including its second attempt.
- New watcher paths merge into `pendingTargetedPathsRef` meanwhile (:2909), which is why 27 went in as one batch.

The planner's diagnosis is **confirmed**: Ambit code, not RAM/VRAM. Facet phases of 100–200 s appear on most launches in this log with or without ComfyUI running (e.g. 15:32 launch: facets 171 s, no watcher events at all). The repair ending when ComfyUI stopped was a coincidence.

## 2. Why the startup repair is waited out today

- #431 (0862274f, for #430) introduced the background startup repair and made imports wait for it: an import during the build moves the scope generation through the m69–m85 triggers, so `commit_active_scope_cache_for_session_inner` (`src-tauri/src/db/commands/image_commands.rs:1873`) rejects the commit and the minutes of work are lost. Waiting kept the startup repair's commit safe.
- #543 (c8fa5cac, for #539) added `kind: 'idle'` and `abortIdleOwnerCacheRepair`: an idle repair is cheap to give up because "a write schedules its own" repair (:719–722). The startup kind was left as it was; no issue argues that it must not be aborted.

What breaks if Live Watch simply aborts it:

- The cache stays `dirty` in the database (claim aborted, dirty items kept) until a later repair commits. `ownerCacheRepairFailedRef` goes true, so a later live/Invoke sync will not commit a partial refresh over it (:346, :2592).
- The shown filters and smart-collection counts stay at the last saved snapshot for the items the startup plan held. #539's owner decision already accepts this ("showing the last saved filters and collections ... while the repair runs is acceptable"). New imports still update the gallery and get their own live facet refresh (`queueLiveFacetRefresh`).
- If the import batch handles no path (all failed), today's drain schedules no idle repair (:3053), so nothing would redo the aborted repair this session. The fix must schedule one whenever it aborted a repair.
- Nothing else depends on the startup repair finishing: catch-up only waits for it to settle (`waitForOwnerCacheRepair`, :779), the backup hold and metadata/thumbnail pauses follow `isOwnerCacheRepairing`, which the repair's `hold` releases in `finally`.

## 3. Options

|                                | (a) Abort a running repair for Live Watch (recommended)                                                                                                                                                                                                                        | (b) Import during the repair, follow up small                                                                                                                                                                                                                | (c) Bounded wait, then proceed                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Change                         | Drain aborts any background repair kind, waits only for it to settle, schedules the idle repair at the end. ~15 lines in `SyncContext.tsx`.                                                                                                                                    | Imports skip the wait; on a rejected commit the repair commits what it built and re-plans only items dirtied after its claim. Needs a claim-generation stamp on `invoke_scope_cache_dirty_items`, trigger + migration changes, new commit semantics in Rust. | Wait up to N s (e.g. 10 s), then import anyway (commit then fails, retry redoes it).                      |
| Import latency during a repair | Time for the repair to see the abort: a stopped facet build or one smart-count query, typically < 5 s, worst seen ~20 s (one `collection-counts` query). If an unrelated, unstoppable facet build holds the facet lock, the claim abort waits behind it.                       | ~0 s.                                                                                                                                                                                                                                                        | N s.                                                                                                      |
| How stale, how long            | Startup plan's dirty items show the last snapshot values until the idle repair commits: 30 s after the last Live Watch batch, plus the repair time (~2–5 min on the owner's library). With a file every 18 s, that is the whole ComfyUI session plus ~5 min.                   | Shortest: each follow-up is small. But with a file every 18 s a follow-up still loses its commit unless it finishes between two files.                                                                                                                       | Same as today when the wait expires (the repair keeps running and fails its commit), plus a wasted retry. |
| Dirty across restart           | Yes if the app quits before the idle repair commits; the next start repairs again (already true, see §5).                                                                                                                                                                      | Less often.                                                                                                                                                                                                                                                  | Yes, same as today.                                                                                       |
| Catch-up / startup backup hold | Catch-up's `waitForOwnerCacheRepair` returns sooner, so the folder catch-up imports earlier. Backup hold (`reparse is_paused`) releases when the repair's hold releases, so the backup can run during the session; it re-holds for the idle repair only if it has not run yet. | Repair keeps holding catch-up and backup for its full run.                                                                                                                                                                                                   | Unchanged.                                                                                                |
| Thumbnails held for the repair | Released on abort, so new images get thumbnails promptly; the idle repair waits for healing to go quiet before it starts (:747).                                                                                                                                               | Held for the whole repair; new images show without thumbnails meanwhile.                                                                                                                                                                                     | Held until the repair ends.                                                                               |
| Risk                           | Low; same mechanism as the idle abort, which has tests.                                                                                                                                                                                                                        | High: migration, triggers and commit semantics in the riskiest area (`src-tauri/src/db/`).                                                                                                                                                                   | Low code risk, but does not meet the goal.                                                                |

**Recommendation: (a).** It meets "within seconds", reuses the tested idle-abort path, and the staleness it accepts is the one #539 already accepted. (b) is a real improvement for long sessions but belongs with #468 (commit despite unrelated writes) and #561 (recount only affected collections), not in this fix.

Scope of (a): Live Watch's drain only. Manual imports and the catch-up's own import keep today's behaviour (they abort only idle repairs via the `isImporting` subscription, :772). Applying the same rule to them is a one-line follow-up the planner may choose; I don't propose it here because a catch-up import can overlap the Invoke-sync repair (:2591) in ways this plan has not traced.

## 4. Why attempt 1 failed

- The write that moved generation 107 → 108 landed between 17:24:17 and 17:26:15. **It was not Live Watch**: every Live Watch batch was held (none imported until 17:33:18), and the 15:32 launch shows the same failure (`generation 104 -> 105`, attempt 1 failed after 516 s) with no watcher events at all.
- The frontend's info lines are not in `Ambit.log`, so the writer cannot be named from this log. Candidates not held by `isOwnerCacheRepairing`: the user's own edits (favorite, pin, mask, thumbnail choice: #468), a Smart Thumbnail optimizer batch already in flight when the hold began (`thumb/optimizer.rs:1863` bumps the generation), and whatever requested the separate full facet rebuild at 17:24:57 (callers of `rebuildFacetCache()`: non-deferred imports, duplicate resolution, Invoke sync, live-facet fallback).
- Does (a) stop the wasted attempt? Only when Live Watch is active: the first batch aborts the repair, so it never reaches a failed commit and a retry. With Live Watch idle, a stray writer still costs attempt 1. That is #468's problem; I will add this log as evidence there, and add a note that the writer should be logged (generation bump source) so the next log names it.

## 5. Startup repair on nearly every launch

Yes. All 8 launches in this log (2026-11-24 17:11 → 2026-11-25 17:24) start with `owner-cache attempt 1 selective` within 1–7 s. Idle repairs did commit in some sessions (e.g. 11-24 17:50:21, 20:44:02; 11-25 11:06:48, 16:08:30), but later writes dirtied the cache again before quit and nothing repaired it. The cause is #541: only imports schedule the idle repair; deletes, metadata and collection edits (and thumbnail writes) do not. This fix does not need it. I will comment the evidence on #541 rather than file a duplicate.

## 6. Acceptance criteria

Automated (`src/contexts/__tests__/LibraryIntegration.test.tsx`, next to "stops an idle repair for a new import instead of making it wait"):

1. **Fails on today's code:** with a startup repair holding its claim (gate unresolved), `startTargetedLiveSync(['C:/watch/during-startup-repair.png'])` calls `processTargetedFiles` without the gate being released by the test; the repair's claim is aborted (`abortActiveInvokeScopeCacheBuild` with its ticket) and never committed. On today's code `processTargetedFiles` is not called until the gate resolves.
2. **Cache consistent after the fix:** after the import, advancing 30 s of quiet starts an idle repair that claims and commits (`commitActiveInvokeScopeCache` called once with the new claim's generation); `isOwnerCacheRepairing` ends false.
3. **Aborted repair is redone even when the import handles nothing:** same as 1 with `processTargetedFiles` reporting the path failed; an idle repair is still scheduled.
4. Existing idle-abort, switch-abort and catch-up tests pass unchanged.

Timings (stated, checked in the smoke log, not asked of the owner):

- A Live Watch file written during a startup repair starts importing within 30 s of its watcher batch (expected < 5 s); today: up to the repair's full length (9 min observed).
- The startup journal shows the startup `owner-cache` record ending `cancelled`, then an idle repair `completed` ~30 s after the last file plus 2–5 min.

Owner smoke (test profile `com.ambit.p378.test`, about 5 minutes, I do the prep):

- Prep (me): build the test exe at the PR head; in the test profile copy, mark the owner cache dirty by touching one image row so the launch runs a multi-minute selective repair; add a dedicated drop folder (e.g. `D:\ambit-test\livewatch-drop`) as a monitored folder with Live Watch on; put a double-click `Drop test images.cmd` on the Desktop that copies one sample PNG into that folder every 15 s, 12 times.
- Owner: 1) double-click "Ambit test"; 2) as soon as the gallery shows, double-click "Drop test images"; 3) watch the gallery for 3 minutes. Pass = new images keep appearing one by one, not in one burst at the end. Tell me anything that looked stuck or wrong. (ComfyUI generating into a watched folder works as an alternative to step 2.)
- Then I read the test profile's `Ambit.log`: repair `cancelled`, each batch imported in seconds, idle repair `completed` afterwards.

## 7. Risks and files

Files:

- `src/contexts/SyncContext.tsx`: drain in `startTargetedLiveSync`; a small helper (or a kind-agnostic variant of `abortIdleOwnerCacheRepair`) used only there; schedule the idle repair after an abort. Update the comments at :334–337 and :399–400.
- `src/contexts/__tests__/LibraryIntegration.test.tsx`: tests 1–3.
- `docs/architecture.md` only if it describes the startup-repair wait (will check).

Risks:

- **Stale counts for a whole generation session** (by design, see §3). Mitigation later: #561, #468.
- **Abort latency behind an unrelated facet build**: the claim abort takes the facet build lock; if a non-stoppable build (e.g. a live facet refresh, ~100 s on the owner's library) holds it, the first batch waits for it once. Bounded and one-off per session; noted in the PR.
- **Catch-up overlap**: the folder catch-up now starts its import sooner and its `repairOwnerCacheAfterImport` (foreground, not abortable by Live Watch) can lose its commits to Live Watch writes. This already happens whenever catch-up and Live Watch overlap; not changed here, noted as follow-up if seen.
- **Repairs of other origins share kind `'startup'`** (switch catch-up repair :1674/:1787, Invoke-sync repair :2591). Aborting them leaves `ownerCacheRepairFailedRef` true, so later syncs take the full-plan path and the idle repair redoes it. Resolved in review: a stopped startup repair leaves `ownerCacheRepairFailedRef` true, so the startup Invoke catch-up's repair redoes the whole startup plan and would hold Live Watch for minutes again. That repair (kind `catch-up`) is stoppable when the sync has no owner transition; with an `ownerTransitionToken`, and for the switch paths' deferred repairs, it is kind `switch` and waited for. Tests cover both, and the drain re-checks stoppability for a repair that starts while it waits. Worst case behind a `switch` repair is that repair's full length, as before. Test 1 holds the repair in its facet build rather than at its claim, because a claim still pending cannot be stopped.
- Out of scope, noted only: the 33 s `reconcile_invoke_board_snapshot` write hold; facet rebuild speed.
