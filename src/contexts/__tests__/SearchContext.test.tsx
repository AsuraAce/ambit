import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIImage, AppSettings, Collection, FilterState, SortOption } from '../../types';
import type { ImagesQueryKey } from '../../hooks/useImagesQuery';
import { SearchProvider, useSearch } from '../SearchContext';

type SearchValue = ReturnType<typeof useSearch>;

const mocks = vi.hoisted(() => ({
    settings: { current: {} as unknown },
    collections: { current: {} as unknown },
    searchState: { current: {} as unknown },
    imagesQuery: { current: {} as unknown },
    statsQuery: { current: {} as unknown },
    queryClient: {
        invalidateQueries: vi.fn().mockResolvedValue(undefined)
    },
    repository: {
        load: vi.fn(),
        save: vi.fn()
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
    shouldPrefetchResultPages: vi.fn()
}));

vi.mock('../SettingsContext', () => ({ useSettings: () => mocks.settings.current }));
vi.mock('../CollectionContext', () => ({ useCollections: () => mocks.collections.current }));
vi.mock('../../stores/searchStore', () => ({
    useSearchStore: Object.assign(
        () => mocks.searchState.current,
        { getState: () => mocks.searchState.current }
    )
}));
vi.mock('../../hooks/useImagesQuery', () => ({ useImagesQuery: () => mocks.imagesQuery.current }));
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
            isFetchingNextPage: false,
            isLoading: false,
            isPlaceholderData: false,
            queryKey: ['images', baseFilters, 'date_desc', false, 'blur', [], null] as ImagesQueryKey
        };
        mocks.statsQuery.current = {
            data: undefined,
            isFacetsFetching: false,
            isStatsSummaryLoading: false,
            isKeywordStatsLoading: false
        };
        mocks.repository.load.mockResolvedValue({ settings: {} });
        mocks.repository.save.mockResolvedValue(undefined);
        mocks.checkHiddenContentAvailability.mockResolvedValue({ hasIntermediates: false, hasGrids: false });
        mocks.buildSqlWhereClause.mockReturnValue({ where: 'deleted_at IS NULL', params: ['value'] });
        mocks.refreshPrivacyMaskIndex.mockResolvedValue({ changed: false, updated: 0 });
        mocks.updateFavorite.mockResolvedValue(undefined);
        mocks.updatePinned.mockResolvedValue(undefined);
        mocks.applyOptimisticPinOrder.mockImplementation((images: AIImage[]) => images);
        mocks.shouldPrefetchResultPages.mockReturnValue(false);
        mocks.browserMockMode.current = false;
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
        mocks.applyOptimisticPinOrder.mockReturnValue([pinned]);
        renderProvider();

        await act(() => latest.toggleFavorite('missing'));
        await act(() => latest.toggleFavorite(original.id));
        await act(() => latest.togglePin('missing'));
        await act(() => latest.togglePin(original.id, true));

        expect(mocks.updateFavorite).toHaveBeenCalledWith(original.id, true);
        expect(mocks.updatePinned).toHaveBeenCalledWith(original.id, true);
        expect(mocks.patchImageFlagsInQueryCaches).toHaveBeenCalledWith(mocks.queryClient, [original.id], { isFavorite: true });
        const optimisticFavoriteImages = ((mocks.searchState.current as SearchValue).setImages as ReturnType<typeof vi.fn>).mock.calls[0][0] as AIImage[];
        expect(optimisticFavoriteImages[1]).toBe(untouched);
        expect(mocks.applyOptimisticPinOrder).toHaveBeenCalledWith(
            [expect.objectContaining({ id: original.id, isFavorite: true }), untouched],
            [original.id],
            true,
            false
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
            settings: { libraryShowGrids: true, libraryShowIntermediates: true }
        });
        mocks.checkHiddenContentAvailability.mockResolvedValue({ hasIntermediates: true, hasGrids: true });
        renderProvider();

        await act(() => Promise.resolve());
        await act(() => Promise.resolve());
        expect(latest.recentSearches).toEqual(['portrait']);
        expect(latest.availableHiddenContent).toEqual({ hasIntermediates: true, hasGrids: true });
        expect((mocks.searchState.current as SearchValue).setFilters).toHaveBeenCalled();

        act(() => latest.setRecentSearches(['landscape']));
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(mocks.repository.save).toHaveBeenCalledWith(expect.objectContaining({ recentSearches: ['landscape'] }));
        await act(() => latest.refreshHiddenAvailability());
    });

    it('uses current filter values for missing persisted grid preferences and syncs changed settings', async () => {
        const currentSettings = settings({ libraryShowGrids: false, libraryShowIntermediates: false });
        const setSettings = vi.fn((updater: (value: AppSettings) => AppSettings) => updater(currentSettings));
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
        mocks.repository.load.mockResolvedValue({
            settings: { libraryShowGrids: true, libraryShowIntermediates: undefined }
        });
        renderProvider();

        await waitFor(() => expect(setFilters).toHaveBeenCalled());
        const updater = setFilters.mock.calls[0][0] as (value: FilterState) => Partial<FilterState>;
        expect(updater((mocks.searchState.current as SearchValue).filters)).toEqual(expect.objectContaining({
            showGrids: true,
            showIntermediates: true
        }));
        expect(setSettings).toHaveBeenCalledTimes(2);
    });

    it('falls back to the current grid value when only intermediates were persisted', async () => {
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        mocks.repository.load.mockResolvedValue({
            settings: { libraryShowGrids: undefined, libraryShowIntermediates: true }
        });
        renderProvider();
        await waitFor(() => expect(setFilters).toHaveBeenCalled());
        const updater = setFilters.mock.calls[0][0] as (value: FilterState) => Partial<FilterState>;
        expect(updater(baseFilters)).toEqual(expect.objectContaining({ showGrids: false, showIntermediates: true }));
    });

    it('refreshes privacy indexes and dependent caches when hidden masking changes records', async () => {
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: [' Face ', ''] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true
        };
        mocks.refreshPrivacyMaskIndex.mockResolvedValue({ changed: true, updated: 2 });
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        renderProvider();

        await waitFor(() => expect(mocks.rebuildThumbnailFacetCache).toHaveBeenCalledOnce());
        expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledWith(['face']);
        expect(mocks.clearAllCollectionThumbnailCaches).toHaveBeenCalledOnce();
        expect(mocks.incrementFacetCacheVersion).toHaveBeenCalledOnce();
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['parameterRanges'] });
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

    it('marks privacy initialization ready after refresh failures', async () => {
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
