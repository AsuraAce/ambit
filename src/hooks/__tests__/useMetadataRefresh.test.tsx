import { act, renderHook } from '../../test/testUtils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useMetadataRefresh } from '../useMetadataRefresh';
import { useLibraryStore } from '../../stores/libraryStore';

const { mockAddToast, listenerCallbacks } = vi.hoisted(() => ({
    mockAddToast: vi.fn(),
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

describe('useMetadataRefresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        listenerCallbacks.clear();
        useLibraryStore.setState({
            isStartupCatchupPending: false,
            isMetadataRefreshPending: false,
            isRefreshingMetadata: false,
            refreshProgress: null
        });
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
