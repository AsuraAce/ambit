import { commands } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { AIImage, GeneratorTool } from '../../types';
import { getDb, dbMutex } from './connection';
import { mapRowToImage, IMAGE_FIELDS_LIGHT } from './repoUtils';
import { normalizePath } from '../../utils/pathUtils';

export const insertImage = async (image: AIImage) => {
    await dbMutex.dispatch(async () => {
        // Reuse the batch logic for single inserts to keep SQL in sync (Rust-side)
        const record = {
            id: normalizePath(image.id),
            path: normalizePath(image.id),
            width: image.width,
            height: image.height,
            fileSize: image.fileSize || 0,
            timestamp: image.timestamp,
            metadataJson: JSON.stringify(image.metadata),
            thumbnailPath: normalizePath((image.thumbnailUrl || '').replace(/^https?:\/\/tauri\.localhost\/_up_\//i, '')),
            isFavorite: !!image.isFavorite,
            isPinned: !!image.isPinned,
            isDeleted: !!image.isDeleted,
            isMissing: !!image.isMissing,
            userMasked: image.userMasked === true ? true : (image.userMasked === false ? false : null),
            groupId: image.groupId || null,
            boardId: image.boardId || null,
            notes: image.notes || null,
            originalMetadataJson: image.originalMetadata ? JSON.stringify(image.originalMetadata) : null
        };

        await commands.saveImagesBatch([record]);

        // Junction Table Sync
        if (image.boardId) {
            const db = await getDb();
            await db.execute(
                'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
                [image.boardId, record.id]
            );
        }
    });
};

export const insertImagesBatch = async (images: AIImage[]) => {
    if (images.length === 0) return;

    await dbMutex.dispatch(async () => {
        const records = images.map(img => ({
            id: normalizePath(img.id),
            path: normalizePath(img.id),
            width: img.width,
            height: img.height,
            fileSize: img.fileSize || 0,
            timestamp: img.timestamp,
            metadataJson: JSON.stringify(img.metadata),
            thumbnailPath: normalizePath((img.thumbnailUrl || '').replace(/^https?:\/\/tauri\.localhost\/_up_\//i, '')),
            isFavorite: !!img.isFavorite,
            isPinned: !!img.isPinned,
            isDeleted: !!img.isDeleted,
            isMissing: !!img.isMissing,
            userMasked: img.userMasked === true ? true : (img.userMasked === false ? false : null),
            groupId: img.groupId || null,
            boardId: img.boardId || null,
            notes: img.notes || null,
            originalMetadataJson: img.originalMetadata ? JSON.stringify(img.originalMetadata) : null
        }));

        const CHUNK_SIZE = 5000;
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            try {
                await unwrap(commands.saveImagesBatch(chunk));
            } catch (e) {
                console.error('[DB] Rust batch insert failed', e);
                throw e;
            }
        }
    });

    const db = await getDb();
    await db.execute('UPDATE images SET user_masked = NULL WHERE user_masked = 0');

    // rebuildFacetCache() is no longer called automatically per batch to avoid O(N^2) behavior during syncs.
    // It should be called once at the end of the sync/import process.
};

/**
 * Rebuilds the facet_cache table with pre-computed counts for all resources.
 * This runs the expensive queries once per import, so getFacets becomes instant.
 */
export const rebuildFacetCache = async (): Promise<number> => {
    try {
        const count = await unwrap(commands.rebuildFacetCache());
        console.log(`[DB] Rebuilt facet cache with ${count} entries`);
        return count;
    } catch (e) {
        console.error('[DB] Failed to rebuild facet cache', e);
        return 0;
    }
};

/**
 * High-performance bulk sync of the collection_images junction table.
 * Links images to their InvokeAI boards.
 * @param ids Optional array of image IDs to sync. If omitted, syncs all images with board_ids.
 */
export const syncCollectionImages = async (ids?: string[]) => {
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

export const isImageNew = async (id: string): Promise<boolean> => {
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
    const db = await getDb();
    const orderBy = prioritizePinned ? 'ORDER BY is_pinned DESC, timestamp DESC' : 'ORDER BY timestamp DESC';

    // Optimize: Use STORED generated columns instead of LIKE scan
    let filterClauses = 'WHERE is_deleted = 0';
    if (!showIntermediates) {
        // checks for 1 (true). NULL or 0 are considered false.
        filterClauses += ' AND (is_intermediate_gen IS NULL OR is_intermediate_gen = 0)';
    }
    if (!showGrids) {
        filterClauses += ' AND (is_grid_gen IS NULL OR is_grid_gen = 0)';
    }

    const query = limit
        ? `SELECT ${IMAGE_FIELDS_LIGHT}, m.name as resolved_model_name FROM images LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash ${filterClauses} ${orderBy} LIMIT ${limit} OFFSET ${offset}`
        : `SELECT ${IMAGE_FIELDS_LIGHT}, m.name as resolved_model_name FROM images LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash ${filterClauses} ${orderBy}`;

    const rows = await db.select<any[]>(query);
    return rows.map(mapRowToImage);
};

export const getImagesByIds = async (ids: string[]): Promise<AIImage[]> => {
    if (ids.length === 0) return [];
    const db = await getDb();

    const CHUNK_SIZE = 900;
    let allImages: AIImage[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT ${IMAGE_FIELDS_LIGHT}, m.name as resolved_model_name FROM images LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash WHERE images.id IN (${placeholders})`;
        const rows = await db.select<any[]>(query, chunk);
        allImages = [...allImages, ...rows.map(mapRowToImage)];
    }

    return allImages;
};

export const getImageWithFullMetadata = async (id: string): Promise<AIImage | null> => {
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
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_pinned = $1 WHERE id = $2', [isPinned ? 1 : 0, normalizedId]);
    // Note: Asset thumbnails update via facet cache rebuild, not on individual pins.
};

export const toggleImageFavorite = async (id: string, isFavorite: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_favorite = $1 WHERE id = $2', [isFavorite ? 1 : 0, normalizedId]);
};

export const toggleImageMask = async (id: string, userMasked: boolean | null) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    let value: number | null = null;
    if (userMasked === true) value = 1;
    if (userMasked === false) value = 0;

    await db.execute('UPDATE images SET user_masked = $1 WHERE id = $2', [value, normalizedId]);
};

export const toggleImageIntermediate = async (id: string, isIntermediate: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);

    await db.execute(
        "UPDATE images SET metadata_json = json_set(metadata_json, '$.isIntermediate', $1) WHERE id = $2",
        [isIntermediate ? 1 : 0, normalizedId]
    );
};

export const deleteImage = async (id: string) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('DELETE FROM images WHERE id = $1', [normalizedId]);
};

export const markAsDeleted = async (ids: string[], deleted: boolean) => {
    if (ids.length === 0) return;
    const normalizedIds = ids.map(normalizePath);
    const db = await getDb();
    const placeholders = normalizedIds.map(() => '?').join(',');
    await db.execute(`UPDATE images SET is_deleted = ? WHERE id IN (${placeholders})`, [deleted ? 1 : 0, ...normalizedIds]);
};

export const updateImageWorkflow = async (id: string, workflowJson: string): Promise<void> => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    const rows = await db.select('SELECT metadata_json FROM images WHERE id = ?', [normalizedId]) as any[];
    if (rows.length === 0) return;

    try {
        const metadata = JSON.parse(rows[0].metadata_json);
        metadata.workflowJson = workflowJson;

        await db.execute('UPDATE images SET metadata_json = ? WHERE id = ?', [JSON.stringify(metadata), normalizedId]);
    } catch (e) {
        console.error('[DB] Failed to update workflow for image', normalizedId, e);
    }
};

export const updateFavorite = async (id: string, isFavorite: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, normalizedId]);
};

export const updatePinned = async (id: string, isPinned: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_pinned = ? WHERE id = ?', [isPinned ? 1 : 0, normalizedId]);
};
export const updateImagesBoard = async (ids: string[], boardId: string | null) => {
    if (ids.length === 0) return;
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
    const db = await getDb();
    // Use indexed STORED generated columns for instant lookup
    const [intermediateCheck, gridCheck] = await Promise.all([
        db.select<any[]>('SELECT 1 FROM images WHERE is_intermediate_gen = 1 LIMIT 1'),
        db.select<any[]>('SELECT 1 FROM images WHERE is_grid_gen = 1 LIMIT 1')
    ]);

    return {
        hasIntermediates: intermediateCheck.length > 0,
        hasGrids: gridCheck.length > 0
    };
};
