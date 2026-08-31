import { invoke } from '@tauri-apps/api/core';
import { commands, type DeleteRemovedImagesResult, type RemovedLifecycleMutationResult } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { AIImage, FacetType, GeneratorTool, ImageMetadata, type VideoMetadataField } from '../../types';
import { getDb, dbMutex } from './connection';
import { mapRowToImage, getImageFieldsLight, getImageFieldsFull, INVOKE_IMAGE_SOURCE_FIELDS, REMOVED_IMAGE_FIELDS, type ImageRow } from './repoUtils';
import { normalizePath, urlToPath } from '../../utils/pathUtils';
import { orderFacetTypes, TouchedFacetResources } from '../../utils/touchedFacetTypes';
import {
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    liveWatchNow,
} from '../../utils/liveWatchPerf';
import { isBrowserMockMode } from '../runtime';
import { deleteBrowserMockImages, getBrowserMockImages, updateBrowserMockImage } from '../browserMockData';
import { clearLibraryStatsCache } from './searchRepo';
import { assertMutationMatched } from './mutationGuard';
import {
    clearAllCollectionThumbnailCaches,
    clearCollectionThumbnailCacheForCollections,
    clearCollectionThumbnailCacheForImages,
    clearInvokeBoardThumbnailCaches,
} from './collectionRepo';
import { scanImageNative } from '../metadataParser';
import { isKnownInvokeImageAsset } from '../../utils/invokeImageSource';

type PersistableImageRecord = {
    id: string;
    path: string;
    width: number;
    height: number;
    fileSize: number;
    fileHash: string | null;
    timestamp: number;
    metadataJson: string;
    thumbnailPath: string;
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
    invokeImageName: string | null;
    invokeImageCategory: string | null;
    invokeImageOrigin: string | null;
    invokeOwnerId: string | null;
};

interface CountRow {
    count: number;
}

interface OriginalParsedMetadataRow {
    original_parsed_json: string | null;
}

interface MetadataJsonRow {
    metadata_json: string | null;
}

type RemovedImageRow = ImageRow & {
    id: string;
    path: string;
    thumbnail_path?: string | null;
    collection_ids_json?: string | null;
};

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
    originalMetadataJson: image.originalChunks
        ? (Object.keys(image.originalChunks).length > 0 ? JSON.stringify(image.originalChunks) : null)
        : (image.originalMetadata ? JSON.stringify(image.originalMetadata) : null),
    originalStateJson: image.originalState ? JSON.stringify(image.originalState) : null,
    isCorrupt: !!image.isCorrupt,
    // InvokeAI rows always have a name. Native upsert uses it to distinguish an
    // authoritative nullable source snapshot from omitted generic-scan fields.
    invokeImageName: image.invokeImageName || null,
    invokeImageCategory: image.invokeImageCategory || null,
    invokeImageOrigin: image.invokeImageOrigin || null,
    invokeOwnerId: image.invokeOwnerId || null
});

const persistImageRecords = async (
    records: PersistableImageRecord[],
    db: Awaited<ReturnType<typeof getDb>>
) => {
    const CHUNK_SIZE = 5000;
    console.log(`[RepoDebug] Saving batch. First record originalMetadataJson:`, records[0].originalMetadataJson ? records[0].originalMetadataJson.substring(0, 100) : 'NULL');

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

    const defaultVisibleIds = records
        .filter(record => record.userMasked === false)
        .map(record => record.id);

    const cleanupStartedAt = liveWatchNow();
    for (const chunk of chunkItems(defaultVisibleIds)) {
        const placeholders = chunk.map(() => '?').join(',');
        await db.execute(
            `UPDATE images SET user_masked = NULL WHERE user_masked = 0 AND id IN (${placeholders})`,
            chunk
        );
    }
    debugLiveWatchPerf('DB user_masked cleanup complete', {
        imageCount: records.length,
        cleanupCandidates: defaultVisibleIds.length,
        cleanupMs: elapsedMs(cleanupStartedAt)
    });
    await clearCollectionThumbnailCacheForImages(records.map(record => record.id));
};

const clearFacetRelatedStatsCache = async () => {
    clearLibraryStatsCache();
};

const normalizeFacetType = (type: string): FacetType | null => {
    switch (type) {
        case 'checkpoints':
        case 'loras':
        case 'embeddings':
        case 'hypernetworks':
        case 'controlNets':
        case 'ipAdapters':
        case 'tools':
            return type;
        case 'control_nets':
            return 'controlNets';
        case 'ip_adapters':
            return 'ipAdapters';
        default:
            return null;
    }
};

