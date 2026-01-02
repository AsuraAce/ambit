import { AIImage, GeneratorTool } from '../types';
import { parseImageFile, scanImageNative, scanImagesBulk } from './metadataParser';
import { insertImage } from './db/imageRepo';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { normalizePath } from '../utils/pathUtils';

export interface ImportStats {
    processed: number;
    imported: number;
    skipped: number;
    errors: number;
}

export interface ImportResult {
    images: AIImage[];
    stats: ImportStats;
}

const mapMetadata = (meta: any) => ({
    ...meta,
    tool: meta.tool || GeneratorTool.UNKNOWN,
    model: meta.model || 'Unknown',
    seed: meta.seed || 0,
    steps: meta.steps || 0,
    cfg: meta.cfg || 0,
    sampler: meta.sampler || 'Unknown',
    positivePrompt: meta.positivePrompt || '',
    negativePrompt: meta.negativePrompt || '',
    generationType: meta.generationType || 'unknown',
});

export const processWebFiles = async (files: File[]): Promise<ImportResult> => {
    const newImages: AIImage[] = [];
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;

        try {
            const objectUrl = URL.createObjectURL(file);
            const { metadata: meta, extra, isIntermediate } = await parseImageFile(file);

            // Intermediates are now imported but hidden by default in UI
            // Previously they were skipped here.

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
            errors++;
        }
    }

    return {
        images: newImages,
        stats: {
            processed: files.length,
            imported: newImages.length,
            skipped,
            errors
        }
    };
};

export const processNativePaths = async (
    paths: string[],
    thumbnailDir: string | undefined,
    onProgress?: (current: number, total: number, message?: string) => void,
    defaultTool?: GeneratorTool // Added argument
): Promise<ImportResult> => {
    const newImages: AIImage[] = [];
    let skipped = 0;
    let errors = 0;

    // 1. Resolve all paths (if a path is a directory, expand it recursively)
    const allPaths: string[] = [];
    if (onProgress) onProgress(0, paths.length, 'Scanning folders...');

    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (onProgress) onProgress(i, paths.length, `Scanning: ${p.split(/[\\/]/).pop() || p}`);
        try {
            const files = await invoke('scan_directory_recursive', { path: p }) as string[];
            if (files && files.length > 0) {
                allPaths.push(...files);
            } else {
                // If not a directory or no images found, keep as is (might be a single file)
                allPaths.push(p);
            }
        } catch (e) {
            allPaths.push(p);
        }
    }

    // 2. Batch size for bulk scanning
    const BATCH_SIZE = 50;
    const totalToProcess = allPaths.length;

    if (totalToProcess === 0) {
        return {
            images: [],
            stats: { processed: 0, imported: 0, skipped: 0, errors: 0 }
        };
    }

    if (onProgress) onProgress(0, totalToProcess, 'Processing images...');

    for (let i = 0; i < allPaths.length; i += BATCH_SIZE) {
        const chunk = allPaths.slice(i, i + BATCH_SIZE);

        try {
            // Optimization: Skip thumbnails for bulk import -> true
            const results = await scanImagesBulk(chunk, thumbnailDir || '', true, true, defaultTool);
            const batchImages: AIImage[] = [];

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const path = chunk[j];

                if (!result || (result as any).error) {
                    if ((result as any).error) {
                        if (!(result as any).is_directory) {
                            console.error(`Error importing ${path}`);
                            errors++;
                        }
                    }
                    continue;
                }

                // Intermediates are now imported but hidden by default in UI
                // Previously they were skipped here.

                const filename = path.split(/[\\/]/).pop() || 'unknown.png';
                const normPath = normalizePath(path);
                const assetUrl = convertFileSrc(normPath);
                const thumbPath = result.thumbnail || normPath;

                // Apply Folder Variant Logic
                // If the tool is "Automatic1111" (generic) or "Unknown", and we have a specific folder variant (e.g. Forge),
                // we upgrade the tool type to the specific variant.
                let finalTool = result.metadata.tool || GeneratorTool.UNKNOWN;
                if ((finalTool === GeneratorTool.AUTOMATIC1111 || finalTool === GeneratorTool.UNKNOWN) &&
                    defaultTool && defaultTool !== GeneratorTool.UNKNOWN && (defaultTool as string) !== 'Unknown') {
                    finalTool = defaultTool;
                }

                const newImg: AIImage = {
                    id: normPath,
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
                    metadata: {
                        ...mapMetadata(result.metadata),
                        tool: finalTool
                    }
                };

                batchImages.push(newImg);
                newImages.push(newImg);
            }

            // Sync Database in batches to ensure progress bar reflects completion
            const { insertImagesBatch } = await import('./db/imageRepo');
            await insertImagesBatch(batchImages);
        } catch (e) {
            console.error("Bulk scan failed for chunk", e);
            errors += chunk.length;
        }

        if (onProgress) {
            const current = Math.min(i + BATCH_SIZE, totalToProcess);
            onProgress(current, totalToProcess, `Importing: ${current} / ${totalToProcess}`);
        }
    }

    return {
        images: newImages,
        stats: {
            processed: totalToProcess,
            imported: newImages.length,
            skipped,
            errors
        }
    };
};
