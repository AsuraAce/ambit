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
    isRegeneratingThumbnails: boolean;
    thumbnailProgress: SyncProgress | null;
    isResolvingModels: boolean;
    modelResolutionProgress: SyncProgress | null;
    isActivityDockDismissed: boolean;

    // Actions
    setSyncStatus: (status: SyncStatus) => void;
    setSyncProgress: (progress: SyncProgress) => void;
    setIsLiveSyncing: (isLive: boolean) => void;

    setIsLiveWatching: (isWatching: boolean) => void;
    setMaintenanceCounts: (counts: MaintenanceCounts) => void;

    setIsImporting: (isImporting: boolean) => void;
    setImportProgress: (progress: SyncProgress | null) => void;
    setIsRegeneratingThumbnails: (val: boolean) => void;
    setThumbnailProgress: (progress: SyncProgress | null) => void;
    setIsResolvingModels: (val: boolean) => void;
    setModelResolutionProgress: (progress: SyncProgress | null) => void;
    setIsActivityDockDismissed: (val: boolean) => void;
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
    isRegeneratingThumbnails: false,
    thumbnailProgress: null,
    isResolvingModels: false,
    modelResolutionProgress: null,
    isActivityDockDismissed: false,

    // Actions
    setSyncStatus: (status) => set({ syncStatus: status }),
    setSyncProgress: (progress) => set({ syncProgress: progress }),
    setIsLiveSyncing: (isLive) => set({ isLiveSyncing: isLive }),

    setIsLiveWatching: (isWatching) => set({ isLiveWatching: isWatching }),
    setMaintenanceCounts: (counts) => set({ maintenanceCounts: counts }),

    setIsImporting: (val) => set({ isImporting: val, isActivityDockDismissed: val ? false : undefined }),
    setImportProgress: (progress) => set({ importProgress: progress }),
    setIsRegeneratingThumbnails: (val) => set({ isRegeneratingThumbnails: val, isActivityDockDismissed: val ? false : undefined }),
    setThumbnailProgress: (progress) => set({ thumbnailProgress: progress }),
    setIsResolvingModels: (val) => set({ isResolvingModels: val, isActivityDockDismissed: val ? false : undefined }),
    setModelResolutionProgress: (progress) => set({ modelResolutionProgress: progress }),
    setIsActivityDockDismissed: (val) => set({ isActivityDockDismissed: val }),
}));
