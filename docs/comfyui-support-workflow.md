# ComfyUI Parser Support Workflow

Status: Canonical
Last reviewed: 2026-08-09

## Purpose

Use this workflow to turn a real ComfyUI parser problem into a reviewable,
offline regression fixture without sharing image pixels or committing a private
support bundle. The desktop export and all three package commands are local-only.

This process does not automatically redact private data or decide that a fixture
is safe to publish. Human review remains mandatory.

## Artifact Safety

| Artifact | Contents | Policy |
| --- | --- | --- |
| Diagnostics clipboard summary | Parsed prompts, models, resources, provenance, and chunk summaries | Review before sharing; it omits raw chunks and image identity but may still contain private prompt text. |
| Support bundle | Exact raw metadata chunks plus diagnostics and a minimal image descriptor | Private. Store outside the repository and never commit it. |
| Fixture candidate | Exact chunk map copied from the support bundle, possibly edited | Private until every chunk has been manually reviewed and approved. |
| Inspector report | Parsed diagnostics, hashes, summaries, and optional differences | Review before sharing because parsed prompt and resource values may be sensitive. |

The repository ignores the default `ambit-comfyui-support*.json` filename as a
defense in depth. Renamed bundles are not guaranteed to be ignored. Always check
`git status` before staging or committing.

## 1. Export A Private Bundle

1. Enable Developer Mode in Ambit.
2. Open the affected ComfyUI image in the viewer.
3. Open Workflow, locate Parser Diagnostics, and choose Export Bundle.
4. Read and accept the warning only when the raw chunks may be exported locally.
5. Save the bundle outside the repository whenever possible.

The bundle may contain prompts, model names, workflow settings, local paths, and
custom-node values. Ambit does not upload it.

## 2. Replay The Source

Inspect the recorded and current parser output:

```powershell
pnpm run inspect:comfyui-support -- "C:\private\ambit-comfyui-support.json"
```

Normal inspection exits successfully even when parser output has changed. Use
`--verify` when drift should fail automation; parser drift then exits with code
`2`, while invalid input or I/O errors use code `1`.

```powershell
pnpm run inspect:comfyui-support -- "C:\private\ambit-comfyui-support.json" --verify
```

Reports omit complete raw chunk bodies, but their parsed metadata may still be
sensitive.

Use `--summary` when the full compared values are not needed:

```powershell
pnpm run inspect:comfyui-support -- `
  "C:\private\ambit-comfyui-support.json" `
  --summary
```

The deterministic JSON summary omits raw chunks, chunk names and lengths,
complete diagnostics, metadata values, provenance values, and the
recorded/current values behind each difference. It retains version and image
shape information, prompt/workflow presence, graph and output-selection counts,
strict verdicts, compatibility exclusions, and difference paths and kinds. It
is value-redacted rather than automatically publication-safe; review it before
sharing. `--summary --verify` retains the same strict exit-code behavior as the
full report.

Schema-1 bundles created before newer diagnostics fields were introduced remain
replayable. When a recorded bundle omitted `fieldSourceNodeIds` or
`resourceSources`, replay excludes that missing field from both sides of the
comparison and lists its JSON pointer in `comparisonIgnoredPaths`. A field that
was explicitly recorded, including an empty object or array, is compared
normally. All other metadata and diagnostics differences still count as parser
drift and fail `--verify`.

Replay reports separate the result into `metadataOutputMatches` for differences
under the extracted metadata preview and `diagnosticsMatch` for graph,
provenance, and traversal evidence. Their corresponding difference counts make
the source of drift visible, while `parserOutputMatches` remains the strict
combined verdict used by `--verify`. Unknown top-level diagnostics fields are
rejected rather than silently discarded; use tooling from the same or a newer
Ambit version to inspect such a bundle.

## 3. Prepare A Candidate

Create an exact, deterministic chunk-only candidate in a private working area:

```powershell
pnpm run prepare:comfyui-fixture -- `
  "C:\private\ambit-comfyui-support.json" `
  "C:\private\case-name.chunks.json" `
  --acknowledge-sensitive-data
```

Preparation requires the explicit acknowledgement, requires a `.chunks.json`
destination, and never overwrites an existing file. The result still contains
the exact raw metadata chunks and is not safe merely because the support envelope
was removed.

## 4. Review And Minimize

Open the candidate itself and inspect every chunk. Remove private paths,
filenames, prompts, URLs, account identifiers, and unrelated workflow material
unless they are required to reproduce the parser behavior and are approved for
publication.

Keep the smallest graph that preserves the failing path. Use valid structured
JSON edits rather than global text replacement. If removing sensitive content
changes the behavior under test, create a synthetic equivalent or retain the
fixture privately instead of publishing the original data.

Do not derive expected metadata blindly from the current parser. Expectations
must describe the intended behavior established by the source workflow and the
reported problem.

## 5. Inspect The Candidate

Validate and replay the edited candidate:

```powershell
pnpm run inspect:comfyui-fixture -- "C:\private\case-name.chunks.json"
```

Compare its freshly computed diagnostics with the source bundle:

```powershell
pnpm run inspect:comfyui-fixture -- `
  "C:\private\case-name.chunks.json" `
  --compare-support "C:\private\ambit-comfyui-support.json"
```

Add `--verify` only when the candidate is expected to retain identical parsed
diagnostics. Intentional minimization may produce legitimate differences; normal
comparison reports those differences without treating them as command failure.
Comparison ignores app and parser version changes and does not compare raw bytes.
Fixture-candidate comparison always computes fresh diagnostics from both chunk
maps, so it does not use the legacy-field compatibility exclusions described
above.

The candidate SHA-256 is based on its canonical key-sorted chunk map, so outer
candidate-file whitespace and root key ordering do not change its identity.
Whitespace inside a chunk string, including embedded `prompt` or `workflow`
JSON, remains byte-sensitive and does change the hash.

## 6. Register An Approved Regression

Only after privacy review:

1. Move the approved `.chunks.json` file into the appropriate ComfyUI fixture directory.
2. Add generic provenance to that directory's README without private local paths.
3. Register the fixture with `include_str!` in the appropriate Rust test module.
4. Assert exact metadata, resources, output selection, and field provenance.
5. Add a narrow parser fix only when the fixture proves a concrete bug.
6. Bump `CURRENT_PARSER_VERSION` only when stored parser output changes.
7. Run the focused fixture test, the complete ComfyUI suite, reparse tests, formatting, and diff hygiene.

Before committing, inspect both tracked and untracked state. A support bundle must
never appear in the staged file list. Remove private temporary artifacts when the
support case is complete.

## Command Summary

```powershell
pnpm run inspect:comfyui-support -- <bundle-path> [--verify] [--summary]
pnpm run prepare:comfyui-fixture -- <bundle-path> <output.chunks.json> --acknowledge-sensitive-data
pnpm run inspect:comfyui-fixture -- <candidate.chunks.json> [--compare-support <bundle-path>] [--verify]
```
