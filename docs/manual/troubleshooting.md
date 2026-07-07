# Troubleshooting

[Back to manual index](index.md)

This page lists common first-run and library issues. When in doubt, prefer actions that rescan or refresh Ambit's catalog before actions that remove records or delete files.

## I Installed Ambit But Do Not See Images

Confirm that you added image sources:

- use Add Images, then Add Folder for a normal folder
- use Settings > Connections > Folders for monitored folders
- use Settings > Connections > ComfyUI for a ComfyUI output folder
- use Settings > Connections > SD WebUI for A1111, Forge, SD.Next, Anapnoe, or archive folders
- use Settings > Connections > InvokeAI for an InvokeAI root containing `databases/invokeai.db`

Large folders can take time to scan. Wait for import activity to finish before assuming the scan failed.

For the full generator setup workflow, see [Generator Integrations](generator-integrations.md).

## A Folder Did Not Scan Correctly

Try these steps:

1. Confirm the folder path still exists and is accessible.
2. Rescan the folder from Settings > Connections > Folders.
3. Use Refresh All Metadata if the files exist but filters or parsed metadata look stale.
4. For SD WebUI folders, scan again with the correct installation type selected instead of Auto if detection looked wrong.

## Metadata Is Missing Or Wrong

Metadata depends on what the generator embedded in the file. Some images do not contain complete generation data.

Useful checks:

- open the image viewer and inspect Info and Workflow tabs
- check whether the image came from a supported generator output
- refresh metadata for the folder
- use Untagged maintenance to find records that need review
- use Online Model Hash Resolution only when you intentionally want CivitAI lookup for unresolved model hashes

## Thumbnails Are Broken

Open Maintenance > Thumbnails.

Use Repair Broken Thumbnails first. If thumbnails still fail, regenerate selected thumbnails or run Regenerate All Unoptimized for the current scope. Settings > Advanced > Support also has an Open Maintenance shortcut.

For the full repair workflow, see [Maintenance](maintenance.md#thumbnails).

## Images Show As Missing

Missing usually means Ambit has a catalog record but the source file path is not currently available.

Check whether:

- the folder or drive is connected
- the file was moved or renamed outside Ambit
- the monitored folder path changed

If the file is intentionally gone, use Maintenance > Missing to run File Link Audit or Re-Scan Files, then remove the missing record from Ambit's library. This cleans the catalog entry but does not restore the deleted file.

## Search Does Not Find What I Expected

Remember that plain search text matches the positive prompt by default.

Try:

- `neg:term` for negative prompts
- `file:term` for filename or path
- `model:name` for model filters
- `lora:name` for LoRA filters
- Reset All to clear hidden filter state
- Help, Search Syntax for the full operator list

## Gemini Features Do Not Work

Confirm that:

- Intelligence features are enabled
- your Gemini API key is saved
- key verification succeeds
- you are running an explicit AI action
- your network allows the request

Gemini is not required for core Ambit browsing, search, metadata parsing, or maintenance.

## Online Model Resolution Is Disabled Or Busy

Resolve Online is blocked while library work is already running, such as import, sync, scan, thumbnail optimization, duplicate scan, or background healing. Wait for the current task to finish, then run resolution again.

Online model resolution sends unresolved model hash strings to CivitAI. It does not send image files.

## I Want To Start Over

Open Settings > Advanced > Database and use Purge Database only if you intentionally want to reset Ambit's catalog and linked folders. Read the confirmation carefully. Source image files are not touched, but imported metadata and application state are reset.

## Reporting Issues

Report bugs through GitHub Issues. For suspected security problems, do not open a public issue; follow the [Security Policy](../../SECURITY.md).
