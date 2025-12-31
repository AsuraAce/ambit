import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, useRef, ReactNode } from 'react';
import { AIImage, FilterState, SortOption } from '../types';
import { useSettings } from './SettingsContext';
import { useCollections } from './CollectionContext';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { appRepository } from '../services/repository';

interface Facets {
    models: string[];
    loras: { name: string; count: number }[];
    tools: string[];
}

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
    isImporting: boolean;
    setIsImporting: React.Dispatch<React.SetStateAction<boolean>>;
    importProgress: { current: number; total: number; message?: string } | null;
    setImportProgress: React.Dispatch<React.SetStateAction<{ current: number; total: number; message?: string } | null>>;
    // Thumbnail Regeneration Progress
    isRegeneratingThumbnails: boolean;
    setIsRegeneratingThumbnails: React.Dispatch<React.SetStateAction<boolean>>;
    thumbnailProgress: { current: number; total: number } | null;
    setThumbnailProgress: React.Dispatch<React.SetStateAction<{ current: number; total: number } | null>>;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export const SearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { settings, privacyEnabled } = useSettings();
    const { collections, smartCollections, refreshCollections, isLoaded } = useCollections();

    const [images, setImages] = useState<AIImage[]>([]);
    const [filters, setFilters] = useState<FilterState>({
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        dateRange: 'all',
        favoritesOnly: false,
        collectionId: null,
    });
    const [sortOption, setSortOption] = useState<SortOption>('date_desc');
    const [recentSearches, setRecentSearches] = useState<string[]>([]);

    const [facets, setFacets] = useState<Facets>({ models: [], loras: [], tools: [] });
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
    const [activeSqlWhere, setActiveSqlWhere] = useState('');
    const [activeSqlParams, setActiveSqlParams] = useState<any[]>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState<{ current: number; total: number; message?: string } | null>(null);
    const [isRegeneratingThumbnails, setIsRegeneratingThumbnails] = useState(false);
    const [thumbnailProgress, setThumbnailProgress] = useState<{ current: number; total: number } | null>(null);

    const isFetchingRef = useRef(false);
    const imagesRef = useRef<AIImage[]>(images);
    const prevCollectionIdRef = useRef<string | null>(null);
    useEffect(() => { imagesRef.current = images; }, [images]);

    const PAGE_SIZE = 1000;

    const refreshMetadata = useCallback(async () => {
        try {
            // Immediate UI feedback: clear (or skip clearing) to keep look stable
            // setStats(prev => ({ ...prev, keywordStats: [] }));

            const { getFacets, getLibraryStats } = await import('../services/db/searchRepo');
            const [newFacets, newStats] = await Promise.all([
                getFacets(activeSqlWhere || 'WHERE is_deleted = 0', activeSqlParams),
                getLibraryStats(activeSqlWhere || 'WHERE is_deleted = 0', activeSqlParams)
            ]);
            setFacets(newFacets);
            setStats(newStats);
            await refreshCollections();
        } catch (e) { console.error("Failed to refresh metadata", e); }
    }, [activeSqlWhere, activeSqlParams, refreshCollections]);

    // Internal debounced metadata refresh to avoid thread locks during search
    const metadataTimerRef = useRef<any>(null);
    const debouncedRefreshMetadata = useCallback(() => {
        if (metadataTimerRef.current) clearTimeout(metadataTimerRef.current);
        metadataTimerRef.current = setTimeout(() => {
            refreshMetadata();
        }, 800); // 800ms debounce for "heavy" stats
    }, [refreshMetadata]);

    const fetchData = useCallback(async (isLoadMore: boolean) => {
        if (isFetchingRef.current && isLoadMore) return;
        isFetchingRef.current = true;
        if (!isLoadMore) setIsFiltering(true);

        const currentWhere = activeSqlWhere;
        const currentParams = activeSqlParams;

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

            // Only prioritize pinned images if we are in a specific collection (not "All Photos")
            // AND the sort option is "Date Descending" (default view) - optional refinement, but sticking to plan:
            // "True when viewing a specific Collection"
            const prioritizePinned = filters.collectionId !== null;

            if (!isLoadMore) {
                const [count, newBatch, globalCount] = await Promise.all([
                    countImages(currentWhere, currentParams),
                    searchImages(currentWhere, currentParams, PAGE_SIZE, 0, sortField, sortOrder, prioritizePinned),
                    countImages('WHERE is_deleted = 0', [])
                ]);

                setTotalImages(count);
                setImages(newBatch);
                setGlobalTotal(globalCount);
                setHasMoreImages(newBatch.length >= PAGE_SIZE);
                debouncedRefreshMetadata();
            } else {
                const offset = imagesRef.current.length;
                const newBatch = await searchImages(currentWhere, currentParams, PAGE_SIZE, offset, sortField, sortOrder, prioritizePinned);
                setImages(prev => [...prev, ...newBatch]);
                setHasMoreImages(newBatch.length >= PAGE_SIZE);
            }
        } catch (e) {
            console.error("Failed to fetch images", e);
        } finally {
            isFetchingRef.current = false;
            setIsFiltering(false);
        }
    }, [activeSqlWhere, activeSqlParams, sortOption, refreshMetadata]);

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

        const paramsChanged = JSON.stringify(params) !== JSON.stringify(activeSqlParams);
        const whereChanged = where !== activeSqlWhere;

        if (whereChanged || paramsChanged) {
            setActiveSqlWhere(where);
            setActiveSqlParams(params);

            // Reset results immediately to avoid "bleed"
            setImages([]);
            setHasMoreImages(true);
            setTotalImages(0);
            setIsFiltering(true);
        }
    }, [filters, privacyEnabled, settings.maskingMode, settings.maskedKeywords, collections, smartCollections, activeSqlWhere, activeSqlParams, sortOption]);

    // 2. Main Data Fetching Effect
    useEffect(() => {
        // Debounce fetch slightly or ensure we have stable where/params
        const timeout = setTimeout(() => {
            fetchData(false);
        }, 10);
        return () => clearTimeout(timeout);
    }, [activeSqlWhere, activeSqlParams, sortOption, fetchData]);

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

    // Persistence load & Global count
    useEffect(() => {
        const loadInitial = async () => {
            const { countImages } = await import('../services/db/searchRepo');
            const [state, globalCount] = await Promise.all([
                appRepository.load(),
                countImages('WHERE is_deleted = 0', [])
            ]);
            if (state.recentSearches) setRecentSearches(state.recentSearches);
            setGlobalTotal(globalCount);
        };
        loadInitial();
    }, []);

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
            activeSqlWhere,
            activeSqlParams,
            refreshMetadata,
            fetchData,
            recentSearches,
            setRecentSearches,
            toggleFavorite,
            togglePin,
            isImporting,
            setIsImporting,
            importProgress,
            setImportProgress,
            isRegeneratingThumbnails,
            setIsRegeneratingThumbnails,
            thumbnailProgress,
            setThumbnailProgress
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
