import { useEffect } from 'react';
import { useLibraryStore, type SyncProgress } from '../stores/libraryStore';
import { isBrowserMockMode } from '../services/runtime';
import { listenWithCleanup } from '../utils/tauriListener';

export function useProgressListeners() {
    const {
        setModelResolutionProgress,
        setDiscoveryScanProgress,
        setDuplicateScanProgress,
        setIsScanningDuplicates
    } = useLibraryStore();

    useEffect(() => {
        if (isBrowserMockMode()) return;

        const modelListener = listenWithCleanup<SyncProgress>(
            'model_resolution_progress',
            (event) => {
                const progress = event.payload;
                setModelResolutionProgress(progress);

                // Auto-clear when complete if backend doesn't call back for setIsResolvingModels(false)
                // However, typical pattern is that the command finishing handles the boolean.
                // We keep the progress state for the UI to show "100%" or the last message.
            },
            'Model resolution progress'
        );

        const discoveryListener = listenWithCleanup<SyncProgress>(
            'discovery_scan_progress',
            (event) => {
                const progress = event.payload;
                setDiscoveryScanProgress(progress);
            },
            'Model discovery progress'
        );

        const duplicateScanListener = listenWithCleanup<SyncProgress>(
            'file_hash_backfill_progress',
            (event) => {
                const progress = event.payload;
                setIsScanningDuplicates(true);
                setDuplicateScanProgress(progress);
            },
            'Duplicate hash backfill progress'
        );

        return () => {
            modelListener.cleanup();
            discoveryListener.cleanup();
            duplicateScanListener.cleanup();
        };
    }, []);
}
