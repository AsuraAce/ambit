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
- `gsc_creator_2_2.chunks.json`
- `image_flux2_klein_image_edit_4b_distilled.chunks.json`
- `image_qwen_image_union_control_lora.chunks.json`
- `Image_capybara_v0_1_text_to_image.chunks.json`
- `image_kandinsky5_t2i.chunks.json`
- `image_omnigen2_t2i.chunks.json`
- `image_chroma1_radiance_text_to_image.chunks.json`
- `image_firered_image_edit1_1.chunks.json`

Partial workflows:

- `gsc_creator_2_3.chunks.json`: the workflow contains a Florence-generated
  caption preview that is not connected to the upscale sampler. The sampler
  instead uses its definition prompt, so the generated caption cannot be
  represented as final generation metadata.
- `image_ernie_image.chunks.json`: prompt enhancement is enabled, but the
  selected `TextGenerate` result is not embedded in the workflow.
- `image_ernie_image_turbo.chunks.json`: prompt enhancement is enabled, but the
  selected `TextGenerate` result is not embedded in the workflow.

`coverage_manifest.json` is a stable, name-sorted projection of every entry in
the pinned catalog index. It records only fields needed to classify parser
coverage. Refresh it only as an intentional fixture update: fetch the pinned
`templates/index.json`, flatten each category's `templates`, apply the scope
rules documented in the manifest tests, sort by template name, then carry
forward coverage evidence only when the associated golden test still passes.

Tests are offline and must never fetch the catalog at runtime.
