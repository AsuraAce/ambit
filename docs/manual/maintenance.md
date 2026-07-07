# Maintenance

[Back to manual index](index.md)

Maintenance helps keep Ambit's catalog aligned with your local files and metadata. Open Maintenance from the left sidebar.

## Maintenance Areas

Ambit currently exposes these maintenance tabs:

- Missing: find catalog records whose source files are missing.
- Thumbnails: regenerate unoptimized thumbnails, repair broken thumbnail references, and clean up unused thumbnails.
- Duplicates: find and resolve duplicate candidates.
- Untagged: review records with missing or incomplete metadata.
- Intermediates: review images flagged as intermediates when the tab is visible.
- Removed: restore removed records or permanently delete files when that action is chosen.

```mermaid
flowchart TD
    A["Maintenance"] --> B["Duplicates"]
    A --> C["Thumbnails"]
    A --> D["Untagged"]
    A --> E["Intermediates"]
    A --> F["Missing"]
    A --> G["Removed"]
    C --> H["Regenerate or repair"]
    F --> I["Verify library paths"]
    G --> J["Restore or delete"]
```

## Duplicates

The Duplicates tab scans for likely duplicate images. Duplicate cleanup is conservative: resolving duplicates removes redundant records from Ambit's library or Removed flow by default rather than deleting original files automatically.

Use Compare when available to inspect candidates before resolving them.

## Thumbnails

The Thumbnails tab finds images that could benefit from thumbnail regeneration. It can work across the whole library or the current filtered view.

Use it to:

- regenerate selected thumbnails
- regenerate all unoptimized thumbnails in the chosen scope
- include upgradeable thumbnails when you want higher-quality replacements
- repair broken thumbnail references
- clean up unused thumbnail files when the current scope is optimized

Ambit can also heal thumbnails in the background during normal use, so this tab is the manual repair and review surface rather than the only thumbnail path.

## Missing

The Missing tab helps when files were moved, renamed, deleted outside Ambit, or live on a disconnected drive.

Use the library health scan to check file availability. For missing records you can remove the record from Ambit's library. This cleans the catalog entry; it does not recover a file that no longer exists on disk.

## Removed

Removed contains images that were removed from the active library. You can restore selected records or choose a delete action when you intentionally want to delete files.

Treat destructive delete actions carefully. Ambit separates library removal from file deletion so cleanup does not have to destroy source images.

## Untagged And Intermediates

Untagged helps find images without useful parsed metadata. Intermediates appears when Ambit has images flagged as intermediate outputs, such as images without the expected InvokeAI metadata.

Use these tabs to remove, review, or unmark records depending on what the tab offers.

## Thumbnail Problems

Ambit performs thumbnail handling in the background. If thumbnails are stale or broken, start with Maintenance, Thumbnails:

- Repair Broken Thumbnails checks thumbnail files on disk and resets missing thumbnail references.
- Regenerate Selected rebuilds thumbnails for selected records.
- Regenerate All Unoptimized repairs the chosen scope in batches.

Settings, Advanced, Support includes an Open Maintenance shortcut for these repair tools.

## Metadata Refresh

From Settings > Connections > Folders, use Refresh All Metadata or a folder-level refresh when metadata filters look stale after external changes.

## Next Step

For settings and network behavior, continue with [Settings And Privacy](settings-and-privacy.md).
