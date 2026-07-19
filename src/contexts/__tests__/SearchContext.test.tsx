import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIImage, AppSettings, Collection, FilterState, SortOption } from '../../types';
import type { ImagesQueryKey } from '../../hooks/useImagesQuery';
import { SearchProvider, useSearch } from '../SearchContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { privacyMaskRefreshCoordinator } from '../../utils/privacyMaskRefreshCoordinator';

type SearchValue = ReturnType<typeof useSearch>;

const mocks = vi.hoisted(() => ({
    settings: { current: {} as unknown },
    collections: { current: {} as unknown },
    searchState: { current: {} as unknown },
    imagesQuery: { current: {} as unknown },
    imagesQueryArgs: { current: null as { settingsLoaded?: boolean } | null },
    statsQuery: { current: {} as unknown },
    queryClient: {
        invalidateQueries: vi.fn().mockResolvedValue(undefined)
    },
    repository: {
        load: vi.fn(),
        save: vi.fn(),
        update: vi.fn()
    },
    getDb: vi.fn().mockResolvedValue(undefined),
    refreshPrivacyMaskIndex: vi.fn(),
    unwrap: vi.fn(async (value: unknown) => value),
    browserMockMode: { current: false },
    buildSqlWhereClause: vi.fn(),
    checkHiddenContentAvailability: vi.fn(),
    rebuildThumbnailFacetCache: vi.fn().mockResolvedValue(undefined),
    clearAllCollectionThumbnailCaches: vi.fn().mockResolvedValue(undefined),
    updateFavorite: vi.fn(),
    updatePinned: vi.fn(),
    patchImageFlagsInQueryCaches: vi.fn(),
    restoreImagesInQueryCaches: vi.fn(),
    applyOptimisticPinOrder: vi.fn(),
    incrementFacetCacheVersion: vi.fn(),
    shouldPrefetchResultPages: vi.fn(),
    refreshSmartCounts: vi.fn()
}));

vi.mock('../SettingsContext', () => ({ useSettings: () => mocks.settings.current }));
vi.mock('../CollectionContext', () => ({ useCollections: () => mocks.collections.current }));
vi.mock('../../stores/searchStore', () => ({
    useSearchStore: Object.assign(
        () => mocks.searchState.current,
        { getState: () => mocks.searchState.current }
    )
}));
vi.mock('../../hooks/useImagesQuery', () => ({
    useImagesQuery: (args: { settingsLoaded?: boolean }) => {
        mocks.imagesQueryArgs.current = args;
        return mocks.imagesQuery.current;
    }
}));
vi.mock('../../hooks/useLibraryStatsQuery', () => ({ useLibraryStatsQuery: () => mocks.statsQuery.current }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks.queryClient }));
vi.mock('../../services/repository', () => ({ appRepository: mocks.repository }));
vi.mock('../../services/db/connection', () => ({ getDb: mocks.getDb }));
vi.mock('../../bindings', () => ({ commands: { refreshPrivacyMaskIndex: mocks.refreshPrivacyMaskIndex } }));
vi.mock('../../utils/spectaUtils', () => ({ unwrap: mocks.unwrap }));
vi.mock('../../services/runtime', () => ({ isBrowserMockMode: () => mocks.browserMockMode.current }));
vi.mock('../../utils/sqlHelpers', () => ({ buildSqlWhereClause: mocks.buildSqlWhereClause }));
vi.mock('../../utils/filterState', () => ({ shouldPrefetchResultPages: mocks.shouldPrefetchResultPages }));
vi.mock('../../services/db/imageRepo', () => ({
    checkHiddenContentAvailability: mocks.checkHiddenContentAvailability,
    rebuildThumbnailFacetCache: mocks.rebuildThumbnailFacetCache,
    updateFavorite: mocks.updateFavorite,
    updatePinned: mocks.updatePinned
}));
vi.mock('../../services/db/collectionRepo', () => ({
    clearAllCollectionThumbnailCaches: mocks.clearAllCollectionThumbnailCaches
}));
vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: { getState: () => ({ incrementFacetCacheVersion: mocks.incrementFacetCacheVersion }) }
}));
vi.mock('../../stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: { refreshSmartCounts: typeof mocks.refreshSmartCounts }) => unknown) =>
        selector({ refreshSmartCounts: mocks.refreshSmartCounts })
}));
vi.mock('../../utils/imageQueryCache', () => ({
    patchImageFlagsInQueryCaches: mocks.patchImageFlagsInQueryCaches,
    restoreImagesInQueryCaches: mocks.restoreImagesInQueryCaches
}));
vi.mock('../../utils/imageOptimisticUpdates', () => ({
    applyOptimisticPinOrder: mocks.applyOptimisticPinOrder
}));

