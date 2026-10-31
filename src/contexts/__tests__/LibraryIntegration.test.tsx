
import * as React from 'react';
import type { FolderChange } from '../../bindings';
import { render, act, fireEvent, screen, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LibraryProvider, useLibraryContext } from '../LibraryContext';
import { useSync } from '../SyncContext';
import { ToastProvider } from '../ToastContext';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';
import { QueryClient } from '@tanstack/react-query';
import type { AppSettings, Collection, InvokeDbSnapshotState, InvokeOwnerDiscovery } from '../../types';
import type { InvokeSyncOptions } from '../../services/invoke/syncService';
import {
    INVOKE_BOARD_OWNER_SCHEMA_VERSION,
    INVOKE_IMPORT_SCHEMA_VERSION,
    INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
} from '../../services/invoke/dbSnapshot';
import { settingsPersistenceCoordinator } from '../../utils/settingsPersistenceCoordinator';
import { startupDiagnostics } from '../../utils/startupDiagnostics';
import { createInvokeSyncTrace, invokeSyncTrace } from '../../utils/invokeSyncTrace';
import { ViewControls } from '../../features/library/components/ViewControls';
import { ActivityDock } from '../../components/ui/ActivityDock';
import { useCollectionOperations } from '../../hooks/useCollectionOperations';
import { getInvokeConnectionDraft } from '../../services/invoke/connectionDraft';
import { useFolderMonitor } from '../../hooks/useFolderMonitor';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import type { AppState } from '../../services/repository';

// --- Extensive Mocks for Integration ---

const mocks = vi.hoisted(() => ({
    searchImages: vi.fn().mockResolvedValue([]),
    countImages: vi.fn().mockResolvedValue(0),
    countGlobalImages: vi.fn().mockResolvedValue(0),
    getFacets: vi.fn().mockResolvedValue({ models: [], loras: [], tools: [] }),
    getLibraryStatsSummary: vi.fn().mockResolvedValue({ totalImages: 0, totalGenerations: 0, avgSteps: 0, estSizeMB: '0', modelStats: [] }),
    clearLibraryStatsCache: vi.fn(),
    getKeywordStats: vi.fn().mockResolvedValue([]),
    upsertCollection: vi.fn().mockResolvedValue(undefined),
    renameCollectionInDb: vi.fn().mockResolvedValue(undefined),
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
    beginActiveInvokeScopeCacheBuild: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
            scopeKey: 'test-scope',
            generation: 0,
            cacheStatus: {
                state: 'building',
                generation: 0,
                builtGeneration: null,
                facetCount: 0,
                collectionCount: 0,
            },
            cacheRepair: {
                action: 'full',
                resources: {
                    checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                    controlNets: [], ipAdapters: [], tools: [],
                },
                facetTypes: [],
                collectionsDirty: true,
            },
        },
    }),
    commitActiveInvokeScopeCache: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { state: 'ready', generation: 0, builtGeneration: 0, facetCount: 0, collectionCount: 0 }
    }),
    abortActiveInvokeScopeCacheBuild: vi.fn().mockResolvedValue({
        status: 'ok',
        data: { state: 'dirty', generation: 0, builtGeneration: null, facetCount: 0, collectionCount: 0 }
    }),
    discoverInvokeOwners: vi.fn(),
    inspectInvokeConnection: vi.fn(),
    readInvokeSourceFingerprint: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        imageCount: 0,
        imageUpdatedAt: null,
        boardCount: 0,
        boardUpdatedAt: null,
        membershipCount: 0,
        membershipMaxRowId: null,
    }),
    applyInvokeOwnerScope: vi.fn(),
    refreshInvokeOwnerVisibility: vi.fn(),
    readTrustedInvokeOwnerScope: vi.fn(),
    getMaintenanceCounts: vi.fn().mockResolvedValue({ untagged: 0, trash: 0, orphans: 0, intermediates: 0, missing: 0, duplicates: 0 }),
    invalidateInvokeSourceDatabase: vi.fn(),
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
        beginActiveInvokeScopeCacheBuild: (...args: unknown[]) => mocks.beginActiveInvokeScopeCacheBuild(...args),
        commitActiveInvokeScopeCache: (...args: unknown[]) => mocks.commitActiveInvokeScopeCache(...args),
        abortActiveInvokeScopeCacheBuild: (...args: unknown[]) => mocks.abortActiveInvokeScopeCacheBuild(...args),
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
    getScopedCollectionRows: vi.fn().mockResolvedValue([]),
    getCollectionImageIdsStrict: vi.fn().mockResolvedValue([]),
    getAllCollectionsWithStats: (...args: any[]) => mocks.getAllCollectionsWithStats(...args),
    upsertCollection: (...args: unknown[]) => mocks.upsertCollection(...args),
    renameCollectionInDb: (...args: unknown[]) => mocks.renameCollectionInDb(...args),
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

