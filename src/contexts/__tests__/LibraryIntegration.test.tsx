
import * as React from 'react';
import type { FolderChange } from '../../bindings';
import { render, act, screen, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibraryProvider, useLibraryContext } from '../LibraryContext';
import { useSync } from '../SyncContext';
import { ToastProvider } from '../ToastContext';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';
import { QueryClient } from '@tanstack/react-query';
import type { Collection, InvokeDbSnapshotState, InvokeOwnerDiscovery } from '../../types';
import {
    INVOKE_IMPORT_SCHEMA_VERSION,
    INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
} from '../../services/invoke/dbSnapshot';
import { settingsPersistenceCoordinator } from '../../utils/settingsPersistenceCoordinator';
import { ViewControls } from '../../features/library/components/ViewControls';

// --- Extensive Mocks for Integration ---

const mocks = vi.hoisted(() => ({
    searchImages: vi.fn().mockResolvedValue([]),
    countImages: vi.fn().mockResolvedValue(0),
    countGlobalImages: vi.fn().mockResolvedValue(0),
    getFacets: vi.fn().mockResolvedValue({ models: [], loras: [], tools: [] }),
    getLibraryStatsSummary: vi.fn().mockResolvedValue({ totalImages: 0, totalGenerations: 0, avgSteps: 0, estSizeMB: '0', modelStats: [] }),
    clearLibraryStatsCache: vi.fn(),
    getKeywordStats: vi.fn().mockResolvedValue([]),
    syncImages: vi.fn().mockResolvedValue({ imported: 5, updated: 0, maxTimestamp: 100, syncedIds: new Set(), boardMapping: new Map(), touchedFacetTypes: [], touchedFacetResources: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] } }),
    scanForOrphans: vi.fn().mockResolvedValue(0),
    rebuildFacetCache: vi.fn().mockResolvedValue(0),
    rebuildFacetCacheStrict: vi.fn().mockResolvedValue(0),
    rebuildFacetCacheIncrementalBatchStrict: vi.fn().mockResolvedValue(0),
    refreshFacetCacheForResourcesStrict: vi.fn().mockResolvedValue(0),
    browserMockMode: false,
    watcherStartWatching: vi.fn().mockResolvedValue({}),
    watcherStopWatching: vi.fn().mockResolvedValue(undefined),
    watcherResumeWatching: vi.fn().mockResolvedValue(undefined),
    processTargetedFiles: vi.fn().mockResolvedValue({
        handledPaths: ['C:/images/live.png'],
        failedPaths: [],
        stats: { imported: 1 },
        touchedFacetTypes: ['loras'],
        touchedFacetResources: { checkpoints: [], loras: ['CinematicDetail'], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] }
    }),
    getInvokeDbSnapshot: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
            dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
            files: []
        }
    }),
    getCollectionThumbnailSummaries: vi.fn().mockResolvedValue({}),
    getSmartCollectionSummaries: vi.fn().mockResolvedValue({}),
    getSmartCollectionCounts: vi.fn().mockResolvedValue({}),
    clearCollectionOwnerScopeCaches: vi.fn().mockResolvedValue(undefined),
    discoverInvokeOwners: vi.fn(),
    applyInvokeOwnerScope: vi.fn(),
    refreshInvokeOwnerVisibility: vi.fn(),
    readTrustedInvokeOwnerScope: vi.fn(),
    getMaintenanceCounts: vi.fn().mockResolvedValue({ untagged: 0, trash: 0, orphans: 0, intermediates: 0, missing: 0, duplicates: 0 }),
    checkHiddenContentAvailability: vi.fn().mockResolvedValue({
        hasIntermediates: false,
        hasGrids: false,
        hasInvokeImageAssets: false,
    }),
    getAllCollectionsWithStats: vi.fn().mockResolvedValue([
        {
            id: 'smart1',
            name: 'Smart Col',
            filters: {
                searchQuery: 'ai',
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
                showIntermediates: false,
                showGrids: false
            },
            source: 'ambit'
        }
    ]),
    appRepository: {
        load: vi.fn().mockResolvedValue({
            settings: { theme: 'system', privacyEnabled: false, thumbnailSize: 200, confirmDelete: true, defaultTheaterMode: false, monitoredFolders: [], promptMaskingEnabled: false, maskedKeywords: ['NSFW'], maskingMode: 'hide' as const, },
            collections: [],
            smartCollections: [],
            images: [],
            recentSearches: []
        }),
        save: vi.fn().mockResolvedValue({}),
        update: vi.fn(),
        schedulePurge: vi.fn()
    }
}));

vi.mock('../../services/repository', () => ({
    appRepository: mocks.appRepository
}));

vi.mock('../../bindings', () => ({
    commands: {
        loadApiKey: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
        saveApiKey: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
        deleteApiKey: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
        refreshPrivacyMaskIndex: vi.fn().mockResolvedValue({ status: 'ok', data: { changed: false, updated: 0 } }),
        getMainDatabaseUrl: vi.fn().mockResolvedValue({ status: 'ok', data: 'sqlite:test.db' }),
        registerLibraryPath: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
        getInvokeDbSnapshot: (...args: unknown[]) => mocks.getInvokeDbSnapshot(...args),
    }
}));

vi.mock('../../services/db/searchRepo', () => ({
    searchImages: (...args: any[]) => mocks.searchImages(...args),
    countImages: (...args: any[]) => mocks.countImages(...args),
    countGlobalImages: () => mocks.countGlobalImages(),
    getFacets: (...args: any[]) => mocks.getFacets(...args),
    getLibraryStatsSummary: (...args: any[]) => mocks.getLibraryStatsSummary(...args),
    getKeywordStats: (...args: any[]) => mocks.getKeywordStats(...args),
    clearLibraryStatsCache: (...args: unknown[]) => mocks.clearLibraryStatsCache(...args),
}));

vi.mock('../../services/db/collectionRepo', () => ({
    getAllCollectionsWithStats: (...args: any[]) => mocks.getAllCollectionsWithStats(...args),
    upsertCollection: vi.fn().mockResolvedValue({}),
    addImagesToCollection: vi.fn().mockResolvedValue({}),
    ensureCollectionSchema: vi.fn().mockResolvedValue({}),
    getCollectionThumbnailSummaries: (...args: unknown[]) => mocks.getCollectionThumbnailSummaries(...args),
    getSmartCollectionSummaries: (...args: unknown[]) => mocks.getSmartCollectionSummaries(...args),
    getSmartCollectionCounts: (...args: unknown[]) => mocks.getSmartCollectionCounts(...args),
    deleteCollectionFromDb: vi.fn().mockResolvedValue({}),
    removeImagesFromCollection: vi.fn().mockResolvedValue({}),
    getCollectionImageIds: vi.fn().mockResolvedValue([]),
    clearCollectionOwnerScopeCaches: (...args: unknown[]) => mocks.clearCollectionOwnerScopeCaches(...args)
}));

vi.mock('../../services/db/maintenanceRepo', () => ({
    getMaintenanceCounts: (...args: unknown[]) => mocks.getMaintenanceCounts(...args)
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCache: (...args: any[]) => mocks.rebuildFacetCache(...args),
    rebuildFacetCacheStrict: (...args: any[]) => mocks.rebuildFacetCacheStrict(...args),
    rebuildFacetCacheIncrementalBatchStrict: (...args: any[]) => mocks.rebuildFacetCacheIncrementalBatchStrict(...args),
    refreshFacetCacheForResourcesStrict: (...args: any[]) => mocks.refreshFacetCacheForResourcesStrict(...args),
    moveImagePathIdentities: vi.fn().mockResolvedValue({ moved: 0, skippedTargetExists: 0, skippedSourceMissing: 0 }),
    markImagePathIdentitiesMissing: vi.fn().mockResolvedValue(0),
    checkHiddenContentAvailability: (...args: unknown[]) => mocks.checkHiddenContentAvailability(...args)
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => mocks.browserMockMode,
    isTauriRuntime: () => false,
}));

// 3. Service Mocks
vi.mock('../../services/WatcherService', () => ({
    watcherService: {
        startWatching: mocks.watcherStartWatching,
        stopWatching: mocks.watcherStopWatching,
        pauseWatching: vi.fn(async () => mocks.watcherResumeWatching)
    }
}));

vi.mock('../../services/invoke/syncService', () => ({
    syncImages: (...args: any[]) => mocks.syncImages(...args)
}));

vi.mock('../../services/invoke/connection', () => ({
    discoverInvokeOwners: (...args: unknown[]) => mocks.discoverInvokeOwners(...args),
}));

vi.mock('../../services/invoke/ownerScope', () => ({
    applyInvokeOwnerScope: (...args: unknown[]) => mocks.applyInvokeOwnerScope(...args),
    refreshInvokeOwnerVisibility: (...args: unknown[]) => mocks.refreshInvokeOwnerVisibility(...args),
}));

vi.mock('../../services/invoke/trustedOwnerScope', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../services/invoke/trustedOwnerScope')>(),
    readTrustedInvokeOwnerScope: (...args: unknown[]) => mocks.readTrustedInvokeOwnerScope(...args),
}));

vi.mock('../../services/invoke/orphanScanner', () => ({
    scanForOrphans: (...args: unknown[]) => mocks.scanForOrphans(...args)
}));

vi.mock('../../services/importService', () => ({
    processTargetedFiles: mocks.processTargetedFiles
}));

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
};

const createNoopInvokeSyncResult = () => ({
    imported: 0,
    updated: 0,
    maxTimestamp: 100,
    syncedIds: new Set<string>(),
    boardMapping: new Map<string, { name: string; createdAt: number }>(),
    touchedFacetTypes: [],
    touchedFacetResources: {
        checkpoints: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        controlNets: [],
        ipAdapters: [],
        tools: []
    }
});

const createTargetedResult = ({
    handledPaths = [] as string[],
    failedPaths = [] as string[],
    imported = 0,
} = {}) => ({
    images: [],
    stats: { processed: handledPaths.length + failedPaths.length, imported, skipped: 0, errors: failedPaths.length },
    handledPaths,
    failedPaths,
    touchedFacetTypes: imported > 0 ? ['loras'] : [],
    touchedFacetResources: {
        checkpoints: [],
        loras: imported > 0 ? ['CinematicDetail'] : [],
        embeddings: [],
        hypernetworks: [],
        controlNets: [],
        ipAdapters: [],
        tools: []
    }
});

const defaultSetCollections = useCollectionStore.getInitialState().setCollections;
const defaultRefreshCollections = useCollectionStore.getInitialState().refreshCollections;
const defaultRefreshCollectionThumbnails = useCollectionStore.getInitialState().refreshCollectionThumbnails;

