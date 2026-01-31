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

// Helper for deep equality check ignoring key order
function canonicalStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalStringify).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalStringify(obj[key])).join(',') + '}';
}

export const processNativePaths = async (
    paths: string[],
    thumbDir?: string,
    onProgress?: (current: number, total: number, message?: string) => void,
    defaultTool?: GeneratorTool,
    abortSignal?: AbortSignal,
    isStartup: boolean = false,
    forceRescan: boolean = false
): Promise<ImportResult> => {
    const newImages: AIImage[] = [];
    let skipped = 0;
    let errors = 0;

    // 1. Resolve all paths (if a path is a directory, expand it recursively)
    // We now fetch stats (size, modified) to enable sorting by date
    interface FileEntry { path: string; modified: number; size: number; }
    let allEntries: FileEntry[] = [];

    if (onProgress) {
        if (isStartup) {
            onProgress(0, 0, 'Scanning folders...');
        } else {
            onProgress(0, paths.length, 'Scanning folders...');
        }
    }

    for (let i = 0; i < paths.length; i++) {
        if (abortSignal?.aborted) break;
        const p = paths[i];
        if (onProgress && !isStartup) {
            onProgress(i, paths.length, `Scanning folder ${i + 1}/${paths.length}: ${p.split(/[\\/]/).pop() || p}`);
        }
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
    // Only check for duplicates if NOT forcing a rescan
    let newPaths = allPaths;
    let skippedExisting = 0;

    if (!forceRescan) {
        if (onProgress) {
            if (isStartup) {
                onProgress(0, 0, 'Checking for new files...');
            } else {
                onProgress(0, allPaths.length, `Checking ${allPaths.length} files for duplicates...`);
            }
        }
        const existingPaths = await getExistingPaths(allPaths);
        newPaths = allPaths.filter(p => !existingPaths.has(normalizePath(p)));
        skippedExisting = allPaths.length - newPaths.length;

        if (skippedExisting > 0) {
            console.log(`[Import] Skipping ${skippedExisting} already-imported files`);
        }
    } else {
        console.log(`[Import] Force Rescan enabled. Processing all ${allPaths.length} paths.`);
    }

    // 3. Batch size for bulk scanning
    const BATCH_SIZE = 300;
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
        console.log(`[Import] Processing batch ${i / BATCH_SIZE + 1} (${chunk.length} files)`);

        // Default behavior: Skip generation on Import.
        const skipThumbnail = true;

        try {
            console.time(`scanBatch-${i}`);
            // true for extractWorkflow (always want this for full metadata)
            const results = await scanImagesBulk(chunk, thumbDir || '', skipThumbnail, true, defaultTool);
            console.timeEnd(`scanBatch-${i}`);

            const batchImages: AIImage[] = [];

            for (let j = 0; j < results.length; j++) {
                const info = results[j];
                const path = chunk[j];

                if (info.errorReason) {
                    errors++;
                    console.warn(`Scan error for ${path}:`, info.errorReason);
                }

                const img: AIImage = {
                    id: normalizePath(path),
                    ...mapMetadata(info.metadata), // merges tool, model, etc
                    timestamp: info.timestamp,
                    width: info.width || 0,
                    height: info.height || 0,
                    fileSize: info.fileSize,
                    thumbnailUrl: info.thumbnail ? convertFileSrc(info.thumbnail) : '', // Rust returns absolute path
                    isFavorite: false, // Default for object, DB COALESCE will overwrite with existing
                    isPinned: false,
                    isDeleted: false,
                    isIntermediate: info.isIntermediate || false,
                    metadata: info.metadata, // Full JSON
                    url: convertFileSrc(path), // For frontend display
                    thumbnailSource: info.thumbnailSource,
                    microThumbnail: info.microThumbnail
                };

                batchImages.push(img);
            }

            if (batchImages.length > 0) {
                // OPTIMIZATION: Read-First Check
                // Query DB for existing timestamps/sizes to avoid unnecessary write transactions.
                // This prevents lock contention by skipping the INSERT entirely for unchanged files.
                const ids = batchImages.map(img => img.id);
                const { insertImagesBatch, getExistingMetadata } = await import('./db/imageRepo');
                const existingMeta = await getExistingMetadata(ids);
                let mismatchCount = 0;

                const imagesToUpdate = batchImages.filter(img => {
                    const existing = existingMeta.get(img.id);
                    if (!existing) {
                        // console.log(`[Import-Diff] New file detected: ${img.id}`); 
                        return true;
                    }

                    // Check if changed
                    if (existing.timestamp !== img.timestamp) {
                        console.log(`[Import-Diff] Update reason: TIMESTAMP ${existing.timestamp} vs ${img.timestamp} for ${img.id}`);
                        return true;
                    }
                    if (existing.fileSize !== img.fileSize) {
                        console.log(`[Import-Diff] Update reason: SIZE ${existing.fileSize} vs ${img.fileSize} for ${img.id}`);
                        return true;
                    }

                    // Metadata Check: Use Canonical Stringify to ignore key order
                    const newMetaStr = canonicalStringify(img.metadata);

                    // Existing is string, parse it first to sort keys, then re-stringify
                    // This is slightly expensive but way cheaper than a DB write
                    let oldMetaCanonical = existing.metadataJson;
                    try {
                        const oldObj = JSON.parse(existing.metadataJson);
                        oldMetaCanonical = canonicalStringify(oldObj);
                    } catch (e) {
                        // if parse fails, fallback to strict string comparison
                    }

                    if (newMetaStr !== oldMetaCanonical) {
                        mismatchCount++;
                        if (mismatchCount <= 5) {
                            console.log(`[Import-Diff] Update reason: METADATA mismatch for ${img.id}`);
                        }

                        // LOG ACTUAL DIFF FOR FIRST MISMATCH IN BATCH
                        if (mismatchCount === 1) {
                            try {
                                const oldObj = JSON.parse(existing.metadataJson);
                                const newObj = img.metadata as any;

                                // Check for value mismatches or new keys
                                const addedOrChangedKeys = Object.keys(newObj).filter(k =>
                                    canonicalStringify(newObj[k]) !== canonicalStringify(oldObj[k])
                                );

                                // Check for removed keys (present in OLD but missing in NEW)
                                const removedKeys = Object.keys(oldObj).filter(k => !(k in newObj));

                                if (addedOrChangedKeys.length > 0 || removedKeys.length > 0) {
                                    console.log(`[Import-Diff] Diff Report for ${img.id}`);

                                    if (addedOrChangedKeys.length > 0) {
                                        console.log(`  CHANGED/ADDED keys:`, addedOrChangedKeys.slice(0, 3));
                                        addedOrChangedKeys.slice(0, 1).forEach(k => {
                                            console.log(`    Key: ${k}`);
                                            console.log(`    OLD:`, oldObj[k]);
                                            console.log(`    NEW:`, newObj[k]);
                                        });
                                    }

                                    if (removedKeys.length > 0) {
                                        console.log(`  REMOVED keys (in DB but not in Scan):`, removedKeys.slice(0, 3));
                                        removedKeys.slice(0, 1).forEach(k => {
                                            console.log(`    Key: ${k}`);
                                            console.log(`    Value was:`, oldObj[k]);
                                        });
                                    }
                                }
                            } catch (e) {
                                console.error('[Import-Diff] Failed to diff', e);
                            }
                        }

                        return true;
                    }

                    return false;
                });

                if (imagesToUpdate.length > 0) {
                    console.log(`[Import] updating ${imagesToUpdate.length}/${batchImages.length} images in batch`);
                    console.time(`insertBatch-${i}`);
                    await insertImagesBatch(imagesToUpdate);
                    console.timeEnd(`insertBatch-${i}`);
                } else {
                    console.log(`[Import] Batch ${i / BATCH_SIZE + 1} skipped (no changes)`);
                }
            }

            newImages.push(...batchImages);

            const currentProgress = Math.min(i + BATCH_SIZE, totalToProcess);
            if (onProgress) onProgress(currentProgress, totalToProcess, `Processed ${currentProgress}/${totalToProcess}`);

        } catch (e) {
            console.error('Import batch error:', e);
            errors += chunk.length; // Approximate
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

