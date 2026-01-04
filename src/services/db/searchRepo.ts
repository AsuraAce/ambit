import { AIImage } from '../../types';
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
    checkpoints: { name: string; count: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    loras: { name: string; count: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    embeddings: { name: string; count: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    hypernetworks: { name: string; count: number; thumbnailPath?: string; previewUrl?: string; hash?: string }[];
    tools: string[];
}

export const countImages = async (whereClause: string, params: any[]): Promise<number> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";

    // Use "FROM images" but include the JOIN for model filtering consistency
    const query = `
        SELECT count(*) as count 
        FROM images 
        LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
        ${finalWhere.replace(/WHERE /i, 'WHERE images.')}
    `;
    const result = await db.select<any[]>(query, params);
    return result[0]?.count || 0;
};

export const searchImageIds = async (whereClause: string, params: any[]): Promise<string[]> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";
    const query = `
        SELECT images.id 
        FROM images 
        LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
        ${finalWhere.replace(/WHERE /i, 'WHERE images.')}
    `;
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
    prioritizePinned: boolean = false
): Promise<AIImage[]> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";

    const orderBy = prioritizePinned
        ? `ORDER BY images.is_pinned DESC, ${sortField.includes('.') ? sortField : 'images.' + sortField} ${sortOrder}`
        : `ORDER BY ${sortField.includes('.') ? sortField : 'images.' + sortField} ${sortOrder}`;

    const query = `
        SELECT ${IMAGE_FIELDS_LIGHT.replace(/id,/, 'images.id,').replace(/metadata_json,/, 'images.metadata_json,').replace(/thumbnail_path,/, 'images.thumbnail_path,').replace(/timestamp,/, 'images.timestamp,').replace(/file_size,/, 'images.file_size,')}, m.name as resolved_model_name
        FROM images 
        LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
        ${finalWhere.replace(/WHERE /i, 'WHERE images.')} 
        ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
    `;

    const rows = await db.select<any[]>(query, params);
    return rows.map(mapRowToImage);
};

export const getLibraryStats = async (whereClause: string = '', params: any[] = []): Promise<LibraryStats> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";

    try {
        const statsQuery = `
            SELECT 
                count(*) as total, 
                avg(cast(json_extract(images.metadata_json, '$.steps') as integer)) as avg_steps
            FROM images 
            LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
            ${finalWhere.replace(/WHERE /i, 'WHERE images.')}
        `;
        const basicStats = await db.select<any[]>(statsQuery, params);
        const total = basicStats[0]?.total || 0;
        const avgSteps = Math.round(basicStats[0]?.avg_steps || 0);

        const modelQuery = `
            SELECT 
                CASE 
                    WHEN m.name IS NOT NULL THEN m.name
                    WHEN json_extract(images.metadata_json, '$.model') IS NULL OR json_extract(images.metadata_json, '$.model') = '' OR json_extract(images.metadata_json, '$.model') = 'Unknown'
                    THEN COALESCE(json_extract(images.metadata_json, '$.modelHash'), 'Unknown')
                    ELSE json_extract(images.metadata_json, '$.model')
                END as name, 
                count(*) as count
            FROM images
            LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
            ${finalWhere.replace(/WHERE /i, 'WHERE images.')}
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

        const promptQuery = `
            SELECT positive_prompt 
            FROM images_fts
            JOIN images ON images.id = images_fts.id
            LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
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

export type FacetType = 'checkpoints' | 'loras' | 'embeddings' | 'hypernetworks' | 'tools';

export const getFacets = async (
    _whereClause: string = '',
    _params: any[] = [],
    types: FacetType[] = ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'tools']
): Promise<Facets> => {
    const db = await getDb();

    const result: Facets = { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [] };

    try {
        // Read all requested facets from cache in a single query
        const typeList = types.map(t => t === 'checkpoints' ? 'checkpoint' : t).map(t => `'${t}'`).join(',');
        const cacheRows = await db.select<any[]>(`
            SELECT facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url
            FROM facet_cache
            WHERE facet_type IN (${typeList})
            ORDER BY count DESC, resource_name ASC
        `, []);

        // Map cache rows to facet result
        for (const row of cacheRows) {
            const item = {
                name: row.resource_name || 'Unknown',
                hash: row.resource_hash,
                count: row.count || 0,
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
