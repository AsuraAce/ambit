# Viewer and Settings UX Follow-up

Status: Implementation Complete — Owner Acceptance Pending
Last reviewed: 2026-08-31

## Outcome

Close the interaction defects deliberately deferred from the light-theme and semantic-palette pass without reopening the color contract or changing persistence, native commands, generated bindings, or public APIs.

## Scope

- Clip Gallery image and posterless-video media, privacy blur, and Hidden Content overlays to the card radius.
- Replace duplicate highlighted prompt boxes with one newline-preserving read surface that swaps to a textarea only while editing.
- Keep Workflow headings readable at narrow widths, present parser-selected anchors as equal responsive controls, and keep developer Parser Diagnostics collapsed, lazy, and inside the scroll flow.
- Remove category and subtab slide/zoom motion from Settings, retain only short opacity feedback, and honor reduced-motion preferences for modal open and close.
- Keep Settings category focus visible for keyboard navigation without showing a transient ring on pointer activation, and suppress the native outline on the programmatically focused Gallery workspace container.

## Non-goals

- Do not change integration action alignment, saved automatic-update preferences in development, parser behavior, SQLite, migrations, Rust commands, or generated TypeScript bindings.
- Do not redesign the established sage, amethyst, harbor, or ember palette.

## Acceptance

- Gallery privacy masking does not leak square media corners at image or posterless-video sizes.
- Positive and negative prompts have one formatted read surface, inline search highlights, blur-to-save, and Escape-to-cancel behavior.
- Workflow controls wrap without collapsing the Node Graph label; diagnostics do not obscure node content or load before expansion.
- Switching Settings categories and connection subtabs does not slide or zoom newly mounted pages; reduced-motion users receive no modal scale animation.
- Pointer activation does not draw a transient ring around Settings categories; keyboard focus remains visible in both themes, and the noninteractive Gallery workspace does not acquire a native outer outline.
- Focused regressions, lint, typecheck, the complete frontend suite, build, and a changed-color audit pass before commit.
