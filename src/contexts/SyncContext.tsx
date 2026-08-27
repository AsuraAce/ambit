import * as React from 'react';
import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { useToast } from '../hooks/useToast';
import { getLiveWatchSummaryMessage, useLibraryStore, type SyncProgress } from '../stores/libraryStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useSearchStore } from '../stores/searchStore';
import { useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../stores/settingsStore';
import { AppSettings, FacetType, InvokeDbSnapshotState, InvokeOwnerDiscovery, InvokeOwnerSelection, MetadataRefreshScope } from '../types';
import {
    getInvokeDbSnapshotForScope,
    INVOKE_BOARD_OWNER_SCHEMA_VERSION,
    isInvokeBoardOwnerSnapshotCurrent,
    isInvokeDbSnapshotCurrent,
    isInvokeDbSnapshotScopeCurrent,
    isInvokeImportSchemaCurrent,
    isInvokeSourceFingerprintCurrent,
    readInvokeDbSnapshotState,
    upsertInvokeDbSnapshot,
} from '../services/invoke/dbSnapshot';
import { isSameInvokePath } from '../services/invoke/pathIdentity';
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
import { discoverInvokeOwners, readInvokeSourceFingerprint } from '../services/invoke/connection';
import { applyInvokeOwnerScope, refreshInvokeOwnerVisibility } from '../services/invoke/ownerScope';
import { clearCollectionOwnerScopeCaches } from '../services/db/collectionRepo';
import { getMaintenanceCounts } from '../services/db/maintenanceRepo';
import { clearLibraryStatsCache } from '../services/db/searchRepo';
import {
    isInvokeSyncScopeSelectionCurrent,
    resolveInvokeSyncScope,
    type InvokeSyncScope,
} from '../services/invoke/syncScope';
import {
    isSameInvokeSyncScope,
    readTrustedInvokeOwnerScope,
} from '../services/invoke/trustedOwnerScope';
import {
    useInvokeOwnerScopeStore,
    type InvokeOwnerScopeState,
} from '../stores/invokeOwnerScopeStore';
import { commands } from '../bindings';
import type { InvokeScopeCacheBuildClaim, InvokeScopeCacheRepairPlan } from '../bindings';
import { unwrap } from '../utils/spectaUtils';

export type { InvokeOwnerScopeState } from '../stores/invokeOwnerScopeStore';

const FULL_INVOKE_SCOPE_CACHE_REPAIR: InvokeScopeCacheRepairPlan = {
    action: 'full',
    resources: {
        checkpoints: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        controlNets: [],
        ipAdapters: [],
        tools: [],
    },
    facetTypes: [],
    collectionsDirty: true,
};

const resolveInvokeScopeCacheRepair = (
    repair: InvokeScopeCacheRepairPlan | undefined
): InvokeScopeCacheRepairPlan => repair ?? FULL_INVOKE_SCOPE_CACHE_REPAIR;

const abortInvokeScopeCacheClaim = async (
    claim: InvokeScopeCacheBuildClaim,
    context: string
): Promise<void> => {
    if (claim.cacheRepair.action === 'restored') return;
    try {
        await unwrap(commands.abortActiveInvokeScopeCacheBuild({
            scopeKey: claim.scopeKey,
            generation: claim.generation,
        }));
    } catch (abortError) {
        console.warn(`[InvokeAI] Failed to release an abandoned cache build claim (${context}).`, abortError);
    }
};

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

interface RunInvokeSyncOptions extends StartInvokeSyncOptions {
    ownerTransitionToken?: symbol;
}

type InvokeSyncOutcome =
    | { status: 'completed' }
    | { status: 'queued' }
    | { status: 'blocked' | 'busy' | 'source_unavailable' | 'aborted' | 'failed'; message?: string };

interface ActiveInvokeSyncRun {
    scope: InvokeSyncScope;
    mode: NonNullable<StartInvokeSyncOptions['mode']>;
    promise: Promise<InvokeSyncOutcome>;
}

interface InvokeOwnerTransition {
    rootPath: string;
    token: symbol;
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

interface InvokeOwnerAdmission {
    rootPath: string;
    allowed: boolean;
    scope?: InvokeSyncScope;
    reason?: string;
    sourceFactsReconciled?: boolean;
    boardOwnersReconciled?: boolean;
    boardScopeWarning?: string;
    cacheRepair?: InvokeScopeCacheRepairPlan;
    offline?: boolean;
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
    retryInvokeOwnerScope: () => Promise<boolean>;
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
    const refreshSmartCounts = useCollectionStore(s => s.refreshSmartCounts);

    // Zustand State
    const syncStatus = useLibraryStore(s => s.syncStatus);
    const setSyncStatus = useLibraryStore(s => s.setSyncStatus);
    // syncProgress is used internally in startInvokeSync but not exposed in Context
    const syncProgress = useLibraryStore(s => s.syncProgress);
    const setSyncProgress = useLibraryStore(s => s.setSyncProgress);
    const setInvokeSyncActivityKind = useLibraryStore(s => s.setInvokeSyncActivityKind);
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
    const invokeOwnerScopeState = useInvokeOwnerScopeStore(state => state.ownerScopeState);
    const setInvokeOwnerScopeState = useInvokeOwnerScopeStore(state => state.setOwnerScopeState);
    const [isInvokeSyncActive, setIsInvokeSyncActive] = useState(false);
    const ownerScopePromiseRef = useRef<{
        rootPath: string;
        promise: Promise<InvokeOwnerAdmission>;
    } | null>(null);
    const ownerTransitionRef = useRef<InvokeOwnerTransition | null>(null);
    const ownerScopeAdmissionRef = useRef<InvokeOwnerAdmission | null>(null);
    const activeInvokeSyncScopeRef = useRef<InvokeSyncScope | null>(null);
    const pendingInvokeViewReadyAnnouncementRootRef = useRef<string | null>(null);
    const runInvokeSyncRef = useRef<(options?: RunInvokeSyncOptions) => Promise<InvokeSyncOutcome>>(
        async () => ({ status: 'failed', message: 'InvokeAI synchronization is not ready.' })
    );
    const activeInvokeSyncRunRef = useRef<ActiveInvokeSyncRun | null>(null);
    const startPendingInvokeLiveRerun = useCallback(() => {
        if (!pendingInvokeLiveSyncRef.current
            || ownerScopePromiseRef.current
            || ownerTransitionRef.current
            || activeInvokeSyncRunRef.current) {
            return;
        }

        const pendingPerfContext = pendingInvokeLivePerfRef.current;
        pendingInvokeLiveSyncRef.current = false;
        pendingInvokeLivePerfRef.current = null;
        debugLiveWatchPerf('Invoke live rerun starting', {
            cycleId: pendingPerfContext?.cycleId,
            eventCount: pendingPerfContext?.eventCount,
            pathCount: pendingPerfContext?.pathCount,
            mergedCycleCount: pendingPerfContext?.mergedCycleCount ?? 1
        });
        void runInvokeSyncRef.current({ mode: 'live', perfContext: pendingPerfContext || undefined });
    }, []);
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

    const refreshAfterOwnerScopeChange = useCallback(async (
        maxAttempts: 1 | 2 = 2
    ): Promise<InvokeScopeCacheRepairPlan> => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const refreshStartedAt = performance.now();
            const claim = await unwrap(commands.beginActiveInvokeScopeCacheBuild());
            const cacheRepair = claim.cacheRepair;
            const requiresCacheBuild = cacheRepair.action !== 'restored';
            try {
            clearLibraryStatsCache();
            const resourceCount = Object.values(cacheRepair.resources)
                .reduce((total, names) => total + names.length, 0);
            const resourceFacetTypes = Object.entries(cacheRepair.resources)
                .filter(([, names]) => names.length > 0)
                .map(([facetType]) => facetType);
            const facetTypes = Array.from(new Set([
                ...cacheRepair.facetTypes,
                ...(resourceCount > 64 ? resourceFacetTypes : []),
            ]));
            if (requiresCacheBuild) {
                if (cacheRepair.action === 'full') {
                    await clearCollectionOwnerScopeCaches();
                    await rebuildFacetCacheStrict();
                } else {
                    if (resourceCount > 0 && resourceCount <= 64) {
                        await refreshFacetCacheForResourcesStrict(cacheRepair.resources);
                    }
                    if (facetTypes.length > 0) {
                        await rebuildFacetCacheIncrementalBatchStrict(facetTypes);
                    }
                    if (cacheRepair.collectionsDirty) {
                        await clearCollectionOwnerScopeCaches();
                    }
                }
            }
            incrementFacetCacheVersion();
            const [, , , , , maintenanceCounts] = await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['images'] }),
                queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
                queryClient.invalidateQueries({ queryKey: ['parameterRanges'] }),
                invalidateInvokeReferenceQueries(queryClient),
                refreshCollections(false, {
                    includeThumbnails: false,
                    scheduleSmartRefresh: false,
                    consistency: 'authoritative',
                }),
                getMaintenanceCounts(),
            ]);
            useLibraryStore.getState().setMaintenanceCounts(maintenanceCounts);
            if (cacheRepair.action === 'full' || cacheRepair.collectionsDirty) {
                await Promise.all([
                    refreshSmartCounts({
                        includeArchived: true,
                        includePromptSearch: true,
                        consistency: 'authoritative',
                    }),
                    refreshCollectionThumbnails(false, true, {
                        consistency: 'authoritative',
                    }),
                ]);
            }
            if (requiresCacheBuild) {
                await unwrap(commands.commitActiveInvokeScopeCache({
                    scopeKey: claim.scopeKey,
                    generation: claim.generation,
                }));
            }
            console.info('[InvokeAI] Library cache refresh completed.', {
                action: cacheRepair.action,
                resourceCount,
                facetTypes,
                collectionsDirty: cacheRepair.collectionsDirty,
                elapsedMs: Math.round(performance.now() - refreshStartedAt),
            });
            return cacheRepair;
            } catch (error) {
                if (requiresCacheBuild) {
                    await abortInvokeScopeCacheClaim(claim, 'owner-scope refresh');
                }
                const message = error instanceof Error ? error.message : String(error);
                if (attempt + 1 < maxAttempts && message.includes('changed while it was being prepared')) {
                    continue;
                }
                throw error;
            }
        }
        throw new Error('Invoke owner cache changed repeatedly while it was being prepared.');
    }, [incrementFacetCacheVersion, queryClient, refreshCollectionThumbnails, refreshCollections, refreshSmartCounts]);

    const persistOwnerSelection = useCallback(async (
        selection: InvokeOwnerSelection | undefined,
        expectedRootPath: string,
        scope: InvokeSyncScope | null,
        repairedSnapshot?: AppSettings['invokeDbSnapshot']
    ) => {
        await settingsPersistenceCoordinator.run(async (permit) => {
            const current = useSettingsStore.getState().settings;
            if (current.invokeAiPath?.trim() !== expectedRootPath) {
                throw new Error('InvokeAI path changed before owner selection could be saved.');
            }
            let invokeDbSnapshots = current.invokeDbSnapshots;
            if (current.invokeDbSnapshot) {
                invokeDbSnapshots = upsertInvokeDbSnapshot(invokeDbSnapshots, current.invokeDbSnapshot);
            }
            if (repairedSnapshot) {
                invokeDbSnapshots = upsertInvokeDbSnapshot(invokeDbSnapshots, repairedSnapshot);
            }
            const targetSnapshot = repairedSnapshot
                ?? getInvokeDbSnapshotForScope({
                    invokeDbSnapshot: current.invokeDbSnapshot,
                    invokeDbSnapshots,
                }, scope);
            const nextSettings: AppSettings = {
                ...current,
                invokeOwnerSelection: selection,
                lastSyncedAt: targetSnapshot?.lastSyncedAt ?? null,
                invokeDbSnapshot: targetSnapshot,
                invokeDbSnapshots,
            };
            await useSettingsStore.getState().flushSettings(nextSettings);
            const committed = useSettingsStore.getState().rollbackSettings(permit, {
                invokeOwnerSelection: selection,
                lastSyncedAt: targetSnapshot?.lastSyncedAt ?? null,
                invokeDbSnapshot: targetSnapshot,
                invokeDbSnapshots,
            });
            if (!committed) {
                throw new Error('Owner selection persistence permit expired before commit.');
            }
            // Selection handlers can immediately start catch-up in the same React event.
            // Keep the admission ref in lockstep with the committed Zustand state so that
            // the follow-up sync cannot re-discover against a render-stale selection.
            settingsRef.current = useSettingsStore.getState().settings;
        });
    }, [settingsRef]);

    const applyDiscoveredOwnerScope = useCallback(async (
        discovery: InvokeOwnerDiscovery,
        requestedSelection?: InvokeOwnerSelection,
        persistSelection: boolean = false,
        rootPath: string = discovery.imagesRoot,
        forceRefresh: boolean = false,
        deferReady: boolean = false
    ): Promise<InvokeOwnerAdmission> => {
        const selection = requestedSelection && isSameInvokePath(requestedSelection.dbPath, discovery.dbPath)
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
        const scope = resolveInvokeSyncScope(discovery, selection);
        const targetSnapshot = getInvokeDbSnapshotForScope(settingsRef.current, scope);
        const sourceFingerprint = scope === null
            ? undefined
            : await readInvokeSourceFingerprint(rootPath, scope);
        const reconcileSourceFacts = scope !== null
            && (
                !isInvokeDbSnapshotScopeCurrent(targetSnapshot, scope)
                || !sourceFingerprint
                || !isInvokeSourceFingerprintCurrent(targetSnapshot?.sourceFingerprint, sourceFingerprint)
            );
        const reconcileBoardOwners = scope !== null
            && settingsRef.current.syncBoardsToCollections === true
            && settingsRef.current.invokeSyncBoards !== false;
        const reportProgress = (current: number, total: number, message?: string) => {
            setInvokeOwnerScopeState({
                status: 'applying',
                rootPath,
                scope: scope ?? undefined,
                discovery: discoveryWithStaleOwner,
                progress: { current, total, message },
            });
        };
        reportProgress(0, 0, reconcileSourceFacts
            ? 'Preparing InvokeAI library upgrade...'
            : 'Checking your saved InvokeAI view...');
        const previousSelection = settingsRef.current.invokeOwnerSelection
            && isSameInvokePath(settingsRef.current.invokeOwnerSelection.dbPath, discovery.dbPath)
            ? settingsRef.current.invokeOwnerSelection
            : undefined;
        const result = await applyInvokeOwnerScope({
            discovery,
            selection,
            reconcileSourceFacts,
            reconcileBoardOwners,
            forceVisibilityRefresh: forceRefresh,
            onProgress: reportProgress,
        });
        let cacheRepair = resolveInvokeScopeCacheRepair(result.cacheRepair);
        if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
            const rollback = await refreshInvokeOwnerVisibility(discovery, previousSelection);
            await refreshAfterOwnerScopeChange();
            throw new Error('InvokeAI path changed while owner scope was loading.');
        }
        const repairedSnapshot = targetSnapshot
            && (reconcileSourceFacts || (reconcileBoardOwners && !result.boardScopeWarning))
            ? {
                ...targetSnapshot,
                ...(reconcileSourceFacts && sourceFingerprint ? { sourceFingerprint } : {}),
                ...(reconcileBoardOwners && !result.boardScopeWarning ? {
                    syncBoardsToCollections: settingsRef.current.syncBoardsToCollections === true,
                    boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
                } : {}),
            }
            : undefined;
        const needsCachePreparation = scope !== null;
        try {
            if (result.changed
                || result.boardCollectionsUpdated > 0
                || forceRefresh
                || reconcileSourceFacts
                || needsCachePreparation) {
                const repairMessage = cacheRepair.action === 'restored'
                    ? 'Restoring cached InvokeAI view...'
                    : cacheRepair.action === 'selective'
                        ? 'Updating changed InvokeAI filters and collections...'
                        : 'Rebuilding InvokeAI filters and collections...';
                reportProgress(0, 0, repairMessage);
                cacheRepair = await refreshAfterOwnerScopeChange();
            }
            if (persistSelection || repairedSnapshot) {
                await persistOwnerSelection(selection, rootPath, scope, repairedSnapshot);
            }
        } catch (preparationError) {
            try {
                const rollback = await refreshInvokeOwnerVisibility(discovery, previousSelection);
                await refreshAfterOwnerScopeChange();
            } catch (rollbackError) {
                throw new AggregateError(
                    [preparationError, rollbackError],
                    'Owner scope preparation failed and the previous view could not be restored.'
                );
            }
            throw preparationError;
        }

        if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
            return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
        }

        const allowed = scope !== null;
        const reason = result.mode === 'unselected'
            ? 'Choose an InvokeAI owner or All users before syncing.'
            : undefined;
        setInvokeOwnerScopeState({
            status: result.mode === 'unselected'
                ? 'selection_required'
                : deferReady ? 'applying' : 'ready',
            rootPath,
            scope: scope ?? undefined,
            discovery: discoveryWithStaleOwner,
            progress: deferReady
                ? { current: 0, total: 0, message: 'Catching up this InvokeAI view...' }
                : undefined,
            warning: result.boardScopeWarning,
        });
        const admission = {
            rootPath,
            allowed,
            scope: scope ?? undefined,
            reason,
            sourceFactsReconciled: reconcileSourceFacts,
            boardOwnersReconciled: reconcileBoardOwners && !result.boardScopeWarning,
            boardScopeWarning: result.boardScopeWarning,
            cacheRepair,
        };
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
                ? (cachedAdmission.scope.mode === 'legacy'
                    ? !settingsRef.current.invokeOwnerSelection
                    : isInvokeSyncScopeSelectionCurrent(
                        cachedAdmission.scope,
                        settingsRef.current.invokeOwnerSelection
                    ))
                : !settingsRef.current.invokeOwnerSelection) {
                return cachedAdmission;
            }
            ownerScopeAdmissionRef.current = null;
        }
        const cachedOfflineScope = cachedAdmission?.rootPath === rootPath && cachedAdmission.offline
            ? cachedAdmission.scope
            : undefined;
        const trustedOfflineScope = cachedOfflineScope
            && (cachedOfflineScope.mode === 'legacy'
                ? !settingsRef.current.invokeOwnerSelection
                : isInvokeSyncScopeSelectionCurrent(
                    cachedOfflineScope,
                    settingsRef.current.invokeOwnerSelection
                ))
            ? cachedOfflineScope
            : undefined;
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
            if (trustedOfflineScope) {
                setInvokeOwnerScopeState(previous => ({
                    ...previous,
                    status: 'offline_ready',
                    rootPath,
                    scope: trustedOfflineScope,
                    isRetrying: true,
                }));
            } else {
                setInvokeOwnerScopeState({
                    status: 'discovering',
                    rootPath,
                    progress: { current: 0, total: 0, message: 'Checking InvokeAI owner information...' },
                });
            }

            let discovery: InvokeOwnerDiscovery;
            try {
                discovery = await discoverInvokeOwners(rootPath);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                let offlineScope = trustedOfflineScope ?? null;
                if (!offlineScope) {
                    try {
                        offlineScope = await readTrustedInvokeOwnerScope(rootPath, settingsRef.current);
                    } catch (verificationError) {
                        console.error('[InvokeAI Owner Scope] Trusted local scope verification failed.', verificationError);
                    }
                }
                if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
                    return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
                }
                if (offlineScope) {
                    const admission: InvokeOwnerAdmission = {
                        rootPath,
                        allowed: false,
                        scope: offlineScope,
                        reason: 'InvokeAI is unavailable while Ambit is using the last verified local view.',
                        offline: true,
                    };
                    ownerScopeAdmissionRef.current = admission;
                    setInvokeOwnerScopeState({
                        status: 'offline_ready',
                        rootPath,
                        scope: offlineScope,
                        error: message,
                        failure: { kind: 'source_unavailable', details: message },
                        isRetrying: false,
                    });
                    return admission;
                }

                setInvokeOwnerScopeState({
                    status: 'error',
                    rootPath,
                    error: message,
                    failure: { kind: 'source_unavailable', details: message },
                });
                const admission = { rootPath, allowed: false, reason: message };
                ownerScopeAdmissionRef.current = admission;
                return admission;
            }

            if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
                return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
            }

            try {
                const saved = settingsRef.current.invokeOwnerSelection;
                let selection = saved && isSameInvokePath(saved.dbPath, discovery.dbPath) ? saved : undefined;
                let shouldPersistSelection = !!saved && !selection;

                if (discovery.schemaMode === 'legacy') {
                    shouldPersistSelection = shouldPersistSelection || !!selection;
                    selection = undefined;
                } else if (!selection
                    && discovery.owners.length === 1
                    && discovery.unassignedImageCount === 0
                    && (discovery.unassignedBoardCount ?? 0) === 0) {
                    selection = {
                        dbPath: discovery.dbPath,
                        mode: 'owner',
                        ownerId: discovery.owners[0].ownerId,
                    };
                    shouldPersistSelection = true;
                }

                const resolvedScope = resolveInvokeSyncScope(discovery, selection);
                const resolvedSnapshot = getInvokeDbSnapshotForScope(
                    settingsRef.current,
                    resolvedScope
                );
                const hasPersistedSyncState = settingsRef.current.lastSyncedAt != null
                    || settingsRef.current.invokeDbSnapshot !== undefined
                    || (settingsRef.current.invokeDbSnapshots?.length ?? 0) > 0;
                if (hasPersistedSyncState
                    && !isInvokeDbSnapshotScopeCurrent(
                        resolvedSnapshot,
                        resolvedScope
                    )) {
                    shouldPersistSelection = true;
                }

                if (trustedOfflineScope
                    && !shouldPersistSelection
                    && isSameInvokeSyncScope(trustedOfflineScope, resolvedScope)
                    && isInvokeDbSnapshotScopeCurrent(resolvedSnapshot, resolvedScope)) {
                    const admission: InvokeOwnerAdmission = {
                        rootPath,
                        allowed: true,
                        scope: trustedOfflineScope,
                        sourceFactsReconciled: false,
                    };
                    ownerScopeAdmissionRef.current = admission;
                    setInvokeOwnerScopeState({
                        status: 'ready',
                        rootPath,
                        scope: trustedOfflineScope,
                        discovery,
                    });
                    return admission;
                }

                const admission = await applyDiscoveredOwnerScope(
                    discovery,
                    selection,
                    shouldPersistSelection,
                    rootPath,
                    force
                );
                if (hasPersistedSyncState && admission.sourceFactsReconciled && admission.allowed) {
                    pendingInvokeViewReadyAnnouncementRootRef.current = rootPath;
                }
                if (settingsRef.current.invokeAiPath?.trim() !== rootPath) {
                    if (ownerScopeAdmissionRef.current?.rootPath === rootPath) {
                        ownerScopeAdmissionRef.current = null;
                    }
                    return { rootPath, allowed: false, reason: 'InvokeAI path changed while owner scope was loading.' };
                }
                return admission;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setInvokeOwnerScopeState({
                    status: 'error',
                    rootPath,
                    discovery,
                    error: message,
                    failure: { kind: 'preparation_failed', details: message },
                });
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
                startPendingInvokeLiveRerun();
            }
        }
    }, [applyDiscoveredOwnerScope, settingsRef, startPendingInvokeLiveRerun]);

    const selectInvokeOwnerScope = useCallback(async (selection: InvokeOwnerSelection): Promise<boolean> => {
        if (activeInvokeSyncScopeRef.current || syncStatus === 'syncing') {
            addToast('Wait for the active InvokeAI sync before changing owner scope.', 'warning');
            return false;
        }
        const discovery = invokeOwnerScopeState.discovery;
        const currentRoot = settingsRef.current.invokeAiPath?.trim();
        if (!discovery
            || !isSameInvokePath(discovery.dbPath, selection.dbPath)
            || !currentRoot
            || ownerScopeAdmissionRef.current?.rootPath !== currentRoot) {
            addToast('Refresh the InvokeAI owner list before changing scope.', 'warning');
            return false;
        }
        if (ownerScopePromiseRef.current || ownerTransitionRef.current) return false;
        const currentSelection = settingsRef.current.invokeOwnerSelection;
        if (invokeOwnerScopeState.status === 'ready'
            && ownerScopeAdmissionRef.current?.rootPath === currentRoot
            && currentSelection
            && isSameInvokePath(currentSelection.dbPath, selection.dbPath)
            && currentSelection.mode === selection.mode
            && (selection.mode === 'all'
                || (currentSelection.mode === 'owner' && currentSelection.ownerId === selection.ownerId))) {
            return true;
        }
        const transitionToken = Symbol('invoke-owner-transition');
        ownerTransitionRef.current = { rootPath: currentRoot, token: transitionToken };
        const promise = applyDiscoveredOwnerScope(
            discovery,
            selection,
            true,
            currentRoot,
            false,
            true
        );
        ownerScopePromiseRef.current = { rootPath: currentRoot, promise };
        try {
            const admission = await promise;
            if (settingsRef.current.invokeAiPath?.trim() !== currentRoot) {
                return false;
            }
            if (!admission.allowed || !admission.scope) {
                return false;
            }
            pendingInvokeViewReadyAnnouncementRootRef.current = null;
            const syncOutcome = await runInvokeSyncRef.current({
                mode: 'startup',
                ownerTransitionToken: transitionToken,
            });
            if (syncOutcome.status !== 'completed') {
                pendingInvokeViewReadyAnnouncementRootRef.current = null;
                await applyDiscoveredOwnerScope(
                    discovery,
                    currentSelection && isSameInvokePath(currentSelection.dbPath, discovery.dbPath)
                        ? currentSelection
                        : undefined,
                    true,
                    currentRoot,
                    true
                );
                const failureMessage = 'message' in syncOutcome
                    ? syncOutcome.message?.trim()
                    : undefined;
                addToast(
                    failureMessage
                        ? `Could not change InvokeAI owner scope: ${failureMessage.replace(/[.!?]+$/, '')}. The previous view was restored.`
                        : 'Could not change InvokeAI owner scope. The previous view was restored.',
                    'error'
                );
                return false;
            }
            setInvokeOwnerScopeState({
                status: 'ready',
                rootPath: currentRoot,
                scope: admission.scope,
                discovery,
                warning: admission.boardScopeWarning,
            });
            addToast('Your InvokeAI view is ready.', 'success');
            return true;
        } catch (error) {
            let failure = error;
            if (currentSelection
                && isSameInvokePath(currentSelection.dbPath, discovery.dbPath)
                && settingsRef.current.invokeAiPath?.trim() === currentRoot) {
                try {
                    const rollbackAdmission = await applyDiscoveredOwnerScope(
                        discovery,
                        currentSelection,
                        true,
                        currentRoot,
                        true
                    );
                    if (rollbackAdmission.allowed) {
                        const message = error instanceof Error ? error.message : String(error);
                        addToast(
                            `Could not change InvokeAI owner scope: ${message.replace(/[.!?]+$/, '')}. The previous view was restored.`,
                            'error'
                        );
                        return false;
                    }
                } catch (rollbackError) {
                    failure = new AggregateError(
                        [error, rollbackError],
                        'Owner scope preparation failed and the previous view could not be restored.'
                    );
                }
            }
            const message = failure instanceof Error ? failure.message : String(failure);
            setInvokeOwnerScopeState({
                status: 'error',
                rootPath: currentRoot,
                discovery,
                error: message,
                failure: { kind: 'preparation_failed', details: message },
            });
            addToast(`Could not update InvokeAI owner scope: ${message}`, 'error');
            return false;
        } finally {
            if (ownerScopePromiseRef.current?.promise === promise) {
                ownerScopePromiseRef.current = null;
            }
            if (ownerTransitionRef.current?.token === transitionToken) {
                ownerTransitionRef.current = null;
            }
            startPendingInvokeLiveRerun();
        }
    }, [addToast, applyDiscoveredOwnerScope, invokeOwnerScopeState.discovery, invokeOwnerScopeState.status, settingsRef, startPendingInvokeLiveRerun, syncStatus]);

    const retryInvokeOwnerScope = useCallback(async (): Promise<boolean> => {
        const admission = await ensureInvokeOwnerScope(true);
        if (admission.allowed) {
            pendingInvokeViewReadyAnnouncementRootRef.current = admission.rootPath;
            return true;
        }
        return false;
    }, [ensureInvokeOwnerScope]);

    useEffect(() => {
        if (!settingsLoaded) return;
        const configuredRootPath = settings.invokeAiPath?.trim();
        if (pendingInvokeViewReadyAnnouncementRootRef.current !== configuredRootPath) {
            pendingInvokeViewReadyAnnouncementRootRef.current = null;
        }
        ownerScopeAdmissionRef.current = null;
        if (activeInvokeSyncScopeRef.current) return;
        void ensureInvokeOwnerScope().catch(() => {
            // The initiating selection flow owns reporting a concurrently shared rejection.
        });
    }, [
        ensureInvokeOwnerScope,
        settings.invokeAiPath,
        settings.invokeOwnerSelection,
        settings.invokeSyncBoards,
        settings.syncBoardsToCollections,
        settingsLoaded,
    ]);

    const runInvokeSync = useCallback(async (optionsInput?: RunInvokeSyncOptions): Promise<InvokeSyncOutcome> => {
        if (isBrowserMockMode()) {
            addToast('Unavailable in browser mock mode.', 'info');
            return { status: 'blocked', message: 'Unavailable in browser mock mode.' };
        }

        const options = {
            syncFavorites: settingsRef.current.invokeSyncFavorites !== false,
            syncBoards: settingsRef.current.invokeSyncBoards !== false,
            starredAs: settingsRef.current.starredAs || 'favorite',
            ...optionsInput,
            mode: optionsInput?.mode ?? 'manual',
        };
        const queueLiveRerun = () => {
            pendingInvokeLiveSyncRef.current = true;
            pendingInvokeLivePerfRef.current = mergePendingInvokePerfContext(
                pendingInvokeLivePerfRef.current,
                options.perfContext
            );
            debugLiveWatchPerf('Invoke live rerun queued', {
                cycleId: pendingInvokeLivePerfRef.current?.cycleId ?? options.perfContext?.cycleId,
                eventCount: pendingInvokeLivePerfRef.current?.eventCount,
                pathCount: pendingInvokeLivePerfRef.current?.pathCount,
                mergedCycleCount: pendingInvokeLivePerfRef.current?.mergedCycleCount ?? 1
            });
        };
        const gateOwnerTransition = (expectedRootPath?: string): InvokeSyncOutcome | null => {
            const activeTransition = ownerTransitionRef.current;
            const ownsTransition = !!options.ownerTransitionToken
                && activeTransition?.token === options.ownerTransitionToken
                && (!expectedRootPath || activeTransition.rootPath === expectedRootPath);
            if (options.ownerTransitionToken && !ownsTransition) {
                return { status: 'blocked', message: 'InvokeAI owner transition is no longer current.' };
            }
            if (!activeTransition || ownsTransition) return null;
            if (options.mode === 'live') {
                queueLiveRerun();
                return { status: 'queued' };
            }
            if (options.mode === 'startup') {
                console.info('[InvokeAI Sync] Startup request was coalesced into the active owner transition.');
                return { status: 'queued' };
            }
            return { status: 'busy', message: 'InvokeAI owner scope is changing.' };
        };

        const transitionOutcomeBeforeAdmission = gateOwnerTransition();
        if (transitionOutcomeBeforeAdmission) return transitionOutcomeBeforeAdmission;
        const ownerAdmission = await ensureInvokeOwnerScope();
        if (!ownerAdmission.allowed || !ownerAdmission.scope) {
            if (options.mode === 'manual') {
                addToast(ownerAdmission.reason || 'InvokeAI sync is blocked by owner scope.', 'warning');
            } else {
                console.info('[InvokeAI Sync] Skipped by owner scope.', { reason: ownerAdmission.reason });
            }
            return { status: 'blocked', message: ownerAdmission.reason };
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
        const transitionOutcomeAfterAdmission = gateOwnerTransition(capturedRootPath);
        if (transitionOutcomeAfterAdmission) return transitionOutcomeAfterAdmission;
        if (!isCapturedScopeCurrent()) {
            return { status: 'busy', message: 'InvokeAI owner scope changed before synchronization could start.' };
        }
        const isStartupMode = options.mode === 'startup';
        const announcePreparedInvokeView = (outcome: 'catchup' | 'current' | 'unavailable') => {
            if (!isStartupMode || pendingInvokeViewReadyAnnouncementRootRef.current !== capturedRootPath) return;
            pendingInvokeViewReadyAnnouncementRootRef.current = null;
            const catchesUpBoards = options.syncBoards !== false;
            const message = outcome === 'catchup'
                ? catchesUpBoards
                    ? 'Your InvokeAI view is ready. Ambit is catching up images and boards in the background. You can use your library now.'
                    : 'Your InvokeAI view is ready. Ambit is catching up images in the background. You can use your library now.'
                : outcome === 'current'
                    ? 'Your InvokeAI view is ready. You can use your library now.'
                    : 'Your saved InvokeAI view is available, but catch-up could not start because the InvokeAI database file is unavailable.';
            addToast(
                message,
                outcome === 'unavailable' ? 'warning' : 'success'
            );
        };
        let startupSyncVisible = false;
        const setVisibleStartupProgress = (progress: NonNullable<typeof syncProgress>) => {
            if (!startupSyncVisible) {
                startupSyncVisible = true;
                setSyncStatus('syncing');
            }
            setSyncProgress(progress);
            if (useInvokeOwnerScopeStore.getState().ownerScopeState.status === 'applying') {
                setInvokeOwnerScopeState(previous => ({
                    ...previous,
                    progress,
                }));
            }
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
        const savedScopeSnapshot = getInvokeDbSnapshotForScope(settingsRef.current, capturedScope);
        const boardOwnerSchemaVersion = ownerAdmission.boardOwnersReconciled
            || isInvokeBoardOwnerSnapshotCurrent(savedScopeSnapshot)
            ? INVOKE_BOARD_OWNER_SCHEMA_VERSION
            : 0;
        const effectiveSnapshotConfig = {
            lastSyncedAt: effectiveTimestamp,
            importIntermediates: effectiveImportIntermediates,
            importOrphans: shouldImportOrphans,
            syncBoardsToCollections: settingsRef.current.syncBoardsToCollections,
            scopeMode: capturedScope.mode,
            scopeOwnerId: capturedScope.mode === 'owner' ? capturedScope.ownerId : null,
            boardOwnerSchemaVersion,
        };
        const shouldUseStartupSnapshot =
            options.mode === 'startup'
            && !!settingsRef.current.invokeAiPath
            && shouldImportOrphans === false;
        const shouldReconcileSourceFacts =
            options.mode !== 'live'
            && !isInvokeImportSchemaCurrent(savedScopeSnapshot)
            && !ownerAdmission.sourceFactsReconciled;

        if (options.mode === 'live'
            && (ownerScopePromiseRef.current
                || ownerTransitionRef.current
                || activeInvokeSyncRunRef.current
                || syncStatus === 'syncing'
                || isLiveSyncingRef.current)) {
            queueLiveRerun();
            return { status: 'queued' };
        }

        const activeRun = activeInvokeSyncRunRef.current;
        if (activeRun) {
            if (options.mode === 'startup'
                && activeRun.mode === 'startup'
                && isSameInvokeSyncScope(activeRun.scope, capturedScope)) {
                console.info('[InvokeAI Sync] Joined active startup sync for the selected owner scope.');
                return activeRun.promise;
            }
            return { status: 'busy', message: 'Another InvokeAI synchronization is active.' };
        }
        if (activeInvokeSyncScopeRef.current || syncStatus === 'syncing') {
            return { status: 'busy', message: 'Another library synchronization is active.' };
        }

        let resolveActiveRun!: (outcome: InvokeSyncOutcome) => void;
        const activeRunPromise = new Promise<InvokeSyncOutcome>((resolve) => {
            resolveActiveRun = resolve;
        });
        activeInvokeSyncRunRef.current = {
            scope: capturedScope,
            mode: options.mode,
            promise: activeRunPromise,
        };
        let syncOutcome: InvokeSyncOutcome = {
            status: 'failed',
            message: 'InvokeAI synchronization ended without a result.',
        };
        let activeRunFinished = false;
        const finishActiveRun = (outcome: InvokeSyncOutcome) => {
            syncOutcome = outcome;
            if (activeRunFinished) return;
            activeRunFinished = true;
            resolveActiveRun(outcome);
            if (activeInvokeSyncRunRef.current?.promise === activeRunPromise) {
                activeInvokeSyncRunRef.current = null;
            }
            startPendingInvokeLiveRerun();
        };
        activeInvokeSyncScopeRef.current = capturedScope;
        setIsInvokeSyncActive(true);

        const persistSnapshotState = async (snapshot: InvokeDbSnapshotState) => {
            await settingsPersistenceCoordinator.run(async () => {
                if (!isCapturedScopeCurrent()) {
                    throw new Error('InvokeAI owner scope changed before the sync snapshot could be saved.');
                }
                const nextSettings = {
                    ...useSettingsStore.getState().settings,
                    invokeDbSnapshot: snapshot,
                    invokeDbSnapshots: upsertInvokeDbSnapshot(
                        useSettingsStore.getState().settings.invokeDbSnapshots,
                        snapshot
                    ),
                };
                setSettings(nextSettings);
                await useSettingsStore.getState().flushSettings(nextSettings);
            });
        };

        if (shouldUseStartupSnapshot) {
            const snapshotStartedAt = liveWatchNow();
            try {
                const currentSnapshot = await readInvokeDbSnapshotState(
                    capturedRootPath,
                    effectiveSnapshotConfig
                );
                const dbSnapshotFile = currentSnapshot.files.find(file => file.path === currentSnapshot.dbPath);

                if (dbSnapshotFile && !dbSnapshotFile.exists) {
                    announcePreparedInvokeView('unavailable');
                    console.warn('[Startup Catch-up] Invoke DB file is missing; skipped SQLite sync.', {
                        dbPath: currentSnapshot.dbPath,
                        checkMs: elapsedMs(snapshotStartedAt)
                    });
                    if (activeInvokeSyncScopeRef.current === capturedScope) activeInvokeSyncScopeRef.current = null;
                    setIsInvokeSyncActive(false);
                    const outcome: InvokeSyncOutcome = {
                        status: 'source_unavailable',
                        message: 'The InvokeAI database file is unavailable.',
                    };
                    finishActiveRun(outcome);
                    return outcome;
                }

                if (isInvokeDbSnapshotCurrent(savedScopeSnapshot, currentSnapshot)) {
                    announcePreparedInvokeView('current');
                    console.info('[Startup Catch-up] Invoke DB snapshot unchanged; skipped SQLite sync.', {
                        dbPath: currentSnapshot.dbPath,
                        checkMs: elapsedMs(snapshotStartedAt)
                    });
                    if (activeInvokeSyncScopeRef.current === capturedScope) activeInvokeSyncScopeRef.current = null;
                    setIsInvokeSyncActive(false);
                    const outcome: InvokeSyncOutcome = { status: 'completed' };
                    finishActiveRun(outcome);
                    return outcome;
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
            setInvokeSyncActivityKind(isStartupMode ? 'startup' : 'manual');
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
                || (shouldImportOrphans
                    && !shouldReconcileSourceFacts
                    && !ownerAdmission.sourceFactsReconciled)
            ) return;

            try {
                const snapshot = await readInvokeDbSnapshotState(
                    capturedRootPath,
                    {
                        ...effectiveSnapshotConfig,
                        lastSyncedAt,
                        // Orphan recovery is manual-only and does not change whether the Invoke DB was synced.
                        importOrphans: false,
                        sourceFingerprint: await readInvokeSourceFingerprint(
                            capturedRootPath,
                            capturedScope
                        ),
                    }
                );
                await persistSnapshotState(snapshot);
            } catch (snapshotError) {
                console.warn('[Startup Catch-up] Failed to persist Invoke DB snapshot.', snapshotError);
            }
        };

        let syncCacheClaim: InvokeScopeCacheBuildClaim | null = null;
        try {
            const { syncImages } = await import('../services/invoke/syncService');
            const syncResultPromise = syncImages(
                capturedRootPath,
                (c, t, msg) => {
                    if (isStartupMode) {
                        announcePreparedInvokeView('catchup');
                    }
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
            const { imported, updated, maxTimestamp: newTs, boardMapping, boardsChanged, syncedIds, touchedFacetTypes, touchedFacetResources } = await syncResultPromise;
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
            const hasBoardMapping = !!boardMapping && boardMapping.size > 0;
            const shouldRefreshBoardCollections = settingsRef.current.syncBoardsToCollections
                && options.syncBoards !== false
                && (isStartupMode || hasBoardMapping || boardsChanged);

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
            const hasChanges = (imported || 0) > 0
                || (updated || 0) > 0
                || orphansImported > 0
                || boardsChanged;
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
                    if (totalProcessed > 0) {
                        reportLiveImagesReceived(totalProcessed, { source: 'invoke' });
                    }
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

                    const liveCacheClaim = await unwrap(commands.beginActiveInvokeScopeCacheBuild());
                    const facetRefreshPromise = queueLiveFacetRefresh(touchedFacetTypes, {
                        source: 'invoke',
                        cycleId: livePerfContext?.cycleId,
                        changedImageCount: totalProcessed
                    }, touchedFacetResources);

                    const collectionRefreshPromise = shouldRefreshBoardCollections
                        ? refreshCollections(false, {
                            scheduleSmartRefresh: false,
                            consistency: 'authoritative',
                        }).then(() => (hasBoardMapping || boardsChanged)
                            ? Promise.all([
                                refreshCollectionThumbnails(true),
                                refreshSmartCounts({ includeArchived: false, markPending: false }),
                            ])
                            : undefined)
                        : Promise.resolve();
                    try {
                        await Promise.all([facetRefreshPromise, collectionRefreshPromise]);
                        if (isCapturedScopeCurrent()) {
                            if (liveCacheClaim.cacheRepair.action !== 'restored') {
                                await unwrap(commands.commitActiveInvokeScopeCache({
                                    scopeKey: liveCacheClaim.scopeKey,
                                    generation: liveCacheClaim.generation,
                                }));
                            }
                        } else {
                            await abortInvokeScopeCacheClaim(liveCacheClaim, 'live sync scope drift');
                        }
                    } catch (error) {
                        await abortInvokeScopeCacheClaim(liveCacheClaim, 'live sync refresh');
                        const message = error instanceof Error ? error.message : String(error);
                        if (message.includes('changed while it was being prepared')) {
                            try {
                                await refreshAfterOwnerScopeChange(1);
                            } catch (retryError) {
                                console.error('[Sync] Active Invoke scope cache was superseded twice after live sync', retryError);
                            }
                        } else {
                            console.error('[Sync] Failed to preserve the active Invoke scope cache after live sync', error);
                        }
                    }
                } else {
                    // MANUAL HEAVY REBUILD
                    if (isStartupMode) {
                        setVisibleStartupProgress({ current: totalProcessed, total: totalProcessed, message: 'Updating gallery...' });
                    } else {
                        setSyncProgress({ current: totalProcessed, total: totalProcessed, message: 'Updating gallery...' });
                    }

                    // IMMEDIATE UI REFRESH (Block here until data hits RAM)
                    await queryClient.invalidateQueries({ queryKey: ['images'] });

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
                        syncCacheClaim = await unwrap(commands.beginActiveInvokeScopeCacheBuild());
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
                        if (syncCacheClaim) {
                            await abortInvokeScopeCacheClaim(syncCacheClaim, 'sync facet refresh');
                            syncCacheClaim = null;
                        }
                        console.error('[Sync] Failed to rebuild facet cache after sync', e);
                        setSyncStatus('error');
                        syncOutcome = {
                            status: 'failed',
                            message: e instanceof Error ? e.message : String(e),
                        };
                        return syncOutcome; // Halt completion if critical DB error
                    }

                    const clearedMessageProgress = { ...useLibraryStore.getState().syncProgress, message: undefined };
                    setSyncProgress(clearedMessageProgress);

                    // Trigger complete routines
                    addToast(`Synchronization complete: ${totalProcessed} items processed.`, 'success');
                    
                    if (options.mode !== 'startup') {
                        await onSyncComplete?.('full');
                    } else {
                        if (shouldRefreshBoardCollections) {
                            await refreshCollections(false, {
                                consistency: 'authoritative',
                            });
                        }
                        setSyncStatus('complete');
                    }

                    if (hasBoardMapping || boardsChanged) {
                        await refreshCollectionThumbnails(true);
                    }

                    if (syncCacheClaim && syncCacheClaim.cacheRepair.action !== 'restored') {
                        try {
                            await unwrap(commands.commitActiveInvokeScopeCache({
                                scopeKey: syncCacheClaim.scopeKey,
                                generation: syncCacheClaim.generation,
                            }));
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            if (!message.includes('changed while it was being prepared')) throw error;
                            await refreshAfterOwnerScopeChange(1);
                        }
                    }
                    syncCacheClaim = null;

                    await persistInvokeSnapshot(snapshotCursor);
                    syncOutcome = { status: 'completed' };
                    return syncOutcome;
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
                if (shouldRefreshBoardCollections) {
                    await refreshCollections(false, {
                        consistency: 'authoritative',
                    });
                    if (hasBoardMapping || boardsChanged) {
                        await Promise.all([
                            refreshCollectionThumbnails(true),
                            refreshSmartCounts({ includeArchived: false, markPending: false }),
                        ]);
                    }
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

            syncOutcome = { status: 'completed' };

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            if (message === 'Aborted') {
                liveOutcome = 'aborted';
                syncOutcome = { status: 'aborted', message };
                setSyncStatus('idle');
            }
            else {
                liveOutcome = 'errored';
                syncOutcome = { status: 'failed', message };
                console.error('Sync failed', e);
                setSyncStatus('error');
                const isOwnerTransitionStartup = options.mode === 'startup' && !!options.ownerTransitionToken;
                if (options.mode === 'manual' || (options.mode === 'startup' && !isOwnerTransitionStartup)) {
                    addToast('Sync failed: ' + message, 'error');
                }
            }
        } finally {
            if (syncCacheClaim) {
                await abortInvokeScopeCacheClaim(syncCacheClaim, 'sync completion');
                syncCacheClaim = null;
            }
            if (activeInvokeSyncScopeRef.current === capturedScope) {
                activeInvokeSyncScopeRef.current = null;
            }
            setIsInvokeSyncActive(false);
            setInvokeSyncActivityKind(null);
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
                try {
                    await ensureInvokeOwnerScope(true);
                } catch (scopeError) {
                    console.error('[InvokeAI Sync] Failed to restore owner admission after scope drift.', scopeError);
                }
            }
            finishActiveRun(syncOutcome);
        }
        return syncOutcome;
    }, [syncStatus, addToast, ensureInvokeOwnerScope, onSyncComplete, onInvokeContentChanged, queryClient, queueLiveFacetRefresh, incrementFacetCacheVersion, refreshAfterOwnerScopeChange, setSettings, setCollections, refreshCollections, refreshCollectionThumbnails, refreshSmartCounts, setSyncStatus, setSyncProgress, setInvokeOwnerScopeState, setInvokeSyncActivityKind, setIsLiveSyncing, startLiveWatchSession, startPendingInvokeLiveRerun, updateLiveWatchSession, reportLiveImagesReceived]);

    runInvokeSyncRef.current = runInvokeSync;

    const startInvokeSync = useCallback(async (options?: StartInvokeSyncOptions): Promise<void> => {
        await runInvokeSync(options);
    }, [runInvokeSync]);

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
                    message: 'Importing new items...',
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
                                message: message || 'Importing new items...',
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
                            invokeDbSnapshot: undefined,
                            invokeDbSnapshots: undefined,
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
