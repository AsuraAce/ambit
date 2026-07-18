# Milestone 24: ComfyUI Output-Slot and Sigma-Lineage Fidelity

Status: In Progress
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Reconciliation

- Rust remains the authoritative ComfyUI metadata parser.
- Official catalog fixtures remain workflow-only, pinned, and offline.
- Deterministic graph values must be exact or unavailable; stale widgets and
  disconnected fallback values must not reopen failed connected paths.
- No frontend, database, Tauri command, Specta binding, diagnostics DTO, or
  `ImageMetadata` shape changes are planned.

The milestone starts with parser version 26 and 22 `golden`, 9
`pattern_covered`, 4 `partial`, 40 `unassessed`, and 474 `excluded` catalog
entries.

## Objective

Preserve connected source output slots, resolve the deterministic
`CustomCombo.INDEX` path used by Bernini, and trace `SplitSigmas` back to its
real scheduler without treating the split position as total steps.

The milestone is accepted when Bernini has exact golden metadata and
provenance, parser version 28 is live, and the catalog reaches 23 `golden` and
3 `partial` entries.

## Work Package 1: Source Output-Slot Fidelity

Status: Complete (`fix/comfyui-output-slot-fidelity`, 2026-07-18)

Primary invariant: graph normalization never discards a connected source's
output slot.

Scope:

- Add an internal source reference containing node ID and optional output slot.
- Preserve slots from API links and normalized workflow array/object edges,
  including expanded nested subgraphs.
- Keep existing ID-only connection helpers behaviorally unchanged; only new
  slot-aware evaluators consume the richer reference.
- Add API, workflow, unresolved-link, and subgraph-boundary regressions.

Non-goals:

- No `CustomCombo` evaluation, `SplitSigmas` traversal, metadata changes, or
  manifest changes.
- No parser-version increment; any metadata output change is a regression.

Targeted verification:

- workflow-subgraph and graph-focused tests;
- full ComfyUI and reparse tests;
- `cargo fmt --check` and `git diff --check`.

Completion criteria:

- source node IDs and output slots are exact for API and workflow graphs;
- existing ID-only parsing produces unchanged metadata;
- the package is independently review-clean.

Verification evidence:

- `cargo test metadata::comfyui::tests::graph_sources`: 4 passed;
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 14 passed;
- `cargo test metadata::comfyui`: 230 passed, 1 ignored;
- `cargo test metadata::reparse`: 10 passed;
- `cargo fmt --check` and `git diff --check`: passed.

## Work Package 2: Deterministic CustomCombo Resolution

Depends on: Work Package 1.

Status: Complete (`fix/comfyui-custom-combo-resolution`, 2026-07-18)

Primary invariant: an output-slot-specific deterministic value is exact or
unavailable, never guessed.

Scope:

- Resolve `CustomCombo` output slot 0 as the selected string and serialized
  output slot 1 as its validated option index.
- Give connected `choice` values authority over direct or workflow widgets.
- Require unlinked workflow selected value, stored index, and option list to
  agree before returning an index.
- Reject unsupported slots, unresolved links, inconsistent widgets, cycles,
  and values beyond existing string limits.
- Update Bernini to assert the exact positive prompt while it remains partial
  for missing schedule metadata.
- Increment parser version from 26 to 27.

Non-goals:

- No arbitrary combo execution, generated-text execution, or scheduler work.
- No manifest promotion.

Targeted verification:

- prompt and workflow-subgraph tests;
- Bernini official-catalog regression;
- full ComfyUI and reparse tests.

Completion criteria:

- Bernini resolves `You are a helpful assistant.make it night` from the
  selected output path;
- stale or malformed combo state cannot fabricate an index or prompt;
- parser version 27 reparses affected rows.

Verification evidence:

- `cargo test metadata::comfyui::tests::prompts`: 50 passed;
- `cargo test metadata::comfyui::tests::official_catalog`: 27 passed;
- `cargo test metadata::comfyui::tests::template_coverage`: 3 passed;
- `cargo test metadata::comfyui::tests::graph_sources`: 4 passed;
- `cargo test metadata::comfyui::tests::workflow_subgraphs`: 14 passed;
- `cargo test metadata::comfyui`: 234 passed, 1 ignored;
- `cargo test metadata::reparse`: 10 passed;
- `cargo fmt --check` and `git diff --check`: passed.

## Work Package 3: SplitSigmas Scheduler Ancestry

Depends on: Work Packages 1 and 2.

Status: Pending (`fix/comfyui-split-sigmas-scheduler`)

Primary invariant: a sigma split position controls staging but never
masquerades as the generation step count.

Scope:

- Follow a selected sampler's connected `SplitSigmas.sigmas` input through
  reroutes to the originating scheduler.
- Extract total steps and scheduler only from that upstream scheduler using
  link-first authority, cycle detection, and a depth limit of 16.
- Preserve root/base-first model selection and direct sampler precedence.
- Promote `video_bernini_r_image_editing` to exact golden coverage with 6
  steps, `res_multistep (simple)`, its deterministic positive prompt, existing
  negative prompt, model, seed, CFG, and LoRA.
- Increment parser version from 27 to 28 and update manifest totals to 23
  `golden`, 9 `pattern_covered`, 3 `partial`, 40 `unassessed`, and 474
  `excluded`.

Non-goals:

- No use of `SplitSigmas.step` as total steps.
- No generated-text, JSON-expression, Ideogram, or unrelated scheduler work.

Targeted verification:

- multi-stage and official-catalog tests;
- template coverage, workflow-subgraph, and output-selection tests;
- full ComfyUI and reparse tests.

Completion criteria:

- Bernini metadata and provenance are exact;
- unresolved, cyclic, and disconnected schedule paths fail closed;
- parser version and manifest totals are correct.

## Work Package 4: Integration Review and Closure

Depends on: Work Packages 1-3.

Status: Pending (`docs/comfyui-milestone-24-integration`)

Primary invariant: the merged packages preserve the last completed milestone
while closing the Bernini gap without public interface changes.

Scope:

- Review all merged packages together on fresh `main`.
- Run the full milestone acceptance gate and record observed counts.
- Confirm parser version 28, final manifest totals, and no `Cargo.lock` churn.
- Publish a docs-only closure PR and stop before Milestone 25.

Non-goals:

- No parser behavior, fixture, or coverage changes.

## Milestone Acceptance Gate

After all behavior packages merge:

1. Run prompt, multi-stage, official-catalog, template-coverage,
   workflow-subgraph, output-selection, full ComfyUI, and reparse tests.
2. Run `cargo fmt --check` and `git diff --check`.
3. Confirm parser version 28, final manifest totals, no `Cargo.lock` churn, and
   no public interface changes.
4. Mark this plan complete with merged PRs and observed verification evidence.

## Deferred

- ERNIE and Florence workflows remain partial because generated text is not
  embedded in their workflow metadata.
- Ideogram remains unassessed because its JSON extraction, math-expression,
  dual-model guider, and custom scheduler policy require a separate milestone.
