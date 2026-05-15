# Contributing To Ambit

Thanks for helping improve Ambit. The project is in public beta, so changes should stay focused, reviewable, and easy to validate.

## Development Setup

Prerequisites:

- Node.js 20 or newer
- pnpm 9 or newer
- Rust stable
- Tauri v2 system prerequisites for Windows desktop development

Install and run:

```bash
pnpm install
pnpm run app:dev
```

## Branches And Commits

- Use a focused feature or fix branch.
- Use Conventional Commits, such as `fix: repair metadata import` or `feat: add collection action`.
- Keep pull requests scoped to one concern.

## Checks

Run the narrowest relevant checks for your change before opening a pull request:

```bash
pnpm run typecheck
pnpm run test:run
pnpm run test:rust
pnpm run build
```

For release-facing changes, run:

```bash
pnpm run verify:release
```

If you change Rust command signatures or Rust-backed types, regenerate bindings through the Rust/Specta flow and do not hand-edit `src/bindings.ts`.

## Product Direction

Ambit is local-first. Core library management, browsing, metadata parsing, and search should work without network access. Network behavior must be user-visible and limited to documented opt-in or update-check paths.

Preserve performance-sensitive flows such as virtualized browsing, large-library queries, and background metadata work.
