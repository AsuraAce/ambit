import React from 'react';
import { act, renderHook, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettings, GeneratorTool } from '../../../../types';
import { useLibraryStore } from '../../../../stores/libraryStore';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { useFoldersTabLogic } from '../useFoldersTabLogic';
import { commands } from '../../../../bindings';
import { processNativePaths, type ImportResult } from '../../../../services/importService';

const addToastMock = vi.hoisted(() => vi.fn());
const scanResourceThumbnailsMock = vi.hoisted(() => vi.fn());
const rebuildFacetCacheIncrementalBatchMock = vi.hoisted(() => vi.fn());
const refreshFacetCacheForResourcesStrictMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const getThumbnailDirMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

vi.mock('../../../../services/importService', () => ({
    scanResourceThumbnails: (...args: Parameters<typeof scanResourceThumbnailsMock>) => scanResourceThumbnailsMock(...args),
    processNativePaths: vi.fn(),
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    rebuildFacetCacheIncrementalBatch: (...args: Parameters<typeof rebuildFacetCacheIncrementalBatchMock>) => rebuildFacetCacheIncrementalBatchMock(...args),
    refreshFacetCacheForResourcesStrict: (...args: Parameters<typeof refreshFacetCacheForResourcesStrictMock>) => refreshFacetCacheForResourcesStrictMock(...args),
}));

vi.mock('../../../../services/thumbnailService', () => ({
    getThumbnailDir: (...args: Parameters<typeof getThumbnailDirMock>) => getThumbnailDirMock(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: (...args: Parameters<typeof openMock>) => openMock(...args),
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        getImageCountForPathPrefix: vi.fn(),
        scanDirectorySince: vi.fn(),
        scanDirectoryWithStats: vi.fn(),
        cancelModelDiscovery: vi.fn().mockResolvedValue(undefined),
        cancelImageFileHashBackfill: vi.fn().mockResolvedValue(undefined),
    },
}));

const baseSettings: AppSettings = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: false,
};

const renderFoldersHook = (
    settings: AppSettings = baseSettings,
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>
) => {
    const setSettings = vi.fn();
    const rendered = renderHook(() => useFoldersTabLogic({
        settings,
        setSettings,
        onScanFolder,
    }));

    return { ...rendered, setSettings };
};

const emptyResources = {
    checkpoints: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    controlNets: [],
    ipAdapters: [],
    tools: []
};

const emptyImportResult = (overrides: Partial<ImportResult> = {}): ImportResult => {
    const base: ImportResult = {
        images: [],
        stats: { processed: 0, imported: 0, skipped: 0, errors: 0 },
        handledPaths: [],
        failedPaths: [],
        touchedFacetTypes: [],
        touchedFacetResources: emptyResources,
        wasCancelled: false,
        completedSourcePaths: [],
        cancelledSourcePaths: []
    };

    return {
        ...base,
        ...overrides,
        stats: {
            ...base.stats,
            ...overrides.stats
        }
    };
};

