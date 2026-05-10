import { useEffect, useRef, useCallback, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { isBrowserMockMode } from '../services/runtime';

// Delay before starting auto-healing on app startup (ms)
// Ensures app initialization completes first
const STARTUP_DELAY_MS = 30000;

// Delay between batches to give UI breathing room (ms)
const BATCH_DELAY_MS = 250;

// Delay before resuming after import completes (ms)
const RESUME_DELAY_MS = 5000;

/**
 * Background thumbnail auto-healing queue.
 * 
 * This hook orchestrates automatic thumbnail regeneration in the background.
 * Key features:
 * - Deferred startup: Waits 30s after app launch to avoid blocking initialization
 * - Pause on import: Automatically pauses when user imports files
 * - Low priority: Uses requestIdleCallback (with fallback) for scheduling
 * - Progress tracking: Updates store for ActivityDock visibility
 */
export function useThumbnailQueue(addToast?: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void): void {
    const queryClient = useQueryClient();
    const activeImageQueryCount = useIsFetching({ queryKey: ['images'] });
    const abortControllerRef = useRef<AbortController | null>(null);
    const isRunningRef = useRef(false);
    const browserMockMode = isBrowserMockMode();


    // Store subscriptions
    const isImporting = useLibraryStore(s => s.isImporting);
    const isRegeneratingThumbnails = useLibraryStore(s => s.isRegeneratingThumbnails);
    const syncStatus = useLibraryStore(s => s.syncStatus);
    const isResolvingModels = useLibraryStore(s => s.isResolvingModels);
    const isScanningDiscovery = useLibraryStore(s => s.isScanningDiscovery);
    const isScanningDuplicates = useLibraryStore(s => s.isScanningDuplicates);
    const isScanningMissingFiles = useLibraryStore(s => s.isScanningMissingFiles);
    const isPopulatingThumbnails = useLibraryStore(s => s.isPopulatingThumbnails);
    const isRefreshingMetadata = useLibraryStore(s => s.isRefreshingMetadata);

    const setBackgroundHealingActive = useLibraryStore(s => s.setBackgroundHealingActive);
    const setBackgroundHealingProgress = useLibraryStore(s => s.setBackgroundHealingProgress);
    const setBackgroundHealingPaused = useLibraryStore(s => s.setBackgroundHealingPaused);

    // Settings - check if auto-healing is enabled
    // Note: No fallback needed since settingsStore merges loaded values with DEFAULT_SETTINGS
    const enableAutoThumbnailHealing = useSettingsStore(s => s.settings.enableAutoThumbnailHealing);
    const enforceHighQualityThumbnails = useSettingsStore(s => s.settings.enforceHighQualityThumbnails); // New
    const isSettingsLoaded = useSettingsStore(s => s.isLoaded);

    // Check if any blocking activity is happening
    const isImageQueryFetching = activeImageQueryCount > 0;
    const isResourceOrIndexWorkActive = isResolvingModels
        || isScanningDiscovery
        || isScanningDuplicates
        || isScanningMissingFiles
        || isPopulatingThumbnails
        || isRefreshingMetadata;
    const isBlocked = isImporting || isRegeneratingThumbnails || syncStatus === 'syncing' || isImageQueryFetching || isResourceOrIndexWorkActive;

    /**
     * Schedule a callback with low priority using requestIdleCallback.
     * Falls back to setTimeout for browsers without support.
     */
    const scheduleIdleCallback = useCallback((callback: () => void, delay: number = 0) => {
        if (delay > 0) {
            setTimeout(() => {
                if ('requestIdleCallback' in window) {
                    (window as typeof window & { requestIdleCallback: (cb: () => void) => number })
                        .requestIdleCallback(callback, { timeout: 2000 });
                } else {
                    setTimeout(callback, 50);
                }
            }, delay);
        } else {
            if ('requestIdleCallback' in window) {
                (window as typeof window & { requestIdleCallback: (cb: () => void) => number })
                    .requestIdleCallback(callback, { timeout: 2000 });
            } else {
                setTimeout(callback, 50);
            }
        }
    }, []);

    /**
     * Main processing loop that regenerates unoptimized thumbnails.
     */
    const runQueue = useCallback(async () => {
        if (browserMockMode) return;
        if (isRunningRef.current) return;
        isRunningRef.current = true;

        const { getUnoptimizedImageEntries } = await import('../services/db/maintenanceRepo');
        const { getThumbnailDir } = await import('../services/thumbnailService');
        const { scanImagesBulk } = await import('../services/metadataParser');
        const { updateThumbnailPathsBatch } = await import('../services/db/imageRepo');

        // Removed commands import to use raw invoke


        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Track attempted IDs in this session to prevent infinite loops on failing images
        const attemptedIds = new Set<string>();
        const shouldPauseForActivity = () => {
            const store = useLibraryStore.getState();
            return store.isImporting
                || store.isRegeneratingThumbnails
                || store.syncStatus === 'syncing'
                || store.isResolvingModels
                || store.isScanningDiscovery
                || store.isScanningDuplicates
                || store.isScanningMissingFiles
                || store.isPopulatingThumbnails
                || store.isRefreshingMetadata
                || queryClient.isFetching({ queryKey: ['images'] }) > 0;
        };

        try {
            const thumbDir = await getThumbnailDir();
            if (!thumbDir) {
                console.warn('[ThumbnailQueue] No thumbnail directory');
                isRunningRef.current = false;
                setBackgroundHealingActive(false);
                return;
            }

            let processed = 0;
            let hasStarted = false;
            let wasPaused = false;
            const PAGE_SIZE = 200;
            const BATCH_SIZE = 20;

            // Process in pages
            while (!abortController.signal.aborted) {
                // Check if we should pause
                if (shouldPauseForActivity()) {
                    console.log('[ThumbnailQueue] Pausing for blocking activity');
                    setBackgroundHealingPaused(true);
                    wasPaused = true;
                    break;
                }

                // Fetch next page of entries (passed includeUpgradeable)
                // We always fetch from offset 0 because successful processing removes items from the "unoptimized" set
                const entries = await getUnoptimizedImageEntries(0, PAGE_SIZE, '', [], enforceHighQualityThumbnails);

                if (entries.length === 0) break;

                // Infinite loop protection: Filter out images we've already tried and failed to fix in this session
                const freshEntries = entries.filter(e => !attemptedIds.has(e.id));

                if (freshEntries.length === 0) {
                    console.warn('[ThumbnailQueue] Aborting: All remaining unoptimized images have failed processing in this session.');
                    break;
                }

                if (!hasStarted) {
                    console.log(`[ThumbnailQueue] Starting background healing (High Quality: ${enforceHighQualityThumbnails})`);
                    setBackgroundHealingActive(true);
                    setBackgroundHealingProgress({ current: 0, total: 0, message: 'Optimizing thumbnails...' });
                    hasStarted = true;
                }

                // Process in smaller batches
                for (let i = 0; i < freshEntries.length; i += BATCH_SIZE) {
                    if (abortController.signal.aborted) break;

                    // Double-check for blocking activity between batches
                    if (shouldPauseForActivity()) {
                        console.log('[ThumbnailQueue] Pausing mid-batch for blocking activity');
                        setBackgroundHealingPaused(true);
                        isRunningRef.current = false;
                        return;
                    }

                    const batchEntries = freshEntries.slice(i, i + BATCH_SIZE);
                    const batchIds = batchEntries.map(e => e.id);
                    const batchPaths = batchEntries.map(e => e.path);

                    // Register attempts immediately
                    batchIds.forEach(id => attemptedIds.add(id));

                    const dbUpdates: { id: string; thumbnailPath: string; microThumbnail?: string | null; thumbnailSource?: string | null }[] = [];

                    try {
                        // FIX: Pass actual file paths to scanner, NOT IDs
                        const results = await scanImagesBulk(batchPaths, thumbDir, false, false);
                        results.forEach((res, idx) => {
                            if (res.thumbnail) {
                                dbUpdates.push({
                                    id: batchIds[idx],
                                    thumbnailPath: res.thumbnail,
                                    microThumbnail: res.microThumbnail || null,
                                    thumbnailSource: res.thumbnailSource || 'ambit'
                                });
                            }
                        });

                        if (dbUpdates.length > 0) {
                            await updateThumbnailPathsBatch(dbUpdates);

                            // Sync with UI: Update React Query cache immediately
                            // We must update ALL queries starting with 'images' to catch various filter states
                            const queries = queryClient.getQueriesData({ queryKey: ['images'] });
                            const { convertFileSrc } = await import('@tauri-apps/api/core');

                            let updateCount = 0;

                            queries.forEach(([queryKey, oldData]: [any, any]) => {
                                if (!oldData || !oldData.pages) return;

                                queryClient.setQueryData(queryKey, (old: any) => {
                                    if (!old || !old.pages) return old;

                                    return {
                                        ...old,
                                        pages: old.pages.map((page: any) => ({
                                            ...page,
                                            images: page.images.map((img: any) => {
                                                const update = dbUpdates.find(u => u.id === img.id);
                                                if (update) {
                                                    updateCount++;
                                                    return {
                                                        ...img,
                                                        // CRITICAL FIX: Ensure protocol is correct for SmartImage detection
                                                        thumbnailUrl: convertFileSrc(update.thumbnailPath),
                                                        microThumbnail: null,
                                                        thumbnailSource: 'ambit'
                                                    };
                                                }
                                                return img;
                                            })
                                        }))
                                    };
                                });
                            });

                            if (updateCount > 0) {
                                console.log(`[ThumbnailQueue] Silently updated ${updateCount} images in query cache`);
                            }
                        }

                        // Check for failures in this batch
                        const failedIds: string[] = [];

                        results.forEach((res, idx) => {
                            // Check for error field OR missing thumbnail
                            if (res.error || res.errorReason || (!res.thumbnail && !res.microThumbnail)) {
                                const failedId = batchIds[idx];
                                const failedPath = batchPaths[idx];
                                const errorReason = res.errorReason || (res as any).error || "Unknown Failure";

                                failedIds.push(failedId);

                                console.error(`[ThumbnailQueue] Failed to generate thumbnail for ID: ${failedId}`, errorReason);

                                if (addToast) {
                                    // Use the error message from backend if available
                                    addToast(`Thumbnail failed for ${failedPath.split(/[\\/]/).pop()}: ${errorReason}`, 'error');
                                }
                            }
                        });

                        // Quarantine corrupt images
                        if (failedIds.length > 0) {
                            try {
                                await invoke('mark_images_corrupt', { ids: failedIds });
                                console.log(`[ThumbnailQueue] Quarantined ${failedIds.length} corrupt images`);
                            } catch (e) {
                                console.error('[ThumbnailQueue] Failed to mark images as corrupt', e);
                            }
                        }
                    } catch (e) {
                        console.error(`[ThumbnailQueue] Batch failed at processed ${processed + i}`, e);
                    }

                    // Only increment processed count for what we actually attempted
                    processed += batchEntries.length;

                    setBackgroundHealingProgress({
                        current: processed,
                        total: 0,
                        message: `Optimizing thumbnails...`
                    });

                    // Small delay between batches for UI responsiveness
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
                }
            }

            if (wasPaused) {
                return;
            }

            if (!hasStarted) {
                console.log('[ThumbnailQueue] No unoptimized images found');
                setBackgroundHealingActive(false);
                setBackgroundHealingProgress(null);
                isRunningRef.current = false;
                return;
            }

            // Complete
            if (!abortController.signal.aborted) {
                console.log(`[ThumbnailQueue] Complete: processed ${processed} images`);
                setBackgroundHealingProgress({ current: processed, total: processed, message: 'Optimization complete' });

                // Brief delay before hiding
                await new Promise(resolve => setTimeout(resolve, 1500));
                setBackgroundHealingActive(false);
                setBackgroundHealingProgress(null);
            }

        } catch (e) {
            console.error('[ThumbnailQueue] Error during background healing', e);
            setBackgroundHealingActive(false);
            setBackgroundHealingProgress(null);
        } finally {
            isRunningRef.current = false;
            abortControllerRef.current = null;
        }
    }, [setBackgroundHealingActive, setBackgroundHealingProgress, setBackgroundHealingPaused, browserMockMode, enforceHighQualityThumbnails, queryClient]);

    const [isStartupDelayComplete, setStartupDelayComplete] = useState(false);

    /**
     * Handle initial startup delay.
     */
    useEffect(() => {
        if (browserMockMode) return;

        const timer = setTimeout(() => {
            setStartupDelayComplete(true);
        }, STARTUP_DELAY_MS);
        return () => clearTimeout(timer);
    }, [browserMockMode]);

    /**
     * Reactive control: Start or Stop based on Settings & Delay
     */
    useEffect(() => {
        if (browserMockMode) return;

        // 1. Prerequisites check
        if (!isSettingsLoaded || !isStartupDelayComplete) return;

        // 2. Handle Enabled State
        if (enableAutoThumbnailHealing) {
            // Only start if not already running and not paused by blocking activity
            if (!isRunningRef.current) {
                // Check if we are blocked before starting
                const store = useLibraryStore.getState();
                const currentlyBlocked = store.isImporting
                    || store.isRegeneratingThumbnails
                    || store.syncStatus === 'syncing'
                    || store.isResolvingModels
                    || store.isScanningDiscovery
                    || store.isScanningDuplicates
                    || store.isScanningMissingFiles
                    || store.isPopulatingThumbnails
                    || store.isRefreshingMetadata
                    || store.backgroundHealingPaused
                    || queryClient.isFetching({ queryKey: ['images'] }) > 0;

                if (!currentlyBlocked) {
                    console.log('[ThumbnailQueue] Smart Optimization enabled and idle, starting...');
                    scheduleIdleCallback(() => runQueue());
                }
            }
        }
        // 3. Handle Disabled State
        else {
            if (isRunningRef.current) {
                console.log('[ThumbnailQueue] Smart Optimization disabled by user, aborting...');

                // Cancel operation
                if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                    abortControllerRef.current = null;
                }

                // Reset state
                isRunningRef.current = false;
                setBackgroundHealingActive(false);
                setBackgroundHealingPaused(false); // Clear pause state since we are fully stopping
                setBackgroundHealingProgress(null);
            }
        }
    }, [
        enableAutoThumbnailHealing,
        isSettingsLoaded,
        isStartupDelayComplete,
        runQueue,
        scheduleIdleCallback,
        setBackgroundHealingActive,
        setBackgroundHealingPaused,
        setBackgroundHealingProgress,
        enforceHighQualityThumbnails, // Added trigger
        isBlocked, // Added: Restart when no longer blocked
        queryClient
    ]);

    /**
     * Resume processing when blocking activities complete.
     */
    useEffect(() => {
        if (browserMockMode) return;

        const store = useLibraryStore.getState();

        // Only resume if:
        // 1. We were previously running (indicated by paused state)
        // 2. Blocking activity is gone
        // 3. Feature is still enabled
        if (store.backgroundHealingPaused && !isBlocked && enableAutoThumbnailHealing) {
            console.log('[ThumbnailQueue] Resuming after blocking activity...');
            setBackgroundHealingPaused(false);

            // Delay before resuming to let things settle
            const resumeTimer = setTimeout(() => {
                scheduleIdleCallback(() => {
                    runQueue();
                });
            }, RESUME_DELAY_MS);

            return () => clearTimeout(resumeTimer);
        }
    }, [isBlocked, runQueue, scheduleIdleCallback, setBackgroundHealingPaused, enableAutoThumbnailHealing, browserMockMode]);

    /**
     * Cleanup on unmount.
     */
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            setBackgroundHealingActive(false);
            setBackgroundHealingProgress(null);
        };
    }, [setBackgroundHealingActive, setBackgroundHealingProgress]);
}
