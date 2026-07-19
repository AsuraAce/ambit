
import { act, renderHook, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFolderMonitor } from '../useFolderMonitor';
import type { AppSettings, MonitoredFolder } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSettingsStore } from '../../stores/settingsStore';

const mocks = vi.hoisted(() => ({
    scanDirectorySince: vi.fn(),
    refreshStartupFacetCache: vi.fn(),
    browserMockMode: false
}));

vi.mock('../../services/runtime', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../services/runtime')>(),
    isBrowserMockMode: () => mocks.browserMockMode
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
        promptMaskingEnabled: true,
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
        wasCancelled: true,
        completedSourcePaths: [],
        cancelledSourcePaths: []
    };
    const completedImportResult = {
        ...cancelledImportResult,
        stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
        wasCancelled: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.browserMockMode = false;
        mockOnScan.mockReset();
        mockAddToast.mockReset();
        useLibraryStore.setState({
            isLiveWatching: false,
            isImporting: false,
            importProgress: null,
            importAbortController: null,
            importRunId: null,
            importRunOwner: null
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

    it('bypasses startup and live scans in browser mock mode while tracking folder changes', () => {
        mocks.browserMockMode = true;
        const { rerender } = renderHook(({ folders }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn()
        }), { initialProps: { folders: [] as MonitoredFolder[] } });

        rerender({ folders: [{ id: 'browser', path: '/browser', isActive: true, imageCount: 0 }] });
        act(() => useLibraryStore.setState({ isLiveWatching: true }));

        expect(mockOnScan).not.toHaveBeenCalled();
        expect(mocks.scanDirectorySince).not.toHaveBeenCalled();
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
            wasCancelled: false,
            completedSourcePaths: [],
            cancelledSourcePaths: []
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
                wasCancelled: true,
                completedSourcePaths: [],
                cancelledSourcePaths: []
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

    it('uses stable startup progress for aggregated imports', async () => {
        const progressMessages: Array<{ message?: string; detail?: string }> = [];
        const unsubscribe = useLibraryStore.subscribe(state => {
            if (state.importProgress) {
                progressMessages.push({
                    message: state.importProgress.message,
                    detail: state.importProgress.detail
                });
            }
        });
        const handleImportPaths = vi.fn().mockImplementation(async (_paths, _variant, options) => {
            options.onProgress(1, 1, 'Extracting Metadata');
            return {
                images: [],
                stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
                handledPaths: ['C:/watch/new.png'],
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
                wasCancelled: false,
                completedSourcePaths: [],
                cancelledSourcePaths: []
            };
        });
        mocks.scanDirectorySince
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/watch-a/new.png', modified: 100, size: 10 }]
            })
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/watch-b/new.png', modified: 100, size: 10 }]
            });

        try {
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
                        lastScanned: 20
                    }
                ],
                onScan: mockOnScan,
                addToast: mockAddToast,
                handleImportPaths,
                refreshMetadata: vi.fn()
            }));

            await waitFor(() => {
                expect(handleImportPaths).toHaveBeenCalledTimes(2);
            });

            expect(progressMessages).toEqual(expect.arrayContaining([
                { message: 'Startup: Importing images from 2 folders...', detail: undefined },
                { message: 'Startup: Importing images from 2 folders...', detail: 'Folder 1 of 2' },
                { message: 'Startup: Importing images from 2 folders...', detail: 'Folder 2 of 2' }
            ]));
            expect(progressMessages.some(progress => progress.message === 'Extracting Metadata')).toBe(false);
        } finally {
            unsubscribe();
        }
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

    it('uses stable catch-up progress for aggregated imports', async () => {
        const progressMessages: Array<{ message?: string; detail?: string }> = [];
        const unsubscribe = useLibraryStore.subscribe(state => {
            if (state.importProgress) {
                progressMessages.push({
                    message: state.importProgress.message,
                    detail: state.importProgress.detail
                });
            }
        });
        const handleImportPaths = vi.fn().mockImplementation(async (_paths, _variant, options) => {
            options.onProgress(1, 1, 'Extracting Metadata');
            return {
                images: [],
                stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
                handledPaths: ['C:/watch/new.png'],
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
                wasCancelled: false,
                completedSourcePaths: [],
                cancelledSourcePaths: []
            };
        });
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
        mocks.scanDirectorySince
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/watch-a/new.png', modified: 100, size: 10 }]
            })
            .mockResolvedValueOnce({
                status: 'ok',
                data: [{ path: 'C:/watch-b/new.png', modified: 100, size: 10 }]
            });

        try {
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
                        lastScanned: 20
                    }
                ],
                invokeAiPath: 'C:/invokeai'
            });

            useLibraryStore.setState({ isLiveWatching: true });

            await waitFor(() => {
                expect(handleImportPaths).toHaveBeenCalledTimes(2);
            });

            expect(progressMessages).toEqual(expect.arrayContaining([
                { message: 'Catch-up: Importing images from 2 folders...', detail: undefined },
                { message: 'Catch-up: Importing images from 2 folders...', detail: 'Folder 1 of 2' },
                { message: 'Catch-up: Importing images from 2 folders...', detail: 'Folder 2 of 2' }
            ]));
            expect(progressMessages.some(progress => progress.message === 'Extracting Metadata')).toBe(false);
        } finally {
            unsubscribe();
        }
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

    it('handles empty, failed, and completed startup folder scans before InvokeAI sync', async () => {
        const folders: MonitoredFolder[] = [
            { id: 'empty', path: 'C:/empty', isActive: true, imageCount: 0, lastScanned: 1 },
            { id: 'broken', path: 'C:/broken', isActive: true, imageCount: 0, lastScanned: 2 },
            { id: 'full', path: 'C:/full', isActive: true, imageCount: 0 }
        ];
        mocks.scanDirectorySince
            .mockResolvedValueOnce({ status: 'ok', data: [] })
            .mockRejectedValueOnce(new Error('scan failed'));
        mockOnScan.mockResolvedValue({
            ...completedImportResult,
            completedSourcePaths: ['C:/full']
        });
        const startInvokeSync = vi.fn().mockRejectedValue(new Error('sync failed'));
        const updateFolderLastScanned = vi.spyOn(useSettingsStore.getState(), 'updateFolderLastScanned');

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn(),
            invokeAiPath: 'C:/invokeai',
            startInvokeSync
        }));

        await waitFor(() => expect(startInvokeSync).toHaveBeenCalledWith({ mode: 'startup' }));
        expect(updateFolderLastScanned).toHaveBeenCalledWith('empty', expect.any(Number));
        expect(updateFolderLastScanned).toHaveBeenCalledWith('full', expect.any(Number));
        expect(mockOnScan).toHaveBeenCalledWith([{ path: 'C:/full', variant: undefined }], { mode: 'startup' });
    });

    it('skips a startup incremental import when another owner holds the import run', async () => {
        mocks.scanDirectorySince.mockResolvedValue({
            status: 'ok',
            data: [{ path: 'C:/watch/new.png', modified: 1, size: 1 }]
        });
        useLibraryStore.setState({ isImporting: true, importRunId: 'existing', importRunOwner: 'manual' });
        const handleImportPaths = vi.fn();

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [{ id: 'watch', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1 }],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata: vi.fn()
        }));

        await waitFor(() => expect(mocks.scanDirectorySince).toHaveBeenCalled());
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(handleImportPaths).not.toHaveBeenCalled();
    });

    it('stops before the next startup task when its shared abort controller is aborted', async () => {
        mocks.scanDirectorySince
            .mockResolvedValueOnce({ status: 'ok', data: [{ path: 'C:/a/new.png', modified: 1, size: 1 }] })
            .mockResolvedValueOnce({ status: 'ok', data: [{ path: 'C:/b/new.png', modified: 1, size: 1 }] });
        const handleImportPaths = vi.fn().mockImplementation(async () => {
            useLibraryStore.getState().importAbortController?.abort();
            return completedImportResult;
        });

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [
                { id: 'a', path: 'C:/a', isActive: true, imageCount: 0, lastScanned: 1 },
                { id: 'b', path: 'C:/b', isActive: true, imageCount: 0, lastScanned: 1 }
            ],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata: vi.fn()
        }));

        await waitFor(() => expect(handleImportPaths).toHaveBeenCalledTimes(1));
    });

    it('applies the startup facet refresh callback and contains refresh failures', async () => {
        mocks.scanDirectorySince.mockResolvedValue({
            status: 'ok',
            data: [{ path: 'C:/watch/new.png', modified: 1, size: 1 }]
        });
        mocks.refreshStartupFacetCache.mockImplementationOnce(async ({ onRefreshApplied }) => {
            onRefreshApplied();
            throw new Error('refresh failed');
        });
        const versionBefore = useLibraryStore.getState().facetCacheVersion;
        const refreshMetadata = vi.fn();

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [{ id: 'watch', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1 }],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn().mockResolvedValue(completedImportResult),
            refreshMetadata
        }));

        await waitFor(() => expect(useLibraryStore.getState().facetCacheVersion).toBe(versionBefore + 1));
        await waitFor(() => expect(refreshMetadata).toHaveBeenCalled());
    });

    it('classifies completed, cancelled, and incomplete newly added folder scans', async () => {
        const initialProps = { folders: [] as MonitoredFolder[], invokeAiPath: 'C:/invokeai' };
        mockOnScan.mockResolvedValue({
            ...completedImportResult,
            failedPaths: ['C:/unknown'],
            wasCancelled: true,
            completedSourcePaths: ['C:/done'],
            cancelledSourcePaths: ['C:/cancelled']
        });
        useSettingsStore.setState({
            settings: {
                ...baseSettings,
                monitoredFolders: [
                    { id: 'done', path: 'C:/done', isActive: true, imageCount: 0 },
                    { id: 'cancelled', path: 'C:/cancelled', isActive: true, imageCount: 0 },
                    { id: 'unknown', path: 'C:/unknown', isActive: true, imageCount: 0 }
                ]
            }
        });
        const { rerender } = renderHook(({ folders, invokeAiPath }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn(),
            invokeAiPath
        }), { initialProps });
        await new Promise(resolve => setTimeout(resolve, 0));

        rerender({
            folders: useSettingsStore.getState().settings.monitoredFolders,
            invokeAiPath: 'C:/invokeai'
        });

        await waitFor(() => expect(mockOnScan).toHaveBeenCalledWith(expect.any(Array)));
        expect(mockAddToast).toHaveBeenCalledWith('Scanning 3 new folders', 'info');
        await waitFor(() => {
            expect(useSettingsStore.getState().settings.monitoredFolders[1].initialScanCancelled).toBe(true);
        });
    });

    it('holds the startup cursor when an incremental import returns no result', async () => {
        mocks.scanDirectorySince.mockResolvedValue({
            status: 'ok',
            data: [{ path: 'C:/watch/new.png', modified: 1, size: 1 }]
        });
        const refreshMetadata = vi.fn();

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [{ id: 'watch', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1 }],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn().mockResolvedValue(undefined),
            refreshMetadata
        }));

        await waitFor(() => expect(refreshMetadata).toHaveBeenCalled());
    });

    it('honors an abort raised before the first startup import task begins', async () => {
        mocks.scanDirectorySince.mockResolvedValue({
            status: 'ok',
            data: [{ path: 'C:/watch/new.png', modified: 1, size: 1 }]
        });
        const store = useLibraryStore.getState();
        const beginImportRun = vi.spyOn(store, 'beginImportRun').mockImplementation((options) => {
            options?.abortController?.abort();
            return 'aborted-startup';
        });
        const handleImportPaths = vi.fn();

        renderHook(() => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: [{ id: 'watch', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1 }],
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata: vi.fn()
        }));

        await waitFor(() => expect(beginImportRun).toHaveBeenCalled());
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(handleImportPaths).not.toHaveBeenCalled();
        beginImportRun.mockRestore();
    });

    it('handles every no-import live catch-up folder outcome', async () => {
        const initialProps = { folders: [] as MonitoredFolder[], invokeAiPath: 'C:/invokeai' };
        const { rerender } = renderHook(({ folders, invokeAiPath }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths: vi.fn(),
            refreshMetadata: vi.fn(),
            invokeAiPath
        }), { initialProps });
        await new Promise(resolve => setTimeout(resolve, 0));
        vi.clearAllMocks();
        mocks.scanDirectorySince
            .mockResolvedValueOnce({ status: 'ok', data: [] })
            .mockRejectedValueOnce(new Error('catch-up scan failed'));
        mockOnScan
            .mockResolvedValueOnce({ ...completedImportResult, completedSourcePaths: ['C:/complete'] })
            .mockResolvedValueOnce(undefined);

        rerender({
            folders: [
                { id: 'empty', path: 'C:/empty', isActive: true, imageCount: 0, lastScanned: 1 },
                { id: 'complete', path: 'C:/complete', isActive: true, imageCount: 0, initialScanPending: true },
                { id: 'unknown', path: 'C:/unknown', isActive: true, imageCount: 0, initialScanPending: true },
                { id: 'broken', path: 'C:/broken', isActive: true, imageCount: 0, lastScanned: 1 }
            ],
            invokeAiPath: 'C:/invokeai'
        });
        act(() => useLibraryStore.setState({ isLiveWatching: true }));

        await waitFor(() => expect(mockOnScan).toHaveBeenCalledTimes(2));
        expect(mockOnScan).toHaveBeenNthCalledWith(1, [{ path: 'C:/complete', variant: undefined }], { mode: 'background' });
        expect(mockOnScan).toHaveBeenNthCalledWith(2, [{ path: 'C:/unknown', variant: undefined }], { mode: 'background' });
    });

    it('skips a live catch-up import when ownership changes during directory scanning', async () => {
        const initialProps = { folders: [] as MonitoredFolder[], invokeAiPath: 'C:/invokeai' };
        const handleImportPaths = vi.fn();
        const { rerender } = renderHook(({ folders, invokeAiPath }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata: vi.fn(),
            invokeAiPath
        }), { initialProps });
        await new Promise(resolve => setTimeout(resolve, 0));
        mocks.scanDirectorySince.mockImplementationOnce(async () => {
            useLibraryStore.setState({ isImporting: true, importRunId: 'manual', importRunOwner: 'manual' });
            return { status: 'ok', data: [{ path: 'C:/watch/new.png', modified: 1, size: 1 }] };
        });

        rerender({
            folders: [{ id: 'watch', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1 }],
            invokeAiPath: 'C:/invokeai'
        });
        act(() => useLibraryStore.setState({ isLiveWatching: true }));

        await waitFor(() => expect(mocks.scanDirectorySince).toHaveBeenCalled());
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(handleImportPaths).not.toHaveBeenCalled();
    });

    it('honors a pre-task live abort and holds cursors for incomplete live imports', async () => {
        const initialProps = { folders: [] as MonitoredFolder[], invokeAiPath: 'C:/invokeai' };
        const handleImportPaths = vi.fn();
        const { rerender } = renderHook(({ folders, invokeAiPath }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast,
            handleImportPaths,
            refreshMetadata: vi.fn(),
            invokeAiPath
        }), { initialProps });
        await new Promise(resolve => setTimeout(resolve, 0));
        mocks.scanDirectorySince.mockResolvedValue({
            status: 'ok',
            data: [{ path: 'C:/watch/new.png', modified: 1, size: 1 }]
        });
        const beginImportRun = vi.spyOn(useLibraryStore.getState(), 'beginImportRun').mockImplementation((options) => {
            options?.abortController?.abort();
            return 'aborted-live';
        });

        rerender({
            folders: [{ id: 'watch', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1 }],
            invokeAiPath: 'C:/invokeai'
        });
        act(() => useLibraryStore.setState({ isLiveWatching: true }));

        await waitFor(() => expect(beginImportRun).toHaveBeenCalled());
        expect(handleImportPaths).not.toHaveBeenCalled();

        beginImportRun.mockRestore();
        act(() => useLibraryStore.setState({ isLiveWatching: false }));
        handleImportPaths.mockResolvedValueOnce({ ...completedImportResult, failedPaths: ['C:/watch/new.png'] });
        act(() => useLibraryStore.setState({ isLiveWatching: true }));

        await waitFor(() => expect(handleImportPaths).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Catch-up: Synced 1 new images', 'success'));
    });
});
