# Search, Filters, And Collections

[Back to manual index](index.md)

Ambit combines search text, metadata filters, resource facets, date filters, favorites, pins, and collections to narrow large local libraries.

## Search Basics

The search bar matches the positive prompt by default. Spaces narrow results. Use `OR` to match alternatives.

Examples:

```text
sunset portrait
orc OR elf
"dark forest"
```

Open Help, then Search Syntax, for the in-app operator list.

## Search Operators

Useful operators include:

- `-term` or `!term` excludes a positive-prompt term.
- `neg:blur` searches the negative prompt.
- `file:portrait` searches filename or path.
- `all:anime` searches path and raw metadata.
- `model:sdxl` filters by model.
- `lora:detail` filters by LoRA.
- `cn:pose` or `controlnet:pose` filters by ControlNet.
- `ip:adapter` or `ipadapter:adapter` filters by IP-Adapter.
- `tool:invoke` filters by generator.
- `sampler:euler` filters by sampler.
- `steps:>30` filters generation steps.
- `cfg:<7` filters CFG.
- `seed:12345` filters seed.
- `date:2026-04` filters by local calendar month.
- `date:2026-04..2026-06` filters by an inclusive ISO date range.
- `after:2026-04` and `before:2025` filter date ranges.
- `w:>1024` and `h:<768` filter dimensions.
- `upscaled:true` shows upscaled images.

Use ISO dates such as `2026-04-15` to avoid country-specific date ambiguity. Plain terms combine with AND; `OR` only groups adjacent positive-prompt terms.

## Filter Panel

The Library filter panel is organized into tabs:

- Organize: collections and collection-focused filters.
- Assets: checkpoints, LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter resources.
- Filters: generator tools, generation parameters, and guidance-related filters.

The date filter is available at the bottom of the panel.

Use Reset All to clear active filters. When filter state changes inside a smart collection, Ambit can show an Update action for saving the adjusted rules.

## Asset Scope

The Assets tab can switch between:

- Used in Library: resources found in imported images.
- Local on Disk: resources discovered from configured resource folders.
- All Assets: both library-used and locally discovered resources.

If Local on Disk is empty, add resource folders from Settings > Connections > Resources. For setup details and local-only inventory behavior, see [Assets And Resource Discovery](assets-resource-discovery.md).

## Collections

Collections help organize images without moving files on disk.

Use collections to:

- group images manually
- open a saved group from the library panel
- rename, archive, pin, color, export, or reset collection thumbnails when those actions are available
- save search/filter rules as smart collections

Manual collections contain selected images. Smart collections represent saved filter rules.

## Next Step

For individual image details, continue with [Viewer And Metadata](viewer-and-metadata.md).