vi.mock('../../services/invoke/connection', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../services/invoke/connection')>(),
    invalidateInvokeSourceDatabase: mocks.invalidateInvokeSourceDatabase,
    discoverInvokeOwners: (...args: unknown[]) => mocks.discoverInvokeOwners(...args),
    inspectInvokeConnection: (...args: unknown[]) => mocks.inspectInvokeConnection(...args),
    readInvokeSourceFingerprint: (...args: unknown[]) => mocks.readInvokeSourceFingerprint(...args),
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
    pathsRepaired: 0,
    maxTimestamp: 100,
    syncedIds: new Set<string>(),
    boardMapping: new Map<string, { name: string; createdAt: number }>(),
    boardsChanged: false,
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
const createInvokeScopeCacheClaim = (
    cacheRepair: {
        action: 'restored' | 'selective' | 'full';
        resources: {
            checkpoints: string[];
            loras: string[];
            embeddings: string[];
            hypernetworks: string[];
            controlNets: string[];
            ipAdapters: string[];
            tools: string[];
        };
        facetTypes: string[];
        collectionsDirty: boolean;
    },
    generation: number
) => ({
    status: 'ok' as const,
    data: {
        scopeKey: 'test-scope',
        generation,
        cacheStatus: {
            state: 'building' as const,
            generation,
            builtGeneration: generation > 0 ? generation - 1 : null,
            facetCount: 10,
            collectionCount: 2,
        },
        cacheRepair,
    },
});

const defaultCollectionQuery = mocks.getAllCollectionsWithStats.getMockImplementation()!;
const defaultInvokeSyncImplementation = mocks.syncImages.getMockImplementation()!;
const defaultRepositoryLoad = mocks.appRepository.load.getMockImplementation()!;
const defaultInvokeSnapshotImplementation = mocks.getInvokeDbSnapshot.getMockImplementation()!;
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

const StartupFeedbackConsumer = () => {
    const library = useLibraryContext();
    useFolderMonitor({
        isLoaded: library.isLoaded,
        monitoredFolders: library.settings.monitoredFolders,
        invokeAiPath: library.settings.invokeAiPath,
        startInvokeSync: library.startInvokeSync,
        onScan: async () => undefined,
        handleImportPaths: async () => undefined,
        refreshMetadata: async () => undefined,
        addToast: () => undefined,
    });
    return <ActivityDock />;
};

type CollectionOperations = ReturnType<typeof useCollectionOperations>;

const CollectionOperationsConsumer = ({ onOperations }: { onOperations: (operations: CollectionOperations) => void }) => {
    const library = useLibraryContext();
    const setAllCollections = useCollectionStore(state => state.setCollections);
    const operations = useCollectionOperations({
        collections: library.collections,
        smartCollections: library.smartCollections,
        setAllCollections,
        refreshCollections: library.refreshCollections,
        setFilters: library.setFilters,
        setImages: library.setImages,
        activeCollectionId: library.filters.collectionId,
    });
    React.useEffect(() => { onOperations(operations); }, [onOperations, operations]);
    return <div data-testid="edited-collection-name">{library.collections.find(collection => collection.id === 'edited-board')?.name}</div>;
};

describe('Library Integration (Provider Stack)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllCollectionsWithStats.mockReset().mockImplementation(defaultCollectionQuery);
        mocks.upsertCollection.mockReset().mockResolvedValue(undefined);
        mocks.renameCollectionInDb.mockReset().mockResolvedValue(undefined);
        settingsPersistenceCoordinator.reopenAdmission();
        mocks.browserMockMode = false;
        mocks.inspectInvokeConnection.mockImplementation((rootPath: string) => mocks.discoverInvokeOwners(rootPath));
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

    const renderSyncStack = (onLibraryHook: (hook: any) => void, onSyncHook: (hook: SyncHook) => void, strict = false) => {
        const Wrapper = strict ? React.StrictMode : React.Fragment;
        return render(
            <Wrapper>
            <ToastProvider>
                <LibraryProvider>
                    <TestConsumer onHook={onLibraryHook} />
                    <SyncTestConsumer onHook={onSyncHook} />
                </LibraryProvider>
            </ToastProvider>
            </Wrapper>
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

    it.each(['legacy', 'all', 'owner'] as const)('uses %s owner preparation as the first counted collection load', async (mode) => {
        const saved = await mocks.appRepository.load();
        const startupState = {
            ...saved,
            collectionStorageVersion: 1,
            settings: {
                ...saved.settings, invokeAiPath: 'D:/Invoke',
                ...(mode === 'legacy' ? {} : {
                    invokeOwnerSelection: { dbPath: 'D:/Invoke/databases/invokeai.db', mode, ownerId: 'owner-a' },
                }),
            },
        };
        mocks.appRepository.load.mockResolvedValue(startupState);
        useCollectionStore.setState({ isLoaded: false });
        useCollectionStore.getState().invalidateInitialization();
        const discovery = createDeferred<InvokeOwnerDiscovery>();
        mocks.discoverInvokeOwners.mockReturnValueOnce(discovery.promise);
        let syncHook: SyncHook | undefined;
        const view = renderSyncStack(() => undefined, h => syncHook = h, true);
        try {
            await waitFor(() => expect(mocks.discoverInvokeOwners).toHaveBeenCalledOnce());
            expect(mocks.getAllCollectionsWithStats).not.toHaveBeenCalled();
            expect(useCollectionStore.getState().isLoaded).toBe(false);
            await act(async () => discovery.resolve({
                schemaMode: mode === 'legacy' ? 'legacy' : 'multi_user', dbPath: 'D:/Invoke/databases/invokeai.db',
                imagesRoot: 'D:/Invoke', owners: mode === 'legacy' ? [] : [{ ownerId: 'owner-a', imageCount: 4 }], unassignedImageCount: 0,
            }));
            await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
            expect(mocks.getAllCollectionsWithStats).toHaveBeenCalledOnce();
            expect(useCollectionStore.getState().isLoaded).toBe(true);
        } finally {
            view.unmount();
            mocks.appRepository.load.mockResolvedValue(saved);
        }
    });

    it('waits for first owner selection even when applying the unselected scope changes visibility', async () => {
        const saved = await mocks.appRepository.load();
        const startupState = { ...saved, settings: { ...saved.settings, invokeAiPath: 'D:/Invoke' } };
        mocks.appRepository.load.mockResolvedValue(startupState);
        useCollectionStore.setState({ isLoaded: false });
        useCollectionStore.getState().invalidateInitialization();
        mocks.discoverInvokeOwners.mockResolvedValue({
            schemaMode: 'multi_user', dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke',
            owners: [{ ownerId: 'owner-a', imageCount: 4 }, { ownerId: 'owner-b', imageCount: 4 }],
            unassignedImageCount: 0,
        });
        mocks.applyInvokeOwnerScope.mockResolvedValue({
            changed: true, mode: 'unselected', sourceFactsUpdated: 0,
            activeVisibilityUpdated: 4, removedVisibilityUpdated: 0,
        });
        let syncHook: SyncHook | undefined;
        const view = renderSyncStack(() => undefined, h => syncHook = h);
        try {
            await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));
            expect(mocks.getAllCollectionsWithStats).not.toHaveBeenCalled();
            expect(useCollectionStore.getState().isLoaded).toBe(false);
            mocks.applyInvokeOwnerScope.mockResolvedValue({
                changed: true, mode: 'owner', sourceFactsUpdated: 0,
                activeVisibilityUpdated: 4, removedVisibilityUpdated: 0,
            });
            mocks.syncImages.mockResolvedValueOnce(createNoopInvokeSyncResult());
            await act(async () => {
                expect(await syncHook?.selectInvokeOwnerScope({
                    dbPath: 'D:/Invoke/databases/invokeai.db', mode: 'owner', ownerId: 'owner-a',
                })).toBe(true);
            });
            expect(useCollectionStore.getState().isLoaded).toBe(true);
            expect(syncHook?.invokeOwnerScopeState.status).toBe('ready');
        } finally {
            view.unmount();
            mocks.appRepository.load.mockResolvedValue(saved);
        }
    });

    it('loads a trusted offline scope once without applying owner visibility', async () => {
        const saved = await mocks.appRepository.load();
        const startupState = { ...saved, settings: { ...saved.settings, invokeAiPath: 'D:/Invoke' } };
        mocks.appRepository.load.mockResolvedValue(startupState);
        useCollectionStore.setState({ isLoaded: false });
        useCollectionStore.getState().invalidateInitialization();
        mocks.discoverInvokeOwners.mockRejectedValue(new Error('source unavailable'));
        mocks.readTrustedInvokeOwnerScope.mockResolvedValue({
            dbPath: 'D:/Invoke/databases/invokeai.db', imagesRoot: 'D:/Invoke', mode: 'legacy',
        });
        let syncHook: SyncHook | undefined;
        const view = renderSyncStack(() => undefined, h => syncHook = h);
        try {
            await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('offline_ready'));
            expect(mocks.getAllCollectionsWithStats).toHaveBeenCalledOnce();
            expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();
            expect(useCollectionStore.getState().isLoaded).toBe(true);
        } finally {
            view.unmount();
            mocks.appRepository.load.mockResolvedValue(saved);
        }
    });

    it('presents a standalone counted-load failure without declaring the library loaded', async () => {
        const previousBootstrap = window.__AMBIT_STARTUP_BOOTSTRAP__;
        const showFailure = vi.fn();
        window.__AMBIT_STARTUP_BOOTSTRAP__ = {
            showFailure, takeEvents: () => [], markReactMounted: vi.fn(), markReady: vi.fn(),
            markTransportUnavailable: vi.fn(), setFailureLaunchId: vi.fn(),
        };
        useCollectionStore.setState({ isLoaded: false });
        useCollectionStore.getState().invalidateInitialization();
        mocks.getAllCollectionsWithStats.mockRejectedValueOnce(new Error('count failed'));
        const view = renderSyncStack(() => undefined, () => undefined);
        try {
            await waitFor(() => expect(showFailure).toHaveBeenCalled());
            expect(useCollectionStore.getState().isLoaded).toBe(false);
        } finally {
            view.unmount();
            window.__AMBIT_STARTUP_BOOTSTRAP__ = previousBootstrap;
        }
    });

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

        let manualSyncPromise!: ReturnType<SyncHook['startInvokeSync']> | undefined;
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
        expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ imported: 2, updated: 0 });
        expect(useLibraryStore.getState().syncProgress.total).toBe(0);
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
                invokeSyncBoards: true,
                invokeDbSnapshot: {
                    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                    lastSyncedAt: 100,
                    importIntermediates: false,
                    importOrphans: false,
                    syncBoardsToCollections: true,
                    scopeMode: 'legacy',
                    scopeOwnerId: null,
                    pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                    boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
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
                invokeSyncBoards: true,
                invokeDbSnapshot: {
                    dbPath: 'D:/AmbitFixtures/InvokeAI/databases/invokeai.db',
                    lastSyncedAt: 100,
                    importIntermediates: false,
                    importOrphans: false,
                    syncBoardsToCollections: true,
                    scopeMode: 'legacy',
                    scopeOwnerId: null,
                    pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                    boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
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

        let startupPromise!: ReturnType<SyncHook['startInvokeSync']>;
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
            syncBoardsToCollections: true,
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
                invokeSyncBoards: true,
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

        expect(screen.queryByText(
            'Your InvokeAI view is ready. Ambit is catching up images and boards in the background. You can use your library now.'
        )).toBeNull();

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
            reconcileBoardOwners: true,
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
                invokeSyncBoards: false,
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
        const repairDecisionSpy = vi.spyOn(startupDiagnostics, 'repairDecision');
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
        mocks.applyInvokeOwnerScope.mockResolvedValueOnce({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 0,
            mode: 'owner',
            cacheRepair: {
                action: 'restored',
                resources: {
                    checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                    controlNets: [], ipAdapters: [], tools: [],
                },
                facetTypes: [],
                collectionsDirty: false,
            },
            cacheStatus: {
                state: 'ready',
                generation: 0,
                builtGeneration: 0,
                facetCount: 10,
                collectionCount: 2,
            },
        });
        mocks.beginActiveInvokeScopeCacheBuild.mockResolvedValueOnce(createInvokeScopeCacheClaim({
            action: 'restored',
            resources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
            facetTypes: [],
            collectionsDirty: false,
        }, 0));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        const persistedDbPath = discovery.dbPath.toLowerCase();
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            lastSyncedAt: 100,
            invokeOwnerSelection: { dbPath: persistedDbPath, mode: 'owner', ownerId: 'owner-a' },
            invokeDbSnapshot: {
                dbPath: persistedDbPath,
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                scopeMode: 'owner',
                scopeOwnerId: 'owner-a',
                pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                files: [],
                sourceFingerprint: {
                    schemaVersion: 1,
                    imageCount: 0,
                    imageUpdatedAt: null,
                    boardCount: 0,
                    boardUpdatedAt: null,
                    membershipCount: 0,
                    membershipMaxRowId: null,
                },
            },
        }));

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            selection: { dbPath: persistedDbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileSourceFacts: false,
            forceVisibilityRefresh: false,
        }));
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(mocks.beginActiveInvokeScopeCacheBuild).toHaveBeenCalledOnce();
        expect(mocks.clearLibraryStatsCache).toHaveBeenCalledOnce();
        expect(repairDecisionSpy).toHaveBeenCalledWith(expect.objectContaining({
            decision: 'unchanged',
            scope: 'owner',
            snapshot: 'compatible',
            fingerprintCurrent: true,
        }));

        mocks.applyInvokeOwnerScope.mockClear();
        mocks.readInvokeSourceFingerprint.mockResolvedValueOnce({
            schemaVersion: 1,
            imageCount: 1,
            imageUpdatedAt: 200,
            boardCount: 0,
            boardUpdatedAt: null,
            membershipCount: 0,
            membershipMaxRowId: null,
        });
        mocks.applyInvokeOwnerScope.mockResolvedValueOnce({
            changed: false,
            sourceFactsUpdated: 1,
            activeVisibilityUpdated: 1,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 0,
            mode: 'owner',
        });
        mocks.beginActiveInvokeScopeCacheBuild.mockResolvedValueOnce(createInvokeScopeCacheClaim({
            action: 'restored',
            resources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
            facetTypes: [],
            collectionsDirty: false,
        }, 1));

        await expect(syncHook!.retryInvokeOwnerScope()).resolves.toBe(true);
        expect(mocks.invalidateInvokeSourceDatabase).toHaveBeenCalledWith('D:/Invoke');
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            reconcileSourceFacts: true,
        }));
        repairDecisionSpy.mockRestore();
    });

    it('admits changed All users sources before incremental catch-up without advancing the saved snapshot', async () => {
        const repairDecisionSpy = vi.spyOn(startupDiagnostics, 'repairDecision');
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const dbPath = 'D:/Invoke/databases/invokeai.db';
        const fingerprint = {
            schemaVersion: 1 as const, imageCount: 146162, imageUpdatedAt: null,
            boardCount: 0, boardUpdatedAt: null, membershipCount: 0, membershipMaxRowId: null,
        };
        const snapshot: InvokeDbSnapshotState = {
            dbPath, lastSyncedAt: 100, importIntermediates: false, importOrphans: false,
            syncBoardsToCollections: true, scopeMode: 'all', scopeOwnerId: null,
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
            boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
            files: [], sourceFingerprint: fingerprint,
        };
        mocks.discoverInvokeOwners.mockResolvedValue({
            schemaMode: 'multi_user', dbPath, imagesRoot: 'D:/Invoke',
            owners: [{ ownerId: 'odin', imageCount: 4 }, { ownerId: 'other', imageCount: 146162 }],
            unassignedImageCount: 0,
        });
        mocks.readInvokeSourceFingerprint.mockResolvedValueOnce({ ...fingerprint, imageCount: 146166 });
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke', lastSyncedAt: 100,
            invokeOwnerSelection: { dbPath, mode: 'all' }, invokeDbSnapshot: snapshot,
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({ reconcileSourceFacts: false }));
        expect(repairDecisionSpy).toHaveBeenCalledWith(expect.objectContaining({
            decision: 'incremental-catch-up',
            scope: 'all',
            snapshot: 'compatible',
            fingerprintCurrent: false,
        }));
        expect(libraryHook?.settings.invokeDbSnapshot).toEqual(snapshot);

        mocks.syncImages.mockRejectedValueOnce(new Error('source temporarily unavailable'));
        await act(async () => { await syncHook!.startInvokeSync({ mode: 'startup' }); });
        expect(mocks.syncImages).toHaveBeenLastCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal), expect.objectContaining({
            afterTimestamp: 100, reconcileSourceFacts: false, scope: expect.objectContaining({ mode: 'all' }),
        }));
        expect(libraryHook?.settings.invokeDbSnapshot).toEqual(snapshot);

        const changedFingerprint = { ...fingerprint, imageCount: 146166 };
        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.refreshFacetCacheForResourcesStrict.mockClear();
        mocks.readInvokeSourceFingerprint.mockResolvedValueOnce(changedFingerprint);
        mocks.getInvokeDbSnapshot.mockResolvedValueOnce({
            status: 'ok', data: { dbPath, files: [{ path: dbPath, exists: true, size: 2000, modifiedMs: 200 }] },
        }).mockResolvedValueOnce({
            status: 'ok', data: { dbPath, files: [{ path: dbPath, exists: true, size: 2000, modifiedMs: 200 }] },
        });
        mocks.syncImages.mockResolvedValueOnce({
            imported: 4, updated: 0, maxTimestamp: 200,
            syncedIds: new Set(['odin-1', 'odin-2', 'odin-3', 'odin-4']), boardMapping: new Map(),
            touchedFacetTypes: ['loras'], touchedFacetResources: { checkpoints: [], loras: ['OdinDetail'], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] },
        });
        await act(async () => { await syncHook!.startInvokeSync({ mode: 'startup' }); });
        expect(libraryHook?.settings.invokeDbSnapshot).toMatchObject({ dbPath, lastSyncedAt: 200, sourceFingerprint: changedFingerprint });
        expect(mocks.refreshFacetCacheForResourcesStrict).toHaveBeenCalledWith(expect.objectContaining({ loras: ['OdinDetail'] }));
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        repairDecisionSpy.mockRestore();
    });

    it.each([
        'selected owner', 'missing snapshot', 'missing fingerprint', 'old import schema',
        'old path repair', 'unavailable fingerprint',
        'source deletion', 'source clock rollback', 'missing source timestamp',
    ])('keeps full source reconciliation for %s', async (reason) => {
        const repairDecisionSpy = vi.spyOn(startupDiagnostics, 'repairDecision');
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const dbPath = 'D:/Invoke/databases/invokeai.db';
        const fingerprint = {
            schemaVersion: 1 as const, imageCount: 100, imageUpdatedAt: '2026-09-03 10:00:00',
            boardCount: 0, boardUpdatedAt: null, membershipCount: 0, membershipMaxRowId: null,
        };
        const snapshot: InvokeDbSnapshotState = {
            dbPath, lastSyncedAt: 100, importIntermediates: false, importOrphans: false,
            syncBoardsToCollections: false,
            scopeMode: reason === 'selected owner' ? 'owner' : 'all',
            scopeOwnerId: reason === 'selected owner' ? 'odin' : null,
            pathRepairVersion: reason === 'old path repair' ? 0 : INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: reason === 'old import schema' ? 0 : INVOKE_IMPORT_SCHEMA_VERSION,
            files: [], sourceFingerprint: reason === 'missing fingerprint' ? undefined : fingerprint,
        };
        mocks.discoverInvokeOwners.mockResolvedValue({
            schemaMode: 'multi_user', dbPath, imagesRoot: 'D:/Invoke',
            owners: [{ ownerId: 'odin', imageCount: 4 }, { ownerId: 'other', imageCount: 100 }],
            unassignedImageCount: 0,
        });
        const changedFingerprint = {
            ...fingerprint,
            imageCount: reason === 'source deletion' ? 96 : 104,
            imageUpdatedAt: reason === 'source clock rollback' ? '2026-09-03 09:00:00'
                : reason === 'missing source timestamp' ? null : fingerprint.imageUpdatedAt,
        };
        mocks.readInvokeSourceFingerprint.mockResolvedValueOnce(reason === 'unavailable fingerprint'
            ? undefined : changedFingerprint);
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke', lastSyncedAt: 100,
            invokeOwnerSelection: reason === 'selected owner'
                ? { dbPath, mode: 'owner', ownerId: 'odin' } : { dbPath, mode: 'all' },
            invokeDbSnapshot: reason === 'missing snapshot' ? undefined : snapshot,
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({ reconcileSourceFacts: true }));
        expect(repairDecisionSpy).toHaveBeenCalledWith(expect.objectContaining({ decision: 'full-repair' }));
        repairDecisionSpy.mockRestore();
    });

    it('retries a ready current view without implicitly forcing source reconciliation or rebuilding its caches', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const dbPath = 'D:/Invoke/databases/invokeai.db';
        const fingerprint = {
            schemaVersion: 1 as const, imageCount: 100, imageUpdatedAt: '2026-09-03 10:00:00',
            boardCount: 0, boardUpdatedAt: null, membershipCount: 0, membershipMaxRowId: null,
        };
        const snapshot: InvokeDbSnapshotState = {
            dbPath, lastSyncedAt: 100, importIntermediates: false, importOrphans: false,
            syncBoardsToCollections: true, scopeMode: 'all', scopeOwnerId: null,
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
            boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
            files: [], sourceFingerprint: fingerprint,
        };
        mocks.discoverInvokeOwners.mockResolvedValue({
            schemaMode: 'multi_user', dbPath, imagesRoot: 'D:/Invoke',
            owners: [{ ownerId: 'odin', imageCount: 100 }], unassignedImageCount: 0,
        });
        mocks.readInvokeSourceFingerprint.mockResolvedValue(fingerprint);
        mocks.getInvokeDbSnapshot.mockResolvedValue({ status: 'ok', data: { dbPath, files: [] } });
        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());
        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke', lastSyncedAt: 100,
            invokeOwnerSelection: { dbPath, mode: 'all' }, invokeDbSnapshot: snapshot,
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        mocks.applyInvokeOwnerScope.mockClear();
        mocks.rebuildFacetCacheStrict.mockClear();

        await act(async () => expect(await syncHook!.retryInvokeOwnerScope()).toBe(true));

        expect(mocks.inspectInvokeConnection).toHaveBeenCalledWith('D:/Invoke');
        expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(mocks.syncImages).toHaveBeenCalledOnce();
        expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
            expect.objectContaining({ mode: 'manual', afterTimestamp: 100,
                scope: expect.objectContaining({ mode: 'all' }) }));
        expect(syncHook?.invokeOwnerScopeState.status).toBe('ready');
    });

    it('publishes boards reconciled while restoring a saved All users scope', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections });
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
        mocks.applyInvokeOwnerScope.mockResolvedValueOnce({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 1,
            mode: 'all',
            cacheRepair: {
                action: 'restored',
                resources: {
                    checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                    controlNets: [], ipAdapters: [], tools: [],
                },
                facetTypes: [],
                collectionsDirty: false,
            },
            cacheStatus: {
                state: 'ready',
                generation: 0,
                builtGeneration: 0,
                facetCount: 10,
                collectionCount: 3,
            },
        });

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeSyncBoards: true,
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'all' },
        }));

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(refreshCollections).toHaveBeenCalledWith(false, {
            includeThumbnails: false,
            scheduleSmartRefresh: false,
            consistency: 'authoritative',
        });
        expect(syncHook?.invokeOwnerScopeState.scope).toMatchObject({ mode: 'all' });
    });

    it('runs the board-owner repair when canonical board synchronization is enabled later', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections });
        const discovery: InvokeOwnerDiscovery = {
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [{ ownerId: 'owner-a', imageCount: 4 }],
            unassignedImageCount: 0,
        };
        const snapshot: InvokeDbSnapshotState = {
            dbPath: discovery.dbPath,
            lastSyncedAt: 100,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false,
            scopeMode: 'owner',
            scopeOwnerId: 'owner-a',
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
            boardOwnerSchemaVersion: 0,
            files: [],
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection, reconcileBoardOwners }: {
            selection?: { mode: 'owner' | 'all' };
            reconcileBoardOwners?: boolean;
        }) => ({
            changed: reconcileBoardOwners === true,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: reconcileBoardOwners ? 1 : 0,
            mode: selection?.mode ?? 'unselected',
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            lastSyncedAt: 100,
            invokeSyncBoards: false,
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            invokeDbSnapshot: snapshot,
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
            reconcileBoardOwners: false,
        }));
        mocks.applyInvokeOwnerScope.mockClear();

        await act(async () => libraryHook?.setSettings({ invokeSyncBoards: true }));
        await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(
            expect.objectContaining({ reconcileBoardOwners: true })
        ));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(refreshCollections).toHaveBeenCalledWith(false, {
            includeThumbnails: false,
            scheduleSmartRefresh: false,
            consistency: 'authoritative',
        });
    });

    it('restores cached owner cursors and skips SQLite catch-up when switching between current scopes', async () => {
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
        const snapshotFor = (ownerId: string, lastSyncedAt: number): InvokeDbSnapshotState => ({
            dbPath: discovery.dbPath,
            lastSyncedAt,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: true,
            scopeMode: 'owner',
            scopeOwnerId: ownerId,
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
            boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
            files: [],
        });
        const ownerA = snapshotFor('owner-a', 100);
        const ownerB = snapshotFor('owner-b', 200);
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.getInvokeDbSnapshot.mockResolvedValue({
            status: 'ok',
            data: { dbPath: discovery.dbPath, files: [] },
        });
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: {
            selection?: { mode: 'owner' | 'all' };
        }) => ({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            lastSyncedAt: 100,
            invokeSyncBoards: true,
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            invokeDbSnapshot: ownerA,
            invokeDbSnapshots: [ownerA, ownerB],
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        mocks.syncImages.mockClear();
        mocks.applyInvokeOwnerScope.mockClear();

        await act(async () => {
            expect(await syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-b',
            })).toBe(true);
        });
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-b' },
            reconcileBoardOwners: true,
        }));
        expect(mocks.syncImages).not.toHaveBeenCalled();
        expect(libraryHook?.settings.lastSyncedAt).toBe(200);
        expect(libraryHook?.settings.invokeDbSnapshot?.scopeOwnerId).toBe('owner-b');

        await act(async () => {
            expect(await syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            })).toBe(true);
        });
        expect(mocks.syncImages).not.toHaveBeenCalled();
        expect(libraryHook?.settings.lastSyncedAt).toBe(100);
        expect(libraryHook?.settings.invokeDbSnapshot?.scopeOwnerId).toBe('owner-a');
    });

    it('resumes a stale cached owner from that owner\'s saved cursor', async () => {
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
        const snapshotFor = (ownerId: string, lastSyncedAt: number): InvokeDbSnapshotState => ({
            dbPath: discovery.dbPath,
            lastSyncedAt,
            importIntermediates: false,
            importOrphans: false,
            syncBoardsToCollections: false,
            scopeMode: 'owner',
            scopeOwnerId: ownerId,
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
            boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION,
            sourceFingerprint: {
                schemaVersion: 1,
                imageCount: 0,
                imageUpdatedAt: null,
                boardCount: 0,
                boardUpdatedAt: null,
                membershipCount: 0,
                membershipMaxRowId: null,
            },
            files: [{
                path: discovery.dbPath,
                exists: true,
                size: 10,
                modifiedMs: 100,
            }],
        });
        const ownerA = snapshotFor('owner-a', 100);
        const ownerB = snapshotFor('owner-b', 200);
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.getInvokeDbSnapshot.mockResolvedValue({
            status: 'ok',
            data: {
                dbPath: discovery.dbPath,
                files: [{
                    path: discovery.dbPath,
                    exists: true,
                    size: 11,
                    modifiedMs: 101,
                }],
            },
        });
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: {
            selection?: { mode: 'owner' | 'all' };
        }) => ({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            lastSyncedAt: 100,
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            invokeDbSnapshot: ownerA,
            invokeDbSnapshots: [ownerA, ownerB],
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        mocks.syncImages.mockClear();
        const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        const targetCatchup = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages.mockReturnValueOnce(targetCatchup.promise);
        let selectionPromise!: Promise<boolean>;

        act(() => {
            selectionPromise = syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-b',
            });
        });
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledOnce());
        invalidateSpy.mockClear();

        await act(async () => {
            targetCatchup.resolve({
                ...createNoopInvokeSyncResult(),
                imported: 1,
                maxTimestamp: 250,
            });
            expect(await selectionPromise).toBe(true);
        });

        expect(mocks.syncImages).toHaveBeenCalledOnce();
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['images'] });
        invalidateSpy.mockRestore();
        expect(mocks.syncImages).toHaveBeenCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                afterTimestamp: 200,
                scope: expect.objectContaining({ ownerId: 'owner-b' }),
            })
        );
        expect(libraryHook?.settings.lastSyncedAt).toBe(250);
    });

    it('revalidates a newly selected owner before starting its catch-up', async () => {
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
        });

        expect(mocks.discoverInvokeOwners).toHaveBeenCalledTimes(2);
        expect(mocks.inspectInvokeConnection).toHaveBeenCalledOnce();
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledTimes(2);
        expect(mocks.syncImages).toHaveBeenCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
            })
        );
        expect(mocks.syncImages).toHaveBeenCalledTimes(1);
        expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'ready', scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
        }));
        expect(useInvokeOwnerScopeStore.getState().operation).toEqual(expect.objectContaining({
            phase: 'completed', viewCommitted: true,
        }));
        expect(screen.queryByText('Your InvokeAI view is ready.')).toBeNull();
        expect(screen.queryByText(/catching up images and boards/i)).toBeNull();
    });

    it('coalesces duplicate startup work without rolling back a successful owner switch', async () => {
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
            boardCollectionsUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));

        const targetCatchup = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages.mockClear();
        mocks.syncImages.mockReturnValueOnce(targetCatchup.promise);
        let selectionPromise!: Promise<boolean>;
        act(() => {
            selectionPromise = syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-b',
            });
        });
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));

        await act(async () => syncHook?.startInvokeSync({ mode: 'startup' }));
        expect(mocks.syncImages).toHaveBeenCalledTimes(1);

        let selected = false;
        await act(async () => {
            targetCatchup.resolve(createNoopInvokeSyncResult());
            selected = await selectionPromise;
        });

        expect(selected).toBe(true);
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-b',
        });
        expect(syncHook?.invokeOwnerScopeState).toMatchObject({
            status: 'ready',
            scope: { mode: 'owner', ownerId: 'owner-b' },
        });
        expect(screen.queryByText(/previous view was restored/i)).toBeNull();
    });

    it('defers Live Watch until owner preparation and target catch-up both finish', async () => {
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
        const targetPreparation = createDeferred<{
            changed: boolean;
            sourceFactsUpdated: number;
            activeVisibilityUpdated: number;
            removedVisibilityUpdated: number;
            boardCollectionsUpdated: number;
            mode: 'owner';
        }>();
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(({ selection }: {
            selection?: { mode: 'owner' | 'all'; ownerId?: string };
        }) => {
            if (selection?.mode === 'owner' && selection.ownerId === 'owner-b') {
                return targetPreparation.promise;
            }
            return Promise.resolve({
                changed: selection?.mode === 'owner',
                sourceFactsUpdated: 0,
                activeVisibilityUpdated: selection?.mode === 'owner' ? 1 : 0,
                removedVisibilityUpdated: 0,
                boardCollectionsUpdated: 0,
                mode: selection?.mode ?? 'unselected',
            });
        });

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));

        const targetCatchup = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.applyInvokeOwnerScope.mockClear();
        mocks.syncImages.mockClear();
        mocks.syncImages
            .mockReturnValueOnce(targetCatchup.promise)
            .mockResolvedValueOnce(createNoopInvokeSyncResult());
        let selectionPromise!: Promise<boolean>;
        act(() => {
            selectionPromise = syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-b',
            });
        });
        await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(
            expect.objectContaining({
                selection: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
            })
        ));

        let livePromise!: ReturnType<SyncHook['startInvokeSync']>;
        act(() => {
            livePromise = syncHook!.startInvokeSync({ mode: 'live' });
        });
        expect(mocks.syncImages).not.toHaveBeenCalled();

        await act(async () => {
            targetPreparation.resolve({
                changed: true,
                sourceFactsUpdated: 0,
                activeVisibilityUpdated: 1,
                removedVisibilityUpdated: 0,
                boardCollectionsUpdated: 0,
                mode: 'owner',
            });
        });
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));
        expect(mocks.syncImages).toHaveBeenNthCalledWith(
            1,
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'startup',
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
            })
        );

        let selected = false;
        await act(async () => {
            targetCatchup.resolve(createNoopInvokeSyncResult());
            [selected] = await Promise.all([selectionPromise, livePromise]);
        });
        expect(selected).toBe(true);
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(2));
        expect(mocks.syncImages).toHaveBeenLastCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'live',
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
            })
        );
        expect(screen.queryByText(/previous view was restored/i)).toBeNull();
    });

    it('retains Live Watch work when owner preparation fails and restores the previous scope', async () => {
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
        const targetPreparation = createDeferred<{
            changed: boolean;
            sourceFactsUpdated: number;
            activeVisibilityUpdated: number;
            removedVisibilityUpdated: number;
            boardCollectionsUpdated: number;
            mode: 'owner';
        }>();
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(({ selection }: {
            selection?: { mode: 'owner' | 'all'; ownerId?: string };
        }) => {
            if (selection?.mode === 'owner' && selection.ownerId === 'owner-b') {
                return targetPreparation.promise;
            }
            return Promise.resolve({
                changed: false,
                sourceFactsUpdated: 0,
                activeVisibilityUpdated: 0,
                removedVisibilityUpdated: 0,
                boardCollectionsUpdated: 0,
                mode: selection?.mode ?? 'unselected',
            });
        });

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({
            invokeAiPath: 'D:/Invoke',
            invokeOwnerSelection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
        }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));

        mocks.syncImages.mockClear();
        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());
        let selectionPromise!: Promise<boolean>;
        act(() => {
            selectionPromise = syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-b',
            });
        });
        await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(
            expect.objectContaining({
                selection: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
            })
        ));

        let livePromise!: ReturnType<SyncHook['startInvokeSync']>;
        act(() => {
            livePromise = syncHook!.startInvokeSync({ mode: 'live' });
        });
        await expect(livePromise).resolves.toEqual({ status: 'queued' });
        expect(mocks.syncImages).not.toHaveBeenCalled();

        let selected = true;
        await act(async () => {
            targetPreparation.reject(new Error('target cache preparation failed'));
            selected = await selectionPromise;
        });

        expect(selected).toBe(false);
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));
        expect(mocks.syncImages).toHaveBeenLastCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'live',
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
            })
        );
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        });
    });

    it('retains the committed owner and offers retry when catch-up fails immediately', async () => {
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
        });

        expect(screen.queryByText(/Your InvokeAI view is ready/)).toBeNull();
        expect(screen.queryByText('Sync failed: sync could not start')).toBeNull();
        expect(screen.getAllByText('sync could not start')).toHaveLength(1);
        expect(screen.queryByText(/previous view was restored/i)).toBeNull();
        expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'ready', scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
        }));
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a',
        });
        expect(useInvokeOwnerScopeStore.getState().operation).toEqual(expect.objectContaining({
            phase: 'failed', viewCommitted: true, retry: expect.any(Function),
        }));
        expect(mocks.refreshInvokeOwnerVisibility).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('retains the committed owner view when its background catch-up is cancelled', async () => {
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
            boardCollectionsUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));
        mocks.syncImages.mockImplementationOnce((
            _rootPath: string,
            _onProgress: unknown,
            signal: AbortSignal
        ) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
        }));

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/Invoke' }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));

        let selectionPromise!: Promise<boolean>;
        act(() => {
            selectionPromise = syncHook!.selectInvokeOwnerScope({
                dbPath: discovery.dbPath,
                mode: 'owner',
                ownerId: 'owner-a',
            });
        });
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledOnce());
        expect(syncHook?.invokeOwnerScopeState.status).toBe('ready');
        act(() => syncHook!.cancelSync());

        let selected = true;
        await act(async () => {
            selected = await selectionPromise;
        });
        expect(selected).toBe(true);
        expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'ready', scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
        }));
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a',
        });
        expect(useInvokeOwnerScopeStore.getState().operation).toEqual(expect.objectContaining({
            phase: 'cancelled', viewCommitted: true, retry: expect.any(Function),
        }));
        expect(mocks.refreshInvokeOwnerVisibility).not.toHaveBeenCalled();
        expect(screen.queryByText('Your InvokeAI view is ready.')).toBeNull();
        expect(screen.queryByText(/previous view was restored/i)).toBeNull();
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

    it('keeps the verified offline view during retry validation and prepares it before reconnecting', async () => {
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
        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());
        mocks.getInvokeDbSnapshot.mockResolvedValue({
            status: 'ok', data: { dbPath: discovery.dbPath, files: [] },
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
        expect(syncHook?.invokeOwnerScopeState.status).toBe('offline_ready');
        expect(useInvokeOwnerScopeStore.getState().operation).toEqual(expect.objectContaining({
            phase: 'validating', viewCommitted: false,
        }));
        expect(syncHook?.invokeOwnerScopeState.scope).toEqual(expect.objectContaining({
            dbPath: trustedScope.dbPath,
            ownerId: trustedScope.ownerId,
        }));

        expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();
        expect(mocks.syncImages).not.toHaveBeenCalled();
        await act(async () => {
            retryDiscovery.resolve(discovery);
            expect(await retryResult).toBe(true);
        });
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce();
        expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            discovery,
            selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
        }));
        expect(mocks.syncImages).toHaveBeenCalledOnce();
        expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
            expect.objectContaining({ mode: 'manual', afterTimestamp: 100,
                scope: expect.objectContaining({ ownerId: 'owner-a' }) }));

        mocks.getInvokeDbSnapshot.mockResolvedValueOnce({
            status: 'ok',
            data: { dbPath: discovery.dbPath, files: [] },
        });
        await act(async () => syncHook?.startInvokeSync({ mode: 'startup' }));
        expect(mocks.syncImages).toHaveBeenCalledOnce();
        expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('completed');
        expect(screen.queryByText('Your InvokeAI view is ready. You can use your library now.')).toBeNull();
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
        await expect(syncHook!.startInvokeSync({ mode: 'startup' })).resolves.toEqual({
            status: 'blocked', message: 'visibility update failed',
        });
        expect(mocks.syncImages).not.toHaveBeenCalled();
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
        let oldSync!: ReturnType<SyncHook['startInvokeSync']>;
        act(() => {
            oldSync = syncHook!.startInvokeSync({ mode: 'manual' });
        });
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/InvokeNew' }));
        let newSync!: ReturnType<SyncHook['startInvokeSync']>;
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
        expect(mocks.invalidateInvokeSourceDatabase).toHaveBeenCalledWith('D:/InvokeOld');
        expect(mocks.invalidateInvokeSourceDatabase).toHaveBeenCalledWith('D:/InvokeNew');
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
        let oldSync!: ReturnType<SyncHook['startInvokeSync']>;
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

        await act(async () => expect(await selectionPromise).toBe(false));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'error', rootPath: 'D:/InvokeNew',
        })));
        expect(libraryHook?.settings.invokeAiPath).toBe('D:/InvokeNew');
        expect(mocks.syncImages).not.toHaveBeenCalled();
        expect(mocks.applyInvokeOwnerScope.mock.calls.every(([request]) => request.discovery === oldDiscovery)).toBe(true);

        await act(async () => expect(await syncHook!.retryInvokeOwnerScope()).toBe(false));
        expect(mocks.inspectInvokeConnection).toHaveBeenLastCalledWith('D:/InvokeNew');
        expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'selection_required', rootPath: 'D:/InvokeNew', discovery: newDiscovery,
        }));
        expect(mocks.syncImages).not.toHaveBeenCalled();
    });

    it('uses a restored cache for a warm switch and selectively repairs a dirty scope', async () => {
        let libraryHook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        const refreshSmartCounts = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections, refreshCollectionThumbnails, refreshSmartCounts });
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
            boardCollectionsUpdated: 0,
            mode: selection?.mode ?? 'unselected',
            cacheRepair: {
                action: selection?.mode === 'owner' ? 'restored' : 'full',
                resources: {
                    checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                    controlNets: [], ipAdapters: [], tools: [],
                },
                facetTypes: [],
                collectionsDirty: false,
            },
            cacheStatus: {
                state: selection?.mode === 'owner' ? 'ready' : 'missing',
                generation: 0,
                builtGeneration: selection?.mode === 'owner' ? 0 : null,
                facetCount: selection?.mode === 'owner' ? 10 : 0,
                collectionCount: selection?.mode === 'owner' ? 2 : 0,
            },
        }));
        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/Invoke' }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));
        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.refreshFacetCacheForResourcesStrict.mockClear();
        mocks.clearCollectionOwnerScopeCaches.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockClear();
        mocks.commitActiveInvokeScopeCache.mockClear();
        refreshCollections.mockClear();
        refreshCollectionThumbnails.mockClear();
        refreshSmartCounts.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockResolvedValueOnce(createInvokeScopeCacheClaim({
            action: 'restored',
            resources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
            facetTypes: [],
            collectionsDirty: false,
        }, 0));

        await expect(syncHook!.selectInvokeOwnerScope({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        })).resolves.toBe(true);

        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(mocks.clearCollectionOwnerScopeCaches).not.toHaveBeenCalled();
        expect(mocks.beginActiveInvokeScopeCacheBuild).toHaveBeenCalledOnce();
        expect(refreshCollectionThumbnails).not.toHaveBeenCalled();
        expect(mocks.commitActiveInvokeScopeCache).not.toHaveBeenCalled();
        expect(refreshCollections).toHaveBeenCalled();
        expect(refreshSmartCounts).not.toHaveBeenCalled();

        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.refreshFacetCacheForResourcesStrict.mockClear();
        mocks.clearCollectionOwnerScopeCaches.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockClear();
        mocks.commitActiveInvokeScopeCache.mockClear();
        refreshCollectionThumbnails.mockClear();
        refreshSmartCounts.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockResolvedValueOnce(createInvokeScopeCacheClaim({
            action: 'selective',
            resources: {
                checkpoints: [],
                loras: ['NewDetailer'],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: [],
            },
            facetTypes: [],
            collectionsDirty: false,
        }, 1));
        mocks.applyInvokeOwnerScope.mockResolvedValueOnce({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 0,
            mode: 'owner',
            cacheRepair: {
                action: 'selective',
                resources: {
                    checkpoints: [],
                    loras: ['NewDetailer'],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: [],
                },
                facetTypes: [],
                collectionsDirty: false,
            },
            cacheStatus: {
                state: 'dirty',
                generation: 1,
                builtGeneration: 0,
                facetCount: 10,
                collectionCount: 2,
            },
        });

        await expect(syncHook!.selectInvokeOwnerScope({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-b',
        })).resolves.toBe(true);

        expect(mocks.clearCollectionOwnerScopeCaches).not.toHaveBeenCalled();
        expect(mocks.beginActiveInvokeScopeCacheBuild).toHaveBeenCalledOnce();
        expect(mocks.refreshFacetCacheForResourcesStrict).toHaveBeenCalledWith({
            checkpoints: [],
            loras: ['NewDetailer'],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            tools: [],
        });
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(refreshSmartCounts).not.toHaveBeenCalled();
        expect(refreshCollectionThumbnails).not.toHaveBeenCalled();
        expect(mocks.commitActiveInvokeScopeCache).toHaveBeenCalledOnce();

        mocks.refreshFacetCacheForResourcesStrict.mockClear();
        mocks.clearCollectionOwnerScopeCaches.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockClear();
        mocks.commitActiveInvokeScopeCache.mockClear();
        refreshCollectionThumbnails.mockClear();
        refreshSmartCounts.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockResolvedValueOnce(createInvokeScopeCacheClaim({
            action: 'selective',
            resources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
            facetTypes: [],
            collectionsDirty: true,
        }, 2));
        mocks.applyInvokeOwnerScope.mockResolvedValueOnce({
            changed: false,
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 0,
            mode: 'owner',
            cacheRepair: {
                action: 'selective',
                resources: {
                    checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                    controlNets: [], ipAdapters: [], tools: [],
                },
                facetTypes: [],
                collectionsDirty: true,
            },
            cacheStatus: {
                state: 'dirty',
                generation: 2,
                builtGeneration: 1,
                facetCount: 10,
                collectionCount: 2,
            },
        });

        await expect(syncHook!.selectInvokeOwnerScope({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        })).resolves.toBe(true);

        expect(mocks.beginActiveInvokeScopeCacheBuild).toHaveBeenCalledOnce();
        expect(mocks.refreshFacetCacheForResourcesStrict).not.toHaveBeenCalled();
        expect(mocks.clearCollectionOwnerScopeCaches).toHaveBeenCalledOnce();
        expect(refreshCollections).toHaveBeenLastCalledWith(false, {
            includeThumbnails: false,
            scheduleSmartRefresh: false,
            consistency: 'authoritative',
        });
        expect(refreshSmartCounts).toHaveBeenCalledWith(expect.objectContaining({
            includeArchived: true,
            includePromptSearch: true,
            consistency: 'authoritative',
        }));
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(false, true, {
            consistency: 'authoritative',
        });
        expect(mocks.commitActiveInvokeScopeCache).toHaveBeenCalledOnce();

        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockClear();
        mocks.commitActiveInvokeScopeCache.mockClear();
        mocks.abortActiveInvokeScopeCacheBuild.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild
            .mockResolvedValueOnce(createInvokeScopeCacheClaim({
                action: 'full',
                resources: {
                    checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                    controlNets: [], ipAdapters: [], tools: [],
                },
                facetTypes: [],
                collectionsDirty: true,
            }, 3))
            .mockResolvedValueOnce(createInvokeScopeCacheClaim({
                action: 'restored',
                resources: {
                    checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                    controlNets: [], ipAdapters: [], tools: [],
                },
                facetTypes: [],
                collectionsDirty: false,
            }, 4));
        mocks.rebuildFacetCacheStrict.mockRejectedValueOnce(new Error('facet rebuild failed'));

        await expect(syncHook!.selectInvokeOwnerScope({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-b',
        })).resolves.toBe(false);

        expect(mocks.abortActiveInvokeScopeCacheBuild).toHaveBeenCalledWith({
            scopeKey: 'test-scope',
            generation: 3,
        });

        mocks.beginActiveInvokeScopeCacheBuild.mockClear();
        mocks.commitActiveInvokeScopeCache.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild.mockResolvedValueOnce(createInvokeScopeCacheClaim({
            action: 'full',
            resources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
            facetTypes: [],
            collectionsDirty: true,
        }, 5));
        await expect(syncHook!.selectInvokeOwnerScope({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-b',
        })).resolves.toBe(true);
        expect(mocks.commitActiveInvokeScopeCache).toHaveBeenCalledWith({
            scopeKey: 'test-scope',
            generation: 5,
        });
    });

    it('retries one superseded cache claim and rolls back after a second supersession', async () => {
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
        const fullRepair = {
            action: 'full' as const,
            resources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
            facetTypes: [],
            collectionsDirty: true,
        };
        const restoredRepair = {
            ...fullRepair,
            action: 'restored' as const,
            collectionsDirty: false,
        };
        mocks.discoverInvokeOwners.mockResolvedValue(discovery);
        mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: {
            selection?: { mode: 'owner' | 'all'; ownerId?: string };
        }) => ({
            changed: selection?.mode === 'owner',
            sourceFactsUpdated: 0,
            activeVisibilityUpdated: selection?.mode === 'owner' ? 1 : 0,
            removedVisibilityUpdated: 0,
            boardCollectionsUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));
        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());

        renderSyncStack(h => libraryHook = h, h => syncHook = h);
        await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
        await act(async () => libraryHook?.setSettings({ invokeAiPath: 'D:/Invoke' }));
        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required'));

        mocks.beginActiveInvokeScopeCacheBuild
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(fullRepair, 1))
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(restoredRepair, 2));
        mocks.commitActiveInvokeScopeCache.mockResolvedValueOnce({
            status: 'error',
            error: 'Active Invoke scope cache changed while it was being prepared.',
        });

        await expect(syncHook!.selectInvokeOwnerScope({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        })).resolves.toBe(true);

        expect(mocks.beginActiveInvokeScopeCacheBuild).toHaveBeenCalledTimes(2);
        expect(mocks.commitActiveInvokeScopeCache).toHaveBeenCalledOnce();
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        });

        mocks.beginActiveInvokeScopeCacheBuild.mockClear();
        mocks.commitActiveInvokeScopeCache.mockClear();
        mocks.beginActiveInvokeScopeCacheBuild
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(fullRepair, 3))
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(fullRepair, 4))
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(restoredRepair, 5))
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(restoredRepair, 6));
        mocks.commitActiveInvokeScopeCache
            .mockResolvedValueOnce({
                status: 'error',
                error: 'Active Invoke scope cache changed while it was being prepared.',
            })
            .mockResolvedValueOnce({
                status: 'error',
                error: 'Active Invoke scope cache changed while it was being prepared.',
            });

        await expect(syncHook!.selectInvokeOwnerScope({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-b',
        })).resolves.toBe(false);

        expect(mocks.commitActiveInvokeScopeCache).toHaveBeenCalledTimes(2);
        expect(mocks.beginActiveInvokeScopeCacheBuild).toHaveBeenCalledTimes(4);
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'owner',
            ownerId: 'owner-a',
        });
        expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'ready',
            scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
        }));
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
        await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(
            expect.objectContaining({ selection: expect.objectContaining({ ownerId: 'owner-a' }) })
        ));
        const ownerApplications = mocks.applyInvokeOwnerScope.mock.calls.filter(([
            request,
        ]) => request.selection?.mode === 'owner');
        expect(ownerApplications).toHaveLength(1);
        expect(ownerApplications[0][0].selection.ownerId).toBe('owner-a');

        await act(async () => {
            ownerApplication.resolve({
                changed: true,
                sourceFactsUpdated: 0,
                activeVisibilityUpdated: 1,
                removedVisibilityUpdated: 0,
                mode: 'owner',
            });
            expect(await firstSelection).toBe(true);
        });
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
        expect(mocks.refreshInvokeOwnerVisibility).toHaveBeenCalledWith(discovery, undefined, true);
        expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalled();
        expect(mocks.clearLibraryStatsCache).toHaveBeenCalled();
        expect(useSettingsStore.getState().settings.invokeOwnerSelection).toBeUndefined();
        expect(syncHook?.invokeOwnerScopeState.status).toBe('selection_required');
        expect(useInvokeOwnerScopeStore.getState().operation).toEqual(expect.objectContaining({
            phase: 'failed', viewCommitted: false, retry: expect.any(Function),
        }));
    });

    it('restores the previous owner scope when derived-cache preparation fails', async () => {
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

        expect(syncHook?.invokeOwnerScopeState.status).toBe('ready');
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'all',
        });
        await act(async () => syncHook?.startInvokeSync({ mode: 'manual' }));

        expect(mocks.syncImages).toHaveBeenCalledWith(
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                scope: expect.objectContaining({ mode: 'all' }),
            })
        );
        expect(syncHook?.invokeOwnerScopeState.status).toBe('ready');
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath,
            mode: 'all',
        });
        expect(mocks.refreshInvokeOwnerVisibility).toHaveBeenCalledWith(
            discovery,
            expect.objectContaining({ mode: 'all' }),
            true,
        );
    });

    it('restores the previous owner when ready publication throws before commitment or image import', async () => {
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
            boardCollectionsUpdated: 0,
            mode: selection?.mode ?? 'unselected',
        }));
        mocks.syncImages.mockResolvedValue(createNoopInvokeSyncResult());

        const originalSetOwnerScopeState = useInvokeOwnerScopeStore.getState().setOwnerScopeState;
        let throwOnTargetReady = true;
        useInvokeOwnerScopeStore.setState({
            setOwnerScopeState: update => {
                originalSetOwnerScopeState(update);
                const nextState = useInvokeOwnerScopeStore.getState().ownerScopeState;
                if (throwOnTargetReady
                    && nextState.status === 'ready'
                    && nextState.scope?.mode === 'owner'
                    && nextState.scope.ownerId === 'owner-b') {
                    throwOnTargetReady = false;
                    throw new Error('target ready publication failed');
                }
            },
        });

        try {
            renderSyncStack(h => libraryHook = h, h => syncHook = h);
            await waitFor(() => expect(libraryHook?.isLoaded).toBe(true));
            await act(async () => libraryHook?.setSettings({
                invokeAiPath: 'D:/Invoke',
                invokeOwnerSelection: {
                    dbPath: discovery.dbPath,
                    mode: 'owner',
                    ownerId: 'owner-a',
                },
            }));
            await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
            mocks.applyInvokeOwnerScope.mockClear();
            mocks.syncImages.mockClear();

            await act(async () => {
                expect(await syncHook!.selectInvokeOwnerScope({
                    dbPath: discovery.dbPath,
                    mode: 'owner',
                    ownerId: 'owner-b',
                })).toBe(false);
            });

            const previousSelection = {
                dbPath: discovery.dbPath,
                mode: 'owner' as const,
                ownerId: 'owner-a',
            };
            expect(throwOnTargetReady).toBe(false);
            expect(libraryHook?.settings.invokeOwnerSelection).toEqual(previousSelection);
            expect(useSettingsStore.getState().settings.invokeOwnerSelection).toEqual(previousSelection);
            expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
                status: 'ready',
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-a' }),
            }));
            expect(mocks.syncImages).not.toHaveBeenCalled();
            expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce();
            expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
                selection: { ...previousSelection, ownerId: 'owner-b' },
            }));
            expect(mocks.refreshInvokeOwnerVisibility).toHaveBeenCalledWith(discovery, previousSelection, true);
            expect(useInvokeOwnerScopeStore.getState().operation).toEqual(expect.objectContaining({
                phase: 'failed', viewCommitted: false,
            }));
        } finally {
            useInvokeOwnerScopeStore.setState({ setOwnerScopeState: originalSetOwnerScopeState });
        }
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

        let syncPromise!: ReturnType<SyncHook['startInvokeSync']>;
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

    it('gates stale owner completion until an explicit retry applies the drifted owner with its own cursor', async () => {
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

        let syncPromise!: ReturnType<SyncHook['startInvokeSync']>;
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

        await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('error'));
        expect(mocks.syncImages).toHaveBeenCalledOnce();
        expect(libraryHook?.settings.invokeOwnerSelection).toEqual({
            dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-b',
        });
        expect(libraryHook?.settings.lastSyncedAt).toBeNull();
        expect(mocks.getInvokeDbSnapshot).not.toHaveBeenCalled();
        expect(mocks.scanForOrphans).not.toHaveBeenCalled();

        mocks.syncImages.mockResolvedValueOnce(createNoopInvokeSyncResult());
        await act(async () => expect(await syncHook!.retryInvokeOwnerScope()).toBe(true));

        expect(syncHook?.invokeOwnerScopeState).toEqual(expect.objectContaining({
            status: 'ready', scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
        }));
        await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(3));
        expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
            selection: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
        }));
        expect(mocks.syncImages).toHaveBeenNthCalledWith(2,
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'manual',
                afterTimestamp: null,
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
            }),
        );
        expect(mocks.syncImages).toHaveBeenNthCalledWith(3,
            'D:/Invoke',
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({
                mode: 'live', afterTimestamp: 100,
                scope: expect.objectContaining({ mode: 'owner', ownerId: 'owner-b' }),
            }),
        );
        expect(libraryHook?.settings.lastSyncedAt).toBe(100);
        expect(libraryHook?.settings.invokeDbSnapshot).toEqual(expect.objectContaining({
            scopeMode: 'owner', scopeOwnerId: 'owner-b', lastSyncedAt: 100,
        }));
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
        let firstPromise!: ReturnType<SyncHook['startInvokeSync']>;
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
        let startupPromise!: ReturnType<SyncHook['startInvokeSync']>;
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

    it('joins duplicate startup callers to the same owner-scoped run', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' }));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));

        const startupDeferred = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
        mocks.syncImages.mockClear();
        mocks.syncImages.mockReturnValueOnce(startupDeferred.promise);
        let firstPromise!: ReturnType<SyncHook['startInvokeSync']>;
        act(() => {
            firstPromise = hook!.startInvokeSync({ mode: 'startup' });
        });
        await waitFor(() => expect(hook?.isInvokeSyncActive).toBe(true));

        let secondSettled = false;
        let secondPromise!: Promise<void>;
        act(() => {
            secondPromise = hook!.startInvokeSync({ mode: 'startup' }).then(() => {
                secondSettled = true;
            });
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(secondSettled).toBe(false);
        expect(mocks.syncImages).toHaveBeenCalledTimes(1);

        await act(async () => {
            startupDeferred.resolve(createNoopInvokeSyncResult());
            await Promise.all([firstPromise, secondPromise]);
        });
        expect(secondSettled).toBe(true);
        expect(mocks.syncImages).toHaveBeenCalledTimes(1);
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
        let activeInvoke!: ReturnType<SyncHook['startInvokeSync']>;
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
        const refreshCollectionsSpy = vi.fn(defaultRefreshCollections);
        useCollectionStore.setState({ refreshCollections: refreshCollectionsSpy });
        const effectiveBoards: Collection[] = [
            { id: 'existing-board', name: 'Local label', invokeSourceName: 'Renamed board', invokeNameOverridden: true, source: 'invoke', imageIds: [], createdAt: 1 },
            { id: 'new-board', name: 'New board', invokeNameOverridden: false, source: 'invoke', imageIds: [], createdAt: 1 },
        ];
        mocks.getAllCollectionsWithStats.mockResolvedValue(effectiveBoards);
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
                invokeSyncBoards: true,
                importOrphans: true,
                importIntermediates: true,
            });
        });
        await waitFor(() => expect(hook?.settings.invokeSyncBoards).toBe(true));
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
        expect(refreshCollectionsSpy).toHaveBeenCalledWith(false, expect.objectContaining({ consistency: 'authoritative' }));
        expect(useCollectionStore.getState().collections).toEqual(effectiveBoards);
        expect(hook?.collections.find(collection => collection.id === 'existing-board')?.name).toBe('Local label');
    });

    it('refreshes unchanged source boards from effective collection data', async () => {
        const refreshCollectionsSpy = vi.fn(defaultRefreshCollections);
        useCollectionStore.setState({ refreshCollections: refreshCollectionsSpy });
        const effectiveBoard: Collection = { id: 'same-board', name: 'Local label', invokeSourceName: 'Same name', invokeNameOverridden: true, source: 'invoke', imageIds: [], createdAt: 1 };
        mocks.getAllCollectionsWithStats.mockResolvedValue([effectiveBoard]);
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI', invokeSyncBoards: true }));
        mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), boardMapping: new Map([['same-board', { name: 'Same name', createdAt: 1 }]]) });
        await act(async () => hook?.startInvokeSync({ mode: 'manual' }));
        expect(refreshCollectionsSpy).toHaveBeenCalledWith(false, expect.objectContaining({ consistency: 'authoritative' }));
        expect(useCollectionStore.getState().collections).toEqual([effectiveBoard]);
        expect(hook?.collections[0]?.name).toBe('Local label');
    });

    it.each([
        ['color', 'completed'], ['pin', 'completed'], ['archive', 'completed'],
        ['color', 'aborted'], ['pin', 'aborted'], ['archive', 'aborted'],
    ] as const)('preserves a local Invoke name through a %s edit during %s finalization and a remount', async (edit, outcome) => {
        const saved = await mocks.appRepository.load();
        let persisted: Collection = { id: 'edited-board', name: 'Upstream', source: 'invoke', imageIds: [], createdAt: 1,
            invokeSourceId: 'D:/Invoke/databases/invokeai.db', invokeSourceName: 'Upstream', invokeNameOverridden: false };
        mocks.getAllCollectionsWithStats.mockImplementation(async () => [{ ...persisted }]);
        mocks.renameCollectionInDb.mockImplementation(async (id: string, name: string) => {
            expect(id).toBe(persisted.id);
            persisted = { ...persisted, name, invokeNameOverridden: true };
        });
        mocks.upsertCollection.mockImplementation(async (collection: Collection) => {
            // The mocked DB boundary follows the repository's preservation contract.
            persisted = { ...persisted, ...collection, name: persisted.name, invokeNameOverridden: persisted.invokeNameOverridden };
        });
        mocks.appRepository.load.mockResolvedValue({ ...saved, collectionStorageVersion: 1, settings: {
            ...saved.settings, invokeAiPath: 'D:/Invoke', invokeSyncBoards: true, lastSyncedAt: 100,
            importOrphans: false, importIntermediates: false, invokeOwnerSelection: undefined,
            invokeDbSnapshot: undefined, invokeDbSnapshots: [],
        } });
        useCollectionStore.setState(useCollectionStore.getInitialState(), true);
        useCollectionStore.getState().invalidateInitialization();
        let syncHook: SyncHook | undefined;
        let operations: CollectionOperations | undefined;
        const renderJourney = () => render(<ToastProvider><LibraryProvider>
            <SyncTestConsumer onHook={hook => { syncHook = hook; }} />
            <CollectionOperationsConsumer onOperations={value => { operations = value; }} />
        </LibraryProvider></ToastProvider>);
        let view = renderJourney();
        try {
            await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
            await waitFor(() => expect(screen.getByTestId('edited-collection-name').textContent).toBe('Upstream'));
            await act(async () => operations!.renameCollection('edited-board', 'Local label'));
            expect(screen.getByTestId('edited-collection-name').textContent).toBe('Local label');
            const finalization = createDeferred<number>();
            mocks.rebuildFacetCache.mockReturnValueOnce(finalization.promise);
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), imported: 1, maxTimestamp: 200,
                boardsChanged: true, boardMapping: new Map([['edited-board', { name: 'Upstream changed', createdAt: 1 }]]) });
            let syncing!: ReturnType<SyncHook['startInvokeSync']>;
            act(() => { syncing = syncHook!.startInvokeSync({ mode: 'manual' }); });
            await waitFor(() => expect(mocks.rebuildFacetCache).toHaveBeenCalledOnce());
            expect(useLibraryStore.getState().syncStatus).toBe('syncing');
            expect(screen.getByTestId('edited-collection-name').textContent).toBe('Local label');
            await act(async () => {
                if (edit === 'color') await operations!.setCollectionColor('edited-board', '#abcdef');
                if (edit === 'pin') await operations!.togglePinCollection('edited-board');
                if (edit === 'archive') await operations!.toggleArchiveCollection('edited-board');
            });
            const expectedEdit = edit === 'color' ? { color: '#abcdef' } : edit === 'pin' ? { isPinned: true } : { isArchived: true };
            expect(mocks.upsertCollection).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Local label', invokeNameOverridden: true, ...expectedEdit }));
            expect(persisted).toMatchObject({ name: 'Local label', invokeNameOverridden: true, ...expectedEdit });
            if (outcome === 'aborted') act(() => syncHook!.cancelSync());
            await act(async () => {
                finalization.resolve(0);
                expect(await syncing).toMatchObject({ status: outcome });
            });
            expect(screen.getByTestId('edited-collection-name').textContent).toBe('Local label');
            expect(useCollectionStore.getState().collections.find(collection => collection.id === 'edited-board'))
                .toMatchObject({ name: 'Local label', invokeNameOverridden: true, ...expectedEdit });
            const committedSettings = useSettingsStore.getState().settings;
            view.unmount();
            mocks.appRepository.load.mockResolvedValue({ ...saved, collectionStorageVersion: 1, settings: committedSettings });
            useSettingsStore.setState(useSettingsStore.getInitialState(), true);
            useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
            useCollectionStore.setState(useCollectionStore.getInitialState(), true);
            useCollectionStore.getState().invalidateInitialization();
            view = renderJourney();
            await waitFor(() => expect(syncHook?.invokeOwnerScopeState.status).toBe('ready'));
            await waitFor(() => expect(screen.getByTestId('edited-collection-name').textContent).toBe('Local label'));
            expect(useCollectionStore.getState().collections[0]).toMatchObject({ name: 'Local label', invokeNameOverridden: true, ...expectedEdit });
            expect(persisted).toMatchObject({ name: 'Local label', invokeNameOverridden: true, ...expectedEdit });
        } finally {
            view.unmount();
            mocks.appRepository.load.mockResolvedValue(saved);
        }
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
    it('aborts a manual cache claim when completion fails after facet rebuild and allows retry', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({ invokeAiPath: 'D:/AmbitFixtures/InvokeAI' }));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));

        await waitFor(() => expect(mocks.commitActiveInvokeScopeCache).toHaveBeenCalled());
        const refreshCollectionThumbnails = vi.fn()
            .mockRejectedValueOnce(new Error('thumbnail refresh failed'))
            .mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollectionThumbnails });

        const changedSyncResult = {
            ...createNoopInvokeSyncResult(),
            imported: 1,
            maxTimestamp: 200,
            syncedIds: new Set(['image-a']),
            boardMapping: new Map([['board-a', { name: 'Board A', createdAt: 1 }]]),
        };
        mocks.syncImages.mockClear()
            .mockResolvedValueOnce(changedSyncResult)
            .mockResolvedValueOnce({ ...changedSyncResult, maxTimestamp: 201 });
        const fullRepair = {
            action: 'full' as const,
            resources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
            facetTypes: [],
            collectionsDirty: true,
        };
        mocks.beginActiveInvokeScopeCacheBuild.mockClear()
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(fullRepair, 7))
            .mockResolvedValueOnce(createInvokeScopeCacheClaim(fullRepair, 8));
        mocks.commitActiveInvokeScopeCache.mockClear();
        mocks.abortActiveInvokeScopeCacheBuild.mockClear();

        await act(async () => hook?.startInvokeSync({ mode: 'manual' }));

        expect(mocks.abortActiveInvokeScopeCacheBuild).toHaveBeenCalledWith({
            scopeKey: 'test-scope',
            generation: 7,
        });

        await act(async () => hook?.startInvokeSync({ mode: 'manual' }));

        expect(mocks.commitActiveInvokeScopeCache).toHaveBeenCalledWith({
            scopeKey: 'test-scope',
            generation: 8,
        });
        mocks.syncImages.mockReset().mockResolvedValue({
            imported: 5,
            updated: 0,
            maxTimestamp: 100,
            syncedIds: new Set(),
            boardMapping: new Map(),
            touchedFacetTypes: [],
            touchedFacetResources: {
                checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
                controlNets: [], ipAdapters: [], tools: [],
            },
        });
        mocks.beginActiveInvokeScopeCacheBuild.mockReset()
            .mockResolvedValue(createInvokeScopeCacheClaim(fullRepair, 0));
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
        let firstPromise!: ReturnType<SyncHook['startInvokeSync']>;
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
            invokeSyncBoards: true,
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
        expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ imported: 1, updated: 0 });
        expect(useLibraryStore.getState().syncProgress.total).toBe(0);
        expect(refreshCollections).toHaveBeenCalledOnce();
        expect(refreshCollections).toHaveBeenCalledWith(false, {
            consistency: 'authoritative',
        });
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(true);
        consoleWarn.mockRestore();
    });

    it('publishes board-only live changes when no images were imported', async () => {
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        const refreshSmartCounts = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections, refreshCollectionThumbnails, refreshSmartCounts });
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            invokeSyncBoards: true,
        }));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        refreshCollections.mockClear();
        refreshCollectionThumbnails.mockClear();
        refreshSmartCounts.mockClear();
        mocks.syncImages.mockResolvedValueOnce({
            ...createNoopInvokeSyncResult(),
            boardMapping: new Map([['renamed-board', { name: 'Renamed board', createdAt: 1 }]]),
        });

        await act(async () => hook?.startInvokeSync({ mode: 'live' }));

        expect(refreshCollections).toHaveBeenCalledWith(false, {
            consistency: 'authoritative',
        });
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(true);
        expect(refreshSmartCounts).toHaveBeenCalledWith({ includeArchived: false, markPending: false });
    });

    it('publishes authoritative board removals when the live snapshot is empty', async () => {
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        const refreshSmartCounts = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections, refreshCollectionThumbnails, refreshSmartCounts });
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            invokeSyncBoards: true,
        }));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        refreshCollections.mockClear();
        refreshCollectionThumbnails.mockClear();
        refreshSmartCounts.mockClear();
        mocks.syncImages.mockResolvedValueOnce({
            ...createNoopInvokeSyncResult(),
            updated: 0,
            boardsChanged: true,
        });

        await act(async () => hook?.startInvokeSync({ mode: 'live' }));

        expect(refreshCollections).toHaveBeenCalledWith(false, {
            scheduleSmartRefresh: false,
            consistency: 'authoritative',
        });
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(true);
        expect(refreshSmartCounts).toHaveBeenCalledWith({ includeArchived: false, markPending: false });
        expect(useLibraryStore.getState().liveWatchSession.receivedCount).toBe(0);
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

    it('shows finalization stages for changed startup sync without inventing image progress totals', async () => {
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
        expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ imported: 1, updated: 0 });
        expect(useLibraryStore.getState().syncProgress).toEqual({
            current: 0,
            total: 0,
            message: 'Updating collections and library details...',
        });
    });

    it('falls back to full facets and reports asynchronous live refresh failures', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        const refreshSmartCounts = vi.fn().mockResolvedValue(undefined);
        useCollectionStore.setState({ refreshCollections, refreshCollectionThumbnails, refreshSmartCounts });
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        let syncHook: SyncHook | undefined;
        renderSyncStack(h => hook = h, h => syncHook = h);
        await waitFor(() => expect(hook?.isLoaded).toBe(true));
        await act(async () => hook?.setSettings({
            invokeAiPath: 'D:/AmbitFixtures/InvokeAI',
            invokeSyncBoards: true,
        }));
        await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
        refreshCollections.mockClear();
        refreshCollectionThumbnails.mockClear();
        refreshSmartCounts.mockClear();
        mocks.rebuildFacetCacheStrict.mockClear();
        mocks.commitActiveInvokeScopeCache.mockClear();
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
            '[Sync] Failed to preserve the active Invoke scope cache after live sync',
            expect.any(Error),
        ));
        expect(refreshCollections).toHaveBeenCalledWith(false, {
            scheduleSmartRefresh: false,
            consistency: 'authoritative',
        });
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(true);
        expect(refreshSmartCounts).toHaveBeenCalledWith({ includeArchived: false, markPending: false });
        expect(mocks.commitActiveInvokeScopeCache).not.toHaveBeenCalled();

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

    describe('InvokeAI operation feedback', () => {
        beforeEach(() => {
            mocks.appRepository.load.mockImplementation(defaultRepositoryLoad);
            mocks.getInvokeDbSnapshot.mockReset().mockImplementation(defaultInvokeSnapshotImplementation);
            mocks.syncImages.mockReset().mockResolvedValue(createNoopInvokeSyncResult());
        });
        afterEach(() => {
            mocks.syncImages.mockReset().mockImplementation(defaultInvokeSyncImplementation);
            mocks.appRepository.load.mockImplementation(defaultRepositoryLoad);
            mocks.getInvokeDbSnapshot.mockReset().mockImplementation(defaultInvokeSnapshotImplementation);
            vi.useRealTimers();
        });

        const setupFeedback = async () => {
            let hook: ReturnType<typeof useLibraryContext> | undefined;
            renderStack(value => { hook = value; });
            await waitFor(() => expect(hook?.isLoaded).toBe(true));
            await act(async () => hook?.setSettings({ invokeAiPath: 'D:/Invoke', importOrphans: false }));
            await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('ready'));
            return hook!;
        };

        it('records automatic no-change completion without a success toast', async () => {
            const hook = await setupFeedback();
            await act(async () => { await hook.startInvokeSync({ mode: 'startup' }); });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                origin: 'startup', phase: 'completed', hasChanges: false, imported: 0, updated: 0,
            });
            expect(screen.queryByText(/Your InvokeAI view is ready/)).toBeNull();
            expect(screen.queryByText(/Synchronization complete:/)).toBeNull();
        });

        it('records board-only startup changes even when no images are added or updated', async () => {
            const hook = await setupFeedback();
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), boardsChanged: true });
            await act(async () => { await hook.startInvokeSync({ mode: 'startup' }); });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                origin: 'startup', phase: 'completed', hasChanges: true, imported: 0, updated: 0,
            });
            expect(screen.queryByText(/Synchronization complete:/)).toBeNull();
        });

        it('keeps a manually requested no-change result explicit without a duplicate toast', async () => {
            const hook = await setupFeedback();
            await act(async () => { await hook.startInvokeSync({ mode: 'manual' }); });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                origin: 'user', phase: 'completed', hasChanges: false,
            });
            expect(screen.queryByText('Synchronization complete: No new changes.')).toBeNull();
        });

        it.each([false, true])('reports preparation-only board changes once when the image snapshot is current: %s', async (currentSnapshot) => {
            mocks.applyInvokeOwnerScope.mockResolvedValue({
                changed: true, sourceFactsUpdated: 0, activeVisibilityUpdated: 0,
                removedVisibilityUpdated: 0, boardCollectionsUpdated: 1, mode: 'legacy',
            });
            const hook = await setupFeedback();
            if (currentSnapshot) {
                mocks.getInvokeDbSnapshot.mockResolvedValueOnce({ status: 'ok', data: {
                    dbPath: 'D:/Invoke/databases/invokeai.db', files: [],
                } });
                await act(async () => hook.setSettings({ lastSyncedAt: 123, invokeDbSnapshot: {
                    dbPath: 'D:/Invoke/databases/invokeai.db', lastSyncedAt: 123, scopeMode: 'legacy',
                    scopeOwnerId: null, importIntermediates: false, importOrphans: false,
                    syncBoardsToCollections: true, pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                    boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION, files: [],
                } }));
            }
            render(<ActivityDock />);
            await act(async () => { await hook.startInvokeSync({ mode: 'startup' }); });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                phase: 'completed', origin: 'startup', hasChanges: true,
            });
            expect(screen.getByText('Synchronization complete.')).toBeTruthy();
            if (currentSnapshot) expect(mocks.syncImages).not.toHaveBeenCalled();
            await act(async () => { await hook.startInvokeSync({ mode: 'startup' }); });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                phase: 'completed', hasChanges: false,
            });
        });

        it('retains actual path corrections when cancellation follows a native commit', async () => {
            const hook = await setupFeedback();
            const previousCursor = useSettingsStore.getState().settings.lastSyncedAt;
            mocks.syncImages.mockImplementationOnce(async (
                _root: string, _progress: unknown, _signal: AbortSignal, options: InvokeSyncOptions,
            ) => {
                options.onPathCheckProgress?.({ phase: 'repairing', current: 2, total: 2, repaired: 2 });
                useInvokeOwnerScopeStore.getState().operation?.cancel?.();
                throw new Error('Aborted');
            });
            await act(async () => { await hook.startInvokeSync({ mode: 'manual' }); });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                origin: 'user', phase: 'cancelled', pathsRepaired: 2, updated: 2, retry: expect.any(Function),
            });
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(previousCursor);
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
        });

        it('keeps typed path-check counts and elapsed metadata while source work is pending', async () => {
            const hook = await setupFeedback();
            const pending = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
            mocks.syncImages.mockImplementationOnce((
                _root: string, onProgress: (current: number, total: number, message?: string) => void,
                _signal: AbortSignal, options: InvokeSyncOptions,
            ) => {
                onProgress(0, 0, 'Checking image locations…');
                options.onPathCheckProgress?.({ phase: 'checking', current: 0, total: 0, repaired: 0 });
                return pending.promise;
            });
            let run!: ReturnType<SyncHook['startInvokeSync']>;
            await act(async () => { run = hook.startInvokeSync({ mode: 'manual' }); });
            const progress = useInvokeOwnerScopeStore.getState().operation?.progress;
            expect(progress).toMatchObject({ phase: 'checking', mode: 'indeterminate',
                message: 'Checking image locations…', current: 0, total: 0, startedAt: expect.any(Number) });
            expect(useLibraryStore.getState().syncProgress).toEqual(progress);
            await act(async () => { pending.resolve(createNoopInvokeSyncResult()); await run; });
        });

        it('reveals sustained automatic work with Cancel, then expires its visible no-change result', async () => {
            const hook = await setupFeedback();
            render(<ActivityDock />);
            const pending = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
            mocks.syncImages.mockReturnValueOnce(pending.promise);
            let run!: ReturnType<SyncHook['startInvokeSync']>;
            await act(async () => { run = hook.startInvokeSync({ mode: 'startup' }); });
            expect(useInvokeOwnerScopeStore.getState().operation?.origin).toBe('startup');
            expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
            await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy(), { timeout: 3500 });
            await act(async () => { pending.resolve(createNoopInvokeSyncResult()); await run; });
            expect(screen.getByText('Already up to date.')).toBeTruthy();
            await waitFor(() => expect(screen.queryByText('Already up to date.')).toBeNull(), { timeout: 6500 });
        }, 15000);

        it('shows a quick board-only result and dismisses it without requiring image changes', async () => {
            const hook = await setupFeedback();
            render(<ActivityDock />);
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), boardsChanged: true });
            await act(async () => { await hook.startInvokeSync({ mode: 'startup' }); });
            expect(screen.getByText('Synchronization complete.')).toBeTruthy();
            expect(screen.getByText('0 added')).toBeTruthy();
            await waitFor(() => expect(screen.queryByText('Synchronization complete.')).toBeNull(), { timeout: 6500 });
        }, 10000);

        it('rechecks a configured connection after remount without resetting its cursor or replaying unchanged images', async () => {
            let saved: AppState = {
                settings: createDefaultAppSettings({ invokeAiPath: 'D:/Invoke', lastSyncedAt: 123,
                    invokeDbSnapshot: { dbPath: 'D:/Invoke/databases/invokeai.db', lastSyncedAt: 123,
                        scopeMode: 'legacy', scopeOwnerId: null, importIntermediates: false,
                        importOrphans: false, syncBoardsToCollections: true,
                        pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
                        importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
                        boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION, files: [] },
                    invokeSyncBoards: true, importOrphans: false, hasCompletedOnboarding: true }),
                images: [], collections: [], smartCollections: [], recentSearches: [],
            };
            mocks.appRepository.load.mockImplementation(async () => saved);
            mocks.appRepository.update.mockImplementation(async (updater: (state: AppState) => AppState) => {
                saved = updater(saved);
                return saved;
            });
            mocks.syncImages.mockResolvedValue({ ...createNoopInvokeSyncResult(), maxTimestamp: 123 });
            mocks.getInvokeDbSnapshot.mockResolvedValue({ status: 'ok', data: {
                dbPath: 'D:/Invoke/databases/invokeai.db', files: [{
                    path: 'D:/Invoke/databases/invokeai.db', exists: true, size: 10, modifiedMs: 2,
                }],
            } });
            const mount = () => render(<ToastProvider><LibraryProvider><StartupFeedbackConsumer /></LibraryProvider></ToastProvider>);
            const firstMount = mount();
            await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));
            await waitFor(() => expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('completed'));
            expect(mocks.syncImages).toHaveBeenLastCalledWith(expect.any(String), expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'startup', afterTimestamp: 123 }));
            expect(screen.queryByText(/Synchronization complete|Already up to date|Your InvokeAI view is ready/)).toBeNull();
            const sourceChecks = mocks.getInvokeDbSnapshot.mock.calls.length;
            firstMount.unmount();
            act(() => {
                useLibraryStore.setState(useLibraryStore.getInitialState(), true);
                useInvokeOwnerScopeStore.getState().resetOwnerScopeState();
                useSettingsStore.setState(useSettingsStore.getInitialState(), true);
            });
            mount();
            await waitFor(() => expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('completed'));
            expect(mocks.getInvokeDbSnapshot.mock.calls.length).toBeGreaterThan(sourceChecks);
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(123);
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            expect(screen.queryByText(/Synchronization complete|Already up to date|Your InvokeAI view is ready/)).toBeNull();
        });
    });

    describe('explicit InvokeAI connection application', () => {
        const source = (root = 'D:/Invoke'): InvokeOwnerDiscovery => ({
            schemaMode: 'multi_user', dbPath: `${root}/databases/invokeai.db`, imagesRoot: root,
            owners: [{ ownerId: 'owner-a', imageCount: 4 }, { ownerId: 'owner-b', imageCount: 5 }],
            unassignedImageCount: 0,
        });
        const snapshot = (ownerId: string, cursor: number): InvokeDbSnapshotState => ({
            dbPath: source().dbPath, lastSyncedAt: cursor, scopeMode: 'owner', scopeOwnerId: ownerId,
            importIntermediates: false, importOrphans: false, syncBoardsToCollections: true,
            pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
            importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
            boardOwnerSchemaVersion: INVOKE_BOARD_OWNER_SCHEMA_VERSION, files: [],
        });
        const setup = async (configured = false, expectedStatus = 'ready') => {
            let hook: SyncHook | undefined;
            renderSyncStack(() => undefined, value => { hook = value; });
            await waitFor(() => expect(useSettingsStore.getState().isLoaded).toBe(true));
            if (configured) {
                act(() => useSettingsStore.getState().setSettings({
                    invokeAiPath: 'D:/Invoke',
                    invokeOwnerSelection: { dbPath: source().dbPath, mode: 'owner', ownerId: 'owner-a' },
                    invokeDbSnapshot: snapshot('owner-a', 100),
                    invokeDbSnapshots: [snapshot('owner-a', 100), snapshot('owner-b', 200)],
                    lastSyncedAt: 100,
                    invokeSyncBoards: true,
                }));
                await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe(expectedStatus));
            } else {
                await waitFor(() => expect(hook?.invokeOwnerScopeState.status).toBe('idle'));
            }
            mocks.applyInvokeOwnerScope.mockClear();
            mocks.syncImages.mockClear();
            return hook!;
        };
        const draftFor = (ownerId = 'owner-a', root = 'D:/Invoke') => ({
            ...getInvokeConnectionDraft(useSettingsStore.getState().settings),
            invokeAiPath: root,
            invokeOwnerSelection: { dbPath: source(root).dbPath, mode: 'owner' as const, ownerId },
        });

        beforeEach(() => {
            mocks.discoverInvokeOwners.mockImplementation(async (root: string) => source(root));
            mocks.syncImages.mockReset().mockResolvedValue(createNoopInvokeSyncResult());
            mocks.getInvokeDbSnapshot.mockImplementation(async (root: string) => ({
                status: 'ok', data: { dbPath: source(root).dbPath, files: [] },
            }));
            mocks.applyInvokeOwnerScope.mockImplementation(async ({ selection }: { selection?: { mode: string } }) => ({
                changed: false, sourceFactsUpdated: 0, activeVisibilityUpdated: 0, removedVisibilityUpdated: 0,
                mode: selection?.mode ?? 'unselected',
            }));
        });

        it('preserves user origin when an explicit owner switch uses startup synchronization internally', async () => {
            const hook = await setup(true);
            await act(async () => { await hook.applyInvokeConnection(draftFor('owner-b')); });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                origin: 'user', phase: 'completed', hasChanges: false, viewCommitted: true,
            });
            expect(screen.queryByText(/Your InvokeAI view is ready|Synchronization complete:/)).toBeNull();
        });

        it('commits the reviewed first connection once and imports with its options', async () => {
            const hook = await setup();
            const draft = { ...draftFor(), invokeSyncFavorites: false, invokeSyncBoards: false,
                importIntermediates: true, importOrphans: true, starredAs: 'pin' as const };
            expect(useSettingsStore.getState().settings.invokeAiPath).toBeUndefined();
            expect(mocks.syncImages).not.toHaveBeenCalled();
            await act(async () => expect(await hook.applyInvokeConnection(draft)).toEqual({ status: 'completed', viewCommitted: true }));
            expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledTimes(1);
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'manual', scope: expect.objectContaining({ ownerId: 'owner-a' }),
                    syncFavorites: false, syncBoards: false, starredAs: 'pin', importIntermediates: true, afterTimestamp: 0 }));
            expect(useSettingsStore.getState().settings).toMatchObject(draft);
            expect(mocks.scanForOrphans).not.toHaveBeenCalled();
        });

        it.each(['missing', 'stale-owner', 'wrong-database'] as const)('rejects %s before committing or admitting content', async reason => {
            const hook = await setup();
            const draft = draftFor();
            if (reason === 'missing') mocks.inspectInvokeConnection.mockRejectedValueOnce(new Error('Source unavailable'));
            if (reason === 'stale-owner') draft.invokeOwnerSelection.ownerId = 'deleted-owner';
            if (reason === 'wrong-database') draft.invokeOwnerSelection.dbPath = 'D:/Other/databases/invokeai.db';
            await act(async () => expect(await hook.applyInvokeConnection(draft)).toMatchObject({ status: 'failed' }));
            expect(useSettingsStore.getState().settings.invokeAiPath).toBeUndefined();
            expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();
            expect(mocks.syncImages).not.toHaveBeenCalled();
        });

        it('restores a current target cursor and skips image catch-up for an unchanged cached owner', async () => {
            const hook = await setup(true);
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b'))).toMatchObject({ status: 'completed' }));
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(200);
            expect(mocks.syncImages).not.toHaveBeenCalled();
        });

        it('catches up an old board-disabled target snapshot at its image cursor once, then skips current cached switches', async () => {
            const hook = await setup(true);
            const settings = useSettingsStore.getState().settings;
            const inactiveSnapshot = settings.invokeDbSnapshots?.find(candidate => candidate.scopeOwnerId === 'owner-a');
            act(() => useSettingsStore.getState().setSettings({ invokeDbSnapshots: settings.invokeDbSnapshots?.map(candidate => (
                candidate.scopeOwnerId === 'owner-b' ? { ...candidate, syncBoardsToCollections: false } : candidate
            )) }));
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), maxTimestamp: 200, boardsChanged: true });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b'))).toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledOnce();
            expect(mocks.syncImages).toHaveBeenLastCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'startup', afterTimestamp: 200, syncBoards: true }));
            expect(useSettingsStore.getState().settings.invokeDbSnapshots?.find(candidate => candidate.scopeOwnerId === 'owner-a')).toEqual(inactiveSnapshot);
            expect(useSettingsStore.getState().settings.invokeDbSnapshot).toMatchObject({ scopeOwnerId: 'owner-b', lastSyncedAt: 200, syncBoardsToCollections: true });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-a'))).toMatchObject({ status: 'completed' }));
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b'))).toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledOnce();
        });

        it('catches up boards on canonical off-to-on without scanning image history or changing inactive checkpoints', async () => {
            const hook = await setup(true);
            const inactiveSnapshot = useSettingsStore.getState().settings.invokeDbSnapshots?.find(candidate => candidate.scopeOwnerId === 'owner-b');
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), maxTimestamp: 110 });
            await act(async () => expect(await hook.applyInvokeConnection({ ...draftFor(), invokeSyncBoards: false })).toMatchObject({ status: 'completed' }));
            expect(useSettingsStore.getState().settings.invokeDbSnapshot).toMatchObject({ lastSyncedAt: 110, syncBoardsToCollections: false });
            mocks.syncImages.mockClear().mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), maxTimestamp: 120, boardsChanged: true });
            await act(async () => expect(await hook.applyInvokeConnection({ ...draftFor(), invokeSyncBoards: true })).toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledOnce();
            expect(mocks.syncImages).toHaveBeenLastCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ afterTimestamp: 110, syncBoards: true }));
            expect(useSettingsStore.getState().settings.invokeDbSnapshot).toMatchObject({ lastSyncedAt: 120, syncBoardsToCollections: true });
            expect(useSettingsStore.getState().settings.invokeDbSnapshots?.find(candidate => candidate.scopeOwnerId === 'owner-b')).toEqual(inactiveSnapshot);
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b'))).toMatchObject({ status: 'completed' }));
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-a'))).toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledOnce();
        });

        it('reuses the admitted current view when the source snapshot is unchanged', async () => {
            const hook = await setup(true);
            await act(async () => expect(await hook.applyInvokeConnection({ ...draftFor(), starredAs: 'pin' }))
                .toMatchObject({ status: 'completed', viewCommitted: true }));
            expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'manual', afterTimestamp: 100, starredAs: 'pin' }));
        });

        it('opens the verified gallery before importing finishes and retains the operation reservation', async () => {
            const hook = await setup(true);
            const pending = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
            mocks.syncImages.mockReturnValueOnce(pending.promise);
            const onAccepted = vi.fn();
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor('owner-b', 'D:/Other'), { onAccepted }); });
            await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledOnce());
            expect(onAccepted).toHaveBeenCalledOnce();
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({ status: 'ready', scope: { ownerId: 'owner-b' } });
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'syncing', viewCommitted: true });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor())).toMatchObject({ status: 'busy' }));
            await act(async () => { pending.resolve(createNoopInvokeSyncResult()); await application; });
        });

        it('keeps preparation reserved until a cancelled native operation settles, then restores the previous view', async () => {
            const hook = await setup(true);
            const pending = createDeferred<Awaited<ReturnType<typeof mocks.applyInvokeOwnerScope>>>();
            mocks.applyInvokeOwnerScope.mockReturnValueOnce(pending.promise);
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor('owner-b')); });
            await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce());
            act(() => hook.cancelSync());
            expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('cancelling');
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('applying');
            await act(async () => expect(await hook.applyInvokeConnection(draftFor())).toMatchObject({ status: 'busy' }));
            await act(async () => {
                pending.resolve({ changed: false, sourceFactsUpdated: 0, activeVisibilityUpdated: 0, removedVisibilityUpdated: 0, mode: 'owner' });
                expect(await application).toMatchObject({ status: 'aborted', viewCommitted: false });
            });
            expect(mocks.syncImages).not.toHaveBeenCalled();
            expect(useSettingsStore.getState().settings.invokeOwnerSelection).toMatchObject({ ownerId: 'owner-a' });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
        });

        it.each([
            { root: 'D:/Invoke', failure: 'cancelled' },
            { root: 'D:/Other', failure: 'cancelled' },
            { root: 'D:/Invoke', failure: 'failed' },
            { root: 'D:/Other', failure: 'failed' },
        ])('retries the submitted owner and options after $failure preparation rollback from $root', async ({ root, failure }) => {
            const hook = await setup(true);
            const pending = createDeferred<Awaited<ReturnType<typeof mocks.applyInvokeOwnerScope>>>();
            mocks.applyInvokeOwnerScope.mockReturnValueOnce(pending.promise);
            const submitted = { ...draftFor('owner-b', root), invokeSyncFavorites: false, invokeSyncBoards: false, starredAs: 'pin' as const };
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(submitted); });
            await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce());
            if (failure === 'cancelled') act(() => hook.cancelSync());
            await act(async () => {
                if (failure === 'cancelled') pending.resolve({ changed: false, sourceFactsUpdated: 0, activeVisibilityUpdated: 0, removedVisibilityUpdated: 0, mode: 'owner' });
                else pending.reject(new Error('Preparation failed'));
                expect(await application).toMatchObject({ status: failure === 'cancelled' ? 'aborted' : 'failed', viewCommitted: false });
            });
            expect(useSettingsStore.getState().settings).toMatchObject({
                invokeAiPath: 'D:/Invoke', invokeOwnerSelection: { ownerId: 'owner-a' }, lastSyncedAt: 100,
            });
            expect(mocks.syncImages).not.toHaveBeenCalled();

            act(() => useInvokeOwnerScopeStore.getState().operation?.retry?.());
            await waitFor(() => expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('completed'));
            expect(useSettingsStore.getState().settings).toMatchObject(submitted);
            expect(mocks.applyInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
                selection: submitted.invokeOwnerSelection, discovery: expect.objectContaining({ imagesRoot: root }),
            }));
            expect(mocks.syncImages).toHaveBeenCalledOnce();
            expect(mocks.syncImages).toHaveBeenLastCalledWith(root, expect.any(Function), expect.any(AbortSignal), expect.objectContaining({
                scope: expect.objectContaining({ ownerId: 'owner-b' }),
                syncFavorites: false, syncBoards: false, starredAs: 'pin', afterTimestamp: root === 'D:/Invoke' ? 200 : null,
            }));
        });

        it('establishes preparation before notifying Settings to close', async () => {
            const hook = await setup(true);
            const onAccepted = vi.fn(() => {
                expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({ status: 'applying', scope: { ownerId: 'owner-b' } });
                expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'preparing', viewCommitted: false });
            });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b'), { onAccepted }))
                .toMatchObject({ status: 'completed', viewCommitted: true }));
            expect(onAccepted).toHaveBeenCalledOnce();
        });

        it('catches up a stale target using its own cursor', async () => {
            const hook = await setup(true);
            mocks.getInvokeDbSnapshot.mockResolvedValue({ status: 'ok', data: {
                dbPath: source().dbPath,
                files: [{ path: source().dbPath, exists: true, size: 2000, modifiedMs: 300 }],
            } });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b')))
                .toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'startup', afterTimestamp: 200,
                    scope: expect.objectContaining({ ownerId: 'owner-b' }) }));
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({
                status: 'ready', scope: { mode: 'owner', ownerId: 'owner-b' },
            });
        });

        it('imports a legacy source only through the explicit application action', async () => {
            const hook = await setup();
            mocks.discoverInvokeOwners.mockResolvedValue({ ...source(), schemaMode: 'legacy', owners: [] });
            const draft = { ...draftFor(), invokeOwnerSelection: undefined };
            expect(mocks.syncImages).not.toHaveBeenCalled();
            await act(async () => expect(await hook.applyInvokeConnection(draft)).toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'manual', scope: expect.objectContaining({ mode: 'legacy' }), afterTimestamp: null }));
            expect(useSettingsStore.getState().settings.invokeOwnerSelection).toBeUndefined();
        });

        it('applies changed options even when the target owner has a current snapshot', async () => {
            const hook = await setup(true);
            await act(async () => expect(await hook.applyInvokeConnection({ ...draftFor('owner-b'), invokeSyncFavorites: false }))
                .toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'startup', afterTimestamp: 200, syncFavorites: false }));
        });

        it('uses manual semantics for Sync now and preserves unrelated settings', async () => {
            const hook = await setup(true);
            const pending = createDeferred<InvokeOwnerDiscovery>();
            mocks.inspectInvokeConnection.mockReturnValueOnce(pending.promise);
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection({ ...draftFor(), starredAs: 'both' }); });
            act(() => useSettingsStore.getState().setSettings({ thumbnailSize: 240 }));
            await act(async () => { pending.resolve(source()); await application; });
            expect(useSettingsStore.getState().settings.thumbnailSize).toBe(240);
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'manual', afterTimestamp: 100, starredAs: 'both' }));
        });

        it('replays historical intermediates for the edited view and other cached owners on their next visit', async () => {
            const hook = await setup(true);
            await act(async () => expect(await hook.applyInvokeConnection({ ...draftFor(), importIntermediates: true }))
                .toMatchObject({ status: 'completed' }));
            // The old cursor is 100: an intermediate created before it must now be a candidate.
            expect(mocks.syncImages).toHaveBeenLastCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ afterTimestamp: 0, importIntermediates: true,
                    scope: expect.objectContaining({ ownerId: 'owner-a' }) }));
            expect(useSettingsStore.getState().settings.invokeDbSnapshots).toEqual(expect.arrayContaining([
                expect.objectContaining({ scopeOwnerId: 'owner-b', lastSyncedAt: 200, importIntermediates: false }),
            ]));
            mocks.syncImages.mockClear();
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b')))
                .toMatchObject({ status: 'completed' }));
            expect(mocks.syncImages).toHaveBeenCalledTimes(1);
            expect(mocks.syncImages).toHaveBeenLastCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'startup', afterTimestamp: 0, importIntermediates: true,
                    scope: expect.objectContaining({ ownerId: 'owner-b' }) }));
        });

        it.each(['failed', 'aborted'] as const)('restores native visibility before readmitting an offline view after %s preparation', async status => {
            const offlineScope = { dbPath: source().dbPath, imagesRoot: 'D:/Invoke', mode: 'owner' as const, ownerId: 'owner-a' };
            mocks.readTrustedInvokeOwnerScope.mockResolvedValue(offlineScope);
            mocks.discoverInvokeOwners.mockImplementation(async (root: string) => {
                if (root === 'D:/Invoke') throw new Error('Source offline');
                return source(root);
            });
            const hook = await setup(true, 'offline_ready');
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.discovery).toBeUndefined();
            mocks.applyInvokeOwnerScope.mockRejectedValueOnce(new Error(status === 'aborted' ? 'Aborted' : 'Preparation failed'));
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b', 'D:/Other')))
                .toMatchObject({ status }));
            expect(mocks.refreshInvokeOwnerVisibility).toHaveBeenLastCalledWith(
                expect.objectContaining({ dbPath: source().dbPath, imagesRoot: 'D:/Invoke', schemaMode: 'multi_user' }),
                expect.objectContaining({ ownerId: 'owner-a' }), true);
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({ status: 'offline_ready', scope: offlineScope });
        });

        it.each(['failed', 'aborted'] as const)('keeps the selected source, options, and prior checkpoint after a %s import', async status => {
            const hook = await setup(true);
            mocks.syncImages.mockRejectedValueOnce(new Error(status === 'aborted' ? 'Aborted' : 'Import failed'));
            await act(async () => expect(await hook.applyInvokeConnection({ ...draftFor('owner-b', 'D:/Other'), starredAs: 'pin' }))
                .toMatchObject({ status, viewCommitted: true }));
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Other', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ afterTimestamp: null }));
            expect(useSettingsStore.getState().settings).toMatchObject({ invokeAiPath: 'D:/Other', lastSyncedAt: null,
                invokeOwnerSelection: { ownerId: 'owner-b' }, starredAs: 'pin' });
            expect(useSettingsStore.getState().settings.invokeDbSnapshots).toContainEqual(expect.objectContaining(snapshot('owner-a', 100)));
            expect(mocks.refreshInvokeOwnerVisibility).not.toHaveBeenCalled();
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                phase: status === 'aborted' ? 'cancelled' : 'failed', viewCommitted: true, retry: expect.any(Function),
            });
        });

        it('keeps failed first preparation configured but gated for retry', async () => {
            const hook = await setup();
            mocks.applyInvokeOwnerScope.mockRejectedValueOnce(new Error('Preparation failed'));
            await act(async () => expect(await hook.applyInvokeConnection(draftFor())).toMatchObject({ status: 'failed' }));
            expect(useSettingsStore.getState().settings.invokeAiPath).toBe('D:/Invoke');
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('error');
            await act(async () => expect(await hook.startInvokeSync({ mode: 'live' })).toMatchObject({ status: 'blocked' }));
            expect(mocks.syncImages).not.toHaveBeenCalled();
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('error');
        });

        it('rolls back a failed settings write without beginning the image import', async () => {
            const hook = await setup(true);
            vi.spyOn(useSettingsStore.getState(), 'flushSettings').mockRejectedValueOnce(new Error('Disk full'));
            await act(async () => expect(await hook.applyInvokeConnection(draftFor('owner-b'))).toMatchObject({ status: 'failed' }));
            expect(useSettingsStore.getState().settings.invokeOwnerSelection).toMatchObject({ ownerId: 'owner-a' });
            expect(mocks.syncImages).not.toHaveBeenCalled();
        });

        it('keeps imported content after cancellation, waits for writes, and drops queued automatic reruns', async () => {
            const hook = await setup(true);
            const pending = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
            mocks.syncImages.mockReturnValueOnce(pending.promise);
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor('owner-b', 'D:/Other')); });
            await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledOnce());
            await act(async () => expect(await hook.startInvokeSync({ mode: 'live' })).toMatchObject({ status: 'queued' }));
            act(() => hook.cancelSync());
            expect(useLibraryStore.getState().syncStatus).toBe('syncing');
            expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('cancelling');
            await act(async () => expect(await hook.applyInvokeConnection(draftFor())).toMatchObject({ status: 'busy' }));
            await act(async () => {
                pending.reject(new Error('Aborted'));
                expect(await application).toMatchObject({ status: 'aborted', viewCommitted: true });
            });
            expect(mocks.syncImages).toHaveBeenCalledOnce();
            expect(useSettingsStore.getState().settings.invokeOwnerSelection).toMatchObject({ ownerId: 'owner-b' });
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBeNull();
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            await act(async () => useInvokeOwnerScopeStore.getState().operation?.retry?.());
            await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(2));
            await waitFor(() => expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('completed'));
            expect(mocks.syncImages).toHaveBeenLastCalledWith('D:/Other', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ scope: expect.objectContaining({ ownerId: 'owner-b' }), mode: 'manual', afterTimestamp: null }));
        });

        it('reserves the operation before discovery, coalesces startup and drains Live Watch only afterward', async () => {
            const hook = await setup(true);
            const pending = createDeferred<InvokeOwnerDiscovery>();
            mocks.inspectInvokeConnection.mockReturnValueOnce(pending.promise);
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor('owner-b')); });
            await act(async () => {
                expect(await hook.applyInvokeConnection(draftFor('owner-a'))).toMatchObject({ status: 'busy' });
                expect(await hook.startInvokeSync({ mode: 'startup' })).toMatchObject({ status: 'queued' });
                expect(await hook.startInvokeSync({ mode: 'live' })).toMatchObject({ status: 'queued' });
            });
            expect(useSettingsStore.getState().settings.invokeOwnerSelection).toMatchObject({ ownerId: 'owner-a' });
            expect(mocks.applyInvokeOwnerScope).not.toHaveBeenCalled();
            await act(async () => { pending.resolve(source()); expect(await application).toMatchObject({ status: 'completed' }); });
            await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledTimes(1));
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ mode: 'live', scope: expect.objectContaining({ ownerId: 'owner-b' }) }));
        });

        it.each([false, true])('keeps a newer Live Watch cursor when current-owner preparation is needed: %s', async sourceChanged => {
            const hook = await setup(true);
            act(() => useSettingsStore.getState().setSettings({ lastSyncedAt: 300 }));
            if (sourceChanged) mocks.getInvokeDbSnapshot.mockResolvedValue({ status: 'ok', data: {
                dbPath: source().dbPath, files: [{ path: source().dbPath, exists: true, size: 2000, modifiedMs: 300 }],
            } });
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), maxTimestamp: 300 });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor())).toMatchObject({ status: 'completed' }));
            expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledTimes(sourceChanged ? 1 : 0);
            expect(mocks.syncImages).toHaveBeenCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ afterTimestamp: 300, scope: expect.objectContaining({ ownerId: 'owner-a' }) }));
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(300);
        });

        it('prepares the view when canonical board synchronization is disabled', async () => {
            const options = { invokeSyncBoards: false };
            const hook = await setup(true);
            await act(async () => expect(await hook.applyInvokeConnection({ ...draftFor(), ...options }))
                .toMatchObject({ status: 'completed' }));
            expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce();
            expect(useSettingsStore.getState().settings).toMatchObject(options);
        });

        it.each(['validation', 'preparation'] as const)('keeps cancelled first preparation gated and reports a later %s retry failure', async failureStage => {
            const hook = await setup();
            const pending = createDeferred<Awaited<ReturnType<typeof mocks.applyInvokeOwnerScope>>>();
            mocks.applyInvokeOwnerScope.mockReturnValueOnce(pending.promise);
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor()); });
            await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce());
            act(() => hook.cancelSync());
            await act(async () => {
                pending.resolve({ changed: true, sourceFactsUpdated: 4, activeVisibilityUpdated: 4, removedVisibilityUpdated: 0, mode: 'owner' });
                expect(await application).toMatchObject({ status: 'aborted', viewCommitted: false });
            });
            expect(mocks.syncImages).not.toHaveBeenCalled();
            expect(useSettingsStore.getState().settings.invokeOwnerSelection).toMatchObject({ ownerId: 'owner-a' });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({
                status: 'error', failure: { kind: 'preparation_cancelled' },
            });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.error).toBeUndefined();
            if (failureStage === 'validation') mocks.discoverInvokeOwners.mockRejectedValueOnce(new Error('Source read failed'));
            else mocks.applyInvokeOwnerScope.mockRejectedValueOnce(new Error('Source read failed'));
            await act(async () => expect(await hook.retryInvokeOwnerScope()).toBe(false));
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({
                status: 'error', error: 'Source read failed', failure: { kind: 'preparation_failed' },
            });
            await act(async () => expect(await hook.retryInvokeOwnerScope()).toBe(true));
            expect(mocks.syncImages).toHaveBeenCalledOnce();
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
        });

        it('shows cancellation when retrying an earlier failed first preparation', async () => {
            const hook = await setup();
            mocks.applyInvokeOwnerScope.mockRejectedValueOnce(new Error('Preparation failed'));
            await act(async () => expect(await hook.applyInvokeConnection(draftFor())).toMatchObject({ status: 'failed' }));
            const pending = createDeferred<Awaited<ReturnType<typeof mocks.applyInvokeOwnerScope>>>();
            mocks.applyInvokeOwnerScope.mockClear().mockReturnValueOnce(pending.promise);
            let retry!: ReturnType<SyncHook['retryInvokeOwnerScope']>;
            act(() => { retry = hook.retryInvokeOwnerScope(); });
            await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce());
            act(() => hook.cancelSync());
            await act(async () => {
                pending.resolve({ changed: false, sourceFactsUpdated: 0, activeVisibilityUpdated: 0, removedVisibilityUpdated: 0, mode: 'owner' });
                expect(await retry).toBe(false);
            });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({
                status: 'error', failure: { kind: 'preparation_cancelled' },
            });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.error).toBeUndefined();
            expect(mocks.syncImages).not.toHaveBeenCalled();
        });

        it('reports a native preparation failure even if cancellation was requested before it settled', async () => {
            const hook = await setup();
            const pending = createDeferred<Awaited<ReturnType<typeof mocks.applyInvokeOwnerScope>>>();
            mocks.applyInvokeOwnerScope.mockReturnValueOnce(pending.promise);
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor()); });
            await waitFor(() => expect(mocks.applyInvokeOwnerScope).toHaveBeenCalledOnce());
            act(() => hook.cancelSync());
            await act(async () => {
                pending.reject(new Error('Source enumeration failed'));
                expect(await application).toMatchObject({ viewCommitted: false });
            });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState).toMatchObject({
                status: 'error', error: 'Source enumeration failed', failure: { kind: 'preparation_failed' },
            });
            expect(mocks.syncImages).not.toHaveBeenCalled();
        });

        it('refreshes completed image batches at most once per second while keeping the admitted gallery ready', async () => {
            const hook = await setup(true);
            const pending = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
            let onBatch: NonNullable<InvokeSyncOptions['onBatchCommitted']> | undefined;
            mocks.syncImages.mockImplementationOnce((_root, _progress, _signal, options: InvokeSyncOptions) => {
                onBatch = options.onBatchCommitted;
                return pending.promise;
            });
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor()); });
            await waitFor(() => expect(onBatch).toBeTypeOf('function'));
            const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
            let now = 1000;
            const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
            const batch = { processed: 500, imported: 2, updated: 3, touchedFacetTypes: [],
                touchedFacetResources: createNoopInvokeSyncResult().touchedFacetResources };
            try {
                await act(async () => onBatch!(batch));
                now = 1999;
                await act(async () => onBatch!({ ...batch, processed: 1000, imported: 4 }));
                expect(invalidate.mock.calls.filter(([filter]) => filter?.queryKey?.[0] === 'images')).toHaveLength(1);
                now = 2000;
                await act(async () => onBatch!({ ...batch, processed: 1500, imported: 6 }));
                expect(invalidate.mock.calls.filter(([filter]) => filter?.queryKey?.[0] === 'images')).toHaveLength(2);
                now = 3000;
                await act(async () => onBatch!({ ...batch, processed: 2000, imported: 6 }));
                expect(invalidate.mock.calls.filter(([filter]) => filter?.queryKey?.[0] === 'images')).toHaveLength(2);
                now = 4000;
                await act(async () => onBatch!({ ...batch, processed: 2500, imported: 8 }));
                expect(invalidate.mock.calls.filter(([filter]) => filter?.queryKey?.[0] === 'images')).toHaveLength(3);
                expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
                expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'syncing', imported: 8, updated: 3 });
            } finally {
                clock.mockRestore();
                await act(async () => { pending.resolve(createNoopInvokeSyncResult()); await application; });
                invalidate.mockRestore();
            }
        });

        it('keeps rendered progress advancing beyond 85000 and settles only after finalization', async () => {
            const savedTrace = { ...invokeSyncTrace };
            const traceFiles = new Map<string, string>();
            const trace = createInvokeSyncTrace({ enabled: true,
                write: async (name, content) => { traceFiles.set(name, content); },
            });
            Object.assign(invokeSyncTrace, trace);
            const dockCommit = vi.spyOn(invokeSyncTrace, 'dockCommitted');
            const hook = await setup(true);
            render(<ActivityDock />);
            const pendingSync = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
            const pendingCache = createDeferred<number>();
            let reportProgress!: (current: number, total: number, message?: string) => void;
            let batchCommitted: InvokeSyncOptions['onBatchCommitted'];
            mocks.syncImages.mockImplementationOnce((_root, progress: typeof reportProgress, _signal, options: InvokeSyncOptions) => {
                reportProgress = progress;
                batchCommitted = options.onBatchCommitted;
                return pendingSync.promise;
            });
            mocks.rebuildFacetCache.mockReturnValueOnce(pendingCache.promise);
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor()); });
            const result = { ...createNoopInvokeSyncResult(), imported: 135244, maxTimestamp: 500 };
            try {
                await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledOnce());
                const operationId = useInvokeOwnerScopeStore.getState().operation?.id;
                // The processed count includes missing files; it must not stop when additions stop.
                for (const [current, imported] of [[85000, 63072], [85500, 63572], [138500, 135238], [138506, 135244]]) {
                    const message = `Processing images: ${current} / 138506`;
                    await act(async () => {
                        reportProgress(current, 138506, message);
                        batchCommitted?.({ processed: current, imported, updated: 0, touchedFacetTypes: [],
                            touchedFacetResources: result.touchedFacetResources });
                    });
                    expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                        id: operationId, phase: 'syncing', progress: { current, total: 138506 },
                    });
                    expect(screen.getByText(message)).toBeTruthy();
                    await waitFor(() => expect(dockCommit).toHaveBeenCalledWith(expect.objectContaining({
                        id: operationId, progress: expect.objectContaining({ current, total: 138506 }),
                    }), true));
                }
                await act(async () => { pendingSync.resolve(result); });
                await waitFor(() => expect(mocks.rebuildFacetCache).toHaveBeenCalled());
                expect(screen.getByText('Rebuilding filter cache...')).toBeTruthy();
                expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                    id: operationId, phase: 'syncing', imported: 135244,
                    progress: { current: 0, total: 0 },
                });
                expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
                expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(100);
                await act(async () => {
                    pendingCache.resolve(1);
                    expect(await application).toMatchObject({ status: 'completed', viewCommitted: true });
                });
                expect(screen.getByText('Synchronization complete.')).toBeTruthy();
                expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({
                    id: operationId, phase: 'completed', imported: 135244,
                });
                expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(500);
                await waitFor(() => expect(traceFiles.get('invoke-sync-trace-last-completed.json'))
                    .toContain('dock-committed'));
                const completed = JSON.parse(traceFiles.get('invoke-sync-trace-last-completed.json')!) as {
                    terminal: string; committedImages: number; imported: number;
                    events: Array<{ kind: string; phase?: string; current?: number; stage?: string; status?: string }>;
                };
                expect(completed).toMatchObject({ terminal: 'completed', committedImages: 138506, imported: 135244 });
                expect(completed.events).toEqual(expect.arrayContaining([
                    expect.objectContaining({ kind: 'coordinator-progress', current: 138506 }),
                    expect.objectContaining({ kind: 'dock-committed', current: 138506 }),
                    expect.objectContaining({ kind: 'stage', stage: 'facet-cache', status: 'started' }),
                    expect.objectContaining({ kind: 'stage', stage: 'facet-cache', status: 'completed' }),
                    expect.objectContaining({ kind: 'stage', stage: 'checkpoint', status: 'completed' }),
                ]));
            } finally {
                await act(async () => { pendingSync.resolve(result); pendingCache.resolve(1); await application; });
                trace.dispose();
                dockCommit.mockRestore();
                Object.assign(invokeSyncTrace, savedTrace);
            }
        });

        it('names filter rebuilding in the dock and keeps cancellation available until native work settles', async () => {
            const hook = await setup(true);
            render(<ActivityDock />);
            const pending = createDeferred<number>();
            mocks.rebuildFacetCache.mockReturnValueOnce(pending.promise);
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), imported: 2, maxTimestamp: 500 });
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor()); });
            try {
                await waitFor(() => expect(mocks.rebuildFacetCache).toHaveBeenCalled());
                expect(screen.getByText('Rebuilding filter cache...')).toBeTruthy();
                expect(useInvokeOwnerScopeStore.getState().operation?.progress?.total).toBe(0);
                expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
                fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
                expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('cancelling');
                expect(useLibraryStore.getState().syncStatus).toBe('syncing');
                await act(async () => {
                    pending.resolve(1);
                    expect(await application).toMatchObject({ status: 'aborted', viewCommitted: true });
                });
                expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(100);
                expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            } finally {
                await act(async () => { pending.resolve(1); await application; });
            }
        });

        it('keeps the prior checkpoint and retries the applied view after a row fails beyond a committed batch', async () => {
            const hook = await setup(true);
            mocks.syncImages.mockImplementationOnce(async (_root, _progress, _signal, options: InvokeSyncOptions) => {
                options.onBatchCommitted?.({ processed: 500, imported: 2, updated: 0, touchedFacetTypes: [],
                    touchedFacetResources: createNoopInvokeSyncResult().touchedFacetResources });
                throw new Error('Failed to process InvokeAI image image-500.png: metadata mapping failed');
            });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor()))
                .toMatchObject({ status: 'failed', viewCommitted: true }));
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(100);
            expect(useSettingsStore.getState().settings.invokeDbSnapshot?.lastSyncedAt).toBe(100);
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'failed', imported: 2,
                message: 'Failed to process InvokeAI image image-500.png: metadata mapping failed', retry: expect.any(Function) });

            act(() => useInvokeOwnerScopeStore.getState().operation?.retry?.());
            await waitFor(() => expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('completed'));
            expect(mocks.syncImages).toHaveBeenLastCalledWith('D:/Invoke', expect.any(Function), expect.any(AbortSignal),
                expect.objectContaining({ afterTimestamp: 100, scope: expect.objectContaining({ ownerId: 'owner-a' }) }));
        });

        it('waits for cancelled native image writes, refreshes their partial results, and leaves the cursor retryable', async () => {
            const hook = await setup(true);
            const pending = createDeferred<ReturnType<typeof createNoopInvokeSyncResult>>();
            let onBatch: NonNullable<InvokeSyncOptions['onBatchCommitted']> | undefined;
            mocks.syncImages.mockImplementationOnce((_root, _progress, _signal, options: InvokeSyncOptions) => {
                onBatch = options.onBatchCommitted;
                return pending.promise;
            });
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor()); });
            await waitFor(() => expect(mocks.syncImages).toHaveBeenCalledOnce());
            const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
            act(() => hook.cancelSync());
            expect(useLibraryStore.getState().syncStatus).toBe('syncing');
            expect(useLibraryStore.getState().syncAbortController).not.toBeNull();
            await act(async () => {
                onBatch!({ processed: 500, imported: 2, updated: 0, touchedFacetTypes: [],
                    touchedFacetResources: createNoopInvokeSyncResult().touchedFacetResources });
                pending.resolve({ ...createNoopInvokeSyncResult(), imported: 2, maxTimestamp: 500 });
                expect(await application).toMatchObject({ status: 'aborted', viewCommitted: true });
            });
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ['images'] });
            invalidate.mockRestore();
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(100);
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'cancelled', imported: 2 });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            expect(useLibraryStore.getState().syncAbortController).toBeNull();
        });

        it('shows cancellable orphan progress and counts until orphan native work settles', async () => {
            const hook = await setup();
            const pending = createDeferred<number>();
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), imported: 5 });
            mocks.scanForOrphans.mockImplementationOnce((_root, _ids,
                progress: (phase: string, current: number, total: number) => void) => {
                progress('Importing untracked files...', 2, 10);
                return pending.promise;
            });
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection({ ...draftFor(), importOrphans: true,
                invokeOwnerSelection: { dbPath: source().dbPath, mode: 'all' } }); });
            await waitFor(() => expect(mocks.scanForOrphans).toHaveBeenCalledOnce());
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'syncing', viewCommitted: true,
                imported: 7, progress: { current: 2, total: 10, message: 'Importing untracked files...' }, cancel: expect.any(Function) });
            act(() => useInvokeOwnerScopeStore.getState().operation?.cancel?.());
            const options = mocks.scanForOrphans.mock.calls[0][3] as { signal: AbortSignal };
            expect(options.signal.aborted).toBe(true);
            expect(useInvokeOwnerScopeStore.getState().operation?.phase).toBe('cancelling');
            expect(useLibraryStore.getState().syncStatus).toBe('syncing');
            await act(async () => { pending.resolve(2); expect(await application).toMatchObject({ status: 'aborted', viewCommitted: true }); });
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBeNull();
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'cancelled', imported: 7 });
        });

        it.each(['cancel', 'owner-drift'] as const)('does not persist a late checkpoint after %s during its native settings write', async interrupt => {
            const hook = await setup(true);
            const pending = createDeferred<void>();
            const flush = vi.spyOn(useSettingsStore.getState(), 'flushSettings').mockImplementation(async candidate => {
                if (candidate?.lastSyncedAt === 500) await pending.promise;
            });
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), maxTimestamp: 500 });
            let application!: ReturnType<SyncHook['applyInvokeConnection']>;
            act(() => { application = hook.applyInvokeConnection(draftFor()); });
            await waitFor(() => expect(flush).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedAt: 500 })));
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(100);
            await act(async () => {
                if (interrupt === 'cancel') hook.cancelSync();
                else useSettingsStore.getState().setSettings({
                    invokeOwnerSelection: { dbPath: source().dbPath, mode: 'owner', ownerId: 'owner-b' }, lastSyncedAt: 200,
                });
                // Finish the native write in this same event, before relying on a React render.
                pending.resolve();
                expect(await application).toMatchObject({ status: interrupt === 'cancel' ? 'aborted' : 'failed', viewCommitted: true });
            });
            const expectedCursor = interrupt === 'cancel' ? 100 : 200;
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(expectedCursor);
            expect(flush).toHaveBeenLastCalledWith(expect.objectContaining({ lastSyncedAt: expectedCursor }));
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe(interrupt === 'cancel' ? 'ready' : 'error');
            if (interrupt === 'owner-drift') expect(useSettingsStore.getState().settings.invokeOwnerSelection).toMatchObject({ ownerId: 'owner-b' });
            flush.mockRestore();
        });

        it('retains the committed view and prior checkpoint when final snapshot persistence fails', async () => {
            const hook = await setup(true);
            const flush = vi.spyOn(useSettingsStore.getState(), 'flushSettings').mockImplementation(async (candidate?: AppSettings) => {
                if (candidate?.lastSyncedAt === 500) throw new Error('Checkpoint disk write failed');
            });
            mocks.syncImages.mockResolvedValueOnce({ ...createNoopInvokeSyncResult(), imported: 2, maxTimestamp: 500 });
            await act(async () => expect(await hook.applyInvokeConnection(draftFor()))
                .toMatchObject({ status: 'failed', viewCommitted: true }));
            expect(useSettingsStore.getState().settings.lastSyncedAt).toBe(100);
            expect(useSettingsStore.getState().settings.invokeDbSnapshot?.lastSyncedAt).toBe(100);
            expect(useInvokeOwnerScopeStore.getState().ownerScopeState.status).toBe('ready');
            expect(useInvokeOwnerScopeStore.getState().operation).toMatchObject({ phase: 'failed', retry: expect.any(Function), imported: 2 });
            flush.mockRestore();
        });
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
