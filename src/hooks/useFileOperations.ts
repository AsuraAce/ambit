import * as React from 'react';
import { useState, useRef, useCallback } from 'react';
import { AIImage, AppSettings, RecoveryStyle } from '../types';
import { exportImagesToZip } from '../services/exportService';
import { recoverImageMetadata } from '../services/geminiService';
import { useToast } from './useToast';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { processWebFiles, processNativePaths, ImportResult } from '../services/importService';
import { getThumbnailDir, regenerateThumbnailsForImages } from '../services/thumbnailService';

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
    const [isImporting, setIsImporting] = useState(false);
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
    }, [images, setImages, refreshCollectionThumbnails, addToast]);

    // --- Import Handlers ---

    const handleWebFiles = useCallback(async (files: FileList | File[]) => {
        if (!files || files.length === 0) return;
        setIsImporting(true);
        if (files.length > 5) addToast(`Processing ${files.length} images...`, 'info');

        try {
            const fileArray = Array.isArray(files) ? files : Array.from(files);
            const result = await processWebFiles(fileArray);
            commitImportResult(result);
        } catch (err) {
            console.error(err);
            addToast('Critical error during import.', 'error');
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [commitImportResult, addToast]);

    const handleImportPaths = useCallback(async (paths: string[], silent = false) => {
        if (!paths || paths.length === 0) return;
        setIsImporting(true);
        if (!silent) addToast(`Importing ${paths.length} files...`, 'info');

        try {
            const thumbDir = await getThumbnailDir();
            const result = await processNativePaths(paths, thumbDir);
            commitImportResult(result, silent);
        } catch (err) {
            console.error(err);
            if (!silent) addToast('Critical error during import.', 'error');
        } finally {
            setIsImporting(false);
        }
    }, [commitImportResult, addToast]);

    const handleNativeImport = async () => {
        try {
            const selected = await open({
                multiple: true,
                directory: false,
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
            });

            if (!selected) return;
            const paths = Array.isArray(selected) ? selected : [selected];
            await handleImportPaths(paths);
        } catch (err) {
            console.error(err);
            addToast('Failed to open file dialog', 'error');
        }
    };

    const importImages = (e?: React.ChangeEvent<HTMLInputElement>) => {
        if (e && e.target.files) {
            handleWebFiles(e.target.files);
        } else {
            handleNativeImport();
        }
    };

    const scanDirectory = async (dirPath: string, silent = false) => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const imagePaths = await invoke<string[]>('scan_directory_recursive', { path: dirPath });

            if (imagePaths && imagePaths.length > 0) {
                await handleImportPaths(imagePaths, silent);
            } else {
                if (!silent) addToast(`No images found in ${dirPath}`, 'info');
            }
        } catch (e) {
            console.error(`Failed to scan directory ${dirPath}`, e);
            if (!silent) addToast(`Failed to scan folder: ${dirPath}`, 'error');
        }
    };

    // --- Other Operations ---

    const exportImages = async (filename: string, selectedIds: Set<string>, onComplete: () => void) => {
        setIsExporting(true);
        try {
            await exportImagesToZip(images.filter(img => selectedIds.has(img.id)), filename.endsWith('.zip') ? filename : `${filename}.zip`);
            addToast(`Export complete`, 'success');
            onComplete();
        } catch (e) {
            addToast('Export failed', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    const deleteImages = async (ids: string[], isPermanent = false) => {
        // Optimistic UI Update
        const targetIds = new Set(ids);
        setImages(prev => prev.filter(img => !targetIds.has(img.id)));

        try {
            const { markAsDeleted, deleteImage } = await import('../services/db/imageRepo');
            if (isPermanent) {
                await Promise.all(ids.map(id => deleteImage(id)));
                addToast(`Permanently deleted ${ids.length} images`, 'success');
            } else {
                await markAsDeleted(ids, true);
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
            let base64 = "";
            if (!img.url.startsWith('http') && !img.url.startsWith('blob:')) {
                const data = await readFile(img.url);
                // Simple binary to base64 conversion for small files or proper handling
                const binary = Array.from(data).map(b => String.fromCharCode(b)).join('');
                base64 = `data:image/png;base64,${btoa(binary)}`;
            } else {
                const response = await fetch(img.url);
                const blob = await response.blob();
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                await new Promise<void>(resolve => {
                    reader.onloadend = () => {
                        base64 = reader.result as string;
                        resolve();
                    }
                });
            }

            const apiKey = settings.googleGeminiApiKey || process.env.API_KEY;
            if (!apiKey) throw new Error("No API Key");

            const recoveredMeta = await recoverImageMetadata(base64, style, apiKey);
            setImages(prev => prev.map(pImg => pImg.id === img.id ? { ...pImg, metadata: { ...pImg.metadata, ...recoveredMeta }, originalMetadata: pImg.originalMetadata || pImg.metadata } : pImg));
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

        // Find candidates
        let candidates = images.filter(img => img.id === img.thumbnailUrl && !img.url.startsWith('blob:') && !img.url.startsWith('data:'));
        if (targetIds) {
            candidates = candidates.filter(img => targetIds.includes(img.id));
        }

        if (candidates.length === 0) {
            if (!targetIds) addToast("All images already have thumbnails!", "success");
            return;
        }

        addToast(`Generating thumbnails for ${candidates.length} images...`, 'info');

        const updates = await regenerateThumbnailsForImages(candidates, onProgress);

        if (updates.length > 0) {
            setImages(prev => {
                const updateMap = new Map(updates.map(u => [u.id, u]));
                return prev.map(p => updateMap.get(p.id) || p);
            });
            addToast(`Generated ${updates.length} thumbnails`, "success");
            refreshCollectionThumbnails();
        }
    }, [images, setImages, addToast, refreshCollectionThumbnails]);

    return {
        isImporting,
        isExporting,
        isRecoveringMetadata,
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