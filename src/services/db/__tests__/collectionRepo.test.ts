import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`
}));

vi.mock('../../runtime', () => ({
    isBrowserMockMode: () => false
}));

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock('../connection', () => ({
    dbMutex: {
        dispatch: (fn: () => Promise<unknown>) => fn()
    },
    getDb: () => getDbMock()
}));

describe('collectionRepo thumbnail hydration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves custom image thumbnails to optimized thumbnail paths', async () => {
        const db = {
            select: vi.fn(async (query: string) => {
                if (query.includes('SELECT * FROM collections')) {
                    return [{
                        id: 'c1',
                        name: 'Custom',
                        color: null,
                        is_archived: 0,
                        is_pinned: 0,
                        created_at: 1,
                        updated_at: 1,
                        custom_thumbnail: 'img1',
                        filter_state: null,
                        manual_exclusions: null,
                        source: 'ambit'
                    }];
                }
                if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c1', count: 1 }];
                if (query.includes('custom_image_id')) {
                    return [{
                        collection_id: 'c1',
                        custom_thumbnail: 'img1',
                        custom_image_id: 'img1',
                        custom_thumb: 'C:/thumbs/img1.webp',
                        custom_privacy: 0,
                        dynamic_thumb: 'C:/images/full.png',
                        dynamic_privacy: 1,
                        safe_thumb: 'C:/thumbs/safe.webp'
                    }];
                }
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0].thumbnail).toBe('asset://C:/thumbs/img1.webp');
        expect(collections[0].customThumbnail).toBe('img1');
        expect(collections[0].safeThumbnail).toBeUndefined();
        expect(collections[0].thumbnailIsSensitive).toBe(false);
        expect(collections[0].thumbnailSourceKind).toBe('customImage');
    });

    it('marks dynamic collection thumbnails sensitive and exposes a safe alternative', async () => {
        const db = {
            select: vi.fn(async (query: string) => {
                if (query.includes('SELECT * FROM collections')) {
                    return [{
                        id: 'c2',
                        name: 'Dynamic',
                        color: null,
                        is_archived: 0,
                        is_pinned: 0,
                        created_at: 1,
                        updated_at: 1,
                        custom_thumbnail: null,
                        filter_state: null,
                        manual_exclusions: null,
                        source: 'ambit'
                    }];
                }
                if (query.includes('COUNT(*) as count')) return [{ collection_id: 'c2', count: 2 }];
                if (query.includes('custom_image_id')) {
                    return [{
                        collection_id: 'c2',
                        custom_thumbnail: null,
                        custom_image_id: null,
                        custom_thumb: null,
                        custom_privacy: null,
                        dynamic_thumb: 'C:/thumbs/unsafe.webp',
                        dynamic_privacy: 1,
                        safe_thumb: 'C:/thumbs/safe.webp'
                    }];
                }
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { getAllCollectionsWithStats } = await import('../collectionRepo');
        const collections = await getAllCollectionsWithStats();

        expect(collections[0].thumbnail).toBe('asset://C:/thumbs/unsafe.webp');
        expect(collections[0].safeThumbnail).toBe('asset://C:/thumbs/safe.webp');
        expect(collections[0].thumbnailIsSensitive).toBe(true);
        expect(collections[0].thumbnailSourceKind).toBe('dynamic');
    });
});
