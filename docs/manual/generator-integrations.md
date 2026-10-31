# Generator Integrations

[Back to manual index](index.md)

Generator integrations help Ambit understand common local AI image workspaces. They add generator output locations to Ambit's local catalog flow, but they do not move, delete, or upload your source images.

Use generator integrations when you want Ambit to keep tracking images from a known tool. Use [Adding Folders](adding-folders.md) for ordinary monitored folders or one-time imports.

## Choosing An Import Path

Ambit supports three local import paths:

- One-Time Import: best for downloaded packs, screenshots, archives, loose files, or folders you do not want to keep monitoring.
- Monitored Image Folders: best for normal image directories that should be rescanned later.
- Generator Integrations: best for InvokeAI, ComfyUI, SD WebUI, A1111, Forge, SD.Next, Anapnoe, or existing generator archive layouts.

All three paths catalog supported image files in Ambit's local SQLite library. The original files remain where they are.

## InvokeAI

A changed owner view can require checking the complete source inventory before the gallery opens, even when only a few images are new. File validation uses a bounded worker pool; ownership verification still completes before admission, and every scan checks the filesystem afresh. A previously verified, unchanged view can reuse its preparation evidence.

Open Settings > Connections > InvokeAI.

Select the InvokeAI root installation folder that contains `databases/invokeai.db`. Browse checks the selected folder and discovers its owners automatically. If you type a path, use Test Connection after finishing it. Checking a folder does not save the connection or import images.

On the same page, select an owner, review Import options, then click **Connect & Import**. Owner cards and options are a draft: changing them does not affect the active library or start synchronization. Drafts stay available when navigating between Settings tabs; closing Settings discards unapplied changes. Use **Discard changes** to return to the applied configuration without closing Settings.

For an existing connection, choose another owner and click **Switch view** to apply the choice and catch up that owner's images when needed. For the current owner, **Sync now** applies any edited options and checks for updates. Selecting a different database uses **Connect & Import** again. Choosing All users requires confirmation when applying the choice, rather than when selecting its card. Startup catch-up and Live Watch continue using the last applied configuration while edits remain pending.

After validating the source and owner, **Connect & Import** and **Switch view** close Settings. Validation failures stay in Settings for correction. **Sync now** keeps Settings open; you can close it and continue browsing once the current view is ready.

Enabling intermediates scans historical rows that the selected owner previously excluded. Favorite and board mapping options use the existing synchronization rules as images are processed, preserving local overrides; changing a mapping does not request a bulk remap of every previously imported image.

If the InvokeAI database contains exactly one represented owner and no unassigned images or boards, Ambit preselects that owner and shows a summary instead of a redundant All users choice; first import still waits for Connect & Import. If the database contains multiple owners or unassigned images or boards, choose one owner or explicitly choose All users. InvokeAI's reserved `System` owner normally contains pre-account or system-created rows and behaves like any other single owner in Ambit; it is not the aggregate view. `All users` is the explicit aggregate view. A single-owner scope limits images, favorites, directly owned boards, board collections, startup catch-up, and Live Watch to that owner. An owned board remains listed with a zero visible count when all of its members belong to other owners; those member images and thumbnails remain hidden. Other and unassigned records stay stored locally and reappear when their owner or All users is selected; changing scope does not delete them.

Ambit collections follow the view in which they are created. A collection created for Jupiter appears in Jupiter and in `All users`, but not for another owner. A collection created in `All users` is aggregate-only. The collection editor can move an Ambit collection between `All users` and a specific owner when all of its InvokeAI images belong to that target; InvokeAI boards keep their authoritative InvokeAI owner and cannot be reassigned in Ambit. Older collections whose ownership cannot be inferred safely remain marked as shared legacy collections until reassigned.

An InvokeAI board collection is **Linked to InvokeAI** and retains its source account owner. InvokeAI supplies the source name and membership; Ambit preserves your local organization and never writes changes back to InvokeAI. Renaming a collection in Ambit protects that name until you explicitly reset it, even if InvokeAI later adopts the same name and changes it again. Local additions, removals, and moves are preserved while other source updates continue through manual sync, startup sync, Live Watch, and Force Full Resync. If a board disappears from an authoritative source snapshot, Ambit retains the collection as `Source unavailable`. Reconnecting the same board identity resumes reconciliation without discarding local overrides.