// --- Test Consumer ---
const TestConsumer = ({ onHook }: { onHook: (hook: any) => void }) => {
    const hook = useLibraryContext();
    React.useEffect(() => {
        onHook(hook);
    }, [hook]);
    return <div data-testid="ready">{hook.isLoaded ? 'LOADED' : 'PENDING'}</div>;
};

type SyncHook = ReturnType<typeof useSync>;

const SyncTestConsumer = ({ onHook }: { onHook: (hook: SyncHook) => void }) => {
    const hook = useSync();
    React.useEffect(() => {
        onHook(hook);
    }, [hook]);
    return null;
};

describe('Library Integration (Provider Stack)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsPersistenceCoordinator.reopenAdmission();
        mocks.browserMockMode = false;
        mocks.discoverInvokeOwners.mockImplementation(async (rootPath: string) => ({
            schemaMode: 'legacy',
            dbPath: `${rootPath.replace(/\\/g, '/').replace(/\/databases$/, '')}/databases/invokeai.db`,
            imagesRoot: rootPath.replace(/\\/g, '/').replace(/\/databases$/, ''),
            owners: [],
            unassignedImageCount: 0,
        }));
        mocks.applyInvokeOwnerScope.mockResolvedValue({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            mode: 'legacy',
        });
        mocks.refreshInvokeOwnerVisibility.mockResolvedValue({
            mode: 'unselected',
            visibility: {
                changed: true,
                sourceFactsUpdated: 0,
                activeVisibilityUpdated: 1,
                removedVisibilityUpdated: 0,
            },
        });
        mocks.readTrustedInvokeOwnerScope.mockResolvedValue(null);
        mocks.checkHiddenContentAvailability.mockReset().mockResolvedValue({
            hasIntermediates: false,
            hasGrids: false,
            hasInvokeImageAssets: false,
        });
        mocks.appRepository.save.mockResolvedValue({});
        mocks.appRepository.update.mockImplementation(async (updater: (state: unknown) => unknown) => (
            updater(await mocks.appRepository.load())
        ));
        mocks.appRepository.schedulePurge.mockImplementation(async (updater: (state: unknown) => unknown) => ({
            transactionId: 'purge-test',
            state: updater(await mocks.appRepository.load()),
            message: 'Library purge scheduled.'
        }));
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
        useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
        useSettingsStore.setState(useSettingsStore.getInitialState(), true);
        useCollectionStore.setState({
            setCollections: defaultSetCollections,
            refreshCollections: defaultRefreshCollections,
            refreshCollectionThumbnails: defaultRefreshCollectionThumbnails,
        });
        // Reset location reload to prevent errors
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { reload: vi.fn() },
        });
    });

    const renderStack = (onHook: (hook: any) => void) => {
        return render(
            <ToastProvider>
                <LibraryProvider>
                    <TestConsumer onHook={onHook} />
                </LibraryProvider>
            </ToastProvider>
        );
    };

    const renderSyncStack = (onLibraryHook: (hook: any) => void, onSyncHook: (hook: SyncHook) => void) => {
        return render(
            <ToastProvider>
                <LibraryProvider>
                    <TestConsumer onHook={onLibraryHook} />
                    <SyncTestConsumer onHook={onSyncHook} />
                </LibraryProvider>
            </ToastProvider>
        );
    };

    const viewControls = (
        <ViewControls
            showLayoutSwitcher={false}
            layoutMode="grid"
            setLayoutMode={vi.fn()}
            showSlideshowButton={false}
            onSlideshow={vi.fn()}
            sortOption="date_desc"
            setSortOption={vi.fn()}
            thumbnailSize={200}
            setThumbnailSize={vi.fn()}
            displayedCount={0}
            totalCount={0}
            scopeName="Library"
        />
    );

    it.each(['manual', 'live', 'startup'] as const)(
        'reveals the InvokeAI asset toggle after a changed %s sync',
        async (mode) => {
            mocks.checkHiddenContentAvailability
                .mockResolvedValueOnce({
                    hasIntermediates: false,
                    hasGrids: false,
                    hasInvokeImageAssets: false,
                })
                .mockResolvedValue({
                    hasIntermediates: false,
                    hasGrids: false,
                    hasInvokeImageAssets: true,
                });
            let hook: ReturnType<typeof useLibraryContext> | undefined;
            render(
                <ToastProvider>
                    <LibraryProvider>
                        <TestConsumer onHook={value => hook = value} />
                        {viewControls}
                    </LibraryProvider>
                </ToastProvider>
            );

            await waitFor(() => expect(hook?.isLoaded).toBe(true));
            expect(screen.queryByTitle('View Options')).toBeNull();
            await act(async () => hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' }));
            await act(async () => hook?.startInvokeSync({ mode }));

            await waitFor(() => expect(screen.getByTitle('View Options')).toBeTruthy());
            expect(mocks.checkHiddenContentAvailability).toHaveBeenCalledTimes(3);
        }
    );

    it('does not compute maintenance counts during provider startup', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        expect(mocks.getMaintenanceCounts).not.toHaveBeenCalled();
    });

    it('should propagate Privacy Mode change to Search SQL', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        // Initial state (Privacy Enabled by default)
        expect(hook.privacyEnabled).toBe(true);
        await waitFor(() => {
            expect(hook.activeSqlWhere).toContain("privacy_hidden = 0");
        });

        // Disable Privacy
        await act(async () => {
            hook.setPrivacyEnabled(false);
        });

        await waitFor(() => {
            expect(hook.privacyEnabled).toBe(false);
            expect(hook.activeSqlWhere).not.toContain("privacy_hidden = 0");
        }, { timeout: 3000 });
    });

    it('should sync Search filters when an Active Collection is set', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        // Set active collection (Smart Collection from mock)
        await act(async () => {
            // Find the smart collection in state
            const smart = hook.smartCollections.find((c: any) => c.id === 'smart1');
            hook.setFilters((prev: any) => ({ ...prev, collectionId: smart.id }));
        });

        await waitFor(() => {
            // Filters should now include the smart collection
            expect(hook.filters.collectionId).toBe('smart1');
            // This ripple should trigger fetchData (mocked)
            expect(mocks.searchImages).toHaveBeenCalled();
        });
    });

    it.skip('should refresh data when Sync completes', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        // Clear mocks so we can safely verify the ripple effect
        mocks.searchImages.mockClear();
        mocks.getFacets.mockClear();

        // Trigger Sync
        await act(async () => {
            await hook.startInvokeSync();
        });

        await waitFor(() => {
            expect(hook.syncStatus).not.toBe('syncing');
            expect(mocks.searchImages).toHaveBeenCalled();
            expect(mocks.getFacets).toHaveBeenCalled();
        }, { timeout: 5000 });
    });

    it('does not refresh image queries after a no-op live Invoke cycle', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases'
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });
        await waitFor(() => expect(hook.invokeOwnerScopeState.status).toBe('ready'));
        await waitFor(() => expect(mocks.searchImages).toHaveBeenCalled());

        mocks.syncImages.mockResolvedValueOnce({
            imported: 0,
            updated: 0,
            maxTimestamp: 100,
            syncedIds: new Set(),
            boardMapping: new Map(),
            touchedFacetTypes: [],
            touchedFacetResources: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] }
        });
        mocks.searchImages.mockClear();
        mocks.getFacets.mockClear();
        const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');

        await act(async () => {
            await hook.startInvokeSync({ mode: 'live' });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'live', reconcileSourceFacts: false })
        );
        expect(mocks.scanForOrphans).not.toHaveBeenCalled();
        expect(mocks.searchImages).not.toHaveBeenCalled();
        expect(mocks.getFacets).not.toHaveBeenCalled();
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['invoke-image-references'] });
        invalidateSpy.mockRestore();
    });

    it.each(['startup', 'live'] as const)('uses persisted Invoke sync choices for %s sync', async (mode) => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                invokeSyncFavorites: false,
                invokeSyncBoards: false
            });
        });

        await waitFor(() => {
            expect(hook?.settings.invokeSyncFavorites).toBe(false);
            expect(hook?.settings.invokeSyncBoards).toBe(false);
        });

        mocks.syncImages.mockResolvedValueOnce(createNoopInvokeSyncResult());

        await act(async () => {
            await hook?.startInvokeSync({ mode });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode,
                syncFavorites: false,
                syncBoards: false
            })
        );
    });

    it('lets explicit Invoke sync options override persisted choices', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                invokeSyncFavorites: false,
                invokeSyncBoards: false,
                starredAs: '' as 'favorite'
            });
        });

        mocks.syncImages.mockResolvedValueOnce({
            ...createNoopInvokeSyncResult(),
            maxTimestamp: undefined as unknown as number,
        });

        await act(async () => {
            await hook?.startInvokeSync({
                mode: 'manual',
                syncFavorites: true,
                syncBoards: true,
                afterTimestamp: null,
                importIntermediates: true,
            });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'manual',
                syncFavorites: true,
                syncBoards: true,
                afterTimestamp: null,
                importIntermediates: true,
                starredAs: 'favorite',
            })
        );
    });

    it('runs a one-shot Invoke live catch-up after Live Watch attaches for Invoke-only paths', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());
        mocks.syncImages.mockClear();
        mocks.watcherStartWatching.mockClear();

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI'
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => {
            expect(mocks.watcherStartWatching).toHaveBeenCalledWith(
                ['D:/AmbitFixtures/InvokeAI/databases'],
                expect.any(Function)
            );
        }, { timeout: 3000 });

        await waitFor(() => {
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
        }, { timeout: 3000 });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            'D:/AmbitFixtures/InvokeAI',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'live' })
        );
    });

    it('skips the Invoke activation catch-up when a manual sync is already running', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI'
            });
        });

        const deferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages.mockReturnValueOnce(deferred.promise);
        mocks.syncImages.mockClear();
        mocks.watcherStartWatching.mockClear();

        let manualSyncPromise!: Promise<void> | undefined;
        await act(async () => {
            manualSyncPromise = hook?.startInvokeSync({ mode: 'manual' });
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(useLibraryStore.getState().syncStatus).toBe('syncing');
        });

        await act(async () => {
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => {
            expect(mocks.watcherStartWatching).toHaveBeenCalledWith(
                ['D:/AmbitFixtures/InvokeAI/databases'],
                expect.any(Function)
            );
        }, { timeout: 3000 });
        await act(async () => {
            await Promise.resolve();
        });

        expect(mocks.syncImages).toHaveBeenCalledTimes(1);

        await act(async () => {
            deferred.resolve(createNoopInvokeSyncResult());
            await manualSyncPromise;
        });
    });

    it('keeps generic live imports working while running the Invoke activation catch-up', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        let watcherCallback: ((changes?: FolderChange[]) => void) | null = null;
        mocks.watcherStartWatching.mockImplementationOnce(async (_paths: string[], onChange: (changes?: FolderChange[]) => void) => {
            watcherCallback = onChange;
        });
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());
        mocks.syncImages.mockClear();
        mocks.processTargetedFiles.mockClear();

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
                monitoredFolders: [
                    { id: 'watch-1', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 10 }
                ]
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => {
            expect(mocks.watcherStartWatching).toHaveBeenCalledWith(
                ['C:/watch', 'D:/AmbitFixtures/InvokeAI/databases'],
                expect.any(Function)
            );
            expect(watcherCallback).not.toBeNull();
        }, { timeout: 3000 });

        await waitFor(() => {
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
        }, { timeout: 3000 });

        await act(async () => {
            watcherCallback?.([{ kind: 'create', paths: ['C:/watch/new.png'] }]);
        });

        await waitFor(() => {
            expect(mocks.processTargetedFiles).toHaveBeenCalledWith(
                ['C:/watch/new.png'],
                expect.objectContaining({
                    forceRescan: true,
                    waitForStableFiles: true
                })
            );
        });
    });

    it('does not repeat the Invoke activation catch-up for unrelated watcher restarts', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());
        mocks.syncImages.mockClear();
        mocks.watcherStartWatching.mockClear();

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI'
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => {
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
        }, { timeout: 3000 });

        await act(async () => {
            hook?.setSettings({
                monitoredFolders: [
                    { id: 'watch-1', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 10 }
                ]
            });
        });

        await waitFor(() => {
            expect(mocks.watcherStartWatching).toHaveBeenCalledTimes(2);
        }, { timeout: 3000 });
        await act(async () => {
            await Promise.resolve();
        });

        expect(mocks.syncImages).toHaveBeenCalledTimes(1);
    });

    it('allows a new Invoke activation catch-up after Live Watch is turned off and back on', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());
        mocks.syncImages.mockClear();

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI'
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => {
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
        }, { timeout: 3000 });

        await act(async () => {
            useLibraryStore.getState().setIsLiveWatching(false);
            await Promise.resolve();
        });

        await act(async () => {
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => {
            expect(mocks.syncImages).toHaveBeenCalledTimes(2);
        }, { timeout: 3000 });
    });

    it('does not refresh image queries after a no-op startup Invoke catch-up', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importOrphans: false
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });
        await waitFor(() => expect(hook.invokeOwnerScopeState.status).toBe('ready'));
        await waitFor(() => expect(mocks.searchImages).toHaveBeenCalled());

        mocks.syncImages.mockResolvedValueOnce({
            imported: 0,
            updated: 0,
            maxTimestamp: 100,
            syncedIds: new Set(),
            boardMapping: new Map(),
            touchedFacetTypes: [],
            touchedFacetResources: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] }
        });
        mocks.searchImages.mockClear();
        mocks.getFacets.mockClear();
        mocks.appRepository.update.mockClear();
        mocks.scanForOrphans.mockClear();

        await act(async () => {
            await hook.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'startup' })
        );
        expect(mocks.searchImages).not.toHaveBeenCalled();
        expect(mocks.getFacets).not.toHaveBeenCalled();
        expect(mocks.scanForOrphans).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().syncStatus).toBe('idle');
        expect(useLibraryStore.getState().syncProgress.message).toBeUndefined();
        expect(mocks.appRepository.update).toHaveBeenCalled();
        const snapshotUpdater = mocks.appRepository.update.mock.calls.at(-1)?.[0] as (state: unknown) => { settings: { invokeDbSnapshot: InvokeDbSnapshotState } };
        expect(snapshotUpdater(await mocks.appRepository.load()).settings.invokeDbSnapshot).toEqual(expect.objectContaining({
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
        }));

        await act(async () => {
            hook.setSettings({ invokeDbSnapshot: undefined });
        });
    });

    it('does not scan for orphans during startup Invoke catch-up by default', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importOrphans: true
            });
        });

        await waitFor(() => {
            expect(hook?.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });

        mocks.syncImages.mockResolvedValueOnce(createNoopInvokeSyncResult());
        mocks.scanForOrphans.mockClear();

        await act(async () => {
            await hook?.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'startup' })
        );
        expect(mocks.scanForOrphans).not.toHaveBeenCalled();
    });

    it('keeps a zero full-rescan cursor consistent between settings and the saved snapshot', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importOrphans: false,
            });
        });
        mocks.syncImages.mockResolvedValueOnce({
            ...createNoopInvokeSyncResult(),
            maxTimestamp: 0,
        });
        mocks.appRepository.update.mockClear();

        await act(async () => {
            await hook?.startInvokeSync({ mode: 'manual', afterTimestamp: 0 });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ afterTimestamp: 0 })
        );
        await waitFor(() => expect(hook?.settings.lastSyncedAt).toBe(0));
        const snapshotUpdater = mocks.appRepository.update.mock.calls.at(-1)?.[0] as
            (state: unknown) => { settings: { invokeDbSnapshot: InvokeDbSnapshotState } };
        expect(snapshotUpdater(await mocks.appRepository.load()).settings.invokeDbSnapshot.lastSyncedAt)
            .toBe(0);
    });

    it('honors explicit orphan recovery for manual Invoke sync', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                importIntermediates: false,
                importOrphans: true
            });
        });

        await waitFor(() => {
            expect(hook?.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });

        mocks.syncImages.mockResolvedValueOnce(createNoopInvokeSyncResult());
        mocks.scanForOrphans.mockClear();
        mocks.appRepository.update.mockClear();

        await act(async () => {
            await hook?.startInvokeSync({ mode: 'manual', importOrphans: true });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'manual',
                reconcileSourceFacts: false,
            })
        );
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            reconcileSourceFacts: true,
        }));
        expect(mocks.scanForOrphans).toHaveBeenCalledWith(
            'D:/AmbitFixtures/InvokeAI/databases',
            expect.any(Set),
            expect.any(Function),
            expect.objectContaining({ importIntermediates: expect.anything() })
        );
        const snapshotUpdater = mocks.appRepository.update.mock.calls.at(-1)?.[0] as
            (state: unknown) => { settings: { invokeDbSnapshot: InvokeDbSnapshotState } };
        expect(snapshotUpdater(await mocks.appRepository.load()).settings.invokeDbSnapshot)
            .toEqual(expect.objectContaining({
                importOrphans: false,
                importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
            }));
    });

    it('uses startup resource-incremental facet refresh for a small known Invoke catch-up', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importOrphans: false
            });
        });

        await waitFor(() => {
            expect(hook?.settings.importOrphans).toBe(false);
        });
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        const facetCacheVersionBeforeSync = useLibraryStore.getState().facetCacheVersion;

        const touchedFacetResources = {
            checkpoints: ['Flux Base'],
            loras: ['CinematicDetail'],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            tools: ['InvokeAI']
        };
        mocks.syncImages.mockResolvedValueOnce({
            imported: 2,
            updated: 0,
            maxTimestamp: 102,
            syncedIds: new Set(['new-image-a.png', 'new-image-b.png']),
            boardMapping: new Map(),
            touchedFacetTypes: ['checkpoints', 'loras', 'tools'],
            touchedFacetResources
        });
        mocks.rebuildFacetCache.mockClear();
        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.refreshFacetCacheForResourcesStrict.mockClear();

        await act(async () => {
            await hook?.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.refreshFacetCacheForResourcesStrict).toHaveBeenCalledWith(touchedFacetResources);
        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().syncStatus).toBe('complete');
        expect(useLibraryStore.getState().syncProgress.total).toBe(2);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(facetCacheVersionBeforeSync + 1);
    });

    it('keeps startup Invoke catch-up on the full rebuild path for large deltas', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importOrphans: false
            });
        });

        await waitFor(() => {
            expect(hook?.settings.importOrphans).toBe(false);
        });
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        const facetCacheVersionBeforeSync = useLibraryStore.getState().facetCacheVersion;

        mocks.syncImages.mockResolvedValueOnce({
            imported: 501,
            updated: 0,
            maxTimestamp: 102,
            syncedIds: new Set(['large-delta.png']),
            boardMapping: new Map(),
            touchedFacetTypes: ['checkpoints'],
            touchedFacetResources: {
                checkpoints: ['Flux Base'],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: []
            }
        });
        mocks.rebuildFacetCache.mockClear();
        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.refreshFacetCacheForResourcesStrict.mockClear();

        await act(async () => {
            await hook?.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.refreshFacetCacheForResourcesStrict).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(facetCacheVersionBeforeSync + 1);
    });

    it('refreshes grid and facets after a live Invoke cycle without falling back to the full rebuild', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases'
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });

        mocks.syncImages.mockResolvedValueOnce({
            imported: 1,
            updated: 0,
            maxTimestamp: 101,
            syncedIds: new Set(['new-image.png']),
            boardMapping: new Map(),
            touchedFacetTypes: ['checkpoints', 'loras', 'tools'],
            touchedFacetResources: {
                checkpoints: ['Flux Base'],
                loras: ['CinematicDetail'],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: ['InvokeAI']
            }
        });
        mocks.searchImages.mockClear();
        mocks.getFacets.mockClear();
        mocks.getLibraryStatsSummary.mockClear();
        mocks.rebuildFacetCache.mockClear();
        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.rebuildFacetCacheIncrementalBatchStrict.mockClear();
        mocks.refreshFacetCacheForResourcesStrict.mockClear();

        await act(async () => {
            await hook.startInvokeSync({ mode: 'live' });
        });

        await waitFor(() => {
            expect(mocks.refreshFacetCacheForResourcesStrict).toHaveBeenCalledWith({
                checkpoints: ['Flux Base'],
                loras: ['CinematicDetail'],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: ['InvokeAI']
            });
        });

        await waitFor(() => {
            expect(mocks.searchImages).toHaveBeenCalled();
            expect(mocks.getFacets).toHaveBeenCalled();
            expect(mocks.getLibraryStatsSummary).toHaveBeenCalled();
        });

        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheIncrementalBatchStrict).not.toHaveBeenCalled();
    });

    it('closes the Live Watch session after an active Invoke cycle settles when watch was toggled off', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases'
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });
        await waitFor(() => expect(hook.invokeOwnerScopeState.status).toBe('ready'));

        const deferred = createDeferred<{
            imported: number;
            updated: number;
            maxTimestamp: number;
            syncedIds: Set<string>;
            boardMapping: Map<string, { name: string; createdAt: number }>;
            touchedFacetTypes: string[];
            touchedFacetResources: {
                checkpoints: string[];
                loras: string[];
                embeddings: string[];
                hypernetworks: string[];
                controlNets: string[];
                ipAdapters: string[];
                tools: string[];
            };
        }>();
        mocks.syncImages.mockReturnValueOnce(deferred.promise);

        let syncPromise!: Promise<unknown>;
        await act(async () => {
            syncPromise = hook.startInvokeSync({ mode: 'live' });
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(useLibraryStore.getState().liveWatchSession.phase).toBe('syncing');
        });

        act(() => {
            useLibraryStore.getState().setIsLiveWatching(false);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(true);

        await act(async () => {
            deferred.resolve({
                imported: 1,
                updated: 0,
                maxTimestamp: 101,
                syncedIds: new Set(['new-image.png']),
                boardMapping: new Map(),
                touchedFacetTypes: ['loras'],
                touchedFacetResources: {
                    checkpoints: [],
                    loras: ['CinematicDetail'],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: []
                }
            });
            await syncPromise;
        });

        await waitFor(() => {
            expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
            expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(false);
        });
    });

    it('drains scheduled Invoke activity after toggling off during detected activity', async () => {
        let hook: any;
        let watcherCallback: ((changes?: FolderChange[]) => void) | null = null;
        mocks.watcherStartWatching.mockImplementationOnce(async (_paths: string[], onChange: (changes?: FolderChange[]) => void) => {
            watcherCallback = onChange;
        });
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        mocks.syncImages.mockResolvedValueOnce(createNoopInvokeSyncResult());

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases'
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => expect(watcherCallback).not.toBeNull());
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));
        mocks.syncImages.mockClear();

        const deferred = createDeferred<{
            imported: number;
            updated: number;
            maxTimestamp: number;
            syncedIds: Set<string>;
            boardMapping: Map<string, { name: string; createdAt: number }>;
            touchedFacetTypes: string[];
            touchedFacetResources: {
                checkpoints: string[];
                loras: string[];
                embeddings: string[];
                hypernetworks: string[];
                controlNets: string[];
                ipAdapters: string[];
                tools: string[];
            };
        }>();
        mocks.syncImages.mockReturnValueOnce(deferred.promise);

        await act(async () => {
            watcherCallback?.([{ kind: 'modify', paths: ['D:/AmbitFixtures/InvokeAI/databases/invokeai.db-wal'] }]);
        });

        expect(useLibraryStore.getState().liveWatchSession.phase).toBe('watching');

        act(() => {
            useLibraryStore.getState().setIsLiveWatching(false);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(true);

        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));

        await act(async () => {
            deferred.resolve({
                imported: 0,
                updated: 0,
                maxTimestamp: 101,
                syncedIds: new Set(),
                boardMapping: new Map(),
                touchedFacetTypes: [],
                touchedFacetResources: {
                    checkpoints: [],
                    loras: [],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: []
                }
            });
        });

        await waitFor(() => {
            expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
            expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(false);
        });
    });

    it('closes the Live Watch session after an active targeted live cycle drains when watch was toggled off', async () => {
        let libraryHook: any;
        let syncHook: SyncHook | null = null;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);

        await waitFor(() => expect(libraryHook.isLoaded).toBe(true));

        await act(async () => {
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        const deferred = createDeferred<{
            images: [];
            stats: { processed: number; imported: number; skipped: number; errors: number };
            handledPaths: string[];
            failedPaths: string[];
            touchedFacetTypes: string[];
            touchedFacetResources: {
                checkpoints: string[];
                loras: string[];
                embeddings: string[];
                hypernetworks: string[];
                controlNets: string[];
                ipAdapters: string[];
                tools: string[];
            };
        }>();
        mocks.processTargetedFiles.mockReturnValueOnce(deferred.promise);

        let syncPromise!: Promise<unknown>;
        await act(async () => {
            syncPromise = syncHook!.startTargetedLiveSync(['C:/images/live.png']);
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(useLibraryStore.getState().liveWatchSession.phase).toBe('importing');
        });

        act(() => {
            useLibraryStore.getState().setIsLiveWatching(false);
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(true);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(true);

        await act(async () => {
            deferred.resolve({
                images: [],
                stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
                handledPaths: ['C:/images/live.png'],
                failedPaths: [],
                touchedFacetTypes: ['loras'],
                touchedFacetResources: {
                    checkpoints: [],
                    loras: ['CinematicDetail'],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: []
                }
            });
            await syncPromise;
        });

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(false);
    });

    it('skips startup Invoke SQLite sync when the saved DB snapshot is unchanged and orphan recovery is only enabled for manual sync', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        const files = [
            {
                path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                exists: true,
                size: 10,
                modifiedMs: 100
            },
            {
                path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db-wal',
                exists: false,
                size: 0,
                modifiedMs: null
            },
            {
                path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db-shm',
                exists: false,
                size: 0,
                modifiedMs: null
            }
        ];
        mocks.getInvokeDbSnapshot.mockResolvedValueOnce({
            status: 'ok',
            data: {
                dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                files
            }
        });

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: true,
        syncBoardsToCollections: false,
                invokeDbSnapshot: {
                    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                    lastSyncedAt: 100,
                    importIntermediates: false,
                    importOrphans: false,
                    syncBoardsToCollections: false,
                    scopeMode: 'legacy',
                    scopeOwnerId: null,
                    pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                    files
                }
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });
        await waitFor(() => expect(hook.invokeOwnerScopeState.status).toBe('ready'));

        mocks.syncImages.mockClear();

        await act(async () => {
            await hook.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.getInvokeDbSnapshot).toHaveBeenCalled();
        expect(mocks.syncImages).not.toHaveBeenCalled();
    });

    it('drains a live rerun queued while an unchanged startup snapshot is inspected', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(value => hook = value);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        const files = [{
            path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
            exists: true,
            size: 10,
            modifiedMs: 100,
        }];
        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                invokeDbSnapshot: {
                    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                    lastSyncedAt: 100,
                    importIntermediates: false,
                    importOrphans: false,
                    syncBoardsToCollections: false,
                    scopeMode: 'legacy',
                    scopeOwnerId: null,
                    pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                    files,
                },
            });
        });
        await waitFor(() => expect(hook?.settings.invokeAiPath)
            .toBe('D:/AmbitFixtures/InvokeAI/databases'));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));

        const snapshotDeferred = createDeferred<{
            status: 'ok';
            data: { dbPath: string; files: typeof files };
        }>();
        mocks.getInvokeDbSnapshot.mockReturnValueOnce(snapshotDeferred.promise);
        mocks.syncImages.mockClear();

        let startupPromise!: Promise<void>;
        act(() => {
            startupPromise = hook!.startInvokeSync({ mode: 'startup' });
        });
        await waitFor(() => expect(hook?.isInvokeSyncActive).toBe(true));

        await act(async () => {
            await hook?.startInvokeSync({ mode: 'live' });
        });
        expect(mocks.syncImages).not.toHaveBeenCalled();

        await act(async () => {
            snapshotDeferred.resolve({
                status: 'ok',
                data: {
                    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                    files,
                },
            });
            await startupPromise;
        });

        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));
        expect(mocks.syncImages).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'live' }),
        );
    });

    it('runs and records source reconciliation when an unchanged snapshot predates the import schema', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        const files = [
            {
                path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                exists: true,
                size: 10,
                modifiedMs: 100
            }
        ];
        const legacySnapshot = {
            dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
            lastSyncedAt: 100,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false,
            scopeMode: 'legacy' as const,
            scopeOwnerId: null,
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            files
        } satisfies Omit<InvokeDbSnapshotState, 'importSchemaVersion'>;

        mocks.getInvokeDbSnapshot.mockResolvedValueOnce({
            status: 'ok',
            data: {
                dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                files
            }
        });
        mocks.syncImages.mockImplementationOnce(async (_rootPath: string, onProgress: (current: number, total: number, message?: string) => void) => {
            onProgress(0, 0, 'Connecting to InvokeAI database...');
            return {
                imported: 0,
                updated: 0,
                maxTimestamp: 100,
                syncedIds: new Set(),
                boardMapping: new Map(),
                touchedFacetTypes: [],
                touchedFacetResources: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] }
            };
        });

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                invokeDbSnapshot: legacySnapshot as InvokeDbSnapshotState
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });
        await waitFor(() => expect(hook.invokeOwnerScopeState.status).toBe('ready'));
        expect(screen.queryByText(/Your InvokeAI view is ready/)).toBeNull();

        mocks.syncImages.mockClear();
        mocks.appRepository.update.mockClear();

        await act(async () => {
            await hook.startInvokeSync({ mode: 'startup' });
        });

        expect(screen.getByText(
            'Your InvokeAI view is ready. Ambit is catching up images and boards in the background. You can use your library now.'
        )).toBeTruthy();

        expect(mocks.getInvokeDbSnapshot).toHaveBeenCalled();
        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'startup',
                reconcileSourceFacts: false,
            })
        );
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            reconcileSourceFacts: true,
        }));
        const snapshotUpdater = mocks.appRepository.update.mock.calls.at(-1)?.[0] as
            (state: unknown) => { settings: { invokeDbSnapshot: InvokeDbSnapshotState } };
        expect(snapshotUpdater(await mocks.appRepository.load()).settings.invokeDbSnapshot.importSchemaVersion)
            .toBe(INVOKE_IMPORT_SCHEMA_VERSION);
    });

    it('skips startup Invoke SQLite sync when the DB file is missing', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        mocks.getInvokeDbSnapshot.mockResolvedValueOnce({
            status: 'ok',
            data: {
                dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                files: [
                    {
                        path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                        exists: false,
                        size: 0,
                        modifiedMs: null
                    }
                ]
            }
        });

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI/databases',
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                invokeDbSnapshot: {
                    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                    lastSyncedAt: 100,
                    importIntermediates: false,
                    importOrphans: false,
                    syncBoardsToCollections: false,
                    pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION - 1,
                    files: [
                        {
                            path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                            exists: true,
                            size: 10,
                            modifiedMs: 100
                        }
                    ]
                }
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AmbitFixtures/InvokeAI/databases');
        });

        mocks.syncImages.mockClear();

        await act(async () => {
            await hook.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.getInvokeDbSnapshot).toHaveBeenCalled();
        expect(mocks.syncImages).not.toHaveBeenCalled();
        expect(screen.getByText(
            'Your saved InvokeAI view is available, but catch-up could not start because the InvokeAI database file is unavailable.'
        )).toBeTruthy();
    });

    it('uses a current saved owner scope without reconciling sources or rebuilding caches', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [{ ownerId: 'owner-a', imageCount: 4 }],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            lastSyncedAt: 100,
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            invokeDbSnapshot: {
                dbPath: discovery.dbPath,
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                scopeMode: 'owner',
                scopeOwnerId: 'owner-a',
                pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                files: [],
            },
        }));

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            reconcileSourceFacts: false,
            forceVisibilityRefresh: false,
        }));
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(mocks.clearLibraryStatsCache).not.toHaveBeenCalled();
    });

    it('starts catch-up from a newly selected owner without re-discovering stale settings', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: {
            selection?: { mode: 'owner' | 'all' };
        }) => ({
            changed: selection?.mode === 'owner',
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: selection?.mode === 'owner' ? 1 : 0,
            removedVisibilityUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));
        mocks.syncImages.mockImplementationOnce(async (_rootPath: string, onProgress: (current: number, total: number, message?: string) => void) => {
            onProgress(0, 0, 'Connecting to InvokeAI database...');
            return createNoopInvokeSyncResult();
        });

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeSyncBoards: false,
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));

        await act(async () => {
            const selected = await syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            });
            expect(selected).toBe(true);
            await syncHook!.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.discoverInvokeOwners).toHaveBeenCalledTimes(1);
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledTimes(2);
        expect(mocks.syncImages).toHaveBeenCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
            })
        );
        expect(screen.getByText(
            'Your InvokeAI view is ready. Ambit is catching up images in the background. You can use your library now.'
        )).toBeTruthy();
        expect(screen.queryByText(/catching up images and boards/i)).toBeNull();
    });

    it('does not claim catch-up started when the sync invocation fails immediately', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: {
            selection?: { mode: 'owner' | 'all' };
        }) => ({
            changed: selection?.mode === 'owner',
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: selection?.mode === 'owner' ? 1 : 0,
            removedVisibilityUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));
        mocks.syncImages.mockRejectedValueOnce(new Error('sync could not start'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeSyncBoards: false,
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));

        await act(async () => {
            expect(await syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            })).toBe(true);
            await syncHook!.startInvokeSync({ mode: 'startup' });
        });

        expect(screen.queryByText(/Your InvokeAI view is ready/)).toBeNull();
        expect(screen.getByText('Sync failed: sync could not start')).toBeTruthy();
        consoleError.mockRestore();
    });

    it('keeps the last verified owner view available when discovery cannot open InvokeAI', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const trustedScope = {
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            mode: 'owner' as const,
            ownerId: 'owner-a',
        };
        mocks.discoverInvokeOwners.mockRejectedValue(new Error('database is unavailable'));
        mocks.readTrustedInvokeOwnerScope.mockResolvedValue(trustedScope);

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeOwnerSelection: { dbPath: trustedScope.dbPath, mode: 'owner', ownerId: 'owner-a' },
            invokeDbSnapshot: {
                dbPath: trustedScope.dbPath,
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                scopeMode: 'owner',
                scopeOwnerId: 'owner-a',
                pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                files: [],
            },
        }));

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'offline_ready',
            rootPath: 'D:/Invoke',
            scope: trustedScope,
            isRetrying: false,
            failure: expect.objectContaining({ kind: 'source_unavailable' }),
        })));
        await act(async () => syncHook?.startInvokeSync({ mode: 'manual' }));

        expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();
        expect(mocks.syncImages).not.toHaveBeenCalled();
    });

    it('retries discovery behind the verified offline view and reconnects without rewriting visibility', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [{ ownerId: 'owner-a', imageCount: 4 }],
            unassignedImageCount: 0,
        };
        const trustedScope = { ...discovery, mode: 'owner' as const, ownerId: 'owner-a' };
        mocks.discoverInvokeOwners.mockRejectedValueOnce(new Error('database is unavailable'));
        mocks.readTrustedInvokeOwnerScope.mockResolvedValue({
            dbPath: discovery.dbPath,
            imagesRoot: discovery.imagesRoot,
            mode: 'owner',
            ownerId: 'owner-a',
        });

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            lastSyncedAt: 100,
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            invokeDbSnapshot: {
                dbPath: discovery.dbPath,
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                scopeMode: 'owner',
                scopeOwnerId: 'owner-a',
                pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                files: [],
            },
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('offline_ready'));
        mocks.applyInvokeOwnerScope.mockClear();

        const retryDiscovery = createDeferred<InvokeOwnerDiscovery>();
        mocks.discoverInvokeOwners.mockImplementationOnce(() => retryDiscovery.promise);
        let retryResult!: Promise<boolean>;
        act(() => {
            retryResult = syncHook!.retryInvokeOwnerScope();
        });
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'offline_ready',
            isRetrying: true,
        })));
        expect(syncHook?.invokeOwnerScopeState.scope).toEqual(expect.objectContaining({
            dbPath: trustedScope.dbPath,
            ownerId: trustedScope.ownerId,
        }));

        await act(async () => retryDiscovery.resolve(discovery));
        await expect(retryResult).resolves.toBe(true);
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();

        mocks.getInvokeDbSnapshot.mockResolvedValueOnce({
            status: 'ok',
            data: { dbPath: discovery.dbPath, files: [] },
        });
        await act(async () => syncHook?.startInvokeSync({ mode: 'startup' }));
        expect(mocks.syncImages).not.toHaveBeenCalled();
        expect(screen.getByText('Your InvokeAI view is ready. You can use your library now.')).toBeTruthy();
        expect(screen.queryByText(/catching up images and boards/i)).toBeNull();
    });

    it('blocks after preparation begins instead of falling back to a prior view', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        mocks.applyInvokeOwnerScope.mockRejectedValue(new Error('visibility update failed'));
        mocks.readTrustedInvokeOwnerScope.mockResolvedValue({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            mode: 'legacy',
        });

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/Invoke' }));

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'error',
            failure: expect.objectContaining({ kind: 'preparation_failed' }),
        })));
        expect(mocks.readTrustedInvokeOwnerScope).not.toHaveBeenCalled();
    });

    it('publishes real owner reconciliation progress before revealing the library', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const application = createDeferred<{
            changed: boolean;
            sourceFactsUpdated: number;
            activeVisibilityUpdated: number;
            removedVisibilityUpdated: number;
            mode: 'legacy';
        }>();
        mocks.applyInvokeOwnerScope.mockImplementation((options: {
            onProgress: (current: number, total: number, message?: string) => void;
        }) => {
            options.onProgress(500, 2000, 'Reconciling sources: 500 / 2000');
            return application.promise;
        });

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.clearLibraryStatsCache.mockClear();
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/Invoke' }));

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'applying',
            progress: expect.objectContaining({ current: 500, total: 2000 }),
        })));
        await act(async () => application.resolve({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            mode: 'legacy',
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalledOnce();
        expect(mocks.clearLibraryStatsCache).toHaveBeenCalledOnce();
        expect(screen.queryByText(
            'Your InvokeAI view is ready. Ambit is catching up images and boards in the background. You can use your library now.'
        )).toBeNull();
    });

    it('discards stale owner discovery when the InvokeAI root changes in flight', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const oldDiscovery = createDeferred<InvokeOwnerDiscovery>();
        const newDiscovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/InvokeNew/databases/invokeai.db',
            imagesRoot: 'D:/InvokeNew',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockImplementation((rootPath: string) => (
            rootPath === 'D:/InvokeOld' ? oldDiscovery.promise : Promise.resolve(newDiscovery)
        ));
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: { selection?: { mode: 'owner' | 'all' } }) => ({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));

        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/InvokeOld' }));
        await waitFor(() => expect(libraryHook?.settings.invokeAiPath).toBe('D:/InvokeOld'));
        await waitFor(() => expect(mocks.discoverInvokeOwners).toHaveBeenCalledWith('D:/InvokeOld'));
        let oldSync!: Promise<void>;
        act(() => {
            oldSync = syncHook!.startInvokeSync({ mode: 'manual' });
        });
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/InvokeNew' }));
        let newSync!: Promise<void>;
        act(() => {
            newSync = syncHook!.startInvokeSync({ mode: 'manual' });
        });
        oldDiscovery.resolve({
            schemaMode: 'legacy',
            dbPath: 'D:/InvokeOld/databases/invokeai.db',
            imagesRoot: 'D:/InvokeOld',
            owners: [],
            unassignedImageCount: 0,
        });
        await act(async () => Promise.all([oldSync, newSync]));

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledTimes(1);
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({ discovery: newDiscovery }));
    });

    it('does not authorize sync when the InvokeAI root changes during scope application', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const oldApplication = createDeferred<{
            changed: boolean;
            sourceFactsUpdated: number;
            activeVisibilityUpdated: number;
            removedVisibilityUpdated: number;
            mode: 'legacy';
        }>();
        const oldDiscovery: InvokeOwnerDiscovery = {
            schemaMode: 'legacy',
            dbPath: 'D:/InvokeOld/databases/invokeai.db',
            imagesRoot: 'D:/InvokeOld',
            owners: [],
            unassignedImageCount: 0,
        };
        const newDiscovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/InvokeNew/databases/invokeai.db',
            imagesRoot: 'D:/InvokeNew',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockImplementation((rootPath: string) => Promise.resolve(
            rootPath === 'D:/InvokeOld' ? oldDiscovery : newDiscovery
        ));
        mocks.applyInvokeOwnerScope.mockImplementation(({ discovery }: { discovery: InvokeOwnerDiscovery }) => (
            discovery.dbPath === oldDiscovery.dbPath
                ? oldApplication.promise
                : Promise.resolve({
                    changed: false,
                    sourceFactsUpdated: 0,
                    activeVisibilityUpdated: 0,
                    removedVisibilityUpdated: 0,
                    mode: 'unselected' as const,
                })
        ));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));

        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/InvokeOld' }));
        await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(
            expect.objectContaining({ discovery: oldDiscovery })
        ));
        let oldSync!: Promise<void>;
        act(() => {
            oldSync = syncHook!.startInvokeSync({ mode: 'manual' });
        });
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/InvokeNew' }));
        oldApplication.resolve({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            mode: 'legacy',
        });
        await act(async () => oldSync);

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));
        expect(mocks.syncImages).not.toHaveBeenCalled();
        expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(
            expect.objectContaining({ discovery: newDiscovery })
        );
    });

    it('serializes owner selection against a concurrent InvokeAI root change', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const ownerApplication = createDeferred<{
            changed: boolean;
            sourceFactsUpdated: number;
            activeVisibilityUpdated: number;
            removedVisibilityUpdated: number;
            mode: 'owner';
        }>();
        const oldDiscovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/InvokeOld/databases/invokeai.db',
            imagesRoot: 'D:/InvokeOld',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        const newDiscovery: InvokeOwnerDiscovery = {
            ...oldDiscovery,
            dbPath: 'D:/InvokeNew/databases/invokeai.db',
            imagesRoot: 'D:/InvokeNew',
        };
        mocks.discoverInvokeOwners.mockImplementation((rootPath: string) => Promise.resolve(
            rootPath === 'D:/InvokeOld' ? oldDiscovery : newDiscovery
        ));
        mocks.applyInvokeOwnerScope.mockImplementation(({
            discovery,
            selection,
        }: {
            discovery: InvokeOwnerDiscovery;
            selection?: { mode: 'owner' | 'all' };
        }) => (
            discovery.dbPath === oldDiscovery.dbPath && selection?.mode === 'owner'
                ? ownerApplication.promise
                : Promise.resolve({
                    changed: false,
                    sourceFactsUpdated: 0,
                    activeVisibilityUpdated: 0,
                    removedVisibilityUpdated: 0,
                    mode: selection?.mode ?? 'unselected',
                })
        ));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/InvokeOld' }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));

        let selectionPromise!: Promise<boolean>;
        act(() => {
            selectionPromise = syncHook!.selectInvokeOwnerScope({
                dbPath: oldDiscovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            });
        });
        await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(
            expect.objectContaining({ selection: expect.objectContaining({ ownerId: 'owner-a' }) })
        ));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/InvokeNew' }));
        ownerApplication.resolve({
            changed: true,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 1,
            removedVisibilityUpdated: 0,
            mode: 'owner',
        });

        await expect(selectionPromise).resolves.toBe(false);
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));
        expect(mocks.refreshInvokeOwnerVisibility).toHaveBeenCalledWith(oldDiscovery, undefined);
        expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(
            expect.objectContaining({ discovery: newDiscovery })
        );
        expect(libraryHook?.settings.invokeOwnerSelection).toBeUndefined();
    });

    it('ignores a second owner selection while the first application is in flight', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const ownerApplication = createDeferred<{
            changed: boolean;
            sourceFactsUpdated: number;
            activeVisibilityUpdated: number;
            removedVisibilityUpdated: number;
            mode: 'owner';
        }>();
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(({
            selection,
        }: {
            selection?: { mode: 'owner' | 'all' };
        }) => (
            selection?.mode === 'owner'
                ? ownerApplication.promise
                : Promise.resolve({
                    changed: false,
                    sourceFactsUpdated: 0,
                    activeVisibilityUpdated: 0,
                    removedVisibilityUpdated: 0,
                    mode: 'unselected' as const,
                })
        ));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/Invoke' }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));

        let firstSelection!: Promise<boolean>;
        let secondSelection!: Promise<boolean>;
        act(() => {
            firstSelection = syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            });
            secondSelection = syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-b',
            });
        });

        await expect(secondSelection).resolves.toBe(false);
        const ownerApplications = mocks.applyInvokeOwnerScope.mock.calls.filter(([
            request,
        ]) => request.selection?.mode === 'owner');
        expect(ownerApplications).toHaveLength(1);
        expect(ownerApplications[0][0].selection.ownerId).toBe('owner-a');

        ownerApplication.resolve({
            changed: true,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 1,
            removedVisibilityUpdated: 0,
            mode: 'owner',
        });
        await expect(firstSelection).resolves.toBe(true);
    });

    it('rolls native visibility back when owner-selection persistence fails', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: { selection?: { mode: 'owner' | 'all' } }) => ({
            changed: selection?.mode === 'owner',
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: selection?.mode === 'owner' ? 1 : 0,
            removedVisibilityUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/Invoke' }));
        await waitFor(() => expect(libraryHook?.settings.invokeAiPath).toBe('D:/Invoke'));
        await act(async () => syncHook?.startInvokeSync({ mode: 'manual' }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));
        mocks.appRepository.update.mockRejectedValueOnce(new Error('disk full'));

        let selected = true;
        await act(async () => {
            selected = await syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            });
        });

        expect(selected).toBe(false);
        expect(mocks.refreshInvokeOwnerVisibility).toHaveBeenCalledWith(discovery, undefined);
        expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalled();
        expect(mocks.clearLibraryStatsCache).toHaveBeenCalled();
        expect(useSettingsStore.getState().settings.invokeOwnerSelection).toBeUndefined();
        expect(syncHook?.invokeOwnerScopeState.status).toBe('error');
    });

    it('re-applies the selected owner instead of reusing all-users admission after a failed refresh', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: { selection?: { mode: 'owner' | 'all' } }) => ({
            changed: selection?.mode === 'owner',
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: selection?.mode === 'owner' ? 1 : 0,
            removedVisibilityUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'all' },
        }));
        await act(async () => syncHook?.startInvokeSync({ mode: 'manual' }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        mocks.syncImages.mockClear();
        mocks.rebuildFacetCacheStrict.mockRejectedValueOnce(new Error('cache rebuild failed'));

        let selected = true;
        await act(async () => {
            selected = await syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            });
        });
        expect(selected).toBe(false);

        await act(async () => syncHook?.startInvokeSync({ mode: 'manual' }));

        expect(mocks.syncImages).toHaveBeenCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
            })
        );
        expect(syncHook?.invokeOwnerScopeState.status).toBe('ready');
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        });
    });

    it('blocks owner changes while an owner-scoped sync is active', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: { selection?: { mode: 'owner' | 'all' } }) => ({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));
        const deferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages.mockReturnValueOnce(deferred.promise);

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));

        let syncPromise!: Promise<void>;
        act(() => {
            syncPromise = syncHook!.startInvokeSync({ mode: 'manual' });
        });
        await waitFor(() => expect(syncHook?.isInvokeSyncActive).toBe(true));
        expect(useLibraryStore.getState().invokeSyncActivityKind).toBe('manual');

        let changed = true;
        await act(async () => {
            changed = await syncHook!.selectInvokeOwnerScope({ dbPath: discovery.dbPath, mode: 'all' });
        });
        expect(changed).toBe(false);
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        });

        await act(async () => {
            deferred.resolve(createNoopInvokeSyncResult());
            await syncPromise;
        });
        expect(syncHook?.isInvokeSyncActive).toBe(false);
        expect(useLibraryStore.getState().invokeSyncActivityKind).toBeNull();
    });

    it('rejects stale owner completion and re-applies programmatic owner drift without running orphan recovery', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', imageCount: 4 },
                { ownerId: 'owner-b', imageCount: 5 },
            ],
            unassignedImageCount: 0,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: { selection?: { mode: 'owner' | 'all' } }) => ({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));
        const deferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages.mockReturnValueOnce(deferred.promise);

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            importOrphans: true,
            lastSyncedAt: 777,
            invokeDbSnapshot: {
                dbPath: discovery.dbPath,
                lastSyncedAt: 777,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                scopeMode: 'owner',
                scopeOwnerId: 'owner-a',
                pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                files: [],
            },
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        mocks.getInvokeDbSnapshot.mockClear();

        let syncPromise!: Promise<void>;
        act(() => {
            syncPromise = syncHook!.startInvokeSync({ mode: 'manual', importOrphans: true });
        });
        await waitFor(() => expect(syncHook?.isInvokeSyncActive).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-b' },
        }));
        await act(async () => {
            await syncHook?.startInvokeSync({ mode: 'live' });
        });

        await act(async () => {
            deferred.resolve({ ...createNoopInvokeSyncResult(), maxTimestamp: 999 });
            await syncPromise;
        });

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(2));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
            selection: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
        }));
        expect(mocks.syncImages).toHaveBeenLastCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'live',
                afterTimestamp: null,
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
            }),
        );
        expect(libraryHook?.settings.lastSyncedAt).toBe(100);
        expect(libraryHook?.settings.invokeDbSnapshot).toBeUndefined();
        expect(mocks.getInvokeDbSnapshot).not.toHaveBeenCalled();
        expect(mocks.scanForOrphans).not.toHaveBeenCalled();
    });

    it('rejects useSync outside its provider', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const Consumer = () => {
            useSync();
            return null;
        };

        expect(() => render(<Consumer />)).toThrow('useSync must be used within SyncProvider');
        consoleError.mockRestore();
    });

    it('guards every sync operation in browser mock mode', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        mocks.browserMockMode = true;

        await act(async () => {
            await syncHook?.startInvokeSync();
            await expect(syncHook?.startTargetedLiveSync(['C:/images/live.png'])).resolves.toEqual({
                handledPaths: [],
                failedPaths: [],
                importedCount: 0,
            });
            await syncHook?.cleanLibrary();
        });

        expect(mocks.syncImages).not.toHaveBeenCalled();
        expect(mocks.processTargetedFiles).not.toHaveBeenCalled();
        expect(mocks.appRepository.schedulePurge).not.toHaveBeenCalled();
    });

    it('returns immediately for empty targeted paths and delegates cancellation to the store', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));

        await expect(syncHook?.startTargetedLiveSync([])).resolves.toEqual({
            handledPaths: [],
            failedPaths: [],
            importedCount: 0,
        });
        const controller = new AbortController();
        useLibraryStore.getState().setSyncAbortController(controller);
        act(() => syncHook?.cancelSync());

        expect(controller.signal.aborted).toBe(true);
        expect(mocks.processTargetedFiles).not.toHaveBeenCalled();
    });

    it('merges targeted paths and perf contexts while an active drain is running', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));

        await act(async () => {
            libraryHook?.setSettings({
                monitoredFolders: [{ id: 'watch-1', path: 'C:/watch', isActive: true, imageCount: 0 }],
            });
        });
        await waitFor(() => expect(libraryHook?.settings.monitoredFolders).toHaveLength(1));

        const firstDeferred = createDeferred<ReturnType<typeof createTargetedResult>>();
        mocks.processTargetedFiles
            .mockReturnValueOnce(firstDeferred.promise)
            .mockImplementationOnce(async (paths: string[], options: { onProgress?: (current: number, total: number, message?: string) => void }) => {
                options.onProgress?.(1, 1);
                return createTargetedResult({
                    handledPaths: ['C:/watch/a.png', ...paths],
                    failedPaths: ['C:/watch/a.png'],
                    imported: 2,
                });
            });

        let firstPromise!: Promise<Awaited<ReturnType<SyncHook['startTargetedLiveSync']>>>;
        let secondPromise!: Promise<Awaited<ReturnType<SyncHook['startTargetedLiveSync']>>>;
        let thirdPromise!: Promise<Awaited<ReturnType<SyncHook['startTargetedLiveSync']>>>;
        await act(async () => {
            firstPromise = syncHook!.startTargetedLiveSync(['C:\\watch\\a.png'], {
                cycleId: 'first',
                source: 'watcher',
                firstEventAt: 10,
                lastEventAt: 20,
                eventCount: 1,
                pathCount: 1,
            });
            await Promise.resolve();
            secondPromise = syncHook!.startTargetedLiveSync(['C:\\watch\\b.png'], {
                cycleId: 'second',
                source: 'other',
                firstEventAt: 5,
                lastEventAt: 30,
                eventCount: 2,
                pathCount: 2,
            });
            thirdPromise = syncHook!.startTargetedLiveSync(['C:\\watch\\c.png'], {
                cycleId: 'third',
                source: 'third-source',
                firstEventAt: 3,
                lastEventAt: 40,
                eventCount: 3,
                pathCount: 3,
            });
        });

        await act(async () => {
            firstDeferred.resolve(createTargetedResult({ failedPaths: ['C:/watch/a.png'] }));
            await Promise.resolve();
        });
        const [firstResult, secondResult, thirdResult] = await act(async () => Promise.all([firstPromise, secondPromise, thirdPromise]));

        expect(firstResult).toEqual(secondResult);
        expect(firstResult).toEqual(thirdResult);
        expect(firstResult).toEqual({
            handledPaths: ['C:/watch/a.png', 'C:/watch/b.png', 'C:/watch/c.png'],
            failedPaths: [],
            importedCount: 2,
        });
        expect(mocks.processTargetedFiles).toHaveBeenNthCalledWith(
            1,
            ['C:/watch/a.png'],
            expect.objectContaining({ forceRescan: true, waitForStableFiles: true }),
        );
        expect(mocks.processTargetedFiles).toHaveBeenNthCalledWith(
            2,
            ['C:/watch/b.png', 'C:/watch/c.png'],
            expect.objectContaining({
                perfContext: expect.objectContaining({
                    cycleId: 'second',
                    source: 'other',
                    firstEventAt: 3,
                    lastEventAt: 40,
                    eventCount: 5,
                    pathCount: 5,
                    mergedCycleCount: 2,
                }),
            }),
        );
        expect(useSettingsStore.getState().settings.monitoredFolders[0].lastScanned).toEqual(expect.any(Number));
    });

    it('returns failed normalized paths when targeted import throws', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        mocks.processTargetedFiles.mockRejectedValueOnce(new Error('import failed'));

        const result = await syncHook!.startTargetedLiveSync(['C:\\watch\\broken.png'], {
            cycleId: 'failed-targeted',
            source: 'watcher',
            firstEventAt: 1,
            lastEventAt: 2,
            eventCount: 1,
            pathCount: 1,
        });

        expect(result).toEqual({
            handledPaths: [],
            failedPaths: ['C:/watch/broken.png'],
            importedCount: 0,
        });

        mocks.processTargetedFiles.mockRejectedValueOnce(new Error('second import failed'));
        await expect(syncHook!.startTargetedLiveSync(['C:/watch/no-context.png'])).resolves.toEqual({
            handledPaths: [],
            failedPaths: ['C:/watch/no-context.png'],
            importedCount: 0,
        });
        expect(consoleError).toHaveBeenCalledWith('[LiveSync] Targeted sync failed', expect.any(Error));
        consoleError.mockRestore();
    });

    it('purges library state and persists clean settings', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));

        await act(async () => syncHook?.cleanLibrary());

        const resetUpdater = mocks.appRepository.schedulePurge.mock.calls.at(-1)?.[0] as (state: unknown) => {
            images: unknown[];
            collections: unknown[];
            smartCollections: unknown[];
            recentSearches: string[];
            settings: Record<string, unknown>;
        };
        expect(resetUpdater(await mocks.appRepository.load())).toEqual(expect.objectContaining({
            images: [],
            collections: [],
            smartCollections: [],
            recentSearches: [],
            settings: expect.objectContaining({
                monitoredFolders: [],
                lastSyncedAt: null,
                enableAutoThumbnailHealing: true,
                hasCompletedOnboarding: false,
                promptMaskingEnabled: true,
                maskedKeywords: ['nsfw', 'blood', 'gore'],
                maskingMode: 'blur',
            }),
        }));
        expect(mocks.appRepository.schedulePurge).toHaveBeenCalledOnce();
    });

    it.each([
        new Error('purge failed'),
        'unknown purge failure',
    ])('contains purge failures without rejecting: %s', async (failure) => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        mocks.appRepository.schedulePurge.mockRejectedValueOnce(failure);

        await expect(syncHook?.cleanLibrary()).resolves.toBeUndefined();

        expect(consoleError).toHaveBeenCalledWith('[Purge] Purge failed:', failure);
        expect(mocks.watcherResumeWatching).toHaveBeenCalledOnce();
        consoleError.mockRestore();
    });

    it('queues one merged Invoke live rerun while a live cycle is active', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => {
            hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' });
        });

        const firstDeferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages
            .mockReturnValueOnce(firstDeferred.promise)
            .mockResolvedValueOnce(createNoopInvokeSyncResult());
        let firstPromise!: Promise<void>;
        await act(async () => {
            firstPromise = hook!.startInvokeSync({
                mode: 'live',
                perfContext: {
                    cycleId: 'active',
                    firstEventAt: 10,
                    lastEventAt: 20,
                    eventCount: 1,
                    pathCount: 1,
                    debounceScheduledAt: 10,
                    debounceDelayMs: 25,
                    debounceFireDelayMs: 30,
                },
            });
            await Promise.resolve();
            await hook?.startInvokeSync({ mode: 'live' });
            await hook?.startInvokeSync({
                mode: 'live',
                perfContext: {
                    cycleId: 'queued-a',
                    firstEventAt: 8,
                    lastEventAt: 25,
                    eventCount: 2,
                    pathCount: 2,
                    debounceScheduledAt: 8,
                    debounceDelayMs: 25,
                    debounceFireDelayMs: 35,
                },
            });
            await hook?.startInvokeSync({
                mode: 'live',
                perfContext: {
                    cycleId: 'queued-b',
                    firstEventAt: 5,
                    lastEventAt: 30,
                    eventCount: 3,
                    pathCount: 3,
                    debounceScheduledAt: 5,
                    debounceDelayMs: 25,
                    debounceFireDelayMs: 40,
                },
            });
        });
        expect(mocks.syncImages).toHaveBeenCalledTimes(1);

        await act(async () => {
            firstDeferred.resolve(createNoopInvokeSyncResult());
            await firstPromise;
        });
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(2));

        expect(mocks.syncImages).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'live',
                perfContext: expect.objectContaining({
                    cycleId: 'queued-a',
                    firstEventAt: 5,
                    lastEventAt: 30,
                    eventCount: 5,
                    pathCount: 5,
                    mergedCycleCount: 2,
                }),
            }),
        );
    });

    it('drains an Invoke live rerun queued during a quiet startup catch-up', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => {
            hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' });
        });

        const startupDeferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages
            .mockReturnValueOnce(startupDeferred.promise)
            .mockResolvedValueOnce(createNoopInvokeSyncResult());
        let startupPromise!: Promise<void>;
        act(() => {
            startupPromise = hook!.startInvokeSync({ mode: 'startup' });
        });
        await waitFor(() => expect(hook?.isInvokeSyncActive).toBe(true));
        expect(useLibraryStore.getState().invokeSyncActivityKind).toBe('startup');

        await act(async () => {
            await hook?.startInvokeSync({ mode: 'live' });
        });
        expect(mocks.syncImages).toHaveBeenCalledTimes(1);

        await act(async () => {
            startupDeferred.resolve(createNoopInvokeSyncResult());
            await startupPromise;
        });

        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(2));
        expect(mocks.syncImages).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'live' }),
        );
    });

    it('uses default perf metadata for queued Invoke and targeted reruns without contexts', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' }));

        const invokeDeferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages
            .mockReturnValueOnce(invokeDeferred.promise)
            .mockResolvedValueOnce(createNoopInvokeSyncResult());
        let activeInvoke!: Promise<void>;
        await act(async () => {
            activeInvoke = libraryHook!.startInvokeSync({ mode: 'live' });
            await Promise.resolve();
            await libraryHook?.startInvokeSync({ mode: 'live' });
        });
        await act(async () => {
            invokeDeferred.resolve(createNoopInvokeSyncResult());
            await activeInvoke;
        });
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(2));
        expect(mocks.syncImages).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'live', perfContext: undefined }),
        );

        const targetedDeferred = createDeferred<ReturnType<typeof createTargetedResult>>();
        mocks.processTargetedFiles
            .mockReturnValueOnce(targetedDeferred.promise)
            .mockResolvedValueOnce(createTargetedResult({ handledPaths: ['C:/watch/b.png'] }));
        let activeTargeted!: Promise<Awaited<ReturnType<SyncHook['startTargetedLiveSync']>>>;
        let queuedTargeted!: Promise<Awaited<ReturnType<SyncHook['startTargetedLiveSync']>>>;
        await act(async () => {
            activeTargeted = syncHook!.startTargetedLiveSync(['C:/watch/a.png']);
            await Promise.resolve();
            queuedTargeted = syncHook!.startTargetedLiveSync(['C:/watch/b.png']);
        });
        await act(async () => {
            targetedDeferred.resolve(createTargetedResult({ handledPaths: ['C:/watch/a.png'] }));
            await Promise.all([activeTargeted, queuedTargeted]);
        });
        expect(mocks.processTargetedFiles).toHaveBeenCalledTimes(2);
    });

    it('syncs board changes, orphan progress, and manual facet state', async () => {
        const setCollectionsSpy = vi.fn(useCollectionStore.getState().setCollections);
        useCollectionStore.setState({ setCollections: setCollectionsSpy });
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
                syncBoardsToCollections: true,
                importOrphans: true,
                importIntermediates: true,
            });
        });
        await waitFor(() => expect(hook?.settings.syncBoardsToCollections).toBe(true));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        const facetCacheVersionBeforeSync = useLibraryStore.getState().facetCacheVersion;

        mocks.syncImages.mockImplementationOnce(async (
            _path: string,
            onProgress: (current: number, total: number, message?: string) => void,
        ) => {
            onProgress(1, 2, 'Reading database');
            return {
                imported: 1,
                updated: 1,
                maxTimestamp: 200,
                syncedIds: new Set(['image-a']),
                boardMapping: new Map([
                    ['existing-board', { name: 'Renamed board', createdAt: 1 }],
                    ['new-board', { name: 'New board', createdAt: 0 }],
                    ['same-board', { name: 'Same name', createdAt: 1 }],
                ]),
                touchedFacetTypes: ['loras'],
                touchedFacetResources: {
                    checkpoints: [],
                    loras: ['Detail'],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: [],
                },
            };
        });
        mocks.scanForOrphans.mockImplementationOnce(async (
            _path: string,
            _syncedIds: Set<string>,
            onProgress: (phase: string, current: number, total: number) => void,
        ) => {
            onProgress('Scanning orphans', 1, 1);
            return 1;
        });

        await act(async () => hook?.startInvokeSync({ mode: 'manual', importOrphans: true }));

        expect(mocks.scanForOrphans).toHaveBeenCalledOnce();
        expect(mocks.rebuildFacetCache).toHaveBeenCalledOnce();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(facetCacheVersionBeforeSync + 1);
        const boardUpdater = [...setCollectionsSpy.mock.calls]
            .reverse()
            .map(call => call[0])
            .find((update): update is (previous: Collection[]) => Collection[] => typeof update === 'function');
        if (!boardUpdater) throw new Error('Missing board collection updater');
        const boardCollections = boardUpdater([{
            id: 'existing-board',
            name: 'Old name',
            imageIds: [],
            createdAt: 1,
        }, {
            id: 'same-board',
            name: 'Same name',
            imageIds: [],
            createdAt: 1,
        }]);
        expect(boardCollections).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'existing-board', name: 'Renamed board' }),
            expect.objectContaining({ id: 'new-board', name: 'New board' }),
        ]));
    });

    it('preserves the collection array when synced board names are unchanged', async () => {
        const setCollectionsSpy = vi.fn(useCollectionStore.getState().setCollections);
        useCollectionStore.setState({ setCollections: setCollectionsSpy });
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            syncBoardsToCollections: true,
        }));
        mocks.syncImages.mockResolvedValueOnce({
            ...createNoopInvokeSyncResult(),
            boardMapping: new Map([['same-board', { name: 'Same name', createdAt: 1 }]]),
        });

        await act(async () => hook?.startInvokeSync({ mode: 'manual' }));

        const boardUpdater = [...setCollectionsSpy.mock.calls]
            .reverse()
            .map(call => call[0])
            .find((update): update is (previous: Collection[]) => Collection[] => typeof update === 'function');
        if (!boardUpdater) throw new Error('Missing unchanged-board updater');
        const previous: Collection[] = [{
            id: 'same-board',
            name: 'Same name',
            imageIds: [],
            createdAt: 1,
        }];
        expect(boardUpdater(previous)).toBe(previous);
    });

    it('marks manual cache rebuild failures as sync errors', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' }));
        mocks.syncImages.mockResolvedValueOnce({
            ...createNoopInvokeSyncResult(),
            imported: 1,
            syncedIds: new Set(['image-a']),
        });
        mocks.rebuildFacetCache.mockRejectedValueOnce(new Error('cache failed'));

        await act(async () => hook?.startInvokeSync({ mode: 'manual' }));

        expect(useLibraryStore.getState().syncStatus).toBe('error');
        expect(consoleError).toHaveBeenCalledWith('[Sync] Failed to rebuild facet cache after sync', expect.any(Error));
        consoleError.mockRestore();
    });

    it.each([
        { failure: new Error('Aborted'), expectedStatus: 'idle' as const, mode: 'manual' as const },
        { failure: new Error('database failed'), expectedStatus: 'error' as const, mode: 'manual' as const },
        { failure: 'unknown sync failure', expectedStatus: 'error' as const, mode: 'manual' as const },
        { failure: new Error('live failed'), expectedStatus: 'error' as const, mode: 'live' as const },
    ])('handles Invoke sync failure $failure', async ({ failure, expectedStatus, mode }) => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' }));
        mocks.appRepository.update.mockClear();
        mocks.syncImages.mockRejectedValueOnce(failure);

        await act(async () => hook?.startInvokeSync({ mode }));

        expect(useLibraryStore.getState().syncStatus).toBe(expectedStatus);
        expect(mocks.appRepository.update).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('suppresses a second manual sync while the first is active', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' }));
        const deferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages.mockReturnValueOnce(deferred.promise);
        let firstPromise!: Promise<void>;
        await act(async () => {
            firstPromise = hook!.startInvokeSync({ mode: 'manual' });
            await Promise.resolve();
        });
        await waitFor(() => expect(useLibraryStore.getState().syncStatus).toBe('syncing'));

        await hook?.startInvokeSync({ mode: 'manual' });
        expect(mocks.syncImages).toHaveBeenCalledTimes(1);

        await act(async () => {
            deferred.resolve(createNoopInvokeSyncResult());
            await firstPromise;
        });
    });

    it('falls back from a failed startup snapshot check and reports visible startup progress', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections, refreshCollectionThumbnails });
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            syncBoardsToCollections: true,
            importOrphans: false,
        }));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        refreshCollections.mockClear();
        refreshCollectionThumbnails.mockClear();
        mocks.getInvokeDbSnapshot.mockRejectedValueOnce(new Error('snapshot unavailable'));
        mocks.syncImages.mockImplementationOnce(async (
            _path: string,
            onProgress: (current: number, total: number, message?: string) => void,
        ) => {
            onProgress(1, 2, 'Startup progress');
            return {
                ...createNoopInvokeSyncResult(),
                imported: 1,
                maxTimestamp: 200,
                syncedIds: new Set(['image-a']),
                boardMapping: new Map([['new-board', { name: 'New board', createdAt: 1 }]]),
                touchedFacetTypes: ['loras'],
                touchedFacetResources: {
                    checkpoints: [],
                    loras: ['Detail'],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: [],
                },
            };
        });

        await act(async () => hook?.startInvokeSync({ mode: 'startup' }));

        expect(consoleWarn).toHaveBeenCalledWith(
            '[Startup Catch-up] Invoke DB snapshot check failed; falling back to SQLite sync.',
            expect.any(Error),
        );
        expect(useLibraryStore.getState().syncProgress.total).toBe(1);
        expect(refreshCollections).toHaveBeenCalledOnce();
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(true);
        consoleWarn.mockRestore();
    });

    it('contains snapshot persistence failures after a no-op startup refresh', async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            importOrphans: false,
            lastSyncedAt: 123,
        }));
        mocks.getInvokeDbSnapshot
            .mockResolvedValueOnce({
                status: 'ok',
                data: {
                    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                    files: [{
                        path: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                        exists: true,
                        size: 10,
                        modifiedMs: 100,
                    }],
                },
            })
            .mockRejectedValueOnce(new Error('snapshot save failed'));
        mocks.syncImages.mockResolvedValueOnce({
            ...createNoopInvokeSyncResult(),
            touchedFacetTypes: ['loras'],
            touchedFacetResources: {
                checkpoints: [],
                loras: ['Detail'],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: [],
            },
        });
        mocks.refreshFacetCacheForResourcesStrict.mockResolvedValueOnce(1);

        await act(async () => hook?.startInvokeSync({ mode: 'startup' }));

        expect(consoleWarn).toHaveBeenCalledWith(
            '[Startup Catch-up] Failed to persist Invoke DB snapshot.',
            expect.any(Error),
        );
        consoleWarn.mockRestore();
    });

    it('keeps changed startup sync invisible when progress has no total', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            importOrphans: false,
            lastSyncedAt: 123,
        }));
        mocks.syncImages.mockImplementationOnce(async (
            _path: string,
            onProgress: (current: number, total: number, message?: string) => void,
        ) => {
            onProgress(0, 0);
            return {
                ...createNoopInvokeSyncResult(),
                imported: 1,
                maxTimestamp: undefined as unknown as number,
                syncedIds: new Set(['image-a']),
                touchedFacetTypes: ['loras'],
                touchedFacetResources: {
                    checkpoints: [],
                    loras: ['Detail'],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: [],
                },
            };
        });

        await act(async () => hook?.startInvokeSync({ mode: 'startup' }));

        expect(useLibraryStore.getState().syncStatus).toBe('complete');
        expect(useLibraryStore.getState().syncProgress).toEqual({
            current: 1,
            total: 1,
            message: undefined,
        });
    });

    it('falls back to full facets and reports asynchronous live refresh failures', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections, refreshCollectionThumbnails });
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => hook = h, h => syncHook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            syncBoardsToCollections: true,
        }));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        refreshCollections.mockClear();
        refreshCollectionThumbnails.mockClear();
        mocks.rebuildFacetCacheStrict.mockClear();
        refreshCollectionThumbnails.mockRejectedValueOnce(new Error('thumbnail refresh failed'));
        const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
            .mockRejectedValue(new Error('invalidate failed'));
        mocks.rebuildFacetCacheIncrementalBatchStrict.mockRejectedValueOnce(new Error('incremental failed'));
        mocks.rebuildFacetCacheStrict.mockResolvedValueOnce(1);
        mocks.syncImages.mockImplementationOnce(async (
            _path: string,
            onProgress: (current: number, total: number, message?: string) => void,
        ) => {
            onProgress(1, 1);
            return {
                ...createNoopInvokeSyncResult(),
                imported: 1,
                syncedIds: new Set(['image-a']),
                boardMapping: new Map([['board', { name: 'Board', createdAt: 1 }]]),
                touchedFacetTypes: ['loras'],
            };
        });

        await act(async () => hook?.startInvokeSync({ mode: 'live' }));
        await waitFor(() => expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalledOnce());
        await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
            '[Sync] Live image refresh invalidation failed',
            expect.any(Error),
        ));
        await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
            '[Sync] Failed to refresh collection thumbnails after live Invoke sync',
            expect.any(Error),
        ));
        expect(refreshCollections).toHaveBeenCalledOnce();
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(true);

        act(() => useSettingsStore.setState(state => ({
            settings: {
                ...state.settings,
                monitoredFolders: undefined as unknown as [],
            },
        })));
        mocks.processTargetedFiles.mockResolvedValueOnce(createTargetedResult({
            handledPaths: ['C:/watch/a.png'],
        }));
        await syncHook!.startTargetedLiveSync(['C:/watch/a.png']);
        await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
            '[LiveSync] Generic live image refresh invalidation failed',
            expect.any(Error),
        ));

        invalidateSpy.mockRestore();
        consoleError.mockRestore();
    });

    it('rejects useLibraryContext outside LibraryProvider', () => {
        const OutsideConsumer = () => {
            useLibraryContext();
            return null;
        };

        expect(() => render(<OutsideConsumer />)).toThrow(
            'useLibraryContext must be used within LibraryProvider'
        );
    });
});
