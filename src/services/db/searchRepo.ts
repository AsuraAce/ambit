import { AIImage, AssetScope, FacetType } from '../../types';
import { getDb } from './connection';
import { mapRowToImage, getImageFieldsLight } from './repoUtils';
import { WORD_CLOUD_CONFIG } from '../../config/wordCloud';
import { getAssetMatchKey, uniqueAssetAliases } from '../../utils/assetIdentity';
import { describeDbQueryReason, timeDbCall } from '../../utils/dbTiming';

export interface LibraryStats {
    totalImages: number;
    totalGenerations: number;
    avgSteps: number;
    estSizeMB: string;
    modelStats: { name: string; fullName: string; count: number }[];
    keywordStats: { text: string; value: number }[];
}

export interface FacetItem {
    name: string;
    count: number;
    lastUsedAt?: number;
    createdAt?: number;
    localModifiedAt?: number;
    thumbnailPath?: string;
    previewUrl?: string;
    hash?: string;
    isManual?: number;
    hasSidecar?: number;
    isUserOverride?: number;
    safeThumbnailPath?: string;
    thumbnailImageId?: string;
    thumbnailIsSensitive?: number;
    thumbnailSensitivityOverride?: number | null;
    isLocalDisk?: boolean;
    assetMatchKey?: string;
    filterAliases?: string[];
}

export interface Facets {
    checkpoints: FacetItem[];
    loras: FacetItem[];
    embeddings: FacetItem[];
    hypernetworks: FacetItem[];
    controlNets: FacetItem[];
    ipAdapters: FacetItem[];
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

interface FacetCacheRow {
    facet_type: string;
    resource_name: string | null;
    resource_hash: string | null;
    count: number | null;
    thumbnail_path: string | null;
    preview_url: string | null;
    last_used_at: number | null;
    created_at: number | null;
    is_manual: number | null;
    has_sidecar: number | null;
    is_user_override: number | null;
    safe_thumbnail_path: string | null;
    thumbnail_image_id: string | null;
    thumbnail_is_sensitive: number | null;
    thumbnail_sensitivity_override: number | null;
}

interface DiskModelRow {
    resource_type: string | null;
    name: string | null;
    hash: string | null;
    local_modified_at: number | null;
    scanned_at: number | null;
}

interface FacetMergeGroup {
    item: FacetItem;
    usedAliases: Set<string>;
    displayCount: number;
}

export interface GetFacetsOptions {
    assetScope?: AssetScope;
}

const maxOptionalNumber = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a == null) return b;
    if (b == null) return a;
    return Math.max(a, b);
};

const UNIX_SECONDS_CUTOFF = 10_000_000_000;

const normalizeUnixMillis = (value: number | null | undefined): number | undefined => {
    if (value == null || value <= 0) return undefined;
    return value < UNIX_SECONDS_CUTOFF ? value * 1000 : value;
};

const minOptionalNumber = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
};

const copyFallbackFacetFields = (target: FacetItem, source: FacetItem): FacetItem => ({
    ...target,
    thumbnailPath: target.thumbnailPath || source.thumbnailPath,
    previewUrl: target.previewUrl || source.previewUrl,
    safeThumbnailPath: target.safeThumbnailPath || source.safeThumbnailPath,
    thumbnailImageId: target.thumbnailImageId || source.thumbnailImageId,
    thumbnailIsSensitive: target.thumbnailIsSensitive ?? source.thumbnailIsSensitive,
    thumbnailSensitivityOverride: target.thumbnailSensitivityOverride ?? source.thumbnailSensitivityOverride,
    isManual: Math.max(target.isManual ?? 0, source.isManual ?? 0),
    hasSidecar: Math.max(target.hasSidecar ?? 0, source.hasSidecar ?? 0),
    isUserOverride: Math.max(target.isUserOverride ?? 0, source.isUserOverride ?? 0),
});

