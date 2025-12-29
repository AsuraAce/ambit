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
    const db = await getDb();
    const now = Date.now();

    await db.execute(
        `INSERT INTO collections (id, name, color, is_archived, is_pinned, created_at, filter_state, manual_exclusions, custom_thumbnail, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            is_archived = excluded.is_archived,
            is_pinned = excluded.is_pinned,
            created_at = excluded.created_at,
            filter_state = excluded.filter_state,
            manual_exclusions = excluded.manual_exclusions,
            custom_thumbnail = excluded.custom_thumbnail`,
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
};

export const deleteCollectionFromDb = async (id: string) => {
    const db = await getDb();
    await db.execute('DELETE FROM collections WHERE id = ?', [id]);
};

export const addImagesToCollection = async (collectionId: string, imageIds: string[]) => {
    const db = await getDb();
    for (const imgId of imageIds) {
        await db.execute(
            'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
            [collectionId, normalizePath(imgId)]
        );
    }
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
    const thumbnails = await db.select<{ collection_id: string, thumbnail_path: string }[]>(`
        WITH Ranked AS (
            SELECT ci.collection_id, i.thumbnail_path,
                   ROW_NUMBER() OVER (PARTITION BY ci.collection_id ORDER BY i.is_pinned DESC, i.timestamp DESC) as rn
            FROM collection_images ci
            JOIN images i ON ci.image_id = i.id
            WHERE i.is_deleted = 0
        )
        SELECT collection_id, thumbnail_path FROM Ranked WHERE rn = 1
    `);
    const thumbMap = new Map(thumbnails.map(t => [t.collection_id, t.thumbnail_path]));

    // Get image IDs for each collection (for legacy compatibility and small collections)
    const imageIds = await db.select<{ collection_id: string, image_id: string }[]>(
        'SELECT collection_id, image_id FROM collection_images'
    );
    const idMap = new Map<string, string[]>();
    imageIds.forEach(row => {
        const list = idMap.get(row.collection_id) || [];
        list.push(row.image_id);
        idMap.set(row.collection_id, list);
    });

    return collections.map(c => {
        const rawThumb = c.custom_thumbnail || thumbMap.get(c.id);
        return {
            id: c.id,
            name: c.name,
            color: c.color,
            isArchived: !!c.is_archived,
            isPinned: !!c.is_pinned,
            createdAt: c.created_at,
            count: countMap.get(c.id) || 0,
            imageIds: idMap.get(c.id) || [],
            thumbnail: rawThumb ? (rawThumb.startsWith('http') ? rawThumb : convertFileSrc(normalizePath(rawThumb))) : undefined,
            customThumbnail: c.custom_thumbnail,
            filters: c.filter_state ? JSON.parse(c.filter_state) : undefined,
            manualExclusions: c.manual_exclusions ? JSON.parse(c.manual_exclusions) : undefined,
            source: c.source
        };
    });
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

// Legacy shim to satisfy existing imports
export const hydrateCollections = async () => {
    const collections = await getAllCollectionsWithStats();
    const map: Record<string, { count: number, thumbnail: string }> = {};
    collections.forEach(c => {
        map[c.id] = { count: c.count || 0, thumbnail: c.thumbnail || '' };
    });
    return map;
};
