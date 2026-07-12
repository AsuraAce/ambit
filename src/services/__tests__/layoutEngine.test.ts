import { describe, expect, it } from 'vitest';
import { calculateLayout } from '../layoutEngine';

interface Item { ratio: number }
const config = (layoutMode: 'grid' | 'masonry' | 'justified', items: Item[], overrides = {}) => ({
    items,
    layoutMode,
    containerWidth: 500,
    minItemWidth: 100,
    gap: 10,
    padding: 10,
    getItemRatio: (item: Item) => item.ratio,
    ...overrides,
});

describe('calculateLayout', () => {
    it('returns an empty layout without usable width or items', () => {
        expect(calculateLayout(config('grid', []))).toEqual({ positions: [], totalHeight: 0, columns: 1, rowHeight: 0 });
        expect(calculateLayout(config('grid', [{ ratio: 1 }], { containerWidth: 20 }))).toEqual({
            positions: [], totalHeight: 0, columns: 1, rowHeight: 0,
        });
    });

    it('builds a square grid with minimum one column', () => {
        const result = calculateLayout(config('grid', Array.from({ length: 6 }, () => ({ ratio: 1 }))));
        expect(result.columns).toBe(4);
        expect(result.rowHeight).toBe(112);
        expect(result.positions[0]).toEqual({ left: 10, top: 10, width: 112, height: 112 });
        expect(result.positions[4]).toEqual({ left: 10, top: 132, width: 112, height: 112 });
        expect(result.totalHeight).toBe(254);

        expect(calculateLayout(config('grid', [{ ratio: 1 }], { containerWidth: 80 })).columns).toBe(1);
    });

    it('places masonry items in the shortest column and clamps ratios', () => {
        const result = calculateLayout(config('masonry', [
            { ratio: 0.1 }, { ratio: 3 }, { ratio: 1 }, { ratio: 1 }, { ratio: 1 },
        ]));
        expect(result.columns).toBe(4);
        expect(result.positions[0].height).toBe(224);
        expect(result.positions[1].height).toBe(56);
        expect(result.positions[4].left).toBe(result.positions[1].left);
        expect(result.positions[4].top).toBe(76);
        expect(result.totalHeight).toBeGreaterThan(200);
    });

    it('balances full justified rows and leaves the final row at target height', () => {
        const result = calculateLayout(config('justified', [
            { ratio: 0.1 }, { ratio: 4 }, { ratio: 1 }, { ratio: 1 }, { ratio: 1 },
        ], { containerWidth: 400 }));
        expect(result.positions).toHaveLength(5);
        expect(result.positions[0].height).toBe(90);
        expect(result.positions[1].width).toBe(225);
        expect(result.positions[4].height).toBe(120);
        expect(result.columns).toBe(3);
        expect(result.rowHeight).toBe(120);
        expect(result.totalHeight).toBeGreaterThan(result.positions[4].top + 120);

        const exactRow = calculateLayout(config('justified', [{ ratio: 1 }, { ratio: 1 }, { ratio: 2 }], { containerWidth: 400 }));
        expect(exactRow.positions).toHaveLength(3);
        expect(exactRow.totalHeight).toBeLessThan(200);
    });
});
