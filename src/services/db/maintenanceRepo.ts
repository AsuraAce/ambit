import { commands, type FileHashBackfillResult } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import type { AIImage, MissingFileAuditResult } from '../../types';
import { getDb, dbMutex } from './connection';
import { mapRowToImage, getImageFieldsLight, REMOVED_IMAGE_FIELDS, type ImageRow } from './repoUtils';
import { isBrowserMockMode } from '../runtime';
import { getBrowserMockImages, updateBrowserMockImage } from '../browserMockData';

interface ImagePathRow {
    id: string;
    path: string;
}

interface MaintenanceCountRow {
    untagged?: number;
    missing?: number;
    intermediates?: number;
    trash?: number;
}

/**
 * Backfill the denormalized parameter columns (steps, cfg, sampler, generation_type).
 * This should be called once after migration 33 to populate existing data.
 * Returns the number of rows updated.
 */
export const backfillParameterColumns = async (): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    console.log('[Backfill] Starting parameter column backfill...');
    const count = await unwrap(commands.backfillParameterColumns());
    console.log(`[Backfill] Completed. ${count} rows updated.`);
    return count;
};


export const normalizeAllPaths = async () => {
    if (isBrowserMockMode()) return;

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const check = await db.select<{ id: string }[]>('SELECT id FROM images WHERE id LIKE "%\\%" OR path LIKE "%\\%" LIMIT 1');
        if (check.length === 0) return;

        console.log('[DB] Normalizing paths to use forward slashes...');
        await db.execute(`
            UPDATE images 
            SET id = REPLACE(id, '\\', '/'), 
                path = REPLACE(path, '\\', '/')
            WHERE id LIKE '%\\%' OR path LIKE '%\\%'
        `);
        console.log('[DB] Path normalization complete.');
    });
};

export const verifyLibraryIntegrity = async (
    onProgress?: (processed: number, total: number) => void,
    signal?: AbortSignal
): Promise<MissingFileAuditResult> => {
    if (isBrowserMockMode()) {
        const total = getBrowserMockImages().filter(image => !image.isDeleted).length;
        onProgress?.(total, total);
        return { scanned: total, total, missingIds: [], sampleMissingPaths: [], wasCancelled: !!signal?.aborted };
    }

    const db = await getDb();
    const allImages = await db.select<ImagePathRow[]>('SELECT id, path FROM images WHERE is_missing = 0 AND is_deleted = 0');
    const total = allImages.length;

    if (total === 0) return { scanned: 0, total: 0, missingIds: [], sampleMissingPaths: [], wasCancelled: false };

    const CHUNK_SIZE = 1000;
    let missingIds: string[] = [];
    let sampleMissingPaths: string[] = [];
    let processed = 0;
    let wasCancelled = false;

    for (let i = 0; i < total; i += CHUNK_SIZE) {
        if (signal?.aborted) {
            wasCancelled = true;
            break;
        }

        const chunk = allImages.slice(i, i + CHUNK_SIZE);
        const paths = chunk.map(img => img.path);

        try {
            const missingPaths = await unwrap(commands.verifyImagePaths(paths));
            const missingPathSet = new Set(missingPaths);
            const missingChunk = chunk.filter(img => missingPathSet.has(img.path));
            const missingChunkIds = missingChunk.map(img => img.id);

            missingIds = [...missingIds, ...missingChunkIds];

            if (sampleMissingPaths.length < 10) {
                sampleMissingPaths = [...sampleMissingPaths, ...missingPaths.slice(0, 10 - sampleMissingPaths.length)];
            }
        } catch (e) {
            console.error('[Verify] Chunk check failed', e);
        }

        processed += chunk.length;
        if (onProgress) onProgress(processed, total);

        if (signal?.aborted) {
            wasCancelled = true;
            break;
        }
    }

    return { scanned: processed, total, missingIds, sampleMissingPaths, wasCancelled };
};

