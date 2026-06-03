import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { commands, type FileHashBackfillResult } from '../bindings';
import type { MissingFileAuditResult } from '../types';

let liveWatchTimeout: ReturnType<typeof setTimeout> | null = null;
// Internal aggregation window for related Live Watch events, not dock visibility.
const LIVE_WATCH_SESSION_IDLE_MS = 60000;
let importRunCounter = 0;

const createImportRunId = (owner: string): string => {
    importRunCounter += 1;
    return `${owner}-${Date.now()}-${importRunCounter}`;
};

const isImportRunDebugEnabled = (): boolean => {
    try {
        return typeof window !== 'undefined'
            && window.localStorage?.getItem('ambit:debug-import-progress') === '1';
    } catch {
        return false;
    }
};

const debugImportRun = (event: string, data: Record<string, unknown>) => {
    if (isImportRunDebugEnabled()) {
        console.debug(`[ImportRun] ${event}`, data);
    }
};

export interface SyncProgress {
    current: number;
    total: number;
    message?: string;
    phase?: string;
    mode?: 'determinate' | 'indeterminate' | 'complete';
    detail?: string;
    startedAt?: number;
}

interface BeginImportRunOptions {
    runId?: string;
    owner?: string;
    abortController?: AbortController | null;
    progress?: SyncProgress | null;
}

export type ThumbnailOptimizationDetailProfile = 'quiet' | 'balanced' | 'fast';

export interface ThumbnailOptimizationDetails {
    checked: number;
    optimized: number;
    reused: number;
    failed: number;
    skipped: number;
    imagesPerSecond: number;
    batchMs: number;
    dbMs: number;
    encodeMs: number;
    profile: ThumbnailOptimizationDetailProfile;
    phase: string;
    isThrottled: boolean;
}

export interface ThumbnailOptimizationRunSummary {
    checked: number;
    optimized: number;
    reused: number;
    failed: number;
    skipped: number;
    imagesPerSecond: number;
    durationMs: number;
    completedAt: number;
    profile: ThumbnailOptimizationDetailProfile;
}

export type SyncStatus = 'idle' | 'syncing' | 'complete' | 'error';
export type LiveWatchSessionSource = 'generic' | 'invoke' | 'mixed';
export type LiveWatchSessionPhase = 'watching' | 'syncing' | 'importing' | 'summary';

export interface LiveWatchSessionState {
    active: boolean;
    source: LiveWatchSessionSource | null;
    phase: LiveWatchSessionPhase | null;
    message?: string;
    progress: SyncProgress | null;
    receivedCount: number;
    startedAt: number | null;
    lastActivityAt: number | null;
}

interface LiveWatchSessionUpdate {
    source?: LiveWatchSessionSource;
    phase?: LiveWatchSessionPhase;
    message?: string;
    progress?: SyncProgress | null;
}

const mergeLiveWatchSource = (
    current: LiveWatchSessionSource | null,
    next?: LiveWatchSessionSource
): LiveWatchSessionSource | null => {
    if (!next) {
        return current;
    }

    if (!current || current === next) {
        return next;
    }

    return 'mixed';
};

export const getLiveWatchSummaryMessage = (receivedCount: number): string => {
    if (receivedCount <= 0) {
        return 'Watching for new images...';
    }

    return receivedCount === 1
        ? '1 image added this session.'
        : `${receivedCount} images added this session.`;
};

export const createInitialLiveWatchSessionState = (): LiveWatchSessionState => ({
    active: false,
    source: null,
    phase: null,
    message: undefined,
    progress: null,
    receivedCount: 0,
    startedAt: null,
    lastActivityAt: null
});

const scheduleLiveWatchSessionEnd = () => {
    if (liveWatchTimeout) {
        clearTimeout(liveWatchTimeout);
    }

    liveWatchTimeout = setTimeout(async () => {
        const endSession = useLibraryStore.getState().endLiveImageSession;
        await endSession();
    }, LIVE_WATCH_SESSION_IDLE_MS);
};

