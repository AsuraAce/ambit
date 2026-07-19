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
- `flux_depth_lora_example.chunks.json`
- `image_lens_t2i.chunks.json`
- `image_newbieimage_exp0_1-t2i.chunks.json`
- `image_z_image_turbo_fun_union_controlnet.chunks.json`

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

## Phase 23 Resource Intake

Captured on `2026-07-17`. Both workflows now have exact golden assertions while
their pinned fixture bytes remain unchanged.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`flux_depth_lora_example`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/flux_depth_lora_example.json) | `2044353656ee2f44c49fae2547bb75d1590523d4` | 61578 |
| [`image_z_image_turbo_fun_union_controlnet`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_z_image_turbo_fun_union_controlnet.json) | `c01186242bc8e7a918c275c904be231bc8018504` | 42001 |

Source-authored expectations, recorded without asserting current parser output:

- `flux_depth_lora_example`: model `flux1-dev-fp8.safetensors`; seed
  `229472716717627`; 20 steps; CFG 1; `euler` with `normal`; positive prompt
  `A cute ghost-shaped desktop ornament, softly glowing with a warm light,
  placed on a tidy, cozy home table, creating a gentle and sweet atmosphere.`;
  empty negative conditioning; LoRA `flux1-depth-dev-lora.safetensors`; no
  ControlNet. The auxiliary `lotus-depth-d-v1-1.safetensors` model is not the
  generation model, and direct sampler CFG 1 is authoritative over connected
  Flux guidance 10.
- `image_z_image_turbo_fun_union_controlnet`: model
  `z_image_turbo_bf16.safetensors`; seed `729703840979498`; 8 steps; CFG 1;
  `res_multistep` with `simple`; positive prompt `Realistic photo, close-up of
  a latina model peeking through pine branches, dappled sunlight on her face,
  natural, moody, smooth skin, a little bit film grain.` followed by a newline;
  empty negative conditioning; ControlNet
  `Z-Image-Turbo-Fun-Controlnet-Union.safetensors`; no LoRAs.

## Milestone 25 Ideogram Intake

Captured on `2026-07-19`. This workflow remains `unassessed` until the later
Milestone 25 behavior packages pass exact metadata and provenance assertions.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_ideogram4_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_ideogram4_t2i.json) | `c04018493c60d8d4275f0bdc54acb385f59e7ea5` | 119270 |

Source-authored expectations, recorded without asserting current parser output:

- primary model `ideogram4_fp8_scaled.safetensors`; the separate
  `ideogram4_unconditional_fp8_scaled.safetensors` model is auxiliary;
- seed `885894517601261`; selected `Default` profile with 20 steps;
- base guider CFG 7; `CFGOverride` applies CFG 3 only from 70% through 100% of
  the schedule and cannot replace the single base CFG metadata value;
- sampler `euler` with the connected `Ideogram4Scheduler`;
- exact 3,598-byte positive prompt in
  `image_ideogram4_t2i.expected-positive.txt`, with SHA-256
  `dfbe4a1694ca33c124562f3f8f879beb8b5516afa327b342dfae0d9b8f6468af`;
- authoritative empty negative conditioning and no resources.

`coverage_manifest.json` is a stable, name-sorted projection of every entry in
the pinned catalog index. It records only fields needed to classify parser
coverage. Refresh it only as an intentional fixture update: fetch the pinned
`templates/index.json`, flatten each category's `templates`, apply the scope
rules documented in the manifest tests, sort by template name, then carry
forward coverage evidence only when the associated golden test still passes.

Tests are offline and must never fetch the catalog at runtime.
