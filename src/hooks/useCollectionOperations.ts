import * as React from 'react';
import { useCallback } from 'react';
import { Collection, SmartCollection, FilterState } from '../types';
import { useToast } from './useToast';
import { upsertCollection, deleteCollectionFromDb, addImagesToCollection as addImgsToCol, removeImagesFromCollection as removeImgsFromCol } from '../services/db/collectionRepo';

interface UseCollectionOperationsProps {
  collections: Collection[];
  smartCollections: SmartCollection[];
  setAllCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  refreshCollections: () => Promise<void>;
  setFilters: React.Dispatch<React.SetStateAction<any>>;
  activeCollectionId: string | null;
}

export const useCollectionOperations = ({
  collections,
  smartCollections,
  setAllCollections,
  refreshCollections,
  setFilters,
  activeCollectionId
}: UseCollectionOperationsProps) => {
  const { addToast } = useToast();

  const createCollection = useCallback(async (name: string) => {
    const id = `c_${Date.now()}`;
    const newCol: Collection = {
      id,
      name,
      createdAt: Date.now(),
      source: 'ambit',
      imageIds: [],
      count: 0
    };

    // Optimistic Update
    setAllCollections(prev => [...prev, newCol]);

    try {
      await upsertCollection(newCol);
      addToast(`Collection "${name}" created`, 'success');
      // Background refresh to ensure everything is in sync (smart stats etc)
      refreshCollections();
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.filter(c => c.id !== id));
      addToast("Failed to create collection", "error");
    }
  }, [setAllCollections, refreshCollections, addToast]);

  const deleteCollection = useCallback(async (id: string) => {
    const original = [...collections, ...smartCollections].find(c => c.id === id);
    if (!original) return;

    // Optimistic Update
    setAllCollections(prev => prev.filter(c => c.id !== id));
    if (activeCollectionId === id) {
      setFilters((prev: any) => ({ ...prev, collectionId: null }));
    }

    try {
      await deleteCollectionFromDb(id);
      addToast("Collection deleted", "success");
      refreshCollections();
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
      refreshCollections();
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
      refreshCollections();
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
      setFilters((prev: any) => ({ ...prev, collectionId: null }));
    }

    try {
      await upsertCollection({ ...col, isArchived: newState });
      addToast(newState ? "Collection archived" : "Collection unarchived", "info");
      refreshCollections();
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
      refreshCollections();
    } catch (e) {
      // Rollback
      setAllCollections(prev => prev.map(c => c.id === id ? col : c));
    }
  }, [collections, smartCollections, setAllCollections, refreshCollections]);

  const addImagesToCollection = useCallback(async (imageIds: string[], collectionId: string) => {
    await addImgsToCol(collectionId, imageIds);
    // Refresh collections to update dynamic sidebar counts
    await refreshCollections();
    addToast(`Added images to collection`, 'success');
  }, [refreshCollections, addToast]);

  const removeImagesFromCollection = useCallback(async (imageIds: string[], collectionId: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === collectionId);

    if (!col) return;

    // Handle Manual Exclusions for Hybrid Smart Collections
    if (col.filters) {
      const currentExclusions = col.manualExclusions || [];
      const newExclusions = [...new Set([...currentExclusions, ...imageIds])];
      await upsertCollection({ ...col, manualExclusions: newExclusions });
    }

    // Always attempt removal from junction table (handles manual additions)
    await removeImgsFromCol(collectionId, imageIds);

    await refreshCollections();
    addToast("Removed from collection", "info");
  }, [collections, smartCollections, refreshCollections, addToast]);

  const saveSmartCollection = useCallback(async (name: string, filters: FilterState) => {
    // Check if we already have a collection with this name to update it instead of creating a new one
    const existing = [...collections, ...smartCollections].find(c => c.name.toLowerCase() === name.toLowerCase());

    const id = existing ? existing.id : `sc_${Date.now()}`;

    // Merge existing filters if updating, to preserve sortOption if it was set previously but not cleared
    // Actually, the passed 'filters' usually represents the current active state, so we should trust it.
    // However, if we want to ensure sortOption is passed, we depend on the caller.

    await upsertCollection({
      ...existing, // Preserve existing properties like color, pins, etc.
      id,
      name,
      filters,
      createdAt: existing?.createdAt || Date.now(),
      source: 'ambit'
    });
    await refreshCollections();
    addToast(existing ? `Smart collection "${name}" updated` : `Smart collection "${name}" saved`, 'success');
  }, [collections, smartCollections, refreshCollections, addToast]);

  const setCollectionThumbnail = useCallback(async (collectionId: string, imageId: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === collectionId);
    if (!col) return;
    await upsertCollection({ ...col, customThumbnail: imageId });
    await refreshCollections();
    addToast("Thumbnail updated", "success");
  }, [collections, smartCollections, refreshCollections, addToast]);

  const resetCollectionThumbnail = useCallback(async (id: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;
    await upsertCollection({ ...col, customThumbnail: undefined });
    await refreshCollections();
    addToast("Thumbnail reset", "info");
  }, [collections, smartCollections, refreshCollections, addToast]);

  return {
    createCollection,
    deleteCollection,
    renameCollection,
    setCollectionColor,
    toggleArchiveCollection,
    togglePinCollection,
    addImagesToCollection,
    removeImagesFromCollection,
    saveSmartCollection,
    deleteSmartCollection: deleteCollection,
    setCollectionThumbnail,
    resetCollectionThumbnail
  };
};