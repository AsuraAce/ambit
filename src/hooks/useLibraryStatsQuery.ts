import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AssetScope, FilterState, AppSettings, Collection, FacetType } from '../types';
import { getFacets, getKeywordStats, getLibraryStatsSummary, Facets, LibraryStats, LibraryStatsSummary, getValidFacetNames, ValidFacetNames } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { useLibraryStore } from '../stores/libraryStore';
import { isBrowserMockMode } from '../services/runtime';
import { getBrowserMockFacets, getBrowserMockKeywordStats, getBrowserMockStatsSummary, getBrowserMockValidFacetNames } from '../services/browserMockData';
import { useDebouncedSideQueryFilters } from './useDebouncedSideQueryFilters';

interface UseLibraryStatsQueryProps {
    filters: FilterState;
    settings: AppSettings;
    privacyEnabled: boolean;
    allCollections: Collection[];
    settingsLoaded?: boolean;
    assetScope?: AssetScope;
    validFacetsEnabled?: boolean;
}

const INITIAL_STATS_SUMMARY: LibraryStatsSummary = {
    totalImages: 0,
    totalGenerations: 0,
    avgSteps: 0,
    estSizeMB: '0',
    modelStats: []
};

const INITIAL_KEYWORD_STATS: LibraryStats['keywordStats'] = [];

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
        !!filters.dateFrom ||
        !!filters.dateTo ||
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
    assetScope = 'used',
    validFacetsEnabled = true
}: UseLibraryStatsQueryProps) => {
    const useBrowserMocks = isBrowserMockMode();
    const sideQueryFilters = useDebouncedSideQueryFilters(filters);

    // Stable reference: only track the active collection's smart filter definition.
    const activeCollectionId = sideQueryFilters.collectionId;
    const activeCollection = useMemo(() =>
        allCollections.find(c => c.id === activeCollectionId),
        [allCollections, activeCollectionId]
    );

    const smartFilterHash = useMemo(() =>
        activeCollection?.filters ? JSON.stringify(activeCollection.filters) : null,
        [activeCollection?.filters]
    );

    const ALL_FACET_TYPES: FacetType[] = ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters', 'tools'];

    const fetchValidFacets = useMemo(
        () => validFacetsEnabled && shouldFetchValidFacets(sideQueryFilters, privacyEnabled, settings.maskingMode),
        [sideQueryFilters, privacyEnabled, settings.maskingMode, validFacetsEnabled]
    );

    // Subscribe to facet cache version - when cache is rebuilt, this changes and triggers refetch.
    const facetCacheVersion = useLibraryStore(s => s.facetCacheVersion);

    const queryInput = useMemo(() => {
        if (useBrowserMocks || !settingsLoaded) return null;

        return buildSqlWhereClause(
            sideQueryFilters,
            privacyEnabled,
            settings.maskingMode,
            settings.maskedKeywords,
            allCollections
        );
    }, [
        allCollections,
        privacyEnabled,
        settings.maskedKeywords,
        settings.maskingMode,
        settingsLoaded,
        sideQueryFilters,
        useBrowserMocks
    ]);

    const facetsQuery = useQuery({
        queryKey: ['libraryStats', 'facets', facetCacheVersion, assetScope, sideQueryFilters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash],
        queryFn: async () => {
            if (useBrowserMocks) {
                return getBrowserMockFacets(sideQueryFilters);
            }

            if (!queryInput) return INITIAL_FACETS;

            return getFacets(queryInput.where, queryInput.params, ALL_FACET_TYPES, {
                assetScope,
                collectionId: queryInput.collectionId,
                loraName: queryInput.loraName
            });
        },
        placeholderData: (previousData) => previousData,
        staleTime: 1000 * 60 * 5,
        enabled: settingsLoaded
    });

    const statsSummaryQuery = useQuery({
        queryKey: ['libraryStats', 'summary', facetCacheVersion, sideQueryFilters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash],
        queryFn: async () => {
            if (useBrowserMocks) {
                return getBrowserMockStatsSummary(sideQueryFilters);
            }

            if (!queryInput) {
                return INITIAL_STATS_SUMMARY;
            }

            const { where, params, collectionId, loraName } = queryInput;
            return getLibraryStatsSummary(where, params, collectionId, loraName);
        },
        placeholderData: (previousData) => previousData,
        staleTime: 1000 * 60 * 5,
        enabled: settingsLoaded
    });
    const [activeSummaryVersion, setActiveSummaryVersion] = useState(0);
    const lastSettledSummaryUpdatedAtRef = useRef(0);

    useEffect(() => {
        if (statsSummaryQuery.status !== 'success' || statsSummaryQuery.isFetching || statsSummaryQuery.isPlaceholderData) {
            return;
        }
        if (statsSummaryQuery.dataUpdatedAt === 0 || statsSummaryQuery.dataUpdatedAt === lastSettledSummaryUpdatedAtRef.current) {
            return;
        }

        lastSettledSummaryUpdatedAtRef.current = statsSummaryQuery.dataUpdatedAt;
        setActiveSummaryVersion((version) => version + 1);
    }, [
        statsSummaryQuery.dataUpdatedAt,
        statsSummaryQuery.isFetching,
        statsSummaryQuery.isPlaceholderData,
        statsSummaryQuery.status
    ]);
    const validNamesQuery = useQuery({
        queryKey: ['libraryStats', 'validNames', facetCacheVersion, sideQueryFilters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, smartFilterHash, validFacetsEnabled],
        queryFn: async () => {
            if (useBrowserMocks) {
                return fetchValidFacets ? getBrowserMockValidFacetNames(sideQueryFilters) : null;
            }

            if (!queryInput || !fetchValidFacets) {
                return null as ValidFacetNames | null;
            }

            const { where, params, collectionId, loraName } = queryInput;

            const baseValidNames = await getValidFacetNames(where, params, collectionId, loraName);

            const disjunctiveCategories: FacetType[] = [];
            if (activeCollectionId) {
                // Collections are single select, no disjunctive logic needed currently.
            }
            if (sideQueryFilters.loras.length > 0 && sideQueryFilters.matchModes?.loras !== 'all') disjunctiveCategories.push('loras');
            if (sideQueryFilters.embeddings.length > 0 && sideQueryFilters.matchModes?.embeddings !== 'all') disjunctiveCategories.push('embeddings');
            if (sideQueryFilters.hypernetworks.length > 0 && sideQueryFilters.matchModes?.hypernetworks !== 'all') disjunctiveCategories.push('hypernetworks');
            if (sideQueryFilters.tools.length > 0 && sideQueryFilters.matchModes?.tools !== 'all') disjunctiveCategories.push('tools');
            if (sideQueryFilters.models.length > 0 && sideQueryFilters.matchModes?.models !== 'all') disjunctiveCategories.push('checkpoints');
            if (sideQueryFilters.controlNets.length > 0 && sideQueryFilters.matchModes?.controlNets !== 'all') disjunctiveCategories.push('controlNets');
            if (sideQueryFilters.ipAdapters.length > 0 && sideQueryFilters.matchModes?.ipAdapters !== 'all') disjunctiveCategories.push('ipAdapters');

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

                    const partial = buildSqlWhereClause(
                        sideQueryFilters,
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

            return finalValidNames;
        },
        placeholderData: (previousData) => previousData,
        staleTime: 1000 * 60 * 5,
        enabled: settingsLoaded
    });

    const keywordQuery = useQuery({
        // Keep keywords on a separate root key so broad library-stats invalidations
        // refresh the cheap summary first before restarting the prompt scan.
        queryKey: ['libraryKeywordStats', activeSummaryVersion],
        queryFn: async () => {
            if (useBrowserMocks) {
                return {
                    summaryVersion: activeSummaryVersion,
                    keywordStats: getBrowserMockKeywordStats(sideQueryFilters)
                };
            }

            if (!queryInput) {
                return {
                    summaryVersion: activeSummaryVersion,
                    keywordStats: INITIAL_KEYWORD_STATS
                };
            }

            const { where, params, collectionId, loraName } = queryInput;
            return {
                summaryVersion: activeSummaryVersion,
                keywordStats: await getKeywordStats(where, params, collectionId, loraName)
            };
        },
        placeholderData: (previousData) => previousData,
        staleTime: 1000 * 60 * 5,
        enabled: settingsLoaded && activeSummaryVersion > 0 && statsSummaryQuery.status === 'success' && !statsSummaryQuery.isFetching && !statsSummaryQuery.isPlaceholderData
    });

    const keywordStatsAreCurrent = useMemo(() => (
        Boolean(keywordQuery.data) && keywordQuery.data?.summaryVersion === activeSummaryVersion
    ), [activeSummaryVersion, keywordQuery.data]);

    const currentKeywordStats = keywordStatsAreCurrent
        ? (keywordQuery.data?.keywordStats ?? INITIAL_KEYWORD_STATS)
        : INITIAL_KEYWORD_STATS;

    const isKeywordStatsLoading = statsSummaryQuery.status === 'success'
        && !statsSummaryQuery.isFetching
        && !statsSummaryQuery.isPlaceholderData
        && !keywordStatsAreCurrent;

    const combinedStats = useMemo<LibraryStats>(() => ({
        ...(statsSummaryQuery.data ?? INITIAL_STATS_SUMMARY),
        keywordStats: currentKeywordStats
    }), [currentKeywordStats, statsSummaryQuery.data]);

    return {
        data: {
            facets: facetsQuery.data ?? INITIAL_FACETS,
            stats: combinedStats,
            validNames: validNamesQuery.data ?? null
        },
        isLoading: facetsQuery.isLoading || statsSummaryQuery.isLoading || validNamesQuery.isLoading || keywordQuery.isLoading,
        isFetching: facetsQuery.isFetching || statsSummaryQuery.isFetching || validNamesQuery.isFetching || keywordQuery.isFetching,
        isFacetsLoading: facetsQuery.isLoading,
        isFacetsFetching: facetsQuery.isFetching,
        isStatsSummaryLoading: statsSummaryQuery.isLoading,
        isKeywordStatsLoading
    };
};
