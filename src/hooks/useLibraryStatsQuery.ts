import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AssetScope, FilterState, AppSettings, Collection, FacetType } from '../types';
import { getFacets, getLibraryStats, Facets, getValidFacetNames, ValidFacetNames } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { useLibraryStore } from '../stores/libraryStore';
import { isBrowserMockMode } from '../services/runtime';
import { getBrowserMockFacets, getBrowserMockStats, getBrowserMockValidFacetNames } from '../services/browserMockData';


interface UseLibraryStatsQueryProps {
    filters: FilterState;
    settings: AppSettings;
    privacyEnabled: boolean;
    allCollections: Collection[];
    settingsLoaded?: boolean;
    assetScope?: AssetScope;
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
    controlNets: [],
    ipAdapters: [],
    tools: []
};

const hasRangeFilter = (value: number | null | undefined): boolean =>
    value !== undefined && value !== null;

export const shouldFetchValidFacets = (
    filters: FilterState,
    privacyEnabled: boolean,
    maskingMode: AppSettings['maskingMode']
): boolean => {
    return (
        filters.models.length > 0 ||
        filters.loras.length > 0 ||
        filters.embeddings.length > 0 ||
        filters.hypernetworks.length > 0 ||
        filters.tools.length > 0 ||
        filters.samplers.length > 0 ||
        filters.generationTypes.length > 0 ||
        filters.controlNets.length > 0 ||
        filters.ipAdapters.length > 0 ||
        !!filters.collectionId ||
        filters.searchQuery.trim().length > 0 ||
        filters.dateRange !== 'all' ||
        filters.favoritesOnly ||
        !!filters.pinnedOnly ||
        hasRangeFilter(filters.minSteps) ||
        hasRangeFilter(filters.maxSteps) ||
        hasRangeFilter(filters.minCfg) ||
        hasRangeFilter(filters.maxCfg) ||
        (privacyEnabled && maskingMode === 'hide')
    );
};

export const useLibraryStatsQuery = ({
    filters,
    settings,
    privacyEnabled,
    allCollections,
    settingsLoaded = true,
    assetScope = 'used'
}: UseLibraryStatsQueryProps) => {
    const useBrowserMocks = isBrowserMockMode();

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
    const ALL_FACET_TYPES: FacetType[] = ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters', 'tools'];

    const fetchValidFacets = useMemo(
        () => shouldFetchValidFacets(filters, privacyEnabled, settings.maskingMode),
        [filters, privacyEnabled, settings.maskingMode]
    );

    // Subscribe to facet cache version - when cache is rebuilt, this changes and triggers refetch
    const facetCacheVersion = useLibraryStore(s => s.facetCacheVersion);

    const queryInput = useMemo(() => {
        if (useBrowserMocks || !settingsLoaded) return null;

        return buildSqlWhereClause(
            filters,
            privacyEnabled,
            settings.maskingMode,
            settings.maskedKeywords,
            allCollections
        );
    }, [
        allCollections,
        filters,
        privacyEnabled,
        settings.maskedKeywords,
        settings.maskingMode,
        settingsLoaded,
        useBrowserMocks
    ]);

    const facetsQuery = useQuery({
        queryKey: ['libraryStats', 'facets', facetCacheVersion, assetScope, filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash],
        queryFn: async () => {
            if (useBrowserMocks) {
                return getBrowserMockFacets(filters);
            }

            if (!queryInput) return INITIAL_FACETS;

            return getFacets(queryInput.where, queryInput.params, ALL_FACET_TYPES, { assetScope });
        },
        placeholderData: (previousData) => previousData ?? INITIAL_FACETS,
        staleTime: 1000 * 60 * 5, // 5 minutes
        enabled: settingsLoaded, // Wait for settings to load before fetching
    });

    const summaryQuery = useQuery({
        queryKey: ['libraryStats', 'summary', facetCacheVersion, filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash],
        queryFn: async () => {
            if (useBrowserMocks) {
                return {
                    stats: getBrowserMockStats(filters),
                    validNames: fetchValidFacets ? getBrowserMockValidFacetNames(filters) : null
                };
            }

            if (!queryInput) {
                return { stats: INITIAL_STATS, validNames: null as ValidFacetNames | null };
            }

            const { where, params, collectionId, loraName } = queryInput;

            // Fetch stats and valid facet names in parallel. Facets are queried separately
            // so asset-scope changes do not rerun expensive privacy-valid facet checks.
            const [stats, baseValidNames] = await Promise.all([
                getLibraryStats(where, params, collectionId, loraName),
                fetchValidFacets
                    ? getValidFacetNames(where, params, collectionId, loraName)
                    : Promise.resolve(null)
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
            if (filters.controlNets.length > 0 && filters.matchModes?.controlNets !== 'all') disjunctiveCategories.push('controlNets');
            if (filters.ipAdapters.length > 0 && filters.matchModes?.ipAdapters !== 'all') disjunctiveCategories.push('ipAdapters');

            let finalValidNames = baseValidNames ? { ...baseValidNames } : null;

            if (finalValidNames && disjunctiveCategories.length > 0 && fetchValidFacets) {
                const extraQueries = disjunctiveCategories.map(async (cat) => {
                    let excludeKey = '';
                    if (cat === 'loras') excludeKey = 'loras';
                    if (cat === 'embeddings') excludeKey = 'embeddings';
                    if (cat === 'hypernetworks') excludeKey = 'hypernetworks';
                    if (cat === 'tools') excludeKey = 'tools';
                    if (cat === 'checkpoints') excludeKey = 'models';
                    if (cat === 'controlNets') excludeKey = 'controlNets';
                    if (cat === 'ipAdapters') excludeKey = 'ipAdapters';

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

                    const result = await getValidFacetNames(
                        partial.where,
                        partial.params,
                        partial.collectionId,
                        partial.loraName
                    );
                    return { cat, validNames: result?.[cat] ?? null };
                });

                const extraResults = await Promise.all(extraQueries);

                if (extraResults.some(({ validNames }) => validNames === null)) {
                    finalValidNames = null;
                } else {
                    extraResults.forEach(({ cat, validNames }) => {
                        if (validNames && finalValidNames) {
                            finalValidNames[cat] = validNames;
                        }
                    });
                }
            }

            return { stats, validNames: finalValidNames };
        },
        placeholderData: (previousData) => previousData ?? { stats: INITIAL_STATS, validNames: null as ValidFacetNames | null },
        staleTime: 1000 * 60 * 5, // 5 minutes
        enabled: settingsLoaded, // Wait for settings to load before fetching
    });

    return {
        data: {
            facets: facetsQuery.data ?? INITIAL_FACETS,
            stats: summaryQuery.data?.stats ?? INITIAL_STATS,
            validNames: summaryQuery.data?.validNames ?? null
        },
        isLoading: facetsQuery.isLoading || summaryQuery.isLoading,
        isFetching: facetsQuery.isFetching || summaryQuery.isFetching,
        isFacetsLoading: facetsQuery.isLoading,
        isFacetsFetching: facetsQuery.isFetching
    };
};
