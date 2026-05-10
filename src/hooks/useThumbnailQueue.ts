import { useEffect, useRef, useCallback, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
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
    formatThumbnailQueueRunningMessage,
    THUMBNAIL_QUEUE_START_MESSAGE
} from './thumbnailQueueProgress';

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
    const browserMockMode = isBrowserMockMode();
    const [resumeSignal, setResumeSignal] = useState(0);
    const [postRunRetrySignal, setPostRunRetrySignal] = useState(0);

    const isImporting = useLibraryStore(s => s.isImporting);
    const isRegeneratingThumbnails = useLibraryStore(s => s.isRegeneratingThumbnails);
    const syncStatus = useLibraryStore(s => s.syncStatus);
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
    const isHardBlocked = isImporting || isRegeneratingThumbnails || syncStatus === 'syncing';

    useEffect(() => {
        isImageQueryFetchingRef.current = isImageQueryFetching;
    }, [isImageQueryFetching]);

    const shouldPauseForActivity = useCallback(() => {
        const store = useLibraryStore.getState();
        return store.isImporting
            || store.isRegeneratingThumbnails
            || store.syncStatus === 'syncing';
    }, []);

    const scheduleIdleCallback = useCallback((callback: () => void, delay: number = 0) => {
        const schedule = () => {
            if ('requestIdleCallback' in window) {
                (window as typeof window & { requestIdleCallback: (cb: () => void, options?: { timeout: number }) => number })
                    .requestIdleCallback(callback, { timeout: 2000 });
            } else {
                setTimeout(callback, 50);
            }
        };

        if (delay > 0) {
            setTimeout(schedule, delay);
            return;
        }

        schedule();
    }, []);

    const setBackendThrottled = useCallback((throttled: boolean) => {
        if (browserMockMode) return;
        if (lastThrottleRef.current === throttled) return;

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
    }, [browserMockMode, setBackgroundHealingDetails]);

    const refreshThumbnailConsumers = useCallback(async (optimized: number) => {
        if (optimized <= 0) return;

        await queryClient.invalidateQueries({ queryKey: ['images'] });
        await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });

        try {
            const { rebuildThumbnailFacetCache } = await import('../services/db/imageRepo');
            await rebuildThumbnailFacetCache();
            useLibraryStore.getState().incrementFacetCacheVersion();
        } catch (error) {
            console.warn('[ThumbnailQueue] Thumbnail facet cache refresh failed', error);
        }
    }, [queryClient]);

    const handleCompletion = useCallback(async (result: ThumbnailOptimizationResult) => {
        if (completionHandledRef.current) return;
        completionHandledRef.current = true;
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

        void refreshThumbnailConsumers(result.optimized);

        await sleep(COMPLETE_VISIBLE_MS);

        if (!completionHandledRef.current || isRunningRef.current || useLibraryStore.getState().backgroundHealingPaused) {
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

        const unlistenProgress = listen<ThumbnailOptimizationProgress>(
            'thumbnail-optimization-progress',
            (event) => {
                if (cancelRequestedRef.current) return;

                setBackgroundHealingActive(true);
                setBackgroundHealingPaused(false);
                setBackgroundHealingProgress({
                    current: event.payload.checked,
                    total: 0,
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
            }
        );

        const unlistenComplete = listen<ThumbnailOptimizationResult>(
            'thumbnail-optimization-complete',
            (event) => {
                void handleCompletion(event.payload);
            }
        );

        return () => {
            unlistenProgress.then(unlisten => unlisten());
            unlistenComplete.then(unlisten => unlisten());
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
        if (browserMockMode) return;

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
            setBackgroundHealingActive(false);
            setBackgroundHealingPaused(false);
            setBackgroundHealingProgress(null);
            setBackgroundHealingDetails(null);
        }
    }, [
        browserMockMode,
        setBackgroundHealingActive,
        setBackgroundHealingDetails,
        setBackgroundHealingPaused,
        setBackgroundHealingProgress
    ]);

    const runQueue = useCallback(async () => {
        if (browserMockMode) return;

        const settings = useSettingsStore.getState().settings;
        if (!settings.enableAutoThumbnailHealing) return;
        if (isRunningRef.current) return;

        if (shouldPauseForActivity()) {
            setBackgroundHealingPaused(true);
            return;
        }

        const { getThumbnailDir } = await import('../services/thumbnailService');
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

        isRunningRef.current = true;
        completionHandledRef.current = false;
        cancelRequestedRef.current = false;
        restartRequestedRef.current = false;
        runningConfigRef.current = optimizerConfig;
        setBackgroundHealingActive(true);
        setBackgroundHealingPaused(false);
        setBackgroundHealingProgress({
            current: 0,
            total: 0,
            message: THUMBNAIL_QUEUE_START_MESSAGE
        });
        setBackgroundHealingDetails({
            checked: 0,
            optimized: 0,
            reused: 0,
            failed: 0,
            skipped: 0,
            imagesPerSecond: 0,
            batchMs: 0,
            dbMs: 0,
            encodeMs: 0,
            profile: optimizerConfig.profile,
            phase: shouldStartThrottled ? 'throttled' : 'running',
            isThrottled: shouldStartThrottled
        });

        console.log('[ThumbnailQueue] Starting backend thumbnail optimization', {
            includeUpgradeable: optimizerConfig.includeUpgradeable,
            profile: optimizerConfig.profile
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
            if (cancelRequestedRef.current) return;

            console.error('[ThumbnailQueue] Backend thumbnail optimization failed', error);
            addToast?.(`Smart thumbnail optimization failed: ${String(error)}`, 'error');
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
        browserMockMode,
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
                scheduleIdleCallback(() => runQueue());
            }
            return;
        }

        void cancelBackendJob(true);
    }, [
        browserMockMode,
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

        const runningConfig = runningConfigRef.current;
        if (!runningConfig) return;

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

        scheduleIdleCallback(() => {
            runQueue();
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

            const resumeTimer = setTimeout(() => {
                scheduleIdleCallback(() => {
                    runQueue();
                });
            }, RESUME_DELAY_MS);

            return () => clearTimeout(resumeTimer);
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
            if (isRunningRef.current) {
                void commands.cancelThumbnailOptimizationJob().catch(console.error);
            }
            setBackgroundHealingActive(false);
            setBackgroundHealingProgress(null);
            setBackgroundHealingDetails(null);
        };
    }, [setBackgroundHealingActive, setBackgroundHealingDetails, setBackgroundHealingProgress]);
}
