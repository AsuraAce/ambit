/**
 * useMetadataRefresh Hook
 *
 * Listens to backend refresh events and provides control functions.
 * The actual processing happens entirely in the Rust backend.
 */

import { useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../stores/libraryStore';
import { useToast } from './useToast';
import { isBrowserMockMode } from '../services/runtime';
import { listenWithCleanup } from '../utils/tauriListener';

interface RefreshProgress {
    current: number;
    total: number;
    updated: number;
    errors: number;
    phase: string;
    message: string;
}

interface RefreshResult {
    processed: number;
    updated: number;
    errors: number;
    wasCancelled: boolean;
}

export function useMetadataRefresh() {
    const { addToast } = useToast();
    const browserMockMode = isBrowserMockMode();

    const {
        setIsRefreshingMetadata,
        setRefreshProgress,
    } = useLibraryStore();

    // Listen to progress events from backend
    useEffect(() => {
        if (browserMockMode) return;

        const progressListener = listenWithCleanup<RefreshProgress>(
            'refresh-progress',
            (event) => {
                setRefreshProgress({
                    current: event.payload.current,
                    total: event.payload.total,
                    updated: event.payload.updated,
                    errors: event.payload.errors,
                    phase: event.payload.phase,
                    message: event.payload.message,
                });
            },
            'Metadata refresh progress'
        );

        const completeListener = listenWithCleanup<RefreshResult>(
            'refresh-complete',
            (event) => {
                const { processed, updated, errors, wasCancelled } = event.payload;

                setIsRefreshingMetadata(false);
                setRefreshProgress(null);

                if (wasCancelled) {
                    addToast(`Refresh cancelled: ${processed.toLocaleString()} processed before stop`, 'info');
                } else if (processed > 0) {
                    addToast(
                        `Refresh complete: ${updated.toLocaleString()} updated, ${errors} errors`,
                        errors > 0 ? 'warning' : 'success'
                    );
                }

                console.log(`[Refresh] Complete: ${processed} processed, ${updated} updated, ${errors} errors`);
            },
            'Metadata refresh complete'
        );

        return () => {
            progressListener.cleanup();
            completeListener.cleanup();
        };
    }, [setIsRefreshingMetadata, setRefreshProgress, addToast, browserMockMode]);

    // Start refresh job
    const startRefresh = useCallback(async (filterTool?: string) => {
        if (browserMockMode) {
            addToast('Unavailable in browser mock mode.', 'info');
            return;
        }

        console.log(`[Refresh] Starting backend refresh job${filterTool ? ` (Tool: ${filterTool})` : ''}`);
        setIsRefreshingMetadata(true);

        try {
            const result = await invoke<RefreshResult>('start_reparse_job', {
                forceReparse: false,
                filterRoot: null,
                filterTool: filterTool || null
            });
            console.log('[Refresh] Job returned:', result);
            // Safety reset in case events are missed or job returns immediately
            setIsRefreshingMetadata(false);
        } catch (err) {
            console.error('[Refresh] Exception:', err);
            addToast(`Failed to start refresh: ${err}`, 'error');
            setIsRefreshingMetadata(false);
        }
    }, [setIsRefreshingMetadata, addToast, browserMockMode]);

    // Cancel refresh job
    const cancelRefresh = useCallback(async () => {
        if (browserMockMode) return;

        console.log('[Refresh] Cancelling job');
        try {
            await invoke('cancel_reparse_job');
        } catch (err) {
            console.error('[Refresh] Cancel error:', err);
        }
    }, [browserMockMode]);

    // Force refresh (can be targeted to a folder or tool)
    const forceRefresh = useCallback(async (rootPath?: string, force: boolean = false, filterTool?: string) => {
        if (browserMockMode) {
            addToast('Unavailable in browser mock mode.', 'info');
            return;
        }

        console.log(`[Refresh] Job requested. Root: ${rootPath || 'ALL'}, Force: ${force}${filterTool ? `, Tool: ${filterTool}` : ''}`);
        setIsRefreshingMetadata(true);

        try {
            const result = await invoke<RefreshResult>('start_reparse_job', {
                forceReparse: force,
                filterRoot: rootPath || null,
                filterTool: filterTool || null
            });
            console.log('[Refresh] Job returned:', result);
            // Safety reset in case events are missed or job returns immediately
            setIsRefreshingMetadata(false);
        } catch (err) {
            console.error('[Refresh] Exception:', err);
            addToast(`Failed to force refresh: ${err}`, 'error');
            setIsRefreshingMetadata(false);
        }
    }, [setIsRefreshingMetadata, addToast, browserMockMode]);

    // Auto-detect stale metadata on startup
    useEffect(() => {
        if (browserMockMode) return;

        // Run after a short delay to allow app to settle after startup maintenance.
        const timer = setTimeout(async () => {
            try {
                const countRes = await invoke<number>('get_reparse_count');
                if (countRes > 0) {
                    addToast(
                        `Parser updated - re-analyzing ${countRes.toLocaleString()} images in the background`,
                        'info'
                    );
                    startRefresh();
                }
            } catch (err) {
                console.error('[Refresh] Startup check failed:', err);
            }
        }, 3000);

        return () => clearTimeout(timer);
    }, [startRefresh, addToast, browserMockMode]);

    return {
        startRefresh,
        cancelRefresh,
        forceRefresh,
    };
}
