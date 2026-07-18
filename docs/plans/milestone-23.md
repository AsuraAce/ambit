# Milestone 23: Connected ComfyUI Resource Paths

Status: Complete (`2026-07-18`)
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Reconciliation

- Rust remains the authoritative metadata parser.
- Official catalog fixtures stay workflow-only, pinned, and offline.
- Resource claims require a connected saved-output path and exact fixture evidence.
- No database, frontend, Tauri command, Specta binding, diagnostics DTO, or
  `ImageMetadata` shape changes are planned.

The milestone starts with 20 `golden`, 9 `pattern_covered`, 4 `partial`, 42
`unassessed`, and 474 `excluded` catalog entries. Parser version 24 is live.

## Objective

Extract connected model-patch ControlNets and verify connected Flux depth LoRAs
without promoting auxiliary models or disconnected resources.

The milestone is accepted when both selected workflows have byte-faithful
fixtures, exact metadata and provenance coverage, and the catalog reaches 22
`golden` and 40 `unassessed` entries.

## Work Package 1: Pinned Resource Fixture Intake

Status: Complete (`feat/comfyui-resource-path-intake`, `2026-07-17`)

Evidence:

- both workflow strings match their pinned upstream Git blob identities and
  exact UTF-8 byte lengths;
- both fixtures are workflow-only, parse as JSON, and preserve their workflow
  strings exactly;
- Flux normalizes to 28 nodes and Z-Image to 19 nodes, each with one persisted
  output, one unique root sampler, and no ambiguity;
- parser code, coverage status, parser version 24, and public interfaces are
  unchanged;
- catalog intake, workflow-subgraph, output-selection, and template-coverage
  tests pass;
- `cargo fmt --check` and `git diff --check` pass.

Primary invariant: fixture bytes and graph diagnostics are locked before parser
behavior or coverage claims change.

Scope:

- Vendor workflow-only fixtures for `flux_depth_lora_example` and
  `image_z_image_turbo_fun_union_controlnet`.
- Verify UTF-8 bytes, pinned Git blob identity, JSON validity, exact workflow
  preservation, normalized node count, and output diagnostics.
- Record source-authored metadata expectations without asserting current parser
  output.

Non-goals:

- No parser fixes, manifest promotions, or parser-version change.
- No images, API prompt chunks, or runtime network access.

Targeted verification:

- catalog intake, workflow-subgraph, output-selection, and template-coverage
  tests;
- `cargo fmt --check` and `git diff --check`.

Completion criteria:

- both fixtures match their pinned upstream blobs;
- graph shape and saved-output diagnostics are deterministic;
- the package is independently review-clean.

## Work Package 2: Z-Image Model-Patch ControlNet

Depends on: Work Package 1.

Status: Complete (`fix/comfyui-qwen-model-patch-controlnet`, `2026-07-17`)

Evidence:

- `QwenImageDiffsynthControlnet` and `ZImageFunControlnet` collect a connected
  `ModelPatchLoader` as a ControlNet while continuing to the primary model;
- canonical `name`, supported aliases, and workflow widgets are covered, with
  connected names taking precedence over stale widget values;
- unresolved or empty connected names fail closed, unlinked empty canonical
  names may continue to supported aliases, and disconnected wrappers cannot
  contribute a ControlNet;
- `image_z_image_turbo_fun_union_controlnet` is golden with exact metadata,
  resource, workflow, output diagnostics, and `SamplerTraversal` provenance;
- parser version is 25 and manifest totals are 21 `golden`, 9
  `pattern_covered`, 4 `partial`, 41 `unassessed`, and 474 `excluded`;
- model, official-catalog, template-coverage, catalog-intake,
  workflow-subgraph, output-selection, full ComfyUI, and reparse tests pass;
- `cargo fmt --check` and `git diff --check` pass, with no `Cargo.lock` churn.

Primary invariant: a model patch on the connected sampler model path is a
ControlNet resource, never the primary model.

Scope:

- Support `QwenImageDiffsynthControlnet.model_patch -> ModelPatchLoader` with
  connected-input authority.
- Continue through the wrapper's upstream `model` to the primary loader.
- Share the narrow model-patch behavior with `ZImageFunControlnet`.
- Add synthetic regressions and promote the Z-Image fixture to `golden`.
- Increment parser version from 24 to 25.

