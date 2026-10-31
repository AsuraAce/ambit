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
import { discoverInvokeOwners, inspectInvokeConnection, invalidateInvokeSourceDatabase, readInvokeSourceFingerprint, resolveInvokePaths } from '../services/invoke/connection';
import { getInvokeConnectionDraft, isSameInvokeConnectionSource, isSameInvokeOwnerSelection, type InvokeConnectionDraft } from '../services/invoke/connectionDraft';
import { ensureAssetPathAccessible } from '../services/assetScope';
import { measureStartupPhase, startupDiagnostics } from '../utils/startupDiagnostics';
import { applyInvokeOwnerScope, refreshInvokeOwnerVisibility } from '../services/invoke/ownerScope';
import { throwIfInvokeAborted } from '../services/invoke/abort';
import { describeInvokeRepairDecision } from '../services/invoke/repairDecision';
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
    type InvokeOperationState,
} from '../stores/invokeOwnerScopeStore';
import { commands } from '../bindings';
import type { InvokeScopeCacheBuildClaim, InvokeScopeCacheRepairPlan } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { invokeSyncTrace } from '../utils/invokeSyncTrace';

export type { InvokeOwnerScopeState } from '../stores/invokeOwnerScopeStore';

const updateInvokeOperation = (id: symbol, patch: Partial<InvokeOperationState>): void => {
    useInvokeOwnerScopeStore.getState().setOperation(previous => previous?.id === id
        ? { ...previous, ...patch } : previous);
};

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
    skipStartupSnapshot?: boolean;
    controller?: AbortController;
}

export type InvokeSyncOutcome =
    | { status: 'completed' }
    | { status: 'queued' }
    | { status: 'blocked' | 'busy' | 'source_unavailable' | 'aborted' | 'failed'; message?: string };

export type InvokeConnectionApplyOutcome = InvokeSyncOutcome & { viewCommitted: boolean };
export interface ApplyInvokeConnectionOptions {
    onAccepted?: () => void;
}

interface ActiveInvokeSyncRun {
    scope: InvokeSyncScope;
    mode: NonNullable<StartInvokeSyncOptions['mode']>;
    promise: Promise<InvokeSyncOutcome>;
}

interface InvokeOwnerTransition {
    rootPath: string;
    token: symbol;
    appliesConfiguration?: boolean;
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
    // Content changes already applied during preparation, consumed by the next successful sync.
    hasPreparationChanges?: boolean;
    boardScopeWarning?: string;
    cacheRepair?: InvokeScopeCacheRepairPlan;
    offline?: boolean;
}

interface SyncContextType {
    applyInvokeConnection: (draft: InvokeConnectionDraft, options?: ApplyInvokeConnectionOptions) => Promise<InvokeConnectionApplyOutcome>;
    startInvokeSync: (options?: StartInvokeSyncOptions) => Promise<InvokeSyncOutcome>;
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
    const refreshCollections = useCollectionStore(s => s.refreshCollections);
    const refreshCollectionThumbnails = useCollectionStore(s => s.refreshCollectionThumbnails);
    const refreshSmartCounts = useCollectionStore(s => s.refreshSmartCounts);