To reset one linked collection, right-click it in the Collections sidebar, choose **Edit Collection**, then find **Quick Actions → Reset to InvokeAI**. This discards that collection's local name and membership overrides and restores its **last synchronized** source name and membership. A confirmation explains this before any changes are made. Reset preserves colour, pin, archive, hidden status, and custom thumbnail, and is unavailable while the source board is unavailable. Deleting a linked collection hides it locally without deleting its source or override history; restore hidden collections from Settings > Connections > InvokeAI under `Hidden InvokeAI collections`, scoped to the active owner.

Ambit treats the selected owner as a visibility boundary, not as an InvokeAI permission role. An InvokeAI administrator therefore receives the same owner-only Ambit view as a regular account; choose `All users` when an aggregate library is desired. Ambit reads display names and stable owner IDs but does not read administrator flags, email addresses, or passwords and does not sign in to InvokeAI. Owner cards separate standard-image and intermediate-row counts when intermediates exist instead of presenting their sum as the expected Ambit library size.

Ambit keeps a separate sync cursor, InvokeAI database fingerprint, facet cache, and collection-summary cache for each prepared scope. Returning to a current owner activates an indexed logical view and restores those derived caches instead of rewriting every image row or rebuilding the library. If only known resources or collection summaries changed, Ambit repairs those entries instead of rebuilding every facet. A full rebuild is reserved for the first visit to an uncached owner or a change whose impact cannot be identified safely. Changes that belong only to another owner do not invalidate an unrelated prepared owner. Board ownership and the complete board catalog are refreshed independently of new-image sync, so empty as well as populated InvokeAI boards remain available even when their schema marker is already current. Once the prepared view is safe, the gallery opens while synchronization continues. Newly cataloged images appear without a manual page refresh.

After an update that changes InvokeAI ownership data, Ambit may show `Preparing your InvokeAI view` after local database preparation. Brief owner and privacy-protection checks remain behind the normal startup splash. An accepted **Connect & Import**, **Switch view**, or **Open view** shows required preparation immediately, without briefly exposing the previous gallery. **Preparing view** names the target owner and reports elapsed time. Library images, counts, boards, filters, statistics, and privacy indexing wait until the configured InvokeAI view is safe to use. The status moves through file indexing, image-location mapping, legacy-location checks when needed, image details, visibility, and library cache refresh. Bounded work shows a count and progress bar; other phases show activity without inventing a percentage. Explicit preparation has a **Cancel** control; if Settings remains open during Sync now, **Cancel sync** is available there too.

When preparation completes, Ambit opens the gallery and shows synchronization for the selected owner in the Activity Dock. You can browse while it runs. **Processing images** counts rows being checked, including existing records; separate added and updated counts appear when available. A first import may open an empty gallery that fills as batches are saved. Changed batches refresh the gallery at most once per second; batches that only recheck existing records do not request another refresh. After image processing, the dock names board, filter-cache, and collection work without displaying an image percentage for those stages. When board collection syncing is enabled, a temporarily empty Collections section says that InvokeAI collections are being prepared instead of presenting the library as new. Unchanged restarts use the saved scope and skip the broad reconciliation pass.

**Checking image locations…** verifies existing catalog references, including older images before the current sync cursor. It does not mean files are broken. **Updating image references…** appears only when confirmed corrections are being applied; the Dock reports the actual number of corrected paths separately from newly added images. These checks update Ambit's catalog and do not move source files. A database fingerprint alone cannot prove that image files have stayed in the same location.

Startup, including an F5 refresh, still verifies the applied connection and checks for updates. Automatic background progress appears only if it lasts more than 2.5 seconds, measured from background synchronization rather than from the startup splash or privacy checks. Quick unchanged checks finish silently; quick checks that change images or collections show a brief result. A longer check that has already shown progress can finish with **Already up to date**. Zero added or updated images do not rule out collection changes. Explicit Connect & Import, Switch view, Open view, Sync now, and Retry provide immediate feedback. Successful InvokeAI results disappear after five seconds of visible display, including manual synchronization. Hovering or focusing the Dock pauses dismissal, as do a hidden app document, a minimized Dock, or higher-priority activity. Synchronization success is summarized in the Dock without a second success toast. Live Watch keeps its existing presentation.

