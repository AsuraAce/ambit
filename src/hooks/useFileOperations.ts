import * as React from 'react';
import { useState, useRef, useCallback } from 'react';
import { AIImage, AppSettings, GeneratorTool, RecoveryStyle } from '../types';
import { parseImageFile, parseImageBuffer, scanImageNative } from '../services/metadataParser';
import { exportImagesToZip } from '../services/exportService';
import { recoverImageMetadata } from '../services/geminiService';
import { useToast } from './useToast';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appLocalDataDir, join } from '@tauri-apps/api/path';

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
    const thumbnailDirRef = useRef<string | null>(null);

    const getThumbnailDir = async () => {
        if (thumbnailDirRef.current) return thumbnailDirRef.current;
        try {
            const appData = await appLocalDataDir();
            const thumbPath = await join(appData, '.thumbnails');
            thumbnailDirRef.current = thumbPath;
            return thumbPath;
        } catch (e) {
            console.error("Failed to resolve thumbnail dir", e);
            return undefined;
        }
    };

    // Web / Drag-Drop Processing
    const processFiles = useCallback(async (files: FileList | File[]) => {
        if (!files || files.length === 0) return;

        setIsImporting(true);
        if (files.length > 5) addToast(`Processing ${files.length} images...`, 'info');

        try {
            const newImages: AIImage[] = [];
            let skippedCount = 0;
            let errorCount = 0;

            const fileArray = Array.isArray(files) ? files : Array.from(files);

            for (let i = 0; i < fileArray.length; i++) {
                const file = fileArray[i];
                if (!file.type.startsWith('image/')) continue;

                try {
                    const objectUrl = URL.createObjectURL(file);
                    const { metadata: meta, extra, isIntermediate } = await parseImageFile(file);

                    if (isIntermediate) {
                        skippedCount++;
                        URL.revokeObjectURL(objectUrl);
                        continue;
                    }

                    const img = new Image();
                    img.src = objectUrl;
                    await new Promise(r => img.onload = r);

                    newImages.push({
                        id: `imported_${Date.now()}_${i}`,
                        url: objectUrl,
                        thumbnailUrl: objectUrl,
                        filename: file.name,
                        fileSize: file.size,
                        timestamp: file.lastModified,
                        width: img.width,
                        height: img.height,
                        isFavorite: !!extra.isFavorite,
                        isDeleted: false,
                        isMissing: false,
                        metadata: mapMetadata(meta)
                    });
                } catch (e) {
                    console.error(`Error processing file ${file.name}:`, e);
                    errorCount++;
                }
            }

            commitImages(newImages, skippedCount, errorCount);
        } catch (err) {
            handleError(err);
        } finally {
            setIsImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [images, setImages, refreshCollectionThumbnails, addToast]);

    // Native Tauri Import
    const handleNativeImport = async () => {
        try {
            const selected = await open({
                multiple: true,
                directory: false,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'webp']
                }]
            });

            if (!selected) return;

            const paths = Array.isArray(selected) ? selected : [selected];
            if (paths.length === 0) return;

            setIsImporting(true);
            addToast(`Importing ${paths.length} files...`, 'info');

            const thumbnailDir = await getThumbnailDir();

            const newImages: AIImage[] = [];
            let skippedCount = 0;
            let errorCount = 0;

            for (const path of paths) {
                try {
                    // Optimized Native Scan (Rust)
                    const {
                        metadata: meta,
                        extra,
                        isIntermediate,
                        width,
                        height,
                        fileSize,
                        timestamp,
                        thumbnail
                    } = await scanImageNative(path, thumbnailDir, true);

                    if (isIntermediate) {
                        skippedCount++;
                        continue;
                    }

                    const filename = path.split(/[\\/]/).pop() || 'unknown.png';

                    const { normalizePath } = await import('../utils/pathUtils');
                    const normalizedPath = normalizePath(path);
                    const assetUrl = convertFileSrc(normalizedPath);
                    const thumbPath = thumbnail || normalizedPath;

                    const newImg: AIImage = {
                        id: normalizedPath,
                        url: assetUrl,
                        thumbnailUrl: thumbPath,
                        filename: filename,
                        fileSize: fileSize || 0,
                        timestamp: timestamp || Date.now(),
                        width: width || 0,
                        height: height || 0,
                        isFavorite: !!extra.isFavorite,
                        isDeleted: false,
                        isMissing: false,
                        metadata: mapMetadata(meta)
                    };

                    newImages.push(newImg);

                    // Persist to DB
                    await import('../services/db').then(({ insertImage }) => insertImage(newImg));

                } catch (e) {
                    console.error(`Error importing ${path}:`, e);
                    errorCount++;
                }
            }

            commitImages(newImages, skippedCount, errorCount);

        } catch (err) {
            handleError(err);
        } finally {
            setIsImporting(false);
        }
    };

    const commitImages = (newImages: AIImage[], skipped: number, errors: number, silent = false) => {
        const uniqueNewImages = newImages.filter(
            newImg => !images.some(existingImg => existingImg.id === newImg.id)
        );

        const dupeCount = newImages.length - uniqueNewImages.length;

        if (uniqueNewImages.length > 0) {
            setImages(prev => [...uniqueNewImages, ...prev]);
            refreshCollectionThumbnails();

            let msg = `Imported ${uniqueNewImages.length} images.`;
            if (dupeCount > 0) msg += ` (Skipped ${dupeCount} duplicates)`;
            if (skipped > 0) msg += ` Ignored ${skipped} intermediate files.`;
            if (errors > 0) msg += ` ${errors} failed.`;

            if (!silent) addToast(msg, errors > 0 ? 'info' : 'success');
        } else {
            if (dupeCount > 0 && skipped === 0 && errors === 0) {
                console.log(`Scan complete: ${dupeCount} duplicates found.`);
            } else {
                if (!silent && skipped > 0) addToast(`Ignored ${skipped} intermediate files.`, 'info');
                if (!silent && errors > 0) addToast(`Failed to load ${errors} files.`, 'error');
            }
        }
    };

    const mapMetadata = (meta: any) => ({
        tool: meta.tool || GeneratorTool.UNKNOWN,
        model: meta.model || 'Unknown',
        seed: meta.seed || 0,
        steps: meta.steps || 0,
        cfg: meta.cfg || 0,
        sampler: meta.sampler || 'Unknown',
        positivePrompt: meta.positivePrompt || '',
        negativePrompt: meta.negativePrompt || '',
        workflowJson: meta.workflowJson,
        rawParameters: meta.rawParameters,
        loras: meta.loras,
        controlNets: meta.controlNets,
        ipAdapters: meta.ipAdapters
    });

    const handleError = (err: any) => {
        addToast('Critical error during import.', 'error');
        console.error(err);
    };

    const importImages = (e?: React.ChangeEvent<HTMLInputElement>) => {
        if (e && e.target.files) {
            processFiles(e.target.files);
        } else {
            handleNativeImport();
        }
    };

    const handleImportPaths = async (paths: string[], silent = false) => {
        if (!paths || paths.length === 0) return;
        setIsImporting(true);
        if (!silent) addToast(`Importing ${paths.length} files...`, 'info');

        const thumbnailDir = await getThumbnailDir();

        const newImages: AIImage[] = [];
        let skippedCount = 0;
        let errorCount = 0;

        // Batch processing
        const BATCH_SIZE = 50;
        const { scanImagesBulk } = await import('../services/metadataParser');
        const { normalizePath } = await import('../utils/pathUtils');

        for (let i = 0; i < paths.length; i += BATCH_SIZE) {
            const chunk = paths.slice(i, i + BATCH_SIZE);
            // Optimization: Skip thumbnails for bulk import (Lazy Load / Browser Scale)
            const results = await scanImagesBulk(chunk, thumbnailDir, true);

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const path = chunk[j];

                if (!result || (result as any).error) {
                    // Check if error flag is set or standard ParseResult with defaults
                    if ((result as any).error) {
                        console.error(`Error importing ${path}`);
                        errorCount++;
                    }
                    // If it's just a failed parse return empty, we might still want to add it?
                    // Usually scanImagesBulk returns a valid ParseResult even on safe error, 
                    // but if 'error: true' is present (our custom flag), skip or count error.
                    if ((result as any).error) continue;
                }

                if (result.isIntermediate) {
                    skippedCount++;
                    continue;
                }

                const filename = path.split(/[\\/]/).pop() || 'unknown.png';
                const normalizedPath = normalizePath(path);
                const assetUrl = convertFileSrc(normalizedPath);

                // Use Thumbnail Path if generated
                const thumbPath = result.thumbnail || normalizedPath;

                const newImg: AIImage = {
                    id: normalizedPath,
                    url: assetUrl,
                    thumbnailUrl: thumbPath,
                    filename: filename,
                    fileSize: result.fileSize || 0,
                    timestamp: result.timestamp || Date.now(),
                    width: result.width || 0,
                    height: result.height || 0,
                    isFavorite: !!result.extra.isFavorite,
                    isDeleted: false,
                    isMissing: false,
                    metadata: mapMetadata(result.metadata)
                };

                newImages.push(newImg);

                // Persist to DB
                // We do this individually for now, but bulk insert would be better if plugin supported it.
                // Since plugin is async, we fire and await.
                try {
                    const { insertImage } = await import('../services/db');
                    await insertImage(newImg);
                } catch (dbErr) {
                    console.error("Failed to insert into DB", dbErr);
                }
            }

            // Progress Update
            if (!silent && paths.length > 200) {
                // Optional: addToast(`Imported ${Math.min(i + BATCH_SIZE, paths.length)} / ${paths.length}`, 'info');
                // Keeping it clean for now, or maybe update a progress bar if we had one.
            }
        }

        commitImages(newImages, skippedCount, errorCount, silent);
        setIsImporting(false);
    };

    const scanDirectory = async (dirPath: string, silent = false) => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            // Use the recursive Rust scanner which returns absolute paths
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
        if (isPermanent) {
            setImages(prev => prev.filter(img => !ids.includes(img.id)));
        } else {
            // Immediate Removal for Soft Delete (Trash) as well, per user preference
            setImages(prev => prev.filter(img => !ids.includes(img.id)));
        }

        try {
            const db = await import('../services/db');
            if (isPermanent) {
                // await db.deleteImagesForever(ids); // Implementation needed in db.ts if not exists, or loop deleteImage
                // Currently db.ts likely has deleteImage(id). 
                // Let's check `db.ts` or implement loop.
                await Promise.all(ids.map(id => db.deleteImage(id)));
                addToast(`Permanently deleted ${ids.length} images`, 'success');
            } else {
                await db.markAsDeleted(ids, true);
                addToast(`Moved ${ids.length} images to Trash`, 'success');
            }
        } catch (e) {
            console.error("Failed to delete images", e);
            addToast("Failed to delete from database", "error");
            // Revert UI? Complexity vs Speed. 
            // For now, let's assume reliability.
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
                let binary = '';
                const len = data.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(data[i]);
                }
                base64 = btoa(binary);
                base64 = `data:image/png;base64,${base64}`;
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
        const thumbDir = await getThumbnailDir();
        if (!thumbDir) return;

        const targetIds = Array.isArray(arg) ? arg : undefined;
        const onProgress = typeof arg === 'function' ? arg : undefined;

        // Find images that need optimization (where thumb path == image path)
        // Note: With our new logic, id IS the normalized absolute path.
        let candidates = images.filter(img => img.id === img.thumbnailUrl && !img.url.startsWith('blob:') && !img.url.startsWith('data:'));

        if (targetIds) {
            candidates = candidates.filter(img => targetIds.includes(img.id));
        }

        if (candidates.length === 0) {
            if (!targetIds) addToast("All images already have thumbnails!", "success");
            return;
        }

        addToast(`Generating thumbnails for ${candidates.length} images...`, 'info');

        let processed = 0;
        const total = candidates.length;
        const updates: AIImage[] = [];

        for (const img of candidates) {
            try {
                const path = img.id;
                const { thumbnail } = await scanImageNative(path, thumbDir);

                if (thumbnail) {
                    updates.push({ ...img, thumbnailUrl: thumbnail });
                }
            } catch (e) {
                console.error(`Failed to gen thumb for ${img.id}`, e);
            }

            processed++;
            if (onProgress) onProgress(processed, total);
        }

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
        handleImportFiles: processFiles,
        handleImportPaths,
        exportImages,
        deleteImages,
        recoverMetadata,
        scanDirectory,
        regenerateThumbnails
    };
};