const runRebuildFacetCache = async (): Promise<number> => {
    const count = await unwrap(commands.rebuildFacetCache());
    await clearFacetRelatedStatsCache();
    return count;
};

const runRebuildFacetCacheIncrementalBatch = async (types: string[]): Promise<number> => {
    const facetTypes = orderFacetTypes(
        types
            .map(normalizeFacetType)
            .filter((type): type is FacetType => type !== null)
    );
    if (facetTypes.length === 0) {
        return 0;
    }

    const count = await invoke<number>('rebuild_facet_cache_incremental_batch', { facetTypes });
    await clearFacetRelatedStatsCache();
    return count;
};

const runRefreshFacetCacheForResources = async (resources: TouchedFacetResources): Promise<number> => {
    const count = await invoke<number>('refresh_facet_cache_for_resources', { touches: resources });
    await clearFacetRelatedStatsCache();
    return count;
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
            await clearCollectionThumbnailCacheForCollections([image.boardId]);
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

    infoLiveWatchPerf('insertImagesBatch complete', {
        imageCount: images.length,
        totalMs: elapsedMs(insertStartedAt)
    });

    // rebuildFacetCache() is no longer called automatically per batch to avoid O(N^2) behavior during syncs.
    // It should be called once at the end of the sync/import process.
};

export interface ImagePathIdentityMove {
    oldId: string;
    newId: string;
    thumbnailPath?: string | null;
    thumbnailSource?: string | null;
}

export interface ImagePathIdentityMoveResult {
    moved: number;
    skippedTargetExists: number;
    skippedSourceMissing: number;
}

export const moveImagePathIdentities = async (
    moves: ImagePathIdentityMove[]
): Promise<ImagePathIdentityMoveResult> => {
    if (moves.length === 0) {
        return { moved: 0, skippedTargetExists: 0, skippedSourceMissing: 0 };
    }

    if (isBrowserMockMode()) {
        let moved = 0;
        let skippedTargetExists = 0;
        let skippedSourceMissing = 0;

        for (const move of moves) {
            const oldImage = getBrowserMockImages().find(image => image.id === move.oldId);
            if (!oldImage) {
                skippedSourceMissing++;
                continue;
            }

            if (getBrowserMockImages().some(image => image.id === move.newId)) {
                skippedTargetExists++;
                continue;
            }

            updateBrowserMockImage(move.oldId, {
                id: move.newId,
                url: move.newId,
                thumbnailUrl: move.thumbnailPath || move.newId,
                thumbnailSource: move.thumbnailSource || undefined,
                isMissing: false
            });
            moved++;
        }

        return { moved, skippedTargetExists, skippedSourceMissing };
    }

    const normalizedMoves = moves
        .map(move => ({
            oldId: normalizePath(move.oldId),
            newId: normalizePath(move.newId),
            thumbnailPath: move.thumbnailPath ? normalizePath(move.thumbnailPath) : null,
            thumbnailSource: move.thumbnailSource || null
        }))
        .filter(move => move.oldId !== move.newId);

    if (normalizedMoves.length === 0) {
        return { moved: 0, skippedTargetExists: 0, skippedSourceMissing: 0 };
    }

    return unwrap(commands.moveImagePathIdentities(normalizedMoves));
};

export const moveImagePathIdentity = async (
    oldId: string,
    newId: string,
    thumbnailPath?: string | null,
    thumbnailSource?: string | null
): Promise<boolean> => {
    const result = await moveImagePathIdentities([{
        oldId,
        newId,
        thumbnailPath,
        thumbnailSource
    }]);
    return result.moved === 1;
};

export const markImagePathIdentitiesMissing = async (ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0;

    const normalizedIds = Array.from(new Set(ids.map(normalizePath)));
    if (isBrowserMockMode()) {
        let marked = 0;
        normalizedIds.forEach(id => {
            const existing = getBrowserMockImages().find(image => image.id === id);
            if (!existing || existing.isMissing) return;
            updateBrowserMockImage(id, { isMissing: true });
            marked++;
        });
        return marked;
    }

    return unwrap(commands.markImagePathIdentitiesMissing(normalizedIds));
};

/**
 * Rebuilds the facet_cache table with pre-computed counts for all resources.
 * This runs the expensive queries once per import, so getFacets becomes instant.
 */
export const rebuildFacetCache = async (): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    try {
        const count = await runRebuildFacetCache();
        console.log(`[DB] Rebuilt facet cache with ${count} entries`);
        return count;
    } catch (e) {
        console.error('[DB] Failed to rebuild facet cache', e);
        return 0;
    }
};

