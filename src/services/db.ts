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
                image.thumbnailUrl?.replace(/^https?:\/\/tauri\.localhost\/_up_\\\//i, '').replace(/\\/g, '/').replace(/\/+/g, '/'),
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
            thumbnailPath: (img.thumbnailUrl || '').replace(/^https?:\/\/tauri\.localhost\/_up_\\\//i, '').replace(/\\/g, '/').replace(/\/+/g, '/'),
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

export const getImagesByIds = async (ids: string[]): Promise<AIImage[]> => {
    if (ids.length === 0) return [];
    const db = await getDb();

    // Chunking to avoid parameter limits (SQLite limit default is often 999)
    const CHUNK_SIZE = 900;
    let allImages: AIImage[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT * FROM images WHERE id IN (${placeholders})`;
        const rows = await db.select<any[]>(query, chunk);
        allImages = [...allImages, ...rows.map(mapRowToImage)];
    }

    return allImages;
};

// Helper to keep mapping consistent
function mapRowToImage(row: any): AIImage {
    const normalizedPath = row.path.replace(/\\/g, '/');
    const thumbPath = row.thumbnail_path ? row.thumbnail_path.replace(/\\/g, '/') : null;

    return {
        id: row.id,
        url: convertFileSrc(normalizedPath),
        thumbnailUrl: thumbPath ? (thumbPath.startsWith('http') || thumbPath.startsWith('data:') || thumbPath.startsWith('blob:') ? thumbPath : convertFileSrc(thumbPath)) : convertFileSrc(normalizedPath),
        filename: normalizedPath.split('/').pop() || row.path,
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

    // MIGRATION: Fix legacy protocol-prefixed thumbnail paths
    try {
        // Find thumbnails starting with the asset protocol and strip it
        // Note: Tauri 2.x uses http://tauri.localhost/_up_/ for asset conversion usually
        await db.execute(`
            UPDATE images 
            SET thumbnail_path = REPLACE(REPLACE(thumbnail_path, 'http://tauri.localhost/_up_/', ''), 'https://tauri.localhost/_up_/', '')
            WHERE thumbnail_path LIKE 'http%://tauri.localhost/_up_/%'
        `);
    } catch (e) {
        console.warn('[DB] Migration failed for legacy thumbnail paths', e);
    }
};
export const verifyLibraryIntegrity = async (onProgress?: (processed: number, total: number) => void): Promise<{ scanned: number, missingIds: string[], sampleMissingPaths: string[] }> => {
    const db = await getDb();

    // 1. Get all paths that are currently NOT marked as missing and NOT deleted
    const allImages = await db.select<any[]>('SELECT id, path FROM images WHERE is_missing = 0 AND is_deleted = 0');
    const total = allImages.length;

    if (total === 0) return { scanned: 0, missingIds: [], sampleMissingPaths: [] };

    // 2. Process in chunks to avoid IPC limits
    const CHUNK_SIZE = 1000;
    let missingIds: string[] = [];
    let sampleMissingPaths: string[] = [];
    let processed = 0;

    for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = allImages.slice(i, i + CHUNK_SIZE);
        const paths = chunk.map(img => img.path);

        try {
            // Returns path strings that are missing
            const missingPaths = await invoke<string[]>('verify_image_paths', { paths });

            // Map back to IDs
            const missingChunk = chunk.filter(img => missingPaths.includes(img.path));
            const missingChunkIds = missingChunk.map(img => img.id);

            missingIds = [...missingIds, ...missingChunkIds];

            // Keep first 10 for sample
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
    // Update in batches
    for (let i = 0; i < ids.length; i += 500) {
        const batch = ids.slice(i, i + 500);
        const placeholders = batch.map(() => '?').join(',');
        await db.execute(`UPDATE images SET is_missing = 1 WHERE id IN (${placeholders})`, batch);
    }

    return ids.length;
};
// Permanent Delete (Single)
export const deleteImage = async (id: string) => {
    const db = await getDb();
    await db.execute('DELETE FROM images WHERE id = $1', [id]);
};

// Toggle Soft Delete (Batch or Single)
export const markAsDeleted = async (ids: string[], isDeleted: boolean) => {
    const db = await getDb();
    const placeholders = ids.map(() => '?').join(',');
    await db.execute(`UPDATE images SET is_deleted = ? WHERE id IN (${placeholders})`, [isDeleted ? 1 : 0, ...ids]);
};

// --- Maintenance Queries ---

export const getMaintenanceCounts = async () => {
    const db = await getDb();
    const result = await db.select<any[]>(`
        SELECT 
            (SELECT COUNT(*) FROM images WHERE is_deleted = 1) as trash_count,
            (SELECT COUNT(*) FROM images WHERE (metadata_json IS NULL OR metadata_json LIKE '%"positivePrompt":""%' OR metadata_json LIKE '%"positivePrompt":null%') AND is_deleted = 0) as untagged_count,
            (SELECT COUNT(*) FROM images WHERE is_missing = 1 AND is_deleted = 0) as missing_count,
            (SELECT COUNT(*) FROM images WHERE (path = thumbnail_path OR thumbnail_path IS NULL OR thumbnail_path = '') AND path NOT LIKE 'blob:%' AND path NOT LIKE 'data:%' AND is_deleted = 0) as unoptimized_count
    `);

    return {
        trash: result[0]?.trash_count || 0,
        untagged: result[0]?.untagged_count || 0,
        missing: result[0]?.missing_count || 0,
        unoptimized: result[0]?.unoptimized_count || 0
    };
};

export const getDeletedImages = async (): Promise<AIImage[]> => {
    const db = await getDb();
    const rows = await db.select<any[]>('SELECT * FROM images WHERE is_deleted = 1 ORDER BY timestamp DESC');
    return rows.map(mapRowToImage);
};

export const getUntaggedImages = async (): Promise<AIImage[]> => {
    const db = await getDb();
    const rows = await db.select<any[]>(`
        SELECT * FROM images 
        WHERE (metadata_json IS NULL OR metadata_json LIKE '%"positivePrompt":""%' OR metadata_json LIKE '%"positivePrompt":null%') 
        AND is_deleted = 0 
        ORDER BY timestamp DESC
    `);
    return rows.map(mapRowToImage);
};

export const getUnoptimizedImages = async (whereClause: string = '', params: any[] = []): Promise<AIImage[]> => {
    const db = await getDb();

    let query = `
        SELECT * FROM images 
        WHERE (path = thumbnail_path OR thumbnail_path IS NULL OR thumbnail_path = '')
        AND path NOT LIKE 'blob:%' 
        AND path NOT LIKE 'data:%'
        AND is_deleted = 0
    `;

    if (whereClause) {
        // We append the provided where clause. 
        // Important: activeSqlWhere usually starts with "WHERE" or contains "AND".
        // In this project it typically starts with "WHERE".
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
 * Finds potential duplicates by looking for images with identical file size and dimensions.
 * This is a highly efficient broad-phase scan that avoids fetching the entire DB.
 */
export const getDuplicateCandidates = async (whereClause: string = '', params: any[] = []): Promise<AIImage[]> => {
    const db = await getDb();

    // We aim to find groups of (file_size, width, height) that appear > 1 time.
    // We respect the current filters (whereClause) but default to is_deleted=0 and group_id IS NULL 
    // to avoid scanning trash or already stacked images.

    const baseWhere = whereClause ? whereClause : 'WHERE is_deleted = 0 AND group_id IS NULL';

    // Inner query finds the (size, w, h) triplets that are duplicated
    const query = `
        SELECT i.* 
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
