import * as React from 'react';
import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { useToast } from '../hooks/useToast';
import { getLiveWatchSummaryMessage, useLibraryStore } from '../stores/libraryStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useSearchStore } from '../stores/searchStore';
import { useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../stores/settingsStore';
import { AppSettings, FacetType, InvokeOwnerDiscovery, InvokeOwnerSelection, MetadataRefreshScope } from '../types';
import {
    isInvokeDbSnapshotCurrent,
    isInvokeDbSnapshotScopeCurrent,
    isInvokeImportSchemaCurrent,
    readInvokeDbSnapshotState,
} from '../services/invoke/dbSnapshot';
import {
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    InvokeLiveWatchPerfContext,
    liveWatchNow,
    TargetedLiveSyncPerfContext,
} from '../utils/liveWatchPerf';
import { isBrowserMockMode } from '../services/runtime';
import { createLiveFacetRefreshQueue } from '../utils/liveFacetRefreshQueue';
import { TouchedFacetResources } from '../utils/touchedFacetTypes';
import { refreshStartupFacetCache } from '../utils/startupFacetRefresh';
import {
    rebuildFacetCache,
    rebuildFacetCacheIncrementalBatchStrict,
    rebuildFacetCacheStrict,
    refreshFacetCacheForResourcesStrict,
} from '../services/db/imageRepo';
import { processTargetedFiles } from '../services/importService';
import { scanForOrphans } from '../services/invoke/orphanScanner';
import { appRepository } from '../services/repository';
import { watcherService } from '../services/WatcherService';
import { DEFAULT_APP_SETTINGS } from '../constants/defaultSettings';
import { settingsPersistenceCoordinator } from '../utils/settingsPersistenceCoordinator';
import { invalidateInvokeReferenceQueries } from '../services/db/invokeReferenceRepo';
import { discoverInvokeOwners } from '../services/invoke/connection';
import { applyInvokeOwnerScope, refreshInvokeOwnerVisibility } from '../services/invoke/ownerScope';
import { clearCollectionOwnerScopeCaches } from '../services/db/collectionRepo';
import { getMaintenanceCounts } from '../services/db/maintenanceRepo';
import { clearLibraryStatsCache } from '../services/db/searchRepo';
import {
    isInvokeSyncScopeSelectionCurrent,
    resolveInvokeSyncScope,
    type InvokeSyncScope,
} from '../services/invoke/syncScope';

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
        mergedCycleCount: current.mergedCycleCount! + (incoming.mergedCycleCount ?? 1)
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
        mergedCycleCount: current.mergedCycleCount! + (incoming.mergedCycleCount ?? 1)
    };
};

export interface InvokeOwnerScopeState {
    status: 'idle' | 'discovering' | 'applying' | 'ready' | 'selection_required' | 'error';
    discovery?: InvokeOwnerDiscovery;
    error?: string;
}

interface InvokeOwnerAdmission {
    rootPath: string;
    allowed: boolean;
    scope?: InvokeSyncScope;
    reason?: string;
}

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
    isInvokeSyncActive: boolean;
    setIsLiveSyncing: (val: boolean) => void;
    cleanLibrary: () => Promise<void>;
    invokeOwnerScopeState: InvokeOwnerScopeState;
    selectInvokeOwnerScope: (selection: InvokeOwnerSelection) => Promise<boolean>;
    retryInvokeOwnerScope: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export interface TargetedLiveSyncResult {
    handledPaths: string[];
    failedPaths: string[];
    importedCount: number;
}

