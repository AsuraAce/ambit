import * as React from 'react';
import { useCallback } from 'react';
import { AIImage, AppSettings, GeneratorTool, MonitoredFolder } from '../types';
import { useToast } from './useToast';
import { useLibraryStore } from '../stores/libraryStore';
import { useSearch } from '../contexts/SearchContext';
import { processWebFiles, processNativePaths, processFoldersUnified, ImportResult } from '../services/importService';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';

interface ImportOptions {
    isStartup?: boolean;
    skipStateManagement?: boolean;
    onProgress?: (current: number, total: number, message?: string) => void;
}

interface UseImportOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollectionThumbnails: () => Promise<void>;
    settings: AppSettings;
}

export const useImportOps = ({
    images,
    setImages,
    refreshCollectionThumbnails,
    settings
}: UseImportOpsProps) => {
    const { addToast } = useToast();
    const {
        setIsImporting, setImportProgress,
        setImportAbortController
    } = useLibraryStore();
    const { refreshHiddenAvailability, refreshMetadata } = useSearch();

    const extractNativePaths = useCallback((files: File[]): string[] => {
        return files
            .map(file => (file as File & { path?: string }).path)
            .filter((path): path is string => typeof path === 'string' && path.length > 0);
    }, []);

    const commitImportResult = useCallback(async (result: ImportResult, silent = false) => {
        const { images: newImages, stats } = result;

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
                await refreshCollectionThumbnails();
            }

            let msg = `Imported ${uniqueNewImages.length} images.`;
            if (dupeCount > 0) msg += ` (Skipped ${dupeCount} duplicates)`;
            if (stats.skipped > 0) msg += ` Ignored ${stats.skipped} intermediate files.`;
            if (stats.errors > 0) msg += ` ${stats.errors} failed.`;

            if (!silent) {
                addToast(msg, stats.errors > 0 ? 'info' : 'success');
            } else {
                addToast(`Imported ${uniqueNewImages.length} new images`, 'success');
            }

            refreshHiddenAvailability();
        } else {
            if (dupeCount > 0 && stats.skipped === 0 && stats.errors === 0) {
                console.log(`Scan complete: ${dupeCount} duplicates found.`);
            } else {
                if (!silent && stats.skipped > 0) addToast(`Ignored ${stats.skipped} intermediate files.`, 'info');
                if (!silent && stats.errors > 0) addToast(`Failed to load ${stats.errors} files.`, 'error');
            }
        }
    }, [images, setImages, addToast, refreshCollectionThumbnails, refreshMetadata, refreshHiddenAvailability]);

    const importImages = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        setIsImporting(true);
        try {
            const files = Array.from(e.target.files);
            const nativePaths = extractNativePaths(files);

            if (nativePaths.length === files.length && nativePaths.length > 0) {
                const { getThumbnailDir } = await import('../services/thumbnailService');
                const thumbDir = await getThumbnailDir();
                const result = await processNativePaths(nativePaths, thumbDir, (current, total, message) => {
                    setImportProgress({ current, total, message });
                });
                await commitImportResult(result);
                return;
            }

            const result = await processWebFiles(files);
            await commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            setIsImporting(false);
            setImportProgress(null);
            setImportAbortController(null);
            if (e.target) e.target.value = "";
        }
    }, [setIsImporting, setImportProgress, setImportAbortController, extractNativePaths, commitImportResult, addToast]);

    const handleWebFiles = useCallback(async (files: File[]) => {
        setIsImporting(true);
        try {
            const nativePaths = extractNativePaths(files);

            if (nativePaths.length === files.length && nativePaths.length > 0) {
                const { getThumbnailDir } = await import('../services/thumbnailService');
                const thumbDir = await getThumbnailDir();
                const result = await processNativePaths(nativePaths, thumbDir, (current, total, message) => {
                    setImportProgress({ current, total, message });
                });
                await commitImportResult(result);
                return;
            }

            const result = await processWebFiles(files);
            await commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            setIsImporting(false);
            setImportProgress(null);
            setImportAbortController(null);
        }
    }, [setIsImporting, setImportProgress, setImportAbortController, extractNativePaths, commitImportResult, addToast]);

    const handleImportPaths = useCallback(async (paths: string[], defaultTool?: GeneratorTool, options: ImportOptions = {}) => {
        const { isStartup = false, skipStateManagement = false, onProgress: externalOnProgress } = options;

        if (paths.length === 0 && isStartup) return;

        if (!skipStateManagement) setIsImporting(true);
        const abortCtrl = new AbortController();
        if (!skipStateManagement) setImportAbortController(abortCtrl);
        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();

            const onProgress = (current: number, total: number, message?: string) => {
                if (externalOnProgress) {
                    externalOnProgress(current, total, message);
                } else {
                    setImportProgress({ current, total, message });
                }
            };

            const result = await processNativePaths(paths, thumbDir, onProgress, defaultTool, abortCtrl.signal, isStartup);
            await commitImportResult(result, isStartup);
        } catch (error) {
            console.error("Import error", error);
            if (!isStartup) addToast("Import failed or cancelled", "error");
        } finally {
            if (!skipStateManagement) {
                setIsImporting(false);
                setImportProgress(null);
                setImportAbortController(null);
            }
        }
    }, [setIsImporting, setImportAbortController, setImportProgress, commitImportResult, addToast]);

    const handleImportFolders = useCallback(async (folders: { path: string, variant?: string }[], isStartup = false) => {
        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);

        try {
            const typedFolders = folders.map(f => ({
                path: f.path,
                variant: f.variant as GeneratorTool | undefined
            }));

            const result = await processFoldersUnified(typedFolders, {
                onProgress: (current, total, message) => {
                    setImportProgress({ current, total, message });
                },
                abortSignal: abortCtrl.signal,
                isStartup,
                forceRescan: false
            });

            if (result.images.length > 0) {
                await commitImportResult(result, isStartup);
            }

            if (!isStartup) {
                if (result.images.length > 0) {
                    addToast(`Imported ${result.images.length} images from ${folders.length} folder(s)`, 'success');
                } else if (result.stats.skipped > 0) {
                    addToast(`Scan complete. No new images found.`, 'info');
                } else if (result.stats.errors > 0) {
                    addToast(`Scan complete with ${result.stats.errors} errors.`, 'warning');
                } else {
                    addToast('No images found in selected folders', 'info');
                }
            }
        } catch (error) {
            console.error('[ImportFolders] Error:', error);
            if (!isStartup) addToast('Import failed', 'error');
        } finally {
            setIsImporting(false);
            setImportProgress(null);
            setImportAbortController(null);
        }
    }, [setIsImporting, setImportProgress, setImportAbortController, addToast, commitImportResult]);

    const scanDirectory = useCallback(async (dirPath: string) => {
        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);
        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();
            const result = await processNativePaths([dirPath], thumbDir, (current, total, message) => {
                setImportProgress({ current, total, message });
            }, undefined, abortCtrl.signal, false);
            if (result.images.length > 0) {
                await commitImportResult(result, true);
            }
        } catch (e) {
            console.error(`Failed to scan directory ${dirPath}`, e);
        } finally {
            setIsImporting(false);
            setImportProgress(null);
            setImportAbortController(null);
        }
    }, [setIsImporting, setImportAbortController, setImportProgress, commitImportResult]);

    const handleInvokeSync = useCallback(async () => {
        if (!settings.invokeAiPath) {
            addToast('InvokeAI not configured', 'error');
            return;
        }

        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);

        try {
            const { syncImages } = await import('../services/invoke/syncService');
            const { rebuildFacetCache, syncCollectionImages } = await import('../services/db/imageRepo');

            const result = await syncImages(
                settings.invokeAiPath,
                (current, total, message) => {
                    setImportProgress({ current, total, message });
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

            await syncCollectionImages();
            await rebuildFacetCache();
            await refreshCollectionThumbnails();

            addToast(`InvokeAI sync complete: ${result.imported} imported, ${result.updated} updated`, 'success');
        } catch (e) {
            console.error('InvokeAI sync failed', e);
            addToast('InvokeAI sync failed', 'error');
        } finally {
            setIsImporting(false);
            setImportProgress(null);
            setImportAbortController(null);
        }
    }, [settings.invokeAiPath, settings.importIntermediates, addToast, setIsImporting, setImportProgress, setImportAbortController, refreshCollectionThumbnails]);

    const resyncFolder = useCallback(async (
        folder: MonitoredFolder,
        updateLastScanned: (folderId: string, timestamp: number) => void
    ): Promise<{ newFiles: number; totalScanned: number }> => {
        const { path, variant, lastScanned, id } = folder;

        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);

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

            updateLastScanned(id, Date.now());

            if (filesToScan.length === 0) {
                setImportProgress({ current: 0, total: 0, message: 'No changes detected' });
                return { newFiles: 0, totalScanned: 0 };
            }

            const scanTypeMsg = isIncremental ? 'Syncing new files' : 'Full scan';
            setImportProgress({ current: 0, total: filesToScan.length, message: `${scanTypeMsg}...` });

            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();

            const result = await processNativePaths(
                filesToScan,
                thumbDir,
                (current, total, message) => {
                    setImportProgress({ current, total, message });
                },
                variant as GeneratorTool | undefined,
                abortCtrl.signal,
                false,
                false
            );

            if (result.images.length > 0) {
                await commitImportResult(result, true);
            }

            return { newFiles: result.images.length, totalScanned: filesToScan.length };
        } catch (e) {
            console.error(`[Resync] Failed for ${path}`, e);
            throw e;
        } finally {
            setIsImporting(false);
            setImportProgress(null);
            setImportAbortController(null);
        }
    }, [setIsImporting, setImportAbortController, setImportProgress, commitImportResult]);

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
