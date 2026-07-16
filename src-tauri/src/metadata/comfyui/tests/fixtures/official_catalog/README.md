# Official ComfyUI Workflow Catalog Fixtures

These fixtures come from the official ComfyUI
[`workflow_templates`](https://github.com/Comfy-Org/workflow_templates) repository.
They contain exact workflow JSON wrapped as a `workflow` metadata chunk.
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
- `image_anima_base_v1.chunks.json`
- `image_boogu_image_0_1_edit.chunks.json`
- `image_lens_t2i.chunks.json`
- `image_newbieimage_exp0_1-t2i.chunks.json`

Pattern-covered workflows:

- `image_anima_preview.chunks.json`: its internal selected path matches the
  Anima Base golden; exact assertions cover its instance bindings and metadata.
- `image_lens_turbo_t2i.chunks.json`: its internal custom-sampler path matches
  Lens, while exact assertions cover its distinct prompt boundary and metadata.

Partial workflows:

- `gsc_creator_2_3.chunks.json`: the workflow contains a Florence-generated
  caption preview that is not connected to the upscale sampler. The sampler
  instead uses its definition prompt, so the generated caption cannot be
  represented as final generation metadata.
- `image_ernie_image.chunks.json`: prompt enhancement is enabled, but the
  selected `TextGenerate` result is not embedded in the workflow.
- `image_ernie_image_turbo.chunks.json`: prompt enhancement is enabled, but the
  selected `TextGenerate` result is not embedded in the workflow.
- `video_bernini_r_image_editing.chunks.json`: the selected system prompt needs
  output-slot-aware `CustomCombo.INDEX` resolution, while total steps and the
  scheduler remain behind `SplitSigmas`.

## Phase 22 Intake

Captured on `2026-07-13`. These five workflows began as intake fixtures. Coverage
claims are added package by package only after exact metadata assertions pass.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_anima_base_v1`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_anima_base_v1.json) | `2b8eb6b61006a4e95a92f9e9b10fb23df44f3868` | 26973 |
| [`image_newbieimage_exp0_1-t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_newbieimage_exp0_1-t2i.json) | `04bd4bae0d85c4860b65e603f3b5020391123210` | 37366 |
| [`image_lens_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_lens_t2i.json) | `8784096ee565f02e20c13c07a0f582cfa9d0692d` | 42959 |
| [`image_boogu_image_0_1_edit`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_boogu_image_0_1_edit.json) | `35750c20d300a25e6e1f8231c664392accee8abe` | 31677 |
| [`video_bernini_r_image_editing`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/video_bernini_r_image_editing.json) | `8d6b8327865c9421a0f20244f1f314d8c2818e67` | 98085 |

Related variants captured for structural comparison:

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_anima_preview`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_anima_preview.json) | `80c7cca83a3fed582d4fd1fe20971b60d68336ac` | 28192 |
| [`image_lens_turbo_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_lens_turbo_t2i.json) | `697cbf0bb04eff2d70750dd9d2f01cc920d76ca5` | 42982 |

Source-authored expectations, recorded without asserting current parser output:

- `image_anima_base_v1`: model `anima-base-v1.0.safetensors`; seed
  `875817230929465`; 30 steps; CFG 4; `er_sde` with `simple`; positive and
  negative literals from definition nodes 11 and 12; no resources.
- `image_newbieimage_exp0_1-t2i`: model
  `NewBie-Image-Exp0.1-bf16.safetensors`; seed `27582042565232`; 20 steps;
  CFG 5.5; `res_multistep` with `simple`; positive text is exactly
  `StringReplace(StringReplace(node 47, "{user_prompt}", node 48),
  "{caption}", node 44)` and negative text is definition node 49; no
  resources. Work Package 2 stores the independently expanded positive prompt
  in `image_newbieimage_exp0_1-t2i.expected-positive.txt` and asserts it exactly.
- `image_lens_t2i`: model `lens_bf16.safetensors`; seed `199454112061500`;
  20 steps; CFG 5; `euler` with `simple`; positive and negative literals from
  definition nodes 3 and 7; no resources.
- `image_boogu_image_0_1_edit`: model
  `boogu_image_edit_fp8_scaled.safetensors`; seed 22; 25 steps; CFG 3.5;
  `dpmpp_2m` with `simple`; `TextEncodeBooguEdit` node 36 receives the literal
  prompt `remove the hat` and has no separate authored negative text; no
  resources.
- `video_bernini_r_image_editing`: root/base model
  `wan2.2_bernini_r_high_noise_fp8_scaled.safetensors`; seed
  `283365432432581`; turbo mode selects 6 steps, CFG 1, `res_multistep` with
  `simple`, and a 3-step split. The task selector chooses line 0 (`You are a
  helpful assistant.`), then concatenates `make it night` with an empty
  delimiter; definition node 4 supplies the negative literal. The same
  `lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors` resource
  is active on the high- and low-noise model stages at strengths 3.0 and 1.5.

`coverage_manifest.json` is a stable, name-sorted projection of every entry in
the pinned catalog index. It records only fields needed to classify parser
coverage. Refresh it only as an intentional fixture update: fetch the pinned
`templates/index.json`, flatten each category's `templates`, apply the scope
rules documented in the manifest tests, sort by template name, then carry
forward coverage evidence only when the associated golden test still passes.

Tests are offline and must never fetch the catalog at runtime.