const baseFilters: FilterState = {
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
    showGrids: false,
    showIntermediates: false
};

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'image-1',
    path: 'C:/images/image-1.png',
    url: 'asset://image-1',
    filename: 'image-1.png',
    timestamp: 1,
    isFavorite: false,
    isPinned: false,
    ...overrides
} as AIImage);

const settings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    maskingMode: 'blur',
    maskedKeywords: [],
    libraryShowGrids: false,
    libraryShowIntermediates: false,
    ...overrides
} as AppSettings);

let latest: SearchValue;

const Consumer = () => {
    latest = useSearch();
    return <div>{latest.images.length}</div>;
};

const renderProvider = () => render(<SearchProvider><Consumer /></SearchProvider>);

describe('SearchProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        latest = undefined as unknown as SearchValue;

        const setImages = vi.fn((next: AIImage[] | ((current: AIImage[]) => AIImage[])) => {
            const state = mocks.searchState.current as SearchValue;
            state.images = typeof next === 'function' ? next(state.images) : next;
        });
        mocks.searchState.current = {
            images: [],
            setImages,
            filters: { ...baseFilters },
            setFilters: vi.fn(),
            sortOption: 'date_desc' as SortOption,
            setSortOption: vi.fn(),
            clearAllFilters: vi.fn()
        };
        mocks.settings.current = {
            settings: settings(),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true
        };
        mocks.collections.current = {
            collections: [] as Collection[],
            smartCollections: [] as Collection[],
            refreshCollections: vi.fn().mockResolvedValue(undefined),
            isLoaded: true
        };
        mocks.imagesQuery.current = {
            data: undefined,
            fetchNextPage: vi.fn().mockResolvedValue(undefined),
            hasNextPage: false,
            isFetching: false,
            isFetchingNextPage: false,
            isLoading: false,
            isPlaceholderData: false,
            queryKey: ['images', baseFilters, 'date_desc', false, 'blur', [], null] as ImagesQueryKey
        };
        mocks.imagesQueryArgs.current = null;
        mocks.statsQuery.current = {
            data: undefined,
            isFacetsFetching: false,
            isStatsSummaryLoading: false,
            isKeywordStatsLoading: false
        };
        mocks.repository.load.mockResolvedValue({ settings: {} });
        mocks.repository.save.mockResolvedValue(undefined);
        mocks.repository.update.mockImplementation(async (updater: (state: unknown) => unknown) => updater({
            images: [],
            collections: [],
            smartCollections: [],
            settings: settings(),
            recentSearches: ['portrait']
        }));
        mocks.checkHiddenContentAvailability.mockResolvedValue({ hasIntermediates: false, hasGrids: false });
        mocks.buildSqlWhereClause.mockReturnValue({ where: 'deleted_at IS NULL', params: ['value'] });
        mocks.refreshPrivacyMaskIndex.mockResolvedValue({ changed: false, updated: 0 });
        mocks.updateFavorite.mockResolvedValue(undefined);
        mocks.updatePinned.mockResolvedValue(undefined);
        mocks.applyOptimisticPinOrder.mockImplementation((images: AIImage[]) => images);
        mocks.shouldPrefetchResultPages.mockReturnValue(false);
        mocks.browserMockMode.current = false;
        privacyMaskRefreshCoordinator.resetForTests();
        useSettingsStore.setState({
            privacyEnabled: false,
            privacyMaskIndexStatus: 'ready',
            privacyMaskIndexError: null,
            privacyMaskIndexRetryToken: 0,
        });
    });

    afterEach(() => vi.useRealTimers());

    it('requires consumers to be rendered within the provider', () => {
        expect(() => render(<Consumer />)).toThrow('useSearch must be used within SearchProvider');
    });

    it('exposes query data, stats, facets, SQL state, and synchronizes query images', async () => {
        const first = image();
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [first], totalCount: 4, globalCount: 9 }] },
            hasNextPage: true,
            isLoading: true
        };
        mocks.statsQuery.current = {
            data: {
                facets: { checkpoints: [{ name: 'model', count: 1 }], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] },
                stats: { totalImages: 4, totalGenerations: 3, avgSteps: 20, estSizeMB: '1', modelStats: [], keywordStats: [] },
                validNames: { checkpoints: ['model'] }
            },
            isFacetsFetching: true,
            isStatsSummaryLoading: true,
            isKeywordStatsLoading: true
        };

        renderProvider();
        await waitFor(() => expect((mocks.searchState.current as SearchValue).setImages).toHaveBeenCalledWith([first]));
        await waitFor(() => expect(latest.activeSqlWhere).toBe('deleted_at IS NULL'));
        expect(latest.totalImages).toBe(4);
        expect(latest.globalTotal).toBe(9);
        expect(latest.hasMoreImages).toBe(true);
        expect(latest.isFiltering).toBe(true);
        expect(latest.facets.checkpoints[0].name).toBe('model');
        expect(latest.stats.totalGenerations).toBe(3);
        expect(latest.validFacetNames).toBeNull();
        expect(latest.isFacetsLoading).toBe(true);
    });

    it('keeps privacy-compatible placeholder results visible while the first page refreshes', async () => {
        const previous = image({ id: 'previous' });
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [previous], totalCount: 1, globalCount: 9 }] },
            isFetching: true,
            isPlaceholderData: true
        };
        vi.spyOn(console, 'info').mockImplementation(() => undefined);

        renderProvider();

        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
        await waitFor(() => expect(latest.images).toEqual([previous]));
        expect(latest.totalImages).toBe(1);
        expect(latest.globalTotal).toBe(9);
        expect(latest.isFiltering).toBe(true);
    });

    it('clears stored blur results until a hide-mode query returns', async () => {
        const blurred = image({ id: 'blurred' });
        const safe = image({ id: 'safe' });
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskingMode: 'blur', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [blurred], totalCount: 1, globalCount: 2 }] },
            queryKey: ['images', baseFilters, 'date_desc', true, 'blur', ['face'], null] as ImagesQueryKey
        };
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const view = renderProvider();
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
        await waitFor(() => expect(latest.images).toEqual([blurred]));

        mocks.settings.current = {
            ...mocks.settings.current as object,
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] })
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: undefined,
            isFetching: true,
            queryKey: ['images', baseFilters, 'date_desc', true, 'hide', ['face'], null] as ImagesQueryKey
        };
        view.rerender(<SearchProvider><Consumer /></SearchProvider>);

        await waitFor(() => expect(latest.images).toEqual([]));
        expect(latest.globalTotal).toBe(0);
        expect(latest.isFiltering).toBe(true);

        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [safe], totalCount: 1, globalCount: 2 }] },
            isFetching: false
        };
        view.rerender(<SearchProvider><Consumer /></SearchProvider>);

        await waitFor(() => expect(latest.images).toEqual([safe]));
        expect(latest.globalTotal).toBe(2);
    });

    it('never exposes stored blur results while switching to cached hide results', async () => {
        const blurred = image({ id: 'blurred' });
        const safe = image({ id: 'safe' });
        const observedImageIds: string[][] = [];
        const TransitionConsumer = () => {
            latest = useSearch();
            observedImageIds.push(latest.images.map(item => item.id));
            return null;
        };
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskingMode: 'blur', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [blurred], totalCount: 1, globalCount: 2 }] },
            queryKey: ['images', baseFilters, 'date_desc', true, 'blur', ['face'], null] as ImagesQueryKey
        };
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const view = render(<SearchProvider><TransitionConsumer /></SearchProvider>);
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
        await waitFor(() => expect(latest.images).toEqual([blurred]));
        observedImageIds.length = 0;

        mocks.settings.current = {
            ...mocks.settings.current as object,
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] })
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [safe], totalCount: 1, globalCount: 2 }] },
            queryKey: ['images', baseFilters, 'date_desc', true, 'hide', ['face'], null] as ImagesQueryKey
        };
        view.rerender(<SearchProvider><TransitionConsumer /></SearchProvider>);

        expect(observedImageIds).not.toContainEqual(['blurred']);
        await waitFor(() => expect(latest.images).toEqual([safe]));
    });

    it('reports a cached first-page refresh as filtering without losing the global count', () => {
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [], totalCount: 0, globalCount: 9 }] },
            isFetching: true
        };

        renderProvider();

        expect(latest.globalTotal).toBe(9);
        expect(latest.isFiltering).toBe(true);
    });

    it('supports functional sorting, loading, fetch adapters, clearing, and metadata refresh scopes', async () => {
        renderProvider();
        const state = mocks.searchState.current as SearchValue;
        const fetchNextPage = (mocks.imagesQuery.current as { fetchNextPage: ReturnType<typeof vi.fn> }).fetchNextPage;

        act(() => latest.setSortOption(previous => previous === 'date_desc' ? 'name_asc' : 'date_desc'));
        act(() => latest.setSortOption('size_desc'));
        expect(state.setSortOption).toHaveBeenCalledWith('name_asc');
        expect(state.setSortOption).toHaveBeenCalledWith('size_desc');

        await act(() => latest.fetchData(true));
        await act(() => latest.fetchData(false, true));
        await act(() => latest.refreshMetadata('images-only'));
        await act(() => latest.refreshMetadata());
        act(() => latest.clearAllFilters());
        await act(() => latest.loadMoreImages());

        expect(fetchNextPage).toHaveBeenCalledOnce();
        expect(state.clearAllFilters).toHaveBeenCalledOnce();
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['libraryStats'] });
        expect((mocks.collections.current as { refreshCollections: ReturnType<typeof vi.fn> }).refreshCollections).toHaveBeenCalledOnce();
    });

    it('loads another page only when a next page is available and idle', async () => {
        const fetchNextPage = vi.fn().mockResolvedValue(undefined);
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            fetchNextPage,
            hasNextPage: true,
            isFetchingNextPage: false
        };
        const view = renderProvider();
        await act(() => latest.loadMoreImages());
        expect(fetchNextPage).toHaveBeenCalledOnce();

        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            isFetchingNextPage: true
        };
        view.rerender(<SearchProvider><Consumer /></SearchProvider>);
        await act(() => latest.loadMoreImages());
        expect(fetchNextPage).toHaveBeenCalledOnce();
    });

    it('exposes valid facet names only while drilldown is active', async () => {
        mocks.statsQuery.current = {
            ...(mocks.statsQuery.current as object),
            data: { validNames: { checkpoints: ['model'] } }
        };
        renderProvider();
        await act(() => Promise.resolve());
        expect(latest.validFacetNames).toBeNull();
        act(() => latest.setFacetDrilldownActive(true));
        expect(latest.validFacetNames).toEqual({ checkpoints: ['model'] });

        mocks.statsQuery.current = {
            ...(mocks.statsQuery.current as object),
            data: {}
        };
    });

    it('falls back to null when active drilldown data has no valid names', async () => {
        renderProvider();
        await act(() => Promise.resolve());
        act(() => latest.setFacetDrilldownActive(true));
        expect(latest.validFacetNames).toBeNull();
    });

    it('prefetches eligible result pages after the delay and cancels on unmount', async () => {
        vi.useFakeTimers();
        mocks.shouldPrefetchResultPages.mockReturnValue(true);
        const fetchNextPage = (mocks.imagesQuery.current as { fetchNextPage: ReturnType<typeof vi.fn> }).fetchNextPage;
        const view = renderProvider();

        await act(() => vi.advanceTimersByTimeAsync(500));
        expect(fetchNextPage).toHaveBeenCalledOnce();
        view.unmount();
    });

    it('optimistically toggles favorites and pins, including explicit pin values', async () => {
        const original = image();
        const untouched = image({ id: 'image-2' });
        const pinned = image({ isPinned: true });
        (mocks.searchState.current as SearchValue).images = [original, untouched];
        (mocks.searchState.current as SearchValue).filters = { ...baseFilters, collectionId: 'smart-prompt' };
        mocks.applyOptimisticPinOrder.mockReturnValue([pinned]);
        renderProvider();

        await act(() => latest.toggleFavorite('missing'));
        await act(() => latest.toggleFavorite(original.id));
        await act(() => latest.togglePin('missing'));
        await act(() => latest.togglePin(original.id, true));

        expect(mocks.updateFavorite).toHaveBeenCalledWith(original.id, true);
        expect(mocks.updatePinned).toHaveBeenCalledWith(original.id, true);
        const refreshCollections = (mocks.collections.current as {
            refreshCollections: ReturnType<typeof vi.fn>;
        }).refreshCollections;
        expect(refreshCollections).toHaveBeenCalledTimes(2);
        expect(refreshCollections).toHaveBeenCalledWith(true);
        expect(mocks.refreshSmartCounts).toHaveBeenCalledTimes(2);
        expect(mocks.refreshSmartCounts).toHaveBeenCalledWith({
            collectionIds: ['smart-prompt'],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true
        });
        expect(mocks.patchImageFlagsInQueryCaches).toHaveBeenCalledWith(mocks.queryClient, [original.id], { isFavorite: true });
        const optimisticFavoriteImages = ((mocks.searchState.current as SearchValue).setImages as ReturnType<typeof vi.fn>).mock.calls[0][0] as AIImage[];
        expect(optimisticFavoriteImages[1]).toBe(untouched);
        expect(mocks.applyOptimisticPinOrder).toHaveBeenCalledWith(
            [expect.objectContaining({ id: original.id, isFavorite: true }), untouched],
            [original.id],
            true,
            true
        );
    });

    it('rolls optimistic favorite and pin updates back after persistence failures', async () => {
        const original = image({ isPinned: true });
        const next = image({ isPinned: false });
        (mocks.searchState.current as SearchValue).images = [original];
        mocks.updateFavorite.mockRejectedValueOnce(new Error('favorite failed'));
        mocks.updatePinned.mockRejectedValueOnce(new Error('pin failed'));
        mocks.applyOptimisticPinOrder.mockReturnValue([next]);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderProvider();

        await act(() => latest.toggleFavorite(original.id));
        await act(() => latest.togglePin(original.id));

        expect(mocks.restoreImagesInQueryCaches).toHaveBeenNthCalledWith(1, mocks.queryClient, [original]);
        expect(mocks.restoreImagesInQueryCaches).toHaveBeenNthCalledWith(2, mocks.queryClient, [original], {
            previousOrder: [next],
            nextOrder: [original],
            reorderQueryKey: latest.imagesQueryKey
        });
    });

    it('loads and persists recent searches and hidden-content preferences', async () => {
        vi.useFakeTimers();
        mocks.repository.load.mockResolvedValue({
            recentSearches: ['portrait'],
            settings: {}
        });
        mocks.settings.current = {
            settings: settings({ libraryShowGrids: true, libraryShowIntermediates: true }),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true
        };
        mocks.checkHiddenContentAvailability.mockResolvedValue({ hasIntermediates: true, hasGrids: true });
        renderProvider();

        await act(() => Promise.resolve());
        await act(() => Promise.resolve());
        expect(latest.recentSearches).toEqual(['portrait']);
        expect(latest.availableHiddenContent).toEqual({ hasIntermediates: true, hasGrids: true });
        expect((mocks.searchState.current as SearchValue).setFilters).toHaveBeenCalled();

        act(() => latest.setRecentSearches(['landscape']));
        await act(() => Promise.resolve());
        expect(mocks.repository.update).toHaveBeenCalledOnce();
        const recentSearchUpdater = mocks.repository.update.mock.calls[0][0] as (state: { recentSearches: string[] }) => { recentSearches: string[] };
        expect(recentSearchUpdater({ recentSearches: ['portrait'] }).recentSearches).toEqual(['landscape']);
        await act(() => latest.refreshHiddenAvailability());
    });

    it('hydrates view filters from initialized settings before enabling write-back', async () => {
        const currentSettings = settings({ libraryShowGrids: false, libraryShowIntermediates: false });
        const setSettings = vi.fn();
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        mocks.searchState.current = {
            ...(mocks.searchState.current as object),
            filters: { ...baseFilters, showGrids: true, showIntermediates: true }
        };
        mocks.settings.current = {
            settings: currentSettings,
            setSettings,
            privacyEnabled: false,
            isLoaded: true
        };
        renderProvider();

        await waitFor(() => expect(setFilters).toHaveBeenCalled());
        const updater = setFilters.mock.calls[0][0] as (value: FilterState) => Partial<FilterState>;
        expect(updater((mocks.searchState.current as SearchValue).filters)).toEqual(expect.objectContaining({
            showGrids: false,
            showIntermediates: false
        }));
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('falls back to the current grid value when only intermediates were persisted', async () => {
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        mocks.settings.current = {
            settings: settings({ libraryShowGrids: undefined, libraryShowIntermediates: true }),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true
        };
        renderProvider();
        await waitFor(() => expect(setFilters).toHaveBeenCalled());
        const updater = setFilters.mock.calls[0][0] as (value: FilterState) => Partial<FilterState>;
        expect(updater(baseFilters)).toEqual(expect.objectContaining({ showGrids: false, showIntermediates: true }));
    });

    it('does not write default view settings before settings initialization completes', async () => {
        const setSettings = vi.fn();
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        mocks.settings.current = {
            settings: settings(),
            setSettings,
            privacyEnabled: false,
            isLoaded: false
        };
        const rendered = renderProvider();

        await act(() => Promise.resolve());
        expect(setFilters).not.toHaveBeenCalled();
        expect(setSettings).not.toHaveBeenCalled();

        mocks.settings.current = {
            settings: settings({ libraryShowGrids: true, libraryShowIntermediates: true }),
            setSettings,
            privacyEnabled: false,
            isLoaded: true
        };
        rendered.rerender(<SearchProvider><Consumer /></SearchProvider>);
        await waitFor(() => expect(setFilters).toHaveBeenCalledOnce());
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('refreshes privacy indexes and dependent caches when hidden masking changes records', async () => {
        let resolveRebuild: (() => void) | undefined;
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: [' Face ', ''] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex.mockResolvedValue({ changed: true, updated: 2 });
        mocks.rebuildThumbnailFacetCache.mockReturnValueOnce(new Promise<void>(resolve => {
            resolveRebuild = resolve;
        }));
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        renderProvider();

        await waitFor(() => expect(mocks.rebuildThumbnailFacetCache).toHaveBeenCalledOnce());
        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('pending');
        await act(async () => resolveRebuild?.());
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
        expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledWith(['face']);
        expect(mocks.clearAllCollectionThumbnailCaches).toHaveBeenCalledOnce();
        expect(mocks.incrementFacetCacheVersion).toHaveBeenCalledOnce();
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['parameterRanges'] });
    });

    it('blocks stale search data and disables database queries while refresh is pending', async () => {
        let resolveRefresh: ((value: { changed: boolean; updated: number }) => void) | undefined;
        const staleImage = image({ id: 'stale' });
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        (mocks.searchState.current as SearchValue).images = [staleImage];
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [staleImage], totalCount: 1, globalCount: 1 }] },
        };
        mocks.refreshPrivacyMaskIndex.mockReturnValue(new Promise(resolve => {
            resolveRefresh = resolve;
        }));

        const view = renderProvider();

        expect(latest.images).toEqual([]);
        expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(false);
        view.unmount();
        await act(async () => resolveRefresh?.({ changed: false, updated: 0 }));
    });

    it('rebuilds privacy caches when only updated rows are reported', async () => {
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex.mockResolvedValue({ changed: false, updated: 1 });
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        renderProvider();
        await waitFor(() => expect(mocks.rebuildThumbnailFacetCache).toHaveBeenCalledOnce());
    });

    it('skips privacy cache rebuilds when the refreshed index is unchanged', async () => {
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        renderProvider();
        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledOnce());
        await act(() => Promise.resolve());
        expect(mocks.rebuildThumbnailFacetCache).not.toHaveBeenCalled();
    });

    it('fails closed when the privacy index refresh fails', async () => {
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex.mockRejectedValue(new Error('refresh failed'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderProvider();
        await waitFor(() => expect(console.error).toHaveBeenCalledWith(
            '[Privacy] Failed to refresh privacy mask index',
            expect.any(Error)
        ));
        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('failed');
        expect(useSettingsStore.getState().privacyMaskIndexError).toBe('refresh failed');
        expect(latest.images).toEqual([]);
    });

    it('retries a failed refresh and becomes ready only after retry succeeds', async () => {
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex
            .mockRejectedValueOnce(new Error('refresh failed'))
            .mockResolvedValueOnce({ changed: false, updated: 0 });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderProvider();

        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('failed'));
        act(() => useSettingsStore.getState().retryPrivacyMaskIndex());

        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
    });

    it('runs only the latest keyword refresh requested behind active work', async () => {
        let resolveFirst: ((value: { changed: boolean; updated: number }) => void) | undefined;
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskedKeywords: ['first'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex
            .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValue({ changed: false, updated: 0 });
        const view = renderProvider();
        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledWith(['first']));

        mocks.settings.current = {
            ...mocks.settings.current as object,
            settings: settings({ maskedKeywords: ['superseded'] }),
        };
        view.rerender(<SearchProvider><Consumer /></SearchProvider>);
        mocks.settings.current = {
            ...mocks.settings.current as object,
            settings: settings({ maskedKeywords: ['latest'] }),
        };
        view.rerender(<SearchProvider><Consumer /></SearchProvider>);

        await act(async () => resolveFirst?.({ changed: false, updated: 0 }));
        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledTimes(2));
        expect(mocks.refreshPrivacyMaskIndex).toHaveBeenLastCalledWith(['latest']);
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
    });

    it('ignores a privacy refresh result after unmount cancellation', async () => {
        let resolveRefresh: ((value: { changed: boolean; updated: number }) => void) | undefined;
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex.mockReturnValue(new Promise(resolve => {
            resolveRefresh = resolve;
        }));
        const view = renderProvider();
        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledOnce());
        view.unmount();
        await act(async () => resolveRefresh?.({ changed: false, updated: 0 }));
        expect(mocks.rebuildThumbnailFacetCache).not.toHaveBeenCalled();
    });

    it('ignores privacy refresh failures after unmount cancellation', async () => {
        let rejectRefresh: ((reason: Error) => void) | undefined;
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex.mockReturnValue(new Promise((_resolve, reject) => {
            rejectRefresh = reject;
        }));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const view = renderProvider();
        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledOnce());
        view.unmount();
        await act(async () => rejectRefresh?.(new Error('cancelled failure')));
        expect(console.error).toHaveBeenCalled();
    });
});
