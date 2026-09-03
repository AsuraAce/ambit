# Official ComfyUI Workflow Catalog Fixtures

These fixtures come from the official ComfyUI
[`workflow_templates`](https://github.com/Comfy-Org/workflow_templates) repository.
They contain exact workflow JSON wrapped as a `workflow` metadata chunk.
No generated images, thumbnails, input assets, or API prompt chunks are vendored.

- Repository: `https://github.com/Comfy-Org/workflow_templates`
- Coverage release: `v0.11.18`
- Coverage commit: `8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`
- Previous fixture baseline: release `v0.11.15` at `703fb0b082fdb76331d02232ff67e878e2a6ca6e`
- Catalog index: `templates/index.json`
- Coverage snapshot captured: `2026-07-30`
- Upstream license: MIT

Coverage is commit-specific. Unchanged fixtures retain their prior evidence;
changed workflows are refreshed from the pinned release and revalidated before
remaining covered. The v0.11.18 snapshot keeps all 578 catalog IDs and all 93
active targets fully assessed.

Fixture workflow strings preserve the exact parsed upstream workflow. Their
JSON formatting may be raw, line-ending-normalized, or minified. The manifest's
`source_blob` separately preserves the Git identity of the original upstream
file bytes.

Golden workflows:

- `image_qwen_image_edit_2509.chunks.json`
- `image_qwen_image_edit_2511.chunks.json`
- `flux_fill_inpaint_example.chunks.json`
- `flux_kontext_dev_basic.chunks.json`
- `hidream_i1_full.chunks.json`
- `01_get_started_text_to_image.chunks.json`
- `02_qwen_Image_edit_subgraphed.chunks.json`
- `image_flux2_text_to_image.chunks.json`
- `image_qwen_Image_2512_controlnet.chunks.json`
- `gsc_creator_2_2.chunks.json`
- `gsc_creator_2_3.chunks.json`
- `image_flux2_klein_image_edit_4b_distilled.chunks.json`
- `image_qwen_image_union_control_lora.chunks.json`
- `Image_capybara_v0_1_text_to_image.chunks.json`
- `image_kandinsky5_t2i.chunks.json`
- `image_omnigen2_t2i.chunks.json`
- `image_chroma1_radiance_text_to_image.chunks.json`
- `image_firered_image_edit1_1.chunks.json`
- `image_hidream_o1.chunks.json`
- `image_hidream_o1_dev.chunks.json`
- `image_anima_base_v1.chunks.json`
- `image_anima_preview.chunks.json`
- `image_boogu_image_0_1_edit.chunks.json`
- `flux_depth_lora_example.chunks.json`
- `image_lens_t2i.chunks.json`
- `image_newbieimage_exp0_1-t2i.chunks.json`
- `image_z_image_turbo_fun_union_controlnet.chunks.json`
- `image_longcat_text_to_image.chunks.json`
- `image_pixeldit_t2i.chunks.json`
- `image_chrono_edit_14B.chunks.json`
- `image_netayume_lumina_t2i.chunks.json`
- `image_z_image.chunks.json`
- `template_sugar_coated_gummy_style_qwen.chunks.json`
- `templates-image_to_real.chunks.json`
- `templates-portrait_light_migration.chunks.json`
- `templates_rob_image_to_real.app.chunks.json`
- `templates_rob_portrait_light_migration.app.chunks.json`

Pattern-covered workflows:

- `image_lens_turbo_t2i.chunks.json`: its internal custom-sampler path matches
  Lens, while exact assertions cover its distinct prompt boundary and metadata.

Partial workflows:

- `image_ernie_image.chunks.json`: prompt enhancement is enabled, but the
  selected `TextGenerate` result is not embedded in the workflow.
- `image_ernie_image_turbo.chunks.json`: prompt enhancement is enabled, but the
  selected `TextGenerate` result is not embedded in the workflow.
- `image_krea2_turbo_t2i.chunks.json`: prompt enhancement is enabled, but the
  selected `TextGenerate` result is not embedded in the workflow.
- `image_krea2_turbo_t2i_int8.chunks.json`: prompt enhancement is enabled, but
  the selected `TextGenerate` result is not embedded in the workflow.
- `templates-1_click_multiple_character_angles-v1.0.chunks.json`: eight saved
  outputs have distinct sampler roots, prompts, and seeds that cannot be
  represented by one `ImageMetadata` record.

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

## Offline Catalog Audit

Use a local checkout of the catalog to verify the current pin:

```powershell
pnpm run audit:comfyui-catalog -- --mode verify --catalog-root C:\path\to\workflow_templates
```

Verification requires the checkout commit to match the manifest pin. It checks
all catalog IDs, all 578 original-file Git blob identities, and every dedicated
official-catalog fixture against the parsed upstream workflow.

Before an intentional pin update, compare a candidate checkout without changing
tracked files:

```powershell
pnpm run audit:comfyui-catalog -- --mode diff --catalog-root C:\path\to\workflow_templates
```

Diff mode reports added, removed, changed-targeted, changed-excluded, and stale
fixture entries in stable ID order. Add `--format json` for machine-readable
output. The command is deliberately read-only and is not part of the release
gate because it depends on an external catalog checkout.

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
HiDream O1 workflows were initially classified as partial based on an assumed
`TextGenerate` selection. Milestone 56 supersedes that interpretation with
selected-path diagnostics proving that both workflows choose literal prompt
branches.

## Milestone 34 Published-Catalog Intake

Captured on `2026-07-28` from published release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`. These exact workflow-only
fixtures are intake evidence. They remain `unassessed` until later packages
add exact extraction assertions; the stable-shape test intentionally verifies
only source identity, workflow preservation, normalized node count, and output
selection diagnostics.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`image_krea2_turbo_int8_image_style_reference`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_krea2_turbo_int8_image_style_reference.json) | `9b56eb3fef84084b0fc94d7cb76242fa144fa4ae` | 58544 | 28 |
| [`image_qwen_image_edit_2511_int8`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_qwen_image_edit_2511_int8.json) | `251ffb5115cf8e6ab27b2ebc1038423737f22e72` | 57955 | 27 |
| [`image_ideogram4_t2i_int8`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_ideogram4_t2i_int8.json) | `4e9a71db38bc0c6e09aafba658adb5b06d10c8fa` | 124948 | 46 |
| [`image_anima_lllite_any_control_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_anima_lllite_any_control_to_image.json) | `ef59950bec26fc85e8ad7e2f6cdd2718b830bcc0` | 57479 | 29 |
| [`image_anima_lllite_image_inpainting`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_anima_lllite_image_inpainting.json) | `0fef38f42235bf9a6133f502a3f9611a8a4fdd3e` | 54070 | 28 |
| [`image_anima_lllite_depth_control_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_anima_lllite_depth_control_to_image.json) | `a05af628646ad83c3378fcf5acfa4330dd3647c4` | 68061 | 29 |
| [`image_boogu_image_0_1_edit_int8`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_boogu_image_0_1_edit_int8.json) | `1d9cd1a0f28c76c74ad972c6ffd823aef11e84ea` | 33811 | 18 |
| [`image_z_image_int8`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_z_image_int8.json) | `2dd3f57d9d01e83b10caa16cddba37d356d50e23` | 33334 | 14 |
| [`image_joyai_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_joyai_image_edit.json) | `3d92ffa74ffffa81de5654134fd8afbeb1611e56` | 34878 | 15 |

