import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { scanImageNative, scanImagesBulk } from './metadataParser';
import { AIImage } from '../types';

let cachedThumbnailDir: string | null = null;

// Throttling: Track in-progress generation to prevent memory spikes
const generationInProgress = new Set<string>();
const MAX_CONCURRENT_SINGLE = 5;

export const getThumbnailDir = async (): Promise<string | undefined> => {
    if (cachedThumbnailDir) return cachedThumbnailDir;
    try {
        const appData = await appLocalDataDir();
        const thumbPath = await join(appData, '.thumbnails');
        cachedThumbnailDir = thumbPath;
        return thumbPath;
    } catch (e) {
        console.error("Failed to resolve thumbnail dir", e);
        return undefined;
    }
};

/**
 * Generate a single thumbnail on-demand with throttling.
 * Used when an image fails to load its thumbnail (lazy generation).
 * Returns null if already generating or at capacity.
 */
export const generateSingleThumbnail = async (imagePath: string): Promise<string | null> => {
    // Skip if already generating this image
    if (generationInProgress.has(imagePath)) {
        return null;
    }

    // Skip if at capacity (caller will retry on next scroll/render)
    if (generationInProgress.size >= MAX_CONCURRENT_SINGLE) {
        return null;
    }

    generationInProgress.add(imagePath);

    try {
        const thumbDir = await getThumbnailDir();
        if (!thumbDir) {
            console.warn("[Thumb] No thumbnail dir resolved");
            return null;
        }

        // Force generation: skipThumbnail=false, extractWorkflow=false (speed)
        const result = await scanImageNative(imagePath, thumbDir, false, false);

        return result.thumbnail || null;
    } catch (e) {
        console.error(`[Thumb] Failed to generate for ${imagePath}:`, e);
        return null;
    } finally {
        generationInProgress.delete(imagePath);
    }
};

/**
 * Regenerate thumbnails for multiple images and persist to DB.
 */
export const regenerateThumbnailsForImages = async (
    candidates: AIImage[],
    onProgress?: (current: number, total: number) => void,
    signal?: AbortSignal
): Promise<AIImage[]> => {
    const thumbDir = await getThumbnailDir();
    if (!thumbDir || candidates.length === 0) return [];

    let processed = 0;
    const total = candidates.length;
    const updates: AIImage[] = [];
    const dbUpdates: { id: string; thumbnailPath: string; thumbnailSource: string }[] = [];
    const BATCH_SIZE = 100;

    // Process in batches
    for (let i = 0; i < total; i += BATCH_SIZE) {
        // Check for cancellation between batches
        if (signal?.aborted) {
            console.log('[Thumb] Regeneration cancelled by user');
            break;
        }

        const batch = candidates.slice(i, i + BATCH_SIZE);
        const paths = batch.map(img => img.id);

        try {
            // fast-scan with extractWorkflow: false
            const results = await scanImagesBulk(paths, thumbDir, false, false);

            // Match results back to images
            results.forEach((res, idx) => {
                if (res.thumbnail) {
                    updates.push({ ...batch[idx], thumbnailUrl: res.thumbnail });
                    dbUpdates.push({ id: batch[idx].id, thumbnailPath: res.thumbnail, thumbnailSource: 'ambit' });
                }
            });

        } catch (e) {
            console.error(`Failed to bulk gen thumbs for batch starting at ${i}`, e);
        }

        processed += batch.length;
        if (onProgress) onProgress(Math.min(processed, total), total);
    }

    // Persist all updates to DB in one batch
    if (dbUpdates.length > 0) {
        try {
            const { updateThumbnailPathsBatch } = await import('./db/imageRepo');
            await updateThumbnailPathsBatch(dbUpdates);
        } catch (e) {
            console.error('[Thumb] Failed to persist thumbnail updates to DB', e);
        }
    }

    return updates;
};

/**
 * Regenerate thumbnails for ALL unoptimized images in the library.
 * Uses paginated ID fetching to avoid loading all data into memory.
 * This is the "Regenerate All" action that processes everything in background.
 */