export const rebuildFacetCacheStrict = async (): Promise<number> => {
    const count = await runRebuildFacetCache();
    console.log(`[DB] Rebuilt facet cache with ${count} entries`);
    return count;
};

/**
 * Rebuilds a specific facet type in the cache.
 * Much faster than a full rebuild for metadata edits.
 * @param type 'checkpoints' | 'tools' | 'loras' | 'embeddings' | 'hypernetworks' | 'controlNets' | 'ipAdapters'
 */
export const rebuildFacetCacheIncremental = async (type: string): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    try {
        const count = await runRebuildFacetCacheIncrementalBatch([type]);
        console.log(`[DB] Rebuilt incremental facet cache for ${type}: ${count} entries`);
        return count;
    } catch (e) {
        console.error(`[DB] Failed to rebuild incremental facet cache for ${type}`, e);
        return 0;
    }
};

export const rebuildFacetCacheIncrementalBatch = async (types: string[]): Promise<number> => {
    try {
        const count = await runRebuildFacetCacheIncrementalBatch(types);
        console.log(`[DB] Rebuilt incremental facet cache for ${types.join(', ')}: ${count} entries`);
        return count;
    } catch (e) {
        console.error(`[DB] Failed to rebuild incremental facet cache batch for ${types.join(', ')}`, e);
        return 0;
    }
};

export const rebuildFacetCacheIncrementalBatchStrict = async (types: string[]): Promise<number> => {
    const count = await runRebuildFacetCacheIncrementalBatch(types);
    console.log(`[DB] Rebuilt incremental facet cache for ${types.join(', ')}: ${count} entries`);
    return count;
};

export const refreshFacetCacheForResourcesStrict = async (resources: TouchedFacetResources): Promise<number> => {
    if (isBrowserMockMode()) return 0;

    const count = await runRefreshFacetCacheForResources(resources);
    console.log('[DB] Refreshed live facet cache resources:', count);
    return count;
};

export const rebuildThumbnailFacetCache = async (): Promise<void> => {
    await rebuildFacetCacheIncrementalBatch([
        'checkpoints',
        'loras',
        'embeddings',
        'hypernetworks',
        'controlNets',
        'ipAdapters'
    ]);
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

        let requestedImages = `
            SELECT *
            FROM scoped_images AS images
            WHERE invoke_scope_hidden = 0
        `;

        const params: unknown[] = [];
        if (ids && ids.length > 0) {
            // SQLite has a limit on parameters, so we chunk if necessary, 
            // but for typical batch sizes (500) it's fine.
            const placeholders = ids.map(() => '?').join(',');
            requestedImages += ` AND id IN (${placeholders})`;
            params.push(...ids);
        }

        const query = `
            WITH requested_images AS (${requestedImages})
            INSERT OR IGNORE INTO collection_images (collection_id, image_id)
            SELECT snapshot.collection_id, images.id
            FROM requested_images images
            JOIN invoke_board_membership_snapshot snapshot
              ON snapshot.invoke_image_name = images.invoke_image_name
            JOIN scoped_collections collection
              ON collection.id = snapshot.collection_id
             AND collection.invoke_source_id IS images.invoke_source_id
             AND collection.invoke_owner_id IS images.invoke_owner_id
            LEFT JOIN invoke_board_membership_exclusions exclusion
              ON exclusion.collection_id = snapshot.collection_id
             AND exclusion.invoke_image_name = snapshot.invoke_image_name
            WHERE exclusion.collection_id IS NULL
            UNION
            SELECT addition.collection_id, images.id
            FROM requested_images images
            JOIN invoke_board_membership_additions addition
              ON addition.image_id = images.id
            JOIN scoped_collections collection
              ON collection.id = addition.collection_id
        `;

        await db.execute(query, params);
        if (ids && ids.length > 0) {
            await clearCollectionThumbnailCacheForImages(ids);
        } else {
            await clearInvokeBoardThumbnailCaches();
        }
        console.log('[DB] Bulk collection sync complete.');
    });
};

/**
 * Safely updates individual fields within the metadata_json blob without overwriting the entire object.
 * CRITICAL: Prevents data loss when editing from "light" grid view imagery.
 */
