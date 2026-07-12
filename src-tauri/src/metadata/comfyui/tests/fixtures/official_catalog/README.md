# Official ComfyUI Workflow Catalog Fixtures

These fixtures come from the official ComfyUI
[`workflow_templates`](https://github.com/Comfy-Org/workflow_templates) repository.
They contain exact minified workflow JSON wrapped as a `workflow` metadata chunk.
No generated images, thumbnails, input assets, or API prompt chunks are vendored.

- Repository: `https://github.com/Comfy-Org/workflow_templates`
- Commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`
- Catalog index: `templates/index.json`
- Captured: `2026-07-11`
- Upstream license: MIT

Golden workflows:

- `image_qwen_image_edit_2509.chunks.json`
- `flux_fill_inpaint_example.chunks.json`
- `flux_kontext_dev_basic.chunks.json`
- `hidream_i1_full.chunks.json`
- `01_get_started_text_to_image.chunks.json`
- `02_qwen_Image_edit_subgraphed.chunks.json`
- `image_flux2_text_to_image.chunks.json`
- `image_qwen_Image_2512_controlnet.chunks.json`

`coverage_manifest.json` is a stable, name-sorted projection of every entry in
the pinned catalog index. It records only fields needed to classify parser
coverage. Refresh it only as an intentional fixture update: fetch the pinned
`templates/index.json`, flatten each category's `templates`, apply the scope
rules documented in the manifest tests, sort by template name, then carry
forward coverage evidence only when the associated golden test still passes.

Tests are offline and must never fetch the catalog at runtime.