Every workflow has one active persisted output candidate, one root sampler,
and no output ambiguity. Source-authored expectations, recorded independently
of golden parser assertions:

- `image_krea2_turbo_int8_image_style_reference`: Krea 2 Turbo INT8 ConvRot;
  seed `355028178891957`; 8 steps; CFG 1; `euler` with `simple`; literal prompt
  `a white yeti with horns reading a book that is titled "Ostris + Krea2 Style Reference"`.
  The style-reference LoRA is on the disabled switch branch.
- `image_qwen_image_edit_2511_int8`: Qwen Image Edit 2511 INT8 ConvRot; seed
  `1119496583977398`; 40 steps; CFG 4; `euler` with `simple`; literal edit
  prompt `Convert this image to pop art poster style`. The Lightning LoRA is
  disabled.
- `image_ideogram4_t2i_int8`: Ideogram 4 INT8 ConvRot; seed
  `71584314815009`; selected Default profile with 20 steps; base CFG 7;
  `euler` with the Ideogram 4 scheduler; the exact JSON caption is the literal
  on `CLIPTextEncode` node 24. The unconditional model is auxiliary.
- `image_anima_lllite_any_control_to_image`: Anima Base v1; seed
  `1986030987480`; 30 steps; CFG 4; `euler` with `simple`; exact positive and
  negative literals are on nodes 84 and 82. The selected model path applies
  `anima-lllite-any-test-like-v2.safetensors`; turbo is disabled.
- `image_anima_lllite_image_inpainting`: Anima Base v1; seed
  `1376514088921`; the active turbo branch selects 8 steps and CFG 1 with
  `euler`/`simple`; positive prompt `girl with red eyes`; the selected model
  patch is `anima-lllite-inpainting-v2.safetensors` and the active LoRA is
  `anima-turbo-lora-v0.2.safetensors`.
