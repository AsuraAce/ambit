import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilterState, AppSettings, Collection, FacetType } from '../types';
import { getFacets, getLibraryStats, Facets, getValidFacetNames, ValidFacetNames } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

interface UseLibraryStatsQueryProps {
    filters: FilterState;
    settings: AppSettings;
    privacyEnabled: boolean;
    allCollections: Collection[];
    settingsLoaded?: boolean;
}


const INITIAL_STATS = {
    totalImages: 0,
    totalGenerations: 0,
    avgSteps: 0,
    estSizeMB: '0',
    modelStats: [],
    keywordStats: []
};

const INITIAL_FACETS: Facets = {
    checkpoints: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    tools: []
};

export const useLibraryStatsQuery = ({
    filters,
    settings,
    privacyEnabled,
    allCollections,
    settingsLoaded = true
}: UseLibraryStatsQueryProps) => {

    // Stable reference: only track the active collection's smart filter definition
    const activeCollectionId = filters.collectionId;
    const activeCollection = useMemo(() =>
        allCollections.find(c => c.id === activeCollectionId),
        [allCollections, activeCollectionId]
    );

    // Create stable fingerprint of smart collection filters (if any)
    const smartFilterHash = useMemo(() =>
        activeCollection?.filters ? JSON.stringify(activeCollection.filters) : null,
        [activeCollection?.filters]
    );

    // Always fetch all facet types - they're cheap from facet_cache
    const ALL_FACET_TYPES: FacetType[] = ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'tools'];

    // Determine if we have any active filters that would benefit from drill-down
    const hasActiveFilters = useMemo(() => {
        return (
            filters.models.length > 0 ||
            filters.loras.length > 0 ||
            filters.embeddings.length > 0 ||
            filters.hypernetworks.length > 0 ||
            filters.tools.length > 0 ||
            !!filters.collectionId ||
            filters.dateRange !== 'all' ||
            filters.favoritesOnly ||
            filters.pinnedOnly ||
            !!filters.searchQuery
        );
    }, [filters]);

    return useQuery({
        queryKey: ['libraryStats', filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash],
        queryFn: async () => {
            const { where, params, collectionId, loraName } = buildSqlWhereClause(
                filters,
                privacyEnabled,
                settings.maskingMode,
                settings.maskedKeywords,
                allCollections
            );

            // Fetch facets and stats in parallel
            // Also fetch valid facet names if we have active filters (for drill-down)
            const [facets, stats, validNames] = await Promise.all([
                getFacets(where, params, ALL_FACET_TYPES),
                getLibraryStats(where, params, collectionId, loraName),
                hasActiveFilters ? getValidFacetNames(where, params, collectionId, loraName) : Promise.resolve(null)
            ]);

            return { facets, stats, validNames };
        },
        placeholderData: (previousData) => previousData ?? { facets: INITIAL_FACETS, stats: INITIAL_STATS, validNames: null as ValidFacetNames | null },
        staleTime: 1000 * 60 * 5, // 5 minutes
        enabled: settingsLoaded, // Wait for settings to load before fetching
    });
};
