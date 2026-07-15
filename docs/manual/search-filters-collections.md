# Search, Filters, And Collections

[Back to manual index](index.md)

Ambit combines search text, metadata filters, asset facets, date ranges, favorites, pins, and collections to narrow large local libraries. Most filters combine with AND, so each extra filter tightens the result set. Some asset sections also let you choose whether selected assets should match any selected item or every selected item.

## Search Bar

The search bar matches the positive prompt by default. Type plain words to find prompt text; Ambit updates after typing pauses, and pressing Enter applies the current search immediately.

Search bar tools include:

- quoted phrases for exact multi-word prompt fragments
- `OR` between prompt terms when either term can match
- `-term` or `!term` to exclude a positive-prompt term
- operator suggestions while typing
- recent searches when the field is focused and empty
- Clear search to remove the current search text
- Clear in Recent Searches to remove the recent-search list
- an ISO-date readiness hint when a date operator is incomplete or invalid

When AI Search is enabled from the search bar, the placeholder changes to an assistant-style prompt. Network and AI behavior depends on your settings; see [Settings And Privacy](settings-and-privacy.md).

Examples:

```text
sunset portrait
"dark forest"
forest OR ocean
dragon -blurry
model:sdxl lora:detail
date:2026-04 after:2026-03
steps:>30 cfg:<7 w:>1024
```

Open Help, then Search Syntax, for the in-app operator list.

## Search Syntax

Plain terms search positive prompts. Multiple plain terms narrow results. `OR` only groups adjacent positive-prompt terms, such as `forest OR ocean`; resource, date, numeric, and other operator filters still combine with the rest of the query.

Supported operators include:

- `-term` or `!term` excludes a positive-prompt term.
- `neg:blur` or `negative:blur` searches the negative prompt.
- `file:portrait`, `filename:portrait`, or `path:portrait` searches the file path.
- `all:anime` searches path and raw metadata.
- `model:sdxl` filters by model.
- `lora:detail` filters by LoRA.
- `cn:pose` or `controlnet:pose` filters by ControlNet.
- `ip:adapter` or `ipadapter:adapter` filters by IP-Adapter.
- `tool:invoke` filters by generator.
- `sampler:euler` filters by sampler.
- `steps:>30`, `steps:<20`, or `steps:30` filters generation steps.
- `cfg:<7`, `cfg:>4`, or `cfg:6` filters CFG.
- `seed:12345` searches seed values.
- `date:2026-04` filters by local calendar month.
- `date:2026-04..2026-06` filters by an inclusive ISO date range.
- `after:2026-04` and `before:2025` filter date ranges.
- `w:>1024`, `width:1024`, `h:<768`, or `height:768` filter dimensions.
- `upscaled:true` shows upscaled images; `upscaled:false` shows images marked not upscaled.

Use ISO dates such as `2026-04-15` to avoid country-specific date ambiguity. If a `date:`, `after:`, or `before:` token is still partial, Ambit waits instead of applying the search.

## Date Filters

The filter panel has a Date Range section at the bottom. Use it when you want a visual date filter instead of typing date syntax.

Date Range options are:

- All: no date limit
- Today: images from the current local day
- Week: images from the last 7 days
- Month: images from the last 30 days
- Custom range: choose start and end days from the calendar, then Apply

Search syntax can express the same idea inline:

```text
date:2026
date:2026-04
date:2026-04-15
date:2026-04..2026-06
after:2026-04
before:2025
```

`date:YYYY` matches the year, `date:YYYY-MM` matches the month, and `date:YYYY-MM-DD` matches one local day. `date:start..end` requires both sides of the range and accepts year, month, or day values.

## Filter Panel

The Library filter panel is organized into tabs:

- Organize: collections and collection-focused filters.
- Assets: checkpoints, LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter resources.
- Filters: generator tools, generation parameters, and guidance-related filters.