export const SyncProvider: React.FC<{
    children: ReactNode;
    onSyncComplete?: (scope: MetadataRefreshScope) => void | Promise<void>;
    onInvokeContentChanged?: () => void | Promise<void>;
}> = ({ children, onSyncComplete, onInvokeContentChanged }) => {
    const { settings, settingsRef, setSettings, isLoaded: settingsLoaded } = useSettings();
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const setCollections = useCollectionStore(s => s.setCollections);
    const refreshCollections = useCollectionStore(s => s.refreshCollections);
    const refreshCollectionThumbnails = useCollectionStore(s => s.refreshCollectionThumbnails);

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
    const [invokeOwnerScopeState, setInvokeOwnerScopeState] = useState<InvokeOwnerScopeState>({ status: 'idle' });
    const [isInvokeSyncActive, setIsInvokeSyncActive] = useState(false);
    const ownerScopePromiseRef = useRef<{
        rootPath: string;
        promise: Promise<InvokeOwnerAdmission>;
    } | null>(null);
    const ownerScopeAdmissionRef = useRef<InvokeOwnerAdmission | null>(null);
    const activeInvokeSyncScopeRef = useRef<InvokeSyncScope | null>(null);
    const incrementFacetCacheVersion = useCallback(() => {
        useLibraryStore.getState().incrementFacetCacheVersion();
    }, []);
    const liveFacetRefreshQueueRef = useRef(createLiveFacetRefreshQueue({
        runIncremental: async (facetTypes: FacetType[]) => {
            return await rebuildFacetCacheIncrementalBatchStrict(facetTypes);
        },
        runResourceIncremental: async (resources: TouchedFacetResources) => {
            return await refreshFacetCacheForResourcesStrict(resources);
        },
        runFullFallback: async () => {
            return await rebuildFacetCacheStrict();
        },
        onRefreshApplied: incrementFacetCacheVersion
    }));

    const queueLiveFacetRefresh = useCallback((
        facetTypes: FacetType[],
        meta: {
            source: 'generic' | 'invoke';
            cycleId?: string;
            changedImageCount?: number;
        },
        resources?: TouchedFacetResources
    ) => {
        return liveFacetRefreshQueueRef.current.queue(facetTypes, meta, resources);
    }, []);

    const refreshAfterOwnerScopeChange = useCallback(async () => {
        clearLibraryStatsCache();
        await clearCollectionOwnerScopeCaches();
        await rebuildFacetCacheStrict();
        incrementFacetCacheVersion();
        const [, , , , , , maintenanceCounts] = await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['images'] }),
            queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
            queryClient.invalidateQueries({ queryKey: ['parameterRanges'] }),
            invalidateInvokeReferenceQueries(queryClient),
            refreshCollections(true),
            onInvokeContentChanged?.(),
            getMaintenanceCounts(),
        ]);
        useLibraryStore.getState().setMaintenanceCounts(maintenanceCounts);
        await refreshCollectionThumbnails(true);
    }, [incrementFacetCacheVersion, onInvokeContentChanged, queryClient, refreshCollectionThumbnails, refreshCollections]);

    const persistOwnerSelection = useCallback(async (
        selection: InvokeOwnerSelection | undefined,
        expectedRootPath: string
    ) => {
        await settingsPersistenceCoordinator.run(async (permit) => {
            const current = useSettingsStore.getState().settings;
            if (current.invokeAiPath?.trim() !== expectedRootPath) {
                throw new Error('InvokeAI path changed before owner selection could be saved.');
            }
            const nextSettings: AppSettings = {
                ...current,
                invokeOwnerSelection: selection,
                lastSyncedAt: null,
                invokeDbSnapshot: undefined,
            };
            await useSettingsStore.getState().flushSettings(nextSettings);
            const committed = useSettingsStore.getState().rollbackSettings(permit, {
                invokeOwnerSelection: selection,
                lastSyncedAt: null,
                invokeDbSnapshot: undefined,
            });
            if (!committed) {
                throw new Error('Owner selection persistence permit expired before commit.');
            }
        });
    }, []);

    const applyDiscoveredOwnerScope = useCallback(async (
        discovery: InvokeOwnerDiscovery,
        requestedSelection?: InvokeOwnerSelection,
        persistSelection: boolean = false,
        rootPath: string = discovery.imagesRoot,
        forceRefresh: boolean = false
    ): Promise<InvokeOwnerAdmission> => {
        const selection = requestedSelection?.dbPath === discovery.dbPath
            ? requestedSelection
            : undefined;
        const discoveryWithStaleOwner = selection?.mode === 'owner'
            && !discovery.owners.some(owner => owner.ownerId === selection.ownerId)
            ? {
                ...discovery,
                owners: [
                    ...discovery.owners,
                    { ownerId: selection.ownerId, imageCount: 0, isStale: true },
                ],
            }
            : discovery;

        ownerScopeAdmissionRef.current = null;
        setInvokeOwnerScopeState({ status: 'applying', discovery: discoveryWithStaleOwner });
        const previousSelection = settingsRef.current.invokeOwnerSelection?.dbPath === discovery.dbPath
            ? settingsRef.current.invokeOwnerSelection
            : undefined;
        const result = await applyInvokeOwnerScope({ discovery, selection });
        if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
            await refreshInvokeOwnerVisibility(discovery, previousSelection);
            await refreshAfterOwnerScopeChange();
            throw new Error('InvokeAI path changed while owner scope was loading.');
        }
        if (persistSelection) {
            try {
                await persistOwnerSelection(selection, rootPath);
            } catch (persistError) {
                try {
                    await refreshInvokeOwnerVisibility(discovery, previousSelection);
                    await refreshAfterOwnerScopeChange();
                } catch (rollbackError) {
                    throw new AggregateError(
                        [persistError, rollbackError],
                        'Owner selection could not be saved and visibility rollback failed.'
                    );
                }
                throw persistError;
            }
        }
        if (result.changed || forceRefresh) await refreshAfterOwnerScopeChange();

        if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
            return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
        }

        const scope = resolveInvokeSyncScope(discovery, selection);
        const allowed = scope !== null;
        const reason = result.mode === 'unselected'
            ? 'Choose an InvokeAI owner or All users before syncing.'
            : undefined;
        setInvokeOwnerScopeState({
            status: result.mode === 'unselected' ? 'selection_required' : 'ready',
            discovery: discoveryWithStaleOwner,
        });
        const admission = { rootPath, allowed, scope: scope ?? undefined, reason };
        ownerScopeAdmissionRef.current = admission;
        return admission;
    }, [persistOwnerSelection, refreshAfterOwnerScopeChange, settingsRef]);

    const ensureInvokeOwnerScope = useCallback(async (force = false): Promise<InvokeOwnerAdmission> => {
        const rootPath = settingsRef.current.invokeAiPath?.trim();
        if (!rootPath) {
            setInvokeOwnerScopeState({ status: 'idle' });
            ownerScopeAdmissionRef.current = null;
            return { rootPath: '', allowed: false, reason: 'Configure an InvokeAI path before syncing.' };
        }
        const cachedAdmission = ownerScopeAdmissionRef.current;
        if (!force && cachedAdmission?.rootPath === rootPath) {
            if (cachedAdmission.scope
                ? isInvokeSyncScopeSelectionCurrent(
                    cachedAdmission.scope,
                    settingsRef.current.invokeOwnerSelection
                )
                : !settingsRef.current.invokeOwnerSelection) {
                return cachedAdmission;
            }
            ownerScopeAdmissionRef.current = null;
        }
        const runningScope = ownerScopePromiseRef.current;
        if (runningScope?.rootPath === rootPath) return runningScope.promise;
        const precedingScope = runningScope?.promise;

        const promise = (async () => {
            if (precedingScope) {
                try {
                    await precedingScope;
                } catch {
                    // A newer root still needs its own discovery after an older scope fails.
                }
            }
            if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
                return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
            }
            setInvokeOwnerScopeState({ status: 'discovering' });
            try {
                const discovery = await discoverInvokeOwners(rootPath);
                if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
                    return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
                }
                const saved = settingsRef.current.invokeOwnerSelection;
                let selection = saved?.dbPath === discovery.dbPath ? saved : undefined;
                let shouldPersistSelection = !!saved && !selection;

                if (discovery.schemaMode === 'legacy') {
                    shouldPersistSelection = shouldPersistSelection || !!selection;
                    selection = undefined;
                } else if (!selection && discovery.owners.length === 1) {
                    selection = {
                        dbPath: discovery.dbPath,
                        mode: 'owner',
                        ownerId: discovery.owners[0].ownerId,
                    };
                    shouldPersistSelection = true;
                }

                const resolvedScope = resolveInvokeSyncScope(discovery, selection);
                const hasPersistedSyncState = settingsRef.current.lastSyncedAt != null
                    || settingsRef.current.invokeDbSnapshot !== undefined;
                if (hasPersistedSyncState
                    && !isInvokeDbSnapshotScopeCurrent(
                        settingsRef.current.invokeDbSnapshot,
                        resolvedScope
                    )) {
                    shouldPersistSelection = true;
                }

                const admission = await applyDiscoveredOwnerScope(
                    discovery,
                    selection,
                    shouldPersistSelection,
                    rootPath,
                    force
                );
                if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
                    if (ownerScopeAdmissionRef.current?.rootPath === rootPath) {
                        ownerScopeAdmissionRef.current = null;
                    }
                    return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
                }
                return admission;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setInvokeOwnerScopeState({ status: 'error', error: message });
                ownerScopeAdmissionRef.current = { rootPath, allowed: false, reason: message };
                return { rootPath, allowed: false, reason: message };
            }
        })();
        ownerScopePromiseRef.current = { rootPath, promise };
        try {
            return await promise;
        } finally {
            if (ownerScopePromiseRef.current?.promise === promise) {
                ownerScopePromiseRef.current = null;
            }
        }
    }, [applyDiscoveredOwnerScope, settingsRef]);

    const selectInvokeOwnerScope = useCallback(async (selection: InvokeOwnerSelection): Promise<boolean> => {
        if (activeInvokeSyncScopeRef.current) {
            addToast('Wait for the active InvokeAI sync before changing owner scope.', 'warning');
            return false;
        }
        const discovery = invokeOwnerScopeState.discovery;
        const currentRoot = settingsRef.current.invokeAiPath?.trim();
        if (!discovery
            || discovery.dbPath !== selection.dbPath
            || !currentRoot
            || ownerScopeAdmissionRef.current?.rootPath !== currentRoot) {
            addToast('Refresh the InvokeAI owner list before changing scope.', 'warning');
            return false;
        }
        if (ownerScopePromiseRef.current) return false;
        const currentSelection = settingsRef.current.invokeOwnerSelection;
        if (invokeOwnerScopeState.status === 'ready'
            && ownerScopeAdmissionRef.current?.rootPath === currentRoot
            && currentSelection?.dbPath === selection.dbPath
            && currentSelection.mode === selection.mode
            && (selection.mode === 'all'
                || (currentSelection.mode === 'owner' && currentSelection.ownerId === selection.ownerId))) {
            return true;
        }
        const promise = applyDiscoveredOwnerScope(
            discovery,
            selection,
            true,
            currentRoot
        );
        ownerScopePromiseRef.current = { rootPath: currentRoot, promise };
        try {
            await promise;
            if (settingsRef.current.invokeAiPath?.trim() !== currentRoot) {
                return false;
            }
            addToast(selection.mode === 'all' ? 'Showing images from all InvokeAI users.' : 'InvokeAI owner scope updated.', 'success');
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setInvokeOwnerScopeState({ status: 'error', discovery, error: message });
            addToast(`Could not update InvokeAI owner scope: ${message}`, 'error');
            return false;
        } finally {
            if (ownerScopePromiseRef.current?.promise === promise) {
                ownerScopePromiseRef.current = null;
            }
        }
    }, [addToast, applyDiscoveredOwnerScope, invokeOwnerScopeState.discovery, invokeOwnerScopeState.status, settingsRef]);

    const retryInvokeOwnerScope = useCallback(async () => {
        ownerScopeAdmissionRef.current = null;
        await ensureInvokeOwnerScope(true);
    }, [ensureInvokeOwnerScope]);

    useEffect(() => {
        if (!settingsLoaded) return;
        ownerScopeAdmissionRef.current = null;
        if (activeInvokeSyncScopeRef.current) return;
        void ensureInvokeOwnerScope().catch(() => {
            // The initiating selection flow owns reporting a concurrently shared rejection.
        });
    }, [ensureInvokeOwnerScope, settings.invokeAiPath, settings.invokeOwnerSelection, settingsLoaded]);

    const startInvokeSync = useCallback(async (optionsInput?: StartInvokeSyncOptions) => {
        if (isBrowserMockMode()) {
            addToast('Unavailable in browser mock mode.', 'info');
            return;
        }

        const options: StartInvokeSyncOptions = {
            syncFavorites: settingsRef.current.invokeSyncFavorites !== false,
            syncBoards: settingsRef.current.invokeSyncBoards !== false,
            starredAs: settingsRef.current.starredAs || 'favorite',
            mode: 'manual' as const,
            ...optionsInput
        };
        const ownerAdmission = await ensureInvokeOwnerScope();
        if (!ownerAdmission.allowed || !ownerAdmission.scope) {
            if (options.mode === 'manual') {
                addToast(ownerAdmission.reason || 'InvokeAI sync is blocked by owner scope.', 'warning');
            } else {
                console.info('[InvokeAI Sync] Skipped by owner scope.', { reason: ownerAdmission.reason });
            }
            return;
        }
        const capturedScope = ownerAdmission.scope;
        const capturedRootPath = ownerAdmission.rootPath;
        const isCapturedScopeCurrent = (): boolean => {
            if (settingsRef.current.invokeAiPath?.trim() !== capturedRootPath) return false;
            return isInvokeSyncScopeSelectionCurrent(
                capturedScope,
                settingsRef.current.invokeOwnerSelection
            );
        };
        const isStartupMode = options.mode === 'startup';
        let startupSyncVisible = false;
        const setVisibleStartupProgress = (progress: NonNullable<typeof syncProgress>) => {
            if (!startupSyncVisible) {
                startupSyncVisible = true;
                setSyncStatus('syncing');
            }
            setSyncProgress(progress);
        };
        const syncStartedAt = liveWatchNow();
        const livePerfContext = options.mode === 'live' ? options.perfContext : undefined;
        let liveTotalProcessed = 0;
        let liveHadChanges = false;
        let liveOutcome: 'completed' | 'errored' | 'aborted' = 'completed';
        const effectiveTimestamp = options.afterTimestamp !== undefined ? options.afterTimestamp : settingsRef.current.lastSyncedAt;
        const effectiveImportIntermediates = options.importIntermediates !== undefined
            ? options.importIntermediates
            : settingsRef.current.importIntermediates;
        const requestedImportOrphans = options.importOrphans !== undefined
            ? options.importOrphans === true
            : options.mode === 'manual' && settingsRef.current.importOrphans === true;
        const shouldImportOrphans = capturedScope.mode === 'owner' ? false : requestedImportOrphans;
        const effectiveSnapshotConfig = {
            lastSyncedAt: effectiveTimestamp,
            importIntermediates: effectiveImportIntermediates,
            importOrphans: shouldImportOrphans,
            syncBoardsToCollections: settingsRef.current.syncBoardsToCollections,
            scopeMode: capturedScope.mode,
            scopeOwnerId: capturedScope.mode === 'owner' ? capturedScope.ownerId : null,
        };
        const shouldUseStartupSnapshot =
            options.mode === 'startup'
            && !!settingsRef.current.invokeAiPath
            && shouldImportOrphans === false;
        const shouldReconcileSourceFacts =
            options.mode !== 'live'
            && !isInvokeImportSchemaCurrent(settingsRef.current.invokeDbSnapshot);

        if (options.mode === 'live'
            && (activeInvokeSyncScopeRef.current || syncStatus === 'syncing' || isLiveSyncingRef.current)) {
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
        if (activeInvokeSyncScopeRef.current || syncStatus === 'syncing') return;
        activeInvokeSyncScopeRef.current = capturedScope;
        setIsInvokeSyncActive(true);

        if (shouldUseStartupSnapshot) {
            const snapshotStartedAt = liveWatchNow();
            try {
                const currentSnapshot = await readInvokeDbSnapshotState(
                    capturedRootPath,
                    effectiveSnapshotConfig
                );
                const dbSnapshotFile = currentSnapshot.files.find(file => file.path === currentSnapshot.dbPath);

                if (dbSnapshotFile && !dbSnapshotFile.exists) {
                    console.warn('[Startup Catch-up] Invoke DB file is missing; skipped SQLite sync.', {
                        dbPath: currentSnapshot.dbPath,
                        checkMs: elapsedMs(snapshotStartedAt)
                    });
                    if (activeInvokeSyncScopeRef.current === capturedScope) activeInvokeSyncScopeRef.current = null;
                    setIsInvokeSyncActive(false);
                    return;
                }

                if (isInvokeDbSnapshotCurrent(settingsRef.current.invokeDbSnapshot, currentSnapshot)) {
                    console.info('[Startup Catch-up] Invoke DB snapshot unchanged; skipped SQLite sync.', {
                        dbPath: currentSnapshot.dbPath,
                        checkMs: elapsedMs(snapshotStartedAt)
                    });
                    if (activeInvokeSyncScopeRef.current === capturedScope) activeInvokeSyncScopeRef.current = null;
                    setIsInvokeSyncActive(false);
                    return;
                }

                console.info('[Startup Catch-up] Invoke DB snapshot changed; running SQLite sync.', {
                    dbPath: currentSnapshot.dbPath,
                    checkMs: elapsedMs(snapshotStartedAt)
                });
            } catch (snapshotError) {
                console.warn('[Startup Catch-up] Invoke DB snapshot check failed; falling back to SQLite sync.', snapshotError);
            }
        }

        if (options.mode === 'live') {
            pendingInvokeLiveSyncRef.current = false;
            isLiveSyncingRef.current = true;
            setIsLiveSyncing(true);
            setSyncProgress({ current: 0, total: 0, message: undefined });
            startLiveWatchSession('invoke', {
                phase: 'syncing',
                message: 'Syncing completed InvokeAI images...',
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
            if (!isStartupMode) {
                setSyncStatus('syncing');
                setSyncProgress({ current: 0, total: 0, message: 'Preparing...' });
            }
        }

        const ctrl = new AbortController();
        setSyncAbortController(ctrl);
        const persistInvokeSnapshot = async (lastSyncedAt: number | null | undefined) => {
            if (
                !isCapturedScopeCurrent()
                || options.mode === 'live'
                || (shouldImportOrphans && !shouldReconcileSourceFacts)
            ) return;

            try {
                const snapshot = await readInvokeDbSnapshotState(
                    capturedRootPath,
                    {
                        ...effectiveSnapshotConfig,
                        lastSyncedAt,
                        // Orphan recovery is manual-only and does not change whether the Invoke DB was synced.
                        importOrphans: false,
                    }
                );
                await settingsPersistenceCoordinator.run(async () => {
                    if (!isCapturedScopeCurrent()) {
                        throw new Error('InvokeAI owner scope changed before the sync snapshot could be saved.');
                    }
                    const nextSettings = {
                        ...useSettingsStore.getState().settings,
                        invokeDbSnapshot: snapshot
                    };
                    setSettings(nextSettings);
                    await useSettingsStore.getState().flushSettings(nextSettings);
                });
            } catch (snapshotError) {
                console.warn('[Startup Catch-up] Failed to persist Invoke DB snapshot.', snapshotError);
            }
        };

        try {
            const { syncImages } = await import('../services/invoke/syncService');
            const { imported, updated, maxTimestamp: newTs, boardMapping, syncedIds, touchedFacetTypes, touchedFacetResources } = await syncImages(
                capturedRootPath,
                (c, t, msg) => {
                    if (options.mode === 'live') {
                        // Keep message undefined to prevent ActivityDock from exploding on screen
                        setSyncProgress({ current: c, total: t, message: undefined });
                        updateLiveWatchSession({
                            source: 'invoke',
                            phase: 'syncing',
                            message: msg || 'Syncing completed InvokeAI images...',
                            progress: { current: c, total: t, message: undefined }
                        });
                    } else {
                        if (isStartupMode) {
                            if (t > 0) {
                                setVisibleStartupProgress({ current: c, total: t, message: msg });
                            }
                        } else {
                            setSyncProgress({ current: c, total: t, message: msg });
                        }
                    }
                },
                ctrl.signal,
                {
                    scope: capturedScope,
                    syncFavorites: options.syncFavorites,
                    syncBoards: options.syncBoards,
                    afterTimestamp: effectiveTimestamp,
                    importIntermediates: effectiveImportIntermediates,
                    starredAs: options.starredAs,
                    perfContext: livePerfContext,
                    mode: options.mode,
                    reconcileSourceFacts: shouldReconcileSourceFacts
                }
            );
            if (!isCapturedScopeCurrent()) {
                throw new Error('InvokeAI path or owner scope changed while synchronization was running.');
            }
            try {
                await invalidateInvokeReferenceQueries(queryClient);
            } catch (error) {
                console.error('[Sync] Failed to refresh InvokeAI reference links', error);
            }
            const snapshotCursor = typeof newTs === 'number' ? newTs : (effectiveTimestamp ?? null);

            // Sync Boards to Collections
            if (settingsRef.current.syncBoardsToCollections && boardMapping && boardMapping.size > 0) {
                if (options.mode !== 'live') {
                    const nextProgress = { ...useLibraryStore.getState().syncProgress, message: 'Synchronizing boards...' };
                    if (isStartupMode) {
                        setVisibleStartupProgress(nextProgress);
                    } else {
                        setSyncProgress(nextProgress);
                    }
                }
                setCollections(prev => {
                    const next = [...prev];
                    let changed = false;
                    boardMapping.forEach((data, id) => {
                        const { name, createdAt, ownerId } = data;
                        const existing = next.find(c => c.id === id);
                        if (!existing) {
                            next.push({
                                id: id,
                                name: name,
                                imageIds: [],
                                count: 0,
                                createdAt: createdAt || Date.now(),
                                source: 'invoke',
                                invokeOwnerId: ownerId,
                            });
                            changed = true;
                        } else if (existing.name !== name || existing.invokeOwnerId !== ownerId) {
                            const idx = next.indexOf(existing);
                            next[idx] = { ...existing, name, source: 'invoke', invokeOwnerId: ownerId };
                            changed = true;
                        }
                    });
                    return changed ? next : prev;
                });
            }
            const shouldRefreshBoardCollectionThumbnails = !!boardMapping && boardMapping.size > 0;

            // Orphan scanning
            let orphansImported = 0;

            if (options.mode !== 'live' && shouldImportOrphans) {
                orphansImported = await scanForOrphans(
                    capturedRootPath,
                    syncedIds,
                    (phase, current, total) => {
                        setSyncProgress({ current, total, message: phase });
                    },
                    { importIntermediates: settingsRef.current.importIntermediates }
                );
            }

            if (!isStartupMode || startupSyncVisible) {
                setSyncStatus('complete');
            }
            const totalProcessed = (imported || 0) + (updated || 0) + orphansImported;
            liveTotalProcessed = totalProcessed;
            // Conditional Facet Rebuild
            const hasChanges = (imported || 0) > 0 || (updated || 0) > 0 || orphansImported > 0;
            liveHadChanges = hasChanges;

            if (hasChanges) {
                try {
                    await onInvokeContentChanged?.();
                } catch (error) {
                    console.error('[Sync] Failed to refresh hidden-content availability after Invoke sync', error);
                }
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

                    void queueLiveFacetRefresh(touchedFacetTypes, {
                        source: 'invoke',
                        cycleId: livePerfContext?.cycleId,
                        changedImageCount: totalProcessed
                    }, touchedFacetResources);

                    if (shouldRefreshBoardCollectionThumbnails) {
                        void refreshCollections()
                            .then(() => refreshCollectionThumbnails(true))
                            .catch((error) => {
                                console.error('[Sync] Failed to refresh collection thumbnails after live Invoke sync', error);
                            });
                    }
                } else {
                    // MANUAL HEAVY REBUILD
                    if (isStartupMode) {
                        setVisibleStartupProgress({ current: totalProcessed, total: totalProcessed, message: 'Updating gallery...' });
                    } else {
                        setSyncProgress({ current: totalProcessed, total: totalProcessed, message: 'Updating gallery...' });
                    }

                    // IMMEDIATE UI REFRESH (Block here until data hits RAM)
                    await queryClient.refetchQueries({ queryKey: ['images'] });

                    // Advance cursor IMMEDIATELY so we don't scan the same files if something crashes
                    if (typeof newTs === 'number') {
                        if (!isCapturedScopeCurrent()) throw new Error('InvokeAI owner scope changed before the sync cursor could be saved.');
                        setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
                    }

                    const cacheProgress = {
                        current: totalProcessed,
                        total: totalProcessed,
                        message: options.mode === 'startup' ? 'Updating startup filters...' : 'Rebuilding filter cache...'
                    };
                    if (isStartupMode) {
                        setVisibleStartupProgress(cacheProgress);
                    } else {
                        setSyncProgress(cacheProgress);
                    }

                    try {
                        if (options.mode === 'startup') {
                            await refreshStartupFacetCache({
                                source: 'invoke',
                                totalProcessed,
                                touchedFacetTypes,
                                touchedFacetResources,
                                orphanScanEnabled: shouldImportOrphans,
                                onRefreshApplied: incrementFacetCacheVersion
                            });
                        } else {
                            await rebuildFacetCache();
                            useLibraryStore.getState().incrementFacetCacheVersion();
                        }
                    } catch (e) {
                        console.error('[Sync] Failed to rebuild facet cache after sync', e);
                        setSyncStatus('error');
                        return; // Halt completion if critical DB error
                    }

                    const clearedMessageProgress = { ...useLibraryStore.getState().syncProgress, message: undefined };
                    setSyncProgress(clearedMessageProgress);

                    // Trigger complete routines
                    addToast(`Synchronization complete: ${totalProcessed} items processed.`, 'success');
                    
                    if (options.mode !== 'startup') {
                        await onSyncComplete?.('full');
                    } else {
                        if (shouldRefreshBoardCollectionThumbnails) {
                            await refreshCollections();
                        }
                        setSyncStatus('complete');
                    }

                    if (shouldRefreshBoardCollectionThumbnails) {
                        await refreshCollectionThumbnails(true);
                    }

                    await persistInvokeSnapshot(snapshotCursor);
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
                } else {
                    if (options.mode === 'startup') {
                        await refreshStartupFacetCache({
                            source: 'invoke',
                            totalProcessed,
                            touchedFacetTypes,
                            touchedFacetResources,
                            orphanScanEnabled: shouldImportOrphans,
                            onRefreshApplied: incrementFacetCacheVersion
                        });
                    }
                    debugLiveWatchPerf('Invoke sync no-op skipped metadata refresh', {
                        mode: options.mode,
                        totalProcessed,
                        syncMs: elapsedMs(syncStartedAt)
                    });
                }
            }

            // Fallback for NO CHANGES scenario (hasChanges === false)
            if (typeof newTs === 'number') {
                if (!isCapturedScopeCurrent()) throw new Error('InvokeAI owner scope changed before the sync cursor could be saved.');
                setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
            }
            await persistInvokeSnapshot(snapshotCursor);

            if (totalProcessed === 0 && options.mode === 'manual') {
                addToast('Synchronization complete: No new changes.', 'info');
            }

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            if (message === 'Aborted') {
                liveOutcome = 'aborted';
                setSyncStatus('idle');
            }
            else {
                liveOutcome = 'errored';
                console.error('Sync failed', e);
                setSyncStatus('error');
                if (options.mode === 'manual' || options.mode === 'startup') addToast('Sync failed: ' + message, 'error');
            }
        } finally {
            if (activeInvokeSyncScopeRef.current === capturedScope) {
                activeInvokeSyncScopeRef.current = null;
            }
            setIsInvokeSyncActive(false);
            setSyncAbortController(null);
            if (isStartupMode && !startupSyncVisible) {
                setSyncStatus('idle');
                setSyncProgress({ current: 0, total: 0, message: undefined });
            }
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
            }
            if (!isCapturedScopeCurrent()) {
                ownerScopeAdmissionRef.current = null;
                await ensureInvokeOwnerScope(true);
            }
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
    }, [syncStatus, addToast, ensureInvokeOwnerScope, onSyncComplete, onInvokeContentChanged, queryClient, queueLiveFacetRefresh, incrementFacetCacheVersion, setSettings, setCollections, refreshCollections, refreshCollectionThumbnails, setSyncStatus, setSyncProgress, setIsLiveSyncing, startLiveWatchSession, updateLiveWatchSession, reportLiveImagesReceived]);

    const startTargetedLiveSync = useCallback(async (paths: string[], perfContext?: TargetedLiveSyncPerfContext) => {
        if (isBrowserMockMode()) {
            return { handledPaths: [], failedPaths: [], importedCount: 0 };
        }

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
                    message: 'Importing new images...',
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
                    const result = await processTargetedFiles(nextBatch, {
                        forceRescan: true,
                        waitForStableFiles: true,
                        onProgress: (current, total, message) => {
                            updateLiveWatchSession({
                                source: 'generic',
                                phase: 'importing',
                                message: message || 'Importing new images...',
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

                    // Targeted watcher events do not prove the whole folder has been swept.
                    // The startup/catch-up scanner owns the monitored-folder cursor.
                    if (result.handledPaths.length > 0) {
                        const invalidateStartedAt = liveWatchNow();
                        const invalidatePromise = queryClient.invalidateQueries({ queryKey: ['images'] });
                        debugLiveWatchPerf('Generic live image refresh invalidation triggered', {
                            cycleId: cyclePerfContext?.cycleId,
                            handledPathCount: result.handledPaths.length,
                            importedCount: result.stats.imported,
                            triggerMs: elapsedMs(invalidateStartedAt)
                        });
                        void invalidatePromise
                            .then(() => {
                                debugLiveWatchPerf('Generic live image refresh invalidation settled', {
                                    cycleId: cyclePerfContext?.cycleId,
                                    handledPathCount: result.handledPaths.length,
                                    importedCount: result.stats.imported,
                                    settleMs: elapsedMs(invalidateStartedAt)
                                });
                            })
                            .catch((invalidateError) => {
                                console.error('[LiveSync] Generic live image refresh invalidation failed', invalidateError);
                            });

                        void queueLiveFacetRefresh(result.touchedFacetTypes, {
                            source: 'generic',
                            cycleId: cyclePerfContext?.cycleId,
                            changedImageCount: result.stats.imported
                        }, result.touchedFacetResources);
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
    }, [queryClient, queueLiveFacetRefresh, reportLiveImagesReceived, startLiveWatchSession, updateLiveWatchSession]);

    const cancelSync = useCallback(() => {
        cancelSyncAction();
    }, [cancelSyncAction]);

    const cleanLibrary = useCallback(async () => {
        if (isBrowserMockMode()) {
            addToast('Unavailable in browser mock mode.', 'info');
            return;
        }

        useSettingsStore.getState().cancelPendingSave();
        try {
            await settingsPersistenceCoordinator.runExclusive(async () => {
                console.log('[Purge] Starting library purge...');
                console.log('[Purge] Stopping background services...');

                const resumeWatcher = await watcherService.pauseWatching();
                const libraryState = useLibraryStore.getState();
                const healingWasPaused = libraryState.backgroundHealingPaused;
                cancelSyncAction();
                libraryState.cancelThumbnailRegeneration();
                libraryState.cancelImport();
                libraryState.setBackgroundHealingPaused(true);

                try {
                    console.log('[Purge] Committing crash-recoverable factory reset...');
                    const scheduled = await appRepository.schedulePurge((legacyState) => {
                        const cleanSettings: AppSettings = {
                            ...legacyState.settings,
                            lastSyncedAt: null,
                            monitoredFolders: [],
                            invokeAiPath: undefined,
                            invokeOwnerSelection: undefined,
                            a1111Path: undefined,
                            comfyUiPath: undefined,
                            resourceFolders: [],
                            importIntermediates: false,
                            enableAutoThumbnailHealing: true,
                            thumbnailOptimizationProfile: 'balanced',
                            promptMaskingEnabled: DEFAULT_APP_SETTINGS.promptMaskingEnabled,
                            maskedKeywords: [...DEFAULT_APP_SETTINGS.maskedKeywords],
                            maskingMode: DEFAULT_APP_SETTINGS.maskingMode,
                            hasCompletedOnboarding: false
                        };
                        return {
                            ...legacyState,
                            images: [],
                            collections: [],
                            smartCollections: [],
                            recentSearches: [],
                            settings: cleanSettings
                        };
                    });

                    useSettingsStore.setState({ settings: scheduled.state.settings });
                    try {
                        console.log('[Purge] Clearing React Query cache and store...');
                        await queryClient.resetQueries();
                        useSearchStore.getState().clearAllFilters();
                        useSearchStore.getState().setImages([]);
                    } catch (cleanupError) {
                        console.error('[Purge] Post-schedule UI cleanup failed; restart is still required:', cleanupError);
                    }

                    addToast(scheduled.message, 'success');
                    console.log('[Purge] Factory reset committed; startup recovery will materialize library.json.');
                } catch (error) {
                    libraryState.setBackgroundHealingPaused(healingWasPaused);
                    try {
                        await resumeWatcher();
                    } catch (resumeError) {
                        console.error('[Purge] Failed to resume watcher after scheduling failure:', resumeError);
                    }
                    throw error;
                }
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("[Purge] Purge failed:", e);
            addToast('Purge failed: ' + message, 'error');
        }
    }, [addToast, cancelSyncAction, queryClient]);

    return (
        <SyncContext.Provider value={{
            startInvokeSync,
            startTargetedLiveSync,
            cancelSync,
            syncStatus,
            syncState: { status: syncStatus, progress: syncProgress },
            isLiveSyncing,
            isInvokeSyncActive,
            setIsLiveSyncing,
            cleanLibrary,
            invokeOwnerScopeState,
            selectInvokeOwnerScope,
            retryInvokeOwnerScope,
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
