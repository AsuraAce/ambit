import { convertFileSrc } from '@tauri-apps/api/core';
import { getDb } from './connection';
import { normalizePath } from '../../utils/pathUtils';
import { Collection, FilterState } from '../../types';

export interface DbCollection {
    id: string;
    name: string;
    color?: string;
    is_archived: number;
    is_pinned: number;
    created_at: number;
    filter_state?: string;
    manual_exclusions?: string;
    custom_thumbnail?: string;
    source: 'ambit' | 'invoke';
}

export const upsertCollection = async (collection: Partial<Collection> & { id: string, name: string }) => {
    const { dbMutex } = await import('./connection');
    return dbMutex.dispatch(async () => {
        const db = await getDb();
        const now = Date.now();

        try {
            await db.execute(
                `INSERT INTO collections (id, name, color, is_archived, is_pinned, created_at, filter_state, manual_exclusions, custom_thumbnail, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                color = excluded.color,
                is_archived = excluded.is_archived,
                is_pinned = excluded.is_pinned,
                created_at = excluded.created_at,
                filter_state = excluded.filter_state,
                manual_exclusions = excluded.manual_exclusions,
                custom_thumbnail = excluded.custom_thumbnail,
                source = excluded.source`,
                [
                    collection.id,
                    collection.name,
                    collection.color || null,
                    collection.isArchived ? 1 : 0,
                    collection.isPinned ? 1 : 0,
                    collection.createdAt || now,
                    collection.filters ? JSON.stringify(collection.filters) : null,
                    collection.manualExclusions ? JSON.stringify(collection.manualExclusions) : null,
                    collection.customThumbnail || null,
                    collection.source || 'ambit'
                ]
            );
        } catch (e) {
            console.error(`[DB] Failed to upsert collection ${collection.id}`, e);
            throw e;
        }
    });
};

export const deleteCollectionFromDb = async (id: string) => {
    const db = await getDb();
    await db.execute('DELETE FROM collections WHERE id = ?', [id]);
};

export const addImagesToCollection = async (collectionId: string, imageIds: string[]) => {
    const { dbMutex } = await import('./connection');
    return dbMutex.dispatch(async () => {
        const db = await getDb();
        for (const imgId of imageIds) {
            await db.execute(
                'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
                [collectionId, normalizePath(imgId)]
            );
        }
    });
};

export const removeImagesFromCollection = async (collectionId: string, imageIds: string[]) => {
    const db = await getDb();
    const placeholders = imageIds.map(() => '?').join(',');
    await db.execute(
        `DELETE FROM collection_images WHERE collection_id = ? AND image_id IN (${placeholders})`,
        [collectionId, ...imageIds.map(normalizePath)]
    );
};

