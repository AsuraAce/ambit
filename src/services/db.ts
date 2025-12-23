import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { AIImage } from '../types';

let db: Database | null = null;
let dbInitialized = false;

// Simple Mutex to prevent concurrent write transactions
class Mutex {
    private mutex = Promise.resolve();
    lock(): Promise<() => void> {
        return new Promise(resolve => {
            this.mutex = this.mutex.then(() => {
                return new Promise<void>(unlock => {
                    resolve(unlock);
                });
            });
        });
    }

    async dispatch<T>(fn: (() => T) | (() => PromiseLike<T>)): Promise<T> {
        const unlock = await this.lock();
        try {
            return await Promise.resolve(fn());
        } finally {
            unlock();
        }
    }
}

const dbMutex = new Mutex();

export const getDb = async () => {
    if (!db) {
        db = await Database.load('sqlite:images.db');
    }

    if (!dbInitialized && db) {
        dbInitialized = true;
        // Enable WAL mode and busy timeout for better concurrency
        try {
            await db.execute('PRAGMA journal_mode=WAL');
            await db.execute('PRAGMA synchronous=NORMAL');
            await db.execute('PRAGMA busy_timeout=30000'); // Higher timeout for massive batches
        } catch (e) {
            console.error('[DB] Failed to set PRAGMAs', e);
        }
    }
    return db;
};

