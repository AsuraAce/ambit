# Milestone 22: Deterministic ComfyUI Prompt And Custom Sampler Coverage

Status: In Progress
Branch: `feat/comfyui-deterministic-prompt-coverage`
Catalog commit: `c3bf8342318a3c2bfcbf6d0ac020155745417f29`

## Reconciliation

This milestone follows the repository's metadata architecture:

- Rust remains the authoritative metadata parser.
- Parser heuristics stay local to `src-tauri/src/metadata/comfyui/` and require focused Rust regression coverage.
- No database, Tauri command, Specta binding, frontend, or `ImageMetadata` shape change is planned.
- The official catalog remains pinned. Tests are offline and fixtures contain workflow JSON only.
- Coverage claims require exact fixtures or explicit structural evidence. A model-family name alone is not evidence.

The active catalog target remains 75 workflows. At the start of this milestone the manifest reports:

- 16 `golden`
- 7 `pattern_covered`
- 3 `partial`
- 49 `unassessed`
- 474 `excluded`

## Objective

Extract trustworthy metadata through deterministic prompt transforms, custom conditioning encoders, and connected `SamplerCustom` paths without executing generative text nodes or reopening stale-widget fallbacks.

The milestone is accepted when:

- at least four selected workflows become exact goldens;
- the Bernini workflow is either golden or explicitly partial with a precise unavailable-field reason;
- every selected workflow has exact workflow preservation and graph/output diagnostics coverage;
- no connected unresolved prompt can be replaced by a stale widget or disconnected fallback;
- the active-target `unassessed` count is at most 44;
- all work packages and the combined milestone diff are review-clean.

## Assumptions

- Pure string transforms are safe to evaluate only when every required input resolves to a bounded literal.
- `TextGenerate`, Florence, and other model-backed generators remain non-executable.
- `StringReplace` and bounded `RegexExtract` are deterministic transforms; malformed patterns or unresolved inputs produce no prompt.
- Connected saved-output evidence remains required for sampler and conditioning authority.
- If a selected fixture requires a public metadata-shape change, that workflow remains `partial` and the shape change moves to a later milestone.

## Work Package 1: Pinned Fixture Intake

Status: Complete (`2026-07-13`)

Evidence:

- five workflow-only fixtures match the pinned upstream Git blob identities;
- intake tests lock workflow preservation and normalized graph/output shape;
- source-authored metadata expectations are recorded without parser-output assertions;
- parser code, parser version, and coverage manifest status are unchanged;
- focused intake, workflow-subgraph, and output-selection tests pass;
- `cargo fmt --check` and `git diff --check` pass;
- independent review is clean after binding each recorded Git blob ID to fixture bytes.

Primary invariant: test inputs are byte-faithful to the pinned catalog before parser behavior is changed.

Scope:

- Vendor workflow-only fixtures for:
  - `image_anima_base_v1`
  - `image_newbieimage_exp0_1-t2i`
  - `image_lens_t2i`
  - `image_boogu_image_0_1_edit`
  - `video_bernini_r_image_editing`
- Document source URLs, pinned commit, Git blob identities, and capture date.
- Add intake tests for JSON validity, exact workflow preservation, normalized graph count, output-candidate count, root count, and ambiguity state.
- Record the source-authored model, prompt, seed, scalar, sampler, scheduler, and resource expectations without changing coverage status.

Non-goals:

- No parser fixes.
- No manifest promotion.
- No assertions that freeze currently incorrect parser output.

Targeted verification:

- fixture source/hash verification;
- intake test module;
- existing workflow-subgraph and output-selection suites;
- `git diff --check`.

Completion criteria:

- all five fixtures load offline and match their pinned upstream blobs;
- graph/output diagnostics are deterministic;
- the package is independently review-clean.

## Work Package 2: Deterministic String Transforms

Depends on: Work Package 1.

Status: Complete (`2026-07-14`)

Branch: `fix/comfyui-deterministic-string-transforms`

Evidence:

- `StringReplace`, the required `RegexExtract` subset, and `StringConcatenate` resolve bounded literal inputs with connected-link authority;
- unresolved, cyclic, malformed, unsupported, or oversized transforms return no prompt and cannot reopen stale widget or disconnected fallback text;
- the independently expanded 4,647-byte NewBie prompt is stored as adjacent expected text and matches parser output exactly;
- `image_newbieimage_exp0_1-t2i` is golden with `SamplerTraversal` provenance for all core fields and both prompts;
- ComfyUI prompt resource extraction ignores XML-like prompt markup while the legacy InvokeAI bare-tag behavior remains covered;
- parser version is `22` and manifest totals are 17 `golden`, 7 `pattern_covered`, 3 `partial`, 48 `unassessed`, and 474 `excluded`;
- prompt, official-catalog, template-coverage, catalog-intake, full ComfyUI, metadata-utils, and reparse tests pass;
- `cargo fmt --check` and `git diff --check` pass.

Primary invariant: a selected deterministic transform returns the literal result or no prompt; it never substitutes stale or disconnected text.

Scope:

- Add bounded literal evaluation for `StringReplace`.
- Add bounded literal evaluation for `RegexExtract` only where the node's source, pattern, and selected result are deterministic.
- Preserve linked-input authority over widgets at every transform hop.
- Keep `StringConcatenate` behavior consistent with the same authority rules.
- Add synthetic regressions for linked literals, widget fallbacks, malformed patterns, unresolved sources, cycles, and output-size limits.
- Promote `image_newbieimage_exp0_1-t2i` to an exact golden if its final conditioning prompt is fully recoverable.

Non-goals:

- No `TextGenerate`, Florence, LLM, Python, or arbitrary expression execution.
- No global scan of disconnected transform nodes.
- No generic transform-plugin framework.