Dirty dots on tab buttons show where active filters live. Active filter chips appear above the library; chips from a smart collection are locked rules, while manual chips can be removed directly. Use Reset All to clear active filters and collection selection.

When you select a smart collection and then add manual refinements, Ambit can show Update. Update saves the refinement back to that smart collection's rules, then clears the manual refinements while keeping the collection selected.

## Assets Tab

The Assets tab filters by resources that Ambit has indexed from image metadata. It can also show local disk inventory when resource folders are configured.

The Assets tab can switch between:

- Used in Library: resources found in imported images.
- Local on Disk: resources discovered from configured resource folders.
- All Assets: both library-used and locally discovered resources.

Resource sections include checkpoints, LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter resources. Each section can offer list or grid view, sorting, search within the section, and resource thumbnails when available.

For LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter resources:

- Match Any shows images that contain at least one selected resource in that category.
- Match All shows images that contain every selected resource in that category.

Checkpoints do not show the Match Any or Match All toggle because each image has one main checkpoint or model.

Local markers mean Ambit found the asset on disk. A local-only inventory item has no indexed image count yet, so it is inventory only and does not filter images until Ambit matches it to image metadata. If Local on Disk is empty, add resource folders from Settings > Connections > Resources. For setup details, sidecar preview behavior, broad `models` root warnings, and local-only inventory limits, see [Assets And Resource Discovery](assets-resource-discovery.md).

## Filters Tab

The Filters tab groups generation metadata filters.

Generator filters show detected generator tools. When another active filter leaves no matching images for a tool, that tool can appear unavailable until the surrounding filter context changes.

Parameters appear when Ambit has matching metadata for them:

- Steps slider filters generation step ranges.
- CFG Scale slider filters CFG ranges.
- Sampler groups organize sampler names by family.
- Generation Type chips can filter text-to-image, image-to-image, extras/upscale, grid, saved, and unknown generations.

Guidance filters group detected ControlNet and IP-Adapter usage by subtype when Ambit can classify it. ControlNet groups can include Canny, Depth, Pose, Scribble, Lineart, Normal, Inpaint, Tile, MLSD, Seg, Instruct, Shuffle, Recolor, and Other. IP-Adapter groups can include FaceID Plus, FaceID, Plus Face, Plus, Portrait, Full Face, Light, Comp, Style, Standard, and Other.

## Collections

Collections organize images without moving source files on disk.

There are two collection types:

- Manual collections contain images you add explicitly.
- Smart collections save filter rules and update their results from the current library.

In the Organize tab, use New Empty Collection to create a manual collection. When filters are active, use Save Filters as Collection to create a smart collection from the current search and filter state.

Collection workflows include:

- select a collection to filter the library to that collection
- select the active collection again to clear the collection filter
- drag selected images into a manual collection
- search collections by name
- sort by recently used, created date, name, or image count
- switch between list and grid collection views
- include archived collections when needed
- keep pinned collections at the top
- rename, color, pin, archive, play slideshow, export to ZIP, reset custom thumbnails, or delete a collection from the context menu

Deleting a collection removes the collection, not the source image files.

Smart collection editing is available from Edit Filters in the collection context menu. In the editor you can remove individual rule chips, Save Changes, Update with Current View to overwrite the saved rules with your active filters, or Remove All Rules (Make Static) to turn the collection into a manual collection.

## Common Workflows

To find images and save the result:

1. Search by prompt text or syntax.
2. Add Assets, Filters, or Date Range refinements.
3. Open Organize.
4. Use Save Filters as Collection and name the smart collection.

To refine a smart collection:

1. Select the smart collection.
2. Add manual search or filter refinements.
3. Use Update when it appears in the Library panel header.

To filter by assets:

1. Open Assets.
2. Choose Used in Library when you want filterable resources.
3. Select resources from one or more sections.
4. Use Match Any or Match All where supported.

## Next Step

For individual image details, continue with [Viewer And Metadata](viewer-and-metadata.md).
