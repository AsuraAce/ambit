import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLibraryStore, SyncProgress } from '../stores/libraryStore';

export function useProgressListeners() {
    const {
        setModelResolutionProgress,
        setDiscoveryScanProgress,
        setThumbnailProgress,
        setIsResolvingModels,
        setIsScanningDiscovery,
        setIsRegeneratingThumbnails
    } = useLibraryStore();

    useEffect(() => {
        let unlistenModel: () => void;
        let unlistenDiscovery: () => void;
        let unlistenThumbnails: () => void;

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

            // If there are other progress events, add them here
        };

        setupListeners();

        return () => {
            if (unlistenModel) unlistenModel();
            if (unlistenDiscovery) unlistenDiscovery();
        };
    }, []);
}
