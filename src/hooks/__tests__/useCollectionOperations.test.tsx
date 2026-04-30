
import { renderHook, act } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCollectionOperations } from '../useCollectionOperations';
import { AIImage, Collection } from '../../types';

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
    setCollectionCustomThumbnail: vi.fn(),
}));

describe('useCollectionOperations', () => {
    const mockSetAllCollections = vi.fn();
    const mockRefreshCollections = vi.fn();
    const mockSetFilters = vi.fn();
    const mockSetImages = vi.fn();

    const mockCollections: Collection[] = [
        { id: 'col1', name: 'Collection 1', createdAt: 100, source: 'ambit', count: 5, imageIds: ['img1'] },
    ];

    const makeImage = (overrides: Partial<AIImage> = {}): AIImage => ({
        id: 'img2',
        url: 'asset://C:/images/img2.png',
        thumbnailUrl: 'asset://C:/thumbs/img2.webp',
        filename: 'img2.png',
        timestamp: 1,
        width: 512,
        height: 512,
        isFavorite: false,
        metadata: {
            tool: 'Unknown' as AIImage['metadata']['tool'],
            model: '',
            seed: 0,
            steps: 0,
            cfg: 0,
            sampler: '',
            positivePrompt: '',
            negativePrompt: ''
        },
        ...overrides
    });

    const props = {
        collections: mockCollections,
        smartCollections: [],
        setAllCollections: mockSetAllCollections,
        refreshCollections: mockRefreshCollections,
        setFilters: mockSetFilters,
        setImages: mockSetImages,
        activeCollectionId: null,
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        const collectionRepo = await import('../../services/db/collectionRepo');
        (collectionRepo.upsertCollection as any).mockResolvedValue(undefined);
        (collectionRepo.deleteCollectionFromDb as any).mockResolvedValue(undefined);
        (collectionRepo.addImagesToCollection as any).mockResolvedValue(undefined);
        (collectionRepo.removeImagesFromCollection as any).mockResolvedValue(undefined);
        (collectionRepo.setCollectionCustomThumbnail as any).mockResolvedValue(undefined);
        mockRefreshCollections.mockResolvedValue(undefined);
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
                    { id: 'col2', name: 'Target', createdAt: 200, source: 'ambit' as const, count: 0, imageIds: [] as string[] }
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

    describe('collection thumbnails', () => {
        it('sets a custom thumbnail through the narrow thumbnail update path', async () => {
            const { setCollectionCustomThumbnail } = await import('../../services/db/collectionRepo');
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.setCollectionThumbnail('col1', makeImage());
            });

            const updater = mockSetAllCollections.mock.calls[0][0];
            const nextState = updater(mockCollections);
            expect(nextState[0].customThumbnail).toBe('img2');
            expect(nextState[0].thumbnail).toBe('asset://C:/thumbs/img2.webp');
            expect(nextState[0].safeThumbnail).toBeUndefined();
            expect(nextState[0].thumbnailSourceKind).toBe('customImage');
            expect(setCollectionCustomThumbnail).toHaveBeenCalledWith('col1', 'img2');
            expect(mockRefreshCollections).toHaveBeenCalledWith(true);
            expect(mockAddToast).toHaveBeenCalledWith('Thumbnail updated', 'success');
        });

        it('does not wait for collection refresh before completing thumbnail update', async () => {
            const { result } = renderHook(() => useCollectionOperations(props));
            mockRefreshCollections.mockImplementation(() => new Promise(() => { }));

            await act(async () => {
                await result.current.setCollectionThumbnail('col1', makeImage());
            });

            expect(mockAddToast).toHaveBeenCalledWith('Thumbnail updated', 'success');
            expect(mockRefreshCollections).toHaveBeenCalledWith(true);
        });

        it('resets a custom thumbnail through the narrow thumbnail update path', async () => {
            const { setCollectionCustomThumbnail } = await import('../../services/db/collectionRepo');
            const collectionsWithThumbnail = [{ ...mockCollections[0], customThumbnail: 'img2' }];
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: collectionsWithThumbnail
            }));

            await act(async () => {
                await result.current.resetCollectionThumbnail('col1');
            });

            const updater = mockSetAllCollections.mock.calls[0][0];
            const nextState = updater(collectionsWithThumbnail);
            expect(nextState[0].customThumbnail).toBeUndefined();
            expect(nextState[0].thumbnail).toBeUndefined();
            expect(nextState[0].thumbnailSourceKind).toBe('dynamic');
            expect(setCollectionCustomThumbnail).toHaveBeenCalledWith('col1', null);
            expect(mockRefreshCollections).toHaveBeenCalledWith(true);
            expect(mockAddToast).toHaveBeenCalledWith('Thumbnail reset', 'info');
        });
    });
});
