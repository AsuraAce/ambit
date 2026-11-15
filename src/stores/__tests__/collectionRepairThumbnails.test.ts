import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../../types';

const mocks = vi.hoisted(() => ({ rows: vi.fn(), thumbnails: vi.fn() }));
vi.mock('../../services/db/collectionRepo', () => ({
    getAllCollectionsWithStats: mocks.rows,
    getOrdinaryCollectionCounts: vi.fn().mockResolvedValue(new Map()),
    getCollectionThumbnailSummaries: mocks.thumbnails,
    getSmartCollectionSummaries: vi.fn().mockResolvedValue({}),
    cacheSmartCollectionCount: vi.fn(),
    ensureCollectionSchema: vi.fn().mockResolvedValue(undefined),
    getScopedCollectionRows: vi.fn().mockResolvedValue([]),
    getCollectionImageIdsStrict: vi.fn(),
    deleteCollectionFromDb: vi.fn(),
    migrateLegacyCollections: vi.fn(),
}));
vi.mock('../../services/repository', () => ({
    appRepository: { load: vi.fn().mockResolvedValue({ collectionStorageVersion: 1 }) },
}));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};
const collection = (id: string, thumbnail?: string): Collection => ({
    id,
    name: id,
    createdAt: 1,
    imageIds: [],
    count: 3,
    countState: 'ready',
    ...(thumbnail ? { thumbnail, safeThumbnail: `${thumbnail}-safe`, thumbnailIsSensitive: false, thumbnailSourceKind: 'dynamic' } : {}),
});
// A repair clears the cached thumbnails, so its refresh reads rows without them.
const repairRefresh = { includeThumbnails: false, retainThumbnails: true, scheduleSmartRefresh: false } as const;

const loadStore = async (rows: Collection[]) => {
    mocks.rows.mockResolvedValue(rows);
    const { useCollectionStore: store } = await import('../collectionStore');
    await store.getState().refreshCollections(false, { scheduleSmartRefresh: false });
    mocks.rows.mockResolvedValue(rows.map((row) => collection(row.id)));
    return store;
};

describe('collection thumbnails during a repair', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.rows.mockReset();
        mocks.thumbnails.mockReset().mockResolvedValue({});
    });

    it('keeps the last thumbnail instead of a placeholder while the repair refresh runs', async () => {
        const store = await loadStore([collection('a', 'old-a')]);

        await store.getState().refreshCollections(false, repairRefresh);

        expect(store.getState().collections[0]).toMatchObject({ thumbnail: 'old-a', safeThumbnail: 'old-a-safe' });
    });

    it('drops thumbnails on a refresh that did not ask to keep them', async () => {
        // Only the repair may keep them; any other refresh shows what the database has now.
        const store = await loadStore([collection('a', 'old-a')]);

        await store.getState().refreshCollections(false, { includeThumbnails: false, scheduleSmartRefresh: false });

        expect(store.getState().collections[0].thumbnail).toBeUndefined();
    });

    it('drops thumbnails after an owner change, so another owner never sees them', async () => {
        const store = await loadStore([collection('a', 'old-a')]);
        store.getState().invalidateInitialization();

        await store.getState().refreshCollections(false, repairRefresh);

        expect(store.getState().collections[0].thumbnail).toBeUndefined();
        expect(store.getState().collections[0].safeThumbnail).toBeUndefined();
    });

    it('drops thumbnails after a privacy mask change until fresh ones are read', async () => {
        // A thumbnail read before the change may show an image the mask now hides.
        const store = await loadStore([collection('a', 'old-a')]);
        store.getState().invalidateRetainedThumbnails();

        await store.getState().refreshCollections(false, repairRefresh);
        expect(store.getState().collections[0].thumbnail).toBeUndefined();

        mocks.rows.mockResolvedValueOnce([collection('a', 'fresh-a')]);
        await store.getState().refreshCollections(false, { scheduleSmartRefresh: false });
        await store.getState().refreshCollections(false, repairRefresh);
        expect(store.getState().collections[0].thumbnail).toBe('fresh-a');
    });

    it('does not apply a thumbnail read that started before a privacy mask change', async () => {
        const store = await loadStore([collection('a', 'old-a')]);
        await store.getState().refreshCollections(false, repairRefresh);
        const read = deferred<Record<string, Partial<Collection>>>();
        mocks.thumbnails.mockReturnValueOnce(read.promise);

        const hydration = store.getState().refreshCollectionThumbnails(false, true);
        await vi.waitFor(() => expect(mocks.thumbnails).toHaveBeenCalledOnce());
        store.getState().invalidateRetainedThumbnails();
        read.resolve({ a: { thumbnail: 'stale-a' } });
        await hydration;

        expect(store.getState().collections[0].thumbnail).not.toBe('stale-a');
    });

    it('replaces the kept thumbnails all at once when the repaired set is ready', async () => {
        // 60 collections take two reads; the sidebar must not show a mix of old and new.
        const ids = Array.from({ length: 60 }, (_, index) => `c${index}`);
        const store = await loadStore(ids.map((id) => collection(id, `old-${id}`)));
        await store.getState().refreshCollections(false, repairRefresh);
        const second = deferred<Record<string, Partial<Collection>>>();
        const summariesFor = (batch: Collection[]) => Object.fromEntries(batch.map((row) => [row.id, { thumbnail: `new-${row.id}` }]));
        mocks.thumbnails.mockImplementationOnce(async (batch: Collection[]) => summariesFor(batch));
        mocks.thumbnails.mockImplementationOnce((batch: Collection[]) => second.promise.then(() => summariesFor(batch)));

        const hydration = store.getState().refreshCollectionThumbnails(false, true, { consistency: 'authoritative' });
        await vi.waitFor(() => expect(mocks.thumbnails).toHaveBeenCalledTimes(2));
        expect(store.getState().collections.every((row) => row.thumbnail === `old-${row.id}`)).toBe(true);
        expect(Object.keys(store.getState().thumbnailHydrationPendingIds)).toHaveLength(60);

        second.resolve({});
        await hydration;
        expect(store.getState().collections.every((row) => row.thumbnail === `new-${row.id}`)).toBe(true);
        expect(store.getState().thumbnailHydrationPendingIds).toEqual({});
    });
});
