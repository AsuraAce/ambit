import { convertFileSrc } from '@tauri-apps/api/core';
import { getDb } from './connection';
import { normalizePath } from '../../utils/pathUtils';
import { Collection, FilterState } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
import { dbMutex } from './connection';
import { isBrowserMockMode } from '../runtime';
import { timeDbCall } from '../../utils/dbTiming';
import { buildSqlWhereClause } from '../../utils/sqlHelpers';
import {
    addBrowserMockImagesToCollection,
    deleteBrowserMockCollection,
    getBrowserMockCollections,
    getBrowserMockImages,
    removeBrowserMockImagesFromCollection,
    upsertBrowserMockCollection,
} from '../browserMockData';

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
    updated_at?: number;
    dynamic_thumbnail_path?: string | null;
    dynamic_safe_thumbnail_path?: string | null;
    dynamic_thumbnail_is_sensitive?: number | null;
    dynamic_thumbnail_cached_at?: number | null;
    dynamic_count?: number | null;
}

interface CollectionThumbnailRow {
    collection_id: string;
    dynamic_thumb?: string | null;
    dynamic_privacy?: number | null;
    safe_thumb?: string | null;
}

interface ImageThumbnailLookupRow {
    id: string;
    path: string;
    thumb?: string | null;
    privacy_hidden?: number | null;
}

interface CustomThumbnailMatch {
    thumb?: string | null;
    privacyHidden?: number | null;
}

export interface SmartCollectionSummary {
    count: number;
    thumbnail?: string;
    safeThumbnail?: string;
    thumbnailIsSensitive?: boolean;
    thumbnailSourceKind?: 'dynamic';
}

export interface CollectionThumbnailSummary {
    thumbnail?: string;
    safeThumbnail?: string;
    thumbnailIsSensitive?: boolean;
    thumbnailSourceKind?: Collection['thumbnailSourceKind'];
}

interface CollectionThumbnailBuildResult {
    summaries: Record<string, CollectionThumbnailSummary>;
    cacheUpdates: DynamicThumbnailCacheUpdate[];
}

interface DynamicThumbnailCacheUpdate {
    collectionId: string;
    thumbnailPath?: string | null;
    safeThumbnailPath?: string | null;
    thumbnailIsSensitive?: boolean | null;
}

interface DynamicCountCacheUpdate {
    collectionId: string;
    count: number;
    collectionUpdatedAt: number;
}

const dynamicCountCacheWriteTails = new Map<string, Promise<void>>();

interface CollectionStatsOptions {
    includeThumbnails?: boolean;
}

interface SmartCollectionSummaryOptions {
    includeThumbnails?: boolean;
}

interface CollectionThumbnailInput {
    id: string;
    custom_thumbnail?: string | null;
}

interface CollectionMembershipRow {
    collection_id: string;
}

interface CollectionSchemaColumn {
    name: string;
}

const toDisplayUrl = (rawPath?: string | null): string | undefined => {
    if (!rawPath) return undefined;
    if (
        rawPath.startsWith('http') ||
        rawPath.startsWith('data:') ||
        rawPath.startsWith('blob:') ||
        rawPath.startsWith('asset:')
    ) {
        return rawPath;
    }
    return convertFileSrc(normalizePath(rawPath));
};

const nowMs = () => performance.now();

const logStartupDuration = (label: string, startedAt: number) => {
    const elapsed = Math.round(nowMs() - startedAt);
    console.info(`[Startup] ${label} completed in ${elapsed}ms`);
};

