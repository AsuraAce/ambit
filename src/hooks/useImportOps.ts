import * as React from 'react';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AIImage, AppSettings, GeneratorTool, ImportMode, MonitoredFolder, SortOption, getDetectedSourceKind } from '../types';
import { getEffectiveDisplayTimestamp } from '../utils/imageDates';
import { useToast } from './useToast';
import { useLibraryStore } from '../stores/libraryStore';
import { useSearchStore } from '../stores/searchStore';
import { useSearch } from '../contexts/SearchContext';
import {
    processWebFiles,
    processNativePaths,
    processFoldersUnified,
    ImportResult,
    type ImportProgressCallback,
} from '../services/importService';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import {
    formatImportDatabaseWaitProgress,
    formatImportRefreshProgress,
    formatStableImportProgress,
    type ImportMediaKind,
} from '../utils/importProgress';
import { formatUnscannableRootsWarning } from '../utils/importSourceStatus';
import { getThumbnailDir } from '../services/thumbnailService';
import { ensureFolderAccessible } from '../services/assetScope';
import { rebuildFacetCache } from '../services/db/imageRepo';
import { hasActiveResultFilters } from '../utils/filterState';
import { refuseWriteDuringOwnerSwitch } from '../services/invoke/ownerSwitchGuard';
import { isOwnerSwitchPending, useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';

interface ImportOptions {
    mode?: ImportMode;
    skipStateManagement?: boolean;
    onProgress?: ImportProgressCallback;
    forceRescan?: boolean;
    waitForStableFiles?: boolean;
    deferFacetCacheRefresh?: boolean;
    abortSignal?: AbortSignal;
    /** The user's import choice; names the Activity Dock message from the start. Left unset when unknown. */
    mediaKind?: ImportMediaKind;
    /** Called once the files are written, before the library refresh; a caller that owns the run shows the refresh phase (#603). */
    onRefreshStart?: () => void;
}

type CommitToastMode = 'detailed' | 'compact' | 'none';

interface CommitImportOptions {
    toastMode?: CommitToastMode;
    /** Called right before the awaited library refresh, so the import run can show it instead of a finished count. */
    onRefreshStart?: () => void;
}

const MANUAL_IMPORT_CANCELLED_MESSAGE = 'Import cancelled. Imported items were kept; rescan to continue.';

export const formatDetectedImageKindCounts = (images: AIImage[]): string => {
    const counts = images.reduce(
        (result, image) => {
            result[getDetectedSourceKind(image)] += 1;
            return result;
        },
        { generated: 0, photograph: 0, other: 0 }
    );
    return `${counts.generated} Generated, ${counts.photograph} Photo${counts.photograph === 1 ? '' : 's'}, ${counts.other} Other`;
};

const sortNewestFirst = (images: AIImage[]): AIImage[] =>
    [...images].sort((a, b) => getEffectiveDisplayTimestamp(b) - getEffectiveDisplayTimestamp(a));

// The Library sorts by display date, not import time, so new images belong above the loaded list only
// under the newest-first sort and when none is older than the image now on top (#476).
const belongsOnTop = (newImages: AIImage[], loaded: AIImage[], sortOption: SortOption): boolean => {
    if (sortOption !== 'date_desc') return false;
    const top = loaded[0];
    if (!top) return true;
    const topTimestamp = getEffectiveDisplayTimestamp(top);
    return newImages.every((image) => getEffectiveDisplayTimestamp(image) >= topTimestamp);
};

interface UseImportOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollections: () => Promise<void>;
    settings: AppSettings;
}

