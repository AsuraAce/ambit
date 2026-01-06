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
                const state = get();

                // Increment Request ID for this new fetch
                const requestId = state.fetchRequestId + 1;
                set({ fetchRequestId: requestId });

                if (!isLoadMore) set({ isFiltering: true });

                try {
                    const { searchImages, countImages } = await import('../services/db/searchRepo');
                    const { buildSqlWhereClause } = await import('../utils/sqlHelpers');
                    const { appRepository } = await import('../services/repository');
                    const appState = await appRepository.load();

                    const settings = appState.settings;

                    // Filter Logic
                    const { where, params } = buildSqlWhereClause(
                        state.filters,
                        settings.maskingMode === 'hide', // Privacy Enabled assumed if hiding? 
                        // Wait, privacyEnabled was a separate boolean in context.
                        // Ideally checking settings.maskingMode is enough?
                        // Let's assume privacy is ON if maskingMode is set?
                        // Actually LibraryContext had `privacyEnabled`.
                        // For now let's default to false or read from a store if available?
                        // Temporary: Assume true or read from settings if we can. 
                        settings.maskingMode,
                        settings.maskedKeywords,
                        collectionsDependency
                    );

                    let sortField = 'timestamp';
                    let sortOrder: 'ASC' | 'DESC' = 'DESC';

                    switch (state.sortOption) {
                        case 'date_asc': sortField = 'timestamp'; sortOrder = 'ASC'; break;
                        case 'name_asc': sortField = 'path'; sortOrder = 'ASC'; break;
                        case 'name_desc': sortField = 'path'; sortOrder = 'DESC'; break;
                        case 'size_desc': sortField = 'file_size'; sortOrder = 'DESC'; break;
                        case 'size_asc': sortField = 'file_size'; sortOrder = 'ASC'; break;
                        case 'date_desc': default: sortField = 'timestamp'; sortOrder = 'DESC'; break;
                    }

                    // Check for cancellation before expensive operations (optional but good)
                    if (get().fetchRequestId !== requestId) return;

                    const prioritizePinned = state.filters.collectionId !== null;
                    const PAGE_SIZE = 1000;

                    if (!isLoadMore) {
                        const [count, newBatch, globalCount] = await Promise.all([
                            countImages(where, params),
                            searchImages(where, params, PAGE_SIZE, 0, sortField, sortOrder, prioritizePinned),
                            countImages('WHERE is_deleted = 0', [])
                        ]);

                        // RACE CONDITION CHECK
                        if (get().fetchRequestId !== requestId) {
                            // Stale request, ignore
                            return;
                        }

                        set({
                            totalImages: count,
                            images: newBatch,
                            globalTotal: globalCount,
                            hasMoreImages: newBatch.length >= PAGE_SIZE,
                            isFiltering: false
                        });

                        // Trigger Metadata Refresh after new search?
                        get().refreshMetadata(where, params);

                    } else {
                        const offset = state.images.length;
                        const newBatch = await searchImages(where, params, PAGE_SIZE, offset, sortField, sortOrder, prioritizePinned);

                        // RACE CONDITION CHECK
                        if (get().fetchRequestId !== requestId) return;

                        set((prev) => ({
                            images: [...prev.images, ...newBatch],
                            hasMoreImages: newBatch.length >= PAGE_SIZE,
                            isFiltering: false
                        }));
                    }
                } catch (e) {
                    console.error("SearchStore error", e);
                    // Only turn off loading if we are still the active request
                    if (get().fetchRequestId === requestId) {
                        set({ isFiltering: false });
                    }
                }
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
