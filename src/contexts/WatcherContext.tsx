import * as React from 'react';
import { createContext, useState, useContext, useEffect, useRef, ReactNode, useCallback } from 'react';
import { useSettings } from './SettingsContext';
import { useSync } from './SyncContext';
import { useToast } from '../hooks/useToast';
import { watcherService } from '../services/WatcherService';
import { startLiveLink } from '../services/invoke/liveLink';
import { getMaintenanceCounts } from '../services/db/maintenanceRepo';

interface WatcherContextType {
    isLiveWatching: boolean;
    setIsLiveWatching: React.Dispatch<React.SetStateAction<boolean>>;
    refreshMaintenanceCounts: () => Promise<void>;
    maintenanceCounts: { untagged: number; orphans: number; intermediates: number; missing: number; trash: number; duplicates: number };
}

const WatcherContext = createContext<WatcherContextType | undefined>(undefined);

export const WatcherProvider: React.FC<{ children: ReactNode; onNewImageDetected?: () => void }> = ({ children, onNewImageDetected }) => {
    const { settings, isLoaded } = useSettings();
    const { startInvokeSync } = useSync();
    const { addToast } = useToast();

    const [isLiveWatching, setIsLiveWatching] = useState(false);
    const [maintenanceCounts, setMaintenanceCounts] = useState({
        untagged: 0,
        orphans: 0,
        intermediates: 0,
        missing: 0,
        trash: 0,
        duplicates: 0
    });

    const liveLinkCleanupRef = useRef<(() => void) | null>(null);

    const refreshMaintenanceCounts = useCallback(async () => {
        if (!isLoaded) return;
        try {
            const counts = await getMaintenanceCounts();
            setMaintenanceCounts(counts);
        } catch (e) {
            console.error("Failed to refresh maintenance counts", e);
        }
    }, [isLoaded]);

    // Initial maintenance count
    useEffect(() => {
        if (isLoaded) refreshMaintenanceCounts();
    }, [isLoaded, refreshMaintenanceCounts]);

    // Unified Watcher Logic (Live Sync)
    // This controls BOTH the generic "Monitored Folders" AND the "InvokeAI" folder.
    const monitoredFoldersConfig = JSON.stringify(settings.monitoredFolders);
    const invokePathConfig = settings.invokeAiPath;

    useEffect(() => {
        if (!isLoaded) return;

        const initWatcher = async () => {
            // If Live Watch is OFF, stop everything.
            if (!isLiveWatching) {
                await watcherService.stopWatching();
                return;
            }

            // Collect all paths to watch
            const pathsToWatch: string[] = [];

            // 1. Monitored Folders (Generic)
            if (settings.monitoredFolders) {
                settings.monitoredFolders.forEach(f => {
                    if (f.isActive) pathsToWatch.push(f.path);
                });
            }

            // 2. InvokeAI Output Folder (Specialized)
            // Typically: {root}/outputs/images
            if (settings.invokeAiPath) {
                // Ensure correct path joining
                // Using simple concat with '/' is usually safe enough for JS/Rust bridge
                // invokeAiPath usually doesn't end with slash if normalized, but let's be safe
                const cleanRoot = settings.invokeAiPath.replace(/\\/g, '/').replace(/\/$/, '');
                const invokeImagesPath = `${cleanRoot}/outputs/images`;
                pathsToWatch.push(invokeImagesPath);
            }

            if (pathsToWatch.length === 0) {
                await watcherService.stopWatching();
                return;
            }

            // Start the native watcher
            await watcherService.startWatching(pathsToWatch, async () => {
                console.log('[WatcherContext] Global change detected. Refreshing.');

                // 1. Generic Refresh
                if (onNewImageDetected) onNewImageDetected();
                await refreshMaintenanceCounts();

                // 2. InvokeAI Specialized Sync
                // If we have an Invoke Path configured, we should also trigger the DB sync
                // because the file change might have been an Invoke generation.
                if (settings.invokeAiPath) {
                    await startInvokeSync({ mode: 'live' });
                }
            });

            if (pathsToWatch.length > 0) {
                addToast(`Live Sync Active (${pathsToWatch.length} folders)`, 'success');
            }
        };

        initWatcher();

        return () => {
            // Cleanup provided by next run or component unmount
            // However, we generally want the watcher to PERSIST unless strictly stopped?
            // React strict mode might double-mount.
            // WatcherService handles restart logic safely.
        };
    }, [isLoaded, isLiveWatching, monitoredFoldersConfig, invokePathConfig, onNewImageDetected, refreshMaintenanceCounts, startInvokeSync, addToast]);

    // Maintenance interval
    useEffect(() => {
        if (!isLoaded) return;
        const interval = setInterval(refreshMaintenanceCounts, 60000);
        return () => clearInterval(interval);
    }, [isLoaded, refreshMaintenanceCounts]);

    return (
        <WatcherContext.Provider value={{
            isLiveWatching,
            setIsLiveWatching,
            refreshMaintenanceCounts,
            maintenanceCounts
        }}>
            {children}
        </WatcherContext.Provider>
    );
};

export const useWatchers = () => {
    const context = useContext(WatcherContext);
    if (!context) throw new Error('useWatchers must be used within WatcherProvider');
    return context;
};
