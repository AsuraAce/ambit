import * as React from 'react';
import { createContext, useContext, ReactNode, useMemo, useCallback, useEffect } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { SettingsProvider, useSettings } from './SettingsContext';
import { SyncProvider, useSync } from './SyncContext';
import { CollectionProvider, useCollections } from './CollectionContext';
import { SearchProvider, useSearch } from './SearchContext';
import { WatcherProvider, useWatchers } from './WatcherContext';
import { ErrorBoundary } from '../components/common/ErrorBoundary';

// Existing type for backward compatibility
export interface LibraryContextType {
  images: any[];
  setImages: any;
  filters: any;
  setFilters: any;
  sortOption: any;
  setSortOption: any;
  collections: any[];
  setCollections: any;
  setAllCollections: any;
  smartCollections: any[];
  setSmartCollections: any;
  settings: any;
  setSettings: any;
  settingsRef: React.MutableRefObject<any>;
  recentSearches: string[];
  setRecentSearches: any;
  facets: any;
  stats: any;
  totalImages: number;
  globalTotal: number;
  hasMoreImages: boolean;
  loadMoreImages: () => Promise<void>;
  startInvokeSync: (options?: any) => Promise<void>;
  cancelSync: () => void;
  cleanLibrary: () => Promise<void>;
  syncStatus: string;
  // syncProgress removed
  syncState: {
    status: 'idle' | 'syncing' | 'complete' | 'error';
    progress: { current: number; total: number; message?: string };
  };
  isFiltering: boolean;
  isLoaded: boolean;

  // Transient state moved to useLibraryStore
  // isImporting, isLiveWatching, etc. (Wait, isLiveWatching was already in Store but exposed here?)

  isImporting: boolean;
  setIsImporting: (val: boolean) => void;
  setImportProgress: (progress: any) => void;
  isRegeneratingThumbnails: boolean;
  setIsRegeneratingThumbnails: (val: boolean) => void;
  setThumbnailProgress: (progress: any) => void;
  isResolvingModels: boolean;
  setIsResolvingModels: (val: boolean) => void;
  modelResolutionProgress: any;
  setModelResolutionProgress: (progress: any) => void;
  lastModelResolutionResult: any;
  setLastModelResolutionResult: (result: any) => void;
  isLiveSyncing: boolean;
  // isLiveWatching should be removed too? It was migrated earlier.
  // Actually isLiveWatching was used in AppHeader from LibraryContext earlier.
  // Now AppHeader gets it from Store. 
  // WatcherContext ALSO uses store.

  isLiveWatching: boolean; // Keeping for now if used elsewhere, but ideally remove.
  setIsLiveWatching: any;

  toggleFavorite: (id: string) => Promise<void>;
  togglePin: (id: string, isPinned?: boolean) => Promise<void>;
  clearAllFilters: () => void;
  refreshMetadata: () => Promise<void>;
  fetchData: (loadMore: boolean) => Promise<void>;
  refreshCollections: () => Promise<void>;
  refreshCollectionThumbnails: () => Promise<void>;
  activeSqlWhere: string;
  activeSqlParams: any[];
  maintenanceCounts: any;
  refreshMaintenanceCounts: () => Promise<void>;
  isActivityDockDismissed: boolean;
  setIsActivityDockDismissed: (val: boolean) => void;
  privacyEnabled: boolean;
  setPrivacyEnabled: (val: boolean) => void;
  isFacetsLoading: boolean;
  loadFacet: (type: 'embeddings' | 'hypernetworks') => Promise<void>;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);



export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <CollectionProvider>
          <SearchProvider>
            <SyncProviderWrapper>
              <WatcherProviderWrapper>
                <LibraryContextWrapper>
                  {children}
                </LibraryContextWrapper>
              </WatcherProviderWrapper>
            </SyncProviderWrapper>
          </SearchProvider>
        </CollectionProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
};

// Wrappers to inject cross-context callbacks
const SyncProviderWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { fetchData, refreshMetadata } = useSearch();
  const { refreshCollections } = useCollections();

  const handleSyncComplete = useCallback(async () => {
    // Consolidated refresh
    await refreshMetadata();
    await refreshCollections();
  }, [refreshMetadata, refreshCollections]);

  return (
    <SyncProvider onSyncComplete={handleSyncComplete}>
      {children}
    </SyncProvider>
  );
};

const WatcherProviderWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { fetchData, refreshMetadata } = useSearch();

  const handleNewImage = useCallback(async () => {
    // refreshMetadata invalidates 'images' and 'libraryStats' queries
    await refreshMetadata();
  }, [refreshMetadata]);

  return (
    <WatcherProvider onNewImageDetected={handleNewImage}>
      {children}
    </WatcherProvider>
  );
};

const LibraryContextWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const settingsCtx = useSettings();
  const collectionCtx = useCollections();
  const searchCtx = useSearch();
  const syncCtx = useSync();
  const watcherCtx = useWatchers();

  // Use Store for Activity Check
  const {
    isImporting, isRegeneratingThumbnails, isResolvingModels,
    syncStatus, setIsActivityDockDismissed,
    setIsResolvingModels, modelResolutionProgress, setModelResolutionProgress,
    lastModelResolutionResult, setLastModelResolutionResult,
    setIsImporting, setImportProgress,
    setIsRegeneratingThumbnails, setThumbnailProgress
  } = useLibraryStore();

  const isAnyTaskActive = isImporting || isRegeneratingThumbnails || syncStatus === 'syncing' || isResolvingModels;

  useEffect(() => {
    if (isAnyTaskActive) {
      setIsActivityDockDismissed(false);
    }
  }, [isAnyTaskActive, setIsActivityDockDismissed]);

  const value = useMemo(() => ({
    ...settingsCtx,
    ...collectionCtx,
    ...searchCtx,
    ...watcherCtx,
    isImporting,
    setIsImporting,
    setImportProgress,
    isRegeneratingThumbnails,
    setIsRegeneratingThumbnails,
    setThumbnailProgress,
    isResolvingModels,
    setIsResolvingModels,
    modelResolutionProgress,
    setModelResolutionProgress,
    lastModelResolutionResult,
    setLastModelResolutionResult,
    syncState: syncCtx.syncState,
    startInvokeSync: syncCtx.startInvokeSync,
    cancelSync: syncCtx.cancelSync,
    cleanLibrary: syncCtx.cleanLibrary,
    isLoaded: settingsCtx.isLoaded && collectionCtx.isLoaded
  }), [settingsCtx, collectionCtx, searchCtx, syncCtx, watcherCtx, isImporting, isRegeneratingThumbnails, isResolvingModels, modelResolutionProgress, lastModelResolutionResult]);

  return (
    <LibraryContext.Provider value={value as any}>
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibraryContext = () => {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibraryContext must be used within LibraryProvider');
  return context;
};

// Alias for components that expect useLibrary
export const useLibrary = useLibraryContext;
