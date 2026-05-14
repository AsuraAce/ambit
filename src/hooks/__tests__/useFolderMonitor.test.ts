
import { renderHook, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFolderMonitor } from '../useFolderMonitor';
import type { AppSettings, MonitoredFolder } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSettingsStore } from '../../stores/settingsStore';

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
    const baseSettings: AppSettings = {
        hasCompletedOnboarding: true,
        theme: 'dark',
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        maskedKeywords: [],
        maskingMode: 'blur',
        enableAI: false
    };
    const cancelledImportResult = {
        images: [],
        stats: { processed: 0, imported: 0, skipped: 0, errors: 0 },
        handledPaths: [],
        failedPaths: [],
        touchedFacetTypes: [],
        touchedFacetResources: {
            checkpoints: [],
            loras: [],
            embeddings: [],
            hypernetworks: [],
            controlNets: [],
            ipAdapters: [],
            tools: []
        },
        wasCancelled: true
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockOnScan.mockReset();
        mockAddToast.mockReset();
        useLibraryStore.setState({
            isLiveWatching: false,
            isImporting: false,
            importProgress: null,
            importAbortController: null
        });
        mocks.scanDirectorySince.mockResolvedValue({ status: 'ok', data: [] });
        mocks.refreshStartupFacetCache.mockResolvedValue({
            strategy: 'resource-incremental',
            reason: 'small-known-delta',
            entryCount: 1,
            touchedFacetTypes: ['loras'],
            touchedResourceCount: 1
        });
        useSettingsStore.setState({ settings: baseSettings });
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

        expect(mockOnScan).toHaveBeenCalledWith([{ path: '/test2', variant: undefined }]);
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

    it('should not auto-scan newly added folders whose initial import was cancelled', () => {
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
                { id: '2', path: '/test2', isActive: true, imageCount: 0, initialScanCancelled: true }
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

        expect(mockOnScan).toHaveBeenCalledWith([{ path: '/test', variant: undefined }], { mode: 'startup' });
        expect(mockAddToast).not.toHaveBeenCalled(); // No toast on startup scan
        expect(mocks.refreshStartupFacetCache).not.toHaveBeenCalled();
    });

    it('skips cancelled initial imports during startup scans', async () => {
        const handleImportPaths = vi.fn();

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [
                { id: 'watch-1', path: 'C:/cancelled', isActive: true, imageCount: 0, initialScanCancelled: true },
                { id: 'watch-2', path: 'C:/ready', isActive: true, imageCount: 0 }
            ],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata: vi.fn()
        }));

        await waitFor(() => {
            expect(mockOnScan).toHaveBeenCalledTimes(1);
        });
        expect(mockOnScan).toHaveBeenCalledWith([{ path: 'C:/ready', variant: undefined }], { mode: 'startup' });
        expect(handleImportPaths).not.toHaveBeenCalled();
    });

    it('marks startup full-scan cancellation as an initial import cancellation', async () => {
        const folders: MonitoredFolder[] = [
            { id: 'watch-1', path: 'C:/watch-a', isActive: true, imageCount: 0 },
            { id: 'watch-2', path: 'C:/watch-b', isActive: true, imageCount: 0 }
        ];
        useSettingsStore.setState({
            settings: {
                ...baseSettings,
                monitoredFolders: folders
            }
        });
        mockOnScan.mockResolvedValue(cancelledImportResult);

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn()
        }));

        await waitFor(() => {
            expect(useSettingsStore.getState().settings.monitoredFolders[0].initialScanCancelled).toBe(true);
        });
        expect(useSettingsStore.getState().settings.monitoredFolders[1].initialScanCancelled).toBeUndefined();
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
            },
            wasCancelled: false
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
                    mode: 'startup',
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

    it('passes one parent abort signal through aggregated startup imports and stops after cancellation', async () => {
        let firstAbortSignal: AbortSignal | undefined;
        const handleImportPaths = vi.fn().mockImplementation(async (_paths, _variant, options) => {
            firstAbortSignal = options.abortSignal;
            return {
                images: [],
                stats: { processed: 0, imported: 0, skipped: 0, errors: 0 },
                handledPaths: [],
                failedPaths: [],
                touchedFacetTypes: [],
                touchedFacetResources: {
                    checkpoints: [],
                    loras: [],
                    embeddings: [],
                    hypernetworks: [],
                    controlNets: [],
                    ipAdapters: [],
                    tools: []
                },
                wasCancelled: true
            };
        });
        const refreshMetadata = vi.fn().mockResolvedValue(undefined);
        mocks.scanDirectorySince
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/watch-a/new.png', modified: 100, size: 10 }]
            })
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/watch-b/new.png', modified: 100, size: 10 }]
            });

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [
                {
                    id: 'watch-1',
                    path: 'C:/watch-a',
                    isActive: true,
                    imageCount: 0,
                    lastScanned: 10
                },
                {
                    id: 'watch-2',
                    path: 'C:/watch-b',
                    isActive: true,
                    imageCount: 0,
                    lastScanned: 10
                }
            ],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata
        }));

        await waitFor(() => {
            expect(handleImportPaths).toHaveBeenCalledTimes(1);
        });

        expect(firstAbortSignal).toBeInstanceOf(AbortSignal);
        expect(handleImportPaths).toHaveBeenCalledWith(
            ['C:/watch-a/new.png'],
            undefined,
            expect.objectContaining({
                mode: 'startup',
                abortSignal: firstAbortSignal,
                skipStateManagement: true,
                forceRescan: true
            })
        );
        expect(mocks.refreshStartupFacetCache).not.toHaveBeenCalled();
        expect(refreshMetadata).not.toHaveBeenCalled();
    });

    it('stops startup full scans after a cancelled folder import', async () => {
        mockOnScan.mockResolvedValue(cancelledImportResult);
        const handleImportPaths = vi.fn();

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [
                { id: 'watch-1', path: 'C:/watch-a', isActive: true, imageCount: 0 },
                { id: 'watch-2', path: 'C:/watch-b', isActive: true, imageCount: 0 }
            ],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata: vi.fn()
        }));

        await waitFor(() => {
            expect(mockOnScan).toHaveBeenCalledTimes(1);
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockOnScan).toHaveBeenCalledWith([{ path: 'C:/watch-a', variant: undefined }], { mode: 'startup' });
        expect(handleImportPaths).not.toHaveBeenCalled();
    });

    it('skips queued startup incremental imports after a startup full-scan cancellation', async () => {
        mockOnScan.mockResolvedValue(cancelledImportResult);
        mocks.scanDirectorySince.mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'C:/watch-a/new.png', modified: 100, size: 10 }]
        });
        const handleImportPaths = vi.fn();
        const refreshMetadata = vi.fn().mockResolvedValue(undefined);

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [
                {
                    id: 'watch-1',
                    path: 'C:/watch-a',
                    isActive: true,
                    imageCount: 0,
                    lastScanned: 10
                },
                {
                    id: 'watch-2',
                    path: 'C:/watch-b',
                    isActive: true,
                    imageCount: 0
                }
            ],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata
        }));

        await waitFor(() => {
            expect(mockOnScan).toHaveBeenCalledWith([{ path: 'C:/watch-b', variant: undefined }], { mode: 'startup' });
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(handleImportPaths).not.toHaveBeenCalled();
        expect(mocks.refreshStartupFacetCache).not.toHaveBeenCalled();
        expect(refreshMetadata).not.toHaveBeenCalled();
    });

    it('stops catch-up full scans after cancellation and skips queued incremental imports', async () => {
        const handleImportPaths = vi.fn();
        const refreshMetadata = vi.fn().mockResolvedValue(undefined);
        mockOnScan.mockResolvedValue(cancelledImportResult);
        const initialProps = {
            folders: [] as MonitoredFolder[],
            invokeAiPath: 'C:/invokeai'
        };

        const { rerender } = renderHook(({ folders, invokeAiPath }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata,
            invokeAiPath
        }), { initialProps });

        await new Promise(resolve => setTimeout(resolve, 0));
        vi.clearAllMocks();
        mocks.scanDirectorySince.mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'C:/watch-a/new.png', modified: 100, size: 10 }]
        });

        rerender({
            folders: [
                {
                    id: 'watch-1',
                    path: 'C:/watch-a',
                    isActive: true,
                    imageCount: 0,
                    lastScanned: 10
                },
                {
                    id: 'watch-2',
                    path: 'C:/watch-b',
                    isActive: true,
                    imageCount: 0,
                    initialScanPending: true
                }
            ],
            invokeAiPath: 'C:/invokeai'
        });

        useLibraryStore.setState({ isLiveWatching: true });

        await waitFor(() => {
            expect(mockOnScan).toHaveBeenCalledWith([{ path: 'C:/watch-b', variant: undefined }], { mode: 'background' });
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(handleImportPaths).not.toHaveBeenCalled();
        expect(refreshMetadata).not.toHaveBeenCalled();
    });

    it('passes background mode through queued catch-up incremental imports', async () => {
        const handleImportPaths = vi.fn().mockResolvedValue(cancelledImportResult);
        const refreshMetadata = vi.fn().mockResolvedValue(undefined);
        const initialProps = {
            folders: [] as MonitoredFolder[],
            invokeAiPath: 'C:/invokeai'
        };

        const { rerender } = renderHook(({ folders, invokeAiPath }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata,
            invokeAiPath
        }), { initialProps });

        await new Promise(resolve => setTimeout(resolve, 0));
        vi.clearAllMocks();
        mocks.scanDirectorySince.mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'C:/watch-a/new.png', modified: 100, size: 10 }]
        });

        rerender({
            folders: [
                {
                    id: 'watch-1',
                    path: 'C:/watch-a',
                    isActive: true,
                    imageCount: 0,
                    lastScanned: 10
                }
            ],
            invokeAiPath: 'C:/invokeai'
        });

        useLibraryStore.setState({ isLiveWatching: true });

        await waitFor(() => {
            expect(handleImportPaths).toHaveBeenCalledWith(
                ['C:/watch-a/new.png'],
                undefined,
                expect.objectContaining({
                    mode: 'background',
                    skipStateManagement: true,
                    forceRescan: true,
                    waitForStableFiles: true
                })
            );
        });
        expect(refreshMetadata).not.toHaveBeenCalled();
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('skips cancelled initial imports during Live Watch catch-up', async () => {
        const handleImportPaths = vi.fn();
        const refreshMetadata = vi.fn().mockResolvedValue(undefined);
        const initialProps = {
            folders: [] as MonitoredFolder[],
            invokeAiPath: 'C:/invokeai'
        };

        const { rerender } = renderHook(({ folders, invokeAiPath }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata,
            invokeAiPath
        }), { initialProps });

        await new Promise(resolve => setTimeout(resolve, 0));
        vi.clearAllMocks();

        rerender({
            folders: [
                {
                    id: 'watch-1',
                    path: 'C:/watch-a',
                    isActive: true,
                    imageCount: 0,
                    initialScanCancelled: true
                }
            ],
            invokeAiPath: 'C:/invokeai'
        });

        useLibraryStore.setState({ isLiveWatching: true });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockOnScan).not.toHaveBeenCalled();
        expect(handleImportPaths).not.toHaveBeenCalled();
        expect(refreshMetadata).not.toHaveBeenCalled();
    });
});
