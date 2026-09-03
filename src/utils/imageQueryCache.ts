import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { AIImage } from '../types';

interface ImagesPage {
    images: AIImage[];
    totalCount: number;
    globalCount: number;
}

type ImagesQueryData = InfiniteData<ImagesPage, unknown>;

interface ImageQueryOrderOptions {
    previousOrder?: readonly AIImage[];
    nextOrder?: readonly AIImage[];
    reorderQueryKey?: QueryKey;
}

const hasSameImageOrder = (images: readonly AIImage[], order: readonly AIImage[]): boolean => (
    images.length === order.length && images.every((image, index) => image.id === order[index]?.id)
);

const pageImagesChanged = (pages: ImagesPage[], nextPages: ImagesPage[]): boolean => (
    pages.some((page, pageIndex) => (
        page.images.length !== nextPages[pageIndex]?.images.length
        || page.images.some((image, imageIndex) => image !== nextPages[pageIndex]?.images[imageIndex])
    ))
);

const repartitionImages = (images: readonly AIImage[], pages: ImagesPage[]): ImagesPage[] => {
    let offset = 0;
    return pages.map(page => {
        const pageLength = page.images.length;
        const nextImages = images.slice(offset, offset + pageLength);
        offset += pageLength;
        return { ...page, images: nextImages };
    });
};

const queryKeysMatch = (left: QueryKey, right: QueryKey): boolean => (
    left === right || JSON.stringify(left) === JSON.stringify(right)
);

const updateImagesQueryData = (
    data: ImagesQueryData,
    queryKey: QueryKey,
    updateImage: (image: AIImage) => AIImage,
    options: ImageQueryOrderOptions
): ImagesQueryData => {
    const originalImages = data.pages.flatMap(page => page.images);
    const shouldReorder = !!options.reorderQueryKey
        && !!options.previousOrder
        && !!options.nextOrder
        && queryKeysMatch(queryKey, options.reorderQueryKey)
        && hasSameImageOrder(originalImages, options.previousOrder);

    let changed = false;
    const pages = data.pages.map(page => {
        let pageChanged = false;
        const images = page.images.map(image => {
            const nextImage = updateImage(image);
            if (nextImage !== image) pageChanged = true;
            return nextImage;
        });

        if (!pageChanged) return page;
        changed = true;
        return { ...page, images };
    });

    if (shouldReorder && options.nextOrder) {
        const patchedById = new Map(pages.flatMap(page => page.images).map(image => [image.id, image]));
        const orderedImages = options.nextOrder.map(image => patchedById.get(image.id) ?? image);
        const orderedPages = repartitionImages(orderedImages, pages);
        return changed || pageImagesChanged(data.pages, orderedPages)
            ? { ...data, pages: orderedPages }
            : data;
    }

    return changed ? { ...data, pages } : data;
};

export const updateImagesQueryCaches = (
    queryClient: QueryClient,
    updateImage: (image: AIImage) => AIImage,
    options: ImageQueryOrderOptions = {}
): void => {
    queryClient.getQueriesData<ImagesQueryData>({ queryKey: ['images'] }).forEach(([queryKey, data]) => {
        if (!data) return;
        const nextData = updateImagesQueryData(data, queryKey, updateImage, options);
        if (nextData !== data) {
            queryClient.setQueryData(queryKey, nextData);
        }
    });
};

export const removeImagesFromQueryCaches = (
    queryClient: QueryClient,
    ids: Iterable<string>
): void => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;

    queryClient.getQueriesData<ImagesQueryData>({ queryKey: ['images'] }).forEach(([queryKey, data]) => {
        if (!data) return;

        const removedIds = new Set<string>();
        const pages = data.pages.map(page => {
            const images = page.images.filter(image => {
                if (!idSet.has(image.id)) return true;
                removedIds.add(image.id);
                return false;
            });
            return images.length === page.images.length ? page : { ...page, images };
        });

        if (removedIds.size === 0) return;

        const removedCount = removedIds.size;
        const nextPages = pages.map(page => {
            const totalCount = page.totalCount < 0
                ? page.totalCount
                : Math.max(0, page.totalCount - removedCount);
            const globalCount = page.globalCount < 0
                ? page.globalCount
                : Math.max(0, page.globalCount - removedCount);
            return totalCount === page.totalCount && globalCount === page.globalCount
                ? page
                : { ...page, totalCount, globalCount };
        });

        queryClient.setQueryData(queryKey, { ...data, pages: nextPages });
    });
};

export const patchImageFlagsInQueryCaches = (
    queryClient: QueryClient,
    ids: Iterable<string>,
    patch: Pick<Partial<AIImage>, 'isFavorite' | 'isPinned'>,
    options?: ImageQueryOrderOptions
): void => {
    const idSet = new Set(ids);
    updateImagesQueryCaches(queryClient, image => (
        idSet.has(image.id) ? { ...image, ...patch } : image
    ), options);
};

export const restoreImagesInQueryCaches = (
    queryClient: QueryClient,
    previousImages: AIImage[],
    options?: ImageQueryOrderOptions
): void => {
    const previousById = new Map(previousImages.map(image => [image.id, image]));
    updateImagesQueryCaches(queryClient, image => previousById.get(image.id) ?? image, options);
};