export const getAllCollectionsWithStats = async (): Promise<Collection[]> => {
    const db = await getDb();

    // Get all collections
    const collections = await db.select<DbCollection[]>('SELECT * FROM collections');

    // Get counts from junction table
    const counts = await db.select<{ collection_id: string, count: number }[]>(
        'SELECT collection_id, COUNT(*) as count FROM collection_images GROUP BY collection_id'
    );
    const countMap = new Map(counts.map(c => [c.collection_id, c.count]));

    // Get thumbnails (optimized: pick most recent pinned or most recent)
    // We only join with images for the ranking subset
    const thumbnails = await db.select<{ collection_id: string, thumbnail_path: string }[]>(`
        WITH Ranked AS (
            SELECT ci.collection_id, i.thumbnail_path,
                   ROW_NUMBER() OVER (PARTITION BY ci.collection_id ORDER BY i.is_pinned DESC, i.timestamp DESC) as rn
            FROM collection_images ci
            INNER JOIN images i ON ci.image_id = i.id
            WHERE i.is_deleted = 0
        )
        SELECT collection_id, thumbnail_path FROM Ranked WHERE rn = 1
    `);
    const thumbMap = new Map(thumbnails.map(t => [t.collection_id, t.thumbnail_path]));

    const mappedCollections = collections.map(c => {
        const rawThumb = c.custom_thumbnail || thumbMap.get(c.id);
        return {
            id: c.id,
            name: c.name,
            color: c.color,
            isArchived: !!c.is_archived,
            isPinned: !!c.is_pinned,
            createdAt: c.created_at,
            count: countMap.get(c.id) || 0,
            imageIds: [] as string[],
            thumbnail: rawThumb ? (rawThumb.startsWith('http') ? rawThumb : convertFileSrc(normalizePath(rawThumb))) : undefined,
            customThumbnail: c.custom_thumbnail,
            filters: c.filter_state ? JSON.parse(c.filter_state) : undefined,
            manualExclusions: c.manual_exclusions ? JSON.parse(c.manual_exclusions) : undefined,
            source: c.source
        } as Collection;
    });

    // 2. Process Smart Collections: Calculate Dynamic Counts & Thumbnails
    const { buildSqlWhereClause } = await import('../../utils/sqlHelpers');

    // Separate regular and smart collections
    const smartCols = mappedCollections.filter(c => !!c.filters);
    const regularCols = mappedCollections.filter(c => !c.filters);

    // 1. Batch Count Queries for Smart Collections
    let smartCounts: Record<string, number> = {};
    if (smartCols.length > 0) {
        try {
            const countQueries = smartCols.map(c => {
                const statsFilters: FilterState = {
                    collectionId: c.id,
                    dateRange: 'all',
                    favoritesOnly: false,
                    pinnedOnly: false,
                    models: [],
                    tools: [],
                    loras: [],
                    embeddings: [],
                    hypernetworks: [],
                    searchQuery: ''
                };
                const { where, params } = buildSqlWhereClause(statsFilters, false, 'blur', [], [c as Collection]);
                return { id: c.id, where, params };
            });

            // SQLite UNION ALL approach for batched counts
            const unionSql = countQueries.map(q =>
                `SELECT ? as id, (SELECT COUNT(*) FROM images LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash ${q.where.replace(/WHERE /i, 'WHERE images.')}) as count`
            ).join(' UNION ALL ');
            const unionParams = countQueries.flatMap(q => [q.id, ...q.params]);

            const res = await db.select<{ id: string, count: number }[]>(unionSql, unionParams);
            res.forEach(row => { smartCounts[row.id] = row.count; });
        } catch (e) {
            console.error("[DB] Failed batched smart counts", e);
        }
    }

    // 2. Fetch Thumbnails (Still parallel but isolated from counts)
    const finalCollections = await Promise.all(mappedCollections.map(async (c) => {
        if (!c.filters) return c;

        try {
            const count = smartCounts[c.id] || 0;
            let smartThumb = c.thumbnail;

            if (!c.customThumbnail) {
                // We still fetch thumbnails individually for now as UNION with LIMIT is tricky
                // but we skip if it's already a valid external thumb (rare for smart)
                const statsFilters: FilterState = {
                    collectionId: c.id,
                    dateRange: 'all',
                    favoritesOnly: false,
                    pinnedOnly: false,
                    models: [],
                    tools: [],
                    loras: [],
                    embeddings: [],
                    hypernetworks: [],
                    searchQuery: ''
                };
                const { where, params } = buildSqlWhereClause(statsFilters, false, 'blur', [], [c as Collection]);
                const thumbUrl = await getSmartCollectionThumbnail(where, params);
                if (thumbUrl) smartThumb = thumbUrl;
            }

            return {
                ...c,
                count,
                thumbnail: smartThumb
            };
        } catch (e) {
            return c;
        }
    }));

    return finalCollections;
};

