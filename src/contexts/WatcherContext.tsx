import * as React from 'react';
import { createContext, useState, useContext, useEffect, useRef, ReactNode, useCallback } from 'react';
import { useSettings } from './SettingsContext';
import { useSync } from './SyncContext';
import { useToast } from '../hooks/useToast';
import { watcherService } from '../services/WatcherService';

interface WatcherContextType {
    isLiveWatching: boolean;
    setIsLiveWatching: React.Dispatch<React.SetStateAction<boolean>>;
    refreshMaintenanceCounts: () => Promise<void>;
    maintenanceCounts: { untagged: number; orphans: number; intermediates: number; missing: number; trash: number; duplicates: number };
}

const WatcherContext = createContext<WatcherContextType | undefined>(undefined);

export const WatcherProvider: React.FC<{ children: ReactNode; onNewImageDetected?: () => void }> = ({ children, onNewImageDetected }) => {
    const { settings } = useSettings();
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
        try {
            const { getMaintenanceCounts } = await import('../services/db/maintenanceRepo');
            const counts = await getMaintenanceCounts();
            setMaintenanceCounts(counts);
        } catch (e) {
            console.error("Failed to refresh maintenance counts", e);
        }
    }, []);

    // Initial maintenance count
    useEffect(() => {
        refreshMaintenanceCounts();
    }, [refreshMaintenanceCounts]);

    // Standard Watcher (Monitored Folders)
    useEffect(() => {
        const initWatcher = async () => {
            await watcherService.startWatching(settings, (event) => {
                if (onNewImageDetected) onNewImageDetected();
                refreshMaintenanceCounts();
            });
        };

        if (settings.monitoredFolders) {
            initWatcher();
        }

        return () => { watcherService.stopWatching(); };
    }, [settings.monitoredFolders, onNewImageDetected, refreshMaintenanceCounts]);

    // Live Watch (InvokeAI)
    useEffect(() => {
        if (!isLiveWatching || !settings.invokeAiPath) {
            liveLinkCleanupRef.current?.();
            liveLinkCleanupRef.current = null;
            return;
        }

        const startLiveWatch = async () => {
            const { startLiveLink } = await import('../services/invoke/liveLink');
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
    }, [isLiveWatching, settings.invokeAiPath, startInvokeSync, onNewImageDetected, addToast]);

    // Maintenance interval
    useEffect(() => {
        const interval = setInterval(refreshMaintenanceCounts, 60000);
        return () => clearInterval(interval);
    }, [refreshMaintenanceCounts]);

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
