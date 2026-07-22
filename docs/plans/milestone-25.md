# Milestone 25: ComfyUI Ideogram v4 Metadata

Status: In Progress
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Reconciliation

- Rust remains the authoritative ComfyUI metadata parser.
- Official fixtures remain workflow-only, pinned, and offline.
- Deterministic connected values must be exact or unavailable; unresolved
  links cannot reopen stale widgets or disconnected fallback values.
- No frontend, database, Tauri command, Specta binding, diagnostics DTO, or
  `ImageMetadata` shape changes are planned.

The milestone starts with parser version 28 and 23 `golden`, 9
`pattern_covered`, 3 `partial`, 40 `unassessed`, and 474 `excluded` catalog
entries.

## Objective

Extract exact metadata from the pinned official `image_ideogram4_t2i`
workflow by resolving its selected JSON profile, dual-model guider, and custom
scheduler without executing arbitrary expressions or misrepresenting its
scheduled CFG override.

The milestone is accepted when Ideogram is golden with exact workflow,
metadata, diagnostics, and provenance; parser version 31 is live; and the
catalog reaches 24 `golden` and 39 `unassessed` entries.

## Work Package 1: Pinned Ideogram Fixture Intake

Status: Complete (`feat/comfyui-ideogram-fixture-intake`, `2026-07-19`)

Primary invariant: fixture evidence exactly matches the pinned catalog source.

Scope:

- Vendor the exact workflow as a workflow-only chunks fixture.
- Store the exact source-authored positive prompt as adjacent expected text.
- Verify UTF-8 bytes, Git blob identity, JSON validity, workflow preservation,
  normalized graph count, and saved-output diagnostics.
- Record source-authored model, seed, profile, CFG, sampler, prompt, and
  resource expectations without asserting current parser output.

Non-goals:

- No parser changes, manifest promotion, parser-version change, images, or API
  prompt chunks.

Targeted verification:

- catalog-intake, workflow-subgraph, output-selection, and template-coverage
  tests;
- `cargo fmt --check` and `git diff --check`.

Completion criteria:

- workflow bytes match blob `c04018493c60d8d4275f0bdc54acb385f59e7ea5`;
- the 3,598-byte prompt matches its pinned definition widget;
- the graph normalizes to 42 nodes with one output, one root, and no ambiguity;
- parser output and coverage claims remain unchanged.

Verification evidence:

- the workflow string is exactly 119,270 UTF-8 bytes and matches Git blob
  `c04018493c60d8d4275f0bdc54acb385f59e7ea5`;
- the expected positive prompt is exactly 3,598 bytes and matches the pinned
  definition widget;
- the graph normalizes to 42 nodes with one saved-output candidate, one unique
  root sampler, and no ambiguity;
- catalog-intake tests pass with 5 tests, workflow-subgraph tests with 14,
  output-selection tests with 15, and template-coverage tests with 3;
- parser version remains 28 and manifest totals remain 23 `golden`, 9
  `pattern_covered`, 3 `partial`, 40 `unassessed`, and 474 `excluded`;
- `cargo fmt --check` and `git diff --check` pass, with no `Cargo.lock` churn.

## Work Package 2: Deterministic JSON and Number Resolution

Status: Complete (`fix/comfyui-deterministic-json-number-resolution`, `2026-07-21`)

Depends on: Work Package 1.

Primary invariant: connected profile values are exact or unavailable.

Scope:

- Add bounded exact-key `JsonExtractString` evaluation with connected-input
  authority and workflow mappings for `json_string` and `key`.
- Support compact JSON serialization only as needed for nested extraction.
- Add output-slot-aware `ComfyNumberConvert` evaluation for finite float and
  integer outputs.
- Preserve existing cycle/depth protections, 64 KiB string limits, and 4 KiB
  key limits.
- Increment parser version from 28 to 29.

Non-goals:

- No JSONPath, arbitrary Python stringification, math-expression execution, or
  generated-text execution.

Completion criteria:

- the selected `Default` profile deterministically resolves 20 steps and its
  numeric scheduler parameters;
- malformed, oversized, cyclic, or unresolved paths fail closed;
- the package is independently review-clean.

Verification evidence:

- the pinned `Default` profile resolves 20 steps, `mu = 0.0`, and
  `std = 1.75` through the connected JSON and converter path;
- deterministic-value tests pass with 9 tests, prompt tests with 50,
  graph-source tests with 4, and catalog-intake tests with 5;
