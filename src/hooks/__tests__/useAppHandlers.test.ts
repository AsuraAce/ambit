
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppHandlers } from '../useAppHandlers';
import { AIImage, GeneratorTool } from '../../types';

const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

const mockUpdateImageMetadataFields = vi.fn();
const mockRemoveImagesFromLibrary = vi.fn();
const mockRestoreRemovedImages = vi.fn();
const mockDeleteRemovedImagesFromDisk = vi.fn();
const mockGetImagesByIds = vi.fn();
const mockRebuildFacetCache = vi.fn().mockResolvedValue(0);
const mockRevertImageMetadata = vi.fn();
const mockUpdateImageNotesCol = vi.fn();
const mockRebuildFacetCacheIncremental = vi.fn();
const mockIncrementFacetCacheVersion = vi.fn();

vi.mock('../../services/db/imageRepo', () => ({
    updateImageMetadataFields: (...args: any[]) => mockUpdateImageMetadataFields(...args),
    removeImagesFromLibrary: (...args: any[]) => mockRemoveImagesFromLibrary(...args),
    restoreRemovedImages: (...args: any[]) => mockRestoreRemovedImages(...args),
    deleteRemovedImagesFromDisk: (...args: any[]) => mockDeleteRemovedImagesFromDisk(...args),
    getImagesByIds: (...args: any[]) => mockGetImagesByIds(...args),
    revertImageMetadata: (...args: any[]) => mockRevertImageMetadata(...args),
    updateImageNotesCol: (...args: any[]) => mockUpdateImageNotesCol(...args),
    rebuildFacetCache: (...args: any[]) => mockRebuildFacetCache(...args),
    rebuildFacetCacheIncremental: (...args: any[]) => mockRebuildFacetCacheIncremental(...args),
}));

vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: (selector: (state: { incrementFacetCacheVersion: typeof mockIncrementFacetCacheVersion }) => unknown) => selector({ incrementFacetCacheVersion: mockIncrementFacetCacheVersion }),
}));

