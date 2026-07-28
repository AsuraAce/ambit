# Official ComfyUI Workflow Catalog Fixtures

These fixtures come from the official ComfyUI
[`workflow_templates`](https://github.com/Comfy-Org/workflow_templates) repository.
They contain exact workflow JSON wrapped as a `workflow` metadata chunk.
No generated images, thumbnails, input assets, or API prompt chunks are vendored.

- Repository: `https://github.com/Comfy-Org/workflow_templates`
- Coverage release: `v0.11.15`
- Coverage commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`
- Previous fixture baseline: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`
- Catalog index: `templates/index.json`
- Coverage snapshot captured: `2026-07-28`
- Upstream license: MIT

Coverage is commit-specific. Fixtures retained from the previous baseline count
for the refreshed manifest only when their upstream workflow Git blob is
unchanged. Changed workflows remain useful parser regressions, but are marked
`unassessed` for the refreshed release until their new bytes are revalidated.

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
- `image_longcat_text_to_image.chunks.json`
- `image_pixeldit_t2i.chunks.json`
- `image_chrono_edit_14B.chunks.json`
- `image_netayume_lumina_t2i.chunks.json`

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

Captured on `2026-07-19`. The workflow is now `golden`; exact assertions cover
its selected primary model, base CFG, prompt branches, and connected custom
scheduler without promoting the auxiliary model or scheduled CFG override.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_ideogram4_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_ideogram4_t2i.json) | `c04018493c60d8d4275f0bdc54acb385f59e7ea5` | 119270 |

Golden expectations:

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

## Milestone 26 New-Family Intake

Captured on `2026-07-22`. These workflows extend exact golden coverage to
LongCat, PixelDiT, ChronoEdit, and NetaYume/Lumina without changing parser
behavior or parser version 31.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_longcat_text_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_longcat_text_to_image.json) | `134b4ef684a862eb5d6a579d0e38e15589b6fa79` | 32286 |
| [`image_pixeldit_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_pixeldit_t2i.json) | `66593d57b3d14b42e137be9d53cf2f90820e7bee` | 28991 |
| [`image_chrono_edit_14B`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_chrono_edit_14B.json) | `e354fb1ab91240f81458da367216b3ccd544fa03` | 54303 |
| [`image_netayume_lumina_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_netayume_lumina_t2i.json) | `8d7426f8ca3ada611df2b785ff1cac952a06aa1b` | 39376 |

Golden expectations:

- `image_longcat_text_to_image`: LongCat BF16, seed `284089112874294`, 20
  steps, CFG 4, `euler` with `simple`, exact positive and negative literals,
  and no resources.
- `image_pixeldit_t2i`: PixelDiT 1300M BF16, seed `59233627785266`, 30
  steps, CFG 4, `er_sde` with `simple`, exact positive and negative literals,
  and no resources.
- `image_chrono_edit_14B`: ChronoEdit 14B FP16, seed `164026091171544`, 20
  steps, CFG 4, `uni_pc` with `simple`, exact positive and Chinese negative
  literals. The disabled distillation LoRA is not reported.
- `image_netayume_lumina_t2i`: NetaYume v3.5 all-in-one, seed 0, 30 steps,
  CFG 4, `res_multistep` with `simple`, and exact nested prompt composition.
  The independently captured positive prompt is 1,123 bytes with SHA-256
  `159fb3c5929f60a834a9302f1d5862c620b0df12e77421066cc9c9616b5fefd9`;
  the negative prompt is 481 bytes with SHA-256
  `00d0aa5c35231d969700a87b124faf21c4ae8ea940466cd166aa6b56079129e9`.

## Milestone 27 Image-Edit Intake

Captured on `2026-07-28`. These workflows add exact image-edit coverage for
LongCat, Capybara, OmniGen2, and HiDream E1.1.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_longcat_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_longcat_image_edit.json) | `adf2d2d05b97d783139443fcbb0645a4812ed7ed` | 35122 |
| [`Image_capybara_v0_1_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/Image_capybara_v0_1_image_edit.json) | `39b6c3d9fa952a5f4c50d801d7931720613324fe` | 48160 |
| [`image_omnigen2_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_omnigen2_image_edit.json) | `c14f55f4797cf66a0980a5dedf51919f91865942` | 26553 |
| [`hidream_e1_1`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/hidream_e1_1.json) | `b43bcca048e888b5f7f9d1b713a3465052924736` | 21495 |

All four fixtures have one unambiguous saved-output root, no resources, and
exact `SamplerTraversal` metadata assertions. HiDream E1.1 connects the two
edit-conditioning outputs to `DualCFGGuider.cond1` and `.cond2`; parser version
32 preserves the source output slot so slot 1 supplies the negative prompt
without changing ordinary dual-guider `cond2` policy.

