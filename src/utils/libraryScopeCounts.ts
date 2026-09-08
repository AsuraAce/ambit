import type { LibraryScopeCounts } from '../types';

export const createEmptyLibraryScopeCounts = (): LibraryScopeCounts => ({
    media: { all: 0, image: 0, video: 0 },
    imageKinds: { all: 0, generated: 0, photograph: 0, other: 0 },
});

/** Native grouped rows and browser fixtures use the same media/kind accounting. */
export const addLibraryScopeCount = (
    counts: LibraryScopeCounts,
    mediaType: string | null | undefined,
    sourceKind: string | null | undefined,
    count = 1
): void => {
    counts.media.all += count;
    if (mediaType === 'video') {
        counts.media.video += count;
        return;
    }
    counts.media.image += count;
    counts.imageKinds.all += count;
    const kind = sourceKind === 'generated' || sourceKind === 'photograph' ? sourceKind : 'other';
    counts.imageKinds[kind] += count;
};
