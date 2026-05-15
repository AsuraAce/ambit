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
    refreshMetadata: vi.fn(),
    rebuildFacetCache: vi.fn()
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

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCache: mocks.rebuildFacetCache
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
    wasCancelled,
    completedSourcePaths: [],
    cancelledSourcePaths: []
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
    const manualCancellationMessage = 'Import cancelled. Imported images were kept; rescan to continue.';
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
            importAbortController: null,
            importRunId: null,
            importRunOwner: null,
            facetCacheVersion: 0
        });
        mocks.getThumbnailDir.mockResolvedValue('C:/thumbs');
        mocks.processNativePaths.mockResolvedValue(emptyImportResult());
        mocks.processFoldersUnified.mockResolvedValue(emptyImportResult());
        mocks.rebuildFacetCache.mockResolvedValue(1);
    });

    it('shows a cancellation toast for manual path imports', async () => {
        mocks.processNativePaths.mockResolvedValueOnce(emptyImportResult(true));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportPaths(['C:/watch/new.png']);
        });

        expect(mocks.addToast).toHaveBeenCalledWith(manualCancellationMessage, 'info');
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

    it('finalizes committed work before returning a cancelled partial folder result', async () => {
        const partialCancel = importResult({
            images: [importedImage('C:/watch-a/imported.png')],
            stats: { processed: 2, imported: 1, skipped: 0, errors: 0 },
            wasCancelled: true,
            completedSourcePaths: ['C:/watch-a'],
            cancelledSourcePaths: ['C:/watch-b']
        });
        mocks.processFoldersUnified.mockResolvedValueOnce(partialCancel);
        const { result } = renderImportOps();
        let returned: ImportResult | void = undefined;

        await act(async () => {
            returned = await result.current.handleImportFolders([
                { path: 'C:/watch-a' },
                { path: 'C:/watch-b' }
            ]);
        });

        expect(returned).toBe(partialCancel);
        expect(mocks.refreshMetadata).toHaveBeenCalledTimes(1);
        expect(mocks.rebuildFacetCache).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        expect(mocks.addToast).toHaveBeenCalledTimes(1);
        expect(mocks.addToast).toHaveBeenCalledWith(manualCancellationMessage, 'info');
        expect(mocks.addToast).not.toHaveBeenCalledWith(expect.stringContaining('Imported 1 images from 2 folder'), expect.any(String));
    });

    it('does not rebuild facets for a cancelled folder import with no inserted images', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce(importResult({
            wasCancelled: true,
            completedSourcePaths: [],
            cancelledSourcePaths: ['C:/watch']
        }));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch' }]);
        });

        expect(mocks.refreshMetadata).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCache).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().facetCacheVersion).toBe(0);
        expect(mocks.addToast).toHaveBeenCalledWith(manualCancellationMessage, 'info');
    });

    it('does not return source status when cancelled partial finalization fails', async () => {
        const partialCancel = importResult({
            images: [importedImage('C:/watch-a/imported.png')],
            stats: { processed: 2, imported: 1, skipped: 0, errors: 0 },
            wasCancelled: true,
            completedSourcePaths: ['C:/watch-a'],
            cancelledSourcePaths: ['C:/watch-b']
        });
        mocks.processFoldersUnified.mockResolvedValueOnce(partialCancel);
        mocks.rebuildFacetCache.mockRejectedValueOnce(new Error('facet rebuild failed'));
        const { result } = renderImportOps();
        let returned: ImportResult | void = undefined;

        await act(async () => {
            returned = await result.current.handleImportFolders([
                { path: 'C:/watch-a' },
                { path: 'C:/watch-b' }
            ]);
        });

        expect(returned).toBeUndefined();
        expect(mocks.refreshMetadata).toHaveBeenCalledTimes(1);
        expect(mocks.rebuildFacetCache).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(0);
        expect(mocks.addToast).toHaveBeenCalledWith('Import failed', 'error');
        expect(mocks.addToast).not.toHaveBeenCalledWith(manualCancellationMessage, 'info');
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

    it('uses aggregate Activity Dock messages for multi-folder imports', async () => {
        const messages: Array<string | undefined> = [];
        mocks.processFoldersUnified.mockImplementationOnce(async (_folders, options) => {
            options.onProgress(0, 0, 'Scanning C:/watch-a');
            messages.push(useLibraryStore.getState().importProgress?.message);
            options.onProgress(5, 10, 'Extracting metadata...', {
                phase: 'importing',
                sourceIndex: 1,
                sourceCount: 2,
                sourcePath: 'C:/watch-a',
                rawMessage: 'Extracting metadata...'
            });
            messages.push(useLibraryStore.getState().importProgress?.message);
            return emptyImportResult();
        });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([
                { path: 'C:/watch-a' },
                { path: 'C:/watch-b' }
            ]);
        });

        expect(messages).toEqual([
            'Scanning 2 folders...',
            'Importing images from 2 folders...'
        ]);
        expect(messages).not.toContain('Extracting metadata...');
    });

    it('does not start a manual folder import while another import run is active', async () => {
        const activeRunId = useLibraryStore.getState().beginImportRun({
            owner: 'other-import',
            abortController: new AbortController(),
            progress: { current: 1, total: 2, message: 'Existing import' }
        });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch-a' }]);
        });

        expect(activeRunId).toBeTruthy();
        expect(mocks.processFoldersUnified).not.toHaveBeenCalled();
        expect(mocks.addToast).toHaveBeenCalledWith('Import already in progress', 'info');
        expect(useLibraryStore.getState().importRunId).toBe(activeRunId);
        expect(useLibraryStore.getState().importProgress?.message).toBe('Existing import');
    });

    it('uses stable Activity Dock messages for single-folder folder imports', async () => {
        const progressStates: Array<{ message?: string; detail?: string }> = [];
        const unsubscribe = useLibraryStore.subscribe(state => {
            if (state.importProgress) {
                progressStates.push({
                    message: state.importProgress.message,
                    detail: state.importProgress.detail
                });
            }
        });
        mocks.processFoldersUnified.mockImplementationOnce(async (_folders, options) => {
            options.onProgress(0, 0, 'Scanning C:/watch-a', {
                phase: 'scanning',
                sourceCount: 1,
                sourcePath: 'C:/watch-a'
            });
            options.onProgress(5, 10, 'Extracting metadata...', {
                phase: 'importing',
                sourceIndex: 1,
                sourceCount: 1,
                sourcePath: 'C:/watch-a',
                rawMessage: 'Extracting metadata...'
            });
            return importResult({
                images: [importedImage('C:/watch-a/imported.png')],
                stats: { processed: 10, imported: 1, skipped: 0, errors: 0 }
            });
        });
        const { result } = renderImportOps();

        try {
            await act(async () => {
                await result.current.handleImportFolders([{ path: 'C:/watch-a' }]);
            });
        } finally {
            unsubscribe();
        }

        expect(progressStates).toEqual(expect.arrayContaining([
            { message: 'Scanning folder...', detail: 'C:/watch-a' },
            { message: 'Importing images from folder...', detail: 'C:/watch-a' },
            { message: 'Finalizing import...', detail: 'C:/watch-a' }
        ]));
        expect(progressStates.some(progress => progress.message === 'Extracting metadata...')).toBe(false);
        expect(progressStates.some(progress => progress.message === 'Processing C:/watch-a/new.png')).toBe(false);
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
