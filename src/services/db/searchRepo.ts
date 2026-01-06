import { AIImage, FacetType } from '../../types';
import { getDb } from './connection';
import { mapRowToImage, IMAGE_FIELDS_LIGHT } from './repoUtils';
import { WORD_CLOUD_CONFIG } from '../../config/wordCloud';

export interface LibraryStats {
    totalImages: number;
    totalGenerations: number;
    avgSteps: number;
    estSizeMB: string;
    modelStats: { name: string; fullName: string; count: number }[];
    keywordStats: { text: string; value: number }[];
}

export interface Facets {
    checkpoints: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    loras: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    embeddings: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    hypernetworks: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    tools: string[];
}

export const countImages = async (whereClause: string, params: any[], collectionId?: string, loraName?: string): Promise<number> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (is_intermediate_gen IS NULL OR is_intermediate_gen != 1)";

    // For collection-filtered counts, use INNER JOIN with collection_images for O(collection_size) instead of O(all_images)
    if (collectionId) {
        const query = `
            SELECT count(*) as count 
            FROM collection_images ci
            INNER JOIN images ON images.id = ci.image_id
            ${finalWhere.replace('WHERE', 'WHERE ci.collection_id = ? AND')}
        `;
        const result = await db.select<any[]>(query, [collectionId, ...params]);
        return result[0]?.count || 0;
    }

    // For single-lora-filtered counts, use INNER JOIN with image_loras for O(lora_usage_count) instead of O(all_images)
    if (loraName) {
        const query = `
            SELECT count(*) as count 
            FROM image_loras il
            INNER JOIN images ON images.id = il.image_id
            ${finalWhere.replace('WHERE', 'WHERE il.lora_name = ? AND')}
        `;
        const result = await db.select<any[]>(query, [loraName, ...params]);
        return result[0]?.count || 0;
    }

    // Simple count using denormalized columns - no JOIN needed
    const query = `SELECT count(*) as count FROM images ${finalWhere}`;

    const result = await db.select<any[]>(query, params);
    return result[0]?.count || 0;
};

/**
 * Fast global count - uses simpler query without JOINs for speed.
 * Result can be cached at the query layer.
 */
export const countGlobalImages = async (): Promise<number> => {
    const db = await getDb();
    const result = await db.select<any[]>(
        `SELECT count(*) as count FROM images WHERE is_deleted = 0`
    );
    return result[0]?.count || 0;
};

export const searchImageIds = async (whereClause: string, params: any[]): Promise<string[]> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (is_intermediate_gen IS NULL OR is_intermediate_gen != 1)";

    // Simple query using denormalized columns - no JOIN needed
    const query = `SELECT id FROM images ${finalWhere}`;

    const rows = await db.select<{ id: string }[]>(query, params);
    return rows.map(r => r.id);
};

export const searchImages = async (
    whereClause: string,
    params: any[],
    limit: number,
    offset: number,
    sortField: string = 'timestamp',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    prioritizePinned: boolean = false,
    collectionId?: string,
    loraName?: string
): Promise<AIImage[]> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (is_intermediate_gen IS NULL OR is_intermediate_gen != 1)";

    const orderBy = prioritizePinned
        ? `ORDER BY images.is_pinned DESC, images.${sortField} ${sortOrder}`
        : `ORDER BY images.${sortField} ${sortOrder}`;

    // For collection-filtered searches, use INNER JOIN with collection_images 
    // This is O(collection_size) instead of O(all_images)
    if (collectionId) {
        const query = `
            SELECT ${IMAGE_FIELDS_LIGHT}, resolved_model_name
            FROM collection_images ci
            INNER JOIN images ON images.id = ci.image_id
            ${finalWhere.replace('WHERE', 'WHERE ci.collection_id = ? AND')}
            ${orderBy}
            LIMIT ${limit} OFFSET ${offset}
        `;
        const rows = await db.select<any[]>(query, [collectionId, ...params]);
        return rows.map(mapRowToImage);
    }

    // For single-lora-filtered searches, use INNER JOIN with image_loras
    // This is O(lora_usage_count) instead of O(all_images)
    if (loraName) {
        const query = `
            SELECT ${IMAGE_FIELDS_LIGHT}, resolved_model_name
            FROM image_loras il
            INNER JOIN images ON images.id = il.image_id
            ${finalWhere.replace('WHERE', 'WHERE il.lora_name = ? AND')}
            ${orderBy}
            LIMIT ${limit} OFFSET ${offset}
        `;
        const rows = await db.select<any[]>(query, [loraName, ...params]);
        return rows.map(mapRowToImage);
    }

    // Use denormalized resolved_model_name column instead of LEFT JOIN with models
    // This eliminates the expensive JSON->hash->JOIN operation
    const query = `
        SELECT ${IMAGE_FIELDS_LIGHT}, resolved_model_name
        FROM images 
        ${finalWhere} 
        ${orderBy.replace(/images\./g, '')}
        LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = await db.select<any[]>(query, params);
    return rows.map(mapRowToImage);
};

export const getLibraryStats = async (whereClause: string = '', params: any[] = []): Promise<LibraryStats> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (is_intermediate_gen IS NULL OR is_intermediate_gen != 1)";

    try {
        // Use direct query without JOIN - all needed columns are now denormalized
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

        // Use denormalized resolved_model_name column for model stats
        const modelQuery = `
            SELECT 
                COALESCE(resolved_model_name, model_name, 'Unknown') as name, 
                count(*) as count
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

        // Get Keyword Stats
        const keywordStats = await getKeywordStats(finalWhere, params);

        return {
            totalImages: total,
            totalGenerations: total,
            avgSteps: avgSteps,
            estSizeMB: ((total * 2.4)).toFixed(1),
            modelStats,
            keywordStats
        };
    } catch (e) {
        console.error('[DB] Failed to get library stats', e);
        return {
            totalImages: 0,
            totalGenerations: 0,
            avgSteps: 0,
            estSizeMB: '0',
            modelStats: [],
            keywordStats: []
        };
    }
};

