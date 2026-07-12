import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../types';
import {
    patchImageFlagsInQueryCaches,
    restoreImagesInQueryCaches,
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
        negativePrompt: ''
    },
    ...flags
});

describe('imageQueryCache', () => {
    it('patches all cached image result pages so optimistic flags survive query re-emissions', () => {
        const queryClient = new QueryClient();
        const first = image('1');
        const second = image('2');

        queryClient.setQueryData(['images', { scope: 'library' }], {
            pages: [
                { images: [first], totalCount: 2, globalCount: 2 },
                { images: [second], totalCount: -1, globalCount: -1 }
            ],
            pageParams: [undefined, { id: '1', val: 1 }]
        });

        patchImageFlagsInQueryCaches(queryClient, ['2'], { isFavorite: true, isPinned: true });

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(['images', { scope: 'library' }]);

        expect(data?.pages[0].images[0]).toBe(first);
        expect(data?.pages[1].images[0]).toMatchObject({
            id: '2',
            isFavorite: true,
            isPinned: true
        });
    });

    it('reorders the active cached result and preserves original page sizes', () => {
        const queryClient = new QueryClient();
        const activeKey = ['images', { scope: 'active' }] as const;
        const first = image('1', { timestamp: 100 });
        const second = image('2', { timestamp: 200, isPinned: true });
        const third = image('3', { timestamp: 50 });
        const previousOrder = [first, second, third];
        const nextOrder = [
            second,
            { ...first, isPinned: true },
            third
        ];

        queryClient.setQueryData(activeKey, {
            pages: [
                { images: [first, second], totalCount: 3, globalCount: 3 },
                { images: [third], totalCount: -1, globalCount: -1 }
            ],
            pageParams: [undefined, { id: '2', val: 100 }]
        });

        patchImageFlagsInQueryCaches(queryClient, ['1'], { isPinned: true }, {
            previousOrder,
            nextOrder,
            reorderQueryKey: activeKey
        });

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(activeKey);

        expect(data?.pages.map(page => page.images.map(item => item.id))).toEqual([
            ['2', '1'],
            ['3']
        ]);
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
        const nextOrder = [
            activeSecond,
            { ...activeFirst, isPinned: true }
        ];

        queryClient.setQueryData(activeKey, {
            pages: [{ images: [activeFirst, activeSecond], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined]
        });
        queryClient.setQueryData(inactiveKey, {
            pages: [{ images: [inactiveFirst, inactiveSecond], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined]
        });

        patchImageFlagsInQueryCaches(queryClient, ['1'], { isPinned: true }, {
            previousOrder,
            nextOrder,
            reorderQueryKey: activeKey
        });

        const activeData = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(activeKey);
        const inactiveData = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(inactiveKey);

        expect(activeData?.pages[0].images.map(item => item.id)).toEqual(['2', '1']);
        expect(inactiveData?.pages[0].images.map(item => item.id)).toEqual(['1', '2']);
        expect(inactiveData?.pages[0].images[0].isPinned).toBe(true);
    });

    it('restores cached images from a previous optimistic snapshot', () => {
        const queryClient = new QueryClient();
        const previous = [image('1')];

        queryClient.setQueryData(['images'], {
            pages: [
                { images: [image('1', { isFavorite: true })], totalCount: 1, globalCount: 1 }
            ],
            pageParams: [undefined]
        });

        restoreImagesInQueryCaches(queryClient, previous);

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(['images']);

        expect(data?.pages[0].images[0].isFavorite).toBe(false);
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
        const optimisticOrder = [
            second,
            { ...first, isPinned: true },
            third
        ];

        queryClient.setQueryData(activeKey, {
            pages: [
                { images: optimisticOrder.slice(0, 2), totalCount: 3, globalCount: 3 },
                { images: optimisticOrder.slice(2), totalCount: -1, globalCount: -1 }
            ],
            pageParams: [undefined, { id: '1', val: 100 }]
        });
        queryClient.setQueryData(inactiveKey, {
            pages: [{ images: [inactiveFirst, inactiveSecond], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined]
        });

        restoreImagesInQueryCaches(queryClient, previousOrder, {
            previousOrder: optimisticOrder,
            nextOrder: previousOrder,
            reorderQueryKey: activeKey
        });

        const data = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(activeKey);
        const inactiveData = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(inactiveKey);

        expect(data?.pages.map(page => page.images.map(item => item.id))).toEqual([
            ['1', '2'],
            ['3']
        ]);
        expect(data?.pages[0].images[0].isPinned).toBe(false);
        expect(inactiveData?.pages[0].images.map(item => item.id)).toEqual(['1', '2']);
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

        updateImagesQueryCaches(queryClient, current => current, {
            previousOrder: [first, second],
            nextOrder: [second, first],
            reorderQueryKey: ['images', { scope: 'order-only' }],
        });

        const data = queryClient.getQueryData<{ pages: Array<{ images: AIImage[] }> }>(key);
        expect(data?.pages.map(page => page.images[0].id)).toEqual(['2', '1']);
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

        updateImagesQueryCaches(queryClient, current => current, {
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
        updateImagesQueryCaches(missingClient, current => current);
        expect(missingClient.setQueryData).not.toHaveBeenCalled();
    });
});