const mergeFacetItem = (group: FacetMergeGroup, candidate: FacetItem): void => {
    if (candidate.count > 0) {
        group.usedAliases.add(candidate.name);
    }

    const totalCount = group.item.count + candidate.count;
    const isLocalDisk = Boolean(group.item.isLocalDisk || candidate.isLocalDisk);
    const lastUsedAt = maxOptionalNumber(group.item.lastUsedAt, candidate.lastUsedAt);
    const createdAt = minOptionalNumber(group.item.createdAt, candidate.createdAt);
    const localModifiedAt = maxOptionalNumber(group.item.localModifiedAt, candidate.localModifiedAt);

    if (candidate.count > 0 && (group.displayCount === 0 || candidate.count > group.displayCount)) {
        group.item = copyFallbackFacetFields(
            {
                ...candidate,
                count: totalCount,
                isLocalDisk,
                lastUsedAt,
                createdAt,
                localModifiedAt,
                assetMatchKey: group.item.assetMatchKey,
            },
            group.item
        );
        group.displayCount = candidate.count;
        return;
    }

    group.item = copyFallbackFacetFields(
        {
            ...group.item,
            count: totalCount,
            isLocalDisk,
            lastUsedAt,
            createdAt,
            localModifiedAt,
        },
        candidate
    );
};

const sortFacetItems = (items: FacetItem[]): FacetItem[] => (
    items.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
);

const cacheTypeToDiskResourceType = (cacheType: string): string | null => {
    if (cacheType === 'tools') return null;
    return cacheType === 'checkpoints' ? 'checkpoint' : cacheType;
};

const diskResourceTypeToCacheType = (resourceType: string | null): string | null => {
    if (!resourceType) return null;
    if (resourceType === 'checkpoint') return 'checkpoints';
    if (resourceType === 'loras') return 'loras';
    if (resourceType === 'embeddings') return 'embeddings';
    if (resourceType === 'hypernetworks') return 'hypernetworks';
    if (resourceType === 'control_nets') return 'control_nets';
    if (resourceType === 'ip_adapters') return 'ip_adapters';
    return null;
};

const addSetValue = (map: Map<string, Set<string>>, key: string, value: string | null | undefined): void => {
    if (!value) return;
    const normalized = value.toLowerCase();
    const values = map.get(key) ?? new Set<string>();
    values.add(normalized);
    map.set(key, values);
};

const addRawSetValue = (map: Map<string, Set<string>>, key: string, value: string | null | undefined): void => {
    if (!value) return;
    const values = map.get(key) ?? new Set<string>();
    values.add(value);
    map.set(key, values);
};

const addTimestampValue = (
    map: Map<string, Map<string, number>>,
    key: string,
    value: string | null | undefined,
    timestamp: number | null | undefined,
    normalize: boolean = false
): void => {
    if (!value || timestamp == null || timestamp <= 0) return;
    const lookupValue = normalize ? value.toLowerCase() : value;
    const values = map.get(key) ?? new Map<string, number>();
    values.set(lookupValue, Math.max(values.get(lookupValue) ?? 0, timestamp));
    map.set(key, values);
};

const buildDiskModelLookups = (rows: DiskModelRow[]) => {
    const namesByCacheType = new Map<string, Set<string>>();
    const hashesByCacheType = new Map<string, Set<string>>();
    const matchKeysByCacheType = new Map<string, Set<string>>();
    const modifiedByNameByCacheType = new Map<string, Map<string, number>>();
    const modifiedByHashByCacheType = new Map<string, Map<string, number>>();
    const modifiedByMatchKeyByCacheType = new Map<string, Map<string, number>>();

    for (const row of rows) {
        const cacheType = diskResourceTypeToCacheType(row.resource_type);
        if (!cacheType) continue;
        const localModifiedAt = normalizeUnixMillis(row.local_modified_at ?? row.scanned_at);

        addSetValue(namesByCacheType, cacheType, row.name);
        addRawSetValue(hashesByCacheType, cacheType, row.hash);
        addTimestampValue(modifiedByNameByCacheType, cacheType, row.name, localModifiedAt, true);
        addTimestampValue(modifiedByHashByCacheType, cacheType, row.hash, localModifiedAt);

        const name = row.name || '';
        const matchKey = getAssetMatchKey(name) || name.toLowerCase();
        addRawSetValue(matchKeysByCacheType, cacheType, matchKey);
        addTimestampValue(modifiedByMatchKeyByCacheType, cacheType, matchKey, localModifiedAt);
    }

    return {
        namesByCacheType,
        hashesByCacheType,
        matchKeysByCacheType,
        modifiedByNameByCacheType,
        modifiedByHashByCacheType,
        modifiedByMatchKeyByCacheType
    };
};

