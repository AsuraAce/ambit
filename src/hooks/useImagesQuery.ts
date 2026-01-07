import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FilterState, SortOption, AppSettings, AIImage, Collection, PaginationCursor } from '../types';
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
        queryFn: async ({ pageParam }) => {
            const { where, params, collectionId, loraName } = buildSqlWhereClause(
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
            // collectionId/loraName enables INNER JOIN optimization for filtered queries
            if (pageParam === undefined) {
                const [images, totalCount, globalCount] = await Promise.all([
                    searchImages(where, params, PAGE_SIZE, sortField, sortOrder, prioritizePinned, collectionId, loraName, undefined),
                    countImages(where, params, collectionId, loraName),
                    countGlobalImages() // Fast path: no JOIN, simple indexed count
                ]);
                return { images, totalCount, globalCount };
            } else {
                const cursor = pageParam as PaginationCursor;
                // Note: offset removed from searchImages signature
                const images = await searchImages(where, params, PAGE_SIZE, sortField, sortOrder, prioritizePinned, collectionId, loraName, cursor);
                return { images, totalCount: -1, globalCount: -1 };
            }
        },
        initialPageParam: undefined as PaginationCursor | undefined,
        getNextPageParam: (lastPage) => {
            if (lastPage.images.length < PAGE_SIZE) return undefined;
            const lastImage = lastPage.images[lastPage.images.length - 1];

            // Determine sort value based on current sort
            // This needs access to 'sortOption' which is in closure scope
            let val: string | number = lastImage.timestamp;

            // Map sort options to field values
            if (sortOption === 'name_asc' || sortOption === 'name_desc') val = lastImage.path;
            else if (sortOption === 'size_asc' || sortOption === 'size_desc') val = lastImage.file_size;
            else val = lastImage.timestamp;

            return {
                val,
                id: lastImage.id,
                isPinned: lastImage.isPinned ? 1 : 0
            };
        },
        placeholderData: (previousData) => previousData, // Keep previous data while fetching new filter results
        enabled: settingsLoaded, // Wait for settings to load before fetching to prevent duplicate queries
    });
};
