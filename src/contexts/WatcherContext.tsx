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

    // Standard Watcher (Monitored Folders)
    const monitoredFoldersConfig = JSON.stringify(settings.monitoredFolders);

    useEffect(() => {
        if (!isLoaded) return;
        const initWatcher = async () => {
            // Re-fetch settings implicitly via closure or pass just the folders.
            // But we need the whole settings object for startWatching signature?
            // Actually WatcherService.startWatching uses 'settings.monitoredFolders'.
            // Let's assume we pass the current settings, but only triggered by config change.
            await watcherService.startWatching(settings, (event) => {
                if (onNewImageDetected) onNewImageDetected();
                refreshMaintenanceCounts();
            });
        };

        if (settings.monitoredFolders && settings.monitoredFolders.length > 0) {
            initWatcher();
        }

        return () => { watcherService.stopWatching(); };
    }, [isLoaded, monitoredFoldersConfig, onNewImageDetected, refreshMaintenanceCounts]);

    // Live Watch (InvokeAI)
    useEffect(() => {
        if (!isLoaded || !isLiveWatching || !settings.invokeAiPath) {
            liveLinkCleanupRef.current?.();
            liveLinkCleanupRef.current = null;
            return;
        }

        const startLiveWatch = async () => {
            liveLinkCleanupRef.current = await startLiveLink(
                settings.invokeAiPath!,
                async () => {
                    await startInvokeSync({ mode: 'live' });
                    if (onNewImageDetected) onNewImageDetected();
                }
            );
            addToast('Live Watch Active', 'success');
        };

        startLiveWatch();
        return () => {
            liveLinkCleanupRef.current?.();
            liveLinkCleanupRef.current = null;
        };
    }, [isLoaded, isLiveWatching, settings.invokeAiPath, startInvokeSync, onNewImageDetected, addToast]);

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
