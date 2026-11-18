import type { AIImage, FilterState, ViewMode } from '../types';

/** A collection draws its pinned images in a shelf above the grid, except in the timeline or when only pinned images are listed. */
export const showsPinnedShelf = (filters: Pick<FilterState, 'collectionId' | 'pinnedOnly'>, viewMode: ViewMode): boolean =>
    filters.collectionId !== null && viewMode !== 'timeline' && !filters.pinnedOnly;

/** The images in the order the library draws them: the pinned shelf first when it shows, then the grid. */
export const orderAsDrawn = (images: AIImage[], showShelf: boolean): AIImage[] =>
    showShelf ? [...images.filter((image) => image.isPinned), ...images.filter((image) => !image.isPinned)] : images;
