import { renderHook, act, waitFor } from '../../test/testUtils';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { useImportOps } from '../useImportOps';
import { endOwnerSwitchForTest, OWNER_SWITCH_TOAST, startOwnerSwitchForTest } from '../../test/ownerSwitch';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSearchStore } from '../../stores/searchStore';
import { GeneratorTool } from '../../types';
import type { AIImage, AppSettings, MonitoredFolder } from '../../types';
import type { ImportResult } from '../../services/importService';
import type { Dispatch, SetStateAction } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { createDefaultFilters } from '../../utils/filterState';

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
    refreshHiddenAvailability: vi.fn().mockResolvedValue(undefined),
    refreshMetadata: vi.fn(),
    rebuildFacetCache: vi.fn(),
    syncCollectionImages: vi.fn(),
}));

vi.mock('../../bindings', () => ({
    commands: {
        scanDirectorySince: mocks.scanDirectorySince,
        scanDirectoryWithStats: mocks.scanDirectoryWithStats,
    },
}));

vi.mock('../../services/importService', () => ({
    processNativePaths: mocks.processNativePaths,
    processWebFiles: mocks.processWebFiles,
    processFoldersUnified: mocks.processFoldersUnified,
}));

vi.mock('../../services/thumbnailService', () => ({
    getThumbnailDir: mocks.getThumbnailDir,
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCache: mocks.rebuildFacetCache,
    syncCollectionImages: mocks.syncCollectionImages,
}));

vi.mock('../../contexts/SearchContext', () => ({
    useSearch: () => ({
        refreshHiddenAvailability: mocks.refreshHiddenAvailability,
        refreshMetadata: mocks.refreshMetadata,
    }),
}));

vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mocks.addToast,
    }),
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
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
        tools: [],
    },
    wasCancelled,
    completedSourcePaths: [],
    cancelledSourcePaths: [],
});

const importResult = (overrides: Partial<ImportResult> = {}): ImportResult => {
    const base = emptyImportResult();
    return {
        ...base,
        ...overrides,
        stats: {
            ...base.stats,
            ...overrides.stats,
        },
    };
};

const importedImage = (id: string, timestamp = 1000): AIImage => ({ id, timestamp }) as AIImage;

