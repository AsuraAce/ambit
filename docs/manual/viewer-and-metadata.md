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

Copy Image to Clipboard puts the picture itself on the clipboard, so you can paste it into another app such as Paint, a chat app or a browser. It works for PNG, JPEG and WebP images in your library, and shows a message if the copy fails. The same action is available as Copy Image when you right-click an image; Copy File Path in that menu copies the file's location as text instead. Videos have no Copy Image action.

Remove from Library removes the image record from Ambit's active library. It does not delete the source image file from disk. Use Maintenance > Removed > Delete File only when you intentionally want source-file deletion through the OS trash flow.

## Metadata Sidebar

Both viewers initially open on Details. Explicit tab selections are remembered globally across images, videos, and app restarts. If a preferred tab is unavailable, the viewer temporarily shows Metadata (or Details if Metadata is unavailable), without replacing the saved preference. Expanded metadata sections remain viewer-session state.

- Details: technical file facts, notes, and the searchable collection membership picker; images also show a color palette.
- Metadata: prompts, generator and model editors, generation parameters, provenance, and populated resource sections.
- Workflow: workflow inspection, copy, and download when recorded data is available.

For images, Workflow may disappear after Ambit confirms that no workflow was recorded. Video Workflow shows an explanatory empty state when no workflow is available. Use the arrow keys while a tab is focused to switch tabs; Home and End select the first and last tabs.

Photos and Other images show only Details and Metadata. Details contains technical file facts, the Image Kind dropdown, color palette, notes, and collection membership. Metadata shows captured time, camera and lens, exposure settings, attribution, and local GPS coordinates when available. Ambit stores and displays GPS coordinates locally and does not contact a map or network service.

### Photo coverage

Ambit reads selected embedded EXIF fields from JPEG, PNG eXIf, and WebP EXIF containers. Camera/capture, lens/exposure, orientation, attribution, and GPS fields are shown when supported values are present; GPS starts collapsed. This is not an all-tags inspector or comprehensive IPTC, XMP, MakerNotes, or RAW workflow. Missing EXIF does not make a file a photo by extension alone, and strong generator evidence takes precedence over camera metadata unless you choose a manual Image Kind.

Photo probes are limited to 64 MiB of input. Malformed or over-budget probes remain retryable through metadata refresh. The updated photo-refresh workflow revisits previously imported eligible PNG/WebP records while preserving notes, collections, and manual classifications. Files with no supported metadata show “No supported metadata found” and “File information is available in Details.”

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

The image **Modified** row shows the filesystem modification date and time. It is separate from the camera's **Captured** value in Metadata; captured time may also determine a photo's timeline position.

Positive and negative prompt corrections live under Metadata. For A1111, Forge, and unknown generator records, Parse Prompt from Clipboard can read A1111-style parameter text containing `Steps:` and apply the prompts it finds.

Image Kind offers Automatic, Generated, Photo, and Other. Automatic follows Ambit's conservative metadata detection. Manual choices are catalog-only and survive rescans; they do not rewrite the image file.

Positive Prompt and Negative Prompt fields save local prompt corrections to Ambit's catalog on blur. Unchanged fields do not create overrides. Imported original prompts remain available for read-only inspection.

Notes stores local notes for the image and saves changed text on blur.

These edits update Ambit's catalog. They do not rewrite the original image file or change the original generator workflow.
Revert is available when actual metadata overrides exist.

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

### Workflow Graph

For a ComfyUI image or video, the **Graph** button in the Workflow tab opens the saved workflow as a full-screen node graph, drawn the way ComfyUI lays it out. The graph only shows the workflow; it never changes it. When Ambit can't draw a graph, because the file has no ComfyUI workflow or the tool isn't ComfyUI, the button stays disabled and its tooltip says why. **Back to image** or `Esc` returns to the viewer.

The graph opens where the file saved its nodes. A file with no saved positions, such as one that only carries an API prompt, is laid out by Ambit from left to right; the badge **API prompt** and the hint "Laid out by Ambit" say so. A very large workflow shows **Partly shown** when Ambit draws only part of it.

