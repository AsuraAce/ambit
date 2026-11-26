import { describe, expect, it } from 'vitest';
import {
    FLOAT_BAR_H,
    FLOAT_CHROME_H,
    FLOAT_MARGIN,
    FLOAT_MAX_W,
    FLOAT_MIN_W,
    moveFloat,
    placeFloat,
    resizeFloat,
    type FloatBox,
} from '../floatBounds';

const room = { w: 1000, h: 700 };
const box: FloatBox = { x: 100, y: 100, w: 200 };

// The window must never be lost off the canvas: its bar, the only handle that moves it back, always stays reachable.
describe('floating image bounds', () => {
    it('moves freely inside the canvas', () => {
        expect(moveFloat(box, 50, -30, room)).toEqual({ x: 150, y: 70, w: 200 });
    });

    it('stops a drag at each edge, keeping the whole bar on the canvas', () => {
        expect(moveFloat(box, -500, 0, room).x).toBe(FLOAT_MARGIN);
        expect(moveFloat(box, 5000, 0, room).x).toBe(room.w - box.w - FLOAT_MARGIN);
        expect(moveFloat(box, 0, -500, room).y).toBe(FLOAT_MARGIN);
        expect(moveFloat(box, 0, 5000, room).y).toBe(room.h - FLOAT_BAR_H - FLOAT_MARGIN);
    });

    it('keeps a resize between the smallest and largest widths', () => {
        expect(resizeFloat(box, 20, 1, room).w).toBe(FLOAT_MIN_W);
        expect(resizeFloat({ x: 10, y: 10, w: 200 }, 4000, 1, { w: 4000, h: 4000 }).w).toBe(FLOAT_MAX_W);
    });

    it('stops a resize at the canvas’s right and bottom edges', () => {
        const nearRight = { x: 700, y: 10, w: 200 };
        expect(resizeFloat(nearRight, 500, 1, room).w).toBe(room.w - nearRight.x - FLOAT_MARGIN);
        // A tall picture reaches the bottom first: its height is its width over the aspect, plus the bar and caption.
        const tall = resizeFloat({ x: 10, y: 300, w: 200 }, 500, 0.5, room);
        expect(tall.w).toBe((room.h - 300 - FLOAT_MARGIN - FLOAT_CHROME_H) * 0.5);
        expect(tall.w / 0.5 + FLOAT_CHROME_H + 300).toBeLessThanOrEqual(room.h - FLOAT_MARGIN);
    });

    it('pulls the window back when the canvas shrinks under it', () => {
        const far = { x: 780, y: 620, w: 200 };
        expect(placeFloat(far, { w: 600, h: 400 })).toEqual({ x: 600 - 200 - FLOAT_MARGIN, y: 400 - FLOAT_BAR_H - FLOAT_MARGIN, w: 200 });
    });

    it('pins the window to the top-left in a canvas smaller than it, never past the edge', () => {
        const placed = placeFloat({ x: 300, y: 300, w: 400 }, { w: 120, h: 20 });
        expect(placed).toEqual({ x: FLOAT_MARGIN, y: FLOAT_MARGIN, w: FLOAT_MIN_W });
    });

    it('narrows a wide window to fit the canvas', () => {
        expect(placeFloat({ x: 10, y: 10, w: 500 }, { w: 300, h: 600 }).w).toBe(300 - 2 * FLOAT_MARGIN);
    });

    it('leaves the window alone before the canvas has a size', () => {
        expect(placeFloat(box, { w: 0, h: 0 })).toBe(box);
    });
});
