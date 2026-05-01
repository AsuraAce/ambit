
import * as React from 'react';
import { render, act, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibraryProvider, useLibraryContext } from '../LibraryContext';
import { useSync } from '../SyncContext';
import { ToastProvider } from '../ToastContext';
import { useLibraryStore } from '../../stores/libraryStore';

// --- Extensive Mocks for Integration ---

const mocks = vi.hoisted(() => ({
    searchImages: vi.fn().mockResolvedValue([]),
    countImages: vi.fn().mockResolvedValue(0),
    getFacets: vi.fn().mockResolvedValue({ models: [], loras: [], tools: [] }),
    getLibraryStats: vi.fn().mockResolvedValue({ totalImages: 0 }),
    syncImages: vi.fn().mockResolvedValue({ imported: 5, updated: 0, maxTimestamp: 100, syncedIds: new Set(), boardMapping: new Map(), touchedFacetTypes: [], touchedFacetResources: { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] } }),
    rebuildFacetCache: vi.fn().mockResolvedValue(0),
    rebuildFacetCacheStrict: vi.fn().mockResolvedValue(0),
    rebuildFacetCacheIncrementalBatchStrict: vi.fn().mockResolvedValue(0),
    refreshFacetCacheForResourcesStrict: vi.fn().mockResolvedValue(0),
    watcherStartWatching: vi.fn().mockResolvedValue({}),
    watcherStopWatching: vi.fn().mockResolvedValue(undefined),
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
            dbPath: 'D:/AI/art/webUI/invokeai/databases/invokeai.db',
            files: []
        }
    }),
    getSmartCollectionCounts: vi.fn().mockResolvedValue({}),
    getMaintenanceCounts: vi.fn().mockResolvedValue({ untagged: 0, trash: 0, orphans: 0, intermediates: 0, missing: 0, duplicates: 0 }),
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
            settings: { theme: 'system', privacyEnabled: false, thumbnailSize: 200, confirmDelete: true, defaultTheaterMode: false, monitoredFolders: [], maskedKeywords: ['NSFW'], maskingMode: 'hide' as const, },
            collections: [],
            smartCollections: [],
            images: [],
            recentSearches: []
        }),
        save: vi.fn().mockResolvedValue({})
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
        getInvokeDbSnapshot: (...args: unknown[]) => mocks.getInvokeDbSnapshot(...args),
    }
}));

vi.mock('../../services/db/searchRepo', () => ({
    searchImages: (...args: any[]) => mocks.searchImages(...args),
    countImages: (...args: any[]) => mocks.countImages(...args),
    getFacets: (...args: any[]) => mocks.getFacets(...args),
    getLibraryStats: (...args: any[]) => mocks.getLibraryStats(...args),
}));

vi.mock('../../services/db/collectionRepo', () => ({
    getAllCollectionsWithStats: (...args: any[]) => mocks.getAllCollectionsWithStats(...args),
    upsertCollection: vi.fn().mockResolvedValue({}),
    addImagesToCollection: vi.fn().mockResolvedValue({}),
    ensureCollectionSchema: vi.fn().mockResolvedValue({}),
    getSmartCollectionCounts: (...args: unknown[]) => mocks.getSmartCollectionCounts(...args),
    deleteCollectionFromDb: vi.fn().mockResolvedValue({}),
    removeImagesFromCollection: vi.fn().mockResolvedValue({}),
    getCollectionImageIds: vi.fn().mockResolvedValue([])
}));

vi.mock('../../services/db/maintenanceRepo', () => ({
    getMaintenanceCounts: (...args: unknown[]) => mocks.getMaintenanceCounts(...args)
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCache: (...args: any[]) => mocks.rebuildFacetCache(...args),
    rebuildFacetCacheStrict: (...args: any[]) => mocks.rebuildFacetCacheStrict(...args),
    rebuildFacetCacheIncrementalBatchStrict: (...args: any[]) => mocks.rebuildFacetCacheIncrementalBatchStrict(...args),
    refreshFacetCacheForResourcesStrict: (...args: any[]) => mocks.refreshFacetCacheForResourcesStrict(...args),
    checkHiddenContentAvailability: vi.fn().mockResolvedValue(false)
}));

// 3. Service Mocks
vi.mock('../../services/WatcherService', () => ({
    watcherService: {
        startWatching: mocks.watcherStartWatching,
        stopWatching: mocks.watcherStopWatching
    }
}));

vi.mock('../../services/invoke/syncService', () => ({
    syncImages: (...args: any[]) => mocks.syncImages(...args)
}));

