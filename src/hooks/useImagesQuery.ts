import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { measureStartupPhase } from '../utils/startupDiagnostics';
import { FilterState, SortOption, AppSettings, Collection, PaginationCursor } from '../types';
import { searchImages, countImages, countGlobalImages } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { isBrowserMockMode } from '../services/runtime';
import { searchBrowserMockImages } from '../services/browserMockData';
import { getEffectiveMaskedKeywords } from '../utils/maskingUtils';
import { useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';
import { getInvokeOwnerQueryScopeKey, previousQueryMatchesInvokeScope } from '../utils/invokeOwnerQueryScope';
import { getImageCountsQueryKey } from '../utils/imageQueryCache';

interface UseImagesQueryProps {
    filters: FilterState;
    sortOption: SortOption;
    settings: AppSettings;
    privacyEnabled: boolean;
    allCollections: Collection[];
    settingsLoaded?: boolean;
}

export type ImagesQueryKey = readonly [
    'images',
    FilterState,
    SortOption,
    boolean,
    AppSettings['maskingMode'],
    AppSettings['maskedKeywords'],
    string | null,
    string,
];

const hasMatchingPrivacyScope = (previousKey: readonly unknown[] | undefined, currentKey: ImagesQueryKey): boolean => {
    if (!previousKey || previousKey.length < 8) return false;

    const previousKeywords = previousKey[5];
    if (!Array.isArray(previousKeywords)) return false;

    return (
        previousKey[3] === currentKey[3] &&
        previousKey[4] === currentKey[4] &&
        previousKeywords.length === currentKey[5].length &&
        previousKeywords.every((keyword, index) => keyword === currentKey[5][index]) &&
        previousQueryMatchesInvokeScope(previousKey, currentKey[7])
    );
};

// Each collection, smart collection and the Library is its own view. A newly opened view must never
// show the previous view's page or count, which would put images from outside it on screen (#479).
const isSameView = (previousKey: readonly unknown[] | undefined, currentKey: ImagesQueryKey): boolean => {
    const previousFilters = previousKey?.[1];
    return (
        typeof previousFilters === 'object' &&
        previousFilters !== null &&
        'collectionId' in previousFilters &&
        previousFilters.collectionId === currentKey[1].collectionId
    );
};

const canKeepPreviousResult = (previousKey: readonly unknown[] | undefined, currentKey: ImagesQueryKey): boolean =>
    isSameView(previousKey, currentKey) && hasMatchingPrivacyScope(previousKey, currentKey);

export const useImagesQuery = ({
    filters,
    sortOption,
    settings,
    privacyEnabled,
    allCollections,
    settingsLoaded = true,
}: UseImagesQueryProps) => {
    const PAGE_SIZE = 1000;
    const useBrowserMocks = isBrowserMockMode();
    const effectiveMaskedKeywords = getEffectiveMaskedKeywords(settings);
    const invokeOwnerScopeKey = useInvokeOwnerScopeStore((state) =>
        getInvokeOwnerQueryScopeKey(settings.invokeAiPath, state.ownerScopeState)
    );

    // Stable reference: only track the active collection's smart filter definition
    const activeCollectionId = filters.collectionId;
    const activeCollection = useMemo(() => allCollections.find((c) => c.id === activeCollectionId), [allCollections, activeCollectionId]);

    // Create stable fingerprint of smart collection filters (if any)
    // This prevents cache invalidation when unrelated collection counts change
    const smartFilterHash = useMemo(
        () => (activeCollection?.filters ? JSON.stringify(activeCollection.filters) : null),
        [activeCollection?.filters]
    );

    const imagesQueryKey = useMemo<ImagesQueryKey>(
        () => [
            'images',
            filters,
            sortOption,
            privacyEnabled,
            settings.maskingMode,
            effectiveMaskedKeywords,
            smartFilterHash,
            invokeOwnerScopeKey,
        ],
        [effectiveMaskedKeywords, filters, invokeOwnerScopeKey, privacyEnabled, settings.maskingMode, smartFilterHash, sortOption]
    );

    const buildWhere = () => buildSqlWhereClause(filters, privacyEnabled, settings.maskingMode, effectiveMaskedKeywords, allCollections);

    const query = useInfiniteQuery({
        queryKey: imagesQueryKey,
        queryFn: async ({ pageParam }) => {
            if (useBrowserMocks) {
                const cursor = pageParam;
                const page = searchBrowserMockImages(filters, sortOption, PAGE_SIZE, cursor?.id, { privacyEnabled, settings });
                return { images: page.images };
            }

            const { where, params, collectionId, loraName } = buildWhere();

            let sortField = 'display_timestamp';
            let sortOrder: 'ASC' | 'DESC' = 'DESC';

            switch (sortOption) {
                case 'date_asc':
                    sortField = 'display_timestamp';
                    sortOrder = 'ASC';
                    break;
                case 'name_asc':
                    sortField = 'path';
                    sortOrder = 'ASC';
                    break;
                case 'name_desc':
                    sortField = 'path';
                    sortOrder = 'DESC';
                    break;
                case 'size_desc':
                    sortField = 'file_size';
                    sortOrder = 'DESC';
                    break;
                case 'size_asc':
                    sortField = 'file_size';
                    sortOrder = 'ASC';
                    break;
                case 'date_desc':
                default:
                    sortField = 'display_timestamp';
                    sortOrder = 'DESC';
                    break;
            }

            const prioritizePinned = filters.collectionId !== null;

            // The first page never waits for its counts, which run in their own query below.
            // collectionId/loraName enables INNER JOIN optimization for filtered queries
            if (pageParam === undefined) {
                const startedAt = performance.now();
                const images = await measureStartupPhase('first-page', () =>
                    searchImages(where, params, PAGE_SIZE, sortField, sortOrder, prioritizePinned, collectionId, loraName, undefined)
                );
                const elapsedMs = Math.round(performance.now() - startedAt);
                console.log(`[Perf] useImagesQuery: initial fetch ${elapsedMs}ms, returned ${images.length} images`);
                return { images };
            } else {
                const cursor = pageParam;
                const startedAt = performance.now();
                const images = await searchImages(
                    where,
                    params,
                    PAGE_SIZE,
                    sortField,
                    sortOrder,
                    prioritizePinned,
                    collectionId,
                    loraName,
                    cursor
                );
                const elapsedMs = Math.round(performance.now() - startedAt);
                console.log(`[Perf] useImagesQuery: load more ${elapsedMs}ms`);
                return { images };
            }
        },
        initialPageParam: undefined as PaginationCursor | undefined,
        getNextPageParam: (lastPage) => {
            if (lastPage.images.length < PAGE_SIZE) return undefined;
            const lastImage = lastPage.images[lastPage.images.length - 1];

            // Determine sort value based on current sort
            // This needs access to 'sortOption' which is in closure scope
            let val: string | number;

            // Map sort options to field values
            if (sortOption === 'name_asc' || sortOption === 'name_desc') val = lastImage.filename;
            else if (sortOption === 'size_asc' || sortOption === 'size_desc') val = lastImage.fileSize || 0;
            else val = lastImage.displayTimestamp ?? lastImage.timestamp;

            return {
                val,
                id: lastImage.id,
                isPinned: lastImage.isPinned ? 1 : 0,
            };
        },
        placeholderData: (previousData, previousQuery) => {
            if (!previousData) return undefined;

            // Search, filter and sort changes inside one view retain their prior page, including an
            // empty one, so typing does not flicker. Opening another view, or changing the privacy
            // scope, fails closed until the new page is ready.
            return canKeepPreviousResult(previousQuery?.queryKey, imagesQueryKey) ? previousData : undefined;
        },
        gcTime: 1000 * 60 * 10,
        enabled: settingsLoaded, // Wait for settings to load before fetching to prevent duplicate queries
    });

    // Nested under the images key, so every invalidation of ['images'] refreshes the counts too.
    const countsQuery = useQuery({
        queryKey: getImageCountsQueryKey(imagesQueryKey),
        queryFn: async () => {
            if (useBrowserMocks) {
                const { totalCount, globalCount } = searchBrowserMockImages(filters, sortOption, 1, undefined, {
                    privacyEnabled,
                    settings,
                });
                return { totalCount, globalCount };
            }

            const { where, params, collectionId, loraName } = buildWhere();
            const [totalCount, globalCount] = await Promise.all([
                countImages(where, params, collectionId, loraName),
                countGlobalImages(), // Fast path: no JOIN, simple indexed count
            ]);
            return { totalCount, globalCount };
        },
        // Like the page, a search or sort change keeps the last count until the new one arrives.
        // Opening another view, or a privacy or owner-scope change, reads as loading ("—"): the old
        // count would describe images this view or scope does not show.
        // The counts key is the images key plus 'counts', so the check compares that prefix.
        placeholderData: (previousData, previousQuery) =>
            previousData && canKeepPreviousResult(previousQuery?.queryKey.slice(0, -1), imagesQueryKey) ? previousData : undefined,
        gcTime: 1000 * 60 * 10,
        enabled: settingsLoaded,
    });

    return {
        ...query,
        queryKey: imagesQueryKey,
        counts: countsQuery.data,
        /** The counts shown are the previous search's, kept while this one's count loads. */
        countsArePlaceholder: countsQuery.isPlaceholderData,
        // The read failed and nothing is cached: the counts stay unknown until the next refresh.
        countsFailed: countsQuery.isError && countsQuery.data === undefined,
    };
};
