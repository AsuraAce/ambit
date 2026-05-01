
import { renderHook, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFolderMonitor } from '../useFolderMonitor';
import type { MonitoredFolder } from '../../types';

const mocks = vi.hoisted(() => ({
    scanDirectorySince: vi.fn(),
    refreshStartupFacetCache: vi.fn()
}));

vi.mock('../../bindings', () => ({
    commands: {
        scanDirectorySince: mocks.scanDirectorySince
    }
}));

vi.mock('../../utils/startupFacetRefresh', () => ({
    refreshStartupFacetCache: mocks.refreshStartupFacetCache
}));

vi.mock('../../contexts/WatcherContext', () => ({
    useWatchers: () => ({
        watchedFolders: [],
        scanFolder: vi.fn(),
        isScanning: false,
        lastWatcherEvent: 0
    })
}));

describe('useFolderMonitor', () => {
    const mockOnScan = vi.fn();
    const mockAddToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.scanDirectorySince.mockResolvedValue({ status: 'ok', data: [] });
        mocks.refreshStartupFacetCache.mockResolvedValue({
            strategy: 'resource-incremental',
            reason: 'small-known-delta',
            entryCount: 1,
            touchedFacetTypes: ['loras'],
            touchedResourceCount: 1
        });
    });

    it('should NOT scan if not loaded', () => {
        const folders: MonitoredFolder[] = [{ id: '1', path: '/test', isActive: true, imageCount: 0 }];
        renderHook(() => useFolderMonitor({
            isLoaded: false,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn()
        }));

        expect(mockOnScan).not.toHaveBeenCalled();
    });

    it('should scan new active folders', () => {
        const initialFolders: MonitoredFolder[] = [{ id: '1', path: '/test1', isActive: true, imageCount: 0 }];
        const { rerender } = renderHook(({ folders }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn()
        }), {
            initialProps: { folders: initialFolders }
        });

        // Add new folder
        const updatedFolders = [
            ...initialFolders,
            { id: '2', path: '/test2', isActive: true, imageCount: 0 }
        ];

        rerender({ folders: updatedFolders });

        expect(mockOnScan).toHaveBeenCalledWith([{ path: '/test2', variant: undefined }], false);
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('/test2'), 'info');
    });

    it('should not auto-scan newly added folders that already have a scan timestamp', () => {
        const initialFolders: MonitoredFolder[] = [{ id: '1', path: '/test1', isActive: true, imageCount: 0 }];
        const { rerender } = renderHook(({ folders }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn()
        }), {
            initialProps: { folders: initialFolders }
        });

        vi.clearAllMocks();

        rerender({
            folders: [
                ...initialFolders,
                { id: '2', path: '/test2', isActive: true, imageCount: 0, lastScanned: Date.now() }
            ]
        });

        expect(mockOnScan).not.toHaveBeenCalled();
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('should not auto-scan newly added folders whose first scan is already queued', () => {
        const initialFolders: MonitoredFolder[] = [{ id: '1', path: '/test1', isActive: true, imageCount: 0 }];
        const { rerender } = renderHook(({ folders }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn()
        }), {
            initialProps: { folders: initialFolders }
        });

        vi.clearAllMocks();

        rerender({
            folders: [
                ...initialFolders,
                { id: '2', path: '/test2', isActive: true, imageCount: 0, initialScanPending: true }
            ]
        });

        expect(mockOnScan).not.toHaveBeenCalled();
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('should detect startup scan (prevFolders empty)', () => {
        const { rerender } = renderHook(({ folders, isLoaded }) => useFolderMonitor({
            isLoaded,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn()
        }), {
            initialProps: { folders: [] as MonitoredFolder[], isLoaded: false }
        });

        // Set loaded and add folder
        rerender({ folders: [{ id: '1', path: '/test', isActive: true, imageCount: 0 }], isLoaded: true });

        expect(mockOnScan).toHaveBeenCalledWith([{ path: '/test', variant: undefined }], true);
        expect(mockAddToast).not.toHaveBeenCalled(); // No toast on startup scan
        expect(mocks.refreshStartupFacetCache).not.toHaveBeenCalled();
    });

    it('defers startup incremental folder facet refresh to the startup coordinator', async () => {
        const handleImportPaths = vi.fn().mockResolvedValue({
            images: [],
            stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
            handledPaths: ['C:/watch/new.png'],
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
        const refreshMetadata = vi.fn().mockResolvedValue(undefined);
        mocks.scanDirectorySince.mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'C:/watch/new.png', modified: 100, size: 10 }]
        });

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [{
                id: 'watch-1',
                path: 'C:/watch',
                isActive: true,
                imageCount: 0,
                lastScanned: 10
            }],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata
        }));

        await waitFor(() => {
            expect(handleImportPaths).toHaveBeenCalledWith(
                ['C:/watch/new.png'],
                undefined,
                expect.objectContaining({
                    isStartup: true,
                    skipStateManagement: true,
                    forceRescan: true,
                    waitForStableFiles: true,
                    deferFacetCacheRefresh: true
                })
            );
        });

        await waitFor(() => {
            expect(mocks.refreshStartupFacetCache).toHaveBeenCalledWith(expect.objectContaining({
                source: 'folder',
                totalProcessed: 1,
                touchedFacetTypes: ['loras'],
                touchedFacetResources: expect.objectContaining({
                    loras: ['CinematicDetail']
                })
            }));
        });
        expect(refreshMetadata).toHaveBeenCalled();
        expect(mockOnScan).not.toHaveBeenCalled();
    });
});
