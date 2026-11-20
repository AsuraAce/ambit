import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIImage, AppSettings, Collection, FilterState, SortOption } from '../../types';
import type { ImagesQueryKey } from '../../hooks/useImagesQuery';
import { SearchProvider, useSearch } from '../SearchContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { privacyMaskRefreshCoordinator } from '../../utils/privacyMaskRefreshCoordinator';
import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';
import { countPendingImageFieldWritesForTests } from '../../utils/imageFieldWrites';
import { ToastContext } from '../ToastContext';
import { OWNER_SWITCH_TOAST, startOwnerSwitchForTest } from '../../test/ownerSwitch';

type SearchValue = ReturnType<typeof useSearch>;

const mocks = vi.hoisted(() => ({
    settings: { current: {} as unknown },
    collections: { current: {} as unknown },
    searchState: { current: {} as unknown },
    imagesQuery: { current: {} as unknown },
    imagesQueryArgs: { current: null as { settingsLoaded?: boolean } | null },
    availabilityArgs: { current: null as { enabled: boolean } | null },
    scopeCountsArgs: { current: null as { enabled: boolean } | null },
    scopeQuery: { current: {} as unknown },
    availabilityQuery: { current: {} as unknown },
    statsQuery: { current: {} as unknown },
    queryClient: {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
        cancelQueries: vi.fn().mockResolvedValue(undefined),
    },
    repository: {
        load: vi.fn(),
        save: vi.fn(),
        update: vi.fn(),
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
    revertImageFieldsInQueryCaches: vi.fn(),
    applyOptimisticPinOrder: vi.fn(),
    incrementFacetCacheVersion: vi.fn(),
    incrementScopeCountsVersion: vi.fn(),
    shouldPrefetchResultPages: vi.fn(),
    refreshSmartCounts: vi.fn(),
    invalidateRetainedThumbnails: vi.fn(),
}));

vi.mock('../SettingsContext', () => ({ useSettings: () => mocks.settings.current }));
vi.mock('../CollectionContext', () => ({ useCollections: () => mocks.collections.current }));
vi.mock('../../stores/searchStore', () => ({
    useSearchStore: Object.assign(() => mocks.searchState.current, { getState: () => mocks.searchState.current }),
}));
vi.mock('../../hooks/useImagesQuery', () => ({
    useImagesQuery: (args: { settingsLoaded?: boolean }) => {
        mocks.imagesQueryArgs.current = args;
        return mocks.imagesQuery.current;
    },
}));
vi.mock('../../hooks/useLibraryStatsQuery', () => ({ useLibraryStatsQuery: () => mocks.statsQuery.current }));
vi.mock('../../hooks/useLibraryScopeAvailability', () => ({
    useLibraryScopeAvailability: (args: { enabled: boolean }) => {
        mocks.availabilityArgs.current = args;
        return mocks.availabilityQuery.current;
    },
}));
vi.mock('../../hooks/useLibraryScopeCounts', () => ({
    useLibraryScopeCounts: (args: { enabled: boolean }) => {
        mocks.scopeCountsArgs.current = args;
        return mocks.scopeQuery.current;
    },
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks.queryClient }));
vi.mock('../../services/repository', () => ({ appRepository: mocks.repository }));
vi.mock('../../services/db/connection', () => ({ getDb: mocks.getDb }));
vi.mock('../../bindings', () => ({ commands: { refreshPrivacyMaskIndex: mocks.refreshPrivacyMaskIndex } }));
vi.mock('../../utils/spectaUtils', () => ({ unwrap: mocks.unwrap }));
vi.mock('../../services/runtime', () => ({ isBrowserMockMode: () => mocks.browserMockMode.current }));
vi.mock('../../utils/sqlHelpers', () => ({ buildSqlWhereClause: mocks.buildSqlWhereClause }));
vi.mock('../../utils/filterState', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/filterState')>()),
    shouldPrefetchResultPages: mocks.shouldPrefetchResultPages,
}));
vi.mock('../../services/db/imageRepo', () => ({
    checkHiddenContentAvailability: mocks.checkHiddenContentAvailability,
    rebuildThumbnailFacetCache: mocks.rebuildThumbnailFacetCache,
    updateFavorite: mocks.updateFavorite,
    updatePinned: mocks.updatePinned,
}));
vi.mock('../../services/db/collectionRepo', () => ({
    clearAllCollectionThumbnailCaches: mocks.clearAllCollectionThumbnailCaches,
}));
vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: Object.assign(
        (selector: (state: { keywordStatsEnabled: boolean; isOwnerCacheRepairing: boolean }) => unknown) =>
            selector({ keywordStatsEnabled: false, isOwnerCacheRepairing: false }),
        {
            getState: () => ({
                incrementFacetCacheVersion: mocks.incrementFacetCacheVersion,
                incrementScopeCountsVersion: mocks.incrementScopeCountsVersion,
            }),
        }
    ),
}));
vi.mock('../../stores/collectionStore', () => ({
    useCollectionStore: Object.assign(
        (selector: (state: { refreshSmartCounts: typeof mocks.refreshSmartCounts }) => unknown) =>
            selector({ refreshSmartCounts: mocks.refreshSmartCounts }),
        { getState: () => ({ invalidateRetainedThumbnails: mocks.invalidateRetainedThumbnails }) }
    ),
}));
vi.mock('../../utils/imageQueryCache', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/imageQueryCache')>()),
    patchImageFlagsInQueryCaches: mocks.patchImageFlagsInQueryCaches,
    revertImageFieldsInQueryCaches: mocks.revertImageFieldsInQueryCaches,
}));
vi.mock('../../utils/imageOptimisticUpdates', () => ({
    applyOptimisticPinOrder: mocks.applyOptimisticPinOrder,
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
    showIntermediates: false,
    showInvokeImageAssets: false,
    sourceKind: 'all',
};

const image = (overrides: Partial<AIImage> = {}): AIImage =>
    ({
        id: 'image-1',
        path: 'C:/images/image-1.png',
        url: 'asset://image-1',
        filename: 'image-1.png',
        timestamp: 1,
        isFavorite: false,
        isPinned: false,
        ...overrides,
    }) as AIImage;

const settings = (overrides: Partial<AppSettings> = {}): AppSettings =>
    ({
        maskingMode: 'blur',
        promptMaskingEnabled: true,
        maskedKeywords: [],
        libraryShowGrids: false,
        libraryShowIntermediates: false,
        libraryShowInvokeImageAssets: false,
        librarySourceKind: 'all',
        ...overrides,
    }) as AppSettings;

let latest: SearchValue;

const Consumer = () => {
    latest = useSearch();
    return <div>{latest.images.length}</div>;
};

const renderProvider = () =>
    render(
        <SearchProvider>
            <Consumer />
        </SearchProvider>
    );

describe('SearchProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        latest = undefined as unknown as SearchValue;
        mocks.availabilityArgs.current = null;
        mocks.scopeCountsArgs.current = null;
        mocks.scopeQuery.current = { data: undefined, isPending: true, isError: false, isFetching: false, refetch: vi.fn() };
        mocks.availabilityQuery.current = { data: undefined, isPending: true, isError: false, isFetching: false, refetch: vi.fn() };

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
            clearAllFilters: vi.fn(),
        };
        mocks.settings.current = {
            settings: settings(),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true,
        };
        mocks.collections.current = {
            collections: [] as Collection[],
            smartCollections: [] as Collection[],
            refreshCollections: vi.fn().mockResolvedValue(undefined),
            isLoaded: true,
        };
        mocks.imagesQuery.current = {
            data: undefined,
            fetchNextPage: vi.fn().mockResolvedValue(undefined),
            hasNextPage: false,
            isFetching: false,
            isFetchingNextPage: false,
            isLoading: false,
            isPlaceholderData: false,
            queryKey: ['images', baseFilters, 'date_desc', false, 'blur', [], null, 'invoke:none'] as ImagesQueryKey,
        };
        mocks.imagesQueryArgs.current = null;
        mocks.statsQuery.current = {
            data: undefined,
            isFacetsFetching: false,
            isStatsSummaryLoading: false,
            isKeywordStatsLoading: false,
        };
        mocks.repository.load.mockResolvedValue({ settings: {} });
        mocks.repository.save.mockResolvedValue(undefined);
        mocks.repository.update.mockImplementation(async (updater: (state: unknown) => unknown) =>
            updater({
                images: [],
                collections: [],
                smartCollections: [],
                settings: settings(),
                recentSearches: ['portrait'],
            })
        );
        mocks.checkHiddenContentAvailability.mockResolvedValue({ hasIntermediates: false, hasGrids: false, hasInvokeImageAssets: false });
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
        useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
    });

    afterEach(() => vi.useRealTimers());

    it('admits background work only after a successful current safe page, including an empty library', async () => {
        const view = renderProvider();
        expect(latest.isLibraryReady).toBe(false);
        mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), status: 'error' };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(latest.isLibraryReady).toBe(false);
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [] }] },
            counts: { totalCount: 0, globalCount: 0 },
            status: 'success',
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(latest.isLibraryReady).toBe(true);
        mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), isPlaceholderData: true };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        // Normal filtering must retain the existing foreground-query throttle, not cancel maintenance.
        expect(latest.isLibraryReady).toBe(true);
        mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), isPlaceholderData: false, status: 'error' };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(latest.isLibraryReady).toBe(true);
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            queryKey: ['images', baseFilters, 'date_desc', false, 'blur', [], null, 'invoke:different-owner'],
            isPlaceholderData: true,
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(latest.isLibraryReady).toBe(false);
        await act(async () => {
            await Promise.resolve();
        });
    });

    it('requires consumers to be rendered within the provider', () => {
        expect(() => render(<Consumer />)).toThrow('useSearch must be used within SearchProvider');
    });

    it('blocks and cancels library-derived queries until the configured InvokeAI root is admitted', async () => {
        mocks.settings.current = {
            settings: settings({ invokeAiPath: 'D:/Invoke' }),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true,
        };

        renderProvider();

        expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(false);
        expect(mocks.checkHiddenContentAvailability).not.toHaveBeenCalled();
        await waitFor(() => expect(mocks.queryClient.cancelQueries).toHaveBeenCalledTimes(4));
        expect(mocks.queryClient.cancelQueries.mock.calls.map(([filter]) => filter.queryKey)).toEqual([
            ['images'],
            ['libraryStats'],
            ['libraryKeywordStats'],
            ['parameterRanges'],
        ]);
    });

    it('enables library-derived queries for the matching admitted InvokeAI root', async () => {
        mocks.settings.current = {
            settings: settings({ invokeAiPath: 'D:/Invoke' }),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true,
        };
        useInvokeOwnerScopeStore.getState().setOwnerScopeState({
            status: 'ready',
            rootPath: 'D:/Invoke',
        });

        renderProvider();

        expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(true);
        await waitFor(() => expect(mocks.checkHiddenContentAvailability).toHaveBeenCalledOnce());
        expect(mocks.queryClient.cancelQueries).not.toHaveBeenCalled();
    });

    it('admits optional counts only after a settled safe page, including an empty page', async () => {
        const view = renderProvider();
        await act(async () => {});
        expect(mocks.availabilityArgs.current?.enabled).toBe(false);
        expect(mocks.scopeCountsArgs.current?.enabled).toBe(false);
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            status: 'success',
            data: { pages: [{ images: [] }] },
            counts: { totalCount: 0, globalCount: 0 },
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(latest.isLibraryReady).toBe(true);
        expect(mocks.availabilityArgs.current?.enabled).toBe(true);
        expect(mocks.scopeCountsArgs.current?.enabled).toBe(true);
        mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), isPlaceholderData: true, isFetching: true };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(mocks.availabilityArgs.current?.enabled).toBe(false);
        expect(mocks.scopeCountsArgs.current?.enabled).toBe(false);
    });

    it.each(['pending', 'failed'] as const)(
        'keeps gallery readiness independent of %s optional counts and retries only failures',
        async (state) => {
            const failedRetry = vi.fn().mockResolvedValue(undefined);
            const successfulRetry = vi.fn().mockResolvedValue(undefined);
            mocks.imagesQuery.current = {
                ...(mocks.imagesQuery.current as object),
                status: 'success',
                data: { pages: [{ images: [image()] }] },
                counts: { totalCount: 1, globalCount: 5 },
            };
            mocks.scopeQuery.current = {
                data: undefined,
                isPending: state === 'pending',
                isFetching: state === 'pending',
                isError: state === 'failed',
                refetch: failedRetry,
            };
            mocks.availabilityQuery.current = {
                data: undefined,
                isPending: false,
                isError: false,
                isFetching: false,
                refetch: successfulRetry,
            };
            const view = renderProvider();
            await act(async () => {});
            expect(latest.isLibraryReady).toBe(true);
            expect(latest.images).toEqual([image()]);
            expect(latest.scopeCounts).toBeUndefined();
            expect(latest.scopeResultCount).toBe(1);
            expect(latest.scopeCountsError).toBe(state === 'failed');
            expect(latest.scopeCountsLoading).toBe(state === 'pending');
            await act(async () => latest.retryScopeCounts());
            expect(failedRetry).toHaveBeenCalledTimes(state === 'failed' ? 1 : 0);
            expect(successfulRetry).not.toHaveBeenCalled();
            expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalled();
            mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), isFetching: true, isPlaceholderData: true };
            view.rerender(
                <SearchProvider>
                    <Consumer />
                </SearchProvider>
            );
            expect(latest.scopeResultCount).toBeUndefined();
            expect(latest.scopeCountsError).toBe(false);
            await act(async () => latest.retryScopeCounts());
            expect(failedRetry).toHaveBeenCalledTimes(state === 'failed' ? 1 : 0);
        }
    );

    it('never shows the previous search total in the scope dropdown while the new count loads', async () => {
        // The header may keep the last count to avoid a flash, but the dropdown labels this page's results.
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            status: 'success',
            isPlaceholderData: false,
            data: { pages: [{ images: [image()] }] },
            counts: { totalCount: 40, globalCount: 50 },
            countsArePlaceholder: true,
        };
        renderProvider();
        await act(async () => {});

        expect(latest.totalImages).toBe(40);
        expect(latest.scopeResultCount).toBeUndefined();
    });

    it('does not start a queued privacy refresh after InvokeAI admission closes', async () => {
        let resolveDb: (() => void) | undefined;
        mocks.settings.current = {
            settings: settings({ invokeAiPath: 'D:/Invoke', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true,
        };
        useSettingsStore.setState({ privacyEnabled: true });
        useInvokeOwnerScopeStore.getState().setOwnerScopeState({
            status: 'ready',
            rootPath: 'D:/Invoke',
        });
        mocks.getDb.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveDb = resolve;
            })
        );

        renderProvider();
        await waitFor(() => expect(mocks.getDb).toHaveBeenCalledOnce());

        act(() => {
            useInvokeOwnerScopeStore.getState().setOwnerScopeState({
                status: 'applying',
                rootPath: 'D:/Invoke',
            });
        });
        await act(async () => resolveDb?.());

        expect(mocks.refreshPrivacyMaskIndex).not.toHaveBeenCalled();
        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('pending');
    });

    it('exposes query data, stats, facets, SQL state, and synchronizes query images', async () => {
        const first = image();
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [first] }] },
            counts: { totalCount: 4, globalCount: 9 },
            hasNextPage: true,
            isLoading: true,
        };
        mocks.statsQuery.current = {
            data: {
                facets: {
                    checkpoints: [{ name: 'model', count: 1 }],
                    loras: [],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: [],
                },
                stats: { totalImages: 4, totalGenerations: 3, avgSteps: 20, estSizeMB: '1', modelStats: [], keywordStats: [] },
                validNames: { checkpoints: ['model'] },
            },
            isFacetsFetching: true,
            isStatsSummaryLoading: true,
            isKeywordStatsLoading: true,
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
            isLoaded: true,
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [previous] }] },
            counts: { totalCount: 1, globalCount: 9 },
            isFetching: true,
            isPlaceholderData: true,
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
            isLoaded: true,
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [blurred] }] },
            counts: { totalCount: 1, globalCount: 2 },
            queryKey: ['images', baseFilters, 'date_desc', true, 'blur', ['face'], null, 'invoke:none'] as ImagesQueryKey,
        };
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const view = renderProvider();
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
        await waitFor(() => expect(latest.images).toEqual([blurred]));

        mocks.settings.current = {
            ...(mocks.settings.current as object),
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: undefined,
            isFetching: true,
            queryKey: ['images', baseFilters, 'date_desc', true, 'hide', ['face'], null, 'invoke:none'] as ImagesQueryKey,
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );

        await waitFor(() => expect(latest.images).toEqual([]));
        expect(latest.globalTotal).toBe(0);
        expect(latest.isFiltering).toBe(true);

        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [safe] }] },
            counts: { totalCount: 1, globalCount: 2 },
            isFetching: false,
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );

        await waitFor(() => expect(latest.images).toEqual([safe]));
        expect(latest.globalTotal).toBe(2);
    });

    it('never exposes stored blur results while switching to cached hide results', async () => {
        const blurred = image({ id: 'blurred' });
        const safe = image({ id: 'safe' });
        const observedImageIds: string[][] = [];
        const TransitionConsumer = () => {
            latest = useSearch();
            observedImageIds.push(latest.images.map((item) => item.id));
            return null;
        };
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskingMode: 'blur', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true,
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [blurred] }] },
            counts: { totalCount: 1, globalCount: 2 },
            queryKey: ['images', baseFilters, 'date_desc', true, 'blur', ['face'], null, 'invoke:none'] as ImagesQueryKey,
        };
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const view = render(
            <SearchProvider>
                <TransitionConsumer />
            </SearchProvider>
        );
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
        await waitFor(() => expect(latest.images).toEqual([blurred]));
        observedImageIds.length = 0;

        mocks.settings.current = {
            ...(mocks.settings.current as object),
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
        };
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [safe] }] },
            counts: { totalCount: 1, globalCount: 2 },
            queryKey: ['images', baseFilters, 'date_desc', true, 'hide', ['face'], null, 'invoke:none'] as ImagesQueryKey,
        };
        view.rerender(
            <SearchProvider>
                <TransitionConsumer />
            </SearchProvider>
        );

        expect(observedImageIds).not.toContainEqual(['blurred']);
        await waitFor(() => expect(latest.images).toEqual([safe]));
    });

    describe('opening another view (#479)', () => {
        // The store keeps the last page it was given. A newly opened collection, smart collection or
        // Library must show the loading skeleton (no images, filtering) rather than that page, while a
        // refresh of the same view must keep it so imports and mask changes do not blank the grid.
        const libraryImage = image({ id: 'library' });
        const holidayImage = image({ id: 'holiday' });
        const keyFor = (collectionId: string | null): ImagesQueryKey => [
            'images',
            { ...baseFilters, collectionId },
            'date_desc',
            false,
            'blur',
            [],
            null,
            'invoke:none',
        ];
        const showView = (
            view: ReturnType<typeof renderProvider>,
            collectionId: string | null,
            query: Record<string, unknown>,
            collectionsLoaded = true
        ) => {
            const state = mocks.searchState.current as SearchValue;
            state.filters = { ...baseFilters, collectionId };
            mocks.collections.current = { ...(mocks.collections.current as object), isLoaded: collectionsLoaded };
            mocks.imagesQuery.current = {
                ...(mocks.imagesQuery.current as object),
                isLoading: false,
                isFetching: false,
                status: 'success',
                queryKey: keyFor(collectionId),
                ...query,
            };
            // The mocked store does not re-render on setImages as Zustand does, so render twice:
            // once to run the sync effect and once to read what it stored.
            for (let pass = 0; pass < 2; pass++) {
                view.rerender(
                    <SearchProvider>
                        <Consumer />
                    </SearchProvider>
                );
            }
        };
        const openLibrary = () => {
            mocks.imagesQuery.current = {
                ...(mocks.imagesQuery.current as object),
                data: { pages: [{ images: [libraryImage] }] },
                status: 'success',
                queryKey: keyFor(null),
            };
            const view = renderProvider();
            expect(latest.images).toEqual([libraryImage]);
            return view;
        };
        const loading = { data: undefined, isLoading: true, isFetching: true, status: 'pending' };

        it('shows the skeleton, not the Library, while a collection loads, then its own page', () => {
            const view = openLibrary();

            showView(view, 'holiday', loading);
            expect(latest.images).toEqual([]);
            expect(latest.isFiltering).toBe(true);

            showView(view, 'holiday', { data: { pages: [{ images: [holidayImage] }] } });
            expect(latest.images).toEqual([holidayImage]);
        });

        it('shows the skeleton, not the collection, while another collection or the Library loads', () => {
            const view = openLibrary();
            showView(view, 'holiday', { data: { pages: [{ images: [holidayImage] }] } });

            showView(view, 'portraits', loading);
            expect(latest.images).toEqual([]);

            showView(view, 'holiday', { data: { pages: [{ images: [holidayImage] }] } });
            showView(view, null, loading);
            expect(latest.images).toEqual([]);
            expect(latest.isFiltering).toBe(true);
        });

        it('keeps the page through a refetch or invalidation of the same view', () => {
            const view = openLibrary();

            showView(view, null, { data: { pages: [{ images: [libraryImage] }] }, isFetching: true });
            expect(latest.images).toEqual([libraryImage]);
            // Even a refetch that briefly has no data is the same view, so the page stays.
            showView(view, null, loading);
            expect(latest.images).toEqual([libraryImage]);
        });

        it('keeps the page when a refresh of the same view fails, with or without cached data', () => {
            const view = openLibrary();

            showView(view, null, { data: { pages: [{ images: [libraryImage] }] }, status: 'error', isError: true });
            expect(latest.images).toEqual([libraryImage]);
            showView(view, null, { data: undefined, status: 'error', isError: true });
            expect(latest.images).toEqual([libraryImage]);
        });

        it('waits for database queries to be enabled before clearing a view', () => {
            const view = openLibrary();

            showView(view, 'holiday', { ...loading, isFetching: false }, false);
            expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(false);
            expect(latest.images).toEqual([libraryImage]);

            showView(view, 'holiday', loading);
            expect(latest.images).toEqual([]);
        });
    });

    it('reports a failed first page, and Retry reloads that view and its counts (#483)', () => {
        // With no page, a failure must read as a failure, not as an empty library or no matches.
        const failed = { data: undefined, status: 'error', error: new Error('database is locked'), isLoading: false, isFetching: false };
        mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), ...failed };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderProvider();

        expect(latest.imagesFailed).toBe(true);
        expect(errorSpy).toHaveBeenCalledWith('[Library] Failed to load images', failed.error);
        act(() => latest.retryImages());
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: latest.imagesQueryKey });

        // While the retry runs the view is loading, not failed.
        mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), isFetching: true };
        renderProvider();
        expect(latest.imagesFailed).toBe(false);
        expect(latest.isFiltering).toBe(true);
    });

    describe('a failed first page under privacy protection (#491)', () => {
        // Privacy protection waits for a page of the current masking rules. When that page fails, the
        // wait must end in the load error with Retry, yet nothing from another scope may be drawn: the
        // store can still hold an earlier page, and an import can write into it meanwhile.
        type Scope = { privacyEnabled: boolean; maskingMode: AppSettings['maskingMode']; maskedKeywords: string[] };
        const blurFace: Scope = { privacyEnabled: true, maskingMode: 'blur', maskedKeywords: ['face'] };
        const hideFace: Scope = { ...blurFace, maskingMode: 'hide' };
        const outside = image({ id: 'outside-scope' });
        const safe = image({ id: 'safe' });
        const fetching = { data: undefined, status: 'pending', error: null, isLoading: true, isFetching: true };
        const failed = {
            data: undefined,
            status: 'error',
            error: new Error('database is locked'),
            isLoading: false,
            isFetching: false,
            // The counts of the new scope and a next page must stay withheld with the page.
            counts: { totalCount: 4, globalCount: 9 },
            hasNextPage: true,
        };
        // Every images array the provider hands out, which is exactly what the grid draws.
        let observed: string[][] = [];
        const Recorder = () => {
            latest = useSearch();
            observed.push(latest.images.map((item) => item.id));
            return null;
        };
        const tree = () => (
            <SearchProvider>
                <Recorder />
            </SearchProvider>
        );
        const applyScope = (scope: Scope) => {
            useSettingsStore.setState({ privacyEnabled: scope.privacyEnabled });
            mocks.settings.current = {
                settings: settings({ maskingMode: scope.maskingMode, maskedKeywords: scope.maskedKeywords }),
                setSettings: vi.fn(),
                privacyEnabled: scope.privacyEnabled,
                isLoaded: true,
            };
        };
        const keyFor = (scope: Scope): ImagesQueryKey => [
            'images',
            baseFilters,
            'date_desc',
            scope.privacyEnabled,
            scope.maskingMode,
            scope.maskedKeywords,
            null,
            'invoke:none',
        ];
        const setQuery = (scope: Scope, query: Record<string, unknown>) => {
            mocks.imagesQuery.current = { ...(mocks.imagesQuery.current as object), queryKey: keyFor(scope), ...query };
        };
        // The mocked store does not re-render on setImages as Zustand does, so render twice.
        const show = (view: ReturnType<typeof render>) => {
            for (let pass = 0; pass < 2; pass++) view.rerender(tree());
        };
        const expectFailedClosed = () => {
            expect(latest.imagesFailed).toBe(true);
            expect(latest.isFiltering).toBe(false);
            expect(latest.privacyExposureBlocked).toBe(true);
            expect(latest.isLibraryReady).toBe(false);
            expect(latest.images).toEqual([]);
            // The new scope's counts stay withheld and read as unknown, not as an empty library.
            expect(latest.totalImages).toBeNull();
            expect(latest.globalTotal).toBeNull();
            expect(latest.imageCountsFailed).toBe(false);
            expect(latest.hasMoreImages).toBe(false);
            expect(latest.facets.checkpoints).toEqual([]);
        };
        const openScope = async (scope: Scope) => {
            applyScope(scope);
            setQuery(scope, { data: { pages: [{ images: [outside] }] }, status: 'success', isLoading: false, isFetching: false });
            const view = render(tree());
            await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
            await waitFor(() => expect(latest.images).toEqual([outside]));
            observed = [];
            return view;
        };
        const failAfterChange = async (from: Scope, to: Scope) => {
            const view = await openScope(from);
            applyScope(to);
            setQuery(to, fetching);
            show(view);
            await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
            await waitFor(() => expect(latest.isFiltering).toBe(true));
            expect(latest.images).toEqual([]);

            // The facet query keeps the previous scope's names as placeholder data.
            mocks.statsQuery.current = {
                ...(mocks.statsQuery.current as object),
                data: { facets: { checkpoints: [{ name: 'masked-model', count: 1 }] } },
            };
            setQuery(to, failed);
            show(view);
            return view;
        };

        beforeEach(() => {
            observed = [];
            vi.spyOn(console, 'info').mockImplementation(() => undefined);
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
        });

        it('ends startup preparation in the load error, never showing a stored image', async () => {
            applyScope(blurFace);
            (mocks.searchState.current as SearchValue).images = [outside];
            setQuery(blurFace, failed);
            const view = render(tree());

            await waitFor(() => expect(latest.imagesFailed).toBe(true));
            expectFailedClosed();

            // An import that prepends into the store while the error shows is not drawn either.
            act(() => (mocks.searchState.current as SearchValue).setImages([outside]));
            show(view);
            expectFailedClosed();
            expect(observed.flat()).not.toContain(outside.id);
        });

        it.each([
            ['blur to hide', blurFace, hideFace],
            ['adding a masked keyword', blurFace, { ...blurFace, maskedKeywords: ['face', 'hand'] }],
            ['turning privacy on', { ...blurFace, privacyEnabled: false }, blurFace],
        ])('ends a scope change (%s) in the load error, never showing the previous scope', async (_case, from, to) => {
            await failAfterChange(from, to);

            expectFailedClosed();
            expect(observed.flat()).not.toContain(outside.id);
        });

        it('shows the error again when Retry fails again', async () => {
            const view = await failAfterChange(blurFace, hideFace);
            expectFailedClosed();

            act(() => latest.retryImages());
            expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: keyFor(hideFace) });
            setQuery(hideFace, fetching);
            show(view);
            // While Retry runs the view is loading, as any first page is.
            expect(latest.imagesFailed).toBe(false);
            expect(latest.isFiltering).toBe(true);
            expect(latest.images).toEqual([]);

            setQuery(hideFace, failed);
            show(view);
            expectFailedClosed();
            expect(observed.flat()).not.toContain(outside.id);
        });

        it('shows only the current scope when Retry succeeds', async () => {
            const view = await failAfterChange(blurFace, hideFace);
            expectFailedClosed();

            act(() => latest.retryImages());
            setQuery(hideFace, fetching);
            show(view);
            setQuery(hideFace, {
                data: { pages: [{ images: [safe] }] },
                status: 'success',
                error: null,
                isFetching: false,
                isLoading: false,
                hasNextPage: false,
            });
            show(view);

            expect(latest.images).toEqual([safe]);
            expect(latest.privacyExposureBlocked).toBe(false);
            expect(latest.imagesFailed).toBe(false);
            expect(observed.flat()).not.toContain(outside.id);
        });
    });

    it('presents a first page before its counts and reports the counts as loading', () => {
        // The gallery opens as soon as its page is safe; the counts follow on their own.
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [image()] }] },
            counts: undefined,
            status: 'success',
        };

        renderProvider();

        expect(latest.isLibraryReady).toBe(true);
        expect(latest.images).toEqual([image()]);
        expect(latest.totalImages).toBeNull();
        expect(latest.globalTotal).toBeNull();
        expect(latest.scopeResultCount).toBeUndefined();
    });

    it('reports a cached first-page refresh as filtering without losing the global count', () => {
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [] }] },
            counts: { totalCount: 0, globalCount: 9 },
            isFetching: true,
        };

        renderProvider();

        expect(latest.globalTotal).toBe(9);
        expect(latest.isFiltering).toBe(true);
    });

    it('supports functional sorting, loading, fetch adapters, clearing, and metadata refresh scopes', async () => {
        renderProvider();
        const state = mocks.searchState.current as SearchValue;
        const fetchNextPage = (mocks.imagesQuery.current as { fetchNextPage: ReturnType<typeof vi.fn> }).fetchNextPage;

        act(() => latest.setSortOption((previous) => (previous === 'date_desc' ? 'name_asc' : 'date_desc')));
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

    it('keeps the filter reset callback stable across provider rerenders', () => {
        const view = renderProvider();
        const initialClearAllFilters = latest.clearAllFilters;

        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );

        expect(latest.clearAllFilters).toBe(initialClearAllFilters);
    });

    it('advances optional count identity on forced refresh without awaiting or eagerly refetching them', async () => {
        renderProvider();
        await act(async () => {});
        mocks.queryClient.invalidateQueries.mockImplementation(({ queryKey }: { queryKey: string[] }) =>
            queryKey[0] === 'images' ? Promise.resolve() : new Promise(() => {})
        );
        await act(async () => latest.fetchData(false));
        expect(mocks.incrementScopeCountsVersion).toHaveBeenCalledOnce();
        expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: ['libraryStats', 'scopeCounts'] })
        );
        expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalledWith(
            expect.objectContaining({ queryKey: ['libraryStats', 'scopeAvailability'] })
        );
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['images'] });
        mocks.queryClient.invalidateQueries.mockResolvedValue(undefined);
    });

    it('loads another page only when a next page is available and idle', async () => {
        const fetchNextPage = vi.fn().mockResolvedValue(undefined);
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            fetchNextPage,
            hasNextPage: true,
            isFetchingNextPage: false,
        };
        const view = renderProvider();
        await act(() => latest.loadMoreImages());
        expect(fetchNextPage).toHaveBeenCalledOnce();

        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            isFetchingNextPage: true,
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        await act(() => latest.loadMoreImages());
        expect(fetchNextPage).toHaveBeenCalledOnce();
    });

    it('exposes valid facet names only while drilldown is active', async () => {
        mocks.statsQuery.current = {
            ...(mocks.statsQuery.current as object),
            data: { validNames: { checkpoints: ['model'] } },
        };
        renderProvider();
        await act(() => Promise.resolve());
        expect(latest.validFacetNames).toBeNull();
        act(() => latest.setFacetDrilldownActive(true));
        expect(latest.validFacetNames).toEqual({ checkpoints: ['model'] });

        mocks.statsQuery.current = {
            ...(mocks.statsQuery.current as object),
            data: {},
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
        const refreshCollections = (
            mocks.collections.current as {
                refreshCollections: ReturnType<typeof vi.fn>;
            }
        ).refreshCollections;
        expect(refreshCollections).toHaveBeenCalledTimes(2);
        expect(refreshCollections).toHaveBeenCalledWith(true);
        expect(mocks.refreshSmartCounts).toHaveBeenCalledTimes(2);
        expect(mocks.refreshSmartCounts).toHaveBeenCalledWith({
            collectionIds: ['smart-prompt'],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true,
        });
        expect(mocks.patchImageFlagsInQueryCaches).toHaveBeenCalledWith(mocks.queryClient, [original.id], { isFavorite: true });
        const optimisticFavoriteImages = ((mocks.searchState.current as SearchValue).setImages as ReturnType<typeof vi.fn>).mock
            .calls[0][0] as AIImage[];
        expect(optimisticFavoriteImages[1]).toBe(untouched);
        expect(mocks.applyOptimisticPinOrder).toHaveBeenCalledWith(
            [expect.objectContaining({ id: original.id, isFavorite: true }), untouched],
            [original.id],
            true,
            true
        );
    });

    // #527: during an owner switch the backend scope belongs to the target owner, so the write would land in
    // the wrong owner's view and the optimistic change would show something that never happened.
    it('refuses favorite and pin toggles while an owner switch is pending', async () => {
        const original = image();
        (mocks.searchState.current as SearchValue).images = [original];
        const addToast = vi.fn();
        render(
            <ToastContext.Provider value={{ addToast, removeToast: vi.fn() }}>
                <SearchProvider>
                    <Consumer />
                </SearchProvider>
            </ToastContext.Provider>
        );
        startOwnerSwitchForTest();

        await act(() => latest.toggleFavorite(original.id));
        await act(() => latest.togglePin(original.id, true));

        expect(addToast).toHaveBeenCalledTimes(2);
        expect(addToast).toHaveBeenCalledWith(OWNER_SWITCH_TOAST, 'info');
        expect(mocks.updateFavorite).not.toHaveBeenCalled();
        expect(mocks.updatePinned).not.toHaveBeenCalled();
        expect((mocks.searchState.current as SearchValue).setImages).not.toHaveBeenCalled();
        expect(mocks.patchImageFlagsInQueryCaches).not.toHaveBeenCalled();
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

        // Each rollback reverts only the field its write changed (#492).
        expect(mocks.revertImageFieldsInQueryCaches).toHaveBeenNthCalledWith(
            1,
            mocks.queryClient,
            new Map([[original.id, { isFavorite: false }]])
        );
        expect(mocks.revertImageFieldsInQueryCaches).toHaveBeenNthCalledWith(
            2,
            mocks.queryClient,
            new Map([[original.id, { isPinned: true }]]),
            {
                previousOrder: [next],
                nextOrder: [original],
                reorderQueryKey: latest.imagesQueryKey,
            }
        );
    });

    it('keeps the newly opened view when a favorite or pin write from the previous view fails (#484)', async () => {
        // The rollback may revert only what the write changed; restoring the old view's snapshot would
        // put images from outside the open collection on screen.
        const libraryImage = image({ id: 'library' });
        const holidayImage = image({ id: 'holiday' });
        const state = mocks.searchState.current as SearchValue;
        state.images = [libraryImage];
        mocks.applyOptimisticPinOrder.mockImplementation((images: AIImage[]) => images);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let failFavorite: (error: Error) => void = () => undefined;
        let failPin: (error: Error) => void = () => undefined;
        mocks.updateFavorite.mockReturnValueOnce(new Promise((_, reject) => (failFavorite = reject)));
        mocks.updatePinned.mockReturnValueOnce(new Promise((_, reject) => (failPin = reject)));
        renderProvider();

        let favoriteWrite: Promise<void> = Promise.resolve();
        let pinWrite: Promise<void> = Promise.resolve();
        act(() => {
            favoriteWrite = latest.toggleFavorite(libraryImage.id);
            pinWrite = latest.togglePin(libraryImage.id);
        });
        state.images = [holidayImage];
        await act(async () => {
            failFavorite(new Error('favorite failed'));
            failPin(new Error('pin failed'));
            await Promise.all([favoriteWrite, pinWrite]);
        });

        expect(state.images).toEqual([holidayImage]);
        // The caches revert only the image each write touched, and only the field it changed.
        expect(mocks.revertImageFieldsInQueryCaches).toHaveBeenNthCalledWith(
            1,
            mocks.queryClient,
            new Map([[libraryImage.id, { isFavorite: false }]])
        );
        expect(mocks.revertImageFieldsInQueryCaches).toHaveBeenNthCalledWith(
            2,
            mocks.queryClient,
            new Map([[libraryImage.id, { isPinned: false }]]),
            expect.objectContaining({ nextOrder: [{ ...libraryImage, isFavorite: true }] })
        );
        // The list moved on, so the reverted pin is re-sorted from the database.
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['images'] });
    });

    // A failed write reverts only the field it changed: the other action's change is in the database
    // and must stay on screen (#492).
    it.each([
        ['favorite', 'pin', { isFavorite: false, isPinned: true }],
        ['pin', 'favorite', { isFavorite: true, isPinned: false }],
    ] as const)('reverts only the %s when its write fails and a %s landed meanwhile (#492)', async (failing, landing, expected) => {
        const pictured = image();
        const state = mocks.searchState.current as SearchValue;
        state.images = [pictured];
        mocks.applyOptimisticPinOrder.mockImplementation((images: AIImage[], ids: string[], isPinned: boolean) =>
            images.map((item) => (ids.includes(item.id) ? { ...item, isPinned } : item))
        );
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let fail: (error: Error) => void = () => undefined;
        const failingWrite = failing === 'favorite' ? mocks.updateFavorite : mocks.updatePinned;
        failingWrite.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
        const toggle = (kind: 'favorite' | 'pin') =>
            kind === 'favorite' ? latest.toggleFavorite(pictured.id) : latest.togglePin(pictured.id);
        renderProvider();

        let pendingWrite: Promise<void> = Promise.resolve();
        act(() => {
            pendingWrite = toggle(failing);
        });
        await act(() => toggle(landing));
        await act(async () => {
            fail(new Error('database is locked'));
            await pendingWrite;
        });

        expect(state.images).toEqual([expect.objectContaining({ id: pictured.id, ...expected })]);
        expect(countPendingImageFieldWritesForTests()).toBe(0);
    });

    // When a failed pin falls back to an earlier write's value rather than its own starting value, the
    // snapshot order belongs to neither; the list must reload so the pin is sorted again (#492).
    it('reloads instead of restoring the snapshot order when a failed pin falls back to an earlier write', async () => {
        const pictured = image();
        const state = mocks.searchState.current as SearchValue;
        state.images = [pictured];
        mocks.applyOptimisticPinOrder.mockImplementation((images: AIImage[], ids: string[], isPinned: boolean) =>
            images.map((item) => (ids.includes(item.id) ? { ...item, isPinned } : item))
        );
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const fails: Array<(error: Error) => void> = [];
        for (let i = 0; i < 3; i += 1) {
            mocks.updatePinned.mockReturnValueOnce(new Promise((_, reject) => fails.push(reject)));
        }
        renderProvider();

        // Pin, unpin, pin again: all three writes are still pending.
        const writes: Promise<void>[] = [];
        act(() => {
            writes.push(latest.togglePin(pictured.id));
        });
        act(() => {
            writes.push(latest.togglePin(pictured.id));
        });
        act(() => {
            writes.push(latest.togglePin(pictured.id));
        });
        mocks.queryClient.invalidateQueries.mockClear();
        mocks.revertImageFieldsInQueryCaches.mockClear();

        // The unpin fails while the later pin is pending: nothing to revert. Then the last pin fails:
        // the first pin is still pending, so the image shows pinned, which is not what the last write found.
        await act(async () => {
            fails[1](new Error('database is locked'));
            fails[2](new Error('database is locked'));
            await Promise.all([writes[1], writes[2]]);
        });

        expect(state.images).toEqual([expect.objectContaining({ id: pictured.id, isPinned: true })]);
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['images'] });
        expect(mocks.revertImageFieldsInQueryCaches).toHaveBeenCalledWith(mocks.queryClient, new Map([[pictured.id, { isPinned: true }]]), {
            reorderQueryKey: latest.imagesQueryKey,
        });

        await act(async () => {
            fails[0](new Error('database is locked'));
            await writes[0];
        });
        expect(countPendingImageFieldWritesForTests()).toBe(0);
    });

    it('loads and persists recent searches and hidden-content preferences', async () => {
        vi.useFakeTimers();
        mocks.repository.load.mockResolvedValue({
            recentSearches: ['portrait'],
            settings: {},
        });
        mocks.settings.current = {
            settings: settings({
                libraryShowGrids: true,
                libraryShowIntermediates: true,
                libraryShowInvokeImageAssets: true,
            }),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true,
        };
        mocks.checkHiddenContentAvailability.mockResolvedValue({ hasIntermediates: true, hasGrids: true, hasInvokeImageAssets: true });
        renderProvider();

        await act(() => Promise.resolve());
        await act(() => Promise.resolve());
        expect(latest.recentSearches).toEqual(['portrait']);
        expect(latest.availableHiddenContent).toEqual({ hasIntermediates: true, hasGrids: true, hasInvokeImageAssets: true });
        expect((mocks.searchState.current as SearchValue).setFilters).toHaveBeenCalled();

        act(() => latest.setRecentSearches(['landscape']));
        await act(() => Promise.resolve());
        expect(mocks.repository.update).toHaveBeenCalledOnce();
        const recentSearchUpdater = mocks.repository.update.mock.calls[0][0] as (state: { recentSearches: string[] }) => {
            recentSearches: string[];
        };
        expect(recentSearchUpdater({ recentSearches: ['portrait'] }).recentSearches).toEqual(['landscape']);
        await act(() => latest.refreshHiddenAvailability());
    });

    it('hydrates view filters from initialized settings before enabling write-back', async () => {
        const currentSettings = settings({
            libraryShowGrids: false,
            libraryShowIntermediates: false,
            libraryShowInvokeImageAssets: false,
        });
        const setSettings = vi.fn();
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        mocks.searchState.current = {
            ...(mocks.searchState.current as object),
            filters: { ...baseFilters, showGrids: true, showIntermediates: true, showInvokeImageAssets: true },
        };
        mocks.settings.current = {
            settings: currentSettings,
            setSettings,
            privacyEnabled: false,
            isLoaded: true,
        };
        renderProvider();

        await waitFor(() => expect(setFilters).toHaveBeenCalled());
        const updater = setFilters.mock.calls[0][0] as (value: FilterState) => Partial<FilterState>;
        expect(updater((mocks.searchState.current as SearchValue).filters)).toEqual(
            expect.objectContaining({
                showGrids: false,
                showIntermediates: false,
                showInvokeImageAssets: false,
            })
        );
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('hydrates a saved image kind before enabling queries without writing it back', async () => {
        const setSettings = vi.fn();
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        mocks.settings.current = {
            settings: settings({ librarySourceKind: 'photograph' }),
            setSettings,
            privacyEnabled: false,
            isLoaded: true,
        };

        const rendered = renderProvider();

        expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(false);
        const hydratedSourceKind = setFilters.mock.calls
            .map(([update]) => (update as (value: FilterState) => FilterState)(baseFilters))
            .find((filters) => filters.sourceKind === 'photograph');
        expect(hydratedSourceKind?.sourceKind).toBe('photograph');
        expect(hydratedSourceKind?.mediaType).toBe('image');
        mocks.searchState.current = { ...(mocks.searchState.current as object), filters: hydratedSourceKind };
        rendered.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        await waitFor(() => expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(true));
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('persists only the effective Videos scope and resets both with Clear filters', async () => {
        const setSettings = vi.fn();
        mocks.settings.current = {
            settings: settings({ libraryMediaType: 'image', librarySourceKind: 'photograph' }),
            setSettings,
            privacyEnabled: false,
            isLoaded: true,
        };
        mocks.searchState.current = {
            ...(mocks.searchState.current as object),
            filters: { ...baseFilters, mediaType: 'image', sourceKind: 'photograph' },
        };
        const rendered = renderProvider();
        expect(setSettings).not.toHaveBeenCalled();
        mocks.searchState.current = {
            ...(mocks.searchState.current as object),
            filters: { ...baseFilters, mediaType: 'video', sourceKind: 'photograph' },
        };
        rendered.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(setSettings).toHaveBeenLastCalledWith({ libraryMediaType: 'video', librarySourceKind: 'all' });
        mocks.settings.current = {
            ...(mocks.settings.current as object),
            settings: settings({ libraryMediaType: 'video', librarySourceKind: 'all' }),
        };
        mocks.searchState.current = {
            ...(mocks.searchState.current as object),
            filters: { ...baseFilters, mediaType: 'all', sourceKind: 'all' },
        };
        rendered.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        expect(setSettings).toHaveBeenLastCalledWith({ libraryMediaType: 'all', librarySourceKind: 'all' });
    });

    it.each(['all', 'video'] as const)('hydrates explicit %s without a legacy subtype or interim queries/writes', async (mediaType) => {
        const setSettings = vi.fn();
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        const previous = { ...baseFilters, mediaType: 'image' as const, sourceKind: 'generated' as const };
        mocks.settings.current = {
            settings: settings({ libraryMediaType: mediaType, librarySourceKind: 'photograph' }),
            setSettings,
            privacyEnabled: false,
            isLoaded: true,
        };
        mocks.searchState.current = { ...(mocks.searchState.current as object), filters: previous };
        const rendered = renderProvider();
        expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(false);
        expect(setSettings).not.toHaveBeenCalled();
        const hydratedScope = setFilters.mock.calls
            .map(([update]) => (update as (value: FilterState) => FilterState)(previous))
            .find((filters) => filters.mediaType === mediaType);
        expect(hydratedScope).toMatchObject({ mediaType, sourceKind: 'all' });
        mocks.searchState.current = { ...(mocks.searchState.current as object), filters: hydratedScope };
        rendered.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        await waitFor(() => expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(true));
        expect(setSettings).toHaveBeenCalledExactlyOnceWith({ libraryMediaType: mediaType, librarySourceKind: 'all' });
    });

    it('persists an image-kind change after the saved value has hydrated', async () => {
        const setSettings = vi.fn();
        mocks.settings.current = {
            settings: settings({ librarySourceKind: 'all' }),
            setSettings,
            privacyEnabled: false,
            isLoaded: true,
        };
        const rendered = renderProvider();

        await waitFor(() => expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(true));
        expect(setSettings).not.toHaveBeenCalled();

        mocks.searchState.current = {
            ...(mocks.searchState.current as object),
            filters: { ...baseFilters, sourceKind: 'photograph' },
        };
        rendered.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );

        await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ librarySourceKind: 'photograph', libraryMediaType: 'image' }));
    });

    it('falls back to the current grid value when only intermediates were persisted', async () => {
        const setFilters = (mocks.searchState.current as SearchValue).setFilters as ReturnType<typeof vi.fn>;
        mocks.settings.current = {
            settings: settings({ libraryShowGrids: undefined, libraryShowIntermediates: true }),
            setSettings: vi.fn(),
            privacyEnabled: false,
            isLoaded: true,
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
            isLoaded: false,
        };
        const rendered = renderProvider();

        await act(() => Promise.resolve());
        expect(setFilters).not.toHaveBeenCalled();
        expect(setSettings).not.toHaveBeenCalled();

        mocks.settings.current = {
            settings: settings({
                libraryShowGrids: true,
                libraryShowIntermediates: true,
                libraryShowInvokeImageAssets: true,
            }),
            setSettings,
            privacyEnabled: false,
            isLoaded: true,
        };
        rendered.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
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
            isLoaded: true,
        };
        mocks.refreshPrivacyMaskIndex.mockResolvedValue({ changed: true, updated: 2 });
        mocks.rebuildThumbnailFacetCache.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveRebuild = resolve;
            })
        );
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        renderProvider();

        await waitFor(() => expect(mocks.rebuildThumbnailFacetCache).toHaveBeenCalledOnce());
        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('pending');
        await act(async () => resolveRebuild?.());
        await waitFor(() => expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready'));
        expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledWith(['face']);
        expect(mocks.clearAllCollectionThumbnailCaches).toHaveBeenCalledOnce();
        // Collection thumbnails read before or during the rebuild are never kept over a repair.
        expect(mocks.invalidateRetainedThumbnails).toHaveBeenCalledTimes(2);
        expect(mocks.incrementFacetCacheVersion).toHaveBeenCalledOnce();
        expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['parameterRanges'] });
    });

    it('refreshes with an empty effective keyword list when prompt masking is disabled', async () => {
        useSettingsStore.setState({ privacyEnabled: true });
        const retainedSettings = settings({ promptMaskingEnabled: false, maskedKeywords: ['retained'] });
        mocks.settings.current = {
            settings: retainedSettings,
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true,
        };
        vi.spyOn(console, 'info').mockImplementation(() => undefined);

        renderProvider();

        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledWith([]));
        expect(retainedSettings.maskedKeywords).toEqual(['retained']);
    });

    it('blocks stale search data and disables database queries while refresh is pending', async () => {
        let resolveRefresh: ((value: { changed: boolean; updated: number }) => void) | undefined;
        const staleImage = image({ id: 'stale' });
        useSettingsStore.setState({ privacyEnabled: true });
        mocks.settings.current = {
            settings: settings({ maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true,
        };
        (mocks.searchState.current as SearchValue).images = [staleImage];
        mocks.imagesQuery.current = {
            ...(mocks.imagesQuery.current as object),
            data: { pages: [{ images: [staleImage] }] },
            counts: { totalCount: 1, globalCount: 1 },
        };
        mocks.refreshPrivacyMaskIndex.mockReturnValue(
            new Promise((resolve) => {
                resolveRefresh = resolve;
            })
        );

        const view = renderProvider();

        expect(latest.images).toEqual([]);
        expect(mocks.imagesQueryArgs.current?.settingsLoaded).toBe(false);
        view.unmount();
        expect(latest.isLibraryReady).toBe(false);
        await act(async () => resolveRefresh?.({ changed: false, updated: 0 }));
    });

    it('rebuilds privacy caches when only updated rows are reported', async () => {
        mocks.settings.current = {
            settings: settings({ maskingMode: 'hide', maskedKeywords: ['face'] }),
            setSettings: vi.fn(),
            privacyEnabled: true,
            isLoaded: true,
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
            isLoaded: true,
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
            isLoaded: true,
        };
        mocks.refreshPrivacyMaskIndex.mockRejectedValue(new Error('refresh failed'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderProvider();
        await waitFor(() =>
            expect(console.error).toHaveBeenCalledWith('[Privacy] Failed to refresh privacy mask index', expect.any(Error))
        );
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
            isLoaded: true,
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
            isLoaded: true,
        };
        mocks.refreshPrivacyMaskIndex
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveFirst = resolve;
                })
            )
            .mockResolvedValue({ changed: false, updated: 0 });
        const view = renderProvider();
        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledWith(['first']));

        mocks.settings.current = {
            ...(mocks.settings.current as object),
            settings: settings({ maskedKeywords: ['superseded'] }),
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );
        mocks.settings.current = {
            ...(mocks.settings.current as object),
            settings: settings({ maskedKeywords: ['latest'] }),
        };
        view.rerender(
            <SearchProvider>
                <Consumer />
            </SearchProvider>
        );

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
            isLoaded: true,
        };
        mocks.refreshPrivacyMaskIndex.mockReturnValue(
            new Promise((resolve) => {
                resolveRefresh = resolve;
            })
        );
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
            isLoaded: true,
        };
        mocks.refreshPrivacyMaskIndex.mockReturnValue(
            new Promise((_resolve, reject) => {
                rejectRefresh = reject;
            })
        );
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const view = renderProvider();
        await waitFor(() => expect(mocks.refreshPrivacyMaskIndex).toHaveBeenCalledOnce());
        view.unmount();
        await act(async () => rejectRefresh?.(new Error('cancelled failure')));
        expect(console.error).toHaveBeenCalled();
    });
});
