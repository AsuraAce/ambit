# Assets And Resource Discovery

[Back to manual index](index.md)

Ambit's Assets tab combines two related ideas: resources found in imported image metadata, and optional local resource files discovered on disk. This helps you filter images by the assets they used while also keeping a local inventory of models and related files.

## Asset Sources

Ambit can show assets from:

- image metadata: checkpoints, LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter references parsed from imported images and workflows
- local disk discovery: model and resource files scanned from folders you add in Settings

Image-used assets can filter the library because Ambit has indexed images that reference them. Local-only assets are inventory entries. They can show that a resource exists on disk, but they do not filter images until Ambit has at least one indexed image that matches the asset.

If an asset is both used by images and found on disk, Ambit can merge it into one row with an image count and a local marker.

## Add Resource Folders

Open Settings > Connections > Resources.

Use the Resources page to:

- add a folder that contains local model or resource files
- scan all configured resource folders with Scan Now
- remove a resource folder from Ambit's local inventory

Resource discovery is opt-in and path-scoped. Ambit scans only the folders you add. Adding a resource folder does not import images and does not move, delete, or reorganize your model files.

Prefer specific folders when possible, such as:

- `models/checkpoints`
- `models/Lora` or `models/loras`
- `models/embeddings` or `models/textual_inversion`
- `models/hypernetworks`
- `models/controlnet`
- `models/ipadapter`

If you add a broad `models` root, Ambit shows a warning because broad roots can contain many supported and unsupported model-like folders. Current discovery recognizes common supported folders and skips known unsupported folders such as VAE, CLIP, text encoder, upscaler, detector, caption, face-restore, and unrecognized custom folders.

## Supported Files And Previews

Resource discovery looks for common model-like files such as `.safetensors`, `.ckpt`, `.pt`, `.bin`, and `.pth` when they are in a supported resource folder.

Ambit also scans sidecar preview images such as `.jpg`, `.png`, and `.webp`. When a resource has a sidecar preview, the Assets tab can use it as the resource thumbnail. Otherwise Ambit can use a dynamic thumbnail from an indexed image that used the asset.

In the Assets tab, right-click a resource row or thumbnail to manage thumbnail behavior when actions are available:

- Use Preview: return to the sidecar preview when one exists
- Use Dynamic: use an indexed image thumbnail instead of a sidecar or override
- Mask Thumbnail, Always Show Thumbnail, or Reset Thumbnail Privacy: control privacy handling for that resource thumbnail

## Assets Tab Scopes

Open the Library filter panel, then choose Assets.

The Assets tab has three scopes:

- Used in Library: resources found in imported images
- Local on Disk: resources discovered from configured resource folders
- All Assets: both used resources and local disk inventory

The Assets tab shows sections for checkpoints, LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter resources when matching items exist. You can search within a section, sort it, and switch between list and grid views.

For LoRAs, embeddings, hypernetworks, ControlNet, and IP-Adapter resources, Match Any shows images with at least one selected asset and Match All shows images that contain every selected asset in that category. Checkpoints stay Match Any because each image has one main checkpoint or model.

## Empty Or Confusing Results

If Local on Disk is empty, add a resource folder from Settings > Connections > Resources and run Scan Now.

If a local-only asset appears with no image count, Ambit found the file on disk but has not matched it to any indexed image usage yet. Refresh image metadata or import images that used that asset if you expect it to become filterable.

If a broad model root gives noisy or missing inventory, remove it and add specific resource folders instead. This is usually clearer than scanning an entire generator `models` tree at once.

## Next Step

For filter syntax and collection workflows, continue with [Search, Filters, And Collections](search-filters-collections.md).
