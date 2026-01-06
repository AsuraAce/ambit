import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, useRef, ReactNode } from 'react';
import { AIImage, FilterState, SortOption } from '../types';
import { useSettings } from './SettingsContext';
import { useCollections } from './CollectionContext';
import { useSearchStore } from '../stores/searchStore';
import { appRepository } from '../services/repository';

import { Facets } from '../services/db/searchRepo';
import { buildSqlWhereClause } from '../utils/sqlHelpers';

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
    loadFacet: (type: 'embeddings' | 'hypernetworks') => Promise<void>;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { settings, setSettings, privacyEnabled } = useSettings();
    const { collections, smartCollections, refreshCollections, isLoaded } = useCollections();



    // Zustand Store Access
    const {
        images, setImages,
        filters, setFilters,
        sortOption, setSortOption,
        facets, isFacetsLoading,
        stats,
        totalImages, globalTotal, hasMoreImages,
        isFiltering,
        fetchData: storeFetchData,
        refreshMetadata: storeRefreshMetadata,

        clearAllFilters,
        toggleFavorite: storeToggleFavorite,
        togglePin: storeTogglePin,
        searchQuery // ??? 
    } = useSearchStore();

    // We need 'activeSqlWhere' for components that use it?
    // Actually Context expose 'activeSqlWhere' but store doesn't expose it directly yet.
    // We can compute it or ignore it if not used?
    // Let's check usages later. For now, we can compute it using same helper if needed.

    const [activeSqlWhere, setActiveSqlWhere] = useState('');
    const [activeSqlParams, setActiveSqlParams] = useState<any[]>([]);

    // We still need to react to filter changes to update SQL and trigger store fetch
    // But store handles fetch on explicit call.

    // --- Compatibility Bridge Logic ---

    // 1. When filters/collections change, trigger Store Fetch
    // We need to pass collections to store
    const collectionsRef = useRef([...collections, ...smartCollections]);
    useEffect(() => {
        collectionsRef.current = [...collections, ...smartCollections];
    }, [collections, smartCollections]);

    // Re-implement the filter effect but delegating to store
    // Optimize Fetch Logic: Only fetch if SQL params actually change or if forced
    const lastFetchRef = useRef<string>('');

    useEffect(() => {
        // Sync Sort Option from Smart Collection
        if (filters.collectionId) {
            const activeSmart = smartCollections.find(c => c.id === filters.collectionId);
            if (activeSmart && activeSmart.filters?.sortOption) {
                if (sortOption !== activeSmart.filters.sortOption) {
                    setSortOption(activeSmart.filters.sortOption);
                    return; // Return early, let next render handle fetch with new sort
                }
            }
        }

        const { where, params } = buildSqlWhereClause(filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collectionsRef.current);
        const fetchKey = JSON.stringify({ where, params, sortOption });

        // Avoid redundant fetches if query hasn't changed
        // We use a simplified check here. The store executes the actual query.
        // However, we WANT to show loading skeleton only if it's a "meaningful" change.
        // For now, let's just debounce or check equality? 
        // Actually, the Store sets isFiltering=true immediately.

        if (lastFetchRef.current !== fetchKey) {
            lastFetchRef.current = fetchKey;
            storeFetchData(false, collectionsRef.current);
        }

        setActiveSqlWhere(where);
        setActiveSqlParams(params);

    }, [filters, sortOption, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections, smartCollections]);

    // Initial Load
    useEffect(() => {
        // Store handles initial load? Or we do it here?
        // Let's let the effect above handle it since filters are set initially.
    }, []);

    const fetchData = useCallback(async (isLoadMore: boolean) => {
        await storeFetchData(isLoadMore, collectionsRef.current);
    }, [storeFetchData]);

    const refreshMetadata = useCallback(async () => {
        await storeRefreshMetadata(activeSqlWhere, activeSqlParams);
        await refreshCollections();
        // refreshHiddenAvailability handled in component consuming it or separate effect?
        // Context exposed it.
    }, [storeRefreshMetadata, activeSqlWhere, activeSqlParams, refreshCollections]);

    const toggleFavorite = storeToggleFavorite; // TODO: store needs implementation

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

    // loadFacet wrapper
    const loadFacet = useCallback(async (type: 'embeddings' | 'hypernetworks') => {
        // ... store doesn't have loadFacet yet. Can we implement it in store later?
        // For now keep local? But it updates `facets` which is in store!
        // So we MUST implement `loadFacet` in store or update store facets from here.
        // Let's update store facets manually here for now.
        try {
            const { getFacets } = await import('../services/db/searchRepo');
            const partialFacets = await getFacets(activeSqlWhere || 'WHERE is_deleted = 0', activeSqlParams, [type]);
            useSearchStore.setState(prev => ({ facets: { ...prev.facets, [type]: partialFacets[type] } }));
        } catch (e) { console.error(e); }
    }, [activeSqlWhere, activeSqlParams]);

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

    const loadMoreImages = useCallback(async () => {
        if (!hasMoreImages) return;
        await fetchData(true);
    }, [hasMoreImages, fetchData]);



    return (
        <SearchContext.Provider value={{
            images,
            setImages,
            filters,
            setFilters,
            sortOption,
            setSortOption,
            facets,
            stats,
            totalImages,
            globalTotal,
            hasMoreImages,
            loadMoreImages,
            clearAllFilters,
            isFiltering,
            activeSqlWhere,
            activeSqlParams,
            refreshMetadata,
            fetchData,
            recentSearches,
            setRecentSearches,
            toggleFavorite,
            togglePin,
            availableHiddenContent,
            refreshHiddenAvailability,
            isFacetsLoading,
            loadFacet,

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
