import * as React from 'react';
import { createContext, useContext, ReactNode, useMemo, useCallback } from 'react';
import { SettingsProvider, useSettings } from './SettingsContext';
import { SyncProvider, useSync } from './SyncContext';
import { CollectionProvider, useCollections } from './CollectionContext';
import { SearchProvider, useSearch } from './SearchContext';
import { WatcherProvider, useWatchers } from './WatcherContext';

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
  syncProgress: { current: number; total: number; message?: string };
  syncState: {
    status: 'idle' | 'syncing' | 'complete' | 'error';
    progress: { current: number; total: number; message?: string };
  };
  isFiltering: boolean;
  isLoaded: boolean;
  isImporting: boolean;
  importProgress: { current: number; total: number } | null;
  setIsImporting: (val: boolean) => void;
  setImportProgress: (val: { current: number; total: number } | null) => void;
  isLiveSyncing: boolean;
  isLiveWatching: boolean;
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
  privacyEnabled: boolean;
  setPrivacyEnabled: (val: boolean) => void;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

import { ErrorBoundary } from '../components/common/ErrorBoundary';

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
    await fetchData(false);
    await refreshMetadata();
    await refreshCollections();
  }, [fetchData, refreshMetadata, refreshCollections]);

  return (
    <SyncProvider onSyncComplete={handleSyncComplete}>
      {children}
    </SyncProvider>
  );
};

const WatcherProviderWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { fetchData } = useSearch();

  const handleNewImage = useCallback(async () => {
    await fetchData(false);
  }, [fetchData]);

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

  const value = useMemo(() => ({
    ...settingsCtx,
    ...collectionCtx,
    ...searchCtx,
    ...syncCtx,
    ...watcherCtx,
    syncState: {
      status: syncCtx.syncStatus,
      progress: syncCtx.syncProgress
    },
    isLoaded: settingsCtx.isLoaded && collectionCtx.isLoaded
  }), [settingsCtx, collectionCtx, searchCtx, syncCtx, watcherCtx]);

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