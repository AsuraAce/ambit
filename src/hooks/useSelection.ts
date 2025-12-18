
import * as React from 'react';
import { useState, useCallback } from 'react';
import { AIImage } from '../types';

export const useSelection = (filteredImages: AIImage[]) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const handleImageClick = useCallback((e: React.MouseEvent, id: string, index: number, setSelectedViewerIndex: (i: number) => void) => {
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastSelectedId(id);
    } else if (e.shiftKey && lastSelectedId) {
      e.stopPropagation();
      const startIdx = filteredImages.findIndex(img => img.id === lastSelectedId);
      const endIdx = index;
      if (startIdx !== -1) {
        const low = Math.min(startIdx, endIdx);
        const high = Math.max(startIdx, endIdx);
        const rangeIds = filteredImages.slice(low, high + 1).map(img => img.id);
        setSelectedIds(prev => {
          const next = new Set(prev);
          rangeIds.forEach(rid => next.add(rid));
          return next;
        });
      }
    } else {
      // If clicking normally, we either clear selection or open viewer
      if (selectedIds.size > 0) {
         setSelectedIds(new Set());
         setLastSelectedId(null);
      } else {
         setSelectedViewerIndex(index);
      }
    }
  }, [filteredImages, lastSelectedId, selectedIds]);

  const handleSelectionToggle = useCallback((e: React.MouseEvent | undefined, id: string) => {
    e?.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastSelectedId(id);
  }, []);
  
  const handleRangeSelection = useCallback((selectedIndexes: number[], isAdditive: boolean) => {
      const idsToSelect = selectedIndexes.map(idx => filteredImages[idx]?.id).filter(Boolean) as string[];
      setSelectedIds(prev => {
          const next = isAdditive ? new Set(prev) : new Set<string>();
          idsToSelect.forEach(id => next.add(id));
          return next;
      });
      if (idsToSelect.length > 0) setLastSelectedId(idsToSelect[idsToSelect.length - 1]);
  }, [filteredImages]);

  const clearSelection = useCallback(() => {
      setSelectedIds(new Set());
      setLastSelectedId(null);
  }, []);

  return {
    selectedIds,
    setSelectedIds,
    lastSelectedId,
    setLastSelectedId,
    handleImageClick,
    handleSelectionToggle,
    handleRangeSelection,
    clearSelection
  };
};
