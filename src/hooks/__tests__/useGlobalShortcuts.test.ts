
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGlobalShortcuts } from '../useGlobalShortcuts';

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
        openRename: vi.fn(),
        openCollection: vi.fn(),
        handleRemoveFromCollection: vi.fn(),
        closeAllModals: vi.fn(),
        toggleShortcuts: vi.fn(),
        toggleCommandPalette: vi.fn(),
        onCloseViewer: vi.fn(),
    };

    const defaultProps = {
        ...mockActions,
        viewMode: 'grid' as any,
        selectedIds: new Set<string>(),
        filteredImages: [],
        lastSelectedId: null,
        selectedImageIndex: null,
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

    it('should block actions when a modal is open', () => {
        renderHook(() => useGlobalShortcuts({ ...defaultProps, isModalOpen: true }));

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

        expect(mockActions.toggleFavorite).not.toHaveBeenCalled();
    });

    it('should trigger select all on "Ctrl+A"', () => {
        const images = [{ id: '1' }, { id: '2' }] as any;
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
});
