import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCollectionStore } from '../collectionStore';
import { FilterState } from '../../types';

const mockGetSmartCollectionCounts = vi.fn();

vi.mock('../libraryStore', () => ({
    useLibraryStore: {
        getState: () => ({
            isImporting: false
        })
    }
}));

vi.mock('../../services/db/collectionRepo', () => ({
    getSmartCollectionCounts: mockGetSmartCollectionCounts
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
        mockGetSmartCollectionCounts.mockResolvedValue({ 'smart-1': 42 });

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
});
