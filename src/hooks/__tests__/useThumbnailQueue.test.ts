import { act, renderHook } from '../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSettingsStore } from '../../stores/settingsStore';

const mocks = vi.hoisted(() => ({
    startThumbnailOptimizationJob: vi.fn(),
    cancelThumbnailOptimizationJob: vi.fn(),
    setThumbnailOptimizationThrottled: vi.fn(),
    getThumbnailDir: vi.fn(),
    rebuildThumbnailFacetCache: vi.fn(),
    browserMockMode: false,
    activeImageQueryCount: 0,
    listenerCleanups: new Map<string, () => void>(),
    listenerHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();
    return {
        ...actual,
        useIsFetching: () => mocks.activeImageQueryCount,
    };
});

vi.mock('../../bindings', () => ({
    commands: {
        startThumbnailOptimizationJob: mocks.startThumbnailOptimizationJob,
        cancelThumbnailOptimizationJob: mocks.cancelThumbnailOptimizationJob,
        setThumbnailOptimizationThrottled: mocks.setThumbnailOptimizationThrottled,
        cancelModelDiscovery: vi.fn().mockResolvedValue(undefined),
        cancelImageFileHashBackfill: vi.fn().mockResolvedValue(undefined),
        saveApiKey: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
        deleteApiKey: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
        loadApiKey: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    },
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => mocks.browserMockMode,
    isTauriRuntime: () => false,
}));

vi.mock('../../services/thumbnailService', () => ({
    getThumbnailDir: mocks.getThumbnailDir,
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildThumbnailFacetCache: mocks.rebuildThumbnailFacetCache,
}));

vi.mock('../../utils/backgroundDiagnostics', () => ({
    startBackgroundDiagnostic: vi.fn(() => ({
        update: vi.fn(),
        finish: vi.fn(),
    })),
}));

vi.mock('../../utils/tauriListener', () => ({
    listenWithCleanup: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
        const cleanup = vi.fn();
        mocks.listenerCleanups.set(eventName, cleanup);
        mocks.listenerHandlers.set(eventName, handler);
        return { cleanup };
    }),
}));

/**
 * useThumbnailQueue Integration Behavior Tests
 * 
 * NOTE: This hook uses Zustand stores with selector-based subscriptions,
 * which makes isolated unit testing complex. The behavior is verified through:
 * 
 * 1. Build validation (TypeScript compiles successfully)
 * 2. Integration testing (manual app testing)
 * 3. These simplified behavioral contracts
 * 
 * The hook:
 * - Defers startup by 30 seconds to avoid blocking app initialization
 * - Starts the backend-owned thumbnail optimization job
 * - Listens for backend progress and completion events
 * - Pauses when high-priority import, scan, discovery, indexing, or metadata work is active
 * - Throttles instead of cancelling during ordinary image queries
 * - Resumes automatically when blocking activities complete
 * - Respects `enableAutoThumbnailHealing` settings flag
 * - Updates libraryStore progress state for ActivityDock visibility
 */

