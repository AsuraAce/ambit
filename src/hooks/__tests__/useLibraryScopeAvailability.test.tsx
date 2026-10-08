import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryScopeAvailability } from '../useLibraryScopeAvailability';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import { createDefaultFilters } from '../../utils/filterState';
import { createEmptyLibraryScopeCounts } from '../../utils/libraryScopeCounts';
import { useLibraryStore } from '../../stores/libraryStore';

const mocks = vi.hoisted(() => ({ count: vi.fn(), browser: vi.fn(), useBrowser: false }));
vi.mock('../../services/db/searchRepo', () => ({ countLibraryScopes: mocks.count }));
vi.mock('../../services/browserMockData', () => ({ getBrowserMockScopeAvailability: mocks.browser }));
vi.mock('../../services/runtime', () => ({ isBrowserMockMode: () => mocks.useBrowser }));

describe('useLibraryScopeAvailability', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.useBrowser = false; });

    const setup = (enabled = true) => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const props = { filters: createDefaultFilters(), settings: createDefaultAppSettings(), privacyEnabled: false, enabled };
        return { client, props, ...renderHook(useLibraryScopeAvailability, { wrapper, initialProps: props }) };
    };

    it('does not invent zero availability while loading or block on current search and collection', async () => {
        const counts = createEmptyLibraryScopeCounts();
        counts.media.image = 2; counts.media.all = 2; counts.imageKinds.photograph = 2; counts.imageKinds.all = 2;
        let resolve!: (value: typeof counts) => void;
        mocks.count.mockReturnValue(new Promise<typeof counts>(done => { resolve = done; }));
        const hook = setup();
        expect(hook.result.current.data).toBeUndefined();
        await act(async () => resolve(counts));
        await waitFor(() => expect(hook.result.current.data).toEqual(counts));
        hook.rerender({ ...hook.props, filters: createDefaultFilters({ searchQuery: 'no matches', collectionId: 'empty', mediaType: 'video', sourceKind: 'photograph' }) });
        expect(hook.result.current.data).toEqual(counts);
        expect(mocks.count).toHaveBeenCalledTimes(1);
        expect(mocks.count.mock.calls[0][0]).not.toContain('media_type');
    });

    it('fails closed when privacy changes, and waits for query admission', async () => {
        const counts = createEmptyLibraryScopeCounts();
        mocks.count.mockResolvedValueOnce(counts).mockReturnValue(new Promise(() => {}));
        const hook = setup(false);
        expect(mocks.count).not.toHaveBeenCalled();
        hook.rerender({ ...hook.props, enabled: true });
        await waitFor(() => expect(hook.result.current.data).toEqual(counts));
        hook.rerender({ ...hook.props, enabled: true, privacyEnabled: true, settings: createDefaultAppSettings({ maskingMode: 'hide' }) });
        expect(hook.result.current.data).toBeUndefined();
        await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(2));
        expect(mocks.count.mock.calls[1][0]).toContain('privacy');
    });

    it('refreshes with library invalidation and facet changes, not an images-cache entry', async () => {
        mocks.count.mockResolvedValue(createEmptyLibraryScopeCounts());
        const hook = setup();
        await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
        await act(async () => { await hook.client.invalidateQueries({ queryKey: ['libraryStats'] }); });
        expect(mocks.count).toHaveBeenCalledTimes(2);
        act(() => useLibraryStore.getState().incrementFacetCacheVersion());
        await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(3));
        expect(hook.client.getQueriesData({ queryKey: ['images'] })).toEqual([]);
    });

    it('uses the browser mock with the same privacy and visibility boundary', async () => {
        mocks.useBrowser = true;
        mocks.browser.mockReturnValue(createEmptyLibraryScopeCounts());
        const hook = setup();
        await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
        expect(mocks.browser).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'all', sourceKind: 'all', collectionId: null }), { privacyEnabled: false, settings: hook.props.settings });
        expect(mocks.count).not.toHaveBeenCalled();
    });
});
