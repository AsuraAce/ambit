
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCollectionOperations } from '../useCollectionOperations';
import { Collection } from '../../types';

// --- Mocks ---

const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

vi.mock('../../services/db/collectionRepo', () => ({
    upsertCollection: vi.fn(),
    deleteCollectionFromDb: vi.fn(),
    addImagesToCollection: vi.fn(),
    removeImagesFromCollection: vi.fn(),
}));

describe('useCollectionOperations', () => {
    const mockSetAllCollections = vi.fn();
    const mockRefreshCollections = vi.fn();
    const mockSetFilters = vi.fn();
    const mockSetImages = vi.fn();

    const mockCollections: Collection[] = [
        { id: 'col1', name: 'Collection 1', createdAt: 100, source: 'ambit', count: 5, imageIds: ['img1'] },
    ];

    const props = {
        collections: mockCollections,
        smartCollections: [],
        setAllCollections: mockSetAllCollections,
        refreshCollections: mockRefreshCollections,
        setFilters: mockSetFilters,
        setImages: mockSetImages,
        activeCollectionId: null,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createCollection', () => {
        it('should perform optimistic update and call service', async () => {
            const { upsertCollection } = await import('../../services/db/collectionRepo');
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.createCollection('New Folder');
            });

            // Verify optimistic update
            expect(mockSetAllCollections).toHaveBeenCalledWith(expect.any(Function));

            // Get the value passed to setAllCollections
            const updater = mockSetAllCollections.mock.calls[0][0];
            const nextState = updater(mockCollections);
            expect(nextState).toHaveLength(2);
            expect(nextState[1].name).toBe('New Folder');

            expect(upsertCollection).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('created'), 'success');
        });

        it('should rollback on failure', async () => {
            const { upsertCollection } = await import('../../services/db/collectionRepo');
            (upsertCollection as any).mockRejectedValue(new Error('DB Fail'));

            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.createCollection('Failing Folder');
            });

            // Verify rollback call
            expect(mockSetAllCollections).toHaveBeenCalledTimes(2); // Initial + Rollback
            expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });
    });

    describe('deleteCollection', () => {
        it('should remove image from state and call DB', async () => {
            const { deleteCollectionFromDb } = await import('../../services/db/collectionRepo');
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.deleteCollection('col1');
            });

            expect(deleteCollectionFromDb).toHaveBeenCalledWith('col1');
            expect(mockSetAllCollections).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith('Collection deleted', 'success');
        });
    });

    describe('addImagesToCollection', () => {
        it('should increment count optimistically', async () => {
            const { addImagesToCollection: addImgs } = await import('../../services/db/collectionRepo');
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.addImagesToCollection(['img2'], 'col1');
            });

            const updater = mockSetAllCollections.mock.calls[0][0];
            const nextState = updater(mockCollections);
            expect(nextState[0].count).toBe(6); // 5 + 1
            expect(addImgs).toHaveBeenCalledWith('col1', ['img2']);
        });
    });

    describe('moveImagesBetweenCollections', () => {
        it('should transfer counts between source and target', async () => {
            const multiProps = {
                ...props,
                collections: [
                    ...mockCollections,
                    { id: 'col2', name: 'Target', createdAt: 200, source: 'ambit', count: 0, imageIds: [] }
                ]
            };
            const { result } = renderHook(() => useCollectionOperations(multiProps));

            await act(async () => {
                await result.current.moveImagesBetweenCollections(['img1'], 'col1', 'col2');
            });

            const updater = mockSetAllCollections.mock.calls[0][0];
            const nextState = updater(multiProps.collections);

            const source = nextState.find((c: any) => c.id === 'col1');
            const target = nextState.find((c: any) => c.id === 'col2');

            expect(source.count).toBe(4);
            expect(target.count).toBe(1);
        });
    });
});