const clearLiveWatchSessionEnd = () => {
    if (liveWatchTimeout) {
        clearTimeout(liveWatchTimeout);
        liveWatchTimeout = null;
    }
};

const isActiveLiveWatchPhase = (phase: LiveWatchSessionPhase | null) => (
    phase === 'watching' || phase === 'syncing' || phase === 'importing'
);

const shouldCloseLiveWatchOnStop = (session: LiveWatchSessionState) => (
    !session.active || !isActiveLiveWatchPhase(session.phase)
);

export interface MaintenanceCounts {
    untagged: number;
    orphans: number;
    intermediates: number;
    missing: number;
    trash: number;
    duplicates: number;
}

export type DuplicateScanScope = 'global' | 'filtered';

interface LibraryState {
    // Sync State
    syncStatus: SyncStatus;
    syncProgress: SyncProgress;
    isLiveSyncing: boolean;
    syncAbortController: AbortController | null; // Added

    // Watcher State
    isLiveWatching: boolean;
    maintenanceCounts: MaintenanceCounts;

    // Transient UI State (Progress)
    isImporting: boolean;
    importProgress: SyncProgress | null;
    importAbortController: AbortController | null; // Added
    importRunId: string | null;
    importRunOwner: string | null;
    isRegeneratingThumbnails: boolean;
    thumbnailProgress: SyncProgress | null;
    thumbnailAbortController: AbortController | null;
    isResolvingModels: boolean;
    modelResolutionProgress: SyncProgress | null;
    isActivityDockDismissed: boolean;
    isActivityDockMinimized: boolean;
    isPopulatingThumbnails: boolean;
    lastModelResolutionResult: { success: boolean; message: string } | null;

    // Discovery Scan State
    isScanningDiscovery: boolean;
    discoveryScanProgress: SyncProgress | null;

    // Duplicate Scan State
    isScanningDuplicates: boolean;
    duplicateScanProgress: SyncProgress | null;
    duplicateScanScope: DuplicateScanScope;
    lastDuplicateScanResult: FileHashBackfillResult | null;

    // Missing File Audit State
    isScanningMissingFiles: boolean;
    missingScanProgress: SyncProgress | null;
    missingScanAbortController: AbortController | null;
    lastMissingScanResult: MissingFileAuditResult | null;

    // Background Auto-Healing State
    isBackgroundHealingActive: boolean;
    backgroundHealingProgress: SyncProgress | null;
    backgroundHealingDetails: ThumbnailOptimizationDetails | null;
    lastBackgroundHealingRun: ThumbnailOptimizationRunSummary | null;
    backgroundHealingPaused: boolean;
    thumbnailOptimizationRetrySignal: number;

    // Background Metadata Refresh State
    isRefreshingMetadata: boolean;
    refreshProgress: SyncProgress | null;

    // Live Watch Session State
    liveWatchSession: LiveWatchSessionState;
    liveWatchSessionCloseRequested: boolean;

    // Facet Cache Version (incremented after cache rebuild to trigger React Query refetch)
    facetCacheVersion: number;

    // Actions
    setSyncStatus: (status: SyncStatus) => void;
    setSyncProgress: (progress: SyncProgress) => void;
    setIsLiveSyncing: (isLive: boolean) => void;
    setSyncAbortController: (ctrl: AbortController | null) => void; // Added
    cancelSync: () => void; // Added

    setIsLiveWatching: (isWatching: boolean) => void;
    setMaintenanceCounts: (counts: MaintenanceCounts) => void;

