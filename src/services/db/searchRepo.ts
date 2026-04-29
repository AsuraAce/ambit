import { AIImage, Collection, FacetType, FilterState } from '../../types';
import { getDb } from './connection';
import { mapRowToImage, getImageFieldsLight } from './repoUtils';
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
    checkpoints: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string; isManual?: number; hasSidecar?: number; isUserOverride?: number }[];
    loras: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string; isManual?: number; hasSidecar?: number; isUserOverride?: number }[];
    embeddings: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string; isManual?: number; hasSidecar?: number; isUserOverride?: number }[];
    hypernetworks: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string; isManual?: number; hasSidecar?: number; isUserOverride?: number }[];
    controlNets: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string; isManual?: number; hasSidecar?: number; isUserOverride?: number }[];
    ipAdapters: { name: string; count: number; lastUsedAt?: number; createdAt?: number; thumbnailPath?: string; previewUrl?: string; hash?: string; isManual?: number; hasSidecar?: number; isUserOverride?: number }[];
    tools: string[];
}

export interface ValidFacetNames {
    checkpoints: string[];
    loras: string[];
    embeddings: string[];
    hypernetworks: string[];
    tools: string[];
    controlNets: string[];
    ipAdapters: string[];
}

const DEFAULT_VISIBLE_WHERE = "WHERE is_deleted = 0 AND IFNULL(is_intermediate_gen, 0) = 0 AND IFNULL(is_grid_gen, 0) = 0";

const hasPrivacyFilter = (whereClause: string) => /\bprivacy_hidden\s*=\s*0\b/.test(whereClause);
const hasFastSortVisibilityPrefix = (whereClause: string) =>
    whereClause.includes('is_deleted = 0') &&
    whereClause.includes('IFNULL(is_intermediate_gen, 0) = 0') &&
    whereClause.includes('IFNULL(is_grid_gen, 0) = 0');

const selectImageSortIndex = (whereClause: string, sortField: string): string | null => {
    if (!hasFastSortVisibilityPrefix(whereClause)) return null;

    if (sortField === 'timestamp') {
        return hasPrivacyFilter(whereClause) ? 'idx_images_privacy_fast_sort_v1' : 'idx_images_fast_sort_v3';
    }
    if (sortField === 'path') return 'idx_images_name_sort_v1';
    if (sortField === 'file_size') return 'idx_images_size_sort_v1';

    return null;
};

export const countImages = async (whereClause: string, params: any[], collectionId?: string, loraName?: string): Promise<number> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : DEFAULT_VISIBLE_WHERE;

    // For combined Collection + LoRA counts
    if (collectionId && loraName) {
        const query = `
            SELECT count(*) as count 
            FROM collection_images ci
            JOIN image_loras il ON il.image_id = ci.image_id
            JOIN images ON images.id = ci.image_id
            ${finalWhere.replace('WHERE', 'WHERE ci.collection_id = ? AND il.lora_name = ? AND')}
        `;
        const result = await db.select<any[]>(query, [collectionId, loraName, ...params]);
        return result[0]?.count || 0;
    }

    // For collection-filtered counts, use CROSS JOIN with collection_images to force scan order
    if (collectionId) {
        const query = `
            SELECT count(*) as count 
            FROM collection_images ci
            CROSS JOIN images ON images.id = ci.image_id
            ${finalWhere.replace('WHERE', 'WHERE ci.collection_id = ? AND')}
        `;
        const result = await db.select<any[]>(query, [collectionId, ...params]);
        return result[0]?.count || 0;
    }

    // For single-lora-filtered counts, use CROSS JOIN to force scan order
    if (loraName) {
        const query = `
            SELECT count(*) as count 
            FROM image_loras il
            CROSS JOIN images ON images.id = il.image_id
            ${finalWhere.replace('WHERE', 'WHERE il.lora_name = ? AND')}
        `;
        const result = await db.select<any[]>(query, [loraName, ...params]);
        return result[0]?.count || 0;
    }

    // Simple count using denormalized columns - no JOIN needed
    const fromClause = hasPrivacyFilter(finalWhere) && hasFastSortVisibilityPrefix(finalWhere)
        ? 'FROM images INDEXED BY idx_images_privacy_fast_sort_v1'
        : 'FROM images';
    const query = `SELECT count(*) as count ${fromClause} ${finalWhere}`;

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
    const finalWhere = whereClause ? whereClause : DEFAULT_VISIBLE_WHERE;

    // Simple query using denormalized columns - no JOIN needed
    const query = `SELECT id FROM images ${finalWhere}`;

    const rows = await db.select<{ id: string }[]>(query, params);
    return rows.map(r => r.id);
};

