import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterState, type Collection } from '../../../types';
import { createDefaultFilters } from '../../../utils/filterState';

const dbMocks = vi.hoisted(() => ({
    select: vi.fn(),
    execute: vi.fn(),
    getDb: vi.fn(),
    dispatch: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

const browserMocks = vi.hoisted(() => ({
    isBrowserMockMode: vi.fn(),
    addBrowserMockImagesToCollection: vi.fn(),
    deleteBrowserMockCollection: vi.fn(),
    getBrowserMockCollections: vi.fn(),
    getBrowserMockImages: vi.fn(),
    removeBrowserMockImagesFromCollection: vi.fn(),
    upsertBrowserMockCollection: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../runtime', () => ({
    isBrowserMockMode: browserMocks.isBrowserMockMode,
}));

vi.mock('../../browserMockData', () => ({
    addBrowserMockImagesToCollection: browserMocks.addBrowserMockImagesToCollection,
    deleteBrowserMockCollection: browserMocks.deleteBrowserMockCollection,
    getBrowserMockCollections: browserMocks.getBrowserMockCollections,
    getBrowserMockImages: browserMocks.getBrowserMockImages,
    removeBrowserMockImagesFromCollection: browserMocks.removeBrowserMockImagesFromCollection,
    upsertBrowserMockCollection: browserMocks.upsertBrowserMockCollection,
}));

vi.mock('../connection', () => ({
    dbMutex: {
        dispatch: dbMocks.dispatch,
    },
    getDb: dbMocks.getDb,
}));

const makeCollectionRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'c1',
    name: 'Collection',
    color: null,
    is_archived: 0,
    is_pinned: 0,
    created_at: 1,
    updated_at: 1,
    custom_thumbnail: null,
    dynamic_thumbnail_path: null,
    dynamic_safe_thumbnail_path: null,
    dynamic_thumbnail_is_sensitive: null,
    dynamic_thumbnail_cached_at: null,
    filter_state: null,
    manual_exclusions: null,
    source: 'ambit',
    ...overrides
});

const makeCollection = (overrides: Partial<Collection> & Pick<Collection, 'id'>): Collection => ({
    id: overrides.id,
    name: overrides.name ?? 'Collection',
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt,
    source: overrides.source ?? 'ambit',
    count: overrides.count ?? 0,
    imageIds: overrides.imageIds ?? [],
    color: overrides.color,
    isArchived: overrides.isArchived,
    isPinned: overrides.isPinned,
    filters: overrides.filters,
    manualExclusions: overrides.manualExclusions,
    customThumbnail: overrides.customThumbnail,
    thumbnail: overrides.thumbnail,
    safeThumbnail: overrides.safeThumbnail,
    thumbnailIsSensitive: overrides.thumbnailIsSensitive,
    thumbnailSourceKind: overrides.thumbnailSourceKind,
});

const makeFilters = (overrides: Partial<FilterState> = {}): FilterState => createDefaultFilters(overrides);

const resetRepoMocks = () => {
    vi.clearAllMocks();
    vi.resetModules();
    dbMocks.select.mockReset();
    dbMocks.execute.mockReset();
    dbMocks.getDb.mockReset();
    dbMocks.dispatch.mockReset();
    dbMocks.dispatch.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    browserMocks.isBrowserMockMode.mockReset();
    browserMocks.getBrowserMockCollections.mockReset();
    browserMocks.getBrowserMockImages.mockReset();
    browserMocks.isBrowserMockMode.mockReturnValue(false);
    browserMocks.getBrowserMockCollections.mockReturnValue([]);
    browserMocks.getBrowserMockImages.mockReturnValue([]);
    dbMocks.execute.mockResolvedValue(undefined);
    dbMocks.getDb.mockResolvedValue({ select: dbMocks.select, execute: dbMocks.execute });
};

describe('collectionRepo filter normalization', () => {
    beforeEach(() => {
        resetRepoMocks();
    });

    it('normalizes legacy persisted collection filters with current defaults', async () => {
        const { parsePersistedCollectionFilters } = await import('../collectionRepo');
        const filters = parsePersistedCollectionFilters(JSON.stringify({
            searchQuery: 'portrait',
            loras: ['detail'],
        }));

        expect(filters).toMatchObject({
            searchQuery: 'portrait',
            loras: ['detail'],
            controlNets: [],
            ipAdapters: [],
            pinnedOnly: false,
            showIntermediates: false,
            showGrids: false,
            collectionId: null,
        });
    });

    it('serializes smart collection filters with current defaults', async () => {
        const { parsePersistedCollectionFilters, upsertCollection } = await import('../collectionRepo');

        await upsertCollection({
            id: 'smart-a',
            name: 'Smart A',
            filters: { searchQuery: 'portrait' } as unknown as FilterState,
        });

        const calls = dbMocks.execute.mock.calls as Array<[string, unknown[]]>;
        const params = calls[0][1];
        const serializedFilters = params[6];

        expect(typeof serializedFilters).toBe('string');
        const filters = parsePersistedCollectionFilters(serializedFilters as string);
        expect(filters?.searchQuery).toBe('portrait');
        expect(filters?.controlNets).toEqual([]);
        expect(filters?.ipAdapters).toEqual([]);
        expect(filters?.pinnedOnly).toBe(false);

        await upsertCollection({
            id: 'flags-a',
            name: 'Flags',
            isArchived: true,
            isPinned: true,
            manualExclusions: ['image-a'],
        });
        const flagParams = (dbMocks.execute.mock.calls as Array<[string, unknown[]]>)[1][1];
        expect(flagParams[3]).toBe(1);
        expect(flagParams[4]).toBe(1);
        expect(flagParams[7]).toBe('["image-a"]');
    });

    it('backfills missing dynamic thumbnail cache columns from the TypeScript schema guard', async () => {
        dbMocks.select.mockResolvedValue([{ name: 'id' }, { name: 'created_at' }, { name: 'updated_at' }]);

        const { ensureCollectionSchema } = await import('../collectionRepo');
        await ensureCollectionSchema();

        expect(dbMocks.execute).toHaveBeenCalledWith('ALTER TABLE collections ADD COLUMN dynamic_thumbnail_path TEXT');
        expect(dbMocks.execute).toHaveBeenCalledWith('ALTER TABLE collections ADD COLUMN dynamic_safe_thumbnail_path TEXT');
        expect(dbMocks.execute).toHaveBeenCalledWith('ALTER TABLE collections ADD COLUMN dynamic_thumbnail_is_sensitive INTEGER');
        expect(dbMocks.execute).toHaveBeenCalledWith('ALTER TABLE collections ADD COLUMN dynamic_thumbnail_cached_at INTEGER');
    });

    it('adds and backfills updated_at when older collection databases lack it', async () => {
        dbMocks.select.mockResolvedValue([{ name: 'id' }, { name: 'created_at' }]);

        const { ensureCollectionSchema } = await import('../collectionRepo');
        await ensureCollectionSchema();

        expect(dbMocks.execute).toHaveBeenCalledWith('ALTER TABLE collections ADD COLUMN updated_at INTEGER');
        expect(dbMocks.execute).toHaveBeenCalledWith('UPDATE collections SET updated_at = created_at WHERE updated_at IS NULL');
    });

    it('treats duplicate-column schema races as already handled', async () => {
        dbMocks.select.mockResolvedValue([{ name: 'id' }, { name: 'created_at' }]);
        dbMocks.execute.mockRejectedValueOnce(new Error('duplicate column name: updated_at'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { ensureCollectionSchema } = await import('../collectionRepo');
        await ensureCollectionSchema();

        expect(warnSpy).toHaveBeenCalledWith('[DB] Migration raced, updated_at column already exists (handled)');
        expect(dbMocks.execute).toHaveBeenCalledWith('ALTER TABLE collections ADD COLUMN dynamic_thumbnail_path TEXT');
        warnSpy.mockRestore();
    });

    it('logs schema guard failures because startup can continue with older collections', async () => {
        const schemaError = new Error('pragma failed');
        dbMocks.select.mockRejectedValue(schemaError);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { ensureCollectionSchema } = await import('../collectionRepo');
        await ensureCollectionSchema();

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to ensure collection schema', schemaError);
        errorSpy.mockRestore();
    });

    it('logs non-duplicate migration failures from a missing column', async () => {
        const migrationError = new Error('database read-only');
        dbMocks.select.mockResolvedValue([{ name: 'id' }, { name: 'created_at' }]);
        dbMocks.execute.mockRejectedValueOnce(migrationError);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { ensureCollectionSchema } = await import('../collectionRepo');
        await ensureCollectionSchema();

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to ensure collection schema', migrationError);
        errorSpy.mockRestore();
    });

    it('stringifies non-Error schema migration failures', async () => {
        dbMocks.select.mockResolvedValue([{ name: 'id' }, { name: 'created_at' }]);
        dbMocks.execute.mockRejectedValueOnce('database read-only');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { ensureCollectionSchema } = await import('../collectionRepo');

        await ensureCollectionSchema();

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to ensure collection schema', 'database read-only');
        errorSpy.mockRestore();
    });

    it('rethrows collection upsert failures after logging the affected id', async () => {
        const upsertError = new Error('sqlite read-only');
        dbMocks.execute.mockRejectedValue(upsertError);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { upsertCollection } = await import('../collectionRepo');
        await expect(upsertCollection({ id: 'c1', name: 'Collection' })).rejects.toThrow('sqlite read-only');

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to upsert collection c1', upsertError);
        errorSpy.mockRestore();
    });

    it('clears dynamic thumbnail cache after resetting a custom thumbnail', async () => {
        const { setCollectionCustomThumbnail } = await import('../collectionRepo');

        await setCollectionCustomThumbnail('c1', null);

        expect(dbMocks.execute).toHaveBeenCalledWith(
            'UPDATE collections SET custom_thumbnail = ?, updated_at = ? WHERE id = ?',
            [null, expect.any(Number), 'c1']
        );
        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path = NULL'),
            ['c1']
        );
    });

    it('keeps dynamic thumbnail cache when setting a custom thumbnail', async () => {
        const { setCollectionCustomThumbnail } = await import('../collectionRepo');

        await setCollectionCustomThumbnail('c1', 'img-custom');

        expect(dbMocks.execute).toHaveBeenCalledWith(
            'UPDATE collections SET custom_thumbnail = ?, updated_at = ? WHERE id = ?',
            ['img-custom', expect.any(Number), 'c1']
        );
        expect(dbMocks.execute).not.toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path = NULL'),
            expect.anything()
        );
    });
});

describe('collectionRepo thumbnail hydration', () => {
    beforeEach(() => {
        resetRepoMocks();
    });

    it('resolves custom image ids to optimized thumbnail paths without a broad image join', async () => {
        const queries: string[] = [];
        dbMocks.select.mockImplementation(async (query: string) => {
            queries.push(query);
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({ name: 'Custom', custom_thumbnail: 'img1' })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 1 }];
            if (query.includes('ranked_thumbnails')) {
                return [{
                    collection_id: 'c1',
                    dynamic_thumb: 'C:/images/full.png',
                    dynamic_privacy: 1,
                    safe_thumb: 'C:/thumbs/safe.webp'
                }];
            }
            if (query.includes('WHERE id IN')) {
                return [{
                    id: 'img1',
                    path: 'C:/images/full.png',
                    thumb: 'C:/thumbs/img1.webp',
                    privacy_hidden: 0
                }];
            }
            if (query.includes('WHERE path IN')) return [];
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0].thumbnail).toBe('asset://C:/thumbs/img1.webp');
        expect(collections[0].customThumbnail).toBe('img1');
        expect(collections[0].safeThumbnail).toBeUndefined();
        expect(collections[0].thumbnailIsSensitive).toBe(false);
        expect(collections[0].thumbnailSourceKind).toBe('customImage');
        expect(queries.join('\n')).not.toContain('LEFT JOIN images ci');
        expect(queries.join('\n')).not.toContain('OR ci.path');
    });

    it('can load base collection rows without blocking on thumbnail hydration', async () => {
        const queries: string[] = [];
        dbMocks.select.mockImplementation(async (query: string) => {
            queries.push(query);
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({
                    name: 'Base Only',
                    updated_at: null,
                    manual_exclusions: '["image-a"]',
                })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 3 }];
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats({ includeThumbnails: false });

        expect(collections[0]).toEqual(expect.objectContaining({
            id: 'c1',
            name: 'Base Only',
            count: 3,
            imageIds: []
        }));
        expect(collections[0].updatedAt).toBe(1);
        expect(collections[0].manualExclusions).toEqual(['image-a']);
        expect(collections[0].thumbnail).toBeUndefined();
        expect(queries.join('\n')).not.toContain('ranked_thumbnails');
        expect(queries.join('\n')).not.toContain('WHERE id IN');
        expect(queries.join('\n')).not.toContain('WHERE path IN');
    });

    it('maps cached dynamic thumbnails without running thumbnail hydration queries when thumbnails are included', async () => {
        const queries: string[] = [];
        dbMocks.select.mockImplementation(async (query: string) => {
            queries.push(query);
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({
                    name: 'Cached',
                    dynamic_thumbnail_path: 'C:/thumbs/cached.webp',
                    dynamic_safe_thumbnail_path: 'C:/thumbs/cached-safe.webp',
                    dynamic_thumbnail_is_sensitive: 1
                })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 3 }];
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0]).toEqual(expect.objectContaining({
            thumbnail: 'asset://C:/thumbs/cached.webp',
            safeThumbnail: 'asset://C:/thumbs/cached-safe.webp',
            thumbnailIsSensitive: true,
            thumbnailSourceKind: 'dynamic'
        }));
        expect(queries.join('\n')).not.toContain('ranked_thumbnails');
        expect(dbMocks.execute).not.toHaveBeenCalled();
    });

    it('keeps cached smart thumbnails during full collection reloads until smart hydration runs', async () => {
        const queries: string[] = [];
        dbMocks.select.mockImplementation(async (query: string) => {
            queries.push(query);
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({
                    id: 'smart-1',
                    name: 'Cached Smart',
                    filter_state: JSON.stringify({ dateRange: 'today' }),
                    dynamic_thumbnail_path: 'C:/thumbs/cached-smart.webp',
                    dynamic_safe_thumbnail_path: 'C:/thumbs/cached-smart-safe.webp',
                    dynamic_thumbnail_is_sensitive: 0
                })];
            }
            if (query.includes('COUNT(*) as count')) return [];
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0]).toEqual(expect.objectContaining({
            id: 'smart-1',
            count: 0,
            thumbnail: 'asset://C:/thumbs/cached-smart.webp',
            safeThumbnail: 'asset://C:/thumbs/cached-smart-safe.webp',
            thumbnailIsSensitive: false,
            thumbnailSourceKind: 'dynamic'
        }));
        expect(queries.join('\n')).not.toContain('ranked_thumbnails');
        expect(dbMocks.execute).not.toHaveBeenCalled();
    });

    it('does not display a cached dynamic thumbnail over a custom thumbnail', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({
                    custom_thumbnail: 'img-custom',
                    dynamic_thumbnail_path: 'C:/thumbs/cached.webp',
                    dynamic_safe_thumbnail_path: 'C:/thumbs/cached-safe.webp',
                    dynamic_thumbnail_is_sensitive: 1
                })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 1 }];
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats({ includeThumbnails: false });

        expect(collections[0].customThumbnail).toBe('img-custom');
        expect(collections[0].thumbnail).toBeUndefined();
        expect(collections[0].safeThumbnail).toBeUndefined();
        expect(collections[0].thumbnailSourceKind).toBeUndefined();
    });

    it('resolves custom image paths through the targeted path lookup', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({ custom_thumbnail: 'C:/images/source.png' })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 1 }];
            if (query.includes('ranked_thumbnails')) {
                return [{ collection_id: 'c1', dynamic_thumb: null, dynamic_privacy: null, safe_thumb: null }];
            }
            if (query.includes('WHERE id IN')) return [];
            if (query.includes('WHERE path IN')) {
                return [{
                    id: 'img-path',
                    path: 'C:/images/source.png',
                    thumb: 'C:/thumbs/source.webp',
                    privacy_hidden: 1
                }];
            }
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0].thumbnail).toBe('asset://C:/thumbs/source.webp');
        expect(collections[0].thumbnailIsSensitive).toBe(true);
        expect(collections[0].thumbnailSourceKind).toBe('customImage');
    });

    it('keeps legacy raw custom thumbnail urls when no image row matches', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({ custom_thumbnail: 'https://example.com/thumb.webp' })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 1 }];
            if (query.includes('ranked_thumbnails')) {
                return [{ collection_id: 'c1', dynamic_thumb: 'C:/thumbs/dynamic.webp', dynamic_privacy: 1, safe_thumb: null }];
            }
            if (query.includes('WHERE id IN') || query.includes('WHERE path IN')) return [];
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0].thumbnail).toBe('https://example.com/thumb.webp');
        expect(collections[0].safeThumbnail).toBeUndefined();
        expect(collections[0].thumbnailIsSensitive).toBe(false);
        expect(collections[0].thumbnailSourceKind).toBe('customPath');
    });

    it('falls back to the custom image id when its optimized thumbnail is empty', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('SELECT * FROM collections')) return [makeCollectionRow({ custom_thumbnail: 'img-empty' })];
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 1 }];
            if (query.includes('ranked_thumbnails')) return [];
            if (query.includes('WHERE id IN')) {
                return [{ id: 'img-empty', path: 'C:/images/empty.png', thumb: '', privacy_hidden: 0 }];
            }
            return [];
        });
        const { getAllCollectionsWithStats } = await import('../collectionRepo');

        const collections = await getAllCollectionsWithStats();

        expect(collections[0].thumbnail).toBe('asset://img-empty');
    });

    it('marks dynamic thumbnails sensitive, exposes a safe alternative, and orders pinned first', async () => {
        let dynamicQuery = '';
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('SELECT * FROM collections')) return [makeCollectionRow()];
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 2 }];
            if (query.includes('ranked_thumbnails')) {
                dynamicQuery = query;
                return [{
                    collection_id: 'c1',
                    dynamic_thumb: 'C:/thumbs/unsafe.webp',
                    dynamic_privacy: 1,
                    safe_thumb: 'C:/thumbs/safe.webp'
                }];
            }
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0].thumbnail).toBe('asset://C:/thumbs/unsafe.webp');
        expect(collections[0].safeThumbnail).toBe('asset://C:/thumbs/safe.webp');
        expect(collections[0].thumbnailIsSensitive).toBe(true);
        expect(collections[0].thumbnailSourceKind).toBe('dynamic');
        expect(dynamicQuery).toContain('WITH ranked_thumbnails');
        expect(dynamicQuery.match(/ORDER BY i\.is_pinned DESC, i\.timestamp DESC/g)?.length).toBeGreaterThanOrEqual(2);
        expect(dynamicQuery).toContain('privacy_hidden = 0 AND privacy_rank = 1');
        expect(dynamicQuery).not.toContain('SELECT i.thumbnail_path');
    });

    it('writes raw dynamic thumbnail paths to the collection cache after static hydration', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('ranked_thumbnails')) {
                return [{
                    collection_id: 'c1',
                    dynamic_thumb: 'C:/thumbs/unsafe.webp',
                    dynamic_privacy: 1,
                    safe_thumb: null
                }];
            }
            return [];
        });

        const { getCollectionThumbnailSummaries } = await import('../collectionRepo');
        await getCollectionThumbnailSummaries([{
            id: 'c1',
            name: 'Collection',
            createdAt: 1,
            source: 'ambit',
            count: 1,
            imageIds: []
        }]);

        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path'),
            ['C:/thumbs/unsafe.webp', null, 1, expect.any(Number), 'c1']
        );
    });

    it('clears the dynamic thumbnail cache when static hydration finds no thumbnail', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('ranked_thumbnails')) {
                return [{
                    collection_id: 'c1',
                    dynamic_thumb: null,
                    dynamic_privacy: null,
                    safe_thumb: null
                }];
            }
            return [];
        });

        const { getCollectionThumbnailSummaries } = await import('../collectionRepo');
        await getCollectionThumbnailSummaries([{
            id: 'c1',
            name: 'Collection',
            createdAt: 1,
            source: 'ambit',
            count: 1,
            imageIds: []
        }]);

        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path'),
            [null, null, null, null, 'c1']
        );
    });

    it('writes raw dynamic thumbnail paths to the collection cache after smart summary hydration', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('COUNT(*) FROM images')) return [{ id: 'smart-1', count: 2 }];
            if (query.includes('SELECT thumbnail_path, privacy_hidden')) {
                return [{ thumbnail_path: 'C:/thumbs/smart.webp', privacy_hidden: 0 }];
            }
            if (query.includes('AND privacy_hidden = 0')) {
                return [];
            }
            return [];
        });

        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        await getSmartCollectionSummaries([{
            id: 'smart-1',
            name: 'Smart',
            createdAt: 1,
            source: 'ambit',
            count: 0,
            imageIds: [],
            filters: {
                searchQuery: '',
                models: [],
                tools: [],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                samplers: [],
                generationTypes: [],
                controlNets: [],
                ipAdapters: [],
                dateRange: 'today',
                favoritesOnly: false,
                collectionId: null
            } as FilterState
        }]);

        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path'),
            ['C:/thumbs/smart.webp', null, 0, expect.any(Number), 'smart-1']
        );
    });

    it('returns empty smart thumbnail data and skips cache writes for custom thumbnails', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('COUNT(*) FROM images')) {
                return [{ id: 'smart-empty', count: 0 }, { id: 'smart-custom', count: 0 }];
            }
            return [];
        });
        const { getSmartCollectionSummaries } = await import('../collectionRepo');

        const summaries = await getSmartCollectionSummaries([
            makeCollection({ id: 'smart-empty', filters: makeFilters() }),
            makeCollection({ id: 'smart-custom', filters: makeFilters(), customThumbnail: 'img-1' }),
        ]);

        expect(summaries['smart-empty']).toMatchObject({ count: 0, thumbnail: undefined });
        expect(dbMocks.execute).toHaveBeenCalledTimes(1);
    });
});