    setIsImporting: (isImporting: boolean) => void;
    setImportProgress: (progress: SyncProgress | null) => void;
    setImportAbortController: (ctrl: AbortController | null) => void; // Added
    beginImportRun: (options?: BeginImportRunOptions) => string | null;
    setImportProgressForRun: (runId: string, progress: SyncProgress | null) => void;
    finishImportRun: (runId: string) => void;
    cancelImport: () => void; // Added
    setIsRegeneratingThumbnails: (val: boolean) => void;
    setThumbnailProgress: (progress: SyncProgress | null) => void;
    setThumbnailAbortController: (ctrl: AbortController | null) => void;
    cancelThumbnailRegeneration: () => void;
    setIsResolvingModels: (val: boolean) => void;
    setModelResolutionProgress: (progress: SyncProgress | null) => void;
    setIsActivityDockDismissed: (val: boolean) => void;
    setIsActivityDockMinimized: (val: boolean) => void;
    setIsPopulatingThumbnails: (val: boolean) => void;
    setLastModelResolutionResult: (result: { success: boolean; message: string } | null) => void;
    setIsScanningDiscovery: (val: boolean) => void;
    setDiscoveryScanProgress: (progress: SyncProgress | null) => void;
    cancelDiscoveryScan: () => void;
    setIsScanningDuplicates: (val: boolean) => void;
    setDuplicateScanProgress: (progress: SyncProgress | null) => void;
    setDuplicateScanScope: (scope: DuplicateScanScope) => void;
    setLastDuplicateScanResult: (result: FileHashBackfillResult | null) => void;
    cancelDuplicateScan: () => void;
    setIsScanningMissingFiles: (val: boolean) => void;
    setMissingScanProgress: (progress: SyncProgress | null) => void;
    setMissingScanAbortController: (ctrl: AbortController | null) => void;
    setLastMissingScanResult: (result: MissingFileAuditResult | null) => void;
    cancelMissingScan: () => void;
    incrementFacetCacheVersion: () => void;

    // Background Healing Actions
    setBackgroundHealingActive: (val: boolean) => void;
    setBackgroundHealingProgress: (progress: SyncProgress | null) => void;
    setBackgroundHealingDetails: (details: ThumbnailOptimizationDetails | null) => void;
    setLastBackgroundHealingRun: (summary: ThumbnailOptimizationRunSummary | null) => void;
    setBackgroundHealingPaused: (val: boolean) => void;
    requestThumbnailOptimizationRun: () => void;

    // Background Metadata Refresh Actions
    setIsRefreshingMetadata: (val: boolean) => void;
    setRefreshProgress: (progress: SyncProgress | null) => void;
    cancelRefresh: () => void;

