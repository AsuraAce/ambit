import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { AIImage } from '../types';

interface ImagesPage {
    images: AIImage[];
}

type ImagesQueryData = InfiniteData<ImagesPage, unknown>;

export interface ImageCounts {
    totalCount: number;
    globalCount: number;
}

const IMAGE_COUNTS_KEY = 'counts';

/** The counts for an images query sit under its key, so invalidating ['images'] refreshes both. */
export const getImageCountsQueryKey = <Key extends QueryKey>(imagesQueryKey: Key) => [...imagesQueryKey, IMAGE_COUNTS_KEY] as const;

const getImagesQueriesData = (queryClient: QueryClient) =>
    queryClient.getQueriesData<ImagesQueryData>({
        queryKey: ['images'],
        predicate: (query) => query.queryKey[query.queryKey.length - 1] !== IMAGE_COUNTS_KEY,
    });

interface ImageQueryOrderOptions {
    previousOrder?: readonly AIImage[];
    nextOrder?: readonly AIImage[];
    reorderQueryKey?: QueryKey;
}

export const hasSameImageOrder = (images: readonly AIImage[], order: readonly AIImage[]): boolean =>
    images.length === order.length && images.every((image, index) => image.id === order[index]?.id);

const pageImagesChanged = (pages: ImagesPage[], nextPages: ImagesPage[]): boolean =>
    pages.some(
        (page, pageIndex) =>
            page.images.length !== nextPages[pageIndex]?.images.length ||
            page.images.some((image, imageIndex) => image !== nextPages[pageIndex]?.images[imageIndex])
    );

const repartitionImages = (images: readonly AIImage[], pages: ImagesPage[]): ImagesPage[] => {
    let offset = 0;
    return pages.map((page) => {
        const pageLength = page.images.length;
        const nextImages = images.slice(offset, offset + pageLength);
        offset += pageLength;
        return { ...page, images: nextImages };
    });
};

const queryKeysMatch = (left: QueryKey, right: QueryKey): boolean => left === right || JSON.stringify(left) === JSON.stringify(right);

const updateImagesQueryData = (
    data: ImagesQueryData,
    queryKey: QueryKey,
    updateImage: (image: AIImage) => AIImage,
    options: ImageQueryOrderOptions
): ImagesQueryData => {
    const originalImages = data.pages.flatMap((page) => page.images);
    const shouldReorder =
        !!options.reorderQueryKey &&
        !!options.previousOrder &&
        !!options.nextOrder &&
        queryKeysMatch(queryKey, options.reorderQueryKey) &&
        hasSameImageOrder(originalImages, options.previousOrder);

    let changed = false;
    const pages = data.pages.map((page) => {
        let pageChanged = false;
        const images = page.images.map((image) => {
            const nextImage = updateImage(image);
            if (nextImage !== image) pageChanged = true;
            return nextImage;
        });

        if (!pageChanged) return page;
        changed = true;
        return { ...page, images };
    });

    if (shouldReorder && options.nextOrder) {
        const patchedById = new Map(pages.flatMap((page) => page.images).map((image) => [image.id, image]));
        const orderedImages = options.nextOrder.map((image) => patchedById.get(image.id) ?? image);
        const orderedPages = repartitionImages(orderedImages, pages);
        return changed || pageImagesChanged(data.pages, orderedPages) ? { ...data, pages: orderedPages } : data;
    }

    return changed ? { ...data, pages } : data;
};

export const updateImagesQueryCaches = (
    queryClient: QueryClient,
    updateImage: (image: AIImage) => AIImage,
    options: ImageQueryOrderOptions = {}
): void => {
    getImagesQueriesData(queryClient).forEach(([queryKey, data]) => {
        if (!data) return;
        const nextData = updateImagesQueryData(data, queryKey, updateImage, options);
        if (nextData !== data) {
            queryClient.setQueryData(queryKey, nextData);
        }
    });
};

export const removeImagesFromQueryCaches = (queryClient: QueryClient, ids: Iterable<string>): void => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;

    getImagesQueriesData(queryClient).forEach(([queryKey, data]) => {
        if (!data) return;

        const removedIds = new Set<string>();
        const pages = data.pages.map((page) => {
            const images = page.images.filter((image) => {
                if (!idSet.has(image.id)) return true;
                removedIds.add(image.id);
                return false;
            });
            return images.length === page.images.length ? page : { ...page, images };
        });

        if (removedIds.size === 0) return;

        queryClient.setQueryData(queryKey, { ...data, pages });

        const removedCount = removedIds.size;
        queryClient.setQueryData<ImageCounts>(getImageCountsQueryKey(queryKey), (counts) =>
            counts
                ? {
                      totalCount: Math.max(0, counts.totalCount - removedCount),
                      globalCount: Math.max(0, counts.globalCount - removedCount),
                  }
                : counts
        );
    });
};

export const patchImageFlagsInQueryCaches = (
    queryClient: QueryClient,
    ids: Iterable<string>,
    patch: Pick<Partial<AIImage>, 'isFavorite' | 'isPinned'>,
    options?: ImageQueryOrderOptions
): void => {
    const idSet = new Set(ids);
    updateImagesQueryCaches(queryClient, (image) => (idSet.has(image.id) ? { ...image, ...patch } : image), options);
};

/**
 * The field values a failed optimistic write puts back, by image id. Only the images the write
 * touched (#484), and only the fields it changed, so other actions' changes stay (#492).
 */
export type ImageFieldReverts = ReadonlyMap<string, Partial<AIImage>>;

const revertImageFields = (image: AIImage, reverts: ImageFieldReverts): AIImage => {
    const patch = reverts.get(image.id);
    return patch ? { ...image, ...patch } : image;
};

/**
 * Reverts an optimistic change in the store's image list the way revertImageFieldsInQueryCaches does
 * in the caches: each image in `reverts` gets its reverted fields back, and `nextOrder` returns only
 * while the list still has `previousOrder`. A list that now belongs to another view keeps its own images.
 */
export const revertImageFieldsInList = (
    images: AIImage[],
    reverts: ImageFieldReverts,
    options: Pick<ImageQueryOrderOptions, 'previousOrder' | 'nextOrder'> = {}
): AIImage[] => {
    const revert = (image: AIImage) => revertImageFields(image, reverts);
    if (options.previousOrder && options.nextOrder && hasSameImageOrder(images, options.previousOrder)) {
        const currentById = new Map(images.map((image) => [image.id, image]));
        return options.nextOrder.map((image) => revert(currentById.get(image.id) ?? image));
    }
    const reverted = images.map(revert);
    return reverted.some((image, index) => image !== images[index]) ? reverted : images;
};

export const revertImageFieldsInQueryCaches = (
    queryClient: QueryClient,
    reverts: ImageFieldReverts,
    options?: ImageQueryOrderOptions
): void => {
    updateImagesQueryCaches(queryClient, (image) => revertImageFields(image, reverts), options);
};
