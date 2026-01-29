import { create } from 'zustand';

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

    // Background Auto-Healing State
    isBackgroundHealingActive: boolean;
    backgroundHealingProgress: SyncProgress | null;
    backgroundHealingPaused: boolean;

    // Facet Cache Version (incremented after cache rebuild to trigger React Query refetch)
    facetCacheVersion: number;

    // Actions
    setSyncStatus: (status: SyncStatus) => void;
    setSyncProgress: (progress: SyncProgress) => void;
    setIsLiveSyncing: (isLive: boolean) => void;

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
    incrementFacetCacheVersion: () => void;

    // Background Healing Actions
    setBackgroundHealingActive: (val: boolean) => void;
    setBackgroundHealingProgress: (progress: SyncProgress | null) => void;
    setBackgroundHealingPaused: (val: boolean) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
    // Initial State
    syncStatus: 'idle',
    syncProgress: { current: 0, total: 0, message: '' },
    isLiveSyncing: false,

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
    facetCacheVersion: 0,

    // Background Healing State
    isBackgroundHealingActive: false,
    backgroundHealingProgress: null,
    backgroundHealingPaused: false,

    // Actions
    setSyncStatus: (status) => set({ syncStatus: status }),
    setSyncProgress: (progress) => set({ syncProgress: progress }),
    setIsLiveSyncing: (isLive) => set({ isLiveSyncing: isLive }),

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
    incrementFacetCacheVersion: () => set((state) => ({ facetCacheVersion: state.facetCacheVersion + 1 })),

    // Background Healing Actions
    setBackgroundHealingActive: (val) => set({ isBackgroundHealingActive: val }),
    setBackgroundHealingProgress: (progress) => set({ backgroundHealingProgress: progress }),
    setBackgroundHealingPaused: (val) => set({ backgroundHealingPaused: val }),
}));