export const searchImages = async (
    whereClause: string,
    params: any[],
    limit: number,
    // offset removed
    sortField: string = 'timestamp',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    prioritizePinned: boolean = false,
    collectionId?: string,
    loraName?: string,
    cursor?: { val: number | string; id: string; isPinned?: number }
): Promise<AIImage[]> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : DEFAULT_VISIBLE_WHERE;

    const orderBy = prioritizePinned
        ? `ORDER BY images.is_pinned DESC, images.${sortField} ${sortOrder}, images.id ${sortOrder === 'DESC' ? 'DESC' : 'ASC'}` // Strict tie-breaker
        : `ORDER BY images.${sortField} ${sortOrder}, images.id ${sortOrder === 'DESC' ? 'DESC' : 'ASC'}`;

    // Helper to build cursor condition
    const buildCursorWhere = () => {
        if (!cursor) return '';

        const op = sortOrder === 'DESC' ? '<' : '>';
        const sortValParam = typeof cursor.val === 'string' ? `'${cursor.val}'` : cursor.val;

        if (prioritizePinned) {
            // Complex case: Pinned (1) -> Unpinned (0). 
            // Sort: is_pinned DESC, sortField [dir], id [dir]

            // If we are currently paging through pinned items (isPinned=1)
            // AND the next item could be pinned OR unpinned.

            // Tuple comparison only works if all directions match. 
            // Here is_pinned is DESC. If sortOrder is ASC, we can't use simple tuple.
            // We'll use a verbose logical expansion for safety.

            // Cursor Logic:
            // (is_pinned < cursor.pin) -- IMPOSSIBLE since max is 1, but conceptually valid for DESC
            // OR (is_pinned = cursor.pin AND sortField [op] cursor.val)
            // OR (is_pinned = cursor.pin AND sortField = cursor.val AND id [op] cursor.id)

            const pinOp = '<='; // Pinned (1) comes before Unpinned (0) so DESC means 1 > 0. Next page is <= current.
            // Actually, for DESC sort: "Row A comes after Cursor B" means Row A < Cursor B.
            // So is_pinned can confirm to < cursor.isPinned

            const pinnedVal = cursor.isPinned ?? 0;

            return `AND (
                images.is_pinned < ${pinnedVal}
                OR (images.is_pinned = ${pinnedVal} AND images.${sortField} ${op} ${sortValParam})
                OR (images.is_pinned = ${pinnedVal} AND images.${sortField} = ${sortValParam} AND images.id ${op} '${cursor.id}')
            )`;
        }

        // Simple case: (sortField, id) < (val, id)
        // Ensure we handle string vs number types correctly for sql injection safety if raw string
        return `AND (images.${sortField}, images.id) ${op} (${sortValParam}, '${cursor.id}')`;
    };

    const cursorWhere = buildCursorWhere();

    // For combined Collection + LoRA searches
    if (collectionId && loraName) {
        const query = `
            SELECT ${getImageFieldsLight()}
            FROM collection_images ci
            JOIN image_loras il ON il.image_id = ci.image_id
            JOIN images ON images.id = ci.image_id
            ${finalWhere.replace('WHERE', 'WHERE ci.collection_id = ? AND il.lora_name = ? AND')}
            ${cursorWhere}
            ${orderBy}
            LIMIT ${limit}
        `;
        const rows = await db.select<any[]>(query, [collectionId, loraName, ...params]);
        return rows.map(mapRowToImage);
    }

    // For collection-filtered searches
    if (collectionId) {
        const query = `
            SELECT ${getImageFieldsLight()}
            FROM collection_images ci
            CROSS JOIN images ON images.id = ci.image_id
            ${finalWhere.replace('WHERE', 'WHERE ci.collection_id = ? AND')}
            ${cursorWhere}
            ${orderBy}
            LIMIT ${limit}
        `;
        const rows = await db.select<any[]>(query, [collectionId, ...params]);
        return rows.map(mapRowToImage);
    }

    // For single-lora-filtered searches, use CROSS JOIN with image_loras
    // Same logic: force scanning the junction table first.
    if (loraName) {
        const query = `
            SELECT ${getImageFieldsLight()}
            FROM image_loras il
            CROSS JOIN images ON images.id = il.image_id
            ${finalWhere.replace('WHERE', 'WHERE il.lora_name = ? AND')}
            ${cursorWhere}
            ${orderBy}
            LIMIT ${limit}
        `;
        const rows = await db.select<any[]>(query, [loraName, ...params]);
        return rows.map(mapRowToImage);
    }

    // Use denormalized resolved_model_name column
    // The replace of images. prefix in orderBy is tricky if we added images.id. 
    // If not joining, we don't need prefixes, but consistent use is better.
    // If table alias is implied, we might need to strip prefixes if query fails.
    // But 'images' table name is valid in simple select.

    // Safer to leave prefixes if FROM images is used.

    const sortIndex = selectImageSortIndex(finalWhere, sortField);
    const fromClause = sortIndex ? `FROM images INDEXED BY ${sortIndex}` : 'FROM images';
    const query = `
        SELECT ${getImageFieldsLight()}
        ${fromClause}
        ${finalWhere} 
        ${cursorWhere}
        ${orderBy} 
        LIMIT ${limit}
    `;

    console.time('[DB] searchImages');
    const rows = await db.select<any[]>(query, params);
    console.timeEnd('[DB] searchImages');
    
    return rows.map(mapRowToImage);
};

