import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, useRef, ReactNode } from 'react';
import { AIImage, FilterState, SortOption, FacetType } from '../types';
import { useSettings } from './SettingsContext';
import { useCollections } from './CollectionContext';
import { useSearchStore } from '../stores/searchStore';
import { appRepository } from '../services/repository';

import { Facets, ValidFacetNames } from '../services/db/searchRepo';
import { useImagesQuery } from '../hooks/useImagesQuery';
import { useLibraryStatsQuery } from '../hooks/useLibraryStatsQuery';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { useQueryClient } from '@tanstack/react-query';

interface LibraryStats {
    totalImages: number;
    totalGenerations: number;
    avgSteps: number;
    estSizeMB: string;
    modelStats: any[];
    keywordStats: { text: string; value: number }[];
}

interface SearchContextType {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    sortOption: SortOption;
    setSortOption: React.Dispatch<React.SetStateAction<SortOption>>;
    facets: Facets;
    stats: LibraryStats;
    totalImages: number; // This is the MATCHING count
    globalTotal: number; // Total non-deleted images in library
    hasMoreImages: boolean;
    loadMoreImages: () => Promise<void>;
    clearAllFilters: () => void;
    isFiltering: boolean;
    activeSqlWhere: string;
    activeSqlParams: any[];
    refreshMetadata: () => Promise<void>;
    fetchData: (isLoadMore: boolean) => Promise<void>;
    recentSearches: string[];
    setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>;
    toggleFavorite: (id: string) => Promise<void>;
    togglePin: (id: string, isPinned?: boolean) => Promise<void>;

    // Transient state moved to useLibraryStore

    availableHiddenContent: { hasIntermediates: boolean; hasGrids: boolean };
    refreshHiddenAvailability: () => Promise<void>;

    isFacetsLoading: boolean;
    isLoadingMore: boolean;

    /** Valid facet names for drill-down filtering. null = show all (no active filters) */
    validFacetNames: ValidFacetNames | null;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { settings, setSettings, privacyEnabled, isLoaded: settingsLoaded } = useSettings();
    const { collections, smartCollections, refreshCollections, isLoaded: collectionsLoaded } = useCollections();



    // Zustand Store Access
    const {
        images, setImages,
        filters, setFilters,
        sortOption, setSortOption,
        // Removed deleted store properties
        clearAllFilters,
        toggleFavorite: storeToggleFavorite,
        togglePin: storeTogglePin
    } = useSearchStore();

    // React Query
    const {
        data: queryData,
        fetchNextPage,
        hasNextPage,
        isFetching,
        isFetchingNextPage,
        isLoading: isQueryLoading
    } = useImagesQuery({
        filters,
        sortOption,
        settings,
        privacyEnabled,
        allCollections: [...collections, ...smartCollections],
        settingsLoaded: settingsLoaded && collectionsLoaded
    });

    // Flatten pages into a single image array
    const queryImages = React.useMemo(() => {
        if (!queryData) return [];
        return queryData.pages.flatMap(p => p.images);
    }, [queryData]);

    // Use query data if available, otherwise fallback to store (for transitions or overrides)
    // Actually, we should sync query data TO store or just expose it directly?
    // Exposing directly is better but we have setImages...
    // Let's rely on Query Data for display.
    // BUT we need 'setImages' to work for optimistic updates (favorites/pins).
    // React Query cache can be updated via setQueryData, but setImages is simpler if we sync.
    // For now, let's allow setImages to override, OR sync Query -> Store.

    // SYNC PATTERN: When query data changes, update Store. This keeps store as "Source of Truth" for UI.
    useEffect(() => {
        if (queryData) {
            const allImgs = queryData.pages.flatMap(p => p.images);
            setImages(allImgs);
        }
    }, [queryData, setImages]);

    // Proactive prefetching: Load next page in background after current page loads
    // Only prefetch if we have less than 3 pages and user might scroll soon
    useEffect(() => {
        const currentPageCount = queryData?.pages.length ?? 0;
        if (hasNextPage && !isFetchingNextPage && currentPageCount > 0 && currentPageCount < 3) {
            const timer = setTimeout(() => {
                fetchNextPage();
            }, 500); // Increased delay to reduce load during filter changes
            return () => clearTimeout(timer);
        }
    }, [hasNextPage, isFetchingNextPage, queryData, fetchNextPage]);

    const totalImagesCount = queryData?.pages[0]?.totalCount ?? 0;
    const globalTotalCount = queryData?.pages[0]?.globalCount ?? 0;

    // Stats & Facets Query
    const {
        data: statsData,
        isLoading: isStatsLoading,
        isFetching: isStatsFetching
    } = useLibraryStatsQuery({
        filters,
        settings,
        privacyEnabled,
        allCollections: [...collections, ...smartCollections],
        settingsLoaded: settingsLoaded && collectionsLoaded
    });

    const activeFacets = statsData?.facets || { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [] };
    const activeStats = statsData?.stats || { totalImages: 0, totalGenerations: 0, avgSteps: 0, estSizeMB: '0', modelStats: [], keywordStats: [] };
    const activeValidNames = statsData?.validNames || null;

    // We still need 'activeSqlWhere' for stats compatibility
    const [activeSqlWhere, setActiveSqlWhere] = useState('');
    const [activeSqlParams, setActiveSqlParams] = useState<any[]>([]);

    // Track loaded facet types for lazy loading
    // 'tools', 'checkpoints', 'loras' are default
    // Track loaded facet types for lazy loading logic handled by facetTypes state above

