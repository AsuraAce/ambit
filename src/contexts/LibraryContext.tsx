
import * as React from 'react';
import { createContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { AIImage, Collection, SmartCollection, AppSettings, FilterState, SortOption } from '../types';
import { appRepository } from '../services/repository';
import { watcherService } from '../services/WatcherService';
import { WatchEvent } from '@tauri-apps/plugin-fs';
import { useToast } from '../hooks/useToast';
import { convertFileSrc } from '@tauri-apps/api/core';
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
  startInvokeSync: (path: string, options?: { syncFavorites: boolean, syncBoards: boolean }) => Promise<void>;
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
  const startInvokeSync = useCallback(async (path: string, options: { syncFavorites?: boolean, syncBoards?: boolean } = { syncFavorites: true, syncBoards: true }) => {
    if (syncStatus === 'syncing') return;

    setSyncStatus('syncing');
    setSyncProgress({ current: 0, total: 0 });
    abortControllerRef.current = new AbortController();

    try {
      const { syncImages } = await import('../services/invokeService');
      const { imported, maxTimestamp } = await syncImages(
        path,
        (current, total) => setSyncProgress({ current, total }),
        abortControllerRef.current.signal,
        { ...options, afterTimestamp: settings.lastSyncedAt }
      );

      setSyncStatus('complete');
      setSyncProgress({ current: imported, total: imported });

      addToast(`Sync complete: ${imported} new images added.`, 'success');

      // Update Last Synced Timestamp with the highest seen timestamp from the source
      if (maxTimestamp) {
        setSettings(prev => ({ ...prev, lastSyncedAt: maxTimestamp }));
      }

      // Refresh Data after Sync
      fetchData(false);

    } catch (e: any) {
      if (e.message === 'Aborted') setSyncStatus('idle');
      else {
        console.error('Sync failed', e);
        setSyncStatus('error');
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [syncStatus, fetchData, settings.lastSyncedAt]);

  const cancelSync = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Handle Watcher Events
  const handleWatcherEvent = useCallback(async (event: WatchEvent) => {
    // ... [Original Watcher Logic Preserved but modified to append/prepend] ...
    // For Safety with DB Paging:
    // If we receive a new file, we should insert it into DB (done by scanner?)
    // This part requires DB Insertion Logic if the watcher calls `scanImageNative` but doesn't insert.
    // The previous implementation of `scanImageNative` implicitly returned metadata, 
    // but DID NOT insert into DB. `App.tsx` or `LibraryContext` handled state update.
    // WE MUST INSERT INTO DB HERE now.

    if (!event.paths || event.paths.length === 0) return;
    const isAdd = typeof event.type === 'string' ? ['create', 'modify', 'write', 'rename'].some(t => event.type.toString().toLowerCase().includes(t)) : true;

    if (isAdd) {
      const pathsToScan = event.paths.filter(p => /\.(png|jpg|jpeg|webp)$/i.test(p));
      for (const path of pathsToScan) {
        try {
          const { metadata, extra, width, height, fileSize, timestamp } = await scanImageNative(path);
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

          // Insert to DB
          const { insertImage } = await import('../services/db');
          await insertImage(imageObj);

          // Update UI if it matches current filter (Simplified: Just prepend if no complex filter)
          // OR just re-fetch page 1
          if (!activeSqlWhere || activeSqlWhere === 'is_deleted = 0') {
            setImages(prev => [imageObj, ...prev]);
          }
        } catch (e) { console.error(e); }
      }
    }
  }, [activeSqlWhere]);

  // Update Watcher when settings change
  useEffect(() => {
    if (!isLoaded) return;
    watcherService.updateWatcher(settings, handleWatcherEvent);
  }, [settings.monitoredFolders, isLoaded, handleWatcherEvent]);

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
      setPrivacyEnabled
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