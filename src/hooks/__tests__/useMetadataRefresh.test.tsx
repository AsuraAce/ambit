import { act, renderHook } from '../../test/testUtils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useMetadataRefresh, useMetadataRefreshPause } from '../useMetadataRefresh';
import { useLibraryStore } from '../../stores/libraryStore';
import { startupDiagnostics } from '../../utils/startupDiagnostics';

const { mockAddToast, mockRebuildFacetCacheIncrementalBatchStrict, listenerCallbacks, listenerCleanups, runtimeMock } = vi.hoisted(() => ({
    mockAddToast: vi.fn(),
    mockRebuildFacetCacheIncrementalBatchStrict: vi.fn(),
    listenerCallbacks: new Map<string, (event: { payload: unknown }) => void>(),
    listenerCleanups: [] as ReturnType<typeof vi.fn>[],
    runtimeMock: { browserMode: false },
}));

vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

vi.mock('../../utils/tauriListener', () => ({
    listenWithCleanup: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
        listenerCallbacks.set(eventName, callback);
        const cleanup = vi.fn();
        listenerCleanups.push(cleanup);
        return { cleanup };
    }),
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => runtimeMock.browserMode,
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCacheIncrementalBatchStrict: mockRebuildFacetCacheIncrementalBatchStrict,
}));

const flushAsyncWork = async () => {
    await act(async () => {
        await Promise.resolve();
    });
};

interface TestRefreshResult {
    processed: number;
    updated: number;
    errors: number;
    wasCancelled: boolean;
}

