import * as React from 'react';
import { useCallback } from 'react';
import { Collection, AIImage, SmartCollection, FilterState } from '../types';
import { useToast } from './useToast';
import { convertFileSrc } from '@tauri-apps/api/core';

interface UseCollectionOperationsProps {
  // ... existing props
  collections: Collection[];
  setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  smartCollections: SmartCollection[];
  setSmartCollections: React.Dispatch<React.SetStateAction<SmartCollection[]>>;
  images: AIImage[];
  refreshCollectionThumbnails: () => void;
  refreshCollections: () => Promise<void>;
  setFilters: React.Dispatch<React.SetStateAction<any>>;
  activeCollectionId: string | null;
}

export const useCollectionOperations = ({
  collections,
  setCollections,
  smartCollections,
  setSmartCollections,
  images,
  refreshCollectionThumbnails,
  refreshCollections,
  setFilters,
  activeCollectionId
}: UseCollectionOperationsProps) => {
  const { addToast } = useToast();

  // --- Regular Collections ---

  const createCollection = useCallback((name: string) => {
    const newCol: Collection = {
      id: `c_${Date.now()}`,
      name,
      imageIds: [],
      createdAt: Date.now()
    };
    setCollections(prev => [...prev, newCol]);
    addToast(`Collection "${name}" created`, 'success');
  }, [setCollections, addToast]);

  const deleteCollection = useCallback((id: string) => {
    setCollections(prev => prev.filter(c => c.id !== id));
    if (activeCollectionId === id) {
      setFilters((prev: any) => ({ ...prev, collectionId: null }));
    }
    addToast("Collection deleted", "success");
  }, [setCollections, activeCollectionId, setFilters, addToast]);

  const renameCollection = useCallback((id: string, newName: string) => {
    setCollections(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));
    addToast("Collection renamed", "success");
  }, [setCollections, addToast]);

  const setCollectionColor = useCallback((id: string, color: string | undefined) => {
    setCollections(prev => prev.map(c => c.id === id ? { ...c, color } : c));
  }, [setCollections]);

  const toggleArchiveCollection = useCallback((id: string) => {
    const col = collections.find(c => c.id === id);
    if (!col) return;

    const newState = !col.isArchived;
    setCollections(prev => prev.map(c => c.id === id ? { ...c, isArchived: newState } : c));

    // Auto-eject logic: If user archives the collection they are currently viewing, switch to All Photos
    if (activeCollectionId === id && newState) {
      setFilters((prev: any) => ({ ...prev, collectionId: null }));
    }

    addToast(newState ? "Collection archived" : "Collection unarchived", "info");
  }, [collections, setCollections, addToast, activeCollectionId, setFilters]);

  const togglePinCollection = useCallback((id: string) => {
    setCollections(prev => prev.map(c => {
      if (c.id === id) {
        const newState = !c.isPinned;
        return { ...c, isPinned: newState };
      }
      return c;
    }));
  }, [setCollections]);

  const addImagesToCollection = useCallback(async (imageIds: string[], collectionId: string) => {
    const isBoard = !collectionId.startsWith('c_');

    if (isBoard) {
      const { updateImagesBoard } = await import('../services/db/imageRepo');
      await updateImagesBoard(imageIds, collectionId);
      // Trigger a sync of counts
      setTimeout(() => refreshCollections(), 100);
    } else {
      setCollections(prev => prev.map(col => {
        if (col.id !== collectionId) return col;
        const newIds = [...col.imageIds];
        imageIds.forEach(id => {
          if (!newIds.includes(id)) {
            newIds.push(id);
          }
        });
        return { ...col, imageIds: newIds };
      }));
    }

    setTimeout(() => refreshCollectionThumbnails(), 0);
    addToast(`Added images to collection`, 'success');
  }, [setCollections, refreshCollections, refreshCollectionThumbnails, addToast]);

  const removeImagesFromCollection = useCallback(async (imageIds: string[], collectionId: string) => {
    const isBoard = !collectionId.startsWith('c_');

    if (isBoard) {
      const { updateImagesBoard } = await import('../services/db/imageRepo');
      await updateImagesBoard(imageIds, null);
      setTimeout(() => refreshCollections(), 100);
    } else {
      setCollections(prev => prev.map(col => {
        if (col.id !== collectionId) return col;
        return { ...col, imageIds: col.imageIds.filter(id => !imageIds.includes(id)) };
      }));
    }

    setTimeout(() => refreshCollectionThumbnails(), 0);
    addToast("Removed from collection", "info");
  }, [setCollections, refreshCollections, refreshCollectionThumbnails, addToast]);

  // --- Smart Collections ---

  const saveSmartCollection = useCallback((name: string, filters: FilterState) => {
    const newSmartCol: SmartCollection = {
      id: `sc_${Date.now()}`,
      name,
      filters
    };
    setSmartCollections(prev => [...prev, newSmartCol]);
    addToast(`Smart collection "${name}" saved`, 'success');
  }, [setSmartCollections, addToast]);

  const deleteSmartCollection = useCallback((id: string) => {
    setSmartCollections(prev => prev.filter(s => s.id !== id));
    addToast("Smart collection deleted", "info");
  }, [setSmartCollections, addToast]);

  const setCollectionThumbnail = useCallback((collectionId: string, imageId: string) => {
    const thumbUrl = convertFileSrc(imageId.replace(/\\/g, '/'));
    setCollections(prev => prev.map(c =>
      c.id === collectionId ? { ...c, customThumbnail: imageId, thumbnail: thumbUrl } : c
    ));
    addToast("Thumbnail updated", "success");
  }, [setCollections, addToast]);

  const resetCollectionThumbnail = useCallback((id: string) => {
    setCollections(prev => prev.map(c => c.id === id ? { ...c, customThumbnail: undefined } : c));
    setTimeout(() => refreshCollectionThumbnails(), 0);
    addToast("Thumbnail reset", "info");
  }, [setCollections, refreshCollectionThumbnails, addToast]);

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
    deleteSmartCollection,
    setCollectionThumbnail,
    resetCollectionThumbnail
  };
};