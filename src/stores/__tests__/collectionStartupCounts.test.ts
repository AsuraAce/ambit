import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../../types';

const mocks = vi.hoisted(() => ({ rows: vi.fn(), counts: vi.fn(), thumbnails: vi.fn() }));
vi.mock('../../services/db/collectionRepo', () => ({
    getAllCollectionsWithStats: mocks.rows,
    getOrdinaryCollectionCounts: mocks.counts,
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

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const collection = (): Collection => ({ id: 'ordinary', name: 'Ordinary', createdAt: 1, imageIds: [] });
interface ReadOptions { includeCounts?: boolean; readCounts?: () => Promise<Map<string, number>> }

describe('ordinary collection startup counts', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.counts.mockReset();
        mocks.rows.mockReset();
        mocks.thumbnails.mockResolvedValue({});
        mocks.counts.mockResolvedValue(new Map([['ordinary', 4]]));
        mocks.rows.mockImplementation(async (options: ReadOptions = {}) => {
            const counts = options.includeCounts === false ? undefined : await (options.readCounts ?? mocks.counts)();
            return [{ ...collection(), count: counts?.get('ordinary'), countState: counts ? 'ready' : 'pending' }];
        });
    });

    it('loads startup metadata while the ordinary count operation remains unresolved', async () => {
        const count = deferred<Map<string, number>>();
        mocks.counts.mockReturnValue(count.promise);
        mocks.rows.mockImplementation(async (options: { includeCounts?: boolean } = {}) => {
            if (options.includeCounts !== false) await mocks.counts();
            return [collection()];
        });
        const { useCollectionStore: store } = await import('../collectionStore');
        const initializing = store.getState().initialize({ deferHydration: true });
        await vi.waitFor(() => expect(store.getState().isLoaded).toBe(true));
        expect(mocks.counts).not.toHaveBeenCalled();
        await expect(initializing).resolves.toBe(true);
    });

    it('starts once at safe readiness, preserves metadata, and distinguishes verified zero', async () => {
        const count = deferred<Map<string, number>>();
        mocks.counts.mockReturnValue(count.promise);
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        expect(store.getState().collections[0]).toMatchObject({ count: undefined, countState: 'pending' });
        store.getState().setOrdinaryCountsReady(true);
        store.getState().setOrdinaryCountsReady(false);
        store.getState().setOrdinaryCountsReady(true);
        expect(mocks.counts).toHaveBeenCalledOnce();
        store.setState(state => ({ collections: state.collections.map(row => ({ ...row, thumbnail: 'verified-thumb' })) }));
        count.resolve(new Map());
        await store.getState().refreshPendingOrdinaryCounts();
        await vi.waitFor(() => expect(store.getState().collections[0]).toMatchObject({ count: 0, countState: 'ready', thumbnail: 'verified-thumb' }));
        expect(mocks.rows).toHaveBeenCalledOnce();
    });

    it('does not publish into an invalidated owner generation', async () => {
        const count = deferred<Map<string, number>>();
        mocks.counts.mockReturnValue(count.promise);
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        store.getState().setOrdinaryCountsReady(true);
        store.getState().setOrdinaryCountsReady(false);
        store.getState().invalidateInitialization();
        store.setState({ collections: [] });
        count.resolve(new Map([['ordinary', 99]]));
        await Promise.resolve();
        await Promise.resolve();
        expect(store.getState().collections).toEqual([]);
        expect(mocks.counts).toHaveBeenCalledOnce();
    });

    it('keeps a paused completion pending and resumes only when safety is restored', async () => {
        const count = deferred<Map<string, number>>();
        mocks.counts.mockReturnValueOnce(count.promise);
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        store.getState().setOrdinaryCountsReady(true);
        store.getState().setOrdinaryCountsReady(false);
        count.resolve(new Map([['ordinary', 99]]));
        await vi.waitFor(() => expect(mocks.counts).toHaveBeenCalledOnce());
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(store.getState().collections[0].countState).toBe('pending');
        store.getState().setOrdinaryCountsReady(true);
        await vi.waitFor(() => expect(store.getState().collections[0].count).toBe(4));
        expect(mocks.counts).toHaveBeenCalledTimes(2);
    });

    it('does not retry a failed background read until explicitly requested', async () => {
        mocks.counts.mockRejectedValueOnce(new Error('generated failure'));
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        store.getState().setOrdinaryCountsReady(true);
        await vi.waitFor(() => expect(store.getState().collections[0].countState).toBe('failed'));
        store.getState().setOrdinaryCountsReady(true);
        expect(mocks.counts).toHaveBeenCalledOnce();
        store.getState().retryOrdinaryCounts();
        await vi.waitFor(() => expect(store.getState().collections[0].count).toBe(4));
        expect(mocks.counts).toHaveBeenCalledTimes(2);
    });

    it('lets a runtime authoritative refresh supersede background work without concurrent counts', async () => {
        const first = deferred<Map<string, number>>();
        const second = deferred<Map<string, number>>();
        mocks.counts.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        store.getState().setOrdinaryCountsReady(true);
        let settled = false;
        const runtime = store.getState().refreshCollections(false, { consistency: 'authoritative', scheduleSmartRefresh: false })
            .then(() => { settled = true; });
        await vi.waitFor(() => expect(mocks.rows).toHaveBeenCalledTimes(2));
        expect(mocks.counts).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
        first.resolve(new Map([['ordinary', 99]]));
        await vi.waitFor(() => expect(mocks.counts).toHaveBeenCalledTimes(2));
        expect(store.getState().collections[0].count).toBeUndefined();
        second.resolve(new Map([['ordinary', 5]]));
        await runtime;
        expect(store.getState().collections[0].count).toBe(5);
        expect(mocks.counts).toHaveBeenCalledTimes(2);
    });

    it('preserves runtime authoritative count failures', async () => {
        const { useCollectionStore: store } = await import('../collectionStore');
        store.getState().setOrdinaryCountsReady(true);
        mocks.counts.mockRejectedValueOnce(new Error('generated runtime failure'));
        await expect(store.getState().refreshCollections(false, { consistency: 'authoritative' }))
            .rejects.toThrow('generated runtime failure');
    });

    it('makes a failed replacement of pending startup counts explicitly retryable', async () => {
        const first = deferred<Map<string, number>>();
        const replacement = deferred<Map<string, number>>();
        mocks.counts.mockReturnValueOnce(first.promise).mockReturnValueOnce(replacement.promise);
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        store.getState().setOrdinaryCountsReady(true);
        const runtime = store.getState().refreshCollections(false, { consistency: 'authoritative', scheduleSmartRefresh: false });
        const rejected = expect(runtime).rejects.toThrow('replacement failed');
        first.resolve(new Map([['ordinary', 99]]));
        await vi.waitFor(() => expect(mocks.counts).toHaveBeenCalledTimes(2));
        replacement.reject(new Error('replacement failed'));
        await rejected;
        expect(store.getState().collections[0]).toMatchObject({ count: undefined, countState: 'failed' });
        store.getState().setOrdinaryCountsReady(true);
        expect(mocks.counts).toHaveBeenCalledTimes(2);
        store.getState().retryOrdinaryCounts();
        await vi.waitFor(() => expect(store.getState().collections[0]).toMatchObject({ count: 4, countState: 'ready' }));
        expect(mocks.counts).toHaveBeenCalledTimes(3);
    });

    it('does not publish a replacement failure into another owner generation', async () => {
        const replacement = deferred<Map<string, number>>();
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        store.setState({ hasOpenedGallery: true });
        mocks.counts.mockReturnValueOnce(replacement.promise);
        const runtime = store.getState().refreshCollections(false, { consistency: 'authoritative', scheduleSmartRefresh: false });
        const rejected = expect(runtime).rejects.toThrow('old owner failed');
        await vi.waitFor(() => expect(mocks.counts).toHaveBeenCalledOnce());
        store.getState().invalidateInitialization();
        store.setState({ collections: [{ ...collection(), id: 'other-owner', countState: 'pending' }] });
        replacement.reject(new Error('old owner failed'));
        await rejected;
        expect(store.getState().collections[0]).toMatchObject({ id: 'other-owner', countState: 'pending' });
    });

    it('keeps runtime counts awaited after readiness is withdrawn for an owner transition', async () => {
        const count = deferred<Map<string, number>>();
        mocks.counts.mockReturnValueOnce(count.promise);
        const { useCollectionStore: store } = await import('../collectionStore');
        store.getState().setOrdinaryCountsReady(true);
        store.getState().setOrdinaryCountsReady(false);
        store.getState().invalidateInitialization();
        let settled = false;
        const refresh = store.getState().refreshCollections(false, { consistency: 'authoritative', scheduleSmartRefresh: false })
            .then(() => { settled = true; });
        await vi.waitFor(() => expect(mocks.counts).toHaveBeenCalledOnce());
        expect(settled).toBe(false);
        expect(store.getState().hasOpenedGallery).toBe(true);
        count.resolve(new Map([['ordinary', 2]]));
        await refresh;
        expect(store.getState().collections[0].count).toBe(2);
    });

    it('coalesces pending snapshot edits into one latest read and retains added collections', async () => {
        const first = deferred<Map<string, number>>();
        mocks.counts.mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Map([['ordinary', 6], ['new', 3]]));
        const { useCollectionStore: store } = await import('../collectionStore');
        await store.getState().initialize({ deferHydration: true });
        store.getState().setOrdinaryCountsReady(true);
        store.getState().setCollections(rows => rows.map(row => ({ ...row, name: 'Renamed' })));
        store.getState().setCollections(rows => [...rows, { ...collection(), id: 'new', countState: 'pending' }]);
        expect(mocks.counts).toHaveBeenCalledOnce();
        first.resolve(new Map([['ordinary', 99]]));
        await vi.waitFor(() => expect(store.getState().collections[1].count).toBe(3));
        expect(store.getState().collections[0]).toMatchObject({ name: 'Renamed', count: 6 });
        expect(mocks.counts).toHaveBeenCalledTimes(2);
    });

    it('does not count an empty collection list and hydrates unknown ordinary thumbnails without a count', async () => {
        const { useCollectionStore: store } = await import('../collectionStore');
        mocks.rows.mockResolvedValueOnce([]);
        await store.getState().initialize({ deferHydration: true });
        store.getState().setOrdinaryCountsReady(true);
        expect(mocks.counts).not.toHaveBeenCalled();
        store.setState({ collections: [{ ...collection(), countState: 'pending' }] });
        await store.getState().refreshCollectionThumbnails();
        expect(mocks.thumbnails).toHaveBeenCalledOnce();
        expect(mocks.counts).not.toHaveBeenCalled();
    });

    it('queues one count when an uncounted Invoke board is added to an empty opened list', async () => {
        const { useCollectionStore: store } = await import('../collectionStore');
        const count = deferred<Map<string, number>>();
        mocks.counts.mockReturnValueOnce(count.promise);
        store.getState().setOrdinaryCountsReady(true);
        store.getState().setCollections([{ ...collection(), source: 'invoke', countState: 'pending' }]);
        expect(store.getState().collections[0].count).toBeUndefined();
        expect(mocks.counts).toHaveBeenCalledOnce();
        count.resolve(new Map([['ordinary', 8]]));
        await vi.waitFor(() => expect(store.getState().collections[0]).toMatchObject({ count: 8, countState: 'ready' }));
    });
});
