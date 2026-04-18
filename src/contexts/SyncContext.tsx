import * as React from 'react';
import { createContext, useContext, useCallback, useRef, ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { useCollections } from './CollectionContext';
import { useToast } from '../hooks/useToast';
import { getLiveWatchSummaryMessage, useLibraryStore } from '../stores/libraryStore';
import { useSearchStore } from '../stores/searchStore';
import { useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../stores/settingsStore';
import { MetadataRefreshScope } from '../types';
import {
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    InvokeLiveWatchPerfContext,
    liveWatchNow,
    TargetedLiveSyncPerfContext,
} from '../utils/liveWatchPerf';

interface StartInvokeSyncOptions {
    syncFavorites?: boolean;
    syncBoards?: boolean;
    starredAs?: 'favorite' | 'pin' | 'both' | 'none';
    mode?: 'manual' | 'startup' | 'live';
    afterTimestamp?: number | null;
    importIntermediates?: boolean;
    importOrphans?: boolean;
    perfContext?: InvokeLiveWatchPerfContext;
}

const mergePendingInvokePerfContext = (
    current: InvokeLiveWatchPerfContext | null,
    incoming?: InvokeLiveWatchPerfContext
): InvokeLiveWatchPerfContext | null => {
    if (!incoming) {
        return current;
    }

    if (!current) {
        return {
            ...incoming,
            mergedCycleCount: incoming.mergedCycleCount ?? 1
        };
    }

    return {
        ...incoming,
        cycleId: current.cycleId,
        firstEventAt: Math.min(current.firstEventAt, incoming.firstEventAt),
        lastEventAt: Math.max(current.lastEventAt, incoming.lastEventAt),
        eventCount: current.eventCount + incoming.eventCount,
        pathCount: current.pathCount + incoming.pathCount,
        mergedCycleCount: (current.mergedCycleCount ?? 1) + (incoming.mergedCycleCount ?? 1)
    };
};

const mergePendingTargetedPerfContext = (
    current: TargetedLiveSyncPerfContext | null,
    incoming?: TargetedLiveSyncPerfContext
): TargetedLiveSyncPerfContext | null => {
    if (!incoming) {
        return current;
    }

    if (!current) {
        return {
            ...incoming,
            mergedCycleCount: incoming.mergedCycleCount ?? 1
        };
    }

    return {
        ...incoming,
        cycleId: current.cycleId,
        source: current.source,
        firstEventAt: Math.min(current.firstEventAt, incoming.firstEventAt),
        lastEventAt: Math.max(current.lastEventAt, incoming.lastEventAt),
        eventCount: current.eventCount + incoming.eventCount,
        pathCount: current.pathCount + incoming.pathCount,
        mergedCycleCount: (current.mergedCycleCount ?? 1) + (incoming.mergedCycleCount ?? 1)
    };
};

interface SyncContextType {
    startInvokeSync: (options?: StartInvokeSyncOptions) => Promise<void>;
    startTargetedLiveSync: (paths: string[], perfContext?: TargetedLiveSyncPerfContext) => Promise<TargetedLiveSyncResult>;
    cancelSync: () => void;
    syncStatus: 'idle' | 'syncing' | 'complete' | 'error';
    syncState: {
        status: 'idle' | 'syncing' | 'complete' | 'error';
        progress: { current: number; total: number; message?: string };
    };
    isLiveSyncing: boolean;
    setIsLiveSyncing: (val: boolean) => void;
    cleanLibrary: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export interface TargetedLiveSyncResult {
    handledPaths: string[];
    failedPaths: string[];
    importedCount: number;
}

export const SyncProvider: React.FC<{ children: ReactNode; onSyncComplete?: (scope?: MetadataRefreshScope) => void | Promise<void> }> = ({ children, onSyncComplete }) => {
    const { settings, settingsRef, setSettings } = useSettings();
    const { setCollections } = useCollections();
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    // Zustand State
    const syncStatus = useLibraryStore(s => s.syncStatus);
    const setSyncStatus = useLibraryStore(s => s.setSyncStatus);
    // syncProgress is used internally in startInvokeSync but not exposed in Context
    const syncProgress = useLibraryStore(s => s.syncProgress);
    const setSyncProgress = useLibraryStore(s => s.setSyncProgress);
    const isLiveSyncing = useLibraryStore(s => s.isLiveSyncing);
    const setIsLiveSyncing = useLibraryStore(s => s.setIsLiveSyncing);
    const setSyncAbortController = useLibraryStore(s => s.setSyncAbortController);
    const cancelSyncAction = useLibraryStore(s => s.cancelSync);
    const startLiveWatchSession = useLibraryStore(s => s.startLiveWatchSession);
    const updateLiveWatchSession = useLibraryStore(s => s.updateLiveWatchSession);
    const reportLiveImagesReceived = useLibraryStore(s => s.reportLiveImagesReceived);

    const isLiveSyncingRef = useRef(false);
    const pendingInvokeLiveSyncRef = useRef(false);
    const pendingInvokeLivePerfRef = useRef<InvokeLiveWatchPerfContext | null>(null);
    const pendingTargetedPathsRef = useRef<Set<string>>(new Set());
    const pendingTargetedPerfRef = useRef<TargetedLiveSyncPerfContext | null>(null);
    const targetedLiveDrainPromiseRef = useRef<Promise<TargetedLiveSyncResult> | null>(null);

    const startInvokeSync = useCallback(async (optionsInput?: StartInvokeSyncOptions) => {
        const options: StartInvokeSyncOptions = {
            syncFavorites: true,
            syncBoards: true,
            starredAs: settingsRef.current.starredAs || 'favorite',
            mode: 'manual' as const,
            ...optionsInput
        };
        const syncStartedAt = liveWatchNow();
        const livePerfContext = options.mode === 'live' ? options.perfContext : undefined;
        let liveTotalProcessed = 0;
        let liveHadChanges = false;
        let liveOutcome: 'completed' | 'errored' | 'aborted' = 'completed';

        if (syncStatus === 'syncing' && (options.mode === 'manual' || options.mode === 'startup')) return;
        if ((syncStatus === 'syncing' || isLiveSyncingRef.current) && options.mode === 'live') {
            pendingInvokeLiveSyncRef.current = true;
            pendingInvokeLivePerfRef.current = mergePendingInvokePerfContext(pendingInvokeLivePerfRef.current, livePerfContext);
            debugLiveWatchPerf('Invoke live rerun queued', {
                cycleId: pendingInvokeLivePerfRef.current?.cycleId ?? livePerfContext?.cycleId,
                eventCount: pendingInvokeLivePerfRef.current?.eventCount,
                pathCount: pendingInvokeLivePerfRef.current?.pathCount,
                mergedCycleCount: pendingInvokeLivePerfRef.current?.mergedCycleCount ?? 1
            });
            return;
        }

        if (options.mode === 'live') {
            pendingInvokeLiveSyncRef.current = false;
            isLiveSyncingRef.current = true;
            setIsLiveSyncing(true);
            setSyncProgress({ current: 0, total: 0, message: undefined });
            startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'Preparing live InvokeAI sync...',
                progress: { current: 0, total: 0, message: undefined }
            });
            debugLiveWatchPerf('Invoke sync started', {
                cycleId: livePerfContext?.cycleId,
                eventCount: livePerfContext?.eventCount,
                pathCount: livePerfContext?.pathCount,
                debounceFireDelayMs: livePerfContext?.debounceFireDelayMs,
                watcherToSyncStartMs: livePerfContext ? elapsedMs(livePerfContext.firstEventAt) : undefined
            });
        } else {
            setSyncStatus('syncing');
            setSyncProgress({ current: 0, total: 0, message: options.mode === 'startup' ? 'Catching up InvokeAI DB...' : 'Preparing...' });
        }

        const ctrl = new AbortController();
        setSyncAbortController(ctrl);

        try {
            const { syncImages } = await import('../services/invoke/syncService');
            const { scanForOrphans } = await import('../services/invoke/orphanScanner');

            const effectiveTimestamp = options.afterTimestamp !== undefined ? options.afterTimestamp : settingsRef.current.lastSyncedAt;

            const { imported, updated, maxTimestamp: newTs, boardMapping, syncedIds } = await syncImages(
                settingsRef.current.invokeAiPath!,
                (c, t, msg) => {
                    if (options.mode === 'live') {
                        // Keep message undefined to prevent ActivityDock from exploding on screen
                        setSyncProgress({ current: c, total: t, message: undefined });
                        updateLiveWatchSession({
                            source: 'invoke',
                            phase: 'syncing',
                            message: msg || 'Synchronizing InvokeAI images...',
                            progress: { current: c, total: t, message: undefined }
                        });
                    } else {
                        setSyncProgress({ current: c, total: t, message: msg });
                    }
                },
                ctrl.signal,
                {
                    syncFavorites: options.syncFavorites,
                    syncBoards: options.syncBoards,
                    afterTimestamp: effectiveTimestamp,
                    importIntermediates: options.importIntermediates !== undefined ? options.importIntermediates : settingsRef.current.importIntermediates,
                    starredAs: options.starredAs,
                    perfContext: livePerfContext,
                    mode: options.mode
                }
            );

            // Sync Boards to Collections
            if (settingsRef.current.syncBoardsToCollections && boardMapping && boardMapping.size > 0) {
                if (options.mode !== 'live') {
                    setSyncProgress({ ...useLibraryStore.getState().syncProgress, message: 'Synchronizing boards...' });
                }
                // Note: setCollections is still from CollectionContext (Phase 3)
                setCollections(prev => {
                    const next = [...prev];
                    let changed = false;
                    boardMapping.forEach((data, id) => {
                        const { name, createdAt } = data;
                        const existing = next.find(c => c.id === id);
                        if (!existing) {
                            next.push({
                                id: id,
                                name: name,
                                imageIds: [],
                                count: 0,
                                createdAt: createdAt || Date.now()
                            });
                            changed = true;
                        } else if (existing.name !== name) {
                            const idx = next.indexOf(existing);
                            next[idx] = { ...existing, name };
                            changed = true;
                        }
                    });
                    return changed ? next : prev;
                });
            }

            // Orphan scanning
            let orphansImported = 0;
            const shouldImportOrphans = options.importOrphans !== undefined ? options.importOrphans : settingsRef.current.importOrphans;

            if (options.mode !== 'live' && shouldImportOrphans !== false) {
                orphansImported = await scanForOrphans(
                    settingsRef.current.invokeAiPath!,
                    syncedIds,
                    (phase, current, total) => {
                        setSyncProgress({ current, total, message: phase });
                    },
                    { importIntermediates: settingsRef.current.importIntermediates }
                );
            }

            setSyncStatus('complete');
            const totalProcessed = (imported || 0) + (updated || 0) + orphansImported;
            liveTotalProcessed = totalProcessed;
            // Conditional Facet Rebuild
            const hasChanges = (imported || 0) > 0 || (updated || 0) > 0 || orphansImported > 0;
            liveHadChanges = hasChanges;

            if (hasChanges) {
                if (options.mode === 'live') {
                    // SILENT, LENIENT ADDITION (Matches native OS logic)
                    // Advance the Live Watch Session Idle Timer and gently refresh grid
                    const reportStartedAt = liveWatchNow();
                    reportLiveImagesReceived(totalProcessed, { source: 'invoke' });
                    debugLiveWatchPerf('Live images reported to session', {
                        cycleId: livePerfContext?.cycleId,
                        totalProcessed,
                        reportMs: elapsedMs(reportStartedAt)
                    });

                    const invalidateStartedAt = liveWatchNow();
                    const invalidatePromise = queryClient.invalidateQueries({ queryKey: ['images'] });
                    debugLiveWatchPerf('Live image refresh invalidation triggered', {
                        cycleId: livePerfContext?.cycleId,
                        totalProcessed,
                        triggerMs: elapsedMs(invalidateStartedAt)
                    });
                    void invalidatePromise
                        .then(() => {
                            debugLiveWatchPerf('Live image refresh invalidation settled', {
                                cycleId: livePerfContext?.cycleId,
                                totalProcessed,
                                settleMs: elapsedMs(invalidateStartedAt)
                            });
                        })
                        .catch((invalidateError) => {
                            console.error('[Sync] Live image refresh invalidation failed', invalidateError);
                        });
                } else {
                    // MANUAL HEAVY REBUILD
                    setSyncProgress({ current: totalProcessed, total: totalProcessed, message: 'Updating gallery...' });

                    // IMMEDIATE UI REFRESH (Block here until data hits RAM)
                    await queryClient.refetchQueries({ queryKey: ['images'] });

                    // Advance cursor IMMEDIATELY so we don't scan the same files if something crashes
                    if (newTs) {
                        setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
                    }

                    setSyncProgress({ current: totalProcessed, total: totalProcessed, message: 'Rebuilding filter cache...' });

                    const { rebuildFacetCache } = await import('../services/db/imageRepo');
                    try {
                        await rebuildFacetCache();
                        useLibraryStore.getState().incrementFacetCacheVersion();
                    } catch (e) {
                        console.error('[Sync] Failed to rebuild facet cache after sync', e);
                        setSyncStatus('error');
                        return; // Halt completion if critical DB error
                    }

                    setSyncProgress({ ...useLibraryStore.getState().syncProgress, message: undefined });

                    // Trigger complete routines
                    if (totalProcessed > 0 && (options.mode === 'manual' || options.mode === 'startup')) {
                        addToast(`Synchronization complete: ${totalProcessed} items processed.`, 'success');
                    }
                    
                    if (options.mode !== 'startup') {
                        await onSyncComplete?.('full');
                    } else {
                        setSyncStatus('complete');
                    }

                    return;
                }
            } else {
                console.log('[Sync] No changes detected, skipping facet cache rebuild.');
                if (options.mode === 'live') {
                    const receivedCount = useLibraryStore.getState().liveWatchSession.receivedCount;
                    updateLiveWatchSession({
                        source: 'invoke',
                        phase: 'summary',
                        message: getLiveWatchSummaryMessage(receivedCount),
                        progress: null
                    });
                }
            }

            // Fallback for NO CHANGES scenario (hasChanges === false)
            if (newTs) {
                setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
            }

            if (onSyncComplete && options.mode !== 'live') {
                await onSyncComplete('full');
            }

            if (totalProcessed === 0 && options.mode === 'manual') {
                addToast('Synchronization complete: No new changes.', 'info');
            }

        } catch (e: any) {
            if (e.message === 'Aborted') {
                liveOutcome = 'aborted';
                setSyncStatus('idle');
            }
            else {
                liveOutcome = 'errored';
                console.error('Sync failed', e);
                setSyncStatus('error');
                if (options.mode === 'manual' || options.mode === 'startup') addToast('Sync failed: ' + e.message, 'error');
            }
        } finally {
            setSyncAbortController(null);
            if (options.mode === 'live') {
                infoLiveWatchPerf('Invoke live cycle complete', {
                    cycleId: livePerfContext?.cycleId,
                    outcome: liveOutcome,
                    totalProcessed: liveTotalProcessed,
                    hasChanges: liveHadChanges,
                    cycleMs: elapsedMs(syncStartedAt),
                    watcherToFinishMs: livePerfContext ? elapsedMs(livePerfContext.firstEventAt) : undefined,
                    queuedRerun: pendingInvokeLiveSyncRef.current
                });
                isLiveSyncingRef.current = false;
                setIsLiveSyncing(false);
                if (pendingInvokeLiveSyncRef.current) {
                    const pendingPerfContext = pendingInvokeLivePerfRef.current;
                    pendingInvokeLiveSyncRef.current = false;
                    pendingInvokeLivePerfRef.current = null;
                    debugLiveWatchPerf('Invoke live rerun starting', {
                        cycleId: pendingPerfContext?.cycleId,
                        eventCount: pendingPerfContext?.eventCount,
                        pathCount: pendingPerfContext?.pathCount,
                        mergedCycleCount: pendingPerfContext?.mergedCycleCount ?? 1
                    });
                    void startInvokeSync({ mode: 'live', perfContext: pendingPerfContext || undefined });
                }
            }
        }
    }, [syncStatus, addToast, onSyncComplete, setSettings, setCollections, setSyncStatus, setSyncProgress, setIsLiveSyncing, startLiveWatchSession, updateLiveWatchSession, reportLiveImagesReceived]);

    const startTargetedLiveSync = useCallback(async (paths: string[], perfContext?: TargetedLiveSyncPerfContext) => {
        if (!paths || paths.length === 0) {
            return { handledPaths: [], failedPaths: [], importedCount: 0 };
        }

        paths
            .map(path => path.replace(/\\/g, '/'))
            .forEach(path => pendingTargetedPathsRef.current.add(path));
        pendingTargetedPerfRef.current = mergePendingTargetedPerfContext(pendingTargetedPerfRef.current, perfContext);

        if (targetedLiveDrainPromiseRef.current) {
            debugLiveWatchPerf('Targeted live paths merged into active queue', {
                cycleId: pendingTargetedPerfRef.current?.cycleId,
                pendingPathCount: pendingTargetedPathsRef.current.size,
                eventCount: pendingTargetedPerfRef.current?.eventCount,
                mergedCycleCount: pendingTargetedPerfRef.current?.mergedCycleCount ?? 1
            });
            return targetedLiveDrainPromiseRef.current;
        }

        const drainPromise = (async (): Promise<TargetedLiveSyncResult> => {
            const handledPaths = new Set<string>();
            const failedPaths = new Set<string>();
            let importedCount = 0;

            while (pendingTargetedPathsRef.current.size > 0) {
                const cyclePerfContext = pendingTargetedPerfRef.current;
                const nextBatch = Array.from(pendingTargetedPathsRef.current);
                pendingTargetedPathsRef.current.clear();
                pendingTargetedPerfRef.current = null;
                const targetedSyncStartedAt = liveWatchNow();
                startLiveWatchSession('generic', {
                    phase: 'importing',
                    message: 'Preparing live import...',
                    progress: { current: 0, total: nextBatch.length, message: undefined }
                });

                debugLiveWatchPerf('Targeted live sync started', {
                    cycleId: cyclePerfContext?.cycleId,
                    source: cyclePerfContext?.source,
                    batchPathCount: nextBatch.length,
                    eventCount: cyclePerfContext?.eventCount,
                    mergedCycleCount: cyclePerfContext?.mergedCycleCount ?? 1,
                    watcherToImportStartMs: cyclePerfContext ? elapsedMs(cyclePerfContext.firstEventAt) : undefined
                });

                try {
                    const { processTargetedFiles } = await import('../services/importService');
                    const result = await processTargetedFiles(nextBatch, {
                        forceRescan: true,
                        onProgress: (current, total, message) => {
                            updateLiveWatchSession({
                                source: 'generic',
                                phase: 'importing',
                                message: message || 'Importing live images...',
                                progress: { current, total, message: undefined }
                            });
                        },
                        perfContext: cyclePerfContext ? { ...cyclePerfContext, queueDepthAtStart: nextBatch.length } : undefined
                    });

                    result.handledPaths.forEach(path => {
                        handledPaths.add(path);
                        failedPaths.delete(path);
                    });
                    result.failedPaths.forEach(path => {
                        if (!handledPaths.has(path)) {
                            failedPaths.add(path);
                        }
                    });
                    importedCount += result.stats.imported;

                    if (result.stats.imported > 0) {
                        reportLiveImagesReceived(result.stats.imported, { source: 'generic' });
                    } else {
                        const receivedCount = useLibraryStore.getState().liveWatchSession.receivedCount;
                        updateLiveWatchSession({
                            source: 'generic',
                            phase: 'summary',
                            message: getLiveWatchSummaryMessage(receivedCount),
                            progress: null
                        });
                    }

                    if (result.handledPaths.length > 0) {
                        // Keep the catch-up cursor aligned only for files we actually handled.
                        const { updateFolderLastScanned } = useSettingsStore.getState();
                        const monitoredFolders = settingsRef.current.monitoredFolders || [];
                        const now = Date.now();
                        const updatedFolderIds = new Set<string>();

                        result.handledPaths.forEach(path => {
                            const lowerPath = path.toLowerCase();
                            const folder = monitoredFolders.find(f => lowerPath.startsWith(f.path.replace(/\\/g, '/').toLowerCase()));
                            if (folder && !updatedFolderIds.has(folder.id)) {
                                updatedFolderIds.add(folder.id);
                                updateFolderLastScanned(folder.id, now);
                            }
                        });
                    }

                    infoLiveWatchPerf('Targeted live cycle complete', {
                        cycleId: cyclePerfContext?.cycleId,
                        source: cyclePerfContext?.source,
                        batchPathCount: nextBatch.length,
                        handledPathCount: result.handledPaths.length,
                        failedPathCount: result.failedPaths.length,
                        importedCount: result.stats.imported,
                        cycleMs: elapsedMs(targetedSyncStartedAt),
                        watcherToFinishMs: cyclePerfContext ? elapsedMs(cyclePerfContext.firstEventAt) : undefined
                    });
                } catch (e) {
                    console.error('[LiveSync] Targeted sync failed', e);
                    nextBatch.forEach(path => failedPaths.add(path));
                    infoLiveWatchPerf('Targeted live cycle complete', {
                        cycleId: cyclePerfContext?.cycleId,
                        source: cyclePerfContext?.source,
                        batchPathCount: nextBatch.length,
                        handledPathCount: 0,
                        failedPathCount: nextBatch.length,
                        importedCount: 0,
                        cycleMs: elapsedMs(targetedSyncStartedAt),
                        watcherToFinishMs: cyclePerfContext ? elapsedMs(cyclePerfContext.firstEventAt) : undefined
                    });
                }
            }

            return {
                handledPaths: Array.from(handledPaths),
                failedPaths: Array.from(failedPaths),
                importedCount
            };
        })();

        targetedLiveDrainPromiseRef.current = drainPromise.finally(() => {
            targetedLiveDrainPromiseRef.current = null;
        });

        return targetedLiveDrainPromiseRef.current;
    }, [reportLiveImagesReceived, startLiveWatchSession, updateLiveWatchSession]);

    const cancelSync = useCallback(() => {
        cancelSyncAction();
    }, [cancelSyncAction]);

    const cleanLibrary = useCallback(async () => {
        try {
            console.log('[Purge] Starting library purge...');
            const { purgeLibrary } = await import('../services/db/imageRepo');
            const { appRepository } = await import('../services/repository');
            const { watcherService } = await import('../services/WatcherService');

            // 1. Graceful Shutdown & Auto-Healing Disable
            console.log('[Purge] Stopping background services...');
            setSettings(s => ({ ...s, enableAutoThumbnailHealing: false })); // Disable first to stop CPU usage

            await watcherService.stopWatching();
            useLibraryStore.getState().cancelThumbnailRegeneration();
            useLibraryStore.getState().cancelImport();
            useLibraryStore.getState().setBackgroundHealingPaused(true);

            // 2. Prepare Clean State (Settings & Legacy Data)
            console.log('[Purge] Resetting settings and legacy storage...');

            const legacyState = await appRepository.load();

            // Define clean settings
            const cleanSettings = {
                ...legacyState.settings,
                lastSyncedAt: null,
                monitoredFolders: [],
                invokeAiPath: undefined,
                a1111Path: undefined,
                comfyUiPath: undefined,
                resourceFolders: [], // Clear added model/lora folders
                importIntermediates: false,
                enableAutoThumbnailHealing: true, // Reset to default (True) so next run is fresh
                hasCompletedOnboarding: false // Optional: Reset onboarding for factory reset feel
            };

            // Force immediate save to disk BEFORE invoking the backend restart
            await appRepository.save({
                ...legacyState,
                images: [],
                collections: [],
                smartCollections: [],
                settings: cleanSettings
            });

            // Update local state (for Dev mode or if restart has delay)
            setSettings(cleanSettings);

            // 3. Reset React Query cache and Zustand store
            console.log('[Purge] Clearing React Query cache and store...');
            await queryClient.resetQueries();
            useSearchStore.getState().clearAllFilters();
            useSearchStore.getState().setImages([]);

            // 4. THE POINT OF NO RETURN: Trigger Backend Purge (Restarts App)
            console.log('[Purge] Purging backend database...');
            const backendMessage = await purgeLibrary();

            // Show the backend's message (e.g., "Purge scheduled. Please restart...")
            addToast(backendMessage, 'success');
            console.log('[Purge] Purge complete. User should restart the app.');

            // Note: In production, the app auto-restarts. In dev mode, user must restart terminal.
        } catch (e: any) {
            console.error("[Purge] Purge failed:", e);
            addToast('Purge failed: ' + e.message, 'error');
        }
    }, [addToast, setSettings, queryClient]);

    return (
        <SyncContext.Provider value={{
            startInvokeSync,
            startTargetedLiveSync,
            cancelSync,
            syncStatus,
            syncState: { status: syncStatus, progress: syncProgress },
            isLiveSyncing,
            setIsLiveSyncing,
            cleanLibrary
        }}>
            {children}
        </SyncContext.Provider>
    );
};

export const useSync = () => {
    const context = useContext(SyncContext);
    if (!context) throw new Error('useSync must be used within SyncProvider');
    return context;
};
