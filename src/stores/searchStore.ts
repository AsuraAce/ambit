import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { AIImage, FilterState, SortOption } from '../types';

interface SearchState {
    // Data
    images: AIImage[];

    // UI State
    // Note: isFiltering, facets, stats, totals are now managed by React Query in SearchContext
    // We only keep 'images' here as a sync target for performant access in non-context components if needed,
    // although most should migrate to useSearch context.

    // Filters & Config
    filters: FilterState;
    sortOption: SortOption;
    recentSearches: string[];

    // Actions
    setImages: (images: AIImage[] | ((prev: AIImage[]) => AIImage[])) => void;
    setRecentSearches: (searches: string[] | ((prev: string[]) => string[])) => void;
    setFilters: (filters: Partial<FilterState> | ((prev: FilterState) => Partial<FilterState>)) => void;
    setSortOption: (option: SortOption) => void;
    clearAllFilters: () => void;

    // Legacy / Convenience Actions (Updates Store + DB)
    toggleFavorite: (id: string) => Promise<void>;
    togglePin: (id: string) => Promise<void>;

    // Deprecated but kept to prevent breakages during hot-reload if components call them.
    // In strict build, we could remove them.
    fetchData: (isLoadMore?: boolean, collectionsDependency?: any[]) => Promise<void>;
}

const INITIAL_FILTERS: FilterState = {
    searchQuery: '',
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
    collectionId: null,
    showIntermediates: false,
    showGrids: false
};


export const useSearchStore = create<SearchState>()(
    devtools(
        (set, get) => ({
            images: [],
            filters: INITIAL_FILTERS,
            sortOption: 'date_desc',
            recentSearches: [],

            setImages: (update) => {
                if (typeof update === 'function') {
                    set((state) => ({ images: update(state.images) }));
                } else {
                    set({ images: update });
                }
            },

            setRecentSearches: (update) => {
                if (typeof update === 'function') {
                    set((state) => ({ recentSearches: update(state.recentSearches) }));
                } else {
                    set({ recentSearches: update });
                }
            },

            setFilters: (update) => {
                set((state) => ({
                    filters: typeof update === 'function' ? { ...state.filters, ...update(state.filters) } : { ...state.filters, ...update }
                }));
            },

            setSortOption: (sortOption) => {
                set({ sortOption });
            },

            clearAllFilters: () => {
                set({ filters: INITIAL_FILTERS });
            },

            fetchData: async () => {
                // No-op: Data fetching is now handled by React Query in SearchContext
            },

            toggleFavorite: async (id) => {
                const state = get();
                const img = state.images.find(i => i.id === id);
                if (!img) return;
                const newVal = !img.isFavorite;

                // Optimistic update
                const newImages = state.images.map(i => i.id === id ? { ...i, isFavorite: newVal } : i);
                set({ images: newImages });

                try {
                    const { updateFavorite } = await import('../services/db/imageRepo');
                    await updateFavorite(id, newVal);
                } catch (e) {
                    console.error("Toggle favorite failed", e);
                    set({ images: state.images }); // Revert
                }
            },

            togglePin: async (id: string) => {
                const state = get();
                const img = state.images.find(i => i.id === id);
                if (!img) return;
                const newVal = !img.isPinned;

                const newImages = state.images.map(i => i.id === id ? { ...i, isPinned: newVal } : i);
                set({ images: newImages });

                try {
                    const { updatePinned } = await import('../services/db/imageRepo');
                    await updatePinned(id, newVal);
                } catch (e) {
                    console.error("Toggle pin failed", e);
                    set({ images: state.images });
                }
            }
        }),
        { name: 'SearchStore' }
    )
);
