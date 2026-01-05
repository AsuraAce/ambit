import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { AIImage, FilterState, SortOption } from '../types';
import { Facets } from '../services/db/searchRepo';

interface LibraryStats {
    totalImages: number;
    totalGenerations: number;
    avgSteps: number;
    estSizeMB: string;
    modelStats: any[];
    keywordStats: { text: string; value: number }[];
}

interface SearchState {
    // Data
    images: AIImage[];
    totalImages: number;
    globalTotal: number;
    hasMoreImages: boolean;
    facets: Facets;
    stats: LibraryStats;

    // UI State
    isFiltering: boolean;
    isFacetsLoading: boolean;

    // Filters
    filters: FilterState;
    sortOption: SortOption;
    searchQuery: string; // Separate or inside filters? filters.searchQuery exists.

    // Actions
    setImages: (images: AIImage[]) => void;
    setFilters: (filters: Partial<FilterState> | ((prev: FilterState) => Partial<FilterState>)) => void;
    setSortOption: (option: SortOption) => void;

    // Async Actions
    fetchData: (isLoadMore?: boolean) => Promise<void>;
    refreshMetadata: () => Promise<void>;
    clearAllFilters: () => void;
    toggleFavorite: (id: string) => Promise<void>;
}

const INITIAL_FILTERS: FilterState = {
    searchQuery: '',
    models: [],
    tools: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    dateRange: 'all',
    favoritesOnly: false,
    collectionId: null,
    showIntermediates: false,
    showGrids: false
};

const INITIAL_STATS: LibraryStats = {
    totalImages: 0,
    totalGenerations: 0,
    avgSteps: 0,
    estSizeMB: '0',
    modelStats: [],
    keywordStats: []
};

export const useSearchStore = create<SearchState>()(
    devtools(
        (set, get) => ({
            images: [],
            totalImages: 0,
            globalTotal: 0,
            hasMoreImages: true,
            facets: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [] },
            stats: INITIAL_STATS,

            isFiltering: false,
            isFacetsLoading: false,

            filters: INITIAL_FILTERS,
            sortOption: 'date_desc',
            searchQuery: '',

            setImages: (images) => set({ images }),

            setFilters: (update) => {
                set((state) => {
                    const newFilters = typeof update === 'function' ? { ...state.filters, ...update(state.filters) } : { ...state.filters, ...update };
                    return { filters: newFilters };
                    // TODO: Trigger fetch? Or let subscriber handle it?
                    // Better to trigger fetch action here to avoid useEffect
                });
                get().fetchData(false);
            },

            setSortOption: (sortOption) => {
                set({ sortOption });
                get().fetchData(false);
            },

            clearAllFilters: () => {
                set({ filters: INITIAL_FILTERS });
                get().fetchData(false);
            },

            fetchData: async (isLoadMore = false) => {
                const state = get();
                if (state.isFiltering && !isLoadMore) return; // Debounce prevention?

                if (!isLoadMore) set({ isFiltering: true });

                try {
                    const { searchImages, countImages } = await import('../services/db/searchRepo');
                    const { buildSqlWhereClause } = await import('../utils/sqlHelpers');

                    // We need collections for smart collection filters...
                    // This is a dependency. We might need to pass it in or fetch it?
                    // For now, let's assume we can get it from CollectionStore (Phase 3) or pass it.
                    // THIS IS A BLOCKER: Search depends on Collections for resolving smart collection filters.

                    // Temporary: We might need to read from CollectionContext or pure DB?
                    // Ideally, useCollectionStore.getState().collections?

                } catch (e) {
                    console.error("SearchStore error", e);
                } finally {
                    set({ isFiltering: false });
                }
            },

            refreshMetadata: async () => {
                set({ isFacetsLoading: true });
                try {
                    const { getFacets, getLibraryStats } = await import('../services/db/searchRepo');
                    // logic...
                } finally {
                    set({ isFacetsLoading: false });
                }
            },

            toggleFavorite: async (id) => {
                // ...
            }
        }),
        { name: 'SearchStore' }
    )
);
