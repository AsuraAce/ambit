import { act, renderHook } from '../../test/testUtils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useMetadataRefresh } from '../useMetadataRefresh';
import { useLibraryStore } from '../../stores/libraryStore';

const { mockAddToast, mockRebuildFacetCacheIncrementalBatchStrict, listenerCallbacks } = vi.hoisted(() => ({
    mockAddToast: vi.fn(),
    mockRebuildFacetCacheIncrementalBatchStrict: vi.fn(),
    listenerCallbacks: new Map<string, (event: { payload: unknown }) => void>()
}));

vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast
    })
}));

vi.mock('../../utils/tauriListener', () => ({
    listenWithCleanup: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
        listenerCallbacks.set(eventName, callback);
        return { cleanup: vi.fn() };
    })
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCacheIncrementalBatchStrict: mockRebuildFacetCacheIncrementalBatchStrict
}));

const flushAsyncWork = async () => {
    await act(async () => {
        await Promise.resolve();
    });
};

describe('useMetadataRefresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        listenerCallbacks.clear();
        useLibraryStore.setState({
            facetCacheVersion: 0,
            isStartupCatchupPending: false,
            isMetadataRefreshPending: false,
            isRefreshingMetadata: false,
            refreshProgress: null
        });
        mockRebuildFacetCacheIncrementalBatchStrict.mockResolvedValue(7);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('retries automatic startup refresh when the database is temporarily locked', async () => {
        let startAttempts = 0;
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') {
                return Promise.resolve(12);
            }
            if (command === 'start_reparse_job') {
                startAttempts += 1;
                if (startAttempts === 1) {
                    return Promise.reject('database is locked');
                }
                return Promise.resolve({
                    processed: 12,
                    updated: 12,
                    errors: 0,
                    wasCancelled: false
                });
            }
            return Promise.resolve(undefined);
        });

        renderHook(() => useMetadataRefresh());

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(startAttempts).toBe(1);
        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Parser updated - re-analyzing 12 images in the background',
            'info'
        );
        expect(mockAddToast).not.toHaveBeenCalledWith(
            expect.stringContaining('Failed to start refresh'),
            'error'
        );

        await act(async () => {
            await vi.advanceTimersByTimeAsync(15000);
        });

        expect(startAttempts).toBe(2);
        expect(mockAddToast).not.toHaveBeenCalledWith(
            expect.stringContaining('Failed to start refresh'),
            'error'
        );
    });

    it('keeps automatic startup refresh pending while startup catch-up is still checking', async () => {
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') {
                return Promise.resolve(12);
            }
            if (command === 'start_reparse_job') {
                return Promise.resolve({
                    processed: 12,
                    updated: 12,
                    errors: 0,
                    wasCancelled: false
                });
            }
            return Promise.resolve(undefined);
        });
        useLibraryStore.setState({ isStartupCatchupPending: true });

        renderHook(() => useMetadataRefresh());

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);
        expect(invoke).not.toHaveBeenCalledWith('start_reparse_job', expect.anything());

        act(() => {
            useLibraryStore.setState({ isStartupCatchupPending: false });
        });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(15000);
        });

        expect(invoke).toHaveBeenCalledWith('start_reparse_job', {
            forceReparse: false,
            filterRoot: null,
            filterTool: null
        });
    });

    it('announces automatic startup refresh only after processing starts', async () => {
        let resolveStart: ((value: unknown) => void) | undefined;
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') {
                return Promise.resolve(12);
            }
            if (command === 'start_reparse_job') {
                return new Promise(resolve => {
                    resolveStart = resolve;
                });
            }
            return Promise.resolve(undefined);
        });

        renderHook(() => useMetadataRefresh());

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Parser updated - re-analyzing 12 images in the background',
            'info'
        );

        act(() => {
            listenerCallbacks.get('refresh-progress')?.({
                payload: {
                    current: 0,
                    total: 12,
                    updated: 0,
                    errors: 0,
                    phase: 'counting',
                    message: 'Calculating total images...'
                }
            });
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Parser updated - re-analyzing 12 images in the background',
            'info'
        );

        act(() => {
            listenerCallbacks.get('refresh-progress')?.({
                payload: {
                    current: 0,
                    total: 12,
                    updated: 0,
                    errors: 0,
                    phase: 'starting',
                    message: 'Found 12 images to refresh'
                }
            });
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Parser updated - re-analyzing 12 images in the background',
            'info'
        );

        act(() => {
            listenerCallbacks.get('refresh-progress')?.({
                payload: {
                    current: 1,
                    total: 12,
                    updated: 10,
                    errors: 0,
                    phase: 'processing',
                    message: 'Processed 1/12'
                }
            });
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(true);
        expect(useLibraryStore.getState().refreshProgress).toEqual(expect.objectContaining({
            current: 1,
            phase: 'processing'
        }));
        expect(mockAddToast).toHaveBeenCalledWith(
            'Parser updated - re-analyzing 12 images in the background',
            'info'
        );

        await act(async () => {
            resolveStart?.({
                processed: 12,
                updated: 12,
                errors: 0,
                wasCancelled: false
            });
        });
    });

    it('clears automatic startup refresh pending state when backend events are missed', async () => {
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') {
                return Promise.resolve(12);
            }
            if (command === 'start_reparse_job') {
                return Promise.resolve({
                    processed: 12,
                    updated: 12,
                    errors: 0,
                    wasCancelled: false
                });
            }
            return Promise.resolve(undefined);
        });

        renderHook(() => useMetadataRefresh());

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledWith([
            'checkpoints',
            'loras',
            'embeddings',
            'hypernetworks',
            'controlNets',
            'ipAdapters',
            'tools'
        ]);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('refreshes parser-derived facets after metadata refresh updates records', async () => {
        renderHook(() => useMetadataRefresh());

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 12,
                    updated: 3,
                    errors: 0,
                    wasCancelled: false
                }
            });
        });

        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledWith([
            'checkpoints',
            'loras',
            'embeddings',
            'hypernetworks',
            'controlNets',
            'ipAdapters',
            'tools'
        ]);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        expect(mockAddToast).not.toHaveBeenCalledWith(
            expect.stringContaining('asset counts may be stale'),
            'warning'
        );
    });

    it('skips facet refresh when metadata refresh has no updates', async () => {
        renderHook(() => useMetadataRefresh());

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 12,
                    updated: 0,
                    errors: 0,
                    wasCancelled: false
                }
            });
        });

        expect(mockRebuildFacetCacheIncrementalBatchStrict).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(0);
    });

    it('refreshes facets after a cancelled metadata refresh that updated records', async () => {
        renderHook(() => useMetadataRefresh());

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 5,
                    updated: 2,
                    errors: 0,
                    wasCancelled: true
                }
            });
        });

        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledWith([
            'checkpoints',
            'loras',
            'embeddings',
            'hypernetworks',
            'controlNets',
            'ipAdapters',
            'tools'
        ]);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('keeps refresh completion cleanup when facet refresh fails', async () => {
        mockRebuildFacetCacheIncrementalBatchStrict.mockRejectedValueOnce(new Error('facet refresh failed'));
        useLibraryStore.setState({
            isMetadataRefreshPending: true,
            isRefreshingMetadata: true,
            refreshProgress: {
                current: 1,
                total: 2,
                updated: 1,
                errors: 0,
                phase: 'processing',
                message: 'Processing'
            }
        });
        renderHook(() => useMetadataRefresh());

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 2,
                    updated: 1,
                    errors: 0,
                    wasCancelled: false
                }
            });
        });

        await flushAsyncWork();

        expect(mockAddToast).toHaveBeenCalledWith(
            'Metadata refresh finished, but asset counts may be stale until the next refresh.',
            'warning'
        );
        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(0);
    });

    it('refreshes facets from manual start fallback when completion events are missed', async () => {
        vi.mocked(invoke).mockResolvedValue({
            processed: 8,
            updated: 4,
            errors: 0,
            wasCancelled: false
        });
        const { result } = renderHook(() => useMetadataRefresh());

        await act(async () => {
            await result.current.startRefresh();
        });
        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('refreshes facets from force refresh fallback when completion events are missed', async () => {
        vi.mocked(invoke).mockResolvedValue({
            processed: 8,
            updated: 4,
            errors: 0,
            wasCancelled: false
        });
        const { result } = renderHook(() => useMetadataRefresh());

        await act(async () => {
            await result.current.forceRefresh(undefined, true);
        });
        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('does not refresh facets twice when completion event and invoke result both report updates', async () => {
        let resolveStart: ((value: unknown) => void) | undefined;
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'start_reparse_job') {
                return new Promise(resolve => {
                    resolveStart = resolve;
                });
            }
            return Promise.resolve(undefined);
        });
        const { result } = renderHook(() => useMetadataRefresh());

        const startPromise = act(async () => {
            await result.current.startRefresh();
        });

        act(() => {
            listenerCallbacks.get('refresh-progress')?.({
                payload: {
                    current: 1,
                    total: 8,
                    updated: 4,
                    errors: 0,
                    phase: 'processing',
                    message: 'Processed 1/8'
                }
            });
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 8,
                    updated: 4,
                    errors: 0,
                    wasCancelled: false
                }
            });
            listenerCallbacks.get('refresh-progress')?.({
                payload: {
                    current: 8,
                    total: 8,
                    updated: 4,
                    errors: 0,
                    phase: 'complete',
                    message: 'Completed 8 / 8 images'
                }
            });
        });
        resolveStart?.({
            processed: 8,
            updated: 4,
            errors: 0,
            wasCancelled: false
        });
        await startPromise;
        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('still reports manual refresh failures immediately', async () => {
        vi.mocked(invoke).mockRejectedValue('database is locked');

        const { result } = renderHook(() => useMetadataRefresh());

        await act(async () => {
            await result.current.startRefresh();
        });

        expect(mockAddToast).toHaveBeenCalledWith(
            'Failed to start refresh: database is locked',
            'error'
        );
    });
});
