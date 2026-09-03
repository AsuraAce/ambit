# Milestone 56: ComfyUI Partial-Coverage Diagnostic Contracts

Status: Complete

## Outcome

Turn every remaining partial workflow into an evidence-backed contract: either
an exact selected-path blocker or an explicit output-selection ambiguity. Fix
stale classifications when diagnostics prove that the saved sampler uses a
literal prompt instead.

## Acceptance Criteria

- Align the `templates-image_to_real` intake assertion with the current pinned
  v0.11.18 fixture identity.
- For ERNIE Image, ERNIE Turbo, Krea 2 Turbo, and Krea 2 Turbo INT8, report one
  exact unavailable generated-value blocker on the selected positive-prompt
  path and preserve exact available metadata.
- For the multiple-character-angle workflow, report eight outputs, eight root
  samplers, and ambiguity without speculative traversal blockers.
- Prove that GSC diffusion upscale uses its literal sampler prompt and promote
  it from partial to golden.
- Follow strict selected branches through conditioning `ComfySwitchNode` nodes;
  promote both HiDream O1 workflows when their literal prompts are recovered.
- Keep generated or inactive branches from fabricating prompt metadata or
  diagnostics.
- Recompute manifest totals from entry states and retain all 93 active targets
  as assessed.

## Non-Goals

- Do not execute generated-text nodes or infer their unavailable outputs.
- Do not change `ImageMetadata`, diagnostics DTOs, bindings, database schema,
  frontend behavior, or raw fixture data.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Exact diagnostics contracts cover four generated-prompt partials, GSC,
  HiDream O1, HiDream O1 Dev, and the ambiguous multiple-output workflow.
- A synthetic regression proves that a conditioning switch follows only its
  selected CLIP branch and retains `SamplerTraversal` provenance.
- Official catalog, manifest, intake, ComfyUI, reparse, audit, formatting, and
  diff-hygiene gates pass.
- Parser version 43 reparses affected HiDream workflows once the accumulated
  stack is eventually released.
