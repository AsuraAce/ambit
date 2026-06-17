/**
 * useMetadataRefresh Hook
 *
 * Listens to backend refresh events and provides control functions.
 * The actual processing happens entirely in the Rust backend.
 */

import { useEffect, useCallback, useRef } from 'react';
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

interface RefreshStartResult {
    ok: boolean;
    error?: unknown;
}

interface StartRefreshOptions {
    showFailureToast?: boolean;
    deferActiveUntilProgress?: boolean;
}

const STARTUP_REFRESH_INITIAL_DELAY_MS = 3000;
const STARTUP_REFRESH_RETRY_DELAY_MS = 15000;
const STARTUP_REFRESH_MAX_ATTEMPTS = 20;

const getErrorMessage = (err: unknown): string => (
    err instanceof Error ? err.message : String(err)
);

const isTransientDatabaseLock = (err: unknown): boolean => {
    const message = getErrorMessage(err).toLowerCase();
    return message.includes('database is locked')
        || message.includes('database table is locked')
        || message.includes('database schema is locked')
        || message.includes('database busy')
        || message.includes('sqlite_busy');
};

export function useMetadataRefresh() {
    const { addToast } = useToast();
    const browserMockMode = isBrowserMockMode();
    const startupAnnouncementCountRef = useRef<number | null>(null);
    const startupAnnouncementShownRef = useRef(false);
    const deferStartupVisibilityUntilProcessingRef = useRef(false);

    const {
        setMetadataRefreshPending,
        setIsRefreshingMetadata,
        setRefreshProgress,
    } = useLibraryStore();

    // Listen to progress events from backend
    useEffect(() => {
        if (browserMockMode) return;

        const progressListener = listenWithCleanup<RefreshProgress>(
            'refresh-progress',
            (event) => {
                if (
                    deferStartupVisibilityUntilProcessingRef.current
                    && event.payload.phase !== 'processing'
                ) {
                    setMetadataRefreshPending(true);
                    setIsRefreshingMetadata(false);
                    setRefreshProgress(null);
                    return;
                }

                deferStartupVisibilityUntilProcessingRef.current = false;
                setMetadataRefreshPending(false);
                setIsRefreshingMetadata(true);
                setRefreshProgress({
                    current: event.payload.current,
                    total: event.payload.total,
                    updated: event.payload.updated,
                    errors: event.payload.errors,
                    phase: event.payload.phase,
                    message: event.payload.message,
                });
                const startupCount = startupAnnouncementCountRef.current;
                if (startupCount !== null && !startupAnnouncementShownRef.current) {
                    startupAnnouncementShownRef.current = true;
                    addToast(
                        `Parser updated - re-analyzing ${startupCount.toLocaleString()} images in the background`,
                        'info'
                    );
                }
            },
            'Metadata refresh progress'
        );

        const completeListener = listenWithCleanup<RefreshResult>(
            'refresh-complete',
            (event) => {
                const { processed, updated, errors, wasCancelled } = event.payload;

                setIsRefreshingMetadata(false);
                setMetadataRefreshPending(false);
                setRefreshProgress(null);
                startupAnnouncementCountRef.current = null;
                startupAnnouncementShownRef.current = false;

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
    }, [setMetadataRefreshPending, setIsRefreshingMetadata, setRefreshProgress, addToast, browserMockMode]);

    // Start refresh job
    const startRefresh = useCallback(async (
        filterTool?: string,
        options: StartRefreshOptions = {}
    ): Promise<RefreshStartResult> => {
        const { showFailureToast = true, deferActiveUntilProgress = false } = options;

        if (browserMockMode) {
            addToast('Unavailable in browser mock mode.', 'info');
            return { ok: false };
        }

        console.log(`[Refresh] Starting backend refresh job${filterTool ? ` (Tool: ${filterTool})` : ''}`);
        deferStartupVisibilityUntilProcessingRef.current = deferActiveUntilProgress;
        if (!deferActiveUntilProgress) {
            startupAnnouncementCountRef.current = null;
            startupAnnouncementShownRef.current = false;
            setMetadataRefreshPending(false);
            setIsRefreshingMetadata(true);
        }

        try {
            const result = await invoke<RefreshResult>('start_reparse_job', {
                forceReparse: false,
                filterRoot: null,
                filterTool: filterTool || null
            });
            console.log('[Refresh] Job returned:', result);
            // Safety reset in case events are missed or job returns immediately
            setMetadataRefreshPending(false);
            setIsRefreshingMetadata(false);
            startupAnnouncementCountRef.current = null;
            startupAnnouncementShownRef.current = false;
            deferStartupVisibilityUntilProcessingRef.current = false;
            return { ok: true };
        } catch (err) {
            console.error('[Refresh] Exception:', err);
            if (showFailureToast) {
                addToast(`Failed to start refresh: ${getErrorMessage(err)}`, 'error');
            }
            setMetadataRefreshPending(false);
            setIsRefreshingMetadata(false);
            startupAnnouncementCountRef.current = null;
            startupAnnouncementShownRef.current = false;
            deferStartupVisibilityUntilProcessingRef.current = false;
            return { ok: false, error: err };
        }
    }, [setMetadataRefreshPending, setIsRefreshingMetadata, addToast, browserMockMode]);

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
        deferStartupVisibilityUntilProcessingRef.current = false;
        startupAnnouncementCountRef.current = null;
        startupAnnouncementShownRef.current = false;
        setMetadataRefreshPending(false);
        setIsRefreshingMetadata(true);

        try {
            const result = await invoke<RefreshResult>('start_reparse_job', {
                forceReparse: force,
                filterRoot: rootPath || null,
                filterTool: filterTool || null
            });
            console.log('[Refresh] Job returned:', result);
            // Safety reset in case events are missed or job returns immediately
            setMetadataRefreshPending(false);
            setIsRefreshingMetadata(false);
            startupAnnouncementCountRef.current = null;
            startupAnnouncementShownRef.current = false;
            deferStartupVisibilityUntilProcessingRef.current = false;
        } catch (err) {
            console.error('[Refresh] Exception:', err);
            addToast(`Failed to force refresh: ${getErrorMessage(err)}`, 'error');
            setMetadataRefreshPending(false);
            setIsRefreshingMetadata(false);
            deferStartupVisibilityUntilProcessingRef.current = false;
        }
    }, [setMetadataRefreshPending, setIsRefreshingMetadata, addToast, browserMockMode]);

    // Auto-detect stale metadata on startup
    useEffect(() => {
        if (browserMockMode) return;

        let isCancelled = false;
        let retryTimer: number | undefined;

        const runStartupRefresh = async (attempt: number) => {
            try {
                setMetadataRefreshPending(true);
                const countRes = await invoke<number>('get_reparse_count');
                if (isCancelled) return;
                if (countRes <= 0) {
                    setMetadataRefreshPending(false);
                    startupAnnouncementCountRef.current = null;
                    startupAnnouncementShownRef.current = false;
                    deferStartupVisibilityUntilProcessingRef.current = false;
                    return;
                }

                const store = useLibraryStore.getState();
                if (store.isStartupCatchupPending || store.isImporting || store.syncStatus === 'syncing') {
                    retryTimer = window.setTimeout(() => {
                        void runStartupRefresh(attempt);
                    }, STARTUP_REFRESH_RETRY_DELAY_MS);
                    return;
                }

                startupAnnouncementCountRef.current = countRes;
                startupAnnouncementShownRef.current = false;
                const result = await startRefresh(undefined, {
                    showFailureToast: false,
                    deferActiveUntilProgress: true
                });
                if (result.ok || isCancelled) return;

                if (isTransientDatabaseLock(result.error) && attempt < STARTUP_REFRESH_MAX_ATTEMPTS) {
                    setMetadataRefreshPending(true);
                    console.info(
                        `[Refresh] Startup refresh is waiting for the database lock to clear (attempt ${attempt + 1}/${STARTUP_REFRESH_MAX_ATTEMPTS})`
                    );
                    retryTimer = window.setTimeout(() => {
                        void runStartupRefresh(attempt + 1);
                    }, STARTUP_REFRESH_RETRY_DELAY_MS);
                    return;
                }

                setMetadataRefreshPending(false);
                startupAnnouncementCountRef.current = null;
                startupAnnouncementShownRef.current = false;
                deferStartupVisibilityUntilProcessingRef.current = false;
                addToast(`Failed to start refresh: ${getErrorMessage(result.error)}`, 'error');
            } catch (err) {
                if (isTransientDatabaseLock(err) && attempt < STARTUP_REFRESH_MAX_ATTEMPTS) {
                    setMetadataRefreshPending(true);
                    console.info(
                        `[Refresh] Startup refresh count check is waiting for the database lock to clear (attempt ${attempt + 1}/${STARTUP_REFRESH_MAX_ATTEMPTS})`
                    );
                    retryTimer = window.setTimeout(() => {
                        void runStartupRefresh(attempt + 1);
                    }, STARTUP_REFRESH_RETRY_DELAY_MS);
                    return;
                }

                setMetadataRefreshPending(false);
                startupAnnouncementCountRef.current = null;
                startupAnnouncementShownRef.current = false;
                deferStartupVisibilityUntilProcessingRef.current = false;
                console.error('[Refresh] Startup check failed:', err);
            }
        };

        // Run after a short delay to allow app to settle after startup maintenance.
        const timer = window.setTimeout(() => {
            void runStartupRefresh(1);
        }, STARTUP_REFRESH_INITIAL_DELAY_MS);

        return () => {
            isCancelled = true;
            setMetadataRefreshPending(false);
            startupAnnouncementCountRef.current = null;
            startupAnnouncementShownRef.current = false;
            deferStartupVisibilityUntilProcessingRef.current = false;
            window.clearTimeout(timer);
            if (retryTimer !== undefined) {
                window.clearTimeout(retryTimer);
            }
        };
    }, [setMetadataRefreshPending, startRefresh, addToast, browserMockMode]);

    return {
        startRefresh,
        cancelRefresh,
        forceRefresh,
    };
}
