# Milestone 55: ComfyUI Traversal Blocker Diagnostics

Status: Complete

## Outcome

Make the existing Developer Mode ComfyUI diagnostics explain why fields could
not be resolved from the uniquely selected saved-output path without changing
metadata extraction behavior.

## Acceptance Criteria

- Report selected output count, unique root sampler count, and ambiguity.
- Report bounded, deterministic field blockers for unresolved links, missing
  nodes, unsupported nodes, unavailable generated values, cycles, and depth
  limits.
- Trace blockers only for a unique selected output root; ambiguous workflows
  receive output-selection facts without speculative field blockers.
- Treat intentional empty conditioning, including `ConditioningZeroOut`, as
  valid rather than an error.
- Cap copied blocker details at 32 entries and bound graph labels at the Rust
  command boundary.
- Keep copied diagnostics privacy-safe by excluding raw prompt and workflow
  bodies.
- Keep parser version 42 and preserve all extracted metadata behavior.

## Non-Goals

- Do not change traversal, fallback, merge, output-selection, or prompt policy.
- Do not persist diagnostics or change `ImageMetadata` or the database schema.
- Do not expose the diagnostics outside Developer Mode.
- Do not merge or publish the accumulated ComfyUI integration stack.

## Verification

- Rust diagnostics tests cover normal traversal, unsupported model wrappers,
  unavailable generated prompts, intentional zeroed negative conditioning, and
  ambiguous outputs.
- Workflow Inspector tests cover the compact output summary, blocker display,
  complete capped copy payload, and raw-body exclusion.
- Targeted frontend tests and TypeScript type checking pass.
- The full ComfyUI suite passes when excluding the pre-existing
  `templates-image_to_real` pinned-blob assertion: 383 tests pass, one existing
  test remains ignored, and all 10 reparse tests pass. The stale blob
  expectation predates this package and does not involve diagnostics behavior.
- Generated binding drift, formatting, TypeScript, focused frontend tests, and
  diff hygiene checks pass.
