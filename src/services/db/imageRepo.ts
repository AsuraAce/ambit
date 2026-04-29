import { commands } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { AIImage, GeneratorTool } from '../../types';
import { getDb, dbMutex } from './connection';
import { mapRowToImage, getImageFieldsLight, getImageFieldsFull, REMOVED_IMAGE_FIELDS } from './repoUtils';
import { normalizePath, urlToPath } from '../../utils/pathUtils';
import {
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    liveWatchNow,
} from '../../utils/liveWatchPerf';
import { isBrowserMockMode } from '../runtime';
import { getBrowserMockImages, updateBrowserMockImage } from '../browserMockData';

type PersistableImageRecord = {
    id: string;
    path: string;
    width: number;
    height: number;
    fileSize: number;
    fileHash: string | null;
    timestamp: number;
    metadataJson: string;
    thumbnailPath: string | null;
    microThumbnail: string | null;
    thumbnailSource: string | null;
    isFavorite: boolean;
    isPinned: boolean;
    isDeleted: boolean;
    isMissing: boolean;
    userMasked: boolean | null;
    groupId: string | null;
    boardId: string | null;
    notes: string | null;
    originalMetadataJson: string | null;
    originalStateJson: string | null;
    isCorrupt: boolean;
};

export interface DeleteRemovedImagesResult {
    deletedIds: string[];
    failedIds: string[];
    thumbnailWarningIds: string[];
}

const SQLITE_PARAM_CHUNK_SIZE = 900;

const chunkItems = <T>(items: T[], chunkSize = SQLITE_PARAM_CHUNK_SIZE): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
};

const buildPersistableImageRecord = (image: AIImage): PersistableImageRecord => ({
    id: normalizePath(image.id),
    path: normalizePath(image.id),
    width: image.width,
    height: image.height,
    fileSize: image.fileSize || 0,
    fileHash: image.fileHash || null,
    timestamp: image.timestamp,
    metadataJson: JSON.stringify(image.metadata),
    thumbnailPath: urlToPath(image.thumbnailUrl),
    microThumbnail: image.microThumbnail || null,
    thumbnailSource: image.thumbnailSource || null,
    isFavorite: !!image.isFavorite,
    isPinned: !!image.isPinned,
    isDeleted: !!image.isDeleted,
    isMissing: !!image.isMissing,
    userMasked: image.userMasked === true ? true : (image.userMasked === false ? false : null),
    groupId: image.groupId || null,
    boardId: image.boardId || null,
    notes: image.notes || null,
    originalMetadataJson: image.originalChunks ? JSON.stringify(image.originalChunks) : (image.originalMetadata ? JSON.stringify(image.originalMetadata) : null),
    originalStateJson: image.originalState ? JSON.stringify(image.originalState) : null,
    isCorrupt: !!image.isCorrupt
});

const persistImageRecords = async (
    records: PersistableImageRecord[],
    db: Awaited<ReturnType<typeof getDb>>
) => {
    const CHUNK_SIZE = 5000;
    if (records.length > 0) {
        console.log(`[RepoDebug] Saving batch. First record originalMetadataJson:`, records[0].originalMetadataJson ? records[0].originalMetadataJson.substring(0, 100) : 'NULL');
    }

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        try {
            const chunkStartedAt = liveWatchNow();
            await unwrap(commands.saveImagesBatch(chunk));
            debugLiveWatchPerf('DB image batch persisted', {
                batchIndex: Math.floor(i / CHUNK_SIZE) + 1,
                chunkSize: chunk.length,
                chunkMs: elapsedMs(chunkStartedAt)
            });
        } catch (e) {
            console.error('[DB] Rust batch insert failed', e);
            throw e;
        }
    }

    await db.execute('UPDATE images SET user_masked = NULL WHERE user_masked = 0');
};

export const insertImage = async (image: AIImage) => {
    if (isBrowserMockMode()) return;

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const record = buildPersistableImageRecord(image);
        await persistImageRecords([record], db);

        // Junction Table Sync
        if (image.boardId) {
            await db.execute(
                'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
                [image.boardId, record.id]
            );
        }
    });
};

export const insertImagesBatch = async (images: AIImage[]) => {
    if (isBrowserMockMode()) return;

    if (images.length === 0) return;
    const insertStartedAt = liveWatchNow();

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const records = images.map(buildPersistableImageRecord);
        await persistImageRecords(records, db);
    });

    const cleanupStartedAt = insertStartedAt;
    debugLiveWatchPerf('DB user_masked cleanup complete', {
        imageCount: images.length,
        cleanupMs: elapsedMs(cleanupStartedAt)
    });
    infoLiveWatchPerf('insertImagesBatch complete', {
        imageCount: images.length,
        totalMs: elapsedMs(insertStartedAt)
    });

    // rebuildFacetCache() is no longer called automatically per batch to avoid O(N^2) behavior during syncs.
    // It should be called once at the end of the sync/import process.
};

