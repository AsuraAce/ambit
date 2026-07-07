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

Extraction date: 2026-07-07.
