
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
import { LibraryStats } from '../services/db/searchRepo';

interface Facets {
  models: string[];
  loras: { name: string; count: number }[];
  tools: string[];
}

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
  refreshCollectionThumbnails: () => Promise<void>;
  // New Data Sources
  facets: Facets;
  stats: LibraryStats;
  // Sync State
  syncState: {
    status: 'idle' | 'syncing' | 'complete' | 'error';
    progress: { current: number; total: number };
    message?: string;
  };
  startInvokeSync: (path: string, options?: { syncFavorites?: boolean, syncBoards?: boolean, afterTimestamp?: number, importIntermediates?: boolean, starredAs?: 'favorite' | 'pin' | 'both' | 'none', mode?: 'manual' | 'live' }) => Promise<void>;
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
  activeSqlParams: any[];
  privacyEnabled: boolean;
  setPrivacyEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  cleanLibrary: () => Promise<void>;
  isLiveWatching: boolean;
  setIsLiveWatching: React.Dispatch<React.SetStateAction<boolean>>;
  isFiltering: boolean;
  toggleFavorite: (id: string) => Promise<void>;
  refreshMaintenanceCounts: () => Promise<void>;
}

export const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

export const LibraryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { addToast } = useToast();
  const [isLoaded, setIsLoaded] = useState(false);
  const [images, setImages] = useState<AIImage[]>([]);
  // Ref to access images inside callbacks without dependencies
  const imagesRef = useRef<AIImage[]>(images);
  useEffect(() => { imagesRef.current = images; }, [images]);

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
    syncBoardsToCollections: false,
    importOrphans: true,
    starredAs: 'favorite'
  });
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [privacyEnabled, setPrivacyEnabled] = useState(true);
  const [isLiveWatching, setIsLiveWatching] = useState(false);

  // Stats & Facets
  const [facets, setFacets] = useState<Facets>({ models: [], loras: [], tools: [] });
  const [stats, setStats] = useState<LibraryStats>({
    totalImages: 0,
    totalGenerations: 0,
    avgSteps: 0,
    estSizeMB: '0',
    modelStats: []
  });

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


  // Filtering State
  const [isFiltering, setIsFiltering] = useState(false);

  // --- Helper: Refresh Global Data (Stats, Facets) ---
  const refreshMetadata = useCallback(async () => {
    try {
      const { getFacets, getLibraryStats } = await import('../services/db/searchRepo');
      // Dynamic Facets: Use current filters.
      const [newFacets, newStats] = await Promise.all([
        getFacets(activeSqlWhere || 'WHERE is_deleted = 0', activeSqlParams),
        getLibraryStats(activeSqlWhere || 'WHERE is_deleted = 0', activeSqlParams)
      ]);
      setFacets(newFacets);
      setStats(newStats);
    } catch (e) { console.error("Failed to refresh metadata", e); }
  }, [activeSqlWhere, activeSqlParams]);


  // Helper: Refresh thumbs for Manual Collections (those without a board_id link in DB)
  const refreshManualCollectionThumbs = async (currentCollections: Collection[]) => {
    const { getCollectionThumbnail } = await import('../services/db/collectionRepo');
    let changed = false;

    // Process in parallel
    const updates = await Promise.all(currentCollections.map(async (col) => {
      if (col.imageIds && col.imageIds.length > 0 && !col.customThumbnail) {
        const newThumb = await getCollectionThumbnail(col.imageIds);
        if (newThumb && newThumb !== col.thumbnail) {
          // Ensure it's a URL
          const thumbUrl = (newThumb.startsWith('http') || newThumb.startsWith('data:') || newThumb.startsWith('blob:'))
            ? newThumb
            : convertFileSrc(newThumb.replace(/\\/g, '/'));
          return { id: col.id, thumbnail: thumbUrl };
        }
      }
      return null;
    }));

    const updateMap = new Map(updates.filter(u => u !== null).map(u => [u!.id, u!.thumbnail]));

    if (updateMap.size > 0) {
      setCollections(prev => prev.map(c => {
        if (updateMap.has(c.id)) {
          return { ...c, thumbnail: updateMap.get(c.id)! };
        }
        return c;
      }));
    }
  };

  // Hydrate Collections from DB (Optimized O(1) + Count)
  const refreshCollectionsFromDb = useCallback(async () => {
    const { hydrateCollections } = await import('../services/db/collectionRepo');
    const boardMap = await hydrateCollections();

    // 1. Update Boards (Fast)
    setCollections(prevCols => {
      let hasChange = false;
      const nextCols = prevCols.map(col => {
        const dbData = boardMap[col.id]; // Map uses board_id, which is col.id for boards
        if (dbData) {
          const countChanged = dbData.count !== (col.count ?? col.imageIds.length);
          const thumbChanged = dbData.thumbnail && dbData.thumbnail !== col.thumbnail;

          if (countChanged || thumbChanged) {
            hasChange = true;
            return {
              ...col,
              imageIds: [], // Clear IDs to save memory/transfer limits. We rely on 'count' and board_id queries.
              count: dbData.count,
              thumbnail: dbData.thumbnail ? (dbData.thumbnail.startsWith('http') ? dbData.thumbnail : convertFileSrc(dbData.thumbnail.replace(/\\/g, '/'))) : col.thumbnail
            };
          }
        }
        return col;
      });

      if (hasChange) {
        refreshManualCollectionThumbs(nextCols);
        return nextCols;
      } else {
        refreshManualCollectionThumbs(prevCols);
        return prevCols;
      }
    });
  }, []);

  const refreshCollectionThumbnails = useCallback(async () => {
    refreshCollectionsFromDb();
  }, [refreshCollectionsFromDb]);

  // --- SQL Generation Effect ---
  useEffect(() => {
    const { where, params } = buildSqlWhereClause(filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections);

    setActiveSqlWhere(where);

    // Deep equality check for params to prevent unnecessary re-fetches
    setActiveSqlParams(prev => {
      if (prev.length === params.length && prev.every((v, i) => v === params[i])) {
        return prev;
      }
      return params;
    });

    const paramsChanged = activeSqlParams.length !== params.length || !activeSqlParams.every((v, i) => v === params[i]);

    if (where !== activeSqlWhere || paramsChanged) {
      setImages([]);
      setHasMoreImages(true);
      setTotalImages(0);
      setIsFiltering(true);
    }
  }, [filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections]);

  // Refs for stable callback access to prevent re-creation of handleWatcherEvent
  const activeSqlWhereRef = useRef(activeSqlWhere);
  useEffect(() => { activeSqlWhereRef.current = activeSqlWhere; }, [activeSqlWhere]);

  const activeSqlParamsRef = useRef(activeSqlParams);
  useEffect(() => { activeSqlParamsRef.current = activeSqlParams; }, [activeSqlParams]);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // --- Data Fetching Logic (Debounced slightly or immediate) ---
  const fetchData = useCallback(async (isLoadMore: boolean) => {
    // Race Condition Fix:
    // If this is a Load More (infinite scroll), we strictly respect the lock.
    // If this is a NEW filter (not load more), we allow it to proceed even if a fetch is running,
    // effectively "racing" it, but the Stale Check below will discard the old fetch's results.
    if (isFetchingRef.current && isLoadMore) return;

    isFetchingRef.current = true;
    if (!isLoadMore) setIsFiltering(true);

    // Capture "Request Context" to detect staleness later
    const requestingWhere = activeSqlWhereRef.current;
    const requestingParams = activeSqlParamsRef.current; // access ref active value

    try {
      const { searchImages, countImages } = await import('../services/db/searchRepo');

      // Determine Sort
      let sortField = 'timestamp';
      let sortOrder: 'ASC' | 'DESC' = 'DESC';

      switch (sortOption) {
        case 'date_asc': sortField = 'timestamp'; sortOrder = 'ASC'; break;
        case 'name_asc': sortField = 'path'; sortOrder = 'ASC'; break;
        case 'name_desc': sortField = 'path'; sortOrder = 'DESC'; break;
        case 'size_desc': sortField = 'file_size'; sortOrder = 'DESC'; break;
        case 'size_asc': sortField = 'file_size'; sortOrder = 'ASC'; break;
        case 'date_desc': default: sortField = 'timestamp'; sortOrder = 'DESC'; break;
      }

      // If New Filter -> Get Count First
      if (!isLoadMore) {
        const count = await countImages(requestingWhere, requestingParams);

        // STALE CHECK 1: Before setting total
        const currentParams = activeSqlParamsRef.current;
        const isStale = requestingWhere !== activeSqlWhereRef.current ||
          requestingParams.length !== currentParams.length ||
          !requestingParams.every((v, i) => v === currentParams[i]);

        if (isStale) return;

        setTotalImages(count);

        // Refresh dynamic stats whenever filter changes
        refreshMetadata();

        if (count === 0) {
          setImages([]);
          setHasMoreImages(false);
          isFetchingRef.current = false;
          setIsFiltering(false);
          return;
        }
      }

      // Fetch Page
      const offset = isLoadMore ? images.length : 0;
      const newBatch = await searchImages(requestingWhere, requestingParams, PAGE_SIZE, offset, sortField, sortOrder);

      // STALE CHECK 2: Before updating images
      const currentParams = activeSqlParamsRef.current;
      const isStale = requestingWhere !== activeSqlWhereRef.current ||
        requestingParams.length !== currentParams.length ||
        !requestingParams.every((v, i) => v === currentParams[i]);

      if (isStale) {
        // console.log("Discarding stale fetch result");
        return;
      }

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
      if (!isLoadMore) {
        // Add a small artificial delay to prevent flickering on super fast loads?
        // Or just set it false immediately.
        setIsFiltering(false);
      }
    }
  }, [activeSqlWhere, activeSqlParams, sortOption, images.length, refreshMetadata]);

  // Trigger Fetch when SQL/Sort changes (Initial Load)
  useEffect(() => {
    if (!isLoaded) return; // Wait for init
    fetchData(false);
    // Note: We do NOT refresh collections here anymore to prevent CPU spikes.
    // Collections are loaded from persistence or refreshed after Sync.
  }, [activeSqlWhere, activeSqlParams, sortOption, isLoaded]);


  // Load initial state (Settings & Collections)
  useEffect(() => {
    const init = async () => {
      const state = await appRepository.load();

      const envKey = process.env.API_KEY;
      if (envKey) state.settings.googleGeminiApiKey = envKey;

      const { normalizeAllPaths } = await import('../services/db/maintenanceRepo');
      const { migrateSchema } = await import('../services/db/migrations');
      await migrateSchema();
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

      setRecentSearches(state.recentSearches);

      // Refresh Stats & Facets
      await refreshMetadata();

      // Refresh Collections (Optimized O(1)) 
      // This MUST run on startup to validate the cached state against the DB.
      await refreshCollectionsFromDb();

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
  const startInvokeSync = useCallback(async (path: string, optionsInput?: { syncFavorites?: boolean, syncBoards?: boolean, afterTimestamp?: number, importIntermediates?: boolean, starredAs?: 'favorite' | 'pin' | 'both' | 'none', mode?: 'manual' | 'live' }) => {
    const options = {
      syncFavorites: true,
      syncBoards: true,
      starredAs: settingsRef.current.starredAs || 'favorite',
      mode: 'manual' as const,
      ...optionsInput
    };

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
      const { syncImages } = await import('../services/invoke/syncService');
      const { scanForOrphans } = await import('../services/invoke/orphanScanner');

      // Determine Timestamp Strategy
      // Manual: Use settings.lastSyncedAt
      // Live: Use "Now - 2 minutes" to catch just the new file safely
      let scanTimestamp = settings.lastSyncedAt;
      if (options.mode === 'live') {
        scanTimestamp = Date.now() - (120 * 1000); // Look back 2 minutes
      }

      console.log('[LibraryContext] Starting Sync. Settings lastSyncedAt:', settingsRef.current.lastSyncedAt);

      // Determine correct timestamp: Explicit option > Settings Ref > 0 default
      const effectiveTimestamp = options.afterTimestamp !== undefined ? options.afterTimestamp : settingsRef.current.lastSyncedAt;

      // Phase 1: DB Sync
      const { imported, updated, maxTimestamp: newTs, boardMapping, syncedIds } = await syncImages(
        settingsRef.current.invokeAiPath!,
        (c, t) => setSyncProgress({ current: c, total: t }),
        abortControllerRef.current.signal,
        {
          syncFavorites: options.syncFavorites,
          syncBoards: options.syncBoards,
          afterTimestamp: effectiveTimestamp,
          importIntermediates: options.importIntermediates !== undefined ? options.importIntermediates : settingsRef.current.importIntermediates,
          starredAs: options.starredAs
        }
      );

      // 4. Sync Boards to Collections (Vital for consistency)
      if (settingsRef.current.syncBoardsToCollections && boardMapping && boardMapping.size > 0) {
        setCollections(prev => {
          const next = [...prev];
          let changed = false;
          boardMapping.forEach((data, id) => {
            const { name, createdAt } = data;
            const existing = next.find(c => c.id === id);
            if (!existing) {
              // Create new collection for board
              next.push({
                id: id,
                name: name,
                imageIds: [], // Hydrated later
                count: 0,
                createdAt: createdAt || Date.now()
              });
              changed = true;
            } else if (existing.name !== name) {
              // Update name if changed
              const idx = next.indexOf(existing);
              next[idx] = { ...existing, name };
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }

      // Phase 2: Orphan Scanning (Only run on Manual Sync to save resources)
      let orphansImported = 0;
      if (options.mode === 'manual' && settings.importOrphans !== false) {
        orphansImported = await scanForOrphans(
          settingsRef.current.invokeAiPath!,
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

      if (options.mode === 'manual' && newTs) {
        setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
      }

      if (options.mode === 'manual') {
        fetchData(false); // Immediate refresh
        refreshMetadata(); // Refresh stats/facets
        // collection counts update
        // We delay slightly to allow setCollections above to settle? 
        // Actually, refreshCollectionsFromDb uses the 'prev' state inside its callback usually?
        // No, it calls DB then sets `prev`. 
        // We should run this after a short tick or rely on the state update to be "eventual".
        setTimeout(() => refreshCollectionsFromDb(), 100);
      }

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

          const { insertImage } = await import('../services/db/imageRepo');
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
          startInvokeSync(settings.invokeAiPath, { mode: 'live', syncFavorites: true, syncBoards: true, starredAs: settings.starredAs });
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



  const cleanLibrary = useCallback(async () => {
    try {
      const { clearLibrary } = await import('../services/db/maintenanceRepo');
      await clearLibrary();
      setImages([]);
      setCollections([]); // Clear Collections from State & Persistence
      setTotalImages(0);
      setSettings(prev => ({ ...prev, lastSyncedAt: null }));
      addToast('Library and Collections cleared successfully.', 'success');
    } catch (e) {
      addToast('Failed to clear library.', 'error');
    }
  }, [addToast]);

  const toggleFavorite = useCallback(async (id: string) => {
    try {
      // 1. Determine new state using Ref (freshest data without stale closure)
      const currentImages = imagesRef.current;
      const target = currentImages.find(i => i.id === id);

      if (!target) {
        console.warn('[Toggle Favorite] Image not found in state:', id);
        return;
      }

      const newStatus = !target.isFavorite;

      // 2. Optimistic Update
      setImages(prev => prev.map(img => img.id === id ? { ...img, isFavorite: newStatus } : img));

      // 3. Database Update
      const { toggleImageFavorite } = await import('../services/db/imageRepo');
      await toggleImageFavorite(id, newStatus);

    } catch (e) {
      console.error("Failed to toggle favorite", e);
      addToast('Failed to save favorite status', 'error');
      // Revert if needed (omitted for speed)
    }
  }, []);

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
      refreshCollectionThumbnails,
      facets,
      stats,
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
      activeSqlParams,
      privacyEnabled,
      setPrivacyEnabled,
      cleanLibrary,
      isLiveWatching,
      setIsLiveWatching,
      isFiltering,
      toggleFavorite,
      refreshMaintenanceCounts: refreshMetadata
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