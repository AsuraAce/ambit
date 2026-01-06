import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FilterState, SortOption, AppSettings, AIImage, Collection } from '../types';
import { searchImages, countImages, countGlobalImages } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

interface UseImagesQueryProps {
    filters: FilterState;
    sortOption: SortOption;
    settings: AppSettings;
    privacyEnabled: boolean;
    allCollections: Collection[];
    settingsLoaded?: boolean;
}

export const useImagesQuery = ({
    filters,
    sortOption,
    settings,
    privacyEnabled,
    allCollections,
    settingsLoaded = true
}: UseImagesQueryProps) => {

    const PAGE_SIZE = 1000;

    // Stable reference: only track the active collection's smart filter definition
    const activeCollectionId = filters.collectionId;
    const activeCollection = useMemo(() =>
        allCollections.find(c => c.id === activeCollectionId),
        [allCollections, activeCollectionId]
    );

    // Create stable fingerprint of smart collection filters (if any)
    // This prevents cache invalidation when unrelated collection counts change
    const smartFilterHash = useMemo(() =>
        activeCollection?.filters ? JSON.stringify(activeCollection.filters) : null,
        [activeCollection?.filters]
    );

    return useInfiniteQuery({
        queryKey: ['images', filters, sortOption, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash],
        queryFn: async ({ pageParam = 0 }) => {
            const { where, params } = buildSqlWhereClause(
                filters,
                privacyEnabled,
                settings.maskingMode,
                settings.maskedKeywords,
                allCollections
            );

            let sortField = 'timestamp';
            let sortOrder: 'ASC' | 'DESC' = 'DESC';

            switch (sortOption) {
                case 'date_asc': sortField = 'timestamp'; sortOrder = 'ASC'; break;
                case 'name_asc': sortField = 'path'; sortOrder = 'ASC'; break;
                case 'name_desc': sortField = 'path'; sortOrder = 'DESC'; break;
                case 'size_desc': sortField = 'file_size'; sortOrder = 'DESC'; break;
                case 'size_asc': sortField = 'file_size'; sortOrder = 'ASC'; break;
                case 'date_desc': default: sortField = 'timestamp'; sortOrder = 'DESC'; break;
            }

            const prioritizePinned = filters.collectionId !== null;

            // Parallelize count and search for the first page
            if (pageParam === 0) {
                const [images, totalCount, globalCount] = await Promise.all([
                    searchImages(where, params, PAGE_SIZE, 0, sortField, sortOrder, prioritizePinned),
                    countImages(where, params),
                    countGlobalImages() // Fast path: no JOIN, simple indexed count
                ]);
                return { images, totalCount, globalCount, nextOffset: PAGE_SIZE };
            } else {
                const offset = pageParam as number;
                const images = await searchImages(where, params, PAGE_SIZE, offset, sortField, sortOrder, prioritizePinned);
                return { images, totalCount: -1, globalCount: -1, nextOffset: offset + PAGE_SIZE };
            }
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            if (lastPage.images.length < PAGE_SIZE) return undefined;
            return lastPage.nextOffset;
        },
        placeholderData: (previousData) => previousData, // Keep previous data while fetching new filter results? No, usually we want to clear for new filters.
        // Actually for infinite scroll we usually want to keep previous data when fetching *next page*, but when filters change React Query handles it by changing key.
        // We can use placeholderData to keep showing old results while loading new filter? Maybe standard loading is better.
        enabled: settingsLoaded, // Wait for settings to load before fetching to prevent duplicate queries
    });
};
