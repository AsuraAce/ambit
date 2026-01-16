import * as React from 'react';
import { useState, useRef, useCallback } from 'react';
import { AIImage, AppSettings, RecoveryStyle, GeneratorTool } from '../types';
import { exportImagesToZip } from '../services/exportService';
import { imageToBase64 } from '../services/imageService';
import { recoverImageMetadata } from '../services/geminiService';
import { useToast } from './useToast';
import { open } from '@tauri-apps/plugin-dialog';
import { remove } from '@tauri-apps/plugin-fs';
import { processWebFiles, processNativePaths, ImportResult } from '../services/importService';
import { regenerateThumbnailsForImages } from '../services/thumbnailService';
import { normalizePath } from '../utils/pathUtils';
import { useLibraryStore } from '../stores/libraryStore';
import { useSearch } from '../contexts/SearchContext';

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
        isImporting, setIsImporting, importProgress, setImportProgress,
        isRegeneratingThumbnails, setIsRegeneratingThumbnails,
        thumbnailProgress, setThumbnailProgress,
        setImportAbortController,
        setThumbnailAbortController
    } = useLibraryStore();
    const { refreshHiddenAvailability } = useSearch();
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
            setImages(prev => [...uniqueNewImages, ...prev]);
            await refreshCollectionThumbnails();

            let msg = `Imported ${uniqueNewImages.length} images.`;
            if (dupeCount > 0) msg += ` (Skipped ${dupeCount} duplicates)`;
            if (stats.skipped > 0) msg += ` Ignored ${stats.skipped} intermediate files.`;
            if (stats.errors > 0) msg += ` ${stats.errors} failed.`;

            if (!silent) addToast(msg, stats.errors > 0 ? 'info' : 'success');

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
    const importImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
    };

    const handleWebFiles = async (files: File[]) => {
        setIsImporting(true);
        try {
            const result = await processWebFiles(files);
            await commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            setIsImporting(false);
        }
    };

    const handleImportFolders = async (folders: { path: string, variant?: string }[]) => {
        // Group by variant to optimize bulk processing
        const byVariant: Record<string, string[]> = {};
        for (const { path, variant } of folders) {
            const v = variant || 'Unknown';
            if (!byVariant[v]) byVariant[v] = [];
            byVariant[v].push(path);
        }

        for (const [variant, paths] of Object.entries(byVariant)) {
            const v = variant === 'Unknown' ? undefined : (variant as GeneratorTool);
            await handleImportPaths(paths, v);
        }
    };

    const handleImportPaths = async (paths: string[], defaultTool?: GeneratorTool) => {
        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);
        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();
            const result = await processNativePaths(paths, thumbDir, (current, total, message) => {
                setImportProgress({ current, total, message });
            }, defaultTool, abortCtrl.signal);

            // If aborted, result might be partial. That's fine.
            await commitImportResult(result);
        } catch (error) {
            console.error("Import error", error);
            addToast("Import failed or cancelled", "error");
        } finally {
            setIsImporting(false);
            setImportProgress(null);
            setImportAbortController(null);
        }
    };

    const scanDirectory = async (dirPath: string) => {
        setIsImporting(true);
        const abortCtrl = new AbortController();
        setImportAbortController(abortCtrl);
        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();
            const result = await processNativePaths([dirPath], thumbDir, (current, total, message) => {
                setImportProgress({ current, total, message });
            }, undefined, abortCtrl.signal);
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
    };

    const exportImages = async (filename: string, ids: Set<string> | string[], destinationFolder: string, onComplete?: () => void) => {
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
    };

    const deleteImages = async (ids: string[], permanent = false) => {
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
    };

    const recoverMetadata = async (targetId: string, style: RecoveryStyle, onComplete: () => void) => {
        const img = images.find(i => i.id === targetId);
        if (!img) return;

        setIsRecoveringMetadata(true);
        try {
            const base64 = await imageToBase64(img.url);
            const apiKey = settings.googleGeminiApiKey || process.env.API_KEY;
            if (!apiKey) throw new Error("No API Key");

            const recoveredMeta = await recoverImageMetadata(base64, style, apiKey);
            const updatedImg = {
                ...img,
                metadata: { ...img.metadata, ...recoveredMeta },
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
    };

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

    return {
        isImporting,
        importProgress,
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
        regenerateThumbnails
    };
};