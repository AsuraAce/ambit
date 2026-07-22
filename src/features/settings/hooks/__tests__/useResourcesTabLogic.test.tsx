import React from 'react';
import { act, renderHook } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettings } from '../../../../types';
import { commands, type ResolutionResult, type ThumbnailScanResult } from '../../../../bindings';
import { useLibraryStore, type SyncProgress } from '../../../../stores/libraryStore';
import { useResourcesTabLogic } from '../useResourcesTabLogic';

const addToastMock = vi.hoisted(() => vi.fn());
const scanResourceThumbnailsMock = vi.hoisted(() => vi.fn());
const refreshFacetCacheForResourcesStrictMock = vi.hoisted(() => vi.fn());
const rebuildFacetCacheIncrementalMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const runtimeMock = vi.hoisted(() => ({ browserMode: false }));
const libraryContextState = vi.hoisted(() => ({
    isResolvingModels: false,
    setIsResolvingModels: vi.fn(),
    modelResolutionProgress: null as SyncProgress | null,
    setModelResolutionProgress: vi.fn(),
    lastModelResolutionResult: null as { success: boolean; message: string } | null,
    setLastModelResolutionResult: vi.fn(),
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({
        addToast: addToastMock,
    }),
}));

vi.mock('../../../../contexts/LibraryContext', () => ({
    useLibraryContext: () => libraryContextState,
}));

vi.mock('../../../../services/importService', () => ({
    scanResourceThumbnails: (...args: Parameters<typeof scanResourceThumbnailsMock>) => scanResourceThumbnailsMock(...args),
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    refreshFacetCacheForResourcesStrict: (...args: Parameters<typeof refreshFacetCacheForResourcesStrictMock>) => refreshFacetCacheForResourcesStrictMock(...args),
    rebuildFacetCacheIncremental: (...args: Parameters<typeof rebuildFacetCacheIncrementalMock>) => rebuildFacetCacheIncrementalMock(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: (...args: Parameters<typeof openMock>) => openMock(...args),
}));

vi.mock('../../../../services/runtime', () => ({
    isBrowserMockMode: () => runtimeMock.browserMode,
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        resolveHashesOnline: vi.fn(),
        cancelModelResolution: vi.fn().mockResolvedValue(undefined),
        purgeResourceFolderAssets: vi.fn(),
    },
}));

const emptyResources = {
    checkpoints: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    controlNets: [],
    ipAdapters: [],
    tools: []
};

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

const scanResult: ThumbnailScanResult = {
    found: 2,
    updated: 1,
    cachedFiles: 1,
    newOrChangedFiles: 1,
    registeredModels: 1,
    resources: {
        ...emptyResources,
        loras: ['CinematicDetail']
    }
};

const resolutionResult: ResolutionResult = {
    resolvedCount: 2,
    harvestedCount: 0,
    failedCount: 0,
    namedFallbackCount: 0,
    unknownCount: 0
};

const renderResourcesHook = (settings: AppSettings = baseSettings) => {
    const setSettings = vi.fn();
    const rendered = renderHook(() => useResourcesTabLogic({
        settings,
        setSettings,
    }));

    return { ...rendered, setSettings };
};

const finishResourceScanTimer = async (promise: Promise<void>) => {
    await vi.advanceTimersByTimeAsync(1200);
    await promise;
};

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
};