    // Live Watch Session Actions
    startLiveWatchSession: (source: LiveWatchSessionSource, update?: Omit<LiveWatchSessionUpdate, 'source'>) => void;
    updateLiveWatchSession: (update: LiveWatchSessionUpdate) => void;
    reportLiveImagesReceived: (count: number, update?: Omit<LiveWatchSessionUpdate, 'phase'>) => void;
    endLiveImageSession: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set) => ({
    // Initial State
    syncStatus: 'idle',
    syncProgress: { current: 0, total: 0, message: '' },
    isLiveSyncing: false,
    syncAbortController: null,

    isLiveWatching: false,
    maintenanceCounts: {
        untagged: 0,
        orphans: 0,
        intermediates: 0,
        missing: 0,
        trash: 0,
        duplicates: 0
    },

    isImporting: false,
    importProgress: null,
    importAbortController: null,
    importRunId: null,
    importRunOwner: null,
    isRegeneratingThumbnails: false,
    thumbnailProgress: null,
    thumbnailAbortController: null,
    isResolvingModels: false,
    modelResolutionProgress: null,
    isActivityDockDismissed: false,
    isActivityDockMinimized: false,
    isPopulatingThumbnails: false,
    lastModelResolutionResult: null,
    isScanningDiscovery: false,
    discoveryScanProgress: null,
    isScanningDuplicates: false,
    duplicateScanProgress: null,
    duplicateScanScope: 'global',
    lastDuplicateScanResult: null,
    isScanningMissingFiles: false,
    missingScanProgress: null,
    missingScanAbortController: null,
    lastMissingScanResult: null,
    facetCacheVersion: 0,

    // Background Healing State
    isBackgroundHealingActive: false,
    backgroundHealingProgress: null,
    backgroundHealingDetails: null,
    lastBackgroundHealingRun: null,
    backgroundHealingPaused: false,
    thumbnailOptimizationRetrySignal: 0,

    // Background Metadata Refresh State
    isRefreshingMetadata: false,
    refreshProgress: null,

    // Live Watch Session State
    liveWatchSession: createInitialLiveWatchSessionState(),
    liveWatchSessionCloseRequested: false,

    // Actions
    setSyncStatus: (status) => set({ syncStatus: status }),
    setSyncProgress: (progress) => set({ syncProgress: progress }),
    setIsLiveSyncing: (isLive) => set({ isLiveSyncing: isLive }),
    setSyncAbortController: (ctrl) => set({ syncAbortController: ctrl }),
    cancelSync: () => set((state) => {
        if (state.syncAbortController) {
            state.syncAbortController.abort();
            return { syncStatus: 'idle', syncProgress: { current: 0, total: 0, message: 'Cancelled' }, syncAbortController: null };
        }
        return {};
    }),

    setIsLiveWatching: (isWatching) => set((state) => {
        if (isWatching) {
            return { isLiveWatching: true, liveWatchSessionCloseRequested: false };
        }

        clearLiveWatchSessionEnd();
        if (shouldCloseLiveWatchOnStop(state.liveWatchSession)) {
            return {
                isLiveWatching: false,
                liveWatchSession: createInitialLiveWatchSessionState(),
                liveWatchSessionCloseRequested: false
            };
        }

        return {
            isLiveWatching: false,
            liveWatchSessionCloseRequested: true
        };
    }),
    setMaintenanceCounts: (counts) => set({ maintenanceCounts: counts }),

    setIsImporting: (val) => {
        if (val) {
            const { isScanningDuplicates, cancelDuplicateScan, isScanningMissingFiles, cancelMissingScan } = useLibraryStore.getState();
            if (isScanningDuplicates) {
                cancelDuplicateScan();
            }
            if (isScanningMissingFiles) {
                cancelMissingScan();
            }
        }
        set({ isImporting: val, isActivityDockDismissed: val ? false : undefined });
    },
    setImportProgress: (progress) => set({ importProgress: progress }),
    setImportAbortController: (ctrl) => set({ importAbortController: ctrl }),
    beginImportRun: (options = {}) => {
        const owner = options.owner ?? 'import';
        const runId = options.runId ?? createImportRunId(owner);
        let didStart = false;

        const { isScanningDuplicates, cancelDuplicateScan, isScanningMissingFiles, cancelMissingScan } = useLibraryStore.getState();
        if (isScanningDuplicates) {
            cancelDuplicateScan();
        }
        if (isScanningMissingFiles) {
            cancelMissingScan();
        }

        set((state) => {
            if (state.isImporting && state.importRunId && state.importRunId !== runId) {
                debugImportRun('begin-ignored-active-run', {
                    runId,
                    owner,
                    activeRunId: state.importRunId,
                    activeOwner: state.importRunOwner
                });
                return {};
            }

            if (state.isImporting && !state.importRunId) {
                debugImportRun('begin-ignored-legacy-active', { runId, owner });
                return {};
            }

            didStart = true;
            debugImportRun('begin', { runId, owner });
            return {
                isImporting: true,
                importRunId: runId,
                importRunOwner: owner,
                importAbortController: options.abortController ?? null,
                importProgress: options.progress ?? null,
                isActivityDockDismissed: false
            };
        });

        return didStart ? runId : null;
    },
    setImportProgressForRun: (runId, progress) => set((state) => {
        if (state.importRunId !== runId) {
            debugImportRun('progress-ignored-stale-run', {
                runId,
                activeRunId: state.importRunId,
                progress
            });
            return {};
        }

        debugImportRun('progress', {
            runId,
            owner: state.importRunOwner,
            current: progress?.current,
            total: progress?.total,
            message: progress?.message,
            phase: progress?.phase,
            detail: progress?.detail
        });
        return { importProgress: progress };
    }),
    finishImportRun: (runId) => set((state) => {
        if (state.importRunId !== runId) {
            debugImportRun('finish-ignored-stale-run', {
                runId,
                activeRunId: state.importRunId
            });
            return {};
        }

        debugImportRun('finish', { runId, owner: state.importRunOwner });
        return {
            isImporting: false,
            importProgress: null,
            importAbortController: null,
            importRunId: null,
            importRunOwner: null
        };
    }),
    cancelImport: () => set((state) => {
        if (state.importAbortController) {
            debugImportRun('cancel', {
                runId: state.importRunId,
                owner: state.importRunOwner
            });
            state.importAbortController.abort();
            return {
                isImporting: false,
                importProgress: null,
                importAbortController: null,
                importRunId: null,
                importRunOwner: null
            };
        }
        return {};
    }),
    setIsRegeneratingThumbnails: (val) => set({ isRegeneratingThumbnails: val, isActivityDockDismissed: val ? false : undefined }),
    setThumbnailProgress: (progress) => set({ thumbnailProgress: progress }),
    setThumbnailAbortController: (ctrl) => set({ thumbnailAbortController: ctrl }),
    cancelThumbnailRegeneration: () => set((state) => {
        if (state.thumbnailAbortController) {
            state.thumbnailAbortController.abort();
            return { isRegeneratingThumbnails: false, thumbnailProgress: null, thumbnailAbortController: null };
        }
        return {};
    }),
    setIsResolvingModels: (val) => set({ isResolvingModels: val, isActivityDockDismissed: val ? false : undefined }),
    setModelResolutionProgress: (progress) => set({ modelResolutionProgress: progress }),
    // UI State
    setIsActivityDockDismissed: (d) => set({ isActivityDockDismissed: d }),
    setIsActivityDockMinimized: (m) => set({ isActivityDockMinimized: m }),
    setIsPopulatingThumbnails: (val) => set({ isPopulatingThumbnails: val, isActivityDockDismissed: val ? false : undefined }),
    setLastModelResolutionResult: (result) => set({ lastModelResolutionResult: result }),
    setIsScanningDiscovery: (val) => set({ isScanningDiscovery: val, isActivityDockDismissed: val ? false : undefined }),
    setDiscoveryScanProgress: (progress) => set((state) => {
        if (progress && progress.startedAt === undefined && state.discoveryScanProgress?.startedAt !== undefined) {
            return {
                discoveryScanProgress: {
                    ...progress,
                    startedAt: state.discoveryScanProgress.startedAt
                }
            };
        }

        return { discoveryScanProgress: progress };
    }),
    cancelDiscoveryScan: () => {
        commands.cancelModelDiscovery().catch(console.error);
        set({ isScanningDiscovery: false, discoveryScanProgress: null });
    },
    setIsScanningDuplicates: (val) => set({ isScanningDuplicates: val, isActivityDockDismissed: val ? false : undefined }),
    setDuplicateScanProgress: (progress) => set({ duplicateScanProgress: progress }),
    setDuplicateScanScope: (scope) => set({ duplicateScanScope: scope }),
    setLastDuplicateScanResult: (result) => set({ lastDuplicateScanResult: result }),
    cancelDuplicateScan: () => {
        commands.cancelImageFileHashBackfill().catch(console.error);
        set({ isScanningDuplicates: false, duplicateScanProgress: null });
    },
    setIsScanningMissingFiles: (val) => set({ isScanningMissingFiles: val, isActivityDockDismissed: val ? false : undefined }),
    setMissingScanProgress: (progress) => set({ missingScanProgress: progress }),
    setMissingScanAbortController: (ctrl) => set({ missingScanAbortController: ctrl }),
    setLastMissingScanResult: (result) => set({ lastMissingScanResult: result }),
    cancelMissingScan: () => set((state) => {
        if (state.missingScanAbortController) {
            state.missingScanAbortController.abort();
        }
        return { isScanningMissingFiles: false, missingScanProgress: null };
    }),
    incrementFacetCacheVersion: () => set((state) => ({ facetCacheVersion: state.facetCacheVersion + 1 })),

    // Background Healing Actions
    setBackgroundHealingActive: (val) => set({ isBackgroundHealingActive: val }),
    setBackgroundHealingProgress: (progress) => set({ backgroundHealingProgress: progress }),
    setBackgroundHealingDetails: (details) => set({ backgroundHealingDetails: details }),
    setLastBackgroundHealingRun: (summary) => set({ lastBackgroundHealingRun: summary }),
    setBackgroundHealingPaused: (val) => set({ backgroundHealingPaused: val }),
    requestThumbnailOptimizationRun: () => set((state) => ({
        thumbnailOptimizationRetrySignal: state.thumbnailOptimizationRetrySignal + 1
    })),

    // Background Metadata Refresh Actions
    setIsRefreshingMetadata: (val) => set({ isRefreshingMetadata: val, isActivityDockDismissed: val ? false : undefined }),
    setRefreshProgress: (progress) => set({ refreshProgress: progress }),
    cancelRefresh: () => {
        invoke('cancel_reparse_job').catch(console.error);
        set({ isRefreshingMetadata: false, refreshProgress: null });
    },

    // Live Watch Session Actions
    startLiveWatchSession: (source, update = {}) => {
        const now = Date.now();
        set((state) => {
            const currentSession = state.liveWatchSession;
            const resolvedSource = mergeLiveWatchSource(currentSession.source, source);
            const nextPhase = update.phase ?? 'watching';
            return {
                liveWatchSession: {
                    active: true,
                    source: resolvedSource,
                    phase: nextPhase,
                    message: update.message,
                    progress: update.progress ?? null,
                    receivedCount: currentSession.receivedCount,
                    startedAt: currentSession.active ? currentSession.startedAt : now,
                    lastActivityAt: now
                },
                liveWatchSessionCloseRequested: state.liveWatchSessionCloseRequested && isActiveLiveWatchPhase(nextPhase)
            };
        });
        if (useLibraryStore.getState().isLiveWatching) {
            scheduleLiveWatchSessionEnd();
        }
    },
    updateLiveWatchSession: (update) => {
        const now = Date.now();
        set((state) => {
            const currentSession = state.liveWatchSession;
            const resolvedSource = mergeLiveWatchSource(currentSession.source, update.source);
            const nextPhase = update.phase ?? currentSession.phase ?? 'watching';
            if (state.liveWatchSessionCloseRequested && !isActiveLiveWatchPhase(nextPhase)) {
                clearLiveWatchSessionEnd();
                return {
                    liveWatchSession: createInitialLiveWatchSessionState(),
                    liveWatchSessionCloseRequested: false
                };
            }

            return {
                liveWatchSession: {
                    active: true,
                    source: resolvedSource,
                    phase: nextPhase,
                    message: update.message ?? currentSession.message,
                    progress: update.progress !== undefined ? update.progress : currentSession.progress,
                    receivedCount: currentSession.receivedCount,
                    startedAt: currentSession.startedAt ?? now,
                    lastActivityAt: now
                }
            };
        });
        if (useLibraryStore.getState().isLiveWatching) {
            scheduleLiveWatchSessionEnd();
        }
    },
    reportLiveImagesReceived: (count, update = {}) => {
        const now = Date.now();
        set((state) => {
            const currentSession = state.liveWatchSession;
            if (state.liveWatchSessionCloseRequested) {
                clearLiveWatchSessionEnd();
                return {
                    liveWatchSession: createInitialLiveWatchSessionState(),
                    liveWatchSessionCloseRequested: false
                };
            }

            const receivedCount = currentSession.receivedCount + count;
            const resolvedSource = mergeLiveWatchSource(currentSession.source, update.source);
            return {
                liveWatchSession: {
                    active: true,
                    source: resolvedSource,
                    phase: 'summary',
                    message: update.message ?? getLiveWatchSummaryMessage(receivedCount),
                    progress: update.progress ?? null,
                    receivedCount,
                    startedAt: currentSession.startedAt ?? now,
                    lastActivityAt: now
                }
            };
        });
        if (useLibraryStore.getState().isLiveWatching) {
            scheduleLiveWatchSessionEnd();
        }
    },
    endLiveImageSession: async () => {
        clearLiveWatchSessionEnd();
        set({
            liveWatchSession: createInitialLiveWatchSessionState(),
            liveWatchSessionCloseRequested: false
        });
    },
}));
