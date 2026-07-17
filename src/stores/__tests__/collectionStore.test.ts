import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '../collectionStore';
import { Collection, FilterState } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';

const collectionRepoMocks = vi.hoisted(() => ({
    mockGetAllCollectionsWithStats: vi.fn(),
    mockGetSmartCollectionSummaries: vi.fn(),
    mockCacheSmartCollectionCount: vi.fn(),
    mockGetCollectionThumbnailSummaries: vi.fn(),
    mockEnsureCollectionSchema: vi.fn(),
    mockUpsertCollection: vi.fn(),
    mockAddImagesToCollection: vi.fn(),
    mockGetCollectionImageIds: vi.fn(),
    mockDeleteCollectionFromDb: vi.fn()
}));
const appRepositoryMocks = vi.hoisted(() => ({ mockLoad: vi.fn() }));
const libraryStoreMocks = vi.hoisted(() => ({
    isImporting: false
}));

const {
    mockGetAllCollectionsWithStats,
    mockGetSmartCollectionSummaries,
    mockCacheSmartCollectionCount,
    mockGetCollectionThumbnailSummaries
} = collectionRepoMocks;

vi.mock('../libraryStore', () => ({
    useLibraryStore: {
        getState: () => ({
            isImporting: libraryStoreMocks.isImporting
        })
    }
}));

vi.mock('../../services/db/collectionRepo', () => ({
    getAllCollectionsWithStats: collectionRepoMocks.mockGetAllCollectionsWithStats,
    getSmartCollectionSummaries: collectionRepoMocks.mockGetSmartCollectionSummaries,
    cacheSmartCollectionCount: collectionRepoMocks.mockCacheSmartCollectionCount,
    getCollectionThumbnailSummaries: collectionRepoMocks.mockGetCollectionThumbnailSummaries,
    ensureCollectionSchema: collectionRepoMocks.mockEnsureCollectionSchema,
    upsertCollection: collectionRepoMocks.mockUpsertCollection,
    addImagesToCollection: collectionRepoMocks.mockAddImagesToCollection,
    getCollectionImageIds: collectionRepoMocks.mockGetCollectionImageIds,
    deleteCollectionFromDb: collectionRepoMocks.mockDeleteCollectionFromDb
}));

vi.mock('../../services/repository', () => ({
    appRepository: { load: appRepositoryMocks.mockLoad }
}));

const resetCollectionStore = () => {
    useCollectionStore.setState(useCollectionStore.getInitialState(), true);
};

const createDeferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
};

const makeStaticCollection = (overrides: Partial<Collection> = {}): Collection => ({
    id: 'static-1',
    name: 'Static One',
    createdAt: 1,
    updatedAt: 1,
    source: 'ambit',
    count: 0,
    imageIds: [],
    ...overrides
});

