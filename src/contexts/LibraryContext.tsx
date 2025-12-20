
import * as React from 'react';
import { createContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { AIImage, Collection, SmartCollection, AppSettings, FilterState, SortOption } from '../types';
import { appRepository } from '../services/repository';
import { watcherService } from '../services/WatcherService';
import { WatchEvent } from '@tauri-apps/plugin-fs';
import { useToast } from '../hooks/useToast';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { scanImageNative } from '../services/metadataParser';
import { GeneratorTool } from '../types';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

interface LibraryContextType {
  isLoaded: boolean;
  images: AIImage[];
  setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
  collections: Collection[];
  setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  smartCollections: SmartCollection[];
  setSmartCollections: React.Dispatch<React.SetStateAction<SmartCollection[]>>;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  recentSearches: string[];
  setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>;
  updateCollectionThumbnails: (updatedImages: AIImage[]) => void;
  // Sync State
  syncState: {
    status: 'idle' | 'syncing' | 'complete' | 'error';
    progress: { current: number; total: number };
    message?: string;
  };
  startInvokeSync: (path: string, options?: { syncFavorites?: boolean, syncBoards?: boolean, afterTimestamp?: number, importIntermediates?: boolean, mode?: 'manual' | 'live' }) => Promise<void>;
  cancelSync: () => void;
  // Pagination & Filtering
  loadMoreImages: () => Promise<void>;
  hasMoreImages: boolean;
  totalImages: number;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  sortOption: SortOption;
  setSortOption: React.Dispatch<React.SetStateAction<SortOption>>;
  clearAllFilters: () => void;
  activeSqlWhere: string;
  privacyEnabled: boolean;
  setPrivacyEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  cleanLibrary: () => Promise<void>;
  isLiveWatching: boolean;
  setIsLiveWatching: React.Dispatch<React.SetStateAction<boolean>>;
}

export const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { addToast } = useToast();
  const [isLoaded, setIsLoaded] = useState(false);
  const [images, setImages] = useState<AIImage[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [smartCollections, setSmartCollections] = useState<SmartCollection[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
    hasCompletedOnboarding: false,
    syncBoardsToCollections: false
  });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [privacyEnabled, setPrivacyEnabled] = useState(true);
  const [isLiveWatching, setIsLiveWatching] = useState(false);

  // Filtering & Sorting State
  const [filters, setFilters] = useState<FilterState>({
    searchQuery: '',
    models: [],
    tools: [],
    loras: [],
    dateRange: 'all',
    favoritesOnly: false,
    collectionId: null,
  });
  const [sortOption, setSortOption] = useState<SortOption>('date_desc');
  const [activeSqlWhere, setActiveSqlWhere] = useState('');
  const [activeSqlParams, setActiveSqlParams] = useState<any[]>([]);

  // Sync State
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'complete' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const abortControllerRef = useRef<AbortController | null>(null);

  // Pagination State
  const [hasMoreImages, setHasMoreImages] = useState(true);
  const [totalImages, setTotalImages] = useState(0);
  const PAGE_SIZE = 1000;

  const isFetchingRef = useRef(false);
  const isLiveSyncingRef = useRef(false); // Guard for background live syncs

  // --- SQL Generation Effect ---
  useEffect(() => {
    const { where, params } = buildSqlWhereClause(filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections);

    setActiveSqlWhere(where);
    setActiveSqlParams(params);

    // Reset Pagination
    setImages([]);
    setHasMoreImages(true);
    setTotalImages(0);
  }, [filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections]); // Re-run when filters change

  // --- Data Fetching Logic (Debounced slightly or immediate) ---
  const fetchData = useCallback(async (isLoadMore: boolean) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const { searchImages, countImages } = await import('../services/db');

      // Determine Sort
      let sortField = 'timestamp';
      let sortOrder: 'ASC' | 'DESC' = 'DESC';

      switch (sortOption) {
        case 'date_asc': sortField = 'timestamp'; sortOrder = 'ASC'; break;
        case 'name_asc': sortField = 'path'; sortOrder = 'ASC'; break; // 'path' or 'filename'? DB col is path
        case 'name_desc': sortField = 'path'; sortOrder = 'DESC'; break;
        case 'date_desc': default: sortField = 'timestamp'; sortOrder = 'DESC'; break;
      }

      // If New Filter -> Get Count First
      if (!isLoadMore) {
        const count = await countImages(activeSqlWhere, activeSqlParams);
        setTotalImages(count);

        if (count === 0) {
          setImages([]);
          setHasMoreImages(false);
          isFetchingRef.current = false;
          return;
        }
      }

      // Fetch Page
      const offset = isLoadMore ? images.length : 0;
      const newBatch = await searchImages(activeSqlWhere, activeSqlParams, PAGE_SIZE, offset, sortField, sortOrder);

      if (newBatch.length < PAGE_SIZE) {
        setHasMoreImages(false);
      } else {
        setHasMoreImages(true);
      }

      setImages(prev => isLoadMore ? [...prev, ...newBatch] : newBatch);

    } catch (e) {
      console.error("Failed to fetch images", e);
    } finally {
      isFetchingRef.current = false;
    }
  }, [activeSqlWhere, activeSqlParams, sortOption, images.length]);

  // Trigger Fetch when SQL/Sort changes (Initial Load)
  useEffect(() => {
    if (!isLoaded) return; // Wait for init
    fetchData(false);
  }, [activeSqlWhere, activeSqlParams, sortOption, isLoaded]);


  // Load initial state (Settings & Collections)
  useEffect(() => {
    const init = async () => {
      const state = await appRepository.load();

      const envKey = process.env.API_KEY;
      if (envKey) state.settings.googleGeminiApiKey = envKey;

      const { normalizeAllPaths } = await import('../services/db');
      await normalizeAllPaths();

      // Migration for Collections: Ensure all stored IDs (paths) are normalized
      const normalizedCollections = (state.collections || []).map(c => ({
        ...c,
        imageIds: (c.imageIds || []).map(id => typeof id === 'string' ? id.replace(/\\/g, '/').replace(/\/+/g, '/') : id)
      }));

      setCollections(normalizedCollections);
      setSmartCollections(state.smartCollections);
      setSettings(state.settings);
      setRecentSearches(state.recentSearches);
      setIsLoaded(true);
    };
    init();
  }, []);

  const loadMoreImages = useCallback(async () => {
    if (!hasMoreImages) return;
    await fetchData(true);
  }, [hasMoreImages, fetchData]);

  const clearAllFilters = useCallback(() => {
    setFilters(prev => ({
      ...prev,
      searchQuery: '',
      dateRange: 'all',
      favoritesOnly: false,
      models: [],
      tools: [],
      loras: [],
      collectionId: null,
      minSteps: undefined,
      maxSteps: undefined,
      minCfg: undefined,
      maxCfg: undefined
    }));
  }, []);

  // Persist Data Changes (Debounced) - Only settings/collections/searches
  useEffect(() => {
    if (!isLoaded) return;
    const timeout = setTimeout(() => {
      appRepository.save({
        images: [], // We don't persist images array to JSON anymore (DB Source of Truth)
        collections,
        smartCollections,
        settings,
        recentSearches
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [collections, smartCollections, settings, recentSearches, isLoaded]);

  // Sync Logic
  const startInvokeSync = useCallback(async (path: string, options: { syncFavorites?: boolean, syncBoards?: boolean, mode?: 'manual' | 'live' } = { syncFavorites: true, syncBoards: true, mode: 'manual' }) => {
    // Concurrency Guard:
    // 1. If Manual Sync is active, block everything (user expects feedback)
    if (syncStatus === 'syncing' && options.mode === 'manual') return;

    // 2. If Live Sync is active, block concurrent Live request (drop it, one is already running)
    //    We do NOT block Manual if Live is running; Manual should take over (handled below?)
    //    Actually, simpler: If *any* sync is running, we drop 'live' requests.
    if ((syncStatus === 'syncing' || isLiveSyncingRef.current) && options.mode === 'live') {
      console.log('[Live Sync] Skipped: Sync already in progress.');
      return;
    }

    if (options.mode === 'live') {
      isLiveSyncingRef.current = true;
    } else {
      setSyncStatus('syncing');
      setSyncProgress({ current: 0, total: 0 });
    }

    abortControllerRef.current = new AbortController();

    try {
      const { syncImages, scanForOrphans } = await import('../services/invokeService');

      // Determine Timestamp Strategy
      // Manual: Use settings.lastSyncedAt
      // Live: Use "Now - 2 minutes" to catch just the new file safely
      let scanTimestamp = settings.lastSyncedAt;
      if (options.mode === 'live') {
        scanTimestamp = Date.now() - (120 * 1000); // Look back 2 minutes
      }

      // Phase 1: DB Sync
      const { imported, updated, maxTimestamp, syncedIds } = await syncImages(
        path,
        (current, total) => setSyncProgress({ current, total }),
        abortControllerRef.current.signal,
        {
          afterTimestamp: scanTimestamp,
          importIntermediates: settings.importIntermediates,
          ...options
        }
      );

      // Phase 2: Orphan Scanning (Only run on Manual Sync to save resources)
      let orphansImported = 0;
      if (options.mode === 'manual') {
        orphansImported = await scanForOrphans(
          path,
          syncedIds,
          (phase, current, total) => {
            setSyncProgress({ current, total });
          },
          { importIntermediates: settings.importIntermediates }
        );
      }

      setSyncStatus('complete');
      const totalProcessed = (imported || 0) + (updated || 0) + orphansImported;
      setSyncProgress({ current: totalProcessed, total: totalProcessed });

      if (options.mode === 'manual') {
        const message = `Sync complete: ${imported} from DB, ${orphansImported} orphans recovered, ${updated} updated.`;
        addToast(message, 'success');
      }
      // specific toast for live? Maybe silent is better or just a small "New image imported"

      if (maxTimestamp && options.mode === 'manual') {
        setSettings(prev => ({ ...prev, lastSyncedAt: maxTimestamp }));
      }

      fetchData(false);

    } catch (e: any) {
      if (e.message === 'Aborted') setSyncStatus('idle');
      else {
        console.error('Sync failed', e);
        setSyncStatus('error');
        if (options.mode === 'manual') addToast('Sync failed: ' + e.message, 'error');
      }
    } finally {
      abortControllerRef.current = null;
      if (options.mode === 'live') {
        isLiveSyncingRef.current = false;
        // Check if we need to reset status if it was set? Reference logic above didn't set status for live
      } else {
        // Manual mode cleanup
        // If live sync finishes quickly, we might want to reset status to idle after a moment so user doesn't see 'Complete' forever
      }

      // Legacy cleanup logic or if we decided to show status for live?
      // For now, if mode was live we didn't touch syncStatus (to avoid UI flicker), so we don't need to unset it.
      // IF we decide to show live sync status, we handle it here.
    }
  }, [syncStatus, fetchData, settings.lastSyncedAt, settings.importIntermediates, addToast]);

  const cancelSync = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const debouncedSyncRef = useRef<NodeJS.Timeout | null>(null);

  // Refs for stable callback access to prevent re-creation of handleWatcherEvent
  const activeSqlWhereRef = useRef(activeSqlWhere);
  useEffect(() => { activeSqlWhereRef.current = activeSqlWhere; }, [activeSqlWhere]);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const startInvokeSyncRef = useRef(startInvokeSync);
  useEffect(() => { startInvokeSyncRef.current = startInvokeSync; }, [startInvokeSync]);

  // Handle Watcher Events - Now STABLE (Empty deps)
  const handleWatcherEvent = useCallback(async (event: WatchEvent) => {
    if (!event.paths || event.paths.length === 0) return;
    const isAdd = typeof event.type === 'string' ? ['create', 'modify', 'write', 'rename'].some(t => event.type.toString().toLowerCase().includes(t)) : true;

    // Access current values via Refs
    const currentSettings = settingsRef.current;

    if (isAdd) {
      // NOTE: InvokeAI events are now handled by Native Watcher + Event Listener below.
      // This HandleWatcherEvent is now ONLY for "Manual Monitored Folders" (User added folders).

      // --- Standard Folder Watcher Logic (For non-Invoke folders) ---
      const pathsToScan = event.paths.filter(p => /\.(png|jpg|jpeg|webp)$/i.test(p));
      for (const path of pathsToScan) {
        try {
          const { metadata, extra, width, height, fileSize, timestamp, isIntermediate } = await scanImageNative(path, undefined, true);

          if (!currentSettings.importIntermediates && isIntermediate) {
            continue;
          }

          const { normalizePath } = await import('../utils/pathUtils');
          const normalizedPath = normalizePath(path);
          const assetUrl = convertFileSrc(normalizedPath);
          const filename = path.split(/[\\/]/).pop() || 'unknown.png';

          const mappedMeta = {
            tool: metadata.tool || GeneratorTool.UNKNOWN,
            model: metadata.model || 'Unknown',
            seed: metadata.seed || 0,
            steps: metadata.steps || 0,
            cfg: metadata.cfg || 0,
            sampler: metadata.sampler || 'Unknown',
            positivePrompt: metadata.positivePrompt || '',
            negativePrompt: metadata.negativePrompt || '',
            workflowJson: metadata.workflowJson,
            rawParameters: metadata.rawParameters,
            loras: metadata.loras,
            controlNets: metadata.controlNets,
            ipAdapters: metadata.ipAdapters
          };

          const imageObj = {
            id: normalizedPath,
            url: assetUrl,
            thumbnailUrl: assetUrl,
            filename,
            fileSize: fileSize || 0,
            timestamp: timestamp || Date.now(),
            width: width || 0,
            height: height || 0,
            isFavorite: !!extra.isFavorite,
            isDeleted: false,
            metadata: mappedMeta
          };

          const { insertImage } = await import('../services/db');
          await insertImage(imageObj);

          // Update UI using Ref for current Filter State
          const currentWhere = activeSqlWhereRef.current;
          const cleanWhere = currentWhere.replace(/^WHERE\s+/i, '');
          if (!cleanWhere || cleanWhere === 'is_deleted = 0') {
            setImages(prev => [imageObj, ...prev]);
          }
        } catch (e) { console.error(e); }
      }
    }
  }, []); // STABLE CALLBACK allows updateWatcher to run only when folders change

  // Update Watcher when settings change
  useEffect(() => {
    if (!isLoaded) return;

    // Use a small timeout to let the UI update (toggle button color/state) before heavy background work
    const timeout = setTimeout(async () => {
      // If Live Watch is disabled, stop watching and return
      if (!isLiveWatching) {
        watcherService.stopWatching();
        // Also stop native watcher
        await invoke('start_live_link_watcher', { path: '' }).catch(console.error);
        return;
      }

      // 1. Start Native Rust Watcher for InvokeAI (The Heavy Lifting)
      if (settings.invokeAiPath) {
        const invokePath = settings.invokeAiPath.replace(/\\/g, '/').replace(/\/$/, '') + '/outputs/images';
        console.log('[Watcher] Starting Native Watcher on:', invokePath);
        // We pass the path to start. Passing empty string stops it.
        await invoke('start_live_link_watcher', { path: invokePath }).catch(console.error);
      }

      // 2. Start Standard Watcher for User Folders (Lightweight)
      // We use the original settings.monitoredFolders directly (no injection)
      watcherService.updateWatcher(settings, handleWatcherEvent);
    }, 200); // 200ms delay to ensure UI paint

    return () => clearTimeout(timeout);
  }, [settings.monitoredFolders, settings.invokeAiPath, isLoaded, handleWatcherEvent, isLiveWatching]);

  // Listen for Native Watcher Events
  useEffect(() => {
    let unlisten: () => void;

    // We listen for the specific event emitted by Rust
    import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlisten = await listen('invoke-live-event', () => {
        console.log('[Live Link] Native Event Received. Triggering Sync...');
        if (settings.invokeAiPath) {
          // Trigger Live Sync with debounce protection handled by the sync function or here?
          // Note: Rust already throttles to 1s. We can just call it.
          // We use mode 'live' which does internal logic.
          startInvokeSync(settings.invokeAiPath, { mode: 'live', syncFavorites: true, syncBoards: true });
        }
      });
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [settings.invokeAiPath, startInvokeSync]);

  // Helper to recalculate thumbnails
  const recalculateCollectionThumbnail = useCallback((col: Collection, currentImages: AIImage[]): string | undefined => {
    // NOTE: With pagination, `currentImages` isn't all images.
    // We should ideally query DB for "latest image in collection".
    // But for now keeping legacy logic with loaded images is acceptable fallback.
    if (col.customThumbnail) return col.customThumbnail;
    const validImages = col.imageIds
      .map(id => currentImages.find(img => img.id === id))
      .filter((img): img is AIImage => img !== undefined && !img.isDeleted);
    if (validImages.length === 0) return undefined;
    validImages.sort((a, b) => b.timestamp - a.timestamp);
    return validImages[0].thumbnailUrl;
  }, []);

  const updateCollectionThumbnails = useCallback((updatedImages: AIImage[]) => {
    setCollections(prev => prev.map(col => {
      const newThumb = recalculateCollectionThumbnail(col, updatedImages);
      if (newThumb === col.thumbnail) return col;
      return { ...col, thumbnail: newThumb };
    }));
  }, [recalculateCollectionThumbnail]);

  const cleanLibrary = useCallback(async () => {
    try {
      const { clearLibrary } = await import('../services/db');
      await clearLibrary();
      setImages([]);
      setTotalImages(0);
      setSettings(prev => ({ ...prev, lastSyncedAt: undefined }));
      addToast('Library cleared successfully.', 'success');
    } catch (e) {
      console.error(e);
      addToast('Failed to clear library.', 'error');
    }
  }, [addToast]);

  return (
    <LibraryContext.Provider value={{
      isLoaded,
      images,
      setImages,
      collections,
      setCollections,
      smartCollections,
      setSmartCollections,
      settings,
      setSettings,
      recentSearches,
      setRecentSearches,
      updateCollectionThumbnails,
      syncState: {
        status: syncStatus,
        progress: syncProgress,
      },
      startInvokeSync,
      cancelSync,
      loadMoreImages,
      hasMoreImages,
      totalImages,
      filters,
      setFilters,
      sortOption,
      setSortOption,
      clearAllFilters,
      activeSqlWhere,
      privacyEnabled,
      setPrivacyEnabled,
      cleanLibrary,
      isLiveWatching,
      setIsLiveWatching
    }}>
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibrary = () => {
  const context = React.useContext(LibraryContext);
  if (context === undefined) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
};