When Privacy Mode is enabled, **Preparing privacy protection** is a separate cover over the gallery. Startup and an owner change verify the masking rules before displaying the new view; unchanged rules reuse the saved privacy index. Synchronization can continue while this cover is visible. It disappears when privacy verification finishes, independently of import completion.

When Privacy Mode is enabled, **Preparing privacy protection** is a separate cover over the gallery. Startup and an owner change verify the masking rules before displaying the new view; unchanged rules reuse the saved privacy index. Synchronization can continue while this cover is visible. It disappears when privacy verification finishes, independently of import completion.

InvokeAI synchronization can:

- import images from the InvokeAI database into Ambit's library
- map InvokeAI starred images to Favorites, Pins, Both, or None
- sync InvokeAI boards as linked Ambit collections, preserving local edits
- import intermediate generation steps when Import Intermediates is enabled
- run Orphan Recovery during a manual full output-folder recovery sweep

**Sync boards as collections** is the single board option. Enable it to keep board names and membership in sync while preserving local overrides, then use the primary action to apply the draft. Turning it off keeps saved collections, their membership, and your edits usable; source-content updates pause. Ambit still checks ownership when needed before showing a selected owner's collections. Turning it back on catches up boards at the existing image cursor and does not request a historical image re-import. Reading board mappings can be necessary even when no images change; the dock's added/updated totals count images, not boards.

On upgrade, the previous **Sync Boards** choice determines whether this is enabled: an explicit off stays off, otherwise it is enabled. The former **Persistent Collections** child no longer hides boards or controls synchronization. Existing custom names with known differences or unknown source names are protected. Ambit cannot reconstruct names or rename intent already lost before this upgrade.

Older InvokeAI collections with unknown source provenance stay hidden in single-owner views until an authoritative board sync identifies them. They remain available in All users or legacy views for recovery. Choosing another database while board sync is off does not attach those collections to that database.

Orphan Recovery is unavailable while one owner is selected because loose output files do not carry reliable ownership. Ambit preserves the checkbox preference and restores it automatically in All users or legacy mode. Shared/public InvokeAI boards are not included in single-owner board sync.

InvokeAI can also store user uploads, control images, masks, and other source assets. Asset category and intermediate status are separate InvokeAI properties: disabling Import Intermediates still permits non-intermediate assets to be imported. Ambit imports these records so they remain recoverable, but hides known image assets from ordinary library results by default. Use the library View menu's `Show InvokeAI Image Assets` control to reveal them. Revealed assets show top-centered `Asset · …` badges, and their viewer begins with the recorded InvokeAI source and reference relationships when available. For normal generations, Source appears near the bottom so prompt and generation data remain primary. Unknown or missing categories remain visible.

If a parser update requires existing files to be re-read, the separate `Updating Metadata` activity begins after startup catch-up yields. It reports the affected image count and runs while the library remains usable; it is not another InvokeAI import.

When InvokeAI generation metadata identifies input images, the viewer also shows forward `Source Images` links and reverse `Used By` links. Available links open in place even when the referenced asset is hidden from ordinary results; this does not enable asset visibility or alter the active search or collection. Unresolved source names and backlinks from Removed images are retained as disabled provenance entries.

Use **Cancel** in preparation or the Activity Dock, or **Cancel sync** in Settings. **Cancelling…** remains visible until work already underway finishes safely. Before the prepared gallery opens, cancellation or failure restores the previous configuration and verified view. If this was the first connection, Ambit keeps the submitted configuration available for retry and hides unverified InvokeAI content. A settled cancellation shows **InvokeAI preparation cancelled**, with **Retry** and **Open Settings**; a genuine preparation or recovery failure still shows an error. After the gallery opens, cancellation or an ordinary synchronization failure keeps the selected view and records already written. If owner visibility can no longer be verified, Ambit returns to guarded recovery. Existing images, collections, and source files are kept.

