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

export interface ImportOptions {
    onProgress?: (current: number, total: number, message?: string) => void;
    abortSignal?: AbortSignal;
    isStartup?: boolean;
    forceRescan?: boolean;
    skipThumbnail?: boolean;
}

interface FileEntry {
    path: string;
    modified: number;
    size: number;
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

// --- Core Helper: Process a list of FileEntries in batches ---
async function processFileEntries(
    entries: FileEntry[],
    stats: ImportStats,
    options: ImportOptions = {},
    defaultTool?: GeneratorTool
): Promise<AIImage[]> {
    const { onProgress, abortSignal, forceRescan, skipThumbnail = true } = options;
    const newImages: AIImage[] = [];

    // Sort by Modified Date (Newest First)
    entries.sort((a, b) => b.modified - a.modified);

    const allPaths = entries.map(e => e.path);

    // Filter duplicates
    let pathsToProcess = allPaths;
    if (!forceRescan) {
        if (onProgress) onProgress(0, allPaths.length, 'Checking for duplicates...');

        const existingPaths = await getExistingPaths(allPaths);
        pathsToProcess = allPaths.filter(p => !existingPaths.has(normalizePath(p)));
        stats.skipped += (allPaths.length - pathsToProcess.length);
    }

    if (pathsToProcess.length === 0) return [];

    const BATCH_SIZE = 300;
    const totalToProcess = pathsToProcess.length;

    for (let i = 0; i < totalToProcess; i += BATCH_SIZE) {
        if (abortSignal?.aborted) {
            console.log('Import cancelled by user');
            break;
        }

        const chunk = pathsToProcess.slice(i, i + BATCH_SIZE);
        // console.log(`[Import] Processing batch ${i / BATCH_SIZE + 1} (${chunk.length} files)`);

        try {
            // console.time(`scanBatch-${i}`);
            // true for extractWorkflow (always want full metadata)
            const results = await scanImagesBulk(chunk, '', skipThumbnail, true, defaultTool);
            // console.timeEnd(`scanBatch-${i}`);

            const batchImages: AIImage[] = [];

            for (let j = 0; j < results.length; j++) {
                const info = results[j];
                const path = chunk[j];

                if (info.errorReason) {
                    stats.errors++;
                    console.warn(`Scan error for ${path}:`, info.errorReason);
                    continue; // Skip valid object creation if hard error
                }

                // Create AIImage object
                const img: AIImage = {
                    id: normalizePath(path),
                    ...mapMetadata(info.metadata),
                    timestamp: info.timestamp,
                    width: info.width || 0,
                    height: info.height || 0,
                    fileSize: info.fileSize,
                    thumbnailUrl: info.thumbnail ? convertFileSrc(info.thumbnail) : '',
                    isFavorite: false,
                    isPinned: false,
                    isDeleted: false,
                    isIntermediate: info.isIntermediate || false,
                    metadata: info.metadata,
                    url: convertFileSrc(path),
                    thumbnailSource: info.thumbnailSource,
                    microThumbnail: info.microThumbnail
                };
                batchImages.push(img);
            }

            if (batchImages.length > 0) {
                // DB Insert/Update
                // console.time(`insertBatch-${i}`);
                const ids = batchImages.map(img => img.id);
                const { insertImagesBatch, getExistingMetadata } = await import('./db/imageRepo');
                const existingMeta = await getExistingMetadata(ids);

                const imagesToUpdate = batchImages.filter(img => {
                    const existing = existingMeta.get(img.id);
                    if (!existing) return true; // New

                    // Simple logic: if timestamp or size changed, update.
                    // For deeper metadata diff, we can enable it, but for speed we trust timestamp/size often.
                    if (existing.timestamp !== img.timestamp || existing.fileSize !== img.fileSize) return true;

                    // For robust import, we might check canonical metadata if needed, 
                    // but usually timestamp update is sufficient for FS changes.
                    // Keeping the deep check disabled for raw speed unless necessary.
                    return false;
                });

                if (imagesToUpdate.length > 0) {
                    await insertImagesBatch(imagesToUpdate);
                    stats.imported += imagesToUpdate.length;
                }
                // console.timeEnd(`insertBatch-${i}`);
            }

            newImages.push(...batchImages);
            stats.processed += chunk.length;

            if (onProgress) {
                onProgress(Math.min(i + BATCH_SIZE, totalToProcess), totalToProcess, `Importing images...`);
            }

        } catch (e) {
            console.error('Import batch error:', e);
            stats.errors += chunk.length;
        }
    }

    return newImages;
}

// --- Unified Folder Import ---
// Scans folders EFFICIENTLY (single IPC call per folder) then imports
// --- Unified Folder Import ---
// Scans folders EFFICIENTLY (single IPC call per folder) then imports
// Unified Folder Import
// Scans folders EFFICIENTLY (single IPC call per folder) then imports
export async function processFoldersUnified(
    folders: { path: string; variant?: GeneratorTool }[],
    options: ImportOptions = {}
): Promise<ImportResult> {
    const result: ImportResult = {
        images: [],
        stats: { processed: 0, imported: 0, skipped: 0, errors: 0 }
    };

    const { onProgress, abortSignal } = options;

    console.log(`[ImportUnified] Starting for ${folders.length} folders/items`);

    // 1. DISCOVERY PHASE: Scan all folders first to get specific file counts
    if (onProgress) onProgress(0, 0, `Analyzing ${folders.length} sources...`);

    interface ImportTask {
        variant: GeneratorTool | undefined;
        files: FileEntry[];
    }
    const tasks: ImportTask[] = [];
    let grandTotalFiles = 0;

    const byVariant = new Map<GeneratorTool | undefined, string[]>();
    for (const f of folders) {
        const v = f.variant;
        if (!byVariant.has(v)) byVariant.set(v, []);
        byVariant.get(v)?.push(f.path);
    }

    // B. Execute Scans
    for (const [variant, folderPaths] of byVariant.entries()) {
        if (abortSignal?.aborted) break;

        const filesForVariant: FileEntry[] = [];
        for (const folderPath of folderPaths) {
            try {
                if (onProgress) onProgress(0, 0, `Scanning ${normalizePath(folderPath)}...`);

                // Attempt to scan as directory first
                // Note: scanDirectoryWithStats should be recursive on backend
                const files = await unwrap(commands.scanDirectoryWithStats(folderPath));

                if (files && files.length > 0) {
                    filesForVariant.push(...files);
                    console.log(`[ImportUnified] Discovered ${files.length} files in ${folderPath}`);
                } else {
                    // If it returns empty, it might be a single file
                    // But scanDirectoryWithStats usually fails for files?
                    // Let's assume if it fails or returns 0, we treat it as a file if it's not a directory?
                    // For safety, we can check extension or try to add it as a single file entry if it exists.
                    // But for "Folders" mode, we assume folders.
                    console.log(`[ImportUnified] No files found in folder ${folderPath} (or path is file)`);

                    // Fallback: If it's a file path manually passed (Drag & Drop single file)
                    // We can check if it looks like an image.
                    if (folderPath.match(/\.(png|jpg|jpeg|webp)$/i)) {
                        filesForVariant.push({ path: folderPath, modified: Date.now(), size: 0 });
                    }
                }
            } catch (e) {
                console.warn(`[ImportUnified] Failed to scan ${folderPath} as directory. Treating as file?`, e);
                // Fallback for single files passed to this function
                filesForVariant.push({ path: folderPath, modified: Date.now(), size: 0 });
            }
        }

        if (filesForVariant.length > 0) {
            tasks.push({ variant, files: filesForVariant });
            grandTotalFiles += filesForVariant.length;
        }
    }

    console.log(`[ImportUnified] Discovery Complete. Total files to process: ${grandTotalFiles}`);

    // If grandTotal is 0, we should probably still return, but let's notify
    if (grandTotalFiles === 0) {
        if (onProgress) onProgress(0, 0, 'No valid images found.');
        return result;
    }

    // 2. PROCESSING PHASE: Import files with Global Progress
    let globalProcessed = 0;

    for (const task of tasks) {
        if (abortSignal?.aborted) break;

        // Adapter maps "Current Task Progress" -> "Global Progress"
        const progressAdapter = (current: number, total: number, message?: string) => {
            if (onProgress) {
                // current in batch + previously processed
                const actualCurrent = globalProcessed + current;
                // Ensure we don't exceed 100% due to math oddities
                const safeCurrent = Math.min(actualCurrent, grandTotalFiles);
                onProgress(safeCurrent, grandTotalFiles, message || `Importing images...`);
            }
        };

        const imported = await processFileEntries(
            task.files,
            result.stats,
            {
                ...options,
                onProgress: progressAdapter
            },
            task.variant
        );

        result.images.push(...imported);

        // precise increment
        globalProcessed += task.files.length;
    }

    // 3. Post-Import Cleanup
    try {
        const { rebuildFacetCache } = await import('./db/imageRepo');
        await rebuildFacetCache();
        useLibraryStore.getState().incrementFacetCacheVersion();
    } catch (e) {
        console.error('[Import] Failed cleanup', e);
    }

    return result;
}

export const processWebFiles = async (files: File[]): Promise<ImportResult> => {
    const newImages: AIImage[] = [];
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;

        try {
            const objectUrl = URL.createObjectURL(file);
            const { metadata: meta, extra } = await parseImageFile(file);

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
                isPinned: false, // Added missing prop
                isIntermediate: false, // Added missing prop
                metadata: mapMetadata(meta),
                thumbnailSource: 'generated',
                microThumbnail: undefined
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

/**
 * Canonical stringify to ignore key order for metadata comparison
 */
function canonicalStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    const allKeys = Object.keys(obj).sort();
    const result: any = {};
    for (const key of allKeys) {
        result[key] = canonicalStringify(obj[key]);
    }
    return JSON.stringify(result);
}

// Legacy Wrapper - maintains backward compatibility for file-list imports
export const processNativePaths = async (
    paths: string[],
    thumbDir?: string, // Ignored, handled internally
    onProgress?: (current: number, total: number, message?: string) => void,
    defaultTool?: GeneratorTool,
    abortSignal?: AbortSignal,
    isStartup: boolean = false,
    forceRescan: boolean = false
): Promise<ImportResult> => {

    // Convert string[] list to typed inputs for unified processor
    const foldersInput = paths.map(p => ({
        path: p,
        variant: defaultTool
    }));

    return processFoldersUnified(foldersInput, {
        onProgress,
        abortSignal,
        isStartup,
        forceRescan,
        skipThumbnail: false
    });
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

