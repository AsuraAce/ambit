import { convertFileSrc } from '@tauri-apps/api/core';
import { getDb } from './connection';
import { normalizePath } from '../../utils/pathUtils';
import { Collection, FilterState } from '../../types';
import { dbMutex } from './connection';
import { isBrowserMockMode } from '../runtime';
import {
    addBrowserMockImagesToCollection,
    deleteBrowserMockCollection,
    getBrowserMockCollections,
    getBrowserMockImages,
    removeBrowserMockImagesFromCollection,
    upsertBrowserMockCollection,
} from '../browserMockData';

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
    updated_at?: number;
}

export const ensureCollectionSchema = async () => {
    if (isBrowserMockMode()) return;

    return dbMutex.dispatch(async () => {
        const db = await getDb();
        try {
            // Check if updated_at column exists
            const columns = await db.select<{ name: string }[]>('PRAGMA table_info(collections)');
            const hasUpdatedAt = columns.some(c => c.name === 'updated_at');

            if (!hasUpdatedAt) {
                console.log('[DB] Migrating collections table: adding updated_at column');
                try {
                    await db.execute('ALTER TABLE collections ADD COLUMN updated_at INTEGER');
                    // Backfill updated_at with created_at for existing records
                    await db.execute('UPDATE collections SET updated_at = created_at WHERE updated_at IS NULL');
                } catch (e: any) {
                    // Ignore duplicate column error if it raced despite mutex (unlikely but safe)
                    if (e?.toString().includes('duplicate column')) {
                        console.warn('[DB] Migration raced, column already exists (handled)');
                    } else {
                        throw e;
                    }
                }
            }
        } catch (e) {
            console.error('[DB] Failed to ensure collection schema', e);
        }
    });
};

export const upsertCollection = async (collection: Partial<Collection> & { id: string, name: string }) => {
    if (isBrowserMockMode()) {
        upsertBrowserMockCollection(collection);
        return;
    }

    const { dbMutex } = await import('./connection');
    return dbMutex.dispatch(async () => {
        const db = await getDb();
        const now = Date.now();

        try {
            await db.execute(
                `INSERT INTO collections (id, name, color, is_archived, is_pinned, created_at, filter_state, manual_exclusions, custom_thumbnail, source, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                color = excluded.color,
                is_archived = excluded.is_archived,
                is_pinned = excluded.is_pinned,
                created_at = excluded.created_at,
                filter_state = excluded.filter_state,
                manual_exclusions = excluded.manual_exclusions,
                custom_thumbnail = excluded.custom_thumbnail,
                source = excluded.source,
                updated_at = excluded.updated_at`,
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
                    collection.source || 'ambit',
                    collection.updatedAt || now
                ]
            );
        } catch (e) {
            console.error(`[DB] Failed to upsert collection ${collection.id}`, e);
            throw e;
        }
    });
};

export const deleteCollectionFromDb = async (id: string) => {
    if (isBrowserMockMode()) {
        deleteBrowserMockCollection(id);
        return;
    }

    const db = await getDb();
    await db.execute('DELETE FROM collections WHERE id = ?', [id]);
};

export const addImagesToCollection = async (collectionId: string, imageIds: string[]) => {
    if (isBrowserMockMode()) {
        addBrowserMockImagesToCollection(collectionId, imageIds);
        return;
    }

    const { dbMutex } = await import('./connection');
    return dbMutex.dispatch(async () => {
        const db = await getDb();
        const now = Date.now();
        for (const imgId of imageIds) {
            await db.execute(
                'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
                [collectionId, normalizePath(imgId)]
            );
        }
        // Update collection timestamp
        await db.execute('UPDATE collections SET updated_at = ? WHERE id = ?', [now, collectionId]);
    });
};

export const removeImagesFromCollection = async (collectionId: string, imageIds: string[]) => {
    if (isBrowserMockMode()) {
        removeBrowserMockImagesFromCollection(collectionId, imageIds);
        return;
    }

    const db = await getDb();
    const placeholders = imageIds.map(() => '?').join(',');
    await db.execute(
        `DELETE FROM collection_images WHERE collection_id = ? AND image_id IN (${placeholders})`,
        [collectionId, ...imageIds.map(normalizePath)]
    );
    // Update collection timestamp
    await db.execute('UPDATE collections SET updated_at = ? WHERE id = ?', [Date.now(), collectionId]);
};

