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
    recentSearches: string[];

    // Actions
    setImages: (images: AIImage[] | ((prev: AIImage[]) => AIImage[])) => void;
    setRecentSearches: (searches: string[] | ((prev: string[]) => string[])) => void;
    setFilters: (filters: Partial<FilterState> | ((prev: FilterState) => Partial<FilterState>)) => void;
    setSortOption: (option: SortOption) => void;

    // Async Actions
    fetchData: (isLoadMore?: boolean, collectionsDependency?: any[]) => Promise<void>;
    refreshMetadata: (where?: string, params?: any[]) => Promise<void>;
    clearAllFilters: () => void;
    toggleFavorite: (id: string) => Promise<void>;
    togglePin: (id: string) => Promise<void>;

    // Internals for Race Condition Handling
    fetchRequestId: number;
    metadataRequestId: number;
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
            recentSearches: [],

            fetchRequestId: 0,
            metadataRequestId: 0,

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

            fetchData: async (isLoadMore = false, collectionsDependency: any[] = []) => {
                // DEPRECATED: Handled by React Query (useImagesQuery)
                // This function is kept for signature compatibility but should effectively be a no-op 
                // or just log a warning if called unexpectedly.
                // The React Context now drives the data fetching.
            },

            refreshMetadata: async (where?: string, params?: any[]) => {
                const requestId = get().metadataRequestId + 1;
                set({ metadataRequestId: requestId });
                set({ isFacetsLoading: true });
                try {
                    const { getFacets, getLibraryStats } = await import('../services/db/searchRepo');
                    // Use provided where/params or default to "not deleted"
                    const activeWhere = where || 'WHERE is_deleted = 0';
                    const activeParams = params || [];


                    const [newFacets, newStats] = await Promise.all([
                        getFacets(activeWhere, activeParams, ['checkpoints', 'loras', 'tools']),
                        getLibraryStats(activeWhere, activeParams)
                    ]);

                    if (get().metadataRequestId !== requestId) return;

                    set((prev) => ({
                        facets: { ...prev.facets, ...newFacets },
                        stats: newStats,
                        isFacetsLoading: false
                    }));
                } catch (e) {
                    console.error("Failed to refresh metadata", e);
                    // Only reset loading if this is the active request
                    if (get().metadataRequestId === requestId) {
                        set({ isFacetsLoading: false });
                    }
                }
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
                    // Revert on failure
                    set({ images: state.images });
                }
            },

            togglePin: async (id: string) => {
                const state = get();
                const img = state.images.find(i => i.id === id);
                if (!img) return;
                const newVal = !img.isPinned;

                // Optimistic update
                const newImages = state.images.map(i => i.id === id ? { ...i, isPinned: newVal } : i);
                set({ images: newImages });

                try {
                    const { updatePinned } = await import('../services/db/imageRepo');
                    await updatePinned(id, newVal);
                } catch (e) {
                    console.error("Toggle pin failed", e);
                    // Revert on failure
                    set({ images: state.images });
                }
            }
        }),
        { name: 'SearchStore' }
    )
);
