import * as React from 'react';
import { useState, useRef, useCallback } from 'react';
import { AIImage, AppSettings, RecoveryStyle } from '../types';
import { exportImagesToZip } from '../services/exportService';
import { imageToBase64 } from '../services/imageService';
import { recoverImageMetadata } from '../services/geminiService';
import { useToast } from './useToast';
import { open } from '@tauri-apps/plugin-dialog';
import { remove } from '@tauri-apps/plugin-fs';
import { processWebFiles, processNativePaths, ImportResult } from '../services/importService';
import { regenerateThumbnailsForImages } from '../services/thumbnailService';
import { normalizePath } from '../utils/pathUtils';
import { useSearch } from '../contexts/SearchContext';

interface UseFileOperationsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollectionThumbnails: () => void;
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
        thumbnailProgress, setThumbnailProgress
    } = useSearch();
    const [isExporting, setIsExporting] = useState(false);
    const [isRecoveringMetadata, setIsRecoveringMetadata] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Helper: Commit Images to State ---
    const commitImportResult = useCallback((result: ImportResult, silent = false) => {
        const { images: newImages, stats } = result;

        // Filter out duplicates that already exist in state
        const uniqueNewImages = newImages.filter(
            newImg => !images.some(existingImg => existingImg.id === newImg.id)
        );

        const dupeCount = newImages.length - uniqueNewImages.length;

        if (uniqueNewImages.length > 0) {
            setImages(prev => [...uniqueNewImages, ...prev]);
            refreshCollectionThumbnails();

            let msg = `Imported ${uniqueNewImages.length} images.`;
            if (dupeCount > 0) msg += ` (Skipped ${dupeCount} duplicates)`;
            if (stats.skipped > 0) msg += ` Ignored ${stats.skipped} intermediate files.`;
            if (stats.errors > 0) msg += ` ${stats.errors} failed.`;

            if (!silent) addToast(msg, stats.errors > 0 ? 'info' : 'success');
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
            commitImportResult(result);
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
            commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            setIsImporting(false);
        }
    };

    const handleImportPaths = async (paths: string[]) => {
        setIsImporting(true);
        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();
            const result = await processNativePaths(paths, thumbDir, (current, total, message) => {
                setImportProgress({ current, total, message });
            });
            commitImportResult(result);
        } catch (error) {
            addToast("Import failed", "error");
        } finally {
            setIsImporting(false);
            setImportProgress(null);
        }
    };

    const scanDirectory = async (dirPath: string) => {
        setIsImporting(true);
        try {
            const { getThumbnailDir } = await import('../services/thumbnailService');
            const thumbDir = await getThumbnailDir();
            const result = await processNativePaths([dirPath], thumbDir, (current, total, message) => {
                setImportProgress({ current, total, message });
            });
            if (result.images.length > 0) {
                commitImportResult(result, true);
            }
        } catch (e) {
            console.error(`Failed to scan directory ${dirPath}`, e);
        } finally {
            setIsImporting(false);
            setImportProgress(null);
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
            setImages(prev => prev.map(pImg => pImg.id === img.id ? {
                ...pImg,
                metadata: { ...pImg.metadata, ...recoveredMeta },
                originalMetadata: pImg.originalMetadata || pImg.metadata
            } : pImg));

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

        // Find candidates: Images where the thumbnail IS the full image
        // We compare the URLs because convertFileSrc ensures they are both in the same format if they match.
        let candidates = images.filter(img => img.url === img.thumbnailUrl && !img.url.startsWith('blob:') && !img.url.startsWith('data:'));

        if (targetIds) {
            // Check which IDs we already have in memory
            const knownIds = new Set(images.map(i => i.id));
            const missingIds = targetIds.filter(id => !knownIds.has(id));

            // Start with known candidates
            candidates = images.filter(img => targetIds.includes(img.id));

            // Fetch missing objects if needed
            if (missingIds.length > 0) {
                try {
                    const { getImagesByIds } = await import('../services/db/imageRepo');
                    const fetched = await getImagesByIds(missingIds);
                    candidates = [...candidates, ...fetched];
                } catch (e) {
                    console.error("Failed to fetch missing images for regeneration", e);
                }
            }
        }

        if (candidates.length === 0) {
            if (!targetIds) addToast("No unoptimized images found correctly.", "success");
            return;
        }

        setIsRegeneratingThumbnails(true);
        setThumbnailProgress({ current: 0, total: candidates.length });

        try {
            const updates = await regenerateThumbnailsForImages(candidates, (curr, tot) => {
                setThumbnailProgress({ current: curr, total: tot });
                if (onProgress) onProgress(curr, tot);
            });

            if (updates.length > 0) {
                setImages(prev => {
                    const updateMap = new Map(updates.map(u => [u.id, u]));
                    return prev.map(p => updateMap.get(p.id) || p);
                });
                addToast(`Successfully optimized ${updates.length} of ${candidates.length} thumbnails.`, "success");
                refreshCollectionThumbnails();
            }
        } catch (e) {
            console.error("Regeneration error", e);
            addToast("Thumbnail optimization failed partway through", "error");
        } finally {
            setIsRegeneratingThumbnails(false);
            setThumbnailProgress(null);
        }
    }, [images, setImages, addToast, refreshCollectionThumbnails, setIsRegeneratingThumbnails, setThumbnailProgress]);

    return {
        isImporting,
        isExporting,
        isRecoveringMetadata,
        isRegeneratingThumbnails,
        fileInputRef,
        importImages,
        handleImportFiles: handleWebFiles,
        handleImportPaths,
        exportImages,
        deleteImages,
        recoverMetadata,
        scanDirectory,
        regenerateThumbnails
    };
};