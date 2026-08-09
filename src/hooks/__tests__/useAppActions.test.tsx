
import { renderHook, act, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppActions } from '../useAppActions';
import type { ImagesQueryKey } from '../useImagesQuery';
import type { AIImage } from '../../types';

const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

const mockSetImages = vi.fn();
const mockToggleImageFavorite = vi.fn();
const mockToggleImagePin = vi.fn();
const mockToggleImageMask = vi.fn();
const mockRebuildThumbnailFacetCache = vi.fn();
const mockBackfillParameterColumns = vi.fn();
const mockIncrementFacetCacheVersion = vi.fn();
const mockRefreshCollections = vi.fn();
const mockRefreshSmartCounts = vi.fn();
const mockSetPrivacyEnabled = vi.fn();
const mockUpdateImagesQueryCaches = vi.fn();
let mockStoreImages: Array<{
    id: string;
    isFavorite?: boolean;
    isPinned?: boolean;
    filename: string;
    timestamp: number;
    mediaType?: 'image' | 'video';
}> = [
    { id: '1', isFavorite: false, isPinned: false, filename: '1.png', timestamp: 100 },
    { id: '2', isFavorite: true, isPinned: true, filename: '2.png', timestamp: 200 },
];
let mockStoreFilters = { collectionId: 'col1' as string | null };
let mockSettings = { confirmDelete: true, enableAI: false, maskingMode: 'blur' };
let mockPrivacyEnabled = false;
let mockGeminiApiKey: string | null = null;

vi.mock('../../services/db/imageRepo', () => ({
    toggleImageFavorite: (id: string, isFavorite: boolean) => mockToggleImageFavorite(id, isFavorite),
    toggleImagePin: (id: string, isPinned: boolean) => mockToggleImagePin(id, isPinned),
    toggleImageMask: (id: string, value: boolean | null) => mockToggleImageMask(id, value),
    rebuildThumbnailFacetCache: () => mockRebuildThumbnailFacetCache(),
    markAsDeleted: vi.fn(),
    deleteImage: vi.fn(),
}));

vi.mock('../../services/db/maintenanceRepo', () => ({
    backfillParameterColumns: () => mockBackfillParameterColumns(),
}));

vi.mock('../../utils/imageQueryCache', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/imageQueryCache')>();
    return {
        ...actual,
        updateImagesQueryCaches: (...args: unknown[]) => mockUpdateImagesQueryCaches(...args),
    };
});

vi.mock('../../stores/searchStore', () => ({
    useSearchStore: (selector: any) => selector({
        images: mockStoreImages,
        setImages: mockSetImages,
        filters: mockStoreFilters,
    }),
}));

vi.mock('../../stores/settingsStore', () => {
    const useSettingsStore = (selector: (state: unknown) => unknown) => selector({
        settings: mockSettings,
        privacyEnabled: mockPrivacyEnabled,
        setPrivacyEnabled: mockSetPrivacyEnabled,
    });
    useSettingsStore.getState = () => ({ settings: mockSettings, geminiApiKey: mockGeminiApiKey });
    return { useSettingsStore };
});

vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: {
        getState: () => ({ incrementFacetCacheVersion: mockIncrementFacetCacheVersion }),
    },
}));

vi.mock('../../stores/collectionStore', () => ({
    useCollectionStore: (selector: any) => selector({
        refreshCollections: mockRefreshCollections,
        refreshSmartCounts: mockRefreshSmartCounts,
    }),
}));