export const getCollectionThumbnail = async (imageIds: string[]): Promise<string | undefined> => {
    if (!imageIds || imageIds.length === 0) return undefined;
    const db = await getDb();

    try {
        const BATCH_SIZE = 900;
        const normalizedIds = imageIds.map(normalizePath);

        let candidates: Array<{ path: string, timestamp: number, is_pinned: number }> = [];

        for (let i = 0; i < normalizedIds.length; i += BATCH_SIZE) {
            const batch = normalizedIds.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '?').join(',');

            const query = `
                SELECT thumbnail_path as path, timestamp, is_pinned
                FROM images 
                WHERE (id IN (${placeholders}) OR path IN (${placeholders}))
                AND is_deleted = 0 
                ORDER BY is_pinned DESC, timestamp DESC 
                LIMIT 1
            `;

            const res = await db.select<any[]>(query, [...batch, ...batch]);
            if (res && res.length > 0) {
                candidates.push({
                    path: res[0].path,
                    timestamp: res[0].timestamp || 0,
                    is_pinned: res[0].is_pinned ? 1 : 0
                });
            }
        }

        if (candidates.length === 0) return undefined;

        candidates.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
            return b.timestamp - a.timestamp;
        });

        const rawPath = candidates[0].path;
        if (!rawPath) return undefined;
        return (rawPath.startsWith('http') || rawPath.startsWith('data:') || rawPath.startsWith('blob:'))
            ? rawPath
            : convertFileSrc(normalizePath(rawPath));

    } catch (e) {
        console.error('[DB] Fail collection thumb', e);
        return undefined;
    }
};

export const getSmartCollectionThumbnail = async (whereClause: string, params: any[]): Promise<string | undefined> => {
    const db = await getDb();
    try {
        const query = `
            SELECT images.thumbnail_path, images.timestamp, images.is_pinned
            FROM images
            LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
            ${whereClause.replace(/WHERE /i, 'WHERE images.')}
            ORDER BY images.is_pinned DESC, images.timestamp DESC
            LIMIT 1
        `;
        const res = await db.select<any[]>(query, params);
        if (res && res.length > 0) {
            const rawPath = res[0].thumbnail_path;
            if (!rawPath) return undefined;
            return (rawPath.startsWith('http') || rawPath.startsWith('data:') || rawPath.startsWith('blob:'))
                ? rawPath
                : convertFileSrc(normalizePath(rawPath));
        }
        return undefined;
    } catch (e) {
        console.error('[DB] Fail smart thumb', e);
        return undefined;
    }
};

/**
 * Targeted fetch for collection memberships of a single image.
 * Used for Metadata Sidebar to avoid loading thousands of IDs.
 */
export const getCollectionsForImage = async (imageId: string): Promise<string[]> => {
    const db = await getDb();
    try {
        const res = await db.select<{ collection_id: string }[]>(
            'SELECT collection_id FROM collection_images WHERE image_id = ?',
            [imageId]
        );
        return res.map(r => r.collection_id);
    } catch (e) {
        console.error('[DB] Failed to get collections for image', e);
        return [];
    }
};

/**
 * Get all image IDs for a specific collection.
 * Used for Export and other batch operations.
 */
export const getCollectionImageIds = async (collectionId: string): Promise<string[]> => {
    const db = await getDb();
    try {
        const res = await db.select<{ image_id: string }[]>(
            'SELECT image_id FROM collection_images WHERE collection_id = ?',
            [collectionId]
        );
        return res.map(r => r.image_id);
    } catch (e) {
        console.error('[DB] Failed to get collection image IDs', e);
        return [];
    }
};

// Legacy shim to satisfy existing imports
export const hydrateCollections = async () => {
    const collections = await getAllCollectionsWithStats();
    const map: Record<string, { count: number, thumbnail: string }> = {};
    collections.forEach(c => {
        map[c.id] = { count: c.count || 0, thumbnail: c.thumbnail || '' };
    });
    return map;
};

export const purgeInvokeCollections = async () => {
    const { dbMutex } = await import('./connection');
    await dbMutex.dispatch(async () => {
        const db = await getDb();
        console.log('[DB] Purging InvokeAI collections...');
        await db.execute("DELETE FROM collections WHERE source = 'invoke'");
        console.log('[DB] InvokeAI collections purged.');
    });
};
