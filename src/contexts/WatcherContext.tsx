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
    const { startInvokeSync, startTargetedLiveSync } = useSync();
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
    const callbacksRef = useRef({ onNewImageDetected, refreshMaintenanceCounts, startInvokeSync, settings, startTargetedLiveSync });
    const invokeSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        callbacksRef.current = { onNewImageDetected, refreshMaintenanceCounts, startInvokeSync, settings, startTargetedLiveSync };
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

                pathsToWatch.push(`${invokeRoot}/databases`);
            }

            if (pathsToWatch.length === 0) {
                await watcherService.stopWatching();
                return;
            }

            await watcherService.startWatching(pathsToWatch, async (paths?: string[]) => {
                if (!paths || paths.length === 0) return;
                console.log(`[WatcherContext] Targeted change detected for ${paths.length} files`);
                
                const cb = callbacksRef.current;
                
                // Reconstruct the actual active invoke string directory locally
                const activeInvokeRoot = (() => {
                    if (!cb.settings.invokeAiPath) return null;
                    let root = cb.settings.invokeAiPath.replace(/\\/g, '/').replace(/\/$/, '');
                    if (root.toLowerCase().endsWith('.db')) {
                        root = root.replace(/\/[\w-]+\.db$/i, '');
                        root = root.replace(/\/databases$/i, '');
                    } else if (root.toLowerCase().endsWith('/databases')) {
                        root = root.replace(/\/databases$/i, '');
                    }
                    return `${root}/databases`.toLowerCase();
                })();

                const invokePaths: string[] = [];
                const genericPaths: string[] = [];

                paths.forEach(p => {
                    const normalized = p.replace(/\\/g, '/').toLowerCase();
                    if (activeInvokeRoot && normalized.startsWith(activeInvokeRoot)) {
                        // We only care about .db or .db-wal files in the Invoke database folder
                        if (normalized.endsWith('.db') || normalized.endsWith('.db-wal')) {
                            invokePaths.push(p);
                        }
                    } else {
                        genericPaths.push(p);
                    }
                });

                // Use O(1) targeted import strictly for non-Invoke generic folder drops
                if (genericPaths.length > 0) {
                    if (cb.startTargetedLiveSync) {
                        await cb.startTargetedLiveSync(genericPaths);
                    }
                    if (cb.onNewImageDetected) cb.onNewImageDetected();
                    await cb.refreshMaintenanceCounts();
                }

                // Signal consumers (like useFolderMonitor) that a change occurred
                setLastWatcherEvent(Date.now());

                // Immediately Trigger full InvokeAI SQLite Sync evaluation if an Invoke local path dropped
                if (invokePaths.length > 0 && cb.settings.invokeAiPath) {
                    console.log(`[WatcherContext] Activity detected in InvokeAI database. Debouncing sync...`);
                    
                    if (invokeSyncTimeoutRef.current) {
                        clearTimeout(invokeSyncTimeoutRef.current);
                    }
                    
                    invokeSyncTimeoutRef.current = setTimeout(() => {
                        console.log(`[WatcherContext] Triggering SQLite-driven sync for InvokeAI via Live Watch...`);
                        cb.startInvokeSync({ mode: 'live' });
                        invokeSyncTimeoutRef.current = null;
                    }, 1000);
                }
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
