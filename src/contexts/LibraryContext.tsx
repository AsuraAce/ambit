import * as React from 'react';
import { createContext, useContext, ReactNode, useMemo, useCallback, useEffect } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { SettingsProvider, useSettings } from './SettingsContext';
import { SyncProvider, useSync } from './SyncContext';
import { CollectionProvider, useCollections } from './CollectionContext';
import { SearchProvider, useSearch } from './SearchContext';
import { WatcherProvider, useWatchers } from './WatcherContext';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { MetadataRefreshScope } from '../types';

type LibraryStoreState = ReturnType<typeof useLibraryStore.getState>;

// Existing aggregate context kept for backward compatibility while individual
// feature contexts remain the source of truth.
export type LibraryContextType =
  ReturnType<typeof useSettings>
  & ReturnType<typeof useCollections>
  & ReturnType<typeof useSearch>
  & ReturnType<typeof useWatchers>
  & Pick<ReturnType<typeof useSync>, 'syncState' | 'startInvokeSync' | 'cancelSync' | 'cleanLibrary' | 'isLiveSyncing'>
  & Pick<
    LibraryStoreState,
    | 'syncStatus'
    | 'isImporting'
    | 'setIsImporting'
    | 'setImportProgress'
    | 'isRegeneratingThumbnails'
    | 'setIsRegeneratingThumbnails'
    | 'setThumbnailProgress'
    | 'isResolvingModels'
    | 'setIsResolvingModels'
    | 'modelResolutionProgress'
    | 'setModelResolutionProgress'
    | 'lastModelResolutionResult'
    | 'setLastModelResolutionResult'
    | 'isActivityDockDismissed'
    | 'setIsActivityDockDismissed'
  >
  & {
    isLoaded: boolean;
  };

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

  const handleSyncComplete = useCallback(async (scope: MetadataRefreshScope = 'full') => {
    // SearchContext owns the scope-aware metadata refresh strategy.
    await refreshMetadata(scope);
  }, [refreshMetadata]);

  return (
    <SyncProvider onSyncComplete={handleSyncComplete}>
      {children}
    </SyncProvider>
  );
};

const WatcherProviderWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <WatcherProvider>
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
    syncStatus, isActivityDockDismissed, setIsActivityDockDismissed,
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

  const value = useMemo<LibraryContextType>(() => ({
    ...settingsCtx,
    ...collectionCtx,
    ...searchCtx,
    ...watcherCtx,
    syncStatus,
    isActivityDockDismissed,
    setIsActivityDockDismissed,
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
    isLiveSyncing: syncCtx.isLiveSyncing,
    syncState: syncCtx.syncState,
    startInvokeSync: syncCtx.startInvokeSync,
    cancelSync: syncCtx.cancelSync,
    cleanLibrary: syncCtx.cleanLibrary,
    isLoaded: settingsCtx.isLoaded && collectionCtx.isLoaded
  }), [settingsCtx, collectionCtx, searchCtx, watcherCtx, syncStatus, isActivityDockDismissed, setIsActivityDockDismissed, isImporting, setIsImporting, setImportProgress, isRegeneratingThumbnails, setIsRegeneratingThumbnails, setThumbnailProgress, isResolvingModels, setIsResolvingModels, modelResolutionProgress, setModelResolutionProgress, lastModelResolutionResult, setLastModelResolutionResult, syncCtx.isLiveSyncing, syncCtx.syncState, syncCtx.startInvokeSync, syncCtx.cancelSync, syncCtx.cleanLibrary]);

  return (
    <LibraryContext.Provider value={value}>
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
