
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppActions } from '../useAppActions';
import { AppSettings, FilterState } from '../../types';

const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

const mockSetImages = vi.fn();
const mockToggleFavorite = vi.fn();
const mockRefreshCollectionThumbnails = vi.fn();

vi.mock('../../services/db/imageRepo', () => ({
    toggleImageFavorite: vi.fn(),
    toggleImagePin: vi.fn(),
    toggleImageMask: vi.fn(),
    markAsDeleted: vi.fn(),
    deleteImage: vi.fn(),
}));

vi.mock('../useLibraryContext', () => ({
    useLibraryContext: () => ({
        images: [
            { id: '1', isFavorite: false, isPinned: false, filename: '1.png', timestamp: 100 },
            { id: '2', isFavorite: true, isPinned: true, filename: '2.png', timestamp: 200 },
        ],
        setImages: mockSetImages,
        filters: { collectionId: 'col1' } as FilterState,
        setCollections: vi.fn(),
        refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
        toggleFavorite: mockToggleFavorite,
        privacyEnabled: false,
        setPrivacyEnabled: vi.fn(),
        settings: { confirmDelete: true } as AppSettings,
    }),
}));

describe('useAppActions', () => {
    const mockSetSelectedImageIndex = vi.fn();
    const mockSetSelectedIds = vi.fn();
    const mockFileOps = {
        deleteImages: vi.fn(),
        exportImages: vi.fn(),
    };
    const mockModalManager = {
        openModal: vi.fn(),
        closeModal: vi.fn(),
        pendingViewerDeleteId: null,
        setPendingViewerDeleteId: vi.fn(),
    };

    const props = {
        viewingImageId: null,
        selectedImageIndex: null,
        setSelectedImageIndex: mockSetSelectedImageIndex,
        fileOps: mockFileOps,
        selectedIds: new Set(['1']),
        setSelectedIds: mockSetSelectedIds,
        lastSelectedId: '1',
        modalManager: mockModalManager,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should open delete confirmation modal if settings.confirmDelete is true', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.handleDeleteViewerImage('1');
        });

        expect(mockModalManager.setPendingViewerDeleteId).toHaveBeenCalledWith('1');
        expect(mockModalManager.openModal).toHaveBeenCalledWith('deleteConfirm');
    });

    it('should execute delete and clear selection', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.executeDelete();
        });

        expect(mockFileOps.deleteImages).toHaveBeenCalledWith(['1']);
        expect(mockSetSelectedIds).toHaveBeenCalledWith(new Set());
        expect(mockModalManager.closeModal).toHaveBeenCalledWith('deleteConfirm');
    });

    it('should handle bulk favorite', async () => {
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            result.current.handleBulkFavorite();
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Favorited'), 'success');
    });

    it('should handle bulk pin and refresh thumbnails', async () => {
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            await result.current.handleBulkPin();
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockRefreshCollectionThumbnails).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Pinned'), 'info');
    });

    it('should toggle privacy mode and show toast', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.handleTogglePrivacy();
        });

        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Privacy Mode'), 'info');
    });
});
