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
    const dbUpdates: { id: string; thumbnailPath: string }[] = [];
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
                    dbUpdates.push({ id: batch[idx].id, thumbnailPath: res.thumbnail });
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

    const { getUnoptimizedImagesCount, getUnoptimizedImageIds } = await import('./db/maintenanceRepo');
    const { updateThumbnailPathsBatch } = await import('./db/imageRepo');

    // Get total count first
    const total = await getUnoptimizedImagesCount(whereClause, params, includeUpgradeable);
    if (total === 0) return 0;

    let processed = 0;
    let generated = 0;
    const PAGE_SIZE = 500; // Fetch 500 IDs at a time from DB
    const BATCH_SIZE = 100; // Process 100 at a time for thumbnail generation

    // Process in pages
    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
        if (signal?.aborted) {
            console.log('[Thumb] Regeneration cancelled by user');
            break;
        }

        // Fetch next page of IDs
        const ids = await getUnoptimizedImageIds(offset, PAGE_SIZE, whereClause, params, includeUpgradeable);
        if (ids.length === 0) break;

        // Process this page in batches
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            if (signal?.aborted) break;

            const batchIds = ids.slice(i, i + BATCH_SIZE);
            const dbUpdates: { id: string; thumbnailPath: string }[] = [];

            try {
                const results = await scanImagesBulk(batchIds, thumbDir, false, false);
                results.forEach((res, idx) => {
                    if (res.thumbnail) {
                        dbUpdates.push({ id: batchIds[idx], thumbnailPath: res.thumbnail });
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
    const updates: { id: string; thumbnailPath: string }[] = [];

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const paths = batch.map(img => img.id);

        try {
            // Fast-scan with skipThumbnail=false - Rust will skip existing files
            const results = await scanImagesBulk(paths, thumbDir, false, false);

            results.forEach((res, idx) => {
                if (res.thumbnail) {
                    updates.push({ id: batch[idx].id, thumbnailPath: res.thumbnail });
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
