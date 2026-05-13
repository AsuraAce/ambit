import { renderHook, act, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useImportOps } from '../useImportOps';
import { useLibraryStore } from '../../stores/libraryStore';
import type { AIImage, AppSettings, MonitoredFolder } from '../../types';
import type { ImportResult } from '../../services/importService';
import type { Dispatch, SetStateAction } from 'react';

type ScanFileEntry = { path: string; modified: number; size: number };
type CommandOk<T> = { status: 'ok'; data: T };

const mocks = vi.hoisted(() => ({
    scanDirectorySince: vi.fn(),
    scanDirectoryWithStats: vi.fn(),
    processNativePaths: vi.fn(),
    processWebFiles: vi.fn(),
    processFoldersUnified: vi.fn(),
    getThumbnailDir: vi.fn(),
    addToast: vi.fn(),
    refreshHiddenAvailability: vi.fn(),
    refreshMetadata: vi.fn()
}));

vi.mock('../../bindings', () => ({
    commands: {
        scanDirectorySince: mocks.scanDirectorySince,
        scanDirectoryWithStats: mocks.scanDirectoryWithStats
    }
}));

vi.mock('../../services/importService', () => ({
    processNativePaths: mocks.processNativePaths,
    processWebFiles: mocks.processWebFiles,
    processFoldersUnified: mocks.processFoldersUnified
}));

vi.mock('../../services/thumbnailService', () => ({
    getThumbnailDir: mocks.getThumbnailDir
}));

vi.mock('../../contexts/SearchContext', () => ({
    useSearch: () => ({
        refreshHiddenAvailability: mocks.refreshHiddenAvailability,
        refreshMetadata: mocks.refreshMetadata
    })
}));

vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mocks.addToast
    })
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

const emptyImportResult = (wasCancelled = false): ImportResult => ({
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
    wasCancelled
});

const importResult = (overrides: Partial<ImportResult> = {}): ImportResult => {
    const base = emptyImportResult();
    return {
        ...base,
        ...overrides,
        stats: {
            ...base.stats,
            ...overrides.stats
        }
    };
};

const importedImage = (id: string): AIImage => ({ id } as AIImage);

describe('useImportOps', () => {
    const settings = {
        theme: 'dark',
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        maskedKeywords: [],
        maskingMode: 'blur',
        enableAI: false,
        hasCompletedOnboarding: true
    } as AppSettings;

    const renderImportOps = () => {
        const setImages = vi.fn() as Dispatch<SetStateAction<AIImage[]>>;
        return renderHook(() => useImportOps({
            images: [],
            setImages,
            refreshCollections: vi.fn().mockResolvedValue(undefined),
            settings
        }));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useLibraryStore.setState({
            isImporting: false,
            importProgress: null,
            importAbortController: null
        });
        mocks.getThumbnailDir.mockResolvedValue('C:/thumbs');
        mocks.processNativePaths.mockResolvedValue(emptyImportResult());
        mocks.processFoldersUnified.mockResolvedValue(emptyImportResult());
    });

    it('shows a cancellation toast for manual path imports', async () => {
        mocks.processNativePaths.mockResolvedValueOnce(emptyImportResult(true));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportPaths(['C:/watch/new.png']);
        });

        expect(mocks.addToast).toHaveBeenCalledWith('Import cancelled', 'info');
    });

    it('keeps background path cancellation quiet', async () => {
        mocks.processNativePaths.mockResolvedValueOnce(emptyImportResult(true));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportPaths(['C:/watch/new.png'], undefined, { mode: 'background' });
        });

        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('keeps background folder cancellation quiet', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce(emptyImportResult(true));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch' }], { mode: 'background' });
        });

        expect(mocks.addToast).not.toHaveBeenCalled();
        expect(mocks.processFoldersUnified).toHaveBeenCalledWith(
            [{ path: 'C:/watch', variant: undefined }],
            expect.objectContaining({ isStartup: false })
        );
    });

    it('warns when a manual folder import has imported images and failed files', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce(importResult({
            images: [importedImage('C:/watch/imported.png')],
            stats: { processed: 2, imported: 1, skipped: 0, errors: 1 },
            failedPaths: ['C:/watch/failed.png']
        }));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch' }]);
        });

        expect(mocks.addToast).toHaveBeenCalledWith('Imported 1 images from 1 folder(s), but 1 file(s) failed', 'warning');
        expect(mocks.addToast).not.toHaveBeenCalledWith('Imported 1 images from 1 folder(s)', 'success');
    });

    it('shows success when a manual folder import has images and no failures', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce(importResult({
            images: [importedImage('C:/watch/imported.png')],
            stats: { processed: 1, imported: 1, skipped: 0, errors: 0 }
        }));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch' }]);
        });

        expect(mocks.addToast).toHaveBeenCalledWith('Imported 1 images from 1 folder(s)', 'success');
    });

    it('does not advance folder cursor when incremental resync is cancelled before a zero-file scan result', async () => {
        const scan = deferred<CommandOk<ScanFileEntry[]>>();
        mocks.scanDirectorySince.mockReturnValueOnce(scan.promise);
        const updateLastScanned = vi.fn();
        const folder: MonitoredFolder = {
            id: 'folder-1',
            path: 'C:/watch',
            isActive: true,
            imageCount: 0,
            lastScanned: 10
        };
        const { result } = renderImportOps();
        let resyncPromise!: Promise<{ newFiles: number; totalScanned: number }>;

        act(() => {
            resyncPromise = result.current.resyncFolder(folder, updateLastScanned);
        });
        await waitFor(() => {
            expect(useLibraryStore.getState().importAbortController).toBeInstanceOf(AbortController);
        });

        useLibraryStore.getState().importAbortController?.abort();
        scan.resolve({ status: 'ok', data: [] });

        await act(async () => {
            await resyncPromise;
        });

        expect(updateLastScanned).not.toHaveBeenCalled();
        expect(mocks.processNativePaths).not.toHaveBeenCalled();
    });

    it('does not start native import when resync is cancelled before a non-empty scan result returns', async () => {
        const scan = deferred<CommandOk<ScanFileEntry[]>>();
        mocks.scanDirectorySince.mockReturnValueOnce(scan.promise);
        const updateLastScanned = vi.fn();
        const folder: MonitoredFolder = {
            id: 'folder-1',
            path: 'C:/watch',
            isActive: true,
            imageCount: 0,
            lastScanned: 10
        };
        const { result } = renderImportOps();
        let resyncPromise!: Promise<{ newFiles: number; totalScanned: number }>;

        act(() => {
            resyncPromise = result.current.resyncFolder(folder, updateLastScanned);
        });
        await waitFor(() => {
            expect(useLibraryStore.getState().importAbortController).toBeInstanceOf(AbortController);
        });

        useLibraryStore.getState().importAbortController?.abort();
        scan.resolve({
            status: 'ok',
            data: [{ path: 'C:/watch/new.png', modified: 100, size: 10 }]
        });

        await act(async () => {
            await resyncPromise;
        });

        expect(updateLastScanned).not.toHaveBeenCalled();
        expect(mocks.processNativePaths).not.toHaveBeenCalled();
        expect(mocks.getThumbnailDir).not.toHaveBeenCalled();
    });
});
