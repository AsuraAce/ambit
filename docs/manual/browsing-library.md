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

The scope dropdown beside search offers one choice: **All Media**, **All Images**, **Videos**, **Generated Images**, **Photos**, or **Other Images**. All Media is the initial default. The active choice persists across restarts. All Images always shows every image within your current search and collection; it never restores a previous subtype. To return to photos after viewing videos, select Photos directly. Legacy preferences containing only an image kind restore that image scope.

Exactly one option is checked, and the closed selector uses the same label. The subdued **Media** heading groups All Media, All Images and Videos; **Image Kind** groups Generated Images, Photos and Other Images. These headings provide visual structure, not separate filters. An image-kind section with no available choices is omitted. There is no separately remembered image kind under All Media or Videos. Opening a collection uses All Media and clears manual refinements. Selecting the same collection again removes only collection selection. Clear filters resets the scope to All Media while keeping the selected collection.

Counts reflect the surrounding search, collection, and filters. The closed scope selector shows its label only; counts appear inside the dropdown. Large counts use compact notation such as `211k` and `1.2M`, with exact values available on hover and to assistive technology. The toolbar's right-hand summary shows the count above the current collection name (or Library); long names truncate with the full name available on hover. Categories confirmed absent from your accessible library are hidden, but a zero-result search does not hide available categories. All Media, All Images and the selected option remain accessible; unknown availability keeps options visible. Image-kind rules can also be saved in smart collections.

Saved smart-collection media/kind rules remain in force: dropdown choices only narrow them. In a Photos-only collection, All Images still returns only its photos, and Generated Images returns zero. Dropdown counts respect those saved rules.

With the scope button focused, Enter or Space opens at the current choice; Down or Up opens at the first or last action. Inside the menu, arrows navigate, Home/End reach the endpoints, and Enter/Space selects. Escape closes and returns to the button. Tab or Shift+Tab closes and continues through the toolbar.

The **View** menu separates **Layout**, **Thumbnail Size**, and available **Visibility** controls. Layout choices appear in Grid View; thumbnail size is available in Grid and Timeline. **Start Slideshow** sits beside View on wider workspaces. On narrower workspaces, Import, Live Watch, and Slideshow move into the actions overflow while a watch-status indicator remains visible; Sort joins them at the narrowest layout. Sort options pair icons with their labels and retain a selected checkmark. Search, scope, View, and overflow stay in one toolbar row.

When hidden content is available, the View menu offers controls for showing it. `Show InvokeAI Image Assets` reveals InvokeAI user, control, mask, and other source images, which are hidden from ordinary browsing by default. The preference persists across restarts and applies to the current library result set, including collections, pinned results, statistics, and slideshows. Collection sidebar counts and saved collection thumbnails do not change with this display preference.

Dropdown counts load independently after the gallery is ready. A dash means the count is not yet available, not zero. If counting fails, the gallery remains usable and **Retry counts** in the dropdown retries the failed counts.

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

Use the scope dropdown beside search to choose All Media, All Images, an image category, or Videos. Video cards show a static poster or placeholder with duration; browsing does not start background players. Open a video for playback, metadata, notes, collections, or original-file export. Media type can also be saved in a smart collection's filters.

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