export const updateImageMetadataFields = async (id: string, updates: Record<string, unknown>) => {
    if (isBrowserMockMode()) {
        const image = getBrowserMockImages().find(item => item.id === id);
        if (image) {
            const fieldSources = image.mediaType === 'video'
                ? Object.keys(updates).reduce((sources, key) => {
                    if (['tool', 'positivePrompt', 'negativePrompt', 'model', 'overrideModel', 'generationType', 'generationMode'].includes(key)) {
                        sources[key as VideoMetadataField] = 'user_override';
                        if (key === 'overrideModel') sources.model = 'user_override';
                    }
                    return sources;
                }, { ...image.metadata.fieldSources })
                : image.metadata.fieldSources;
            updateBrowserMockImage(id, { metadata: { ...image.metadata, ...updates, fieldSources } });
        }
        return;
    }

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const normalizedId = normalizePath(id);

        let query = 'UPDATE images SET metadata_json = ';
        let jsonSetExpr = 'metadata_json';
        const params: unknown[] = [];

        Object.entries(updates).forEach(([key, value]) => {
            // CRITICAL: If value is an array or object, it must be serialized and passed via JSON function
            // Otherwise SQLite might store it as a literal string "[object Object]" or similar corruption.
            const previousExpr = jsonSetExpr;
            if (value !== null && typeof value === 'object') {
                jsonSetExpr = `json_set(${previousExpr}, '$.${key}', json(?))`;
                params.push(JSON.stringify(value));
            } else {
                jsonSetExpr = `json_set(${previousExpr}, '$.${key}', ?)`;
                params.push(value);
            }
            if (['tool', 'positivePrompt', 'negativePrompt', 'model', 'overrideModel', 'generationType', 'generationMode'].includes(key)) {
                let videoExpr = `json_set(${jsonSetExpr}, '$.fieldSources.${key}', 'user_override')`;
                if (key === 'overrideModel') {
                    videoExpr = `json_set(${videoExpr}, '$.fieldSources.model', 'user_override')`;
                }
                jsonSetExpr = `CASE WHEN media_type = 'video' THEN ${videoExpr} ELSE ${jsonSetExpr} END`;
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

        if ('seed' in updates) {
            query += ', seed = ?';
            params.push(updates.seed ?? null);
        }

        if ('generationMode' in updates || 'generationType' in updates) {
            query += ', generation_type = ?';
            params.push(updates.generationMode ?? updates.generationType ?? null);
        }

        // SPECIAL CASE: Model name is also denormalized for filtering
        if ('overrideModel' in updates) {
            query += ', resolved_model_name = ?';
            params.push(updates.overrideModel);
        } else if ('model' in updates) {
            query += ', resolved_model_name = ?';
            params.push(updates.model);
        }

        query += ' WHERE id = ? AND id IN (SELECT id FROM scoped_images)';
        params.push(normalizedId);

        const result = await db.execute(query, params);
        assertMutationMatched(result, normalizedId, 'Updating metadata');
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
        const rows = await db.select<OriginalParsedMetadataRow[]>('SELECT original_parsed_json FROM scoped_images WHERE id = ?', [normalizedId]);
        if (rows.length === 0) {
            throw new Error(`Reverting metadata failed because the asset was not found: ${normalizedId}`);
        }
        const img = rows[0];

        if (!img.original_parsed_json) {
            // If no original parsed metadata, just clear overrides
            const result = await db.execute(`
                UPDATE images 
                SET metadata_json = NULL,
                    tool = NULL,
                    model_hash = NULL,
                    model_name = NULL,
                    resolved_model_name = NULL,
                    seed = NULL,
                    generation_type = NULL,
                    positive_prompt = NULL,
                    negative_prompt = NULL
                WHERE id = ? AND id IN (SELECT id FROM scoped_images)
            `, [normalizedId]);
            assertMutationMatched(result, normalizedId, 'Reverting metadata');
            return;
        }

        let originalMetadata: Partial<ImageMetadata> & {
            positive_prompt?: string;
            negative_prompt?: string;
        };
        try {
            originalMetadata = JSON.parse(img.original_parsed_json) as typeof originalMetadata;
        } catch (error) {
            console.error('[DB] Failed to parse original metadata:', error);
            const result = await db.execute(
                'UPDATE images SET metadata_json = NULL, seed = NULL, generation_type = NULL, positive_prompt = NULL, negative_prompt = NULL WHERE id = ? AND id IN (SELECT id FROM scoped_images)',
                [normalizedId]
            );
            assertMutationMatched(result, normalizedId, 'Reverting metadata');
            return;
        }

        // SAFEGUARD: Ensure the image doesn't disappear from the UI after revert.
        originalMetadata.isIntermediate = false;

        // 2. Update metadata_json and denormalized columns with the baseline
        // CRITICAL: Set metadata_json = original_parsed_json to ensure they match exactly
        const result = await db.execute(`
                UPDATE images 
                SET metadata_json = ?,
                    model_hash = ?,
                    model_name = ?,
                    tool = ?,
                    resolved_model_name = ?,
                    seed = ?,
                    positive_prompt = ?,
                    negative_prompt = ?,
                    generation_type = ?
                WHERE id = ? AND id IN (SELECT id FROM scoped_images)
            `, [
                img.original_parsed_json, // Use the exact same JSON string!
                originalMetadata.modelHash || null,
                originalMetadata.model || null,
                originalMetadata.tool || GeneratorTool.UNKNOWN,
                originalMetadata.model || null, // resolved_model_name matches model_name on revert
                originalMetadata.seed ?? null,
                originalMetadata.positivePrompt ?? originalMetadata.positive_prompt ?? null,
                originalMetadata.negativePrompt ?? originalMetadata.negative_prompt ?? null,
                originalMetadata.generationMode ?? originalMetadata.generationType ?? null,
                normalizedId
            ]);
        assertMutationMatched(result, normalizedId, 'Reverting metadata');
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
        const result = await db.execute(
            'UPDATE images SET notes = ? WHERE id = ? AND id IN (SELECT id FROM scoped_images)',
            [notes, normalizedId]
        );
        assertMutationMatched(result, normalizedId, 'Updating notes');
    });
};

export const isImageNew = async (id: string): Promise<boolean> => {
    if (isBrowserMockMode()) {
        return !getBrowserMockImages().some(image => image.id === id);
    }

    const db = await getDb();
    const result = await db.select<CountRow[]>(`SELECT count(*) as count FROM images WHERE id = ?`, [id]);
    return (result[0]?.count || 0) === 0;
};

export const getAllImages = async (
    limit?: number,
    offset: number = 0,
    prioritizePinned: boolean = false,
    showIntermediates: boolean = false,
    showGrids: boolean = false,
    showInvokeImageAssets: boolean = false
): Promise<AIImage[]> => {
    if (isBrowserMockMode()) {
        const images = getBrowserMockImages()
            .filter(image => !image.isDeleted)
            .filter(image => showIntermediates || !(image.isIntermediate || image.metadata.isIntermediate))
            .filter(image => showGrids || !image.metadata.isGrid)
            .filter(image => showInvokeImageAssets || !isKnownInvokeImageAsset(image.invokeImageCategory))
            .sort((a, b) => prioritizePinned && a.isPinned !== b.isPinned
                ? (a.isPinned ? -1 : 1)
                : b.timestamp - a.timestamp);
        return limit ? images.slice(offset, offset + limit) : images;
    }

    const db = await getDb();
    const orderBy = prioritizePinned ? 'ORDER BY is_pinned DESC, timestamp DESC' : 'ORDER BY timestamp DESC';

    // Optimize: Use STORED generated columns instead of LIKE scan
    let filterClauses = 'WHERE invoke_scope_hidden = 0 AND is_deleted = 0';
    if (!showIntermediates) {
        filterClauses += ' AND IFNULL(is_intermediate_gen, 0) = 0';
    }
    if (!showGrids) {
        filterClauses += ' AND IFNULL(is_grid_gen, 0) = 0';
    }
    if (!showInvokeImageAssets) {
        filterClauses += ' AND IFNULL(is_invoke_asset_gen, 0) = 0';
    }

    const query = limit
        ? `SELECT ${getImageFieldsLight()} FROM scoped_images AS images ${filterClauses} ${orderBy} LIMIT ${limit} OFFSET ${offset}`
        : `SELECT ${getImageFieldsLight()} FROM scoped_images AS images ${filterClauses} ${orderBy}`;

    const rows = await db.select<ImageRow[]>(query);
    return rows.map(mapRowToImage);
};

export const getImagesByIds = async (
    ids: string[],
    options: { includeOwnerHidden?: boolean } = {}
): Promise<AIImage[]> => {
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
        const source = options.includeOwnerHidden ? 'images' : 'scoped_images';
        const ownerScope = options.includeOwnerHidden ? '' : ' AND invoke_scope_hidden = 0';
        const query = `SELECT ${getImageFieldsFull()} FROM ${source} AS images WHERE images.id IN (${placeholders})${ownerScope}`;
        const rows = await db.select<ImageRow[]>(query, chunk);
        allImages = [...allImages, ...rows.map(mapRowToImage)];
    }

    return allImages;
};

