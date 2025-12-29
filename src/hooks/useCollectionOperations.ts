import * as React from 'react';
import { useCallback } from 'react';
import { Collection, SmartCollection, FilterState } from '../types';
import { useToast } from './useToast';
import { upsertCollection, deleteCollectionFromDb, addImagesToCollection as addImgsToCol, removeImagesFromCollection as removeImgsFromCol } from '../services/db/collectionRepo';

interface UseCollectionOperationsProps {
  collections: Collection[];
  smartCollections: SmartCollection[];
  refreshCollections: () => Promise<void>;
  setFilters: React.Dispatch<React.SetStateAction<any>>;
  activeCollectionId: string | null;
}

export const useCollectionOperations = ({
  collections,
  smartCollections,
  refreshCollections,
  setFilters,
  activeCollectionId
}: UseCollectionOperationsProps) => {
  const { addToast } = useToast();

  const createCollection = useCallback(async (name: string) => {
    const id = `c_${Date.now()}`;
    await upsertCollection({
      id,
      name,
      createdAt: Date.now(),
      source: 'ambit'
    });
    await refreshCollections();
    addToast(`Collection "${name}" created`, 'success');
  }, [refreshCollections, addToast]);

  const deleteCollection = useCallback(async (id: string) => {
    await deleteCollectionFromDb(id);
    if (activeCollectionId === id) {
      setFilters((prev: any) => ({ ...prev, collectionId: null }));
    }
    await refreshCollections();
    addToast("Collection deleted", "success");
  }, [activeCollectionId, setFilters, refreshCollections, addToast]);

  const renameCollection = useCallback(async (id: string, newName: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;
    await upsertCollection({ ...col, name: newName });
    await refreshCollections();
    addToast("Collection renamed", "success");
  }, [collections, smartCollections, refreshCollections, addToast]);

  const setCollectionColor = useCallback(async (id: string, color: string | undefined) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;
    await upsertCollection({ ...col, color });
    await refreshCollections();
  }, [collections, smartCollections, refreshCollections]);

  const toggleArchiveCollection = useCallback(async (id: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;

    const newState = !col.isArchived;
    await upsertCollection({ ...col, isArchived: newState });

    if (activeCollectionId === id && newState) {
      setFilters((prev: any) => ({ ...prev, collectionId: null }));
    }

    await refreshCollections();
    addToast(newState ? "Collection archived" : "Collection unarchived", "info");
  }, [collections, smartCollections, activeCollectionId, setFilters, refreshCollections, addToast]);

  const togglePinCollection = useCallback(async (id: string) => {
    const col = [...collections, ...smartCollections].find(c => c.id === id);
    if (!col) return;
    await upsertCollection({ ...col, isPinned: !col.isPinned });
    await refreshCollections();
  }, [collections, smartCollections, refreshCollections]);

  const addImagesToCollection = useCallback(async (imageIds: string[], collectionId: string) => {
    await addImgsToCol(collectionId, imageIds);
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