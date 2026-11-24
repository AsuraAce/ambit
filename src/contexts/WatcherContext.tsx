import * as React from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, ReactNode, useCallback } from 'react';
import { useSettings } from './SettingsContext';
import { useSync } from './SyncContext';
import { watcherService } from '../services/WatcherService';
import { getMaintenanceCounts } from '../services/db/maintenanceRepo';
import { markImagePathIdentitiesMissing, moveImagePathIdentities } from '../services/db/imageRepo';
import { useLibraryStore } from '../stores/libraryStore';
import { normalizeInvokeRoot } from '../utils/pathUtils';
import { filterAccessibleFolders } from '../services/assetScope';
import { useSearch } from './SearchContext';
import type { FolderChange } from '../bindings';
import {
    createLiveWatchPerfId,
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    InvokeLiveWatchPerfContext,
    liveWatchNow,
    TargetedLiveSyncPerfContext,
} from '../utils/liveWatchPerf';
import { logLiveWatchFailure } from '../utils/liveWatchFailureLog';
import type { TargetedLiveSyncResult } from './SyncContext';

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
// A Live Watch path whose import failed (for example "database is locked" while a background job
// holds SQLite's write lock) is sent again after each of these delays, about 60 s in all (#547).
// After the last one it is left for the next folder catch-up, which still lists it: a Live Watch
// import never moves the folder cursor (#594).
const LIVE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

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
            mergedCycleCount: 1,
        };
    }

    return {
        ...current,
        lastEventAt: receivedAt,
        eventCount: current.eventCount + 1,
        pathCount: current.pathCount + pathCount,
        mergedCycleCount: current.mergedCycleCount,
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
            mergedCycleCount: 1,
        };
    }

    return {
        ...current,
        lastEventAt: receivedAt,
        eventCount: current.eventCount + 1,
        pathCount: current.pathCount + pathCount,
        mergedCycleCount: current.mergedCycleCount,
    };
};