let globalStatsCache: LibraryStats | null = null;

export const clearLibraryStatsCache = () => {
    globalStatsCache = null;
};

export const getLibraryStats = async (whereClause: string = '', params: any[] = [], collectionId?: string, loraName?: string): Promise<LibraryStats> => {
    // Return cached result instantly for unfiltered dashboard loads
    if (!whereClause && !collectionId && !loraName && globalStatsCache) {
        return globalStatsCache;
    }

    const db = await getDb();
    const finalWhere = whereClause ? whereClause : DEFAULT_VISIBLE_WHERE;

    try {
        const statsQuery = `
            SELECT 
                count(*) as total

            FROM images 
            ${collectionId ? `JOIN collection_images ci ON ci.image_id = images.id AND ci.collection_id = '${collectionId}'` : ''}
            ${loraName ? `JOIN image_loras il ON il.image_id = images.id AND il.lora_name = '${loraName}'` : ''}
            ${finalWhere}
        `;

        console.time('[DB] getLibraryStats: basicStats');
        const basicStats = await db.select<any[]>(statsQuery, params);
        console.timeEnd('[DB] getLibraryStats: basicStats');
        
        const total = basicStats[0]?.total || 0;
        const avgSteps = 0; // Temporarily disabled for performance

        // Use denormalized resolved_model_name column for model stats
        const modelStatsIndex = hasPrivacyFilter(finalWhere) && hasFastSortVisibilityPrefix(finalWhere)
            ? 'idx_images_privacy_model_stats_v1'
            : 'idx_images_model_stats_v2';
        const modelQuery = `
        SELECT
        COALESCE(resolved_model_name, model_name, 'Unknown') as name,
            count(*) as count
            FROM images INDEXED BY ${modelStatsIndex}
            ${finalWhere}
            GROUP BY name
            ORDER BY count DESC
            LIMIT 20
            `;
            
        console.time('[DB] getLibraryStats: modelStats');
        const modelRows = await db.select<any[]>(modelQuery, params);
        console.timeEnd('[DB] getLibraryStats: modelStats');

        const modelStats = modelRows.map(r => ({
            name: (r.name || 'Unknown').split(' ')[0],
            fullName: r.name || 'Unknown',
            count: r.count
        }));

        // Get Keyword Stats
        const keywordStats = await getKeywordStats(finalWhere, params, collectionId, loraName);

        const finalResult = {
            totalImages: total,
            totalGenerations: total,
            avgSteps: avgSteps,
            estSizeMB: ((total * 2.4)).toFixed(1),
            modelStats,
            keywordStats
        };

        if (!whereClause && !collectionId && !loraName) {
            globalStatsCache = finalResult;
        }

        return finalResult;
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

export const getKeywordStats = async (whereClause: string = '', params: any[] = [], collectionId?: string, loraName?: string): Promise<{ text: string; value: number }[]> => {
    const db = await getDb();

    try {
        // Debug: Log the incoming filter to debug "static" issues
        console.log('[DB] getKeywordStats filter:', whereClause);

        // Fix ambiguity for JOIN: replace and ensure columns are prefixed with 'images.'
        const finalWhere = whereClause ? whereClause : DEFAULT_VISIBLE_WHERE;

        // Comprehensive list of columns in the 'images' table to prefix
        const columnsToPrefix = [
            'id', 'is_deleted', 'metadata_json', 'path', 'width', 'height', 'file_size',
            'timestamp', 'thumbnail_path', 'is_favorite', 'is_pinned', 'is_missing',
            'user_masked', 'group_id', 'board_id', 'notes', 'original_metadata_json',
            // New denormalized columns
            'model_hash', 'model_name', 'tool', 'resolved_model_name', 'is_intermediate_gen', 'is_grid_gen', 'privacy_hidden', 'sampler', 'generation_type',
            'positive_prompt', 'negative_prompt'
        ];

        // Improved Regex:
        // (?:\\bimages\\.)? -> Matches optional "images." prefix (non-capturing)
        // \\b(${columnsToPrefix.join('|')}) -> Matches the column name itself
        // \\b -> Word boundary to ensure full match
        const columnRegex = new RegExp(`(?:\\bimages\\.)?\\b(${columnsToPrefix.join('|')})\\b`, 'g');

        const safeWhere = finalWhere.replace(columnRegex, (match, col) => {
            // Note: 'match' is the full string (e.g. "id" or "images.id")
            // 'col' is the captured group 1 (e.g. "id")
            // We always want to return "images.id"
            return `images.${col}`;
        });

        // 1. Flip JOIN order: Filter 'images' first, then lookup FTS text
        // 2. Add RANDOM() sort to LIMIT to get a representative sample of the filtered set
        //    (instead of just the first N oldest images)
        /*
         * Note on Performance: 
         * ORDER BY RANDOM() on the full set is slow. 
         * But since we have a LIMIT, SQLite can sometimes optimize.
         * For a word cloud, we need a diverse sample.
         */
        let joinClause = "JOIN images_fts ON images_fts.rowid = images.rowid";

        // Prioritize Collection/LoRA filtering with INNER JOIN if present
        // Prioritize Collection/LoRA filtering with INNER JOIN if present
        if (collectionId && loraName) {
            joinClause = `
                JOIN collection_images ci ON ci.image_id = images.id AND ci.collection_id = '${collectionId}'
                JOIN image_loras il ON il.image_id = images.id AND il.lora_name = '${loraName}'
                JOIN images_fts ON images_fts.rowid = images.rowid
            `;
        } else if (collectionId) {
            joinClause = `
                JOIN collection_images ci ON ci.image_id = images.id AND ci.collection_id = '${collectionId}'
                JOIN images_fts ON images_fts.rowid = images.rowid
            `;
        } else if (loraName) {
            joinClause = `
                JOIN image_loras il ON il.image_id = images.id AND il.lora_name = '${loraName}'
                JOIN images_fts ON images_fts.rowid = images.rowid
            `;
        }

        const promptQuery = `
            SELECT images_fts.positive_prompt 
            FROM images
            ${joinClause}
            ${safeWhere}
            LIMIT ${WORD_CLOUD_CONFIG.ANALYSIS_LIMIT}
        `;
        
        console.time('[DB] getKeywordStats');
        const rows = await db.select<any[]>(promptQuery, params);
        console.timeEnd('[DB] getKeywordStats');
        
        const stopWords = new Set(WORD_CLOUD_CONFIG.STOP_WORDS);
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

    const result: Facets = { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] };

    try {
        // Map frontend type names to cache type names and create parameterized query
        const cacheTypes = types;
        const placeholders = cacheTypes.map(() => '?').join(',');

        const cacheRows = await db.select<any[]>(`
            SELECT facet_type, resource_name, resource_hash, count, thumbnail_path, preview_url, last_used_at, created_at, is_manual, has_sidecar, is_user_override
            FROM facet_cache
            WHERE facet_type IN(${placeholders})
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
                previewUrl: row.preview_url,
                isManual: row.is_manual,
                hasSidecar: row.has_sidecar,
                isUserOverride: row.is_user_override
            };

            switch (row.facet_type) {
                case 'checkpoints':
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
                case 'control_nets':
                    result.controlNets.push(item);
                    break;
                case 'ip_adapters':
                    result.ipAdapters.push(item);
                    break;
                case 'tools':
                    result.tools.push(row.resource_name);
                    break;
            }
        }

        return result;

    } catch (e) {
        console.error('[DB] Failed to get facets from cache', e);
        return { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [], controlNets: [], ipAdapters: [] };
    }
};

/**
 * Get valid facet names for drill-down filtering.
 * Returns distinct facet names that exist in the current filtered result set.
 * Used to hide facet options that have no matching images in the current filter context.
 */
export const getValidFacetNames = async (
    filters: FilterState,
    collections: Collection[],
    excludeCategories: string[] = []
): Promise<ValidFacetNames> => {
    try {
        // Import the command dynamically to avoid circular dependencies
        const { commands } = await import('../../bindings');
        const result = await commands.getValidFacetNames(
            filters as any,
            collections as any,
            excludeCategories
        );

        if (result.status === 'ok') {
            return result.data;
        } else {
            console.error('[DB] Failed to get valid facet names:', result.error);
            return { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [], controlNets: [], ipAdapters: [] };
        }
    } catch (e) {
        console.error('[DB] Failed to get valid facet names', e);
        return { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], tools: [], controlNets: [], ipAdapters: [] };
    }
};