- the full ComfyUI suite passes with 250 tests and the existing Ollama test
  ignored; all 10 reparse tests pass;
- parser version is 29, Ideogram remains `unassessed`, and manifest totals
  remain unchanged;
- `cargo fmt --check` and `git diff --check` pass with no `Cargo.lock` churn.

## Work Package 3: Dual-Model Guider Policy

Status: Complete (`fix/comfyui-dual-model-guider-policy`, `2026-07-22`)

Depends on: Work Packages 1 and 2.

Primary invariant: only the guider's selected primary branch supplies primary
metadata.

Scope:

- Support `DualModelGuider.model`, `cfg`, `positive`, and `negative`.
- Treat `CFGOverride` as a transparent model wrapper.
- Report base guider CFG 7 and leave the range-limited CFG 3 override
  unrepresented in the current scalar field.
- Ignore `model_negative` as a primary model candidate and preserve
  authoritative empty negative conditioning.
- Increment parser version from 29 to 30.

Non-goals:

- No scheduled-CFG metadata field, auxiliary-model field, or disconnected
  guider scan.

Completion criteria:

- primary model, base CFG, and prompt branches are exact and connected;
- stale widgets, unconditional models, and disconnected branches cannot
  contribute primary metadata;
- the package is independently review-clean.

Verification evidence:

- the pinned Ideogram workflow resolves primary model
  `ideogram4_fp8_scaled`, seed `885894517601261`, base CFG 7, sampler
  `euler`, and its exact 3,598-byte positive prompt through
  `SamplerTraversal`;
- the auxiliary unconditional model and scheduled CFG 3 override do not
  become primary metadata, while authoritative empty negative conditioning
  blocks disconnected prompt fallback;
- steps intentionally remain unavailable until Work Package 4 adds the
  connected `Ideogram4Scheduler` policy;
- dual-model-guider tests pass with 5 tests, deterministic-value tests with 9,
  multi-stage tests with 55, official-catalog tests with 27, catalog-intake
  tests with 5, template-coverage tests with 3, workflow-subgraph tests with
  14, and output-selection tests with 15;
- the full ComfyUI suite passes with 255 tests and the existing Ollama test
  ignored; all 10 reparse tests pass;
- parser version is 30, Ideogram remains `unassessed`, and manifest totals
  remain unchanged.

## Work Package 4: Ideogram Scheduler and Golden Coverage

Depends on: Work Packages 1-3.

Primary invariant: scheduler metadata comes only from the scheduler connected
to the selected saved output.

Scope:

- Support `Ideogram4Scheduler` linked inputs and workflow widget indexes.
- Use stable scheduler label `ideogram4`, producing
  `euler (ideogram4)` for the pinned fixture.
- Add exact golden assertions for model, seed, steps, CFG, sampler, prompts,
  resources, workflow, diagnostics, and provenance.
- Promote `image_ideogram4_t2i` to `golden`, increment parser version from 30
  to 31, and update totals to 24 `golden` and 39 `unassessed`.

Non-goals:

- No `mu`, `std`, dimension, or schedule-range metadata fields and no
  model-family-wide promotion.

Completion criteria:

- all populated core fields use `SamplerTraversal` provenance;
- the auxiliary unconditional model is absent and negative conditioning is
  authoritatively empty;
- the package is independently review-clean.

## Work Package 5: Integration Review and Closure

Depends on: Work Packages 1-4.

Primary invariant: all merged packages preserve prior coverage while closing
the Ideogram gap without public interface changes.

Scope:

- Review the merged packages together on fresh `main`.
- Run the complete milestone gate and record observed counts and PR evidence.
- Confirm parser version 31, final manifest totals, and no `Cargo.lock` churn.
- Publish a docs-only closure PR.

Non-goals:

- No parser, fixture, manifest, or interface changes.

## Milestone Acceptance Gate

After all behavior packages merge:

1. Run deterministic-value, prompt, multi-stage, official-catalog,
   template-coverage, catalog-intake, workflow-subgraph, output-selection,
   full ComfyUI, and reparse tests.
2. Run `cargo fmt --check` and `git diff --check`.
3. Confirm parser version 31, final catalog totals, no `Cargo.lock` churn, and
   no public interface changes.
4. Mark this plan complete with merged PRs and observed verification evidence.

## Deferred

- `ComfyMathExpression` remains unsupported because the pinned workflow uses
  it only for dimensions, which are outside `ImageMetadata` and come from the
  file scanner.
- ERNIE and Florence remain partial because their generated prompt results are
  not embedded in workflow metadata.
