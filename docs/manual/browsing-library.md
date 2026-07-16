# Browsing The Library

[Back to manual index](index.md)

The library is the main place to review images after Ambit has scanned folders or files.

## Views

Use the left sidebar to switch between:

- Grid View for thumbnail browsing.
- Timeline View for time-based browsing.
- Statistics for library summaries.
- Maintenance for cleanup workflows.

The filter button opens or closes the library panel. Favorites Only and Pinned Only buttons narrow the current view without changing your source files.

## Grid Browsing

Grid View is designed for large libraries. Ambit uses virtualized rendering so it can browse many images without drawing every record at once.

Typical grid actions:

- click an image to open the viewer
- use selection actions for batch work
- mark images as favorites
- pin images for quick resurfacing
- right-click images for context-specific actions

## Timeline Browsing

Timeline View is useful when you remember when a batch was generated. It uses the same library data and filters as Grid View, but presents images around time.

## Statistics

Statistics follow the active library filters. Avg. Steps is the rounded mean for currently filtered images with a recorded positive step count; images with missing, zero, or negative steps are excluded. An em dash means no recorded step average is available for the current view.

## Selection

Ambit supports common selection patterns:

- `Ctrl + Click` toggles individual selection.
- `Shift + Click` selects a range.
- `Ctrl + A` selects all visible items.
- `Esc` clears selection or closes an open dialog.

Open the Help button in the sidebar for the current shortcut reference.

## Viewer Entry

Open an image to enter the viewer. From the viewer you can navigate next and previous images, zoom and pan, toggle theater mode, favorite or pin the image, copy/open/share when supported, and inspect metadata in the sidebar.

## Privacy Masking

If content masking is configured, images with matching prompt keywords can be blurred or hidden depending on your Privacy settings. You can toggle global privacy mode with `Shift + H`.

## Next Step

For narrowing large libraries, continue with [Search, Filters, And Collections](search-filters-collections.md).
