import { convertFileSrc } from '@tauri-apps/api/core';
import { getDb } from './connection';
import { normalizePath } from '../../utils/pathUtils';

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

export const hydrateCollections = async (): Promise<Record<string, { count: number, thumbnail: string }>> => {
    const db = await getDb();
    try {
        const countRows = await db.select<any[]>(`
            SELECT board_id, COUNT(*) as count 
            FROM images 
            WHERE board_id IS NOT NULL AND is_deleted = 0 
            GROUP BY board_id
        `);

        const thumbRows = await db.select<any[]>(`
            WITH RankedImages AS (
                SELECT 
                    board_id, 
                    thumbnail_path, 
                    ROW_NUMBER() OVER (
                        PARTITION BY board_id 
                        ORDER BY is_pinned DESC, timestamp DESC
                    ) as rn
                FROM images 
                WHERE board_id IS NOT NULL AND is_deleted = 0
            )
            SELECT board_id, thumbnail_path
            FROM RankedImages
            WHERE rn = 1
        `);

        const map: Record<string, { count: number, thumbnail: string }> = {};

        countRows.forEach(row => {
            if (row.board_id) {
                map[row.board_id] = { count: row.count, thumbnail: '' };
            }
        });

        thumbRows.forEach(row => {
            if (row.board_id && map[row.board_id]) {
                const raw = row.thumbnail_path;
                map[row.board_id].thumbnail = (raw && !raw.startsWith('http')) ? convertFileSrc(normalizePath(raw)) : raw;
            } else if (row.board_id) {
                const raw = row.thumbnail_path;
                map[row.board_id] = { count: 0, thumbnail: (raw && !raw.startsWith('http')) ? convertFileSrc(normalizePath(raw)) : raw };
            }
        });

        return map;
    } catch (e) {
        console.error('[DB] Failed to hydrate collections', e);
        return {};
    }
};