/**
 * Rebuilds the facet_cache table with pre-computed counts for all resources.
 * This runs the expensive queries once per import, so getFacets becomes instant.
 */
export const rebuildFacetCache = async (): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    try {
        const { clearLibraryStatsCache } = await import('./searchRepo');
        clearLibraryStatsCache();
        
        const count = await unwrap(commands.rebuildFacetCache());
        console.log(`[DB] Rebuilt facet cache with ${count} entries`);
        return count;
    } catch (e) {
        console.error('[DB] Failed to rebuild facet cache', e);
        return 0;
    }
};

/**
 * Rebuilds a specific facet type in the cache.
 * Much faster than a full rebuild for metadata edits.
 * @param type 'checkpoints' | 'tools' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters'
 */
export const rebuildFacetCacheIncremental = async (type: string): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    try {
        const count = await unwrap(commands.rebuildFacetCacheIncremental(type));
        console.log(`[DB] Rebuilt incremental facet cache for ${type}: ${count} entries`);
        return count;
    } catch (e) {
        console.error(`[DB] Failed to rebuild incremental facet cache for ${type}`, e);
        return 0;
    }
};


/**
 * High-performance bulk sync of the collection_images junction table.
 * Links images to their InvokeAI boards.
 * @param ids Optional array of image IDs to sync. If omitted, syncs all images with board_ids.
 */
export const syncCollectionImages = async (ids?: string[]) => {
    if (isBrowserMockMode()) return;

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        console.log(`[DB] Performing bulk collection sync${ids ? ` for ${ids.length} images` : ''}...`);

        let query = `
            INSERT OR IGNORE INTO collection_images (collection_id, image_id)
            SELECT board_id, id 
            FROM images 
            WHERE board_id IS NOT NULL
        `;

        const params: any[] = [];
        if (ids && ids.length > 0) {
            // SQLite has a limit on parameters, so we chunk if necessary, 
            // but for typical batch sizes (500) it's fine.
            const placeholders = ids.map(() => '?').join(',');
            query += ` AND id IN (${placeholders})`;
            params.push(...ids);
        }

        await db.execute(query, params);
        console.log('[DB] Bulk collection sync complete.');
    });
};

/**
 * Safely updates individual fields within the metadata_json blob without overwriting the entire object.
 * CRITICAL: Prevents data loss when editing from "light" grid view imagery.
 */
export const updateImageMetadataFields = async (id: string, updates: Record<string, any>) => {
    if (isBrowserMockMode()) {
        const image = getBrowserMockImages().find(item => item.id === id);
        if (image) {
            updateBrowserMockImage(id, { metadata: { ...image.metadata, ...updates } });
        }
        return;
    }

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const normalizedId = normalizePath(id);

        let query = 'UPDATE images SET metadata_json = ';
        let jsonSetExpr = 'metadata_json';
        const params: any[] = [];

        Object.entries(updates).forEach(([key, value]) => {
            // CRITICAL: If value is an array or object, it must be serialized and passed via JSON function
            // Otherwise SQLite might store it as a literal string "[object Object]" or similar corruption.
            if (value !== null && typeof value === 'object') {
                jsonSetExpr = `json_set(${jsonSetExpr}, '$.${key}', json(?))`;
                params.push(JSON.stringify(value));
            } else {
                jsonSetExpr = `json_set(${jsonSetExpr}, '$.${key}', ?)`;
                params.push(value);
            }
        });

        query += jsonSetExpr;

        // SPECIAL CASE: 'tool' is a real column, so we must update it too if it's in the updates
        if ('tool' in updates) {
            query += ', tool = ?';
            params.push(updates.tool);
        }

        if ('positivePrompt' in updates || 'positive_prompt' in updates) {
            query += ', positive_prompt = ?';
            params.push((updates.positivePrompt ?? updates.positive_prompt) || null);
        }

        if ('negativePrompt' in updates || 'negative_prompt' in updates) {
            query += ', negative_prompt = ?';
            params.push((updates.negativePrompt ?? updates.negative_prompt) || null);
        }

        // SPECIAL CASE: Model name is also denormalized for filtering
        if ('overrideModel' in updates) {
            query += ', resolved_model_name = ?';
            params.push(updates.overrideModel);
        } else if ('model' in updates) {
            query += ', resolved_model_name = ?';
            params.push(updates.model);
        }

        query += ' WHERE id = ?';
        params.push(normalizedId);

        await db.execute(query, params);
    });
};


/**
 * Reverts the entire metadata_json for an image to its original state (if stored) 
 * or effectively clears all user-applied overrides by setting metadata_json to null.
 * Also resets denormalized columns like 'tool'.
 */
