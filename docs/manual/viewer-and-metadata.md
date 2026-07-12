# Viewer And Metadata

[Back to manual index](index.md)

The image viewer is where Ambit shows a large preview, parsed generation metadata, local notes, collection membership, workflow data, and optional AI actions for one image or version.

## Open And Navigate The Viewer

Open the viewer from the library grid, timeline, maintenance result lists, or any place that offers View Image.

In the viewer you can:

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

The sidebar header shows the image filename, generator tool, model name or model hash when available, date, and dimensions.

The sidebar can show three tabs:

- Info: prompts, generation parameters, resources, palette, internal metadata, and optional AI tools
- Edit: collection membership, prompt edits, negative prompt edits, and notes
- Workflow: workflow node inspection when workflow data exists or Ambit has not yet confirmed that none exists

The Workflow tab may disappear for images that Ambit has already identified as having no recorded workflow.

## Info Tab

Use Info for read-heavy inspection.

The Positive Prompt section can show:

- the current saved prompt
- an Original toggle when Ambit has the imported prompt and the saved prompt differs
- Copy for the displayed prompt
- AI Prompt Recovery when Gemini intelligence features are configured
- Revert when local metadata edits can be restored to the imported original

The Negative Prompt section appears when negative prompt data exists.

The Color Palette section shows extracted colors when Ambit can derive them from the image. Select a swatch to copy its color value.

Generation Data is an expandable section for generation parameters and source-compatible copies. It can show:

- Copy Workflow when workflow JSON exists
- Copy Params for prompt and parameter text
- editable Generator Software and Model fields
- sampler, steps, CFG Scale, seed, VAE, Clip Skip, denoising, hires fix fields, and model hash when available
- modification markers when saved metadata differs from the imported original

Resource sections list parsed LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter references. Selecting a resource chip starts a search from the viewer; exact filter behavior depends on the resource type.

Smart Tags are short prompt fragments extracted from the positive prompt. Selecting one searches for that tag and closes the viewer.

Internal Metadata opens a technical inspector with Parsed, Text, and, when workflow JSON exists, JSON views. This is useful when a generator embedded raw parameters or workflow data that is not shown elsewhere.

## Edit Tab

Use Edit for local catalog changes.

Collections lets you search collections and toggle whether the current image belongs to each collection.

Positive Prompt and Negative Prompt fields save local prompt corrections to Ambit's catalog. Dirty fields show an Unsaved marker and save on blur. For A1111, Forge, and unknown generator records, Parse from Clipboard can read A1111-style parameter text containing `Steps:` and apply the positive and negative prompts it finds.

Notes stores local notes for the image. Notes save on blur or with the visible save button when the field is dirty.

These edits update Ambit's catalog. They do not rewrite the original image file or change the original generator workflow.

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

## Image Versions

When an image has stack entries or related versions, the viewer shows a version strip near the bottom. Versions are ordered from the smaller base image toward larger versions. The active version is highlighted, larger or upscaled versions can show an upscale marker, and switching versions updates the preview and metadata.

## Optional Gemini Actions

If Gemini-powered intelligence features are enabled, the Info tab can show Creative Assistant actions:

- Prompt Analysis: opens an analysis result and, when available, an Applied Example prompt
- Variations: generates variation ideas with tabs for each result
- View last result: reopens the most recent AI result for the image

AI result views include copy actions such as Copy, Copy All, or Copy This Variation depending on the result type. These actions contact Gemini only when you run them. For setup, key storage, and network behavior, see [Settings And Privacy](settings-and-privacy.md).

## Troubleshooting Metadata

If metadata is missing or looks wrong:

1. Inspect Info and Internal Metadata to see what Ambit parsed.
2. Open Workflow to check whether workflow JSON exists or can be loaded from file headers.
3. Refresh metadata for the folder if the source file has newer metadata.
4. Use AI Prompt Recovery only when you intentionally want Gemini to infer a prompt from the image.
5. Use Revert when you want to restore locally edited prompt or generation fields to the imported original.

Metadata quality depends on what the generator embedded in the file.

## Next Step

For cleanup and repair workflows, continue with [Maintenance](maintenance.md).
