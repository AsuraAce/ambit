import React, { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useParameterRangesQuery } from '../useParameterRangesQuery';
import { createDefaultFilters } from '../../utils/filterState';
import type { ParameterRanges } from '../../bindings';
import { SIDE_QUERY_SEARCH_DEBOUNCE_MS } from '../useDebouncedSideQueryFilters';

const commandMocks = vi.hoisted(() => ({
    getParameterRanges: vi.fn(),
}));

vi.mock('../../bindings', () => ({
    commands: {
        getParameterRanges: commandMocks.getParameterRanges,
    },
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => false,
}));

vi.mock('../../contexts/SettingsContext', () => ({
    useSettings: () => ({
        settings: {
            maskingMode: 'blur',
            maskedKeywords: [],
        },
        privacyEnabled: false,
    }),
}));

vi.mock('../../contexts/CollectionContext', () => ({
    useCollections: () => ({
        collections: [],
    }),
}));

const emptyParameterRanges: ParameterRanges = {
    steps: null,
    cfg: null,
    denoisingStrength: null,
    samplers: [],
    generationTypes: [],
    controlNets: [],
    ipAdapters: [],
    guidanceSubtypes: {},
};

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
            },
        },
    });

    return ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

const waitForMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('useParameterRangesQuery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        commandMocks.getParameterRanges.mockResolvedValue({
            status: 'ok',
            data: emptyParameterRanges,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('refetches parameter ranges when advanced date search syntax changes', async () => {
        const wrapper = createWrapper();
        const { rerender } = renderHook(
            ({ searchQuery }) => useParameterRangesQuery(createDefaultFilters({ searchQuery })),
            {
                wrapper,
                initialProps: { searchQuery: '' },
            }
        );

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(1));

        rerender({ searchQuery: 'date:2026-04-01..2026-04-30' });
        expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(1);
        await waitForMs(SIDE_QUERY_SEARCH_DEBOUNCE_MS + 20);

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(2));

        const calls = commandMocks.getParameterRanges.mock.calls as Array<
            [where: string, paramsJson: string, collectionId?: string, loraName?: string]
        >;
        const [where, paramsJson] = calls[1];

        expect(where).toContain('timestamp >= ?');
        expect(where).toContain('timestamp < ?');
        expect(JSON.parse(paramsJson)).toEqual([
            new Date(2026, 3, 1).getTime(),
            new Date(2026, 4, 1).getTime(),
        ]);
    });

    it('refetches parameter ranges for one-sided advanced date syntax', async () => {
        const wrapper = createWrapper();
        const { rerender } = renderHook(
            ({ searchQuery }) => useParameterRangesQuery(createDefaultFilters({ searchQuery })),
            {
                wrapper,
                initialProps: { searchQuery: '' },
            }
        );

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(1));

        rerender({ searchQuery: 'after:2026-04-01' });
        expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(1);
        await waitForMs(SIDE_QUERY_SEARCH_DEBOUNCE_MS + 20);

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(2));

        const calls = commandMocks.getParameterRanges.mock.calls as Array<
            [where: string, paramsJson: string, collectionId?: string, loraName?: string]
        >;
        const [where, paramsJson] = calls[1];

        expect(where).toContain('timestamp >= ?');
        expect(where).not.toContain('timestamp < ?');
        expect(JSON.parse(paramsJson)).toEqual([new Date(2026, 3, 1).getTime()]);
    });

    it('collapses rapid search-only corrections into one parameter range request', async () => {
        const wrapper = createWrapper();
        const { rerender } = renderHook(
            ({ searchQuery }) => useParameterRangesQuery(createDefaultFilters({ searchQuery })),
            {
                wrapper,
                initialProps: { searchQuery: '' },
            }
        );

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(1));

        rerender({ searchQuery: 'date:2026' });
        await waitForMs(600);
        rerender({ searchQuery: 'date:2026-04' });
        await waitForMs(SIDE_QUERY_SEARCH_DEBOUNCE_MS - 100);

        expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(1);
        await waitForMs(120);

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(2));

        const calls = commandMocks.getParameterRanges.mock.calls as Array<
            [where: string, paramsJson: string, collectionId?: string, loraName?: string]
        >;
        const [where, paramsJson] = calls[1];

        expect(where).toContain('timestamp >= ?');
        expect(where).toContain('timestamp < ?');
        expect(JSON.parse(paramsJson)).toEqual([
            new Date(2026, 3, 1).getTime(),
            new Date(2026, 4, 1).getTime(),
        ]);
    });

    it('updates parameter ranges immediately for non-search filter changes', async () => {
        const wrapper = createWrapper();
        const { rerender } = renderHook(
            ({ models }) => useParameterRangesQuery(createDefaultFilters({ models })),
            {
                wrapper,
                initialProps: { models: [] as string[] },
            }
        );

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(1));

        rerender({ models: ['Model A'] });

        await waitFor(() => expect(commandMocks.getParameterRanges).toHaveBeenCalledTimes(2));
    });
});