`coverage_manifest.json` is a stable, name-sorted projection of every entry in
the pinned catalog index. It records only fields needed to classify parser
coverage. Refresh it only as an intentional fixture update: fetch the pinned
`templates/index.json`, flatten each category's `templates`, apply the scope
rules documented in the manifest tests, sort by template name, then carry
forward coverage evidence only when the associated golden test still passes.

Tests are offline and must never fetch the catalog at runtime.

## Milestone 28 Reference And Modifier Intake

Captured on `2026-07-28` from the pinned catalog commit. These workflow-only
fixtures cover reference conditioning, shared-root preview outputs, transparent
model modifiers, and an active edit LoRA.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`flux1_dev_uso_reference_image_gen`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/flux1_dev_uso_reference_image_gen.json) | `f03156d29ad4afb6c1f81f552076c793404f62ed` | 111297 |
| [`image_flux.1_fill_dev_OneReward`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux.1_fill_dev_OneReward.json) | `ae89238cf5e0bebca38ca224c75645c89800fd5d` | 74206 |
| [`image_flux2_klein_9b_kv_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2_klein_9b_kv_image_edit.json) | `5a67a1cce4b06a69f97c20eaa56a800f9cf2cd18` | 46164 |
| [`image-qwen_image_edit_2511_lora_inflation`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image-qwen_image_edit_2511_lora_inflation.json) | `5c3f4546c31cb25680e948141c2eee700112952d` | 40876 |

Golden expectations:

- USO keeps `flux1_dev_fp8` as the primary model, reports only
  `uso_flux1_dit_lora_v1`, and ignores its projector, CLIP vision, and style
  reference as generation resources. Its bypassed model wrapper is traversed
  only because the instance has one connected input matching the used output
  type.
- OneReward selects two active preview outputs that share one sampler root;
  the mode-4 save is ignored. Direct sampler CFG 1 remains authoritative over
  connected Flux guidance 30.
- Flux.2 Klein KV cache is transparent to primary model traversal and does not
  become a resource.
- Qwen Image Edit reports only the active inflation LoRA.

Parser version 33 adds conservative workflow-only bypass passthrough. A muted,
malformed, or type-ambiguous instance remains opaque and cannot gain strong
traversal authority.

## Milestone 29 Core Variant Intake

Captured on `2026-07-28` from the pinned catalog commit. These workflow-only
fixtures close direct Qwen Image 2512 and HiDream I1 variants while recording
the Krea 2 INT8 generated-prompt boundary honestly.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_qwen_Image_2512`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_qwen_Image_2512.json) | `004f4589eed5dd60d9c7f96154fcebf94387cd28` | 52269 |
| [`image_qwen_image_2512_with_2steps_lora`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_qwen_image_2512_with_2steps_lora.json) | `be0745544baab6c66bc9aacd184361668b70ddb8` | 18117 |
| [`hidream_i1_dev`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/hidream_i1_dev.json) | `7ae5db47050e8c47124525d7fc37f9ddb43e6a7f` | 16039 |
| [`hidream_i1_fast`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/hidream_i1_fast.json) | `60a6efb63511ac851359451dbd8641c4d71cccd9` | 15996 |
| [`image_krea2_turbo_t2i_int8`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_krea2_turbo_t2i_int8.json) | `6cb31b94a0ebf07bc142594bce0dad454a903bc7` | 56802 |

The Qwen base template keeps turbo mode disabled, while the two-step template
reports its active Turbo LoRA. HiDream Dev and Fast retain their distinct LCM
sampler settings and literal prompts. Krea 2 INT8 enables `TextGenerate`; its
result is not embedded, so the positive prompt remains unavailable and the
visible stale `CLIPTextEncode` widget is not treated as generated metadata.
The disabled Krea style LoRA is not reported.

Parser version 34 also fixes workflow definitions that retain a stale second
edge into an input owned by an unlinked subgraph boundary. The boundary's
declared widget default remains authoritative; the shadow edge cannot supply a
different scalar such as CFG in place of the sampler seed.

## Milestone 30 Baseline Variant Intake

Captured on `2026-07-28` from the pinned catalog commit. These workflow-only
fixtures close representative baseline and turbo variants using existing
selected-output parser behavior.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`flux_dev_checkpoint_example`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/flux_dev_checkpoint_example.json) | `c59a204c9ad1c454cdbb2b416f97a3bd8fba0082` | 25190 |
| [`image_boogu_image_0_1_turbo_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_boogu_image_0_1_turbo_t2i.json) | `53deaf8c1fece841eaaca33b3507dce701aeaf7d` | 23747 |
| [`image_chroma_text_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_chroma_text_to_image.json) | `1b9525f95e3b80c3e6b07835bd869854aba1d182` | 21297 |
| [`image_qwen_image`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_qwen_image.json) | `2a8e9aee5c43a30e95274b2a59dbbc10a218a083` | 46429 |
| [`image_z_image_turbo`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_z_image_turbo.json) | `4a98c03bf882a1d4d3a9ebd70ba280f08bc14dde` | 27172 |

