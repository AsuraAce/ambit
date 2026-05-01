import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { commands, type FileHashBackfillResult } from '../bindings';
import type { MissingFileAuditResult } from '../types';

let liveWatchTimeout: ReturnType<typeof setTimeout> | null = null;
const LIVE_WATCH_IDLE_TIMEOUT_MS = 60000;

export interface SyncProgress {
    current: number;
    total: number;
    message?: string;
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
        return 'Watching for completed images...';
    }

    return receivedCount === 1
        ? '1 image received this session. Watching for more...'
        : `${receivedCount} images received this session. Watching for more...`;
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
    }, LIVE_WATCH_IDLE_TIMEOUT_MS);
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
    backgroundHealingPaused: boolean;

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
    setBackgroundHealingPaused: (val: boolean) => void;

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
    backgroundHealingPaused: false,

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
    cancelImport: () => set((state) => {
        if (state.importAbortController) {
            state.importAbortController.abort();
            return { isImporting: false, importProgress: null, importAbortController: null };
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
    setDiscoveryScanProgress: (progress) => set({ discoveryScanProgress: progress }),
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
    setBackgroundHealingPaused: (val) => set({ backgroundHealingPaused: val }),

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
                liveWatchSessionCloseRequested: state.liveWatchSessionCloseRequested && isActiveLiveWatchPhase(nextPhase),
                isActivityDockDismissed: false
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
                },
                isActivityDockDismissed: false
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
                },
                isActivityDockDismissed: false
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
