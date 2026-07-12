
import { renderHook, act } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCollectionOperations } from '../useCollectionOperations';
import { AIImage, Collection, FilterState, SmartCollection } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
import { QueryClient } from '@tanstack/react-query';

// --- Mocks ---

const mockAddToast = vi.fn();
const mockRefreshCollectionThumbnails = vi.fn();
const mockRefreshSmartCounts = vi.fn();
const collectionStoreState = {
    refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
    refreshSmartCounts: mockRefreshSmartCounts
};
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

vi.mock('../../stores/collectionStore', () => {
    const useCollectionStore = Object.assign((selector: (state: {
        refreshCollectionThumbnails: typeof mockRefreshCollectionThumbnails;
        refreshSmartCounts: typeof mockRefreshSmartCounts;
    }) => unknown) => selector(collectionStoreState), {
        getState: () => collectionStoreState
    });

    return { useCollectionStore };
});

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
    let dispatchedCollections: Collection[];
    let dispatchedFilters: FilterState;
    let dispatchedImages: AIImage[];

    const mockCollections: Collection[] = [
        { id: 'col1', name: 'Collection 1', createdAt: 100, source: 'ambit', count: 5, imageIds: ['img1'] },
    ];
    const smartFilters: FilterState = createDefaultFilters({ searchQuery: 'portrait' });

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
        dispatchedCollections = [...mockCollections];
        dispatchedFilters = createDefaultFilters();
        dispatchedImages = [makeImage({ id: 'img1' }), makeImage({ id: 'img2' })];
        mockSetAllCollections.mockImplementation((update: React.SetStateAction<Collection[]>) => {
            dispatchedCollections = typeof update === 'function' ? update(dispatchedCollections) : update;
        });
        mockSetFilters.mockImplementation((update: React.SetStateAction<FilterState>) => {
            dispatchedFilters = typeof update === 'function' ? update(dispatchedFilters) : update;
        });
        mockSetImages.mockImplementation((update: React.SetStateAction<AIImage[]>) => {
            dispatchedImages = typeof update === 'function' ? update(dispatchedImages) : update;
        });
        const collectionRepo = await import('../../services/db/collectionRepo');
        (collectionRepo.upsertCollection as any).mockResolvedValue(undefined);
        (collectionRepo.deleteCollectionFromDb as any).mockResolvedValue(undefined);
        (collectionRepo.addImagesToCollection as any).mockResolvedValue(undefined);
        (collectionRepo.removeImagesFromCollection as any).mockResolvedValue(undefined);
        (collectionRepo.setCollectionCustomThumbnail as any).mockResolvedValue(undefined);
        mockRefreshCollections.mockResolvedValue(undefined);
        mockRefreshCollectionThumbnails.mockResolvedValue(undefined);
        mockRefreshSmartCounts.mockResolvedValue(undefined);
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

        it('clears the active collection filter and rolls back when deletion fails', async () => {
            const { deleteCollectionFromDb } = await import('../../services/db/collectionRepo');
            vi.mocked(deleteCollectionFromDb).mockRejectedValueOnce(new Error('delete failed'));
            const activeProps = { ...props, activeCollectionId: 'col1' };
            const { result } = renderHook(() => useCollectionOperations(activeProps));

            await act(async () => {
                await result.current.deleteCollection('col1');
            });

            expect(mockSetFilters).toHaveBeenCalledWith(expect.any(Function));
            const filterUpdater = mockSetFilters.mock.calls[0][0] as (prev: FilterState) => FilterState;
            expect(filterUpdater(createDefaultFilters({ collectionId: 'col1' })).collectionId).toBeNull();
            expect(mockSetAllCollections).toHaveBeenCalledTimes(2);
            expect(mockAddToast).toHaveBeenCalledWith('Failed to delete collection', 'error');
        });
    });

    describe('collection metadata edits', () => {
        it('sanitizes self-referential smart filters and refreshes smart counts after saving', async () => {
            const { upsertCollection } = await import('../../services/db/collectionRepo');
            const smartCollection: SmartCollection = {
                id: 'smart1',
                name: 'Smart Collection',
                createdAt: 300,
                source: 'ambit',
                count: 1,
                imageIds: [],
                filters: smartFilters
            };
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: [],
                smartCollections: [smartCollection]
            }));

            await act(async () => {
                await result.current.updateCollectionFilters('smart1', createDefaultFilters({ collectionId: 'smart1' }));
            });

            const saved = vi.mocked(upsertCollection).mock.calls[0][0] as SmartCollection;
            expect(saved.filters?.collectionId).toBeNull();
            expect(mockAddToast).toHaveBeenCalledWith('Filters updated', 'success');
            expect(mockRefreshSmartCounts).toHaveBeenCalledWith({
                collectionIds: ['smart1'],
                includeArchived: true,
                includePromptSearch: true
            });
        });

        it('rolls back filter, rename, color, archive, and pin edits when persistence fails', async () => {
            const { upsertCollection } = await import('../../services/db/collectionRepo');
            vi.mocked(upsertCollection)
                .mockRejectedValueOnce(new Error('filters failed'))
                .mockRejectedValueOnce(new Error('rename failed'))
                .mockRejectedValueOnce(new Error('color failed'))
                .mockRejectedValueOnce(new Error('archive failed'))
                .mockRejectedValueOnce(new Error('pin failed'));
            const activeProps = { ...props, activeCollectionId: 'col1' };
            const { result } = renderHook(() => useCollectionOperations(activeProps));

            await act(async () => {
                await result.current.updateCollectionFilters('col1', undefined);
                await result.current.renameCollection('col1', 'Renamed');
                await result.current.setCollectionColor('col1', '#ff00aa');
                await result.current.toggleArchiveCollection('col1');
                await result.current.togglePinCollection('col1');
            });

            expect(mockSetAllCollections).toHaveBeenCalledTimes(10);
            expect(mockSetFilters).toHaveBeenCalledWith(expect.any(Function));
            expect(mockAddToast).toHaveBeenCalledWith('Failed to update filters', 'error');
            expect(mockAddToast).toHaveBeenCalledWith('Failed to rename collection', 'error');
            expect(mockAddToast).toHaveBeenCalledWith('Failed to update archive status', 'error');
        });

        it('saves rename, color, archive, and pin edits with the expected refresh behavior', async () => {
            const { upsertCollection } = await import('../../services/db/collectionRepo');
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.renameCollection('col1', 'Renamed');
                await result.current.setCollectionColor('col1', '#123456');
                await result.current.toggleArchiveCollection('col1');
                await result.current.togglePinCollection('col1');
            });

            expect(vi.mocked(upsertCollection).mock.calls.map(call => call[0])).toEqual([
                expect.objectContaining({ name: 'Renamed' }),
                expect.objectContaining({ color: '#123456' }),
                expect.objectContaining({ isArchived: true }),
                expect.objectContaining({ isPinned: true })
            ]);
            expect(mockAddToast).toHaveBeenCalledWith('Collection renamed', 'success');
            expect(mockAddToast).toHaveBeenCalledWith('Collection archived', 'info');
            expect(mockRefreshCollections).toHaveBeenCalledWith(true);
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

        it('refreshes static collection thumbnails after adding images', async () => {
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.addImagesToCollection(['img2'], 'col1');
            });

            expect(mockRefreshCollectionThumbnails).toHaveBeenCalledTimes(1);
            expect(mockRefreshCollectionThumbnails).toHaveBeenCalledWith(true);
            expect(mockRefreshSmartCounts).not.toHaveBeenCalled();
        });

        it('refreshes targeted smart summaries after adding images to a smart collection', async () => {
            const smartCollection: SmartCollection = {
                id: 'smart1',
                name: 'Smart Collection',
                createdAt: 300,
                source: 'ambit',
                count: 1,
                imageIds: [],
                filters: smartFilters
            };
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: [],
                smartCollections: [smartCollection]
            }));

            await act(async () => {
                await result.current.addImagesToCollection(['img2'], 'smart1');
            });

            expect(mockRefreshCollectionThumbnails).not.toHaveBeenCalled();
            expect(mockRefreshSmartCounts).toHaveBeenCalledTimes(1);
            expect(mockRefreshSmartCounts).toHaveBeenCalledWith({
                collectionIds: ['smart1'],
                includeArchived: true,
                includePromptSearch: true,
                markPending: true
            });
        });
    });

    describe('removeImagesFromCollection', () => {
        it('removes active collection images from the current grid and records hybrid exclusions', async () => {
            const { upsertCollection, removeImagesFromCollection } = await import('../../services/db/collectionRepo');
            const smartCollection: SmartCollection = {
                id: 'smart1',
                name: 'Smart Collection',
                createdAt: 300,
                source: 'ambit',
                count: 3,
                imageIds: [],
                filters: smartFilters,
                manualExclusions: ['img0']
            };
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: [],
                smartCollections: [smartCollection],
                activeCollectionId: 'smart1'
            }));

            await act(async () => {
                await result.current.removeImagesFromCollection(['img1'], 'smart1');
            });

            const imageUpdater = mockSetImages.mock.calls[0][0] as (images: AIImage[]) => AIImage[];
            expect(imageUpdater([makeImage({ id: 'img1' }), makeImage({ id: 'img2' })]).map(image => image.id)).toEqual(['img2']);
            expect(vi.mocked(upsertCollection).mock.calls[0][0]).toEqual(expect.objectContaining({
                manualExclusions: ['img0', 'img1']
            }));
            expect(removeImagesFromCollection).toHaveBeenCalledWith('smart1', ['img1']);
        });

        it('rolls back optimistic removal when the DB update fails', async () => {
            const { removeImagesFromCollection } = await import('../../services/db/collectionRepo');
            vi.mocked(removeImagesFromCollection).mockRejectedValueOnce(new Error('remove failed'));
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.removeImagesFromCollection(['img1'], 'col1');
            });

            expect(mockSetAllCollections).toHaveBeenCalledTimes(2);
            expect(mockAddToast).toHaveBeenCalledWith('Failed to remove from collection', 'error');
        });

        it('refreshes targeted smart summaries after removing images from a smart collection', async () => {
            const smartCollection: SmartCollection = {
                id: 'smart1',
                name: 'Smart Collection',
                createdAt: 300,
                source: 'ambit',
                count: 3,
                imageIds: [],
                filters: smartFilters
            };
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: [],
                smartCollections: [smartCollection]
            }));

            await act(async () => {
                await result.current.removeImagesFromCollection(['img1'], 'smart1');
            });

            expect(mockRefreshCollectionThumbnails).not.toHaveBeenCalled();
            expect(mockRefreshSmartCounts).toHaveBeenCalledTimes(1);
            expect(mockRefreshSmartCounts).toHaveBeenCalledWith({
                collectionIds: ['smart1'],
                includeArchived: true,
                includePromptSearch: true,
                markPending: true
            });
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

        it('refreshes static collection thumbnails once when moving between static collections', async () => {
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

            expect(mockRefreshCollectionThumbnails).toHaveBeenCalledTimes(1);
            expect(mockRefreshCollectionThumbnails).toHaveBeenCalledWith(true);
            expect(mockRefreshSmartCounts).not.toHaveBeenCalled();
        });

        it('refreshes both static and smart summaries when moving between mixed collection types', async () => {
            const smartCollection: SmartCollection = {
                id: 'smart1',
                name: 'Smart Collection',
                createdAt: 300,
                source: 'ambit',
                count: 0,
                imageIds: [],
                filters: smartFilters
            };
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                smartCollections: [smartCollection]
            }));

            await act(async () => {
                await result.current.moveImagesBetweenCollections(['img1'], 'col1', 'smart1');
            });

            expect(mockRefreshCollectionThumbnails).toHaveBeenCalledTimes(1);
            expect(mockRefreshCollectionThumbnails).toHaveBeenCalledWith(true);
            expect(mockRefreshSmartCounts).toHaveBeenCalledTimes(1);
            expect(mockRefreshSmartCounts).toHaveBeenCalledWith({
                collectionIds: ['smart1'],
                includeArchived: true,
                includePromptSearch: true,
                markPending: true
            });
        });

        it('refreshes both smart summaries in one targeted call when moving between smart collections', async () => {
            const sourceSmart: SmartCollection = {
                id: 'smart-source',
                name: 'Smart Source',
                createdAt: 300,
                source: 'ambit',
                count: 3,
                imageIds: [],
                filters: smartFilters
            };
            const targetSmart: SmartCollection = {
                id: 'smart-target',
                name: 'Smart Target',
                createdAt: 400,
                source: 'ambit',
                count: 0,
                imageIds: [],
                filters: createDefaultFilters({ dateRange: 'today' })
            };
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: [],
                smartCollections: [sourceSmart, targetSmart]
            }));

            await act(async () => {
                await result.current.moveImagesBetweenCollections(['img1'], 'smart-source', 'smart-target');
            });

            expect(mockRefreshCollectionThumbnails).not.toHaveBeenCalled();
            expect(mockRefreshSmartCounts).toHaveBeenCalledTimes(1);
            expect(mockRefreshSmartCounts).toHaveBeenCalledWith({
                collectionIds: ['smart-source', 'smart-target'],
                includeArchived: true,
                includePromptSearch: true,
                markPending: true
            });
        });

        it('handles hybrid smart source exclusions and rolls back mixed optimistic state on move failure', async () => {
            const { removeImagesFromCollection } = await import('../../services/db/collectionRepo');
            vi.mocked(removeImagesFromCollection).mockRejectedValueOnce(new Error('move failed'));
            const sourceSmart: SmartCollection = {
                id: 'smart-source',
                name: 'Smart Source',
                createdAt: 300,
                source: 'ambit',
                count: 3,
                imageIds: [],
                filters: smartFilters,
                manualExclusions: []
            };
            const target = { id: 'col2', name: 'Target', createdAt: 200, source: 'ambit' as const, count: 0, imageIds: [] as string[] };
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: [target],
                smartCollections: [sourceSmart],
                activeCollectionId: 'smart-source'
            }));

            await act(async () => {
                await result.current.moveImagesBetweenCollections(['img1'], 'smart-source', 'col2');
            });

            const imageUpdater = mockSetImages.mock.calls[0][0] as (images: AIImage[]) => AIImage[];
            expect(imageUpdater([makeImage({ id: 'img1' }), makeImage({ id: 'img2' })]).map(image => image.id)).toEqual(['img2']);
            expect(mockSetAllCollections).toHaveBeenCalledTimes(2);
            expect(mockAddToast).toHaveBeenCalledWith('Failed to move images', 'error');
        });
    });

    describe('collection thumbnails', () => {
        it('reports missing collections before attempting custom thumbnail changes', async () => {
            const { setCollectionCustomThumbnail } = await import('../../services/db/collectionRepo');
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.setCollectionThumbnail('missing', makeImage());
                await result.current.resetCollectionThumbnail('missing');
            });

            expect(setCollectionCustomThumbnail).not.toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith('Collection not found', 'error');
            expect(mockAddToast).toHaveBeenCalledTimes(2);
        });

        it('rolls back custom thumbnail updates when persistence fails', async () => {
            const { setCollectionCustomThumbnail } = await import('../../services/db/collectionRepo');
            vi.mocked(setCollectionCustomThumbnail).mockRejectedValueOnce(new Error('thumbnail failed'));
            const { result } = renderHook(() => useCollectionOperations(props));

            await act(async () => {
                await result.current.setCollectionThumbnail('col1', makeImage());
            });

            expect(mockSetAllCollections).toHaveBeenCalledTimes(2);
            expect(mockAddToast).toHaveBeenCalledWith('Failed to update thumbnail', 'error');
        });

        it('rolls back thumbnail reset when persistence fails', async () => {
            const { setCollectionCustomThumbnail } = await import('../../services/db/collectionRepo');
            vi.mocked(setCollectionCustomThumbnail).mockRejectedValueOnce(new Error('reset failed'));
            const collectionsWithThumbnail = [{ ...mockCollections[0], customThumbnail: 'img2' }];
            const { result } = renderHook(() => useCollectionOperations({
                ...props,
                collections: collectionsWithThumbnail
            }));

            await act(async () => {
                await result.current.resetCollectionThumbnail('col1');
            });

            expect(mockSetAllCollections).toHaveBeenCalledTimes(2);
            expect(mockAddToast).toHaveBeenCalledWith('Failed to reset thumbnail', 'error');
        });

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

    it('no-ops every collection mutation when its collection is missing', async () => {
        const { result } = renderHook(() => useCollectionOperations(props));
        await act(async () => {
            await result.current.updateCollectionFilters('missing', smartFilters);
            await result.current.deleteCollection('missing');
            await result.current.renameCollection('missing', 'Name');
            await result.current.setCollectionColor('missing', 'red');
            await result.current.toggleArchiveCollection('missing');
            await result.current.togglePinCollection('missing');
            await result.current.addImagesToCollection(['img1'], 'missing');
            await result.current.removeImagesFromCollection(['img1'], 'missing');
            await result.current.moveImagesBetweenCollections(['img1'], 'missing', 'col1');
            await result.current.moveImagesBetweenCollections(['img1'], 'col1', 'missing');
        });
        expect(mockSetAllCollections).not.toHaveBeenCalled();
    });

    it('sanitizes self-referencing smart filters and converts collections to static', async () => {
        const { upsertCollection } = await import('../../services/db/collectionRepo');
        const { result } = renderHook(() => useCollectionOperations(props));
        await act(async () => result.current.updateCollectionFilters('col1', { ...smartFilters, collectionId: 'col1' }));
        expect(upsertCollection).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ collectionId: null }) }));
        expect(mockRefreshSmartCounts).toHaveBeenCalledWith(expect.objectContaining({ collectionIds: ['col1'] }));

        await act(async () => result.current.updateCollectionFilters('col1', undefined));
        expect(mockAddToast).toHaveBeenCalledWith('Collection converted to static', 'success');
    });

    it('keeps unrelated entries during successful and failed scalar updates', async () => {
        const { upsertCollection } = await import('../../services/db/collectionRepo');
        const extra = { id: 'extra', name: 'Extra', createdAt: 2, source: 'ambit' as const, count: 0, imageIds: [] };
        const multiProps = { ...props, collections: [...mockCollections, extra] };
        dispatchedCollections = [...multiProps.collections];
        const { result } = renderHook(() => useCollectionOperations(multiProps));
        await act(async () => result.current.renameCollection('col1', 'Renamed'));
        await act(async () => result.current.setCollectionColor('col1', undefined));
        await act(async () => result.current.togglePinCollection('col1'));
        vi.mocked(upsertCollection).mockRejectedValueOnce(new Error('archive failed'));
        await act(async () => result.current.toggleArchiveCollection('col1'));
        expect(dispatchedCollections.find(collection => collection.id === 'extra')).toBeTruthy();
        expect(mockAddToast).toHaveBeenCalledWith('Failed to update archive status', 'error');
    });

    it('unarchives collections and exercises zero-count add, remove, and move calculations', async () => {
        const archived = { ...mockCollections[0], count: 0, isArchived: true };
        const target = { id: 'target', name: 'Target', createdAt: 2, source: 'ambit' as const, count: 0, imageIds: [] };
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: [archived, target] }));
        await act(async () => result.current.toggleArchiveCollection('col1'));
        expect(mockAddToast).toHaveBeenCalledWith('Collection unarchived', 'info');
        await act(async () => result.current.addImagesToCollection(['a'], 'col1'));
        await act(async () => result.current.removeImagesFromCollection(['a', 'b'], 'col1'));
        await act(async () => result.current.moveImagesBetweenCollections(['a'], 'col1', 'target'));
        expect(mockAddToast).toHaveBeenCalledWith('Moved images to Target', 'success');
    });

    it('uses the smart-save alias and supports image URL thumbnail fallback', async () => {
        const { result } = renderHook(() => useCollectionOperations(props));
        await act(async () => result.current.saveSmartCollection('Saved Smart', smartFilters));
        expect(mockAddToast).toHaveBeenCalledWith('Collection "Saved Smart" created', 'success');
        await act(async () => result.current.setCollectionThumbnail('col1', makeImage({ thumbnailUrl: '' })));
        const thumbnailUpdater = mockSetAllCollections.mock.calls.at(-1)?.[0] as (collections: Collection[]) => Collection[];
        expect(thumbnailUpdater(mockCollections)[0].thumbnail).toBe('asset://C:/images/img2.png');
    });

    it('logs background thumbnail reconciliation and invalidation failures', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockRejectedValue(new Error('invalidate failed'));
        mockRefreshCollections.mockRejectedValue(new Error('refresh failed'));
        const collectionsWithThumbnail = [{ ...mockCollections[0], customThumbnail: 'img2' }];
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: collectionsWithThumbnail }));
        await act(async () => result.current.setCollectionThumbnail('col1', makeImage()));
        await act(async () => Promise.resolve());
        expect(errorSpy).toHaveBeenCalledWith('[Collections] Failed to reconcile collection thumbnail state', expect.any(Error));
        expect(errorSpy).toHaveBeenCalledWith('[Collections] Failed to invalidate image queries after thumbnail update', expect.any(Error));

        await act(async () => result.current.resetCollectionThumbnail('col1'));
        await act(async () => Promise.resolve());
        expect(errorSpy).toHaveBeenCalledWith('[Collections] Failed to reconcile collection thumbnail reset', expect.any(Error));
        expect(errorSpy).toHaveBeenCalledWith('[Collections] Failed to invalidate image queries after thumbnail reset', expect.any(Error));
        invalidateSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('rolls back failed adds while preserving unrelated collections', async () => {
        const { addImagesToCollection } = await import('../../services/db/collectionRepo');
        vi.mocked(addImagesToCollection).mockRejectedValueOnce(new Error('add failed'));
        const zero = { ...mockCollections[0], count: 0 };
        const extra = { id: 'extra', name: 'Extra', createdAt: 2, source: 'ambit' as const, count: 0, imageIds: [] };
        dispatchedCollections = [zero, extra];
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: [zero, extra] }));
        await act(async () => result.current.addImagesToCollection(['img'], 'col1'));
        expect(dispatchedCollections).toEqual([zero, extra]);
        expect(mockAddToast).toHaveBeenCalledWith('Failed to add to collection', 'error');
    });

    it('updates non-self filters and rolls them back alongside unrelated collections', async () => {
        const { upsertCollection } = await import('../../services/db/collectionRepo');
        const extra = { id: 'extra', name: 'Extra', createdAt: 2, source: 'ambit' as const, count: 0, imageIds: [] };
        dispatchedCollections = [...mockCollections, extra];
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: [...mockCollections, extra] }));
        await act(async () => result.current.updateCollectionFilters('col1', { ...smartFilters, collectionId: 'extra' }));
        expect(upsertCollection).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ collectionId: 'extra' }) }));

        vi.mocked(upsertCollection).mockRejectedValueOnce(new Error('filters failed'));
        await act(async () => result.current.updateCollectionFilters('col1', smartFilters));
        expect(dispatchedCollections.find(collection => collection.id === 'extra')).toBeTruthy();
        expect(mockAddToast).toHaveBeenCalledWith('Failed to update filters', 'error');
    });

    it('uses empty exclusion and count fallbacks when removing from an inactive smart collection', async () => {
        const smart: SmartCollection = {
            id: 'smart', name: 'Smart', createdAt: 1, source: 'ambit', count: 0, imageIds: [], filters: smartFilters
        };
        dispatchedCollections = [smart];
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: [], smartCollections: [smart], activeCollectionId: null }));
        await act(async () => result.current.removeImagesFromCollection(['img'], 'smart'));
        const { upsertCollection } = await import('../../services/db/collectionRepo');
        expect(upsertCollection).toHaveBeenCalledWith(expect.objectContaining({ manualExclusions: ['img'] }));
        expect(mockSetImages).not.toHaveBeenCalled();
    });

    it('rolls back both ends of a failed move with zero-count fallbacks', async () => {
        const { removeImagesFromCollection } = await import('../../services/db/collectionRepo');
        vi.mocked(removeImagesFromCollection).mockRejectedValueOnce(new Error('move failed'));
        const source = { ...mockCollections[0], count: 0 };
        const target = { id: 'target', name: 'Target', createdAt: 2, source: 'ambit' as const, count: 0, imageIds: [] };
        const extra = { id: 'extra', name: 'Extra', createdAt: 3, source: 'ambit' as const, count: 1, imageIds: [] };
        dispatchedCollections = [source, target, extra];
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: [source, target, extra], activeCollectionId: null }));
        await act(async () => result.current.moveImagesBetweenCollections(['img'], 'col1', 'target'));
        expect(dispatchedCollections).toEqual([source, target, extra]);
        expect(mockAddToast).toHaveBeenCalledWith('Failed to move images', 'error');
    });

    it('preserves unrelated collections in thumbnail set and reset updaters', async () => {
        const target = { ...mockCollections[0], customThumbnail: 'old' };
        const extra = { id: 'extra', name: 'Extra', createdAt: 2, source: 'ambit' as const, count: 0, imageIds: [] };
        dispatchedCollections = [target, extra];
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: [target, extra] }));
        await act(async () => result.current.setCollectionThumbnail('col1', makeImage()));
        expect(dispatchedCollections.find(collection => collection.id === 'extra')).toBeTruthy();
        await act(async () => result.current.resetCollectionThumbnail('col1'));
        expect(dispatchedCollections.find(collection => collection.id === 'extra')).toBeTruthy();
    });

    it('preserves unrelated collections across every remaining rollback path', async () => {
        const repo = await import('../../services/db/collectionRepo');
        const target = { ...mockCollections[0], customThumbnail: 'old' };
        const extra = { id: 'extra', name: 'Extra', createdAt: 2, source: 'ambit' as const, count: 0, imageIds: [] };
        const resetState = () => { dispatchedCollections = [target, extra]; };
        const { result } = renderHook(() => useCollectionOperations({ ...props, collections: [target, extra] }));

        resetState();
        vi.mocked(repo.upsertCollection).mockRejectedValueOnce(new Error('rename'));
        await act(async () => result.current.renameCollection('col1', 'Renamed'));
        expect(dispatchedCollections[1]).toBe(extra);

        resetState();
        vi.mocked(repo.upsertCollection).mockRejectedValueOnce(new Error('color'));
        await act(async () => result.current.setCollectionColor('col1', 'red'));
        expect(dispatchedCollections[1]).toBe(extra);

        resetState();
        vi.mocked(repo.upsertCollection).mockRejectedValueOnce(new Error('pin'));
        await act(async () => result.current.togglePinCollection('col1'));
        expect(dispatchedCollections[1]).toBe(extra);

        resetState();
        vi.mocked(repo.removeImagesFromCollection).mockRejectedValueOnce(new Error('remove'));
        await act(async () => result.current.removeImagesFromCollection(['img'], 'col1'));
        expect(dispatchedCollections[1]).toBe(extra);

        resetState();
        vi.mocked(repo.setCollectionCustomThumbnail).mockRejectedValueOnce(new Error('thumbnail'));
        await act(async () => result.current.setCollectionThumbnail('col1', makeImage()))
        expect(dispatchedCollections[1]).toBe(extra);

        resetState();
        vi.mocked(repo.setCollectionCustomThumbnail).mockRejectedValueOnce(new Error('reset'));
        await act(async () => result.current.resetCollectionThumbnail('col1'));
        expect(dispatchedCollections[1]).toBe(extra);
    });
});
