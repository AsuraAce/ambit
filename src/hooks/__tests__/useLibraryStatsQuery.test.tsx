import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStatsQuery } from '../useLibraryStatsQuery';
import { AppSettings, Collection } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
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

const renderStatsHook = (filters = createDefaultFilters(), allCollections: Collection[] = []) => {
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
        }),
        { wrapper }
    );
};

describe('useLibraryStatsQuery valid facets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