export const revertImageMetadata = async (id: string) => {
    if (isBrowserMockMode()) return;

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const normalizedId = normalizePath(id);

        // 1. Fetch the original parsed metadata (already parsed, no re-parsing needed!)
        const row: any = await db.select('SELECT original_parsed_json FROM images WHERE id = ?', [normalizedId]);
        if (!row || row.length === 0) return;
        const img = row[0];

        if (!img.original_parsed_json) {
            // If no original parsed metadata, just clear overrides
            await db.execute(`
                UPDATE images 
                SET metadata_json = NULL,
                    tool = NULL,
                    model_hash = NULL,
                    model_name = NULL,
                    resolved_model_name = NULL,
                    positive_prompt = NULL,
                    negative_prompt = NULL
                WHERE id = ?
            `, [normalizedId]);
            return;
        }

        try {
            // Parse the already-stored baseline (no re-parsing from raw chunks!)
            const originalMetadata = JSON.parse(img.original_parsed_json);

            // SAFEGUARD: Ensure the image doesn't disappear from the UI after revert.
            originalMetadata.isIntermediate = false;

            // 2. Update metadata_json and denormalized columns with the baseline
            // CRITICAL: Set metadata_json = original_parsed_json to ensure they match exactly
            await db.execute(`
                UPDATE images 
                SET metadata_json = ?,
                    model_hash = ?,
                    model_name = ?,
                    tool = ?,
                    resolved_model_name = ?,
                    positive_prompt = ?,
                    negative_prompt = ?
                WHERE id = ?
            `, [
                img.original_parsed_json, // Use the exact same JSON string!
                originalMetadata.modelHash || null,
                originalMetadata.model || null,
                originalMetadata.tool || GeneratorTool.UNKNOWN,
                originalMetadata.model || null, // resolved_model_name matches model_name on revert
                originalMetadata.positivePrompt ?? originalMetadata.positive_prompt ?? null,
                originalMetadata.negativePrompt ?? originalMetadata.negative_prompt ?? null,
                normalizedId
            ]);
        } catch (e) {
            console.error('[DB] Failed to revert metadata:', e);
            // Fallback: just clear overrides if parsing fails
            await db.execute('UPDATE images SET metadata_json = NULL, positive_prompt = NULL, negative_prompt = NULL WHERE id = ?', [normalizedId]);
        }
    });
};

/**
 * Atomic update for the notes column.
 */
export const updateImageNotesCol = async (id: string, notes: string | null) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { notes: notes ?? undefined });
        return;
    }

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const normalizedId = normalizePath(id);
        await db.execute('UPDATE images SET notes = ? WHERE id = ?', [notes, normalizedId]);
    });
};

export const isImageNew = async (id: string): Promise<boolean> => {
    if (isBrowserMockMode()) {
        return !getBrowserMockImages().some(image => image.id === id);
    }

    const db = await getDb();
    const result = await db.select<any[]>(`SELECT count(*) as count FROM images WHERE id = ?`, [id]);
    return (result[0]?.count || 0) === 0;
};

export const getAllImages = async (
    limit?: number,
    offset: number = 0,
    prioritizePinned: boolean = false,
    showIntermediates: boolean = false,
    showGrids: boolean = false
): Promise<AIImage[]> => {
    if (isBrowserMockMode()) {
        const images = getBrowserMockImages()
            .filter(image => !image.isDeleted)
            .filter(image => showIntermediates || !(image.isIntermediate || image.metadata.isIntermediate))
            .filter(image => showGrids || !image.metadata.isGrid)
            .sort((a, b) => prioritizePinned && a.isPinned !== b.isPinned
                ? (a.isPinned ? -1 : 1)
                : b.timestamp - a.timestamp);
        return limit ? images.slice(offset, offset + limit) : images;
    }

    const db = await getDb();
    const orderBy = prioritizePinned ? 'ORDER BY is_pinned DESC, timestamp DESC' : 'ORDER BY timestamp DESC';

    // Optimize: Use STORED generated columns instead of LIKE scan
    let filterClauses = 'WHERE is_deleted = 0';
    if (!showIntermediates) {
        filterClauses += ' AND IFNULL(is_intermediate_gen, 0) = 0';
    }
    if (!showGrids) {
        filterClauses += ' AND IFNULL(is_grid_gen, 0) = 0';
    }

    const query = limit
        ? `SELECT ${getImageFieldsLight()} FROM images ${filterClauses} ${orderBy} LIMIT ${limit} OFFSET ${offset}`
        : `SELECT ${getImageFieldsLight()} FROM images ${filterClauses} ${orderBy}`;

    const rows = await db.select<any[]>(query);
    return rows.map(mapRowToImage);
};

