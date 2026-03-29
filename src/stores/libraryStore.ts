import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { commands } from '../bindings';

let liveWatchTimeout: any = null;

export interface SyncProgress {
    current: number;
    total: number;
    message?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'complete' | 'error';

export interface MaintenanceCounts {
    untagged: number;
    orphans: number;
    intermediates: number;
    missing: number;
    trash: number;
    duplicates: number;
}

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

    // Background Auto-Healing State
    isBackgroundHealingActive: boolean;
    backgroundHealingProgress: SyncProgress | null;
    backgroundHealingPaused: boolean;

    // Background Metadata Refresh State
    isRefreshingMetadata: boolean;
    refreshProgress: SyncProgress | null;

    // Live Watch Session State
    isReceivingLiveImages: boolean;
    liveImagesReceivedCount: number;

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
    reportLiveImagesReceived: (count: number) => void;
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
    facetCacheVersion: 0,

    // Background Healing State
    isBackgroundHealingActive: false,
    backgroundHealingProgress: null,
    backgroundHealingPaused: false,

    // Background Metadata Refresh State
    isRefreshingMetadata: false,
    refreshProgress: null,

    // Live Watch Session State
    isReceivingLiveImages: false,
    liveImagesReceivedCount: 0,

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

    setIsLiveWatching: (isWatching) => set({ isLiveWatching: isWatching }),
    setMaintenanceCounts: (counts) => set({ maintenanceCounts: counts }),

    setIsImporting: (val) => set({ isImporting: val, isActivityDockDismissed: val ? false : undefined }),
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
    reportLiveImagesReceived: (count) => {
        set((state) => ({ 
            isReceivingLiveImages: true, 
            liveImagesReceivedCount: state.liveImagesReceivedCount + count 
        }));
        
        if (liveWatchTimeout) clearTimeout(liveWatchTimeout);
        liveWatchTimeout = setTimeout(async () => {
            const endSession = useLibraryStore.getState().endLiveImageSession;
            await endSession();
        }, 60000); // 60-second idle session timeout
    },
    endLiveImageSession: async () => {
        set({ isReceivingLiveImages: false, liveImagesReceivedCount: 0 });
        try {
            console.log('[LiveWatch] Idle timeout reached. Rebuilding Facet Cache.');
            const { rebuildFacetCache } = await import('../services/db/imageRepo');
            await rebuildFacetCache();
            useLibraryStore.getState().incrementFacetCacheVersion();
        } catch(e) { 
            console.error('[LiveWatch] Failed facet cache rebuild after idle timeout', e); 
        }
    },
}));
