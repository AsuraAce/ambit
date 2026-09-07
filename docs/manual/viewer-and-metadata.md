# Viewer And Metadata

[Back to manual index](index.md)

Ambit opens images and videos in media-specific viewers with shared Details, Metadata, and Workflow surfaces. Images offer zoom, versions, and optional AI actions; videos offer playback and original-file export.

## Open And Navigate The Viewer

Open the viewer from the library grid, timeline, maintenance result lists, or any place that offers View Image.

In the image viewer you can:

- move to the previous or next image with the side arrows or the Left Arrow and Right Arrow keys
- zoom in, zoom out, and reset the view from the bottom zoom controls
- use the mouse wheel to zoom and drag the image while zoomed
- toggle theater mode with `Z`
- show or hide the metadata sidebar with `I`
- close the viewer with `Esc`

Viewer controls can fade while you focus on the image. Move the pointer to show them again. Theater mode hides the sidebar and uses a darker image-focused view.

## Toolbar Actions

The top toolbar shows the filename and, when available, a Version indicator. Toolbar actions can include:

- Copy Image to Clipboard
- Open in Default App
- Theater Mode
- Share, when the operating system or browser supports sharing
- favorite an image with `F`
- pin or unpin with `P`
- Remove from Library
- Hide Sidebar or Show Sidebar
- Close

Remove from Library removes the image record from Ambit's active library. It does not delete the source image file from disk. Use Maintenance > Removed > Delete File only when you intentionally want source-file deletion through the OS trash flow.

## Metadata Sidebar

Both viewers open on Metadata. Your selected tab and expanded metadata sections are retained while navigating within the viewer session.

- Details: technical file facts, notes, and the searchable collection membership picker; images also show a color palette.
- Metadata: prompts, generator and model editors, generation parameters, provenance, and populated resource sections.
- Workflow: workflow inspection, copy, and download when recorded data is available.

For images, Workflow may disappear after Ambit confirms that no workflow was recorded. Video Workflow shows an explanatory empty state when no workflow is available. Use the arrow keys while a tab is focused to switch tabs; Home and End select the first and last tabs.

## Metadata Tab

Use Metadata to inspect and edit catalog metadata. Prompt fields provide a formatted reading surface and an edit control; changed fields save on blur. Original-prompt inspection is read-only. Blank, cancelled, and unchanged generator/model edits do not create overrides. Model choices include the library's checkpoint inventory and a custom value.

The Positive Prompt section can show:

- the current saved prompt
- an Original toggle when Ambit has the imported prompt and the saved prompt differs
- Copy for the displayed prompt
- AI Prompt Recovery when Gemini intelligence features are configured
- Revert when local metadata edits can be restored to the imported original

The Negative Prompt field supports viewing and editing negative prompt data.

The Color Palette section under Details shows extracted colors when Ambit can derive them from the image. Select a swatch to copy its color value.

For images imported with InvokeAI source facts, Source identifies InvokeAI and can show the original image name, category, and origin. This section is available even when the image has no generation parameters. Unrecognized source categories are displayed as recorded instead of being guessed or discarded.

When InvokeAI recorded image-to-image inputs, the Metadata tab can also show:

- Source Images: images used to produce the current image, labelled by their roles such as Initial image, ControlNet input, or IP-Adapter input
- Used By: other Ambit images that used the current image as an input

Select an available entry to open it directly in the same viewer. This also works for InvokeAI assets hidden by the normal library View setting and does not change the current search, collection, or asset-visibility setting. A directly opened hidden asset has the normal viewer metadata and catalog actions, but Previous and Next navigation is unavailable because the asset is outside the current result list. References whose target has not been imported, and backlinks from Removed images, remain visible as disabled entries so the recorded provenance is not mistaken for a broken control.

Generation Parameters is an expandable section for generation parameters and source-compatible copies. It can show:

- Copy generation data in the section header for prompt and parameter text
- sampler, steps, CFG Scale, seed, VAE, Clip Skip, denoising, hires fix fields, and model hash when available
- modification markers when saved metadata differs from the imported original

Resource sections list parsed LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter references. Selecting a resource chip starts a search from the viewer; exact filter behavior depends on the resource type.

