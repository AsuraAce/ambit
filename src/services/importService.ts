import { AIImage, FacetType, GeneratorTool, ImageMetadata } from '../types';
import { parseImageFile, scanImageNative, scanImagesBulk } from './metadataParser';
import { insertImage } from './db/imageRepo';
import { convertFileSrc } from '@tauri-apps/api/core';
import { commands, type ThumbnailScanResult } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { normalizePath } from '../utils/pathUtils';
import { useLibraryStore } from '../stores/libraryStore';
import { getDb } from './db/connection';
import {
    collectTouchedFacetResourcesFromMetadataDiff,
    collectTouchedFacetTypesFromMetadataDiff,
    createEmptyTouchedFacetResources,
    mergeTouchedFacetResources,
    orderFacetTypes,
    TouchedFacetResources
} from '../utils/touchedFacetTypes';
import {
    createLiveWatchPerfId,
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    liveWatchNow,
    TargetedLiveSyncPerfContext,
} from '../utils/liveWatchPerf';

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
            `SELECT id FROM images WHERE id IN (${placeholders})
             UNION
             SELECT id FROM removed_images WHERE id IN (${placeholders})`,
            [...chunk, ...chunk]
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
    handledPaths: string[];
    failedPaths: string[];
    touchedFacetTypes: FacetType[];
    touchedFacetResources: TouchedFacetResources;
}

export interface ImportOptions {
    onProgress?: (current: number, total: number, message?: string) => void;
    abortSignal?: AbortSignal;
    isStartup?: boolean;
    forceRescan?: boolean;
    skipThumbnail?: boolean;
    waitForStableFiles?: boolean;
    deferFacetCacheRefresh?: boolean;
    perfContext?: TargetedLiveSyncPerfContext;
}

interface FileEntry {
    path: string;
    modified: number;
    size: number;
}

