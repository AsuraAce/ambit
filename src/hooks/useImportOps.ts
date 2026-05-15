import * as React from 'react';
import { useCallback } from 'react';
import { AIImage, AppSettings, GeneratorTool, ImportMode, MonitoredFolder } from '../types';
import { useToast } from './useToast';
import { useLibraryStore } from '../stores/libraryStore';
import { useSearch } from '../contexts/SearchContext';
import { processWebFiles, processNativePaths, processFoldersUnified, ImportResult, type ImportProgressCallback } from '../services/importService';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { formatStableImportProgress } from '../utils/importProgress';

interface ImportOptions {
    mode?: ImportMode;
    skipStateManagement?: boolean;
    onProgress?: ImportProgressCallback;
    forceRescan?: boolean;
    waitForStableFiles?: boolean;
    deferFacetCacheRefresh?: boolean;
    abortSignal?: AbortSignal;
}

type CommitToastMode = 'detailed' | 'compact' | 'none';

interface CommitImportOptions {
    toastMode?: CommitToastMode;
}

const MANUAL_IMPORT_CANCELLED_MESSAGE = 'Import cancelled. Imported images were kept; rescan to continue.';

interface UseImportOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollections: () => Promise<void>;
    settings: AppSettings;
}

export const useImportOps = ({
    images,
    setImages,
    refreshCollections,
    settings
}: UseImportOpsProps) => {
    const { addToast } = useToast();
    const {
        beginImportRun,
        setImportProgressForRun,
        finishImportRun
    } = useLibraryStore();
    const { refreshHiddenAvailability, refreshMetadata } = useSearch();

    const extractNativePaths = useCallback((files: File[]): string[] => {
        return files
            .map(file => (file as File & { path?: string }).path)
            .filter((path): path is string => typeof path === 'string' && path.length > 0);
    }, []);

    const commitImportResult = useCallback(async (result: ImportResult, options: CommitImportOptions = {}) => {
        const { images: newImages, stats } = result;
        const toastMode = options.toastMode ?? 'detailed';

        const uniqueNewImages = newImages.filter(
            newImg => !images.some(existingImg => existingImg.id === newImg.id)
        );

        const dupeCount = newImages.length - uniqueNewImages.length;

        if (uniqueNewImages.length > 0) {
            if (uniqueNewImages.length > 500 || (result.stats.processed > 0 && result.stats.imported > 0)) {
                console.log(`[ImportOps] Batch import detected. Triggering full metadata refresh.`);
                await refreshMetadata();
            } else {
                setImages(prev => {
                    const reallyUnique = uniqueNewImages.filter(n => !prev.some(p => p.id === n.id));
                    if (reallyUnique.length === 0) return prev;
                    return [...reallyUnique, ...prev];
                });
                await refreshCollections();
            }

            let msg = `Imported ${uniqueNewImages.length} images.`;
            if (dupeCount > 0) msg += ` (Skipped ${dupeCount} duplicates)`;
            if (stats.skipped > 0) msg += ` Ignored ${stats.skipped} intermediate files.`;
            if (stats.errors > 0) msg += ` ${stats.errors} failed.`;

            if (toastMode === 'detailed') {
                addToast(msg, stats.errors > 0 ? 'info' : 'success');
            } else if (toastMode === 'compact') {
                addToast(`Imported ${uniqueNewImages.length} new images`, 'success');
            }

            refreshHiddenAvailability();
        } else {
            if (dupeCount > 0 && stats.skipped === 0 && stats.errors === 0) {
                console.log(`Scan complete: ${dupeCount} duplicates found.`);
            } else {
                if (toastMode === 'detailed' && stats.skipped > 0) addToast(`Ignored ${stats.skipped} intermediate files.`, 'info');
                if (toastMode === 'detailed' && stats.errors > 0) addToast(`Failed to load ${stats.errors} files.`, 'error');
            }
        }
    }, [images, setImages, addToast, refreshCollections, refreshMetadata, refreshHiddenAvailability]);

    const importImages = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files);
        const nativePaths = extractNativePaths(files);
        const abortCtrl = nativePaths.length === files.length && nativePaths.length > 0
            ? new AbortController()
            : null;
        const importRunId = beginImportRun({
            owner: 'file-picker-import',
            abortController: abortCtrl
        });
        if (!importRunId) {
            addToast('Import already in progress', 'info');
            if (e.target) e.target.value = "";
            return;
        }

        try {
            if (abortCtrl) {
                const { getThumbnailDir } = await import('../services/thumbnailService');
                const thumbDir = await getThumbnailDir();
                const result = await processNativePaths(nativePaths, thumbDir, (current, total, message) => {
                    setImportProgressForRun(importRunId, { current, total, message });
                }, undefined, abortCtrl.signal);
                if (result.wasCancelled) {
                    addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                    return;
                }
                await commitImportResult(result);
                return;
            }

            const result = await processWebFiles(files);
            await commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            finishImportRun(importRunId);
            if (e.target) e.target.value = "";
        }
    }, [beginImportRun, setImportProgressForRun, finishImportRun, extractNativePaths, commitImportResult, addToast]);

    const handleWebFiles = useCallback(async (files: File[]) => {
        const nativePaths = extractNativePaths(files);
        const abortCtrl = nativePaths.length === files.length && nativePaths.length > 0
            ? new AbortController()
            : null;
        const importRunId = beginImportRun({
            owner: 'web-file-import',
            abortController: abortCtrl
        });
        if (!importRunId) {
            addToast('Import already in progress', 'info');
            return;
        }

        try {
            if (abortCtrl) {
                const { getThumbnailDir } = await import('../services/thumbnailService');
                const thumbDir = await getThumbnailDir();
                const result = await processNativePaths(nativePaths, thumbDir, (current, total, message) => {
                    setImportProgressForRun(importRunId, { current, total, message });
                }, undefined, abortCtrl.signal);
                if (result.wasCancelled) {
                    addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                    return;
                }
                await commitImportResult(result);
                return;
            }

            const result = await processWebFiles(files);
            await commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            finishImportRun(importRunId);
        }
    }, [beginImportRun, setImportProgressForRun, finishImportRun, extractNativePaths, commitImportResult, addToast]);

    const handleImportPaths = useCallback(async (paths: string[], defaultTool?: GeneratorTool, options: ImportOptions = {}) => {
        const {
            mode = 'manual',
            skipStateManagement = false,
            onProgress: externalOnProgress,
            forceRescan = false,
            waitForStableFiles,
            deferFacetCacheRefresh = false,
            abortSignal: externalAbortSignal
        } = options;
        const isStartup = mode === 'startup';
        const isManual = mode === 'manual';
        const shouldWaitForStableFiles = waitForStableFiles ?? isStartup;

        if (paths.length === 0 && isStartup) return;

        const localAbortCtrl = externalAbortSignal ? null : new AbortController();
        const abortSignal = externalAbortSignal ?? localAbortCtrl?.signal;
        const importRunId = skipStateManagement
            ? null
            : beginImportRun({
                owner: 'path-import',
                abortController: localAbortCtrl
            });
        if (!skipStateManagement && !importRunId) {
            if (isManual) addToast('Import already in progress', 'info');
            return;
        }

        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();

            const onProgress: ImportProgressCallback = (current, total, message, meta) => {
                if (externalOnProgress) {
                    externalOnProgress(current, total, message, meta);
                } else if (importRunId) {
                    setImportProgressForRun(importRunId, { current, total, message });
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
            if (result.wasCancelled) {
                if (isManual) addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                return result;
            }
            await commitImportResult(result, { toastMode: isManual ? 'detailed' : 'none' });
            return result;
        } catch (error) {
            console.error("Import error", error);
            if (isManual) {
                addToast(abortSignal?.aborted ? MANUAL_IMPORT_CANCELLED_MESSAGE : 'Import failed or cancelled', abortSignal?.aborted ? 'info' : 'error');
            }
        } finally {
            if (importRunId) {
                finishImportRun(importRunId);
            }
        }
    }, [beginImportRun, setImportProgressForRun, finishImportRun, commitImportResult, addToast]);

    const handleImportFolders = useCallback(async (folders: { path: string, variant?: string }[], options: { mode?: ImportMode } = {}) => {
        const mode = options.mode ?? 'manual';
        const isStartup = mode === 'startup';
        const isManual = mode === 'manual';
        const abortCtrl = new AbortController();
        const initialProgress = formatStableImportProgress({
            current: 0,
            total: 0,
            sourceCount: folders.length,
            phase: 'scanning',
            sourcePath: folders[0]?.path
        });
        const importRunId = beginImportRun({
            owner: 'folder-import',
            abortController: abortCtrl,
            progress: initialProgress
        });
        if (!importRunId) {
            if (isManual) addToast('Import already in progress', 'info');
            return;
        }

        try {
            const typedFolders = folders.map(f => ({
                path: f.path,
                variant: f.variant as GeneratorTool | undefined
            }));

            const result = await processFoldersUnified(typedFolders, {
                onProgress: (current, total, _message, meta) => {
                    setImportProgressForRun(importRunId, formatStableImportProgress({
                        current,
                        total,
                        sourceCount: folders.length,
                        phase: meta?.phase === 'scanning' ? 'scanning' : (total > 0 ? 'importing' : 'scanning'),
                        sourceIndex: meta?.sourceIndex,
                        sourcePath: meta?.sourcePath ?? folders[0]?.path
                    }));
                },
                abortSignal: abortCtrl.signal,
                isStartup,
                forceRescan: false
            });

            if (result.images.length > 0) {
                setImportProgressForRun(importRunId, formatStableImportProgress({
                    current: result.stats.processed,
                    total: result.stats.processed,
                    sourceCount: folders.length,
                    phase: 'finalizing',
                    sourcePath: folders[0]?.path
                }));
                await commitImportResult(result, { toastMode: 'none' });
                if (result.wasCancelled) {
                    const { rebuildFacetCache } = await import('../services/db/imageRepo');
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
                    addToast(`Imported ${result.images.length} images from ${folders.length} folder(s), but ${failedFileCount} file(s) failed`, 'warning');
                } else if (result.images.length > 0) {
                    addToast(`Imported ${result.images.length} images from ${folders.length} folder(s)`, 'success');
                } else if (result.stats.skipped > 0) {
                    addToast(`Scan complete. No new images found.`, 'info');
                } else if (result.stats.errors > 0) {
                    addToast(`Scan complete with ${result.stats.errors} errors.`, 'warning');
                } else {
                    addToast('No images found in selected folders', 'info');
                }
            }
            return result;
        } catch (error) {
            console.error('[ImportFolders] Error:', error);
            if (isManual) addToast('Import failed', 'error');
        } finally {
            finishImportRun(importRunId);
        }
    }, [beginImportRun, setImportProgressForRun, finishImportRun, addToast, commitImportResult]);

    const scanDirectory = useCallback(async (dirPath: string) => {
        const abortCtrl = new AbortController();
        const importRunId = beginImportRun({
            owner: 'directory-scan',
            abortController: abortCtrl
        });
        if (!importRunId) {
            addToast('Import already in progress', 'info');
            return;
        }

        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();
            const result = await processNativePaths([dirPath], thumbDir, (current, total, message) => {
                setImportProgressForRun(importRunId, { current, total, message });
            }, undefined, abortCtrl.signal, false);
            if (!result.wasCancelled && result.images.length > 0) {
                await commitImportResult(result, { toastMode: 'compact' });
            }
        } catch (e) {
            console.error(`Failed to scan directory ${dirPath}`, e);
        } finally {
            finishImportRun(importRunId);
        }
    }, [beginImportRun, setImportProgressForRun, finishImportRun, commitImportResult, addToast]);

    const handleInvokeSync = useCallback(async () => {
        if (!settings.invokeAiPath) {
            addToast('InvokeAI not configured', 'error');
            return;
        }

        const abortCtrl = new AbortController();
        const importRunId = beginImportRun({
            owner: 'invoke-sync',
            abortController: abortCtrl
        });
        if (!importRunId) {
            addToast('Import already in progress', 'info');
            return;
        }

        try {
            const { syncImages } = await import('../services/invoke/syncService');
            const { rebuildFacetCache, syncCollectionImages } = await import('../services/db/imageRepo');

            const result = await syncImages(
                settings.invokeAiPath,
                (current, total, message) => {
                    setImportProgressForRun(importRunId, { current, total, message });
                },
                abortCtrl.signal,
                {
                    syncFavorites: true,
                    syncBoards: true,
                    importIntermediates: settings.importIntermediates ?? false,
                    starredAs: 'favorite',
                    afterTimestamp: 0
                }
            );

            if (abortCtrl.signal.aborted) {
                addToast('Import cancelled', 'info');
                return;
            }

            await syncCollectionImages();
            await rebuildFacetCache();
            await refreshCollections();

            addToast(`InvokeAI sync complete: ${result.imported} imported, ${result.updated} updated`, 'success');
        } catch (e) {
            console.error('InvokeAI sync failed', e);
            addToast(abortCtrl.signal.aborted ? 'Import cancelled' : 'InvokeAI sync failed', abortCtrl.signal.aborted ? 'info' : 'error');
        } finally {
            finishImportRun(importRunId);
        }
    }, [settings.invokeAiPath, settings.importIntermediates, addToast, beginImportRun, setImportProgressForRun, finishImportRun, refreshCollections]);

    const resyncFolder = useCallback(async (
        folder: MonitoredFolder,
        updateLastScanned: (folderId: string, timestamp: number) => void
    ): Promise<{ newFiles: number; totalScanned: number }> => {
        const { path, variant, lastScanned, id } = folder;

        const abortCtrl = new AbortController();
        const importRunId = beginImportRun({
            owner: 'folder-resync',
            abortController: abortCtrl
        });
        if (!importRunId) {
            addToast('Import already in progress', 'info');
            return { newFiles: 0, totalScanned: 0 };
        }

        try {
            let filesToScan: string[] = [];
            let isIncremental = false;

            if (lastScanned && lastScanned > 0) {
                console.log(`[Resync] Incremental scan for ${path} since ${new Date(lastScanned).toISOString()}`);
                const newFiles = await unwrap(commands.scanDirectorySince(path, lastScanned));
                filesToScan = newFiles.map(f => f.path);
                isIncremental = true;
                console.log(`[Resync] Found ${filesToScan.length} modified files`);
            } else {
                console.log(`[Resync] Full scan for ${path} (no previous timestamp)`);
                const allFiles = await unwrap(commands.scanDirectoryWithStats(path));
                filesToScan = allFiles.map(f => f.path);
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

            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();

            const result = await processNativePaths(
                filesToScan,
                thumbDir,
                (current, total, message) => {
                    setImportProgressForRun(importRunId, { current, total, message });
                },
                variant as GeneratorTool | undefined,
                abortCtrl.signal,
                false,
                isIncremental
            );

            if (!result.wasCancelled && result.images.length > 0) {
                await commitImportResult(result, { toastMode: 'compact' });
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
    }, [beginImportRun, setImportProgressForRun, finishImportRun, commitImportResult, addToast]);

    return {
        importImages,
        handleImportPaths,
        handleImportFolders,
        handleWebFiles,
        scanDirectory,
        handleInvokeSync,
        resyncFolder
    };
};