describe('useMetadataRefresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        listenerCallbacks.clear();
        listenerCleanups.length = 0;
        runtimeMock.browserMode = false;
        useLibraryStore.setState({
            facetCacheVersion: 0,
            isStartupCatchupPending: false,
            isImporting: false,
            syncStatus: 'idle',
            isOwnerCacheRepairing: false,
            isMetadataRefreshPending: false,
            isRefreshingMetadata: false,
            refreshProgress: null,
        });
        mockRebuildFacetCacheIncrementalBatchStrict.mockResolvedValue(7);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not count or reparse metadata until the library is ready', async () => {
        vi.mocked(invoke).mockResolvedValue(0);
        const { rerender } = renderHook(({ ready }) => useMetadataRefresh(ready), {
            initialProps: { ready: false },
        });
        await act(async () => vi.advanceTimersByTimeAsync(8 * 60_000));
        expect(invoke).not.toHaveBeenCalledWith('get_reparse_count');
        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        rerender({ ready: true });
        await act(async () => vi.advanceTimersByTimeAsync(3_000));
        expect(invoke).toHaveBeenCalledWith('get_reparse_count');
    });

    it('does not start a second automatic reparse when readiness changes during a native run', async () => {
        let finishReparse!: (value: TestRefreshResult) => void;
        const reparse = new Promise<TestRefreshResult>((resolve) => {
            finishReparse = resolve;
        });
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') return Promise.resolve(12);
            if (command === 'start_reparse_job') return reparse;
            return Promise.resolve({ processed: 0, updated: 0, errors: 0, wasCancelled: false });
        });
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        await act(async () => vi.advanceTimersByTimeAsync(3_000));
        view.rerender({ ready: false });
        view.rerender({ ready: true });
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'start_reparse_job')).toHaveLength(1);
        await act(async () => finishReparse({ processed: 12, updated: 0, errors: 0, wasCancelled: false }));
        await act(async () => vi.advanceTimersByTimeAsync(30_000));
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'start_reparse_job')).toHaveLength(1);
    });

    it('does not retry a stale count failure after readiness is withdrawn', async () => {
        let rejectCount!: (reason: string) => void;
        vi.mocked(invoke).mockReturnValue(
            new Promise((_, reject) => {
                rejectCount = reject;
            })
        );
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        await act(async () => vi.advanceTimersByTimeAsync(3_000));
        view.rerender({ ready: false });
        await act(async () => rejectCount('SQLITE_BUSY'));
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_reparse_count')).toHaveLength(1);
        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
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
                    wasCancelled: false,
                });
            }
            return Promise.resolve(undefined);
        });

        renderHook(() => useMetadataRefresh(true));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(startAttempts).toBe(1);
        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Ambit is updating metadata for 12 items after a parser update. Your library remains available.',
            'info'
        );
        expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringContaining('Failed to start refresh'), 'error');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(15000);
        });

        expect(startAttempts).toBe(2);
        expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringContaining('Failed to start refresh'), 'error');
    });

    // An owner switch clears readiness. Restarting the lock retries at attempt 1 after every switch
    // kept a failing reparse running, and writing, through each later switch (#552).
    it('keeps counting lock retries across readiness changes and stops after the last attempt', async () => {
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') return Promise.resolve(12);
            if (command === 'start_reparse_job') return Promise.reject('database is locked');
            return Promise.resolve(undefined);
        });
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        for (let cycle = 0; cycle < 30; cycle += 1) {
            await act(async () => vi.advanceTimersByTimeAsync(3_000));
            view.rerender({ ready: false });
            view.rerender({ ready: true });
        }
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'start_reparse_job')).toHaveLength(20);
        expect(mockAddToast).toHaveBeenCalledWith('Failed to start refresh: database is locked', 'error');
        expect(mockAddToast).toHaveBeenCalledTimes(1);
    });

    it('counts a lock failure that arrives after readiness was withdrawn, up to the last attempt', async () => {
        const rejections: Array<(reason: string) => void> = [];
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') return Promise.resolve(12);
            if (command === 'start_reparse_job') {
                return new Promise((_, reject) => {
                    rejections.push(reject);
                });
            }
            return Promise.resolve(undefined);
        });
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        for (let cycle = 0; cycle < 25; cycle += 1) {
            await act(async () => vi.advanceTimersByTimeAsync(3_000));
            if (rejections.length <= cycle) break;
            view.rerender({ ready: false });
            await act(async () => rejections[cycle]('database is locked'));
            view.rerender({ ready: true });
        }
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(rejections).toHaveLength(20);
        expect(mockAddToast).toHaveBeenCalledWith('Failed to start refresh: database is locked', 'error');
    });

    it('stops the startup count check for the session after its last locked attempt', async () => {
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') return Promise.reject('database is locked');
            return Promise.resolve(undefined);
        });
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        for (let cycle = 0; cycle < 30; cycle += 1) {
            await act(async () => vi.advanceTimersByTimeAsync(3_000));
            view.rerender({ ready: false });
            view.rerender({ ready: true });
        }
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_reparse_count')).toHaveLength(20);
    });

    // The startup count scans every image. Run during an owner-cache build, it doubled the build's
    // facet time (#567), so it waits for the build and then counts once.
    describe('while an owner-cache build runs', () => {
        // The exact text of METADATA_REFRESH_PAUSED in src-tauri/src/db/commands/reparse_commands.rs.
        // Kept literal so a change on either side fails these tests.
        const RUST_METADATA_REFRESH_PAUSED = 'Metadata refresh paused';
        const countCalls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_reparse_count');

        it('does not count until the build ends, then counts once', async () => {
            vi.mocked(invoke).mockResolvedValue(0);
            useLibraryStore.setState({ isOwnerCacheRepairing: true });
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
            expect(countCalls()).toHaveLength(0);

            act(() => useLibraryStore.setState({ isOwnerCacheRepairing: false }));
            await act(async () => vi.advanceTimersByTimeAsync(3_000));
            expect(countCalls()).toHaveLength(1);

            act(() => useLibraryStore.setState({ isOwnerCacheRepairing: true }));
            act(() => useLibraryStore.setState({ isOwnerCacheRepairing: false }));
            await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
            expect(countCalls()).toHaveLength(1);
        });

        it('holds a count whose start delay a build interrupts', async () => {
            vi.mocked(invoke).mockResolvedValue(0);
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(1_000));
            act(() => useLibraryStore.setState({ isOwnerCacheRepairing: true }));
            await act(async () => vi.advanceTimersByTimeAsync(60_000));
            expect(countCalls()).toHaveLength(0);

            act(() => useLibraryStore.setState({ isOwnerCacheRepairing: false }));
            await act(async () => vi.advanceTimersByTimeAsync(60_000));
            expect(countCalls()).toHaveLength(1);
        });

        it('counts once more after a build stops a running count, without using a lock attempt', async () => {
            let rejectCount!: (reason: string) => void;
            let counts = 0;
            vi.mocked(invoke).mockImplementation((command) => {
                if (command !== 'get_reparse_count') return Promise.resolve(undefined);
                counts += 1;
                if (counts === 1) {
                    return new Promise((_, reject) => {
                        rejectCount = reject;
                    });
                }
                return Promise.reject('database is locked');
            });
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(3_000));
            expect(counts).toBe(1);

            act(() => useLibraryStore.setState({ isOwnerCacheRepairing: true }));
            await act(async () => rejectCount(RUST_METADATA_REFRESH_PAUSED));
            await act(async () => vi.advanceTimersByTimeAsync(60_000));
            expect(counts).toBe(1);
            expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);

            // The stopped count used no attempt: the 20 lock attempts all remain.
            act(() => useLibraryStore.setState({ isOwnerCacheRepairing: false }));
            await act(async () => vi.advanceTimersByTimeAsync(3_000 + 20 * 15_000 + 60_000));
            expect(counts).toBe(1 + 20);
        });

        it('retries a count paused while the startup check still runs, without using an attempt', async () => {
            let counts = 0;
            vi.mocked(invoke).mockImplementation((command) => {
                if (command !== 'get_reparse_count') return Promise.resolve(undefined);
                counts += 1;
                return counts === 1 ? Promise.reject(RUST_METADATA_REFRESH_PAUSED) : Promise.reject('database is locked');
            });
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(3_000));
            expect(counts).toBe(1);
            // A pause is not a failed check: the check stays pending and logs no failure.
            expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);
            expect(consoleError).not.toHaveBeenCalled();
            consoleError.mockRestore();

            await act(async () => vi.advanceTimersByTimeAsync(15_000));
            expect(counts).toBe(2);
            await act(async () => vi.advanceTimersByTimeAsync(20 * 15_000 + 60_000));
            expect(counts).toBe(1 + 20);
        });
    });

    // The count scans the whole library, so a 15 s gate retry must not scan again each time (#581).
    describe('while startup catch-up, an import or a sync holds', () => {
        const countCalls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_reparse_count');
        const startCalls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'start_reparse_job');
        const mockStaleLibrary = () =>
            vi
                .mocked(invoke)
                .mockImplementation((command) =>
                    command === 'get_reparse_count'
                        ? Promise.resolve(12)
                        : Promise.resolve({ processed: 12, updated: 0, errors: 0, wasCancelled: false })
                );

        it.each([
            { name: 'catch-up', busy: { isStartupCatchupPending: true }, idle: { isStartupCatchupPending: false } },
            { name: 'an import', busy: { isImporting: true }, idle: { isImporting: false } },
            { name: 'a sync', busy: { syncStatus: 'syncing' as const }, idle: { syncStatus: 'idle' as const } },
        ])('does not count during $name, then counts once and starts once', async ({ busy, idle }) => {
            mockStaleLibrary();
            useLibraryStore.setState(busy);
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
            expect(countCalls()).toHaveLength(0);
            expect(startCalls()).toHaveLength(0);
            // Thumbnails stay held while the check waits, as before.
            expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);

            act(() => useLibraryStore.setState(idle));
            await flushAsyncWork();
            expect(countCalls()).toHaveLength(1);
            expect(startCalls()).toHaveLength(1);

            await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
            expect(countCalls()).toHaveLength(1);
        });

        // Thumbnails wait while the check is pending, so it must not sit out a retry tick (#581 review).
        it('counts as soon as the last gate clears, without waiting for a retry tick', async () => {
            vi.mocked(invoke).mockResolvedValue(0);
            useLibraryStore.setState({ isStartupCatchupPending: true, isImporting: true });
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(3_000));

            act(() => useLibraryStore.setState({ isStartupCatchupPending: false }));
            await flushAsyncWork();
            expect(countCalls()).toHaveLength(0);

            act(() => useLibraryStore.setState({ isImporting: false }));
            await flushAsyncWork();
            expect(countCalls()).toHaveLength(1);
            await flushAsyncWork();
            expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        });

        it('does not count again when an import starts during the count', async () => {
            let resolveCount!: (count: number) => void;
            vi.mocked(invoke).mockImplementation((command) => {
                if (command === 'get_reparse_count') {
                    return new Promise((resolve) => {
                        resolveCount = resolve;
                    });
                }
                return Promise.resolve({ processed: 12, updated: 0, errors: 0, wasCancelled: false });
            });
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(3_000));
            expect(countCalls()).toHaveLength(1);

            act(() => useLibraryStore.setState({ isImporting: true }));
            await act(async () => resolveCount(12));
            await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
            expect(startCalls()).toHaveLength(0);

            act(() => useLibraryStore.setState({ isImporting: false }));
            await flushAsyncWork();
            expect(countCalls()).toHaveLength(1);
            expect(startCalls()).toHaveLength(1);
        });
    });

    it('pauses native metadata refresh while the app asks it to', async () => {
        vi.mocked(invoke).mockResolvedValue(undefined);
        const view = renderHook(({ paused }) => useMetadataRefreshPause(paused), { initialProps: { paused: false } });
        view.rerender({ paused: true });
        view.rerender({ paused: false });
        await flushAsyncWork();
        expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'set_metadata_refresh_paused')).toEqual([
            ['set_metadata_refresh_paused', { paused: false }],
            ['set_metadata_refresh_paused', { paused: true }],
            ['set_metadata_refresh_paused', { paused: false }],
        ]);
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
                    wasCancelled: false,
                });
            }
            return Promise.resolve(undefined);
        });
        useLibraryStore.setState({ isStartupCatchupPending: true });

        renderHook(() => useMetadataRefresh(true));

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
            filterTool: null,
            refreshPhotoMetadata: false,
        });
    });

    it('announces automatic startup refresh only after processing starts', async () => {
        let resolveStart: ((value: unknown) => void) | undefined;
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'get_reparse_count') {
                return Promise.resolve(12);
            }
            if (command === 'start_reparse_job') {
                return new Promise((resolve) => {
                    resolveStart = resolve;
                });
            }
            return Promise.resolve(undefined);
        });

        renderHook(() => useMetadataRefresh(true));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Ambit is updating metadata for 12 items after a parser update. Your library remains available.',
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
                    message: 'Calculating total images...',
                },
            });
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Ambit is updating metadata for 12 items after a parser update. Your library remains available.',
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
                    message: 'Found 12 images to refresh',
                },
            });
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        expect(mockAddToast).not.toHaveBeenCalledWith(
            'Ambit is updating metadata for 12 items after a parser update. Your library remains available.',
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
                    message: 'Processed 1/12',
                },
            });
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(true);
        expect(useLibraryStore.getState().refreshProgress).toEqual(
            expect.objectContaining({
                current: 1,
                phase: 'processing',
            })
        );
        expect(mockAddToast).toHaveBeenCalledWith(
            'Ambit is updating metadata for 12 items after a parser update. Your library remains available.',
            'info'
        );

        await act(async () => {
            resolveStart?.({
                processed: 12,
                updated: 12,
                errors: 0,
                wasCancelled: false,
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
                    wasCancelled: false,
                });
            }
            return Promise.resolve(undefined);
        });

        renderHook(() => useMetadataRefresh(true));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledWith(
            ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters', 'tools'],
            { signal: expect.any(AbortSignal) }
        );
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('refreshes parser-derived facets after metadata refresh updates records', async () => {
        renderHook(() => useMetadataRefresh(true));

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 12,
                    updated: 3,
                    errors: 0,
                    wasCancelled: false,
                },
            });
        });

        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledWith(
            ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters', 'tools'],
            { signal: expect.any(AbortSignal) }
        );
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringContaining('asset counts may be stale'), 'warning');
    });

    // The facet refresh holds the facet build lock an owner switch waits on, so the journal
    // must show it as its own span, not as part of the reparse or its count (#578).
    it('journals the post-reparse facet refresh as its own phase', async () => {
        const start = vi.spyOn(startupDiagnostics, 'start');
        let finishRefresh: (count: number) => void = () => undefined;
        mockRebuildFacetCacheIncrementalBatchStrict.mockReturnValueOnce(
            new Promise<number>((resolve) => {
                finishRefresh = resolve;
            })
        );
        renderHook(() => useMetadataRefresh(true));

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: { processed: 12, updated: 3, errors: 0, wasCancelled: false },
            });
        });
        await flushAsyncWork();

        expect(start).toHaveBeenCalledWith('metadata-facet-refresh', null);
        expect(start).not.toHaveBeenCalledWith('metadata-maintenance', null);
        finishRefresh(7);
        await flushAsyncWork();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        start.mockRestore();
    });

    // The refresh holds the facet build lock for minutes on a large library, and an owner
    // switch queued behind it for 160 s (#578). A switch stops it; it runs once afterwards,
    // since the counts still miss the reparse.
    it('stops the post-reparse facet refresh for an owner switch and runs it once afterwards', async () => {
        const signals: AbortSignal[] = [];
        mockRebuildFacetCacheIncrementalBatchStrict.mockImplementationOnce(
            (_types: string[], options: { signal: AbortSignal }) =>
                new Promise<number>((_, reject) => {
                    signals.push(options.signal);
                    options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
                })
        );
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: { processed: 12, updated: 3, errors: 0, wasCancelled: false },
            });
        });
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledOnce();

        view.rerender({ ready: false });
        expect(signals[0]?.aborted).toBe(true);
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledOnce();
        expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringContaining('asset counts may be stale'), 'warning');

        view.rerender({ ready: true });
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(2);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);

        view.rerender({ ready: false });
        view.rerender({ ready: true });
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(2);
    });

    // A second reparse can finish while the first one's facet refresh still runs. An owner switch
    // must stop both, or the first keeps the lock the switch waits on (#591 review).
    it('stops every overlapping post-reparse facet refresh and runs one afterwards', async () => {
        const signals: AbortSignal[] = [];
        mockRebuildFacetCacheIncrementalBatchStrict.mockImplementation(
            (_types: string[], options: { signal: AbortSignal }) =>
                new Promise<number>((_, reject) => {
                    signals.push(options.signal);
                    options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
                })
        );
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        const complete = () =>
            act(() => {
                listenerCallbacks.get('refresh-complete')?.({
                    payload: { processed: 12, updated: 3, errors: 0, wasCancelled: false },
                });
            });
        complete();
        await flushAsyncWork();
        act(() => {
            listenerCallbacks.get('refresh-progress')?.({
                payload: { current: 1, total: 12, updated: 0, errors: 0, phase: 'processing', message: '' },
            });
        });
        complete();
        await flushAsyncWork();

        view.rerender({ ready: false });
        await flushAsyncWork();
        expect(signals.length).toBeGreaterThan(0);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        const stoppedCalls = mockRebuildFacetCacheIncrementalBatchStrict.mock.calls.length;

        view.rerender({ ready: true });
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(stoppedCalls + 1);
    });
    // The journal is the smoke evidence: a stopped refresh must read as cancelled, not failed.
    it('journals a stopped post-reparse facet refresh as cancelled', async () => {
        const finish = vi.fn();
        const start = vi.spyOn(startupDiagnostics, 'start').mockReturnValue(finish);
        mockRebuildFacetCacheIncrementalBatchStrict.mockImplementationOnce(
            (_types: string[], options: { signal: AbortSignal }) =>
                new Promise<number>((_, reject) => {
                    options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
                })
        );
        const view = renderHook(({ ready }) => useMetadataRefresh(ready), { initialProps: { ready: true } });
        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: { processed: 12, updated: 3, errors: 0, wasCancelled: false },
            });
        });
        await flushAsyncWork();
        view.rerender({ ready: false });
        await flushAsyncWork();

        expect(start).toHaveBeenCalledWith('metadata-facet-refresh', null);
        expect(finish).toHaveBeenCalledWith('cancelled');
        expect(finish).not.toHaveBeenCalledWith('failed', expect.anything());
        start.mockRestore();
    });

    it('stops the post-reparse facet refresh while an owner cache is repaired', async () => {
        const signals: AbortSignal[] = [];
        mockRebuildFacetCacheIncrementalBatchStrict.mockImplementationOnce(
            (_types: string[], options: { signal: AbortSignal }) =>
                new Promise<number>((_, reject) => {
                    signals.push(options.signal);
                    options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
                })
        );
        renderHook(() => useMetadataRefresh(true));
        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: { processed: 12, updated: 3, errors: 0, wasCancelled: false },
            });
        });
        await flushAsyncWork();

        act(() => useLibraryStore.setState({ isOwnerCacheRepairing: true }));
        expect(signals[0]?.aborted).toBe(true);
        await flushAsyncWork();
        act(() => useLibraryStore.setState({ isOwnerCacheRepairing: false }));
        await flushAsyncWork();
        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(2);
    });

    it('skips facet refresh when metadata refresh has no updates', async () => {
        renderHook(() => useMetadataRefresh(true));

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 12,
                    updated: 0,
                    errors: 0,
                    wasCancelled: false,
                },
            });
        });

        expect(mockRebuildFacetCacheIncrementalBatchStrict).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(0);
    });

    it('refreshes facets after a cancelled metadata refresh that updated records', async () => {
        renderHook(() => useMetadataRefresh(true));

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 5,
                    updated: 2,
                    errors: 0,
                    wasCancelled: true,
                },
            });
        });

        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledWith(
            ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'controlNets', 'ipAdapters', 'tools'],
            { signal: expect.any(AbortSignal) }
        );
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
                message: 'Processing',
            },
        });
        renderHook(() => useMetadataRefresh(true));

        act(() => {
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 2,
                    updated: 1,
                    errors: 0,
                    wasCancelled: false,
                },
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
            wasCancelled: false,
        });
        const { result } = renderHook(() => useMetadataRefresh(true));

        await act(async () => {
            await result.current.startRefresh();
        });
        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        expect(invoke).toHaveBeenCalledWith('refresh_video_metadata', {
            filterRoot: null,
            forceReparse: false,
        });
    });

    it('keeps refresh active until video metadata finishes and reports one combined completion', async () => {
        let resolveImages: ((value: TestRefreshResult) => void) | undefined;
        let resolveVideos: ((value: TestRefreshResult) => void) | undefined;
        vi.mocked(invoke).mockImplementation((command) => {
            if (command === 'start_reparse_job') {
                return new Promise((resolve) => {
                    resolveImages = resolve;
                });
            }
            if (command === 'refresh_video_metadata') {
                return new Promise((resolve) => {
                    resolveVideos = resolve;
                });
            }
            return Promise.resolve(undefined);
        });
        const { result } = renderHook(() => useMetadataRefresh(true));

        let refreshPromise: Promise<unknown> | undefined;
        act(() => {
            refreshPromise = result.current.startRefresh();
        });
        act(() =>
            listenerCallbacks.get('refresh-complete')?.({
                payload: { processed: 2, updated: 1, errors: 0, wasCancelled: false },
            })
        );
        expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringContaining('Refresh complete'), expect.anything());

        await act(async () => {
            resolveImages?.({ processed: 2, updated: 1, errors: 0, wasCancelled: false });
            await Promise.resolve();
        });
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(true);
        expect(useLibraryStore.getState().refreshProgress?.message).toBe('Refreshing video metadata...');
        expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringContaining('Refresh complete'), expect.anything());

        await act(async () => {
            resolveVideos?.({ processed: 3, updated: 2, errors: 1, wasCancelled: false });
            await refreshPromise;
        });

        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(mockAddToast).toHaveBeenCalledWith('Refresh complete: 3 updated, 1 errors', 'warning');
        expect(mockAddToast.mock.calls.filter(([message]) => String(message).startsWith('Refresh complete:'))).toHaveLength(1);
    });

    it('refreshes facets from force refresh fallback when completion events are missed', async () => {
        vi.mocked(invoke).mockResolvedValue({
            processed: 8,
            updated: 4,
            errors: 0,
            wasCancelled: false,
        });
        const { result } = renderHook(() => useMetadataRefresh(true));

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
                return new Promise((resolve) => {
                    resolveStart = resolve;
                });
            }
            return Promise.resolve(undefined);
        });
        const { result } = renderHook(() => useMetadataRefresh(true));

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
                    message: 'Processed 1/8',
                },
            });
            listenerCallbacks.get('refresh-complete')?.({
                payload: {
                    processed: 8,
                    updated: 4,
                    errors: 0,
                    wasCancelled: false,
                },
            });
            listenerCallbacks.get('refresh-progress')?.({
                payload: {
                    current: 8,
                    total: 8,
                    updated: 4,
                    errors: 0,
                    phase: 'complete',
                    message: 'Completed 8 / 8 images',
                },
            });
        });
        resolveStart?.({
            processed: 8,
            updated: 4,
            errors: 0,
            wasCancelled: false,
        });
        await startPromise;
        await flushAsyncWork();

        expect(mockRebuildFacetCacheIncrementalBatchStrict).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('still reports manual refresh failures immediately', async () => {
        vi.mocked(invoke).mockRejectedValue('database is locked');

        const { result } = renderHook(() => useMetadataRefresh(true));

        await act(async () => {
            await result.current.startRefresh();
        });

        expect(mockAddToast).toHaveBeenCalledWith('Failed to start refresh: database is locked', 'error');
    });

    it('disables refresh controls and listeners in browser mock mode', async () => {
        runtimeMock.browserMode = true;
        const { result } = renderHook(() => useMetadataRefresh(true));
        expect(listenerCallbacks.size).toBe(0);

        await act(async () => {
            expect(await result.current.startRefresh()).toEqual({ ok: false });
            await result.current.cancelRefresh();
            await result.current.forceRefresh();
        });

        expect(invoke).not.toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledTimes(2);
        expect(mockAddToast).toHaveBeenCalledWith('Unavailable in browser mock mode.', 'info');
    });

    it('cleans up both backend listeners on unmount', () => {
        const { unmount } = renderHook(() => useMetadataRefresh(true));
        expect(listenerCleanups).toHaveLength(2);
        unmount();
        expect(listenerCleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true);
    });

    it('reports completion warnings and suppresses empty completion toasts', () => {
        renderHook(() => useMetadataRefresh(true));
        act(() =>
            listenerCallbacks.get('refresh-complete')?.({
                payload: { processed: 5, updated: 0, errors: 2, wasCancelled: false },
            })
        );
        expect(mockAddToast).toHaveBeenCalledWith('Refresh complete: 0 updated, 2 errors', 'warning');
        mockAddToast.mockClear();
        act(() =>
            listenerCallbacks.get('refresh-complete')?.({
                payload: { processed: 0, updated: 0, errors: 0, wasCancelled: false },
            })
        );
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('starts a tool-filtered refresh without showing a suppressed failure toast', async () => {
        vi.mocked(invoke).mockRejectedValueOnce(new Error('tool failed'));
        const { result } = renderHook(() => useMetadataRefresh(true));
        await act(async () => {
            const response = await result.current.startRefresh('ComfyUI', { showFailureToast: false });
            expect(response.ok).toBe(false);
        });
        expect(invoke).toHaveBeenCalledWith('start_reparse_job', expect.objectContaining({ filterTool: 'ComfyUI' }));
        expect(mockAddToast).not.toHaveBeenCalledWith(expect.stringContaining('Failed to start refresh'), 'error');
    });

    it('cancels refresh jobs and logs cancellation failures', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(invoke).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('cancel failed'));
        const { result } = renderHook(() => useMetadataRefresh(true));
        await act(async () => result.current.cancelRefresh());
        await act(async () => result.current.cancelRefresh());
        expect(invoke).toHaveBeenCalledWith('cancel_reparse_job');
        expect(consoleError).toHaveBeenCalledWith('[Refresh] Cancel error:', expect.any(Error));
        consoleError.mockRestore();
    });

    it('passes force-refresh filters and reports Error failures', async () => {
        vi.mocked(invoke)
            .mockResolvedValueOnce({ processed: 1, updated: 0, errors: 0, wasCancelled: false })
            .mockRejectedValueOnce(new Error('force failed'));
        const { result } = renderHook(() => useMetadataRefresh(true));
        await act(async () => result.current.forceRefresh('D:/Images', false, 'ComfyUI'));
        expect(invoke).toHaveBeenCalledWith('start_reparse_job', {
            forceReparse: false,
            filterRoot: 'D:/Images',
            filterTool: 'ComfyUI',
            refreshPhotoMetadata: false,
        });
        expect(useLibraryStore.getState().isRefreshingMetadata).toBe(false);
        expect(useLibraryStore.getState().refreshProgress).toBeNull();
        await act(async () => result.current.forceRefresh());
        expect(mockAddToast).toHaveBeenCalledWith('Failed to force refresh: force failed', 'error');
    });

    it('clears startup pending state when no images require reparsing', async () => {
        vi.mocked(invoke).mockResolvedValueOnce(0);
        renderHook(() => useMetadataRefresh(true));
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        expect(invoke).not.toHaveBeenCalledWith('start_reparse_job', expect.anything());
    });

    it.each([{ isImporting: true }, { syncStatus: 'syncing' as const }])(
        'defers startup refresh while another library task is active',
        async (busyState) => {
            vi.mocked(invoke).mockImplementation((command) =>
                command === 'get_reparse_count'
                    ? Promise.resolve(2)
                    : Promise.resolve({ processed: 2, updated: 0, errors: 0, wasCancelled: false })
            );
            useLibraryStore.setState(busyState);
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(3000));
            expect(invoke).not.toHaveBeenCalledWith('start_reparse_job', expect.anything());
        }
    );

    it.each(['database table is locked', 'database schema is locked', 'database busy', 'SQLITE_BUSY'])(
        'retries transient startup count failures: %s',
        async (error) => {
            vi.mocked(invoke).mockRejectedValueOnce(error).mockResolvedValueOnce(0);
            renderHook(() => useMetadataRefresh(true));
            await act(async () => vi.advanceTimersByTimeAsync(3000));
            expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(true);
            await act(async () => vi.advanceTimersByTimeAsync(15000));
            expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_reparse_count')).toHaveLength(2);
        }
    );

    it('reports non-transient startup count failures', async () => {
        const error = new Error('count unavailable');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(invoke).mockRejectedValueOnce(error);
        renderHook(() => useMetadataRefresh(true));
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(useLibraryStore.getState().isMetadataRefreshPending).toBe(false);
        expect(consoleError).toHaveBeenCalledWith('[Refresh] Startup check failed:', error);
        consoleError.mockRestore();
    });

    it('reports non-transient startup start failures once', async () => {
        vi.mocked(invoke).mockImplementation((command) =>
            command === 'get_reparse_count' ? Promise.resolve(2) : Promise.reject('permission denied')
        );
        renderHook(() => useMetadataRefresh(true));
        await act(async () => vi.runAllTimersAsync());
        expect(mockAddToast).toHaveBeenCalledWith('Failed to start refresh: permission denied', 'error');
    });

    it('ignores a startup count result that resolves after unmount', async () => {
        let resolveCount!: (count: number) => void;
        vi.mocked(invoke).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveCount = resolve;
            })
        );
        const view = renderHook(() => useMetadataRefresh(true));
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        view.unmount();
        await act(async () => {
            resolveCount(5);
            await Promise.resolve();
        });
        expect(invoke).not.toHaveBeenCalledWith('start_reparse_job', expect.anything());
    });
});