Non-goals:

- No disconnected model-patch scans or generic model-wrapper inference.
- No new resource or metadata fields.

Targeted verification:

- model, official-catalog, template-coverage, workflow-subgraph, full ComfyUI,
  and reparse tests.

Completion criteria:

- the primary model and ControlNet are exact with `SamplerTraversal`
  provenance;
- disconnected or unresolved patches cannot contribute metadata;
- totals reach 21 `golden` and 41 `unassessed` entries.

## Work Package 3: Flux Depth LoRA Golden

Depends on: Work Packages 1 and 2.

Status: Complete (`feat/comfyui-flux-depth-lora-golden`, `2026-07-18`)

Evidence:

- `flux_depth_lora_example` is golden with exact metadata, workflow,
  diagnostics, resource vectors, and `SamplerTraversal` provenance;
- the selected Flux path reports `flux1_dev_fp8` and
  `flux1_depth_dev_lora`, while the auxiliary Lotus depth model is not
  promoted;
- sampler-root discovery now follows latent lineage after saved-output
  discovery, so an auxiliary sampler behind image conditioning cannot become
  the authoritative generation root;
- explicit `VAEEncode*` round trips retain upstream base-sampler ancestry;
- direct sampler CFG 1 remains authoritative over connected Flux guidance 10;
- parser version is 26 so affected stored metadata is reparsed;
- manifest totals are 22 `golden`, 9 `pattern_covered`, 4 `partial`, 40
  `unassessed`, and 474 `excluded`;
- official-catalog, template-coverage, catalog-intake, workflow-subgraph,
  output-selection, full ComfyUI, and reparse tests pass;
- `cargo fmt --check` and `git diff --check` pass, with no `Cargo.lock` churn.

Primary invariant: only the selected Flux generation path contributes the
primary model, CFG, and LoRA resource.

Scope:

- Add exact golden coverage for `flux_depth_lora_example`.
- Assert the depth LoRA is collected from the connected model chain.
- Assert the auxiliary Lotus depth model is not the primary model.
- Assert direct sampler CFG 1 remains authoritative over Flux guidance 10.
- Keep saved-output discovery broad while restricting sampler-root ancestry to
  latent edges.
- Increment parser version from 25 to 26 and update final manifest totals.

Non-goals:

- No model-family-wide promotion or unrelated resource support.
- No changes to public interfaces or metadata shapes.

Targeted verification:

- official-catalog, template-coverage, workflow-subgraph, output-selection,
  full ComfyUI, and reparse tests.

Completion criteria:

- Flux metadata, resources, diagnostics, and provenance are exact;
- totals reach 22 `golden` and 40 `unassessed` entries;
- the package is independently review-clean.

## Milestone Acceptance Gate

Status: Complete (`2026-07-18`)

Integration evidence:

- the three dependency-ordered packages merged through PRs #230, #233, and
  #236;
- combined review on fresh `main` found no integration regressions between
  model-patch resource traversal and saved-output sampler ancestry;
- parser version is 26 and final manifest totals are 22 `golden`, 9
  `pattern_covered`, 4 `partial`, 40 `unassessed`, and 474 `excluded`;
- focused suites pass with 3 catalog-intake, 12 model, 27 official-catalog, 3
  template-coverage, 14 workflow-subgraph, and 15 output-selection tests;
- the full ComfyUI suite passes with 226 passed and 1 intentionally ignored,
  and the reparse suite passes with 10 tests;
- `cargo fmt --check` and `git diff --check` pass, the worktree remained clean,
  and no `Cargo.lock` churn was produced;
- no public API, database schema, Tauri command, Specta binding, frontend,
  diagnostics DTO, or `ImageMetadata` changes were introduced.

Completed gate:

1. Review the combined milestone on fresh `main`.
2. Run catalog intake, models, official catalog, template coverage,
   workflow-subgraph, output-selection, full ComfyUI, and reparse tests.
3. Run `cargo fmt --check` and `git diff --check`.
4. Confirm parser version 26, no `Cargo.lock` churn, and no public interface
   changes.
5. Mark this plan complete with final totals and PR evidence.
