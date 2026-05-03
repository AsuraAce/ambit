import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStatsQuery } from '../useLibraryStatsQuery';
import { AppSettings, Collection, FilterState } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
import type { Facets, LibraryStats, ValidFacetNames } from '../../services/db/searchRepo';
import { SIDE_QUERY_SEARCH_DEBOUNCE_MS } from '../useDebouncedSideQueryFilters';

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
        ({ currentFilters, drilldownEnabled = true }: { currentFilters: FilterState; drilldownEnabled?: boolean }) => useLibraryStatsQuery({
            filters: currentFilters,
            settings,
            privacyEnabled: false,
            allCollections,
            settingsLoaded: true,
            validFacetsEnabled: drilldownEnabled,
        }),
        {
            wrapper,
            initialProps: { currentFilters: filters, drilldownEnabled: validFacetsEnabled },
        }
    );
};

const waitForMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('useLibraryStatsQuery valid facets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        searchRepoMocks.getFacets.mockResolvedValue(emptyFacets);
        searchRepoMocks.getLibraryStats.mockResolvedValue(emptyStats);
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

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalled());

        expect(searchRepoMocks.getValidFacetNames).not.toHaveBeenCalled();
    });

    it('defers valid facets until drill-down UI is active', async () => {
        const filteredState = createDefaultFilters({ searchQuery: 'portrait' });
        const { rerender } = renderStatsHook(filteredState, [], false);

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalled());
        expect(searchRepoMocks.getValidFacetNames).not.toHaveBeenCalled();

        rerender({ currentFilters: filteredState, drilldownEnabled: true });

        await waitFor(() => expect(searchRepoMocks.getValidFacetNames).toHaveBeenCalled());
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

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(1));

        rerender({ currentFilters: createDefaultFilters({ searchQuery: 'date:2026' }) });
        await waitForMs(600);
        rerender({ currentFilters: createDefaultFilters({ searchQuery: 'date:2026-04' }) });
        await waitForMs(SIDE_QUERY_SEARCH_DEBOUNCE_MS - 100);

        expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(1);
        await waitForMs(120);

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(2));

        const calls = searchRepoMocks.getLibraryStats.mock.calls as Array<
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

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(1));

        rerender({ currentFilters: createDefaultFilters({ dateRange: 'today' }) });

        await waitFor(() => expect(searchRepoMocks.getLibraryStats).toHaveBeenCalledTimes(2));
    });
});
