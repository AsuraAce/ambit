# Milestone 35: ComfyUI v0.11.15 Straightforward Goldens

Status: Complete
Catalog release: `v0.11.15`
Catalog commit: `703fb0b082fdb76331d02232ff67e878e2a6ca6e`

## Outcome

Promote six newly ingested workflows whose exact pinned metadata is already
represented by established parser behavior. Keep the Anima LLLite workflows
separate until their active model patches have an explicit resource policy.

## Acceptance Criteria

- Krea style-reference, Qwen 2511 INT8, Ideogram 4 INT8, Boogu Edit INT8,
  Z-Image INT8, and JoyAI have exact workflow-only golden assertions.
- Exact models, sampler fields, prompts, resources, output diagnostics, and
  provenance are verified without parser changes.
- Coverage totals are 40 golden, 4 pattern-covered, 1 partial, 39 unassessed,
  and 494 excluded.
- Parser version remains 36 and `Cargo.lock` remains unchanged.

## Non-Goals

- Do not classify Anima LLLite model patches in this milestone.
- Do not change parser behavior, public interfaces, storage, or frontend code.

## Verification

Completed on `2026-07-29`:

- exact metadata and provenance assertions passed for all six promoted goldens;
- official-catalog, template-coverage, intake, workflow-subgraph,
  output-selection, full ComfyUI, and metadata-reparse tests passed;
- `cargo fmt --check` and `git diff --check` passed;
- parser version remained 36 and incidental `Cargo.lock` churn was removed.
