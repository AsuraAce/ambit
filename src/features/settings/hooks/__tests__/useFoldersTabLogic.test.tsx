import React from 'react';
import { act, renderHook, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettings } from '../../../../types';
import { useLibraryStore } from '../../../../stores/libraryStore';
import { useFoldersTabLogic } from '../useFoldersTabLogic';

const addToastMock = vi.hoisted(() => vi.fn());
const scanResourceThumbnailsMock = vi.hoisted(() => vi.fn());
const rebuildFacetCacheIncrementalBatchMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());

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

describe('useFoldersTabLogic resource discovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        scanResourceThumbnailsMock.mockResolvedValue({ found: 2, updated: 1 });
        rebuildFacetCacheIncrementalBatchMock.mockResolvedValue(2);
        useLibraryStore.setState({
            facetCacheVersion: 0,
            isScanningDiscovery: false,
            discoveryScanProgress: null,
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

    it('scans resources, rebuilds resource facets, and increments the facet cache version', async () => {
        const { result, setSettings } = renderFoldersHook();

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
        expect(rebuildFacetCacheIncrementalBatchMock).toHaveBeenCalledWith([
            'checkpoints',
            'loras',
            'embeddings',
            'hypernetworks',
            'controlNets',
            'ipAdapters',
        ]);

        await waitFor(() => {
            expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        });
    });
});
