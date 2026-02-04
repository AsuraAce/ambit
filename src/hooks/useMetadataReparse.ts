/**
 * useMetadataReparse Hook (Simplified)
 *
 * Listens to backend reparse events and provides control functions.
 * The actual processing now happens entirely in the Rust backend.
 */

import { useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../stores/libraryStore';
import { useToast } from './useToast';

interface ReparseProgress {
    current: number;
    total: number;
    phase: string;
    message: string;
}

interface ReparseResult {
    processed: number;
    updated: number;
    errors: number;
    wasCancelled: boolean;
}

export function useMetadataReparse() {
    const { addToast } = useToast();

    const {
        setIsReparsingMetadata,
        setReparseProgress,
        reparseTrigger,
    } = useLibraryStore();

    // Listen to progress events from backend
    useEffect(() => {
        const unlistenProgress = listen<ReparseProgress>('reparse-progress', (event) => {
            setReparseProgress({
                current: event.payload.current,
                total: event.payload.total,
                message: event.payload.message,
            });
        });

        const unlistenComplete = listen<ReparseResult>('reparse-complete', (event) => {
            const { processed, updated, errors, wasCancelled } = event.payload;

            setIsReparsingMetadata(false);
            setReparseProgress(null);

            if (wasCancelled) {
                addToast(`Re-parse cancelled: ${processed.toLocaleString()} processed before stop`, 'info');
            } else if (processed > 0) {
                addToast(
                    `Re-parse complete: ${updated.toLocaleString()} updated, ${errors} errors`,
                    errors > 0 ? 'warning' : 'success'
                );
            }

            console.log(`[Reparse] Complete: ${processed} processed, ${updated} updated, ${errors} errors`);
        });

        return () => {
            unlistenProgress.then(f => f());
            unlistenComplete.then(f => f());
        };
    }, [setIsReparsingMetadata, setReparseProgress, addToast]);

    // Start reparse job (using direct invoke until bindings are regenerated)
    const startReparse = useCallback(async () => {
        console.log('[Reparse] Starting backend reparse job');
        setIsReparsingMetadata(true);

        try {
            const result = await invoke<ReparseResult>('start_reparse_job', {
                forceReparse: false,
                filterRoot: null
            });
            console.log('[Reparse] Job returned:', result);
            // Note: completion handling happens via event listener above
        } catch (err) {
            console.error('[Reparse] Exception:', err);
            addToast(`Failed to start re-parse: ${err}`, 'error');
            setIsReparsingMetadata(false);
        }
    }, [setIsReparsingMetadata, addToast]);

    // Cancel reparse job
    const cancelReparse = useCallback(async () => {
        console.log('[Reparse] Cancelling job');
        try {
            await invoke('cancel_reparse_job');
        } catch (err) {
            console.error('[Reparse] Cancel error:', err);
        }
    }, []);

    // Force re-parse all (dev tool) - resets parser versions then starts job
    const forceReparseAll = useCallback(async (rootPath?: string, force: boolean = true) => {
        console.log(`[Reparse] Job requested. Root: ${rootPath || 'ALL'}, Force: ${force}`);
        setIsReparsingMetadata(true);

        try {
            const result = await invoke<ReparseResult>('start_reparse_job', {
                forceReparse: force,
                filterRoot: rootPath || null
            });
            console.log('[Reparse] Job returned:', result);
            // Note: completion handling happens via event listener above
        } catch (err) {
            console.error('[Reparse] Exception:', err);
            addToast(`Failed to force re-parse: ${err}`, 'error');
            setIsReparsingMetadata(false);
        }
    }, [setIsReparsingMetadata, addToast]);

    // Respond to manual trigger from DevTab
    useEffect(() => {
        if (reparseTrigger === 0) return;

        console.log('[Reparse] Manual trigger received:', reparseTrigger);
        forceReparseAll();
    }, [reparseTrigger, forceReparseAll]);

    return {
        startReparse,
        cancelReparse,
        forceReparseAll,
    };
}