describe('useResourcesTabLogic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addToastMock.mockReset();
        scanResourceThumbnailsMock.mockResolvedValue(scanResult);
        refreshFacetCacheForResourcesStrictMock.mockResolvedValue(2);
        rebuildFacetCacheIncrementalMock.mockResolvedValue(2);
        vi.mocked(commands.resolveHashesOnline).mockResolvedValue({ status: 'ok', data: resolutionResult });
        vi.mocked(commands.purgeResourceFolderAssets).mockResolvedValue({
            status: 'ok',
            data: {
                removedModels: 0,
                preservedModels: 0,
                removedScannedFiles: 0,
                refreshedFacets: 0,
                resources: emptyResources
            }
        });
        libraryContextState.isResolvingModels = false;
        libraryContextState.modelResolutionProgress = null;
        libraryContextState.lastModelResolutionResult = null;
        runtimeMock.browserMode = false;
        useLibraryStore.setState({
            facetCacheVersion: 0,
            isScanningDiscovery: false,
            discoveryScanProgress: null,
            isPopulatingThumbnails: false,
            syncStatus: 'idle',
            isImporting: false,
            isLiveSyncing: false,
            isRegeneratingThumbnails: false,
            isRefreshingMetadata: false,
            isScanningDuplicates: false,
            isScanningMissingFiles: false,
            isBackgroundHealingActive: false,
        });
    });

    it('browses resource folders into the resource path field', async () => {
        openMock.mockResolvedValue('D:\\AmbitFixtures\\Models');
        const { result } = renderResourcesHook();

        await act(async () => {
            await result.current.handleBrowseResource();
        });

        expect(result.current.newResourcePath).toBe('D:/AmbitFixtures/Models');
    });

    it('scans resources, refreshes touched resource facets, and increments the facet cache version', async () => {
        vi.useFakeTimers();
        try {
            const { result, setSettings } = renderResourcesHook();
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

            act(() => {
                result.current.setNewResourcePath('D:\\AmbitFixtures\\Models');
            });

            await act(async () => {
                const promise = result.current.handleAddResourceFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
                await finishResourceScanTimer(promise);
            });

            const updateSettings = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
            expect(updateSettings(baseSettings).resourceFolders).toEqual(['D:/AmbitFixtures/Models']);
            expect(scanResourceThumbnailsMock).toHaveBeenCalledWith(['D:/AmbitFixtures/Models']);
            expect(refreshFacetCacheForResourcesStrictMock).toHaveBeenCalledWith({
                ...emptyResources,
                loras: ['CinematicDetail']
            });
            expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
            expect(addToastMock).toHaveBeenCalledWith('Resource scan complete: 2 LoRA files found, 2 indexed', 'success');
            expect(useLibraryStore.getState().discoveryScanProgress).toBeNull();
            expect(useLibraryStore.getState().isScanningDiscovery).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('scan now scans all configured resource folders', async () => {
        vi.useFakeTimers();
        try {
            const settings = {
                ...baseSettings,
                resourceFolders: ['D:/AmbitFixtures/Checkpoints', 'D:/AmbitFixtures/Loras'],
            };
            const { result } = renderResourcesHook(settings);

            await act(async () => {
                const promise = result.current.handleScanNow();
                await finishResourceScanTimer(promise);
            });

            expect(scanResourceThumbnailsMock).toHaveBeenCalledWith(['D:/AmbitFixtures/Checkpoints', 'D:/AmbitFixtures/Loras']);
            expect(refreshFacetCacheForResourcesStrictMock).toHaveBeenCalledWith({
                ...emptyResources,
                loras: ['CinematicDetail']
            });
            expect(useLibraryStore.getState().discoveryScanProgress).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('skips broad resource indexing and warns when scan returns files without touched resources', async () => {
        vi.useFakeTimers();
        try {
            scanResourceThumbnailsMock.mockResolvedValueOnce({
                found: 2,
                updated: 0,
                cachedFiles: 0,
                newOrChangedFiles: 2,
                registeredModels: 0,
                resources: emptyResources
            } satisfies ThumbnailScanResult);
            const { result } = renderResourcesHook();

            act(() => {
                result.current.setNewResourcePath('D:\\AmbitFixtures\\Unknown');
            });

            await act(async () => {
                const promise = result.current.handleAddResourceFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
                await finishResourceScanTimer(promise);
            });

            expect(refreshFacetCacheForResourcesStrictMock).not.toHaveBeenCalled();
            expect(addToastMock).toHaveBeenCalledWith(
                'Resource scan found model files, but none could be classified for indexing',
                'warning'
            );
            expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('uses empty touched resources and suppresses classification warnings for an empty scan', async () => {
        vi.useFakeTimers();
        try {
            scanResourceThumbnailsMock.mockResolvedValueOnce({
                found: 0,
                updated: 0,
                cachedFiles: 0,
                newOrChangedFiles: 0,
                registeredModels: 0,
            } as ThumbnailScanResult);
            const { result } = renderResourcesHook({ ...baseSettings, resourceFolders: ['D:/Empty'] });
            const promise = result.current.handleScanNow();
            await finishResourceScanTimer(promise);
            expect(refreshFacetCacheForResourcesStrictMock).not.toHaveBeenCalled();
            expect(addToastMock).not.toHaveBeenCalledWith(expect.stringContaining('classified'), 'warning');
        } finally {
            vi.useRealTimers();
        }
    });

    it('purges only assets not covered by remaining resource folders before removing the path', async () => {
        const settings = {
            ...baseSettings,
            resourceFolders: ['D:/AmbitFixtures/Models', 'D:/AmbitFixtures/Models/loras'],
        };
        vi.mocked(commands.purgeResourceFolderAssets).mockResolvedValueOnce({
            status: 'ok',
            data: {
                removedModels: 2,
                preservedModels: 1,
                removedScannedFiles: 2,
                refreshedFacets: 2,
                resources: {
                    ...emptyResources,
                    checkpoints: ['FalsePositive']
                }
            }
        });
        const { result, setSettings } = renderResourcesHook(settings);

        await act(async () => {
            await result.current.handleRemoveResourceFolder('D:/AmbitFixtures/Models');
        });

        expect(commands.purgeResourceFolderAssets).toHaveBeenCalledWith(
            'D:/AmbitFixtures/Models',
            ['D:/AmbitFixtures/Models/loras']
        );
        expect(refreshFacetCacheForResourcesStrictMock).not.toHaveBeenCalled();
        const updateSettings = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
        expect(updateSettings(settings).resourceFolders).toEqual(['D:/AmbitFixtures/Models/loras']);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        expect(addToastMock).toHaveBeenCalledWith(
            'Removed resource folder: 2 local assets purged, 1 customized asset preserved',
            'success'
        );
    });

    it('keeps the resource folder and facet version unchanged when atomic purge fails', async () => {
        const settings = {
            ...baseSettings,
            resourceFolders: ['D:/AmbitFixtures/Models'],
        };
        vi.mocked(commands.purgeResourceFolderAssets).mockResolvedValueOnce({
            status: 'error',
            error: 'facet refresh failed'
        });
        const { result, setSettings } = renderResourcesHook(settings);

        await act(async () => {
            await result.current.handleRemoveResourceFolder('D:/AmbitFixtures/Models');
        });

        expect(setSettings).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(0);
        expect(result.current.removingResourcePath).toBeNull();
        expect(addToastMock).toHaveBeenCalledWith('Failed to remove resource folder', 'error');
    });

    it('serializes resource cleanup and blocks discovery actions until purge completes', async () => {
        const settings = {
            ...baseSettings,
            resourceFolders: ['D:/AmbitFixtures/Models', 'D:/AmbitFixtures/Models/loras'],
        };
        const purge = createDeferred<Awaited<ReturnType<typeof commands.purgeResourceFolderAssets>>>();
        vi.mocked(commands.purgeResourceFolderAssets).mockReturnValueOnce(purge.promise);
        const { result, setSettings } = renderResourcesHook(settings);

        act(() => {
            result.current.setNewResourcePath('D:/AmbitFixtures/Models/checkpoints');
        });

        let removalPromise!: Promise<void>;
        await act(async () => {
            removalPromise = result.current.handleRemoveResourceFolder('D:/AmbitFixtures/Models');
            await Promise.resolve();
        });

        expect(result.current.removingResourcePath).toBe('D:/AmbitFixtures/Models');

        await act(async () => {
            await result.current.handleBrowseResource();
            await result.current.handleAddResourceFolder({
                preventDefault: vi.fn(),
            } as unknown as React.FormEvent);
            await result.current.handleScanNow();
            await result.current.handleRemoveResourceFolder('D:/AmbitFixtures/Models/loras');
        });

        expect(openMock).not.toHaveBeenCalled();
        expect(scanResourceThumbnailsMock).not.toHaveBeenCalled();
        expect(commands.purgeResourceFolderAssets).toHaveBeenCalledTimes(1);
        expect(setSettings).not.toHaveBeenCalled();

        await act(async () => {
            purge.resolve({
                status: 'ok',
                data: {
                    removedModels: 1,
                    preservedModels: 0,
                    removedScannedFiles: 1,
                    refreshedFacets: 1,
                    resources: emptyResources
                }
            });
            await removalPromise;
        });

        expect(result.current.removingResourcePath).toBeNull();
        expect(setSettings).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
    });

    it('does not start folder removal while resource discovery is busy', async () => {
        useLibraryStore.setState({ isScanningDiscovery: true });
        const settings = {
            ...baseSettings,
            resourceFolders: ['D:/AmbitFixtures/Models'],
        };
        const { result, setSettings } = renderResourcesHook(settings);

        await act(async () => {
            await result.current.handleRemoveResourceFolder('D:/AmbitFixtures/Models');
        });

        expect(commands.purgeResourceFolderAssets).not.toHaveBeenCalled();
        expect(setSettings).not.toHaveBeenCalled();
    });

    it('keeps Resolve Online behind confirmation before calling CivitAI lookup', async () => {
        const { result } = renderResourcesHook();

        act(() => {
            result.current.requestResolveOnline();
        });

        expect(result.current.isResolveConfirmOpen).toBe(true);
        expect(commands.resolveHashesOnline).not.toHaveBeenCalled();

        await act(async () => {
            await result.current.confirmResolveOnline();
        });

        expect(commands.resolveHashesOnline).toHaveBeenCalledWith(false);
        expect(rebuildFacetCacheIncrementalMock).toHaveBeenCalledWith('checkpoints');
        expect(libraryContextState.setLastModelResolutionResult).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            message: expect.stringContaining('2 verified online')
        }));
    });

    it('blocks Resolve Online while library tasks are busy', () => {
        useLibraryStore.setState({ isImporting: true });
        const { result } = renderResourcesHook();

        expect(result.current.isHashResolutionBlocked).toBe(true);

        act(() => {
            result.current.requestResolveOnline();
        });

        expect(result.current.isResolveConfirmOpen).toBe(false);
        expect(addToastMock).toHaveBeenCalledWith('Wait for the current library task to finish before resolving hashes', 'warning');
        expect(commands.resolveHashesOnline).not.toHaveBeenCalled();
    });

    it('ignores cancelled browse selection and falls back to the file input on dialog failure', async () => {
        openMock.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('dialog unavailable'));
        const { result } = renderResourcesHook();
        const click = vi.fn();
        Object.defineProperty(result.current.resourceInputRef, 'current', { configurable: true, value: { click } });

        await act(async () => result.current.handleBrowseResource());
        expect(result.current.newResourcePath).toBe('');
        await act(async () => result.current.handleBrowseResource());
        expect(click).toHaveBeenCalledOnce();
    });

    it('ignores empty folder submissions and rejects normalized duplicates', async () => {
        const settings = { ...baseSettings, resourceFolders: ['D:/Models'] };
        const { result, setSettings } = renderResourcesHook(settings);
        const preventDefault = vi.fn();
        await act(async () => result.current.handleAddResourceFolder({ preventDefault } as unknown as React.FormEvent));
        expect(preventDefault).toHaveBeenCalled();
        expect(setSettings).not.toHaveBeenCalled();

        act(() => result.current.setNewResourcePath('D:\\Models'));
        await act(async () => result.current.handleAddResourceFolder({ preventDefault } as unknown as React.FormEvent));
        expect(addToastMock).toHaveBeenCalledWith('Resource folder is already added', 'info');
        expect(result.current.newResourcePath).toBe('');
    });

    it.each([
        [new Error('cancelled by user'), 'Resource scan cancelled', 'info'],
        ['scanner offline', 'Resource scan failed', 'error'],
    ] as const)('reports add-folder scan failures', async (error, message, level) => {
        scanResourceThumbnailsMock.mockRejectedValueOnce(error);
        const { result } = renderResourcesHook();
        act(() => result.current.setNewResourcePath('D:/Models'));
        await act(async () => result.current.handleAddResourceFolder({ preventDefault: vi.fn() } as unknown as React.FormEvent));
        expect(addToastMock).toHaveBeenCalledWith(message, level);
        expect(useLibraryStore.getState().isScanningDiscovery).toBe(false);
    });

    it('formats multi-resource scans without optional detail counters', async () => {
        vi.useFakeTimers();
        try {
            scanResourceThumbnailsMock.mockResolvedValueOnce({
                ...scanResult,
                cachedFiles: 0,
                newOrChangedFiles: 0,
                resources: { ...emptyResources, checkpoints: ['one'], loras: ['two'] }
            });
            refreshFacetCacheForResourcesStrictMock.mockResolvedValueOnce(0);
            const { result } = renderResourcesHook({ ...baseSettings, resourceFolders: ['D:/Models'] });
            const promise = result.current.handleScanNow();
            await finishResourceScanTimer(promise);
            expect(addToastMock).toHaveBeenCalledWith('Resource scan complete: 2 model files found', 'success');
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        [new Error('scan cancel requested'), 'Resource scan cancelled', 'info'],
        ['offline', 'Resource scan failed', 'error'],
    ] as const)('reports scan-now failures', async (error, message, level) => {
        scanResourceThumbnailsMock.mockRejectedValueOnce(error);
        const { result } = renderResourcesHook({ ...baseSettings, resourceFolders: ['D:/Models'] });
        await act(async () => result.current.handleScanNow());
        expect(addToastMock).toHaveBeenCalledWith(message, level);
    });

    it('does not scan without configured folders', async () => {
        const { result } = renderResourcesHook();
        await act(async () => result.current.handleScanNow());
        expect(scanResourceThumbnailsMock).not.toHaveBeenCalled();
    });

    it('removes folders in browser mode without invoking native cleanup', async () => {
        runtimeMock.browserMode = true;
        const settings = { ...baseSettings, resourceFolders: ['D:/Models'] };
        const { result, setSettings } = renderResourcesHook(settings);
        await act(async () => result.current.handleRemoveResourceFolder('D:/Models'));
        expect(commands.purgeResourceFolderAssets).not.toHaveBeenCalled();
        expect(setSettings).toHaveBeenCalledOnce();
        expect(addToastMock).toHaveBeenCalledWith('Removed resource folder', 'success');
    });

    it('formats a native purge with no indexed cleanup', async () => {
        const { result } = renderResourcesHook({ ...baseSettings, resourceFolders: ['D:/Models'] });
        await act(async () => result.current.handleRemoveResourceFolder('D:/Models'));
        expect(addToastMock).toHaveBeenCalledWith(
            'Removed resource folder; no indexed local assets needed cleanup',
            'success'
        );
    });

    it('removes safely when current and previous settings omit resource folders', async () => {
        runtimeMock.browserMode = true;
        const { result, setSettings } = renderResourcesHook(baseSettings);
        await act(async () => result.current.handleRemoveResourceFolder('D:/Models'));
        const updater = setSettings.mock.calls[0][0] as (settings: AppSettings) => AppSettings;
        expect(updater(baseSettings).resourceFolders).toEqual([]);
    });

    it.each([
        [{ removedModels: 1, preservedModels: 2 }, 'Removed resource folder: 1 local asset purged, 2 customized assets preserved'],
        [{ removedModels: 0, preservedModels: 1 }, 'Removed resource folder: 1 customized asset preserved'],
    ])('formats resource purge result counts', async (counts, expected) => {
        vi.mocked(commands.purgeResourceFolderAssets).mockResolvedValueOnce({
            status: 'ok',
            data: { ...counts, removedScannedFiles: 0, refreshedFacets: 0, resources: emptyResources }
        });
        const { result } = renderResourcesHook({ ...baseSettings, resourceFolders: ['D:/Models'] });
        await act(async () => result.current.handleRemoveResourceFolder('D:/Models'));
        expect(addToastMock).toHaveBeenCalledWith(expected, 'success');
    });

    it('blocks folder removal while thumbnails are populating', async () => {
        useLibraryStore.setState({ isPopulatingThumbnails: true });
        const { result } = renderResourcesHook({ ...baseSettings, resourceFolders: ['D:/Models'] });
        await act(async () => result.current.handleRemoveResourceFolder('D:/Models'));
        expect(commands.purgeResourceFolderAssets).not.toHaveBeenCalled();
    });

    it('clamps resolution progress and closes confirmation without resolving', () => {
        libraryContextState.modelResolutionProgress = { current: 150, total: 100, message: 'high' };
        const first = renderResourcesHook();
        expect(first.result.current.resolutionProgressPercent).toBe(100);
        act(() => first.result.current.requestResolveOnline());
        act(() => first.result.current.cancelResolveConfirmation());
        expect(first.result.current.isResolveConfirmOpen).toBe(false);
        first.unmount();

        libraryContextState.modelResolutionProgress = { current: -10, total: 100, message: 'low' };
        expect(renderResourcesHook().result.current.resolutionProgressPercent).toBe(0);
    });

    it.each([
        { syncStatus: 'syncing' as const },
        { isLiveSyncing: true },
        { isRegeneratingThumbnails: true },
        { isRefreshingMetadata: true },
        { isScanningDuplicates: true },
        { isScanningMissingFiles: true },
        { isPopulatingThumbnails: true },
        { isBackgroundHealingActive: true },
    ])('pauses confirmation when a library task starts after the prompt opens', async (busyState) => {
        const { result } = renderResourcesHook();
        act(() => result.current.requestResolveOnline());
        useLibraryStore.setState(busyState);
        await act(async () => result.current.confirmResolveOnline());
        expect(commands.resolveHashesOnline).not.toHaveBeenCalled();
        expect(libraryContextState.setLastModelResolutionResult).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('reports partial hash resolution', async () => {
        vi.mocked(commands.resolveHashesOnline).mockResolvedValueOnce({
            status: 'ok',
            data: { ...resolutionResult, failedCount: 2, unknownCount: 1 }
        });
        const { result } = renderResourcesHook();
        await act(async () => result.current.confirmResolveOnline());
        expect(addToastMock).toHaveBeenCalledWith('Lookup finished with 2 failed and 1 unknown', 'warning');
        expect(libraryContextState.setLastModelResolutionResult).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it.each([
        [new Error('cache failed'), 'cache failed'],
        ['cache unavailable', 'cache unavailable'],
    ])('keeps lookup results when UI refresh fails', async (error, expected) => {
        rebuildFacetCacheIncrementalMock.mockRejectedValueOnce(error);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { result } = renderResourcesHook();
        await act(async () => result.current.confirmResolveOnline());
        expect(libraryContextState.setLastModelResolutionResult).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining(expected)
        }));
        expect(addToastMock).toHaveBeenCalledWith('Lookup finished, but the UI refresh needs another pass', 'warning');
        consoleError.mockRestore();
    });

    it.each([
        [new Error('cancelled'), 'Resolution cancelled', 'info'],
        ['backend offline', 'Lookup failed', 'error'],
    ] as const)('reports hash resolution failures', async (error, message, level) => {
        vi.mocked(commands.resolveHashesOnline).mockRejectedValueOnce(error);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { result } = renderResourcesHook();
        await act(async () => result.current.confirmResolveOnline());
        expect(addToastMock).toHaveBeenCalledWith(message, level);
        expect(libraryContextState.setIsResolvingModels).toHaveBeenLastCalledWith(false);
        consoleError.mockRestore();
    });

    it('cancels model resolution and tolerates cancellation command failures', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { result } = renderResourcesHook();
        await act(async () => result.current.cancelResolveOnline());
        expect(commands.cancelModelResolution).toHaveBeenCalledOnce();
        vi.mocked(commands.cancelModelResolution).mockRejectedValueOnce(new Error('cancel failed'));
        await act(async () => result.current.cancelResolveOnline());
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