vi.mock('../../services/invoke/orphanScanner', () => ({
    scanForOrphans: vi.fn().mockResolvedValue(0)
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
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
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
        expect(hook.activeSqlWhere).toContain("privacy_hidden = 0");

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
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases'
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AI/art/webUI/invokeai/databases');
        });

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

        await act(async () => {
            await hook.startInvokeSync({ mode: 'live' });
        });

        expect(mocks.syncImages).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Function),
            expect.any(AbortSignal),
            expect.objectContaining({ mode: 'live' })
        );
        expect(mocks.searchImages).not.toHaveBeenCalled();
        expect(mocks.getFacets).not.toHaveBeenCalled();
    });

    it('does not refresh image queries after a no-op startup Invoke catch-up', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases',
                lastSyncedAt: 100
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AI/art/webUI/invokeai/databases');
        });

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
    });

    it('uses startup resource-incremental facet refresh for a small known Invoke catch-up', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases',
                lastSyncedAt: 100,
                importOrphans: false
            });
        });

        await waitFor(() => {
            expect(hook?.settings.importOrphans).toBe(false);
        });

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
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('keeps startup Invoke catch-up on the full rebuild path for large deltas', async () => {
        let hook: ReturnType<typeof useLibraryContext> | undefined;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook?.isLoaded).toBe(true));

        await act(async () => {
            hook?.setSettings({
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases',
                lastSyncedAt: 100,
                importOrphans: false
            });
        });

        await waitFor(() => {
            expect(hook?.settings.importOrphans).toBe(false);
        });

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
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('refreshes grid and facets after a live Invoke cycle without falling back to the full rebuild', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases'
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AI/art/webUI/invokeai/databases');
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
        mocks.getLibraryStats.mockClear();
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
            expect(mocks.getLibraryStats).toHaveBeenCalled();
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
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases'
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });

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

        expect(useLibraryStore.getState().liveWatchSession.active).toBe(false);
        expect(useLibraryStore.getState().liveWatchSessionCloseRequested).toBe(false);
    });

    it('drains scheduled Invoke activity after toggling off during detected activity', async () => {
        let hook: any;
        let watcherCallback: ((paths?: string[]) => void) | null = null;
        mocks.watcherStartWatching.mockImplementationOnce(async (_paths: string[], onChange: (paths?: string[]) => void) => {
            watcherCallback = onChange;
        });
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

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
            hook.setSettings({
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases'
            });
            useLibraryStore.getState().setIsLiveWatching(true);
        });

        await waitFor(() => expect(watcherCallback).not.toBeNull());

        await act(async () => {
            watcherCallback?.(['D:/AI/art/webUI/invokeai/databases/invokeai.db-wal']);
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

    it('skips startup Invoke SQLite sync when the saved DB snapshot is unchanged', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        const files = [
            {
                path: 'D:/AI/art/webUI/invokeai/databases/invokeai.db',
                exists: true,
                size: 10,
                modifiedMs: 100
            },
            {
                path: 'D:/AI/art/webUI/invokeai/databases/invokeai.db-wal',
                exists: false,
                size: 0,
                modifiedMs: null
            },
            {
                path: 'D:/AI/art/webUI/invokeai/databases/invokeai.db-shm',
                exists: false,
                size: 0,
                modifiedMs: null
            }
        ];
        mocks.getInvokeDbSnapshot.mockResolvedValueOnce({
            status: 'ok',
            data: {
                dbPath: 'D:/AI/art/webUI/invokeai/databases/invokeai.db',
                files
            }
        });

        await act(async () => {
            hook.setSettings({
                invokeAiPath: 'D:/AI/art/webUI/invokeai/databases',
                lastSyncedAt: 100,
                importIntermediates: false,
                importOrphans: false,
                syncBoardsToCollections: false,
                invokeDbSnapshot: {
                    dbPath: 'D:/AI/art/webUI/invokeai/databases/invokeai.db',
                    lastSyncedAt: 100,
                    importIntermediates: false,
                    importOrphans: false,
                    syncBoardsToCollections: false,
                    files
                }
            });
        });

        await waitFor(() => {
            expect(hook.settings.invokeAiPath).toBe('D:/AI/art/webUI/invokeai/databases');
        });

        mocks.syncImages.mockClear();

        await act(async () => {
            await hook.startInvokeSync({ mode: 'startup' });
        });

        expect(mocks.getInvokeDbSnapshot).toHaveBeenCalled();
        expect(mocks.syncImages).not.toHaveBeenCalled();
    });
});
