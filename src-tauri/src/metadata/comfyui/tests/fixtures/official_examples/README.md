# Official ComfyUI Example Fixtures

These fixtures are vendored metadata chunks extracted from official ComfyUI example images.
They intentionally store only `prompt` and `workflow` chunks, not the original images.

Upstream repository: https://github.com/comfyanonymous/ComfyUI_examples
Upstream commit: f9431bb000ce792094ff345446e22cac1ea6cef3
Extracted on: 2026-07-05 and 2026-07-06

Source images:

- `sdxl/sdxl_simple_example.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/sdxl/sdxl_simple_example.png
- `flux/flux_dev_example.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/flux/flux_dev_example.png
- `qwen_image/qwen_image_basic_example.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/qwen_image/qwen_image_basic_example.png
- `lora/lora_multiple.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/lora/lora_multiple.png
- `controlnet/controlnet_example.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/controlnet/controlnet_example.png
- `img2img/img2img_workflow.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/img2img/img2img_workflow.png
- `inpaint/inpaint_example.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/inpaint/inpaint_example.png
- `textual_inversion_embeddings/embedding_example.chunks.json`: https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/f9431bb000ce792094ff345446e22cac1ea6cef3/textual_inversion_embeddings/embedding_example.png

Tests must run offline against these vendored chunks. Refresh fixtures only as an intentional parser-fixture update.
