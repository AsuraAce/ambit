# Milestone 77: Value-Redacted ComfyUI Replay Summary

Status: Complete

## Outcome

Offline support-bundle replay can emit a compact deterministic JSON summary
that classifies parser drift without exposing raw chunks or compared metadata
and diagnostics values.

## Acceptance

- `inspect:comfyui-support` accepts `--summary`, including with `--verify`.
- Full and summary reports derive from one validated replay result and return
  the same strict match verdict.
- The summary reports versions, image shape, chunk count, prompt/workflow
  presence, graph and output-selection counts, difference counts, verdicts,
  compatibility exclusions, and difference path/kind pairs.
- Raw chunks, chunk keys and lengths, complete diagnostics, metadata values,
  provenance values, and recorded/current difference values are omitted.
- Fixture preparation and fixture inspection reject `--summary` and retain
  their existing reports.
- Support-bundle schema remains `1`; parser output and parser version remain
  unchanged at `46`.

## Non-Goals

- Claiming that summary output is automatically safe to publish.
- Redacting or changing the existing full replay report.
- Adding summary modes to fixture-candidate preparation or inspection.
- Frontend, binding, database, parser, or metadata-shape changes.

## Verification

- Replay tests cover deterministic matching summaries, metadata-only,
  diagnostics-only, and mixed drift, legacy exclusions, strict verdict parity,
  and seeded sensitive-value omission.
- CLI tests cover summary dispatch, strict verification, invalid combinations,
  help text, and unchanged full-report behavior.
- ComfyUI diagnostics and parser regression suites, formatting, diff hygiene,
  parser-version stability, and lockfile stability form the completion gate.
