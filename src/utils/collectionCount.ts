import type { Collection } from '../types';

export type CollectionCountSortDirection = 'asc' | 'desc';

export const getCollectionCount = (collection: Collection): number | undefined => {
    if (collection.count !== undefined) return collection.count;
    return collection.filters ? undefined : collection.imageIds.length;
};

export const compareCollectionsByCount = (
    a: Collection,
    b: Collection,
    direction: CollectionCountSortDirection
): number => {
    const aCount = getCollectionCount(a);
    const bCount = getCollectionCount(b);

    if (aCount === undefined) return bCount === undefined ? 0 : 1;
    if (bCount === undefined) return -1;
    return direction === 'asc' ? aCount - bCount : bCount - aCount;
};