describe('useAppActions', () => {
    const mockSetSelectedImageIndex = vi.fn();
    const mockSetViewerSessionImages = vi.fn();
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
        get viewerImages() { return mockStoreImages as unknown as AIImage[]; },
        setViewerSessionImages: mockSetViewerSessionImages,
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
        mockSettings = { confirmDelete: true, enableAI: false, maskingMode: 'blur' };
        mockPrivacyEnabled = false;
        mockGeminiApiKey = null;
        mockToggleImageFavorite.mockResolvedValue(undefined);
        mockToggleImagePin.mockResolvedValue(undefined);
        mockToggleImageMask.mockResolvedValue(undefined);
        mockRebuildThumbnailFacetCache.mockResolvedValue(undefined);
        mockBackfillParameterColumns.mockResolvedValue(0);
        mockRefreshCollections.mockResolvedValue(undefined);
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
        const update = mockSetImages.mock.calls[0][0] as (images: typeof mockStoreImages) => typeof mockStoreImages;
        expect(update(mockStoreImages).map(image => image.isFavorite)).toEqual([true, true]);
        expect(mockRefreshCollections).toHaveBeenCalledWith(true);
        expect(mockRefreshSmartCounts).toHaveBeenCalledWith({
            collectionIds: ['col1'],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true
        });
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Favorited'), 'success');
    });

    it('should toggle a viewer favorite without a success toast', () => {
        const { result } = renderHook(() => useAppActions(props));

        act(() => {
            result.current.handleFavoriteImage('1');
        });

        expect(mockToggleImageFavorite).toHaveBeenCalledWith('1', true);
        expect(mockSetImages).toHaveBeenCalled();
        const update = mockSetImages.mock.calls[0][0] as (images: typeof mockStoreImages) => typeof mockStoreImages;
        expect(update(mockStoreImages).map(image => image.isFavorite)).toEqual([true, true]);
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
        expect(mockRefreshSmartCounts).toHaveBeenCalledWith({
            collectionIds: ['col1'],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true
        });
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

    it('shows single-image unpin feedback', async () => {
        const { result } = renderHook(() => useAppActions(props));
        await act(async () => result.current.handlePinImage('2', false));
        expect(mockAddToast).toHaveBeenCalledWith('Unpinned', 'info');
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

    it('deletes immediately when confirmation is disabled and advances viewer indices', () => {
        mockSettings = { ...mockSettings, confirmDelete: false };
        const { result } = renderHook(() => useAppActions({ ...props, selectedImageIndex: 1 }));
        act(() => result.current.requestDeleteForId('2'));
        expect(mockFileOps.deleteImages).toHaveBeenCalledWith(['2']);
        expect(mockSetViewerSessionImages).toHaveBeenCalledWith([mockStoreImages[0]]);
        expect(mockSetSelectedImageIndex).toHaveBeenCalledWith(0);
        expect(mockModalManager.openModal).not.toHaveBeenCalled();
    });

    it('closes a single-image viewer and preserves a middle delete index', () => {
        mockSettings = { ...mockSettings, confirmDelete: false };
        mockStoreImages = [{ id: 'only', isFavorite: false, isPinned: false, filename: 'only.png', timestamp: 1 }];
        const single = renderHook(() => useAppActions(props));
        act(() => single.result.current.requestDeleteForId('only'));
        expect(mockSetSelectedImageIndex).toHaveBeenCalledWith(null);
        single.unmount();

        mockSetSelectedImageIndex.mockClear();
        mockStoreImages = [
            { id: 'a', isFavorite: false, isPinned: false, filename: 'a.png', timestamp: 1 },
            { id: 'b', isFavorite: false, isPinned: false, filename: 'b.png', timestamp: 2 },
            { id: 'c', isFavorite: false, isPinned: false, filename: 'c.png', timestamp: 3 },
        ];
        const middle = renderHook(() => useAppActions(props));
        act(() => middle.result.current.requestDeleteForId('b'));
        expect(mockSetSelectedImageIndex).toHaveBeenCalledWith(1);
    });

    it('executes a pending viewer delete and ignores unknown viewer ids', () => {
        const pendingProps = {
            ...props,
            modalManager: { ...mockModalManager, pendingViewerDeleteId: '2' },
        };
        const pending = renderHook(() => useAppActions(pendingProps));
        act(() => pending.result.current.executeDelete());
        expect(mockFileOps.deleteImages).toHaveBeenCalledWith(['2']);
        expect(mockSetSelectedImageIndex).toHaveBeenCalledWith(0);
        pending.unmount();

        mockSetSelectedImageIndex.mockClear();
        mockSettings = { ...mockSettings, confirmDelete: false };
        const unknown = renderHook(() => useAppActions(props));
        act(() => unknown.result.current.requestDeleteForId('missing'));
        expect(mockSetSelectedImageIndex).not.toHaveBeenCalled();
    });

    it('exports selected or explicit ids and clears only implicit selection', async () => {
        mockFileOps.exportImages.mockImplementation(async (_name, _ids, _folder, onComplete) => onComplete?.());
        const { result } = renderHook(() => useAppActions(props));
        await act(async () => result.current.handleExportConfirm('selected.zip', 'C:/out'));
        expect(mockFileOps.exportImages).toHaveBeenCalledWith('selected.zip', props.selectedIds, 'C:/out', expect.any(Function));
        expect(mockSetSelectedIds).toHaveBeenCalledWith(new Set());
        expect(mockModalManager.closeModal).toHaveBeenCalledWith('export');

        mockSetSelectedIds.mockClear();
        const explicit = new Set(['2']);
        await act(async () => result.current.handleExportConfirm('one.zip', 'C:/out', explicit));
        expect(mockSetSelectedIds).not.toHaveBeenCalled();
    });

    it('passes video selections to the shared ZIP exporter', async () => {
        mockStoreImages = [{ id: 'video', mediaType: 'video', filename: 'clip.mp4', timestamp: 100 }];
        const videoProps = { ...props, selectedIds: new Set(['video']) };
        const { result } = renderHook(() => useAppActions(videoProps));

        await act(async () => result.current.handleExportConfirm('videos.zip', 'C:/out'));

        expect(mockFileOps.exportImages).toHaveBeenCalledWith(
            'videos.zip',
            videoProps.selectedIds,
            'C:/out',
            expect.any(Function)
        );
    });

    it('bulk-unfavorites selected favorites and rolls back favorite failures', async () => {
        const allFavoriteProps = { ...props, selectedIds: new Set(['2']) };
        const first = renderHook(() => useAppActions(allFavoriteProps));
        act(() => first.result.current.handleBulkFavorite());
        expect(mockToggleImageFavorite).toHaveBeenCalledWith('2', false);
        expect(mockAddToast).toHaveBeenCalledWith('Unfavorited 1 item', 'success');
        first.unmount();

        mockToggleImageFavorite.mockRejectedValueOnce(new Error('favorite failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const second = renderHook(() => useAppActions(props));
        act(() => second.result.current.handleFavoriteImage('1'));
        await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Failed to update favorite state', 'error'));
        expect(mockSetImages).toHaveBeenCalledWith(mockStoreImages);
        errorSpy.mockRestore();
    });

    it('ignores missing favorites and supports explicit like and unlike feedback', () => {
        const { result } = renderHook(() => useAppActions(props));
        act(() => result.current.handleFavoriteImage('missing', { showToast: true }));
        expect(mockToggleImageFavorite).not.toHaveBeenCalled();
        act(() => result.current.handleFavoriteImage('1', { showToast: true }));
        expect(mockAddToast).toHaveBeenCalledWith('Liked', 'success');
        act(() => result.current.handleFavoriteImage('2', { showToast: true }));
        expect(mockAddToast).toHaveBeenCalledWith('Unliked', 'info');
    });

    it('bulk-unpins selected pinned images and rolls back bulk pin failures', async () => {
        const selectedPinned = { ...props, selectedIds: new Set(['2']) };
        const first = renderHook(() => useAppActions(selectedPinned));
        act(() => first.result.current.handleBulkPin());
        expect(mockToggleImagePin).toHaveBeenCalledWith('2', false);
        expect(mockAddToast).toHaveBeenCalledWith('Unpinned 1 item', 'info');
        first.unmount();

        mockToggleImagePin.mockRejectedValueOnce(new Error('bulk pin failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const second = renderHook(() => useAppActions(props));
        act(() => second.result.current.handleBulkPin());
        await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Failed to update pinned images', 'error'));
        errorSpy.mockRestore();
    });

    it('masks explicit, selected, and last-selected targets with every override mode', async () => {
        const { result } = renderHook(() => useAppActions(props));
        await act(async () => result.current.handleBulkMask('1', true));
        const maskTrue = mockSetImages.mock.calls.at(-1)?.[0] as (images: typeof mockStoreImages) => Array<{ userMasked?: boolean }>;
        expect(maskTrue(mockStoreImages).map(image => image.userMasked)).toEqual([true, undefined]);
        expect(mockUpdateImagesQueryCaches).toHaveBeenCalledOnce();
        const updateCachedImage = mockUpdateImagesQueryCaches.mock.calls[0][1] as (image: AIImage) => AIImage;
        expect(updateCachedImage({ ...mockStoreImages[0], userMasked: false } as AIImage).userMasked).toBe(true);
        expect(mockToggleImageMask).toHaveBeenCalledWith('1', true);
        expect(mockAddToast).toHaveBeenCalledWith('1 item Manually Masked', 'info');

        await act(async () => result.current.handleBulkMask('1', false));
        expect(mockAddToast).toHaveBeenCalledWith('1 item Unmasked', 'info');
        await act(async () => result.current.handleBulkMask('1', null));
        const maskAuto = mockSetImages.mock.calls.at(-1)?.[0] as (images: typeof mockStoreImages) => Array<{ userMasked?: boolean }>;
        expect(maskAuto(mockStoreImages).map(image => image.userMasked)).toEqual([undefined, undefined]);
        expect(mockToggleImageMask).toHaveBeenCalledWith('1', null);
        expect(mockAddToast).toHaveBeenCalledWith('1 item Reset to Auto Mask', 'info');

        await act(async () => result.current.handleBulkMask());
        const maskToggle = mockSetImages.mock.calls.at(-1)?.[0] as (images: typeof mockStoreImages) => Array<{ userMasked?: boolean }>;
        expect(maskToggle(mockStoreImages).map(image => image.userMasked)).toEqual([true, undefined]);
        expect(mockToggleImageMask).toHaveBeenCalledWith('1', true);
        expect(mockAddToast).toHaveBeenCalledWith('1 item Mask Toggled', 'info');
        expect(mockRebuildThumbnailFacetCache).toHaveBeenCalled();
        expect(mockIncrementFacetCacheVersion).toHaveBeenCalled();
        expect(mockRefreshCollections).toHaveBeenCalledWith(true);
    });

    it('uses the last selection for masking and no-ops without targets', async () => {
        const last = renderHook(() => useAppActions({ ...props, selectedIds: new Set(), lastSelectedId: '2' }));
        await act(async () => last.result.current.handleBulkMask());
        expect(mockToggleImageMask).toHaveBeenCalledWith('2', true);
        last.unmount();

        mockToggleImageMask.mockClear();
        const none = renderHook(() => useAppActions({ ...props, selectedIds: new Set(), lastSelectedId: null }));
        await act(async () => none.result.current.handleBulkMask());
        expect(mockToggleImageMask).not.toHaveBeenCalled();
    });

    it('skips persistence when a toggled mask target is no longer in the image store', async () => {
        const { result } = renderHook(() => useAppActions(props));
        await act(async () => result.current.handleBulkMask('missing'));
        expect(mockToggleImageMask).not.toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith('1 item Mask Toggled', 'info');
    });

    it('invalidates hidden privacy queries and pluralizes bulk mask feedback', async () => {
        mockPrivacyEnabled = true;
        mockSettings = { ...mockSettings, maskingMode: 'hide' };
        const multi = renderHook(() => useAppActions({ ...props, selectedIds: new Set(['1', '2']) }));
        await act(async () => multi.result.current.handleBulkMask(undefined, true));
        expect(mockAddToast).toHaveBeenCalledWith('2 items Manually Masked', 'info');
    });

    it('disables privacy mode when already enabled', () => {
        mockPrivacyEnabled = true;
        const { result } = renderHook(() => useAppActions(props));
        act(() => result.current.handleTogglePrivacy());
        expect(mockSetPrivacyEnabled).toHaveBeenCalledWith(false);
        expect(mockAddToast).toHaveBeenCalledWith('Privacy Mode Disabled (Hidden/Blurred items revealed)', 'info');
    });

    it('routes recovery launch to settings when AI configuration is missing', () => {
        const setInitialSettingsTab = vi.fn();
        const recoveryProps = { ...props, modalManager: { ...mockModalManager, setInitialSettingsTab } };
        const { result } = renderHook(() => useAppActions(recoveryProps));
        act(() => result.current.openMetadataRecovery('1'));
        expect(setInitialSettingsTab).toHaveBeenCalledWith('intelligence');
        expect(mockModalManager.openModal).toHaveBeenCalledWith('settings');
        expect(mockModalManager.openModal).not.toHaveBeenCalledWith('recovery');
    });

    it('routes recovery launch to settings without an initial-tab callback', () => {
        const { result } = renderHook(() => useAppActions(props));
        act(() => result.current.openMetadataRecovery('1'));
        expect(mockModalManager.openModal).toHaveBeenCalledWith('settings');
    });

    it('recovers the current Gallery viewer image before index or selection targets', async () => {
        mockSettings = { ...mockSettings, enableAI: true };
        mockGeminiApiKey = 'key';
        const recoveredImage = mockStoreImages[0] as AIImage;
        const recoverMetadata = vi.fn().mockResolvedValue(recoveredImage);
        const { result } = renderHook(() => useAppActions({
            ...props,
            viewingImageId: '1',
            selectedImageIndex: 1,
            selectedIds: new Set(['2']),
            fileOps: { ...mockFileOps, recoverMetadata },
        }));

        act(() => result.current.openMetadataRecovery());
        await act(async () => result.current.executeMetadataRecovery('midjourney'));

        expect(mockModalManager.openModal).toHaveBeenCalledWith('recovery');
        expect(recoverMetadata).toHaveBeenCalledWith('1', 'midjourney');
        expect(mockModalManager.closeModal).toHaveBeenCalledWith('recovery');
    });

    it('resolves indexed Gallery recovery from the frozen viewer session', async () => {
        mockSettings = { ...mockSettings, enableAI: true };
        mockGeminiApiKey = 'key';
        const frozenViewerImages = [mockStoreImages[1], mockStoreImages[0]] as AIImage[];
        const recoverMetadata = vi.fn().mockResolvedValue(frozenViewerImages[0]);
        const { result } = renderHook(() => useAppActions({
            ...props,
            selectedImageIndex: 0,
            viewerImages: frozenViewerImages,
            selectedIds: new Set(['1']),
            fileOps: { ...mockFileOps, recoverMetadata },
        }));

        act(() => result.current.openMetadataRecovery());
        await act(async () => result.current.executeMetadataRecovery('generic'));

        expect(recoverMetadata).toHaveBeenCalledWith('2', 'generic');
    });

    it('reports unavailable recovery and recovers targets by index then selection', async () => {
        mockSettings = { ...mockSettings, enableAI: true };
        mockGeminiApiKey = 'key';
        const unavailable = renderHook(() => useAppActions(props));
        act(() => unavailable.result.current.openMetadataRecovery('1'));
        await act(async () => unavailable.result.current.executeMetadataRecovery('sdxl'));
        expect(mockAddToast).toHaveBeenCalledWith('Prompt Recovery is unavailable in this runtime.', 'error');
        unavailable.unmount();

        const recoverMetadata = vi.fn(async (id: string) => mockStoreImages.find(image => image.id === id) as AIImage);
        const byIndex = renderHook(() => useAppActions({
            ...props,
            selectedImageIndex: 1,
            selectedIds: new Set(),
            fileOps: { ...mockFileOps, recoverMetadata },
        }));
        act(() => byIndex.result.current.openMetadataRecovery());
        await act(async () => byIndex.result.current.executeMetadataRecovery('generic'));
        expect(recoverMetadata).toHaveBeenCalledWith('2', 'generic');
        expect(mockModalManager.closeModal).toHaveBeenCalledWith('recovery');
        byIndex.unmount();

        recoverMetadata.mockClear();
        const bySelection = renderHook(() => useAppActions({
            ...props,
            selectedIds: new Set(['1']),
            fileOps: { ...mockFileOps, recoverMetadata },
        }));
        act(() => bySelection.result.current.openMetadataRecovery());
        await act(async () => bySelection.result.current.executeMetadataRecovery('sdxl'));
        expect(recoverMetadata).toHaveBeenCalledWith('1', 'sdxl');
    });

    it('recovers an explicit Maintenance target and publishes the updated image', async () => {
        mockSettings = { ...mockSettings, enableAI: true };
        mockGeminiApiKey = 'key';
        const recoveredImage = { ...mockStoreImages[0], id: 'maintenance-image' } as AIImage;
        const recoverMetadata = vi.fn().mockResolvedValue(recoveredImage);
        const onRecovered = vi.fn();
        const { result } = renderHook(() => useAppActions({
            ...props,
            viewingImageId: 'gallery-image',
            fileOps: { ...mockFileOps, recoverMetadata },
        }));

        act(() => result.current.openMetadataRecovery('maintenance-image', onRecovered));
        await act(async () => result.current.executeMetadataRecovery('generic'));

        expect(mockModalManager.openModal).toHaveBeenCalledWith('recovery');
        expect(recoverMetadata).toHaveBeenCalledWith('maintenance-image', 'generic');
        expect(onRecovered).toHaveBeenCalledWith(recoveredImage);
        expect(mockModalManager.closeModal).toHaveBeenCalledWith('recovery');
    });

    it('keeps recovery retryable when the operation fails', async () => {
        mockSettings = { ...mockSettings, enableAI: true };
        mockGeminiApiKey = 'key';
        const recoverMetadata = vi.fn().mockResolvedValue(null);
        const onRecovered = vi.fn();
        const { result } = renderHook(() => useAppActions({
            ...props,
            fileOps: { ...mockFileOps, recoverMetadata },
        }));

        act(() => result.current.openMetadataRecovery('maintenance-image', onRecovered));
        await act(async () => result.current.executeMetadataRecovery('generic'));

        expect(onRecovered).not.toHaveBeenCalled();
        expect(mockModalManager.closeModal).not.toHaveBeenCalledWith('recovery');
    });

    it('reports recovery launch without a target', () => {
        const { result } = renderHook(() => useAppActions({ ...props, selectedIds: new Set(), lastSelectedId: null }));
        act(() => result.current.openMetadataRecovery());
        expect(mockAddToast).toHaveBeenCalledWith('Select an image before starting Prompt Recovery.', 'error');
        expect(mockModalManager.openModal).not.toHaveBeenCalledWith('recovery');
    });

    it('routes favorite and pin shortcuts between viewer and bulk actions', async () => {
        const viewer = renderHook(() => useAppActions({ ...props, selectedImageIndex: 0 }));
        act(() => viewer.result.current.handleShortcutFavorite());
        await act(async () => viewer.result.current.handleShortcutPin());
        expect(mockToggleImageFavorite).toHaveBeenCalledWith('1', true);
        expect(mockToggleImagePin).toHaveBeenCalledWith('1', true);
        viewer.unmount();

        mockToggleImageFavorite.mockClear();
        const bulk = renderHook(() => useAppActions(props));
        act(() => bulk.result.current.handleShortcutFavorite());
        await act(async () => bulk.result.current.handleShortcutPin());
        expect(mockToggleImageFavorite).toHaveBeenCalledWith('1', true);
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Pinned'), 'info');
    });

    it('reports backfill updates and no-op completions', async () => {
        mockBackfillParameterColumns.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
        const { result } = renderHook(() => useAppActions(props));
        await act(async () => result.current.runBackfill());
        expect(mockAddToast).toHaveBeenCalledWith('Backfill complete: 3 images updated', 'success');
        await act(async () => result.current.runBackfill());
        expect(mockAddToast).toHaveBeenCalledWith('Backfill complete: No images needed updating', 'success');
    });
});
