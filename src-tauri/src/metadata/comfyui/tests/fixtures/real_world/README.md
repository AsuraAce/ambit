# Real-World ComfyUI Fixture Chunks

These fixtures cover user-style ComfyUI workflows that are already represented
by in-repo regression tests. They are minimized by hand to keep the exact parser
shape under test while avoiding private paths, generated images, and full
workflow bloat.

Rules:

- Store only `prompt` and/or `workflow` chunks.
- Do not vendor PNG, WebP, or other image files.
- Keep assertions exact when a field has a deterministic expected value.
- Add parser fixes only for narrow local gaps proven by a fixture.
- Bump `CURRENT_PARSER_VERSION` only when parser output changes.

Initial fixture sources:

- `sdprompt_saver_setnode.chunks.json`: derived from
  `test_workflow_repro.rs`, covering UI-format SetNode/GetNode plus
  SDParameterGenerator and SDPromptSaver metadata patterns.
- `stylealigned_ui.chunks.json`: derived from `ui_format.rs`, covering
  StyleAligned UI-format traversal.
- `nsp_controlnet.chunks.json`: derived from `complex_workflows.rs`, covering
  CLIPTextEncode (NSP), LoRA, and ControlNet traversal.
- `dual_ip_adapter.chunks.json`: derived from `repro_dual_ip_adapter.rs`,
  covering chained IP-Adapter and LoRA model traversal.
- `prompt_composition.chunks.json`: derived from `prompts.rs`, covering
  JoinStringMulti, TriggerWord Toggle, LoraManager, and smZ prompt extraction.
- `krea2_turbo_official_template.chunks.json`: exact `prompt` and `workflow`
  chunks extracted from user-provided image
  `D:\AI\art\webUI\comfyUI\output\Krea2_turbo_00716_.png`, generated with
  the official Krea v2 turbo ComfyUI template. Covers nested template node IDs,
  ComfySwitchNode, StringConcatenate, PreviewAny, and Krea conditioning
  traversal.
- `format_parity_jpeg_flat.chunks.json`: exact flat `parameters` chunk
  extracted from user-provided JPEG
  `D:\AI\art\webUI\comfyUI\output\2026-07-08-153627_0.jpeg`, generated via
  `Save Image w/Metadata`. Covers EXIF-only ComfyUI metadata with stale saver
  defaults.
- `format_parity_webp_flat.chunks.json`: exact flat `parameters` chunk
  extracted from user-provided WebP
  `D:\AI\art\webUI\comfyUI\output\2026-07-08-153754_0.webp`, generated via
  `Save Image w/Metadata`. Covers the matching WebP EXIF-only path.
- `format_parity_png_save_metadata.chunks.json`: exact `parameters`, `prompt`,
  and `workflow` chunks extracted from user-provided PNG
  `D:\AI\art\webUI\comfyUI\output\2026-07-08-153346_0.png`, generated via
  `Save Image w/Metadata`. Covers graph traversal overriding stale flat saver
  metadata.
- `krea2_turbo_regular_saveimage.chunks.json`: exact `prompt` and `workflow`
  chunks extracted from user-provided PNG
  `D:\AI\art\webUI\comfyUI\output\Krea2_turbo_00719_.png`, generated via the
  regular ComfyUI `SaveImage` node. Covers the same Krea template path without
  the metadata saver node.
- `issue_1024_sdprompt_saver.chunks.json`: minimized from
  `repro_issue_1024.rs`, covering mixed flat parameters, an `SDPromptSaver`
  output path, stale sentinel prompts, and graph-derived steps and prompt text.
- `inspire_faceid_resources.chunks.json`: minimized from
  `repro_ip_adapter.rs`, covering exact `KSampler //Inspire` widgets plus
  FaceID LoRA and ControlNet collection on a workflow fragment without a save
  output.
- `smz_concat_setget.chunks.json`: minimized from `repro_smz_concat.rs`,
  covering SetNode/GetNode model resolution, smZ prompt encoders, and
  conditioning concatenation.
- `prompts_everywhere_broadcast.chunks.json`: minimized from
  `repro_smz_concat.rs`, covering role-aware positive and negative routing for
  the two `Prompts Everywhere` conditioning inputs.
- `anything_everywhere_broadcaster_loop.chunks.json`: minimized from
  `repro_smz_concat.rs`, covering a disconnected generic broadcaster that must
  terminate without fabricating prompt metadata.
- `placeholder_saver_prompt_precedence.chunks.json`: minimized from
  `repro_smz_concat.rs`, covering a valid graph prompt overriding flat and
  saver-node `undefined` placeholders while flat steps remain available.
- `placeholder_positive_valid_negative.chunks.json`: minimized from
  `repro_smz_concat.rs`, covering role-correct negative conditioning plus a
  deterministic positive fallback when the connected value is a placeholder.
- `loader_only_unet_gguf_fallback.chunks.json`: minimized from
  `subgraph_repro.rs`, covering deterministic weak model fallback when a
  disconnected sampler and competing UNET/GGUF loaders are present.
- `loader_only_gguf_fallback.chunks.json`: minimized from `subgraph_repro.rs`,
  covering suffix-free GGUF global model recovery without a sampler or saved
  output.
- `connected_gguf_sampler.chunks.json`: minimized workflow-only coverage for a
  saved-output `KSampler` path connected to `UnetLoaderGGUF`, proving GGUF
  model extraction receives `SamplerTraversal` provenance.
- `use_everywhere_v7_resolved_links.chunks.json`: exact workflow-only fixture
  from the upstream cg-use-everywhere `docs/UE_example.json` example. It covers
  version 7.0.1 persisted `extra.ue_links` reconstruction for model, VAE, CLIP,
  and conditioning inputs without simulating Use Everywhere matching rules.
  Source: https://github.com/chrisgoringe/cg-use-everywhere/blob/main/docs/UE_example.json
  Plugin commit recorded by the workflow:
  `98286cadb33486c27d87759f24b4813bbbda8799`.

Extraction dates:

- 2026-07-07: initial real-world fixture batch.
- 2026-07-08: Krea/format-parity fixtures from user-provided local images.
- 2026-07-30: additional in-repo user/repro fixture batch.
- 2026-07-30: connected GGUF saved-output fixture.
- 2026-07-30: upstream cg-use-everywhere 7.0.1 resolved-link fixture.
