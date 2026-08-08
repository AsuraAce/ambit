# Milestone 66: Offline ComfyUI Fixture Candidate Inspection

Status: Complete

## Outcome

Maintainers can validate and replay an edited ComfyUI chunk fixture candidate
before registering or committing it:

```powershell
pnpm run inspect:comfyui-fixture -- <candidate.chunks.json> [--compare-support <bundle-path>] [--verify]
```

## Acceptance

- Candidate and optional support-bundle reads are independently limited to 64 MiB.
- Candidates are non-empty JSON objects containing unique string chunk values.
- Reports include a canonical SHA-256, sorted keys, UTF-16 lengths, and current
  parser diagnostics without complete raw chunk bodies.
- Optional comparison uses fresh diagnostics for both inputs and ignores app and
  parser version differences.
- Comparison differences are deterministic JSON Pointer entries with support and
  candidate values; arrays remain atomic.
- Normal inspection exits successfully for valid drift, while comparison
  `--verify` uses exit code 2.
- Existing support inspection, verification, and fixture preparation are unchanged.
- Parser version remains `46`.

## Non-Goals

- Automatically redacting, registering, generating expectations for, testing,
  committing, or publishing fixtures.
- Treating every candidate difference as a defect.
- Changing parser behavior, application APIs, bindings, or database state.

## Verification

- Core tests cover canonical identity, candidate validation, exact comparison,
  deterministic differences, version normalization, and raw-body privacy.
- CLI tests cover arguments, comparison verification, exit codes, bounded reads,
  and existing-mode compatibility.
- Package-script, full Rust, ComfyUI, reparse, formatting, and diff-hygiene gates pass.
