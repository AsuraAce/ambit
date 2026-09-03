# Milestone 67: ComfyUI Support Workflow Safety

Status: Complete

## Outcome

The ComfyUI support-bundle and fixture-candidate tools have one canonical
maintainer workflow with explicit privacy boundaries. Default support-bundle
filenames are ignored by Git as defense in depth.

## Acceptance

- The guide routes export, replay, differences, candidate preparation,
  candidate inspection, privacy review, regression registration, and cleanup.
- Artifact guidance distinguishes exact raw bundles and candidates from compact
  reports that may still contain parsed sensitive values.
- `ambit-comfyui-support*.json` is ignored without hiding `.chunks.json`
  candidates that require deliberate review.
- The guide explains normal comparison versus `--verify` semantics and warns
  against generating expectations blindly from current parser output.
- No private support bundle or new fixture candidate is committed.
- Parser version remains `46`.

## Non-Goals

- Automatically redacting, registering, testing, committing, or publishing a
  fixture candidate.
- Changing parser behavior, metadata refresh policy, application APIs, or the
  existing export filename.

## Verification

- All three package entry points pass end-to-end smoke checks with synthetic or
  existing public fixture data.
- The default support filename is confirmed ignored while `.chunks.json`
  candidates remain visible to Git.
- The consolidated release verification, Rust formatting, and diff-hygiene
  gates pass before publication.
