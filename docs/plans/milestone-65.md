# Milestone 65: Guarded ComfyUI Fixture Candidate Export

Status: Complete

## Outcome

Maintainers can turn a validated ComfyUI support bundle into an exact,
reviewable chunk fixture candidate with:

```powershell
pnpm run prepare:comfyui-fixture -- <bundle-path> <output.chunks.json> --acknowledge-sensitive-data
```

## Acceptance

- Preparation reuses schema-1 bundle validation and the 64 MiB input limit.
- The output is a deterministic, minified, key-sorted chunk map with one final newline.
- Support-envelope fields and generated parser expectations are not written.
- An explicit sensitive-data acknowledgement and `.chunks.json` output are required.
- Existing files are never overwritten and failed writes remove partial output.
- Terminal output and errors never echo raw chunk bodies.
- Inspection and `--verify` behavior remain unchanged.
- Parser version remains `46`.

## Non-Goals

- Automatically redacting, registering, testing, committing, or publishing fixtures.
- Deciding whether a candidate is safe to vendor.
- Changing parser behavior, support-bundle schema, bindings, or database state.

## Verification

- Core tests cover exact deterministic candidate bytes, envelope removal, empty
  input, size limits, and shared validation.
- CLI tests cover acknowledgement, mode conflicts, suffix validation, privacy,
  no-overwrite behavior, and failed-write cleanup.
- Package-script, full Rust, ComfyUI, reparse, formatting, and diff-hygiene gates pass.