export const getMissingImages = async (): Promise<AIImage[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockImages().filter(image => !!image.isMissing && !image.isDeleted);
    }

    const db = await getDb();
    const rows = await db.select<ImageRow[]>(`
        SELECT ${getImageFieldsLight()}
        FROM images
        WHERE is_missing = 1
          AND is_deleted = 0
        ORDER BY timestamp DESC
    `);
    return rows.map(mapRowToImage);
};

export const pruneMissingLinks = async (ids: string[]): Promise<number> => {
    if (isBrowserMockMode()) {
        ids.forEach(id => updateBrowserMockImage(id, { isMissing: true }));
        return ids.length;
    }

    const db = await getDb();
    if (ids.length === 0) return 0;

    console.log(`[Verify] Marking ${ids.length} images as missing`);
    for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        const placeholders = batch.map(() => '?').join(',');
        await db.execute(`UPDATE images SET is_missing = 1 WHERE id IN (${placeholders})`, batch);
    }

    return ids.length;
};

export const getDeletedImages = async (): Promise<AIImage[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockImages().filter(image => image.isDeleted);
    }

    const db = await getDb();
    const rows = await db.select<ImageRow[]>(`SELECT ${REMOVED_IMAGE_FIELDS} FROM removed_images ORDER BY removed_at DESC`);
    return rows.map(mapRowToImage);
};

export const getIntermediateImages = async (whereClause: string = '', params: unknown[] = []): Promise<AIImage[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockImages().filter(image => !image.isDeleted && (image.isIntermediate || image.metadata.isIntermediate));
    }

    const db = await getDb();
    let query = `
        SELECT ${getImageFieldsLight()} FROM images
        WHERE IFNULL(is_intermediate_gen, 0) = 1
        AND is_deleted = 0
    `;

    if (whereClause) {
        const cleanedWhere = whereClause.trim();
        if (cleanedWhere.toUpperCase().startsWith('WHERE')) {
            query += ` AND ${cleanedWhere.substring(5)}`;
        } else if (cleanedWhere.length > 0) {
            query += ` AND ${cleanedWhere}`;
        }
    }

    query += ' ORDER BY timestamp DESC';
    const rows = await db.select<ImageRow[]>(query, params);
    return rows.map(mapRowToImage);
};

export const getUntaggedImages = async (whereClause: string = '', params: unknown[] = []): Promise<AIImage[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockImages().filter(image => !image.isDeleted && !image.metadata.positivePrompt);
    }

    const db = await getDb();
    let query = `
        SELECT ${getImageFieldsLight()} FROM images
        WHERE (positive_prompt IS NULL OR positive_prompt = '')
        AND is_deleted = 0
        AND IFNULL(is_intermediate_gen, 0) = 0
    `;

    if (whereClause) {
        const cleanedWhere = whereClause.trim();
        if (cleanedWhere.toUpperCase().startsWith('WHERE')) {
            query += ` AND ${cleanedWhere.substring(5)}`;
        } else if (cleanedWhere.length > 0) {
            query += ` AND ${cleanedWhere}`;
        }
    }

    query += ' ORDER BY timestamp DESC';
    const rows = await db.select<ImageRow[]>(query, params);
    return rows.map(mapRowToImage);
};

/**
 * Build the SQL condition for identifying unoptimized images.
 * This is the single source of truth for what constitutes an "unoptimized" image.
 * 
 * An image is considered unoptimized if:
 * - It has no thumbnail (path = thumbnail_path, NULL, or empty)
 * 
 * With includeUpgradeable=true, also includes:
 * - Images with non-Ambit thumbnails (imported from InvokeAI, legacy, etc.)
 * - Images missing micro-thumbnails (need instant preview)
 */
function buildUnoptimizedCondition(includeUpgradeable: boolean): string {
    // Base condition: No thumbnail at all
    const noThumbnail = `(path = thumbnail_path OR thumbnail_path IS NULL OR thumbnail_path = '')`;

    if (!includeUpgradeable) {
        return noThumbnail;
    }

    // Extended condition: Include upgradeable thumbnails
    return `
        (
            ${noThumbnail}
            OR 
            (
                thumbnail_path IS NOT NULL 
                AND thumbnail_path != '' 
                AND path != thumbnail_path
                AND (thumbnail_source IS NULL OR thumbnail_source != 'ambit')
            )
        )
    `;
}

