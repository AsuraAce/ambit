
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

const mockInsertImage = vi.fn();
const mockMarkAsDeleted = vi.fn();
const mockDeleteImage = vi.fn();
const mockGetDeletedImages = vi.fn();

vi.mock('../../services/db/imageRepo', () => ({
    insertImage: (...args: any[]) => mockInsertImage(...args),
    markAsDeleted: (...args: any[]) => mockMarkAsDeleted(...args),
    deleteImage: (...args: any[]) => mockDeleteImage(...args),
}));

vi.mock('../../services/db/maintenanceRepo', () => ({
    getDeletedImages: (...args: any[]) => mockGetDeletedImages(...args),
}));

describe('useAppHandlers', () => {
    const mockSetImages = vi.fn();
    const mockRefreshMaintenanceCounts = vi.fn();

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
    });

    it('should update positive prompt and call DB', async () => {
        const { result } = renderHook(() => useAppHandlers(props));

        await act(async () => {
            await result.current.handleUpdatePrompt('img1', 'A cool cat');
        });

        expect(mockSetImages).toHaveBeenCalled();
        expect(mockInsertImage).toHaveBeenCalledWith(expect.objectContaining({
            id: 'img1',
            metadata: expect.objectContaining({ positivePrompt: 'A cool cat' })
        }));
        expect(mockAddToast).toHaveBeenCalledWith('Updated', 'success');
    });

    it('should handle grouping images into a stack', () => {
        const { result } = renderHook(() => useAppHandlers(props));

        act(() => {
            result.current.handleGroupImages(['img1']);
        });

        expect(mockSetImages).toHaveBeenCalled();
        const updater = mockSetImages.mock.calls[0][0];
        const nextState = updater(mockImages);
        expect(nextState[0].groupId).toBeDefined();
        expect(nextState[0].groupId).toContain('stack_');
    });

    it('should handle move to trash', async () => {
        const { result } = renderHook(() => useAppHandlers(props));

        await act(async () => {
            await result.current.handleMoveToTrash(['img1']);
        });

        expect(mockMarkAsDeleted).toHaveBeenCalledWith(['img1'], true);
        expect(mockSetImages).toHaveBeenCalled();
        expect(mockRefreshMaintenanceCounts).toHaveBeenCalled();
    });

    it('should handle delete forever', async () => {
        const { result } = renderHook(() => useAppHandlers(props));

        await act(async () => {
            await result.current.handleDeleteForever(['img1']);
        });

        expect(mockDeleteImage).toHaveBeenCalledWith('img1');
        expect(mockSetImages).toHaveBeenCalled();
        const updater = mockSetImages.mock.calls[0][0];
        const nextState = updater(mockImages);
        expect(nextState).toHaveLength(0);
    });
});