describe('useAppHandlers', () => {
    const mockSetImages = vi.fn();
    const mockRefreshMaintenanceCounts = vi.fn();
    let queryClient: QueryClient;
    let dispatchedImages: AIImage[];

    const mockImages: AIImage[] = [
        {
            id: 'img1',
            timestamp: 100,
            url: 'url1',
            thumbnailUrl: 'thumb1',
            filename: 'img1.png',
            width: 512,
            height: 512,
            isFavorite: false,
            metadata: {
                positivePrompt: 'A cat',
                negativePrompt: 'low res',
                model: 'Model A',
                tool: GeneratorTool.AUTOMATIC1111,
                steps: 20
            } as any
        }
    ];

    const props = {
        images: mockImages,
        setImages: mockSetImages,
        refreshMaintenanceCounts: mockRefreshMaintenanceCounts,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        dispatchedImages = [...mockImages];
        mockSetImages.mockImplementation((update: AIImage[] | ((previous: AIImage[]) => AIImage[])) => {
            dispatchedImages = typeof update === 'function' ? update(dispatchedImages) : update;
        });
        queryClient = new QueryClient();
        mockGetImagesByIds.mockResolvedValue([mockImages[0]]);
        mockRevertImageMetadata.mockResolvedValue(undefined);
        mockUpdateImageMetadataFields.mockResolvedValue(undefined);
        mockUpdateImageNotesCol.mockResolvedValue(undefined);
        mockRebuildFacetCache.mockResolvedValue(0);
        mockRebuildFacetCacheIncremental.mockResolvedValue(0);
        mockDeleteRemovedImagesFromDisk.mockResolvedValue({
            deletedIds: ['img1'],
            failedIds: [],
            thumbnailWarningIds: []
        });
    });

    const renderHandlers = () => renderHook(() => useAppHandlers(props), {
        wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(
            QueryClientProvider,
            { client: queryClient },
            children,
        ),
    });

    it('should update positive prompt and call DB', async () => {
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleUpdatePrompt('img1', 'A cool cat');
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockUpdateImageMetadataFields).toHaveBeenCalledWith('img1', { positivePrompt: 'A cool cat' });
        expect(mockAddToast).toHaveBeenCalledWith('Updated', 'success');
    });

    it('should handle grouping images into a stack', () => {
        const { result } = renderHandlers();

        act(() => {
            result.current.handleGroupImages(['img1']);
        });

        expect(mockSetImages).toHaveBeenCalled();
        const updater = mockSetImages.mock.calls[0][0];
        const nextState = updater(mockImages);
        expect(nextState[0].groupId).toBeDefined();
        expect(nextState[0].groupId).toContain('stack_');
    });

    it('should handle remove from library', async () => {
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleRemoveFromLibrary(['img1']);
        });

        expect(mockRemoveImagesFromLibrary).toHaveBeenCalledWith(['img1']);
        expect(mockSetImages).toHaveBeenCalled();
        expect(mockRefreshMaintenanceCounts).toHaveBeenCalled();
    });

    it('should handle restore from removed list', async () => {
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleRestoreImages(['img1']);
        });

        expect(mockRestoreRemovedImages).toHaveBeenCalledWith(['img1']);
        expect(mockGetImagesByIds).toHaveBeenCalledWith(['img1']);
    });

    it('should handle delete file for removed items', async () => {
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleDeleteFile(['img1']);
        });

        expect(mockDeleteRemovedImagesFromDisk).toHaveBeenCalledWith(['img1']);
    });

    it('should show warning toast when removed delete partially fails', async () => {
        mockDeleteRemovedImagesFromDisk.mockResolvedValue({
            deletedIds: ['img1'],
            failedIds: ['img2'],
            thumbnailWarningIds: []
        });
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleDeleteFile(['img1', 'img2']);
        });

        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Deleted 1 file'), 'warning');
    });

    it('reloads the reverted image into local state and query caches', async () => {
        const recoveredImage: AIImage = {
            ...mockImages[0],
            metadata: {
                ...mockImages[0].metadata,
                positivePrompt: 'Recovered prompt',
            },
        };
        const revertedImage: AIImage = {
            ...mockImages[0],
            metadata: {
                ...mockImages[0].metadata,
                positivePrompt: 'A cat',
            },
            originalMetadata: mockImages[0].metadata,
        };
        mockGetImagesByIds.mockResolvedValue([revertedImage]);
        queryClient.setQueryData(['images', { scope: 'library' }], {
            pages: [{ images: [recoveredImage], totalCount: 1, globalCount: 1 }],
            pageParams: [undefined],
        });
        const { result } = renderHandlers();

        await act(async () => {
            await result.current.handleRevertMetadata('img1');
        });

        expect(mockRevertImageMetadata).toHaveBeenCalledWith('img1');
        expect(mockGetImagesByIds).toHaveBeenCalledWith(['img1']);

        const updater = mockSetImages.mock.calls[0][0] as (images: AIImage[]) => AIImage[];
        expect(updater([recoveredImage])[0].metadata.positivePrompt).toBe('A cat');

        const cached = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(['images', { scope: 'library' }]);
        expect(cached?.pages[0].images[0].metadata.positivePrompt).toBe('A cat');
        expect(mockAddToast).toHaveBeenCalledWith('Reverted to original', 'success');
    });

    it('updates negative prompts while preserving existing original metadata', async () => {
        const originalMetadata = { ...mockImages[0].metadata, positivePrompt: 'Original' };
        const image = { ...mockImages[0], originalMetadata };
        const { result } = renderHook(() => useAppHandlers({ ...props, images: [image] }), {
            wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: queryClient }, children),
        });
        await act(async () => result.current.handleUpdateNegativePrompt('img1', 'new negative'));
        expect(dispatchedImages[0].metadata.negativePrompt).toBe('new negative');
        expect(dispatchedImages[0].originalMetadata).toBe(originalMetadata);
        expect(mockUpdateImageMetadataFields).toHaveBeenCalledWith('img1', { negativePrompt: 'new negative' });
    });

    it('updates model and tool metadata and refreshes their facet caches', async () => {
        const { result } = renderHandlers();
        await act(async () => result.current.handleUpdateModel('img1', 'Model B'));
        await act(async () => Promise.resolve());
        expect(dispatchedImages[0].metadata.overrideModel).toBe('Model B');
        expect(mockRebuildFacetCacheIncremental).toHaveBeenCalledWith('checkpoints');

        await act(async () => result.current.handleUpdateTool('img1', GeneratorTool.COMFYUI));
        await act(async () => Promise.resolve());
        expect(dispatchedImages[0].metadata.tool).toBe(GeneratorTool.COMFYUI);
        expect(mockRebuildFacetCacheIncremental).toHaveBeenCalledWith('tools');
        expect(mockIncrementFacetCacheVersion).toHaveBeenCalled();
    });

    it('ignores metadata and note updates for missing images', async () => {
        const { result } = renderHandlers();
        await act(async () => {
            await result.current.handleUpdatePrompt('missing', 'x');
            await result.current.handleUpdateNegativePrompt('missing', 'x');
            await result.current.handleUpdateModel('missing', 'x');
            await result.current.handleUpdateTool('missing', GeneratorTool.COMFYUI);
            await result.current.handleUpdateNotes('missing', 'x');
        });
        expect(mockUpdateImageMetadataFields).not.toHaveBeenCalled();
        expect(mockUpdateImageNotesCol).not.toHaveBeenCalled();
    });

    it('updates notes and leaves unrelated images unchanged', async () => {
        dispatchedImages = [mockImages[0], { ...mockImages[0], id: 'img2' }];
        const { result } = renderHandlers();
        await act(async () => result.current.handleUpdateNotes('img1', 'note'));
        expect(dispatchedImages.map(image => image.notes)).toEqual(['note', undefined]);
        expect(mockUpdateImageNotesCol).toHaveBeenCalledWith('img1', 'note');
        expect(mockAddToast).toHaveBeenCalledWith('Saved', 'success');
    });

    it('groups only requested images and pluralizes duplicate removal', async () => {
        dispatchedImages = [mockImages[0], { ...mockImages[0], id: 'img2' }];
        const { result } = renderHandlers();
        act(() => result.current.handleGroupImages(['img1']));
        expect(dispatchedImages[0].groupId).toBeTruthy();
        expect(dispatchedImages[1].groupId).toBeUndefined();

        await act(async () => result.current.handleResolveDuplicate('img1', ['img2', 'img3']));
        expect(mockRemoveImagesFromLibrary).toHaveBeenCalledWith(['img2', 'img3']);
        expect(mockAddToast).toHaveBeenCalledWith('Removed 2 duplicates from the library', 'success');
        expect(mockRefreshMaintenanceCounts).toHaveBeenCalled();
    });

    it('uses singular duplicate and removal messages', async () => {
        const { result } = renderHandlers();
        await act(async () => result.current.handleResolveDuplicate('img1', ['img2']));
        expect(mockAddToast).toHaveBeenCalledWith('Removed 1 duplicate from the library', 'success');
        await act(async () => result.current.handleRemoveFromLibrary(['img1', 'img2']));
        expect(mockAddToast).toHaveBeenCalledWith('Removed 2 images from the library', 'success');
    });

    it('prepends only unique restored images and preserves state when all exist', async () => {
        const restored = { ...mockImages[0], id: 'img2' };
        mockGetImagesByIds.mockResolvedValueOnce([mockImages[0], restored]);
        const { result } = renderHandlers();
        await act(async () => result.current.handleRestoreImages(['img1', 'img2']));
        expect(dispatchedImages.map(image => image.id)).toEqual(['img2', 'img1']);
        expect(mockAddToast).toHaveBeenCalledWith('Restored 2 images to the library', 'success');

        mockGetImagesByIds.mockResolvedValueOnce([mockImages[0]]);
        const before = dispatchedImages;
        await act(async () => result.current.handleRestoreImages(['img1']));
        expect(dispatchedImages).toBe(before);
        expect(mockAddToast).toHaveBeenCalledWith('Restored 1 image to the library', 'success');
    });

    it('covers successful plural deletion, warning cleanup, and total failure', async () => {
        const { result } = renderHandlers();
        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({ deletedIds: ['a', 'b'], failedIds: [], thumbnailWarningIds: [] });
        await act(async () => result.current.handleDeleteFile(['a', 'b']));
        expect(mockAddToast).toHaveBeenCalledWith('Moved 2 files to OS trash and removed them from Ambit', 'success');

        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({ deletedIds: ['a'], failedIds: [], thumbnailWarningIds: ['a'] });
        await act(async () => result.current.handleDeleteFile(['a']));
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('thumbnail cleanup warnings'), 'warning');

        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({ deletedIds: [], failedIds: ['a'], thumbnailWarningIds: [] });
        await act(async () => result.current.handleDeleteFile(['a']));
        expect(mockAddToast).toHaveBeenCalledWith('Failed to move selected files to OS trash.', 'error');
    });

    it('explains the Removed-tab trash workflow', async () => {
        const { result } = renderHandlers();
        await act(async () => result.current.handleEmptyTrash());
        expect(mockAddToast).toHaveBeenCalledWith('Removed items are now handled through the Removed tab actions.', 'info');
        expect(mockRefreshMaintenanceCounts).toHaveBeenCalled();
    });

    it('warns when reverted metadata cannot be reloaded', async () => {
        mockGetImagesByIds.mockResolvedValueOnce([]);
        const { result } = renderHandlers();
        await act(async () => result.current.handleRevertMetadata('img1'));
        expect(mockAddToast).toHaveBeenCalledWith('Metadata reverted, but the image could not be refreshed.', 'warning');
        expect(mockSetImages).not.toHaveBeenCalled();
    });

    it('preserves stack data from current state when applying reverted metadata', async () => {
        const current: AIImage = { ...mockImages[0], stack: [{ ...mockImages[0], id: 'stack-child' }] };
        dispatchedImages = [current, { ...mockImages[0], id: 'other' }];
        mockGetImagesByIds.mockResolvedValueOnce([{ ...mockImages[0], originalMetadata: mockImages[0].metadata }]);
        const { result } = renderHandlers();
        await act(async () => result.current.handleRevertMetadata('img1'));
        expect(dispatchedImages[0].stack).toEqual(current.stack);
        expect(dispatchedImages[1].id).toBe('other');
    });

    it('preserves unrelated images through every metadata updater and snapshots negative metadata', async () => {
        const other = { ...mockImages[0], id: 'other' };
        dispatchedImages = [mockImages[0], other];
        const { result } = renderHandlers();
        await act(async () => result.current.handleUpdatePrompt('img1', 'prompt'));
        await act(async () => result.current.handleUpdateNegativePrompt('img1', 'negative'));
        await act(async () => result.current.handleUpdateModel('img1', 'model'));
        await act(async () => result.current.handleUpdateTool('img1', GeneratorTool.COMFYUI));
        expect(dispatchedImages[1]).toBe(other);
        expect(dispatchedImages[0].originalMetadata).toEqual(mockImages[0].metadata);
    });

    it('uses plural warning wording for partially deleted multiple files', async () => {
        mockDeleteRemovedImagesFromDisk.mockResolvedValueOnce({
            deletedIds: ['a', 'b'], failedIds: ['c'], thumbnailWarningIds: []
        });
        const { result } = renderHandlers();
        await act(async () => result.current.handleDeleteFile(['a', 'b', 'c']));
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Deleted 2 files from Ambit'), 'warning');
    });
});
