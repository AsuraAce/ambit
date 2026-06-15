
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

vi.mock('../../services/db/imageRepo', () => ({
    updateImageMetadataFields: (...args: any[]) => mockUpdateImageMetadataFields(...args),
    removeImagesFromLibrary: (...args: any[]) => mockRemoveImagesFromLibrary(...args),
    restoreRemovedImages: (...args: any[]) => mockRestoreRemovedImages(...args),
    deleteRemovedImagesFromDisk: (...args: any[]) => mockDeleteRemovedImagesFromDisk(...args),
    getImagesByIds: (...args: any[]) => mockGetImagesByIds(...args),
    revertImageMetadata: (...args: any[]) => mockRevertImageMetadata(...args),
    rebuildFacetCache: (...args: any[]) => mockRebuildFacetCache(...args),
    rebuildFacetCacheIncremental: vi.fn().mockResolvedValue(0),
}));

describe('useAppHandlers', () => {
    const mockSetImages = vi.fn();
    const mockRefreshMaintenanceCounts = vi.fn();
    let queryClient: QueryClient;

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
        queryClient = new QueryClient();
        mockGetImagesByIds.mockResolvedValue([mockImages[0]]);
        mockRevertImageMetadata.mockResolvedValue(undefined);
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
});