export const getKeywordStats = async (whereClause: string = '', params: any[] = []): Promise<{ text: string; value: number }[]> => {
    const db = await getDb();

    try {
        const stopWords = new Set(WORD_CLOUD_CONFIG.STOP_WORDS);

        // Fix ambiguity for JOIN: replace and ensure 'id' becomes 'images.id' unless already prefixed
        const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0";
        const safeWhere = finalWhere.replace(/(\bimages\.)?\b(id|is_deleted|metadata_json|path|width|height|file_size|timestamp|thumbnail_path|is_favorite|is_pinned|is_missing|user_masked|group_id|board_id|notes|original_metadata_json)\b/g, (match, prefix, col) => prefix ? match : `images.${col}`);

        // Simple query using denormalized columns - no model JOIN needed
        const promptQuery = `
            SELECT positive_prompt 
            FROM images_fts
            JOIN images ON images.id = images_fts.id
            ${safeWhere}
            LIMIT ${WORD_CLOUD_CONFIG.ANALYSIS_LIMIT}
        `;

        const rows = await db.select<any[]>(promptQuery, params);

        const counts: Record<string, number> = {};
        rows.forEach(r => {
            const tokens = (r.positive_prompt || '')
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/);

            tokens.forEach((token: string) => {
                if (token.length > 3 && !stopWords.has(token) && !/^\d+$/.test(token)) {
                    counts[token] = (counts[token] || 0) + 1;
                }
            });
        });

        return Object.entries(counts)
            .map(([text, value]) => ({ text, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 40);

    } catch (e) {
        console.error('[DB] Failed to get keyword stats', e);
        return [];
    }
};

/**
 * Fetches facets from the pre-built cache.
 * 
 * TODO: _whereClause and _params are placeholders for future support of
 * "filtered facet counts" (e.g., "how many LoRAs in images from this week?").
 * The current implementation reads from `facet_cache` which represents global counts.
 */
export const getFacets = async (
    _whereClause: string = '',
    _params: any[] = [],
    types: FacetType[] = ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'tools']
): Promise<Facets> => {
    const db = await getDb();

    const result: Facets = { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [] };

    try {
        // Map frontend type names to cache type names and create parameterized query
        const cacheTypes = types.map(t => t === 'checkpoints' ? 'checkpoint' : t);
        const placeholders = cacheTypes.map(() => '?').join(',');

        const cacheRows = await db.select<any[]>(`
            SELECT facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url, last_used_at, created_at
            FROM facet_cache
            WHERE facet_type IN (${placeholders})
            ORDER BY count DESC, resource_name ASC
        `, cacheTypes);

        // Map cache rows to facet result
        for (const row of cacheRows) {
            const item = {
                name: row.resource_name || 'Unknown',
                hash: row.resource_hash,
                count: row.count || 0,
                lastUsedAt: row.last_used_at,
                createdAt: row.created_at,
                thumbnailPath: row.thumbnail_path,
                previewUrl: row.preview_url
            };

            switch (row.facet_type) {
                case 'checkpoint':
                    result.checkpoints.push(item);
                    break;
                case 'loras':
                    result.loras.push(item);
                    break;
                case 'embeddings':
                    result.embeddings.push(item);
                    break;
                case 'hypernetworks':
                    result.hypernetworks.push(item);
                    break;
                case 'tools':
                    result.tools.push(row.resource_name);
                    break;
            }
        }

        return result;

    } catch (e) {
        console.error('[DB] Failed to get facets from cache', e);
        return { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [] };
    }
};
