import { useEffect, useRef, useCallback, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import {
    commands,
    type ThumbnailOptimizationProfile,
    type ThumbnailOptimizationResult
} from '../bindings';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { isBrowserMockMode } from '../services/runtime';
import { unwrap } from '../utils/spectaUtils';
import {
    formatThumbnailQueueCompleteMessage,
    formatThumbnailQueueRunningMessage
} from './thumbnailQueueProgress';
import { rebuildThumbnailFacetCache } from '../services/db/imageRepo';
import { getThumbnailDir } from '../services/thumbnailService';
import { startBackgroundDiagnostic, type BackgroundDiagnosticHandle } from '../utils/backgroundDiagnostics';
import { listenWithCleanup } from '../utils/tauriListener';

const STARTUP_DELAY_MS = 30000;
const RESUME_DELAY_MS = 5000;
const COMPLETE_VISIBLE_MS = 1500;

interface ThumbnailOptimizationProgress {
    checked: number;
    total: number;
    optimized: number;
    reused: number;
    failed: number;
    skipped: number;
    imagesPerSecond: number;
    batchMs: number;
    dbMs: number;
    encodeMs: number;
    profile: ThumbnailOptimizationProfile;
    phase: string;
    message: string;
    isThrottled: boolean;
}

type ToastFn = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
type RunningThumbnailConfig = {
    includeUpgradeable: boolean;
    profile: ThumbnailOptimizationProfile;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const hasVisibleThumbnailProgress = (progress: ThumbnailOptimizationProgress): boolean => (
    progress.total > 0
    || progress.checked > 0
    || progress.optimized > 0
    || progress.reused > 0
    || progress.failed > 0
    || progress.skipped > 0
);
const hasVisibleThumbnailResult = (result: ThumbnailOptimizationResult): boolean => (
    result.checked > 0
    || result.optimized > 0
    || result.reused > 0
    || result.failed > 0
    || result.skipped > 0
);

/**
 * Starts and supervises the backend-owned Smart Thumbnail optimization job.
 *
 * Rust owns candidate selection, thumbnail generation, DB updates, progress metrics,
 * and cancellation. The hook only coordinates Settings, blocking activity, and the
 * ActivityDock presentation.
 */
export function useThumbnailQueue(addToast?: ToastFn): void {
    const queryClient = useQueryClient();
    const activeImageQueryCount = useIsFetching({ queryKey: ['images'] });
    const isRunningRef = useRef(false);
    const completionHandledRef = useRef(false);
    const cancelRequestedRef = useRef(false);
    const lastThrottleRef = useRef<boolean | null>(null);
    const runningConfigRef = useRef<RunningThumbnailConfig | null>(null);
    const restartRequestedRef = useRef(false);
    const retryAfterCurrentRunRef = useRef(false);
    const isImageQueryFetchingRef = useRef(false);
    const mountedRef = useRef(true);
    const scheduledIdleCancelRef = useRef<(() => void) | null>(null);
    const jobDiagnosticRef = useRef<BackgroundDiagnosticHandle | null>(null);
    const browserMockMode = isBrowserMockMode();
    const [resumeSignal, setResumeSignal] = useState(0);
    const [postRunRetrySignal, setPostRunRetrySignal] = useState(0);

    const isImporting = useLibraryStore(s => s.isImporting);
    const isRegeneratingThumbnails = useLibraryStore(s => s.isRegeneratingThumbnails);
    const syncStatus = useLibraryStore(s => s.syncStatus);
    const isResolvingModels = useLibraryStore(s => s.isResolvingModels);
    const isScanningDiscovery = useLibraryStore(s => s.isScanningDiscovery);
    const isScanningDuplicates = useLibraryStore(s => s.isScanningDuplicates);
    const isScanningMissingFiles = useLibraryStore(s => s.isScanningMissingFiles);
    const isPopulatingThumbnails = useLibraryStore(s => s.isPopulatingThumbnails);
    const isStartupCatchupPending = useLibraryStore(s => s.isStartupCatchupPending);
    const isMetadataRefreshPending = useLibraryStore(s => s.isMetadataRefreshPending);
    const isRefreshingMetadata = useLibraryStore(s => s.isRefreshingMetadata);
    const thumbnailMaintenanceOperation = useLibraryStore(s => s.thumbnailMaintenanceOperation);
    const thumbnailOptimizationRetrySignal = useLibraryStore(s => s.thumbnailOptimizationRetrySignal);

    const setBackgroundHealingActive = useLibraryStore(s => s.setBackgroundHealingActive);
    const setBackgroundHealingProgress = useLibraryStore(s => s.setBackgroundHealingProgress);
    const setBackgroundHealingPaused = useLibraryStore(s => s.setBackgroundHealingPaused);
    const setBackgroundHealingDetails = useLibraryStore(s => s.setBackgroundHealingDetails);
    const setLastBackgroundHealingRun = useLibraryStore(s => s.setLastBackgroundHealingRun);

    const enableAutoThumbnailHealing = useSettingsStore(s => s.settings.enableAutoThumbnailHealing);
    const enforceHighQualityThumbnails = useSettingsStore(s => s.settings.enforceHighQualityThumbnails);
    const thumbnailOptimizationProfile = useSettingsStore(s => s.settings.thumbnailOptimizationProfile ?? 'balanced');
    const isSettingsLoaded = useSettingsStore(s => s.isLoaded);

    const isImageQueryFetching = activeImageQueryCount > 0;
    const isHardBlocked = isImporting
        || isRegeneratingThumbnails
        || syncStatus === 'syncing'
        || isResolvingModels
        || isScanningDiscovery
        || isScanningDuplicates
        || isScanningMissingFiles
        || isPopulatingThumbnails
        || isStartupCatchupPending
        || isMetadataRefreshPending
        || isRefreshingMetadata
        || thumbnailMaintenanceOperation !== null;

    useEffect(() => {
        isImageQueryFetchingRef.current = isImageQueryFetching;
    }, [isImageQueryFetching]);

    const shouldPauseForActivity = useCallback(() => {
        const store = useLibraryStore.getState();
        return store.isImporting
            || store.isRegeneratingThumbnails
            || store.syncStatus === 'syncing'
            || store.isResolvingModels
            || store.isScanningDiscovery
            || store.isScanningDuplicates
            || store.isScanningMissingFiles
            || store.isPopulatingThumbnails
            || store.isStartupCatchupPending
            || store.isMetadataRefreshPending
            || store.isRefreshingMetadata
            || store.thumbnailMaintenanceOperation !== null;
    }, []);

    const cancelScheduledIdleCallback = useCallback(() => {
        scheduledIdleCancelRef.current?.();
        scheduledIdleCancelRef.current = null;
    }, []);

    const scheduleIdleCallback = useCallback((label: string, callback: () => void, delay: number = 0) => {
        cancelScheduledIdleCallback();

        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let idleId: number | null = null;
        let finished = false;
        const diagnostic = startBackgroundDiagnostic('timer', `Smart Thumbnail ${label}`, { delayMs: delay });

        const finish = (status: 'finished' | 'cancelled') => {
            if (finished) return;
            finished = true;
            diagnostic.finish(status);
        };

        const clearScheduledHandles = () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (idleId !== null) {
                window.cancelIdleCallback?.(idleId);
                idleId = null;
            }
        };

        const fire = () => {
            clearScheduledHandles();

            if (!mountedRef.current) {
                finish('cancelled');
                return;
            }

            if (scheduledIdleCancelRef.current === cancel) {
                scheduledIdleCancelRef.current = null;
            }
            finish('finished');
            callback();
        };

        const schedule = () => {
            if (!mountedRef.current) {
                finish('cancelled');
                return;
            }

            if (typeof window.requestIdleCallback === 'function') {
                idleId = window.requestIdleCallback(fire, { timeout: 2000 });
            } else {
                timeoutId = setTimeout(fire, 50);
            }
        };

        const cancel = () => {
            clearScheduledHandles();
            if (scheduledIdleCancelRef.current === cancel) {
                scheduledIdleCancelRef.current = null;
            }
            finish('cancelled');
        };

        scheduledIdleCancelRef.current = cancel;

        if (delay > 0) {
            timeoutId = setTimeout(schedule, delay);
        } else {
            schedule();
        }

        return cancel;
    }, [cancelScheduledIdleCallback]);

    const setBackendThrottled = useCallback((throttled: boolean) => {
        lastThrottleRef.current = throttled;
        void commands.setThumbnailOptimizationThrottled(throttled).catch(error => {
            console.error('[ThumbnailQueue] Failed to update backend throttle state', error);
        });

        const details = useLibraryStore.getState().backgroundHealingDetails;
        if (details) {
            setBackgroundHealingDetails({
                ...details,
                phase: throttled ? 'throttled' : 'running',
                isThrottled: throttled
            });
        }
    }, [setBackgroundHealingDetails]);

    const refreshThumbnailConsumers = useCallback(async (optimized: number) => {
        if (optimized <= 0) return;

        await queryClient.invalidateQueries({ queryKey: ['images'] });
        await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });

        try {
            await rebuildThumbnailFacetCache();
            useLibraryStore.getState().incrementFacetCacheVersion();
        } catch (error) {
            console.warn('[ThumbnailQueue] Thumbnail facet cache refresh failed', error);
        }
    }, [queryClient]);

    const handleCompletion = useCallback(async (result: ThumbnailOptimizationResult) => {
        if (completionHandledRef.current) return;
        completionHandledRef.current = true;
        jobDiagnosticRef.current?.finish(result.wasCancelled ? 'cancelled' : 'finished', {
            checked: result.checked,
            optimized: result.optimized,
            failed: result.failed,
            skipped: result.skipped,
            durationMs: result.durationMs
        });
        jobDiagnosticRef.current = null;
        const completedConfig = runningConfigRef.current;
        isRunningRef.current = false;
        runningConfigRef.current = null;
        lastThrottleRef.current = null;

        if (result.wasCancelled) {
            if (!useLibraryStore.getState().backgroundHealingPaused) {
                retryAfterCurrentRunRef.current = false;
                setBackgroundHealingActive(false);
                setBackgroundHealingProgress(null);
                setBackgroundHealingDetails(null);
            } else if (enableAutoThumbnailHealing && !shouldPauseForActivity()) {
                retryAfterCurrentRunRef.current = false;
                setResumeSignal(signal => signal + 1);
            }
            return;
        }

        const imagesPerSecond = result.durationMs > 0
            ? result.checked / (result.durationMs / 1000)
            : 0;
        const visibleResult = hasVisibleThumbnailResult(result);
        setLastBackgroundHealingRun({
            checked: result.checked,
            optimized: result.optimized,
            reused: result.reused,
            failed: result.failed,
            skipped: result.skipped,
            imagesPerSecond,
            durationMs: result.durationMs,
            completedAt: Date.now(),
            profile: completedConfig?.profile ?? thumbnailOptimizationProfile
        });

        if (!visibleResult) {
            setBackgroundHealingActive(false);
            setBackgroundHealingPaused(false);
            setBackgroundHealingProgress(null);
            setBackgroundHealingDetails(null);
            if (retryAfterCurrentRunRef.current && enableAutoThumbnailHealing) {
                retryAfterCurrentRunRef.current = false;
                setPostRunRetrySignal(signal => signal + 1);
            }
            return;
        }

        const completeCount = Math.max(result.checked, 1);
        setBackgroundHealingActive(true);
        setBackgroundHealingPaused(false);
        setBackgroundHealingProgress({
            current: completeCount,
            total: completeCount,
            message: formatThumbnailQueueCompleteMessage({
                checked: result.checked,
                optimized: result.optimized,
                failed: result.failed
            })
        });
        setBackgroundHealingDetails(null);

        void refreshThumbnailConsumers(result.optimized);

        await sleep(COMPLETE_VISIBLE_MS);

        if (!mountedRef.current || !completionHandledRef.current || isRunningRef.current || useLibraryStore.getState().backgroundHealingPaused) {
            return;
        }

        setBackgroundHealingActive(false);
        setBackgroundHealingProgress(null);

        if (retryAfterCurrentRunRef.current && enableAutoThumbnailHealing) {
            retryAfterCurrentRunRef.current = false;
            setPostRunRetrySignal(signal => signal + 1);
        }
    }, [
        enableAutoThumbnailHealing,
        refreshThumbnailConsumers,
        setBackgroundHealingActive,
        setBackgroundHealingDetails,
        setBackgroundHealingPaused,
        setBackgroundHealingProgress,
        setLastBackgroundHealingRun,
        shouldPauseForActivity,
        thumbnailOptimizationProfile
    ]);

    useEffect(() => {
        if (browserMockMode) return;

        const progressListener = listenWithCleanup<ThumbnailOptimizationProgress>(
            'thumbnail-optimization-progress',
            (event) => {
                if (cancelRequestedRef.current) return;
                const shouldShowProgress = hasVisibleThumbnailProgress(event.payload);

                jobDiagnosticRef.current?.update({
                    checked: event.payload.checked,
                    optimized: event.payload.optimized,
                    failed: event.payload.failed,
                    skipped: event.payload.skipped,
                    phase: event.payload.phase,
                    isThrottled: event.payload.isThrottled
                });
                if (!shouldShowProgress) return;

                setBackgroundHealingActive(true);
                setBackgroundHealingPaused(false);
                setBackgroundHealingProgress({
                    current: event.payload.checked,
                    total: event.payload.total > 0 ? event.payload.total : 0,
                    message: formatThumbnailQueueRunningMessage({
                        checked: event.payload.checked,
                        optimized: event.payload.optimized,
                        failed: event.payload.failed
                    })
                });
                setBackgroundHealingDetails({
                    checked: event.payload.checked,
                    optimized: event.payload.optimized,
                    reused: event.payload.reused,
                    failed: event.payload.failed,
                    skipped: event.payload.skipped,
                    imagesPerSecond: event.payload.imagesPerSecond,
                    batchMs: event.payload.batchMs,
                    dbMs: event.payload.dbMs,
                    encodeMs: event.payload.encodeMs,
                    profile: event.payload.profile,
                    phase: event.payload.phase,
                    isThrottled: event.payload.isThrottled
                });

                if (event.payload.checked > 0) {
                    console.debug('[ThumbnailQueue] Backend progress', event.payload);
                }
            },
            'Thumbnail optimization progress'
        );

        const completeListener = listenWithCleanup<ThumbnailOptimizationResult>(
            'thumbnail-optimization-complete',
            (event) => {
                void handleCompletion(event.payload);
            },
            'Thumbnail optimization complete'
        );

        return () => {
            progressListener.cleanup();
            completeListener.cleanup();
        };
    }, [
        browserMockMode,
        handleCompletion,
        setBackgroundHealingActive,
        setBackgroundHealingDetails,
        setBackgroundHealingPaused,
        setBackgroundHealingProgress
    ]);

    const cancelBackendJob = useCallback(async (clearDock: boolean) => {
        cancelScheduledIdleCallback();
        cancelRequestedRef.current = true;

        try {
            await commands.cancelThumbnailOptimizationJob();
        } catch (error) {
            console.error('[ThumbnailQueue] Failed to cancel backend job', error);
        }

        if (clearDock) {
            completionHandledRef.current = true;
            isRunningRef.current = false;
            runningConfigRef.current = null;
            lastThrottleRef.current = null;
            restartRequestedRef.current = false;
            jobDiagnosticRef.current?.finish('cancelled', { clearDock });
            jobDiagnosticRef.current = null;
            setBackgroundHealingActive(false);
            setBackgroundHealingPaused(false);
            setBackgroundHealingProgress(null);
            setBackgroundHealingDetails(null);
        }
    }, [
        cancelScheduledIdleCallback,
        setBackgroundHealingActive,
        setBackgroundHealingDetails,
        setBackgroundHealingPaused,
        setBackgroundHealingProgress
    ]);

    const runQueue = useCallback(async () => {
        const settings = useSettingsStore.getState().settings;
        if (!settings.enableAutoThumbnailHealing) return;
        if (isRunningRef.current) return;

        if (shouldPauseForActivity()) {
            setBackgroundHealingPaused(true);
            return;
        }

        const thumbnailDir = await getThumbnailDir();

        if (!thumbnailDir) {
            console.warn('[ThumbnailQueue] No thumbnail directory');
            setBackgroundHealingActive(false);
            setBackgroundHealingProgress(null);
            setBackgroundHealingDetails(null);
            return;
        }

        const optimizerConfig: RunningThumbnailConfig = {
            includeUpgradeable: Boolean(settings.enforceHighQualityThumbnails),
            profile: settings.thumbnailOptimizationProfile ?? 'balanced'
        };
        const shouldStartThrottled = isImageQueryFetchingRef.current;

        if (shouldPauseForActivity()) {
            setBackgroundHealingPaused(true);
            return;
        }

        isRunningRef.current = true;
        completionHandledRef.current = false;
        cancelRequestedRef.current = false;
        restartRequestedRef.current = false;
        runningConfigRef.current = optimizerConfig;
        setBackgroundHealingPaused(false);

        console.log('[ThumbnailQueue] Starting backend thumbnail optimization', {
            includeUpgradeable: optimizerConfig.includeUpgradeable,
            profile: optimizerConfig.profile
        });
        jobDiagnosticRef.current?.finish('cancelled', { reason: 'superseded' });
        jobDiagnosticRef.current = startBackgroundDiagnostic('job', 'Smart Thumbnail optimization', {
            includeUpgradeable: optimizerConfig.includeUpgradeable,
            profile: optimizerConfig.profile,
            throttledAtStart: shouldStartThrottled
        });

        try {
            const jobPromise = unwrap(commands.startThumbnailOptimizationJob({
                thumbnailDir,
                includeUpgradeable: optimizerConfig.includeUpgradeable,
                profile: optimizerConfig.profile
            }));
            setBackendThrottled(shouldStartThrottled);

            const result = await jobPromise;

            cancelRequestedRef.current = false;
            await handleCompletion(result);
        } catch (error) {
            if (cancelRequestedRef.current) {
                isRunningRef.current = false;
                runningConfigRef.current = null;
                lastThrottleRef.current = null;
                jobDiagnosticRef.current?.finish('cancelled', {
                    error: error instanceof Error ? error.message : String(error)
                });
                jobDiagnosticRef.current = null;
                return;
            }

            console.error('[ThumbnailQueue] Backend thumbnail optimization failed', error);
            addToast?.(`Smart thumbnail optimization failed: ${String(error)}`, 'error');
            jobDiagnosticRef.current?.finish('failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            jobDiagnosticRef.current = null;
            completionHandledRef.current = true;
            isRunningRef.current = false;
            runningConfigRef.current = null;
            lastThrottleRef.current = null;
            setBackgroundHealingActive(false);
            setBackgroundHealingPaused(false);
            setBackgroundHealingProgress(null);
            setBackgroundHealingDetails(null);
        }
    }, [
        addToast,
        handleCompletion,
        setBackendThrottled,
        setBackgroundHealingActive,
        setBackgroundHealingDetails,
        setBackgroundHealingPaused,
        setBackgroundHealingProgress,
        shouldPauseForActivity
    ]);

    const [isStartupDelayComplete, setStartupDelayComplete] = useState(false);

    useEffect(() => {
        if (browserMockMode) return;

        const timer = setTimeout(() => {
            setStartupDelayComplete(true);
        }, STARTUP_DELAY_MS);
        return () => clearTimeout(timer);
    }, [browserMockMode]);

    useEffect(() => {
        if (browserMockMode) return;
        if (!isSettingsLoaded || !isStartupDelayComplete) return;

        if (enableAutoThumbnailHealing) {
            if (!isRunningRef.current && !shouldPauseForActivity() && !useLibraryStore.getState().backgroundHealingPaused) {
                scheduleIdleCallback('auto-start', () => {
                    void runQueue();
                });
            }
            return;
        }

        cancelScheduledIdleCallback();
        void cancelBackendJob(true);
    }, [
        browserMockMode,
        cancelScheduledIdleCallback,
        cancelBackendJob,
        enableAutoThumbnailHealing,
        enforceHighQualityThumbnails,
        isHardBlocked,
        isSettingsLoaded,
        isStartupDelayComplete,
        runQueue,
        scheduleIdleCallback,
        shouldPauseForActivity,
        thumbnailOptimizationProfile
    ]);

    useEffect(() => {
        if (browserMockMode) return;
        if (!enableAutoThumbnailHealing) return;
        if (!isRunningRef.current) return;

        const runningConfig = runningConfigRef.current!;

        const nextConfig: RunningThumbnailConfig = {
            includeUpgradeable: Boolean(enforceHighQualityThumbnails),
            profile: thumbnailOptimizationProfile
        };

        if (
            runningConfig.includeUpgradeable === nextConfig.includeUpgradeable
            && runningConfig.profile === nextConfig.profile
        ) {
            return;
        }

        if (restartRequestedRef.current) return;

        console.log('[ThumbnailQueue] Restarting backend job for Smart Thumbnail settings change');
        restartRequestedRef.current = true;
        setBackgroundHealingPaused(true);
        void cancelBackendJob(false);
    }, [
        browserMockMode,
        cancelBackendJob,
        enableAutoThumbnailHealing,
        enforceHighQualityThumbnails,
        setBackgroundHealingPaused,
        thumbnailOptimizationProfile
    ]);

    useEffect(() => {
        if (browserMockMode) return;
        if (!enableAutoThumbnailHealing || !isRunningRef.current) {
            lastThrottleRef.current = null;
            return;
        }

        setBackendThrottled(isImageQueryFetching);
    }, [
        browserMockMode,
        enableAutoThumbnailHealing,
        isImageQueryFetching,
        setBackendThrottled
    ]);

    useEffect(() => {
        if (browserMockMode) return;
        if (!enableAutoThumbnailHealing) return;
        if (!isHardBlocked || !isRunningRef.current) return;

        console.log('[ThumbnailQueue] Pausing backend job for blocking activity');
        setBackgroundHealingPaused(true);
        void cancelBackendJob(false);
    }, [
        browserMockMode,
        cancelBackendJob,
        enableAutoThumbnailHealing,
        isHardBlocked,
        setBackgroundHealingPaused
    ]);

    useEffect(() => {
        if (browserMockMode) return;
        if (!isSettingsLoaded) return;
        if (!enableAutoThumbnailHealing) return;
        if (thumbnailOptimizationRetrySignal === 0 && postRunRetrySignal === 0) return;
        if (isRunningRef.current) {
            retryAfterCurrentRunRef.current = true;
            return;
        }

        if (shouldPauseForActivity()) {
            setBackgroundHealingPaused(true);
            return;
        }

        scheduleIdleCallback('retry', () => {
            void runQueue();
        });
    }, [
        browserMockMode,
        enableAutoThumbnailHealing,
        isSettingsLoaded,
        postRunRetrySignal,
        runQueue,
        scheduleIdleCallback,
        setBackgroundHealingPaused,
        shouldPauseForActivity,
        thumbnailOptimizationRetrySignal
    ]);

    useEffect(() => {
        if (browserMockMode) return;

        const store = useLibraryStore.getState();
        if (store.backgroundHealingPaused && !isHardBlocked && enableAutoThumbnailHealing) {
            console.log('[ThumbnailQueue] Resuming after blocking activity...');
            setBackgroundHealingPaused(false);

            return scheduleIdleCallback('resume', () => {
                void runQueue();
            }, RESUME_DELAY_MS);
        }
    }, [
        browserMockMode,
        enableAutoThumbnailHealing,
        isHardBlocked,
        resumeSignal,
        runQueue,
        scheduleIdleCallback,
        setBackgroundHealingPaused
    ]);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
            cancelScheduledIdleCallback();
            if (isRunningRef.current) {
                void commands.cancelThumbnailOptimizationJob().catch(console.error);
            }
            jobDiagnosticRef.current?.finish('cancelled', { reason: 'unmount' });
            jobDiagnosticRef.current = null;
            setBackgroundHealingActive(false);
            setBackgroundHealingProgress(null);
            setBackgroundHealingDetails(null);
        };
    }, [
        cancelScheduledIdleCallback,
        setBackgroundHealingActive,
        setBackgroundHealingDetails,
        setBackgroundHealingProgress
    ]);
}
