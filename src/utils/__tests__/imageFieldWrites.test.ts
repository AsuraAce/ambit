import { describe, expect, it } from 'vitest';
import { beginImageFieldWrite, countPendingImageFieldWritesForTests } from '../imageFieldWrites';

// The database applies one field's writes in the order they were issued, so after a failure the
// screen must show the latest write that did not fail, or the value from before all of them (#492).
const favorite = (previous: boolean, next: boolean, id = 'x') => beginImageFieldWrite('isFavorite', [{ id, previous, next }]);

describe('imageFieldWrites', () => {
    it('reverts a lone failed write to the value it found', () => {
        expect(favorite(false, true).settle(['x'])).toEqual(new Map([['x', { isFavorite: false }]]));
    });

    it('returns nothing to revert when the write succeeds', () => {
        expect(favorite(false, true).settle().size).toBe(0);
    });

    it('leaves the field to a later write that landed when an earlier one fails', () => {
        const first = favorite(false, true);
        favorite(true, false).settle();
        favorite(false, true).settle();
        expect(first.settle(['x']).size).toBe(0);
    });

    it('leaves the field to a later write that is still pending when an earlier one fails', () => {
        const first = favorite(false, true);
        const second = favorite(true, false);
        expect(first.settle(['x']).size).toBe(0);
        second.settle();
    });

    it.each([
        ['earlier first', [0, 1]],
        ['later first', [1, 0]],
    ] as const)('returns to the value before both when two writes fail, %s', (_, order) => {
        const writes = [favorite(false, true), favorite(true, false)];
        const results = order.map((index) => writes[index].settle(['x']));
        expect(results.at(-1)).toEqual(new Map([['x', { isFavorite: false }]]));
    });

    it('shows the earlier write that is still pending when the later one fails', () => {
        const first = favorite(false, true);
        const second = favorite(true, false);
        expect(second.settle(['x'])).toEqual(new Map([['x', { isFavorite: true }]]));
        first.settle();
    });

    it('shows the earlier write that landed when the later one fails', () => {
        const first = favorite(false, true);
        const second = favorite(true, false);
        first.settle();
        expect(second.settle(['x'])).toEqual(new Map([['x', { isFavorite: true }]]));
    });

    it('keeps each field and image apart', () => {
        const favoriteWrite = favorite(false, true);
        beginImageFieldWrite('isPinned', [{ id: 'x', previous: false, next: true }]).settle();
        favorite(false, true, 'y').settle();
        expect(favoriteWrite.settle(['x'])).toEqual(new Map([['x', { isFavorite: false }]]));
    });

    it('reverts only the failed images of a bulk write', () => {
        const bulk = beginImageFieldWrite('isPinned', [
            { id: 'a', previous: false, next: true },
            { id: 'b', previous: true, next: true },
            { id: 'c', previous: false, next: true },
        ]);
        expect(bulk.settle(['b', 'c'])).toEqual(
            new Map([
                ['b', { isPinned: true }],
                ['c', { isPinned: false }],
            ])
        );
    });

    it('settles a write once: a second call changes nothing', () => {
        const write = favorite(false, true);
        write.settle();
        expect(write.settle(['x']).size).toBe(0);
    });

    // A chain that outlived its writes would decide a later, unrelated rollback.
    it('forgets an image field once all of its writes settle, whether they land or fail', () => {
        const landed = [favorite(false, true), favorite(true, false)];
        landed.forEach((write) => write.settle());
        expect(countPendingImageFieldWritesForTests()).toBe(0);

        const mixed = [favorite(false, true), favorite(true, false)];
        mixed[0].settle(['x']);
        expect(countPendingImageFieldWritesForTests()).toBe(1);
        mixed[1].settle();
        expect(countPendingImageFieldWritesForTests()).toBe(0);

        expect(favorite(true, false).settle(['x'])).toEqual(new Map([['x', { isFavorite: true }]]));
    });
});