export const useImportOps = ({ images, setImages, refreshCollections, settings: _settings }: UseImportOpsProps) => {
    const { addToast } = useToast();
    const { beginImportRun, setImportProgressForRun, finishImportRun } = useLibraryStore();
    const { refreshHiddenAvailability, refreshMetadata } = useSearch();
    const queryClient = useQueryClient();

    const commitImportResult = useCallback(
        async (result: ImportResult, options: CommitImportOptions = {}) => {
            const { images: newImages, stats } = result;
            const toastMode = options.toastMode ?? 'detailed';

            const uniqueNewImages = newImages.filter((newImg) => !images.some((existingImg) => existingImg.id === newImg.id));

            const dupeCount = newImages.length - uniqueNewImages.length;

            if (uniqueNewImages.length > 0) {
                options.onRefreshStart?.();
                if (uniqueNewImages.length > 500 || (result.stats.processed > 0 && result.stats.imported > 0)) {
                    console.log(`[ImportOps] Batch import detected. Triggering full metadata refresh.`);
                    await refreshMetadata();
                } else if (
                    // During a user owner switch (#527) the store keeps the previous owner's view, and an automatic
                    // import belongs to the target owner: refetch, which the store takes only after the swap.
                    isOwnerSwitchPending(useInvokeOwnerScopeStore.getState()) ||
                    hasActiveResultFilters(useSearchStore.getState().filters) ||
                    !belongsOnTop(uniqueNewImages, images, useSearchStore.getState().sortOption)
                ) {
                    // New images may not belong in the collection, search or filtered view open now (an import
                    // can outlast a view change), nor ahead of a collection's pinned images (#462), so that view
                    // refetches with its own filters and order. The refetch runs on, so the toast does not
                    // wait for every loaded page; refetch errors land in query state.
                    void queryClient.invalidateQueries({ queryKey: ['images'] });
                    await refreshCollections();
                } else {
                    setImages((prev) => {
                        const reallyUnique = uniqueNewImages.filter((n) => !prev.some((p) => p.id === n.id));
                        if (reallyUnique.length === 0) return prev;
                        return [...sortNewestFirst(reallyUnique), ...prev];
                    });
                    await refreshCollections();
                }

                let msg = `Imported ${uniqueNewImages.length} item${uniqueNewImages.length === 1 ? '' : 's'} (${formatDetectedImageKindCounts(uniqueNewImages)}).`;
                if (dupeCount > 0) msg += ` (Skipped ${dupeCount} duplicates)`;
                if (stats.skipped > 0) msg += ` Skipped ${stats.skipped} unchanged or ignored file${stats.skipped === 1 ? '' : 's'}.`;
                if (result.videoSummary?.rejected)
                    msg += ` Rejected ${result.videoSummary.rejected} invalid video${result.videoSummary.rejected === 1 ? '' : 's'}.`;
                if (result.videoSummary?.posterFailures)
                    msg += ` ${result.videoSummary.posterFailures} video${result.videoSummary.posterFailures === 1 ? '' : 's'} use a generic poster.`;
                if (stats.errors > 0) msg += ` ${stats.errors} failed.`;

                if (toastMode === 'detailed') {
                    addToast(msg, stats.errors > 0 ? 'info' : 'success');
                } else if (toastMode === 'compact') {
                    addToast(
                        `Imported ${uniqueNewImages.length} new item${uniqueNewImages.length === 1 ? '' : 's'} (${formatDetectedImageKindCounts(uniqueNewImages)})`,
                        'success'
                    );
                }

                refreshHiddenAvailability().catch((error) =>
                    console.error('[Import] Failed to refresh hidden-content availability', error)
                );
            } else {
                if (dupeCount > 0 && stats.skipped === 0 && stats.errors === 0) {
                    console.log(`Scan complete: ${dupeCount} duplicates found.`);
                } else {
                    if (toastMode === 'detailed' && stats.skipped > 0)
                        addToast(`Skipped ${stats.skipped} unchanged or ignored file${stats.skipped === 1 ? '' : 's'}.`, 'info');
                    if (toastMode === 'detailed' && result.videoSummary?.rejected)
                        addToast(
                            `Rejected ${result.videoSummary.rejected} invalid video${result.videoSummary.rejected === 1 ? '' : 's'}.`,
                            'warning'
                        );
                    if (toastMode === 'detailed' && stats.errors > 0) addToast(`Failed to load ${stats.errors} files.`, 'error');
                }
            }
        },
        [images, queryClient, setImages, addToast, refreshCollections, refreshMetadata, refreshHiddenAvailability]
    );

    // A filesystem root is skipped on every scan until the user replaces it, so say so in every mode.
    const reportUnscannableRoots = useCallback(
        (result: ImportResult) => {
            const roots = result.unscannableRootPaths ?? [];
            if (roots.length === 0) return;
            addToast(formatUnscannableRootsWarning(roots), 'warning');
        },
        [addToast]
    );

    // The browser mock mode's in-memory import, from the hidden file input or a drop. The
    // desktop app imports by native path and never reaches it (#493).
    const importWebFiles = useCallback(
        async (files: File[], owner: string) => {
            if (refuseWriteDuringOwnerSwitch(addToast)) return;
            const abortCtrl = new AbortController();
            const importRunId = beginImportRun({
                owner,
                abortController: abortCtrl,
            });
            if (!importRunId) {
                addToast('Import already in progress', 'info');
                return;
            }

            try {
                const result = await processWebFiles(files, abortCtrl.signal);
                if (result.wasCancelled) {
                    addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                    return;
                }
                await commitImportResult(result);
            } catch {
                addToast('Import failed', 'error');
            } finally {
                finishImportRun(importRunId);
            }
        },
        [beginImportRun, finishImportRun, commitImportResult, addToast]
    );

    const importImages = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            if (!e.target.files) return;
            if (refuseWriteDuringOwnerSwitch(addToast)) return;
            const files = Array.from(e.target.files);
            try {
                await importWebFiles(files, 'file-picker-import');
            } finally {
                e.target.value = '';
            }
        },
        [addToast, importWebFiles]
    );

    const handleWebFiles = useCallback((files: File[]) => importWebFiles(files, 'web-file-import'), [importWebFiles]);

    const handleImportPaths = useCallback(
        async (paths: string[], defaultTool?: GeneratorTool, options: ImportOptions = {}) => {
            const {
                mode = 'manual',
                skipStateManagement = false,
                onProgress: externalOnProgress,
                forceRescan = false,
                waitForStableFiles,
                deferFacetCacheRefresh = false,
                abortSignal: externalAbortSignal,
                mediaKind,
                onRefreshStart: externalOnRefreshStart,
            } = options;
            const isStartup = mode === 'startup';
            const isManual = mode === 'manual';
            // Automatic imports (startup, watcher) keep running; a user import waits for the switch.
            if (isManual && refuseWriteDuringOwnerSwitch(addToast)) return;
            const shouldWaitForStableFiles = waitForStableFiles ?? isStartup;

            if (paths.length === 0 && isStartup) {
                console.info('[ImportOps] Startup path import skipped because no paths were provided.');
                return;
            }

            const localAbortCtrl = externalAbortSignal ? null : new AbortController();
            const abortSignal = externalAbortSignal ?? localAbortCtrl?.signal;
            const importRunId = skipStateManagement
                ? null
                : beginImportRun({
                      owner: 'path-import',
                      abortController: localAbortCtrl,
                      progress: mediaKind ? { current: 0, total: paths.length, message: `Importing ${mediaKind}...` } : undefined,
                  });
            if (!skipStateManagement && !importRunId) {
                console.info('[ImportOps] Path import skipped because another import is active.', {
                    mode,
                    pathCount: paths.length,
                });
                if (isManual) addToast('Import already in progress', 'info');
                return;
            }

            try {
                const thumbDir = await getThumbnailDir();

                const onProgress: ImportProgressCallback = (current, total, message, meta) => {
                    if (externalOnProgress) {
                        externalOnProgress(current, total, message, meta);
                    } else if (importRunId) {
                        setImportProgressForRun(
                            importRunId,
                            meta?.waitingForDatabase ? formatImportDatabaseWaitProgress(current, total) : { current, total, message }
                        );
                    }
                };

                const result = await processNativePaths(
                    paths,
                    thumbDir,
                    onProgress,
                    defaultTool,
                    abortSignal,
                    isStartup,
                    forceRescan,
                    shouldWaitForStableFiles,
                    deferFacetCacheRefresh
                );
                reportUnscannableRoots(result);
                if (result.wasCancelled) {
                    if (isManual) addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                    return result;
                }
                await commitImportResult(result, {
                    toastMode: isManual ? 'detailed' : 'none',
                    onRefreshStart: () => {
                        if (externalOnRefreshStart) {
                            externalOnRefreshStart();
                        } else if (importRunId) {
                            setImportProgressForRun(importRunId, formatImportRefreshProgress());
                        }
                    },
                });
                return result;
            } catch (error) {
                console.error('Import error', error);
                if (isManual) {
                    addToast(
                        abortSignal?.aborted ? MANUAL_IMPORT_CANCELLED_MESSAGE : 'Import failed or cancelled',
                        abortSignal?.aborted ? 'info' : 'error'
                    );
                }
            } finally {
                if (importRunId) {
                    finishImportRun(importRunId);
                }
            }
        },
        [beginImportRun, setImportProgressForRun, finishImportRun, commitImportResult, addToast, reportUnscannableRoots]
    );

    const handleImportFolders = useCallback(
        async (folders: { path: string; variant?: string }[], options: { mode?: ImportMode } = {}) => {
            const mode = options.mode ?? 'manual';
            const isStartup = mode === 'startup';
            const isManual = mode === 'manual';
            if (isManual && refuseWriteDuringOwnerSwitch(addToast)) return;
            const abortCtrl = new AbortController();
            const initialProgress = formatStableImportProgress({
                current: 0,
                total: 0,
                sourceCount: folders.length,
                phase: 'scanning',
                sourcePath: folders[0]?.path,
            });
            const importRunId = beginImportRun({
                owner: 'folder-import',
                abortController: abortCtrl,
                progress: initialProgress,
            });
            if (!importRunId) {
                console.info('[ImportFolders] Folder import skipped because another import is active.', {
                    mode,
                    folderCount: folders.length,
                });
                if (isManual) addToast('Import already in progress', 'info');
                return;
            }

            try {
                const typedFolders = folders.map((f) => ({
                    path: f.path,
                    variant: f.variant as GeneratorTool | undefined,
                }));

                const result = await processFoldersUnified(typedFolders, {
                    onProgress: (current, total, _message, meta) => {
                        setImportProgressForRun(
                            importRunId,
                            meta?.waitingForDatabase
                                ? formatImportDatabaseWaitProgress(current, total)
                                : formatStableImportProgress({
                                      current,
                                      total,
                                      sourceCount: folders.length,
                                      phase: meta?.phase === 'scanning' ? 'scanning' : total > 0 ? 'importing' : 'scanning',
                                      sourceIndex: meta?.sourceIndex,
                                      sourcePath: meta?.sourcePath ?? folders[0]?.path,
                                  })
                        );
                    },
                    abortSignal: abortCtrl.signal,
                    isStartup,
                    forceRescan: false,
                });
                reportUnscannableRoots(result);

                if (result.images.length > 0) {
                    setImportProgressForRun(
                        importRunId,
                        formatStableImportProgress({
                            current: result.stats.processed,
                            total: result.stats.processed,
                            sourceCount: folders.length,
                            phase: 'finalizing',
                            sourcePath: folders[0]?.path,
                        })
                    );
                    await commitImportResult(result, { toastMode: 'none' });
                    if (result.wasCancelled) {
                        await rebuildFacetCache();
                        useLibraryStore.getState().incrementFacetCacheVersion();
                    }
                }

                if (result.wasCancelled) {
                    if (isManual) addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                    return result;
                }

                if (isManual) {
                    const failedFileCount = result.failedPaths.length > 0 ? result.failedPaths.length : result.stats.errors;
                    if (result.images.length > 0 && failedFileCount > 0) {
                        addToast(
                            `Imported ${result.images.length} items (${formatDetectedImageKindCounts(result.images)}) from ${folders.length} folder(s), but ${failedFileCount} file(s) failed`,
                            'warning'
                        );
                    } else if (result.images.length > 0) {
                        addToast(
                            `Imported ${result.images.length} items (${formatDetectedImageKindCounts(result.images)}) from ${folders.length} folder(s)`,
                            'success'
                        );
                    } else if (result.stats.skipped > 0) {
                        addToast(`Scan complete. No new items found.`, 'info');
                    } else if (result.stats.errors > 0) {
                        addToast(`Scan complete with ${result.stats.errors} errors.`, 'warning');
                    } else {
                        addToast('No supported media found in selected folders', 'info');
                    }
                }
                return result;
            } catch (error) {
                console.error('[ImportFolders] Error:', error);
                if (isManual) addToast('Import failed', 'error');
            } finally {
                finishImportRun(importRunId);
            }
        },
        [beginImportRun, setImportProgressForRun, finishImportRun, addToast, commitImportResult, reportUnscannableRoots]
    );

    const scanDirectory = useCallback(
        async (dirPath: string) => {
            const abortCtrl = new AbortController();
            const importRunId = beginImportRun({
                owner: 'directory-scan',
                abortController: abortCtrl,
            });
            if (!importRunId) {
                addToast('Import already in progress', 'info');
                return;
            }

            try {
                const thumbDir = await getThumbnailDir();
                const result = await processNativePaths(
                    [dirPath],
                    thumbDir,
                    (current, total, message) => {
                        setImportProgressForRun(importRunId, { current, total, message });
                    },
                    undefined,
                    abortCtrl.signal,
                    false
                );
                reportUnscannableRoots(result);
                if (!result.wasCancelled && result.images.length > 0) {
                    await commitImportResult(result, {
                        toastMode: 'compact',
                        onRefreshStart: () => setImportProgressForRun(importRunId, formatImportRefreshProgress()),
                    });
                }
            } catch (e) {
                console.error(`Failed to scan directory ${dirPath}`, e);
            } finally {
                finishImportRun(importRunId);
            }
        },
        [beginImportRun, setImportProgressForRun, finishImportRun, commitImportResult, addToast, reportUnscannableRoots]
    );

    const resyncFolder = useCallback(
        async (
            folder: MonitoredFolder,
            updateLastScanned: (folderId: string, timestamp: number) => void
        ): Promise<{ newFiles: number; totalScanned: number }> => {
            const { path, variant, lastScanned, id } = folder;

            const abortCtrl = new AbortController();
            const importRunId = beginImportRun({
                owner: 'folder-resync',
                abortController: abortCtrl,
            });
            if (!importRunId) {
                addToast('Import already in progress', 'info');
                return { newFiles: 0, totalScanned: 0 };
            }

            try {
                let filesToScan: string[] = [];
                let isIncremental = false;
                // The scans below refuse a folder outside the scope; a just-added folder may not be registered yet.
                await ensureFolderAccessible(path);

                if (lastScanned && lastScanned > 0) {
                    console.log(`[Resync] Incremental scan for ${path} since ${new Date(lastScanned).toISOString()}`);
                    const newFiles = await unwrap(commands.scanDirectorySince(path, lastScanned));
                    filesToScan = newFiles.map((f) => f.path);
                    isIncremental = true;
                    console.log(`[Resync] Found ${filesToScan.length} modified files`);
                } else {
                    console.log(`[Resync] Full scan for ${path} (no previous timestamp)`);
                    const allFiles = await unwrap(commands.scanDirectoryWithStats(path));
                    filesToScan = allFiles.map((f) => f.path);
                    console.log(`[Resync] Found ${filesToScan.length} total files`);
                }

                if (abortCtrl.signal.aborted) {
                    return { newFiles: 0, totalScanned: filesToScan.length };
                }

                if (filesToScan.length === 0) {
                    setImportProgressForRun(importRunId, { current: 0, total: 0, message: 'No changes detected' });
                    updateLastScanned(id, Date.now());
                    return { newFiles: 0, totalScanned: 0 };
                }

                const scanTypeMsg = isIncremental ? 'Syncing new files' : 'Full scan';
                setImportProgressForRun(importRunId, { current: 0, total: filesToScan.length, message: `${scanTypeMsg}...` });

                const thumbDir = await getThumbnailDir();

                const result = await processNativePaths(
                    filesToScan,
                    thumbDir,
                    (current, total, message) => {
                        setImportProgressForRun(importRunId, { current, total, message });
                    },
                    variant,
                    abortCtrl.signal,
                    false,
                    isIncremental
                );

                if (!result.wasCancelled && result.images.length > 0) {
                    await commitImportResult(result, {
                        toastMode: 'compact',
                        onRefreshStart: () => setImportProgressForRun(importRunId, formatImportRefreshProgress()),
                    });
                }
                if (result.wasCancelled) {
                    return { newFiles: result.images.length, totalScanned: filesToScan.length };
                }
                updateLastScanned(id, Date.now());

                return { newFiles: result.images.length, totalScanned: filesToScan.length };
            } catch (e) {
                console.error(`[Resync] Failed for ${path}`, e);
                throw e;
            } finally {
                finishImportRun(importRunId);
            }
        },
        [beginImportRun, setImportProgressForRun, finishImportRun, commitImportResult, addToast]
    );

    return {
        importImages,
        handleImportPaths,
        handleImportFolders,
        handleWebFiles,
        scanDirectory,
        resyncFolder,
    };
};
