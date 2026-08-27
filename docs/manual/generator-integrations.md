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

Open Settings > Connections > InvokeAI.

Select the InvokeAI root installation folder that contains `databases/invokeai.db`, then use Test Connection. After a connection is configured, the Synchronization section appears.

If the InvokeAI database contains exactly one represented owner and no unassigned images or boards, Ambit selects that owner automatically and shows a summary instead of a redundant All users choice. If the database contains multiple owners or unassigned images or boards, choose one owner or explicitly choose All users. InvokeAI's reserved `System` owner normally contains pre-account or system-created rows and behaves like any other single owner in Ambit; it is not the aggregate view. `All users` is the explicit aggregate view. A single-owner scope limits images, favorites, directly owned boards, board collections, startup catch-up, and Live Watch to that owner. An owned board remains listed with a zero visible count when all of its members belong to other owners; those member images and thumbnails remain hidden. Other and unassigned records stay stored locally and reappear when their owner or All users is selected; changing scope does not delete them.

Ambit collections follow the view in which they are created. A collection created for Jupiter appears in Jupiter and in `All users`, but not for another owner. A collection created in `All users` is aggregate-only. The collection editor can move an Ambit collection between `All users` and a specific owner when all of its InvokeAI images belong to that target; InvokeAI boards keep their authoritative InvokeAI owner and cannot be reassigned in Ambit. Older collections whose ownership cannot be inferred safely remain marked as shared legacy collections until reassigned.

Ambit treats the selected owner as a visibility boundary, not as an InvokeAI permission role. An InvokeAI administrator therefore receives the same owner-only Ambit view as a regular account; choose `All users` when an aggregate library is desired. Ambit reads display names and stable owner IDs but does not read administrator flags, email addresses, or passwords and does not sign in to InvokeAI. Owner cards separate standard-image and intermediate-row counts when intermediates exist instead of presenting their sum as the expected Ambit library size.

Ambit keeps a separate sync cursor, InvokeAI database fingerprint, facet cache, and collection-summary cache for each prepared scope. Returning to a current owner activates an indexed logical view and restores those derived caches instead of rewriting every image row or rebuilding the library. If only known resources or collection summaries changed, Ambit repairs those entries instead of rebuilding every facet. A full rebuild is reserved for the first visit to an uncached owner or a change whose impact cannot be identified safely. Changes that belong only to another owner do not invalidate an unrelated prepared owner. If preparation fails, Ambit restores the previously coherent scope. Board ownership and the complete board catalog are refreshed independently of new-image sync, so empty as well as populated InvokeAI boards remain available even when their schema marker is already current. A completed owner catch-up invalidates the gallery query before admitting the new scope, so newly imported images load without a manual page refresh.

After an update that changes InvokeAI ownership data, Ambit may show `Preparing your InvokeAI view` after local database preparation. Brief owner and privacy-protection checks remain behind the normal startup splash. During an in-app owner change, Ambit keeps the previous view visible but non-interactive for a short grace period; a sustained change then uses the same dedicated preparation surface, names the target owner, and reports elapsed time. Library images, counts, boards, filters, statistics, and privacy indexing wait until the configured InvokeAI view is safe to use. The status moves through file indexing, image-location mapping, legacy-location checks when needed, image details, visibility, and library cache refresh. Bounded work shows a count and progress bar; other phases show activity without inventing a percentage. No images or collections are deleted. Once the view is ready, Ambit opens the library. If the InvokeAI database has changed, the next job is identified as `InvokeAI Catch-up` and a notice explains that images and boards are catching up in the background; if the saved snapshot is already current, the notice simply confirms that the view is ready. When board collection syncing is enabled, a temporarily empty Collections section says that InvokeAI collections are being prepared instead of presenting the library as new. Unchanged restarts use the saved scope and skip the broad reconciliation pass.

InvokeAI synchronization can:

- import images from the InvokeAI database into Ambit's library
- map InvokeAI starred images to Favorites, Pins, Both, or None
- sync InvokeAI boards, optionally as persistent Ambit collections
- import intermediate generation steps when Import Intermediates is enabled
- run Orphan Recovery during a manual full output-folder recovery sweep

Orphan Recovery is unavailable while one owner is selected because loose output files do not carry reliable ownership. Ambit preserves the checkbox preference and restores it automatically in All users or legacy mode. Shared/public InvokeAI boards are not included in single-owner board sync.

InvokeAI can also store user uploads, control images, masks, and other source assets. Asset category and intermediate status are separate InvokeAI properties: disabling Import Intermediates still permits non-intermediate assets to be imported. Ambit imports these records so they remain recoverable, but hides known image assets from ordinary library results by default. Use the library View menu's `Show InvokeAI Image Assets` control to reveal them. Revealed assets show top-centered `Asset · …` badges, and their viewer begins with the recorded InvokeAI source and reference relationships when available. For normal generations, Source appears near the bottom so prompt and generation data remain primary. Unknown or missing categories remain visible.

If a parser update requires existing files to be re-read, the separate `Updating Metadata` activity begins after startup catch-up yields. It reports the affected image count and runs while the library remains usable; it is not another InvokeAI import.

When InvokeAI generation metadata identifies input images, the viewer also shows forward `Source Images` links and reverse `Used By` links. Available links open in place even when the referenced asset is hidden from ordinary results; this does not enable asset visibility or alter the active search or collection. Unresolved source names and backlinks from Removed images are retained as disabled provenance entries.

Use Initiate Sync to start a manual sync. If a sync fails, Retry Sync starts it again; while a sync is active, Terminate Sync cancels it.

The InvokeAI path and owner choice are locked for the duration of manual, startup, and Live Watch synchronization so one run cannot mix records from different scopes.

Force Full Resync clears only the InvokeAI sync cursor. The next manual sync scans the full InvokeAI database again, while existing Ambit records, source files, and InvokeAI snapshots stay untouched.

When Live Watch is enabled, Ambit watches InvokeAI database activity and runs live sync work after changes are detected. If new images do not appear immediately, wait for the generator to finish writing records, then run a manual sync if needed.

## ComfyUI

Open Settings > Connections > ComfyUI.

Select the `output` folder where ComfyUI saves generated images, then use Link Output Folder. Ambit adds that folder as an active monitored image folder tagged for ComfyUI output. If the folder is already monitored, Ambit reports that instead of adding a duplicate.

After linking, scans and rescans behave like other monitored image folders.

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

If InvokeAI connection testing fails, confirm that the selected root contains `databases/invokeai.db` and that Ambit can read the folder.

If SD WebUI discovery finds no folders, confirm the selected path, try the exact Installation Type instead of Auto-Detect, and enable Show non-standard folders after scanning if candidates are hidden.

If ComfyUI images do not appear, confirm that you selected the actual ComfyUI `output` folder, then check Settings > Connections > Folders to make sure it is monitored and active.

If Live Watch does not import a newly generated image, wait for generation to finish and use a manual sync or folder rescan. Live Watch responds to file or database activity, but manual actions are still the clearest recovery path when a generator writes late or incomplete records.
