import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, useRef, ReactNode } from 'react';
import { AIImage, FilterState, SortOption } from '../types';
import { useSettings } from './SettingsContext';
import { useCollections } from './CollectionContext';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { appRepository } from '../services/repository';

import { Facets } from '../services/db/searchRepo';

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

    const [images, setImages] = useState<AIImage[]>([]);
    const [filters, setFilters] = useState<FilterState>({
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
    });
    const [availableHiddenContent, setAvailableHiddenContent] = useState({ hasIntermediates: false, hasGrids: false });
    const [sortOption, setSortOption] = useState<SortOption>('date_desc');
    const [recentSearches, setRecentSearches] = useState<string[]>([]);

    const [facets, setFacets] = useState<Facets>({ checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [] });
    const [isFacetsLoading, setIsFacetsLoading] = useState(false);
    const [stats, setStats] = useState<LibraryStats>({
        totalImages: 0,
        totalGenerations: 0,
        avgSteps: 0,
        estSizeMB: '0',
        modelStats: [],
        keywordStats: []
    });

    const [totalImages, setTotalImages] = useState(0);
    const [globalTotal, setGlobalTotal] = useState(0);
    const [hasMoreImages, setHasMoreImages] = useState(true);
    const [isFiltering, setIsFiltering] = useState(true);
    const [sqlQuery, setSqlQuery] = useState<{ where: string; params: any[] }>({ where: '', params: [] });

    // Transient state moved to useLibraryStore
    // isImporting, importProgress, etc. removed from here.

    const refreshHiddenAvailability = useCallback(async () => {
        const { checkHiddenContentAvailability } = await import('../services/db/imageRepo');
        const availability = await checkHiddenContentAvailability();
        setAvailableHiddenContent(availability);
    }, []);

    const isFetchingRef = useRef(false);
    const imagesRef = useRef<AIImage[]>(images);
    const prevCollectionIdRef = useRef<string | null>(null);
    const prevSearchQueryRef = useRef<string>('');
    const prevWhereRef = useRef<string>('');
    const isInitialLoadRef = useRef(true);
    const sqlQueryRef = useRef(sqlQuery);

    useEffect(() => { imagesRef.current = images; }, [images]);
    useEffect(() => {
        sqlQueryRef.current = sqlQuery;
    }, [sqlQuery]);

    const fetchDataRef = useRef<(isLoadMore: boolean) => Promise<void>>(() => Promise.resolve());

    const PAGE_SIZE = 1000;

    const refreshMetadata = useCallback(async () => {
        try {
            setIsFacetsLoading(true);
            const { where, params } = sqlQueryRef.current;
            const { getFacets, getLibraryStats } = await import('../services/db/searchRepo');
            // Only load primary facets initially (checkpoints, loras, tools)
            const [newFacets, newStats] = await Promise.all([
                getFacets(where || 'WHERE is_deleted = 0', params, ['checkpoints', 'loras', 'tools']),
                getLibraryStats(where || 'WHERE is_deleted = 0', params)
            ]);
            setFacets(prev => ({ ...prev, ...newFacets }));
            setStats(newStats);
            await Promise.all([
                refreshCollections(),
                refreshHiddenAvailability()
            ]);
        } catch (e) {
            console.error("Failed to refresh metadata", e);
        } finally {
            setIsFacetsLoading(false);
        }
    }, [refreshCollections, refreshHiddenAvailability]);

    // Load a specific facet type on demand (for lazy loading collapsed sections)
    const loadFacet = useCallback(async (type: 'embeddings' | 'hypernetworks') => {
        try {
            const { where, params } = sqlQueryRef.current;
            const { getFacets } = await import('../services/db/searchRepo');
            const partialFacets = await getFacets(where || 'WHERE is_deleted = 0', params, [type]);
            setFacets(prev => ({ ...prev, [type]: partialFacets[type] }));
        } catch (e) {
            console.error(`Failed to load ${type} facet`, e);
        }
    }, []);

    // Internal debounced metadata refresh to avoid thread locks during search
    const metadataTimerRef = useRef<any>(null);
    const debouncedRefreshMetadata = useCallback((immediate = false) => {
        if (metadataTimerRef.current) clearTimeout(metadataTimerRef.current);
        if (immediate) {
            refreshMetadata();
        } else {
            metadataTimerRef.current = setTimeout(() => {
                refreshMetadata();
            }, 800); // 800ms debounce for "heavy" stats
        }
    }, [refreshMetadata]);

    const fetchData = useCallback(async (isLoadMore: boolean) => {
        if (isFetchingRef.current && (isLoadMore || isInitialLoadRef.current)) return;
        isFetchingRef.current = true;
        if (!isLoadMore) setIsFiltering(true);

        const { where, params } = sqlQueryRef.current;

        try {
            const { searchImages, countImages } = await import('../services/db/searchRepo');

            let sortField = 'timestamp';
            let sortOrder: 'ASC' | 'DESC' = 'DESC';

            switch (sortOption) {
                case 'date_asc': sortField = 'timestamp'; sortOrder = 'ASC'; break;
                case 'name_asc': sortField = 'path'; sortOrder = 'ASC'; break;
                case 'name_desc': sortField = 'path'; sortOrder = 'DESC'; break;
                case 'size_desc': sortField = 'file_size'; sortOrder = 'DESC'; break;
                case 'size_asc': sortField = 'file_size'; sortOrder = 'ASC'; break;
                case 'date_desc': default: sortField = 'timestamp'; sortOrder = 'DESC'; break;
            }

            const prioritizePinned = filters.collectionId !== null;

            if (!isLoadMore) {
                const [count, newBatch, globalCount] = await Promise.all([
                    countImages(where, params),
                    searchImages(where, params, PAGE_SIZE, 0, sortField, sortOrder, prioritizePinned),
                    countImages('WHERE is_deleted = 0', [])
                ]);

                setTotalImages(count);
                setImages(newBatch);
                setGlobalTotal(globalCount);
                setHasMoreImages(newBatch.length >= PAGE_SIZE);

                // If this is the initial load OR if filters other than searchQuery were changed, refresh facets immediately
                const whereChanged = where !== prevWhereRef.current;
                const searchQueryChanged = filters.searchQuery !== prevSearchQueryRef.current;
                const isOnlySearchQueryChange = !whereChanged && searchQueryChanged;

                debouncedRefreshMetadata(!isOnlySearchQueryChange || isInitialLoadRef.current);

                prevWhereRef.current = where;
                prevSearchQueryRef.current = filters.searchQuery;
            } else {
                const offset = imagesRef.current.length;
                const newBatch = await searchImages(where, params, PAGE_SIZE, offset, sortField, sortOrder, prioritizePinned);
                setImages(prev => [...prev, ...newBatch]);
                setHasMoreImages(newBatch.length >= PAGE_SIZE);
            }
        } catch (e) {
            console.error("Failed to fetch images", e);
        } finally {
            isFetchingRef.current = false;
            setIsFiltering(false);
        }
    }, [sortOption, debouncedRefreshMetadata, filters.collectionId]);

    // Keep ref in sync
    useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

    // 1. Unified Filter & Sort Sync Effect
    useEffect(() => {
        const currentId = filters.collectionId;
        const allCols = [...collections, ...smartCollections];
        const activeSmart = smartCollections.find(c => c.id === currentId);

        // A. Sync Sort Option from Collection Preference
        if (currentId && currentId !== prevCollectionIdRef.current) {
            if (activeSmart && activeSmart.filters?.sortOption) {
                if (sortOption !== activeSmart.filters.sortOption) {
                    setSortOption(activeSmart.filters.sortOption);
                }
            }
        }
        prevCollectionIdRef.current = currentId;

        // B. Build SQL
        const { where, params } = buildSqlWhereClause(filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, allCols);

        const paramsChanged = JSON.stringify(params) !== JSON.stringify(sqlQuery.params);
        const whereChanged = where !== sqlQuery.where;

        if (whereChanged || paramsChanged) {
            setSqlQuery({ where, params });
            setHasMoreImages(true);
            setIsFiltering(true);
        }
    }, [filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections, smartCollections]);

    // 2. Main Data Fetching Effect
    useEffect(() => {
        if (isInitialLoadRef.current) return;

        const timeout = setTimeout(() => {
            fetchData(false);
        }, 10);
        return () => clearTimeout(timeout);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sqlQuery, sortOption]);

    // 3. Auto-persist sort option for smart collections
    useEffect(() => {
        if (!filters.collectionId) return;
        const activeSmart = smartCollections.find(c => c.id === filters.collectionId);
        if (!activeSmart || !activeSmart.filters || !isLoaded) return; // Wait for collections to be loaded

        if (sortOption !== activeSmart.filters.sortOption) {
            const updateSort = async () => {
                const { upsertCollection } = await import('../services/db/collectionRepo');
                await upsertCollection({
                    ...activeSmart,
                    filters: { ...activeSmart.filters, sortOption }
                });
                await refreshCollections();
            };
            updateSort();
        }
    }, [sortOption, filters.collectionId, smartCollections, refreshCollections, isLoaded]);

    // Persistence load & Global count & Hidden availability
    useEffect(() => {
        const loadInitial = async () => {
            const { countImages } = await import('../services/db/searchRepo');
            const { checkHiddenContentAvailability } = await import('../services/db/imageRepo');
            const [state, globalCount, availability] = await Promise.all([
                appRepository.load(),
                countImages('WHERE is_deleted = 0', []),
                checkHiddenContentAvailability()
            ]);

            if (state.recentSearches) setRecentSearches(state.recentSearches);
            setGlobalTotal(globalCount);
            setAvailableHiddenContent(availability);

            // Important: Sync persisted grid toggle to filter state
            if (state.settings.libraryShowGrids !== undefined || state.settings.libraryShowIntermediates !== undefined) {
                setFilters(prev => ({
                    ...prev,
                    showGrids: state.settings.libraryShowGrids !== undefined ? state.settings.libraryShowGrids : prev.showGrids,
                    showIntermediates: state.settings.libraryShowIntermediates !== undefined ? state.settings.libraryShowIntermediates : prev.showIntermediates
                }));
            }

            // Signal that initial loading and filter restoration is complete
            isInitialLoadRef.current = false;
            fetchDataRef.current(false); // Trigger the first REAL fetch
        };
        loadInitial();
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        await fetchDataRef.current(true);
    }, [hasMoreImages]);

    const clearAllFilters = useCallback(() => {
        setFilters(prev => ({
            ...prev,
            searchQuery: '',
            dateRange: 'all',
            favoritesOnly: false,
            pinnedOnly: false,
            models: [],
            tools: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            collectionId: null,
            minSteps: undefined,
            maxSteps: undefined,
            minCfg: undefined,
            maxCfg: undefined
        }));
    }, []);

    const toggleFavorite = useCallback(async (id: string) => {
        const img = imagesRef.current.find(i => i.id === id);
        if (!img) return;
        const newVal = !img.isFavorite;

        try {
            const { updateFavorite } = await import('../services/db/imageRepo');
            await updateFavorite(id, newVal);
            setImages(prev => prev.map(i => i.id === id ? { ...i, isFavorite: newVal } : i));
        } catch (e) { console.error("Toggle favorite failed", e); }
    }, []);

    const togglePin = useCallback(async (id: string, isPinned?: boolean) => {
        const img = imagesRef.current.find(i => i.id === id);
        if (!img) return;
        const newVal = isPinned !== undefined ? isPinned : !img.isPinned;

        try {
            const { updatePinned } = await import('../services/db/imageRepo');
            await updatePinned(id, newVal);
            setImages(prev => prev.map(i => i.id === id ? { ...i, isPinned: newVal } : i));
        } catch (e) { console.error("Toggle pin failed", e); }
    }, []);

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
            activeSqlWhere: sqlQuery.where,
            activeSqlParams: sqlQuery.params,
            refreshMetadata,
            fetchData,
            recentSearches,
            setRecentSearches,
            toggleFavorite,
            togglePin,
            availableHiddenContent,
            refreshHiddenAvailability,
            isFacetsLoading,
            loadFacet
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
