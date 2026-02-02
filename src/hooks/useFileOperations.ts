import * as React from 'react';
import { useState, useRef, useCallback } from 'react';
import { AIImage, AppSettings, RecoveryStyle, GeneratorTool } from '../types';
import { exportImagesToZip } from '../services/exportService';
import { imageToBase64 } from '../services/imageService';
import { recoverImageMetadata } from '../services/geminiService';
import { useToast } from './useToast';
import { open } from '@tauri-apps/plugin-dialog';
import { remove } from '@tauri-apps/plugin-fs';
import { processWebFiles, processNativePaths, processFoldersUnified, ImportResult } from '../services/importService';
import { regenerateThumbnailsForImages } from '../services/thumbnailService';
import { normalizePath } from '../utils/pathUtils';
import { useLibraryStore } from '../stores/libraryStore';
import { useSearch } from '../contexts/SearchContext';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { MonitoredFolder } from '../types';

// Added ImportOptions interface
interface ImportOptions {
    isStartup?: boolean;
    skipStateManagement?: boolean;
    onProgress?: (current: number, total: number, message?: string) => void;
}

interface UseFileOperationsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollectionThumbnails: () => Promise<void>;
    settings: AppSettings;
}

export const useFileOperations = ({
    images,
    setImages,
    refreshCollectionThumbnails,
    settings
}: UseFileOperationsProps) => {
    const { addToast } = useToast();
    const {
        isImporting, setIsImporting, setImportProgress,
        isRegeneratingThumbnails, setIsRegeneratingThumbnails,
        setThumbnailProgress,
        setImportAbortController,
        setThumbnailAbortController
    } = useLibraryStore();
    const { refreshHiddenAvailability, refreshMetadata } = useSearch(); // Use destructuring to access refreshMetadata
    const [isExporting, setIsExporting] = useState(false);
    const [isRecoveringMetadata, setIsRecoveringMetadata] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Helper: Commit Images to State ---
    const commitImportResult = useCallback(async (result: ImportResult, silent = false) => {
        const { images: newImages, stats } = result;

        // Filter out duplicates that already exist in state
        const uniqueNewImages = newImages.filter(
            newImg => !images.some(existingImg => existingImg.id === newImg.id)
        );

        const dupeCount = newImages.length - uniqueNewImages.length;

        if (uniqueNewImages.length > 0) {
            // Optimization: If importing a huge number of images (e.g. > 500), 
            // OR if specifically requested (for "Folder Import" consistency),
            // directly updating the state causes React DevTools to crash (DataCloneError) or freezes the UI.
            // In these cases, we skip the optimistic update and just trigger a full refresh.
            if (uniqueNewImages.length > 500 || (result.stats.processed > 0 && result.stats.imported > 0)) {
                // Changed logic: Always refresh metadata for non-trivial imports to ensure Facet Cache & Gallery are 100% in sync
                // Optimistic updates are great for drag-drop single files, but for batches, a hard refresh is safer for consistency.
                console.log(`[FileOps] Batch import detected. Triggering full metadata refresh.`);
                await refreshMetadata();
            } else {
                setImages(prev => {
                    // Double-check unicity against the latest state to prevent race conditions
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
                // In silent mode (startup), only toast if we actually found something meaningful.
                // We suppress specific stats to keep it clean.
                addToast(`Imported ${uniqueNewImages.length} new images`, 'success');
            }

            // Refresh View Options availability
            refreshHiddenAvailability();
        } else {
            if (dupeCount > 0 && stats.skipped === 0 && stats.errors === 0) {
                console.log(`Scan complete: ${dupeCount} duplicates found.`);
            } else {
                if (!silent && stats.skipped > 0) addToast(`Ignored ${stats.skipped} intermediate files.`, 'info');
                if (!silent && stats.errors > 0) addToast(`Failed to load ${stats.errors} files.`, 'error');
            }
        }
    }, [images, setImages, addToast, refreshCollectionThumbnails]);

    // --- Actions ---
    const importImages = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        setIsImporting(true);
        try {
            const result = await processWebFiles(Array.from(e.target.files));
            await commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }, [setIsImporting, commitImportResult, addToast]);

    const handleWebFiles = useCallback(async (files: File[]) => {
        setIsImporting(true);
        try {
            const result = await processWebFiles(files);
            await commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            setIsImporting(false);
        }
    }, [setIsImporting, commitImportResult, addToast]);

    const handleImportPaths = useCallback(async (paths: string[], defaultTool?: GeneratorTool, options: ImportOptions = {}) => {
        const { isStartup = false, skipStateManagement = false, onProgress: externalOnProgress } = options;

        // Silent Startup Mode: If no paths to import, simply return without triggering UI.
        if (paths.length === 0 && isStartup) return;

        if (!skipStateManagement) setIsImporting(true);
        const abortCtrl = new AbortController();
        if (!skipStateManagement) setImportAbortController(abortCtrl);
        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();

            // Even in "Silent Startup" (isStartup=true), we want to show progress if we are actually importing files.
            // Since smart scan filters efficiently, if we are here, we have new files to process.
            // The "Silent" part mainly refers to NOT showing "0 imported" or "Intermediates" toasts at the end.
            const onProgress = (current: number, total: number, message?: string) => {
                if (externalOnProgress) {
                    externalOnProgress(current, total, message);
                } else {
                    setImportProgress({ current, total, message });
                }
            };

            const result = await processNativePaths(paths, thumbDir, onProgress, defaultTool, abortCtrl.signal, isStartup);

            // If aborted, result might be partial. That's fine.
            await commitImportResult(result, isStartup); // Pass silent=true if isStartup
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
        // FIX: Use unified processor to prevent double-scanning and ensure consistent progress
        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);

        try {
            // Map string variant back to GeneratorTool enum if needed
            const typedFolders = folders.map(f => ({
                path: f.path,
                variant: f.variant as GeneratorTool | undefined
            }));

            // Unified Process: Scans, batches, and imports efficiently
            const result = await processFoldersUnified(typedFolders, {
                onProgress: (current, total, message) => {
                    setImportProgress({ current, total, message });
                },
                abortSignal: abortCtrl.signal,
                isStartup,
                forceRescan: false // Standard import skips existing
            });

            // Commit results to state (UI Update)
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

    // Trigger InvokeAI database sync (for managed integration rescan)
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
                    afterTimestamp: 0 // Full sync
                }
            );

            // Post-sync tasks
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

    const exportImages = useCallback(async (filename: string, ids: Set<string> | string[], destinationFolder: string, onComplete?: () => void) => {
        const idArray = Array.from(ids);
        if (idArray.length === 0 || !destinationFolder) return;

        setIsExporting(true);
        try {
            // Check if all images are in state. If not, fetch from DB.
            let targetImages = images.filter(img => idArray.includes(img.id));

            if (targetImages.length < idArray.length) {
                const { getImagesByIds } = await import('../services/db/imageRepo');
                targetImages = await getImagesByIds(idArray);
            }

            if (targetImages.length === 0) {
                addToast("No valid images found to export", "error");
                return;
            }

            await exportImagesToZip(targetImages, destinationFolder, filename);
            addToast(`Export complete`, 'success');
            if (onComplete) onComplete();
        } catch (error) {
            console.error("Export error", error);
            addToast("Export failed", "error");
        } finally {
            setIsExporting(false);
        }
    }, [images, addToast]);

    const deleteImages = useCallback(async (ids: string[], permanent = false) => {
        try {
            const { markAsDeleted, deleteImage } = await import('../services/db/imageRepo');
            if (permanent) {
                for (const id of ids) await deleteImage(id);
                setImages(prev => prev.filter(img => !ids.includes(img.id)));
                addToast(`Permanently deleted ${ids.length} images`, 'success');
            } else {
                await markAsDeleted(ids, true);
                setImages(prev => prev.map(img =>
                    ids.includes(img.id) ? { ...img, isDeleted: true } : img
                ));
                addToast(`Moved ${ids.length} images to Trash`, 'success');
                await refreshCollectionThumbnails();
            }
        } catch (e) {
            console.error("Failed to delete images", e);
            addToast("Failed to delete from database", "error");
        }
    }, [setImages, addToast, refreshCollectionThumbnails]);

    const recoverMetadata = useCallback(async (targetId: string, style: RecoveryStyle, onComplete: () => void) => {
        const img = images.find(i => i.id === targetId);
        if (!img) return;

        setIsRecoveringMetadata(true);
        try {
            const base64 = await imageToBase64(img.url);
            const apiKey = settings.googleGeminiApiKey || process.env.API_KEY;
            if (!apiKey) throw new Error("No API Key");

            const recoveredMeta = await recoverImageMetadata(base64, style, apiKey, settings.aiModel, settings.systemPrompts);
            // SCOPE REDUCTION: Only apply positivePrompt from AI. Other fields untouched.
            const recoveredPrompt = recoveredMeta.positivePrompt;

            const updatedImg = {
                ...img,
                metadata: {
                    ...img.metadata,
                    positivePrompt: recoveredPrompt
                },
                // Preserve originalMetadata on first edit. Don't overwrite on subsequent re-runs.
                originalMetadata: img.originalMetadata || img.metadata
            };

            setImages(prev => prev.map(pImg => pImg.id === img.id ? updatedImg : pImg));

            // Persist to DB
            const { insertImage } = await import('../services/db/imageRepo');
            await insertImage(updatedImg);

            addToast("Metadata recovered successfully!", "success");
            onComplete();
        } catch (e) {
            console.error(e);
            addToast("AI Analysis Failed", "error");
        } finally {
            setIsRecoveringMetadata(false);
        }
    }, [images, settings.googleGeminiApiKey, settings.systemPrompts, setImages, addToast]);

    const regenerateThumbnails = useCallback(async (arg?: string[] | ((current: number, total: number) => void)) => {
        const targetIds = Array.isArray(arg) ? arg : undefined;
        const onProgress = typeof arg === 'function' ? arg : undefined;

        let candidates: AIImage[];

        if (targetIds && targetIds.length > 0) {
            // When specific IDs are provided (e.g., from maintenance view), 
            // fetch ALL of them from DB since they may not be in the gallery images array.
            // The maintenance view has already pre-filtered these as needing regeneration.
            try {
                const { getImagesByIds } = await import('../services/db/imageRepo');
                candidates = await getImagesByIds(targetIds);
            } catch (e) {
                console.error("Failed to fetch images for regeneration", e);
                candidates = [];
            }
        } else {
            // Find candidates from gallery: Images where the thumbnail IS the full image
            // We compare the URLs because convertFileSrc ensures they are both in the same format if they match.
            candidates = images.filter(img => img.url === img.thumbnailUrl && !img.url.startsWith('blob:') && !img.url.startsWith('data:'));
        }

        if (candidates.length === 0) {
            if (!targetIds) addToast("No unoptimized images found correctly.", "success");
            return;
        }

        const abortCtrl = new AbortController();
        setThumbnailAbortController(abortCtrl);
        setIsRegeneratingThumbnails(true);
        setThumbnailProgress({ current: 0, total: candidates.length });

        try {
            const updates = await regenerateThumbnailsForImages(candidates, (curr, tot) => {
                setThumbnailProgress({ current: curr, total: tot });
                if (onProgress) onProgress(curr, tot);
            }, abortCtrl.signal);

            if (updates.length > 0) {
                setImages(prev => {
                    const updateMap = new Map(updates.map(u => [u.id, u]));
                    return prev.map(p => updateMap.get(p.id) || p);
                });
                const msg = abortCtrl.signal.aborted
                    ? `Cancelled after optimizing ${updates.length} thumbnails.`
                    : `Successfully optimized ${updates.length} of ${candidates.length} thumbnails.`;
                addToast(msg, "success");
                await refreshCollectionThumbnails();
            }
        } catch (e) {
            console.error("Regeneration error", e);
            addToast("Thumbnail optimization failed partway through", "error");
        } finally {
            setIsRegeneratingThumbnails(false);
            setThumbnailProgress(null);
            setThumbnailAbortController(null);
        }
    }, [images, setImages, addToast, refreshCollectionThumbnails, setIsRegeneratingThumbnails, setThumbnailProgress, setThumbnailAbortController]);

    /**
     * Incremental resync for a monitored folder.
     * Uses scanDirectorySince to only process files modified since lastScanned.
     * Falls back to full scan if no lastScanned timestamp exists.
     */
    const resyncFolder = useCallback(async (
        folder: MonitoredFolder,
        updateLastScanned: (folderId: string, timestamp: number) => void
    ): Promise<{ newFiles: number; totalScanned: number }> => {
        const { path, variant, lastScanned, id } = folder;

        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);

        try {
            // Determine which files to scan
            let filesToScan: string[] = [];
            let isIncremental = false;

            if (lastScanned && lastScanned > 0) {
                // Incremental: Only get files modified since last scan
                console.log(`[Resync] Incremental scan for ${path} since ${new Date(lastScanned).toISOString()}`);
                const newFiles = await unwrap(commands.scanDirectorySince(path, lastScanned));
                filesToScan = newFiles.map(f => f.path);
                isIncremental = true;
                console.log(`[Resync] Found ${filesToScan.length} modified files`);
            } else {
                // Full scan: First time or no timestamp
                console.log(`[Resync] Full scan for ${path} (no previous timestamp)`);
                const allFiles = await unwrap(commands.scanDirectoryWithStats(path));
                filesToScan = allFiles.map(f => f.path);
                console.log(`[Resync] Found ${filesToScan.length} total files`);
            }

            // Update timestamp immediately (before scan) so even a cancelled scan marks progress
            updateLastScanned(id, Date.now());

            if (filesToScan.length === 0) {
                setImportProgress({ current: 0, total: 0, message: 'No changes detected' });
                return { newFiles: 0, totalScanned: 0 };
            }

            // Progress message based on scan type
            const scanTypeMsg = isIncremental ? 'Syncing new files' : 'Full scan';
            setImportProgress({ current: 0, total: filesToScan.length, message: `${scanTypeMsg}...` });

            // Process the files using existing infrastructure
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();

            const result = await processNativePaths(
                filesToScan,
                thumbDir,
                (current, total, message) => {
                    setImportProgress({ current, total, message });
                },
                variant,
                abortCtrl.signal,
                false, // isStartup
                false  // forceRescan - we've already filtered to only changed files
            );

            // Commit results
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
        isImporting,
        isExporting,
        isRecoveringMetadata,
        isRegeneratingThumbnails,
        fileInputRef,
        importImages,
        handleImportPaths,
        handleImportFolders,
        handleImportFiles: handleWebFiles,
        scanDirectory,
        exportImages,
        deleteImages,
        recoverMetadata,
        regenerateThumbnails,
        handleInvokeSync,
        resyncFolder
    };
};