import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldFetchValidFacets, useLibraryStatsQuery } from '../useLibraryStatsQuery';
import { AppSettings, Collection, FilterState, GeneratorTool } from '../../types';
import type { AssetScope } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
import { useLibraryStore } from '../../stores/libraryStore';
import type { Facets, LibraryStats, LibraryStatsSummary, ValidFacetNames } from '../../services/db/searchRepo';
import { SIDE_QUERY_SEARCH_DEBOUNCE_MS } from '../useDebouncedSideQueryFilters';

const searchRepoMocks = vi.hoisted(() => ({
    getFacets: vi.fn(),
    getLibraryStatsSummary: vi.fn(),
    getKeywordStats: vi.fn(),
    getValidFacetNames: vi.fn(),
    browserMockMode: false,
    getBrowserMockFacets: vi.fn(),
    getBrowserMockKeywordStats: vi.fn(),
    getBrowserMockStatsSummary: vi.fn(),
    getBrowserMockValidFacetNames: vi.fn(),
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => searchRepoMocks.browserMockMode,
}));

vi.mock('../../services/browserMockData', () => ({
    getBrowserMockFacets: searchRepoMocks.getBrowserMockFacets,
    getBrowserMockKeywordStats: searchRepoMocks.getBrowserMockKeywordStats,
    getBrowserMockStatsSummary: searchRepoMocks.getBrowserMockStatsSummary,
    getBrowserMockValidFacetNames: searchRepoMocks.getBrowserMockValidFacetNames,
}));

vi.mock('../../services/db/searchRepo', () => ({
    getFacets: searchRepoMocks.getFacets,
    getLibraryStatsSummary: searchRepoMocks.getLibraryStatsSummary,
    getKeywordStats: searchRepoMocks.getKeywordStats,
    getValidFacetNames: searchRepoMocks.getValidFacetNames,
}));

const emptyFacets: Facets = {
    checkpoints: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    controlNets: [],
    ipAdapters: [],
    tools: [],
};

const emptySummary: LibraryStatsSummary = {
    totalImages: 0,
    totalGenerations: 0,
    avgSteps: 0,
    estSizeMB: '0',
    modelStats: [],
};

const emptyKeywordStats: LibraryStats['keywordStats'] = [];

const validNames: ValidFacetNames = {
    checkpoints: ['CollectionModel'],
    loras: ['CollectionLora'],
    embeddings: ['CollectionEmbedding'],
    hypernetworks: [],
    tools: ['Automatic1111'],
    controlNets: [],
    ipAdapters: [],
};

const settings: AppSettings = {
    hasCompletedOnboarding: false,
    theme: 'dark',
    thumbnailSize: 200,
    autoCheckForUpdates: true,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskingMode: 'blur',
    maskedKeywords: [],
    enableAI: false,
};

const renderStatsHook = (
    filters = createDefaultFilters(),
    allCollections: Collection[] = [],
    assetScope: AssetScope = 'used',
    validFacetsEnabled = true
) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
            },
        },
    });

    const wrapper = ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return renderHook(
        ({
            currentFilters,
            currentAssetScope = 'used',
            drilldownEnabled = true
        }: {
            currentFilters: FilterState;
            currentAssetScope?: AssetScope;
            drilldownEnabled?: boolean;
        }) => useLibraryStatsQuery({
            filters: currentFilters,
            settings,
            privacyEnabled: false,
            allCollections,
            settingsLoaded: true,
            assetScope: currentAssetScope,
            validFacetsEnabled: drilldownEnabled,
        }),
        {
            wrapper,
            initialProps: {
                currentFilters: filters,
                currentAssetScope: assetScope,
                drilldownEnabled: validFacetsEnabled
            },
        }
    );
};

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
};

const waitForMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('useLibraryStatsQuery valid facets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        searchRepoMocks.browserMockMode = false;
        useLibraryStore.setState({ facetCacheVersion: 0 });
        searchRepoMocks.getFacets.mockResolvedValue(emptyFacets);
        searchRepoMocks.getLibraryStatsSummary.mockResolvedValue(emptySummary);
        searchRepoMocks.getKeywordStats.mockResolvedValue(emptyKeywordStats);
        searchRepoMocks.getValidFacetNames.mockResolvedValue(validNames);
        searchRepoMocks.getBrowserMockFacets.mockReturnValue(emptyFacets);
        searchRepoMocks.getBrowserMockStatsSummary.mockReturnValue(emptySummary);
        searchRepoMocks.getBrowserMockKeywordStats.mockReturnValue(emptyKeywordStats);
        searchRepoMocks.getBrowserMockValidFacetNames.mockReturnValue(validNames);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fetches valid facets for plain search terms', async () => {
        renderStatsHook(createDefaultFilters({ searchQuery: 'portrait' }));

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalled());

        const [[where, params]] = searchRepoMocks.getValidFacetNames.mock.calls as [
            [string, unknown[], string | undefined, string | undefined],
        ];

        expect(where).toContain('positive_prompt LIKE ?');
        expect(params).toContain('%portrait%');
    });

    it('fetches valid facets for sampler-only filters', async () => {
        renderStatsHook(createDefaultFilters({ samplers: ['euler a'] }));

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalled());

        const [[where, params]] = searchRepoMocks.getValidFacetNames.mock.calls as [
            [string, unknown[], string | undefined, string | undefined],
        ];

        expect(where).toContain('sampler = ?');
        expect(params).toContain('euler a');
    });

    it('fetches valid facets for generation-type-only filters', async () => {
        renderStatsHook(createDefaultFilters({ generationTypes: ['txt2img'] }));

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalled());

        const [[where, params]] = searchRepoMocks.getValidFacetNames.mock.calls as [
            [string, unknown[], string | undefined, string | undefined],
        ];

        expect(where).toContain('generation_type = ?');
        expect(params).toContain('txt2img');
    });

    it('fetches valid facets for range-only filters', async () => {
        renderStatsHook(createDefaultFilters({ minSteps: 20 }));

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalled());

        const [[where, params]] = searchRepoMocks.getValidFacetNames.mock.calls as [
            [string, unknown[], string | undefined, string | undefined],
        ];

        expect(where).toContain('steps >= ?');
        expect(params).toContain(20);
    });

    it('does not fetch valid facets for default filters', async () => {
        renderStatsHook();

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalled());

        expect(searchRepoMocks.getValidFacetNames).not.toHaveBeenCalled();
    });

    it('defers valid facets until drill-down UI is active', async () => {
        const filteredState = createDefaultFilters({ searchQuery: 'portrait' });
        const { rerender } = renderStatsHook(filteredState, [], 'used', false);

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1));
        expect(searchRepoMocks.getValidFacetNames).not.toHaveBeenCalled();

        rerender({ currentFilters: filteredState, currentAssetScope: 'used', drilldownEnabled: true });

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(1));
        expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1);
        expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1);
    });

    it('requests facets for the active asset scope', async () => {
        renderStatsHook(createDefaultFilters(), [], 'local');

        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalled());

        const calls = searchRepoMocks.getFacets.mock.calls as Array<
            [string, unknown[], unknown[], { assetScope: AssetScope; collectionId?: string; loraName?: string }]
        >;
        expect(calls[0][3]).toMatchObject({ assetScope: 'local' });
    });

    it('does not refetch stats or valid facets when only the asset scope changes', async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0,
                },
            },
        });
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const filters = createDefaultFilters();
        const hideSettings = { ...settings, maskingMode: 'hide' } as AppSettings;

        const { rerender, result } = renderHook(
            ({ assetScope }: { assetScope: AssetScope }) => useLibraryStatsQuery({
                filters,
                settings: hideSettings,
                privacyEnabled: true,
                allCollections: [],
                settingsLoaded: true,
                assetScope,
            }),
            {
                wrapper,
                initialProps: { assetScope: 'used' as AssetScope },
            }
        );

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(1));
        expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1));
        expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1);

        rerender({ assetScope: 'local' });

        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(2));
        expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1);
        expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1);
        expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(result.current.isFacetsFetching).toBe(false));
    });

    it('keeps facet loading false while only the summary query refetches', async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0,
                },
            },
        });
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );

        const { result } = renderHook(
            () => useLibraryStatsQuery({
                filters: createDefaultFilters(),
                settings,
                privacyEnabled: false,
                allCollections: [],
                settingsLoaded: true,
                assetScope: 'used',
            }),
            { wrapper }
        );

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current.isFetching).toBe(false));

        const summaryRefetch = createDeferred<LibraryStatsSummary>();
        searchRepoMocks.getLibraryStatsSummary.mockReturnValueOnce(summaryRefetch.promise);

        act(() => {
            void queryClient.invalidateQueries({ queryKey: ['libraryStats', 'summary'] });
        });

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.isFetching).toBe(true));

        expect(result.current.isFacetsFetching).toBe(false);
        expect(result.current.isFacetsLoading).toBe(false);
        expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1);

        act(() => {
            summaryRefetch.resolve(emptySummary);
        });
        await waitFor(() => expect(result.current.isFetching).toBe(false));
    });

    it('resolves summary stats without waiting for keyword analysis', async () => {
        const summary: LibraryStatsSummary = {
            totalImages: 42,
            totalGenerations: 42,
            avgSteps: 0,
            estSizeMB: '128.4',
            modelStats: [
                { name: 'Flux Dev', fullName: 'Flux Dev', count: 42 }
            ]
        };
        const keywordDeferred = createDeferred<LibraryStats['keywordStats']>();
        searchRepoMocks.getLibraryStatsSummary.mockResolvedValueOnce(summary);
        searchRepoMocks.getKeywordStats.mockReturnValueOnce(keywordDeferred.promise);

        const { result } = renderStatsHook();

        await waitFor(() => expect(result.current.data.stats.totalGenerations).toBe(42));

        expect(result.current.data.stats.modelStats).toEqual(summary.modelStats);
        expect(result.current.data.stats.keywordStats).toEqual([]);
        expect(result.current.isStatsSummaryLoading).toBe(false);
        expect(result.current.isKeywordStatsLoading).toBe(true);

        act(() => {
            keywordDeferred.resolve([{ text: 'aurora', value: 9 }]);
        });

        await waitFor(() => expect(result.current.data.stats.keywordStats).toEqual([{ text: 'aurora', value: 9 }]));
    });

    it('starts keyword analysis only after the current summary query succeeds', async () => {
        const summaryDeferred = createDeferred<LibraryStatsSummary>();
        const keywordDeferred = createDeferred<LibraryStats['keywordStats']>();
        searchRepoMocks.getLibraryStatsSummary.mockReturnValueOnce(summaryDeferred.promise);
        searchRepoMocks.getKeywordStats.mockReturnValueOnce(keywordDeferred.promise);

        renderStatsHook();

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1));
        expect(searchRepoMocks.getKeywordStats).not.toHaveBeenCalled();

        act(() => {
            summaryDeferred.resolve({
                totalImages: 8,
                totalGenerations: 8,
                avgSteps: 0,
                estSizeMB: '16.0',
                modelStats: []
            });
        });

        await waitFor(() => expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1));

        act(() => {
            keywordDeferred.resolve(emptyKeywordStats);
        });
    });

    it('hides stale keyword results while refreshed keywords are still computing for a new summary snapshot', async () => {
        const initialKeywords = [{ text: 'aurora', value: 4 }];
        const refreshedSummary = createDeferred<LibraryStatsSummary>();
        const refreshedKeywords = createDeferred<LibraryStats['keywordStats']>();

        searchRepoMocks.getLibraryStatsSummary
            .mockResolvedValueOnce({
                totalImages: 4,
                totalGenerations: 4,
                avgSteps: 0,
                estSizeMB: '12.0',
                modelStats: []
            })
            .mockReturnValueOnce(refreshedSummary.promise);
        searchRepoMocks.getKeywordStats
            .mockResolvedValueOnce(initialKeywords)
            .mockReturnValueOnce(refreshedKeywords.promise);

        const { rerender, result } = renderStatsHook();

        await waitFor(() => expect(result.current.data.stats.keywordStats).toEqual(initialKeywords));

        rerender({
            currentFilters: createDefaultFilters({ dateRange: 'today' }),
            currentAssetScope: 'used',
            drilldownEnabled: true
        });

        expect(result.current.data.stats.keywordStats).toEqual(initialKeywords);
        expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1);

        act(() => {
            refreshedSummary.resolve({
                totalImages: 7,
                totalGenerations: 7,
                avgSteps: 0,
                estSizeMB: '14.0',
                modelStats: []
            });
        });

        await waitFor(() => expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(2));
        expect(result.current.data.stats.totalGenerations).toBe(7);
        expect(result.current.data.stats.keywordStats).toEqual([]);
        expect(result.current.isKeywordStatsLoading).toBe(true);

        act(() => {
            refreshedKeywords.resolve([{ text: 'sunset', value: 6 }]);
        });

        await waitFor(() => expect(result.current.data.stats.keywordStats).toEqual([{ text: 'sunset', value: 6 }]));
    });

    it('waits for summary refetches before restarting keyword analysis on same-key invalidations', async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0,
                },
            },
        });
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const initialKeywords = [{ text: 'aurora', value: 4 }];
        const summaryRefetch = createDeferred<LibraryStatsSummary>();
        const keywordRefetch = createDeferred<LibraryStats['keywordStats']>();

        searchRepoMocks.getLibraryStatsSummary
            .mockResolvedValueOnce({
                totalImages: 4,
                totalGenerations: 4,
                avgSteps: 20,
                estSizeMB: '12.0',
                modelStats: []
            })
            .mockReturnValueOnce(summaryRefetch.promise);
        searchRepoMocks.getKeywordStats
            .mockResolvedValueOnce(initialKeywords)
            .mockReturnValueOnce(keywordRefetch.promise);

        const { result } = renderHook(
            () => useLibraryStatsQuery({
                filters: createDefaultFilters(),
                settings,
                privacyEnabled: false,
                allCollections: [],
                settingsLoaded: true,
                assetScope: 'used',
            }),
            { wrapper }
        );

        await waitFor(() => expect(result.current.data.stats.keywordStats).toEqual(initialKeywords));

        act(() => {
            void queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
        });

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.isFetching).toBe(true));

        expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1);
        expect(result.current.data.stats.keywordStats).toEqual(initialKeywords);
        expect(result.current.data.stats.avgSteps).toBe(20);
        expect(result.current.isKeywordStatsLoading).toBe(false);

        act(() => {
            summaryRefetch.resolve({
                totalImages: 7,
                totalGenerations: 7,
                avgSteps: 40,
                estSizeMB: '14.0',
                modelStats: []
            });
        });

        await waitFor(() => expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(2));
        expect(result.current.data.stats.totalGenerations).toBe(7);
        expect(result.current.data.stats.avgSteps).toBe(40);
        expect(result.current.data.stats.keywordStats).toEqual([]);
        expect(result.current.isKeywordStatsLoading).toBe(true);

        act(() => {
            keywordRefetch.resolve([{ text: 'sunset', value: 6 }]);
        });

        await waitFor(() => expect(result.current.data.stats.keywordStats).toEqual([{ text: 'sunset', value: 6 }]));
    });

    it('refetches stats and valid facets when the facet cache version changes', async () => {
        const queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: 0,
                },
            },
        });
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const hideSettings = { ...settings, maskingMode: 'hide' } as AppSettings;

        renderHook(
            () => useLibraryStatsQuery({
                filters: createDefaultFilters(),
                settings: hideSettings,
                privacyEnabled: true,
                allCollections: [],
                settingsLoaded: true,
                assetScope: 'used',
            }),
            { wrapper }
        );

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(1));
        expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1);
        expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1);

        act(() => {
            useLibraryStore.getState().incrementFacetCacheVersion();
        });

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(2));
        expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(2);
        expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(2);
    });

    it('uses a self-excluded query plan for ANY-mode disjunctive facets', async () => {
        renderStatsHook(createDefaultFilters({ loras: ['CollectionLora'] }));

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1));

        const calls = searchRepoMocks.getValidFacetNames.mock.calls as Array<
            [string, unknown[], string | undefined, string | undefined]
        >;
        const baseCall = calls[0];
        const loraSelfExcludedCall = calls[1];

        expect(baseCall[3]).toBe('CollectionLora');
        expect(loraSelfExcludedCall[1]).not.toContain('CollectionLora');
        expect(loraSelfExcludedCall[3]).toBeUndefined();

        const facetCalls = searchRepoMocks.getFacets.mock.calls as Array<
            [string, unknown[], unknown[], { loraName?: string; scopedCountOverrides?: Record<string, { params: unknown[]; loraName?: string }> }]
        >;
        const facetOptions = facetCalls[0][3];

        expect(facetOptions.loraName).toBe('CollectionLora');
        expect(facetOptions.scopedCountOverrides?.loras?.params).not.toContain('CollectionLora');
        expect(facetOptions.scopedCountOverrides?.loras?.loraName).toBeUndefined();
    });

    it('self-excludes checkpoints even if stale matchModes requests ALL', async () => {
        renderStatsHook(createDefaultFilters({
            models: ['Model A', 'Model B'],
            matchModes: { models: 'all' }
        }));

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1));

        const validFacetCalls = searchRepoMocks.getValidFacetNames.mock.calls as Array<
            [string, unknown[], string | undefined, string | undefined]
        >;
        const checkpointSelfExcludedCall = validFacetCalls[1];

        expect(checkpointSelfExcludedCall[1]).not.toContain('Model A');
        expect(checkpointSelfExcludedCall[1]).not.toContain('Model B');

        const facetCalls = searchRepoMocks.getFacets.mock.calls as Array<
            [string, unknown[], unknown[], { scopedCountOverrides?: Record<string, { params: unknown[] }> }]
        >;

        expect(facetCalls[0][3].scopedCountOverrides?.checkpoints?.params).not.toContain('Model A');
        expect(facetCalls[0][3].scopedCountOverrides?.checkpoints?.params).not.toContain('Model B');
    });

    it('debounces search-only stats updates and collapses rapid corrections', async () => {
        const { rerender } = renderStatsHook();

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1));

        rerender({ currentFilters: createDefaultFilters({ searchQuery: 'date:2026' }), currentAssetScope: 'used', drilldownEnabled: true });
        await waitForMs(600);
        rerender({ currentFilters: createDefaultFilters({ searchQuery: 'date:2026-04' }), currentAssetScope: 'used', drilldownEnabled: true });
        await waitForMs(SIDE_QUERY_SEARCH_DEBOUNCE_MS - 100);

        expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1);
        await waitForMs(120);

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(2));

        const calls = searchRepoMocks.getLibraryStatsSummary.mock.calls as Array<
            [string, unknown[], string | undefined, string | undefined]
        >;
        const [where, params] = calls[1];

        expect(where).toContain('timestamp >= ?');
        expect(where).toContain('timestamp < ?');
        expect(params).toEqual([
            new Date(2026, 3, 1).getTime(),
            new Date(2026, 4, 1).getTime(),
        ]);
    });

    it('updates stats immediately for non-search filter changes', async () => {
        const { rerender } = renderStatsHook();

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1));

        rerender({ currentFilters: createDefaultFilters({ dateRange: 'today' }), currentAssetScope: 'used', drilldownEnabled: true });

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(2));
    });

    it.each<Partial<FilterState>>([
        { embeddings: ['embedding'] },
        { hypernetworks: ['hypernetwork'] },
        { tools: [GeneratorTool.COMFYUI] },
        { controlNets: ['control'] },
        { ipAdapters: ['adapter'] },
        { collectionId: 'collection' },
        { dateRange: 'week' as const },
        { dateFrom: '2026-01-01' },
        { dateTo: '2026-02-01' },
        { favoritesOnly: true },
        { pinnedOnly: true },
        { maxSteps: 40 },
        { minCfg: 2 },
        { maxCfg: 9 }
    ])('enables valid facets for filter trigger %#', (overrides) => {
        expect(shouldFetchValidFacets(createDefaultFilters(overrides), false, 'blur')).toBe(true);
    });

    it('enables valid facets for hidden privacy and rejects null range bounds', () => {
        expect(shouldFetchValidFacets(createDefaultFilters(), true, 'hide')).toBe(true);
        const nullRanges = {
            ...createDefaultFilters(),
            minSteps: null,
            maxSteps: null,
            minCfg: null,
            maxCfg: null
        } as unknown as FilterState;
        expect(shouldFetchValidFacets(nullRanges, false, 'blur')).toBe(false);
    });

    it('uses browser-backed facets, summary, valid names, and keywords', async () => {
        searchRepoMocks.browserMockMode = true;
        const filters = createDefaultFilters({ searchQuery: 'portrait' });
        const { result } = renderStatsHook(filters);

        await waitFor(() => expect(searchRepoMocks.getBrowserMockFacets).toHaveBeenCalledWith(filters));
        await waitFor(() => expect(searchRepoMocks.getBrowserMockStatsSummary).toHaveBeenCalledWith(filters));
        await waitFor(() => expect(searchRepoMocks.getBrowserMockValidFacetNames).toHaveBeenCalledWith(filters));
        await waitFor(() => expect(searchRepoMocks.getBrowserMockKeywordStats).toHaveBeenCalledWith(filters));
        expect(searchRepoMocks.getFacets).not.toHaveBeenCalled();
        expect(result.current.data.validNames).toEqual(validNames);
    });

    it('returns no browser valid names when no filter requires them', async () => {
        searchRepoMocks.browserMockMode = true;
        const { result } = renderStatsHook();

        await waitFor(() => expect(searchRepoMocks.getBrowserMockStatsSummary).toHaveBeenCalled());
        expect(searchRepoMocks.getBrowserMockValidFacetNames).not.toHaveBeenCalled();
        expect(result.current.data.validNames).toBeNull();
    });

    it('uses default hook options and fingerprints active smart collections', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const smartFilters = createDefaultFilters({ searchQuery: 'smart' });
        const collection: Collection = {
            id: 'smart',
            name: 'Smart',
            imageIds: [],
            createdAt: 1,
            filters: smartFilters
        };

        renderHook(() => useLibraryStatsQuery({
            filters: createDefaultFilters({ collectionId: 'smart' }),
            settings,
            privacyEnabled: false,
            allCollections: [collection]
        }), { wrapper });

        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalled());
        expect(searchRepoMocks.getFacets.mock.calls[0][3]).toEqual(expect.objectContaining({ assetScope: 'used' }));
    });

    it('refetches statistics when active smart collection exclusions change', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const collection: Collection = {
            id: 'smart',
            name: 'Smart',
            imageIds: [],
            createdAt: 1,
            filters: createDefaultFilters({ favoritesOnly: true })
        };
        const activeFilters = createDefaultFilters({ collectionId: collection.id });

        const { rerender } = renderHook(
            ({ currentCollections }: { currentCollections: Collection[] }) => useLibraryStatsQuery({
                filters: activeFilters,
                settings,
                privacyEnabled: false,
                allCollections: currentCollections
            }),
            {
                wrapper,
                initialProps: { currentCollections: [collection] }
            }
        );

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(1));

        rerender({
            currentCollections: [{ ...collection, manualExclusions: ['image-1'] }]
        });

        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(2));
        expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenLastCalledWith(
            expect.stringContaining('id NOT IN (?)'),
            expect.arrayContaining(['image-1']),
            undefined,
            undefined
        );
    });

    it('skips scoped count overrides when tools are the only disjunctive facet', async () => {
        renderStatsHook(createDefaultFilters({ tools: [GeneratorTool.COMFYUI] }));

        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalled());
        expect(searchRepoMocks.getFacets.mock.calls[0][3].scopedCountOverrides).toBeUndefined();
    });

    it('invalidates all valid names when a self-excluded facet query fails', async () => {
        searchRepoMocks.getValidFacetNames
            .mockResolvedValueOnce(validNames)
            .mockResolvedValueOnce(null);
        const { result } = renderStatsHook(createDefaultFilters({ loras: ['CollectionLora'] }));

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.data.validNames).toBeNull());
    });

    it('keeps null base valid names null without running self-excluded merges', async () => {
        searchRepoMocks.getValidFacetNames.mockResolvedValue(null);
        const { result } = renderStatsHook(createDefaultFilters({ loras: ['CollectionLora'] }));

        await waitFor(() => expect(result.current.data.validNames).toBeNull());
    });

    it('self-excludes every supported ANY-mode resource facet', async () => {
        renderStatsHook(createDefaultFilters({
            embeddings: ['embedding'],
            hypernetworks: ['hypernetwork'],
            controlNets: ['control'],
            ipAdapters: ['adapter'],
            matchModes: {
                embeddings: 'any',
                hypernetworks: 'any',
                controlNets: 'any',
                ipAdapters: 'any'
            }
        }));

        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalled());
        const overrides = searchRepoMocks.getFacets.mock.calls[0][3].scopedCountOverrides;
        expect(Object.keys(overrides)).toEqual(expect.arrayContaining([
            'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters'
        ]));
    });

    it('advances keyword analysis for each settled summary even with a fixed clock', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const wrapper = ({ children }: PropsWithChildren) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        renderHook(() => useLibraryStatsQuery({
            filters: createDefaultFilters(),
            settings,
            privacyEnabled: false,
            allCollections: []
        }), { wrapper });
        await waitFor(() => expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1));

        act(() => void queryClient.invalidateQueries({ queryKey: ['libraryStats', 'summary'] }));
        await waitFor(() => expect(searchRepoMocks.getLibraryStatsSummary).toHaveBeenCalledTimes(2));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(searchRepoMocks.getKeywordStats).toHaveBeenCalledTimes(1);
        now.mockRestore();
    });

    it('falls back to empty keywords when browser mock keyword data is absent', async () => {
        searchRepoMocks.browserMockMode = true;
        searchRepoMocks.getBrowserMockKeywordStats.mockReturnValueOnce(undefined);
        const { result } = renderStatsHook();

        await waitFor(() => expect(searchRepoMocks.getBrowserMockKeywordStats).toHaveBeenCalled());
        expect(result.current.data.stats.keywordStats).toEqual([]);
    });
});
