
import { renderHook, act } from '../../test/testUtils';
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
const mockRefreshCollections = vi.fn();

vi.mock('../../services/db/imageRepo', () => ({
    toggleImageFavorite: vi.fn(),
    toggleImagePin: vi.fn(),
    toggleImageMask: vi.fn(),
    markAsDeleted: vi.fn(),
    deleteImage: vi.fn(),
}));

vi.mock('../../stores/searchStore', () => ({
    useSearchStore: (selector: any) => selector({
        images: [
            { id: '1', isFavorite: false, isPinned: false, filename: '1.png', timestamp: 100 },
            { id: '2', isFavorite: true, isPinned: true, filename: '2.png', timestamp: 200 },
        ],
        setImages: mockSetImages,
        filters: { collectionId: 'col1' },
        toggleFavorite: mockToggleFavorite,
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

    it('should handle bulk pin and refresh thumbnails', async () => {
        const { result } = renderHook(() => useAppActions(props));

        await act(async () => {
            await result.current.handleBulkPin();
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockRefreshCollections).toHaveBeenCalledWith(true);
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Pinned'), 'info');
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
