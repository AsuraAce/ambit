import React from 'react';
import { act, renderHook, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettings, GeneratorTool } from '../../../../types';
import { useLibraryStore } from '../../../../stores/libraryStore';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { useFoldersTabLogic } from '../useFoldersTabLogic';
import { commands } from '../../../../bindings';
import { processNativePaths } from '../../../../services/importService';

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

const renderFoldersHook = (settings: AppSettings = baseSettings) => {
    const setSettings = vi.fn();
    const rendered = renderHook(() => useFoldersTabLogic({
        settings,
        setSettings,
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

describe('useFoldersTabLogic resource discovery', () => {
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
        useLibraryStore.setState({
            facetCacheVersion: 0,
            isScanningDiscovery: false,
            discoveryScanProgress: null,
            isImporting: false,
            importProgress: null,
            importAbortController: null,
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
            wasCancelled: true
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
        expect(addToastMock).toHaveBeenCalledWith('Import cancelled', 'info');
        expect(useLibraryStore.getState().importAbortController).toBeNull();

        updateFolderLastScannedSpy.mockRestore();
    });
});
