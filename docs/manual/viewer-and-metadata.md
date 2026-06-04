# Viewer And Metadata

[Back to manual index](index.md)

The image viewer is where Ambit shows a larger image preview and the metadata Ambit parsed from the source file.

## Viewer Controls

In the viewer you can:

- move to the previous or next image
- zoom, pan, and reset zoom
- toggle theater mode with `Z`
- favorite an image with `F`
- pin an image with `P`
- show or hide the metadata sidebar with `I`
- copy, open externally, share, or remove when those actions are available

The viewer may hide controls while you are focused on the image. Move the pointer to show them again.

## Metadata Sidebar

The sidebar has up to three tabs:

- Info: parsed metadata, prompts, model/resource details, palette, and AI actions when enabled.
- Edit: notes, prompt edits, negative prompt edits, and collection assignment.
- Workflow: workflow inspection when workflow data is present or hinted.

The header shows the generator tool, model or model hash when available, date, and dimensions.

## Prompt And Resource Metadata

Ambit parses generation metadata from common AI image outputs. Depending on the file, metadata can include:

- positive and negative prompts
- generator tool
- model name or model hash
- seed, steps, CFG, sampler, and generation type
- dimensions and timestamp
- LoRA and other resource references
- workflow JSON or raw metadata chunks

Metadata quality depends on what the generator embedded in the file.

## Editing Metadata

Ambit can store local edits such as notes and prompt corrections in its catalog. These edits help search and organization inside Ambit. They do not mean the original generator workflow is changed.

When raw metadata is present, Ambit may offer recovery or revert actions for metadata-related workflows.

## Image Versions

If an image has versions or stack entries, the viewer can show a version selector. Use it to compare related outputs, such as a base image and an upscaled result.

## Optional AI Actions

If Gemini-powered intelligence features are enabled, the viewer can offer prompt analysis or variation generation. These actions contact Gemini only when you explicitly run them.

## Next Step

For cleanup and repair workflows, continue with [Maintenance](maintenance.md).
