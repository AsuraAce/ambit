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

The scope dropdown beside search combines **Media type** (All Media, Images, Videos) and **Image kind** (All Images, Generated, Photos, Other). All Media is the initial default. Selecting an image kind switches to Images; All Media and Videos ignore that kind, while returning to Images restores it. Both choices persist across restarts. Clear filters resets both to All. Existing non-All image-kind preferences upgrade to Images.

Counts reflect the surrounding search, collection, and filters. The closed scope selector shows its label only; counts appear inside the dropdown. Large counts use compact notation such as `211k` and `1.2M`, with exact values available on hover and to assistive technology. The toolbar's right-hand summary shows the count above the current collection name (or Library); long names truncate with the full name available on hover. Categories absent from your accessible library are hidden, but a zero-result search does not hide available categories. All and your selected/remembered options remain accessible. Image-kind rules can also be saved in smart collections.

The **View** menu separates **Layout**, **Thumbnail Size**, and available **Visibility** controls. Layout choices appear in Grid View; thumbnail size is available in Grid and Timeline. **Start Slideshow** sits beside View on wider workspaces. On narrower workspaces, Import, Live Watch, and Slideshow move into the actions overflow while a watch-status indicator remains visible; Sort joins them at the narrowest layout. Sort options pair icons with their labels and retain a selected checkmark. Search, scope, View, and overflow stay in one toolbar row.

When hidden content is available, the View menu offers controls for showing it. `Show InvokeAI Image Assets` reveals InvokeAI user, control, mask, and other source images, which are hidden from ordinary browsing by default. The preference persists across restarts and applies to the current library result set, including collections, pinned results, statistics, and slideshows. Collection sidebar counts and saved collection thumbnails do not change with this display preference.

## Grid Browsing

Grid View is designed for large libraries. Ambit uses virtualized rendering so it can browse many images without drawing every record at once.

Typical grid actions:

- click an image to open the viewer
- use selection actions for batch work
- mark images as favorites
- pin images for quick resurfacing
- right-click images for context-specific actions
- correct a misclassified image from Image Kind in the context menu

Revealed InvokeAI image assets carry an `Asset · User`, `Asset · Control`, `Asset · Mask`, or `Asset · Other` badge centered along the top of the card. The badge stays in place when the selection control appears in the upper-left corner. Missing or unrecognized InvokeAI categories are not hidden or marked.

## Videos In The Library

Use the scope dropdown beside search to choose All Media, Images, or Videos. Video cards show a static poster or placeholder with duration; browsing does not start background players. Open a video for playback, metadata, notes, collections, or original-file export. Media type can also be saved in a smart collection's filters.

## Timeline Browsing

Timeline View is useful when you remember when an image was created or captured. Generated and Other images use file-modified time. Photos use their embedded capture date when available, while technical details retain the raw file-modified time.

## Statistics

Statistics follow the active library filters. Avg. Steps is the rounded mean for currently filtered images with a recorded positive step count; images with missing, zero, or negative steps are excluded. An em dash means no recorded step average is available for the current view.

## Selection

Ambit supports common selection patterns:

- `Ctrl + Click` toggles individual selection.
- `Shift + Click` selects a range.
- `Ctrl + A` selects all visible items.
- `Esc` clears selection or closes an open dialog.

The selection bar can apply Image Kind to every selected image. Automatic restores metadata detection; Generated, Photo, and Other create a manual choice that survives metadata refreshes.

Open the Help button in the sidebar for the current shortcut reference.

## Viewer Entry

Open an image to enter the viewer. From the viewer you can navigate next and previous images, zoom and pan, toggle theater mode, favorite or pin the image, copy/open/share when supported, and inspect metadata in the sidebar.

## Privacy Masking

If content masking is configured, images with matching prompt keywords can be blurred or hidden depending on your Privacy settings. You can toggle global privacy mode with `Shift + H`.

## Next Step

For narrowing large libraries, continue with [Search, Filters, And Collections](search-filters-collections.md).
