import { AIImage, GeneratorTool } from '../types';
import { parseImageFile, scanImageNative, scanImagesBulk } from './metadataParser';
import { insertImage } from './db/imageRepo';
import { convertFileSrc } from '@tauri-apps/api/core';
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

            if (isIntermediate) {
                skipped++;
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
    onProgress?: (current: number, total: number) => void
): Promise<ImportResult> => {
    const newImages: AIImage[] = [];
    let skipped = 0;
    let errors = 0;

    // Batch size for bulk scanning
    const BATCH_SIZE = 50;

    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
        const chunk = paths.slice(i, i + BATCH_SIZE);

        try {
            // Optimization: Skip thumbnails for bulk import -> true
            const results = await scanImagesBulk(chunk, thumbnailDir || '', true);

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                const path = chunk[j];

                if (!result || (result as any).error) {
                    if ((result as any).error) {
                        console.error(`Error importing ${path}`);
                        errors++;
                    }
                    continue;
                }

                if (result.isIntermediate) {
                    skipped++;
                    continue;
                }

                const filename = path.split(/[\\/]/).pop() || 'unknown.png';
                const normPath = normalizePath(path);
                const assetUrl = convertFileSrc(normPath);
                const thumbPath = result.thumbnail || normPath;

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
                    metadata: mapMetadata(result.metadata)
                };

                newImages.push(newImg);

                // Fire and forget db insert
                insertImage(newImg).catch(e => console.error("DB Insert failed", e));
            }
        } catch (e) {
            console.error("Bulk scan failed for chunk", e);
            errors += chunk.length;
        }

        if (onProgress) onProgress(Math.min(i + BATCH_SIZE, paths.length), paths.length);
    }

    return {
        images: newImages,
        stats: {
            processed: paths.length,
            imported: newImages.length,
            skipped,
            errors
        }
    };
};