export const getImagesByIds = async (ids: string[]): Promise<AIImage[]> => {
    if (ids.length === 0) return [];
    if (isBrowserMockMode()) {
        const idSet = new Set(ids);
        return getBrowserMockImages().filter(image => idSet.has(image.id));
    }

    const db = await getDb();

    const CHUNK_SIZE = 900;
    let allImages: AIImage[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT ${getImageFieldsFull()} FROM images WHERE images.id IN (${placeholders})`;
        const rows = await db.select<any[]>(query, chunk);
        allImages = [...allImages, ...rows.map(mapRowToImage)];
    }

    return allImages;
};

export const getRemovedImagesByIds = async (ids: string[]): Promise<AIImage[]> => {
    if (ids.length === 0) return [];
    const db = await getDb();

    const CHUNK_SIZE = 900;
    let allImages: AIImage[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE).map(normalizePath);
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT ${REMOVED_IMAGE_FIELDS} FROM removed_images WHERE id IN (${placeholders})`;
        const rows = await db.select<any[]>(query, chunk);
        allImages = [...allImages, ...rows.map(mapRowToImage)];
    }

    return allImages;
};

export const getImageWithFullMetadata = async (id: string): Promise<AIImage | null> => {
    if (isBrowserMockMode()) {
        return getBrowserMockImages().find(image => image.id === id) ?? null;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    const rows = await db.select<any[]>('SELECT * FROM images WHERE id = ?', [normalizedId]);
    if (rows.length === 0) return null;

    const image = mapRowToImage(rows[0]);

    // --- ON-DEMAND METADATA RECOVERY ---
    // If this is an A1111 image but it's "Low Fidelity" (no rawParameters),
    // we proactively fetch the true metadata from the file. 
    // This fixes "Legacy" images in the context of the Image Viewer.
    if (image.metadata.tool === GeneratorTool.AUTOMATIC1111 && !image.metadata.rawParameters) {
        try {
            const { scanImageNative } = await import('../metadataParser');
            const deepScan = await scanImageNative(id, '', true, true);
            if (deepScan && deepScan.metadata.rawParameters) {
                image.metadata = {
                    ...image.metadata,
                    ...deepScan.metadata,
                    rawParameters: deepScan.metadata.rawParameters
                };
                // We DON'T persist back to DB here to avoid "magic" DB writes 
                // on simple reads, but we return the high-fidelity version to the UI.
                // The user's next 'Save' or 'Copy' will use this data.
            }
        } catch (e) {
            console.error("Failed deep scan for", id, e);
        }
    }

    return image;
};

export const toggleImagePin = async (id: string, isPinned: boolean) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isPinned });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_pinned = $1 WHERE id = $2', [isPinned ? 1 : 0, normalizedId]);
    // Note: Asset thumbnails update via facet cache rebuild, not on individual pins.
};

export const toggleImageFavorite = async (id: string, isFavorite: boolean) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isFavorite });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_favorite = $1 WHERE id = $2', [isFavorite ? 1 : 0, normalizedId]);
};

export const toggleImageMask = async (id: string, userMasked: boolean | null) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { userMasked: userMasked ?? undefined });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    let value: number | null = null;
    if (userMasked === true) value = 1;
    if (userMasked === false) value = 0;

    await db.execute('UPDATE images SET user_masked = $1 WHERE id = $2', [value, normalizedId]);
};

export const toggleImageIntermediate = async (id: string, isIntermediate: boolean) => {
    if (isBrowserMockMode()) {
        const image = getBrowserMockImages().find(item => item.id === id);
        if (image) {
            updateBrowserMockImage(id, {
                isIntermediate,
                metadata: { ...image.metadata, isIntermediate }
            });
        }
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);

    await db.execute(
        "UPDATE images SET metadata_json = json_set(metadata_json, '$.isIntermediate', $1) WHERE id = $2",
        [isIntermediate ? 1 : 0, normalizedId]
    );
};

export const deleteImage = async (id: string) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isDeleted: true });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('DELETE FROM collection_images WHERE image_id = $1', [normalizedId]);
    await db.execute('DELETE FROM image_loras WHERE image_id = $1', [normalizedId]);
    await db.execute('DELETE FROM image_embeddings WHERE image_id = $1', [normalizedId]);
    await db.execute('DELETE FROM image_hypernetworks WHERE image_id = $1', [normalizedId]);
    await db.execute('DELETE FROM image_controlnets WHERE image_id = $1', [normalizedId]);
    await db.execute('DELETE FROM image_ipadapters WHERE image_id = $1', [normalizedId]);
    await db.execute('DELETE FROM images WHERE id = $1', [normalizedId]);
};

const removeTombstones = async (db: Awaited<ReturnType<typeof getDb>>, ids: string[]) => {
    if (ids.length === 0) return;

    for (const chunk of chunkItems(ids)) {
        const placeholders = chunk.map(() => '?').join(',');
        await db.execute(`DELETE FROM removed_images WHERE id IN (${placeholders})`, chunk);
    }
};

