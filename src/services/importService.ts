import { AIImage, GeneratorTool } from '../types';
import { parseImageFile, scanImageNative, scanImagesBulk } from './metadataParser';
import { insertImage } from './db/imageRepo';
import { convertFileSrc } from '@tauri-apps/api/core';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { normalizePath } from '../utils/pathUtils';
import { useLibraryStore } from '../stores/libraryStore';
import { getDb } from './db/connection';

/**
 * Queries the database for paths that already exist.
 * Used to skip already-imported files during rescan.
 */
const getExistingPaths = async (paths: string[]): Promise<Set<string>> => {
    if (paths.length === 0) return new Set();

    const db = await getDb();
    const CHUNK_SIZE = 900; // SQLite parameter limit
    const existingSet = new Set<string>();

    for (let i = 0; i < paths.length; i += CHUNK_SIZE) {
        const chunk = paths.slice(i, i + CHUNK_SIZE).map(normalizePath);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await db.select<{ id: string }[]>(
            `SELECT id FROM images WHERE id IN (${placeholders})`,
            chunk
        );
        rows.forEach(r => existingSet.add(r.id));
    }

    return existingSet;
};

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
    defaultTool?: GeneratorTool, // Added argument
    abortSignal?: AbortSignal
): Promise<ImportResult> => {
    const newImages: AIImage[] = [];
    let skipped = 0;
    let errors = 0;

    // 1. Resolve all paths (if a path is a directory, expand it recursively)
    // We now fetch stats (size, modified) to enable sorting by date
    interface FileEntry { path: string; modified: number; size: number; }
    let allEntries: FileEntry[] = [];

    if (onProgress) onProgress(0, paths.length, 'Scanning folders...');

    for (let i = 0; i < paths.length; i++) {
        if (abortSignal?.aborted) break;
        const p = paths[i];
        if (onProgress) onProgress(i, paths.length, `Scanning: ${p.split(/[\\/]/).pop() || p}`);
        try {
            // Check if directory first (naive check based on extension or by trying scan)
            // But verify_image_paths or similar helpers are better. 
            // For now we assume if it fails it might be a file.
            // Actually `scan_directory_with_stats` expects a directory path.
            // If it's a file, we should handle it gracefully or rely on the previous behavior?
            // Existing logic: scans recursively. If fails, assumes it's a file.

            // To support single files, we'd need to manually stat them or wrap them.
            // Let's try the recursive scan. If it returns empty or fails, we check if it is a file?
            // But valid single files passed to `scanDirectoryRecursive` previously failed or returned empty? 
            // Line 139: catch(e) { allPaths.push(p) }. 
            // So if scan fails (e.g. it's a file), we treat it as a file.
            // We need "stats" for single files too to sort them correctly.
            // But fetching stats for single files one by one in Rust is tedious here without a new command.
            // For drag-and-drop of 100 files, we might miss stats?
            // Let's assume folder imports are the main target for "bulk" sorting.
            // For single files, we can default modified to 0 (end of list) or try to fetch it?
            // Let's proceed with folder scanning support primarily.

            const entries = await unwrap(commands.scanDirectoryWithStats(p));
            if (entries && entries.length > 0) {
                allEntries.push(...entries);
            } else {
                // Fallback for single file or empty dir - no stats easily available without another call
                // We push with 0 modified time (will appear at end/random)
                allEntries.push({ path: p, modified: 0, size: 0 });
            }
        } catch (e) {
            // Likely a single file
            allEntries.push({ path: p, modified: 0, size: 0 });
        }
    }

    // Sort by Modified Date (Newest First)
    allEntries.sort((a, b) => b.modified - a.modified);

    const allPaths = allEntries.map(e => e.path);

    // 2. Pre-filter: Remove already-imported paths (optimization for rescan)
    if (onProgress) onProgress(0, allPaths.length, 'Checking for new files...');
    const existingPaths = await getExistingPaths(allPaths);
    const newPaths = allPaths.filter(p => !existingPaths.has(normalizePath(p)));

    const skippedExisting = allPaths.length - newPaths.length;
    if (skippedExisting > 0) {
        console.log(`[Import] Skipping ${skippedExisting} already-imported files`);
    }

    // 3. Batch size for bulk scanning
    const BATCH_SIZE = 50;
    const totalToProcess = newPaths.length;

    if (totalToProcess === 0) {
        return {
            images: [],
            stats: { processed: allPaths.length, imported: 0, skipped: skippedExisting, errors: 0 }
        };
    }

    if (onProgress) onProgress(0, totalToProcess, 'Processing images...');

    // First batch generates thumbnails for instant landing page experience
    const FIRST_BATCH_WITH_THUMBS = 100;

    for (let i = 0; i < newPaths.length; i += BATCH_SIZE) {
        if (abortSignal?.aborted) {
            console.log('Import cancelled by user');
            break;
        }
        const chunk = newPaths.slice(i, i + BATCH_SIZE);

        // Generate thumbnails for first batch, skip rest for speed (lazy generation later)
        // const isFirstBatch = i < FIRST_BATCH_WITH_THUMBS; // REMOVED: Inconsistent behavior
        // const skipThumbnail = !isFirstBatch;

        // STREAMLINED: Always skip valid thumbnail generation during import. 
        // We rely 100% on the background queue which starts immediately after import.
        // This ensures the import process is consistently fast (metadata only).
        const skipThumbnail = true;

        try {
            const results = await scanImagesBulk(chunk, thumbnailDir || '', skipThumbnail, true, defaultTool);
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
                    microThumbnail: result.microThumbnail || undefined,
                    thumbnailSource: result.thumbnailSource || undefined,
                    filename: filename,
                    fileSize: result.fileSize || 0,
                    timestamp: result.timestamp || Date.now(),
                    width: result.width || 0,
                    height: result.height || 0,
                    isFavorite: !!result.metadata.isFavorite || !!result.extra.isFavorite,
                    isDeleted: false,
                    isMissing: false,
                    metadata: {
                        ...mapMetadata(result.metadata),
                        tool: finalTool,
                        hasWorkflowHint: !!result.metadata.workflowJson
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

    // Rebuild facet cache once after all batches are processed
    try {
        const { rebuildFacetCache } = await import('./db/imageRepo');
        await rebuildFacetCache();
        // Increment version to trigger React Query refetch in useLibraryStatsQuery
        useLibraryStore.getState().incrementFacetCacheVersion();
    } catch (e) {
        console.error('[Import] Failed to rebuild facet cache after import', e);
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

export const scanResourceThumbnails = async (paths: string[]): Promise<{ found: number; updated: number }> => {
    try {
        const result = await unwrap(commands.scanModelThumbnails(paths));
        return result;
    } catch (e) {
        console.error('Failed to scan resource thumbnails', e);
        return { found: 0, updated: 0 };
    }
};

