import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStatsQuery } from '../useLibraryStatsQuery';
import { AppSettings, Collection } from '../../types';
import type { AssetScope } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
import { useLibraryStore } from '../../stores/libraryStore';
import type { Facets, LibraryStats, ValidFacetNames } from '../../services/db/searchRepo';

const searchRepoMocks = vi.hoisted(() => ({
    getFacets: vi.fn(),
    getLibraryStats: vi.fn(),
    getValidFacetNames: vi.fn(),
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => false,
}));

vi.mock('../../services/db/searchRepo', () => ({
    getFacets: searchRepoMocks.getFacets,
    getLibraryStats: searchRepoMocks.getLibraryStats,
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

const emptyStats: LibraryStats = {
    totalImages: 0,
    totalGenerations: 0,
    avgSteps: 0,
    estSizeMB: '0',
    modelStats: [],
    keywordStats: [],
};

const validNames: ValidFacetNames = {
    checkpoints: ['CollectionModel'],
    loras: ['CollectionLora'],
    embeddings: ['CollectionEmbedding'],
    hypernetworks: [],
    tools: ['Automatic1111'],
    controlNets: [],
    ipAdapters: [],
};

const settings = {
    maskingMode: 'blur',
    maskedKeywords: [],
} as AppSettings;

const renderStatsHook = (
    filters = createDefaultFilters(),
    allCollections: Collection[] = [],
    assetScope: AssetScope = 'used'
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
        () => useLibraryStatsQuery({
            filters,
            settings,
            privacyEnabled: false,
            allCollections,
            settingsLoaded: true,
            assetScope,
        }),
        { wrapper }
    );
};

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
};

describe('useLibraryStatsQuery valid facets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useLibraryStore.setState({ facetCacheVersion: 0 });
        searchRepoMocks.getFacets.mockResolvedValue(emptyFacets);
        searchRepoMocks.getLibraryStats.mockResolvedValue(emptyStats);
        searchRepoMocks.getValidFacetNames.mockResolvedValue(validNames);
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

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalled());

        expect(searchRepoMocks.getValidFacetNames).not.toHaveBeenCalled();
    });

    it('requests facets for the active asset scope', async () => {
        renderStatsHook(createDefaultFilters(), [], 'local');

        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalled());

        const calls = searchRepoMocks.getFacets.mock.calls as Array<
            [string, unknown[], unknown[], { assetScope: AssetScope }]
        >;
        expect(calls[0][3]).toEqual({ assetScope: 'local' });
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
        expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(1);
        expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1);

        rerender({ assetScope: 'local' });

        await waitFor(() => expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(2));
        expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(1);
        expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(1);
        expect(result.current.isFacetsFetching).toBe(false);
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

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current.isFetching).toBe(false));

        const summaryRefetch = createDeferred<LibraryStats>();
        searchRepoMocks.getLibraryStats.mockReturnValueOnce(summaryRefetch.promise);

        act(() => {
            void queryClient.invalidateQueries({ queryKey: ['libraryStats', 'summary'] });
        });

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(result.current.isFetching).toBe(true));

        expect(result.current.isFacetsFetching).toBe(false);
        expect(result.current.isFacetsLoading).toBe(false);
        expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1);

        act(() => {
            summaryRefetch.resolve(emptyStats);
        });
        await waitFor(() => expect(result.current.isFetching).toBe(false));
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
        expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(1);
        expect(searchRepoMocks.getFacets).toHaveBeenCalledTimes(1);

        act(() => {
            useLibraryStore.getState().incrementFacetCacheVersion();
        });

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalledTimes(2));
        expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(2);
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
});
