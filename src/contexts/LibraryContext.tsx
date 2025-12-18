
import * as React from 'react';
import { createContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { AIImage, Collection, SmartCollection, AppSettings } from '../types';
import { appRepository } from '../services/repository';
import { watcherService } from '../services/WatcherService';
import { WatchEvent } from '@tauri-apps/plugin-fs';
import { useToast } from '../hooks/useToast';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { parseImageBuffer, scanImageNative } from '../services/metadataParser';
import { GeneratorTool } from '../types';
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

  // Sync State
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'complete' | 'error'>('idle');
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load initial state
  useEffect(() => {
    const init = async () => {
      const state = await appRepository.load();

      // Auto-inject Environment Key if available
      const envKey = process.env.API_KEY;
      if (envKey) {
        state.settings.googleGeminiApiKey = envKey;
      }

      // Load Images from DB
      try {
        const { getAllImages } = await import('../services/db');
        // Use a safe limit for initial load to prevent freezing the UI on massive libraries
        // We will need to implement virtual/infinite scrolling at the DB level later.
        const dbImages = await getAllImages(100);

        let initialImages: AIImage[] = [];

        if (dbImages.length > 0) {
          initialImages = dbImages;
        } else {
          // Migration path: Repo -> DB
          if (state.images.length > 0) {
            const { insertImage } = await import('../services/db');
            console.log("Migrating legacy JSON images to SQLite DB...");
            for (const img of state.images) {
              await insertImage(img);
            }
            initialImages = state.images;
          }
        }

        setImages(initialImages);

        // --- DERIVE COLLECTIONS FROM IMAGES (Sync Boards) ---
        const imageGroups = new Map<string, string[]>();

        for (const img of initialImages) {
          if (img.boardId) {
            if (!imageGroups.has(img.boardId)) {
              imageGroups.set(img.boardId, []);
            }
            imageGroups.get(img.boardId)?.push(img.id);
          }
        }

        const derivedCollections: Collection[] = [];
        const existingColMap = new Map(state.collections.map(c => [c.id, c]));

        for (const [boardId, imageIds] of imageGroups.entries()) {
          const existing = existingColMap.get(boardId);

          // Boards use their name as ID currently.
          derivedCollections.push({
            id: boardId,
            name: existing?.name || boardId,
            createdAt: existing?.createdAt || Date.now(),
            imageIds: imageIds,
            thumbnail: existing?.thumbnail,
            customThumbnail: existing?.customThumbnail,
            description: existing?.description,
            color: existing?.color
          });
        }

        // Merge manual collections (not derived from current image groupIds)
        const derivedIds = new Set(derivedCollections.map(c => c.id));
        for (const col of state.collections) {
          if (!derivedIds.has(col.id)) {
            // Keep manual collections if they exist in state
            // and only keep images that exist in initialImages
            const validIds = col.imageIds.filter(id => initialImages.some(img => img.id === id));
            derivedCollections.push({ ...col, imageIds: validIds });
          }
        }

        // If syncBoardsToCollections is disabled, we might want to filter out boards 
        // that have no images if they weren't in the state already? 
        // Actually, the current logic is fine for "turning boards into collections" 
        // because once they are in 'derivedCollections', they persist through 'appRepository.save'.

        setCollections(derivedCollections);

      } catch (e) {
        console.error("Failed to load images from DB", e);
        setImages(state.images);
        setCollections(state.collections);
      }

      setSmartCollections(state.smartCollections);
      setSettings(state.settings);
      setRecentSearches(state.recentSearches);
      setIsLoaded(true);
    };
    init();
  }, []);

  // Persist Data Changes (Debounced)
  useEffect(() => {
    if (!isLoaded) return;
    const timeout = setTimeout(() => {
      appRepository.save({
        images,
        collections,
        smartCollections,
        settings,
        recentSearches
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [images, collections, smartCollections, settings, recentSearches, isLoaded]);

  // Sync Logic
  const refreshLibrary = useCallback(async () => {
    try {
      const { getAllImages } = await import('../services/db');
      const allImages = await getAllImages();
      setImages(allImages);

      // Rebuild Collections from Images
      setCollections(prevCollections => {
        // --- DERIVE COLLECTIONS FROM IMAGES (Sync Boards) ---
        const imageGroups = new Map<string, string[]>();

        for (const img of allImages) {
          if (img.boardId) {
            if (!imageGroups.has(img.boardId)) {
              imageGroups.set(img.boardId, []);
            }
            imageGroups.get(img.boardId)?.push(img.id);
          }
        }

        const derivedCollections: Collection[] = [];
        const existingColMap = new Map(prevCollections.map(c => [c.id, c]));

        for (const [boardId, imageIds] of imageGroups.entries()) {
          const existing = existingColMap.get(boardId);
          derivedCollections.push({
            id: boardId,
            name: existing?.name || boardId, // Board name is currently stored as ID
            createdAt: existing?.createdAt || Date.now(),
            imageIds: imageIds,
            thumbnail: existing?.thumbnail,
            customThumbnail: existing?.customThumbnail,
            description: existing?.description,
            color: existing?.color
          });
        }

        // Merge manual collections
        const derivedIds = new Set(derivedCollections.map(c => c.id));
        for (const col of prevCollections) {
          if (!derivedIds.has(col.id)) {
            const validIds = col.imageIds.filter(id => allImages.some(img => img.id === id));
            derivedCollections.push({ ...col, imageIds: validIds });
          }
        }
        return derivedCollections;
      });

    } catch (e) {
      console.error("Failed to refresh library", e);
    }
  }, []);

  const startInvokeSync = useCallback(async (path: string, options: { syncFavorites?: boolean, syncBoards?: boolean } = { syncFavorites: true, syncBoards: true }) => {
    if (syncStatus === 'syncing') return;

    setSyncStatus('syncing');
    setSyncProgress({ current: 0, total: 0 });

    // Create new abort controller for this run
    abortControllerRef.current = new AbortController();

    try {
      const { syncImages } = await import('../services/invokeService');

      const count = await syncImages(
        path,
        (current, total) => {
          setSyncProgress({ current, total });
        },
        abortControllerRef.current.signal,
        options // Pass options
      );

      setSyncStatus('complete');
      setSyncProgress({ current: count, total: count });
      await refreshLibrary(); // Await to ensure UI updates
    } catch (e: any) {
      if (e.message === 'Aborted') {
        setSyncStatus('idle');
      } else {
        console.error('Sync failed', e);
        setSyncStatus('error');
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [syncStatus, refreshLibrary]);

  const cancelSync = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  // Handle Watcher Events
  const handleWatcherEvent = useCallback(async (event: WatchEvent) => {
    console.log('File System Event:', event);

    // Normalize event data (Tauri v2 watch event structure)
    if (!event.paths || event.paths.length === 0) return;

    const isAdd = typeof event.type === 'string' ? ['create', 'modify', 'write', 'rename'].some(t => event.type.toString().toLowerCase().includes(t)) : true;
    const isDelete = typeof event.type === 'string' ? ['remove', 'delete'].some(t => event.type.toString().toLowerCase().includes(t)) : false;

    if (isDelete) {
      setImages(prev => prev.filter(img => !event.paths.includes(img.id)));
      return;
    }

    if (isAdd) {
      const pathsToScan = event.paths.filter(p => /\.(png|jpg|jpeg|webp)$/i.test(p));
      if (pathsToScan.length === 0) return;

      const newImagesBatch: AIImage[] = [];

      for (const path of pathsToScan) {
        try {
          const {
            metadata: meta,
            extra,
            isIntermediate,
            width,
            height,
            fileSize,
            timestamp
          } = await scanImageNative(path);

          if (isIntermediate) continue;

          const filename = path.split(/[\\/]/).pop() || 'unknown.png';

          // Map metadata
          const mappedMeta = {
            tool: meta.tool || GeneratorTool.UNKNOWN,
            model: meta.model || 'Unknown',
            seed: meta.seed || 0,
            steps: meta.steps || 0,
            cfg: meta.cfg || 0,
            sampler: meta.sampler || 'Unknown',
            positivePrompt: meta.positivePrompt || '',
            negativePrompt: meta.negativePrompt || '',
            workflowJson: meta.workflowJson,
            rawParameters: meta.rawParameters,
            loras: meta.loras,
            controlNets: meta.controlNets,
            ipAdapters: meta.ipAdapters
          };

          const { normalizePath } = await import('../utils/pathUtils');
          const normalizedPath = normalizePath(path);
          const assetUrl = convertFileSrc(normalizedPath);

          const newImage: AIImage = {
            id: normalizedPath,
            url: assetUrl,
            thumbnailUrl: assetUrl,
            filename: filename,
            fileSize: fileSize || 0,
            timestamp: timestamp || Date.now(),
            width: width || 0,
            height: height || 0,
            isFavorite: !!extra.isFavorite,
            isDeleted: false,
            metadata: mappedMeta
          };

          newImagesBatch.push(newImage);

        } catch (err) {
          console.error(`Failed to process watched file ${path}:`, err);
        }
      }

      if (newImagesBatch.length > 0) {
        setImages(prev => {
          // Merge batch, preferrring new/incoming version if duplicate
          // or we can append. Usually efficient to filter then append or use Map.

          // Optimization: Create a Map of existing images for O(1) lookup is fine, 
          // or just filter out collisions. 
          // Since "prev" can be large, we want to minimize ops.

          // Let's filter out any existing images that are being updated
          const updatedIds = new Set(newImagesBatch.map(i => i.id));
          const filteredPrev = prev.filter(p => !updatedIds.has(p.id));

          return [...newImagesBatch, ...filteredPrev];
        });

        addToast(`Imported ${newImagesBatch.length} new files`, 'info');
      }
    }
  }, [addToast]);

  // Update Watcher when settings change
  useEffect(() => {
    if (!isLoaded) return;
    watcherService.updateWatcher(settings, handleWatcherEvent);
    return () => {
      // No cleanup needed here as updateWatcher handles it, 
      // or we could stop on unmount of provider (app close).
    };
  }, [settings.monitoredFolders, isLoaded, handleWatcherEvent]);

  // Helper to recalculate thumbnails
  const recalculateCollectionThumbnail = useCallback((col: Collection, currentImages: AIImage[]): string | undefined => {
    if (col.customThumbnail) return col.customThumbnail;

    // Get all valid images in this collection (excluding deleted)
    const validImages = col.imageIds
      .map(id => currentImages.find(img => img.id === id))
      .filter((img): img is AIImage => img !== undefined && !img.isDeleted);

    if (validImages.length === 0) return undefined;

    // Deterministic Sort:
    // 1. Pinned images first
    // 2. Newest images next
    validImages.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.timestamp - a.timestamp;
    });

    // Return the first image (Newest Pinned, or just Newest)
    return validImages[0].thumbnailUrl;
  }, []);

  const updateCollectionThumbnails = useCallback((updatedImages: AIImage[]) => {
    setCollections(prev => prev.map(col => {
      const newThumb = recalculateCollectionThumbnail(col, updatedImages);
      // Optimization: Only update reference if changed
      if (newThumb === col.thumbnail) return col;
      return { ...col, thumbnail: newThumb };
    }));
  }, [recalculateCollectionThumbnail]);

  // Watch for image changes (pinning, deleting) to auto-update collection thumbnails
  useEffect(() => {
    if (!isLoaded) return;

    const timeout = setTimeout(() => {
      updateCollectionThumbnails(images);
    }, 500); // Debounce to prevent thrashing on rapid changes

    return () => clearTimeout(timeout);
  }, [images, isLoaded, updateCollectionThumbnails]);

  // Update Monitored Folder Counts
  useEffect(() => {
    if (!isLoaded || settings.monitoredFolders.length === 0) return;

    // We need normalized comparison to handle slash differences
    const updateCounts = async () => {
      const { normalizePath } = await import('../utils/pathUtils');

      let hasChanges = false;
      const updatedFolders = settings.monitoredFolders.map(folder => {
        const normalizedFolder = normalizePath(folder.path);
        const count = images.filter(img => img.id.startsWith(normalizedFolder)).length;

        if (count !== folder.imageCount) {
          hasChanges = true;
          return { ...folder, imageCount: count };
        }
        return folder;
      });

      if (hasChanges) {
        setSettings(prev => ({ ...prev, monitoredFolders: updatedFolders }));
      }
    };

    updateCounts();
  }, [images, isLoaded, settings.monitoredFolders.length]); // Only run if image count or folder count changes (avoid loop on setting update)

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
      // Sync State
      syncState: {
        status: syncStatus,
        progress: syncProgress,
      },
      startInvokeSync,
      cancelSync
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