describe('useImportOps', () => {
    const manualCancellationMessage = 'Import cancelled. Imported items were kept; rescan to continue.';
    const settings = {
        theme: 'dark',
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        promptMaskingEnabled: true,
        maskedKeywords: [],
        maskingMode: 'blur',
        enableAI: false,
        hasCompletedOnboarding: true,
    } as AppSettings;

    const renderImportOps = (settingsOverrides: Partial<AppSettings> = {}, images: AIImage[] = []) => {
        const setImages = vi.fn<Dispatch<SetStateAction<AIImage[]>>>();
        const refreshCollections = vi.fn().mockResolvedValue(undefined);
        const hook = renderHook(() =>
            useImportOps({
                images,
                setImages,
                refreshCollections,
                settings: {
                    ...settings,
                    ...settingsOverrides,
                },
            })
        );
        return { ...hook, setImages, refreshCollections };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useSearchStore.setState({ filters: createDefaultFilters(), sortOption: 'date_desc' });
        useLibraryStore.setState({
            isImporting: false,
            importProgress: null,
            importAbortController: null,
            importRunId: null,
            importRunOwner: null,
            facetCacheVersion: 0,
        });
        mocks.getThumbnailDir.mockResolvedValue('C:/thumbs');
        mocks.processNativePaths.mockResolvedValue(emptyImportResult());
        mocks.processFoldersUnified.mockResolvedValue(emptyImportResult());
        mocks.rebuildFacetCache.mockResolvedValue(1);
        mocks.syncCollectionImages.mockResolvedValue(undefined);
    });

    it('shows a cancellation toast for manual path imports', async () => {
        mocks.processNativePaths.mockResolvedValueOnce(emptyImportResult(true));
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportPaths(['C:/watch/new.png']);
        });

        expect(mocks.addToast).toHaveBeenCalledWith(manualCancellationMessage, 'info');
    });

    it.each([
        ['videos', 'Importing videos...'],
        ['images', 'Importing images...'],
    ] as const)('names %s in the Activity Dock from the start of a picked-file import', async (mediaKind, expected) => {
        const messages: Array<string | undefined> = [];
        mocks.processNativePaths.mockImplementationOnce(async () => {
            messages.push(useLibraryStore.getState().importProgress?.message);
            return emptyImportResult();
        });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportPaths(['C:/picked/file'], undefined, { mediaKind });
        });

        expect(messages).toEqual([expected]);
    });

    it('uses a neutral noun for folder imports because the media kind is not known up front', async () => {
        const messages: Array<string | undefined> = [];
        mocks.processFoldersUnified.mockImplementationOnce(async (_folders, options) => {
            options.onProgress(5, 10, 'Extracting metadata...', { phase: 'importing', sourceCount: 1 });
            messages.push(useLibraryStore.getState().importProgress?.message);
            return emptyImportResult();
        });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch-a' }]);
        });

        expect(messages).toEqual(['Importing media from folder...']);
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

    it('logs and skips startup path imports when there are no paths to process', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportPaths([], undefined, { mode: 'startup' });
        });

        expect(infoSpy).toHaveBeenCalledWith('[ImportOps] Startup path import skipped because no paths were provided.');
        expect(mocks.getThumbnailDir).not.toHaveBeenCalled();
        expect(mocks.processNativePaths).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().importRunId).toBeNull();
        infoSpy.mockRestore();
    });

    it('logs and skips path imports when another import run is active', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const activeRunId = useLibraryStore.getState().beginImportRun({
            owner: 'other-import',
            abortController: new AbortController(),
            progress: { current: 1, total: 2, message: 'Existing import' },
        });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportPaths(['C:/watch/new.png']);
        });

        expect(infoSpy).toHaveBeenCalledWith('[ImportOps] Path import skipped because another import is active.', {
            mode: 'manual',
            pathCount: 1,
        });
        expect(activeRunId).toBeTruthy();
        expect(mocks.processNativePaths).not.toHaveBeenCalled();
        expect(mocks.addToast).toHaveBeenCalledWith('Import already in progress', 'info');
        infoSpy.mockRestore();
    });

    it('finalizes committed work before returning a cancelled partial folder result', async () => {
        const partialCancel = importResult({
            images: [importedImage('C:/watch-a/imported.png')],
            stats: { processed: 2, imported: 1, skipped: 0, errors: 0 },
            wasCancelled: true,
            completedSourcePaths: ['C:/watch-a'],
            cancelledSourcePaths: ['C:/watch-b'],
        });
        mocks.processFoldersUnified.mockResolvedValueOnce(partialCancel);
        const { result } = renderImportOps();
        let returned: ImportResult | void = undefined;

        await act(async () => {
            returned = await result.current.handleImportFolders([{ path: 'C:/watch-a' }, { path: 'C:/watch-b' }]);
        });

        expect(returned).toBe(partialCancel);
        expect(mocks.refreshMetadata).toHaveBeenCalledTimes(1);
        expect(mocks.rebuildFacetCache).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(1);
        expect(mocks.addToast).toHaveBeenCalledTimes(1);
        expect(mocks.addToast).toHaveBeenCalledWith(manualCancellationMessage, 'info');
        expect(mocks.addToast).not.toHaveBeenCalledWith(expect.stringContaining('Imported 1 items from 2 folder'), expect.any(String));
    });

    it('does not rebuild facets for a cancelled folder import with no inserted images', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce(
            importResult({
                wasCancelled: true,
                completedSourcePaths: [],
                cancelledSourcePaths: ['C:/watch'],
            })
        );
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
            cancelledSourcePaths: ['C:/watch-b'],
        });
        mocks.processFoldersUnified.mockResolvedValueOnce(partialCancel);
        mocks.rebuildFacetCache.mockRejectedValueOnce(new Error('facet rebuild failed'));
        const { result } = renderImportOps();
        let returned: ImportResult | void = undefined;

        await act(async () => {
            returned = await result.current.handleImportFolders([{ path: 'C:/watch-a' }, { path: 'C:/watch-b' }]);
        });

        expect(returned).toBeUndefined();
        expect(mocks.refreshMetadata).toHaveBeenCalledTimes(1);
        expect(mocks.rebuildFacetCache).toHaveBeenCalledTimes(1);
        expect(useLibraryStore.getState().facetCacheVersion).toBe(0);
        expect(mocks.addToast).toHaveBeenCalledWith('Import failed', 'error');
        expect(mocks.addToast).not.toHaveBeenCalledWith(manualCancellationMessage, 'info');
    });

    it('warns when a manual folder import has imported images and failed files', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce(
            importResult({
                images: [importedImage('C:/watch/imported.png')],
                stats: { processed: 2, imported: 1, skipped: 0, errors: 1 },
                failedPaths: ['C:/watch/failed.png'],
            })
        );
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch' }]);
        });

        expect(mocks.addToast).toHaveBeenCalledWith(
            'Imported 1 items (1 Generated, 0 Photos, 0 Other) from 1 folder(s), but 1 file(s) failed',
            'warning'
        );
        expect(mocks.addToast).not.toHaveBeenCalledWith('Imported 1 items (1 Generated, 0 Photos, 0 Other) from 1 folder(s)', 'success');
    });

    // Review of #402: a drive root cannot be registered, so every scan skips it. The
    // user must be told, even in a background import that imports nothing.
    it('warns about a skipped drive root even when nothing was imported', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce({ ...emptyImportResult(), unscannableRootPaths: ['D:/'] });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'D:\\' }], { mode: 'background' });
        });

        expect(mocks.addToast).toHaveBeenCalledWith(
            "Ambit can't scan a whole drive (D:/). In Settings → Connections → Folders, replace it with a subfolder.",
            'warning'
        );
    });

    it('shows success when a manual folder import has images and no failures', async () => {
        mocks.processFoldersUnified.mockResolvedValueOnce(
            importResult({
                images: [importedImage('C:/watch/imported.png')],
                stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
            })
        );
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch' }]);
        });

        expect(mocks.addToast).toHaveBeenCalledWith('Imported 1 items (1 Generated, 0 Photos, 0 Other) from 1 folder(s)', 'success');
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
                rawMessage: 'Extracting metadata...',
            });
            messages.push(useLibraryStore.getState().importProgress?.message);
            return emptyImportResult();
        });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch-a' }, { path: 'C:/watch-b' }]);
        });

        expect(messages).toEqual(['Scanning 2 folders...', 'Importing media from 2 folders...']);
        expect(messages).not.toContain('Extracting metadata...');
    });

    it('does not start a manual folder import while another import run is active', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const activeRunId = useLibraryStore.getState().beginImportRun({
            owner: 'other-import',
            abortController: new AbortController(),
            progress: { current: 1, total: 2, message: 'Existing import' },
        });
        const { result } = renderImportOps();

        await act(async () => {
            await result.current.handleImportFolders([{ path: 'C:/watch-a' }]);
        });

        expect(activeRunId).toBeTruthy();
        expect(mocks.processFoldersUnified).not.toHaveBeenCalled();
        expect(mocks.addToast).toHaveBeenCalledWith('Import already in progress', 'info');
        expect(infoSpy).toHaveBeenCalledWith('[ImportFolders] Folder import skipped because another import is active.', {
            mode: 'manual',
            folderCount: 1,
        });
        expect(useLibraryStore.getState().importRunId).toBe(activeRunId);
        expect(useLibraryStore.getState().importProgress?.message).toBe('Existing import');
        infoSpy.mockRestore();
    });

    it('uses stable Activity Dock messages for single-folder folder imports', async () => {
        const progressStates: Array<{ message?: string; detail?: string }> = [];
        const unsubscribe = useLibraryStore.subscribe((state) => {
            if (state.importProgress) {
                progressStates.push({
                    message: state.importProgress.message,
                    detail: state.importProgress.detail,
                });
            }
        });
        mocks.processFoldersUnified.mockImplementationOnce(async (_folders, options) => {
            options.onProgress(0, 0, 'Scanning C:/watch-a', {
                phase: 'scanning',
                sourceCount: 1,
                sourcePath: 'C:/watch-a',
            });
            options.onProgress(5, 10, 'Extracting metadata...', {
                phase: 'importing',
                sourceIndex: 1,
                sourceCount: 1,
                sourcePath: 'C:/watch-a',
                rawMessage: 'Extracting metadata...',
            });
            return importResult({
                images: [importedImage('C:/watch-a/imported.png')],
                stats: { processed: 10, imported: 1, skipped: 0, errors: 0 },
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

        expect(progressStates).toEqual(
            expect.arrayContaining([
                { message: 'Scanning folder...', detail: 'C:/watch-a' },
                { message: 'Importing media from folder...', detail: 'C:/watch-a' },
                { message: 'Finalizing import...', detail: 'C:/watch-a' },
            ])
        );
        expect(progressStates.some((progress) => progress.message === 'Extracting metadata...')).toBe(false);
        expect(progressStates.some((progress) => progress.message === 'Processing C:/watch-a/new.png')).toBe(false);
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
            lastScanned: 10,
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
            lastScanned: 10,
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
            data: [{ path: 'C:/watch/new.png', modified: 100, size: 10 }],
        });

        await act(async () => {
            await resyncPromise;
        });

        expect(updateLastScanned).not.toHaveBeenCalled();
        expect(mocks.processNativePaths).not.toHaveBeenCalled();
        expect(mocks.getThumbnailDir).not.toHaveBeenCalled();
    });

    it('imports browser files and commits only genuinely new images', async () => {
        const existing = importedImage('existing');
        const added = importedImage('added');
        mocks.processWebFiles.mockResolvedValueOnce(
            importResult({
                images: [existing, added],
                stats: { processed: 2, imported: 0, skipped: 1, errors: 1 },
            })
        );
        const { result, setImages, refreshCollections } = renderImportOps({}, [existing]);

        await act(async () => result.current.handleWebFiles([new File(['x'], 'image.png')]));

        expect(setImages).toHaveBeenCalledTimes(1);
        const update = setImages.mock.calls[0][0] as (value: AIImage[]) => AIImage[];
        expect(update([existing])).toEqual([added, existing]);
        expect(update([added, existing])).toEqual([added, existing]);
        expect(refreshCollections).toHaveBeenCalledTimes(1);
        expect(mocks.addToast).toHaveBeenCalledWith(
            'Imported 1 item (1 Generated, 0 Photos, 0 Other). (Skipped 1 duplicates) Skipped 1 unchanged or ignored file. 1 failed.',
            'info'
        );
        expect(mocks.refreshHiddenAvailability).toHaveBeenCalledTimes(1);
    });

    // #462: a small import used to prepend its images into whatever view was open, so they showed in a
    // collection or search they do not belong to, ahead of a collection's pinned images (#461).
    it.each([
        ['a collection', createDefaultFilters({ collectionId: 'collection-a' })],
        ['a search', createDefaultFilters({ searchQuery: 'sunset' })],
        ['a filter', createDefaultFilters({ favoritesOnly: true })],
    ])('refetches %s instead of adding a small import to its list', async (_view, filters) => {
        useSearchStore.setState({ filters });
        const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        mocks.processWebFiles.mockResolvedValueOnce(importResult({ images: [importedImage('added')] }));
        const { result, setImages, refreshCollections } = renderImportOps({}, [importedImage('existing')]);

        await act(async () => result.current.handleWebFiles([new File(['x'], 'image.png')]));

        expect(setImages).not.toHaveBeenCalled();
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['images'] });
        expect(refreshCollections).toHaveBeenCalledTimes(1);
        invalidateQueries.mockRestore();
    });

    it('refetches the view open when a small import finishes, not the one it started in', async () => {
        const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        const pending = deferred<ImportResult>();
        mocks.processWebFiles.mockReturnValueOnce(pending.promise);
        const { result, setImages } = renderImportOps({}, [importedImage('existing')]);

        let importDone!: Promise<void>;
        act(() => {
            importDone = result.current.handleWebFiles([new File(['x'], 'image.png')]);
        });
        useSearchStore.setState({ filters: createDefaultFilters({ collectionId: 'collection-a' }) });
        await act(async () => {
            pending.resolve(importResult({ images: [importedImage('added')] }));
            await importDone;
        });

        expect(setImages).not.toHaveBeenCalled();
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['images'] });
        invalidateQueries.mockRestore();
    });

    it('prepends a small import in the unfiltered Library without a refetch', async () => {
        const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        mocks.processWebFiles.mockResolvedValueOnce(importResult({ images: [importedImage('added')] }));
        const { result, setImages } = renderImportOps({}, [importedImage('existing')]);

        await act(async () => result.current.handleWebFiles([new File(['x'], 'image.png')]));

        const update = setImages.mock.calls[0][0] as (value: AIImage[]) => AIImage[];
        expect(update([importedImage('existing')]).map((image) => image.id)).toEqual(['added', 'existing']);
        expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['images'] });
        invalidateQueries.mockRestore();
    });

    // #476: the Library sorts by display date, so a small import belongs on top only under the
    // newest-first sort and when it is not older than the card on top; otherwise it would sit at the
    // top until the next refetch.
    it.each([['date_asc'], ['name_asc'], ['name_desc'], ['size_desc'], ['size_asc']] as const)(
        'refetches the unfiltered Library sorted by %s instead of prepending a small import',
        async (sortOption) => {
            useSearchStore.setState({ sortOption });
            const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
            mocks.processWebFiles.mockResolvedValueOnce(importResult({ images: [importedImage('added', 2000)] }));
            const { result, setImages, refreshCollections } = renderImportOps({}, [importedImage('existing')]);

            await act(async () => result.current.handleWebFiles([new File(['x'], 'image.png')]));

            expect(setImages).not.toHaveBeenCalled();
            expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['images'] });
            expect(refreshCollections).toHaveBeenCalledTimes(1);
            invalidateQueries.mockRestore();
        }
    );

    it('refetches the newest-first Library when a small import is older than the card on top', async () => {
        const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
        mocks.processWebFiles.mockResolvedValueOnce(
            importResult({ images: [importedImage('new-photo', 2000), importedImage('old-photo', 500)] })
        );
        const { result, setImages } = renderImportOps({}, [importedImage('existing', 1000)]);

        await act(async () => result.current.handleWebFiles([new File(['x'], 'image.png')]));

        expect(setImages).not.toHaveBeenCalled();
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['images'] });
        invalidateQueries.mockRestore();
    });

    it('prepends newer small imports newest first in the newest-first Library', async () => {
        mocks.processWebFiles.mockResolvedValueOnce(
            importResult({ images: [importedImage('newer', 2000), importedImage('newest', 3000)] })
        );
        const { result, setImages } = renderImportOps({}, [importedImage('existing', 1000)]);

        await act(async () => result.current.handleWebFiles([new File(['x'], 'image.png')]));

        const update = setImages.mock.calls[0][0] as (value: AIImage[]) => AIImage[];
        expect(update([importedImage('existing', 1000)]).map((image) => image.id)).toEqual(['newest', 'newer', 'existing']);
    });

    it('uses metadata refresh for imported batches reported by the backend', async () => {
        mocks.processWebFiles.mockResolvedValueOnce(
            importResult({
                images: [importedImage('added')],
                stats: { processed: 1, imported: 1, skipped: 0, errors: 0 },
            })
        );
        const { result, setImages, refreshCollections } = renderImportOps();

        await act(async () => result.current.handleWebFiles([new File(['x'], 'image.png')]));

        expect(mocks.refreshMetadata).toHaveBeenCalledTimes(1);
        expect(setImages).not.toHaveBeenCalled();
        expect(refreshCollections).not.toHaveBeenCalled();
        expect(mocks.addToast).toHaveBeenCalledWith('Imported 1 item (1 Generated, 0 Photos, 0 Other).', 'success');
    });

    it('reports duplicate-only, skipped-only, and failed-only web scans', async () => {
        const duplicate = importedImage('duplicate');
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const first = renderImportOps({}, [duplicate]);
        mocks.processWebFiles.mockResolvedValueOnce(importResult({ images: [duplicate] }));
        await act(async () => first.result.current.handleWebFiles([new File(['x'], 'duplicate.png')]));
        expect(consoleSpy).toHaveBeenCalledWith('Scan complete: 1 duplicates found.');
        first.unmount();

        const second = renderImportOps();
        mocks.processWebFiles.mockResolvedValueOnce(importResult({ stats: { processed: 2, imported: 0, skipped: 2, errors: 0 } }));
        await act(async () => second.result.current.handleWebFiles([new File(['x'], 'skip.png')]));
        expect(mocks.addToast).toHaveBeenCalledWith('Skipped 2 unchanged or ignored files.', 'info');
        second.unmount();

        const third = renderImportOps();
        mocks.processWebFiles.mockResolvedValueOnce(importResult({ stats: { processed: 1, imported: 0, skipped: 0, errors: 1 } }));
        await act(async () => third.result.current.handleWebFiles([new File(['x'], 'bad.png')]));
        expect(mocks.addToast).toHaveBeenCalledWith('Failed to load 1 files.', 'error');
        consoleSpy.mockRestore();
    });

    it('stops a file-picker import of browser files on Cancel and frees the import run', async () => {
        // A stuck web import left "Starting work..." with no working Cancel (#493).
        mocks.processWebFiles.mockImplementationOnce(
            (_files: File[], signal?: AbortSignal) =>
                new Promise<ImportResult>((resolve) => {
                    signal?.addEventListener('abort', () => resolve(emptyImportResult(true)));
                })
        );
        const { result } = renderImportOps();
        const input = document.createElement('input');
        Object.defineProperty(input, 'files', { value: [new File(['x'], 'web.png')] });

        let importDone!: Promise<void>;
        act(() => {
            importDone = result.current.importImages({ target: input } as unknown as React.ChangeEvent<HTMLInputElement>);
        });
        await waitFor(() => expect(useLibraryStore.getState().isImporting).toBe(true));
        act(() => useLibraryStore.getState().cancelImport());
        await act(async () => importDone);

        expect(mocks.addToast).toHaveBeenCalledWith(manualCancellationMessage, 'info');
        expect(useLibraryStore.getState().isImporting).toBe(false);
        expect(useLibraryStore.getState().importRunId).toBeNull();
        expect(input.value).toBe('');
    });

    it('turns away a file-picker import while another import runs, and reports one that fails', async () => {
        useLibraryStore.getState().beginImportRun({ owner: 'busy', abortController: null });
        const busy = renderImportOps();
        const busyInput = document.createElement('input');
        Object.defineProperty(busyInput, 'files', { value: [new File(['x'], 'web.png')] });
        await act(async () => busy.result.current.importImages({ target: busyInput } as unknown as React.ChangeEvent<HTMLInputElement>));
        expect(mocks.addToast).toHaveBeenCalledWith('Import already in progress', 'info');
        expect(mocks.processWebFiles).not.toHaveBeenCalled();
        busy.unmount();

        useLibraryStore.getState().finishImportRun(useLibraryStore.getState().importRunId!);
        mocks.processWebFiles.mockRejectedValueOnce(new Error('bad file'));
        const failed = renderImportOps();
        const failedInput = document.createElement('input');
        Object.defineProperty(failedInput, 'files', { value: [new File(['x'], 'bad.png')] });
        await act(async () =>
            failed.result.current.importImages({ target: failedInput } as unknown as React.ChangeEvent<HTMLInputElement>)
        );
        expect(mocks.addToast).toHaveBeenCalledWith('Import failed', 'error');
        expect(useLibraryStore.getState().isImporting).toBe(false);
    });

    it('ignores file-picker changes without a FileList', async () => {
        const { result } = renderImportOps();
        await act(async () => result.current.importImages({ target: { files: null } } as React.ChangeEvent<HTMLInputElement>));
        expect(mocks.processWebFiles).not.toHaveBeenCalled();
    });

    it('commits successful browser file-picker imports', async () => {
        mocks.processWebFiles.mockResolvedValueOnce(importResult({ images: [importedImage('browser')] }));
        const { result } = renderImportOps();
        const input = document.createElement('input');
        Object.defineProperty(input, 'files', { value: [new File(['x'], 'browser.png')] });

        await act(async () => result.current.importImages({ target: input } as unknown as React.ChangeEvent<HTMLInputElement>));

        expect(mocks.processWebFiles).toHaveBeenCalledTimes(1);
        expect(mocks.addToast).toHaveBeenCalledWith('Imported 1 item (1 Generated, 0 Photos, 0 Other).', 'success');
    });

    it('forwards external path progress and startup options without owning import state', async () => {
        const onProgress = vi.fn();
        mocks.processNativePaths.mockImplementationOnce(async (_paths, _thumbs, progress) => {
            progress(2, 4, 'Halfway', { phase: 'importing' });
            return emptyImportResult();
        });
        const { result } = renderImportOps();

        await act(async () =>
            result.current.handleImportPaths(['C:/image.png'], GeneratorTool.AUTOMATIC1111, {
                mode: 'startup',
                skipStateManagement: true,
                onProgress,
                forceRescan: true,
                waitForStableFiles: false,
                deferFacetCacheRefresh: true,
                abortSignal: new AbortController().signal,
            })
        );

        expect(onProgress).toHaveBeenCalledWith(2, 4, 'Halfway', { phase: 'importing' });
        expect(mocks.processNativePaths).toHaveBeenCalledWith(
            ['C:/image.png'],
            'C:/thumbs',
            expect.any(Function),
            GeneratorTool.AUTOMATIC1111,
            expect.any(AbortSignal),
            true,
            true,
            false,
            true
        );
        expect(useLibraryStore.getState().isImporting).toBe(false);
    });

    it('short-circuits empty startup paths and handles manual path errors by abort state', async () => {
        const empty = renderImportOps();
        await act(async () => empty.result.current.handleImportPaths([], undefined, { mode: 'startup' }));
        expect(mocks.getThumbnailDir).not.toHaveBeenCalled();
        empty.unmount();

        const aborted = new AbortController();
        aborted.abort();
        mocks.getThumbnailDir.mockRejectedValueOnce(new Error('cancelled'));
        const first = renderImportOps();
        await act(async () => first.result.current.handleImportPaths(['C:/x'], undefined, { abortSignal: aborted.signal }));
        expect(mocks.addToast).toHaveBeenCalledWith(manualCancellationMessage, 'info');
        first.unmount();

        mocks.getThumbnailDir.mockRejectedValueOnce(new Error('failed'));
        const second = renderImportOps();
        await act(async () => second.result.current.handleImportPaths(['C:/x']));
        expect(mocks.addToast).toHaveBeenCalledWith('Import failed or cancelled', 'error');
    });

    it('tracks managed path progress and keeps background contention quiet', async () => {
        mocks.processNativePaths.mockImplementationOnce(async (_paths, _thumbs, progress) => {
            progress(1, 2, 'Halfway');
            return importResult({ images: [importedImage('new')] });
        });
        const managed = renderImportOps();
        await act(async () => managed.result.current.handleImportPaths(['C:/new.png']));
        expect(mocks.addToast).toHaveBeenCalledWith('Imported 1 item (1 Generated, 0 Photos, 0 Other).', 'success');
        managed.unmount();

        useLibraryStore.getState().beginImportRun({ owner: 'busy', abortController: null });
        mocks.addToast.mockClear();
        const blocked = renderImportOps();
        await act(async () => blocked.result.current.handleImportPaths(['C:/new.png'], undefined, { mode: 'background' }));
        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('reports manual path contention and permits unmanaged progress without a listener', async () => {
        useLibraryStore.getState().beginImportRun({ owner: 'busy', abortController: null });
        const blocked = renderImportOps();
        await act(async () => blocked.result.current.handleImportPaths(['C:/new.png']));
        expect(mocks.addToast).toHaveBeenCalledWith('Import already in progress', 'info');
        blocked.unmount();
        useLibraryStore.getState().finishImportRun(useLibraryStore.getState().importRunId!);

        mocks.processNativePaths.mockImplementationOnce(async (_paths, _thumbs, progress) => {
            progress(0, 1, 'Starting');
            return emptyImportResult();
        });
        const unmanaged = renderImportOps();
        await act(async () => unmanaged.result.current.handleImportPaths(['C:/new.png'], undefined, { skipStateManagement: true }));
        expect(useLibraryStore.getState().isImporting).toBe(false);
    });

    it('keeps background path failures quiet', async () => {
        mocks.getThumbnailDir.mockRejectedValueOnce(new Error('failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { result } = renderImportOps();
        await act(async () => result.current.handleImportPaths(['C:/new.png'], undefined, { mode: 'background' }));
        expect(mocks.addToast).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('covers manual folder outcomes without imported images', async () => {
        const cases: Array<[ImportResult, string, 'info' | 'warning']> = [
            [importResult({ stats: { processed: 2, imported: 0, skipped: 2, errors: 0 } }), 'Scan complete. No new items found.', 'info'],
            [importResult({ stats: { processed: 1, imported: 0, skipped: 0, errors: 1 } }), 'Scan complete with 1 errors.', 'warning'],
            [emptyImportResult(), 'No supported media found in selected folders', 'info'],
        ];
        for (const [folderResult, message, level] of cases) {
            mocks.processFoldersUnified.mockResolvedValueOnce(folderResult);
            const hook = renderImportOps();
            await act(async () => hook.result.current.handleImportFolders([{ path: 'C:/watch' }]));
            expect(mocks.addToast).toHaveBeenCalledWith(message, level);
            hook.unmount();
        }
    });

    it('keeps startup folder failures quiet and marks startup scans', async () => {
        mocks.processFoldersUnified.mockRejectedValueOnce(new Error('failed'));
        const { result } = renderImportOps();
        await act(async () => result.current.handleImportFolders([], { mode: 'startup' }));
        expect(mocks.processFoldersUnified).toHaveBeenCalledWith([], expect.objectContaining({ isStartup: true }));
        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('keeps background folder completion and contention quiet', async () => {
        const completed = renderImportOps();
        await act(async () => completed.result.current.handleImportFolders([{ path: 'C:/watch' }], { mode: 'background' }));
        expect(mocks.addToast).not.toHaveBeenCalled();
        completed.unmount();

        useLibraryStore.getState().beginImportRun({ owner: 'busy', abortController: null });
        const blocked = renderImportOps();
        await act(async () => blocked.result.current.handleImportFolders([{ path: 'C:/watch' }], { mode: 'background' }));
        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('scans directories with compact commits and tolerates cancellation and errors', async () => {
        mocks.processNativePaths.mockResolvedValueOnce(importResult({ images: [importedImage('new')] }));
        const first = renderImportOps();
        await act(async () => first.result.current.scanDirectory('C:/scan'));
        expect(mocks.addToast).toHaveBeenCalledWith('Imported 1 new item (1 Generated, 0 Photos, 0 Other)', 'success');
        first.unmount();

        mocks.refreshHiddenAvailability.mockClear();
        mocks.processNativePaths.mockResolvedValueOnce(importResult({ images: [importedImage('cancelled')], wasCancelled: true }));
        const second = renderImportOps();
        await act(async () => second.result.current.scanDirectory('C:/scan'));
        expect(mocks.refreshHiddenAvailability).not.toHaveBeenCalled();
        second.unmount();

        mocks.getThumbnailDir.mockRejectedValueOnce(new Error('failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const third = renderImportOps();
        await act(async () => third.result.current.scanDirectory('C:/scan'));
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('reports directory scan progress and rejects a contended scan', async () => {
        mocks.processNativePaths.mockImplementationOnce(async (_paths, _thumbs, progress) => {
            progress(1, 2, 'Scanning');
            return emptyImportResult();
        });
        const first = renderImportOps();
        await act(async () => first.result.current.scanDirectory('C:/scan'));
        first.unmount();

        useLibraryStore.getState().beginImportRun({ owner: 'busy', abortController: null });
        const second = renderImportOps();
        await act(async () => second.result.current.scanDirectory('C:/scan'));
        expect(mocks.addToast).toHaveBeenCalledWith('Import already in progress', 'info');
    });

    it('resyncs full and incremental folders and preserves cancellation results', async () => {
        const updateLastScanned = vi.fn();
        mocks.scanDirectoryWithStats.mockResolvedValueOnce({ status: 'ok', data: [] });
        const full = renderImportOps();
        await act(async () =>
            full.result.current.resyncFolder({ id: 'full', path: 'C:/full', isActive: true, imageCount: 0 }, updateLastScanned)
        );
        expect(updateLastScanned).toHaveBeenCalledWith('full', expect.any(Number));
        full.unmount();

        mocks.scanDirectorySince.mockResolvedValueOnce({ status: 'ok', data: [{ path: 'C:/watch/new.png', modified: 1, size: 2 }] });
        mocks.processNativePaths.mockResolvedValueOnce(importResult({ images: [importedImage('new')] }));
        const incremental = renderImportOps();
        const completed = await act(async () =>
            incremental.result.current.resyncFolder(
                { id: 'inc', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1, variant: GeneratorTool.AUTOMATIC1111 },
                updateLastScanned
            )
        );
        expect(completed).toEqual({ newFiles: 1, totalScanned: 1 });
        expect(mocks.processNativePaths).toHaveBeenCalledWith(
            expect.any(Array),
            'C:/thumbs',
            expect.any(Function),
            GeneratorTool.AUTOMATIC1111,
            expect.any(AbortSignal),
            false,
            true
        );
        incremental.unmount();

        mocks.scanDirectorySince.mockResolvedValueOnce({ status: 'ok', data: [{ path: 'C:/watch/new.png', modified: 1, size: 2 }] });
        mocks.processNativePaths.mockResolvedValueOnce(importResult({ images: [importedImage('partial')], wasCancelled: true }));
        const cancelled = renderImportOps();
        const partial = await act(async () =>
            cancelled.result.current.resyncFolder(
                { id: 'cancel', path: 'C:/watch', isActive: true, imageCount: 0, lastScanned: 1 },
                updateLastScanned
            )
        );
        expect(partial).toEqual({ newFiles: 1, totalScanned: 1 });
    });

    it('rejects contended resyncs and rethrows scan failures after releasing ownership', async () => {
        useLibraryStore.getState().beginImportRun({ owner: 'busy', abortController: null });
        const busy = renderImportOps();
        const blocked = await act(async () =>
            busy.result.current.resyncFolder({ id: 'x', path: 'C:/x', isActive: true, imageCount: 0 }, vi.fn())
        );
        expect(blocked).toEqual({ newFiles: 0, totalScanned: 0 });
        expect(mocks.addToast).toHaveBeenCalledWith('Import already in progress', 'info');
        busy.unmount();
        useLibraryStore.getState().finishImportRun(useLibraryStore.getState().importRunId!);

        mocks.scanDirectoryWithStats.mockRejectedValueOnce(new Error('scan failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const failed = renderImportOps();
        await expect(failed.result.current.resyncFolder({ id: 'x', path: 'C:/x', isActive: true, imageCount: 0 }, vi.fn())).rejects.toThrow(
            'scan failed'
        );
        expect(useLibraryStore.getState().isImporting).toBe(false);
        errorSpy.mockRestore();
    });

    it('performs a non-empty full resync and forwards native progress', async () => {
        mocks.scanDirectoryWithStats.mockResolvedValueOnce({
            status: 'ok',
            data: [{ path: 'C:/full/image.png', modified: 1, size: 2 }],
        });
        mocks.processNativePaths.mockImplementationOnce(async (_paths, _thumbs, progress) => {
            progress(1, 1, 'Done');
            return importResult({ images: [importedImage('full')] });
        });
        const updateLastScanned = vi.fn();
        const { result } = renderImportOps();

        const scanResult = await act(async () =>
            result.current.resyncFolder({ id: 'full', path: 'C:/full', isActive: true, imageCount: 0 }, updateLastScanned)
        );

        expect(scanResult).toEqual({ newFiles: 1, totalScanned: 1 });
        expect(mocks.processNativePaths).toHaveBeenCalledWith(
            ['C:/full/image.png'],
            'C:/thumbs',
            expect.any(Function),
            undefined,
            expect.any(AbortSignal),
            false,
            false
        );
        expect(updateLastScanned).toHaveBeenCalledWith('full', expect.any(Number));
    });
    // #527: during a user owner switch the backend scope already belongs to the target owner. A user import waits for the switch; automatic imports keep the library current, so they keep running.
    describe('while an InvokeAI owner switch is pending', () => {
        beforeEach(startOwnerSwitchForTest);
        afterEach(endOwnerSwitchForTest);

        it('refuses a manual path import', async () => {
            const { result } = renderImportOps();

            await act(async () => {
                await result.current.handleImportPaths(['C:/picked/new.png']);
            });

            expect(mocks.addToast).toHaveBeenCalledWith(OWNER_SWITCH_TOAST, 'info');
            expect(mocks.processNativePaths).not.toHaveBeenCalled();
            expect(useLibraryStore.getState().isImporting).toBe(false);
        });

        it('refuses a manual folder import', async () => {
            const { result } = renderImportOps();

            await act(async () => {
                await result.current.handleImportFolders([{ path: 'C:/picked' }]);
            });

            expect(mocks.addToast).toHaveBeenCalledWith(OWNER_SWITCH_TOAST, 'info');
            expect(mocks.processFoldersUnified).not.toHaveBeenCalled();
        });

        it('refuses an in-memory file import', async () => {
            const { result } = renderImportOps();

            await act(async () => {
                await result.current.handleWebFiles([new File(['x'], 'a.png')]);
            });

            expect(mocks.addToast).toHaveBeenCalledWith(OWNER_SWITCH_TOAST, 'info');
            expect(mocks.processWebFiles).not.toHaveBeenCalled();
        });

        it('keeps running watcher path imports and folder imports', async () => {
            const { result } = renderImportOps();

            await act(async () => {
                await result.current.handleImportPaths(['C:/watch/new.png'], undefined, { mode: 'background' });
                await result.current.handleImportFolders([{ path: 'C:/watch' }], { mode: 'background' });
            });

            expect(mocks.processNativePaths).toHaveBeenCalled();
            expect(mocks.processFoldersUnified).toHaveBeenCalled();
            expect(mocks.addToast).not.toHaveBeenCalledWith(OWNER_SWITCH_TOAST, 'info');
        });
    });
});
