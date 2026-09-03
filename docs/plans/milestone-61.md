# Milestone 61: Non-Generative ComfyUI Utility Coverage

Status: Complete

## Outcome

Official image utilities that save or preview processed images without a
generation sampler must preserve their workflow without inventing model, prompt,
or sampler metadata from utility nodes.

## Acceptance

- Vendor exact workflow-only fixtures for BiRefNet background removal, Depth
  Anything 3 estimation, SAM3 segmentation, and SDPose pose estimation from the
  pinned v0.11.18 catalog.
- Assert exact normalized graph and output diagnostics with no generation fields
  or weak field provenance.
- Skip sampler/global fallback only for selected outputs whose authored workflow
  contains no sampler definition.
- Preserve flat parameters, explicit metadata, graph fragments, and bypassed or
  disconnected generation-workflow recovery.
- Advance parser version from 45 to 46 and keep the accumulated stack unmerged.

## Verification

- Focused false-positive and official-catalog tests passed, including four new
  non-generative utility goldens.
- Manifest schema/count and pinned Git blob identity validation passed.
- Path parity passed across 109 official and 21 real-world fixtures.
- The full 425-test ComfyUI suite and 10-test reparse suite passed.
- `cargo fmt --check` and `git diff --check` passed.
