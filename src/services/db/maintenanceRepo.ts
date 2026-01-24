import { commands } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { AIImage } from '../../types';
import { getDb, dbMutex } from './connection';
import { mapRowToImage, IMAGE_FIELDS_LIGHT } from './repoUtils';

/**
 * Backfill the denormalized parameter columns (steps, cfg, sampler, generation_type).
 * This should be called once after migration 33 to populate existing data.
 * Returns the number of rows updated.
 */
export const backfillParameterColumns = async (): Promise<number> => {
    console.log('[Backfill] Starting parameter column backfill...');
    const count = await unwrap(commands.backfillParameterColumns());
    console.log(`[Backfill] Completed. ${count} rows updated.`);
    return count;
};


export const normalizeAllPaths = async () => {
    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const check = await db.select<any[]>('SELECT id FROM images WHERE id LIKE "%\\%" OR path LIKE "%\\%" LIMIT 1');
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

export const verifyLibraryIntegrity = async (onProgress?: (processed: number, total: number) => void): Promise<{ scanned: number, missingIds: string[], sampleMissingPaths: string[] }> => {
    const db = await getDb();
    const allImages = await db.select<any[]>('SELECT id, path FROM images WHERE is_missing = 0 AND is_deleted = 0');
    const total = allImages.length;

    if (total === 0) return { scanned: 0, missingIds: [], sampleMissingPaths: [] };

    const CHUNK_SIZE = 1000;
    let missingIds: string[] = [];
    let sampleMissingPaths: string[] = [];
    let processed = 0;

    for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = allImages.slice(i, i + CHUNK_SIZE);
        const paths = chunk.map(img => img.path);

        try {
            const missingPaths = await unwrap(commands.verifyImagePaths(paths));
            const missingChunk = chunk.filter(img => missingPaths.includes(img.path));
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
    }

    return { scanned: total, missingIds, sampleMissingPaths };
};

export const pruneMissingLinks = async (ids: string[]): Promise<number> => {
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
    const db = await getDb();
    const rows = await db.select<any[]>(`SELECT ${IMAGE_FIELDS_LIGHT} FROM images WHERE is_deleted = 1 ORDER BY timestamp DESC`);
    return rows.map(mapRowToImage);
};

export const getIntermediateImages = async (whereClause: string = '', params: any[] = []): Promise<AIImage[]> => {
    const db = await getDb();
    let query = `
        SELECT ${IMAGE_FIELDS_LIGHT} FROM images 
        WHERE is_intermediate_gen = 1
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
    const rows = await db.select<any[]>(query, params);
    return rows.map(mapRowToImage);
};

export const getUntaggedImages = async (whereClause: string = '', params: any[] = []): Promise<AIImage[]> => {
    const db = await getDb();
    let query = `
        SELECT ${IMAGE_FIELDS_LIGHT} FROM images 
        WHERE (metadata_json IS NULL OR json_extract(metadata_json, '$.positivePrompt') IS NULL OR json_extract(metadata_json, '$.positivePrompt') = '') 
        AND is_deleted = 0
        AND is_intermediate_gen != 1
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
    const rows = await db.select<any[]>(query, params);
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

export const getUnoptimizedImages = async (whereClause: string = '', params: any[] = [], includeUpgradeable: boolean = false): Promise<AIImage[]> => {
    const db = await getDb();

    const unoptimizedCondition = buildUnoptimizedCondition(includeUpgradeable);

    let query = `
        SELECT ${IMAGE_FIELDS_LIGHT} FROM images 
        WHERE ${unoptimizedCondition}
        AND path NOT LIKE 'blob:%' 
        AND path NOT LIKE 'data:%'
        AND is_deleted = 0
        AND is_intermediate_gen != 1
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
    const rows = await db.select<any[]>(query, params);
    return rows.map(mapRowToImage);
};

/**
 * Fast count-only query for unoptimized images.
 * Used by the scan button to show total without loading all rows.
 */
export const getUnoptimizedImagesCount = async (whereClause: string = '', params: any[] = [], includeUpgradeable: boolean = false): Promise<number> => {
    const db = await getDb();

    const unoptimizedCondition = buildUnoptimizedCondition(includeUpgradeable);

    let query = `
        SELECT COUNT(*) as count FROM images 
        WHERE ${unoptimizedCondition}
        AND path NOT LIKE 'blob:%' 
        AND path NOT LIKE 'data:%'
        AND is_deleted = 0
        AND is_intermediate_gen != 1
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
    params: any[] = [],
    includeUpgradeable: boolean = false
): Promise<{ id: string; path: string }[]> => {
    const db = await getDb();

    const unoptimizedCondition = buildUnoptimizedCondition(includeUpgradeable);

    let query = `
        SELECT id, path FROM images 
        WHERE ${unoptimizedCondition}
        AND path NOT LIKE 'blob:%' 
        AND path NOT LIKE 'data:%'
        AND is_deleted = 0
        AND is_intermediate_gen != 1
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

export const getDuplicateCandidates = async (whereClause: string = '', params: any[] = []): Promise<AIImage[]> => {
    const db = await getDb();
    const baseWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND group_id IS NULL AND is_intermediate_gen != 1";

    const query = `
        SELECT ${IMAGE_FIELDS_LIGHT.replace('images.metadata_json', 'i.metadata_json')}
        FROM images i
        JOIN (
            SELECT file_size, width, height 
            FROM images 
            ${baseWhere}
            GROUP BY file_size, width, height 
            HAVING COUNT(*) > 1
        ) dup ON i.file_size = dup.file_size AND i.width = dup.width AND i.height = dup.height
        ${baseWhere}
        ORDER BY i.file_size DESC, i.timestamp DESC
    `;

    try {
        const rows = await db.select<any[]>(query, params);
        return rows.map(mapRowToImage);
    } catch (e) {
        console.error('[DB] Failed to get duplicate candidates', e);
        return [];
    }
};

export const getMaintenanceCounts = async () => {
    const db = await getDb();

    // Batch all counts into a single query to reduce IPC overhead
    const res = await db.select<any[]>(`
        SELECT 
            COUNT(*) FILTER (WHERE (metadata_json IS NULL OR json_extract(metadata_json, '$.positivePrompt') IS NULL OR json_extract(metadata_json, '$.positivePrompt') = '') AND is_deleted = 0 AND is_intermediate_gen != 1) as untagged,
            COUNT(*) FILTER (WHERE is_missing = 1 AND is_deleted = 0) as missing,
            COUNT(*) FILTER (WHERE is_intermediate_gen = 1 AND is_deleted = 0) as intermediates,
            COUNT(*) FILTER (WHERE is_deleted = 1) as trash
        FROM images
    `);

    // Duplicates require a subquery count
    const duplicates = await db.select<{ count: number }[]>(`
        SELECT COUNT(*) as count FROM (
            SELECT 1
            FROM images 
            WHERE is_deleted = 0 AND group_id IS NULL AND is_intermediate_gen != 1
            GROUP BY file_size, width, height 
            HAVING COUNT(*) > 1
        )
    `);

    const counts = res[0] || {};

    return {
        untagged: counts.untagged || 0,
        orphans: counts.missing || 0,
        intermediates: counts.intermediates || 0,
        missing: counts.missing || 0,
        trash: counts.trash || 0,
        duplicates: duplicates[0]?.count || 0
    };
};