export const getUnoptimizedImages = async (whereClause: string = '', params: unknown[] = [], includeUpgradeable: boolean = false): Promise<AIImage[]> => {
    if (isBrowserMockMode()) return [];

    const db = await getDb();

    const unoptimizedCondition = buildUnoptimizedCondition(includeUpgradeable);

    let query = `
        SELECT ${getImageFieldsLight()} FROM images
        WHERE ${unoptimizedCondition}
        AND path NOT LIKE 'blob:%' 
        AND path NOT LIKE 'data:%'
        AND is_deleted = 0
        AND IFNULL(is_intermediate_gen, 0) = 0
        AND (is_corrupt = 0 OR is_corrupt IS NULL)
    `;

    if (whereClause && whereClause.trim().length > 0) {
        const cleanedWhere = whereClause.trim();
        if (cleanedWhere.toUpperCase().startsWith('WHERE')) {
            query += ` AND ${cleanedWhere.substring(5)}`;
        } else {
            query += ` AND ${cleanedWhere}`;
        }
    } else {
        // Force params empty if we are in global mode to avoid leaked filter params
        params = [];
    }

    query += ' ORDER BY timestamp DESC LIMIT 500';
    const rows = await db.select<ImageRow[]>(query, params);
    return rows.map(mapRowToImage);
};

/**
 * Fast count-only query for unoptimized images.
 * Used by the scan button to show total without loading all rows.
 */
export const getUnoptimizedImagesCount = async (whereClause: string = '', params: unknown[] = [], includeUpgradeable: boolean = false): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    const db = await getDb();

    const unoptimizedCondition = buildUnoptimizedCondition(includeUpgradeable);

    let query = `
        SELECT COUNT(*) as count FROM images 
        WHERE ${unoptimizedCondition}
        AND path NOT LIKE 'blob:%' 
        AND path NOT LIKE 'data:%'
        AND is_deleted = 0
        AND is_missing = 0
        AND IFNULL(is_intermediate_gen, 0) = 0
        AND (is_corrupt = 0 OR is_corrupt IS NULL)
    `;

    if (whereClause && whereClause.trim().length > 0) {
        const cleanedWhere = whereClause.trim();
        if (cleanedWhere.toUpperCase().startsWith('WHERE')) {
            query += ` AND ${cleanedWhere.substring(5)}`;
        } else {
            query += ` AND ${cleanedWhere}`;
        }
    } else {
        params = [];
    }

    const rows = await db.select<{ count: number }[]>(query, params);
    return rows[0]?.count ?? 0;
};

/**
 * Paginated ID and Path fetcher for regeneration processing.
 * Returns IDs and Paths to allow scanning by path and updating by ID.
 */
export const getUnoptimizedImageEntries = async (
    offset: number,
    limit: number,
    whereClause: string = '',
    params: unknown[] = [],
    includeUpgradeable: boolean = false
): Promise<{ id: string; path: string }[]> => {
    if (isBrowserMockMode()) return [];

    const db = await getDb();

    const unoptimizedCondition = buildUnoptimizedCondition(includeUpgradeable);

    let query = `
        SELECT id, path FROM images 
        WHERE ${unoptimizedCondition}
        AND path NOT LIKE 'blob:%' 
        AND path NOT LIKE 'data:%'
        AND is_deleted = 0
        AND is_missing = 0
        AND IFNULL(is_intermediate_gen, 0) = 0
        AND (is_corrupt = 0 OR is_corrupt IS NULL)
    `;

    if (whereClause && whereClause.trim().length > 0) {
        const cleanedWhere = whereClause.trim();
        if (cleanedWhere.toUpperCase().startsWith('WHERE')) {
            query += ` AND ${cleanedWhere.substring(5)}`;
        } else {
            query += ` AND ${cleanedWhere}`;
        }
    } else {
        params = [];
    }

    query += ` ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`;
    const rows = await db.select<{ id: string; path: string }[]>(query, params);
    return rows;
};

