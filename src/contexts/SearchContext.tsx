import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, useRef, ReactNode } from 'react';
import { AIImage, AssetScope, FilterState, SortOption, FacetType, MetadataRefreshScope } from '../types';
import { useSettings } from './SettingsContext';
import { settingsPersistenceCoordinator } from '../utils/settingsPersistenceCoordinator';
import { useCollections } from './CollectionContext';
import { useSearchStore } from '../stores/searchStore';
import { appRepository } from '../services/repository';
import { getDb } from '../services/db/connection';

import { Facets, LibraryStats, ValidFacetNames } from '../services/db/searchRepo';
import {
    checkHiddenContentAvailability,
    rebuildThumbnailFacetCache,
    updateFavorite,
    updatePinned,
} from '../services/db/imageRepo';
import { clearAllCollectionThumbnailCaches } from '../services/db/collectionRepo';
import { useImagesQuery, type ImagesQueryKey } from '../hooks/useImagesQuery';
import { useLibraryStatsQuery } from '../hooks/useLibraryStatsQuery';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { useQueryClient } from '@tanstack/react-query';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { isBrowserMockMode } from '../services/runtime';
import { shouldPrefetchResultPages } from '../utils/filterState';
import { getEffectiveMaskedKeywords } from '../utils/maskingUtils';
import { useLibraryStore } from '../stores/libraryStore';
import { patchImageFlagsInQueryCaches, restoreImagesInQueryCaches } from '../utils/imageQueryCache';
import { applyOptimisticPinOrder } from '../utils/imageOptimisticUpdates';
import { useSettingsStore } from '../stores/settingsStore';
import { useCollectionStore } from '../stores/collectionStore';
import { privacyMaskRefreshCoordinator } from '../utils/privacyMaskRefreshCoordinator';

interface SearchContextType {
    images: AIImage[];
    imagesQueryKey: ImagesQueryKey;
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
    privacyExposureBlocked: boolean;
    activeSqlWhere: string;
    activeSqlParams: unknown[];
    refreshMetadata: (scope?: MetadataRefreshScope) => Promise<void>;
    fetchData: (isLoadMore: boolean, isSilent?: boolean) => Promise<void>;
    recentSearches: string[];
    setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>;
    toggleFavorite: (id: string) => Promise<void>;
    togglePin: (id: string, isPinned?: boolean) => Promise<void>;

    // Transient state moved to useLibraryStore

    availableHiddenContent: { hasIntermediates: boolean; hasGrids: boolean };
    refreshHiddenAvailability: () => Promise<void>;

    isFacetsLoading: boolean;
    isLoadingMore: boolean;
    isStatsSummaryLoading: boolean;
    isKeywordStatsLoading: boolean;

    /** Valid facet names for drill-down filtering. null = show all (no active filters) */
    validFacetNames: ValidFacetNames | null;
    assetScope: AssetScope;
    setAssetScope: React.Dispatch<React.SetStateAction<AssetScope>>;
    setFacetDrilldownActive: (active: boolean) => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

const RECENT_SEARCH_LOAD_RETRY_BASE_MS = 250;
const RECENT_SEARCH_LOAD_RETRY_MAX_MS = 4_000;
const RECENT_SEARCH_LIMIT = 8;

const applyRecentSearchMutation = (
    current: string[],
    mutation: React.SetStateAction<string[]>
): string[] => {
    const next = typeof mutation === 'function' ? mutation(current) : mutation;
    return next
        .filter((search, index, searches) => searches.indexOf(search) === index)
        .slice(0, RECENT_SEARCH_LIMIT);
};

export const SearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { settings, setSettings, privacyEnabled, isLoaded: settingsLoaded } = useSettings();
    const { collections, smartCollections, refreshCollections, isLoaded: collectionsLoaded } = useCollections();
    const queryClient = useQueryClient();
    const privacyMaskIndexStatus = useSettingsStore(state => state.privacyMaskIndexStatus);
    const privacyMaskIndexRetryToken = useSettingsStore(state => state.privacyMaskIndexRetryToken);
    const setPrivacyMaskIndexState = useSettingsStore(state => state.setPrivacyMaskIndexState);
    const refreshSmartCounts = useCollectionStore(state => state.refreshSmartCounts);



    // Zustand Store Access
    const {
        images, setImages,
        filters, setFilters,
        sortOption, setSortOption,
        // Removed deleted store properties
        clearAllFilters
    } = useSearchStore();

