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

vi.mock('../../../../bindings', () => ({
    commands: {
        resolveHashesOnline: vi.fn(),
        cancelModelResolution: vi.fn().mockResolvedValue(undefined),
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

describe('useResourcesTabLogic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        addToastMock.mockReset();
        scanResourceThumbnailsMock.mockResolvedValue(scanResult);
        refreshFacetCacheForResourcesStrictMock.mockResolvedValue(2);
        rebuildFacetCacheIncrementalMock.mockResolvedValue(2);
        vi.mocked(commands.resolveHashesOnline).mockResolvedValue({ status: 'ok', data: resolutionResult });
        libraryContextState.isResolvingModels = false;
        libraryContextState.modelResolutionProgress = null;
        libraryContextState.lastModelResolutionResult = null;
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
        openMock.mockResolvedValue('D:\\AI\\Models');
        const { result } = renderResourcesHook();

        await act(async () => {
            await result.current.handleBrowseResource();
        });

        expect(result.current.newResourcePath).toBe('D:/AI/Models');
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
                result.current.setNewResourcePath('D:\\AI\\Models');
            });

            await act(async () => {
                const promise = result.current.handleAddResourceFolder({
                    preventDefault: vi.fn(),
                } as unknown as React.FormEvent);
                await finishResourceScanTimer(promise);
            });

            const updateSettings = setSettings.mock.calls[0][0] as (previous: AppSettings) => AppSettings;
            expect(updateSettings(baseSettings).resourceFolders).toEqual(['D:/AI/Models']);
            expect(scanResourceThumbnailsMock).toHaveBeenCalledWith(['D:/AI/Models']);
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
                resourceFolders: ['D:/AI/Checkpoints', 'D:/AI/Loras'],
            };
            const { result } = renderResourcesHook(settings);

            await act(async () => {
                const promise = result.current.handleScanNow();
                await finishResourceScanTimer(promise);
            });

            expect(scanResourceThumbnailsMock).toHaveBeenCalledWith(['D:/AI/Checkpoints', 'D:/AI/Loras']);
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
                result.current.setNewResourcePath('D:\\AI\\Unknown');
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
});