export const getFlatInvokeImageIdsForRoot = async (invokeRoot: string): Promise<string[]> => {
    const normalizedRoot = normalizePath(invokeRoot).replace(/\/$/, '');
    const imagesPrefix = `${normalizedRoot}/outputs/images/`;

    if (isBrowserMockMode()) {
        return getBrowserMockImages()
            .map(image => normalizePath(image.id))
            .filter(id => id.startsWith(imagesPrefix) && !id.slice(imagesPrefix.length).includes('/'));
    }

    const db = await getDb();
    const rows = await db.select<Array<{ id: string }>>(
        `SELECT id
         FROM scoped_images AS images
         WHERE id LIKE ?
           AND instr(substr(id, ?), '/') = 0`,
        [`${imagesPrefix}%`, imagesPrefix.length + 1]
    );

    return rows.map(row => normalizePath(row.id));
};

export const getRemovedImagesByIds = async (ids: string[]): Promise<AIImage[]> => {
    if (ids.length === 0) return [];
    const db = await getDb();

    const CHUNK_SIZE = 900;
    let allImages: AIImage[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE).map(normalizePath);
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT ${REMOVED_IMAGE_FIELDS} FROM scoped_removed_images AS removed_images WHERE id IN (${placeholders}) AND invoke_scope_hidden = 0`;
        const rows = await db.select<ImageRow[]>(query, chunk);
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
    const rows = await db.select<ImageRow[]>('SELECT * FROM scoped_images WHERE id = ? AND invoke_scope_hidden = 0', [normalizedId]);
    if (rows.length === 0) return null;

    const image = mapRowToImage(rows[0]);

    // --- ON-DEMAND METADATA RECOVERY ---
    // If this is an A1111 image but it's "Low Fidelity" (no rawParameters),
    // we proactively fetch the true metadata from the file. 
    // This fixes "Legacy" images in the context of the Image Viewer.
    if (image.metadata.tool === GeneratorTool.AUTOMATIC1111 && !image.metadata.rawParameters) {
        try {
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
    const result = await db.execute(
        'UPDATE images SET is_pinned = $1 WHERE id = $2 AND id IN (SELECT id FROM scoped_images)',
        [isPinned ? 1 : 0, normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating pin');
    await clearCollectionThumbnailCacheForImages([normalizedId]);
    // Note: Asset thumbnails update via facet cache rebuild, not on individual pins.
};

export const toggleImageFavorite = async (id: string, isFavorite: boolean) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isFavorite });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    const result = await db.execute(
        'UPDATE images SET is_favorite = $1 WHERE id = $2 AND id IN (SELECT id FROM scoped_images)',
        [isFavorite ? 1 : 0, normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating favorite');
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

    const result = await db.execute(
        'UPDATE images SET user_masked = $1 WHERE id = $2 AND id IN (SELECT id FROM scoped_images)',
        [value, normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating content mask');
    await clearCollectionThumbnailCacheForImages([normalizedId]);
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

    const result = await db.execute(
        "UPDATE images SET metadata_json = json_set(metadata_json, '$.isIntermediate', $1) WHERE id = $2 AND id IN (SELECT id FROM scoped_images)",
        [isIntermediate ? 1 : 0, normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating intermediate status');
};

export const updateVideoPlaybackStatus = async (
    id: string,
    status: 'unknown' | 'playable' | 'external_required'
) => {
    if (isBrowserMockMode()) return;
    const db = await getDb();
    const result = await db.execute(
        "UPDATE images SET playback_status = ? WHERE id = ? AND media_type = 'video' AND id IN (SELECT id FROM scoped_images)",
        [status, normalizePath(id)]
    );
    assertMutationMatched(result, normalizePath(id), 'Updating video playback status');
};

const emptyRemovedLifecycleResult = (): RemovedLifecycleMutationResult => ({
    affectedIds: [],
    notFoundIds: [],
    membershipWarningIds: [],
    touchedResources: {
        checkpoints: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        controlNets: [],
        ipAdapters: [],
        tools: [],
    },
});

export const removeImagesFromLibrary = async (ids: string[]) => {
    const normalizedIds = Array.from(new Set(ids.map(normalizePath).filter(Boolean)));
    if (normalizedIds.length === 0) return emptyRemovedLifecycleResult();
    if (isBrowserMockMode()) {
        const activeIds = new Set(getBrowserMockImages().filter(image => !image.isDeleted).map(image => image.id));
        const affectedIds = normalizedIds.filter(id => activeIds.has(id));
        affectedIds.forEach(id => updateBrowserMockImage(id, { isDeleted: true }));
        return {
            ...emptyRemovedLifecycleResult(),
            affectedIds,
            notFoundIds: normalizedIds.filter(id => !activeIds.has(id)),
        };
    }
    return unwrap(commands.removeImagesFromLibrary(normalizedIds));
};

export const restoreRemovedImages = async (ids: string[]) => {
    const normalizedIds = Array.from(new Set(ids.map(normalizePath).filter(Boolean)));
    if (normalizedIds.length === 0) return emptyRemovedLifecycleResult();
    if (isBrowserMockMode()) {
        const removedIds = new Set(getBrowserMockImages().filter(image => image.isDeleted).map(image => image.id));
        const affectedIds = normalizedIds.filter(id => removedIds.has(id));
        affectedIds.forEach(id => updateBrowserMockImage(id, { isDeleted: false }));
        return {
            ...emptyRemovedLifecycleResult(),
            affectedIds,
            notFoundIds: normalizedIds.filter(id => !removedIds.has(id)),
        };
    }
    return unwrap(commands.restoreRemovedImages(normalizedIds));
};

export const deleteRemovedImageFromDisk = async (id: string): Promise<DeleteRemovedImagesResult> => {
    return deleteRemovedImagesFromDisk([id]);
};

export const deleteRemovedImagesFromDisk = async (ids: string[]): Promise<DeleteRemovedImagesResult> => {
    const normalizedIds = Array.from(new Set(ids.map(normalizePath)));
    if (normalizedIds.length === 0) {
        return {
            clearedIds: [],
            trashedIds: [],
            alreadyMissingIds: [],
            failedIds: [],
            cleanupPendingIds: [],
            thumbnailWarningIds: [],
            notFoundIds: [],
        };
    }

    if (isBrowserMockMode()) {
        const removedIds = new Set(getBrowserMockImages().filter(image => image.isDeleted).map(image => image.id));
        const clearedIds = normalizedIds.filter(id => removedIds.has(id));
        deleteBrowserMockImages(clearedIds);
        return {
            clearedIds,
            trashedIds: clearedIds,
            alreadyMissingIds: [],
            failedIds: [],
            cleanupPendingIds: [],
            thumbnailWarningIds: [],
            notFoundIds: normalizedIds.filter(id => !removedIds.has(id)),
        };
    }

    return unwrap(commands.deleteRemovedImagesFromDisk(normalizedIds));
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
    const rows = await db.select<MetadataJsonRow[]>('SELECT metadata_json FROM scoped_images WHERE id = ?', [normalizedId]);
    if (rows.length === 0) {
        throw new Error(`Updating workflow failed because the asset was not found: ${normalizedId}`);
    }

    let metadata: Partial<ImageMetadata>;
    try {
        metadata = JSON.parse(rows[0].metadata_json || '{}') as Partial<ImageMetadata>;
    } catch (error) {
        console.error('[DB] Failed to parse workflow metadata for image', normalizedId, error);
        return;
    }
    metadata.workflowJson = workflowJson;
    metadata.hasWorkflowHint = true;

    const result = await db.execute(
        'UPDATE images SET metadata_json = ? WHERE id = ? AND id IN (SELECT id FROM scoped_images)',
        [JSON.stringify(metadata), normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating workflow');
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
    const rows = await db.select<MetadataJsonRow[]>('SELECT metadata_json FROM scoped_images WHERE id = ?', [normalizedId]);
    if (rows.length === 0) {
        throw new Error(`Updating workflow hint failed because the asset was not found: ${normalizedId}`);
    }

    let metadata: Partial<ImageMetadata>;
    try {
        metadata = JSON.parse(rows[0].metadata_json || '{}') as Partial<ImageMetadata>;
    } catch (error) {
        console.error('[DB] Failed to parse workflow hint metadata for image', normalizedId, error);
        return;
    }
    metadata.hasWorkflowHint = hasWorkflow;

    const result = await db.execute(
        'UPDATE images SET metadata_json = ? WHERE id = ? AND id IN (SELECT id FROM scoped_images)',
        [JSON.stringify(metadata), normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating workflow hint');
};

export const updateFavorite = async (id: string, isFavorite: boolean) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isFavorite });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    const result = await db.execute(
        'UPDATE images SET is_favorite = ? WHERE id = ? AND id IN (SELECT id FROM scoped_images)',
        [isFavorite ? 1 : 0, normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating favorite');
};

export const updatePinned = async (id: string, isPinned: boolean) => {
    if (isBrowserMockMode()) {
        updateBrowserMockImage(id, { isPinned });
        return;
    }

    const db = await getDb();
    const normalizedId = normalizePath(id);
    const result = await db.execute(
        'UPDATE images SET is_pinned = ? WHERE id = ? AND id IN (SELECT id FROM scoped_images)',
        [isPinned ? 1 : 0, normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Updating pin');
    await clearCollectionThumbnailCacheForImages([normalizedId]);
};

export const checkHiddenContentAvailability = async (): Promise<{
    hasIntermediates: boolean;
    hasGrids: boolean;
    hasInvokeImageAssets: boolean;
}> => {
    if (isBrowserMockMode()) {
        const images = getBrowserMockImages();
        return {
            hasIntermediates: images.some(image => image.isIntermediate || image.metadata.isIntermediate),
            hasGrids: images.some(image => image.metadata.isGrid === true),
            hasInvokeImageAssets: images.some(image => isKnownInvokeImageAsset(image.invokeImageCategory)),
        };
    }

    const db = await getDb();
    // Use indexed STORED generated columns for instant lookup
    const [intermediateCheck, gridCheck, invokeAssetCheck] = await Promise.all([
        db.select<Array<Record<string, number>>>('SELECT 1 FROM scoped_images WHERE invoke_scope_hidden = 0 AND IFNULL(is_intermediate_gen, 0) = 1 LIMIT 1'),
        db.select<Array<Record<string, number>>>('SELECT 1 FROM scoped_images WHERE invoke_scope_hidden = 0 AND IFNULL(is_grid_gen, 0) = 1 LIMIT 1'),
        db.select<Array<Record<string, number>>>('SELECT 1 FROM scoped_images WHERE invoke_scope_hidden = 0 AND is_invoke_asset_gen = 1 LIMIT 1'),
    ]);

    return {
        hasIntermediates: intermediateCheck.length > 0,
        hasGrids: gridCheck.length > 0,
        hasInvokeImageAssets: invokeAssetCheck.length > 0,
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
        while (true) {
            try {
                const result = await db.execute(
                    'UPDATE images SET thumbnail_path = NULL, micro_thumbnail = NULL, thumbnail_source = NULL, thumbnail_version = 0, thumbnail_failure_count = 0, thumbnail_last_error = NULL, thumbnail_last_attempt_at = NULL WHERE id IN (SELECT id FROM scoped_images) AND thumbnail_path IS NOT NULL AND thumbnail_path != ""'
                );
                console.log('[DB] Cleared thumbnail paths:', result.rowsAffected);
                if (result.rowsAffected > 0) {
                    await clearAllCollectionThumbnailCaches();
                }
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
    const result = await db.execute(
        'UPDATE images SET thumbnail_path = ?, thumbnail_source = ?, thumbnail_version = 1, thumbnail_failure_count = 0, thumbnail_last_error = NULL, thumbnail_last_attempt_at = NULL WHERE id = ? AND id IN (SELECT id FROM scoped_images)',
        [normalizedThumb, 'ambit', normalizedId]
    );
    assertMutationMatched(result, normalizedId, 'Thumbnail update');
    await clearCollectionThumbnailCacheForImages([normalizedId]);
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
        const normalizedSource = thumbnailSource || null;

        let retries = 3;
        while (retries > 0) {
            try {
                await db.execute(
                    `UPDATE images
                     SET thumbnail_path = ?,
                         micro_thumbnail = COALESCE(?, micro_thumbnail),
                         thumbnail_source = COALESCE(?, thumbnail_source),
                         thumbnail_version = CASE WHEN COALESCE(?, thumbnail_source) = 'ambit' THEN 1 ELSE thumbnail_version END,
                         thumbnail_failure_count = CASE WHEN COALESCE(?, thumbnail_source) = 'ambit' THEN 0 ELSE thumbnail_failure_count END,
                         thumbnail_last_error = CASE WHEN COALESCE(?, thumbnail_source) = 'ambit' THEN NULL ELSE thumbnail_last_error END,
                         thumbnail_last_attempt_at = CASE WHEN COALESCE(?, thumbnail_source) = 'ambit' THEN NULL ELSE thumbnail_last_attempt_at END
                     WHERE id = ? AND id IN (SELECT id FROM scoped_images)`,
                    [
                        normalizedThumb,
                        microThumbnail || null,
                        normalizedSource,
                        normalizedSource,
                        normalizedSource,
                        normalizedSource,
                        normalizedSource,
                        normalizedId
                    ]
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
    await clearCollectionThumbnailCacheForImages(updates.map(update => update.id));
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
