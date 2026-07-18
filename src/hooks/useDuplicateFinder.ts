import { useCallback, useMemo, useRef, useState } from 'react';
import type { ExactDuplicateResolution } from '../bindings';
import type { AIImage } from '../types';

export interface DuplicateGroup {
    id: string;
    images: AIImage[];
    latestModifiedId: string;
}

type ModifiedTimeStrategy = 'latestModified' | 'earliestModified';

const compareByModifiedTime = (left: AIImage, right: AIImage): number => (
    left.timestamp - right.timestamp || left.id.localeCompare(right.id)
);

const chooseByModifiedTime = (images: AIImage[], strategy: ModifiedTimeStrategy): AIImage => {
    const sorted = [...images].sort(compareByModifiedTime);
    return strategy === 'latestModified' ? sorted[sorted.length - 1] : sorted[0];
};

export const useDuplicateFinder = (
    images: AIImage[],
    onResolve: (resolutions: ExactDuplicateResolution[]) => Promise<void>
) => {
    const [isResolving, setIsResolving] = useState(false);
    const resolvingRef = useRef(false);

    const groups = useMemo<DuplicateGroup[]>(() => {
        const hashBuckets = new Map<string, AIImage[]>();

        for (const image of images) {
            if (image.groupId || image.isDeleted || image.isMissing || image.isIntermediate) continue;
            const hash = image.fileHash?.trim();
            if (!hash) continue;
            const bucket = hashBuckets.get(hash);
            if (bucket) bucket.push(image);
            else hashBuckets.set(hash, [image]);
        }

        const results: DuplicateGroup[] = [];
        for (const [hash, matches] of hashBuckets) {
            if (matches.length <= 1) continue;
            results.push({
                id: `exact_${hash}`,
                images: matches,
                latestModifiedId: chooseByModifiedTime(matches, 'latestModified').id,
            });
        }
        return results;
    }, [images]);

    const totalRedundantCount = useMemo(
        () => groups.reduce((count, group) => count + group.images.length - 1, 0),
        [groups]
    );

    const resolve = useCallback(async (resolutions: ExactDuplicateResolution[]) => {
        if (resolutions.length === 0 || resolvingRef.current) return;
        resolvingRef.current = true;
        setIsResolving(true);
        try {
            await onResolve(resolutions);
        } finally {
            resolvingRef.current = false;
            setIsResolving(false);
        }
    }, [onResolve]);

    const handleResolve = useCallback(async (keepId: string, allIds: string[]) => {
        await resolve([{
            keepId,
            removeIds: allIds.filter(id => id !== keepId),
        }]);
    }, [resolve]);

    const handleBulkResolve = useCallback(async (strategy: ModifiedTimeStrategy) => {
        const resolutions = groups.map(group => {
            const keeper = chooseByModifiedTime(group.images, strategy);
            return {
                keepId: keeper.id,
                removeIds: group.images.filter(image => image.id !== keeper.id).map(image => image.id),
            };
        });
        await resolve(resolutions);
    }, [groups, resolve]);

    return {
        groups,
        totalRedundantCount,
        isResolving,
        handleResolve,
        handleBulkResolve,
    };
};
