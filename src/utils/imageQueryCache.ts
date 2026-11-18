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

const hasSameImageOrder = (images: readonly AIImage[], order: readonly AIImage[]): boolean =>
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
 * Reverts an optimistic change in the store's image list the way restoreImagesInQueryCaches does in
 * the caches: each image in `previousImages` replaces the image with its id, and `nextOrder` returns
 * only while the list still has `previousOrder`. Pass only the images the change touched, so a list
 * that now belongs to another view keeps its own images (#484).
 */
export const restoreImagesInList = (
    images: AIImage[],
    previousImages: readonly AIImage[],
    options: Pick<ImageQueryOrderOptions, 'previousOrder' | 'nextOrder'> = {}
): AIImage[] => {
    const previousById = new Map(previousImages.map((image) => [image.id, image]));
    const restore = (image: AIImage) => previousById.get(image.id) ?? image;
    if (options.previousOrder && options.nextOrder && hasSameImageOrder(images, options.previousOrder)) {
        const currentById = new Map(images.map((image) => [image.id, image]));
        return options.nextOrder.map((image) => restore(currentById.get(image.id) ?? image));
    }
    const restored = images.map(restore);
    return restored.some((image, index) => image !== images[index]) ? restored : images;
};

/** The snapshot images an optimistic change touched: the only ones its rollback may restore. */
export const pickImages = (images: readonly AIImage[], ids: Iterable<string>): AIImage[] => {
    const idSet = new Set(ids);
    return images.filter((image) => idSet.has(image.id));
};

export const restoreImagesInQueryCaches = (queryClient: QueryClient, previousImages: AIImage[], options?: ImageQueryOrderOptions): void => {
    const previousById = new Map(previousImages.map((image) => [image.id, image]));
    updateImagesQueryCaches(queryClient, (image) => previousById.get(image.id) ?? image, options);
};
