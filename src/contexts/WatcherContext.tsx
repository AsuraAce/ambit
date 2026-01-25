import * as React from 'react';
import { createContext, useContext, useEffect, useRef, ReactNode, useCallback } from 'react';
import { useSettings } from './SettingsContext';
import { useSync } from './SyncContext';
import { useToast } from '../hooks/useToast';
import { watcherService } from '../services/WatcherService';
import { startLiveLink } from '../services/invoke/liveLink';
import { getMaintenanceCounts } from '../services/db/maintenanceRepo';
import { useLibraryStore } from '../stores/libraryStore';

interface WatcherContextType {
    isLiveWatching: boolean;
    setIsLiveWatching: React.Dispatch<React.SetStateAction<boolean>>;
    refreshMaintenanceCounts: () => Promise<void>;
    maintenanceCounts: { untagged: number; orphans: number; intermediates: number; missing: number; trash: number; duplicates: number };
    lastWatcherEvent: number;
}

const WatcherContext = createContext<WatcherContextType | undefined>(undefined);

export const WatcherProvider: React.FC<{ children: ReactNode; onNewImageDetected?: () => void }> = ({ children, onNewImageDetected }) => {
    const { settings, isLoaded } = useSettings();
    const { startInvokeSync } = useSync();
    const { addToast } = useToast();

    // Zustand State
    const isLiveWatching = useLibraryStore(s => s.isLiveWatching);
    const setIsLiveWatching = useLibraryStore(s => s.setIsLiveWatching);
    const [lastWatcherEvent, setLastWatcherEvent] = React.useState<number>(0);
    const maintenanceCounts = useLibraryStore(s => s.maintenanceCounts);
    const setMaintenanceCounts = useLibraryStore(s => s.setMaintenanceCounts);

    const refreshMaintenanceCounts = useCallback(async () => {
        if (!isLoaded) return;
        try {
            const counts = await getMaintenanceCounts();
            setMaintenanceCounts(counts);
        } catch (e) {
            console.error("Failed to refresh maintenance counts", e);
        }
    }, [isLoaded, setMaintenanceCounts]);

    // Initial maintenance count
    useEffect(() => {
        if (isLoaded) refreshMaintenanceCounts();
    }, [isLoaded, refreshMaintenanceCounts]);

    // Unified Watcher Logic (Live Sync)
    const monitoredFoldersConfig = JSON.stringify(settings.monitoredFolders);
    const invokePathConfig = settings.invokeAiPath;

    // Stable ref for callbacks to avoid restarting watcher on every render
    const callbacksRef = useRef({ onNewImageDetected, refreshMaintenanceCounts, startInvokeSync, settings });
    useEffect(() => {
        callbacksRef.current = { onNewImageDetected, refreshMaintenanceCounts, startInvokeSync, settings };
    });

    useEffect(() => {
        if (!isLoaded) return;

        const initWatcher = async () => {
            if (!isLiveWatching) {
                await watcherService.stopWatching();
                return;
            }

            const currentSettings = callbacksRef.current.settings;
            const pathsToWatch: string[] = [];

            if (currentSettings.monitoredFolders) {
                currentSettings.monitoredFolders.forEach(f => {
                    if (f.isActive) pathsToWatch.push(f.path);
                });
            }

            if (currentSettings.invokeAiPath) {
                let invokeRoot = currentSettings.invokeAiPath.replace(/\\/g, '/').replace(/\/$/, '');

                // Handle cases where user selected the DB file or databases folder
                if (invokeRoot.toLowerCase().endsWith('.db')) {
                    invokeRoot = invokeRoot.replace(/\/[\w-]+\.db$/i, ''); // Strip filename
                    invokeRoot = invokeRoot.replace(/\/databases$/i, '');   // Strip databases folder if present
                } else if (invokeRoot.toLowerCase().endsWith('/databases')) {
                    invokeRoot = invokeRoot.replace(/\/databases$/i, '');
                }

                pathsToWatch.push(`${invokeRoot}/outputs/images`);
            }

            if (pathsToWatch.length === 0) {
                await watcherService.stopWatching();
                return;
            }

            // Ref for debouncing watcher events
            const debounceTimer = { current: null as NodeJS.Timeout | null };

            await watcherService.startWatching(pathsToWatch, async () => {
                console.log('[WatcherContext] Global change detected - scheduling sync...');

                // Trailing debounce: Clear existing timer and set a new one
                if (debounceTimer.current) {
                    clearTimeout(debounceTimer.current);
                }

                debounceTimer.current = setTimeout(async () => {
                    console.log('[WatcherContext] Debounce complete - triggering sync');
                    const cb = callbacksRef.current;

                    if (cb.onNewImageDetected) cb.onNewImageDetected();
                    await cb.refreshMaintenanceCounts();

                    if (cb.settings.invokeAiPath) {
                        await cb.startInvokeSync({ mode: 'live' });
                    }

                    // Signal consumers (like useFolderMonitor) that a change occurred
                    setLastWatcherEvent(Date.now());

                    debounceTimer.current = null;
                }, 3000); // 3 seconds silence required
            });

            if (pathsToWatch.length > 0) {
                // Immediate Catch-up Scan
                if (currentSettings.invokeAiPath) {
                    console.log('[WatcherContext] Triggering catch-up sync for InvokeAI...');
                    callbacksRef.current.startInvokeSync({ mode: 'live' });
                }
            }
        };

        // Debounce initialization
        const timer = setTimeout(initWatcher, 500);
        return () => clearTimeout(timer);

    }, [isLoaded, isLiveWatching, monitoredFoldersConfig, invokePathConfig, addToast]);

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
            maintenanceCounts,
            lastWatcherEvent
        }}>
            {children}
        </WatcherContext.Provider>
    );
};

export const useWatchers = () => {
    const context = useContext(WatcherContext);
    if (!context) {
        throw new Error('useWatchers must be used within a WatcherProvider');
    }
    return context;
};
