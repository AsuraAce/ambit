import {
    commands,
    type ExactDuplicateResolution,
    type ExactDuplicateResolutionResult,
} from '../../bindings';
import type { AIImage } from '../../types';
import { unwrap } from '../../utils/spectaUtils';
import {
    getBrowserMockCollections,
    getBrowserMockImages,
    updateBrowserMockImage,
    upsertBrowserMockCollection,
} from '../browserMockData';
import { isBrowserMockMode } from '../runtime';

export const resolveExactDuplicateGroups = async (
    resolutions: ExactDuplicateResolution[]
): Promise<ExactDuplicateResolutionResult> => {
    if (resolutions.length === 0) {
        return { resolvedGroups: 0, removedIds: [], keepers: [] };
    }

    if (isBrowserMockMode()) {
        const images = getBrowserMockImages();
        const imagesById = new Map(images.map(image => [image.id, image]));
        const seenIds = new Set<string>();
        const validated = resolutions.map(resolution => {
            const keeper = imagesById.get(resolution.keepId);
            const keeperHash = keeper?.fileHash;
            const keeperIsEligible = Boolean(
                keeper
                && !keeper.isDeleted
                && !keeper.isMissing
                && !keeper.groupId
                && !keeper.isIntermediate
                && keeperHash
            );

            if (!keeper || !keeperIsEligible || resolution.removeIds.length === 0) {
                throw new Error('Duplicate set changed; run the scan again');
            }
            for (const id of [resolution.keepId, ...resolution.removeIds]) {
                if (seenIds.has(id)) throw new Error('Duplicate resolution contains overlapping groups');
                seenIds.add(id);
            }

            const removedImages = resolution.removeIds.map(id => imagesById.get(id));
            if (removedImages.some(image => (
                !image
                || image.isDeleted
                || image.isMissing
                || Boolean(image.groupId)
                || image.isIntermediate
                || image.fileHash !== keeperHash
            ))) {
                throw new Error('Duplicate set changed; run the scan again');
            }
            const eligibleRemovedImages = removedImages.filter((image): image is AIImage => Boolean(image));
            const explicitMasks = eligibleRemovedImages
                .map(image => image.userMasked)
                .filter((value): value is boolean => value !== undefined && value !== null);
            const inheritedMask = explicitMasks.length > 0 && explicitMasks.every(value => value === explicitMasks[0])
                ? explicitMasks[0]
                : undefined;
            const keeperState = {
                id: keeper.id,
                isFavorite: keeper.isFavorite || eligibleRemovedImages.some(image => image.isFavorite),
                isPinned: Boolean(keeper.isPinned || eligibleRemovedImages.some(image => image.isPinned)),
                userMasked: keeper.userMasked ?? inheritedMask ?? null,
            };

            return { resolution, keeper, keeperState };
        });

        const keepers: ExactDuplicateResolutionResult['keepers'] = [];
        const removedIds: string[] = [];
        for (const { resolution, keeper, keeperState } of validated) {
            updateBrowserMockImage(keeper.id, {
                isFavorite: keeperState.isFavorite,
                isPinned: keeperState.isPinned,
                userMasked: keeperState.userMasked ?? undefined,
            });
            resolution.removeIds.forEach(id => updateBrowserMockImage(id, { isDeleted: true }));

            for (const collection of getBrowserMockCollections()) {
                const imageIds = collection.imageIds ?? [];
                const containsRemoved = resolution.removeIds.some(id => imageIds.includes(id));
                const nextImageIds = containsRemoved
                    ? [...new Set([...imageIds.filter(id => !resolution.removeIds.includes(id)), keeper.id])]
                    : imageIds;
                const customThumbnail = resolution.removeIds.includes(collection.customThumbnail ?? '')
                    ? keeper.id
                    : collection.customThumbnail;
                if (nextImageIds !== imageIds || customThumbnail !== collection.customThumbnail) {
                    upsertBrowserMockCollection({ ...collection, imageIds: nextImageIds, customThumbnail });
                }
            }

            keepers.push(keeperState);
            removedIds.push(...resolution.removeIds);
        }

        return { resolvedGroups: resolutions.length, removedIds, keepers };
    }

    return unwrap(commands.resolveExactDuplicateGroups(resolutions));
};