Moving around:

- Drag the empty space to pan, and use the mouse wheel to zoom around the pointer.
- **Fit** (`F`) shows the whole level. The **−** and **+** buttons, or the `-` and `+` keys, zoom out and in.
- Zoomed far out, only the coloured group pills show, each with its node count. Closer in, the node titles appear, and close up every setting shows. Click a group's title pill to zoom to that group.
- **As saved** shows the file's own layout. **Tidy** lets Ambit lay the nodes out again, left to right.

Reading nodes:

- Click a node to open its side panel. The panel shows the node's settings, **Inputs from** (where each input comes from), **Outputs to** (where each output goes), and its raw JSON with **Copy**. Click a row under Inputs from or Outputs to to go to that node.
- Bypassed and muted nodes are marked as in ComfyUI. A note node shows its text.
- Each node and each group has a fold button. Folding a group shrinks it to one box, and its wires join at the box.
- `/` opens the search, **Find a node or value**. It matches node titles, node types and setting values. The matching nodes light up, and the Up and Down arrows and Enter pick one from the list.
- A subgraph node has **Open** (and its side panel **Open subgraph**), which shows the subgraph as its own level. The breadcrumb above the graph (Workflow › subgraph name) leads back up. Each level keeps its folds, layout and view while the graph stays open.

Wires and colours:

- **Wires** picks how the wires are drawn: **Curved**, **Straight**, **Angled**, **Bundled** (the default: wires from one output share a line and split near the end) or **Hidden** (only the clicked node's wires show). It also sets the wire **Width** (**Thin**, **Normal**, **Thick**) and turns on **Moving dots**, which run along the clicked node's wires.
- **Types** lists the wire colours in this level with their counts. Under **Colours** you pick **Quiet** (the default, softer tones) or **Familiar** (ComfyUI's own colours).
- **Map**, in the bottom-right corner, shows the whole level with a frame for the part on screen. Click or drag in it to move the view. `M` or its fold button hides and shows it.

The floating image:

- **Image** (`I`) floats the picture over the graph in a small window. For a video it shows the poster.
- Drag the window by its bar, and drag its bottom-right corner to resize it. The fold button shrinks it to its bar, and the close button hides it until you press Image or `I` again. Its bar stays on the graph, so you can always drag it back. The window moves out from under a node's panel when the panel opens, and keeps its place while you open subgraphs.
- Point at the picture to light up the node that saved it, or the subgraph that holds that node. Click the picture to go to that node and open its panel.

Keys while the graph is open:

| Key                                      | Action                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Esc`                                    | Closes an open menu, then the search, then the side panel, then goes up one subgraph level, then closes the graph |
| `/`                                      | Opens the search                                                                                                  |
| `F`                                      | Fits the level on screen                                                                                          |
| `+` / `-`                                | Zooms in and out                                                                                                  |
| `M`                                      | Shows or hides the map                                                                                            |
| `I`                                      | Shows or hides the floating image                                                                                 |
| `Tab` to the canvas, then the arrow keys | Moves between nodes; Right and Left follow the wires                                                              |
| `Enter`                                  | Opens the side panel for the node the arrow keys reached. On a subgraph, a second Enter opens it                  |

While the graph is open, the viewer's own keys, such as Delete, `F` for favourite and the arrows, do nothing to the image.

Ambit remembers your wire shape, width, moving dots, colours and whether the map shows. It saves nothing else: folds, the Tidy layout, the search and the floating image's place reset when the graph closes. A hidden (masked) image shows no graph until you reveal it.

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

1. Inspect Metadata and, for generated images, Internal Metadata to see what Ambit parsed.
2. Open Workflow to check whether workflow JSON exists or can be loaded from file headers.
3. Refresh metadata for the folder if the source file has newer metadata.
4. Use AI Prompt Recovery only when you intentionally want Gemini to infer a prompt from the image.
5. Use Revert when you want to restore locally edited prompt or generation fields to the imported original.

Metadata quality depends on what the generator embedded in the file.

## Next Step

For cleanup and repair workflows, continue with [Maintenance](maintenance.md).
