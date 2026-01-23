import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';

// Delay before starting auto-healing on app startup (ms)
// Ensures app initialization completes first
const STARTUP_DELAY_MS = 5000;

// Delay between batches to give UI breathing room (ms)
const BATCH_DELAY_MS = 100;

// Delay before resuming after import completes (ms)
const RESUME_DELAY_MS = 2000;

/**
 * Background thumbnail auto-healing queue.
 * 
 * This hook orchestrates automatic thumbnail regeneration in the background.
 * Key features:
 * - Deferred startup: Waits 5s after app launch to avoid blocking initialization
 * - Pause on import: Automatically pauses when user imports files
 * - Low priority: Uses requestIdleCallback (with fallback) for scheduling
 * - Progress tracking: Updates store for ActivityDock visibility
 */
export function useThumbnailQueue(): void {
    const queryClient = useQueryClient();
    const abortControllerRef = useRef<AbortController | null>(null);
    const isRunningRef = useRef(false);


    // Store subscriptions
    const isImporting = useLibraryStore(s => s.isImporting);
    const isRegeneratingThumbnails = useLibraryStore(s => s.isRegeneratingThumbnails);
    const syncStatus = useLibraryStore(s => s.syncStatus);

    const setBackgroundHealingActive = useLibraryStore(s => s.setBackgroundHealingActive);
    const setBackgroundHealingProgress = useLibraryStore(s => s.setBackgroundHealingProgress);
    const setBackgroundHealingPaused = useLibraryStore(s => s.setBackgroundHealingPaused);

    // Settings - check if auto-healing is enabled
    // Note: No fallback needed since settingsStore merges loaded values with DEFAULT_SETTINGS
    const enableAutoThumbnailHealing = useSettingsStore(s => s.settings.enableAutoThumbnailHealing);
    const enforceHighQualityThumbnails = useSettingsStore(s => s.settings.enforceHighQualityThumbnails); // New
    const isSettingsLoaded = useSettingsStore(s => s.isLoaded);

    // Check if any blocking activity is happening
    const isBlocked = isImporting || isRegeneratingThumbnails || syncStatus === 'syncing';

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
        if (isRunningRef.current) return;
        isRunningRef.current = true;

        const { getUnoptimizedImagesCount, getUnoptimizedImageIds } = await import('../services/db/maintenanceRepo');
        const { getThumbnailDir } = await import('../services/thumbnailService');
        const { scanImagesBulk } = await import('../services/metadataParser');
        const { updateThumbnailPathsBatch } = await import('../services/db/imageRepo');

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Track attempted IDs in this session to prevent infinite loops on failing images
        const attemptedIds = new Set<string>();

        try {
            // Check how many need processing (passed includeUpgradeable = enforceHighQualityThumbnails)
            let total = await getUnoptimizedImagesCount('', [], enforceHighQualityThumbnails);
            if (total === 0) {
                console.log('[ThumbnailQueue] No unoptimized images found');
                isRunningRef.current = false;
                return;
            }

            console.log(`[ThumbnailQueue] Starting background healing: ${total} images (High Quality: ${enforceHighQualityThumbnails})`);
            setBackgroundHealingActive(true);
            setBackgroundHealingProgress({ current: 0, total, message: 'Starting optimization...' });

            const thumbDir = await getThumbnailDir();
            if (!thumbDir) {
                console.warn('[ThumbnailQueue] No thumbnail directory');
                isRunningRef.current = false;
                setBackgroundHealingActive(false);
                return;
            }

            let processed = 0;
            let offset = 0;
            const PAGE_SIZE = 1000;
            const BATCH_SIZE = 50; // Reverted to 50 for testing

            // Process in pages
            while (!abortController.signal.aborted) {
                // Check if we should pause
                const store = useLibraryStore.getState();
                if (store.isImporting || store.isRegeneratingThumbnails || store.syncStatus === 'syncing') {
                    console.log('[ThumbnailQueue] Pausing for blocking activity');
                    setBackgroundHealingPaused(true);
                    break;
                }

                // Fetch next page of IDs (passed includeUpgradeable)
                // We always fetch from offset 0 because successful processing removes items from the "unoptimized" set
                const ids = await getUnoptimizedImageIds(0, PAGE_SIZE, '', [], enforceHighQualityThumbnails);

                if (ids.length === 0) break;

                // Infinite loop protection: Filter out images we've already tried and failed to fix in this session
                const freshIds = ids.filter(id => !attemptedIds.has(id));

                if (freshIds.length === 0) {
                    console.warn('[ThumbnailQueue] Aborting: All remaining unoptimized images have failed processing in this session.');
                    break;
                }

                // Dynamic Total Update: If we find more images than our initial 'total' snapshot 
                // (e.g., import added images while we were running), refresh the total to correct the progress bar.
                if (processed + freshIds.length > total) {
                    // Quickly peek at the new real total
                    const newTotal = await getUnoptimizedImagesCount('', [], enforceHighQualityThumbnails);
                    if (newTotal > total) {
                        console.log(`[ThumbnailQueue] Detected new images, updating total from ${total} to ${newTotal}`);
                        total = newTotal;
                        // Immediate UI update to prevent "150 / 1" confusion
                        setBackgroundHealingProgress({
                            current: Math.min(processed, total),
                            total,
                            message: 'Optimizing thumbnails...'
                        });
                    }
                }

                // Process in smaller batches
                for (let i = 0; i < freshIds.length; i += BATCH_SIZE) {
                    if (abortController.signal.aborted) break;

                    // Double-check for blocking activity between batches
                    const currentStore = useLibraryStore.getState();
                    if (currentStore.isImporting || currentStore.isRegeneratingThumbnails || currentStore.syncStatus === 'syncing') {
                        console.log('[ThumbnailQueue] Pausing mid-batch for blocking activity');
                        setBackgroundHealingPaused(true);
                        isRunningRef.current = false;
                        return;
                    }

                    const batchIds = freshIds.slice(i, i + BATCH_SIZE);

                    // Register attempts immediately
                    batchIds.forEach(id => attemptedIds.add(id));

                    const dbUpdates: { id: string; thumbnailPath: string; microThumbnail?: string | null; thumbnailSource?: string | null }[] = [];

                    try {
                        const results = await scanImagesBulk(batchIds, thumbDir, false, false);
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

                            queries.forEach(([queryKey, oldData]: [any, any]) => {
                                if (!oldData || !oldData.pages) return;

                                queryClient.setQueryData(queryKey, (old: any) => ({
                                    ...old,
                                    pages: old.pages.map((page: any) => ({
                                        ...page,
                                        images: page.images.map((img: any) => {
                                            const update = dbUpdates.find(u => u.id === img.id);
                                            if (update) {
                                                return {
                                                    ...img,
                                                    thumbnailUrl: update.thumbnailPath,
                                                    microThumbnail: null
                                                    // Start using thumbnail source 'ambit'
                                                };
                                            }
                                            return img;
                                        })
                                    }))
                                }));
                            });
                        }
                    } catch (e) {
                        console.error(`[ThumbnailQueue] Batch failed at offset ${offset + i}`, e);
                    }

                    // Only increment processed count for what we actually attempted
                    processed += batchIds.length;

                    // Clamp current to total to avoid > 100% visual glitch
                    const displayCurrent = Math.min(processed, total);

                    setBackgroundHealingProgress({
                        current: displayCurrent,
                        total,
                        message: `Optimizing thumbnails...`
                    });

                    // Small delay between batches for UI responsiveness
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
                }
            }

            // Complete
            if (!abortController.signal.aborted) {
                console.log(`[ThumbnailQueue] Complete: processed ${processed} images`);
                setBackgroundHealingProgress({ current: processed, total: Math.max(processed, total), message: 'Optimization complete' });

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
    }, [setBackgroundHealingActive, setBackgroundHealingProgress, setBackgroundHealingPaused]);

    const [isStartupDelayComplete, setStartupDelayComplete] = useState(false);

    /**
     * Handle initial startup delay.
     */
    useEffect(() => {
        const timer = setTimeout(() => {
            setStartupDelayComplete(true);
        }, STARTUP_DELAY_MS);
        return () => clearTimeout(timer);
    }, []);

    /**
     * Reactive control: Start or Stop based on Settings & Delay
     */
    useEffect(() => {
        // 1. Prerequisites check
        if (!isSettingsLoaded || !isStartupDelayComplete) return;

        // 2. Handle Enabled State
        if (enableAutoThumbnailHealing) {
            // Only start if not already running and not paused by blocking activity
            if (!isRunningRef.current) {
                // Check if we are blocked before starting
                const store = useLibraryStore.getState();
                const currentlyBlocked = store.isImporting || store.isRegeneratingThumbnails || store.syncStatus === 'syncing';

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
        isBlocked // Added: Restart when no longer blocked
    ]);

    /**
     * Resume processing when blocking activities complete.
     */
    useEffect(() => {
        const store = useLibraryStore.getState();

        // Only resume if:
        // 1. We were previously running (indicated by paused state)
        // 2. Blocking activity is gone
        // 3. Feature is still enabled
        if (store.backgroundHealingPaused && !isBlocked && enableAutoThumbnailHealing) {
            console.log('[ThumbnailQueue] Resuming after blocking activity');
            setBackgroundHealingPaused(false);

            // Delay before resuming to let things settle
            const resumeTimer = setTimeout(() => {
                scheduleIdleCallback(() => {
                    runQueue();
                });
            }, RESUME_DELAY_MS);

            return () => clearTimeout(resumeTimer);
        }
    }, [isBlocked, runQueue, scheduleIdleCallback, setBackgroundHealingPaused, enableAutoThumbnailHealing]);

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