export const regenerateAllUnoptimized = async (
    onProgress?: (current: number, total: number) => void,
    signal?: AbortSignal,
    whereClause: string = '',
    params: any[] = [],
    includeUpgradeable: boolean = false
): Promise<number> => {
    const thumbDir = await getThumbnailDir();
    if (!thumbDir) return 0;

    const { getUnoptimizedImagesCount, getUnoptimizedImageEntries } = await import('./db/maintenanceRepo');
    const { updateThumbnailPathsBatch } = await import('./db/imageRepo');

    // Get total count first
    const total = await getUnoptimizedImagesCount(whereClause, params, includeUpgradeable);
    if (total === 0) return 0;

    let processed = 0;
    let generated = 0;
    const PAGE_SIZE = 500; // Fetch 500 IDs at a time from DB
    const BATCH_SIZE = 150; // Process 150 at a time for thumbnail generation

    // Process in pages
    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
        if (signal?.aborted) {
            console.log('[Thumb] Regeneration cancelled by user');
            break;
        }

        // Fetch next page of IDs
        const entries = await getUnoptimizedImageEntries(offset, PAGE_SIZE, whereClause, params, includeUpgradeable);
        if (entries.length === 0) break;

        // Process this page in batches
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            if (signal?.aborted) break;

            const batchEntries = entries.slice(i, i + BATCH_SIZE);
            const batchIds = batchEntries.map(e => e.id);
            const batchPaths = batchEntries.map(e => e.path);
            const dbUpdates: { id: string; thumbnailPath: string; thumbnailSource: string }[] = [];

            try {
                const results = await scanImagesBulk(batchPaths, thumbDir, false, false);
                results.forEach((res, idx) => {
                    if (res.thumbnail) {
                        dbUpdates.push({ id: batchIds[idx], thumbnailPath: res.thumbnail, thumbnailSource: 'ambit' });
                        generated++;
                    }
                });
            } catch (e) {
                console.error(`[Thumb] Batch failed at offset ${offset + i}`, e);
            }

            // Persist batch to DB immediately (don't accumulate all in memory)
            if (dbUpdates.length > 0) {
                try {
                    await updateThumbnailPathsBatch(dbUpdates);
                } catch (e) {
                    console.error('[Thumb] DB persist failed', e);
                }
            }

            processed += batchIds.length;
            onProgress?.(Math.min(processed, total), total);
        }
    }

    console.log(`[Thumb] Regeneration complete: ${generated} thumbnails generated`);
    return generated;
};

/**
 * Clean up orphan thumbnail files that are no longer referenced in the database.
 * Returns the number of files cleaned up.
 */
export const cleanupOrphanThumbnails = async (): Promise<number> => {
    const thumbDir = await getThumbnailDir();
    if (!thumbDir) return 0;

    const { readDir, remove } = await import('@tauri-apps/plugin-fs');
    const { getDb } = await import('./db/connection');
    const { normalizePath } = await import('../utils/pathUtils');

    // Get all thumbnail files on disk
    let files: { name: string }[];
    try {
        files = await readDir(thumbDir);
    } catch {
        return 0; // Directory doesn't exist yet
    }

    // Get all valid thumbnail paths from DB
    const db = await getDb();
    const rows = await db.select<{ thumbnail_path: string }[]>(
        'SELECT thumbnail_path FROM images WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ""'
    );

    // Build set of valid thumbnail filenames (not full paths, just filenames for comparison)
    const validFilenames = new Set<string>();
    for (const row of rows) {
        const fullPath = normalizePath(row.thumbnail_path);
        const parts = fullPath.split(/[\\/]/);
        const filename = parts[parts.length - 1];
        if (filename) validFilenames.add(filename.toLowerCase());
    }

    // Delete orphans
    let cleaned = 0;
    for (const file of files) {
        if (!validFilenames.has(file.name.toLowerCase())) {
            try {
                const fullPath = await join(thumbDir, file.name);
                await remove(fullPath);
                cleaned++;
            } catch (e) {
                console.warn(`[Thumb] Failed to remove orphan: ${file.name}`, e);
            }
        }
    }

    if (cleaned > 0) {
        console.log(`[Thumb] Cleaned up ${cleaned} orphan thumbnails`);
    }

    return cleaned;
};

/**
 * Sync existing thumbnails on disk to the database.
 * This "heals" thumbnails that were generated before the persistence fix.
 * It re-runs the thumbnail generation which is fast because Rust skips files that already exist.
 * @param onProgress Optional progress callback
 * @returns Number of thumbnails synced
 */
