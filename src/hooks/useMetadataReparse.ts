/**
 * useMetadataReparse Hook
 * 
 * Checks for images needing metadata re-parsing on startup and processes
 * them in the background. This is triggered when parser logic is updated
 * (indicated by parser_version < CURRENT_PARSER_VERSION).
 * 
 * Features:
 * - Zero file I/O (uses stored original_metadata_json)
 * - Low priority background processing
 * - Pauses when high-priority tasks are active
 * - Progress updates for Activity Dock
 */

import { useEffect, useRef, useCallback } from 'react';
import { commands } from '../bindings';
import { useLibraryStore } from '../stores/libraryStore';
import { useToast } from './useToast';

const BATCH_SIZE = 50;
const DELAY_BETWEEN_BATCHES_MS = 100;
const INITIAL_DELAY_MS = 5000; // Wait for app to settle before starting

export function useMetadataReparse() {
    const isRunning = useRef(false);
    const abortRef = useRef(false);

    const {
        setIsReparsingMetadata,
        setReparseProgress,
        isImporting,
        isLiveSyncing,
        isRegeneratingThumbnails,
        isResolvingModels,
        isScanningDiscovery,
        isBackgroundHealingActive,
        reparseTrigger,
        isReparsingMetadata,
    } = useLibraryStore();

    const { addToast } = useToast();

    // Check if any high-priority task is running
    const isHighPriorityActive = isImporting || isLiveSyncing || isRegeneratingThumbnails ||
        isResolvingModels || isScanningDiscovery || isBackgroundHealingActive;

    const runReparseLoop = useCallback(async () => {
        if (isRunning.current) return;

        try {
            // Check how many images need re-parsing
            const countResult = await commands.getReparseCount();
            if (countResult.status === 'error') {
                console.error('[Reparse] Failed to get count:', countResult.error);
                return;
            }

            const totalToProcess = countResult.data;
            if (totalToProcess === 0) {
                console.log('[Reparse] No images need re-parsing');
                return;
            }

            console.log(`[Reparse] Found ${totalToProcess} images needing metadata refresh`);

            // Show toast only for manual triggers (we can infer manual if reparseTrigger > 0)
            if (reparseTrigger > 0) {
                addToast(`Starting background re-parse for ${totalToProcess.toLocaleString()} images`, 'info');
            }

            isRunning.current = true;
            abortRef.current = false;
            setIsReparsingMetadata(true);

            let processed = 0;
            let errors = 0;

            while (!abortRef.current) {
                // Fetch next batch
                const batchResult = await commands.getImagesNeedingReparse(BATCH_SIZE);
                if (batchResult.status === 'error') {
                    console.error('[Reparse] Failed to fetch batch:', batchResult.error);
                    break;
                }

                const batch = batchResult.data;
                if (batch.length === 0) {
                    console.log('[Reparse] All images processed');
                    break;
                }

                // Update progress
                setReparseProgress({
                    current: processed,
                    total: totalToProcess,
                    message: `Refreshing metadata (${processed.toLocaleString()} / ${totalToProcess.toLocaleString()})`
                });

                // Process batch
                const result = await commands.reparseMetadataBatch(batch);
                if (result.status === 'ok') {
                    processed += result.data.processed;
                    errors += result.data.errors;
                } else {
                    console.error('[Reparse] Batch failed:', result.error);
                    errors += batch.length;
                }

                // Small delay to prevent CPU hogging
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
            }

            console.log(`[Reparse] Complete: ${processed} processed, ${errors} errors`);

        } catch (err) {
            console.error('[Reparse] Unexpected error:', err);
        } finally {
            isRunning.current = false;
            setIsReparsingMetadata(false);
            setReparseProgress(null);
        }
    }, [setIsReparsingMetadata, setReparseProgress]);

    // Start re-parsing on mount (after initial delay)
    useEffect(() => {
        const timer = setTimeout(() => {
            // Only start if no high-priority tasks are running
            if (!isHighPriorityActive) {
                runReparseLoop();
            }
        }, INITIAL_DELAY_MS);

        return () => {
            clearTimeout(timer);
            abortRef.current = true;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Pause re-parsing when high-priority tasks start
    useEffect(() => {
        if (isHighPriorityActive && isRunning.current) {
            console.log('[Reparse] Pausing for high-priority task');
            abortRef.current = true;
        }
    }, [isHighPriorityActive]);

    // Cancel detection: abort loop when user presses cancel button
    useEffect(() => {
        if (!isReparsingMetadata && isRunning.current) {
            console.log('[Reparse] Cancel detected, aborting loop');
            abortRef.current = true;
        }
    }, [isReparsingMetadata]);

    // Resume re-parsing when high-priority tasks complete
    useEffect(() => {
        if (!isHighPriorityActive && !isRunning.current) {
            // Small delay before resuming
            const timer = setTimeout(() => {
                if (!isRunning.current && !isHighPriorityActive) {
                    runReparseLoop();
                }
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [isHighPriorityActive, runReparseLoop]);

    // Manual trigger from DevTab "Force Re-parse All" button
    // We track the previous trigger value to skip initial mount (when value is 0)
    useEffect(() => {
        // Skip if trigger is still at initial value (0)
        // This prevents running on mount while still responding to button clicks
        if (reparseTrigger === 0) {
            console.log('[Reparse] Skipping initial mount, trigger is 0');
            return;
        }

        console.log('[Reparse] Manual trigger received, reparseTrigger:', reparseTrigger, 'isRunning:', isRunning.current);

        // Force reset if a previous run was interrupted (e.g., app closed mid-reparse)
        // This is safe because we're responding to a user action
        if (isRunning.current) {
            console.log('[Reparse] Resetting stale isRunning flag');
            isRunning.current = false;
            abortRef.current = false;
        }

        // Small delay to let the reset command complete
        const timer = setTimeout(() => {
            runReparseLoop();
        }, 500);
        return () => clearTimeout(timer);
    }, [reparseTrigger, runReparseLoop]);

    return {
        abort: () => { abortRef.current = true; },
        triggerReparse: runReparseLoop
    };
}
