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

        // Fix ambiguity for JOIN: replace and ensure 'id' becomes 'images.id'
        const finalWhere = whereClause ? whereClause : "WHERE images.is_deleted = 0";
        const safeWhere = finalWhere.replace(/\b(id|is_deleted|metadata_json|path|width|height|file_size|timestamp|thumbnail_path|is_favorite|is_pinned|is_missing|user_masked|group_id|board_id|notes|original_metadata_json)\b/g, (match) => `images.${match}`);

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

export const getFacets = async (whereClause: string = '', params: any[] = []): Promise<Facets> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";
    const imagesWhere = finalWhere.replace(/WHERE /i, 'WHERE images.');

    try {
        // 1. Optimized Checkpoints Facet
        const checkpointStatsRows = await db.select<any[]>(`
            WITH counts AS (
                SELECT 
                    json_extract(metadata_json, '$.modelHash') as hash,
                    count(*) as count
                FROM images 
                ${finalWhere}
                GROUP BY hash
            )
            SELECT 
                m.name,
                m.hash,
                IFNULL(c.count, 0) as count,
                m.thumbnail_path,
                m.preview_url
            FROM models m
            LEFT JOIN counts c ON m.hash = c.hash
            WHERE m.resource_type = 'checkpoint'
            ORDER BY count DESC, m.name ASC
        `, params);

        // 2. Optimized LoRAs Facet
        const loraStatsRows = await db.select<any[]>(`
            WITH lora_names AS (
                SELECT 
                    CASE 
                        WHEN instr(j.value, ' (') > 0 THEN substr(j.value, 1, instr(j.value, ' (') - 1)
                        WHEN instr(j.value, ':') > 0 THEN substr(j.value, 1, instr(j.value, ':') - 1)
                        ELSE j.value 
                    END as clean_name
                FROM images, json_each(metadata_json, '$.loras') j
                ${finalWhere}
            ),
            counts AS (
                SELECT clean_name, count(*) as count
                FROM lora_names
                GROUP BY clean_name
            )
            SELECT 
                m.name,
                m.hash,
                IFNULL(c.count, 0) as count,
                m.thumbnail_path,
                m.preview_url
            FROM models m
            LEFT JOIN counts c ON m.name = c.clean_name
            WHERE m.resource_type = 'loras'
            ORDER BY count DESC, m.name ASC
        `, params);

        // 3. Optimized Embeddings Facet
        const embeddedStatsRows = await db.select<any[]>(`
            WITH counts AS (
                SELECT j.value as resource_name, count(*) as count
                FROM images, json_each(metadata_json, '$.embeddings') j
                ${finalWhere}
                GROUP BY resource_name
            )
            SELECT 
                m.name,
                m.hash,
                IFNULL(c.count, 0) as count,
                m.thumbnail_path,
                m.preview_url
            FROM models m
            LEFT JOIN counts c ON m.name = c.resource_name
            WHERE m.resource_type = 'embeddings'
            ORDER BY count DESC, m.name ASC
        `, params);

        // 4. Optimized Hypernetworks Facet
        const hnStatsRows = await db.select<any[]>(`
            WITH counts AS (
                SELECT j.value as resource_name, count(*) as count
                FROM images, json_each(metadata_json, '$.hypernetworks') j
                ${finalWhere}
                GROUP BY resource_name
            )
            SELECT 
                m.name,
                m.hash,
                IFNULL(c.count, 0) as count,
                m.thumbnail_path,
                m.preview_url
            FROM models m
            LEFT JOIN counts c ON m.name = c.resource_name
            WHERE m.resource_type = 'hypernetworks'
            ORDER BY count DESC, m.name ASC
        `, params);

        const tools = await db.select<any[]>(`
            SELECT DISTINCT IFNULL(json_extract(metadata_json, '$.tool'), 'Unknown') as tool_name 
            FROM images 
            ${imagesWhere} 
            ORDER BY tool_name ASC
            `, params);

        return {
            checkpoints: checkpointStatsRows.map(r => ({
                name: r.name || 'Unknown',
                hash: r.hash,
                count: r.count,
                thumbnailPath: r.thumbnail_path,
                previewUrl: r.preview_url
            })),
            loras: loraStatsRows.map(r => ({
                name: r.name ? r.name.replace(/\.(safetensors|pt|ckpt)$/i, '').trim() : 'Unknown',
                hash: r.hash,
                count: r.count,
                thumbnailPath: r.thumbnail_path,
                previewUrl: r.preview_url
            })),
            embeddings: embeddedStatsRows.map(r => ({
                name: r.name, hash: r.hash, count: r.count, thumbnailPath: r.thumbnail_path, previewUrl: r.preview_url
            })),
            hypernetworks: hnStatsRows.map(r => ({
                name: r.name, hash: r.hash, count: r.count, thumbnailPath: r.thumbnail_path, previewUrl: r.preview_url
            })),
            tools: tools.map(t => t.tool_name).filter(Boolean)
        };

    } catch (e) {
        console.error('[DB] Failed to get facets', e);
        return { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [] };
    }
};
