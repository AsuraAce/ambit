import * as React from 'react';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AIImage, Collection, SmartCollection, FilterState } from '../types';
import { useToast } from './useToast';
import { useSettingsStore } from '../stores/settingsStore';
import { getEffectiveMaskedKeywords } from '../utils/maskingUtils';
import { useCollectionStore } from '../stores/collectionStore';
import { isImageMasked } from '../utils/maskingUtils';
import {
  upsertCollection,
  deleteCollectionFromDb,
  addImagesToCollection as addImgsToCol,
  removeImagesFromCollection as removeImgsFromCol,
  setCollectionCustomThumbnail
} from '../services/db/collectionRepo';

interface UseCollectionOperationsProps {
  collections: Collection[];
  smartCollections: SmartCollection[];
  setAllCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  refreshCollections: (debounced?: boolean) => Promise<void>;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
  activeCollectionId: string | null;
}

export const useCollectionOperations = ({
  collections,
  smartCollections,
  setAllCollections,
  refreshCollections,
  setFilters,
  setImages,
  activeCollectionId
}: UseCollectionOperationsProps) => {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const maskedKeywords = useSettingsStore(s => getEffectiveMaskedKeywords(s.settings));
  const refreshCollectionThumbnails = useCollectionStore(s => s.refreshCollectionThumbnails);
  const refreshSmartCounts = useCollectionStore(s => s.refreshSmartCounts);
  const activeCollectionIdRef = React.useRef(activeCollectionId);
  const membershipMutationTailsRef = React.useRef(new Map<string, Promise<void>>());
  activeCollectionIdRef.current = activeCollectionId;

  const serializeCollectionMembershipMutation = useCallback(<T,>(
    collectionId: string,
    mutation: () => Promise<T>
  ): Promise<T> => {
    const previous = membershipMutationTailsRef.current.get(collectionId) ?? Promise.resolve();
    const result = previous.then(mutation);
    const tail = result.then(() => undefined, () => undefined);
    membershipMutationTailsRef.current.set(collectionId, tail);
    void tail.then(() => {
      if (membershipMutationTailsRef.current.get(collectionId) === tail) {
        membershipMutationTailsRef.current.delete(collectionId);
      }
    });
    return result;
  }, []);

  const refreshAffectedCollectionThumbnails = useCallback((affectedCollections: Collection[]) => {
    const hasStaticCollection = affectedCollections.some(collection => !collection.filters);
    const smartCollectionIds = [...new Set(
      affectedCollections
        .filter(collection => !!collection.filters)
        .map(collection => collection.id)
    )];

    if (hasStaticCollection) {
      void refreshCollectionThumbnails(true);
    }

    if (smartCollectionIds.length > 0) {
      void refreshSmartCounts({
        collectionIds: smartCollectionIds,
        includeArchived: true,
        includePromptSearch: true,
        markPending: true
      });
    }
  }, [refreshCollectionThumbnails, refreshSmartCounts]);

  const createCollection = useCallback(async (name: string, filters?: FilterState) => {
    const id = `c_${Date.now()}`;
    const newCol: Collection = {
      id,
      name,
      createdAt: Date.now(),
      source: 'ambit',
      imageIds: [],
      count: 0,
      filters // Hybrid Support: Initialize with filters if provided
    };

    // Optimistic Update
    setAllCollections(prev => [...prev, newCol]);

    try {
      await upsertCollection(newCol);
      addToast(`Collection "${name}" created`, 'success');
      // Background refresh to ensure everything is in sync (smart stats etc)
      await refreshCollections();
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.filter(c => c.id !== id));
      addToast("Failed to create collection", "error");
    }
  }, [setAllCollections, refreshCollections, addToast]);

  const updateCollectionFilters = useCallback(async (id: string, filters: FilterState | undefined) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;

    // Sanitize filters to prevent recursive self-reference
    let cleanFilters = filters;
    if (filters) {
      cleanFilters = { ...filters };
      // If the filter's collectionId matches the collection we are updating, remove it.
      // This prevents the "Must be in Collection X" rule from being saved into Collection X itself,
      // which would restrict results to only manually added items (hybrid) and ignore dynamic matches.
      if (cleanFilters.collectionId === id) {
        cleanFilters.collectionId = null;
      }
    }

    // Optimistic Update
    setAllCollections(prev => prev.map(c => c.id === id ? { ...c, filters: cleanFilters } : c));

    try {
      // If we are clearing filters (filters === undefined), we pass null/undefined to upsert
      await upsertCollection({ ...col, filters: cleanFilters });
      addToast(cleanFilters ? "Filters updated" : "Collection converted to static", "success");
      await refreshCollections();
      if (cleanFilters) {
        void useCollectionStore.getState().refreshSmartCounts({
          collectionIds: [id],
          includeArchived: true,
          includePromptSearch: true
        });
      }
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.map(c => c.id === id ? col : c));
      addToast("Failed to update filters", "error");
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections, addToast]);

  const deleteCollection = useCallback(async (id: string) => {
    const original = [...collections, ...smartCollections].find(c => c.id === id);
    if (!original) return;

    // Optimistic Update
    setAllCollections(prev => prev.filter(c => c.id !== id));
    if (activeCollectionId === id) {
      setFilters((prev) => ({ ...prev, collectionId: null }));
    }

    try {
      await deleteCollectionFromDb(id);
      addToast("Collection deleted", "success");
      await refreshCollections();
    } catch (e) {
      // Rollback
      setAllCollections(prev => [...prev, original]);
      addToast("Failed to delete collection", "error");
    }
  }, [collections, smartCollections, activeCollectionId, setFilters, setAllCollections, refreshCollections, addToast]);

  const renameCollection = useCallback(async (id: string, newName: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;

    // Optimistic Update
    setAllCollections(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));

    try {
      await upsertCollection({ ...col, name: newName });
      addToast("Collection renamed", "success");
      await refreshCollections();
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.map(c => c.id === id ? col : c));
      addToast("Failed to rename collection", "error");
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections, addToast]);

  const setCollectionColor = useCallback(async (id: string, color: string | undefined) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;

    // Optimistic Update
    setAllCollections(prev => prev.map(c => c.id === id ? { ...c, color } : c));

    try {
      await upsertCollection({ ...col, color });
      refreshCollections(true);
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.map(c => c.id === id ? col : c));
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections]);

  const toggleArchiveCollection = useCallback(async (id: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;

    const newState = !col.isArchived;

    // Optimistic Update
    setAllCollections(prev => prev.map(c => c.id === id ? { ...c, isArchived: newState } : c));
    if (activeCollectionId === id && newState) {
      setFilters((prev) => ({ ...prev, collectionId: null }));
    }

    try {
      await upsertCollection({ ...col, isArchived: newState });
      addToast(newState ? "Collection archived" : "Collection unarchived", "info");
      refreshCollections(true);
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.map(c => c.id === id ? col : c));
      addToast("Failed to update archive status", "error");
    }
  }, [collections, smartCollections, activeCollectionId, setFilters, setAllCollections, refreshCollections, addToast]);

  const togglePinCollection = useCallback(async (id: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;

    const newState = !col.isPinned;

    // Optimistic Update
    setAllCollections(prev => prev.map(c => c.id === id ? { ...c, isPinned: newState } : c));

    try {
      await upsertCollection({ ...col, isPinned: newState });
      refreshCollections(true);
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.map(c => c.id === id ? col : c));
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections]);

  const addImagesToCollection = useCallback(async (imageIds: string[], collectionId: string): Promise<boolean> => {
    const col = [...collections, ...smartCollections].find(c => c.id === collectionId);
    if (!col) return false;

    return serializeCollectionMembershipMutation(collectionId, async () => {
      let collectionBeforeMutation = col;

      // Optimistic Update: Increment count
      setAllCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        collectionBeforeMutation = c;
        return { ...c, count: (c.count || 0) + imageIds.length };
      }));

      try {
        await addImgsToCol(collectionId, imageIds);
      } catch (e) {
        // Rollback to the state at the start of this serialized mutation.
        setAllCollections(prev => prev.map(c => c.id === collectionId ? collectionBeforeMutation : c));
        addToast("Failed to add to collection", "error");
        return false;
      }

      addToast(`Added images to collection`, 'success');
      try {
        await Promise.all([
          refreshCollections(),
          queryClient.invalidateQueries({ queryKey: ['images'] }),
          queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
        ]);
      } catch (e) {
        console.error("[Collections] Failed to refresh after adding images", e);
      }

      refreshAffectedCollectionThumbnails([collectionBeforeMutation]);
      return true;
    });
  }, [collections, smartCollections, setAllCollections, refreshCollections, refreshAffectedCollectionThumbnails, queryClient, addToast, serializeCollectionMembershipMutation]);

  const removeImagesFromCollection = useCallback(async (
    imageIds: string[],
    collectionId: string,
    onPersisted?: () => void
  ): Promise<boolean> => {
    const col = [...collections, ...smartCollections].find(c => c.id === collectionId);
    if (!col) return false;

    return serializeCollectionMembershipMutation(collectionId, async () => {
      let collectionBeforeMutation = col;

      // Optimistic Update: Decrement count
      setAllCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        collectionBeforeMutation = c;
        return { ...c, count: Math.max(0, (c.count || 0) - imageIds.length) };
      }));

      try {
        // Handle Manual Exclusions for Hybrid Smart Collections
        if (collectionBeforeMutation.filters) {
          const currentExclusions = collectionBeforeMutation.manualExclusions || [];
          const newExclusions = [...new Set([...currentExclusions, ...imageIds])];
          await upsertCollection({ ...collectionBeforeMutation, manualExclusions: newExclusions });
        }

        // Always attempt removal from junction table (handles manual additions)
        await removeImgsFromCol(collectionId, imageIds);
      } catch (e) {
        // Rollback to the state at the start of this serialized mutation.
        setAllCollections(prev => prev.map(c => c.id === collectionId ? collectionBeforeMutation : c));
        addToast("Failed to remove from collection", "error");
        return false;
      }

      onPersisted?.();

      // Keep the active grid stable until persistence succeeds so a failed viewer
      // edit cannot close or advance away from an image that still belongs here.
      if (activeCollectionIdRef.current === collectionId) {
        setImages(prev => prev.filter(img => !imageIds.includes(img.id)));
      }

      addToast("Removed from collection", "info");
      try {
        await Promise.all([
          refreshCollections(),
          queryClient.invalidateQueries({ queryKey: ['images'] }),
          queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
        ]);
      } catch (e) {
        console.error("[Collections] Failed to refresh after removing images", e);
      }

      refreshAffectedCollectionThumbnails([collectionBeforeMutation]);
      return true;
    });
  }, [collections, smartCollections, setAllCollections, refreshCollections, refreshAffectedCollectionThumbnails, queryClient, addToast, setImages, serializeCollectionMembershipMutation]);

  // Deprecated/Aliased for backward compat
  const saveSmartCollection = useCallback(async (name: string, filters: FilterState) => {
    return createCollection(name, filters);
  }, [createCollection]);

  const moveImagesBetweenCollections = useCallback(async (imageIds: string[], sourceId: string, targetId: string) => {
    const sourceCol = [...collections, ...smartCollections].find(c => c.id === sourceId);
    const targetCol = [...collections, ...smartCollections].find(c => c.id === targetId);
    if (!sourceCol || !targetCol) return;

    // Optimistic Update: Transfer counts
    setAllCollections(prev => prev.map(c => {
      if (c.id === sourceId) return { ...c, count: Math.max(0, (c.count || 0) - imageIds.length) };
      if (c.id === targetId) return { ...c, count: (c.count || 0) + imageIds.length };
      return c;
    }));

    // Optimistic Grid Removal: Remove from current view if we are looking at the source collection
    if (activeCollectionId === sourceId) {
      setImages(prev => prev.filter(img => !imageIds.includes(img.id)));
    }

    try {
      // 1. Remove from source
      if (sourceCol.filters) {
        const currentExclusions = sourceCol.manualExclusions || [];
        const newExclusions = [...new Set([...currentExclusions, ...imageIds])];
        await upsertCollection({ ...sourceCol, manualExclusions: newExclusions });
      }
      await removeImgsFromCol(sourceId, imageIds);

      // 2. Add to target
      await addImgsToCol(targetId, imageIds);

      addToast(`Moved images to ${targetCol.name}`, 'success');
      await Promise.all([
        refreshCollections(),
        queryClient.invalidateQueries({ queryKey: ['images'] }),
        queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      ]);
      refreshAffectedCollectionThumbnails([sourceCol, targetCol]);
    } catch (e) {
      // Rollback both
      setAllCollections(prev => prev.map(c => {
        if (c.id === sourceId) return sourceCol;
        if (c.id === targetId) return targetCol;
        return c;
      }));
      addToast("Failed to move images", "error");
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections, refreshAffectedCollectionThumbnails, queryClient, addToast]);

  const setCollectionThumbnail = useCallback(async (collectionId: string, image: AIImage) => {
    const col = [...collections, ...smartCollections].find(c => c.id === collectionId);
    if (!col) {
      addToast("Collection not found", "error");
      return;
    }

    const nextCollection: Collection = {
      ...col,
      customThumbnail: image.id,
      thumbnail: image.thumbnailUrl || image.url,
      safeThumbnail: undefined,
      thumbnailIsSensitive: isImageMasked(image, true, maskedKeywords),
      thumbnailSourceKind: 'customImage'
    };

    setAllCollections(prev => prev.map(c => c.id === collectionId ? { ...c, ...nextCollection } : c));

    try {
      await setCollectionCustomThumbnail(collectionId, image.id);
      addToast("Thumbnail updated", "success");
      void refreshCollections(true).catch((error) => {
        console.error('[Collections] Failed to reconcile collection thumbnail state', error);
      });
      void queryClient.invalidateQueries({ queryKey: ['images'] }).catch((error) => {
        console.error('[Collections] Failed to invalidate image queries after thumbnail update', error);
      });
    } catch (e) {
      setAllCollections(prev => prev.map(c => c.id === collectionId ? col : c));
      console.error('[Collections] Failed to set collection thumbnail', e);
      addToast("Failed to update thumbnail", "error");
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections, queryClient, addToast, maskedKeywords]);

  const resetCollectionThumbnail = useCallback(async (id: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) {
      addToast("Collection not found", "error");
      return;
    }

    setAllCollections(prev => prev.map(c => c.id === id ? {
      ...c,
      customThumbnail: undefined,
      thumbnail: undefined,
      safeThumbnail: undefined,
      thumbnailIsSensitive: undefined,
      thumbnailSourceKind: 'dynamic'
    } : c));

    try {
      await setCollectionCustomThumbnail(id, null);
      addToast("Thumbnail reset", "info");
      void refreshCollections(true).catch((error) => {
        console.error('[Collections] Failed to reconcile collection thumbnail reset', error);
      });
      void queryClient.invalidateQueries({ queryKey: ['images'] }).catch((error) => {
        console.error('[Collections] Failed to invalidate image queries after thumbnail reset', error);
      });
    } catch (e) {
      setAllCollections(prev => prev.map(c => c.id === id ? col : c));
      console.error('[Collections] Failed to reset collection thumbnail', e);
      addToast("Failed to reset thumbnail", "error");
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections, queryClient, addToast]);

  return {
    createCollection,
    updateCollectionFilters,
    deleteCollection,
    renameCollection,
    setCollectionColor,
    toggleArchiveCollection,
    togglePinCollection,
    addImagesToCollection,
    removeImagesFromCollection,
    moveImagesBetweenCollections,
    saveSmartCollection,
    deleteSmartCollection: deleteCollection,
    setCollectionThumbnail,
    resetCollectionThumbnail
  };
};