describe('collectionRepo membership helpers', () => {
    beforeEach(() => {
        resetRepoMocks();
    });

    it('drops malformed persisted smart filters instead of throwing during collection load', async () => {
        const { parsePersistedCollectionFilters } = await import('../collectionRepo');

        expect(parsePersistedCollectionFilters('{not-json')).toBeUndefined();
        expect(parsePersistedCollectionFilters('[]')).toBeUndefined();
        expect(parsePersistedCollectionFilters(null)).toBeUndefined();
    });

    it('uses browser mock collections and images without touching the native database', async () => {
        browserMocks.isBrowserMockMode.mockReturnValue(true);
        const smartFilters = makeFilters({ searchQuery: 'portrait' });
        const collections = [
            makeCollection({
                id: 'c1',
                imageIds: ['img-1'],
                thumbnail: 'thumb-c1',
                safeThumbnail: 'safe-c1',
                thumbnailIsSensitive: true,
                thumbnailSourceKind: 'dynamic',
            }),
            makeCollection({
                id: 'smart',
                count: 7,
                imageIds: [],
                filters: smartFilters,
                thumbnail: 'thumb-smart',
                safeThumbnail: 'safe-smart',
                thumbnailIsSensitive: false,
                thumbnailSourceKind: 'dynamic',
            }),
            makeCollection({ id: 'empty', count: 0, imageIds: [] }),
        ];
        browserMocks.getBrowserMockCollections.mockReturnValue(collections);
        browserMocks.getBrowserMockImages.mockReturnValue([
            { id: 'img-1', thumbnailUrl: 'thumb-img-1' },
        ]);

        const {
            clearCollectionThumbnailCacheForCollections,
            clearCollectionThumbnailCacheForImages,
            clearAllCollectionThumbnailCaches,
            ensureCollectionSchema,
            upsertCollection,
            setCollectionCustomThumbnail,
            deleteCollectionFromDb,
            addImagesToCollection,
            removeImagesFromCollection,
            getAllCollectionsWithStats,
            getCollectionThumbnailSummaries,
            getSmartCollectionSummaries,
            getSmartCollectionCounts,
            getCollectionThumbnail,
            getSmartCollectionThumbnail,
            getCollectionsForImage,
            getCollectionImageIds,
            hydrateCollections,
            purgeInvokeCollections,
        } = await import('../collectionRepo');

        await expect(clearCollectionThumbnailCacheForCollections(['c1'])).resolves.toBeUndefined();
        await expect(clearCollectionThumbnailCacheForImages(['img-1'])).resolves.toBeUndefined();
        await expect(clearAllCollectionThumbnailCaches()).resolves.toBeUndefined();
        await expect(ensureCollectionSchema()).resolves.toBeUndefined();
        await expect(upsertCollection({ id: 'new', name: 'New' })).resolves.toBeUndefined();
        await expect(setCollectionCustomThumbnail('c1', 'img-1')).resolves.toBeUndefined();
        await expect(setCollectionCustomThumbnail('c1', null)).resolves.toBeUndefined();
        await expect(setCollectionCustomThumbnail('missing', 'img-1')).rejects.toThrow('Collection not found: missing');
        await expect(deleteCollectionFromDb('c1')).resolves.toBeUndefined();
        await expect(addImagesToCollection('c1', ['img-2'])).resolves.toBeUndefined();
        await expect(removeImagesFromCollection('c1', ['img-1'])).resolves.toBeUndefined();
        await expect(getAllCollectionsWithStats()).resolves.toEqual(collections);
        await expect(getCollectionThumbnailSummaries([
            makeCollection({ id: 'c1' }),
            makeCollection({ id: 'fallback', thumbnail: 'fallback-thumb' }),
        ])).resolves.toEqual({
            c1: {
                thumbnail: 'thumb-c1',
                safeThumbnail: 'safe-c1',
                thumbnailIsSensitive: true,
                thumbnailSourceKind: 'dynamic',
            },
            fallback: {
                thumbnail: 'fallback-thumb',
                safeThumbnail: undefined,
                thumbnailIsSensitive: undefined,
                thumbnailSourceKind: undefined,
            },
        });
        await expect(getSmartCollectionSummaries([
            makeCollection({ id: 'smart', filters: smartFilters }),
            makeCollection({ id: 'unknown', filters: smartFilters }),
        ], { includeThumbnails: false })).resolves.toEqual({
            smart: { count: 7, thumbnailSourceKind: 'dynamic' },
            unknown: { count: 0, thumbnailSourceKind: 'dynamic' },
        });
        await expect(getSmartCollectionCounts([makeCollection({ id: 'smart', filters: smartFilters })])).resolves.toEqual({ smart: 7 });
        await expect(getCollectionThumbnail(['img-1'])).resolves.toBe('thumb-img-1');
        await expect(getSmartCollectionThumbnail('WHERE model_name = ?', ['model-a'])).resolves.toBe('thumb-smart');
        await expect(getCollectionsForImage('img-1')).resolves.toEqual(['c1']);
        await expect(getCollectionImageIds('c1')).resolves.toEqual(['img-1']);
        await expect(getCollectionImageIds('missing')).resolves.toEqual([]);
        await expect(hydrateCollections()).resolves.toEqual({
            c1: { count: 0, thumbnail: 'thumb-c1' },
            smart: { count: 7, thumbnail: 'thumb-smart' },
            empty: { count: 0, thumbnail: '' },
        });
        await expect(purgeInvokeCollections()).resolves.toBeUndefined();

        expect(browserMocks.upsertBrowserMockCollection).toHaveBeenCalledWith({ id: 'new', name: 'New' });
        expect(browserMocks.upsertBrowserMockCollection).toHaveBeenCalledWith({
            ...collections[0],
            customThumbnail: 'img-1',
        });
        expect(browserMocks.deleteBrowserMockCollection).toHaveBeenCalledWith('c1');
        expect(browserMocks.addBrowserMockImagesToCollection).toHaveBeenCalledWith('c1', ['img-2']);
        expect(browserMocks.removeBrowserMockImagesFromCollection).toHaveBeenCalledWith('c1', ['img-1']);
        expect(dbMocks.getDb).not.toHaveBeenCalled();
    });

    it('clears dynamic thumbnail caches for collections containing changed image ids', async () => {
        dbMocks.select.mockResolvedValue([
            { collection_id: 'c1' },
            { collection_id: 'c2' },
        ]);

        const { clearCollectionThumbnailCacheForImages } = await import('../collectionRepo');
        await clearCollectionThumbnailCacheForImages(['C:\\images\\a.png', 'C:/images/a.png']);

        expect(dbMocks.select).toHaveBeenCalledWith(
            expect.stringContaining('FROM collection_images'),
            ['C:/images/a.png']
        );
        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path = NULL'),
            ['c1', 'c2']
        );
    });

    it('skips thumbnail cache clearing when there are no affected collections or images', async () => {
        const {
            clearCollectionThumbnailCacheForCollections,
            clearCollectionThumbnailCacheForImages,
        } = await import('../collectionRepo');

        await clearCollectionThumbnailCacheForCollections([]);
        await clearCollectionThumbnailCacheForImages([]);

        expect(dbMocks.getDb).not.toHaveBeenCalled();
    });

    it('clears selected and all native collection thumbnail caches', async () => {
        const {
            clearAllCollectionThumbnailCaches,
            clearCollectionThumbnailCacheForCollections,
            deleteCollectionFromDb,
        } = await import('../collectionRepo');

        await clearCollectionThumbnailCacheForCollections(['']);
        expect(dbMocks.execute).not.toHaveBeenCalled();
        await clearCollectionThumbnailCacheForCollections(['c1', '', 'c1']);
        await clearAllCollectionThumbnailCaches();
        await deleteCollectionFromDb('c1');

        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('WHERE id IN (?)'),
            ['c1']
        );
        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining("WHERE custom_thumbnail IS NULL OR custom_thumbnail = ''")
        );
        expect(dbMocks.execute).toHaveBeenCalledWith('DELETE FROM collections WHERE id = ?', ['c1']);
    });

    it('skips cache SQL in browser mock mode', async () => {
        browserMocks.isBrowserMockMode.mockReturnValue(true);
        const {
            clearAllCollectionThumbnailCaches,
            clearCollectionThumbnailCacheForCollections,
            clearCollectionThumbnailCacheForImages,
        } = await import('../collectionRepo');

        await clearCollectionThumbnailCacheForCollections(['c1']);
        await clearCollectionThumbnailCacheForImages(['image-1']);
        await clearAllCollectionThumbnailCaches();

        expect(dbMocks.getDb).not.toHaveBeenCalled();
    });

    it('returns empty thumbnail and smart summaries without querying for empty inputs', async () => {
        const { getCollectionThumbnailSummaries, getSmartCollectionSummaries } = await import('../collectionRepo');

        await expect(getCollectionThumbnailSummaries([])).resolves.toEqual({});
        await expect(getSmartCollectionSummaries([])).resolves.toEqual({});

        expect(dbMocks.getDb).not.toHaveBeenCalled();
    });

    it('can load smart counts without thumbnail hydration when callers only need totals', async () => {
        dbMocks.select.mockResolvedValue([{ id: 'smart-1', count: 4 }]);

        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        await expect(getSmartCollectionSummaries([makeCollection({
            id: 'smart-1',
            filters: makeFilters({ searchQuery: 'portrait' }),
        })], { includeThumbnails: false })).resolves.toEqual({
            'smart-1': { count: 4, thumbnailSourceKind: 'dynamic' },
        });

        expect(dbMocks.select).toHaveBeenCalledTimes(1);
        expect(dbMocks.execute).not.toHaveBeenCalled();
    });

    it('returns partial smart summaries when smart thumbnail queries fail', async () => {
        dbMocks.select
            .mockResolvedValueOnce([{ id: 'smart-1', count: 4 }])
            .mockRejectedValueOnce(new Error('thumbnail query failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { getSmartCollectionSummaries } = await import('../collectionRepo');
        await expect(getSmartCollectionSummaries([makeCollection({
            id: 'smart-1',
            filters: makeFilters({ searchQuery: 'portrait' }),
        })])).resolves.toEqual({
            'smart-1': { count: 4, thumbnailSourceKind: 'dynamic' },
        });

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed smart collection summaries', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('adds images to a collection, updates recency, and clears stale dynamic thumbnails', async () => {
        const { addImagesToCollection } = await import('../collectionRepo');

        await addImagesToCollection('c1', ['C:\\images\\a.png', 'C:/images/b.png']);

        expect(dbMocks.execute).toHaveBeenCalledWith(
            'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
            ['c1', 'C:/images/a.png']
        );
        expect(dbMocks.execute).toHaveBeenCalledWith(
            'UPDATE collections SET updated_at = ? WHERE id = ?',
            [expect.any(Number), 'c1']
        );
        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path = NULL'),
            ['c1']
        );
    });

    it('removes images from a collection with normalized image ids', async () => {
        const { removeImagesFromCollection } = await import('../collectionRepo');

        await removeImagesFromCollection('c1', ['C:\\images\\a.png', 'C:/images/b.png']);

        expect(dbMocks.execute).toHaveBeenCalledWith(
            'DELETE FROM collection_images WHERE collection_id = ? AND image_id IN (?,?)',
            ['c1', 'C:/images/a.png', 'C:/images/b.png']
        );
        expect(dbMocks.execute).toHaveBeenCalledWith(
            expect.stringContaining('dynamic_thumbnail_path = NULL'),
            ['c1']
        );
    });

    it('selects the best collection thumbnail across query batches with pinned images first', async () => {
        const ids = Array.from({ length: 901 }, (_, index) => `img-${index}`);
        dbMocks.select
            .mockResolvedValueOnce([{ path: 'C:/thumbs/newer.webp', timestamp: 20, is_pinned: 0 }])
            .mockResolvedValueOnce([{ path: 'data:image/webp;base64,pinned', timestamp: 1, is_pinned: 1 }]);

        const { getCollectionThumbnail } = await import('../collectionRepo');

        await expect(getCollectionThumbnail(ids)).resolves.toBe('data:image/webp;base64,pinned');
        expect(dbMocks.select).toHaveBeenCalledTimes(2);
    });

    it('selects the newest thumbnail when candidates have equal pin status', async () => {
        const ids = Array.from({ length: 901 }, (_, index) => `img-${index}`);
        dbMocks.select
            .mockResolvedValueOnce([{ path: 'C:/thumbs/older.webp', timestamp: 10, is_pinned: 0 }])
            .mockResolvedValueOnce([{ path: 'C:/thumbs/newer.webp', timestamp: 20, is_pinned: 0 }]);

        const { getCollectionThumbnail } = await import('../collectionRepo');

        await expect(getCollectionThumbnail(ids)).resolves.toBe('asset://C:/thumbs/newer.webp');
    });

    it('treats a nullable thumbnail timestamp as zero', async () => {
        dbMocks.select.mockResolvedValue([{ path: 'C:/thumbs/no-time.webp', timestamp: null, is_pinned: 0 }]);
        const { getCollectionThumbnail } = await import('../collectionRepo');

        await expect(getCollectionThumbnail(['img-1'])).resolves.toBe('asset://C:/thumbs/no-time.webp');
    });

    it('returns no collection thumbnail for empty, missing, null, or failed thumbnail lookups', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { getCollectionThumbnail } = await import('../collectionRepo');

        await expect(getCollectionThumbnail([])).resolves.toBeUndefined();

        dbMocks.select.mockResolvedValueOnce([]);
        await expect(getCollectionThumbnail(['img-missing'])).resolves.toBeUndefined();

        dbMocks.select.mockResolvedValueOnce([{ path: null, timestamp: 1, is_pinned: 1 }]);
        await expect(getCollectionThumbnail(['img-null-thumb'])).resolves.toBeUndefined();

        dbMocks.select.mockRejectedValueOnce(new Error('sqlite busy'));
        await expect(getCollectionThumbnail(['img-error'])).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith('[DB] Fail collection thumb', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('normalizes smart collection thumbnails and falls back safely on empty or failed queries', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { getSmartCollectionThumbnail } = await import('../collectionRepo');

        dbMocks.select.mockResolvedValueOnce([{ thumbnail_path: 'C:/thumbs/smart.webp', timestamp: 1, is_pinned: 0 }]);
        await expect(getSmartCollectionThumbnail('WHERE model_name = ?', ['model-a'])).resolves.toBe('asset://C:/thumbs/smart.webp');

        dbMocks.select.mockResolvedValueOnce([{ thumbnail_path: 'https://example.com/smart.webp', timestamp: 1, is_pinned: 0 }]);
        await expect(getSmartCollectionThumbnail('WHERE model_name = ?', ['model-a'])).resolves.toBe('https://example.com/smart.webp');

        dbMocks.select.mockResolvedValueOnce([{ thumbnail_path: null, timestamp: 1, is_pinned: 0 }]);
        await expect(getSmartCollectionThumbnail('WHERE model_name = ?', ['model-a'])).resolves.toBeUndefined();

        dbMocks.select.mockResolvedValueOnce([]);
        await expect(getSmartCollectionThumbnail('WHERE model_name = ?', ['model-a'])).resolves.toBeUndefined();

        dbMocks.select.mockRejectedValueOnce(new Error('sqlite busy'));
        await expect(getSmartCollectionThumbnail('WHERE model_name = ?', ['model-a'])).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith('[DB] Fail smart thumb', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('returns collection memberships and falls back safely when membership queries fail', async () => {
        dbMocks.select.mockResolvedValueOnce([{ collection_id: 'c1' }, { collection_id: 'c2' }]);

        const { getCollectionsForImage, getCollectionImageIds } = await import('../collectionRepo');

        await expect(getCollectionsForImage('img-1')).resolves.toEqual(['c1', 'c2']);

        dbMocks.select.mockResolvedValueOnce([{ image_id: 'img-1' }, { image_id: 'img-2' }]);
        await expect(getCollectionImageIds('c1')).resolves.toEqual(['img-1', 'img-2']);

        dbMocks.select.mockRejectedValueOnce(new Error('sqlite busy'));
        await expect(getCollectionsForImage('img-1')).resolves.toEqual([]);
    });

    it('falls back to no image ids when collection image lookup fails', async () => {
        dbMocks.select.mockRejectedValueOnce(new Error('sqlite busy'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { getCollectionImageIds } = await import('../collectionRepo');
        await expect(getCollectionImageIds('c1')).resolves.toEqual([]);

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to get collection image IDs', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('purges InvokeAI collections through the mutex-protected DB path', async () => {
        const { purgeInvokeCollections } = await import('../collectionRepo');

        await purgeInvokeCollections();

        expect(dbMocks.dispatch).toHaveBeenCalledTimes(1);
        expect(dbMocks.execute).toHaveBeenCalledWith("DELETE FROM collections WHERE source = 'invoke'");
    });
});
