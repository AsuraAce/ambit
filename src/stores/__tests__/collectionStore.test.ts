import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '../collectionStore';
import { FilterState } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';

const mockGetSmartCollectionSummaries = vi.fn();
const mockGetCollectionThumbnailSummaries = vi.fn();

vi.mock('../libraryStore', () => ({
    useLibraryStore: {
        getState: () => ({
            isImporting: false
        })
    }
}));

vi.mock('../../services/db/collectionRepo', () => ({
    getSmartCollectionSummaries: mockGetSmartCollectionSummaries,
    getCollectionThumbnailSummaries: mockGetCollectionThumbnailSummaries
}));

const resetCollectionStore = () => {
    useCollectionStore.setState(useCollectionStore.getInitialState(), true);
};

describe('collectionStore smart count refresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetCollectionStore();
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
});