Cancelled or failed synchronization has a **Retry** action. When preparation restores the previous view, Retry attempts the cancelled or failed target owner and database again with the options you submitted. Once the selected gallery has opened, Retry uses the applied configuration and its reviewed options. Retry preserves written records but resumes from the last fully completed checkpoint, so its processing count may start over. If processing an image fails, Ambit reports that image and keeps the previous checkpoint so the row remains eligible for retry. A first import cancelled before its first completed checkpoint can also repeat preparation; this is not evidence that existing images were deleted or added again. Failed and cancelled Activity Dock results stay available until dismissed or replaced by another operation. Cancelling also drops queued automatic reruns from that operation, so it does not restart immediately; later Live Watch events and normal startup catch-up continue to work.

Applying a connection or owner change reserves synchronization through preparation, import, and any cancellation or recovery work, so one run cannot mix records from different scopes. While edits are pending, Force Full Resync and hidden-collection restoration are disabled: these recovery actions always target the applied connection. The startup owner-selection screen also waits for **Open view** before synchronizing with the saved options; an already configured owner does not require renewed setup.

Force Full Resync clears only the InvokeAI sync cursor. The next manual sync scans the full InvokeAI database again, while existing Ambit records, source files, local collection overrides, hidden collection state, and InvokeAI snapshots stay untouched.

When Live Watch is enabled, Ambit watches InvokeAI database activity and runs live sync work after changes are detected. If new images do not appear immediately, wait for the generator to finish writing records, then run a manual sync if needed.

## ComfyUI

Open Settings > Connections > ComfyUI.

Select the `output` folder where ComfyUI saves generated images, then use Link Output Folder. Ambit adds that folder as an active monitored image folder tagged for ComfyUI output. If the folder is already monitored, Ambit reports that instead of adding a duplicate.

After linking, scans and rescans behave like other monitored folders and also admit supported video files. Live Watch tracks media and matching video workflow-sidecar changes. InvokeAI database synchronization remains an image integration.

## SD WebUI, A1111, Forge, SD.Next, And Anapnoe

Open Settings > Connections > SD WebUI.

Select an Installation or Archive Path. This can be a normal installation root that contains `webui.py` or an archive folder with generator outputs.

Choose the Installation Type:

- Auto-Detect (Recommended)
- SD WebUI (Generic / A1111)
- Stable Diffusion Forge
- SD.Next (Vladmandic)
- Anapnoe WebUI

Use Scan for Folders, or Scan as the selected variant when Auto-Detect is not selected. Review Discovery Results before importing. Ambit shows standard output folders first, and Show non-standard folders reveals additional candidates when available.

For each discovered folder, review:

- Link: whether the folder is selected for import or sync
- Folder Name / Path: the detected folder and whether it is already linked
- Type: txt2img, img2img, Extras, Grids, Saved, or Unknown
- Images: the image count Ambit found in that folder

Use Link & Import to add selected new folders and import them. If selected folders are already linked, Ambit uses Link/Sync for those folders instead.

If Auto-Detect reports a generic WebUI or tags images incorrectly, select the exact Installation Type and scan again.

## During Imports And Cancels

Generator imports can be cancelled. Imported images are kept. Completed folders are marked scanned, while cancelled, failed, or unfinished folders remain retryable.

Ambit does not delete source files when an import, sync, or rescan is cancelled.

## Troubleshooting

For a controlled development investigation, launch a disposable profile with `VITE_INVOKE_SYNC_TRACE=1`. This opt-in trace is disabled in production. The profile's `APPLOCALDATA/invoke-sync-trace` folder keeps bounded active and last-completed captures of progress, pending stages, renderer heartbeat and gallery readiness. It excludes paths, owner/image names and metadata and never uploads data. Preserve the last-completed file before another run replaces it. A long-running stage alone does not establish a frozen Dock; compare displayed progress with later coordinator events and document visibility. Normal synchronization never times out or restarts because of this diagnostic.

If InvokeAI connection testing fails, confirm that the selected root contains `databases/invokeai.db` and that Ambit can read the folder.

If SD WebUI discovery finds no folders, confirm the selected path, try the exact Installation Type instead of Auto-Detect, and enable Show non-standard folders after scanning if candidates are hidden.

If ComfyUI images do not appear, confirm that you selected the actual ComfyUI `output` folder, then check Settings > Connections > Folders to make sure it is monitored and active.

If Live Watch does not import a newly generated image, wait for generation to finish and use a manual sync or folder rescan. Live Watch responds to file or database activity, but manual actions are still the clearest recovery path when a generator writes late or incomplete records.
