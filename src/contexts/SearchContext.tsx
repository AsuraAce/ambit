import * as React from 'react';
import { createContext, useState, useContext, useCallback, useEffect, useRef, ReactNode } from 'react';
import {
    AIImage,
    AssetScope,
    FilterState,
    SortOption,
    MetadataRefreshScope,
    type ImageKindFilter,
    type MediaTypeFilter,
    type LibraryScopeCounts,
    type SourceKindCounts,
} from '../types';
import { useSettings } from './SettingsContext';
import { settingsPersistenceCoordinator } from '../utils/settingsPersistenceCoordinator';
import { useCollections } from './CollectionContext';
import { useSearchStore } from '../stores/searchStore';
import { appRepository } from '../services/repository';
import { getDb } from '../services/db/connection';

import { Facets, LibraryStats, ValidFacetNames } from '../services/db/searchRepo';
import { checkHiddenContentAvailability, rebuildThumbnailFacetCache, updateFavorite, updatePinned } from '../services/db/imageRepo';
import { clearAllCollectionThumbnailCaches } from '../services/db/collectionRepo';
import { useImagesQuery, type ImagesQueryKey } from '../hooks/useImagesQuery';
import { useLibraryStatsQuery } from '../hooks/useLibraryStatsQuery';
import { useLibraryScopeAvailability } from '../hooks/useLibraryScopeAvailability';
import { useLibraryScopeCounts } from '../hooks/useLibraryScopeCounts';
import { buildSqlWhereClause } from '../utils/sqlHelpers';
import { useQueryClient } from '@tanstack/react-query';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { isBrowserMockMode } from '../services/runtime';
import { getEffectiveImageKind, normalizeImageKindFilter, normalizeMediaTypeFilter, shouldPrefetchResultPages } from '../utils/filterState';
import { getEffectiveMaskedKeywords } from '../utils/maskingUtils';
import { useLibraryStore } from '../stores/libraryStore';
import {
    hasSameImageOrder,
    patchImageFlagsInQueryCaches,
    revertImageFieldsInList,
    revertImageFieldsInQueryCaches,
} from '../utils/imageQueryCache';
import { beginImageFieldWrite } from '../utils/imageFieldWrites';
import { applyOptimisticPinOrder } from '../utils/imageOptimisticUpdates';
import { useSettingsStore } from '../stores/settingsStore';
import { useCollectionStore } from '../stores/collectionStore';
import { privacyMaskRefreshCoordinator } from '../utils/privacyMaskRefreshCoordinator';
import { measureStartupPhase, startupDiagnostics } from '../utils/startupDiagnostics';
import { isInvokeOwnerScopeAdmitted, useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';

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
    /** The MATCHING count; null while it loads, after the first page has shown. */
    totalImages: number | null;
    /** Total non-deleted images in library; null while it loads. */
    globalTotal: number | null;
    /** The count read failed, so `totalImages` and `globalTotal` stay null until the next refresh. */
    imageCountsFailed: boolean;
    /** The first page of this view failed to load and no page arrived; nothing says the library is empty. */
    imagesFailed: boolean;
    /** Loads this view's first page and counts again after a failure. */
    retryImages: () => void;
    sourceKindCounts?: SourceKindCounts;
    scopeCounts?: LibraryScopeCounts;
    scopeAvailability?: LibraryScopeCounts;
    scopeResultCount?: number;
    scopeCountsLoading: boolean;
    scopeCountsError: boolean;
    retryScopeCounts: () => Promise<void>;
    hasMoreImages: boolean;
    loadMoreImages: () => Promise<void>;
    clearAllFilters: () => void;
    isFiltering: boolean;
    /** This owner/privacy scope has presented a successful safe page, even when empty. */
    isLibraryReady: boolean;
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

    availableHiddenContent: { hasIntermediates: boolean; hasGrids: boolean; hasInvokeImageAssets: boolean };
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

const applyRecentSearchMutation = (current: string[], mutation: React.SetStateAction<string[]>): string[] => {
    const next = typeof mutation === 'function' ? mutation(current) : mutation;
    return next.filter((search, index, searches) => searches.indexOf(search) === index).slice(0, RECENT_SEARCH_LIMIT);
};

export const SearchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { settings, setSettings, privacyEnabled, isLoaded: settingsLoaded } = useSettings();
    const { collections, smartCollections, refreshCollections, isLoaded: collectionsLoaded } = useCollections();
    const queryClient = useQueryClient();
    const privacyMaskIndexStatus = useSettingsStore((state) => state.privacyMaskIndexStatus);
    const privacyMaskIndexRetryToken = useSettingsStore((state) => state.privacyMaskIndexRetryToken);
    const setPrivacyMaskIndexState = useSettingsStore((state) => state.setPrivacyMaskIndexState);
    const refreshSmartCounts = useCollectionStore((state) => state.refreshSmartCounts);
    const keywordStatsEnabled = useLibraryStore((state) => state.keywordStatsEnabled);

    // Zustand Store Access
    const {
        images,
        setImages,
        filters,
        setFilters,
        sortOption,
        setSortOption,
        // Removed deleted store properties
        clearAllFilters,
    } = useSearchStore();

    const privacyMaskKeywords = React.useMemo(
        () =>
            getEffectiveMaskedKeywords(settings)
                .map((keyword) => keyword.trim().toLowerCase())
                .filter(Boolean)
                .sort(),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- getEffectiveMaskedKeywords reads only promptMaskingEnabled and maskedKeywords, both listed
        [settings.maskedKeywords, settings.promptMaskingEnabled]
    );
    const privacyMaskKey = privacyMaskKeywords.join('\u001f');
    const privacyQueryScopeKey = `${privacyEnabled ? 'enabled' : 'disabled'}\u001e${settings.maskingMode}\u001e${privacyMaskKey}`;
    const [lastSyncedPrivacyScope, setLastSyncedPrivacyScope] = useState<string | null>(null);
    const requiresPrivacyMaskIndex = privacyEnabled && !isBrowserMockMode();
    const invokeQueriesAdmitted = useInvokeOwnerScopeStore((state) =>
        isInvokeOwnerScopeAdmitted(settings.invokeAiPath, state.ownerScopeState)
    );
    const [assetScope, setAssetScope] = useState<AssetScope>('used');
    const [facetDrilldownActive, setFacetDrilldownActive] = useState(false);
    const [sourceKindHydrated, setSourceKindHydrated] = useState(false);
    const sourceKindHydrationTargetRef = useRef<{ sourceKind: ImageKindFilter; mediaType: MediaTypeFilter } | null>(null);

    const setSortOptionDispatch = useCallback(
        (value: React.SetStateAction<SortOption>) => {
            const nextSortOption = typeof value === 'function' ? value(sortOption) : value;
            setSortOption(nextSortOption);
        },
        [setSortOption, sortOption]
    );

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

        if (!invokeQueriesAdmitted) {
            privacyMaskRefreshCoordinator.discardPending();
            setPrivacyMaskIndexState('pending');
            return;
        }

        let cancelled = false;
        setPrivacyMaskIndexState('pending');

        privacyMaskRefreshCoordinator.schedule(async () => {
            try {
                if (cancelled) return;
                await getDb();
                if (cancelled) return;
                const refreshStartedAt = performance.now();
                const result = await measureStartupPhase('privacy', () => unwrap(commands.refreshPrivacyMaskIndex(privacyMaskKeywords)));
                if (cancelled) return;

                console.info(
                    `[Startup] Privacy mask refresh completed in ${Math.round(performance.now() - refreshStartedAt)}ms (changed: ${result.changed}, updated: ${result.updated})`
                );
                if (result.changed || result.updated > 0) {
                    const rebuildStartedAt = performance.now();
                    // Thumbnails read before or during the rebuild may show an image that is now hidden.
                    useCollectionStore.getState().invalidateRetainedThumbnails();
                    await clearAllCollectionThumbnailCaches();
                    await measureStartupPhase('facets', () => rebuildThumbnailFacetCache());
                    useCollectionStore.getState().invalidateRetainedThumbnails();
                    if (cancelled) return;
                    console.info(
                        `[Startup] Thumbnail facet privacy refresh completed in ${Math.round(performance.now() - rebuildStartedAt)}ms`
                    );
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
        invokeQueriesAdmitted,
    ]);

    useEffect(() => {
        if (!settingsLoaded || sourceKindHydrated) return;

        const mediaType = normalizeMediaTypeFilter(settings.libraryMediaType, settings.librarySourceKind);
        const sourceKind = getEffectiveImageKind({ mediaType, sourceKind: settings.librarySourceKind });
        const currentSourceKind = normalizeImageKindFilter(filters.sourceKind);
        const currentMediaType = normalizeMediaTypeFilter(filters.mediaType, currentSourceKind);
        sourceKindHydrationTargetRef.current =
            currentSourceKind === sourceKind && currentMediaType === mediaType ? null : { sourceKind, mediaType };
        if (sourceKindHydrationTargetRef.current) {
            setFilters((previous) => ({ ...previous, sourceKind, mediaType }));
        }
        setSourceKindHydrated(true);
    }, [
        filters.mediaType,
        filters.sourceKind,
        setFilters,
        settings.libraryMediaType,
        settings.librarySourceKind,
        settingsLoaded,
        sourceKindHydrated,
    ]);

    const databaseQueriesEnabled =
        settingsLoaded &&
        sourceKindHydrated &&
        (!sourceKindHydrationTargetRef.current ||
            (normalizeImageKindFilter(filters.sourceKind) === sourceKindHydrationTargetRef.current.sourceKind &&
                normalizeMediaTypeFilter(filters.mediaType, filters.sourceKind) === sourceKindHydrationTargetRef.current.mediaType)) &&
        collectionsLoaded &&
        invokeQueriesAdmitted &&
        (!requiresPrivacyMaskIndex || privacyMaskIndexStatus === 'ready');

    React.useEffect(() => {
        if (invokeQueriesAdmitted) return;

        void Promise.all([
            queryClient.cancelQueries({ queryKey: ['images'] }),
            queryClient.cancelQueries({ queryKey: ['libraryStats'] }),
            queryClient.cancelQueries({ queryKey: ['libraryKeywordStats'] }),
            queryClient.cancelQueries({ queryKey: ['parameterRanges'] }),
        ]);
    }, [invokeQueriesAdmitted, queryClient]);
    const allCollections = React.useMemo(() => [...collections, ...smartCollections], [collections, smartCollections]);

    // React Query
    const {
        data: queryData,
        fetchNextPage,
        hasNextPage,
        isFetching,
        isFetchingNextPage,
        isLoading: isQueryLoading,
        isPlaceholderData,
        error: imagesQueryError,
        status: imagesQueryStatus,
        queryKey: imagesQueryKey,
        counts: imageCounts,
        countsFailed: imageCountsFailed,
        countsArePlaceholder: imageCountsArePlaceholder,
    } = useImagesQuery({
        filters,
        sortOption,
        settings,
        privacyEnabled,
        allCollections,
        settingsLoaded: databaseQueriesEnabled,
    });
    const privacyScopeTransitionBlocked = privacyEnabled && lastSyncedPrivacyScope !== privacyQueryScopeKey;
    const privacyIndexBlocked = requiresPrivacyMaskIndex && (!settingsLoaded || privacyMaskIndexStatus !== 'ready');
    const privacyExposureBlocked = !invokeQueriesAdmitted || privacyIndexBlocked || privacyScopeTransitionBlocked;
    const isFirstPageFetching = isFetching && !isFetchingNextPage;
    const librarySafetyScope = JSON.stringify([imagesQueryKey[imagesQueryKey.length - 1], privacyQueryScopeKey]);
    const [preparedLibrarySafetyScope, setPreparedLibrarySafetyScope] = useState<string | null>(null);
    const hasCurrentSafePage =
        databaseQueriesEnabled &&
        !privacyExposureBlocked &&
        imagesQueryStatus === 'success' &&
        Boolean(queryData?.pages.length) &&
        !isPlaceholderData &&
        !isFirstPageFetching;
    React.useLayoutEffect(() => {
        if (!databaseQueriesEnabled || privacyExposureBlocked) {
            setPreparedLibrarySafetyScope(null);
        } else if (hasCurrentSafePage) {
            setPreparedLibrarySafetyScope(librarySafetyScope);
        }
    }, [databaseQueriesEnabled, hasCurrentSafePage, librarySafetyScope, privacyExposureBlocked]);
    // Ordinary searches retain admission so image requests throttle, rather than cancel, Smart repair.
    const isLibraryReady =
        databaseQueriesEnabled && !privacyExposureBlocked && (hasCurrentSafePage || preparedLibrarySafetyScope === librarySafetyScope);
    useEffect(() => {
        if (isLibraryReady) startupDiagnostics.mark('first-page');
    }, [isLibraryReady]);

    // Flatten pages into a single image array
    const _queryImages = React.useMemo(() => {
        if (!queryData) return [];
        return queryData.pages.flatMap((p) => p.images);
    }, [queryData]);

    // Use query data if available, otherwise fallback to store (for transitions or overrides)
    // Actually, we should sync query data TO store or just expose it directly?
    // Exposing directly is better but we have setImages...
    // Let's rely on Query Data for display.
    // BUT we need 'setImages' to work for optimistic updates (favorites/pins).
    // React Query cache can be updated via setQueryData, but setImages is simpler if we sync.
    // For now, let's allow setImages to override, OR sync Query -> Store.

    // SYNC PATTERN: When query data changes, update Store. This keeps store as "Source of Truth" for UI.
    // The collection (or Library, null) whose page the store holds; undefined until a page arrives.
    const storedViewCollectionIdRef = React.useRef<string | null | undefined>(undefined);
    const activeCollectionId = filters.collectionId;
    React.useLayoutEffect(() => {
        if (queryData && !privacyIndexBlocked) {
            const allImgs = queryData.pages.flatMap((p) => p.images);
            setImages(allImgs);
            setLastSyncedPrivacyScope(privacyQueryScopeKey);
            storedViewCollectionIdRef.current = activeCollectionId;
        } else if (privacyExposureBlocked) {
            setImages([]);
        } else if (
            !queryData &&
            databaseQueriesEnabled &&
            storedViewCollectionIdRef.current !== undefined &&
            storedViewCollectionIdRef.current !== activeCollectionId
        ) {
            // Another view opened and has no page yet: show the loading state, never the stored
            // page of the previous view (#479). Refreshes of the same view keep their page.
            setImages([]);
            storedViewCollectionIdRef.current = activeCollectionId;
        }
    }, [
        activeCollectionId,
        databaseQueriesEnabled,
        privacyExposureBlocked,
        privacyIndexBlocked,
        privacyQueryScopeKey,
        queryData,
        setImages,
    ]);

    // A failed first page with nothing cached must not read as an empty library or as no matches (#483).
    const imagesFailed = !privacyExposureBlocked && imagesQueryStatus === 'error' && !queryData && !isFetching;
    useEffect(() => {
        if (imagesFailed) console.error('[Library] Failed to load images', imagesQueryError);
    }, [imagesFailed, imagesQueryError]);
    const retryImages = useCallback(() => {
        // The counts key extends the images key, so this reloads both. Errors land in query state.
        void queryClient.invalidateQueries({ queryKey: imagesQueryKey });
    }, [imagesQueryKey, queryClient]);

    // Proactive prefetching: Load next page in background after current page loads
    // Only prefetch if we have less than 3 pages and user might scroll soon
    useEffect(() => {
        const currentPageCount = queryData?.pages.length ?? 0;
        if (shouldPrefetchResultPages(filters, hasNextPage, isFetchingNextPage, currentPageCount)) {
            const timer = setTimeout(() => {
                void fetchNextPage(); // errors land in query state; this promise does not reject
            }, 500); // Increased delay to reduce load during filter changes
            return () => clearTimeout(timer);
        }
    }, [filters, hasNextPage, isFetchingNextPage, queryData, fetchNextPage]);

    const totalImagesCount = privacyExposureBlocked ? 0 : (imageCounts?.totalCount ?? null);
    const globalTotalCount = privacyExposureBlocked ? 0 : (imageCounts?.globalCount ?? null);
    const scopeQuery = useLibraryScopeCounts({ filters, settings, privacyEnabled, allCollections, enabled: hasCurrentSafePage });
    const availabilityQuery = useLibraryScopeAvailability({ filters, settings, privacyEnabled, enabled: hasCurrentSafePage });
    const scopeCounts = hasCurrentSafePage && !scopeQuery.isError ? scopeQuery.data : undefined;
    const sourceKindCounts = scopeCounts?.imageKinds;
    const scopeAvailability = hasCurrentSafePage && !availabilityQuery.isError ? availabilityQuery.data : undefined;
    // The scope dropdown counts this page's own results, never the previous search's kept total.
    const scopeResultCount = hasCurrentSafePage && !imageCountsArePlaceholder ? imageCounts?.totalCount : undefined;
    // While an owner-cache repair holds the scope counts, missing counts read as loading and no
    // earlier error or retry is offered; the held queries run again when the repair ends.
    const isOwnerCacheRepairing = useLibraryStore((state) => state.isOwnerCacheRepairing);
    const scopeCountsHeld = isOwnerCacheRepairing && (scopeQuery.data === undefined || availabilityQuery.data === undefined);
    const scopeCountsLoading = hasCurrentSafePage && (scopeQuery.isFetching || availabilityQuery.isFetching || scopeCountsHeld);
    const scopeCountsError =
        hasCurrentSafePage &&
        !isOwnerCacheRepairing &&
        ((scopeQuery.isError && !scopeQuery.isFetching) || (availabilityQuery.isError && !availabilityQuery.isFetching));
    const retryScopeCounts = useCallback(async () => {
        if (!hasCurrentSafePage || isOwnerCacheRepairing) return;
        await Promise.all([
            scopeQuery.isError && !scopeQuery.isFetching ? scopeQuery.refetch() : undefined,
            availabilityQuery.isError && !availabilityQuery.isFetching ? availabilityQuery.refetch() : undefined,
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- lists the query fields it reads; the query result objects change identity every render
    }, [
        hasCurrentSafePage,
        isOwnerCacheRepairing,
        scopeQuery.isError,
        scopeQuery.isFetching,
        scopeQuery.refetch,
        availabilityQuery.isError,
        availabilityQuery.isFetching,
        availabilityQuery.refetch,
    ]);

    // Stats & Facets Query
    const {
        data: statsData,
        isFacetsFetching,
        isStatsSummaryLoading,
        isKeywordStatsLoading,
    } = useLibraryStatsQuery({
        filters,
        settings,
        privacyEnabled,
        allCollections,
        settingsLoaded: databaseQueriesEnabled,
        assetScope,
        validFacetsEnabled: facetDrilldownActive,
        keywordStatsEnabled,
    });

    const activeFacets = (!privacyExposureBlocked && statsData?.facets) || {
        checkpoints: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        tools: [],
        controlNets: [],
        ipAdapters: [],
    };
    const activeStats = (!privacyExposureBlocked && statsData?.stats) || {
        totalImages: 0,
        totalGenerations: 0,
        avgSteps: 0,
        estSizeMB: '0',
        modelStats: [],
        keywordStats: [],
    };
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

    const refreshMetadata = useCallback(
        async (scope: MetadataRefreshScope = 'full') => {
            const refreshTasks: Promise<unknown>[] = [queryClient.invalidateQueries({ queryKey: ['images'] })];

            if (scope === 'full') {
                refreshTasks.push(
                    queryClient.invalidateQueries({ queryKey: ['libraryStats'] }),
                    refreshCollections(false, {
                        consistency: 'authoritative',
                    })
                );
            }

            await Promise.all(refreshTasks);
        },
        [queryClient, refreshCollections]
    );

    const refreshCollectionsAfterImageFlagChange = useCallback(() => {
        void refreshCollections(true);

        const activeCollectionId = useSearchStore.getState().filters.collectionId;
        if (!activeCollectionId) return;

        void refreshSmartCounts({
            collectionIds: [activeCollectionId],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true,
        });
    }, [refreshCollections, refreshSmartCounts]);

    const toggleFavorite = useCallback(
        async (id: string) => {
            const imgs = useSearchStore.getState().images;
            const img = imgs.find((i) => i.id === id);
            if (!img) return;
            const newVal = !img.isFavorite;
            const write = beginImageFieldWrite('isFavorite', [{ id, previous: img.isFavorite, next: newVal }]);

            try {
                setImages(imgs.map((i) => (i.id === id ? { ...i, isFavorite: newVal } : i)));
                patchImageFlagsInQueryCaches(queryClient, [id], { isFavorite: newVal });
                await updateFavorite(id, newVal);
                write.settle();
                refreshCollectionsAfterImageFlagChange();
            } catch (e) {
                console.error('Toggle favorite failed', e);
                // Revert only this image's favorite: the user may have opened another view (#484) or
                // changed its other fields meanwhile (#492).
                const reverts = write.settle([id]);
                setImages((current) => revertImageFieldsInList(current, reverts));
                revertImageFieldsInQueryCaches(queryClient, reverts);
            }
        },
        [queryClient, refreshCollectionsAfterImageFlagChange, setImages]
    );

    const togglePin = useCallback(
        async (id: string, isPinned?: boolean) => {
            const imgs = useSearchStore.getState().images;
            const img = imgs.find((i) => i.id === id);
            if (!img) return;
            const newVal = isPinned !== undefined ? isPinned : !img.isPinned;
            const nextImages = applyOptimisticPinOrder(imgs, [id], newVal, filters.collectionId !== null);
            const write = beginImageFieldWrite('isPinned', [{ id, previous: img.isPinned, next: newVal }]);

            try {
                setImages(nextImages);
                patchImageFlagsInQueryCaches(
                    queryClient,
                    [id],
                    { isPinned: newVal },
                    {
                        previousOrder: imgs,
                        nextOrder: nextImages,
                        reorderQueryKey: imagesQueryKey,
                    }
                );
                await updatePinned(id, newVal);
                write.settle();
                refreshCollectionsAfterImageFlagChange();
            } catch (e) {
                console.error('Toggle pin failed', e);
                const reverts = write.settle([id]);
                if (reverts.size === 0) return;
                // As in useAppActions: the snapshot order fits only when the pin goes back to what this
                // write found; otherwise, or once the list moved on, reload so the pin is sorted again.
                const fullRevert = reverts.get(id)?.isPinned === img.isPinned;
                if (!fullRevert || !hasSameImageOrder(useSearchStore.getState().images, nextImages)) {
                    void queryClient.invalidateQueries({ queryKey: ['images'] });
                }
                const order = fullRevert ? { previousOrder: nextImages, nextOrder: imgs } : {};
                setImages((current) => revertImageFieldsInList(current, reverts, order));
                revertImageFieldsInQueryCaches(queryClient, reverts, { ...order, reorderQueryKey: imagesQueryKey });
            }
        },
        [filters.collectionId, imagesQueryKey, queryClient, refreshCollectionsAfterImageFlagChange, setImages]
    );

    // ... Missing: setRecentSearches, loadFacet, availableHiddenContent
    // Store doesn't have recentSearches yet.
    const [recentSearches, setRecentSearchesState] = useState<string[]>([]);
    const recentSearchHydrationGenerationRef = useRef(0);
    const recentSearchesHydratedRef = useRef(false);
    const recentSearchesMountedRef = useRef(true);
    const viewSettingsHydrationTargetRef = useRef<{
        showGrids: boolean;
        showIntermediates: boolean;
        showInvokeImageAssets: boolean;
    } | null>(null);
    const [viewSettingsHydrated, setViewSettingsHydrated] = useState(false);
    const [availableHiddenContent, setAvailableHiddenContent] = useState({
        hasIntermediates: false,
        hasGrids: false,
        hasInvokeImageAssets: false,
    });

    const setRecentSearches = useCallback<React.Dispatch<React.SetStateAction<string[]>>>((mutation) => {
        recentSearchHydrationGenerationRef.current += 1;
        recentSearchesHydratedRef.current = true;
        setRecentSearchesState((current) => applyRecentSearchMutation(current, mutation));

        void settingsPersistenceCoordinator
            .run(async () => {
                const persistedState = await appRepository.update((state) => ({
                    ...state,
                    recentSearches: applyRecentSearchMutation(state.recentSearches ?? [], mutation),
                }));
                if (recentSearchesMountedRef.current) {
                    setRecentSearchesState([...(persistedState.recentSearches ?? [])]);
                }
            })
            .catch((error) => {
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

        const waitForRetry = (delayMs: number): Promise<void> =>
            new Promise((resolve) => {
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
                    if (
                        cancelled ||
                        recentSearchesHydratedRef.current ||
                        hydrationGeneration !== recentSearchHydrationGenerationRef.current
                    )
                        return;

                    setRecentSearchesState(appState.recentSearches ?? []);
                    recentSearchesHydratedRef.current = true;
                    return;
                } catch (error) {
                    if (cancelled) return;
                    console.error('[SearchContext] Failed to load persisted search state', error);
                    const retryDelay = Math.min(RECENT_SEARCH_LOAD_RETRY_BASE_MS * 2 ** retryCount, RECENT_SEARCH_LOAD_RETRY_MAX_MS);
                    retryCount += 1;
                    await waitForRetry(retryDelay);
                }
            }
        };

        void loadRecentSearches();

        return () => {
            cancelled = true;
            recentSearchesMountedRef.current = false;
            if (retryTimeout !== undefined) clearTimeout(retryTimeout);
            releaseRetryDelay?.();
        };
    }, []);

    useEffect(() => {
        if (!databaseQueriesEnabled) return;

        let cancelled = false;
        void checkHiddenContentAvailability()
            .then((availability) => {
                if (!cancelled) setAvailableHiddenContent(availability);
            })
            .catch((error) => console.error('[SearchContext] Failed to load hidden-content availability', error));

        return () => {
            cancelled = true;
        };
    }, [databaseQueriesEnabled]);

    // Hydrate persisted view settings before enabling the effects that write them back.
    useEffect(() => {
        if (!settingsLoaded || viewSettingsHydrated) return;

        const target = {
            showGrids: settings.libraryShowGrids ?? filters.showGrids ?? false,
            showIntermediates: settings.libraryShowIntermediates ?? filters.showIntermediates ?? false,
            showInvokeImageAssets: settings.libraryShowInvokeImageAssets ?? filters.showInvokeImageAssets ?? false,
        };
        viewSettingsHydrationTargetRef.current = target;
        setFilters((prev) => ({ ...prev, ...target }));
        setViewSettingsHydrated(true);
    }, [
        filters.showGrids,
        filters.showIntermediates,
        filters.showInvokeImageAssets,
        settings.libraryShowGrids,
        settings.libraryShowIntermediates,
        settings.libraryShowInvokeImageAssets,
        settingsLoaded,
        setFilters,
        viewSettingsHydrated,
    ]);

    // 2. Persist Grid Toggle Change to Settings
    useEffect(() => {
        if (!viewSettingsHydrated) return;
        const hydrationTarget = viewSettingsHydrationTargetRef.current;
        if (
            hydrationTarget &&
            (filters.showGrids !== hydrationTarget.showGrids ||
                filters.showIntermediates !== hydrationTarget.showIntermediates ||
                filters.showInvokeImageAssets !== hydrationTarget.showInvokeImageAssets)
        )
            return;
        viewSettingsHydrationTargetRef.current = null;
        if (settings.libraryShowGrids !== filters.showGrids) {
            setSettings({ libraryShowGrids: filters.showGrids });
        }
    }, [
        filters.showGrids,
        filters.showIntermediates,
        filters.showInvokeImageAssets,
        setSettings,
        settings.libraryShowGrids,
        viewSettingsHydrated,
    ]);

    // 3. Persist Intermediate Toggle Change to Settings
    useEffect(() => {
        if (!viewSettingsHydrated) return;
        const hydrationTarget = viewSettingsHydrationTargetRef.current;
        if (
            hydrationTarget &&
            (filters.showGrids !== hydrationTarget.showGrids ||
                filters.showIntermediates !== hydrationTarget.showIntermediates ||
                filters.showInvokeImageAssets !== hydrationTarget.showInvokeImageAssets)
        )
            return;
        viewSettingsHydrationTargetRef.current = null;
        if (settings.libraryShowIntermediates !== filters.showIntermediates) {
            setSettings({ libraryShowIntermediates: filters.showIntermediates });
        }
    }, [
        filters.showGrids,
        filters.showIntermediates,
        filters.showInvokeImageAssets,
        setSettings,
        settings.libraryShowIntermediates,
        viewSettingsHydrated,
    ]);

    // 4. Persist InvokeAI Image Asset Toggle Change to Settings
    useEffect(() => {
        if (!viewSettingsHydrated) return;
        const hydrationTarget = viewSettingsHydrationTargetRef.current;
        if (
            hydrationTarget &&
            (filters.showGrids !== hydrationTarget.showGrids ||
                filters.showIntermediates !== hydrationTarget.showIntermediates ||
                filters.showInvokeImageAssets !== hydrationTarget.showInvokeImageAssets)
        )
            return;
        viewSettingsHydrationTargetRef.current = null;
        if (settings.libraryShowInvokeImageAssets !== filters.showInvokeImageAssets) {
            setSettings({ libraryShowInvokeImageAssets: filters.showInvokeImageAssets });
        }
    }, [
        filters.showGrids,
        filters.showIntermediates,
        filters.showInvokeImageAssets,
        setSettings,
        settings.libraryShowInvokeImageAssets,
        viewSettingsHydrated,
    ]);

    // Persist the top-level library scope after its saved value has hydrated.
    useEffect(() => {
        if (!sourceKindHydrated) return;

        const mediaType = normalizeMediaTypeFilter(filters.mediaType, filters.sourceKind);
        const sourceKind = getEffectiveImageKind(filters);
        const hydrationTarget = sourceKindHydrationTargetRef.current;
        if (hydrationTarget !== null && (sourceKind !== hydrationTarget.sourceKind || mediaType !== hydrationTarget.mediaType)) return;

        sourceKindHydrationTargetRef.current = null;
        if (
            normalizeImageKindFilter(settings.librarySourceKind) !== sourceKind ||
            normalizeMediaTypeFilter(settings.libraryMediaType, settings.librarySourceKind) !== mediaType
        ) {
            setSettings({ librarySourceKind: sourceKind, libraryMediaType: mediaType });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- getEffectiveImageKind reads only filters.mediaType and filters.sourceKind, both listed
    }, [filters.mediaType, filters.sourceKind, setSettings, settings.libraryMediaType, settings.librarySourceKind, sourceKindHydrated]);

    // Adapter for legacy fetchData calls
    const fetchData = useCallback(
        async (isLoadMore: boolean, _isSilent: boolean = false) => {
            if (privacyExposureBlocked) return;
            if (isLoadMore) {
                await fetchNextPage();
            } else {
                // Force refetch
                // New count identity excludes pre-refresh responses; admission waits for the safe page.
                useLibraryStore.getState().incrementScopeCountsVersion();
                // Using queryClient.invalidateQueries triggers a background refetch
                // Components using 'isFetching' will see true, but 'isLoading' stays false if data exists
                await queryClient.invalidateQueries({ queryKey: ['images'] });
            }
        },
        [fetchNextPage, privacyExposureBlocked, queryClient]
    );

    const clearAllFiltersAndRefresh = useCallback(() => {
        clearAllFilters();
        // Explicitly invalidate to ensure fresh data if cache was stale
        // Refetch errors land in query state; invalidateQueries does not reject by default.
        void queryClient.invalidateQueries({ queryKey: ['images'] });
        void queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
    }, [clearAllFilters, queryClient]);

    return (
        <SearchContext.Provider
            value={{
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
                imageCountsFailed: !privacyExposureBlocked && imageCountsFailed,
                imagesFailed,
                retryImages,
                sourceKindCounts,
                scopeCounts,
                scopeAvailability,
                scopeResultCount,
                scopeCountsLoading,
                scopeCountsError,
                retryScopeCounts,
                hasMoreImages: !privacyExposureBlocked && !!hasNextPage,
                loadMoreImages: async () => {
                    if (!privacyExposureBlocked && hasNextPage && !isFetchingNextPage) {
                        await fetchNextPage();
                    }
                },
                clearAllFilters: clearAllFiltersAndRefresh,
                isFiltering:
                    !privacyIndexBlocked && (privacyScopeTransitionBlocked || isQueryLoading || isPlaceholderData || isFirstPageFetching),
                privacyExposureBlocked,
                isLibraryReady,
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
            }}
        >
            {children}
        </SearchContext.Provider>
    );
};

export const useSearch = () => {
    const context = useContext(SearchContext);
    if (!context) throw new Error('useSearch must be used within SearchProvider');
    return context;
};