describe('useThumbnailQueue behavioral contract', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listenerCleanups.clear();
        mocks.listenerHandlers.clear();
        mocks.browserMockMode = false;
        mocks.activeImageQueryCount = 0;
        mocks.getThumbnailDir.mockResolvedValue('C:/AppData/Ambit/.thumbnails');
        mocks.rebuildThumbnailFacetCache.mockResolvedValue(undefined);
        mocks.setThumbnailOptimizationThrottled.mockResolvedValue(undefined);
        mocks.cancelThumbnailOptimizationJob.mockResolvedValue(undefined);
        mocks.startThumbnailOptimizationJob.mockResolvedValue({
            status: 'ok',
            data: {
                checked: 2,
                optimized: 1,
                reused: 0,
                failed: 0,
                skipped: 0,
                durationMs: 1000,
                wasCancelled: false,
            },
        });

        useLibraryStore.setState({
            isImporting: false,
            isRegeneratingThumbnails: false,
            syncStatus: 'idle',
            isResolvingModels: false,
            isScanningDiscovery: false,
            isScanningDuplicates: false,
            isScanningMissingFiles: false,
            isPopulatingThumbnails: false,
            isStartupCatchupPending: false,
            isMetadataRefreshPending: false,
            isRefreshingMetadata: false,
            thumbnailMaintenanceOperation: null,
            isBackgroundHealingActive: false,
            backgroundHealingProgress: null,
            backgroundHealingDetails: null,
            backgroundHealingPaused: false,
            lastBackgroundHealingRun: null,
            thumbnailOptimizationRetrySignal: 0,
            facetCacheVersion: 0,
        });
        useSettingsStore.setState({
            isLoaded: true,
            settings: createDefaultAppSettings({
                enableAutoThumbnailHealing: true,
                enforceHighQualityThumbnails: false,
                thumbnailOptimizationProfile: 'balanced',
            }),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const advanceStartup = async () => {
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        await act(async () => vi.advanceTimersByTimeAsync(50));
    };

    const deferred = <T,>() => {
        let resolve!: (value: T) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };

    it('starts the backend optimizer after startup delay and clears visible completion progress', async () => {
        vi.useFakeTimers();
        const { useThumbnailQueue } = await import('../useThumbnailQueue');

        renderHook(() => useThumbnailQueue());

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50);
        });

        expect(mocks.startThumbnailOptimizationJob).toHaveBeenCalledWith({
            thumbnailDir: 'C:/AppData/Ambit/.thumbnails',
            includeUpgradeable: false,
            profile: 'balanced',
        });
        expect(mocks.setThumbnailOptimizationThrottled).toHaveBeenCalledWith(false);
        expect(useLibraryStore.getState().lastBackgroundHealingRun).toEqual(expect.objectContaining({
            checked: 2,
            optimized: 1,
            profile: 'balanced',
        }));
        expect(useLibraryStore.getState().backgroundHealingProgress).toEqual(expect.objectContaining({
            current: 2,
            total: 2,
        }));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });

        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('surfaces backend progress events in the ActivityDock state', async () => {
        vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');

        renderHook(() => useThumbnailQueue());
        const progressHandler = mocks.listenerHandlers.get('thumbnail-optimization-progress');
        expect(progressHandler).toBeDefined();

        act(() => {
            progressHandler?.({
                payload: {
                    checked: 3,
                    total: 10,
                    optimized: 2,
                    reused: 1,
                    failed: 0,
                    skipped: 0,
                    imagesPerSecond: 4,
                    batchMs: 12,
                    dbMs: 3,
                    encodeMs: 7,
                    profile: 'balanced',
                    phase: 'running',
                    message: 'Working',
                    isThrottled: false,
                },
            });
        });

        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(true);
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toEqual({
            current: 3,
            total: 10,
            message: 'Optimized 2 thumbnails after checking 3 images',
        });
        expect(useLibraryStore.getState().backgroundHealingDetails).toEqual(expect.objectContaining({
            checked: 3,
            optimized: 2,
            reused: 1,
            profile: 'balanced',
            phase: 'running',
            isThrottled: false,
        }));
        expect(console.debug).toHaveBeenCalledWith('[ThumbnailQueue] Backend progress', expect.objectContaining({
            checked: 3,
            optimized: 2,
        }));
    });

    it('ignores invisible backend progress instead of showing empty thumbnail work', async () => {
        const { useThumbnailQueue } = await import('../useThumbnailQueue');

        renderHook(() => useThumbnailQueue());
        const progressHandler = mocks.listenerHandlers.get('thumbnail-optimization-progress');

        act(() => {
            progressHandler?.({
                payload: {
                    checked: 0,
                    total: 0,
                    optimized: 0,
                    reused: 0,
                    failed: 0,
                    skipped: 0,
                    imagesPerSecond: 0,
                    batchMs: 0,
                    dbMs: 0,
                    encodeMs: 0,
                    profile: 'balanced',
                    phase: 'idle',
                    message: '',
                    isThrottled: false,
                },
            });
        });

        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
        expect(useLibraryStore.getState().backgroundHealingDetails).toBeNull();
    });

    it('clears dock state for invisible completion events', async () => {
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingPaused: true,
            backgroundHealingProgress: { current: 1, total: 1, message: 'Existing' },
            backgroundHealingDetails: {
                checked: 1,
                optimized: 0,
                reused: 0,
                failed: 0,
                skipped: 0,
                imagesPerSecond: 0,
                batchMs: 0,
                dbMs: 0,
                encodeMs: 0,
                profile: 'balanced',
                phase: 'running',
                isThrottled: false,
            },
        });

        renderHook(() => useThumbnailQueue());
        const completeHandler = mocks.listenerHandlers.get('thumbnail-optimization-complete');

        await act(async () => {
            completeHandler?.({
                payload: {
                    checked: 0,
                    optimized: 0,
                    reused: 0,
                    failed: 0,
                    skipped: 0,
                    durationMs: 0,
                    wasCancelled: false,
                },
            });
        });

        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
        expect(useLibraryStore.getState().backgroundHealingDetails).toBeNull();
        expect(useLibraryStore.getState().lastBackgroundHealingRun).toEqual(expect.objectContaining({
            checked: 0,
            imagesPerSecond: 0,
            profile: 'balanced',
        }));
    });

    it('clears visible state when the backend reports a non-paused cancellation', async () => {
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingPaused: false,
            backgroundHealingProgress: { current: 1, total: 2, message: 'Cancelling' },
            backgroundHealingDetails: {
                checked: 1,
                optimized: 0,
                reused: 0,
                failed: 0,
                skipped: 0,
                imagesPerSecond: 0,
                batchMs: 0,
                dbMs: 0,
                encodeMs: 0,
                profile: 'balanced',
                phase: 'running',
                isThrottled: false,
            },
        });

        renderHook(() => useThumbnailQueue());
        const completeHandler = mocks.listenerHandlers.get('thumbnail-optimization-complete');

        await act(async () => {
            completeHandler?.({
                payload: {
                    checked: 1,
                    optimized: 0,
                    reused: 0,
                    failed: 0,
                    skipped: 0,
                    durationMs: 100,
                    wasCancelled: true,
                },
            });
        });

        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
        expect(useLibraryStore.getState().backgroundHealingDetails).toBeNull();
    });

    it('does not claim thumbnail work when the thumbnail directory is unavailable', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.getThumbnailDir.mockResolvedValue(null);
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingProgress: { current: 1, total: 1, message: 'Previous work' },
            backgroundHealingDetails: {
                checked: 1,
                optimized: 0,
                reused: 0,
                failed: 0,
                skipped: 0,
                imagesPerSecond: 0,
                batchMs: 0,
                dbMs: 0,
                encodeMs: 0,
                profile: 'balanced',
                phase: 'running',
                isThrottled: false,
            },
        });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');

        renderHook(() => useThumbnailQueue());

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50);
        });

        expect(mocks.startThumbnailOptimizationJob).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith('[ThumbnailQueue] No thumbnail directory');
        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
        expect(useLibraryStore.getState().backgroundHealingDetails).toBeNull();
    });

    it('reports backend startup failures and clears ActivityDock thumbnail state', async () => {
        vi.useFakeTimers();
        const addToast = vi.fn();
        mocks.startThumbnailOptimizationJob.mockResolvedValue({
            status: 'error',
            error: 'optimizer failed',
        });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');

        renderHook(() => useThumbnailQueue(addToast));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(30000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(50);
        });

        expect(addToast).toHaveBeenCalledWith(
            'Smart thumbnail optimization failed: optimizer failed',
            'error'
        );
        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
        expect(useLibraryStore.getState().backgroundHealingDetails).toBeNull();
    });

    it('does nothing in browser mock mode and cleans up store state on unmount', async () => {
        mocks.browserMockMode = true;
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingProgress: { current: 1, total: 2, message: 'Working' },
        });

        const hook = renderHook(() => useThumbnailQueue());
        hook.unmount();

        expect(mocks.listenerHandlers.size).toBe(0);
        expect(mocks.startThumbnailOptimizationJob).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
    });

    it('uses requestIdleCallback when available and cancels its handle on unmount', async () => {
        vi.useFakeTimers();
        const idleCallbacks = new Map<number, IdleRequestCallback>();
        let nextId = 1;
        const requestIdle = vi.fn((callback: IdleRequestCallback) => {
            const id = nextId++;
            idleCallbacks.set(id, callback);
            return id;
        });
        const cancelIdle = vi.fn((id: number) => idleCallbacks.delete(id));
        vi.stubGlobal('requestIdleCallback', requestIdle);
        vi.stubGlobal('cancelIdleCallback', cancelIdle);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const hook = renderHook(() => useThumbnailQueue());

        await act(async () => vi.advanceTimersByTimeAsync(30000));
        expect(requestIdle).toHaveBeenCalledTimes(1);
        hook.unmount();
        expect(cancelIdle).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('cancels and clears the dock when automatic healing is disabled', async () => {
        vi.useFakeTimers();
        mocks.cancelThumbnailOptimizationJob.mockRejectedValueOnce(new Error('cancel failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        useSettingsStore.setState(state => ({
            settings: { ...state.settings, enableAutoThumbnailHealing: false },
        }));
        useLibraryStore.setState({
            isBackgroundHealingActive: true,
            backgroundHealingPaused: true,
            backgroundHealingProgress: { current: 1, total: 2, message: 'Working' },
        });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());

        await advanceStartup();

        expect(mocks.cancelThumbnailOptimizationJob).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith('[ThumbnailQueue] Failed to cancel backend job', expect.any(Error));
        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(false);
        errorSpy.mockRestore();
    });

    it('rechecks blocking work before and after asynchronous thumbnail setup', async () => {
        vi.useFakeTimers();
        const firstDir = deferred<string | null>();
        mocks.getThumbnailDir.mockReturnValueOnce(firstDir.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const first = renderHook(() => useThumbnailQueue());
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        await act(async () => vi.advanceTimersByTimeAsync(50));
        act(() => useLibraryStore.setState({ isImporting: true }));
        await act(async () => firstDir.resolve('C:/thumbs'));
        expect(mocks.startThumbnailOptimizationJob).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(true);
        first.unmount();

        useLibraryStore.setState({ isImporting: false, backgroundHealingPaused: false });
        mocks.getThumbnailDir.mockClear();
        const second = renderHook(() => useThumbnailQueue());
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        act(() => useLibraryStore.setState({ isImporting: true }));
        await act(async () => vi.advanceTimersByTimeAsync(50));
        expect(mocks.getThumbnailDir).not.toHaveBeenCalled();
        second.unmount();
    });

    it('throttles a running job, updates dock details, and logs throttle failures once', async () => {
        vi.useFakeTimers();
        const job = deferred<{ status: 'ok'; data: { checked: number; optimized: number; reused: number; failed: number; skipped: number; durationMs: number; wasCancelled: boolean } }>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        mocks.activeImageQueryCount = 1;
        mocks.setThumbnailOptimizationThrottled.mockRejectedValueOnce(new Error('throttle failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        useLibraryStore.setState({
            backgroundHealingDetails: {
                checked: 1, optimized: 0, reused: 0, failed: 0, skipped: 0,
                imagesPerSecond: 1, batchMs: 1, dbMs: 1, encodeMs: 1,
                profile: 'balanced', phase: 'running', isThrottled: false,
            },
        });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const hook = renderHook(() => useThumbnailQueue());
        await advanceStartup();

        expect(mocks.setThumbnailOptimizationThrottled).toHaveBeenCalledWith(true);
        expect(useLibraryStore.getState().backgroundHealingDetails).toEqual(expect.objectContaining({ phase: 'throttled', isThrottled: true }));
        await act(async () => Promise.resolve());
        expect(errorSpy).toHaveBeenCalledWith('[ThumbnailQueue] Failed to update backend throttle state', expect.any(Error));
        hook.rerender();
        expect(mocks.setThumbnailOptimizationThrottled).toHaveBeenCalledTimes(1);
        hook.unmount();
        errorSpy.mockRestore();
    });

    it('restarts a running job once when thumbnail settings change', async () => {
        vi.useFakeTimers();
        const job = deferred<never>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const hook = renderHook(() => useThumbnailQueue());
        await advanceStartup();

        act(() => useSettingsStore.setState(state => ({
            settings: { ...state.settings, enforceHighQualityThumbnails: true, thumbnailOptimizationProfile: 'quiet' },
        })));
        await act(async () => Promise.resolve());
        expect(mocks.cancelThumbnailOptimizationJob).toHaveBeenCalledTimes(1);

        act(() => useSettingsStore.setState(state => ({
            settings: { ...state.settings, thumbnailOptimizationProfile: 'fast' },
        })));
        await act(async () => Promise.resolve());
        expect(mocks.cancelThumbnailOptimizationJob).toHaveBeenCalledTimes(1);
        hook.unmount();
    });

    it('pauses a running job for blocking activity and resumes after the blocker clears', async () => {
        vi.useFakeTimers();
        const job = deferred<never>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const hook = renderHook(() => useThumbnailQueue());
        await advanceStartup();

        act(() => useLibraryStore.setState({ isScanningDuplicates: true }));
        await act(async () => Promise.resolve());
        expect(mocks.cancelThumbnailOptimizationJob).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(true);

        act(() => useLibraryStore.setState({ isScanningDuplicates: false }));
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        await act(async () => vi.advanceTimersByTimeAsync(50));
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(false);
        hook.unmount();
    });

    it('ignores progress after cancellation is requested', async () => {
        vi.useFakeTimers();
        const job = deferred<never>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();
        act(() => useLibraryStore.setState({ isImporting: true }));
        await act(async () => Promise.resolve());

        const progressHandler = mocks.listenerHandlers.get('thumbnail-optimization-progress');
        act(() => progressHandler?.({ payload: {
            checked: 1, total: 1, optimized: 1, reused: 0, failed: 0, skipped: 0,
            imagesPerSecond: 1, batchMs: 1, dbMs: 1, encodeMs: 1,
            profile: 'balanced', phase: 'running', message: 'Ignored', isThrottled: false,
        } }));
        expect(useLibraryStore.getState().backgroundHealingProgress).toBeNull();
    });

    it('refreshes consumers defensively when cache rebuilding fails', async () => {
        vi.useFakeTimers();
        mocks.rebuildThumbnailFacetCache.mockRejectedValueOnce(new Error('cache failed'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();
        await act(async () => Promise.resolve());
        expect(warnSpy).toHaveBeenCalledWith('[ThumbnailQueue] Thumbnail facet cache refresh failed', expect.any(Error));
        warnSpy.mockRestore();
    });

    it('shows visible zero-total progress without emitting debug output for zero checked', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        const progressHandler = mocks.listenerHandlers.get('thumbnail-optimization-progress');

        act(() => progressHandler?.({ payload: {
            checked: 0, total: 0, optimized: 1, reused: 0, failed: 0, skipped: 0,
            imagesPerSecond: 1, batchMs: 1, dbMs: 1, encodeMs: 1,
            profile: 'balanced', phase: 'running', message: 'Working', isThrottled: false,
        } }));

        expect(useLibraryStore.getState().backgroundHealingProgress).toEqual(expect.objectContaining({ current: 0, total: 0 }));
        expect(debugSpy).not.toHaveBeenCalled();
        debugSpy.mockRestore();
    });

    it('ignores duplicate completion events and avoids consumer refresh without optimizations', async () => {
        vi.useFakeTimers();
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        const completeHandler = mocks.listenerHandlers.get('thumbnail-optimization-complete');
        const payload = {
            checked: 1, optimized: 0, reused: 1, failed: 0, skipped: 0,
            durationMs: 100, wasCancelled: false,
        };

        act(() => {
            completeHandler?.({ payload });
            completeHandler?.({ payload });
        });
        await act(async () => vi.advanceTimersByTimeAsync(1500));

        expect(mocks.rebuildThumbnailFacetCache).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().lastBackgroundHealingRun).toEqual(expect.objectContaining({ checked: 1, optimized: 0 }));
    });

    it('reschedules after a paused cancellation when activity is clear', async () => {
        vi.useFakeTimers();
        useLibraryStore.setState({ backgroundHealingPaused: true });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        const completeHandler = mocks.listenerHandlers.get('thumbnail-optimization-complete');

        await act(async () => completeHandler?.({ payload: {
            checked: 1, optimized: 0, reused: 0, failed: 0, skipped: 0,
            durationMs: 100, wasCancelled: true,
        } }));
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        await act(async () => vi.advanceTimersByTimeAsync(50));

        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(false);
        expect(mocks.getThumbnailDir).toHaveBeenCalled();
    });

    it('queues one post-run retry when an explicit retry arrives during a run', async () => {
        vi.useFakeTimers();
        const job = deferred<{ status: 'ok'; data: { checked: number; optimized: number; reused: number; failed: number; skipped: number; durationMs: number; wasCancelled: boolean } }>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();

        act(() => useLibraryStore.getState().requestThumbnailOptimizationRun());
        await act(async () => Promise.resolve());
        job.resolve({ status: 'ok', data: {
            checked: 0, optimized: 0, reused: 0, failed: 0, skipped: 0,
            durationMs: 0, wasCancelled: false,
        } });
        await act(async () => Promise.resolve());
        await act(async () => vi.advanceTimersByTimeAsync(50));

        expect(mocks.startThumbnailOptimizationJob).toHaveBeenCalledTimes(2);
    });

    it('pauses an idle retry behind activity and schedules it once activity clears', async () => {
        vi.useFakeTimers();
        useLibraryStore.setState({ isImporting: true });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        act(() => useLibraryStore.getState().requestThumbnailOptimizationRun());
        await act(async () => Promise.resolve());
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(true);

        act(() => useLibraryStore.setState({ isImporting: false }));
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        await act(async () => vi.advanceTimersByTimeAsync(50));
        expect(mocks.startThumbnailOptimizationJob).toHaveBeenCalledTimes(1);
    });

    it('treats a rejected job as cancellation when cancellation was requested', async () => {
        vi.useFakeTimers();
        const job = deferred<never>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();
        act(() => useLibraryStore.setState({ isImporting: true }));
        await act(async () => Promise.resolve());
        job.reject('cancelled');
        await act(async () => Promise.resolve());

        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(true);
    });

    it('updates backend throttling when image query activity changes', async () => {
        vi.useFakeTimers();
        const job = deferred<never>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        mocks.activeImageQueryCount = 1;
        useLibraryStore.setState({
            backgroundHealingDetails: {
                checked: 1, optimized: 0, reused: 0, failed: 0, skipped: 0,
                imagesPerSecond: 1, batchMs: 1, dbMs: 1, encodeMs: 1,
                profile: 'balanced', phase: 'running', isThrottled: false,
            },
        });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const hook = renderHook(() => useThumbnailQueue());
        await advanceStartup();
        expect(mocks.setThumbnailOptimizationThrottled).toHaveBeenCalledWith(true);

        mocks.activeImageQueryCount = 0;
        hook.rerender();
        await act(async () => Promise.resolve());
        expect(mocks.setThumbnailOptimizationThrottled).toHaveBeenCalledWith(false);
        hook.unmount();
    });

    it('resumes a paused cancellation when the blocker clears in the same turn', async () => {
        vi.useFakeTimers();
        useLibraryStore.setState({ isImporting: true, backgroundHealingPaused: true });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        const completeHandler = mocks.listenerHandlers.get('thumbnail-optimization-complete');

        act(() => {
            useLibraryStore.setState({ isImporting: false });
            completeHandler?.({ payload: {
                checked: 1, optimized: 0, reused: 0, failed: 0, skipped: 0,
                durationMs: 100, wasCancelled: true,
            } });
        });
        await act(async () => vi.advanceTimersByTimeAsync(5000));
        await act(async () => vi.advanceTimersByTimeAsync(50));
        expect(mocks.getThumbnailDir).toHaveBeenCalled();
    });

    it('retries after visible completion and leaves completion visible while paused', async () => {
        vi.useFakeTimers();
        const job = deferred<{ status: 'ok'; data: { checked: number; optimized: number; reused: number; failed: number; skipped: number; durationMs: number; wasCancelled: boolean } }>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();
        act(() => useLibraryStore.getState().requestThumbnailOptimizationRun());
        job.resolve({ status: 'ok', data: {
            checked: 1, optimized: 0, reused: 1, failed: 0, skipped: 0,
            durationMs: 100, wasCancelled: false,
        } });
        await act(async () => Promise.resolve());
        act(() => useLibraryStore.setState({ backgroundHealingPaused: true }));
        await act(async () => vi.advanceTimersByTimeAsync(1500));
        expect(useLibraryStore.getState().backgroundHealingProgress).not.toBeNull();

        act(() => useLibraryStore.setState({ backgroundHealingPaused: false }));
        const completeHandler = mocks.listenerHandlers.get('thumbnail-optimization-complete');
        act(() => completeHandler?.({ payload: {
            checked: 1, optimized: 0, reused: 1, failed: 0, skipped: 0,
            durationMs: 100, wasCancelled: false,
        } }));
    });

    it('cancels an idle callback that fires after unmount', async () => {
        vi.useFakeTimers();
        let idleCallback: IdleRequestCallback | undefined;
        vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
            idleCallback = callback;
            return 1;
        }));
        vi.stubGlobal('cancelIdleCallback', vi.fn());
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const hook = renderHook(() => useThumbnailQueue());
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        hook.unmount();
        idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
        expect(mocks.startThumbnailOptimizationJob).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('does not retry before settings load and recognizes maintenance as a hard blocker', async () => {
        vi.useFakeTimers();
        useSettingsStore.setState({ isLoaded: false });
        useLibraryStore.setState({ thumbnailMaintenanceOperation: 'repair' });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        act(() => useLibraryStore.getState().requestThumbnailOptimizationRun());
        await act(async () => vi.advanceTimersByTimeAsync(35000));
        expect(mocks.startThumbnailOptimizationJob).not.toHaveBeenCalled();
    });

    it('uses the balanced profile fallback when the persisted profile is absent', async () => {
        vi.useFakeTimers();
        useSettingsStore.setState(state => ({
            settings: { ...state.settings, thumbnailOptimizationProfile: undefined },
        }));
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();
        expect(mocks.startThumbnailOptimizationJob).toHaveBeenCalledWith(expect.objectContaining({ profile: 'balanced' }));
    });

    it('records Error objects from cancelled and failed backend jobs', async () => {
        vi.useFakeTimers();
        const cancelledJob = deferred<never>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(cancelledJob.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const first = renderHook(() => useThumbnailQueue());
        await advanceStartup();
        act(() => useLibraryStore.setState({ isImporting: true }));
        await act(async () => Promise.resolve());
        cancelledJob.reject(new Error('cancelled'));
        await act(async () => Promise.resolve());
        first.unmount();

        useLibraryStore.setState({ isImporting: false, backgroundHealingPaused: false });
        mocks.startThumbnailOptimizationJob.mockRejectedValueOnce(new Error('failed'));
        const second = renderHook(() => useThumbnailQueue());
        await advanceStartup();
        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
        second.unmount();
    });

    it('finishes diagnostics as cancelled when a started job returns cancellation', async () => {
        vi.useFakeTimers();
        mocks.startThumbnailOptimizationJob.mockResolvedValueOnce({
            status: 'ok',
            data: { checked: 1, optimized: 0, reused: 0, failed: 0, skipped: 0, durationMs: 100, wasCancelled: true },
        });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();
        expect(useLibraryStore.getState().isBackgroundHealingActive).toBe(false);
    });

    it('starts a post-run retry after visible completion', async () => {
        vi.useFakeTimers();
        const job = deferred<{ status: 'ok'; data: { checked: number; optimized: number; reused: number; failed: number; skipped: number; durationMs: number; wasCancelled: boolean } }>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();
        act(() => useLibraryStore.getState().requestThumbnailOptimizationRun());
        job.resolve({ status: 'ok', data: {
            checked: 1, optimized: 0, reused: 1, failed: 0, skipped: 0,
            durationMs: 100, wasCancelled: false,
        } });
        await act(async () => Promise.resolve());
        await act(async () => vi.advanceTimersByTimeAsync(1500));
        await act(async () => vi.advanceTimersByTimeAsync(50));
        expect(mocks.startThumbnailOptimizationJob).toHaveBeenCalledTimes(2);
    });

    it('keeps a paused cancellation paused when automatic healing is disabled', async () => {
        useSettingsStore.setState(state => ({ settings: { ...state.settings, enableAutoThumbnailHealing: false } }));
        useLibraryStore.setState({ backgroundHealingPaused: true });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        const completeHandler = mocks.listenerHandlers.get('thumbnail-optimization-complete');
        await act(async () => completeHandler?.({ payload: {
            checked: 1, optimized: 0, reused: 0, failed: 0, skipped: 0,
            durationMs: 100, wasCancelled: true,
        } }));
        expect(useLibraryStore.getState().backgroundHealingPaused).toBe(true);
    });

    it('cancels a delayed resume before its scheduling callback fires', async () => {
        vi.useFakeTimers();
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        useLibraryStore.setState({ backgroundHealingPaused: true });
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        const hook = renderHook(() => useThumbnailQueue());
        const resumeTimer = timeoutSpy.mock.calls.find(([, delay]) => delay === 5000)?.[0] as (() => void) | undefined;
        expect(resumeTimer).toBeDefined();
        hook.unmount();
        resumeTimer?.();
        expect(mocks.startThumbnailOptimizationJob).not.toHaveBeenCalled();
    });

    it('rejects a stale idle dispatch after automatic healing is disabled', async () => {
        vi.useFakeTimers();
        let idleCallback: IdleRequestCallback | undefined;
        vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
            idleCallback = callback;
            return 1;
        }));
        vi.stubGlobal('cancelIdleCallback', vi.fn());
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, enableAutoThumbnailHealing: false } })));
        idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
        await act(async () => Promise.resolve());
        expect(mocks.startThumbnailOptimizationJob).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it('does not restart for an unchanged config during a pending disable cancellation', async () => {
        vi.useFakeTimers();
        const job = deferred<never>();
        const cancel = deferred<void>();
        mocks.startThumbnailOptimizationJob.mockReturnValueOnce(job.promise);
        mocks.cancelThumbnailOptimizationJob.mockReturnValueOnce(cancel.promise);
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        renderHook(() => useThumbnailQueue());
        await advanceStartup();

        act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, enableAutoThumbnailHealing: false } })));
        act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, enableAutoThumbnailHealing: true } })));
        await act(async () => Promise.resolve());
        expect(mocks.cancelThumbnailOptimizationJob).toHaveBeenCalledTimes(1);
        cancel.resolve();
    });

    it('should export a void function hook', async () => {
        // Verify the hook can be imported and has correct signature
        const { useThumbnailQueue } = await import('../useThumbnailQueue');
        expect(typeof useThumbnailQueue).toBe('function');
    });

    it('should have correct startup delay constant', async () => {
        // The hook source should use a 30 second delay for deferred startup
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('STARTUP_DELAY_MS');
        expect(content).toContain('30000');
        expect(content).not.toContain('STARTUP_DELAY_MS = 5000');
    });

    it('should start the backend job instead of using the generic scanner loop', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('startThumbnailOptimizationJob');
        expect(content).toContain('thumbnail-optimization-progress');
        expect(content).toContain('thumbnail-optimization-complete');
        expect(content).toContain('thumbnailOptimizationProfile');
        expect(content).not.toContain('scanImagesBulk');
        expect(content).not.toContain('updateThumbnailPathsBatch');
        expect(content).not.toContain('BATCH_SIZE');
        expect(content).not.toContain('BATCH_DELAY_MS');
        expect(content).not.toContain('getUnoptimizedImageEntries');
        expect(content).not.toContain('getUnoptimizedImagesCount');
    });

    it('should check settings for enableAutoThumbnailHealing', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('enableAutoThumbnailHealing');
        expect(content).toContain('useSettingsStore');
    });

    it('should update libraryStore with progress', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('setBackgroundHealingActive');
        expect(content).toContain('setBackgroundHealingProgress');
        expect(content).toContain('setBackgroundHealingPaused');
        expect(content).toContain('setBackgroundHealingDetails');
    });

    it('should respond to explicit thumbnail optimization retry requests', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('thumbnailOptimizationRetrySignal');
        expect(content).toContain('retryAfterCurrentRunRef');
        expect(content).toContain('postRunRetrySignal');
        expect(content).toContain("scheduleIdleCallback('retry'");
        expect(content).toContain('void runQueue();');
    });

    it('should cancel pending idle starts on disable and unmount', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('scheduledIdleCancelRef');
        expect(content).toContain('cancelScheduledIdleCallback();');
        expect(content).toContain("scheduleIdleCallback('auto-start'");
        expect(content).toContain("scheduleIdleCallback('resume'");
        expect(content).toContain('mountedRef.current = false');
    });

    it('should pause only for high-priority blocking work', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('isImporting');
        expect(content).toContain('isRegeneratingThumbnails');
        expect(content).toContain('syncStatus');
        expect(content).toContain('isResolvingModels');
        expect(content).toContain('isScanningDiscovery');
        expect(content).toContain('isScanningDuplicates');
        expect(content).toContain('isScanningMissingFiles');
        expect(content).toContain('isPopulatingThumbnails');
        expect(content).toContain('isStartupCatchupPending');
        expect(content).toContain('isMetadataRefreshPending');
        expect(content).toContain('isRefreshingMetadata');
        expect(content).toContain('thumbnailMaintenanceOperation');
        expect(content).toContain('isHardBlocked');
        expect(content).toContain('setThumbnailOptimizationThrottled');
        expect(content).toContain('isImageQueryFetching');
        expect(content).not.toContain("queryClient.isFetching({ queryKey: ['images'] }) > 0");
    });

    it('should keep startup-only blockers internal instead of showing thumbnail work early', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        const runQueueStart = content.indexOf('const runQueue = useCallback');
        const runQueueEnd = content.indexOf('const [isStartupDelayComplete', runQueueStart);
        const runQueueBlock = content.slice(runQueueStart, runQueueEnd);
        const queueClaim = runQueueBlock.indexOf('isRunningRef.current = true;');
        const backendStart = runQueueBlock.indexOf('commands.startThumbnailOptimizationJob');
        const beforeBackendStarts = runQueueBlock.slice(queueClaim, backendStart);

        expect(content).toContain('hasVisibleThumbnailProgress');
        expect(content).toContain('hasVisibleThumbnailResult');
        expect(beforeBackendStarts).not.toContain('setBackgroundHealingActive(true)');
        expect(beforeBackendStarts).not.toContain('THUMBNAIL_QUEUE_START_MESSAGE');
    });

    it('should keep image query throttling out of startup scheduling', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        const runQueueStart = content.indexOf('const runQueue = useCallback');
        const runQueueEnd = content.indexOf('const [isStartupDelayComplete', runQueueStart);
        const runQueueBlock = content.slice(runQueueStart, runQueueEnd);
        const runQueueDependencies = runQueueBlock.slice(runQueueBlock.lastIndexOf('    }, ['));

        expect(content).toContain('isImageQueryFetchingRef');
        expect(runQueueBlock).toContain('isImageQueryFetchingRef.current');
        expect(runQueueDependencies).not.toContain('isImageQueryFetching');
        expect(content).toContain('setBackendThrottled(isImageQueryFetching)');
    });

    it('should recheck blocking activity after async setup before claiming the queue', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        const runQueueStart = content.indexOf('const runQueue = useCallback');
        const runQueueEnd = content.indexOf('const [isStartupDelayComplete', runQueueStart);
        const runQueueBlock = content.slice(runQueueStart, runQueueEnd);
        const directoryResolution = runQueueBlock.indexOf('const thumbnailDir = await getThumbnailDir();');
        const finalBlockerCheck = runQueueBlock.indexOf('if (shouldPauseForActivity())', directoryResolution);
        const queueClaim = runQueueBlock.indexOf('isRunningRef.current = true;', directoryResolution);

        expect(directoryResolution).toBeGreaterThan(-1);
        expect(finalBlockerCheck).toBeGreaterThan(directoryResolution);
        expect(finalBlockerCheck).toBeLessThan(queueClaim);
        expect(runQueueBlock.slice(finalBlockerCheck, queueClaim)).toContain('setBackgroundHealingPaused(true)');
        expect(runQueueBlock.slice(finalBlockerCheck, queueClaim)).toContain('return;');
    });

    it('should restart once for profile or quality setting changes', async () => {
        const fs = await import('fs/promises');
        const path = await import('path');
        const hookPath = path.join(__dirname, '..', 'useThumbnailQueue.ts');
        const content = await fs.readFile(hookPath, 'utf-8');

        expect(content).toContain('runningConfigRef');
        expect(content).toContain('restartRequestedRef');
        expect(content).toContain('Restarting backend job for Smart Thumbnail settings change');
        expect(content).toContain("queryKey: ['images']");
    });
});