export const normalizeAllPaths = async () => {
    await dbMutex.dispatch(async () => {
        const db = await getDb();

        // Fast check: Are there any paths with backslashes?
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

export const clearLibrary = async () => {
    await dbMutex.dispatch(async () => {
        const db = await getDb();
        console.log('[DB] Clearing library...');
        await db.execute('DELETE FROM images');
        // Optional: VACUUM to reclaim space, though slow on large DBs. 
        // For 200k rows, maybe skip or do async? Let's skip for responsiveness.
        // await db.execute('VACUUM'); 
        console.log('[DB] Library cleared.');
    });
};

export const insertImage = async (image: AIImage) => {
    // Wrap in mutex to prevent collisions with batch inserts
    await dbMutex.dispatch(async () => {
        const db = await getDb();
        // Normalize path to forward slashes for consistency
        const id = image.id.replace(/\\/g, '/').replace(/\/+/g, '/');
        await db.execute(
            `INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
             ON CONFLICT(id) DO UPDATE SET 
                path=excluded.path,
                timestamp=excluded.timestamp, 
                file_size=excluded.file_size,
                metadata_json=excluded.metadata_json,
                thumbnail_path=excluded.thumbnail_path,
                is_favorite=excluded.is_favorite,
                group_id=excluded.group_id,
                board_id=excluded.board_id
            `,
            [
                id,
                id,
                image.width,
                image.height,
                image.fileSize,
                image.timestamp,
                JSON.stringify(image.metadata),
                image.thumbnailUrl,
                image.isFavorite ? 1 : 0,
                image.isPinned ? 1 : 0,
                image.isDeleted ? 1 : 0,
                image.isMissing ? 1 : 0,
                image.userMasked === true ? 1 : (image.userMasked === false ? 0 : null),
                image.groupId,
                image.boardId,
                image.notes,
                image.originalMetadata ? JSON.stringify(image.originalMetadata) : null
            ]
        );
    });
};



export const insertImagesBatch = async (images: AIImage[]) => {
    if (images.length === 0) return;

    // Wrap in mutex to prevent collisions with other DB ops
    await dbMutex.dispatch(async () => {
        // Map to Rust ImageRecord format
        // Note: Rust side expects keys in camelCase as per serde rename
        const records = images.map(img => ({
            id: img.id.replace(/\\/g, '/').replace(/\/+/g, '/'),
            path: img.id.replace(/\\/g, '/').replace(/\/+/g, '/'), // Path same as ID
            width: img.width,
            height: img.height,
            fileSize: img.fileSize || 0,
            timestamp: img.timestamp,
            metadataJson: JSON.stringify(img.metadata),
            thumbnailPath: img.thumbnailUrl || '',
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

        // Group into chunks of 5000 to avoid hitting IPC limits (though rare for this size)
        // or SQLite variable limits if we were doing raw SQL. 
        // passing vector to Rust is efficient.
        const CHUNK_SIZE = 5000;
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            try {
                // Call atomic Rust command
                await invoke('save_images_batch', { images: chunk });
            } catch (e) {
                console.error('[DB] Rust batch insert failed', e);
                throw e;
            }
        }
    });

    // AUTO-MIGRATION: Fix any '0' values in user_masked to NULL to restore "Auto" behavior for synced images
    // This is a safety check after batch insert to ensure we don't accidentally strict-unmask
    const db = await getDb();
    await db.execute('UPDATE images SET user_masked = NULL WHERE user_masked = 0');
};

export const isImageNew = async (id: string): Promise<boolean> => {
    const db = await getDb();
    const result = await db.select<any[]>(`SELECT count(*) as count FROM images WHERE id = ?`, [id]);
    return (result[0]?.count || 0) === 0;
};

export const getAllImages = async (limit?: number, offset: number = 0): Promise<AIImage[]> => {
    const db = await getDb();
    const query = limit
        ? `SELECT * FROM images WHERE is_deleted = 0 ORDER BY is_pinned DESC, timestamp DESC LIMIT ${limit} OFFSET ${offset}`
        : 'SELECT * FROM images WHERE is_deleted = 0 ORDER BY is_pinned DESC, timestamp DESC';

    const rows = await db.select<any[]>(query);

    return rows.map(mapRowToImage);
};

// --- New SQL-Based Search & Filtering ---

export const countImages = async (whereClause: string, params: any[]): Promise<number> => {
    const db = await getDb();
    // Ensure we don't count deleted unless explicitly asked (usually handled in whereClause generation)
    // But for safety, if whereClause is empty, we default to is_deleted=0
    const finalWhere = whereClause ? whereClause : 'WHERE is_deleted = 0';

    const query = `SELECT count(*) as count FROM images ${finalWhere}`;
    const result = await db.select<any[]>(query, params);
    return result[0]?.count || 0;
};

export const searchImages = async (
    whereClause: string,
    params: any[],
    limit: number,
    offset: number,
    sortField: string = 'timestamp',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
): Promise<AIImage[]> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : 'WHERE is_deleted = 0';

    const query = `
        SELECT * FROM images 
        ${finalWhere} 
        ORDER BY is_pinned DESC, ${sortField} ${sortOrder} 
        LIMIT ${limit} OFFSET ${offset}
    `;

    // console.log('[DB Search]', query, params);
    const rows = await db.select<any[]>(query, params);
    return rows.map(mapRowToImage);
};

// Helper to keep mapping consistent
function mapRowToImage(row: any): AIImage {
    return {
        id: row.id,
        url: convertFileSrc(row.path),
        thumbnailUrl: row.thumbnail_path,
        filename: row.path.split(/[\\/]/).pop() || row.path, // Re-derive filename for safety
        fileSize: row.file_size,
        timestamp: row.timestamp,
        width: row.width,
        height: row.height,
        isFavorite: !!row.is_favorite,
        isPinned: !!row.is_pinned,
        isDeleted: !!row.is_deleted,
        isMissing: !!row.is_missing,
        userMasked: row.user_masked === 1 ? true : (row.user_masked === 0 ? false : undefined),
        groupId: row.group_id,
        boardId: row.board_id,
        notes: row.notes,
        metadata: JSON.parse(row.metadata_json || '{}'),
        originalMetadata: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined
    };
}

// --- Stats & Facets ---

export interface LibraryStats {
    totalImages: number;
    totalGenerations: number;
    avgSteps: number;
    estSizeMB: string;
    modelStats: { name: string; fullName: string; count: number }[];
}

export const getLibraryStats = async (whereClause: string = '', params: any[] = []): Promise<LibraryStats> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : 'WHERE is_deleted = 0';

    try {
        // 1. Basic aggregated stats
        // We use json_extract to get steps. Cast to integer.
        const statsQuery = `
            SELECT 
                count(*) as total, 
                avg(cast(json_extract(metadata_json, '$.steps') as integer)) as avg_steps
            FROM images 
            ${finalWhere}
        `;
        const basicStats = await db.select<any[]>(statsQuery, params);
        const total = basicStats[0]?.total || 0;
        const avgSteps = Math.round(basicStats[0]?.avg_steps || 0);

        // 2. Model Stats
        // Extract model name from normalized metadata
        const modelQuery = `
            SELECT json_extract(metadata_json, '$.model') as name, count(*) as count
            FROM images
            ${finalWhere}
            GROUP BY name
            ORDER BY count DESC
            LIMIT 20
        `;
        const modelRows = await db.select<any[]>(modelQuery, params);

        const modelStats = modelRows.map(r => ({
            name: (r.name || 'Unknown').split(' ')[0],
            fullName: r.name || 'Unknown',
            count: r.count
        }));

        return {
            totalImages: total,
            totalGenerations: total,
            avgSteps: avgSteps,
            estSizeMB: ((total * 2.4)).toFixed(1), // approx 2.4mb per image
            modelStats
        };
    } catch (e) {
        console.error('[DB] Failed to get library stats', e);
        return {
            totalImages: 0,
            totalGenerations: 0,
            avgSteps: 0,
            estSizeMB: '0',
            modelStats: []
        };
    }
};

export const getFacets = async (whereClause: string = '', params: any[] = []) => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : 'WHERE is_deleted = 0';

    try {
        // 1. Models (Re-use query or slightly different if we want all?)
        const models = await db.select<any[]>(`
            SELECT DISTINCT json_extract(metadata_json, '$.model') as name 
            FROM images ${finalWhere} 
            ORDER BY name ASC
        `, params);

        // 2. LoRAs
        // Fetch raw arrays and process in JS as recursive CTEs or json_each might be tricky/slow to setup without known extension state
        // Optimizing: Only select rows where loras exist
        // Note: SQLite 'json_extract' returns the JSON string of the array or null
        const lorasRows = await db.select<any[]>(`
            SELECT json_extract(metadata_json, '$.loras') as loras 
            FROM images 
            ${finalWhere}
            AND json_extract(metadata_json, '$.loras') IS NOT NULL
        `, params);

        const loraCounts: Record<string, number> = {};
        lorasRows.forEach(row => {
            try {
                // If it's a string representation of array
                const arr = typeof row.loras === 'string' ? JSON.parse(row.loras) : row.loras;
                if (Array.isArray(arr)) {
                    arr.forEach((l: string) => {
                        // Normalize
                        let name = l.replace(/\.(safetensors|pt|ckpt)$/i, '');
                        name = name.replace(/\s+\(-?\d+(\.\d+)?\)$/, '').trim();
                        if (name) loraCounts[name] = (loraCounts[name] || 0) + 1;
                    });
                }
            } catch (e) { }
        });

        const loraStats = Object.entries(loraCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        // 3. Tools
        const tools = await db.select<any[]>(`
            SELECT DISTINCT IFNULL(json_extract(metadata_json, '$.tool'), 'Unknown') as name 
            FROM images ${finalWhere} 
            ORDER BY name ASC
        `, params);

        return {
            models: models.map(m => m.name).filter(Boolean),
            loras: loraStats,
            tools: tools.map(t => t.name).filter(Boolean)
        };

    } catch (e) {
        console.error('[DB] Failed to get facets', e);
        return { models: [], loras: [], tools: [] };
    }
};

export const getCollectionThumbnail = async (imageIds: string[]): Promise<string | undefined> => {
    if (!imageIds || imageIds.length === 0) return undefined;
    const db = await getDb();

    try {
        // We ensure IDs are normalized just in case
        // Logic: SQLite limits variable counts (default 999 or 32k depending on build, safest < 990).
        // We chunk the IDs and query in batches.
        const BATCH_SIZE = 900;
        const normalizedIds = imageIds.map(id => id.replace(/\\/g, '/').replace(/\/+/g, '/'));

        let candidates: Array<{ path: string, timestamp: number, is_pinned: number }> = [];

        for (let i = 0; i < normalizedIds.length; i += BATCH_SIZE) {
            const batch = normalizedIds.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '?').join(',');

            // We select top 1 from EACH batch. 
            // Note: Ideally we want global top 1. But querying partials is okay as long as we pick best of candidates.
            const query = `
                SELECT thumbnail_path as path, timestamp, is_pinned
                FROM images 
                WHERE (id IN (${placeholders}) OR path IN (${placeholders}))
                AND is_deleted = 0 
                ORDER BY is_pinned DESC, timestamp DESC 
                LIMIT 1
            `;

            // We pass batch twice (once for id, once for path)
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

        // Sort candidates to find the global winner
        candidates.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned; // Pinned first
            return b.timestamp - a.timestamp; // Newest first
        });

        return candidates[0].path;

    } catch (e) {
        console.error('[DB] Fail collection thumb', e);
        return undefined;
    }
};


// Helper to hydrate collections with their count and latest thumbnail (Optimized Single Query)
export const hydrateCollections = async (): Promise<Record<string, { count: number, thumbnail: string }>> => {
    const db = await getDb();
    try {
        // Strategy: Use Window Functions to find the "Best" Thumbnail per Board
        // Priority: 1. Pinned (is_pinned DESC), 2. Newest (timestamp DESC)

        // 1. Get Counts (Simple Group By) - Most robust way to get accurate counts
        const countRows = await db.select<any[]>(`
            SELECT board_id, COUNT(*) as count 
            FROM images 
            WHERE board_id IS NOT NULL AND is_deleted = 0 
            GROUP BY board_id
        `);

        // 2. Get Best Thumbnail (CTE + Window Function)
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

        // 3. Merge Results
        const map: Record<string, { count: number, thumbnail: string }> = {};

        // Initialize with counts
        countRows.forEach(row => {
            if (row.board_id) {
                map[row.board_id] = { count: row.count, thumbnail: '' };
            }
        });

        // Add thumbnails
        thumbRows.forEach(row => {
            if (row.board_id && map[row.board_id]) {
                map[row.board_id].thumbnail = row.thumbnail_path;
            } else if (row.board_id) {
                // Should overlap, but just in case
                map[row.board_id] = { count: 0, thumbnail: row.thumbnail_path };
            }
        });

        return map;
    } catch (e) {
        console.error('[DB] Failed to hydrate collections', e);
        return {};
    }
};
export const toggleImagePin = async (id: string, isPinned: boolean) => {
    const db = await getDb();
    const normalizedId = id.replace(/\\/g, '/');
    // Ensure the column exists and use integer 1/0
    await db.execute('UPDATE images SET is_pinned = $1 WHERE id = $2', [isPinned ? 1 : 0, normalizedId]);
};

export const toggleImageFavorite = async (id: string, isFavorite: boolean) => {
    const db = await getDb();
    const normalizedId = id.replace(/\\/g, '/');
    await db.execute('UPDATE images SET is_favorite = $1 WHERE id = $2', [isFavorite ? 1 : 0, normalizedId]);
};

export const toggleImageMask = async (id: string, userMasked: boolean | null) => {
    const db = await getDb();
    const normalizedId = id.replace(/\\/g, '/');
    let value: number | null = null;
    if (userMasked === true) value = 1;
    if (userMasked === false) value = 0;

    // SQLite can store NULL for integer columns.
    await db.execute('UPDATE images SET user_masked = $1 WHERE id = $2', [value, normalizedId]);
};

// Add a migration check to ensure is_pinned exists and is initialized
export const migrateSchema = async () => {
    const db = await getDb();
    try {
        // Try to select the column to see if it exists
        await db.select('SELECT is_pinned FROM images LIMIT 1');
    } catch (e) {
        console.log('[DB] Adding is_pinned column...');
        try {
            await db.execute('ALTER TABLE images ADD COLUMN is_pinned INTEGER DEFAULT 0');
            await db.execute('CREATE INDEX idx_images_pinned ON images(is_pinned)');
        } catch (inner) {
            console.error('[DB] Migration failed', inner);
        }
    }

    // Also ensure all NULLs are 0 for correct sorting
    await db.execute('UPDATE images SET is_pinned = 0 WHERE is_pinned IS NULL');
};
