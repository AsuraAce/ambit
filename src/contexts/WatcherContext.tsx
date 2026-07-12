import * as React from 'react';
import { createContext, useContext, useEffect, useRef, ReactNode, useCallback } from 'react';
import { useSettings } from './SettingsContext';
import { useSync } from './SyncContext';
import { watcherService } from '../services/WatcherService';
import { getMaintenanceCounts } from '../services/db/maintenanceRepo';
import { useLibraryStore } from '../stores/libraryStore';
import { normalizeInvokeRoot } from '../utils/pathUtils';
import {
    createLiveWatchPerfId,
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    InvokeLiveWatchPerfContext,
    liveWatchNow,
    TargetedLiveSyncPerfContext,
} from '../utils/liveWatchPerf';

interface WatcherContextType {
    isLiveWatching: boolean;
    setIsLiveWatching: React.Dispatch<React.SetStateAction<boolean>>;
    refreshMaintenanceCounts: () => Promise<void>;
    maintenanceCounts: { untagged: number; orphans: number; intermediates: number; missing: number; trash: number; duplicates: number };
    lastWatcherEvent: number;
}

const WatcherContext = createContext<WatcherContextType | undefined>(undefined);

const WATCHER_INIT_DEBOUNCE_MS = 500;
const INVOKE_LIVE_DEBOUNCE_MS = 500;

const mergeTargetedPerfContext = (
    current: TargetedLiveSyncPerfContext | null,
    pathCount: number,
    receivedAt: number
): TargetedLiveSyncPerfContext => {
    if (!current) {
        return {
            cycleId: createLiveWatchPerfId('generic-live'),
            source: 'generic-folder-watch',
            firstEventAt: receivedAt,
            lastEventAt: receivedAt,
            eventCount: 1,
            pathCount,
            mergedCycleCount: 1
        };
    }

    return {
        ...current,
        lastEventAt: receivedAt,
        eventCount: current.eventCount + 1,
        pathCount: current.pathCount + pathCount,
        mergedCycleCount: current.mergedCycleCount
    };
};

const mergeInvokePerfContext = (
    current: InvokeLiveWatchPerfContext | null,
    pathCount: number,
    receivedAt: number
): InvokeLiveWatchPerfContext => {
    if (!current) {
        return {
            cycleId: createLiveWatchPerfId('invoke-live'),
            firstEventAt: receivedAt,
            lastEventAt: receivedAt,
            eventCount: 1,
            pathCount,
            debounceScheduledAt: receivedAt,
            debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS,
            debounceFireDelayMs: 0,
            mergedCycleCount: 1
        };
    }

    return {
        ...current,
        lastEventAt: receivedAt,
        eventCount: current.eventCount + 1,
        pathCount: current.pathCount + pathCount,
        mergedCycleCount: current.mergedCycleCount
    };
};

