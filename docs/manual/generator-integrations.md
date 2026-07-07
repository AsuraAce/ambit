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

InvokeAI synchronization can:

- import images from the InvokeAI database into Ambit's library
- map InvokeAI starred images to Favorites, Pins, Both, or None
- sync InvokeAI boards, optionally as persistent Ambit collections
- import intermediate generation steps when Import Intermediates is enabled
- run Orphan Recovery during a manual full output-folder recovery sweep

Use Initiate Sync to start a manual sync. If a sync fails, Retry Sync starts it again; while a sync is active, Terminate Sync cancels it.

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
