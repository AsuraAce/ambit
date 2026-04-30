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
});