export const getAllCollectionsWithStats = async (): Promise<Collection[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockCollections();
    }

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
        SELECT c.id as collection_id, (
            SELECT i.thumbnail_path 
            FROM collection_images ci
            INNER JOIN images i ON ci.image_id = i.id
            WHERE ci.collection_id = c.id AND i.is_deleted = 0
            ORDER BY i.is_pinned DESC, i.timestamp DESC
            LIMIT 1
        ) as thumbnail_path
        FROM collections c
        WHERE thumbnail_path IS NOT NULL
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
            updatedAt: c.updated_at || c.created_at, // Fallback to created_at if updated_at is null
            count: countMap.get(c.id) || 0,
            imageIds: [] as string[],
            thumbnail: rawThumb ? (rawThumb.startsWith('http') ? rawThumb : convertFileSrc(normalizePath(rawThumb))) : undefined,
            customThumbnail: c.custom_thumbnail,
            filters: c.filter_state ? JSON.parse(c.filter_state) : undefined,
            manualExclusions: c.manual_exclusions ? JSON.parse(c.manual_exclusions) : undefined,
            source: c.source
        } as Collection;
    });

    // 2. Smart Collections: Return with count 0 initially for fast load
    // Smart counts are calculated lazily via refreshSmartCollectionCounts()
    const { buildSqlWhereClause } = await import('../../utils/sqlHelpers');

    const finalCollections = await Promise.all(mappedCollections.map(async (c) => {
        if (!c.filters) return c;

        // For smart collections, set count to 0 initially (will be updated lazily)
        // Only fetch thumbnail if needed
        let smartThumb = c.thumbnail;

        if (!c.customThumbnail) {
            try {
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
                    controlNets: [],
                    ipAdapters: [],
                    samplers: [],
                    generationTypes: [],
                    searchQuery: ''
                };
                const { where, params } = buildSqlWhereClause(statsFilters, false, 'blur', [], [c as Collection]);
                const thumbUrl = await getSmartCollectionThumbnail(where, params);
                if (thumbUrl) smartThumb = thumbUrl;
            } catch (e) {
                // Keep existing thumb
            }
        }

        return {
            ...c,
            count: 0, // Lazy count - will be populated by refreshSmartCollectionCounts
            thumbnail: smartThumb
        };
    }));

    return finalCollections;
};

/**
 * Lazily calculate smart collection counts without blocking the main collection load.
 * Returns a map of collectionId -> count for smart collections only.
 */
export const getSmartCollectionCounts = async (smartCollections: Collection[]): Promise<Record<string, number>> => {
    if (isBrowserMockMode()) {
        const collections = getBrowserMockCollections();
        return Object.fromEntries(
            smartCollections.map((collection) => [
                collection.id,
                collections.find((item) => item.id === collection.id)?.count ?? 0
            ])
        );
    }

    if (smartCollections.length === 0) return {};

    const db = await getDb();
    const { buildSqlWhereClause } = await import('../../utils/sqlHelpers');

    const smartCounts: Record<string, number> = {};

    try {
        const countQueries = smartCollections.map(c => {
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
                controlNets: [],
                ipAdapters: [],
                samplers: [],
                generationTypes: [],
                searchQuery: ''
            };
            const { where, params } = buildSqlWhereClause(statsFilters, false, 'blur', [], [c as Collection]);
            return { id: c.id, where, params };
        });

        // SQLite UNION ALL approach for batched counts - using denormalized columns, no JOIN needed
        const unionSql = countQueries.map(q =>
            `SELECT ? as id, (SELECT COUNT(*) FROM images ${q.where}) as count`
        ).join(' UNION ALL ');
        const unionParams = countQueries.flatMap(q => [q.id, ...q.params]);

        const res = await db.select<{ id: string, count: number }[]>(unionSql, unionParams);
        res.forEach(row => { smartCounts[row.id] = row.count; });
    } catch (e) {
        console.error("[DB] Failed batched smart counts", e);
    }

    return smartCounts;
};

export const getCollectionThumbnail = async (imageIds: string[]): Promise<string | undefined> => {
    if (isBrowserMockMode()) {
        const imageIdSet = new Set(imageIds);
        return getBrowserMockImages().find(image => imageIdSet.has(image.id))?.thumbnailUrl;
    }

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
    if (isBrowserMockMode()) {
        return getBrowserMockCollections().find(collection => collection.filters)?.thumbnail;
    }

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
    if (isBrowserMockMode()) {
        return getBrowserMockCollections()
            .filter(collection => collection.imageIds.includes(imageId))
            .map(collection => collection.id);
    }

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
    if (isBrowserMockMode()) {
        return getBrowserMockCollections().find(collection => collection.id === collectionId)?.imageIds ?? [];
    }

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
    if (isBrowserMockMode()) return;

    const { dbMutex } = await import('./connection');
    await dbMutex.dispatch(async () => {
        const db = await getDb();
        console.log('[DB] Purging InvokeAI collections...');
        await db.execute("DELETE FROM collections WHERE source = 'invoke'");
        console.log('[DB] InvokeAI collections purged.');
    });
};