- `image_anima_lllite_depth_control_to_image`: Anima Base v1; seed
  `520254185749746`; 30 steps; CFG 4; `euler` with `simple`; exact positive and
  negative literals are on nodes 84 and 82. The selected model path applies
  `anima-lllite-depth-1.safetensors`; turbo is disabled.
- `image_boogu_image_0_1_edit_int8`: Boogu Image Edit INT8 ConvRot; seed 22;
  25 steps; CFG 3.5; `dpmpp_2m` with `simple`; literal edit prompt `Keep the
  character unchanged, replace the desert background and scene. The model is
  on the dune.`
- `image_z_image_int8`: Z-Image INT8 ConvRot; seed `677498465340151`; 25
  steps; CFG 4; `res_multistep` with `simple`; exact positive literal is on
  node 67 and negative conditioning is empty.
- `image_joyai_image_edit`: JoyAI Image Edit INT8 ConvRot; seed 42; 40 steps;
  CFG 4; `euler` with `normal`; literal edit prompt `Change the background to
  a glacial scene.` and empty negative conditioning.

## Milestone 35 v0.11.15 Golden Batch

The exact v0.11.15 Krea style-reference, Qwen 2511 INT8, Ideogram 4 INT8,
Boogu Edit INT8, Z-Image INT8, and JoyAI workflows are golden coverage. Each
has one active persisted output and one root sampler, and all populated core
fields are sourced from `SamplerTraversal`. Disabled LoRA branches and the
Ideogram unconditional model remain excluded from selected-path metadata.

The three Anima LLLite workflows are golden coverage. Ambit classifies a
`ModelPatchLoader` reached through the selected `AnimaLLLiteApply` model path
as a ControlNet resource, matching the existing Z-Image and Qwen model-patch
policy. Generic and disconnected model-patch loaders remain unclassified.

Milestone 36 records exact Anima Base model, sampler, prompt, LoRA, and LLLite
resource metadata for the any-control, inpainting, and depth workflows. All
populated fields use `SamplerTraversal`; each workflow has one active saved
output, one root sampler, and no ambiguity.

## Milestone 37 v0.11.15 Selected-Path Revalidation

The Capybara text-to-image and image-edit, Boogu edit and turbo, and Lens base
and turbo workflows now use their exact `v0.11.15` bytes. Their selected model,
sampler, conditioning, and saved-output paths remain supported without parser
changes. Boogu Edit adds one normalized documentation node, raising its graph
count from 17 to 18 without changing extracted generation metadata.

All six workflows have one active persisted output, one root sampler, no
ambiguity, and no selected resources. The five directly asserted workflows are
golden; Lens Turbo remains pattern-covered by its structural comparison with
the Lens base selected path.

## Milestone 38 v0.11.15 Anima Revalidation

Captured on `2026-07-29` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`image_anima_base_v1`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_anima_base_v1.json) | `f572962bfa4aaecd0ee7721df58b03d684c11c9d` | 42714 | 20 |
| [`image_anima_preview`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_anima_preview.json) | `f0bf84c0e8e9c0b2dc4634371626d8ae288fb289` | 28174 | 10 |

Anima Base now uses switch-selected base and turbo branches for its model,
steps, and CFG. Its published instance selects the base model, 30 steps, CFG 4,
and `euler` with `simple`; the turbo LoRA is not on the selected path. Anima
Preview retains its independent 30-step `er_sde` path. Both workflows are exact
goldens with one saved output, one root sampler, no ambiguity, and
`SamplerTraversal` provenance for every populated metadata field.

## Milestone 39 v0.11.15 Flux.2 Revalidation

