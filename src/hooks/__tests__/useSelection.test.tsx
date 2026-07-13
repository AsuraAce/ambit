
import type * as React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSelection } from '../useSelection';
import { AIImage } from '../../types';

describe('useSelection', () => {
    const mockImages = Array.from({ length: 10 }, (_, i) => ({
        id: `img-${i}`,
        timestamp: i,
        url: `url-${i}`,
        thumbnailUrl: `thumb-${i}`,
        filename: `file-${i}.png`,
        width: 100,
        height: 100,
        isFavorite: false,
        metadata: {} as any
    })) as AIImage[];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with empty selection', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        expect(result.current.selectedIds.size).toBe(0);
        expect(result.current.lastSelectedId).toBeNull();
    });

    it('should set lastSelectedId on single click without selecting', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        const mockSetViewer = vi.fn();
        const event = { ctrlKey: false, shiftKey: false, stopPropagation: vi.fn() } as any;

        act(() => {
            result.current.handleImageClick(event, 'img-1', 1, mockSetViewer);
        });

        expect(result.current.lastSelectedId).toBe('img-1');
        expect(result.current.selectedIds.has('img-1')).toBe(false);
        expect(mockSetViewer).toHaveBeenCalledWith(1);
    });

    it('should toggle selection on Ctrl-click', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        const event = { ctrlKey: true, shiftKey: false, stopPropagation: vi.fn() } as any;

        act(() => {
            result.current.handleImageClick(event, 'img-1', 1, vi.fn());
        });
        expect(result.current.selectedIds.has('img-1')).toBe(true);

        act(() => {
            result.current.handleImageClick(event, 'img-1', 1, vi.fn());
        });
        expect(result.current.selectedIds.has('img-1')).toBe(false);
    });

    it('should select range on Shift-click', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        const ctrlEvent = { ctrlKey: true, shiftKey: false, stopPropagation: vi.fn() } as any;
        const shiftEvent = { ctrlKey: false, shiftKey: true, stopPropagation: vi.fn() } as any;

        // 1. Select first item
        act(() => {
            result.current.handleImageClick(ctrlEvent, 'img-2', 2, vi.fn());
        });

        // 2. Shift-click to index 5
        act(() => {
            result.current.handleImageClick(shiftEvent, 'img-5', 5, vi.fn());
        });

        expect(result.current.selectedIds.has('img-2')).toBe(true);
        expect(result.current.selectedIds.has('img-3')).toBe(true);
        expect(result.current.selectedIds.has('img-4')).toBe(true);
        expect(result.current.selectedIds.has('img-5')).toBe(true);
        expect(result.current.selectedIds.size).toBe(4);
    });

    it('should support bulk range selection (handleRangeSelection)', () => {
        const { result } = renderHook(() => useSelection(mockImages));

        act(() => {
            result.current.handleRangeSelection([0, 1, 2], false);
        });
        expect(result.current.selectedIds.size).toBe(3);

        // Additive
        act(() => {
            result.current.handleRangeSelection([5], true);
        });
        expect(result.current.selectedIds.size).toBe(4);
        expect(result.current.selectedIds.has('img-5')).toBe(true);
    });

    it('supports Meta-click selection and Shift-click without an anchor opens the viewer', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        const stopPropagation = vi.fn();
        const setViewer = vi.fn();
        const metaEvent = { ctrlKey: false, metaKey: true, shiftKey: false, stopPropagation } as unknown as React.MouseEvent;
        act(() => result.current.handleImageClick(metaEvent, 'img-1', 1, setViewer));
        expect(result.current.selectedIds.has('img-1')).toBe(true);
        expect(stopPropagation).toHaveBeenCalledTimes(1);

        act(() => result.current.clearSelection());
        const shiftEvent = { ctrlKey: false, metaKey: false, shiftKey: true, stopPropagation } as unknown as React.MouseEvent;
        act(() => result.current.handleImageClick(shiftEvent, 'img-3', 3, setViewer));
        expect(setViewer).toHaveBeenCalledWith(3);
    });

    it('ignores a missing Shift anchor and selects reverse ranges', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        const shiftEvent = { ctrlKey: false, metaKey: false, shiftKey: true, stopPropagation: vi.fn() } as unknown as React.MouseEvent;
        act(() => result.current.setLastSelectedId('missing'));
        act(() => result.current.handleImageClick(shiftEvent, 'img-3', 3, vi.fn()));
        expect(result.current.selectedIds.size).toBe(0);

        act(() => result.current.setLastSelectedId('img-7'));
        act(() => result.current.handleImageClick(shiftEvent, 'img-4', 4, vi.fn()));
        expect([...result.current.selectedIds]).toEqual(['img-4', 'img-5', 'img-6', 'img-7']);
    });

    it('toggles selection with optional events and clears all selection state', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        const stopPropagation = vi.fn();
        act(() => result.current.handleSelectionToggle({ stopPropagation } as unknown as React.MouseEvent, 'img-2'));
        expect(stopPropagation).toHaveBeenCalledTimes(1);
        expect(result.current.selectedIds.has('img-2')).toBe(true);
        act(() => result.current.handleSelectionToggle(undefined, 'img-2'));
        expect(result.current.selectedIds.has('img-2')).toBe(false);
        expect(result.current.lastSelectedId).toBe('img-2');

        act(() => result.current.setSelectedIds(new Set(['img-1', 'img-3'])));
        act(() => result.current.clearSelection());
        expect(result.current.selectedIds.size).toBe(0);
        expect(result.current.lastSelectedId).toBeNull();
    });

    it('filters invalid range indexes and leaves the anchor unchanged for empty ranges', () => {
        const { result } = renderHook(() => useSelection(mockImages));
        act(() => result.current.setLastSelectedId('img-4'));
        act(() => result.current.handleRangeSelection([-1, 99], false));
        expect(result.current.selectedIds.size).toBe(0);
        expect(result.current.lastSelectedId).toBe('img-4');
    });
});
