import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '../collectionStore';
import { FilterState } from '../../types';

const mockGetSmartCollectionSummaries = vi.fn();

vi.mock('../libraryStore', () => ({
    useLibraryStore: {
        getState: () => ({
            isImporting: false
        })
    }
}));

vi.mock('../../services/db/collectionRepo', () => ({
    getSmartCollectionSummaries: mockGetSmartCollectionSummaries
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
});
