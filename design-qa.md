# Design QA — Library image-kind dropdown

- Source visual truth: `C:\Users\Artemis\.codex\generated_images\019f75e1-15c5-7982-9375-a1cd742bc30a\exec-00931d71-49cd-46ac-8a77-420c1c7ce491.png`
- Implementation screenshot: `C:\Users\Artemis\.codex\visualizations\2026\07\18\019f75e1-15c5-7982-9375-a1cd742bc30a\ambit-image-kind-persisted-desktop.png`
- Open-state screenshot: `C:\Users\Artemis\.codex\visualizations\2026\07\18\019f75e1-15c5-7982-9375-a1cd742bc30a\ambit-image-kind-open-desktop.png`
- Combined comparison: `C:\Users\Artemis\.codex\visualizations\2026\07\18\019f75e1-15c5-7982-9375-a1cd742bc30a\ambit-image-kind-comparison.png`
- Source pixels: 1727 × 911
- Browser CSS viewport: 1379 × 727 at devicePixelRatio 2.97
- Implementation capture pixels: 1293 × 727
- Density normalization: the source's left 1619 × 911 region was downsampled to 1293 × 727 to match the browser capture's 16:9 visible region; the implementation image was not rescaled.
- State: dark theme, Library grid, Photos selected after a full page reload, dropdown closed. The separate open-state capture shows all four choices and counts.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the control uses the product's existing compact UI type scale, weights, truncation, and tabular count styling. It preserves the hierarchy shown in the source.
- Spacing and layout rhythm: the dropdown sits immediately after search, remains a single toolbar-height control, and removes the permanent full-width image-kind row and duplicate active-filter row.
- Colors and visual tokens: default All styling is neutral; a scoped choice uses the existing sage selection treatment and dark-surface tokens.
- Image quality and asset fidelity: this change adds no raster assets or replacements. Existing library thumbnails remain on the virtualized grid.
- Copy and content: All, Generated, Photos, and Other match the approved terminology. Count differences between the source and QA profile are dynamic-data differences, not design drift.
- Accessibility and interaction: the trigger is labelled and exposes expanded state; the popup is a labelled dialog containing a radio group; focus enters the selected option, arrow/Home/End/Escape work, and selection restores trigger focus.

The QA-only `Browser Mock` badge crowds adjacent controls at this constrained capture width. It is absent from the shipped Tauri app and is therefore recorded as non-blocking test-profile chrome rather than a product finding.

## Focused evidence

The header control is legible in the full-view comparison, so a separate crop was not required. The open-state screenshot was inspected to verify menu spacing, selection emphasis, count alignment, icon treatment, and focus visibility.

## Interaction verification

- Opened the dropdown and selected Photos.
- Reloaded the page and confirmed Photos remained selected with the expected filtered count.
- Confirmed the permanent image-kind bar and duplicate active-filter strip are absent.
- Checked browser console errors: none.

## Comparison history

- Pass 1: no P0/P1/P2 findings. No visual remediation loop was required.

## Implementation checklist

- [x] Compact dropdown immediately right of search
- [x] All is the default for new and legacy settings
- [x] User choice persists and hydrates before the first library query
- [x] Dropdown interaction and keyboard behavior verified
- [x] No duplicate permanent filter surface

final result: passed