export const WatcherProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { settings, isLoaded } = useSettings();
    const { startInvokeSync, startTargetedLiveSync, syncStatus } = useSync();
    const { refreshMetadata } = useSearch();

    // Zustand State
    const isLiveWatching = useLibraryStore((s) => s.isLiveWatching);
    const setIsLiveWatching = useLibraryStore((s) => s.setIsLiveWatching);
    const [lastWatcherEvent, setLastWatcherEvent] = React.useState<number>(0);
    const maintenanceCounts = useLibraryStore((s) => s.maintenanceCounts);
    const setMaintenanceCounts = useLibraryStore((s) => s.setMaintenanceCounts);
    const startLiveWatchSession = useLibraryStore((s) => s.startLiveWatchSession);

    const setIsLiveWatchingDispatch = useCallback(
        (value: React.SetStateAction<boolean>) => {
            const nextIsLiveWatching = typeof value === 'function' ? value(isLiveWatching) : value;
            setIsLiveWatching(nextIsLiveWatching);
        },
        [isLiveWatching, setIsLiveWatching]
    );

    const refreshMaintenanceCounts = useCallback(async () => {
        if (!isLoaded) return;
        try {
            const counts = await getMaintenanceCounts();
            setMaintenanceCounts(counts);
        } catch (e) {
            console.error('Failed to refresh maintenance counts', e);
        }
    }, [isLoaded, setMaintenanceCounts]);

    // Unified Watcher Logic (Live Sync)
    const monitoredFoldersConfig = React.useMemo(
        () =>
            JSON.stringify(
                (settings.monitoredFolders || []).map((folder) => ({
                    path: folder.path,
                    isActive: folder.isActive,
                }))
            ),
        [settings.monitoredFolders]
    );
    const invokePathConfig = settings.invokeAiPath;

    // Stable ref for callbacks to avoid restarting watcher on every render
    const callbacksRef = useRef({
        refreshMaintenanceCounts,
        refreshMetadata,
        startInvokeSync,
        settings,
        startTargetedLiveSync,
        syncStatus,
    });
    const invokeSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingGenericPathsRef = useRef<Set<string>>(new Set());
    const pendingGenericPerfRef = useRef<TargetedLiveSyncPerfContext | null>(null);
    const pendingInvokePerfRef = useRef<InvokeLiveWatchPerfContext | null>(null);
    const genericLiveDrainPromiseRef = useRef<Promise<void> | null>(null);
    // Failed attempts so far for each path waiting on a retry, the batch being imported now, the
    // pending retry timers, and a generation that turning Live Watch off advances so an old timer
    // never fires into a later session.
    const liveRetryFailuresRef = useRef<Map<string, number>>(new Map());
    const genericInFlightPathsRef = useRef<Set<string>>(new Set());
    const liveRetryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const liveRetryGenerationRef = useRef(0);
    const invokeActivationCatchupRootRef = useRef<string | null>(null);

    const clearLiveRetries = useCallback(() => {
        liveRetryGenerationRef.current += 1;
        liveRetryTimersRef.current.forEach((timer) => clearTimeout(timer));
        liveRetryTimersRef.current.clear();
        liveRetryFailuresRef.current.clear();
    }, []);

    useEffect(() => clearLiveRetries, [clearLiveRetries]);

    useEffect(() => {
        callbacksRef.current = { refreshMaintenanceCounts, refreshMetadata, startInvokeSync, settings, startTargetedLiveSync, syncStatus };
    });

    useEffect(
        () =>
            useLibraryStore.subscribe((state, previous) => {
                if (state.invokeSyncCancellationGeneration === previous.invokeSyncCancellationGeneration) return;
                if (invokeSyncTimeoutRef.current) {
                    clearTimeout(invokeSyncTimeoutRef.current);
                    invokeSyncTimeoutRef.current = null;
                }
                pendingInvokePerfRef.current = null;
            }),
        []
    );

    // Built once: the drain schedules retries, and a retry re-enters the same drain.
    const drainGenericLiveChanges = useMemo(() => {
        // Each failed path goes back through this queue after a delay, so a retry is serialized
        // with fresh watcher events and deduplicated by the pending set (#547).
        const scheduleLiveRetries = (result: TargetedLiveSyncResult) => {
            const handled = new Set(result.handledPaths);
            const failed = Array.from(new Set(result.failedPaths)).filter((path) => !handled.has(path));
            if (failed.length === 0) return;

            const liveWatchOn = useLibraryStore.getState().isLiveWatching;
            const retryByDelay = new Map<number, Map<string, number>>();
            let leftForCatchUpCount = 0;
            let nextAttempt = 0;
            let retryInMs = 0;

            failed.forEach((path) => {
                const failures = (liveRetryFailuresRef.current.get(path) ?? 0) + 1;
                if (!liveWatchOn || failures > LIVE_RETRY_DELAYS_MS.length) {
                    liveRetryFailuresRef.current.delete(path);
                    leftForCatchUpCount += 1;
                    return;
                }
                liveRetryFailuresRef.current.set(path, failures);
                const delay = LIVE_RETRY_DELAYS_MS[failures - 1];
                const group = retryByDelay.get(delay) ?? new Map<string, number>();
                group.set(path, failures);
                retryByDelay.set(delay, group);
                nextAttempt = Math.max(nextAttempt, failures);
                retryInMs = Math.max(retryInMs, delay);
            });

            logLiveWatchFailure({
                failedCount: failed.length,
                retryCount: failed.length - leftForCatchUpCount,
                leftForCatchUpCount,
                nextAttempt,
                maxAttempts: LIVE_RETRY_DELAYS_MS.length,
                retryInMs,
                reason: result.failureReason,
            });

            const generation = liveRetryGenerationRef.current;
            retryByDelay.forEach((expectedFailures, delay) => {
                const timer = setTimeout(() => {
                    liveRetryTimersRef.current.delete(timer);
                    if (generation !== liveRetryGenerationRef.current) return;
                    // Skip a path that a later cycle imported, failed again (it has a newer timer),
                    // or is importing right now (that result decides).
                    const due = Array.from(expectedFailures)
                        .filter(([path, failures]) => liveRetryFailuresRef.current.get(path) === failures)
                        .filter(([path]) => !genericInFlightPathsRef.current.has(path))
                        .map(([path]) => path);
                    if (due.length === 0) return;
                    debugLiveWatchPerf('Generic live retry queued', { pathCount: due.length, delayMs: delay });
                    pendingGenericPerfRef.current = mergeTargetedPerfContext(pendingGenericPerfRef.current, due.length, liveWatchNow());
                    void drain(due);
                }, delay);
                liveRetryTimersRef.current.add(timer);
            });
        };

        const drain = async (paths: string[]): Promise<void> => {
            paths.map((path) => path.replace(/\\/g, '/')).forEach((path) => pendingGenericPathsRef.current.add(path));

            const pendingPathCount = pendingGenericPathsRef.current.size;

            if (genericLiveDrainPromiseRef.current) {
                debugLiveWatchPerf('Generic live paths merged into active queue', {
                    cycleId: pendingGenericPerfRef.current!.cycleId,
                    pendingPathCount,
                    eventCount: pendingGenericPerfRef.current!.eventCount,
                    mergedCycleCount: pendingGenericPerfRef.current!.mergedCycleCount,
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
                        watcherToImportStartMs: elapsedMs(perfContext.firstEventAt),
                    });

                    const cb = callbacksRef.current;
                    genericInFlightPathsRef.current = new Set(nextBatch);
                    let liveResult: TargetedLiveSyncResult;
                    try {
                        liveResult = await cb.startTargetedLiveSync(nextBatch, { ...perfContext, queueDepthAtStart: nextBatch.length });
                    } catch (error) {
                        // The batch already left the pending set, so a rejection would lose it.
                        console.error('[LiveSync] Generic live sync rejected', error);
                        liveResult = { handledPaths: [], failedPaths: nextBatch, importedCount: 0, failureReason: String(error) };
                    } finally {
                        genericInFlightPathsRef.current = new Set();
                    }

                    liveResult.handledPaths.forEach((path) => liveRetryFailuresRef.current.delete(path));
                    scheduleLiveRetries(liveResult);

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
                        watcherToFinishMs: elapsedMs(perfContext.firstEventAt),
                    });
                }
            })();

            genericLiveDrainPromiseRef.current = drainPromise.finally(() => {
                genericLiveDrainPromiseRef.current = null;
            });

            return genericLiveDrainPromiseRef.current;
        };

        return drain;
    }, []);

    useEffect(() => {
        if (!isLoaded) return;
        if (!isLiveWatching) {
            invokeActivationCatchupRootRef.current = null;
            // The next turn-on catch-up owes these files (#594), so pending retries end here.
            clearLiveRetries();
        }
        const activationCancellationGeneration = useLibraryStore.getState().invokeSyncCancellationGeneration;
        let initCancelled = false;

        const initWatcher = async () => {
            if (!isLiveWatching) {
                await watcherService.stopWatching();
                return;
            }

            const currentSettings = callbacksRef.current.settings;
            const pathsToWatch: string[] = [];
            const activeInvokeRoot = normalizeInvokeRoot(currentSettings.invokeAiPath);

            if (currentSettings.monitoredFolders) {
                currentSettings.monitoredFolders.forEach((f) => {
                    if (f.isActive) pathsToWatch.push(f.path);
                });
            }

            if (activeInvokeRoot) {
                pathsToWatch.push(`${activeInvokeRoot}/databases`);
            } else {
                invokeActivationCatchupRootRef.current = null;
            }

            // The watcher refuses paths outside the scope. A path that cannot be
            // registered is missing, and the watcher skipped missing paths anyway.
            const watchablePaths = await filterAccessibleFolders(pathsToWatch);
            // A newer run of this effect owns the watcher once this one is cleaned up.
            if (initCancelled) return;

            if (watchablePaths.length === 0) {
                await watcherService.stopWatching();
                return;
            }

            await watcherService.startWatching(watchablePaths, async (changes?: FolderChange[]) => {
                if (!changes || changes.length === 0) return;
                const eventCancellationGeneration = useLibraryStore.getState().invokeSyncCancellationGeneration;
                const eventReceivedAt = liveWatchNow();
                const pathCount = changes.reduce((total, change) => total + change.paths.length, 0);
                debugLiveWatchPerf('folder-change-event received', {
                    changeCount: changes.length,
                    pathCount,
                });

                const cb = callbacksRef.current;

                // Reconstruct the actual active invoke string directory locally
                const activeInvokeRoot = (() => {
                    const root = normalizeInvokeRoot(cb.settings.invokeAiPath);
                    return root ? `${root}/databases`.toLowerCase() : null;
                })();

                const invokePaths: string[] = [];
                const genericChanges: FolderChange[] = [];

                changes.forEach((change) => {
                    const genericPaths: string[] = [];
                    change.paths.forEach((path) => {
                        const normalized = path.replace(/\\/g, '/').toLowerCase();
                        if (activeInvokeRoot && normalized.startsWith(activeInvokeRoot)) {
                            if (normalized.endsWith('.db') || normalized.endsWith('.db-wal')) {
                                invokePaths.push(path);
                            }
                        } else {
                            genericPaths.push(path);
                        }
                    });
                    if (genericPaths.length > 0) {
                        genericChanges.push({ ...change, paths: genericPaths });
                    }
                });

                const genericImportPaths: string[] = [];
                const missingPaths: string[] = [];
                const identityMoves: Array<{ oldId: string; newId: string }> = [];

                genericChanges.forEach((change) => {
                    if (change.kind === 'rename' && change.paths.length >= 2) {
                        const oldId = change.paths[0].replace(/\\/g, '/');
                        const newId = change.paths[change.paths.length - 1].replace(/\\/g, '/');
                        identityMoves.push({ oldId, newId });
                        missingPaths.push(oldId);
                        genericImportPaths.push(newId);
                    } else if (change.kind === 'remove') {
                        missingPaths.push(...change.paths);
                    } else {
                        genericImportPaths.push(...change.paths);
                    }
                });

                debugLiveWatchPerf('folder-change-event split', {
                    totalPathCount: pathCount,
                    genericPathCount: genericChanges.reduce((total, change) => total + change.paths.length, 0),
                    genericImportPathCount: genericImportPaths.length,
                    missingPathCount: missingPaths.length,
                    renameCount: identityMoves.length,
                    invokePathCount: invokePaths.length,
                });

                if (identityMoves.length > 0 || missingPaths.length > 0) {
                    try {
                        if (identityMoves.length > 0) {
                            await moveImagePathIdentities(identityMoves);
                        }
                        const uniqueMissingPaths = Array.from(new Set(missingPaths.map((path) => path.replace(/\\/g, '/'))));
                        const markedMissing = await markImagePathIdentitiesMissing(uniqueMissingPaths);
                        if (identityMoves.length > 0 || markedMissing > 0) {
                            await cb.refreshMetadata();
                            await cb.refreshMaintenanceCounts();
                        }
                    } catch (error) {
                        console.error('[Watcher] Failed to apply rename/remove changes', error);
                    }
                }

                // Use O(1) targeted import strictly for non-Invoke generic folder drops
                if (genericImportPaths.length > 0) {
                    startLiveWatchSession('generic', {
                        phase: 'watching',
                        message: 'Checking monitored folders...',
                    });
                    pendingGenericPerfRef.current = mergeTargetedPerfContext(
                        pendingGenericPerfRef.current,
                        genericImportPaths.length,
                        eventReceivedAt
                    );
                    debugLiveWatchPerf('Generic live activity detected', {
                        cycleId: pendingGenericPerfRef.current.cycleId,
                        receivedPathCount: genericImportPaths.length,
                        eventCount: pendingGenericPerfRef.current.eventCount,
                        pathCount: pendingGenericPerfRef.current.pathCount,
                    });
                    void drainGenericLiveChanges(genericImportPaths);
                }

                // Signal consumers (like useFolderMonitor) that a change occurred
                setLastWatcherEvent(Date.now());

                // Immediately Trigger full InvokeAI SQLite Sync evaluation if an Invoke local path dropped
                if (
                    invokePaths.length > 0 &&
                    cb.settings.invokeAiPath &&
                    eventCancellationGeneration === useLibraryStore.getState().invokeSyncCancellationGeneration
                ) {
                    startLiveWatchSession('invoke', {
                        phase: 'watching',
                        message: 'Checking InvokeAI for completed images...',
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
                        pathCount: pendingInvokePerfRef.current.pathCount,
                    });

                    if (invokeSyncTimeoutRef.current) {
                        clearTimeout(invokeSyncTimeoutRef.current);
                        debugLiveWatchPerf('Invoke debounce rescheduled', {
                            cycleId: pendingInvokePerfRef.current.cycleId,
                            debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS,
                        });
                    }

                    pendingInvokePerfRef.current = {
                        ...pendingInvokePerfRef.current,
                        debounceScheduledAt: liveWatchNow(),
                        debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS,
                    };
                    debugLiveWatchPerf('Invoke sync scheduled', {
                        cycleId: pendingInvokePerfRef.current.cycleId,
                        eventCount: pendingInvokePerfRef.current.eventCount,
                        pathCount: pendingInvokePerfRef.current.pathCount,
                        debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS,
                    });
                    invokeSyncTimeoutRef.current = setTimeout(() => {
                        invokeSyncTimeoutRef.current = null;
                        if (eventCancellationGeneration !== useLibraryStore.getState().invokeSyncCancellationGeneration) return;
                        const perfContext = pendingInvokePerfRef.current;
                        pendingInvokePerfRef.current = null;
                        if (!perfContext) return;
                        const firedAt = liveWatchNow();
                        const resolvedPerfContext: InvokeLiveWatchPerfContext = {
                            ...perfContext,
                            debounceFireDelayMs: Math.round(firedAt - perfContext.debounceScheduledAt),
                            debounceDelayMs: INVOKE_LIVE_DEBOUNCE_MS,
                        };

                        debugLiveWatchPerf('Invoke debounce fired', {
                            cycleId: resolvedPerfContext.cycleId,
                            eventCount: resolvedPerfContext.eventCount,
                            pathCount: resolvedPerfContext.pathCount,
                            debounceFireDelayMs: resolvedPerfContext.debounceFireDelayMs,
                            watcherToSyncStartMs: Math.round(firedAt - resolvedPerfContext.firstEventAt),
                        });
                        void cb.startInvokeSync({ mode: 'live', perfContext: resolvedPerfContext });
                        invokeSyncTimeoutRef.current = null;
                    }, INVOKE_LIVE_DEBOUNCE_MS);
                }
            });

            debugLiveWatchPerf('Native watcher initialized', {
                watchedPathCount: pathsToWatch.length,
                invokeDebounceMs: INVOKE_LIVE_DEBOUNCE_MS,
            });

            if (activeInvokeRoot) {
                const activationKey = activeInvokeRoot.toLowerCase();
                const cb = callbacksRef.current;

                if (invokeActivationCatchupRootRef.current !== activationKey) {
                    invokeActivationCatchupRootRef.current = activationKey;

                    if (activationCancellationGeneration !== useLibraryStore.getState().invokeSyncCancellationGeneration) {
                        debugLiveWatchPerf('Invoke activation catch-up skipped', {
                            reason: 'sync-cancelled',
                            root: activeInvokeRoot,
                        });
                    } else if (cb.syncStatus === 'syncing') {
                        debugLiveWatchPerf('Invoke activation catch-up skipped', {
                            reason: 'sync-already-active',
                            root: activeInvokeRoot,
                        });
                    } else {
                        debugLiveWatchPerf('Invoke activation catch-up started', {
                            root: activeInvokeRoot,
                        });
                        void cb.startInvokeSync({ mode: 'live' });
                    }
                }
            }
        };

        // Debounce initialization
        const timer = setTimeout(() => {
            initWatcher().catch((error) => console.error('[Watcher] Failed to start live watch', error));
        }, WATCHER_INIT_DEBOUNCE_MS);
        return () => {
            initCancelled = true;
            clearTimeout(timer);
            if (invokeSyncTimeoutRef.current) {
                const shouldDrainPendingInvoke =
                    useLibraryStore.getState().liveWatchSessionCloseRequested && pendingInvokePerfRef.current !== null;

                if (!shouldDrainPendingInvoke) {
                    clearTimeout(invokeSyncTimeoutRef.current);
                    invokeSyncTimeoutRef.current = null;
                }
            }
        };
    }, [
        isLoaded,
        isLiveWatching,
        monitoredFoldersConfig,
        invokePathConfig,
        drainGenericLiveChanges,
        startLiveWatchSession,
        clearLiveRetries,
    ]);

    return (
        <WatcherContext.Provider
            value={{
                isLiveWatching,
                setIsLiveWatching: setIsLiveWatchingDispatch,
                refreshMaintenanceCounts,
                maintenanceCounts,
                lastWatcherEvent,
            }}
        >
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