Smart Tags are short prompt fragments extracted from the positive prompt. Selecting one searches for that tag and closes the viewer.

Internal Metadata opens a technical inspector with Parsed, Text, and, when workflow JSON exists, JSON views. This is useful when a generator embedded raw parameters or workflow data that is not shown elsewhere.

## Details And Local Edits

Details contains technical file information, Notes, and Collections. Use the collection picker to search and change membership. Notes save on blur when changed.

Positive and negative prompt corrections live under Metadata. For A1111, Forge, and unknown generator records, Parse Prompt from Clipboard can read A1111-style parameter text containing `Steps:` and apply the prompts it finds.

These edits update Ambit's catalog. They do not rewrite the source file or the original generator workflow. Revert is available when actual metadata overrides exist.

## Workflow Tab

Use Workflow to inspect workflow JSON as a node graph when Ambit can parse one.

The Workflow tab can:

- lazy-load workflow data from file headers if the catalog does not already have it
- show Full Node Graph with a node count
- search nodes by title or type
- expand nodes to inspect simple input values
- Copy workflow JSON
- Download workflow JSON to a file

Some images have no recorded workflow. Some workflow data is valid JSON but not a standard node graph, especially complex InvokeAI session data or unusual generator formats. In those cases Ambit can still offer a JSON preview, Copy, or Download when raw workflow data exists.

## Video Playback And Metadata

Videos open with playback controls and start muted. Space toggles playback; J and L seek backward or forward by ten seconds. Previous/Next navigates the current result set. Open in Default App remains available when the Windows media runtime cannot decode a cataloged file. Export Original copies the original video without transcoding. Image comparison, image versions, slideshows, and Gemini image recovery are image-only.

Grid and timeline cards use static posters or a generic placeholder. A masked video does not create a player or play audio until revealed; re-enabling privacy protection stops playback and restores the gate.

Video Details includes duration, dimensions, codec, container, audio presence, notes, and collections. Metadata can show ComfyUI prompts, generation mode, model, parameters, LoRAs, ControlNet, and IP-Adapter resources with evidence-source badges. Missing metadata is left unknown. User edits are local overrides; Revert user overrides restores the recovered metadata.

Ambit reads embedded ComfyUI evidence and an exact sibling sidecar: for `clip.mp4`, use `clip.workflow.json` containing a `media` value of `clip.mp4` and a `workflow` value containing the workflow. Sidecars must be regular non-symlink UTF-8 JSON files no larger than 2 MiB. Valid matching sidecar evidence takes precedence over embedded evidence; conflicting values are retained rather than blended. Live Watch tracks sidecar changes for cataloged videos, and Refresh All Metadata can reconcile changes made while Ambit was closed.

## Image Versions

When an image has stack entries or related versions, the viewer shows a version strip near the bottom. Versions are ordered from the smaller base image toward larger versions. The active version is highlighted, larger or upscaled versions can show an upscale marker, and switching versions updates the preview and metadata.

## Optional Gemini Actions

If Gemini-powered intelligence features are enabled, the Metadata tab can show Creative Assistant actions:

- Prompt Analysis: opens an analysis result and, when available, an Applied Example prompt
- Variations: generates variation ideas with tabs for each result
- View last result: reopens the most recent AI result for the image

AI result views include copy actions such as Copy, Copy All, or Copy This Variation depending on the result type. These actions contact Gemini only when you run them. For setup, key storage, and network behavior, see [Settings And Privacy](settings-and-privacy.md).

## Troubleshooting Metadata

If metadata is missing or looks wrong:

1. Inspect Metadata and Internal Metadata to see what Ambit parsed.
2. Open Workflow to check whether workflow JSON exists or can be loaded from file headers.
3. Refresh metadata for the folder if the source file has newer metadata.
4. Use AI Prompt Recovery only when you intentionally want Gemini to infer a prompt from the image.
5. Use Revert when you want to restore locally edited prompt or generation fields to the imported original.

Metadata quality depends on what the generator embedded in the file.

## Next Step

For cleanup and repair workflows, continue with [Maintenance](maintenance.md).
