import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../types';
import {
    getImageCountsQueryKey,
    patchImageFlagsInQueryCaches,
    removeImagesFromQueryCaches,
    revertImageFieldsInList,
    revertImageFieldsInQueryCaches,
    updateImagesQueryCaches,
} from '../imageQueryCache';

const image = (id: string, flags: Partial<AIImage> = {}): AIImage => ({
    id,
    url: id,
    thumbnailUrl: id,
    filename: `${id}.png`,
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    isPinned: false,
    isDeleted: false,
    isMissing: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 0,
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
    },
    ...flags,
});

describe('imageQueryCache', () => {
    it('evicts removed images from every cached page and updates visible counts', () => {
        const queryClient = new QueryClient();
        const key = ['images', { scope: 'library' }] as const;
        const first = image('1');
        const second = image('2');
        const third = image('3');
        queryClient.setQueryData(key, {
            pages: [{ images: [first, second] }, { images: [third] }],
            pageParams: [undefined, { id: '2', val: 1 }],
        });
        // The counts live in their own query under the images key, not in the pages.
        queryClient.setQueryData(getImageCountsQueryKey(key), { totalCount: 3, globalCount: 5 });
        queryClient.setQueryData(getImageCountsQueryKey(['images', { scope: 'other' }]), { totalCount: 9, globalCount: 5 });

        removeImagesFromQueryCaches(queryClient, ['2', '3']);

        const data = queryClient.getQueryData<{ pages: Array<{ images: AIImage[] }> }>(key);
        expect(data?.pages.map((page) => page.images.map((item) => item.id))).toEqual([['1'], []]);
        expect(queryClient.getQueryData(getImageCountsQueryKey(key))).toEqual({ totalCount: 1, globalCount: 3 });
        // A scope whose cached pages never held the removed images keeps its count until it refreshes.
        expect(queryClient.getQueryData(getImageCountsQueryKey(['images', { scope: 'other' }]))).toEqual({ totalCount: 9, globalCount: 5 });
    });

    it('does not adjust an image cache that no longer contains the removed ids', () => {
        const queryClient = new QueryClient();
        const key = ['images', { scope: 'already-removed' }] as const;
        const data = {
            pages: [{ images: [image('1')] }],
            pageParams: [undefined],
        };
        const counts = { totalCount: 1, globalCount: 1 };
        queryClient.setQueryData(key, data);
        queryClient.setQueryData(getImageCountsQueryKey(key), counts);

        removeImagesFromQueryCaches(queryClient, ['missing']);
        removeImagesFromQueryCaches(queryClient, []);

        expect(queryClient.getQueryData(key)).toBe(data);
        expect(queryClient.getQueryData(getImageCountsQueryKey(key))).toBe(counts);
    });

    it('patches all cached image result pages so optimistic flags survive query re-emissions', () => {
        const queryClient = new QueryClient();
        const first = image('1');
        const second = image('2');

        queryClient.setQueryData(['images', { scope: 'library' }], {
            pages: [
                { images: [first], totalCount: 2, globalCount: 2 },
                { images: [second], totalCount: -1, globalCount: -1 },
            ],
            pageParams: [undefined, { id: '1', val: 1 }],
        });

        patchImageFlagsInQueryCaches(queryClient, ['2'], { isFavorite: true, isPinned: true });

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(['images', { scope: 'library' }]);

        expect(data?.pages[0].images[0]).toBe(first);
        expect(data?.pages[1].images[0]).toMatchObject({
            id: '2',
            isFavorite: true,
            isPinned: true,
        });
    });

    it('reorders the active cached result and preserves original page sizes', () => {
        const queryClient = new QueryClient();
        const activeKey = ['images', { scope: 'active' }] as const;
        const first = image('1', { timestamp: 100 });
        const second = image('2', { timestamp: 200, isPinned: true });
        const third = image('3', { timestamp: 50 });
        const previousOrder = [first, second, third];
        const nextOrder = [second, { ...first, isPinned: true }, third];

        queryClient.setQueryData(activeKey, {
            pages: [
                { images: [first, second], totalCount: 3, globalCount: 3 },
                { images: [third], totalCount: -1, globalCount: -1 },
            ],
            pageParams: [undefined, { id: '2', val: 100 }],
        });

        patchImageFlagsInQueryCaches(
            queryClient,
            ['1'],
            { isPinned: true },
            {
                previousOrder,
                nextOrder,
                reorderQueryKey: activeKey,
            }
        );

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(activeKey);

        expect(data?.pages.map((page) => page.images.map((item) => item.id))).toEqual([['2', '1'], ['3']]);
        expect(data?.pages[0].images[1].isPinned).toBe(true);
    });

    it('patches inactive cached results with the same ids without reordering them', () => {
        const queryClient = new QueryClient();
        const activeKey = ['images', { scope: 'active' }] as const;
        const inactiveKey = ['images', { scope: 'inactive' }] as const;
        const activeFirst = image('1', { timestamp: 100 });
        const activeSecond = image('2', { timestamp: 200, isPinned: true });
        const inactiveFirst = image('1', { timestamp: 100 });
        const inactiveSecond = image('2', { timestamp: 200, isPinned: true });
        const previousOrder = [activeFirst, activeSecond];
        const nextOrder = [activeSecond, { ...activeFirst, isPinned: true }];

        queryClient.setQueryData(activeKey, {
            pages: [{ images: [activeFirst, activeSecond], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined],
        });
        queryClient.setQueryData(inactiveKey, {
            pages: [{ images: [inactiveFirst, inactiveSecond], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined],
        });

        patchImageFlagsInQueryCaches(
            queryClient,
            ['1'],
            { isPinned: true },
            {
                previousOrder,
                nextOrder,
                reorderQueryKey: activeKey,
            }
        );

        const activeData = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(activeKey);
        const inactiveData = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(inactiveKey);

        expect(activeData?.pages[0].images.map((item) => item.id)).toEqual(['2', '1']);
        expect(inactiveData?.pages[0].images.map((item) => item.id)).toEqual(['1', '2']);
        expect(inactiveData?.pages[0].images[0].isPinned).toBe(true);
    });

    // A rollback reverts only the field its write changed: another action's change stays (#492).
    it('reverts only the given fields of cached images and keeps their other changes', () => {
        const queryClient = new QueryClient();

        queryClient.setQueryData(['images'], {
            pages: [
                {
                    images: [image('1', { isFavorite: true, isPinned: true }), image('2', { isFavorite: true })],
                    totalCount: 2,
                    globalCount: 2,
                },
            ],
            pageParams: [undefined],
        });

        revertImageFieldsInQueryCaches(queryClient, new Map([['1', { isFavorite: false }]]));

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(['images']);

        expect(data?.pages[0].images[0]).toEqual(expect.objectContaining({ isFavorite: false, isPinned: true }));
        expect(data?.pages[0].images[1].isFavorite).toBe(true);
    });

    it('restores active cached result order after an optimistic reorder fails', () => {
        const queryClient = new QueryClient();
        const activeKey = ['images', { scope: 'active' }] as const;
        const inactiveKey = ['images', { scope: 'inactive' }] as const;
        const first = image('1', { timestamp: 100 });
        const second = image('2', { timestamp: 200, isPinned: true });
        const third = image('3', { timestamp: 50 });
        const inactiveFirst = image('1', { timestamp: 100, isPinned: true });
        const inactiveSecond = image('2', { timestamp: 200, isPinned: true });
        const previousOrder = [first, second, third];
        const optimisticOrder = [second, { ...first, isPinned: true }, third];

        queryClient.setQueryData(activeKey, {
            pages: [
                { images: optimisticOrder.slice(0, 2), totalCount: 3, globalCount: 3 },
                { images: optimisticOrder.slice(2), totalCount: -1, globalCount: -1 },
            ],
            pageParams: [undefined, { id: '1', val: 100 }],
        });
        queryClient.setQueryData(inactiveKey, {
            pages: [{ images: [inactiveFirst, inactiveSecond], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined],
        });

        revertImageFieldsInQueryCaches(queryClient, new Map([['1', { isPinned: false }]]), {
            previousOrder: optimisticOrder,
            nextOrder: previousOrder,
            reorderQueryKey: activeKey,
        });

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(activeKey);
        const inactiveData = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(inactiveKey);

        expect(data?.pages.map((page) => page.images.map((item) => item.id))).toEqual([['1', '2'], ['3']]);
        expect(data?.pages[0].images[0].isPinned).toBe(false);
        expect(inactiveData?.pages[0].images.map((item) => item.id)).toEqual(['1', '2']);
        expect(inactiveData?.pages[0].images[0].isPinned).toBe(false);
    });

    it('repartitions a cache when only the requested order changes', () => {
        const queryClient = new QueryClient();
        const key = ['images', { scope: 'order-only' }] as const;
        const first = image('1');
        const second = image('2');
        queryClient.setQueryData(key, {
            pages: [
                { images: [first], totalCount: 2, globalCount: 2 },
                { images: [second], totalCount: -1, globalCount: -1 },
            ],
            pageParams: [undefined, 1],
        });

        updateImagesQueryCaches(queryClient, (current) => current, {
            previousOrder: [first, second],
            nextOrder: [second, first],
            reorderQueryKey: ['images', { scope: 'order-only' }],
        });

        const data = queryClient.getQueryData<{ pages: Array<{ images: AIImage[] }> }>(key);
        expect(data?.pages.map((page) => page.images[0].id)).toEqual(['2', '1']);
    });

    it('preserves cache identity for an unchanged reorder and skips missing query data', () => {
        const queryClient = new QueryClient();
        const key = ['images', { scope: 'same-order' }] as const;
        const first = image('1');
        const data = {
            pages: [{ images: [first], totalCount: 1, globalCount: 1 }],
            pageParams: [undefined],
        };
        queryClient.setQueryData(key, data);
        const setQueryData = vi.spyOn(queryClient, 'setQueryData');

        updateImagesQueryCaches(queryClient, (current) => current, {
            previousOrder: [first],
            nextOrder: [first],
            reorderQueryKey: key,
        });

        expect(queryClient.getQueryData(key)).toBe(data);
        expect(setQueryData).not.toHaveBeenCalled();

        const missingClient = {
            getQueriesData: () => [[['images'], undefined]],
            setQueryData: vi.fn(),
        } as unknown as QueryClient;
        updateImagesQueryCaches(missingClient, (current) => current);
        expect(missingClient.setQueryData).not.toHaveBeenCalled();
    });

    it('uses default ordering options and preserves next-order images absent from the cache', () => {
        const queryClient = new QueryClient();
        const key = ['images', { scope: 'defaults' }] as const;
        const first = image('1');
        const absent = image('missing');
        queryClient.setQueryData(key, {
            pages: [{ images: [first], totalCount: 1, globalCount: 1 }],
            pageParams: [undefined],
        });

        updateImagesQueryCaches(queryClient, (current) => current);
        updateImagesQueryCaches(queryClient, (current) => current, {
            previousOrder: [first],
            nextOrder: [absent],
            reorderQueryKey: key,
        });

        expect(queryClient.getQueryData<{ pages: Array<{ images: AIImage[] }> }>(key)?.pages[0].images).toEqual([absent]);

        revertImageFieldsInQueryCaches(queryClient, new Map());
        expect(queryClient.getQueryData<{ pages: Array<{ images: AIImage[] }> }>(key)?.pages[0].images).toEqual([absent]);
    });

    describe('revertImageFieldsInList (#484, #492)', () => {
        // A rollback reverts only what its write changed. The store may hold another view by then,
        // and that view must keep its own images and order; the touched image keeps its other fields.
        const first = image('first');
        const second = image('second');
        const snapshot = [first, second];
        const optimistic = [{ ...second, isPinned: true }, first];
        const unpinSecond = new Map([['second', { isPinned: false }]]);

        it('reverts the touched image and the snapshot order while the list is unchanged', () => {
            const reverted = revertImageFieldsInList(optimistic, unpinSecond, {
                previousOrder: optimistic,
                nextOrder: snapshot,
            });
            expect(reverted).toEqual(snapshot);
        });

        it('patches only the touched image, in place, once the list holds another view', () => {
            const otherView = [image('other'), { ...second, isPinned: true }];
            const reverted = revertImageFieldsInList(otherView, unpinSecond, {
                previousOrder: optimistic,
                nextOrder: snapshot,
            });
            expect(reverted).toEqual([otherView[0], second]);
            expect(reverted[0]).toBe(otherView[0]);
        });

        it('keeps a change another action made to the touched image meanwhile', () => {
            const favorited = [{ ...second, isPinned: true, isFavorite: true }, first];
            const reverted = revertImageFieldsInList(favorited, unpinSecond);
            expect(reverted[0]).toEqual({ ...second, isFavorite: true });
        });

        it('returns the same list when it holds none of the touched images', () => {
            const otherView = [image('other')];
            expect(revertImageFieldsInList(otherView, unpinSecond)).toBe(otherView);
        });
    });
});