export const WatcherProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { settings, isLoaded } = useSettings();
    const { startInvokeSync, startTargetedLiveSync, syncStatus } = useSync();

    // Zustand State
    const isLiveWatching = useLibraryStore(s => s.isLiveWatching);
    const setIsLiveWatching = useLibraryStore(s => s.setIsLiveWatching);
    const [lastWatcherEvent, setLastWatcherEvent] = React.useState<number>(0);
    const maintenanceCounts = useLibraryStore(s => s.maintenanceCounts);
    const setMaintenanceCounts = useLibraryStore(s => s.setMaintenanceCounts);
    const startLiveWatchSession = useLibraryStore(s => s.startLiveWatchSession);

    const setIsLiveWatchingDispatch = useCallback((value: React.SetStateAction<boolean>) => {
        const nextIsLiveWatching = typeof value === 'function'
            ? value(isLiveWatching)
            : value;
        setIsLiveWatching(nextIsLiveWatching);
    }, [isLiveWatching, setIsLiveWatching]);

    const refreshMaintenanceCounts = useCallback(async () => {
        if (!isLoaded) return;
        try {
            const counts = await getMaintenanceCounts();
            setMaintenanceCounts(counts);
        } catch (e) {
            console.error("Failed to refresh maintenance counts", e);
        }
    }, [isLoaded, setMaintenanceCounts]);

    // Unified Watcher Logic (Live Sync)
    const monitoredFoldersConfig = React.useMemo(() => JSON.stringify(
        (settings.monitoredFolders || []).map(folder => ({
            path: folder.path,
            isActive: folder.isActive
        }))
    ), [settings.monitoredFolders]);
    const invokePathConfig = settings.invokeAiPath;

    // Stable ref for callbacks to avoid restarting watcher on every render
    const callbacksRef = useRef({ refreshMaintenanceCounts, startInvokeSync, settings, startTargetedLiveSync, syncStatus });
    const invokeSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingGenericPathsRef = useRef<Set<string>>(new Set());
    const pendingGenericPerfRef = useRef<TargetedLiveSyncPerfContext | null>(null);
    const pendingInvokePerfRef = useRef<InvokeLiveWatchPerfContext | null>(null);
    const genericLiveDrainPromiseRef = useRef<Promise<void> | null>(null);
    const invokeActivationCatchupRootRef = useRef<string | null>(null);

    useEffect(() => {
        callbacksRef.current = { refreshMaintenanceCounts, startInvokeSync, settings, startTargetedLiveSync, syncStatus };
    });

    const drainGenericLiveChanges = useCallback(async (paths: string[]) => {
        paths
            .map(path => path.replace(/\\/g, '/'))
            .forEach(path => pendingGenericPathsRef.current.add(path));

        const pendingPathCount = pendingGenericPathsRef.current.size;

        if (genericLiveDrainPromiseRef.current) {
            debugLiveWatchPerf('Generic live paths merged into active queue', {
                cycleId: pendingGenericPerfRef.current!.cycleId,
                pendingPathCount,
                eventCount: pendingGenericPerfRef.current!.eventCount,
                mergedCycleCount: pendingGenericPerfRef.current!.mergedCycleCount
            });
            return genericLiveDrainPromiseRef.current;
        }

        const drainPromise = (async () => {
            while (pendingGenericPathsRef.current.size > 0) {
                const perfContext = pendingGenericPerfRef.current!;
                const nextBatch = Array.from(pendingGenericPathsRef.current);
                pendingGenericPathsRef.current.clear();
                pendingGenericPerfRef.current = null;
                const cycleStartAt = liveWatchNow();

                debugLiveWatchPerf('Generic live sync started', {
                    cycleId: perfContext.cycleId,
                    batchPathCount: nextBatch.length,
                    eventCount: perfContext.eventCount,
                    mergedCycleCount: perfContext.mergedCycleCount,
                    watcherToImportStartMs: elapsedMs(perfContext.firstEventAt)
                });

                const cb = callbacksRef.current;
                const liveResult = await cb.startTargetedLiveSync(
                    nextBatch,
                    { ...perfContext, queueDepthAtStart: nextBatch.length }
                );

                if (liveResult.handledPaths.length > 0) {
                    await cb.refreshMaintenanceCounts();
                }

                infoLiveWatchPerf('Generic live cycle complete', {
                    cycleId: perfContext.cycleId,
                    batchPathCount: nextBatch.length,
                    handledPathCount: liveResult.handledPaths.length,
                    failedPathCount: liveResult.failedPaths.length,
                    importedCount: liveResult.importedCount,
                    cycleMs: elapsedMs(cycleStartAt),
                    watcherToFinishMs: elapsedMs(perfContext.firstEventAt)
                });
            }
        })();

        genericLiveDrainPromiseRef.current = drainPromise.finally(() => {
            genericLiveDrainPromiseRef.current = null;
        });

        return genericLiveDrainPromiseRef.current;
    }, []);

    useEffect(() => {
        if (!isLoaded) return;
        if (!isLiveWatching) {
            invokeActivationCatchupRootRef.current = null;
        }

        const initWatcher = async () => {
            if (!isLiveWatching) {
                await watcherService.stopWatching();
                return;
            }

            const currentSettings = callbacksRef.current.settings;
            const pathsToWatch: string[] = [];
            const activeInvokeRoot = normalizeInvokeRoot(currentSettings.invokeAiPath);

            if (currentSettings.monitoredFolders) {
                currentSettings.monitoredFolders.forEach(f => {
                    if (f.isActive) pathsToWatch.push(f.path);
                });
            }

            if (activeInvokeRoot) {
                pathsToWatch.push(`${activeInvokeRoot}/databases`);
            } else {
                invokeActivationCatchupRootRef.current = null;
            }

            if (pathsToWatch.length === 0) {
                await watcherService.stopWatching();
                return;
            }

            await watcherService.startWatching(pathsToWatch, async (paths?: string[]) => {
                if (!paths || paths.length === 0) return;
                const eventReceivedAt = liveWatchNow();
                debugLiveWatchPerf('folder-change-event received', {
                    pathCount: paths.length
                });
                
                const cb = callbacksRef.current;
                
                // Reconstruct the actual active invoke string directory locally
                const activeInvokeRoot = (() => {
                    const root = normalizeInvokeRoot(cb.settings.invokeAiPath);
                    return root ? `${root}/databases`.toLowerCase() : null;
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

                debugLiveWatchPerf('folder-change-event split', {
                    totalPathCount: paths.length,
                    genericPathCount: genericPaths.length,
                    invokePathCount: invokePaths.length
                });

                // Use O(1) targeted import strictly for non-Invoke generic folder drops
                if (genericPaths.length > 0) {
                    startLiveWatchSession('generic', {
                        phase: 'watching',
                        message: 'Checking monitored folders...'
                    });
                    pendingGenericPerfRef.current = mergeTargetedPerfContext(
                        pendingGenericPerfRef.current,
                        genericPaths.length,
                        eventReceivedAt
                    );
                    debugLiveWatchPerf('Generic live activity detected', {
                        cycleId: pendingGenericPerfRef.current.cycleId,
                        receivedPathCount: genericPaths.length,
                        eventCount: pendingGenericPerfRef.current.eventCount,
                        pathCount: pendingGenericPerfRef.current.pathCount
                    });
                    void drainGenericLiveChanges(genericPaths);
                }

                // Signal consumers (like useFolderMonitor) that a change occurred
                setLastWatcherEvent(Date.now());

                // Immediately Trigger full InvokeAI SQLite Sync evaluation if an Invoke local path dropped
                if (invokePaths.length > 0 && cb.settings.invokeAiPath) {
                    startLiveWatchSession('invoke', {
                        phase: 'watching',
                        message: 'Checking InvokeAI for completed images...'
                    });
                    pendingInvokePerfRef.current = mergeInvokePerfContext(
                        pendingInvokePerfRef.current,
                        invokePaths.length,
                        eventReceivedAt
                    );
                    debugLiveWatchPerf('Invoke DB activity detected', {
                        cycleId: pendingInvokePerfRef.current.cycleId,
                        receivedPathCount: invokePaths.length,
                        eventCount: pendingInvokePerfRef.current.eventCount,
                        pathCount: pendingInvokePerfRef.current.pathCount
                    });
                    
                    if (invokeSyncTimeoutRef.current) {
                        clearTimeout(invokeSyncTimeoutRef.current);
                        debugLiveWatchPerf('Invoke debounce rescheduled', {
                            cycleId: pendingInvokePerfRef.current.cycleId,
                            debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS
                        });
                    }

                    pendingInvokePerfRef.current = {
                        ...pendingInvokePerfRef.current,
                        debounceScheduledAt: liveWatchNow(),
                        debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS
                    };
                    debugLiveWatchPerf('Invoke sync scheduled', {
                        cycleId: pendingInvokePerfRef.current.cycleId,
                        eventCount: pendingInvokePerfRef.current.eventCount,
                        pathCount: pendingInvokePerfRef.current.pathCount,
                        debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS
                    });
                    invokeSyncTimeoutRef.current = setTimeout(() => {
                        invokeSyncTimeoutRef.current = null;
                        const perfContext = pendingInvokePerfRef.current;
                        pendingInvokePerfRef.current = null;
                        const firedAt = liveWatchNow();
                        const resolvedPerfContext: InvokeLiveWatchPerfContext = {
                            ...perfContext!,
                            debounceFireDelayMs: Math.round(firedAt - perfContext!.debounceScheduledAt),
                            debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS
                        };

                        debugLiveWatchPerf('Invoke debounce fired', {
                            cycleId: resolvedPerfContext.cycleId,
                            eventCount: resolvedPerfContext.eventCount,
                            pathCount: resolvedPerfContext.pathCount,
                            debounceFireDelayMs: resolvedPerfContext.debounceFireDelayMs,
                            watcherToSyncStartMs: Math.round(firedAt - resolvedPerfContext.firstEventAt)
                        });
                        void cb.startInvokeSync({ mode: 'live', perfContext: resolvedPerfContext });
                        invokeSyncTimeoutRef.current = null;
                    }, INVOKE_LIVE_DEBOUNCE_MS);
                }
            });

            debugLiveWatchPerf('Native watcher initialized', {
                watchedPathCount: pathsToWatch.length,
                invokeDebounceMs: INVOKE_LIVE_DEBOUNCE_MS
            });

            if (activeInvokeRoot) {
                const activationKey = activeInvokeRoot.toLowerCase();
                const cb = callbacksRef.current;

                if (invokeActivationCatchupRootRef.current !== activationKey) {
                    invokeActivationCatchupRootRef.current = activationKey;

                    if (cb.syncStatus === 'syncing') {
                        debugLiveWatchPerf('Invoke activation catch-up skipped', {
                            reason: 'sync-already-active',
                            root: activeInvokeRoot
                        });
                    } else {
                        debugLiveWatchPerf('Invoke activation catch-up started', {
                            root: activeInvokeRoot
                        });
                        void cb.startInvokeSync({ mode: 'live' });
                    }
                }
            }

        };

        // Debounce initialization
        const timer = setTimeout(initWatcher, WATCHER_INIT_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            if (invokeSyncTimeoutRef.current) {
                const shouldDrainPendingInvoke = (
                    useLibraryStore.getState().liveWatchSessionCloseRequested
                    && pendingInvokePerfRef.current !== null
                );

                if (!shouldDrainPendingInvoke) {
                    clearTimeout(invokeSyncTimeoutRef.current);
                    invokeSyncTimeoutRef.current = null;
                }
            }
        };

    }, [isLoaded, isLiveWatching, monitoredFoldersConfig, invokePathConfig, drainGenericLiveChanges, startLiveWatchSession]);

    return (
        <WatcherContext.Provider value={{
            isLiveWatching,
            setIsLiveWatching: setIsLiveWatchingDispatch,
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
