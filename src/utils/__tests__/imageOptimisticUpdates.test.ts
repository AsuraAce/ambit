import { describe, expect, it } from 'vitest';
import type { AIImage } from '../../types';
import { applyOptimisticPinOrder } from '../imageOptimisticUpdates';

const image = (id: string, timestamp: number, isPinned = false) => ({
    id,
    timestamp,
    isPinned,
} as AIImage);

describe('applyOptimisticPinOrder', () => {
    it('patches selected ids without reordering when pin priority is disabled', () => {
        const first = image('first', 1);
        const second = image('second', 2);

        const result = applyOptimisticPinOrder([first, second], ['second'], true, false);

        expect(result.map(item => item.id)).toEqual(['first', 'second']);
        expect(result[0]).toBe(first);
        expect(result[1].isPinned).toBe(true);
    });

    it('orders pinned images first and timestamps newest-first within each group', () => {
        const result = applyOptimisticPinOrder([
            image('old-unpinned', 0),
            image('new-pinned', 20, true),
            image('old-pinned', 10, true),
            image('new-unpinned', 30),
        ], [], true, true);

        expect(result.map(item => item.id)).toEqual([
            'new-pinned',
            'old-pinned',
            'new-unpinned',
            'old-unpinned',
        ]);
    });

    it('treats missing timestamps as the oldest value', () => {
        const missingTimestamp = { ...image('missing', 1), timestamp: undefined } as unknown as AIImage;
        const result = applyOptimisticPinOrder([missingTimestamp, image('zero', 0)], [], false, true);

        expect(result.map(item => item.id)).toEqual(['missing', 'zero']);
    });
});
