
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGlobalShortcuts } from '../useGlobalShortcuts';
import type { AIImage, ViewMode } from '../../types';
import type { VirtualGridHandle } from '../../features/library/components/VirtualGrid';

describe('useGlobalShortcuts', () => {
    const mockActions = {
        setSelectedImageIndex: vi.fn(),
        setSelectedIds: vi.fn(),
        setLastSelectedId: vi.fn(),
        clearSelection: vi.fn(),
        handleDeleteViewerImage: vi.fn(),
        handleBulkDelete: vi.fn(),
        togglePrivacyMode: vi.fn(),
        toggleMasking: vi.fn(),
        toggleFavorite: vi.fn(),
        togglePin: vi.fn(),
        openCollection: vi.fn(),
        handleRemoveFromCollection: vi.fn(),
        closeAllModals: vi.fn(),
        toggleShortcuts: vi.fn(),
        toggleCommandPalette: vi.fn(),
        onCloseViewer: vi.fn(),
    };

    const defaultProps = {
        ...mockActions,
        viewMode: 'grid' as ViewMode,
        selectedIds: new Set<string>(),
        filteredImages: [],
        lastSelectedId: null,
        selectedImageIndex: null,
        isViewerOpen: false,
        gridRef: { current: null },
        searchInputRef: { current: null },
        isModalOpen: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should trigger toggleShortcuts on "?" key', () => {
        renderHook(() => useGlobalShortcuts(defaultProps));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));

        expect(mockActions.toggleShortcuts).toHaveBeenCalled();
    });

    it('should trigger favorite on "f" key', () => {
        renderHook(() => useGlobalShortcuts(defaultProps));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

        expect(mockActions.toggleFavorite).toHaveBeenCalled();
    });

    it('should let the viewer own favorite and pin shortcuts while open', () => {
        renderHook(() => useGlobalShortcuts({ ...defaultProps, isViewerOpen: true, selectedImageIndex: 0 }));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));

        expect(mockActions.toggleFavorite).not.toHaveBeenCalled();
        expect(mockActions.togglePin).not.toHaveBeenCalled();
    });

    it('should block actions when a modal is open', () => {
        renderHook(() => useGlobalShortcuts({ ...defaultProps, isModalOpen: true }));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

        expect(mockActions.toggleFavorite).not.toHaveBeenCalled();
    });

    it('should trigger select all on "Ctrl+A"', () => {
        const images = [{ id: '1' }, { id: '2' }] as unknown as AIImage[];
        renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images }));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));

        expect(mockActions.setSelectedIds).toHaveBeenCalledWith(new Set(['1', '2']));
    });

    it('should trigger bulk delete on "Delete" key when selection exists', () => {
        renderHook(() => useGlobalShortcuts({ ...defaultProps, selectedIds: new Set(['1']) }));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));

        expect(mockActions.handleBulkDelete).toHaveBeenCalled();
    });

    it('should NOT trigger shortcuts when focused on an input', () => {
        renderHook(() => useGlobalShortcuts(defaultProps));

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        const event = new KeyboardEvent('keydown', { key: 'f', bubbles: true });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);

        expect(mockActions.toggleFavorite).not.toHaveBeenCalled();
        document.body.removeChild(input);
    });

    it('blurs input and textarea targets only on Escape', () => {
        renderHook(() => useGlobalShortcuts(defaultProps));
        for (const target of [document.createElement('input'), document.createElement('textarea')]) {
            document.body.appendChild(target);
            target.focus();
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
            expect(document.activeElement).toBe(target);
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(document.activeElement).not.toBe(target);
            target.remove();
        }
    });

    it('handles command palette, privacy, masking, pin, and collection shortcuts', () => {
        renderHook(() => useGlobalShortcuts(defaultProps));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', shiftKey: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'H', shiftKey: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C' }));
        expect(mockActions.toggleCommandPalette).toHaveBeenCalledTimes(2);
        expect(mockActions.togglePrivacyMode).toHaveBeenCalledTimes(2);
        expect(mockActions.toggleMasking).toHaveBeenCalledTimes(1);
        expect(mockActions.togglePin).toHaveBeenCalledTimes(1);
        expect(mockActions.openCollection).toHaveBeenCalledTimes(1);
    });

    it('closes modals with Escape and blocks modal navigation and actions', () => {
        renderHook(() => useGlobalShortcuts({ ...defaultProps, isModalOpen: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(mockActions.closeAllModals).toHaveBeenCalled();
        for (const key of ['Delete', 'Backspace', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'f', 'Enter']) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key }));
        }
        expect(mockActions.handleBulkDelete).not.toHaveBeenCalled();
        expect(mockActions.setSelectedImageIndex).not.toHaveBeenCalled();
    });

    it('prioritizes Escape for viewer close, then selection clearing', () => {
        const viewer = renderHook(() => useGlobalShortcuts({ ...defaultProps, selectedImageIndex: 0, selectedIds: new Set(['1']) }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(mockActions.onCloseViewer).toHaveBeenCalled();
        expect(mockActions.clearSelection).not.toHaveBeenCalled();
        viewer.unmount();

        const selection = renderHook(() => useGlobalShortcuts({ ...defaultProps, selectedIds: new Set(['1']) }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(mockActions.clearSelection).toHaveBeenCalled();
        selection.unmount();

        mockActions.clearSelection.mockClear();
        renderHook(() => useGlobalShortcuts(defaultProps));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(mockActions.clearSelection).not.toHaveBeenCalled();
    });

    it('uses Space to close the viewer or open the last and selected image', () => {
        const images = [{ id: '1' }, { id: '2' }] as unknown as AIImage[];
        const viewer = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, selectedImageIndex: 0 }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(mockActions.onCloseViewer).toHaveBeenCalled();
        viewer.unmount();

        const last = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, lastSelectedId: '2' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(mockActions.setSelectedImageIndex).toHaveBeenCalledWith(1);
        last.unmount();

        mockActions.setSelectedImageIndex.mockClear();
        const selected = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, selectedIds: new Set(['1']) }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(mockActions.setSelectedImageIndex).toHaveBeenCalledWith(0);
        selected.unmount();

        mockActions.setSelectedImageIndex.mockClear();
        renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, lastSelectedId: 'missing' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(mockActions.setSelectedImageIndex).not.toHaveBeenCalled();
    });

    it('blocks select-all in maintenance and dashboard and supports Meta+A', () => {
        const images = [{ id: '1' }] as unknown as AIImage[];
        for (const viewMode of ['maintenance', 'dashboard'] as const) {
            const view = renderHook(() => useGlobalShortcuts({ ...defaultProps, viewMode, filteredImages: images }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
            expect(mockActions.setSelectedIds).not.toHaveBeenCalled();
            view.unmount();
        }
        renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true }));
        expect(mockActions.setSelectedIds).toHaveBeenCalledWith(new Set(['1']));
    });

    it('focuses search for Ctrl+F and safely handles a missing search input', () => {
        const focus = vi.fn();
        const first = renderHook(() => useGlobalShortcuts({ ...defaultProps, searchInputRef: { current: { focus } as unknown as HTMLInputElement } }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
        expect(focus).toHaveBeenCalled();
        first.unmount();
        renderHook(() => useGlobalShortcuts(defaultProps));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
    });

    it('routes Delete and Backspace to viewer or bulk targets', () => {
        const images = [{ id: '1' }] as unknown as AIImage[];
        const viewer = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, selectedImageIndex: 0 }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
        expect(mockActions.handleDeleteViewerImage).toHaveBeenCalledWith('1');
        viewer.unmount();

        mockActions.handleDeleteViewerImage.mockClear();
        const invalid = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, selectedImageIndex: 4 }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
        expect(mockActions.handleDeleteViewerImage).not.toHaveBeenCalled();
        invalid.unmount();

        renderHook(() => useGlobalShortcuts(defaultProps));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
        expect(mockActions.handleBulkDelete).not.toHaveBeenCalled();
    });

    it('selects the first grid image and navigates valid arrow results', () => {
        const images = [{ id: '1' }, { id: '2' }] as unknown as AIImage[];
        const grid = { navigate: vi.fn().mockReturnValue(1), scrollToItem: vi.fn() };
        const first = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, gridRef: { current: grid as VirtualGridHandle } }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(mockActions.setSelectedIds).toHaveBeenCalledWith(new Set(['1']));
        expect(grid.scrollToItem).toHaveBeenCalledWith(0);
        first.unmount();

        mockActions.setSelectedIds.mockClear();
        grid.scrollToItem.mockClear();
        renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, lastSelectedId: '1', gridRef: { current: grid as VirtualGridHandle } }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(grid.navigate).toHaveBeenCalledWith(0, 'ArrowRight');
        expect(mockActions.setSelectedIds).toHaveBeenCalledWith(new Set(['2']));
        expect(mockActions.setLastSelectedId).toHaveBeenCalledWith('2');
    });

    it('handles grid Enter and ignores invalid navigation outcomes', () => {
        const images = [{ id: '1' }, { id: '2' }] as unknown as AIImage[];
        const grid = { navigate: vi.fn(), scrollToItem: vi.fn() };
        const enter = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, selectedIds: new Set(['2']), gridRef: { current: grid as VirtualGridHandle } }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(mockActions.setSelectedImageIndex).toHaveBeenCalledWith(1);
        enter.unmount();

        for (const next of [undefined, -1, 0]) {
            grid.navigate.mockReturnValueOnce(next);
            const view = renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, lastSelectedId: '1', gridRef: { current: grid as VirtualGridHandle } }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
            view.unmount();
        }
        mockActions.setSelectedIds.mockClear();
        renderHook(() => useGlobalShortcuts({ ...defaultProps, filteredImages: images, gridRef: { current: grid as VirtualGridHandle } }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(mockActions.setSelectedIds).not.toHaveBeenCalled();
    });

    it('does not run grid navigation outside grid mode or without a grid handle', () => {
        const grid = { navigate: vi.fn(), scrollToItem: vi.fn() };
        const list = renderHook(() => useGlobalShortcuts({ ...defaultProps, viewMode: 'timeline', gridRef: { current: grid as VirtualGridHandle } }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(grid.navigate).not.toHaveBeenCalled();
        list.unmount();
        renderHook(() => useGlobalShortcuts(defaultProps));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });

    it('removes the global listener on unmount', () => {
        const hook = renderHook(() => useGlobalShortcuts(defaultProps));
        hook.unmount();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
        expect(mockActions.toggleShortcuts).not.toHaveBeenCalled();
    });
});
