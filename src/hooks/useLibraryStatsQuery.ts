import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilterState, AppSettings, Collection, FacetType } from '../types';
import { getFacets, getLibraryStats, Facets, getValidFacetNames, ValidFacetNames } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { useLibraryStore } from '../stores/libraryStore';


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

    // Subscribe to facet cache version - when cache is rebuilt, this changes and triggers refetch
    const facetCacheVersion = useLibraryStore(s => s.facetCacheVersion);

    return useQuery({
        queryKey: ['libraryStats', facetCacheVersion, filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash],
        queryFn: async () => {
            const searchRepo = await import('../services/db/searchRepo');

            // 1. Base Query: Standard intersection of ALL filters
            // This gives us the correct Counts for everything (and Valid Names for ALL-mode categories)
            const { where, params, collectionId, loraName } = buildSqlWhereClause(
                filters,
                privacyEnabled,
                settings.maskingMode,
                settings.maskedKeywords,
                allCollections
            );

            // Fetch facets and stats in parallel
            // Also fetch valid facet names if we have active filters (for drill-down)
            const [facets, stats, baseValidNames] = await Promise.all([
                getFacets(where, params, ALL_FACET_TYPES),
                getLibraryStats(where, params, collectionId, loraName),
                hasActiveFilters ? getValidFacetNames(where, params, collectionId, loraName) : Promise.resolve(null)
            ]);

            // 2. Disjunctive Queries: For categories in ANY mode with active selections
            // We need to fetch their valid names WITHOUT their own filter applied

            const disjunctiveCategories: FacetType[] = [];
            if (activeCollectionId) {
                // Collections are single select, no disjunctive logic needed usually unless we allowed multi-collection
            }
            if (filters.loras.length > 0 && filters.matchModes?.loras !== 'all') disjunctiveCategories.push('loras');
            if (filters.embeddings.length > 0 && filters.matchModes?.embeddings !== 'all') disjunctiveCategories.push('embeddings');
            if (filters.hypernetworks.length > 0 && filters.matchModes?.hypernetworks !== 'all') disjunctiveCategories.push('hypernetworks');
            if (filters.tools.length > 0 && filters.matchModes?.tools !== 'all') disjunctiveCategories.push('tools');
            if (filters.models.length > 0 && filters.matchModes?.models !== 'all') disjunctiveCategories.push('checkpoints');

            let finalValidNames = baseValidNames ? { ...baseValidNames } : null;

            if (disjunctiveCategories.length > 0 && hasActiveFilters) {
                if (!finalValidNames) finalValidNames = {} as ValidFacetNames;

                const extraQueries = disjunctiveCategories.map(async (cat) => {
                    let excludeKey = '';
                    if (cat === 'loras') excludeKey = 'loras';
                    if (cat === 'embeddings') excludeKey = 'embeddings';
                    if (cat === 'hypernetworks') excludeKey = 'hypernetworks';
                    if (cat === 'tools') excludeKey = 'tools';
                    if (cat === 'checkpoints') excludeKey = 'models';

                    // Build "Partial" Where Clause (Global - Self)
                    const partial = buildSqlWhereClause(
                        filters,
                        privacyEnabled,
                        settings.maskingMode,
                        settings.maskedKeywords,
                        allCollections,
                        false,
                        [excludeKey]
                    );

                    const result = await searchRepo.getValidFacetNames(partial.where, partial.params, partial.collectionId, partial.loraName);
                    return { cat, validNames: result[cat] };
                });

                const extraResults = await Promise.all(extraQueries);

                extraResults.forEach(({ cat, validNames }) => {
                    if (validNames && finalValidNames) {
                        finalValidNames[cat] = validNames;
                    }
                });
            }

            return { facets, stats, validNames: finalValidNames };
        },
        placeholderData: (previousData) => previousData ?? { facets: INITIAL_FACETS, stats: INITIAL_STATS, validNames: null as ValidFacetNames | null },
        staleTime: 1000 * 60 * 5, // 5 minutes
        enabled: settingsLoaded, // Wait for settings to load before fetching
    });
};
