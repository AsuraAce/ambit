import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type Collection, type SmartCollection } from '../../types';
import { CollectionProvider, useCollections } from '../CollectionContext';

const store = vi.hoisted(() => ({
    collections: [] as Collection[],
    isLoaded: true,
    refreshCollections: vi.fn(),
    refreshCollectionThumbnails: vi.fn(),
    initialize: vi.fn(),
}));

vi.mock('../../stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

const baseCollection = (id: string): Collection => ({
    id,
    name: id,
    imageIds: [],
    createdAt: 1,
    source: 'ambit',
});

describe('CollectionContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store.collections = [];
        store.isLoaded = true;
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('requires a provider', () => {
        expect(() => renderHook(() => useCollections())).toThrow('useCollections must be used within CollectionProvider');
    });

    it('initializes, partitions collections, and forwards refresh actions', async () => {
        const smart: SmartCollection = {
            ...baseCollection('smart'),
            filters: {
                searchQuery: '', models: [], tools: [GeneratorTool.UNKNOWN], loras: [], embeddings: [],
                hypernetworks: [], samplers: [], generationTypes: [], controlNets: [], ipAdapters: [],
                dateRange: 'all', favoritesOnly: false, collectionId: null,
            },
        };
        store.collections = [baseCollection('regular'), smart];
        const wrapper = ({ children }: { children: React.ReactNode }) => <CollectionProvider>{children}</CollectionProvider>;
        const { result } = renderHook(() => useCollections(), { wrapper });

        expect(store.initialize).toHaveBeenCalledOnce();
        expect(result.current.collections.map(item => item.id)).toEqual(['regular']);
        expect(result.current.smartCollections.map(item => item.id)).toEqual(['smart']);
        await act(() => result.current.refreshCollections(true));
        await act(() => result.current.refreshCollectionThumbnails(false));
        expect(store.refreshCollections).toHaveBeenCalledWith(true);
        expect(store.refreshCollectionThumbnails).toHaveBeenCalledWith(false);
    });

    it('warns when deprecated setters are called', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => <CollectionProvider>{children}</CollectionProvider>;
        const { result } = renderHook(() => useCollections(), { wrapper });
        act(() => {
            result.current.setCollections([]);
            result.current.setSmartCollections([]);
            result.current.setAllCollections([]);
        });
        expect(console.warn).toHaveBeenCalledTimes(3);
    });
});