export const syncExistingThumbnailsToDB = async (
    onProgress?: (current: number, total: number) => void
): Promise<number> => {
    const thumbDir = await getThumbnailDir();
    if (!thumbDir) return 0;

    const { getDb } = await import('./db/connection');
    const { normalizePath } = await import('../utils/pathUtils');
    const { convertFileSrc } = await import('@tauri-apps/api/core');

    // Get all images that don't have a thumbnail_path set
    const db = await getDb();
    const rows = await db.select<{ id: string }[]>(
        'SELECT id FROM images WHERE thumbnail_path IS NULL OR thumbnail_path = ""'
    );

    if (rows.length === 0) {
        console.log('[Thumb] All images already have thumbnails in DB');
        return 0;
    }

    console.log(`[Thumb] Syncing ${rows.length} images without thumbnail paths...`);

    // Build fake AIImage objects with just enough data for regeneration
    const candidates = rows.map(row => ({
        id: row.id,
        url: convertFileSrc(normalizePath(row.id)),
        thumbnailUrl: convertFileSrc(normalizePath(row.id)), // Same as url triggers regen
    }));

    // Regenerate thumbnails - this is fast because Rust skips existing files on disk
    // and just returns the path. The regenerateThumbnailsForImages now persists to DB.
    const BATCH_SIZE = 100;
    let synced = 0;
    const updates: { id: string; thumbnailPath: string; thumbnailSource: string }[] = [];

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const paths = batch.map(img => img.id);

        try {
            // Fast-scan with skipThumbnail=false - Rust will skip existing files
            const results = await scanImagesBulk(paths, thumbDir, false, false);

            results.forEach((res, idx) => {
                if (res.thumbnail) {
                    updates.push({ id: batch[idx].id, thumbnailPath: res.thumbnail, thumbnailSource: 'ambit' });
                    synced++;
                }
            });
        } catch (e) {
            console.error(`[Thumb] Sync batch failed at ${i}`, e);
        }

        if (onProgress) {
            onProgress(Math.min(i + BATCH_SIZE, candidates.length), candidates.length);
        }
    }

    // Batch update the database
    if (updates.length > 0) {
        try {
            const { updateThumbnailPathsBatch } = await import('./db/imageRepo');
            await updateThumbnailPathsBatch(updates);
            console.log(`[Thumb] Synced ${synced} thumbnails to DB`);
        } catch (e) {
            console.error('[Thumb] Failed to persist synced thumbnails to DB', e);
            return 0;
        }
    }

    return synced;
};

/**
 * Scan all images with thumbnails and check if the file actually exists.
 * If not, set the thumbnail_path to NULL so it can be regenerated.
 * Returns the number of images fixed.
 */
export const pruneBrokenThumbnails = async (): Promise<number> => {
    const thumbDir = await getThumbnailDir();
    if (!thumbDir) return 0;

    const { getDb } = await import('./db/connection');
    const { exists } = await import('@tauri-apps/plugin-fs');
    const { normalizePath } = await import('../utils/pathUtils');
    const { join } = await import('@tauri-apps/api/path');

    console.log('[Thumb] Pruning broken thumbnails...');

    // Get all images with thumbnails
    const db = await getDb();
    const rows = await db.select<{ id: string; thumbnail_path: string }[]>(
        'SELECT id, thumbnail_path FROM images WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ""'
    );

    let brokenCount = 0;
    const brokenIds: string[] = [];

    // Check availability
    // Optimization: We could use Rust for bulk verify if this is too slow,
    // but for <100k items checking file existence is reasonably fast in parallel chunks or even sequentially.
    // Let's do parallel chunks of 50.
    const CHUNK_SIZE = 50;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (row) => {
            // If it's a web URL, skip check
            if (row.thumbnail_path.startsWith('http')) return;

            // If it's a full absolute path, check it.
            // If it's a filename only (legacy), join with thumbDir
            // Newer entries store full absolute path.
            let checkPath = normalizePath(row.thumbnail_path);

            // Heuristic for old relative paths (unlikely in new versions but safe to keep)
            if (!checkPath.includes('/') && !checkPath.includes('\\')) {
                checkPath = await join(thumbDir, checkPath);
            }

            try {
                const doesExist = await exists(checkPath);
                if (!doesExist) {
                    brokenIds.push(row.id);
                    brokenCount++;
                }
            } catch (e) {
                // If checking fails, assume available or transient error?
                // Safest to assume NOT available if 'exists' throws for file system errors
                console.warn(`[Thumb] Failed to check existence of ${checkPath}`, e);
            }
        }));
    }

    if (brokenCount > 0) {
        console.log(`[Thumb] Found ${brokenCount} broken thumbnails. Resetting to NULL...`);

        // Batch update to NULL
        const BATCH_SIZE = 500;
        for (let i = 0; i < brokenIds.length; i += BATCH_SIZE) {
            const batch = brokenIds.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '?').join(',');
            await db.execute(
                `UPDATE images SET thumbnail_path = NULL, micro_thumbnail = NULL, thumbnail_source = NULL WHERE id IN (${placeholders})`,
                batch
            );
        }
    } else {
        console.log('[Thumb] No broken thumbnails found.');
    }

    return brokenCount;
};
