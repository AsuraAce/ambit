import React from 'react';
import { act, renderHook } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettings, GeneratorTool } from '../../../../types';
import { useLibraryStore } from '../../../../stores/libraryStore';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { useFoldersTabLogic } from '../useFoldersTabLogic';
import { commands } from '../../../../bindings';
import { processNativePaths, type ImportResult } from '../../../../services/importService';

const addToastMock = vi.hoisted(() => vi.fn());
const getThumbnailDirMock = vi.hoisted(() => vi.fn());

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
});
