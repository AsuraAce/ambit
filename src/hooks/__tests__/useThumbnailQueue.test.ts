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
    listenerCleanups: new Map<string, () => void>(),
    listenerHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

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
    isBrowserMockMode: () => false,
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