describe('useFoldersTabLogic resource discovery', () => {
    const manualCancellationMessage = 'Import cancelled. Imported images were kept; rescan to continue.';

    beforeEach(() => {
        vi.clearAllMocks();
        addToastMock.mockReset();
        scanResourceThumbnailsMock.mockResolvedValue({
            found: 2,
            updated: 1,
            cachedFiles: 1,
            newOrChangedFiles: 1,
            registeredModels: 1,
            resources: {
                ...emptyResources,
                loras: ['CinematicDetail']
            }
        });
        rebuildFacetCacheIncrementalBatchMock.mockResolvedValue(2);
        refreshFacetCacheForResourcesStrictMock.mockResolvedValue(2);
        getThumbnailDirMock.mockResolvedValue('C:/thumbs');
        vi.mocked(commands.getImageCountForPathPrefix).mockResolvedValue({
            status: 'ok',
            data: 0
        });
        useSettingsStore.setState({ settings: baseSettings });
        useLibraryStore.setState({
            facetCacheVersion: 0,
            isScanningDiscovery: false,
            discoveryScanProgress: null,
            isImporting: false,
            importProgress: null,
            importAbortController: null,
            importRunId: null,
            importRunOwner: null
        });
    });

    it('browses resource folders into the resource path field', async () => {
        openMock.mockResolvedValue('D:\\AI\\Models');
        const { result } = renderFoldersHook();

        await act(async () => {
            await result.current.handleBrowseResource();
        });

        expect(result.current.newResourcePath).toBe('D:/AI/Models');
    });

    it('scans resources, refreshes touched resource facets, and increments the facet cache version', async () => {
        const { result, setSettings } = renderFoldersHook();
        refreshFacetCacheForResourcesStrictMock.mockImplementation(async () => {
            expect(useLibraryStore.getState().discoveryScanProgress).toMatchObject({
                current: 2,
                total: 0,
                message: 'Updating LoRA index...',
                mode: 'indeterminate',
                detail: '2 LoRA files found | 1 new/changed | 1 unchanged | 1 thumbnails linked',
            });
            return 2;
        });
        addToastMock.mockImplementation((message: string) => {
            if (message.startsWith('Resource scan complete')) {
                expect(useLibraryStore.getState().discoveryScanProgress).toMatchObject({
                    current: 2,
                    total: 2,
                    message: 'Resource scan complete',
                    mode: 'complete',
                    detail: '2 LoRA files found | 2 indexed | 1 new/changed | 1 unchanged | 1 thumbnails linked',
                });
            }
        });

        act(() => {
            result.current.setNewResourcePath('D:\\AI\\Models');
        });

        await act(async () => {
            await result.current.handleAddResourceFolder({
                preventDefault: vi.fn(),
            } as unknown as React.FormEvent);
        });

        const updateSettings = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(updateSettings(baseSettings).resourceFolders).toEqual(['D:/AI/Models']);
        expect(scanResourceThumbnailsMock).toHaveBeenCalledWith(['D:/AI/Models']);
        expect(refreshFacetCacheForResourcesStrictMock).toHaveBeenCalledWith({
            ...emptyResources,
            loras: ['CinematicDetail']
        });
        expect(rebuildFacetCacheIncrementalBatchMock).not.toHaveBeenCalled();

        await waitFor(() => {
            expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        });
        expect(addToastMock).toHaveBeenCalledWith('Resource scan complete: 2 LoRA files found, 2 indexed', 'success');
        expect(useLibraryStore.getState().discoveryScanProgress).toBeNull();
        expect(useLibraryStore.getState().isScanningDiscovery).toBe(false);
    });

    it('scans only the newly added resource folder when existing resource folders are configured', async () => {
        const settings = {
            ...baseSettings,
            resourceFolders: ['D:/AI/Existing'],
        };
        const { result, setSettings } = renderFoldersHook(settings);

        act(() => {
            result.current.setNewResourcePath('D:\\AI\\New');
        });

        await act(async () => {
            await result.current.handleAddResourceFolder({
                preventDefault: vi.fn(),
            } as unknown as React.FormEvent);
        });

        const updateSettings = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(updateSettings(settings).resourceFolders).toEqual(['D:/AI/Existing', 'D:/AI/New']);
        expect(scanResourceThumbnailsMock).toHaveBeenCalledWith(['D:/AI/New']);
    });

    it('scan now scans all configured resource folders', async () => {
        const settings = {
            ...baseSettings,
            resourceFolders: ['D:/AI/Checkpoints', 'D:/AI/Loras'],
        };
        const { result } = renderFoldersHook(settings);

        await act(async () => {
            await result.current.handleScanNow();
        });

        expect(scanResourceThumbnailsMock).toHaveBeenCalledWith(['D:/AI/Checkpoints', 'D:/AI/Loras']);
        expect(refreshFacetCacheForResourcesStrictMock).toHaveBeenCalledWith({
            ...emptyResources,
            loras: ['CinematicDetail']
        });
        expect(useLibraryStore.getState().discoveryScanProgress).toBeNull();
    });

    it('skips broad rebuild and warns when scan returns files without touched resources', async () => {
        scanResourceThumbnailsMock.mockResolvedValueOnce({
            found: 2,
            updated: 0,
            cachedFiles: 0,
            newOrChangedFiles: 2,
            registeredModels: 0,
            resources: emptyResources
        });
        const { result } = renderFoldersHook();

        act(() => {
            result.current.setNewResourcePath('D:\\AI\\Unknown');
        });

        await act(async () => {
            await result.current.handleAddResourceFolder({
                preventDefault: vi.fn(),
            } as unknown as React.FormEvent);
        });

        expect(refreshFacetCacheForResourcesStrictMock).not.toHaveBeenCalled();
        expect(rebuildFacetCacheIncrementalBatchMock).not.toHaveBeenCalled();
        expect(addToastMock).toHaveBeenCalledWith(
            'Resource scan found model files, but none could be classified for indexing',
            'warning'
        );
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('clears discovery progress after resource scan failure', async () => {
        scanResourceThumbnailsMock.mockRejectedValueOnce(new Error('scan failed'));
        const { result } = renderFoldersHook();

        act(() => {
            result.current.setNewResourcePath('D:\\AI\\Broken');
        });

        await act(async () => {
            await result.current.handleAddResourceFolder({
                preventDefault: vi.fn(),
            } as unknown as React.FormEvent);
        });

        expect(useLibraryStore.getState().discoveryScanProgress).toBeNull();
        expect(useLibraryStore.getState().isScanningDiscovery).toBe(false);
    });

    it('shows a concise cancellation toast after resource scan cancellation', async () => {
        scanResourceThumbnailsMock.mockRejectedValueOnce(new Error('Discovery scan cancelled by user'));
        const { result } = renderFoldersHook();

        act(() => {
            result.current.setNewResourcePath('D:\\AI\\Cancelled');
        });

        await act(async () => {
            await result.current.handleAddResourceFolder({
                preventDefault: vi.fn(),
            } as unknown as React.FormEvent);
        });

        expect(addToastMock).toHaveBeenCalledWith('Resource scan cancelled', 'info');
        expect(useLibraryStore.getState().discoveryScanProgress).toBeNull();
        expect(useLibraryStore.getState().isScanningDiscovery).toBe(false);
    });

    it('does not advance a monitored folder cursor when incremental import is cancelled', async () => {
        const updateLastScannedMock = vi.fn();
        useLibraryStore.setState({ importAbortController: null });
        const updateFolderLastScannedSpy = vi
            .spyOn(useSettingsStore.getState(), 'updateFolderLastScanned')
            .mockImplementation(updateLastScannedMock);
        vi.mocked(commands.scanDirectorySince).mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'D:/AI/Comfy/output/new.png', modified: 100, size: 10 }]
        });
        vi.mocked(processNativePaths).mockResolvedValueOnce({
            images: [],
            stats: { processed: 0, imported: 0, skipped: 0, errors: 0 },
            handledPaths: [],
            failedPaths: [],
            touchedFacetTypes: [],
            touchedFacetResources: emptyResources,
            wasCancelled: true,
            completedSourcePaths: [],
            cancelledSourcePaths: []
        });
        const settings = {
            ...baseSettings,
            monitoredFolders: [
                {
                    id: 'folder-1',
                    path: 'D:/AI/Comfy/output',
                    isActive: true,
                    imageCount: 0,
                    variant: GeneratorTool.COMFYUI,
                    lastScanned: 10
                }
            ]
        };
        const { result } = renderHook(() => useFoldersTabLogic({
            settings,
            setSettings: vi.fn(),
            onScanFolder: vi.fn()
        }));

        await act(async () => {
            await result.current.handleRescan('folder-1', 'D:/AI/Comfy/output', GeneratorTool.COMFYUI, false);
        });

        expect(processNativePaths).toHaveBeenCalledWith(
            ['D:/AI/Comfy/output/new.png'],
            expect.any(String),
            expect.any(Function),
            GeneratorTool.COMFYUI,
            expect.any(AbortSignal),
            false,
            true,
            true
        );
        expect(updateLastScannedMock).not.toHaveBeenCalled();
        expect(addToastMock).toHaveBeenCalledWith(manualCancellationMessage, 'info');
        expect(useLibraryStore.getState().importAbortController).toBeNull();

        updateFolderLastScannedSpy.mockRestore();
    });

    it('does not let manual incremental rescan overwrite an active import run', async () => {
        const activeRunId = useLibraryStore.getState().beginImportRun({
            owner: 'active-import',
            abortController: new AbortController(),
            progress: { current: 4, total: 10, message: 'Active import' }
        });
        vi.mocked(commands.scanDirectorySince).mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'D:/AI/Comfy/output/new.png', modified: 100, size: 10 }]
        });
        const settings = {
            ...baseSettings,
            monitoredFolders: [
                {
                    id: 'folder-1',
                    path: 'D:/AI/Comfy/output',
                    isActive: true,
                    imageCount: 0,
                    variant: GeneratorTool.COMFYUI,
                    lastScanned: 10
                }
            ]
        };
        const { result } = renderHook(() => useFoldersTabLogic({
            settings,
            setSettings: vi.fn(),
            onScanFolder: vi.fn()
        }));

        await act(async () => {
            await result.current.handleRescan('folder-1', 'D:/AI/Comfy/output', GeneratorTool.COMFYUI, false);
        });

        expect(activeRunId).toBeTruthy();
        expect(processNativePaths).not.toHaveBeenCalled();
        expect(addToastMock).toHaveBeenCalledWith('Import already in progress', 'info');
        expect(useLibraryStore.getState().importRunId).toBe(activeRunId);
        expect(useLibraryStore.getState().importProgress?.message).toBe('Active import');
    });

    it('marks a cancelled added-folder initial import as cancelled', async () => {
        vi.useFakeTimers();
        try {
            const onScanFolder = vi.fn().mockResolvedValue(emptyImportResult({ wasCancelled: true }));
            const { result, setSettings } = renderFoldersHook(baseSettings, onScanFolder);

            act(() => {
                result.current.setNewFolderPath('D:\\AI\\Cancelled');
            });

            act(() => {
                result.current.handleAddFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(500);
            });

            expect(onScanFolder).toHaveBeenCalledWith([{ path: 'D:/AI/Cancelled', variant: GeneratorTool.UNKNOWN }]);
            const addUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
            const addedSettings = addUpdate(baseSettings);
            const finalizeUpdate = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
            const finalSettings = finalizeUpdate(addedSettings);

            expect(finalSettings.monitoredFolders[0]).toMatchObject({
                path: 'D:/AI/Cancelled',
                initialScanPending: false,
                initialScanCancelled: true
            });
            expect(finalSettings.monitoredFolders[0].lastScanned).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('uses source-level status for batched added-folder initial imports', async () => {
        vi.useFakeTimers();
        try {
            const onScanFolder = vi.fn().mockResolvedValue(emptyImportResult({
                wasCancelled: true,
                completedSourcePaths: ['D:/AI/Done'],
                cancelledSourcePaths: ['D:/AI/Cancel']
            }));
            const { result, setSettings } = renderFoldersHook(baseSettings, onScanFolder);

            act(() => {
                result.current.setNewFolderPath('D:\\AI\\Done');
            });
            act(() => {
                result.current.handleAddFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
            });
            act(() => {
                result.current.setNewFolderPath('D:\\AI\\Cancel');
            });
            act(() => {
                result.current.handleAddFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(500);
            });

            expect(onScanFolder).toHaveBeenCalledWith([
                { path: 'D:/AI/Done', variant: GeneratorTool.UNKNOWN },
                { path: 'D:/AI/Cancel', variant: GeneratorTool.UNKNOWN }
            ]);

            const addDone = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
            const addCancel = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
            const finalizeUpdate = setSettings.mock.calls[2][0] as (previous: AppSettings) => AppSettings;
            const finalSettings = finalizeUpdate(addCancel(addDone(baseSettings)));

            expect(finalSettings.monitoredFolders.find(folder => folder.path === 'D:/AI/Done')).toMatchObject({
                path: 'D:/AI/Done',
                initialScanPending: false,
                initialScanCancelled: false,
                lastScanned: expect.any(Number)
            });
            expect(finalSettings.monitoredFolders.find(folder => folder.path === 'D:/AI/Cancel')).toMatchObject({
                path: 'D:/AI/Cancel',
                initialScanPending: false,
                initialScanCancelled: true
            });
            expect(finalSettings.monitoredFolders.find(folder => folder.path === 'D:/AI/Cancel')?.lastScanned).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps added-folder partial failures retryable without marking cancellation', async () => {
        vi.useFakeTimers();
        try {
            const onScanFolder = vi.fn().mockResolvedValue(emptyImportResult({
                stats: { processed: 1, imported: 0, skipped: 0, errors: 1 },
                failedPaths: ['D:/AI/Partial/bad.png']
            }));
            const { result, setSettings } = renderFoldersHook(baseSettings, onScanFolder);

            act(() => {
                result.current.setNewFolderPath('D:\\AI\\Partial');
            });

            act(() => {
                result.current.handleAddFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(500);
            });

            const addUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
            const addedSettings = addUpdate(baseSettings);
            const finalizeUpdate = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
            const finalSettings = finalizeUpdate(addedSettings);

            expect(finalSettings.monitoredFolders[0]).toMatchObject({
                path: 'D:/AI/Partial',
                initialScanPending: false,
                initialScanCancelled: false
            });
            expect(finalSettings.monitoredFolders[0].lastScanned).toBeUndefined();
            expect(addToastMock).toHaveBeenCalledWith('Folder scan completed with import errors', 'warning');
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears initial cancellation after a successful manual rescan even when count refresh updates later', async () => {
        const folder = {
            id: 'folder-1',
            path: 'D:/AI/Cancelled',
            isActive: true,
            imageCount: 0,
            variant: GeneratorTool.COMFYUI,
            initialScanCancelled: true
        };
        const settings = {
            ...baseSettings,
            monitoredFolders: [folder]
        };
        useSettingsStore.setState({ settings });
        vi.mocked(commands.getImageCountForPathPrefix).mockResolvedValue({
            status: 'ok',
            data: 5600
        });
        const onScanFolder = vi.fn().mockResolvedValue(emptyImportResult({
            images: [],
            stats: { processed: 5600, imported: 0, skipped: 5600, errors: 0 }
        }));
        const setSettings: React.Dispatch<React.SetStateAction<AppSettings>> = update => {
            if (typeof update === 'function') {
                useSettingsStore.getState().setSettings(prev => update(prev));
            } else {
                useSettingsStore.getState().setSettings(update);
            }
        };
        const { result } = renderHook(() => useFoldersTabLogic({
            settings,
            setSettings,
            onScanFolder,
        }));

        await act(async () => {
            await result.current.handleRescan('folder-1', 'D:/AI/Cancelled', GeneratorTool.COMFYUI, false);
        });

        const updatedFolder = useSettingsStore.getState().settings.monitoredFolders[0];
        expect(updatedFolder.imageCount).toBe(5600);
        expect(updatedFolder.lastScanned).toEqual(expect.any(Number));
        expect(updatedFolder.initialScanPending).toBe(false);
        expect(updatedFolder.initialScanCancelled).toBe(false);
    });

    it('keeps manual rescan cancellation flagged when the retry is cancelled again', async () => {
        const folder = {
            id: 'folder-1',
            path: 'D:/AI/Cancelled',
            isActive: true,
            imageCount: 0,
            variant: GeneratorTool.COMFYUI,
            initialScanCancelled: true
        };
        const settings = {
            ...baseSettings,
            monitoredFolders: [folder]
        };
        useSettingsStore.setState({ settings });
        const onScanFolder = vi.fn().mockResolvedValue(emptyImportResult({
            wasCancelled: true,
            cancelledSourcePaths: ['D:/AI/Cancelled']
        }));
        const setSettings: React.Dispatch<React.SetStateAction<AppSettings>> = update => {
            if (typeof update === 'function') {
                useSettingsStore.getState().setSettings(prev => update(prev));
            } else {
                useSettingsStore.getState().setSettings(update);
            }
        };
        const { result } = renderHook(() => useFoldersTabLogic({
            settings,
            setSettings,
            onScanFolder,
        }));

        await act(async () => {
            await result.current.handleRescan('folder-1', 'D:/AI/Cancelled', GeneratorTool.COMFYUI, false);
        });

        const updatedFolder = useSettingsStore.getState().settings.monitoredFolders[0];
        expect(updatedFolder.lastScanned).toBeUndefined();
        expect(updatedFolder.initialScanPending).toBe(false);
        expect(updatedFolder.initialScanCancelled).toBe(true);
    });

    it('makes failed manual rescan retryable without advancing the cursor', async () => {
        const folder = {
            id: 'folder-1',
            path: 'D:/AI/Cancelled',
            isActive: true,
            imageCount: 0,
            variant: GeneratorTool.COMFYUI,
            initialScanCancelled: true
        };
        const settings = {
            ...baseSettings,
            monitoredFolders: [folder]
        };
        useSettingsStore.setState({ settings });
        const onScanFolder = vi.fn().mockResolvedValue(emptyImportResult({
            stats: { processed: 1, imported: 0, skipped: 0, errors: 1 },
            failedPaths: ['D:/AI/Cancelled/bad.png']
        }));
        const setSettings: React.Dispatch<React.SetStateAction<AppSettings>> = update => {
            if (typeof update === 'function') {
                useSettingsStore.getState().setSettings(prev => update(prev));
            } else {
                useSettingsStore.getState().setSettings(update);
            }
        };
        const { result } = renderHook(() => useFoldersTabLogic({
            settings,
            setSettings,
            onScanFolder,
        }));

        await act(async () => {
            await result.current.handleRescan('folder-1', 'D:/AI/Cancelled', GeneratorTool.COMFYUI, false);
        });

        const updatedFolder = useSettingsStore.getState().settings.monitoredFolders[0];
        expect(updatedFolder.lastScanned).toBeUndefined();
        expect(updatedFolder.initialScanPending).toBe(false);
        expect(updatedFolder.initialScanCancelled).toBe(false);
        expect(addToastMock).toHaveBeenCalledWith('Rescan completed with import errors', 'warning');
    });
});