const isDiskBackedFacetRow = (
    row: FacetCacheRow,
    assetMatchKey: string,
    diskLookups: ReturnType<typeof buildDiskModelLookups>
): boolean => {
    const cacheType = row.facet_type;
    const name = row.resource_name || '';

    return Boolean(row.resource_hash && diskLookups.hashesByCacheType.get(cacheType)?.has(row.resource_hash))
        || Boolean(name && diskLookups.namesByCacheType.get(cacheType)?.has(name.toLowerCase()))
        || Boolean(assetMatchKey && diskLookups.matchKeysByCacheType.get(cacheType)?.has(assetMatchKey));
};

const getDiskModifiedAtForFacetRow = (
    row: FacetCacheRow,
    assetMatchKey: string,
    diskLookups: ReturnType<typeof buildDiskModelLookups>
): number | undefined => {
    const cacheType = row.facet_type;
    const name = row.resource_name || '';
    return maxOptionalNumber(
        maxOptionalNumber(
            row.resource_hash ? diskLookups.modifiedByHashByCacheType.get(cacheType)?.get(row.resource_hash) : undefined,
            name ? diskLookups.modifiedByNameByCacheType.get(cacheType)?.get(name.toLowerCase()) : undefined
        ),
        assetMatchKey ? diskLookups.modifiedByMatchKeyByCacheType.get(cacheType)?.get(assetMatchKey) : undefined
    );
};

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
    const reason = describeDbQueryReason(finalWhere, collectionId, loraName);

    // For combined Collection + LoRA counts
    if (collectionId && loraName) {
        const query = `
            SELECT count(*) as count 
            FROM collection_images ci
            JOIN image_loras il ON il.image_id = ci.image_id
            JOIN images ON images.id = ci.image_id
            ${finalWhere.replace('WHERE', 'WHERE ci.collection_id = ? AND il.lora_name = ? AND')}
        `;
        const result = await timeDbCall('countImages', reason, () => db.select<any[]>(query, [collectionId, loraName, ...params]));
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
        const result = await timeDbCall('countImages', reason, () => db.select<any[]>(query, [collectionId, ...params]));
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
        const result = await timeDbCall('countImages', reason, () => db.select<any[]>(query, [loraName, ...params]));
        return result[0]?.count || 0;
    }

    // Simple count using denormalized columns - no JOIN needed
    const fromClause = hasPrivacyFilter(finalWhere) && hasFastSortVisibilityPrefix(finalWhere)
        ? 'FROM images INDEXED BY idx_images_privacy_fast_sort_v1'
        : 'FROM images';
    const query = `SELECT count(*) as count ${fromClause} ${finalWhere}`;

    const result = await timeDbCall('countImages', reason, () => db.select<any[]>(query, params));
    return result[0]?.count || 0;
};

/**
 * Fast global count - uses simpler query without JOINs for speed.
 * Result can be cached at the query layer.
 */
