import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryScopeCounts } from '../useLibraryScopeCounts';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import { createDefaultFilters } from '../../utils/filterState';
import type { Collection, LibraryScopeCounts } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';

const mocks = vi.hoisted(() => ({ count: vi.fn(), browser: vi.fn(), useBrowser: false }));
vi.mock('../../services/db/searchRepo', () => ({ countLibraryScopes: mocks.count }));
vi.mock('../../services/browserMockData', () => ({ getBrowserMockScopeCounts: mocks.browser }));
vi.mock('../../services/runtime', () => ({ isBrowserMockMode: () => mocks.useBrowser }));

const counts: LibraryScopeCounts = {
    media: { all: 3, image: 2, video: 1 },
    imageKinds: { all: 2, generated: 0, photograph: 2, other: 0 },
};

describe('useLibraryScopeCounts', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.useBrowser = false; mocks.count.mockResolvedValue(counts); });
    const setup = (enabled = false) => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const props = { filters: createDefaultFilters(), settings: createDefaultAppSettings(), privacyEnabled: false, allCollections: [] as Collection[], enabled };
        return { client, props, ...renderHook(useLibraryScopeCounts, { wrapper, initialProps: props }) };
    };

    it('waits for admission, then counts without restricting media or image kind', async () => {
        const hook = setup();
        expect(mocks.count).not.toHaveBeenCalled();
        hook.rerender({ ...hook.props, enabled: true, filters: createDefaultFilters({ mediaType: 'image', sourceKind: 'photograph', searchQuery: 'portrait' }) });
        await waitFor(() => expect(hook.result.current.data).toEqual(counts));
        expect(mocks.count.mock.calls[0][0]).toContain('prompt');
        expect(mocks.count.mock.calls[0][0]).not.toContain('media_type');
        expect(mocks.count.mock.calls[0][1]).not.toContain('photograph');
    });

    it('isolates late search responses and retries failures without image-cache work', async () => {
        let finishOld!: (value: LibraryScopeCounts) => void;
        mocks.count.mockReturnValueOnce(new Promise<LibraryScopeCounts>(resolve => { finishOld = resolve; }))
            .mockRejectedValueOnce(new Error('counts failed'));
        const hook = setup(true);
        await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(1));
        hook.rerender({ ...hook.props, enabled: true, filters: createDefaultFilters({ searchQuery: 'new' }) });
        await waitFor(() => expect(hook.result.current.isError).toBe(true));
        await act(async () => finishOld(counts));
        expect(hook.result.current.data).toBeUndefined();
        await act(async () => { await hook.result.current.refetch(); });
        await waitFor(() => expect(hook.result.current.data).toEqual(counts));
        expect(hook.client.getQueriesData({ queryKey: ['images'] })).toEqual([]);
    });

    it('refreshes on library revisions and smart-rule edits but not ordinary count or scope selection changes', async () => {
        const hook = setup(true);
        await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
        hook.rerender({ ...hook.props, enabled: true, filters: createDefaultFilters({ mediaType: 'image', sourceKind: 'photograph' }) });
        expect(mocks.count).toHaveBeenCalledTimes(1);
        await act(async () => { await hook.client.invalidateQueries({ queryKey: ['libraryStats'] }); });
        expect(mocks.count).toHaveBeenCalledTimes(2);
        act(() => useLibraryStore.getState().incrementFacetCacheVersion());
        await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(3));
        const collection: Collection = { id: 'smart', name: 'Smart', createdAt: 1, imageIds: [], filters: createDefaultFilters({ searchQuery: 'portrait' }) };
        const smartProps = { ...hook.props, enabled: true, filters: createDefaultFilters({ collectionId: 'smart' }), allCollections: [collection] };
        hook.rerender(smartProps);
        await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(4));
        expect(mocks.count.mock.calls[3][1]).toContain('%portrait%');
        hook.rerender({ ...smartProps, allCollections: [{ ...collection, count: 9 }] });
        expect(mocks.count).toHaveBeenCalledTimes(4);
        hook.rerender({ ...smartProps, allCollections: [{ ...collection, filters: createDefaultFilters({ searchQuery: 'landscape' }) }] });
        await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(5));
        expect(mocks.count.mock.calls[4][1]).toContain('%landscape%');
    });

    it('does not reuse counts across privacy and owner changes', async () => {
        const hook = setup(true);
        await waitFor(() => expect(hook.result.current.data).toEqual(counts));
        mocks.count.mockReturnValue(new Promise(() => {}));
        hook.rerender({ ...hook.props, enabled: false, privacyEnabled: true, settings: createDefaultAppSettings({ maskingMode: 'hide' }) });
        expect(hook.result.current.data).toBeUndefined();
        expect(mocks.count).toHaveBeenCalledTimes(1);
        hook.rerender({ ...hook.props, enabled: true, privacyEnabled: true, settings: createDefaultAppSettings({ maskingMode: 'hide' }) });
        await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(2));
        expect(mocks.count.mock.calls[1][0]).toContain('privacy_hidden = 0');
        const ownerSettings = createDefaultAppSettings({ invokeAiPath: 'C:/Invoke' });
        const scope = { dbPath: 'C:/Invoke/databases/invokeai.db', imagesRoot: 'C:/Invoke' };
        act(() => useInvokeOwnerScopeStore.getState().setOwnerScopeState({ status: 'ready', rootPath: 'C:/Invoke', scope: { ...scope, mode: 'all' } }));
        mocks.count.mockResolvedValue(counts);
        hook.rerender({ ...hook.props, enabled: true, settings: ownerSettings });
        await waitFor(() => expect(hook.result.current.data).toEqual(counts));
        mocks.count.mockReturnValue(new Promise(() => {}));
        act(() => useInvokeOwnerScopeStore.getState().setOwnerScopeState({ status: 'ready', rootPath: 'C:/Invoke', scope: { ...scope, mode: 'owner', ownerId: 'other' } }));
        expect(hook.result.current.data).toBeUndefined();
    });

    it('uses the separate browser count seam with privacy and contextual filters', async () => {
        mocks.useBrowser = true;
        mocks.browser.mockReturnValue(counts);
        const hook = setup(true);
        await waitFor(() => expect(hook.result.current.data).toEqual(counts));
        expect(mocks.browser).toHaveBeenCalledWith(hook.props.filters, { privacyEnabled: false, settings: hook.props.settings });
        expect(mocks.count).not.toHaveBeenCalled();
    });
});
