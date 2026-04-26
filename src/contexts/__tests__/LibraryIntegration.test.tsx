
import * as React from 'react';
import { render, act, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibraryProvider, useLibraryContext } from '../LibraryContext';
import { ToastProvider } from '../ToastContext';

// --- Extensive Mocks for Integration ---

const mocks = vi.hoisted(() => ({
    searchImages: vi.fn().mockResolvedValue([]),
    countImages: vi.fn().mockResolvedValue(0),
    getFacets: vi.fn().mockResolvedValue({ models: [], loras: [], tools: [] }),
    getLibraryStats: vi.fn().mockResolvedValue({ totalImages: 0 }),
    syncImages: vi.fn().mockResolvedValue({ imported: 5, updated: 0, maxTimestamp: 100, syncedIds: new Set(), boardMapping: new Map() }),
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
    getSmartCollectionCounts: vi.fn().mockResolvedValue({}),
    deleteCollectionFromDb: vi.fn().mockResolvedValue({}),
    removeImagesFromCollection: vi.fn().mockResolvedValue({}),
    getCollectionImageIds: vi.fn().mockResolvedValue([])
}));

vi.mock('../../services/db/maintenanceRepo', () => ({
    getMaintenanceCounts: vi.fn().mockResolvedValue({ untagged: 0, trash: 0 })
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCache: vi.fn().mockResolvedValue({}),
    checkHiddenContentAvailability: vi.fn().mockResolvedValue(false)
}));

// 3. Service Mocks
vi.mock('../../services/WatcherService', () => ({
    watcherService: {
        startWatching: vi.fn().mockResolvedValue({}),
        stopWatching: vi.fn()
    }
}));

vi.mock('../../services/invoke/syncService', () => ({
    syncImages: (...args: any[]) => mocks.syncImages(...args)
}));

vi.mock('../../services/invoke/orphanScanner', () => ({
    scanForOrphans: vi.fn().mockResolvedValue(0)
}));


// --- Test Consumer ---
const TestConsumer = ({ onHook }: { onHook: (hook: any) => void }) => {
    const hook = useLibraryContext();
    React.useEffect(() => {
        onHook(hook);
    }, [hook]);
    return <div data-testid="ready">{hook.isLoaded ? 'LOADED' : 'PENDING'}</div>;
};

describe('Library Integration (Provider Stack)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
            boardMapping: new Map()
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
            boardMapping: new Map()
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
});
