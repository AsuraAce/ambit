import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterState } from '../../../types';

const dbMocks = vi.hoisted(() => ({
    select: vi.fn(),
    execute: vi.fn(),
    getDb: vi.fn(),
    dispatch: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../runtime', () => ({
    isBrowserMockMode: () => false,
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

describe('collectionRepo filter normalization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        dbMocks.execute.mockResolvedValue(undefined);
        dbMocks.getDb.mockResolvedValue({ select: dbMocks.select, execute: dbMocks.execute });
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
});

describe('collectionRepo thumbnail hydration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        dbMocks.execute.mockResolvedValue(undefined);
        dbMocks.getDb.mockResolvedValue({ select: dbMocks.select, execute: dbMocks.execute });
    });

    it('resolves custom image ids to optimized thumbnail paths without a broad image join', async () => {
        const queries: string[] = [];
        dbMocks.select.mockImplementation(async (query: string) => {
            queries.push(query);
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({ name: 'Custom', custom_thumbnail: 'img1' })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 1 }];
            if (query.includes('c.id as collection_id')) {
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
                return [makeCollectionRow({ name: 'Base Only' })];
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
        expect(collections[0].thumbnail).toBeUndefined();
        expect(queries.join('\n')).not.toContain('c.id as collection_id');
        expect(queries.join('\n')).not.toContain('WHERE id IN');
        expect(queries.join('\n')).not.toContain('WHERE path IN');
    });

    it('maps cached dynamic thumbnails without running thumbnail hydration queries', async () => {
        const queries: string[] = [];
        dbMocks.select.mockImplementation(async (query: string) => {
            queries.push(query);
            if (query.includes('SELECT * FROM collections')) {
                return [makeCollectionRow({
                    name: 'Cached',
                    dynamic_thumbnail_path: 'C:/thumbs/cached.webp',
                    dynamic_safe_thumbnail_path: 'C:/thumbs/cached-safe.webp',
                    dynamic_thumbnail_is_sensitive: 1,
                    filter_state: JSON.stringify({ dateRange: 'today' })
                })];
            }
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 0 }];
            return [];
        });

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats({ includeThumbnails: false });

        expect(collections[0]).toEqual(expect.objectContaining({
            thumbnail: 'asset://C:/thumbs/cached.webp',
            safeThumbnail: 'asset://C:/thumbs/cached-safe.webp',
            thumbnailIsSensitive: true,
            thumbnailSourceKind: 'dynamic'
        }));
        expect(queries.join('\n')).not.toContain('c.id as collection_id');
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
        expect(queries.join('\n')).not.toContain('c.id as collection_id');
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
            if (query.includes('c.id as collection_id')) {
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
            if (query.includes('c.id as collection_id')) {
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

    it('marks dynamic thumbnails sensitive, exposes a safe alternative, and orders pinned first', async () => {
        let dynamicQuery = '';
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('SELECT * FROM collections')) return [makeCollectionRow()];
            if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 2 }];
            if (query.includes('c.id as collection_id')) {
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
        expect(dynamicQuery.match(/ORDER BY i\.is_pinned DESC, i\.timestamp DESC/g)?.length).toBeGreaterThanOrEqual(2);
        expect(dynamicQuery).toContain('AND i.privacy_hidden = 0');
    });

    it('writes raw dynamic thumbnail paths to the collection cache after static hydration', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('c.id as collection_id')) {
                return [{
                    collection_id: 'c1',
                    dynamic_thumb: 'C:/thumbs/unsafe.webp',
                    dynamic_privacy: 1,
                    safe_thumb: 'C:/thumbs/safe.webp'
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
            ['C:/thumbs/unsafe.webp', 'C:/thumbs/safe.webp', 1, expect.any(Number), 'c1']
        );
    });

    it('clears the dynamic thumbnail cache when static hydration finds no thumbnail', async () => {
        dbMocks.select.mockImplementation(async (query: string) => {
            if (query.includes('c.id as collection_id')) {
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
                return [{ thumbnail_path: 'C:/thumbs/smart-safe.webp' }];
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
            ['C:/thumbs/smart.webp', 'C:/thumbs/smart-safe.webp', 0, expect.any(Number), 'smart-1']
        );
    });
});
