# Milestone 63: Offline ComfyUI Support-Bundle Replay

Status: Complete

## Outcome

Maintainers can inspect a schema-1 ComfyUI support bundle offline with:

```powershell
pnpm run inspect:comfyui-support -- <bundle-path> [--verify]
```

The command validates the bundle, replays its exact chunks through the current authoritative parser, and emits deterministic JSON containing recorded and current diagnostics plus `parserOutputMatches`.

## Acceptance

- Input is bounded to 64 MiB before parsing and checked again while reading.
- Chunk keys and declared lengths must match the exact raw chunks; schema 1 lengths use JavaScript UTF-16 code units.
- App/parser version-only differences do not count as parser drift.
- Normal inspection exits successfully for valid bundles even when output differs; `--verify` uses exit code `2` for drift.
- Invalid arguments, malformed data, unsupported schemas, size violations, and I/O failures use exit code `1`.
- Reports include diagnostics and chunk summaries but never raw chunk bodies.
- The command performs no network access, fixture writes, database work, or metadata refresh.
- Parser version remains `46`.

## Non-Goals

- Importing support bundles into the desktop app.
- Uploading support data or executing embedded workflow nodes.
- Changing parser behavior, stored metadata, public Tauri commands, bindings, or database schemas.

## Verification

- Focused replay validation, comparison, privacy, and UTF-16 compatibility tests pass.
- CLI argument, bounded-read, normal/verify exit, and error privacy tests pass.
- Full ComfyUI and reparse regression suites pass.
- Rust formatting, TypeScript compatibility, and diff hygiene checks pass.