const chunk = <T,>(items: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

const loadImageThumbnailLookup = async (
    db: Awaited<ReturnType<typeof getDb>>,
    column: 'id' | 'path',
    values: string[]
): Promise<Map<string, CustomThumbnailMatch>> => {
    const matches = new Map<string, CustomThumbnailMatch>();
    const uniqueValues = [...new Set(values.filter(Boolean))];
    const batches = chunk(uniqueValues, 900);

    for (const batch of batches) {
        const placeholders = batch.map(() => '?').join(',');
        const rows = await db.select<ImageThumbnailLookupRow[]>(
            `SELECT id, path, COALESCE(NULLIF(thumbnail_path, ''), path) as thumb, privacy_hidden
             FROM images
             WHERE ${column} IN (${placeholders})`,
            batch
        );

        rows.forEach((row) => {
            const key = column === 'id' ? row.id : row.path;
            matches.set(key, {
                thumb: row.thumb,
                privacyHidden: row.privacy_hidden
            });
        });
    }

    return matches;
};

const getCachedDynamicThumbnailSummary = (collection: DbCollection): CollectionThumbnailSummary | undefined => {
    if (collection.custom_thumbnail || !collection.dynamic_thumbnail_path) return undefined;

    return {
        thumbnail: toDisplayUrl(collection.dynamic_thumbnail_path),
        safeThumbnail: toDisplayUrl(collection.dynamic_safe_thumbnail_path),
        thumbnailIsSensitive: collection.dynamic_thumbnail_is_sensitive === 1,
        thumbnailSourceKind: 'dynamic'
    };
};

const writeDynamicThumbnailCache = async (
    db: Awaited<ReturnType<typeof getDb>>,
    updates: DynamicThumbnailCacheUpdate[]
) => {
    if (updates.length === 0) return;

    const cachedAt = Date.now();
    for (const update of updates) {
        const hasThumbnail = !!update.thumbnailPath;
        await db.execute(
            `UPDATE collections
             SET dynamic_thumbnail_path = ?,
                 dynamic_safe_thumbnail_path = ?,
                 dynamic_thumbnail_is_sensitive = ?,
                 dynamic_thumbnail_cached_at = ?
             WHERE id = ?
               AND (custom_thumbnail IS NULL OR custom_thumbnail = '')`,
            [
                hasThumbnail ? update.thumbnailPath : null,
                hasThumbnail ? update.safeThumbnailPath || null : null,
                hasThumbnail ? (update.thumbnailIsSensitive ? 1 : 0) : null,
                hasThumbnail ? cachedAt : null,
                update.collectionId
            ]
        );
    }
};

export const cacheSmartCollectionCount = async (
    collectionId: string,
    count: number,
    collectionUpdatedAt: number
): Promise<void> => {
    if (isBrowserMockMode()) return;

    const previousWrite = dynamicCountCacheWriteTails.get(collectionId) ?? Promise.resolve();
    const update: DynamicCountCacheUpdate = { collectionId, count, collectionUpdatedAt };
    const write = previousWrite.then(async () => {
        try {
            const db = await getDb();
            await db.execute(
                `UPDATE collections
                 SET dynamic_count = ?
                 WHERE id = ?
                   AND filter_state IS NOT NULL
                   AND updated_at = ?`,
                [update.count, update.collectionId, update.collectionUpdatedAt]
            );
        } catch (error) {
            console.error(`[DB] Failed to cache smart collection count ${update.collectionId}`, error);
        }
    });

    dynamicCountCacheWriteTails.set(collectionId, write);
    try {
        await write;
    } finally {
        if (dynamicCountCacheWriteTails.get(collectionId) === write) {
            dynamicCountCacheWriteTails.delete(collectionId);
        }
    }
};

const clearDynamicThumbnailCacheForCollections = async (
    db: Awaited<ReturnType<typeof getDb>>,
    collectionIds: string[]
) => {
    const uniqueIds = [...new Set(collectionIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;

    for (const idBatch of chunk(uniqueIds, 900)) {
        const placeholders = idBatch.map(() => '?').join(',');
        await db.execute(
            `UPDATE collections
             SET dynamic_thumbnail_path = NULL,
                 dynamic_safe_thumbnail_path = NULL,
                 dynamic_thumbnail_is_sensitive = NULL,
                 dynamic_thumbnail_cached_at = NULL
             WHERE id IN (${placeholders})
               AND (custom_thumbnail IS NULL OR custom_thumbnail = '')`,
            idBatch
        );
    }
};

export const clearCollectionThumbnailCacheForCollections = async (collectionIds: string[]) => {
    if (isBrowserMockMode() || collectionIds.length === 0) return;

    const db = await getDb();
    await clearDynamicThumbnailCacheForCollections(db, collectionIds);
};

export const clearCollectionThumbnailCacheForImages = async (imageIds: string[]) => {
    if (isBrowserMockMode() || imageIds.length === 0) return;

    const db = await getDb();
    const normalizedIds = [...new Set(imageIds.map(normalizePath).filter(Boolean))];
    const collectionIds: string[] = [];
    for (const idBatch of chunk(normalizedIds, 900)) {
        const placeholders = idBatch.map(() => '?').join(',');
        const rows = await db.select<CollectionMembershipRow[]>(
            `SELECT DISTINCT collection_id
             FROM collection_images
             WHERE image_id IN (${placeholders})`,
            idBatch
        );
        collectionIds.push(...(rows ?? []).map(row => row.collection_id));
    }

    await clearDynamicThumbnailCacheForCollections(db, collectionIds);
};

export const clearInvokeBoardThumbnailCaches = async () => {
    if (isBrowserMockMode()) return;

    const db = await getDb();
    await db.execute(
        `UPDATE collections
         SET dynamic_thumbnail_path = NULL,
             dynamic_safe_thumbnail_path = NULL,
             dynamic_thumbnail_is_sensitive = NULL,
             dynamic_thumbnail_cached_at = NULL
         WHERE source = 'invoke'
           AND filter_state IS NULL
           AND (custom_thumbnail IS NULL OR custom_thumbnail = '')`
    );
};

export const clearAllCollectionThumbnailCaches = async () => {
    if (isBrowserMockMode()) return;

    const db = await getDb();
    await db.execute(
        `UPDATE collections
         SET dynamic_thumbnail_path = NULL,
             dynamic_safe_thumbnail_path = NULL,
             dynamic_thumbnail_is_sensitive = NULL,
             dynamic_thumbnail_cached_at = NULL
         WHERE custom_thumbnail IS NULL OR custom_thumbnail = ''`
    );
};

const buildCollectionThumbnailSummaries = async (
    db: Awaited<ReturnType<typeof getDb>>,
    collections: CollectionThumbnailInput[]
): Promise<CollectionThumbnailBuildResult> => {
    if (collections.length === 0) return { summaries: {}, cacheUpdates: [] };

    const ids = [...new Set(
        collections
            .filter((collection) => !collection.custom_thumbnail)
            .map((collection) => collection.id)
            .filter(Boolean)
    )];
    const thumbnailRows: CollectionThumbnailRow[] = [];

    for (const idBatch of chunk(ids, 900)) {
        const placeholders = idBatch.map(() => '?').join(',');
        const rows = await db.select<CollectionThumbnailRow[]>(`
            WITH ranked_thumbnails AS (
                SELECT
                    ci.collection_id,
                    i.thumbnail_path,
                    i.privacy_hidden,
                    ROW_NUMBER() OVER (
                        PARTITION BY ci.collection_id
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as dynamic_rank,
                    ROW_NUMBER() OVER (
                        PARTITION BY ci.collection_id, i.privacy_hidden
                        ORDER BY i.is_pinned DESC, i.timestamp DESC
                    ) as privacy_rank
                FROM collection_images ci
                INNER JOIN images i ON ci.image_id = i.id
                WHERE ci.collection_id IN (${placeholders})
                    AND i.is_deleted = 0
                    AND i.thumbnail_path IS NOT NULL
                    AND i.thumbnail_path != ''
            )
            SELECT
                collection_id,
                MAX(CASE WHEN dynamic_rank = 1 THEN thumbnail_path END) as dynamic_thumb,
                MAX(CASE WHEN dynamic_rank = 1 THEN privacy_hidden END) as dynamic_privacy,
                MAX(CASE WHEN privacy_hidden = 0 AND privacy_rank = 1 THEN thumbnail_path END) as safe_thumb
            FROM ranked_thumbnails
            GROUP BY collection_id
        `, idBatch);

        thumbnailRows.push(...rows);
    }

    const thumbMap = new Map(thumbnailRows.map((row) => [row.collection_id, row]));
    const customThumbValues = collections
        .map((collection) => collection.custom_thumbnail)
        .filter((value): value is string => !!value);
    const customById = await loadImageThumbnailLookup(db, 'id', customThumbValues);
    const unresolvedCustomValues = customThumbValues.filter((value) => !customById.has(value));
    const customByPath = await loadImageThumbnailLookup(db, 'path', unresolvedCustomValues);

    const cacheUpdates: DynamicThumbnailCacheUpdate[] = [];
    const summaries = Object.fromEntries(collections.map((collection) => {
        const thumbRow = thumbMap.get(collection.id);
        const customThumb = collection.custom_thumbnail
            ? customById.get(collection.custom_thumbnail) ?? customByPath.get(collection.custom_thumbnail)
            : undefined;
        let rawThumb = thumbRow?.dynamic_thumb;
        let safeThumb = thumbRow?.safe_thumb;
        let thumbnailIsSensitive = thumbRow?.dynamic_privacy === 1;
        let thumbnailSourceKind: Collection['thumbnailSourceKind'] = 'dynamic';

        if (collection.custom_thumbnail) {
            if (customThumb) {
                rawThumb = customThumb.thumb || collection.custom_thumbnail;
                safeThumb = undefined;
                thumbnailIsSensitive = customThumb.privacyHidden === 1;
                thumbnailSourceKind = 'customImage';
            } else {
                rawThumb = collection.custom_thumbnail;
                safeThumb = undefined;
                thumbnailIsSensitive = false;
                thumbnailSourceKind = 'customPath';
            }
        }

        if (!collection.custom_thumbnail) {
            cacheUpdates.push({
                collectionId: collection.id,
                thumbnailPath: rawThumb || null,
                safeThumbnailPath: rawThumb ? safeThumb || null : null,
                thumbnailIsSensitive: rawThumb ? thumbnailIsSensitive : null
            });
        }

        return [collection.id, {
            thumbnail: toDisplayUrl(rawThumb),
            safeThumbnail: collection.custom_thumbnail ? undefined : toDisplayUrl(safeThumb),
            thumbnailIsSensitive,
            thumbnailSourceKind
        }];
    }));

    return { summaries, cacheUpdates };
};

export const parsePersistedCollectionFilters = (filterState?: string | null): FilterState | undefined => {
    if (!filterState) return undefined;

    try {
        const parsed = JSON.parse(filterState) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }

        return createDefaultFilters(parsed as Partial<FilterState>);
    } catch (error) {
        console.warn('[DB] Failed to parse collection filter state', error);
        return undefined;
    }
};

export const ensureCollectionSchema = async () => {
    if (isBrowserMockMode()) return;

    return dbMutex.dispatch(async () => {
        const db = await getDb();
        try {
            const columns = await db.select<CollectionSchemaColumn[]>('PRAGMA table_info(collections)');
            const existingColumns = new Set(columns.map(c => c.name));

            const addColumnIfMissing = async (
                columnName: string,
                alterSql: string,
                afterAdd?: () => Promise<unknown>
            ) => {
                if (existingColumns.has(columnName)) return;

                console.log(`[DB] Migrating collections table: adding ${columnName} column`);
                try {
                    await db.execute(alterSql);
                    existingColumns.add(columnName);
                    await afterAdd?.();
                } catch (e: unknown) {
                    // Ignore duplicate column error if it raced despite mutex (unlikely but safe)
                    const message = e instanceof Error ? e.message : String(e);
                    if (message.includes('duplicate column')) {
                        console.warn(`[DB] Migration raced, ${columnName} column already exists (handled)`);
                        existingColumns.add(columnName);
                    } else {
                        throw e;
                    }
                }
            };

            await addColumnIfMissing(
                'updated_at',
                'ALTER TABLE collections ADD COLUMN updated_at INTEGER',
                () => db.execute('UPDATE collections SET updated_at = created_at WHERE updated_at IS NULL')
            );
            await addColumnIfMissing(
                'dynamic_thumbnail_path',
                'ALTER TABLE collections ADD COLUMN dynamic_thumbnail_path TEXT'
            );
            await addColumnIfMissing(
                'dynamic_safe_thumbnail_path',
                'ALTER TABLE collections ADD COLUMN dynamic_safe_thumbnail_path TEXT'
            );
            await addColumnIfMissing(
                'dynamic_thumbnail_is_sensitive',
                'ALTER TABLE collections ADD COLUMN dynamic_thumbnail_is_sensitive INTEGER'
            );
            await addColumnIfMissing(
                'dynamic_thumbnail_cached_at',
                'ALTER TABLE collections ADD COLUMN dynamic_thumbnail_cached_at INTEGER'
            );
            await addColumnIfMissing(
                'dynamic_count',
                'ALTER TABLE collections ADD COLUMN dynamic_count INTEGER'
            );
        } catch (e) {
            console.error('[DB] Failed to ensure collection schema', e);
        }
    });
};

export const upsertCollection = async (collection: Partial<Collection> & { id: string, name: string }) => {
    if (isBrowserMockMode()) {
        upsertBrowserMockCollection(collection);
        return;
    }

    return dbMutex.dispatch(async () => {
        const db = await getDb();
        const now = Date.now();
        const filterState = collection.filters
            ? JSON.stringify(createDefaultFilters(collection.filters))
            : null;

        try {
            await db.execute(
                `INSERT INTO collections (id, name, color, is_archived, is_pinned, created_at, filter_state, manual_exclusions, custom_thumbnail, source, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                color = excluded.color,
                is_archived = excluded.is_archived,
                is_pinned = excluded.is_pinned,
                created_at = excluded.created_at,
                dynamic_count = CASE
                    WHEN collections.filter_state IS excluded.filter_state
                     AND collections.manual_exclusions IS excluded.manual_exclusions
                    THEN collections.dynamic_count
                    ELSE NULL
                END,
                filter_state = excluded.filter_state,
                manual_exclusions = excluded.manual_exclusions,
                custom_thumbnail = excluded.custom_thumbnail,
                source = excluded.source,
                updated_at = CASE
                    WHEN collections.filter_state IS excluded.filter_state
                     AND collections.manual_exclusions IS excluded.manual_exclusions
                    THEN excluded.updated_at
                    ELSE MAX(COALESCE(collections.updated_at, 0) + 1, ?)
                END`,
                [
                    collection.id,
                    collection.name,
                    collection.color || null,
                    collection.isArchived ? 1 : 0,
                    collection.isPinned ? 1 : 0,
                    collection.createdAt || now,
                    filterState,
                    collection.manualExclusions ? JSON.stringify(collection.manualExclusions) : null,
                    collection.customThumbnail || null,
                    collection.source || 'ambit',
                    collection.updatedAt || now,
                    now
                ]
            );
        } catch (e) {
            console.error(`[DB] Failed to upsert collection ${collection.id}`, e);
            throw e;
        }
    });
};

export const setCollectionCustomThumbnail = async (collectionId: string, imageId: string | null) => {
    if (isBrowserMockMode()) {
        const collection = getBrowserMockCollections().find((item) => item.id === collectionId);
        if (!collection) throw new Error(`Collection not found: ${collectionId}`);
        upsertBrowserMockCollection({ ...collection, customThumbnail: imageId || undefined });
        return;
    }

    return dbMutex.dispatch(async () => {
        const db = await getDb();
        await db.execute(
            'UPDATE collections SET custom_thumbnail = ?, updated_at = ? WHERE id = ?',
            [imageId, Date.now(), collectionId]
        );
        if (imageId === null) {
            await clearDynamicThumbnailCacheForCollections(db, [collectionId]);
        }
    });
};

export const deleteCollectionFromDb = async (id: string) => {
    if (isBrowserMockMode()) {
        deleteBrowserMockCollection(id);
        return;
    }

    const db = await getDb();
    await db.execute('DELETE FROM collections WHERE id = ?', [id]);
};

export const addImagesToCollection = async (collectionId: string, imageIds: string[]) => {
    if (isBrowserMockMode()) {
        addBrowserMockImagesToCollection(collectionId, imageIds);
        return;
    }

    return dbMutex.dispatch(async () => {
        const db = await getDb();
        const now = Date.now();
        for (const imgId of imageIds) {
            await db.execute(
                'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
                [collectionId, normalizePath(imgId)]
            );
        }
        // Update collection timestamp
        await db.execute('UPDATE collections SET updated_at = ? WHERE id = ?', [now, collectionId]);
        await clearDynamicThumbnailCacheForCollections(db, [collectionId]);
    });
};

export const removeImagesFromCollection = async (collectionId: string, imageIds: string[]) => {
    if (isBrowserMockMode()) {
        removeBrowserMockImagesFromCollection(collectionId, imageIds);
        return;
    }

    const db = await getDb();
    const placeholders = imageIds.map(() => '?').join(',');
    await db.execute(
        `DELETE FROM collection_images WHERE collection_id = ? AND image_id IN (${placeholders})`,
        [collectionId, ...imageIds.map(normalizePath)]
    );
    // Update collection timestamp
    await db.execute('UPDATE collections SET updated_at = ? WHERE id = ?', [Date.now(), collectionId]);
    await clearDynamicThumbnailCacheForCollections(db, [collectionId]);
};

export const getAllCollectionsWithStats = async (options: CollectionStatsOptions = {}): Promise<Collection[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockCollections();
    }

    const includeThumbnails = options.includeThumbnails !== false;
    const startedAt = nowMs();
    const db = await getDb();

    // Get all collections
    const collections = await db.select<DbCollection[]>('SELECT * FROM collections');

    // Get counts from junction table
    const counts = await db.select<{ collection_id: string, count: number }[]>(
        'SELECT collection_id, COUNT(*) as count FROM collection_images GROUP BY collection_id'
    );
    const countMap = new Map(counts.map(c => [c.collection_id, c.count]));

    let mappedCollections: Collection[] = collections.map(c => {
        const filters = parsePersistedCollectionFilters(c.filter_state);
        const collection: Collection = {
            id: c.id,
            name: c.name,
            color: c.color,
            isArchived: !!c.is_archived,
            isPinned: !!c.is_pinned,
            createdAt: c.created_at,
            updatedAt: c.updated_at || c.created_at, // Fallback to created_at if updated_at is null
            count: filters ? c.dynamic_count ?? undefined : countMap.get(c.id) || 0,
            imageIds: [],
            customThumbnail: c.custom_thumbnail,
            filters,
            manualExclusions: c.manual_exclusions ? JSON.parse(c.manual_exclusions) : undefined,
            source: c.source
        };
        const cachedThumbnail = getCachedDynamicThumbnailSummary(c);
        return cachedThumbnail ? { ...collection, ...cachedThumbnail } : collection;
    });

    if (includeThumbnails) {
        const thumbnailStartedAt = nowMs();
        const thumbnailInputs = mappedCollections
            .filter(collection => {
                if (collection.customThumbnail) return true;
                if (collection.filters || collection.thumbnail) return false;

                return collection.count! > 0;
            })
            .map(collection => ({
                id: collection.id,
                custom_thumbnail: collection.customThumbnail ?? null
            }));
        const { summaries, cacheUpdates } = await buildCollectionThumbnailSummaries(db, thumbnailInputs);
        await writeDynamicThumbnailCache(db, cacheUpdates);
        mappedCollections = mappedCollections.map((collection) => ({
            ...collection,
            ...summaries[collection.id]
        }));
        logStartupDuration('collection thumbnail hydration', thumbnailStartedAt);
    }

    logStartupDuration('collection load', startedAt);
    return mappedCollections;
};

export const getCollectionThumbnailSummaries = async (
    collections: Collection[]
): Promise<Record<string, CollectionThumbnailSummary>> => {
    if (isBrowserMockMode()) {
        const mockCollections = new Map(getBrowserMockCollections().map((collection) => [collection.id, collection]));
        return Object.fromEntries(collections.map((collection) => {
            const match = mockCollections.get(collection.id) ?? collection;
            return [collection.id, {
                thumbnail: match.thumbnail,
                safeThumbnail: match.safeThumbnail,
                thumbnailIsSensitive: match.thumbnailIsSensitive,
                thumbnailSourceKind: match.thumbnailSourceKind
            }];
        }));
    }

    if (collections.length === 0) return {};

    const db = await getDb();
    return timeDbCall(
        'collectionThumbnails',
        `${collections.length} collections`,
        async () => {
            const { summaries, cacheUpdates } = await buildCollectionThumbnailSummaries(
                db,
                collections.map((collection) => ({
                    id: collection.id,
                    custom_thumbnail: collection.customThumbnail ?? null
                }))
            );
            await writeDynamicThumbnailCache(db, cacheUpdates);
            return summaries;
        }
    );
};

/**
 * Lazily calculate smart collection counts without blocking the main collection load.
 * Returns a map of collectionId -> count for smart collections only.
 */
export const getSmartCollectionSummaries = async (
    smartCollections: Collection[],
    options: SmartCollectionSummaryOptions = {}
): Promise<Record<string, SmartCollectionSummary>> => {
    const includeThumbnails = options.includeThumbnails !== false;

    if (isBrowserMockMode()) {
        const collections = getBrowserMockCollections();
        return Object.fromEntries(
            smartCollections.map((collection) => {
                const match = collections.find((item) => item.id === collection.id);
                return [collection.id, {
                    count: match?.count ?? 0,
                    ...(includeThumbnails ? {
                        thumbnail: match?.thumbnail,
                        safeThumbnail: match?.safeThumbnail,
                        thumbnailIsSensitive: match?.thumbnailIsSensitive,
                    } : {}),
                    thumbnailSourceKind: 'dynamic' as const
                }];
            })
        );
    }

    if (smartCollections.length === 0) return {};

    const db = await getDb();
    const summaries: Record<string, SmartCollectionSummary> = {};
    const customThumbnailById = new Map(
        smartCollections.map(collection => [collection.id, collection.customThumbnail])
    );
    const cacheUpdates: DynamicThumbnailCacheUpdate[] = [];

    try {
        const queries = smartCollections.map(c => {
            const statsFilters: FilterState = {
                collectionId: c.id,
                dateRange: 'all',
                favoritesOnly: false,
                pinnedOnly: false,
                models: [],
                tools: [],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                samplers: [],
                generationTypes: [],
                searchQuery: ''
            };
            const { where, params } = buildSqlWhereClause(statsFilters, false, 'blur', [], [c as Collection]);
            return { id: c.id, where, params };
        });

        // SQLite UNION ALL approach for batched counts - using denormalized columns, no JOIN needed
        const unionSql = queries.map(q =>
            `SELECT ? as id, (SELECT COUNT(*) FROM images ${q.where}) as count`
        ).join(' UNION ALL ');
        const unionParams = queries.flatMap(q => [q.id, ...q.params]);

        const res = await timeDbCall(
            'smartCollectionSummaries.counts',
            `${smartCollections.length} collections`,
            () => db.select<{ id: string, count: number }[]>(unionSql, unionParams)
        );
        res.forEach(row => { summaries[row.id] = { count: row.count, thumbnailSourceKind: 'dynamic' }; });

        if (!includeThumbnails) return summaries;

        for (const query of queries) {
            const normalRows = await timeDbCall(
                'smartCollectionSummaries.thumbnail',
                query.id,
                () => db.select<{ thumbnail_path?: string | null; privacy_hidden?: number | null }[]>(
                `SELECT thumbnail_path, privacy_hidden
                 FROM images
                 ${query.where}
                 AND thumbnail_path IS NOT NULL
                 AND thumbnail_path != ''
                 ORDER BY is_pinned DESC, timestamp DESC
                 LIMIT 1`,
                query.params
                )
            );
            const safeRows = await timeDbCall(
                'smartCollectionSummaries.safeThumbnail',
                query.id,
                () => db.select<{ thumbnail_path?: string | null }[]>(
                `SELECT thumbnail_path
                 FROM images
                 ${query.where}
                 AND privacy_hidden = 0
                 AND thumbnail_path IS NOT NULL
                 AND thumbnail_path != ''
                 ORDER BY is_pinned DESC, timestamp DESC
                 LIMIT 1`,
                query.params
                )
            );

            const normal = normalRows[0];
            const safe = safeRows[0];
            const thumbnailPath = normal?.thumbnail_path || null;
            summaries[query.id] = {
                ...summaries[query.id],
                thumbnail: toDisplayUrl(thumbnailPath),
                safeThumbnail: toDisplayUrl(safe?.thumbnail_path),
                thumbnailIsSensitive: normal?.privacy_hidden === 1,
                thumbnailSourceKind: 'dynamic'
            };

            if (!customThumbnailById.get(query.id)) {
                cacheUpdates.push({
                    collectionId: query.id,
                    thumbnailPath,
                    safeThumbnailPath: thumbnailPath ? safe?.thumbnail_path || null : null,
                    thumbnailIsSensitive: thumbnailPath ? normal?.privacy_hidden === 1 : null
                });
            }
        }

        await writeDynamicThumbnailCache(db, cacheUpdates);
    } catch (e) {
        console.error("[DB] Failed smart collection summaries", e);
    }

    return summaries;
};

export const getSmartCollectionCounts = async (smartCollections: Collection[]): Promise<Record<string, number>> => {
    const summaries = await getSmartCollectionSummaries(smartCollections);
    return Object.fromEntries(
        Object.entries(summaries).map(([id, summary]) => [id, summary.count])
    );
};

export const getCollectionThumbnail = async (imageIds: string[]): Promise<string | undefined> => {
    if (isBrowserMockMode()) {
        const imageIdSet = new Set(imageIds);
        return getBrowserMockImages().find(image => imageIdSet.has(image.id))?.thumbnailUrl;
    }

    if (!imageIds || imageIds.length === 0) return undefined;
    const db = await getDb();

    try {
        const BATCH_SIZE = 900;
        const normalizedIds = imageIds.map(normalizePath);

        let candidates: Array<{ path: string | null, timestamp: number, is_pinned: number }> = [];

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

            const res = await db.select<Array<{ path: string | null; timestamp: number | null; is_pinned: number | null }>>(query, [...batch, ...batch]);
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

export const getSmartCollectionThumbnail = async (whereClause: string, params: unknown[]): Promise<string | undefined> => {
    if (isBrowserMockMode()) {
        return getBrowserMockCollections().find(collection => collection.filters)?.thumbnail;
    }

    const db = await getDb();
    try {
        const query = `
            SELECT images.thumbnail_path, images.timestamp, images.is_pinned
            FROM images
            LEFT JOIN models m ON json_extract(images.metadata_json, '$.modelHash') = m.hash
            ${whereClause.replace(/WHERE /i, 'WHERE images.')}
            ORDER BY images.is_pinned DESC, images.timestamp DESC
            LIMIT 1
        `;
        const res = await db.select<Array<{ thumbnail_path: string | null; timestamp: number | null; is_pinned: number | null }>>(query, params);
        if (res && res.length > 0) {
            const rawPath = res[0].thumbnail_path;
            if (!rawPath) return undefined;
            return (rawPath.startsWith('http') || rawPath.startsWith('data:') || rawPath.startsWith('blob:'))
                ? rawPath
                : convertFileSrc(normalizePath(rawPath));
        }
        return undefined;
    } catch (e) {
        console.error('[DB] Fail smart thumb', e);
        return undefined;
    }
};

/**
 * Targeted fetch for collection memberships of a single image.
 * Used for Metadata Sidebar to avoid loading thousands of IDs.
 */
export const getCollectionsForImage = async (imageId: string): Promise<string[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockCollections()
            .filter(collection => collection.imageIds.includes(imageId))
            .map(collection => collection.id);
    }

    const db = await getDb();
    const res = await db.select<{ collection_id: string }[]>(
        'SELECT collection_id FROM collection_images WHERE image_id = ?',
        [imageId]
    );
    return res.map(r => r.collection_id);
};

/**
 * Get all image IDs for a specific collection.
 * Used for Export and other batch operations.
 */
export const getCollectionImageIds = async (collectionId: string): Promise<string[]> => {
    if (isBrowserMockMode()) {
        return getBrowserMockCollections().find(collection => collection.id === collectionId)?.imageIds ?? [];
    }

    const db = await getDb();
    try {
        const res = await db.select<{ image_id: string }[]>(
            'SELECT image_id FROM collection_images WHERE collection_id = ?',
            [collectionId]
        );
        return res.map(r => r.image_id);
    } catch (e) {
        console.error('[DB] Failed to get collection image IDs', e);
        return [];
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

export const purgeInvokeCollections = async () => {
    if (isBrowserMockMode()) return;

    await dbMutex.dispatch(async () => {
        const db = await getDb();
        console.log('[DB] Purging InvokeAI collections...');
        await db.execute("DELETE FROM collections WHERE source = 'invoke'");
        console.log('[DB] InvokeAI collections purged.');
    });
};
