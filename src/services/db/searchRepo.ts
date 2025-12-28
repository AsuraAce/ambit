import { AIImage } from '../../types';
import { getDb } from './connection';
import { mapRowToImage, IMAGE_FIELDS_LIGHT } from './repoUtils';

export interface LibraryStats {
    totalImages: number;
    totalGenerations: number;
    avgSteps: number;
    estSizeMB: string;
    modelStats: { name: string; fullName: string; count: number }[];
}

export const countImages = async (whereClause: string, params: any[]): Promise<number> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";

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
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";

    const query = `
        SELECT ${IMAGE_FIELDS_LIGHT} FROM images 
        ${finalWhere} 
        ORDER BY is_pinned DESC, ${sortField} ${sortOrder} 
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
                avg(cast(json_extract(metadata_json, '$.steps') as integer)) as avg_steps
            FROM images 
            ${finalWhere}
        `;
        const basicStats = await db.select<any[]>(statsQuery, params);
        const total = basicStats[0]?.total || 0;
        const avgSteps = Math.round(basicStats[0]?.avg_steps || 0);

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
            estSizeMB: ((total * 2.4)).toFixed(1),
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
    const finalWhere = whereClause ? whereClause : "WHERE is_deleted = 0 AND (json_extract(metadata_json, '$.isIntermediate') IS NULL OR json_extract(metadata_json, '$.isIntermediate') != 1)";

    try {
        const models = await db.select<any[]>(`
            SELECT DISTINCT json_extract(metadata_json, '$.model') as name 
            FROM images ${finalWhere} 
            ORDER BY name ASC
        `, params);

        const lorasRows = await db.select<any[]>(`
            SELECT json_extract(metadata_json, '$.loras') as loras 
            FROM images 
            ${finalWhere}
            AND json_extract(metadata_json, '$.loras') IS NOT NULL
        `, params);

        const loraCounts: Record<string, number> = {};
        lorasRows.forEach(row => {
            try {
                const arr = typeof row.loras === 'string' ? JSON.parse(row.loras) : row.loras;
                if (Array.isArray(arr)) {
                    arr.forEach((l: string) => {
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
