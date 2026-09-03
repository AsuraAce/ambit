# Milestone 78: ComfyUI Support Batch Replay

Status: Complete

## Outcome

Maintainers can replay a bounded directory of private ComfyUI support bundles
through one deterministic, value-redacted report without exposing local paths,
filenames, or raw bundle values.

## Acceptance

- `inspect:comfyui-support-batch` accepts one directory and optional
  `--verify`.
- Intake is limited to 256 direct regular `.json` files, is non-recursive,
  ignores other entries and symbolic links, and applies the existing 64 MiB
  limit independently to each file.
- Files are processed sequentially; malformed, unreadable, and oversized cases
  do not prevent other discovered files from being summarized.
- Readable cases use the SHA-256 of their exact bundle bytes as their only
  identity. Reports contain no filenames or paths and sort cases by hash.
- The batch report includes aggregate intake, validity, and drift counts plus a
  value-redacted single-replay summary for every valid case. Invalid readable
  cases contain only their hash and status.
- Exit code `0` covers clean batches and non-verifying drift, `2` covers valid
  drift under `--verify`, and `1` covers intake or bundle errors with precedence
  over drift.
- Single replay summary schema version `2` adds `bundleSha256`; full replay and
  support-bundle schema remain unchanged.
- Parser output and parser version remain unchanged at `46`.

## Non-Goals

- Recursing into support-case directories or accepting symbolic links.
- Treating value-redacted output as automatically safe to publish.
- Including filenames, local paths, or full raw/parsed values in batch output.
- Parallel replay, fixture preparation, fixture comparison, frontend, binding,
  database, parser, or metadata-shape changes.

## Verification

- CLI tests cover classification, deterministic hash ordering, rename
  stability, privacy omissions, ignored entries, limits, invalid-case
  continuation, argument conflicts, and exit-code precedence.
- Replay tests cover the exact input-byte hash and summary schema version `2`.
- ComfyUI diagnostics and parser regression suites, formatting, diff hygiene,
  parser-version stability, and lockfile stability form the completion gate.