Captured on `2026-07-29` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`image_flux2`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_flux2.json) | `9a287d49f685916349fff6bae6bc685f322f23ef` | 57237 | 25 |
| [`image_flux2_klein_image_edit_4b_base`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_flux2_klein_image_edit_4b_base.json) | `39e7de94ac24e08dc153248f36dc91cbc9bc26a1` | 98449 | 24 |
| [`image_flux2_klein_image_edit_9b_base`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_flux2_klein_image_edit_9b_base.json) | `af8f73e22d92467d11ac8ed609b8ada906b9bfdf` | 97897 | 24 |
| [`image_flux2_klein_image_edit_9b_distilled`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_flux2_klein_image_edit_9b_distilled.json) | `0b2a11b1f2f8218897fcfe91d48f786a00b7ef93` | 99879 | 24 |
| [`image_flux2_text_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_flux2_text_to_image.json) | `bb7d4e5be6f379834e7c6ee563dd58687fc78dad` | 49075 | 20 |
| [`image_flux2_text_to_image_9b`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_flux2_text_to_image_9b.json) | `cc97272e7f37e2102eb8157416f39adaf63fc838` | 39788 | 17 |

The release updates only informational `MarkdownNote` text in these six
workflows. Their parser-relevant nodes, links, widgets, and subgraph interfaces
match the previously asserted selected paths. Each remains an exact golden with
one saved output, one root sampler, no ambiguity, no selected resources, and
`SamplerTraversal` provenance for every populated generation field.

## Milestone 40 v0.11.15 Qwen Revalidation

Captured on `2026-07-29` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`image_qwen_Image_2512`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_qwen_Image_2512.json) | `4e46879b51bd266d513fdb5429bb9b52448e0bb1` | 52251 | 21 |
| [`image_qwen_Image_2512_controlnet`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_qwen_Image_2512_controlnet.json) | `689d1a76fc42f37db926af1055860617a08bebf4` | 62531 | 30 |
| [`image_qwen_image_2512_with_2steps_lora`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_qwen_image_2512_with_2steps_lora.json) | `c4214781ab66852199b88bbfe98e5f564004b4fa` | 18099 | 13 |
| [`image-qwen_image_edit_2511_lora_inflation`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image-qwen_image_edit_2511_lora_inflation.json) | `4cb616f9532b188bf15134808ff6e29c8bc8ace9` | 40858 | 20 |

Only informational `MarkdownNote` widget text changed in these four workflows.
Their parser-relevant nodes, links, widgets, and subgraph interfaces remain
identical to the historical fixtures. Existing exact model, sampler, prompt,
resource, output, and provenance assertions therefore remain authoritative.

Milestone 40 did not include `image_qwen_image_edit_2509` or
`image_qwen_image_edit_2511`: their v0.11.15 workflows contain structural graph
changes and remained unassessed pending the independent review below.

## Milestone 41 v0.11.15 Qwen Edit Revalidation

Captured on `2026-07-29` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`image_qwen_image_edit_2509`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_qwen_image_edit_2509.json) | `522c66b253bc74333b8791e02296407a510c2295` | 53036 | 24 |
| [`image_qwen_image_edit_2511`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_qwen_image_edit_2511.json) | `f439d8f10c247ae856d1aa4c4e7e37e55c6d2f94` | 59130 | 28 |

Qwen Edit 2509 now packages one four-step Lightning path inside a single
workflow subgraph. Its selected path keeps the Qwen 2509 FP8 model and edit
prompt, uses seed `362225868152841`, and reports the active Lightning LoRA.

Qwen Edit 2511 now selects `qwen_image_edit_2511_fp8mixed` with seed
`677909188488042`; turbo remains disabled, so the 40-step CFG 4 base path is
authoritative and the Lightning LoRA is omitted. Both workflows have one
saved output, one root sampler, no ambiguity, and exact `SamplerTraversal`
provenance without parser changes.

## Milestone 42 v0.11.15 Getting Started Revalidation

Captured on `2026-07-29` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`gsl_creator_2`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/gsl_creator_2.json) | `f7f46f0e04d0c2c3d58ad4b094525dce898d4ca0` | 56051 | 26 |
| [`gsl_starter_1_1`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/gsl_starter_1_1.json) | `68e7933294af216c41c1218f5e6303f80f81ccd4` | 17707 | 15 |

`gsl_creator_2` selects the Z-Image inpaint subgraph with its literal prompt
and model-patch ControlNet. `gsl_starter_1_1` is a standard SD1.5 workflow with
exact positive and negative conditioning. Both published workflows differ
from the previous catalog only in informational note text, and both retain one
saved output, one root sampler, and `SamplerTraversal` provenance without
parser changes.

## Milestone 43 v0.11.15 Semantic-Preserving Revalidation

Captured on `2026-07-29` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`image_ernie_image`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_ernie_image.json) | `4b841c64cd1742dced75614e4b51747ee13adcaf` | 54571 | 22 |
| [`image_firered_image_edit1_1`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_firered_image_edit1_1.json) | `19e4e5ea3489a781be917056dd33d07942bd7e09` | 56233 | 23 |
| [`image_hidream_o1`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_hidream_o1.json) | `3f64d3feb9b39c301be81e5e5d7ddc7d7f267042` | 66237 | 41 |
| [`image_hidream_o1_dev`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_hidream_o1_dev.json) | `cdd77698d6cb5dafb6e43c3fbb2e12375809a9dc` | 64751 | 40 |
| [`image_ideogram4_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_ideogram4_t2i.json) | `9c016c249246439ccc08ccffbab31d04e54673cb` | 119252 | 42 |
| [`image_longcat_image_edit`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_longcat_image_edit.json) | `e15d90ae587724f429a6c223194f1b21404922a6` | 35104 | 18 |
| [`image_longcat_text_to_image`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_longcat_text_to_image.json) | `68749b8b2f45c580fd2f019d49ae2313fc655b14` | 32268 | 15 |
| [`image_pixeldit_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_pixeldit_t2i.json) | `61d7236d058ddbcf921b544ffdfcf6afe7108cda` | 28973 | 12 |
| [`image_z_image_turbo_int8`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_z_image_turbo_int8.json) | `61bb66e258200a92db5626bb519d317e047807f4` | 28029 | 11 |
| [`video_bernini_r_image_editing`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/video_bernini_r_image_editing.json) | `ca3d1c2a1981faa2322ae98ee0bfa85995b379c2` | 98067 | 45 |

The release changes only informational notes or visual workflow serialization
for these ten fixtures. FireRed, Ideogram, LongCat, PixelDiT, Z-Image INT8,
and Bernini retain exact golden metadata. ERNIE Image remains partial because
its generated prompt result is not embedded. The HiDream O1 classification in
this historical section is superseded by Milestone 56. Every fixture has
one saved output, one root sampler, no ambiguity, and unchanged selected-path
provenance.

## Milestone 44 v0.11.15 Catalog Closure

Captured on `2026-07-29` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`image_ernie_image_turbo`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_ernie_image_turbo.json) | `07b3e3bb3a7ef9ba9ce012fe8a83b1175e70f2ac` | 52770 | 21 |
| [`image_krea2_turbo_t2i`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_krea2_turbo_t2i.json) | `b63db4754f99c506b66263750498cf633789ee48` | 57124 | 25 |
| [`image_krea2_turbo_t2i_int8`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_krea2_turbo_t2i_int8.json) | `a4fb56cfcf541204aa87cc02462fd78ce3090eb8` | 57015 | 25 |
| [`image_z_image`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/image_z_image.json) | `97cfc42585f59bbe43139e2fea4c5a6530240592` | 33896 | 14 |

ERNIE Turbo and both Krea Turbo workflows select `TextGenerate` through their
connected boolean controls. The visible literal text is input to that generator,
not the final prompt used for conditioning, and the generated result is not
embedded. These fixtures are therefore partial and assert an unavailable
positive prompt without provenance. Z-Image is golden and saves through
`SaveImageAdvanced`, which the generalized save-node policy resolves to its
single root sampler.

All four workflows have one saved output, one root sampler, and no ambiguity.
Available generation fields retain `SamplerTraversal` provenance. This closes
the v0.11.15 active catalog target honestly without parser changes.

## Milestone 45 Official Image Use-Case Expansion

Captured on `2026-07-30` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`template_qwen_Image_2512_360_lora`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/template_qwen_Image_2512_360_lora.json) | `80e423a1f68544e703c6211a8b1796268b946fe4` | 58351 | 26 |
| [`template_qwen_image_edit_2511_systms_action`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/template_qwen_image_edit_2511_systms_action.json) | `5150867d119e05bb2de5bf2695f6f0627507b702` | 57407 | 27 |
| [`template_qwen_image_illustration_lora`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/template_qwen_image_illustration_lora.json) | `1a3ab15e43ac980bc93b6934aae74c3f200f01c3` | 35226 | 12 |

These official `Use Cases` workflows exercise Qwen 2512 panorama generation,
Qwen Edit 2511 with two selected LoRAs, and Qwen illustration styling. Each
workflow expands one subgraph into one saved-output root with exact
`SamplerTraversal` provenance. The optional Lightning branch in the panorama
workflow remains disabled, while both selected LoRAs in the action workflow
are reported.

The manifest now separately targets nine open-source, core-node, image-only
official use cases. The remaining six were assessed in milestone 46 rather
than inferred from model-family similarity.

## Milestone 46 Official Image Use-Case Closure

Captured on `2026-07-30` from release `v0.11.15` at commit
`703fb0b082fdb76331d02232ff67e878e2a6ca6e`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| [`template_sugar_coated_gummy_style_qwen`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/template_sugar_coated_gummy_style_qwen.json) | `36d8c3fc581dbe444ab38f39b82ceec770ef968e` | 33908 | 15 |
| [`templates-1_click_multiple_character_angles-v1.0`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/templates-1_click_multiple_character_angles-v1.0.json) | `65342f0c439959c17c2a93035769214faa8689f9` | 467187 | 202 |
| [`templates-image_to_real`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/templates-image_to_real.json) | `f9f24a85aa745c1ee8bad8975853a58f4dbf3808` | 32625 | 15 |
| [`templates-portrait_light_migration`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/templates-portrait_light_migration.json) | `416905e6af115ce68e68ca3791f03681be8dc4ec` | 59820 | 27 |
| [`templates_rob_image_to_real.app`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/templates_rob_image_to_real.app.json) | `178a045d6ace46ce8e154904ff6afd91c463d6a1` | 60211 | 26 |
| [`templates_rob_portrait_light_migration.app`](https://github.com/Comfy-Org/workflow_templates/blob/703fb0b082fdb76331d02232ff67e878e2a6ca6e/templates/templates_rob_portrait_light_migration.app.json) | `fb8881c12142ba715f8471fd53c31c29069f0925` | 59590 | 28 |

Five workflows have one unambiguous saved-output root and exact
`SamplerTraversal` metadata. They cover Qwen gummy styling, image-to-real
conversion, and two portrait relighting variants while correctly omitting
disabled Lightning LoRAs.

The multiple-angle workflow intentionally remains partial. It expands to eight
saved outputs with eight distinct sampler roots and different prompts and
seeds. The parser therefore withholds strong traversal authority and exposes
only deterministic `SamplerFallback` metadata. Representing every output would
require a multi-output metadata shape rather than a parser heuristic.

This closes assessment of all 93 targeted workflows at 80 golden, 5
pattern-covered, 8 partial, and 0 unassessed without changing parser version
37.

## Milestone 53 v0.11.18 Delta Revalidation

Captured on `2026-07-30` from release `v0.11.18` at commit
`8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`.

| Workflow | Upstream Git blob | Bytes | Nodes |
| --- | --- | ---: | ---: |
| `02_qwen_Image_edit_subgraphed` | `623899adee1aee1c59508fd70c6de3fea407fe18` | 42878 | 17 |
| `Image_capybara_v0_1_image_edit` | `dce38e01ff6a905881b2287cf0d3bdb2b4be6b32` | 49691 | 22 |
| `Image_capybara_v0_1_text_to_image` | `7a5c3974e1cab90c902d38e12774bc77be397478` | 37235 | 17 |
| `flux1_dev_uso_reference_image_gen` | `75e27ca4085912c0121d23c7c400b02e7e1e6d3b` | 126526 | 26 |
| `gsc_creator_2_2` | `6b1ee67a75bdb91812d16268d713ddb56b7f0234` | 43444 | 32 |
| `image-qwen_image_edit_2511_lora_inflation` | `c6a68adddae123ec23bd49aa2f96856fe5e8849e` | 46260 | 20 |
| `image_flux2_klein_text_to_image` | `1742589ef5a7707fe3369af2fc72a08b8144284e` | 72346 | 19 |
| `image_kandinsky5_t2i` | `47bd7fd5c6b1d6d6d6e877b118fda006538f5be7` | 29030 | 11 |
| `image_longcat_text_to_image` | `d7d9b733b6b0c642819157d176c265477111beba` | 32648 | 15 |
| `image_newbieimage_exp0_1-t2i` | `6044ee8e1cfef4b5588222d68423cd574fdab471` | 38312 | 17 |
| `image_qwen_Image_2512_controlnet` | `411fb4856946c94105a4916b964f5e0953694ce7` | 64216 | 30 |
| `gsl_starter_1_3` | `abacfac6dbf27b831f515cf9dc052c00168834c6` | 67493 | 8 |

Eleven refreshed golden workflows retain their exact selected-path metadata.
The Qwen Getting Started template now serializes instance widget values without
`proxyWidgets`; normalization maps those values through widget-backed definition
inputs, so its selected seed remains traversal-derived. `gsl_starter_1_3` is
vendored as pattern evidence: its generator is bypassed, leaving one save
candidate but no root sampler or strong scalar/prompt provenance.

The manifest remains 80 golden, 5 pattern-covered, 8 partial, 485 excluded,
and 0 unassessed. Parser version 42 covers the modern instance-widget behavior.

## Milestone 56 Partial-Coverage Diagnostic Contracts

Validated on `2026-08-01` against the pinned `v0.11.18` catalog snapshot.

- `image_ernie_image`, `image_ernie_image_turbo`,
  `image_krea2_turbo_t2i`, and `image_krea2_turbo_t2i_int8` each have one
  selected output root and one exact `positive_prompt` blocker at their
  selected `TextGenerate.text` path. Their generated values remain unavailable
  without fabricating prompt metadata.
- `templates-1_click_multiple_character_angles-v1.0` has eight saved outputs
  and eight root samplers. Diagnostics report ambiguity and intentionally do
  not speculate about field blockers.
- `gsc_creator_2_3` has one saved-output root whose sampler uses the literal
  `masterpiece, 8k` definition prompt. Florence captioning is preview-only and
  disconnected, so the workflow is golden rather than partial.
- `image_hidream_o1` and `image_hidream_o1_dev` select literal prompt branches
  through conditioning and string `ComfySwitchNode` nodes. Strict conditioning
  switch traversal now extracts those prompts with `SamplerTraversal`
  provenance; inactive `TextGenerate` branches do not create blockers.
- The current `templates-image_to_real` fixture identity is
  `6c3a5dd627de6f8046b1a1f89867b435ae02882d` (39,450 bytes), matching the
  pinned v0.11.18 fixture and manifest rather than the older v0.11.15 blob.

The active target now contains 83 golden, 5 pattern-covered, 5 partial, 485
excluded, and 0 unassessed workflows. Parser version 43 covers the narrow
conditioning-switch extraction correction.

## Milestone 57 Active-Target Fixture Closure

Validated on `2026-08-01` against release `v0.11.18` at commit
`8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`.

| Workflow | Upstream Git blob | Bytes | Normalized nodes |
| --- | --- | ---: | ---: |
| `default` | `53abcfc4060472fad63722f9aa0d52ea8b5e0ac9` | 11463 | 11 |
| `gsc_creator_2_1` | `de03243dd2bf5f0f6eb216dc14f2cc7a5e052d33` | 19454 | 18 |
| `gsc_starter_1` | `a8c0ce81211cf16d2654a857964942dd88130ac6` | 28646 | 13 |

`default` and `gsc_creator_2_1` have one saved-output root and exact
`SamplerTraversal` metadata, so direct fixture evidence replaces their earlier
representative pattern claims. `image_lens_turbo_t2i` is likewise golden: its
dedicated fixture already asserts exact metadata and structural equivalence to
the supported Lens selected path.

`gsc_starter_1` intentionally ships with its generation subgraph disconnected
from `SaveImage`. Its direct contract reports zero output candidates and roots,
retains only deterministic `SamplerFallback` metadata, and never grants strong
traversal authority. Together with the bypassed `gsl_starter_1_3` contract,
this leaves two honest pattern-covered tutorial workflows.

All 93 active targets now have dedicated official-catalog fixtures. The active
target contains 86 golden, 2 pattern-covered, 5 partial, 485 excluded, and 0
unassessed workflows. Parser version remains 43 because this milestone changes
coverage evidence rather than extraction behavior.

## Milestone 58 Extended Official Image Coverage

Validated on `2026-08-01` against release `v0.11.18` at commit
`8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`.

| Workflow | Upstream Git blob | Bytes | Normalized nodes |
| --- | --- | ---: | ---: |
| `templates-qwen_image_edit-crop_and_stitch-fusion` | `daaf07ff45657ba39e301682d2b3980c1294af86` | 61203 | 25 |
| `templates_doc_workbox_klein_9b_image_extend` | `61f73aa5d9889982f55ff6084eb4abed5f6b9b24` | 37947 | 24 |
| `templates_text_prompt_to_360hdr.app` | `9a989eef6e613051ee24374069a68847381caac9` | 37317 | 24 |
| `utility_z_image_turbo_2k_upscaler.app` | `6d4ec0ed208e8545aedd0b2652fb38192f12c994` | 36015 | 19 |

These workflows intentionally sit outside the original 93-workflow core
target: three are utility or custom-node use cases and one is a core-node
utility. They now use the separate `target_extended_image` scope so broader
official image coverage remains measurable without changing the core target's
definition.

All four have one unambiguous saved-output root and exact `SamplerTraversal`
contracts. The Qwen crop-and-stitch workflow reports only its enabled Fusion
LoRA; its disabled Lightning branch is omitted. The Flux 2 Klein outpainting
workflow recovers scheduler steps without inventing a scheduler label. The
360 HDR workflow reports its selected Qwen 360 LoRA. The Z-Image upscale
workflow keeps the diffusion model primary and does not promote RealESRGAN to
`ImageMetadata.model`.

The manifest now contains 93 core targets, 4 extended image targets, and 481
excluded entries: 90 golden, 2 pattern-covered, 5 partial, and 0 unassessed.
Parser version remains 43 because no extraction behavior changed.

## Milestone 59 Core Transform Coverage

Validated on `2026-08-01` against release `v0.11.18` at commit
`8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`.

| Workflow | Upstream Git blob | Bytes | Normalized nodes |
| --- | --- | ---: | ---: |
| `image_lotus_depth_v1_1` | `3890caa916452a60910a6a35a8934b61cb6eb6dd` | 30848 | 15 |
| `image_qwen_image_layered` | `b223427ea084d44ee4281eff75f55b3f93a11410` | 78903 | 22 |
| `image_qwen_image_layered_control` | `066f16b82dfc00eddafe06d2c8db5735e1dc595c` | 43155 | 20 |
| `utility_pid_latent_upscale_dit` | `645c89ddb3ba91f6d5da5e69b73dba887d82d338` | 67084 | 26 |

All four workflows are workflow-only goldens with one unambiguous saved-output
root. The Lotus depth workflow requires connected `SamplerCustomAdvanced`
traversal to pass through `SetFirstSigma` before reaching `BasicScheduler`;
the wrapper's own widget is not sampler metadata. The two Qwen Layered
workflows retain exact prompt and sampler contracts. The PiD utility reports
the final saved PiD upscale stage rather than the upstream image-generation
stage.

The manifest now contains 93 core targets, 8 extended image targets, and 477
excluded entries: 94 golden, 2 pattern-covered, 5 partial, and 0 unassessed.
Parser version 44 covers the narrow `SetFirstSigma` traversal behavior.

## Milestone 60 Upscale Utility Coverage

Validated on `2026-08-01` against release `v0.11.18` at commit
`8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`.

| Workflow | Upstream Git blob | Bytes | Normalized nodes |
| --- | --- | ---: | ---: |
| `utility_image_upscale_supir` | `8a8e8ab0b24fc80fa4df1a8ac704f4c4203c0653` | 65187 | 25 |
| `utility_seedvr2_3b_int8_upscale_image` | `c41a0ca230497db90dc97168980cc4d2a914fbf6` | 31293 | 14 |
| `utility_seedvr2_7b_int8_upscale_image` | `8b185fd6994fc6e62aad0e2187dcb381c5c03606` | 31389 | 14 |
| `utility_interpolation_image_upscale` | `db67b8baec0cc27c41d6f083cec2dd11099f05fa` | 4256 | 5 |

The two SeedVR2 variants are exact one-step upscale goldens. The interpolation
workflow is a non-generative golden control: it has one persisted output but no
sampler root, so generation fields remain unavailable without fabricated
provenance.

SUPIR expands one modern singleton-output subgraph into one trusted sampler
root. Its selected checkpoint, seed, steps, CFG, sampler, and negative prompt
are exact `SamplerTraversal` values. Its positive prompt remains unavailable
because the selected `TextGenerate` caption result is not embedded in workflow
metadata, so the fixture is intentionally partial. Parser version 45 covers
singleton object output boundaries and deduplicates identical SDXL text lanes.

The manifest now contains 93 core targets, 12 extended image targets, and 473
excluded entries: 97 golden, 2 pattern-covered, 6 partial, and 0 unassessed.

## Milestone 61 Non-Generative Utility Coverage

Validated on `2026-08-01` against release `v0.11.18` at commit
`8f6709b8f6ef808b0eccc47eff28ada4a58adbbe`.

| Workflow | Upstream Git blob | Bytes | Normalized nodes |
| --- | --- | ---: | ---: |
| `utility_birefnet_remove_background` | `31c25593f87170ced962316ab8747463b70c1410` | 13599 | 8 |
| `utility_depth_anything3_image_depth_estimation` | `0fe0818e15bda7713f1a33464763a5188e87877e` | 20060 | 8 |
| `utility_image_segment_sam3` | `6ebf2d63547302a223d9f7bc4989c44d02675696` | 23454 | 9 |
| `utility_sdpose_ood_image_to_pose` | `dee20246e40fcb32e2cde5e4ab801da1ffcaf9a2` | 35611 | 7 |

All four workflows produce images without a generation sampler. Their golden
contracts preserve the workflow while leaving model, prompt, seed, steps, CFG,
sampler, and resources unavailable. In particular, SAM3's selector prompt and
checkpoint and SDPose's pose-estimation checkpoint are not generation metadata.

Selected sampler-less outputs now suppress `SamplerFallback` and `GlobalScan`
only when the authored prompt/workflow contains no sampler definition. Cached
API prompts under workflow `extra` are ignored for this decision, while
disconnected and bypassed generation workflows retain their established recovery
behavior. Parser version 46 covers this narrower fallback policy.

The manifest now contains 93 core targets, 16 extended image targets, and 469
excluded entries: 101 golden, 2 pattern-covered, 6 partial, and 0 unassessed.