    useEffect(() => {
        const { where, params } = buildSqlWhereClause(filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, [...collections, ...smartCollections]);
        setActiveSqlWhere(where);
        setActiveSqlParams(params);
    }, [filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections, smartCollections]);

    // We still need to react to filter changes to update SQL and trigger store fetch
    // But store handles fetch on explicit call.



    const queryClient = useQueryClient();

    const refreshMetadata = useCallback(async () => {
        // Invalidate queries to trigger refetch
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['images'] }),
            queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
            refreshCollections()
        ]);
    }, [queryClient, refreshCollections]);



    // Legacy support for togglePin (add to store or keep local wrapper calling repo directly?)
    const togglePin = useCallback(async (id: string, isPinned?: boolean) => {
        // ... implementation from old context, potentially update store images locally
        // For now keep old impl but update Store images?
        // Store has setImages.
        const imgs = useSearchStore.getState().images;
        const img = imgs.find(i => i.id === id);
        if (!img) return;
        const newVal = isPinned !== undefined ? isPinned : !img.isPinned;

        try {
            const { updatePinned } = await import('../services/db/imageRepo');
            await updatePinned(id, newVal);
            setImages(imgs.map(i => i.id === id ? { ...i, isPinned: newVal } : i));
        } catch (e) { console.error(e); }
    }, [setImages]);

    // ... Missing: setRecentSearches, loadFacet, availableHiddenContent
    // Store doesn't have recentSearches yet.
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [availableHiddenContent, setAvailableHiddenContent] = useState({ hasIntermediates: false, hasGrids: false });

    const refreshHiddenAvailability = useCallback(async () => {
        const { checkHiddenContentAvailability } = await import('../services/db/imageRepo');
        const availability = await checkHiddenContentAvailability();
        setAvailableHiddenContent(availability);
    }, []);

    // ...

    // Persistence hooks
    useEffect(() => {
        // ... existing persistence logic ...
        // We need to keep recentSearches sync?
    }, []);

    // ... clean up old effects ...

    // Persistence load & Global count & Hidden availability
    useEffect(() => {
        const loadInitial = async () => {
            // Note: Store handles its own initial state? 
            // Actually store defaults to empty. We need to trigger initial fetch.
            // The main effect (debounced) triggers fetch.

            const { checkHiddenContentAvailability } = await import('../services/db/imageRepo');
            const [appState, availability] = await Promise.all([
                appRepository.load(),
                checkHiddenContentAvailability()
            ]);

            if (appState.recentSearches) setRecentSearches(appState.recentSearches);
            setAvailableHiddenContent(availability);

            // Sync persisted grid toggle to store filters via setFilters
            if (appState.settings.libraryShowGrids !== undefined || appState.settings.libraryShowIntermediates !== undefined) {
                setFilters(prev => ({
                    ...prev,
                    showGrids: appState.settings.libraryShowGrids ?? prev.showGrids,
                    showIntermediates: appState.settings.libraryShowIntermediates ?? prev.showIntermediates
                }));
            }
        };
        loadInitial();
    }, []);

    // 2. Persist Grid Toggle Change to Settings
    useEffect(() => {
        if (settings.libraryShowGrids !== filters.showGrids) {
            setSettings(prev => ({ ...prev, libraryShowGrids: filters.showGrids }));
        }
    }, [filters.showGrids]);

    // 3. Persist Intermediate Toggle Change to Settings
    useEffect(() => {
        if (settings.libraryShowIntermediates !== filters.showIntermediates) {
            setSettings(prev => ({ ...prev, libraryShowIntermediates: filters.showIntermediates }));
        }
    }, [filters.showIntermediates]);

    // Persistence save
    useEffect(() => {
        const timeout = setTimeout(async () => {
            const state = await appRepository.load();
            await appRepository.save({
                ...state,
                recentSearches
            });
        }, 1000);
        return () => clearTimeout(timeout);
    }, [recentSearches]);

    // Adapter for legacy fetchData calls
    const fetchData = useCallback(async (isLoadMore: boolean) => {
        if (isLoadMore) {
            await fetchNextPage();
        } else {
            // Force refetch
            // Actually filters change triggers refetch automatically.
            // This might be used for manual refresh.
            await queryClient.invalidateQueries({ queryKey: ['images'] });
        }
    }, [fetchNextPage, queryClient]);



    return (
        <SearchContext.Provider value={{
            images,
            setImages,
            filters,
            setFilters,
            sortOption,
            setSortOption,
            facets: activeFacets,
            stats: activeStats,
            totalImages: totalImagesCount,
            globalTotal: globalTotalCount,
            hasMoreImages: !!hasNextPage,
            loadMoreImages: async () => {
                if (hasNextPage && !isFetchingNextPage) {
                    await fetchNextPage();
                }
            },
            clearAllFilters,
            isFiltering: isFetching && !isFetchingNextPage,
            activeSqlWhere,
            activeSqlParams,
            refreshMetadata,
            fetchData,
            recentSearches,
            setRecentSearches,
            toggleFavorite: storeToggleFavorite,
            togglePin: storeTogglePin,
            availableHiddenContent,
            refreshHiddenAvailability,
            isFacetsLoading: isStatsFetching,
            isLoadingMore: isFetchingNextPage,
            validFacetNames: activeValidNames,

        }}>
            {children}
        </SearchContext.Provider>
    );
};

export const useSearch = () => {
    const context = useContext(SearchContext);
    if (!context) throw new Error('useSearch must be used within SearchProvider');
    return context;
};