export const countGlobalImages = async (): Promise<number> => {
    const db = await getDb();
    const result = await timeDbCall('countGlobalImages', 'default', () => db.select<any[]>(
        `SELECT count(*) as count FROM images WHERE is_deleted = 0`
    ));
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
    const reason = describeDbQueryReason(finalWhere, collectionId, loraName);

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
        const rows = await timeDbCall('searchImages', reason, () => db.select<any[]>(query, [collectionId, loraName, ...params]));
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
        const rows = await timeDbCall('searchImages', reason, () => db.select<any[]>(query, [collectionId, ...params]));
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
        const rows = await timeDbCall('searchImages', reason, () => db.select<any[]>(query, [loraName, ...params]));
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

    const rows = await timeDbCall('searchImages', reason, () => db.select<any[]>(query, params));
    
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
    const reason = describeDbQueryReason(finalWhere, collectionId, loraName);

    try {
        const statsQuery = `
            SELECT 
                count(*) as total

            FROM images 
            ${collectionId ? `JOIN collection_images ci ON ci.image_id = images.id AND ci.collection_id = '${collectionId}'` : ''}
            ${loraName ? `JOIN image_loras il ON il.image_id = images.id AND il.lora_name = '${loraName}'` : ''}
            ${finalWhere}
        `;

        const basicStats = await timeDbCall('libraryStats.basicStats', reason, () => db.select<any[]>(statsQuery, params));
        
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
            
        const modelRows = await timeDbCall('libraryStats.modelStats', reason, () => db.select<any[]>(modelQuery, params));

        const modelStats = modelRows.map(r => ({
            name: (r.name || 'Unknown').split(' ')[0],
            fullName: r.name || 'Unknown',
            count: r.count
        }));

        // Get Keyword Stats
        const keywordStats = await timeDbCall('libraryStats.keywordStats', reason, () => getKeywordStats(finalWhere, params, collectionId, loraName));

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
        
        const reason = describeDbQueryReason(finalWhere, collectionId, loraName);
        const rows = await timeDbCall('keywordStats.promptSample', reason, () => db.select<any[]>(promptQuery, params));
        
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
    types: FacetType[] = ['checkpoints', 'loras', 'embeddings', 'hypernetworks', 'tools'],
    options: GetFacetsOptions = {}
): Promise<Facets> => {
    const db = await getDb();
    const assetScope = options.assetScope ?? 'used';

    const result: Facets = { checkpoints: [], loras: [], embeddings: [], hypernetworks: [], controlNets: [], ipAdapters: [], tools: [] };

    try {
        const cacheTypeMap: Record<FacetType, string> = {
            checkpoints: 'checkpoints',
            loras: 'loras',
            embeddings: 'embeddings',
            hypernetworks: 'hypernetworks',
            controlNets: 'control_nets',
            ipAdapters: 'ip_adapters',
            tools: 'tools'
        };
        const cacheTypes = Array.from(new Set(types.map(type => cacheTypeMap[type])));
        if (cacheTypes.length === 0) return result;

        const placeholders = cacheTypes.map(() => '?').join(',');
        const diskResourceTypes = Array.from(new Set(
            cacheTypes
                .map(cacheTypeToDiskResourceType)
                .filter((type): type is string => type !== null)
        ));
        const diskPlaceholders = diskResourceTypes.map(() => '?').join(',');
        const scopePredicate = assetScope === 'used'
            ? 'AND fc.count > 0'
            : '';

        const [cacheRows, diskRows] = await Promise.all([
            db.select<FacetCacheRow[]>(`
            SELECT
                fc.facet_type, fc.resource_name, fc.resource_hash, fc.count, fc.thumbnail_path, fc.preview_url,
                fc.last_used_at, fc.created_at, fc.is_manual, fc.has_sidecar, fc.is_user_override,
                fc.safe_thumbnail_path, fc.thumbnail_image_id, fc.thumbnail_is_sensitive, fc.thumbnail_sensitivity_override
            FROM facet_cache fc
            WHERE fc.facet_type IN(${placeholders})
            ${scopePredicate}
            ORDER BY fc.count DESC, fc.resource_name ASC
            `, cacheTypes),
            diskResourceTypes.length > 0
                ? db.select<DiskModelRow[]>(`
                    SELECT
                        m.resource_type,
                        m.name,
                        m.hash,
                        COALESCE(sf.modified, m.scanned_at) AS local_modified_at,
                        m.scanned_at
                    FROM models m
                    LEFT JOIN scanned_files sf ON sf.hash = m.hash
                    WHERE m.lookup_source = 'disk_scan'
                      AND m.resource_type IN(${diskPlaceholders})
                `, diskResourceTypes)
                : Promise.resolve([] as DiskModelRow[])
        ]);
        const diskLookups = buildDiskModelLookups(diskRows);

        const mergedResources: Record<string, Map<string, FacetMergeGroup>> = {
            checkpoints: new Map(),
            loras: new Map(),
            embeddings: new Map(),
            hypernetworks: new Map(),
            control_nets: new Map(),
            ip_adapters: new Map()
        };

        for (const row of cacheRows) {
            if (row.facet_type === 'tools') {
                result.tools.push(row.resource_name || 'Unknown');
                continue;
            }

            const assetMatchKey = getAssetMatchKey(row.resource_name) || (row.resource_name || 'Unknown').toLowerCase();
            const isLocalDisk = isDiskBackedFacetRow(row, assetMatchKey, diskLookups);
            const localModifiedAt = isLocalDisk
                ? getDiskModifiedAtForFacetRow(row, assetMatchKey, diskLookups)
                : undefined;
            const item: FacetItem = {
                name: row.resource_name || 'Unknown',
                hash: row.resource_hash ?? undefined,
                count: row.count ?? 0,
                lastUsedAt: row.last_used_at ?? undefined,
                createdAt: row.created_at ?? localModifiedAt,
                localModifiedAt,
                thumbnailPath: row.thumbnail_path ?? undefined,
                previewUrl: row.preview_url ?? undefined,
                isManual: row.is_manual ?? undefined,
                hasSidecar: row.has_sidecar ?? undefined,
                isUserOverride: row.is_user_override ?? undefined,
                safeThumbnailPath: row.safe_thumbnail_path ?? undefined,
                thumbnailImageId: row.thumbnail_image_id ?? undefined,
                thumbnailIsSensitive: row.thumbnail_is_sensitive ?? undefined,
                thumbnailSensitivityOverride: row.thumbnail_sensitivity_override,
                isLocalDisk,
                assetMatchKey
            };

            const groupMap = mergedResources[row.facet_type];
            if (!groupMap) continue;

            const existing = groupMap.get(assetMatchKey);
            if (existing) {
                mergeFacetItem(existing, item);
            } else {
                groupMap.set(assetMatchKey, {
                    item,
                    usedAliases: new Set(item.count > 0 ? [item.name] : []),
                    displayCount: item.count
                });
            }
        }

        const shouldIncludeFacetItem = (item: FacetItem): boolean => {
            if (assetScope === 'used') return item.count > 0;
            if (assetScope === 'local') return Boolean(item.isLocalDisk);
            return item.count > 0 || Boolean(item.isLocalDisk);
        };

        const finalizeGroups = (facetType: keyof typeof mergedResources): FacetItem[] => sortFacetItems(
            Array.from(mergedResources[facetType].values()).map(group => ({
                ...group.item,
                filterAliases: uniqueAssetAliases([group.item.name, ...group.usedAliases]),
            })).filter(shouldIncludeFacetItem)
        );

        result.checkpoints = finalizeGroups('checkpoints');
        result.loras = finalizeGroups('loras');
        result.embeddings = finalizeGroups('embeddings');
        result.hypernetworks = finalizeGroups('hypernetworks');
        result.controlNets = finalizeGroups('control_nets');
        result.ipAdapters = finalizeGroups('ip_adapters');

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
    whereClause: string,
    params: unknown[],
    collectionId?: string,
    loraName?: string
): Promise<ValidFacetNames | null> => {
    try {
        // Import the command dynamically to avoid circular dependencies
        const { commands } = await import('../../bindings');
        const reason = describeDbQueryReason(whereClause, collectionId, loraName);
        const result = await timeDbCall(
            'validFacets',
            reason,
            () => commands.getValidFacetNames(
                whereClause,
                JSON.stringify(params),
                collectionId ?? null,
                loraName ?? null
            )
        );

        if (result.status === 'ok') {
            return result.data;
        } else {
            console.error('[DB] Failed to get valid facet names:', result.error);
            return null;
        }
    } catch (e) {
        console.error('[DB] Failed to get valid facet names', e);
        return null;
    }
};