export const removeImagesFromLibrary = async (ids: string[]) => {
    if (ids.length === 0) return;

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const normalizedIds = Array.from(new Set(ids.map(normalizePath)));
        const rows: any[] = [];

        console.info('[Repo] removeImagesFromLibrary: loading images', { count: normalizedIds.length });
        for (const chunk of chunkItems(normalizedIds)) {
            const placeholders = chunk.map(() => '?').join(',');
            const chunkRows = await db.select<any[]>(
                `SELECT id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, micro_thumbnail, thumbnail_source,
                        is_favorite, is_pinned, is_missing, user_masked, group_id, board_id, notes,
                        original_metadata_json, original_parsed_json, original_state_json, is_corrupt
                 FROM images
                 WHERE id IN (${placeholders})`,
                chunk
            );
            rows.push(...chunkRows);
        }

        if (rows.length === 0) return;

        const membershipRows: { image_id: string; collection_id: string }[] = [];
        console.info('[Repo] removeImagesFromLibrary: loading collection memberships', { count: normalizedIds.length });
        for (const chunk of chunkItems(normalizedIds)) {
            const placeholders = chunk.map(() => '?').join(',');
            const chunkMembershipRows = await db.select<{ image_id: string; collection_id: string }[]>(
                `SELECT image_id, collection_id
                 FROM collection_images
                 WHERE image_id IN (${placeholders})`,
                chunk
            );
            membershipRows.push(...chunkMembershipRows);
        }

        const memberships = membershipRows.reduce<Record<string, string[]>>((acc, row) => {
            if (!acc[row.image_id]) acc[row.image_id] = [];
            acc[row.image_id].push(row.collection_id);
            return acc;
        }, {});

        const removedAt = Date.now();
        console.info('[Repo] removeImagesFromLibrary: persisting tombstones', { count: rows.length });
        for (const row of rows) {
            await db.execute(
                `INSERT OR REPLACE INTO removed_images (
                    id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, micro_thumbnail, thumbnail_source,
                    is_favorite, is_pinned, is_missing, user_masked, group_id, board_id, notes,
                    original_metadata_json, original_parsed_json, original_state_json, is_corrupt, removed_at, collection_ids_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.id,
                    row.path,
                    row.width ?? null,
                    row.height ?? null,
                    row.file_size ?? null,
                    row.timestamp,
                    row.metadata_json ?? null,
                    row.thumbnail_path ?? null,
                    row.micro_thumbnail ?? null,
                    row.thumbnail_source ?? null,
                    row.is_favorite ?? 0,
                    row.is_pinned ?? 0,
                    row.is_missing ?? 0,
                    row.user_masked ?? null,
                    row.group_id ?? null,
                    row.board_id ?? null,
                    row.notes ?? null,
                    row.original_metadata_json ?? null,
                    row.original_parsed_json ?? null,
                    row.original_state_json ?? null,
                    row.is_corrupt ?? 0,
                    removedAt,
                    memberships[row.id] ? JSON.stringify(memberships[row.id]) : null
                ]
            );
        }

        console.info('[Repo] removeImagesFromLibrary: cleaning related tables', { count: normalizedIds.length });
        for (const chunk of chunkItems(normalizedIds)) {
            const placeholders = chunk.map(() => '?').join(',');
            await db.execute(`DELETE FROM collection_images WHERE image_id IN (${placeholders})`, chunk);
            await db.execute(`DELETE FROM image_loras WHERE image_id IN (${placeholders})`, chunk);
            await db.execute(`DELETE FROM image_embeddings WHERE image_id IN (${placeholders})`, chunk);
            await db.execute(`DELETE FROM image_hypernetworks WHERE image_id IN (${placeholders})`, chunk);
            await db.execute(`DELETE FROM image_controlnets WHERE image_id IN (${placeholders})`, chunk);
            await db.execute(`DELETE FROM image_ipadapters WHERE image_id IN (${placeholders})`, chunk);
            await db.execute(`DELETE FROM images WHERE id IN (${placeholders})`, chunk);
        }
    });
};

export const restoreRemovedImages = async (ids: string[]) => {
    if (ids.length === 0) return;

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const normalizedIds = Array.from(new Set(ids.map(normalizePath)));
        const rows: any[] = [];
        for (const chunk of chunkItems(normalizedIds)) {
            const placeholders = chunk.map(() => '?').join(',');
            const chunkRows = await db.select<any[]>(
                `SELECT ${REMOVED_IMAGE_FIELDS}, collection_ids_json FROM removed_images WHERE id IN (${placeholders})`,
                chunk
            );
            rows.push(...chunkRows);
        }

        if (rows.length === 0) return;

        const restoredImages = rows.map(row => ({
            ...mapRowToImage(row),
            isDeleted: false
        }));
        const restoreStartedAt = liveWatchNow();
        const records = restoredImages.map(buildPersistableImageRecord);
        await persistImageRecords(records, db);
        infoLiveWatchPerf('restoreRemovedImages persisted restored records', {
            imageCount: restoredImages.length,
            totalMs: elapsedMs(restoreStartedAt)
        });

        for (const row of rows) {
            if (!row.collection_ids_json) continue;

            try {
                const collectionIds = JSON.parse(row.collection_ids_json) as string[];
                for (const collectionId of collectionIds) {
                    await db.execute(
                        `INSERT OR IGNORE INTO collection_images (collection_id, image_id)
                         SELECT ?, ?
                         WHERE EXISTS (SELECT 1 FROM collections WHERE id = ?)`,
                        [collectionId, row.id, collectionId]
                    );
                }
            } catch (error) {
                console.warn('[DB] Failed to restore collection membership for removed image', row.id, error);
            }
        }

        await removeTombstones(db, normalizedIds);
    });
};

/**
 * Deletes the image from the database AND moves the physical file to the OS trash.
 * Also moves the generated thumbnail to trash.
 */
export const deleteImageFromDisk = async (id: string, path: string, thumbnailPath: string | null) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isDeleted: true });
        return;
    }

    // 1. Move to Trash (OS)
    if (path) {
        try {
            await unwrap(commands.moveToTrash(path));
        } catch (e) {
            console.error('[Repo] Failed to move file to trash:', path, e);
            // We proceed even if trash fails?
            // "make it a move to OS trash, this is an additonal safety net"
            // If safety net fails, we should probably warn or throw?
            // But blocking deletion because trash is full/error might be annoying.
            // For now, we log and proceed.
        }
    }

    // 2. Trash Thumbnail
    if (thumbnailPath) {
        try {
            await unwrap(commands.deleteThumbnail(thumbnailPath));
        } catch (e) {
            console.warn('[Repo] Failed to trash thumbnail:', thumbnailPath, e);
        }
    }

    // 3. Delete from DB
    await deleteImage(id);
};

export const deleteRemovedImageFromDisk = async (id: string): Promise<DeleteRemovedImagesResult> => {
    return deleteRemovedImagesFromDisk([id]);
};

export const deleteRemovedImagesFromDisk = async (ids: string[]): Promise<DeleteRemovedImagesResult> => {
    if (ids.length === 0) {
        return { deletedIds: [], failedIds: [], thumbnailWarningIds: [] };
    }

    const normalizedIds = Array.from(new Set(ids.map(normalizePath)));

    return dbMutex.dispatch(async () => {
        const db = await getDb();
        const rows: any[] = [];
        for (const chunk of chunkItems(normalizedIds)) {
            const placeholders = chunk.map(() => '?').join(',');
            const chunkRows = await db.select<any[]>(
                `SELECT id, path, thumbnail_path FROM removed_images WHERE id IN (${placeholders})`,
                chunk
            );
            rows.push(...chunkRows);
        }

        if (rows.length === 0) {
            return { deletedIds: [], failedIds: [...normalizedIds], thumbnailWarningIds: [] };
        }

        const deletedIds: string[] = [];
        const failedIds: string[] = [];
        const thumbnailWarningIds: string[] = [];

        for (const row of rows) {
            if (row.path) {
                try {
                    await unwrap(commands.moveToTrash(row.path));
                } catch (e) {
                    console.error('[Repo] Failed to move removed file to trash:', row.path, e);
                    failedIds.push(row.id);
                    continue;
                }
            }

            if (row.thumbnail_path) {
                try {
                    await unwrap(commands.deleteThumbnail(row.thumbnail_path));
                } catch (e) {
                    console.warn('[Repo] Failed to trash removed thumbnail:', row.thumbnail_path, e);
                    thumbnailWarningIds.push(row.id);
                }
            }

            deletedIds.push(row.id);
        }

        if (deletedIds.length > 0) {
            await removeTombstones(db, deletedIds);
        }

        const missingIds = normalizedIds.filter(id => !rows.some(row => row.id === id));
        failedIds.push(...missingIds);

        return { deletedIds, failedIds, thumbnailWarningIds };
    });
};

export const markAsDeleted = async (ids: string[], deleted: boolean) => {
    if (ids.length === 0) return;
    if (isBrowserMockMode()) {
        ids.forEach(id => updateBrowserMockImage(id, { isDeleted: deleted }));
        return;
    }

    const normalizedIds = ids.map(normalizePath);
    const db = await getDb();
    const placeholders = normalizedIds.map(() => '?').join(',');
    await db.execute(`UPDATE images SET is_deleted = ? WHERE id IN (${placeholders})`, [deleted ? 1 : 0, ...normalizedIds]);
};

export const updateImageWorkflow = async (id: string, workflowJson: string): Promise<void> => {
    if (isBrowserMockMode()) {
        const image = getBrowserMockImages().find(item => item.id === id);
        if (image) {
            updateBrowserMockImage(id, {
                metadata: { ...image.metadata, workflowJson, hasWorkflowHint: true }
            });
        }
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    const rows = await db.select('SELECT metadata_json FROM images WHERE id = ?', [normalizedId]) as any[];
    if (rows.length === 0) return;

    try {
        const metadata = JSON.parse(rows[0].metadata_json);
        metadata.workflowJson = workflowJson;
        metadata.hasWorkflowHint = true; // Mark as having workflow

        await db.execute('UPDATE images SET metadata_json = ? WHERE id = ?', [JSON.stringify(metadata), normalizedId]);
    } catch (e) {
        console.error('[DB] Failed to update workflow for image', normalizedId, e);
    }
};

export const updateImageWorkflowHint = async (id: string, hasWorkflow: boolean): Promise<void> => {
    if (isBrowserMockMode()) {
        const image = getBrowserMockImages().find(item => item.id === id);
        if (image) {
            updateBrowserMockImage(id, {
                metadata: { ...image.metadata, hasWorkflowHint: hasWorkflow }
            });
        }
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    const rows = await db.select('SELECT metadata_json FROM images WHERE id = ?', [normalizedId]) as any[];
    if (rows.length === 0) return;

    try {
        const metadata = JSON.parse(rows[0].metadata_json);
        metadata.hasWorkflowHint = hasWorkflow;

        await db.execute('UPDATE images SET metadata_json = ? WHERE id = ?', [JSON.stringify(metadata), normalizedId]);
    } catch (e) {
        console.error('[DB] Failed to update workflow hint for image', normalizedId, e);
    }
};

export const updateFavorite = async (id: string, isFavorite: boolean) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isFavorite });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, normalizedId]);
};

export const updatePinned = async (id: string, isPinned: boolean) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isPinned });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_pinned = ? WHERE id = ?', [isPinned ? 1 : 0, normalizedId]);
};
export const updateImagesBoard = async (ids: string[], boardId: string | null) => {
    if (ids.length === 0) return;
    if (isBrowserMockMode()) {
        ids.forEach(id => updateBrowserMockImage(id, { boardId: boardId ?? undefined }));
        return;
    }

    const db = await getDb();
    const normalizedIds = ids.map(normalizePath);
    const placeholders = normalizedIds.map(() => '?').join(',');

    await db.execute(`UPDATE images SET board_id = ? WHERE id IN (${placeholders})`, [boardId, ...normalizedIds]);

    // Junction Table Sync
    if (boardId) {
        for (const id of normalizedIds) {
            await db.execute('INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)', [boardId, id]);
        }
    } else {
        // If boardId is null, we don't necessarily know which collection to remove it from in the M:N world,
        // but since board_id was 1:N, we should probably remove it from any 'invoke' source collections?
        // Actually, a simpler approach is to use the dedicated collection removal tools for manual changes.
    }
};

/**
 * Purges the entire library database by calling the backend command.
 * Returns the backend's message (e.g., instructions to restart).
 */
export const purgeLibrary = async (): Promise<string> => {
    if (isBrowserMockMode()) {
        getBrowserMockImages().forEach(image => updateBrowserMockImage(image.id, { isDeleted: true }));
        return 'Browser mock library cleared for this session.';
    }

    console.log('[Purge] Calling backend to purge database...');
    const result = await commands.purgeDatabase();
    console.log('[Purge] Backend response:', result);

    // The result is either { status: 'ok', data: message } or { status: 'error', error: message }
    if (result.status === 'ok') {
        return result.data;
    } else {
        throw new Error(result.error);
    }
};

export const checkHiddenContentAvailability = async (): Promise<{ hasIntermediates: boolean, hasGrids: boolean }> => {
    if (isBrowserMockMode()) {
        const images = getBrowserMockImages();
        return {
            hasIntermediates: images.some(image => image.isIntermediate || image.metadata.isIntermediate),
            hasGrids: images.some(image => image.metadata.isGrid === true)
        };
    }

    const db = await getDb();
    // Use indexed STORED generated columns for instant lookup
    const [intermediateCheck, gridCheck] = await Promise.all([
        db.select<any[]>('SELECT 1 FROM images WHERE IFNULL(is_intermediate_gen, 0) = 1 LIMIT 1'),
        db.select<any[]>('SELECT 1 FROM images WHERE IFNULL(is_grid_gen, 0) = 1 LIMIT 1')
    ]);

    return {
        hasIntermediates: intermediateCheck.length > 0,
        hasGrids: gridCheck.length > 0
    };
};

/** 
 * Emergency fix: Clear all thumbnail_path entries to force fallback to source images.
 * Use when thumbnails are broken/missing.
 */
export const clearAllThumbnailPaths = async (): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    return await dbMutex.dispatch(async () => {
        const db = await getDb();
        let retries = 3;
        while (retries > 0) {
            try {
                const result = await db.execute('UPDATE images SET thumbnail_path = NULL, micro_thumbnail = NULL, thumbnail_source = NULL WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ""');
                console.log('[DB] Cleared thumbnail paths:', result.rowsAffected);
                return result.rowsAffected;
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                if (errorMsg.includes('database is locked') && retries > 1) {
                    console.log(`[DB] Locked during clear, retrying... (${retries})`);
                    await new Promise(r => setTimeout(r, 200));
                    retries--;
                } else {
                    console.error('[DB] Failed to clear thumbnails', e);
                    throw e;
                }
            }
        }
        return 0;
    });
};

/**
 * Update the thumbnail_path for a single image.
 * Used by lazy thumbnail generation to persist generated thumbnails.
 */
export const updateThumbnailPath = async (id: string, thumbnailPath: string): Promise<void> => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { thumbnailUrl: thumbnailPath });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    const normalizedThumb = normalizePath(thumbnailPath);
    await db.execute(
        'UPDATE images SET thumbnail_path = ? WHERE id = ?',
        [normalizedThumb, normalizedId]
    );
};

/**
 * Batch update thumbnail data for multiple images.
 * Includes path, micro-thumbnail (base64), and source for complete regeneration.
 * Uses individual updates with retry to avoid database lock issues.
 */
export const updateThumbnailPathsBatch = async (updates: {
    id: string;
    thumbnailPath: string;
    microThumbnail?: string | null;
    thumbnailSource?: string | null;
}[]): Promise<void> => {
    if (updates.length === 0) return;
    if (isBrowserMockMode()) {
        updates.forEach(update => updateBrowserMockImage(update.id, {
            thumbnailUrl: update.thumbnailPath,
            microThumbnail: update.microThumbnail ?? undefined,
            thumbnailSource: update.thumbnailSource ?? undefined
        }));
        return;
    }

    const db = await getDb();
    let failCount = 0;

    // Individual updates with retry - avoids holding a transaction lock
    for (const { id, thumbnailPath, microThumbnail, thumbnailSource } of updates) {
        const normalizedId = normalizePath(id);
        const normalizedThumb = normalizePath(thumbnailPath);

        let retries = 3;
        while (retries > 0) {
            try {
                await db.execute(
                    'UPDATE images SET thumbnail_path = ?, micro_thumbnail = COALESCE(?, micro_thumbnail), thumbnail_source = COALESCE(?, thumbnail_source) WHERE id = ?',
                    [normalizedThumb, microThumbnail || null, thumbnailSource || null, normalizedId]
                );
                break;
            } catch (e: unknown) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                if (errorMsg.includes('database is locked') && retries > 1) {
                    retries--;
                    await new Promise(r => setTimeout(r, 50));
                } else {
                    failCount++;
                    if (failCount <= 3) {
                        console.warn(`[DB] Thumbnail update failed for ${normalizedId.slice(-40)}:`, errorMsg);
                    }
                    break;
                }
            }
        }
    }

    if (failCount > 0) {
        console.warn(`[DB] ${failCount} thumbnail updates failed`);
    }
};


export interface ExistingMetadata {
    timestamp: number;
    fileSize: number;
    metadataJson: string;
    isFavorite: boolean;
    isPinned: boolean;
    boardId?: string;
    groupId?: string;
    notes?: string;
}

export const getExistingMetadata = async (ids: string[]): Promise<Map<string, ExistingMetadata>> => {
    if (ids.length === 0) return new Map();
    if (isBrowserMockMode()) {
        const idSet = new Set(ids);
        const map = new Map<string, ExistingMetadata>();
        getBrowserMockImages()
            .filter(image => idSet.has(image.id))
            .forEach(image => map.set(image.id, {
                timestamp: image.timestamp,
                fileSize: image.fileSize ?? 0,
                metadataJson: JSON.stringify(image.metadata),
                isFavorite: image.isFavorite,
                isPinned: image.isPinned ?? false,
                boardId: image.boardId,
                groupId: image.groupId,
                notes: image.notes
            }));
        return map;
    }

    const db = await getDb();
    const map = new Map<string, ExistingMetadata>();
    const CHUNK_SIZE = 900;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');

        try {
            const rows = await db.select<{ id: string, timestamp: number, file_size: number, metadata_json: string, is_favorite: number, is_pinned: number, board_id?: string | null, group_id?: string | null, notes?: string | null }[]>(
                `SELECT id, timestamp, file_size, metadata_json, is_favorite, is_pinned, board_id, group_id, notes FROM images WHERE id IN (${placeholders})`,
                chunk
            );

            rows.forEach(r => {
                map.set(r.id, {
                    timestamp: r.timestamp,
                    fileSize: r.file_size,
                    metadataJson: r.metadata_json,
                    isFavorite: !!r.is_favorite,
                    isPinned: !!r.is_pinned,
                    boardId: r.board_id ?? undefined,
                    groupId: r.group_id ?? undefined,
                    notes: r.notes ?? undefined
                });
            });
        } catch (e) {
            console.error('[DB] Failed to fetch existing metadata', e);
        }
    }

    return map;
};