const FILE_STABILITY_POLL_MS = 500;
const FILE_STABILITY_MAX_POLLS = 12;
const FILE_STABILITY_REQUIRED_POLLS = 2;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function waitForStableFileSizes(
    paths: string[],
    onProgress?: (current: number, total: number, message?: string) => void
) {
    if (paths.length === 0) return;

    const states = new Map<string, { size: number; stablePolls: number }>();
    let pendingPaths = [...paths];

    for (let poll = 0; poll < FILE_STABILITY_MAX_POLLS && pendingPaths.length > 0; poll++) {
        onProgress?.(0, paths.length, `Waiting for ${pendingPaths.length} file(s) to finish writing...`);

        let sizes: number[] = [];
        try {
            sizes = await unwrap(commands.getFileSizesBulk(pendingPaths));
        } catch (error) {
            console.warn('[Import] File stability probe failed; retrying before import.', error);
            await delay(FILE_STABILITY_POLL_MS);
            continue;
        }

        pendingPaths = pendingPaths.filter((path, index) => {
            const size = sizes[index] ?? 0;
            const previous = states.get(path);
            const stablePolls = size > 0 && previous?.size === size
                ? previous.stablePolls + 1
                : 0;

            states.set(path, { size, stablePolls });
            return stablePolls < FILE_STABILITY_REQUIRED_POLLS;
        });

        if (pendingPaths.length > 0) {
            await delay(FILE_STABILITY_POLL_MS);
        }
    }

    if (pendingPaths.length > 0) {
        console.warn(`[Import] ${pendingPaths.length} file(s) did not stabilize before import; continuing.`);
    }
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
): Promise<{ images: AIImage[]; handledPaths: string[]; failedPaths: string[]; touchedFacetTypes: FacetType[]; touchedFacetResources: TouchedFacetResources }> {
    const { onProgress, abortSignal, forceRescan, skipThumbnail = true, waitForStableFiles, perfContext } = options;
    const newImages: AIImage[] = [];
    const handledPaths: string[] = [];
    const failedPaths: string[] = [];
    const importStartedAt = liveWatchNow();
    const cycleId = perfContext?.cycleId ?? createLiveWatchPerfId('import');
    const touchedFacetTypes = new Set<FacetType>();
    let touchedFacetResources = createEmptyTouchedFacetResources();

    // Sort by Modified Date (Newest First)
    entries.sort((a, b) => b.modified - a.modified);

    const allPaths = entries.map(e => e.path);

    // Filter duplicates
    let pathsToProcess = allPaths;
    if (!forceRescan) {
        if (onProgress) onProgress(0, allPaths.length, 'Checking for duplicates...');

        const existingLookupStartedAt = liveWatchNow();
        const existingPaths = await getExistingPaths(allPaths);
        pathsToProcess = allPaths.filter(p => !existingPaths.has(normalizePath(p)));
        stats.skipped += (allPaths.length - pathsToProcess.length);
        debugLiveWatchPerf('Import duplicate check complete', {
            cycleId,
            candidatePathCount: allPaths.length,
            existingPathCount: existingPaths.size,
            skippedPathCount: allPaths.length - pathsToProcess.length,
            duplicateCheckMs: elapsedMs(existingLookupStartedAt)
        });
    }

    if (pathsToProcess.length === 0) {
        infoLiveWatchPerf('Import processing complete', {
            cycleId,
            source: perfContext?.source,
            candidatePathCount: allPaths.length,
            processedPathCount: stats.processed,
            importedCount: stats.imported,
            skippedCount: stats.skipped,
            errorCount: stats.errors,
            handledPathCount: handledPaths.length,
            failedPathCount: failedPaths.length,
            totalMs: elapsedMs(importStartedAt)
        });
        return { images: [], handledPaths, failedPaths, touchedFacetTypes: [], touchedFacetResources: createEmptyTouchedFacetResources() };
    }

    if (waitForStableFiles) {
        await waitForStableFileSizes(pathsToProcess, onProgress);
    }

    const BATCH_SIZE = 300;
    const totalToProcess = pathsToProcess.length;

    for (let i = 0; i < totalToProcess; i += BATCH_SIZE) {
        if (abortSignal?.aborted) {
            console.log('Import cancelled by user');
            break;
        }

        const chunk = pathsToProcess.slice(i, i + BATCH_SIZE);
        // console.log(`[Import] Processing batch ${i / BATCH_SIZE + 1} (${chunk.length} files)`);

        let unlisten: (() => void) | null = null;
        try {
            const batchStartedAt = liveWatchNow();
            // Setup listener for native progress stream for silky smooth UI loading bars
            const { listen } = await import('@tauri-apps/api/event');
            unlisten = await listen<{current: number, total: number, message: string}>('import_progress', (e) => {
                if (onProgress) {
                    const absCurrent = Math.min(i + e.payload.current, totalToProcess);
                    onProgress(absCurrent, totalToProcess, e.payload.message);
                }
            });

            // true for extractWorkflow (always want full metadata)
            const scanStartedAt = liveWatchNow();
            const results = await scanImagesBulk(chunk, '', skipThumbnail, true, defaultTool);
            const scanMs = elapsedMs(scanStartedAt);


            const batchImages: AIImage[] = [];

            for (let j = 0; j < results.length; j++) {
                const info = results[j];
                const path = chunk[j];

                if (info.errorReason) {
                    stats.errors++;
                    console.warn(`Scan error for ${path}:`, info.errorReason);
                    failedPaths.push(normalizePath(path));
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
                    microThumbnail: info.microThumbnail,
                    originalChunks: info.originalChunks,
                };
                if (j === 0) {
                    console.log(`[ImportDebug] Img ${path} - OrigChunks keys:`, info.originalChunks ? Object.keys(info.originalChunks) : 'undefined');
                }
                batchImages.push(img);
            }

            if (batchImages.length > 0) {
                // DB Insert/Update
                // console.time(`insertBatch-${i}`);
                const ids = batchImages.map(img => img.id);
                const { insertImagesBatch, getExistingMetadata } = await import('./db/imageRepo');
                const existingMetaStartedAt = liveWatchNow();
                const existingMeta = await getExistingMetadata(ids);
                const existingMetadataMs = elapsedMs(existingMetaStartedAt);

                batchImages.forEach(img => {
                    const existing = existingMeta.get(img.id);
                    if (!existing) return;

                    img.isFavorite = existing.isFavorite;
                    img.isPinned = existing.isPinned;
                    img.boardId = existing.boardId;
                    img.groupId = existing.groupId;
                    img.notes = existing.notes;
                });

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

                imagesToUpdate.forEach(img => {
                    const existing = existingMeta.get(img.id);
                    let previousMetadata: Partial<ImageMetadata> | undefined;

                    if (existing?.metadataJson) {
                        try {
                            previousMetadata = JSON.parse(existing.metadataJson) as Partial<ImageMetadata>;
                        } catch (error) {
                            console.warn('[Import] Failed to parse existing metadata during facet diff', error);
                        }
                    }

                    collectTouchedFacetTypesFromMetadataDiff(previousMetadata, img.metadata).forEach(type => {
                        touchedFacetTypes.add(type);
                    });
                    touchedFacetResources = mergeTouchedFacetResources(
                        touchedFacetResources,
                        collectTouchedFacetResourcesFromMetadataDiff(previousMetadata, img.metadata)
                    );
                });

                let upsertMs = 0;
                if (imagesToUpdate.length > 0) {
                    const upsertStartedAt = liveWatchNow();
                    await insertImagesBatch(imagesToUpdate);
                    upsertMs = elapsedMs(upsertStartedAt);
                    stats.imported += imagesToUpdate.length;
                }
                debugLiveWatchPerf('Import batch stage timings', {
                    cycleId,
                    batchIndex: Math.floor(i / BATCH_SIZE) + 1,
                    batchPathCount: chunk.length,
                    scannedPathCount: results.length,
                    batchImageCount: batchImages.length,
                    upsertCount: imagesToUpdate.length,
                    scanMs,
                    existingMetadataMs,
                    upsertMs,
                    batchMs: elapsedMs(batchStartedAt)
                });
                // console.timeEnd(`insertBatch-${i}`);
            } else {
                debugLiveWatchPerf('Import batch stage timings', {
                    cycleId,
                    batchIndex: Math.floor(i / BATCH_SIZE) + 1,
                    batchPathCount: chunk.length,
                    scannedPathCount: results.length,
                    batchImageCount: 0,
                    upsertCount: 0,
                    scanMs,
                    existingMetadataMs: 0,
                    upsertMs: 0,
                    batchMs: elapsedMs(batchStartedAt)
                });
            }

            newImages.push(...batchImages);
            handledPaths.push(...batchImages.map(img => img.id));
            stats.processed += chunk.length;

            if (onProgress) {
                onProgress(Math.min(i + BATCH_SIZE, totalToProcess), totalToProcess, `Importing images...`);
            }

        } catch (e) {
            console.error('Import batch error:', e);
            stats.errors += chunk.length;
            failedPaths.push(...chunk.map(path => normalizePath(path)));
        } finally {
            unlisten?.();
        }
    }

    infoLiveWatchPerf('Import processing complete', {
        cycleId,
        source: perfContext?.source,
        candidatePathCount: allPaths.length,
        processedPathCount: stats.processed,
        importedCount: stats.imported,
        skippedCount: stats.skipped,
        errorCount: stats.errors,
        handledPathCount: handledPaths.length,
        failedPathCount: failedPaths.length,
        totalMs: elapsedMs(importStartedAt)
    });

    return { images: newImages, handledPaths, failedPaths, touchedFacetTypes: orderFacetTypes(touchedFacetTypes), touchedFacetResources };
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
        stats: { processed: 0, imported: 0, skipped: 0, errors: 0 },
        handledPaths: [],
        failedPaths: [],
        touchedFacetTypes: [],
        touchedFacetResources: createEmptyTouchedFacetResources()
    };

    const { onProgress, abortSignal, deferFacetCacheRefresh = false } = options;

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

        result.images.push(...imported.images);
        result.handledPaths.push(...imported.handledPaths);
        result.failedPaths.push(...imported.failedPaths);
        result.touchedFacetTypes = orderFacetTypes([
            ...result.touchedFacetTypes,
            ...imported.touchedFacetTypes
        ]);
        result.touchedFacetResources = mergeTouchedFacetResources(
            result.touchedFacetResources,
            imported.touchedFacetResources
        );

        // precise increment
        globalProcessed += task.files.length;
    }

    // 3. Post-Import Cleanup
    // Fire-and-forget so we do not block the UI from immediately fetching and displaying the images.
    // Startup smart scans can defer this so useFolderMonitor can run one bounded incremental refresh.
    if (!deferFacetCacheRefresh) {
        import('./db/imageRepo').then(({ rebuildFacetCache }) => {
            rebuildFacetCache()
                .then(() => useLibraryStore.getState().incrementFacetCacheVersion())
                .catch(e => console.error('[Import] Failed cleanup', e));
        });
    } else {
        console.info('[ImportUnified] Deferred facet cache refresh to startup catch-up coordinator.', {
            processed: result.stats.processed,
            imported: result.stats.imported,
            touchedFacetTypes: result.touchedFacetTypes
        });
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
        },
        handledPaths: [],
        failedPaths: [],
        touchedFacetTypes: [],
        touchedFacetResources: createEmptyTouchedFacetResources()
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
    forceRescan: boolean = false,
    waitForStableFiles: boolean = isStartup,
    deferFacetCacheRefresh: boolean = false
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
        waitForStableFiles,
        deferFacetCacheRefresh,
        skipThumbnail: false
    });
};

