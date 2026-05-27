import type { AIImage } from '../types';

export const applyOptimisticPinOrder = (
    images: readonly AIImage[],
    ids: Iterable<string>,
    isPinned: boolean,
    prioritizePinned: boolean
): AIImage[] => {
    const idSet = new Set(ids);
    const updated = images.map(image => (
        idSet.has(image.id) ? { ...image, isPinned } : image
    ));

    if (!prioritizePinned) return updated;

    return [...updated].sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
};