    useEffect(() => {
        if (!invokeSyncTrace.enabled) return;
        invokeSyncTrace.observeOperation(useInvokeOwnerScopeStore.getState().operation);
        const unsubscribe = useInvokeOwnerScopeStore.subscribe((state, previous) => {
            if (state.operation !== previous.operation) invokeSyncTrace.observeOperation(state.operation);
        });
        return () => {
            unsubscribe();
            invokeSyncTrace.dispose();
        };
    }, []);

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
    const sourceConnectionRootRef = useRef<string | undefined>(undefined);
    const activeInvokeSyncScopeRef = useRef<InvokeSyncScope | null>(null);
    const pendingInvokeViewReadyAnnouncementRootRef = useRef<string | null>(null);
    const runInvokeSyncRef = useRef<(options?: RunInvokeSyncOptions) => Promise<InvokeSyncOutcome>>(
        async () => ({ status: 'failed', message: 'InvokeAI synchronization is not ready.' })
    );
    const applyInvokeConnectionRef = useRef<SyncContextType['applyInvokeConnection']>(
        async () => ({ status: 'busy', viewCommitted: false })
    );
    const activeInvokeSyncRunRef = useRef<ActiveInvokeSyncRun | null>(null);
    const startPendingInvokeLiveRerun = useCallback(() => {
        if (!pendingInvokeLiveSyncRef.current
            || useInvokeOwnerScopeStore.getState().ownerScopeState.status === 'error'
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
        maxAttempts: 1 | 2 = 2,
        signal?: AbortSignal,
    ): Promise<InvokeScopeCacheRepairPlan> => {
        const traceOperationId = useInvokeOwnerScopeStore.getState().operation?.id;
        const generation = useCollectionStore.getState().getInitializationGeneration();
        const assertCurrentCollections = () => {
            throwIfInvokeAborted(signal);
            if (generation !== useCollectionStore.getState().getInitializationGeneration()) {
                throw new Error('Collection initialization was superseded.');
            }
        };
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            assertCurrentCollections();
            const refreshStartedAt = performance.now();
            const claim = await invokeSyncTrace.measure(traceOperationId, 'cache-claim', () => unwrap(commands.beginActiveInvokeScopeCacheBuild()));
            const cacheRepair = claim.cacheRepair;
            const finishCache = startupDiagnostics.start('owner-cache', cacheRepair.action, attempt + 1);
            const requiresCacheBuild = cacheRepair.action !== 'restored';
            try {
            assertCurrentCollections();
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
                    assertCurrentCollections();
                    await invokeSyncTrace.measure(traceOperationId, 'facet-cache', () => measureStartupPhase('facets', () => rebuildFacetCacheStrict()));
                } else {
                    if (resourceCount > 0 && resourceCount <= 64) {
                        await invokeSyncTrace.measure(traceOperationId, 'facet-cache', () => measureStartupPhase('facets', () => refreshFacetCacheForResourcesStrict(cacheRepair.resources)));
                        assertCurrentCollections();
                    }
                    if (facetTypes.length > 0) {
                        await invokeSyncTrace.measure(traceOperationId, 'facet-cache', () => measureStartupPhase('facets', () => rebuildFacetCacheIncrementalBatchStrict(facetTypes)));
                        assertCurrentCollections();
                    }
                    if (cacheRepair.collectionsDirty) {
                        await clearCollectionOwnerScopeCaches();
                    }
                }
            }
            assertCurrentCollections();
            incrementFacetCacheVersion();
            const [, , , , , maintenanceCounts] = await Promise.all([
                invokeSyncTrace.measure(traceOperationId, 'gallery', () => queryClient.invalidateQueries({ queryKey: ['images'] })),
                queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
                queryClient.invalidateQueries({ queryKey: ['parameterRanges'] }),
                invokeSyncTrace.measure(traceOperationId, 'references', () => invalidateInvokeReferenceQueries(queryClient)),
                invokeSyncTrace.measure(traceOperationId, 'collections', () => measureStartupPhase('collections', async () => {
                    if (!useCollectionStore.getState().isLoaded) {
                        const published = await useCollectionStore.getState().initialize({
                            generation, deferHydration: true,
                        });
                        if (!published) throw new Error('Collection initialization was superseded.');
                    } else {
                        await refreshCollections(false, {
                            includeThumbnails: false,
                            scheduleSmartRefresh: false,
                            consistency: 'authoritative',
                        });
                    }
                })),
                measureStartupPhase('maintenance-counts', getMaintenanceCounts),
            ]);
            assertCurrentCollections();
            useLibraryStore.getState().setMaintenanceCounts(maintenanceCounts);
            if (cacheRepair.action === 'full' || cacheRepair.collectionsDirty) {
                await invokeSyncTrace.measure(traceOperationId, 'previews', () => measureStartupPhase('collections', () => Promise.all([
                    refreshSmartCounts({
                        includeArchived: true,
                        includePromptSearch: true,
                        consistency: 'authoritative',
                    }),
                    refreshCollectionThumbnails(false, true, {
                        consistency: 'authoritative',
                    }),
                ])));
            }
            assertCurrentCollections();
            if (requiresCacheBuild) {
                await invokeSyncTrace.measure(traceOperationId, 'cache-commit', () => unwrap(commands.commitActiveInvokeScopeCache({
                    scopeKey: claim.scopeKey,
                    generation: claim.generation,
                })));
            }
            assertCurrentCollections();
            useCollectionStore.getState().finishInitializationHydration(
                generation, cacheRepair.action === 'full' || cacheRepair.collectionsDirty
            );
            console.info('[InvokeAI] Library cache refresh completed.', {
                action: cacheRepair.action,
                resourceCount,
                facetTypes,
                collectionsDirty: cacheRepair.collectionsDirty,
                elapsedMs: Math.round(performance.now() - refreshStartedAt),
            });
            finishCache();
            return cacheRepair;
            } catch (error) {
                finishCache('failed', error);
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
            const latest = useSettingsStore.getState().settings;
            if (latest.invokeAiPath?.trim() !== expectedRootPath
                || !isSameInvokeOwnerSelection(latest.invokeOwnerSelection, current.invokeOwnerSelection)) {
                await useSettingsStore.getState().flushSettings(latest);
                throw new Error('InvokeAI path or owner changed while owner selection was being saved.');
            }
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
        deferReady: boolean = false,
        signal?: AbortSignal,
    ): Promise<InvokeOwnerAdmission> => {
        const expectedSelection = settingsRef.current.invokeOwnerSelection;
        const isPreparationCurrent = () => {
            const current = useSettingsStore.getState().settings;
            return current.invokeAiPath?.trim() === rootPath
                && isSameInvokeOwnerSelection(current.invokeOwnerSelection, expectedSelection);
        };
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

        throwIfInvokeAborted(signal);
        ownerScopeAdmissionRef.current = null;
        const scope = resolveInvokeSyncScope(discovery, selection);
        const targetSnapshot = getInvokeDbSnapshotForScope(settingsRef.current, scope);
        const sourceFingerprint = scope === null
            ? undefined
            : await measureStartupPhase('owner-fingerprint', () => readInvokeSourceFingerprint(rootPath, scope));
        throwIfInvokeAborted(signal);
        // All users has no cross-owner visibility boundary: a current saved view
        // can catch up ordinary source changes incrementally after admission.
        // Keep its old fingerprint until catch-up succeeds, and retain full
        // reconciliation for owner views, upgrades, unknown state and repair.
        const canCatchUpAllUsers = scope?.mode === 'all'
            && !forceRefresh
            && isInvokeDbSnapshotScopeCurrent(targetSnapshot, scope)
            && targetSnapshot?.sourceFingerprint?.schemaVersion === 1
            && sourceFingerprint?.schemaVersion === 1
            && sourceFingerprint.imageCount >= targetSnapshot.sourceFingerprint.imageCount
            && (targetSnapshot.sourceFingerprint.imageUpdatedAt === null
                || (sourceFingerprint.imageUpdatedAt !== null
                    && sourceFingerprint.imageUpdatedAt >= targetSnapshot.sourceFingerprint.imageUpdatedAt));
        const reconcileSourceFacts = scope !== null
            && (
                !isInvokeDbSnapshotScopeCurrent(targetSnapshot, scope)
                || (scope.mode === 'all' && forceRefresh)
                || !sourceFingerprint
                || (!canCatchUpAllUsers
                    && !isInvokeSourceFingerprintCurrent(targetSnapshot?.sourceFingerprint, sourceFingerprint))
            );
        const reconcileBoardOwners = scope !== null
            && settingsRef.current.invokeSyncBoards !== false;
        startupDiagnostics.repairDecision(describeInvokeRepairDecision({
            scope: scope?.mode ?? 'none', forcedRefresh: forceRefresh,
            snapshotPresent: !!targetSnapshot,
            snapshotCompatible: isInvokeDbSnapshotScopeCurrent(targetSnapshot, scope),
            savedFingerprint: targetSnapshot?.sourceFingerprint, currentFingerprint: sourceFingerprint,
            fingerprintCurrent: !!sourceFingerprint && isInvokeSourceFingerprintCurrent(targetSnapshot?.sourceFingerprint, sourceFingerprint),
            reconcileSourceFacts, canCatchUpAllUsers,
        }));
        const reportProgress = (current: number, total: number, message?: string) => {
            const operation = useInvokeOwnerScopeStore.getState().operation;
            if (operation && operation.rootPath === rootPath) {
                invokeSyncTrace.coordinatorProgress(operation.id, current, total, message);
                updateInvokeOperation(operation.id, { progress: { current, total, message } });
            }
            setInvokeOwnerScopeState({
                status: 'applying',
                operationPhase: 'preparing',
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
        useCollectionStore.getState().invalidateInitialization();
        const traceOperationId = useInvokeOwnerScopeStore.getState().operation?.id;
        const result = await invokeSyncTrace.measure(traceOperationId, 'scope-apply', () => applyInvokeOwnerScope({
            discovery,
            selection,
            reconcileSourceFacts,
            reconcileBoardOwners,
            forceVisibilityRefresh: forceRefresh,
            onProgress: reportProgress,
            signal,
            traceOperationId,
        }));
        throwIfInvokeAborted(signal);
        let cacheRepair = resolveInvokeScopeCacheRepair(result.cacheRepair);
        if (!isPreparationCurrent()) {
            useCollectionStore.getState().invalidateInitialization();
            await refreshInvokeOwnerVisibility(discovery, previousSelection);
            await refreshAfterOwnerScopeChange();
            throw new Error('InvokeAI path changed while owner scope was loading.');
        }
        const repairedSnapshot = targetSnapshot
            && (reconcileSourceFacts || (reconcileBoardOwners && !result.boardScopeWarning))
            ? {
                ...targetSnapshot,
                ...(reconcileSourceFacts && sourceFingerprint ? { sourceFingerprint } : {}),
                ...(reconcileBoardOwners && !result.boardScopeWarning ? {
                    // Ownership preparation does not synchronize source membership. Keep
                    // the last completed setting evidence until board catch-up succeeds.
                    boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
                } : {}),
            }
            : undefined;
        const needsCachePreparation = scope !== null;
        try {
            if ((scope !== null || useCollectionStore.getState().isLoaded) && (result.changed
                || result.boardCollectionsUpdated > 0
                || forceRefresh
                || reconcileSourceFacts
                || needsCachePreparation)) {
                const repairMessage = cacheRepair.action === 'restored'
                    ? 'Restoring cached InvokeAI view...'
                    : cacheRepair.action === 'selective'
                        ? 'Updating changed InvokeAI filters and collections...'
                        : 'Rebuilding InvokeAI filters and collections...';
                reportProgress(0, 0, repairMessage);
                cacheRepair = await invokeSyncTrace.measure(traceOperationId, 'scope-cache', () => refreshAfterOwnerScopeChange(2, signal));
            }
            if (persistSelection || repairedSnapshot) {
                throwIfInvokeAborted(signal);
                if (!isPreparationCurrent()) {
                    throw new Error('InvokeAI path or owner changed while the view was being prepared.');
                }
                await invokeSyncTrace.measure(traceOperationId, 'checkpoint', () => persistOwnerSelection(selection, rootPath, scope, repairedSnapshot));
                throwIfInvokeAborted(signal);
            }
        } catch (preparationError) {
            try {
                useCollectionStore.getState().invalidateInitialization();
                await refreshInvokeOwnerVisibility(discovery, previousSelection);
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
            hasPreparationChanges: result.sourceFactsUpdated > 0 || result.boardCollectionsUpdated > 0,
            boardScopeWarning: result.boardScopeWarning,
            cacheRepair,
        };
        ownerScopeAdmissionRef.current = admission;
        return admission;
    }, [persistOwnerSelection, refreshAfterOwnerScopeChange, settingsRef]);

    const ensureInvokeOwnerScope = useCallback(async (force = false): Promise<InvokeOwnerAdmission> => {
        if (!useCollectionStore.getState().isLoaded) {
            await useCollectionStore.getState().prepareInitialization();
        }
        const rootPath = settingsRef.current.invokeAiPath?.trim();
        if (!rootPath) {
            startupDiagnostics.repairDecision(describeInvokeRepairDecision({
                scope: 'none', forcedRefresh: force, snapshotPresent: false, snapshotCompatible: false,
                fingerprintCurrent: false, reconcileSourceFacts: false, canCatchUpAllUsers: false,
            }));
            setInvokeOwnerScopeState({ status: 'idle' });
            ownerScopeAdmissionRef.current = null;
            if (!useCollectionStore.getState().isLoaded) {
                await useCollectionStore.getState().initialize();
            }
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
                discovery = await measureStartupPhase('owner-discovery', () => discoverInvokeOwners(rootPath));
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
                    const generation = useCollectionStore.getState().getInitializationGeneration();
                    const published = await useCollectionStore.getState().initialize({ generation });
                    if (!published || settingsRef.current.invokeAiPath?.trim() !== rootPath) {
                        return { rootPath, allowed: false, reason: 'Collection initialization was superseded.' };
                    }
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
                    startupDiagnostics.repairDecision(describeInvokeRepairDecision({
                        scope: trustedOfflineScope.mode, forcedRefresh: force,
                        snapshotPresent: !!resolvedSnapshot, snapshotCompatible: true,
                        savedFingerprint: resolvedSnapshot?.sourceFingerprint,
                        fingerprintCurrent: false, reconcileSourceFacts: false, canCatchUpAllUsers: false,
                    }));
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

                const admission = await measureStartupPhase('owner-preparation', () => applyDiscoveredOwnerScope(
                    discovery,
                    selection,
                    shouldPersistSelection,
                    rootPath,
                    force
                ));
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
        const draft = getInvokeConnectionDraft(settingsRef.current);
        if (!draft.invokeAiPath) return false;
        const outcome = await applyInvokeConnectionRef.current({ ...draft, invokeOwnerSelection: selection });
        return outcome.viewCommitted;
    }, [settingsRef]);

    const applyInvokeConnection = useCallback(async (
        input: InvokeConnectionDraft,
        applicationOptions?: ApplyInvokeConnectionOptions,
    ): Promise<InvokeConnectionApplyOutcome> => {
        if (isBrowserMockMode()) return { status: 'blocked', viewCommitted: false, message: 'Unavailable in browser mock mode.' };
        if (ownerTransitionRef.current || ownerScopePromiseRef.current || activeInvokeSyncRunRef.current
            || activeInvokeSyncScopeRef.current || useLibraryStore.getState().syncStatus === 'syncing') {
            return { status: 'busy', viewCommitted: false, message: 'Wait for the current InvokeAI operation to finish.' };
        }

        const draft = { ...input, invokeAiPath: input.invokeAiPath.trim(),
            invokeOwnerSelection: input.invokeOwnerSelection ? { ...input.invokeOwnerSelection } : undefined };
        const previousSettings = useSettingsStore.getState().settings;
        const previousDraft = getInvokeConnectionDraft(previousSettings);
        const previousState = useInvokeOwnerScopeStore.getState().ownerScopeState;
        const previousAdmission = ownerScopeAdmissionRef.current;
        const previousRoot = previousSettings.invokeAiPath?.trim();
        const token = Symbol('invoke-connection-application');
        const controller = new AbortController();
        ownerTransitionRef.current = { rootPath: draft.invokeAiPath, token, appliesConfiguration: true };
        setIsInvokeSyncActive(true);
        setSyncAbortController(controller);
        useInvokeOwnerScopeStore.getState().setOperation({
            id: token, origin: 'user', rootPath: draft.invokeAiPath,
            targetLabel: draft.invokeOwnerSelection?.mode === 'owner' ? draft.invokeOwnerSelection.ownerId : 'All users',
            phase: 'validating', viewCommitted: false,
            progress: { current: 0, total: 0, message: 'Checking connection...' },
            cancel: () => { if (ownerTransitionRef.current?.token === token) controller.abort(); },
        });
        controller.signal.addEventListener('abort', () => {
            updateInvokeOperation(token, { phase: 'cancelling', cancel: undefined });
            useLibraryStore.getState().markInvokeSyncCancelled();
        }, { once: true });
        let published = false;
        let viewCommitted = false;
        let discovery: InvokeOwnerDiscovery | undefined;
        let outcome: InvokeSyncOutcome = { status: 'failed' };
        let targetSnapshot: InvokeDbSnapshotState | undefined;
        let targetCursor: number | null | undefined;
        const assertSubmittedConnection = () => {
            throwIfInvokeAborted(controller.signal);
            const current = getInvokeConnectionDraft(useSettingsStore.getState().settings);
            if (!isSameInvokeConnectionSource(current.invokeAiPath, draft.invokeAiPath)
                || !isSameInvokeOwnerSelection(current.invokeOwnerSelection, draft.invokeOwnerSelection)) {
                throw new Error('InvokeAI path or owner changed while the view was being prepared.');
            }
        };

        const publish = async (patch: Partial<AppSettings>) => {
            await settingsPersistenceCoordinator.run(async permit => {
                const committed = useSettingsStore.getState().rollbackSettings(permit, patch);
                if (!committed) throw new Error('Connection settings could not be applied.');
                settingsRef.current = committed;
                await useSettingsStore.getState().flushSettings(committed);
            });
        };
        const retry = () => {
            // Before admission rollback restores the old connection; Retry still belongs to the submitted target.
            // After admission retry the applied connection, retaining its completed writes and current checkpoint.
            void applyInvokeConnectionRef.current(viewCommitted
                ? getInvokeConnectionDraft(useSettingsStore.getState().settings)
                : draft);
        };

        try {
            discovery = await inspectInvokeConnection(draft.invokeAiPath);
            throwIfInvokeAborted(controller.signal);
            if (draft.invokeOwnerSelection
                && !isSameInvokePath(draft.invokeOwnerSelection.dbPath, discovery.dbPath)) {
                throw new Error('The selected owner belongs to a different InvokeAI database. Check the connection again.');
            }
            if (discovery.schemaMode === 'legacy') draft.invokeOwnerSelection = undefined;
            const scope = resolveInvokeSyncScope(discovery, draft.invokeOwnerSelection);
            if (!scope || (scope.mode === 'owner'
                && !discovery.owners.some(owner => owner.ownerId === scope.ownerId))) {
                if (isSameInvokeConnectionSource(previousDraft.invokeAiPath, draft.invokeAiPath)
                    && previousState.status !== 'ready') {
                    ownerScopeAdmissionRef.current = null;
                    setInvokeOwnerScopeState({ status: 'selection_required', rootPath: draft.invokeAiPath, discovery });
                }
                throw new Error('Choose an owner currently represented in this InvokeAI database, or All users.');
            }
            if (getInvokeConnectionDraft(useSettingsStore.getState().settings).invokeAiPath !== previousDraft.invokeAiPath) {
                throw new Error('The active InvokeAI connection changed. Review the connection again.');
            }
            await ensureAssetPathAccessible(discovery.imagesRoot, { assumeDirectory: true });
            throwIfInvokeAborted(controller.signal);
            updateInvokeOperation(token, { targetLabel: scope.mode === 'owner'
                ? discovery.owners.find(owner => owner.ownerId === scope.ownerId)?.displayName || scope.ownerId
                : scope.mode === 'legacy' ? 'InvokeAI' : 'All users' });

            const sameSource = isSameInvokeConnectionSource(previousDraft.invokeAiPath, draft.invokeAiPath);
            const sameOwner = sameSource
                && isSameInvokeOwnerSelection(previousDraft.invokeOwnerSelection, draft.invokeOwnerSelection);
            const boardOptionsChanged = draft.invokeSyncBoards !== previousDraft.invokeSyncBoards;
            const optionsChanged = boardOptionsChanged
                || draft.invokeSyncFavorites !== previousDraft.invokeSyncFavorites
                || draft.starredAs !== previousDraft.starredAs
                || draft.importIntermediates !== previousDraft.importIntermediates;
            let snapshots = useSettingsStore.getState().settings.invokeDbSnapshots;
            if (previousSettings.invokeDbSnapshot) snapshots = upsertInvokeDbSnapshot(snapshots, previousSettings.invokeDbSnapshot);
            targetSnapshot = getInvokeDbSnapshotForScope({ invokeDbSnapshots: snapshots }, scope);
            const ownsCurrentCursor = sameOwner && previousAdmission?.allowed && previousAdmission.scope
                && isSameInvokeSyncScope(previousAdmission.scope, scope)
                && (previousState.status === 'ready' || previousState.status === 'offline_ready');
            targetCursor = ownsCurrentCursor && previousSettings.lastSyncedAt !== undefined
                ? previousSettings.lastSyncedAt : targetSnapshot?.lastSyncedAt ?? null;
            const requiresHistoricalImport = draft.importIntermediates && targetSnapshot?.importIntermediates !== true;
            let reuseView = false;
            if (sameOwner && previousState.status === 'ready' && previousAdmission?.allowed
                && previousAdmission.scope && isSameInvokeSyncScope(previousAdmission.scope, scope)
                && !boardOptionsChanged && targetSnapshot && isInvokeDbSnapshotScopeCurrent(targetSnapshot, scope)) {
                try {
                    // File signatures prove the prepared source is unchanged. Counts alone cannot do so.
                    const current = await readInvokeDbSnapshotState(draft.invokeAiPath, {
                        ...targetSnapshot, scopeMode: scope.mode,
                        scopeOwnerId: scope.mode === 'owner' ? scope.ownerId : null,
                        syncBoardsToCollections: draft.invokeSyncBoards,
                    });
                    reuseView = isInvokeDbSnapshotCurrent(targetSnapshot, current);
                } catch { /* Unknown source freshness requires normal preparation. */ }
            }
            throwIfInvokeAborted(controller.signal);
            const currentDraft = getInvokeConnectionDraft(useSettingsStore.getState().settings);
            if ((currentDraft.invokeAiPath.trim() !== previousDraft.invokeAiPath.trim()
                    && !isSameInvokeConnectionSource(currentDraft.invokeAiPath, previousDraft.invokeAiPath))
                || !isSameInvokeOwnerSelection(currentDraft.invokeOwnerSelection, previousDraft.invokeOwnerSelection)) {
                throw new Error('The active InvokeAI connection changed. Review the connection again.');
            }
            if (!reuseView) {
                setInvokeOwnerScopeState({ status: 'applying', operationPhase: 'preparing',
                    rootPath: draft.invokeAiPath, scope, discovery,
                    progress: { current: 0, total: 0, message: 'Preparing view...' } });
                ownerScopeAdmissionRef.current = null;
            }
            updateInvokeOperation(token, { phase: reuseView ? 'syncing' : 'preparing' });
            applicationOptions?.onAccepted?.();
            sourceConnectionRootRef.current = draft.invokeAiPath;
            published = true;
            await publish({ ...draft, lastSyncedAt: targetCursor, invokeDbSnapshot: targetSnapshot, invokeDbSnapshots: snapshots });
            assertSubmittedConnection();
            const submittedDiscovery = discovery;
            const admission = reuseView ? previousAdmission! : await invokeSyncTrace.measure(token, 'preparation', () => applyDiscoveredOwnerScope(
                submittedDiscovery, draft.invokeOwnerSelection, true, draft.invokeAiPath, false, true, controller.signal));
            assertSubmittedConnection();
            if (!admission.allowed) throw new Error(admission.reason ?? 'The selected InvokeAI view is unavailable.');
            // Live Watch can advance this admitted scope beyond its last foreground snapshot.
            if (settingsRef.current.lastSyncedAt !== targetCursor) await publish({ lastSyncedAt: targetCursor });
            assertSubmittedConnection();
            ownerScopeAdmissionRef.current = { ...admission, rootPath: draft.invokeAiPath };
            pendingInvokeViewReadyAnnouncementRootRef.current = null;
            // Visibility, caches and settings are coherent. Import failure no longer undoes this choice.
            setInvokeOwnerScopeState({ status: 'ready', rootPath: draft.invokeAiPath,
                scope, discovery, warning: admission.boardScopeWarning });
            viewCommitted = true;
            updateInvokeOperation(token, { phase: 'syncing', viewCommitted: true });
            outcome = await runInvokeSyncRef.current({
                mode: sameSource && !sameOwner ? 'startup' : 'manual',
                ownerTransitionToken: token, controller,
                skipStartupSnapshot: optionsChanged || requiresHistoricalImport,
                ...(requiresHistoricalImport ? { afterTimestamp: 0 } : {}),
                syncFavorites: draft.invokeSyncFavorites, syncBoards: draft.invokeSyncBoards,
                starredAs: draft.starredAs, importIntermediates: draft.importIntermediates,
                importOrphans: sameSource && !sameOwner ? false : draft.importOrphans,
            });
            if (outcome.status !== 'completed') throw new Error(('message' in outcome && outcome.message) || 'Synchronization did not complete.');
            updateInvokeOperation(token, { phase: 'completed', cancel: undefined, message: 'Synchronization complete.' });
            return { ...outcome, viewCommitted };
        } catch (error) {
            const cancellationError = error instanceof Error && error.message === 'Aborted';
            const aborted = controller.signal.aborted || cancellationError || outcome.status === 'aborted';
            const errorMessage = error instanceof Error ? error.message : String(error);
            const preparationMessage = cancellationError ? 'Preparation cancelled.' : errorMessage;
            const preparationResult: Pick<InvokeOwnerScopeState, 'error' | 'failure'> = {
                error: cancellationError ? undefined : errorMessage,
                failure: { kind: cancellationError ? 'preparation_cancelled' : 'preparation_failed', details: preparationMessage },
            };
            const retryingUnpreparedView = previousState.status === 'error'
                && isSameInvokeConnectionSource(previousDraft.invokeAiPath, draft.invokeAiPath)
                && isSameInvokeOwnerSelection(previousDraft.invokeOwnerSelection, draft.invokeOwnerSelection);
            let message = aborted ? (viewCommitted ? 'Synchronization cancelled.' : 'Preparation cancelled.') : errorMessage;
            outcome = { status: aborted ? 'aborted' : 'failed', message };
            updateInvokeOperation(token, { phase: aborted ? 'cancelling' : 'settling', cancel: undefined });
            const currentDraft = getInvokeConnectionDraft(useSettingsStore.getState().settings);
            const configurationDrifted = published && (!isSameInvokeConnectionSource(currentDraft.invokeAiPath, draft.invokeAiPath)
                || !isSameInvokeOwnerSelection(currentDraft.invokeOwnerSelection, draft.invokeOwnerSelection));
            if (configurationDrifted) {
                ownerScopeAdmissionRef.current = null;
                message += ' The configuration changed during this operation. Verify the selected view before continuing.';
                setInvokeOwnerScopeState({ status: 'error', rootPath: currentDraft.invokeAiPath,
                    error: message, failure: { kind: 'preparation_failed', details: message } });
            } else if (!published && retryingUnpreparedView
                && useInvokeOwnerScopeStore.getState().ownerScopeState === previousState) {
                // Failed validation on Retry must replace the old result without changing an admitted view or draft target.
                message = preparationMessage;
                setInvokeOwnerScopeState({ ...previousState, ...preparationResult });
            } else if (published && !viewCommitted && previousRoot) {
                try {
                    let snapshots = useSettingsStore.getState().settings.invokeDbSnapshots;
                    if (previousSettings.invokeDbSnapshot) snapshots = upsertInvokeDbSnapshot(snapshots, previousSettings.invokeDbSnapshot);
                    sourceConnectionRootRef.current = previousRoot;
                    ownerScopeAdmissionRef.current = null;
                    await publish({ ...previousDraft, lastSyncedAt: previousSettings.lastSyncedAt,
                        invokeDbSnapshot: previousSettings.invokeDbSnapshot, invokeDbSnapshots: snapshots });
                    const previousScope = previousState.scope ?? previousAdmission?.scope;
                    const previousDiscovery = previousState.discovery ?? (previousScope ? {
                        schemaMode: previousScope.mode === 'legacy' ? 'legacy' as const : 'multi_user' as const,
                        dbPath: previousScope.dbPath, imagesRoot: previousScope.imagesRoot,
                        owners: [], unassignedImageCount: 0,
                    } : undefined);
                    if (previousDiscovery) {
                        await refreshInvokeOwnerVisibility(previousDiscovery, previousDraft.invokeOwnerSelection, true);
                        await refreshAfterOwnerScopeChange();
                    }
                    ownerScopeAdmissionRef.current = previousAdmission;
                    if (retryingUnpreparedView) {
                        message = preparationMessage;
                        setInvokeOwnerScopeState({ ...previousState, ...preparationResult });
                    } else {
                        setInvokeOwnerScopeState(previousState);
                    }
                    if (previousAdmission?.allowed) message += ' The previous view was restored.';
                } catch (rollbackError) {
                    message += ` The previous view could not be restored: ${String(rollbackError)}`;
                    setInvokeOwnerScopeState({ status: 'error', rootPath: previousRoot,
                        discovery: previousState.discovery, error: message,
                        failure: { kind: 'preparation_failed', details: message } });
                }
            } else if (published && !viewCommitted) {
                ownerScopeAdmissionRef.current = null;
                // Only a settled abort is a neutral cancellation; native/recovery errors still need attention.
                message = preparationMessage;
                setInvokeOwnerScopeState({ status: 'error', rootPath: draft.invokeAiPath,
                    discovery, ...preparationResult });
            } else if (viewCommitted) {
                try {
                    // The engine may have committed part of a batch before failure. Never advance its checkpoint.
                    let snapshots = useSettingsStore.getState().settings.invokeDbSnapshots;
                    const scope = ownerScopeAdmissionRef.current?.scope;
                    if (scope) snapshots = snapshots?.filter(snapshot => !(isSameInvokePath(snapshot.dbPath, scope.dbPath)
                        && snapshot.scopeMode === scope.mode && (snapshot.scopeOwnerId ?? null) === (scope.mode === 'owner' ? scope.ownerId : null)));
                    if (targetSnapshot) snapshots = upsertInvokeDbSnapshot(snapshots, targetSnapshot);
                    await publish({ lastSyncedAt: targetCursor, invokeDbSnapshot: targetSnapshot, invokeDbSnapshots: snapshots });
                    await refreshAfterOwnerScopeChange();
                } catch (recoveryError) {
                    message += ` Recovery needs attention: ${String(recoveryError)}`;
                    ownerScopeAdmissionRef.current = null;
                    setInvokeOwnerScopeState({ status: 'error', rootPath: draft.invokeAiPath, discovery,
                        error: message, failure: { kind: 'preparation_failed', details: message } });
                }
            }
            updateInvokeOperation(token, { phase: aborted ? 'cancelled' : 'failed', message, retry, cancel: undefined });
            addToast(message, aborted ? 'info' : 'error');
            return { ...outcome, message, viewCommitted };
        } finally {
            if (controller.signal.aborted || outcome.status === 'aborted') {
                pendingInvokeLiveSyncRef.current = false;
                pendingInvokeLivePerfRef.current = null;
                useLibraryStore.getState().markInvokeSyncCancelled();
            }
            if (ownerTransitionRef.current?.token === token) ownerTransitionRef.current = null;
            if (useLibraryStore.getState().syncAbortController === controller) setSyncAbortController(null);
            setIsInvokeSyncActive(false);
            startPendingInvokeLiveRerun();
        }
    }, [addToast, applyDiscoveredOwnerScope, refreshAfterOwnerScopeChange, setInvokeOwnerScopeState,
        setSyncAbortController, settingsRef, startPendingInvokeLiveRerun]);
    applyInvokeConnectionRef.current = applyInvokeConnection;

    const retryInvokeOwnerScope = useCallback(async (): Promise<boolean> => {
        if (ownerTransitionRef.current || ownerScopePromiseRef.current || activeInvokeSyncRunRef.current
            || activeInvokeSyncScopeRef.current || useLibraryStore.getState().syncStatus === 'syncing') return false;
        const rootPath = settingsRef.current.invokeAiPath?.trim();
        if (rootPath) invalidateInvokeSourceDatabase(rootPath);
        const draft = getInvokeConnectionDraft(settingsRef.current);
        if (rootPath && draft.invokeOwnerSelection
            && !isSameInvokePath(draft.invokeOwnerSelection.dbPath, resolveInvokePaths(rootPath).dbPath)) {
            draft.invokeOwnerSelection = undefined;
        }
        const outcome = await applyInvokeConnectionRef.current(draft);
        return outcome.viewCommitted;
    }, [settingsRef]);

    useEffect(() => {
        if (!settingsLoaded) return;
        // Explicit application owns preparation until its committed scope or rollback is ready.
        if (ownerTransitionRef.current?.appliesConfiguration) return;
        const configuredRootPath = settings.invokeAiPath?.trim();
        const previousRootPath = sourceConnectionRootRef.current;
        if (previousRootPath !== configuredRootPath && (!previousRootPath || !configuredRootPath
            || !isSameInvokePath(resolveInvokePaths(previousRootPath).dbPath, resolveInvokePaths(configuredRootPath).dbPath))) {
            useCollectionStore.getState().invalidateInitialization();
        }
        if (previousRootPath && (!configuredRootPath || !isSameInvokePath(
            resolveInvokePaths(previousRootPath).dbPath,
            resolveInvokePaths(configuredRootPath).dbPath
        ))) {
            invalidateInvokeSourceDatabase(previousRootPath);
            if (configuredRootPath) invalidateInvokeSourceDatabase(configuredRootPath);
        }
        sourceConnectionRootRef.current = configuredRootPath;
        if (pendingInvokeViewReadyAnnouncementRootRef.current !== configuredRootPath) {
            pendingInvokeViewReadyAnnouncementRootRef.current = null;
        }
        ownerScopeAdmissionRef.current = null;
        if (activeInvokeSyncScopeRef.current) return;
        void ensureInvokeOwnerScope().catch(() => {
            // Owner preparation reports through its retryable gate. A hard storage/count
            // failure outside that flow must not leave an unexplained startup splash.
            if (!useCollectionStore.getState().isLoaded) {
                window.__AMBIT_STARTUP_BOOTSTRAP__?.showFailure();
                startupDiagnostics.fail('startup-failure', 'other');
            }
        });
    }, [
        ensureInvokeOwnerScope,
        settings.invokeAiPath,
        settings.invokeOwnerSelection,
        settings.invokeSyncBoards,
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
        if (options.mode === 'live' && useInvokeOwnerScopeStore.getState().ownerScopeState.status === 'error') {
            queueLiveRerun();
            return { status: 'blocked', message: 'Retry the InvokeAI connection before Live Watch can resume.' };
        }
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
            const current = useSettingsStore.getState().settings;
            if (current.invokeAiPath?.trim() !== capturedRootPath) return false;
            return isInvokeSyncScopeSelectionCurrent(
                capturedScope,
                current.invokeOwnerSelection
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
            // Successful synchronization is presented once by the Activity Dock.
            if (outcome === 'unavailable') addToast(
                'Your saved InvokeAI view is available, but catch-up could not start because the InvokeAI database file is unavailable.',
                'warning'
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
        const setFinalizationProgress = (message: string) => {
            const progress = { current: 0, total: 0, message };
            updateInvokeOperation(operationId, { progress });
            if (isStartupMode) setVisibleStartupProgress(progress);
            else setSyncProgress(progress);
        };
        const syncStartedAt = liveWatchNow();
        const livePerfContext = options.mode === 'live' ? options.perfContext : undefined;
        let liveTotalProcessed = 0;
        const preparationHadChanges = ownerAdmission.hasPreparationChanges === true;
        let liveHadChanges = preparationHadChanges;
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
            syncBoardsToCollections: settingsRef.current.invokeSyncBoards !== false,
            scopeMode: capturedScope.mode,
            scopeOwnerId: capturedScope.mode === 'owner' ? capturedScope.ownerId : null,
            boardOwnerSchemaVersion,
        };
        const shouldUseStartupSnapshot =
            options.mode === 'startup'
            && !options.skipStartupSnapshot
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

        const ctrl = options.controller ?? new AbortController();
        setSyncAbortController(ctrl);
        const operationId = options.ownerTransitionToken ?? Symbol('invoke-sync');
        const ownsOperation = !options.ownerTransitionToken && options.mode !== 'live';
        if (ownsOperation) {
            const owner = useInvokeOwnerScopeStore.getState().ownerScopeState.discovery?.owners
                .find(owner => capturedScope.mode === 'owner' && owner.ownerId === capturedScope.ownerId);
            useInvokeOwnerScopeStore.getState().setOperation({
                id: operationId, origin: isStartupMode ? 'startup' : 'user',
                rootPath: capturedRootPath, viewCommitted: true,
                targetLabel: capturedScope.mode === 'owner' ? owner?.displayName || capturedScope.ownerId : 'All users',
                phase: 'syncing', progress: { current: 0, total: 0, message: 'Checking for updates...' },
                cancel: () => { if (activeInvokeSyncRunRef.current?.promise === activeRunPromise) ctrl.abort(); },
            });
            ctrl.signal.addEventListener('abort', () => {
                updateInvokeOperation(operationId, { phase: 'cancelling', cancel: undefined });
                useLibraryStore.getState().markInvokeSyncCancelled();
            }, { once: true });
        }

        const persistCheckpoint = async (
            patch: Partial<Pick<AppSettings, 'lastSyncedAt' | 'invokeDbSnapshot' | 'invokeDbSnapshots'>>,
        ) => {
            await settingsPersistenceCoordinator.run(async (permit) => {
                throwIfInvokeAborted(ctrl.signal);
                if (!isCapturedScopeCurrent()) {
                    throw new Error('InvokeAI owner scope changed before the sync snapshot could be saved.');
                }
                const nextSettings = { ...useSettingsStore.getState().settings, ...patch };
                updateInvokeOperation(operationId, { phase: 'settling', cancel: undefined });
                await useSettingsStore.getState().flushSettings(nextSettings);
                if (!isCapturedScopeCurrent() || ctrl.signal.aborted) {
                    // The async write must not leave an old owner's checkpoint on newer settings.
                    await useSettingsStore.getState().flushSettings(useSettingsStore.getState().settings);
                    throwIfInvokeAborted(ctrl.signal);
                    throw new Error('InvokeAI owner scope changed while the sync checkpoint was being saved.');
                }
                const committed = useSettingsStore.getState().rollbackSettings(permit, patch);
                if (!committed) throw new Error('Sync checkpoint persistence permit expired.');
                settingsRef.current = committed;
            });
        };
        const persistSnapshotState = async (snapshot: InvokeDbSnapshotState) => persistCheckpoint({
            lastSyncedAt: snapshot.lastSyncedAt, invokeDbSnapshot: snapshot,
            invokeDbSnapshots: upsertInvokeDbSnapshot(useSettingsStore.getState().settings.invokeDbSnapshots, snapshot),
        });

        if (shouldUseStartupSnapshot) {
            const snapshotStartedAt = liveWatchNow();
            try {
                const currentSnapshot = await readInvokeDbSnapshotState(
                    capturedRootPath,
                    effectiveSnapshotConfig
                );
                throwIfInvokeAborted(ctrl.signal);
                const dbSnapshotFile = currentSnapshot.files.find(file => file.path === currentSnapshot.dbPath);

                if (dbSnapshotFile && !dbSnapshotFile.exists) {
                    announcePreparedInvokeView('unavailable');
                    console.warn('[Startup Catch-up] Invoke DB file is missing; skipped SQLite sync.', {
                        dbPath: currentSnapshot.dbPath,
                        checkMs: elapsedMs(snapshotStartedAt)
                    });
                    if (activeInvokeSyncScopeRef.current === capturedScope) activeInvokeSyncScopeRef.current = null;
                    if (!options.controller) setIsInvokeSyncActive(false);
                    const outcome: InvokeSyncOutcome = {
                        status: 'source_unavailable',
                        message: 'The InvokeAI database file is unavailable.',
                    };
                    if (ownsOperation) updateInvokeOperation(operationId, {
                        phase: 'failed', cancel: undefined, message: outcome.message,
                        retry: () => { void applyInvokeConnectionRef.current(getInvokeConnectionDraft(useSettingsStore.getState().settings)); },
                    });
                    if (!options.controller && useLibraryStore.getState().syncAbortController === ctrl) setSyncAbortController(null);
                    finishActiveRun(outcome);
                    return outcome;
                }

                if (effectiveTimestamp != null && isInvokeDbSnapshotCurrent(savedScopeSnapshot, currentSnapshot)) {
                    announcePreparedInvokeView('current');
                    console.info('[Startup Catch-up] Invoke DB snapshot unchanged; skipped SQLite sync.', {
                        dbPath: currentSnapshot.dbPath,
                        checkMs: elapsedMs(snapshotStartedAt)
                    });
                    if (activeInvokeSyncScopeRef.current === capturedScope) activeInvokeSyncScopeRef.current = null;
                    if (!options.controller) setIsInvokeSyncActive(false);
                    updateInvokeOperation(operationId, { hasChanges: preparationHadChanges,
                        ...(ownsOperation ? { phase: 'completed', cancel: undefined,
                            message: preparationHadChanges ? 'Synchronization complete.' : 'Already up to date.' } : {}) });
                    ownerAdmission.hasPreparationChanges = false;
                    if (!options.controller && useLibraryStore.getState().syncAbortController === ctrl) setSyncAbortController(null);
                    const outcome: InvokeSyncOutcome = { status: 'completed' };
                    finishActiveRun(outcome);
                    return outcome;
                }


                console.info('[Startup Catch-up] Invoke DB snapshot changed; running SQLite sync.', {
                    dbPath: currentSnapshot.dbPath,
                    checkMs: elapsedMs(snapshotStartedAt)
                });
            } catch (snapshotError) {
                if (!ctrl.signal.aborted) console.warn('[Startup Catch-up] Invoke DB snapshot check failed; falling back to SQLite sync.', snapshotError);
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

        const persistInvokeSnapshot = async (lastSyncedAt: number | null | undefined) => {
            throwIfInvokeAborted(ctrl.signal);
            if (!isCapturedScopeCurrent()) throw new Error('InvokeAI owner scope changed before the sync checkpoint could be saved.');
            if (options.mode === 'live') return;
            if (shouldImportOrphans && !shouldReconcileSourceFacts && !ownerAdmission.sourceFactsReconciled) {
                // Orphan scanning alone does not prove a new source snapshot, but completed DB work has a cursor.
                await persistCheckpoint({ lastSyncedAt });
                return;
            }

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
                throwIfInvokeAborted(ctrl.signal);
                updateInvokeOperation(operationId, { phase: 'settling', cancel: undefined });
                await persistSnapshotState(snapshot);
            } catch (snapshotError) {
                console.warn('[Startup Catch-up] Failed to persist Invoke DB snapshot.', snapshotError);
                throw snapshotError;
            }
        };

        let syncCacheClaim: InvokeScopeCacheBuildClaim | null = null;
        let lastBatchRefresh = -Infinity;
        let lastRefreshedChanges = 0;
        let batchRefresh: Promise<void> | undefined;
        let pathCheckStartedAt: number | undefined;
        const refreshCommittedImages = (changedCount: number) => {
            // [DEBUG-invoke-memory] Controlled QA comparison only; remove before delivery.
            if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_INVOKE_HOLD_GALLERY === '1') return;
            if (changedCount <= lastRefreshedChanges || batchRefresh || !isCapturedScopeCurrent() || ctrl.signal.aborted
                || performance.now() - lastBatchRefresh < 1000) return;
            lastBatchRefresh = performance.now();
            lastRefreshedChanges = changedCount;
            batchRefresh = invokeSyncTrace.measure(operationId, 'batch-gallery', () => queryClient.invalidateQueries({ queryKey: ['images'] }))
                .catch(error => {
                    lastRefreshedChanges = 0;
                    console.error('[Sync] Failed to refresh committed images', error);
                })
                .finally(() => { batchRefresh = undefined; });
        };
        try {
            throwIfInvokeAborted(ctrl.signal);
            const { syncImages } = await import('../services/invoke/syncService');
            throwIfInvokeAborted(ctrl.signal);
            const syncResultPromise = invokeSyncTrace.measure(operationId, 'image-sync', () => syncImages(
                capturedRootPath,
                (c, t, msg) => {
                    invokeSyncTrace.coordinatorProgress(operationId, c, t, msg);
                    if (options.mode !== 'live') updateInvokeOperation(operationId, { progress: { current: c, total: t, message: msg } });
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
                    traceOperationId: options.mode === 'live' ? undefined : operationId,
                    syncFavorites: options.syncFavorites,
                    syncBoards: options.syncBoards,
                    afterTimestamp: effectiveTimestamp,
                    importIntermediates: effectiveImportIntermediates,
                    starredAs: options.starredAs,
                    perfContext: livePerfContext,
                    mode: options.mode,
                    reconcileSourceFacts: shouldReconcileSourceFacts,
                    onPathCheckProgress: options.mode === 'live' ? undefined : pathCheck => {
                        pathCheckStartedAt ??= Date.now();
                        const progress: SyncProgress = {
                            current: pathCheck.current, total: pathCheck.total,
                            phase: pathCheck.phase,
                            message: pathCheck.phase === 'repairing' ? 'Updating image references…' : 'Checking image locations…',
                            mode: pathCheck.total > 0 ? 'determinate' : 'indeterminate',
                            startedAt: pathCheckStartedAt,
                        };
                        const operation = useInvokeOwnerScopeStore.getState().operation;
                        if (operation?.id === operationId) updateInvokeOperation(operationId, {
                            progress, pathsRepaired: pathCheck.repaired,
                            updated: (operation.updated ?? 0) + Math.max(0, pathCheck.repaired - (operation.pathsRepaired ?? 0)),
                        });
                        setSyncProgress(progress);
                        if (pathCheck.repaired > 0) refreshCommittedImages(pathCheck.repaired);
                    },
                    onBatchCommitted: options.mode === 'live' ? undefined : batch => {
                        invokeSyncTrace.committedBatch(operationId, batch.processed, batch.imported, batch.updated);
                        updateInvokeOperation(operationId, { imported: batch.imported, updated: batch.updated });
                        refreshCommittedImages(batch.imported + batch.updated);
                    },
                }
            ));
            const { imported, updated, pathsRepaired = 0, maxTimestamp: newTs, boardMapping, boardsChanged, syncedIds, touchedFacetTypes, touchedFacetResources } = await syncResultPromise;
            throwIfInvokeAborted(ctrl.signal);
            if (options.mode !== 'live') updateInvokeOperation(operationId, {
                imported, updated, pathsRepaired,
                progress: { current: 0, total: 0, message: 'Updating gallery...' },
            });
            if (!isCapturedScopeCurrent()) {
                throw new Error('InvokeAI path or owner scope changed while synchronization was running.');
            }
            try {
                await invokeSyncTrace.measure(operationId, 'references', () => invalidateInvokeReferenceQueries(queryClient));
            } catch (error) {
                console.error('[Sync] Failed to refresh InvokeAI reference links', error);
            }
            throwIfInvokeAborted(ctrl.signal);
            if (!isCapturedScopeCurrent()) throw new Error('InvokeAI owner scope changed while synchronization was running.');
            const snapshotCursor = typeof newTs === 'number' ? newTs : (effectiveTimestamp ?? null);

            // Effective names and membership come from the existing authoritative
            // completion/recovery refresh; source names must never replace local edits.
            const hasBoardMapping = !!boardMapping && boardMapping.size > 0;
            const shouldRefreshBoardCollections = settingsRef.current.invokeSyncBoards !== false
                && options.syncBoards !== false
                && (isStartupMode || hasBoardMapping || boardsChanged);

            // Orphan scanning
            let orphansImported = 0;

            if (options.mode !== 'live' && shouldImportOrphans) {
                orphansImported = await invokeSyncTrace.measure(operationId, 'orphan-recovery', () => scanForOrphans(
                    capturedRootPath,
                    syncedIds,
                    (phase, current, total) => {
                        setSyncProgress({ current, total, message: phase });
                        updateInvokeOperation(operationId, {
                            progress: { current, total, message: phase }, imported: imported + current,
                        });
                        if (current > 0) refreshCommittedImages(imported + updated + current);
                    },
                    { importIntermediates: settingsRef.current.importIntermediates, signal: ctrl.signal }
                ));
            }
            throwIfInvokeAborted(ctrl.signal);
            if (options.mode !== 'live') updateInvokeOperation(operationId, { imported: imported + orphansImported, updated });
            const totalProcessed = (imported || 0) + (updated || 0) + orphansImported;
            liveTotalProcessed = totalProcessed;
            // Conditional Facet Rebuild
            const hasChanges = (imported || 0) > 0
                || (updated || 0) > 0
                || orphansImported > 0
                || boardsChanged;
            liveHadChanges = hasChanges || preparationHadChanges;

            if (hasChanges) {
                try {
                    await onInvokeContentChanged?.();
                } catch (error) {
                    console.error('[Sync] Failed to refresh hidden-content availability after Invoke sync', error);
                }
                throwIfInvokeAborted(ctrl.signal);
                if (!isCapturedScopeCurrent()) throw new Error('InvokeAI owner scope changed while synchronization was running.');
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
                    setFinalizationProgress('Updating gallery...');

                    // IMMEDIATE UI REFRESH (Block here until data hits RAM)
                    await invokeSyncTrace.measure(operationId, 'gallery', () => queryClient.invalidateQueries({ queryKey: ['images'] }));

                    throwIfInvokeAborted(ctrl.signal);

                    setFinalizationProgress(options.mode === 'startup'
                        ? 'Updating startup filters...' : 'Rebuilding filter cache...');

                    try {
                        syncCacheClaim = await invokeSyncTrace.measure(operationId, 'cache-claim', () => unwrap(commands.beginActiveInvokeScopeCacheBuild()));
                        throwIfInvokeAborted(ctrl.signal);
                        if (options.mode === 'startup') {
                            await invokeSyncTrace.measure(operationId, 'facet-cache', () => refreshStartupFacetCache({
                                source: 'invoke',
                                totalProcessed,
                                touchedFacetTypes,
                                touchedFacetResources,
                                orphanScanEnabled: shouldImportOrphans,
                                onRefreshApplied: incrementFacetCacheVersion
                            }));
                        } else {
                            await invokeSyncTrace.measure(operationId, 'facet-cache', () => rebuildFacetCache());
                            useLibraryStore.getState().incrementFacetCacheVersion();
                        }
                        throwIfInvokeAborted(ctrl.signal);
                    } catch (e) {
                        if (syncCacheClaim) {
                            await abortInvokeScopeCacheClaim(syncCacheClaim, 'sync facet refresh');
                            syncCacheClaim = null;
                        }
                        console.error('[Sync] Failed to rebuild facet cache after sync', e);
                        throw e;
                    }

                    setFinalizationProgress('Updating collections and library details...');

                    // Trigger complete routines
                    if (options.mode !== 'startup') {
                        await invokeSyncTrace.measure(operationId, 'collections', async () => onSyncComplete?.('full'));
                    } else {
                        if (shouldRefreshBoardCollections) {
                            await invokeSyncTrace.measure(operationId, 'collections', () => refreshCollections(false, {
                                consistency: 'authoritative',
                            }));
                        }
                    }

                    throwIfInvokeAborted(ctrl.signal);

                    if (hasBoardMapping || boardsChanged) {
                        setFinalizationProgress('Updating collection previews...');
                        await invokeSyncTrace.measure(operationId, 'previews', () => refreshCollectionThumbnails(true));
                        throwIfInvokeAborted(ctrl.signal);
                    }

                    if (syncCacheClaim && syncCacheClaim.cacheRepair.action !== 'restored') {
                        try {
                            const completedClaim = syncCacheClaim;
                            await invokeSyncTrace.measure(operationId, 'cache-commit', () => unwrap(commands.commitActiveInvokeScopeCache({
                                scopeKey: completedClaim.scopeKey,
                                generation: completedClaim.generation,
                            })));
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            if (!message.includes('changed while it was being prepared')) throw error;
                            await refreshAfterOwnerScopeChange(1);
                        }
                    }
                    syncCacheClaim = null;

                    await invokeSyncTrace.measure(operationId, 'checkpoint', () => persistInvokeSnapshot(snapshotCursor));
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
                        await invokeSyncTrace.measure(operationId, 'facet-cache', () => refreshStartupFacetCache({
                            source: 'invoke',
                            totalProcessed,
                            touchedFacetTypes,
                            touchedFacetResources,
                            orphanScanEnabled: shouldImportOrphans,
                            onRefreshApplied: incrementFacetCacheVersion
                        }));
                    }
                    debugLiveWatchPerf('Invoke sync no-op skipped metadata refresh', {
                        mode: options.mode,
                        totalProcessed,
                        syncMs: elapsedMs(syncStartedAt)
                    });
                }
                if (shouldRefreshBoardCollections) {
                    await invokeSyncTrace.measure(operationId, 'collections', () => refreshCollections(false, {
                        consistency: 'authoritative',
                    }));
                    if (hasBoardMapping || boardsChanged) {
                        await invokeSyncTrace.measure(operationId, 'previews', () => Promise.all([
                            refreshCollectionThumbnails(true),
                            refreshSmartCounts({ includeArchived: false, markPending: false }),
                        ]));
                    }
                }
            }

            // Fallback for NO CHANGES scenario (hasChanges === false)
            throwIfInvokeAborted(ctrl.signal);
            if (options.mode === 'live' && typeof newTs === 'number') {
                if (!isCapturedScopeCurrent()) throw new Error('InvokeAI owner scope changed before the sync cursor could be saved.');
                setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
            }
            await invokeSyncTrace.measure(operationId, 'checkpoint', () => persistInvokeSnapshot(snapshotCursor));

            syncOutcome = { status: 'completed' };

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            if (ctrl.signal.aborted || message === 'Aborted') {
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
            await batchRefresh;
            if (syncCacheClaim) {
                await abortInvokeScopeCacheClaim(syncCacheClaim, 'sync completion');
                syncCacheClaim = null;
            }
            if (!options.controller && (syncOutcome.status === 'failed' || syncOutcome.status === 'aborted')
                && isCapturedScopeCurrent()) {
                try {
                    await invokeSyncTrace.measure(operationId, 'partial-recovery', () => refreshAfterOwnerScopeChange());
                } catch (recoveryError) {
                    ownerScopeAdmissionRef.current = null;
                    setInvokeOwnerScopeState({ status: 'error', rootPath: capturedRootPath,
                        error: String(recoveryError), failure: { kind: 'preparation_failed', details: String(recoveryError) } });
                }
            }
            if (activeInvokeSyncScopeRef.current === capturedScope) {
                activeInvokeSyncScopeRef.current = null;
            }
            if (!options.controller) setIsInvokeSyncActive(false);
            setInvokeSyncActivityKind(null);
            if (!options.controller && useLibraryStore.getState().syncAbortController === ctrl) setSyncAbortController(null);
            if (syncOutcome.status === 'completed' && (!isStartupMode || startupSyncVisible)) setSyncStatus('complete');
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
                setInvokeOwnerScopeState({ status: 'error', rootPath: settingsRef.current.invokeAiPath,
                    error: 'InvokeAI ownership changed during synchronization. Verify the selected view before continuing.',
                    failure: { kind: 'preparation_failed', details: 'Owner scope changed during synchronization.' } });
            }
            if (ctrl.signal.aborted || syncOutcome.status === 'aborted') {
                pendingInvokeLiveSyncRef.current = false;
                pendingInvokeLivePerfRef.current = null;
                if (!options.controller) useLibraryStore.getState().markInvokeSyncCancelled();
            }
            if (syncOutcome.status === 'completed') {
                ownerAdmission.hasPreparationChanges = false;
                if (options.mode !== 'live') updateInvokeOperation(operationId, { hasChanges: liveHadChanges });
            }
            if (ownsOperation) {
                const phase = syncOutcome.status === 'completed' ? 'completed' : syncOutcome.status === 'aborted' ? 'cancelled' : 'failed';
                updateInvokeOperation(operationId, { phase, cancel: undefined,
                    message: phase === 'completed' ? (liveHadChanges ? 'Synchronization complete.' : 'Already up to date.') : phase === 'cancelled' ? 'Synchronization cancelled.'
                        : ('message' in syncOutcome ? syncOutcome.message : 'Synchronization failed.'),
                    retry: phase === 'completed' ? undefined : () => {
                        void applyInvokeConnectionRef.current(getInvokeConnectionDraft(useSettingsStore.getState().settings));
                    } });
            }
            finishActiveRun(syncOutcome);
        }
        return syncOutcome;
    }, [syncStatus, addToast, ensureInvokeOwnerScope, onSyncComplete, onInvokeContentChanged, queryClient, queueLiveFacetRefresh, incrementFacetCacheVersion, refreshAfterOwnerScopeChange, setSettings, refreshCollections, refreshCollectionThumbnails, refreshSmartCounts, setSyncStatus, setSyncProgress, setInvokeOwnerScopeState, setInvokeSyncActivityKind, setIsLiveSyncing, startLiveWatchSession, startPendingInvokeLiveRerun, updateLiveWatchSession, reportLiveImagesReceived]);

    runInvokeSyncRef.current = runInvokeSync;

    const startInvokeSync = useCallback(async (options?: StartInvokeSyncOptions): Promise<InvokeSyncOutcome> => {
        return runInvokeSync(options);
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
            applyInvokeConnection,
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