export const processTargetedFiles = async (
    paths: string[],
    options: ImportOptions = {},
    defaultTool?: GeneratorTool
): Promise<ImportResult> => {
    const result: ImportResult = {
        images: [],
        stats: { processed: 0, imported: 0, skipped: 0, errors: 0 },
        handledPaths: [],
        failedPaths: [],
        touchedFacetTypes: [],
        touchedFacetResources: createEmptyTouchedFacetResources()
    };

    if (paths.length === 0) return result;
    const targetedImportStartedAt = liveWatchNow();

    const entries: FileEntry[] = paths.map(p => ({ 
        path: p, 
        modified: Date.now(), 
        size: 0 // Will be read by rust metadata extractor anyway
    }));

    console.log(`[Import] Processing ${paths.length} targeted paths...`);
    const imported = await processFileEntries(entries, result.stats, options, defaultTool);
    result.images = imported.images;
    result.handledPaths = imported.handledPaths;
    result.failedPaths = imported.failedPaths;
    result.touchedFacetTypes = imported.touchedFacetTypes;
    result.touchedFacetResources = imported.touchedFacetResources;

    // Live Watch keeps the grid responsive here and lets SyncContext queue the
    // targeted incremental facet refresh immediately after the import settles.
    infoLiveWatchPerf('Targeted import complete', {
        cycleId: options.perfContext?.cycleId,
        source: options.perfContext?.source,
        inputPathCount: paths.length,
        handledPathCount: result.handledPaths.length,
        failedPathCount: result.failedPaths.length,
        importedCount: result.stats.imported,
        totalMs: elapsedMs(targetedImportStartedAt)
    });
    return result;
};

export const scanResourceThumbnails = async (paths: string[]): Promise<ThumbnailScanResult> => {
    try {
        const result = await unwrap(commands.scanModelThumbnails(paths));
        return result;
    } catch (e) {
        console.error('Failed to scan resource thumbnails', e);
        throw e;
    }
};