    const privacyMaskKeywords = React.useMemo(() => (
        getEffectiveMaskedKeywords(settings)
            .map(keyword => keyword.trim().toLowerCase())
            .filter(Boolean)
            .sort()
    ), [settings.maskedKeywords, settings.promptMaskingEnabled]);
    const privacyMaskKey = privacyMaskKeywords.join('\u001f');
    const privacyQueryScopeKey = `${privacyEnabled ? 'enabled' : 'disabled'}\u001e${settings.maskingMode}\u001e${privacyMaskKey}`;
    const [lastSyncedPrivacyScope, setLastSyncedPrivacyScope] = useState<string | null>(null);
    const requiresPrivacyMaskIndex = privacyEnabled && !isBrowserMockMode();
    const [assetScope, setAssetScope] = useState<AssetScope>('used');
    const [facetDrilldownActive, setFacetDrilldownActive] = useState(false);

    const setSortOptionDispatch = useCallback((value: React.SetStateAction<SortOption>) => {
        const nextSortOption = typeof value === 'function'
            ? value(sortOption)
            : value;
        setSortOption(nextSortOption);
    }, [setSortOption, sortOption]);

    React.useLayoutEffect(() => {
        if (!requiresPrivacyMaskIndex) {
            privacyMaskRefreshCoordinator.discardPending();
            setPrivacyMaskIndexState('ready');
            return;
        }

        if (!settingsLoaded) {
            setPrivacyMaskIndexState('pending');
            return;
        }

        let cancelled = false;
        setPrivacyMaskIndexState('pending');

        privacyMaskRefreshCoordinator.schedule(async () => {
            try {
                await getDb();
                const refreshStartedAt = performance.now();
                const result = await unwrap(commands.refreshPrivacyMaskIndex(privacyMaskKeywords));
                if (cancelled) return;

                console.info(`[Startup] Privacy mask refresh completed in ${Math.round(performance.now() - refreshStartedAt)}ms (changed: ${result.changed}, updated: ${result.updated})`);
                if (result.changed || result.updated > 0) {
                    const rebuildStartedAt = performance.now();
                    await clearAllCollectionThumbnailCaches();
                    await rebuildThumbnailFacetCache();
                    if (cancelled) return;
                    console.info(`[Startup] Thumbnail facet privacy refresh completed in ${Math.round(performance.now() - rebuildStartedAt)}ms`);
                    useLibraryStore.getState().incrementFacetCacheVersion();
                    await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['images'] }),
                        queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
                        queryClient.invalidateQueries({ queryKey: ['parameterRanges'] }),
                        refreshCollections(),
                    ]);
                }
                if (!cancelled) setPrivacyMaskIndexState('ready');
            } catch (error) {
                console.error('[Privacy] Failed to refresh privacy mask index', error);
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : String(error);
                    setPrivacyMaskIndexState('failed', message);
                }
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        privacyMaskIndexRetryToken,
        privacyMaskKey,
        privacyMaskKeywords,
        queryClient,
        refreshCollections,
        requiresPrivacyMaskIndex,
        setPrivacyMaskIndexState,
        settingsLoaded,
    ]);

    const databaseQueriesEnabled = settingsLoaded
        && collectionsLoaded
        && (!requiresPrivacyMaskIndex || privacyMaskIndexStatus === 'ready');
    const allCollections = React.useMemo(
        () => [...collections, ...smartCollections],
        [collections, smartCollections]
    );

    // React Query
    const {
        data: queryData,
        fetchNextPage,
        hasNextPage,
        isFetching,
        isFetchingNextPage,
        isLoading: isQueryLoading,
        isPlaceholderData,
        queryKey: imagesQueryKey
    } = useImagesQuery({
        filters,
        sortOption,
        settings,
        privacyEnabled,
        allCollections,
        settingsLoaded: databaseQueriesEnabled
    });
    const privacyScopeTransitionBlocked = privacyEnabled
        && lastSyncedPrivacyScope !== privacyQueryScopeKey;
    const privacyIndexBlocked = requiresPrivacyMaskIndex
        && (!settingsLoaded || privacyMaskIndexStatus !== 'ready');
    const privacyExposureBlocked = privacyIndexBlocked || privacyScopeTransitionBlocked;
    const isFirstPageFetching = isFetching && !isFetchingNextPage;

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
    React.useLayoutEffect(() => {
        if (queryData && !privacyIndexBlocked) {
            const allImgs = queryData.pages.flatMap(p => p.images);
            setImages(allImgs);
            setLastSyncedPrivacyScope(privacyQueryScopeKey);
        } else if (privacyExposureBlocked) {
            setImages([]);
        }
    }, [privacyExposureBlocked, privacyIndexBlocked, privacyQueryScopeKey, queryData, setImages]);

    // Proactive prefetching: Load next page in background after current page loads
    // Only prefetch if we have less than 3 pages and user might scroll soon
    useEffect(() => {
        const currentPageCount = queryData?.pages.length ?? 0;
        if (shouldPrefetchResultPages(filters, hasNextPage, isFetchingNextPage, currentPageCount)) {
            const timer = setTimeout(() => {
                fetchNextPage();
            }, 500); // Increased delay to reduce load during filter changes
            return () => clearTimeout(timer);
        }
    }, [filters, hasNextPage, isFetchingNextPage, queryData, fetchNextPage]);

    const totalImagesCount = privacyExposureBlocked ? 0 : queryData?.pages[0]?.totalCount ?? 0;
    const globalTotalCount = privacyExposureBlocked ? 0 : queryData?.pages[0]?.globalCount ?? 0;

    // Stats & Facets Query
    const {
        data: statsData,
        isFacetsFetching,
        isStatsSummaryLoading,
        isKeywordStatsLoading
    } = useLibraryStatsQuery({
        filters,
        settings,
        privacyEnabled,
        allCollections,
        settingsLoaded: databaseQueriesEnabled,
        assetScope,
        validFacetsEnabled: facetDrilldownActive
    });

    const activeFacets = !privacyExposureBlocked && statsData?.facets || { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [], controlNets: [], ipAdapters: [] };
    const activeStats = !privacyExposureBlocked && statsData?.stats || { totalImages: 0, totalGenerations: 0, avgSteps: 0, estSizeMB: '0', modelStats: [], keywordStats: [] };
    const activeValidNames = !privacyExposureBlocked && facetDrilldownActive ? statsData?.validNames || null : null;

    // We still need 'activeSqlWhere' for stats compatibility
    const [activeSqlWhere, setActiveSqlWhere] = useState('');
    const [activeSqlParams, setActiveSqlParams] = useState<unknown[]>([]);

    // Track loaded facet types for lazy loading
    // 'tools', 'checkpoints', 'loras' are default
    // Track loaded facet types for lazy loading logic handled by facetTypes state above

    useEffect(() => {
        if (privacyExposureBlocked) {
            setActiveSqlWhere('0 = 1');
            setActiveSqlParams([]);
            return;
        }
        const { where, params } = buildSqlWhereClause(filters, privacyEnabled, settings.maskingMode, privacyMaskKeywords, allCollections);
        setActiveSqlWhere(where);
        setActiveSqlParams(params);
    }, [filters, privacyEnabled, privacyExposureBlocked, settings.maskingMode, privacyMaskKeywords, allCollections]);

    // We still need to react to filter changes to update SQL and trigger store fetch
    // But store handles fetch on explicit call.

    const refreshMetadata = useCallback(async (scope: MetadataRefreshScope = 'full') => {
        const refreshTasks: Promise<unknown>[] = [
            queryClient.invalidateQueries({ queryKey: ['images'] })
        ];

        if (scope === 'full') {
            refreshTasks.push(
                queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
                refreshCollections()
            );
        }

        await Promise.all(refreshTasks);
    }, [queryClient, refreshCollections]);

    const refreshCollectionsAfterImageFlagChange = useCallback(() => {
        void refreshCollections(true);

        const activeCollectionId = useSearchStore.getState().filters.collectionId;
        if (!activeCollectionId) return;

        void refreshSmartCounts({
            collectionIds: [activeCollectionId],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true
        });
    }, [refreshCollections, refreshSmartCounts]);

    const toggleFavorite = useCallback(async (id: string) => {
        const imgs = useSearchStore.getState().images;
        const img = imgs.find(i => i.id === id);
        if (!img) return;
        const newVal = !img.isFavorite;

        try {
            setImages(imgs.map(i => i.id === id ? { ...i, isFavorite: newVal } : i));
            patchImageFlagsInQueryCaches(queryClient, [id], { isFavorite: newVal });
            await updateFavorite(id, newVal);
            refreshCollectionsAfterImageFlagChange();
        } catch (e) {
            console.error("Toggle favorite failed", e);
            setImages(imgs);
            restoreImagesInQueryCaches(queryClient, imgs);
        }
    }, [queryClient, refreshCollectionsAfterImageFlagChange, setImages]);

    const togglePin = useCallback(async (id: string, isPinned?: boolean) => {
        const imgs = useSearchStore.getState().images;
        const img = imgs.find(i => i.id === id);
        if (!img) return;
        const newVal = isPinned !== undefined ? isPinned : !img.isPinned;
        const nextImages = applyOptimisticPinOrder(imgs, [id], newVal, filters.collectionId !== null);

        try {
            setImages(nextImages);
            patchImageFlagsInQueryCaches(queryClient, [id], { isPinned: newVal }, {
                previousOrder: imgs,
                nextOrder: nextImages,
                reorderQueryKey: imagesQueryKey
            });
            await updatePinned(id, newVal);
            refreshCollectionsAfterImageFlagChange();
        } catch (e) {
            console.error("Toggle pin failed", e);
            setImages(imgs);
            restoreImagesInQueryCaches(queryClient, imgs, {
                previousOrder: nextImages,
                nextOrder: imgs,
                reorderQueryKey: imagesQueryKey
            });
        }
    }, [filters.collectionId, imagesQueryKey, queryClient, refreshCollectionsAfterImageFlagChange, setImages]);

    // ... Missing: setRecentSearches, loadFacet, availableHiddenContent
    // Store doesn't have recentSearches yet.
    const [recentSearches, setRecentSearchesState] = useState<string[]>([]);
    const recentSearchHydrationGenerationRef = useRef(0);
    const recentSearchesHydratedRef = useRef(false);
    const recentSearchesMountedRef = useRef(true);
    const viewSettingsHydrationTargetRef = useRef<{ showGrids: boolean; showIntermediates: boolean } | null>(null);
    const [viewSettingsHydrated, setViewSettingsHydrated] = useState(false);
    const [availableHiddenContent, setAvailableHiddenContent] = useState({ hasIntermediates: false, hasGrids: false });

    const setRecentSearches = useCallback<React.Dispatch<React.SetStateAction<string[]>>>((mutation) => {
        recentSearchHydrationGenerationRef.current += 1;
        recentSearchesHydratedRef.current = true;
        setRecentSearchesState(current => applyRecentSearchMutation(current, mutation));

        void settingsPersistenceCoordinator.run(async () => {
            const persistedState = await appRepository.update((state) => ({
                ...state,
                recentSearches: applyRecentSearchMutation(state.recentSearches ?? [], mutation)
            }));
            if (recentSearchesMountedRef.current) {
                setRecentSearchesState([...(persistedState.recentSearches ?? [])]);
            }
        }).catch(error => {
            console.error('[SearchContext] Failed to persist recent searches', error);
        });
    }, []);

    const refreshHiddenAvailability = useCallback(async () => {
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

    // Persistence load & hidden availability
    useEffect(() => {
        recentSearchesMountedRef.current = true;
        let cancelled = false;
        let retryTimeout: ReturnType<typeof setTimeout> | undefined;
        let releaseRetryDelay: (() => void) | undefined;

        const waitForRetry = (delayMs: number): Promise<void> => new Promise(resolve => {
            releaseRetryDelay = resolve;
            retryTimeout = setTimeout(() => {
                retryTimeout = undefined;
                releaseRetryDelay = undefined;
                resolve();
            }, delayMs);
        });

        const loadRecentSearches = async () => {
            let retryCount = 0;
            while (!cancelled) {
                try {
                    const hydrationGeneration = recentSearchHydrationGenerationRef.current;
                    const appState = await appRepository.load();
                    if (cancelled
                        || recentSearchesHydratedRef.current
                        || hydrationGeneration !== recentSearchHydrationGenerationRef.current) return;

                    setRecentSearchesState(appState.recentSearches ?? []);
                    recentSearchesHydratedRef.current = true;
                    return;
                } catch (error) {
                    if (cancelled) return;
                    console.error('[SearchContext] Failed to load persisted search state', error);
                    const retryDelay = Math.min(
                        RECENT_SEARCH_LOAD_RETRY_BASE_MS * (2 ** retryCount),
                        RECENT_SEARCH_LOAD_RETRY_MAX_MS
                    );
                    retryCount += 1;
                    await waitForRetry(retryDelay);
                }
            }
        };

        void loadRecentSearches();
        void checkHiddenContentAvailability()
            .then(setAvailableHiddenContent)
            .catch(error => console.error('[SearchContext] Failed to load hidden-content availability', error));

        return () => {
            cancelled = true;
            recentSearchesMountedRef.current = false;
            if (retryTimeout !== undefined) clearTimeout(retryTimeout);
            releaseRetryDelay?.();
        };
    }, []);

    // Hydrate persisted view settings before enabling the effects that write them back.
    useEffect(() => {
        if (!settingsLoaded || viewSettingsHydrated) return;

        const target = {
            showGrids: settings.libraryShowGrids ?? filters.showGrids ?? false,
            showIntermediates: settings.libraryShowIntermediates ?? filters.showIntermediates ?? false
        };
        viewSettingsHydrationTargetRef.current = target;
        setFilters(prev => ({ ...prev, ...target }));
        setViewSettingsHydrated(true);
    }, [filters.showGrids, filters.showIntermediates, settings.libraryShowGrids, settings.libraryShowIntermediates, settingsLoaded, setFilters, viewSettingsHydrated]);

    // 2. Persist Grid Toggle Change to Settings
    useEffect(() => {
        if (!viewSettingsHydrated) return;
        const hydrationTarget = viewSettingsHydrationTargetRef.current;
        if (hydrationTarget
            && (filters.showGrids !== hydrationTarget.showGrids
                || filters.showIntermediates !== hydrationTarget.showIntermediates)) return;
        viewSettingsHydrationTargetRef.current = null;
        if (settings.libraryShowGrids !== filters.showGrids) {
            setSettings({ libraryShowGrids: filters.showGrids });
        }
    }, [filters.showGrids, filters.showIntermediates, setSettings, settings.libraryShowGrids, viewSettingsHydrated]);

    // 3. Persist Intermediate Toggle Change to Settings
    useEffect(() => {
        if (!viewSettingsHydrated) return;
        const hydrationTarget = viewSettingsHydrationTargetRef.current;
        if (hydrationTarget
            && (filters.showGrids !== hydrationTarget.showGrids
                || filters.showIntermediates !== hydrationTarget.showIntermediates)) return;
        viewSettingsHydrationTargetRef.current = null;
        if (settings.libraryShowIntermediates !== filters.showIntermediates) {
            setSettings({ libraryShowIntermediates: filters.showIntermediates });
        }
    }, [filters.showGrids, filters.showIntermediates, setSettings, settings.libraryShowIntermediates, viewSettingsHydrated]);

    // Adapter for legacy fetchData calls
    const fetchData = useCallback(async (isLoadMore: boolean, isSilent: boolean = false) => {
        if (privacyExposureBlocked) return;
        if (isLoadMore) {
            await fetchNextPage();
        } else {
            // Force refetch
            // Using queryClient.invalidateQueries triggers a background refetch
            // Components using 'isFetching' will see true, but 'isLoading' stays false if data exists
            await queryClient.invalidateQueries({ queryKey: ['images'] });
        }
    }, [fetchNextPage, privacyExposureBlocked, queryClient]);



    return (
        <SearchContext.Provider value={{
            images: privacyExposureBlocked ? [] : images,
            imagesQueryKey,
            setImages,
            filters,
            setFilters,
            sortOption,
            setSortOption: setSortOptionDispatch,
            facets: activeFacets,
            stats: activeStats,
            totalImages: totalImagesCount,
            globalTotal: globalTotalCount,
            hasMoreImages: !privacyExposureBlocked && !!hasNextPage,
            loadMoreImages: async () => {
                if (!privacyExposureBlocked && hasNextPage && !isFetchingNextPage) {
                    await fetchNextPage();
                }
            },
            clearAllFilters: () => {
                clearAllFilters();
                // Explicitly invalidate to ensure fresh data if cache was stale
                queryClient.invalidateQueries({ queryKey: ['images'] });
                queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
            },
            isFiltering: !privacyIndexBlocked
                && (privacyScopeTransitionBlocked || isQueryLoading || isPlaceholderData || isFirstPageFetching),
            privacyExposureBlocked,
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
            isFacetsLoading: isFacetsFetching,
            isLoadingMore: isFetchingNextPage,
            isStatsSummaryLoading,
            isKeywordStatsLoading,
            validFacetNames: activeValidNames,
            assetScope,
            setAssetScope,
            setFacetDrilldownActive,

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
