import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStatsQuery } from '../useLibraryStatsQuery';
import { AppSettings, Collection, FilterState } from '../../types';
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
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => false,
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
        useLibraryStore.setState({ facetCacheVersion: 0 });
        searchRepoMocks.getFacets.mockResolvedValue(emptyFacets);
        searchRepoMocks.getLibraryStatsSummary.mockResolvedValue(emptySummary);
        searchRepoMocks.getKeywordStats.mockResolvedValue(emptyKeywordStats);
        searchRepoMocks.getValidFacetNames.mockResolvedValue(validNames);
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
                avgSteps: 0,
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
        expect(result.current.isKeywordStatsLoading).toBe(false);

        act(() => {
            summaryRefetch.resolve({
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

        const calls = searchRepoMocks.getValidFacetNames.mock.calls as Array<
            [string, unknown[], string | undefined, string | undefined]
        >;
        const baseCall = calls[0];
        const loraSelfExcludedCall = calls[1];

        expect(baseCall[3]).toBe('CollectionLora');
        expect(loraSelfExcludedCall[1]).not.toContain('CollectionLora');
        expect(loraSelfExcludedCall[3]).toBeUndefined();
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
});
