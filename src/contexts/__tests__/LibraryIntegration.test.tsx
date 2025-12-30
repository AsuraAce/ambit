
import * as React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibraryProvider, useLibraryContext } from '../LibraryContext';
import { ToastProvider } from '../ToastContext';

// --- Extensive Mocks for Integration ---

const mocks = vi.hoisted(() => ({
    searchImages: vi.fn().mockResolvedValue([]),
    countImages: vi.fn().mockResolvedValue(0),
    getFacets: vi.fn().mockResolvedValue({ models: [], loras: [], tools: [] }),
    getLibraryStats: vi.fn().mockResolvedValue({ totalImages: 0 }),
    getAllCollectionsWithStats: vi.fn().mockResolvedValue([
        { id: 'smart1', name: 'Smart Col', filters: { searchQuery: 'ai' }, source: 'ambit' }
    ]),
    appRepository: {
        load: vi.fn().mockResolvedValue({
            settings: {
                theme: 'dark' as const,
                thumbnailSize: 200,
                confirmDelete: true,
                defaultTheaterMode: false,
                monitoredFolders: [],
                maskedKeywords: ['NSFW'],
                maskingMode: 'hide' as const,
            },
            recentSearches: []
        }),
        save: vi.fn().mockResolvedValue({})
    }
}));

vi.mock('../../services/repository', () => ({
    appRepository: mocks.appRepository
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
}));

vi.mock('../../services/db/maintenanceRepo', () => ({
    getMaintenanceCounts: vi.fn().mockResolvedValue({ untagged: 0, trash: 0 })
}));

// 3. Service Mocks
vi.mock('../../services/WatcherService', () => ({
    watcherService: {
        startWatching: vi.fn().mockResolvedValue({}),
        stopWatching: vi.fn()
    }
}));

vi.mock('../../services/invoke/syncService', () => ({
    syncImages: vi.fn().mockResolvedValue({ imported: 5, updated: 0, maxTimestamp: 100, syncedIds: [] })
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
        expect(hook.activeSqlWhere).toContain("metadata_json NOT LIKE ?");

        // Disable Privacy
        await act(async () => {
            hook.setPrivacyEnabled(false);
        });

        await waitFor(() => {
            expect(hook.privacyEnabled).toBe(false);
            expect(hook.activeSqlWhere).not.toContain("metadata_json NOT LIKE ?");
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

    it('should refresh data when Sync completes', async () => {
        let hook: any;
        renderStack(h => hook = h);

        await waitFor(() => expect(hook.isLoaded).toBe(true));

        // Trigger Sync
        await act(async () => {
            await hook.startInvokeSync();
        });

        // SyncProviderWrapper in LibraryContext.tsx listens for onSyncComplete
        // and calls fetchData(false) and refreshMetadata()
        // SyncProviderWrapper in LibraryContext.tsx listens for onSyncComplete
        // and calls fetchData(false) and refreshMetadata()
        await waitFor(() => {
            expect(hook.syncStatus).toBe('complete');
            // Check that search was refreshed as a ripple effect
            expect(mocks.searchImages).toHaveBeenCalled();
            expect(mocks.getFacets).toHaveBeenCalled();
        }, { timeout: 5000 });
    });
});
