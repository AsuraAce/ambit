import { commands } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { AIImage, GeneratorTool } from '../../types';
import { getDb, dbMutex } from './connection';
import { mapRowToImage, IMAGE_FIELDS_LIGHT } from './repoUtils';
import { normalizePath, urlToPath } from '../../utils/pathUtils';
import {
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    liveWatchNow,
} from '../../utils/liveWatchPerf';

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
    const insertStartedAt = liveWatchNow();

    await dbMutex.dispatch(async () => {
        const records = images.map(img => ({
            id: normalizePath(img.id),
            path: normalizePath(img.id),
            width: img.width,
            height: img.height,
            fileSize: img.fileSize || 0,
            timestamp: img.timestamp,
            metadataJson: JSON.stringify(img.metadata),
            thumbnailPath: urlToPath(img.thumbnailUrl),
            microThumbnail: img.microThumbnail || null,
            thumbnailSource: img.thumbnailSource || null,
            isFavorite: !!img.isFavorite,
            isPinned: !!img.isPinned,
            isDeleted: !!img.isDeleted,
            isMissing: !!img.isMissing,
            userMasked: img.userMasked === true ? true : (img.userMasked === false ? false : null),
            groupId: img.groupId || null,
            boardId: img.boardId || null,
            notes: img.notes || null,
            originalMetadataJson: img.originalChunks ? JSON.stringify(img.originalChunks) : (img.originalMetadata ? JSON.stringify(img.originalMetadata) : null),
            originalStateJson: img.originalState ? JSON.stringify(img.originalState) : null,
            isCorrupt: !!img.isCorrupt
        }));

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
    });

    const cleanupStartedAt = liveWatchNow();
    const db = await getDb();
    await db.execute('UPDATE images SET user_masked = NULL WHERE user_masked = 0');
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
                    resolved_model_name = NULL
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
                    resolved_model_name = ?
                WHERE id = ?
            `, [
                img.original_parsed_json, // Use the exact same JSON string!
                originalMetadata.modelHash || null,
                originalMetadata.model || null,
                originalMetadata.tool || GeneratorTool.UNKNOWN,
                originalMetadata.model || null, // resolved_model_name matches model_name on revert
                normalizedId
            ]);
        } catch (e) {
            console.error('[DB] Failed to revert metadata:', e);
            // Fallback: just clear overrides if parsing fails
            await db.execute('UPDATE images SET metadata_json = NULL WHERE id = ?', [normalizedId]);
        }
    });
};

/**
 * Atomic update for the notes column.
 */
export const updateImageNotesCol = async (id: string, notes: string | null) => {
    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const normalizedId = normalizePath(id);
        await db.execute('UPDATE images SET notes = ? WHERE id = ?', [notes, normalizedId]);
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
        filterClauses += ' AND IFNULL(is_intermediate_gen, 0) = 0';
    }
    if (!showGrids) {
        filterClauses += ' AND IFNULL(is_grid_gen, 0) = 0';
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

/**
 * Deletes the image from the database AND moves the physical file to the OS trash.
 * Also moves the generated thumbnail to trash.
 */
export const deleteImageFromDisk = async (id: string, path: string, thumbnailPath: string | null) => {
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
        metadata.hasWorkflowHint = true; // Mark as having workflow

        await db.execute('UPDATE images SET metadata_json = ? WHERE id = ?', [JSON.stringify(metadata), normalizedId]);
    } catch (e) {
        console.error('[DB] Failed to update workflow for image', normalizedId, e);
    }
};

export const updateImageWorkflowHint = async (id: string, hasWorkflow: boolean): Promise<void> => {
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