describe('collectionStore smart count refresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAllCollectionsWithStats.mockResolvedValue([]);
        mockGetSmartCollectionSummaries.mockResolvedValue({});
        mockCacheSmartCollectionCount.mockResolvedValue(undefined);
        mockGetCollectionThumbnailSummaries.mockResolvedValue({});
        collectionRepoMocks.mockEnsureCollectionSchema.mockResolvedValue(undefined);
        collectionRepoMocks.mockUpsertCollection.mockResolvedValue(undefined);
        collectionRepoMocks.mockAddImagesToCollection.mockResolvedValue(undefined);
        collectionRepoMocks.mockGetCollectionImageIds.mockResolvedValue([]);
        collectionRepoMocks.mockDeleteCollectionFromDb.mockResolvedValue(undefined);
        appRepositoryMocks.mockLoad.mockResolvedValue({ collections: [], smartCollections: [] });
        libraryStoreMocks.isImporting = false;
        resetCollectionStore();
    });

    it('does not apply stale collection refresh rows after a newer refresh finishes', async () => {
        const staleRefresh = createDeferred<Collection[]>();
        const freshRefresh = createDeferred<Collection[]>();
        mockGetAllCollectionsWithStats
            .mockImplementationOnce(() => staleRefresh.promise)
            .mockImplementationOnce(() => freshRefresh.promise);

        act(() => {
            useCollectionStore.setState({
                collections: [makeStaticCollection({ id: 'existing', name: 'Existing' })],
                isLoaded: true
            });
        });

        const staleRun = useCollectionStore.getState().refreshCollections();
        await waitFor(() => expect(mockGetAllCollectionsWithStats).toHaveBeenCalledTimes(1));
        const freshRun = useCollectionStore.getState().refreshCollections();
        await waitFor(() => expect(mockGetAllCollectionsWithStats).toHaveBeenCalledTimes(2));

        freshRefresh.resolve([
            makeStaticCollection({
                id: 'assets-showcase',
                name: 'Assets: Showcase',
                createdAt: 2,
                updatedAt: 2
            })
        ]);
        await act(async () => {
            await freshRun;
        });

        staleRefresh.resolve([
            makeStaticCollection({ id: 'existing', name: 'Existing' })
        ]);
        await act(async () => {
            await staleRun;
        });

        expect(useCollectionStore.getState().collections).toEqual([
            expect.objectContaining({
                id: 'assets-showcase',
                name: 'Assets: Showcase'
            })
        ]);
    });

    it('does not let an in-flight refresh overwrite a newer debounced refresh request', async () => {
        const staleRefresh = createDeferred<Collection[]>();
        const debouncedRefresh = createDeferred<Collection[]>();
        mockGetAllCollectionsWithStats
            .mockImplementationOnce(() => staleRefresh.promise)
            .mockImplementationOnce(() => debouncedRefresh.promise);

        act(() => {
            useCollectionStore.setState({
                collections: [makeStaticCollection({ id: 'initial', name: 'Initial' })],
                isLoaded: true
            });
        });

        const staleRun = useCollectionStore.getState().refreshCollections();
        await waitFor(() => expect(mockGetAllCollectionsWithStats).toHaveBeenCalledTimes(1));
        const debouncedRun = useCollectionStore.getState().refreshCollections(true);

        staleRefresh.resolve([
            makeStaticCollection({ id: 'stale', name: 'Stale' })
        ]);
        await act(async () => {
            await staleRun;
        });

        expect(useCollectionStore.getState().collections).toEqual([
            expect.objectContaining({
                id: 'initial',
                name: 'Initial'
            })
        ]);

        await waitFor(() => expect(mockGetAllCollectionsWithStats).toHaveBeenCalledTimes(2));
        debouncedRefresh.resolve([
            makeStaticCollection({
                id: 'assets-showcase',
                name: 'Assets: Showcase',
                createdAt: 2,
                updatedAt: 2
            })
        ]);
        await act(async () => {
            await debouncedRun;
        });

        expect(useCollectionStore.getState().collections).toEqual([
            expect.objectContaining({
                id: 'assets-showcase',
                name: 'Assets: Showcase'
            })
        ]);
    });

    it('does not let an in-flight refresh overwrite an optimistic collection update', async () => {
        const staleRefresh = createDeferred<Collection[]>();
        mockGetAllCollectionsWithStats.mockImplementationOnce(() => staleRefresh.promise);

        act(() => {
            useCollectionStore.setState({
                collections: [makeStaticCollection({ id: 'existing', name: 'Existing' })],
                isLoaded: true
            });
        });

        const staleRun = useCollectionStore.getState().refreshCollections();
        await waitFor(() => expect(mockGetAllCollectionsWithStats).toHaveBeenCalledTimes(1));

        act(() => {
            useCollectionStore.getState().setCollections(prev => [
                ...prev,
                makeStaticCollection({
                    id: 'assets-showcase',
                    name: 'Assets: Showcase',
                    createdAt: 2,
                    updatedAt: 2
                })
            ]);
        });

        staleRefresh.resolve([
            makeStaticCollection({ id: 'existing', name: 'Existing' })
        ]);
        await act(async () => {
            await staleRun;
        });

        expect(useCollectionStore.getState().collections).toEqual([
            expect.objectContaining({
                id: 'existing',
                name: 'Existing'
            }),
            expect.objectContaining({
                id: 'assets-showcase',
                name: 'Assets: Showcase'
            })
        ]);
    });

    it('allows an in-flight refresh to apply after a no-op collection setter', async () => {
        const refresh = createDeferred<Collection[]>();
        mockGetAllCollectionsWithStats.mockImplementationOnce(() => refresh.promise);

        act(() => {
            useCollectionStore.setState({
                collections: [makeStaticCollection({ id: 'initial', name: 'Initial' })],
                isLoaded: true
            });
        });

        const refreshRun = useCollectionStore.getState().refreshCollections();
        await waitFor(() => expect(mockGetAllCollectionsWithStats).toHaveBeenCalledTimes(1));

        act(() => {
            useCollectionStore.getState().setCollections(prev => prev);
        });

        refresh.resolve([
            makeStaticCollection({
                id: 'db-refresh',
                name: 'DB Refresh',
                createdAt: 2,
                updatedAt: 2
            })
        ]);
        await act(async () => {
            await refreshRun;
        });

        expect(useCollectionStore.getState().collections).toEqual([
            expect.objectContaining({
                id: 'db-refresh',
                name: 'DB Refresh'
            })
        ]);
    });

    it('does not reintroduce a deleted collection when stale smart counts finish later', async () => {
        const smartFilters: FilterState = {
            searchQuery: 'banana',
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            samplers: [],
            generationTypes: [],
            controlNets: [],
            ipAdapters: [],
            dateRange: 'all',
            favoritesOnly: false,
            collectionId: null
        };
        mockGetSmartCollectionSummaries.mockResolvedValue({ 'smart-1': { count: 42 } });

        act(() => {
            useCollectionStore.setState({
                collections: [
                    {
                        id: 'smart-1',
                        name: 'Smart One',
                        createdAt: 1,
                        updatedAt: 1,
                        source: 'ambit',
                        count: 0,
                        imageIds: [],
                        filters: smartFilters
                    },
                    {
                        id: 'static-1',
                        name: 'Static One',
                        createdAt: 2,
                        updatedAt: 2,
                        source: 'ambit',
                        count: 3,
                        imageIds: []
                    }
                ],
                isLoaded: true
            });
        });

        const refreshPromise = useCollectionStore.getState().refreshSmartCounts([
            ...useCollectionStore.getState().collections
        ]);

        act(() => {
            useCollectionStore.setState((state) => ({
                collections: state.collections.filter((collection) => collection.id !== 'smart-1')
            }));
        });

        await refreshPromise;

        expect(useCollectionStore.getState().collections).toEqual([
            expect.objectContaining({
                id: 'static-1'
            })
        ]);
    });

    it('updates smart collection count without replacing a custom thumbnail', async () => {
        const smartFilters: FilterState = {
            searchQuery: 'portrait',
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            samplers: [],
            generationTypes: [],
            controlNets: [],
            ipAdapters: [],
            dateRange: 'all',
            favoritesOnly: false,
            collectionId: null
        };
        mockGetSmartCollectionSummaries.mockResolvedValue({
            'smart-1': {
                count: 7,
                thumbnail: 'dynamic-thumb.webp',
                safeThumbnail: 'dynamic-safe.webp',
                thumbnailIsSensitive: true,
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-1',
                    name: 'Smart One',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    count: 0,
                    imageIds: [],
                    filters: smartFilters,
                    customThumbnail: 'custom-image-id',
                    thumbnail: 'custom-thumb.webp',
                    safeThumbnail: 'custom-safe.webp',
                    thumbnailIsSensitive: false,
                    thumbnailSourceKind: 'customImage'
                }],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshSmartCounts([
            ...useCollectionStore.getState().collections
        ]);

        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 7,
            customThumbnail: 'custom-image-id',
            thumbnail: 'custom-thumb.webp',
            safeThumbnail: 'custom-safe.webp',
            thumbnailIsSensitive: false,
            thumbnailSourceKind: 'customImage'
        }));
    });

    it('updates smart collection counts without clearing thumbnails when thumbnail refresh is skipped', async () => {
        const smartFilters: FilterState = {
            searchQuery: 'portrait',
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            samplers: [],
            generationTypes: [],
            controlNets: [],
            ipAdapters: [],
            dateRange: 'all',
            favoritesOnly: false,
            collectionId: null
        };
        mockGetSmartCollectionSummaries.mockResolvedValue({
            'smart-1': {
                count: 9,
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-1',
                    name: 'Smart One',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    count: 0,
                    imageIds: [],
                    filters: smartFilters,
                    thumbnail: 'existing-thumb.webp',
                    safeThumbnail: 'existing-safe.webp',
                    thumbnailIsSensitive: true,
                    thumbnailSourceKind: 'dynamic'
                }],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshSmartCounts({
            includeThumbnails: false,
            includePromptSearch: true
        });

        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'smart-1' })],
            { includeThumbnails: false }
        );
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 9,
            thumbnail: 'existing-thumb.webp',
            safeThumbnail: 'existing-safe.webp',
            thumbnailIsSensitive: true,
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('skips prompt-search smart collections during automatic smart count refreshes', async () => {
        mockGetSmartCollectionSummaries.mockResolvedValue({
            'smart-date': {
                count: 12,
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [
                    {
                        id: 'smart-prompt',
                        name: 'Prompt Smart',
                        createdAt: 1,
                        updatedAt: 1,
                        source: 'ambit',
                        count: 0,
                        imageIds: [],
                        filters: createDefaultFilters({ searchQuery: 'apple' })
                    },
                    {
                        id: 'smart-date',
                        name: 'Date Smart',
                        createdAt: 2,
                        updatedAt: 2,
                        source: 'ambit',
                        count: 0,
                        imageIds: [],
                        filters: createDefaultFilters({ dateRange: 'today' })
                    }
                ],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshSmartCounts({ includeThumbnails: false });

        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(1);
        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'smart-date' })],
            { includeThumbnails: false }
        );
    });

    it('marks smart summary pending ids while smart thumbnails are loading', async () => {
        let resolveSummaries: ((value: Record<string, unknown>) => void) | undefined;
        mockGetSmartCollectionSummaries.mockImplementationOnce(() => new Promise(resolve => {
            resolveSummaries = resolve;
        }));

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-date',
                    name: 'Date Smart',
                    createdAt: 2,
                    updatedAt: 2,
                    source: 'ambit',
                    count: 0,
                    imageIds: [],
                    filters: createDefaultFilters({ dateRange: 'today' })
                }],
                isLoaded: true
            });
        });

        const refreshPromise = useCollectionStore.getState().refreshSmartCounts({ markPending: true });

        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({
            'smart-date': true
        });
        await waitFor(() => expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(1));

        resolveSummaries?.({
            'smart-date': {
                count: 12,
                thumbnail: 'asset://smart-thumb.webp',
                safeThumbnail: 'asset://smart-safe.webp',
                thumbnailIsSensitive: false,
                thumbnailSourceKind: 'dynamic'
            }
        });
        await refreshPromise;

        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 12,
            thumbnail: 'asset://smart-thumb.webp',
            safeThumbnail: 'asset://smart-safe.webp',
            thumbnailIsSensitive: false,
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('clears stale smart pending ids when a non-pending refresh supersedes thumbnail hydration', async () => {
        let resolveStaleSummaries: ((value: Record<string, unknown>) => void) | undefined;
        mockGetSmartCollectionSummaries
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveStaleSummaries = resolve;
            }))
            .mockResolvedValueOnce({
                'smart-date': {
                    count: 14,
                    thumbnail: 'asset://replacement-thumb.webp',
                    thumbnailSourceKind: 'dynamic'
                }
            });

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-date',
                    name: 'Date Smart',
                    createdAt: 2,
                    updatedAt: 2,
                    source: 'ambit',
                    count: 0,
                    imageIds: [],
                    filters: createDefaultFilters({ dateRange: 'today' })
                }],
                isLoaded: true
            });
        });

        const staleRun = useCollectionStore.getState().refreshSmartCounts({ markPending: true });
        await waitFor(() => expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(1));
        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({
            'smart-date': true
        });

        const replacementRun = useCollectionStore.getState().refreshSmartCounts({
            collectionIds: ['smart-date'],
            includeArchived: true,
            includePromptSearch: true
        });

        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});
        await replacementRun;

        resolveStaleSummaries?.({
            'smart-date': {
                count: 12,
                thumbnail: 'asset://stale-thumb.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });
        await staleRun;

        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 14,
            thumbnail: 'asset://replacement-thumb.webp',
            thumbnailSourceKind: 'dynamic'
        }));
        expect(mockCacheSmartCollectionCount).toHaveBeenCalledTimes(1);
        expect(mockCacheSmartCollectionCount).toHaveBeenCalledWith('smart-date', 14, 2);
    });

    it('clears smart pending ids when an import-skip refresh supersedes thumbnail hydration', async () => {
        let resolveStaleSummaries: ((value: Record<string, unknown>) => void) | undefined;
        mockGetSmartCollectionSummaries.mockImplementationOnce(() => new Promise(resolve => {
            resolveStaleSummaries = resolve;
        }));

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-date',
                    name: 'Date Smart',
                    createdAt: 2,
                    updatedAt: 2,
                    source: 'ambit',
                    count: 0,
                    imageIds: [],
                    filters: createDefaultFilters({ dateRange: 'today' })
                }],
                isLoaded: true
            });
        });

        const staleRun = useCollectionStore.getState().refreshSmartCounts({ markPending: true });
        await waitFor(() => expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(1));
        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({
            'smart-date': true
        });

        libraryStoreMocks.isImporting = true;
        await useCollectionStore.getState().refreshSmartCounts({ markPending: true });

        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(1);
        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});

        resolveStaleSummaries?.({
            'smart-date': {
                count: 12,
                thumbnail: 'asset://stale-thumb.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });
        await staleRun;

        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 0
        }));
        expect(useCollectionStore.getState().collections[0].thumbnail).toBeUndefined();
    });

    it('does not mark a smart collection pending when a cached thumbnail is already loaded', async () => {
        mockGetSmartCollectionSummaries.mockResolvedValue({
            'smart-date': {
                count: 12,
                thumbnail: 'asset://fresh-smart-thumb.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-date',
                    name: 'Date Smart',
                    createdAt: 2,
                    updatedAt: 2,
                    source: 'ambit',
                    count: 0,
                    imageIds: [],
                    filters: createDefaultFilters({ dateRange: 'today' }),
                    thumbnail: 'asset://cached-smart-thumb.webp',
                    safeThumbnail: 'asset://cached-smart-safe.webp',
                    thumbnailIsSensitive: false,
                    thumbnailSourceKind: 'dynamic'
                }],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshSmartCounts({ markPending: true });

        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 12,
            thumbnail: 'asset://fresh-smart-thumb.webp',
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('keeps cached prompt-search smart counts and thumbnails visible during automatic refreshes', async () => {
        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-prompt',
                    name: 'Prompt Smart',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    count: 9,
                    imageIds: [],
                    filters: createDefaultFilters({ searchQuery: 'apple' }),
                    thumbnail: 'asset://cached-prompt-thumb.webp',
                    thumbnailSourceKind: 'dynamic'
                }],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshSmartCounts({ markPending: true });

        expect(mockGetSmartCollectionSummaries).not.toHaveBeenCalled();
        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 9,
            thumbnail: 'asset://cached-prompt-thumb.webp',
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('automatically refreshes pinned prompt-search smart collections', async () => {
        mockGetSmartCollectionSummaries.mockResolvedValue({
            'smart-prompt': {
                count: 11,
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'smart-prompt',
                    name: 'Pinned Prompt Smart',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    isPinned: true,
                    count: 9,
                    imageIds: [],
                    filters: createDefaultFilters({ searchQuery: 'apple' })
                }],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshSmartCounts({ includeThumbnails: false });

        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'smart-prompt', isPinned: true })],
            { includeThumbnails: false }
        );
        expect(useCollectionStore.getState().collections[0].count).toBe(11);
    });

    it('does not let an automatic refresh cancel a selected pinned prompt collection refresh', async () => {
        let resolvePromptSummary: ((value: Record<string, unknown>) => void) | undefined;
        mockGetSmartCollectionSummaries
            .mockImplementationOnce(() => new Promise(resolve => {
                resolvePromptSummary = resolve;
            }))
            .mockResolvedValueOnce({
                'smart-date': {
                    count: 12,
                    thumbnailSourceKind: 'dynamic'
                }
            });

        act(() => {
            useCollectionStore.setState({
                collections: [
                    {
                        id: 'smart-prompt',
                        name: 'Prompt Smart',
                        createdAt: 1,
                        updatedAt: 1,
                        source: 'ambit',
                        isPinned: true,
                        count: 9,
                        imageIds: [],
                        filters: createDefaultFilters({ searchQuery: 'apple' })
                    },
                    {
                        id: 'smart-date',
                        name: 'Date Smart',
                        createdAt: 2,
                        updatedAt: 2,
                        source: 'ambit',
                        count: 0,
                        imageIds: [],
                        filters: createDefaultFilters({ dateRange: 'today' })
                    }
                ],
                isLoaded: true
            });
        });

        const selectedRefresh = useCollectionStore.getState().refreshSmartCounts({
            collectionIds: ['smart-prompt'],
            includeArchived: true,
            includePromptSearch: true,
            includeThumbnails: false
        });
        await waitFor(() => expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(1));

        await useCollectionStore.getState().refreshSmartCounts({ includeThumbnails: false });
        resolvePromptSummary?.({
            'smart-prompt': {
                count: 5,
                thumbnailSourceKind: 'dynamic'
            }
        });
        await selectedRefresh;

        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(2);
        expect(mockGetSmartCollectionSummaries).toHaveBeenNthCalledWith(
            2,
            [expect.objectContaining({ id: 'smart-date' })],
            { includeThumbnails: false }
        );
        expect(useCollectionStore.getState().collections).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'smart-prompt', count: 5 }),
            expect.objectContaining({ id: 'smart-date', count: 12 })
        ]));
    });

    it('hydrates prompt-search smart collections when explicitly selected', async () => {
        mockGetSmartCollectionSummaries.mockResolvedValue({
            'smart-prompt': {
                count: 5,
                thumbnail: 'asset://prompt-thumb.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [
                    {
                        id: 'smart-prompt',
                        name: 'Prompt Smart',
                        createdAt: 1,
                        updatedAt: 1,
                        source: 'ambit',
                        count: 0,
                        imageIds: [],
                        filters: createDefaultFilters({ searchQuery: 'apple' })
                    },
                    {
                        id: 'smart-date',
                        name: 'Date Smart',
                        createdAt: 2,
                        updatedAt: 2,
                        source: 'ambit',
                        count: 0,
                        imageIds: [],
                        filters: createDefaultFilters({ dateRange: 'today' })
                    }
                ],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshSmartCounts({
            collectionIds: ['smart-prompt'],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true
        });

        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(1);
        expect(mockGetSmartCollectionSummaries).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'smart-prompt' })],
            { includeThumbnails: true }
        );
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 5,
            thumbnail: 'asset://prompt-thumb.webp',
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('refreshes collection thumbnails without reloading collection rows', async () => {
        mockGetCollectionThumbnailSummaries.mockResolvedValue({
            'static-1': {
                thumbnail: 'asset://thumb.webp',
                safeThumbnail: 'asset://safe.webp',
                thumbnailIsSensitive: true,
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'static-1',
                    name: 'Static One',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    count: 3,
                    imageIds: []
                }],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshCollectionThumbnails();

        expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'static-1' })
        ]);
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            count: 3,
            thumbnail: 'asset://thumb.webp',
            safeThumbnail: 'asset://safe.webp',
            thumbnailIsSensitive: true,
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('skips cached dynamic collection thumbnails during refresh', async () => {
        act(() => {
            useCollectionStore.setState({
                collections: [
                    makeStaticCollection({
                        id: 'cached-static',
                        count: 4,
                        thumbnail: 'asset://cached.webp',
                        safeThumbnail: 'asset://cached-safe.webp',
                        thumbnailIsSensitive: true,
                        thumbnailSourceKind: 'dynamic'
                    })
                ],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshCollectionThumbnails();

        expect(mockGetCollectionThumbnailSummaries).not.toHaveBeenCalled();
        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({});
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            thumbnail: 'asset://cached.webp',
            safeThumbnail: 'asset://cached-safe.webp',
            thumbnailIsSensitive: true,
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('can force refresh cached dynamic thumbnails after thumbnail mutations', async () => {
        mockGetCollectionThumbnailSummaries.mockResolvedValue({
            'cached-static': {
                thumbnail: 'asset://fresh.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [
                    makeStaticCollection({
                        id: 'cached-static',
                        count: 4,
                        thumbnail: 'asset://cached.webp',
                        thumbnailSourceKind: 'dynamic'
                    })
                ],
                isLoaded: true
            });
        });

        const refreshPromise = useCollectionStore.getState().refreshCollectionThumbnails(false, true);

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({
            'cached-static': true
        });
        await refreshPromise;

        expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'cached-static' })
        ]);
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            thumbnail: 'asset://fresh.webp',
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('refreshes custom thumbnails even when a display thumbnail already exists', async () => {
        mockGetCollectionThumbnailSummaries.mockResolvedValue({
            'custom-static': {
                thumbnail: 'asset://custom-fresh.webp',
                thumbnailSourceKind: 'customImage'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [
                    makeStaticCollection({
                        id: 'custom-static',
                        count: 0,
                        customThumbnail: 'img-custom',
                        thumbnail: 'asset://custom-stale.webp',
                        thumbnailSourceKind: 'customImage'
                    })
                ],
                isLoaded: true
            });
        });

        const refreshPromise = useCollectionStore.getState().refreshCollectionThumbnails();

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({
            'custom-static': true
        });
        await refreshPromise;

        expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'custom-static', customThumbnail: 'img-custom' })
        ]);
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            thumbnail: 'asset://custom-fresh.webp',
            thumbnailSourceKind: 'customImage'
        }));
    });

    it('hydrates Invoke board collection thumbnails from derived summaries', async () => {
        mockGetCollectionThumbnailSummaries.mockResolvedValue({
            'invoke-board-1': {
                thumbnail: 'asset://invoke-board-thumb.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });

        act(() => {
            useCollectionStore.setState({
                collections: [makeStaticCollection({
                    id: 'invoke-board-1',
                    name: 'Invoke Board',
                    source: 'invoke',
                    count: 2
                })],
                isLoaded: true
            });
        });

        const refreshPromise = useCollectionStore.getState().refreshCollectionThumbnails();

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({
            'invoke-board-1': true
        });
        await refreshPromise;

        expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'invoke-board-1', source: 'invoke' })
        ]);
        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            thumbnail: 'asset://invoke-board-thumb.webp',
            thumbnailSourceKind: 'dynamic'
        }));
    });

    it('marks thumbnail hydration pending ids while collection thumbnails are loading', async () => {
        let resolveSummaries: ((value: Record<string, unknown>) => void) | undefined;
        mockGetCollectionThumbnailSummaries.mockImplementationOnce(() => new Promise(resolve => {
            resolveSummaries = resolve;
        }));

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'static-1',
                    name: 'Static One',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    count: 3,
                    imageIds: []
                }],
                isLoaded: true
            });
        });

        const refreshPromise = useCollectionStore.getState().refreshCollectionThumbnails();

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({
            'static-1': true
        });
        await waitFor(() => expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(1));

        resolveSummaries?.({
            'static-1': {
                thumbnail: 'asset://thumb.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });
        await refreshPromise;

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({});
    });

    it('does not mark empty collections as thumbnail hydration pending', async () => {
        let resolveSummaries: ((value: Record<string, unknown>) => void) | undefined;
        mockGetCollectionThumbnailSummaries.mockImplementationOnce(() => new Promise(resolve => {
            resolveSummaries = resolve;
        }));

        act(() => {
            useCollectionStore.setState({
                collections: [
                    {
                        id: 'empty-static',
                        name: 'Empty Static',
                        createdAt: 1,
                        updatedAt: 1,
                        source: 'ambit',
                        count: 0,
                        imageIds: []
                    },
                    {
                        id: 'filled-static',
                        name: 'Filled Static',
                        createdAt: 2,
                        updatedAt: 2,
                        source: 'ambit',
                        count: 1,
                        imageIds: []
                    },
                    {
                        id: 'cached-static',
                        name: 'Cached Static',
                        createdAt: 3,
                        updatedAt: 3,
                        source: 'ambit',
                        count: 1,
                        imageIds: [],
                        thumbnail: 'asset://cached.webp',
                        thumbnailSourceKind: 'dynamic'
                    }
                ],
                isLoaded: true
            });
        });

        const refreshPromise = useCollectionStore.getState().refreshCollectionThumbnails();

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({
            'filled-static': true
        });
        await waitFor(() => expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(1));

        resolveSummaries?.({});
        await refreshPromise;
    });

    it('hydrates pinned and recent collection thumbnails first', async () => {
        mockGetCollectionThumbnailSummaries.mockResolvedValue({});

        act(() => {
            useCollectionStore.setState({
                collections: [
                    {
                        id: 'old-static',
                        name: 'Old Static',
                        createdAt: 1,
                        updatedAt: 1,
                        source: 'ambit',
                        count: 1,
                        imageIds: []
                    },
                    {
                        id: 'pinned-static',
                        name: 'Pinned Static',
                        createdAt: 2,
                        updatedAt: 2,
                        source: 'ambit',
                        count: 1,
                        imageIds: [],
                        isPinned: true
                    },
                    {
                        id: 'recent-static',
                        name: 'Recent Static',
                        createdAt: 3,
                        updatedAt: 5,
                        source: 'ambit',
                        count: 1,
                        imageIds: []
                    }
                ],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshCollectionThumbnails();

        const [firstBatch] = mockGetCollectionThumbnailSummaries.mock.calls[0] as [Array<{ id: string }>];
        expect(firstBatch.map(collection => collection.id)).toEqual([
            'pinned-static',
            'recent-static',
            'old-static'
        ]);
    });

    it('chunks collection thumbnail refreshes and skips smart collections', async () => {
        mockGetCollectionThumbnailSummaries.mockImplementation(async (batch: Array<{ id: string }>) => Object.fromEntries(
            batch.map((collection: { id: string }) => [collection.id, {
                thumbnail: `asset://${collection.id}.webp`,
                thumbnailSourceKind: 'dynamic'
            }])
        ));

        act(() => {
            useCollectionStore.setState({
                collections: [
                    ...Array.from({ length: 50 }, (_, index) => ({
                        id: `static-${index}`,
                        name: `Static ${index}`,
                        createdAt: index,
                        updatedAt: index,
                        source: 'ambit' as const,
                        count: 1,
                        imageIds: []
                    })),
                    {
                        id: 'smart-1',
                        name: 'Smart One',
                        createdAt: 100,
                        updatedAt: 100,
                        source: 'ambit',
                        count: 0,
                        imageIds: [],
                        filters: createDefaultFilters({ dateRange: 'today' })
                    }
                ],
                isLoaded: true
            });
        });

        await useCollectionStore.getState().refreshCollectionThumbnails();

        expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(2);
        const calls = mockGetCollectionThumbnailSummaries.mock.calls.map(([batch]) => batch);
        expect(calls[0]).toHaveLength(48);
        expect(calls[1]).toHaveLength(2);
        expect(calls.flat().some((collection: { id: string }) => collection.id === 'smart-1')).toBe(false);
    });

    it('does not apply stale thumbnail refresh results after a newer run starts', async () => {
        let resolveFirst: ((value: Record<string, unknown>) => void) | undefined;
        mockGetCollectionThumbnailSummaries
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce({
                'static-1': {
                    thumbnail: 'asset://fresh.webp',
                    thumbnailSourceKind: 'dynamic'
                }
            });

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'static-1',
                    name: 'Static One',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    count: 3,
                    imageIds: []
                }],
                isLoaded: true
            });
        });

        const staleRun = useCollectionStore.getState().refreshCollectionThumbnails();
        await waitFor(() => expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(1));
        const freshRun = useCollectionStore.getState().refreshCollectionThumbnails();
        await waitFor(() => expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(2));

        await freshRun;
        resolveFirst?.({
            'static-1': {
                thumbnail: 'asset://stale.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });
        await staleRun;

        expect(useCollectionStore.getState().collections[0]).toEqual(expect.objectContaining({
            thumbnail: 'asset://fresh.webp'
        }));
    });

    it('does not clear newer pending thumbnail state from stale refreshes', async () => {
        let resolveFirst: ((value: Record<string, unknown>) => void) | undefined;
        let resolveSecond: ((value: Record<string, unknown>) => void) | undefined;
        mockGetCollectionThumbnailSummaries
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveFirst = resolve;
            }))
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveSecond = resolve;
            }));

        act(() => {
            useCollectionStore.setState({
                collections: [{
                    id: 'static-1',
                    name: 'Static One',
                    createdAt: 1,
                    updatedAt: 1,
                    source: 'ambit',
                    count: 3,
                    imageIds: []
                }],
                isLoaded: true
            });
        });

        const staleRun = useCollectionStore.getState().refreshCollectionThumbnails();
        await waitFor(() => expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(1));
        const freshRun = useCollectionStore.getState().refreshCollectionThumbnails();
        await waitFor(() => expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(2));

        resolveFirst?.({
            'static-1': {
                thumbnail: 'asset://stale.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });
        await staleRun;

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({
            'static-1': true
        });

        resolveSecond?.({
            'static-1': {
                thumbnail: 'asset://fresh.webp',
                thumbnailSourceKind: 'dynamic'
            }
        });
        await freshRun;

        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({});
    });

    it('reports collection refresh failures without replacing current rows', async () => {
        const error = new Error('refresh failed');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetAllCollectionsWithStats.mockRejectedValueOnce(error);
        useCollectionStore.setState({ collections: [makeStaticCollection()] });

        await useCollectionStore.getState().refreshCollections();

        expect(useCollectionStore.getState().collections).toHaveLength(1);
        expect(consoleError).toHaveBeenCalledWith('[CollectionStore] Failed to refresh collections', error);
        consoleError.mockRestore();
    });

    it('replaces an earlier debounced collection refresh timer', async () => {
        vi.useFakeTimers();
        try {
            const first = useCollectionStore.getState().refreshCollections(true);
            const second = useCollectionStore.getState().refreshCollections(true);
            await vi.runAllTimersAsync();
            await second;
            expect(mockGetAllCollectionsWithStats).toHaveBeenCalledOnce();
            void first;
        } finally {
            vi.useRealTimers();
        }
    });

    it('replaces an earlier debounced thumbnail refresh and handles failures', async () => {
        vi.useFakeTimers();
        try {
            useCollectionStore.setState({ collections: [makeStaticCollection({ count: 1 })] });
            const first = useCollectionStore.getState().refreshCollectionThumbnails(true);
            const second = useCollectionStore.getState().refreshCollectionThumbnails(true);
            await vi.runAllTimersAsync();
            await second;
            expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledOnce();
            void first;
        } finally {
            vi.useRealTimers();
        }

        const error = new Error('thumbnail failed');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetCollectionThumbnailSummaries.mockRejectedValueOnce(error);
        await useCollectionStore.getState().refreshCollectionThumbnails();
        expect(useCollectionStore.getState().thumbnailHydrationPendingIds).toEqual({});
        expect(consoleError).toHaveBeenCalledWith('[CollectionStore] Failed to refresh collection thumbnails', error);
        consoleError.mockRestore();
    });

    it('clears pending smart summaries when refresh fails or returns no summary', async () => {
        const smart = makeStaticCollection({
            id: 'smart',
            filters: createDefaultFilters({ dateRange: 'today' })
        });
        useCollectionStore.setState({ collections: [smart] });
        await useCollectionStore.getState().refreshSmartCounts({ markPending: true });
        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});

        const error = new Error('smart failed');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetSmartCollectionSummaries.mockRejectedValueOnce(error);
        await useCollectionStore.getState().refreshSmartCounts({ markPending: true });
        expect(useCollectionStore.getState().smartSummaryPendingIds).toEqual({});
        expect(consoleError).toHaveBeenCalledWith('[CollectionStore] Failed to refresh smart counts', error);
        consoleError.mockRestore();
    });

    it('migrates legacy regular and smart collections during fresh initialization', async () => {
        vi.resetModules();
        const { useCollectionStore: freshStore } = await import('../collectionStore');
        const regular = makeStaticCollection({ id: 'legacy', imageIds: ['one'] });
        const regularWithoutImageIds = { ...makeStaticCollection({ id: 'legacy-empty' }), imageIds: undefined } as unknown as Collection;
        const smart = { ...makeStaticCollection({ id: 'smart' }), filters: createDefaultFilters() };
        mockGetAllCollectionsWithStats
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([regular, regularWithoutImageIds, smart]);
        appRepositoryMocks.mockLoad.mockResolvedValueOnce({ collections: [regular, regularWithoutImageIds], smartCollections: [smart] });

        await freshStore.getState().initialize();

        expect(collectionRepoMocks.mockUpsertCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'legacy', source: 'ambit' }));
        expect(collectionRepoMocks.mockUpsertCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 'smart', source: 'ambit' }));
        expect(collectionRepoMocks.mockAddImagesToCollection).toHaveBeenCalledWith('legacy', ['one']);
        expect(freshStore.getState().isLoaded).toBe(true);
        expect(freshStore.getState().collections).toEqual([regular, regularWithoutImageIds, smart]);
    });

    it('skips empty migration data and removes only empty legacy mock collections', async () => {
        vi.resetModules();
        const { useCollectionStore: freshStore } = await import('../collectionStore');
        const emptyLegacy = makeStaticCollection({ id: 'c1', name: 'Empty Legacy' });
        const usedLegacy = makeStaticCollection({ id: 'c2', name: 'Used Legacy' });
        const normal = makeStaticCollection({ id: 'normal', name: 'Normal' });
        mockGetAllCollectionsWithStats
            .mockResolvedValueOnce([emptyLegacy, usedLegacy, normal])
            .mockResolvedValueOnce([usedLegacy, normal]);
        collectionRepoMocks.mockGetCollectionImageIds
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(['image']);

        await freshStore.getState().initialize();

        expect(appRepositoryMocks.mockLoad).not.toHaveBeenCalled();
        expect(collectionRepoMocks.mockDeleteCollectionFromDb).toHaveBeenCalledWith('c1');
        expect(collectionRepoMocks.mockDeleteCollectionFromDb).not.toHaveBeenCalledWith('c2');
        expect(freshStore.getState().collections).toEqual([usedLegacy, normal]);
        await freshStore.getState().initialize();
        expect(collectionRepoMocks.mockEnsureCollectionSchema).toHaveBeenCalledOnce();
    });

    it('marks initialization loaded when schema setup fails', async () => {
        vi.resetModules();
        const { useCollectionStore: freshStore } = await import('../collectionStore');
        const error = new Error('schema failed');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        collectionRepoMocks.mockEnsureCollectionSchema.mockRejectedValueOnce(error);

        await freshStore.getState().initialize();

        expect(freshStore.getState().isLoaded).toBe(true);
        expect(consoleError).toHaveBeenCalledWith('[CollectionStore] Failed to initialize', error);
        consoleError.mockRestore();
    });

    it('uses image ids and created time when cached collection stats are absent', async () => {
        useCollectionStore.setState({
            collections: [
                makeStaticCollection({ id: 'older', count: undefined, imageIds: ['one'], updatedAt: 0, createdAt: 1 }),
                makeStaticCollection({ id: 'newer', count: undefined, imageIds: ['one'], updatedAt: 0, createdAt: 2 })
            ]
        });
        await useCollectionStore.getState().refreshCollectionThumbnails();
        const [batch] = mockGetCollectionThumbnailSummaries.mock.calls[0] as [Collection[]];
        expect(batch.map(collection => collection.id)).toEqual(['newer', 'older']);
    });

    it('stops an older thumbnail run before its next chunk begins', async () => {
        vi.useFakeTimers();
        try {
            useCollectionStore.setState({
                collections: Array.from({ length: 49 }, (_, index) => makeStaticCollection({ id: `item-${index}`, count: 1 }))
            });
            mockGetCollectionThumbnailSummaries.mockResolvedValue({});
            const stale = useCollectionStore.getState().refreshCollectionThumbnails();
            expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledOnce();
            await Promise.resolve();
            await Promise.resolve();
            const fresh = useCollectionStore.getState().refreshCollectionThumbnails();
            await vi.runAllTimersAsync();
            await Promise.all([stale, fresh]);
            expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not let stale thumbnail and smart-count failures clear newer state', async () => {
        const thumbnailFailure = createDeferred<Record<string, unknown>>();
        mockGetCollectionThumbnailSummaries
            .mockReturnValueOnce(thumbnailFailure.promise)
            .mockResolvedValueOnce({});
        useCollectionStore.setState({ collections: [makeStaticCollection({ count: 1 })] });
        const staleThumbnail = useCollectionStore.getState().refreshCollectionThumbnails();
        await waitFor(() => expect(mockGetCollectionThumbnailSummaries).toHaveBeenCalledOnce());
        const freshThumbnail = useCollectionStore.getState().refreshCollectionThumbnails();
        thumbnailFailure.reject(new Error('stale thumbnail'));
        await Promise.all([staleThumbnail, freshThumbnail]);

        const smartFailure = createDeferred<Record<string, unknown>>();
        mockGetSmartCollectionSummaries
            .mockReturnValueOnce(smartFailure.promise)
            .mockResolvedValueOnce({});
        useCollectionStore.setState({ collections: [makeStaticCollection({ id: 'smart', filters: createDefaultFilters({ dateRange: 'today' }) })] });
        const staleSmart = useCollectionStore.getState().refreshSmartCounts({ markPending: true });
        await waitFor(() => expect(mockGetSmartCollectionSummaries).toHaveBeenCalledOnce());
        const freshSmart = useCollectionStore.getState().refreshSmartCounts();
        smartFailure.reject(new Error('stale smart'));
        await Promise.all([staleSmart, freshSmart]);
    });

    it('covers non-pending import skips, empty smart sets, and direct collection setters', async () => {
        libraryStoreMocks.isImporting = true;
        await useCollectionStore.getState().refreshSmartCounts();
        libraryStoreMocks.isImporting = false;
        await useCollectionStore.getState().refreshSmartCounts();
        useCollectionStore.getState().setCollections([makeStaticCollection({ id: 'direct' })]);
        expect(useCollectionStore.getState().collections[0].id).toBe('direct');
    });

    it('supersedes delayed smart refreshes before their loop starts', async () => {
        vi.useFakeTimers();
        try {
            useCollectionStore.setState({ collections: [makeStaticCollection({ id: 'smart', filters: createDefaultFilters({ dateRange: 'today' }) })] });
            const stale = useCollectionStore.getState().refreshSmartCounts({ delayMs: 50 });
            const fresh = useCollectionStore.getState().refreshSmartCounts();
            await vi.runAllTimersAsync();
            await Promise.all([stale, fresh]);
            expect(mockGetSmartCollectionSummaries).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops an older smart refresh before its next collection begins', async () => {
        vi.useFakeTimers();
        try {
            useCollectionStore.setState({ collections: [
                makeStaticCollection({ id: 'smart-one', filters: createDefaultFilters({ dateRange: 'today' }) }),
                makeStaticCollection({ id: 'smart-two', filters: createDefaultFilters({ dateRange: 'week' }) })
            ] });
            mockGetSmartCollectionSummaries.mockResolvedValue({});
            const stale = useCollectionStore.getState().refreshSmartCounts();
            expect(mockGetSmartCollectionSummaries).toHaveBeenCalledOnce();
            await Promise.resolve();
            await Promise.resolve();
            const fresh = useCollectionStore.getState().refreshSmartCounts();
            await vi.runAllTimersAsync();
            await Promise.all([stale, fresh]);
            expect(mockGetSmartCollectionSummaries).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('handles empty legacy migration data and migration failures', async () => {
        vi.resetModules();
        let module = await import('../collectionStore');
        mockGetAllCollectionsWithStats.mockResolvedValue([]);
        appRepositoryMocks.mockLoad.mockResolvedValueOnce({});
        await module.useCollectionStore.getState().initialize();
        expect(appRepositoryMocks.mockLoad).toHaveBeenCalled();

        vi.resetModules();
        module = await import('../collectionStore');
        const error = new Error('legacy unavailable');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        appRepositoryMocks.mockLoad.mockRejectedValueOnce(error);
        await module.useCollectionStore.getState().initialize();
        expect(consoleError).toHaveBeenCalledWith('[CollectionStore] Migration failed', error);
        consoleError.mockRestore();
    });

    it('shares an in-flight initialization and schedules both startup smart refreshes', async () => {
        vi.resetModules();
        const { useCollectionStore: freshStore } = await import('../collectionStore');
        const schema = createDeferred<void>();
        collectionRepoMocks.mockEnsureCollectionSchema.mockReturnValueOnce(schema.promise);
        const refreshSmartCounts = vi.fn().mockResolvedValue(undefined);
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        freshStore.setState({ refreshSmartCounts, refreshCollectionThumbnails });

        const first = freshStore.getState().initialize();
        const second = freshStore.getState().initialize();
        schema.resolve();
        await Promise.all([first, second]);
        expect(collectionRepoMocks.mockEnsureCollectionSchema).toHaveBeenCalledOnce();
        await waitFor(() => expect(refreshSmartCounts).toHaveBeenCalledTimes(2));
        expect(refreshCollectionThumbnails).toHaveBeenCalledOnce();
    });
});
