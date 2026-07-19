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
const getThumbnailDirMock = vi.hoisted(() => vi.fn());
const runtimeMocks = vi.hoisted(() => ({ browserMockMode: false }));
const dialogOpenMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/runtime', () => ({
    isBrowserMockMode: () => runtimeMocks.browserMockMode,
    isTauriRuntime: () => false,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: dialogOpenMock }));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

vi.mock('../../../../services/importService', () => ({
    processNativePaths: vi.fn(),
}));

vi.mock('../../../../services/thumbnailService', () => ({
    getThumbnailDir: (...args: Parameters<typeof getThumbnailDirMock>) => getThumbnailDirMock(...args),
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        getImageCountForPathPrefix: vi.fn(),
        scanDirectorySince: vi.fn(),
        scanDirectoryWithStats: vi.fn(),
    },
}));

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

describe('useFoldersTabLogic', () => {
    const manualCancellationMessage = 'Import cancelled. Imported images were kept; rescan to continue.';

    beforeEach(() => {
        vi.clearAllMocks();
        addToastMock.mockReset();
        runtimeMocks.browserMockMode = false;
        dialogOpenMock.mockResolvedValue(null);
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

    it('does not advance a monitored folder cursor when incremental import is cancelled', async () => {
        const updateLastScannedMock = vi.fn();
        useLibraryStore.setState({ importAbortController: null });
        const updateFolderLastScannedSpy = vi
            .spyOn(useSettingsStore.getState(), 'updateFolderLastScanned')
            .mockImplementation(updateLastScannedMock);
        vi.mocked(commands.scanDirectorySince).mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'D:/AmbitFixtures/Comfy/output/new.png', modified: 100, size: 10 }]
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
                    path: 'D:/AmbitFixtures/Comfy/output',
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
            await result.current.handleRescan('folder-1', 'D:/AmbitFixtures/Comfy/output', GeneratorTool.COMFYUI, false);
        });

        expect(processNativePaths).toHaveBeenCalledWith(
            ['D:/AmbitFixtures/Comfy/output/new.png'],
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
            data: [{ path: 'D:/AmbitFixtures/Comfy/output/new.png', modified: 100, size: 10 }]
        });
        const settings = {
            ...baseSettings,
            monitoredFolders: [
                {
                    id: 'folder-1',
                    path: 'D:/AmbitFixtures/Comfy/output',
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
            await result.current.handleRescan('folder-1', 'D:/AmbitFixtures/Comfy/output', GeneratorTool.COMFYUI, false);
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
                result.current.setNewFolderPath('D:\\AmbitFixtures\\Cancelled');
            });

            act(() => {
                result.current.handleAddFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
            });

            await act(async () => {
                await vi.advanceTimersByTimeAsync(500);
            });

            expect(onScanFolder).toHaveBeenCalledWith([{ path: 'D:/AmbitFixtures/Cancelled', variant: GeneratorTool.UNKNOWN }]);
            const addUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
            const addedSettings = addUpdate(baseSettings);
            const finalizeUpdate = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
            const finalSettings = finalizeUpdate(addedSettings);

            expect(finalSettings.monitoredFolders[0]).toMatchObject({
                path: 'D:/AmbitFixtures/Cancelled',
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
                completedSourcePaths: ['D:/AmbitFixtures/Done'],
                cancelledSourcePaths: ['D:/AmbitFixtures/Cancel']
            }));
            const { result, setSettings } = renderFoldersHook(baseSettings, onScanFolder);

            act(() => {
                result.current.setNewFolderPath('D:\\AmbitFixtures\\Done');
            });
            act(() => {
                result.current.handleAddFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
            });
            act(() => {
                result.current.setNewFolderPath('D:\\AmbitFixtures\\Cancel');
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
                { path: 'D:/AmbitFixtures/Done', variant: GeneratorTool.UNKNOWN },
                { path: 'D:/AmbitFixtures/Cancel', variant: GeneratorTool.UNKNOWN }
            ]);

            const addDone = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
            const addCancel = setSettings.mock.calls[1][0] as (previous: AppSettings) => AppSettings;
            const finalizeUpdate = setSettings.mock.calls[2][0] as (previous: AppSettings) => AppSettings;
            const finalSettings = finalizeUpdate(addCancel(addDone(baseSettings)));

            expect(finalSettings.monitoredFolders.find(folder => folder.path === 'D:/AmbitFixtures/Done')).toMatchObject({
                path: 'D:/AmbitFixtures/Done',
                initialScanPending: false,
                initialScanCancelled: false,
                lastScanned: expect.any(Number)
            });
            expect(finalSettings.monitoredFolders.find(folder => folder.path === 'D:/AmbitFixtures/Cancel')).toMatchObject({
                path: 'D:/AmbitFixtures/Cancel',
                initialScanPending: false,
                initialScanCancelled: true
            });
            expect(finalSettings.monitoredFolders.find(folder => folder.path === 'D:/AmbitFixtures/Cancel')?.lastScanned).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps added-folder partial failures retryable without marking cancellation', async () => {
        vi.useFakeTimers();
        try {
            const onScanFolder = vi.fn().mockResolvedValue(emptyImportResult({
                stats: { processed: 1, imported: 0, skipped: 0, errors: 1 },
                failedPaths: ['D:/AmbitFixtures/Partial/bad.png']
            }));
            const { result, setSettings } = renderFoldersHook(baseSettings, onScanFolder);

            act(() => {
                result.current.setNewFolderPath('D:\\AmbitFixtures\\Partial');
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
                path: 'D:/AmbitFixtures/Partial',
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
            path: 'D:/AmbitFixtures/Cancelled',
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
            await result.current.handleRescan('folder-1', 'D:/AmbitFixtures/Cancelled', GeneratorTool.COMFYUI, false);
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
            path: 'D:/AmbitFixtures/Cancelled',
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
            cancelledSourcePaths: ['D:/AmbitFixtures/Cancelled']
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
            await result.current.handleRescan('folder-1', 'D:/AmbitFixtures/Cancelled', GeneratorTool.COMFYUI, false);
        });

        const updatedFolder = useSettingsStore.getState().settings.monitoredFolders[0];
        expect(updatedFolder.lastScanned).toBeUndefined();
        expect(updatedFolder.initialScanPending).toBe(false);
        expect(updatedFolder.initialScanCancelled).toBe(true);
    });

    it('makes failed manual rescan retryable without advancing the cursor', async () => {
        const folder = {
            id: 'folder-1',
            path: 'D:/AmbitFixtures/Cancelled',
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
            failedPaths: ['D:/AmbitFixtures/Cancelled/bad.png']
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
            await result.current.handleRescan('folder-1', 'D:/AmbitFixtures/Cancelled', GeneratorTool.COMFYUI, false);
        });

        const updatedFolder = useSettingsStore.getState().settings.monitoredFolders[0];
        expect(updatedFolder.lastScanned).toBeUndefined();
        expect(updatedFolder.initialScanPending).toBe(false);
        expect(updatedFolder.initialScanCancelled).toBe(false);
        expect(addToastMock).toHaveBeenCalledWith('Rescan completed with import errors', 'warning');
    });

    it.each([
        ['C:/InvokeAI/outputs', GeneratorTool.INVOKEAI],
        ['C:/ComfyUI/output', GeneratorTool.COMFYUI],
        ['C:/stable-diffusion-webui/outputs', GeneratorTool.AUTOMATIC1111],
        ['C:/sd.next/images', GeneratorTool.SDNEXT],
        ['C:/Forge/output', GeneratorTool.FORGE],
        ['C:/Anapnoe/output', GeneratorTool.ANAPNOE],
        ['C:/Other/output', GeneratorTool.UNKNOWN],
    ] as const)('detects generator variants when adding %s', (path, variant) => {
        vi.useFakeTimers();
        const { result, setSettings } = renderFoldersHook();
        act(() => result.current.setNewFolderPath(path));
        act(() => result.current.handleAddFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
        const update = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(update(baseSettings).monitoredFolders[0]).toMatchObject({ path, variant, initialScanPending: true });
        vi.useRealTimers();
    });

    it('ignores blank and duplicate folders and removes monitored folders', () => {
        const existing = { id: 'one', path: 'C:/Watch', isActive: true, imageCount: 0 };
        const settings = { ...baseSettings, monitoredFolders: [existing] };
        const { result, setSettings } = renderFoldersHook(settings);
        act(() => result.current.handleAddFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
        expect(setSettings).not.toHaveBeenCalled();

        act(() => result.current.setNewFolderPath('C:\\Watch'));
        act(() => result.current.handleAddFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
        expect(addToastMock).toHaveBeenCalledWith('Folder is already monitored', 'info');

        act(() => result.current.removeFolder('one'));
        const remove = setSettings.mock.calls.at(-1)?.[0] as (previous: AppSettings) => AppSettings;
        expect(remove(settings).monitoredFolders).toEqual([]);
    });

    it('adds a managed InvokeAI output only when no overlapping folder exists', () => {
        const managed = renderFoldersHook({ ...baseSettings, invokeAiPath: 'D:/InvokeAI/databases' });
        expect(managed.result.current.combinedFolders[0]).toMatchObject({
            id: 'managed_invoke', path: 'D:/InvokeAI/outputs/images', variant: GeneratorTool.INVOKEAI, isManaged: true
        });
        managed.unmount();

        const overlapping = renderFoldersHook({
            ...baseSettings,
            invokeAiPath: 'D:/InvokeAI/databases/',
            monitoredFolders: [{ id: 'root', path: 'D:/InvokeAI', isActive: true, imageCount: 1 }]
        });
        expect(overlapping.result.current.combinedFolders).toHaveLength(1);
        expect(overlapping.result.current.combinedFolders[0].id).toBe('root');
    });

    it('detects missing variants and refreshes changed image counts', async () => {
        const settings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'one', path: 'C:/ComfyUI/output', isActive: true, imageCount: 1, variant: GeneratorTool.UNKNOWN }]
        };
        vi.mocked(commands.getImageCountForPathPrefix).mockResolvedValueOnce({ status: 'ok', data: 5 });
        const { setSettings } = renderFoldersHook(settings);
        await waitFor(() => expect(setSettings).toHaveBeenCalled());
        const update = setSettings.mock.calls.at(-1)?.[0] as (previous: AppSettings) => AppSettings;
        expect(update(settings).monitoredFolders[0]).toMatchObject({ variant: GeneratorTool.COMFYUI, imageCount: 5 });
        expect(update({ ...settings, monitoredFolders: [] })).toEqual({ ...settings, monitoredFolders: [] });
    });

    it('skips backend counts in browser mode and tolerates count failures', async () => {
        runtimeMocks.browserMockMode = true;
        const browserSettings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'one', path: 'C:/Forge/output', isActive: true, imageCount: 1 }]
        };
        const browser = renderFoldersHook(browserSettings);
        await waitFor(() => expect(browser.setSettings).toHaveBeenCalled());
        expect(commands.getImageCountForPathPrefix).not.toHaveBeenCalled();
        browser.unmount();

        runtimeMocks.browserMockMode = false;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(commands.getImageCountForPathPrefix).mockRejectedValueOnce(new Error('count failed'));
        renderFoldersHook({
            ...baseSettings,
            monitoredFolders: [{ id: 'two', path: 'C:/Other', isActive: true, imageCount: 1, variant: GeneratorTool.COMFYUI }]
        });
        await waitFor(() => expect(errorSpy).toHaveBeenCalled());
        errorSpy.mockRestore();
    });

    it('runs managed InvokeAI sync and reports managed failures', async () => {
        const onInvokeSync = vi.fn().mockResolvedValue(undefined);
        const success = renderHook(() => useFoldersTabLogic({ settings: baseSettings, setSettings: vi.fn(), onInvokeSync }));
        await act(async () => success.result.current.handleRescan('managed', 'D:/Invoke', GeneratorTool.INVOKEAI, true));
        expect(onInvokeSync).toHaveBeenCalled();
        expect(addToastMock).toHaveBeenCalledWith('InvokeAI database sync complete', 'success');
        success.unmount();

        onInvokeSync.mockRejectedValueOnce(new Error('sync failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failure = renderHook(() => useFoldersTabLogic({ settings: baseSettings, setSettings: vi.fn(), onInvokeSync }));
        await act(async () => failure.result.current.handleRescan('managed', 'D:/Invoke', GeneratorTool.INVOKEAI, true));
        expect(addToastMock).toHaveBeenCalledWith('InvokeAI sync failed', 'error');
        errorSpy.mockRestore();
    });

    it('completes an incremental import and advances its cursor', async () => {
        const updateLastScanned = vi.spyOn(useSettingsStore.getState(), 'updateFolderLastScanned').mockImplementation(vi.fn());
        const settings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'one', path: 'C:/Watch', isActive: true, imageCount: 1, lastScanned: 10, variant: GeneratorTool.COMFYUI }]
        };
        vi.mocked(commands.scanDirectorySince).mockResolvedValueOnce({ status: 'ok', data: [{ path: 'C:/Watch/new.png', modified: 1, size: 1 }] });
        vi.mocked(processNativePaths).mockImplementationOnce(async (_paths, _thumbs, progress) => {
            progress?.(1, 1, 'done');
            return emptyImportResult({ images: [{ id: 'new' } as never], handledPaths: ['C:/Watch/new.png'] });
        });
        const { result } = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => result.current.handleRescan('one', 'C:/Watch', GeneratorTool.COMFYUI));
        expect(addToastMock).toHaveBeenCalledWith('Synced 1 new files', 'success');
        expect(updateLastScanned).toHaveBeenCalledWith('one', expect.any(Number));
        updateLastScanned.mockRestore();
    });

    it('repairs missed files and handles no-change rescans', async () => {
        const updateLastScanned = vi.spyOn(useSettingsStore.getState(), 'updateFolderLastScanned').mockImplementation(vi.fn());
        const settings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'one', path: 'C:/Watch', isActive: true, imageCount: 1, lastScanned: 10, variant: GeneratorTool.COMFYUI }]
        };
        vi.mocked(commands.scanDirectorySince).mockResolvedValue({ status: 'ok', data: [] });
        vi.mocked(commands.scanDirectoryWithStats).mockResolvedValueOnce({
            status: 'ok', data: [{ path: 'a', modified: 1, size: 1 }, { path: 'b', modified: 1, size: 1 }]
        });
        vi.mocked(processNativePaths).mockResolvedValueOnce(emptyImportResult({ images: [{ id: 'new' } as never] }));
        const repair = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => repair.result.current.handleRescan('one', 'C:/Watch', GeneratorTool.COMFYUI));
        expect(addToastMock).toHaveBeenCalledWith('Repair scan imported 1 missing files', 'success');
        repair.unmount();

        vi.mocked(commands.scanDirectoryWithStats).mockResolvedValueOnce({ status: 'ok', data: [{ path: 'a', modified: 1, size: 1 }] });
        const noChange = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => noChange.result.current.handleRescan('one', 'C:/Watch', GeneratorTool.COMFYUI));
        expect(addToastMock).toHaveBeenCalledWith('No changes detected', 'info');
        updateLastScanned.mockRestore();
    });

    it('browses for a folder and falls back to the hidden input on dialog failure', async () => {
        dialogOpenMock.mockResolvedValueOnce('C:\\Picked');
        const success = renderFoldersHook();
        await act(async () => success.result.current.handleBrowse());
        expect(success.result.current.newFolderPath).toBe('C:/Picked');
        success.unmount();

        dialogOpenMock.mockRejectedValueOnce(new Error('dialog failed'));
        const fallback = renderFoldersHook();
        const click = vi.fn();
        Object.defineProperty(fallback.result.current.fileInputRef, 'current', { configurable: true, value: { click } });
        await act(async () => fallback.result.current.handleBrowse());
        expect(click).toHaveBeenCalled();
    });

    it('keeps unaffected folders unchanged while applying fetched updates', async () => {
        const settings = {
            ...baseSettings,
            monitoredFolders: [
                { id: 'changed', path: 'C:/ComfyUI', isActive: true, imageCount: 1, variant: GeneratorTool.UNKNOWN },
                { id: 'same', path: 'C:/Stable', isActive: true, imageCount: 2, variant: GeneratorTool.COMFYUI }
            ]
        };
        vi.mocked(commands.getImageCountForPathPrefix)
            .mockResolvedValueOnce({ status: 'ok', data: 3 })
            .mockResolvedValueOnce({ status: 'ok', data: 2 });
        const { setSettings } = renderFoldersHook(settings);
        await waitFor(() => expect(setSettings).toHaveBeenCalled());
        const update = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        const next = update(settings);
        expect(next.monitoredFolders[1]).toBe(settings.monitoredFolders[1]);
        expect(update({ ...settings, monitoredFolders: settings.monitoredFolders.slice(1) })).toEqual({ ...settings, monitoredFolders: settings.monitoredFolders.slice(1) });
    });

    it('recognizes a monitored parent of the InvokeAI root', () => {
        const { result } = renderFoldersHook({
            ...baseSettings,
            invokeAiPath: 'D:/InvokeAI/databases',
            monitoredFolders: [{ id: 'parent', path: 'D:/', isActive: true, imageCount: 1 }]
        });
        expect(result.current.combinedFolders).toHaveLength(1);
    });

    it('keeps the incremental cursor when changed files partially fail', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const updateLastScanned = vi.spyOn(useSettingsStore.getState(), 'updateFolderLastScanned').mockImplementation(vi.fn());
        const settings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'one', path: 'C:/Watch', isActive: true, imageCount: 1, lastScanned: 10 }]
        };
        vi.mocked(commands.scanDirectorySince).mockResolvedValueOnce({ status: 'ok', data: [{ path: 'bad', modified: 1, size: 1 }] });
        vi.mocked(processNativePaths).mockResolvedValueOnce(emptyImportResult({ failedPaths: ['bad'] }));
        const { result } = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => result.current.handleRescan('one', 'C:/Watch'));
        expect(updateLastScanned).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 file(s) failed'));
        warnSpy.mockRestore();
        updateLastScanned.mockRestore();
    });

    it('handles repair contention, cancellation, empty success, and partial failure', async () => {
        const settings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'one', path: 'C:/Watch', isActive: true, imageCount: 0, lastScanned: 10 }]
        };
        vi.mocked(commands.scanDirectorySince).mockResolvedValue({ status: 'ok', data: [] });
        vi.mocked(commands.scanDirectoryWithStats).mockResolvedValue({ status: 'ok', data: [{ path: 'a', modified: 1, size: 1 }] });

        useLibraryStore.getState().beginImportRun({ owner: 'busy', abortController: null });
        const busy = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => busy.result.current.handleRescan('one', 'C:/Watch'));
        expect(addToastMock).toHaveBeenCalledWith('Import already in progress', 'info');
        busy.unmount();
        useLibraryStore.getState().finishImportRun(useLibraryStore.getState().importRunId!);

        vi.mocked(processNativePaths).mockImplementationOnce(async (_paths, _thumbs, progress) => {
            progress?.(1, 1, 'done');
            return emptyImportResult({ wasCancelled: true });
        });
        const cancelled = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => cancelled.result.current.handleRescan('one', 'C:/Watch'));
        expect(addToastMock).toHaveBeenCalledWith(manualCancellationMessage, 'info');
        cancelled.unmount();

        vi.mocked(processNativePaths).mockResolvedValueOnce(emptyImportResult());
        const empty = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => empty.result.current.handleRescan('one', 'C:/Watch'));
        expect(addToastMock).toHaveBeenCalledWith('Repair scan found no additional importable files', 'info');
        empty.unmount();

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.mocked(processNativePaths).mockResolvedValueOnce(emptyImportResult({ failedPaths: ['a'] }));
        const partial = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => partial.result.current.handleRescan('one', 'C:/Watch'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 repair file(s) failed'));
        warnSpy.mockRestore();
    });

    it('warns when a full rescan does not start', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const settings = { ...baseSettings, monitoredFolders: [{ id: 'one', path: 'C:/Watch', isActive: true, imageCount: 0 }] };
        const onScanFolder = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder }));
        await act(async () => result.current.handleRescan('one', 'C:/Watch'));
        expect(addToastMock).toHaveBeenCalledWith('Rescan completed with import errors', 'warning');
        warnSpy.mockRestore();
    });

    it('finalizes successful and failed automatic folder scans', async () => {
        vi.useFakeTimers();
        const successScan = vi.fn().mockResolvedValue(emptyImportResult({ completedSourcePaths: ['C:/Success'] }));
        const success = renderFoldersHook(baseSettings, successScan);
        act(() => success.result.current.setNewFolderPath('C:/Success'));
        act(() => success.result.current.handleAddFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
        await act(async () => vi.advanceTimersByTimeAsync(500));
        const added = (success.setSettings.mock.calls[0][0] as (value: AppSettings) => AppSettings)(baseSettings);
        const completed = (success.setSettings.mock.calls[1][0] as (value: AppSettings) => AppSettings)(added);
        expect(completed.monitoredFolders[0]).toMatchObject({ initialScanPending: false, lastScanned: expect.any(Number) });
        success.unmount();

        const failedScan = vi.fn().mockRejectedValue(new Error('scan failed'));
        const failure = renderFoldersHook(baseSettings, failedScan);
        act(() => failure.result.current.setNewFolderPath('C:/Failure'));
        act(() => failure.result.current.handleAddFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(addToastMock).toHaveBeenCalledWith('Folder scan failed', 'error');
        const failureAdded = (failure.setSettings.mock.calls[0][0] as (value: AppSettings) => AppSettings)(baseSettings);
        const failureFinal = (failure.setSettings.mock.calls[1][0] as (value: AppSettings) => AppSettings)(failureAdded);
        expect(failureFinal.monitoredFolders[0]).toMatchObject({ initialScanPending: false, initialScanCancelled: false });
        vi.useRealTimers();
    });

    it('returns from an automatic scan timer without a scan callback and accepts a cancelled browse', async () => {
        vi.useFakeTimers();
        const noScan = renderFoldersHook();
        act(() => noScan.result.current.setNewFolderPath('C:/NoScan'));
        act(() => noScan.result.current.handleAddFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(addToastMock).toHaveBeenCalledWith('Added folder: C:/NoScan', 'success');
        vi.useRealTimers();

        dialogOpenMock.mockResolvedValueOnce(null);
        const browse = renderFoldersHook();
        await act(async () => browse.result.current.handleBrowse());
        expect(browse.result.current.newFolderPath).toBe('');
    });

    it('keeps an unknown detected variant while updating its count', async () => {
        const settings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'unknown', path: 'C:/Other', isActive: true, imageCount: 1, variant: GeneratorTool.UNKNOWN }]
        };
        vi.mocked(commands.getImageCountForPathPrefix).mockResolvedValueOnce({ status: 'ok', data: 2 });
        const { setSettings } = renderFoldersHook(settings);
        await waitFor(() => expect(setSettings).toHaveBeenCalled());
        const update = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(update(settings).monitoredFolders[0]).toMatchObject({ variant: GeneratorTool.UNKNOWN, imageCount: 2 });
    });

    it('skips a managed scan without handlers and reports non-managed scan failures', async () => {
        const managed = renderHook(() => useFoldersTabLogic({ settings: baseSettings, setSettings: vi.fn() }));
        await act(async () => managed.result.current.handleRescan('managed', 'D:/Invoke', GeneratorTool.INVOKEAI, true));
        expect(addToastMock).not.toHaveBeenCalledWith('InvokeAI database sync complete', 'success');
        managed.unmount();

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onScanFolder = vi.fn().mockRejectedValue(new Error('scan failed'));
        const ordinary = renderHook(() => useFoldersTabLogic({ settings: baseSettings, setSettings: vi.fn(), onScanFolder }));
        await act(async () => ordinary.result.current.handleRescan('one', 'C:/Watch'));
        expect(addToastMock).toHaveBeenCalledWith('Rescan failed', 'error');
        errorSpy.mockRestore();
    });

    it('uses zero as the repair known-count fallback', async () => {
        const updateLastScanned = vi.spyOn(useSettingsStore.getState(), 'updateFolderLastScanned').mockImplementation(vi.fn());
        const settings = {
            ...baseSettings,
            monitoredFolders: [{ id: 'one', path: 'C:/Watch', isActive: true, imageCount: 0, lastScanned: 10 }]
        };
        vi.mocked(commands.scanDirectorySince).mockResolvedValueOnce({ status: 'ok', data: [] });
        vi.mocked(commands.scanDirectoryWithStats).mockResolvedValueOnce({ status: 'ok', data: [] });
        const { result } = renderHook(() => useFoldersTabLogic({ settings, setSettings: vi.fn(), onScanFolder: vi.fn() }));
        await act(async () => result.current.handleRescan('one', 'C:/Watch'));
        expect(updateLastScanned).toHaveBeenCalled();
        updateLastScanned.mockRestore();
    });

    it('preserves unrelated folders in cancelled and partial manual rescan updates', async () => {
        const target = { id: 'one', path: 'C:/Watch', isActive: true, imageCount: 0 };
        const unrelated = { id: 'other', path: 'C:/Other', isActive: true, imageCount: 0, variant: GeneratorTool.UNKNOWN };
        const settings = { ...baseSettings, monitoredFolders: [target, unrelated] };
        const setSettings = vi.fn();
        const cancelledScan = vi.fn().mockResolvedValue(emptyImportResult({ wasCancelled: true }));
        const cancelled = renderHook(() => useFoldersTabLogic({ settings, setSettings, onScanFolder: cancelledScan }));
        await act(async () => cancelled.result.current.handleRescan('one', 'C:/Watch'));
        const cancelledUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(cancelledUpdate(settings).monitoredFolders[1]).toBe(unrelated);
        cancelled.unmount();

        setSettings.mockClear();
        const partialScan = vi.fn().mockResolvedValue(emptyImportResult({ failedPaths: ['bad'] }));
        const partial = renderHook(() => useFoldersTabLogic({ settings, setSettings, onScanFolder: partialScan }));
        await act(async () => partial.result.current.handleRescan('one', 'C:/Watch'));
        const partialUpdate = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(partialUpdate(settings).monitoredFolders[1]).toBe(unrelated);
    });

    it('preserves unrelated folders across every automatic scan finalizer', async () => {
        vi.useFakeTimers();
        const unrelated = { id: 'other', path: 'C:/Other', isActive: true, imageCount: 0, variant: GeneratorTool.UNKNOWN };
        const initial = { ...baseSettings, monitoredFolders: [unrelated] };

        const runCase = async (scanResult: ImportResult | Error) => {
            const scan = scanResult instanceof Error ? vi.fn().mockRejectedValue(scanResult) : vi.fn().mockResolvedValue(scanResult);
            const hook = renderFoldersHook(initial, scan);
            act(() => hook.result.current.setNewFolderPath('C:/Added'));
            act(() => hook.result.current.handleAddFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
            await act(async () => vi.advanceTimersByTimeAsync(500));
            const added = (hook.setSettings.mock.calls[0][0] as (value: AppSettings) => AppSettings)(initial);
            const finalized = (hook.setSettings.mock.calls[1][0] as (value: AppSettings) => AppSettings)(added);
            expect(finalized.monitoredFolders[0]).toBe(unrelated);
            hook.unmount();
        };

        await runCase(emptyImportResult());
        await runCase(emptyImportResult({ completedSourcePaths: ['C:/Different'] }));
        await runCase(emptyImportResult({ wasCancelled: true }));
        await runCase(emptyImportResult({ failedPaths: ['elsewhere'], completedSourcePaths: ['C:/Added'] }));
        await runCase(new Error('failed'));
        vi.useRealTimers();
    });
});