Targeted verification:

- prompt tests;
- NewBie catalog golden;
- official catalog tests;
- full ComfyUI suite.

Completion criteria:

- deterministic transform regressions pass;
- generated/unresolved inputs remain empty with no prompt provenance;
- parser version increments from 21 to 22 because stored output changes;
- the package is independently review-clean.

## Work Package 3: Connected SamplerCustom Scalars

Status: Complete (`fix/comfyui-sampler-custom-traversal`, 2026-07-14)

Depends on: Work Packages 1 and 2.

Primary invariant: model, seed, steps, CFG, sampler, and scheduler come only from the connected saved-output `SamplerCustom` path.

Scope:

- Audit and minimally complete traversal for `SamplerCustom`, `BasicScheduler`, `KSamplerSelect`, and connected `CFGNorm`.
- Preserve direct sampler values over guider or scheduler fallbacks.
- Treat linked values as authoritative over stale widgets.
- Ignore disconnected sampler, scheduler, and CFG-normalization nodes.
- Add exact `image_lens_t2i` metadata and provenance coverage.

Non-goals:

- No arbitrary scheduler inference.
- No disconnected/global scalar override.
- No changes to multi-output ambiguity policy.

Targeted verification:

- focused sampler/scalar regressions;
- Lens golden;
- multi-stage and output-selection suites;
- full ComfyUI suite.

Completion criteria:

- Lens core metadata is exact and sourced from `SamplerTraversal`;
- disconnected controls cannot affect output;
- increment the parser version again if this separately merged package changes stored output;
- the package is independently review-clean.

Verification evidence:

- core `SamplerCustom` now reads only its connected saved-output model,
  conditioning, seed, CFG, scheduler, and sampler-selection paths;
- linked scalar/string inputs fail closed instead of reopening stale workflow
  widgets, while unlinked definition defaults remain available;
- the Lens fixture is exact with 19 normalized nodes, one output/root, no
  ambiguity, and `SamplerTraversal` provenance for every populated core field;
- parser version is 23 and catalog totals are 18 golden, 7 pattern-covered,
  3 partial, 47 unassessed, and 474 excluded;
- focused and full verification commands are recorded in the package delivery
  summary; the independent review cycle follows this uncommitted implementation.

## Work Package 4: Custom Edit Conditioning

Depends on: Work Packages 1-3.

Primary invariant: custom conditioning nodes expose only their selected literal prompt inputs and cannot invent conditioning text.

Scope:

- Add narrow prompt traversal for `TextEncodeBooguEdit`.
- Add narrow prompt traversal for `BerniniConditioning`.
- Follow explicit positive/negative prompt inputs and preserve authoritative empty values.
- Reuse deterministic transforms from Work Package 2 rather than duplicating string logic.
- Add exact `image_boogu_image_0_1_edit` coverage.
- Make `video_bernini_r_image_editing` golden when all final literal fields are representable; otherwise mark it `partial` with exact evidence and no false prompt.

Non-goals:

- No wildcard support for unknown custom encoders.
- No image-content interpretation.
- No representation of secondary conditioning branches not supported by `ImageMetadata`.

Targeted verification:

- custom-conditioning synthetic tests;
- Boogu and Bernini catalog tests;
- prompt, output-selection, and full ComfyUI suites.

Completion criteria:

- Boogu metadata and provenance are exact;
- Bernini is honestly classified without stale or fabricated prompts;
- increment the parser version again if this separately merged package changes stored output;
- the package is independently review-clean.

## Work Package 5: Control Golden And Manifest Reassessment

Depends on: Work Packages 1-4.

Primary invariant: coverage status follows executable evidence, not family resemblance.

Scope:

- Add exact `image_anima_base_v1` golden coverage as the ordinary KSampler/subgraph control.
- Update the five selected manifest entries with fixture and test evidence.
- Reassess only directly related variants such as `image_anima_preview` and `image_lens_turbo_t2i`.
- Mark a related entry `pattern_covered` only when a structural comparison test proves the selected sampler, model, prompt, and resource paths are equivalent.
- Recompute and assert manifest totals from entries.

Non-goals:

- No blanket family-wide promotion.
- No new parser behavior.
- No assessment of resource-focused or unrelated model families.

Targeted verification:

- official catalog tests;
- template coverage/schema tests;
- exact manifest totals;
- full ComfyUI and reparse suites.

Completion criteria:

- at least four new goldens exist across the milestone;
- Bernini is golden or precisely partial;
- `unassessed` is at most 44;
- no entry is promoted without durable evidence;
- the package is independently review-clean.

## Milestone Acceptance Gate

After all five packages are complete:

1. Rebase or reconcile the package series with current `origin/main`.
2. Run a fresh integration review over the complete milestone diff.
3. Run:
   - `cargo test metadata::comfyui::tests::prompts`
   - `cargo test metadata::comfyui::tests::official_catalog`
   - `cargo test metadata::comfyui::tests::template_coverage`
   - `cargo test metadata::comfyui::tests::multi_stage`
   - `cargo test metadata::comfyui::tests::workflow_subgraphs`
   - `cargo test metadata::comfyui::tests::output_selection`
   - `cargo test metadata::comfyui`
   - `cargo test metadata::reparse`
   - `cargo fmt --check`
   - `git diff --check`
4. Confirm no `Cargo.lock` app-version churn and no public interface changes.
5. Update this plan to `Status: Complete` with final coverage totals and PR/commit evidence.

## Deferred

- Z-Image union ControlNet and Flux depth-LoRA resource paths.
- Remaining simple model-family and quantization variants.
- Executing generated-text nodes.
- New metadata fields for secondary prompts or conditioning branches.
- Frontend or diagnostics UI changes.
