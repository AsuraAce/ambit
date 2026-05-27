
import { renderHook, act, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppActions } from '../useAppActions';
import type { ImagesQueryKey } from '../useImagesQuery';

const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

const mockSetImages = vi.fn();
const mockToggleImageFavorite = vi.fn();
const mockToggleImagePin = vi.fn();
const mockRefreshCollections = vi.fn();
let mockStoreImages = [
    { id: '1', isFavorite: false, isPinned: false, filename: '1.png', timestamp: 100 },
    { id: '2', isFavorite: true, isPinned: true, filename: '2.png', timestamp: 200 },
];
let mockStoreFilters = { collectionId: 'col1' as string | null };

vi.mock('../../services/db/imageRepo', () => ({
    toggleImageFavorite: (id: string, isFavorite: boolean) => mockToggleImageFavorite(id, isFavorite),
    toggleImagePin: (id: string, isPinned: boolean) => mockToggleImagePin(id, isPinned),
    toggleImageMask: vi.fn(),
    markAsDeleted: vi.fn(),
    deleteImage: vi.fn(),
}));

vi.mock('../../stores/searchStore', () => ({
    useSearchStore: (selector: any) => selector({
        images: mockStoreImages,
        setImages: mockSetImages,
        filters: mockStoreFilters,
    }),
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: (selector: any) => selector({
        settings: { confirmDelete: true },
        privacyEnabled: false,
        setPrivacyEnabled: vi.fn(),
    }),
}));

vi.mock('../../stores/collectionStore', () => ({
    useCollectionStore: (selector: any) => selector({
        refreshCollections: mockRefreshCollections,
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
    const mockImagesQueryKey = ['images', { collectionId: 'col1' }, 'date_desc', false, 'none', [], null] as unknown as ImagesQueryKey;

    const props = {
        viewingImageId: null,
        selectedImageIndex: null,
        setSelectedImageIndex: mockSetSelectedImageIndex,
        fileOps: mockFileOps,
        selectedIds: new Set(['1']),
        setSelectedIds: mockSetSelectedIds,
        lastSelectedId: '1',
        imagesQueryKey: mockImagesQueryKey,
        modalManager: mockModalManager,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockStoreImages = [
            { id: '1', isFavorite: false, isPinned: false, filename: '1.png', timestamp: 100 },
            { id: '2', isFavorite: true, isPinned: true, filename: '2.png', timestamp: 200 },
        ];
        mockStoreFilters = { collectionId: 'col1' };
    });

    it('should open delete confirmation modal if settings.confirmDelete is true', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.handleDeleteViewerImage('1');
        });

        expect(mockModalManager.setPendingViewerDeleteId).toHaveBeenCalledWith('1');
        expect(mockModalManager.openModal).toHaveBeenCalledWith('deleteConfirm');
    });

    it('should bind the requested delete target before opening confirmation', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.requestDeleteForId('2');
        });

        expect(mockModalManager.setPendingViewerDeleteId).toHaveBeenCalledWith('2');
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

    it('should ignore accidental confirm click arguments when deleting multiple selected images', () => {
        const multiSelectProps = {
            ...props,
            selectedIds: new Set(['1', '2']),
        };
        const fakeClickEvent = { type: 'click', currentTarget: {} };
        const { result } = renderHook(() => useAppActions(multiSelectProps));

        act(() => {
            (result.current.executeDelete as unknown as (event: unknown) => void)(fakeClickEvent);
        });

        expect(mockFileOps.deleteImages).toHaveBeenCalledWith(['1', '2']);
        expect(mockFileOps.deleteImages).not.toHaveBeenCalledWith(fakeClickEvent);
        expect(mockSetSelectedIds).toHaveBeenCalledWith(new Set());
    });

    it('should handle bulk favorite', async () => {
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            result.current.handleBulkFavorite();
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Favorited'), 'success');
    });

    it('should toggle a viewer favorite without a success toast', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.handleFavoriteImage('1');
        });

        expect(mockToggleImageFavorite).toHaveBeenCalledWith('1', true);
        expect(mockSetImages).toHaveBeenCalled();
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('should toggle a viewer unfavorite without a success toast', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.handleFavoriteImage('2');
        });

        expect(mockToggleImageFavorite).toHaveBeenCalledWith('2', false);
        expect(mockSetImages).toHaveBeenCalled();
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('should handle bulk pin and refresh thumbnails', async () => {
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            await result.current.handleBulkPin();
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockSetImages.mock.calls[0][0].map((img: { id: string }) => img.id)).toEqual(['2', '1']);
        expect(mockRefreshCollections).toHaveBeenCalledWith(true);
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Pinned'), 'info');
    });

    it('should keep single-image pin feedback outside the viewer path', async () => {
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            result.current.handlePinImage('1', true);
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockSetImages.mock.calls[0][0].map((img: { id: string }) => img.id)).toEqual(['2', '1']);
        expect(mockAddToast).toHaveBeenCalledWith('Pinned to top', 'info');
    });

    it('should preserve current order for single-image pins outside collections', async () => {
        mockStoreFilters = { collectionId: null };
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            result.current.handlePinImage('1', true);
        });

        expect(mockSetImages.mock.calls[0][0].map((img: { id: string }) => img.id)).toEqual(['1', '2']);
    });

    it('should restore the previous order when pin persistence fails', async () => {
        mockToggleImagePin.mockRejectedValueOnce(new Error('pin failed'));
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            result.current.handlePinImage('1', true);
        });

        expect(mockSetImages.mock.calls[0][0].map((img: { id: string }) => img.id)).toEqual(['2', '1']);
        await waitFor(() => {
            expect(mockSetImages.mock.calls[1][0].map((img: { id: string }) => img.id)).toEqual(['1', '2']);
            expect(mockAddToast).toHaveBeenCalledWith('Failed to update pinned state', 'error');
        });
    });

    it('should toggle a viewer pin without a success toast', async () => {
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            result.current.handlePinImage('1', true, { showToast: false });
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('should show the bulk pin toast without waiting for collection refresh', async () => {
        mockRefreshCollections.mockImplementation(() => new Promise(() => { }));
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            await result.current.handleBulkPin();
        });

        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Pinned'), 'info');
        expect(mockRefreshCollections).toHaveBeenCalledWith(true);
    });

    it('should toggle privacy mode and show toast', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.handleTogglePrivacy();
        });

        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Privacy Mode'), 'info');
    });
});