Flux Dev, Boogu Turbo, and Z-Image Turbo exercise ordinary KSampler subgraph
defaults. Chroma exercises the direct custom-sampler path. Qwen keeps turbo
mode disabled, so linked 20-step/CFG-4 values win over stale sampler widgets
and the inactive Lightning LoRA is not reported. Its independently captured
UTF-8 prompt is stored in `image_qwen_image.expected-positive.txt`.

## Milestone 31 Baseline And Edit Intake

Captured on `2026-07-28` from the pinned catalog commit. These workflow-only
fixtures close additional baseline and edit variants with existing parser
behavior.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`flux_dev_full_text_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/flux_dev_full_text_to_image.json) | `cfbee2b5bcc18720521cd895ab939c5b8ba76723` | 25597 |
| [`flux1_krea_dev`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/flux1_krea_dev.json) | `017543a6a0fcf55faa5391a0a2ee34df2aeb845b` | 26044 |
| [`image_qwen_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_qwen_image_edit.json) | `8da6b49269c84e01c75a3664090dabd7996d0041` | 51223 |
| [`image_z_image`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_z_image.json) | `ccce095bde775ea9c0fbe8c0dd3bfd2b708d32cc` | 30515 |
| [`image_z_image_turbo_int8`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_z_image_turbo_int8.json) | `37ba25e23784c6b830dc5473f7ac1938a8cb1dda` | 28047 |

All five fixtures have one unambiguous saved-output root, no reported
resources, and exact `SamplerTraversal` metadata assertions. Qwen Image Edit
keeps its Lightning LoRA disabled. The independently captured UTF-8 Z-Image
prompt is stored in `image_z_image.expected-positive.txt`.

## Milestone 32 Flux.2 Variant Intake

Captured on `2026-07-28` from the pinned catalog commit. These workflow-only
fixtures close the remaining Flux.2 Dev and Flux.2 Klein target variants using
existing selected-output parser behavior.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`image_flux2`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2.json) | `d645c7331fee1921608a0c28d44d42a5bf890bcf` | 57255 |
| [`image_flux2_fp8`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2_fp8.json) | `f7782e43ffb3a61798c8bc4b6e2b046c6e568b3c` | 59153 |
| [`image_flux2_klein_image_edit_4b_base`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2_klein_image_edit_4b_base.json) | `c3ebfc04b920186bb50ff84561e7ef90cd3fd83a` | 98467 |
| [`image_flux2_klein_image_edit_9b_base`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2_klein_image_edit_9b_base.json) | `81dded82f99bb109005f066ba6397a114029077a` | 97915 |
| [`image_flux2_klein_image_edit_9b_distilled`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2_klein_image_edit_9b_distilled.json) | `41b340042e8d167cb220ef8dbccfacba55d7ad43` | 99897 |
| [`image_flux2_klein_text_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2_klein_text_to_image.json) | `951d58ac7945845aa6d0d4bb7544d26fdc96c22c` | 69968 |
| [`image_flux2_text_to_image_9b`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_flux2_text_to_image_9b.json) | `b6cd774b9d5cf56dbfd13b87a27066f0075ddf6b` | 39806 |

All seven fixtures have one unambiguous active saved-output root and exact
`SamplerTraversal` metadata assertions. Disabled Turbo LoRAs, bypassed
alternative subgraphs, and bypassed save nodes are intentionally omitted.

## Milestone 33 Active Target Closure

Captured on `2026-07-28` from the pinned catalog commit. These workflow-only
fixtures assess the final five entries in the 75-workflow active target.

| Workflow | Upstream Git blob | Bytes |
| --- | --- | ---: |
| [`flux_schnell_full_text_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/flux_schnell_full_text_to_image.json) | `99099e105eb26ec695c53590e5dff7606c8e3b1a` | 11039 |
| [`hidream_e1_full`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/hidream_e1_full.json) | `057d62066a57cfa9639e81912c348743d8c6fcd9` | 20330 |
| [`image_hidream_o1`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_hidream_o1.json) | `6506c98a9bec9a138b475804637d810158639774` | 66255 |
| [`image_hidream_o1_dev`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_hidream_o1_dev.json) | `3c714c936dde6fad348c57fc74c790d7b71d4d03` | 64769 |
| [`image_qwen_image_edit_2511`](https://github.com/Comfy-Org/workflow_templates/blob/c3bf8342318a3c2bfcbf6d0ac020155745417f29/templates/image_qwen_image_edit_2511.json) | `c055e4e70c8a75ca4df197e99be72ec11c582203` | 57017 |

Flux Schnell, HiDream E1, and Qwen Image Edit 2511 are exact goldens. The two
HiDream O1 workflows are partial because their selected `TextGenerate` result
is not embedded; the parser deliberately leaves those prompts empty rather
than reporting generator input or stale widget text.
