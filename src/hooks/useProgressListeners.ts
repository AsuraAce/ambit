import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore, type SyncProgress } from '../stores/libraryStore';
import { isBrowserMockMode } from '../services/runtime';

export function useProgressListeners() {
    const {
        setModelResolutionProgress,
        setDiscoveryScanProgress,
        setDuplicateScanProgress,
        setIsScanningDuplicates
    } = useLibraryStore();

    useEffect(() => {
        if (isBrowserMockMode()) return;

        let unlistenModel: () => void;
        let unlistenDiscovery: () => void;
        let unlistenDuplicateScan: () => void;

        const setupListeners = async () => {
            unlistenModel = await listen<SyncProgress>('model_resolution_progress', (event) => {
                const progress = event.payload;
                setModelResolutionProgress(progress);

                // Auto-clear when complete if backend doesn't call back for setIsResolvingModels(false)
                // However, typical pattern is that the command finishing handles the boolean.
                // We keep the progress state for the UI to show "100%" or the last message.
            });

            unlistenDiscovery = await listen<SyncProgress>('discovery_scan_progress', (event) => {
                const progress = event.payload;
                setDiscoveryScanProgress(progress);
            });

            unlistenDuplicateScan = await listen<SyncProgress>('file_hash_backfill_progress', (event) => {
                const progress = event.payload;
                setIsScanningDuplicates(true);
                setDuplicateScanProgress(progress);
            });
        };

        setupListeners();

        return () => {
            if (unlistenModel) unlistenModel();
            if (unlistenDiscovery) unlistenDiscovery();
            if (unlistenDuplicateScan) unlistenDuplicateScan();
        };
    }, []);
}