export const backfillImageFileHashes = async (): Promise<FileHashBackfillResult> => {
    if (isBrowserMockMode()) {
        return { scanned: 0, updated: 0, missing: 0, errors: 0, remaining: 0, wasCancelled: false };
    }

    const result = await unwrap(commands.backfillImageFileHashes(null));
    if (result.scanned > 0) {
        console.log('[Maintenance] File hash backfill complete', result);
    }
    return result;
};

export const cancelImageFileHashBackfill = async (): Promise<void> => {
    if (isBrowserMockMode()) return;
    await commands.cancelImageFileHashBackfill();
};

export const getDuplicateCandidates = async (whereClause: string = '', params: unknown[] = []): Promise<AIImage[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockImages().slice(0, 6);
    }

    const db = await getDb();
    const baseWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND group_id IS NULL AND IFNULL(is_intermediate_gen, 0) = 0";

    const query = `
        WITH scoped AS (
            SELECT id, file_hash, file_size, width, height
            FROM images
            ${baseWhere}
        ),
        exact_duplicate_ids AS (
            SELECT id
            FROM scoped
            WHERE file_hash IN (
                SELECT file_hash
                FROM scoped
                WHERE file_hash IS NOT NULL AND file_hash != ''
                GROUP BY file_hash
                HAVING COUNT(*) > 1
            )
        ),
        likely_duplicate_ids AS (
            SELECT scoped.id
            FROM scoped
            JOIN (
                SELECT file_size, width, height
                FROM scoped
                GROUP BY file_size, width, height
                HAVING COUNT(*) > 1
            ) dup ON scoped.file_size = dup.file_size
                AND scoped.width = dup.width
                AND scoped.height = dup.height
        )
        SELECT ${getImageFieldsLight()}
        FROM images
        WHERE id IN (
            SELECT id FROM exact_duplicate_ids
            UNION
            SELECT id FROM likely_duplicate_ids
        )
        ORDER BY file_hash DESC, file_size DESC, timestamp DESC
    `;

    try {
        const rows = await db.select<ImageRow[]>(query, params);
        return rows.map(mapRowToImage);
    } catch (e) {
        console.error('[DB] Failed to get duplicate candidates', e);
        return [];
    }
};

export const getMaintenanceCounts = async () => {
    if (isBrowserMockMode()) {
        const images = getBrowserMockImages();
        return {
            untagged: images.filter(image => !image.metadata.positivePrompt && !image.isDeleted).length,
            orphans: 0,
            intermediates: images.filter(image => image.isIntermediate || image.metadata.isIntermediate).length,
            missing: images.filter(image => image.isMissing).length,
            trash: images.filter(image => image.isDeleted).length,
            duplicates: 6
        };
    }

    const db = await getDb();

    // Batch all counts into a single query to reduce IPC overhead
    const res = await db.select<MaintenanceCountRow[]>(`
        SELECT 
            COUNT(*) FILTER (WHERE (positive_prompt IS NULL OR positive_prompt = '') AND is_deleted = 0 AND IFNULL(is_intermediate_gen, 0) = 0) as untagged,
            COUNT(*) FILTER (WHERE is_missing = 1 AND is_deleted = 0) as missing,
            COUNT(*) FILTER (WHERE IFNULL(is_intermediate_gen, 0) = 1 AND is_deleted = 0) as intermediates,
            (SELECT COUNT(*) FROM removed_images) as trash
        FROM images
    `);

    const counts = res[0] || {};

    return {
        untagged: counts.untagged || 0,
        orphans: counts.missing || 0,
        intermediates: counts.intermediates || 0,
        missing: counts.missing || 0,
        trash: counts.trash || 0,
        duplicates: 0 // Duplicates are processed manually from the UI via getDuplicateCandidates
    };
};
